import { describe, expect, it } from "vitest";
import { DESIGN_CANON, labelFamily, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import {
    CLIMATE_LABEL_LAYER_ID,
    climateLabelRoom,
    climateLabelSize,
    climateLabelWidth,
    CLIMATE_LABEL_SOURCE_ID,
    type ClimateLabelPoints,
} from "../src/map/landscape-layers.ts";
import { displayDefaults, type MapDisplay } from "../src/map/map-display.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";
import { findLayer, ortsnamenImStapel } from "./style-spec.ts";

/**
 * Die Zonennamen im Stil (WI-0012, Nachtrag 2026-10-05): eine GeoJSON-Quelle, die `climate-labels.ts` nachführt, statt der
 * Punkte an den Kartenrändern aus `climate_label_render`.
 */

const POINTS: ClimateLabelPoints = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [10, 20] },
            properties: { type_key: "gemaessigt", name: "Gemäßigte Zone" },
        },
    ],
};

function style(view: MapView, selection: LandscapeSelection, display: Partial<MapDisplay> = {}) {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        climateLabelPoints: POINTS,
        pathUrl: "/w/{z}/{x}/{y}",
        pathLabelUrl: "/wl/{z}/{x}/{y}",
        powerlineUrl: "/k/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        waterUrl: "/g/{z}/{x}/{y}",
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: selection,
        display: { ...displayDefaults(view), ...display },
    });
}

describe("Die Zonennamen im Stil", () => {
    it("🔴 die Quelle trägt die Punkte, die die Seite gerade hält: ein Stilwechsel leert sie nicht", () => {
        expect(style("landscapes", "klima").sources[CLIMATE_LABEL_SOURCE_ID]).toEqual({
            type: "geojson",
            data: POINTS,
        });
    });

    it("🔴 kein Kachelpunkt am Kartenrand mehr: keine Kante, kein Versatz je Seite", () => {
        const layer = findLayer(style("landscapes", "klima").layers, CLIMATE_LABEL_LAYER_ID, "symbol");
        expect(layer?.source).toBe(CLIMATE_LABEL_SOURCE_ID);
        expect(layer).not.toHaveProperty("source-layer");
        expect(layer?.layout).not.toHaveProperty("text-anchor");
        expect(layer?.layout).not.toHaveProperty("text-offset");
    });

    it("💣 Klimazonen: Kollision wie jeder Kartenname (text-overlap), ein gewanderter Name steht sofort (text-allow-overlap)", () => {
        const s = style("landscapes", "klima");
        const layer = findLayer(s.layers, CLIMATE_LABEL_LAYER_ID, "symbol");
        expect(layer?.layout?.["text-overlap"]).toBe("never");
        expect(layer?.layout?.["text-allow-overlap"]).toBe(true);
        expect(layer?.layout?.["text-optional"]).toBe(false);
        // Oben im Stapel: zuerst gesetzt, über den Orts- und Wegnamen der Ansicht.
        const ids = s.layers.map((l) => l.id);
        expect(ids.indexOf(CLIMATE_LABEL_LAYER_ID)).toBeGreaterThan(ortsnamenImStapel(ids).letzte);
    });

    it("🔴 in Versalien, 22 px aus dem Kanon, Laufweite für Versalien, schmaler scharfer Saum (Betreiber 2026-10-05)", () => {
        // „kannst du die zonentitel deutlich größer und mit kapitälchen machen?“, dann „nein mach alles in großbuchstaben“.
        const family = labelFamily("climate");
        expect(family.size).toBe(22);
        expect(family.size).toBe(DESIGN_CANON.mapSelection.labelSize);
        expect(`${String(family.letterSpacing)}em`).toBe(DESIGN_CANON.typography.letterSpacingCaps);
        const layer = findLayer(style("landscapes", "klima").layers, CLIMATE_LABEL_LAYER_ID, "symbol");
        expect(layer?.layout?.["text-transform"]).toBe("uppercase");
        expect(layer?.layout?.["text-size"]).toBe(22);
        expect(layer?.layout?.["text-letter-spacing"]).toBe(0.08);
        // „die kontur weniger krass stark machen“: 0,06 der Schriftgröße, 1,32 px statt 2,2.
        expect(layer?.paint?.["text-halo-width"]).toBeCloseTo(1.32, 6);
        expect(layer?.paint?.["text-halo-blur"]).toBe(0);
        // Die Schmal-Regel wächst mit: eine Zeile samt Saum oben und unten.
        expect(climateLabelRoom(22)).toBeCloseTo(22 * (1.2 + 2 * 0.06), 6);
        expect(climateLabelRoom(16)).toBeLessThan(climateLabelRoom(22));
    });

    it("🔴 am Telefon 16 px aus dem Kanon: Der längste Name passt dort auf einen Schirm von 360 px, in 22 px nicht", () => {
        expect(climateLabelSize(false)).toBe(22);
        expect(climateLabelSize(true)).toBe(labelFamily("climate").sizePhone);
        expect(climateLabelSize(true)).toBe(DESIGN_CANON.typography.size.subhead);
        const longest = Math.max(
            ...["Winterfeuchte Subtropen", "Subtropische Steppenzone", "Subtropische Wüstenzone"].map((name) =>
                climateLabelWidth(name, 16),
            ),
        );
        expect(longest).toBeLessThan(320);
        expect(climateLabelWidth("Subtropische Steppenzone", 22)).toBeGreaterThan(360);
        // Versalien: „ß“ wird zu „SS“ (ein großes ẞ führen die Glyphen nicht); gemessen wird, was gesetzt wird.
        expect(climateLabelWidth("Gemäßigte Zone", 22)).toBeGreaterThan(climateLabelWidth("Gemäsigte Zone", 22));
    });

    it("🔴 die Namen stehen, wo die Bänder stehen: nur in den Klimazonen, nicht in „Alle“, nicht ohne Flächen", () => {
        // Betreiber 2026-10-05: „Wenn ich auf "Alle" klick, sollen keine klimazonen mehr angezeigt werden“.
        const has = (s: ReturnType<typeof style>): boolean => s.layers.some((l) => l.id === CLIMATE_LABEL_LAYER_ID);
        expect(has(style("landscapes", "klima"))).toBe(true);
        expect(has(style("landscapes", "alle"))).toBe(false);
        expect(has(style("landscapes", "klima", { layers: false })), "ohne Bänder kein Name").toBe(false);
        expect(has(style("landscapes", "vegetation"))).toBe(false);
        expect(has(style("standard", "alle"))).toBe(false);
    });
});
