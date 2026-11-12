import { Value } from "@sinclair/typebox/value";
import { PathCartography, type PathStyle } from "./path-cartography.ts";
import aventuriaPaths from "../../../config/map-cartography/aventuria-paths.json" with { type: "json" };

function parsePathCartography(candidate: unknown, fileName: string): PathCartography {
    if (!Value.Check(PathCartography, candidate)) {
        const [firstError] = [...Value.Errors(PathCartography, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid path cartography in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_PATH_CARTOGRAPHY: PathCartography = parsePathCartography(aventuriaPaths, "aventuria-paths.json");

/**
 * Die Wegarten in Zeichenreihenfolge, von unten nach oben.
 *
 * 🪤 Das Wasser liegt UNTEN. Eine Straße, die einen Fluss quert, gehört über ihn — sonst sieht es
 * aus, als ende sie im Wasser. Legacy zieht die Reihenfolge nach jedem Ein- und Ausblenden neu
 * (`bringToFront`); bei uns ist sie die Layerreihenfolge im Stil und damit von selbst stabil.
 */
export function pathTypesInDrawOrder(): { subtype: string; style: PathStyle }[] {
    return Object.entries(AVENTURIA_PATH_CARTOGRAPHY.types)
        .map(([subtype, style]) => ({ subtype, style }))
        .sort((a, b) => a.style.order - b.style.order);
}

/**
 * Der Stil einer Wegart.
 *
 * 💣 Eine unbekannte Art wirft, statt auf einen Auffangwert zu fallen. Das ist die Umkehrung der
 * Landschaftstafel, und mit Absicht: dort gibt es 24 Arten aus einer wachsenden redaktionellen
 * Liste, hier acht aus einem CHECK in der Datenbank. Eine neunte kann nur durch eine Migration
 * entstehen — und dann soll der Build es sagen, nicht die Karte es verschweigen.
 */
/**
 * Ist diese Wegart WASSER? Die Tafel der Wege führt es selbst (`water.types`): der Flussweg samt seinem Bach und der
 * Seeweg (der auf keiner Karte steht, `hidden`).
 *
 * 🪤 Keine zweite Liste neben der Tafel: An derselben Stelle hängt schon, welche Linie im Überblick dünn und ohne weiße
 * Kontur gezeichnet wird. Daran hängt seit WI-0083 (Nachtrag) auch, in welcher Ansicht ein Fluss wählbar ist - über die
 * Ebene des Wassers (`WATER_CARTOGRAPHY_LAYER`).
 */
export function isWaterPathSubtype(subtype: string): boolean {
    return (AVENTURIA_PATH_CARTOGRAPHY.water.types as readonly string[]).includes(subtype);
}

export function pathStyleFor(subtype: string): PathStyle {
    const style = AVENTURIA_PATH_CARTOGRAPHY.types[subtype];
    if (!style) {
        throw new Error(`path cartography has no style for subtype "${subtype}"`);
    }
    return style;
}
