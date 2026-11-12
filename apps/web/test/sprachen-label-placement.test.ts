import { describe, expect, it } from "vitest";
import {
    composeLabelPoints,
    piece,
    placeBandLabels,
    type BandShape,
    type GroundProjection,
    type LabelTarget,
    type Piece,
    type ScreenRect,
} from "../src/map/area-label-placement.ts";

/**
 * Wo der Name einer Sprache steht (WI-0261 S5a, E5): wie bei den Klimazonen mittig im sichtbaren Teil, aber Sprachen überlappen
 * sich (E2). Darum weicht ein Name einem schon gesetzten aus, statt wegzufallen, und braucht Platz über seine ganze Breite
 * (Bauvorlage `namenZiele`, Regeln 6 und 7 in `area-label-placement.ts`). Gerechnet an einer flachen Karte: Boden 0…1 auf
 * 1000 × 1000 Bildpunkte.
 */

const SCALE = 1000;
const flat: GroundProjection = {
    toScreen: ([x, y]) => [x * SCALE, y * SCALE],
    toGround: ([x, y]) => [x / SCALE, y / SCALE],
};
const ROOM = 26;
const RECT: ScreenRect = { left: 0, top: 0, right: 1000, bottom: 1000 };
const AUSWEICHEN = { ausweichen: true } as const;

/** Ein Rechteck am Boden, in Bildpunkten angegeben. */
function box(left: number, top: number, right: number, bottom: number): Piece {
    const [l, t, r, b] = [left / SCALE, top / SCALE, right / SCALE, bottom / SCALE];
    return piece([[l, t, r, t, r, b, l, b]]);
}

function sprache(key: string, ...pieces: Piece[]): BandShape {
    return { key, name: key, pieces };
}

/** Die Fläche eines gesetzten Namens im Bild (Breite aus `widthOf`, Höhe `ROOM`). */
function flaeche(target: LabelTarget, width: number): [number, number, number, number] {
    return [target.at[0] - width / 2, target.at[1] - ROOM / 2, target.at[0] + width / 2, target.at[1] + ROOM / 2];
}

const ueberlappen = (a: number[], b: number[]): boolean =>
    a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;

describe("Sprachnamen weichen einander aus", () => {
    it("🔴 zwei Sprachen mit derselben Mitte: die größere steht in ihrer Mitte, die kleinere rückt im eigenen Teil an die nächste freie Stelle", () => {
        // Garethi deckt das ganze Bild, Orkisch nur die Mitte (300–700): Beide Schwerpunkte liegen bei (500, 500).
        const bands = [sprache("orkisch", box(300, 300, 700, 700)), sprache("garethi", box(-500, -500, 1500, 1500))];
        const breite = 200;
        const targets = placeBandLabels(bands, [], RECT, flat, ROOM, () => breite, AUSWEICHEN);
        const garethi = targets.find((target) => target.key === "garethi")!;
        const orkisch = targets.find((target) => target.key === "orkisch")!;
        expect(garethi.at[0]).toBeCloseTo(500, 0);
        expect(garethi.at[1]).toBeCloseTo(500, 0);
        expect(orkisch, "fällt nicht weg").toBeDefined();
        expect(ueberlappen(flaeche(garethi, breite), flaeche(orkisch, breite))).toBe(false);
        // Im eigenen Teil und mit ganzer Breite darin.
        const [l, t, r, b] = flaeche(orkisch, breite);
        expect(l).toBeGreaterThanOrEqual(300 - 1e-6);
        expect(r).toBeLessThanOrEqual(700 + 1e-6);
        expect(t).toBeGreaterThanOrEqual(300 - 1e-6);
        expect(b).toBeLessThanOrEqual(700 + 1e-6);
        // Die nächste freie Stelle: knapp über oder unter dem Namen von Garethi, nicht irgendwo am Rand.
        expect(Math.abs(orkisch.at[1] - 500)).toBeLessThanOrEqual(ROOM * 1.5);
    });

    it("🔴 der Klimazonen-Weg bleibt, wie er war: dort stehen beide Namen auf derselben Stelle (Zonen überlappen sich nie)", () => {
        const bands = [sprache("orkisch", box(300, 300, 700, 700)), sprache("garethi", box(-500, -500, 1500, 1500))];
        const targets = placeBandLabels(bands, [], RECT, flat, ROOM, () => 200);
        expect(targets.map((target) => target.key)).toEqual(["orkisch", "garethi"]);
        expect(targets[0]!.at[1]).toBeCloseTo(targets[1]!.at[1], 6);
    });

    it("🔴 findet eine Sprache keinen freien Platz in ihrem Teil, steht sie nicht", () => {
        // Orkisch ist nur ein Streifen, genau so hoch wie ein Name, und Garethi setzt zuerst genau dorthin.
        const bands = [sprache("orkisch", box(300, 487, 700, 513)), sprache("garethi", box(-500, -500, 1500, 1500))];
        const targets = placeBandLabels(bands, [], RECT, flat, ROOM, () => 200, AUSWEICHEN);
        expect(targets.map((target) => target.key)).toEqual(["garethi"]);
    });
});

