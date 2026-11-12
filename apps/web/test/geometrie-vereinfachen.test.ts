import { describe, expect, it } from "vitest";
import type { Punkt } from "../src/map/geometrie/geometrie";
import { vereinfacht, vereinfachteIndizes } from "../src/map/geometrie/vereinfachen";

/** WI-0177 W3: die Rechnung von „Wegkurve vereinfachen“ (EDIT-0003 T24; Betreiber 2026-10-16 „Nein, fest“). */

const p = (x: number, y: number): Punkt => ({ x, y });
/** Eine fast gerade Linie mit leichtem Zittern: Alles zwischen den Enden fällt weg. */
const zittern = [p(0, 0), p(10, 0.2), p(20, -0.1), p(30, 0.15), p(40, 0)];
/** Ein Zickzack mit großen Ausschlägen: Bei kleiner Toleranz bleibt alles. */
const zickzack = [p(0, 0), p(10, 10), p(20, 0), p(30, 10), p(40, 0)];

describe("vereinfachen (WI-0177 W3)", () => {
    it("🔴 Stärke 0 nimmt nichts weg, auch keine Linie aus zwei Punkten", () => {
        expect(vereinfachteIndizes(zittern, 0)).toEqual([0, 1, 2, 3, 4]);
        expect(vereinfachteIndizes([p(0, 0), p(1, 1)], 5)).toEqual([0, 1]);
    });

    it("🔴 eine fast gerade Linie behält nur ihre Enden", () => {
        expect(vereinfachteIndizes(zittern, 1)).toEqual([0, 4]);
    });

    it("ein Zickzack mit großen Ausschlägen bleibt bei kleiner Toleranz, bei großer fällt er", () => {
        expect(vereinfachteIndizes(zickzack, 0.5)).toEqual([0, 1, 2, 3, 4]);
        expect(vereinfachteIndizes(zickzack, 20)).toEqual([0, 4]);
    });

    it("🔴 feste Punkte bleiben und teilen die Linie: jedes Stück wird für sich vereinfacht", () => {
        expect(vereinfachteIndizes(zittern, 1, { fest: [2] })).toEqual([0, 2, 4]);
        const punkte = vereinfacht(zittern, 1, { fest: [2] });
        // Die Punkte selbst, unverändert: Nichts wandert, also hält jeder Anschluss.
        expect(punkte).toEqual([zittern[0], zittern[2], zittern[4]]);
    });

    it("unsinnige feste Indizes stören nicht", () => {
        expect(vereinfachteIndizes(zittern, 1, { fest: [-1, 99, 1.5] })).toEqual([0, 4]);
    });

    it("ein Ring behält immer mindestens drei Punkte", () => {
        const quadrat = [p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 5)];
        const indizes = vereinfachteIndizes(quadrat, 50, { geschlossen: true });
        expect(indizes.length).toBeGreaterThanOrEqual(3);
        // Der Punkt mitten auf der linken Seite fällt zuerst.
        expect(vereinfachteIndizes(quadrat, 0.2, { geschlossen: true })).toEqual([0, 1, 2, 3]);
    });

    it("ein Ring mit einem festen Punkt ankert an ihm", () => {
        const ring = [p(0, 0), p(5, 0.1), p(10, 0), p(10, 10), p(0, 10)];
        expect(vereinfachteIndizes(ring, 1, { geschlossen: true, fest: [1] })).toContain(1);
    });
});
