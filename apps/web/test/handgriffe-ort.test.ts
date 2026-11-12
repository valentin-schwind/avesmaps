import { describe, expect, it, vi } from "vitest";
import { editorViewer, type ViewerContext } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen, visibleActions, type EditorMenuSubject } from "../src/editor-menu/action.ts";
import { ortHandgriffe, ortSubjekt, type OrtLage, type OrtWirkung } from "../src/editor-menu/handgriffe-ort.ts";
import { entfernenBitte } from "../src/ortseditor/ort-entfernen.ts";
import { umwandelnBitte } from "../src/ortseditor/ort-umwandeln.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italiano } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";

/**
 * Die Handgriffe am Ort im Register (WI-0128 E15; EDIT-0001 D7, D16, D20; EDIT-0002 §5, §6; EDIT-0003 G10, T5; Schritt O1): dieselben
 * Einträge im Menü am Objekt, im Kartenmenü und in der Gruppe des Infopanels. Was geht, geht; was noch nicht geht, steht mit Grund da
 * (Kartenmenü, Infopanel) oder fehlt (Menü am Objekt, WI-0063 4.2).
 */

const ALLE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const TESTWELT = { mapEditing: "testwelt" as const };
const lage =
    (ueber: Partial<OrtLage> = {}): (() => OrtLage) =>
    () => ({
        rechte: ALLE,
        bearbeiten: TESTWELT,
        laeuft: false,
        ...ueber,
    });
const wirkung = (): OrtWirkung => ({ bearbeiten: vi.fn(), verschieben: vi.fn(), verbergen: vi.fn() });
const ort = (hidden?: true): EditorMenuSubject => ortSubjekt({ id: "ort-1", name: "Gratenfels", hidden });
const viewer = (rechte: readonly string[]): ViewerContext => ({
    source: "test",
    can: (recht) => rechte.includes(recht),
});
const gruende = (zeilen: ReturnType<typeof handgriffZeilen>): Record<string, string | undefined> =>
    Object.fromEntries(zeilen.map((zeile) => [zeile.id, zeile.grund]));

