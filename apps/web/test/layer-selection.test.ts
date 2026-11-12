import { describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { composeView, LANDSCAPE_LAYERS, LANDSCAPE_SELECTIONS, type LandscapeSelection } from "@avesmaps3d/shared";
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
    LANDSCAPE_NAME_LAYER_IDS,
    LANDSCAPE_RUN_LAYER_ID,
    landscapeRunLayerId,
    MAP_LABEL_LAYER_ID,
    mapLabelLayerId,
} from "../src/map/landscape-layers.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { findLayer } from "./style-spec.ts";

/**
 * Fläche und Beschriftung folgen derselben Ebenenauswahl (WI-0009).
 *
 * 💣 REGRESSION. An der Stage-Abnahme am 2026-09-22 gefunden: der Kartenfächer schaltete die
 * FLÄCHEN um, die Landschaftsnamen blieben alle stehen. „Herz des Kontinents" und „Darpatien" sind
 * derographische Regionen und standen trotzdem über der Vegetations- und der Topographieansicht.
 *
 * 🪤 Geprüft wird die WIRKUNG des Filters mit MapLibres eigenem Auswerter, nicht seine Form. Ein
 * Vergleich der Ausdrucks-Arrays wäre grün, solange die Struktur stimmt, und merkte nicht, wenn der
 * Filter etwas anderes durchlässt.
 */

/** Punkt- und Kurvennamen; seit WI-0135 steht jede Art je Landschaftsebene in einer eigenen Symbolebene. */
const LABEL_LAYERS = [MAP_LABEL_LAYER_ID, LANDSCAPE_RUN_LAYER_ID];

/** Lässt IRGENDEINE Ebene dieser Art (Punkt oder Kurve) ein Feature dieser Landschaftsebene durch? */
function passes(selection: LandscapeSelection, layerId: string, regionLayer: string): boolean {
    const composition = composeView("landscapes", selection);
    return buildPlaceLayers({ labels: true, composition })
        .filter((layer) => layer.id.startsWith(`${layerId}-`))
        .some((layer) => passesLayer(layer, regionLayer));
}

function passesLayer(layer: LayerSpecification, regionLayer: string): boolean {
    const compiled = featureFilter("filter" in layer ? layer.filter : undefined, "filter");
    // Zoom und Erscheinungsband so wählen, dass NUR die Ebene entscheidet: sonst misst der Test
    // den Zoomfilter mit und nennt das Ergebnis Ebenenauswahl.
    const feature = {
        type: 1 as const,
        properties: {
            region_layer: regionLayer,
            has_curve_run: false,
            label_min_zoom: 0,
            label_max_zoom: 8,
        },
    };
    return compiled.filter({ zoom: 4 }, feature as never, undefined as never);
}

