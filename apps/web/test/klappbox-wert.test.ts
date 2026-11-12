import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { laeufe, laufText, nurEinheit, wert, type Lauf } from "../src/controls/wert.ts";
import { locale } from "../src/i18n/i18n.ts";

/**
 * 🔴 Die Klappbox-Regel für Werte (Design Guide §16.3 „Die Zahl wird hervorgehoben, das Wort nicht“, als allgemeine Regel
 * für strukturierte Werte, Betreiber 2026-10-04): EIN Baustein für Wert und Einheit (`AvmWert`), EIN Baustein für Text mit
 * Rolle (`AvmText`), die Kopfzeile des Deckels trägt sie von selbst. Hier: das Schneiden der fertig formatierten Texte
 * (deutsch und englisch, über die vorhandenen Formatierer) und die Hüllen der Bausteine; die berechneten Farben im Browser
 * hält `e2e/klappbox-werte.spec.ts`.
 */

afterEach(() => {
    locale.value = "de";
});

const here = dirname(fileURLToPath(import.meta.url));
const controls = join(here, "../src/controls");
const planner = join(here, "../src/route-planner");

const werte = (text: string): { zahl: string; einheit: string; abstand: string }[] =>
    laeufe(text).filter((lauf): lauf is Exclude<Lauf, string> => typeof lauf !== "string");

describe("Texte in Werte schneiden", () => {
    it("🔴 Zahl und Einheit: „27 %“, „40,1 Std.“, „2.830 Schritt“, „1 D 6 S 8 H“", () => {
        expect(werte("Max. Steigung: 27 %")).toEqual([{ zahl: "27", einheit: "%", abstand: " " }]);
        expect(werte("+40,1 Std.")).toEqual([{ zahl: "+40,1", einheit: "Std.", abstand: " " }]);
        expect(werte("höchster Punkt 2.830 Schritt")).toEqual([{ zahl: "2.830", einheit: "Schritt", abstand: " " }]);
        expect(werte("1 D 6 S 8 H")).toEqual([
            { zahl: "1", einheit: "D", abstand: " " },
            { zahl: "6", einheit: "S", abstand: " " },
            { zahl: "8", einheit: "H", abstand: " " },
        ]);
        expect(werte("8,0 h/Tag")).toEqual([{ zahl: "8,0", einheit: "h/Tag", abstand: " " }]);
        expect(werte("der Schnee 53,8 Stunden (Tiefschnee)")).toEqual([
            { zahl: "53,8", einheit: "Stunden", abstand: " " },
        ]);
        expect(werte("544,0 Meilen")).toEqual([{ zahl: "544,0", einheit: "Meilen", abstand: " " }]);
    });

    it("🔴 englisch mit seinen Formaten: „40.1 h“, „2,830 paces“, „8.0 h/day“, „27 %“", () => {
        locale.value = "en";
        expect(werte("Max. 27 % · +40.1 h")).toEqual([
            { zahl: "27", einheit: "%", abstand: " " },
            { zahl: "+40.1", einheit: "h", abstand: " " },
        ]);
        expect(werte("highest point 2,830 paces")).toEqual([{ zahl: "2,830", einheit: "paces", abstand: " " }]);
        expect(werte("8.0 h/day")).toEqual([{ zahl: "8.0", einheit: "h/day", abstand: " " }]);
        expect(werte("snow costs 12.3 hours")).toEqual([{ zahl: "12.3", einheit: "hours", abstand: " " }]);
    });

    it("eine Zahl ohne Einheit ist eine bloße Zahl; ein Datum „15. Firun“ nimmt den Punkt nicht mit", () => {
        expect(werte("21 Reisetage")).toEqual([{ zahl: "21", einheit: "", abstand: "" }]);
        expect(werte("ab 15. Firun")).toEqual([{ zahl: "15", einheit: "", abstand: "" }]);
        expect(werte("8 × im Gemeinschaftszimmer")).toEqual([{ zahl: "8", einheit: "", abstand: "" }]);
    });

    it("🔴 eine Zahl mitten in einem Wort ist keine („DSA5“), und „S“ von „Sachen“ ist keine Einheit", () => {
        expect(werte("aus dem DSA5-Regelwerk")).toEqual([]);
        expect(werte("3 Sachen")).toEqual([{ zahl: "3", einheit: "", abstand: "" }]);
        expect(werte("2 Schritte")).toEqual([{ zahl: "2", einheit: "", abstand: "" }]);
    });

    it("🔴 setzt man die Läufe wieder zusammen, kommt der Text unverändert heraus", () => {
        const proben = [
            "Max. Steigung: 27 % (2.830 ↑ · 1.600 ↓ Schritt), höchster Punkt 3.000 Schritt.",
            "+72,8 Std. (bis 19 %, Schnee)",
            "Die Steigung kostet 25,8 Stunden, der Schnee 53,8 Stunden (leichter Schnee, Tiefschnee).",
            "Galeere: 8 Stunden gerudert, danach 16 Stunden Rast der Ruderer.",
            "1 D 6 S 8 H",
            "Zölle und Passagen nach der Geographia Aventurica.",
        ];
        for (const probe of proben) expect(laeufe(probe).map(laufText).join(""), probe).toBe(probe);
    });

    it("die Einheiten kommen aus den Formaten der Sprachtafel: eine geschützte Leerstelle trennt ebenso", () => {
        expect(werte("27 %")).toEqual([{ zahl: "27", einheit: "%", abstand: " " }]);
        expect(werte("4 S")).toEqual([{ zahl: "4", einheit: "S", abstand: " " }]);
        // Eine Einheit allein, ohne Zahl davor, ist keine.
        expect(werte("Schritt")).toEqual([]);
    });

    it("die Hilfen: `wert` setzt den Abstand nur zwischen Zahl und Einheit, `nurEinheit` hat keine Zahl", () => {
        expect(wert("27", "%")).toEqual({ zahl: "27", einheit: "%", abstand: " " });
        expect(wert("21")).toEqual({ zahl: "21", einheit: "", abstand: "" });
        expect(nurEinheit("Schritt")).toEqual({ zahl: "", einheit: "Schritt", abstand: "" });
        expect(laufText(nurEinheit("Schritt"))).toBe("Schritt");
    });
});

