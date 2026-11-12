import { describe, expect, it } from "vitest";
import { istVerweisZiel, zerlegeBloecke, zerlegeText } from "../src/fenster/fenster-text.ts";
import { vorgabeEckeKlasse } from "../src/fenster/fenster-lage.ts";
import { begrenzeVersatz, MIN_SICHTBAR_X, MIN_SICHTBAR_Y } from "../src/fenster/fenster-ziehen.ts";

/**
 * Die Bausteine der Fensterhülle ohne Browser (WI-0045): die Auszeichnung der Erklärtexte und die
 * Begrenzung beim Verschieben. Wie sie im Fenster aussehen und sich bedienen, prüft `e2e/fenster.spec.ts`.
 */

describe("Fließtext mit Auszeichnung - aus der Sprachtafel, nie als HTML", () => {
    it("kursiv, betont und Verweis werden Teile, der Rest bleibt Text", () => {
        expect(
            zerlegeText("Tempo *und* **Wegtyp**, siehe [Naismith](https://en.wikipedia.org/wiki/Naismith%27s_rule)."),
        ).toEqual([
            { art: "text", text: "Tempo " },
            { art: "kursiv", text: "und" },
            { art: "text", text: " " },
            { art: "betont", text: "Wegtyp" },
            { art: "text", text: ", siehe " },
            { art: "verweis", text: "Naismith", ziel: "https://en.wikipedia.org/wiki/Naismith%27s_rule" },
            { art: "text", text: "." },
        ]);
    });

    it("🔴 HTML in der Tafel bleibt Text - es wird nie Markup", () => {
        expect(zerlegeText("<b>Rast.</b> <script>x()</script>")).toEqual([
            { art: "text", text: "<b>Rast.</b> <script>x()</script>" },
        ]);
    });

    it("🔴 ein Verweis ohne http(s) bleibt Text - kein `javascript:` im href", () => {
        expect(zerlegeText("[klick](javascript:alert(1))")).toEqual([
            { art: "text", text: "[klick](javascript:alert(1))" },
        ]);
    });

    it("🔴 `FensterVerweis` setzt ein `href` nur für http(s) - auch wenn das Ziel aus den Daten kommt", () => {
        expect(istVerweisZiel("https://ulisses-spiele.de/fan-richtlinie/")).toBe(true);
        expect(istVerweisZiel("http://example.org")).toBe(true);
        expect(istVerweisZiel("javascript:alert(1)")).toBe(false);
        expect(istVerweisZiel("https://a b")).toBe(false);
        expect(istVerweisZiel("")).toBe(false);
    });

    it("ein einzelner Stern und leerer Text bleiben, was sie sind", () => {
        expect(zerlegeText("5 * 3 Meilen")).toEqual([{ art: "text", text: "5 * 3 Meilen" }]);
        expect(zerlegeText("")).toEqual([]);
    });
});

describe("Absätze und Aufzählungen (WI-0076: weniger Textwand)", () => {
    it("`- ` am Zeilenanfang wird ein Punkt, eine Leerzeile trennt Absätze, Auszeichnung gilt im Punkt", () => {
        expect(zerlegeBloecke("Er fährt nur:\n- im **Winter**,\n- über der Schneegrenze.\n\nSonst nicht.")).toEqual([
            { art: "absatz", teile: [{ art: "text", text: "Er fährt nur:" }] },
            {
                art: "liste",
                punkte: [
                    [
                        { art: "text", text: "im " },
                        { art: "betont", text: "Winter" },
                        { art: "text", text: "," },
                    ],
                    [{ art: "text", text: "über der Schneegrenze." }],
                ],
            },
            { art: "absatz", teile: [{ art: "text", text: "Sonst nicht." }] },
        ]);
    });

    it("ein Text ohne Zeilenumbruch ist genau ein Absatz; Zeilen ohne Leerzeile bilden einen Absatz", () => {
        expect(zerlegeBloecke("Ein Satz.")).toEqual([{ art: "absatz", teile: [{ art: "text", text: "Ein Satz." }] }]);
        expect(zerlegeBloecke("Eins\nzwei")).toEqual([{ art: "absatz", teile: [{ art: "text", text: "Eins zwei" }] }]);
        // Ein Minus mitten im Satz und ein Strich ohne Leerzeichen bleiben Text.
        expect(zerlegeBloecke("−0,1 - viel\n-5 Grad")).toEqual([
            { art: "absatz", teile: [{ art: "text", text: "−0,1 - viel -5 Grad" }] },
        ]);
        expect(zerlegeBloecke("")).toEqual([]);
    });
});

describe("Verschieben: das Fenster bleibt fassbar (Legacy dialog-drag.js)", () => {
    const bild = { width: 1280, height: 720 };
    const mitte = { left: 170, top: 60, width: 940, height: 600, kopfHoehe: 45 };

    it("innerhalb des Bildes geht der Versatz durch", () => {
        expect(begrenzeVersatz(mitte, { x: 100, y: -40 }, bild)).toEqual({ x: 100, y: -40 });
    });

    it(`links und rechts bleiben mindestens ${String(MIN_SICHTBAR_X)} px im Bild`, () => {
        const links = begrenzeVersatz(mitte, { x: -5000, y: 0 }, bild);
        expect(mitte.left + links.x + mitte.width).toBe(MIN_SICHTBAR_X);
        const rechts = begrenzeVersatz(mitte, { x: 5000, y: 0 }, bild);
        expect(mitte.left + rechts.x).toBe(bild.width - MIN_SICHTBAR_X);
    });

    it("🔴 nach oben ist Schluss, bevor der Kopf verschwindet; nach unten bleibt der Kopf im Bild", () => {
        expect(mitte.top + begrenzeVersatz(mitte, { x: 0, y: -5000 }, bild).y).toBe(0);
        const unten = begrenzeVersatz(mitte, { x: 0, y: 5000 }, bild);
        expect(mitte.top + unten.y).toBe(bild.height - Math.max(mitte.kopfHoehe, MIN_SICHTBAR_Y));
    });

    it("🔴 die unverschobene Lage ist immer erlaubt - auch wenn das Fenster von Haus aus übersteht", () => {
        const zuGross = { left: -20, top: -30, width: 1400, height: 900, kopfHoehe: 45 };
        expect(begrenzeVersatz(zuGross, { x: 0, y: 0 }, bild)).toEqual({ x: 0, y: 0 });
    });
});

describe("Wo ein gelöstes Fenster zuerst steht (WI-0150, Kanal OPS-000002)", () => {
    const box = { left: 300, top: 120, width: 560, height: 200 };

    it("ohne gemerkte Box steht es in der gewünschten Ecke", () => {
        expect(vorgabeEckeKlasse("geloest", undefined, "links-unten")).toBe("avm-fenster--links-unten");
    });

    it("🔴 eine gemerkte Box schlägt die Ecke - wer es einmal verschoben hat, findet es dort wieder", () => {
        expect(vorgabeEckeKlasse("geloest", box, "links-unten")).toBeUndefined();
    });

    it("🔴 nur gelöst: angedockt, versenkt und modal stehen, wo ihre Lage sie hinstellt", () => {
        expect(vorgabeEckeKlasse("angedockt", undefined, "links-unten")).toBeUndefined();
        expect(vorgabeEckeKlasse("versenkt", undefined, "links-unten")).toBeUndefined();
        expect(vorgabeEckeKlasse("modal", undefined, "links-unten")).toBeUndefined();
    });

    it("ohne Wunsch bleibt alles wie bisher", () => {
        expect(vorgabeEckeKlasse("geloest", undefined, undefined)).toBeUndefined();
    });
});
