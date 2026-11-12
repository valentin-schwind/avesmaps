import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { importLiterature } from "../src/migration/literature-import.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Literatur im WikiSync (WI-0253, Scheibe Literatur) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`). Die Jobs-Rolle
 * rechnet und schreibt, die Welt ist erfunden. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki.
 *
 * - **Verknüpfung:** Ein Werk wird über seine gespeicherte Adresse mit seinem Produkt-Artikel verbunden (auch im Namensraum `DSK:`), nie über den Titel; ein Werk, dessen
 *   Artikel fehlt oder umgeleitet ist, ist ein Befund; ein Produkt-Artikel ohne Werk ist ein Befund „neuer Artikel“ (nur in Einsammel-Räumen) und wird nicht angelegt.
 * - **Übernahme:** Ein Feld mit dem Vermerk „wiki“ folgt dem Wiki, ein leeres Feld wird gefüllt (und bekommt den Vermerk), ein Wert ohne Vermerk bleibt ein Befund, ein
 *   eigener Wert (`manual`) und jedes Feld eines Werks der Redaktion (`source_system = 'editor'`) bleiben. Eine Operation der Quelle `wikisync`, keine Ableitung, der zweite Lauf ohne Änderung.
 * - **Rücknahme:** stellt die Werte her, nur wo der Istwert noch der der Übernahme ist und das Feld nicht inzwischen der Redaktion gehört.
 * - **Legacy-Zug:** Gehört die Literatur dem WikiSync, lässt der Schritt I20 sie aus. **Rechte:** Die Jobs-Rolle schreibt nie die Zuordnung eines Werks.
 */

const ENV = "wikisynclit";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const uuid = (nummer: number): string => `a0000000-0000-4000-9000-${String(nummer).padStart(12, "0")}`;
const ID = {
    siegelbruch: uuid(1),
    rabengruft: uuid(2),
    dunkelheit: uuid(3),
    redaktion: uuid(4),
    verschwunden: uuid(5),
    umgezogen: uuid(6),
    bornland: uuid(7),
};
const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel).replaceAll("%2F", "/")}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Siegelbruch",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Siegelbruch\n|Art=Gruppenabenteuer\n|Regeln=DSA5\n|Genre=[[Mysterienabenteuer]]\n|KompM=hoch\n|KompSp=mittel\n|Autoren=[[Hans Mustermann]]\n|Teil von=[[Dämonenmacht & Sternenkraft]]\n|Ort=[[Mittelreich]], [[Gareth]]\n}}\nEin Abenteuer.",
    },
    {
        titel: "Rabengruft",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Rabengruft\n|Art=Gruppenabenteuer\n|Regeln=DSA4.1\n|Genre=Horror\n|Autoren=Tara Flink\n|Ort=[[Punin]]\n}}",
    },
    {
        titel: "DSK:Endlose Dunkelheit",
        ns: 218,
        text: "{{Infobox Produkt\n|Titel=Endlose Dunkelheit\n|Art=Kurzabenteuer\n|Autoren=Ein Autor\n|Ort=[[Gareth]]\n}}",
    },
    {
        titel: "Im Auftrag der Redaktion",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Im Auftrag (Wiki)\n|Art=Roman\n|Autoren=Wiki-Autor\n|Ort=[[Ferdok]]\n}}",
    },
    { titel: "Alter Titel", ns: 0, weiterleitung: "Neuer Titel" },
    {
        titel: "Neuer Titel",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Neuer Titel\n|Art=Roman\n|Ort=[[Havena]]\n}}",
    },
    {
        titel: "Das Bornland",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Das Bornland\n|Art=Regionalspielhilfe\n|Thema=[[Bornland]], [[Festum]]\n}}",
    },
    // Artikel ohne Werk: einer, den Legacy in den Katalog nähme (Befund), einer ohne Ortsliste, ein Regelband, und einer in DSK (Einsammeln: nein).
    {
        titel: "Ganz neues Abenteuer",
        ns: 0,
        text: "{{Infobox Produkt\n|Titel=Ganz neues Abenteuer\n|Art=Soloabenteuer\n|Ort=[[Gareth]]\n}}",
    },
    { titel: "Ohne Orte", ns: 0, text: "{{Infobox Produkt\n|Titel=Ohne Orte\n|Art=Spielhilfe\n|Thema=Regeln\n}}" },
    { titel: "Grundregeln", ns: 0, text: "{{Infobox Produkt\n|Titel=Grundregeln\n|Art=Regelband\n|Ort=[[Gareth]]\n}}" },
    {
        titel: "DSK:Neues DSK-Abenteuer",
        ns: 218,
        text: "{{Infobox Produkt\n|Titel=Neues DSK-Abenteuer\n|Art=Kurzabenteuer\n|Ort=[[Gareth]]\n}}",
    },
];

