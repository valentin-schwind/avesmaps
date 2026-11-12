import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { Finding } from "../src/findings.ts";
import { FIELD_ORIGIN_FIELDS, parseLiteratureOverlay, transformLiterature } from "../src/migration/literature.ts";
import { importLiterature } from "../src/migration/literature-import.ts";
import { cleanCatalogFixtures, fixtureIndex, workId } from "./support/catalog-fixture.ts";

/**
 * Legacys privater Export B als Quelle der privaten Felder der Literatur (WI-0253 §15, §18): `parseLiteratureOverlay` liest ihn neben dem früher angenommenen
 * Format. 🔴 Alles hier ist von Hand gebaut, im Aufbau der echten Datei (`media-export-migration.json`, Block `game_literature`, Quelle
 * `avesmapsMedienExportWerke` im Mirror); keine Zeile stammt aus den privaten Daten.
 *
 * Erst die reine Umwandlung (Form, Feldnamen, strenge Befunde, altes Format unverändert, Zusammenführung mit der öffentlichen Antwort), dann der Import gegen echtes
 * PostgreSQL: Vermerke, Autoren, Schlüssel, Stempel und Ortsherkunft kommen additiv; ein Werk der Redaktion bleibt unberührt; ein zweiter Lauf ändert nichts; ein Lauf
 * OHNE die Datei löscht nichts; ein Probelauf schreibt nichts.
 */

type Bag = Record<string, unknown>;

const codes = (findings: readonly Finding[]): string[] => findings.map((finding) => finding.code);
const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

// ---- Export B, im Aufbau der echten Datei ----------------------------------------------------------------------------------------

const bPlace = (sortOrder: number, rawName: string, over: Bag = {}): Bag => ({
    sort_order: sortOrder,
    raw_name: rawName,
    target_kind: "unresolved",
    target_public_id: null,
    target_wiki_key: null,
    territory_path: null,
    role: "play",
    origin: "wiki",
    status: "approved",
    created_from_source_id: null,
    ...over,
});

const bWork = (n: number, over: Bag = {}): Bag => ({
    public_id: workId(n),
    wiki_key: `p68t-werk-${String(n)}`,
    title: `P68T Werk ${String(n)}`,
    status: "approved",
    origin: "wiki",
    authors: null,
    field_origins: { wiki_url: "wiki" },
    synced_at: "2026-08-17 07:57:14.387",
    wiki_url: "",
    link_ulisses: null,
    link_fshop: null,
    cover_url: null,
    cover_license: null,
    cover_author: null,
    cover_note: null,
    cover_uploaded_by: null,
    cover_uploaded_at: null,
    cover_auto_state: null,
    cover_source: null,
    places: [],
    links: [],
    ...over,
});

const exportB = (works: Bag[], over: Bag = {}): Bag => ({
    ok: true,
    map_revision: 7,
    media_revision: "p68t",
    switches: { game_literature: true, game_literature_covers: true },
    counts: { items: 1, game_literature: works.length },
    // Die Blöcke des Medienimports: Der Parser der Literatur liest sie nicht.
    items: [{ media_key: "gehoert-dem-medienimport", public_id: workId(1) }],
    game_literature: works,
    citymaps: [{ public_id: workId(1), title: "gehoert-dem-medienimport" }],
    ...over,
});

// ---- Die öffentliche Antwort von game-literature.php -----------------------------------------------------------------------------

const place = (sortOrder: number, rawName: string, over: Bag = {}): Bag => ({
    role: "play",
    target_kind: "unresolved",
    target_public_id: "",
    target_wiki_key: "",
    territory_path: [],
    raw_name: rawName,
    sort_order: sortOrder,
    ...over,
});

const work = (n: number, over: Bag = {}): Bag => ({
    public_id: workId(n),
    title: `P68T Werk ${String(n)}`,
    wiki_url: "",
    product_type: "gruppenabenteuer",
    edition: "DSA5",
    bf_year: null,
    bf_label: "",
    genre: "",
    complexity_gm: "",
    complexity_pl: "",
    is_official: true,
    fshop_code: "",
    cover_url: "",
    series: "",
    link_ulisses: "",
    link_fshop: "",
    isbn: "",
    contained_in: "",
    places: [],
    links: [],
    ...over,
});

