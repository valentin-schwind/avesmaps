import { describe, expect, it } from "vitest";
import { distanceAboveBottom, keyboardCover, revealStart } from "../src/search/search-tile.ts";

/**
 * Die Suchkachel am Finger (WI-0026, wie Legacys `js/ui/spotlight-search.js`): das Fenster sitzt auf
 * der Höhe der Lupe, bleibt über der Tastatur und klappt aus der Lupe nach links auf.
 */
describe("Die Lupe wächst zum Feld", () => {
    it("das Fenster setzt an der Unterkante der Kachel an", () => {
        expect(distanceAboveBottom(800, 712)).toBe(88);
        // Nie unter den Bildrand: eine Kachel, die (noch) darunter liegt, zieht das Fenster nicht mit.
        expect(distanceAboveBottom(800, 830)).toBe(0);
    });

    it("🔴 die Tastatur verdeckt, was der sichtbare Viewport nicht mehr zeigt", () => {
        expect(keyboardCover(800, { height: 800, offsetTop: 0 })).toBe(0);
        expect(keyboardCover(800, { height: 470, offsetTop: 0 })).toBe(330);
        // 💣 iOS schiebt den sichtbaren Ausschnitt beim Fokus nach oben: was darüber liegt, verdeckt die Tastatur nicht.
        expect(keyboardCover(800, { height: 470, offsetTop: 40 })).toBe(290);
        expect(keyboardCover(800, { height: 900, offsetTop: 0 })).toBe(0);
    });

    it("im ersten Bild steht nur die Kachel am rechten Ende offen", () => {
        expect(revealStart(336, 48)).toBe(288);
        // Ein Fenster, schmaler als die Kachel, ist von Anfang an ganz offen.
        expect(revealStart(40, 48)).toBe(0);
    });
});
