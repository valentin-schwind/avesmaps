import { pointCount, type ContourLine } from "./contours.ts";

/**
 * Eine Linie als GeoJSON-Text für die Datenbank (WI-0055, I13): Karteneinheiten, auf ein Zehntausendstel E
 * gerundet (0,3 Schritt), Zeichen für Zeichen in einen Puffer geschrieben.
 *
 * Vorher entstand der Text über ein Feld von [x, y] und `JSON.stringify`: rund 70 Byte Müll je Punkt, bei 4 Mio.
 * Punkten und dem Text noch einmal als Feldliteral und Puffer der Verbindung war das die Spitze. Hier entsteht
 * kein Objekt je Punkt; die Zahlen stehen genau, wie `JSON.stringify` sie schriebe (Test).
 */

/** Bis zu dieser Größe (in Zehntausendsteln, also 10⁸ E) schreibt der Puffer die Zahl selbst; Karte: höchstens ~10³. */
const HAND_WRITTEN_LIMIT = 1e12;

const HEAD = Buffer.from('{"type":"LineString","coordinates":[', "latin1");
const TAIL = Buffer.from("]}", "latin1");

const COMMA = 44;
const DOT = 46;
const MINUS = 45;
const OPEN = 91;
const CLOSE = 93;
const ZERO = 48;

/** Höchstens so viele Zeichen je Zahl: Vorzeichen, acht Stellen davor, Punkt, vier danach. */
const NUMBER_BYTES = 14;
/** Je Punkt: zwei Zahlen und `,[`, `,`, `]`. */
const POINT_BYTES = 2 * NUMBER_BYTES + 4;

/**
 * Schreibt `Math.round(value * 1e4) / 1e4` so, wie `String` es schreibt. Die Zahl ist der auf ein Zehntausendstel
 * gerundete Wert k / 10⁴, und ihre kürzeste Schreibweise ist genau diese Dezimalzahl ohne endende Nullen: Jede
 * kürzere unterschiede sich um mindestens ein Zehntausendstel, und eine Doppelzahl löst hier viel feiner auf.
 * Gibt die Stelle hinter der Zahl zurück.
 */
function writeNumber(buffer: Buffer, at: number, value: number): number {
    const k = Math.round(value * 1e4);
    const magnitude = Math.abs(k);
    let position = at;
    if (k < 0) {
        buffer[position] = MINUS;
        position += 1;
    }
    const whole = Math.floor(magnitude / 1e4);
    let fraction = magnitude - whole * 1e4;
    let digits = 1;
    for (let rest = whole; rest >= 10; rest = Math.floor(rest / 10)) digits += 1;
    for (let rest = whole, d = digits - 1; d >= 0; d -= 1, rest = Math.floor(rest / 10)) {
        buffer[position + d] = ZERO + (rest % 10);
    }
    position += digits;
    if (fraction > 0) {
        buffer[position] = DOT;
        position += 1;
        let places = 4;
        while (fraction % 10 === 0) {
            fraction /= 10;
            places -= 1;
        }
        for (let d = places - 1; d >= 0; d -= 1, fraction = Math.floor(fraction / 10)) {
            buffer[position + d] = ZERO + (fraction % 10);
        }
        position += places;
    }
    return position;
}

/** Die Schreibweise aus der Zeit vor dem Puffer: für Werte außerhalb dessen, was der Puffer sicher schreibt. */
function lineJsonSlow(line: ContourLine): string {
    return JSON.stringify({
        type: "LineString",
        coordinates: Array.from({ length: pointCount(line) }, (_, q) => [
            Math.round((line.coords[2 * q] as number) * 1e4) / 1e4,
            Math.round((line.coords[2 * q + 1] as number) * 1e4) / 1e4,
        ]),
    });
}

export function lineJson(line: ContourLine): string {
    const { coords } = line;
    for (let q = 0; q < coords.length; q += 1) {
        // Auch NaN und unendliche Werte fallen hier heraus (Vergleich falsch).
        if (!(Math.abs((coords[q] as number) * 1e4) < HAND_WRITTEN_LIMIT)) return lineJsonSlow(line);
    }
    const buffer = Buffer.allocUnsafe(HEAD.length + TAIL.length + pointCount(line) * POINT_BYTES);
    let at = HEAD.copy(buffer, 0);
    for (let q = 0; q < coords.length; q += 2) {
        if (q > 0) {
            buffer[at] = COMMA;
            at += 1;
        }
        buffer[at] = OPEN;
        at = writeNumber(buffer, at + 1, coords[q] as number);
        buffer[at] = COMMA;
        at = writeNumber(buffer, at + 1, coords[q + 1] as number);
        buffer[at] = CLOSE;
        at += 1;
    }
    at += TAIL.copy(buffer, at);
    return buffer.toString("latin1", 0, at);
}
