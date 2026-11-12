import { describe, expect, it } from "vitest";
import {
    COLUMN_SPACING,
    composeLabelPoints,
    FOLLOW,
    piece,
    placeBandLabels,
    subtractSpans,
    thinRing,
    type BandShape,
    type GroundProjection,
    type LabelTarget,
    type Piece,
    type Point2,
    type ScreenRect,
} from "../src/map/area-label-placement.ts";

/**
 * Wo ein Zonenname steht (WI-0012, Nachtrag 2026-10-05): mittig im sichtbaren Teil seiner Zone, ohne das Meer, das darüber
 * liegt; kein Name, wo die Zone zu schmal ist. Gerechnet an einer flachen Karte: Boden 0…1 auf 1000 × 1000 Bildpunkte.
 */

const SCALE = 1000;
const flat: GroundProjection = {
    toScreen: ([x, y]) => [x * SCALE, y * SCALE],
    toGround: ([x, y]) => [x / SCALE, y / SCALE],
};
const ROOM = 20;

/** Ein Rechteck am Boden, in Bildpunkten angegeben. */
function box(left: number, top: number, right: number, bottom: number): Piece {
    const [l, t, r, b] = [left / SCALE, top / SCALE, right / SCALE, bottom / SCALE];
    return piece([[l, t, r, t, r, b, l, b]]);
}

function band(key: string, ...pieces: Piece[]): BandShape {
    return { key, name: key, pieces };
}

const RECT: ScreenRect = { left: 0, top: 0, right: 1000, bottom: 1000 };

describe("Der Name steht mittig im sichtbaren Teil seiner Zone", () => {
    it("🔴 ein Band quer durchs Bild: waagrecht in der Mitte, senkrecht zwischen seinen Grenzen", () => {
        const [target] = placeBandLabels([band("gemaessigt", box(-500, 300, 1500, 500))], [], RECT, flat, ROOM);
        expect(target?.at[0]).toBeCloseTo(500, 0);
        expect(target?.at[1]).toBeCloseTo(400, 6);
        expect(target?.room).toBeCloseTo(200, 6);
    });

    it("🔴 nur der sichtbare Teil zählt: ein Band, das oben aus dem Bild ragt, trägt den Namen in der Mitte des Rests", () => {
        const [target] = placeBandLabels([band("boreal", box(-500, -400, 1500, 100))], [], RECT, flat, ROOM);
        expect(target?.at[1]).toBeCloseTo(50, 6);
    });

    it("🔴 die freie Fläche neben einem Panel: der Name steht in ihrer Mitte, nicht in der des Bildes", () => {
        const free: ScreenRect = { left: 350, top: 0, right: 1000, bottom: 1000 };
        const [target] = placeBandLabels([band("gemaessigt", box(-500, 300, 1500, 500))], [], free, flat, ROOM);
        expect(target?.at[0]).toBeCloseTo(675, 0);
    });

    it("🔴 das Meer deckt die Zone: der Name steht in der Mitte des Landes, nie im Meer", () => {
        const zone = band("gemaessigt", box(-500, 300, 1500, 500));
        // Die linke Hälfte ist Meer.
        const [target] = placeBandLabels([zone], [box(-500, -500, 500, 1500)], RECT, flat, ROOM);
        // Gemessen wird in Senkrechten im Abstand von etwa COLUMN_SPACING: so genau steht die Mitte.
        expect(Math.abs(target!.at[0] - 750)).toBeLessThanOrEqual(COLUMN_SPACING / 2);
        expect(target!.at[0]).toBeGreaterThan(500);
        expect(target?.at[1]).toBeCloseTo(400, 6);
    });

    it("🔴 eine Zone aus Inseln: liegt ihr Schwerpunkt im Meer, steht der Name auf dem nächsten Land mit Platz", () => {
        const zone = band("tropisch", box(-500, 300, 1500, 700));
        // Meer überall, außer zwei Inseln links und rechts; der Schwerpunkt liegt zwischen ihnen im Meer.
        const sea = piece([
            [-0.5, -0.5, 1.5, -0.5, 1.5, 1.5, -0.5, 1.5],
            // Löcher im Meer sind die Inseln.
            [0.1, 0.4, 0.1, 0.6, 0.3, 0.6, 0.3, 0.4],
            [0.8, 0.45, 0.8, 0.55, 0.85, 0.55, 0.85, 0.45],
        ]);
        const [target] = placeBandLabels([zone], [sea], RECT, flat, ROOM);
        expect(target).toBeDefined();
        const [x, y] = target!.at;
        const onIsland =
            (x >= 100 && x <= 300 && y >= 400 && y <= 600) || (x >= 800 && x <= 850 && y >= 450 && y <= 550);
        expect(onIsland, `${x}, ${y}`).toBe(true);
    });

    it("🔴 ein schmaler Streifen trägt keinen Namen (Legacy: lieber keiner, als einer, der in die Nachbarzone ragt)", () => {
        const targets = placeBandLabels(
            [band("subpolar", box(-500, -400, 1500, 10)), band("boreal", box(-500, 10, 1500, 400))],
            [],
            RECT,
            flat,
            ROOM,
        );
        expect(targets.map((target) => target.key)).toEqual(["boreal"]);
    });

    it("🔴 ein breiter Name am Rand rückt waagrecht hinein, soweit sein Band dort Platz hat", () => {
        // Die Zone liegt nur rechts im Bild (x 700 bis 1000): Ihre Mitte bei 850 ließe einen 400 px breiten Namen rechts
        // hinausragen.
        const zone = band("tropisch", box(700, 300, 1500, 500));
        const [free] = placeBandLabels([zone], [], RECT, flat, ROOM);
        // Die Senkrechten liegen im Abstand von etwa COLUMN_SPACING: so genau steht die Mitte.
        expect(Math.abs(free!.at[0] - 850)).toBeLessThanOrEqual(COLUMN_SPACING / 2);
        const [wide] = placeBandLabels([zone], [], RECT, flat, ROOM, () => 400);
        expect(wide?.at[0]).toBeCloseTo(800, 6);
        expect(wide?.at[1]).toBeCloseTo(400, 6);
        // Breiter als das Bild: Er bleibt, wo er ist.
        const [huge] = placeBandLabels([zone], [], RECT, flat, ROOM, () => 1200);
        expect(huge?.at[0]).toBe(free?.at[0]);
    });

    it("eine Zone außerhalb des Bildes trägt keinen", () => {
        expect(placeBandLabels([band("polar", box(-500, -900, 1500, -100))], [], RECT, flat, ROOM)).toEqual([]);
    });

    it("🪤 Teile aus Nachbarkacheln überlappen sich im Puffer: der Name steht wie bei einem Stück", () => {
        const whole = placeBandLabels([band("b", box(-500, 300, 1500, 500))], [], RECT, flat, ROOM);
        const tiled = placeBandLabels(
            [band("b", box(-500, 300, 520, 500), box(480, 300, 1500, 500))],
            [],
            RECT,
            flat,
            ROOM,
        );
        expect(tiled[0]?.at[0]).toBeCloseTo(whole[0]!.at[0], 0);
        expect(tiled[0]?.at[1]).toBeCloseTo(whole[0]!.at[1], 6);
    });

    it("geneigt gilt die Mitte im Bild: eine Abbildung, die unten streckt, schiebt den Namen nicht aus dem Band", () => {
        // Unten im Bild ist ein Bodenstück doppelt so hoch wie oben (wie geneigt nah und fern).
        const tilted: GroundProjection = {
            toScreen: ([x, y]) => [x * SCALE, y * y * SCALE],
            toGround: ([x, y]) => [x / SCALE, Math.sqrt(Math.max(0, y) / SCALE)],
        };
        const zone = band("b", piece([[-0.5, 0.5, 1.5, 0.5, 1.5, 0.8, -0.5, 0.8]]));
        const [target] = placeBandLabels([zone], [], RECT, tilted, ROOM);
        // Grenzen im Bild: 250 und 640; die Mitte im Bild ist 445, nicht das Bild der Bodenmitte (0,65² = 422,5).
        expect(target?.at[1]).toBeCloseTo(445, 6);
    });
});

