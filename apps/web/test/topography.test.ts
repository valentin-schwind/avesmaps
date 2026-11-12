import { describe, expect, it } from "vitest";
import { composeView, DESIGN_CANON, type DisplayHeightPointer } from "@avesmaps3d/shared";
import {
    AREA_PREVIEW_OUTLINE_LAYER_ID,
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    AREA_SELECTION_FILL_LAYER_ID,
    AREA_SELECTION_OUTLINE_SOURCE_ID,
    buildPathPreviewLayer,
    buildAreaSelectionLayers,
    pathSelectionWidth,
} from "../src/map/area-selection.ts";
import {
    LAKE_FILL_LAYER_ID,
    WATER_FILL_LAYER_ID,
    WATER_LINE_LAYER_ID,
    WATER_SOURCE_ID,
} from "../src/map/landscape-layers.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";
import {
    CONTOUR_DETAIL_LAYER_ID,
    CONTOUR_DETAIL_SOURCE_ID,
    CONTOUR_LABEL_LAYER_ID,
    CONTOUR_LAYER_IDS,
    HEIGHT_TINT_LAYER_ID,
    HEIGHT_TINT_SOURCE_ID,
    heightTintColour,
    PEAK_LAYER_ID,
} from "../src/map/topography-layers.ts";
import { displayHeightFor } from "../src/map/terrain/display-height-pointer.ts";
import { formatViewState, parseViewState } from "../src/map/view-state.ts";

/**
 * Die Topographie der Landschaften (WI-0055): Höhenlinien, Höhenstufen und Gipfel. Geprüft wird, WAS welche
 * Ansicht zeigt (eine Stelle: `composeView`), WO die Ebenen im Stapel liegen (Stufen unter den Flächen,
 * Linien unter den Wegen, Zahlen ganz unten, Gipfel oben) und dass die Unterwahl im Link reist.
 */

const POINTER: DisplayHeightPointer = {
    schemaVersion: 1,
    revision: "cca6668ddc09",
    demRevision: "cce4be9fbe78",
};

function style(
    view: "standard" | "landscapes",
    selection: "alle" | "topographie" | "vegetation",
    topography?: "hoehenlinien" | "hoehenstufen",
    withPointer = true,
    seriesId = "original",
) {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        pathUrl: "/w/{z}/{x}/{y}",
        pathLabelUrl: "/wl/{z}/{x}/{y}",
        powerlineUrl: "/k/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        contourUrl: "/tiles/vector/terrain_contour_render/{z}/{x}/{y}",
        contourDetailUrl: "/tiles/vector/terrain_contour_detail_render/{z}/{x}/{y}",
        peakUrl: "/tiles/vector/terrain_peak_render/{z}/{x}/{y}",
        heightBandUrl: "/tiles/vector/terrain_height_band_render/{z}/{x}/{y}",
        waterUrl: "/tiles/vector/terrain_water_render/{z}/{x}/{y}",
        displayHeight: withPointer ? POINTER : undefined,
        basemap: undefined,
        seriesId,
        view,
        landscapeSelection: selection,
        topography,
        locale: "de",
    });
}

describe("Was welche Ansicht von der Topographie zeigt", () => {
    it.each(["hoehenlinien", "hoehenstufen"] as const)(
        "Old behält die Höhenzahlen in %s: sie sind nicht Teil der Rasterkarte",
        (topography) => {
            const layers = style("landscapes", "topographie", topography, true, "old").layers;
            expect(layers.some((layer) => layer.id === CONTOUR_LABEL_LAYER_ID)).toBe(true);
            expect(layers.some((layer) => layer.id === "path-label")).toBe(false);
        },
    );
    it("Höhenlinien nur in der Topographie, Höhenstufen nur in ihrer Unterwahl", () => {
        expect(composeView("landscapes", "topographie")).toMatchObject({
            contours: true,
            heightTints: false,
            peaks: "heights",
        });
        expect(composeView("landscapes", "topographie", "hoehenstufen")).toMatchObject({
            contours: true,
            heightTints: true,
        });
        // Die Unterwahl wirkt nur bei der Topographie: in „Alle“ gibt es weder Linien noch Stufen.
        expect(composeView("landscapes", "alle", "hoehenstufen")).toMatchObject({
            contours: false,
            heightTints: false,
        });
    });

    it("Gipfel wie Legacy: Standard und Landschaften (Alle, Topographie, Derographie), mit Höhe nur in der Topographie", () => {
        expect(composeView("standard", "alle").peaks).toBe("names");
        expect(composeView("landscapes", "alle").peaks).toBe("names");
        expect(composeView("landscapes", "derographisch").peaks).toBe("names");
        expect(composeView("landscapes", "topographie").peaks).toBe("heights");
        expect(composeView("landscapes", "vegetation").peaks).toBe("none");
        expect(composeView("landscapes", "klima").peaks).toBe("none");
        expect(composeView("none", "alle").peaks).toBe("none");
        expect(composeView("powerlines", "alle").peaks).toBe("none");
    });
});

