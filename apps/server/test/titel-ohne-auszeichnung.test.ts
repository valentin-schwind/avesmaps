import { describe, expect, it } from "vitest";
import { leseProdukt } from "../src/wiki/infobox/literatur.ts";
import { leseProduktseite, quellenTitelBereinigt } from "../src/wiki/infobox/publikationen.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import { titelOhneAuszeichnung } from "../src/wiki/infobox/text.ts";

/**
 * Titel von Quellen und Werken tragen keine Auszeichnung. Die Beispiele stehen so in Production (gelesen 2026-11-07): Besucher sahen in der Kartensammlung und im Fenster
 * „Quellen“ wörtlich „Landkartenset <br />Das Dornenreich“, denn die Oberfläche zeigt Titel als Text. Die Anschlüsse von Import und Editor prüfen `sources.test.ts`,
 * `literature.test.ts`, `inhalte-quellen.test.ts` und `inhalte-literatur.test.ts`.
 */

const werk = (titel: string, seite = "Seitentitel"): string | undefined => {
    const text = `{{Infobox Produkt\n|Titel=${titel}\n|Art=Gruppenabenteuer\n|Ort=[[Gareth]]\n}}`;
    const ergebnis = leseProdukt(analysiere(seite, text));
    return ergebnis.ok ? ergebnis.felder["title"] : undefined;
};

describe("titelOhneAuszeichnung", () => {
    it.each([
        ["Landkartenset <br />Das Dornenreich", "Landkartenset Das Dornenreich"],
        ["Landkartenset <br />Der Wolfsfrost", "Landkartenset Der Wolfsfrost"],
        ["Der Scharlatan<br>Die Gabe der Amazonen", "Der Scharlatan Die Gabe der Amazonen"],
        ["Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens", "Der Zug durch das Nebelmoor Die Sümpfe des Lebens"],
        ["A<BR >B", "A B"],
        ['A<br clear="all">B', "A B"],
        ["<br />Rand<br />", "Rand"],
        ["Klein<small>(Neuauflage)</small>", "Klein(Neuauflage)"],
        ['Ein <span class="x">Band</span>', "Ein Band"],
        ["[[Das Geisterschiff (Szenario)|Das Geisterschiff]]", "Das Geisterschiff"],
        ["[[Havena]]", "Havena"],
        ["'''Fett''' und ''kursiv''", "Fett und kursiv"],
    ])("%s wird %s", (roh, sauber) => {
        expect(titelOhneAuszeichnung(roh)).toBe(sauber);
    });

    it.each(["Band <1> bleibt", "A < B und C > D", "Tom &amp; Jerry", "Der  Fall", " am Rand "])(
        "🔴 %s ist keine Auszeichnung und bleibt Zeichen für Zeichen",
        (titel) => {
            expect(titelOhneAuszeichnung(titel)).toBe(titel);
        },
    );

    it("nur Auszeichnung ergibt einen leeren Titel: Der Aufrufer entscheidet, was dann gilt", () => {
        expect(titelOhneAuszeichnung("<br />")).toBe("");
    });
});

describe("🔴 Regression: neue WikiSync-Läufe schreiben keine Auszeichnung in einen Titel", () => {
    it("Werke: der Titel aus {{Infobox Produkt}}", () => {
        expect(werk("Der Zug durch das Nebelmoor<br>Die Sümpfe des Lebens")).toBe(
            "Der Zug durch das Nebelmoor Die Sümpfe des Lebens",
        );
        expect(werk("[[Das Geisterschiff (Szenario)|Das Geisterschiff]]")).toBe("Das Geisterschiff");
        expect(werk("Band <1>")).toBe("Band <1>");
    });

    it("Werke: Bleibt vom Titel nichts, gilt wie bei einem leeren der Seitentitel", () => {
        expect(werk("<br />", "DSK:Das Werk")).toBe("DSK:Das Werk");
        expect(werk("", "DSK:Das Werk")).toBe("DSK:Das Werk");
    });

    it("Quellen: der Titel einer Produktseite und der Reiniger", () => {
        expect(quellenTitelBereinigt("Landkartenset <br />Das Dornenreich")).toBe("Landkartenset Das Dornenreich");
        const seite = leseProduktseite("Das Set", "{{Infobox Produkt\n|Titel=Landkartenset <br />Der Wolfsfrost\n}}");
        expect(seite?.titel).toBe("Landkartenset Der Wolfsfrost");
    });
});
