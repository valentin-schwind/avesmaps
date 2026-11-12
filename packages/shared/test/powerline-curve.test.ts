import { describe, expect, it } from "vitest";
import {
    powerlineCurvedPoints,
    powerlineCurveNormalOffset,
    powerlineCurveSteps,
    powerlineDrawnPath,
} from "../src/powerline-curve.ts";

/**
 * Die Bahn einer Kraftlinie (WI-0025).
 *
 * 💣 DER PRÜFSTEIN IST LEGACYS EIGENER TEST. Die Fälle unten sind aus
 * `js/map-features/__tests__/kraftlinie-kurvenform.test.js` (avesmaps@770c80e) übernommen, mit
 * denselben Zahlen. Besteht unsere Rechnung sie, ist sie dieselbe Kurve und nicht nur „auch
 * irgendeine Parabel".
 */

describe("Kraftlinien-Kurvenform, Legacys Testfälle", () => {
    it("🔴 curve = 0 ist EXAKT null, nicht nur nahe null", () => {
        // Die wichtigste Zusicherung: fast alle Kraftlinien sind gerade, und ein Rest wackelte die Karte.
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
            expect(powerlineCurveNormalOffset(0, t, 0, 0, 20, 0), `t = ${String(t)}`).toBe(0);
        }
        expect(powerlineCurveNormalOffset(null, 0.5, 0, 0, 20, 0)).toBe(0);
        expect(powerlineCurveNormalOffset(undefined, 0.5, 0, 0, 20, 0)).toBe(0);
        expect(powerlineCurveNormalOffset("quatsch", 0.5, 0, 0, 20, 0)).toBe(0);
    });

    it("der Scheitel ist der versprochene Prozentsatz der SEHNE, und die Form ist eine Parabel", () => {
        expect(powerlineCurveNormalOffset(25, 0.5, 0, 0, 20, 0)).toBeCloseTo(5, 9);
        expect(powerlineCurveNormalOffset(25, 0.5, 0, 0, 10, 0), "halbe Sehne, halbe Höhe").toBeCloseTo(2.5, 9);
        // Bei t = 0,25 trennen sich die Kurvenarten: Parabel 0,750 h, Sinus 0,707 h, Kreis 0,764 h.
        expect(powerlineCurveNormalOffset(25, 0.25, 0, 0, 20, 0)).toBeCloseTo(3.75, 9);
    });

    it("die Enden sind null: die Knoten liegen AUF der Linie", () => {
        expect(powerlineCurveNormalOffset(45, 0, 0, 0, 20, 0)).toBe(0);
        expect(powerlineCurveNormalOffset(45, 1, 0, 0, 20, 0)).toBe(0);
    });

    it("negativ spiegelt positiv exakt, und der Bereich wird geklemmt statt abgelehnt", () => {
        for (const t of [0.15, 0.35, 0.5, 0.8]) {
            expect(powerlineCurveNormalOffset(-30, t, 0, 0, 20, 0)).toBe(
                -powerlineCurveNormalOffset(30, t, 0, 0, 20, 0),
            );
        }
        expect(powerlineCurveNormalOffset(999, 0.5, 0, 0, 20, 0)).toBe(
            powerlineCurveNormalOffset(45, 0.5, 0, 0, 20, 0),
        );
        expect(powerlineCurveNormalOffset(-999, 0.5, 0, 0, 20, 0)).toBe(
            powerlineCurveNormalOffset(-45, 0.5, 0, 0, 20, 0),
        );
    });

    it("💣 die kanonische Richtung: vertauschte Enden schlagen auf DIESELBE Seite aus", () => {
        const hin = powerlineCurveNormalOffset(30, 0.5, 0, 0, 20, 0);
        const her = powerlineCurveNormalOffset(30, 0.5, 20, 0, 0, 0);
        expect(her).toBe(-hin);
        // Senkrecht entscheidet y: Süd → Nord ist die kanonische Richtung.
        expect(powerlineCurveNormalOffset(30, 0.5, 0, 20, 0, 0)).toBe(
            -powerlineCurveNormalOffset(30, 0.5, 0, 0, 0, 20),
        );
        // Die Gegenprobe, die den Sinn der Regel misst: dieselben Punkte, nur rückwärts.
        const bahnHin = powerlineCurvedPoints({ x: 0, y: 0 }, { x: 20, y: 0 }, 30, 8);
        const bahnHer = powerlineCurvedPoints({ x: 20, y: 0 }, { x: 0, y: 0 }, 30, 8);
        expect(bahnHer).toHaveLength(bahnHin.length);
        bahnHin.forEach((p, i) => {
            const q = bahnHer[bahnHer.length - 1 - i];
            expect(q?.x).toBeCloseTo(p.x, 9);
            expect(q?.y).toBeCloseTo(p.y, 9);
        });
    });

    it("die Stützpunktzahl: gerade = Grundzahl 8, voller Ausschlag = 24, monoton dazwischen", () => {
        expect(powerlineCurveSteps(0, 8)).toBe(8);
        expect(powerlineCurveSteps(45, 8)).toBe(24);
        expect(powerlineCurveSteps(-45, 8)).toBe(24);
        let vorher = powerlineCurveSteps(0, 8);
        for (let c = 1; c <= 45; c++) {
            const jetzt = powerlineCurveSteps(c, 8);
            expect(jetzt).toBeGreaterThanOrEqual(vorher);
            vorher = jetzt;
        }
        expect(powerlineCurveSteps(45, 32), "die Grundzahl ist die Untergrenze").toBe(32);
    });

    it("die Bahn trifft beide Knoten, und der Scheitel steht 25 % von 20 = 5 Einheiten ab", () => {
        const bahn = powerlineCurvedPoints({ x: 3, y: 7 }, { x: 23, y: 7 }, 25, 12);
        expect(bahn).toHaveLength(13);
        expect(bahn[0]?.x).toBeCloseTo(3, 9);
        expect(bahn[0]?.y).toBeCloseTo(7, 9);
        expect(bahn[12]?.x).toBeCloseTo(23, 9);
        expect(bahn[12]?.y).toBeCloseTo(7, 9);
        expect(bahn[6]?.y).toBeCloseTo(12, 9);
    });

    it("entartete Fälle fallen offen aus: kein NaN in der Geometrie", () => {
        for (const p of powerlineCurvedPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 40, 8)) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        expect(powerlineCurveNormalOffset(30, 0.5, Number.NaN, 0, 20, 0)).toBe(0);
    });
});

