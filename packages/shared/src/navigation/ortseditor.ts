import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Ortseditors (Blatt Fassung 3, WI-0126 §5.1): Eigenschaften · Innerorts (n) · Quellen (n) · Bilder · Verlauf (n).
 * Zählungen an diesen Reitern sind erlaubt (das Verbot gilt Subjekten der Schiene). Der Verlauf kommt mit E17 und steht bis dahin
 * als „später“ da; Bilder sind nur eine Bindung, gepflegt wird im MAM (WI-0068).
 */
export const ORTSEDITOR = {
    id: "ortseditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "innerorts", unter: null, art: "bereich", rechte: ["use_editor_menu"], zaehler: "ort.innerorts" },
        { id: "quellen", unter: null, art: "bereich", rechte: ["use_editor_menu"], zaehler: "ort.quellen" },
        { id: "bilder", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Der Reiter „Karten“ (`fenster/traeger-karten.vue`): Das Fenster blendet ihn aus, wo das Objekt keine Karte hat.
        { id: "karten", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
