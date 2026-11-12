import { describe, expect, it, vi } from "vitest";
import { sessionViewer } from "@avesmaps3d/shared";
import { handgriffZeilen, type EditorAction, type EditorMenuSubject } from "../src/editor-menu/action";
import {
    DOPPELKLICK_MS,
    doppelklick,
    doppelklickGriff,
    installObjektDoppelklick,
    type DoppelklickSeite,
} from "../src/editor-menu/doppelklick";
import { ortHandgriffe, ortSubjekt } from "../src/editor-menu/handgriffe-ort";
import { wegHandgriffe, wegSubjekt, type WegLage } from "../src/editor-menu/handgriffe-weg";
import type { HitContext, InteractionOwner } from "../src/map/interaction/types";

/**
 * Der gemeinsame Doppelklick auf Objekte (WI-0177; EDIT-0003 R3, T19, §2a). Problemfälle: Der zweite Klick dreht die Auswahl weiter
 * (übereinanderliegende Flächen) statt dem gewählten Objekt zu gelten; die Karte zoomt zusätzlich; mehrere Flächen werden still
 * gewählt; das Kürzel „Doppelklick“ steht an einem anderen Eintrag als dem, was er tut; im Modus ins Leere passiert nichts.
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
const viewer = sessionViewer("test", ALLE);
const flaeche = (id: string): EditorMenuSubject => ({
    ref: { kind: "area", id },
    title: id,
    art: "Wald",
    answer: undefined,
});
const WALD = flaeche("wald");
const SEE = flaeche("see");

function form(run: (s: EditorMenuSubject) => void, sperre?: () => "ortseditor.handgriff.grund.recht"): EditorAction {
    return {
        id: "flaeche-gebietsform",
        kinds: ["area"],
        capability: "edit_map_geometry",
        gruppe: "bearbeiten",
        label: "landschaftseditor.griff.bearbeiten",
        doppelklick: true,
        ...(sperre === undefined ? {} : { sperre }),
        run: ({ subject }) => run(subject),
    };
}
const oeffnen: EditorAction = {
    id: "flaeche-bearbeiten",
    kinds: ["area"],
    capability: "use_editor_menu",
    gruppe: "bearbeiten",
    label: "landschaftseditor.griff.oeffnen",
    run: () => undefined,
};

function seite(teil: Partial<DoppelklickSeite> & { actions?: () => readonly EditorAction[] } = {}): DoppelklickSeite {
    return {
        aktiv: () => true,
        layers: () => [],
        modus: () => undefined,
        ziel: () => ({ flaechen: [] }),
        actions: () => [],
        viewer,
        waehle: vi.fn(),
        grund: vi.fn(),
        ...teil,
    };
}
const context = { screen: { x: 5, y: 6 }, point: { x: 50, y: 60 } } as unknown as HitContext;

describe("Doppelklick: was er tut", () => {
    it("🔴 an EINER Fläche löst er den Handgriff mit `doppelklick` aus, nicht den ersten des Menüs", () => {
        const gestartet = vi.fn();
        const s = seite({ ziel: () => ({ flaechen: [WALD] }), actions: () => [oeffnen, form(gestartet)] });
        expect(doppelklick(s, context)).toBe(true);
        expect(gestartet).toHaveBeenCalledWith(WALD);
    });

    it("🔴 mehrere Flächen: zuerst „Welche Fläche bearbeiten?“, nichts still gewählt", () => {
        const gestartet = vi.fn();
        const s = seite({ ziel: () => ({ flaechen: [WALD, SEE] }), actions: () => [form(gestartet)] });
        expect(doppelklick(s, context)).toBe(true);
        expect(s.waehle).toHaveBeenCalledWith([WALD, SEE], { x: 5, y: 6 });
        expect(gestartet).not.toHaveBeenCalled();
    });

    it("🔴 im Modus heißt er ins Leere „Fertig“", () => {
        const fertig = vi.fn();
        const ziel = vi.fn(() => ({ flaechen: [WALD] }));
        expect(doppelklick(seite({ modus: () => ({ fertig }), ziel }), context)).toBe(true);
        expect(fertig).toHaveBeenCalledTimes(1);
        expect(ziel).not.toHaveBeenCalled();
    });

    it("gesperrt sagt er warum und tut nichts", () => {
        const gestartet = vi.fn();
        const s = seite({
            ziel: () => ({ flaechen: [WALD] }),
            actions: () => [form(gestartet, () => "ortseditor.handgriff.grund.recht")],
        });
        expect(doppelklick(s, context)).toBe(true);
        expect(s.grund).toHaveBeenCalledWith("ortseditor.handgriff.grund.recht");
        expect(gestartet).not.toHaveBeenCalled();
    });

    it("ins Leere ohne Modus, oder ohne Handgriff mit `doppelklick`: nichts, die Karte zoomt wie immer", () => {
        expect(doppelklick(seite(), context)).toBe(false);
        expect(doppelklick(seite({ ziel: () => ({ flaechen: [WALD] }), actions: () => [oeffnen] }), context)).toBe(
            false,
        );
    });

    it("🔴 am Weg startet er die Wegkurve am Abschnitt unter dem Zeiger; das Kürzel steht genau dort", () => {
        const wegkurve = vi.fn();
        const lage: WegLage = { rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false };
        const actions = wegHandgriffe(() => lage, {
            eigenschaften: vi.fn(),
            wegkurve,
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        const abschnitt = wegSubjekt(
            {
                publicId: "5a5a5a5a-0000-4000-8000-0000000000a1",
                name: "Reichsstraße 3",
                subtype: "Reichsstrasse",
                isBach: false,
            },
            "Reichsstraße 3",
        );
        expect(doppelklickGriff(actions, abschnitt, viewer)?.id).toBe("weg-wegkurve");
        expect(
            doppelklick(seite({ ziel: () => ({ einzeln: abschnitt, flaechen: [] }), actions: () => actions }), context),
        ).toBe(true);
        expect(wegkurve).toHaveBeenCalledWith("5a5a5a5a-0000-4000-8000-0000000000a1");
        const mitKuerzel = handgriffZeilen(actions, abschnitt, "karte").filter((z) => z.hinweis !== undefined);
        expect(mitKuerzel.map((z) => [z.id, z.hinweis])).toEqual([["weg-wegkurve", "editorMenu.kuerzel.doppelklick"]]);
    });
});

describe("Doppelklick am Ort (R3: die Eigenschaften)", () => {
    it("🔴 öffnet „Eigenschaften bearbeiten“; das Kürzel steht dort und nur dort", () => {
        const bearbeiten = vi.fn();
        const lage = { rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false };
        const actions = ortHandgriffe(() => lage as never, {
            bearbeiten,
            verschieben: vi.fn(),
            verbergen: vi.fn(),
        });
        const gratenfels = ortSubjekt({ id: "7527ed5b-303a-57af-926e-ed41a8b82dfc", name: "Gratenfels" });
        expect(doppelklickGriff(actions, gratenfels, viewer)?.id).toBe("ort-bearbeiten");
        expect(
            doppelklick(
                seite({ ziel: () => ({ einzeln: gratenfels, flaechen: [] }), actions: () => actions }),
                context,
            ),
        ).toBe(true);
        expect(bearbeiten).toHaveBeenCalledWith("7527ed5b-303a-57af-926e-ed41a8b82dfc");
        const mitKuerzel = handgriffZeilen(actions, gratenfels, "karte").filter((z) => z.hinweis !== undefined);
        expect(mitKuerzel.map((z) => z.id)).toEqual(["ort-bearbeiten"]);
    });
});

describe("Doppelklick: der Besitzer im Koordinator", () => {
    function aufbau(tut = true) {
        let owner: InteractionOwner | undefined;
        let zoom: ((event: { preventDefault(): void }) => void) | undefined;
        let beobachter: ((info: { claimedBy: string | undefined }) => void) | undefined;
        let zeit = 1000;
        const map = {
            on: vi.fn((_art: string, f: typeof zoom) => (zoom = f)),
            off: vi.fn(),
        };
        const coordinator = {
            register: vi.fn((o: InteractionOwner) => {
                owner = o;
                return () => (owner = undefined);
            }),
            observe: vi.fn((_art: string, f: typeof beobachter) => {
                beobachter = f;
                return () => (beobachter = undefined);
            }),
        };
        const ausgeloest = vi.fn(() => tut);
        const s = seite({ ziel: () => ({ flaechen: [WALD] }), actions: () => [form(() => ausgeloest())] });
        const ab = installObjektDoppelklick(map as never, coordinator as never, { ...s, jetzt: () => zeit });
        const klick = (x: number, y: number, nach = 0) => {
            zeit += nach;
            const c = { ...context, point: { x, y } } as HitContext;
            const claim = owner!.hit(c);
            if (claim) owner!.apply("click", claim as never, c);
            return claim;
        };
        /** Ein Klick, den ein Besitzer darüber nahm: Dieser hier sieht ihn nicht, der Beobachter schon. */
        const genommen = (von: string, nach = 0) => {
            zeit += nach;
            beobachter?.({ claimedBy: von });
        };
        return {
            owner: () => owner,
            klick,
            genommen,
            ausgeloest,
            zoom: () => zoom!,
            ab,
            map,
            beobachter: () => beobachter,
        };
    }

    it("🔴 der erste Klick fällt durch (er wählt wie jeder Klick), erst der zweite am selben Fleck gehört dem Doppelklick", () => {
        const a = aufbau();
        expect(a.owner()!.priority).toBeLessThan(91);
        expect(a.owner()!.priority).toBeGreaterThan(80);
        expect(a.klick(100, 100)).toBeUndefined();
        expect(a.klick(103, 102, 200)).toEqual({});
        expect(a.ausgeloest).toHaveBeenCalledTimes(1);
        // Ein dritter Klick beginnt wieder von vorn.
        expect(a.klick(103, 102, 100)).toBeUndefined();
    });

    it("zu spät oder zu weit weg ist kein Doppelklick", () => {
        const a = aufbau();
        a.klick(100, 100);
        expect(a.klick(100, 100, DOPPELKLICK_MS + 1)).toBeUndefined();
        expect(a.klick(110, 100, 100)).toBeUndefined();
        expect(a.ausgeloest).not.toHaveBeenCalled();
    });

    it("🔴 die Karte zoomt nur, wenn der Doppelklick nichts tat", () => {
        const a = aufbau();
        a.klick(100, 100);
        a.klick(100, 100, 100);
        const getan = { preventDefault: vi.fn() };
        a.zoom()(getan);
        expect(getan.preventDefault).toHaveBeenCalled();
        // Ins Leere (nichts darunter): Die Karte zoomt.
        const leer = aufbau();
        const leerSeite = { preventDefault: vi.fn() };
        leer.zoom()(leerSeite);
        expect(leerSeite.preventDefault).not.toHaveBeenCalled();
    });

    it("🔴 T59: nahm der Modus den zweiten Klick (Punkt in die Fläche), ist ein dritter am selben Fleck kein „Fertig“", () => {
        const a = aufbau();
        expect(a.klick(100, 100)).toBeUndefined();
        a.genommen("geometry-edit", 100);
        expect(a.klick(100, 100, 100)).toBeUndefined();
        expect(a.ausgeloest).not.toHaveBeenCalled();
        // Ein Klick, den ein anderer nahm (etwa die Auswahl darunter), zählt weiter: Der erste fällt ja immer durch.
        const b = aufbau();
        b.klick(100, 100);
        b.genommen("area-select", 0);
        expect(b.klick(100, 100, 100)).toEqual({});
    });

    it("die Abmeldung nimmt Besitzer und Zoom-Sperre", () => {
        const a = aufbau();
        a.ab();
        expect(a.owner()).toBeUndefined();
        expect(a.beobachter()).toBeUndefined();
        expect(a.map.off).toHaveBeenCalledWith("dblclick", expect.any(Function));
    });
});
