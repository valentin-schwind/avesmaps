import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { splitLandscape } from "../src/editor/landscape-split.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19: „exakt … in zwei flächen teilen und trennen … die schnittlinie soll nicht
 * fortgeführt werden“). Im Wegwerf-Cluster wie auf dem VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Zwischen den Stücken bleibt ein Spalt oder sie überlappen; eine Linie, die in der Fläche endet, schneidet trotzdem
 * (verlängert); das kleinere Stück bleibt statt des größeren; ein ungeschnittener Teil wandert mit; ↺ lässt die neue Landschaft stehen.
 */

const ENV = "landsplit";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)}))`;

describeWithCluster("„Zerschneiden“: exakt an der Linie (Werkzeug 5, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const fehler = async (
        arbeit: Promise<unknown>,
    ): Promise<{ statusCode?: number; code?: string; message?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };
    const lege = async (...stuecke: string[]): Promise<{ id: string; flaeche: string }> => {
        const { publicId } = await createLandscape(cluster!.app, thomas, {
            operationId: randomUUID(),
            layer: "vegetation",
            ring: [
                [100, 100],
                [101, 100],
                [101, 101],
            ],
        });
        await cluster!
            .admin`UPDATE region SET region_type = 'wald', name = 'Probewald' WHERE public_id = ${publicId}::uuid`;
        const flaeche = (await readEditorLandscape(cluster!.app, publicId))!.areas[0]!.id;
        await cluster!.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${stuecke.join(", ")})`}), 0)
             WHERE public_id = ${flaeche}::uuid
        `;
        return { id: publicId, flaeche };
    };
    const stand = async (flaeche: string) => {
        const [z] = await cluster!.admin<{ revision: number; aktiv: boolean; teile: number; f: number }[]>`
            SELECT revision::int AS revision, is_active AS aktiv, ST_NumGeometries(geom)::int AS teile, ST_Area(geom) AS f
              FROM region_area WHERE public_id = ${flaeche}::uuid
        `;
        return z!;
    };
    const schneide = async (
        wald: { id: string; flaeche: string },
        line: [number, number][],
        operationId = randomUUID(),
    ) =>
        splitLandscape(cluster!.app, thomas, wald.id, {
            operationId,
            areaId: wald.flaeche,
            baseRevision: (await stand(wald.flaeche)).revision,
            line,
        });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 ein Knick durch die Fläche teilt exakt: das größere Stück bleibt, das kleinere wird eine eigene Landschaft mit Name und Art der Quelle, ohne Spalt", async () => {
        const wald = await lege(quadrat(500, 500, 540, 520));
        // Von oben hinein, geknickt, unten wieder hinaus: links 10 breit, rechts 30.
        const operationId = randomUUID();
        const quittung = await schneide(
            wald,
            [
                [510, 495],
                [512, 510],
                [510, 525],
            ],
            operationId,
        );
        // Kein Platzhalter: Das Stück trägt Name und Art der Quelle (Editor-Orchestrierung 2026-10-19).
        expect(quittung.name).toBe("Probewald");
        const neu = await readEditorLandscape(cluster!.app, quittung.publicId!);
        expect(neu).toMatchObject({ name: "Probewald", layer: "vegetation", type: "wald" });
        const rest = await stand(wald.flaeche);
        const stueck = await stand(neu!.areas[0]!.id);
        expect(rest.f + stueck.f).toBeCloseTo(40 * 20, 6);
        expect(rest.f).toBeGreaterThan(stueck.f);
        // Exakt: Die beiden teilen die Schnittkante, ohne Überlappung und ohne Spalt.
        const [kante] = await cluster!.admin<{ gemeinsam: number; ueber: number }[]>`
            SELECT ST_Length(ST_Intersection(ST_Boundary(a.geom), ST_Boundary(b.geom))) AS gemeinsam,
                   ST_Area(ST_Intersection(a.geom, b.geom)) AS ueber
              FROM region_area a, region_area b
             WHERE a.public_id = ${wald.flaeche}::uuid AND b.public_id = ${neu!.areas[0]!.id}::uuid
        `;
        expect(kante!.ueber).toBeCloseTo(0, 9);
        // In der Fläche (y 500 bis 520) läuft jeder Schenkel 10 hoch und 4/3 zur Seite.
        expect(kante!.gemeinsam).toBeCloseTo(2 * Math.hypot(4 / 3, 10), 6);
        const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((z) => z.action)).toEqual(["area.split", "region.created", "area.created"]);

        await nimmFlaecheZurueck(cluster!.app, thomas, wald.id, { operationId: randomUUID(), reverts: operationId });
        expect((await stand(wald.flaeche)).f).toBeCloseTo(800, 6);
        expect(await stand(neu!.areas[0]!.id)).toMatchObject({ aktiv: false });
    });

    it("🔴 die Linie wird nicht verlängert: endet sie in der Fläche, wird nicht geschnitten (400, nichts geschrieben)", async () => {
        const wald = await lege(quadrat(600, 500, 640, 520));
        const rev = (await stand(wald.flaeche)).revision;
        expect(
            await fehler(
                schneide(wald, [
                    [610, 495],
                    [610, 515],
                ]),
            ),
        ).toMatchObject({ statusCode: 400, message: expect.stringContaining("nicht vollständig") });
        expect(await stand(wald.flaeche)).toMatchObject({ revision: rev, teile: 1 });
    });

    it("ein ungeschnittener Teil bleibt bei der Quelle; nur das abgeschnittene Stück wandert", async () => {
        const wald = await lege(quadrat(700, 500, 740, 520), quadrat(800, 500, 810, 510));
        const quittung = await schneide(wald, [
            [730, 495],
            [730, 525],
        ]);
        expect(await stand(wald.flaeche)).toMatchObject({ teile: 2 });
        expect((await stand(wald.flaeche)).f).toBeCloseTo(30 * 20 + 100, 6);
        const neu = await readEditorLandscape(cluster!.app, quittung.publicId!);
        expect((await stand(neu!.areas[0]!.id)).f).toBeCloseTo(10 * 20, 6);
    });

    it("ein alter Stand ist 409; eine fremde Landschaft 404", async () => {
        const wald = await lege(quadrat(900, 500, 940, 520));
        const anders = await lege(quadrat(900, 600, 940, 620));
        const rev = (await stand(wald.flaeche)).revision;
        const fall = (baseRevision: number, landschaft: string) =>
            fehler(
                splitLandscape(cluster!.app, thomas, landschaft, {
                    operationId: randomUUID(),
                    areaId: wald.flaeche,
                    baseRevision,
                    line: [
                        [910, 495],
                        [910, 525],
                    ],
                }),
            );
        expect(await fall(rev + 1, wald.id)).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await fall(rev, anders.id)).toMatchObject({ statusCode: 404 });
    });
});
