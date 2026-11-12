import { describe, expect, it } from "vitest";
import { HINWEIS_MIN_BREITE, HINWEIS_RAND, hinweisPlatz } from "../src/controls/kamera-hinweis-platz.ts";

describe("🔴 der Kamera-Hinweis steht ganz in der freien Fläche (Editor-Orchestrierung 2026-10-19)", () => {
    it("oben rechts in der freien Fläche, mit Rand, so breit wie sie es zulässt", () => {
        // 1280 px, Planer links 350 px, Fenster rechts ab 720 px: frei 350 bis 720, die Karte unter einer Kopfleiste von 56 px.
        const platz = hinweisPlatz({ left: 350, top: 0, width: 370, height: 744 }, { left: 0, top: 56 }, 1280);
        expect(platz).toEqual({
            top: 56 + HINWEIS_RAND,
            right: 1280 - 720 + HINWEIS_RAND,
            maxWidth: 370 - 2 * HINWEIS_RAND,
        });
    });

    it("ohne Lücke oder zu schmal: kein Platz, der Hinweis wartet", () => {
        expect(hinweisPlatz(undefined, { left: 0, top: 0 }, 1280)).toBeNull();
        expect(
            hinweisPlatz(
                { left: 350, top: 0, width: HINWEIS_MIN_BREITE + 2 * HINWEIS_RAND - 1, height: 600 },
                { left: 0, top: 0 },
                1280,
            ),
        ).toBeNull();
        expect(
            hinweisPlatz(
                { left: 350, top: 0, width: HINWEIS_MIN_BREITE + 2 * HINWEIS_RAND, height: 600 },
                { left: 0, top: 0 },
                1280,
            ),
        ).not.toBeNull();
    });
});
