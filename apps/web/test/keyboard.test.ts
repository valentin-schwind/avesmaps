import { describe, expect, it } from "vitest";
import { editorViewer, visitorViewer } from "@avesmaps3d/shared";
import { actionFor, fensterRiegelt, type KeyContext } from "../src/keyboard/install-keyboard.ts";
import {
    CAP_NAMES,
    isCharacterKey,
    matchShortcut,
    shortcutRowKey,
    shortcutsFor,
    toolKeysFor,
    type KeyPress,
} from "../src/keyboard/shortcuts.ts";

/**
 * Die Tastaturtafel der Karte (WI-0016, Spez. § 5, D4).
 */

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
});

const FREE: KeyContext = { typing: false, dialogOpen: false, activatable: false, charactersOff: false };

describe("Escape gehört der Kaskade (WI-0044, WI-0063 4.10)", () => {
    it("🔴 Escape löst die Kaskade aus - auch mit „Tastenkürzel aus“, denn es ist kein Buchstabe", () => {
        expect(actionFor(press("Escape"), FREE)).toBe("escape");
        expect(actionFor(press("Escape"), { ...FREE, charactersOff: true })).toBe("escape");
    });

    it("🪤 nicht, solange jemand schreibt oder ein Fenster offen ist: Dort gehört Escape dem Feld oder Fenster", () => {
        expect(actionFor(press("Escape"), { ...FREE, typing: true })).toBeUndefined();
        expect(actionFor(press("Escape"), { ...FREE, dialogOpen: true })).toBeUndefined();
    });
});

