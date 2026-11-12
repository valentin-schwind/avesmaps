import type {
    WikisyncBefund,
    WikisyncBereich,
    WikisyncBereichZahlen,
    WikisyncBericht,
    WikisyncBerichtAbfrage,
    WikisyncEigentuemer,
    WikisyncLauf,
    WikisyncStatus,
    WikisyncWertZustand,
    WikisyncWirkung,
    WikisyncZeile,
} from "@avesmaps3d/shared";
import { WIKISYNC_BEREICHE } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../database.ts";
import { likeMuster } from "../../db/like-muster.ts";
import { kuerze } from "../infobox/text.ts";
import { schreibeRegeln } from "../regeln/ablage.ts";
import type { Plan, PlanZeile } from "./plan.ts";
import { darfZitateAblegen, schreibeZitate } from "./zitat-ablage.ts";

/**
 * Die Ablage der Läufe des Abgleichs (WI-0253 C, Migration 0224): schreiben (nur der Auftrag `wiki_vorschau`, als Jobs-Rolle) und lesen (der Bericht,
 * als App-Rolle). Hier steht keine Fachtafel; ein Lauf legt allein seine Kopfzeile und seine Planzeilen an und räumt ältere Läufe ab.
 */

/** Wie viele fertige Läufe je Bereich stehen bleiben (der jüngste und einer davor). */
export const LAEUFE_JE_BEREICH = 2;
/** Wie viele fehlgeschlagene Läufe überhaupt stehen bleiben. */
export const FEHLGESCHLAGENE_LAEUFE = 5;

const ZEILEN_JE_ANWEISUNG = 1_500;
/** So viele Zeichen trägt ein Wert in einer Planzeile höchstens; ein Wert in dieser Länge gilt der Übernahme als gekürzt (`wert_gekuerzt`). */
export const VORSCHAU_TEXT_MAX = 4_000;
const TEXT_MAX = VORSCHAU_TEXT_MAX;

export interface LaufQuelle {
    datei: string;
    sha256: string;
    stand: string | null;
    seiten: number;
    /** Die Kategorien-Datei, aus der die Vorschau Ortsgröße, Bauwerkart und Kontinent rechnete (WI-0294); `null`: keine gelesen. `stand` ist die Endzeile der Datei (ISO, UTC). */
    kategorien?: { datei: string; sha256: string; stand: string; zeilen: number } | null;
}

export interface LaufEingabe {
    bereiche: readonly WikisyncBereich[];
    parserVersion: string;
    jobPublicId: string | null;
    /** Die Person (`person.id`), die den Lauf ausgelöst hat, und ihr Name; beides NULL für ein Werkzeug. */
    ausgeloestVon: string | null;
    ausgeloestLabel: string | null;
    quelle: LaufQuelle;
    tafelRevision: number | null;
    plan: Plan;
    /** Mit `plan.regeln`: die Revision der Begriffstafel, nach der die Regelvorschläge gerechnet sind (`null`: nach den Startwerten). */
    begriffeRevision?: number | null;
}

const PERSON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** Der Auslöser eines Auftrags: eine `person.id` (UUID) oder eine opake Werkzeugkennung (`jobs-cli`). */
export function ausloeserVon(actorRef: string | null): { von: string | null; label: string | null } {
    if (actorRef === null || actorRef === "") return { von: null, label: null };
    return PERSON_UUID.test(actorRef) ? { von: actorRef, label: null } : { von: null, label: actorRef };
}

export function zeileFuerDb(laufId: number, position: number, zeile: PlanZeile): Record<string, unknown> {
    return {
        lauf_id: laufId,
        position,
        bereich: zeile.bereich,
        objekt_art: zeile.objektArt,
        objekt_id: zeile.objektId,
        objekt_name: zeile.objektName === null ? null : kuerze(zeile.objektName, 500),
        objekte: zeile.objekte,
        objekt_ids: zeile.objektIds,
        artikel: zeile.artikel === null ? null : kuerze(zeile.artikel, 500),
        namensraum: zeile.namensraum,
        feld: zeile.feld,
        alt: zeile.alt === null ? null : kuerze(zeile.alt, TEXT_MAX),
        alt_zustand: zeile.altZustand,
        neu: zeile.neu === null ? null : kuerze(zeile.neu, TEXT_MAX),
        neu_zustand: zeile.neuZustand,
        eigentuemer: zeile.eigentuemer,
        wirkung: zeile.wirkung,
        status: zeile.status,
        befund: zeile.befund,
        grund: zeile.grund === null ? null : kuerze(zeile.grund, 200),
    };
}

