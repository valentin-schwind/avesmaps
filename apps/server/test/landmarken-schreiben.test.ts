import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EditorLandscapePeakRow, EditorPeakDetail } from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listEditorLandscapes } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { createPeak } from "../src/editor/peak-create.ts";
import { readEditorPeak, updatePeak } from "../src/editor/peak-update.ts";
import { INPUT_INDEX_VERSION, peakIndex } from "../src/terrain/domain/input-index.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Landmarken über die Gipfelwege (WI-0271 L3, Variante D): `peak.create` und `peak.update` mit Art und Merkmalen, so wie auf dem VPS: Wegwerf-Cluster,
 * geschrieben als App-Rolle. 🔴 R5 der Orchestrierung: Eine Zeile einer neuen Art entsteht nur hier, nie in `avesmaps3d_dev` oder der geteilten
 * Testdatenbank.
 *
 * Problemfälle: Eine Landmarke gibt HTTP 500, weil ein Vertrag ihre Art nicht kennt; eine Höhle bekommt eine Höhe oder behält sie beim Wechsel (CHECK);
 * ein Wechsel unter den Arten ohne Gelände reiht Gelände ein; ein Wechsel der Geländewirkung (Berggipfel ↔ Höhle) reiht keines ein; das Protokoll
 * verliert Art oder Merkmale; zwei gleiche Mengen von Merkmalen gelten als Änderung.
 */

const ENV = "lmschr";
const DOMAIN = "aventuria";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const GIPFEL = "c8c8c8c8-0271-4000-8000-000000000001";

