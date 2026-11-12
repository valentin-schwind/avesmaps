import { describe, expect, it } from "vitest";
import { LEGACY_CATMULL, catmullRomLine } from "../src/catmull-rom.ts";

/**
 * Die gezeichnete Wegkurve (WI-0010).
 *
 * 💣 DER PRÜFSTEIN IST LEGACYS EIGENE MESSUNG. Sein Kommentar nennt eine Zahl: an einem rechten
 * Winkel taucht die Kurve mit den ausgelieferten Werten `0,732` Karteneinheiten unter den
 * einlaufenden Schenkel. Trifft unsere Implementierung diese Zahl, ist sie dieselbe Kurve — und
 * nicht nur „auch irgendein Catmull-Rom".
 */

describe("Catmull-Rom, die gezeichnete Kurve", () => {
    it("💣 trifft Legacys gemessenes Overshoot von 0,732 am rechten Winkel", () => {
        // Derselbe rechte Winkel, den Legacy vermessen hat: herein von links, hinaus nach oben.
        const ecke = catmullRomLine(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
            LEGACY_CATMULL,
        );
        const tiefsterPunkt = Math.min(...ecke.map((p) => p.y));
        const weitesterPunkt = Math.max(...ecke.map((p) => p.x));

        expect(tiefsterPunkt, "Einbuchtung unter den einlaufenden Schenkel").toBeCloseTo(-0.732, 2);
        expect(weitesterPunkt - 10, "Überschwingen über den auslaufenden Schenkel").toBeCloseTo(0.732, 2);
    });

    it("🪤 bewegt Anfang und Ende NICHT", () => {
        // Der letzte Abtastwert eines Abschnitts trägt t = 1 und landet exakt auf dem Stützpunkt.
        // Ein verschobener Endpunkt hiesse: die Strasse endet woanders als die Kreuzung liegt.
        const punkte = [
            { x: 3, y: 4 },
            { x: 17, y: 9 },
            { x: 25, y: 2 },
        ];
        const kurve = catmullRomLine(punkte);
        expect(kurve[0]).toEqual(punkte[0]);
        expect(kurve.at(-1)?.x).toBeCloseTo(25, 9);
        expect(kurve.at(-1)?.y).toBeCloseTo(2, 9);
    });

    it("🪤 lässt einen gemeinsamen Eckpunkt EINMAL entstehen, nicht doppelt", () => {
        // Sonst hätte die Kurve an jeder Ecke einen Doppelpunkt, und ST_LineMerge bräche daran.
        const kurve = catmullRomLine([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ]);
        const doppelte = kurve.filter((p, i) => i > 0 && p.x === kurve[i - 1]?.x && p.y === kurve[i - 1]?.y);
        expect(doppelte).toEqual([]);
        // 1 Startpunkt + 2 Abschnitte x 8 Abtastungen
        expect(kurve.length).toBe(1 + 2 * LEGACY_CATMULL.samples);
    });

    it("🔴 legt sich bei tension = 0 auf den Polygonzug zurück", () => {
        // Die Umkehrprobe: ohne Spannung darf keine Abweichung entstehen. Faellt sie, rechnet die
        // Formel etwas anderes als eine Tangentenskalierung.
        const kurve = catmullRomLine(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
            { samples: 8, tension: 0 },
        );
        expect(Math.min(...kurve.map((p) => p.y))).toBeCloseTo(0, 9);
        expect(Math.max(...kurve.map((p) => p.x))).toBeCloseTo(10, 9);
    });

    it("🪤 lässt eine gerade Strecke gerade", () => {
        const kurve = catmullRomLine([
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 20, y: 5 },
            { x: 30, y: 5 },
        ]);
        for (const punkt of kurve) {
            expect(punkt.y).toBeCloseTo(5, 9);
        }
    });
});
