import { describe, expect, it } from "vitest";
import { stuetzpunkteZuordnen, type Stuetzpunkt } from "../src/stuetzpunkte-zuordnen.ts";

/**
 * Welcher alte Stützpunkt einer Wegkurve ist welcher neue (WI-0259: die Höhe eines Flusspunkts wandert mit; Vali 2026-10-30: verschoben
 * geht sie mit, gelöscht fällt sie weg, ein eingefügter Punkt hat keine eigene). Rein.
 *
 * Problemfälle: Ein Punkt, der nach dem Runden an seiner Stelle liegt, gilt als verschoben und nimmt seine Höhe mit; ein gelöschter und ein
 * eingefügter Punkt im selben Schritt werden zu einem „verschoben“; eine umgekehrte Kurve vertauscht die Höhen der Punkte; Anfang und Ende
 * richten sich falsch aus, wenn die Zahl der Punkte wechselt.
 */

const P = (x: number, y: number): Stuetzpunkt => ({ x, y });
const lage = (...punkte: [number, number][]): Stuetzpunkt[] => punkte.map(([x, y]) => P(x, y));

describe("Stützpunkte zuordnen", () => {
    it("gleiche Folge: alles bleibt, auch bei Abweichung unter der Toleranz (Runden auf fünf Stellen)", () => {
        const alt = lage([0, 0], [10.123456789, 4], [20, 0]);
        const neu = lage([0, 0], [10.12346, 4], [20, 0]);
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben).toEqual([]);
        expect(z.geloescht).toEqual([]);
        expect(z.eingefuegt).toEqual([]);
        expect(z.bleibt.map((b) => [b.alt, b.neu])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2],
        ]);
    });

    it("gleiche Länge: ein Punkt mit geänderter Lage am selben Index ist verschoben", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [5, 5], [10, 0]), lage([0, 0], [6, 7], [10, 0]));
        expect(z.verschoben).toEqual([{ alt: 1, neu: 1, von: P(5, 5), nach: P(6, 7) }]);
        expect(z.bleibt.map((b) => b.alt)).toEqual([0, 2]);
        expect(z.geloescht).toEqual([]);
        expect(z.eingefuegt).toEqual([]);
    });

    it("gleiche Länge: Anfang und Ende verschoben, ein Punkt dazwischen bleibt", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [5, 5], [10, 0]), lage([1, 1], [5, 5], [11, 1]));
        expect(z.verschoben.map((v) => [v.alt, v.von, v.nach])).toEqual([
            [0, P(0, 0), P(1, 1)],
            [2, P(10, 0), P(11, 1)],
        ]);
    });

    it("kleiner als die Toleranz bewegt: nichts verschoben (die Höhe hängt dort weiter an der Lage)", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [5, 5]), lage([0, 0], [5.00005, 5]));
        expect(z.verschoben).toEqual([]);
    });

    it("Punkt gelöscht: nichts verschoben, der alte Index ist gelöscht, die übrigen richten sich aus", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [3, 1], [6, 2], [9, 0]), lage([0, 0], [6, 2], [9, 0]));
        expect(z.geloescht).toEqual([1]);
        expect(z.eingefuegt).toEqual([]);
        expect(z.verschoben).toEqual([]);
        expect(z.bleibt.map((b) => [b.alt, b.neu])).toEqual([
            [0, 0],
            [2, 1],
            [3, 2],
        ]);
    });

    it("Punkt eingefügt: nichts verschoben, der neue Index ist eingefügt", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [6, 2], [9, 0]), lage([0, 0], [3, 1], [6, 2], [9, 0]));
        expect(z.eingefuegt).toEqual([1]);
        expect(z.geloescht).toEqual([]);
        expect(z.verschoben).toEqual([]);
    });

    it("Vereinfachen: viele Punkte weg, die übrigen bleiben an ihrer Stelle, nichts wandert", () => {
        const alt = lage([0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1], [6, 0]);
        const neu = lage([0, 0], [2, 0], [4, 0], [6, 0]);
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben).toEqual([]);
        expect(z.geloescht).toEqual([1, 3, 5]);
        expect(z.bleibt.map((b) => b.alt)).toEqual([0, 2, 4, 6]);
    });

    it("andere Länge, Lücke mit gleich vielen alten und neuen Punkten: paarweise verschoben", () => {
        // Alt: A B1 B2 C D, neu: A X1 X2 C D E: zwischen A und C zwei gegen zwei, hinter D ein neuer Punkt.
        const alt = lage([0, 0], [1, 1], [2, 1], [3, 0], [4, 0]);
        const neu = lage([0, 0], [1, 2], [2, 2], [3, 0], [4, 0], [5, 0]);
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben.map((v) => [v.alt, v.neu, v.nach])).toEqual([
            [1, 1, P(1, 2)],
            [2, 2, P(2, 2)],
        ]);
        expect(z.eingefuegt).toEqual([5]);
        expect(z.geloescht).toEqual([]);
    });

    it("andere Länge, Lücke mit ungleich vielen Punkten: gelöscht und eingefügt, nichts verschoben", () => {
        // Alt: A B C D, neu: A X Y Z D: in der Lücke zwei alte gegen drei neue Punkte.
        const z = stuetzpunkteZuordnen(
            lage([0, 0], [1, 1], [2, 1], [3, 0]),
            lage([0, 0], [1, 2], [2, 2], [2.5, 2], [3, 0]),
        );
        expect(z.verschoben).toEqual([]);
        expect(z.geloescht).toEqual([1, 2]);
        expect(z.eingefuegt).toEqual([1, 2, 3]);
    });

    it("gleiche Länge, ein Punkt gelöscht und einer eingefügt: es gilt der gleiche Index, doch was noch dasteht, bleibt", () => {
        // Alt: A B C D, neu: A C D E. Nach der Regel „gleiche Länge, gleicher Index“ wäre B auf C, C auf D und D auf E gewandert; C und D stehen
        // aber noch da, ihre Höhen bleiben an ihren Stellen. Nur B gilt als verschoben (die Datenbank lässt die Höhe dort, wo schon eine ist).
        const z = stuetzpunkteZuordnen(lage([0, 0], [1, 1], [2, 0], [3, 0]), lage([0, 0], [2, 0], [3, 0], [4, 0]));
        expect(z.verschoben.map((v) => v.alt)).toEqual([1]);
        expect(z.bleibt.map((b) => b.alt)).toEqual([0, 2, 3]);
        expect(z.eingefuegt).toEqual([2, 3]);
    });

    it("umgekehrte Kurve: jede alte Lage ist noch da, nichts wandert (die Höhen bleiben an ihren Stellen)", () => {
        const alt = lage([0, 0], [1, 1], [2, 0], [3, 1]);
        const neu = [...alt].reverse();
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben).toEqual([]);
        expect(z.bleibt.map((b) => b.alt)).toEqual([0, 1, 2, 3]);
    });

    it("zwei Punkte hintereinander verschoben (gleiche Länge): beide wandern, jeder an seinen Index", () => {
        const z = stuetzpunkteZuordnen(lage([0, 0], [1, 1], [2, 1], [3, 0]), lage([0, 0], [1, 5], [2, 5], [3, 0]));
        expect(z.verschoben.map((v) => [v.alt, v.nach])).toEqual([
            [1, P(1, 5)],
            [2, P(2, 5)],
        ]);
    });

    it("ein Punkt auf die Lage eines anderen alten Punkts gezogen: er gilt als verschoben, der andere bleibt", () => {
        const alt = lage([0, 0], [4, 4], [8, 0], [12, 4], [16, 0]);
        const neu = lage([0, 0], [12, 4], [8, 0], [12, 4], [16, 0]);
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben).toEqual([{ alt: 1, neu: 1, von: P(4, 4), nach: P(12, 4) }]);
        expect(z.bleibt.map((b) => b.alt)).toEqual([0, 2, 3, 4]);
    });

    it("leere Folgen und nur eine Seite leer", () => {
        expect(stuetzpunkteZuordnen([], [])).toEqual({ bleibt: [], verschoben: [], geloescht: [], eingefuegt: [] });
        expect(stuetzpunkteZuordnen(lage([0, 0], [1, 1]), [])).toEqual({
            bleibt: [],
            verschoben: [],
            geloescht: [0, 1],
            eingefuegt: [],
        });
        expect(stuetzpunkteZuordnen([], lage([0, 0]))).toEqual({
            bleibt: [],
            verschoben: [],
            geloescht: [],
            eingefuegt: [0],
        });
    });

    it("eine eigene Toleranz: gleich ist, was `gleich` sagt", () => {
        const grob = (a: Stuetzpunkt, b: Stuetzpunkt) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
        const z = stuetzpunkteZuordnen(lage([0, 0], [5, 5]), lage([0, 0], [5.5, 5]), grob);
        expect(z.verschoben).toEqual([]);
    });

    it("lange Kurve (4.000 Punkte) mit einem Punkt weniger rechnet schnell und findet nichts Verschobenes", () => {
        const alt = Array.from({ length: 4000 }, (_, i) => P(i, (i * 7) % 13));
        const neu = alt.filter((_, i) => i !== 1700);
        const start = performance.now();
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(performance.now() - start).toBeLessThan(2000);
        expect(z.verschoben).toEqual([]);
        expect(z.geloescht).toEqual([1700]);
    });

    it("lange Kurve stark vereinfacht (4.000 → 400 Punkte) richtet sich über die Teilfolge aus", () => {
        const alt = Array.from({ length: 4000 }, (_, i) => P(i, (i * 7) % 13));
        const neu = alt.filter((_, i) => i % 10 === 0);
        const z = stuetzpunkteZuordnen(alt, neu);
        expect(z.verschoben).toEqual([]);
        expect(z.bleibt).toHaveLength(400);
        expect(z.geloescht).toHaveLength(3600);
    });
});
