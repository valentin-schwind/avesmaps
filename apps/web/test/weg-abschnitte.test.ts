import { describe, expect, it, vi } from "vitest";
import type { EditorPathStreet } from "@avesmaps3d/shared";
import { wegHandgriffe, type WegLage } from "../src/editor-menu/handgriffe-weg";
import { handgriffZeilen, visibleActions, type EditorMenuSubject } from "../src/editor-menu/action";
import { ausserhalb, createWegAbschnitte } from "../src/wegeditor/weg-abschnitte";

/**
 * Abschnitte im Menü am Weg (WI-0177; EDIT-0003 T49; Betreiber 2026-10-17: „abschnittseditierung perfekt“). Problemfälle: Nach dem
 * ersten Klick fehlen „Wegkurve bearbeiten ›“ und die anderen, man sieht nicht, dass es Abschnitte gibt; ein einzelner Abschnitt hat
 * kein Untermenü; die Folge ist die der Kennungen; ein Ende ohne Ort steht leer; ein Abschnitt außerhalb des Bilds sagt es nicht;
 * „Weg entfernen ›“ hat keine ganze Straße; nach dem zweiten Klick stehen die Untermenüs statt der flachen Einträge.
 */

const A = "0b0b0b0b-0000-4000-8000-0000000000a1";
const B = "0b0b0b0b-0000-4000-8000-0000000000a2";
const STRASSE: EditorPathStreet = {
    id: A,
    name: "Halwartsstieg",
    subtype: "Strasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [
        {
            id: B,
            revision: 3,
            labelVisible: true,
            wiki: false,
            points: 4,
            bounds: [0, 0, 10, 10],
            von: "Angbar",
            bis: "Ferdok",
        },
        { id: A, revision: 5, labelVisible: true, wiki: false, points: 3, bounds: [100, 100, 110, 110], von: "Ferdok" },
    ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

function abschnitte() {
    return createWegAbschnitte(
        { strasse: vi.fn(async () => STRASSE) },
        {
            bild: () => ({ x0: 0, y0: 0, x1: 50, y1: 50 }),
            texte: () => ({ abzweig: "Abzweig", ausserhalb: "außerhalb" }),
        },
    );
}

const weg: EditorMenuSubject = {
    ref: { kind: "path", anchor: A, chain: "Halwartsstieg:Strasse" },
    title: "Halwartsstieg",
    art: undefined,
    answer: undefined,
};
const viewer = { can: () => true } as never;

describe("Abschnitte der Straße", () => {
    it("🔴 in der Folge des Servers, „n · Von – Bis“, ein Ende ohne Ort heißt Abzweig, außerhalb des Bilds steht rechts", async () => {
        const a = abschnitte();
        expect(a.wahlen(A)).toEqual([]);
        await flush();
        expect(a.wahlen(A)).toEqual([
            { id: B, text: "1 · Angbar – Ferdok", vorschau: true },
            { id: A, text: "2 · Ferdok – Abzweig", hinweis: "außerhalb", vorschau: true },
        ]);
        // Unter jedem Abschnitt gemerkt: ein Lesen je Straße.
        expect(a.wahlen(B)).toHaveLength(2);
        await expect(a.bereit(B)).resolves.toBeUndefined();
        expect(ausserhalb(undefined, { x0: 0, y0: 0, x1: 1, y1: 1 })).toBe(false);
    });
});

describe("Handgriffe am Weg: Abschnitte im Menü (T49)", () => {
    const lage = (teil: Partial<WegLage> = {}): WegLage => ({
        rechte: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        bearbeiten: { mapEditing: "testwelt" } as never,
        laeuft: false,
        wahlen: () => [
            { id: B, text: "1 · Angbar – Ferdok", vorschau: true },
            { id: A, text: "2 · Ferdok – Abzweig", vorschau: true },
        ],
        ganzeStrasse: (n) => `Ganze Straße (${String(n)} Abschnitte) …`,
        ...teil,
    });
    const wirkung = {
        eigenschaften: vi.fn(),
        wegkurve: vi.fn(),
        vereinfachen: vi.fn(),
        neuAbOrt: vi.fn(),
        entfernen: vi.fn(),
        entfernenStrasse: vi.fn(),
    };

    it("🔴 erster Klick: im Menü am Objekt „Wegkurve bearbeiten ›“, „Wegkurve vereinfachen ›“ und „Weg entfernen ›“ mit den Abschnitten", () => {
        const sichtbar = visibleActions(
            wegHandgriffe(() => lage(), wirkung),
            weg,
            viewer,
        ).map((a) => a.id);
        expect(sichtbar).toEqual([
            "weg-eigenschaften",
            "weg-wegkurve-strasse",
            "weg-vereinfachen-strasse",
            "weg-entfernen-strasse",
        ]);
        const entfernen = wegHandgriffe(() => lage(), wirkung).find((a) => a.id === "weg-entfernen-strasse")!;
        expect(entfernen.auswahl!(weg).map((w) => w.text)).toEqual([
            "1 · Angbar – Ferdok",
            "2 · Ferdok – Abzweig",
            "Ganze Straße (2 Abschnitte) …",
        ]);
    });

    it("🔴 zweiter Klick: die Einträge flach am markierten Abschnitt, ohne Untermenü", () => {
        const sichtbar = visibleActions(
            wegHandgriffe(() => lage({ abschnitt: A }), wirkung),
            weg,
            viewer,
        ).map((a) => a.id);
        expect(sichtbar).toEqual([
            "weg-eigenschaften",
            "weg-wegkurve-abschnitt",
            "weg-vereinfachen-abschnitt",
            "weg-entfernen-abschnitt",
        ]);
    });

    it("🔴 eine Wahl startet am gewählten Abschnitt; „Ganze Straße“ öffnet das Blatt für die Straße", () => {
        const griffe = wegHandgriffe(() => lage(), wirkung);
        griffe.find((a) => a.id === "weg-wegkurve-strasse")!.run({ subject: weg, viewer, wahl: B });
        expect(wirkung.wegkurve).toHaveBeenCalledWith(B);
        griffe.find((a) => a.id === "weg-entfernen-strasse")!.run({ subject: weg, viewer, wahl: "strasse" });
        expect(wirkung.entfernenStrasse).toHaveBeenCalledWith(A);
    });

    it("am Finger trägt das Blatt des langen Drucks die Untermenüs statt der Einträge am Abschnitt", () => {
        const ids = handgriffZeilen(
            wegHandgriffe(() => lage({ finger: true }), wirkung),
            weg,
            "karte",
        ).map((z) => z.id);
        expect(ids).toContain("weg-wegkurve-finger");
        expect(ids).not.toContain("weg-wegkurve");
        const amRechner = handgriffZeilen(
            wegHandgriffe(() => lage(), wirkung),
            weg,
            "karte",
        ).map((z) => z.id);
        expect(amRechner).toContain("weg-wegkurve");
        expect(amRechner).not.toContain("weg-wegkurve-finger");
    });

    it("🔴 solange die Straße lädt: kein leeres Untermenü; am Finger steht bis dahin der Eintrag am Abschnitt", () => {
        const laedt = (teil: Partial<WegLage> = {}) =>
            wegHandgriffe(() => lage({ wahlen: () => [], ...teil }), wirkung);
        expect(visibleActions(laedt(), weg, viewer).map((a) => a.id)).toEqual(["weg-eigenschaften"]);
        const amFinger = handgriffZeilen(laedt({ finger: true }), weg, "karte").map((z) => z.id);
        expect(amFinger).toContain("weg-wegkurve");
        expect(amFinger).not.toContain("weg-wegkurve-finger");
    });

    it("ein einziger Abschnitt steht trotzdem im Untermenü: man sieht, dass es Abschnitte gibt", () => {
        const griffe = wegHandgriffe(
            () => lage({ wahlen: () => [{ id: A, text: "1 · Ferdok – Abzweig", vorschau: true }] }),
            wirkung,
        );
        expect(griffe.find((a) => a.id === "weg-wegkurve-strasse")!.auswahl!(weg)).toHaveLength(1);
    });
});
