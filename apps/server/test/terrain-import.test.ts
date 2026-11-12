import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { formatFindings } from "../src/findings.ts";
import { MigrationAborted } from "../src/migration/places.ts";
import type { LegacyArea, LegacyAreaPayload, LegacyMapPayload } from "../src/migration/regions.ts";
import { importTerrain, lineWkt, readTerrainSources } from "../src/migration/terrain.ts";
import { verifyTerrain } from "../src/migration/verify-terrain.ts";
import { loadFreePeaks } from "../src/terrain/inputs.ts";

/**
 * Gelände-Eingaben aus Legacy (WI-0049 S2). Geprüft wird, was V12 später liest: die Regler einer
 * Gebirgsfläche, Kammlinie und Beschriftungskurve, und die Gipfel samt Höhe, auch außerhalb.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eigene Kennungen (…0049…), damit der Test keinen fremden Bestand berührt. */
const ID = {
    region: "00000000-0000-4000-8000-0000000049a1",
    gebirge: "00000000-0000-4000-8000-0000000049a2",
    waldRegion: "00000000-0000-4000-8000-0000000049a3",
    wald: "00000000-0000-4000-8000-0000000049a4",
    label: "00000000-0000-4000-8000-0000000049a5",
    gipfel: "00000000-0000-4000-8000-0000000049b1",
    vulkan: "00000000-0000-4000-8000-0000000049b2",
};

const square = (x0: number, y0: number, x1: number, y1: number): number[][][] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ],
];

function areas(overrides: Record<string, unknown> = {}): LegacyAreaPayload {
    return {
        ok: true,
        revision: 1,
        truncated: false,
        areas: [
            {
                public_id: ID.gebirge,
                region_public_id: ID.region,
                kind: "topographie",
                region_type: "gebirge",
                label_public_id: ID.label,
                geometry: { type: "Polygon", coordinates: square(900, 900, 920, 920) },
                terrain_grain: 6,
                terrain_levels: 5,
                terrain_erosion: 3,
                terrain_plateau: 0.85,
                terrain_hypsometrie: null,
                terrain_avg_height: 3200,
                terrain_bergform: 2,
                terrain_rauschen: 0.35,
                terrain_sattel: 0.4,
                terrain_talbreite: 1.5,
                terrain_einschnitt: 800,
                terrain_ridge_line: [
                    [901.123456789012, 910.5],
                    [919.25, 911.75],
                ],
                terrain_preset_morph: "karst",
                terrain_preset_hoehe: "hochgebirge",
                terrain_mean_height: 500,
                ...overrides,
            },
            {
                public_id: ID.wald,
                region_public_id: ID.waldRegion,
                kind: "vegetation",
                region_type: "wald",
                geometry: { type: "Polygon", coordinates: square(930, 930, 940, 940) },
                terrain_avg_height: 400,
            },
        ] as unknown as LegacyArea[],
    };
}

function features(
    peaks: { id: string; subtype: string; x: number; y: number; h: number | null; show?: boolean }[],
): LegacyMapPayload {
    return {
        ok: true,
        revision: 2,
        features: [
            {
                geometry: { type: "Point", coordinates: [910, 915] },
                properties: {
                    feature_type: "label",
                    feature_subtype: "gebirge",
                    public_id: ID.label,
                    name: "Probeberge",
                    curve_label_line: [
                        [902, 905],
                        [918, 906],
                    ],
                },
            },
            ...peaks.map((peak) => ({
                geometry: { type: "Point", coordinates: [peak.x, peak.y] },
                properties: {
                    feature_type: "label",
                    feature_subtype: peak.subtype,
                    public_id: peak.id,
                    name: `Probe ${peak.subtype}`,
                    revision: 7,
                    ...(peak.h === null ? {} : { height_schritt: peak.h }),
                    ...(peak.show === undefined ? {} : { show_name: peak.show }),
                },
            })),
        ],
    };
}

