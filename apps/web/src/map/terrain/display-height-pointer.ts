import {
    DISPLAY_HEIGHT_POINTER_URL,
    readDisplayHeightPointer,
    type DisplayHeightPointer,
    type TerrainDemPointer,
} from "@avesmaps3d/shared";

/**
 * Liest, welche Revision der Anzeigehöhen gilt (WI-0055): Höhenlinien und Höhenstufen. Wie beim Relief
 * (`visual-relief-pointer.ts`):
 *
 * - 404 (nichts abgeleitet, oder die Revision gehört zu einem älteren Gelände: `display_height_stale`) und 200
 *   mit HTML (Nginx hat für den Pfad keinen Ort) heißen „keine Anzeigehöhen“: `undefined`, die Topographie zeigt
 *   dann weder Linien noch Stufen.
 * - 💣 Alles andere scheitert laut: ein 204, ein 5xx, kaputtes JSON, ein Zeiger mit falschem Schema.
 * - 🔴 Tolerant gelesen (WI-0075 R5b): Ein neues Feld des Servers wird ignoriert, was die Karte kennt, prüft sie
 *   streng. Nie `parseDisplayHeightPointer` hier: Es ist die Prüfung des Servers (`pointer-tolerance.test.ts`).
 */
export async function loadDisplayHeightPointer(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<DisplayHeightPointer | undefined> {
    const response = await fetcher(DISPLAY_HEIGHT_POINTER_URL, { headers: { accept: "application/json" } });
    if (response.status === 404) {
        return undefined;
    }
    if (response.status !== 200) {
        throw new Error(`${DISPLAY_HEIGHT_POINTER_URL} antwortet ${response.status}`);
    }
    if (/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
        return undefined;
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${DISPLAY_HEIGHT_POINTER_URL} ist kein JSON`);
    }
    return readDisplayHeightPointer(body);
}

/**
 * Die Anzeigehöhen, wenn sie zum Gelände gehören, das die Karte zeigt (Kapitel 5.32a, Regel 2; Hardening-Review
 * M4). Der Server prüft dasselbe schon am Zeiger; hier gilt es für eine Karte, die das Gelände selbst gelesen
 * hat. Ohne Gelände (keine Grafikkarte, kein Zeiger) bleibt die Prüfung des Servers.
 */
export function displayHeightFor(
    pointer: DisplayHeightPointer | undefined,
    terrain: TerrainDemPointer | undefined,
): DisplayHeightPointer | undefined {
    if (!pointer) return undefined;
    return terrain === undefined || pointer.demRevision === terrain.revision ? pointer : undefined;
}
