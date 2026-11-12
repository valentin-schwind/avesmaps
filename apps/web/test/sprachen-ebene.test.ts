import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    composeView,
    labelFamily,
    layersOfSelection,
    type LandscapeSelection,
    type MapView,
    type TerrainDemPointer,
} from "@avesmaps3d/shared";
import { CLIMATE_FILL_LAYER_ID, climateHaloColour, climateNameColour } from "../src/map/landscape-layers.ts";
import { displayDefaults, type MapDisplay } from "../src/map/map-display.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";
import {
    parseSprachMischBildName,
    SPRACHE_DARSTELLUNG,
    SPRACHE_FILL_LAYER_ID,
    SPRACHE_LABEL_LAYER_ID,
    SPRACHE_LABEL_SOURCE_ID,
    SPRACHE_LINE_LAYER_ID,
    SPRACHE_MISCH_LAYER_ID,
    SPRACHE_MISCH_SOURCE_ID,
    SPRACHE_SOURCE_ID,
    sprachMischBild,
    sprachMischBildName,
    sprachMischImageResolver,
    sprachNamensFarben,
} from "../src/map/sprachen-layers.ts";
import { SPRACH_LABELS } from "../src/map/sprachen-labels.ts";
import { legendenZeilen } from "../src/map/sprachen-stand.ts";
import { HILLSHADE_LAYER_ID, OWN_AREA_FILL_IDS, withTerrain } from "../src/map/terrain/terrain.ts";
import { findLayer, ortsnamenImStapel, propertySpec } from "./style-spec.ts";

/**
 * Die Ebene Derographie › Sprachen (WI-0261 S5a): Füllung, Mischgebiete als Schraffur, Kontur, Namen und Legende, nach der
 * Bauvorlage (Probierseite 2026-10-30).
 */

