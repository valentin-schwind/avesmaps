import { describe, expect, it } from "vitest";
import type { Point } from "../src/derive/chordal-axis.ts";
import { pathLength, resample } from "../src/derive/chordal-axis.ts";
import { fitParametricCurve, maxDeviationAngle } from "../src/derive/curve-fit.ts";
import { acceptedCurveOutside, KNOWN_OUTLIERS } from "../src/derive/curve-review.ts";
import { preservesRunContracts, selectCoveredRunSets } from "../src/derive/curve-placement.ts";
import { type DerivedRun, displayedNameWidth, fingerprintOf, placeRuns } from "../src/derive/label-runs.ts";
import { runFitsAngle, runsForPart, SLIDE_SHARE } from "../src/derive/path-runs.ts";
import {
    AUSWEICHRAUM,
    ausweichLauf,
    calmestWindow,
    kurvenstueck,
    labelFitsAngle,
    mapUnitsPerPixel,
    sliceByLength,
    splitIntoInstances,
    zoomWhereInstancesFit,
} from "../src/derive/run-geometry.ts";

/**
 * Die Aufteilung eines Schriftlaufs und die Bänder, in denen sie gilt (WI-0004).
 *
 * Die Geometrie selbst steht in `chordal-axis.test.ts`. Hier steht, was die ABLEITUNG daraus macht:
 * wie viele Namen auf eine Kurve kommen, ab welcher Zoomstufe, und woran sie erkennt, dass ein Lauf
 * veraltet ist.
 */

function straightLine(length: number): Point[] {
    return [
        { x: 0, y: 0 },
        { x: length, y: 0 },
    ];
}

