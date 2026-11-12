import type { PendingQuery, Row } from "postgres";
import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import {
    hatAktiveSprachflaechen,
    SPRACHE_MISCH_PHASE,
    SPRACHE_TREFFER_JOB_KIND,
    SPRACHE_TREFFER_PHASEN,
    TREFFER_ARTEN,
    umfangAus,
    type TrefferArt,
    type TrefferUmfang,
} from "../sprachen/treffer-auftrag.ts";
import { addAreaEvent } from "./area-events.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";
import { loescheMisch, rechneMisch, type MischBericht } from "./sprachen-misch.ts";

/**
 * Die Treffer der Sprachen als Auftrag der Warteschlange (WI-0261 S4; O4; Claudio 2026-10-30 §3,
 * `project-control/handovers/2026-10-30-wi0261-sprachen-antwort-an-claudia.md`). Eingereiht von der Schreibnaht, vom Spracheditor (S5) und vom
 * Import (S6) über `sprachen/treffer-auftrag.ts`; gerechnet als Jobs-Rolle (INSERT und DELETE an `sprache_treffer`, `system-grants.psql`).
 *
 * - 🔴 **Die Rechnung liegt ganz in PostGIS**: je Art eine Transaktion aus `DELETE …` und `INSERT … SELECT …`; Node hält keine Geometrie
 *   (Claudio §3: Speicher deutlich unter 1 GB, Laufzeit des vollen Laufs unter 5 Minuten). Ohne parallele Worker
 *   (`max_parallel_workers_per_gather = 0`), damit ein leichter Auftrag nicht drei Kerne belegt (wie die Gebietsableitung, `dirigent/plan.ts`).
 * - **Die Sprachflächen** einer Sprache werden vorher vereinigt (sich überlappende Teilflächen derselben Sprache zählen einmal) und mit
 *   `ST_Subdivide(…, 256)` zerlegt (Claudio §3), in einer Arbeitstafel mit GiST-Index je Transaktion. Nur aktive Flächen aktiver Sprachen.
 * - **Die Ziele:** Orte (`place`, aktiv; Punkt in Fläche, Anteil 1), Herrschaftsgebiete (`territory`, aktiv; die aktiven `territory_area`,
 *   gültig gemacht und vereinigt), Regionen (`region`, aktiv, nicht versteckt, Ebene derographisch, Vegetation oder Topographie, kein Meer und
 *   kein See; die aktiven `region_area`, wie oben), Wege (`path`, aktiv; Anteil an der Länge). Alle Berührungen mit Anteil > 0, auf sechs
 *   Stellen; die Schwelle wirkt erst beim Lesen (Migration 0256). Regionen und Wege außerhalb der Karte (`off_map`) zählen nicht.
 * - 🔴 **Herrschaftsgebiete im angezeigten Jahr:** Gebiet und Fläche müssen im Jahr der Karte leben (`territory_state.derived_year_bf`, sonst
 *   `displayYearBf` der politischen Kartographie; Regel `lebt` aus `territory-display-rule.ts`, 9999 heißt offen). Sonst zögen historische
 *   Flächen (lokal 237 von 906 mit Gültigkeitsspanne) ein Gebiet über Länder, die es heute nicht hat.
 * - **Der Umfang** bestimmt, was gelöscht und neu bestimmt wird: alles, die Treffer bestimmter Sprachen (gegen alle Ziele) oder die Treffer
 *   bestimmter Objekte (gegen alle Sprachen), oder beides. Eine stillgelegte Sprache oder ein stillgelegtes Objekt verliert so seine Treffer.
 * - **Ohne aktive Sprachfläche** endet der Lauf sofort: Er löscht nur, was sein Umfang an Treffern hat (die letzte Fläche einer Sprache kann
 *   gerade stillgelegt worden sein), und rechnet nichts.
 * - **Die Mischgebiete** (S5a, Migration 0257, `sprachen-misch.ts`): Nennt der Umfang Sprachen oder „alle“, bestimmt eine letzte Phase die
 *   Paare dieser Sprachen neu (eine eigene Transaktion unter derselben Sperre); ein Lauf nur über Objekte fasst sie nicht an.
 * - **Kartenereignis nur mit Mischgebieten:** Treffer stehen in keiner Kachel; die Zeile „Sprachen“ (S5) liest sie beim Öffnen einer Infobox.
 *   Hat der Lauf die Mischgebiete gelöscht oder neu bestimmt, meldet er danach `map.changed` mit der Art `sprache` (`meldeSprachKacheln`): Die
 *   Karten laden Sprachflächen und Mischgebiete über `?r=` neu (`QUELLEN_NACH_ART` in `app.vue`). Die Meldung kommt nach dem Commit.
 * - Zwei Läufe derselben Domäne hält `maxConcurrent` auseinander; die Sperre je Domäne in jeder Transaktion sichert das zusätzlich.
 */

