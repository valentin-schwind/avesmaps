import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lesePublikationen, leseProduktseite, rawurlencode } from "../src/wiki/infobox/publikationen.ts";

/**
 * Die Publikationen eines Artikels und die Produktseiten (WI-0253, Scheibe Quellen) gegen Legacys ECHTE Funktionen (`avesmapsWikiParsePublicationsSection`,
 * `avesmapsWikiParsePageRef`, `avesmapsWikiParseProductInfobox`, `avesmapsWikiBuildPublicationUrl`, `avesmapsWikiPublicationDisplayTitle`, `avesmapsNormalizeSourceLabel` und das Tor des Katalogschritts; Mirror a7f2dac86). Die Erwartung
 * schreibt allein das Orakel (`scripts/dev/wiki-quellen-orakel.php`), nie die Hand.
 *
 * 🔴 Problemfälle der Fixture: Unterüberschriften, die wegfallen (Elektronische Quellen, Bildquellen, Unbekanntes); Groß- und Kleinschreibung und Leerraum im Kopf;
 * Zeilen ohne Link oder mit leerem Ziel; Zeichenverweise genau einmal (auch ein maskiertes `<small>`); `<SMALL>` mit Klammer in der Klammer; die erste Klammer als
 * Notiz; arabische Ziffern als Seiten (PHPs `\d` mit `u`); ein zweiter Abschnitt „Publikationen“ (nur der erste zählt); Windows-Zeilenenden; dieselbe Publikation
 * zweimal; F-Shop vor PDF-Shop, ein Platzhalter ohne Ziffer, Sonderzeichen in der Kennung (`rawurlencode`), die Produkt-Infobox als zweite Infobox, eine offene
 * Klammer, ein Wort „Produkt“ ohne Produktseite. Der Titel der Quelle: Untertitel als Teil des Seitennamens (auch mit gefalteten Strichen, Doppelpunkt und Großschreibung) oder bloß
 * beschreibend, ohne `Titel`, `<br>` und Leerraum, Zeichenverweise genau einmal, ein klein geschriebener Parameter (Legacy liest ihn nicht), 300 und 200 Zeichen, Griechisch.
 * Dazu der große Vergleich gegen alle 79.674 Seiten des lokalen Dumps (nicht im Repository): 0 Abweichungen, WI-0253 §19.
 */

interface Fall {
    id: string;
    titel: string;
    text: string;
    erwartet: {
        zitate: { title: string; reference_kind: string; pages: string | null; note: string | null }[];
        produkt: { adresse: string | null } | null;
    };
}

const faelle = (
    JSON.parse(
        readFileSync(fileURLToPath(new URL("./fixtures/wiki-quellen-orakel.json", import.meta.url)), "utf8"),
    ) as { faelle: Fall[] }
).faelle;

describe("WikiSync Quellen: Publikationen und Produktseiten gegen Legacy", () => {
    it("die Fixture ist vom Orakel gefüllt", () => {
        expect(faelle.length).toBeGreaterThanOrEqual(29);
        expect(faelle.every((fall) => fall.erwartet !== undefined)).toBe(true);
    });

    for (const fall of faelle) {
        it(`🔴 Parität: ${fall.id}`, () => {
            expect(
                lesePublikationen(fall.text).map((zitat) => ({
                    title: zitat.titel,
                    reference_kind: zitat.art,
                    pages: zitat.seiten,
                    note: zitat.notiz,
                })),
            ).toEqual(fall.erwartet.zitate);
            expect(leseProduktseite(fall.titel, fall.text)).toEqual(fall.erwartet.produkt);
        });
    }

    it("rawurlencode wie PHP: nur Buchstaben, Ziffern und -_.~ bleiben", () => {
        expect(rawurlencode("A&B(1)!*'~-_.ä ")).toBe("A%26B%281%29%21%2A%27~-_.%C3%A4%20");
    });
});