describe("Wo die Ebenen im Stapel liegen", () => {
    const ids = (s: ReturnType<typeof style>): string[] => s.layers.map((layer) => layer.id);

    it("Höhenstufen unten, darüber nur das geglättete Wasser; Linien über dem Wasser und unter den Wegen", () => {
        const s = style("landscapes", "topographie", "hoehenstufen");
        const order = ids(s);
        const tint = order.indexOf(HEIGHT_TINT_LAYER_ID);
        expect(tint).toBeGreaterThanOrEqual(0);
        // Die Höhe färbt das Land: keine Landschaftsflächen, auch kein ungeglätteter See.
        expect(order.filter((id) => id.startsWith("landscape-fill-") || id.startsWith("landscape-line-"))).toEqual([]);
        expect(order).not.toContain(LAKE_FILL_LAYER_ID);
        expect(order.indexOf(WATER_FILL_LAYER_ID)).toBeGreaterThan(tint);
        // Ohne Anzeige-Menü zeigt die Landschaftsansicht keine Wege; dann gilt die erste Beschriftung als Deckel.
        const firstPath = order.findIndex((id) => id.startsWith("path-"));
        const deckel = firstPath >= 0 ? firstPath : s.layers.findIndex((layer) => layer.type === "symbol");
        for (const id of CONTOUR_LAYER_IDS) {
            expect(order.indexOf(id)).toBeGreaterThan(order.indexOf(WATER_LINE_LAYER_ID));
            expect(order.indexOf(id)).toBeLessThan(deckel);
        }
        expect(s.sources[HEIGHT_TINT_SOURCE_ID]).toMatchObject({
            type: "vector",
            tiles: ["/tiles/vector/terrain_height_band_render/{z}/{x}/{y}"],
        });
    });

    it("in den Höhenlinien Seen und Meer aus der geglätteten Quelle, die übrigen Flächen wie gewohnt", () => {
        const s = style("landscapes", "topographie", "hoehenlinien");
        const order = ids(s);
        expect(s.sources[WATER_SOURCE_ID]).toMatchObject({ tiles: ["/tiles/vector/terrain_water_render/{z}/{x}/{y}"] });
        const fill = s.layers.find((layer) => layer.id === "landscape-fill-topographie") as { filter: unknown };
        expect(JSON.stringify(fill.filter)).toContain('["!",["in",["get","region_type"],["literal",["see","meer"]]]]');
        expect(order).not.toContain(LAKE_FILL_LAYER_ID);
        expect(order.indexOf(WATER_FILL_LAYER_ID)).toBeGreaterThan(order.indexOf("landscape-line-topographie"));
        // Auch außerhalb der Topographie kommt der See aus dieser Quelle (Betreiber 2026-10-04); Ausführliches in
        // `lake-smooth.test.ts`. Dort bleibt das Meer eine Landschaftsfläche, hier gehört es der Quelle.
        const alle = style("landscapes", "alle");
        expect(alle.sources).toHaveProperty(WATER_SOURCE_ID);
        expect(ids(alle)).not.toContain(LAKE_FILL_LAYER_ID);
        expect(ids(alle)).toContain(WATER_FILL_LAYER_ID);
    });

    it("🔴 die Hunderter im Gebirge kommen aus eigener Quelle, erst aus der Nähe und ohne Zahlen", () => {
        // Betreiber 2026-09-28: „manchmal enden so höhenlinien“. Sie setzen die Hunderter des Flachlands fort; von
        // weitem fragt die Karte ihre Kacheln gar nicht an (Quelle mit minzoom).
        const s = style("landscapes", "topographie", "hoehenlinien");
        const detailMin = DESIGN_CANON.topography.contour.detailMinZoom;
        expect(s.sources[CONTOUR_DETAIL_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/vector/terrain_contour_detail_render/{z}/{x}/{y}"],
            minzoom: Math.floor(detailMin),
        });
        const detail = s.layers.find((layer) => layer.id === CONTOUR_DETAIL_LAYER_ID) as {
            minzoom: number;
            paint: unknown;
        };
        const fein = s.layers.find((layer) => layer.id === CONTOUR_LAYER_IDS[0]) as { paint: unknown };
        expect(detail.minzoom).toBe(detailMin);
        expect(detail.paint).toEqual(fein.paint);
        const zahlen = s.layers.find((layer) => layer.id === CONTOUR_LABEL_LAYER_ID) as { source: string };
        expect(zahlen.source).not.toBe(CONTOUR_DETAIL_SOURCE_ID);
    });

    it("die Zahlen liegen ganz unten im Symbolstapel, die Gipfel über allen Landschaftsnamen", () => {
        const s = style("landscapes", "topographie");
        const symbols = s.layers.filter((layer) => layer.type === "symbol").map((layer) => layer.id);
        expect(symbols[0]).toBe(CONTOUR_LABEL_LAYER_ID);
        // Über JEDER Ebene der Landschaftsnamen (WI-0135: je Landschaftsebene eigene).
        const namen = symbols.filter((id) => id.startsWith("map-label") || id.startsWith("landscape-label-run"));
        expect(namen.length).toBeGreaterThan(0);
        for (const id of namen) expect(symbols.indexOf(PEAK_LAYER_ID), id).toBeGreaterThan(symbols.indexOf(id));
    });

    it("🔴 ohne gültigen Zeiger weder Linien noch Stufen (5.32a, Regel 2); in Höhenlinien keine Stufen", () => {
        // Hardening-Review M4: Vorher zeigte die Karte nach einem neuen Gelände still die alten Linien. Der Zeiger
        // fehlt, wenn nichts abgeleitet ist oder die Revision zu einem älteren Gelände gehört.
        const ohne = style("landscapes", "topographie", "hoehenstufen", false);
        expect(ids(ohne)).not.toContain(HEIGHT_TINT_LAYER_ID);
        expect(ids(ohne).filter((id) => id.startsWith("hoehenlinie"))).toEqual([]);
        expect(ohne.sources).not.toHaveProperty(CONTOUR_DETAIL_SOURCE_ID);
        expect(ids(style("landscapes", "topographie", "hoehenlinien"))).not.toContain(HEIGHT_TINT_LAYER_ID);
        expect(ids(style("landscapes", "topographie", "hoehenlinien"))).toContain(CONTOUR_LAYER_IDS[2]);
    });

    it("Standard: Gipfel ohne Höhe, keine Linien; Vegetation: nichts davon", () => {
        const standard = style("standard", "alle");
        expect(ids(standard)).toContain(PEAK_LAYER_ID);
        expect(ids(standard)).not.toContain(CONTOUR_LAYER_IDS[0]);
        const gipfel = standard.layers.find((layer) => layer.id === PEAK_LAYER_ID) as {
            layout: Record<string, unknown>;
        };
        // „Auf der Karte anzeigen“ aus nimmt nur den Text (WI-0271 §18); das Zeichen hängt nicht daran, und eine verborgene Landmarke trägt ihren Namen wie jede andere.
        expect(gipfel.layout["text-field"]).toEqual(["case", ["==", ["get", "show_name"], false], "", ["get", "name"]]);
        expect(JSON.stringify(gipfel.layout["icon-image"])).not.toContain("show_name");
        const vegetation = style("landscapes", "vegetation");
        expect(ids(vegetation).filter((id) => id.startsWith("hoehen") || id === PEAK_LAYER_ID)).toEqual([]);
        expect(vegetation.sources).not.toHaveProperty("gipfel");
        expect(vegetation.sources).not.toHaveProperty("hoehenlinien");
    });

    it("in der Topographie steht die Höhe unter dem Namen, aber nur, wo sie bekannt ist", () => {
        const s = style("landscapes", "topographie");
        const gipfel = s.layers.find((layer) => layer.id === PEAK_LAYER_ID) as { layout: Record<string, unknown> };
        const text = JSON.stringify(gipfel.layout["text-field"]);
        expect(text).toContain('["has","height"]');
        expect(text).toContain("number-format");
    });
});

