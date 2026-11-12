import { describe, expect, it, vi } from "vitest";
import type { EditorPowerlineTargets, NodixMoveBody, OperationReceipt, PowerlineNetwork } from "@avesmaps3d/shared";
import type { Punkt, Teil } from "../src/map/geometrie/geometrie";
import { gegenueberAmKnoten } from "../src/map/powerline-arcs";
import { createKraftlinienpunktVerschieben } from "../src/kraftlinieneditor/kraftlinienpunkt-verschieben";

/**
 * „Kraftlinienpunkt verschieben“ (WI-0205 K5; Punkt-Art des Geometrie-Moduls). Problemfälle: der Modus beginnt ohne Revision; die Linien
 * am Punkt fehlen in der Vorschau oder ziehen nicht mit (ihr Ende liegt nicht genau auf dem Punkt); Loslassen schreibt mehr als EINE
 * Operation oder gegen eine alte Revision; Esc nach dem Senden tut so, als wäre nichts geschehen.
 */

const PUNKT = "0d0d0d0d-0000-4000-8000-000000000001";
const ORT = "0d0d0d0d-0000-4000-8000-000000000002";
const NODICES: EditorPowerlineTargets = {
    targets: [
        { id: ORT, kind: "place", name: "Gareth", x: 100, y: 100 },
        { id: PUNKT, kind: "nodix", x: 200, y: 150, revision: 4 },
    ],
};

function aufbau() {
    let losgelassen: ((punkt: Punkt) => void) | undefined;
    const ein = vi.fn((teile: readonly Teil[], nachbarn: readonly Teil[], los: (punkt: Punkt) => void) => {
        void teile;
        void nachbarn;
        losgelassen = los;
        return { abbrechen: vi.fn(() => false), aus: vi.fn() };
    });
    const verschiebePunkt = vi.fn<
        (id: string, body: NodixMoveBody) => Promise<{ readonly ok: true; readonly quittung: OperationReceipt }>
    >(async () => ({ ok: true, quittung: { mapRevision: 77 } as OperationReceipt }));
    const geaendert = vi.fn();
    const melde = vi.fn();
    const zug = createKraftlinienpunktVerschieben({
        daten: { nodices: vi.fn(async () => NODICES), verschiebePunkt },
        karte: { ein, gegenueber: () => [{ x: 100, y: 100 }], geaendert },
        melde,
        neueKennung: () => "0d0d0d0d-0000-4000-8000-0000000000ff",
    });
    return { zug, ein, verschiebePunkt, geaendert, melde, loslassen: (p: Punkt) => losgelassen!(p) };
}

describe("Kraftlinienpunkt verschieben", () => {
    it("🔴 der Punkt ist EIN Teil mit Revision; jede Linie an ihm ist ein Nachbar, dessen Ende genau auf ihm liegt", async () => {
        const w = aufbau();
        expect(await w.zug.starte(PUNKT)).toBe(true);
        const [teile, nachbarn] = w.ein.mock.calls[0]!;
        expect(teile).toEqual([
            { objekt: PUNKT, name: "Kraftlinienpunkt", nr: 0, art: "punkt", punkte: [{ x: 200, y: 150 }], revision: 4 },
        ]);
        expect(nachbarn.map((n) => n.punkte)).toEqual([
            [
                { x: 100, y: 100 },
                { x: 200, y: 150 },
            ],
        ]);
        expect(w.zug.laufend.value).toBe(PUNKT);
    });

    it("🔴 Loslassen schreibt EINE Operation gegen die gelesene Revision, danach Karte neu und Ende des Modus", async () => {
        const w = aufbau();
        await w.zug.starte(PUNKT);
        w.loslassen({ x: 210, y: 160 });
        await vi.waitFor(() => expect(w.geaendert).toHaveBeenCalledWith(77));
        expect(w.verschiebePunkt).toHaveBeenCalledExactlyOnceWith(PUNKT, {
            operationId: "0d0d0d0d-0000-4000-8000-0000000000ff",
            baseRevision: 4,
            x: 210,
            y: 160,
        });
        expect(w.melde).toHaveBeenCalledWith("✓ Kraftlinienpunkt verschoben.", "success");
        expect(w.zug.laufend.value).toBeUndefined();
    });

    it("Esc vor dem Loslassen beendet den Modus ohne Senden; ein Ort ist kein Kraftlinienpunkt", async () => {
        const w = aufbau();
        await w.zug.starte(PUNKT);
        expect(w.zug.abbrechen()).toBe(true);
        expect(w.zug.laufend.value).toBeUndefined();
        expect(w.verschiebePunkt).not.toHaveBeenCalled();
        expect(w.zug.abbrechen()).toBe(false);
        expect(await w.zug.starte(ORT)).toBe(false);
        expect(w.melde).toHaveBeenLastCalledWith("Diesen Kraftlinienpunkt gibt es nicht mehr.", "warning");
    });
});

describe("Enden gegenüber einem Knoten (gegenueberAmKnoten)", () => {
    it("🔴 je Abschnitt am Knoten der andere Endpunkt seiner gezeichneten Bahn, gleich in welcher Richtung er läuft", () => {
        const ende = (id: string) => ({ id, kind: "nodix" as const });
        const netz: PowerlineNetwork = {
            lines: [
                {
                    id: "l1",
                    name: "A",
                    labelVisible: false,
                    curve: null,
                    from: ende(PUNKT),
                    to: ende("x"),
                    path: [
                        [200, 150],
                        [250, 150],
                        [300, 160],
                    ],
                },
                {
                    id: "l2",
                    name: "A",
                    labelVisible: false,
                    curve: null,
                    from: ende("y"),
                    to: ende(PUNKT),
                    path: [
                        [100, 100],
                        [200, 150],
                    ],
                },
                {
                    id: "l3",
                    name: "B",
                    labelVisible: false,
                    curve: null,
                    from: ende("x"),
                    to: ende("y"),
                    path: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            ],
        };
        expect(gegenueberAmKnoten(netz, PUNKT)).toEqual([
            { x: 300, y: 160 },
            { x: 100, y: 100 },
        ]);
    });
});
