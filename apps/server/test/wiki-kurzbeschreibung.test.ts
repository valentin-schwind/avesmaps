import { describe, expect, it } from "vitest";
import {
    KURZBESCHREIBUNG_MAX_SAETZE,
    KURZBESCHREIBUNG_MAX_ZEICHEN,
    kuerzeAufSaetze,
    kurzbeschreibungVon,
    saetzeVon,
} from "../src/wiki/infobox/kurzbeschreibung.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import { leseVorkommen } from "../src/wiki/infobox/vorkommen.ts";

/**
 * Die Kurzbeschreibung eines Vorkommens aus seinem Wiki-Artikel (WI-0260). 🔴 Aller Wikitext hier ist erfunden: Kein Artikeltext des Wikis steht in einem Test (Text unter CC BY-SA 3.0, Zitate und
 * Inhalte von Ulisses ausgenommen).
 *
 * - Quelle: der Abschnitt „Kurzbeschreibung“ (im Wiki VOR der Infobox), sonst der erste Absatz nach der Infobox.
 * - Reiner Text: Vorlagen, Einzelnachweise, Kommentare, Bilder und Kategorien fallen weg, Links werden ihr Anzeigetext, Fett und Kursiv fallen weg.
 * - Zitat-Vorlagen, Blockzitate und Ulisses-Inhalt fallen weg; ist der ganze Absatz so, gibt es keine Kurzbeschreibung.
 * - Höchstens drei Sätze und 400 Zeichen an einer Satzgrenze.
 */

const INFOBOX = ["{{Infobox Tierart", "|Name=Mondnessel", "|Art=[[Insekt]]", "|Verbreitung=[[Nebelwald]]", "}}"].join(
    "\n",
);

/** Ein Artikel im Aufbau des Wikis: Überschrift, Infobox, Text. */
const artikel = (text: string, ...davor: string[]): string =>
    [
        ...davor,
        "{{Aventurien}}",
        "==Kurzbeschreibung==",
        INFOBOX,
        text,
        "",
        "==Publikationen==",
        "*[[Ein Buch]] Seite 1",
    ].join("\n");

describe("Kurzbeschreibung: Quelle", () => {
    it("liest den Abschnitt Kurzbeschreibung, der im Wiki vor der Infobox steht, und nimmt die Infobox nie mit", () => {
        expect(kurzbeschreibungVon(artikel("Die '''Mondnessel''' ist ein kleines Insekt des Nebelwalds."))).toBe(
            "Die Mondnessel ist ein kleines Insekt des Nebelwalds.",
        );
    });

    it("überspringt Bilder, Vorlagen und Kommentare vor dem Text und nimmt den ersten Absatz mit Fließtext", () => {
        const text = [
            "{{Thumb|Mondnessel.jpg|Eine Mondnessel; Zeichnung aus {{Scriptorium|Nr=1|Name=Eine Box}}}}",
            "{{Thumbleft|Zweites Bild.jpg}}",
            "[[Datei:Drittes Bild.png|thumb|Unterschrift mit [[Link]]]]",
            "<!-- Ein Kommentar, der nicht zählt. -->",
            "",
            "Die Mondnessel summt in der Dämmerung. Sie ist harmlos.",
            "",
            "Dieser zweite Absatz zählt nicht.",
        ].join("\n");
        expect(kurzbeschreibungVon(artikel(text))).toBe("Die Mondnessel summt in der Dämmerung. Sie ist harmlos.");
    });

    it("ohne den Abschnitt: der erste Absatz nach der Infobox, nie der Text davor, und nie ein Absatz hinter der ersten Überschrift", () => {
        const text = [
            "Text vor der Infobox, der nicht gemeint ist.",
            INFOBOX,
            "Die Mondnessel lebt im Nebelwald.",
            "",
            "==Irdisches==",
            "Nichts davon.",
        ].join("\n");
        expect(kurzbeschreibungVon(text)).toBe("Die Mondnessel lebt im Nebelwald.");
        // Steht gleich nach der Infobox eine Überschrift, gibt es keinen Absatz.
        expect(kurzbeschreibungVon([INFOBOX, "==Irdisches==", "Nur hier steht Text."].join("\n"))).toBeNull();
    });

    it("steht die Überschrift doppelt, zählt der Abschnitt, in dem der Text steht", () => {
        const text = [
            "==Kurzbeschreibung==",
            "==Kurzbeschreibung==",
            INFOBOX,
            "",
            "Die Mondnessel ist ein Insekt.",
        ].join("\n");
        expect(kurzbeschreibungVon(text)).toBe("Die Mondnessel ist ein Insekt.");
    });

    it("eine Liste direkt unter dem Satz gehört nicht dazu, eine Liste vor dem Text wird übersprungen", () => {
        expect(kurzbeschreibungVon(artikel("Die Mondnessel ist ein Insekt.\n;Sorten\n*Silberne\n*Graue"))).toBe(
            "Die Mondnessel ist ein Insekt.",
        );
        expect(kurzbeschreibungVon(artikel("*ein Punkt\n*noch ein Punkt\n\nDie Mondnessel wächst am Fluss."))).toBe(
            "Die Mondnessel wächst am Fluss.",
        );
    });

    it("ein leerer Artikel, eine Seite ohne Fließtext und ein Abschnitt ohne Text haben keine Kurzbeschreibung", () => {
        expect(kurzbeschreibungVon("")).toBeNull();
        expect(kurzbeschreibungVon(INFOBOX)).toBeNull();
        expect(kurzbeschreibungVon(artikel(""))).toBeNull();
        expect(kurzbeschreibungVon(artikel("{{Thumb|Nur ein Bild.jpg}}\n[[Kategorie:Insekt]]"))).toBeNull();
    });
});

