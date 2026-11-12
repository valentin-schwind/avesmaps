import { afterEach, describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { da } from "../src/i18n/da.ts";
import { sv } from "../src/i18n/sv.ts";
import { locale, LOCALES, pluralKey, type Locale, tPlural } from "../src/i18n/i18n.ts";
import { DUAL_CASES, PLURAL_CASES, PLURAL_FORMS, pluralForm } from "../src/i18n/plural.ts";

/**
 * Die Zählformen (WI-0173): dass jede Sprache die Formen erklärt, die sie braucht, dass jede Tafel sie trägt, und
 * dass derselbe Satz mit 1, 2, 5 und 22 in jeder Sprache richtig herauskommt.
 *
 * 🔴 Der Anlass ist Polnisch (WI-0174): 1 Etappe, 2 bis 4 Etappen und 5 und mehr Etappen heißen dort verschieden,
 * und 22 zählt wieder wie 2. Eine Zahlenbedingung im Aufrufer (`n === 1`) kann das nicht treffen - deshalb wählt
 * `tPlural` die Form über `Intl.PluralRules`.
 */

const TAFELN: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
    de,
    en,
    fr,
    nl,
    it: itTafel,
    es,
    pl,
    da,
    sv,
};

afterEach(() => {
    locale.value = "de";
});

describe("Welche Formen eine Sprache erklärt", () => {
    /**
     * 💣 **Die Erklärung in `PLURAL_FORMS` ist eine Vereinfachung — und wird deshalb gemessen.** CLDR gibt `fr`, `it`
     * und `es` ein viertes `many` für Millionen („un million d'étapes“); unsere Zahlen sind Etappen, Meilen, Treffer
     * und Minuten. Dieser Fall hält die Vereinfachung gegen die Wirklichkeit: Taucht eine nicht erklärte Form in der
     * Spanne auf, in der unsere Zahlen leben, fällt er - nicht die Oberfläche.
     */
    it.each(LOCALES)("💣 %s: CLDR wählt in 0 … 1.000 keine Form, die die Sprache nicht erklärt hat", (lang) => {
        const regel = new Intl.PluralRules(lang);
        const erklaert = new Set<string>(PLURAL_FORMS[lang]);
        const fehlend = new Set<string>();
        for (let n = 0; n <= 1000; n += 1) if (!erklaert.has(regel.select(n))) fehlend.add(regel.select(n));
        for (const n of [10_000, 100_000, 1.5, 0.5]) if (!erklaert.has(regel.select(n))) fehlend.add(regel.select(n));
        expect([...fehlend]).toEqual([]);
    });

    /**
     * 🪤 Eine Million ist die eine Stelle, an der CLDR für `fr`, `it` und `es` doch `many` wählt. `pluralForm` fällt
     * dort auf `other` zurück, statt einen Schlüssel nachzuschlagen, den die Tafel nicht hat.
     */
    it("🪤 eine nicht erklärte Form fällt auf `other` zurück", () => {
        expect(new Intl.PluralRules("fr").select(1_000_000)).toBe("many");
        expect(pluralForm(1_000_000, "fr")).toBe("other");
    });

    it("🔴 die Null ist im Französischen Einzahl, sonst Mehrzahl (CLDR, WI-0158)", () => {
        for (const lang of ["de", "en", "nl", "it", "es"] as const) {
            expect(pluralForm(0, lang)).toBe("other");
            expect(pluralForm(1, lang)).toBe("one");
            expect(pluralForm(2, lang)).toBe("other");
        }
        expect(pluralForm(0, "fr")).toBe("one");
        expect(pluralForm(1, "fr")).toBe("one");
        expect(pluralForm(1.5, "fr")).toBe("one");
        expect(pluralForm(2, "fr")).toBe("other");
    });

    it("🔴 die Stilform für genau zwei gilt nur für die beiden Fälle, die sie erklärt haben", () => {
        expect(pluralForm(2, "de", "planner.closure.head")).toBe("two");
        expect(pluralForm(2, "de", "planner.summary.legCount")).toBe("other");
        expect(pluralForm(3, "de", "planner.closure.head")).toBe("other");
    });

    it("`pluralKey` nimmt ohne Sprache die der Seite", () => {
        locale.value = "fr";
        expect(pluralKey("planner.summary.landscapes", 0)).toBe("planner.summary.landscapes.one");
        locale.value = "de";
        expect(pluralKey("planner.summary.landscapes", 0)).toBe("planner.summary.landscapes.other");
    });
});

