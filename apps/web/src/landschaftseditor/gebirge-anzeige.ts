import { ref, shallowRef } from "vue";
import type { EditorGebirge, V12Bounds } from "@avesmaps3d/shared";
import type { VorschauErgebnis } from "../gebirge-vorschau/auftrag";

/**
 * Die Umschalter über der Vorschau im Reiter „Gebirge“ (Betreiber 2026-10-21, wörtlich: „über dem preview zwei toogle buttons zu haben:
 * "Kämme zeichnen", "Kämme anzeigen" (gültig für preview und viewport, für kämme und nebengipfel)“ und „neben "Kämme zeichnen" über dem
 * preview kann also auch ein toggle-button "Kartenvorschau"“). Für alle Gebirge gleich und nur in dieser Sitzung; die Vorschau im Reiter,
 * das Netz auf der Karte (`kamm-netz-anbindung.ts`) und das Bild im Umriss (`landschaftseditor-fenster.vue`) lesen dieselben Werte.
 */

/** Kämme und Nebengipfel in der Vorschau und auf der Karte. */
export const kaemmeAnzeigen = ref(true);
/** Das Bild der Vorschau im Umriss auf der Karte (V2). */
export const kartenvorschau = ref(true);
/** Der Rahmen, den die Karte gerade zeigt (Karteneinheiten), für die feine Rechnung im Ausschnitt; gesetzt von `gebirge-vorschau-karte.ts`. */
export const kartenRahmen = shallowRef<V12Bounds | undefined>(undefined);
/**
 * Der Talboden, den die Vorschau zuletzt für eine Teilfläche abgeleitet hat (gesetzt vom Fenster der Landschaft): Der Kammeditor zeigt damit
 * die Vorgaben der Täler und Mulden (WI-0249 P9), wie die Vorschau sie rechnet. Ohne ihn gilt der Talboden des Typs.
 */
export const vorschauTalboden = shallowRef<{ flaeche: string; talboden: number } | undefined>(undefined);
/**
 * Die Fläche, die die Vorschau zuletzt für eine Teilfläche gerechnet hat (gesetzt vom Fenster der Landschaft, grob wie fein): Die Höhen über
 * den Punkten im Kammeditor lesen daraus, wie hoch die Fläche am Punkt wirklich steht (WI-0249, Vali 2026-10-25: „die höhen der punkte werden
 * nicht richtig angezeigt“). 🪤 `shallowRef`: Das Raster bleibt ohne reaktive Hülle (kein Proxy um große Felder).
 */
export const vorschauFlaeche = shallowRef<
    | {
          flaeche: string;
          raster: Pick<VorschauErgebnis, "w" | "hh" | "cell" | "bounds" | "eigen" | "h">;
      }
    | undefined
>(undefined);
/**
 * Das Netz, während im Kammeditor gezogen wird (eine Höhe mit ↕ oder ein Punkt; WI-0249, Vali 2026-10-25: „wenn ich höhen hochziehe, dann
 * wärs schön, wenn sich der punkt direkt verschiebt - und dann die karte nachzieht“): gedrosselt gesetzt vom Kammeditor, beim Loslassen
 * und bei Esc wieder leer. Solange es steht, rechnet die Vorschau dieses Netz fein und voll wie danach (keine Sprünge zwischen zwei Ständen);
 * die Rechnung selbst drosselt.
 */
export const zugVorschau = shallowRef<{ flaeche: string; netz: EditorGebirge["stand"]["netz"] } | undefined>(undefined);
