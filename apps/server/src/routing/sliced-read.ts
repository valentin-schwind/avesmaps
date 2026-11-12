/**
 * Eine große `bytea`-Zeile in Scheiben lesen (WI-0071).
 *
 * Eine Zeile von 16 oder 32 MiB kommt beim Treiber als Hexadezimaltext an (das Doppelte). Er sammelt die Pakete der
 * Nachricht, fügt sie zu einem Puffer zusammen und wandelt ihn um; gemessen im Routing-Worker: eine Spitze von 218 bis
 * 259 MiB ArrayBuffer für ein Raster von 32 MiB, und bis zur nächsten Anfrage hielt die Verbindung die Puffer. Mit
 * Scheiben von 1 MiB bleibt alles Zwischenliegende bei wenigen MiB, und das Ergebnis liegt in EINEM Puffer, der von
 * Anfang an die endgültige Größe hat. Byte für Byte dasselbe wie die ganze Zeile.
 *
 * 🪤 Die Scheiben kosten Zeit: `substring` dekomprimiert die gespeicherte Zeile je Anfrage (TOAST, `STORAGE
 * EXTENDED`); 32 Scheiben des Domain-Rasters brauchen lokal 0,7 s statt 0,15 s. Gelesen wird beim Laden eines neuen
 * Stands im Hintergrund, nie in einer Anfrage.
 *
 * 🔴 Liegt die Zeile KOMPRIMIERT in einer `EXTERNAL`-Spalte, wird jede Scheibe teurer als die davor: PostgreSQL muss
 * für die Scheibe ab Byte `offset` alles davor entpacken (Stage 8k, 2026-10-03: `heights` 17,8 s für 128 Scheiben, lokal
 * 6,7 s gegen 0,95 s unkomprimiert). Das passiert, wenn der Wert aus einer Spalte mit `EXTENDED` kopiert wird (die
 * Hilfstabelle in `terrain/domain/store.ts`): `EXTERNAL` komprimiert nichts, entpackt aber auch nichts. Für diesen Fall
 * gibt es `readRows`: ein Entpacken, danach die Scheiben als Zeilen derselben Anfrage.
 */

/** So viele Byte holt eine Anfrage; IMPLEMENTATION DETAIL, gemessen an Domain-Raster (32 MiB) und Seegraph (16 MiB). */
export const SLICE_BYTES = 1024 * 1024;

const MIB = 1024 * 1024;

/** Der Name der Umgebungsvariable für die Scheibengröße des Routing-Workers, in MiB (Bruchteile erlaubt). */
export const ROUTING_SLICE_ENV = "ROUTING_SLICE_MIB";

/** Der Name der Umgebungsvariable für die Art, das Raster zu lesen: `auto` (Vorgabe), `slices` oder `rows`. */
export const ROUTING_RASTER_READ_ENV = "ROUTING_RASTER_READ";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Die Scheibengröße des Routing-Workers in Byte: `SLICE_BYTES`, es sei denn, `ROUTING_SLICE_MIB` nennt eine andere
 * (Claudio kann so auf dem VPS 1, 4 oder 16 MiB messen, ohne den Code zu ändern). Zwischen 64 KiB und 64 MiB; was
 * keine solche Zahl ist, gilt als nicht gesetzt: Eine falsche Einstellung hält das Laden nie an.
 * Speicher je Größe (ArrayBuffer-Spitze über dem Ergebnis, lokal gemessen am 8k-Raster): 1 MiB 56, 4 MiB 82, 16 MiB 168.
 */
export function routingSliceBytes(environment: Environment = process.env): number {
    const raw = environment[ROUTING_SLICE_ENV]?.trim();
    if (!raw) return SLICE_BYTES;
    const mib = Number(raw);
    if (!Number.isFinite(mib) || mib <= 0) return SLICE_BYTES;
    return Math.round(Math.min(64, Math.max(1 / 16, mib)) * MIB);
}

export type RasterRead = "auto" | "slices" | "rows";

/**
 * Wie der Routing-Worker das Raster liest: `auto` nimmt Scheiben, bei komprimiert abgelegter Zeile die Zeilen von
 * `readRows`; `slices` und `rows` erzwingen eine Art (zum Messen und als Rückweg). Alles andere gilt als `auto`.
 */
export function routingRasterRead(environment: Environment = process.env): RasterRead {
    const raw = environment[ROUTING_RASTER_READ_ENV]?.trim().toLowerCase();
    return raw === "slices" || raw === "rows" ? raw : "auto";
}

/**
 * Liest `total` Byte in Scheiben von höchstens `slice` Byte. `fetch(offset, length)` holt die Scheibe ab `offset`
 * (nullbasiert) - ein einzelnes `SELECT substring(spalte FROM ${offset + 1} FOR ${length})`. Fehlt eine Scheibe oder ist
 * sie kürzer als verlangt (die Zeile wurde zwischenzeitlich ersetzt), liefert die Funktion null und keinen halben Puffer.
 * Das Ergebnis beginnt bei Byte 0 seines ArrayBuffers und füllt ihn ganz: Ein Typ-Array darüber ist ausgerichtet.
 */
export async function readSlices(
    total: number,
    slice: number,
    fetch: (offset: number, length: number) => Promise<Uint8Array | undefined>,
): Promise<Uint8Array | null> {
    const step = Math.max(1, Math.floor(slice));
    const bytes = new Uint8Array(new ArrayBuffer(total));
    for (let offset = 0; offset < total; offset += step) {
        const length = Math.min(step, total - offset);
        const part = await fetch(offset, length);
        if (part?.byteLength !== length) return null;
        bytes.set(part, offset);
    }
    return bytes;
}

/** Eine Scheibe als Zeile: ihre Nummer (ab 0) und ihre Byte. */
export interface SliceRow {
    index: number;
    part: Uint8Array;
}

/**
 * Wie viele Scheiben von `slice` Byte `total` Byte ergeben; `readRows` und die Anfrage dahinter zählen gleich
 * (`generate_series(0, Anzahl - 1)`).
 */
export function sliceCount(total: number, slice: number): number {
    return Math.ceil(total / Math.max(1, Math.floor(slice)));
}

/**
 * Wie `readSlices`, aber mit EINER Anfrage: `stream(onRow)` liefert jede Scheibe als Zeile, in beliebiger Reihenfolge
 * (die Anfrage entpackt die Zeile einmal und schneidet die Scheiben aus dem Ergebnis, `terrain-load.ts`). Jede Zeile
 * kommt an ihre Stelle im einen Puffer; fehlt eine, ist eine zu kurz oder doppelt, liefert die Funktion null.
 * Der Puffer ist bis zum Ende gefüllt oder gar nicht zu gebrauchen.
 */
export async function readRows(
    total: number,
    slice: number,
    stream: (onRow: (row: SliceRow) => void) => Promise<void>,
): Promise<Uint8Array | null> {
    const step = Math.max(1, Math.floor(slice));
    const count = sliceCount(total, step);
    const bytes = new Uint8Array(new ArrayBuffer(total));
    const seen = new Uint8Array(count);
    let bad = false;
    await stream((row) => {
        const offset = row.index * step;
        const length = Math.min(step, total - offset);
        if (!Number.isInteger(row.index) || row.index < 0 || row.index >= count) bad = true;
        else if (row.part.byteLength !== length || seen[row.index] === 1) bad = true;
        else {
            bytes.set(row.part, offset);
            seen[row.index] = 1;
        }
    });
    return bad || seen.includes(0) ? null : bytes;
}
