import type { ExpressionSpecification } from "maplibre-gl";
import { LANDMARKEN_ARTEN, labelFamily, type LandmarkenArt } from "@avesmaps3d/shared";

/**
 * Die Kartenzeichen der Landmarken (WI-0271 L5; Symbolkonzept §6, Entwurf `review/wi-0271/landmarken-entwurf.html`, Zeichenblatt): EINE Tinte für
 * alle Landmarken, die des Gipfels (`labels.peak`, `topography.peak`), Unterschied nur über die Form. Merkmale ändern das Zeichen nie.
 *
 * - **Gezeichnet als Laufzeitbild je Art** (`runtime-images.ts`), keine Sprite-Datei: die Formen des Zeichenblatts im Raster 16 × 16, gefüllt oder
 *   als Strich, mit dem zweiteiligen Saum des Namens (scharfe Kontur und weicher Schein, wie das Gipfeldreieck `drawPeakTriangleImage`).
 * - **Größe wie die Schrift:** Das Raster ist so groß wie die Schrift des Namens (Entwurf: „in echter Größe (15 px, Kartenzoom 6)“, das ist
 *   `topography.peak.sizeStops` bei Zoom 6); `icon-size` skaliert mit dem Namen wie beim Dreieck. **Der Berggipfel ist so groß wie die übrigen**
 *   (Vali 2026-11-01 auf die Frage „Soll der Berggipfel auf der Karte so groß werden wie die neuen Landmarkenzeichen?“: „Gleich groß“): sein
 *   Dreieck aus dem Zeichenblatt im selben Raster, Höhenzeile wie bisher.
 * - **Welches Bild:** `landmarkenBild` als Ausdruck nach `subtype` der Kachel (`terrain_peak_render`); nur eine unbekannte Art zeigt noch das
 *   kleine Gipfeldreieck (`PEAK_TRIANGLE_IMAGE_ID`).
 */

export interface ZeichenTeil {
    readonly art: "fuellen" | "strich";
    /** Ein SVG-Pfad im Raster 16 × 16. */
    readonly d: string;
    /** Strichbreite in Einheiten des Rasters (Vorgabe 1,7). */
    readonly breite?: number;
    /** Strichelung in Einheiten des Rasters. */
    readonly strichel?: readonly [number, number];
}

/** Ein Kreis als Pfad (zwei Halbbögen), damit jedes Teil ein Pfad ist. */
const kreis = (cx: number, cy: number, r: number): string =>
    `M${String(cx - r)} ${String(cy)}a${String(r)} ${String(r)} 0 1 0 ${String(2 * r)} 0a${String(r)} ${String(r)} 0 1 0 ${String(-2 * r)} 0`;

const WELLE_UNTEN = "M1.8 12.4c1.5-1.4 3-1.4 4.1 0s2.6 1.4 4.2 0 2.6-1.4 4.1 0";
const BOGEN = "M2 13.2h2.8C3.3 11.3 2.9 8.8 4 6.8c1.5-2.9 6.5-2.9 8 0 1.1 2 .7 4.5-.8 6.4H14";

/** Die Formen je Art, wie das Zeichenblatt des Entwurfs sie zeigt. */
export const LANDMARKEN_ZEICHEN: Readonly<Record<LandmarkenArt, readonly ZeichenTeil[]>> = {
    berggipfel: [{ art: "fuellen", d: "M8 2.2 14.4 13.4H1.6z" }],
    vulkan: [
        { art: "fuellen", d: "M1.6 13.4 5.5 4.2 7 6.4h2l1.5-2.2 3.9 9.2z" },
        { art: "strich", d: "M8 4.6V1.6", breite: 1.2 },
    ],
    huegel: [{ art: "fuellen", d: "M1.5 12.6C3 6.2 13 6.2 14.5 12.6z" }],
    hoehle: [{ art: "strich", d: BOGEN }],
    grotte: [
        { art: "strich", d: BOGEN },
        { art: "strich", d: "M5.6 11.2c.8-.7 1.6-.7 2.4 0s1.6.7 2.4 0", breite: 1.2 },
    ],
    krater: [
        { art: "strich", d: kreis(8, 8, 5.2) },
        {
            art: "strich",
            d: "M8 2.8v2.1M8 11.1v2.1M2.8 8h2.1M11.1 8h2.1M4.3 4.3l1.5 1.5M10.2 10.2l1.5 1.5M11.7 4.3l-1.5 1.5M5.8 10.2l-1.5 1.5",
            breite: 1.3,
        },
    ],
    schlucht: [
        { art: "strich", d: "M1.8 3.4 8 13l6.2-9.6" },
        { art: "strich", d: "M3.6 6.4l2.1-.5M5.2 8.9l1.9-.4M12.4 6.4l-2.1-.5M10.8 8.9l-1.9-.4", breite: 1.2 },
    ],
    wasserfall: [
        { art: "strich", d: "M1.6 4h6.2" },
        {
            art: "strich",
            d: "M7.8 4c2 0 2.6 1.2 2.6 3.2v6M6 5.2c1.4.4 1.8 1.6 1.8 3.4v4.2M10.4 4.2c1.6.2 2.4 1.4 2.4 3.4v5.2",
        },
    ],
    quelle: [
        { art: "strich", d: kreis(8, 6.2, 3) },
        { art: "strich", d: WELLE_UNTEN },
    ],
    geysir: [
        { art: "strich", d: "M8 12.2V3M8 5.4C6.4 3.4 4.6 4.2 4.2 6.6M8 5.4c1.6-2 3.4-1.2 3.8 1.2" },
        { art: "strich", d: "M1.8 13.6c1.5-1.2 3-1.2 4.1 0s2.6 1.2 4.2 0 2.6-1.2 4.1 0" },
    ],
    furt: [
        {
            art: "strich",
            d: "M1.6 6.2c1.6-1.2 3.2-1.2 4.3 0s2.8 1.2 4.3 0 2.8-1.2 4.3 0M1.6 10.6c1.6-1.2 3.2-1.2 4.3 0s2.8 1.2 4.3 0 2.8-1.2 4.3 0",
            breite: 1.4,
        },
        { art: "strich", d: "M8 1.6v12.8", breite: 1.4, strichel: [1.6, 1.8] },
    ],
    strudel: [
        {
            art: "strich",
            d: "M8.6 8.2c.6-.9-.6-1.8-1.5-1.1-1.3 1-.6 3.2 1.1 3.3 2.3.2 3.5-2.6 2.2-4.5C8.8 3.6 4.6 4.4 4 7.6c-.7 3.6 2.6 6.4 6 5.8 2.6-.5 4.2-2.6 4.2-5",
        },
    ],
    fels: [{ art: "fuellen", d: "M5.6 14 4.8 6.2 7 2.4l3.4 1.8.9 9.8z" }],
    klippe: [
        { art: "strich", d: "M1.8 5h12.4" },
        { art: "strich", d: "M3.4 5.4 2.9 9.6M6.4 5.4l-.4 5.4M9.6 5.4l-.4 4.2M12.6 5.4l-.4 5.4", breite: 1.3 },
    ],
    riff: [
        { art: "fuellen", d: "M3.2 11.2 5 5.4l1.6 5.8zM7.8 11.2l2.2-7.4 1.8 7.4z" },
        { art: "strich", d: "M1.4 12.8c1.6-1.3 3.1-1.3 4.3 0s2.7 1.3 4.3 0 2.8-1.3 4.4 0" },
    ],
};

