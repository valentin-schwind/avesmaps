import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booleanLandscape, vorschauFlaechen } from "../src/editor/landscape-boolean.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Mit anderer Fläche ›“: die Rechnung (Werkzeug 1, Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy `boolean.js`). Im
 * Wegwerf-Cluster wie auf dem VPS, gelesen als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Vereinigen verliert ein Stück oder lässt eine Lücke; Ausschneiden mitten hinein ergibt kein Loch; die Schnittmenge
 * getrennter Flächen ist „leer“ statt eines Fehlers; dieselbe Teilfläche als Ziel; eine Teilfläche einer anderen Landschaft gilt als
 * Quelle; „die andere Landschaft geht mit“ stimmt nicht.
 */

const ENV = "landbool";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

type Ring = [number, number][];
const quadrat = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];
/** Die Fläche eines Polygons mit Löchern (Gaußsche Trapezformel). */
const flaeche = (polygone: number[][][][]): number =>
    polygone.reduce(
        (summe, polygon) =>
            summe +
            polygon.reduce((teil, ring, i) => {
                let doppelt = 0;
                ring.forEach(([x, y], j) => {
                    const [nx, ny] = ring[(j + 1) % ring.length]!;
                    doppelt += x! * ny! - nx! * y!;
                });
                return teil + (i === 0 ? 1 : -1) * Math.abs(doppelt / 2);
            }, 0),
        0,
    );

