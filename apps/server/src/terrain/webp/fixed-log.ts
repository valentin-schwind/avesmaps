/**
 * Binärer Logarithmus in Festkomma, nur mit Ganzzahlen gerechnet.
 *
 * Der Kodierer entscheidet an Kosten (Vorhersageart je Block, Gruppierung der Blöcke). Gleiche Eingabe
 * muss auf jedem Rechner und mit jeder Node-Version dieselben Bytes ergeben (Kachelrevision =
 * Hash der Kacheln); `Math.log2` verspricht das nicht, diese Tabelle schon.
 */

/** Einheiten je Bit: Ergebnisse sind Vielfache von 1/1024 Bit. */
export const LOG_UNIT = 1024;
const FRACTION_BITS = 10;
const MANTISSA_BITS = 12;

/** log2(1 + i / 4096) in 1/1024, abgeschnitten; durch wiederholtes Quadrieren, exakt in BigInt. */
const MANTISSA = Uint16Array.from({ length: 1 << MANTISSA_BITS }, (_, i) => {
    const one = 1n << 32n;
    let y = BigInt(4096 + i) << 20n;
    let result = 0;
    for (let bit = 0; bit < FRACTION_BITS; bit += 1) {
        y = (y * y) >> 32n;
        result <<= 1;
        if (y >= one << 1n) {
            y >>= 1n;
            result |= 1;
        }
    }
    return result;
});

/** `log2(value)` in 1/1024 Bit für ganzes `value` von 1 bis 2^31 - 1; abgeschnitten auf ein Tausendstel Bit. */
export function fixedLog2(value: number): number {
    const exponent = 31 - Math.clz32(value);
    const mantissa =
        exponent >= MANTISSA_BITS ? value >> (exponent - MANTISSA_BITS) : value << (MANTISSA_BITS - exponent);
    return (exponent << FRACTION_BITS) + MANTISSA[mantissa & ((1 << MANTISSA_BITS) - 1)]!;
}
