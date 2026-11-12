import { ref } from "vue";
import { describe, expect, it } from "vitest";
import type { LandscapeSelection, MapView } from "@avesmaps3d/shared";
import { ansichtFuerHinflug, createAnsichtWechsel } from "../src/map/hinflug-ansicht.ts";

/**
 * Die Ansicht eines Hinflugs der Editoren (EDIT-0003 T32 (1), WI-0190). Betreiber 2026-10-16: „Landschaften (Derographie, Vegetation,
 * Topographie) -> Landschaften (… respektive) Wege und Orte -> Standard Herrschaftsgebiete -> Politisch Kraftlinien -> Kraftlinien“.
 */
describe("Objektart → Ansicht", () => {
    it("🔴 Orte und Wege → Standard, ohne die Landschaftsebene anzufassen", () => {
        expect(ansichtFuerHinflug({ art: "ort" })).toEqual({ view: "standard" });
        expect(ansichtFuerHinflug({ art: "weg" })).toEqual({ view: "standard" });
    });

    it("🔴 eine Landschaft → Landschaften mit IHRER Ebene", () => {
        expect(ansichtFuerHinflug({ art: "landschaft", ebene: "derographisch" })).toEqual({
            view: "landscapes",
            landscape: "derographisch",
        });
        expect(ansichtFuerHinflug({ art: "landschaft", ebene: "vegetation" })).toEqual({
            view: "landscapes",
            landscape: "vegetation",
        });
        expect(ansichtFuerHinflug({ art: "landschaft", ebene: "topographie" })).toEqual({
            view: "landscapes",
            landscape: "topographie",
        });
    });

    it("die Landschaften als Ganzes (Kachel im Editorpanel, WI-0212) → Landschaften, die Ebene bleibt, wie sie ist", () => {
        expect(ansichtFuerHinflug({ art: "landschaft" })).toEqual({ view: "landscapes" });
    });

    it("🔴 Herrschaftsgebiete → Politisch, Kraftlinien → Kraftlinien", () => {
        expect(ansichtFuerHinflug({ art: "herrschaftsgebiet" })).toEqual({ view: "political" });
        expect(ansichtFuerHinflug({ art: "kraftlinie" })).toEqual({ view: "powerlines" });
    });
});

describe("Die Ansicht einstellen", () => {
    function aufbau(view: MapView, landscape: LandscapeSelection, gebiete = true) {
        const stand = { view: ref<MapView>(view), landscape: ref<LandscapeSelection>(landscape) };
        const wechsel = createAnsichtWechsel({ ...stand, politischBereit: () => gebiete });
        return { ...stand, wechsel };
    }

    it("🔴 eine Landschaft stellt Ansicht und Ebene ein, auch aus „Alle“", () => {
        const { view, landscape, wechsel } = aufbau("standard", "alle");
        wechsel(ansichtFuerHinflug({ art: "landschaft", ebene: "vegetation" }));
        expect([view.value, landscape.value]).toEqual(["landscapes", "vegetation"]);
    });

    it("die Landschaften ohne Ebene: Ansicht Landschaften mit der gemerkten Ebene", () => {
        const { view, landscape, wechsel } = aufbau("standard", "topographie");
        wechsel(ansichtFuerHinflug({ art: "landschaft" }));
        expect([view.value, landscape.value]).toEqual(["landscapes", "topographie"]);
    });

    it("🔴 aus den Sprachen führt die Derographie ohne Ebene zurück in die letzte Ebene davor, nie in die Sprachen (Betreiber 2026-10-31)", () => {
        const { view, landscape, wechsel } = aufbau("landscapes", "vegetation");
        wechsel(ansichtFuerHinflug({ art: "sprache" }));
        expect([view.value, landscape.value]).toEqual(["landscapes", "sprachen"]);
        wechsel(ansichtFuerHinflug({ art: "landschaft" }));
        expect([view.value, landscape.value]).toEqual(["landscapes", "vegetation"]);
        // Ohne Ebene davor: „Alle“.
        const frisch = aufbau("landscapes", "sprachen");
        frisch.wechsel(ansichtFuerHinflug({ art: "landschaft" }));
        expect(frisch.landscape.value).toBe("alle");
    });

    it("ein Ort stellt Standard ein; die gemerkte Ebene bleibt für die nächste Landschaftsansicht", () => {
        const { view, landscape, wechsel } = aufbau("landscapes", "topographie");
        wechsel(ansichtFuerHinflug({ art: "ort" }));
        expect([view.value, landscape.value]).toEqual(["standard", "topographie"]);
    });

    it("🔴 ohne geladene Gebiete bleibt die Ansicht (Politisch ist dann gesperrt, wie im Fächer)", () => {
        const { view, wechsel } = aufbau("standard", "alle", false);
        wechsel(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
        expect(view.value).toBe("standard");
        const bereit = aufbau("standard", "alle", true);
        bereit.wechsel(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
        expect(bereit.view.value).toBe("political");
    });
});