describe("Geordneter Polynomfit (WI-0116)", () => {
    const crescent = Array.from({ length: 121 }, (_, index) => {
        const angle = (-0.75 + (1.5 * index) / 120) * Math.PI;
        return { x: 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
    });

    it("erhält beide Arme einer Sichel, die im Hauptachsenframe zurückläuft", () => {
        const fitted = fitParametricCurve(crescent, 120, 3);
        expect(pathLength(fitted)).toBeGreaterThan(180);
        expect(fitted.some((point) => point.x > 40)).toBe(true);
        expect(fitted[0]?.y).toBeLessThan(-30);
        expect(fitted.at(-1)?.y).toBeGreaterThan(30);
    });

    it.each([2, 3, 4, 5])(
        "bleibt bei Grad %i unter Maßwechsel, Verschiebung und Umkehr dieselbe Geometrie",
        (degree) => {
            const baseline = fitParametricCurve(crescent, 120, degree);
            const scaled = fitParametricCurve(
                crescent.map(({ x, y }) => ({ x: 700 + x * 0.001, y: 300 + y * 0.001 })),
                120,
                degree,
            );
            const reversed = fitParametricCurve([...crescent].reverse(), 120, degree).reverse();
            for (const [index, point] of baseline.entries()) {
                expect(((scaled[index]?.x ?? 0) - 700) / 0.001).toBeCloseTo(point.x, 6);
                expect(((scaled[index]?.y ?? 0) - 300) / 0.001).toBeCloseTo(point.y, 6);
                expect(reversed[index]?.x).toBeCloseTo(point.x, 6);
                expect(reversed[index]?.y).toBeCloseTo(point.y, 6);
            }
        },
    );

    it("behält den gewählten Grad als wirksame Einstellung und endet bei einer konstanten Achse", () => {
        const curves = [2, 3, 4, 5].map((degree) => fitParametricCurve(crescent, 120, degree));
        expect(new Set(curves.map((curve) => JSON.stringify(curve))).size).toBe(4);
        expect(
            fitParametricCurve(
                [
                    { x: 4, y: 7 },
                    { x: 4, y: 7 },
                ],
                120,
                3,
            ).every((point) => point.x === 4 && point.y === 7),
        ).toBe(true);
        expect(fitParametricCurve([], 120)).toEqual([]);
    });
});

describe("Bestehende Abnahmen und Laufvertrag (WI-0116)", () => {
    const run = (length: number, instance = 0, zoom = 3): DerivedRun => ({
        instance,
        instanceCount: 2,
        runMinZoom: zoom,
        runMaxZoom: zoom,
        points: straightLine(length),
    });

    it("bewahrt die bestehende Reviewliste und konkave Einzelpolygone, ohne die Sichel hinzuzufügen", () => {
        expect(KNOWN_OUTLIERS).toEqual([
            "Dragwallthal",
            "Farlornschwelle",
            "Tommellande",
            "Rathilswall",
            "Dschungel von Atoum",
            "Amboss",
            "Horobans Wälder",
            "Dschungel des östlichen Regengebirges",
            "Eisklingenschlucht",
            "Gangreb Flusstal",
            "Östlicher Hangwald der Windhagberge",
            "Flusslande",
        ]);
        expect(KNOWN_OUTLIERS.every((name) => acceptedCurveOutside(name, false))).toBe(true);
        expect(acceptedCurveOutside("Schwarze Sichel", false)).toBe(false);
        expect(acceptedCurveOutside("Beliebige konkave Einzelfläche", true)).toBe(true);
    });

    it("tauscht keine Kopie oder lesbare Namenslänge gegen Innenlage", () => {
        const original = [run(40), run(40, 1)];
        expect(preservesRunContracts(original, [run(40)], 120)).toBe(false);
        expect(preservesRunContracts(original, [run(40), run(40, 1, 4)], 120)).toBe(false);
        expect(preservesRunContracts(original, [run(40), run(10, 1)], 120)).toBe(false);
        expect(preservesRunContracts(original, [run(40), run(40, 1)], 120)).toBe(true);
    });

    it("🔴 ein Einzellauf trägt seinen Namen wie jeder andere Satz, auch als Ersatz für einen zu kurzen (I7)", () => {
        // Bis 2026-10-11 blieb ein schon zu kurzer Einzellauf zulässig, solange der Ersatz nicht noch kürzer wurde. Ein zu kurzer
        // Lauf kostet aber den NAMEN (Dairuchsee); seit `ausweichLauf` trägt jeder Einzellauf ihn, und der Ersatz muss es auch.
        const single = (length: number): DerivedRun => ({ ...run(length), instanceCount: 1 });
        expect(preservesRunContracts([single(10)], [single(12)], 120)).toBe(false);
        expect(preservesRunContracts([single(10)], [single(30)], 120)).toBe(true);
        expect(preservesRunContracts([single(10)], [run(12), run(12, 1)], 120)).toBe(false);
        expect(preservesRunContracts([run(10), run(10, 1)], [run(12), run(12, 1)], 120)).toBe(false);
    });

    it("übernimmt nur komplette Sätze und lässt ihre Anzahl beim Heranzoomen nicht sinken", () => {
        const original = [run(40), run(40, 1), run(40, 0, 4), run(40, 1, 4)];
        const alternatives = [{ runs: original, shares: [1, 0.2, 1, 1] }];
        expect(selectCoveredRunSets(original, [0.2, 1, 1, 1], alternatives, 120)).toBeNull();
        const threeThenTwo = [
            ...[0, 1, 2].map((instance) => ({ ...run(40, instance), instanceCount: 3 })),
            run(40, 0, 4),
            run(40, 1, 4),
        ];
        expect(
            selectCoveredRunSets(original, [0.2, 0.2, 1, 1], [{ runs: threeThenTwo, shares: [1, 1, 1, 1, 1] }], 120),
        ).toBeNull();
        expect(selectCoveredRunSets(original, [1, 1, 1, 1], [], 120)).toEqual(original);
    });
});

describe("Aufteilung in Instanzen", () => {
    it("teilt gleichmäßig und lässt die Lücke dazwischen", () => {
        const runs = splitIntoInstances(straightLine(100), 3, 10);
        expect(runs).toHaveLength(3);
        // 100 = 3 Stücke + 2 Lücken à 10 -> je 26.67
        for (const run of runs) {
            expect(pathLength(run)).toBeCloseTo(80 / 3, 6);
        }
        // Außen wird nicht eingezogen: das erste Stück beginnt am Anfang der Kurve.
        expect(runs[0]?.[0]).toEqual({ x: 0, y: 0 });
        expect(runs[2]?.[1]?.x).toBeCloseTo(100, 6);
    });

    it("verteilt für eine kleinere Zahl VOLLSTÄNDIG neu, statt eine wegzulassen", () => {
        const three = splitIntoInstances(straightLine(100), 3, 10);
        const two = splitIntoInstances(straightLine(100), 2, 10);
        expect(two).toHaveLength(2);
        // 🪤 Zwei Instanzen sind nicht zwei der drei: jede ist länger, und keine liegt, wo eine der
        // drei lag. Genau das meint die Betreiberregel "lieber EINE Kopie als zwei ungleiche".
        expect(pathLength(two[0] as Point[])).toBeGreaterThan(pathLength(three[0] as Point[]));
        expect(two[1]?.[1]?.x).toBeCloseTo(100, 6);
    });

    it("gibt nichts zurück, wenn die Lücken länger sind als die Kurve", () => {
        expect(splitIntoInstances(straightLine(10), 3, 20)).toEqual([]);
    });
});

describe("Zoomband der Instanzzahl", () => {
    const nameWidth = 160;
    const gap = 36;

    it("findet die Stufe, auf der die geforderte Zahl nebeneinander passt", () => {
        // Eine Kurve von 40 Karteneinheiten. Auf Stufe z misst ein Pixel mapUnitsPerPixel(z)
        // Einheiten, die Kurve am Schirm also 40 / dieser Wert.
        const zoom = zoomWhereInstancesFit(40, 1, nameWidth, gap, 10);
        expect(zoom).not.toBeNull();
        expect(40 / mapUnitsPerPixel(zoom as number)).toBeGreaterThanOrEqual(nameWidth);
        // Eine Stufe tiefer reicht es nicht mehr - sonst wäre die gefundene nicht die niedrigste.
        expect(40 / mapUnitsPerPixel((zoom as number) - 1)).toBeLessThan(nameWidth);
    });

    it("verlangt für mehr Instanzen nie eine niedrigere Stufe", () => {
        const one = zoomWhereInstancesFit(40, 1, nameWidth, gap, 12) as number;
        const two = zoomWhereInstancesFit(40, 2, nameWidth, gap, 12) as number;
        const three = zoomWhereInstancesFit(40, 3, nameWidth, gap, 12) as number;
        expect(two).toBeGreaterThan(one);
        // 🪤 Nicht STRENG steigend, und das ist keine Ungenauigkeit: eine Zoomstufe verdoppelt die
        // Kurve am Schirm, drei Namen statt zwei brauchen aber nur die Hälfte mehr. Zwei und drei
        // landen deshalb regelmäßig auf derselben Stufe - dann fällt der Satz mit zwei Instanzen
        // aus, weil der mit drei sein Band von unten wegnimmt.
        expect(three).toBeGreaterThanOrEqual(two);
    });

    it("gibt null zurück statt einer geratenen Stufe jenseits des Bandes", () => {
        expect(zoomWhereInstancesFit(0.001, 3, nameWidth, gap, 7)).toBeNull();
    });

    it("rechnet Karteneinheiten und Bildschirmpixel über eine Kachelbreite von 512 um", () => {
        // Der Kartenraum ist 1024 Einheiten breit; auf Stufe 0 ist die Welt 512 Pixel breit.
        expect(mapUnitsPerPixel(0)).toBeCloseTo(2, 12);
        expect(mapUnitsPerPixel(1)).toBeCloseTo(1, 12);
        expect(mapUnitsPerPixel(8)).toBeCloseTo(1024 / (512 * 256), 12);
    });
});

describe("Fingerabdruck", () => {
    const inputs = { nameWidthPixels: 180, labelMinZoom: 2, labelMaxZoom: 7, curveMax: 1, curveDegree: 3 };

    it("entwertet einen Lauf, wenn eine Umbenennung seinen Abnahmestatus ändert", () => {
        expect(fingerprintOf([], { ...inputs, reviewedCurve: true })).not.toBe(fingerprintOf([], inputs));
        expect(fingerprintOf([], { ...inputs, reviewedCurve: false })).toBe(fingerprintOf([], inputs));
    });

    it("unterscheidet 3 von 1+1+1", () => {
        const one = fingerprintOf([{ publicId: "a", revision: 3 }], inputs);
        const three = fingerprintOf(
            [
                { publicId: "a", revision: 1 },
                { publicId: "b", revision: 1 },
                { publicId: "c", revision: 1 },
            ],
            inputs,
        );
        expect(one).not.toEqual(three);
    });

    it("erkennt eine ausgetauschte Fläche bei gleicher Summe und Anzahl", () => {
        const before = fingerprintOf(
            [
                { publicId: "a", revision: 2 },
                { publicId: "b", revision: 2 },
            ],
            inputs,
        );
        const after = fingerprintOf(
            [
                { publicId: "a", revision: 2 },
                { publicId: "c", revision: 2 },
            ],
            inputs,
        );
        expect(before).not.toEqual(after);
    });

    it("hängt nicht an der Reihenfolge, in der die Flächen ankommen", () => {
        const areas = [
            { publicId: "b", revision: 7 },
            { publicId: "a", revision: 1 },
        ];
        expect(fingerprintOf(areas, inputs)).toEqual(fingerprintOf([...areas].reverse(), inputs));
    });

    it("🔴 erkennt jede andere Eingabe der Ableitung, nicht nur die Flächen (WI-0019)", () => {
        const areas = [{ publicId: "a", revision: 1 }];
        const reference = fingerprintOf(areas, inputs);
        // Ein längerer Name, ein anderes Band, eine andere Instanzzahl, ein anderer Grad: jede
        // dieser Änderungen ändert die Läufe, also muss sie den Fingerabdruck ändern.
        for (const change of [
            { nameWidthPixels: 181 },
            { labelMinZoom: 3 },
            { labelMaxZoom: 6 },
            { curveMax: 2 },
            { curveDegree: 5 },
        ]) {
            expect(fingerprintOf(areas, { ...inputs, ...change }), JSON.stringify(change)).not.toEqual(reference);
        }
    });
});

describe("Winkelprüfung wie MapLibre (WI-0010 P5)", () => {
    /**
     * 💣 MapLibre verwirft einen Linienname STILL, wenn die Linie unter ihm in einem Stück von 3/5
     * Schriftgröße um mehr als `text-max-angle` dreht. Über Gareth standen deshalb von 42 Wegnamen
     * in den Kacheln nur 7 auf der Karte. Die Ableitung muss dieselbe Frage stellen.
     */
    const grad = (g: number): number => (g * Math.PI) / 180;
    const knick = (winkel: number, beiX: number, laenge: number): Point[] => [
        { x: 0, y: 0 },
        { x: beiX, y: 0 },
        { x: beiX + Math.cos(grad(winkel)) * (laenge - beiX), y: Math.sin(grad(winkel)) * (laenge - beiX) },
    ];
    /** Ein Kreisbogen mit `schritte` gleichen Knicken, zusammen `gesamt` Grad. */
    const bogen = (gesamt: number, schritte: number, laenge: number): Point[] => {
        const punkte: Point[] = [{ x: 0, y: 0 }];
        const stueck = laenge / schritte;
        let richtung = 0;
        for (let i = 0; i < schritte; i += 1) {
            const letzter = punkte[punkte.length - 1] as Point;
            punkte.push({ x: letzter.x + Math.cos(richtung) * stueck, y: letzter.y + Math.sin(richtung) * stueck });
            richtung += grad(gesamt / (schritte - 1));
        }
        return punkte;
    };

    it("lässt eine gerade Linie durch", () => {
        expect(labelFitsAngle(straightLine(100), 60, 6, grad(45), grad(90))).toBe(true);
    });

    it("🔴 verwirft einen rechten Winkel mitten unter dem Namen", () => {
        expect(labelFitsAngle(knick(90, 50, 100), 60, 6, grad(45), grad(90))).toBe(false);
    });

    it("🪤 ein Knick AUSSERHALB des Namens stört nicht — MapLibre setzt ihn in die Mitte", () => {
        // Knick bei 10 von 100, der Name belegt 30..70.
        expect(labelFitsAngle(knick(90, 10, 100), 40, 6, grad(45), grad(90))).toBe(true);
    });

    it("⭐ verwirft einen sanften Bogen, der insgesamt über 90° dreht (Legacys Deckel)", () => {
        // 120° in 40 Schritten: örtlich je 3°, also für MapLibre unauffällig — für Legacy zu viel.
        const linie = bogen(120, 40, 100);
        expect(labelFitsAngle(linie, 95, 6, grad(45), grad(90))).toBe(false);
        expect(labelFitsAngle(linie, 95, 6, grad(45), grad(360))).toBe(true);
    });

    it("die Fenstersuche weicht auf ein gerades Stück aus, wenn es eines gibt", () => {
        // Rechter Winkel bei 30, danach 70 Einheiten gerade: ein 30er-Fenster findet dort Platz.
        const linie = knick(90, 30, 100);
        const fenster = calmestWindow(linie, 30, undefined, (w) => labelFitsAngle(w, 30, 6, grad(45), grad(90)));
        expect(fenster.length).toBeGreaterThanOrEqual(2);
        expect(labelFitsAngle(fenster, 30, 6, grad(45), grad(90))).toBe(true);
        expect(pathLength(fenster)).toBeCloseTo(30, 6);
    });

    it("gibt nichts zurück, wenn keine Stelle ruhig genug ist", () => {
        const zickzack: Point[] = Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: i % 2 === 0 ? 0 : 5 }));
        expect(calmestWindow(zickzack, 40, undefined, (w) => labelFitsAngle(w, 40, 6, grad(45), grad(90)))).toEqual([]);
    });
});

