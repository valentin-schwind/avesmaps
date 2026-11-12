import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extrahiereInfoboxBlock, infoboxName, leseParameter, normalisiereFelder } from "../src/wiki/infobox/block.ts";
import { ersterAbsatz, verlaufsstationen } from "../src/wiki/infobox/beschreibung.ts";
import { leseZugehoerigkeit, zeitangaben } from "../src/wiki/infobox/gebiet.ts";
import {
    BEREICH_FELDER,
    entitaetDerSeite,
    klassifiziere,
    leseSeitenFelder,
    type Entitaet,
    type WikiBereich,
} from "../src/wiki/infobox/lesen.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import { bereinige, entferneTags, entschluesseleHtml, schluesselform } from "../src/wiki/infobox/text.ts";

/**
 * Die Infobox-Leser des WikiSync (WI-0253 C) gegen Legacy.
 *
 * - **Soll (Parität):** Für jede Seite der Fixture liefert der Leser genau die Felder, die Legacys Parser (Mirror a7f2dac86, die echte PHP-Funktion
 *   `avesmapsWikiDumpParse…Page`) für sie speichert. Die Erwartung stammt allein vom Orakel (`scripts/dev/wiki-parser-orakel.php`), nie von Hand:
 *   Auszüge aus Legacys Tests und Fixtures (Basiliuslinie, mini-dump.xml, Verlaufsfälle der Wege, Arten der Landschaften, Linkziele) und 60 zufällig
 *   zusammengesetzte Infoboxen für Gebiete, Wege, Landschaften und Kraftlinien. Dieselben Leser gegen weitere 1.500 Bereinigungen und 1.200 Seiten
 *   fuzz-geprüft (Entwicklung, ohne Fixture).
 * - **Problemfälle:** Entitäten und Auszeichnung, Kommentare und Einzelnachweise, Datumsvorlagen, `strip_tags` mit offenem `<`, mehrzeilige Vorlagen als Wert,
 *   ein Parameter in der ersten Zeile des Kastens, doppelte Parameter, Unicode-Leerraum.
 * - **Gewollte Abweichungen von Legacy** (je ein eigener Fall unten): Eine Infobox ohne schließende Klammer ist ein Befund statt eines geratenen Werts;
 *   `Infobox Landschaft` ergibt wie in Legacy keinen Artikel einer Landschaft.
 */

interface OrakelFall {
    id: string;
    titel: string;
    ns: number;
    text: string;
    legacyArt: string;
    erwartet: Partial<Record<WikiBereich, Record<string, string> | unknown[] | null>>;
}

const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/wiki-infobox-orakel.json", import.meta.url)), "utf8"),
) as { faelle: OrakelFall[] };

const ARTEN_LEGACY: Readonly<Record<string, Entitaet>> = {
    path: "weg",
    region: "region",
    settlement: "ort",
    building: "bauwerk",
    territory: "gebiet",
    powerline: "kraftlinie",
    "": "",
};

describe("Parität mit dem Legacy-Parser (Orakel)", () => {
    it("die Fixture ist nicht leer und deckt alle Arten ab", () => {
        expect(fixture.faelle.length).toBeGreaterThan(100);
        const arten = new Set(fixture.faelle.map((fall) => fall.legacyArt));
        for (const art of ["path", "region", "settlement", "building", "territory", "powerline"])
            expect(arten.has(art), art).toBe(true);
    });

    it("🔴 jede Seite: die Art wie Legacys Klassifikator, die Felder wie Legacys Datensatz – Feld für Feld", () => {
        let geprueft = 0;
        for (const fall of fixture.faelle) {
            const seite = analysiere(fall.titel, fall.text);
            if (fall.ns === 0) {
                expect(entitaetDerSeite(seite), `${fall.id}: Art`).toBe(ARTEN_LEGACY[fall.legacyArt]);
            }
            for (const [bereich, erwartet] of Object.entries(fall.erwartet) as [
                WikiBereich,
                Record<string, string> | unknown[] | null,
            ][]) {
                const ergebnis = leseSeitenFelder(bereich, seite);
                if (erwartet === null) {
                    expect(ergebnis.ok, `${fall.id} [${bereich}]: Legacy liefert keinen Datensatz`).toBe(false);
                    continue;
                }
                const felder = Array.isArray(erwartet) ? {} : erwartet;
                expect(ergebnis.ok, `${fall.id} [${bereich}]: ${ergebnis.ok ? "" : ergebnis.grund}`).toBe(true);
                if (!ergebnis.ok) continue;
                expect(ergebnis.felder, `${fall.id} [${bereich}]`).toEqual(felder);
                geprueft += Object.keys(felder).length;
                for (const name of Object.keys(ergebnis.felder))
                    expect(BEREICH_FELDER[bereich], `${fall.id}: ${name}`).toContain(name);
            }
        }
        // Die Zahl der geprüften Felder soll nur wachsen: Fällt sie, hat jemand Fälle entfernt.
        expect(geprueft).toBeGreaterThan(650);
    });
});