export const ZEILEN_SPALTEN = [
    "lauf_id",
    "position",
    "bereich",
    "objekt_art",
    "objekt_id",
    "objekt_name",
    "objekte",
    "objekt_ids",
    "artikel",
    "namensraum",
    "feld",
    "alt",
    "alt_zustand",
    "neu",
    "neu_zustand",
    "eigentuemer",
    "wirkung",
    "status",
    "befund",
    "grund",
] as const;

/**
 * Schreibt einen fertigen Lauf: Kopfzeile, alle Planzeilen, die Zitate des Wikis (Bereich `quelle`, Migration 0251) und das Abräumen älterer Läufe in EINER Transaktion – ein Lauf steht ganz da
 * oder gar nicht. Liefert die Nummer des Laufs.
 *
 * 🪤 Die Zitate legt nur ab, wer die Tafel beschreiben darf (`darfZitateAblegen`): Auf Stage und Production fehlt das Recht der Jobs-Rolle, bis Claudio die Rechte einspielt. Dann steht der Lauf
 * ohne Zitate da und sagt es in seinen Zahlen: `zahlen.quelle.zitateUebersprungen` ist die Zahl der Zitate, die er hätte ablegen sollen; legt er sie ab, steht ihre Zahl in `zahlen.quelle.zitate`
 * (auch 0), davon die der Vorkommen in `zahlen.quelle.zitateVorkommen`. Wer die Zitate liest, nimmt nur einen Lauf mit `zitate`.
 */
export async function schreibeLauf(database: Database, eingabe: LaufEingabe): Promise<number> {
    return database.begin(async (tx) => {
        // Die Zitate gehören zum Bereich `quelle`; ein Lauf ohne ihn hat keine.
        const zahlen: Record<string, unknown> = { ...eingabe.plan.zahlen };
        const zitateAblegen = eingabe.plan.zahlen.quelle !== undefined && (await darfZitateAblegen(tx));
        // Davon die an Einträgen der Vorkommen (`lore`): Wer die Zitate der Vorkommen liest, nimmt nur einen Lauf mit dieser Zahl (ein Lauf vor dem Bau der Vorkommen-Zitate hat sie nicht).
        const zitateVorkommen = eingabe.plan.zitate.filter((zitat) => zitat.traegerArt === "lore").length;
        if (eingabe.plan.zahlen.quelle !== undefined) {
            zahlen["quelle"] = {
                ...eingabe.plan.zahlen.quelle,
                ...(zitateAblegen
                    ? { zitate: eingabe.plan.zitate.length, zitateVorkommen }
                    : { zitateUebersprungen: eingabe.plan.zitate.length }),
            };
        }
        const [kopf] = await tx<{ id: number }[]>`
            INSERT INTO wikisync_lauf (
                art, bereiche, status, dump_datei, dump_sha256, dump_stand, dump_seiten, dump_vollstaendig,
                kategorien_datei, kategorien_sha256, kategorien_stand, kategorien_zeilen, tafel_revision, parser_version,
                job_public_id, ausgeloest_von, ausgeloest_label, beendet_am, zahlen
            ) VALUES (
                'vorschau', ${[...eingabe.bereiche]}::text[], 'fertig', ${eingabe.quelle.datei}, ${eingabe.quelle.sha256}, ${eingabe.quelle.stand},
                ${eingabe.quelle.seiten}, TRUE, ${eingabe.quelle.kategorien?.datei ?? null}, ${eingabe.quelle.kategorien?.sha256 ?? null},
                ${eingabe.quelle.kategorien?.stand ?? null}::timestamptz, ${eingabe.quelle.kategorien?.zeilen ?? null}, ${eingabe.tafelRevision}, ${eingabe.parserVersion},
                ${eingabe.jobPublicId}::uuid, ${eingabe.ausgeloestVon}::uuid, ${eingabe.ausgeloestLabel}, now(),
                ${tx.json(zahlen as never)}
            )
            RETURNING id::int AS id
        `;
        if (kopf === undefined) throw new Error("wikisync_lauf: keine Nummer erhalten");
        const zeilen = eingabe.plan.zeilen.map((zeile, position) => zeileFuerDb(kopf.id, position, zeile));
        for (let ab = 0; ab < zeilen.length; ab += ZEILEN_JE_ANWEISUNG) {
            const stueck = zeilen.slice(ab, ab + ZEILEN_JE_ANWEISUNG);
            await tx`INSERT INTO wikisync_lauf_zeile ${tx(stueck as never, ...ZEILEN_SPALTEN)}`;
        }
        if (zitateAblegen) await schreibeZitate(tx, kopf.id, eingabe.plan.zitate);
        // Die Regelvorschläge der Vorkommen gehören zum Lauf: Sie stehen ganz da oder gar nicht, und fallen mit ihm (ON DELETE CASCADE).
        if (eingabe.plan.regeln !== undefined)
            await schreibeRegeln(tx, kopf.id, eingabe.plan.regeln, eingabe.begriffeRevision ?? null);
        await raeumeAb(tx);
        return kopf.id;
    });
}

