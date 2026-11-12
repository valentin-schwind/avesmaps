import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { Finding } from "../src/findings.ts";
import { parseCitymapOverlay, transformCitymaps } from "../src/migration/citymaps.ts";
import { CITYMAP_TABLES, importCitymaps } from "../src/migration/citymaps-import.ts";
import { urlHash } from "../src/migration/sources.ts";
import { verifyCitymaps } from "../src/migration/verify-citymaps.ts";
import { C, cleanCatalogFixtures, fixtureIndex, insertCatalogCarriers, mapId } from "./support/catalog-fixture.ts";

/**
 * Kartensammlung (WI-0063 P3, Migration 0069, Vertrag `citymaps.yaml`, D2): erst die reine Umwandlung mit kleinen synthetischen
 * Antworten in Legacys Form (Dreiwert, Typen, Beziehungen, Fundstellen, Quellen), dann Import, Stilllegen, Wiederaufnahme, Idempotenz,
 * `citymap_source` ohne Vererbung, die privaten Felder (E5/E5+) und der Prüfer gegen echtes PostgreSQL.
 */

type Bag = Record<string, unknown>;

const place = (sortOrder: number, rawName: string, over: Bag = {}): Bag => ({
    target_kind: "unresolved",
    target_public_id: "",
    target_wiki_key: "",
    territory_path: [],
    raw_name: rawName,
    sort_order: sortOrder,
    ...over,
});

const map = (n: number, over: Bag = {}): Bag => ({
    public_id: mapId(n),
    title: `P69T Karte ${String(n)}`,
    parent_public_id: "",
    map_url: "",
    map_local_url: "",
    thumb: "",
    art: "",
    color_mode: null,
    is_multilevel: null,
    is_labeled: null,
    is_official: null,
    is_spoiler: null,
    is_paid: null,
    has_scale: null,
    width_px: null,
    height_px: null,
    format: "",
    valid_from_bf: null,
    valid_to_bf: null,
    author: "",
    publisher: "",
    note: "",
    types: [],
    related: [],
    places: [],
    sources: [],
    links: [],
    ...over,
});

const citymaps = (items: Bag[], over: Bag = {}): Bag => ({
    ok: true,
    citymaps: items,
    citymaps_enabled: true,
    citymap_previews_enabled: true,
    ...over,
});

const A = "https://p69test.example/a";
const B = "https://p69test.example/b";
const URLLESS_ID = "9990002";
const SOURCE_A_ID = "9990001";

/** Der Satz `map-features.json` desselben Zuges, soweit ihn die Karten brauchen (Quellenkatalog und Verweise). */
function features(links: Record<string, Bag[]>, revision = 9003): Bag {
    return {
        ok: true,
        revision,
        features: [],
        source_catalog: {
            [SOURCE_A_ID]: { url: A, label: "P69T Quelle A", type: "abenteuer", official: true },
            [URLLESS_ID]: { url: "", label: "P69T Urlos", type: "regelbuch", official: true },
            "9990003": { url: B, label: "P69T Quelle B", type: "briefspiel", official: false },
        },
        feature_sources: links,
        source_corpora: {},
        feature_kanon: { abweichungen: {} },
    };
}

const codes = (findings: readonly Finding[]): string[] => findings.map((finding) => finding.code);
const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

