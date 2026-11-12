import { describe, expect, it } from "vitest";
import { wikiAnzeige, wikiKlartext } from "../src/inhalte/wiki-klartext.ts";

/**
 * **Wiki-Links als Text** (WI-0254): Die Felder Gruppe und Lebensraum eines Vorkommens kommen roh aus der Infobox des Wiki und
 * zeigen im Fenster „Inhalte bearbeiten“ den Text, nicht die Linksyntax. Dasselbe liest der Server (`klartext()` in
 * `apps/server/src/wiki/regeln/ableiten.ts`); die Fälle hier sind die der Infoboxen.
 *
 * **Vorlagen und HTML** (WI-0254): Notizen an Quellen-Verknüpfungen, Gruppe und Lebensraum tragen neben Links auch `{{R5}}` und
 * `{{Datum|1030|||}}`. Die Regeln legte Claudia am 27.10. nach den Vorlagenseiten im Wiki-Dump fest; jede steht unten mindestens einmal.
 */
describe("wikiKlartext", () => {
    it("ein einfacher Link zeigt den Artikelnamen", () => {
        expect(wikiKlartext("[[Pilz]]")).toBe("Pilz");
    });

    it("ein Link mit Anzeigetext zeigt den Anzeigetext, auch in einer Aufzählung", () => {
        expect(wikiKlartext("[[Graslandschaft|Grasland]], [[Heide]]")).toBe("Grasland, Heide");
    });

    it("eine angehängte Endung gehört zum Anzeigetext", () => {
        expect(wikiKlartext("[[Höhle]]n")).toBe("Höhlen");
        expect(wikiKlartext("auf [[Baum|Bäumen]]")).toBe("auf Bäumen");
    });

    it("ein Link auf Kategorie, Datei, Bild oder Vorlage fällt weg", () => {
        expect(wikiKlartext("[[Kategorie:Pflanze]]")).toBe("");
        expect(wikiKlartext("Pilz [[Datei:Pilz.png|thumb]] im Wald")).toBe("Pilz im Wald");
        expect(wikiKlartext("[[bild:x.png]] [[Vorlage:Y]]")).toBe("");
    });

    it("ein Abschnittsanker im Ziel zählt nicht zum Text", () => {
        expect(wikiKlartext("[[Gebirge#Kaiserkrone]]")).toBe("Gebirge");
        expect(wikiKlartext("[[Gebirge#Kaiserkrone|Kaiserkrone]]")).toBe("Kaiserkrone");
    });

    it("Text ohne Links bleibt, der Leerraum wird zusammengezogen", () => {
        expect(wikiKlartext("Wald, Wiese")).toBe("Wald, Wiese");
        expect(wikiKlartext("  Wald \n  und   Wiese ")).toBe("Wald und Wiese");
        expect(wikiKlartext("")).toBe("");
    });

    it("ein unvollständiger Link bleibt, wie er getippt wurde", () => {
        expect(wikiKlartext("[[Pilz")).toBe("[[Pilz");
    });

    it("Text mit Links und Vorlage in einer Notiz bleibt ein Satz", () => {
        expect(wikiKlartext("Siehe [[Schwarze Lande|Schwarzen Landen]] {{R5}}")).toBe(
            "Siehe Schwarzen Landen DSA5-Regeln",
        );
    });
});