describe("gewollte Abweichungen von Legacy", () => {
    it("🔴 eine Infobox ohne schließende Klammer ist ein Befund (Legacy rät den Rest des Textes als Wert)", () => {
        const seite = analysiere("Kaputt", "{{Infobox Siedlung\n|Name=Kaputt\n|Einwohner=10\nText ohne Ende");
        expect(seite.block.geschlossen).toBe(false);
        expect(leseSeitenFelder("ort", seite)).toEqual({ ok: false, grund: "nicht_geschlossen", infobox: "Siedlung" });
        // Der geschlossene Kasten desselben Textes liest sich.
        const heil = analysiere("Heil", "{{Infobox Siedlung\n|Name=Heil\n|Einwohner=10\n}}\nText.");
        expect(leseSeitenFelder("ort", heil)).toMatchObject({ ok: true, felder: { name: "Heil", einwohner: "10" } });
    });

    it("🔴 {{Infobox Landschaft}} ist für Legacy eine Landschaft und ergibt doch nie einen Datensatz: auch hier kein Artikel", () => {
        const seite = analysiere(
            "Windhag",
            "{{Infobox Landschaft\n| Name = Windhag\n| Art = Wald\n}}\nDer Windhag ist ein Wald.",
        );
        expect(entitaetDerSeite(seite)).toBe("region");
        expect(leseSeitenFelder("region", seite)).toEqual({
            ok: false,
            grund: "fremde_infobox",
            infobox: "Landschaft",
        });
        expect(leseSeitenFelder("gipfel", seite).ok).toBe(false);
    });

    it("eine Seite der falschen Art ist kein Artikel dieses Bereichs; ohne Infobox und ohne Namen ebenso", () => {
        const staat = analysiere("Kosch", "{{Infobox Staat\n|Name=Kosch\n}}\nText.");
        expect(leseSeitenFelder("ort", staat)).toMatchObject({ ok: false, grund: "fremde_infobox" });
        expect(leseSeitenFelder("weg", staat)).toMatchObject({ ok: false, grund: "fremde_infobox" });
        expect(leseSeitenFelder("gebiet", staat)).toMatchObject({ ok: true });
        expect(leseSeitenFelder("ort", analysiere("Prosa", "Nur Text, keine Infobox."))).toEqual({
            ok: false,
            grund: "keine_infobox",
            infobox: "",
        });
        // Eine reine Siedlung ist kein Herrschaftsgebiet (Legacy: „reine Siedlung“).
        const dorf = analysiere("Nivesel", "{{Infobox Siedlung\n|Name=Nivesel\n|Staat=[[Mittelreich]]\n}}\nText.");
        expect(leseSeitenFelder("gebiet", dorf)).toMatchObject({ ok: false, grund: "reine_siedlung" });
        // Ein Gebiet ist eine Stadt, wenn sie Reichsstadt, Freie Stadt oder eigenständig ist.
        const freie = analysiere("Fall", "{{Infobox Siedlung\n|Name=Fall\n|Staat=[[Freie Stadt]]\n}}\nText.");
        expect(leseSeitenFelder("gebiet", freie)).toMatchObject({ ok: true });
    });

    it("die Wadi-Ausnahme: ein Wasserlauf mit Landform-Art ist eine Landschaft, kein Weg", () => {
        const seite = analysiere(
            "Wadi Rashid",
            "{{Infobox Fluss\n|Name=Wadi Rashid\n|Art=[[Wadi]]\n|Regionen=[[Khôm]]\n}}\nText.",
        );
        expect(entitaetDerSeite(seite)).toBe("region");
        expect(leseSeitenFelder("weg", seite)).toMatchObject({ ok: false, grund: "fremde_infobox" });
        expect(leseSeitenFelder("region", seite)).toMatchObject({
            ok: true,
            felder: { name: "Wadi Rashid", region_parent: "Khôm", art: "Wadi" },
        });
    });
});