describe("Belegung", () => {
    it("🔴 W A S D wirken wie die Pfeiltasten", () => {
        expect(matchShortcut(press("w"))?.action).toBe("panUp");
        expect(matchShortcut(press("ArrowUp"))?.action).toBe("panUp");
        expect(matchShortcut(press("a"))?.action).toBe("panLeft");
        expect(matchShortcut(press("ArrowLeft"))?.action).toBe("panLeft");
        expect(matchShortcut(press("s"))?.action).toBe("panDown");
        expect(matchShortcut(press("d"))?.action).toBe("panRight");
    });

    it("🔴 mit Umschalt drehen A/D und ←/→, W/S und ↑/↓ neigen", () => {
        // Mit Umschalt meldet der Browser Großbuchstaben.
        expect(matchShortcut(press("A", { shiftKey: true }))?.action).toBe("rotateLeft");
        expect(matchShortcut(press("ArrowLeft", { shiftKey: true }))?.action).toBe("rotateLeft");
        expect(matchShortcut(press("D", { shiftKey: true }))?.action).toBe("rotateRight");
        expect(matchShortcut(press("W", { shiftKey: true }))?.action).toBe("tiltUp");
        expect(matchShortcut(press("ArrowUp", { shiftKey: true }))?.action).toBe("tiltUp");
        expect(matchShortcut(press("S", { shiftKey: true }))?.action).toBe("tiltDown");
    });

    it("🔴 Q und E drehen wie Umschalt + ← → (D13), mit und ohne Umschalt", () => {
        expect(matchShortcut(press("q"))?.action).toBe("rotateLeft");
        expect(matchShortcut(press("e"))?.action).toBe("rotateRight");
        expect(matchShortcut(press("Q", { shiftKey: true }))?.action).toBe("rotateLeft");
        expect(matchShortcut(press("E", { shiftKey: true }))?.action).toBe("rotateRight");
        // Buchstaben sind Einzeltasten: „Tastenkürzel aus“ schaltet auch sie ab.
        expect(isCharacterKey("q")).toBe(true);
    });

    it("🪤 „Umschalt = schneller schieben“ aus Legacy gibt es nicht mehr", () => {
        const withShift = shortcutsFor()
            .filter((row) => row.shift === true)
            .map((row) => row.action);
        expect(withShift.sort()).toEqual(["rotateLeft", "rotateRight", "tiltDown", "tiltUp"]);
    });

    it("🔴 Besucher: F und die Leertaste öffnen die Suche, wie in Legacy (WI-0063 4.11)", () => {
        const rows = shortcutsFor(visitorViewer("test"));
        expect(matchShortcut(press("f"), rows)?.action).toBe("search");
        expect(matchShortcut(press("F", { shiftKey: true }), rows)?.action).toBe("search");
        expect(matchShortcut(press(" "), rows)?.action).toBe("search");
        // Ohne Betrachter gilt die Tafel des Besuchers.
        expect(matchShortcut(press(" "))?.action).toBe("search");
    });

    it("🔴 Editor: F öffnet die Suche, die Leertaste fixiert oder löst die Auswahl (WI-0063 4.11)", () => {
        const rows = shortcutsFor(editorViewer("test"));
        expect(matchShortcut(press("f"), rows)?.action).toBe("search");
        expect(matchShortcut(press(" "), rows)?.action).toBe("pinSelection");
        expect(actionFor(press(" "), FREE, rows)).toBe("pinSelection");
        // Ein fokussierter Knopf behält seine Leertaste, auch im Editor.
        expect(actionFor(press(" "), { ...FREE, activatable: true }, rows)).toBeUndefined();
    });

    it("🪤 die Übersicht und die Wirkung lesen dieselbe Tafel: Die Leertaste steht für jeden Betrachter genau einmal", () => {
        for (const viewer of [visitorViewer("test"), editorViewer("test")]) {
            const rows = shortcutsFor(viewer);
            expect(rows.filter((row) => row.keys.includes(" ")).length).toBe(1);
        }
        expect(shortcutsFor(visitorViewer("test")).some((row) => row.action === "pinSelection")).toBe(false);
    });

    it("+/−, 0 und ?", () => {
        expect(matchShortcut(press("+"))?.action).toBe("zoomIn");
        // Auf deutscher Tastatur ist „=" Umschalt + 0 - Legacy zoomt damit ebenfalls hinein.
        expect(matchShortcut(press("=", { shiftKey: true }))?.action).toBe("zoomIn");
        expect(matchShortcut(press("-"))?.action).toBe("zoomOut");
        expect(matchShortcut(press("0"))?.action).toBe("resetView");
        expect(matchShortcut(press("?", { shiftKey: true }))?.action).toBe("help");
    });

    it("🔴 N bleibt frei für Legacys Ansicht „Standard“", () => {
        expect(matchShortcut(press("n"))).toBeUndefined();
    });

    it("🔴 kein Strg, kein Alt, kein Meta: die gehören dem Browser", () => {
        expect(matchShortcut(press("f", { ctrlKey: true }))).toBeUndefined();
        expect(matchShortcut(press("0", { metaKey: true }))).toBeUndefined();
        expect(matchShortcut(press("ArrowLeft", { altKey: true, shiftKey: true }))).toBeUndefined();
    });

    it("jede Taste steht genau einmal je Umschalt-Zustand in der Tafel", () => {
        for (const viewer of [visitorViewer("test"), editorViewer("test")]) {
            const seen = new Set<string>();
            for (const row of shortcutsFor(viewer)) {
                for (const key of row.keys) {
                    for (const shift of row.shift === undefined ? [false, true] : [row.shift]) {
                        const id = `${key}|${String(shift)}`;
                        expect(seen.has(id), id).toBe(false);
                        seen.add(id);
                    }
                }
            }
        }
    });

    it("🪤 jede Zeile der Übersicht hat einen eigenen Schlüssel: Drehen steht zweimal (Q und Umschalt + A), der Schlüssel doppelte sich", () => {
        for (const viewer of [visitorViewer("test"), editorViewer("test")]) {
            const keys = shortcutsFor(viewer).map(shortcutRowKey);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});

describe("Bedienung als Register jeder Taste (Betreiber 2026-11-09)", () => {
    it("die Werkzeugtasten „Beim Bearbeiten“ sieht nur ein Editor, den Screenshot jeder", () => {
        const visitor = toolKeysFor(visitorViewer("test")).map((group) => group.group);
        const editor = toolKeysFor(editorViewer("test")).map((group) => group.group);
        expect(visitor).toEqual(["toolKeys.screenshot"]);
        expect(editor).toEqual(["toolKeys.edit", "toolKeys.screenshot"]);
    });

    it("🪤 jeder Tastenname in geschweiften Klammern steht in CAP_NAMES, sonst stünde „{ctrl}“ wörtlich in der Übersicht", () => {
        const known = new Set<string>(CAP_NAMES);
        const caps = [
            ...shortcutsFor(editorViewer("test")).flatMap((row) => row.caps),
            ...toolKeysFor(editorViewer("test")).flatMap((group) => group.rows.flatMap((row) => row.caps)),
        ];
        for (const cap of caps) {
            for (const [, name] of cap.matchAll(/\{([^}]+)\}/g)) {
                expect(known.has(name ?? ""), cap).toBe(true);
            }
        }
    });
});

describe("Die Tasten des Routenplaners (WI-0017, Legacy A4)", () => {
    it("R hängt ein Ziel an, Pos1/Ende wählen die Routenart, Bild ↑/↓ blättern die Etappen", () => {
        expect(matchShortcut(press("r"))?.action).toBe("addDestination");
        expect(matchShortcut(press("R", { shiftKey: true }))?.action).toBe("addDestination");
        expect(matchShortcut(press("Home"))?.action).toBe("fastestRoute");
        expect(matchShortcut(press("End"))?.action).toBe("shortestRoute");
        expect(matchShortcut(press("PageUp"))?.action).toBe("previousStage");
        expect(matchShortcut(press("PageDown"))?.action).toBe("nextStage");
    });

    it("🔴 R tippt im Ortsfeld ein r, und „Tastenkürzel aus“ schaltet R ab, die Blättertasten nicht", () => {
        expect(actionFor(press("r"), { ...FREE, typing: true })).toBeUndefined();
        const off = { ...FREE, charactersOff: true };
        expect(actionFor(press("r"), off)).toBeUndefined();
        expect(actionFor(press("PageDown"), off)).toBe("nextStage");
        expect(actionFor(press("Home"), off)).toBe("fastestRoute");
    });
});

describe("Regeln", () => {
    it("💣 nichts, während jemand schreibt, und nichts bei offenem Fenster", () => {
        expect(actionFor(press("f"), { ...FREE, typing: true })).toBeUndefined();
        expect(actionFor(press("ArrowUp"), { ...FREE, dialogOpen: true })).toBeUndefined();
    });

    it("die Leertaste gehört einem fokussierten Knopf, nicht der Suche", () => {
        expect(actionFor(press(" "), { ...FREE, activatable: true })).toBeUndefined();
        expect(actionFor(press("f"), { ...FREE, activatable: true })).toBe("search");
    });

    it("🔴 „Tastenkürzel aus“ schaltet die Zeichentasten ab, die Pfeiltasten nicht (WCAG 2.1.4)", () => {
        const off = { ...FREE, charactersOff: true };
        expect(actionFor(press("w"), off)).toBeUndefined();
        expect(actionFor(press("0"), off)).toBeUndefined();
        expect(actionFor(press("f"), off)).toBeUndefined();
        expect(actionFor(press("ArrowUp"), off)).toBe("panUp");
        expect(actionFor(press("ArrowLeft", { shiftKey: true }), off)).toBe("rotateLeft");
    });

    it("Zeichentasten sind die mit einem Zeichen", () => {
        expect(isCharacterKey("w")).toBe(true);
        expect(isCharacterKey(" ")).toBe(true);
        expect(isCharacterKey("?")).toBe(true);
        expect(isCharacterKey("ArrowUp")).toBe(false);
    });
});

describe("Riegel eines Werkzeugfensters (WI-0238, EDIT-0003 T45 (3))", () => {
    /** Ein Element, das nur die genannten Vorfahren hat. */
    const ziel = (...vorfahren: string[]) => ({
        closest: (selektor: string) => (vorfahren.includes(selektor) ? ({} as Element) : null),
    });

    it("🔴 riegelt mit dem Fokus im Fenster, nicht in der Leiste eines Modus darin und nicht außerhalb", () => {
        expect(fensterRiegelt(ziel("dialog[open]"))).toBe(true);
        // Die Leiste unten im angedockten Fenster: Escape nach einem Klick auf ↶ gilt dem Modus wie über der Karte.
        expect(fensterRiegelt(ziel("dialog[open]", "[data-modusleiste-ziel]"))).toBe(false);
        expect(fensterRiegelt(ziel())).toBe(false);
        expect(fensterRiegelt(null)).toBe(false);
    });
});
