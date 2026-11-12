import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Landschaftseditors (WI-0178 A3; EDIT-0004 §2.2; Blatt „Landschaftseditor“): Eigenschaften · Form · Beschriftungen (n) · Quellen (n).
 * Zählungen an diesen Reitern sind erlaubt (das Verbot gilt Subjekten der Schiene). Der Verlauf kommt mit dem gemeinsamen Verlauf
 * (Paket D3) und steht bis dahin nicht da.
 */
export const LANDSCHAFTSEDITOR = {
    id: "landschaftseditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "form", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        {
            id: "beschriftungen",
            unter: null,
            art: "bereich",
            rechte: ["use_editor_menu"],
            zaehler: "landschaft.beschriftungen",
        },
        // Nur an Gebirgen (WI-0178 P4, Fassung 16): Typ, Höhe, Werte; das Fenster blendet ihn sonst aus.
        { id: "gebirge", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Die Quellen der Landschaft als Klappboxen (WI-0254 §12; `fenster/traeger-quellen.vue`, sofort gespeichert); eine Landmarke (Gipfel, Höhle …) trägt seit WI-0271 L4 eigene Reiter Eigenschaften · Quellen · Verlauf (`gipfel-eigenschaften.vue`).
        { id: "quellen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Der Reiter „Karten“ (`fenster/traeger-karten.vue`): Das Fenster blendet ihn aus, wo das Objekt keine Karte hat.
        { id: "karten", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        // Der Verlauf mit ↺ (WI-0178 D3; gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`).
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
