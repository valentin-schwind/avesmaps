import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { importStaetten } from "../src/migration/staetten-import.ts";
import { cleanPlaceType, foldSettlement, transformStaetten } from "../src/migration/staetten.ts";
import { verifyStaetten } from "../src/migration/verify-staetten.ts";
import { createSubjectService, type DetailRequest, type SubjectService } from "../src/subjects/service.ts";
import { C, cleanCatalogFixtures, insertCatalogCarriers, type CatalogIds } from "./support/catalog-fixture.ts";

/**
 * Die STÄTTEN (WI-0109, Vertrag `staetten.yaml`, D7) gegen echtes PostgreSQL: der Import (neu, geändert, stillgelegt,
 * wiederaufgelebt, übersprungen) und der Lesepfad des Panels (Zahl, Gruppen nach Art, Register, Sprung, Links).
 *
 * 🔴 **Die Welt kommt aus der Catalog-Fixture** (`C68T Ort A`, `C68T Ort B`, …) und wird über den ECHTEN Import gefüllt: Damit
 * steht in `settlement_place` genau das, was der Zug schreiben würde - keine handgelegten Zeilen, die es im Betrieb nicht gäbe.
 *
 * 🔴 **Die NAMEN sind erfunden.** Legacys 4.092 Stätten sind redaktionelle Inhalte Dritter; was in den Daten steht, wird
 * gemessen und befundet, nicht in eine Fixture kopiert. Geprüft werden Regeln, nicht Inhalte - die Zahlen des Bestands stehen
 * im Work Item.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Der Ort, der Stätten trägt - sein Name ist der Schlüssel (`C68T Ort A` → `c68t ort a`). */
const ORT: DetailRequest = { kind: "place", id: C.ortA };
/** Ein Ort, der keine trägt: die Zeile entsteht dort nicht. */
const ORT_OHNE: DetailRequest = { kind: "place", id: C.ortOhneZuordnung };
/** Eine Landschaft: Stätten gibt es nur an Orten. */
const LANDSCHAFT: DetailRequest = { kind: "area", id: C.regionA };

/** Ein Eintrag der Quelle, wie `in_settlement_places` ihn trägt. */
type Entry = Record<string, unknown>;

const staette = (name: string, type: string, over: Entry = {}): Entry => ({
    name,
    settlement: "C68T Ort A",
    type,
    wiki_url: `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(name)}`,
    ...over,
});

/** Eine Nutzlast in der Form des Kartenexports. */
const payload = (entries: readonly Entry[]): unknown => ({
    ok: true,
    revision: 169042,
    in_settlement_places: [...entries],
});

/**
 * Der Satz, mit dem fast jeder Fall arbeitet. Die Arten sind so gewählt, dass sie jede Regel treffen:
 * - **Tempel** mit drei Namen: Register (ab 2) und eine Art mit mehreren.
 * - **Palast** mit einem Namen: KEIN Register (die Marke über einem einzigen Namen war der Streitpunkt am 2026-08-15).
 * - **Bibliothek** ohne Wiki-Adresse: kein Link, reiner Text.
 * - **Flotte** mit einer Adresse außerhalb der Wiki Aventurica: ebenfalls kein Link.
 * - **leere Art**: der Rückfall „Bauwerk" entsteht erst in der Oberfläche; die Antwort trägt `""`.
 */
const BASIS: readonly Entry[] = [
    staette("C68T Tempel des Praios", "Tempel"),
    staette("C68T Tempel der Rondra", "Tempel"),
    staette("C68T Ahnentempel", "Tempel"),
    staette("C68T Goldener Palast", "Palast"),
    staette("C68T Grosse Bibliothek", "Bibliothek", { wiki_url: "" }),
    staette("C68T Schwarze Flotte", "Flotte", { wiki_url: "https://www.garetien.de/flotte" }),
    staette("C68T Namenloses Haus", ""),
];