describe("Namensbreite, wie die Karte sie zeichnet (WI-0014)", () => {
    /**
     * 💣 Gebirge, Inseln, Inselgruppen, Regionen und Kontinente stehen in VERSALIEN. Die Läufe
     * wurden für die gewöhnliche Schreibung zugeschnitten, und MapLibre verwarf „DRACHENSTEINE"
     * still, weil der Name länger war als sein Lauf.
     */
    it("🔴 misst einen Gebirgsnamen in Versalien", () => {
        const gewoehnlich = displayedNameWidth({ labelText: "Drachensteine", labelSize: 20, labelType: "wald" });
        const gebirge = displayedNameWidth({ labelText: "Drachensteine", labelSize: 20, labelType: "gebirge" });
        const vonHand = displayedNameWidth({ labelText: "DRACHENSTEINE", labelSize: 20, labelType: "wald" });
        expect(gebirge).toBeGreaterThan(gewoehnlich * 1.15);
        expect(gebirge).toBeCloseTo(vonHand, 9);
    });

    it("🪤 ohne Regionsart keine Versalien", () => {
        expect(displayedNameWidth({ labelText: "Albernia", labelSize: 20, labelType: null })).toBeCloseTo(
            displayedNameWidth({ labelText: "Albernia", labelSize: 20, labelType: "wald" }),
            9,
        );
    });
});