/** Eine Zeile der Ortsliste: Stelle, Name, Rolle, Herkunft (`legacy_origin`), Zustand, wer sie anlegte; die Ortslisten der Welt gleichen dem Wiki, bis ein Test sie ändert. */
type Ort = [
    number,
    string,
    string,
    ("wiki" | "manual" | "unknown")?,
    ("active" | "suppressed")?,
    ("legacy" | "editor")?,
];

async function legeOrteAn(db: Database, werk: string, orte: readonly Ort[]): Promise<void> {
    for (const [stelle, name, rolle, herkunft = "unknown", zustand = "active", system = "legacy"] of orte) {
        const aktiv = zustand === "active";
        await db`
            INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, legacy_origin, state, is_active,
                                         retired_at, retired_origin, source_system, target_origin)
            SELECT id, ${stelle}, ${stelle}, lower(btrim(${name})), ${name}, ${rolle}, 'unresolved', ${herkunft}, ${zustand}, ${aktiv},
                   ${aktiv ? null : new Date().toISOString()}, ${aktiv ? null : "editor"}, ${system}, ${system === "editor" ? "editor" : "legacy_import"}
              FROM adventure WHERE public_id = ${werk}::uuid
        `;
    }
}

/** Die Werke der Welt: (Kennung, Titel, Art, Adresse, Spalten, Vermerke je Feld, Herkunft des Werks). */
async function legeWerkeAn(db: Database): Promise<void> {
    const werk = async (
        id: string,
        titel: string,
        art: string,
        adresse: string | null,
        spalten: Record<string, string | null>,
        vermerke: Record<string, "wiki" | "manual"> = {},
        herkunft: "legacy" | "editor" = "legacy",
    ): Promise<void> => {
        const [zeile] = await db<{ id: string }[]>`
            INSERT INTO adventure (public_id, title, product_type, is_official, wiki_url, edition, genre, complexity_gm, complexity_pl, authors, series,
                                   fshop_code, source_system)
            VALUES (${id}::uuid, ${titel}, ${art}, TRUE, ${adresse}, ${spalten["edition"] ?? null}, ${spalten["genre"] ?? null},
                    ${spalten["complexity_gm"] ?? null}, ${spalten["complexity_pl"] ?? null}, ${spalten["authors"] ?? null}, ${spalten["series"] ?? null},
                    ${spalten["fshop_code"] ?? null}, ${herkunft})
            RETURNING id::text AS id
        `;
        for (const [feld, origin] of Object.entries(vermerke)) {
            await db`INSERT INTO adventure_field_origin (adventure_id, field, origin) VALUES (${zeile!.id}::bigint, ${feld}, ${origin})`;
        }
    };
    // Siegelbruch: Regeln folgen dem Wiki (Vermerk wiki, Wiki gleich), Genre mit Vermerk wiki weicht ab (übernehmen), KompM ohne Vermerk weicht ab (Befund),
    // KompSp eigener Wert (manual, bleibt), Autoren leer (füllen), Reihe leer (füllen).
    await werk(
        ID.siegelbruch,
        "Siegelbruch",
        "gruppenabenteuer",
        wiki("Siegelbruch"),
        { edition: "DSA5", genre: "Forschungsabenteuer", complexity_gm: "mittel", complexity_pl: "leicht" },
        { edition: "wiki", genre: "wiki", complexity_pl: "manual" },
    );
    // Rabengruft: alles gleich bis auf die Autoren (leer → füllen).
    await werk(ID.rabengruft, "Rabengruft", "gruppenabenteuer", wiki("Rabengruft"), {
        edition: "DSA4.1",
        genre: "Horror",
    });
    // Ein Werk im Namensraum DSK (Kanon offiziell, Einsammeln nein): wird trotzdem verknüpft; der Titel ohne Vermerk weicht ab (Befund).
    await werk(ID.dunkelheit, "DSK:Endlose Dunkelheit", "kurzabenteuer", wiki("DSK:Endlose Dunkelheit"), {});
    // Ein Werk der Redaktion: nichts wird angefasst, auch kein leeres Feld.
    await werk(ID.redaktion, "Im Auftrag der Redaktion", "roman", wiki("Im Auftrag der Redaktion"), {}, {}, "editor");
    // Ein Werk, dessen Artikel im Dump fehlt, und eines, dessen Artikel umgeleitet ist.
    await werk(ID.verschwunden, "Verschwunden", "roman", wiki("Verschwunden"), {});
    await werk(ID.umgezogen, "Alter Titel", "roman", wiki("Alter Titel"), {});
    // Eine Regionalspielhilfe ohne Vermerk, deren Werte dem Wiki gleichen: keine Zeile.
    await werk(ID.bornland, "Das Bornland", "regionalspielhilfe", wiki("Das Bornland"), {});
    // Die Ortslisten gleichen dem Wiki (ohne belegte Herkunft, wie im öffentlichen Katalog): keine Zeile, bis ein Test sie ändert.
    await legeOrteAn(db, ID.siegelbruch, [
        [0, "Mittelreich", "start"],
        [1, "Gareth", "play"],
    ]);
    await legeOrteAn(db, ID.rabengruft, [[0, "Punin", "start"]]);
    await legeOrteAn(db, ID.dunkelheit, [[0, "Gareth", "start"]]);
    await legeOrteAn(db, ID.redaktion, [[0, "Ferdok", "start"]]);
    await legeOrteAn(db, ID.bornland, [
        [0, "Bornland", "covers"],
        [1, "Festum", "covers"],
    ]);
}

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

