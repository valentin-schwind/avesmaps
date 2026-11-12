import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat, type EditorLandscapeDetail } from "@avesmaps3d/shared";
import { createUnterflaechen, stueckAn } from "../src/landschaftseditor/unterflaechen";
import type { InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types";

/**
 * „Unterflächen ›“: Wahl eines Stücks auf der Karte (Werkzeug 3, Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy
 * `geometry-ops.js#L580-L760`). Problemfälle: Vorgewählt ist nicht das Stück unter dem Rechtsklick; der Klick nimmt ein anderes Stück
 * als das darunter; geschrieben wird gegen eine geratene Revision; eine Fläche aus einem Stück startet einen Modus; ein Fehler des
 * Servers beendet den Modus; Esc schreibt etwas.
 */

const WALD = "b3b3b3b3-0000-4000-8000-000000000001";
const TEIL = "b3b3b3b3-0000-4000-8000-0000000000a1";
const quadrat = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ],
];
const DREI = [quadrat(100, 100, 110, 110), quadrat(120, 100, 130, 110), quadrat(140, 100, 150, 110)];

const detail = (polygons: [number, number][][][]): EditorLandscapeDetail => ({
    id: WALD,
    name: "Wald",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [{ id: TEIL, polygons, affectsPaths: true, revision: 6 }],
    labels: [],
    neighbors: [],
    revision: 2,
});

function aufbau(antworten: { teile?: [number, number][][][]; schreiben?: Response } = {}) {
    let owner: InteractionOwner | undefined;
    const interaction = {
        register: (o: InteractionOwner) => {
            owner = o;
            return () => {
                owner = undefined;
            };
        },
    } as unknown as MapInteractionCoordinator;
    const quellen = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const map = {
        addSource: (id: string) => quellen.set(id, { setData: vi.fn() }),
        getSource: (id: string) => quellen.get(id),
        removeSource: (id: string) => quellen.delete(id),
        addLayer: vi.fn(),
        getLayer: () => ({}),
        removeLayer: vi.fn(),
    } as unknown as MapLibreMap;
    const geschrieben: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== "POST")
            return new Response(JSON.stringify(detail(antworten.teile ?? DREI)), { status: 200 });
        geschrieben.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return (
            antworten.schreiben ??
            new Response(
                JSON.stringify({
                    operationId: "op",
                    status: "applied",
                    environment: "test",
                    affected: [{ kind: "landscape", id: WALD, revision: 3 }],
                    derivedWork: [],
                    warnings: [],
                    partsBefore: 3,
                    partsAfter: 2,
                    name: "Wald",
                }),
                { status: 200 },
            )
        );
    });
    const fertig = vi.fn();
    const melde = vi.fn();
    const modus = createUnterflaechen({
        karte: () => ({ map, interaction }),
        geschrieben: fertig,
        melde,
        fetcher: fetcher as unknown as typeof fetch,
    });
    /** Der Zeiger an dieser Stelle der Karte. */
    const bei = (x: number, y: number) => ({ lngLat: toRenderLngLat(AVENTURIA.coordinateSpace, { x, y }) }) as never;
    const warte = () => new Promise((weiter) => setTimeout(weiter, 0));
    return { modus, owner: () => owner, geschrieben, fertig, melde, bei, warte };
}

describe("„Unterflächen“: Wahl eines Stücks", () => {
    it("das Stück unter einem Punkt; daneben keins", () => {
        expect(stueckAn(DREI, { x: 125, y: 105 })).toBe(1);
        expect(stueckAn(DREI, { x: 115, y: 105 })).toBeUndefined();
    });

    it("🔴 vorgewählt ist das Stück unter dem Rechtsklick; der Klick nimmt das darunter und schreibt EINE Operation gegen die Revision des Details", async () => {
        const t = aufbau();
        await t.modus.starte({ regionId: WALD, areaId: TEIL, operation: "herausloesen", punkt: { x: 145, y: 105 } });
        expect(t.modus.laufend.value).toMatchObject({ gewaehlt: 2, name: "Wald", revision: 6 });
        t.owner()!.apply("hover", {}, t.bei(105, 105));
        expect(t.modus.laufend.value?.gewaehlt).toBe(0);
        expect(t.geschrieben).toHaveLength(0);
        t.owner()!.apply("click", {}, t.bei(125, 105));
        await t.warte();
        expect(t.geschrieben).toHaveLength(1);
        expect(t.geschrieben[0]!.url).toContain(`/landscapes/${WALD}/parts`);
        expect(t.geschrieben[0]!.body).toMatchObject({
            operation: "herausloesen",
            areaId: TEIL,
            baseRevision: 6,
            part: 1,
        });
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.owner()).toBeUndefined();
        expect(t.melde).toHaveBeenCalledWith(expect.stringContaining("eigene Landschaft"), "success");
    });

    it("🔴 aus einem Stück: kein Modus, die Meldung sagt es; „alle vereinigen“ schreibt dann auch nichts", async () => {
        const t = aufbau({ teile: [quadrat(100, 100, 110, 110)] });
        await t.modus.starte({ regionId: WALD, areaId: TEIL, operation: "loeschen" });
        expect(t.modus.laufend.value).toBeUndefined();
        await t.modus.vereinige({ regionId: WALD, areaId: TEIL });
        expect(t.geschrieben).toHaveLength(0);
        expect(t.melde).toHaveBeenCalledTimes(2);
        expect(t.melde.mock.calls[0]![1]).toBe("warning");
    });

    it("„alle vereinigen“ schreibt ohne Wahl und sagt, was blieb", async () => {
        const t = aufbau();
        await t.modus.vereinige({ regionId: WALD, areaId: TEIL });
        expect(t.geschrieben[0]!.body).toMatchObject({ operation: "vereinigen", areaId: TEIL, baseRevision: 6 });
        expect(t.geschrieben[0]!.body).not.toHaveProperty("part");
        expect(t.fertig).toHaveBeenCalledOnce();
        expect(t.melde.mock.calls[0]![0]).toMatch(/3.*2/);
    });

    it("lehnt der Server ab, bleibt der Modus mit seinem Satz; Esc bricht ab, ohne zu schreiben", async () => {
        const t = aufbau({
            schreiben: new Response(JSON.stringify({ message: "Wald bearbeitet gerade Anna." }), { status: 409 }),
        });
        await t.modus.starte({ regionId: WALD, areaId: TEIL, operation: "loeschen", punkt: { x: 105, y: 105 } });
        await t.modus.bestaetige();
        expect(t.melde).toHaveBeenCalledWith("Wald bearbeitet gerade Anna.", "warning");
        expect(t.modus.laufend.value).toMatchObject({ phase: "waehlt", gewaehlt: 0 });
        expect(t.modus.abbrechen()).toBe(true);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.owner()).toBeUndefined();
        expect(t.fertig).not.toHaveBeenCalled();
    });
});
