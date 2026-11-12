import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    legacySlug,
    normalisiereTitel,
    publikationsSchluessel,
    weiterleitungsZiel,
    wikiSchluesselFuerTitel,
} from "../src/wiki/schluessel.ts";

/**
 * Legacys Wiki-Schlüssel (WI-0253, Scheiben Ortslisten und Quellen) gegen die ECHTEN PHP-Funktionen: `avesmapsPoliticalSlug`, `avesmapsWikiSyncMonitorNormalizeTitle`,
 * `avesmapsPublicationCatalogWikiKeyForTitle`, `avesmapsGameLiteratureCanonicalKeyForName` und `avesmapsWikiDumpCanonicalWikiKeyForTitle` (das Ziel einer Weiterleitung; Mirror a7f2dac86). Die Erwartung schreibt allein das Orakel
 * (`scripts/dev/wiki-schluessel-orakel.php`), nie die Hand.
 *
 * 🔴 Problemfälle der Fixture: Umlaute werden ein `-` (nicht `ue`), `ß` und die Ligaturen werden ausgeschrieben, „marktgrafschaft“ wird „markgrafschaft“, ein Abschnitt fällt
 * nur im Titel weg (der Schlüssel eines Orts behält ihn), Zeichenverweise werden NICHT aufgelöst (`&#38;` schneidet den Titel am `#`), geschützte Leerzeichen am Rand,
 * NUL und `\x0B` (PHPs `trim`), Kelvin- und I-Punkt-Zeichen beim Kleinschreiben, Kombinationszeichen, 180 Zeichen mit einem `-` am Schnitt.
 */

interface Fall {
    id: string;
    wert: string;
    erwartet: { slug: string; titel: string; publikation: string; ort: string; weiterleitung: string };
}

const faelle = (
    JSON.parse(
        readFileSync(fileURLToPath(new URL("./fixtures/wiki-schluessel-orakel.json", import.meta.url)), "utf8"),
    ) as { faelle: Fall[] }
).faelle;

describe("WikiSync: Legacys Wiki-Schlüssel bitgenau", () => {
    it("die Fixture ist vom Orakel gefüllt", () => {
        expect(faelle.length).toBeGreaterThanOrEqual(51);
        expect(faelle.every((fall) => fall.erwartet !== undefined)).toBe(true);
    });

    for (const fall of faelle) {
        it(`🔴 Parität: ${fall.id}`, () => {
            expect({
                slug: legacySlug(fall.wert),
                titel: normalisiereTitel(fall.wert),
                publikation: publikationsSchluessel(fall.wert),
                ort: wikiSchluesselFuerTitel(fall.wert),
                weiterleitung: weiterleitungsZiel(fall.wert),
            }).toEqual(fall.erwartet);
        });
    }
});
