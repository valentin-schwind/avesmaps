import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { SPRACHE_FILL_LAYER_ID, SPRACHE_LINE_LAYER_ID } from "./sprachen-layers";

/**
 * Die Farbe einer Sprache im Entwurf, live auf der Karte (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` `farbeDekorieren`: „Die Karte folgt
 * der Eingabe sofort; ‚Fertig‘ im Fuß speichert“, `karte.js` `vorschau`). Füllung und Kontur der Sprache nehmen die Farbe des Entwurfs,
 * alle übrigen bleiben bei der Farbe ihrer Kachel (`farbe`).
 *
 * - **Kein neuer Stil:** Die Farbe wechselt mit jedem Zug am Farbwähler; ein neuer Stil je Zug wäre zu teuer. Darum setzt die Vorschau nur
 *   die Farbe der beiden Ebenen (`setPaintProperty`) und setzt sie nach einem neuen Stil wieder (`styledata`), nur wenn sie dort fehlt.
 * - Die Schraffur der Mischgebiete und die Namen behalten die gespeicherte Farbe, bis „Fertig“ schreibt; dann kommen die Kacheln neu.
 * - 🪤 Jeder Wechsel der Farbe ist datengetrieben und hält in MapLibre 6.10 den Verwalter der Quelle `sprachen` bis zum nächsten Bild an.
 *   Nach „Fertig“ geschieht das im selben Takt wie `setTiles` der neuen Revision; das verworfene Neuladen holt `edit-revision.ts` nach
 *   (`setzeKachelnBewacht`). Fund der Sichtprüfung 2026-10-30: ohne das blieb Garethi in der alten Farbe.
 */

export interface SprachVorschau {
    readonly schluessel: string;
    /** `#rrggbb`. */
    readonly farbe: string;
}

const KACHELFARBE: ExpressionSpecification = ["get", "farbe"];

/** Die Farbe der Ebene: die Sprache im Entwurf in ihrer neuen Farbe, alle anderen in der Farbe ihrer Kachel. */
export function vorschauFarbe(vorschau: SprachVorschau | undefined): ExpressionSpecification {
    if (vorschau === undefined) return KACHELFARBE;
    return ["case", ["==", ["get", "schluessel"], vorschau.schluessel], vorschau.farbe, KACHELFARBE];
}

const EBENEN = [
    [SPRACHE_FILL_LAYER_ID, "fill-color"],
    [SPRACHE_LINE_LAYER_ID, "line-color"],
] as const;

export interface SprachVorschauKarte {
    zeige(vorschau: SprachVorschau | undefined): void;
    destroy(): void;
}

/** Hängt die Vorschau an die Karte; ohne Ebene „Sprachen“ im Stil geschieht nichts, bis sie kommt. */
export function installSprachVorschau(map: MapLibreMap): SprachVorschauKarte {
    let jetzt: SprachVorschau | undefined;
    function setze(): void {
        const soll = vorschauFarbe(jetzt);
        const text = JSON.stringify(soll);
        for (const [ebene, eigenschaft] of EBENEN) {
            if (map.getLayer(ebene) === undefined) continue;
            // Nur, wenn sie fehlt: Sonst löste das Setzen das nächste `styledata` aus.
            if (JSON.stringify(map.getPaintProperty(ebene, eigenschaft)) === text) continue;
            map.setPaintProperty(ebene, eigenschaft, soll);
        }
    }
    map.on("styledata", setze);
    return {
        zeige(vorschau) {
            jetzt = vorschau;
            setze();
        },
        destroy() {
            map.off("styledata", setze);
        },
    };
}