/** Ein Lauf, der nicht zustande kam: nur Kopfzeile mit dem Grund, damit der Bericht den Ausfall zeigt. Schlägt auch das fehl, bleibt der Fehler des Auftrags. */
export async function schreibeFehllauf(
    database: Database,
    eingabe: Pick<LaufEingabe, "bereiche" | "parserVersion" | "jobPublicId" | "ausgeloestVon" | "ausgeloestLabel">,
    fehler: string,
): Promise<void> {
    await database.begin(async (tx) => {
        await tx`
            INSERT INTO wikisync_lauf (
                art, bereiche, status, parser_version, job_public_id, ausgeloest_von, ausgeloest_label, beendet_am, fehler
            ) VALUES (
                'vorschau', ${[...eingabe.bereiche]}::text[], 'fehlgeschlagen', ${eingabe.parserVersion}, ${eingabe.jobPublicId}::uuid,
                ${eingabe.ausgeloestVon}::uuid, ${eingabe.ausgeloestLabel}, now(), ${kuerze(fehler, 500)}
            )
        `;
        await raeumeAb(tx);
    });
}

/** Behält je Bereich die jüngsten fertigen Läufe, die jüngsten Fehlschläge und jeden laufenden; der Rest fällt samt Zeilen (ON DELETE CASCADE). */
export async function raeumeAb(db: Queryable): Promise<number> {
    const entfernt = await db<{ id: number }[]>`
        WITH behalten AS (
            SELECT id FROM (
                SELECT l.id, row_number() OVER (PARTITION BY b.bereich ORDER BY l.id DESC) AS rang
                  FROM wikisync_lauf l
                 CROSS JOIN LATERAL unnest(l.bereiche) AS b(bereich)
                 WHERE l.status = 'fertig'
            ) fertig
            WHERE rang <= ${LAEUFE_JE_BEREICH}
            UNION SELECT id FROM wikisync_lauf WHERE status = 'laeuft'
            UNION SELECT id FROM (
                SELECT id FROM wikisync_lauf WHERE status = 'fehlgeschlagen' ORDER BY id DESC LIMIT ${FEHLGESCHLAGENE_LAEUFE}
            ) fehl
        )
        DELETE FROM wikisync_lauf WHERE id NOT IN (SELECT id FROM behalten) RETURNING id::int AS id
    `;
    return entfernt.length;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Lesen
// ----------------------------------------------------------------------------------------------------------------------------

type Zeile = Record<string, unknown>;

const BEREICH_REIHENFOLGE = WIKISYNC_BEREICHE as readonly string[];

function laufAus(zeile: Zeile): WikisyncLauf {
    const zeit = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);
    return {
        id: Number(zeile["id"]),
        // Ein Bereich, den es nicht mehr gibt (die Landmarken vor der Zusammenlegung, WI-0271), steht in alten Läufen noch da; die Antwort kennt ihn nicht.
        bereiche: (zeile["bereiche"] as string[]).filter((bereich): bereich is WikisyncBereich =>
            BEREICH_REIHENFOLGE.includes(bereich),
        ),
        status: zeile["status"] as WikisyncLauf["status"],
        dump: {
            datei: (zeile["dump_datei"] as string | null) ?? null,
            sha256: (zeile["dump_sha256"] as string | null) ?? null,
            stand: (zeile["dump_stand"] as string | null) ?? null,
            seiten:
                zeile["dump_seiten"] === null || zeile["dump_seiten"] === undefined
                    ? null
                    : Number(zeile["dump_seiten"]),
        },
        kategorien:
            typeof zeile["kategorien_sha256"] === "string" && zeile["kategorien_stand"] instanceof Date
                ? {
                      datei: String(zeile["kategorien_datei"] ?? ""),
                      sha256: zeile["kategorien_sha256"],
                      stand: zeile["kategorien_stand"].toISOString(),
                      zeilen: Number(zeile["kategorien_zeilen"] ?? 0),
                  }
                : null,
        tafelRevision:
            zeile["tafel_revision"] === null || zeile["tafel_revision"] === undefined
                ? null
                : Number(zeile["tafel_revision"]),
        parserVersion: String(zeile["parser_version"]),
        gestartetAm: zeit(zeile["gestartet_am"]) ?? "",
        beendetAm: zeit(zeile["beendet_am"]),
        ausgeloestVon: (zeile["ausgeloest_label"] as string | null) ?? null,
        fehler: (zeile["fehler"] as string | null) ?? null,
        zahlen: (zeile["zahlen"] ?? {}) as Record<string, WikisyncBereichZahlen>,
    };
}

