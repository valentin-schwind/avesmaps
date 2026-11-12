import { describe, expect, it, vi } from "vitest";
import type { OrtLage } from "../src/editor-menu/handgriffe-ort.ts";
import { gipfelHandgriffe, gipfelSubjekt, type GipfelLage } from "../src/editor-menu/handgriffe-gipfel.ts";
import { fuehreAus } from "../src/editor-menu/action.ts";
import { kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";
import type { ViewerContext } from "@avesmaps3d/shared";

/**
 * Die Handgriffe am Gipfel (WI-0178 P2; Fassung 16: Kartenmenü mit „Gipfel“: „Eigenschaften bearbeiten“, „Auf der Karte verschieben“
 * samt „Doppelklick“). Problemfälle: Der Rechtsklick aufs ▲ zeigt kein Menü am Gipfel; „Verschieben“ geht ohne Recht an der Geometrie
 * oder während ein Modus läuft; der Doppelklick gehört einem anderen Handgriff.
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
const lage =
    (ueber: Partial<OrtLage> = {}): (() => GipfelLage) =>
    () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" }, laeuft: false, ...ueber });
const uebersetze = (key: string): string => `«${key}»`;
const DOTZ = gipfelSubjekt({ id: "c8c8c8c8-0000-4000-8000-000000000003", name: "Dotz", subtype: "berggipfel" });

describe("Handgriffe am Gipfel (P2)", () => {
    it("🔴 der Rechtsklick aufs ▲: „Eigenschaften bearbeiten“ und „Auf der Karte verschieben“ mit dem Kürzel „Doppelklick“", () => {
        const wirkung = { eigenschaften: vi.fn(), verschieben: vi.fn(), entfernen: vi.fn() };
        const [objekt] = kartenAbschnitte({
            actions: gipfelHandgriffe(lage(), wirkung),
            subject: DOTZ,
            anlegen: [],
            uebersetze,
        });
        expect(objekt?.id).toBe("objekt");
        expect(objekt?.eintraege.map((eintrag) => [eintrag.id, eintrag.text, eintrag.grund])).toEqual([
            ["gipfel-bearbeiten", "«landschaftseditor.griff.oeffnen»", undefined],
            ["gipfel-verschieben", "«landschaftseditor.beschriftung.verschieben»", undefined],
            ["gipfel-entfernen", "«landschaftseditor.gipfel.entfernen»", undefined],
        ]);
        expect(objekt?.eintraege[1]?.hinweis).toBe("«editorMenu.kuerzel.doppelklick»");
        expect(DOTZ.ref).toEqual({ kind: "peak", id: "c8c8c8c8-0000-4000-8000-000000000003" });
    });

    it("„Verschieben“ ohne Recht an der Geometrie, während ein Modus läuft oder bei ausgeschaltetem Bearbeiten mit Grund", () => {
        const grund = (ueber: Partial<OrtLage>) =>
            kartenAbschnitte({
                actions: gipfelHandgriffe(lage(ueber), {
                    eigenschaften: vi.fn(),
                    verschieben: vi.fn(),
                    entfernen: vi.fn(),
                }),
                subject: DOTZ,
                anlegen: [],
                uebersetze,
            })[0]?.eintraege.find((eintrag) => eintrag.id === "gipfel-verschieben")?.grund;
        expect(grund({ rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] })).toBe(
            "«sonderrollen.grund.gebirge»",
        );
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(grund({ laeuft: true })).toBeUndefined();
        expect(grund({ bearbeiten: undefined })).toBe("«ortseditor.handgriff.grund.aus»");
    });

    it("die Wirkung bekommt Kennung und Namen des Gipfels", () => {
        const wirkung = { eigenschaften: vi.fn(), verschieben: vi.fn(), entfernen: vi.fn() };
        const viewer = { can: () => true } as unknown as ViewerContext;
        fuehreAus(gipfelHandgriffe(lage(), wirkung), "gipfel-verschieben", DOTZ, viewer);
        fuehreAus(gipfelHandgriffe(lage(), wirkung), "gipfel-bearbeiten", DOTZ, viewer);
        expect(wirkung.verschieben).toHaveBeenCalledWith("c8c8c8c8-0000-4000-8000-000000000003", "Dotz");
        expect(wirkung.eigenschaften).toHaveBeenCalledWith("c8c8c8c8-0000-4000-8000-000000000003", "Dotz");
    });

    it("🔴 „Gipfel entfernen …“ steht rot zuletzt, gesperrt wie das Verschieben; die Wirkung bekommt Kennung und Namen", () => {
        const wirkung = { eigenschaften: vi.fn(), verschieben: vi.fn(), entfernen: vi.fn() };
        const eintrag = (ueber: Partial<OrtLage> = {}) =>
            kartenAbschnitte({
                actions: gipfelHandgriffe(lage(ueber), wirkung),
                subject: DOTZ,
                anlegen: [],
                uebersetze,
            })
                .flatMap((abschnitt) => abschnitt.eintraege)
                .find((e) => e.id === "gipfel-entfernen");
        expect(eintrag()).toMatchObject({ text: "«landschaftseditor.gipfel.entfernen»", grund: undefined });
        expect(
            eintrag({ rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] })?.grund,
        ).toBe("«sonderrollen.grund.gebirge»");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(eintrag({ laeuft: true })).toBeUndefined();
        fuehreAus(gipfelHandgriffe(lage(), wirkung), "gipfel-entfernen", DOTZ, {
            can: () => true,
        } as unknown as ViewerContext);
        expect(wirkung.entfernen).toHaveBeenCalledWith("c8c8c8c8-0000-4000-8000-000000000003", "Dotz");
    });
});