/** Der Umfang, die Sprachen als interne Kennungen (`sprache.id`); auch stillgelegte, damit ihre Treffer gelöscht werden. */
export interface AufgeloesterUmfang {
    alle: boolean;
    sprachIds: string[];
    objekte: Record<TrefferArt, string[]>;
}

export interface ArtBericht {
    geloescht: number;
    angelegt: number;
    ms: number;
}

const SPERRE = "sprache_treffer";

async function loese(db: Queryable, umfang: TrefferUmfang): Promise<AufgeloesterUmfang> {
    const objekte = Object.fromEntries(TREFFER_ARTEN.map((art) => [art, [] as string[]])) as Record<
        TrefferArt,
        string[]
    >;
    if ("alle" in umfang) return { alle: true, sprachIds: [], objekte };
    for (const art of TREFFER_ARTEN) objekte[art] = [...(umfang.objekte?.[art] ?? [])];
    const sprachen = umfang.sprachen ?? [];
    const zeilen =
        sprachen.length === 0
            ? []
            : await db<{ id: string }[]>`
                  SELECT id::text AS id FROM sprache WHERE public_id::text = ANY(${[...sprachen]}::text[]) ORDER BY id
              `;
    return { alle: false, sprachIds: zeilen.map((zeile) => zeile.id), objekte };
}

const betrifft = (umfang: AufgeloesterUmfang, art: TrefferArt): boolean =>
    umfang.alle || umfang.sprachIds.length > 0 || umfang.objekte[art].length > 0;

/** Löscht die Treffer des Umfangs an einer Art. */
async function loescheArt(tx: Queryable, art: TrefferArt, domain: string, umfang: AufgeloesterUmfang): Promise<number> {
    const ergebnis = await tx`
        DELETE FROM sprache_treffer
         WHERE map_domain_id = ${domain} AND objekt_art = ${art}
           AND (${umfang.alle}::boolean OR sprache_id = ANY(${umfang.sprachIds}::bigint[])
                OR objekt_public_id = ANY(${umfang.objekte[art]}::uuid[]))
    `;
    return ergebnis.count;
}

/**
 * Welche Ziele gegen welche Sprachflächen: alle Ziele (`zielAlle`) oder genau diese (`ziel`), ohne `ausser`; alle Sprachen der Arbeitstafel
 * (`teilAlle`) oder nur diese (`sprachIds`).
 */
interface Paarung {
    zielAlle: boolean;
    ziel: readonly string[];
    ausser: readonly string[];
    teilAlle: boolean;
    sprachIds: readonly string[];
}

const zielFilter = (tx: Queryable, kennung: PendingQuery<Row[]>, p: Paarung): PendingQuery<Row[]> =>
    tx`(${p.zielAlle}::boolean OR ${kennung} = ANY(${p.ziel}::uuid[])) AND ${kennung} <> ALL(${p.ausser}::uuid[])`;

const teilFilter = (tx: Queryable, teil: string, p: Paarung): PendingQuery<Row[]> =>
    tx`(${p.teilAlle}::boolean OR ${tx(teil)}.sprache_id = ANY(${p.sprachIds}::bigint[]))`;

/** Der Flächenanteil: Liegt die Sprachfläche ganz im Ziel oder das Ziel ganz in ihr, braucht es keinen Verschnitt. */
const flaechenAnteil = (tx: Queryable): PendingQuery<Row[]> => tx`
    sum(CASE WHEN ST_Covers(t.geom, z.geom) THEN z.flaeche
             WHEN ST_Covers(z.geom, t.geom) THEN ST_Area(t.geom)
             ELSE ST_Area(ST_Intersection(z.geom, t.geom)) END) / z.flaeche
`;

