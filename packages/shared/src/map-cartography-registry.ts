import { Value } from "@sinclair/typebox/value";
import { MapCartography, type CartographyLayer, type CartographyType } from "./map-cartography.ts";
import aventuriaCartography from "../../../config/map-cartography/aventuria.json" with { type: "json" };

/** Lädt die Kartografie aus config/map-cartography, einmal validiert. */
function parseCartography(candidate: unknown, fileName: string): MapCartography {
    if (!Value.Check(MapCartography, candidate)) {
        const [firstError] = [...Value.Errors(MapCartography, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid map cartography in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_CARTOGRAPHY: MapCartography = parseCartography(aventuriaCartography, "aventuria.json");

/** Der Auffangwert für eine Region, deren Art die Tafel nicht kennt. */
export const CARTOGRAPHY_FALLBACK_TYPE = "sonstiges";

/**
 * Die Farbe einer Landschaftsart.
 *
 * 🪤 Eine unbekannte Art bekommt den Auffangwert und wird damit sichtbar grau — nicht unsichtbar.
 * Eine Fläche, die verschwindet, weil jemand eine Art hinzugefügt hat, fällt auf der Karte
 * niemandem auf; eine graue Fläche schon. Der Test darüber fängt den Fall vorher ab.
 */
export function cartographyForType(regionType: string | null | undefined): CartographyType {
    const fallback = AVENTURIA_CARTOGRAPHY.types[CARTOGRAPHY_FALLBACK_TYPE];
    if (!fallback) {
        throw new Error(`map cartography has no fallback type "${CARTOGRAPHY_FALLBACK_TYPE}"`);
    }
    if (!regionType) {
        return fallback;
    }
    return AVENTURIA_CARTOGRAPHY.types[regionType] ?? fallback;
}

/**
 * Die Landschaftsarten des Wassers: der See und das Meer. Sie sind die EINE Liste dafür - die Karte liest sie für die
 * geglättete Quelle (`terrain_water_render` führt genau diese beiden Arten), und die Auswahl liest sie, um die Ebene des
 * Wassers daraus abzuleiten.
 */
export const WATER_AREA_TYPES = ["see", "meer"] as const;
export type WaterAreaType = (typeof WATER_AREA_TYPES)[number];

/**
 * Die Landschaftsebene des WASSERS, aus der Kartografie-Tafel abgeleitet (heute `topographie`).
 *
 * 🔴 Sie gibt es, weil ein Fluss Wasser ist wie ein See (WI-0083 Nachtrag, Betreiber 2026-10-05 „ja“ auf die Vorlage:
 * „Ein Fluss ist Wasser wie ein See: überall sichtbar, wählbar nur in Topographie und ‚Alle‘“). Ein Fluss ist in unseren
 * Daten aber ein WEG (`path`, Art `Flussweg`) und trägt selbst keine Landschaftsebene; seine Zugehörigkeit entsteht
 * deshalb über das Wasser, dessen Arten die Tafel führt - dieselbe Tafel und derselbe Weg, den die Flächenauswahl für See
 * und Meer schon geht (`cartographyForType(type).layer`).
 *
 * 🪤 Keine zweite Liste: Wer in der Tafel das Wasser in eine andere Ebene legt, nimmt die Flüsse mit. Genau das ist
 * gewollt. Stehen See und Meer je in VERSCHIEDENEN Ebenen, wirft das Laden - dann gibt es keine eine Ebene des Wassers
 * mehr, und die Antwort wäre geraten (dieselbe Strenge wie bei `pathStyleFor`: der Build sagt es, nicht die Karte).
 */
export const WATER_CARTOGRAPHY_LAYER: string = (() => {
    const layers = new Set(WATER_AREA_TYPES.map((type) => cartographyForType(type).layer));
    if (layers.size !== 1) {
        throw new Error(`map cartography puts water types in ${String(layers.size)} layers: ${[...layers].join(", ")}`);
    }
    return [...layers][0] as string;
})();

/** Die Ebenen in Zeichenreihenfolge, von unten nach oben. */
export function cartographyLayersInOrder(): { layer: string; style: CartographyLayer }[] {
    return Object.entries(AVENTURIA_CARTOGRAPHY.layers)
        .map(([layer, style]) => ({ layer, style }))
        .sort((left, right) => left.style.order - right.style.order);
}

/** Alle Arten einer Ebene, alphabetisch — die Reihenfolge einer `match`-Liste soll stabil sein. */
export function cartographyTypesOfLayer(layer: string): { type: string; fill: string }[] {
    return Object.entries(AVENTURIA_CARTOGRAPHY.types)
        .filter(([, entry]) => entry.layer === layer)
        .map(([type, entry]) => ({ type, fill: entry.fill }))
        .sort((left, right) => left.type.localeCompare(right.type));
}