describe("Anklicken in der Topographie", () => {
    // Betreiber 2026-09-28: „obwohl flüsse und seen zu den topographischen features gehören, kann ich sie noch
    // nicht anklicken und selektieren wie die andern topographischen flächen“.
    const ids = (s: ReturnType<typeof style>): string[] => s.layers.map((layer) => layer.id);

    it("🔴 in den Höhenstufen liest keine Ebene die Landschaftskacheln: Vorschau und Auswahl kommen vom Server", () => {
        // WI-0058 (Betreiber 2026-09-28: „nur bei Bedarf“): Dort färbt die Höhe das Land, und die Kacheln (443 KB
        // in der Übersicht) luden nur fürs Anklicken.
        const stufen = style("landscapes", "topographie", "hoehenstufen");
        expect(stufen.layers.filter((layer) => "source" in layer && layer.source === "landscapes")).toEqual([]);
        expect(ids(stufen)).toContain(AREA_PREVIEW_OUTLINE_LAYER_ID);
        expect(stufen.sources[AREA_PREVIEW_OUTLINE_SOURCE_ID]).toMatchObject({ type: "geojson" });
        // In den Höhenlinien zeichnen die Landflächen selbst: Die Vorschau liest ihre Form aus den Kacheln (WI-0266) - und steht doch in
        // beiden Unterwahlen als dieselbe eine Ebene an derselben kleinen Quelle, nie als Ebene an einer Kachelquelle.
        const hoehenlinien = style("landscapes", "topographie", "hoehenlinien");
        expect(ids(hoehenlinien)).toContain(AREA_PREVIEW_OUTLINE_LAYER_ID);
        for (const s of [stufen, hoehenlinien]) {
            const vorschau = s.layers.filter((layer) => layer.id.startsWith("area-preview"));
            expect(
                vorschau.map((layer) => layer.id),
                "genau eine Vorschau-Ebene der Flächen",
            ).toEqual([AREA_PREVIEW_OUTLINE_LAYER_ID]);
            for (const layer of vorschau) {
                expect(s.sources[(layer as { source: string }).source]).toMatchObject({ type: "geojson" });
            }
        }
    });

    it("die Auswahl in den Höhenstufen leuchtet aus dem Umriss vom Server", () => {
        const gebirge = {
            kind: "landscape" as const,
            id: "g",
            name: "Rote Sichel",
            type: "gebirge",
            anchor: { x: 1, y: 1 },
        };
        const layers = buildAreaSelectionLayers(gebirge, { water: true, outline: true }) as {
            source: string;
            filter?: unknown;
        }[];
        expect(layers.map((layer) => layer.source)).toEqual(
            Array(layers.length).fill(AREA_SELECTION_OUTLINE_SOURCE_ID),
        );
        expect(layers.every((layer) => layer.filter === undefined)).toBe(true);
    });

    it("ein gewählter See leuchtet in der Topographie in seiner geglätteten Form, sonst wie bisher", () => {
        const see = { kind: "landscape" as const, id: "s", name: "Waldsee", type: "see", anchor: { x: 1, y: 1 } };
        const fill = (water: boolean) =>
            buildAreaSelectionLayers(see, { water }).find((layer) => layer.id === AREA_SELECTION_FILL_LAYER_ID) as {
                source: string;
            };
        expect(fill(true).source).toBe(WATER_SOURCE_ID);
        expect(fill(false).source).toBe("landscapes");
        const gebirge = buildAreaSelectionLayers({ ...see, type: "gebirge" }, { water: true })[0] as { source: string };
        expect(gebirge.source).toBe("landscapes");
    });
});

