import { describe, expect, it } from "vitest";
import { AIR_EDGE_PREFIX, catmullRomLine, FREE_SEA_EDGE_PREFIX, type CurvePoint } from "@avesmaps3d/shared";
import { segmentShape } from "../src/map/route-layers.ts";

/**
 * Anschlussstücke an einen Knoten (`joints`, WI-0147): Ein Ende, das die Antwort an einen Ortsknoten gezogen hat,
 * gehört nicht zur gezeichneten Wegkurve und darf die Glättung nicht verziehen.
 *
 * 💣 **Der Befund** (`discovery/seegraph-kehren-2026-10-14.md`, Nachtrag 2): Die Catmull-Rom-Tangente am vorletzten
 * Stützpunkt ist `(nächster − vorheriger) × 0,5`. Liegt der nächste Punkt nahe am vorletzten, behält sie die Länge
 * der langen Strecke davor, und die Kurve schießt über das kurze Endstück hinaus — gemessen über 3.802 Stellen des
 * Netzes im Mittel ein **Sechzehntel der Strecke davor**, bis zu 0,71 Einheiten, und fast unabhängig von der Länge
 * des Anschlussstücks (0,002 oder 0,45 Einheiten ändern daran nichts).
 *
 * Problemfälle: der Haken bleibt; die Linie reißt am Knoten; ein Abschnitt ohne Anschlussstück wird anders gezeichnet
 * als vorher; der Knoten erscheint doppelt; eine Zeichenlinie, die den Knoten schon kennt, bekommt ihn noch einmal.
 */

const punkt = ([x, y]: [number, number]): CurvePoint => ({ x, y });
const linie = (coordinates: [number, number][]) => ({ type: "LineString" as const, coordinates });

/** Der größte Abstand eines Punktes der gezeichneten Form von der Linie, die sie darstellen soll. */
function ausschlag(form: readonly CurvePoint[], gegen: readonly [number, number][]): number {
    let groesste = 0;
    for (const p of form) {
        let nah = Infinity;
        for (let index = 0; index < gegen.length - 1; index += 1) {
            const [ax, ay] = gegen[index] as [number, number];
            const [bx, by] = gegen[index + 1] as [number, number];
            const dx = bx - ax;
            const dy = by - ay;
            const laenge = dx * dx + dy * dy;
            const t = laenge > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / laenge)) : 0;
            nah = Math.min(nah, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
        }
        groesste = Math.max(groesste, nah);
    }
    return groesste;
}

/**
 * Die Zahlen von Tschorkeffskoje: Der Pfad läuft 1,1 Einheiten nach Südwest, und sein Ende liegt 0,002 Einheiten vom
 * Hafenknoten entfernt — also zeigt das Anschlussstück zurück.
 */
const hafen = (): [number, number][] => [
    [760.94, 679.55],
    [760.55, 678.52],
    [760.5516, 678.5212],
];

