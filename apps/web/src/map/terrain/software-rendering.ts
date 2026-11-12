/**
 * Zeichnet der Browser ohne Grafikkarte? Dann bleibt die Karte auch geneigt flach (WI-0049, Betreiber
 * 2026-09-27: „3: A“).
 *
 * Gemessen: Ohne Grafikkarte (SwiftShader) kostet das Gelände rund das Siebenfache je Bild, 55 statt
 * 404 Bilder in 10 s im Playmode. Mit Grafikkarte bleiben es 60 je Sekunde. Betroffen sind etwa
 * virtuelle Maschinen und Rechner, deren Grafiktreiber der Browser sperrt. Dort sind 3D, Kippen und
 * Drehen weiter da, nur ohne Berge.
 */

/** Bekannte Software-Rasterer in der Kennung, die der Browser nennt (Chrome, Firefox, Safari, Mesa). */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|software (rasterizer|renderer|adapter)/i;

/** Nennt diese Kennung einen Software-Rasterer? */
export function isSoftwareRenderer(renderer: string | undefined): boolean {
    return renderer !== undefined && SOFTWARE.test(renderer);
}

/**
 * Prüft einmal mit einer eigenen, sofort wieder freigegebenen WebGL2-Fläche.
 *
 * Zwei Zeichen, jedes genügt:
 * - `failIfMajorPerformanceCaveat`: Der Browser verweigert die Fläche, wenn er nur langsam zeichnen
 *   könnte. Das ist genau die Frage und hängt an keinem Herstellernamen.
 * - die Kennung des Rasterers, für Browser, die trotzdem eine Fläche geben.
 *
 * @returns den Grund, wenn ohne Grafikkarte gezeichnet wird, sonst `undefined`.
 */
export function detectSoftwareRendering(document: Document | undefined = globalThis.document): string | undefined {
    const canvas = document?.createElement("canvas");
    if (!canvas) {
        return undefined;
    }
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) {
        return "der Browser meldet eine langsame Darstellung (failIfMajorPerformanceCaveat)";
    }
    try {
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
        return isSoftwareRenderer(renderer) ? renderer : undefined;
    } finally {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}
