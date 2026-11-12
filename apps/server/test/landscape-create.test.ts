import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import {
    landschaftsKasten,
    listEditorLandscapes,
    readEditorLandscape,
    readLandscapeTargetsInBox,
} from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Neue Fläche“ der Derographie (WI-0178 T47, `landscape.create`), so wie auf dem VPS: Wegwerf-Cluster, geschrieben als App-Rolle, der Zug
 * als Migrationsrolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die Fläche entsteht ohne Teilfläche oder umgekehrt (Legacys „Leiche“ vom 01.09.2026); der Griff zählt nicht weiter oder
 * doppelt; die neue Fläche liegt nicht vorn in ihrer Ebene; eine wiederholte Kennung legt eine zweite an; ein Ring, der sich selbst kreuzt,
 * scheitert statt repariert zu werden; ein Umriss ohne Fläche oder außerhalb der Karte wird gespeichert; der nächste Landschaften-Zug legt
 * die neue Fläche still; die Glättung bekommt keinen Auftrag.
 */

const ENV = "landcreate";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const FORST = "c7c7c7c7-0000-4000-8000-000000000001";
const FORST_FLAECHE = "c7c7c7c7-0000-4000-8000-0000000000a1";

type Ring = [number, number][];
const quadrat = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: [
                // Ein Griff aus Legacy, von Hand ohne führende Nullen getippt: Er zählt mit (Legacy liest `\d+`).
                { public_id: FORST, name: "Fläche-7", kind: "vegetation", region_type: "wald", area_count: 1 },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9701,
            truncated: false,
            areas: [
                {
                    public_id: FORST_FLAECHE,
                    region_public_id: FORST,
                    geometry: { type: "Polygon", coordinates: [[...quadrat(600, 500, 640, 530), [600, 500]]] },
                },
            ],
        } as never,
        // Eine leere Liste hält der Zug an (Quellenprüfung); die Beschriftung gehört der Fläche aus Legacy.
        labels: {
            ok: true,
            revision: 9702,
            features: [
                {
                    geometry: { type: "Point", coordinates: [620, 515] },
                    properties: {
                        feature_type: "label",
                        public_id: "c7c7c7c7-0000-4000-8000-0000000000c1",
                        name: "Fläche-7",
                        feature_subtype: "wald",
                        ecosystem_region_public_id: FORST,
                    },
                },
            ],
        } as never,
    };
}

