import { afterEach, describe, expect, it } from "vitest";
import { EDITORPANEL, kinder } from "@avesmaps3d/shared";
import { berechne, kreisZaehlung, type Kreis, type ListenZeile } from "../src/editor-liste/liste-modell.ts";
import { navName } from "../src/editor-panel/editor-panel-texte.ts";
import {
    KARTENINHALTE,
    gruppeVon,
    kachelFuerAnsicht,
    kachelGruppen,
    zaehlungAus,
    zaehlungAusZahlen,
    type KarteninhaltId,
} from "../src/editor-panel/karteninhalte-kacheln.ts";
import { LOCALES, locale, t } from "../src/i18n/i18n.ts";

/**
 * Die Kacheln „Karteninhalte“ im Editorpanel (WI-0212; EDIT-0003 T37, Betreiber 2026-10-16: „so jetzt hab ichs aber :)“). Geprüft wird
 * das Modell; wie es aussieht und dass die Wahl die Ansicht stellt, misst `e2e/editor-panel.spec.ts`.
 */
const EDITOR = ["use_editor_menu"];

afterEach(() => {
    locale.value = "de";
});

const ids = (rechte: readonly string[]) =>
    kachelGruppen(rechte).map((gruppe) => [gruppe.id, gruppe.kacheln.map((kachel) => kachel.id)]);

describe("Gruppen und Folge", () => {
    it("🔴 zwei Gruppen: „Auf der Karte“ mit Orte, Herrschaftsgebiete, Landschaften, Wege, Kraftlinien, Sprachen; „Nachschlagen“ mit Literatur, Karten, Vorkommen, Quellen, Korpora", () => {
        expect(ids(EDITOR)).toEqual([
            ["karte", ["orte", "territorien", "regionen", "wege", "kraftlinien", "sprachen"]],
            ["nachschlagen", ["literatur", "vorkommen", "quellen", "korpora"]],
        ]);
    });

    it("die Folge in der Gruppe ist die des Registers", () => {
        const register = kinder(EDITORPANEL, "karteninhalte", EDITOR).map((eintrag) => eintrag.id);
        const gezeigt = kachelGruppen(EDITOR).flatMap((gruppe) => gruppe.kacheln.map((kachel) => kachel.id));
        for (const gruppe of kachelGruppen(EDITOR)) {
            const folge = gruppe.kacheln.map((kachel) => register.indexOf(kachel.id));
            expect(folge, gruppe.id).toEqual([...folge].sort((a, b) => a - b));
        }
        expect(new Set(gezeigt)).toEqual(new Set(register));
    });

    it("die Gruppe folgt aus dem Ziel im Register: ohne Ziel auf der Karte „Nachschlagen“", () => {
        expect(gruppeVon({ ziel: "keins" })).toBe("nachschlagen");
        expect(gruppeVon({ ziel: "punkt" })).toBe("karte");
        expect(gruppeVon({ ziel: "ausschnitt" })).toBe("karte");
    });

    it("ohne das Recht des Editorpanels gibt es keine Kachel", () => {
        expect(kachelGruppen([])).toEqual([]);
    });
});

describe("Gebaut oder später", () => {
    it("🔴 wählbar ist, was das Register gebaut hat; alles andere steht „später“ (D16)", () => {
        for (const kachel of kachelGruppen(EDITOR).flatMap((gruppe) => gruppe.kacheln)) {
            const eintrag = EDITORPANEL.eintraege.find((x) => x.id === kachel.id)!;
            // Das Register kennt gerade nichts „Späteres“; die Regel gilt weiter, darum als Text verglichen.
            expect(kachel.gebaut, kachel.id).toBe((eintrag.art as string) !== "spaeter");
        }
    });

    it("heute: Orte, Landschaften, Literatur, Vorkommen, Quellen und Korpora gebaut (WI-0254); Karten haben keine Kachel mehr (Reiter am Objekt)", () => {
        const kachel = (id: KarteninhaltId) =>
            kachelGruppen(EDITOR)
                .flatMap((gruppe) => gruppe.kacheln)
                .find((x) => x.id === id)!;
        expect(kachel("orte").gebaut).toBe(true);
        expect(kachel("regionen").gebaut).toBe(true);
        expect(kachel("literatur").gebaut).toBe(true);
        expect(kachel("quellen").gebaut).toBe(true);
        expect(kachel("korpora").gebaut).toBe(true);
        expect(kachelGruppen(EDITOR).flatMap((gruppe) => gruppe.kacheln.map((x) => x.id))).not.toContain("karten");
    });
});

