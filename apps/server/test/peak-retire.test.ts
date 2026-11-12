import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { retireLandscapes } from "../src/editor/landscape-retire.ts";
import { peakHistory } from "../src/editor/history.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { createPeak } from "../src/editor/peak-create.ts";
import { retirePeak } from "../src/editor/peak-retire.ts";
import { readEditorPeak } from "../src/editor/peak-update.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck, nimmGipfelZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Gipfel entfernen …“ (Editor-Orchestrierung 2026-10-19): weich, ↺ über den Verlauf, in der Mehrfachauswahl mit den Landschaften in
 * EINER Operation. Im Wegwerf-Cluster mit der Rolle der App wie auf dem VPS (Rechte an `terrain_peak` und am Protokoll). 🔴 Kein Test
 * schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Der Gipfel verschwindet hart; ↺ holt ihn nicht zurück oder nur ihn, nicht die Landschaften derselben Auswahl; ein
 * veralteter Stand löscht trotzdem; der Verlauf führt den Gipfel als Weg; das Fenster des Gelöschten findet nichts mehr.
 */

const ENV = "peakretire";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster(
    "Gipfel entfernen: weich, ↺, Mehrfachauswahl (Wegwerf-Cluster, Rolle der App)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
        const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string };
            }
        };
        let x = 300;
        const gipfel = async (): Promise<string> => {
            x += 7;
            return (await createPeak(cluster!.app, thomas, { operationId: randomUUID(), position: [x, 300] })).publicId;
        };
        const aktiv = async (id: string): Promise<boolean> => {
            const [r] = await cluster!.admin<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM terrain_peak WHERE public_id = ${id}::uuid
        `;
            return r!.aktiv;
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        }, 300_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 „Gipfel entfernen …“ löscht weich in EINER Operation; das Fenster liest ihn als gelöscht; ↺ holt ihn zurück", async () => {
            const g = await gipfel();
            const vorher = (await readEditorPeak(cluster!.app, g))!;
            // Ein veralteter Stand löscht nicht.
            expect(
                await fehler(
                    retirePeak(cluster!.app, thomas, g, {
                        operationId: randomUUID(),
                        baseRevision: vorher.revision + 1,
                    }),
                ),
            ).toMatchObject({ statusCode: 409 });
            const operationId = randomUUID();
            const quittung = await retirePeak(cluster!.app, thomas, g, { operationId, baseRevision: vorher.revision });
            expect(quittung.affected).toEqual([expect.objectContaining({ kind: "peak", id: g })]);
            expect(await aktiv(g)).toBe(false);
            // Weich: Name, Lage und Revision bleiben lesbar.
            expect(await readEditorPeak(cluster!.app, g)).toMatchObject({ id: g, state: "retired", name: vorher.name });
            // Der Verlauf führt ihn als Gipfel.
            const verlauf = await peakHistory(cluster!.app, g, {});
            expect(verlauf.entries[0]).toMatchObject({
                operationId,
                operation: "peak.retire",
                objects: [expect.objectContaining({ kind: "peak", id: g, action: "peak.retired" })],
            });
            await nimmGipfelZurueck(cluster!.app, thomas, g, { operationId: randomUUID(), reverts: operationId });
            expect(await aktiv(g)).toBe(true);
            expect((await readEditorPeak(cluster!.app, g))!.state).toBeUndefined();
            // Ein zweites ↺ derselben Operation: nichts mehr zu holen, Konflikt.
            expect(
                await fehler(
                    nimmGipfelZurueck(cluster!.app, thomas, g, { operationId: randomUUID(), reverts: operationId }),
                ),
            ).toMatchObject({ statusCode: 409 });
        });

        it("🔴 Mehrfachauswahl: Landschaft und zwei Gipfel in EINER Operation; ↺ am Gipfel holt auch die Landschaft zurück", async () => {
            x += 20;
            const { publicId: a } = await createLandscape(cluster!.app, thomas, {
                operationId: randomUUID(),
                layer: "vegetation",
                ring: [
                    [x, 320],
                    [x + 5, 320],
                    [x + 5, 325],
                ],
            });
            const p = await gipfel();
            const q = await gipfel();
            const operationId = randomUUID();
            await retireLandscapes(cluster!.app, thomas, { operationId, ids: [a], peaks: [p, q], stage: "retire" });
            const flaeche = async (): Promise<boolean> => {
                const [r] = await cluster!.admin<{ aktiv: boolean }[]>`
                SELECT is_active AS aktiv FROM region WHERE public_id = ${a}::uuid
            `;
                return r!.aktiv;
            };
            expect([await flaeche(), await aktiv(p), await aktiv(q)]).toEqual([false, false, false]);
            const ops = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
            expect(ops[0]!.n).toBe(1);
            await nimmGipfelZurueck(cluster!.app, thomas, q, { operationId: randomUUID(), reverts: operationId });
            expect([await flaeche(), await aktiv(p), await aktiv(q)]).toEqual([true, true, true]);
            // Nur Gipfel geht auch; ↺ an der Landschaft einer Operation ohne sie wird abgewiesen.
            const nurGipfel = randomUUID();
            await retireLandscapes(cluster!.app, thomas, {
                operationId: nurGipfel,
                ids: [],
                peaks: [p],
                stage: "off_map",
            });
            expect(await aktiv(p)).toBe(false);
            expect(
                await fehler(
                    nimmFlaecheZurueck(cluster!.app, thomas, a, { operationId: randomUUID(), reverts: nurGipfel }),
                ),
            ).toMatchObject({ statusCode: 400 });
            await nimmGipfelZurueck(cluster!.app, thomas, p, { operationId: randomUUID(), reverts: nurGipfel });
            expect(await aktiv(p)).toBe(true);
        });
    },
);
