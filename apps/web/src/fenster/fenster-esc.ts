import type { InjectionKey } from "vue";

/**
 * Was Escape in einem Werkzeugfenster VOR dem Schließen tut (WI-0252; Betreiber 2026-10-24, wörtlich: „ESC soll in allen fällen
 * mehrfachauswahlen wieder aufheben“): Steht der Fokus im Fenster (nach einem Haken in der Liste), bekommt die Kaskade der Karte die Taste
 * nicht (`install-keyboard.ts`, `fensterRiegelt`), und das Fenster schlösse sich. Gibt dieser Teilnehmer `true` zurück, hat er etwas
 * aufgehoben, und das Fenster bleibt offen; der nächste Druck schließt es. `app.vue` gibt `mehrfachMarkierung.hebeAuf` hinein.
 */
export const FENSTER_ESC_VORHER: InjectionKey<() => boolean> = Symbol("fenster-esc-vorher");