const catalog = (items: Bag[]): Bag => ({
    ok: true,
    adventures: items,
    territory_meta: {},
    covers_enabled: true,
    adventures_enabled: true,
});

function publicCatalog(): Bag {
    return catalog([
        work(1, {
            series: "Reihe Eins",
            places: [place(0, "Gareth", { role: "start" }), place(1, "Mittelreich"), place(3, "Ein Dorf")],
        }),
        work(2, { places: [place(0, "Punin", { role: "start" })] }),
        work(3),
    ]);
}

/** Export B zu `publicCatalog()`: Werk 1 aus dem Wiki mit Autor und Vermerken, Werk 2 von Hand, Werk 3 ohne Vermerke, dazu ein Werk, das die Antwort nicht kennt. */
function exportBZuAntwort(): Bag {
    return exportB([
        bWork(1, {
            wiki_key: "p68t-werk-eins",
            authors: "A. Autor",
            field_origins: { title: "wiki", series: "wiki", genre: "manual" },
            places: [
                bPlace(0, "Gareth", { role: "start" }),
                bPlace(1, "Mittelreich"),
                bPlace(3, "Ein Dorf", { origin: "manual" }),
                bPlace(8, "Entfernt", { status: "suppressed" }),
            ],
        }),
        bWork(2, {
            origin: "manual",
            wiki_key: "p68t-werk-zwei",
            authors: "B. Autorin",
            field_origins: { authors: "manual", fshop_code: "wiki" },
            places: [bPlace(0, "Punin", { role: "start", origin: "manual" })],
        }),
        bWork(3, { wiki_key: null, synced_at: null, field_origins: {} }),
        bWork(9, { field_origins: { title: "wiki" } }),
    ]);
}

