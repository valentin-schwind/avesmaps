import { describe, expect, it } from "vitest";
import { gruppen, ohneSpalten, rasteEin, type Teilflaeche } from "../src/editor/flaechen-vereinigen.ts";
import { schluessel, type Punkt } from "../src/editor/ring-form.ts";

/**
 * Die Rechnung von „Flächen vereinigen ›“ ohne Datenbank (WI-0252). Problemfälle: Eine Gruppe zerfällt, weil die Glieder nur über ein
 * drittes zusammenhängen; eine Ecke, die ein Nachbar teilt, rastet ein und reißt die gemeinsame Kante auf; eine Ecke rastet über den
 * Fangradius hinaus; ein echtes Loch (ein See im Wald) verschwindet mit den Spalten.
 */

const teil = (id: string, ring: Punkt[], besitzer = id): Teilflaeche => ({
    id,
    besitzer,
    polygone: [[ring]],
    groesse: 1,
});

describe("Flächen vereinigen: Rechnung", () => {
    it("Gruppen hängen über Glieder zusammen; wer nichts berührt, steht allein", () => {
        const flaechen = ["a", "b", "c", "d"].map((id) => teil(id, []));
        const g = gruppen(flaechen, [
            ["a", "b"],
            ["c", "b"],
        ]).map((x) => x.map((f) => f.id).sort());
        expect(g.sort()).toEqual([["a", "b", "c"], ["d"]]);
    });

    it("🔴 Stoßpunkte rasten auf die schon aufgenommene Ecke ein, nur im Fangradius und nie an einer Ecke, die ein Nachbar teilt", () => {
        const traeger = teil("a", [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ]);
        const zweite = teil("b", [
            [10.01, 0],
            [20, 0],
            [20, 10],
            [10.01, 10],
            [10.5, 5],
        ]);
        const [a, b] = rasteEin([traeger, zweite], new Set([schluessel([10.01, 10])]), 0.02);
        expect(a).toEqual(traeger.polygone);
        expect(b![0]![0]).toEqual([
            [10, 0],
            [20, 0],
            [20, 10],
            [10.01, 10],
            [10.5, 5],
        ]);
    });

    it("🔴 ein schmaler Spalt schließt sich, ein echtes Loch bleibt", () => {
        const aussen: Punkt[] = [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
        ];
        const spalt: Punkt[] = [
            [10, 50],
            [90, 50],
            [90, 50.01],
            [10, 50.01],
        ];
        const see: Punkt[] = [
            [20, 20],
            [40, 20],
            [40, 40],
            [20, 40],
        ];
        expect(ohneSpalten([[aussen, spalt, see]], 0.02)).toEqual([[aussen, see]]);
    });
});