describeWithCluster("„Neue Fläche“: landscape.create (WI-0178 T47, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const zug = async () => {
        const satz = quelle();
        return importRegions(importer!, satz.regions, satz.areas, satz.labels);
    };
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
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
        await zug();
    }, 300_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 EINE Operation: Fläche mit Griff, ohne Art und Beschriftung, vorn in ihrer Ebene, mit Teilfläche und Glättung", async () => {
        const operationId = randomUUID();
        const quittung = await createLandscape(cluster!.app, thomas, {
            operationId,
            layer: "vegetation",
            ring: quadrat(500, 500, 540, 530),
        });
        expect(quittung.name).toBe("Fläche-008");
        expect(quittung.derivedWork.map((auftrag) => auftrag.kind).sort()).toEqual([
            "label_runs",
            "land_smooth",
            "tiles",
        ]);
        expect(quittung.mapRevision).toBeGreaterThan(0);

        const [region] = await cluster!.admin<
            { name: string; layer: string; type: string | null; vorn: boolean; quelle: string; aktiv: boolean }[]
        >`
            SELECT name, region_layer AS layer, region_type AS type, source_system AS quelle, is_active AS aktiv,
                   stack_order > (SELECT max(stack_order) FROM region WHERE region_layer = 'vegetation' AND public_id <> ${quittung.publicId}::uuid)
                       AS vorn
              FROM region WHERE public_id = ${quittung.publicId}::uuid
        `;
        expect(region).toEqual({
            name: "Fläche-008",
            layer: "vegetation",
            type: null,
            vorn: true,
            quelle: "avesmaps3d",
            aktiv: true,
        });
        const detail = await readEditorLandscape(cluster!.app, quittung.publicId);
        expect(detail?.areas).toHaveLength(1);
        expect(detail?.labels).toEqual([]);
        expect(detail?.areas[0]?.polygons).toEqual([[quadrat(500, 500, 540, 530)]]);
        const zeile = (await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === quittung.publicId);
        expect(zeile).toMatchObject({ name: "Fläche-008", layer: "vegetation" });

        const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((x) => x.action)).toEqual(["region.created", "area.created"]);

        // Dieselbe Kennung noch einmal: die erste Quittung, keine zweite Fläche.
        const nochmal = await createLandscape(cluster!.app, thomas, {
            operationId,
            layer: "vegetation",
            ring: quadrat(500, 500, 540, 530),
        });
        expect(nochmal.publicId).toBe(quittung.publicId);
        expect(nochmal.name).toBe("Fläche-008");
        const [anzahl] = await cluster!.admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM region WHERE name LIKE 'Fläche-%'`;
        expect(anzahl?.n).toBe(2);

        // Der nächste Landschaften-Zug lässt sie stehen (I2 kennt nur `legacy`).
        await zug();
        const [danach] = await cluster!.admin<{ aktiv: boolean }[]>`
            SELECT r.is_active AND a.is_active AS aktiv FROM region r JOIN region_area a ON a.region_id = r.id
             WHERE r.public_id = ${quittung.publicId}::uuid
        `;
        expect(danach?.aktiv).toBe(true);
    });

    it("ein Ring, der sich selbst kreuzt, wird wie in Legacy repariert; der Griff zählt weiter, auch in einer anderen Ebene", async () => {
        const quittung = await createLandscape(cluster!.app, thomas, {
            operationId: randomUUID(),
            layer: "topographie",
            ring: [
                [700, 500],
                [740, 530],
                [740, 500],
                [700, 530],
                [700, 500],
            ],
        });
        expect(quittung.name).toBe("Fläche-009");
        const detail = await readEditorLandscape(cluster!.app, quittung.publicId);
        // Eine Fliege: zwei Dreiecke.
        expect(detail?.areas[0]?.polygons).toHaveLength(2);
    });

    it("🔴 Ziele im Kasten (`readLandscapeTargetsInBox`): nur Kanten derselben Ebene; ein zu großer Kasten wird auf die Mitte gekürzt", async () => {
        const vegetation = await readLandscapeTargetsInBox(cluster!.app, {
            layer: "vegetation",
            x0: 480,
            y0: 480,
            x1: 660,
            y1: 560,
        });
        const flaechen = new Set(vegetation.edges.map((kante) => kante.name));
        // Der Forst aus Legacy und die neue Fläche-008 liegen in der Vegetation, die Fliege (Fläche-009) in der Topographie.
        expect([...flaechen].sort()).toEqual(["Fläche-008", "Fläche-7"]);
        expect(vegetation.neighbors).toEqual([]);
        const topographie = await readLandscapeTargetsInBox(cluster!.app, {
            layer: "topographie",
            x0: 480,
            y0: 480,
            x1: 760,
            y1: 560,
        });
        expect(new Set(topographie.edges.map((kante) => kante.name))).toEqual(new Set(["Fläche-009"]));
        // 2000 Einheiten breit: gekürzt auf 160 um die Mitte 1000, dort liegt nichts.
        expect(landschaftsKasten({ layer: "vegetation", x0: 0, y0: 500, x1: 2000, y1: 520 })).toEqual([
            920, 500, 1080, 520,
        ]);
    });

    it("🔴 abgewiesen, ohne etwas anzulegen: weniger als drei Ecken, kein Flächeninhalt, außerhalb der Karte", async () => {
        const vorher = (await listEditorLandscapes(cluster!.app)).rows.length;
        const fall = (ring: Ring) =>
            fehler(createLandscape(cluster!.app, thomas, { operationId: randomUUID(), layer: "derographisch", ring }));
        expect(
            await fall([
                [500, 500],
                [520, 500],
                [520, 500],
            ]),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(
            await fall([
                [500, 500],
                [510, 500],
                [520, 500],
            ]),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(await fall(quadrat(-50, -50, -10, -10))).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect((await listEditorLandscapes(cluster!.app)).rows.length).toBe(vorher);
    });
});
