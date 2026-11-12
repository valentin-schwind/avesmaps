import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capabilitiesFor, wikiNamespaceTafel, type KanonObjektart } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { KANON_TRAEGER } from "../src/kanon/laden.ts";
import { berechneKanonNeu, KANON_ABGELEITET_VON, type KanonNeuBericht } from "../src/kanon/neu-berechnen.ts";
import { aendereKanonTafel, leseKanonTafel } from "../src/kanon/tafel.ts";
import { readCanon } from "../src/subjects/carrier-tables.ts";
import { readSubjectRevision } from "../src/subjects/revision.ts";
import { cleanP3Fixtures, insertP3Carriers, p3Id, P3, P3_MAP_DOMAIN, type P3Ids } from "./support/p3-fixture.ts";

/**
 * „Kanon neu berechnen“ gegen echtes PostgreSQL (WI-0253 B-2): Rang 1 bis 3 geschrieben, Idempotenz, der Vergleich mit einem nachgestellten
 * Legacy-Import (das Orakel im Kleinen; die Messung am echten Bestand steht in `kanon-orakel.test.ts`) und Rang 4 beim Lesen.
 *
 * Eigene Träger mit dem Präfix `63000000-` (`p3-fixture.ts`); die Rechnung läuft nur über sie (`nur`), damit sie fremde Träger der gemeinsamen
 * Testdatenbank nie anfasst.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const WEGEXTRA = p3Id(70);
const ORT_PUBLIKATION = p3Id(71);
const HAUPT = "https://de.wiki-aventurica.de/wiki/P3T_Haupt";
const FAN = "https://de.wiki-aventurica.de/wiki/Inoffiziell:P3T_Fan";

type Zeile = [string, string | null, number | null, string | null];

describeWithDatabase("Kanon neu berechnen (Migration 0223)", { timeout: 60_000 }, () => {
    let database: Database;
    let ids: P3Ids;
    let nur: Set<string>;
    const akteur = { personId: null, label: "test:kanon", capabilities: capabilitiesFor("admin") };

    async function quelle(titel: string, art: string, offiziell: boolean): Promise<string> {
        const url = `https://p3test.example/kanon/${titel.replaceAll(" ", "-")}`;
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
            VALUES ('url:' || encode(sha256(convert_to(${url}, 'UTF8')), 'hex'), 'final', ${url}, ${titel}, ${art}, ${offiziell})
            RETURNING id::text
        `;
        return zeile!.id;
    }

    async function verweis(
        art: KanonObjektart,
        traeger: string,
        quelleId: string,
        publikation: boolean,
    ): Promise<void> {
        const tabellen = KANON_TRAEGER[art];
        await database.unsafe(
            `INSERT INTO ${tabellen.verweis} (${tabellen.fremdschluessel}, source_id, reference_kind, position)
             VALUES ($1::bigint, $2::bigint, $3, 0)`,
            [ids[traeger]!, quelleId, publikation ? "ausfuehrlich" : null],
        );
    }

    async function zuweisung(tabelle: "place" | "path" | "powerline", traeger: string, url: string): Promise<void> {
        const rolle = tabelle === "path" ? "'main'," : "";
        const spalte = tabelle === "path" ? "path_id, role," : `${tabelle}_id,`;
        await database.unsafe(
            `INSERT INTO ${tabelle}_wiki_assignment (${spalte} wiki_url, assignment_state, assignment_origin)
             VALUES ($1::bigint, ${rolle} $2, 'address_only', 'editor')`,
            [ids[traeger]!, url],
        );
    }

    async function aufbauen(): Promise<void> {
        ids = await insertP3Carriers(database);
        // Zwei Träger mehr: ein Abschnitt in der Gruppe von `weg` und ein Ort mit offizieller Publikation neben einer inoffiziellen Quelle.
        const extra = async (publicId: string, art: "path" | "place"): Promise<void> => {
            const [zeile] =
                art === "path"
                    ? await database<{ id: string }[]>`
                        INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                        VALUES (${publicId}, ${P3_MAP_DOMAIN}, 'P3T Weg Eins', 'Strasse', FALSE,
                                ST_SetSRID(ST_MakeLine(ST_MakePoint(300, 330), ST_MakePoint(310, 330)), 0), 'test', TRUE)
                        RETURNING id::text`
                    : await database<{ id: string }[]>`
                        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                        VALUES (${publicId}, ${P3_MAP_DOMAIN}, 'P3T Ort Publikation', 'dorf', ST_SetSRID(ST_MakePoint(304, 300), 0), 'test', TRUE)
                        RETURNING id::text`;
            ids[publicId] = zeile!.id;
        };
        await extra(WEGEXTRA, "path");
        await extra(ORT_PUBLIKATION, "place");
        nur = new Set([...Object.values(P3), WEGEXTRA, ORT_PUBLIKATION]);

        const regelbuch = await quelle("P3T Regelbuch", "regelbuch", true);
        const briefspiel = await quelle("P3T Briefspiel", "briefspiel", false);
        const roman = await quelle("P3T Roman", "roman", false);
        const bote = await quelle("P3T Bote", "aventurischer_bote", true);
        const heft = await quelle("P3T Heft", "briefspiel", false);

        // Orte: Hauptraum gegen eine inoffizielle Quelle; Inoffiziell gegen eine offizielle; nur eine offizielle Quelle; nur eine inoffizielle
        // Publikation; offizielle Publikation neben einer inoffiziellen Quelle.
        await zuweisung("place", P3.ort, HAUPT);
        await verweis("place", P3.ort, briefspiel, false);
        await zuweisung("place", P3.ortZwei, FAN);
        await verweis("place", P3.ortZwei, regelbuch, false);
        await verweis("place", P3.ortLeer, regelbuch, false);
        await verweis("place", P3.ortAdresse, heft, true);
        await verweis("place", ORT_PUBLIKATION, briefspiel, false);
        await verweis("place", ORT_PUBLIKATION, bote, true);
        // Wege: eine Gruppe aus zwei Abschnitten, der zweite erbt; zwei andere Wege ohne alles.
        await zuweisung("path", P3.weg, HAUPT);
        // Kraftlinie im Raum Inoffiziell; Gebiet nur mit einem Schlüssel (Eigenkennung) und einer inoffiziellen Quelle; Landschaft mit Adresse
        // gegen eine, die nur eine Publikation hat.
        await zuweisung("powerline", P3.kraftlinie, FAN);
        await database`UPDATE territory SET wiki_key = 'wiki:p3t-eigen', wiki_url = NULL WHERE public_id = ${P3.gebiet}::uuid`;
        await verweis("territory", P3.gebiet, roman, false);
        await database`UPDATE region SET wiki_url = ${HAUPT} WHERE public_id = ${P3.region}::uuid`;
        await verweis("area", P3.regionZwei, bote, true);
    }

    async function zeilen(art: KanonObjektart): Promise<Map<string, Zeile>> {
        const tabellen = KANON_TRAEGER[art];
        const rows = await database.unsafe<
            { p: string; canon: string; t: string | null; c: number | null; l: string | null }[]
        >(
            `SELECT c.public_id::text AS p, k.canon, k.designator_type AS t, k.designator_count AS c, k.designator_label AS l
               FROM ${tabellen.kanon} k JOIN ${tabellen.traeger} c ON c.id = k.${tabellen.fremdschluessel}
              WHERE c.public_id::text LIKE '63000000-%'`,
        );
        return new Map(rows.map((r) => [r.p, [r.canon, r.t, r.c, r.l]]));
    }

    const rechne = (schreiben: boolean, regelstand: "avesmaps" | "legacy" = "avesmaps"): Promise<KanonNeuBericht> =>
        berechneKanonNeu(database, { schreiben, regelstand, nur, tafel: wikiNamespaceTafel() });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });
    afterAll(async () => {
        await cleanP3Fixtures(database);
        await database`DELETE FROM migration_run WHERE data_domain = 'kanon-ableitung' AND source_ref LIKE 'tafel_revision=%'`;
        await database`DELETE FROM canon_object_label_setting`;
        await database?.end({ timeout: 5 });
    });
    beforeEach(async () => {
        await cleanP3Fixtures(database);
        await database`DELETE FROM migration_run WHERE data_domain = 'kanon-ableitung' AND source_ref LIKE 'tafel_revision=%'`;
        await database`DELETE FROM canon_object_label_setting`;
        await aufbauen();
    });

    it("🔴 schreibt Rang 1 bis 3: Hauptraum, 222, nur offizielle Quelle, Publikation, Eigenkennung, Gruppe, Landschaft", async () => {
        const bericht = await rechne(true);
        expect(bericht.runId).toMatch(/^[0-9a-f-]{36}$/u);
        const orte = await zeilen("place");
        expect(orte.get(P3.ort)).toEqual(["official", null, null, null]);
        expect(orte.get(P3.ortZwei)).toEqual(["unofficial", null, null, "Wiki Aventurica"]);
        expect(orte.get(P3.ortLeer)).toEqual(["official", "regelbuch", null, null]);
        // Nur eine inoffizielle Publikation: Seit 2026-10-25 zählt sie ohne Wiki wie eine Quelle.
        expect(orte.get(P3.ortAdresse)).toEqual(["unofficial", "briefspiel", null, null]);
        // Eine offizielle Publikation neben einer inoffiziellen Quelle macht den Ort offiziell, mit der Art der Zählenden.
        expect(orte.get(ORT_PUBLIKATION)).toEqual(["official", "aventurischer_bote", null, null]);
        const wege = await zeilen("path");
        expect(wege.get(P3.weg)).toEqual(["official", null, null, null]);
        // 🔴 Der zweite Abschnitt der Gruppe erbt den Raum (Legacy: ein Fluss ist ein Ding), obwohl er nichts trägt.
        expect(wege.get(WEGEXTRA)).toEqual(["official", null, null, null]);
        expect(wege.has(P3.wegZwei)).toBe(false);
        expect((await zeilen("powerline")).get(P3.kraftlinie)).toEqual(["unofficial", null, null, "Wiki Aventurica"]);
        // 🔴 Eine Eigenkennung ist kein Rang 1: Die inoffizielle Quelle entscheidet.
        expect((await zeilen("territory")).get(P3.gebiet)).toEqual(["unofficial", "roman", null, null]);
        const regionen = await zeilen("area");
        expect(regionen.get(P3.region)).toEqual(["official", null, null, null]);
        expect(regionen.get(P3.regionZwei)).toEqual(["official", "aventurischer_bote", null, null]);
        // Ohne alles: keine Zeile.
        expect((await zeilen("peak")).size).toBe(0);
        // Provenienz und Lauf.
        const herkunft = await database<{ derived_from: string; source_system: string; migration_run_id: string }[]>`
            SELECT derived_from, source_system, migration_run_id::text FROM place_canon
             WHERE place_id = ${ids[P3.ort]!}::bigint
        `;
        expect(herkunft[0]).toEqual({
            derived_from: KANON_ABGELEITET_VON,
            source_system: "avesmaps3d",
            migration_run_id: bericht.runId,
        });
        const [lauf] = await database<
            { status: string }[]
        >`SELECT status FROM migration_run WHERE id = ${bericht.runId}::uuid`;
        expect(lauf?.status).toBe("completed");
    });

    it("🔴 idempotent: derselbe Stand ein zweites Mal ändert nichts und schreibt keinen Lauf; ohne `schreiben` bleibt alles stehen", async () => {
        const probe = await rechne(false);
        expect(probe.runId).toBeNull();
        expect((await zeilen("place")).size).toBe(0);
        const erste = await rechne(true);
        const zweite = await rechne(true);
        expect(zweite.runId).toBeNull();
        for (const art of Object.keys(zweite.jeArt) as KanonObjektart[]) {
            expect(zweite.jeArt[art], art).toMatchObject({ neu: 0, geaendert: 0, herkunftNeu: 0, entfernt: 0 });
        }
        expect(zweite.jeArt.place.unveraendert).toBe(erste.jeArt.place.neu + erste.jeArt.place.unveraendert);
    });

    it("🔴 ein Weg, dessen Gruppe uneinig ist, erbt nichts", async () => {
        await zuweisung("path", P3.wegZwei, FAN);
        // Zwei Abschnitte desselben Namens, einmal Hauptraum, einmal Inoffiziell: der dritte bleibt ohne Etikett.
        await database`UPDATE path SET name = 'P3T Weg Eins' WHERE public_id = ${P3.wegZwei}::uuid`;
        await rechne(true);
        const wege = await zeilen("path");
        expect(wege.get(P3.weg)).toEqual(["official", null, null, null]);
        expect(wege.get(P3.wegZwei)).toEqual(["unofficial", null, null, "Wiki Aventurica"]);
        expect(wege.has(WEGEXTRA)).toBe(false);
    });

    describe("das Orakel im Kleinen: Legacys Stand nachgestellt", () => {
        /** Stellt den Import von Legacys Ergebnis nach: der Regelstand von Legacy, Herkunft `legacy_feature_kanon`, dazu `unlabelled` für Träger nur mit Publikationen. */
        async function legacyImportNachstellen(): Promise<void> {
            await rechne(true, "legacy");
            for (const art of ["place", "path", "territory", "area", "peak", "powerline"] as const) {
                const tabellen = KANON_TRAEGER[art];
                await database.unsafe(
                    `UPDATE ${tabellen.kanon} SET derived_from = 'legacy_feature_kanon', source_system = 'legacy'
                      WHERE ${tabellen.fremdschluessel} IN (SELECT id FROM ${tabellen.traeger} WHERE public_id::text LIKE '63000000-%')`,
                );
            }
            // Der Dommel-Fall: Verweise, aber nur Publikationen, steht bei Legacy als `unlabelled`.
            for (const [art, traeger] of [
                ["place", P3.ortAdresse],
                ["area", P3.regionZwei],
            ] as const) {
                const tabellen = KANON_TRAEGER[art];
                await database.unsafe(
                    `INSERT INTO ${tabellen.kanon} (${tabellen.fremdschluessel}, canon) VALUES ($1::bigint, 'unlabelled')`,
                    [ids[traeger]!],
                );
            }
        }

        it("🔴 Legacys Regelstand stimmt mit dem nachgestellten Import überein: nichts neu, nichts geändert", async () => {
            await legacyImportNachstellen();
            const bericht = await rechne(false, "legacy");
            for (const art of Object.keys(bericht.jeArt) as KanonObjektart[]) {
                expect(bericht.jeArt[art], art).toMatchObject({ neu: 0, geaendert: 0 });
            }
        });

        it("🔴 die gewollten Abweichungen des neuen Regelstands (Vali 2026-10-25) sind genau die Fälle mit Publikation und OFFIZIELL mit Art", async () => {
            await legacyImportNachstellen();
            const bericht = await rechne(false, "avesmaps");
            // Orte: `ortLeer` (OFFIZIELL trägt jetzt die Art), `ORT_PUBLIKATION` (offizielle Publikation macht offiziell: INOFFIZIELL → OFFIZIELL),
            // neu aus `unlabelled`: `ortAdresse`.
            expect(bericht.jeArt.place).toMatchObject({ geaendert: 2, neu: 1 });
            // Landschaft: `regionZwei` hatte `unlabelled`, hat jetzt ein Etikett aus ihrer Publikation.
            expect(bericht.jeArt.area).toMatchObject({ geaendert: 0, neu: 1 });
            // Alles unter Rang 1 bleibt, wie Legacy es hatte.
            for (const art of ["path", "powerline", "territory", "peak"] as const) {
                expect(bericht.jeArt[art], art).toMatchObject({ neu: 0, geaendert: 0 });
            }
        });
    });

    describe("Rang 4 beim Lesen (Tafel je Objektart der Umgebung)", () => {
        const leseGipfel = () => readCanon(database, "peak", [P3.gipfel]);
        const stelle = async (anzeigen: boolean, bezeichner = "Avesmaps"): Promise<number> => {
            const stand = await leseKanonTafel(database);
            const erg = await database.begin((tx) =>
                aendereKanonTafel(tx, {
                    aenderungen: [{ tafel: "objektart", art: "peak", zeile: { art: "peak", anzeigen, bezeichner } }],
                    baseRevision: stand.revision!,
                    actor: akteur,
                }),
            );
            return erg.revision;
        };

        it("🔴 „nein“ (Vorgabe): kein Etikett, die Zeilen bleiben, das Orakel ändert sich nicht", async () => {
            expect(await leseGipfel()).toBeUndefined();
            await rechne(true);
            expect(await leseGipfel()).toBeUndefined();
            // Der Ort mit Zeile liest seine Zeile.
            expect(await readCanon(database, "place", [P3.ort])).toEqual({ canon: "official" });
        });

        it("🔴 „ja“: INOFFIZIELL | Avesmaps für ein Objekt ohne Wiki, Quelle und Publikation; die Tafel einer anderen Art wirkt nicht", async () => {
            await stelle(true);
            expect(await leseGipfel()).toEqual({ canon: "unofficial", designatorLabel: "Avesmaps" });
            // Ohne Bezeichner: runde Pille.
            await stelle(true, "");
            expect(await leseGipfel()).toEqual({ canon: "unofficial" });
            // Andere Arten haben ihre eigene Zeile (hier die Vorgabe „nein“): Der Weg ohne alles bleibt ohne Etikett.
            expect(await readCanon(database, "path", [P3.wegDrei])).toBeUndefined();
        });

        it("🔴 Wege erben vor Rang 4: Der Abschnitt mit geerbtem Raum liest sein Etikett, nicht Rang 4", async () => {
            const stand = await leseKanonTafel(database);
            await database.begin((tx) =>
                aendereKanonTafel(tx, {
                    aenderungen: [
                        {
                            tafel: "objektart",
                            art: "path",
                            zeile: { art: "path", anzeigen: true, bezeichner: "Avesmaps" },
                        },
                    ],
                    baseRevision: stand.revision!,
                    actor: akteur,
                }),
            );
            await rechne(true);
            expect(await readCanon(database, "path", [WEGEXTRA])).toEqual({ canon: "official" });
            // Der Abschnitt ganz ohne alles bekommt dagegen Rang 4.
            expect(await readCanon(database, "path", [P3.wegDrei])).toEqual({
                canon: "unofficial",
                designatorLabel: "Avesmaps",
            });
        });

        it("🔴 ein Etikett nach Rang 1 bis 3 bleibt, und `unlabelled` (nur Publikationen, Legacys Stand) wird von Rang 4 nie überdeckt", async () => {
            await stelle(true);
            const gipfel = KANON_TRAEGER.peak;
            await database.unsafe(
                `INSERT INTO ${gipfel.kanon} (${gipfel.fremdschluessel}, canon) VALUES ($1::bigint, 'unlabelled')`,
                [ids[P3.gipfel]!],
            );
            expect(await leseGipfel()).toEqual({ canon: "unlabelled" });
            await database.unsafe(
                `UPDATE ${gipfel.kanon} SET canon = 'official' WHERE ${gipfel.fremdschluessel} = $1::bigint`,
                [ids[P3.gipfel]!],
            );
            expect(await leseGipfel()).toEqual({ canon: "official" });
        });

        it("🔴 eine Tafeländerung hebt die Leser-Revision (kein veraltetes Etikett im Speicherindex)", async () => {
            const vorher = await readSubjectRevision(database);
            expect(await readSubjectRevision(database)).toBe(vorher);
            await stelle(true);
            const nachher = await readSubjectRevision(database);
            expect(nachher).not.toBe(vorher);
            await stelle(false);
            expect(await readSubjectRevision(database)).not.toBe(nachher);
        });
    });
});
