import type { FilterSpecification, LayerSpecification } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";

/**
 * Was das Leuchten der Suche (`such-leuchten.ts`, Gold) und das der gewählten Vorkommen (`vorkommen-leuchten.ts`, je Vorkommen eine Farbe; WI-0257 S5) gemeinsam
 * brauchen: Kartenkoordinaten in Renderkoordinaten, den Filter auf Kennungen und die Stelle im Stil.
 */

type Position = [number, number];

/**
 * Ab so vielen ganzen Gegenden (oder Gebieten) leuchtet nur noch Füllung und Kontur, ohne den weichen Schein (WI-0266, Vali 2026-10-31: „ja mach
 * den schein weg“). Gemessen auf der Stage mit „Wolf“ (2.958 Gegenden, Zoom 2,3): Schein und Kontur zeichnen dieselben Umrisse, je 1,24 Mio. der
 * 3,9 Mio. Indizes je Bild, der Schein dazu weichgezeichnet. Bei wenigen Gegenden bleibt er: Dort hebt er sie vom Gelände ab und kostet kaum etwas.
 */
export const SCHEIN_BIS_GEGENDEN = 200;

/** Ein Punkt aus Kartenkoordinaten in Renderkoordinaten. */
export function renderPunkt([x, y]: Position): Position {
    const at = toRenderLngLat(AVENTURIA.coordinateSpace, { x, y });
    return [at.lng, at.lat];
}

/** Eine verschachtelte Koordinatenliste (Polygon, Mehrfachpolygon) aus Kartenkoordinaten in Renderkoordinaten. */
export function renderKoordinaten(koordinaten: unknown): unknown {
    if (!Array.isArray(koordinaten)) return koordinaten;
    if (koordinaten.length === 2 && typeof koordinaten[0] === "number" && typeof koordinaten[1] === "number") {
        return renderPunkt([koordinaten[0], koordinaten[1]]);
    }
    return koordinaten.map(renderKoordinaten);
}

/** Der Filter „Kennung ist eine dieser“: bis zu 64 Kennungen als `in`, darüber als `match` (Nachschlagetabelle statt Durchlauf). */
export function kennungsFilter(eigenschaft: string, ids: readonly string[]): FilterSpecification {
    if (ids.length <= 64) return ["in", ["get", eigenschaft], ["literal", [...ids]]] as unknown as FilterSpecification;
    return ["match", ["get", eigenschaft], [...ids], true, false] as unknown as FilterSpecification;
}

/**
 * Wo das Leuchten im Stil liegt: über den Flächen, Wegen und der Auswahl, unter der Route, der Messung und allen Marken und Namen. Gesucht wird die erste Ebene, die zu diesen gehört; vor ihr steht das
 * Leuchten (die Route bliebe sonst unter dem Gold verborgen).
 */
export const UNTER_DIESEN = ["route-", "measure-", "territory-border-name", "path-label", "place-"] as const;

/** Setzt die Ebenen des Leuchtens an ihre Stelle (über den Flächen, unter Route, Marken und Namen); ohne diese Ebenen ans Ende. */
export function setzeLeuchten(
    layers: readonly LayerSpecification[],
    neu: readonly LayerSpecification[],
): LayerSpecification[] {
    const alle = [...layers];
    const stelle = alle.findIndex((ebene) => UNTER_DIESEN.some((anfang) => ebene.id.startsWith(anfang)));
    alle.splice(stelle < 0 ? alle.length : stelle, 0, ...neu);
    return alle;
}
