import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GEFAHREN_ARTEN } from "@avesmaps3d/shared";
import { mehrfachWahl } from "../src/controls/avm-mehrfachauswahl.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";

/**
 * Die Mehrfachauswahl (WI-0308, erster Leser die Gefahrenlage im Landschaftseditor): die Regeln ohne Vue, dazu, was die Datei zusichert
 * (Guide §30.5). Problemfälle: Die Wahl steht in der Folge der Klicks statt der Optionen; „ungefährlich“ leert nicht; ein Wert steht zweimal;
 * das Blatt liegt unter dem modalen Fenster; eine Gefahrenart hat keinen Namen.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const datei = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");
const quelle = datei("apps/web/src/controls/avm-mehrfachauswahl.vue");
const vorlage = quelle.slice(quelle.indexOf("<template>"), quelle.indexOf("<style"));
const stil = quelle.slice(quelle.indexOf("<style"));

const OPTIONEN = [{ wert: "krieg" }, { wert: "seuche" }, { wert: "wildnis" }];

describe("Mehrfachauswahl: die Regeln", () => {
    it("🔴 ein Kästchen an und aus, immer in der Folge der Optionen, jeder Wert einmal", () => {
        expect(mehrfachWahl(OPTIONEN, [], "wildnis", true)).toEqual(["wildnis"]);
        expect(mehrfachWahl(OPTIONEN, ["wildnis"], "krieg", true)).toEqual(["krieg", "wildnis"]);
        expect(mehrfachWahl(OPTIONEN, ["krieg", "wildnis"], "krieg", true)).toEqual(["krieg", "wildnis"]);
        expect(mehrfachWahl(OPTIONEN, ["krieg", "wildnis"], "krieg", false)).toEqual(["wildnis"]);
    });

    it("🔴 die leere Wahl („ungefährlich“) leert alles; ein unbekannter Wert fällt weg", () => {
        expect(mehrfachWahl(OPTIONEN, ["krieg", "seuche"], undefined, true)).toEqual([]);
        expect(mehrfachWahl(OPTIONEN, ["krieg"], undefined, false)).toEqual(["krieg"]);
        expect(mehrfachWahl(OPTIONEN, ["drachen"], "seuche", true)).toEqual(["seuche"]);
    });
});

describe("Mehrfachauswahl: was die Datei zusichert", () => {
    it("🔴 das Blatt geht im offenen Fenster auf (menue-blatt), mit Kästchen und der leeren Wahl als rundem Knopf", () => {
        expect(quelle).toMatch(/useMenueBlatt\(/);
        expect(vorlage).toMatch(/<Teleport :to="ziel">/);
        expect(vorlage).toMatch(/art="radio"/);
        expect(vorlage).toMatch(/art="checkbox"/);
        expect(vorlage).toMatch(/:aria-expanded="offen"/);
        expect(vorlage).not.toMatch(/<select/);
    });

    it("§30.5 Mindestliste: Hover, Aktiv/offen, Fokusring des Hauses, Gesperrt, Übergang, reduzierte Bewegung", () => {
        expect(stil).toMatch(/\.mehrfach:hover/);
        expect(stil).toMatch(/\.mehrfach\.is-offen/);
        expect(stil).toMatch(/\.mehrfach:focus-visible[^}]*box-shadow:\s*var\(--focus-ring\)/);
        expect(stil).toMatch(/\.mehrfach:disabled/);
        expect(stil).toMatch(/transition:/);
        expect(stil).toMatch(/prefers-reduced-motion: reduce/);
    });

    it("🔴 §30.2: keine Deckkraft, kein synthetisches Fett, keine Farbe als Literal", () => {
        expect(stil).not.toMatch(/\bopacity\s*:/);
        expect(stil).not.toMatch(/font-weight:\s*(500|600|700|800|900|bold)/);
        expect(stil).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    });
});

describe("Gefahrenarten in den Sprachtafeln (WI-0308)", () => {
    it("🔴 jede Art hat einen Namen, deutsch wie in Valis Vorgabe, englisch übersetzt", () => {
        const tafel = de as Readonly<Record<string, string>>;
        const englisch = en as Readonly<Record<string, string>>;
        expect(GEFAHREN_ARTEN.map((art) => tafel[`gefahr.art.${art}`])).toEqual([
            "Kriegsgebiet",
            "Feindselige Bewohner",
            "Kriminalität",
            "Gefährliche Kreaturen und Monster",
            "Dämonisch verseucht",
            "Verbotenes Heiligtum",
            "Seuchengebiet",
            "Naturgefahren",
            "Extremwetter",
            "Wildnis",
            "Sperrgebiet/Schutzzone",
            "Unerforscht",
        ]);
        expect(tafel["gefahr.ungefaehrlich"]).toBe("ungefährlich");
        for (const art of GEFAHREN_ARTEN) expect(englisch[`gefahr.art.${art}`]).toMatch(/\S/u);
    });
});
