import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leseSeitenFelder } from "../src/wiki/infobox/lesen.ts";
import { leseProdukt, ortsliste, werkart } from "../src/wiki/infobox/literatur.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";

/**
 * Der Leser der Literatur im WikiSync (WI-0253, Scheibe Literatur) gegen Legacy.
 *
 * - **Soll (Parität):** Für jede Seite der Fixture liefert `leseProdukt` genau die Felder und die Ortsliste, die Legacys Literatur-Abgleich aus ihr in den Katalog legt
 *   (`avesmapsWikiParseProductInfobox`, Mirror a7f2dac86, und die Ablage der Phase `adventures`). Die Erwartung schreibt allein das Orakel
 *   (`scripts/dev/wiki-literatur-orakel.php`), nie die Hand.
 * - **Problemfälle der Fixture:** Zeichenverweise genau einmal aufgelöst, ein leerer Titel (Seitentitel samt Präfix `DSK:`), die Kommaliste als Rückfall nur im Feld `Ort`,
 *   `Thema` bei Spielhilfen, der Rückfall auf das andere Feld, `Reihe` leer neben `Reihentitel` (PHP `??`), ein Kasten mit zwei Leerzeichen im Namen, ein Parameter in der
 *   ersten Zeile des Kastens, die Infobox Produkt als zweite Infobox der Seite, ein Platzhalter als F-Shop-Nummer, ein Titel über 300 Zeichen, geschützte Leerzeichen.
 * - **Gewollte Abweichung von Legacy:** Auszeichnung im Titel fällt weg (`titel-ohne-auszeichnung.test.ts`; die Fixture nennt keine). Ein Werk ohne Ortsliste liest sich (`katalog: false`): Legacy legt daraus nichts NEU an, aber die Felder eines vorhandenen Werks hängen
 *   nicht an seinen Orten.
 */

interface OrakelFall {
    id: string;
    titel: string;
    ns: number;
    text: string;
    erwartet: { felder: Record<string, string>; orte: string[] } | null;
}

const FIXTURE = fileURLToPath(new URL("./fixtures/wiki-literatur-orakel.json", import.meta.url));
const faelle = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { faelle: OrakelFall[] }).faelle;

describe("WikiSync Literatur: der Leser von {{Infobox Produkt}} gegen Legacys Parser", () => {
    it("die Fixture ist vom Orakel gefüllt", () => {
        expect(faelle.length).toBeGreaterThanOrEqual(15);
        expect(faelle.every((fall) => "erwartet" in fall)).toBe(true);
    });

    for (const fall of faelle) {
        it(`🔴 Parität: ${fall.id}`, () => {
            const werk = leseProdukt(analysiere(fall.titel, fall.text));
            if (fall.erwartet === null) {
                // Legacy macht daraus keinen Katalogeintrag: kein Werk, oder eines ohne Ortsliste.
                expect(werk.ok && werk.katalog).toBe(false);
                return;
            }
            expect(werk.ok).toBe(true);
            if (!werk.ok) return;
            expect(werk.katalog).toBe(true);
            expect(werk.felder).toEqual(fall.erwartet.felder);
            expect(werk.orte).toEqual(fall.erwartet.orte);
        });
    }

    it("ein Werk ohne Ortsliste liest seine Felder trotzdem (gewollte Abweichung), ein Regelband ist keine Literatur, eine fremde Infobox ist ein Befund", () => {
        const ohneOrte = faelle.find((fall) => fall.id === "spielhilfe-ohne-orte")!;
        const werk = leseProdukt(analysiere(ohneOrte.titel, ohneOrte.text));
        expect(werk).toMatchObject({
            ok: true,
            katalog: false,
            orte: [],
            felder: { title: "Abenteuer Ausbau-Spiel", product_type: "spielhilfe" },
        });
        const regelband = faelle.find((fall) => fall.id === "regelband")!;
        expect(leseSeitenFelder("literatur", analysiere(regelband.titel, regelband.text))).toMatchObject({
            ok: false,
            grund: "keine_literatur",
        });
        const zweite = faelle.find((fall) => fall.id === "zweite-infobox")!;
        expect(leseSeitenFelder("literatur", analysiere(zweite.titel, zweite.text))).toMatchObject({
            ok: false,
            grund: "fremde_infobox",
        });
        expect(
            leseSeitenFelder("literatur", analysiere("Offen", "{{Infobox Produkt\n|Art=Roman\n|Ort=[[A]]")),
        ).toMatchObject({
            ok: false,
            grund: "nicht_geschlossen",
        });
    });

    it("Werkart und Ortsliste wie Legacy: Abenteuer am Wortteil, Kampagnenband, kein Freitext in Thema", () => {
        expect(werkart("Gruppenabenteuer")).toBe("abenteuer");
        expect(werkart("Kaufabenteuer (limitiert)")).toBe("abenteuer");
        expect(werkart("Kampagnenband")).toBe("abenteuer");
        expect(werkart("Regionalspielhilfe")).toBe("regionalspielhilfe");
        expect(werkart("Hörbuch")).toBe("");
        expect(ortsliste("erweiterte Regeln", false)).toEqual([]);
        expect(ortsliste("Gareth, Punin", true)).toEqual(["Gareth", "Punin"]);
        expect(ortsliste("[[Gareth#Alt|G]]; [[ Punin ]]", false)).toEqual(["Gareth", "Punin"]);
    });
});
