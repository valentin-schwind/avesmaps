import { describe, expect, it } from "vitest";
import { Color, createExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "maplibre-gl";
import {
    AVENTURIA,
    canonColour,
    composeView,
    DEFAULT_LANDSCAPE_SELECTION,
    DESIGN_CANON,
    labelFamily,
    toRenderLngLat,
    type LandscapeSelection,
    type MapView,
    type SearchHit,
} from "@avesmaps3d/shared";
import {
    AREA_SELECTION_FILL_LAYER_ID,
    AREA_SELECTION_GLOW_LAYER_ID,
    AREA_SELECTION_LABEL_LAYER_ID,
    AREA_SELECTION_LABEL_SOURCE_ID,
    AREA_SELECTION_LINE_LAYER_ID,
    AREA_SELECTION_PATH_LAYER_ID,
    PATH_PREVIEW_LAYER_ID,
    areaLabel,
    pathSelectionWidth,
    areaNameFeatures,
    fallbackNameForm,
    selectionFromRenderedArea,
    selectionFromSearchHit,
    type AreaSelection,
    type DrawnArea,
} from "../src/map/area-selection.ts";
import { LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER } from "../src/map/landscape-layers.ts";
import { buildPlaceLayers, buildPlaceStyle, LABEL_FONT } from "../src/map/place-layers.ts";
import { EMPTY_ROUTE_LAYER, ROUTE_LINE_LAYER_ID, withRoute } from "../src/map/route-layers.ts";
import { asLayer, findLayer, propertySpec } from "./style-spec.ts";
import { landscapeRunLayerId, mapLabelLayerId } from "../src/map/landscape-layers.ts";

/**
 * Die gewählte Fläche (WI-0043): leuchtende Füllung, weicher Schein, klare Kontur und ihr Name.
 *
 * 🪤 Geprüft wird die WIRKUNG der Filter mit MapLibres eigenem Auswerter, nicht die Form der Ausdrücke:
 * welche Polygone leuchten, welche Namen weichen.
 */

const WEIDEN: AreaSelection = {
    kind: "landscape",
    id: "7ad2e9ae-0f55-4fc3-8b4e-6d6a5c9e427e",
    name: "Weiden",
    type: "region",
    anchor: { x: 480, y: 330 },
};

/** Punkt- und Kurvennamen der Derographie; seit WI-0135 je Landschaftsebene eigene Symbolebenen. */
const DEROGRAPHISCHE_NAMEN = [mapLabelLayerId("derographisch"), landscapeRunLayerId("derographisch")];

function layers(options: { area?: AreaSelection; view?: MapView; selection?: LandscapeSelection; labels?: boolean }) {
    return buildPlaceLayers({
        labels: options.labels ?? true,
        composition: composeView(options.view ?? "standard", options.selection ?? DEFAULT_LANDSCAPE_SELECTION),
        areaSelection: options.area,
    });
}

function ids(list: readonly LayerSpecification[]): string[] {
    return list.map((layer) => layer.id);
}

/**
 * Was ein Farbausdruck für ein Feature mit diesen Eigenschaften ergibt, als Hexwert des Kanons.
 *
 * 🪤 Geprüft wird die WIRKUNG mit MapLibres eigenem Auswerter, nicht die Form des Ausdrucks: welcher Name
 * golden wird und welcher seinen Ton behält.
 */
function evaluateColour(expression: unknown, properties: Record<string, unknown>, zoom = 4): string {
    const compiled = createExpression(expression, "text-color", propertySpec("paint_symbol", "text-color"));
    if (compiled.result !== "success") throw new Error("text-color übersetzt nicht");
    const value = compiled.value.evaluate({ zoom }, { type: 1, properties } as never) as Color;
    const [r, g, b] = value.rgb;
    const hex = (channel: number): string =>
        Math.round(channel * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Was ein Versalien-Ausdruck für ein Feature mit diesen Eigenschaften ergibt. */
function evaluateTransform(expression: unknown, properties: Record<string, unknown>, zoom = 4): string {
    const compiled = createExpression(expression, "text-transform", propertySpec("layout_symbol", "text-transform"));
    if (compiled.result !== "success") throw new Error("text-transform übersetzt nicht");
    return String(compiled.value.evaluate({ zoom }, { type: 1, properties } as never));
}

/** Lässt der Filter dieses Layers ein Feature mit diesen Eigenschaften durch? */
function passes(layer: LayerSpecification, properties: Record<string, unknown>, zoom = 4): boolean {
    const filter = "filter" in layer ? layer.filter : undefined;
    const compiled = featureFilter(filter as never, "filter");
    return compiled.filter({ zoom }, { type: 3, properties } as never, undefined as never);
}

const AREA_LAYERS = [AREA_SELECTION_FILL_LAYER_ID, AREA_SELECTION_GLOW_LAYER_ID, AREA_SELECTION_LINE_LAYER_ID];

describe("Die Fläche leuchtet über ihre Kennung (AC3)", () => {
    it("🔴 ohne Auswahl gibt es keine Ebene der Auswahl", () => {
        const ohne = ids(layers({}));
        for (const id of [...AREA_LAYERS, AREA_SELECTION_LABEL_LAYER_ID]) {
            expect(ohne, id).not.toContain(id);
        }
    });

    it("🔴 alle Teilflächen derselben Region leuchten, gleichnamige andere nicht", () => {
        const stil = layers({ area: WEIDEN });
        for (const id of AREA_LAYERS) {
            const layer = stil.find((entry) => entry.id === id);
            expect(layer, id).toBeDefined();
            expect(layer).toMatchObject({ source: LANDSCAPE_SOURCE_ID, "source-layer": LANDSCAPE_SOURCE_LAYER });
            // Zwei Polygone derselben Region: beide.
            expect(passes(layer!, { public_id: "a1", region_public_id: WEIDEN.id, name: "Weiden" }), id).toBe(true);
            expect(passes(layer!, { public_id: "a2", region_public_id: WEIDEN.id, name: "Weiden" }), id).toBe(true);
            // 💣 Dieselbe Bezeichnung, eine andere Region: Ein Name ist keine Identität.
            expect(passes(layer!, { public_id: "a3", region_public_id: "andere-region", name: "Weiden" }), id).toBe(
                false,
            );
        }
    });
});

describe("Die Auswahl ist ein Overlay, keine Ansicht (AC8)", () => {
    it.each([
        ["standard", "alle"],
        ["none", "alle"],
        ["powerlines", "alle"],
        ["landscapes", "alle"],
        ["landscapes", "vegetation"],
        ["landscapes", "klima"],
    ] as const)("🔴 %s/%s zeichnet Fläche, Schein, Kontur und Namen", (view, selection) => {
        const stil = ids(layers({ area: WEIDEN, view, selection }));
        for (const id of [...AREA_LAYERS, AREA_SELECTION_LABEL_LAYER_ID]) {
            expect(stil, `${view}/${selection}: ${id}`).toContain(id);
        }
    });

    it("🪤 eine Serie mit Namen im Bild bekommt die Fläche, aber keinen zweiten Namen", () => {
        const stil = ids(layers({ area: WEIDEN, labels: false }));
        expect(stil).toEqual(expect.arrayContaining(AREA_LAYERS));
        expect(stil).not.toContain(AREA_SELECTION_LABEL_LAYER_ID);
    });
});

describe("Die Reihenfolge: über den Flächen, unter Route, Orten und Namen", () => {
    it("🔴 liegt über Landschaftsflächen und Wegen, unter jedem Ort und jedem Namen", () => {
        const stil = layers({ area: WEIDEN, view: "landscapes" });
        const liste = ids(stil);
        const fill = liste.indexOf(AREA_SELECTION_FILL_LAYER_ID);
        const line = liste.indexOf(AREA_SELECTION_LINE_LAYER_ID);
        expect(liste.indexOf(AREA_SELECTION_GLOW_LAYER_ID)).toBe(fill + 1);
        expect(line).toBe(fill + 2);
        for (const [index, id] of liste.entries()) {
            if (id.startsWith("landscape-fill-") || id.startsWith("landscape-line-")) {
                expect(index, `${id} liegt unter der Auswahl`).toBeLessThan(fill);
            }
        }
        const standard = ids(layers({ area: WEIDEN }));
        const auswahl = standard.indexOf(AREA_SELECTION_FILL_LAYER_ID);
        // Die gezeichneten Wegebenen und ihre unsichtbaren Trefferflächen liegen unter der Auswahl; die VORSCHAU
        // darüber - sie zeigt, was ein Klick nähme, und darf nicht unter dem Gewählten verschwinden (WI-0090).
        for (const id of standard.filter(
            (entry) =>
                entry.startsWith("path-outline-") || entry.startsWith("path-center-") || entry.startsWith("path-hit-"),
        )) {
            expect(standard.indexOf(id), `${id} liegt unter der Auswahl`).toBeLessThan(auswahl);
        }
        expect(standard.indexOf(PATH_PREVIEW_LAYER_ID)).toBeGreaterThan(auswahl);
        for (const layer of layers({ area: WEIDEN }).filter(
            (entry) => entry.type === "symbol" || entry.type === "circle",
        )) {
            expect(standard.indexOf(layer.id), `${layer.id} liegt über der Auswahl`).toBeGreaterThan(
                standard.indexOf(AREA_SELECTION_LINE_LAYER_ID),
            );
        }
    });

    it("🔴 die Route liegt über der Fläche: Die Auswahl übermalt sie nicht", () => {
        const stil = withRoute(buildPlaceStyle(styleOptions(drawn(WEIDEN))), EMPTY_ROUTE_LAYER);
        const liste = ids(stil.layers);
        expect(liste.indexOf(ROUTE_LINE_LAYER_ID)).toBeGreaterThan(liste.indexOf(AREA_SELECTION_LINE_LAYER_ID));
    });

    it("der Name der Auswahl steht über allen Namen des Stils", () => {
        const liste = ids(layers({ area: WEIDEN }));
        expect(liste.at(-1)).toBe(AREA_SELECTION_LABEL_LAYER_ID);
    });
});

describe("Der Name der Auswahl (AC5, neu gefasst mit WI-0093)", () => {
    it("🔴 der gewöhnliche Name derselben Region BLEIBT stehen - er wechselt nur die Farbe", () => {
        const stil = layers({ area: WEIDEN });
        for (const id of DEROGRAPHISCHE_NAMEN) {
            const layer = findLayer(stil, id, "symbol");
            expect(layer, id).toBeDefined();
            const feature = (region: string | null) => ({
                region_public_id: region,
                region_layer: "derographisch",
                has_curve_run: false,
                label_min_zoom: 0,
                label_max_zoom: 8,
            });
            // 💣 Bis WI-0093 stand hier `false`: Die gewählte Region wurde herausgefiltert und von einer
            // eigenen Ebene ersetzt. Genau daran hing der Formsprung, den der Nutzertest gemeldet hat.
            expect(passes(layer!, feature(WEIDEN.id)), `${id}: Weiden`).toBe(true);
            expect(passes(layer!, feature("andere-region")), `${id}: Nachbar`).toBe(true);
            expect(passes(layer!, feature(null)), `${id}: frei`).toBe(true);
        }
    });

    it("🔴 gewählt ist golden, ungewählt nicht - und sonst ändert sich an der Farbe nichts", () => {
        const farbe = (stil: readonly LayerSpecification[], id: string, region: string | null) =>
            evaluateColour(asLayer(findLayer(stil, id, "symbol")!, "symbol").paint?.["text-color"], {
                region_public_id: region,
                label_type: "region",
            });
        const ohne = layers({});
        const mit = layers({ area: WEIDEN });
        for (const id of DEROGRAPHISCHE_NAMEN) {
            // Die gewählte Region: das Gold der Auswahl.
            expect(farbe(mit, id, WEIDEN.id), `${id}: gewählt`).toBe(canonColour("mapSelection"));
            // Jede andere behält den Ton ihres Labeltyps - genau denselben wie ganz ohne Auswahl.
            expect(farbe(mit, id, "andere-region"), `${id}: Nachbar`).toBe(farbe(ohne, id, "andere-region"));
            expect(farbe(mit, id, "andere-region")).not.toBe(canonColour("mapSelection"));
        }
    });

    it("🔴 alle Regionen EINER Landschaft leuchten zusammen (WI-0047)", () => {
        const gruppe = { ...WEIDEN, group: [WEIDEN.id, "zweite-region"] };
        const stil = layers({ area: gruppe });
        for (const id of DEROGRAPHISCHE_NAMEN) {
            for (const region of gruppe.group) {
                const farbe = evaluateColour(asLayer(findLayer(stil, id, "symbol")!, "symbol").paint?.["text-color"], {
                    region_public_id: region,
                    label_type: "region",
                });
                expect(farbe, `${id}: ${region}`).toBe(canonColour("mapSelection"));
            }
        }
    });

    it("🔴 der Ersatzname trägt dieselbe FORM wie der gewöhnliche - nur die Farbe ist anders", () => {
        const stil = layers({ area: WEIDEN });
        const ersatz = asLayer(
            stil.find((entry) => entry.id === AREA_SELECTION_LABEL_LAYER_ID)!,
            "symbol",
        );
        const gewoehnlich = asLayer(findLayer(stil, mapLabelLayerId("derographisch"), "symbol")!, "symbol");
        // 🔴 Größe, Sperrung und Versalien: derselbe AUSDRUCK, nicht nur zufällig derselbe Wert.
        for (const key of ["text-size", "text-letter-spacing", "text-transform"] as const) {
            expect(ersatz.layout?.[key], key).toEqual(gewoehnlich.layout?.[key]);
        }
        // 🔴 Der Saum ebenso - er ist ein Anteil derselben Größe.
        for (const key of ["text-halo-color", "text-halo-width", "text-halo-blur"] as const) {
            expect(ersatz.paint?.[key], key).toEqual(gewoehnlich.paint?.[key]);
        }
        // Und der eine Unterschied.
        expect(ersatz.paint?.["text-color"]).toBe(canonColour("mapSelection"));
        expect(ersatz.paint?.["text-color"]).not.toEqual(gewoehnlich.paint?.["text-color"]);
    });

    it("🪤 die Versalien kommen aus der Art der BESCHRIFTUNG, nicht aus der der Region", () => {
        const stil = layers({ area: { ...WEIDEN, type: "" } });
        const umformung = (labelType: string) =>
            evaluateTransform(
                asLayer(
                    stil.find((entry) => entry.id === AREA_SELECTION_LABEL_LAYER_ID)!,
                    "symbol",
                ).layout?.["text-transform"],
                { label_type: labelType },
            );
        // 💣 „Herz des Kontinents": label_type „region" trägt Versalien, die Art der REGION fehlt. Vorher
        // entschied die fehlende Regionsart - und der Name stand gewählt gemischt, ungewählt in Versalien.
        expect(umformung("region")).toBe("uppercase");
        expect(umformung("gebirge")).toBe("uppercase");
        expect(umformung("wald")).toBe("none");
        expect(umformung("")).toBe("none");
    });

    it("🔴 er steht, wo er steht, und verdrängt keinen anderen Namen", () => {
        const label = asLayer(
            layers({ area: WEIDEN }).find((entry) => entry.id === AREA_SELECTION_LABEL_LAYER_ID)!,
            "symbol",
        );
        expect(label.source).toBe(AREA_SELECTION_LABEL_SOURCE_ID);
        // 💣 Ohne `text-ignore-placement` könnte sein Erscheinen genau den Namen verdrängen, dessen Fehlen
        // ihn gerufen hat - und die Entscheidung flackerte bei jedem Bild.
        expect(label.layout?.["text-allow-overlap"]).toBe(true);
        expect(label.layout?.["text-ignore-placement"]).toBe(true);
        expect(label.layout?.["text-font"]).toEqual([LABEL_FONT]);
    });

    it("🔴 die Quelle im Stil ist LEER: was sie trägt, entscheidet die laufende Karte", () => {
        const stil = buildPlaceStyle(styleOptions(drawn(WEIDEN)));
        expect(stil.sources[AREA_SELECTION_LABEL_SOURCE_ID]).toEqual({
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    });

    it("der Ersatzname steht an seinem Anker und bringt die Form der Beschriftung mit", () => {
        const erwartet = toRenderLngLat(AVENTURIA.coordinateSpace, WEIDEN.anchor);
        expect(areaNameFeatures(drawn(WEIDEN), { labelSize: 18, labelType: "region" })).toEqual({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: { name: "Weiden", label_size: 18, label_type: "region" },
                    geometry: { type: "Point", coordinates: [erwartet.lng, erwartet.lat] },
                },
            ],
        });
        // Ohne Auswahl bleibt die Quelle leer; ohne bekannte Form gilt der Rückfall des Kanons.
        expect(areaNameFeatures(undefined, undefined)).toEqual({ type: "FeatureCollection", features: [] });
        expect(areaNameFeatures(drawn(WEIDEN), undefined).features[0]?.properties).toEqual({
            name: "Weiden",
            label_size: DESIGN_CANON.mapSelection.labelSize,
            label_type: WEIDEN.type,
        });
    });
});

describe("Farben, Deckkraft und Maße stehen im Kanon (AC9)", () => {
    it("🔴 jede Ebene liest ihren Wert aus dem Designkanon", () => {
        const stil = layers({ area: WEIDEN });
        const look = DESIGN_CANON.mapSelection;
        const fill = asLayer(
            stil.find((entry) => entry.id === AREA_SELECTION_FILL_LAYER_ID)!,
            "fill",
        );
        expect(fill.paint).toEqual({ "fill-color": canonColour("mapSelection"), "fill-opacity": look.fillOpacity });
        const glow = asLayer(
            stil.find((entry) => entry.id === AREA_SELECTION_GLOW_LAYER_ID)!,
            "line",
        );
        expect(glow.paint).toEqual({
            "line-color": canonColour("mapSelectionGlow"),
            "line-width": look.glowWidth,
            "line-blur": look.glowBlur,
        });
        const line = asLayer(
            stil.find((entry) => entry.id === AREA_SELECTION_LINE_LAYER_ID)!,
            "line",
        );
        expect(line.paint).toEqual({ "line-color": canonColour("mapSelection"), "line-width": look.lineWidth });
        const label = asLayer(
            stil.find((entry) => entry.id === AREA_SELECTION_LABEL_LAYER_ID)!,
            "symbol",
        );
        const familie = labelFamily("landscape");
        // 🔴 Die GRÖSSE steht seit WI-0093 nicht mehr im Kanon, sondern an der Beschriftung selbst
        // (`label_size`): „dieselbe Größe wie ungewählt" ist eine Regel, kein Wert. `mapSelection.labelSize`
        // trägt noch den Namen eines gewählten GEBIETS und ist der Rückfall, solange die Karte die
        // Beschriftung noch nicht gezeigt hat (`fallbackNameForm`).
        expect(label.layout?.["text-letter-spacing"]).toBe(familie.letterSpacing);
        expect(label.paint?.["text-color"]).toBe(canonColour("mapSelection"));
        expect(label.paint?.["text-halo-color"]).toBe(familie.haloColor);
        expect(fallbackNameForm(WEIDEN).labelSize).toBe(look.labelSize);
    });

    /**
     * 💣 Eine Linie auf einer Fläche zeichnet auch die Schnittkanten der Kachel mit. Die liegen nur den
     * Kachelpuffer weit außerhalb (Martin: 64 von 4096 bei 512-px-Kacheln, also 8 px). Reicht der halbe
     * Schein weiter, laufen Nähte quer über die gewählte Fläche - bei 22 px am Bild gesehen.
     */
    it("💣 Schein und Kontur bleiben im Kachelpuffer, sonst stehen Nähte auf der Fläche", () => {
        const PUFFER_PX = (64 / 4096) * 512;
        expect(DESIGN_CANON.mapSelection.glowWidth / 2).toBeLessThan(PUFFER_PX);
        expect(DESIGN_CANON.mapSelection.lineWidth / 2).toBeLessThan(PUFFER_PX);
    });

    it("💣 der ganze Stil bleibt gültig, mit und ohne Auswahl", () => {
        expect(validateStyleMin(buildPlaceStyle(styleOptions(drawn(WEIDEN))))).toEqual([]);
        expect(validateStyleMin(buildPlaceStyle(styleOptions(undefined)))).toEqual([]);
        expect(validateStyleMin(buildPlaceStyle({ ...styleOptions(drawn(WEIDEN)), view: "landscapes" }))).toEqual([]);
    });
});

describe("Woher eine Auswahl kommt", () => {
    const treffer = (extra: Partial<SearchHit>): SearchHit => ({
        kind: "landschaft",
        id: "label-weiden",
        name: "Weiden",
        subtype: "region",
        x: 480,
        y: 330,
        zoom: 4,
        ...extra,
    });

    it("🔴 ein Landschaftstreffer wählt seine REGION, nicht sein Label (AC1, AC3)", () => {
        expect(selectionFromSearchHit(treffer({ region: WEIDEN.id }))).toEqual(WEIDEN);
    });

    it("🔴 ein freies Label bleibt ein Sprungziel ohne Fläche (AC4)", () => {
        expect(selectionFromSearchHit(treffer({}))).toBeUndefined();
    });

    it("ein Ort und eine Klimazone wählen keine Fläche; ein Weg wählt sich als Weg (WI-0044)", () => {
        for (const kind of ["ort", "klima"] as const) {
            expect(selectionFromSearchHit(treffer({ kind, region: WEIDEN.id })), kind).toBeUndefined();
        }
        expect(selectionFromSearchHit(treffer({ kind: "weg", subtype: "Strasse" }))?.kind).toBe("path");
    });

    it("🔴 eine angeklickte Fläche wählt sich selbst, der Name steht, wo geklickt wurde (AC6)", () => {
        const klick = { x: 470, y: 340 };
        expect(
            selectionFromRenderedArea(
                { public_id: "a1", region_public_id: WEIDEN.id, name: "Weiden", region_type: "region" },
                klick,
            ),
        ).toEqual({ ...WEIDEN, anchor: klick });
    });

    it("🪤 eine Fläche mit Griff statt Namen heißt nach ihrer Art", () => {
        const wald = selectionFromRenderedArea(
            { region_public_id: "wald-925", name: "Wald-925", region_type: "wald" },
            { x: 1, y: 2 },
        );
        expect(wald?.name).toBeNull();
        expect(areaLabel(wald!, (type) => (type === "wald" ? "Wald" : "?"))).toBe("Wald");
        expect(areaLabel(WEIDEN, () => "?")).toBe("Weiden");
    });

    it("eine Fläche ohne Kennung wählt nichts", () => {
        expect(selectionFromRenderedArea({ name: "Irgendwas" }, { x: 1, y: 2 })).toBeUndefined();
    });
});

describe("Gleichnamige Regionen als EINE Landschaft (WI-0047, G1 A)", () => {
    const INSELN = ["insel-1", "insel-2", "insel-3"];
    const archipel = selectionFromSearchHit({
        kind: "landschaft",
        id: "insel-1",
        name: "Archipel der Perlen",
        subtype: "insel",
        x: 967,
        y: 585,
        zoom: 4,
        region: "insel-1",
        regions: INSELN,
    });

    it("🔴 der Treffer einer Gruppe wählt alle ihre Regionen", () => {
        expect(archipel).toMatchObject({ kind: "landscape", id: "insel-1", group: INSELN });
    });

    it("🔴 alle Teile leuchten, eine fremde Fläche nicht", () => {
        const stil = layers({ area: archipel! });
        for (const id of AREA_LAYERS) {
            const layer = stil.find((entry) => entry.id === id)!;
            for (const insel of INSELN) {
                expect(passes(layer, { region_public_id: insel }), `${id}: ${insel}`).toBe(true);
            }
            expect(passes(layer, { region_public_id: "andere-region" }), id).toBe(false);
        }
    });

    it("🔴 die Namen aller Teile werden golden - und bleiben stehen, wo sie stehen (WI-0093)", () => {
        const karte = findLayer(layers({ area: archipel! }), mapLabelLayerId("topographie"), "symbol")!;
        const name = (region: string) => ({
            region_public_id: region,
            region_layer: "topographie",
            label_type: "insel",
            has_curve_run: false,
            label_min_zoom: 0,
            label_max_zoom: 8,
        });
        for (const insel of INSELN) {
            // 💣 Bis WI-0093 wichen sie dem einen Namen der Auswahl. Ein Archipel verlor damit die Namen
            // ALLER seiner Inseln und bekam einen geraden Ersatz an einer Stelle.
            expect(passes(karte, name(insel)), insel).toBe(true);
            expect(evaluateColour(asLayer(karte, "symbol").paint?.["text-color"], name(insel)), insel).toBe(
                canonColour("mapSelection"),
            );
        }
        expect(passes(karte, name("andere-region"))).toBe(true);
        expect(evaluateColour(asLayer(karte, "symbol").paint?.["text-color"], name("andere-region"))).not.toBe(
            canonColour("mapSelection"),
        );
    });
});

function drawn(area: AreaSelection): DrawnArea {
    return { ...area, label: area.name ?? area.type };
}

function styleOptions(area: DrawnArea | undefined) {
    return {
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
        view: "standard" as MapView,
        landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
        areaSelection: area,
    };
}

describe("Ein Weg ist eine Auswahl (WI-0044): ganz, in Legacys Gold", () => {
    const REICHSSTRASSE: SearchHit = {
        kind: "weg",
        id: "name:Reichsstraße 2",
        name: "Reichsstraße 2",
        subtype: "Reichsstrasse",
        x: 500,
        y: 500,
        zoom: 5,
        bounds: [400, 450, 620, 540],
    };
    const WEG = selectionFromSearchHit(REICHSSTRASSE) as AreaSelection;

    it("🔴 ein Wegtreffer wählt den Weg über seinen Namen, nicht eine Fläche", () => {
        expect(WEG).toEqual({
            kind: "path",
            id: "name:Reichsstraße 2",
            name: "Reichsstraße 2",
            type: "Reichsstrasse",
            anchor: { x: 500, y: 500 },
        });
    });

    it("🔴 leuchtet auf JEDEM Abschnitt mit diesem Namen, über Wegtypen hinweg (WI-0177 Schritt 2b) - und nur dort", () => {
        const layer = findLayer(layers({ area: WEG }), AREA_SELECTION_PATH_LAYER_ID, "line");
        if (!layer) throw new Error("keine Markierung");
        expect(passes(layer, { name: "Reichsstraße 2", subtype: "Reichsstrasse", label_visible: false }, 3)).toBe(true);
        expect(passes(layer, { name: "Reichsstraße 3", subtype: "Reichsstrasse" }, 3)).toBe(false);
        expect(passes(layer, { name: "Reichsstraße 2", subtype: "Strasse" }, 3)).toBe(true);
        expect(passes(layer, { name: "Reichsstraße 2", subtype: "Pfad", mark: "karawanenroute" }, 3)).toBe(true);
    });

    it("🔴 Legacys Markierung: Gold der Auswahl, fast deckend, runde Enden, Breite je Wegart", () => {
        const layer = findLayer(layers({ area: WEG }), AREA_SELECTION_PATH_LAYER_ID, "line");
        if (!layer) throw new Error("keine Markierung");
        expect(layer.paint?.["line-color"]).toBe(canonColour("mapSelection"));
        expect(canonColour("mapSelection")).toBe("#ffd72e");
        expect(layer.paint?.["line-opacity"]).toBe(0.96);
        expect(layer.paint?.["line-width"]).toBe(12);
        expect(layer.layout?.["line-cap"]).toBe("round");
        expect(pathSelectionWidth("Flussweg")).toBe(13);
        expect(pathSelectionWidth("Seeweg")).toBe(13);
        expect(pathSelectionWidth("Weg")).toBe(DESIGN_CANON.mapSelection.pathWidth);
        expect(DESIGN_CANON.mapSelection.pathWidth).toBe(10);
    });

    it("über den Wegen, unter Route, Orten und Namen - und ohne eigenen Namen", () => {
        const liste = ids(layers({ area: WEG }));
        const markierung = liste.indexOf(AREA_SELECTION_PATH_LAYER_ID);
        expect(markierung).toBeGreaterThan(-1);
        // Die GEZEICHNETEN Wegebenen liegen darunter, dazu ihre unsichtbaren Trefferflächen (WI-0090).
        const wegebenen = liste.filter(
            (entry) =>
                entry.startsWith("path-outline-") || entry.startsWith("path-center-") || entry.startsWith("path-hit-"),
        );
        expect(wegebenen.length).toBeGreaterThan(0);
        for (const id of wegebenen) {
            expect(liste.indexOf(id), `${id} liegt unter der Markierung`).toBeLessThan(markierung);
        }
        // 🪤 Die VORSCHAU liegt darüber, wie jede andere Vorschau: Sie zeigt, was ein Klick NEHMEN würde, und darf
        // deshalb nicht unter dem verschwinden, was schon gewählt ist (`area-preview-*` steht ebenso oben).
        expect(liste.indexOf(PATH_PREVIEW_LAYER_ID)).toBeGreaterThan(markierung);
        for (const layer of layers({ area: WEG }).filter(
            (entry) => entry.type === "symbol" || entry.type === "circle",
        )) {
            expect(liste.indexOf(layer.id), `${layer.id} liegt über der Markierung`).toBeGreaterThan(markierung);
        }
        expect(liste).not.toContain(AREA_SELECTION_LABEL_LAYER_ID);
        expect(liste).not.toContain(AREA_SELECTION_FILL_LAYER_ID);
        const stil = withRoute(buildPlaceStyle(styleOptions(drawn(WEG))), EMPTY_ROUTE_LAYER);
        const reihe = stil.layers.map((layer) => layer.id);
        expect(reihe.indexOf(AREA_SELECTION_PATH_LAYER_ID)).toBeLessThan(reihe.indexOf(ROUTE_LINE_LAYER_ID));
        expect(validateStyleMin(buildPlaceStyle(styleOptions(drawn(WEG))))).toEqual([]);
    });
});