describe("transformCitymaps: die Antwort", () => {
    const index = fixtureIndex();

    it("eine unbrauchbare Antwort schreibt nichts und meldet source_block_missing (kein Tor)", () => {
        for (const payload of [null, {}, { ok: false, citymaps: [] }, { ok: true }, { ok: true, citymaps: {} }]) {
            const result = transformCitymaps(payload, index);
            expect(result.skipped).toBe(true);
            expect(codes(result.findings)).toEqual(["source_block_missing"]);
        }
    });

    it("leer bei aktivem Schalter ist source_empty_catalog, ein abgeschalteter Katalog ist kein „alles entfernt“", () => {
        expect(codes(transformCitymaps(citymaps([]), index).findings)).toEqual(["source_empty_catalog"]);
        const off = transformCitymaps(citymaps([], { citymaps_enabled: false }), index);
        expect(off.skipped).toBe(true);
        expect(codes(off.findings)).toEqual(["source_switched_off"]);
    });

    it("abgeschaltete Vorschauen sind kein Entfernen und überspringen den Schritt nicht", () => {
        const result = transformCitymaps(citymaps([map(1)], { citymap_previews_enabled: false }), index);
        expect(result.skipped).toBe(false);
        expect(find(result.findings, "source_switched_off")?.message).toContain("Vorschauen");
    });

    it("Dreiwert bleibt Dreiwert: null heißt unbekannt, nie „nein“; nichts wird zu einem Wert gezwungen", () => {
        const result = transformCitymaps(
            citymaps([
                map(1),
                map(2, {
                    is_multilevel: false,
                    is_labeled: true,
                    is_official: true,
                    is_spoiler: false,
                    has_scale: false,
                    color_mode: "braun",
                    art: "derographisch",
                }),
                map(3, { color_mode: "unbekannt", art: "gibtesnicht" }),
            ]),
            index,
        );
        const [unknown, known, odd] = result.maps;
        expect(unknown).toMatchObject({
            isMultilevel: null,
            isLabeled: null,
            isOfficial: null,
            isSpoiler: null,
            hasScale: null,
            colorMode: null,
            art: null,
        });
        expect(known).toMatchObject({
            isMultilevel: false,
            isLabeled: true,
            isOfficial: true,
            isSpoiler: false,
            hasScale: false,
            colorMode: "braun",
            art: "derographisch",
        });
        // Ein unbekannter Farbmodus ist NULL (unbekannt), nie einer der drei; eine unbekannte art ist NULL und ein Befund.
        expect(odd).toMatchObject({ colorMode: null, art: null });
        expect(find(result.findings, "art_unknown_value")?.objectCount).toBe(1);
    });

    it("übernimmt Maße, Format, Gültigkeit, Zeichner und Verlag getrennt und wörtlich; 9999 bleibt 9999", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, {
                    width_px: 1200,
                    height_px: "800",
                    format: "43 x 57 cm",
                    valid_from_bf: 1000,
                    valid_to_bf: 9999,
                    author: "Zeichner Z",
                    publisher: "Verlag V",
                    note: "Format: A4 . Massstab: Ja",
                }),
            ]),
            index,
        );
        expect(result.maps[0]).toMatchObject({
            widthPx: 1200,
            heightPx: 800,
            format: "43 x 57 cm",
            validFromBf: 1000,
            validToBf: 9999,
            author: "Zeichner Z",
            publisher: "Verlag V",
            note: "Format: A4 . Massstab: Ja",
        });
        expect(find(result.findings, "valid_open_end_marker")?.objectCount).toBe(1);
        expect(find(result.findings, "note_semistructured")?.objectCount).toBe(1);
    });

    it("Typen sind eine Menge der 16 festen Schlüssel; ein anderer wird nicht gespeichert", () => {
        const result = transformCitymaps(
            citymaps([map(1, { types: ["stadtplan", "dungeon", "stadtplan", "gibtesnicht", "sonstige"] })]),
            index,
        );
        expect(result.types.map((row) => row.typeKey)).toEqual(["stadtplan", "dungeon", "sonstige"]);
        expect(find(result.findings, "type_unknown")?.objectCount).toBe(1);
    });

    it("die übergeordnete Karte: nur eine des Katalogs, Selbstverweis und Zyklen setzen den Elter der Zyklus-Karten auf NULL", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, { parent_public_id: mapId(2) }),
                map(2),
                map(3, { parent_public_id: mapId(99) }),
                // Zyklus 4 -> 5 -> 4; 6 mündet nur hinein und behält seinen Elter.
                map(4, { parent_public_id: mapId(5) }),
                map(5, { parent_public_id: mapId(4) }),
                map(6, { parent_public_id: mapId(4) }),
                map(7, { parent_public_id: mapId(7) }),
            ]),
            index,
        );
        const parent = Object.fromEntries(result.maps.map((row) => [row.title, row.parentPublicId]));
        expect(parent).toEqual({
            "P69T Karte 1": mapId(2),
            "P69T Karte 2": null,
            "P69T Karte 3": null,
            "P69T Karte 4": null,
            "P69T Karte 5": null,
            "P69T Karte 6": mapId(4),
            "P69T Karte 7": null,
        });
        expect(find(result.findings, "citymap_parent_unknown")?.objectCount).toBe(1);
        expect(find(result.findings, "citymap_parent_cycle")?.objects.map((row) => row.name)).toEqual([
            "P69T Karte 4",
            "P69T Karte 5",
            "P69T Karte 7",
        ]);
    });

    it("verwandt ist ein unsortiertes Paar: beide Richtungen sind eines, einseitig auch, unbekannte nicht", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, { related: [mapId(2), mapId(3), mapId(99), mapId(1)] }),
                map(2, { related: [mapId(1)] }),
                map(3),
            ]),
            index,
        );
        expect(result.related.map((pair) => [pair.a, pair.b])).toEqual([
            [mapId(1), mapId(2)],
            [mapId(1), mapId(3)],
        ]);
        expect(find(result.findings, "related_asymmetric")?.objects.map((row) => row.name)).toEqual(["P69T Karte 1"]);
        expect(find(result.findings, "citymap_related_unknown")?.objectCount).toBe(1);
        expect(find(result.findings, "citymap_related_self")?.objectCount).toBe(1);
    });

    it("Orte ohne Rolle, in Ausgabereihenfolge, mit Auflösung; eine Wiki-Karte hat genau einen Ort", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, {
                    places: [
                        place(0, "Gareth", { target_kind: "settlement", target_public_id: C.ortA }),
                        place(4, "Bosparan"),
                    ],
                }),
            ]),
            index,
        );
        expect(
            result.places.map((row) => [row.sortOrder, row.exportOrdinal, row.rawName, row.resolution.state]),
        ).toEqual([
            [0, 0, "Gareth", "resolved"],
            [4, 1, "Bosparan", "unresolved"],
        ]);
        expect(Object.keys(result.places[0] ?? {})).not.toContain("role");
        expect(result.totals).toMatchObject({ resolved: 1, unresolved: 1, unmatched: 0 });
        expect(codes(result.findings)).toContain("place_unresolved");
    });

    it("der Karten-Link ist primary, die Fundstellen further; is_paid gehört zum Link und bleibt dreiwertig", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, {
                    map_url: "https://p69test.example/buch",
                    is_paid: true,
                    links: [
                        {
                            key: "map",
                            label: "Karte",
                            url: "https://p69test.example/buch",
                            is_paid: true,
                            state: "online",
                        },
                        {
                            key: "link:5",
                            label: "F-Shop",
                            url: "https://p69test.example/shop",
                            is_paid: true,
                            state: "unchecked",
                        },
                        {
                            key: "link:6",
                            label: "Wiki",
                            url: "https://p69test.example/wiki",
                            is_paid: false,
                            state: "unchecked",
                        },
                        {
                            key: "link:7",
                            label: "Unbekannt",
                            url: "https://p69test.example/x",
                            is_paid: null,
                            state: "unchecked",
                        },
                    ],
                }),
            ]),
            index,
        );
        expect(result.links.map((link) => [link.role, link.label, link.isPaid, link.position])).toEqual([
            ["primary", "Karte", true, 0],
            ["further", "F-Shop", true, 1],
            ["further", "Wiki", false, 2],
            ["further", "Unbekannt", null, 3],
        ]);
        expect(codes(result.findings)).not.toContain("map_without_link");
        expect(codes(result.findings)).not.toContain("map_is_paid_without_link");
    });

    it("eine Karte ohne Karten-Link wird gemeldet; is_paid ohne Link hat keinen Träger und geht verloren (Befund)", () => {
        const result = transformCitymaps(citymaps([map(1, { is_paid: false }), map(2)]), index);
        expect(result.links).toEqual([]);
        expect(find(result.findings, "map_without_link")?.objectCount).toBe(2);
        expect(find(result.findings, "map_is_paid_without_link")?.objectCount).toBe(1);
    });

    it("eine Adresse ohne http oder https wird nicht gespeichert, eine doppelte ist eine Zeile und der Karten-Link gewinnt", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, {
                    links: [
                        { key: "map", label: "Karte", url: "https://p69test.example/gleich", is_paid: false },
                        { key: "link:1", label: "Doppelt", url: "https://p69test.example/gleich", is_paid: true },
                        { key: "link:2", label: "Böse", url: "javascript:alert(1)", is_paid: null },
                        { key: "link:3", label: "", url: "https://p69test.example/leer", is_paid: null },
                    ],
                }),
                map(2, { links: [{ key: "map", label: "Karte", url: "ftp://p69test.example/x", is_paid: null }] }),
            ]),
            index,
        );
        expect(result.links.map((link) => [link.mapTitle, link.role, link.url])).toEqual([
            ["P69T Karte 1", "primary", "https://p69test.example/gleich"],
        ]);
        expect(find(result.findings, "link_duplicate_url")?.objectCount).toBe(1);
        expect(find(result.findings, "link_scheme_rejected")?.objectCount).toBe(2);
        expect(find(result.findings, "map_entry_unusable")?.objectCount).toBe(1);
    });

    it("Bilder werden nie übernommen: thumb und map_local_url sind keine Spalte, eine fremde Adresse ist ein Befund", () => {
        const result = transformCitymaps(
            citymaps([
                map(1, { thumb: "/uploads/kartensammlungen/ok.webp", map_local_url: "" }),
                map(2, { thumb: "https://fremd.example/t.png", map_local_url: "/uploads/siedlungen/x.webp" }),
            ]),
            index,
        );
        expect(find(result.findings, "external_unlocalized")?.objectCount).toBe(2);
        for (const row of result.maps) {
            expect(Object.keys(row)).not.toContain("thumb");
            expect(Object.keys(row)).not.toContain("mapLocalUrl");
        }
    });

    it("Wiki-Dubletten werden gemeldet, nicht bereinigt", () => {
        const source = [{ url: A, label: "P69T Quelle A" }];
        const result = transformCitymaps(
            citymaps([
                map(1, { title: "P69T Stadtplan Gareth", sources: source, places: [place(0, "Gareth")] }),
                map(2, { title: "P69T Stadtplan Gareth", sources: source, places: [place(0, "Gareth")] }),
                map(3, {
                    title: "P69T Stadtplan Gareth",
                    sources: [{ url: B, label: "B" }],
                    places: [place(0, "Gareth")],
                }),
            ]),
            index,
        );
        expect(result.maps).toHaveLength(3);
        expect(find(result.findings, "citymap_title_duplicate")?.numbers).toEqual({ gruppen: 1, karten: 2 });
    });

    it("ein Eintrag ohne public_id oder Titel ist nicht speicherbar; dieselbe public_id zweimal: die erste gilt", () => {
        const result = transformCitymaps(
            citymaps([map(1), map(1, { title: "P69T Zweit" }), map(2, { public_id: "x" }), map(3, { title: " " })]),
            index,
        );
        expect(result.maps.map((row) => row.title)).toEqual(["P69T Karte 1"]);
        expect(find(result.findings, "map_entry_unusable")?.objectCount).toBe(2);
        expect(find(result.findings, "map_duplicate_public_id")?.objectCount).toBe(1);
    });

    it("Quellen kommen aus dem Satz (Träger citymap:<id>), nicht aus der Anzeigekopie; ohne Satz entfällt nur dieser Teil", () => {
        const payload = citymaps([
            map(1, { sources: [{ url: A, label: "P69T Quelle A" }] }),
            map(2, { sources: [{ url: "", label: "P69T Urlos" }] }),
        ]);
        const without = transformCitymaps(payload, index);
        expect(without.sourcesPart).toBe("no_features");
        expect(without.skipped).toBe(false);
        expect(without.sources).toEqual([]);
        const broken = transformCitymaps(payload, index, { features: { ok: true } });
        expect(broken.sourcesPart).toBe("block_missing");
        expect(find(broken.findings, "source_block_missing")?.numbers).toEqual({ teil: "citymap_source" });

        const result = transformCitymaps(payload, index, {
            features: features({
                [`citymap:${mapId(1)}`]: [
                    { source_id: Number(SOURCE_A_ID), pages: "S. 4", note: "Hinweis", origin: "wiki_publication" },
                ],
                [`citymap:${mapId(2)}`]: [{ source_id: Number(URLLESS_ID), reference_kind: "ergaenzend" }],
                // Karte nicht im Katalog, Verweis ohne Katalogzeile, doppelter Verweis.
                [`citymap:${mapId(98)}`]: [{ source_id: Number(SOURCE_A_ID) }],
                [`citymap:${mapId(1).replace("69100000", "69100001")}`]: [{ source_id: 424242 }],
                [`settlement:${C.ortA}`]: [{ source_id: Number(SOURCE_A_ID) }],
            }),
        });
        expect(result.sourcesPart).toBe("applied");
        expect(
            result.sources.map((row) => [
                row.mapTitle,
                row.sourceKey,
                row.referenceKind,
                row.pages,
                row.note,
                row.legacyOrigin,
            ]),
        ).toEqual([
            ["P69T Karte 1", `url:${urlHash(A)}`, null, "S. 4", "Hinweis", "wiki_publication"],
            ["P69T Karte 2", `legacy-id:${URLLESS_ID}`, "ergaenzend", null, null, null],
        ]);
        expect(result.sourceTotals).toMatchObject({
            total: 4,
            carriers: 4,
            withoutMapLinks: 2,
            withoutCatalog: 0,
            duplicates: 0,
            distinctSources: 2,
            urlLessSources: 1,
            withPages: 1,
            withNote: 1,
        });
        expect(find(result.findings, "source_link_without_map")?.objectCount).toBe(2);
        // Die Anzeigekopie stimmt mit den aufgelösten Verknüpfungen überein.
        expect(codes(result.findings)).not.toContain("citymap_sources_disagree");
    });

    it("die Gegenprobe meldet Karten, deren Anzeigekopie von den Verknüpfungen abweicht (Information)", () => {
        const result = transformCitymaps(citymaps([map(1, { sources: [{ url: B, label: "P69T Quelle B" }] })]), index, {
            features: features({ [`citymap:${mapId(1)}`]: [{ source_id: Number(SOURCE_A_ID) }] }),
        });
        expect(find(result.findings, "citymap_sources_disagree")?.objectCount).toBe(1);
    });
});

