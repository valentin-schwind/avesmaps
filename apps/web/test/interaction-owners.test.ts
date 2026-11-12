import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { installAreaSelection, type AreaChoices, type AreaHint } from "../src/map/area-selection-input.ts";
import type { AreaSelection } from "../src/map/area-selection.ts";
import { AREA_SELECTION_FILL_LAYER_ID } from "../src/map/area-selection.ts";
import { contextOwner, emptyOwner, placeOwner, routeOwner, type SelectedPlace } from "../src/map/interaction/owners.ts";
import type { PointerHint } from "../src/map/pointer-hint.ts";
import { LONG_PRESS_MS, LONG_PRESS_TOLERANCE_PX } from "../src/map/interaction/long-press.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import type { InteractionOwner } from "../src/map/interaction/types.ts";
import { LANDSCAPE_FILL_LAYER_IDS } from "../src/map/landscape-layers.ts";
import { PLACE_MARKER_LAYER_ID, STRUCTURE_MARKER_LAYER_ID } from "../src/map/place-layers.ts";
import { NODIX_HIT_LAYER_ID } from "../src/map/powerline-layers.ts";
import { ROUTE_HIT_LAYER_ID, ROUTE_MARKER_LAYER_ID } from "../src/map/route-layers.ts";
import { createHarness, feature, mouse, touch, type Harness } from "./fake-interaction-map.ts";

/**
 * Die Besitzer der Karte am echten Koordinator (M8): Ort, Route, Fläche und der Rückfall in die freie Karte.
 * Die Karte ist ein Testdoppel; geprüft wird der Vorrang und was jeder Besitzer mit dem Treffer tut.
 */

const space = AVENTURIA.coordinateSpace;
const LAND = LANDSCAPE_FILL_LAYER_IDS[0] as string;

let harness: Harness;

beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
    for (const id of [PLACE_MARKER_LAYER_ID, STRUCTURE_MARKER_LAYER_ID, ROUTE_HIT_LAYER_ID, ROUTE_MARKER_LAYER_ID]) {
        harness.map.layers.add(id);
    }
});

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const placeAt = (x: number, y: number): ReturnType<typeof feature> => {
    const { lng, lat } = toRenderLngLat(space, { x, y });
    return feature(
        PLACE_MARKER_LAYER_ID,
        { public_id: "p1", name: "Gareth", subtype: "metropole" },
        { type: "Point", coordinates: [lng, lat] },
    );
};

