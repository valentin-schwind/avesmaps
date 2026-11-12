import { ref } from "vue";

/**
 * Die Reiter des Fensters „Inhalte bearbeiten“ (WI-0254), in der Folge des Mockups. Die Kennungen sind die der Karteninhalte im Editorpanel
 * (`packages/shared/src/navigation/editorpanel.ts`): Das Verb eines Inhalts öffnet das Fenster mit dem eigenen Reiter vorn.
 */
export const INHALTE_REITER = ["quellen", "literatur", "vorkommen", "korpora"] as const;
export type InhalteReiter = (typeof INHALTE_REITER)[number];

/** Das Werkzeug im Register und in der Fensterverwaltung (`editorpanel.ts`: Verb → Werkzeug `inhalteeditor`). */
export const INHALTE_WERKZEUG = "inhalteeditor";
/** Der eine Gegenstand des Fensters: Es gibt genau EIN Fenster „Inhalte bearbeiten“. */
export const INHALTE_GEGENSTAND = "inhalte";

/** Der Reiter zu einem Inhalt des Editorpanels; alles andere öffnet bei den Quellen. */
export function reiterAus(inhalt: string | undefined): InhalteReiter {
    return INHALTE_REITER.find((reiter) => reiter === inhalt) ?? "quellen";
}

/**
 * Der Reiter, den die nächste Öffnung vorn haben will: `app.vue` setzt ihn, wenn das Verb eines Inhalts das Fenster öffnet, und das Fenster
 * nimmt ihn beim nächsten Tick und leert ihn wieder. Ein Fenster, das schon offen ist, wechselt dann den Reiter, statt ein zweites zu öffnen.
 */
export const inhalteReiterWunsch = ref<InhalteReiter | undefined>(undefined);

/**
 * Die Quelle, die die nächste Öffnung gewählt haben will (WI-0254 §12): „Quelle öffnen“ in den Quellen eines Orts oder Gebiets (`fenster/traeger-quellen.vue`) öffnet das Fenster am Reiter „Quellen“ mit
 * dieser Quelle. `app.vue` setzt sie, das Fenster nimmt sie beim nächsten Tick und leert sie wieder; ein schon offenes Fenster wählt sie dann ebenso.
 */
export const inhalteQuelleWunsch = ref<string | undefined>(undefined);
