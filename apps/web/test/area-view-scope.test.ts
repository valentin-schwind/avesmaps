import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LANDSCAPE_LAYERS, WATER_CARTOGRAPHY_LAYER, layersOfSelection } from "@avesmaps3d/shared";
import { installAreaSelection, type AreaHint } from "../src/map/area-selection-input.ts";
import { AREA_SELECTION_FILL_LAYER_ID, type AreaSelection } from "../src/map/area-selection.ts";
import { emptyOwner } from "../src/map/interaction/owners.ts";
import { areaLayersInView } from "../src/map/interaction/priorities.ts";
import { landscapeFillLayerId, WATER_FILL_LAYER_ID } from "../src/map/landscape-layers.ts";
import { createHarness, feature, mouse, touch, type Harness } from "./fake-interaction-map.ts";
import { LONG_PRESS_MS } from "../src/map/interaction/long-press.ts";

/**
 * In jeder Landschaftsansicht nimmt nur die Fläche teil, deren Ebene gerade gewählt ist (WI-0083, Betreiber 2026-10-05:
 * „kannst du dafür sorgen, dass immer nur die flächen (derographie, vegetation, topographie) angeklickt werden können, deren
 * ansicht gerade aktiv is. seen und meere sollen in allen ansichten sichtbar sein, aber nur in topographie (und alle)
 * anklickbar.“).
 *
 * 🔴 Geprüft wird der Besitzer `area` gegen die Tafel (`areaLayersInView`), nicht gegen eine Bedingung in ihm: Er bekommt die
 * teilnehmenden Ebenen gereicht und fragt nie selbst nach der Ansicht.
 *
 * 🔴 **Der FLUSS steht seit WI-0090 nicht mehr hier**, sondern beim Besitzer `path`: Ein Fluss ist ein Weg. Dass er dieselbe
 * Tafel und dieselbe Regel bekommt (wählbar nur in Topographie und „Alle“, Nachtrag zu WI-0083, Betreiber „ja“), prüft
 * `path-selection.test.ts`.
 *
 * 🪤 Dass eine nicht gewählte Ebene heute gar nicht im Stil steht, ist nicht dasselbe wie „nimmt nicht teil“: Stünde sie je mit
 * Deckkraft 0 im Stil, gäbe `queryRenderedFeatures` sie zurück, und sie wäre unsichtbar und trotzdem anklickbar. Dieser Test
 * hält die Regel am Besitzer fest, unabhängig vom Stil.
 */

const ALL_LAYERS = [
    ...LANDSCAPE_LAYERS.filter((layer) => layer !== "klima").map((layer) => landscapeFillLayerId(layer)),
    WATER_FILL_LAYER_ID,
    AREA_SELECTION_FILL_LAYER_ID,
];

/** Eine Landschaftsfläche in der Füllung ihrer Ebene, wie die Kachel sie trägt (mit `region_layer`). */
const area = (layer: string, id: string, type: string, size = 10) =>
    feature(landscapeFillLayerId(layer), {
        region_public_id: id,
        region_layer: layer,
        region_type: type,
        name: id,
        area: size,
    });

/** See und Meer aus der geglätteten Quelle: sie tragen nur die Art, die Ebene sagt die Kartografie-Tafel. */
const water = (id: string, type: "see" | "meer", size = 20) =>
    feature(WATER_FILL_LAYER_ID, { region_public_id: id, region_type: type, name: id, area: size });

let harness: Harness;
let selection: AreaSelection | undefined;
let hints: (AreaHint | undefined)[];
let cleared: number;
let layers: readonly string[] | undefined;

beforeEach(() => {
    vi.useFakeTimers();
    selection = undefined;
    hints = [];
    cleared = 0;
    layers = undefined;
    harness = createHarness();
    for (const id of ALL_LAYERS) harness.map.layers.add(id);
    installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
        current: () => selection,
        select: (chosen) => {
            selection = chosen;
        },
        hint: (hint) => hints.push(hint),
        choices: () => undefined,
        areaLayers: () => layers,
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

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
});

const click = (...hits: ReturnType<typeof feature>[]): void => {
    harness.map.hits = hits;
    harness.map.fire("click", mouse(10, 20));
};

const hover = (...hits: ReturnType<typeof feature>[]): void => {
    harness.map.hits = hits;
    harness.map.fire("mousemove", mouse(10, 20));
    harness.flushFrames();
};

describe("die Tafel sagt, welche Flächen teilnehmen", () => {
    it("🔴 sie ist aus der gezeichneten Auswahl abgeleitet, nicht von Hand gepflegt", () => {
        for (const selectionName of ["alle", "topographie", "vegetation", "derographisch", "klima"] as const) {
            expect(areaLayersInView("landscapes", selectionName), selectionName).toEqual(
                layersOfSelection(selectionName),
            );
        }
        // See und Meer sind Landschaftsarten der Topographie: daran hängt, wo sie teilnehmen.
        expect(areaLayersInView("landscapes", "vegetation")).not.toContain("topographie");
        expect(areaLayersInView("landscapes", "alle")).toContain("topographie");
        expect(areaLayersInView("landscapes", "topographie")).toEqual(["topographie"]);
    });

    it("außerhalb der Landschaften nimmt alles teil, was gezeichnet ist", () => {
        for (const view of ["standard", "political", "powerlines", "none"] as const) {
            expect(areaLayersInView(view, "vegetation"), view).toBeUndefined();
        }
    });
});