function zeileAus(zeile: Zeile): WikisyncZeile {
    return {
        id: Number(zeile["id"]),
        laufId: Number(zeile["lauf_id"]),
        bereich: zeile["bereich"] as WikisyncBereich,
        objektArt: String(zeile["objekt_art"]),
        objektId: (zeile["objekt_id"] as string | null) ?? null,
        objektName: (zeile["objekt_name"] as string | null) ?? null,
        objekte: Number(zeile["objekte"]),
        artikel: (zeile["artikel"] as string | null) ?? null,
        namensraum: zeile["namensraum"] === null ? null : Number(zeile["namensraum"]),
        feld: (zeile["feld"] as string | null) ?? null,
        alt: (zeile["alt"] as string | null) ?? null,
        altZustand: zeile["alt_zustand"] as WikisyncWertZustand,
        neu: (zeile["neu"] as string | null) ?? null,
        neuZustand: zeile["neu_zustand"] as WikisyncWertZustand,
        eigentuemer: zeile["eigentuemer"] as WikisyncEigentuemer,
        wirkung: zeile["wirkung"] as WikisyncWirkung,
        status: zeile["status"] as WikisyncStatus,
        befund: (zeile["befund"] as WikisyncBefund | null) ?? null,
        grund: (zeile["grund"] as string | null) ?? null,
    };
}

const VORGABE_LIMIT = 100;

/**
 * Der Dump-Bericht (WI-0253 C): je Bereich der jüngste fertige Lauf, seine Zeilen gefiltert nach Bereich, Wirkung, Eigentümer, Status, Befund und Freitext,
 * mit der Zahl am Wert für jeden Filter (eingeschränkt nur nach Bereich). Ohne Lauf: leere Antwort, keine Fehlermeldung.
 */
