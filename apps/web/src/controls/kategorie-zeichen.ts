import type { InhalteVorkommenArt } from "@avesmaps3d/shared";

/**
 * Die Formen der vier Kategoriezeichen der Vorkommen (WI-0254, WI-0260): Blatt (Flora), gefüllte Pfote (Fauna), Korb (Waren), Person (Spezies), im Raster
 * des Zeichensatzes (`editor-zeichen.vue`: 16 × 16, Strich 1,5, runde Enden). Sie stehen hier als Daten, weil ZWEI sie zeichnen: die Oberfläche als SVG
 * (`editor-zeichen.vue`) und die Karte als Bild vor dem Namen eines gewählten Vorkommens (`map/vorkommen-zeichen-bild.ts`, WI-0257 S5). Eine zweite
 * Abschrift der Pfade liefe auseinander.
 *
 * - **Flora:** das Blatt der Ebene „Vegetation“ (Betreiber 2026-10-30: „bei pflanzen einfach ein blatt-symbol (wie bei vegetation)“).
 * - **Fauna:** die gefüllte Pfote, im Entwurf (Fassung 2) voreingestellt; der Betreiber nannte sie neben Schnecke, Spinne und Schlange und wählte keine
 *   andere. Ballen und vier Zehen, ohne Strich: Sie liest sich auch auf 12 px.
 */
export interface ZeichenForm {
    /** Der Pfad im 16er-Raster. */
    readonly d: string;
    /** Gefüllt statt gestrichen (die Pfote). */
    readonly gefuellt?: boolean;
    /** Gedreht um `[Winkel in Grad, x, y]` (die Zehen der Pfote). */
    readonly drehung?: readonly [number, number, number];
}

/** Eine Ellipse als Pfad (zwei Halbbögen), damit jede Form EIN Pfad ist. */
const ellipse = (cx: number, cy: number, rx: number, ry: number): string =>
    `M${String(cx - rx)} ${String(cy)}a${String(rx)} ${String(ry)} 0 1 0 ${String(2 * rx)} 0a${String(rx)} ${String(ry)} 0 1 0 ${String(-2 * rx)} 0z`;

const zeh = (cx: number, cy: number, rx: number, ry: number, winkel: number): ZeichenForm => ({
    d: ellipse(cx, cy, rx, ry),
    gefuellt: true,
    drehung: [winkel, cx, cy],
});

export const KATEGORIE_FORMEN: Readonly<Record<InhalteVorkommenArt, readonly ZeichenForm[]>> = {
    flora: [{ d: "M3 13C3 7 7 3 13 3c0 6-4 10-10 10z" }, { d: "M3 13l7-7" }],
    fauna: [
        {
            d: "M8 8.2c-2.4 0-4.4 2.2-4.4 4.1 0 1.4 1.1 2.1 2.3 2.1.9 0 1.4-.5 2.1-.5s1.2.5 2.1.5c1.2 0 2.3-.7 2.3-2.1 0-1.9-2-4.1-4.4-4.1z",
            gefuellt: true,
        },
        zeh(3, 6.9, 1.25, 1.7, -20),
        zeh(5.9, 3.8, 1.3, 1.85, -8),
        zeh(10.1, 3.8, 1.3, 1.85, 8),
        zeh(13, 6.9, 1.25, 1.7, 20),
    ],
    ware: [
        { d: "M4.6 7a3.4 3.4 0 0 1 6.8 0" },
        { d: "M2 7h12l-1.4 6.5H3.4z" },
        { d: "M5.6 9.3v2.3M8 9.3v2.3M10.4 9.3v2.3" },
    ],
    spezies: [{ d: ellipse(8, 5.2, 2.4, 2.4) }, { d: "M3.5 13.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" }],
};

/** Ist der Name eines Zeichens eine der vier Kategorien? */
export function istKategorie(name: string): name is InhalteVorkommenArt {
    return Object.hasOwn(KATEGORIE_FORMEN, name);
}

/** Das `transform` einer gedrehten Form in SVG; `undefined` ohne Drehung. */
export function svgDrehung(form: ZeichenForm): string | undefined {
    return form.drehung === undefined ? undefined : `rotate(${form.drehung.join(" ")})`;
}
