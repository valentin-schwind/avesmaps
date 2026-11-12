import { describe, expect, it } from "vitest";
import { createPropertyExpression, featureFilter } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_POWERLINE_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    composeView,
    POINTS_TO_PIXELS,
    renderZoomForBand,
    type MapView,
} from "@avesmaps3d/shared";
import {
    buildPlaceLayers,
    buildPlaceStyle,
    leyKnotenRadius,
    leyKnotenRadiusBei,
    NODIX_LABEL_LAYER_IDS,
    nodixLabelLayerId,
    PLACE_CLASSES_BY_RANK,
} from "../src/map/place-layers.ts";
import {
    LEY_NODE_LAYER_IDS,
    magiersichtPaint,
    NODIX_HIT_LAYER_ID,
    POWERLINE_HIT_LAYER_ID,
    POWERLINE_HIT_WIDTH,
} from "../src/map/powerline-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Die Kraftlinien-Ansicht (WI-0025).
 *
 * 🔴 Geprüft wird, WAS eine Ansicht zeichnet, nicht nur, ob ein Layer existiert: die Kraftlinien
 * gehören allein in ihre eigene Ansicht, und nur dort ist der Untergrund entsättigt.
 */

/** Der Wert einer Eigenschaft im gebauten Layer (paint oder layout). */
function wert(gruppe: unknown, eigenschaft: string): unknown {
    return (gruppe as Record<string, unknown> | undefined)?.[eigenschaft];
}

function ids(view: MapView): string[] {
    return buildPlaceLayers({ labels: true, composition: composeView(view, "alle") }).map((layer) => layer.id);
}