describe("Die Ansicht folgt der Wahl", () => {
    it("🔴 über die eine Zuordnung des Hinflugs: Orte und Wege → Standard, Landschaften → Landschaften, Herrschaftsgebiete → Politisch, Kraftlinien → Kraftlinien, Sprachen → Derographie › Sprachen", () => {
        const ansicht = Object.fromEntries(
            kachelGruppen(EDITOR)
                .flatMap((gruppe) => gruppe.kacheln)
                .map((kachel) => [kachel.id, kachel.ansicht]),
        );
        expect(ansicht).toEqual({
            orte: { view: "standard" },
            territorien: { view: "political" },
            // Die Landschaften als Ganzes: die gemerkte Ebene des Fächers bleibt.
            regionen: { view: "landscapes" },
            wege: { view: "standard" },
            kraftlinien: { view: "powerlines" },
            // Die Sprachen (WI-0261 S5d2) stehen nur in ihrer eigenen Ebene der Derographie.
            sprachen: { view: "landscapes", landscape: "sprachen" },
            literatur: undefined,
            vorkommen: undefined,
            quellen: undefined,
            korpora: undefined,
        });
    });

    it("jeder Inhalt mit Objekten auf der Karte hat eine Ansicht, keiner unter „Nachschlagen“", () => {
        for (const gruppe of kachelGruppen(EDITOR))
            for (const kachel of gruppe.kacheln)
                expect(kachel.ansicht === undefined, kachel.id).toBe(gruppe.id === "nachschlagen");
    });
});

describe("Namen und Zeichen", () => {
    it("🔴 „Herrschaftsgebiete“ statt „Territorien“, „Landschaften“ statt „Regionen“ (T37)", () => {
        expect(t(navName("territorien"))).toBe("Herrschaftsgebiete");
        expect(t(navName("regionen"))).toBe("Derographie");
    });

    it("in jeder Sprache ein eigener Name je Inhalt, keine zwei Kacheln heißen gleich", () => {
        for (const sprache of LOCALES) {
            locale.value = sprache;
            const namen = Object.keys(KARTENINHALTE).map((id) => t(navName(id as KarteninhaltId)));
            expect(new Set(namen).size, sprache).toBe(namen.length);
        }
    });

    it("jeder Inhalt hat ein Zeichen, und keine zwei teilen eins", () => {
        const zeichen = Object.values(KARTENINHALTE).map((inhalt) => inhalt.zeichen);
        expect(new Set(zeichen).size).toBe(zeichen.length);
    });
});

