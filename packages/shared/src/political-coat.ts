import { Type, type Static } from "@sinclair/typebox";

/**
 * Das Wappen am Gebietsnamen (WI-0121, Betreiber 2026-10-09: „prima und zentriert wie in legacy“).
 *
 * Legacy stellt Namen und Wappen eines Gebiets als EINEN Block dar (`createRegionLabelMarkup`,
 * `js/map-features/map-features.js:684-736`; `.region-label__content`, `css/features/map-labels.css:331-376`; Mirror
 * `cbe278210`): eine Spalte, das Wappen zentriert oben, darunter der Name, mehrzeilig gestapelt und zentriert. Der Tooltip
 * sitzt mit `direction: "center"` auf dem Ankerpunkt, also steht der GANZE Block zentriert auf ihm. Daraus folgt, was hier
 * gerechnet wird: wo die Unterkante des Wappens und die Mitte der ersten Namenszeile liegen, in Pixeln vom Anker.
 *
 * 🔴 Alles hier ist Legacys Rechnung, nicht eine eigene. Die Konstanten stehen in `aventuria-political.json` (`label.coat`),
 * die Rundungen (Wappen `Math.round`, Namensbild `Math.ceil`, Zeilenabstand `Math.round`) stehen hier, weil sie Legacys
 * sind und in keiner Tafel Platz haben.
 *
 * 🔴 Eine Abweichung, bewusst (Betreiber 2026-10-09: „du kannst die schriftart der territorien größer machen“): Legacy rechnet
 * mit seiner Schrift von 13,3 px, wir zeigen den Namen größer. Das Namensbild, die Zeilenhöhe und damit die Höhe des Blocks
 * folgen der Schrift, die wirklich steht - der Block bleibt auf dem Anker zentriert. Die LÜCKE vom Wappen bis zur Oberkante der
 * Schrift dagegen ist ein eigener Wert der Tafel (`gapToEmTopPx`, Legacys 8,85 px bei Faktor 1): Sie wächst nicht mit der Schrift,
 * sonst rückte das Wappen von einem größeren Namen weg.
 */

/**
 * Die Maße des Blocks. Alle Pixelwerte gelten bei Faktor 1 (Band 3 und höher); der Faktor je Band steht bei der Schrift
 * (`label.scaleByBand`) und gilt für Wappen UND Namen.
 */
export const PoliticalCoat = Type.Object(
    {
        /** Kantenlänge des Wappens (`.region-label__coat`: 40 × 40, `object-fit: contain`). */
        edgePx: Type.Number({ exclusiveMinimum: 0 }),
        /** Polster oben im Block (`.region-label__content`: `padding: 2px 5px 5px`). */
        paddingTopPx: Type.Number({ minimum: 0 }),
        /** Polster unten im Block. */
        paddingBottomPx: Type.Number({ minimum: 0 }),
        /**
         * Die Lücke von der Unterkante des Wappens bis zur Oberkante der Schrift (des Em-Kastens der ersten Zeile) bei Faktor 1.
         * Legacy: Abstand Wappen → Namensbild (`.region-label__content > .region-label__name-img { margin-top: 2px }`) plus der
         * halbe Überstand des Namensbildes über die Schrift, bei seiner Schrift von 13,3 px also 2 + (27 − 13,3) / 2 = 8,85 px.
         * Sie steht hier als Wert, nicht als Rechnung: Der Name ist größer als bei Legacy, die Lücke soll es nicht sein.
         */
        gapToEmTopPx: Type.Number({ minimum: 0 }),
        /**
         * Höhe des Namensbildes (`renderMapLabelToImage`, `js/map-features/map-features-labels.js:207`) in Schriftgrößen:
         * `ceil(Größe × nameImageHeightEm + 2 × max(0,5, Größe × nameImageStrokeRatio))`. Das Bild trägt den Saum als Polster,
         * der Name steht in seiner Mitte.
         */
        nameImageHeightEm: Type.Number({ exclusiveMinimum: 0 }),
        /** Die Saumbreite des Namensbildes als Anteil der Größe (`getRegionLabelNameTypeStyle`: `strokeRatio`). */
        nameImageStrokeRatio: Type.Number({ minimum: 0 }),
        /** Zeilenabstand mehrzeiliger Namen in Schriftgrößen (`lineStep = round(Größe × 1,18)`). */
        lineStepEm: Type.Number({ exclusiveMinimum: 0 }),
        /**
         * Für wie viele Zeilen der Block auf dem Anker zentriert wird. 🪤 MapLibre setzt Wappen und Name getrennt an einen
         * festen Abstand; wie viele Zeilen ein Name bekommt, weiß erst der Kachelbau. Die Mitte des Blocks hängt aber an
         * dieser Zahl (Legacy: je Zeile 8 px weiter oben). Gerechnet an den 401 Gebieten mit Wappen: 2 Zeilen 73 %, 1 Zeile 14 %,
         * 3 Zeilen 12 %.
         */
        calibratedLines: Type.Integer({ minimum: 1, maximum: 6 }),
    },
    { additionalProperties: false },
);
export type PoliticalCoat = Static<typeof PoliticalCoat>;

