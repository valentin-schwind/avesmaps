import { fixedLog2 } from "./fixed-log.ts";
import {
    MAX_COPY_LENGTH,
    NUM_DISTANCE_CODES,
    NUM_LENGTH_CODES,
    NUM_LITERAL_CODES,
    planeCodesFor,
    prefixEncode,
} from "./format.ts";

/**
 * Das Bild der Abweichungen als Folge von Zeichen (Pixel, Rückverweis, Farbcache-Treffer) und deren
 * Häufigkeiten, dazu die Einteilung des Bildes in Blöcke mit eigenem Präfixcode („Meta-Präfixcodes“ von VP8L).
 */

export const LITERAL = 0;
export const COPY = 1;
export const CACHE = 2;

/** Aufbau der fünf Alphabete (Grün samt Längen und Cache, Rot, Blau, Alpha, Entfernung) in einem Histogramm. */
export interface Layout {
    cacheBits: number;
    sizes: readonly number[];
    offsets: readonly number[];
    total: number;
}

export function layoutFor(cacheBits: number): Layout {
    const green = NUM_LITERAL_CODES + NUM_LENGTH_CODES + (cacheBits > 0 ? 1 << cacheBits : 0);
    const sizes = [green, NUM_LITERAL_CODES, NUM_LITERAL_CODES, NUM_LITERAL_CODES, NUM_DISTANCE_CODES];
    const offsets: number[] = [];
    let total = 0;
    for (const size of sizes) {
        offsets.push(total);
        total += size;
    }
    return { cacheBits, sizes, offsets, total };
}

export interface Tokens {
    count: number;
    kind: Uint8Array;
    /** Pixel (Abweichung) bei einem Pixel, Entfernungscode bei einem Rückverweis, Index bei einem Cache-Treffer. */
    value: Uint32Array;
    /** Länge eines Rückverweises. */
    length: Uint16Array;
    /** Index des ersten Pixels, das das Zeichen deckt. */
    start: Int32Array;
}

/** Jedes Pixel als eigenes Zeichen, für die kleinen Bilder der Transformationsdaten. */
export function tokensOfPixels(pixels: Uint32Array): Tokens {
    return {
        count: pixels.length,
        kind: new Uint8Array(pixels.length),
        value: pixels,
        length: new Uint16Array(pixels.length),
        start: Int32Array.from({ length: pixels.length }, (_, index) => index),
    };
}

/**
 * Zeichenfolge zum Bild: ein Rückverweis auf gleiche Pixel links oder darüber ab `minCopy` Pixeln (Flächen,
 * Meer), sonst ein Treffer im Farbcache, sonst das Pixel selbst. Der Cache läuft mit wie im Dekodierer: jedes
 * Pixel kommt hinein, auch die von Rückverweisen gedeckten. Weitere Rückverweise (Hash-Ketten auf beliebige
 * frühere Stellen) und Entscheidungen nach Kosten wurden an den Höhenkacheln gemessen und machten sie größer.
 */
export function findReferences(pixels: Uint32Array, width: number, cacheBits: number, minCopy: number): Tokens {
    const total = pixels.length;
    const tokens: Tokens = {
        count: 0,
        kind: new Uint8Array(total),
        value: new Uint32Array(total),
        length: new Uint16Array(total),
        start: new Int32Array(total),
    };
    const planes = planeCodesFor(width);
    const codeLeft = planes.get(1)!;
    const codeAbove = planes.get(width)!;
    const cache = new Uint32Array(cacheBits > 0 ? 1 << cacheBits : 0);
    const shift = 32 - cacheBits;
    let at = 0;
    while (at < total) {
        let length = 0;
        let code = 0;
        if (at >= 1) {
            let run = 0;
            while (at + run < total && run < MAX_COPY_LENGTH && pixels[at + run] === pixels[at + run - 1]) run += 1;
            if (run > length) {
                length = run;
                code = codeLeft;
            }
        }
        if (at >= width) {
            let run = 0;
            while (at + run < total && run < MAX_COPY_LENGTH && pixels[at + run] === pixels[at + run - width]) run += 1;
            if (run > length) {
                length = run;
                code = codeAbove;
            }
        }
        const index = tokens.count;
        tokens.start[index] = at;
        if (length >= minCopy) {
            tokens.kind[index] = COPY;
            tokens.length[index] = length;
            tokens.value[index] = code;
            if (cacheBits > 0) {
                for (let i = 0; i < length; i += 1) {
                    const pixel = pixels[at + i]!;
                    cache[Math.imul(pixel, 0x1e35a7bd) >>> shift] = pixel;
                }
            }
            at += length;
        } else {
            const pixel = pixels[at]!;
            const slot = cacheBits > 0 ? Math.imul(pixel, 0x1e35a7bd) >>> shift : 0;
            if (cacheBits > 0 && cache[slot] === pixel) {
                tokens.kind[index] = CACHE;
                tokens.value[index] = slot;
            } else {
                tokens.value[index] = pixel;
                if (cacheBits > 0) cache[slot] = pixel;
            }
            at += 1;
        }
        tokens.count += 1;
    }
    return tokens;
}