describe("Die Farben der Höhenstufen", () => {
    it("je Stufe die Kanonfarbe der Legende, gestapelt von unten nach oben", () => {
        const colour = heightTintColour() as unknown[];
        expect(colour.slice(0, 2)).toEqual(["match", ["get", "step"]]);
        DESIGN_CANON.topography.heightSteps.forEach((_, step) => {
            expect(colour[colour.indexOf(step, 2) + 1]).toBe(DESIGN_CANON.colour[`mapHeight${String(step)}`]);
        });
        const tint = style("landscapes", "topographie", "hoehenstufen").layers.find(
            (layer) => layer.id === HEIGHT_TINT_LAYER_ID,
        ) as { type: string; layout: Record<string, unknown> };
        expect(tint.type).toBe("fill");
        expect(tint.layout["fill-sort-key"]).toEqual(["get", "step"]);
    });
});

describe("Die Unterwahl im Link", () => {
    const base = {
        center: { x: 500, y: 500 },
        zoom: 6,
        series: "original",
        view: "landscapes" as const,
        landscape: "topographie" as const,
    };

    it("steht nur in der Adresse, wenn sie nicht die Vorgabe ist", () => {
        expect(formatViewState({ ...base, topography: "hoehenlinien" })).not.toContain("topo=");
        expect(formatViewState({ ...base, topography: "hoehenstufen" })).toContain("topo=hoehenstufen");
    });

    it("liest sie zurück und übergeht Unbekanntes, ohne den Link zu verwerfen", () => {
        const hash = formatViewState({ ...base, topography: "hoehenstufen" });
        expect(parseViewState(hash, ["original"])?.topography).toBe("hoehenstufen");
        const unknown = parseViewState(`${hash.replace("hoehenstufen", "farbig")}`, ["original"]);
        expect(unknown?.landscape).toBe("topographie");
        expect(unknown?.topography).toBeUndefined();
    });
});

