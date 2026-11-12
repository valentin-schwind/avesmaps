import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LandscapeSelection } from "@avesmaps3d/shared";
import { createAuswahlIsolieren, isoliereStil, nurIsolierte } from "../src/landschaftseditor/auswahl-isolieren.ts";
import {
    CLIMATE_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
} from "../src/map/landscape-layers.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";

/**
 * „Auswahl isolieren“ (WI-0178, Vali 2026-11-09): Geprüft wird die WIRKUNG der Filter mit MapLibres eigenem Auswerter, nicht die
 * Form der Ausdrücke: welche Flächen und Namen noch gezeichnet werden.
 */

const DUNKELWALD = "a1f0c2e4-0000-4000-8000-000000000001";
const NACHBAR = "a1f0c2e4-0000-4000-8000-000000000002";

function stil(selection: LandscapeSelection = "alle"): StyleSpecification {
    return buildPlaceStyle({
        tileUrl: "/v/place/{z}/{x}/{y}",
        landscapeUrl: "/v/landscape/{z}/{x}/{y}",
        landscapeRunUrl: "/v/run/{z}/{x}/{y}",
        mapLabelUrl: "/v/label/{z}/{x}/{y}",
        climateUrl: "/v/climate/{z}/{x}/{y}",
        pathUrl: "/v/path/{z}/{x}/{y}",
        pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
        powerlineUrl: "/v/powerline/{z}/{x}/{y}",
        leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
        basemap: undefined,
        seriesId: "original",
        view: "landscapes",
        landscapeSelection: selection,
    });
}

/** Zeichnet die Ebene dieses Merkmal? Ohne Filter alles. */
function zeigt(layer: LayerSpecification, properties: Record<string, unknown>): boolean {
    const filter = (layer as { filter?: unknown }).filter;
    if (filter === undefined) return true;
    return featureFilter(filter as never, "filter").filter(
        { zoom: 8 },
        { type: 3, properties } as never,
        undefined as never,
    );
}

const quelle = (layer: LayerSpecification): string | undefined =>
    "source" in layer && typeof layer.source === "string" ? layer.source : undefined;

/** Ein Wald der Vegetation, wie ihn die Kacheln der Flächen und der Namen tragen. */
const wald = (id: string): Record<string, unknown> => ({
    region_public_id: id,
    region_layer: "vegetation",
    region_type: "Wald",
    stack_order: 0,
    has_curve_run: false,
    label_min_zoom: 0,
    label_max_zoom: 99,
    own_span: true,
});

describe("Auswahl isolieren: der Stil", () => {
    it("ohne Fläche bleibt der Stil derselbe", () => {
        const vorher = stil();
        expect(isoliereStil(vorher, undefined)).toBe(vorher);
    });

    it("🔴 von den Flächen und ihren Namen steht nur die bearbeitete, die Nachbarn nicht mehr", () => {
        const vorher = stil();
        const nachher = isoliereStil(vorher, DUNKELWALD);
        const betroffen = nachher.layers.filter((layer) => {
            const q = quelle(layer);
            return q === LANDSCAPE_SOURCE_ID || q === LANDSCAPE_RUN_SOURCE_ID || q === MAP_LABEL_SOURCE_ID;
        });
        // Füllung, Kante und Namen der Vegetation sind dabei; sonst prüfte der Test nichts.
        expect(betroffen.map((layer) => layer.id)).toEqual(
            expect.arrayContaining(["landscape-fill-vegetation", "landscape-line-vegetation"]),
        );
        expect(betroffen.some((layer) => quelle(layer) === MAP_LABEL_SOURCE_ID)).toBe(true);
        expect(betroffen.some((layer) => quelle(layer) === LANDSCAPE_RUN_SOURCE_ID)).toBe(true);
        for (const layer of betroffen) {
            const alt = vorher.layers.find((l) => l.id === layer.id)!;
            expect(zeigt(layer, wald(NACHBAR)), layer.id).toBe(false);
            // Die eigene Fläche steht, wo sie vorher stand: Band und Ebenenwahl gelten weiter.
            expect(zeigt(layer, wald(DUNKELWALD)), layer.id).toBe(zeigt(alt, wald(DUNKELWALD)));
        }
    });

    it("🔴 Seen und Meere bleiben samt Namen stehen (Stage-Probe: „Rickensee“ verlor sonst seinen Namen)", () => {
        const vorher = stil();
        const nachher = isoliereStil(vorher, DUNKELWALD);
        const see = { ...wald(NACHBAR), region_layer: "topographie", region_type: "see" };
        const meer = { ...see, region_type: "meer" };
        let gezeigt = 0;
        nachher.layers.forEach((layer, i) => {
            for (const wasser of [see, meer]) {
                const alt = zeigt(vorher.layers[i]!, wasser);
                expect(zeigt(layer, wasser), layer.id).toBe(alt);
                if (alt && quelle(layer) === MAP_LABEL_SOURCE_ID) gezeigt += 1;
            }
        });
        // Der Name eines Sees steht vorher und nachher; sonst prüfte der Fall nichts.
        expect(gezeigt).toBeGreaterThan(0);
    });

    it("Wege, Orte und alles andere außerhalb der Flächen bleiben unberührt", () => {
        const vorher = stil();
        const nachher = isoliereStil(vorher, DUNKELWALD);
        const geschuetzt = new Set([LANDSCAPE_SOURCE_ID, LANDSCAPE_RUN_SOURCE_ID, MAP_LABEL_SOURCE_ID]);
        nachher.layers.forEach((layer, i) => {
            const q = quelle(layer);
            if (q !== undefined && geschuetzt.has(q)) return;
            expect(layer, layer.id).toBe(vorher.layers[i]);
        });
        expect(nachher.sources).toBe(vorher.sources);
    });

    it("die Klimazonen gehen ganz: Keine von ihnen ist die bearbeitete Fläche", () => {
        const nachher = isoliereStil(stil("klima"), DUNKELWALD);
        const klima = nachher.layers.filter((layer) => quelle(layer) === CLIMATE_SOURCE_ID);
        expect(klima.length).toBeGreaterThan(0);
        for (const layer of klima) expect(zeigt(layer, { type_key: "gemaessigt" }), layer.id).toBe(false);
    });

    it("der isolierte Stil ist für MapLibre gültig", () => {
        expect(validateStyleMin(isoliereStil(stil(), DUNKELWALD))).toEqual([]);
        expect(validateStyleMin(isoliereStil(stil("klima"), DUNKELWALD))).toEqual([]);
    });
});

