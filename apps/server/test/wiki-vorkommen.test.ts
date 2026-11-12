import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leseSeitenFelder } from "../src/wiki/infobox/lesen.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import { artDerInfobox, leseVorkommen, ortsLinks } from "../src/wiki/infobox/vorkommen.ts";

/**
 * Der Leser der Vorkommen im WikiSync (WI-0253, Scheibe Vorkommen) gegen Legacy.
 *
 * - **Soll (Parität):** Für jede Seite der Fixture liefert `leseVorkommen` genau die Art, den Schlüssel, die Felder, die Rohtexte und die Ortsverknüpfungen, die Legacys Lore-Abgleich aus ihr
 *   ablegt (`avesmapsLoreParsePage` und die Ablage des Katalogschritts, Mirror a7f2dac86). Die Erwartung schreibt allein das Orakel (`scripts/dev/wiki-vorkommen-orakel.php`), nie die Hand.
 * - **Problemfälle der Fixture:** die Art allein aus dem Namen der ERSTEN Infobox (das Feld `Art` nie), Name mit Auszeichnung und Zeichenverweisen (genau einmal), `|Gegenstandstyp=[[Lack]]]]`
 *   mit vier schließenden Klammern, Linkziele mit Anker, Unterstrich und Leerraum, die Vorsilben `Kategorie:` und `Datei:`, doppelte Ziele (Groß und Klein), ein Wort aus zwei Links, der
 *   verlustbehaftete Schlüssel (`Fürstentum` wird `f-rstentum`), zwei Titel mit demselben Schlüssel (der letzte gewinnt Titel und Stelle), der Kontinent aus Klammerzusatz und
 *   wörtlicher Kategorie, die Längen der Spalten, `Weitere Namen` vor `Beinamen`, Parameter in Groß- und Kleinschreibung, ein Parameter in der ersten Zeile des Kastens, Kommentare und `<ref>`.
 * - **Gewollte Abweichung von Legacy:** Eine Infobox ohne schließende Klammer ist ein Befund (wie in allen Bereichen), Legacy las sie bis zum Ende des Textes.
 * - **Gewollte Erweiterung:** Das Feld `kurzbeschreibung` (WI-0260) liest Legacy nicht. Der Vergleich mit dem Orakel lässt es aus; `wiki-kurzbeschreibung.test.ts` prüft es mit erfundenem Text.
 */

interface OrakelFall {
    id: string;
    titel: string;
    ns: number;
    text: string;
    erwartet: {
        art: string;
        wikiKey: string;
        felder: Record<string, string>;
        orte: { titel: string; schluessel: string; beziehung: string; stelle: number }[];
    } | null;
}

const FIXTURE = fileURLToPath(new URL("./fixtures/wiki-vorkommen-orakel.json", import.meta.url));
const faelle = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { faelle: OrakelFall[] }).faelle;
/** Fälle, in denen der Leser mit Absicht anders liest als Legacy, mit dem Grund, den er nennt. */
const ABWEICHUNG: Readonly<Record<string, string>> = { "offene-infobox": "nicht_geschlossen" };