describeWithCluster("WikiSync Literatur: Verknüpfung, Übernahme und Rücknahme der Werke (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["literatur"] }), {
            environment: umgebung,
            ladeZuweisungen: () => ladeZuweisungen(jobs()),
            ladeTafel: async () => {
                const stand = await leseNamespaceTafel(jobs());
                return {
                    revision: stand.revision,
                    quelle: stand.revision === null ? "vorgabe" : "datenbank",
                    namensraeume: stand.namensraeume,
                };
            },
            ablage,
        });
        return (ergebnis["lauf"] as { id: number }).id;
    }

    type Ergebnis = {
        bereiche: {
            status: string;
            grund?: string;
            operationId?: string | null;
            zahlen?: Record<string, number>;
            uebernahme: number | null;
        }[];
    };
    const uebernehmen = async (): Promise<Ergebnis> =>
        (await runWikiUebernehmenJob(kontext({ bereiche: ["literatur"] }), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;

    async function zuruecknehmen(
        lauf: number,
        uebernahme: number,
    ): Promise<{ status: string; zahlen: Record<string, number> }> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_zuruecknehmen', 1::smallint, 'aventuria', 'cli:test', '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "literatur", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;
    }

    const werk = async (id: string): Promise<Record<string, unknown>> =>
        (
            await wert<Record<string, unknown>>(
                `SELECT title, product_type, edition, genre, complexity_gm, complexity_pl, authors, series, fshop_code, wiki_url, source_system,
                        revision::int AS revision,
                        (SELECT coalesce(jsonb_object_agg(o.field, o.origin), '{}'::jsonb) FROM adventure_field_origin o WHERE o.adventure_id = a.id) AS vermerke
                   FROM adventure a WHERE public_id = '${id}'`,
            )
        )[0]!;

    async function neueWelt(): Promise<void> {
        await admin()`
            TRUNCATE map_audit_event, map_operation, wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting,
                     adventure_field_origin, adventure_place, adventure_link, adventure_media, adventure
            RESTART IDENTITY CASCADE
        `;
        await admin()`UPDATE wikisync_bereich_state SET revision = 1`;
        await admin()`DELETE FROM job`;
        await legeWerkeAn(admin());
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-literatur");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeWikisyncBereiche: () => wikisyncBereiche(j),
            schreibe: (eingabe) => schreibeLauf(j, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
    }, 240_000);
    afterAll(async () => {
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    it("🔴 Verknüpfung: jedes Werk über seine Adresse (auch in DSK), Befunde für fehlende und umgeleitete Artikel, ein Artikel ohne Werk ist ein Befund und wird nicht angelegt", async () => {
        await neueWelt();
        const laufId = await vorschau();
        const [lauf] = await wert<{ zahlen: Record<string, Record<string, number>> }>(
            `SELECT zahlen FROM wikisync_lauf WHERE id = ${String(laufId)}`,
        );
        expect(lauf!.zahlen["literatur"]).toMatchObject({
            objekte: 7,
            mitAdresse: 7,
            gefunden: 5,
            umgeleitet: 1,
            nichtImDump: 1,
            // „Ganz neues Abenteuer“ und das Ziel der Umleitung („Neuer Titel“, die Adresse des Werks ist veraltet); ohne Ortsliste, ein Regelband und ein Artikel in DSK
            // (Einsammeln: nein) zählen nicht.
            neueArtikel: 2,
        });
        const befunde = await wert<{
            objekt_id: string | null;
            objekt_name: string;
            befund: string;
            objekt_art: string;
        }>(
            `SELECT objekt_id::text, objekt_name, befund, objekt_art FROM wikisync_lauf_zeile
              WHERE lauf_id = ${String(laufId)} AND bereich = 'literatur' AND feld IS NULL ORDER BY objekt_name`,
        );
        expect(befunde).toEqual([
            { objekt_id: ID.umgezogen, objekt_name: "Alter Titel", befund: "umleitung", objekt_art: "work" },
            { objekt_id: null, objekt_name: "Ganz neues Abenteuer", befund: "neuer_artikel", objekt_art: "article" },
            { objekt_id: null, objekt_name: "Neuer Titel", befund: "neuer_artikel", objekt_art: "article" },
            {
                objekt_id: ID.verschwunden,
                objekt_name: "Verschwunden",
                befund: "artikel_nicht_im_dump",
                objekt_art: "work",
            },
        ]);
        // Angelegt wird nichts.
        expect(await zahl(`SELECT count(*)::int AS n FROM adventure`)).toBe(7);
    });

    it("🔴 Übernahme: Vermerk „wiki“ folgt dem Wiki, leere Felder werden gefüllt (mit Vermerk), ein Wert ohne Vermerk bleibt ein Befund, ein eigener Wert und ein Werk der Redaktion bleiben; Rücknahme", async () => {
        await neueWelt();
        const laufId = await vorschau();
        const zeilen = await wert<{ objekt_id: string; feld: string; eigentuemer: string; wirkung: string }>(
            `SELECT objekt_id::text, feld, eigentuemer, wirkung FROM wikisync_lauf_zeile
              WHERE lauf_id = ${String(laufId)} AND bereich = 'literatur' AND feld IS NOT NULL ORDER BY id`,
        );
        const von = (id: string): string[][] =>
            zeilen
                .filter((zeile) => zeile.objekt_id === id)
                .map((zeile) => [zeile.feld, zeile.eigentuemer, zeile.wirkung]);
        expect(von(ID.siegelbruch)).toEqual([
            ["genre", "wiki", "uebernommen"],
            ["complexity_gm", "unbekannt", "befund"],
            ["complexity_pl", "manual", "eigen"],
            ["authors", "wiki", "uebernommen"],
            ["series", "wiki", "uebernommen"],
        ]);
        expect(von(ID.rabengruft)).toEqual([["authors", "wiki", "uebernommen"]]);
        expect(von(ID.dunkelheit)).toEqual([
            ["title", "unbekannt", "befund"],
            ["authors", "wiki", "uebernommen"],
        ]);
        // Das Werk der Redaktion: jede Abweichung ist eine eigene Entscheidung, auch das leere Feld.
        expect(von(ID.redaktion)).toEqual([
            ["title", "manual", "eigen"],
            ["authors", "manual", "eigen"],
        ]);
        expect(von(ID.bornland)).toEqual([]);

        const vorher = {
            siegelbruch: await werk(ID.siegelbruch),
            rabengruft: await werk(ID.rabengruft),
            dunkelheit: await werk(ID.dunkelheit),
            redaktion: await werk(ID.redaktion),
            bornland: await werk(ID.bornland),
        };
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(ergebnis.bereiche[0]!.zahlen!["felder"]).toBe(5);
        const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

        expect(await werk(ID.siegelbruch)).toMatchObject({
            title: "Siegelbruch",
            edition: "DSA5",
            genre: "Mysterienabenteuer",
            complexity_gm: "mittel",
            complexity_pl: "leicht",
            authors: "Hans Mustermann",
            series: "Dämonenmacht & Sternenkraft",
            vermerke: { edition: "wiki", genre: "wiki", complexity_pl: "manual", authors: "wiki", series: "wiki" },
            revision: (vorher.siegelbruch["revision"] as number) + 1,
            wiki_url: vorher.siegelbruch["wiki_url"],
            source_system: "legacy",
        });
        expect(await werk(ID.rabengruft)).toMatchObject({ authors: "Tara Flink", vermerke: { authors: "wiki" } });
        expect(await werk(ID.dunkelheit)).toMatchObject({ title: "DSK:Endlose Dunkelheit", authors: "Ein Autor" });
        // 🔴 Eigener Wert bleibt: Das Werk der Redaktion ist unberührt, samt Revision; ebenso das gleiche Bornland.
        expect(await werk(ID.redaktion)).toEqual(vorher.redaktion);
        expect(await werk(ID.bornland)).toEqual(vorher.bornland);

        // Eine Operation der Quelle wikisync mit einem Eintrag je Werk; keine Ableitung.
        const [op] = await wert<{ source: string; action: string; operation_id: string }>(
            `SELECT source, action, operation_id::text FROM map_operation ORDER BY seq DESC LIMIT 1`,
        );
        expect(op).toMatchObject({ source: "wikisync", action: "wikisync.uebernehmen" });
        const eintraege = await wert<{ werk: string; changes: Record<string, { before: unknown; after: unknown }> }>(
            `SELECT work_public_id::text AS werk, changes FROM map_audit_event
              WHERE operation_id = '${op!.operation_id}' AND action = 'work.wikisync_uebernommen' ORDER BY work_public_id`,
        );
        expect(eintraege.map((eintrag) => eintrag.werk)).toEqual([ID.siegelbruch, ID.rabengruft, ID.dunkelheit]);
        expect(eintraege[0]!.changes).toEqual({
            genre: { before: "Forschungsabenteuer", after: "Mysterienabenteuer" },
            authors: { before: null, after: "Hans Mustermann" },
            series: { before: null, after: "Dämonenmacht & Sternenkraft" },
        });
        expect(
            await zahl(`SELECT count(*)::int AS n FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%'`),
        ).toBe(0);

        // Der zweite Lauf ändert nichts.
        await vorschau();
        const noch = await uebernehmen();
        expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

        // Rücknahme: Die Rabengruft hat seitdem jemand von Hand geändert (bleibt, Befund); an der Dunkelheit gehört das Feld jetzt der Redaktion (bleibt, Befund).
        await admin()`UPDATE adventure SET authors = 'Von Hand' WHERE public_id = ${ID.rabengruft}::uuid`;
        await admin()`
            UPDATE adventure_field_origin SET origin = 'manual'
             WHERE adventure_id = (SELECT id FROM adventure WHERE public_id = ${ID.dunkelheit}::uuid) AND field = 'authors'
        `;
        const rueck = await zuruecknehmen(laufId, uebernahmeId);
        expect(rueck.status).toBe("fertig");
        expect(await werk(ID.siegelbruch)).toMatchObject({
            genre: "Forschungsabenteuer",
            authors: null,
            series: null,
            complexity_pl: "leicht",
        });
        expect(await werk(ID.rabengruft)).toMatchObject({ authors: "Von Hand" });
        expect(await werk(ID.dunkelheit)).toMatchObject({ authors: "Ein Autor" });
        const rueckBefunde = await wert<{ objekt_id: string; feld: string; befund: string; objekt_art: string }>(
            `SELECT objekt_id::text, feld, befund, objekt_art FROM wikisync_uebernahme_befund
              WHERE uebernahme_id <> ${String(uebernahmeId)} AND befund = 'seit_uebernahme_geaendert' ORDER BY objekt_id`,
        );
        expect(rueckBefunde).toEqual([
            { objekt_id: ID.rabengruft, feld: "authors", befund: "seit_uebernahme_geaendert", objekt_art: "work" },
            { objekt_id: ID.dunkelheit, feld: "authors", befund: "seit_uebernahme_geaendert", objekt_art: "work" },
        ]);
    });

    it("🔴 Legacy-Zug: Gehört die Literatur dem WikiSync, lässt I20 sie aus (nichts gelesen, nichts geschrieben, ein Befund)", async () => {
        await neueWelt();
        const vorher = await werk(ID.siegelbruch);
        const bericht = await importLiterature(admin(), {
            ok: true,
            adventures_enabled: true,
            adventures: [{ public_id: ID.siegelbruch, title: "Vom Zug", product_type: "roman", places: [], links: [] }],
        });
        expect(bericht.skipped).toBe(true);
        expect(bericht.findings.map((befund) => befund.code)).toEqual(["bereich_wikisync"]);
        expect(await werk(ID.siegelbruch)).toEqual(vorher);
        expect(await zahl(`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'literature'`)).toBe(0);
    });

    it("🔴 Rechte: Die Jobs-Rolle schreibt am Werk nur die Felder des Abgleichs, nie Zuordnung oder Herkunft, löscht keinen Vermerk und keinen Ort", async () => {
        await neueWelt();
        const codes = await cluster!.codesAs(jobs(), [
            `UPDATE adventure SET wiki_url = 'https://de.wiki-aventurica.de/wiki/X' WHERE public_id = '${ID.rabengruft}'`,
            `UPDATE adventure SET wiki_key = 'x' WHERE public_id = '${ID.rabengruft}'`,
            `UPDATE adventure SET source_system = 'editor' WHERE public_id = '${ID.rabengruft}'`,
            `UPDATE adventure_place SET name_key = 'x'`,
            `UPDATE adventure_place SET target_origin = 'editor'`,
            `DELETE FROM adventure_place`,
            `DELETE FROM adventure_field_origin`,
            `UPDATE adventure SET authors = 'ok' WHERE public_id = '${ID.rabengruft}'`,
            `UPDATE adventure_place SET role = role`,
        ]);
        expect(codes).toEqual(["42501", "42501", "42501", "42501", "42501", "42501", "42501", "ok", "ok"]);
    });

    it("🔴 Ortsliste: Zeilen des Wikis folgen dem Artikel (umbenannt, entfallen, neu mit Ziel über X2, Rolle), Zeilen der Redaktion, unbelegte Zeilen und Tombstones bleiben; Rücknahme", async () => {
        await neueWelt();
        // Das Ziel eines neuen Orts: ein Ort der Karte mit dem Schlüssel seines Artikels in der Zuordnung X2.
        const GARETH = "b0000000-0000-4000-9000-000000000001";
        await admin()`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
            VALUES (${GARETH}::uuid, 'aventuria', 'Gareth', 'metropole', ST_SetSRID(ST_MakePoint(10, 120), 0))
            ON CONFLICT DO NOTHING
        `;
        await admin()`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns)
            VALUES ('siedlung', ${GARETH}::uuid, 'wiki:gareth', ${wiki("Gareth")}, 'Gareth', 0)
            ON CONFLICT DO NOTHING
        `;
        await admin()`DELETE FROM adventure_place`;
        // Siegelbruch (Wiki: Mittelreich, Gareth): Stelle 1 heißt im Werk „Garet“ (umbenennen), Ulva an Stelle 2 nennt das Wiki nicht mehr (still legen), der eigene Ort
        // der Redaktion an Stelle 3 bleibt unsichtbar stehen.
        await legeOrteAn(admin(), ID.siegelbruch, [
            [0, "Mittelreich", "start", "wiki"],
            [1, "Garet", "play", "wiki"],
            [2, "Ulva", "play", "wiki"],
            [3, "Eigener Ort", "play", "manual"],
        ]);
        // Rabengruft (Wiki: Punin): Bethana ohne belegte Herkunft nennt das Wiki nicht: ein Befund, sie bleibt.
        await legeOrteAn(admin(), ID.rabengruft, [
            [0, "Punin", "start"],
            [1, "Bethana", "play"],
        ]);
        // Endlose Dunkelheit (Wiki: Gareth): ohne Ort; Gareth kommt neu, mit dem Ort der Karte als Ziel.
        // Das Werk der Redaktion (Wiki: Ferdok) führt einen eigenen Ort: eigen.
        await legeOrteAn(admin(), ID.redaktion, [[0, "Anderer Ort", "start", "manual", "active", "editor"]]);
        // Das Bornland (Wiki: Bornland, Festum; Regionalspielhilfe): die Rolle wird „covers“; Festum hat die Redaktion aus der Liste genommen (Tombstone).
        await legeOrteAn(admin(), ID.bornland, [
            [0, "Bornland", "start", "wiki"],
            [9, "Festum", "covers", "wiki", "suppressed"],
        ]);

        const laufId = await vorschau();
        const zeilen = await wert<{
            objekt_id: string;
            feld: string;
            alt: string | null;
            neu: string | null;
            eigentuemer: string;
            wirkung: string;
            status: string;
        }>(
            `SELECT objekt_id::text, feld, alt, neu, eigentuemer, wirkung, status FROM wikisync_lauf_zeile
              WHERE lauf_id = ${String(laufId)} AND bereich = 'literatur' AND feld LIKE 'ort\\_%' ORDER BY id`,
        );
        const von = (id: string): string[][] =>
            zeilen
                .filter((zeile) => zeile.objekt_id === id)
                .map((zeile) => [
                    zeile.feld,
                    zeile.alt ?? "-",
                    zeile.neu ?? "-",
                    zeile.eigentuemer,
                    zeile.wirkung,
                    zeile.status,
                ]);
        expect(von(ID.siegelbruch)).toEqual([
            ["ort_1", "Garet (play)", "Gareth (play)", "wiki", "uebernommen", "geaendert"],
            ["ort_2", "Ulva (play)", "-", "wiki", "uebernommen", "zu_entfernen"],
        ]);
        expect(von(ID.rabengruft)).toEqual([["ort_1", "Bethana (play)", "-", "unbekannt", "befund", "zu_entfernen"]]);
        expect(von(ID.dunkelheit)).toEqual([["ort_0", "-", "Gareth (start)", "wiki", "uebernommen", "neu"]]);
        expect(von(ID.redaktion)).toEqual([
            ["ort_0", "Anderer Ort (start)", "Ferdok (start)", "manual", "eigen", "geaendert"],
        ]);
        expect(von(ID.bornland)).toEqual([
            ["ort_0", "Bornland (start)", "Bornland (covers)", "wiki", "uebernommen", "geaendert"],
            ["ort_1", "-", "Festum (covers)", "unterdrueckt", "befund", "unterdrueckt"],
        ]);

        const revision = async (id: string): Promise<number> => (await werk(id))["revision"] as number;
        const vorher = { bornland: await revision(ID.bornland), redaktion: await werk(ID.redaktion) };
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(ergebnis.bereiche[0]!.zahlen!["liste"]).toBe(4);
        const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

        type Platz = {
            name: string;
            stelle: number;
            rolle: string;
            zustand: string;
            herkunft: string;
            system: string;
            stillgelegt: string | null;
            ziel: string;
            place: string | null;
        };
        const orte = async (id: string): Promise<Platz[]> =>
            wert<Platz>(
                `SELECT p.raw_name AS name, p.sort_order AS stelle, p.role AS rolle, p.state AS zustand, p.legacy_origin AS herkunft, p.source_system AS system,
                        p.retired_origin AS stillgelegt, p.target_state || coalesce('/' || p.resolved_by, '') AS ziel, pl.public_id::text AS place
                   FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id LEFT JOIN place pl ON pl.id = p.place_id
                  WHERE a.public_id = '${id}' ORDER BY p.sort_order, p.id`,
            );
        expect(await orte(ID.siegelbruch)).toEqual([
            expect.objectContaining({ name: "Mittelreich", stelle: 0, zustand: "active" }),
            expect.objectContaining({ name: "Garet", stelle: 1, zustand: "retired", stillgelegt: "wikisync" }),
            {
                name: "Gareth",
                stelle: 1,
                rolle: "play",
                zustand: "active",
                herkunft: "wiki",
                system: "wikisync",
                stillgelegt: null,
                ziel: "resolved/wiki_key",
                place: GARETH,
            },
            expect.objectContaining({ name: "Ulva", stelle: 2, zustand: "retired", stillgelegt: "wikisync" }),
            expect.objectContaining({ name: "Eigener Ort", stelle: 3, zustand: "active", herkunft: "manual" }),
        ]);
        expect((await orte(ID.rabengruft)).map((ort) => [ort.name, ort.zustand])).toEqual([
            ["Punin", "active"],
            ["Bethana", "active"],
        ]);
        expect(await orte(ID.dunkelheit)).toEqual([
            {
                name: "Gareth",
                stelle: 0,
                rolle: "start",
                zustand: "active",
                herkunft: "wiki",
                system: "wikisync",
                stillgelegt: null,
                ziel: "resolved/wiki_key",
                place: GARETH,
            },
        ]);
        // 🔴 Die Zeile der Redaktion und ihr Werk: unberührt, samt Revision.
        expect(await werk(ID.redaktion)).toEqual(vorher.redaktion);
        expect((await orte(ID.redaktion)).map((ort) => [ort.name, ort.zustand])).toEqual([["Anderer Ort", "active"]]);
        // 🔴 Der Tombstone lebt nicht wieder auf; die Rolle ändert sich an Ort und Stelle, und das Werk bekommt eine neue Revision (ein offener Entwurf 409).
        expect((await orte(ID.bornland)).map((ort) => [ort.name, ort.rolle, ort.zustand])).toEqual([
            ["Bornland", "covers", "active"],
            ["Festum", "covers", "suppressed"],
        ]);
        expect(await revision(ID.bornland)).toBe(vorher.bornland + 1);

        // Das Fachprotokoll trägt die Liste vorher und nachher wie der Editor (`places`).
        const [eintrag] = await wert<{
            changes: Record<
                string,
                { before: { name: string; role: string }[]; after: { name: string; role: string }[] }
            >;
        }>(
            `SELECT changes FROM map_audit_event WHERE action = 'work.wikisync_uebernommen' AND work_public_id = '${ID.siegelbruch}'`,
        );
        expect(eintrag!.changes["places"]!.before.map((ort) => ort.name)).toEqual([
            "Mittelreich",
            "Garet",
            "Ulva",
            "Eigener Ort",
        ]);
        expect(eintrag!.changes["places"]!.after.map((ort) => ort.name)).toEqual([
            "Mittelreich",
            "Gareth",
            "Eigener Ort",
        ]);

        // Der zweite Lauf ändert nichts.
        await vorschau();
        expect((await uebernehmen()).bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

        // Rücknahme: Den neuen Ort der Dunkelheit hat die Redaktion seitdem anders eingeordnet (bleibt, Befund); alles andere kehrt zurück.
        await admin()`
            UPDATE adventure_place SET role = 'play'
             WHERE adventure_id = (SELECT id FROM adventure WHERE public_id = ${ID.dunkelheit}::uuid) AND raw_name = 'Gareth'
        `;
        const rueck = await zuruecknehmen(laufId, uebernahmeId);
        expect(rueck.status).toBe("fertig");
        expect((await orte(ID.siegelbruch)).map((ort) => [ort.name, ort.zustand])).toEqual([
            ["Mittelreich", "active"],
            ["Garet", "active"],
            ["Gareth", "retired"],
            ["Ulva", "active"],
            ["Eigener Ort", "active"],
        ]);
        expect((await orte(ID.bornland)).map((ort) => [ort.name, ort.rolle, ort.zustand])).toEqual([
            ["Bornland", "start", "active"],
            ["Festum", "covers", "suppressed"],
        ]);
        expect((await orte(ID.dunkelheit)).map((ort) => [ort.name, ort.rolle, ort.zustand])).toEqual([
            ["Gareth", "play", "active"],
        ]);
        const rueckBefunde = await wert<{ objekt_id: string; feld: string; befund: string }>(
            `SELECT objekt_id::text, feld, befund FROM wikisync_uebernahme_befund
              WHERE uebernahme_id <> ${String(uebernahmeId)} AND befund = 'seit_uebernahme_geaendert' ORDER BY objekt_id`,
        );
        expect(rueckBefunde).toEqual([
            { objekt_id: ID.dunkelheit, feld: "places", befund: "seit_uebernahme_geaendert" },
        ]);
    });
});