describe("wikiKlartext: Regelstand und Seitenindikatoren", () => {
    it("jeder Regelstand zeigt sein Regelwerk", () => {
        const erwartet: Readonly<Record<string, string>> = {
            R1: "DSA1-Regeln",
            R2: "DSA2-Regeln",
            R3: "DSA3-Regeln",
            R4: "DSA4-Regeln",
            R5: "DSA5-Regeln",
            My4: "Myranor-DSA4-Regeln",
            My4beta: "Myranor-DSA4beta-Regeln",
            DZ: "DSA4-Dunkle Zeiten-Regeln",
            U4: "Uthuria-DSA4-Regeln",
            T4: "Tharun-DSA4-Regeln",
            RP: "Tharun-DSA-Professional-Regeln",
        };
        for (const [vorlage, text] of Object.entries(erwartet)) expect(wikiKlartext(`{{${vorlage}}}`)).toBe(text);
    });

    it("jeder Seitenindikator zeigt den Namen des Regelwerks", () => {
        for (const n of [1, 2, 3, 4, 5]) expect(wikiKlartext(`{{DSA${String(n)}}}`)).toBe(`DSA${String(n)}`);
        expect(wikiKlartext("{{Dunkle Zeiten}}")).toBe("Dunkle Zeiten");
    });

    it("der Anfangsbuchstabe des Vorlagennamens gilt groß wie klein, Leerraum drumherum zählt nicht", () => {
        expect(wikiKlartext("{{r5}}")).toBe("DSA5-Regeln");
        expect(wikiKlartext("{{my4beta}}")).toBe("Myranor-DSA4beta-Regeln");
        expect(wikiKlartext("{{dunkle Zeiten}}")).toBe("Dunkle Zeiten");
        expect(wikiKlartext("{{ R5 }}")).toBe("DSA5-Regeln");
        expect(wikiKlartext("{{\nR5\n}}")).toBe("DSA5-Regeln");
    });

    it("Regelstände stehen in einer Notiz neben Text und Links", () => {
        expect(wikiKlartext("{{R4}} Seite 12 im [[Almanach]], {{R5}}")).toBe(
            "DSA4-Regeln Seite 12 im Almanach, DSA5-Regeln",
        );
    });
});

describe("wikiKlartext: aventurisches Datum", () => {
    it("Jahr, Mond und Tag: „Tag. Mond Jahr BF“", () => {
        expect(wikiKlartext("{{Datum|1044|4|12|}}")).toBe("12. Travia 1044 BF");
    });

    it("ohne Tag „Mond Jahr BF“, ohne Mond „Jahr BF“", () => {
        expect(wikiKlartext("{{Datum|1044|4||}}")).toBe("Travia 1044 BF");
        expect(wikiKlartext("{{Datum|1030|||}}")).toBe("1030 BF");
        expect(wikiKlartext("{{Datum|1046||}}")).toBe("1046 BF");
    });

    it("ein Jahr mit Minus heißt „N v. BF“", () => {
        expect(wikiKlartext("{{Datum|-160|||}}")).toBe("160 v. BF");
        expect(wikiKlartext("{{Datum|−160|||}}")).toBe("160 v. BF");
    });

    it("alle 13 Monde, auch mit führender Null", () => {
        const monde = [
            "Praios",
            "Rondra",
            "Efferd",
            "Travia",
            "Boron",
            "Hesinde",
            "Firun",
            "Tsa",
            "Phex",
            "Peraine",
            "Ingerimm",
            "Rahja",
            "Namenlose Tage",
        ];
        monde.forEach((mond, index) => {
            expect(wikiKlartext(`{{Datum|1000|${String(index + 1)}||}}`)).toBe(`${mond} 1000 BF`);
        });
        expect(wikiKlartext("{{Datum|1020|08||}}")).toBe("Tsa 1020 BF");
        expect(wikiKlartext("{{Datum|1020|01|05|}}")).toBe("5. Praios 1020 BF");
    });

    it("A, M und E stehen für Anfang, Mitte und Ende an der Stelle von Mond oder Tag", () => {
        expect(wikiKlartext("{{Datum|1030|A||}}")).toBe("Anfang 1030 BF");
        expect(wikiKlartext("{{Datum|1030|1|M|}}")).toBe("Mitte Praios 1030 BF");
        expect(wikiKlartext("{{Datum|1020|08|E|}}")).toBe("Ende Tsa 1020 BF");
        expect(wikiKlartext("{{Datum|1030|E||}}")).toBe("Ende 1030 BF");
    });

    it("die Präfixe des Schalters setzen ein Wort davor", () => {
        const erwartet: Readonly<Record<string, string>> = {
            c: "etwa",
            v: "vor",
            n: "nach",
            b: "bis",
            a: "ab",
            s: "spätestens",
            f: "frühestens",
        };
        for (const [schalter, wort] of Object.entries(erwartet)) {
            expect(wikiKlartext(`{{Datum|1030|||${schalter}}}`)).toBe(`${wort} 1030 BF`);
        }
        expect(wikiKlartext("{{Datum|-160|||c}}")).toBe("etwa 160 v. BF");
        expect(wikiKlartext("{{Datum|1030|2|3|b}}")).toBe("bis 3. Rondra 1030 BF");
    });

    it("u zeigt nur „unbekannt“", () => {
        expect(wikiKlartext("{{Datum|1030|||u}}")).toBe("unbekannt");
        expect(wikiKlartext("{{Datum|1030|||cu}}")).toBe("unbekannt");
    });

    it("m lässt Mond und Tag weg, t den Tag, J das Jahr, M Mond und Jahr", () => {
        expect(wikiKlartext("{{Datum|1044|4|12|m}}")).toBe("1044 BF");
        expect(wikiKlartext("{{Datum|1044|4|12|t}}")).toBe("Travia 1044 BF");
        expect(wikiKlartext("{{Datum|1044|4|12|J}}")).toBe("12. Travia");
        expect(wikiKlartext("{{Datum|1044|4|12|M}}")).toBe("12.");
    });

    it("p, w, i und - ändern die Anzeige nicht", () => {
        for (const schalter of ["p", "w", "i", "-", "Y", "p-"]) {
            expect(wikiKlartext(`{{Datum|1044|4|12|${schalter}}}`)).toBe("12. Travia 1044 BF");
        }
    });

    it("ein Datum ohne jede Angabe bleibt leer, eine unbekannte Zahl als Mond steht, wie sie ist", () => {
        expect(wikiKlartext("Gründung {{Datum|||}}")).toBe("Gründung");
        expect(wikiKlartext("{{Datum|1030|14||}}")).toBe("14 1030 BF");
    });

    it("ein Datum in einer Notiz neben Text", () => {
        expect(wikiKlartext("Stand {{Datum|1030|||c}} laut [[Aventurischer Bote]]")).toBe(
            "Stand etwa 1030 BF laut Aventurischer Bote",
        );
    });
});

