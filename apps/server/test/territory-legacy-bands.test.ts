import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLegacyGenericRootName, legacyDisplayByBand } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { oracleInputFromExport } from "../src/territories/legacy-oracle.ts";
import { verifyLegacyBands, verifyOwnBands } from "../src/territories/verify-legacy-bands.ts";

/**
 * Nachweis je Band 0 bis 8 (WI-0209 N1): Legacys Anzeigeregel als zweite Rechnung (`territory-display-rule.ts`) und ihr Vergleich mit
 * unserer Ableitung. Benannte Fälle je Regel, weil der echte Bestand manche Regel nie auslöst (das eigene Band einer Fläche
 * ändert an den echten Daten keine einzige Zuordnung, gemessen 2026-10-16).
 */

const ID = (n: number): string => `77777780-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const MAP_DOMAIN = "aventuria";
const JAHR = 1049;

function gebiet(
    n: number,
    name: string,
    parent: number | null,
    band: [number | null, number | null],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: ID(n),
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: parent === null ? null : ID(parent),
        status: "abhängige Provinz",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: n,
        updated_at: "2026-10-16 12:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
        ...extra,
    };
}
function quadrat(x: number, y: number, k = 40): number[][] {
    return [
        [x, y],
        [x + k, y],
        [x + k, y + k],
        [x, y + k],
        [x, y],
    ];
}
function flaeche(
    n: number,
    territory: number,
    x: number,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: ID(0x100 + n),
        territory_public_id: ID(territory),
        geometry: { type: "Polygon", coordinates: [quadrat(x, 100)] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: null,
        max_zoom: null,
        updated_at: "2026-10-16 12:00:00",
        ...extra,
    };
}

/** Ein Reich mit Provinz, Grafschaft und Baronien; jede Regel des Orakels hat hier einen Fall. */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-baender",
        territories: [
            gebiet(1, "Probereich", null, [0, 1], { type: "Kaiserreich" }),
            gebiet(2, "Probeprovinz", 1, [2, 2], { type: "Herzogtum" }),
            gebiet(3, "Probegrafschaft", 2, [3, 3], { type: "Grafschaft" }),
            gebiet(4, "Baronie Breit", 3, [4, 6]),
            // Eigenes Band der Fläche 5 bis 6: in Band 4 zeigt sich die Baronie zwar selbst, ihre Fläche aber nicht.
            gebiet(5, "Baronie Eigenband", 3, [4, 6]),
            // Abgelaufen 1000: die alte Fläche bleibt nur, solange keine jüngere sie ablöst.
            gebiet(6, "Baronie Formwechsel", 3, [4, 6]),
            // Gleichstand der Spanne mit dem Elter: das tiefere Glied gewinnt.
            gebiet(7, "Gleichstandsprovinz", 1, [2, 6], { type: "Herzogtum" }),
            gebiet(8, "Baronie Gleichstand", 7, [2, 6]),
            // Unter einem Sammelknoten: der Knoten ist kein Elter, die Baronie steht als Reich.
            gebiet(9, "Unabhängig", null, [0, 6], { type: "Sammlung" }),
            gebiet(10, "Baronie Frei", 9, [0, 6]),
            // Ein Elter, der 1049 nicht mehr gilt, beendet die Kette.
            gebiet(11, "Aufgelöstes Reich", null, [0, 1], { valid_to_bf: 1000 }),
            gebiet(12, "Baronie Nachfolge", 11, [3, 6]),
        ],
        geometries: [
            flaeche(1, 4, 100),
            flaeche(2, 5, 140, { min_zoom: 5, max_zoom: 6 }),
            flaeche(3, 6, 180, { valid_from_bf: 0, valid_to_bf: 1000 }),
            flaeche(4, 6, 180, { valid_from_bf: 1001 }),
            flaeche(5, 8, 220),
            flaeche(6, 10, 260),
            flaeche(7, 12, 300),
        ],
        claims: [],
    } as LegacyTerritoryPayload;
}

describe("Legacy-Orakel: Legacys Anzeigeregel je Band", () => {
    const bands = legacyDisplayByBand(oracleInputFromExport(quelle()), JAHR, 8);
    const zeigt = (band: number, flaecheNr: number): string | undefined => bands[band]?.get(ID(0x100 + flaecheNr));

    it("die engste Spanne gewinnt: Reich in 0 und 1, Provinz in 2, Grafschaft in 3, Baronie ab 4", () => {
        expect([0, 1, 2, 3, 4, 5, 6].map((b) => zeigt(b, 1))).toEqual([
            ID(1),
            ID(1),
            ID(2),
            ID(3),
            ID(4),
            ID(4),
            ID(4),
        ]);
    });
    it("über 6 klemmt Legacy auf 6: Band 7 und 8 zeigen, was Band 6 zeigt", () => {
        for (const n of [1, 2, 4, 5, 6, 7]) expect([zeigt(7, n), zeigt(8, n)]).toEqual([zeigt(6, n), zeigt(6, n)]);
    });
    it("eigenes Band der Fläche: zeigt sich das Gebiet selbst, muss auch das Band der Fläche passen", () => {
        expect(zeigt(4, 2)).toBeUndefined();
        expect([zeigt(5, 2), zeigt(6, 2)]).toEqual([ID(5), ID(5)]);
        expect(zeigt(3, 2)).toBe(ID(3)); // unter der Grafschaft gilt deren Band, nicht das der Fläche
    });
    it("aktuelle Form: die abgelaufene Fläche weicht der jüngeren", () => {
        expect(zeigt(5, 3)).toBeUndefined();
        expect(zeigt(5, 4)).toBe(ID(6));
    });
    it("Gleichstand der Spanne: das tiefere Glied gewinnt", () => {
        expect([2, 4, 6].map((b) => zeigt(b, 5))).toEqual([ID(8), ID(8), ID(8)]);
    });
    it("ein Sammelknoten ist kein Elter: die Baronie darunter steht als Reich", () => {
        expect(["Unabhängig", "Umstritten (Grenzland)", "Ungeklärt"].map(isLegacyGenericRootName)).toEqual([
            true,
            true,
            true,
        ]);
        // Legacy sucht das Wort selbst (Wortgrenze): „Unabhängige Baronien“ und „Umstrittene Gebiete“ sind gewöhnliche Gebiete.
        expect(
            ["Unabhängige Baronien", "Umstrittene Gebiete", "Heiliges Neues Kaiserreich"].map(isLegacyGenericRootName),
        ).toEqual([false, false, false]);
        expect([0, 3, 6].map((b) => zeigt(b, 6))).toEqual([ID(10), ID(10), ID(10)]);
    });
    it("ein Elter, der im Jahr nicht gilt, beendet die Kette; davor zeigt das Band nichts (Lücke)", () => {
        expect([zeigt(0, 7), zeigt(2, 7)]).toEqual([undefined, undefined]);
        expect([zeigt(3, 7), zeigt(6, 7)]).toEqual([ID(12), ID(12)]);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Nachweis je Band gegen PostGIS: Import, Ableitung und Legacys Regel stimmen überein", () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        const eigene = `(SELECT id FROM territory WHERE public_id::text LIKE '77777780-%')`;
        await database.unsafe(`DELETE FROM territory_border WHERE territory_id IN ${eigene}`);
        await database
            .unsafe(`DELETE FROM territory_capital_band WHERE territory_id IN ${eigene}`)
            .catch(() => undefined);
        await database.unsafe(`DELETE FROM territory_shape WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_display_area WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_claim WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_area WHERE public_id::text LIKE '77777780-%'`);
        await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '77777780-%'`);
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '77777780-%'`);
        await database.unsafe(
            `DELETE FROM territory_state WHERE map_domain_id = '${MAP_DOMAIN}' AND source_stamp = 'pt-fixture-baender'`,
        );
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        await importTerritories(database, quelle());
        await deriveTerritories(database, { force: true });
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("in jedem Band 0 bis 8 dieselbe Zuordnung je Fläche, dieselben Eltern und Tiefen", async () => {
        const report = await verifyLegacyBands(database, quelle());
        for (const band of report.bands)
            expect({ band: band.band, abweichend: band.differences }).toEqual({ band: band.band, abweichend: [] });
        expect(report.hierarchy.parentMismatches).toEqual([]);
        expect(report.hierarchy.effectiveMismatches).toEqual([]);
        expect(report.passed).toBe(true);
    });

    it("eine verfälschte Zuordnung fällt auf, mit Fläche und beiden Gebieten", async () => {
        const [row] = await database<{ band: number; area_id: number }[]>`
            SELECT da.band::int AS band, da.area_id::int FROM territory_display_area da
            JOIN territory_area a ON a.id = da.area_id WHERE a.public_id = ${ID(0x101)} AND da.band = 5
        `;
        expect(row).toBeDefined();
        const [reich] = await database<{ id: number }[]>`SELECT id::int FROM territory WHERE public_id = ${ID(1)}`;
        await database`UPDATE territory_display_area SET territory_id = ${reich!.id} WHERE band = 5 AND area_id = ${row!.area_id}`;
        try {
            const report = await verifyLegacyBands(database, quelle());
            const band5 = report.bands[5]!.differences;
            expect(band5).toEqual([expect.objectContaining({ area: ID(0x101), why: "anderes Anzeigegebiet" })]);
            expect(band5[0]!.legacy).toContain("Baronie Breit");
            expect(band5[0]!.ours).toContain("Probereich");
            expect(report.passed).toBe(false);
        } finally {
            await deriveTerritories(database, { force: true });
        }
    });

    it("N2 aus der Datenbank: dieselbe Regel auf unseren Tafeln stimmt nach dem Import in jedem Band", async () => {
        const report = await verifyOwnBands(database);
        expect(report.quelle).toBe("datenbank");
        expect(report.derivedMaxBand).toBe(8);
        for (const band of report.bands)
            expect({ band: band.band, abweichend: band.differences }).toEqual({ band: band.band, abweichend: [] });
        expect(report.hierarchy.effectiveMismatches).toEqual([]);
        expect(report.passed).toBe(true);
    });

    it("N2 nach einer Änderung wie im Editor: neuer Elter und neue Spanne, neu abgeleitet; die Regel auf unseren Tafeln stimmt, Legacy nicht mehr", async () => {
        const ids = new Map(
            (
                await database<{ public_id: string; id: number }[]>`
                SELECT public_id::text, id::int FROM territory WHERE public_id IN (${ID(3)}, ${ID(7)}, ${ID(8)})
            `
            ).map((r) => [r.public_id, r.id]),
        );
        // Die Baronie unter der Gleichstandsprovinz hängt um unter die Grafschaft und zeigt sich erst ab Band 5.
        await database`UPDATE territory SET parent_id = ${ids.get(ID(3))!}, min_zoom = 5 WHERE public_id = ${ID(8)}`;
        try {
            await deriveTerritories(database, { force: true });
            const eigen = await verifyOwnBands(database);
            for (const band of eigen.bands)
                expect({ band: band.band, abweichend: band.differences }).toEqual({ band: band.band, abweichend: [] });
            expect(eigen.hierarchy.effectiveMismatches).toEqual([]);
            expect(eigen.passed).toBe(true);
            // Die Fläche der Baronie: Reich in 0 und 1, Provinz in 2, Grafschaft in 3, Lücke in 4, die Baronie ab 5.
            const zeile = await database<{ band: number; gebiet: string }[]>`
                SELECT da.band::int AS band, t.public_id::text AS gebiet FROM territory_display_area da
                JOIN territory_area a ON a.id = da.area_id JOIN territory t ON t.id = da.territory_id
                WHERE a.public_id = ${ID(0x105)} ORDER BY da.band
            `;
            expect(zeile.map((z) => [z.band, z.gebiet])).toEqual([
                [0, ID(1)],
                [1, ID(1)],
                [2, ID(2)],
                [3, ID(3)],
                [5, ID(8)],
                [6, ID(8)],
                [7, ID(8)],
                [8, ID(8)],
            ]);
            // Gegen Legacys Export weicht es jetzt ab, und genau dort.
            const legacy = await verifyLegacyBands(database, quelle());
            expect(legacy.passed).toBe(false);
            expect(legacy.hierarchy.parentMismatches).toEqual([expect.stringContaining(ID(8))]);
            expect(legacy.bands[2]!.differences).toEqual([
                expect.objectContaining({ area: ID(0x105), why: "anderes Anzeigegebiet" }),
            ]);
            expect(legacy.bands[4]!.differences).toEqual([
                expect.objectContaining({ area: ID(0x105), why: "nur in Legacy gezeigt" }),
            ]);
        } finally {
            await database`UPDATE territory SET parent_id = ${ids.get(ID(7))!}, min_zoom = 2 WHERE public_id = ${ID(8)}`;
            await deriveTerritories(database, { force: true });
        }
    });

    it("N2: eine verfälschte Zuordnung fällt auch ohne Export auf", async () => {
        const [row] = await database<{ area_id: number }[]>`
            SELECT da.area_id::int FROM territory_display_area da
            JOIN territory_area a ON a.id = da.area_id WHERE a.public_id = ${ID(0x101)} AND da.band = 5
        `;
        const [reich] = await database<{ id: number }[]>`SELECT id::int FROM territory WHERE public_id = ${ID(1)}`;
        await database`UPDATE territory_display_area SET territory_id = ${reich!.id} WHERE band = 5 AND area_id = ${row!.area_id}`;
        try {
            const report = await verifyOwnBands(database);
            expect(report.bands[5]!.differences).toEqual([
                expect.objectContaining({ area: ID(0x101), why: "anderes Anzeigegebiet" }),
            ]);
            expect(report.passed).toBe(false);
        } finally {
            await deriveTerritories(database, { force: true });
        }
    });
});
