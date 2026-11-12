import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { Finding } from "../src/findings.ts";
import type { MapFeaturesPayload } from "../src/migration/map-features.ts";
import { importSources, SOURCE_TABLES } from "../src/migration/sources-import.ts";
import {
    transformSources,
    urlHash,
    type CarrierState,
    type SourceTargets,
    type SourcesTransform,
} from "../src/migration/sources.ts";
import { verifySources } from "../src/migration/verify-sources.ts";
import { cleanP3Fixtures, insertP3Carriers, P3 } from "./support/p3-fixture.ts";

/**
 * Feature-Quellen (WI-0063 P3, Migration 0066, Vertrag `sources.yaml`, D1): die reine Umwandlung mit kleinen synthetischen
 * Sätzen (Identität, Lizenz, Kanon, Waisen, E1+), dann Import, Stilllegen, Wiederaufnahme, Idempotenz, Wiedererkennung der
 * URL-losen Quellen, Tombstones, Lizenzentscheid des Korpus und Prüfer gegen echtes PostgreSQL.
 */

type Bag = Record<string, unknown>;

const FIXTURE_JUNCTION = "63ffffff-0000-4000-8000-0000000000aa";
const FIXTURE_MISSING_TERRITORY = "63ffffff-0000-4000-8000-0000000000bb";
const FIXTURE_MISSING_REGION = "63ffffff-0000-4000-8000-0000000000cc";
const FIXTURE_FREE_LABEL = "63ffffff-0000-4000-8000-0000000000dd";
const FIXTURE_CITYMAP = "63ffffff-0000-4000-8000-0000000000ee";

const LICENSE_KEYS = new Set([
    "cc0-1.0",
    "public-domain",
    "cc-by-4.0",
    "cc-by-sa-4.0",
    "cc-by-sa-3.0",
    "cc-by-nc-sa-3.0",
]);

function state(name: string, active = true): CarrierState {
    return { active, name };
}

function targets(over: Partial<SourceTargets> = {}): SourceTargets {
    return {
        places: new Map([
            [P3.ort, state("P3T Ort Eins")],
            [P3.ortZwei, state("P3T Ort Zwei")],
        ]),
        paths: new Map([
            [P3.weg, state("P3T Weg Eins")],
            [P3.wegZwei, state("P3T Weg Zwei")],
        ]),
        territories: new Map([[P3.gebiet, state("P3T Gebiet")]]),
        regions: new Map([
            [P3.region, state("P3T Region Eins")],
            [P3.regionZwei, state("P3T Region Zwei", false)],
        ]),
        peaks: new Map([
            [P3.gipfel, state("P3T Gipfel")],
            [P3.gipfelInaktiv, state("P3T Gipfel Inaktiv", false)],
        ]),
        powerlines: new Map([[P3.kraftlinie, state("P3T Kraftlinie Eins")]]),
        labels: new Set([P3.beschriftung]),
        licenseKeys: LICENSE_KEYS,
        ...over,
    };
}

const A = "https://p3test.example/a";
const B = "https://p3test.example/b";

function katalog(): Record<string, Bag> {
    return {
        "1": {
            url: A,
            label: "P3T Quelle A",
            type: "regelbuch",
            official: true,
            license: "cc-by-nc-sa-3.0",
            corpus: "p3test.example",
            attribution: "Wiki-Autor",
        },
        "2": { url: "", label: "P3T Urlos", type: "abenteuer", official: true },
        "3": { url: B, label: "P3T Quelle B", type: "briefspiel", official: false, license: "unfree" },
        "4": {
            url: "https://p3test.example/c",
            label: "P3T Quelle C",
            type: "gibtesnicht",
            official: false,
            license: "cc-by-9.9",
        },
        "5": {
            url: "https://p3test.example/d",
            label: "P3T Quelle D",
            type: "roman",
            official: true,
            license: "public-domain",
        },
    };
}

