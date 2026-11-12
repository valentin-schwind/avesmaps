import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Wege-Fensters (WI-0177 Stufe 2, W5a; Blatt „Wegeditor“): Eigenschaften, darin die Abschnitte der Straße, und der
 * Verlauf mit ↺ (EDIT-0003 T54, gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`). Die Wegeigenschaften (Reisemittel, Zeitfenster,
 * Probierblatt P6) kommen später.
 */
export const WEGEDITOR = {
    id: "wegeditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Die Quellen der Straße als Ganzes (WI-0254 §12; `fenster/traeger-quellen.vue`, `kind="path"`): Lesen ab `use_editor_menu`, ändern mit `manage_sources` für die ganze Straße (Abschnitte kennt die Oberfläche nicht).
        { id: "quellen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Der Reiter „Karten“ (`fenster/traeger-karten.vue`): Das Fenster blendet ihn aus, wo das Objekt keine Karte hat.
        { id: "karten", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
