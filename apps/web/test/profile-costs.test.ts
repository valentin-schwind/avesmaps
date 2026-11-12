import { afterEach, describe, expect, it } from "vitest";
import type { RouteSegment, RouteSlope } from "@avesmaps3d/shared";
import { locale, LOCALES, t } from "../src/i18n/i18n.ts";
import { combinedExtraHours, profileCosts, profileHeadline, snowShown } from "../src/route-planner/profile-costs.ts";
import { slopeText } from "../src/route-planner/stage-figures.ts";

/**
 * Was Steigung und Schnee im Höhenprofil kosten (WI-0065 Nachtrag 2026-10-04, Betreiber: „kann man hier auch listen, was
 * der tiefschnee kostet“). Die Stunden rechnet der Server (`route.snow`); hier steht nur, wie sie gesagt werden.
 */

afterEach(() => {
    locale.value = "de";
});

const tief = { extra_hours: 12.34, conditions: ["tiefschnee"] };

/** Ein Abschnitt mit seiner Reisezeit, der Mehrzeit der Steigung und der des Schnees (die Felder, die die Rechnung liest). */
const segment = (travelHours: number, slope?: number, snow?: number): RouteSegment =>
    ({
        travel_hours: travelHours,
        ...(slope === undefined ? {} : { slope: { extra_hours: slope } }),
        ...(snow === undefined ? {} : { snow: { condition: "tiefschnee", extra_hours: snow } }),
    }) as unknown as RouteSegment;

const steigung = (extraHours: number, steepest = 0.27): RouteSlope =>
    ({ steepest_grade: steepest, extra_hours: extraHours }) as unknown as RouteSlope;

describe("Mehrzeit aus Steigung und Schnee zusammen", () => {
    it("🔴 die Summe zählt doppelt: mit beidem minus ohne beides, s + n − s·n / T je Abschnitt", () => {
        // T = 10: Steigung kostet 2 (ohne sie 8), Schnee kostet 5 (ohne ihn 5); ohne beides 8 × 5 / 10 = 4; zusammen also 6.
        expect(combinedExtraHours([segment(10, 2, 5)])).toBeCloseTo(6, 10);
        // Nicht 7, die einfache Summe.
        expect(combinedExtraHours([segment(10, 2, 5)])).toBeLessThan(2 + 5);
    });

    it("Abschnitte mit nur einer Zahl zählen sie, ohne beide nichts, die Abschnitte addieren sich", () => {
        expect(combinedExtraHours([segment(10, 2)])).toBe(2);
        expect(combinedExtraHours([segment(10, undefined, 5)])).toBe(5);
        expect(combinedExtraHours([segment(10)])).toBe(0);
        expect(combinedExtraHours([])).toBe(0);
        expect(combinedExtraHours([segment(10, 2, 5), segment(10, 2), segment(10, undefined, 5)])).toBeCloseTo(13, 10);
        // Eine Reisezeit 0 teilt nicht durch null.
        expect(combinedExtraHours([segment(0, 1, 1)])).toBe(2);
    });
});