describe("Kraftlinien-Ansicht", () => {
    it("🔴 zeichnet die drei Leuchtlagen, die Nodices und die Namen über dem Untergrund - und sonst nichts", () => {
        expect(ids("powerlines").filter((id) => id !== "background")).toEqual([
            "basemap",
            "powerline-aura",
            "powerline-mitte",
            "powerline-kern",
            // Die unsichtbare Trefferfläche (WI-0063 P8): Rückfall für den Klick, wo die Bögen nicht gezeichnet sind.
            "powerline-hit",
            // Die Trefferfläche der Knoten (Betreiber 2026-10-11): Ein Klick trifft einen Nodix, auch wenn die Bögen ihn zeichnen.
            NODIX_HIT_LAYER_ID,
            // Die Nodices über den Linien, wie Legacys Orts-Pane über den Kraftlinien (WI-0025).
            "nodix-schein",
            "nodix-hof",
            "nodix-ring",
            "nodix-kern",
            "powerline-label",
            // Die Namen der Nodices je Klasse und Seite (WI-0135), die wichtigste Klasse und rechts zuoberst.
            ...[...PLACE_CLASSES_BY_RANK]
                .reverse()
                .flatMap((klasse) => [nodixLabelLayerId(klasse, "left"), nodixLabelLayerId(klasse, "right")]),
        ]);
    });

    it("🔴 keine andere Ansicht zeigt Kraftlinien - Legacy nimmt sie dort ganz von der Karte", () => {
        for (const view of ["none", "standard", "landscapes"] as const) {
            expect(
                ids(view).filter((id) => id.startsWith("powerline")),
                view,
            ).toEqual([]);
        }
    });

    it("die Leuchtlagen tragen Legacys Strich, Deckkraft und Bildschirmbreite", () => {
        const layers = buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") });
        for (const [id, strich, deckkraft, breite] of [
            ["powerline-aura", "rgba(255, 70, 90, 0.42)", 0.34, 10],
            ["powerline-mitte", "rgba(255, 105, 130, 0.82)", 0.72, 4.6],
            ["powerline-kern", "rgba(255, 235, 240, 1)", 0.98, 1.5],
        ] as const) {
            const layer = findLayer(layers, id, "line");
            expect(wert(layer?.paint, "line-color"), id).toBe(strich);
            expect(wert(layer?.paint, "line-opacity"), id).toBe(deckkraft);
            expect(wert(layer?.paint, "line-width"), id).toBe(breite);
        }
    });

    it("🪤 die Namen: 10 px über der Linie, ab Legacys Stufe 2 = unsere 3, nur wo Legacy sie zeigt", () => {
        const layers = buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") });
        const label = findLayer(layers, "powerline-label", "symbol");
        const { sizePx, offsetPx } = AVENTURIA_POWERLINE_CARTOGRAPHY.label;
        expect(label?.minzoom).toBe(renderZoomForBand(2));
        expect(label?.minzoom).toBe(3);
        expect(wert(label?.layout, "text-size")).toBe(18);
        expect(wert(label?.layout, "text-offset")).toEqual([0, -offsetPx / sizePx]);
        expect(wert(label?.paint, "text-color")).toBe("rgba(255, 196, 214, 0.98)");
        // Fehlt Legacys `show_label`, bleibt der Name aus - nur ein ausdrückliches Ja zeigt ihn.
        const compiled = featureFilter(label?.filter, "filter");
        const zeigt = (properties: Record<string, unknown>): boolean =>
            compiled.filter({ zoom: 4 }, { type: 2, properties } as never, undefined as never);
        expect(zeigt({ name: "Arkane Achse", label_visible: true })).toBe(true);
        expect(zeigt({ name: "Arkane Achse", label_visible: false })).toBe(false);
    });

    it("🔴 BEWUSSTE ABWEICHUNG: der Name wiederholt sich entlang der Linie und weicht aus (Betreiber 2026-09-23)", () => {
        // Legacy setzt ihn einmal in die Abschnittsmitte, ohne Kollision. Beim Hineinzoomen wandert die
        // Mitte aus dem Bild, und die sichtbare Linie steht namenlos da („ein bisschen komisch“).
        const label = findLayer(
            buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") }),
            "powerline-label",
            "symbol",
        );
        expect(wert(label?.layout, "symbol-placement")).toBe("line");
        expect(wert(label?.layout, "symbol-spacing")).toBe(AVENTURIA_POWERLINE_CARTOGRAPHY.label.repeatPx);
        expect(AVENTURIA_POWERLINE_CARTOGRAPHY.label.repeatPx).toBe(600);
        expect(wert(label?.layout, "text-allow-overlap")).toBe(false);
        expect(wert(label?.layout, "text-ignore-placement")).toBeUndefined();
    });

    it("💣 der Schein bleibt im Rand der Glyphen: kein grauer Kasten hinter den Buchstaben", () => {
        // Bei 18 px trägt der Glyphenrand gut 2 px (3 px bei 24 px). Hier stand 2,52 + 2,52, und auf
        // hellem Grund stand hinter jedem Buchstaben ein Kasten (2026-09-23).
        const label = findLayer(
            buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") }),
            "powerline-label",
            "symbol",
        );
        const saum = wert(label?.paint, "text-halo-width") as number;
        const weich = wert(label?.paint, "text-halo-blur") as number;
        expect(saum + weich).toBeLessThan((3 * 18) / 24);
        expect(saum).toBeGreaterThan(0);
    });

    it("💣 entsättigt den Untergrund NUR in der Kraftlinien-Ansicht, mit Legacys 0,6 s in beide Richtungen", () => {
        const basemapPaint = (view: MapView): unknown => {
            const composition = { ...composeView(view, "alle"), basemap: true };
            return findLayer(buildPlaceLayers({ labels: true, composition }), "basemap", "raster")?.paint;
        };
        // CSS saturate(0.1) = 10 % Farbe; MapLibre −0,9 = 90 % Grau. CSS brightness(0.6) = max 0,6.
        expect(wert(basemapPaint("powerlines"), "raster-saturation")).toBeCloseTo(-0.9, 12);
        expect(wert(basemapPaint("powerlines"), "raster-brightness-max")).toBe(0.6);
        expect(wert(basemapPaint("standard"), "raster-saturation")).toBe(0);
        expect(wert(basemapPaint("standard"), "raster-brightness-max")).toBe(1);
        // Der Übergang steht in JEDER Ansicht, sonst spränge der Rückweg ohne Übergang zurück.
        expect(magiersichtPaint(false)["raster-saturation-transition"]).toEqual({ duration: 600, delay: 0 });
        expect(wert(basemapPaint("standard"), "raster-saturation-transition")).toEqual({
            duration: 600,
            delay: 0,
        });
    });

    it("die Quellen: Linien und Namen aus derselben Sicht, die Knoten aus ihrer eigenen (0040)", () => {
        const style = buildPlaceStyle({
            tileUrl: "/t/place",
            landscapeUrl: "/t/landscape",
            landscapeRunUrl: "/t/run",
            mapLabelUrl: "/t/label",
            climateUrl: "/t/climate",
            pathUrl: "/t/path",
            pathLabelUrl: "/t/path-label",
            powerlineUrl: "/tiles/vector/powerline_render/{z}/{x}/{y}",
            leyNodeUrl: "/tiles/vector/ley_node_render/{z}/{x}/{y}",
            basemap: undefined,
            seriesId: "original",
            view: "powerlines",
            landscapeSelection: "alle",
        });
        expect(style.sources["powerlines"]).toMatchObject({ tiles: ["/tiles/vector/powerline_render/{z}/{x}/{y}"] });
        expect(Object.keys(style.sources).filter((id) => id.startsWith("powerline"))).toEqual(["powerlines"]);
        const quellen = style.layers
            .filter((layer) => layer.id.startsWith("powerline"))
            .map((layer) => ("source" in layer ? layer.source : undefined));
        expect(quellen).toEqual(["powerlines", "powerlines", "powerlines", "powerlines", "powerlines"]);
        expect(style.sources["ley-nodes"]).toMatchObject({ tiles: ["/tiles/vector/ley_node_render/{z}/{x}/{y}"] });
        const knoten = style.layers
            .filter((layer) => layer.id.startsWith("nodix-"))
            .map((layer) => ("source-layer" in layer ? layer["source-layer"] : undefined));
        expect(new Set(knoten)).toEqual(new Set(["ley_node_render"]));
    });

    it("🔴 die Kraftlinien sind anklickbar (WI-0063 P8): eine unsichtbare Trefferfläche von Legacys 22 px, nur in ihrer Ansicht", () => {
        const layers = buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") });
        const hit = findLayer(layers, POWERLINE_HIT_LAYER_ID, "line");
        // Unsichtbar, aber abfragbar: MapLibre prüft Treffer gegen die Breite, nicht gegen die Deckkraft (wie `route-hit`).
        expect(wert(hit?.paint, "line-opacity")).toBe(0);
        expect(wert(hit?.paint, "line-width")).toBe(22);
        expect(POWERLINE_HIT_WIDTH).toEqual({ touch: 28, pointer: 22 });
        // Sie liest dieselbe Kachel wie die Linien und trägt `public_id` und `name` für den Treffer.
        expect(hit).toMatchObject({ source: "powerlines", "source-layer": "powerline_render" });
        // Mit den Bögen bleibt sie stehen (Rückfall, sobald sie scheitern), die sichtbaren Lagen entfallen.
        const mitBoegen = buildPlaceLayers({
            labels: true,
            composition: composeView("powerlines", "alle"),
            powerlineArcs: true,
        }).map((layer) => layer.id);
        expect(mitBoegen).toContain(POWERLINE_HIT_LAYER_ID);
        // In jeder anderen Ansicht gibt es keine Kraftlinien und damit keine Trefferfläche.
        for (const view of ["none", "standard", "landscapes", "political"] as const) {
            expect(ids(view), view).not.toContain(POWERLINE_HIT_LAYER_ID);
        }
    });

    it("🔴 zeichnen die Bögen, entfallen die flachen Leuchtlagen - sonst stünde jede Linie doppelt", () => {
        const composition = composeView("powerlines", "alle");
        const mitBoegen = buildPlaceLayers({ labels: true, composition, powerlineArcs: true }).map((layer) => layer.id);
        expect(mitBoegen.filter((id) => ["powerline-aura", "powerline-mitte", "powerline-kern"].includes(id))).toEqual(
            [],
        );
        // Die Namen bleiben; flach stehen die Namen aus den Kacheln. Die Knoten zeichnen die Bögen als glühende Punkte
        // (Betreiber 2026-10-11): Von den Scheiben bleibt nur die Trefferfläche, ohne sie wären die Nodices nicht anklickbar.
        expect(mitBoegen).toEqual(
            expect.arrayContaining(["powerline-label", NODIX_HIT_LAYER_ID, ...NODIX_LABEL_LAYER_IDS]),
        );
        expect(mitBoegen.filter((id) => (LEY_NODE_LAYER_IDS as readonly string[]).includes(id))).toEqual([]);
        const treffer = findLayer(
            buildPlaceLayers({ labels: true, composition, powerlineArcs: true }),
            NODIX_HIT_LAYER_ID,
            "circle",
        );
        expect(wert(treffer?.paint, "circle-opacity"), "unsichtbar").toBe(0);
        // Ohne Angabe bleibt der Rückfall stehen: die drei statischen Lagen.
        const ohne = buildPlaceLayers({ labels: true, composition }).map((layer) => layer.id);
        expect(ohne).toEqual(expect.arrayContaining(["powerline-aura", "powerline-mitte", "powerline-kern"]));
    });
});