describe("Kurzbeschreibung: reiner Text", () => {
    it("Links werden ihr Anzeigetext, Fett und Kursiv fallen weg, Vorlagen, Einzelnachweise und Kommentare verschwinden", () => {
        const text =
            "Die '''Mondnessel''' (auch ''Nachtkraut'' genannt) wächst im [[Nebelwald (Gebiet)|Nebelwald]] und in [[Auenland]].<ref>Ein Beleg.</ref><ref name=\"a\" /> {{Hinweis|Irgendwas}}<!-- unsichtbar --> Sie blüht im [[Praios]].";
        expect(kurzbeschreibungVon(artikel(text))).toBe(
            "Die Mondnessel (auch Nachtkraut genannt) wächst im Nebelwald und in Auenland. Sie blüht im Praios.",
        );
    });

    it("Bilder und Kategorien mitten im Satz fallen weg, verschachtelte Links in der Bildunterschrift auch", () => {
        const text =
            "Die Mondnessel [[Datei:Bild.png|links|Eine [[Nessel]] im Mond]] wächst überall. [[Kategorie:Insekt]]";
        expect(kurzbeschreibungVon(artikel(text))).toBe("Die Mondnessel wächst überall.");
    });

    it("externe Links zeigen ihren Text, interne Verweise auf andere Wikis das Ziel ohne Vorsilbe, die Strich-Abkürzung das Ziel ohne Zusatz", () => {
        const text =
            "Die Mondnessel erinnert an die [[wpde:Brennnessel|Brennnessel]] und die [[wpde:Taubnessel]], steht auf [http://example.org/nessel dieser Seite] und gleicht der [[Nessel (Pflanze)|]].";
        expect(kurzbeschreibungVon(artikel(text))).toBe(
            "Die Mondnessel erinnert an die Brennnessel und die Taubnessel, steht auf dieser Seite und gleicht der Nessel.",
        );
    });

    it("Zeichenverweise werden aufgelöst, geschützte Leerzeichen und Zeilenumbrüche werden ein Leerzeichen, Tags fallen weg, die Datumsvorlage bleibt Datum", () => {
        const text =
            "Die&nbsp;Mondnessel<br>blüht&nbsp;&amp; <small>verblüht</small> am {{Datum|3|Praios|1000|BF}}.\nSie duftet.";
        expect(kurzbeschreibungVon(artikel(text))).toBe(
            "Die Mondnessel blüht & verblüht am 3. Praios 1000 BF. Sie duftet.",
        );
    });

    it("eine Tabelle und eine Galerie zählen nicht als Text", () => {
        const text = [
            "{|",
            "|-",
            "|Zelle",
            "|}",
            "<gallery>",
            "Datei:A.jpg",
            "</gallery>",
            "",
            "Die Mondnessel ist selten.",
        ].join("\n");
        expect(kurzbeschreibungVon(artikel(text))).toBe("Die Mondnessel ist selten.");
    });
});

