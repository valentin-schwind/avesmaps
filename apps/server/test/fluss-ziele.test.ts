import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTargetsInBox } from "../src/editor/path-create.ts";
import { readPathTargets } from "../src/editor/path-edit.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Andockziele eines Flusses (Vali 2026-11-08: „dass beim Editieren von Flussverläufen in der Derographie Flüsse an Seen, anderen
 * Flächen und anderen Flüssen "andocken" können“), gelesen als App-Rolle im Wegwerf-Cluster wie auf dem VPS. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die App-Rolle darf Flächen nicht lesen; ein Weg bekommt Flächen; der eigene Fluss ist sein eigenes Ziel; die Ebenen der
 * Ansicht wirken nicht (das Seeufer liegt in der Topographie, der Wald in der Vegetation); eine Fläche oder ein Fluss außerhalb des
 * Kastens kommt mit; „Neuer Fluss“ bekommt sie nicht, ein neuer Weg bekommt sie.
 */

const ENV = "flussziele";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const FLUSS = "f1f1f1f1-0000-4000-8000-000000000001";
const NEBENFLUSS = "f1f1f1f1-0000-4000-8000-000000000002";
const FERNER_FLUSS = "f1f1f1f1-0000-4000-8000-000000000003";
const STRASSE = "f1f1f1f1-0000-4000-8000-000000000004";
const SEE = "f1f1f1f1-0000-4000-8000-0000000000a1";
const WALD = "f1f1f1f1-0000-4000-8000-0000000000a2";
const FERNER_SEE = "f1f1f1f1-0000-4000-8000-0000000000a3";

describeWithCluster("Andockziele eines Flusses (Vali 2026-11-08, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const db = cluster.admin;
        const weg = async (id: string, subtype: string, punkte: [number, number][]): Promise<void> => {
            const wkt = `LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`;
            await db`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${id}::uuid, 'aventuria', ${id.slice(-2)}, ${subtype}, FALSE, FALSE, ST_GeomFromText(${wkt}, 0), 'test-fluss', TRUE)
            `;
        };
        const flaeche = async (id: string, name: string, layer: string, type: string, wkt: string): Promise<void> => {
            const [region] = await db<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (gen_random_uuid(), 'aventuria', ${name}, ${layer}, ${type}, TRUE)
                RETURNING id::text
            `;
            await db`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${id}::uuid, 'aventuria', ${region!.id}, ST_GeomFromText(${wkt}, 0), TRUE)
            `;
        };
        // Der Fluss von (500|500) nach (520|500); sein Kasten samt Rand 15 reicht von 485 bis 535.
        await weg(FLUSS, "Flussweg", [
            [500, 500],
            [510, 502],
            [520, 500],
        ]);
        await weg(NEBENFLUSS, "Flussweg", [
            [510, 480],
            [510, 495],
        ]);
        await weg(FERNER_FLUSS, "Flussweg", [
            [700, 700],
            [710, 700],
        ]);
        await weg(STRASSE, "Strasse", [
            [505, 490],
            [515, 490],
        ]);
        await flaeche(SEE, "Probesee", "topographie", "see", "POLYGON((522 495, 530 495, 530 505, 522 505, 522 495))");
        await flaeche(
            WALD,
            "Probewald",
            "vegetation",
            "wald",
            "POLYGON((495 505, 505 505, 505 515, 495 515, 495 505))",
        );
        await flaeche(FERNER_SEE, "Fernsee", "topographie", "see", "POLYGON((700 710, 710 710, 710 720, 700 710))");
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 ein Fluss bekommt Ufer und Ränder der verlangten Ebenen und die Strecken anderer Flüsse, nicht sich selbst und nichts Fernes", async () => {
        const ziele = await readPathTargets(cluster!.app, FLUSS);
        expect(new Set(ziele?.areaEdges?.map((kante) => kante.areaId))).toEqual(new Set([SEE, WALD]));
        expect(ziele?.areaEdges?.filter((kante) => kante.areaId === SEE)).toHaveLength(4);
        expect(ziele?.areaEdges?.find((kante) => kante.areaId === SEE)).toMatchObject({ name: "Probesee" });
        expect(ziele?.riverEdges).toEqual([{ pathId: NEBENFLUSS, name: "02", index: 0, a: [510, 480], b: [510, 495] }]);
        // Die Stützpunkte des Nebenflusses und der Straße stehen wie bisher unter den Stützpunkten.
        expect(new Set(ziele?.vertices.map((v) => v.pathId))).toEqual(new Set([NEBENFLUSS, STRASSE]));

        const topographie = await readPathTargets(cluster!.app, FLUSS, ["topographie"]);
        expect(new Set(topographie?.areaEdges?.map((kante) => kante.areaId))).toEqual(new Set([SEE]));
        expect(topographie?.riverEdges).toHaveLength(1);
        const keine = await readPathTargets(cluster!.app, FLUSS, []);
        expect(keine?.areaEdges).toEqual([]);
        expect(keine?.riverEdges).toHaveLength(1);
    });

    it("🔴 ein Weg bekommt weder Flächen noch Flussstrecken", async () => {
        const ziele = await readPathTargets(cluster!.app, STRASSE);
        expect(ziele?.areaEdges).toBeUndefined();
        expect(ziele?.riverEdges).toBeUndefined();
        expect(ziele?.vertices.some((v) => v.pathId === FLUSS)).toBe(true);
    });

    it("🔴 „Neuer Fluss/Bach“ im Kasten: mit Art die Flächen der Ebenen und alle Flüsse darin; ein neuer Weg nicht", async () => {
        const kasten = { x0: 490, y0: 470, x1: 535, y1: 520 };
        const fluss = await readTargetsInBox(cluster!.app, { ...kasten, art: "fluss", layers: "topographie" });
        expect(new Set(fluss.areaEdges?.map((kante) => kante.areaId))).toEqual(new Set([SEE]));
        expect(new Set(fluss.riverEdges?.map((kante) => kante.pathId))).toEqual(new Set([FLUSS, NEBENFLUSS]));
        expect(fluss.riverEdges?.filter((kante) => kante.pathId === FLUSS).map((kante) => kante.index)).toEqual([0, 1]);
        const bach = await readTargetsInBox(cluster!.app, { ...kasten, art: "bach" });
        expect(new Set(bach.areaEdges?.map((kante) => kante.areaId))).toEqual(new Set([SEE, WALD]));
        const weg = await readTargetsInBox(cluster!.app, kasten);
        expect(weg.areaEdges).toBeUndefined();
        expect(weg.riverEdges).toBeUndefined();
    });
});