describe("Ebenenauswahl im Kartenfächer", () => {
    it("🔴 zeigt bei einer einzelnen Ebene NUR deren Namen", () => {
        for (const selection of ["derographisch", "vegetation", "topographie"] as const) {
            for (const layerId of LABEL_LAYERS) {
                expect(passes(selection, layerId, selection), `${layerId}: ${selection} muss durch`).toBe(true);
                for (const other of ["derographisch", "vegetation", "topographie"] as const) {
                    if (other === selection) {
                        continue;
                    }
                    expect(
                        passes(selection, layerId, other),
                        `${layerId}: bei ${selection} darf ${other} NICHT durch`,
                    ).toBe(false);
                }
            }
        }
    });

    it("🔴 zeigt bei der Auswahl Alle jeden Landschaftsnamen und überlässt den Rest der Kollision", () => {
        for (const layerId of LABEL_LAYERS) {
            for (const layer of ["derographisch", "vegetation", "topographie"] as const) {
                expect(passes("alle", layerId, layer), `${layerId}: ${layer} bei Alle`).toBe(true);
            }
        }
    });

    it("💣 zeigt in der Klimaansicht GAR KEINE Landschaftsnamen", () => {
        // 🪤 Klimazonen sind nicht namenlos - aber ihr Name kommt NICHT aus `map_label`, sondern
        // ist der Regionsname der Flaeche selbst (Legacy, `map-features-ecosystem-climate.js`).
        // Dieser Layer fuehrt Landschaftsnamen; in der Klimaansicht hat er nichts beizutragen, und
        // fremde Namen stehen zu lassen waere falsch. Die Klimabeschriftung ist ein eigener Layer
        // (WI-0012).
        for (const layerId of LABEL_LAYERS) {
            for (const layer of [...LANDSCAPE_LAYERS]) {
                expect(passes("klima", layerId, layer), `${layerId}: ${layer} in der Klimaansicht`).toBe(false);
            }
        }
    });

    it("🔴 laesst FLAECHE und NAME nie auseinanderlaufen", () => {
        // Der eigentliche Regressionsschutz: fuer jede Auswahl muss die Menge der gezeichneten
        // Flaechenebenen mit der Menge der beschrifteten Ebenen uebereinstimmen - bis auf `klima`,
        // das eine Flaeche hat und keine Labels.
        for (const selection of LANDSCAPE_SELECTIONS) {
            const composition = composeView("landscapes", selection);
            const layers = buildPlaceLayers({ labels: true, composition });
            const flaechen = layers
                .filter((layer) => layer.id.startsWith("landscape-fill-"))
                .map((layer) => layer.id.replace("landscape-fill-", ""));

            for (const ebene of ["derographisch", "vegetation", "topographie"] as const) {
                const hatFlaeche = flaechen.includes(ebene);
                const hatNamen = passes(selection, MAP_LABEL_LAYER_ID, ebene);
                expect(hatNamen, `${selection}: Flaeche ${String(hatFlaeche)}, Namen ${String(hatNamen)}`).toBe(
                    hatFlaeche,
                );
            }
        }
    });

    it("🪤 laesst die Standardansicht unberuehrt: dort stehen alle Namen ohne Flaechen", () => {
        // Sonst wuerde der Fix die abgenommene Standardkarte beschaedigen - dort liegt KEINE
        // Flaeche, aber alle Landschaftsnamen stehen.
        const composition = composeView("standard", "alle");
        const layers = buildPlaceLayers({ labels: true, composition });
        expect(layers.filter((layer) => layer.id.startsWith("landscape-fill-"))).toHaveLength(0);

        for (const ebene of ["derographisch", "vegetation", "topographie"] as const) {
            const label = findLayer(layers, mapLabelLayerId(ebene), "symbol");
            expect(label && passesLayer(label, ebene), `Standard: ${ebene}`).toBe(true);
        }
    });

    it("🔴 in Standard und „Alle“ gewinnt Derographie vor Topographie vor Vegetation, je Ebene die Kurve vor dem Punkt", () => {
        // Betreiber 2026-10-11 zu „Aventurien“, das auf Stufe 1 dem Kurvennamen „Raschtulswall“ wich: „in standard und bei
        // "alle" in den landschaften immer derographie > topographie > vegetation gewinnen“. MapLibre setzt von OBEN nach
        // unten, also vom Ende des Felds her: Wer zuerst gesetzt wird, hat den größeren Index.
        for (const composition of [composeView("standard", "alle"), composeView("landscapes", "alle")]) {
            const ids = buildPlaceLayers({ labels: true, composition }).map((layer) => layer.id);
            const gesetzt = LANDSCAPE_NAME_LAYER_IDS.map((id) => ids.indexOf(id));
            expect(gesetzt.every((index) => index >= 0)).toBe(true);
            expect(gesetzt).toEqual([...gesetzt].sort((a, b) => b - a));
            expect(LANDSCAPE_NAME_LAYER_IDS).toEqual([
                landscapeRunLayerId("derographisch"),
                mapLabelLayerId("derographisch"),
                landscapeRunLayerId("topographie"),
                mapLabelLayerId("topographie"),
                landscapeRunLayerId("vegetation"),
                mapLabelLayerId("vegetation"),
            ]);
        }
    });

    it("🔴 „Nur Karte“ ist der Untergrund allein: keine Orte, keine Wege, keine Namen, keine Flächen (WI-0024)", () => {
        const composition = composeView("none", "alle");
        expect(composition).toEqual({
            basemap: true,
            basemapDesaturated: false,
            powerlines: false,
            nodices: false,
            places: false,
            territories: false,
            territoryCapitals: false,
            paths: false,
            landscapeNames: false,
            landscapeLayers: [],
            landscapeNameLayers: [],
            contours: false,
            heightTints: false,
            peaks: "none",
        });
        const ids = buildPlaceLayers({ labels: true, composition }).map((layer) => layer.id);
        // Übrig bleibt allein der Untergrund über dem Papiergrund.
        expect(ids.filter((id) => id !== "background")).toEqual(["basemap"]);
    });
});