describe("Die Zahl einer Kachel ist die Zählung ihrer Liste", () => {
    const zeile = (key: string, kreis: Kreis): ListenZeile => ({ key, name: key, kreis, facetten: {} });
    const zeilen = [
        zeile("a", "voll"),
        zeile("b", "voll"),
        zeile("c", "halb"),
        zeile("d", "halb-rechts"),
        zeile("e", "voll"),
        zeile("f", "leer"),
    ];

    it("gesamt und je Kreis", () => {
        expect(zaehlungAus(zeilen.map((z) => z.kreis))).toEqual({
            gesamt: 6,
            kreise: { voll: 3, halb: 1, "halb-rechts": 1, leer: 1 },
        });
        expect(zaehlungAus([])).toEqual({ gesamt: 0, kreise: { voll: 0, halb: 0, "halb-rechts": 0, leer: 0 } });
    });

    it("🔴 dieselbe Zählung wie die Legende unter der Liste (`berechne`), nicht eine zweite", () => {
        const { bilanz } = berechne(
            zeilen,
            { suche: "", filter: new Map(), sortierung: "name", offen: new Set() },
            { form: "flach", facetten: [], sortierungen: {} },
        );
        const { voll, halb, leer } = bilanz;
        expect({ voll, halb, "halb-rechts": bilanz["halb-rechts"], leer }).toEqual(
            kreisZaehlung(zeilen.map((z) => z.kreis)),
        );
        expect(bilanz.treffer).toBe(zaehlungAus(zeilen.map((z) => z.kreis)).gesamt);
    });

    it("🔴 aus dem `zahlen` einer Liste der Inhalte: gesamt sind die aktiven, ● ohne die von Hand angelegten, ◐ diese, ○ die stillgelegten", () => {
        // Die Vorkommen auf der Stage: 5.138 aktiv, keiner von Hand, keiner unterdrückt (Legende „Legacy / Wiki ● 5.138 · manuell ◐ 0 · unterdrückt ○ 0“).
        expect(zaehlungAusZahlen({ aktiv: 5138, editor: 0, stillgelegt: 0 })).toEqual({
            gesamt: 5138,
            kreise: { voll: 5138, halb: 0, "halb-rechts": 0, leer: 0 },
        });
        expect(zaehlungAusZahlen({ aktiv: 4184, editor: 12, stillgelegt: 3 })).toEqual({
            gesamt: 4184,
            kreise: { voll: 4172, halb: 12, "halb-rechts": 0, leer: 3 },
        });
    });

    it("die Korpora kennen keine stillgelegten (○ bleibt 0); mehr Handgemachte als Aktive rechnet nie ins Minus", () => {
        expect(zaehlungAusZahlen({ aktiv: 12, editor: 2 }).kreise).toEqual({
            voll: 10,
            halb: 2,
            "halb-rechts": 0,
            leer: 0,
        });
        expect(zaehlungAusZahlen({ aktiv: 1, editor: 2 }).kreise.voll).toBe(0);
    });
});

describe(`🔴 die Kachel folgt der Ansicht der Karte (Betreiber 2026-10-19: „die tabs in "inhalte" werden nicht automatisch ausgewählt“)`, () => {
    it("Politisch → Herrschaftsgebiete, Kraftlinien → Kraftlinien, Landschaften → die Landschaftskachel", () => {
        expect(kachelFuerAnsicht("political", "orte", EDITOR)).toBe("territorien");
        expect(kachelFuerAnsicht("powerlines", "orte", EDITOR)).toBe("kraftlinien");
        expect(kachelFuerAnsicht("landscapes", "wege", EDITOR)).toBe("regionen");
    });

    it("Standard: Orte oder Wege bleiben, sonst Orte; „Nur Karte“ lässt die Wahl", () => {
        expect(kachelFuerAnsicht("standard", "wege", EDITOR)).toBe("wege");
        expect(kachelFuerAnsicht("standard", "orte", EDITOR)).toBe("orte");
        expect(kachelFuerAnsicht("standard", "kraftlinien", EDITOR)).toBe("orte");
        expect(kachelFuerAnsicht("standard", undefined, EDITOR)).toBe("orte");
        expect(kachelFuerAnsicht("none", "wege", EDITOR)).toBeUndefined();
        // Zuletzt in Standard gewählt: Wege, auch wenn gerade Kraftlinien gewählt sind (Fächer hin und zurück).
        expect(kachelFuerAnsicht("standard", "kraftlinien", EDITOR, "wege")).toBe("wege");
        expect(kachelFuerAnsicht("standard", "kraftlinien", EDITOR, "kraftlinien")).toBe("orte");
    });

    it("🔴 ein Karteninhalt ohne Objekte auf der Karte (Nachschlagen) bleibt gewählt, welche Ansicht die Karte auch zeigt (WI-0254)", () => {
        for (const inhalt of ["quellen", "literatur", "vorkommen", "korpora"]) {
            for (const view of ["standard", "political", "landscapes", "powerlines", "none"] as const)
                expect(kachelFuerAnsicht(view, inhalt, EDITOR), `${inhalt} in ${view}`).toBe(inhalt);
        }
    });

    it("die Wahl einer Kachel landet bei derselben Kachel: nichts schaukelt", () => {
        for (const kachel of kachelGruppen(EDITOR).flatMap((gruppe) => gruppe.kacheln)) {
            if (!kachel.gebaut || kachel.ansicht === undefined) continue;
            expect(kachelFuerAnsicht(kachel.ansicht.view, kachel.id, EDITOR), kachel.id).toBe(kachel.id);
        }
    });
});
