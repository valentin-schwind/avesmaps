import { fixedLog2 } from "./fixed-log.ts";
import { predict, subtractPixels } from "./format.ts";

/**
 * Wahl der Vorhersage je Block (Transformation „Predictor“ in VP8L) und das Bild der Abweichungen.
 *
 * Die Blöcke werden der Reihe nach entschieden. Jeder bekommt die Vorhersageart, die den Gesamtcode am
 * wenigsten verteuert: Gemessen wird die Zunahme der Entropie der Abweichungen aller bisherigen Blöcke,
 * wenn die Abweichungen dieses Blocks hinzukommen (so rechnet auch libwebp). Das belohnt Arten, deren
 * Abweichungen zu denen der Nachbarblöcke passen. Die Vorhersagen lesen nur schon bekannte Pixel des
 * Originals, deshalb hängt das Bild der Abweichungen nur an den gewählten Arten.
 *
 * Es kommen nur drei der vierzehn Arten in Frage: links (1), oben (2) und die Steigung aus links, oben und
 * links oben (12). Die Höhenkacheln tragen die Höhe als 24-Bit-Zahl über drei Byte; Vorhersagen, die
 * Nachbarn mitteln oder wählen, rechnen über Bytegrenzen hinweg falsch (der Übertrag fehlt). Gemessen an
 * den Kacheln von Stage-Stand 8k (WI-0073) waren diese drei besser als alle vierzehn und kosteten ein Viertel.
 */

const divRoundUp = (value: number, shift: number): number => (value + (1 << shift) - 1) >> shift;

/** Die erprobten Arten, in dieser Reihenfolge; bei Gleichstand gewinnt die erste. */
export const CANDIDATE_MODES = [1, 2, 12] as const;

/** `k * log2(k)` in 1/1024 Bit, aus der Festkomma-Tafel (siehe `fixedLog2`). */
let xlogxTable: Float64Array | null = null;
function xlogx(count: number): number {
    if (xlogxTable === null || count >= xlogxTable.length) {
        const size = Math.max(count + 1, 1 << 18);
        const grown = new Float64Array(size);
        for (let k = 2; k < size; k += 1) grown[k] = k * fixedLog2(k);
        xlogxTable = grown;
    }
    return xlogxTable[count]!;
}

