import type { InjectionKey } from "vue";

/**
 * Escape arbeitet von innen nach außen (WI-0063 4.10, Betreiber 2026-10-04): EINE geordnete Kaskade statt mehrerer
 * Dokument-Zuhörer, die einander überholten. Vorher schloss ein offenes Auge-Menü oder der Kartenfächer sich selbst, und
 * `installKeyboard` hob in demselben Tastendruck die Auswahl auf - ein Escape nahm zwei Dinge mit.
 *
 * Die Stufen, von innen nach außen:
 *
 * | Stufe | Wer | Teilnehmer |
 * |---|---|---|
 * | `menus` | offene Menüs und Listen schließen, OHNE die Auswahl aufzuheben | Kartenmenü (`controls/map-context-menu.vue`), Auge-Menü, Kartenfächer, Flächenliste, Menüknopf und Menüblatt (`controls/`), Glocke, Kopfleiste, Umgebungsmenü (`auth/`) |
 * | `action` | eine laufende Editoraktion (Werkzeug) bricht ab oder fragt (EDIT-0003 R2) | in `app.vue`: Messung, die Formmodi (Wegkurve, Ecken, Grenzen, Kurve), das Anlegen, Ort und Kraftlinienpunkt verschieben und setzen, die Felder der Fenster |
 * | `floating-menu` | das Editor-Menü am Objekt schließt (`editor-menu/`, WI-0063 P9), ohne Infopanel und Auswahl anzurühren | Editor-Menü |
 * | `multi-selection` | die Mehrfachauswahl eines Editors wird aufgehoben (WI-0252, Betreiber 2026-10-24: „ESC soll in allen fällen mehrfachauswahlen wieder aufheben“) | `map/mehrfach-markierung.ts`, `hebeAuf` |
 * | `info-panel` | das SICHTBARE Infopanel schließt und hebt die Auswahl auf | Infopanel |
 * | `map-selection` | sonst die Auswahl der Karte (Klimazone, Fläche, Ort …) | Auswahl |
 *
 * Die Folge `action` · `floating-menu` · `info-panel` · `map-selection` ist die des Betreibers (WI-0063 §4.10, 2026-10-04). `menus`
 * steht vor der Aktion, weil er die Stufe dort nicht nennt und ein offenes Menü innen liegt: Fund der Hauptorchestrierung auf der Stage
 * am 2026-10-20 (Formmodus, Kartenmenü offen, Esc stellte die Ende-Frage, statt das Menü zu schließen), Folge festgelegt von der
 * Editor-Orchestrierung.
 *
 * Ein hinter einem künftigen Editorpanel nur vorbereiteter Infopanel-Inhalt zählt nicht als sichtbar: Das Infopanel meldet
 * sich in `info-panel` nur, wenn es zu sehen ist.
 *
 * Die erste Stufe, in der jemand etwas geschlossen hat, verbraucht die Taste; die äußeren erfahren nichts. In `menus`
 * schließen ALLE offenen (sie sind nie zwei, aber was offen ist, ist zu), alle anderen Stufen schließen genau eines.
 *
 * 🪤 Was selbst den Fokus hat und Escape versteht (die Suche, ein Feld, eine Auswahlliste im Planer, ein Fenster), behält
 * die Taste am eigenen Element, wie bisher: `installKeyboard` sieht ein verbrauchtes Ereignis nicht mehr (`defaultPrevented`)
 * und schweigt, solange jemand schreibt oder ein Fenster offen ist.
 */

export const ESCAPE_STEPS = [
    "menus",
    "action",
    "floating-menu",
    "multi-selection",
    "info-panel",
    "map-selection",
] as const;
export type EscapeStep = (typeof ESCAPE_STEPS)[number];

/** Ein Teilnehmer: schließt, was er schließen kann, und sagt, ob es etwas zu schließen gab. */
export type EscapeHandler = () => boolean;

export interface EscapeCascade {
    /** Meldet einen Teilnehmer an einer Stufe an; gibt die Abmeldung zurück. */
    register(step: EscapeStep, handler: EscapeHandler): () => void;
    /** Escape gedrückt: die Stufen von innen nach außen. Gibt die Stufe zurück, die die Taste verbraucht hat. */
    run(): EscapeStep | undefined;
}

export function createEscapeCascade(): EscapeCascade {
    const handlers = new Map<EscapeStep, Set<EscapeHandler>>(ESCAPE_STEPS.map((step) => [step, new Set()]));
    return {
        register(step, handler) {
            handlers.get(step)?.add(handler);
            return () => {
                handlers.get(step)?.delete(handler);
            };
        },
        run() {
            for (const step of ESCAPE_STEPS) {
                const list = [...(handlers.get(step) ?? [])];
                if (step === "menus") {
                    // Alle offenen schließen: `some` bräche nach dem ersten ab.
                    const closed = list.map((handler) => handler());
                    if (closed.includes(true)) return step;
                    continue;
                }
                if (list.some((handler) => handler())) return step;
            }
            return undefined;
        },
    };
}

/** Die Kaskade der Seite, per `provide`/`inject` an die Menüs verteilt (`app.vue` legt sie an). */
export const ESCAPE_CASCADE_KEY: InjectionKey<EscapeCascade> = Symbol("escape-cascade");
