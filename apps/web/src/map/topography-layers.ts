import type {
    ExpressionSpecification,
    FillLayerSpecification,
    FilterSpecification,
    LayerSpecification,
    LineLayerSpecification,
    SourceSpecification,
    SymbolLayerSpecification,
} from "maplibre-gl";
import { canonColour, DESIGN_CANON, labelFamily, type PeakLabels, VECTOR_TILE_MAX_ZOOM } from "@avesmaps3d/shared";
import { landmarkenBild } from "./landmarken-zeichen";
import { ebenenGrenzen, spannenBedingungen } from "./zoombaender-stand";

/** Die Zeilen der Zoombänder je Höhenstufe (`level` 0, 1, 2 der Kacheln; WI-0221). */
const HOEHEN_ZEILEN = ["hoehen100", "hoehen500", "hoehen1000"] as const;

/**
 * Eine Ebene nur zwischen zwei Zoomgrenzen zeigen, in einem Layout-Wert (`icon-image`, `text-field`): `leer` außerhalb. Für zwei
 * Spuren in EINER Symbolebene (Gipfel: Zeichen und Name), deren Spannen verschieden sein dürfen.
 */
function zwischen(
    grenzen: { minzoom?: number; maxzoom?: number },
    ebene: { minzoom?: number; maxzoom?: number },
    wert: unknown,
    leer: unknown,
): unknown {
    // Nur die Grenzen, die enger sind als die der Ebene: Gleiche Spannen lassen den Wert, wie er war.
    const minzoom = (grenzen.minzoom ?? 0) > (ebene.minzoom ?? 0) ? grenzen.minzoom : undefined;
    const maxzoom =
        grenzen.maxzoom !== undefined && (ebene.maxzoom === undefined || grenzen.maxzoom < ebene.maxzoom)
            ? grenzen.maxzoom
            : undefined;
    if (minzoom === undefined && maxzoom === undefined) return wert;
    return [
        "step",
        ["zoom"],
        minzoom === undefined ? wert : leer,
        ...(minzoom === undefined ? [] : [minzoom, wert]),
        ...(maxzoom === undefined ? [] : [maxzoom, leer]),
    ];
}

/**
 * Die Topographie der Landschaften (WI-0055, Betreiber 2026-09-28, Blätter 1–3): Höhenlinien, Höhenstufen
 * und die Gipfel mit Dreieck.
 *
 * - **Höhenlinien** kommen als Vektorkacheln über Martin (`terrain_contour_tile`, je Zoom nur die sichtbaren
 *   Stufen, vereinfacht), abgeleitet aus den Anzeigehöhen: 1.000 dick, 500 dünn, 100 fein, im Gebirge erst aus
 *   der Nähe (`terrain_contour_detail_tile`), entlang der Linie beschriftet.
 * - **Höhenstufen** sind Flächen aus Martin (`terrain_height_band_tile`): je Stufe die Fläche über ihrer
 *   Schwelle, begrenzt von denselben Linien, von unten nach oben gestapelt. Farbe und Linie decken sich in
 *   jedem Zoom (Betreiber 2026-09-28: keine „ungenauen farbumfüllungen“; vorher `color-relief` über
 *   Höhenkacheln von 0,25 E, bei Zoom 8 rund 30 Bildpunkte je Kachelpixel).
 * - **Gipfel und Vulkane** wie Legacy (V10): heller Name, schwarzer Saum, darunter ein helles Dreieck.
 *
 * 🔴 Nur Anzeige: Die Anzeigehöhen sind keine Rechengrundlage (ADR-0011, Nachtrag WI-0055).
 * Welche Ansicht was zeigt, entscheidet `composeView` (`contours`, `heightTints`, `peaks`), nicht diese Datei.
 */

