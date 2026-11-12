import { describe, expect, it } from "vitest";
import type { EditorPathFlussnetz } from "@avesmaps3d/shared";
import {
    nummernBereiche,
    richtungsUebernahme,
    richtungsZustand,
    type FlussnetzLage,
} from "../src/wegeditor/weg-fliessrichtung";

/**
 * „Fließrichtung auf alle Abschnitte übernehmen“ im Wege-Fenster (OPS-000112): wann der Knopf geht und was er meldet; der Zustand bei (W).
 * Der Fluss: A → B, an B gabelt er sich in C und D (D andersherum gezeichnet), E liegt hinter einer Lücke.
 */
const NETZ: EditorPathFlussnetz = {
    abschnitte: [
        { id: "a", knoten: ["k0", "k1"], laengen: [2] },
        { id: "b", knoten: ["k1", "k2"], laengen: [2] },
        { id: "c", knoten: ["k2", "k3"], laengen: [2] },
        { id: "d", knoten: ["k4", "k2"], laengen: [2] },
        { id: "e", knoten: ["k8", "k9"], laengen: [2] },
    ],
};
const DA: FlussnetzLage = { art: "da", netz: NETZ };
const SEGMENTE = NETZ.abschnitte.map((a) => ({ id: a.id }));

describe("Fließrichtung übernehmen im Wege-Fenster (OPS-000112)", () => {
    it("🔴 wie heute bei (W) kopiert: D fließt falsch; übernommen von A dreht D, setzt das offene C und nennt E", () => {
        const kopiert = { a: "forward", b: "forward", c: null, d: "forward", e: "forward" } as const;
        const u = richtungsUebernahme(DA, ["a"], kopiert, false);
        expect(u).toEqual({
            art: "geht",
            richtung: { a: "forward", b: "forward", c: "forward", d: "reverse" },
            geaendert: ["d", "c"],
            gedreht: ["d"],
            neuGesetzt: ["c"],
            erreicht: 3,
            unterbrochen: ["e"],
            gabelung: [],
        });
    });

    it("gesperrt mit Grund: nicht genau einer, ohne Richtung, Kurve im Entwurf, Netz lädt oder fehlt, Abschnitt noch kein gespeicherter Fluss, nichts zu tun", () => {
        const stimmig = { a: "forward", b: "forward", c: "forward", d: "reverse", e: "forward" } as const;
        expect(richtungsUebernahme(DA, ["a", "b"], stimmig, false).art).toBe("einer");
        expect(richtungsUebernahme(DA, ["c"], { ...stimmig, c: null }, false).art).toBe("ohne");
        expect(richtungsUebernahme(DA, ["a"], { ...stimmig, d: "forward" }, true).art).toBe("form");
        expect(richtungsUebernahme({ art: "laedt" }, ["a"], stimmig, false).art).toBe("laedt");
        expect(richtungsUebernahme({ art: "fehler" }, ["a"], stimmig, false).art).toBe("fehler");
        expect(richtungsUebernahme({ art: "keins" }, ["a"], stimmig, false).art).toBe("neu");
        expect(richtungsUebernahme(DA, ["x"], { ...stimmig, x: "forward" }, false).art).toBe("neu");
        expect(richtungsUebernahme(DA, ["a"], stimmig, false).art).toBe("schon");
    });

    it("(W) zeigt den Zustand des Flusses: gegeneinander, sonst offen, sonst durchgehend", () => {
        expect(
            richtungsZustand(NETZ, SEGMENTE, { a: "forward", b: "reverse", c: "forward", d: "reverse", e: "forward" }),
        ).toEqual({
            art: "gegeneinander",
            paare: [["a", "b"]],
        });
        expect(
            richtungsZustand(NETZ, SEGMENTE, { a: "forward", b: "forward", c: "forward", d: "reverse", e: null }),
        ).toEqual({
            art: "offen",
            ids: ["e"],
        });
        expect(
            richtungsZustand(NETZ, SEGMENTE, { a: "forward", b: "forward", c: "forward", d: "reverse", e: "reverse" }),
        ).toEqual({
            art: "durchgehend",
        });
    });

    it("Nummern als Bereiche: drei und mehr in Folge werden einer", () => {
        const alle = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));
        expect(nummernBereiche(alle, ["h", "b", "c", "d", "f"])).toEqual([[2, 4], [6], [8]]);
        expect(nummernBereiche(alle, ["a", "b"])).toEqual([[1], [2]]);
        expect(nummernBereiche(alle, ["x"])).toEqual([]);
    });
});
