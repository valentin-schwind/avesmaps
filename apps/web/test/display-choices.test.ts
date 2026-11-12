import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { LANDSCAPE_SELECTIONS, MAP_VIEWS, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import { chooseDisplay, useDisplayChoices } from "../src/map/display-choices.ts";
import { displayDeviation, displayParams, readAddressDisplay } from "../src/map/display-state.ts";
import { displayDefaults, type MapDisplay } from "../src/map/map-display.ts";

/**
 * Die Vorgabe je Ansicht und die Wahl des Menschen (Betreiber 2026-10-05, Klimazonen: „standardeinstellung, wenn man
 * auf klimazonen klickt (sofern nicht anders vom nutzer eingestellt): nur metropolen, wege an, ebenen an, labels an,
 * grenzen aus, flüsse und seen an, strömungsrichtung aus (editoren an), kachelraster aus“).
 */

const KLIMA: MapDisplay = {
    placeLevel: 1,
    paths: true,
    layers: true,
    labels: true,
    borders: false,
    rivers: true,
    flow: false,
};

/** Die Schalter samt Fächer, wie `app.vue` sie aufsetzt. */
function setup(options: { view?: MapView; layer?: LandscapeSelection; editor?: boolean; hash?: string } = {}) {
    const view = ref<MapView>(options.view ?? "standard");
    const layer = ref<LandscapeSelection>(options.layer ?? "alle");
    const state = useDisplayChoices({
        view,
        layer,
        editor: options.editor ?? false,
        linked: readAddressDisplay("", options.hash ?? ""),
    });
    /** Der Fächer wählt eine Ebene: erst die Ansicht, dann die Ebene (`map-fan.vue`, `waehleEbene`). */
    const fan = (selection: LandscapeSelection): void => {
        view.value = "landscapes";
        layer.value = selection;
    };
    /** Ein Schalter im Menü. */
    const flip = (change: Partial<MapDisplay>): void => state.choose({ ...state.display.value, ...change });
    return { view, layer, state, fan, flip };
}

describe("die Vorgabe der Klimazonen", () => {
    it("🔴 frisch: nur Metropolen, Wege, Ebenen, Labels, Flüsse und Seen an, Grenzen und Strömung aus", () => {
        expect(displayDefaults("landscapes", "klima")).toEqual(KLIMA);
        const { state, fan } = setup();
        fan("klima");
        expect(state.display.value).toEqual(KLIMA);
        expect(state.tileGrid.value, "Kachelraster aus").toBe(false);
    });

    it("🔴 ein Editor bekommt die Strömungsrichtungen an, sonst dasselbe", () => {
        expect(displayDefaults("landscapes", "klima", true)).toEqual({ ...KLIMA, flow: true });
        const { state, fan } = setup({ editor: true });
        fan("klima");
        expect(state.display.value).toEqual({ ...KLIMA, flow: true });
        expect(state.tileGrid.value).toBe(false);
    });

    it("die anderen Ebenen und Ansichten behalten ihre Vorgabe, auch mit gemerkter Ebene „Klima“", () => {
        for (const selection of LANDSCAPE_SELECTIONS.filter((entry) => entry !== "klima")) {
            expect(displayDefaults("landscapes", selection, true), selection).toEqual(displayDefaults("landscapes"));
        }
        for (const view of MAP_VIEWS.filter((entry) => entry !== "landscapes" && entry !== "standard")) {
            expect(displayDefaults(view, "klima", true), view).toEqual(displayDefaults(view));
        }
    });
});

describe("Flusslinien in der Standardansicht (OPS-000117)", () => {
    it("🔴 ein Editor bekommt sie ab Werk an, sonst dieselbe Vorgabe", () => {
        expect(displayDefaults("standard", undefined, true)).toEqual({ ...displayDefaults("standard"), rivers: true });
    });

    it("🔴 ein Besucher bleibt ohne (Betreiber 2026-09-23)", () => {
        expect(displayDefaults("standard").rivers).toBe(false);
    });

    it("die politische Ansicht bleibt auch für Editoren ohne", () => {
        expect(displayDefaults("political", undefined, true)).toEqual(displayDefaults("political"));
    });
});

describe("betreten und verlassen", () => {
    it("🔴 wer die Klimazonen verlässt, hat wieder den Stand vor dem Betreten", () => {
        const { state, fan } = setup({ view: "landscapes" });
        expect(state.display.value).toEqual(displayDefaults("landscapes"));
        fan("klima");
        expect(state.display.value.placeLevel).toBe(1);
        fan("vegetation");
        expect(state.display.value).toEqual(displayDefaults("landscapes"));
    });

    it("🔴 vom Nutzer Geändertes bleibt beim Betreten: Wege aus bleibt aus, die übrigen Schalter folgen der Vorgabe", () => {
        const { state, fan, flip } = setup({ view: "landscapes" });
        flip({ paths: false });
        fan("klima");
        expect(state.display.value).toEqual({ ...KLIMA, paths: false });
        fan("alle");
        expect(state.display.value).toEqual({ ...displayDefaults("landscapes"), paths: false });
    });

    it("🔴 in den Klimazonen Geändertes bleibt beim Verlassen", () => {
        const { state, fan, flip } = setup({ view: "landscapes", layer: "klima" });
        flip({ placeLevel: 3, labels: false });
        fan("topographie");
        expect(state.display.value).toEqual({ ...displayDefaults("landscapes"), placeLevel: 3, labels: false });
        fan("klima");
        expect(state.display.value).toEqual({ ...KLIMA, placeLevel: 3, labels: false });
    });

    it("eine Wahl, die der Vorgabe der Klimazonen gleicht, ist trotzdem eine Wahl: Metropolen bleiben nach dem Verlassen", () => {
        const { state, fan, flip } = setup({ view: "landscapes" });
        flip({ placeLevel: 1 });
        fan("klima");
        fan("alle");
        expect(state.display.value.placeLevel).toBe(1);
    });

    it("🔴 über eine andere Ansicht hinweg: Die Ansicht gewinnt, die Wahl in den Landschaften gilt für den Besuch", () => {
        const { view, state, fan, flip } = setup({ view: "landscapes", layer: "klima" });
        flip({ borders: true });
        view.value = "standard";
        expect(state.display.value).toEqual(displayDefaults("standard"));
        // Zurück in die Landschaften, die Ebene ist noch „Klima“: ihre Vorgabe und die gemerkte Wahl.
        view.value = "landscapes";
        expect(state.display.value).toEqual({ ...KLIMA, borders: true });
        fan("alle");
        expect(state.display.value).toEqual({ ...displayDefaults("landscapes"), borders: true });
    });

    it("was in einer anderen Ansicht umgelegt wurde, nimmt die Klimaansicht nicht mit (Die Ansicht gewinnt)", () => {
        const { state, fan, flip } = setup();
        flip({ labels: false });
        fan("klima");
        expect(state.display.value).toEqual(KLIMA);
    });

    it("🔴 ein Editor verlässt die Klimazonen ohne Strömung; hat er sie dort abgeschaltet, bleibt sie aus", () => {
        const { state, fan, flip } = setup({ view: "landscapes", editor: true });
        fan("klima");
        expect(state.display.value.flow).toBe(true);
        fan("alle");
        expect(state.display.value.flow).toBe(false);
        fan("klima");
        flip({ flow: false });
        fan("alle");
        fan("klima");
        expect(state.display.value.flow).toBe(false);
    });

    it("das Kachelraster hängt an keiner Ansicht: aus, bis ein Editor es einschaltet, dann bleibt es", () => {
        const { state, fan } = setup({ editor: true });
        state.tileGrid.value = true;
        fan("klima");
        expect(state.tileGrid.value).toBe(true);
    });

    it("der Weg über die Auswahl (Suche, Objektlink): Ansicht und Ebene nacheinander, dasselbe Ergebnis", () => {
        const { view, layer, state } = setup({ view: "political" });
        view.value = "landscapes";
        expect(state.display.value).toEqual(displayDefaults("landscapes"));
        layer.value = "klima";
        expect(state.display.value).toEqual(KLIMA);
    });
});

describe("Links", () => {
    it("🔴 view=landscapes&layer=klima ohne Schalter öffnet die Vorgabe der Klimazonen", () => {
        expect(setup({ view: "landscapes", layer: "klima" }).state.display.value).toEqual(KLIMA);
        expect(setup({ view: "landscapes", layer: "klima", editor: true }).state.display.value.flow).toBe(true);
    });

    it("🔴 Schalter im Link gewinnen über die Vorgabe und gelten als Wahl", () => {
        const { state, fan } = setup({ view: "landscapes", layer: "klima", hash: "#toggleStaedte=1&togglePaths=0" });
        expect(state.display.value).toEqual({ ...KLIMA, placeLevel: 3, paths: false });
        fan("alle");
        expect(state.display.value).toEqual({ ...displayDefaults("landscapes"), placeLevel: 3, paths: false });
    });

    it("die Adresse trägt die Abweichung von der Vorgabe der Klimazonen, nicht von der der Landschaften", () => {
        const { state, flip } = setup({ view: "landscapes", layer: "klima" });
        expect(state.deviation()).toEqual({});
        flip({ placeLevel: 2 });
        expect(displayParams(state.deviation())).toEqual([["toggleGrossstaedte", "1"]]);
        // Ein Editor mit Strömung an weicht nicht ab, mit Strömung aus schon.
        const editor = setup({ view: "landscapes", layer: "klima", editor: true });
        expect(editor.state.deviation()).toEqual({});
        editor.flip({ flow: false });
        expect(editor.state.deviation()).toEqual({ flow: false });
    });

    it("hin und zurück: was die Adresse der Klimazonen trägt, öffnet dieselben Schalter", () => {
        const display: MapDisplay = { ...KLIMA, placeLevel: 0, rivers: false, layers: false };
        const context = { view: "landscapes", layer: "klima", editor: false } as const;
        const hash = `#${new URLSearchParams(displayParams(displayDeviation(context, display, false))).toString()}`;
        expect(setup({ view: "landscapes", layer: "klima", hash }).state.display.value).toEqual(display);
    });

    it("🔴 ein Besucher bekommt die Strömung auch aus einem Link nicht", () => {
        expect(setup({ view: "landscapes", layer: "klima", hash: "#flow=1" }).state.display.value.flow).toBe(false);
    });

    it("ein Kurzlink setzt die Wahl neu: seine Schalter, sonst die Vorgabe", () => {
        const { state, flip } = setup({ view: "landscapes", layer: "klima", editor: true });
        flip({ labels: false });
        state.adopt({ paths: false, tileGrid: true });
        expect(state.display.value).toEqual({ ...KLIMA, flow: true, paths: false });
        expect(state.tileGrid.value).toBe(true);
    });
});

describe("chooseDisplay", () => {
    it("nimmt nur die Schalter, die sich ändern, zu der bisherigen Wahl", () => {
        const before = displayDefaults("landscapes");
        expect(chooseDisplay({ labels: false }, before, { ...before, paths: false })).toEqual({
            labels: false,
            paths: false,
        });
        expect(chooseDisplay({}, before, before)).toEqual({});
    });
});
