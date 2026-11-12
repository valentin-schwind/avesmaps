import { TERRITORY_COATS_URL, readTerritoryCoats, territoryCoatImages } from "@avesmaps3d/shared";

/**
 * Liest, welche Herrschaftsgebiete ein öffentliches Wappen tragen (WI-0121), und gibt es als Liste für den Stil zurück:
 * Kennung des Gebiets → Bildname (`coat:<sha256>`).
 *
 * - 404 und 200 mit HTML (Nginx hat für den Pfad keinen Ort, eine ältere Instanz kennt die Route nicht) heißen „keine
 *   Wappen“: eine leere Liste, und die Namen stehen allein, wie sie standen.
 * - 💣 Alles andere scheitert laut: ein 204, ein 5xx, kaputtes JSON, eine Liste mit falschem Schema. Die Karte fängt es und
 *   baut ohne Wappen - ein fehlendes Wappen ist kein Grund, die Karte nicht zu zeigen (`app.vue`).
 * - 🔴 Tolerant gelesen (`readTerritoryCoats`, WI-0075 R5b): Ein neues Feld des Servers wird ignoriert.
 *
 * Gelesen wird VOR dem Aufbau des Stils, nicht danach: Kämen die Wappen später, sprängen die Namen um die Höhe des Wappens
 * nach unten, sobald die Liste da ist.
 */
export async function loadTerritoryCoats(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Record<string, string>> {
    const response = await fetcher(TERRITORY_COATS_URL, { headers: { accept: "application/json" } });
    if (response.status === 404) return {};
    if (response.status !== 200) {
        throw new Error(`${TERRITORY_COATS_URL} antwortet ${String(response.status)}`);
    }
    if (/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) return {};
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${TERRITORY_COATS_URL} ist kein JSON`);
    }
    return territoryCoatImages(readTerritoryCoats(body));
}
