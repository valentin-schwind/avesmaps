import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LANDSCAPE_SELECTIONS,
    layersOfSelection,
    MAP_VIEWS,
    type LandscapeSelection,
    type MapView,
} from "@avesmaps3d/shared";
import { LONG_PRESS_MS } from "../src/map/interaction/long-press.ts";
import { climateOwner, contextOwner, emptyOwner, placeOwner, routeOwner } from "../src/map/interaction/owners.ts";
import {
    areaLayersInView,
    INTERACTION_PRIORITY,
    LAYER_OWNERS,
    ownersInView,
    participationInView,
} from "../src/map/interaction/priorities.ts";
import type { InteractionOwner } from "../src/map/interaction/types.ts";
import { CLIMATE_FILL_LAYER_ID } from "../src/map/landscape-layers.ts";
import { PLACE_MARKER_LAYER_ID } from "../src/map/place-layers.ts";
import type { PointerHint } from "../src/map/pointer-hint.ts";
import { ROUTE_HIT_LAYER_ID } from "../src/map/route-layers.ts";
import { createHarness, feature, mouse, touch, type Harness } from "./fake-interaction-map.ts";

/**
 * In der Klimaansicht ist nur das Klimaband klickbar (Betreiber 2026-10-05, wörtlich: „kannst du bei der klimazonenansicht auch nur
 * klimazonen klickbar machen?“). Die Regel ist eine Tafel neben dem Rang (`LAYER_OWNERS`), der Koordinator liest sie (`scope`);
 * kein Besitzer fragt selbst nach der Ansicht.
 */

const WATER_LAYER = "gewaesser-flaeche";

/** Ein Besitzer wie die Fläche (Rang 40): Er beansprucht Meer und See unter dem Zeiger. */
function areaLike(selected: string[], hints: string[]): InteractionOwner {
    return {
        id: "area",
        priority: INTERACTION_PRIORITY.area,
        kinds: ["click", "hover"],
        layers: () => [WATER_LAYER],
        hit: (context) => {
            const found = context.features([WATER_LAYER])[0];
            return found ? { cursor: "pointer", id: String(found.properties["region_public_id"]) } : undefined;
        },
        apply: (kind, claim) => {
            const id = (claim as { id: string }).id;
            if (kind === "hover") hints.push(id);
            else selected.push(id);
        },
    };
}

let harness: Harness;
let view: MapView;
let layer: LandscapeSelection;
let picked: string[];
let hints: (PointerHint | string | undefined)[];
let cleared: number;

beforeEach(() => {
    vi.useFakeTimers();
    view = "landscapes";
    layer = "klima";
    picked = [];
    hints = [];
    cleared = 0;
    harness = createHarness({ scope: () => ownersInView(view, layer) });
    for (const id of [PLACE_MARKER_LAYER_ID, ROUTE_HIT_LAYER_ID, CLIMATE_FILL_LAYER_ID, WATER_LAYER]) {
        harness.map.layers.add(id);
    }
    const register = harness.coordinator.register;
    register(
        placeOwner({
            select: (place) => picked.push(`place:${place.name}`),
            hover: (hint) => hints.push(hint),
        }),
    );
    register(routeOwner({ stale: () => false, selectStage: (stage) => picked.push(`stage:${String(stage)}`) }));
    register(areaLike(picked, hints as string[]));
    register(
        climateOwner({
            select: (zone) => picked.push(`climate:${zone.band}`),
            hover: (hint) => hints.push(hint),
        }),
    );
    register(contextOwner({ open: () => picked.push("context") }));
    register(emptyOwner({ clear: () => (cleared += 1) }));
});

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
});

const band = feature(CLIMATE_FILL_LAYER_ID, { type_key: "gemaessigt", label: "Gemäßigte Zone" });
const sea = feature(WATER_LAYER, { region_public_id: "meer-1", region_type: "meer" });
const lake = feature(WATER_LAYER, { region_public_id: "see-1", region_type: "see" });
const city = feature(
    PLACE_MARKER_LAYER_ID,
    { public_id: "p1", name: "Gareth", subtype: "metropole" },
    { type: "Point", coordinates: [10, 20] },
);
const routeLine = feature(ROUTE_HIT_LAYER_ID, { stage: 2 });

