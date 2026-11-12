import { describe, expect, it } from "vitest";
import {
    abweichende,
    aufWikiWert,
    herkunftDerAbschnitte,
    herkunftIm,
    leerFolgtDemWiki,
    mitHerkunft,
    wikiAenderung,
    wikiLage,
    type WikiFelder,
} from "../src/fenster/wiki-feld";

/**
 * Die Zustände des Wiki-Felds (WI-0225, Design Guide §13.8). Problemfälle: ein gleicher Wert gilt als abweichend, weil Leerzeichen oder
 * die Schreibweise einer Zahl anders sind; „das Wiki kennt keinen Wert“ und „unbekannt“ fallen zusammen; ein Wiki-Text ohne Zuordnung
 * wird durchgestrichen und mit ↺ angeboten; ein nur lesendes Feld bekommt ein ↺.
 */
describe("wikiLage", () => {
    it("🔴 weicht ab: Wiki-Wert hinter der Beschriftung, ↺ wach", () => {
        expect(wikiLage({ eigen: "820 (davon 100 Zwerge)", wiki: "820" })).toEqual({
            zustand: "weicht",
            abweichend: true,
            wikiText: "820",
            zurueck: true,
            mitZurueck: true,
        });
    });

    it("gleicher Wert: ↺ still; mit Herkunft wiki heißt er „folgt dem Wiki“", () => {
        expect(wikiLage({ eigen: " Kosch ", wiki: "Kosch" })).toMatchObject({
            zustand: "gleich",
            zurueck: false,
            mitZurueck: true,
        });
        expect(wikiLage({ eigen: "Kosch", wiki: "Kosch", herkunft: "wiki" })).toMatchObject({ zustand: "folgt" });
        expect(wikiLage({ eigen: "Kosch", wiki: "Kosch", herkunft: "manual" })).toMatchObject({ zustand: "gleich" });
        expect(wikiLage({ eigen: "Kosch", wiki: "Kosch" }).wikiText).toBeUndefined();
    });

    it("🔴 null heißt: das Wiki kennt keinen Wert; ein eigener Wert weicht dann ab und ↺ leert", () => {
        expect(wikiLage({ eigen: "", wiki: null })).toMatchObject({ zustand: "gleich", zurueck: false });
        expect(wikiLage({ eigen: null, wiki: null })).toMatchObject({ zustand: "gleich" });
        expect(wikiLage({ eigen: "Graf Jallik", wiki: null })).toEqual({
            zustand: "weicht",
            abweichend: true,
            wikiText: null,
            zurueck: true,
            mitZurueck: true,
        });
    });

    it("🔴 undefined heißt unbekannt: kein Durchstreichen, kein ↺, nicht dasselbe wie null", () => {
        expect(wikiLage({ eigen: "Graf Jallik", wiki: undefined })).toEqual({
            zustand: "unbekannt",
            abweichend: false,
            zurueck: false,
            mitZurueck: false,
        });
    });

    it("ein Feld ohne Gegenstück im Wiki: kein ↺, die Spalte bleibt", () => {
        expect(wikiLage({ eigen: "x", wiki: "y", mitWiki: false })).toMatchObject({
            zustand: "ohne",
            mitZurueck: false,
        });
    });

    it("Zahlen werden in der Schreibweise des Felds verglichen", () => {
        const formatiere = (wert: string | number): string =>
            typeof wert === "number" ? wert.toLocaleString("de-DE") : wert;
        expect(wikiLage({ eigen: "1.200", wiki: 1200, formatiere })).toMatchObject({ zustand: "gleich" });
        expect(wikiLage({ eigen: "1.300", wiki: 1200, formatiere })).toMatchObject({
            zustand: "weicht",
            wikiText: "1.200",
        });
    });

    it("🔴 abgebildete Felder: verglichen wird der zugeordnete Schlüssel; ohne Zuordnung kursiv mit ↺ still", () => {
        const zuordnung = (text: string): string | undefined =>
            ({ Kronstraße: "Reichsstrasse", Straße: "Strasse" })[text];
        expect(wikiLage({ eigen: "Reichsstrasse", wiki: "Kronstraße", zuordnung })).toMatchObject({
            zustand: "gleich",
        });
        expect(wikiLage({ eigen: "Weg", wiki: "Straße", zuordnung })).toMatchObject({
            zustand: "weicht",
            wikiText: "Straße",
            zurueck: true,
        });
        expect(wikiLage({ eigen: "Weg", wiki: "Straße, Pass", zuordnung })).toEqual({
            zustand: "unzugeordnet",
            abweichend: false,
            wikiText: "Straße, Pass",
            zurueck: false,
            mitZurueck: true,
        });
    });

    it("🔴 nur lesend: nie ein ↺; bei Abweichung bleibt der Wiki-Wert als Auskunft", () => {
        expect(wikiLage({ eigen: "a", wiki: "b", lesend: true })).toEqual({
            zustand: "lesend",
            abweichend: true,
            wikiText: "b",
            zurueck: false,
            mitZurueck: false,
        });
        expect(wikiLage({ eigen: "b", wiki: "b", lesend: true })).toMatchObject({
            zustand: "lesend",
            mitZurueck: false,
        });
    });

    it("„↺ Alles auf Wiki-Werte (n)“ zählt nur Felder mit wachem ↺", () => {
        const lagen = [
            wikiLage({ eigen: "a", wiki: "b" }),
            wikiLage({ eigen: "b", wiki: "b" }),
            wikiLage({ eigen: "a", wiki: "b", lesend: true }),
            wikiLage({ eigen: "a", wiki: undefined }),
            wikiLage({ eigen: "x", wiki: null }),
        ];
        expect(abweichende(lagen)).toBe(2);
    });
});