describe("Sprachnamen brauchen Platz in der Breite", () => {
    // Eine Sprache wie ein „U“: zwei Schenkel (100–300 und 700–900), unten verbunden (600–700). Der Schwerpunkt liegt in der Lücke.
    const u = sprache("u", box(100, 100, 300, 700), box(700, 100, 900, 700), box(100, 600, 900, 700));

    it("🔴 ein Name, der über eine Lücke der eigenen Fläche reichte, steht dort, wo sie ihn über die ganze Breite trägt", () => {
        const breite = 300;
        const [target] = placeBandLabels([u], [], RECT, flat, ROOM, () => breite, AUSWEICHEN);
        expect(target).toBeDefined();
        const [l, t, r, b] = flaeche(target!, breite);
        // Nur der Steg unten (600–700) ist breit genug: Dort steht der Name, ganz darin (bis auf die Rundung).
        expect(t).toBeGreaterThanOrEqual(600 - 1e-6);
        expect(b).toBeLessThanOrEqual(700 + 1e-6);
        expect(l).toBeGreaterThanOrEqual(100 - 1e-6);
        expect(r).toBeLessThanOrEqual(900 + 1e-6);
    });

    it("🔴 schmaler als der Name: kein Name (die Klimazonen prüfen nur die Senkrechte der Mitte und setzten ihn)", () => {
        const schmal = sprache("schmal", box(450, 100, 550, 900));
        expect(placeBandLabels([schmal], [], RECT, flat, ROOM, () => 300, AUSWEICHEN)).toEqual([]);
        expect(placeBandLabels([schmal], [], RECT, flat, ROOM, () => 300)).toHaveLength(1);
    });

    it("🔴 breiter als die freie Fläche: kein Name; sonst bleibt er ganz in ihr", () => {
        const weit = sprache("weit", box(-500, 300, 1500, 500));
        expect(placeBandLabels([weit], [], RECT, flat, ROOM, () => 1200, AUSWEICHEN)).toEqual([]);
        const frei: ScreenRect = { left: 350, top: 0, right: 1000, bottom: 1000 };
        const rand = sprache("rand", box(-500, 300, 450, 500));
        const [target] = placeBandLabels([rand], [], frei, flat, ROOM, () => 80, AUSWEICHEN);
        expect(target!.at[0] - 40).toBeGreaterThanOrEqual(350 - 1e-6);
        expect(target!.at[0] + 40).toBeLessThanOrEqual(450 + 1e-6);
    });

    it("das Meer zählt nicht als Platz: über dem Wasser steht kein Teil des Namens", () => {
        const kueste = sprache("kueste", box(-500, 300, 1500, 500));
        // Das Meer deckt alles rechts von 600; links davon bleiben 600 Bildpunkte Land.
        const meer = [box(600, -500, 1500, 1500)];
        const [target] = placeBandLabels([kueste], meer, RECT, flat, ROOM, () => 500, AUSWEICHEN);
        expect(target!.at[0] + 250).toBeLessThanOrEqual(600 + 1e-6);
        expect(placeBandLabels([kueste], meer, RECT, flat, ROOM, () => 700, AUSWEICHEN)).toEqual([]);
    });
});

describe("Die Farben des Namens reisen mit", () => {
    it("🔴 die Eigenschaften der Sprache stehen im Punkt der Quelle, neben Schlüssel und Namen", () => {
        const garethi: BandShape = {
            key: "garethi",
            name: "Garethi",
            pieces: [box(-500, -500, 1500, 1500)],
            properties: { schrift: "#4a3300", saum: "#f6efe4" },
        };
        const targets = placeBandLabels([garethi], [], RECT, flat, ROOM, () => 100, AUSWEICHEN);
        const { points } = composeLabelPoints(new Map(), targets, flat);
        expect(points.features[0]!.properties).toEqual({
            type_key: "garethi",
            name: "Garethi",
            schrift: "#4a3300",
            saum: "#f6efe4",
        });
    });
});