describe("Ort, Route und der Rückfall in die freie Karte", () => {
    let selected: SelectedPlace[];
    let stages: number[];
    let cleared: number;
    let stale: boolean;
    let told: (string | undefined)[];

    beforeEach(() => {
        selected = [];
        stages = [];
        cleared = 0;
        stale = false;
        told = [];
        const { coordinator } = harness;
        coordinator.register(placeOwner({ select: (place) => selected.push(place) }));
        coordinator.register(routeOwner({ stale: () => stale, selectStage: (stage) => stages.push(stage) }));
        coordinator.register(
            emptyOwner({
                clear: () => {
                    cleared += 1;
                },
            }),
        );
        coordinator.observe("click", ({ claimedBy }) => told.push(claimedBy));
    });

    it("ein Klick auf einen Ort wählt ihn, mit seiner Lage in Kartenkoordinaten", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("click", mouse(5, 5));
        expect(selected).toHaveLength(1);
        expect(selected[0]).toMatchObject({ id: "p1", name: "Gareth", subtype: "metropole" });
        expect(selected[0]?.x).toBeCloseTo(551.625, 6);
        expect(selected[0]?.y).toBeCloseTo(532.969, 6);
        expect(cleared).toBe(0);
        expect(told).toEqual(["place"]);
    });

    /**
     * Betreiber 2026-10-11: „im kraftlinien editor nicht auf die nodices klicken kann“. In der Kraftlinien-Ansicht steht ein Nodix
     * als Knoten da, nicht als Ortsmarke; seine Trefferfläche wählt den Ort wie ein Klick auf die Marke.
     */
    it("🔴 ein Klick auf den Knoten eines Nodix-Orts wählt den Ort; ein Kraftlinienpunkt oder Label ist kein Ort", () => {
        harness.map.layers.add(NODIX_HIT_LAYER_ID);
        const { lng, lat } = toRenderLngLat(space, { x: 551.625, y: 532.969 });
        const knoten = (node_kind: string) =>
            feature(
                NODIX_HIT_LAYER_ID,
                { public_id: `k-${node_kind}`, name: "Gareth", subtype: "metropole", node_kind },
                { type: "Point", coordinates: [lng, lat] },
            );
        harness.map.hits = [knoten("place")];
        harness.map.fire("click", mouse(5, 5));
        expect(selected).toEqual([expect.objectContaining({ id: "k-place", name: "Gareth", subtype: "metropole" })]);
        expect(told).toEqual(["place"]);
        for (const art of ["nodix", "label"]) {
            harness.map.hits = [knoten(art)];
            harness.map.fire("click", mouse(5, 5));
        }
        expect(selected, "kein Ort gewählt").toHaveLength(1);
        expect(told.slice(1), "der Klick fällt durch").toEqual(["empty", "empty"]);
    });

    it("🔴 Ort vor Route: liegt die Route unter dem Ort, gehört ihm der Klick", () => {
        harness.map.hits = [feature(ROUTE_HIT_LAYER_ID, { stage: 2 }), placeAt(551.625, 532.969)];
        harness.map.fire("click", mouse(5, 5));
        expect(selected).toHaveLength(1);
        expect(stages).toEqual([]);
    });

    it("ein Klick auf die Route wählt ihre Etappe, und die Auswahl bleibt unberührt", () => {
        harness.map.hits = [feature(ROUTE_HIT_LAYER_ID, { stage: 3 })];
        harness.map.fire("click", mouse(5, 5));
        expect(stages).toEqual([3]);
        expect(selected).toEqual([]);
        expect(cleared).toBe(0);
        expect(told).toEqual(["route"]);
    });

    it("eine Wegpunktmarke beansprucht den Klick, wählt aber nichts: Die Fläche darunter schweigt", () => {
        harness.map.hits = [feature(ROUTE_MARKER_LAYER_ID, { key: 1 })];
        harness.map.fire("click", mouse(5, 5));
        expect(stages).toEqual([]);
        expect(cleared).toBe(0);
        expect(told).toEqual(["route"]);
    });

    it("ein Klick, den niemand beansprucht, ist ein Klick in die freie Karte: die Auswahl endet", () => {
        harness.map.fire("click", mouse(5, 5));
        expect(cleared).toBe(1);
        expect(told).toEqual(["empty"]);
    });

    it("Zeigen: über einem Ort und über der Linie die Hand, über einer veralteten Route keine", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("pointer");

        harness.map.hits = [feature(ROUTE_HIT_LAYER_ID, { stage: 1 })];
        harness.map.fire("mousemove", mouse(6, 6));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("pointer");

        stale = true;
        harness.map.fire("mousemove", mouse(7, 7));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("");
    });

    it("Zeigen über einer Marke allein setzt keine Hand: die Greifhand gehört dem Ziehen", () => {
        harness.map.hits = [feature(ROUTE_MARKER_LAYER_ID, { key: 1 })];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("");
    });

    it("Zeigen über freier Karte lässt die Form, wie sie ist", () => {
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("");
    });
});