describe("Klassifikator (nur über den Infobox-Namen, nie über Kategorien)", () => {
    it.each([
        ["Kraftlinie", "kraftlinie"],
        ["Straße", "weg"],
        ["Fluss", "weg"],
        ["Staat", "gebiet"],
        ["Herrschaftsgebiet", "gebiet"],
        ["Bauwerk", "bauwerk"],
        ["Festung", "bauwerk"],
        ["Lehreinrichtung", "bauwerk"],
        ["Geschäft", "bauwerk"],
        ["Siedlung", "ort"],
        ["Region", "region"],
        ["Landschaft", "region"],
        ["Ilaris Vorteil", "ort"], // 💣 'ilarisvorteil' enthält 'ort': Deshalb liest der Abgleich nur die Räume der Tafel (264 Dörfer im Septemberdump).
        ["Gerät", ""],
    ])("%s -> %s", (infobox, erwartet) => {
        expect(klassifiziere(schluesselform(infobox))).toBe(erwartet);
    });
});

describe("Bausteine: Block, Parameter, Schlüsselform", () => {
    it("die Schlüsselform faltet Umlaute und Akzente und streicht alles außer a–z und 0–9", () => {
        expect(schluesselform("Länge")).toBe("lange");
        expect(schluesselform(" Stärke ")).toBe("starke");
        expect(schluesselform("Währung (alt)")).toBe("wahrungalt");
        expect(schluesselform("Straße")).toBe("strasse");
        expect(schluesselform("Géographie")).toBe("geographie");
    });

    it("der Block ist genau der Kasten der ersten Infobox, nicht eine Wartungsvorlage davor", () => {
        const text =
            "{{Spoiler|[[X]]}}\n{{Infobox Siedlung\n|Name=A\n|Verlauf={{Straße|[[B]]}}\n}}\nDanach {{Infobox Staat}}";
        const { block, geschlossen } = extrahiereInfoboxBlock(text);
        expect(block).toBe("{{Infobox Siedlung\n|Name=A\n|Verlauf={{Straße|[[B]]}}\n}}");
        expect(geschlossen).toBe(true);
        expect(infoboxName(text)).toBe("Siedlung");
        expect(infoboxName("kein Kasten")).toBe("");
        expect(extrahiereInfoboxBlock("kein Kasten")).toEqual({ block: "", geschlossen: false, anfang: -1 });
    });

    it("🪤 ein Parameter in der ERSTEN Zeile fehlt, wie in Legacy; ein Strich in einer verschachtelten Vorlage zerschneidet nichts", () => {
        const parameter = leseParameter(
            "{{Infobox Siedlung|Name=Erste\n|Einwohner=5\n|Tempel=\n{{Liste\n|[[A]]\n|[[B]]\n}}\n|Handelszone=Test\n}}",
        );
        expect([...parameter.keys()]).toEqual(["Einwohner", "Tempel", "Handelszone"]);
        expect(parameter.get("Tempel")).toBe("\n{{Liste\n|[[A]]\n|[[B]]\n}}");
    });

    it("bei zwei Parametern gleicher Schlüsselform gewinnt der erste; der erste Schlüssel mit Inhalt zählt", () => {
        const norm = normalisiereFelder(leseParameter("{{Infobox X\n|Länge=\n|Lange=5 Meilen\n|lange=7\n}}"));
        expect(norm.get("lange")).toBe("");
        const seite = analysiere("X", "{{Infobox Straße\n|Name=X\n|Länge=\n|Lenge=5 Meilen\n}}");
        expect(leseSeitenFelder("weg", seite)).toMatchObject({ ok: true, felder: { laenge: "5 Meilen" } });
    });
});