describe("Handgriffe am Ort", () => {
    it("🔴 „Eigenschaften bearbeiten“ heißt der erste Handgriff, in jeder Sprache anders als der Kopf der Gruppe (EDIT-0003 T5)", () => {
        expect(de["ortseditor.handgriff.bearbeiten"]).toBe("Eigenschaften bearbeiten");
        expect(en["ortseditor.handgriff.bearbeiten"]).toBe("Edit properties");
        // Sonst stünde unter dem Kopf „Bearbeiten“ ein Eintrag mit demselben Wort.
        for (const tafel of [de, en, fr, nl, italiano, es, pl]) {
            expect(tafel["ortseditor.handgriff.bearbeiten"]).not.toBe(tafel["ortseditor.gruppe"]);
        }
        const [erste] = handgriffZeilen(ortHandgriffe(lage(), wirkung()), ort(), "infopanel");
        expect(erste).toMatchObject({
            id: "ort-bearbeiten",
            text: "ortseditor.handgriff.bearbeiten",
            zeichen: "bearbeiten",
        });
    });

    it("🔴 die Gruppe im Infopanel in der Folge G10; Neue Kraftlinie später (D16), Neuer Weg beim Weg; EIN „Ort entfernen“ (E22)", () => {
        const zeilen = handgriffZeilen(ortHandgriffe(lage(), wirkung()), ort(), "infopanel");
        expect(gruende(zeilen)).toEqual({
            "ort-bearbeiten": undefined,
            "ort-verschieben": undefined,
            "ort-verbergen": undefined,
            "ort-kraftlinie": "ortseditor.handgriff.grund.spaeter",
            "ort-entfernen": undefined,
        });
        expect(Object.keys(gruende(zeilen))).toEqual([
            "ort-bearbeiten",
            "ort-verschieben",
            "ort-verbergen",
            "ort-kraftlinie",
            "ort-entfernen",
        ]);
        // Betreiber 2026-10-12: die Nadel mit Minus, in Gefahrfarbe; was im Blatt geht, sagt das Blatt.
        expect(zeilen.at(-1)).toMatchObject({
            zeichen: "abnehmen",
            text: "ortseditor.handgriff.entfernen",
            gefahr: true,
        });
    });

    it("das Kartenmenü ohne die späteren Werkzeuge: die stehen nur in der Gruppe", () => {
        const zeilen = handgriffZeilen(ortHandgriffe(lage(), wirkung()), ort(), "karte");
        expect(zeilen.map((zeile) => zeile.id)).toEqual([
            "ort-bearbeiten",
            "ort-verschieben",
            "ort-verbergen",
            "ort-entfernen",
        ]);
    });

    it("🔴 ohne Schreibrecht: Ansehen statt Bearbeiten, Verschieben und Verbergen ohne Recht", () => {
        const zeilen = handgriffZeilen(ortHandgriffe(lage({ rechte: ["use_editor_menu"] }), wirkung()), ort(), "karte");
        expect(zeilen[0]).toMatchObject({ text: "ortseditor.handgriff.ansehen", zeichen: "ansehen" });
        expect(gruende(zeilen)).toMatchObject({
            "ort-verschieben": "ortseditor.handgriff.grund.recht",
            "ort-verbergen": "ortseditor.handgriff.grund.recht",
            "ort-entfernen": "ortseditor.handgriff.grund.recht",
        });
        // Das Recht an der Geometrie braucht erst „Von der Karte nehmen“ im Blatt; „Ort entfernen“ öffnet es schon ohne.
        const ohneGeometrie = lage({
            rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
        });
        expect(gruende(handgriffZeilen(ortHandgriffe(ohneGeometrie, wirkung()), ort(), "karte"))["ort-entfernen"]).toBe(
            undefined,
        );
    });

    it("ausgeschaltetes Bearbeiten nennt den Grund; ein laufender Verschiebemodus sperrt den zweiten; verborgen heißt Zurückholen", () => {
        const zeilen = (ueber: Partial<OrtLage>, hidden?: true) =>
            handgriffZeilen(ortHandgriffe(lage(ueber), wirkung()), ort(hidden), "karte");
        expect(gruende(zeilen({ bearbeiten: { mapEditing: "off" } }))).toMatchObject({
            "ort-verschieben": "ortseditor.handgriff.grund.aus",
            "ort-verbergen": "ortseditor.handgriff.grund.aus",
        });
        expect(gruende(zeilen({ bearbeiten: { mapEditing: "off", environment: "production" } }))).toMatchObject({
            "ort-verbergen": "ortseditor.handgriff.grund.umstieg",
        });
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(zeilen({ laeuft: true }).find((zeile) => zeile.id === "ort-verschieben")).toBeUndefined();
        expect(zeilen({}, true).find((zeile) => zeile.id === "ort-zeigen")).toMatchObject({
            zeichen: "zurueckholen",
            text: "ortseditor.handgriff.zeigen",
        });
        expect(zeilen({}, true).map((zeile) => zeile.id)).not.toContain("ort-verbergen");
    });
});

describe("Menü am Objekt", () => {
    it("🔴 nur, was geht (WI-0063 4.2): Bearbeiten, Verschieben, Verbergen bzw. Zurückholen, Entfernen; ohne Recht nur Bearbeiten", () => {
        const aktionen = ortHandgriffe(lage(), wirkung());
        const ids = (subject: EditorMenuSubject, rechte = ALLE) =>
            visibleActions(aktionen, subject, viewer(rechte)).map((aktion) => aktion.id);
        expect(ids(ort())).toEqual(["ort-bearbeiten", "ort-verschieben", "ort-verbergen", "ort-entfernen"]);
        expect(ids(ort(true))).toEqual(["ort-bearbeiten", "ort-verschieben", "ort-zeigen", "ort-entfernen"]);
        // Mit Stätten bleibt „Ort entfernen“: Das Blatt fragt, was mit ihnen geschieht (E22).
        expect(ids({ ...ort(), answer: { counts: { staetten: 2 } } as never })).toContain("ort-entfernen");
        expect(ids(ort(), ["use_editor_menu"])).toEqual(["ort-bearbeiten"]);
        const aus = ortHandgriffe(lage({ bearbeiten: { mapEditing: "off" } }), wirkung());
        expect(visibleActions(aus, ort(), viewer(ALLE)).map((aktion) => aktion.id)).toEqual(["ort-bearbeiten"]);
    });
});

