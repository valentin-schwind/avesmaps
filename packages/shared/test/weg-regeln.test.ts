import { describe, expect, it } from "vitest";
import { amOrt, aufeinander, endenAufeinander, ORT_NAEHE, punktSchluessel, selberNodix } from "../src/index.ts";

/**
 * Die Regeln an Wegen und Kraftlinien (`weg-regeln.ts`), die Editor und Server seit 2026-11-10 gemeinsam haben. Problemfälle: Editor und
 * Server runden verschieden und sind sich über „aufeinander“ uneins; die Grenze „am Ort“ ist auf einer Seite offen, auf der anderen
 * geschlossen; der Schlüssel weicht von dem der Wegfindung ab.
 */

describe("Regeln an Wegen und Kraftlinien", () => {
    it("🔴 aufeinander heißt: auf fünf Nachkommastellen gleich, wie der Schlüssel der Wegfindung", () => {
        expect(punktSchluessel(1.234561, 2)).toBe("1.23456:2.00000");
        expect(aufeinander({ x: 1.234561, y: 2 }, { x: 1.234559, y: 2 })).toBe(true);
        expect(aufeinander({ x: 1.23456, y: 2 }, { x: 1.23457, y: 2 })).toBe(false);
    });

    it("🔴 Anfang und Ende eines Wegs: nur wenn beide da sind und aufeinanderliegen", () => {
        expect(endenAufeinander([{ x: 1, y: 1 }])).toBe(false);
        expect(
            endenAufeinander([
                { x: 1, y: 1 },
                { x: 2, y: 2 },
                { x: 1, y: 1 },
            ]),
        ).toBe(true);
        expect(
            endenAufeinander([
                { x: 1, y: 1 },
                { x: 2, y: 2 },
            ]),
        ).toBe(false);
    });

    it("🔴 am Ort: näher als die Grenze je Achse, die Grenze selbst nicht mehr", () => {
        const ort = { x: 10, y: 10 };
        expect(amOrt({ x: 10 + ORT_NAEHE / 2, y: 10 }, [ort])).toBe(true);
        expect(amOrt({ x: 10 + ORT_NAEHE * 2, y: 10 }, [ort])).toBe(false);
    });

    it("🔴 ein Kraftlinienabschnitt endet nie am selben Nodix", () => {
        expect(selberNodix("a", "a")).toBe(true);
        expect(selberNodix("a", "b")).toBe(false);
    });
});