/** Räumt genau die Zeilen dieser Datei ab - `settlement_place` hat keine `public_id`, der Schlüssel ist der Siedlungsname. */
async function cleanStaetten(database: Queryable): Promise<void> {
    await database.unsafe(`DELETE FROM settlement_place WHERE settlement_key LIKE 'c68t %'`);
    try {
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'staetten'`);
    } catch {
        // Hängt noch eine Zeile daran, bleibt der Lauf stehen - dieselbe Vorsicht wie in der Catalog-Fixture.
    }
}

describeWithDatabase("Die Stätten eines Ortes (WI-0109) gegen PostgreSQL", () => {
    let database: Database;
    let service: SubjectService;
    let ids: CatalogIds;

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanStaetten(database);
        await cleanCatalogFixtures(database);
        ids = await insertCatalogCarriers(database);
        expect(Object.keys(ids).length).toBeGreaterThan(0);
        service = createSubjectService(database);
    });

    afterAll(async () => {
        await cleanStaetten(database);
        await cleanCatalogFixtures(database);
        await database.end({ timeout: 5 });
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Der Import
    // ------------------------------------------------------------------------------------------------------------------

    describe("Import", () => {
        it("legt neu an, ändert, legt still und lässt wieder aufleben - und der zweite Lauf schreibt nichts", async () => {
            const first = await importStaetten(database, payload(BASIS), { dryRun: false });
            expect(first.skipped).toBe(false);
            expect(first.tables.settlement_place.created).toBe(7);
            expect(first.tables.settlement_place.updated).toBe(0);
            expect(first.tables.settlement_place.retired).toBe(0);
            expect(first.changed).toBe(true);

            // 🔴 Idempotenz: dieselbe Quelle, nichts zu schreiben.
            const again = await importStaetten(database, payload(BASIS), { dryRun: false });
            expect({
                created: again.tables.settlement_place.created,
                updated: again.tables.settlement_place.updated,
                retired: again.tables.settlement_place.retired,
            }).toEqual({ created: 0, updated: 0, retired: 0 });
            expect(again.tables.settlement_place.unchanged).toBe(7);
            expect(again.changed).toBe(false);

            // GEÄNDERT: dieselbe Stätte, andere Art.
            const umbenannt = BASIS.map((entry) =>
                entry["name"] === "C68T Goldener Palast" ? { ...entry, type: "Schloss" } : entry,
            );
            const changed = await importStaetten(database, payload(umbenannt), { dryRun: false });
            expect(changed.tables.settlement_place.updated).toBe(1);
            expect(changed.tables.settlement_place.created).toBe(0);
            expect(changed.tables.settlement_place.retired).toBe(0);

            // STILLGELEGT, nicht gelöscht: der Satz nennt die Zeile nicht mehr.
            const ohnePalast = umbenannt.filter((entry) => entry["name"] !== "C68T Goldener Palast");
            const retired = await importStaetten(database, payload(ohnePalast), { dryRun: false });
            expect(retired.tables.settlement_place.retired).toBe(1);
            const [gone] = await database<{ is_active: boolean; state: string; retired_origin: string | null }[]>`
                SELECT is_active, state, retired_origin FROM settlement_place WHERE name = 'C68T Goldener Palast'
            `;
            expect(gone).toEqual({ is_active: false, state: "retired", retired_origin: "import" });
            expect(retired.findings.map((finding) => finding.code)).toContain("staette_retired");

            // WIEDER DA: derselbe Schlüssel, der Import hatte sie stillgelegt.
            const back = await importStaetten(database, payload(BASIS), { dryRun: false });
            expect(back.tables.settlement_place.reappeared).toBe(1);
            const [alive] = await database<{ is_active: boolean; state: string; place_type: string }[]>`
                SELECT is_active, state, place_type FROM settlement_place WHERE name = 'C68T Goldener Palast'
            `;
            expect(alive).toEqual({ is_active: true, state: "active", place_type: "Palast" });
        });

        it("der Schlüssel ist der GEFALTETE Siedlungsname, wörtlich bleibt der Anzeigename", async () => {
            const [row] = await database<{ settlement_key: string; settlement_name: string }[]>`
                SELECT settlement_key, settlement_name FROM settlement_place WHERE name = 'C68T Ahnentempel'
            `;
            expect(row).toEqual({ settlement_key: "c68t ort a", settlement_name: "C68T Ort A" });
            expect(foldSettlement("  C68T Ort A ")).toBe("c68t ort a");
            // Legacys Faltung kennt KEINE Umlaut-Abbildung - sie geht über Groß-/Kleinschreibung und Ränder, nichts weiter.
            expect(foldSettlement("Grôß")).toBe("grôß");
        });

        it("ein fehlender oder LEERER Block schreibt nichts und legt nichts still (Legacys Erzeuger ist fail-open)", async () => {
            const before = await database<{ n: string }[]>`
                SELECT count(*)::text AS n FROM settlement_place WHERE settlement_key = 'c68t ort a' AND is_active
            `;
            for (const broken of [{ ok: true, revision: 1 }, payload([]), null]) {
                const report = await importStaetten(database, broken, { dryRun: false });
                expect(report.skipped).toBe(true);
                expect(report.tables.settlement_place.retired).toBe(0);
                expect(report.findings.map((finding) => finding.code)).toEqual(["source_block_missing"]);
            }
            const after = await database<{ n: string }[]>`
                SELECT count(*)::text AS n FROM settlement_place WHERE settlement_key = 'c68t ort a' AND is_active
            `;
            expect(after[0]?.n).toBe(before[0]?.n);
        });

        it("ein Probelauf schreibt nichts, auch kein Journal", async () => {
            const [vorher] = await database<{ n: string }[]>`SELECT count(*)::text AS n FROM settlement_place`;
            const [laeufe] = await database<{ n: string }[]>`
                SELECT count(*)::text AS n FROM migration_run WHERE data_domain = 'staetten'
            `;
            const report = await importStaetten(database, payload([...BASIS, staette("C68T Probe", "Probe")]), {
                dryRun: true,
            });
            expect(report.dryRun).toBe(true);
            expect(report.tables.settlement_place.created).toBe(1);
            const [nachher] = await database<{ n: string }[]>`SELECT count(*)::text AS n FROM settlement_place`;
            const [laeufeDanach] = await database<{ n: string }[]>`
                SELECT count(*)::text AS n FROM migration_run WHERE data_domain = 'staetten'
            `;
            expect(nachher?.n).toBe(vorher?.n);
            expect(laeufeDanach?.n).toBe(laeufe?.n);
        });

        it("meldet, welche Siedlungen keinen Ort treffen - und speichert ihre Stätten trotzdem", async () => {
            const report = await importStaetten(
                database,
                payload([...BASIS, { ...staette("C68T Waise", "Kontor"), settlement: "C68T Ort Erfunden" }]),
                { dryRun: true },
            );
            expect(report.resolution).toEqual({ resolved: 1, ambiguous: 0, unmatched: 1, unmatchedRows: 1 });
            const finding = report.findings.find((entry) => entry.code === "settlement_unmatched");
            expect(finding?.numbers).toEqual({ siedlungen: 1, zeilen: 1 });
            // Gespeichert, nicht verworfen: ein Filter, der still Arbeit verschluckt, ist schlechter als kein Filter.
            expect(report.stored).toBe(BASIS.length + 1);
        });
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Die Umformung (rein, ohne Datenbank)
    // ------------------------------------------------------------------------------------------------------------------

    describe("Umformung", () => {
        it("zählt die HTML-Reste je ART der Quelle und speichert die Art bereinigt (WI-0122)", () => {
            const kaputt = "Provinzherrliches Garderegiment<br><small>(Leibregiment)< (Hauptsitz)";
            const result = transformStaetten(
                payload([staette("C68T Garde 1", kaputt), staette("C68T Garde 2", kaputt), ...BASIS]),
            );
            const finding = result.findings.find((entry) => entry.code === "redaktionsbefund_html_in_arten");
            expect(finding?.numbers).toEqual({ arten: 1, zeilen: 2 });
            // Der Befund nennt, was die QUELLE trägt; gespeichert wird der Teil vor dem ersten Tag samt Hauptsitz.
            expect(finding?.objects[0]).toEqual({ table: "settlement_place", publicId: "2", name: kaputt });
            const garde = result.rows.filter((row) => row.name.startsWith("C68T Garde"));
            expect(garde.map((row) => row.placeType)).toEqual([
                "Provinzherrliches Garderegiment (Hauptsitz)",
                "Provinzherrliches Garderegiment (Hauptsitz)",
            ]);
            expect(result.rows.some((row) => /[<>]/.test(row.placeType ?? ""))).toBe(false);
        });

        it("bereinigt jede gemessene Form des Schnitts mit EINER Regel (Satz 169042, 14 Arten)", () => {
            const faelle: [string, string | null][] = [
                [
                    "Provinzherrliches Garderegiment<br><small>(ehemals Kaiserliches Garderegiment)< (Hauptsitz)",
                    "Provinzherrliches Garderegiment (Hauptsitz)",
                ],
                ["Provinzherrliches Garderegiment<br><small>(Leibregiment)<", "Provinzherrliches Garderegiment"],
                [
                    "Provinzherrliches Garderegiment (?)<br><small>(ehemals Kaiserliches Garderegiment)< (Hauptsitz)",
                    "Provinzherrliches Garderegiment (?) (Hauptsitz)",
                ],
                [
                    "Söldnereinheit<br><small>(ehemals Provinzherrliches Garderegiment)<small> (Hauptsitz)",
                    "Söldnereinheit (Hauptsitz)",
                ],
                ["Verbrecherbande <small>(ehemals Borbaradianerzirkel)< (Hauptsitz)", "Verbrecherbande (Hauptsitz)"],
                ["Militäreinheit<br>(Akademiegarde) (Hauptsitz)", "Militäreinheit (Hauptsitz)"],
                // Der Anfang des Zusatzes fehlt schon in der Quelle: die verwaiste Klammer fällt weg.
                ["Kaiserliches Gardebanner)< (Hauptsitz)", "Kaiserliches Gardebanner (Hauptsitz)"],
                // Ohne spitzes Klammerzeichen bleibt alles, wie es ist, auch eine Klammer.
                ["Kanzlei (Hauptsitz)", "Kanzlei (Hauptsitz)"],
                ["Tempel (Praios)", "Tempel (Praios)"],
                ["<small>(nur Zusatz)<", null],
                ["", null],
            ];
            for (const [roh, sauber] of faelle) expect(cleanPlaceType(roh), roh).toBe(sauber);
        });

        it("nimmt nur eine UUID als Sprungziel und nur http(s) als Adresse", () => {
            const result = transformStaetten(
                payload([
                    staette("C68T Punkt", "Turm", { public_id: "keine-uuid", auf_der_karte: true }),
                    staette("C68T Falsch", "Turm", { wiki_url: "javascript:alert(1)" }),
                ]),
            );
            expect(result.findings.map((entry) => entry.code).sort()).toEqual([
                "jump_id_not_uuid",
                "link_scheme_rejected",
            ]);
            expect(result.rows[0]).toMatchObject({ legacyPublicId: null, onMap: false });
            expect(result.rows[1]).toMatchObject({ wikiUrl: null });
        });

        it("lässt eine Zeile ohne Namen oder ohne Siedlung fallen - wie Legacys Leser", () => {
            const result = transformStaetten(
                payload([
                    staette("C68T Gut", "Turm"),
                    { ...staette("", "Turm") },
                    { ...staette("C68T Ohne Stadt", "Turm"), settlement: "   " },
                ]),
            );
            expect(result.rows).toHaveLength(1);
            expect(result.notStored).toEqual({ entry_without_name: 1, entry_without_settlement: 1 });
        });

        it("lässt eine zweite Zeile mit demselben Schlüssel sichtbar fallen, statt den Abgleich abzubrechen", () => {
            const result = transformStaetten(
                payload([staette("C68T Doppelt", "Turm"), staette("C68T Doppelt", "Turm")]),
            );
            expect(result.rows).toHaveLength(1);
            expect(result.notStored).toEqual({ duplicate_key: 1 });
            expect(result.findings.map((entry) => entry.code)).toContain("staette_duplicate_key");
        });

        it("zwei gleichnamige KARTENPUNKTE einer Stadt sind zwei Stätten (Legacy entdoppelt sie nicht)", () => {
            const result = transformStaetten(
                payload([
                    staette("C68T Tempel", "Tempel", { public_id: "11111111-1111-4111-8111-111111111111" }),
                    staette("C68T Tempel", "Tempel", { public_id: "22222222-2222-4222-8222-222222222222" }),
                ]),
            );
            expect(result.rows).toHaveLength(2);
            expect(result.notStored).toEqual({});
        });
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Der Lesepfad
    // ------------------------------------------------------------------------------------------------------------------

    describe("Lesepfad", () => {
        beforeAll(async () => {
            const punkt = ids[C.ortB] as string;
            expect(punkt).toBeTruthy();
            await importStaetten(
                database,
                payload([
                    ...BASIS,
                    // Ein innerorts-PUNKT, der auf der Karte steht: er bekommt den Sprung ⊕ auf den Ort B.
                    staette("C68T Punkt auf der Karte", "Turm", { public_id: C.ortB, auf_der_karte: true }),
                    // Ein Punkt, den Legacy nennt, der bei uns aber nicht aktiv ist: kein Sprung, nie ein toter Link.
                    staette("C68T Punkt stillgelegt", "Turm", { public_id: C.ortInaktiv, auf_der_karte: true }),
                ]),
                { dryRun: false },
            );
        });

        it("ein Ort ohne Stätten trägt KEINE Zahl, und eine Landschaft nie", async () => {
            expect((await service.detail(ORT_OHNE))?.counts?.staetten).toBeUndefined();
            expect((await service.detail(LANDSCHAFT))?.counts?.staetten).toBeUndefined();
            const section = await service.staetten(LANDSCHAFT);
            expect(section).toMatchObject({ count: 0, groups: [] });
        });

        /*
         * 🔴 Seit dem Betreiberentscheid vom 2026-10-13 (Lesart B) liest das Panel NICHT MEHR aus dieser Tafel: Was es zeigt,
         * steht in `subjects/sections/staetten-sicht.ts` und wird in `staetten-sicht.test.ts` geprüft. Hier bleibt die Aussage,
         * die diese Datei noch halten kann - eine Zeile allein in `settlement_place` erzeugt keine Zeile im Panel.
         */
        it("🔴 eine Zeile allein in dieser Tafel erscheint NICHT mehr im Panel", async () => {
            const [zeilen] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM settlement_place WHERE settlement_key = 'c68t ort a' AND is_active
            `;
            expect(zeilen!.n).toBeGreaterThan(0);
            expect(await service.staetten(ORT)).toMatchObject({ count: 0, groups: [] });
            expect(await service.staetten(ORT_OHNE)).toMatchObject({ count: 0, groups: [] });
        });

        it("eine stillgelegte Stätte bleibt in der Tabelle stehen (der Import legt still, er löscht nicht)", async () => {
            const ohne = BASIS.filter((entry) => entry["name"] !== "C68T Ahnentempel");
            await importStaetten(
                database,
                payload([
                    ...ohne,
                    staette("C68T Punkt auf der Karte", "Turm", { public_id: C.ortB, auf_der_karte: true }),
                    staette("C68T Punkt stillgelegt", "Turm", { public_id: C.ortInaktiv, auf_der_karte: true }),
                ]),
                { dryRun: false },
            );
            const [row] = await database<{ n: string }[]>`
                SELECT count(*)::text AS n FROM settlement_place WHERE name = 'C68T Ahnentempel' AND NOT is_active
            `;
            expect(row?.n).toBe("1");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Der Prüfer
    // ------------------------------------------------------------------------------------------------------------------

    describe("Prüfer", () => {
        it("prüft gegen dieselbe Quelle und hält nie an", async () => {
            const satz = payload([
                ...BASIS,
                staette("C68T Punkt auf der Karte", "Turm", { public_id: C.ortB, auf_der_karte: true }),
                staette("C68T Punkt stillgelegt", "Turm", { public_id: C.ortInaktiv, auf_der_karte: true }),
            ]);
            await importStaetten(database, satz, { dryRun: false });
            const report = await verifyStaetten(database, satz);
            expect(report.skipped).toBe(false);
            expect(report.checks.map((entry) => entry.name)).toEqual([
                "counts",
                "rows",
                "settlement_key_folded",
                "jump_targets",
                "structure",
                "effect",
            ]);
            // 🔴 Kein Prüfer dieser Datei steht in `BLOCKING_CHECKS` (Betreiber 2026-10-03): nichts hält an.
            expect(report.checks.every((entry) => entry.blocking !== true)).toBe(true);
            // Die Zeilenprüfung muss bestehen; `counts` zählt die ganze Tabelle und sieht fremde Sätze anderer Dateien.
            expect(report.checks.find((entry) => entry.name === "rows")?.passed).toBe(true);
            expect(report.checks.find((entry) => entry.name === "settlement_key_folded")?.passed).toBe(true);
            expect(report.checks.find((entry) => entry.name === "structure")?.passed).toBe(true);
        });

        it("nichts zu prüfen, wenn der Block fehlt", async () => {
            const report = await verifyStaetten(database, { ok: true, revision: 1 });
            expect(report).toMatchObject({ skipped: true, passed: true, checks: [] });
        });
    });
});
