import { rasterPointerUrl, readRasterPointer, type RasterPyramidPointer } from "@avesmaps3d/shared";

/**
 * Liest, welche Revision der Grundkarte gilt (ADR-0008).
 *
 * Die Karte fragt beim Start und bei jedem Serienwechsel nach. `current.json` kommt mit
 * `no-cache`: der Browser behält die Datei, fragt aber jedes Mal nach und bekommt ein 304, solange
 * sie gilt. Ein Pyramidenneubau erreicht Besucher damit beim nächsten Laden, ohne Frontend-Deploy.
 *
 * 💣 Nur 200 zählt. Auf Staging beantwortet Nginx jede fehlende Datei unter `/tiles/raster/` mit
 * **204** - ein leerer Rumpf, der `response.ok` besteht. Und ein SPA-Fallback käme mit 200 und
 * HTML. Beides muss hier scheitern, nicht als „keine Grundkarte" durchrutschen.
 *
 * 🔴 Tolerant gelesen (WI-0075 R5b): Ein Feld, das der Server neu dazugibt, wird ignoriert; was die Karte kennt
 * (Serie, Revision, Manifest, Format, Größe), prüft sie streng. Nie `parseRasterPointer` hier: Es ist die Prüfung
 * des Servers (`pointer-tolerance.test.ts`).
 */
export async function loadRasterPointer(
    seriesId: string,
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RasterPyramidPointer> {
    const url = rasterPointerUrl(seriesId);
    const response = await fetcher(url, { headers: { accept: "application/json" } });
    if (response.status !== 200) {
        throw new Error(`${url} antwortet ${response.status}`);
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${url} ist kein JSON`);
    }
    return readRasterPointer(body, seriesId);
}
