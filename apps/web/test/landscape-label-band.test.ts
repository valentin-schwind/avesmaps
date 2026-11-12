import { describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { composeView, renderZoomForBand } from "@avesmaps3d/shared";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { findLayer } from "./style-spec.ts";
import { landscapeRunLayerId, mapLabelLayerId } from "../src/map/landscape-layers.ts";

/** Die Namensebenen der Vegetation: Die Fälle unten tragen `region_layer: vegetation` (seit WI-0135 je Ebene eine). */
const PUNKTE = mapLabelLayerId("vegetation");
const KURVEN = landscapeRunLayerId("vegetation");

/**
 * Der Stil zeichnet einen Landschaftsnamen genau in dem Band, das die Kachel mitbringt (WI-0064).
 *
 * Die Darstellungstafel der Landschaften wirkt NICHT im Browser: sie wird im Import zur wirksamen Tafel und steht danach in
 * `map_label_effective` (Migration 0057), aus der beide Namensansichten ihre Werte lesen. Der Stil bekommt also `label_min_zoom` und
 * `label_max_zoom` fertig - eigener Wert oder Tafelwert der Art, er weiss nicht, welches. Diese Datei haelt fest, dass er dabei
 * bleibt: keine Art im Filter, keine zweite Tafel im Bundle, und ein Band `bis = -1` ("aus") zeichnet nirgends.
 *
 * 🪤 Die Eigenschaften, die die Kachel tatsaechlich traegt, prueft `apps/server/test/label-style-properties.test.ts` an der Relation;
 * die Wirkung der Tafel darauf `apps/server/test/landscape-display.test.ts`. Hier steht nur die dritte Haelfte: der Filter.
 */

function sichtbar(layerId: string, properties: Record<string, unknown>, zoom: number): boolean {
    const composition = composeView("landscapes", "alle");
    const layer = findLayer(buildPlaceLayers({ labels: true, composition }), layerId, "symbol");
    if (!layer) throw new Error(`${layerId} fehlt im Stil oder ist kein Symbollayer`);
    const compiled = featureFilter(layer.filter, "filter");
    const feature = {
        type: 1 as const,
        properties: { region_layer: "vegetation", has_curve_run: false, ...properties },
    };
    return compiled.filter({ zoom }, feature as never, undefined as never);
}

/** Die MapLibre-Stufen 0 bis 10, auf denen ein Feature durch den Filter kommt. */
function stufen(layerId: string, properties: Record<string, unknown>): number[] {
    return Array.from({ length: 11 }, (_, zoom) => zoom).filter((zoom) => sichtbar(layerId, properties, zoom));
}

describe("das Band aus der Kachel bestimmt, wo ein Name steht", () => {
    it("🔴 ein Band 5..7 (Tafelwert fuer wald) zeichnet auf den Render-Stufen 6 bis 8, nicht davor und nicht danach", () => {
        const wald = { label_min_zoom: 5, label_max_zoom: 7, label_type: "wald" };
        expect(stufen(PUNKTE, wald)).toEqual([6, 7, 8]);
    });

    it("dasselbe Band gilt fuer jede Art: der Filter kennt keine Art", () => {
        const band = { label_min_zoom: 3, label_max_zoom: 5 };
        const erwartet = stufen(PUNKTE, { ...band, label_type: "wald" });
        expect(erwartet).toEqual([4, 5, 6]);
        for (const art of ["gebirge", "meer", "tundra", "eine_art_die_es_nicht_gibt", null]) {
            expect(stufen(PUNKTE, { ...band, label_type: art })).toEqual(erwartet);
        }
    });

    it("🔴 Zielmaximum 8 (Legacys bis 7 nach dem Import, WI-0129) zeichnet bis MapLibre 9; ein Ziel 7 endet weiter bei 8", () => {
        // Die Transformation steckt im Import, nicht hier: der Filter liest den Zielwert wörtlich (Betreiber 2026-10-10 E2 A).
        expect(stufen(PUNKTE, { label_min_zoom: 5, label_max_zoom: 8, label_type: "wald" })).toEqual([6, 7, 8, 9]);
        expect(stufen(PUNKTE, { label_min_zoom: 7, label_max_zoom: 8, label_type: "wald" })).toEqual([8, 9]);
        expect(stufen(PUNKTE, { label_min_zoom: 5, label_max_zoom: 7, label_type: "wald" })).toEqual([6, 7, 8]);
    });

    it("🔴 oben endet ein Name erst am Ende seiner Stufe: Obergrenze n steht bei n+1,5 noch, bei n+2 nicht (WI-0129 §17d)", () => {
        // Die Zoomanzeige zeigt bei MapLibre n+1,5 die Stufe n. MapLibre wertet den Filter mit dem ganzzahligen Kachelzoom aus;
        // `< n+2` stimmt dort und ebenso bei jedem Zwischenwert (wie die Orts-Overrides).
        const bisDrei = { label_min_zoom: 0, label_max_zoom: 3, label_type: "kontinent" };
        expect(sichtbar(PUNKTE, bisDrei, renderZoomForBand(3) + 0.5)).toBe(true);
        expect(sichtbar(PUNKTE, bisDrei, renderZoomForBand(4))).toBe(false);
        // Stufe 8 ist die höchste und reicht bis zum Anschlag 9,5.
        expect(sichtbar(PUNKTE, { label_min_zoom: 5, label_max_zoom: 8, label_type: "wald" }, 9.5)).toBe(true);
    });

    it("🔴 unten hält die unterste Stufe bis zum kleinsten Zoom der Karte: Aventurien (0 bis 3) steht auch bei MapLibre 0,7 (Telefon)", () => {
        // Betreiber 2026-10-11: „„aventurien“ z.b. verschwindet weil das band zu klein wird. (ich schätze 0+1 > 0,5)“.
        // Gemessen: Telefon endet bei 0,71, Rechner mit offenem Planer bei 0,86; dort ist Kachelzoom 0, die Anzeige zeigt 0.
        const aventurien = { label_min_zoom: 0, label_max_zoom: 3, label_type: "kontinent" };
        for (const zoom of [0, 0.7, 0.86, 1]) expect(sichtbar(PUNKTE, aventurien, zoom), String(zoom)).toBe(true);
        // Eine Untergrenze über 0 beginnt weiter am Anfang ihrer Stufe.
        expect(sichtbar(PUNKTE, { label_min_zoom: 2, label_max_zoom: 5, label_type: "wald" }, 2.99)).toBe(false);
        expect(sichtbar(PUNKTE, { label_min_zoom: 2, label_max_zoom: 5, label_type: "wald" }, 3)).toBe(true);
    });

    it("🔴 „aus“ (bis = -1, die Tafel sagt es so) zeichnet auf keiner Stufe - auch nicht auf Stufe 0", () => {
        expect(stufen(PUNKTE, { label_min_zoom: 4, label_max_zoom: -1, label_type: "wald" })).toEqual([]);
        expect(stufen(PUNKTE, { label_min_zoom: 0, label_max_zoom: -1, label_type: "wald" })).toEqual([]);
        expect(sichtbar(PUNKTE, { label_min_zoom: 0, label_max_zoom: -1, label_type: "wald" }, 0.7)).toBe(false);
    });

    it("die Schriftlaeufe tragen kein Zoomfenster im Filter: das Band steckt in den Laeufen, die die Kachelfunktion je Stufe liefert", () => {
        // Die Ableitung rechnet die Laeufe aus den wirksamen Baendern (`loadCurveRegions`); der Layer zeichnet, was ankommt.
        // Ein Filter auf `["zoom"]` waere falsch: die Baender sind je Region verschieden, und ein Layer hat nur ein Zoomfenster.
        const lauf = { run_min_zoom: 6, run_max_zoom: 6, label_min_zoom: 2, label_max_zoom: 7 };
        expect(stufen(KURVEN, lauf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
});