/** Der Quelltext ohne Kommentare, damit ein Wächter nur Code liest. */
const code = (path: string): string =>
    readFileSync(path, "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

describe("Die Bausteine", () => {
    it("🔴 `AvmWert`: Zahl hell mit Ziffern gleicher Breite, Einheit gedämpft, nur Tokens des Kanons", () => {
        const source = code(join(controls, "avm-wert.vue"));
        expect(source).toMatch(/\.wert__zahl\s*\{[^}]*color:\s*var\(--color-text-strong\)/);
        expect(source).toMatch(/\.wert__zahl\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
        expect(source).toMatch(/\.wert__einheit\s*\{[^}]*color:\s*var\(--color-text-muted\)/);
        // Keine Farbe als Literal, nur `var(--…)`.
        expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    });

    it("🔴 `AvmText`: drei Rollen - Fließtext, Sekundärtext, Titel - und jede Zahl läuft über `AvmWert`", () => {
        const source = code(join(controls, "avm-text.vue"));
        expect(source).toMatch(/\.avm-text--text\s*\{[^}]*color:\s*var\(--color-text\)/);
        expect(source).toMatch(/\.avm-text--sekundaer\s*\{[^}]*color:\s*var\(--color-text-muted\)/);
        expect(source).toMatch(/\.avm-text--titel\s*\{[^}]*color:\s*var\(--color-text-strong\)/);
        expect(source).toContain("AvmWert");
        expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    });

    it("🔴 die Kopfzeile des Deckels setzt ihre Werte über denselben Baustein, ohne eigenes CSS für Zahlen", () => {
        const source = code(join(controls, "avm-disclosure.vue"));
        expect(source).toContain("AvmText");
        expect(source).not.toContain("disclosure__number");
        expect(source).not.toContain("textParts");
        expect(source).not.toMatch(/font-variant-numeric/);
    });

    it("kein zweites Muster daneben: der Betrag des Kostenkastens ist ein `AvmWert`, die alte Darstellung ist weg", () => {
        expect(existsSync(join(planner, "cost-amount.vue"))).toBe(false);
        const overview = code(join(planner, "route-overview.vue"));
        expect(overview).not.toContain("CostAmount");
        expect(overview).toContain("AvmWert");
        expect(overview).toContain("AvmText");
    });
});