describe("Hilfen", () => {
    it("subtractSpans schneidet Löcher aus", () => {
        expect(
            subtractSpans(
                [[0, 1]],
                [
                    [0.2, 0.4],
                    [0.6, 0.7],
                ],
            ),
        ).toEqual([
            [0, 0.2],
            [0.4, 0.6],
            [0.7, 1],
        ]);
        expect(subtractSpans([[0.3, 0.5]], [[0, 1]])).toEqual([]);
        expect(subtractSpans([[0, 0.5]], [])).toEqual([[0, 0.5]]);
    });

    it("thinRing lässt Punkte weg, die näher als die Toleranz am vorigen liegen", () => {
        expect(thinRing([0, 0, 0.1, 0, 1, 0, 1, 1], 0.5)).toEqual([0, 0, 1, 0, 1, 1]);
    });
});

describe("Die Namen wandern ohne Sprung", () => {
    const target = (at: Point2): LabelTarget => ({ key: "b", name: "Boreale Zone", at, room: 100 });

    it("ein neuer Name steht sofort an seiner Stelle, der Punkt ist der Boden darunter", () => {
        const next = composeLabelPoints(new Map(), [target([500, 400])], flat);
        expect(next.shown.get("b")).toEqual([500, 400]);
        expect(next.settled).toBe(true);
        const [lng] = next.points.features[0]!.geometry.coordinates;
        expect(lng).toBeCloseTo(0.5 * 360 - 180, 9);
        expect(next.points.features[0]!.properties).toEqual({ type_key: "b", name: "Boreale Zone" });
    });

    it("🔴 springt seine Stelle, gleitet er hin (je Zug ein Anteil des Wegs), bis er angekommen ist", () => {
        const first = composeLabelPoints(new Map([["b", [500, 400] as Point2]]), [target([600, 400])], flat);
        expect(first.shown.get("b")?.[0]).toBeCloseTo(500 + 100 * FOLLOW, 9);
        expect(first.settled).toBe(false);
        let shown = first.shown;
        for (let i = 0; i < 40; i++) shown = composeLabelPoints(shown, [target([600, 400])], flat).shown;
        const last = composeLabelPoints(shown, [target([600, 400])], flat);
        expect(last.shown.get("b")).toEqual([600, 400]);
        expect(last.settled).toBe(true);
    });

    it("bei reduzierter Bewegung steht er sofort dort", () => {
        const next = composeLabelPoints(new Map([["b", [500, 400] as Point2]]), [target([600, 400])], flat, true);
        expect(next.shown.get("b")).toEqual([600, 400]);
        expect(next.settled).toBe(true);
    });

    it("eine Zone ohne Namen fällt aus dem Zustand", () => {
        const next = composeLabelPoints(new Map([["b", [500, 400] as Point2]]), [], flat);
        expect(next.shown.size).toBe(0);
        expect(next.points.features).toEqual([]);
    });
});
