import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    baueRaster,
    buildMountainRaster,
    drueckeSenken,
    rechneRueckennetz,
    talBoden,
    TAL_GEWICHT,
    type NetzLinie,
    type V12Input,
} from "@avesmaps3d/shared";

/**
 * Täler und Mulden im Rückennetz (Betreiber 2026-10-21 über die Hauptorchestrierung: „das gegenteil "tal" … diesselbe gewichtung wie
 * nebenkämme - nur nach unten“, „den "gegengipfel" ein punkt, der eine mulde (krater) macht“). Ohne beide rechnet das Modell wie zuvor;
 * das sichern die Prüfsummen in `gebirge-rueckennetz.test.ts`.
 */

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input };

const flaeche = () => baueRaster({ min_x: 0, min_y: 0, max_x: 20, max_y: 20 }, 0.25, () => true);
const form = { breite: 1.4, schaerfe: 0.7 };

describe("Rückennetz: Täler und Mulden", () => {
    it("lässt die Form ohne Täler und Mulden unberührt", () => {
        const r = flaeche();
        const h = new Float64Array(r.w * r.hh).fill(1500);
        const gewollt = drueckeSenken(r, h, [], [], form, 2000, 0.5, 1);
        expect(h.every((v) => v === 1500)).toBe(true);
        expect(gewollt.every((v) => v === 0)).toBe(true);
    });

    it("drückt ein Tal mit dem Gewicht eines Nebenkamms auf den Talboden, nicht darunter, und nur in seiner Nähe", () => {
        const r = flaeche();
        const h = new Float64Array(r.w * r.hh).fill(1500);
        const gewollt = drueckeSenken(
            r,
            h,
            [
                {
                    punkte: [
                        [2, 10],
                        [18, 10],
                    ],
                },
            ],
            [],
            form,
            2000,
            0.5,
            1,
        );
        const at = (x: number, y: number) => h[r.j(y) * r.w + r.i(x)]!;
        const boden = talBoden(2000, 0.5);
        expect(boden).toBeGreaterThan(0);
        expect(boden).toBeLessThan(1000);
        expect(at(10, 10)).toBeCloseTo(1500 - TAL_GEWICHT * (1500 - boden), 0);
        expect(Math.min(...h)).toBeGreaterThanOrEqual(boden);
        expect(at(10, 18)).toBe(1500);
        // Das freie Ende läuft aus: am Ende kaum gedrückt.
        expect(at(2, 10)).toBeGreaterThan(at(10, 10) + 400);
        expect(gewollt[r.j(10) * r.w + r.i(10)]).toBe(1);
    });

    it("macht um eine Mulde eine Schüssel auf ihren Boden", () => {
        const r = flaeche();
        const h = new Float64Array(r.w * r.hh).fill(1500);
        drueckeSenken(r, h, [], [{ x: 10, y: 10, h: 900 }], form, 2000, 0.5, 1);
        const at = (x: number, y: number) => h[r.j(y) * r.w + r.i(x)]!;
        expect(at(10, 10)).toBe(900);
        expect(at(11.2, 10)).toBeGreaterThan(900);
        expect(at(11.2, 10)).toBeLessThan(1500);
        expect(at(13, 10)).toBe(1500);
    });

    it("schneidet ein gezeichnetes Tal quer durch den Hauptkamm der Blutzinnen, die Mulde bleibt auf ihrem Boden", () => {
        const input = blutzinnen.input;
        const kaemme = input.kaemme ?? [];
        expect(kaemme.length).toBeGreaterThan(0);
        // Quer über den Knoten der Blutzinnen-Kämme (453,4/682,3).
        const tal: NetzLinie = {
            rang: "tal",
            punkte: [
                [450, 682.5],
                [457, 682],
            ],
        };
        const ohne = rechneRueckennetz(input, "karst", { talbodenFest: 0.6 });
        const mit = rechneRueckennetz(input, "karst", {
            talbodenFest: 0.6,
            kaemme: [...kaemme, tal],
            mulden: [{ x: 449, y: 687.5, h: 500 }],
        });
        const at = (e: typeof ohne, x: number, y: number) =>
            e.h[Math.round((y - e.bounds.min_y) / e.cell) * e.w + Math.round((x - e.bounds.min_x) / e.cell)]!;
        expect(at(mit, 453.5, 682.3)).toBeLessThan(at(ohne, 453.5, 682.3) - 500);
        expect(Math.round(at(mit, 449, 687.5))).toBe(500);
        // Das Tal trägt kein Netz: Die Kanten bleiben die der Kämme.
        expect(mit.netz.kanten.filter((k) => k.quelle === "gezeichnet")).toHaveLength(kaemme.length);
    });

    it("rechnet ein Gebirge nur mit Mulden ebenfalls als Rückennetz", () => {
        const ohneKaemme: V12Input = { ...blutzinnen.input };
        delete ohneKaemme.kaemme;
        const v12 = buildMountainRaster({ ...ohneKaemme, zelle: 0.5 });
        const rn = buildMountainRaster({ ...ohneKaemme, zelle: 0.5, mulden: [{ x: 449, y: 687.5, h: null }] });
        expect(v12.talboden).toBeUndefined();
        expect(rn.talboden).toBeDefined();
    });
});
