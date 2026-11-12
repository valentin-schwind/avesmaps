import { describe, expect, it } from "vitest";
import {
    chainSegments,
    orderRoutePlaces,
    orderSegments,
    wholeStretch,
    type EndPlace,
    type RouteSegment,
} from "../src/subjects/path-route.ts";

/**
 * „Weg als Route“ und „Ganze Straße“ (WI-0063 P7, Legacy `js/routing/weg-als-route.js` und `wpGanzeStrecke`): die reine Rechnung ohne
 * Datenbank. Die ersten Fälle sind die Vektoren aus Legacys eigenem Test (`js/routing/__tests__/weg-als-route.test.js`, Mirror
 * `b9657635a`): ein gedrehter Abschnitt, die Lücke zum nächsten Ende, Kreuzung, Wegende und Verborgenes.
 */

type Point = [number, number];

/** Ein Ort an einem Wegende: Kennung = Name klein, damit „derselbe Ort“ an zwei Stellen derselbe ist. */
const place = (name: string, at: Point, hidden = false): EndPlace => ({
    id: name.toLowerCase(),
    name,
    subtype: "dorf",
    x: at[0],
    y: at[1],
    hidden,
});

let counter = 0;
/** Ein Abschnitt von `from` nach `to`; ein Ende ohne Namen hat keinen Ort (Kreuzung oder offenes Ende). */
function seg(
    from: Point,
    to: Point,
    fromName: string | null,
    toName: string | null,
    hiddenNames: string[] = [],
): RouteSegment {
    counter += 1;
    return {
        id: `s${String(counter).padStart(3, "0")}`,
        from,
        to,
        fromPlace: fromName === null ? null : place(fromName, from, hiddenNames.includes(fromName)),
        toPlace: toName === null ? null : place(toName, to, hiddenNames.includes(toName)),
        minX: Math.min(from[0], to[0]),
        minY: Math.min(from[1], to[1]),
    };
}

const names = (segments: RouteSegment[]): string[] => orderRoutePlaces(segments).map((entry) => entry.name);

describe("Weg als Route: die Orte in Reihenfolge (Legacy-Vektoren)", () => {
    it("ein gedrehter Abschnitt läuft rückwärts mit", () => {
        expect(
            names([
                seg([0, 0], [1, 0], "Perz", "Silkwiesen"),
                seg([2, 0], [1, 0], "Wieha", "Silkwiesen"),
                seg([2, 0], [3, 0], "Wieha", "Helmdahl"),
            ]),
        ).toEqual(["Perz", "Silkwiesen", "Wieha", "Helmdahl"]);
    });

    it("über die Lücke zum nächsten Ende, das Stück dafür umgedreht", () => {
        expect(
            names([
                seg([0, 0], [1, 0], "Perz", "Silkwiesen"),
                seg([1, 0], [2, 0], "Silkwiesen", "Wieha"),
                seg([10, 0], [3, 0], "Ferne", "Helmdahl"),
            ]),
        ).toEqual(["Perz", "Silkwiesen", "Wieha", "Helmdahl", "Ferne"]);
    });

    it("Kreuzung, offenes Wegende und verborgene Orte fallen weg, und Dopplungen hintereinander auch", () => {
        expect(
            names([
                seg([0, 0], [1, 0], "Perz", null),
                seg([1, 0], [2, 0], null, "Versteck", ["Versteck"]),
                seg([2, 0], [3, 0], "Versteck", "Perz", ["Versteck"]),
                seg([3, 0], [4, 0], "Perz", null),
            ]),
        ).toEqual(["Perz"]);
    });

    it("keine Abschnitte, keine Orte", () => {
        expect(orderRoutePlaces([])).toEqual([]);
        expect(names([seg([0, 0], [1, 0], null, null)])).toEqual([]);
    });
});

