import { describe, expect, it } from "vitest";
import {
    arrangeLabels,
    labelRect,
    type LabelSide,
    type LabelSpot,
    type PlacementOptions,
    type Rect,
} from "../src/map/route-border-label-placement.ts";

/**
 * Wo ein Grenzschild an seiner Marke steht und ob es sichtbar bleibt (Betreiber 2026-10-03: nicht nur darüber, auch
 * darunter, links und rechts, und ausblenden, was sich nicht überlappungsfrei stellen lässt; Regel A: was früher auf der
 * Reise kommt, gewinnt, ein gewählter Übertritt zuerst). Die Rechnung ist rein: Bildschirmpunkte, Schildgrößen und Rang
 * hinein, je Schild Seite und Sichtbarkeit heraus.
 */

const OPTIONS: PlacementOptions = {
    lift: 10,
    arrow: 9,
    markerRadius: 10,
    viewport: { left: 0, top: 0, right: 1000, bottom: 700 },
};

const spot = (x: number, y: number, width = 200, height = 40): LabelSpot => ({ x, y, width, height });

function overlapArea(a: Rect, b: Rect): number {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
}

/** Wie viele Paare sichtbarer Schilder einander überdecken. */
function overlappingPairs(
    spots: readonly LabelSpot[],
    sides: readonly LabelSide[],
    visible: readonly boolean[],
): number {
    const rects = spots.map((s, i) => labelRect(s, sides[i]!, OPTIONS));
    let pairs = 0;
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (visible[i] && visible[j] && overlapArea(rects[i]!, rects[j]!) > 1) pairs++;
        }
    }
    return pairs;
}

describe("Wo ein Grenzschild an seiner Marke steht", () => {
    it("die Spitze des Pfeils steht auf jeder Seite `lift` von der Mitte der Marke entfernt", () => {
        const s = spot(500, 300, 200, 40);
        const gap = OPTIONS.lift + OPTIONS.arrow;
        expect(labelRect(s, "top", OPTIONS)).toEqual({ left: 400, right: 600, top: 300 - gap - 40, bottom: 290 });
        expect(labelRect(s, "bottom", OPTIONS)).toEqual({ left: 400, right: 600, top: 310, bottom: 300 + gap + 40 });
        expect(labelRect(s, "left", OPTIONS)).toEqual({ left: 500 - gap - 200, right: 490, top: 280, bottom: 320 });
        expect(labelRect(s, "right", OPTIONS)).toEqual({ left: 510, right: 500 + gap + 200, top: 280, bottom: 320 });
    });

    it("🔴 ein Schild, dem nichts im Weg steht, sitzt über seiner Marke und bleibt sichtbar", () => {
        expect(arrangeLabels([spot(500, 300)], OPTIONS)).toEqual({ sides: ["top"], visible: [true] });
        expect(arrangeLabels([spot(100, 100), spot(800, 500)], OPTIONS)).toEqual({
            sides: ["top", "top"],
            visible: [true, true],
        });
    });

    it("am oberen Rand der Karte rutscht das Schild unter die Marke, an den Seiten daneben", () => {
        expect(arrangeLabels([spot(500, 20)], OPTIONS).sides).toEqual(["bottom"]);
        // Oben und unten reichen links über den Rand hinaus, rechts daneben ist Platz.
        expect(arrangeLabels([spot(20, 300)], OPTIONS).sides).toEqual(["right"]);
        expect(arrangeLabels([spot(980, 300)], OPTIONS).sides).toEqual(["left"]);
    });

    it("zwei nahe Marken überdecken sich nicht: eines weicht auf eine freie Seite aus, beide bleiben sichtbar", () => {
        const spots = [spot(500, 300), spot(540, 300)];
        const { sides, visible } = arrangeLabels(spots, OPTIONS);
        expect(visible).toEqual([true, true]);
        expect(overlappingPairs(spots, sides, visible)).toBe(0);
        expect(sides.filter((side) => side === "top")).toHaveLength(1);
    });

    it("🔴 ist kein Platz für alle, werden die unterlegenen ausgeblendet; was sichtbar bleibt, überdeckt sich nie", () => {
        // Sechs Marken auf demselben Punkt: Mehr als vier Seiten gibt es nicht.
        const spots = Array.from({ length: 6 }, () => spot(500, 300));
        const { sides, visible } = arrangeLabels(spots, OPTIONS);
        expect(visible.filter(Boolean).length).toBeGreaterThanOrEqual(2);
        expect(visible.filter((shown) => !shown).length).toBeGreaterThanOrEqual(2);
        expect(overlappingPairs(spots, sides, visible)).toBe(0);
    });

    it("🔴 Regel A: der Rang ist die Reihenfolge der Reise, das erste Schild gewinnt immer", () => {
        const spots = Array.from({ length: 6 }, () => spot(500, 300));
        const { visible } = arrangeLabels(spots, OPTIONS);
        expect(visible[0]).toBe(true);
        // Bei gleicher Lage steht das Sichtbare vorn: kein späteres Schild bleibt, während ein früheres weichen muss.
        const firstHidden = visible.indexOf(false);
        expect(firstHidden).toBeGreaterThan(0);
        expect(visible.slice(firstHidden).some(Boolean)).toBe(false);
    });

    it("🔴 ein gewählter Übertritt kommt vor der Reihenfolge der Reise", () => {
        const spots = Array.from({ length: 6 }, () => spot(500, 300));
        expect(arrangeLabels(spots, OPTIONS).visible[5]).toBe(false);
        const { visible } = arrangeLabels(spots, OPTIONS, [5]);
        expect(visible[5]).toBe(true);
        // Das Schild 5 hat Vorrang vor allen; das erste der Reise bleibt gleich danach.
        expect(visible[0]).toBe(true);
    });

    it("🔴 eine Kette von Marken am Fluss: möglichst viele bleiben, und keines überdeckt ein anderes", () => {
        // Wie in der Abnahme des Betreibers: viele Übertritte dicht entlang einer Route.
        const spots = [
            spot(300, 400, 260, 60),
            spot(380, 380, 260, 60),
            spot(470, 350, 260, 60),
            spot(540, 330, 260, 60),
            spot(620, 300, 260, 60),
        ];
        const { sides, visible } = arrangeLabels(spots, OPTIONS);
        expect(overlappingPairs(spots, sides, visible)).toBe(0);
        expect(visible.filter(Boolean).length).toBeGreaterThanOrEqual(3);
        // Es werden wirklich mehrere Seiten benutzt.
        expect(new Set(sides.filter((_, i) => visible[i])).size).toBeGreaterThanOrEqual(3);
    });

    it("ein Schild deckt keine fremde Marke zu, solange es anders geht", () => {
        // Die Marke darunter läge unter dem Schild nach unten; also bleibt es oben.
        const spots = [spot(500, 300, 200, 40), spot(500, 340, 20, 20)];
        const { sides } = arrangeLabels(spots, OPTIONS);
        const first = labelRect(spots[0]!, sides[0]!, OPTIONS);
        const marker: Rect = { left: 490, right: 510, top: 330, bottom: 350 };
        expect(overlapArea(first, marker)).toBe(0);
    });

    it("dieselbe Eingabe gibt dieselbe Antwort (kein Zufall, keine Vorgeschichte)", () => {
        const spots = [spot(500, 300), spot(540, 300), spot(580, 310), spot(300, 100)];
        expect(arrangeLabels(spots, OPTIONS)).toEqual(arrangeLabels(spots, OPTIONS));
        expect(arrangeLabels([], OPTIONS)).toEqual({ sides: [], visible: [] });
    });
});
