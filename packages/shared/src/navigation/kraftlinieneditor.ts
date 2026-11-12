import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Kraftlinien-Editors (WI-0205 Paket K2; Blatt Kraftlinien): Eigenschaften, darin die Nodices als Kasten (EDIT-0003
 * T28 (2): „die nodices sind eigenschaften“, das Fenster bleibt zweispaltig) und der Verlauf mit ↺ (gemeinsamer Verlauf,
 * `fenster/entwurf-verlauf.ts`). Quellen kommen mit der Wiki-Zuordnung je Abschnitt.
 */
export const KRAFTLINIENEDITOR = {
    id: "kraftlinieneditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