describe("das Kontextmenü", () => {
    let opened: { screen: { x: number; y: number }; lngLat: { lng: number; lat: number } }[];

    beforeEach(() => {
        opened = [];
        harness.coordinator.register(contextOwner({ open: (screen, lngLat) => opened.push({ screen, lngLat }) }));
    });

    it("der Rechtsklick öffnet es an der Stelle des Zeigers, ohne das Menü des Browsers", () => {
        const event = mouse(20, 30);
        harness.map.fire("contextmenu", event);
        expect(opened).toEqual([{ screen: { x: 120, y: 130 }, lngLat: { lng: 2, lat: 3 } }]);
        expect(event["preventDefault"]).toHaveBeenCalledTimes(1);
    });

    it("🔴 der lange Druck öffnet DASSELBE Menü an derselben Stelle - er IST der Rechtsklick (WI-0108)", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        // Zeichen für Zeichen das, was der Rechtsklick eine Zusicherung höher liefert: dieselbe Stelle im Fenster,
        // derselbe Kartenpunkt. Eine zweite Fassung gibt es nicht.
        expect(opened).toEqual([{ screen: { x: 120, y: 130 }, lngLat: { lng: 2, lat: 3 } }]);
    });

    it("🔴 ein kurzer Tipp öffnet es nicht", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS - 50);
        harness.map.fire("touchend", {});
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(opened).toEqual([]);
    });

    it("💣 eine Bewegung über die Toleranz öffnet es nicht - auch nicht an der neuen Stelle", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS / 2);
        harness.map.fire("touchmove", touch(20 + LONG_PRESS_TOLERANCE_PX + 5, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(opened).toEqual([]);
    });

    it("💣 ein zweiter Finger macht daraus Zoomen oder Drehen: kein Menü", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS / 2);
        harness.map.fire("touchmove", touch(20, 30, 2));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(opened).toEqual([]);
    });

    it("🔴 wer den Finger beim Aufsetzen erfasst, etwa das Ziehen einer Marke, öffnet kein Menü", () => {
        const drag: InteractionOwner = {
            id: "waypoint-drag",
            priority: INTERACTION_PRIORITY["waypoint-drag"],
            kinds: ["press"],
            layers: () => [],
            hit: () => ({}),
            apply() {
                harness.coordinator.capture("waypoint-drag", undefined, "grabbing");
            },
        };
        harness.coordinator.register(drag);
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(opened).toEqual([]);
        expect(harness.map.canvas.style.cursor).toBe("grabbing");
    });

    it("die rechte Taste während einer erfassten Geste öffnet es auch nicht", () => {
        harness.coordinator.capture("camera-gesture", 1);
        harness.map.fire("contextmenu", mouse(20, 30));
        expect(opened).toEqual([]);
    });
});

