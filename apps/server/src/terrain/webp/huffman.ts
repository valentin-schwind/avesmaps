/**
 * Präfixcodes (Huffman) für WebP Lossless: Codelängen aus Häufigkeiten, kanonische Codes und die
 * Nachschlagetabelle des Dekodierers. Alles deterministisch: gleiche Häufigkeiten, gleiche Bytes.
 */

/** Längste zulässige Codelänge eines Präfixcodes in VP8L. */
export const MAX_CODE_LENGTH = 15;

/**
 * Codelängen eines längenbegrenzten Huffman-Codes. Ein Symbol allein bekommt Länge 1 (der Aufrufer
 * schreibt es dann ohne Bits, wie es VP8L für genau ein Symbol vorsieht); ohne Symbol bleibt alles 0.
 *
 * Wird die Grenze überschritten, steigt der Mindestwert der Häufigkeiten schrittweise (verdoppelt),
 * bis der Baum flach genug ist; so verfährt auch libwebp.
 */
export function huffmanLengths(counts: ArrayLike<number>, limit: number = MAX_CODE_LENGTH): Uint8Array {
    const lengths = new Uint8Array(counts.length);
    const used: number[] = [];
    for (let symbol = 0; symbol < counts.length; symbol += 1) {
        if (counts[symbol]! > 0) used.push(symbol);
    }
    if (used.length === 0) return lengths;
    if (used.length === 1) {
        lengths[used[0]!] = 1;
        return lengths;
    }
    const n = used.length;
    const weight = new Float64Array(2 * n - 1);
    const parent = new Int32Array(2 * n - 1);
    const depth = new Uint8Array(2 * n - 1);
    for (let floor = 1; ; floor *= 2) {
        const leaves = used
            .map((symbol) => ({ symbol, count: Math.max(counts[symbol]!, floor) }))
            .sort((a, b) => a.count - b.count || a.symbol - b.symbol);
        for (let i = 0; i < n; i += 1) weight[i] = leaves[i]!.count;
        // Zwei Warteschlangen: die sortierten Blätter und die der Reihe nach entstehenden inneren Knoten.
        let leaf = 0;
        let inner = n;
        for (let node = n; node < 2 * n - 1; node += 1) {
            const take = (): number =>
                leaf < n && (inner >= node || weight[leaf]! <= weight[inner]!) ? leaf++ : inner++;
            const a = take();
            const b = take();
            weight[node] = weight[a]! + weight[b]!;
            parent[a] = node;
            parent[b] = node;
        }
        depth[2 * n - 2] = 0;
        let deepest = 0;
        for (let node = 2 * n - 3; node >= 0; node -= 1) {
            depth[node] = Math.min(255, depth[parent[node]!]! + 1);
            if (node < n && depth[node]! > deepest) deepest = depth[node]!;
        }
        if (deepest <= limit) {
            for (let i = 0; i < n; i += 1) lengths[leaves[i]!.symbol] = depth[i]!;
            return lengths;
        }
    }
}

/** Dreht die unteren `length` Bit um. */
function reverseBits(value: number, length: number): number {
    let result = 0;
    for (let i = 0; i < length; i += 1) {
        result = (result << 1) | (value & 1);
        value >>= 1;
    }
    return result;
}

/**
 * Kanonische Codes zu Codelängen (kürzere zuerst, bei gleicher Länge nach Symbol, wie in Deflate), jeweils
 * schon umgedreht: VP8L liest einen Code Bit für Bit vom Anfang her, der Schreiber legt Mehrbitwerte aber
 * niederwertig zuerst ab.
 */
export function canonicalCodes(lengths: Uint8Array): Uint16Array {
    const perLength = new Uint16Array(MAX_CODE_LENGTH + 2);
    for (const length of lengths) if (length > 0) perLength[length] = perLength[length]! + 1;
    const next = new Uint16Array(MAX_CODE_LENGTH + 2);
    let code = 0;
    for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
        code = (code + perLength[length - 1]!) << 1;
        next[length] = code;
    }
    const codes = new Uint16Array(lengths.length);
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
        const length = lengths[symbol]!;
        if (length === 0) continue;
        codes[symbol] = reverseBits(next[length]!, length);
        next[length] = next[length]! + 1;
    }
    return codes;
}

/**
 * Nachschlagetabelle zum Dekodieren: indiziert mit den nächsten `maxLength` Bit; jeder Eintrag ist
 * `symbol << 4 | länge`. Hat der Code nur ein Symbol, kostet es kein Bit (Länge 0, Maske 0).
 * `null` heißt: kein vollständiger Code, also ein beschädigter Strom.
 */
export interface DecodeTable {
    table: Uint16Array;
    mask: number;
}

export function buildDecodeTable(lengths: Uint8Array): DecodeTable | null {
    const symbols: number[] = [];
    let maxLength = 0;
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
        const length = lengths[symbol]!;
        if (length === 0) continue;
        symbols.push(symbol);
        if (length > maxLength) maxLength = length;
    }
    if (symbols.length === 0) return null;
    if (symbols.length === 1) return { table: Uint16Array.of(symbols[0]! << 4), mask: 0 };
    let kraft = 0;
    for (const symbol of symbols) kraft += 2 ** (maxLength - lengths[symbol]!);
    if (kraft !== 2 ** maxLength) return null;
    const codes = canonicalCodes(lengths);
    const table = new Uint16Array(1 << maxLength);
    for (const symbol of symbols) {
        const length = lengths[symbol]!;
        const entry = (symbol << 4) | length;
        for (let slot = codes[symbol]!; slot < table.length; slot += 1 << length) table[slot] = entry;
    }
    return { table, mask: (1 << maxLength) - 1 };
}