/** Legt die Treffer einer Paarung an; gibt die Zahl der Zeilen zurück. */
async function lege(tx: Queryable, art: TrefferArt, domain: string, p: Paarung): Promise<number> {
    let ergebnis: { count: number };
    switch (art) {
        case "place":
            ergebnis = await tx`
                INSERT INTO sprache_treffer (objekt_art, objekt_public_id, sprache_id, map_domain_id, anteil)
                SELECT DISTINCT 'place', p.public_id, t.sprache_id, ${domain}, 1::double precision
                  FROM sprache_treffer_teil t
                  JOIN place p ON ST_Intersects(t.geom, p.geom)
                 WHERE p.map_domain_id = ${domain} AND p.is_active
                   AND ${zielFilter(tx, tx`p.public_id`, p)} AND ${teilFilter(tx, "t", p)}
            `;
            break;
        case "path":
            ergebnis = await tx`
                INSERT INTO sprache_treffer (objekt_art, objekt_public_id, sprache_id, map_domain_id, anteil)
                SELECT 'path', x.public_id, x.sprache_id, ${domain}, LEAST(1, x.anteil)::double precision
                  FROM (
                      SELECT z.public_id, t.sprache_id,
                             round((sum(ST_Length(ST_Intersection(z.geom, t.geom))) / z.laenge)::numeric, 6) AS anteil
                        FROM (
                            SELECT p.public_id, p.geom, ST_Length(p.geom) AS laenge
                              FROM path p
                             WHERE p.map_domain_id = ${domain} AND p.is_active AND p.off_map IS NOT TRUE
                               AND ${zielFilter(tx, tx`p.public_id`, p)}
                        ) z
                        JOIN sprache_treffer_teil t ON ST_Intersects(z.geom, t.geom)
                       WHERE z.laenge > 0 AND ${teilFilter(tx, "t", p)}
                       GROUP BY z.public_id, z.laenge, t.sprache_id
                  ) x
                 WHERE x.anteil > 0
            `;
            break;
        case "territory":
            ergebnis = await tx`
                WITH jahr AS MATERIALIZED (
                    SELECT COALESCE(
                        (SELECT derived_year_bf FROM territory_state WHERE map_domain_id = ${domain}),
                        ${AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf}::integer
                    ) AS bf
                ),
                ziel AS MATERIALIZED (
                    SELECT u.public_id, u.geom, ST_Area(u.geom) AS flaeche
                      FROM (
                          SELECT g.public_id, ST_CollectionExtract(ST_MakeValid(ST_Union(ST_MakeValid(a.geom))), 3) AS geom
                            FROM territory g
                            JOIN territory_area a ON a.territory_id = g.id AND a.is_active
                            CROSS JOIN jahr
                           WHERE g.map_domain_id = ${domain} AND g.is_active AND ${zielFilter(tx, tx`g.public_id`, p)}
                             AND (g.valid_from_bf IS NULL OR g.valid_from_bf <= jahr.bf)
                             AND (g.valid_to_bf IS NULL OR g.valid_to_bf = 9999 OR g.valid_to_bf >= jahr.bf)
                             AND (a.valid_from_bf IS NULL OR a.valid_from_bf <= jahr.bf)
                             AND (a.valid_to_bf IS NULL OR a.valid_to_bf = 9999 OR a.valid_to_bf >= jahr.bf)
                             AND g.id IN (SELECT a2.territory_id FROM territory_area a2
                                            JOIN sprache_treffer_teil t2 ON a2.geom && t2.geom
                                           WHERE a2.is_active AND ${teilFilter(tx, "t2", p)})
                           GROUP BY g.public_id
                      ) u
                )
                INSERT INTO sprache_treffer (objekt_art, objekt_public_id, sprache_id, map_domain_id, anteil)
                SELECT 'territory', x.public_id, x.sprache_id, ${domain}, LEAST(1, x.anteil)::double precision
                  FROM (
                      SELECT z.public_id, t.sprache_id, round((${flaechenAnteil(tx)})::numeric, 6) AS anteil
                        FROM ziel z
                        JOIN sprache_treffer_teil t ON ST_Intersects(z.geom, t.geom)
                       WHERE z.flaeche > 0 AND ${teilFilter(tx, "t", p)}
                       GROUP BY z.public_id, z.flaeche, t.sprache_id
                  ) x
                 WHERE x.anteil > 0
            `;
            break;
        case "region":
            ergebnis = await tx`
                WITH ziel AS MATERIALIZED (
                    SELECT u.public_id, u.geom, ST_Area(u.geom) AS flaeche
                      FROM (
                          SELECT r.public_id, ST_CollectionExtract(ST_MakeValid(ST_Union(ST_MakeValid(a.geom))), 3) AS geom
                            FROM region r
                            JOIN region_area a ON a.region_id = r.id AND a.is_active
                           WHERE r.map_domain_id = ${domain} AND r.is_active AND r.is_hidden IS NOT TRUE AND r.off_map IS NOT TRUE
                             AND r.region_layer IN ('derographisch', 'vegetation', 'topographie')
                             AND COALESCE(r.region_type, '') NOT IN ('meer', 'see')
                             AND ${zielFilter(tx, tx`r.public_id`, p)}
                             AND r.id IN (SELECT a2.region_id FROM region_area a2
                                            JOIN sprache_treffer_teil t2 ON a2.geom && t2.geom
                                           WHERE a2.is_active AND ${teilFilter(tx, "t2", p)})
                           GROUP BY r.public_id
                      ) u
                )
                INSERT INTO sprache_treffer (objekt_art, objekt_public_id, sprache_id, map_domain_id, anteil)
                SELECT 'region', x.public_id, x.sprache_id, ${domain}, LEAST(1, x.anteil)::double precision
                  FROM (
                      SELECT z.public_id, t.sprache_id, round((${flaechenAnteil(tx)})::numeric, 6) AS anteil
                        FROM ziel z
                        JOIN sprache_treffer_teil t ON ST_Intersects(z.geom, t.geom)
                       WHERE z.flaeche > 0 AND ${teilFilter(tx, "t", p)}
                       GROUP BY z.public_id, z.flaeche, t.sprache_id
                  ) x
                 WHERE x.anteil > 0
            `;
            break;
    }
    return ergebnis.count;
}

