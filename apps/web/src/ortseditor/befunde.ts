import type { EditorPlaceDetail } from "@avesmaps3d/shared";
import type { Entwurf } from "./entwurf";

/**
 * Prüfen (WI-0128 E20; WI-0126 §5.5; EDIT-0001 §7.1 E20): Befunde zum Ort, **nie eine Sperre**. Sie stehen nach dem Loslassen und vor
 * dem Speichern da, einmal je Art, nie während einer Geste (dann ist das Fenster eingeklappt). Reine Rechnung ohne Vue, damit Vitest
 * sie prüft.
 *
 * - **Anbindung** (H4 „Unverbunden“): kein Wegende am Ort. Ein verborgener Ort ohne Weg ist kein Befund (Legacy-Nachtrag 2026-10-09).
 * - **Offene Wegenden**: nach einem Verschieben mit Strg blieben Enden liegen; „Zum nächsten“ zeigt die Stelle.
 * - **Gebiet**: Hauptstadt außerhalb ihres Gebiets (Kap. 7.42, vom Server).
 * - **Name**: kommt schon vor, mit Legacys Vorschlag „Name (Region)“ (\`features.php\`). Bei uns ein Befund, kein Tor (WI-0126 §2).
 * - **Wasser**: Seehafen ohne Meer oder See in Reichweite einer Anlegestelle.
 * - **Wiki**: kein Artikel zugewiesen (H9 als Zustand).
 */

export type Befund =
    | { readonly art: "unverbunden" }
    | { readonly art: "offeneWegenden"; readonly anzahl: number; readonly bei?: { x: number; y: number } | undefined }
    | { readonly art: "gebiet"; readonly gebiete: readonly string[] }
    | { readonly art: "name"; readonly vorschlag?: string | undefined }
    | { readonly art: "wasser" }
    | { readonly art: "wiki" };

export interface PruefStand {
    /** Die Namen der ANDEREN Orte, klein geschrieben (aus der Ortsliste). */
    readonly namen: ReadonlySet<string>;
    /** Die Region des Orts (Region, sonst Staat) für den Namensvorschlag. */
    readonly region?: string | undefined;
    /** Nach einem Verschieben mit Strg: wie viele Enden liegen blieben und wo. */
    readonly liegen?: { readonly anzahl: number; readonly bei?: { x: number; y: number } | undefined } | undefined;
}

const klein = (name: string): string => name.trim().toLowerCase();

export function befunde(detail: EditorPlaceDetail, entwurf: Entwurf, stand: PruefStand): Befund[] {
    const raus: Befund[] = [];
    if (detail.position !== undefined && detail.pathEnds.length === 0 && !entwurf.hidden)
        raus.push({ art: "unverbunden" });
    if (stand.liegen !== undefined && stand.liegen.anzahl > 0)
        raus.push({ art: "offeneWegenden", anzahl: stand.liegen.anzahl, bei: stand.liegen.bei });
    if (detail.capitalOutside !== undefined && detail.capitalOutside.length > 0)
        raus.push({ art: "gebiet", gebiete: detail.capitalOutside });
    const name = entwurf.name.trim();
    if (name !== "" && stand.namen.has(klein(name))) {
        const vorschlag = stand.region ? `${name} (${stand.region})` : undefined;
        raus.push({ art: "name", vorschlag: vorschlag && !stand.namen.has(klein(vorschlag)) ? vorschlag : undefined });
    }
    if (entwurf.seaport && detail.waterNearby === false) raus.push({ art: "wasser" });
    if (detail.wiki === null || detail.wiki.state !== "assigned") raus.push({ art: "wiki" });
    return raus;
}
