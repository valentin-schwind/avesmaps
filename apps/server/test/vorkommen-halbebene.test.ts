import { describe, expect, it } from "vitest";
import { halbebeneAlsWkt, halbebeneVon, liegtInHalbebene, zwischenHalbebenen } from "../src/vorkommen/halbebene.ts";

/**
 * Die Lage zu einer Linie als Halbebene (WI-0257), ohne Datenbank. Die Zusagen sind die der Skizze im Regeleditor (`apps/web/test/inhalte-regel-lage.test.ts`): Die Karte rechnet `x` nach Osten und `y`
 * nach Norden; die Halbebene liegt auf der Seite der Richtung, A–B ist B–A, eine Linie GENAU in der Richtung trennt nichts.
 */

const gareth = { x: 500, y: 700 };

describe("Halbebene der Lage", () => {
    it("🔴 ein Ort: nördlich oberhalb der waagerechten Linie, südlich darunter, östlich rechts der senkrechten, westlich links", () => {
        const nord = halbebeneVon("nord", [gareth]);
        const sued = halbebeneVon("sued", [gareth]);
        const ost = halbebeneVon("ost", [gareth]);
        const west = halbebeneVon("west", [gareth]);
        expect(nord && liegtInHalbebene(nord, 100, 1200)).toBe(true);
        expect(nord && liegtInHalbebene(nord, 100, 200)).toBe(false);
        expect(sued && liegtInHalbebene(sued, 100, 200)).toBe(true);
        expect(sued && liegtInHalbebene(sued, 100, 1200)).toBe(false);
        expect(ost && liegtInHalbebene(ost, 900, 700)).toBe(true);
        expect(ost && liegtInHalbebene(ost, 100, 700)).toBe(false);
        expect(west && liegtInHalbebene(west, 100, 700)).toBe(true);
        expect(west && liegtInHalbebene(west, 900, 700)).toBe(false);
    });

    it("die Linie selbst gehört zur Halbebene (geschlossen)", () => {
        const nord = halbebeneVon("nord", [gareth]);
        expect(nord && liegtInHalbebene(nord, 123, 700)).toBe(true);
    });

    it("🔴 zwei Orte: die Linie läuft durch beide; südlich einer Linie von Südwesten nach Nordosten liegt der Südosten", () => {
        const west = { x: 200, y: 200 };
        const ost = { x: 600, y: 600 };
        const sued = halbebeneVon("sued", [west, ost]);
        const nord = halbebeneVon("nord", [west, ost]);
        expect(sued && liegtInHalbebene(sued, 800, 100)).toBe(true);
        expect(sued && liegtInHalbebene(sued, 100, 800)).toBe(false);
        expect(nord && liegtInHalbebene(nord, 800, 100)).toBe(false);
        expect(nord && liegtInHalbebene(nord, 100, 800)).toBe(true);
        // Östlich ist ebenfalls der Südosten, westlich der Nordwesten.
        const o = halbebeneVon("ost", [west, ost]);
        const w = halbebeneVon("west", [west, ost]);
        expect(o && liegtInHalbebene(o, 800, 100)).toBe(true);
        expect(w && liegtInHalbebene(w, 100, 800)).toBe(true);
    });

    it("A–B ist B–A: dieselbe Halbebene, in welcher Folge die Orte auch stehen", () => {
        const havena = { x: 342.5, y: 509.5 };
        const perricum = { x: 631.3, y: 507.3 };
        const ab = halbebeneVon("ost", [havena, perricum]);
        const ba = halbebeneVon("ost", [perricum, havena]);
        expect(ab).not.toBeNull();
        expect(ba).not.toBeNull();
        for (const p of [
            { x: 900, y: 600 },
            { x: 100, y: 600 },
            { x: 450, y: 1000 },
            { x: 450, y: 100 },
        ]) {
            expect(liegtInHalbebene(ab!, p.x, p.y), JSON.stringify(p)).toBe(liegtInHalbebene(ba!, p.x, p.y));
        }
    });

    it("🔴 eine Linie GENAU in der Richtung trennt nichts: ‚nördlich‘ einer Nord-Süd-Linie ist leer, ebenso zwei zusammenfallende Orte", () => {
        expect(
            halbebeneVon("nord", [
                { x: 100, y: 100 },
                { x: 100, y: 900 },
            ]),
        ).toBeNull();
        expect(
            halbebeneVon("sued", [
                { x: 100, y: 100 },
                { x: 100, y: 900 },
            ]),
        ).toBeNull();
        expect(
            halbebeneVon("ost", [
                { x: 100, y: 500 },
                { x: 900, y: 500 },
            ]),
        ).toBeNull();
        expect(
            halbebeneVon("nord", [
                { x: 5, y: 5 },
                { x: 5, y: 5 },
            ]),
        ).toBeNull();
        expect(halbebeneVon("nord", [])).toBeNull();
    });

    it("das Viereck für PostGIS überdeckt die ganze Karte und trägt die Seite der Richtung", () => {
        const sued = halbebeneVon("sued", [{ x: 750, y: 150 }]);
        expect(sued).not.toBeNull();
        const wkt = halbebeneAlsWkt(sued!);
        expect(wkt.startsWith("POLYGON((")).toBe(true);
        const zahlen = [...wkt.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/gu)].map((m) => [
            Number(m[1]),
            Number(m[2]),
        ]);
        // Fünf Punkte, geschlossen; alle Eckpunkte der Seite liegen auf oder unter y = 150, die Linie bei y = 150.
        expect(zahlen).toHaveLength(5);
        expect(zahlen[0]).toEqual(zahlen[4]);
        expect(Math.max(...zahlen.map(([, y]) => y as number))).toBe(150);
        expect(Math.min(...zahlen.map(([, y]) => y as number))).toBeLessThan(-1024);
    });
});

