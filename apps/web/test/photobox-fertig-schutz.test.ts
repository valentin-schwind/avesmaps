import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { de, type MessageKey } from "../src/i18n/de.ts";
import {
    frischerSchutz,
    nachKopieren,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type Schutz,
    type WeiterArt,
} from "../src/photobox/fertig-schutz.ts";

/**
 * Der Schutz vor Verlust in der Bestätigung ohne Browser (WI-0272, Entwurf 8; Betreiber 2026-11-01): Ohne kopierten Link hält der erste Versuch zu schließen (✕, Esc, „Schließen“) oder ein neues Bild zu
 * beginnen einmal an, der zweite geht durch. Den Browser prüft `e2e/reisebild-einreichen.spec.ts`.
 */

const WEGE: readonly WeiterArt[] = ["zu", "noch-eins", "stand"];

describe("🔴 der erste Weg aus der Bestätigung ohne kopierten Link hält an", () => {
    it("jeder dieser Wege hält einmal an und merkt sich, wofür gewarnt wurde", () => {
        for (const weg of WEGE) {
            const erster = pruefeWeiter(frischerSchutz(), weg);
            expect(erster.halt, weg).toBe(true);
            expect(erster.schutz).toEqual({ kopiert: false, gewarnt: weg });
            expect(warnungSteht(erster.schutz)).toBe(true);
        }
    });

    it("🔴 der zweite Versuch geht durch, welcher Weg es auch ist (nie eine Warnschleife)", () => {
        for (const erst of WEGE) {
            const gewarnt = pruefeWeiter(frischerSchutz(), erst).schutz;
            for (const zweit of WEGE) {
                const zweiter = pruefeWeiter(gewarnt, zweit);
                expect(zweiter.halt, `${erst} dann ${zweit}`).toBe(false);
                expect(zweiter.schutz).toBe(gewarnt);
            }
        }
    });

    it("🔴 nach dem Kopieren geht alles sofort, und die Warnung ist weg", () => {
        const gewarnt = pruefeWeiter(frischerSchutz(), "zu").schutz;
        expect(warnungSteht(gewarnt)).toBe(true);
        const kopiert = nachKopieren();
        expect(warnungSteht(kopiert)).toBe(false);
        for (const weg of WEGE) expect(pruefeWeiter(kopiert, weg).halt).toBe(false);
        // Auch wer gleich kopiert, ohne dass je gewarnt wurde.
        const nurKopiert: Schutz = { kopiert: true, gewarnt: undefined };
        for (const weg of WEGE) expect(pruefeWeiter(nurKopiert, weg).halt).toBe(false);
    });

    it("ein frischer Schutz warnt nicht, und die Warnung steht nur, solange der Link nicht kopiert ist", () => {
        expect(warnungSteht(frischerSchutz())).toBe(false);
        expect(warnungSteht({ kopiert: true, gewarnt: "zu" })).toBe(false);
        expect(warnungSteht({ kopiert: false, gewarnt: "noch-eins" })).toBe(true);
    });
});

describe("der Satz hinter dem leisen Knopf der Warnung", () => {
    it("„Trotzdem schließen“ für Schließen, „Trotzdem weiter“ für „Noch ein Bild von hier“; ohne Warnung der Vorgabesatz", () => {
        expect(trotzdemSchluessel(frischerSchutz())).toBe("photobox.fertig.trotzdemSchliessen");
        expect(trotzdemSchluessel({ kopiert: false, gewarnt: "zu" })).toBe("photobox.fertig.trotzdemSchliessen");
        expect(trotzdemSchluessel({ kopiert: false, gewarnt: "noch-eins" })).toBe("photobox.fertig.trotzdemWeiter");
        expect(de["photobox.fertig.trotzdemSchliessen"]).toBe("Trotzdem schließen");
        expect(de["photobox.fertig.trotzdemWeiter"]).toBe("Trotzdem weiter");
        expect(de["photobox.fertig.warnung"]).toBe("Link noch nicht kopiert.");
    });
});

describe("das Fenster verdrahtet den Schutz an alle Wege, die den Link aus dem Blick nehmen", () => {
    const ordner = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox"));
    const lies = (name: string): string => readFileSync(join(ordner, name), "utf8");
    const huelle = lies("reisebild-fenster.vue");
    const fertig = lies("reisebild-fertig.vue");
    const fuss = lies("reisebild-fertig-fuss.vue");

    it("🔴 ✕ und Esc laufen über das Modell `offen` der Hülle, „Schließen“, „Noch ein Bild“ und „Stand ansehen“ über `weiter`; der Wächter der Steuerung deckt die Wege von außen", () => {
        // ✕ und Esc setzen `offen` an der Hülle: Das Fenster hängt an einem Modell, dessen Setzer erst prüft.
        expect(huelle).toContain('v-model:offen="huellenOffen"');
        expect(huelle).toContain('weiter("zu")');
        expect(huelle).toContain('weiter("noch-eins")');
        // Seit Entwurf 9 zählt auch ein gemerkter Link (`photobox-merkliste.test.ts`): Die Merkliste sagt es dem Schutz.
        expect(huelle).toContain("pruefeWeiter(schutz.value, art, gemerkt.value)");
        expect(huelle).toContain("@schliessen=");
        expect(huelle).toContain("@noch-eins=");
        // „Stand ansehen“ ist geschützt (Review S3 I1): Die Statusseite ist nur noch über diesen Link erreichbar.
        expect(fertig).toContain("emit('stand')");
        expect(huelle).toContain('weiter("stand")');
        expect(huelle).toContain('@stand="standGedrueckt"');
        // Jeder Weg von außen (Kartenmenü, „Meine Reisebilder“, Fenster der Meldungen) fragt den Wächter, den die Bestätigung einhängt (`photobox-linkschutz.test.ts`).
        expect(huelle).toContain("props.steuerung.schuetze(weiter)");
    });

    it("„Kopieren“ in der Warnung kopiert und führt dann aus, was gewollt war; geht das Kopieren nicht, bleibt das Fenster stehen", () => {
        expect(huelle).toContain("const art = schutz.value.gewarnt");
        expect(fuss).toContain("emit('warn-kopieren')");
        expect(fuss).toContain("emit('trotzdem')");
    });

    it("jeder Text des Fensters und seiner Teile steht in der deutschen Tafel", () => {
        const schluessel = [...`${huelle}\n${fertig}\n${fuss}`.matchAll(/\bt\(\s*["']([a-z][\w.-]*)["']/gu)].map(
            (treffer) => treffer[1]!,
        );
        expect(schluessel.length).toBeGreaterThan(10);
        for (const key of schluessel) expect(Object.keys(de), key).toContain(key as MessageKey);
    });
});