describeWithCluster("„Mit anderer Fläche“: Rechnung (Werkzeug 1, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
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
    /** Eine neue Landschaft mit einer Teilfläche; gibt Landschaft und Teilfläche. */
    const lege = async (ring: Ring): Promise<{ id: string; flaeche: string }> => {
        const { publicId } = await createLandscape(cluster!.app, thomas, {
            operationId: randomUUID(),
            layer: "vegetation",
            ring,
        });
        const detail = await readEditorLandscape(cluster!.app, publicId);
        return { id: publicId, flaeche: detail!.areas[0]!.id };
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 vereinigen: zwei überlappende Quadrate werden eines ohne Lücke; die andere geht mit, und mit ihr ihre Landschaft", async () => {
        const wald = await lege(quadrat(500, 500, 540, 530));
        const hain = await lege(quadrat(530, 500, 560, 530));
        const v = await vorschauFlaechen(cluster!.app, wald.id, {
            operation: "vereinigen",
            areaId: wald.flaeche,
            targetAreaId: hain.flaeche,
        });
        expect(v.polygons).toHaveLength(1);
        expect(v.polygons[0]).toHaveLength(1);
        expect(flaeche(v.polygons)).toBeCloseTo(60 * 30, 6);
        expect([v.consumesTarget, v.targetLandscapeGoes]).toEqual([true, true]);
    });

    it("🔴 ausschneiden mitten hinein: die Quelle bekommt ein Loch; die Schnittmenge ist das kleine Stück und lässt die andere stehen", async () => {
        const moor = await lege(quadrat(600, 500, 660, 560));
        const see = await lege(quadrat(620, 520, 640, 540));
        const ohne = await vorschauFlaechen(cluster!.app, moor.id, {
            operation: "ausschneiden",
            areaId: moor.flaeche,
            targetAreaId: see.flaeche,
        });
        expect(ohne.polygons).toHaveLength(1);
        expect(ohne.polygons[0]).toHaveLength(2);
        expect(flaeche(ohne.polygons)).toBeCloseTo(60 * 60 - 20 * 20, 6);
        const mit = await vorschauFlaechen(cluster!.app, moor.id, {
            operation: "schnittmenge",
            areaId: moor.flaeche,
            targetAreaId: see.flaeche,
        });
        expect(flaeche(mit.polygons)).toBeCloseTo(20 * 20, 6);
        expect([mit.consumesTarget, mit.targetLandscapeGoes]).toEqual([false, false]);
    });

    it("abgewiesen: getrennte Flächen schneiden sich nicht, dieselbe Teilfläche, eine Quelle anderer Landschaft, eine, die es nicht gibt", async () => {
        const a = await lege(quadrat(700, 500, 710, 510));
        const b = await lege(quadrat(720, 500, 730, 510));
        const fall = (operation: "vereinigen" | "schnittmenge", quelle: string, ziel: string, landschaft = a.id) =>
            fehler(vorschauFlaechen(cluster!.app, landschaft, { operation, areaId: quelle, targetAreaId: ziel }));
        expect(await fall("schnittmenge", a.flaeche, b.flaeche)).toMatchObject({
            statusCode: 400,
            code: "validation_failed",
        });
        expect(await fall("vereinigen", a.flaeche, a.flaeche)).toMatchObject({ statusCode: 400 });
        expect(await fall("vereinigen", b.flaeche, a.flaeche)).toMatchObject({ statusCode: 404 });
        expect(await fall("vereinigen", a.flaeche, randomUUID())).toMatchObject({ statusCode: 404 });
        // Getrennte Flächen vereinigen ergibt zwei Polygone (eine Exklave), wie in Legacy.
        const zwei = await vorschauFlaechen(cluster!.app, a.id, {
            operation: "vereinigen",
            areaId: a.flaeche,
            targetAreaId: b.flaeche,
        });
        expect(zwei.polygons).toHaveLength(2);
    });

    /** Revision und Aktivität einer Teilfläche und ihrer Landschaft, gelesen als Admin. */
    const stand = async (flaeche: string) => {
        const [z] = await cluster!.admin<{ revision: number; aktiv: boolean; region_aktiv: boolean; f: number }[]>`
            SELECT a.revision::int AS revision, a.is_active AS aktiv, r.is_active AS region_aktiv, ST_Area(a.geom) AS f
              FROM region_area a JOIN region r ON r.id = a.region_id WHERE a.public_id = ${flaeche}::uuid
        `;
        return z!;
    };

    it("🔴 vereinigen schreibt EINE Operation: Quelle neu, die andere samt ihrer Landschaft von der Karte; ↺ holt beides zurück", async () => {
        const wald = await lege(quadrat(500, 600, 540, 630));
        const hain = await lege(quadrat(530, 600, 560, 630));
        const vorher = await stand(wald.flaeche);
        const operationId = randomUUID();
        const quittung = await booleanLandscape(cluster!.app, thomas, wald.id, {
            operationId,
            operation: "vereinigen",
            areaId: wald.flaeche,
            baseRevision: vorher.revision,
            targetAreaId: hain.flaeche,
            targetBaseRevision: (await stand(hain.flaeche)).revision,
        });
        expect(quittung.derivedWork.map((a) => a.kind)).toContain("land_smooth");
        const nachher = await stand(wald.flaeche);
        expect(nachher.f).toBeCloseTo(60 * 30, 6);
        expect(await stand(hain.flaeche)).toMatchObject({ aktiv: false, region_aktiv: false });
        const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((z) => z.action)).toEqual(["area.boolean", "area.retired", "region.retired"]);

        await nimmFlaecheZurueck(cluster!.app, thomas, wald.id, { operationId: randomUUID(), reverts: operationId });
        expect((await stand(wald.flaeche)).f).toBeCloseTo(40 * 30, 6);
        expect(await stand(hain.flaeche)).toMatchObject({ aktiv: true, region_aktiv: true });
        // Ein zweites ↺ findet nichts mehr, das so steht: 409.
        expect(
            await fehler(
                nimmFlaecheZurueck(cluster!.app, thomas, wald.id, { operationId: randomUUID(), reverts: operationId }),
            ),
        ).toMatchObject({ statusCode: 409, code: "already_reverted" });
    });

    it("„… behalten“ und die Schnittmenge lassen die andere stehen", async () => {
        let x = 600;
        for (const operation of ["vereinigen-behalten", "ausschneiden-behalten", "schnittmenge"] as const) {
            const berg = await lege(quadrat(x, 600, x + 20, 620));
            const forst = await lege(quadrat(x + 10, 600, x + 30, 620));
            x += 40;
            await booleanLandscape(cluster!.app, thomas, berg.id, {
                operationId: randomUUID(),
                operation,
                areaId: berg.flaeche,
                baseRevision: (await stand(berg.flaeche)).revision,
                targetAreaId: forst.flaeche,
                targetBaseRevision: (await stand(forst.flaeche)).revision,
            });
            expect(await stand(forst.flaeche)).toMatchObject({ aktiv: true, region_aktiv: true });
        }
    });

    it("🔴 ein alter Stand der anderen ist 409 `edit_conflict`; hält ein anderer sie, 409 `object_locked`, und nichts ist geschrieben", async () => {
        const a = await lege(quadrat(700, 600, 720, 620));
        const b = await lege(quadrat(710, 600, 730, 620));
        const koerper = async (targetBaseRevision: number) => ({
            operationId: randomUUID(),
            operation: "vereinigen" as const,
            areaId: a.flaeche,
            baseRevision: (await stand(a.flaeche)).revision,
            targetAreaId: b.flaeche,
            targetBaseRevision,
        });
        const rev = (await stand(b.flaeche)).revision;
        expect(await fehler(booleanLandscape(cluster!.app, thomas, a.id, await koerper(rev + 1)))).toMatchObject({
            statusCode: 409,
            code: "edit_conflict",
        });
        await takeEditorLock(cluster!.app, {
            kind: "landscape",
            id: b.id,
            part: "felder",
            personId: randomUUID(),
            personName: "Valentin",
            run: randomUUID(),
        });
        expect(await fehler(booleanLandscape(cluster!.app, thomas, a.id, await koerper(rev)))).toMatchObject({
            statusCode: 409,
            code: "object_locked",
        });
        expect((await stand(a.flaeche)).f).toBeCloseTo(20 * 20, 6);
        expect(await stand(b.flaeche)).toMatchObject({ aktiv: true });
    });
});