describe("Ausweichraum der Wegnamen (Migration 0030)", () => {
    /**
     * Die Kachel setzt den bevorzugten Kandidaten in die MITTE des Laufs und verschiebt die übrigen
     * um bis zu ¼ Namenslänge. Dafür muss der Lauf um genau diesen Raum länger sein — und zwar
     * GLEICH nach beiden Seiten, sonst läge die Mitte nicht mehr auf der ruhigen Stelle.
     */
    it("⭐ verlängert den Lauf nach beiden Seiten gleich weit, höchstens um den Ausweichraum", () => {
        const breitePx = 100;
        const linie = straightLine(2000 * mapUnitsPerPixel(8));
        const mitteDerLinie = pathLength(linie) / 2;
        const laeufe = runsForPart(linie, breitePx, 0).filter((run) => run.instanceCount === 1);
        expect(laeufe.length).toBeGreaterThan(0);
        let verlaengert = false;
        for (const lauf of laeufe) {
            const name = breitePx * mapUnitsPerPixel(lauf.runMinZoom);
            const laenge = pathLength(lauf.points);
            expect(laenge).toBeGreaterThanOrEqual(name - 1e-9);
            expect(laenge).toBeLessThanOrEqual(name * (1 + 2 * SLIDE_SHARE) + 1e-9);
            // Die Mitte bleibt auf der ruhigen Stelle — bei einer Geraden die Mitte der Linie.
            const [a, b] = [lauf.points[0] as Point, lauf.points[lauf.points.length - 1] as Point];
            expect((a.x + b.x) / 2).toBeCloseTo(mitteDerLinie, 6);
            verlaengert ||= laenge > name + 1e-9;
        }
        // 🪤 Auf der untersten Stufe ist die Linie oft gerade so lang wie der Name — dann GIBT es
        // keinen Ausweichraum, und er wird gekappt. Auf mindestens einer Stufe muss er entstehen.
        const breit = runsForPart(straightLine(20000 * mapUnitsPerPixel(8)), breitePx, 0);
        verlaengert ||= breit.some(
            (lauf) => pathLength(lauf.points) > breitePx * mapUnitsPerPixel(lauf.runMinZoom) + 1e-9,
        );
        expect(verlaengert, "irgendwo entsteht Ausweichraum").toBe(true);
    });

    it("🔴 die Mitte des verlängerten Laufs besteht die Winkelprüfung", () => {
        const breitePx = 100;
        const linie = straightLine(2000 * mapUnitsPerPixel(8));
        for (const lauf of runsForPart(linie, breitePx, 0)) {
            expect(runFitsAngle(lauf.points, breitePx, lauf.runMinZoom)).toBe(true);
        }
    });

    it("🪤 ¼ ist die Obergrenze: mehr, und derselbe Name stünde vor der nächsten Stufe doppelt", () => {
        expect(SLIDE_SHARE).toBeLessThanOrEqual(0.25);
    });
});