describe("Die Zählfälle in den Tafeln", () => {
    /**
     * 🔴 `PLURAL_CASES` ist die Wahrheit, und dieser Fall hält sie beidseitig: Kein Fall ohne Schlüssel, kein
     * `…one`-Schlüssel ohne Fall. Ohne die Gegenrichtung bliebe ein neues Paar `…One`/`…Many` unbemerkt in der
     * Tafel liegen und würde in der nächsten Sprache falsch gezählt.
     */
    it.each(LOCALES)("🔴 %s trägt jeden Fall in genau ihren Formen", (lang) => {
        const tafel = TAFELN[lang];
        for (const fall of PLURAL_CASES) {
            const erwartet = [
                ...PLURAL_FORMS[lang],
                ...((DUAL_CASES as readonly string[]).includes(fall) ? ["two"] : []),
            ].sort();
            const da = ["one", "two", "few", "many", "other"]
                .filter((form) => Object.hasOwn(tafel, `${fall}.${form}`))
                .sort();
            expect(da, fall).toEqual(erwartet);
        }
    });

    it("🔴 kein `…one`-Schlüssel ohne erklärten Fall", () => {
        const faelle = new Set<string>(PLURAL_CASES);
        const ohneFall = Object.keys(de)
            .filter((key) => key.endsWith(".one"))
            .map((key) => key.slice(0, -".one".length))
            .filter((fall) => !faelle.has(fall));
        expect(ohneFall).toEqual([]);
    });

    it("🪤 kein Text eines Falls ist leer", () => {
        for (const lang of LOCALES) {
            for (const fall of PLURAL_CASES) {
                for (const form of PLURAL_FORMS[lang]) {
                    expect(TAFELN[lang][`${fall}.${form}`], `${lang} ${fall}.${form}`).not.toBe("");
                }
            }
        }
    });
});

/**
 * 🔴 **Der Satz, durchgerechnet**: 1, 2, 5 und 22 in jeder Sprache und jedem Fall. 22 ist dabei die eigentliche
 * Probe — im Polnischen zählt sie wieder wie 2, in allen heutigen Sprachen wie 5. Eine Zahlenbedingung im Aufrufer
 * träfe das nie.
 */
describe("Ein Satz mit 1, 2, 5 und 22", () => {
    it.each(LOCALES)("%s: jeder Fall liefert zu jeder Zahl einen Text aus seiner Tafel", (lang) => {
        locale.value = lang;
        for (const fall of PLURAL_CASES) {
            for (const n of [1, 2, 5, 22]) {
                const schluessel = pluralKey(fall, n);
                expect(Object.hasOwn(TAFELN[lang], schluessel), `${lang} ${schluessel}`).toBe(true);
                const satz = tPlural(fall, n, { n, m: n, hits: String(n), zeile: "x", rss: "1 MB", how: "x" });
                expect(satz, `${lang} ${fall} ${n}`).not.toBe("");
                expect(satz, `${lang} ${fall} ${n}`).not.toContain("{n}");
            }
        }
    });

    /**
     * Der deutsche Wortlaut, Zahl für Zahl - die Probe, dass sich am Bildschirm nichts geändert hat. 🪤 Bei genau
     * zwei Sperrungen steht die Stilform („zweier“), bei 22 wieder die Mehrzahl.
     */
    it("🔴 Deutsch: der Wortlaut steht wie vorher", () => {
        locale.value = "de";
        expect(tPlural("planner.summary.legCount", 1, { n: 1 })).toBe("1 Etappe");
        expect(tPlural("planner.summary.legCount", 2, { n: 2 })).toBe("2 Etappen");
        expect(tPlural("planner.summary.legCount", 5, { n: 5 })).toBe("5 Etappen");
        expect(tPlural("planner.summary.legCount", 22, { n: 22 })).toBe("22 Etappen");
        expect(tPlural("planner.closure.head", 1, { n: 1 })).toBe("Wegen einer Sperrung anders geführt");
        expect(tPlural("planner.closure.head", 2, { n: 2 })).toBe("Wegen zweier Sperrungen anders geführt");
        expect(tPlural("planner.closure.head", 5, { n: 5 })).toBe("Wegen 5 Sperrungen anders geführt");
        expect(tPlural("planner.closure.head", 22, { n: 22 })).toBe("Wegen 22 Sperrungen anders geführt");
        expect(tPlural("infoPanel.source", 1)).toBe("Quelle:");
        expect(tPlural("infoPanel.source", 2)).toBe("Quellen:");
    });

    it("🔴 Englisch und Französisch: die Null trennt sie", () => {
        locale.value = "en";
        expect(tPlural("planner.summary.landscapes", 0, { n: 0 })).toBe("0 areas");
        expect(tPlural("planner.summary.landscapes", 1, { n: 1 })).toBe("1 area");
        locale.value = "fr";
        // Seit WI-0257 S4 zählt der Deckel „zone“ (Gegenden, wie die Suche; vorher „surface“, Betreiber 2026-10-18); „Régions“ ist die Ebene.
        expect(tPlural("planner.summary.landscapes", 0, { n: 0 })).toBe("0 zone");
        expect(tPlural("planner.summary.landscapes", 22, { n: 22 })).toBe("22 zones");
    });
});
