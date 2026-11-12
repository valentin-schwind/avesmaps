import { readTerrainPointer, TERRAIN_POINTER_URL, type TerrainDemPointer } from "@avesmaps3d/shared";

/**
 * Liest, welche Revision des Geländes gilt (WI-0049, ADR-0008).
 *
 * `undefined` heißt: Es gibt kein Gelände. Das ist ein Zustand, kein Fehler - die Karte ist dann flach
 * wie vor WI-0049. Zwei Antworten meinen das:
 * - 404: Es ist nichts abgeleitet (lokal vor `derive:terrain`).
 * - 503 `feature_paused`: Die Systemsteuerung hat das 3D-Gelände pausiert (WI-0127 SYS-11); die Karte bleibt flach.
 * - 200 mit HTML: Nginx hat für `/tiles/terrain/dem/` keinen Ort und liefert die App-Seite. So steht es auf
 *   Stage und Production, bis das Gelände dort ankommt (Koordination 2026-09-27: jeder Besucher sah
 *   sonst einen roten Konsolenfehler).
 *
 * 💣 Alles andere scheitert laut: ein 204, ein 5xx, JSON, das keines ist, und ein Zeiger mit falschem
 * Schema. Das sind echte Fehler und rutschen nicht als „kein Gelände“ durch.
 *
 * 🔴 Tolerant gelesen (WI-0075 R5b): Ein Feld, das der Server neu dazugibt (so wie `format` in WI-0073), wird
 * ignoriert und macht den Zeiger nicht ungültig; was die Karte kennt, prüft sie streng. Der Server prüft streng
 * beim Senden. Nie `parseTerrainPointer` hier: Es ist die Prüfung des Servers (`pointer-tolerance.test.ts`).
 */
export async function loadTerrainPointer(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<TerrainDemPointer | undefined> {
    const response = await fetcher(TERRAIN_POINTER_URL, { headers: { accept: "application/json" } });
    if (response.status === 404) {
        return undefined;
    }
    if (response.status === 503) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
        if (body?.error?.code === "feature_paused") return undefined;
    }
    if (response.status !== 200) {
        throw new Error(`${TERRAIN_POINTER_URL} antwortet ${response.status}`);
    }
    if (/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
        return undefined;
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${TERRAIN_POINTER_URL} ist kein JSON`);
    }
    return readTerrainPointer(body);
}