describe("transformCitymaps: die privaten Felder (E5 und E5+, Format als Annahme)", () => {
    const index = fixtureIndex();
    const base = citymaps([
        map(1, {
            places: [place(0, "Gareth"), place(1, "Dorf")],
            links: [{ key: "map", label: "Karte", url: "https://p69test.example/k", is_paid: false }],
        }),
        map(2),
    ]);

    it("liest Herkunft, Bauschlüssel und die Zuordnung des eigenen Wiki-Artikels", () => {
        const overlay = parseCitymapOverlay({
            citymaps: [
                {
                    public_id: mapId(1),
                    origin: "wiki",
                    wiki_key: "stadtplanindex:gareth:buch:stadtplan",
                    article_url: "https://de.wiki-aventurica.de/wiki/Gareth",
                    article_key: "gareth",
                    article_title: "Gareth",
                    article_origin: "manual",
                },
                { public_id: mapId(2), origin: "manual", no_article: true, article_origin: "wiki_publication" },
                { public_id: "keine-uuid" },
            ],
        });
        const result = transformCitymaps(base, index, { overlay });
        expect(result.privateMaps).toEqual([
            { publicId: mapId(1), origin: "wiki", wikiKey: "stadtplanindex:gareth:buch:stadtplan" },
            { publicId: mapId(2), origin: "manual", wikiKey: null },
        ]);
        expect(result.assignments.map((row) => [row.mapTitle, row.assignment.state, row.assignment.origin])).toEqual([
            ["P69T Karte 1", "assigned", "legacy_editor"],
            ["P69T Karte 2", "separated", "legacy_wiki_publication"],
        ]);
        expect(codes(result.findings)).toContain("private_entry_unusable");
        expect(codes(result.findings)).not.toContain("suppressed_not_exported");
    });

    it("Adresse und no_article zugleich ist ein Widerspruch: beide Aussagen bleiben, assigned gewinnt; eine fremde Adresse wird nicht gespeichert", () => {
        const result = transformCitymaps(base, index, {
            overlay: parseCitymapOverlay({
                citymaps: [
                    { public_id: mapId(1), article_url: "https://de.wiki-aventurica.de/wiki/X", no_article: true },
                    { public_id: mapId(2), article_url: "javascript:alert(1)" },
                ],
            }),
        });
        expect(result.assignments.map((row) => row.assignment.state)).toEqual(["assigned"]);
        expect(find(result.findings, "wiki_assignment_vs_decision")?.objectCount).toBe(1);
        expect(find(result.findings, "link_scheme_rejected")?.objectCount).toBe(1);
    });

    it("unterdrückte Orte und Links werden Tombstones; ein Widerspruch zur Antwort gewinnt die Antwort", () => {
        const result = transformCitymaps(base, index, {
            overlay: parseCitymapOverlay({
                citymaps: [
                    {
                        public_id: mapId(1),
                        places: [
                            { sort_order: 0, raw_name: "Gareth", origin: "wiki", status: "approved" },
                            { sort_order: 1, raw_name: "Dorf", origin: "manual", status: "suppressed" },
                            { sort_order: 7, raw_name: "Entfernt", origin: "wiki", status: "suppressed" },
                        ],
                        links: [
                            {
                                key: "map",
                                url: "https://p69test.example/k",
                                label: "Karte",
                                origin: "manual",
                                status: "approved",
                            },
                            {
                                key: "link:1",
                                url: "https://p69test.example/weg",
                                label: "Weg",
                                is_paid: true,
                                origin: "wiki",
                                status: "suppressed",
                            },
                            {
                                key: "link:2",
                                url: "https://p69test.example/ohne-titel",
                                origin: "wiki",
                                status: "suppressed",
                            },
                        ],
                    },
                    { public_id: mapId(50), status: "suppressed" },
                    { public_id: mapId(2), status: "suppressed" },
                ],
            }),
        });
        expect(result.privatePlaces).toEqual([
            { mapPublicId: mapId(1), sortOrder: 0, nameKey: "gareth", dupOrdinal: 0, origin: "wiki" },
        ]);
        expect(result.suppressedPlaces.map((row) => [row.rawName, row.exportOrdinal])).toEqual([["Entfernt", 2]]);
        expect(result.privateLinks).toEqual([
            { mapPublicId: mapId(1), url: "https://p69test.example/k", origin: "manual" },
        ]);
        expect(result.suppressedLinks.map((row) => [row.url, row.isPaid, row.position])).toEqual([
            ["https://p69test.example/weg", true, 1],
        ]);
        expect(result.suppressedMaps).toEqual([mapId(50)]);
        // Die Karte 2 steht in der Antwort UND unterdrückt in der Datei, ebenso der Ort Dorf: die Antwort gewinnt.
        expect(find(result.findings, "private_conflict")?.objectCount).toBe(2);
        expect(find(result.findings, "private_entry_unusable")?.objectCount).toBe(1);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Kartensammlung: Import, Idempotenz und Prüfer gegen PostgreSQL (Migration 0069)", () => {
    let database: Database;
    let ids: Record<string, string>;

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
        ids = await insertCatalogCarriers(database);
    });

    /** Der Quellenkatalog (D1) in der Testdatenbank: genau die drei Quellen des Satzes. */
    async function insertCatalogSources(): Promise<void> {
        await database`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
            VALUES (${`url:${urlHash(A)}`}, 'final', ${A}, 'P69T Quelle A', 'abenteuer', TRUE),
                   (${`url:${urlHash(B)}`}, 'final', ${B}, 'P69T Quelle B', 'briefspiel', FALSE)
        `;
        await database`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official)
            VALUES (${`legacy-id:${URLLESS_ID}`}, 'provisional', ${URLLESS_ID}, 'P69T Urlos', 'regelbuch', TRUE)
        `;
    }

    function fixtureCatalog(): Bag {
        return citymaps([
            map(1, {
                title: "P69T Stadtplan Gareth",
                art: "politisch",
                color_mode: "farbig",
                is_official: true,
                is_labeled: false,
                format: "A2",
                valid_from_bf: 1000,
                valid_to_bf: 9999,
                author: "Zeichner Z",
                publisher: "Verlag V",
                note: "Hinweis",
                map_url: "https://p69test.example/buch",
                is_paid: true,
                types: ["stadtplan", "ortsplan"],
                related: [mapId(2)],
                places: [
                    place(0, "Gareth", {
                        target_kind: "settlement",
                        target_public_id: C.ortA,
                        target_wiki_key: "wiki:p68t-ort-a",
                    }),
                ],
                sources: [{ url: A, label: "P69T Quelle A" }],
                links: [
                    { key: "map", label: "Karte", url: "https://p69test.example/buch", is_paid: true, state: "online" },
                    {
                        key: "link:1",
                        label: "Wiki",
                        url: "https://p69test.example/wiki",
                        is_paid: false,
                        state: "unchecked",
                    },
                ],
            }),
            map(2, {
                title: "P69T Viertelplan",
                parent_public_id: mapId(1),
                related: [mapId(1)],
                types: ["viertel"],
                places: [
                    place(0, "Mittelreich", {
                        target_kind: "territory",
                        target_public_id: C.gebietB,
                        target_wiki_key: "wiki:p68t-gebiet-b",
                    }),
                    place(1, "Geteilt", { target_kind: "settlement", target_wiki_key: "wiki:p68t-ort-geteilt" }),
                ],
                sources: [{ url: "", label: "P69T Urlos" }],
                links: [
                    {
                        key: "map",
                        label: "Karte",
                        url: "https://p69test.example/buch2",
                        is_paid: null,
                        state: "unchecked",
                    },
                ],
            }),
            map(3, {
                title: "P69T Region",
                places: [
                    place(0, "Wald", { target_kind: "region", target_public_id: C.beschriftungA }),
                    place(1, "Bosparan"),
                ],
            }),
        ]);
    }

    function fixtureFeatures(): Bag {
        return features({
            [`citymap:${mapId(1)}`]: [{ source_id: Number(SOURCE_A_ID) }],
            [`citymap:${mapId(2)}`]: [{ source_id: Number(URLLESS_ID), reference_kind: "ergaenzend", pages: "S. 3" }],
        });
    }

    const importAll = (payload: Bag = fixtureCatalog(), extra: { dryRun?: boolean } = {}) =>
        importCitymaps(database, payload, { features: fixtureFeatures(), ...extra });

    const counts = async (): Promise<Record<string, number>> => {
        const result: Record<string, number> = {};
        for (const table of CITYMAP_TABLES) {
            if (table === "citymap_wiki_assignment") continue;
            const [row] = await database.unsafe<{ n: number }[]>(
                `SELECT count(*)::int AS n FROM ${table} t WHERE ${table === "citymap" ? "t.is_active AND public_id::text LIKE '69100000-%'" : `t.is_active AND t.citymap_id IN (SELECT id FROM citymap WHERE public_id::text LIKE '69100000-%')`}`,
            );
            result[table] = row?.n ?? 0;
        }
        return result;
    };

    it("legt Karten, Typen, Paare, Orte, Fundstellen und Quellen an; der zweite Lauf ändert nichts", async () => {
        await insertCatalogSources();
        const first = await importAll();
        expect(first.skipped).toBe(false);
        expect(first.sourcesPart).toBe("applied");
        expect(first.tables.citymap).toMatchObject({ created: 3 });
        expect(first.tables.citymap_type).toMatchObject({ created: 3 });
        expect(first.tables.citymap_related).toMatchObject({ created: 1 });
        expect(first.tables.citymap_place).toMatchObject({ created: 5 });
        expect(first.tables.citymap_link).toMatchObject({ created: 3 });
        expect(first.tables.citymap_source).toMatchObject({ created: 2 });
        expect(first.parentsChanged).toBe(1);
        expect(first.changed).toBe(true);
        expect(await counts()).toEqual({
            citymap: 3,
            citymap_type: 3,
            citymap_related: 1,
            citymap_place: 5,
            citymap_link: 3,
            citymap_source: 2,
        });

        const second = await importAll();
        for (const table of CITYMAP_TABLES) {
            expect(second.tables[table], table).toMatchObject({ created: 0, updated: 0, retired: 0 });
        }
        expect(second.parentsChanged).toBe(0);
        expect(second.changed).toBe(false);
        expect(second.tables.citymap).toMatchObject({ unchanged: 3 });
        expect(second.tables.citymap_place).toMatchObject({ unchanged: 5 });
        expect(second.resolution).toEqual(first.resolution);
    });

    it("speichert Eigenschaften wörtlich und dreiwertig, is_paid nur am Link, nie ein Bild", async () => {
        await insertCatalogSources();
        await importAll();
        const [row] = await database<Record<string, unknown>[]>`
            SELECT title, art, color_mode, is_multilevel, is_labeled, is_official, is_spoiler, has_scale, width_px, format, valid_from_bf,
                   valid_to_bf, author, publisher, note, legacy_origin, legacy_wiki_key, state, parent_id
            FROM citymap WHERE public_id = ${mapId(1)}
        `;
        expect(row).toEqual({
            title: "P69T Stadtplan Gareth",
            art: "politisch",
            color_mode: "farbig",
            is_multilevel: null,
            is_labeled: false,
            is_official: true,
            is_spoiler: null,
            has_scale: null,
            width_px: null,
            format: "A2",
            valid_from_bf: 1000,
            valid_to_bf: 9999,
            author: "Zeichner Z",
            publisher: "Verlag V",
            note: "Hinweis",
            legacy_origin: "unknown",
            legacy_wiki_key: null,
            state: "active",
            parent_id: null,
        });
        const links = await database<{ link_role: string; label: string; is_paid: boolean | null; position: number }[]>`
            SELECT l.link_role, l.label, l.is_paid, l.position FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id
            WHERE c.public_id = ${mapId(1)} ORDER BY l.position
        `;
        expect(links).toEqual([
            { link_role: "primary", label: "Karte", is_paid: true, position: 0 },
            { link_role: "further", label: "Wiki", is_paid: false, position: 1 },
        ]);
        const [second] = await database<{ is_paid: boolean | null }[]>`
            SELECT l.is_paid FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id WHERE c.public_id = ${mapId(2)}
        `;
        expect(second?.is_paid).toBeNull();
        const [media] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id WHERE c.public_id::text LIKE '69100000-%'
        `;
        expect(media?.n).toBe(0);
    });

    it("setzt die übergeordnete Karte und die Paare (kleinere Kennung zuerst) und löst den Elter wieder", async () => {
        await insertCatalogSources();
        await importAll();
        const [child] = await database<{ parent: string | null; parent_public_id: string | null }[]>`
            SELECT c.parent_id::text AS parent, p.public_id::text AS parent_public_id
            FROM citymap c LEFT JOIN citymap p ON p.id = c.parent_id WHERE c.public_id = ${mapId(2)}
        `;
        expect(child?.parent_public_id).toBe(mapId(1));
        const pairs = await database<{ citymap_id: string; related_citymap_id: string }[]>`
            SELECT citymap_id::text, related_citymap_id::text FROM citymap_related
            WHERE citymap_id IN (SELECT id FROM citymap WHERE public_id::text LIKE '69100000-%')
        `;
        expect(pairs).toHaveLength(1);
        expect(BigInt(pairs[0]?.citymap_id as string)).toBeLessThan(BigInt(pairs[0]?.related_citymap_id as string));

        const detached = fixtureCatalog();
        ((detached["citymaps"] as Bag[])[1] as Bag)["parent_public_id"] = "";
        const report = await importAll(detached);
        expect(report.parentsChanged).toBe(1);
        const [after] = await database<
            { parent_id: string | null }[]
        >`SELECT parent_id::text FROM citymap WHERE public_id = ${mapId(2)}`;
        expect(after?.parent_id).toBeNull();
    });

    it("löst den Ortsbezug gegen die Trägertabellen auf; unaufgelöste behalten den Rohnamen; es gibt keine Rolle", async () => {
        await insertCatalogSources();
        await importAll();
        const rows = await database<
            {
                raw_name: string;
                target_state: string;
                resolved_by: string | null;
                place_id: string | null;
                territory_id: string | null;
                region_id: string | null;
                legacy_target_kind: string | null;
                legacy_target_wiki_key: string | null;
            }[]
        >`
            SELECT p.raw_name, p.target_state, p.resolved_by, p.place_id::text, p.territory_id::text, p.region_id::text, p.legacy_target_kind,
                   p.legacy_target_wiki_key
            FROM citymap_place p JOIN citymap c ON c.id = p.citymap_id
            WHERE c.public_id::text LIKE '69100000-%' ORDER BY c.public_id, p.sort_order
        `;
        expect(rows.map((row) => [row.raw_name, row.target_state, row.resolved_by])).toEqual([
            ["Gareth", "resolved", "public_id"],
            ["Mittelreich", "resolved", "public_id"],
            ["Geteilt", "unmatched", null],
            ["Wald", "resolved", "public_id"],
            ["Bosparan", "unresolved", null],
        ]);
        expect(rows[0]?.place_id).toBe(ids[C.ortA]);
        expect(rows[1]?.territory_id).toBe(ids[C.gebietB]);
        expect(rows[3]?.region_id).toBe(ids[C.regionA]);
        expect(rows[2]).toMatchObject({
            legacy_target_kind: "settlement",
            legacy_target_wiki_key: "wiki:p68t-ort-geteilt",
        });
    });

    it("ein Probelauf rechnet und rollt zurück, auch das Journal", async () => {
        await insertCatalogSources();
        const [before] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'citymaps'`;
        const report = await importAll(fixtureCatalog(), { dryRun: true });
        expect(report.dryRun).toBe(true);
        expect(report.tables.citymap.created).toBe(3);
        expect((await counts())["citymap"]).toBe(0);
        const [after] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'citymaps'`;
        expect(after?.n).toBe(before?.n);
    });

    it("eine unbrauchbare, leere oder abgeschaltete Antwort schreibt nichts und legt nichts still", async () => {
        await insertCatalogSources();
        await importAll();
        for (const payload of [{ ok: false }, citymaps([]), citymaps([], { citymaps_enabled: false })]) {
            const report = await importAll(payload);
            expect(report.skipped).toBe(true);
            expect(report.changed).toBe(false);
        }
        expect((await counts())["citymap"]).toBe(3);
    });

    it("fehlt eine Karte im nächsten Satz, wird sie stillgelegt samt Typen, Orten, Links und Quellen; kehrt sie zurück, wird sie wieder aktiv", async () => {
        await insertCatalogSources();
        await importAll();
        const without = fixtureCatalog();
        (without["citymaps"] as Bag[]).shift();
        const retired = await importCitymaps(database, without, {
            features: features({
                [`citymap:${mapId(2)}`]: [
                    { source_id: Number(URLLESS_ID), reference_kind: "ergaenzend", pages: "S. 3" },
                ],
            }),
        });
        expect(retired.tables.citymap).toMatchObject({ created: 0, retired: 1 });
        expect(retired.tables.citymap_type.retired).toBe(2);
        expect(retired.tables.citymap_place.retired).toBe(1);
        expect(retired.tables.citymap_link.retired).toBe(2);
        expect(retired.tables.citymap_source.retired).toBe(1);
        // Karte 2 verweist auf die stillgelegte Karte 1: kein aktives Paar, kein Elter mehr gezählt.
        expect(retired.tables.citymap_related.retired).toBe(1);
        expect(codes(retired.findings)).toContain("stilllegequote");
        const [row] = await database<{ state: string; is_active: boolean; retired_origin: string | null }[]>`
            SELECT state, is_active, retired_origin FROM citymap WHERE public_id = ${mapId(1)}
        `;
        expect(row).toEqual({ state: "retired", is_active: false, retired_origin: "import" });

        const back = await importAll();
        expect(back.tables.citymap).toMatchObject({ created: 0, reappeared: 1 });
        expect(back.tables.citymap_source).toMatchObject({ created: 0, reappeared: 1 });
        expect(codes(back.findings)).toContain("row_reappeared");
        expect((await counts())["citymap"]).toBe(3);
    });

    it("fällt ein Typ, eine Fundstelle oder ein Paar weg, wird er stillgelegt, nicht gelöscht", async () => {
        await insertCatalogSources();
        await importAll();
        const trimmed = fixtureCatalog();
        const first = (trimmed["citymaps"] as Bag[])[0] as Bag;
        first["types"] = ["stadtplan"];
        first["related"] = [];
        ((trimmed["citymaps"] as Bag[])[1] as Bag)["related"] = [];
        first["links"] = [(first["links"] as Bag[])[0] as Bag];
        const report = await importAll(trimmed);
        expect(report.tables.citymap_type.retired).toBe(1);
        expect(report.tables.citymap_related.retired).toBe(1);
        expect(report.tables.citymap_link.retired).toBe(1);
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_type t JOIN citymap c ON c.id = t.citymap_id
            WHERE c.public_id = ${mapId(1)} AND t.state = 'retired' AND t.retired_origin = 'import'
        `;
        expect(row?.n).toBe(1);
    });

    it("wechselt der Karten-Link zwischen zwei vorhandenen Fundstellen, tauschen die Rollen ohne Verletzung des Index", async () => {
        await insertCatalogSources();
        await importAll();
        const swapped = fixtureCatalog();
        const links = ((swapped["citymaps"] as Bag[])[0] as Bag)["links"] as Bag[];
        links.reverse();
        (links[0] as Bag)["key"] = "map";
        (links[1] as Bag)["key"] = "link:1";
        const report = await importAll(swapped);
        expect(report.tables.citymap_link.updated).toBeGreaterThanOrEqual(2);
        const rows = await database<{ link_role: string; url: string }[]>`
            SELECT l.link_role, l.url FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id
            WHERE c.public_id = ${mapId(1)} ORDER BY l.position
        `;
        expect(rows).toEqual([
            { link_role: "primary", url: "https://p69test.example/wiki" },
            { link_role: "further", url: "https://p69test.example/buch" },
        ]);
        const again = await importAll(swapped);
        expect(again.changed).toBe(false);
    });

    it("citymap_source erbt nichts: die Quelle der übergeordneten Karte gehört der übergeordneten Karte", async () => {
        await insertCatalogSources();
        await importAll();
        const rows = await database<
            { title: string; source_key: string; reference_kind: string | null; pages: string | null }[]
        >`
            SELECT c.title, f.source_key, s.reference_kind, s.pages
            FROM citymap_source s JOIN citymap c ON c.id = s.citymap_id JOIN feature_source f ON f.id = s.source_id
            WHERE c.public_id::text LIKE '69100000-%' ORDER BY c.public_id
        `;
        // Karte 2 (Kind von Karte 1) trägt nur ihre eigene Quelle, Karte 3 keine; nichts wurde von Karte 1 auf Karte 2 gelegt.
        expect(rows).toEqual([
            { title: "P69T Stadtplan Gareth", source_key: `url:${urlHash(A)}`, reference_kind: null, pages: null },
            {
                title: "P69T Viertelplan",
                source_key: `legacy-id:${URLLESS_ID}`,
                reference_kind: "ergaenzend",
                pages: "S. 3",
            },
        ]);
    });

    it("ohne den Satz oder ohne importierten Katalog entfällt nur die Quellenverknüpfung, ohne etwas stillzulegen", async () => {
        await insertCatalogSources();
        await importAll();
        // Ohne den Satz: nichts passiert mit den vorhandenen Verknüpfungen.
        const withoutFeatures = await importCitymaps(database, fixtureCatalog());
        expect(withoutFeatures.sourcesPart).toBe("no_features");
        expect(withoutFeatures.tables.citymap_source).toMatchObject({
            created: 0,
            updated: 0,
            retired: 0,
            unchanged: 0,
        });
        expect((await counts())["citymap_source"]).toBe(2);
        // Ohne importierten Katalog (D1 fehlt): der Teil entfällt mit Befund, nichts wird stillgelegt.
        await database`DELETE FROM citymap_source WHERE citymap_id IN (SELECT id FROM citymap WHERE public_id::text LIKE '69100000-%')`;
        await database`DELETE FROM feature_source WHERE title LIKE 'P69T%'`;
        const noCatalog = await importAll();
        expect(noCatalog.sourcesPart).toBe("not_imported");
        expect(codes(noCatalog.findings)).toContain("source_not_imported");
        expect((await counts())["citymap_source"]).toBe(0);
        expect(noCatalog.tables.citymap_source.created).toBe(0);
    });

    it("ein unterdrückte oder von einem Editor stillgelegte Karte bleibt, wie sie ist (keine Wiederbelebung), samt ihrer Kinder", async () => {
        await insertCatalogSources();
        await importAll();
        await database`UPDATE citymap SET state = 'suppressed', is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE public_id = ${mapId(1)}`;
        await database`UPDATE citymap SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE public_id = ${mapId(3)}`;
        const changed = fixtureCatalog();
        ((changed["citymaps"] as Bag[])[0] as Bag)["title"] = "P69T Stadtplan (neu)";
        const report = await importAll(changed);
        expect(report.tables.citymap.protectedRows).toBe(2);
        expect(codes(report.findings)).toContain("row_vs_decision");
        const rows = await database<{ title: string; state: string }[]>`
            SELECT title, state FROM citymap WHERE public_id::text LIKE '69100000-%' ORDER BY public_id
        `;
        expect(rows.map((row) => [row.title, row.state])).toEqual([
            ["P69T Stadtplan Gareth", "suppressed"],
            ["P69T Viertelplan", "active"],
            ["P69T Region", "retired"],
        ]);
        const [places] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_place p JOIN citymap c ON c.id = p.citymap_id WHERE c.public_id = ${mapId(1)} AND p.state = 'active'
        `;
        expect(places?.n).toBe(1);
    });

    it("🔴 eine in der Medienverwaltung geänderte Karte lässt der Zug stehen, samt Typen und Orten: Befund statt Überschreiben (WI-0068 R5)", async () => {
        await insertCatalogSources();
        await importAll();
        // Was die Operation `citymap.update` hinterlässt (`media-editor/kartensammlung-schreiben.ts`): die Änderung und ihre Zeile im
        // Fachprotokoll der Medien. Der Zug liest nur diese Zeile (`karte-gehalten.ts`), wie bei den Rechten eines Bildes.
        const operationId = randomUUID();
        await database`UPDATE citymap SET author = 'Von Hand' WHERE public_id = ${mapId(1)}`;
        await database`
            INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_label)
            VALUES (${operationId}::uuid, sha256('p69t'::bytea), ${database.json({ operationId, status: "applied" })},
                    'citymap.update', 'test', 'cli', 'p69t')
        `;
        await database`
            INSERT INTO media_audit_event (operation_id, action, citymap_public_id, target_revision, details)
            VALUES (${operationId}::uuid, 'citymap.updated', ${mapId(1)}::uuid, 2, '{"fields":["author"]}'::jsonb)
        `;
        try {
            const changed = fixtureCatalog();
            const [erste, zweite] = changed["citymaps"] as Bag[];
            erste!["title"] = "P69T Stadtplan (neu)";
            erste!["types"] = ["dungeon"];
            erste!["places"] = [];
            zweite!["title"] = "P69T Viertelplan (neu)";
            const report = await importAll(changed);
            expect(report.tables.citymap.protectedRows).toBe(1);
            const befund = report.findings.find((finding) => finding.code === "row_vs_decision");
            expect(befund?.objects.map((objekt) => objekt.publicId)).toEqual([mapId(1)]);
            const karten = await database<{ title: string; author: string | null }[]>`
                SELECT title, author FROM citymap WHERE public_id IN (${mapId(1)}, ${mapId(2)}) ORDER BY public_id
            `;
            expect(karten[0], "die gehaltene Karte bleibt").toEqual({
                title: "P69T Stadtplan Gareth",
                author: "Von Hand",
            });
            expect(karten[1]?.title, "die andere folgt Legacy").toBe("P69T Viertelplan (neu)");
            const typen = await database<{ type_key: string }[]>`
                SELECT t.type_key FROM citymap_type t JOIN citymap c ON c.id = t.citymap_id
                 WHERE c.public_id = ${mapId(1)} AND t.is_active ORDER BY t.type_key
            `;
            expect(typen.map((zeile) => zeile.type_key)).toEqual(["ortsplan", "stadtplan"]);
            const [orte] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM citymap_place p JOIN citymap c ON c.id = p.citymap_id
                 WHERE c.public_id = ${mapId(1)} AND p.is_active
            `;
            expect(orte?.n, "die Orte der gehaltenen Karte bleiben").toBeGreaterThan(0);
        } finally {
            await database`DELETE FROM media_audit_event WHERE operation_id = ${operationId}::uuid`;
            await database`DELETE FROM media_operation WHERE operation_id = ${operationId}::uuid`;
        }
    });

    it("löst bei jedem Lauf neu auf: ein neu importierter Träger ändert genau die bisher nicht gefundenen Zeilen", async () => {
        await insertCatalogSources();
        const payload = citymaps([
            map(1, {
                places: [
                    place(0, "Nachzügler", {
                        target_kind: "settlement",
                        target_public_id: "00000000-0000-4000-8000-000000000998",
                    }),
                ],
            }),
        ]);
        const first = await importCitymaps(database, payload);
        expect(first.resolution.unmatched).toBe(1);
        const [added] = await database<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES ('00000000-0000-4000-8000-000000000998', 'aventuria', 'P69T Nachzügler', 'stadt', ST_SetSRID(ST_MakePoint(451, 451), 0), 'test', TRUE)
            RETURNING id::text
        `;
        try {
            const second = await importCitymaps(database, payload);
            expect(second.tables.citymap_place).toMatchObject({ created: 0, updated: 1 });
            expect(second.tables.citymap).toMatchObject({ updated: 0 });
            const [row] = await database<{ place_id: string | null; target_state: string }[]>`
                SELECT place_id::text, target_state FROM citymap_place WHERE raw_name = 'Nachzügler'
            `;
            expect(row).toEqual({ place_id: added?.id, target_state: "resolved" });
        } finally {
            await database`DELETE FROM citymap_place WHERE place_id = ${added?.id as string}`;
            await database`DELETE FROM place WHERE id = ${added?.id as string}`;
        }
    });

    it("der Prüfer bestätigt den Import; eine Abweichung ist ein Befund, kein Tor", async () => {
        await insertCatalogSources();
        const payload = fixtureCatalog();
        await importAll(payload);
        const ok = await verifyCitymaps(database, payload, { features: fixtureFeatures() });
        expect(ok.skipped).toBe(false);
        expect(ok.checks.filter((entry) => !entry.passed)).toEqual([]);
        expect(ok.passed).toBe(true);
        expect(ok.checks.map((entry) => entry.name)).toEqual([
            "counts",
            "map_parity",
            "parents",
            "types_and_pairs",
            "place_parity",
            "place_targets",
            "place_resolution",
            "place_order",
            "link_parity",
            "source_parity",
            "source_accounting",
            "contract_numbers",
            "structure",
            "no_orphans",
        ]);

        await database`UPDATE citymap SET is_official = FALSE WHERE public_id = ${mapId(3)}`;
        await database`UPDATE citymap_link SET is_paid = FALSE WHERE citymap_id = (SELECT id FROM citymap WHERE public_id = ${mapId(2)})`;
        const bad = await verifyCitymaps(database, payload, { features: fixtureFeatures() });
        expect(bad.checks.find((entry) => entry.name === "map_parity")?.passed).toBe(false);
        expect(bad.checks.find((entry) => entry.name === "link_parity")?.passed).toBe(false);
        expect(bad.checks.find((entry) => entry.name === "map_parity")?.blocking).toBe(false);
        // Nichts hält an: kein Prüfer steht in BLOCKING_CHECKS.
        expect(bad.passed).toBe(true);
    });

    it("der Prüfer misst die Sollzahlen der Quellenverknüpfung nur für den Satz 161832", async () => {
        await insertCatalogSources();
        const payload = fixtureCatalog();
        await importCitymaps(database, payload, { features: features({}, 161832) });
        const report = await verifyCitymaps(database, payload, { features: features({}, 161832) });
        const numbers = report.checks.find((entry) => entry.name === "contract_numbers");
        expect(numbers?.passed).toBe(false);
        expect(numbers?.detail).toContain("Sollzahlen weichen ab");
    });

    it("Struktur: keine entity_type-Spalte, kein JSON-Typ, kein is_color, kein is_paid an der Karte, keine Rolle am Ort, kein Gebietspfad", async () => {
        const columns = await database<{ table_name: string; column_name: string; data_type: string }[]>`
            SELECT table_name, column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name LIKE 'citymap%'
        `;
        expect(columns.length).toBeGreaterThan(80);
        expect(columns.filter((row) => row.column_name === "entity_type")).toEqual([]);
        expect(columns.filter((row) => ["json", "jsonb"].includes(row.data_type))).toEqual([]);
        const of = (table: string): Set<string> =>
            new Set(columns.filter((row) => row.table_name === table).map((row) => row.column_name));
        for (const forbidden of [
            "is_color",
            "is_paid",
            "thumb",
            "thumb_url",
            "thumb_auto_url",
            "map_url",
            "map_local_url",
            "territory_path",
        ]) {
            expect(of("citymap").has(forbidden), `citymap.${forbidden}`).toBe(false);
        }
        expect(of("citymap_place").has("role")).toBe(false);
        expect(of("citymap_place").has("territory_path")).toBe(false);
        expect(of("citymap_link").has("is_paid")).toBe(true);
        expect(of("citymap_link").has("state_check")).toBe(false);
    });

    it("Schema: Zielzustand, Paar, Elter, Karten-Link und die Aufzählungen halten die Regeln selbst", async () => {
        await insertCatalogSources();
        await importAll();
        const violation = async (statement: string): Promise<{ code: string; constraint_name?: string }> => {
            try {
                await database.unsafe(statement);
            } catch (error) {
                return error as { code: string; constraint_name?: string };
            }
            throw new Error(`keine Verletzung: ${statement}`);
        };
        const map1 = `(SELECT id FROM citymap WHERE public_id = '${mapId(1)}')`;
        const map2 = `(SELECT id FROM citymap WHERE public_id = '${mapId(2)}')`;
        const insertPlace = (name: string, state: string, by: string | null, fk = "NULL"): string =>
            `INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, raw_name, target_state, resolved_by, place_id)
             VALUES (${map1}, 99, 99, '${name}', '${name}', '${state}', ${by === null ? "NULL" : `'${by}'`}, ${fk})`;
        expect((await violation(insertPlace("a", "resolved", "public_id"))).constraint_name).toBe(
            "citymap_place_one_target_when_resolved",
        );
        expect((await violation(insertPlace("b", "unresolved", null, ids[C.ortA] as string))).constraint_name).toBe(
            "citymap_place_one_target_when_resolved",
        );
        expect((await violation(insertPlace("c", "gefunden", null))).code).toBe("23514");
        await database.unsafe(insertPlace("d", "resolved", "wiki_key", ids[C.ortA] as string));
        // Paar: nur kleinere Kennung zuerst, kein Selbstverweis; Elter nicht die Karte selbst.
        expect(
            (await violation(`INSERT INTO citymap_related (citymap_id, related_citymap_id) VALUES (${map2}, ${map1})`))
                .constraint_name,
        ).toBe("citymap_related_ordered");
        expect(
            (await violation(`UPDATE citymap SET parent_id = id WHERE public_id = '${mapId(3)}'`)).constraint_name,
        ).toBe("citymap_not_own_parent");
        // Karten-Link: höchstens ein aktiver je Karte, nur http und https.
        expect(
            (
                await violation(
                    `INSERT INTO citymap_link (citymap_id, link_role, url, label, position) VALUES (${map1}, 'primary', 'https://p69test.example/zweiter', 'Zweiter', 9)`,
                )
            ).constraint_name,
        ).toBe("citymap_link_one_active_primary");
        expect(
            (
                await violation(
                    `INSERT INTO citymap_link (citymap_id, link_role, url, label, position) VALUES (${map1}, 'further', 'ftp://x', 'X', 9)`,
                )
            ).constraint_name,
        ).toBe("citymap_link_url_http");
        // Aufzählungen und Zustand.
        expect(
            (await violation(`UPDATE citymap SET art = 'gibtesnicht' WHERE public_id = '${mapId(1)}'`)).constraint_name,
        ).toBe("citymap_art_known");
        expect(
            (await violation(`UPDATE citymap SET color_mode = 'unknown' WHERE public_id = '${mapId(1)}'`))
                .constraint_name,
        ).toBe("citymap_color_mode_known");
        expect(
            (await violation(`INSERT INTO citymap_type (citymap_id, type_key) VALUES (${map1}, 'gibtesnicht')`))
                .constraint_name,
        ).toBe("citymap_type_key_known");
        expect(
            (await violation(`UPDATE citymap SET legacy_origin = 'editor' WHERE public_id = '${mapId(1)}'`))
                .constraint_name,
        ).toBe("citymap_legacy_origin_known");
        expect(
            (await violation(`UPDATE citymap SET note = '  ' WHERE public_id = '${mapId(1)}'`)).constraint_name,
        ).toBe("citymap_text_not_blank");
        // Legacys Längen stehen nicht als CHECK.
        await database`UPDATE citymap SET note = ${"n".repeat(2500)} WHERE public_id = ${mapId(1)}`;
        // reference_kind NULL ist eine echte Quelle, ein fremder Wert nicht.
        expect(
            (await violation(`UPDATE citymap_source SET reference_kind = 'zitat' WHERE citymap_id = ${map1}`))
                .constraint_name,
        ).toBe("citymap_source_reference_kind_known");
    });

    it("Schema: citymap_media bindet Vollkarte und Vorschau je Karte in genau einer Rolle, je Rolle höchstens eine aktive Bindung", async () => {
        await insertCatalogSources();
        await importAll();
        const [map1] = await database<{ id: string }[]>`SELECT id::text FROM citymap WHERE public_id = ${mapId(1)}`;
        const asset = async (n: number): Promise<string> => {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO media_asset (media_kind, origin, source_system, source_ref)
                VALUES ('image', 'legacy_import', 'catalog-test', ${`citymap:p69t:${String(n)}`}) RETURNING id::text
            `;
            return row?.id as string;
        };
        const full = await asset(1);
        const preview = await asset(2);
        const other = await asset(3);
        try {
            const bind = (assetId: string, role: string, origin = "legacy"): Promise<unknown> =>
                database.unsafe(
                    `INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${map1?.id ?? "0"}, ${assetId}, '${role}', '${origin}')`,
                );
            await bind(full, "map_full");
            await bind(preview, "map_preview", "wiki_localized");
            // Eine zweite aktive Bindung derselben Rolle ist ausgeschlossen, auch mit einem anderen Asset.
            await expect(bind(other, "map_preview")).rejects.toMatchObject({
                constraint_name: "citymap_media_one_active_per_role",
            });
            await expect(bind(other, "literature_cover")).rejects.toMatchObject({
                constraint_name: "citymap_media_role_known",
            });
            await expect(bind(other, "map_full", "scraper")).rejects.toMatchObject({
                constraint_name: "citymap_media_origin_known",
            });
            await database`UPDATE citymap_media SET retired_at = now() WHERE role = 'map_preview' AND citymap_id = ${map1?.id as string}`;
            await bind(other, "map_preview");
            await expect(
                database`UPDATE citymap_media SET publication_override = 'approved' WHERE media_asset_id = ${other}`,
            ).rejects.toMatchObject({ constraint_name: "citymap_media_approved_has_decision" });
        } finally {
            await database`DELETE FROM citymap_media WHERE citymap_id = ${map1?.id as string}`;
            await database`DELETE FROM media_asset WHERE source_system = 'catalog-test'`;
        }
    });

    it("Schema (0321, WI-0287 Stufe 2): mehrere aktive Karten je Eintrag, weiter genau eine aktive Vorschau; Bezeichnung und Position nur an der Karte", async () => {
        await insertCatalogSources();
        await importAll();
        const [map1] = await database<{ id: string }[]>`SELECT id::text FROM citymap WHERE public_id = ${mapId(1)}`;
        const karte = map1?.id as string;
        const asset = async (n: number): Promise<string> => {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO media_asset (media_kind, origin, source_system, source_ref)
                VALUES ('image', 'legacy_import', 'catalog-test', ${`citymap:p321t:${String(n)}`}) RETURNING id::text
            `;
            return row?.id as string;
        };
        const [spieler, meister, dritte, vorschau, zweiteVorschau] = [
            await asset(1),
            await asset(2),
            await asset(3),
            await asset(4),
            await asset(5),
        ];
        try {
            await database`
                INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, version_label, version_position)
                VALUES (${karte}::bigint, ${spieler}::bigint, 'map_full', 'editor', 'Spielerversion', 0),
                       (${karte}::bigint, ${meister}::bigint, 'map_full', 'editor', 'SL-Version', 1),
                       (${karte}::bigint, ${dritte}::bigint, 'map_full', 'legacy', NULL, NULL)
            `;
            const [aktiv] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM citymap_media WHERE citymap_id = ${karte}::bigint AND role = 'map_full' AND retired_at IS NULL
            `;
            expect(aktiv!.n).toBe(3);
            const vorschauBinden = (assetId: string): Promise<unknown> =>
                database`
                    INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
                    VALUES (${karte}::bigint, ${assetId}::bigint, 'map_preview', 'editor')
                `;
            await vorschauBinden(vorschau);
            // Die Vorschau bleibt Einzelrolle, unter dem Namen aus 0069.
            await expect(vorschauBinden(zweiteVorschau)).rejects.toMatchObject({
                constraint_name: "citymap_media_one_active_per_role",
            });
            // Eine Bezeichnung ist nie leer und gehört nie an eine Vorschau; eine Position ist nie negativ.
            await expect(
                database`UPDATE citymap_media SET version_label = '  ' WHERE media_asset_id = ${spieler}::bigint`,
            ).rejects.toMatchObject({ constraint_name: "citymap_media_version_label_valid" });
            await expect(
                database`UPDATE citymap_media SET version_label = 'Spieler' WHERE media_asset_id = ${vorschau}::bigint`,
            ).rejects.toMatchObject({ constraint_name: "citymap_media_version_label_valid" });
            await expect(
                database`UPDATE citymap_media SET version_position = -1 WHERE media_asset_id = ${meister}::bigint`,
            ).rejects.toMatchObject({ constraint_name: "citymap_media_version_position_valid" });
            await expect(
                database`UPDATE citymap_media SET version_position = 0 WHERE media_asset_id = ${vorschau}::bigint`,
            ).rejects.toMatchObject({ constraint_name: "citymap_media_version_position_valid" });
        } finally {
            await database`DELETE FROM citymap_media WHERE citymap_id = ${karte}::bigint`;
            await database`DELETE FROM media_asset WHERE source_system = 'catalog-test'`;
        }
    });

    describe("private Felder (E5 und E5+)", () => {
        const overlay = (): ReturnType<typeof parseCitymapOverlay> =>
            parseCitymapOverlay({
                citymaps: [
                    {
                        public_id: mapId(1),
                        origin: "wiki",
                        wiki_key: "stadtplanindex:gareth:buch:stadtplan",
                        article_url: "https://de.wiki-aventurica.de/wiki/Gareth",
                        article_key: "gareth",
                        article_title: "Gareth",
                        article_origin: "manual",
                        places: [
                            { sort_order: 0, raw_name: "Gareth", origin: "wiki", status: "approved" },
                            { sort_order: 5, raw_name: "Entfernt", origin: "wiki", status: "suppressed" },
                        ],
                        links: [
                            {
                                key: "map",
                                url: "https://p69test.example/buch",
                                label: "Karte",
                                origin: "manual",
                                status: "approved",
                            },
                            {
                                key: "link:9",
                                url: "https://p69test.example/weg",
                                label: "Weg",
                                is_paid: true,
                                origin: "wiki",
                                status: "suppressed",
                            },
                        ],
                    },
                    { public_id: mapId(2), origin: "manual", no_article: true, article_origin: "wiki_publication" },
                ],
            });

        it("füllt Herkunft, Bauschlüssel, Zuordnung und Tombstones additiv; der zweite Lauf ändert nichts", async () => {
            await insertCatalogSources();
            const first = await importCitymaps(database, fixtureCatalog(), {
                features: fixtureFeatures(),
                overlay: overlay(),
            });
            expect(first.privateFields.maps).toBeGreaterThan(0);
            expect(first.tables.citymap_wiki_assignment.created).toBe(2);
            expect(first.privateFields.tombstonePlaces.created).toBe(1);
            expect(first.privateFields.tombstoneLinks.created).toBe(1);
            const [row] = await database<{ legacy_origin: string; legacy_wiki_key: string | null }[]>`
                SELECT legacy_origin, legacy_wiki_key FROM citymap WHERE public_id = ${mapId(1)}
            `;
            expect(row).toEqual({ legacy_origin: "wiki", legacy_wiki_key: "stadtplanindex:gareth:buch:stadtplan" });
            const assignments = await database<
                { title: string; assignment_state: string; assignment_origin: string; wiki_url: string | null }[]
            >`
                SELECT c.title, a.assignment_state, a.assignment_origin, a.wiki_url
                FROM citymap_wiki_assignment a JOIN citymap c ON c.id = a.citymap_id WHERE c.public_id::text LIKE '69100000-%' ORDER BY c.public_id
            `;
            expect(assignments).toEqual([
                {
                    title: "P69T Stadtplan Gareth",
                    assignment_state: "assigned",
                    assignment_origin: "legacy_editor",
                    wiki_url: "https://de.wiki-aventurica.de/wiki/Gareth",
                },
                {
                    title: "P69T Viertelplan",
                    assignment_state: "separated",
                    assignment_origin: "legacy_wiki_publication",
                    wiki_url: null,
                },
            ]);
            const tombstones = await database<{ raw_name: string | null; state: string; legacy_origin: string }[]>`
                SELECT p.raw_name, p.state, p.legacy_origin FROM citymap_place p WHERE p.state = 'suppressed'
                  AND p.citymap_id = (SELECT id FROM citymap WHERE public_id = ${mapId(1)})
            `;
            expect(tombstones).toEqual([{ raw_name: "Entfernt", state: "suppressed", legacy_origin: "wiki" }]);
            const links = await database<{ url: string; state: string; link_role: string; is_paid: boolean | null }[]>`
                SELECT url, state, link_role, is_paid FROM citymap_link WHERE state = 'suppressed'
                  AND citymap_id = (SELECT id FROM citymap WHERE public_id = ${mapId(1)})
            `;
            expect(links).toEqual([
                { url: "https://p69test.example/weg", state: "suppressed", link_role: "further", is_paid: true },
            ]);

            const second = await importCitymaps(database, fixtureCatalog(), {
                features: fixtureFeatures(),
                overlay: overlay(),
            });
            expect(second.changed).toBe(false);
            expect(second.tables.citymap_wiki_assignment).toMatchObject({
                created: 0,
                updated: 0,
                retired: 0,
                unchanged: 2,
            });
            expect(second.privateFields).toMatchObject({
                maps: 0,
                places: 0,
                links: 0,
                tombstonePlaces: { created: 0, converted: 0, unchanged: 1 },
                tombstoneLinks: { created: 0, converted: 0, unchanged: 1 },
            });
        });

        it("ein späterer Lauf ohne die Datei löscht nichts; ein Tombstone wird nie belebt", async () => {
            await insertCatalogSources();
            await importCitymaps(database, fixtureCatalog(), { features: fixtureFeatures(), overlay: overlay() });
            const again = fixtureCatalog();
            const first = (again["citymaps"] as Bag[])[0] as Bag;
            (first["places"] as Bag[]).push(place(5, "Entfernt"));
            (first["links"] as Bag[]).push({
                key: "link:9",
                label: "Weg",
                url: "https://p69test.example/weg",
                is_paid: true,
            });
            const plain = await importCitymaps(database, again, { features: fixtureFeatures() });
            expect(plain.tables.citymap_place.protectedRows).toBe(1);
            expect(plain.tables.citymap_link.protectedRows).toBe(1);
            expect(codes(plain.findings)).toContain("row_vs_decision");
            const [map] = await database<{ legacy_origin: string; legacy_wiki_key: string | null }[]>`
                SELECT legacy_origin, legacy_wiki_key FROM citymap WHERE public_id = ${mapId(1)}
            `;
            expect(map).toEqual({ legacy_origin: "wiki", legacy_wiki_key: "stadtplanindex:gareth:buch:stadtplan" });
            const [assignment] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM citymap_wiki_assignment WHERE is_active AND citymap_id IN (SELECT id FROM citymap WHERE public_id::text LIKE '69100000-%')
            `;
            // Ohne die Datei wird die Zuordnung weder gelesen noch stillgelegt.
            expect(assignment?.n).toBe(2);
            const [tombstone] = await database<{ state: string }[]>`
                SELECT state FROM citymap_place WHERE raw_name = 'Entfernt' AND citymap_id = (SELECT id FROM citymap WHERE public_id = ${mapId(1)})
            `;
            expect(tombstone?.state).toBe("suppressed");
        });

        it("eine Karte, die dieselbe Zuordnung verliert, legt ihre Zeile still; dieselbe Karte neu angelegt wird als citymap_recreated gemeldet", async () => {
            await insertCatalogSources();
            await importCitymaps(database, fixtureCatalog(), { features: fixtureFeatures(), overlay: overlay() });
            const withoutArticle = parseCitymapOverlay({
                citymaps: [{ public_id: mapId(1), origin: "wiki", wiki_key: "stadtplanindex:gareth:buch:stadtplan" }],
            });
            const report = await importCitymaps(database, fixtureCatalog(), {
                features: fixtureFeatures(),
                overlay: withoutArticle,
            });
            expect(report.tables.citymap_wiki_assignment.retired).toBe(2);

            // Legacy löscht die Karte und legt sie mit neuer public_id neu an: die alte wird stillgelegt, die neue teilt den Bauschlüssel.
            const recreated = fixtureCatalog();
            ((recreated["citymaps"] as Bag[])[0] as Bag)["public_id"] = mapId(4);
            const next = await importCitymaps(database, recreated, {
                features: fixtureFeatures(),
                overlay: parseCitymapOverlay({
                    citymaps: [
                        { public_id: mapId(4), origin: "wiki", wiki_key: "stadtplanindex:gareth:buch:stadtplan" },
                    ],
                }),
            });
            expect(codes(next.findings)).toContain("citymap_recreated");
            expect(find(next.findings, "citymap_recreated")?.objects[0]?.publicId).toBe(mapId(4));
        });

        it("der Prüfer prüft mit der Datei auch die Zuordnung des eigenen Wiki-Artikels", async () => {
            await insertCatalogSources();
            const payload = fixtureCatalog();
            await importCitymaps(database, payload, { features: fixtureFeatures(), overlay: overlay() });
            const report = await verifyCitymaps(database, payload, { features: fixtureFeatures(), overlay: overlay() });
            expect(report.checks.filter((entry) => !entry.passed)).toEqual([]);
            expect(report.checks.find((entry) => entry.name === "wiki_assignment")?.detail).toContain("2 Zuordnungen");
            await database`UPDATE citymap_wiki_assignment SET wiki_url = 'https://p69test.example/anders' WHERE citymap_id = (SELECT id FROM citymap WHERE public_id = ${mapId(1)})`;
            const bad = await verifyCitymaps(database, payload, { features: fixtureFeatures(), overlay: overlay() });
            expect(bad.checks.find((entry) => entry.name === "wiki_assignment")?.passed).toBe(false);
        });
    });
});
