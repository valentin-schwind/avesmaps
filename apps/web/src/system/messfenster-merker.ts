import { merkSchluessel } from "../editor-panel/fenster-verwaltung";
import type { Speicher } from "../editor-panel/editor-panel-nav";

/**
 * Bleibt das Messfenster offen? (WI-0150, Kanal OPS-000002 von Thomas: „Links unten immer sichtbar (im Editormodus) ein
 * Informationsfenster" mit Prozessor, Speicher, Nutzerzahl und Editoren.)
 *
 * Die vier Werte gibt es längst (`mess-werte.vue`), gelöst über der Karte auch das Fenster (WI-0138 V15) — es ging nach
 * jedem Neuladen verloren. Gemerkt wird deshalb, **ob** es offen war; **wo** es stand, merkt die Fensterverwaltung schon
 * (`werkzeugfenster.ts`, Lage und Box unter demselben Schlüsselstamm). Beides zusammen ergibt „immer sichtbar", ohne eine
 * neue Einstellung und ohne ein Fenster, das jemandem ungefragt aufgeht: Der Editor öffnet es einmal, danach ist es da.
 *
 * Dasselbe Muster hält das Editorpanel offen (`editor-panel-nav.ts`, `oeffnetBeimLaden`); 🔴 jeder Zugriff steht in
 * `try/catch` — ohne Speicher gilt die Wahl bis zum Neuladen.
 */

/** Unter diesem Schlüssel steht, ob das Messfenster offen war; die Lage desselben Werkzeugs liegt ohne das Suffix daneben. */
export const MESSFENSTER_OFFEN_SCHLUESSEL = `${merkSchluessel("messwerte")}.offen`;

/**
 * Geht das Messfenster beim Laden auf? Nur, wenn es beim letzten Mal offen war.
 *
 * 🔴 Am Telefon nie (EDIT-0001 §7.1 E3): Ein Werkzeugfenster wird dort angedockt gezeichnet und deckt die ganze Karte.
 */
export function messfensterOeffnetBeimLaden(speicher: Speicher | undefined, telefon: boolean): boolean {
    if (telefon) return false;
    try {
        return speicher?.getItem(MESSFENSTER_OFFEN_SCHLUESSEL) === "offen";
    } catch {
        return false;
    }
}

/** Merkt, ob das Messfenster offen ist. */
export function merkeMessfensterOffen(speicher: Speicher | undefined, offen: boolean): void {
    try {
        speicher?.setItem(MESSFENSTER_OFFEN_SCHLUESSEL, offen ? "offen" : "zu");
    } catch {
        // Ohne Speicher gilt die Wahl bis zum Neuladen.
    }
}