describe("Kurzbeschreibung: Zitate und Inhalte von Ulisses fallen weg", () => {
    it("ein Absatz nur aus einer Zitat-Vorlage ergibt keine Kurzbeschreibung, auch wenn danach Text folgt", () => {
        const zitat =
            "{{Zitat\n|Zitat=Ein erfundener Satz, der in einem Buch stünde.\n|Urheber=Niemand\n|Quelle=Nirgends\n}}";
        expect(kurzbeschreibungVon(artikel(`${zitat}\n\nDie Mondnessel ist ein Insekt.`))).toBeNull();
    });

    it("steht ein Satz neben dem Zitat im selben Absatz, bleibt der Satz und das Zitat fällt weg", () => {
        const text =
            "Die Mondnessel ist ein Insekt.\n{{Zitat|Zitat=Ein erfundener Satz, der nicht erscheinen darf.|Urheber=Niemand}}";
        const kurz = kurzbeschreibungVon(artikel(text));
        expect(kurz).toBe("Die Mondnessel ist ein Insekt.");
        expect(kurz).not.toContain("erfundener");
    });

    it.each(["Ingame-Zitat", "Zitatvorlage", "Lizenzzitat", "Klappentext", "Errata", "Hinweis Inhaltsverzeichnis"])(
        "die Vorlage %s gilt als Zitat",
        (name) => {
            expect(
                kurzbeschreibungVon(
                    artikel(`{{${name}|Zitat=Erfundener Wortlaut, der nicht erscheinen darf.|Quelle=Nirgends}}`),
                ),
            ).toBeNull();
        },
    );

    it("ein Blockzitat in HTML gilt als Zitat", () => {
        expect(kurzbeschreibungVon(artikel("<blockquote>Ein erfundener Satz im Blockzitat.</blockquote>"))).toBeNull();
        expect(
            kurzbeschreibungVon(
                artikel("Die Mondnessel ist ein Insekt.<blockquote>Ein erfundener Satz im Blockzitat.</blockquote>"),
            ),
        ).toBe("Die Mondnessel ist ein Insekt.");
    });

    it("ein Absatz, der den Ulisses-Disclaimer nennt, ist Ulisses-Inhalt und fällt ganz weg", () => {
        const text =
            "Ein erfundener Satz, der wie ein Klappentext klingt. ''([[Wiki Aventurica:Ulisses-Disclaimer|Ulisses-Disclaimer]])''";
        expect(kurzbeschreibungVon(artikel(text))).toBeNull();
    });

    it("ein Absatz, der als Ganzes in Anführungszeichen steht, gilt vorsichtshalber als Zitat", () => {
        expect(kurzbeschreibungVon(artikel("„Ein erfundener Satz, der in Anführungszeichen steht.“"))).toBeNull();
        expect(kurzbeschreibungVon(artikel('"Ein erfundener Satz, der in Anführungszeichen steht."'))).toBeNull();
        // Ein Wort in Anführungszeichen mitten im Satz ist kein Zitat.
        expect(
            kurzbeschreibungVon(artikel("Die Mondnessel heißt bei den Fischern „Nachtkraut“ und wächst am Ufer.")),
        ).toBe("Die Mondnessel heißt bei den Fischern „Nachtkraut“ und wächst am Ufer.");
    });
});

describe("Kurzbeschreibung: Platzhalter und Nicht-Beschreibungen", () => {
    it("die Vorlage „Kurzbeschreibung fehlt“ macht aus dem Satzanfang davor keine Kurzbeschreibung", () => {
        expect(kurzbeschreibungVon(artikel("Eine '''Mondnessel''' {{Kurzbeschreibung fehlt}}"))).toBeNull();
        expect(kurzbeschreibungVon(artikel("{{Kurzbeschreibung fehlt}}"))).toBeNull();
    });

    it("ein Satz, der mit „...“ abbricht, ein Satz, der eine Liste einleitet, und weniger als drei Wörter sind keine Kurzbeschreibung", () => {
        expect(kurzbeschreibungVon(artikel("Die Mondnessel, ..."))).toBeNull();
        expect(kurzbeschreibungVon(artikel("Es gibt mehrere Mondnesseln:\n*Silberne\n*Graue"))).toBeNull();
        expect(kurzbeschreibungVon(artikel("Mondnessel."))).toBeNull();
        expect(kurzbeschreibungVon(artikel("Mondnessel ist Kleidung."))).toBe("Mondnessel ist Kleidung.");
    });
});