describe("die gezeichnete Bahn (Legacy getPowerlineCurvedLatLngs)", () => {
    it("🔴 ohne Bogen IST sie die Linie: genau ihre Punkte, keine zusätzlichen", () => {
        const linie = [
            { x: 400, y: 500 },
            { x: 480, y: 530 },
        ];
        expect(powerlineDrawnPath(linie, 0)).toEqual(linie);
        expect(powerlineDrawnPath(linie, null), "fehlender Wert heißt gerade").toEqual(linie);
    });

    it("mit Bogen zählen nur erster und letzter Punkt, mit Legacys Stützpunktzahl", () => {
        const linie = [
            { x: 400, y: 500 },
            { x: 480, y: 530 },
        ];
        // −9 % (Chalwens Griff im Bestand): round(8 + 9/45 · 16) = 11 Schritte, also 12 Punkte.
        const bahn = powerlineDrawnPath(linie, -9);
        expect(bahn).toHaveLength(12);
        expect(bahn[0]).toEqual(linie[0]);
        // West → Ost und negativ: der Bogen liegt auf der Seite −n, n = (−ty, tx) zeigt nach +y.
        const sehne = Math.hypot(80, 30);
        const scheitel = powerlineCurveNormalOffset(-9, 0.5, 400, 500, 480, 530);
        expect(scheitel).toBeCloseTo(-0.09 * sehne, 9);
    });
});