describe("🔴 der lange Druck am Finger IST der Rechtsklick (WI-0108)", () => {
    let selected: SelectedPlace[];
    let stages: number[];
    let menus: { place: string; at: { x: number; y: number }; lngLat: { lng: number; lat: number } }[];
    let general: { screen: { x: number; y: number }; lngLat: { lng: number; lat: number } }[];

    beforeEach(() => {
        selected = [];
        stages = [];
        menus = [];
        general = [];
        const { coordinator } = harness;
        coordinator.register(
            placeOwner({
                select: (place) => selected.push(place),
                menu: (place, at, lngLat) => menus.push({ place: place.id, at, lngLat }),
            }),
        );
        coordinator.register(routeOwner({ stale: () => false, selectStage: (stage) => stages.push(stage) }));
        coordinator.register(contextOwner({ open: (screen, lngLat) => general.push({ screen, lngLat }) }));
    });

    it("🔴 ein Ort unter dem Finger: goldener Kern UND Menü in seiner Ortsform - genau wie der Rechtsklick", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(selected).toHaveLength(1);
        expect(selected[0]).toMatchObject({ id: "p1", name: "Gareth" });
        expect(menus).toEqual([{ place: "p1", at: { x: 105, y: 105 }, lngLat: { lng: 0.5, lat: 0.5 } }]);
        // Das allgemeine Menü geht NICHT auch noch auf: Rang 80 nimmt den Rechtsklick dem Rang 20 weg.
        expect(general).toEqual([]);
    });

    it("🔴 derselbe Druck und derselbe Rechtsklick sind Zeichen für Zeichen dasselbe", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("contextmenu", mouse(5, 5));
        const byMouse = { selected: [...selected], menus: [...menus] };
        selected = [];
        menus = [];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect({ selected, menus }).toEqual(byMouse);
    });

    it("🔴 die Route unter dem Finger wählt KEINE Etappe mehr: das Menü geht auf, wie am Rechtsklick", () => {
        harness.map.hits = [feature(ROUTE_HIT_LAYER_ID, { stage: 2 })];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(stages).toEqual([]);
        expect(general).toHaveLength(1);
    });

    it("🔴 auf der freien Karte geht das allgemeine Menü auf, an der Stelle des Aufsetzens", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(selected).toEqual([]);
        expect(general).toEqual([{ screen: { x: 120, y: 130 }, lngLat: { lng: 2, lat: 3 } }]);
    });

    it("🔴 ein kurzer Tipp auf einen Ort wählt ihn, ohne Menü", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("click", mouse(5, 5));
        expect(selected).toHaveLength(1);
        expect(menus).toEqual([]);
        expect(general).toEqual([]);
    });

    it("🔴 ein kurzer Tipp auf die freie Karte öffnet nichts", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS - 50);
        harness.map.fire("touchend", {});
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(general).toEqual([]);
        expect(selected).toEqual([]);
    });

    it("eine Bewegung innerhalb der Toleranz lässt ihn gelten", () => {
        harness.map.fire("touchstart", touch(20, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS / 2);
        harness.map.fire("touchmove", touch(20 + LONG_PRESS_TOLERANCE_PX - 2, 30));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(general).toHaveLength(1);
    });

    it("🔴 wer den Zeiger erfasst (ein Werkzeug), verhindert alles: kein Menü, keine Auswahl, kein Klick", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.coordinator.capture("waypoint-drag", undefined, "grabbing");
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(selected).toEqual([]);
        expect(menus).toEqual([]);
        expect(general).toEqual([]);
        harness.map.fire("click", mouse(5, 5));
        expect(selected).toEqual([]);
    });
});

describe("das Zeiger-Schild eines Orts beim Zeigen (WI-0063 4.5)", () => {
    let hints: (PointerHint | undefined)[];

    beforeEach(() => {
        hints = [];
        harness.coordinator.register(
            placeOwner({
                select: () => undefined,
                hover: (hint) => hints.push(hint),
            }),
        );
    });

    it("🔴 zeigt „Name · Art“ aus dem Kachel-Subtyp, übersetzt, an der Stelle des Zeigers", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(hints.at(-1)).toEqual({ name: "Gareth", type: "Metropole", screen: { x: 105, y: 105 } });
    });

    it("eine unbekannte Ortsart heißt „Ort“, nie der rohe Schlüssel", () => {
        const place = placeAt(551.625, 532.969);
        place.properties["subtype"] = "erfunden";
        harness.map.hits = [place];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(hints.at(-1)?.type).toBe("Ort");
    });

    it("ein namenloser Ort hat kein Schild, und beim Verlassen der Karte ist es weg", () => {
        const place = placeAt(551.625, 532.969);
        place.properties["name"] = "";
        harness.map.hits = [place];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(hints.filter((hint) => hint !== undefined)).toEqual([]);

        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("mousemove", mouse(6, 6));
        harness.flushFrames();
        expect(hints.at(-1)).toBeDefined();
        harness.map.fire("mouseout", mouse(6, 6));
        expect(hints.at(-1)).toBeUndefined();
    });

    it("auf Touch gibt es kein Zeigen und deshalb kein Schild", () => {
        harness.map.hits = [placeAt(551.625, 532.969)];
        harness.map.fire("touchstart", touch(5, 5));
        harness.flushFrames();
        expect(hints).toEqual([]);
    });
});

