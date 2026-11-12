import { describe, expect, it } from "vitest";
import { bereinige, mitGemeinsamenEcken, mitgezogen, schluessel, type Punkt } from "../src/editor/ring-form.ts";

/**
 * Die Prüfung der mitgezogenen Nachbarin (OPS-000079, „Fertig“ tat scheinbar nichts): Doppelte Ecken der Altdaten und neue Punkte auf der gemeinsamen Grenze ließ sie nicht durch; eine
 * fremde Ecke darf sie weiter nicht durchlassen.
 */

const P = (x: number, y: number): Punkt => [x, y];
const satz = (...punkte: Punkt[]): Set<string> => new Set(punkte.map(schluessel));
const A = P(0, 0);
const B = P(10, 0);
const C = P(10, 10);
const D = P(0, 10);
const ring = (...punkte: Punkt[]): Punkt[][][] => [[punkte]];

describe("Nachbarin und gemeinsame Ecken (ring-form)", () => {
    it("🔴 eine doppelte Ecke der Altdaten stört nicht: Die gezogene Ecke zählt, sonst nichts", () => {
        const alt = ring(A, B, B, C, D);
        const neu = bereinige(ring(P(1, 1), B, B, C, D));
        expect(mitgezogen(alt, neu, satz(A), satz(P(1, 1)))).toEqual([{ von: A, nach: P(1, 1) }]);
    });

    it("🔴 eine doppelte Ecke, die selbst gezogen wird, zählt einmal", () => {
        const alt = ring(A, B, B, C, D);
        const neu = bereinige(ring(A, P(11, 1), P(11, 1), C, D));
        expect(mitgezogen(alt, neu, satz(B), satz(P(11, 1)))).toEqual([{ von: B, nach: P(11, 1) }]);
    });

    it("🔴 ein neuer Punkt des Objekts auf der Grenze geht durch, mit und ohne bewegte Ecke", () => {
        const neuerPunkt = P(5, 0);
        const alt = ring(A, B, C, D);
        const neu = ring(A, neuerPunkt, B, C, D);
        expect(mitgezogen(alt, neu, satz(A, B), satz(A, neuerPunkt, B))).toBeUndefined();
        expect(mitGemeinsamenEcken(alt, neu, satz(A, B), satz(A, neuerPunkt, B))).toBe(true);
        expect(
            mitGemeinsamenEcken(alt, ring(A, neuerPunkt, P(11, 1), C, D), satz(A, B), satz(A, neuerPunkt, P(11, 1))),
        ).toBe(true);
        // Über das Ringende: hinter der letzten Ecke.
        expect(mitGemeinsamenEcken(alt, ring(A, B, C, D, P(0, 5)), satz(D, A), satz(D, P(0, 5), A))).toBe(true);
    });

    it("🔴 eine gemeinsame Ecke, auf ihre Nachbarin gezogen, fällt weg", () => {
        expect(mitGemeinsamenEcken(ring(A, B, C, D), ring(A, C, D), satz(B, C), satz(C))).toBe(true);
    });

    it("🔴 was der Entwurf hinterlässt, geht durch (OPS-000079: 44 × 400 an Metenar und Havena)", () => {
        const alt = ring(A, B, C, D);
        // Mitgezogen, dann mit Strg gelöst: Die Nachbarin liegt, wo das Gebiet nicht mehr ist.
        expect(mitGemeinsamenEcken(alt, ring(A, P(11, 1), C, D), satz(A, B), satz(A, P(12, 2)))).toBe(true);
        // Ein neuer Punkt auf der gemeinsamen Kante, dann mit Strg weggezogen.
        expect(mitGemeinsamenEcken(alt, ring(A, P(5, 1), B, C, D), satz(A, B), satz(A, P(5, 9), B))).toBe(true);
        // Das Gebiet rastet auf einer fremden Ecke ein und zieht sie weiter: Sie liegt auf seiner neuen Ecke.
        expect(mitGemeinsamenEcken(alt, ring(A, P(11, 1), C, D), satz(A), satz(A, P(11, 1)))).toBe(true);
    });

    it("🔴 alles andere zeichnet die Nachbarin um und bleibt abgelehnt", () => {
        const alt = ring(A, B, C, D);
        // Ein Punkt, den das Objekt nicht hat, auf einer Kante, die es nicht teilt.
        expect(mitGemeinsamenEcken(alt, ring(A, P(5, 5), B, C, D), satz(A), satz(A))).toBe(false);
        // Eine Ecke fällt weg, die das Objekt nie hatte.
        expect(mitGemeinsamenEcken(alt, ring(A, C, D), satz(A), satz(A))).toBe(false);
        // Eine fremde Ecke bewegt sich.
        expect(mitGemeinsamenEcken(alt, ring(A, P(11, 1), C, D), satz(A), satz(A))).toBe(false);
        // Ein neues Polygon, ein neuer Ring.
        expect(mitGemeinsamenEcken(alt, [[[A, B, C, D]], [[A, B, C]]], satz(A), satz(A))).toBe(false);
        expect(
            mitGemeinsamenEcken(
                alt,
                [
                    [
                        [A, B, C, D],
                        [A, B, C],
                    ],
                ],
                satz(A),
                satz(A),
            ),
        ).toBe(false);
    });

    it("eine lange Nachbarin mit einem neuen Punkt prüft nur die Mitte", () => {
        const lang: Punkt[] = Array.from({ length: 200_000 }, (_, i) => P(i, i % 7));
        const neuerPunkt = P(100_000.5, 3);
        const neu = [...lang.slice(0, 100_001), neuerPunkt, ...lang.slice(100_001)];
        expect(mitGemeinsamenEcken([[lang]], [[neu]], satz(), satz(neuerPunkt))).toBe(true);
    });
});