describe("Kurzangabe im Deckel „Höhenprofil“", () => {
    // Zusammen 55,5 Std.: 40,1 + 25,7 − 40,1 × 25,7 / 100 (ein Abschnitt von 100 Stunden).
    const both = [segment(100, 40.1, 25.7)];
    const snow = { extra_hours: 25.7, conditions: ["tiefschnee"] };

    it("🔴 +<Mehrzeit zusammen> Std. (bis <max> %, Schnee) - ohne das Wort „Steigung“ (Betreiber 2026-10-04, „B“), deutsch und englisch", () => {
        expect(profileHeadline(steigung(40.1), snow, both)).toBe("+55,5 Std. (bis 27 %, Schnee)");
        locale.value = "en";
        expect(profileHeadline(steigung(40.1), snow, both)).toBe("+55.5 h (up to 27 %, snow)");
    });

    it("ohne Schnee: nur die Steigung in der Klammer; nur Schnee: „(Schnee)“, auch unter der Schwelle der Steigung", () => {
        expect(profileHeadline(steigung(40.1), undefined, [segment(100, 40.1)])).toBe("+40,1 Std. (bis 27 %)");
        expect(profileHeadline(undefined, snow, [segment(100, undefined, 25.7)])).toBe("+25,7 Std. (Schnee)");
        expect(profileHeadline(steigung(0.01), snow, [segment(100, 0.01, 25.7)])).toMatch(/^\+25,\d Std\. \(Schnee\)$/);
    });

    it("🔴 ein Gefälle bleibt unterscheidbar: „↓“ wie im Satz darunter, nur dort, deutsch und englisch", () => {
        const down = "\u2193\uFE0E";
        expect(profileHeadline(steigung(3, -0.27), undefined, [segment(10, 3)])).toBe(`+3,0 Std. (bis 27 % ${down})`);
        expect(profileHeadline(steigung(3, -0.27), snow, [segment(10, 3, 5)])).toMatch(
            /^\+[\d,]+ Std\. \(bis 27 % \u2193\uFE0E, Schnee\)$/,
        );
        // Eine Steigung trägt keinen Pfeil.
        expect(profileHeadline(steigung(3, 0.27), undefined, [segment(10, 3)])).toBe("+3,0 Std. (bis 27 %)");
        locale.value = "en";
        expect(profileHeadline(steigung(3, -0.27), undefined, [segment(10, 3)])).toBe(`+3.0 h (up to 27 % ${down})`);
    });

    it("🔴 ohne Mehrzeit steht nur die steilste Stelle, ohne Steigung und Schnee nichts", () => {
        expect(profileHeadline(steigung(0.01, 0.03), undefined, [segment(10, 0.01)])).toBe("Max. 3 % Steigung");
        expect(profileHeadline(undefined, undefined, [])).toBe("");
        // Schnee unter drei Minuten zählt nicht als Schnee.
        expect(profileHeadline(undefined, { extra_hours: 0.01, conditions: ["eis"] }, [])).toBe("");
    });

    /**
     * 🔴 **Das Steigungswort steht MITTEN im Satz** (`stage-figures.ts`: „max. 7 % discesa, 0 ↑, 90 ↓ passi“) und
     * zugleich hinter dem Satzanfang eines Deckels. Groß geschrieben ist es an der ersten Stelle falsch - Deutsch
     * ausgenommen, das Substantive ohnehin groß schreibt.
     *
     * 💣 Italienisch und Niederländisch trugen „Discesa“ und „Daling“, und der italienische Deckel begann mit dem
     * Wort statt mit „Max.“ - deshalb genügt es nicht, die Wörter klein zu machen: Den Satzanfang trägt der Rahmen
     * (`planner.slope.summary.head`, `planner.profile.summary.max`), wie im Deutschen seit jeher.
     *
     * 🪤 Der Fall läuft über `LOCALES`: Eine siebte Tafel ist vom ersten Tag an mitgeprüft.
     */
    it("🔴 das Steigungswort ist außer im Deutschen kleingeschrieben", () => {
        for (const sprache of LOCALES.filter((eine) => eine !== "de")) {
            locale.value = sprache;
            for (const schluessel of ["planner.slope.word.up", "planner.slope.word.down"] as const) {
                const wort = t(schluessel);
                expect(wort, `${sprache} ${schluessel}`).toBe(wort.toLocaleLowerCase(sprache));
            }
        }
    });

    it("🔴 im Satz der Etappe steht es mitten drin, und zwar klein", () => {
        const stufe = { steepest_grade: -0.07, ascent_schritt: 0, descent_schritt: 90, extra_hours: 0 };
        locale.value = "it";
        expect(slopeText(stufe as never)).toMatch(/^max\. 7 % discesa, /);
        locale.value = "nl";
        expect(slopeText(stufe as never)).toMatch(/^max\. 7 % daling, /);
    });

    it("🔴 und der Deckel trägt den Satzanfang selbst", () => {
        expect(profileHeadline(steigung(0.01, -0.03), undefined, [segment(10, 0.01)])).toBe("Max. 3 % Gefälle");
        locale.value = "it";
        expect(profileHeadline(steigung(0.01, -0.03), undefined, [segment(10, 0.01)])).toBe("Max. 3 % di discesa");
        locale.value = "nl";
        expect(profileHeadline(steigung(0.01, -0.03), undefined, [segment(10, 0.01)])).toBe("Max. 3 % daling");
    });

    /**
     * 🔴 **Den Satzanfang trägt der RAHMEN**, und zwar in jeder Sprache. Der Fall darüber prüft das an drei
     * Beispielen; dieser misst es über `LOCALES`, denn der Fehler sieht in jeder Sprache anders aus:
     * Französisch stellte das Wort voran („descente max. : 27 %“) und begann damit klein, ohne dass ein
     * großgeschriebenes Wort es verdeckt hätte.
     *
     * 🪤 Gemessen wird der FERTIGE Satz, nicht die Vorlage: „{word} max. …“ fängt für `tsc` mit „{“ an, für den
     * Leser mit „d“.
     */
    it("🔴 beide Rahmen beginnen in jeder Sprache mit einem Großbuchstaben", () => {
        for (const sprache of LOCALES) {
            locale.value = sprache;
            const deckel = t("planner.slope.summary.head", { word: t("planner.slope.word.down"), grade: "27 %" });
            const profil = profileHeadline(steigung(0.01, -0.03), undefined, [segment(10, 0.01)]);
            for (const satz of [deckel, profil]) {
                const erster = [...satz][0] ?? "";
                expect(erster, `${sprache}: ${satz}`).toBe(erster.toLocaleUpperCase(sprache));
            }
        }
    });

    it("🔴 keine Anrede, in keiner Sprache", () => {
        const texts = [profileHeadline(steigung(40.1), snow, both)];
        locale.value = "en";
        texts.push(profileHeadline(steigung(40.1), snow, both));
        for (const text of texts) expect(text).not.toMatch(/\b(du|dein|Sie|Ihr|you|your)\b/i);
    });
});

