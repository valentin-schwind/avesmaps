import { describe, expect, it } from "vitest";
import {
    LINIE_MINDEST,
    SYMBOL_RADIUS,
    FREI_MINDEST,
    fensterLinie,
    freiNebenMitte,
    linienPfad,
    type Rechteck,
} from "../src/photobox/fenster-linie.ts";

/**
 * Die Linie vom Fensterkopf zur Stelle (WI-0272 S2b, Aufgabe 12; Vali 2026-10-31: „Cool wärs wenn der titel des fensters (oben links) mit einer
 * linie mit dem icon auf der karte verbunden wär“). Sie geht von der Kante des Fensters aus, die der Stelle zugewandt ist, seitlich auf Höhe des
 * Titels, und endet am Rand des Symbols. Verdeckt das Fenster die Stelle (am Telefon das Blatt), gibt es nichts zu verbinden.
 */

const FENSTER: Rechteck = { links: 600, oben: 40, rechts: 1060, unten: 700 };
const KOPF_Y = 62;

describe("🔴 die Linie entfällt, wo das Fenster die Stelle verdeckt", () => {
    it("liegt der Punkt im Fensterrechteck, gibt es keine Linie", () => {
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 800, y: 300 })).toBeUndefined();
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 601, y: 41 })).toBeUndefined();
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 1059, y: 699 })).toBeUndefined();
    });

    it("knapp außerhalb des Fensters, aber dichter als die Mindestlänge am Anfang, auch nicht", () => {
        const dicht = fensterLinie(FENSTER, KOPF_Y, { x: FENSTER.links - (LINIE_MINDEST - 4), y: KOPF_Y });
        expect(dicht).toBeUndefined();
    });
});

describe("🔴 die Linie beginnt in der Titelhöhe am zugewandten Fensterrand", () => {
    it("liegt die Stelle links vom Fenster, beginnt sie an der linken Kante, in der Höhe des Titels", () => {
        const linie = fensterLinie(FENSTER, KOPF_Y, { x: 300, y: 400 });
        expect(linie?.von).toEqual({ x: FENSTER.links, y: KOPF_Y });
    });

    it("liegt sie rechts, beginnt sie an der rechten Kante, ebenfalls in der Höhe des Titels", () => {
        const linie = fensterLinie(FENSTER, KOPF_Y, { x: 1400, y: 120 });
        expect(linie?.von).toEqual({ x: FENSTER.rechts, y: KOPF_Y });
    });

    it("liegt sie darüber, beginnt sie an der Oberkante, am Punkt entlang, aber 12 px innerhalb der Ecken", () => {
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 800, y: -100 })?.von).toEqual({ x: 800, y: FENSTER.oben });
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 605, y: -100 })?.von).toEqual({
            x: FENSTER.links + 12,
            y: FENSTER.oben,
        });
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 1055, y: -100 })?.von).toEqual({
            x: FENSTER.rechts - 12,
            y: FENSTER.oben,
        });
    });

    it("liegt sie darunter, beginnt sie an der Unterkante", () => {
        expect(fensterLinie(FENSTER, KOPF_Y, { x: 800, y: 900 })?.von).toEqual({ x: 800, y: FENSTER.unten });
    });
});

describe("die Linie endet am Rand des Symbols, nicht in seiner Mitte", () => {
    it("das Ende liegt SYMBOL_RADIUS vor der Stelle, auf der Geraden vom Anfang", () => {
        const stelle = { x: 300, y: 62 };
        const linie = fensterLinie(FENSTER, KOPF_Y, stelle)!;
        expect(linie.von).toEqual({ x: 600, y: 62 });
        expect(linie.bis.y).toBeCloseTo(62, 6);
        expect(linie.bis.x).toBeCloseTo(300 + SYMBOL_RADIUS, 6);
    });

    it("schräg: der Abstand des Endes zur Stelle ist der Symbolradius", () => {
        const stelle = { x: 300, y: 400 };
        const linie = fensterLinie(FENSTER, KOPF_Y, stelle)!;
        expect(Math.hypot(linie.bis.x - stelle.x, linie.bis.y - stelle.y)).toBeCloseTo(SYMBOL_RADIUS, 6);
    });
});

