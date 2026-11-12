import { afterEach, describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { zoombaenderSetzen } from "../src/map/zoombaender-stand.ts";
import { buildLandscapeRunLayer, buildMapLabelLayer } from "../src/map/landscape-layers.ts";

/**
 * F2 an den Landschaftsnamen (WI-0178, Migration 0206; Befund der Kartenverwaltung WI-0221 §8.1): Die Spanne am Objekt ersetzt die der
 * Art. Problemfälle: Eine im Reiter „Zoombänder“ verengte Art beschneidet auch eine Beschriftung mit eigener Spanne (Schnittmenge); eine
 * alte Kachel ohne `own_span` verliert die Grenze der Art.
 */
afterEach(() => zoombaenderSetzen({}));

const filterVon = (ebene: { type: string }): unknown => ("filter" in ebene ? ebene.filter : undefined);
/** Lässt der Filter dieses Objekt auf diesem Zoom durch? (`["zoom"]` im Filter: ganzzahliger Kachelzoom.) */
const laesstDurch = (filter: unknown, zoom: number, properties: Record<string, unknown>): boolean =>
    featureFilter(filter as never, "filter").filter({ zoom }, { type: 2, properties } as never, undefined as never);

describe("Landschaftsnamen: eigene Spanne vor der Art", () => {
    it("🔴 die Art „Wald“ ab Band 5: ein Wald mit eigener Spanne steht auch in Band 4, einer ohne nicht, eine alte Kachel wie bisher", () => {
        zoombaenderSetzen({ "landschaften.wald.name": { von: 5, bis: 8 } });
        const lauf = filterVon(buildLandscapeRunLayer("x", ["vegetation"]));
        const wald = { region_layer: "vegetation", region_type: "wald" };
        expect(laesstDurch(lauf, renderZoomForBand(4), { ...wald, own_span: true })).toBe(true);
        expect(laesstDurch(lauf, renderZoomForBand(4), { ...wald, own_span: false })).toBe(false);
        expect(laesstDurch(lauf, renderZoomForBand(4), wald)).toBe(false);
        expect(laesstDurch(lauf, renderZoomForBand(5), { ...wald, own_span: false })).toBe(true);
    });

    it("🔴 dasselbe an den Punktnamen; ihre eigene Spanne begrenzt sie weiter (label_min_zoom, label_max_zoom)", () => {
        zoombaenderSetzen({ "landschaften.wald.name": { von: 5, bis: 8 } });
        const punkt = filterVon(buildMapLabelLayer("x", ["vegetation"]));
        const wald = {
            region_layer: "vegetation",
            region_type: "wald",
            has_curve_run: false,
            label_min_zoom: 3,
            label_max_zoom: 6,
        };
        expect(laesstDurch(punkt, renderZoomForBand(4), { ...wald, own_span: true })).toBe(true);
        expect(laesstDurch(punkt, renderZoomForBand(4), { ...wald, own_span: false })).toBe(false);
        expect(laesstDurch(punkt, renderZoomForBand(7), { ...wald, own_span: true })).toBe(false);
    });
});