export const CONTOUR_SOURCE_ID = "hoehenlinien";
export const CONTOUR_SOURCE_LAYER = "terrain_contour_render";
export const CONTOUR_DETAIL_SOURCE_ID = "hoehenlinien-gebirge";
export const CONTOUR_DETAIL_SOURCE_LAYER = "terrain_contour_detail_render";
export const CONTOUR_DETAIL_LAYER_ID = "hoehenlinie-100-gebirge";
export const PEAK_SOURCE_ID = "gipfel";
export const PEAK_SOURCE_LAYER = "terrain_peak_render";
export const HEIGHT_TINT_SOURCE_ID = "hoehenstufen";
export const HEIGHT_TINT_SOURCE_LAYER = "terrain_height_band_render";
export const HEIGHT_TINT_LAYER_ID = "hoehenstufen";
export const CONTOUR_LAYER_IDS = ["hoehenlinie-100", "hoehenlinie-500", "hoehenlinie-1000"] as const;
export const CONTOUR_LABEL_LAYER_ID = "hoehenlinie-zahl";
export const PEAK_LAYER_ID = "gipfel";
/** Das Plättchen „ungefähre Lage“ an einer Landmarke (WI-0271 §17), wie am Ort (WI-0267). */
export const PEAK_APPROXIMATE_LAYER_ID = "gipfel-ungefaehr";
export const PEAK_TRIANGLE_IMAGE_ID = "gipfel-dreieck";

const TOPO = DESIGN_CANON.topography;
/** Die Schriftgröße, für die das Dreieck gezeichnet wird; `icon-size` skaliert es mit dem Namen. */
const DREIECK_BEZUG = 16;