describe("der Pfad der Linie", () => {
    it("ein Strich von Anfang zum Ende", () => {
        expect(linienPfad({ von: { x: 1, y: 2 }, bis: { x: 3.5, y: 4 } })).toBe("M1 2L3.5 4");
    });
});

describe("🔴 steht das Fenster in der Mitte, landet die Stelle neben ihm: links, sonst rechts (Entwurf 8)", () => {
    const KARTE: Rechteck = { links: 0, oben: 0, rechts: 1280, unten: 800 };
    /** Ein Fenster von 520 Breite in der Mitte der Karte (`mitte` der Hülle). */
    const MITTE: Rechteck = { links: 380, oben: 10, rechts: 900, unten: 790 };

    it("🔴 links ist frei: Die Fläche links vom Fenster bleibt, die rechte (vom Fenster bis zum Rand) ist gedeckt (`right`)", () => {
        expect(freiNebenMitte(MITTE, KARTE)).toEqual({ right: 1280 - 380 + 24 });
        // Gar nicht anders als ein Fenster, das weiter links steht, solange links noch Platz bleibt.
        expect(freiNebenMitte({ ...MITTE, links: 200, rechts: 720 }, KARTE)).toEqual({ right: 1280 - 200 + 24 });
    });

    it("🔴 ein offener Planer links nimmt der linken Fläche Platz: Bleibt zu wenig, geht die Stelle nach rechts (`left`)", () => {
        // Planer samt Lasche bis 330: bleibt 380 - 330 - 24 = 26 px links, aber rechts 380 - 24.
        expect(freiNebenMitte(MITTE, KARTE, { links: 330 })).toEqual({ left: 900 + 24 });
        // Reicht der Planer nicht weit, bleibt es links.
        expect(freiNebenMitte(MITTE, KARTE, { links: 200 })).toEqual({ right: 1280 - 380 + 24 });
    });

    it("die Grenze ist `FREI_MINDEST` neben dem Fenster und seinem Rand von 24 px", () => {
        const knapp: Rechteck = { links: FREI_MINDEST + 24, oben: 10, rechts: FREI_MINDEST + 24 + 520, unten: 790 };
        expect(freiNebenMitte(knapp, KARTE)).toEqual({ right: 1280 - knapp.links + 24 });
        const zuKnapp: Rechteck = { ...knapp, links: knapp.links - 1, rechts: knapp.rechts - 1 };
        expect(freiNebenMitte(zuKnapp, KARTE)).toEqual({ left: zuKnapp.rechts + 24 });
    });

    it("ein Panel rechts (Info, Editor) nimmt der rechten Fläche Platz; ist links nichts frei, bleibt keine Seite: `undefined`", () => {
        const links: Rechteck = { links: 100, oben: 10, rechts: 620, unten: 790 };
        expect(freiNebenMitte(links, KARTE, { rechts: 700 })).toBeUndefined();
        expect(freiNebenMitte(links, KARTE, { rechts: 1000 })).toEqual({ left: 620 + 24 });
        // Ein Fenster, das die ganze Karte füllt (schmaler Schirm), lässt keine Seite.
        expect(freiNebenMitte({ links: 8, oben: 8, rechts: 1272, unten: 792 }, KARTE)).toBeUndefined();
    });

    it("ein angedocktes Fenster am rechten Rand: die Fläche links davon", () => {
        const angedockt: Rechteck = { links: 860, oben: 0, rechts: 1280, unten: 800 };
        expect(freiNebenMitte(angedockt, KARTE)).toEqual({ right: 1280 - 860 + 24 });
    });
});