/**
 * Die Herkunft im EINEN Entwurf (Modell c, `WikiFelder`). Problemfälle: ↺ setzt den Wert, aber nicht die Herkunft (dann schreibt „Fertig“
 * den Wert statt `{ revert: "wiki" }`); Tippen nach ↺ bleibt wiki; ↺ auf einem Feld ohne Zuordnung oder mit unbekanntem Wiki-Wert
 * ändert doch etwas; ein abgebildetes Feld bekommt den Wiki-Text statt unseres Schlüssels.
 */
describe("WikiFelder: Herkunft im Entwurf", () => {
    interface Weg extends WikiFelder {
        readonly name: string;
        readonly subtype: string;
    }
    const weg: Weg = {
        name: "Grevensteig",
        subtype: "Pfad",
        wiki: {
            key: "wiki:Grevensteig",
            url: "https://de.wiki-aventurica.de/wiki/Grevensteig",
            name: "Grevensteig",
            werte: { name: "Grevensteig (Weg)", subtype: "Kronstraße", art: "Straße, Pass" },
        },
        herkunft: { subtype: "manual" },
    };
    const wegtyp = (text: string): string | undefined => (text === "Kronstraße" ? "Reichsstrasse" : undefined);

    it('🔴 ↺ setzt Wert UND Herkunft wiki, „Fertig“ schreibt { revert: "wiki" }', () => {
        const neu = aufWikiWert(weg, "name");
        expect(neu.name).toBe("Grevensteig (Weg)");
        expect(herkunftIm(neu, "name")).toBe("wiki");
        expect(herkunftIm(neu, "subtype")).toBe("manual");
        expect(wikiAenderung(neu, "name")).toEqual({ revert: "wiki" });
        expect(weg.name).toBe("Grevensteig");
    });

    it("🔴 Tippen nach ↺ ist manual und schreibt den Wert, auch beim Wortlaut des Wiki", () => {
        const getippt = mitHerkunft(aufWikiWert(weg, "name"), "name", "Grevensteig (Weg)", "manual");
        expect(herkunftIm(getippt, "name")).toBe("manual");
        expect(wikiAenderung(getippt, "name")).toEqual({ value: "Grevensteig (Weg)" });
    });

    it("ein abgebildetes Feld bekommt unseren Schlüssel; ohne Zuordnung, ohne Artikel oder unbekannt bleibt alles", () => {
        expect(aufWikiWert(weg, "subtype", wegtyp)).toMatchObject({
            subtype: "Reichsstrasse",
            herkunft: { subtype: "wiki" },
        });
        expect(aufWikiWert(weg, "art", wegtyp)).toBe(weg);
        expect(aufWikiWert(weg, "lage")).toBe(weg);
        expect(aufWikiWert({ ...weg, wiki: null }, "name")).toEqual({ ...weg, wiki: null });
    });

    it("das Wiki kennt keinen Wert: ↺ leert das Feld", () => {
        const ohne = { ...weg, wiki: { ...weg.wiki!, werte: { name: null } } };
        expect(aufWikiWert(ohne, "name")).toMatchObject({ name: null, herkunft: { name: "wiki" } });
    });

    it("ohne Vermerk schreibt „Fertig“ den Wert, und wikiLage zeigt bei gleichem Wert „gleich“", () => {
        expect(herkunftIm(weg, "name")).toBeUndefined();
        expect(wikiAenderung(weg, "name")).toEqual({ value: "Grevensteig" });
        const folgt = aufWikiWert(weg, "name");
        expect(
            wikiLage({ eigen: folgt.name, wiki: "Grevensteig (Weg)", herkunft: herkunftIm(folgt, "name") }).zustand,
        ).toBe("folgt");
    });
});

describe("Abschnitte und „leer folgt dem Wiki“ (Orchestrierung 2026-10-18)", () => {
    it("🔴 eine Linie folgt dem Wiki nur, wenn alle Abschnitte wiki tragen; ein getippter macht sie manual", () => {
        expect(herkunftDerAbschnitte(["wiki", "wiki", "wiki"])).toBe("wiki");
        expect(herkunftDerAbschnitte(["wiki", undefined, "wiki"])).toBeUndefined();
        expect(herkunftDerAbschnitte(["wiki", "manual"])).toBe("manual");
        expect(herkunftDerAbschnitte([])).toBeUndefined();
    });

    it("🔴 Beschreibung der Kraftlinie leer: der Entwurf führt den Wiki-Wert, das Feld zeigt „folgt“, nicht „weicht ab“", () => {
        const wiki = "Eine der sieben Linien des Hexagramms.";
        const leer = leerFolgtDemWiki<string>(null, wiki, undefined);
        expect(leer).toEqual({ wert: wiki, herkunft: "wiki" });
        expect(wikiLage({ eigen: leer.wert, wiki, herkunft: leer.herkunft }).zustand).toBe("folgt");
        // Ohne die Ausnahme (Modell c wörtlich) stünde hier „weicht ab“: an allen 18 Linien mit Wiki-Beschreibung.
        expect(wikiLage({ eigen: null, wiki }).zustand).toBe("weicht");
        // Ein eigener Wert bleibt, wie er ist; ohne Wiki-Wert bleibt das Feld leer und ohne Vermerk.
        expect(leerFolgtDemWiki("eigen", wiki, "manual")).toEqual({ wert: "eigen", herkunft: "manual" });
        expect(leerFolgtDemWiki<string>(null, null, undefined)).toEqual({ wert: null, herkunft: undefined });
    });
});
