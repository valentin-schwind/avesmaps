/**
 * Ein Mapbox Vector Tile lesen, gerade genug für Tests: Namen der Schichten, Zahl der Merkmale je Schicht und deren
 * Zeichenwerte je Schlüssel. Kein Ersatz für einen Decoder (keine Geometrie) - aber ohne neue Abhängigkeit.
 *
 * Aufbau (vector_tile.proto): Tile { Layer layers = 3 }; Layer { string name = 1; Feature features = 2; string keys = 3;
 * Value values = 4 }; Feature { uint32 tags = 2 }; Value { string string_value = 1 }.
 */

interface Field {
    number: number;
    wire: number;
    value: number | Buffer;
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } {
    let result = 0;
    let shift = 0;
    let position = offset;
    for (;;) {
        const byte = buffer[position] as number;
        position += 1;
        result += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
    }
    return { value: result, next: position };
}

function readFields(buffer: Buffer): Field[] {
    const fields: Field[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const key = readVarint(buffer, offset);
        offset = key.next;
        const number = Math.floor(key.value / 8);
        const wire = key.value % 8;
        if (wire === 0) {
            const value = readVarint(buffer, offset);
            fields.push({ number, wire, value: value.value });
            offset = value.next;
        } else if (wire === 2) {
            const length = readVarint(buffer, offset);
            const start = length.next;
            fields.push({ number, wire, value: buffer.subarray(start, start + length.value) });
            offset = start + length.value;
        } else if (wire === 1) {
            fields.push({ number, wire, value: buffer.subarray(offset, offset + 8) });
            offset += 8;
        } else if (wire === 5) {
            fields.push({ number, wire, value: buffer.subarray(offset, offset + 4) });
            offset += 4;
        } else {
            throw new Error(`unbekannter Wire-Typ ${String(wire)}`);
        }
    }
    return fields;
}

export interface MvtLayer {
    name: string;
    features: number;
    /** Alle Zeichenwerte je Schlüssel, in Merkmalsreihenfolge. */
    strings: Record<string, string[]>;
    /** Alle Werte je Schlüssel mit ihrem Typ (Zeichen, Zahl, Wahrheitswert), in Merkmalsreihenfolge. */
    properties: Record<string, (string | number | boolean)[]>;
}

/** Ein Wert des Wörterbuchs (vector_tile.proto `Value`): string 1, float 2, double 3, int 4, uint 5, sint 6, bool 7. */
function readValue(buffer: Buffer): string | number | boolean {
    const field = readFields(buffer)[0];
    if (!field) return "";
    switch (field.number) {
        case 1:
            return Buffer.isBuffer(field.value) ? field.value.toString() : "";
        case 2:
            return (field.value as Buffer).readFloatLE(0);
        case 3:
            return (field.value as Buffer).readDoubleLE(0);
        case 4:
        case 5:
            return field.value as number;
        case 6: {
            const zigzag = field.value as number;
            return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
        }
        case 7:
            return field.value === 1;
        default:
            return "";
    }
}

export function readMvt(tile: Buffer | Uint8Array): Record<string, MvtLayer> {
    const layers: Record<string, MvtLayer> = {};
    for (const field of readFields(Buffer.from(tile))) {
        if (field.number !== 3 || !Buffer.isBuffer(field.value)) continue;
        const inner = readFields(field.value);
        const name = String(inner.find((entry) => entry.number === 1)?.value.toString());
        const keys = inner.filter((entry) => entry.number === 3).map((entry) => String(entry.value.toString()));
        const typed = inner.filter((entry) => entry.number === 4).map((entry) => readValue(entry.value as Buffer));
        const values = typed.map((value) => (typeof value === "string" ? value : ""));
        const features = inner.filter((entry) => entry.number === 2 && Buffer.isBuffer(entry.value));
        const strings: Record<string, string[]> = {};
        const properties: Record<string, (string | number | boolean)[]> = {};
        for (const feature of features) {
            const tags = readFields(feature.value as Buffer).find((item) => item.number === 2);
            if (!tags || !Buffer.isBuffer(tags.value)) continue;
            let offset = 0;
            while (offset < tags.value.length) {
                const key = readVarint(tags.value, offset);
                const value = readVarint(tags.value, key.next);
                offset = value.next;
                const keyName = keys[key.value];
                if (keyName !== undefined) {
                    (strings[keyName] ??= []).push(values[value.value] ?? "");
                    (properties[keyName] ??= []).push(typed[value.value] ?? "");
                }
            }
        }
        layers[name] = { name, features: features.length, strings, properties };
    }
    return layers;
}