/**
 * Eine Badewanne: 30 Einheiten flacher Boden, an beiden Enden ein Viertelkreis mit Radius 10 bis
 * senkrecht nach oben. Die Sehne der ganzen Kurve liegt 10 Einheiten über dem Boden - dieselbe Lage
 * wie bei Farlornschwelle, deren Sehne über den Blauen See läuft.
 */
function bathtub(): Point[] {
    const points: Point[] = [];
    for (let step = 0; step <= 30; step += 1) {
        const angle = Math.PI + (step / 30) * (Math.PI / 2);
        points.push({ x: -15 + 10 * Math.cos(angle), y: 10 + 10 * Math.sin(angle) });
    }
    for (let step = 1; step < 30; step += 1) {
        points.push({ x: -15 + step, y: 0 });
    }
    for (let step = 0; step <= 30; step += 1) {
        const angle = 1.5 * Math.PI + (step / 30) * (Math.PI / 2);
        points.push({ x: 15 + 10 * Math.cos(angle), y: 10 + 10 * Math.sin(angle) });
    }
    return resample(points, 120);
}

function distanceToLine(point: Point, line: readonly Point[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < line.length; index += 1) {
        const a = line[index - 1] as Point;
        const b = line[index] as Point;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
    }
    return best;
}

/** Was die Kachel auf Stufe `zoom` zeigt: die Mitte jedes Laufs, dessen Band sie enthält, so lang wie der Name. */
function shownAt(runs: readonly DerivedRun[], zoom: number, nameWidthPixels: number): Point[][] {
    return runs
        .filter((run) => zoom >= run.runMinZoom && zoom <= run.runMaxZoom)
        .map((run) => {
            const total = pathLength(run.points);
            const want = Math.min(total, nameWidthPixels * mapUnitsPerPixel(zoom));
            return sliceByLength(run.points, (total - want) / 2, (total + want) / 2);
        });
}