describe("Bereinigung eines Infobox-Werts (Legacy avesmapsWikiSyncCleanPoliticalTerritoryWikiValue)", () => {
    it.each([
        ["[[Ziel|Anzeige]], [[Nur Ziel]]", "Anzeige, Nur Ziel"],
        ["{{Pol|[[Mittelreich]]}}", "Mittelreich"],
        ["{{Reichsstadt|ex|Mittelreich}}", "ex|Mittelreich"],
        ["{{ohne Strich}}", ""],
        ["{{a|{{b|c}}}} Rest", "Rest"],
        ['Text<ref name="x">Beleg</ref> mehr<!-- weg -->', "Text mehr"],
        ["A<br>B<br/>C<br />D", "A B C D"],
        ["'''fett''' und ''kursiv''", "fett und kursiv"],
        ["[[Datei:Bild.png|mini]]Text[[File:X.png]]", "Text"],
        ["{{Datum|1|Praios|1012}}", "1 Praios 1012"],
        ["{{Datum|1|Praios|1012|BF}}", "1. Praios 1012 BF"],
        ["a&nbsp;&amp;&nbsp;b &auml;&ouml; &#65;&#x42; &unbekannt;", "a & b äö AB &unbekannt"],
        ["  1 000 Seelen ", "1 000 Seelen"],
        [";, Rand, ;", "Rand"],
        ["a < b", "a < b"],
        ["a <b offen", "a"],
        ["<<b>x</b>y", ""],
        ["Ende<", "Ende"],
    ])("%j -> %j", (roh, erwartet) => {
        expect(bereinige(roh)).toBe(erwartet);
    });

    it("strip_tags und Zeichenverweise einzeln", () => {
        expect(entferneTags("a<b>fett</b>c")).toBe("afettc");
        expect(entferneTags('x<span style="a>b">y</span>z')).toBe("xyz");
        expect(entferneTags("1 < 2 > 0")).toBe("1 < 2 > 0");
        expect(entschluesseleHtml("&lt;&gt;&amp;&quot;&apos;&szlig;&euro;&#0;&#1114112;")).toBe(
            "<>&\"'ß€&#0;&#1114112;",
        );
    });
});

describe("Kurzbeschreibung und Verlauf", () => {
    it("der erste Prosa-Absatz nach dem Kasten, ohne Vorlagen- und Listenzeilen davor, höchstens 1.200 Zeichen", () => {
        const text =
            "{{Infobox Siedlung\n|Name=A\n}}\n{{Spoiler|x}}\n[[Datei:X.png]]\n\n'''A''' ist ein [[Ort]].<ref>Beleg</ref>\n\nZweiter Absatz.";
        expect(ersterAbsatz(text, extrahiereInfoboxBlock(text))).toBe("A ist ein Ort.");
        const lang = `{{Infobox Siedlung\n|Name=A\n}}\n${"Wort ".repeat(500)}`;
        expect(Array.from(ersterAbsatz(lang, extrahiereInfoboxBlock(lang))).length).toBeLessThanOrEqual(1200);
        expect(ersterAbsatz("Nur Text.", extrahiereInfoboxBlock("Nur Text."))).toBe("Nur Text.");
    });

    it("🔴 die Stationen der Wege stammen aus Legacys eigenem Test (tools/paths/test-path-verlauf-parser.php)", () => {
        const strasse = [
            "{{Anschluss|[[Phecadistieg]]}}",
            "{{Straße|[[Elenvina]]}}",
            "{{Abzweigung rechts|[[Zinnen am Ratsforst]]|[[Schattengrundpass]]|Zwei=j}}",
            "{{Abzweigung links|[[Klippag]]|Weg nach [[Altenfurt]]}}",
            "{{Abzweigung links| |Weg nach Osten}}",
            "{{Flussquerung|[[Rodasch]]}}",
            "{{Kreuzung|[[Honingen]]|Straßen nach [[Herzogenfurt]] und [[Winhall]]|Zwei=j}}",
            "{{Straße|[[Lyngwyn (Honingen)|Lyngwyn]]}}",
            "{{Pass|[[Greifenpass]]}}",
            "{{Hafen|[[Perricum]]|[[Perlenmeer]]}}",
        ].join("\n");
        expect(verlaufsstationen(strasse)).toEqual([
            "Elenvina",
            "Zinnen am Ratsforst",
            "Klippag",
            "Honingen",
            "Lyngwyn",
            "Greifenpass",
            "Perricum",
        ]);
        const fluss = [
            "{{Zusammenfluss|[[Ange]] und [[Breite]]}}",
            "{{Fluss|[[Oberangbar]]}}",
            "{{Straßenquerung|[[Reichsstraße 3]]|[[Steinbrücken]]}}",
            "{{Zufluss rechts|[[Raller]]}}",
            "{{Zufluss links|[[Hils]]}}",
            "{{Fluss|''[[Burg Draustein]]''}}",
            "{{Fluss|Feste [[Calbrozim]]}}",
            "{{Flussmündung|[[Meer der Sieben Winde]]|[[Havena (Siedlung)|Havena]]}}",
        ].join("\n");
        expect(verlaufsstationen(fluss)).toEqual([
            "Oberangbar",
            "Steinbrücken",
            "Burg Draustein",
            "Calbrozim",
            "Havena",
        ]);
        // Ohne Vorlagen zählt jeder Link der Reihe nach; Dateien und Kategorien sind keine Stationen.
        expect(
            verlaufsstationen(
                "von [[Kosch]] über [[Angbar]] und [[Datei:Bild.png]] weiter [[Kategorie:Fluss]] [[Ferdok]]",
            ),
        ).toEqual(["Kosch", "Angbar", "Ferdok"]);
    });
});