const PEAKS: { id: string; subtype: string; x: number; y: number; h: number | null; show?: boolean }[] = [
    { id: ID.gipfel, subtype: "berggipfel", x: 910, y: 910, h: 4200 },
    // Außerhalb jedes Gebirges und ohne Höhe: Auch er wird übernommen (Betreiber 2026-09-27). In Legacy auf „aus“ (show_name, 0164).
    { id: ID.vulkan, subtype: "vulkan", x: 950, y: 950, h: null, show: false },
];

describe("Gelände-Eingaben aus dem Satz lesen", () => {
    it("nimmt nur Gebirgsflächen, benennt die Regler ehrlich und holt die Beschriftungskurve über das Label", () => {
        const sources = readTerrainSources(areas(), features(PEAKS));
        expect(sources.controls).toHaveLength(1);
        const control = sources.controls[0];
        expect(control).toMatchObject({
            areaPublicId: ID.gebirge,
            koernung: 6,
            stufen: 5,
            erosion: 3,
            hypsometrie: null,
            maximalhoehe: 3200,
            vorlageMorph: "karst",
            vorlageHoehe: "hochgebirge",
        });
        expect(control?.kammlinie).toEqual([
            [901.123456789012, 910.5],
            [919.25, 911.75],
        ]);
        expect(control?.beschriftungskurve).toEqual([
            [902, 905],
            [918, 906],
        ]);
        expect(sources.rejected).toEqual([]);
    });

    it("holt Gipfel und Vulkane überall, auch ohne Höhe", () => {
        const sources = readTerrainSources(areas(), features(PEAKS));
        expect(sources.peaks.map((peak) => [peak.subtype, peak.heightSchritt, peak.showName])).toEqual([
            ["berggipfel", 4200, true],
            ["vulkan", null, false],
        ]);
    });

    it("weist eine kaputte Kammlinie und eine gebrochene Erosionsstufe zurück, statt zu raten", () => {
        const sources = readTerrainSources(
            areas({ terrain_ridge_line: [[901, 910]], terrain_erosion: 2.5 }),
            features(PEAKS),
        );
        expect(sources.controls[0]?.kammlinie).toBeNull();
        expect(sources.controls[0]?.erosion).toBeNull();
        expect(sources.rejected.map((entry) => entry.reason)).toEqual([
            "terrain_erosion = 2.5 ist keine ganze Zahl",
            "terrain_ridge_line ist keine Punktliste",
        ]);
    });

    it("bricht bei einem abgeschnittenen Satz ab", () => {
        expect(() => readTerrainSources({ ...areas(), truncated: true }, features(PEAKS))).toThrow(MigrationAborted);
    });

    it("schreibt Linien mit vollen Stellen", () => {
        expect(
            lineWkt([
                [1.5, 2],
                [3.123456789012, 4],
            ]),
        ).toBe("LINESTRING(1.5 2,3.123456789012 4)");
    });
});