describe("Platzierung je Zoomstufe (WI-0018)", () => {
    const curve = bathtub();
    // Auf der untersten Stufe ist der Name 40 Prozent länger als die ganze Kurve - wie
    // „FARLORNSCHWELLE" bei z3 (143 Prozent). Zwei Stufen höher passt er bequem auf den Boden.
    const nameWidthPixels = (1.4 * pathLength(curve)) / mapUnitsPerPixel(3);
    const placement = { nameWidthPixels, gapPixels: 36, lowest: 3, highest: 8, wanted: 1, labelSize: 18 };

    it("🔴 Regression Farlornschwelle: was die Kachel zeigt, liegt auf der Kurve, sobald der Name passt", () => {
        const runs = placeRuns(curve, placement);
        for (const zoom of [5, 6, 7, 8]) {
            const shown = shownAt(runs, zoom, nameWidthPixels);
            expect(shown, `z${String(zoom)}: genau ein Name`).toHaveLength(1);
            const offset = Math.max(...(shown[0] as Point[]).map((point) => distanceToLine(point, curve)));
            // Vorher: der Lauf für das ganze Band war die zur Sehne plattgedrückte Kurve, und die
            // Kachel zeigte dessen Mitte - mehrere Einheiten über dem Boden, also neben der Fläche.
            expect(offset, `z${String(zoom)}: Abstand zur Kurve`).toBeLessThan(0.05);
        }
    });

    it("🔴 I7: ein einzelner Name hat auf JEDER Stufe einen Lauf, der ihn trägt, auch wo die ganze Kurve zu kurz ist", () => {
        // Befund 2026-10-11 (Dairuchsee, z5: Lauf 94 px, Name breiter): MapLibre setzt mit `line-center` keinen Namen, der länger
        // ist als seine Linie, und eine Region mit Lauf zeigt ihren Punktnamen nicht. Ein zu kurzer Lauf kostete so den NAMEN.
        // Hier ist der Name auf z3 und z4 länger als die ganze Kurve; der Lauf wird wie in Legacy verlängert.
        const runs = placeRuns(curve, placement);
        for (const zoom of [3, 4, 5, 6, 7, 8]) {
            const here = runs.filter((run) => run.runMinZoom <= zoom && zoom <= run.runMaxZoom);
            expect(here, `z${String(zoom)}: genau ein Lauf`).toHaveLength(1);
            expect(
                pathLength((here[0] as DerivedRun).points),
                `z${String(zoom)}: trägt den Namen`,
            ).toBeGreaterThanOrEqual(nameWidthPixels * mapUnitsPerPixel(zoom));
        }
    });

    it("🔴 I4: die Verlängerung knickt nicht über 30 Grad, auch nicht an einer S-förmigen Kurve", () => {
        // Befund 2026-10-11, nur lesend am Satz 179380: tangential verlängert knickten drei Läufe mit 34 bis 38 Grad gegen ihre
        // neue Sehne (Raschtulsturm z3 38,1). Verlängert wird deshalb entlang der Sehne: Sie dreht sich nicht, und die
        // angesetzten Stücke liegen auf ihr.
        const sKurve: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 10 * Math.tan(Math.PI / 6) },
            { x: 20, y: 0 },
            { x: 30, y: 0 },
        ];
        expect(maxDeviationAngle(sKurve)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
        const lauf = ausweichLauf(sKurve, 100);
        expect(pathLength(lauf)).toBeGreaterThanOrEqual(100);
        expect(lauf.slice(1, -1), "die Kurve selbst bleibt koordinatengleich").toEqual(sKurve);
        expect(maxDeviationAngle(lauf)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
    });

    it("🔴 knickt der verlängerte Lauf, wo der Name steht, zu stark für MapLibre, wird er gerade", () => {
        // Befund 2026-10-11 (Nauriti z3): Der Kern ist ein Drittel des Namens und biegt ±28 Grad; mit den geraden Stücken davor
        // und dahinter dreht die Linie unter dem Namen über 45 Grad, und MapLibre verwirft ihn still (`text-max-angle`).
        const knick: Point[] = [
            { x: 0, y: 0 },
            { x: 5, y: 5 * Math.tan(Math.PI / 6) },
            { x: 10, y: 0 },
        ];
        const angleWindow = 6;
        const passt = (punkte: Point[]): boolean =>
            labelFitsAngle(punkte, 30, angleWindow, Math.PI / 4, Number.POSITIVE_INFINITY);
        expect(passt(ausweichLauf(knick, 30)), "mit der Kurve im Kern verwürfe MapLibre den Namen").toBe(false);
        const lauf = ausweichLauf(knick, 30, passt);
        expect(passt(lauf)).toBe(true);
        expect(pathLength(lauf)).toBeCloseTo(30 * (1.05 + 2 * AUSWEICHRAUM), 9);
        expect(lauf, "gerade: Enden der Kurve, verlängert entlang ihrer Sehne").toHaveLength(4);
        expect(kurvenstueck(lauf, 1), "das Kurvenstück ist dann die Sehne").toEqual([knick[0], knick[2]]);
        expect(
            ausweichLauf(knick, 30, () => true),
            "was MapLibre setzt, behält seine Kurve",
        ).toEqual(ausweichLauf(knick, 30));
    });

    it("🔴 jeder Einzellauf trägt den Ausweichraum: ein Viertel der Namenslänge an beiden Enden, entlang der Sehne", () => {
        // Betreiber 2026-10-11: „A, überlappungen sind einfach scheisse. kannst du nicht versuchen etwas auszuweichen, wenn du schon
        // längere läufe baust?“ Die Kachel schneidet daraus bis zu fünf Kandidaten (Migration 0110, Muster 0030 der Wegnamen); dafür
        // braucht der Lauf ¼ Namenslänge Platz vor und hinter dem Kern. Der Kern, auf dem der Name bisher stand, bleibt die Mitte.
        const kurve: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 4 },
            { x: 20, y: 0 },
        ];
        const lauf = ausweichLauf(kurve, 20);
        expect(lauf.slice(1, -1), "der Kern bleibt koordinatengleich").toEqual(kurve);
        expect(pathLength(lauf)).toBeCloseTo(pathLength(kurve) + 2 * AUSWEICHRAUM * 20, 9);
        const [a, b] = [lauf[0] as Point, lauf[1] as Point];
        const [y, z] = [lauf[lauf.length - 2] as Point, lauf[lauf.length - 1] as Point];
        expect(Math.hypot(b.x - a.x, b.y - a.y), "vorn ein Viertel").toBeCloseTo(AUSWEICHRAUM * 20, 9);
        expect(Math.hypot(z.x - y.x, z.y - y.y), "hinten ein Viertel").toBeCloseTo(AUSWEICHRAUM * 20, 9);
        expect(maxDeviationAngle(lauf), "die Stücke liegen auf der Sehne").toBeLessThanOrEqual(
            maxDeviationAngle(kurve) + 1e-9,
        );
    });

    it("🔴 der Ausweichraum hat dieselbe harte Grenze wie bei den Wegnamen", () => {
        // Mehr als ¼ je Richtung hieße: Zwei Kandidaten überdecken sich bei z + 0,99 nicht mehr, und derselbe Name stünde zweimal.
        expect(AUSWEICHRAUM).toBe(SLIDE_SHARE);
    });

    it("🔴 das Kurvenstück eines Einzellaufs ist der Lauf ohne seine zwei angesetzten Stücke; ein Satz mit mehreren hat keine", () => {
        // I5 misst, ob die KURVE in ihrer Fläche liegt. Die angesetzten Stücke tragen den Namen, wo die Fläche zu klein ist, und
        // den Ausweichraum; beide liegen auf der Sehne, oft draußen (Efferdstränen z3: Name 46 Einheiten, Fläche 18 breit).
        const kurve: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 4 },
            { x: 20, y: 0 },
        ];
        expect(kurvenstueck(ausweichLauf(kurve, 100), 1), "zu kurz, verlängert").toEqual(kurve);
        expect(kurvenstueck(ausweichLauf(kurve, 20), 1), "lang genug, nur Ausweichraum").toEqual(kurve);
        expect(kurvenstueck(kurve, 2), "ein Satz mit mehreren Instanzen weicht nicht aus").toEqual(kurve);
    });

    it("🔴 placeRuns gibt jedem Einzellauf auf jeder Stufe den Ausweichraum", () => {
        const runs = placeRuns(curve, placement);
        for (const run of runs.filter((eintrag) => eintrag.instanceCount === 1)) {
            const needed = nameWidthPixels * mapUnitsPerPixel(run.runMinZoom);
            expect(pathLength(run.points), `z${String(run.runMinZoom)}`).toBeGreaterThanOrEqual(
                needed * (1 + 2 * AUSWEICHRAUM) * (1 - 1e-9),
            );
        }
    });

    it("jede Stufe des Bandes hat ihren eigenen Lauf, lückenlos", () => {
        const runs = placeRuns(curve, placement);
        for (const run of runs) {
            expect(run.runMaxZoom).toBe(run.runMinZoom);
        }
        const zooms = runs.map((run) => run.runMinZoom).sort((a, b) => a - b);
        expect(zooms).toEqual([3, 4, 5, 6, 7, 8]);
    });

    it("mehrere Instanzen: je Stufe genau ein Satz, vollzählig", () => {
        const long = resample(
            [
                { x: 0, y: 0 },
                { x: 400, y: 0 },
            ],
            120,
        );
        const runs = placeRuns(long, {
            nameWidthPixels: 200,
            gapPixels: 36,
            lowest: 3,
            highest: 8,
            wanted: 3,
            labelSize: 18,
        });
        for (let zoom = 3; zoom <= 8; zoom += 1) {
            const here = runs.filter((run) => run.runMinZoom === zoom);
            const counts = new Set(here.map((run) => run.instanceCount));
            expect(counts.size, `z${String(zoom)}: ein Satz`).toBe(1);
            expect(here).toHaveLength([...counts][0] as number);
        }
    });
});
