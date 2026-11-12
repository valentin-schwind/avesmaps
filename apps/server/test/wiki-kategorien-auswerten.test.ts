import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ordneArten, waehleArt, waehleKlasse, type ArtSeite } from "../src/wiki/kategorien/aus-datei.ts";
import {
    erkenneKontinent,
    istAusgeschlossenerBauwerkTyp,
    kontinentVonSeite,
    titelSchluessel,
} from "../src/wiki/kategorien/auswerten.ts";
import { BAUWERK_ARTEN_KERN, BAUWERK_ARTEN_LEGACY } from "../src/wiki/kategorien/bauwerkarten.ts";
import {
    BAUWERK_AUSGESCHLOSSEN,
    ORTSGROESSE_KATEGORIEN,
    WIKI_TEIL_BEREICHE,
    WIKI_TEIL_FORMEN_JE_BEREICH,
} from "../src/wiki/kategorien/konstanten.ts";
import { normalisiereTitel } from "../src/wiki/infobox/text.ts";
import { WIKISYNC_MIT_KATEGORIEN } from "@avesmaps3d/shared";

/**
 * Die Rechnung des Wiki-Teils gegen das Legacy-Orakel (WI-0253 C-2): `scripts/dev/wiki-kategorien-orakel.php` lässt die ECHTEN PHP-Funktionen (Mirror a7f2dac86) auf Eingaben laufen und
 * schreibt Eingabe und Ergebnis in `fixtures/wiki-kategorien-orakel.json`. Hier steht die TypeScript-Rechnung dagegen: Kontinent-Erkennung, Normalisierung der Titel, „erster gewinnt“ der
 * Klassen- und Bauwerkskarte, die Artenliste, die ausgeschlossenen Arten und Legacys Listen selbst. Wer die Rechnung ändert, ändert damit nicht die Erwartung.
 */

interface Orakel {
    kontinent: { id: string; titel: string; kategorien: string[]; erwartet: string | null }[];
    klassen: { id: string; kategorien: Record<string, string[]>; erwartet: Record<string, string> | never[] }[];
    bauwerke: { id: string; arten: Record<string, string[]>; erwartet: Record<string, string> | never[] }[];
    arten: { id: string; seiten: string[][]; erwartet: string[] }[];
    ausgeschlossen: { art: string; erwartet: boolean }[];
    titel: { roh: string; erwartet: string }[];
    bauwerkListe: { arten: string[]; kern: number };
    klassenKategorien: Record<string, string>;
}
const orakel = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/wiki-kategorien-orakel.json", import.meta.url)), "utf8"),
) as Orakel;

/** PHP-Arrays ohne Einträge werden zu `[]`; gemeint ist die leere Karte. */
const alsKarte = (wert: Record<string, string> | unknown[]): Record<string, string> =>
    Array.isArray(wert) ? {} : wert;

describe("Kontinent: dieselbe Rechnung wie Legacy", () => {
    it("🔴 jeder Fall des Orakels (Al’Anfa, Abgeleitet von Horas, Kolonien, Nav Staaten, Umlaute …) ergibt denselben Kontinent wie die echte PHP-Funktion", () => {
        expect(orakel.kontinent.length).toBeGreaterThan(100);
        const abweichungen = orakel.kontinent
            .map((fall) => ({ fall, mein: kontinentVonSeite(fall.titel, fall.kategorien) }))
            .filter(({ fall, mein }) => mein !== fall.erwartet)
            .map(({ fall, mein }) => `${fall.id}: Legacy ${String(fall.erwartet)}, hier ${mein}`);
        expect(abweichungen).toEqual([]);
    });

    it("die Fälle, die Legacys Kommentare nennen, stehen mit ihrem Ergebnis fest", () => {
        const aus = (titel: string, kategorien: string[]): string => kontinentVonSeite(titel, kategorien);
        // Al’Anfa: „Geographisch: Meridiana; Kolonien: Uthuria“ kapert das Reich nicht.
        expect(aus("Al’Anfa", ["Geographisch: Meridiana; Kolonien: Uthuria", "Aventurien-Artikel"])).toBe("Aventurien");
        // Horas: die Ableitungs-Kategorie nennt einen Namen, keinen Kontinent.
        expect(aus("Wiedererstandenes Reich des Horas", ["Abgeleitet von Horas (Myranor)", "Aventurien-Artikel"])).toBe(
            "Aventurien",
        );
        expect(aus("Zwerch", ["Staat (Myranor)"])).toBe("Myranor / Güldenland");
        expect(aus("Gareth", [])).toBe("Aventurien");
        // Der ausdrückliche Aventurien-Wegweiser gewinnt vor jeder losen Erwähnung.
        expect(erkenneKontinent("Horasreich Nav Staaten Aventurien Ort in Myranor")).toBe("Aventurien");
        // Die Reihenfolge der Suchwörter ist tragend: Myranor steht vor Aventurien, Rakshazar vor Uthuria.
        expect(erkenneKontinent("Streitort Aventurien Myranor")).toBe("Myranor / Güldenland");
        expect(erkenneKontinent("Streitort Uthuria Rakshazar")).toBe("Rakshazar / Riesland");
    });
});