describe("Kurzbeschreibung: höchstens drei Sätze und 400 Zeichen an einer Satzgrenze", () => {
    it("der vierte Satz fällt weg", () => {
        const text = "Erster Satz hier. Zweiter Satz folgt. Dritter Satz schließt. Vierter Satz fällt weg.";
        expect(kurzbeschreibungVon(artikel(text))).toBe("Erster Satz hier. Zweiter Satz folgt. Dritter Satz schließt.");
        expect(KURZBESCHREIBUNG_MAX_SAETZE).toBe(3);
    });

    it("Fragezeichen und Ausrufezeichen beenden einen Satz, Kürzel, einzelne Buchstaben und Ordnungszahlen nicht", () => {
        expect(saetzeVon("Was ist das? Ein Insekt! Es lebt dort.")).toEqual([
            "Was ist das?",
            "Ein Insekt!",
            "Es lebt dort.",
        ]);
        expect(
            saetzeVon(
                "Sie lebt z. B. im Wald, ca. 5 Schritt über dem Boden, und am 3. Praios beginnt sie zu singen. Danach ruht sie.",
            ),
        ).toEqual([
            "Sie lebt z. B. im Wald, ca. 5 Schritt über dem Boden, und am 3. Praios beginnt sie zu singen.",
            "Danach ruht sie.",
        ]);
        expect(saetzeVon("Sie ist u. a. nachtaktiv, d.h. sie ruht am Tag. Sie singt.")).toEqual([
            "Sie ist u. a. nachtaktiv, d.h. sie ruht am Tag.",
            "Sie singt.",
        ]);
        // Ein Anführungszeichen hinter dem Punkt bleibt am Satz.
        expect(saetzeVon("Man nennt sie „Nachtkraut.“ Sie blüht selten.")).toEqual([
            "Man nennt sie „Nachtkraut.“",
            "Sie blüht selten.",
        ]);
    });

    it("hält die Grenze von 400 Zeichen an einer Satzgrenze, nie mitten im Satz", () => {
        const satz = (n: number): string =>
            `Der ${String(n)}. Satz der Mondnessel ist mit Absicht recht lang geraten, damit er viel Platz in der Beschreibung beansprucht und sie bald die Grenze erreicht.`;
        const text = [satz(1), satz(2), satz(3)].join(" ");
        const kurz = kurzbeschreibungVon(artikel(text));
        expect(kurz).not.toBeNull();
        expect(Array.from(kurz ?? "").length).toBeLessThanOrEqual(KURZBESCHREIBUNG_MAX_ZEICHEN);
        // Zwei volle Sätze passen, der dritte nicht mehr: Der Text endet am Punkt des zweiten.
        expect(kurz).toBe(`${satz(1)} ${satz(2)}`);
    });

    it("ist schon der erste Satz zu lang, wird er am letzten Kommaschnitt (sonst Wort) vor der Grenze gekürzt und trägt „…“", () => {
        const lang = `${"Die Mondnessel wächst in dichten Beständen, ".repeat(12)}und endet erst viel später.`;
        const kurz = kuerzeAufSaetze(lang);
        expect(kurz.endsWith("…")).toBe(true);
        expect(Array.from(kurz).length).toBeLessThanOrEqual(KURZBESCHREIBUNG_MAX_ZEICHEN);
        expect(kurz).not.toMatch(/[,;:]…$/u);
        const ohneKomma = kuerzeAufSaetze(`Die ${"Mondnessel ".repeat(60)}schließt.`);
        expect(ohneKomma.endsWith("…")).toBe(true);
        expect(Array.from(ohneKomma).length).toBeLessThanOrEqual(KURZBESCHREIBUNG_MAX_ZEICHEN);
        expect(ohneKomma).not.toMatch(/ …$/u);
    });
});

describe("Kurzbeschreibung: im Leser der Vorkommen", () => {
    it("leseVorkommen legt die Kurzbeschreibung unter dem Feld kurzbeschreibung ab, neben den übrigen Feldern", () => {
        const ergebnis = leseVorkommen(analysiere("Mondnessel", artikel("Die '''Mondnessel''' ist ein Insekt.")));
        expect(ergebnis.ok).toBe(true);
        if (!ergebnis.ok) return;
        expect(ergebnis.felder["kurzbeschreibung"]).toBe("Die Mondnessel ist ein Insekt.");
        expect(ergebnis.felder["name"]).toBe("Mondnessel");
    });

    it("ohne Kurzbeschreibung fehlt das Feld („das Wiki kennt nichts“), nie ein Leerstring", () => {
        for (const text of [
            "",
            "{{Zitat|Zitat=Erfundener Wortlaut.|Urheber=Niemand}}",
            "Mondnessel {{Kurzbeschreibung fehlt}}",
        ]) {
            const ergebnis = leseVorkommen(analysiere("Mondnessel", artikel(text)));
            expect(ergebnis.ok).toBe(true);
            if (!ergebnis.ok) continue;
            expect("kurzbeschreibung" in ergebnis.felder).toBe(false);
        }
    });
});
