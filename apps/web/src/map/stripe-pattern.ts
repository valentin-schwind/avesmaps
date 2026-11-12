/**
 * Diagonale Streifen als Musterbild für `fill-pattern`: EINE Rechnung für die Schraffur umstrittener Gebiete (Nachtrag WI-0062,
 * `claim-hatch-images.ts`) und die Mischgebiete der Sprachen (WI-0261 S5a, `sprachen-layers.ts`).
 *
 * 🔴 Die Kachel des Musters ist QUADRATISCH und eine Zweierpotenz (32, 64 oder 128 Bildpunkte): MapLibre verankert ein
 * Muster an der Kachel, und nur eine Zweierpotenz setzt die Streifen an der Kachelgrenze nahtlos fort. Bei 45° hängt die
 * Farbe nur an `x + y`, und die Periode dieser Summe ist die Kantenlänge: `n` Farben mal `k` Wiederholungen teilen sie.
 * Die Streifenbreite (senkrecht gemessen) ist dann `Kante / (n · k · √2)`; gewählt wird die Kombination, die die gewünschte
 * Breite am besten trifft.
 */

/** Die möglichen Kantenlängen der Musterkachel: Zweierpotenzen. */
const EDGE_SIZES = [32, 64, 128] as const;
const MAX_REPEATS = 16;
/** Unterabtastung je Achse für glatte Kanten der 45°-Streifen. */
const SUBSAMPLES = 4;

export interface StripePatternLayout {
    edge: number;
    repeats: number;
    /** Die erreichte Breite eines Streifens, senkrecht gemessen (CSS-Pixel). */
    widthPx: number;
}

/** Wie ein Muster aus `stripes` Farben aufgeteilt wird, damit ein Streifen möglichst `targetWidthPx` breit steht. */
export function stripePatternLayout(targetWidthPx: number, stripes: number): StripePatternLayout {
    let best: StripePatternLayout | undefined;
    for (const edge of EDGE_SIZES) {
        for (let repeats = 1; repeats <= MAX_REPEATS; repeats += 1) {
            const widthPx = edge / (stripes * repeats * Math.SQRT2);
            if (!best || Math.abs(widthPx - targetWidthPx) < Math.abs(best.widthPx - targetWidthPx)) {
                best = { edge, repeats, widthPx };
            }
        }
    }
    return best as StripePatternLayout;
}

export interface StripePatternImage {
    width: number;
    height: number;
    /** RGBA, undurchsichtig; die Deckkraft setzt die Ebene. */
    data: Uint8ClampedArray;
    pixelRatio: number;
}

function hexChannels(color: string): [number, number, number] {
    return [
        Number.parseInt(color.slice(0, 2), 16),
        Number.parseInt(color.slice(2, 4), 16),
        Number.parseInt(color.slice(4, 6), 16),
    ];
}

/**
 * Das Muster als Bilddaten. Die Streifen laufen von rechts oben nach links unten (`/`, wie Legacys um 45° gedrehtes
 * Canvas): die Farbe hängt nur an `x + y`, und mit wachsender Summe folgen die Farben einander in ihrer Reihenfolge.
 * Nur 45° wird gebaut: ein anderer Winkel liefe nicht nahtlos in eine quadratische Zweierpotenz.
 *
 * @param colors sechsstellige Hexfarben ohne `#`, in Streifenfolge
 */
export function stripePatternImage(
    colors: readonly string[],
    targetWidthPx: number,
    pixelRatio: number = 1,
): StripePatternImage {
    const { edge, repeats } = stripePatternLayout(targetWidthPx, colors.length);
    const size = edge * pixelRatio;
    const channels = colors.map(hexChannels);
    const stripes = channels.length;
    // Eine Farbe deckt `stripeSpan` der Summe x + y (in Bildpunkten der Musterkachel, nicht der ganzen Kachel).
    const stripeSpan = size / (stripes * repeats);
    const data = new Uint8ClampedArray(size * size * 4);
    const step = 1 / SUBSAMPLES;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let red = 0;
            let green = 0;
            let blue = 0;
            for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
                for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
                    const sum = x + y + (sx + 0.5) * step + (sy + 0.5) * step;
                    const index = Math.floor((sum % size) / stripeSpan) % stripes;
                    const [r, g, b] = channels[index] as [number, number, number];
                    red += r;
                    green += g;
                    blue += b;
                }
            }
            const samples = SUBSAMPLES * SUBSAMPLES;
            const at = (y * size + x) * 4;
            data[at] = red / samples;
            data[at + 1] = green / samples;
            data[at + 2] = blue / samples;
            data[at + 3] = 255;
        }
    }
    return { width: size, height: size, data, pixelRatio };
}

/** Die Pixeldichte, in der ein Muster gebaut wird: die des Bildschirms, mindestens 1, ganzzahlig. */
export function patternPixelRatio(): number {
    return Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
}