export function buildContourSource(url: string): SourceSpecification {
    return { type: "vector", tiles: [url], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Die Hunderter im Gebirge, eigene Quelle: Unter `detailMinZoom` fragt die Karte ihre Kacheln gar nicht erst
 * an. Sie sind die Fortsetzung der Hunderter aus dem Flachland (dieselbe Linie, an der Gebirgsgrenze geteilt).
 */
export function buildContourDetailSource(url: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [url],
        minzoom: Math.floor(TOPO.contour.detailMinZoom),
        maxzoom: VECTOR_TILE_MAX_ZOOM,
    };
}

export function buildPeakSource(url: string): SourceSpecification {
    return { type: "vector", tiles: [url], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

export function buildHeightTintSource(url: string): SourceSpecification {
    return { type: "vector", tiles: [url], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/** Die Farbe je Stufe: `colour.mapHeight<step>` des Kanons. */
export function heightTintColour(): ExpressionSpecification {
    const pairs = TOPO.heightSteps.flatMap((_, step) => [step, canonColour(`mapHeight${String(step)}`)]);
    return ["match", ["get", "step"], ...pairs, canonColour("mapHeight0")] as unknown as ExpressionSpecification;
}

/**
 * Die Höhenstufen: jede Stufe über der vorigen (`fill-sort-key`). 🪤 Ohne Kantenglättung: Die Flächen sind in
 * Stücke geteilt (ST_Subdivide), und geglättete Kanten zeigten deren Nähte als feine Linien. Die sichtbaren
 * Ränder trägt die Höhenlinie darüber.
 */
export function buildHeightTintLayer(): FillLayerSpecification {
    return {
        id: HEIGHT_TINT_LAYER_ID,
        type: "fill",
        source: HEIGHT_TINT_SOURCE_ID,
        "source-layer": HEIGHT_TINT_SOURCE_LAYER,
        layout: { "fill-sort-key": ["get", "step"] },
        paint: { "fill-color": heightTintColour(), "fill-antialias": false },
    };
}

/** Eine Größe, die mit dem Zoom linear von `low` bei zoomRange[0] auf `high` bei zoomRange[1] wächst. */
function overZoom(range: readonly [number, number], low: number, high: number): ExpressionSpecification {
    return ["interpolate", ["linear"], ["zoom"], range[0], low, range[1], high];
}

export function buildContourLayers(): LineLayerSpecification[] {
    const c = TOPO.contour;
    return CONTOUR_LAYER_IDS.map((id, level) => ({
        id,
        type: "line",
        source: CONTOUR_SOURCE_ID,
        "source-layer": CONTOUR_SOURCE_LAYER,
        // Das Zoomband der Höhenstufe (WI-0221); Vorgabe ist der Kanon. Früher als die Kacheln zeigt es nichts (sie liefern die Linie
        // erst ab ihrem Band), das sagt der Reiter.
        ...ebenenGrenzen(`gelaende.${HOEHEN_ZEILEN[level] ?? "hoehen100"}.linie`, c.minZoom[level] as number),
        filter: ["==", ["get", "level"], level],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
            "line-color": canonColour("mapContour"),
            "line-opacity": c.opacity[level] as number,
            "line-width": overZoom(c.zoomRange, c.widthLow[level] as number, c.widthHigh[level] as number),
        },
    }));
}

/**
 * Die Zahlen an den Linien, entlang der Linie. Sie liegen GANZ UNTEN im Symbolstapel (unter den Wegnamen):
 * MapLibre setzt von oben nach unten, und eine Höhenzahl weicht jedem Namen.
 */
export function buildContourLabelLayer(font: string, locale: string): SymbolLayerSpecification {
    const c = TOPO.contour;
    const family = labelFamily("contour");
    const size = overZoom(c.labelZoom, c.labelSize[0], c.labelSize[1]);
    const halo = (ratio: number): ExpressionSpecification =>
        overZoom(c.labelZoom, c.labelSize[0] * ratio, c.labelSize[1] * ratio);
    return {
        id: CONTOUR_LABEL_LAYER_ID,
        type: "symbol",
        source: CONTOUR_SOURCE_ID,
        "source-layer": CONTOUR_SOURCE_LAYER,
        // Je Höhenstufe das Zoomband „Zahl“ (WI-0221); Vorgabe ist der Kanon.
        filter: [
            "any",
            ...[2, 1, 0].map((level) => zahlFilter(level, c.labelMinZoom[level] as number)),
        ] as ExpressionSpecification,
        layout: {
            "symbol-placement": "line",
            "symbol-spacing": c.labelSpacing,
            "text-max-angle": 30,
            "text-field": ["number-format", ["get", "ele"], { locale }],
            "text-font": [font],
            "text-size": size,
            "text-letter-spacing": family.letterSpacing,
            "text-rotation-alignment": "map",
            "text-pitch-alignment": "viewport",
        },
        paint: {
            "text-color": family.color,
            "text-halo-color": family.haloColor,
            "text-halo-width": halo(family.haloWidthRatio),
            "text-halo-blur": halo(family.haloBlurRatio),
        },
    };
}

/** Die Zahlen einer Höhenstufe zwischen den Grenzen ihres Zoombands. */
function zahlFilter(level: number, kanonAb: number): unknown {
    const { minzoom, maxzoom } = ebenenGrenzen(`gelaende.${HOEHEN_ZEILEN[level] ?? "hoehen100"}.zahl`, kanonAb);
    return [
        "all",
        ["==", ["get", "level"], level],
        ...(minzoom === undefined ? [] : [[">=", ["zoom"], minzoom]]),
        ...(maxzoom === undefined ? [] : [["<", ["zoom"], maxzoom]]),
    ];
}

/** Die Stützstellen der Gipfelschrift, jede Größe mit `factor` multipliziert. */
function peakStops(factor: number): ExpressionSpecification {
    return [
        "interpolate",
        ["linear"],
        ["zoom"],
        ...TOPO.peak.sizeStops.flatMap(([zoom, size]) => [zoom, size * factor]),
    ] as ExpressionSpecification;
}

/**
 * Gipfel und Vulkane (V10). In der Topographie mit Höhenzahl als zweiter Zeile (Betreiber 2026-09-28);
 * ohne bekannte Höhe steht nur der Name (WI-0049: lieber keine Zahl als eine erfundene).
 *
 * 🔴 Das Dreieck sitzt AUF dem Gipfel, der Name steht darüber (Betreiber 2026-09-28: „dass das dreieck bei
 * der gipfel beschreibung immer am punkt des gipfels ist“). Bewusst anders als Legacy, wo die Mitte der
 * Schrift auf dem Punkt liegt und das Dreieck darunter hängt: So zeigt das Zeichen, wo der Berg steht,
 * auch mit zweizeiligem Namen und in 3D.
 *
 * 🔴 Legacy nagelt sie fest (Kollisionsrolle „fest“, Owner 02.09.2026): Sie stehen im Symbolstapel ganz
 * oben und werden zuerst gesetzt; Orts- und Landschaftsnamen weichen ihnen.
 *
 * **Landmarken** (WI-0271 L5): dieselbe Ebene für jede Art der Tabelle; das Zeichen nach der Art (`landmarkenBild`, Laufzeitbilder in
 * `landmarken-zeichen.ts`), seit 2026-11-01 auch der Berggipfel (Vali: „Gleich groß“). Die Höhenzeile und die Folge nach Höhe gelten von selbst nur für Berg und Vulkan:
 * Nur sie tragen eine Höhe (CHECK `terrain_peak_hoehe_nur_gelaende`, Migration 0276). Die Zoombänder sind die des Gipfels; eigene
 * (`gelaende.landmarke.*`) sind gemeldet, nicht gebaut (`regler-meldeliste.md`).
 */
export function buildPeakLayer(
    font: string,
    mode: Exclude<PeakLabels, "none">,
    locale: string,
    /** Stehen verborgene Landmarken auf jeder Stufe (Editor-Modus)? Wie `hiddenPlacesAlways` der Orte. */
    verborgeneImmer = false,
): SymbolLayerSpecification {
    const peak = TOPO.peak;
    const family = labelFamily("peak");
    const name: ExpressionSpecification = ["get", "name"];
    const text: ExpressionSpecification =
        mode === "heights"
            ? [
                  "case",
                  ["has", "height"],
                  [
                      "format",
                      name,
                      {},
                      "\n",
                      {},
                      ["number-format", ["get", "height"], { locale }],
                      { "font-scale": peak.heightScale },
                  ],
                  name,
              ]
            : name;
    // Der Text endet über dem Dreieck: halbe Dreieckshöhe plus Luft, in em der Schrift.
    const lift = peak.triangleHeight / 2 + peak.triangleGap;
    // Zeichen und Name haben je ein Zoomband (WI-0221). Die Ebene reicht über beide; wo eines endet, bleibt sein Wert leer.
    const zeichen = ebenenGrenzen("gelaende.gipfel.zeichen", peak.minZoom);
    const beschriftung = ebenenGrenzen("gelaende.gipfel.name", peak.minZoom);
    const unten = Math.min(zeichen.minzoom ?? 0, beschriftung.minzoom ?? 0);
    const oben =
        zeichen.maxzoom === undefined || beschriftung.maxzoom === undefined
            ? undefined
            : Math.max(zeichen.maxzoom, beschriftung.maxzoom);
    const ebene = { ...(unten > 0 ? { minzoom: unten } : {}), ...(oben === undefined ? {} : { maxzoom: oben }) };
    const filter = verborgenImBand(verborgeneImmer);
    return {
        id: PEAK_LAYER_ID,
        type: "symbol",
        source: PEAK_SOURCE_ID,
        "source-layer": PEAK_SOURCE_LAYER,
        ...ebene,
        ...(filter === undefined ? {} : { filter }),
        layout: {
            "text-field": zwischen(
                beschriftung,
                ebene,
                // „Auf der Karte anzeigen“ aus nimmt nur den Text, das Zeichen bleibt (WI-0271 §18; Vali 2026-11-04). Eine verborgene Landmarke folgt derselben Regel, nur erst im Band (`verborgenImBand`).
                ["case", OHNE_BESCHRIFTUNG, "", text],
                "",
            ) as ExpressionSpecification,
            "text-font": [font],
            "text-size": peakStops(1),
            "text-letter-spacing": family.letterSpacing,
            "text-anchor": "bottom",
            "text-offset": ["literal", [0, -lift]],
            "icon-image": zwischen(
                zeichen,
                ebene,
                landmarkenBild(PEAK_TRIANGLE_IMAGE_ID),
                "",
            ) as ExpressionSpecification,
            "icon-anchor": "center",
            "icon-size": peakStops(1 / DREIECK_BEZUG),
            "symbol-sort-key": ["-", 0, ["coalesce", ["get", "height"], 0]],
        },
        paint: {
            "text-color": family.color,
            "text-halo-color": family.haloColor,
            "text-halo-width": peakStops(family.haloWidthRatio),
            "text-halo-blur": peakStops(family.haloBlurRatio),
        },
    };
}

/** Das Plättchen „ungefähre Lage“ neben dem Zeichen einer Landmarke; es steht, wo das Zeichen steht, und verrät keine verborgene früher. */
export function buildPeakApproximateLayer(bild: string, verborgeneImmer = false): SymbolLayerSpecification {
    const zeichen = ebenenGrenzen("gelaende.gipfel.zeichen", TOPO.peak.minZoom);
    const imBand = verborgenImBand(verborgeneImmer);
    const ungefaehr = ["==", ["get", "is_approximate"], true];
    return {
        id: PEAK_APPROXIMATE_LAYER_ID,
        type: "symbol",
        source: PEAK_SOURCE_ID,
        "source-layer": PEAK_SOURCE_LAYER,
        ...(zeichen.minzoom === undefined ? {} : { minzoom: zeichen.minzoom }),
        ...(zeichen.maxzoom === undefined ? {} : { maxzoom: zeichen.maxzoom }),
        filter: (imBand === undefined ? ungefaehr : ["all", ungefaehr, imBand]) as FilterSpecification,
        layout: {
            "icon-image": bild,
            "icon-offset": ["literal", [6, -6]],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
    };
}

const VERBORGENE_LANDMARKE: ExpressionSpecification = ["==", ["get", "is_hidden"], true];
/** Eine Kachel von vor 0310 trägt `show_name` nicht: Dann steht der Name, wie bisher. */
const OHNE_BESCHRIFTUNG: ExpressionSpecification = ["==", ["get", "show_name"], false];

/**
 * Eine verborgene Landmarke erst im Band „Verborgene Orte“ (OPS-068, dieselbe Spur wie am Ort, Vorgabe Zoom 8), Zeichen und Name zusammen: Sonst fände man sie aus großer Entfernung. `undefined`, wo nichts einschränkt.
 */
function verborgenImBand(immer: boolean): FilterSpecification | undefined {
    const grenzen = spannenBedingungen("orte.verborgen.zeichen");
    if (immer || grenzen.length === 0) return undefined;
    return ["any", ["!", VERBORGENE_LANDMARKE], ["all", ...grenzen]] as unknown as FilterSpecification;
}

/**
 * Wie oft der weiche Schein gezeichnet wird. Ein einzelner Durchgang eines Canvas-Schattens verteilt seine
 * Masse so dünn, dass neben dem kräftigen Saum des Namens nichts übrig bleibt; Legacy verdichtet denselben
 * Schein über `glowPasses` und nimmt dafür 3, wo er tragen muss (`map-features-labels.js#L422`).
 */
const SCHEIN_PAESSE = 3;

/**
 * Das Gipfeldreieck als Laufzeitbild (wie die Strömungspfeile, `path-layers.ts`): Spitze oben, in der Farbe
 * des Namens und mit DEM SAUM DES NAMENS. Gezeichnet für eine Schrift von `DREIECK_BEZUG` px; `icon-size`
 * skaliert es mit dem Namen.
 *
 * ⭐ Der Saum ist zweiteilig wie am Text (Design Guide §20, „Der Saum ist zweiteilig und wird leicht falsch
 * übertragen“): eine **scharfe Kontur** und darunter ein **weiter, diffuser Schein niedriger Dichte** — hier
 * aus denselben zwei Verhältnissen der Familie, die `buildPeakLayer` dem Namen als `text-halo-width` und
 * `text-halo-blur` gibt. Eine Regel, keine zweite Zahlenreihe fürs Dreieck.
 *
 * 💣 Vorher hing unter dem Dreieck ein **versetzter Schlagschatten** (deckendes Schwarz, 1 px nach unten,
 * 1 px Unschärfe). Unter der waagerechten Grundlinie wird daraus kein Schatten, sondern ein harter dunkler
 * Balken über die ganze Breite: gemessen am 2026-10-05 bis Alpha 202 von 255, über `mapHeight4` 136 Luminanz-
 * stufen dunkler als der Hintergrund — während die beiden Schrägen gar keinen dunklen Rand trugen und das
 * helle Dreieck auf der weißen Stufe über 5.000 Schritt nichts hatte, woran es sich hält. Das war die „dunkle
 * Kante“ (Betreiber 2026-10-05: „machs hübsch :)“).
 *
 * 🪤 Abweichung von Legacy, bewusst: Legacy zeichnet genau diesen versetzten Schatten
 * (`map-features-labels.js#L344-L348`, `rgba(0,0,0,0.9)`), der Balken steht dort ebenso. Wir nehmen
 * stattdessen Legacys **eigene Saumregel für Labels**, die es beim Dreieck nie angewandt hat: „erst die
 * scharfe KONTUR trägt ihn auch auf den HELLEN Labelarten“, und ein einzelner Durchgang des Scheins
 * verschwindet daneben — am Bild entschieden, 01.09.2026 (`map-features-labels.js#L403-L412`).
 */
export function drawPeakTriangleImage(pixelRatio = 2): ImageData {
    const peak = TOPO.peak;
    const family = labelFamily("peak");
    const breite = 2 * peak.triangleHalfWidth * DREIECK_BEZUG * pixelRatio;
    const hoehe = peak.triangleHeight * DREIECK_BEZUG * pixelRatio;
    // 🪤 `text-halo-width` misst nach AUSSEN, ein Canvas-Strich liegt MITTIG auf der Linie und reicht nur zur
    // Hälfte hinaus. Also die doppelte Strichbreite, damit außen genauso viel steht wie am Namen.
    const kontur = 2 * family.haloWidthRatio * DREIECK_BEZUG * pixelRatio;
    const schein = family.haloBlurRatio * DREIECK_BEZUG * pixelRatio;
    // Platz für den ganzen Saum: halbe Kontur nach außen, dazu die Reichweite des Scheins (Canvas streut mit
    // Sigma = Unschärfe/2, sichtbar bis 3 Sigma). Ein abgeschnittener Schein wäre wieder eine harte Kante.
    const rand = Math.ceil(kontur / 2 + 1.5 * schein) + 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(breite + 2 * rand);
    canvas.height = Math.ceil(hoehe + 2 * rand);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Gipfeldreieck: kein 2D-Kontext");
    }
    // 🪤 Die Spitze steht über der MITTE DER GRUNDLINIE, nicht über der Mitte des aufgerundeten Bildes: sonst
    // steht das Dreieck um den Rundungsrest schief (vorher bis zu einem halben Gerätepixel).
    const mitteX = rand + breite / 2;
    const pfad = (): void => {
        ctx.beginPath();
        ctx.moveTo(mitteX, rand);
        ctx.lineTo(rand + breite, rand + hoehe);
        ctx.lineTo(rand, rand + hoehe);
        ctx.closePath();
    };
    // Der weiche Schein, ringsum und ohne Versatz; mehrere Durchgänge verdichten ihn.
    ctx.save();
    ctx.shadowColor = family.haloColor;
    ctx.shadowBlur = schein;
    ctx.fillStyle = family.haloColor;
    for (let pass = 0; pass < SCHEIN_PAESSE; pass += 1) {
        pfad();
        ctx.fill();
    }
    ctx.restore();
    // Die scharfe Kontur darüber; die Füllung deckt gleich ihre innere Hälfte zu.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = family.haloColor;
    ctx.lineWidth = kontur;
    pfad();
    ctx.stroke();
    pfad();
    ctx.fillStyle = family.color;
    ctx.fill();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Die Hunderter im Gebirge: wie die übrigen Hunderter, erst ab `detailMinZoom`, ohne Zahlen. */
export function buildContourDetailLayer(): LineLayerSpecification {
    const fine = buildContourLayers()[0] as LineLayerSpecification;
    return {
        ...fine,
        id: CONTOUR_DETAIL_LAYER_ID,
        source: CONTOUR_DETAIL_SOURCE_ID,
        "source-layer": CONTOUR_DETAIL_SOURCE_LAYER,
        // Nie früher als die Hunderter selbst (ihr Zoomband, WI-0221).
        minzoom: Math.max(TOPO.contour.detailMinZoom, fine.minzoom ?? 0),
    };
}

/** Alle Ebenen der Topographie, die unter die Wege gehören (Höhenlinien). */
export function contourLineLayers(show: boolean, detail = false): LayerSpecification[] {
    if (!show) return [];
    return detail ? [buildContourDetailLayer(), ...buildContourLayers()] : buildContourLayers();
}