function verweise(): Record<string, Bag[]> {
    return {
        [`settlement:${P3.ort}`]: [
            { source_id: 1 },
            { source_id: 2, reference_kind: "ausfuehrlich", pages: "S. 5", note: "Hinweis", origin: "manual" },
        ],
        [`settlement:${P3.ortZwei}`]: [{ source_id: 99 }],
        [`path:${P3.weg}`]: [{ source_id: 1 }],
        [`path:${P3.wegZwei}`]: [{ source_id: 1 }],
        [`ecosystem:${P3.region}`]: [{ source_id: 3 }],
        [`region:${P3.gipfel}`]: [{ source_id: 4 }],
        [`region:${P3.beschriftung}`]: [{ source_id: 1 }],
        [`settlement:${FIXTURE_JUNCTION}`]: [{ source_id: 1 }],
        [`territory:${FIXTURE_MISSING_TERRITORY}`]: [{ source_id: 1 }, { source_id: 3 }],
        [`citymap:${FIXTURE_CITYMAP}`]: [{ source_id: 1 }],
    };
}

function kanon(): Record<string, Bag> {
    return {
        [`settlement:${P3.ort}`]: { kanon: "inoffiziell", bezeichner_type: "briefspiel", bezeichner_count: 2 },
        [`path:${P3.weg}`]: { kanon: "" },
        [`powerline:${P3.kraftlinie}`]: { kanon: "offiziell" },
        [`territory:${P3.gebiet}`]: { kanon: "inoffiziell", bezeichner_label: "Wiki Aventurica" },
        [`region:${P3.beschriftung}`]: { kanon: "offiziell" },
        [`ecosystem:${FIXTURE_MISSING_REGION}`]: { kanon: "inoffiziell", bezeichner_type: "sonstiges" },
    };
}

function quellenSatz(over: Bag = {}, revision = 9002): MapFeaturesPayload {
    const features = [
        { properties: { feature_type: "junction", public_id: FIXTURE_JUNCTION, name: "Kreuzung" } },
        {
            properties: {
                feature_type: "label",
                public_id: P3.beschriftung,
                name: "Gebundene Beschriftung",
                ecosystem_region_public_id: P3.region,
            },
        },
        { properties: { feature_type: "label", public_id: FIXTURE_FREE_LABEL, name: "Freie Beschriftung" } },
        {
            properties: {
                feature_type: "path",
                public_id: P3.weg,
                name: "P3T Weg Eins",
                display_name: "P3T Weg Eins",
                feature_subtype: "Strasse",
            },
        },
        {
            properties: {
                feature_type: "path",
                public_id: P3.wegZwei,
                name: "P3T Weg Zwei",
                display_name: "P3T Weg Zwei",
                feature_subtype: "Strasse",
            },
        },
    ];
    return {
        ok: true,
        revision,
        features,
        source_catalog: katalog(),
        feature_sources: verweise(),
        source_corpora: {
            "p3test.example": { label: "P3 Testkorpus", form: "belegstelle" },
            "wiki-aventurica.de": { label: "", form: "" },
        },
        feature_kanon: { vorgabe: "offiziell", abweichungen: kanon() },
        ...over,
    } as unknown as MapFeaturesPayload;
}

const finding = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((entry) => entry.code === code);

function rowOf(transformed: SourcesTransform, title: string): SourcesTransform["sources"][number] {
    const row = transformed.sources.find((entry) => entry.title === title);
    if (!row) throw new Error(`Quelle ${title} fehlt`);
    return row;
}