describe("Nodices in der Kraftlinien-Ansicht (Legacy „Ley-Knoten“)", () => {
    const layers = buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") });

    function laesstDurch(id: string, properties: Record<string, unknown>, zoom = 3): boolean {
        const layer = layers.find((entry) => entry.id === id) as { filter?: unknown } | undefined;
        const compiled = featureFilter(layer?.filter as never, "filter");
        return compiled.filter({ zoom }, { type: 1, properties } as never, undefined as never);
    }

    function kreisRadius(id: string, subtype: string, zoom: number): number {
        const layer = findLayer(layers, id, "circle");
        const compiled = createPropertyExpression(
            wert(layer?.paint, "circle-radius"),
            "circle-radius",
            propertySpec("paint_circle", "circle-radius"),
        );
        if (compiled.result !== "success") {
            throw new Error(`${id}: kein gültiger Ausdruck`);
        }
        return compiled.value.evaluate({ zoom }, { type: "Point", properties: { subtype } } as never) as number;
    }

    it("🔴 jeder Knoten der Knotenquelle, gleich welcher Klasse und Art - ein verborgener ohne Namen", () => {
        // Welche Punkte Knoten sind, entscheidet die Sicht ley_node_render (0040): Nodix-Orte und
        // -Labels und jedes Linienende.
        expect(laesstDurch("nodix-hof", { subtype: "dorf", node_kind: "place" }), "Knoten: Dorf").toBe(true);
        expect(laesstDurch("nodix-hof", { subtype: "stadt", node_kind: "label" }), "Knoten: Label").toBe(true);
        const dorf = nodixLabelLayerId("dorf", "right");
        const stadt = nodixLabelLayerId("stadt", "right");
        expect(laesstDurch(dorf, { subtype: "dorf", node_kind: "place", name: "Gareth" }), "Name: Dorf").toBe(true);
        expect(laesstDurch(stadt, { subtype: "stadt", node_kind: "label", name: "Pentagramm" }), "Name: Label").toBe(
            true,
        );
        // Ein Kraftlinienpunkt ohne Namen bekommt keine Namensebene (und damit keine leere Sperrfläche).
        expect(laesstDurch(dorf, { subtype: "dorf", node_kind: "nodix" }), "Punkt ohne Namen").toBe(false);
        // WI-0080: Der Knoten ist eine Markierung und wird gezeichnet, sein Name nicht. Vorher fiel beides weg.
        // OPS-068: Für Besucher erst im Band „Verborgene Orte“ (Band 8, MapLibre-Zoom 9) - wie die Marke des Orts in der Standardkarte.
        expect(
            laesstDurch("nodix-hof", { subtype: "stadt", is_hidden: true }),
            "Knoten eines verborgenen Orts, fern",
        ).toBe(false);
        expect(
            laesstDurch("nodix-hof", { subtype: "stadt", is_hidden: true }, renderZoomForBand(8)),
            "Knoten eines verborgenen Orts, Band 8",
        ).toBe(true);
        expect(
            laesstDurch(stadt, { subtype: "stadt", is_hidden: true, name: "X" }),
            "Name eines verborgenen Orts",
        ).toBe(false);
    });

    it("💣 ein Dorf-Nodix hat auch im Überblick einen Knoten - unterhalb des Bandes gilt die erste Zelle", () => {
        // Das Dorf erscheint als Ort erst ab Band 4; als Nodix muss es auf JEDER Stufe stehen.
        const ley = AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten;
        const ueberblick = kreisRadius("nodix-hof", "dorf", renderZoomForBand(0));
        expect(ueberblick).toBeGreaterThanOrEqual(ley.minRadiusPx);
        expect(kreisRadius("nodix-ring", "dorf", renderZoomForBand(0))).toBeCloseTo(ueberblick * ley.ringShare, 6);
        // Der Knoten ist größer als der Ortsmarker derselben Klasse (Faktor 1,7).
        const band = 6;
        const d = AVENTURIA_ZOOM_BANDS.marker["stadt"]?.[band] as number;
        expect(kreisRadius("nodix-hof", "stadt", renderZoomForBand(band))).toBeGreaterThan(d / 2);
    });

    it("🔴 die glühenden Knoten der Bögen sind so groß wie die Knotenebenen: `leyKnotenRadiusBei` rechnet wie MapLibre", () => {
        let geprueft = 0;
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            for (let zoom = 0; zoom <= 10; zoom += 0.25) {
                expect(leyKnotenRadiusBei(klasse, zoom), `${klasse} z${String(zoom)}`).toBeCloseTo(
                    kreisRadius("nodix-hof", klasse, zoom),
                    9,
                );
                geprueft += 1;
            }
        }
        expect(geprueft).toBe(PLACE_CLASSES_BY_RANK.length * 41);
    });

    it("die Namen der Nodices stehen unterhalb ihres Bandes in 8 pt (Legacy)", () => {
        const label = findLayer(layers, nodixLabelLayerId("dorf", "right"), "symbol");
        const compiled = createPropertyExpression(
            wert(label?.layout, "text-size"),
            "text-size",
            propertySpec("layout_symbol", "text-size"),
        );
        if (compiled.result !== "success") {
            throw new Error("Namen der Nodices: kein gültiger Ausdruck");
        }
        const groesse = compiled.value.evaluate({ zoom: renderZoomForBand(0) }, {
            type: "Point",
            properties: { subtype: "dorf" },
        } as never) as number;
        const faktor = POINTS_TO_PIXELS * (AVENTURIA_ZOOM_BANDS.calibration?.label ?? 1);
        expect(groesse).toBeCloseTo(AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten.nameBelowBandPt * faktor, 6);
    });

    /**
     * WI-0135, Betreiber 2026-10-11: „zieh die nodices abstände nach“. Der Name steht stufenlos am Rand des KNOTENS, nicht
     * des Ortsmarkers: Der Knoten ist 1,7-mal so groß, am Ortsmarker gemessen ragte der Name in ihn hinein.
     */
    it("🔴 der Name steht stufenlos Knotenradius plus Namensspalt vom Mittelpunkt, rechts wie links", () => {
        const namensspalt = AVENTURIA_ZOOM_BANDS.spacing["namensspalt"] ?? 0;
        const kontur = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
        const versatz = (id: string) => {
            const compiled = createPropertyExpression(
                wert(findLayer(layers, id, "symbol")?.paint, "text-translate"),
                "text-translate",
                propertySpec("paint_symbol", "text-translate"),
            );
            if (compiled.result !== "success") {
                throw new Error(`${id}: text-translate ungültig`);
            }
            return (zoom: number): [number, number] => compiled.value.evaluate({ zoom }) as [number, number];
        };
        let geprueft = 0;
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = versatz(nodixLabelLayerId(klasse, "right"));
            const links = versatz(nodixLabelLayerId(klasse, "left"));
            for (let zoom = 1; zoom <= 9.5; zoom += 0.125) {
                const soll = kreisRadius("nodix-hof", klasse, zoom) + namensspalt;
                expect(rechts(zoom)[0], `${klasse} z${zoom}`).toBeCloseTo(soll, 6);
                expect(links(zoom)[0], `${klasse} z${zoom}`).toBeCloseTo(-soll, 6);
                geprueft += 1;
            }
            // Auf dem höchsten Band reicht der Knoten weiter als der Ortsmarker derselben Klasse.
            const d = AVENTURIA_ZOOM_BANDS.marker[klasse]?.[8] as number;
            expect(leyKnotenRadius(d, kontur), klasse).toBeGreaterThan(d / 2);
        }
        expect(geprueft).toBeGreaterThan(400);
    });
});