describe("wikiKlartext: weitere Vorlagen mit eigener Regel", () => {
    it("die Chronik-Verlinkung zeigt die Anzeige, sonst das Jahr", () => {
        expect(wikiKlartext("{{-|1030|im Jahr des Feuers}}")).toBe("im Jahr des Feuers");
        expect(wikiKlartext("{{-|1030}}")).toBe("1030");
        expect(wikiKlartext("{{-|1030|}}")).toBe("1030");
    });

    it("Zauber zeigt die Anzeige, sonst das Ziel", () => {
        expect(wikiKlartext("{{Zauber|Ignifaxius Flammenstrahl|Ignifaxius}}")).toBe("Ignifaxius");
        expect(wikiKlartext("{{Zauber|Ignifaxius Flammenstrahl}}")).toBe("Ignifaxius Flammenstrahl");
    });

    it("Tra zeigt den Wert", () => {
        expect(wikiKlartext("{{Tra|Rohalssteg}}")).toBe("Rohalssteg");
    });

    it("sic zeigt den Text mit [sic]", () => {
        expect(wikiKlartext("{{sic|Aventurien}}")).toBe("Aventurien [sic]");
    });

    it("DaP zeigt „Datierung: Titel“", () => {
        expect(wikiKlartext("{{DaP|Das Jahr des Greifen}}")).toBe("Datierung: Das Jahr des Greifen");
    });
});

