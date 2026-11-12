import { afterEach, describe, expect, it, vi } from "vitest";
import { wann } from "../src/auth/versionen.ts";
import { SPRACH_WERT_NAMEN, sprachWertSchluessel } from "../src/editor-panel/statistik-sprachen.ts";
import { locale, LOCALES, t, type Locale } from "../src/i18n/i18n.ts";

/**
 * Zwei Stellen, die bis WI-0168 nur Deutsch und Englisch kannten, obwohl die Oberfläche sechs Sprachen spricht: das Datum in
 * „Versionen“ und die Sprachdimension der Besucherstatistik. Beide laufen jetzt über `Locale`; die Erwartungen hier sind
 * `Record<Locale, …>`, also ist auch eine siebte Sprache ohne Fall ein Typfehler.
 */

afterEach(() => {
    locale.value = "de";
    vi.restoreAllMocks();
});

/** 11.10.2026, 00:41 in der Zeit des Betrachters, wie `wann` sie zeigt. */
const ISO = new Date(2026, 9, 11, 0, 41).toISOString();

/**
 * 🪤 Italienisch und Spanisch schreiben dieses Datum wie Englisch („11/10, 00:41“). Der Text allein beweist deshalb nicht,
 * dass `it-IT` oder `es-ES` gewählt wurde; das Gebietsschema wird darum zusätzlich am Aufruf geprüft.
 */
const DATUM: Record<Locale, { gebiet: string; kurz: string; mitJahr: string }> = {
    de: { gebiet: "de-DE", kurz: "11.10., 00:41", mitJahr: "11.10.2026, 00:41" },
    en: { gebiet: "en-GB", kurz: "11/10, 00:41", mitJahr: "11/10/2026, 00:41" },
    fr: { gebiet: "fr-FR", kurz: "11/10 00:41", mitJahr: "11/10/2026 00:41" },
    nl: { gebiet: "nl-NL", kurz: "11-10, 00:41", mitJahr: "11-10-2026, 00:41" },
    it: { gebiet: "it-IT", kurz: "11/10, 00:41", mitJahr: "11/10/2026, 00:41" },
    es: { gebiet: "es-ES", kurz: "11/10, 00:41", mitJahr: "11/10/2026, 00:41" },
    // 🪤 Polnisch schreibt den Tag mit Punkten, aber OHNE Punkt hinter dem Monat: „11.10, 00:41“, nicht „11.10.“.
    pl: { gebiet: "pl-PL", kurz: "11.10, 00:41", mitJahr: "11.10.2026, 00:41" },
    // 🪤 Dänisch trennt die Uhrzeit mit einem PUNKT („00.41“), nicht mit einem Doppelpunkt - so steht es in CLDR.
    da: { gebiet: "da-DK", kurz: "11.10, 00.41", mitJahr: "11.10.2026, 00.41" },
    // 🪤 Schwedisch schreibt das kurze Datum mit Schrägstrich und OHNE Komma, das lange jahresführend.
    sv: { gebiet: "sv-SE", kurz: "11/10 00:41", mitJahr: "2026-10-11 00:41" },
};

describe("Das Datum in „Versionen“ folgt der Sprache der Seite", () => {
    for (const lang of LOCALES) {
        it(`${lang}: ${DATUM[lang].kurz}`, () => {
            locale.value = lang;
            const aufruf = vi.spyOn(Date.prototype, "toLocaleString");
            expect(wann(ISO)).toBe(DATUM[lang].kurz);
            expect(wann(ISO, true)).toBe(DATUM[lang].mitJahr);
            expect(aufruf.mock.calls.map(([gebiet]) => gebiet)).toEqual([DATUM[lang].gebiet, DATUM[lang].gebiet]);
        });
    }

    it("🔴 Französisch und Niederländisch bekommen nicht mehr das englische Datum", () => {
        locale.value = "en";
        const englisch = wann(ISO);
        for (const lang of ["fr", "nl"] as const) {
            locale.value = lang;
            expect(wann(ISO)).not.toBe(englisch);
        }
    });
});

describe("Die Sprachdimension der Besucherstatistik kennt jede Sprache der Oberfläche", () => {
    it("jede Sprache aus LOCALES hat einen Namen, keine andere", () => {
        expect(Object.keys(SPRACH_WERT_NAMEN).sort()).toEqual([...LOCALES].sort());
        for (const lang of LOCALES) expect(SPRACH_WERT_NAMEN[lang]).toBe(sprachWertSchluessel(lang));
    });

    it("auf Deutsch heißen sie so", () => {
        expect(LOCALES.map((wert) => t(sprachWertSchluessel(wert)))).toEqual([
            "Deutsch",
            "Englisch",
            "Französisch",
            "Niederländisch",
            "Italienisch",
            "Spanisch",
            "Polnisch",
            "Dänisch",
            "Schwedisch",
        ]);
    });

    for (const seite of LOCALES) {
        it(`${seite}: jede Sprache ein eigener Name, keiner ist das Kürzel`, () => {
            locale.value = seite;
            const namen = LOCALES.map((wert) => t(sprachWertSchluessel(wert)));
            expect(new Set(namen).size).toBe(LOCALES.length);
            for (const [i, name] of namen.entries()) {
                expect(name.trim()).not.toBe("");
                expect(name).not.toBe(LOCALES[i]);
            }
        });
    }
});
