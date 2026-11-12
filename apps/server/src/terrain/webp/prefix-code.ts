import type { BitWriter } from "./bits.ts";
import { canonicalCodes, huffmanLengths, MAX_CODE_LENGTH } from "./huffman.ts";
import { CODE_LENGTH_CODES, CODE_LENGTH_ORDER } from "./format.ts";

/** Längstes Codewort des Codes, der die Codelängen beschreibt. */
const CODE_LENGTH_LIMIT = 7;

/** Ein Präfixcode zum Schreiben: Längen, Codewörter und die Beschreibung im Strom. */
export class PrefixCode {
    readonly lengths: Uint8Array;
    private readonly codes: Uint16Array;
    /** Genau ein Symbol: VP8L liest und schreibt es ohne ein Bit. */
    private readonly single: boolean;

    constructor(histogram: ArrayLike<number>, limit: number = MAX_CODE_LENGTH) {
        this.lengths = huffmanLengths(histogram, limit);
        this.codes = canonicalCodes(this.lengths);
        let used = 0;
        for (const length of this.lengths) if (length > 0) used += 1;
        this.single = used <= 1;
    }

    /** Bits, die ein Symbol kostet. */
    bits(symbol: number): number {
        return this.single ? 0 : this.lengths[symbol]!;
    }

    write(writer: BitWriter, symbol: number): void {
        if (!this.single) writer.write(this.codes[symbol]!, this.lengths[symbol]!);
    }

    /** Beschreibung des Codes im Strom. */
    describe(writer: BitWriter): void {
        writeLengths(writer, this.lengths);
    }
}

interface LengthToken {
    code: number;
    extraBits: number;
    extraValue: number;
}

const literal = (code: number): LengthToken => ({ code, extraBits: 0, extraValue: 0 });

/** Die Codelängen als Folge von Symbolen 0 bis 18 (Längen, Wiederholungen von Null und der letzten Länge). */
function tokensOf(lengths: Uint8Array): LengthToken[] {
    const tokens: LengthToken[] = [];
    let previous = 8;
    let at = 0;
    while (at < lengths.length) {
        const value = lengths[at]!;
        let run = 1;
        while (at + run < lengths.length && lengths[at + run] === value) run += 1;
        at += run;
        if (value === 0) {
            while (run >= 11) {
                const take = Math.min(run, 138);
                tokens.push({ code: 18, extraBits: 7, extraValue: take - 11 });
                run -= take;
            }
            if (run >= 3) {
                tokens.push({ code: 17, extraBits: 3, extraValue: run - 3 });
                run = 0;
            }
        } else {
            if (value !== previous) {
                tokens.push(literal(value));
                previous = value;
                run -= 1;
            }
            while (run >= 3) {
                const take = Math.min(run, 6);
                tokens.push({ code: 16, extraBits: 2, extraValue: take - 3 });
                run -= take;
            }
        }
        for (; run > 0; run -= 1) tokens.push(literal(value));
    }
    return tokens;
}

function writeLengths(writer: BitWriter, lengths: Uint8Array): void {
    const used: number[] = [];
    for (let symbol = 0; symbol < lengths.length; symbol += 1) if (lengths[symbol]! > 0) used.push(symbol);
    // Einfacher Code: höchstens zwei Symbole unter 256, ohne Längentabelle.
    if (used.length === 0 || (used.length <= 2 && used[used.length - 1]! < 256)) {
        writer.write(1, 1);
        writer.write(Math.max(0, used.length - 1), 1);
        const first = used[0] ?? 0;
        if (first <= 1) {
            writer.write(0, 1);
            writer.write(first, 1);
        } else {
            writer.write(1, 1);
            writer.write(first, 8);
        }
        if (used.length === 2) writer.write(used[1]!, 8);
        return;
    }
    writer.write(0, 1);
    const tokens = tokensOf(lengths);
    // Die abschließenden Nullen müssen nicht stehen: der Dekodierer liest nur so viele Symbole, wie angekündigt.
    let kept = tokens.length;
    while (kept > 0 && (tokens[kept - 1]!.code === 0 || tokens[kept - 1]!.code >= 17)) kept -= 1;
    kept = Math.max(kept, 2);
    // Das Kürzen kostet selbst Bits (Merker, Zahl der Bitpaare, Anzahl); es lohnt, wenn mehr wegfällt.
    const pairs = ((31 - Math.clz32(kept - 1)) >> 1) + 1;
    let dropped = 0;
    for (let i = kept; i < tokens.length; i += 1) dropped += 3 + tokens[i]!.extraBits;
    const trim = dropped > 4 + 2 * pairs;
    const written = trim ? tokens.slice(0, kept) : tokens;
    const histogram = new Uint32Array(CODE_LENGTH_CODES);
    for (const token of written) histogram[token.code] = histogram[token.code]! + 1;
    const lengthCode = new PrefixCode(histogram, CODE_LENGTH_LIMIT);
    let count = CODE_LENGTH_ORDER.length;
    while (count > 4 && lengthCode.lengths[CODE_LENGTH_ORDER[count - 1]!] === 0) count -= 1;
    writer.write(count - 4, 4);
    for (let i = 0; i < count; i += 1) writer.write(lengthCode.lengths[CODE_LENGTH_ORDER[i]!]!, 3);
    if (trim) {
        writer.write(1, 1);
        writer.write(pairs - 1, 3);
        writer.write(kept - 2, pairs * 2);
    } else {
        writer.write(0, 1);
    }
    for (const token of written) {
        lengthCode.write(writer, token.code);
        if (token.extraBits > 0) writer.write(token.extraValue, token.extraBits);
    }
}