describe("Satz unter der Steigung", () => {
    it("🔴 Steigung und Schnee in einem Satz, die Zustände in Klammern mit den Namen der Bodentafel", () => {
        expect(profileCosts(40.1, tief)).toBe(
            "Die Steigung kostet 40,1 Stunden, der Schnee 12,3 Stunden (Tiefschnee).",
        );
        locale.value = "en";
        expect(profileCosts(40.1, tief)).toBe("The slopes cost 40.1 hours, snow 12.3 hours (deep snow).");
    });

    it("mehrere Zustände in der Folge der Reise; Eis gehört dazu", () => {
        const reise = { extra_hours: 7, conditions: ["schnee_leicht", "tiefschnee", "eis"] };
        expect(profileCosts(1, reise)).toBe(
            "Die Steigung kostet 1,0 Stunden, der Schnee 7,0 Stunden (leichter Schnee, Tiefschnee, Eis).",
        );
    });

    it("ohne Steigungszeit oder ohne Steigung steht der Schnee allein", () => {
        expect(profileCosts(0.01, tief)).toBe("Der Schnee kostet 12,3 Stunden (Tiefschnee).");
        expect(profileCosts(undefined, tief)).toBe("Der Schnee kostet 12,3 Stunden (Tiefschnee).");
        locale.value = "en";
        expect(profileCosts(undefined, tief)).toBe("Snow costs 12.3 hours (deep snow).");
    });

    it("🔴 ohne Schnee bleibt der Satz der Steigung, wie er war; ohne beides nichts", () => {
        expect(profileCosts(40.1, undefined)).toBe("Die Steigung kostet 40,1 Stunden.");
        expect(profileCosts(40.1, { extra_hours: 0.01, conditions: ["eis"] })).toBe(
            "Die Steigung kostet 40,1 Stunden.",
        );
        expect(profileCosts(0.01, undefined)).toBe("");
        expect(profileCosts(undefined, undefined)).toBe("");
    });

    it("schweigt unter drei Minuten, wie die Steigung", () => {
        expect(snowShown(undefined)).toBe(false);
        expect(snowShown({ extra_hours: 0.049, conditions: ["schnee_leicht"] })).toBe(false);
        expect(snowShown({ extra_hours: 0.05, conditions: ["schnee_leicht"] })).toBe(true);
    });

    it("🔴 keine Anrede, in keiner Sprache", () => {
        const texts = [profileCosts(40.1, tief), profileCosts(undefined, tief)];
        locale.value = "en";
        texts.push(profileCosts(40.1, tief), profileCosts(undefined, tief));
        for (const text of texts) expect(text).not.toMatch(/\b(du|dein|Sie|Ihr|you|your)\b/i);
    });
});
