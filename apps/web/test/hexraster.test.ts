import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    canonColour,
    DEFAULT_LANDSCAPE_SELECTION,
    DEFAULT_MAP_VIEW,
    MEILEN_JE_EINHEIT,
    type LandscapeSelection,
    type MapView,
} from "@avesmaps3d/shared";
import {
    buildHexrasterLayer,
    feldPx,
    HEXRASTER_LEER,
    HEXRASTER_LAYER_ID,
    HEXRASTER_VORGABE,
    hexrasterKanten,
    hexrasterMeilen,
    rechenbereich,
} from "../src/map/hexraster";
import { applyDisplayDeviation, displayParams, readAddressDisplay } from "../src/map/display-state";
import { displayDefaults } from "../src/map/map-display";
import { buildPlaceStyle } from "../src/map/place-layers";
import { propertySpec } from "./style-spec";

/** Die Farbe des Hexrasters im ganzen Stil einer Ansicht. */
function hexFarbe(view: MapView, selection: LandscapeSelection): unknown {
    const stil = buildPlaceStyle({
        tileUrl: "/t/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        pathUrl: "/p/{z}/{x}/{y}",
        pathLabelUrl: "/pl/{z}/{x}/{y}",
        powerlineUrl: "/pw/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        waterUrl: "/tiles/vector/terrain_water_render/{z}/{x}/{y}",
        seriesId: "original",
        view,
        landscapeSelection: selection,
        display: { ...displayDefaults(view) },
        hexraster: HEXRASTER_LEER,
    } as never);
    const layer = stil.layers.find((l) => l.id === HEXRASTER_LAYER_ID);
    return layer?.type === "line" ? layer.paint?.["line-color"] : undefined;
}

const GARETH = { x: 551.625, y: 532.969 };
const UM_GARETH = { minX: GARETH.x - 20, minY: GARETH.y - 20, maxX: GARETH.x + 20, maxY: GARETH.y + 20 };
const KONTEXT = { view: DEFAULT_MAP_VIEW, layer: DEFAULT_LANDSCAPE_SELECTION, editor: false };

describe("Hexraster (WI-0273)", () => {
    it("rastet auf die Stufen des Reglers ein; was keine Zahl ist, wird die Vorgabe", () => {
        expect(hexrasterMeilen(10)).toBe(10);
        expect(hexrasterMeilen(7)).toBe(5);
        expect(hexrasterMeilen(1000)).toBe(100);
        expect(hexrasterMeilen(Number.NaN)).toBe(HEXRASTER_VORGABE);
        expect(hexrasterMeilen(0)).toBe(HEXRASTER_VORGABE);
    });

    it("legt Gareth in die Mitte eines Feldes, mit gleich langen Kanten", () => {
        const meilen = 10;
        const r = meilen / MEILEN_JE_EINHEIT / Math.sqrt(3);
        const kanten = hexrasterKanten(meilen, UM_GARETH);
        const links = kanten.find((zug) => Math.hypot(zug[0]!.x - (GARETH.x - r), zug[0]!.y - GARETH.y) < 1e-9);
        expect(links).toBeDefined();
        for (const zug of kanten) {
            for (let i = 1; i < zug.length; i += 1) {
                expect(Math.hypot(zug[i]!.x - zug[i - 1]!.x, zug[i]!.y - zug[i - 1]!.y)).toBeCloseTo(r, 9);
            }
        }
    });

    it("bleibt in der Karte und rechnet rund 15.000 Felder, auch ganz hinausgezoomt", () => {
        const karte = { minX: 0, minY: 0, maxX: 1024, maxY: 1024 };
        const bereich = rechenbereich(karte, GARETH, 1);
        const kanten = hexrasterKanten(1, bereich);
        // Die angeschnittenen Felder am Rand des Bereichs kommen zu den 15.000 dazu.
        expect(kanten.length).toBeLessThanOrEqual(16_000);
        expect(kanten.length).toBeGreaterThan(10_000);
        for (const punkt of kanten.flat()) {
            expect(punkt.x).toBeGreaterThanOrEqual(0);
            expect(punkt.y).toBeLessThanOrEqual(1024);
        }
    });

    it("blendet ein, wenn ein Feld auf dem Schirm groß genug wird", () => {
        const layer = buildHexrasterLayer();
        const compiled = createPropertyExpression(
            layer.paint?.["line-opacity"],
            "line-opacity",
            propertySpec("paint_line", "line-opacity"),
        );
        expect(compiled.result).toBe("success");
        if (compiled.result !== "success") return;
        const feature = { type: "LineString", properties: { px0: feldPx(10, 0) } } as never;
        // 10 Meilen messen bei Zoom 2 knapp 7 px (zu dicht), bei Zoom 5 rund 53 px (voll).
        expect(compiled.value.evaluate({ zoom: 2 }, feature)).toBe(0);
        expect(compiled.value.evaluate({ zoom: 5 }, feature)).toBeCloseTo(0.75, 9);
    });

    it("ist weiß über der Karte und dunkel in jeder Ebene der Derographie", () => {
        expect(hexFarbe("standard", "alle")).toBe(canonColour("mapHexGrid"));
        expect(hexFarbe("political", "alle")).toBe(canonColour("mapHexGrid"));
        for (const ebene of ["alle", "derographisch", "vegetation", "topographie", "klima", "sprachen"] as const) {
            expect(hexFarbe("landscapes", ebene), ebene).toBe(canonColour("text"));
        }
    });

    it("steht in der Adresse als Feldgröße und schließt das Gradnetz aus", () => {
        expect(displayParams({ hexraster: 25 })).toEqual([["hex", "25"]]);
        expect(readAddressDisplay("", "#hex=25").hexraster).toBe(25);
        expect(readAddressDisplay("?hex=7", "").hexraster).toBe(5);
        expect(readAddressDisplay("", "#hex=viel").hexraster).toBeUndefined();
        const beide = applyDisplayDeviation(KONTEXT, { gradnetz: true, hexraster: 20 });
        expect(beide.hexraster).toBe(20);
        expect(beide.gradnetz).toBe(false);
        expect(applyDisplayDeviation(KONTEXT, { gradnetz: true }).gradnetz).toBe(true);
    });
});