describe("Titel, Arten und Listen: dieselbe Rechnung wie Legacy", () => {
    it("die Normalisierung der Titel (Unterstrich, Sprungmarke, Rand) gleicht Legacy", () => {
        for (const fall of orakel.titel)
            expect(normalisiereTitel(fall.roh), JSON.stringify(fall.roh)).toBe(fall.erwartet);
    });

    it("der Schlüssel eines Titels macht nur den ersten Buchstaben frei (MediaWiki: first-letter)", () => {
        expect(titelSchluessel("gareth")).toBe(titelSchluessel("Gareth"));
        expect(titelSchluessel("Alt_Name")).toBe(titelSchluessel("alt Name"));
        expect(titelSchluessel("Ort#Sprung")).toBe(titelSchluessel("Ort"));
        // Der Rest bleibt unterscheidbar: Zwei Seiten, die sich im zweiten Buchstaben unterscheiden, sind zwei.
        expect(titelSchluessel("Al'Anfa")).not.toBe(titelSchluessel("Al'anfa"));
    });

    it("die ausgeschlossenen Arten (Straße, Mauer, Damm …) gleichen Legacy, gefaltet verglichen", () => {
        for (const fall of orakel.ausgeschlossen) {
            expect(istAusgeschlossenerBauwerkTyp(fall.art, BAUWERK_AUSGESCHLOSSEN), JSON.stringify(fall.art)).toBe(
                fall.erwartet,
            );
        }
    });

    it("🔴 Legacys Liste der Bauwerksarten und der Kern von 24 stehen wörtlich und in derselben Reihenfolge da; die Siedlungsgrößen ebenso", () => {
        expect([...BAUWERK_ARTEN_LEGACY]).toEqual(orakel.bauwerkListe.arten);
        expect(BAUWERK_ARTEN_KERN).toBe(orakel.bauwerkListe.kern);
        expect(ORTSGROESSE_KATEGORIEN.map((eintrag) => [eintrag.kategorie, eintrag.klasse])).toEqual(
            Object.entries(orakel.klassenKategorien),
        );
    });

    it("die Bereiche mit Kategorien sind dieselben wie im Paket shared, und jede Form hat ihr Feld", () => {
        expect([...WIKI_TEIL_BEREICHE].sort()).toEqual([...WIKISYNC_MIT_KATEGORIEN].sort());
        expect(WIKI_TEIL_FORMEN_JE_BEREICH.ort).toEqual(["ortsgroesse", "bauwerkart"]);
    });
});

/**
 * Die Rechnung aus der Datei gegen die Fälle des Orakels. Das Orakel kennt die Welt der API (Kategorie → Titel der Mitglieder); die Datei kennt sie umgekehrt (Seite → Kategorien). Jeder Fall wird
 * deshalb umgedreht: Zu jedem Titel (normalisiert, wie Legacy ihn führt) gehören die Kategorien, in denen er als Mitglied steht. Dann muss die Wahl je Titel (`waehleKlasse`, `waehleArt`) dasselbe
 * ergeben wie die Karte, die Legacy aus den Mitgliedern baute.
 */
function kategorienJeTitel(kategorien: Record<string, string[]>): Map<string, string[]> {
    const jeTitel = new Map<string, string[]>();
    for (const [name, titel] of Object.entries(kategorien)) {
        for (const roh of titel) {
            const norm = normalisiereTitel(roh);
            if (norm === "") continue;
            const liste = jeTitel.get(norm) ?? [];
            liste.push(name);
            jeTitel.set(norm, liste);
        }
    }
    return jeTitel;
}

describe("Klassen-, Bauwerks- und Artenkarte: dieselbe Rechnung wie Legacy", () => {
    it("🔴 die Klassenkarte (erste Kategorie gewinnt, Titel normalisiert, fremde Kategorien zählen nicht) gleicht Legacy", () => {
        expect(orakel.klassen.length).toBeGreaterThan(0);
        for (const fall of orakel.klassen) {
            const mein: Record<string, string> = {};
            for (const [titel, kategorien] of kategorienJeTitel(fall.kategorien)) {
                const klasse = waehleKlasse(kategorien);
                if (klasse !== undefined) mein[titel] = klasse;
            }
            expect(mein, fall.id).toEqual(alsKarte(fall.erwartet));
        }
    });

    it("🔴 die Bauwerkskarte (erste Art gewinnt über Kategorien hinweg) gleicht Legacy", () => {
        expect(orakel.bauwerke.length).toBeGreaterThan(0);
        for (const fall of orakel.bauwerke) {
            // Die Arten stehen in der Reihenfolge, in der Legacy sie abfragte.
            const arten = Object.keys(fall.arten);
            const mein: Record<string, string> = {};
            for (const [titel, kategorien] of kategorienJeTitel(fall.arten)) {
                const art = waehleArt(kategorien, arten);
                if (art !== undefined) mein[titel] = art;
            }
            expect(mein, fall.id).toEqual(alsKarte(fall.erwartet));
        }
    });

    it("🔴 die fertige Artenliste (online zuerst, Legacys Rest angehängt, lineare Anlagen heraus) gleicht Legacy – auch über mehrere Seiten", () => {
        expect(orakel.arten.length).toBeGreaterThan(0);
        for (const fall of orakel.arten) {
            // Die Seiten der API in ihrer Reihenfolge: Der Sortierschlüssel zählt hoch, die Nummer der Kategorieseite ebenso.
            const roh = fall.seiten.flat();
            const seiten: ArtSeite[] = roh.map((_titel, index) => ({
                id: index + 1,
                sortierschluessel: String(index).padStart(6, "0"),
            }));
            const titelJeId = new Map(roh.map((titel, index) => [index + 1, titel] as const));
            expect(ordneArten(seiten, titelJeId).arten, fall.id).toEqual(fall.erwartet);
        }
    });
});
