import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batchLandscapes } from "../src/editor/landscape-batch.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { createPeak } from "../src/editor/peak-create.ts";
import { retireLandscapes } from "../src/editor/landscape-retire.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57): Ebene, Art und „Verbergen“ für alle gewählten Landschaften als EINE Operation,
 * „Entfernen …“ für alle, ↺ als Ganzes. Im Wegwerf-Cluster wie auf dem VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: Eine Landschaft bleibt zurück oder bekommt eine Art aus der falschen Ebene; der Kontinent „Aventurien“ verliert Ebene oder
 * Art; ↺ nimmt nur eine zurück oder überschreibt eine seither geänderte; „Entfernen …“ für alle lässt sich nur einzeln zurückholen.
 */

const ENV = "landbatch";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster(
    "Mehrfachauswahl der Derographie: eine Operation für alle (T57, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
        const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; message?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number };
            }
        };
        let x = 100;
        const lege = async (name: string, type = "wald"): Promise<string> => {
            x += 10;
            const { publicId } = await createLandscape(cluster!.app, thomas, {
                operationId: randomUUID(),
                layer: "vegetation",
                ring: [
                    [x, 100],
                    [x + 5, 100],
                    [x + 5, 105],
                ],
            });
            await cluster!
                .admin`UPDATE region SET region_type = ${type}, name = ${name} WHERE public_id = ${publicId}::uuid`;
            return publicId;
        };
        const stand = async (id: string) => {
            const [r] = await cluster!.admin<
                { layer: string; type: string | null; hidden: boolean; aktiv: boolean; revision: number }[]
            >`
            SELECT region_layer AS layer, region_type AS type, is_hidden AS hidden, is_active AS aktiv, revision::int AS revision
              FROM region WHERE public_id = ${id}::uuid
        `;
            return r!;
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        }, 300_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 Ebene und Art für zwei Landschaften in EINER Operation; ↺ an einer nimmt beide zurück", async () => {
            const a = await lege("Farindel");
            const b = await lege("Reichsforst");
            const operationId = randomUUID();
            await batchLandscapes(cluster!.app, thomas, {
                operationId,
                ids: [a, b],
                changes: { layer: "topographie", type: "huegelland" },
            });
            expect(await stand(a)).toMatchObject({ layer: "topographie", type: "huegelland" });
            expect(await stand(b)).toMatchObject({ layer: "topographie", type: "huegelland" });
            const ops = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
            expect(ops[0]!.n).toBe(1);
            await nimmFlaecheZurueck(cluster!.app, thomas, b, { operationId: randomUUID(), reverts: operationId });
            expect(await stand(a)).toMatchObject({ layer: "vegetation", type: "wald" });
            expect(await stand(b)).toMatchObject({ layer: "vegetation", type: "wald" });
        });

        it("🔴 Verbergen für alle; ↺ verweigert, wenn eine seither geändert wurde, und ändert dann keine", async () => {
            const a = await lege("Hain A");
            const b = await lege("Hain B");
            const operationId = randomUUID();
            await batchLandscapes(cluster!.app, thomas, { operationId, ids: [a, b], changes: { hidden: true } });
            expect(await stand(a)).toMatchObject({ hidden: true });
            expect(await stand(b)).toMatchObject({ hidden: true });
            await cluster!.admin`UPDATE region SET name = 'Hain B, umbenannt' WHERE public_id = ${b}::uuid`;
            expect(
                await fehler(
                    nimmFlaecheZurueck(cluster!.app, thomas, a, { operationId: randomUUID(), reverts: operationId }),
                ),
            ).toMatchObject({ statusCode: 409 });
            expect(await stand(a)).toMatchObject({ hidden: true });
        });

        it("eine neue Ebene ohne Art, eine Art aus der falschen Ebene, der Kontinent „Aventurien“, eine unbekannte: 400 oder 404, nichts geschrieben", async () => {
            const a = await lege("Prüfwald");
            const rahmen = await lege("Aventurien");
            await cluster!.admin`
            UPDATE region SET region_layer = 'derographisch', region_type = 'kontinent' WHERE public_id = ${rahmen}::uuid
        `;
            const vorher = await stand(a);
            const fall = (ids: string[], changes: Parameters<typeof batchLandscapes>[2]["changes"]) =>
                fehler(batchLandscapes(cluster!.app, thomas, { operationId: randomUUID(), ids, changes }));
            expect(await fall([a], { layer: "topographie" })).toMatchObject({ statusCode: 400 });
            expect(await fall([a], { type: "huegelland" })).toMatchObject({ statusCode: 400 });
            expect(await fall([a, rahmen], { layer: "derographisch", type: "region" })).toMatchObject({
                statusCode: 400,
            });
            expect(await fall([a, randomUUID()], { hidden: true })).toMatchObject({ statusCode: 404 });
            expect(await stand(a)).toEqual(vorher);
        });

        it("🔴 Gipfel gehen mit: „Besucher“ für eine Fläche und zwei Gipfel in EINER Operation, ↺ holt alle zurück; Ebene mit Gipfeln 400", async () => {
            // Stage-Fund 2026-10-19: Drei angehakte Vulkane ließen das Fenster leer.
            const a = await lege("Hain am Vulkan");
            const gipfel = async (px: number): Promise<string> =>
                (await createPeak(cluster!.app, thomas, { operationId: randomUUID(), position: [px, 200] })).publicId;
            const p = await gipfel(310);
            const q = await gipfel(320);
            const zeigt = async (id: string): Promise<boolean> => {
                const [r] = await cluster!.admin<{ show: boolean }[]>`
                SELECT NOT 'verborgen' = ANY (merkmale) AS show FROM terrain_peak WHERE public_id = ${id}::uuid
            `;
                return r!.show;
            };
            const operationId = randomUUID();
            await batchLandscapes(cluster!.app, thomas, {
                operationId,
                ids: [a],
                peaks: [p, q],
                changes: { hidden: true },
            });
            expect(await stand(a)).toMatchObject({ hidden: true });
            expect([await zeigt(p), await zeigt(q)]).toEqual([false, false]);
            const ops = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
            expect(ops[0]!.n).toBe(1);
            // ↺ an der Fläche: Sie und beide Gipfel wieder sichtbar.
            await nimmFlaecheZurueck(cluster!.app, thomas, a, { operationId: randomUUID(), reverts: operationId });
            expect(await stand(a)).toMatchObject({ hidden: false });
            expect([await zeigt(p), await zeigt(q)]).toEqual([true, true]);
            // Nur Gipfel geht auch; Ebene oder Art mit Gipfeln nicht.
            await batchLandscapes(cluster!.app, thomas, {
                operationId: randomUUID(),
                ids: [],
                peaks: [q],
                changes: { hidden: true },
            });
            expect(await zeigt(q)).toBe(false);
            const nichtMitGipfel = await fehler(
                batchLandscapes(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    ids: [a],
                    peaks: [p],
                    changes: { layer: "topographie", type: "huegelland" },
                }),
            );
            expect(nichtMitGipfel).toMatchObject({ statusCode: 400 });
            expect(await stand(a)).toMatchObject({ layer: "vegetation" });
        });

        it("🔴 „Entfernen …“ für alle in EINER Operation; ↺ an einer holt alle zurück", async () => {
            const a = await lege("Weg A");
            const b = await lege("Weg B");
            const operationId = randomUUID();
            await retireLandscapes(cluster!.app, thomas, { operationId, ids: [a, b], stage: "off_map" });
            expect(await stand(a)).toMatchObject({ aktiv: false });
            expect(await stand(b)).toMatchObject({ aktiv: false });
            const flaechen = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM region_area a JOIN region r ON r.id = a.region_id
             WHERE r.public_id = ANY(${[a, b]}::uuid[]) AND a.is_active
        `;
            expect(flaechen[0]!.n).toBe(0);
            await nimmFlaecheZurueck(cluster!.app, thomas, a, { operationId: randomUUID(), reverts: operationId });
            expect(await stand(a)).toMatchObject({ aktiv: true });
            expect(await stand(b)).toMatchObject({ aktiv: true });
        });
    },
);
