/**
 * Die Einstellungen eines SVG-Abzugs der Karte (WI-0280 K2), Portierung von Legacys `SVGX_ABZUG_EINSTELLUNGEN` und
 * `SVGX_ABZUG_EINSTELLUNGEN_GLATT` (`js/pages/svg-export-build.js` im Mirror).
 *
 * 🔴 Die zwei festen Abzüge unterscheiden sich in GENAU einer Eigenschaft, der Glättung: `KARTEN_SVG_GLATT` ist von `KARTEN_SVG_ROH`
 * ABGELEITET und nicht als zweite Tafel abgeschrieben. Eine zweite Literaltafel liefe beim ersten Mal auseinander, an dem jemand die
 * Basis anfasst, und der Unterschied bliebe still, weil beide Dateien gültig aussehen (Legacy, 31.08.2026).
 *
 * 🔴 Der API-Abzug ist eine DATENQUELLE, kein Gestaltungsstück: alle Ebenen, volle Semantik, feste Schreibweise (`inkscape`). Wer
 * eigene Einstellungen wählt, bekommt einen eigenen Abzug (`svg-eigen-…`), nie einen der beiden festen.
 *
 * Die Grenzen der Zahlen sind die des Vertrags (`KartenSvgEinstellungen` in `packages/shared/src/karten-export.ts`); hier stehen sie
 * einmal als Wertebereich, damit der reine Bauer auch dann nichts Unsinniges zeichnet, wenn ihn jemand ohne die Route aufruft.
 * Diese Datei lädt bewusst nichts aus `@avesmaps3d/shared`: Der Bauer bleibt ein Modul ohne Laufzeitabhängigkeit.
 */

/** Die Ebenen in Zeichenreihenfolge, von unten nach oben (in SVG liegt das Erste unten). */
export const KARTEN_SVG_EBENEN = ["landschaften", "gebiete", "wege", "kraftlinien", "orte", "beschriftungen"] as const;
export type KartenSvgEbene = (typeof KARTEN_SVG_EBENEN)[number];

export type KartenSvgDialekt = "inkscape" | "illustrator";

export interface KartenSvgOptionen {
    /** `inkscape` schreibt zusätzlich `inkscape:label` und `inkscape:groupmode`, `illustrator` benennt über die `id`. */
    dialekt: KartenSvgDialekt;
    /** Kantenlänge in Bildpunkten (`width`/`height`); der Zeichenraum bleibt immer 0…1024. 256 bis 200000, Vorgabe 32768. */
    groessePx: number;
    /** `avm:`-Attribute, Vokabular und Fassungsstempel. Aus: eine reine Zeichnung ohne Namensraum. */
    semantik: boolean;
    /** Vier deckende Quadrate in den Ecken jeder Ebene, damit rasterisierte Ebenen ihren Platz behalten. */
    passmarken: boolean;
    /** Faktor auf alle Strichstärken in Prozent, 5 bis 400, Vorgabe 100 (= der Kartenzustand). */
    strichProzent: number;
    /** Wege und Flüsse als Bézierkurven (`C`) statt als Stützpunkt-Polygon (`L`). */
    glattWege: boolean;
    /** Landschaftsflächen als Bézierkurven. Herrschaftsgebiete bleiben IMMER eckig, auch hier. */
    glattFlaechen: boolean;
    /** Spannung der Catmull-Rom-Kurve, 0 bis 1, Vorgabe 0,5 (`LEGACY_CATMULL.tension`). */
    spannung: number;
    /** Welche Ebenen in die Datei kommen. Die Reihenfolge der Liste ist ohne Wirkung, gezeichnet wird in `KARTEN_SVG_EBENEN`-Ordnung. */
    ebenen: readonly KartenSvgEbene[];
}

export const KARTEN_SVG_GROESSE_PX = { min: 256, max: 200_000, vorgabe: 32_768 } as const;
export const KARTEN_SVG_STRICH_PROZENT = { min: 5, max: 400, vorgabe: 100 } as const;
export const KARTEN_SVG_SPANNUNG = { min: 0, max: 1, vorgabe: 0.5 } as const;

/** Die rohe Fassung: Geometrie, wie sie in den Daten steht (`M`/`L`/`Z`). Das ist und bleibt die Vorgabe. */
export const KARTEN_SVG_ROH: KartenSvgOptionen = Object.freeze({
    dialekt: "inkscape",
    groessePx: KARTEN_SVG_GROESSE_PX.vorgabe,
    semantik: true,
    passmarken: false,
    strichProzent: KARTEN_SVG_STRICH_PROZENT.vorgabe,
    glattWege: false,
    glattFlaechen: false,
    spannung: KARTEN_SVG_SPANNUNG.vorgabe,
    ebenen: Object.freeze([...KARTEN_SVG_EBENEN]),
});

/** Die geglättete Fassung: dieselbe Karte mit den Bézierkurven, die der Browser zeichnet (`M`/`L`/`C`/`Z`). */
export const KARTEN_SVG_GLATT: KartenSvgOptionen = Object.freeze({
    ...KARTEN_SVG_ROH,
    glattWege: true,
    glattFlaechen: true,
});

function klemme(
    wert: number,
    grenzen: { readonly min: number; readonly max: number; readonly vorgabe: number },
): number {
    return Number.isFinite(wert) ? Math.min(grenzen.max, Math.max(grenzen.min, wert)) : grenzen.vorgabe;
}

/**
 * Bringt Einstellungen in den Wertebereich. Der Bauer ruft sie selbst auf: Eine Größe 0 oder ein Strich von minus 3 Prozent wäre
 * sonst eine Datei, die gültig aussieht und nichts zeigt. Ganze Pixel, doppelte und unbekannte Ebenen fallen weg.
 */
export function bereinigeKartenSvgOptionen(optionen: KartenSvgOptionen): KartenSvgOptionen {
    const ebenen = KARTEN_SVG_EBENEN.filter((ebene) => optionen.ebenen.includes(ebene));
    return {
        dialekt: optionen.dialekt === "illustrator" ? "illustrator" : "inkscape",
        groessePx: Math.round(klemme(optionen.groessePx, KARTEN_SVG_GROESSE_PX)),
        semantik: optionen.semantik === true,
        passmarken: optionen.passmarken === true,
        strichProzent: klemme(optionen.strichProzent, KARTEN_SVG_STRICH_PROZENT),
        glattWege: optionen.glattWege === true,
        glattFlaechen: optionen.glattFlaechen === true,
        spannung: klemme(optionen.spannung, KARTEN_SVG_SPANNUNG),
        ebenen,
    };
}