/**
 * Eine Art in der Transaktion des Aufrufers: Arbeitstafel der Sprachflächen, dann löschen und neu anlegen. Die Messung ruft sie in EINER
 * zurückgerollten Transaktion für alle Arten (darum räumt sie eine Arbeitstafel des vorigen Aufrufs selbst weg).
 */
export async function rechneArt(
    tx: Queryable,
    art: TrefferArt,
    domain: string,
    umfang: AufgeloesterUmfang,
): Promise<ArtBericht> {
    const start = performance.now();
    await tx`SET LOCAL max_parallel_workers_per_gather = 0`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${SPERRE}), hashtext(${domain}))`;
    const ziele = umfang.objekte[art];
    // Für Objekte zählt jede Sprache; für einen Lauf nur über Sprachen genügen deren Flächen.
    const alleSprachen = umfang.alle || ziele.length > 0;
    await tx`DROP TABLE IF EXISTS pg_temp.sprache_treffer_teil`;
    await tx`
        CREATE TEMP TABLE sprache_treffer_teil ON COMMIT DROP AS
        SELECT f.sprache_id,
               ST_Subdivide(ST_CollectionExtract(ST_MakeValid(ST_Union(ST_MakeValid(f.geom))), 3), 256) AS geom
          FROM sprache_flaeche f
          JOIN sprache s ON s.id = f.sprache_id
         WHERE f.map_domain_id = ${domain} AND f.is_active AND s.is_active
           AND (${alleSprachen}::boolean OR f.sprache_id = ANY(${umfang.sprachIds}::bigint[]))
         GROUP BY f.sprache_id
    `;
    await tx`CREATE INDEX ON sprache_treffer_teil USING gist (geom)`;
    await tx`ANALYZE sprache_treffer_teil`;

    const geloescht = await loescheArt(tx, art, domain, umfang);
    let angelegt = 0;
    const keine: readonly string[] = [];
    if (umfang.alle) {
        angelegt += await lege(tx, art, domain, {
            zielAlle: true,
            ziel: keine,
            ausser: keine,
            teilAlle: true,
            sprachIds: keine,
        });
    } else {
        // Erst die Objekte gegen jede Sprache, dann die Sprachen gegen jedes übrige Ziel: keine Zeile doppelt.
        if (ziele.length > 0)
            angelegt += await lege(tx, art, domain, {
                zielAlle: false,
                ziel: ziele,
                ausser: keine,
                teilAlle: true,
                sprachIds: keine,
            });
        if (umfang.sprachIds.length > 0)
            angelegt += await lege(tx, art, domain, {
                zielAlle: true,
                ziel: keine,
                ausser: ziele,
                teilAlle: false,
                sprachIds: umfang.sprachIds,
            });
    }
    return { geloescht, angelegt, ms: Math.round(performance.now() - start) };
}

/** Eine kurze Beschreibung des Umfangs für das Ergebnis (keine Kennungen). */
function beschreibe(umfang: AufgeloesterUmfang): Record<string, unknown> {
    if (umfang.alle) return { alle: true };
    return {
        sprachen: umfang.sprachIds.length,
        objekte: Object.fromEntries(TREFFER_ARTEN.map((art) => [art, umfang.objekte[art].length])),
    };
}

/** Bestimmt der Lauf die Mischgebiete neu? Nur, wenn sein Umfang Sprachen oder „alle“ nennt (S5a). */
const mitMisch = (umfang: AufgeloesterUmfang): boolean => umfang.alle || umfang.sprachIds.length > 0;

/**
 * Der Lauf: je betroffener Art eine Phase und eine Transaktion, danach die Mischgebiete (`mitMisch`). `phase` meldet den Beginn (dort kommt ein
 * Abbruch an); ohne aktive Sprachfläche nur das Löschen, in einer Transaktion. `melde` ruft der Lauf nach dem Commit, wenn er Mischgebiete
 * gelöscht oder neu bestimmt hat (die Kacheln der Sprachen sind dann veraltet).
 */
export async function rechneSprachTreffer(
    database: Database,
    domain: string,
    umfang: TrefferUmfang,
    phase: (name: string, progress: number) => Promise<void> = async () => undefined,
    melde: () => Promise<void> = async () => undefined,
): Promise<Record<string, unknown>> {
    const aufgeloest = await loese(database, umfang);
    const arten = SPRACHE_TREFFER_PHASEN.filter((eintrag) => betrifft(aufgeloest, eintrag.art));
    if (arten.length === 0) return { status: "nichts", umfang: beschreibe(aufgeloest) };
    const misch = mitMisch(aufgeloest);
    if (!(await hatAktiveSprachflaechen(database, domain))) {
        const { geloescht, mischGeloescht } = await database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${SPERRE}), hashtext(${domain}))`;
            let zahl = 0;
            for (const eintrag of arten) zahl += await loescheArt(tx, eintrag.art, domain, aufgeloest);
            return { geloescht: zahl, mischGeloescht: misch ? await loescheMisch(tx, domain, aufgeloest) : 0 };
        });
        if (misch) await melde();
        return {
            status: "ohne_sprachflaechen",
            umfang: beschreibe(aufgeloest),
            geloescht,
            ...(misch ? { misch: { geloescht: mischGeloescht, angelegt: 0 } } : {}),
        };
    }
    const bericht: Partial<Record<TrefferArt, ArtBericht>> = {};
    for (const eintrag of arten) {
        await phase(eintrag.name, eintrag.progress);
        bericht[eintrag.art] = await database.begin((tx) => rechneArt(tx, eintrag.art, domain, aufgeloest));
    }
    let mischBericht: MischBericht | undefined;
    if (misch) {
        await phase(SPRACHE_MISCH_PHASE.name, SPRACHE_MISCH_PHASE.progress);
        mischBericht = await database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${SPERRE}), hashtext(${domain}))`;
            return rechneMisch(tx, domain, aufgeloest);
        });
        await melde();
    }
    return {
        status: "gerechnet",
        umfang: beschreibe(aufgeloest),
        arten: bericht,
        ...(mischBericht ? { misch: mischBericht } : {}),
    };
}

/**
 * Die Meldung nach neuen Mischgebieten: `map.changed` mit der Art `sprache`. Die Karten laden darauf nur die Quellen der Sprachen neu
 * (Sprachflächen und Mischgebiete, `QUELLEN_NACH_ART` in `app.vue`), nicht die übrigen.
 */
export async function meldeSprachKacheln(database: Database, context: JobContext, domain: string): Promise<void> {
    await addAreaEvent(
        database,
        "map.changed",
        { id: context.job.id, publicId: context.job.publicId, kind: SPRACHE_TREFFER_JOB_KIND, mapDomainId: domain },
        { operation: SPRACHE_TREFFER_JOB_KIND, affected: [{ kind: "sprache" }] },
    );
}

export async function runSpracheTrefferJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    const umfang = umfangAus(context.input);
    if (umfang === null)
        throw new JobFailure(
            "input_invalid",
            "sprache_treffer braucht einen Umfang: alle, Sprachen oder Objekte je Art (Kennungen als UUID)",
            false,
        );
    return withJobDatabase((database) =>
        rechneSprachTreffer(
            database,
            domain,
            umfang,
            (name, progress) => context.beginPhase(name, progress),
            () => meldeSprachKacheln(database, context, domain),
        ),
    );
}
