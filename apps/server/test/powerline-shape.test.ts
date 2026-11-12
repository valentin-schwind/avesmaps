import { describe, expect, it } from "vitest";
import { POWERLINE_VIA_LIMIT } from "@avesmaps3d/shared";
import { powerlineShape, type LineSegment, type NamedNode } from "../src/subjects/powerline-shape.ts";

/**
 * Die Gestalt einer Kraftlinie (WI-0063 P7, Legacy `js/map-features/powerline-topology.js` und `powerlineInfoboxMarkup`): „Verbindet“,
 * „Verläuft über“ und „Abschnitte“ aus den Verweisen der Segmente auf ihre Knoten. Reine Rechnung; Orte sind benannt, ein Nodix, ein
 * Label oder ein verborgener Ort nicht.
 */

const node = (id: string, name: string, x: number, y = 0): [string, NamedNode] => [id, { id, name, x, y }];
const world = (...entries: [string, NamedNode][]): Map<string, NamedNode> => new Map(entries);
const edge = (from: string, to: string): LineSegment => ({ from, to });
const nameOf = (links: readonly { name: string }[] | undefined): string[] => (links ?? []).map((link) => link.name);

describe("Gestalt einer Kraftlinie", () => {
    it("ein Strang: die zwei äußeren Orte von West nach Ost, dazwischen die Stationen in der Folge der Linie", () => {
        const shape = powerlineShape(
            // Die Segmente stehen in beliebiger Reihenfolge, die Linie läuft Ost - Mitte - Süd - West.
            [edge("ost", "mitte"), edge("sued", "west"), edge("mitte", "sued")],
            world(
                node("west", "Westburg", 10),
                node("sued", "Südfurt", 20),
                node("mitte", "Mittenau", 30),
                node("ost", "Ostheim", 40),
            ),
        );
        expect(nameOf(shape?.ends)).toEqual(["Westburg", "Ostheim"]);
        expect(nameOf(shape?.via)).toEqual(["Südfurt", "Mittenau"]);
        expect(shape?.segments).toBe(3);
        expect(shape?.ring).toBeUndefined();
        expect(shape?.viaMore).toBeUndefined();
        expect(shape?.ends?.[0]?.ref).toEqual({ kind: "place", id: "west" });
    });

    it("ein Ende ohne Namen (ein Nodix) wird übersprungen: Es geht nach innen bis zum ersten Ort", () => {
        const shape = powerlineShape(
            [edge("nodix", "a"), edge("a", "b"), edge("b", "c")],
            world(node("a", "A", 1), node("b", "B", 2), node("c", "C", 3)),
        );
        expect(nameOf(shape?.ends)).toEqual(["A", "C"]);
        expect(nameOf(shape?.via)).toEqual(["B"]);
    });

    it("ein Ring hat keine Enden und sagt es: Alle Orte stehen unter „Verläuft über“", () => {
        const shape = powerlineShape(
            [edge("a", "b"), edge("b", "c"), edge("c", "a")],
            world(node("a", "A", 1), node("b", "B", 2), node("c", "C", 3)),
        );
        expect(shape?.ends).toBeUndefined();
        expect(nameOf(shape?.via).sort()).toEqual(["A", "B", "C"]);
        expect(shape?.ring).toBe(true);
        expect(shape?.segments).toBe(3);
    });

    it("eine Verzweigung zählt alle äußeren Enden, nicht nur zwei", () => {
        const shape = powerlineShape(
            [edge("m", "w"), edge("m", "o"), edge("m", "n")],
            world(node("m", "Mitte", 2), node("w", "West", 1), node("o", "Ost", 3), node("n", "Nord", 2, 5)),
        );
        expect(nameOf(shape?.ends)).toEqual(["West", "Nord", "Ost"]);
        expect(nameOf(shape?.via)).toEqual(["Mitte"]);
    });

    it("mehr als zwölf Stationen kürzt „Verläuft über“ und sagt, dass es mehr gibt", () => {
        const count = POWERLINE_VIA_LIMIT + 3;
        const ids = Array.from({ length: count + 2 }, (_, at) => `n${String(at)}`);
        const segments = ids.slice(1).map((id, at) => edge(ids[at] as string, id));
        const shape = powerlineShape(segments, world(...ids.map((id, at) => node(id, `Ort ${String(at)}`, at))));
        expect(shape?.via).toHaveLength(POWERLINE_VIA_LIMIT);
        expect(shape?.viaMore).toBe(true);
        expect(nameOf(shape?.via)[0]).toBe("Ort 1");
    });

    it("ein einzelnes Segment zwischen zwei Orten: nur „Verbindet“, keine Zahl der Abschnitte", () => {
        const shape = powerlineShape([edge("a", "b")], world(node("a", "A", 1), node("b", "B", 2)));
        expect(nameOf(shape?.ends)).toEqual(["A", "B"]);
        expect(shape?.via).toBeUndefined();
        expect(shape?.segments).toBeUndefined();
    });

    it("🔴 ohne einen einzigen Namen und mit einem Segment gibt es nichts zu sagen; mit mehreren trägt die Zahl", () => {
        expect(powerlineShape([edge("x", "y")], world())).toBeUndefined();
        expect(powerlineShape([], world())).toBeUndefined();
        expect(powerlineShape([edge("x", "y"), edge("y", "z")], world())).toEqual({ segments: 2 });
    });

    it("ein Segment ohne Knoten zählt für die Zahl, nicht für die Gestalt", () => {
        const shape = powerlineShape([edge("", "b"), edge("a", "b")], world(node("a", "A", 1), node("b", "B", 2)));
        expect(shape?.segments).toBe(2);
        expect(nameOf(shape?.ends)).toEqual(["A", "B"]);
    });
});
