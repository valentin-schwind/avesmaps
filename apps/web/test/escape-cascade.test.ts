import { describe, expect, it } from "vitest";
import { subjectKey, type SubjectRef } from "@avesmaps3d/shared";
import { createEscapeCascade, ESCAPE_STEPS, type EscapeStep } from "../src/keyboard/escape-cascade.ts";
import { createSubjectSelection } from "../src/info-panel/subject-selection.ts";

/**
 * Escape arbeitet von innen nach außen (WI-0063 4.10): EINE geordnete Kaskade statt mehrerer Dokument-Zuhörer.
 */

const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };

/** Ein Teilnehmer, der sich merkt, ob er gefragt wurde, und `open` als „es gab etwas zu schließen“ meldet. */
function participant(log: string[], name: string, open: boolean): () => boolean {
    return () => {
        log.push(name);
        return open;
    };
}

describe("die Reihenfolge, von innen nach außen", () => {
    it("🔴 die Stufen heißen und stehen in der Reihenfolge des Betreibers (WI-0063 §4.10); die Menüs davor (Stage-Fund 2026-10-20)", () => {
        expect(ESCAPE_STEPS).toEqual([
            "menus",
            "action",
            "floating-menu",
            "multi-selection",
            "info-panel",
            "map-selection",
        ]);
    });

    it("🔴 WI-0252: Esc bricht erst die laufende Aktion ab, der nächste hebt die Mehrfachauswahl auf, erst danach geht die Auswahl", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        let aktion = true;
        let mehrfach = true;
        cascade.register("action", () => {
            log.push("aktion");
            const war = aktion;
            aktion = false;
            return war;
        });
        cascade.register("multi-selection", () => {
            log.push("mehrfach");
            const war = mehrfach;
            mehrfach = false;
            return war;
        });
        cascade.register("map-selection", participant(log, "auswahl", true));
        expect(cascade.run()).toBe("action");
        expect(cascade.run()).toBe("multi-selection");
        expect(cascade.run()).toBe("map-selection");
        expect(log).toEqual(["aktion", "aktion", "mehrfach", "aktion", "mehrfach", "auswahl"]);
    });

    it("🔴 ein offenes Menü schließt vor der laufenden Aktion: erst das Kartenmenü, beim zweiten Esc fragt der Modus", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        let offen = true;
        cascade.register("action", participant(log, "modus", true));
        cascade.register("menus", () => {
            log.push("kartenmenü");
            const war = offen;
            offen = false;
            return war;
        });
        expect(cascade.run()).toBe("menus");
        expect(log).toEqual(["kartenmenü"]);
        expect(cascade.run()).toBe("action");
        expect(log).toEqual(["kartenmenü", "kartenmenü", "modus"]);
    });

    it("🔴 eine laufende Editoraktion bricht zuerst ab; die äußeren Stufen erfahren nichts", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("action", participant(log, "aktion", true));
        cascade.register("floating-menu", participant(log, "menü", true));
        cascade.register("info-panel", participant(log, "panel", true));
        expect(cascade.run()).toBe("action");
        expect(log).toEqual(["aktion"]);
    });

    it("ohne Aktion und ohne offenes Menü schließt das Floating Menu (Haken für P9)", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("action", participant(log, "aktion", false));
        cascade.register("floating-menu", participant(log, "menü", true));
        cascade.register("menus", participant(log, "liste", false));
        expect(cascade.run()).toBe("floating-menu");
        expect(log).toEqual(["liste", "aktion", "menü"]);
    });

    it("🔴 ein offenes Menü schließt, OHNE das Infopanel und die Auswahl anzurühren", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("menus", participant(log, "auge", true));
        cascade.register("info-panel", participant(log, "panel", true));
        cascade.register("map-selection", participant(log, "auswahl", true));
        expect(cascade.run()).toBe("menus");
        expect(log).toEqual(["auge"]);
    });

    it("in `menus` schließt jedes offene (Auge-Menü, Fächer, Flächenliste, Kontextmenü), die geschlossenen schweigen", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("menus", participant(log, "auge", true));
        cascade.register("menus", participant(log, "fächer", false));
        cascade.register("menus", participant(log, "liste", true));
        cascade.register("menus", participant(log, "kontext", false));
        expect(cascade.run()).toBe("menus");
        expect(log).toEqual(["auge", "fächer", "liste", "kontext"]);
    });

    it("🔴 ohne offenes Menü schließt das sichtbare Infopanel; die Auswahl der Karte folgt erst danach", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("menus", participant(log, "auge", false));
        cascade.register("info-panel", participant(log, "panel", true));
        cascade.register("map-selection", participant(log, "auswahl", true));
        expect(cascade.run()).toBe("info-panel");
        expect(log).toEqual(["auge", "panel"]);
    });

    it("sonst hebt die letzte Stufe die Auswahl der Karte auf; ohne alles bleibt die Taste unverbraucht", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        cascade.register("info-panel", participant(log, "panel", false));
        cascade.register("map-selection", participant(log, "auswahl", true));
        expect(cascade.run()).toBe("map-selection");
        expect(createEscapeCascade().run()).toBeUndefined();
    });

    it("eine abgemeldete Stufe wird nicht mehr gefragt", () => {
        const cascade = createEscapeCascade();
        const log: string[] = [];
        const remove = cascade.register("menus", participant(log, "auge", true));
        remove();
        expect(cascade.run()).toBeUndefined();
        expect(log).toEqual([]);
    });
});

describe("🔴 mit der echten Auswahl: ein Menü schließt, ohne die Auswahl aufzuheben", () => {
    function wired(): {
        cascade: ReturnType<typeof createEscapeCascade>;
        selection: ReturnType<typeof createSubjectSelection>;
        menu: { open: boolean };
        steps: EscapeStep[];
    } {
        const cascade = createEscapeCascade();
        const selection = createSubjectSelection({
            client: { detail: () => new Promise(() => undefined), resolveLink: () => Promise.reject(new Error("-")) },
            effects: { present: () => undefined, clear: () => undefined, fly: () => undefined },
        });
        const menu = { open: true };
        cascade.register("menus", () => {
            if (!menu.open) return false;
            menu.open = false;
            return true;
        });
        cascade.register("info-panel", () => selection.escapeVisible());
        cascade.register("map-selection", () => selection.escapeSelection());
        const steps: EscapeStep[] = [];
        return { cascade, selection, menu, steps };
    }

    it("erstes Escape: das Menü; zweites: das Panel samt Auswahl; drittes: nichts mehr zu tun außer der Kartenauswahl", () => {
        const { cascade, selection, menu } = wired();
        selection.openSubject(GARETH, { source: "map", camera: "none" });
        expect(cascade.run()).toBe("menus");
        expect(menu.open).toBe(false);
        // Die Auswahl und das Panel stehen noch.
        expect(selection.selected.value).toEqual(GARETH);
        expect(selection.panelVisible.value).toBe(true);
        expect(cascade.run()).toBe("info-panel");
        expect(selection.selected.value).toBeUndefined();
        expect(cascade.run()).toBe("map-selection");
    });

    it("🔴 ein eingeklapptes Panel zählt nicht als sichtbar: Escape hebt die Auswahl dann in der letzten Stufe auf", () => {
        const { cascade, selection, menu } = wired();
        menu.open = false;
        selection.openSubject(GARETH, { source: "map", camera: "none" });
        selection.collapsePanel();
        expect(cascade.run()).toBe("map-selection");
        expect(subjectKey(GARETH)).toBe("place:80558060-4299-54aa-b520-814b10819885");
        expect(selection.selected.value).toBeUndefined();
    });
});