describe("die Flächenauswahl als Besitzer", () => {
    let selection: AreaSelection | undefined;
    let hints: (AreaHint | undefined)[];
    let choices: (AreaChoices | undefined)[];
    let cleared: number;
    let lookup: Parameters<typeof installAreaSelection>[2]["lookup"];

    const region = (id: string, name: string, area: number): ReturnType<typeof feature> =>
        feature(LAND, { region_public_id: id, region_type: "wald", name, area });

    beforeEach(() => {
        selection = undefined;
        hints = [];
        choices = [];
        cleared = 0;
        lookup = undefined;
        harness.map.layers.add(LAND);
        harness.map.layers.add(AREA_SELECTION_FILL_LAYER_ID);
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => selection,
            select: (area) => {
                selection = area;
            },
            hint: (hint) => hints.push(hint),
            choices: (next) => choices.push(next),
            lookup: () => lookup?.(),
        });
        harness.coordinator.register(
            emptyOwner({
                clear: () => {
                    cleared += 1;
                    selection = undefined;
                },
            }),
        );
    });

    it("ein Klick auf eine Fläche wählt sie, ohne Liste, wo nur eine liegt", () => {
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        harness.map.fire("click", mouse(5, 5));
        expect(selection).toMatchObject({ kind: "landscape", id: "r1", name: "Reichsforst" });
        expect(choices.at(-1)).toBeUndefined();
        expect(cleared).toBe(0);
    });

    it("liegen mehrere übereinander, wählt der Klick die kleinste und öffnet die Liste", () => {
        harness.map.hits = [region("gross", "Weite Wälder", 90), region("klein", "Lichtung", 5)];
        harness.map.fire("click", mouse(5, 5));
        expect(selection).toMatchObject({ id: "klein" });
        expect(choices.at(-1)?.candidates.map((candidate) => candidate.id)).toEqual(["klein", "gross"]);
        expect(choices.at(-1)?.selected).toBe("klein");
        // Wo Menü und Schild stehen: in Fensterkoordinaten.
        expect(choices.at(-1)?.screen).toEqual({ x: 105, y: 105 });
    });

    it("🔴 ein Klick, unter dem keine Fläche liegt, gehört dem Rückfall und beendet die Auswahl", () => {
        selection = { kind: "landscape", id: "alt", name: "Alt", type: "wald", anchor: { x: 1, y: 1 } };
        harness.map.fire("click", mouse(5, 5));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });

    it("🔴 ein Klick auf die gewählte Fläche selbst, wo sonst nichts liegt, lässt die Auswahl stehen", () => {
        selection = { kind: "landscape", id: "alt", name: "Alt", type: "wald", anchor: { x: 1, y: 1 } };
        harness.map.hits = [feature(AREA_SELECTION_FILL_LAYER_ID, {})];
        harness.map.fire("click", mouse(5, 5));
        expect(selection).toMatchObject({ id: "alt" });
        expect(cleared).toBe(0);
    });

    it("die Vorschau: Schild an der Stelle des Zeigers, die Hand, und beim Verlassen der Karte ist alles weg", () => {
        harness.map.hits = [region("gross", "Weite Wälder", 90), region("klein", "Lichtung", 5)];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        const hint = hints.at(-1);
        expect(hint).toMatchObject({ candidate: { id: "klein" }, others: 1, afterCurrent: false });
        expect(hint?.screen).toEqual({ x: 105, y: 105 });
        expect(harness.map.canvas.style.cursor).toBe("pointer");
        harness.map.fire("mouseout", mouse(5, 5));
        expect(hints.at(-1)).toBeUndefined();
        expect(harness.map.canvas.style.cursor).toBe("");
    });

    it("die Vorschau zeigt nichts, wo nur die gewählte Fläche liegt", () => {
        selection = { kind: "landscape", id: "r1", name: "Reichsforst", type: "wald", anchor: { x: 1, y: 1 } };
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(hints.filter((hint) => hint !== undefined)).toHaveLength(0);
    });

    it("eine Kartenbewegung schließt die Liste und nimmt das Schild weg", () => {
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        harness.map.fire("movestart", {});
        expect(hints.at(-1)).toBeUndefined();
        expect(choices.at(-1)).toBeUndefined();
    });

    it("🔴 das Nachführen der sichtbaren Fläche schließt die Liste nicht: Geht beim ersten Klick das Infopanel auf, bleibt sie stehen", () => {
        harness.map.hits = [region("gross", "Weite Wälder", 90), region("klein", "Lichtung", 5)];
        harness.map.fire("click", mouse(5, 5));
        expect(choices.at(-1)).toBeDefined();
        // `visible-area.ts` markiert seine Bewegung (`LAYOUT_EVENT`): Nur der Innenabstand ändert sich, die Karte bleibt stehen.
        harness.map.fire("movestart", { visibleArea: true });
        expect(choices.at(-1)).toBeDefined();
        // Eine echte Bewegung schließt sie weiter.
        harness.map.fire("movestart", {});
        expect(choices.at(-1)).toBeUndefined();
    });

    it("ruht das Zeigen der Flächen (offene Liste), zeigt sie nichts; der Klick geht weiter", () => {
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        const resume = harness.coordinator.suspendHover("liste", ["area"]);
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(hints).toEqual([]);
        harness.map.fire("click", mouse(5, 5));
        expect(selection).toMatchObject({ id: "r1" });
        resume();
    });

    describe("wo die Karte keine Flächen zeichnet und der Server gefragt wird (WI-0058)", () => {
        let requests: { url: string; signal: AbortSignal | undefined }[];

        beforeEach(() => {
            requests = [];
            lookup = () => ({ layers: ["topographie"], lakes: true, smooth: false });
            vi.stubGlobal(
                "fetch",
                vi.fn((url: string, init?: { signal?: AbortSignal }) => {
                    requests.push({ url, signal: init?.signal });
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                areas: [
                                    {
                                        region_public_id: `s${String(requests.length)}`,
                                        region_type: "wald",
                                        name: "Aus dem Server",
                                        area: 1,
                                    },
                                ],
                            }),
                    });
                }),
            );
        });

        it("beim Zeigen fragt es erst, wenn der Zeiger ruht: beim Überfahren gar nicht", async () => {
            harness.map.fire("mousemove", mouse(11, 11));
            harness.flushFrames();
            await vi.advanceTimersByTimeAsync(60);
            // Der Zeiger bewegt sich weiter, ehe die Ruhezeit um ist: keine Frage.
            harness.map.fire("mousemove", mouse(12, 12));
            harness.flushFrames();
            await vi.advanceTimersByTimeAsync(60);
            expect(requests).toHaveLength(0);
            await vi.advanceTimersByTimeAsync(80);
            expect(requests).toHaveLength(1);
            expect(hints.at(-1)?.candidate.name).toBe("Aus dem Server");
        });

        it("ein Klick fragt sofort und wählt, was der Server nennt", async () => {
            harness.map.fire("click", mouse(21, 21));
            expect(requests).toHaveLength(1);
            await harness.settle();
            expect(selection).toMatchObject({ kind: "landscape", name: "Aus dem Server" });
        });

        it("🔴 ein jüngerer Klick bricht die Frage des älteren ab: nur der jüngste entscheidet", async () => {
            harness.map.fire("click", mouse(31, 31));
            harness.map.fire("click", mouse(32, 32));
            expect(requests.map((request) => request.signal?.aborted)).toEqual([true, false]);
            await harness.settle();
            expect(selection).toMatchObject({ id: "s2" });
        });

        it("scheitert der Server, gilt, was die Kacheln von Flüssen wissen: kein Treffer, der Rückfall greift", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(() => Promise.reject(new Error("Netz"))),
            );
            harness.map.fire("click", mouse(41, 41));
            await harness.settle();
            expect(selection).toBeUndefined();
            expect(cleared).toBe(1);
        });
    });
});
