import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    politicalTileMinBand,
    TERRITORY_POINTER_URL,
    parseTerritoryPointer,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MigrationAborted } from "../src/migration/places.ts";
import {
    cleanGeometry,
    normalizeValidTo,
    transformTerritories,
    type LegacyTerritoryPayload,
} from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { verifyTerritories } from "../src/migration/verify-territories.ts";
import {
    computeDerivation,
    deriveTerritories,
    readDeriveInputs,
    territoryRevision,
    type DeriveInputs,
} from "../src/territories/derive.ts";
import { legacyBandDifferences, verifyTerritoryShapes } from "../src/territories/verify-derived.ts";
import { readMvt } from "./support/mvt.ts";

/**
 * Die Herrschaftsgebiete (WI-0062, ADR-0014): Umwandlung (rein), Import, Ableitung, Prüfer und Kacheln gegen echtes
 * PostGIS (Kapitel 11.10).
 *
 * Die Fixture ist ein kleines Reich in der Kartenmitte: Reich → zwei Provinzen → vier Baronien, die sich Kanten teilen
 * (so wie Legacys gesnappte Flächen). Eine Baronie ist eine Schleife (ungültig), eine trägt ein entartetes Polygon.
 */

const ID = (n: number): string => `77777777-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const PROVINZ_1 = ID(2);
const PROVINZ_2 = ID(3);
const BARONIE_1 = ID(4);
const BARONIE_2 = ID(5);
const BARONIE_3 = ID(6);
const BARONIE_4 = ID(7);
const PLATZHALTER = ID(8);
const ORT = ID(9);
const FLAECHE = (n: number): string => ID(0x100 + n);

/**
 * Ein Rechteck mit einem Stützpunkt in der Mitte jeder Kante. Benachbarte Rechtecke teilen ihre Kante samt Mittelpunkt
 * (wie Legacys gesnappte Flächen), und die Vereinigung behält die Punkte: die Hüllen haben mehr als die acht Stützpunkte,
 * die die Namen entlang der Grenze verlangen (`borderName.minPoints`).
 */
function quadrat(x: number, y: number, breite = 40, hoehe = 40): number[][] {
    return [
        [x, y],
        [x + breite / 2, y],
        [x + breite, y],
        [x + breite, y + hoehe / 2],
        [x + breite, y + hoehe],
        [x + breite / 2, y + hoehe],
        [x, y + hoehe],
        [x, y + hoehe / 2],
        [x, y],
    ];
}

function gebiet(
    publicId: string,
    name: string,
    parent: string | null,
    band: [number | null, number | null],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: publicId,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: parent,
        status: "abhängige Provinz",
        color: "#B2B065",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name.toLowerCase().replaceAll(" ", "-")}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 1,
        updated_at: "2026-09-18 19:38:14.964",
        coat_of_arms_url: "/uploads/wappen/x.png?v=1",
        coat_license_status: "public_domain",
        coat_origin: "own",
        ...extra,
    };
}

function flaeche(
    n: number,
    territory: string,
    coordinates: number[][][] | number[][][][],
    type = "Polygon",
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: FLAECHE(n),
        territory_public_id: territory,
        geometry: { type, coordinates },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 4,
        max_zoom: 6,
        updated_at: "2026-09-14 02:21:11.083",
        ...extra,
    };
}

function quelle(overrides: Partial<LegacyTerritoryPayload> = {}): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 157006,
        territories_revision: "pt-fixture-1",
        territories: [
            gebiet(REICH, "Testreich", null, [0, 1], {
                type: "Kaiserreich",
                color: "#35b145",
                opacity: 0.33,
                capital_place_public_id: null,
            }),
            gebiet(PROVINZ_1, "Provinz Nord", REICH, [2, 3], { type: "Herzogtum", capital_place_public_id: ORT }),
            gebiet(PROVINZ_2, "Provinz Süd", REICH, [2, 3], { type: "Herzogtum" }),
            gebiet(BARONIE_1, "Baronie Eins", PROVINZ_1, [4, 6]),
            gebiet(BARONIE_2, "Baronie Zwei", PROVINZ_1, [4, 6]),
            gebiet(BARONIE_3, "Baronie Drei", PROVINZ_2, [4, 6]),
            gebiet(BARONIE_4, "Baronie Vier", PROVINZ_2, [4, 6]),
            gebiet(PLATZHALTER, "Neues Herrschaftsgebiet (1)", null, [null, null], {
                type: "Herrschaftsgebiet",
                valid_from_bf: null,
                coat_of_arms_url: "",
                coat_license_status: "",
                coat_origin: "",
            }),
        ],
        geometries: [
            // Baronie Eins trägt außerdem ein entartetes Polygon (zwei Punkte statt eines Rings).
            flaeche(
                1,
                BARONIE_1,
                [
                    [quadrat(300, 300)],
                    [
                        [
                            [1, 1],
                            [2, 2],
                            [2, 2],
                            [1, 1],
                        ],
                    ],
                ],
                "MultiPolygon",
            ),
            flaeche(2, BARONIE_2, [quadrat(340, 300)]),
            flaeche(3, BARONIE_3, [quadrat(380, 300)]),
            // Baronie Vier ist ungültig: ein Loch liegt außerhalb der Fläche (Legacys zweite Sorte Schaden neben den
            // Schleifen). Sie wird unverändert gespeichert; die Ableitung repariert beim Lesen.
            flaeche(4, BARONIE_4, [quadrat(420, 300), quadrat(480, 300, 10, 10)]),
        ],
        claims: [{ territory_public_id: BARONIE_3, claimant_public_id: BARONIE_4, sort_order: 0, source: "wiki" }],
        ...overrides,
    };
}

describe("Herrschaftsgebiete umwandeln (rein)", () => {
    it("🔴 Offen ist null oder 9999, beides wird null (Fallen des Exports)", () => {
        expect(normalizeValidTo(null, 9999)).toEqual({ value: null, sentinel: false });
        expect(normalizeValidTo(9999, 9999)).toEqual({ value: null, sentinel: true });
        expect(normalizeValidTo(1028, 9999)).toEqual({ value: 1028, sentinel: false });
        const result = transformTerritories(quelle());
        expect(result.territories.every((t) => t.validToBf === null)).toBe(true);
        expect(result.openEndSentinels).toBe(8);
    });

    it("🔴 überspringt entartete Ringe: ein entarteter äußerer Ring nimmt sein Polygon, ein innerer fällt weg", () => {
        const entartet = [
            [1, 1],
            [2, 2],
            [2, 2],
            [1, 1],
        ];
        const cleaned = cleanGeometry({
            type: "MultiPolygon",
            coordinates: [[quadrat(300, 300), entartet], [entartet], [quadrat(400, 400)]],
        });
        expect(cleaned?.droppedPolygons).toBe(1);
        expect(cleaned?.droppedHoles).toBe(1);
        expect(cleaned?.coordinates).toHaveLength(2);
        expect(cleaned?.coordinates[0]).toHaveLength(1);
        const flat = transformTerritories(quelle());
        expect(flat.areas[0]?.droppedPolygons).toBe(1);
        expect(flat.areasWithDroppedParts).toBe(1);
        // Ein Polygon wird eingepackt, ein MultiPolygon bleibt.
        expect(flat.areas[1]?.coordinates).toHaveLength(1);
    });

    it("überspringt eine Fläche ohne lesbare Geometrie und meldet sie", () => {
        const result = transformTerritories(
            quelle({
                geometries: [
                    { public_id: FLAECHE(1), territory_public_id: BARONIE_1, geometry: null },
                    {
                        public_id: FLAECHE(2),
                        territory_public_id: BARONIE_2,
                        geometry: { type: "LineString", coordinates: [] },
                    },
                    flaeche(3, BARONIE_3, [
                        [
                            [1, 1],
                            [2, 2],
                            [2, 2],
                            [1, 1],
                        ],
                    ]),
                ],
            }),
        );
        expect(result.areas).toEqual([]);
        expect(result.skippedAreas.map((skipped) => skipped.reason)).toEqual([
            "geometry_null",
            "geometry_unreadable",
            "nothing_left",
        ]);
    });

    it("🔴 bricht ab statt einen Baum mit Lücke zu bauen: fehlender Elter, Zyklus, Fläche ohne Gebiet, doppelte Kennung", () => {
        const territories = quelle().territories as Record<string, unknown>[];
        expect(() =>
            transformTerritories(quelle({ territories: [gebiet(BARONIE_1, "Waise", ID(99), [null, null])] })),
        ).toThrow(MigrationAborted);
        expect(() =>
            transformTerritories(
                quelle({
                    territories: [
                        gebiet(REICH, "A", PROVINZ_1, [null, null]),
                        gebiet(PROVINZ_1, "B", REICH, [null, null]),
                    ],
                    geometries: [],
                    claims: [],
                }),
            ),
        ).toThrow(/Zyklus/);
        expect(() => transformTerritories(quelle({ geometries: [flaeche(1, ID(99), [quadrat(1, 1)])] }))).toThrow(
            /fehlt/,
        );
        expect(() =>
            transformTerritories(quelle({ territories: [...territories, territories[0] as Record<string, unknown>] })),
        ).toThrow(/doppelt/);
    });

    it("lehnt unlesbare Felder ab: Farbe, Deckkraft, umgekehrtes Zoomband, keine Quelle", () => {
        const eins = (extra: Record<string, unknown>): LegacyTerritoryPayload =>
            quelle({ territories: [gebiet(REICH, "X", null, [0, 1], extra)], geometries: [], claims: [] });
        expect(() => transformTerritories(eins({ color: "rot" }))).toThrow(/Farbe/);
        expect(() => transformTerritories(eins({ opacity: 1.5 }))).toThrow(/Deckkraft/);
        expect(() => transformTerritories(eins({ min_zoom: 5, max_zoom: 2 }))).toThrow(/min_zoom/);
        expect(() => transformTerritories({ ok: true })).toThrow(MigrationAborted);
        expect(() => transformTerritories({ ...quelle(), ok: false })).toThrow(MigrationAborted);
    });

    it("übernimmt die Wappenfelder unverändert, ohne etwas zu laden", () => {
        const [reich] = transformTerritories(quelle()).territories;
        expect(reich?.coatRef).toBe("/uploads/wappen/x.png?v=1");
        expect(reich?.coatLicenseStatus).toBe("public_domain");
        expect(reich?.coatOrigin).toBe("own");
        const platzhalter = transformTerritories(quelle()).territories.find((t) => t.publicId === PLATZHALTER);
        expect(platzhalter?.coatRef).toBeNull();
    });

    it("lässt einen Anspruch auf ein unbekanntes Gebiet weg und zählt ihn", () => {
        const result = transformTerritories(
            quelle({
                claims: [
                    { territory_public_id: BARONIE_3, claimant_public_id: BARONIE_4, sort_order: 0, source: "wiki" },
                    { territory_public_id: BARONIE_3, claimant_public_id: ID(99), sort_order: 1, source: "manual" },
                ],
            }),
        );
        expect(result.claims).toHaveLength(1);
        expect(result.rejectedClaims).toBe(1);
    });

    it("🔴 WI-0188 A1: Legacys oberstes Band 6 wird 8, an Gebiet und Fläche; Untergrenzen, kleinere Obergrenzen und null bleiben", () => {
        const result = transformTerritories(
            quelle({
                territories: [
                    gebiet(REICH, "Reich", null, [0, 1]),
                    gebiet(PROVINZ_1, "Provinz", REICH, [2, 5]),
                    gebiet(BARONIE_1, "Baronie", PROVINZ_1, [4, 6]),
                    gebiet(BARONIE_2, "Ganz nah", PROVINZ_1, [6, 6]),
                    gebiet(PLATZHALTER, "Offen", null, [null, null]),
                ],
                geometries: [
                    flaeche(1, BARONIE_1, [quadrat(300, 300)]),
                    flaeche(2, BARONIE_2, [quadrat(340, 300)], "Polygon", { min_zoom: 3, max_zoom: 5 }),
                    flaeche(3, BARONIE_1, [quadrat(380, 300)], "Polygon", { min_zoom: null, max_zoom: null }),
                ],
                claims: [],
            }),
        );
        const band = (id: string): [number | null, number | null] => {
            const gefunden = result.territories.find((territory) => territory.publicId === id);
            return [gefunden?.minZoom ?? null, gefunden?.maxZoom ?? null];
        };
        expect(band(REICH)).toEqual([0, 1]);
        expect(band(PROVINZ_1)).toEqual([2, 5]);
        expect(band(BARONIE_1)).toEqual([4, 8]);
        // Eine Untergrenze 6 bleibt 6: „nur ganz nah“ heißt jetzt 6 bis 8.
        expect(band(BARONIE_2)).toEqual([6, 8]);
        expect(band(PLATZHALTER)).toEqual([null, null]);
        expect(result.areas.map((area) => [area.minZoom, area.maxZoom])).toEqual([
            [4, 8],
            [3, 5],
            [null, null],
        ]);
        expect(result.bandsAboveLegacyMax).toEqual([]);
    });

    it("🔴 WI-0188 A3: eine Legacy-Obergrenze über 6 bleibt, wie sie ist, und wird gemeldet (Legacys 6 wäre nicht mehr „oben“)", () => {
        const result = transformTerritories(
            quelle({
                territories: [gebiet(REICH, "Hoch", null, [0, 7])],
                geometries: [flaeche(1, REICH, [quadrat(300, 300)], "Polygon", { min_zoom: 0, max_zoom: 8 })],
                claims: [],
            }),
        );
        expect(result.territories[0]?.maxZoom).toBe(7);
        expect(result.areas[0]?.maxZoom).toBe(8);
        expect(result.bandsAboveLegacyMax).toEqual([
            { table: "territory", publicId: REICH, name: "Hoch", maxZoom: 7 },
            { table: "territory_area", publicId: FLAECHE(1), name: "Hoch", maxZoom: 8 },
        ]);
    });
});

/** Eingaben der Ableitung ohne Datenbank (WI-0188): Gebiet `[id, Name, Elter, [min, max]]`, Fläche `[id, Gebiet, [min, max]]`. */
function eingaben(
    gebiete: [number, string, number | null, [number | null, number | null]][],
    flaechen: [number, number, [number | null, number | null]][],
): DeriveInputs {
    return {
        territories: gebiete.map(([id, name, eltern, [min, max]]) => ({
            id,
            publicId: ID(0x200 + id),
            name,
            parentId: eltern,
            parentPublicId: eltern === null ? null : ID(0x200 + eltern),
            minZoom: min,
            maxZoom: max,
            validFromBf: null,
            validToBf: null,
            color: "#b2b065",
            opacity: "0.7",
            sortOrder: 0,
            territoryType: null,
            capital: null,
            legacy: true,
        })),
        areas: flaechen.map(([id, gebiet, [min, max]]) => ({
            id,
            publicId: ID(0x300 + id),
            territoryId: gebiet,
            territoryPublicId: ID(0x200 + gebiet),
            validFromBf: null,
            validToBf: null,
            minZoom: min,
            maxZoom: max,
            geomHash: "",
            isValid: true,
            legacy: true,
        })),
        claims: [],
    };
}

/** Was der Gebietsimport seit WI-0188 aus Legacys Werten macht: jede Obergrenze 6 wird 8. */
function nachDemImport(inputs: DeriveInputs): DeriveInputs {
    const ziel = (max: number | null): number | null => (max === 6 ? 8 : max);
    return {
        ...inputs,
        territories: inputs.territories.map((row) => ({ ...row, maxZoom: ziel(row.maxZoom) })),
        areas: inputs.areas.map((row) => ({ ...row, maxZoom: ziel(row.maxZoom) })),
    };
}

describe("WI-0188 Gebietsbänder bis 8 (rein)", () => {
    const JAHR = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
    // Ein Reich mit einer Grafschaft bis 6 und vier Baronien: A zeigt sich ab 4 selbst, B ab 5 (darunter die Grafschaft),
    // C hängt direkt am Reich und hat in Band 2 und 3 kein Gebiet (Lücke), D zeigt sich ab 3, trägt aber eine eigene
    // Flächenspanne 5 bis 6 (Lücke durch das eigene Band in 3 und 4).
    const legacy = eingaben(
        [
            [1, "Reich", null, [0, 1]],
            [2, "Grafschaft", 1, [2, 6]],
            [3, "Baronie A", 2, [4, 6]],
            [4, "Baronie B", 2, [5, 6]],
            [5, "Baronie C", 1, [4, 6]],
            [6, "Baronie D", 2, [3, 6]],
        ],
        [
            [11, 3, [4, 6]],
            [12, 4, [null, null]],
            [13, 5, [null, null]],
            [14, 6, [5, 6]],
        ],
    );
    type Ergebnis = ReturnType<typeof computeDerivation>["result"];
    const zeigt = (result: Ergebnis, band: number): string[] =>
        result.assignments
            .filter((entry) => entry.band === band)
            .map((entry) => `${String(entry.areaId)}>${String(entry.territoryId)}`);
    const luecken = (result: Ergebnis, band: number): string[] =>
        result.notShown
            .filter((entry) => entry.band === band)
            .map((entry) => `${String(entry.areaId)}:${entry.reason}`);

    it("🔴 A5: Band 0 bis 6 zeigen jede Fläche wie mit Legacys Werten und Band 6 als oberstem", () => {
        const vorher = computeDerivation(legacy, JAHR, 6).result;
        const nachher = computeDerivation(nachDemImport(legacy), JAHR, 8).result;
        for (let band = 0; band <= 6; band += 1) {
            expect(zeigt(nachher, band), `Band ${String(band)}`).toEqual(zeigt(vorher, band));
        }
        expect(legacyBandDifferences(nachDemImport(legacy), JAHR, nachher.assignments)).toEqual([]);
    });

    it("🔴 A4: Band 7 und 8 zeigen, was Band 6 zeigt", () => {
        const nachher = computeDerivation(nachDemImport(legacy), JAHR, 8).result;
        expect(zeigt(nachher, 6)).toEqual(["11>3", "12>4", "13>5", "14>6"]);
        expect(zeigt(nachher, 7)).toEqual(zeigt(nachher, 6));
        expect(zeigt(nachher, 8)).toEqual(zeigt(nachher, 6));
    });

    it("🔴 A6: Lücken wie vorher, in 7 und 8 wie in 6", () => {
        const vorher = computeDerivation(legacy, JAHR, 6).result;
        const nachher = computeDerivation(nachDemImport(legacy), JAHR, 8).result;
        for (let band = 0; band <= 6; band += 1) {
            expect(luecken(nachher, band), `Band ${String(band)}`).toEqual(luecken(vorher, band));
        }
        // Die Lücken der Konstellation: Baronie C hat in Band 2 und 3 kein Gebiet, Baronie D ihr eigenes Band erst ab 5.
        expect([2, 3, 4].map((band) => luecken(nachher, band))).toEqual([
            ["13:no_band"],
            ["13:no_band", "14:own_band"],
            ["14:own_band"],
        ]);
        expect(luecken(nachher, 7)).toEqual(luecken(nachher, 6));
        expect(luecken(nachher, 8)).toEqual(luecken(nachher, 6));
    });

    it("🔴 A7 (D2): ohne Übergangsregel endet eine Spanne bis 6 bei 6; Band 7 und 8 zeigen nur, was weiter reicht", () => {
        // Seit WI-0209 D2 rechnet die Ableitung immer bis 8 (`deriveMaxBand` fiel): Ein Bestand, der bei 6 endet, zeigt darüber
        // nichts. Darum bekommt Production diesen Stand erst nach der Datenänderung 6 → 8 (EDIT-0005 §1.2, E2).
        const roh = computeDerivation(legacy, JAHR, 8).result;
        expect(zeigt(roh, 7)).toEqual([]);
        expect(zeigt(roh, 8)).toEqual([]);
        // Eine Baronie, deren Spanne jemand auf 4 bis 8 zieht und deren Fläche ihr eigenes Band verloren hat (`territory.display`),
        // zeigt sich in Band 7 und 8 selbst.
        const gezogen = eingaben(
            [
                [1, "Reich", null, [0, 1]],
                [2, "Grafschaft", 1, [2, 6]],
                [3, "Baronie A", 2, [4, 8]],
            ],
            [[11, 3, [null, null]]],
        );
        const danach = computeDerivation(gezogen, JAHR, 8).result;
        expect([6, 7, 8].map((band) => zeigt(danach, band))).toEqual([["11>3"], ["11>3"], ["11>3"]]);
        // Die Revision hängt am obersten Band: Ein Lauf bis 8 ist ein anderer als einer bis 6.
        expect(territoryRevision(legacy, JAHR, 8)).not.toBe(territoryRevision(legacy, JAHR, 6));
        // 🔴 Die Farbe geht in kein abgeleitetes Ergebnis ein (EDIT-0003 T51, WI-0209 D4): Eine Farbänderung macht die Ableitung nicht
        // veraltet, eine Spanne schon.
        const umgefaerbt = { ...legacy, territories: legacy.territories.map((t) => ({ ...t, color: "#123456" })) };
        expect(territoryRevision(umgefaerbt, JAHR, 8)).toBe(territoryRevision(legacy, JAHR, 8));
        const gespannt = { ...legacy, territories: legacy.territories.map((t) => ({ ...t, maxZoom: 7 })) };
        expect(territoryRevision(gespannt, JAHR, 8)).not.toBe(territoryRevision(legacy, JAHR, 8));
    });

    it("die engste Spanne kann kippen: eine Spanne bis 6, die mit der kürzeren eines Vorfahren gleichauf lag, verliert den Gleichstand, und der Prüfer meldet es", () => {
        // Legacy: Provinz 3–5 und Baronie 4–6 sind gleich breit, das tiefere Glied gewinnt. Nach dem Import ist die Baronie
        // 4–8 breiter, und in Band 4 und 5 zeigt die Provinz. Im Bestand vom 2026-10-16 gibt es keinen solchen Fall.
        const kipp = eingaben(
            [
                [1, "Reich", null, [0, 2]],
                [2, "Provinz", 1, [3, 5]],
                [3, "Baronie", 2, [4, 6]],
            ],
            [[11, 3, [null, null]]],
        );
        const nachher = computeDerivation(nachDemImport(kipp), JAHR, 8).result;
        expect(legacyBandDifferences(nachDemImport(kipp), JAHR, nachher.assignments)).toEqual([
            { band: 4, areaId: 11, legacy: 3, now: 2 },
            { band: 5, areaId: 11, legacy: 3, now: 2 },
        ]);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Herrschaftsgebiete importieren und ableiten, gegen PostGIS", () => {
    let database: Database;
    const MAP_DOMAIN = "aventuria";

    async function aufraeumen(): Promise<void> {
        await database.unsafe(
            `DELETE FROM territory_border WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '77777777-%')`,
        );
        await database.unsafe(
            `DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '77777777-%')`,
        );
        await database.unsafe(
            `DELETE FROM territory_display_area WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '77777777-%')`,
        );
        await database.unsafe(`DELETE FROM territory_capital_band WHERE place_public_id::text LIKE '77777777-%'`);
        await database.unsafe(
            `DELETE FROM territory_claim WHERE territory_id IN (SELECT id FROM territory WHERE public_id::text LIKE '77777777-%')`,
        );
        await database.unsafe(`DELETE FROM territory_area WHERE public_id::text LIKE '77777777-%'`);
        await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '77777777-%'`);
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '77777777-%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '77777777-%'`);
        await database.unsafe(
            `DELETE FROM territory_state WHERE map_domain_id = '${MAP_DOMAIN}' AND source_stamp LIKE 'pt-fixture-%'`,
        );
        await database.unsafe(
            `DELETE FROM migration_run WHERE data_domain = 'territories' AND source_ref LIKE 'territories_revision=pt-fixture-%' AND NOT EXISTS (SELECT 1 FROM territory WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_area WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_claim WHERE migration_run_id = migration_run.id)`,
        );
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, ${MAP_DOMAIN}, 'Testhaupstadt', 'stadt', ST_SetSRID(ST_MakePoint(320, 320), 0), 'test', TRUE)
        `;
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 der Erstimport legt alles an; der Prüfer findet Parität und meldet die Befunde", async () => {
        const report = await importTerritories(database, quelle(), { sourceEtag: 'W/"pol-territories-test"' });
        expect(report.territories).toMatchObject({ created: 8, updated: 0, unchanged: 0, retired: 0 });
        expect(report.areas).toMatchObject({ created: 4, unchanged: 0 });
        expect(report.claims).toMatchObject({ created: 1 });
        expect(report.parentsChanged).toBe(6);
        expect(report.changed).toBe(true);

        const parity = await verifyTerritories(database, quelle());
        expect(parity.checks.filter((entry) => !entry.passed)).toEqual([]);
        expect(parity.passed).toBe(true);
        expect(parity.findings.join("\n")).toContain("1 Flächen sind ungültig");

        // 🔴 Betreiber 2026-10-03: Weicht die Datenbank von der Quelle ab, ist die Parität ein Befund, kein Abbruch.
        await database`UPDATE territory SET name = 'Verändert' WHERE public_id = ${BARONIE_1}`;
        try {
            const abweichend = await verifyTerritories(database, quelle());
            const feldweise = abweichend.checks.find((entry) => entry.name === "field_parity");
            expect(feldweise).toMatchObject({ passed: false, blocking: false });
            expect(feldweise?.offenders?.join("\n")).toContain("Baronie Eins");
            expect(abweichend.passed, "kein blockierender Prüfpunkt fiel aus").toBe(true);
        } finally {
            await database`UPDATE territory SET name = 'Baronie Eins' WHERE public_id = ${BARONIE_1}`;
        }

        const [state] = await database<{ source_stamp: string; source_etag: string; source_map_revision: string }[]>`
            SELECT source_stamp, source_etag, source_map_revision::text FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        expect(state).toMatchObject({
            source_stamp: "pt-fixture-1",
            source_etag: 'W/"pol-territories-test"',
            source_map_revision: "157006",
        });
    });

    it("🔴 speichert die Geometrie unverändert, auch die ungültige (repariert wird beim Lesen)", async () => {
        const [row] = await database<{ valid: boolean; polygons: number; repaired_valid: boolean }[]>`
            SELECT a.is_valid AS valid, ST_NumGeometries(a.geom)::int AS polygons, ST_IsValid(territory_area_valid(a.geom)) AS repaired_valid
            FROM territory_area a WHERE a.public_id = ${FLAECHE(4)}
        `;
        expect(row).toEqual({ valid: false, polygons: 1, repaired_valid: true });
        const [eins] = await database<{ polygons: number }[]>`
            SELECT ST_NumGeometries(geom)::int AS polygons FROM territory_area WHERE public_id = ${FLAECHE(1)}
        `;
        expect(eins?.polygons).toBe(1);
    });

    it("🔴 ein zweiter Lauf mit demselben Stand ändert nichts und lässt die Ableitung stehen", async () => {
        await deriveTerritories(database);
        const [before] = await database<{ derived_revision: string | null }[]>`
            SELECT derived_revision FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        expect(before?.derived_revision).toMatch(/^[0-9a-f]{12}$/);
        const again = await importTerritories(database, quelle());
        expect(again.territories).toMatchObject({ created: 0, updated: 0, unchanged: 8, retired: 0 });
        expect(again.areas).toMatchObject({ created: 0, updated: 0, unchanged: 4, retired: 0 });
        expect(again.claims).toMatchObject({ created: 0, updated: 0, unchanged: 1, retired: 0 });
        expect(again.parentsChanged).toBe(0);
        expect(again.changed).toBe(false);
        const [after] = await database<{ derived_revision: string | null }[]>`
            SELECT derived_revision FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        expect(after?.derived_revision).toBe(before?.derived_revision);
    });

    it("🔴 leitet ab: Formen je Band, Außen- und Innengrenzen, Namensanker, Hauptstadtzeiger", async () => {
        const report = await deriveTerritories(database, { force: true });
        expect(report.computed).toBe(true);
        expect(report.yearBf).toBe(AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf);
        const shapes = (band: number): number => report.bands[band]?.shapes ?? -1;
        // Band 0 und 1: das Reich (die Vereinigung aller vier Flächen); Band 2 und 3: zwei Provinzen; ab Band 4: vier Baronien,
        // bis Band 8 (WI-0188: Legacys oberstes Band 6 steht nach dem Import als 8).
        expect(report.bands).toHaveLength(9);
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(shapes)).toEqual([1, 1, 2, 2, 4, 4, 4, 4, 4]);
        // Außengrenzen: Band 0 das Reich; Band 2 das Reich (Vorfahr der Provinzen); Band 4 Reich und beide Provinzen.
        expect([0, 1, 2, 3, 4].map((band) => report.bands[band]?.outer)).toEqual([1, 1, 1, 1, 3]);
        // Innengrenzen: Band 2 die Kante zwischen den Provinzen; Band 4 dazu die Kanten in beiden Provinzen.
        expect(report.bands[0]?.inner).toBe(0);
        expect(report.bands[2]?.inner).toBe(1);
        expect(report.bands[4]?.inner).toBe(3);
        // Die Platzhalter ohne Fläche erscheinen nirgends; die Hauptstadt der Provinz Nord in den Bändern 2 und 3.
        const [capital] = await database<
            { bands: string }[]
        >`SELECT bands FROM territory_capital_band WHERE place_public_id = ${ORT}`;
        expect(capital?.bands).toBe("23");
        const [place] = await database<
            { capital_bands: string | null }[]
        >`SELECT capital_bands FROM place_render WHERE public_id = ${ORT}`;
        expect(place?.capital_bands).toBe("23");
    });

    it("🔴 Namen entlang der Außengrenze: ab Band 4, nur Hüllen mit Nachfahren und erlaubtem Namen, ohne die Grenze eines Vorfahren", async () => {
        await deriveTerritories(database, { force: true });
        const zeilen = await database<
            { band: number; name: string; closed: boolean; clockwise: boolean | null; pieces: number; length: number }[]
        >`
            SELECT b.band::int AS band, b.label_name AS name,
                   ST_IsClosed(ST_GeometryN(b.render_geom, 1)) AS closed,
                   CASE WHEN ST_IsClosed(ST_GeometryN(b.render_geom, 1))
                        THEN ST_IsPolygonCW(ST_MakePolygon(ST_GeometryN(b.render_geom, 1))) END AS clockwise,
                   ST_NumGeometries(b.geom)::int AS pieces, ST_Length(b.geom) AS length
            FROM territory_border b JOIN territory t ON t.id = b.territory_id
            WHERE b.kind = 'name' AND t.public_id::text LIKE '77777777-%'
            ORDER BY b.band, b.label_name
        `;
        const je = (band: number): string[] => zeilen.filter((zeile) => zeile.band === band).map((zeile) => zeile.name);
        // Erst ab Band 4 (Legacy z4), nie an einer Baronie (ausgenommener Name) und nie am Platzhalter.
        expect([0, 1, 2, 3].map((band) => je(band))).toEqual([[], [], [], []]);
        for (const band of [4, 5, 6, 7, 8])
            expect(je(band), `Band ${String(band)}`).toEqual(["Provinz Nord", "Provinz Süd", "Testreich"]);
        expect(zeilen.some((zeile) => zeile.name.startsWith("Baronie"))).toBe(false);

        const reich = zeilen.find((zeile) => zeile.band === 5 && zeile.name === "Testreich");
        // Das Reich hat keinen Vorfahren: sein ganzer Umriss, ein geschlossener Ring, rechtsläufig (Inneres rechts).
        expect(reich).toMatchObject({ closed: true, clockwise: true, pieces: 1 });
        expect(reich?.length).toBeGreaterThan(300);
        // Die Provinzen grenzen mit ihren Außenkanten an den Rand des Reiches und lassen dort dessen Namen stehen:
        // von Provinz Nord bleibt nur die Kante zur Nachbarprovinz (40 lang), nicht der Umriss (rund 160).
        const nord = zeilen.find((zeile) => zeile.band === 5 && zeile.name === "Provinz Nord");
        expect(nord?.closed).toBe(false);
        expect(nord?.length).toBeGreaterThan(35);
        expect(nord?.length).toBeLessThan(45);
        const [beruehrung] = await database<{ laenge: number }[]>`
            SELECT COALESCE(sum(ST_Length(ST_Intersection(n.geom, ST_Buffer(o.geom, 0.05)))), 0) AS laenge
            FROM territory_border n
            JOIN territory tn ON tn.id = n.territory_id
            JOIN territory tr ON tr.public_id = ${REICH}
            JOIN territory_border o ON o.territory_id = tr.id AND o.band = n.band AND o.kind = 'outer'
            WHERE n.kind = 'name' AND n.band = 5 AND tn.public_id = ${PROVINZ_1}
        `;
        expect(beruehrung?.laenge).toBeLessThan(0.5);
    });

    it("🔴 der Prüfer der Ableitung besteht, und die Befunde nennen keine erfundenen Lücken", async () => {
        const result = await verifyTerritoryShapes(database);
        expect(result.checks.filter((entry) => !entry.passed)).toEqual([]);
        expect(result.passed).toBe(true);
    });

    it("die Baronie mit der Schleife wird zu einer gültigen Form (Fläche größer als null)", async () => {
        const [row] = await database<{ valid: boolean; area: number }[]>`
            SELECT ST_IsValid(s.geom) AS valid, s.area
            FROM territory_shape s JOIN territory t ON t.id = s.territory_id
            WHERE t.public_id = ${BARONIE_4} AND s.band = 5
        `;
        expect(row?.valid).toBe(true);
        expect(row?.area).toBeGreaterThan(0);
    });

    it("🔴 ein Lauf ohne Änderung rechnet nichts; --force liefert dieselbe Revision", async () => {
        const first = await deriveTerritories(database);
        expect(first.computed).toBe(false);
        expect(first.revisionChanged).toBe(false);
        const forced = await deriveTerritories(database, { force: true });
        expect(forced.computed).toBe(true);
        expect(forced.revision).toBe(first.revision);
    });

    it("🔴 das Anzeigejahr ändert die Revision und das Ergebnis: ein Gebiet vor seinem Beginn erscheint nicht", async () => {
        const jetzt = await deriveTerritories(database);
        // Im Jahr 50 gibt es noch nichts (alle Gebiete beginnen 100): nichts wird gezeigt, die Revision ist eine andere.
        const frueh = await deriveTerritories(database, { displayYearBf: 50 });
        expect(frueh.revision).not.toBe(jetzt.revision);
        expect(frueh.bands.map((band) => band.shapes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        // Zurück zum Anzeigejahr der Kartografie.
        const zurueck = await deriveTerritories(database);
        expect(zurueck.revision).toBe(jetzt.revision);
        expect(zurueck.bands.map((band) => band.shapes)).toEqual([1, 1, 2, 2, 4, 4, 4, 4, 4]);
    });

    it("🔴 ein geänderter Import entwertet die Ableitung, und die Ableitung stellt sie wieder her", async () => {
        const geaendert = quelle();
        (geaendert.territories as Record<string, unknown>[])[3] = gebiet(BARONIE_1, "Baronie Eins", PROVINZ_1, [4, 6], {
            color: "#112233",
        });
        const report = await importTerritories(database, geaendert);
        expect(report.territories).toMatchObject({ created: 0, updated: 1, unchanged: 7 });
        expect(report.changed).toBe(true);
        const [entwertet] = await database<{ derived_revision: string | null }[]>`
            SELECT derived_revision FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        expect(entwertet?.derived_revision).toBeNull();
        const neu = await deriveTerritories(database);
        expect(neu.computed).toBe(true);
        const [farbe] = await database<{ color: string }[]>`
            SELECT color FROM territory_fill_render WHERE territory_public_id = ${BARONIE_1} AND band = 4
        `;
        expect(farbe?.color).toBe("#112233");
        await importTerritories(database, quelle());
        await deriveTerritories(database);
    });

    it("🔴 legt still, was die Quelle nicht mehr kennt, und meldet die Stilllegequote als Befund (Betreiber 2026-10-03)", async () => {
        const kleiner = quelle();
        kleiner.geometries = (kleiner.geometries as Record<string, unknown>[]).slice(0, 3);
        kleiner.territories = (kleiner.territories as Record<string, unknown>[]).filter(
            (t) => t["public_id"] !== BARONIE_4 && t["public_id"] !== PLATZHALTER,
        );
        kleiner.claims = [];

        // Früher brach der Lauf hier ab (Grenze 5 %). Jetzt läuft er durch; die Befunde nennen Zahlen und Namen.
        const report = await importTerritories(database, kleiner);
        expect(report.territories.retired).toBe(2);
        expect(report.areas.retired).toBe(1);
        expect(report.claims.retired).toBe(1);
        expect(report.findings.map((finding) => finding.code)).toEqual(["stilllegequote", "stilllegequote"]);
        const [gebiete, flaechen] = report.findings;
        expect(gebiete?.numbers).toMatchObject({
            table: "territory",
            active: 8,
            retiring: 2,
            share: 0.25,
            limit: 0.05,
        });
        expect(gebiete?.objects).toEqual([
            { table: "territory", publicId: BARONIE_4, name: "Baronie Vier" },
            { table: "territory", publicId: PLATZHALTER, name: "Neues Herrschaftsgebiet (1)" },
        ]);
        expect(flaechen?.numbers).toMatchObject({ table: "territory_area", active: 4, retiring: 1, share: 0.25 });
        expect(flaechen?.objects).toEqual([{ table: "territory_area", publicId: FLAECHE(4), name: "Baronie Vier" }]);
        const [aktiv] = await database<
            { active: number }[]
        >`SELECT count(*)::int AS active FROM territory WHERE public_id::text LIKE '77777777-%' AND is_active`;
        expect(aktiv?.active).toBe(6);
        // Wieder alles: die Zeilen leben auf.
        const zurueck = await importTerritories(database, quelle());
        expect(zurueck.territories.updated).toBe(2);
        expect(zurueck.areas.updated).toBe(1);
        await deriveTerritories(database);
    });

    /** Die Kacheln einer Zoomstufe, die die Fixture berühren, gelesen: je Schicht die Werte je Schlüssel, in Reihenfolge. */
    async function kachelSchichten(
        z: number,
        quelle: "territory_tile" | "territory_border_tile" = "territory_tile",
    ): Promise<Record<string, Record<string, (string | number | boolean)[]>>> {
        const [extent] = await database<{ x0: number; x1: number; y0: number; y1: number }[]>`
            SELECT floor((ST_XMin(e) + 20037508.342789244) / (2 * 20037508.342789244 / power(2, ${z})))::int AS x0,
                   floor((ST_XMax(e) + 20037508.342789244) / (2 * 20037508.342789244 / power(2, ${z})))::int AS x1,
                   floor((20037508.342789244 - ST_YMax(e)) / (2 * 20037508.342789244 / power(2, ${z})))::int AS y0,
                   floor((20037508.342789244 - ST_YMin(e)) / (2 * 20037508.342789244 / power(2, ${z})))::int AS y1
            FROM (SELECT ST_Extent(render_geom) AS e FROM territory_shape s JOIN territory t ON t.id = s.territory_id WHERE t.public_id::text LIKE '77777777-%') x
        `;
        const schichten: Record<string, Record<string, (string | number | boolean)[]>> = {};
        for (let x = extent?.x0 ?? 0; x <= (extent?.x1 ?? 0); x += 1) {
            for (let y = extent?.y0 ?? 0; y <= (extent?.y1 ?? 0); y += 1) {
                const [tile] =
                    quelle === "territory_tile"
                        ? await database<{ t: Buffer }[]>`SELECT territory_tile(${z}, ${x}, ${y}, '{}'::json) AS t`
                        : await database<
                              { t: Buffer }[]
                          >`SELECT territory_border_tile(${z}, ${x}, ${y}, '{}'::json) AS t`;
                for (const layer of Object.values(readMvt(tile?.t ?? Buffer.alloc(0)))) {
                    const ziel = (schichten[layer.name] ??= {});
                    for (const [key, values] of Object.entries(layer.properties)) (ziel[key] ??= []).push(...values);
                }
            }
        }
        return schichten;
    }

    /** Je Merkmal einer Schicht (Name, Band, Ende des Durchlaufs), so wie die Kacheln des Zooms es tragen. */
    function durchlaeufe(
        schicht: Record<string, (string | number | boolean)[]> | undefined,
        nameKey = "name",
    ): string[] {
        const namen = schicht?.[nameKey] ?? [];
        const von = schicht?.["band"] ?? [];
        const bis = schicht?.["band_to"] ?? [];
        return [
            ...new Set(namen.map((name, index) => `${String(name)}@${String(von[index])}-${String(bis[index])}`)),
        ].sort();
    }

    it("🔴 jede Kachel trägt ALLE Bänder ab Zoom − 3, jede Zeile mit ihrem Durchlauf: das Band wählt der Stil, nicht die Kachel", async () => {
        // Was die Sicht liefert: je Durchlauf gleicher Zeilen EINE Zeile mit Beginn und Ende.
        const sicht = await database<{ name: string; band: number; band_to: number }[]>`
            SELECT f.name, f.band::int AS band, f.band_to::int AS band_to
            FROM territory_fill_render f
            WHERE f.territory_public_id::text LIKE '77777777-%'
            ORDER BY f.name, f.band
        `;
        expect(sicht.length).toBeGreaterThan(0);
        for (let z = 0; z <= 8; z += 1) {
            const erwartet = sicht
                .filter((zeile) => zeile.band_to >= politicalTileMinBand(z))
                .map((zeile) => `${zeile.name}@${String(zeile.band)}-${String(zeile.band_to)}`)
                .sort();
            const kachel = await kachelSchichten(z);
            const tatsaechlich = durchlaeufe(kachel["territory_fill_render"]);
            // Die Fixture liegt bei jedem Zoom in wenigen Kacheln; ein Merkmal steht in jeder Kachel, die es berührt.
            expect(tatsaechlich, `Zoom ${String(z)}`).toEqual(erwartet);
            // Die Namensanker tragen dieselben Durchläufe.
            expect(durchlaeufe(kachel["territory_label_render"]).length, `Namen bei Zoom ${String(z)}`).toBe(
                erwartet.length,
            );
        }
        // Ganz oben trägt die Kachel alles, ganz unten (Zoom 8, ab Band 5) nur noch das, was bis in die feinen Bänder reicht.
        const grob = durchlaeufe((await kachelSchichten(1))["territory_fill_render"]);
        expect(grob).toContain("Testreich@0-1");
        expect(grob).toContain("Provinz Nord@2-3");
        expect(grob).toContain("Baronie Eins@4-8");
        const fein = durchlaeufe((await kachelSchichten(8))["territory_fill_render"]);
        expect(fein).toEqual(["Baronie Drei@4-8", "Baronie Eins@4-8", "Baronie Vier@4-8", "Baronie Zwei@4-8"]);
        // Auch die Linien: jede trägt Band und Ende, die Kachel der Linien dieselbe Untergrenze.
        const linien = await kachelSchichten(8, "territory_border_tile");
        const bis = (linien["territory_border_render"]?.["band_to"] ?? []) as number[];
        expect(bis.length).toBeGreaterThan(0);
        for (const ende of bis) expect(ende).toBeGreaterThanOrEqual(politicalTileMinBand(8));
    });

    it("🔴 die Kachelfunktion trägt Füllung, Namen und Grenzen aller Bänder mit Bandnummer, Namen an der Grenze erst ab Band 4", async () => {
        const kachel = await kachelSchichten(1);
        const namen = (schicht: string, key = "name"): string[] => [
            ...new Set((kachel[schicht]?.[key] ?? []).map((wert) => String(wert))),
        ];
        // Alle Gebiete der Fixture in allen Bändern: das Reich, beide Provinzen, die vier Baronien - aber nie den Platzhalter.
        expect(namen("territory_fill_render").sort()).toEqual([
            "Baronie Drei",
            "Baronie Eins",
            "Baronie Vier",
            "Baronie Zwei",
            "Provinz Nord",
            "Provinz Süd",
            "Testreich",
        ]);
        expect(namen("territory_label_render").sort()).toEqual(namen("territory_fill_render").sort());
        // Jede Zeile trägt ihr Band und das Ende ihres Durchlaufs.
        for (const schicht of ["territory_fill_render", "territory_label_render"]) {
            const von = (kachel[schicht]?.["band"] ?? []) as number[];
            const bis = (kachel[schicht]?.["band_to"] ?? []) as number[];
            expect(von.length, schicht).toBeGreaterThan(0);
            expect(bis.length).toBe(von.length);
            von.forEach((band, index) => {
                expect(band).toBeGreaterThanOrEqual(0);
                expect(band).toBeLessThanOrEqual(bis[index] as number);
                expect(bis[index]).toBeLessThanOrEqual(AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand);
            });
        }
        // Die Linien: außen und innen aller Bänder; die Namen an der Grenze erst ab Band 4 mit ihrem Namen, nie an einer Baronie.
        const linien = await kachelSchichten(1, "territory_border_tile");
        const arten = (linien["territory_border_render"]?.["kind"] ?? []) as string[];
        expect(new Set(arten)).toEqual(new Set(["outer", "inner", "name"]));
        const bandVon = (linien["territory_border_render"]?.["band"] ?? []) as number[];
        arten.forEach((art, index) => {
            if (art === "name") expect(bandVon[index], "Namenslinie").toBeGreaterThanOrEqual(4);
        });
        const grenzNamen = new Set(
            (linien["territory_border_render"]?.["label_name"] ?? [])
                .map((wert) => String(wert))
                .filter((n) => n !== ""),
        );
        expect([...grenzNamen].sort()).toEqual(["Provinz Nord", "Provinz Süd", "Testreich"]);
        // Weit weg: eine leere Kachel, keine Ausnahme.
        const [leer] = await database<{ t: Buffer }[]>`SELECT territory_tile(6, 0, 0, '{}'::json) AS t`;
        expect(Object.keys(readMvt(leer?.t ?? Buffer.alloc(0)))).toEqual([]);
    });

    it("🔴 Durchläufe gleicher Zeilen: ein Gebiet, das in benachbarten Bändern gleich aussieht, steht nur einmal in der Sicht", async () => {
        const zeilen = await database<{ name: string; band: number; band_to: number }[]>`
            SELECT name, band::int AS band, band_to::int AS band_to FROM territory_fill_render
            WHERE territory_public_id::text LIKE '77777777-%' ORDER BY name, band
        `;
        const von = (name: string): string[] =>
            zeilen.filter((z) => z.name === name).map((z) => `${String(z.band)}-${String(z.band_to)}`);
        // Das Reich sieht in den Bändern 0 und 1 gleich aus, die Provinzen in 2 und 3, die Baronien in 4 bis 8.
        expect(von("Testreich")).toEqual(["0-1"]);
        expect(von("Provinz Nord")).toEqual(["2-3"]);
        expect(von("Baronie Zwei")).toEqual(["4-8"]);
        // Die Tabelle behält je Band eine Zeile (der Prüfer und die Zuordnung bleiben, wie sie waren), jede mit ihrem Durchlauf.
        const [tabelle] = await database<{ rows: number; starts: number; open: number }[]>`
            SELECT count(*)::int AS rows, count(*) FILTER (WHERE s.band = s.run_from)::int AS starts,
                   count(*) FILTER (WHERE s.run_from IS NULL OR s.run_to IS NULL)::int AS open
            FROM territory_shape s JOIN territory t ON t.id = s.territory_id WHERE t.public_id::text LIKE '77777777-%'
        `;
        expect(tabelle?.open).toBe(0);
        expect(tabelle?.starts).toBe(zeilen.length);
        expect(tabelle?.rows).toBe(1 + 1 + 2 + 2 + 4 + 4 + 4 + 4 + 4);
        expect(tabelle?.starts).toBeLessThan(tabelle?.rows ?? 0);
        // Der Prüfer der Durchläufe besteht (maximal, lückenlos, gleiche Zeilen).
        const pruefung = await verifyTerritoryShapes(database);
        const laeufe = pruefung.checks.filter((entry) => entry.name.startsWith("band_runs_"));
        expect(laeufe.map((entry) => entry.name).sort()).toEqual(["band_runs_border", "band_runs_shape"]);
        for (const entry of laeufe) expect(entry.passed, entry.detail).toBe(true);
    });

    it("🔴 Schraffur: umstrittene Gebiete bekommen in JEDEM Band ihre Fläche, das Gebiet zuerst in der Streifenfolge; die Füllung ist die Form ohne sie", async () => {
        await deriveTerritories(database, { force: true });
        // Baronie Drei wird von Baronie Vier beansprucht. Das Gebiet zeigt sich in Band 0-1 im Reich, 2-3 in Provinz Süd, ab 4 selbst.
        const flaechen = await database<{ band: number; shown: string; area: number }[]>`
            SELECT cs.band::int AS band, d.name AS shown, ST_Area(cs.geom) AS area
            FROM territory_claim_shape cs
            JOIN territory x ON x.id = cs.territory_id
            JOIN territory d ON d.id = cs.display_territory_id
            WHERE x.public_id = ${BARONIE_3}
            ORDER BY cs.band
        `;
        expect(flaechen.map((zeile) => zeile.shown)).toEqual([
            "Testreich",
            "Testreich",
            "Provinz Süd",
            "Provinz Süd",
            "Baronie Drei",
            "Baronie Drei",
            "Baronie Drei",
            "Baronie Drei",
            "Baronie Drei",
        ]);
        for (const zeile of flaechen) expect(zeile.area, `Band ${String(zeile.band)}`).toBeCloseTo(1600, 3);

        // Die Füllung: wo das Gebiet in einem Vorfahren aufgeht, fehlt seine Fläche in der Füllung (Legacys Fenster, „Option A“) …
        const fuellung = await database<
            {
                band: number;
                shown: string;
                hatched: boolean;
                hole: boolean;
                fill: number;
                whole: number;
                claim: number;
            }[]
        >`
            SELECT s.band::int AS band, d.name AS shown, s.hatched, (s.fill_render_geom IS NOT NULL) AS hole,
                   COALESCE(ST_Area(s.fill_render_geom), 0) AS fill, ST_Area(s.render_geom) AS whole,
                   ST_Area(cs.render_geom) AS claim
            FROM territory_claim_shape cs
            JOIN territory x ON x.id = cs.territory_id
            JOIN territory d ON d.id = cs.display_territory_id
            JOIN territory_shape s ON s.band = cs.band AND s.territory_id = cs.display_territory_id
            WHERE x.public_id = ${BARONIE_3}
            ORDER BY cs.band
        `;
        for (const zeile of fuellung.filter((z) => z.band < 4)) {
            expect(zeile.hatched, `Band ${String(zeile.band)}`).toBe(false);
            expect(zeile.hole).toBe(true);
            // Füllung plus Schraffur ist die ganze Form (in Renderkoordinaten, auf ein Millionstel genau).
            expect(Math.abs(zeile.fill + zeile.claim - zeile.whole) / zeile.whole).toBeLessThan(1e-6);
            expect(zeile.fill).toBeLessThan(zeile.whole);
        }
        // … wo es sich selbst zeigt, ist die ganze Fläche schraffiert: keine Füllung, aber die Fläche bleibt (Ziel des Klicks).
        for (const zeile of fuellung.filter((z) => z.band >= 4)) {
            expect(zeile.hatched, `Band ${String(zeile.band)}`).toBe(true);
            expect(zeile.hole).toBe(false);
        }
        const [sicht] = await database<{ hatched: boolean; area: number }[]>`
            SELECT hatched, area FROM territory_fill_render WHERE territory_public_id = ${BARONIE_3} AND band = 4
        `;
        expect(sicht?.hatched).toBe(true);
        expect(sicht?.area).toBeGreaterThan(0);
        // Ein Gebiet ohne Anspruch bleibt, wie es war.
        const [frei] = await database<{ hatched: boolean; hole: boolean }[]>`
            SELECT s.hatched, (s.fill_render_geom IS NOT NULL) AS hole FROM territory_shape s
            JOIN territory t ON t.id = s.territory_id WHERE t.public_id = ${BARONIE_1} AND s.band = 4
        `;
        expect(frei).toEqual({ hatched: false, hole: false });
        // Der Prüfer der Schraffur besteht.
        const pruefung = await verifyTerritoryShapes(database);
        const schraffur = pruefung.checks.filter((entry) =>
            ["claim_shapes_parity", "claim_shapes_valid", "fill_without_hatch"].includes(entry.name),
        );
        expect(schraffur.length).toBe(3);
        for (const entry of schraffur) expect(entry.passed, entry.detail).toBe(true);
    });

    it("🔴 die Kachel trägt die Schraffur mit dem Namen des Musters: das Band, dann das Gebiet, dann die Anspruchsteller", async () => {
        const kachel = await kachelSchichten(3);
        const schraffur = kachel["territory_claim_render"];
        expect(schraffur, "die Schicht der Schraffur").toBeDefined();
        const muster = [...new Set((schraffur?.["pattern"] ?? []).map((wert) => String(wert)))].sort();
        // Beide Baronien tragen die Farbe der Fixture (#b2b065): Streifen des Gebiets zuerst, dann der Anspruchsteller.
        expect(muster).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((band) => `claim-${String(band)}-b2b065-b2b065`));
        // Ein Merkmal je Band (das Muster hängt an der Streifenbreite des Bandes) unter dem Gebiet, das im Band erscheint.
        const bandVon = (schraffur?.["band"] ?? []) as number[];
        const unter = (schraffur?.["name"] ?? []) as string[];
        const je = (band: number): string[] => unter.filter((_, index) => bandVon[index] === band);
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((band) => [...new Set(je(band))])).toEqual([
            ["Testreich"],
            ["Testreich"],
            ["Provinz Süd"],
            ["Provinz Süd"],
            ["Baronie Drei"],
            ["Baronie Drei"],
            ["Baronie Drei"],
            ["Baronie Drei"],
            ["Baronie Drei"],
        ]);
        // Ein Klick auf die Schraffur wählt das Gebiet darunter: die Schicht trägt Kennung, Art und Obergebiet wie die Füllung.
        for (const key of ["territory_public_id", "territory_type", "parent_name", "area", "claimed_public_id"]) {
            expect(Object.keys(schraffur ?? {}), key).toContain(key);
        }
        // Die Kachel des Zooms 8 trägt erst ab Band 5 (Untergrenze Zoom − 3): die Schraffur der Bänder darunter fehlt dort.
        const fein = await kachelSchichten(8);
        expect([...new Set((fein["territory_claim_render"]?.["band"] ?? []) as number[])].sort()).toEqual([5, 6, 7, 8]);
    });

    it("🔴 ohne Anspruch keine Schraffur: mit dem Anspruch verschwinden Fläche, Loch und Muster, und die Ableitung ändert ihre Revision", async () => {
        const vorher = await deriveTerritories(database);
        await database`UPDATE territory_claim SET is_active = FALSE WHERE territory_id IN (SELECT id FROM territory WHERE public_id = ${BARONIE_3})`;
        try {
            const nachher = await deriveTerritories(database);
            // Wer wen beansprucht, steht in der Revision: ohne Anspruch gilt eine andere.
            expect(nachher.revision).not.toBe(vorher.revision);
            expect(nachher.computed).toBe(true);
            const [zahl] = await database<{ flaechen: number; gefuellt: number }[]>`
                SELECT (SELECT count(*) FROM territory_claim_shape cs JOIN territory t ON t.id = cs.territory_id
                        WHERE t.public_id::text LIKE '77777777-%')::int AS flaechen,
                       (SELECT count(*) FROM territory_shape s JOIN territory t ON t.id = s.territory_id
                        WHERE t.public_id::text LIKE '77777777-%' AND (s.hatched OR s.fill_render_geom IS NOT NULL))::int AS gefuellt
            `;
            expect(zahl).toEqual({ flaechen: 0, gefuellt: 0 });
        } finally {
            await database`UPDATE territory_claim SET is_active = TRUE WHERE territory_id IN (SELECT id FROM territory WHERE public_id = ${BARONIE_3})`;
            const zurueck = await deriveTerritories(database);
            expect(zurueck.revision).toBe(vorher.revision);
        }
    });

    it("die Kachel trägt, was der Stil liest: Farbe, Deckkraft, Elter und Name des Elters", async () => {
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'territory_fill_render'
        `;
        const namen = new Set(spalten.map((spalte) => spalte.column_name));
        for (const erwartet of [
            "territory_public_id",
            "name",
            "parent_public_id",
            "parent_name",
            "color",
            "opacity",
            "sort_order",
            "depth",
            "area",
            "geom",
            "hatched",
            "band_to",
        ]) {
            expect(namen.has(erwartet), erwartet).toBe(true);
        }
        const [zeile] = await database<{ parent_name: string; opacity: number }[]>`
            SELECT parent_name, opacity FROM territory_fill_render WHERE territory_public_id = ${BARONIE_2} AND band = 4
        `;
        expect(zeile).toEqual({ parent_name: "Provinz Nord", opacity: 0.7 });
        const [reich] = await database<{ opacity: number; parent_name: string | null }[]>`
            SELECT opacity, parent_name FROM territory_fill_render WHERE territory_public_id = ${REICH} AND band = 0
        `;
        expect(reich).toEqual({ opacity: 0.33, parent_name: null });
    });

    it("🔴 der Zeiger nennt die Revision der Ableitung; ohne Ableitung gibt es keine Gebiete statt alter", async () => {
        const app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(testDatabaseUrl as string),
        });
        try {
            const abgeleitet = await deriveTerritories(database);
            const antwort = await app.inject({ method: "GET", url: TERRITORY_POINTER_URL });
            expect(antwort.statusCode).toBe(200);
            const zeiger = parseTerritoryPointer(antwort.json());
            expect(zeiger).toEqual({
                schemaVersion: 1,
                revision: abgeleitet.revision,
                displayYearBf: AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
                // WI-0188 A8: das höchste abgeleitete Band; die Karte zeigt nie ein höheres.
                maxBand: 8,
            });
            expect(antwort.headers["cache-control"]).toBe("no-cache");
            // Der Zeiger wird nachgefragt und bleibt ein 304, solange er gilt.
            const etag = antwort.headers["etag"] as string;
            const nochmal = await app.inject({
                method: "GET",
                url: TERRITORY_POINTER_URL,
                headers: { "if-none-match": etag },
            });
            expect(nochmal.statusCode).toBe(304);

            // Ein Import, der etwas geändert hat, entwertet die Ableitung: 404, bis neu abgeleitet ist.
            await database`UPDATE territory_state SET derived_revision = NULL WHERE map_domain_id = ${MAP_DOMAIN}`;
            const leer = await app.inject({ method: "GET", url: TERRITORY_POINTER_URL });
            expect(leer.statusCode).toBe(404);
            expect(leer.json()).toMatchObject({ error: { code: "no_territories" } });
            expect(leer.headers["cache-control"]).toBe("no-store");
            await deriveTerritories(database);
        } finally {
            await app.close();
        }
    });

    it("🔴 WI-0188 A1: Legacys oberstes Band 6 steht an Gebiet und Fläche als 8, alles andere wie in Legacy", async () => {
        const gebiete = await database<{ public_id: string; min_zoom: number | null; max_zoom: number | null }[]>`
            SELECT public_id::text, min_zoom, max_zoom FROM territory WHERE public_id::text LIKE '77777777-%'
        `;
        const band = (id: string): [number | null, number | null] => {
            const zeile = gebiete.find((gebiet) => gebiet.public_id === id);
            return [zeile?.min_zoom ?? null, zeile?.max_zoom ?? null];
        };
        expect(band(REICH)).toEqual([0, 1]);
        expect(band(PROVINZ_1)).toEqual([2, 3]);
        for (const baronie of [BARONIE_1, BARONIE_2, BARONIE_3, BARONIE_4]) expect(band(baronie)).toEqual([4, 8]);
        expect(band(PLATZHALTER)).toEqual([null, null]);
        const flaechen = await database<{ min_zoom: number | null; max_zoom: number | null }[]>`
            SELECT min_zoom, max_zoom FROM territory_area WHERE public_id::text LIKE '77777777-%' ORDER BY public_id
        `;
        expect(flaechen.map((flaeche) => [flaeche.min_zoom, flaeche.max_zoom])).toEqual([
            [4, 8],
            [4, 8],
            [4, 8],
            [4, 8],
        ]);
    });

    it("🔴 WI-0188 A4: Band 7 und 8 zeigen, was Band 6 zeigt: Zuordnung, Formen, Grenzen, Namen an der Grenze, Hauptstädte", async () => {
        await deriveTerritories(database, { force: true });
        const jeBand = async (abfrage: string): Promise<Map<number, string>> =>
            new Map(
                (await database.unsafe<{ band: number; z: string }[]>(abfrage)).map((zeile) => [zeile.band, zeile.z]),
            );
        const zuordnung = await jeBand(`
            SELECT da.band::int AS band, string_agg(a.public_id::text || '>' || t.public_id::text, ',' ORDER BY a.public_id) AS z
            FROM territory_display_area da JOIN territory_area a ON a.id = da.area_id JOIN territory t ON t.id = da.territory_id
            WHERE t.public_id::text LIKE '77777777-%' GROUP BY da.band`);
        const formen = await jeBand(`
            SELECT s.band::int AS band, string_agg(t.public_id::text || ':' || md5(ST_AsEWKB(s.geom)) || ':' ||
                   md5(ST_AsEWKB(s.label_geom)) || ':' || s.depth::text, ',' ORDER BY t.public_id) AS z
            FROM territory_shape s JOIN territory t ON t.id = s.territory_id
            WHERE t.public_id::text LIKE '77777777-%' GROUP BY s.band`);
        const grenzen = await jeBand(`
            SELECT b.band::int AS band, string_agg(b.kind || ':' || t.public_id::text || ':' || md5(ST_AsEWKB(b.geom)) || ':' ||
                   coalesce(b.label_name, ''), ',' ORDER BY b.kind, t.public_id) AS z
            FROM territory_border b JOIN territory t ON t.id = b.territory_id
            WHERE t.public_id::text LIKE '77777777-%' GROUP BY b.band`);
        for (const [was, werte] of Object.entries({ zuordnung, formen, grenzen })) {
            expect(werte.get(6), was).toBeDefined();
            expect(werte.get(7), `${was}, Band 7`).toBe(werte.get(6));
            expect(werte.get(8), `${was}, Band 8`).toBe(werte.get(6));
        }
        // Hauptstädte: Ist der Ort auch Hauptstadt einer Baronie, steht er in 7 und 8 wie in 4 bis 6.
        await database`UPDATE territory SET capital_place_public_id = ${ORT} WHERE public_id = ${BARONIE_1}`;
        try {
            await deriveTerritories(database);
            const [hauptstadt] = await database<
                { bands: string }[]
            >`SELECT bands FROM territory_capital_band WHERE place_public_id = ${ORT}`;
            expect(hauptstadt?.bands).toBe("2345678");
        } finally {
            await database`UPDATE territory SET capital_place_public_id = NULL WHERE public_id = ${BARONIE_1}`;
            await deriveTerritories(database);
        }
    });

    it("🔴 WI-0188 A5/A9: der Prüfer rechnet mit derselben Bandgrenze und findet Band 0 bis 6 wie mit Legacys Werten", async () => {
        await deriveTerritories(database);
        const pruefung = await verifyTerritoryShapes(database);
        expect(pruefung.checks.filter((entry) => !entry.passed)).toEqual([]);
        expect(pruefung.findings).toContain("Band 0 bis 6 zeigen jede Fläche wie mit Legacys Werten (WI-0188)");
        expect(pruefung.findings.join("\n")).toContain("Überlappungen im Band 8");
        const inputs = await readDeriveInputs(database, MAP_DOMAIN);
        const jahr = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
        expect(legacyBandDifferences(inputs, jahr, computeDerivation(inputs, jahr, 8).result.assignments)).toEqual([]);
        // Der Paritätsprüfer des Imports rechnet mit derselben Regel: Legacys 6 gegen gespeicherte 8 ist Parität.
        const paritaet = await verifyTerritories(database, quelle());
        expect(paritaet.checks.filter((entry) => !entry.passed)).toEqual([]);
    });

    it("🔴 WI-0188 A7 (D2): steht der Bestand noch in Legacys Skala, rechnet die Ableitung trotzdem bis 8; der nächste Import schreibt 8 genau dort", async () => {
        const app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(testDatabaseUrl as string),
        });
        const zeiger = async (): Promise<number | undefined> =>
            parseTerritoryPointer((await app.inject({ method: "GET", url: TERRITORY_POINTER_URL })).json()).maxBand;
        // Der Bestand vor WI-0188: Legacys 6 unverändert gespeichert. Seit WI-0209 D2 gibt es keine Übergangsregel mehr
        // (`deriveMaxBand` fiel): Die Ableitung rechnet bis 8, Band 7 und 8 zeigen diese Gebiete nicht. (Nur die Fixture der
        // Testdatenbank, keine Kartendaten.)
        await database`UPDATE territory SET max_zoom = 6 WHERE public_id::text LIKE '77777777-%' AND max_zoom = 8`;
        await database`UPDATE territory_area SET max_zoom = 6 WHERE public_id::text LIKE '77777777-%' AND max_zoom = 8`;
        try {
            const report = await deriveTerritories(database);
            expect(report.bands).toHaveLength(9);
            const inputs = await readDeriveInputs(database, MAP_DOMAIN);
            expect(report.revision).toBe(territoryRevision(inputs, AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf, 8));
            // Der Zeiger nennt das oberste Band, das Formen trägt: Hier endet alles bei 6, die Karte zeigt kein leeres Band 7 oder 8.
            expect(await zeiger()).toBe(6);

            // Der nächste Gebietsimport schreibt 8 genau an den vier Baronien und ihren vier Flächen, sonst nichts.
            const zug = await importTerritories(database, quelle());
            expect(zug.territories).toMatchObject({ created: 0, updated: 4, unchanged: 4 });
            expect(zug.areas).toMatchObject({ created: 0, updated: 4, unchanged: 0 });
            expect(zug.changed).toBe(true);
            const danach = await deriveTerritories(database);
            expect(danach.bands).toHaveLength(9);
            expect(danach.revision).not.toBe(report.revision);
            expect(await zeiger()).toBe(8);
            const pruefung = await verifyTerritoryShapes(database);
            expect(pruefung.checks.filter((entry) => !entry.passed)).toEqual([]);
        } finally {
            await importTerritories(database, quelle());
            await deriveTerritories(database);
            await app.close();
        }
    });

    it("WI-0188 A3: eine Legacy-Obergrenze über 6 ist ein Befund im Importbericht, kein Abbruch", async () => {
        const hoch = quelle();
        (hoch.territories as Record<string, unknown>[])[3] = gebiet(BARONIE_1, "Baronie Eins", PROVINZ_1, [4, 7]);
        try {
            const report = await importTerritories(database, hoch);
            const befund = report.findings.find((finding) => finding.code === "legacy_band_max_changed");
            expect(befund?.objects).toEqual([{ table: "territory", publicId: BARONIE_1, name: "Baronie Eins" }]);
            expect(befund?.numbers).toMatchObject({ rows: 1, legacy_max_band: 6 });
            const [gespeichert] = await database<
                { max_zoom: number }[]
            >`SELECT max_zoom FROM territory WHERE public_id = ${BARONIE_1}`;
            expect(gespeichert?.max_zoom).toBe(7);
        } finally {
            await importTerritories(database, quelle());
            await deriveTerritories(database);
        }
    });
});
