import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { LANDSCAPE_BATCH_MAX, LandscapeBatchBody, LandscapeBatchRetireBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { batchLandscapes } from "../src/editor/landscape-batch.ts";
import { retireLandscapes } from "../src/editor/landscape-retire.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * Die Mehrfachauswahl der Derographie mit allen Landschaften (Editor-Orchestrierung 2026-10-20 nach dem Fund der Gebiete: über
 * `LANDSCAPE_BATCH_MAX = 500` schlugen Sammel-Ändern und -Entfernen still fehl; die Stage hat 6.087 Landschaften, die Liste mit Gipfeln
 * 6.613 Zeilen). Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle, geschrieben als App-Rolle. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder die geteilte Testdatenbank.
 *
 * Problemfälle: die Grenze trägt nicht alle Zeilen der Stage; Verbergen oder Entfernen über alle schreibt mehr als EINE Operation; ↺ holt
 * nicht alle zurück; Zeit oder Speicher einer Operation über alle laufen aus dem Ruder.
 */

const ENV = "landsammelgross";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `e4e4e4e4-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Wie auf der Stage: so viele Landschaften, jede mit einer kleinen eigenen Fläche, ohne Überlappung. */
const ANZAHL = 6100;
const STAGE_ZEILEN = 6613;
const REGIONEN = Array.from({ length: ANZAHL }, (_, i) => ID(0x1000 + i));

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: REGIONEN.map((id, i) => ({
                public_id: id,
                name: `Probewald ${String(i + 1)}`,
                kind: "vegetation",
                region_type: "wald",
                area_count: 1,
            })),
        } as never,
        areas: {
            ok: true,
            revision: 9701,
            truncated: false,
            areas: REGIONEN.map((id, i) => {
                const x = 100 + (i % 80) * 6;
                const y = 100 + Math.floor(i / 80) * 6;
                return {
                    public_id: ID(0x400000 + i),
                    region_public_id: id,
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [x, y],
                                [x + 5, y],
                                [x + 5, y + 5],
                                [x, y + 5],
                                [x, y],
                            ],
                        ],
                    },
                };
            }),
        } as never,
        // Der Zug verlangt eine Kartenquelle mit Beschriftungen: eine an der ersten Landschaft.
        labels: {
            ok: true,
            revision: 9702,
            features: [
                {
                    geometry: { type: "Point", coordinates: [102, 102] },
                    properties: {
                        feature_type: "label",
                        public_id: ID(0x800000),
                        name: "Probewald 1",
                        feature_subtype: "wald",
                        ecosystem_region_public_id: REGIONEN[0],
                    },
                },
            ],
        } as never,
    };
}

describeWithCluster(
    "Mehrfachauswahl der Derographie mit allen Landschaften (Wegwerf-Cluster)",
    { timeout: 900_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const zaehle = async (bedingung: "aktiv" | "verborgen", ids: readonly string[]): Promise<number> =>
            Number(
                (
                    await cluster!.admin.unsafe<{ n: string }[]>(
                        `SELECT count(*)::text AS n FROM region WHERE ${bedingung === "aktiv" ? "is_active" : "is_hidden"} AND public_id = ANY($1::uuid[])`,
                        [[...ids]],
                    )
                )[0]!.n,
            );
        const operationen = async (): Promise<number> =>
            Number((await cluster!.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);
        const gemessen = async <T>(arbeit: () => Promise<T>): Promise<{ wert: T; ms: number; mb: number }> => {
            const vorher = process.memoryUsage().heapUsed;
            const anfang = performance.now();
            const wert = await arbeit();
            return {
                wert,
                ms: Math.round(performance.now() - anfang),
                mb: Math.round((process.memoryUsage().heapUsed - vorher) / 1e6),
            };
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            const satz = quelle();
            await importRegions(importer, satz.regions, satz.areas, satz.labels);
        }, 900_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 die Grenze trägt alle Zeilen der Stage (6.613) mit Luft; darüber weist das Schema ab", () => {
            // 2 × wie bei den Gebieten wären 13.226: Entfernen bräuchte dann um 30 s, und eine einzelne Anfrage soll unter einer halben Minute bleiben.
            expect(LANDSCAPE_BATCH_MAX).toBeGreaterThanOrEqual(STAGE_ZEILEN);
            const ids = (n: number) => Array.from({ length: n }, (_, i) => ID(0x100000 + i));
            const body = (n: number) => ({ operationId: randomUUID(), ids: ids(n), changes: { hidden: true } });
            expect(Value.Check(LandscapeBatchBody, body(LANDSCAPE_BATCH_MAX))).toBe(true);
            expect(Value.Check(LandscapeBatchBody, body(LANDSCAPE_BATCH_MAX + 1))).toBe(false);
            const weg = (n: number) => ({ operationId: randomUUID(), ids: ids(n), stage: "off_map" });
            expect(Value.Check(LandscapeBatchRetireBody, weg(LANDSCAPE_BATCH_MAX))).toBe(true);
            expect(Value.Check(LandscapeBatchRetireBody, weg(LANDSCAPE_BATCH_MAX + 1))).toBe(false);
        });

        it(`🔴 alle ${String(ANZAHL)} verbergen: EINE Operation, die Zeit gemessen; ↺ holt alle zurück`, async () => {
            const ops = await operationen();
            const body = { operationId: randomUUID(), ids: REGIONEN, changes: { hidden: true } };
            const { ms, mb } = await gemessen(() => batchLandscapes(cluster!.app, thomas, body));
            console.warn(
                `Verbergen für alle, ${String(ANZAHL)} Landschaften: ${String(ms)} ms, Halde ${String(mb)} MB`,
            );
            expect(await zaehle("verborgen", REGIONEN)).toBe(ANZAHL);
            expect(await operationen()).toBe(ops + 1);
            expect(ms).toBeLessThan(120_000);
            const zurueck = await gemessen(() =>
                nimmFlaecheZurueck(cluster!.app, thomas, REGIONEN[0]!, {
                    operationId: randomUUID(),
                    reverts: body.operationId,
                }),
            );
            console.warn(`↺ Verbergen, ${String(ANZAHL)} Landschaften: ${String(zurueck.ms)} ms`);
            expect(await zaehle("verborgen", REGIONEN)).toBe(0);
        });

        it(`🔴 alle ${String(ANZAHL)} von der Karte nehmen: EINE Operation, die Zeit gemessen; ↺ holt alle zurück`, async () => {
            const ops = await operationen();
            const body = { operationId: randomUUID(), ids: REGIONEN, stage: "off_map" as const };
            const { ms, mb } = await gemessen(() => retireLandscapes(cluster!.app, thomas, body));
            console.warn(
                `Entfernen für alle, ${String(ANZAHL)} Landschaften: ${String(ms)} ms, Halde ${String(mb)} MB`,
            );
            expect(await zaehle("aktiv", REGIONEN)).toBe(0);
            expect(await operationen()).toBe(ops + 1);
            expect(ms).toBeLessThan(120_000);
            const zurueck = await gemessen(() =>
                nimmFlaecheZurueck(cluster!.app, thomas, REGIONEN[0]!, {
                    operationId: randomUUID(),
                    reverts: body.operationId,
                }),
            );
            console.warn(`↺ Entfernen, ${String(ANZAHL)} Landschaften: ${String(zurueck.ms)} ms`);
            expect(await zaehle("aktiv", REGIONEN)).toBe(ANZAHL);
        });
    },
);