describe("Auswahl isolieren: andere gezeichnete Flächen", () => {
    it("nur die isolierte bleibt, ohne Isolieren alle", () => {
        const zeilen = [{ id: DUNKELWALD }, { id: NACHBAR }];
        expect(nurIsolierte(zeilen, DUNKELWALD, (z) => z.id)).toEqual([{ id: DUNKELWALD }]);
        expect(nurIsolierte(zeilen, undefined, (z) => z.id)).toEqual(zeilen);
    });
});

/** Ein Tastendruck, wie ihn das Fenster meldet. */
function druecke(ziel: EventTarget, key: string, extra: Partial<KeyboardEvent> = {}): Event {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        ...extra,
    });
    ziel.dispatchEvent(event);
    return event;
}

describe("Auswahl isolieren: der Schalter", () => {
    const aufbau = () => {
        const laufend = shallowRef<string | undefined>(DUNKELWALD);
        const tasten = new EventTarget();
        const isolieren = createAuswahlIsolieren({ laufend: () => laufend.value, tasten });
        return { laufend, tasten, isolieren };
    };

    it("schaltet an und wieder aus; an steht nur die laufende Fläche", () => {
        const { isolieren } = aufbau();
        expect(isolieren.flaeche.value).toBeUndefined();
        isolieren.umschalten();
        expect(isolieren.an.value).toBe(true);
        expect(isolieren.flaeche.value).toBe(DUNKELWALD);
        isolieren.umschalten();
        expect(isolieren.flaeche.value).toBeUndefined();
    });

    it("🔴 endet der Modus, sind alle Flächen wieder da; ein neuer Modus beginnt aus", () => {
        const { laufend, isolieren } = aufbau();
        isolieren.umschalten();
        laufend.value = undefined;
        expect(isolieren.an.value).toBe(false);
        expect(isolieren.flaeche.value).toBeUndefined();
        laufend.value = DUNKELWALD;
        expect(isolieren.flaeche.value).toBeUndefined();
    });

    it("wechselt der Modus zu einer anderen Fläche, ist der Knopf aus", () => {
        const { laufend, isolieren } = aufbau();
        isolieren.umschalten();
        laufend.value = NACHBAR;
        expect(isolieren.flaeche.value).toBeUndefined();
    });

    it("„Verwerfen“ lässt den Modus stehen und schaltet aus", () => {
        const { isolieren } = aufbau();
        isolieren.umschalten();
        isolieren.aus();
        expect(isolieren.flaeche.value).toBeUndefined();
    });

    it("ohne laufenden Modus schaltet nichts", () => {
        const { laufend, isolieren } = aufbau();
        laufend.value = undefined;
        isolieren.umschalten();
        expect(isolieren.an.value).toBe(false);
    });

    it("die Taste I schaltet um; mit Strg, Umschalt, gehalten oder im Eingabefeld nicht", () => {
        const { tasten, isolieren } = aufbau();
        const event = druecke(tasten, "i");
        expect(isolieren.an.value).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        druecke(tasten, "I");
        expect(isolieren.an.value).toBe(false);
        druecke(tasten, "i", { ctrlKey: true });
        druecke(tasten, "i", { shiftKey: true });
        druecke(tasten, "i", { repeat: true });
        druecke(tasten, "x");
        expect(isolieren.an.value).toBe(false);
        const feld = Object.assign(new EventTarget(), {
            closest: (wahl: string) => (wahl.includes("input") ? {} : null),
        });
        const imFeld = Object.assign(new Event("keydown", { cancelable: true }), { key: "i" });
        Object.defineProperty(imFeld, "target", { value: feld });
        tasten.dispatchEvent(imFeld);
        expect(isolieren.an.value).toBe(false);
    });

    it("ohne Modus hört die Taste nichts mehr", () => {
        const { laufend, tasten, isolieren } = aufbau();
        laufend.value = undefined;
        const event = druecke(tasten, "i");
        expect(event.defaultPrevented).toBe(false);
        laufend.value = DUNKELWALD;
        druecke(tasten, "i");
        expect(isolieren.an.value).toBe(true);
        isolieren.destroy();
        druecke(tasten, "i");
        expect(isolieren.an.value).toBe(true);
    });
});