describe("wikiKlartext: andere Vorlagen und Verschachtelung", () => {
    it("eine unbekannte Vorlage zeigt ihren ersten Positionsparameter", () => {
        expect(wikiKlartext("{{Hinweis|Siehe auch|zweiter}}")).toBe("Siehe auch");
    });

    it("benannte Parameter zählen nicht", () => {
        expect(wikiKlartext("{{Hinweis|farbe=rot|Siehe auch}}")).toBe("Siehe auch");
        expect(wikiKlartext("{{Hinweis|Siehe auch|farbe=rot}}")).toBe("Siehe auch");
    });

    it("eine unbekannte Vorlage ohne Positionsparameter zeigt ihren Namen", () => {
        expect(wikiKlartext("{{Hinweis}}")).toBe("Hinweis");
        expect(wikiKlartext("{{ Hinweis }}")).toBe("Hinweis");
        expect(wikiKlartext("{{Hinweis|farbe=rot}}")).toBe("Hinweis");
    });

    it("Leerraum um die Parameter wird getrimmt", () => {
        expect(wikiKlartext("{{Tra |  Rohalssteg  }}")).toBe("Rohalssteg");
        expect(wikiKlartext("{{Hinweis |   Siehe  auch }}")).toBe("Siehe auch");
    });

    it("verschachtelte Vorlagen werden von innen nach außen aufgelöst", () => {
        expect(wikiKlartext("{{Hinweis|{{Datum|1030|||c}}}}")).toBe("etwa 1030 BF");
        expect(wikiKlartext("{{Zauber|x|{{Tra|Ignifaxius}}}}")).toBe("Ignifaxius");
        expect(wikiKlartext("{{sic|{{R5}}}}")).toBe("DSA5-Regeln [sic]");
    });

    it("Links in Parametern werden danach aufgelöst, der Strich im Link trennt keinen Parameter", () => {
        expect(wikiKlartext("{{Zauber|Ignifaxius|[[Ignifaxius Flammenstrahl|Flammenstrahl]]}}")).toBe("Flammenstrahl");
        expect(wikiKlartext("{{Hinweis|[[Graslandschaft|Grasland]]|zweiter}}")).toBe("Grasland");
    });

    it("eine Vorlage in einem Link wird vor dem Link aufgelöst", () => {
        expect(wikiKlartext("[[Chronik|{{Datum|1030|||}}]]")).toBe("1030 BF");
    });

    it("eine nicht geschlossene Vorlage bleibt, wie sie getippt wurde", () => {
        expect(wikiKlartext("{{R5")).toBe("{{R5");
        expect(wikiKlartext("{{R5}} und {{Datum|1030")).toBe("DSA5-Regeln und {{Datum|1030");
    });
});

describe("wikiKlartext: kleines HTML", () => {
    it("small fällt weg, der Inhalt bleibt", () => {
        expect(wikiKlartext("Seite 4 <small>(nur im Anhang)</small>")).toBe("Seite 4 (nur im Anhang)");
        expect(wikiKlartext("<SMALL>{{R5}}</SMALL>")).toBe("DSA5-Regeln");
    });

    it("br und nbsp werden Leerzeichen", () => {
        expect(wikiKlartext("Zeile eins<br>Zeile zwei<br/>Zeile drei<br />vier")).toBe(
            "Zeile eins Zeile zwei Zeile drei vier",
        );
        expect(wikiKlartext("S.&nbsp;12")).toBe("S. 12");
    });
});

describe("wikiAnzeige", () => {
    it("solange der Entwurf den gespeicherten Wert hält, steht der Klartext", () => {
        expect(wikiAnzeige("{{R5}} [[Pilz]]", "{{R5}} [[Pilz]]")).toBe("DSA5-Regeln Pilz");
    });

    it("hat jemand das Feld geändert, steht genau sein Text", () => {
        expect(wikiAnzeige("{{R5}} [[Pilz]]x", "{{R5}} [[Pilz]]")).toBe("{{R5}} [[Pilz]]x");
        expect(wikiAnzeige("DSA5-Regeln Pilz", "{{R5}} [[Pilz]]")).toBe("DSA5-Regeln Pilz");
    });

    it("ohne gespeicherten Stand (neue Zeile) steht, was im Entwurf steht", () => {
        expect(wikiAnzeige("{{R5}}", undefined)).toBe("{{R5}}");
    });
});