describe("Vorschau eines Wegs (WI-0090; davor nur des Flusses)", () => {
    it("🔴 strichelt die Kontur links und rechts, nicht den Lauf selbst, außen so breit wie die Auswahl", () => {
        // Betreiber 2026-09-28 für den Fluss: „kannst du bei flüssen die kontur - nicht den pfad - gelb stricheln“.
        const layer = buildPathPreviewLayer() as { paint: Record<string, unknown> };
        const look = DESIGN_CANON.mapSelection;
        expect(layer.paint["line-width"]).toBe(look.lineWidth);
        expect(layer.paint["line-dasharray"]).toBeDefined();
        // Der Abstand ist jetzt ein Ausdruck über die Wegart, keine einzelne Zahl: ["match", ["get","subtype"], …].
        const gap = layer.paint["line-gap-width"] as unknown[];
        expect(gap[0]).toBe("match");
        expect(gap[1]).toEqual(["get", "subtype"]);
    });

    it("🔴 jede Wegart umfasst GENAU ihr Auswahlband - der Fluss breiter als der Pfad, aus demselben Kanonwert", () => {
        const gap = (buildPathPreviewLayer() as { paint: Record<string, unknown> }).paint[
            "line-gap-width"
        ] as unknown[];
        const look = DESIGN_CANON.mapSelection;
        // Die benannten Arten stehen als Paare ab Index 2, der Vorgabefall zuletzt.
        const paare = gap.slice(2, -1);
        const vorgabe = gap[gap.length - 1] as number;
        expect(paare.length).toBeGreaterThan(0);
        for (let i = 0; i < paare.length; i += 2) {
            const art = paare[i] as string;
            const abstand = paare[i + 1] as number;
            expect(abstand + 2 * look.lineWidth, art).toBe(pathSelectionWidth(art));
        }
        // Reichsstraße und Fluss leuchten breiter als die Vorgabe, also stehen ihre Striche weiter auseinander.
        expect(paare).toContain("Reichsstrasse");
        expect(paare).toContain("Flussweg");
        expect(vorgabe + 2 * look.lineWidth).toBe(pathSelectionWidth("Weg"));
        expect(vorgabe).toBeLessThan(paare[(paare.indexOf("Flussweg") as number) + 1] as number);
    });
});

describe("Anzeigehöhen am Gelände", () => {
    it("🔴 gelten nur zum Gelände, das die Karte zeigt; ohne gelesenes Gelände gilt die Prüfung des Servers", () => {
        const gelaende = {
            schemaVersion: 1 as const,
            revision: "cce4be9fbe78",
            tileSize: 512,
            maxNativeZoom: 3,
            encoding: "mapbox" as const,
        };
        expect(displayHeightFor(POINTER, gelaende)).toBe(POINTER);
        expect(displayHeightFor(POINTER, { ...gelaende, revision: "000000000001" })).toBeUndefined();
        expect(displayHeightFor(POINTER, undefined)).toBe(POINTER);
        expect(displayHeightFor(undefined, gelaende)).toBeUndefined();
    });
});
