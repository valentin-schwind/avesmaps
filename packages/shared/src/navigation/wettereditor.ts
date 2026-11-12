import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Wetter-Editors (WI-0288 Stufe 3; Probierseite `review/wetter-editor/`, Idee A): keine Reiter über den Eigenschaften, EINE
 * Liste mit den Gruppen „Presets“ und „Icons“. Die Tafel nennt den einen Bereich, damit jedes Werkzeug eine hat (Test T1.3); einen Verlauf
 * gibt es nicht, das Protokoll führt die Änderungen (`system.wetter_preset_geaendert`, `system.wetter_symbol_geaendert`).
 */
export const WETTEREDITOR = {
    id: "wettereditor",
    wurzel: "reiter",
    eintraege: [{ id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] }],
} as const satisfies NavTafel;
