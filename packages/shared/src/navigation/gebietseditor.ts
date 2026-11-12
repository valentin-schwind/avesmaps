import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Gebietseditors (WI-0209 A3, D5; EDIT-0005 §3; Blatt „Herrschaftsgebiete“): Eigenschaften · Untergebiete (n) ·
 * Hierarchie · Form · Quellen · Bilder · Verlauf. Zählungen an diesen Reitern sind erlaubt (das Verbot gilt Subjekten der Schiene). Der
 * Verlauf ist der gemeinsame (`fenster/entwurf-verlauf.ts`, D5), wie bei der Kraftlinie. Quellen und Bilder (Wappen) stehen wie am Ort
 * in eigenen Reitern (WI-0253, Betreiber 2026-10-26: „Wappen gehören zu einem Bilder-Tab und Quellen in eine Quellen-Tab (wie bei Orten)“).
 */
export const GEBIETSEDITOR = {
    id: "gebietseditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        {
            id: "untergebiete",
            unter: null,
            art: "bereich",
            rechte: ["use_editor_menu"],
            zaehler: "gebiet.untergebiete",
        },
        { id: "hierarchie", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "form", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "quellen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "bilder", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Der Reiter „Karten“ (`fenster/traeger-karten.vue`): Das Fenster blendet ihn aus, wo das Objekt keine Karte hat.
        { id: "karten", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