describe("Wirkung", () => {
    it("alle drei Stellen wirken gleich: Bearbeiten, Verschieben, Verbergen bzw. Zurückholen, Entfernen bittet das Blatt", () => {
        const w = wirkung();
        const aktionen = ortHandgriffe(lage(), w);
        const editor = editorViewer("test");
        expect(fuehreAus(aktionen, "ort-bearbeiten", ort(), editor)).toBe(true);
        expect(fuehreAus(aktionen, "ort-verschieben", ort(), editor)).toBe(true);
        expect(fuehreAus(aktionen, "ort-zeigen", ort(true), editor)).toBe(true);
        expect(fuehreAus(aktionen, "ort-entfernen", ortSubjekt({ id: "ort-2" }), editor)).toBe(true);
        expect(w.bearbeiten).toHaveBeenCalledWith("ort-1");
        expect(w.verschieben).toHaveBeenCalledWith("ort-1");
        expect(w.verbergen).toHaveBeenCalledWith("ort-1", false);
        // „Ort entfernen“ öffnet kein Fenster, es bittet das Blatt (E22).
        expect(entfernenBitte.value?.publicId).toBe("ort-2");
        expect(w.bearbeiten).not.toHaveBeenCalledWith("ort-2");
    });

    it("🔴 ein gesperrter Handgriff wirkt nicht, auch wenn eine Stelle ihn doch meldet", () => {
        const w = wirkung();
        const aktionen = ortHandgriffe(lage({ laeuft: true }), w);
        expect(fuehreAus(aktionen, "ort-verschieben", ort(), editorViewer("test"))).toBe(false);
        expect(w.verschieben).not.toHaveBeenCalled();
    });

    it("der Ort aus der Kachel als Gegenstand: Kennung, Name und „verborgen“", () => {
        expect(ortSubjekt({ id: "ort-3", name: "Punin", hidden: true })).toMatchObject({
            ref: { kind: "place", id: "ort-3" },
            title: "Punin",
            answer: { hidden: true },
        });
        expect(ortSubjekt({ id: "ort-4" }).answer).toEqual({ hidden: false });
    });

    it("🔴 WI-0271 L8: „In Landmarke umwandeln …“ nur an einem Bauwerk; vor dem Cutoff gesperrt mit Grund, ohne Recht ebenso; sonst bittet er um die Rückfrage", () => {
        const bauwerk = ortSubjekt({ id: "ort-9", name: "Donnerfall", subtype: "gebaeude" });
        const stadt = ortSubjekt({ id: "ort-1", name: "Gratenfels", subtype: "stadt" });
        const zeile = (subjekt: EditorMenuSubject, ueber: Partial<OrtLage> = {}) =>
            handgriffZeilen(ortHandgriffe(lage(ueber), wirkung()), subjekt, "infopanel").find(
                (z) => z.id === "ort-umwandeln",
            );
        expect(zeile(stadt)).toBeUndefined();
        expect(zeile(ort())).toBeUndefined();
        expect(zeile(bauwerk)).toMatchObject({ text: "ortseditor.handgriff.umwandeln", grund: undefined });
        expect(
            zeile(bauwerk, { bearbeiten: { mapEditing: "testwelt", environment: "production", umwandelnFrei: false } })
                ?.grund,
        ).toBe("ortseditor.handgriff.grund.vorCutoff");
        expect(zeile(bauwerk, { rechte: ["use_editor_menu"] })?.grund).toBe("ortseditor.handgriff.grund.recht");
        // Die Antwort des Servers trägt die Ortsart in der Unterzeile.
        const antwort = {
            ...bauwerk,
            answer: { subtitle: [{ part: "type", key: "gebaeude" }] },
        } as unknown as EditorMenuSubject;
        expect(zeile(antwort)?.id).toBe("ort-umwandeln");
        fuehreAus(ortHandgriffe(lage(), wirkung()), "ort-umwandeln", bauwerk, viewer(ALLE));
        expect(umwandelnBitte.value?.publicId).toBe("ort-9");
    });
});