const bump = (histogram: Uint32Array, index: number): void => {
    histogram[index] = histogram[index]! + 1;
};

/** Zählt ein Zeichen in ein Histogramm über die fünf Alphabete, beginnend bei `offset`. */
export function countToken(
    histogram: Uint32Array,
    offset: number,
    layout: Layout,
    tokens: Tokens,
    index: number,
): void {
    const kind = tokens.kind[index]!;
    const value = tokens.value[index]!;
    if (kind === LITERAL) {
        bump(histogram, offset + ((value >>> 8) & 255));
        bump(histogram, offset + layout.offsets[1]! + ((value >>> 16) & 255));
        bump(histogram, offset + layout.offsets[2]! + (value & 255));
        bump(histogram, offset + layout.offsets[3]! + (value >>> 24));
    } else if (kind === COPY) {
        bump(histogram, offset + NUM_LITERAL_CODES + prefixEncode(tokens.length[index]!).symbol);
        bump(histogram, offset + layout.offsets[4]! + prefixEncode(value).symbol);
    } else {
        bump(histogram, offset + NUM_LITERAL_CODES + NUM_LENGTH_CODES + value);
    }
}

/** Die Histogramme je Block (Kante `1 << bits` Pixel), zusammenhängend: Block `b` ab `b * layout.total`. */
export function blockHistograms(
    tokens: Tokens,
    layout: Layout,
    width: number,
    height: number,
    bits: number,
): Uint32Array {
    const blocksX = (width + (1 << bits) - 1) >> bits;
    const blocksY = (height + (1 << bits) - 1) >> bits;
    const histograms = new Uint32Array(blocksX * blocksY * layout.total);
    for (let index = 0; index < tokens.count; index += 1) {
        const start = tokens.start[index]!;
        const block = (Math.floor(start / width) >> bits) * blocksX + ((start % width) >> bits);
        countToken(histograms, block * layout.total, layout, tokens, index);
    }
    return histograms;
}

/** Zuteilung der Blöcke zu Gruppen mit gemeinsamem Präfixcode. */
export interface Grouping {
    /** Gruppe je Block. */
    group: Uint16Array;
    groups: number;
}

/**
 * Teilt die Blöcke in höchstens `wanted` Gruppen mit ähnlichen Häufigkeiten ein. Anfangs nach den Kosten
 * je Block unter einem gemeinsamen Code in gleich große Klassen, dann höchstens `rounds` Runden: Gruppencode
 * aus den zugeteilten Blöcken, jeder Block geht zur billigsten Gruppe. Kosten sind Ganzzahlen (`fixedLog2`),
 * die Einteilung ist also auf jedem Rechner dieselbe.
 */
