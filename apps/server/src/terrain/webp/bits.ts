/**
 * Bitweises Lesen und Schreiben im Format von WebP Lossless (VP8L): Bits kommen aus jedem Byte vom
 * niederwertigen Ende her, Mehrbitwerte stehen niederwertig zuerst.
 */

/** Liest Bits; hinter dem Ende stehen Nullen, `overrun` meldet das Überlesen. */
export class BitReader {
    private readonly bytes: Uint8Array;
    private readonly totalBits: number;
    /** Aktuelle Lesestelle in Bit. */
    position = 0;

    constructor(source: Uint8Array) {
        // Ein Polster hinter dem Ende, damit ein Zugriff auf vier Bytes nie aus dem Puffer liest.
        this.bytes = new Uint8Array(source.length + 8);
        this.bytes.set(source);
        this.totalBits = source.length * 8;
    }

    /** Bis zu 24 Bit lesen. */
    read(count: number): number {
        const value = this.peek(count);
        this.position += count;
        return value;
    }

    /** Bis zu 24 Bit ansehen, ohne weiterzulesen. */
    peek(count: number): number {
        const at = this.position >>> 3;
        const b = this.bytes;
        const word = (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> (this.position & 7);
        return word & ((1 << count) - 1);
    }

    /** Mehr gelesen, als die Quelle hat? */
    get overrun(): boolean {
        return this.position > this.totalBits;
    }
}

/** Schreibt Bits und liefert die Bytes; das letzte Byte wird mit Nullen aufgefüllt. */
export class BitWriter {
    private bytes = new Uint8Array(1 << 16);
    private length = 0;
    private accumulator = 0;
    private pending = 0;

    /** Bis zu 24 Bit schreiben; höhere Bits von `value` gehen verloren. */
    write(value: number, count: number): void {
        if (count === 0) return;
        this.accumulator = (this.accumulator | ((value & ((1 << count) - 1)) << this.pending)) >>> 0;
        this.pending += count;
        while (this.pending >= 8) {
            this.push(this.accumulator & 255);
            this.accumulator >>>= 8;
            this.pending -= 8;
        }
    }

    private push(byte: number): void {
        if (this.length === this.bytes.length) {
            const grown = new Uint8Array(this.bytes.length * 2);
            grown.set(this.bytes);
            this.bytes = grown;
        }
        this.bytes[this.length] = byte;
        this.length += 1;
    }

    /** Bits geschrieben, einschließlich der noch nicht ausgegebenen. */
    get bitLength(): number {
        return this.length * 8 + this.pending;
    }

    finish(): Uint8Array {
        if (this.pending > 0) this.write(0, 8 - this.pending);
        return this.bytes.slice(0, this.length);
    }
}
