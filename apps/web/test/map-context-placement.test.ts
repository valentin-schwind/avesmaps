import { describe, expect, it } from "vitest";
import {
    KARTEN_ABSTAND,
    MENU_EDGE,
    MENU_OFFSET,
    menuPlacement,
    zweiKartenLage,
} from "../src/controls/map-context-placement.ts";

/**
 * Wo das Kartenmenü neben dem Zeiger aufgeht (WI-0108 Nachtrag „Zeiger am Druckpunkt“, Betreiber 2026-10-11: „du kannst auch
 * einen kleinen zeiger |\ bauen und das menü mit einem kleinen offset daneben aufgehen lassen“).
 */
describe("menuPlacement", () => {
    const fenster = { width: 1280, height: 900 };
    const menu = { width: 198, height: 246 };

    it("🔴 knapp neben dem Fadenkreuz: das Menü steht 12 px rechts und 10 px unter dem Punkt, nie mit der Ecke am Punkt", () => {
        // Betreiber 2026-10-11 zu Blatt 2: „der abstand zum menü kann ruhig etwas geringer sein“ (vorher Legacys 18 / 14).
        expect(MENU_OFFSET).toEqual({ x: 12, y: 10 });
        expect(menuPlacement({ x: 400, y: 300 }, menu, fenster)).toEqual({
            left: 412,
            top: 310,
            flipX: false,
            flipY: false,
        });
    });

    it("🔴 am rechten Rand klappt es nach links, mit demselben Versatz; der Punkt bleibt frei", () => {
        const lage = menuPlacement({ x: 1200, y: 300 }, menu, fenster);
        expect(lage).toEqual({ left: 1200 - 12 - 198, top: 310, flipX: true, flipY: false });
        expect(lage.left + menu.width).toBeLessThan(1200);
    });

    it("🔴 am unteren Rand klappt es nach oben, mit demselben Versatz", () => {
        const lage = menuPlacement({ x: 400, y: 800 }, menu, fenster);
        expect(lage).toEqual({ left: 412, top: 800 - 10 - 246, flipX: false, flipY: true });
        expect(lage.top + menu.height).toBeLessThan(800);
    });

    it("bleibt mindestens 8 px im Fenster, auch wenn keine Seite reicht (Telefon, 360 px)", () => {
        expect(MENU_EDGE).toBe(8);
        const lage = menuPlacement({ x: 180, y: 120 }, menu, { width: 360, height: 780 });
        expect(lage.left).toBeGreaterThanOrEqual(MENU_EDGE);
        expect(lage.left + menu.width).toBeLessThanOrEqual(360 - MENU_EDGE);
    });
});

/** Zwei Karten für Editoren (EDIT-0003 R7, T27 (4); A4): oben die der Editoren, darunter die der Besucher, 12 px dazwischen. */
describe("zweiKartenLage", () => {
    const fenster = { width: 1280, height: 900 };
    const editor = { width: 220, height: 140 };
    const besucher = { width: 198, height: 246 };

    it("🔴 oben die Karte der Editoren 6 px über dem Punkt, darunter die der Besucher 6 px unter ihm, beide 12 px rechts", () => {
        expect(KARTEN_ABSTAND).toBe(6);
        const lage = zweiKartenLage({ x: 400, y: 300 }, editor, besucher, fenster);
        expect(lage).toEqual({
            editor: { left: 412, top: 300 - 6 - 140 },
            besucher: { left: 412, top: 306 },
            flipX: false,
        });
        expect(lage.besucher.top - (lage.editor.top + editor.height)).toBe(12);
    });

    it("🔴 am rechten Rand stehen beide links vom Punkt, jede mit ihrer rechten Kante 12 px davor", () => {
        const lage = zweiKartenLage({ x: 1200, y: 300 }, editor, besucher, fenster);
        expect(lage.flipX).toBe(true);
        expect(lage.editor.left + editor.width).toBe(1200 - 12);
        expect(lage.besucher.left + besucher.width).toBe(1200 - 12);
    });

    it("🔴 oben kein Platz: die obere Karte an den Rand, die untere darunter, nie überlappend", () => {
        const lage = zweiKartenLage({ x: 400, y: 60 }, editor, besucher, fenster);
        expect(lage.editor.top).toBe(MENU_EDGE);
        expect(lage.besucher.top).toBe(MENU_EDGE + editor.height + 12);
    });

    it("🔴 unten kein Platz: der Stapel rückt als Ganzes hoch, die Lücke bleibt", () => {
        const lage = zweiKartenLage({ x: 400, y: 800 }, editor, besucher, fenster);
        expect(lage.besucher.top + besucher.height).toBe(900 - MENU_EDGE);
        expect(lage.besucher.top).toBe(lage.editor.top + editor.height + 12);
    });

    describe("die Höhe reicht nicht für beide übereinander (T41, Variante a)", () => {
        const flach = { width: 1280, height: 720 };
        const hoch = { width: 290, height: 520 };
        const unten = { width: 290, height: 220 };

        it("🔴 nebeneinander, oben bündig 10 px unter dem Punkt: Editoren 12 px rechts, Besucher rechts daneben, beide ganz im Fenster", () => {
            const lage = zweiKartenLage({ x: 500, y: 100 }, hoch, unten, flach);
            expect(lage).toEqual({
                editor: { left: 512, top: 110 },
                besucher: { left: 512 + 290 + 12, top: 110 },
                flipX: false,
                nebeneinander: true,
            });
        });

        it("🔴 tief geklickt: beide rücken hoch, bis die höhere ins Fenster passt", () => {
            const lage = zweiKartenLage({ x: 500, y: 600 }, hoch, unten, flach);
            expect(lage.editor.top).toBe(720 - MENU_EDGE - 520);
            expect(lage.besucher.top).toBe(lage.editor.top);
        });

        it("🔴 am rechten Rand: Editoren 12 px links vom Punkt, Besucher links davon", () => {
            const lage = zweiKartenLage({ x: 1100, y: 100 }, hoch, unten, flach);
            expect(lage.flipX).toBe(true);
            expect(lage.editor.left + hoch.width).toBe(1100 - 12);
            expect(lage.besucher.left + unten.width).toBe(lage.editor.left - 12);
        });

        it("🔴 reicht auch die Breite nicht: übereinander, und die Karte der Editoren rollt", () => {
            const schmal = { width: 700, height: 720 };
            const lage = zweiKartenLage({ x: 350, y: 300 }, hoch, unten, schmal);
            expect(lage.nebeneinander).toBeUndefined();
            expect(lage.editorHoehe).toBe(720 - 2 * MENU_EDGE - 12 - 220);
            expect(lage.editor.top).toBe(MENU_EDGE);
            expect(lage.besucher.top + unten.height).toBe(720 - MENU_EDGE);
        });

        it("bei genug Höhe bleibt alles wie es war (1920 × 1080: übereinander)", () => {
            const lage = zweiKartenLage({ x: 900, y: 600 }, hoch, unten, { width: 1920, height: 1080 });
            expect(lage).toEqual({
                editor: { left: 912, top: 600 - 6 - 520 },
                besucher: { left: 912, top: 606 },
                flipX: false,
            });
        });
    });
});