describe("Weg als Route: Ketten, Verzweigungen und die Reihenfolge der Abschnitte", () => {
    it("die Reihenfolge der Eingabe ändert nichts: Die Abschnitte sind geographisch geordnet (Hüllbox, dann Kennung)", () => {
        const a = seg([0, 0], [1, 0], "A", "B");
        const b = seg([1, 0], [2, 0], "B", "C");
        const c = seg([2, 0], [3, 0], "C", "D");
        expect(names([c, a, b])).toEqual(["A", "B", "C", "D"]);
        expect(names([b, c, a])).toEqual(["A", "B", "C", "D"]);
        expect(orderSegments([c, b, a]).map((entry) => entry.id)).toEqual([a.id, b.id, c.id]);
    });

    it("die Hüllbox zählt auf zwei Stellen gerundet: Rauschen kippt keinen Gleichstand (die Kennung entscheidet)", () => {
        const left = { ...seg([0, 0], [1, 0], "A", "B"), id: "b", minX: 5.0001 };
        const right = { ...seg([1, 0], [2, 0], "B", "C"), id: "a", minX: 5.0049 };
        expect(orderSegments([left, right]).map((entry) => entry.id)).toEqual(["a", "b"]);
    });

    it("an einer Verzweigung (drei Kanten) schließt die Kette: kein Arm ist „der richtige“", () => {
        // Ein Stern um den Knoten (5, 5): drei Arme von einem Abschnitt, die längste Kette ist ein Arm, nicht zwei.
        const chains = chainSegments(
            orderSegments([
                seg([5, 5], [0, 5], "Mitte", "West"),
                seg([5, 5], [10, 5], "Mitte", "Ost"),
                seg([5, 5], [5, 10], "Mitte", "Nord"),
            ]),
        );
        expect(chains.map((chain) => chain.length)).toEqual([1, 1, 1]);
    });

    it("Enden unter einer Tausendstel liegen im selben Knoten", () => {
        expect(names([seg([0, 0], [1, 0], "A", "B"), seg([1.0005, 0], [2, 0], "B", "C")])).toEqual(["A", "B", "C"]);
    });

    it("ein Ring ohne Ende fängt am ersten Abschnitt an und endet, wo er begann", () => {
        const sequence = names([
            seg([0, 0], [1, 0], "A", "B"),
            seg([1, 0], [1, 1], "B", "C"),
            seg([1, 1], [0, 1], "C", "D"),
            seg([0, 1], [0, 0], "D", "A"),
        ]);
        expect(sequence[0]).toBe("A");
        expect(new Set(sequence)).toEqual(new Set(["A", "B", "C", "D"]));
    });

    it("ein Ort ist an seiner Kennung erkannt und trägt seine eigene Lage, nicht die des Wegendes", () => {
        const first = seg([0, 0], [1, 0], "A", "B");
        const second = seg([1, 0], [2, 0], "B", "C");
        const result = orderRoutePlaces([first, second]);
        expect(result.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
        // Die Koordinate ist die des Ortes, nicht die des Wegendes.
        expect(result[0]).toMatchObject({ x: 0, y: 0, subtype: "dorf" });
    });
});

describe("Ganze Straße: von - bis (Legacy wpGanzeStrecke)", () => {
    it("die zwei äußeren Orte, der westlichere vorn", () => {
        expect(wholeStretch([seg([2, 0], [1, 0], "Helmdahl", "Wieha"), seg([1, 0], [0, 0], "Wieha", "Perz")])).toEqual({
            from: "Perz",
            to: "Helmdahl",
        });
    });

    it("unter mehreren offenen Enden gewinnt das Paar mit der größten Luftlinie; zwei Enden gleichen Namens sind kein Paar", () => {
        // Die zwei „A“ liegen am weitesten auseinander (50), sind aber kein Paar: Es gewinnt Fern - A(50, 0) mit rund 49,8.
        expect(
            wholeStretch([
                seg([0, 0], [1, 0], "A", "Mitte"),
                seg([1, 0], [2, 0], "Mitte", "B"),
                seg([1, 0], [1, 9], "Mitte", "Fern"),
                seg([1, 0], [50, 0], "Mitte", "A"),
            ]),
        ).toEqual({ from: "Fern", to: "A" });
    });

    it("ein verborgener Ort nennt kein Ende, und bei weniger als zwei Orten steht nichts", () => {
        expect(wholeStretch([seg([0, 0], [1, 0], "A", "Geheim", ["Geheim"])])).toBeUndefined();
        expect(wholeStretch([seg([0, 0], [1, 0], null, null)])).toBeUndefined();
        expect(wholeStretch([])).toBeUndefined();
    });
});
