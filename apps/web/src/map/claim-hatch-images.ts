import { AVENTURIA_POLITICAL_CARTOGRAPHY, claimStripeWidthPx, type PoliticalClaimHatch } from "@avesmaps3d/shared";
import type { ImageSink, StyleImageResolver } from "./style-image-resolver";
import { patternPixelRatio, stripePatternImage, stripePatternLayout, type StripePatternImage } from "./stripe-pattern";

/**
 * Die Muster der Schraffur umstrittener Gebiete (Nachtrag WI-0062, Betreiber 2026-09-30; Legacy
 * `map-features-contested-hatch-overlay.js`): diagonale Streifen in den Farben der Parteien.
 *
 * Ein Muster heißt `claim-<Band>-<Farbe>-<Farbe>[-…]` (die Farben ohne `#`, das umstrittene Gebiet zuerst, dann die
 * Anspruchsteller): so nennt es die Kachel (`territory_claim_render.pattern`), und MapLibre fragt es beim ersten Bedarf an
 * (`setMissingStyleImageResolver`, gesetzt in `style-image-resolver.ts`). Es gibt so nie ein Muster ohne Gebiet, und keine
 * Farbtabelle im Code.
 *
 * 💣 Der Auflöser, nicht das Ereignis `styleimagemissing`: Seit MapLibre 6 feuert das Ereignis erst NACH dem Fehlschlag
 * (die Kachel ist dann schon ohne Muster gebaut), der Auflöser läuft davor und wird abgewartet.
 *
 * Gebaut wird das Bild in `stripe-pattern.ts` (dieselbe Rechnung wie die Mischgebiete der Sprachen, WI-0261 S5a): quadratisch,
 * eine Zweierpotenz, nahtlos; die Streifen treffen Legacys Breite für das Band (`claimStripeWidthPx`) so gut es geht.
 */

export const CLAIM_PATTERN_PREFIX = "claim-";

export interface ClaimPattern {
    band: number;
    /** Sechsstellige Hexfarben ohne `#`, in Streifenfolge. */
    colors: string[];
}

/** Der Name aus der Kachel, zerlegt; `undefined`, wenn er nicht von der Schraffur stammt oder unlesbar ist. */
export function parseClaimPatternName(name: string): ClaimPattern | undefined {
    if (!name.startsWith(CLAIM_PATTERN_PREFIX)) return undefined;
    const [bandText, ...colors] = name.slice(CLAIM_PATTERN_PREFIX.length).split("-");
    const band = Number(bandText);
    if (!Number.isInteger(band) || band < 0 || colors.length === 0) return undefined;
    if (!colors.every((color) => /^[0-9a-f]{6}$/.test(color))) return undefined;
    return { band, colors };
}

/** Wie das Muster für `colors` Streifen aufgeteilt wird: Kantenlänge, Wiederholungen und die erreichte Breite. */
export function claimPatternLayout(
    hatch: PoliticalClaimHatch,
    band: number,
    stripes: number,
): { edge: number; repeats: number; widthPx: number } {
    return stripePatternLayout(claimStripeWidthPx(hatch, band), stripes);
}

export type ClaimPatternImage = StripePatternImage;

/** Das Muster als Bilddaten (`stripePatternImage`): Streifen von rechts oben nach links unten, die Parteien in ihrer Reihenfolge. */
export function claimPatternImage(
    hatch: PoliticalClaimHatch,
    pattern: ClaimPattern,
    pixelRatio: number = 1,
): ClaimPatternImage {
    return stripePatternImage(pattern.colors, claimStripeWidthPx(hatch, pattern.band), pixelRatio);
}

/**
 * Legt ein Muster an, sobald MapLibre es braucht. Die Ebene der Schraffur nennt es nur beim Namen (`fill-pattern`); ein
 * fremder Name bleibt unbeantwortet, MapLibre meldet ihn dann wie jedes fehlende Bild. Gesetzt wird der Auflöser nicht hier,
 * sondern an EINER Stelle für alle Arten von Laufzeitbildern (`style-image-resolver.ts`).
 */
export function claimHatchImageResolver(map: ImageSink): StyleImageResolver {
    return {
        prefix: CLAIM_PATTERN_PREFIX,
        resolve(id) {
            const pattern = parseClaimPatternName(id);
            if (!pattern || map.hasImage(id)) return;
            const image = claimPatternImage(AVENTURIA_POLITICAL_CARTOGRAPHY.claimHatch, pattern, patternPixelRatio());
            map.addImage(
                id,
                { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer) },
                { pixelRatio: image.pixelRatio },
            );
        },
    };
}
