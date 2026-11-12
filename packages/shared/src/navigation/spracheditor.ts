import type { NavTafel } from "./navigation.ts";

/**
 * Die Reiter des Spracheditors (WI-0261 S5d2; Bauvorlage: Probierseite `sprachen-probe.html`, Zustand 6, `fenster-sprachen.js` `reiter`):
 * Eigenschaften (Identität, Farbe, Wiki, Quelle), Flächen (die Teilflächen der Sprache), Kollisionen (Treffer und Überlappungen, nur
 * lesend) und der Verlauf (gemeinsamer Verlauf, `fenster/entwurf-verlauf.ts`).
 */
export const SPRACHEDITOR = {
    id: "spracheditor",
    wurzel: "reiter",
    eintraege: [
        { id: "eigenschaften", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "flaechen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "kollisionen", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
        { id: "verlauf", unter: null, art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
