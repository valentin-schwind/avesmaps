import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maleStrich } from "../src/editor/landscape-brush.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fläche malen“ und „Fläche radieren“ (Werkzeug 6): EIN Strich, gerechnet, nichts geschrieben. Im Wegwerf-Cluster wie auf dem VPS.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Der Strich schreibt; Malen lässt eine Lücke zur Fläche oder überlappt doppelt; Radieren quer durch lässt einen Steg
 * stehen oder vereinigt die Stücke wieder; ganz wegradieren ergibt eine leere Fläche; ein Strich an einer fremden Teilfläche geht durch.
 */

const ENV = "landbrush";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

/** Das Rechteck 500..540 × 500..520 (Fläche 800) als Teilfläche im Entwurf, eckig, ohne Schlusspunkt. */
const RECHTECK: [number, number][][][] = [
    [
        [
            [500, 500],
            [540, 500],
            [540, 520],
            [500, 520],
        ],
    ],
];

describeWithCluster(
    "„Fläche malen“ und „Fläche radieren“: ein Strich in PostGIS (Werkzeug 6, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
        let wald: { id: string; flaeche: string; revision: number } | undefined;
        const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; message?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number };
            }
        };
        const flaeche = async (polygons: [number, number][][][]): Promise<number> => {
            const [r] = await cluster!.admin<{ f: number }[]>`
            SELECT ST_Area(ST_GeomFromGeoJSON(${JSON.stringify({
                type: "MultiPolygon",
                coordinates: polygons.map((p) => p.map((ring) => [...ring, ring[0]!])),
            })})) AS f
        `;
            return r!.f;
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const { publicId } = await createLandscape(cluster.app, thomas, {
                operationId: randomUUID(),
                layer: "vegetation",
                ring: [
                    [500, 500],
                    [540, 500],
                    [540, 520],
                    [500, 520],
                ],
            });
            const detail = (await readEditorLandscape(cluster.app, publicId))!;
            wald = { id: publicId, flaeche: detail.areas[0]!.id, revision: detail.areas[0]!.revision };
        }, 300_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 Malen hängt die Spur an, rund und ohne Lücke; geschrieben wird nichts", async () => {
            const neu = await maleStrich(cluster!.app, wald!.id, {
                areaId: wald!.flaeche,
                mode: "malen",
                polygons: RECHTECK,
                line: [
                    [540, 510],
                    [560, 510],
                ],
                radius: 5,
                quadSegs: 8,
            });
            expect(neu.polygons).toHaveLength(1);
            // 800 + der Streifen 20 × 10 außerhalb + die halbe Kappe am Ende (die andere Hälfte liegt in der Fläche).
            expect(await flaeche(neu.polygons)).toBeCloseTo(800 + 200 + (Math.PI * 25) / 2, 0);
            expect(Math.max(...neu.polygons[0]![0]!.map(([x]) => x))).toBeCloseTo(565, 1);
            const gespeichert = (await readEditorLandscape(cluster!.app, wald!.id))!.areas[0]!;
            expect(gespeichert.revision).toBe(wald!.revision);
        });

        it("🔴 Radieren quer durch teilt in zwei Stücke; ein Stempel fern der Fläche wird ein eigenes Stück", async () => {
            const geteilt = await maleStrich(cluster!.app, wald!.id, {
                areaId: wald!.flaeche,
                mode: "radieren",
                polygons: RECHTECK,
                line: [
                    [520, 490],
                    [520, 530],
                ],
                radius: 2,
                quadSegs: 8,
            });
            expect(geteilt.polygons).toHaveLength(2);
            expect(await flaeche(geteilt.polygons)).toBeCloseTo(800 - 4 * 20, 3);
            const insel = await maleStrich(cluster!.app, wald!.id, {
                areaId: wald!.flaeche,
                mode: "malen",
                polygons: RECHTECK,
                line: [[600, 600]],
                radius: 3,
                quadSegs: 4,
            });
            expect(insel.polygons).toHaveLength(2);
        });

        it("ganz wegradieren ist 400; eine fremde Teilfläche 404", async () => {
            expect(
                await fehler(
                    maleStrich(cluster!.app, wald!.id, {
                        areaId: wald!.flaeche,
                        mode: "radieren",
                        polygons: RECHTECK,
                        line: [[520, 510]],
                        radius: 100,
                        quadSegs: 8,
                    }),
                ),
            ).toMatchObject({ statusCode: 400, message: expect.stringContaining("Fläche entfernen") });
            expect(
                await fehler(
                    maleStrich(cluster!.app, randomUUID(), {
                        areaId: wald!.flaeche,
                        mode: "malen",
                        polygons: RECHTECK,
                        line: [[520, 510]],
                        radius: 1,
                        quadSegs: 2,
                    }),
                ),
            ).toMatchObject({ statusCode: 404 });
        });
    },
);
