import { open } from "node:fs/promises";

/**
 * Die Wurzel eines SVG-Abzugs (WI-0280, Vertrag der Terrain-Pipeline): Fassungen, Zeit und Glättung aus dem öffnenden `<svg …>`-Tag der Datei selbst.
 *
 * 🔴 Die Kopfzeilen der Antwort nehmen diese Werte und nicht den Zeiger. Die Pipeline verlangt dieselben Zahlen in Kopfzeile und Wurzel, und die Datei ist die eine
 * Quelle dafür (Legacy, `api/svg-export.php`: „die Wurzelattribute sind die Wahrheit, nicht der Parameter“).
 * 💣 Nur im öffnenden Tag: Ein `avm:geglaettet="ja"` weiter unten (Metadaten, Vokabular) darf nichts entscheiden.
 */

export interface SvgWurzel {
    readonly kartenfassung: string | null;
    readonly landschaftsfassung: string | null;
    readonly exportiert: string | null;
    /** Trägt die Datei Kurven (Wege oder Flächen geglättet)? */
    readonly geglaettet: boolean;
}

/** Die Wurzel steht hinter der XML-Deklaration in den ersten paar Hundert Bytes; 8 KB lassen Platz für Namensräume. */
const KOPF_BYTES = 8192;

/** Abzüge heißen nach ihrem Inhalt (`<id>-<sha12>.svg`) und ändern sich nie: Was einmal gelesen ist, gilt. */
const gemerkt = new Map<string, SvgWurzel>();

export function svgWurzelAus(text: string): SvgWurzel | null {
    const tag = /<svg\b[^>]*>/u.exec(text)?.[0];
    if (tag === undefined) return null;
    const wert = (name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? null;
    return {
        kartenfassung: wert("avm:kartenfassung"),
        landschaftsfassung: wert("avm:landschaftsfassung"),
        exportiert: wert("avm:exportiert"),
        geglaettet: wert("avm:geglaettet") === "ja" || wert("avm:flaechen_geglaettet") === "ja",
    };
}

export async function leseSvgWurzel(pfad: string): Promise<SvgWurzel | null> {
    const bekannt = gemerkt.get(pfad);
    if (bekannt !== undefined) return bekannt;
    const datei = await open(pfad, "r");
    try {
        const puffer = Buffer.alloc(KOPF_BYTES);
        const { bytesRead } = await datei.read(puffer, 0, KOPF_BYTES, 0);
        const wurzel = svgWurzelAus(puffer.subarray(0, bytesRead).toString("utf8"));
        if (wurzel !== null) gemerkt.set(pfad, wurzel);
        return wurzel;
    } finally {
        await datei.close();
    }
}
