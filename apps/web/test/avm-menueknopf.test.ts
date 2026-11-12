import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    menueLage,
    menueLageBegrenzt,
    menueSeite,
    menueTaste,
    startIndex,
    type MenueOption,
} from "../src/controls/avm-menueknopf.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";

/**
 * Der Menüknopf (WI-0122 zweiter Nachtrag, Betreiber 2026-10-09: „kannst du das dropdown zum icon machen und rechts neben die
 * suchmaske“), ohne Browser: welcher Eintrag beim Öffnen den Fokus bekommt, was jede Taste im offenen Menü tut, wo das Menü
 * aufgeht - und was die Stildatei zusichert. Im Browser gemessen wird er in `e2e/staetten.spec.ts` (öffnen, wählen, Esc,
 * Fokus zurück, eine Zeile mit dem Feld bei 1280, 412 und 360 px).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const datei = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");
const ohneKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
const knopf = ohneKommentare(datei("apps/web/src/controls/avm-menueknopf.vue"));
const stil = /<style scoped>([\s\S]*?)<\/style>/.exec(knopf)?.[1] ?? "";
const vorlage = /<template>([\s\S]*)<\/template>/.exec(knopf)?.[1] ?? "";

const ORDNUNG: MenueOption[] = [
    { wert: "alpha", text: "alphabetisch" },
    { wert: "count", text: "nach Häufigkeit" },
];

describe("Öffnen: der Fokus steht auf der aktiven Wahl", () => {
    it("die aktive Wahl, sonst der erste Eintrag", () => {
        expect(startIndex(ORDNUNG, "alpha")).toBe(0);
        expect(startIndex(ORDNUNG, "count")).toBe(1);
        expect(startIndex(ORDNUNG, "unbekannt")).toBe(0);
    });
});

describe("Tasten im offenen Menü", () => {
    it("die Pfeile wandern und laufen um", () => {
        expect(menueTaste("ArrowDown", 0, 2)).toEqual({ art: "fokus", index: 1 });
        expect(menueTaste("ArrowDown", 1, 2)).toEqual({ art: "fokus", index: 0 });
        expect(menueTaste("ArrowUp", 0, 2)).toEqual({ art: "fokus", index: 1 });
        expect(menueTaste("ArrowUp", 1, 2)).toEqual({ art: "fokus", index: 0 });
        // Ohne Fokus in der Liste: nach unten der erste, nach oben der letzte.
        expect(menueTaste("ArrowDown", -1, 3)).toEqual({ art: "fokus", index: 0 });
        expect(menueTaste("ArrowUp", -1, 3)).toEqual({ art: "fokus", index: 2 });
    });

    it("Pos1 und Ende springen an die Ränder", () => {
        expect(menueTaste("Home", 2, 3)).toEqual({ art: "fokus", index: 0 });
        expect(menueTaste("End", 0, 3)).toEqual({ art: "fokus", index: 2 });
    });

    it("🔴 Esc schließt und gibt den Fokus an den Knopf zurück; Tab schließt und lässt den Fokus weiterziehen", () => {
        expect(menueTaste("Escape", 1, 2)).toEqual({ art: "schliessen", zurueck: true });
        expect(menueTaste("Tab", 1, 2)).toEqual({ art: "schliessen", zurueck: false });
    });

    it("Enter und Leertaste gehören dem Eintrag selbst (ein `<button>`), andere Tasten tun nichts", () => {
        for (const taste of ["Enter", " ", "a", "ArrowLeft"])
            expect(menueTaste(taste, 0, 2)).toEqual({ art: "nichts" });
    });
});

describe("Wo das Menü aufgeht", () => {
    const fenster = { width: 1280, height: 900 };
    const blatt = { width: 180, height: 80 };

    it("unter dem Knopf, rechtsbündig mit ihm", () => {
        expect(menueLage({ top: 100, bottom: 132, right: 600 }, blatt, fenster, 4, 8)).toEqual({ top: 136, left: 420 });
    });

    it("darüber, wenn unten der Platz fehlt", () => {
        expect(menueLage({ top: 850, bottom: 882, right: 600 }, blatt, fenster, 4, 8)).toEqual({ top: 766, left: 420 });
    });

    it("nie über den Rand des Fensters", () => {
        expect(menueLage({ top: 100, bottom: 132, right: 120 }, blatt, fenster, 4, 8).left).toBe(8);
        expect(menueLage({ top: 100, bottom: 132, right: 1300 }, blatt, fenster, 4, 8).left).toBe(1092);
    });

    it("links im Bereich linksbündig, rechts rechtsbündig (Betreiber 2026-10-10)", () => {
        const links = { top: 100, bottom: 132, left: 320, right: 384, width: 64 };
        expect(menueSeite(links, { left: 100, width: 1240 })).toBe("links");
        expect(menueLage(links, blatt, fenster, 4, 8, "links").left).toBe(320);
        const rechts = { top: 100, bottom: 132, left: 1200, right: 1264, width: 64 };
        expect(menueSeite(rechts, { left: 100, width: 1240 })).toBe("rechts");
        expect(menueLage(rechts, blatt, fenster, 4, 8, "rechts").left).toBe(1264 - blatt.width);
        // Auch linksbündig nie über den rechten Rand.
        expect(menueLage({ ...links, left: 1250 }, blatt, fenster, 4, 8, "links").left).toBe(
            fenster.width - 8 - blatt.width,
        );
    });
});

describe("Was die Datei zusichert", () => {
    it("🔴 die Seite zeichnet das Menü - kein natives `<select>`, über allem (`Teleport` an `body`)", () => {
        expect(vorlage).not.toMatch(/<select/);
        expect(vorlage).toMatch(/<Teleport to="body"/);
        // Im modalen Fenster bleibt es im Fenster (Guide §13.45): am body läge es unter dem <dialog> und wäre träge.
        expect(vorlage).toMatch(/<Teleport to="body" :disabled="props.imFenster === true">/);
        expect(vorlage).toMatch(/role="menu"/);
        expect(vorlage).toMatch(/role="menuitemradio"/);
        expect(vorlage).toMatch(/:aria-checked=/);
        expect(vorlage).toMatch(/aria-haspopup="menu"/);
        expect(vorlage).toMatch(/:aria-expanded="offen"/);
        expect(vorlage).toMatch(/:aria-label="props.bezeichnung"/);
    });

    it("§30.5 Mindestliste: Hover, Aktiv/offen, Fokusring des Hauses, Übergang, reduzierte Bewegung", () => {
        expect(stil).toMatch(/\.menueknopf:hover/);
        expect(stil).toMatch(/\.menueknopf\.is-offen/);
        expect(stil).toMatch(/\.menueknopf:focus-visible[^}]*box-shadow:\s*var\(--focus-ring\)/);
        expect(stil).toMatch(/transition:/);
        expect(stil).toMatch(/prefers-reduced-motion: reduce/);
        expect(stil).toMatch(/\.menueknopf__eintrag:hover/);
    });

    it("🔴 §30.2: Hover färbt die Fläche (eine Lasur), nie die Deckkraft; kein synthetisches Fett", () => {
        expect(stil).not.toMatch(/\bopacity\s*:/);
        expect(stil).toMatch(/--color-hover-wash/);
        expect(stil).not.toMatch(/font-weight:\s*(500|600|700|800|900|bold)/);
    });

    it("am Finger ein Fingerziel von 44 px, wie die Kamerasteuerung", () => {
        expect(stil).toMatch(/@media \(pointer: coarse\)[\s\S]*--menueknopf-finger:\s*44px/);
        expect(datei("apps/web/src/controls/camera-controls.vue")).toMatch(/--camera-touch-target:\s*44px/);
    });
});

describe("Im Infopanel: der Knopf steht neben dem Feld, die Auswahl darunter ist fort", () => {
    const zeile = ohneKommentare(datei("apps/web/src/info-panel/info-lore-row.vue"));

    it("🔴 Feld und Knopf in EINER Zeile, kein `AvmAuswahl` mehr", () => {
        expect(zeile).not.toMatch(/AvmAuswahl/);
        expect(zeile).toMatch(/<div class="info-lore__suchzeile">\s*<AvmEingabe[\s\S]*?<AvmMenueknopf/);
    });

    it("die Aufschriften nennen die aktive Ordnung, ohne Anrede, deutsch und englisch", () => {
        expect(de["infoPanel.staetten.orderNamed"]).toBe("Innerorts ordnen: {order}");
        expect(en["infoPanel.staetten.orderNamed"]).toBe("Sort in town: {order}");
        expect(de["infoPanel.staetten.orderAlpha"]).toBe("alphabetisch");
        expect(de["infoPanel.staetten.orderCount"]).toBe("nach Häufigkeit");
    });
});

describe("menueLageBegrenzt: ein hohes Blatt bleibt im Fenster", () => {
    // Befund 2026-10-11 am Trichter der Literatur (dreißig Genres): Passte das Blatt weder unter noch über den Knopf, klemmte
    // `menueLage` es oben an den Rand, und es deckte den Fensterkopf. Jetzt geht es auf der Seite mit mehr Platz auf und wird dort
    // auf den Platz begrenzt; das Blatt rollt in sich.
    const fenster = { width: 1440, height: 900 };
    const knopf = { top: 300, bottom: 332, right: 400, left: 368 };

    it("🔴 ein Blatt, das unten passt, geht unten auf und bleibt ungekürzt", () => {
        expect(menueLageBegrenzt(knopf, { width: 420, height: 400 }, fenster, 4, 8, "links")).toEqual({
            top: 336,
            left: 368,
            hoehe: undefined,
        });
    });

    it("🔴 passt es auf keiner Seite, geht es auf der größeren auf und wird auf deren Platz begrenzt", () => {
        expect(menueLageBegrenzt(knopf, { width: 420, height: 800 }, fenster, 4, 8, "links")).toEqual({
            top: 336,
            left: 368,
            hoehe: 900 - 8 - 336,
        });
        const tief = { top: 700, bottom: 732, right: 400, left: 368 };
        expect(menueLageBegrenzt(tief, { width: 420, height: 800 }, fenster, 4, 8, "links")).toEqual({
            top: 8,
            left: 368,
            hoehe: 700 - 4 - 8,
        });
    });

    it("passt es nur oben, geht es oben auf, ungekürzt", () => {
        const tief = { top: 700, bottom: 732, right: 400, left: 368 };
        expect(menueLageBegrenzt(tief, { width: 420, height: 400 }, fenster, 4, 8, "links")).toEqual({
            top: 296,
            left: 368,
            hoehe: undefined,
        });
    });
});