export async function leseBericht(
    db: Queryable,
    abfrage: WikisyncBerichtAbfrage,
    jetzt: Date,
): Promise<WikisyncBericht> {
    const limit = abfrage.limit ?? VORGABE_LIMIT;
    const offset = abfrage.offset ?? 0;
    const bereichFilter = abfrage.bereich ?? null;

    // Je Bereich der jüngste fertige Lauf.
    const jeBereich = await db<Zeile[]>`
        SELECT DISTINCT ON (b.bereich) b.bereich, l.id::int AS lauf_id
          FROM wikisync_lauf l
         CROSS JOIN LATERAL unnest(l.bereiche) AS b(bereich)
         WHERE l.status = 'fertig' AND b.bereich = ANY(${BEREICH_REIHENFOLGE as string[]}::text[])
           AND (${bereichFilter}::text IS NULL OR b.bereich = ${bereichFilter})
         ORDER BY b.bereich, l.id DESC
    `;
    const laufIds = [...new Set(jeBereich.map((zeile) => Number(zeile["lauf_id"])))].sort((a, b) => b - a);
    const laeufe =
        laufIds.length === 0
            ? []
            : (
                  await db<Zeile[]>`
                      SELECT id::int AS id, bereiche, status, dump_datei, dump_sha256, dump_stand, dump_seiten, tafel_revision::int AS tafel_revision,
                             kategorien_datei, kategorien_sha256, kategorien_stand, kategorien_zeilen::int AS kategorien_zeilen, parser_version, gestartet_am, beendet_am, ausgeloest_label, fehler, zahlen
                        FROM wikisync_lauf WHERE id = ANY(${laufIds}::int[]) ORDER BY id DESC
                  `
              ).map(laufAus);
    if (jeBereich.length === 0) {
        return {
            jetzt: jetzt.toISOString(),
            laeufe,
            gesamt: 0,
            offset,
            limit,
            facetten: { wirkung: {}, eigentuemer: {}, status: {}, befund: {} },
            zeilen: [],
        };
    }
    const laufFuerPaar = jeBereich.map((zeile) => Number(zeile["lauf_id"]));
    const bereicheFuerPaar = jeBereich.map((zeile) => String(zeile["bereich"]));
    // Die Paare (Lauf, Bereich) als Tabelle: nur die Zeilen eines Bereichs aus SEINEM jüngsten Lauf.
    const paare = db`(SELECT unnest(${laufFuerPaar}::int[]) AS lauf_id, unnest(${bereicheFuerPaar}::text[]) AS bereich) AS k`;

    const nachWirkung = abfrage.wirkung === undefined ? db`` : db`AND z.wirkung = ${abfrage.wirkung}`;
    const nachEigentuemer = abfrage.eigentuemer === undefined ? db`` : db`AND z.eigentuemer = ${abfrage.eigentuemer}`;
    const nachStatus = abfrage.status === undefined ? db`` : db`AND z.status = ${abfrage.status}`;
    const nachBefund = abfrage.befund === undefined ? db`` : db`AND z.befund = ${abfrage.befund}`;
    const muster = abfrage.q === undefined ? null : likeMuster(abfrage.q);
    const nachText =
        muster === null
            ? db``
            : db`AND (z.objekt_name ILIKE ${muster} ESCAPE '\\' OR z.artikel ILIKE ${muster} ESCAPE '\\' OR z.feld ILIKE ${muster} ESCAPE '\\')`;
    const filter = db`${nachWirkung} ${nachEigentuemer} ${nachStatus} ${nachBefund} ${nachText}`;

    const [zaehlung] = await db<{ gesamt: number }[]>`
        SELECT count(*)::int AS gesamt FROM wikisync_lauf_zeile z JOIN ${paare} ON k.lauf_id = z.lauf_id AND k.bereich = z.bereich WHERE TRUE ${filter}
    `;
    const zeilen = await db<Zeile[]>`
        SELECT z.id::int AS id, z.lauf_id::int AS lauf_id, z.bereich, z.objekt_art, z.objekt_id::text AS objekt_id, z.objekt_name, z.objekte, z.artikel,
               z.namensraum, z.feld, z.alt, z.alt_zustand, z.neu, z.neu_zustand, z.eigentuemer, z.wirkung, z.status, z.befund, z.grund
          FROM wikisync_lauf_zeile z
          JOIN ${paare} ON k.lauf_id = z.lauf_id AND k.bereich = z.bereich
         WHERE TRUE ${filter}
         ORDER BY array_position(${BEREICH_REIHENFOLGE as string[]}::text[], z.bereich), z.position
         LIMIT ${limit} OFFSET ${offset}
    `;

    // Die Zahl am Wert: nach Bereich eingeschränkt, nicht nach den anderen Filtern.
    const facette = async (
        spalte: "wirkung" | "eigentuemer" | "status" | "befund",
    ): Promise<Record<string, number>> => {
        const reihen = await db<{ wert: string; anzahl: number }[]>`
            SELECT z.${db(spalte)} AS wert, count(*)::int AS anzahl
              FROM wikisync_lauf_zeile z JOIN ${paare} ON k.lauf_id = z.lauf_id AND k.bereich = z.bereich
             WHERE z.${db(spalte)} IS NOT NULL
             GROUP BY z.${db(spalte)}
        `;
        return Object.fromEntries(reihen.map((reihe) => [reihe.wert, reihe.anzahl]));
    };
    return {
        jetzt: jetzt.toISOString(),
        laeufe,
        gesamt: zaehlung?.gesamt ?? 0,
        offset,
        limit,
        facetten: {
            wirkung: await facette("wirkung"),
            eigentuemer: await facette("eigentuemer"),
            status: await facette("status"),
            befund: await facette("befund"),
        },
        zeilen: zeilen.map(zeileAus),
    };
}
