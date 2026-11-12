import type { EditorAction } from "./action";
import { devEditorActions } from "./dev-actions";

/**
 * Die Actions des Editor-Menüs (WI-0063 P9, 15.2): EINE Liste, alle drei Stellen lesen sie (EDIT-0002 §6).
 *
 * 🔴 **Die eingebaute Liste ist leer**; die Handgriffe je Objektart stehen in ihrer Datei (`handgriffe-ort.ts`, `ortHandgriffe`), weil
 * ihre Handler an der Steuerung des Editors hängen, und `app.vue` reicht sie dazu. Es gilt weiter WI-0063 4.2: keine toten
 * oder gesperrten Platzhalter; was im Menü steht, geht. Die Fähigkeiten sind die von `viewer.ts` (`edit_map_objects`,
 * `edit_map_geometry`; das frühere `edit_places` gibt es nicht mehr, EDIT-0001 W12).
 */
export const EDITOR_ACTIONS: readonly EditorAction[] = [];

/** Die Registry dieser Seite: die eingebauten Actions, im Entwicklungsmodus mit eingeschalteter Naht dazu die Testaktionen. */
export function editorActions(dazu: readonly EditorAction[] = []): readonly EditorAction[] {
    return [...EDITOR_ACTIONS, ...dazu, ...devEditorActions()];
}