export function groupBlocks(
    histograms: Uint32Array,
    layout: Layout,
    blocks: number,
    wanted: number,
    rounds: number,
): Grouping {
    const group = new Uint16Array(blocks);
    if (wanted <= 1 || blocks <= 1) return { group, groups: 1 };
    const size = layout.total;

    // Dünne Besetzung: je Block nur die vorkommenden Symbole.
    const sparseStart = new Int32Array(blocks + 1);
    const sparseSymbol: number[] = [];
    const sparseCount: number[] = [];
    for (let block = 0; block < blocks; block += 1) {
        for (let symbol = 0; symbol < size; symbol += 1) {
            const count = histograms[block * size + symbol]!;
            if (count > 0) {
                sparseSymbol.push(symbol);
                sparseCount.push(count);
            }
        }
        sparseStart[block + 1] = sparseSymbol.length;
    }

    /** Kosten je Symbol (1/1024 Bit) in einer Gruppe mit dem Histogramm `h`, geglättet mit einem halben Zähler. */
    const costsOf = (h: Uint32Array): Int32Array => {
        const costs = new Int32Array(size);
        for (let alphabet = 0; alphabet < layout.sizes.length; alphabet += 1) {
            const from = layout.offsets[alphabet]!;
            const length = layout.sizes[alphabet]!;
            let total = 0;
            for (let symbol = 0; symbol < length; symbol += 1) total += h[from + symbol]!;
            const denominator = fixedLog2(2 * total + length);
            for (let symbol = 0; symbol < length; symbol += 1) {
                costs[from + symbol] = denominator - fixedLog2(2 * h[from + symbol]! + 1);
            }
        }
        return costs;
    };
    const costOfBlock = (block: number, costs: Int32Array): number => {
        let sum = 0;
        for (let i = sparseStart[block]!; i < sparseStart[block + 1]!; i += 1) {
            sum += sparseCount[i]! * costs[sparseSymbol[i]!]!;
        }
        return sum;
    };

    // Anfang: nach den Kosten unter dem gemeinsamen Histogramm einreihen.
    const overall = new Uint32Array(size);
    for (let block = 0; block < blocks; block += 1) {
        for (let i = sparseStart[block]!; i < sparseStart[block + 1]!; i += 1) {
            overall[sparseSymbol[i]!] = overall[sparseSymbol[i]!]! + sparseCount[i]!;
        }
    }
    const common = costsOf(overall);
    const order = Array.from({ length: blocks }, (_, block) => block).sort(
        (a, b) => costOfBlock(a, common) - costOfBlock(b, common) || a - b,
    );
    const classes = Math.min(wanted, blocks);
    order.forEach((block, rank) => {
        group[block] = Math.floor((rank * classes) / blocks);
    });

    for (let round = 0; round < rounds; round += 1) {
        const sums = Array.from({ length: classes }, () => new Uint32Array(size));
        for (let block = 0; block < blocks; block += 1) {
            const into = sums[group[block]!]!;
            for (let i = sparseStart[block]!; i < sparseStart[block + 1]!; i += 1) {
                into[sparseSymbol[i]!] = into[sparseSymbol[i]!]! + sparseCount[i]!;
            }
        }
        const costs = sums.map(costsOf);
        let moved = 0;
        for (let block = 0; block < blocks; block += 1) {
            let best = group[block]!;
            let bestCost = costOfBlock(block, costs[best]!);
            for (let candidate = 0; candidate < classes; candidate += 1) {
                const cost = costOfBlock(block, costs[candidate]!);
                if (cost < bestCost) {
                    best = candidate;
                    bestCost = cost;
                }
            }
            if (best !== group[block]) {
                group[block] = best;
                moved += 1;
            }
        }
        if (moved === 0) break;
    }

    // Leere Gruppen fallen weg, die übrigen werden dicht nummeriert.
    const renumber = new Int32Array(classes).fill(-1);
    let groups = 0;
    for (let block = 0; block < blocks; block += 1) {
        const old = group[block]!;
        if (renumber[old]! < 0) {
            renumber[old] = groups;
            groups += 1;
        }
        group[block] = renumber[old]!;
    }
    return { group, groups };
}

/** Histogramm je Gruppe aus den Block-Histogrammen. */
export function groupHistograms(blockHist: Uint32Array, layout: Layout, grouping: Grouping): Uint32Array[] {
    const sums = Array.from({ length: grouping.groups }, () => new Uint32Array(layout.total));
    grouping.group.forEach((group, block) => {
        const into = sums[group]!;
        for (let symbol = 0; symbol < layout.total; symbol += 1) {
            into[symbol] = into[symbol]! + blockHist[block * layout.total + symbol]!;
        }
    });
    return sums;
}

/** Ein Teilstück eines Histogramms über die fünf Alphabete. */
export function alphabetSlice(histogram: Uint32Array, layout: Layout, alphabet: number): Uint32Array {
    return histogram.subarray(layout.offsets[alphabet], layout.offsets[alphabet]! + layout.sizes[alphabet]!);
}
