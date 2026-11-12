import { describe, expect, it, vi } from "vitest";
import type { ViewerContext } from "@avesmaps3d/shared";
import { fuehreAus, visibleActions } from "../src/editor-menu/action.ts";
import { wetterHandgriffe, wetterSubjekt, type WetterLage } from "../src/editor-menu/handgriffe-wetter.ts";
import { kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";
import { meldeWetterIconSuche, wetterIconAm } from "../src/map/wetter/wetter-treffer.ts";

/**
 * Die Handgriffe am Wetter-Icon (WI-0288; Betreiber 2026-11-08: „der wettereditor ist noch nicht so wie die andern editoren“): Kartenmenü, Menü am
 * Objekt und Infopanel lesen sie aus dem Register wie an Ort, Gipfel und Fläche. Problemfälle: Der Rechtsklick auf ein Icon zeigt keine Handgriffe;
 * „Verbergen“ und „Zurückholen“ stehen beide da; ohne Recht oder bei ausgeschaltetem Bearbeiten schreibt ein Handgriff; die Folge der Gruppen weicht ab.
 */
const ID = "02880000-0000-4000-8000-000000000001";
const uebersetze = (key: string): string => `«${key}»`;
const lage =
    (ueber: Partial<WetterLage> = {}): (() => WetterLage) =>
    () => ({ darf: true, bearbeiten: { mapEditing: "testwelt" }, laeuft: false, sichtbar: () => true, ...ueber });
const wirkung = () => ({ oeffnen: vi.fn(), sichtbar: vi.fn(), entfernen: vi.fn() });
const ICON = wetterSubjekt({ id: ID, name: "Westwinddrift", art: "wind" });
const eintraege = (ueber: Partial<WetterLage> = {}) =>
    kartenAbschnitte({ actions: wetterHandgriffe(lage(ueber), wirkung()), subject: ICON, anlegen: [], uebersetze })[0]
        ?.eintraege ?? [];

describe("Handgriffe am Wetter-Icon", () => {
    it("🔴 Rechtsklick aufs Icon: Bearbeiten · Sichtbarkeit · Entfernen in der festen Folge, je Icon nur „Verbergen“ ODER „Zurückholen“", () => {
        expect(ICON.ref).toEqual({ kind: "wetterSymbol", id: ID });
        expect(eintraege().map((e) => [e.id, e.text, e.grund, e.gefahr === true])).toEqual([
            ["wetter-bearbeiten", "«wettereditor.griff.bearbeiten»", undefined, false],
            ["wetter-verbergen", "«wettereditor.griff.verbergen»", undefined, false],
            ["wetter-entfernen", "«wettereditor.entfernen»", undefined, true],
        ]);
        expect(eintraege({ sichtbar: () => false }).map((e) => e.id)).toEqual([
            "wetter-bearbeiten",
            "wetter-zeigen",
            "wetter-entfernen",
        ]);
    });

    it("ohne Schreibrecht „Ansehen“, und die schreibenden stehen mit Grund; bei ausgeschaltetem Bearbeiten ebenso", () => {
        const ohne = eintraege({ darf: false });
        expect(ohne[0]?.text).toBe("«wettereditor.griff.ansehen»");
        expect(ohne.find((e) => e.id === "wetter-verbergen")?.grund).toBe("«ortseditor.handgriff.grund.recht»");
        expect(eintraege({ bearbeiten: undefined }).find((e) => e.id === "wetter-entfernen")?.grund).toBe(
            "«ortseditor.handgriff.grund.aus»",
        );
    });

    it("das Menü am Objekt zeigt nur, was geht; die Wirkung bekommt die Kennung des Icons", () => {
        const viewer = { can: () => true } as unknown as ViewerContext;
        expect(
            visibleActions(wetterHandgriffe(lage({ darf: false }), wirkung()), ICON, viewer).map((a) => a.id),
        ).toEqual(["wetter-bearbeiten"]);
        const tut = wirkung();
        const griffe = wetterHandgriffe(lage(), tut);
        fuehreAus(griffe, "wetter-bearbeiten", ICON, viewer);
        fuehreAus(griffe, "wetter-verbergen", ICON, viewer);
        fuehreAus(griffe, "wetter-entfernen", ICON, viewer);
        expect(tut.oeffnen).toHaveBeenCalledWith(ID);
        expect(tut.sichtbar).toHaveBeenCalledWith(ID, false);
        expect(tut.entfernen).toHaveBeenCalledWith(ID);
    });

    it("ein namenloses Icon heißt im Menü nach seiner Art; ohne Symbolebene liegt kein Icon unter dem Zeiger", () => {
        expect(wetterSubjekt({ id: ID, name: " ", art: "stroemung" }).title).toBe("Meeresströmung");
        expect(wetterIconAm(10, 10)).toBeUndefined();
        const ab = meldeWetterIconSuche((px) => (px < 20 ? { id: ID, name: "", art: "wirbel" } : undefined));
        expect(wetterIconAm(10, 10)?.id).toBe(ID);
        expect(wetterIconAm(30, 10)).toBeUndefined();
        ab();
        expect(wetterIconAm(10, 10)).toBeUndefined();
    });
});