/** Die Vorgabe der Strichbreite (Zeichenblatt: `stroke-width="1.7"`). */
const STRICH = 1.7;
/** Die Kante des Rasters: so viele Einheiten wie die Schrift Bildpunkte hat. */
const RASTER = 16;
/** Die Schriftgröße, für die gezeichnet wird; `icon-size` skaliert mit dem Namen (wie `DREIECK_BEZUG` in `topography-layers.ts`). */
export const ZEICHEN_BEZUG = 16;
/** Wie oft der weiche Schein gezeichnet wird (wie beim Gipfeldreieck). */
const SCHEIN_PAESSE = 3;

/** Der Name des Laufzeitbilds einer Art. */
export const landmarkenBildId = (art: LandmarkenArt): string => `landmarke-${art}`;

/** Die Arten mit eigenem Bild: alle, seit 2026-11-01 auch der Berggipfel (vorher das kleinere Gipfeldreieck). */
export const ARTEN_MIT_BILD: readonly LandmarkenArt[] = LANDMARKEN_ARTEN;

/** `icon-image` nach der Art der Kachel; eine unbekannte Art zeigt `dreieck`. */
export function landmarkenBild(dreieck: string): ExpressionSpecification {
    return [
        "match",
        ["get", "subtype"],
        ...ARTEN_MIT_BILD.flatMap((art) => [art, landmarkenBildId(art)]),
        dreieck,
    ] as unknown as ExpressionSpecification;
}

/** Das Zeichen einer Art als Bild, mit dem Saum des Namens. */
export function drawLandmarkenZeichen(art: LandmarkenArt, pixelRatio = 2): ImageData {
    const family = labelFamily("peak");
    const einheit = (ZEICHEN_BEZUG / RASTER) * pixelRatio;
    const kontur = 2 * family.haloWidthRatio * ZEICHEN_BEZUG * pixelRatio;
    const schein = family.haloBlurRatio * ZEICHEN_BEZUG * pixelRatio;
    const teile = LANDMARKEN_ZEICHEN[art];
    const breitester = Math.max(0, ...teile.map((teil) => (teil.art === "strich" ? (teil.breite ?? STRICH) : 0)));
    const rand = Math.ceil(kontur / 2 + 1.5 * schein + (breitester * einheit) / 2) + 1;
    const seite = Math.ceil(RASTER * einheit + 2 * rand);
    const canvas = document.createElement("canvas");
    canvas.width = seite;
    canvas.height = seite;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`Landmarkenzeichen ${art}: kein 2D-Kontext`);
    ctx.translate(rand, rand);
    ctx.scale(einheit, einheit);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const pfade = teile.map((teil) => ({ teil, pfad: new Path2D(teil.d) }));
    const zeichne = (farbe: string, zusatz: number, fuellen: boolean): void => {
        for (const { teil, pfad } of pfade) {
            ctx.setLineDash(teil.strichel === undefined ? [] : [...teil.strichel]);
            if (teil.art === "fuellen") {
                if (fuellen) {
                    ctx.fillStyle = farbe;
                    ctx.fill(pfad);
                }
                if (zusatz > 0) {
                    ctx.strokeStyle = farbe;
                    ctx.lineWidth = zusatz;
                    ctx.stroke(pfad);
                }
            } else {
                ctx.strokeStyle = farbe;
                ctx.lineWidth = (teil.breite ?? STRICH) + zusatz;
                ctx.stroke(pfad);
            }
        }
    };
    // Der weiche Schein, ringsum und ohne Versatz; mehrere Durchgänge verdichten ihn (die Unschärfe misst in Gerätepixeln).
    ctx.save();
    ctx.shadowColor = family.haloColor;
    ctx.shadowBlur = schein;
    for (let pass = 0; pass < SCHEIN_PAESSE; pass += 1) zeichne(family.haloColor, 0, true);
    ctx.restore();
    // Die scharfe Kontur, dann die Form selbst darüber.
    zeichne(family.haloColor, kontur / einheit, false);
    zeichne(family.color, 0, true);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