describe("Vegetation: nur Vegetationsflächen", () => {
    beforeEach(() => {
        layers = layersOfSelection("vegetation");
    });

    it("🔴 ein Klick auf den See wählt die Vegetationsfläche darunter", () => {
        click(water("see-1", "see"), area("vegetation", "wald-1", "wald"));
        expect(selection?.id).toBe("wald-1");
    });

    it("🔴 der See allein: der Klick fällt durch in die freie Karte, und es gibt kein Schild und keine Hand", () => {
        hover(water("see-1", "see"));
        expect(hints.at(-1)).toBeUndefined();
        expect(harness.map.canvas.style.cursor).toBe("");
        click(water("see-1", "see"));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });

    it("🔴 das Meer allein: dasselbe, obwohl es gezeichnet ist", () => {
        click(water("meer-1", "meer"));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });

    it("🔴 eine topographische Fläche, die im Stil stünde, nimmt trotzdem nicht teil", () => {
        click(area("topographie", "gebirge-1", "gebirge", 5), area("vegetation", "wald-1", "wald", 9));
        expect(selection?.id).toBe("wald-1");
    });

    it("das Zeigen nennt die Vegetationsfläche, nicht den See darüber", () => {
        hover(water("see-1", "see", 1), area("vegetation", "wald-1", "wald", 9));
        expect(hints.at(-1)?.candidate.id).toBe("wald-1");
        // Keine weitere Fläche an der Stelle: der See zählt nicht mit.
        expect(hints.at(-1)?.others).toBe(0);
        expect(harness.map.canvas.style.cursor).toBe("pointer");
    });

    it("der lange Druck am Finger folgt derselben Regel", () => {
        harness.map.hits = [water("see-1", "see")];
        harness.map.fire("touchstart", touch(10, 20));
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
        expect(selection).toBeUndefined();
    });
});

describe("Topographie und „Alle“: See und Meer bleiben wählbar", () => {
    for (const [what, hit] of [
        ["See", water("see-1", "see")],
        ["Meer", water("meer-1", "meer")],
    ] as const) {
        it(`🔴 Topographie: ${what}`, () => {
            layers = layersOfSelection("topographie");
            hover(hit);
            expect(harness.map.canvas.style.cursor).toBe("pointer");
            click(hit);
            expect(selection?.type).toBe(hit.properties["region_type"]);
        });

        it(`🔴 Alle: ${what}`, () => {
            layers = layersOfSelection("alle");
            click(hit);
            expect(selection?.type).toBe(hit.properties["region_type"]);
        });
    }

    it("Topographie: eine Vegetationsfläche nimmt nicht teil", () => {
        layers = layersOfSelection("topographie");
        click(area("vegetation", "wald-1", "wald", 1), area("topographie", "gebirge-1", "gebirge", 9));
        expect(selection?.id).toBe("gebirge-1");
    });

    it("Alle: jede Ebene nimmt teil, die kleinste zuerst", () => {
        layers = layersOfSelection("alle");
        click(
            area("derographisch", "region-1", "region", 90),
            area("vegetation", "wald-1", "wald", 9),
            area("topographie", "gebirge-1", "gebirge", 50),
        );
        expect(selection?.id).toBe("wald-1");
    });
});

describe("Derographisch: nur derographische Flächen", () => {
    beforeEach(() => {
        layers = layersOfSelection("derographisch");
    });

    it("🔴 der See fällt durch auf die derographische Fläche darunter", () => {
        click(water("see-1", "see", 1), area("derographisch", "region-1", "region", 9));
        expect(selection?.id).toBe("region-1");
    });

    it("🔴 See und Meer allein: nichts gewählt", () => {
        click(water("see-1", "see"));
        click(water("meer-1", "meer"));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(2);
    });
});

describe("ohne Tafel (Standard, Politisch) bleibt es, wie es war", () => {
    it("jede Fläche und jedes Wasser nimmt teil", () => {
        layers = undefined;
        click(water("see-1", "see"));
        expect(selection?.id).toBe("see-1");
        click(area("topographie", "gebirge-1", "gebirge"));
        expect(selection?.id).toBe("gebirge-1");
    });
});

/**
 * 🔴 Die Ebene des Wassers ist ABGELEITET, nicht gepflegt - daran hängt, wo See, Meer und (beim Besitzer `path`) der Fluss
 * teilnehmen. Die Tafel gehört beiden Besitzern; das Verhalten des Flusses prüft `path-selection.test.ts`.
 */
describe("die Ebene des Wassers", () => {
    it("🪤 sie steht nicht in einer Liste, sie kommt aus der gezeichneten Auswahl", () => {
        expect(areaLayersInView("landscapes", "topographie")).toContain(WATER_CARTOGRAPHY_LAYER);
        expect(areaLayersInView("landscapes", "alle")).toContain(WATER_CARTOGRAPHY_LAYER);
        for (const selectionName of ["vegetation", "derographisch", "klima"] as const) {
            expect(areaLayersInView("landscapes", selectionName), selectionName).not.toContain(WATER_CARTOGRAPHY_LAYER);
        }
    });
});