describe("„Zwischen A und B“ (WI-0253 §27 B)", () => {
    const imStreifen = (streifen: ReturnType<typeof zwischenHalbebenen>, x: number, y: number): boolean =>
        streifen !== null && streifen.every((halbebene) => liegtInHalbebene(halbebene, x, y));

    it("🔴 nord-süd auseinander: „südlich von A UND nördlich von B“ – der Streifen zwischen den waagerechten Linien, beide Linien gehören dazu", () => {
        const riva = { x: 300, y: 900 };
        const alanfa = { x: 700, y: 150 };
        const streifen = zwischenHalbebenen(riva, alanfa);
        expect(imStreifen(streifen, 100, 500)).toBe(true);
        expect(imStreifen(streifen, 900, 500)).toBe(true);
        expect(imStreifen(streifen, 100, 900)).toBe(true);
        expect(imStreifen(streifen, 100, 150)).toBe(true);
        expect(imStreifen(streifen, 100, 901)).toBe(false);
        expect(imStreifen(streifen, 100, 149)).toBe(false);
    });

    it("🔴 ost-west auseinander: „östlich von A UND westlich von B“ – der Streifen zwischen den senkrechten Linien", () => {
        const westen = { x: 100, y: 500 };
        const osten = { x: 800, y: 300 };
        const streifen = zwischenHalbebenen(westen, osten);
        expect(imStreifen(streifen, 400, 0)).toBe(true);
        expect(imStreifen(streifen, 400, 1000)).toBe(true);
        expect(imStreifen(streifen, 100, 400)).toBe(true);
        expect(imStreifen(streifen, 800, 400)).toBe(true);
        expect(imStreifen(streifen, 99, 400)).toBe(false);
        expect(imStreifen(streifen, 801, 400)).toBe(false);
    });

    it("A–B ist B–A, und bei gleichem Abstand in x und y gilt nord-süd", () => {
        const a = { x: 100, y: 100 };
        const b = { x: 300, y: 250 };
        for (const [x, y] of [
            [0, 0],
            [200, 180],
            [350, 120],
            [200, 400],
        ] as const) {
            expect(imStreifen(zwischenHalbebenen(a, b), x, y)).toBe(imStreifen(zwischenHalbebenen(b, a), x, y));
        }
        // Gleicher Abstand (200 in x, 200 in y): nord-süd, also gilt die Spanne in y und nicht die in x.
        const gleich = zwischenHalbebenen({ x: 0, y: 0 }, { x: 200, y: 200 });
        expect(imStreifen(gleich, 900, 100)).toBe(true);
        expect(imStreifen(gleich, 100, 900)).toBe(false);
    });

    it("zwei Orte an derselben Stelle: kein Streifen, der Rahmen trifft nichts", () => {
        expect(zwischenHalbebenen({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    });
});
