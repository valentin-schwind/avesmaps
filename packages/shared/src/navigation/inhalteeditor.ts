import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Fensters „Inhalte bearbeiten“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`, vom Betreiber
 * begutachtet): Quellen, Literatur, Vorkommen, Korpora, in dieser Folge. EIN Fenster mit vier Fachreitern, nicht vier Fenster; jeder Reiter
 * hat dieselben drei Spalten (Katalog, Stammdaten, Beziehungen) und tauscht nur Felder und Beziehungseditor aus.
 *
 * Das Verb der vier Karteninhalte im Editorpanel (`quellen`, `literatur`, `vorkommen`, `korpora`) öffnet dieses Fenster mit dem gewählten
 * Reiter vorn (`editorpanel.ts`).
 */
export const INHALTEEDITOR = {
    id: "inhalteeditor",
    wurzel: "reiter",
    eintraege: [
        { id: "quellen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "literatur", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "vorkommen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "korpora", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