describe("Contract und Verifier", () => {
    it("nennen dieselben Gates in derselben Reihenfolge", async () => {
        const contract = await readFile(
            fileURLToPath(new URL("../../../project-control/migration/contracts/terrain.yaml", import.meta.url)),
            "utf8",
        );
        const verifier = await readFile(
            fileURLToPath(new URL("../src/migration/verify-terrain.ts", import.meta.url)),
            "utf8",
        );
        const section = contract.slice(contract.indexOf("validation:"), contract.indexOf("run_gates:"));
        const declared = [...section.matchAll(/^\s*- check: ([a-z_]+)$/gm)].map((match) => match[1]);
        const executed = [...new Set([...verifier.matchAll(/check\(\s*"([a-z_]+)"/g)].map((match) => match[1]))];
        expect(declared.length).toBeGreaterThan(0);
        expect(executed).toEqual(declared);
    });
});

describeWithDatabase("Gelände-Eingaben gegen PostGIS", () => {
    let database: Database;

    async function cleanup(): Promise<void> {
        await database`DELETE FROM terrain_peak WHERE public_id IN (${ID.gipfel}, ${ID.vulkan})`;
        await database`
            DELETE FROM terrain_control WHERE area_id IN (
                SELECT id FROM region_area WHERE public_id IN (${ID.gebirge}, ${ID.wald}))
        `;
        await database`DELETE FROM region_area WHERE public_id IN (${ID.gebirge}, ${ID.wald})`;
        await database`DELETE FROM region WHERE public_id IN (${ID.region}, ${ID.waldRegion})`;
        await database`DELETE FROM migration_run WHERE data_domain = 'terrain' AND source_ref = 'ecosystem_revision=1;map_revision=2'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanup();
        for (const [region, area, type, layer, x] of [
            [ID.region, ID.gebirge, "gebirge", "topographie", 900],
            [ID.waldRegion, ID.wald, "wald", "vegetation", 930],
        ] as const) {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${region}, 'aventuria', ${`Probe ${type}`}, ${layer}, ${type}, true)
                RETURNING id::text
            `;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${area}, 'aventuria', ${Number(row?.id)},
                        ST_MakeEnvelope(${x}, ${x}, ${x + 20}, ${x + 20}, 0), true)
            `;
        }
    });

    afterAll(async () => {
        await cleanup();
        await database.end({ timeout: 5 });
    });

    it("🔴 schreibt beim ersten Lauf, beim zweiten nichts, und die Prüfung ist grün", async () => {
        const sources = readTerrainSources(areas(), features(PEAKS));
        const first = await importTerrain(database, sources);
        expect(first.controls.created).toBe(1);
        expect(first.peaks.created).toBe(2);
        expect(first.peaksOutsideMountains).toBeGreaterThanOrEqual(1);

        const second = await importTerrain(database, sources);
        expect(second.controls).toEqual({ created: 0, updated: 0, unchanged: 1, retired: 0 });
        expect(second.peaks).toEqual({ created: 0, updated: 0, unchanged: 2, retired: 0 });

        const report = await verifyTerrain(database, {
            ...sources,
            // Der Verifier sieht den ganzen Bestand; hier zählt nur die Probe.
        });
        const own = report.checks.filter((entry) =>
            [
                "regler_gleich_wie_legacy",
                "kammlinien_gleich_wie_legacy",
                "beschriftungskurven_gleich_wie_legacy",
                "gipfel_gleich_wie_legacy",
            ].includes(entry.name),
        );
        expect(
            own.every((entry) => entry.passed),
            JSON.stringify(own),
        ).toBe(true);
    });

    it("🔴 „Auf der Karte anzeigen“ aus (Legacy show_name): der Gipfel fehlt auf der Karte, das Gelände liest ihn weiter (0164)", async () => {
        const sources = readTerrainSources(areas(), features(PEAKS));
        await importTerrain(database, sources);
        const gelesen = await database<{ public_id: string; show_name: boolean }[]>`
            SELECT public_id::text, show_name FROM terrain_peak WHERE public_id IN (${ID.gipfel}, ${ID.vulkan}) ORDER BY public_id
        `;
        expect(gelesen).toEqual([
            { public_id: ID.gipfel, show_name: true },
            { public_id: ID.vulkan, show_name: false },
        ]);
        // Die Kartensicht lässt ihn aus, die Geländerechnung (`loadFreePeaks`, `loadMountainJobs`) liest `terrain_peak` ohne Filter.
        const karte = await database<{ public_id: string }[]>`
            SELECT public_id::text FROM terrain_peak_render WHERE public_id IN (${ID.gipfel}, ${ID.vulkan})
        `;
        expect(karte.map((row) => row.public_id)).toEqual([ID.gipfel]);
        const frei = await loadFreePeaks(database, "aventuria", []);
        expect(frei.some((peak) => peak.x === 950 && peak.y === 950)).toBe(true);
        // Wieder an in Legacy: der nächste Lauf schreibt genau diese Zeile neu.
        const wiederAn = await importTerrain(
            database,
            readTerrainSources(areas(), features(PEAKS.map((peak) => ({ ...peak, show: true })))),
        );
        expect(wiederAn.peaks).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
        await importTerrain(database, sources);
    });

    it("🔴 überschreibt eine gesetzte Durchschnittshöhe nie", async () => {
        await database`
            UPDATE terrain_control SET durchschnittshoehe = 2500
            WHERE area_id = (SELECT id FROM region_area WHERE public_id = ${ID.gebirge})
        `;
        await importTerrain(database, readTerrainSources(areas({ terrain_grain: 7 }), features(PEAKS)));
        const [row] = await database<{ durchschnittshoehe: number; koernung: number }[]>`
            SELECT durchschnittshoehe, koernung FROM terrain_control
            WHERE area_id = (SELECT id FROM region_area WHERE public_id = ${ID.gebirge})
        `;
        expect(row).toEqual({ durchschnittshoehe: 2500, koernung: 7 });
    });

    it("bricht ab, wenn die Gebirgsfläche fehlt, und schreibt nichts", async () => {
        const fremd = "00000000-0000-4000-8000-0000000049ff";
        const sources = readTerrainSources(areas({ public_id: fremd }), features(PEAKS));
        await expect(importTerrain(database, sources)).rejects.toThrow(MigrationAborted);
    });

    it("🔴 Stilllegequote über 5 %: der Lauf geht durch und meldet Zahlen und Namen (Betreiber 2026-10-03)", async () => {
        await importTerrain(database, readTerrainSources(areas(), features(PEAKS)));
        // Der Satz kennt das Gebirge nicht mehr und nur noch einen der zwei Gipfel: 1 von 1 Reglern, 1 von 2 Gipfeln.
        const ohneGebirge: LegacyAreaPayload = {
            ...areas(),
            areas: (areas().areas ?? []).filter((area) => area.public_id !== ID.gebirge),
        };
        const report = await importTerrain(database, readTerrainSources(ohneGebirge, features([PEAKS[0]!])));

        // Kein Abbruch: gelegt wurde still, was der Satz nicht mehr kennt.
        expect(report.controls.retired).toBe(1);
        expect(report.peaks.retired).toBe(1);
        const [stillControl] = await database<{ is_active: boolean }[]>`
            SELECT is_active FROM terrain_control
            WHERE area_id = (SELECT id FROM region_area WHERE public_id = ${ID.gebirge})
        `;
        expect(stillControl?.is_active).toBe(false);
        const [stillPeak] = await database<{ is_active: boolean }[]>`
            SELECT is_active FROM terrain_peak WHERE public_id = ${ID.vulkan}
        `;
        expect(stillPeak?.is_active).toBe(false);

        // Die Befunde nennen Zahlen, Grenzwert und die betroffenen Objekte mit Tabelle, öffentlicher ID und Name.
        expect(report.findings.map((finding) => finding.code)).toEqual(["stilllegequote", "stilllegequote"]);
        const [control, peak] = report.findings;
        expect(control?.numbers).toEqual({
            table: "terrain_control",
            active: 1,
            retiring: 1,
            share: 1,
            limit: 0.05,
        });
        expect(control?.objects).toEqual([{ table: "terrain_control", publicId: ID.gebirge, name: "Probe gebirge" }]);
        expect(peak?.numbers).toEqual({ table: "terrain_peak", active: 2, retiring: 1, share: 0.5, limit: 0.05 });
        expect(peak?.objects).toEqual([{ table: "terrain_peak", publicId: ID.vulkan, name: "Probe vulkan" }]);
        expect(formatFindings(report.findings).join("\n")).toContain(`terrain_peak ${ID.vulkan} Probe vulkan`);
    });

    it("meldet nichts, solange der Lauf höchstens 5 % stilllegt", async () => {
        const sources = readTerrainSources(areas(), features(PEAKS));
        await importTerrain(database, sources);
        const report = await importTerrain(database, sources);
        expect(report.findings).toEqual([]);
    });
});
