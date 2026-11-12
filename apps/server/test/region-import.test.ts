import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { importRegions } from "../src/migration/region-import.ts";
import { verifyRegions } from "../src/migration/verify-regions.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";

/**
 * Regionsimport gegen PostGIS, soweit es die Stilllegequote betrifft (Betreiber 2026-10-03: sie meldet nur noch).
 * Die Umwandlung der Quellen steht in `regions.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const WALD = "00000000-0000-4000-8000-0000000077a1";
const MOOR = "00000000-0000-4000-8000-0000000077a2";
const WALD_FLAECHE = "00000000-0000-4000-8000-0000000077b1";
const MOOR_FLAECHE = "00000000-0000-4000-8000-0000000077b2";
const WALD_LABEL = "00000000-0000-4000-8000-0000000077c1";
const SOURCE_REF = "ecosystem_revision=7777;map_revision=7778";

const quadrat = (x: number, y: number): number[][][] => [
    [
        [x, y],
        [x + 10, y],
        [x + 10, y + 10],
        [x, y + 10],
        [x, y],
    ],
];

function quelle(mitMoor: boolean): {
    regions: LegacyRegionPayload;
    areas: LegacyAreaPayload;
    labels: LegacyMapPayload;
} {
    const region = (publicId: string, name: string, type: string): LegacyRegionPayload["regions"] =>
        [{ public_id: publicId, name, kind: "vegetation", region_type: type, area_count: 1 }] as never;
    return {
        regions: {
            ok: true,
            regions: [
                ...(region(WALD, "Probewald", "wald") ?? []),
                ...(mitMoor ? (region(MOOR, "Probemoor", "moor") ?? []) : []),
            ],
        },
        areas: {
            ok: true,
            revision: 7777,
            truncated: false,
            areas: [
                {
                    public_id: WALD_FLAECHE,
                    region_public_id: WALD,
                    geometry: { type: "Polygon", coordinates: quadrat(100, 100) },
                },
                ...(mitMoor
                    ? [
                          {
                              public_id: MOOR_FLAECHE,
                              region_public_id: MOOR,
                              geometry: { type: "Polygon", coordinates: quadrat(200, 200) },
                          },
                      ]
                    : []),
            ],
        },
        labels: {
            ok: true,
            revision: 7778,
            features: [
                {
                    geometry: { type: "Point", coordinates: [105, 105] },
                    properties: {
                        feature_type: "label",
                        public_id: WALD_LABEL,
                        name: "Probewald",
                        ecosystem_region_public_id: WALD,
                    },
                },
            ],
        },
    };
}

describeWithDatabase("Regionen importieren: Stilllegequote", () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        await database`UPDATE region SET primary_label_id = NULL WHERE public_id IN (${WALD}, ${MOOR})`;
        await database`DELETE FROM map_label WHERE public_id = ${WALD_LABEL}`;
        await database`DELETE FROM region_area WHERE public_id IN (${WALD_FLAECHE}, ${MOOR_FLAECHE})`;
        await database`DELETE FROM region WHERE public_id IN (${WALD}, ${MOOR})`;
        await database`DELETE FROM migration_run WHERE data_domain = 'regions' AND source_ref = ${SOURCE_REF}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 meldet eine Stilllegung über 5 % als Befund mit Zahlen und Namen, der Lauf geht durch (Betreiber 2026-10-03)", async () => {
        const voll = quelle(true);
        const erst = await importRegions(database, voll.regions, voll.areas, voll.labels);
        expect(erst.regions.created).toBe(2);
        expect(erst.findings, "beim Anlegen wird nichts stillgelegt").toEqual([]);

        const [vorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region
            WHERE map_domain_id = 'aventuria' AND source_system = 'legacy' AND is_active
              AND region_layer IN ('derographisch', 'vegetation', 'topographie')
        `;

        // Der Satz kennt das Moor nicht mehr: Früher hielt die Grenze von 5 % den Lauf an.
        const klein = quelle(false);
        const report = await importRegions(database, klein.regions, klein.areas, klein.labels);
        expect(report.regions.retired).toBe(1);
        expect(report.areas.retired).toBe(1);
        const [moor] = await database<{ is_active: boolean }[]>`SELECT is_active FROM region WHERE public_id = ${MOOR}`;
        expect(moor?.is_active, "der Lauf hat das Moor stillgelegt").toBe(false);

        expect(report.findings).toHaveLength(1);
        const [finding] = report.findings;
        expect(finding?.code).toBe("stilllegequote");
        expect(finding?.numbers).toMatchObject({ table: "region", active: vorher?.n, retiring: 1, limit: 0.05 });
        expect(finding?.objects).toEqual([{ table: "region", publicId: MOOR, name: "Probemoor" }]);
    });

    it("🔴 verify:regions: eine abweichende Parität ist ein Befund, das Urteil bleibt grün (Betreiber 2026-10-03)", async () => {
        const klein = quelle(false);
        await importRegions(database, klein.regions, klein.areas, klein.labels);
        await database`UPDATE region SET name = 'Verändert' WHERE public_id = ${WALD}`;
        try {
            const report = await verifyRegions(database, klein.regions, klein.areas, klein.labels);
            const attribute = report.checks.find((check) => check.name === "region_attribute_parity");
            expect(attribute).toMatchObject({ passed: false, blocking: false });
            expect(attribute?.offenders?.join("\n")).toContain(WALD);
            // Auf dieser Fixture ohne die zwölf namentlich stillgelegten Regionen schlägt `retirement_applied` an (leere
            // Datenbank, siehe legacy-update-cli.ts). Betreiber 2026-10-03 („A auch für die Prüfungen“): Auch sie meldet
            // nur; keine Prüfung des Regionenprüfers hält noch an.
            expect(report.checks.find((check) => check.name === "retirement_applied")).toMatchObject({
                passed: false,
                blocking: false,
            });
            expect(report.checks.filter((check) => !check.passed && check.blocking !== false)).toEqual([]);
            expect(report.passed).toBe(true);
        } finally {
            await database`UPDATE region SET name = 'Probewald' WHERE public_id = ${WALD}`;
        }
    });

    it("meldet nichts, solange der Lauf nichts stilllegt", async () => {
        const klein = quelle(false);
        const report = await importRegions(database, klein.regions, klein.areas, klein.labels);
        expect(report.regions.retired).toBe(0);
        expect(report.findings).toEqual([]);
    });
});

describeWithDatabase(
    "Regionen importieren: Legacys Obergrenze 7 wird Ziel 8 (WI-0129, Betreiber 2026-10-10 E2 A)",
    () => {
        let database: Database;
        const NATIV = "00000000-0000-4000-8000-0000000077d1";
        const WEIT = "00000000-0000-4000-8000-0000000077d2";

        /** Die Quelle mit dem Waldlabel in einem gegebenen Band, dazu ein zweites Label „bis 3“. */
        function mitBand(min: number, max: unknown): ReturnType<typeof quelle> {
            const satz = quelle(false);
            const [wald] = satz.labels.features ?? [];
            const properties = { ...(wald?.properties ?? {}), min_zoom: min, max_zoom: max };
            const weit = {
                geometry: { type: "Point", coordinates: [106, 106] },
                properties: {
                    feature_type: "label",
                    public_id: WEIT,
                    name: "Probewald Süd",
                    ecosystem_region_public_id: WALD,
                    min_zoom: 1,
                    max_zoom: 3,
                },
            };
            return { ...satz, labels: { ...satz.labels, features: [{ ...wald, properties }, weit] as never } };
        }

        async function band(publicId: string): Promise<[number | null, number | null] | undefined> {
            const [row] = await database<{ min: number | null; max: number | null }[]>`
            SELECT label_min_zoom AS min, label_max_zoom AS max FROM map_label WHERE public_id = ${publicId}
        `;
            return row ? [row.min, row.max] : undefined;
        }

        async function aufraeumen(): Promise<void> {
            await database`UPDATE region SET primary_label_id = NULL WHERE public_id IN (${WALD}, ${MOOR})`;
            await database`DELETE FROM map_label WHERE public_id IN (${WALD_LABEL}, ${NATIV}, ${WEIT})`;
            await database`DELETE FROM region_area WHERE public_id IN (${WALD_FLAECHE}, ${MOOR_FLAECHE})`;
            await database`DELETE FROM region WHERE public_id IN (${WALD}, ${MOOR})`;
            await database`DELETE FROM migration_run WHERE data_domain = 'regions' AND source_ref = ${SOURCE_REF}`;
        }

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string);
            await migrate(database);
            await aufraeumen();
        });

        afterAll(async () => {
            await aufraeumen();
            await database.end({ timeout: 5 });
        });

        it("🔴 schreibt Legacys 7 als 8, lässt „bis 3“ stehen, und der zweite Lauf ändert nichts", async () => {
            const satz = mitBand(5, 7);
            const erst = await importRegions(database, satz.regions, satz.areas, satz.labels);
            expect(await band(WALD_LABEL)).toEqual([5, 8]);
            expect(await band(WEIT)).toEqual([1, 3]);
            expect(erst.labelUpperBandsFromLegacy).toBe(1);

            const zweit = await importRegions(database, satz.regions, satz.areas, satz.labels);
            expect(zweit.labels).toMatchObject({ created: 0, updated: 0, unchanged: 2, retired: 0 });
            expect(await band(WALD_LABEL), "ein Ziel 8 wird nie wieder 7").toEqual([5, 8]);
        });

        it("🔴 die Untergrenze 7 bleibt 7, ein Text „7“ wird 8", async () => {
            const satz = mitBand(7, "7");
            await importRegions(database, satz.regions, satz.areas, satz.labels);
            expect(await band(WALD_LABEL)).toEqual([7, 8]);
        });

        it("🔴 ein natives Label mit Maximum 7 behält genau 7 und bleibt aktiv (nur Legacy-Zeilen werden geschrieben)", async () => {
            const satz = mitBand(5, 7);
            await importRegions(database, satz.regions, satz.areas, satz.labels);
            await database`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, subtype, geom, label_min_zoom, label_max_zoom, source_system)
            SELECT ${NATIV}, 'aventuria', r.id, 'Eigener Name', 'wald', ST_SetSRID(ST_MakePoint(104, 104), 0), 4, 7, 'avesmaps3d'
            FROM region r WHERE r.public_id = ${WALD}
        `;
            await importRegions(database, satz.regions, satz.areas, satz.labels);
            const [nativ] = await database<{ max: number; is_active: boolean }[]>`
            SELECT label_max_zoom AS max, is_active FROM map_label WHERE public_id = ${NATIV}
        `;
            expect(nativ).toEqual({ max: 7, is_active: true });
        });

        it("🔴 meldet eine Quelle über 7 als Befund legacy_band_max_changed, der Lauf geht durch", async () => {
            const satz = mitBand(2, 8);
            const report = await importRegions(database, satz.regions, satz.areas, satz.labels);
            expect(await band(WALD_LABEL)).toEqual([2, 8]);
            const befund = report.findings.find((finding) => finding.code === "legacy_band_max_changed");
            expect(befund?.objects).toEqual([{ table: "map_label", publicId: WALD_LABEL, name: "Probewald" }]);
        });

        it("🔴 verify:regions prüft das Band je Kennung gegen die transformierte Quelle und meldet nur", async () => {
            const satz = mitBand(5, 7);
            await importRegions(database, satz.regions, satz.areas, satz.labels);
            const gut = await verifyRegions(database, satz.regions, satz.areas, satz.labels);
            expect(gut.checks.find((check) => check.name === "label_band_parity")).toMatchObject({ passed: true });

            // Jemand schreibt Legacys 7 zurück: das ist ein Paritätsbefund, kein Abbruch.
            await database`UPDATE map_label SET label_max_zoom = 7 WHERE public_id = ${WALD_LABEL}`;
            const schlecht = await verifyRegions(database, satz.regions, satz.areas, satz.labels);
            const band = schlecht.checks.find((check) => check.name === "label_band_parity");
            expect(band).toMatchObject({ passed: false, blocking: false });
            expect(band?.offenders).toEqual([`${WALD_LABEL} (Probewald): Band 5..7 statt 5..8`]);
            expect(schlecht.passed).toBe(true);
        });

        it("🔴 der Probelauf rechnet, nennt jede Änderung je Kennung und Feld und schreibt nichts, auch kein Journal", async () => {
            const alt = mitBand(5, 6);
            await importRegions(database, alt.regions, alt.areas, alt.labels);
            const [laeufeVorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'regions' AND source_ref = ${SOURCE_REF}
        `;

            const neu = mitBand(5, 7);
            const probe = await importRegions(database, neu.regions, neu.areas, neu.labels, { dryRun: true });
            expect(probe.dryRun).toBe(true);
            expect(probe.labelChanges).toEqual([
                { publicId: WALD_LABEL, name: "Probewald", field: "label_max_zoom", before: 6, after: 8 },
            ]);
            expect(await band(WALD_LABEL), "nichts geschrieben").toEqual([5, 6]);
            const [laeufeNachher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'regions' AND source_ref = ${SOURCE_REF}
        `;
            expect(laeufeNachher?.n).toBe(laeufeVorher?.n);
        });
    },
);