describe("parseLiteratureOverlay: Legacys Export B (game_literature)", () => {
    it("liest die Werke aus game_literature mit Legacys Feldnamen; items und citymaps gehören dem Medienimport", () => {
        const overlay = parseLiteratureOverlay(exportBZuAntwort());
        expect(overlay.format).toBe("export_b");
        expect(overlay.findings).toEqual([]);
        expect([...overlay.entries.keys()]).toEqual([workId(1), workId(2), workId(3), workId(9)]);
        expect(overlay.entries.get(workId(1))).toMatchObject({
            origin: "wiki",
            suppressed: false,
            wikiKey: "p68t-werk-eins",
            authors: "A. Autor",
            syncedAt: "2026-08-17T07:57:14.387Z",
            fieldOrigins: [
                { field: "title", origin: "wiki" },
                { field: "series", origin: "wiki" },
                { field: "genre", origin: "manual" },
            ],
        });
        const places = overlay.entries.get(workId(1))?.places;
        expect(places?.map((entry) => [entry.sortOrder, entry.rawName, entry.origin, entry.suppressed])).toEqual([
            [0, "Gareth", "wiki", false],
            [1, "Mittelreich", "wiki", false],
            [3, "Ein Dorf", "manual", false],
            [8, "Entfernt", "wiki", true],
        ]);
        expect(overlay.entries.get(workId(2))).toMatchObject({ origin: "manual", authors: "B. Autorin" });
        // Ohne Schlüssel, ohne Stempel, ohne Vermerke: nichts wird erfunden, und ein leerer Satz heißt „Datei nennt ihn“.
        expect(overlay.entries.get(workId(3))).toMatchObject({
            wikiKey: null,
            syncedAt: null,
            authors: null,
            fieldOrigins: [],
        });
    });

    it("Legacys Feldnamen sind unsere: jedes Feld der festen Liste kommt unverändert an, es gibt keine Abbildung", () => {
        const alle = Object.fromEntries(FIELD_ORIGIN_FIELDS.map((feld) => [feld, "manual"]));
        const overlay = parseLiteratureOverlay(exportB([bWork(1, { field_origins: alle })]));
        expect(overlay.findings).toEqual([]);
        expect(overlay.entries.get(workId(1))?.fieldOrigins?.map((entry) => entry.field)).toEqual([
            ...FIELD_ORIGIN_FIELDS,
        ]);
    });

    it("ein Herkunftsvermerk, den Legacy als Leerstelle exportiert (null oder []), lässt den gespeicherten Satz stehen", () => {
        const overlay = parseLiteratureOverlay(
            exportB([bWork(1, { field_origins: null }), bWork(2, { field_origins: [] })]),
        );
        expect(overlay.findings).toEqual([]);
        // PHP macht aus einem leeren Objekt `[]`; null heißt „Legacy führt keinen Satz“. Beides ist kein Satz, der den gespeicherten ersetzt.
        expect(overlay.entries.get(workId(1))?.fieldOrigins).toBeNull();
        expect(overlay.entries.get(workId(2))?.fieldOrigins).toBeNull();
    });

    it("liest streng und meldet, was Legacys Wortschatz verlässt: nichts wird geraten oder auf ein anderes Feld abgebildet", () => {
        const overlay = parseLiteratureOverlay(
            exportB([
                bWork(1, {
                    status: "pending",
                    origin: "import",
                    synced_at: "gestern",
                    field_origins: { title: "wiki", cover_license: "manual", wiki_slug: "wiki", series: "irgendwas" },
                    places: [
                        bPlace(0, "Gareth", { origin: "robot", status: "rejected" }),
                        bPlace(1, "", {}),
                        bPlace(2.5, "Halbe Stelle"),
                        bPlace(3, "Ein Dorf"),
                    ],
                }),
                bWork(1, { title: "Doppelt: das erste gilt" }),
                { public_id: "keine-uuid" },
            ]),
        );
        expect(overlay.format).toBe("export_b");
        // Das erste Werk gilt, ohne Zustand und ohne Herkunft, die Legacy nicht kennt; nur die lesbaren Orte bleiben.
        const entry = overlay.entries.get(workId(1));
        expect(entry).toMatchObject({ origin: null, suppressed: false, syncedAt: null });
        expect(entry?.fieldOrigins).toEqual([{ field: "title", origin: "wiki" }]);
        expect(entry?.places?.map((row) => [row.sortOrder, row.rawName, row.origin])).toEqual([
            [0, "Gareth", "unknown"],
            [3, "Ein Dorf", "wiki"],
        ]);
        expect(codes(overlay.findings).sort()).toEqual([
            "field_origin_unknown",
            "private_entry_duplicate",
            "private_entry_unusable",
            "private_field_unknown",
            "private_place_unusable",
            "private_value_unknown",
        ]);
        expect(find(overlay.findings, "private_field_unknown")).toMatchObject({
            numbers: { werte: 2, felder: 2 },
            notes: ["cover_license: 1", "wiki_slug: 1"],
        });
        expect(find(overlay.findings, "private_value_unknown")?.numbers).toEqual({
            werk_status: 1,
            werk_herkunft: 1,
            ort_status: 1,
            ort_herkunft: 1,
            stempel: 1,
        });
        expect(find(overlay.findings, "private_place_unusable")?.objectCount).toBe(2);
        expect(find(overlay.findings, "private_entry_duplicate")?.objectCount).toBe(1);
    });

    it("eine Fehlerantwort oder eine Datei ohne lesbare Liste ist unbrauchbar und wird nicht verwendet", () => {
        for (const raw of [
            { ok: false, game_literature: [] },
            { ok: true, game_literature: "keine Liste" },
            { ok: true, items: [], citymaps: [] },
            { x: 1 },
            [],
            null,
        ]) {
            const overlay = parseLiteratureOverlay(raw);
            expect(codes(overlay.findings), JSON.stringify(raw)).toEqual(["private_file_unusable"]);
            expect(overlay.entries.size).toBe(0);
            expect(overlay.format).toBeNull();
        }
    });
});

