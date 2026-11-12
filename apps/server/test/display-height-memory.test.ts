import { describe, expect, it } from "vitest";
import { contourSet, displayHeightRevision } from "../src/terrain/display-height/bands.ts";
import { pointCount, type ContourLine } from "../src/terrain/display-height/contours.ts";
import { lineJson } from "../src/terrain/display-height/line-json.ts";

/**
 * I13, Speicherspitze (WI-0055, Nachtrag 2026-09-29): Die Rechnung der Linien und der Text für die Datenbank
 * laufen auf flachen, typisierten Feldern statt auf Feldern von [x, y]. Das darf das Ergebnis nicht ändern:
 * Die Revisionen unten hat der Vorgänger (Felder von Paaren) für dieselben Felder geliefert, bevor er
 * ersetzt wurde. Ändert eine Änderung der Linien sie, gehört der Generator (`DISPLAY_HEIGHT_GENERATOR`) hoch.
 */

/** Wie `lineJson` vor dem Puffer: ein Feld von [x, y] und `JSON.stringify`. */
function referenceJson(line: ContourLine): string {
    return JSON.stringify({
        type: "LineString",
        coordinates: Array.from({ length: pointCount(line) }, (_, q) => [
            Math.round((line.coords[2 * q] as number) * 1e4) / 1e4,
            Math.round((line.coords[2 * q + 1] as number) * 1e4) / 1e4,
        ]),
    });
}

const lineOf = (coords: number[]): ContourLine => ({
    ele: 100,
    level: 0,
    closed: false,
    coords: Float64Array.from(coords),
});

describe("Text einer Linie für die Datenbank", () => {
    it("schreibt jede Zahl wie JSON.stringify: Randfälle der Rundung, Vorzeichen, endende Nullen", () => {
        const values = [
            0, -0, 1, -1, 0.5, -0.5, 12.5, 100, 1000, 1023.9999, 1024, 1024.125, 0.0001, -0.0001, 0.00004, -0.00004,
            0.00005, -0.00005, 0.00015, 0.12345, 0.12355, 99.99995, 5.05, 5.005, 5.0005, 5.00005, 7.1, 7.10001, 1e-9,
            -1e-9, 123456.7891, -123456.7891, 99999999.9999,
        ];
        const line = lineOf(values.flatMap((v, i) => [v, values[(i + 7) % values.length] as number]));
        expect(lineJson(line)).toBe(referenceJson(line));
    });

    it("stimmt bei 200 000 zufälligen Werten in Kartengröße überein", () => {
        let seed = 20260929;
        const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        const coords: number[] = [];
        for (let q = 0; q < 200_000; q += 1) {
            // Ein Teil auf wenigen Nachkommastellen (viele endende Nullen), ein Teil beliebig.
            const v = random() * 1030 - 3;
            coords.push(q % 3 === 0 ? Math.round(v * 100) / 100 : q % 3 === 1 ? Math.round(v * 10) / 10 : v);
        }
        const line = lineOf(coords);
        expect(lineJson(line)).toBe(referenceJson(line));
    });

    it("fällt für Werte außerhalb der Karte, NaN und unendliche auf die Schreibweise von JSON.stringify zurück", () => {
        for (const coords of [
            [1e9, 2, 3, 4],
            [1, 2, -2.5e10, 4],
            [1, Number.NaN, 3, 4],
            [1, 2, Number.POSITIVE_INFINITY, 4],
        ]) {
            const line = lineOf(coords);
            expect(lineJson(line)).toBe(referenceJson(line));
        }
        expect(lineJson(lineOf([]))).toBe(referenceJson(lineOf([])));
    });
});

describe("Linien und Stufen auf flachen Feldern: dieselbe Revision wie zuvor", () => {
    // Historical byte parity uses the historical bands, independently of later cartographic changes.
    const historicalSteps = [0, 100, 200, 500, 1000, 2000, 3000, 4000];
    const n = 64;
    const none = new Uint8Array(n * n);
    const half = Uint8Array.from({ length: n * n }, (_, k) => (k % n >= 32 ? 4 : 0));
    const stripes = Uint8Array.from({ length: n * n }, (_, k) =>
        (Math.floor((k % n) / 9) + Math.floor(k / n / 11)) % 2 === 0 ? 4 : 0,
    );
    const hill = Float32Array.from({ length: n * n }, (_, k) => {
        const x = k % n;
        const y = (k - x) / n;
        return Math.max(0, 1250 * (1 - Math.hypot(x - 31.5, y - 31.5) / 30));
    });
    const ridge = Float32Array.from({ length: n * n }, (_, k) => {
        const x = k % n;
        const y = (k - x) / n;
        return Math.max(0, 900 + 700 * Math.sin(x / 5) * Math.cos(y / 7) + 300 * Math.sin((x + y) / 3));
    });

    // Generator 3 (Befund Höhenstufen 2026-10-03): Der Rücken hat Gitterecken genau auf 900; der 900er-Ring, der durch
    // eine solche Ecke lief, schrumpfte in der Vereinfachung auf einen Punkt, und die alte Revision (`62f25432aa9c`,
    // `4a97a70e0218`) hielt genau diesen Fehler fest. Die Hügel haben keine solche Ecke und blieben gleich.
    it.each([
        ["Hügel, Flachland", hill, none, "8e8244511a95"],
        ["Hügel, halb Gebirge (Linien in Stücken)", hill, half, "0e6f9e2c41d3"],
        ["Rücken, Flachland", ridge, none, "6890947ca3dc"],
        ["Rücken, Gebirge in Streifen (viele Wechsel)", ridge, stripes, "4e48336399da"],
    ])("%s", (_name, field, classes, revision) => {
        expect(displayHeightRevision(contourSet(field, classes, n, undefined, undefined, historicalSteps))).toBe(
            revision,
        );
    });

    it("meldet die Läufe über die Höhen, ohne das Ergebnis zu ändern", () => {
        const phases: string[] = [];
        const set = contourSet(ridge, stripes, n, undefined, (phase) => phases.push(phase), historicalSteps);
        expect(phases.length).toBeGreaterThan(0);
        expect(phases.every((phase) => phase.startsWith("linien bis "))).toBe(true);
        expect(displayHeightRevision(set)).toBe("4e48336399da");
    });
});