describe("D1: reine Umwandlung", () => {
    it("🔴 Identität: url: plus SHA-256 der Adresse wie geliefert, URL-lose vorläufig als legacy-id", () => {
        const transformed = transformSources(quellenSatz(), targets());
        const a = rowOf(transformed, "P3T Quelle A");
        expect(a).toMatchObject({ sourceKey: `url:${urlHash(A)}`, identityState: "final", url: A, legacyId: 1 });
        expect(urlHash(A)).toMatch(/^[0-9a-f]{64}$/);
        const urlos = rowOf(transformed, "P3T Urlos");
        expect(urlos).toMatchObject({ sourceKey: "legacy-id:2", identityState: "provisional", url: null, legacyId: 2 });
        expect(finding(transformed.findings, "source_identity_provisional")?.numbers).toMatchObject({ quellen: 1 });
    });

    it("🔴 mit Legacys Wiki-Schlüssel (E1) wird eine URL-lose Quelle endgültig: wikipub", () => {
        const catalog = katalog();
        catalog["2"] = { ...(catalog["2"] as Bag), wiki_key: "enzyklopaedia-aventurica" };
        const transformed = transformSources(quellenSatz({ source_catalog: catalog }), targets());
        expect(rowOf(transformed, "P3T Urlos")).toMatchObject({
            sourceKey: "wikipub:enzyklopaedia-aventurica",
            identityState: "final",
        });
    });

    it("🔴 Auszeichnung im Titel: Der Import bereinigt sie und meldet es, alles andere bleibt wörtlich", () => {
        const catalog = katalog();
        catalog["9"] = {
            url: "https://p3test.example/br",
            label: "Landkartenset <br />Das Dornenreich",
            type: "sonstiges",
        };
        catalog["10"] = { url: "https://p3test.example/spitz", label: "P3T Band <1>  zwei", type: "sonstiges" };
        const transformed = transformSources(quellenSatz({ source_catalog: catalog }), targets());
        expect(rowOf(transformed, "Landkartenset Das Dornenreich").url).toBe("https://p3test.example/br");
        expect(rowOf(transformed, "P3T Band <1>  zwei").url).toBe("https://p3test.example/spitz");
        expect(finding(transformed.findings, "source_title_markup")?.objectCount).toBe(1);
    });

    it("🔴 Lizenz und Namensnennung getrennt; leer heißt nie keine Lizenz; unfree und public-domain tragen keinen Schlüssel", () => {
        const transformed = transformSources(quellenSatz(), targets());
        expect(rowOf(transformed, "P3T Quelle A")).toMatchObject({
            licenseStatement: "license",
            licenseKey: "cc-by-nc-sa-3.0",
            attribution: "Wiki-Autor",
        });
        expect(rowOf(transformed, "P3T Urlos")).toMatchObject({
            licenseStatement: "unrecorded",
            licenseKey: null,
            attribution: null,
        });
        expect(rowOf(transformed, "P3T Quelle B")).toMatchObject({ licenseStatement: "unfree", licenseKey: null });
        expect(rowOf(transformed, "P3T Quelle D")).toMatchObject({
            licenseStatement: "public_domain",
            licenseKey: null,
        });
        // Ein Schlüssel, den der Katalog nicht kennt, wird nicht geraten.
        expect(rowOf(transformed, "P3T Quelle C")).toMatchObject({ licenseStatement: "unrecorded", licenseKey: null });
        expect(finding(transformed.findings, "source_license_unknown_key")?.objectCount).toBe(1);
        expect(finding(transformed.findings, "source_attribution_without_license")).toBeUndefined();
        expect(finding(transformed.findings, "source_license_without_attribution")?.objectCount).toBe(2);
        // Eine unbekannte Art ist sonstiges, mit Befund.
        expect(rowOf(transformed, "P3T Quelle C").sourceType).toBe("sonstiges");
        expect(finding(transformed.findings, "source_type_unknown")?.objectCount).toBe(1);
    });

    it("🔴 Verknüpfungen: je Träger an seiner Tabelle, Art, Seiten, Notiz, Herkunft und Position der Quelle; nichts vererbt", () => {
        const transformed = transformSources(quellenSatz(), targets());
        const byKind = (kind: string): string[] =>
            transformed.links
                .filter((link) => link.kind === kind)
                .map((link) => `${link.carrierPublicId.slice(-2)}>${link.sourceKey.slice(0, 8)}`);
        expect(transformed.links.filter((link) => link.kind === "place")).toEqual([
            {
                kind: "place",
                carrierPublicId: P3.ort,
                carrierName: "P3T Ort Eins",
                sourceKey: `url:${urlHash(A)}`,
                referenceKind: null,
                pages: null,
                note: null,
                legacyOrigin: null,
                position: 0,
            },
            {
                kind: "place",
                carrierPublicId: P3.ort,
                carrierName: "P3T Ort Eins",
                sourceKey: "legacy-id:2",
                referenceKind: "ausfuehrlich",
                pages: "S. 5",
                note: "Hinweis",
                legacyOrigin: "manual",
                position: 1,
            },
        ]);
        // Beide Wegabschnitte tragen ihre Quelle einzeln: keine Gruppe, keine Aggregation.
        expect(byKind("path")).toHaveLength(2);
        expect(transformed.links.filter((link) => link.kind === "region").map((link) => link.carrierPublicId)).toEqual([
            P3.region,
        ]);
        expect(
            transformed.links.filter((link) => link.kind === "terrain_peak").map((link) => link.carrierPublicId),
        ).toEqual([P3.gipfel]);
        expect(transformed.links.some((link) => link.kind === "territory")).toBe(false);
        // Die Quellen der gebundenen Beschriftung hängen an der Region, nie an der Beschriftung.
        expect(transformed.links.some((link) => link.carrierPublicId === P3.beschriftung)).toBe(false);
        // Auch das ist Quellen-Herkunft des Trägers selbst: die Quelle trägt ihre Zitierer.
        expect(rowOf(transformed, "P3T Quelle A").carriers).toEqual([
            `path:${P3.weg}`,
            `path:${P3.wegZwei}`,
            `place:${P3.ort}`,
        ]);
    });

    it("Waisen, Zurückgestelltes und Verweise ohne Katalogzeile ergeben zusammen die Verweise des Satzes", () => {
        const transformed = transformSources(quellenSatz(), targets());
        const totals = transformed.linkTotals;
        expect(totals).toMatchObject({ total: 12, resolved: 6, orphan: 4, deferred: 1, skipped: 1 });
        expect(totals.resolved + totals.orphan + totals.deferred + totals.skipped).toBe(totals.total);
        const orphan = finding(transformed.findings, "orphan_link");
        expect(orphan?.numbers).toMatchObject({
            "region/bound_label/verknuepfungen": 1,
            "settlement/junction/verknuepfungen": 1,
            "territory/missing/verknuepfungen": 2,
        });
        expect(finding(transformed.findings, "carrier_is_junction")?.objectCount).toBe(1);
        expect(finding(transformed.findings, "link_deferred_citymap")?.numbers).toEqual({
            verknuepfungen: 1,
            traeger: 1,
        });
        expect(finding(transformed.findings, "link_without_catalog_row")?.objectCount).toBe(1);
        expect(finding(transformed.findings, "catalog_row_without_link")?.numbers).toEqual({ zeilen: 1 });
    });

    it("🔴 Kanon: Legacys Ergebnis als Anfangsstand, die Vorgabe ausgeschrieben, gebundene Beschriftungen und Fehlendes nur als Befund", () => {
        const transformed = transformSources(quellenSatz(), targets());
        const canonOf = (publicId: string): string =>
            transformed.canon
                .filter((row) => row.carrierPublicId === publicId)
                .map(
                    (row) =>
                        `${row.canon}/${String(row.designatorType)}/${String(row.designatorCount)}/${String(row.designatorLabel)}/${row.derivedFrom}`,
                )
                .join();
        expect(canonOf(P3.ort)).toBe("unofficial/briefspiel/2/null/legacy_feature_kanon");
        expect(canonOf(P3.weg)).toBe("unlabelled/null/null/null/legacy_feature_kanon");
        expect(canonOf(P3.kraftlinie)).toBe("official/null/null/null/legacy_feature_kanon");
        expect(canonOf(P3.gebiet)).toBe("unofficial/null/null/Wiki Aventurica/legacy_feature_kanon");
        // Mit Verweisen und ohne Eintrag: die Vorgabe offiziell, ausgeschrieben.
        expect(canonOf(P3.wegZwei)).toBe("official/null/null/null/legacy_feature_kanon_default");
        expect(canonOf(P3.region)).toBe("official/null/null/null/legacy_feature_kanon_default");
        expect(canonOf(P3.gipfel)).toBe("official/null/null/null/legacy_feature_kanon_default");
        // Gebundene Beschriftung (steht unter ecosystem:) und fehlende Region: keine Zeile.
        expect(canonOf(P3.beschriftung)).toBe("");
        expect(finding(transformed.findings, "kanon_entry_bound_label")?.numbers).toEqual({ eintraege: 1 });
        expect(finding(transformed.findings, "kanon_entry_unresolvable")?.numbers).toEqual({ eintraege: 1 });
        expect(transformed.canon.map((row) => row.kind).sort()).toEqual([
            "path",
            "path",
            "place",
            "place",
            "powerline",
            "region",
            "terrain_peak",
            "territory",
        ]);
    });

    it("🔴 keine Quelle, kein Tor: ein fehlender Block oder ein leerer Katalog überspringt den Schritt mit Befund", () => {
        for (const over of [
            { source_catalog: undefined },
            { feature_sources: "kaputt" },
            { feature_kanon: {} },
            { source_catalog: {} },
        ]) {
            const transformed = transformSources(quellenSatz(over), targets());
            expect(transformed.skipped).toBe(true);
            expect(transformed.sources).toEqual([]);
            expect(finding(transformed.findings, "source_block_missing")).toBeDefined();
        }
    });

    it("E1+: die unterdrückten Verknüpfungen werden gelesen, in beiden Formen; ohne den Block gilt suppressed_not_exported", () => {
        const none = transformSources(quellenSatz(), targets());
        expect(none.tombstoneBlock).toBe("absent");
        expect(none.tombstones).toEqual([]);
        expect(finding(none.findings, "suppressed_not_exported")).toBeDefined();

        const asList = transformSources(
            quellenSatz({
                feature_sources_suppressed: [
                    { entity_type: "settlement", entity_public_id: P3.ortZwei, source_id: 1, origin: "manual" },
                ],
            }),
            targets(),
        );
        expect(asList.tombstoneBlock).toBe("present");
        expect(asList.tombstones).toEqual([
            {
                kind: "place",
                carrierPublicId: P3.ortZwei,
                carrierName: "P3T Ort Zwei",
                sourceKey: `url:${urlHash(A)}`,
                legacyOrigin: "manual",
                referenceKind: null,
                pages: null,
                note: null,
                position: 0,
            },
        ]);
        expect(finding(asList.findings, "suppressed_not_exported")).toBeUndefined();
        expect(finding(asList.findings, "suppressed_imported")?.numbers).toEqual({ tombstones: 1 });

        const asObject = transformSources(
            quellenSatz({
                feature_sources_suppressed: {
                    [`settlement:${P3.ortZwei}`]: [{ source_id: 1, origin: "wiki_publication" }],
                },
            }),
            targets(),
        );
        expect(asObject.tombstones.map((entry) => entry.legacyOrigin)).toEqual(["wiki_publication"]);

        // Genehmigt UND unterdrückt: widersprüchlich, genehmigt gewinnt. Unauflösbar: ausgelassen.
        const mixed = transformSources(
            quellenSatz({
                feature_sources_suppressed: [
                    { entity_type: "settlement", entity_public_id: P3.ort, source_id: 1 },
                    { entity_type: "territory", entity_public_id: FIXTURE_MISSING_TERRITORY, source_id: 1 },
                ],
            }),
            targets(),
        );
        expect(mixed.tombstones).toEqual([]);
        expect(finding(mixed.findings, "suppressed_link_also_approved")?.objectCount).toBe(1);
        expect(finding(mixed.findings, "suppressed_unresolvable")?.objectCount).toBe(1);

        expect(transformSources(quellenSatz({ feature_sources_suppressed: "kaputt" }), targets()).tombstoneBlock).toBe(
            "unusable",
        );
    });

    it("A13: eine Antwort, die nicht ok meldet, hält an", () => {
        expect(() => transformSources({ ok: false, revision: 1, features: [{}] }, targets())).toThrow();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Gegen PostgreSQL
// ---------------------------------------------------------------------------------------------------------------------

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("D1 gegen PostgreSQL (Migration 0066)", () => {
    let database: Database;

    const count = async (table: string, where = "TRUE"): Promise<number> => {
        const [row] = await database.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
        return row?.n ?? 0;
    };
    const violation = async (work: Promise<unknown>): Promise<string> => {
        try {
            await work;
        } catch (error) {
            if (error instanceof postgres.PostgresError) return `${error.code} ${error.constraint_name ?? ""}`.trim();
            throw error;
        }
        return "ging durch";
    };

    beforeAll(async () => {
        // Die Testdaten entstehen mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand.
        legacyImportOffen();
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanP3Fixtures(database);
        await insertP3Carriers(database);
    }, 120_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await cleanP3Fixtures(database);
        await database.end({ timeout: 5 });
    });

    /**
     * 🔴 OPS-000066: Ist die einzige offizielle Quelle eines Orts „ausführlich“ (eine Publikation), ist der Ort nach dem Zug offiziell. Legacy zählt
     * Publikationen nicht und sagt nichts (`kanon: ""`); der Zug schreibt die Regel von Avesmaps3D (Vali 2026-10-25), und der Prüfer misst gegen sie.
     */
    it("🔴 der Legacy-Import lässt die Quellen aus, solange sie dem WikiSync gehören: skipped, Befund bereich_wikisync, nichts geschrieben", async () => {
        vi.restoreAllMocks();
        try {
            const vorher = await count("feature_source", "title LIKE 'P3T%'");
            const report = await importSources(database, quellenSatz());
            expect(report.skipped).toBe(true);
            expect(report.changed).toBe(false);
            expect(report.findings.map((finding) => finding.code)).toEqual(["bereich_wikisync"]);
            expect(await count("feature_source", "title LIKE 'P3T%'")).toBe(vorher);
        } finally {
            legacyImportOffen();
        }
    });

    it("🔴 der Prüfer findet Parität zwischen Antwort und Bestand (der Bestand entsteht mit dem Schreibweg des Imports)", async () => {
        await importSources(database, quellenSatz());
        const parity = await verifySources(database, quellenSatz());
        expect(parity.checks.filter((entry) => !entry.passed).map((entry) => `${entry.name}: ${entry.detail}`)).toEqual(
            [],
        );
        expect(parity.passed).toBe(true);
        expect(parity.checks.map((entry) => entry.name)).toEqual(
            expect.arrayContaining([
                "catalog_parity",
                "link_parity",
                "canon_parity",
                "structure",
                "no_orphans",
                "license_consistent",
                "tombstones",
            ]),
        );
    });

    it("Schema: Lizenzaussage und Schlüssel stimmen, die Adresse trägt ihren Hash, Zustand und Aktivität gehören zusammen", async () => {
        const hash = urlHash("https://p3test.example/schema");
        const insert = (extra: string, values: string): Promise<unknown> =>
            database.unsafe(
                `INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official${extra}) VALUES ('url:${hash}', 'final', 'https://p3test.example/schema', 'P3T Schema', 'roman', TRUE${values})`,
            );
        // Eine Lizenz braucht ihren Schlüssel; ein Schlüssel nur bei einer Lizenz.
        expect(await violation(insert(", license_statement", ", 'license'"))).toBe(
            "23514 feature_source_license_key_matches_statement",
        );
        expect(await violation(insert(", license_statement, license_key", ", 'unfree', 'cc0-1.0'"))).toBe(
            "23514 feature_source_license_key_matches_statement",
        );
        expect(await violation(insert(", license_statement", ", 'geraten'"))).toBe(
            "23514 feature_source_license_statement_known",
        );
        // Der Schlüssel steht im Lizenzkatalog.
        expect(await violation(insert(", license_statement, license_key", ", 'license', 'cc-by-9.9'"))).toBe(
            "23503 feature_source_license_key_fkey",
        );
        // Eine Adresse mit fremdem Hash ist keine url:-Identität.
        expect(
            await violation(
                database.unsafe(
                    `INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official) VALUES ('url:${"0".repeat(64)}', 'final', 'https://p3test.example/schema', 'P3T Schema', 'roman', TRUE)`,
                ),
            ),
        ).toBe("23514 feature_source_url_is_the_key");
        // Vorläufig ist nur legacy-id.
        expect(
            await violation(
                database.unsafe(
                    `INSERT INTO feature_source (source_key, identity_state, title, source_type, is_official) VALUES ('legacy-id:424242', 'final', 'P3T Schema', 'roman', TRUE)`,
                ),
            ),
        ).toBe("23514 feature_source_identity_matches_key");
        // Gespeichert wird eine gültige Zeile; Titel sind keine Identität (derselbe Titel zweimal geht).
        await insert("", "");
        await database.unsafe(
            `INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official) VALUES ('legacy-id:424243', 'provisional', 424243, 'P3T Schema', 'roman', TRUE)`,
        );
        const [source] = await database<
            { id: string }[]
        >`SELECT id::text FROM feature_source WHERE source_key = ${`url:${hash}`}`;
        const [place] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${P3.ortLeer}`;
        const link = (state: string, active: string, extra = ""): Promise<unknown> =>
            database.unsafe(
                `INSERT INTO place_source (place_id, source_id, position, state, is_active${extra}) VALUES (${place?.id as string}, ${source?.id as string}, 0, '${state}', ${active})`,
            );
        expect(await violation(link("retired", "TRUE"))).toBe("23514 place_source_state_matches_activity");
        expect(await violation(link("retired", "FALSE"))).toBe("23514 place_source_retired_consistent");
        expect(await violation(link("geraten", "TRUE"))).toBe("23514 place_source_state_known");
        await link("active", "TRUE");
        // Je (Träger, Quelle) höchstens eine Verknüpfung.
        expect(await violation(link("active", "TRUE"))).toBe("23505 place_source_pair_unique");
        // Kanon: Bezeichner nicht bei unlabelled (seit 0223 auch bei official erlaubt, Vali 2026-10-25), Anzahl ab zwei.
        const canonInsert = (values: string): Promise<unknown> =>
            database.unsafe(
                `INSERT INTO place_canon (place_id, canon, designator_label) VALUES (${place?.id as string}, ${values})`,
            );
        expect(await violation(canonInsert("'unlabelled', 'Wiki Aventurica'"))).toBe(
            "23514 place_canon_designator_not_unlabelled",
        );
        expect(
            await violation(
                database.unsafe(
                    `INSERT INTO place_canon (place_id, canon, designator_count) VALUES (${place?.id as string}, 'unofficial', 1)`,
                ),
            ),
        ).toBe("23514 place_canon_designator_count_from_two");
    });

    it("🔴 Struktur: keine entity_type-Spalte, kein JSON-Typ, jede Tabelle von D1 gibt es", async () => {
        const forbidden = await database<{ table_name: string; column_name: string }[]>`
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ANY(${[...SOURCE_TABLES]}::text[])
              AND (column_name = 'entity_type' OR data_type IN ('json', 'jsonb'))
        `;
        expect(forbidden).toEqual([]);
        const present = await database<{ table_name: string }[]>`
            SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${[...SOURCE_TABLES]}::text[])
        `;
        expect(present).toHaveLength(SOURCE_TABLES.length);
        // Eine zweite Lizenzliste gibt es nicht: die Schlüssel verweisen auf license_catalog.
        const fks = await database<{ table_name: string; ref_table: string }[]>`
            SELECT c.conrelid::regclass::text AS table_name, c.confrelid::regclass::text AS ref_table
            FROM pg_constraint c WHERE c.contype = 'f' AND c.conname IN ('feature_source_license_key_fkey', 'source_corpus_license_key_fkey')
        `;
        expect(fks.map((row) => row.ref_table)).toEqual(["license_catalog", "license_catalog"]);
    });
});
