import type { Wegfindungswerte } from "@avesmaps3d/shared";
import { werte } from "./einstellungen.ts";
import { nearestWaterCell, type NavigableWater, type SeaGrid } from "./sea-grid.ts";
import { distanceToWater, type SeaPort } from "./sea-ports.ts";

/**
 * Häfen ohne Wasser-Zugang (WI-0060, WI-0046 S3): Findet die Regel H1 für einen Hafen keine Anlegestelle, fehlt er im
 * Seegraphen und ist per Schiff nicht erreichbar. Hier steht, WARUM, damit die Redaktion sieht, was an der Karte fehlt.
 * Gespeichert oder korrigiert wird nichts (Cutoff-Regel, AGENTS.md): `derive:sea-routes` nennt die Häfen, `legacy:update`
 * stellt sie in seinen Bericht. Ein Befund, nie ein Tor (Betreiber 2026-10-03).
 */

export type LandlessReason =
    /** Befahrbares Wasser in Reichweite, aber nur in einem abgetrennten Stück unter der Mindestfläche. */
    | "gewaesser_zu_klein"
    /** Gezeichnetes Meer oder gezeichneter See in Reichweite, aber keine Zellmitte darin: schmaler als das Raster. */
    | "wasser_zu_schmal"
    /** Kein Meer und kein See in Reichweite. */
    | "wasser_fern";

export interface LandlessPort {
    id: string;
    name: string;
    /** Fehlt in einem Seegraphen, der vor WI-0060 abgeleitet wurde; `deriveSeaRoutes` rechnet ihn dann nach. */
    reason?: LandlessReason;
    /** Abstand zum Wasser, das der Grund meint, in Karteneinheiten; null: kein Wasser in `FAR_SEARCH`. */
    distance?: number | null;
}

/** So weit sucht der Grund `wasser_fern` nach dem nächsten Wasser, in Karteneinheiten (wie die Messung in WI-0046). */
export const FAR_SEARCH = 50;

/**
 * Warum ein Hafen keine Anlegestelle hat. Nur für Häfen, für die `nearestWaterCell` mit der Mindestfläche nichts fand:
 * Findet es ohne sie etwas, liegt in Reichweite nur ein zu kleines Stück Wasser; sonst entscheidet das gezeichnete Wasser.
 */
export function landlessPort(
    grid: SeaGrid,
    water: NavigableWater,
    port: SeaPort,
    // Die Ableitung reicht die Werte, mit denen sie rechnet (WI-0153 Schnitt 7a); ohne sie die des Prozesses.
    w: Pick<Wegfindungswerte, "landingReach" | "farSearch"> = werte(),
): LandlessPort {
    const small = nearestWaterCell(grid, port.x, port.y, w.landingReach, 0);
    if (small) return { id: port.id, name: port.name, reason: "gewaesser_zu_klein", distance: small.distance };
    const drawn = distanceToWater(water, port.x, port.y, w.farSearch);
    return {
        id: port.id,
        name: port.name,
        reason: drawn <= w.landingReach ? "wasser_zu_schmal" : "wasser_fern",
        distance: Number.isFinite(drawn) ? drawn : null,
    };
}

/** Eine Zahl mit einer Nachkommastelle und Komma, wie die Berichte sie schreiben. */
function units(value: number): string {
    return value.toFixed(1).replace(".", ",");
}

/** Was der Satz zum Grund aus den Einstellungen des Seegraphen nennt (`SEA_ROUTE_SETTINGS`). */
export interface LandlessSettings {
    cell: number;
    minArea: number;
    /** Die Werte der Ableitung (WI-0153 Schnitt 7a); ohne sie die des Prozesses. */
    landingReach?: number;
    farSearch?: number;
}

/** Der Grund in einem Satz, für den Bericht und die Ausgabe von `derive:sea-routes` (E = Karteneinheit, 3 Meilen). */
export function describeLandless(port: LandlessPort, settings: LandlessSettings): string {
    const w = {
        landingReach: settings.landingReach ?? werte().landingReach,
        farSearch: settings.farSearch ?? werte().farSearch,
    };
    const at = port.distance === null || port.distance === undefined ? null : `${units(port.distance)} E`;
    switch (port.reason) {
        case "gewaesser_zu_klein":
            return `Gewässer zu klein: befahrbares Wasser ${at ?? "?"} entfernt, aber nur ein abgetrenntes Stück unter ${String(settings.minArea)} E²`;
        case "wasser_zu_schmal":
            return `Wasser zu schmal: Meer oder See ${at ?? "?"} entfernt, aber schmaler als das Raster der Seefahrt (${units(settings.cell)} E)`;
        case "wasser_fern":
            return at === null
                ? `kein Meer und kein See in ${String(w.farSearch)} E`
                : `kein Meer und kein See in ${String(w.landingReach)} E, das nächste ${at} entfernt`;
        default:
            return "Grund nicht gespeichert";
    }
}
