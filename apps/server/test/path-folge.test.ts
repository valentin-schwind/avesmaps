import { describe, expect, it } from "vitest";
import { folgeEntlang, type AbschnittMitEnden } from "../src/editor/path-list.ts";

/**
 * Die Folge der Abschnitte einer Straße (EDIT-0003 T49, „n · Von – Bis“ im Menü am Weg). Problemfälle: Die Abschnitte stehen nach ihrer
 * Kennung statt entlang der Straße; ein Abschnitt läuft gegen die Folge und nennt Von und Bis vertauscht; zwei Abschnitte am selben Ort,
 * deren Enden nicht genau aufeinander liegen, gelten als Lücke; eine Lücke verliert die Stücke dahinter.
 */

const ende = (x: number, y: number, ort?: string) => ({ x, y, ...(ort ? { ort: { id: ort, name: ort } } : {}) });
const abschnitt = (
    id: string,
    anfang: ReturnType<typeof ende>,
    schluss: ReturnType<typeof ende>,
): AbschnittMitEnden => ({
    id,
    anfang,
    ende: schluss,
});

describe("Folge der Abschnitte entlang der Straße", () => {
    it("🔴 beginnt am westlichen freien Ende und läuft von Knoten zu Knoten, egal in welcher Folge und Richtung gespeichert", () => {
        const folge = folgeEntlang([
            abschnitt("c", ende(30, 0, "Gareth"), ende(20, 0, "Wehrheim")),
            abschnitt("a", ende(0, 0), ende(10, 0, "Rommilys")),
            abschnitt("b", ende(10, 0, "Rommilys"), ende(20, 0, "Wehrheim")),
        ]);
        expect(folge).toEqual([
            { id: "a", umgekehrt: false },
            { id: "b", umgekehrt: false },
            { id: "c", umgekehrt: true },
        ]);
    });

    it("🔴 zwei Enden am selben Ort sind ein Knoten, auch wenn sie nicht genau aufeinander liegen", () => {
        const folge = folgeEntlang([
            abschnitt("b", ende(10.3, 0.2, "Rommilys"), ende(20, 0)),
            abschnitt("a", ende(0, 0), ende(9.8, -0.1, "Rommilys")),
        ]);
        expect(folge.map((f) => f.id)).toEqual(["a", "b"]);
    });

    it("eine Lücke: weiter am nächsten westlichen freien Ende, nichts geht verloren", () => {
        const folge = folgeEntlang([
            abschnitt("d", ende(50, 0), ende(60, 0)),
            abschnitt("a", ende(0, 0), ende(10, 0)),
            abschnitt("b", ende(10, 0), ende(20, 0)),
        ]);
        expect(folge.map((f) => f.id)).toEqual(["a", "b", "d"]);
    });

    it("ein Ring beginnt am westlichsten Punkt und nimmt jeden Abschnitt einmal", () => {
        const folge = folgeEntlang([
            abschnitt("a", ende(0, 0), ende(10, 10)),
            abschnitt("b", ende(10, 10), ende(20, 0)),
            abschnitt("c", ende(20, 0), ende(0, 0)),
        ]);
        expect(folge.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
        expect(folge).toHaveLength(3);
    });
});