describe("Anschlussstücke an einen Knoten werden nicht mitgeglättet", () => {
    it("🔴 der Haken am Hafen verschwindet: der Ausschlag fällt von 0,08 auf null", () => {
        const geometry = linie(hafen());
        const ohne = segmentShape({ geometry, edge_id: "pfad-698#0" });
        const mit = segmentShape({ geometry, edge_id: "pfad-698#0", joints: { start: false, end: true } });
        // Ohne die Markierung schlägt die Kurve über die Linie aus - das ist der Befund.
        expect(ausschlag(ohne, geometry.coordinates)).toBeGreaterThan(0.07);
        // Mit ihr bleibt nur die Rohlinie: zwei Punkte, also gar keine Glättung, plus das gerade Anschlussstück.
        expect(ausschlag(mit, geometry.coordinates)).toBeLessThan(1e-9);
    });

    it("🔴 die Linie bleibt durchgehend: die Form beginnt und endet genau auf `geometry`", () => {
        const geometry = linie([
            [760.5516, 678.5212],
            [760.55, 678.52],
            [760.94, 679.55],
            [761.5, 680.1],
            [762.2, 680.4],
            [762.6, 681.0],
            [762.62, 681.02],
        ]);
        const form = segmentShape({ geometry, edge_id: "pfad#0", joints: { start: true, end: true } });
        expect(form[0]).toEqual(punkt(geometry.coordinates[0] as [number, number]));
        expect(form[form.length - 1]).toEqual(
            punkt(geometry.coordinates[geometry.coordinates.length - 1] as [number, number]),
        );
        // Kein Sprung in der Form: jeder Schritt bleibt unter der Länge des längsten Rohstücks.
        for (let index = 1; index < form.length; index += 1) {
            const vorher = form[index - 1] as CurvePoint;
            const jetzt = form[index] as CurvePoint;
            expect(Math.hypot(jetzt.x - vorher.x, jetzt.y - vorher.y)).toBeLessThan(1.2);
        }
    });

    it("ein Abschnitt ohne Anschlussstück wird gezeichnet wie vorher", () => {
        const geometry = linie([
            [0, 0],
            [10, 1],
            [20, 0],
            [30, 2],
        ]);
        const erwartet = catmullRomLine(geometry.coordinates.map(punkt));
        expect(segmentShape({ geometry, edge_id: "strasse#0" })).toEqual(erwartet);
        expect(segmentShape({ geometry, edge_id: "strasse#0", joints: { start: false, end: false } })).toEqual(
            erwartet,
        );
    });

    it("der Kern wird weiter geglättet, nur eben ohne die Enden", () => {
        const kern: [number, number][] = [
            [0, 0],
            [10, 1],
            [20, 0],
            [30, 2],
        ];
        const geometry = linie([[-0.002, 0], ...kern, [30.002, 2]]);
        const form = segmentShape({ geometry, edge_id: "strasse#0", joints: { start: true, end: true } });
        expect(form).toEqual([punkt([-0.002, 0]), ...catmullRomLine(kern.map(punkt)), punkt([30.002, 2])]);
    });

    it("🪤 ein geteilter Weg bekommt den Knoten angehängt, den seine Zeichenlinie nicht kennt", () => {
        // `RouteDisplay.piece` rechnet aus der Rohlinie: Die Zeichenlinie endet auf dem Wegende, nicht am Ort.
        const geometry = linie([
            [10, 10],
            [12, 11],
            [12.3, 11.4],
        ]);
        const display = linie([
            [10, 10],
            [11, 10.4],
            [12, 11],
        ]);
        const form = segmentShape({
            geometry,
            display,
            edge_id: "wp-slice-anker-0",
            joints: { start: false, end: true },
        });
        expect(form[form.length - 1]).toEqual(punkt([12.3, 11.4]));
        // Ohne die Markierung endete die Zeichnung 0,5 Einheiten vor dem Ort.
        const vorher = segmentShape({ geometry, display, edge_id: "wp-slice-anker-0" });
        expect(vorher[vorher.length - 1]).toEqual(punkt([12, 11]));
    });

    it("🪤 kennt die Zeichenlinie den Knoten schon, erscheint er nicht doppelt (Gang querfeldein)", () => {
        const geometry = linie([
            [5, 5],
            [6, 6],
            [7, 5],
            [7.002, 5],
        ]);
        // Ein gesuchter Gang kommt begradigt und beginnt und endet auf denselben Punkten wie `geometry`.
        const display = linie([
            [5, 5],
            [6.5, 5.8],
            [7.002, 5],
        ]);
        const form = segmentShape({ geometry, display, edge_id: "synthetic-1", joints: { start: false, end: true } });
        expect(form[form.length - 1]).toEqual(punkt([7.002, 5]));
        expect(form[form.length - 2]).not.toEqual(punkt([7.002, 5]));
    });

    it("die freie Seefahrt bleibt, wie sie ist: ihre Linie wird nicht angefasst", () => {
        const geometry = linie([
            [0, 0],
            [10, 0],
            [10, 10],
        ]);
        const display = linie([
            [0, 0],
            [8, 0.5],
            [10, 10],
        ]);
        const kante = `${FREE_SEA_EDGE_PREFIX}a-b`;
        expect(segmentShape({ geometry, display, edge_id: kante, joints: { start: true, end: true } })).toEqual(
            display.coordinates.map(punkt),
        );
    });

    it("ein Flug behält seine gerundeten Ecken und verliert sein Anschlussstück nicht", () => {
        const geometry = linie([
            [0, 0],
            [10, 10],
            [20, 0],
            [20.002, 0],
        ]);
        const kante = `${AIR_EDGE_PREFIX}a-b`;
        const form = segmentShape({ geometry, edge_id: kante, joints: { start: false, end: true } });
        expect(form[0]).toEqual(punkt([0, 0]));
        expect(form[form.length - 1]).toEqual(punkt([20.002, 0]));
        // Die Ecke bei [10,10] ist abgeschnitten, nicht mehr spitz.
        expect(form.some((p) => p.x === 10 && p.y === 10)).toBe(false);
    });
});