describeWithCluster("Landmarken über die Gipfelwege (WI-0271 L3, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const vali: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };
    const gelaende = (quittung: { derivedWork: readonly { kind: string }[] }): string[] =>
        quittung.derivedWork.map((arbeit) => arbeit.kind).filter((kind) => kind === "terrain_local");
    const protokoll = async (operationId: string): Promise<Record<string, { before?: unknown; after?: unknown }>> => {
        const [zeile] = await cluster!.admin<{ changes: Record<string, { before?: unknown; after?: unknown }> }[]>`
            SELECT changes FROM map_audit_event WHERE operation_id = ${operationId}::uuid
        `;
        return zeile?.changes ?? {};
    };
    const aendere = async (id: string, changes: Parameters<typeof updatePeak>[3]["changes"]) => {
        const operationId = randomUUID();
        const stand = (await readEditorPeak(cluster!.app, id))!.revision;
        const quittung = await updatePeak(cluster!.app, vali, id, { operationId, baseRevision: stand, changes });
        return { quittung, changes: await protokoll(operationId) };
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        await m`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${GIPFEL}::uuid, ${DOMAIN}, 'Probezinne', 'berggipfel', ST_SetSRID(ST_MakePoint(530, 515), 0), 2500)
        `;
        // Der geltende Master mit dem Index der heutigen Eingaben (wie `gelaende-lokal-ausloeser.test.ts`): Nur gegen ihn erkennt die Schreibnaht eine Änderung.
        await m`
            INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, input_index)
            VALUES (${DOMAIN}, 'master-0271', 'eingaben-0271', '19', 4096, decode(repeat('0000', 4096 * 4096), 'hex'), '{}',
                    ${m.json({ v: INPUT_INDEX_VERSION, objects: await peakIndex(m, DOMAIN) })})
        `;
        await m`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
            VALUES ('a0271a000001', ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, 1, true, 'master-0271')
        `;
    }, 300_000);

    beforeEach(async () => {
        await cluster!.admin`DELETE FROM job_event`;
        await cluster!.admin`DELETE FROM job`;
    });

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    let hoehle = "";

    it("🔴 `peak.create` mit Art und Merkmalen: „Landmarke-001“, ohne Höhe, Merkmale in der Folge des Katalogs, kein Gelände", async () => {
        const operationId = randomUUID();
        const quittung = await createPeak(cluster!.app, vali, {
            operationId,
            position: [534, 512],
            subtype: "hoehle",
            merkmale: ["verborgen", "heilig", "verborgen"],
        });
        hoehle = quittung.publicId;
        expect(quittung.name).toBe("Landmarke-001");
        expect(gelaende(quittung)).toEqual([]);
        const detail = await readEditorPeak(cluster!.app, hoehle);
        expect(detail).toEqual({
            id: hoehle,
            name: "Landmarke-001",
            subtype: "hoehle",
            merkmale: ["heilig", "verborgen"],
            showName: true,
            position: [534, 512],
            revision: 1,
        });
        // Der Antwortvertrag kennt die Art (sonst gäbe Fastify 500).
        expect(Value.Check(EditorPeakDetail, detail)).toBe(true);
        const changes = await protokoll(operationId);
        expect(Object.keys(changes).sort()).toEqual(["active", "merkmale", "name", "position", "subtype"]);
        expect(changes["merkmale"]).toEqual({ after: ["heilig", "verborgen"] });
    });

    it("🔴 ein Wechsel unter den Arten ohne Gelände reiht nichts ein; dieselben Merkmale in anderer Folge sind keine Änderung", async () => {
        const { quittung, changes } = await aendere(hoehle, {
            subtype: "schlucht",
            merkmale: ["gefaehrlich", "magisch"],
        });
        expect(gelaende(quittung)).toEqual([]);
        expect(changes).toEqual({
            subtype: { before: "hoehle", after: "schlucht" },
            merkmale: { before: ["heilig", "verborgen"], after: ["magisch", "gefaehrlich"] },
        });
        // Dieselbe Menge in anderer Folge: nichts zu ändern.
        expect(
            await fehler(
                updatePeak(cluster!.app, vali, hoehle, {
                    operationId: randomUUID(),
                    baseRevision: (await readEditorPeak(cluster!.app, hoehle))!.revision,
                    changes: { merkmale: ["magisch", "gefaehrlich"] },
                }),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
    });

    it("🔴 eine Höhe an einer Art ohne Gelände ist 400; mit dem Wechsel zum Berggipfel geht sie, und das Gelände rechnet (Schlucht → Berggipfel)", async () => {
        const stand = (await readEditorPeak(cluster!.app, hoehle))!.revision;
        expect(
            await fehler(
                updatePeak(cluster!.app, vali, hoehle, {
                    operationId: randomUUID(),
                    baseRevision: stand,
                    changes: { height: 900 },
                }),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        const { quittung, changes } = await aendere(hoehle, { subtype: "berggipfel", height: 1800 });
        expect(gelaende(quittung)).toEqual(["terrain_local"]);
        expect(changes).toMatchObject({
            subtype: { before: "schlucht", after: "berggipfel" },
            height: { before: null, after: 1800 },
            heightOrigin: { before: null, after: "manual" },
        });
    });

    it("🔴 Berggipfel → Höhle leert die Höhe (CHECK) und rechnet das Gelände; der Vermerk der Höhe bleibt", async () => {
        const { quittung, changes } = await aendere(GIPFEL, { subtype: "hoehle" });
        expect(gelaende(quittung)).toEqual(["terrain_local"]);
        expect(changes).toEqual({
            subtype: { before: "berggipfel", after: "hoehle" },
            height: { before: 2500, after: null },
        });
        const detail = await readEditorPeak(cluster!.app, GIPFEL);
        expect(detail).toMatchObject({ subtype: "hoehle" });
        expect(detail?.height).toBeUndefined();
        await aendere(GIPFEL, { name: "Probehöhle" });
    });

    it("die Liste der Derographie führt jede Landmarkenart unter `peaks`, im Vertrag der Zeile", async () => {
        const liste = await listEditorLandscapes(cluster!.app);
        const zeile = liste.peaks?.find((row) => row.id === GIPFEL);
        expect(zeile).toMatchObject({ subtype: "hoehle", name: "Probehöhle" });
        expect(zeile?.height).toBeUndefined();
        for (const row of liste.peaks ?? []) expect(Value.Check(EditorLandscapePeakRow, row)).toBe(true);
    });
});