function style(
    view: MapView,
    selection: LandscapeSelection,
    display: Partial<MapDisplay> = {},
    mitSprachen = true,
): ReturnType<typeof buildPlaceStyle> {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        ...(mitSprachen ? { sprachenUrl: "/s/{z}/{x}/{y}", sprachenMischUrl: "/sm/{z}/{x}/{y}" } : {}),
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

const SPRACH_EBENEN = [SPRACHE_FILL_LAYER_ID, SPRACHE_MISCH_LAYER_ID, SPRACHE_LINE_LAYER_ID, SPRACHE_LABEL_LAYER_ID];

describe("Die Ebene „Sprachen“ in der Derographie", () => {
    it("🔴 nur in ihrer eigenen Ebene, nie in „Alle“ (Bauvorlage: in den übrigen Chips nur die Grundkarte)", () => {
        expect(layersOfSelection("sprachen")).toEqual(["sprachen"]);
        expect(layersOfSelection("alle")).not.toContain("sprachen");
        expect(layersOfSelection("alle")).not.toContain("klima");
        const ids = (s: ReturnType<typeof style>): string[] => s.layers.map((layer) => layer.id);
        expect(ids(style("landscapes", "sprachen"))).toEqual(expect.arrayContaining(SPRACH_EBENEN));
        for (const [view, selection] of [
            ["landscapes", "alle"],
            ["landscapes", "klima"],
            ["landscapes", "derographisch"],
            ["standard", "sprachen"],
            ["political", "sprachen"],
        ] as const) {
            const s = style(view, selection);
            expect(
                ids(s).filter((id) => SPRACH_EBENEN.includes(id)),
                `${view}/${selection}`,
            ).toEqual([]);
            expect(Object.keys(s.sources), `${view}/${selection}: keine Quelle ohne Ebene`).not.toContain(
                SPRACHE_SOURCE_ID,
            );
        }
        // Keine Gipfel, wie bei den Klimazonen.
        expect(composeView("landscapes", "sprachen").peaks).toBe("none");
    });

    it("🔴 ohne Flächen (Schalter „Flächen“) und ohne Kachelquellen gibt es weder Flächen noch Namen", () => {
        const ohneFlaechen = style("landscapes", "sprachen", { layers: false });
        expect(ohneFlaechen.layers.some((layer) => SPRACH_EBENEN.includes(layer.id))).toBe(false);
        expect(Object.keys(ohneFlaechen.sources)).not.toContain(SPRACHE_SOURCE_ID);
        const ohneQuellen = style("landscapes", "sprachen", {}, false);
        expect(ohneQuellen.layers.some((layer) => SPRACH_EBENEN.includes(layer.id))).toBe(false);
    });

    it("🔴 Quellen: Flächen und Mischgebiete als Vektorkacheln, die Namen als GeoJSON, das die Seite nachführt", () => {
        const s = style("landscapes", "sprachen");
        expect(s.sources[SPRACHE_SOURCE_ID]).toMatchObject({ type: "vector", tiles: ["/s/{z}/{x}/{y}"] });
        expect(s.sources[SPRACHE_MISCH_SOURCE_ID]).toMatchObject({ type: "vector", tiles: ["/sm/{z}/{x}/{y}"] });
        expect(s.sources[SPRACHE_LABEL_SOURCE_ID]).toMatchObject({ type: "geojson" });
    });

    it("🔴 Füllung 0,56 und Kontur 0,95 / 1,1 px in der Farbe der Sprache, Schraffur 0,92 darüber, Kontur zuoberst (Werte der Vorlage)", () => {
        const s = style("landscapes", "sprachen");
        const fill = findLayer(s.layers, SPRACHE_FILL_LAYER_ID, "fill");
        const misch = findLayer(s.layers, SPRACHE_MISCH_LAYER_ID, "fill");
        const line = findLayer(s.layers, SPRACHE_LINE_LAYER_ID, "line");
        expect(fill?.paint?.["fill-color"]).toEqual(["get", "farbe"]);
        expect(fill?.paint?.["fill-opacity"]).toBe(0.56);
        expect(line?.paint?.["line-color"]).toEqual(["get", "farbe"]);
        expect(line?.paint?.["line-opacity"]).toBe(0.95);
        // 1,1 px, die gezeigte Sprache 2,4 px (WI-0261 S5b, über ihren Feature-State).
        expect(line?.paint?.["line-width"]).toEqual([
            "case",
            ["boolean", ["feature-state", "sprachHover"], false],
            2.4,
            1.1,
        ]);
        expect(misch?.paint?.["fill-opacity"]).toBe(0.92);
        const ids = s.layers.map((layer) => layer.id);
        expect(ids.indexOf(SPRACHE_FILL_LAYER_ID)).toBeLessThan(ids.indexOf(SPRACHE_MISCH_LAYER_ID));
        expect(ids.indexOf(SPRACHE_MISCH_LAYER_ID)).toBeLessThan(ids.indexOf(SPRACHE_LINE_LAYER_ID));
        // Kleine Teilflächen oben: Der Sortierschlüssel fällt mit der Fläche.
        const sortKey = createPropertyExpression(
            fill?.layout?.["fill-sort-key"],
            "fill-sort-key",
            propertySpec("layout_fill", "fill-sort-key"),
        );
        expect(sortKey.result).toBe("success");
        if (sortKey.result === "success") {
            const klein = sortKey.value.evaluate({ zoom: 3 }, { type: 3, properties: { area: 5 } } as never);
            const gross = sortKey.value.evaluate({ zoom: 3 }, { type: 3, properties: { area: 5000 } } as never);
            expect(klein).toBeGreaterThan(gross);
        }
    });

    it("🔴 die Schraffur nennt ihr Muster nach dem Farbpaar der Kachel; der Name liest sich zurück", () => {
        const misch = findLayer(style("landscapes", "sprachen").layers, SPRACHE_MISCH_LAYER_ID, "fill");
        const bild = createPropertyExpression(
            misch?.paint?.["fill-pattern"],
            "fill-pattern",
            propertySpec("paint_fill", "fill-pattern"),
        );
        expect(bild.result).toBe("success");
        if (bild.result !== "success") return;
        // MapLibre liefert ein `ResolvedImage`; sein Text ist der Name, unter dem es das Bild anfragt.
        const name = String(
            bild.value.evaluate({ zoom: 3 }, {
                type: 3,
                properties: { farbe_a: "#ffb901", farbe_b: "#604c34" },
            } as never),
        );
        expect(name).toBe("sprache-misch-ffb901-604c34");
        expect(name).toBe(sprachMischBildName("#ffb901", "#604c34"));
        expect(parseSprachMischBildName(name)).toEqual(["ffb901", "604c34"]);
        for (const unlesbar of ["claim-4-ffb901-604c34", "sprache-misch-ffb901", "sprache-misch-FFB901-604c34"])
            expect(parseSprachMischBildName(unlesbar), unlesbar).toBeUndefined();
    });

    it("🔴 das Muster: quadratisch, eine Zweierpotenz, Streifen von 5 px in beiden Farben; der Auflöser legt es einmal an", () => {
        const bild = sprachMischBild(["ffb901", "604c34"]);
        expect(bild.width).toBe(bild.height);
        expect([32, 64, 128]).toContain(bild.width);
        // Kante 128, neun Wiederholungen: 128 / (2 · 9 · √2) = 5,03 px.
        expect(128 / (2 * 9 * Math.SQRT2)).toBeCloseTo(SPRACHE_DARSTELLUNG.streifenPx, 1);
        const farbe = (x: number, y: number): string => {
            const at = (y * bild.width + x) * 4;
            return [0, 1, 2].map((i) => (bild.data[at + i] as number).toString(16).padStart(2, "0")).join("");
        };
        // Eine Farbe deckt 128 / 18 = 7,1 der Summe x + y: bei (1, 1) die erste Sprache, bei (5, 4) die zweite.
        expect(farbe(1, 1)).toBe("ffb901");
        expect(farbe(5, 4)).toBe("604c34");

        const angelegt: string[] = [];
        const karte = {
            hasImage: (id: string) => angelegt.includes(id),
            addImage: (id: string) => angelegt.push(id),
        };
        const aufloeser = sprachMischImageResolver(karte);
        void aufloeser.resolve("sprache-misch-ffb901-604c34");
        void aufloeser.resolve("sprache-misch-ffb901-604c34");
        void aufloeser.resolve("sprache-misch-kaputt");
        expect(angelegt).toEqual(["sprache-misch-ffb901-604c34"]);
    });

    it("🔴 die Namen: wie die Klimazonen gesetzt, Farben aus dem Punkt nach der Regel der Klimazonen, über den Ortsnamen", () => {
        const s = style("landscapes", "sprachen");
        const label = findLayer(s.layers, SPRACHE_LABEL_LAYER_ID, "symbol");
        expect(label?.source).toBe(SPRACHE_LABEL_SOURCE_ID);
        expect(label?.layout?.["text-transform"]).toBe("uppercase");
        expect(label?.layout?.["text-size"]).toBe(labelFamily("climate").size);
        expect(label?.layout?.["text-overlap"]).toBe("never");
        expect(label?.layout?.["text-allow-overlap"]).toBe(true);
        expect(label?.paint?.["text-color"]).toEqual(["coalesce", ["get", "schrift"], labelFamily("climate").color]);
        expect(label?.paint?.["text-halo-color"]).toEqual([
            "coalesce",
            ["get", "saum"],
            labelFamily("climate").haloColor,
        ]);
        const ids = s.layers.map((layer) => layer.id);
        expect(ids.indexOf(SPRACHE_LABEL_LAYER_ID)).toBeGreaterThan(ortsnamenImStapel(ids).letzte);
        expect(sprachNamensFarben("#ffb901")).toEqual({
            schrift: climateNameColour("#ffb901"),
            saum: climateHaloColour("#ffb901"),
        });
    });

    it("🔴 eine Kachel der Sprachfläche gibt Schlüssel, Namen und Farben des Namens; ohne Schlüssel oder Namen keinen", () => {
        expect(SPRACH_LABELS.ausweichen).toBe(true);
        expect(SPRACH_LABELS.bandOf({ schluessel: "garethi", name: "Garethi", farbe: "#ffb901" })).toEqual({
            key: "garethi",
            name: "Garethi",
            properties: sprachNamensFarben("#ffb901"),
        });
        expect(SPRACH_LABELS.bandOf({ schluessel: "garethi", name: "Garethi", farbe: "gelb" })).toEqual({
            key: "garethi",
            name: "Garethi",
        });
        expect(SPRACH_LABELS.bandOf({ schluessel: "", name: "Garethi" })).toBeUndefined();
        expect(SPRACH_LABELS.bandOf({ schluessel: "garethi", name: " " })).toBeUndefined();
    });

    it("🔴 in 3D wie die Klimazonen: das Relief liegt über Füllung und Schraffur der Sprachen, unter ihrer Kontur", () => {
        expect(OWN_AREA_FILL_IDS).toEqual([CLIMATE_FILL_LAYER_ID, SPRACHE_FILL_LAYER_ID, SPRACHE_MISCH_LAYER_ID]);
        const zeiger: TerrainDemPointer = {
            schemaVersion: 1,
            revision: "3b0c38980fef",
            tileSize: 512,
            maxNativeZoom: 3,
            encoding: "mapbox",
        };
        const ids = withTerrain(style("landscapes", "sprachen"), zeiger, 1, true).layers.map((layer) => layer.id);
        const relief = ids.indexOf(HILLSHADE_LAYER_ID);
        expect(relief).toBeGreaterThan(ids.indexOf(SPRACHE_MISCH_LAYER_ID));
        expect(relief).toBeLessThan(ids.indexOf(SPRACHE_LINE_LAYER_ID));
    });
});

describe("Die Legende der Sprachen", () => {
    it("🔴 Reihenfolge der Antwort, Name der Legende vor dem Namen, unlesbare Zeilen fallen weg", () => {
        expect(
            legendenZeilen({
                sprachen: [
                    {
                        id: "t",
                        schluessel: "thorwalsch",
                        name: "Thorwalsch",
                        legende: "Thorwalsch / Gjalskisch",
                        farbe: "#1baad4",
                    },
                    { id: "g", schluessel: "garethi", name: "Garethi", legende: null, farbe: "#ffb901" },
                    { id: "k", schluessel: "kaputt", name: "Kaputt", legende: null, farbe: "gelb" },
                    { id: "o", name: "ohne Schlüssel", farbe: "#000000" },
                    // Ohne Kennung öffnet ein Klick nichts (WI-0261 S5b): Die Zeile fällt weg.
                    { schluessel: "ohneid", name: "Ohne Kennung", legende: null, farbe: "#000000" },
                ],
            }),
        ).toEqual([
            { id: "t", schluessel: "thorwalsch", name: "Thorwalsch / Gjalskisch", farbe: "#1baad4" },
            { id: "g", schluessel: "garethi", name: "Garethi", farbe: "#ffb901" },
        ]);
        expect(legendenZeilen(null)).toEqual([]);
        expect(legendenZeilen({ sprachen: "nein" })).toEqual([]);
    });
});
