import { describe, expect, it } from "vitest";
import { FLAGGEN, streifenRechtecke, type Streifen } from "../src/controls/flaggen.ts";
import { LOCALES } from "../src/i18n/plural.ts";

/**
 * Die Flaggen des Sprachschalters (Kanal OPS-000014). Ohne Browser prüfbar, weil die Rechnung von der Zeichnung
 * getrennt ist: Hier zählt, dass jede Sprache eine Flagge hat und dass die Streifen das Feld lückenlos füllen.
 */

describe("Jede Sprache hat ihre Flagge", () => {
    it("🔴 keine Sprache ohne Flagge — eine neue wäre ein Typfehler, dieser Test ist die Gegenprobe", () => {
        expect(LOCALES.filter((sprache) => FLAGGEN[sprache] === undefined)).toEqual([]);
    });

    it("Englisch ist geteilt: USA links, Großbritannien rechts", () => {
        const en = FLAGGEN.en;
        expect(en.art).toBe("geteilt");
        if (en.art === "geteilt") {
            expect(en.links.art).toBe("usa");
            expect(en.rechts.art).toBe("union");
        }
    });
});

describe("Die Streifen füllen das Feld", () => {
    const feld = { x: 0, y: 0, breite: 16, hoehe: 11 };

    it("drei gleiche Streifen waagerecht: lückenlos und bis zum Rand", () => {
        const teile = streifenRechtecke(FLAGGEN.de as Streifen, feld);
        expect(teile).toHaveLength(3);
        expect(teile[0]!.y).toBe(0);
        expect(teile.at(-1)!.y + teile.at(-1)!.hoehe).toBe(11);
        for (let i = 1; i < teile.length; i += 1) {
            expect(teile[i]!.y).toBeCloseTo(teile[i - 1]!.y + teile[i - 1]!.hoehe, 10);
        }
    });

    it("senkrecht teilt die Breite, nicht die Höhe", () => {
        const teile = streifenRechtecke(FLAGGEN.fr as Streifen, feld);
        expect(teile.map((t) => t.hoehe)).toEqual([11, 11, 11]);
        expect(teile.at(-1)!.x + teile.at(-1)!.breite).toBe(16);
    });

    it("🪤 Spanien ist 1 : 2 : 1 — das Gelb ist doppelt so hoch wie jedes Rot", () => {
        const teile = streifenRechtecke(FLAGGEN.es as Streifen, feld);
        expect(teile[1]!.hoehe).toBeCloseTo(2 * teile[0]!.hoehe, 10);
        expect(teile.at(-1)!.y + teile.at(-1)!.hoehe).toBe(11);
    });

    it("💣 krumme Teilung lässt keine Haarlinie frei — der letzte Streifen bekommt den Rest", () => {
        const drei = streifenRechtecke(FLAGGEN.de as Streifen, { x: 0, y: 0, breite: 16, hoehe: 10 });
        expect(drei.at(-1)!.y + drei.at(-1)!.hoehe).toBe(10);
    });
});