/** Vorhersageart je Block, `bits` ist der Zweierlogarithmus der Blockkante. */
export function chooseModes(argb: Uint32Array, width: number, height: number, bits: number): Uint8Array {
    const blocksX = divRoundUp(width, bits);
    const blocksY = divRoundUp(height, bits);
    const modes = new Uint8Array(blocksX * blocksY).fill(CANDIDATE_MODES[0]);
    const edge = 1 << bits;
    const area = edge * edge;
    const count = CANDIDATE_MODES.length;
    /** Abweichungen je Art, Kanal (Blau, Grün, Rot) und Pixel des Blocks. */
    const residual = new Uint8Array(count * 3 * area);
    const nonzero = new Int32Array(count);
    /** Bisherige Häufigkeiten je Kanal. */
    const accumulated = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const accumulatedTotal = [0, 0, 0];
    const local = new Uint32Array(256);
    const touched = new Uint16Array(256);
    for (let blockY = 0; blockY < blocksY; blockY += 1) {
        for (let blockX = 0; blockX < blocksX; blockX += 1) {
            const endX = Math.min(width, (blockX + 1) << bits);
            const endY = Math.min(height, (blockY + 1) << bits);
            const startX = Math.max(1, blockX << bits);
            const startY = Math.max(1, blockY << bits);
            // Ein Block ohne jede Änderung nach links (Meer, Ebenen) braucht keine Rechnung: Art 1 kostet nichts.
            let flat = true;
            for (let y = startY; y < endY && flat; y += 1) {
                for (let x = startX; x < endX; x += 1) {
                    if (argb[y * width + x] !== argb[y * width + x - 1]) {
                        flat = false;
                        break;
                    }
                }
            }
            if (flat) {
                const zeros = Math.max(0, endX - startX) * Math.max(0, endY - startY);
                for (let channel = 0; channel < 3; channel += 1) {
                    accumulated[channel]![0] = accumulated[channel]![0]! + zeros;
                    accumulatedTotal[channel] = accumulatedTotal[channel]! + zeros;
                }
                continue;
            }
            let pixels = 0;
            nonzero.fill(0);
            // Die erste Zeile und die erste Spalte haben feste Vorhersagen: für die Wahl ohne Belang.
            for (let y = startY; y < endY; y += 1) {
                for (let x = startX; x < endX; x += 1) {
                    const at = y * width + x;
                    const actual = argb[at]!;
                    const left = argb[at - 1]!;
                    const top = argb[at - width]!;
                    const topLeft = argb[at - width - 1]!;
                    for (let channel = 0; channel < 3; channel += 1) {
                        const shift = channel * 8;
                        const a = (actual >>> shift) & 255;
                        const l = (left >>> shift) & 255;
                        const t = (top >>> shift) & 255;
                        const full = l + t - ((topLeft >>> shift) & 255);
                        const base = channel * area + pixels;
                        const byLeft = (a - l) & 255;
                        const byTop = (a - t) & 255;
                        const byFull = (a - (full < 0 ? 0 : full > 255 ? 255 : full)) & 255;
                        residual[base] = byLeft;
                        residual[3 * area + base] = byTop;
                        residual[6 * area + base] = byFull;
                        if (byLeft !== 0) nonzero[0] = nonzero[0]! + 1;
                        if (byTop !== 0) nonzero[1] = nonzero[1]! + 1;
                        if (byFull !== 0) nonzero[2] = nonzero[2]! + 1;
                    }
                    pixels += 1;
                }
            }
            if (pixels === 0) continue;
            let best = -1;
            // Ist eine Art fehlerfrei (Meer, Ebenen), kostet sie nichts: keine Rechnung nötig.
            for (let candidate = 0; candidate < count && best < 0; candidate += 1)
                if (nonzero[candidate] === 0) best = candidate;
            if (best < 0) {
                let bestCost = Infinity;
                for (let candidate = 0; candidate < count; candidate += 1) {
                    let cost = 0;
                    for (let channel = 0; channel < 3; channel += 1) {
                        const from = candidate * 3 * area + channel * area;
                        let distinct = 0;
                        for (let i = 0; i < pixels; i += 1) {
                            const value = residual[from + i]!;
                            if (local[value] === 0) {
                                touched[distinct] = value;
                                distinct += 1;
                            }
                            local[value] = local[value]! + 1;
                        }
                        const before = accumulated[channel]!;
                        const total = accumulatedTotal[channel]!;
                        let sum = xlogx(total + pixels) - xlogx(total);
                        for (let k = 0; k < distinct; k += 1) {
                            const value = touched[k]!;
                            sum -= xlogx(before[value]! + local[value]!) - xlogx(before[value]!);
                            local[value] = 0;
                        }
                        cost += sum;
                    }
                    if (cost < bestCost) {
                        bestCost = cost;
                        best = candidate;
                    }
                }
            }
            for (let channel = 0; channel < 3; channel += 1) {
                const from = best * 3 * area + channel * area;
                const into = accumulated[channel]!;
                for (let i = 0; i < pixels; i += 1) into[residual[from + i]!] = into[residual[from + i]!]! + 1;
                accumulatedTotal[channel] = accumulatedTotal[channel]! + pixels;
            }
            modes[blockY * blocksX + blockX] = CANDIDATE_MODES[best]!;
        }
    }
    return modes;
}

/** Das Bild der Abweichungen: jedes Pixel minus seine Vorhersage, je Kanal modulo 256. */
export function residualImage(
    argb: Uint32Array,
    width: number,
    height: number,
    bits: number,
    modes: Uint8Array,
): Uint32Array {
    const blocksX = divRoundUp(width, bits);
    const out = new Uint32Array(width * height);
    out[0] = subtractPixels(argb[0]!, 0xff000000);
    for (let x = 1; x < width; x += 1) out[x] = subtractPixels(argb[x]!, argb[x - 1]!);
    for (let y = 1; y < height; y += 1) {
        const row = y * width;
        out[row] = subtractPixels(argb[row]!, argb[row - width]!);
        for (let x = 1; x < width; x += 1) {
            const at = row + x;
            const mode = modes[(y >> bits) * blocksX + (x >> bits)]!;
            const actual = argb[at]!;
            if (mode === 1) {
                // links: in Meer und Ebenen fast immer gleich, dann ist die Abweichung Null
                const left = argb[at - 1]!;
                out[at] = actual === left ? 0 : subtractPixels(actual, left);
                continue;
            }
            const predicted = predict(
                mode,
                argb[at - 1]!,
                argb[at - width]!,
                argb[at - width + 1]!,
                argb[at - width - 1]!,
            );
            out[at] = subtractPixels(actual, predicted);
        }
    }
    return out;
}