/** Der Faktor dieses Bandes für Schrift und Wappen (Legacy: `[0.75, 0.83, 0.91, 1][Math.round(zoom)]`, ab Zoom 3 voll). */
export function labelScaleForBand(scaleByBand: readonly number[], band: number): number {
    const index = Math.min(scaleByBand.length - 1, Math.max(0, Math.trunc(band)));
    return scaleByBand[index] as number;
}

/**
 * Wo Wappen und Name eines Gebiets liegen, in Pixeln vom Anker (positiv heißt nach unten).
 *
 * Legacys Block (CSS): Polster oben, Wappen, Abstand, Namensbild(er), Polster unten; seine Mitte ist der Anker.
 */
export interface CoatLabelGeometry {
    /** Der Faktor dieses Bandes. */
    scale: number;
    /** Kantenlänge des Wappens, ganzzahlig wie Legacys `Math.round(40 × Faktor)`. */
    coatPx: number;
    /** Schriftgröße des Namens. */
    fontPx: number;
    /** Höhe des Namensbildes, das den Namen trägt. */
    nameImagePx: number;
    /** Abstand zweier Zeilen. */
    lineStepPx: number;
    /** Höhe des ganzen Blocks bei dieser Zeilenzahl. */
    blockPx: number;
    /** Die Unterkante des Wappens. */
    coatBottomPx: number;
    /** Die Mitte der ersten Namenszeile. */
    firstLineCenterPx: number;
    /** Von der Unterkante des Wappens bis zur Oberkante des Schriftkastens (der Em-Höhe) der ersten Zeile - unabhängig von der Zeilenzahl. */
    gapToEmTopPx: number;
}

export function coatLabelGeometry(
    coat: PoliticalCoat,
    label: { sizePx: number; scaleByBand: readonly number[] },
    band: number,
    lines: number,
): CoatLabelGeometry {
    const scale = labelScaleForBand(label.scaleByBand, band);
    const coatPx = Math.round(coat.edgePx * scale);
    const fontPx = label.sizePx * scale;
    const nameImagePx = Math.ceil(
        fontPx * coat.nameImageHeightEm + 2 * Math.max(0.5, fontPx * coat.nameImageStrokeRatio),
    );
    const lineStepPx = Math.round(fontPx * coat.lineStepEm);
    const lineCount = Math.max(1, Math.trunc(lines));
    // Der Abstand Wappen → Namensbild folgt aus der Lücke zur Schrift: Das Bild steht um seinen Überstand über der Schrift höher.
    const gapToEmTopPx = coat.gapToEmTopPx * scale;
    const nameGapPx = gapToEmTopPx - (nameImagePx - fontPx) / 2;
    const blockPx =
        coat.paddingTopPx + coatPx + nameGapPx + nameImagePx + (lineCount - 1) * lineStepPx + coat.paddingBottomPx;
    const coatBottomPx = -blockPx / 2 + coat.paddingTopPx + coatPx;
    const firstLineCenterPx = coatBottomPx + nameGapPx + nameImagePx / 2;
    return {
        scale,
        coatPx,
        fontPx,
        nameImagePx,
        lineStepPx,
        blockPx,
        coatBottomPx,
        firstLineCenterPx,
        gapToEmTopPx: firstLineCenterPx - fontPx / 2 - coatBottomPx,
    };
}