describe("WikiSync Vorkommen: der Leser gegen Legacys Lore-Parser", () => {
    it("die Fixture ist vom Orakel gefüllt", () => {
        expect(faelle.length).toBeGreaterThanOrEqual(45);
        expect(faelle.every((fall) => "erwartet" in fall)).toBe(true);
        // Echte Seiten des Dumps und Problemfälle sind beide da.
        expect(faelle.filter((fall) => fall.id.startsWith("echt-")).length).toBeGreaterThanOrEqual(15);
    });

    for (const fall of faelle) {
        it(`🔴 Parität: ${fall.id}`, () => {
            const eintrag = leseVorkommen(analysiere(fall.titel, fall.text));
            const abweichung = ABWEICHUNG[fall.id];
            if (abweichung !== undefined) {
                expect(eintrag).toMatchObject({ ok: false, grund: abweichung });
                return;
            }
            if (fall.erwartet === null) {
                expect(eintrag.ok).toBe(false);
                return;
            }
            expect(eintrag.ok).toBe(true);
            if (!eintrag.ok) return;
            expect(eintrag.art).toBe(fall.erwartet.art);
            expect(eintrag.wikiKey).toBe(fall.erwartet.wikiKey);
            const legacyFelder: Record<string, string> = { ...eintrag.felder };
            delete legacyFelder["kurzbeschreibung"];
            expect(legacyFelder).toEqual(fall.erwartet.felder);
            expect(eintrag.orte).toEqual(fall.erwartet.orte);
        });
    }

    it("die Art folgt allein dem Namen der ersten Infobox: das Feld Art und eine zweite Infobox zählen nie, eine fremde Infobox ist ein Befund", () => {
        const kunst = faelle.find((fall) => fall.id === "art-feld-ignoriert")!;
        expect(leseVorkommen(analysiere(kunst.titel, kunst.text))).toMatchObject({ ok: true, art: "flora" });
        const zweite = faelle.find((fall) => fall.id === "zweite-infobox")!;
        expect(leseSeitenFelder("vorkommen", analysiere(zweite.titel, zweite.text))).toMatchObject({
            ok: false,
            grund: "fremde_infobox",
        });
        const stadt = faelle.find((fall) => fall.id === "fremde-infobox")!;
        expect(leseSeitenFelder("vorkommen", analysiere(stadt.titel, stadt.text))).toMatchObject({
            ok: false,
            grund: "fremde_infobox",
        });
        const text = faelle.find((fall) => fall.id === "kein-wikitext")!;
        expect(leseSeitenFelder("vorkommen", analysiere(text.titel, text.text))).toMatchObject({
            ok: false,
            grund: "keine_infobox",
        });
        expect(artDerInfobox("Gegenstandsgruppe")).toBe("ware");
        expect(artDerInfobox("Tierart")).toBe("fauna");
        expect(artDerInfobox("Pflanzenart")).toBe("flora");
        expect(artDerInfobox("Spezies")).toBe("spezies");
        // Ein Substring zählt nie (Legacy: „ein Substring-Test auf art würde mit halb Aventurien kollidieren“).
        expect(artDerInfobox("Tierart Spezial")).toBeNull();
        expect(artDerInfobox("Stadt")).toBeNull();
    });

    it("die Ortsfelder: Verbreitung bei Fauna und Flora, Regionen bei der Spezies, Herkunft und Verbreitung bei der Ware – das Feld Vorkommen nie", () => {
        const zwerge = faelle.find((fall) => fall.id === "spezies-regionen")!;
        const eintrag = leseVorkommen(analysiere(zwerge.titel, zwerge.text));
        expect(eintrag.ok && eintrag.orte.map((ort) => `${ort.beziehung}:${ort.titel}`)).toEqual([
            "regionen:Ambossberge",
            "regionen:Kosch",
        ]);
        const ortlos = faelle.find((fall) => fall.id === "fauna-ohne-ortsfeld")!;
        const ohne = leseVorkommen(analysiere(ortlos.titel, ortlos.text));
        expect(ohne.ok && ohne.orte).toEqual([]);
        expect(ohne.ok && ohne.felder["lebensraum"]).toBe("[[Wald]]");
        const salz = faelle.find((fall) => fall.id === "ware-zwei-felder")!;
        const ware = leseVorkommen(analysiere(salz.titel, salz.text));
        // Dasselbe Ziel in zwei Beziehungen bleibt zwei Zeilen (stammt von / wird gehandelt).
        expect(ware.ok && ware.orte.filter((ort) => ort.schluessel === "perricum").map((ort) => ort.beziehung)).toEqual(
            ["herkunft", "verbreitung"],
        );
    });

    it("Wikilinks: Anker, Anzeigetext und Unterstrich fallen weg, Kategorie, Datei, Bild und Vorlage sind nie Orte, ein Ziel gilt je Feld einmal", () => {
        expect(
            ortsLinks(
                "[[Neu_Gareth#Geschichte|Gareth]], [[ Weiden ]], [[Kategorie:Orte]], [[Datei:Bild.jpg|100px]], [[gareth]]",
            ),
        ).toEqual(["Neu Gareth", "Weiden", "gareth"]);
        expect(ortsLinks("kein Link")).toEqual([]);
        expect(ortsLinks("[[Schaf]]s[[wolle]]")).toEqual(["Schaf", "wolle"]);
        expect(ortsLinks("[[Gareth]], [[GARETH]], [[Weiden|Weidener]]")).toEqual(["Gareth", "Weiden"]);
    });

    it("Legacys Schlüssel ist verlustbehaftet, und ein Link ohne Schlüssel fällt weg", () => {
        const fall = faelle.find((kandidat) => kandidat.id === "umlaut-schluessel")!;
        const eintrag = leseVorkommen(analysiere(fall.titel, fall.text));
        expect(eintrag.ok && eintrag.wikiKey).toBe("f-rstentum-kosch");
        // „[[日本]]“ ergibt keinen Schlüssel und kommt nicht vor; die Stelle zählt ihn nicht mit.
        expect(eintrag.ok && eintrag.orte.map((ort) => `${ort.stelle}:${ort.schluessel}`)).toEqual([
            "0:f-rstentum-kosch",
            "1:g-ldenland",
            "2:ss-test",
            "3:ber-den-wolken",
        ]);
    });
});