describe("Herrschaftsgebiet: Zugehörigkeit, Zeit, Kontinent", () => {
    it("die Zugehörigkeit: die erste Klausel, die kein Qualifizierer ist, ist die Kette; Ansprüche anderer sind keine Kette", () => {
        expect(leseZugehoerigkeit("[[Grafschaft Ferdok]]: [[Mittelreich]]")).toMatchObject({
            pfad: ["Grafschaft Ferdok", "Mittelreich"],
            unabhaengig: false,
        });
        expect(leseZugehoerigkeit("(beansprucht von: [[Horasreich]], [[Mittelreich]])")).toMatchObject({
            pfad: [],
            unabhaengig: true,
        });
        expect(leseZugehoerigkeit("umstritten; [[Mittelreich]]")).toMatchObject({ pfad: ["Mittelreich"] });
        expect(leseZugehoerigkeit("Almada (beansprucht von Horasreich); sowie [[Kalifat]]")).toMatchObject({
            pfad: ["Almada"],
        });
        expect(leseZugehoerigkeit("")).toEqual({ roh: "", pfad: [], unabhaengig: false });
    });

    it("Gründung und Auflösung wie Legacys Staging: ohne Gründung „0 BF“, ohne Auflösung „besteht“, BF-Vorlagen als Jahr", () => {
        expect(zeitangaben("", "")).toEqual({ gruendung: "0 BF", aufloesung: "besteht" });
        expect(zeitangaben("{{BF|1050}}", "bis heute")).toEqual({ gruendung: "1050 BF", aufloesung: "bis heute" });
        expect(zeitangaben("{{BF|-870}}", "{{Datum|1012|Praios|1}}")).toEqual({
            gruendung: "870 v. BF",
            aufloesung: "1012 BF",
        });
        expect(zeitangaben("12. Praios 1000 BF", "")).toEqual({
            gruendung: "12. Praios 1000 BF",
            aufloesung: "besteht",
        });
    });

    it("🔴 der Kontinent eines Gebiets ist KEIN Feld des Abgleichs: Legacys hybrider Lauf nimmt ihn aus den Kategorien (C-2), aus dem Text wäre er eine Vermutung", () => {
        const seite = analysiere(
            "Rastanreich",
            "{{Infobox Staat\n|Name=Rastanreich\n|Kontinent=Myranor\n|Region=Rastabor\n}}\n{{Nav Staaten Myranor}}",
        );
        const ergebnis = leseSeitenFelder("gebiet", seite);
        expect(ergebnis.ok && "continent" in ergebnis.felder).toBe(false);
        expect(BEREICH_FELDER.gebiet).not.toContain("continent");
    });
});