describe("parseLiteratureOverlay: das früher angenommene Format bleibt, wie es war", () => {
    it("liest adventures unverändert und lenient: kein strenger Befund, ein unbekanntes Feld wird still ausgelassen", () => {
        const overlay = parseLiteratureOverlay({
            adventures: [
                {
                    public_id: workId(1).toUpperCase(),
                    origin: "wiki",
                    status: "pending",
                    wiki_key: "p68t-werk-1",
                    authors: "Autor A",
                    synced_at: "2026-08-17 07:57:14.387",
                    field_origins: { title: "wiki" },
                },
                { public_id: workId(1), origin: "manual" },
                { public_id: "keine-uuid" },
            ],
        });
        expect(overlay.format).toBe("angenommen");
        expect(overlay.entries.get(workId(1))).toMatchObject({ origin: "manual", authors: null });
        expect(codes(overlay.findings)).toEqual(["private_entry_unusable"]);
        const erster = parseLiteratureOverlay({
            adventures: [
                {
                    public_id: workId(1),
                    field_origins: { title: "wiki", genre: "manual", series: "irgendwas", unbekanntes_feld: "wiki" },
                },
            ],
        });
        expect(erster.entries.get(workId(1))?.fieldOrigins).toEqual([
            { field: "title", origin: "wiki" },
            { field: "genre", origin: "manual" },
        ]);
        expect(codes(erster.findings)).toEqual(["field_origin_unknown"]);
    });

    it("trägt eine Datei beide Listen, gilt adventures wie bisher", () => {
        const overlay = parseLiteratureOverlay({
            adventures: [{ public_id: workId(1), origin: "manual" }],
            game_literature: [bWork(2)],
        });
        expect(overlay.format).toBe("angenommen");
        expect([...overlay.entries.keys()]).toEqual([workId(1)]);
    });
});

describe("transformLiterature mit Export B", () => {
    const index = fixtureIndex();

    it("führt die Vermerke den Werken der Antwort zu, die Herkunft den Orten, die Tombstones den unterdrückten; fremde Werke sind ein Befund", () => {
        const result = transformLiterature(publicCatalog(), index, parseLiteratureOverlay(exportBZuAntwort()));
        expect(result.privateWorks.map((row) => [row.publicId, row.origin, row.wikiKey, row.authors])).toEqual([
            [workId(1), "wiki", "p68t-werk-eins", "A. Autor"],
            [workId(2), "manual", "p68t-werk-zwei", "B. Autorin"],
            [workId(3), "wiki", null, null],
        ]);
        expect(result.privateWorks.map((row) => row.fieldOrigins?.length)).toEqual([3, 2, 0]);
        expect(result.privatePlaces.map((row) => [row.workPublicId, row.sortOrder, row.nameKey, row.origin])).toEqual([
            [workId(1), 0, "gareth", "wiki"],
            [workId(1), 1, "mittelreich", "wiki"],
            [workId(1), 3, "ein dorf", "manual"],
            [workId(2), 0, "punin", "manual"],
        ]);
        expect(result.suppressedPlaces.map((row) => [row.workTitle, row.rawName, row.sortOrder, row.origin])).toEqual([
            ["P68T Werk 1", "Entfernt", 8, "wiki"],
        ]);
        expect(find(result.findings, "private_work_unknown")?.objectCount).toBe(1);
        expect(codes(result.findings)).not.toContain("suppressed_not_exported");
    });

    it("ein Werk, das Export B unterdrückt nennt und die Antwort nicht mehr trägt, wird zum Tombstone; nennt sie es noch, gewinnt die Antwort", () => {
        const overlay = parseLiteratureOverlay(
            exportB([bWork(3, { status: "suppressed" }), bWork(7, { status: "suppressed" })]),
        );
        const result = transformLiterature(publicCatalog(), index, overlay);
        expect(result.suppressedWorks).toEqual([workId(7)]);
        expect(find(result.findings, "private_conflict")?.objectCount).toBe(1);
        expect(result.privateWorks.map((row) => row.publicId)).toEqual([]);
    });
});

// ---- gegen PostgreSQL --------------------------------------------------------------------------------------------------------------

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Export B einspielen: Import gegen PostgreSQL (Migration 0068)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanCatalogFixtures(database);
    }, 180_000);

    afterAll(async () => {
        await cleanCatalogFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanCatalogFixtures(database);
    });

    it("🔴 der Legacy-Import lässt die Literatur samt Export B aus, solange sie dem WikiSync gehört: skipped, Befund bereich_wikisync, nichts geschrieben", async () => {
        const overlay = parseLiteratureOverlay(exportBZuAntwort());
        const report = await importLiterature(database, publicCatalog(), { overlay });
        expect(report.skipped).toBe(true);
        expect(report.changed).toBe(false);
        expect(codes(report.findings)).toEqual(["bereich_wikisync"]);
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM adventure WHERE public_id::text LIKE '68100000-%'
        `;
        expect(row?.n).toBe(0);
    });
});