describe("die Tafel der teilnehmenden Besitzer", () => {
    it("🔴 in den Klimazonen nur Klimaband, Kamera, Messung, Lage zeigen, Ort verschieben, Wegpunktziehen, Kontextmenü und der Klick ins Leere", () => {
        // 🪤 `measure` wählt kein Objekt - es misst zwei Stellen der Karte, und Legacy lässt das in jeder Ansicht zu
        // (WI-0095). Es steht hier, damit die Messung auch in den Klimazonen bedienbar bleibt.
        expect(ownersInView("landscapes", "klima")).toEqual([
            "camera-gesture",
            "measure",
            // „Neue Lage auf der Karte zeigen“ der Besucher (WI-0268 C2) wählt ebenfalls kein Objekt; es setzt eine Stelle, wie `place-set`.
            "lage-zeigen",
            // Setzen und Verschieben (WI-0128 E16, E12; Verschieben seit WI-0177 Stufe 4 im Geometrie-Modul) wählen kein Objekt; sie
            // wurden ausdrücklich gestartet und greifen in jeder Ansicht.
            "place-set",
            "geometry-edit",
            "waypoint-drag",
            "climate",
            "context",
            "empty",
        ]);
    });

    it("jede andere Ansicht und Ebene: alle Besitzer, wie bisher", () => {
        for (const v of MAP_VIEWS) {
            for (const l of LANDSCAPE_SELECTIONS) {
                if (v === "landscapes" && l === "klima") continue;
                expect(ownersInView(v, l), `${v}/${l}`).toBeUndefined();
            }
        }
        // Die Klimazonen gelten nur in den Landschaften: Ein gemerkter `layer=klima` in Standard ändert nichts.
        expect(ownersInView("standard", "klima")).toBeUndefined();
    });

    it("die Tafel nennt nur Besitzer, die es gibt", () => {
        for (const owners of Object.values(LAYER_OWNERS)) {
            for (const id of owners ?? []) expect(Object.keys(INTERACTION_PRIORITY)).toContain(id);
        }
    });

    it("🔴 sie beantwortet beide Fragen an einer Stelle: Besitzer und Flächenebenen (WI-0083)", () => {
        for (const v of MAP_VIEWS) {
            for (const l of LANDSCAPE_SELECTIONS) {
                const teil = participationInView(v, l);
                expect(teil.owners, `${v}/${l}`).toEqual(ownersInView(v, l));
                expect(teil.areaLayers, `${v}/${l}`).toEqual(areaLayersInView(v, l));
                // 🪤 Die Flächenebenen sind abgeleitet, nicht gepflegt: Sie sind die gezeichneten der Auswahl.
                expect(teil.areaLayers, `${v}/${l}`).toEqual(v === "landscapes" ? layersOfSelection(l) : undefined);
            }
        }
    });
});

describe("in den Klimazonen fällt jeder Klick auf das Band durch", () => {
    for (const [what, hit] of [
        ["Meer", sea],
        ["See", lake],
        ["Metropole", city],
        ["Route", routeLine],
    ] as const) {
        it(`🔴 ${what} über dem Band: Das Band ist gewählt`, () => {
            harness.map.hits = [hit, band];
            harness.map.fire("click", mouse(10, 20));
            expect(picked).toEqual(["climate:gemaessigt"]);
        });
    }

    it("🔴 das Zeigen: nur das Schild des Bandes, keins für Ort oder See", () => {
        harness.map.hits = [city, lake, band];
        harness.map.fire("mousemove", mouse(10, 20));
        harness.flushFrames();
        expect(hints).toHaveLength(1);
        expect(JSON.stringify(hints[0])).toContain("Gemäßigte Zone");
    });

    it("🔴 die Abfrage fragt nur nach den Layern der Teilnehmer", () => {
        harness.map.hits = [city, lake, band];
        harness.map.fire("click", mouse(10, 20));
        const layers = harness.map.queries.at(-1)?.layers ?? [];
        expect(layers).toContain(CLIMATE_FILL_LAYER_ID);
        expect(layers).not.toContain(PLACE_MARKER_LAYER_ID);
        expect(layers).not.toContain(WATER_LAYER);
    });

    it("🔴 Kontextmenü und Klick ins Leere bleiben - und der lange Druck öffnet das Menü, auch ÜBER einem Band", () => {
        harness.map.hits = [band];
        harness.map.fire("contextmenu", mouse(10, 20));
        expect(picked).toEqual(["context"]);
        harness.map.hits = [];
        harness.map.fire("click", mouse(10, 20));
        expect(cleared).toBe(1);
        // 🔴 Mit dem Band liegt die ganze Karte voll (WI-0108): Hätte es den langen Druck, wäre das Menü hier
        // am Finger nirgends zu öffnen.
        harness.map.hits = [band];
        harness.map.fire("touchstart", touch(10, 20));
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
        expect(picked).toEqual(["context", "context"]);
    });
});

describe("in jeder anderen Ansicht bleibt es, wie es war", () => {
    it("Alle: Meer, See und Ort werden gewählt, das Band nimmt dort niemand", () => {
        layer = "alle";
        harness.map.hits = [lake, band];
        harness.map.fire("click", mouse(10, 20));
        harness.map.hits = [city, band];
        harness.map.fire("click", mouse(10, 20));
        expect(picked).toEqual(["see-1", "place:Gareth"]);
    });

    it("ein Wechsel der Ansicht gilt beim nächsten Klick", () => {
        harness.map.hits = [city, band];
        harness.map.fire("click", mouse(10, 20));
        view = "standard";
        harness.map.fire("click", mouse(10, 20));
        expect(picked).toEqual(["climate:gemaessigt", "place:Gareth"]);
    });
});
