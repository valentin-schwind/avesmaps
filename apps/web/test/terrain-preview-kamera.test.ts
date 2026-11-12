import { describe, expect, it } from "vitest";
import { halteKamera, type KameraKarte } from "../src/map/terrain/terrain-preview";

/**
 * Die Kamera hält beim Umschalten der Höhenvorschau ihren Ort (Betreiber 2026-10-24: „die gesamte Umgebung hebt sich an, während das
 * gebirge absinkt“). Ursache, gemessen: Die Vorschau ändert außerhalb des Gebirges keine Höhe (`gebirge-vorschau-hoehe.spec.ts`: 232.192
 * Pixel außen, keins anders), am Mittelpunkt des Probegebirges aber 658 → 1.898 Schritt. MapLibre legt die Kartenmitte bei jeder neuen
 * Geländekachel auf den Boden darunter (`centerClampedToGround`) und behält dabei den Abstand der Kamera; sie fuhr diese 1.240 Schritt mit,
 * und die ganze Umgebung schien sich um sie zu bewegen.
 *
 * Nachgebaut ist das Verhalten von MapLibre 6 (`_handleTerrainDataEvent`, `_render`, `recalculateZoomAndCenter`): Geklemmt rückt die
 * Mitte auf den Boden und die Kamera um denselben Betrag mit; das Nachrechnen legt die Mitte auf den Boden unter der Bildmitte, ohne die
 * Kamera zu bewegen.
 */
function karte(boden: { wert: number }, mitGelaende = true) {
    const protokoll: string[] = [];
    let geklemmt = true;
    let mitte = boden.wert;
    let kamera = mitte + 5000;
    let wartet: (() => void) | undefined;
    const map = {
        terrain: mitGelaende ? {} : null,
        getCenterClampedToGround: () => geklemmt,
        setCenterClampedToGround(an: boolean) {
            protokoll.push(an ? "klemmen" : "lösen");
            geklemmt = an;
        },
        once: () => map,
        triggerRepaint: () => undefined,
        _camera: {
            transform: {
                recalculateZoomAndCenter() {
                    protokoll.push("nachrechnen");
                    mitte = boden.wert;
                },
            },
        },
    };
    return {
        map: map as unknown as KameraKarte,
        protokoll,
        /** Eine neue Geländekachel kommt (oder ein Bild wird gezeichnet): MapLibre klemmt die Mitte, wenn es darf. */
        kachel() {
            if (!geklemmt) return;
            kamera += boden.wert - mitte;
            mitte = boden.wert;
        },
        kamerahoehe: () => kamera,
        warte: (fertig: () => void) => {
            wartet = fertig;
            return fertig;
        },
        ruhig: () => wartet?.(),
    };
}

describe("Höhenvorschau: die Kamera hält ihren Ort", () => {
    it("🔴 ohne Halten fährt die Kamera mit dem Boden unter der Mitte (der gemeldete Fehler)", () => {
        const boden = { wert: 658 };
        const k = karte(boden);
        const vorher = k.kamerahoehe();
        boden.wert = 1898;
        k.kachel();
        expect(k.kamerahoehe() - vorher).toBe(1240);
    });

    it("🔴 mit Halten bleibt die Kamera, solange die Kacheln kommen, und auch danach; dann wird wieder geklemmt", () => {
        const boden = { wert: 658 };
        const k = karte(boden);
        const vorher = k.kamerahoehe();
        halteKamera(k.map, k.warte);
        boden.wert = 1898;
        k.kachel();
        expect(k.kamerahoehe()).toBe(vorher);
        k.ruhig();
        expect(k.protokoll).toEqual(["lösen", "nachrechnen", "klemmen"]);
        // Die Mitte liegt jetzt auf dem neuen Boden: Weitere Kacheln und Bilder bewegen die Kamera nicht mehr.
        k.kachel();
        expect(k.kamerahoehe()).toBe(vorher);
        // Zurück auf das Gelände ohne Vorschau: wieder kein Sprung.
        halteKamera(k.map, k.warte);
        boden.wert = 658;
        k.kachel();
        k.ruhig();
        k.kachel();
        expect(k.kamerahoehe()).toBe(vorher);
    });

    it("lässt die Karte ohne Gelände (2D) und eine schon gehaltene Kamera (Folgen) in Ruhe", () => {
        const ohne = karte({ wert: 0 }, false);
        halteKamera(ohne.map, ohne.warte);
        expect(ohne.protokoll).toEqual([]);
        const gehalten = karte({ wert: 0 });
        gehalten.map.setCenterClampedToGround(false);
        halteKamera(gehalten.map, gehalten.warte);
        expect(gehalten.protokoll).toEqual(["lösen"]);
    });
});
