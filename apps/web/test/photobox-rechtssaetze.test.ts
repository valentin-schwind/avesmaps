import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { da } from "../src/i18n/da.ts";
import { de, type MessageKey } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { RECHTSSAETZE_ENGLISCH, SPRACHEN_MIT_ENGLISCHEN_RECHTSSAETZEN } from "./rechtssaetze-reisebilder.ts";

/**
 * Die Rechtssätze der Reisebilder in den Sprachen außer Deutsch und Englisch (WI-0272, Review S2b I4). Nach `docs/regeln/oberflaeche.md` („Rechtstexte wirken rechtlich“) zeigen sie die englische
 * Fassung, bis der Betreiber eine eigene abgenommen hat, wie die Hinweise (`legal/legal-texts.ts`). Die Sätze sind: die Erklärung am Häkchen, die Folgen der Nutzungswahl (samt „nicht zurückzunehmen“),
 * der Datenschutz-Kurzsatz und die Folgen von CC BY und Offline-Nehmen auf der Statusseite. Alle übrigen Beschriftungen bleiben übersetzt.
 */

const TAFELN = { da, es, fr, it: itTafel, nl, pl, sv } as const;

describe("🔴 die Rechtssätze der Reisebilder sind in sieben Sprachen die englische Fassung", () => {
    it("die Liste benennt Schlüssel, die es in allen neun Tafeln gibt", () => {
        for (const key of RECHTSSAETZE_ENGLISCH) {
            expect(Object.keys(de), key).toContain(key);
            expect(Object.keys(en), key).toContain(key);
        }
        expect(new Set(RECHTSSAETZE_ENGLISCH).size).toBe(RECHTSSAETZE_ENGLISCH.length);
    });

    it("Deutsch und Englisch haben je ihre eigene Fassung (sonst wäre der Vergleich unten leer)", () => {
        for (const key of RECHTSSAETZE_ENGLISCH) expect(de[key as MessageKey], key).not.toBe(en[key as MessageKey]);
    });

    for (const sprache of SPRACHEN_MIT_ENGLISCHEN_RECHTSSAETZEN) {
        it(`${sprache}: jeder dieser Sätze ist Zeichen für Zeichen der englische`, () => {
            const tafel: Readonly<Record<string, string>> = TAFELN[sprache];
            for (const key of RECHTSSAETZE_ENGLISCH)
                expect(tafel[key], `${sprache}: ${key}`).toBe(en[key as MessageKey]);
        });

        it(`${sprache}: die übrigen Beschriftungen des Formulars und der Statusseite bleiben übersetzt`, () => {
            const tafel: Readonly<Record<string, string>> = TAFELN[sprache];
            const beschriftungen = [
                "photobox.hochladen",
                "photobox.nutzung.label",
                "photobox.nutzung.avesmaps_only",
                "photobox.datenschutz.link",
                "photobox.status.titel",
                "photobox.status.zurueckziehen",
                "photobox.status.nutzung.ccBy",
                "photobox.status.nutzung.ccBy.bestaetigen",
                "photobox.sperre.haken",
                "photobox.fuss.hinweis",
            ];
            for (const key of beschriftungen) expect(tafel[key], `${sprache}: ${key}`).not.toBe(en[key as MessageKey]);
        });

        it(`${sprache}: die Tafel sagt über der Gruppe, warum die Sätze englisch sind`, () => {
            const quelle = readFileSync(
                join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n"), `${sprache}.ts`),
                "utf8",
            );
            expect(quelle).toContain("Rechtssätze der Reisebilder");
            expect(quelle).toContain("Rechtssatz, englisch bis zur Abnahme");
        });
    }
});
