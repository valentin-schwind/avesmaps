import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installAreaSelection } from "../src/map/area-selection-input.ts";
import { AREA_SELECTION_FILL_LAYER_ID, type AreaSelection } from "../src/map/area-selection.ts";
import { emptyOwner } from "../src/map/interaction/owners.ts";
import { LANDSCAPE_FILL_LAYER_IDS } from "../src/map/landscape-layers.ts";
import { createHarness, feature, mouse, type Harness } from "./fake-interaction-map.ts";

/**
 * Der Klickpunkt, an dem das Editor-Menü hängt (WI-0063 P9): Jeder Besitzer, der einen Subject aus der Karte wählt, reicht
 * `context.screen` als zweites Argument von `select` durch. Der Ort ist in `editor-menu.test.ts` am echten Koordinator belegt, hier
 * die Flächenauswahl, die eine Liste öffnen kann und denselben Gegenstand noch einmal wählt.
 */

const LAND = LANDSCAPE_FILL_LAYER_IDS[0] as string;

const region = (id: string, name: string, area: number): ReturnType<typeof feature> =>
    feature(LAND, { region_public_id: id, region_type: "wald", name, area });

describe("die Flächenauswahl reicht den Klickpunkt durch", () => {
    let harness: Harness;
    let selection: AreaSelection | undefined;
    let selects: { id: string; at: { x: number; y: number } | undefined }[];

    beforeEach(() => {
        vi.useFakeTimers();
        harness = createHarness();
        selection = undefined;
        selects = [];
        harness.map.layers.add(LAND);
        harness.map.layers.add(AREA_SELECTION_FILL_LAYER_ID);
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => selection,
            select: (area, at) => {
                selection = area;
                selects.push({ id: area.id, at });
            },
            hint: () => undefined,
            choices: () => undefined,
        });
        harness.coordinator.register(emptyOwner({ clear: () => (selection = undefined) }));
    });

    afterEach(() => {
        harness.coordinator.destroy();
        vi.useRealTimers();
    });

    it("ein Klick auf eine einzelne Fläche: der Klickpunkt in Fensterkoordinaten", () => {
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([{ id: "r1", at: { x: 105, y: 105 } }]);
    });

    it("🔴 wo mehrere übereinander liegen, öffnet der Klick die Liste: Kein Klickpunkt, also kein Menü daneben", () => {
        harness.map.hits = [region("gross", "Weite Wälder", 90), region("klein", "Lichtung", 5)];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([{ id: "klein", at: undefined }]);
    });

    it("🔴 dieselbe Fläche noch einmal: Sie geht wieder durch die Öffnungsnaht (das Menü kommt wieder), und zwar als DIE gewählte - ihr Name bleibt, wo er steht", () => {
        harness.map.hits = [region("r1", "Reichsforst", 10)];
        harness.map.fire("click", mouse(5, 5));
        const first = selection;
        // Ein zweiter Klick an anderer Stelle derselben Fläche: Der Name der Auswahl darf nicht zum neuen Klickpunkt springen.
        harness.map.fire("click", mouse(40, 60));
        expect(selects).toEqual([
            { id: "r1", at: { x: 105, y: 105 } },
            { id: "r1", at: { x: 140, y: 160 } },
        ]);
        expect(selection).toBe(first);
    });
});
