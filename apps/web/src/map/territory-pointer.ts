import { TERRITORY_POINTER_URL, readTerritoryPointer, type TerritoryPointer } from "@avesmaps3d/shared";
import { rememberDerivedMaxBand } from "./territory-band";

/**
 * Liest, welche Revision der abgeleiteten Herrschaftsgebiete gilt (WI-0062, ADR-0014). Wie bei den Anzeigehöhen
 * (`display-height-pointer.ts`):
 *
 * - 404 (nichts abgeleitet, oder ein Import hat die Ableitung entwertet: `no_territories`) und 200 mit HTML (Nginx hat für
 *   den Pfad keinen Ort) heißen „keine Gebiete“: `undefined`. Die Ansicht „Politisch“ bleibt dann ausgegraut, und der
 *   Schalter „Grenzen“ zeichnet nichts - keine alten Gebiete, sondern keine.
 * - 💣 Alles andere scheitert laut: ein 204, ein 5xx, kaputtes JSON, ein Zeiger mit falschem Schema.
 * - 🔴 Tolerant gelesen (WI-0075 R5b): Ein neues Feld des Servers wird ignoriert, was die Karte kennt, prüft sie
 *   streng. Nie `parseTerritoryPointer` hier: Es ist die Prüfung des Servers (`pointer-tolerance.test.ts`).
 *
 * Die Revision steht danach in der Kachel-Adresse (`?rev=`): ein neuer Stand ändert die Adresse, alle Clients holen ihn
 * ohne mehrfaches Laden. Wie weit die Ableitung reicht (`maxBand`, WI-0188), merkt sich die Bandwahl der Karte
 * (`territory-band.ts`): Sie zeigt nie ein höheres Band.
 */
export async function loadTerritoryPointer(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<TerritoryPointer | undefined> {
    const response = await fetcher(TERRITORY_POINTER_URL, { headers: { accept: "application/json" } });
    if (response.status === 404) {
        rememberDerivedMaxBand(undefined);
        return undefined;
    }
    if (response.status !== 200) {
        throw new Error(`${TERRITORY_POINTER_URL} antwortet ${String(response.status)}`);
    }
    if (/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
        rememberDerivedMaxBand(undefined);
        return undefined;
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${TERRITORY_POINTER_URL} ist kein JSON`);
    }
    const pointer = readTerritoryPointer(body);
    rememberDerivedMaxBand(pointer);
    return pointer;
}
