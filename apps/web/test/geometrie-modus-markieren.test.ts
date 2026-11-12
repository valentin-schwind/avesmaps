import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { zeige } = vi.hoisted(() => ({ zeige: vi.fn() }));
vi.mock("../src/feedback/toast", () => ({ showToast: vi.fn() }));
vi.mock("../src/map/geometrie/schicht", () => ({
    GEOMETRIE_ANFASSER_TREFFER: "anfasser",
    GEOMETRIE_KANTE_TREFFER: "kante",
    GEOMETRIE_STEUER_TREFFER: "steuer",
    installGeometrieSchicht: () => ({ zeige, entferne: vi.fn() }),
}));

import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { FLAECHE, GEBIET, SPRACHE, WEG } from "../src/map/geometrie/arten";
import type { Bild } from "../src/map/geometrie/bild";
import type { Aenderung, GeometrieArt, Punkt, Stelle, Teil, Ziel } from "../src/map/geometrie/geometrie";
import { installGeometrieModus, type GeometrieEingabe } from "../src/map/geometrie/modus";
import type { HitContext, InteractionOwner } from "../src/map/interaction/types";

/**
 * Mehrere Ecken markieren und gemeinsam ziehen (OPS-000081, alle Flächen). Problemfälle: Ein Umschalt-Klick zieht oder fällt zum Objekt darunter durch; ein
 * Gruppenzug wird mehrere Handbewegungen oder lässt die Ecken der Nachbarn zurück; die Gruppe rastet an einem Ziel ein, das nur für eine Ecke passt; eine
 * Markierung überlebt, wenn sich die Zahl der Ecken ändert, und meint dann die falschen Ecken; ein Weg oder Kamm verliert sein Verhalten.
 */

const space = AVENTURIA.coordinateSpace;
const SKALA = 1000;
const pixel = (p: Punkt): { x: number; y: number } => {
    const r = toRenderLngLat(space, p);
    return { x: r.lng * SKALA, y: -r.lat * SKALA };
};
const ring = (objekt: string, punkte: Punkt[], nr = 0): Teil => ({
    objekt,
    name: objekt,
    nr,
    art: "ring",
    punkte,
    revision: 2,
});
const [A, B, C, D, E, F] = [
    { x: 500, y: 500 },
    { x: 510, y: 500 },
    { x: 510, y: 510 },
    { x: 500, y: 510 },
    { x: 520, y: 500 },
    { x: 520, y: 510 },
] as [Punkt, Punkt, Punkt, Punkt, Punkt, Punkt];
const EIGEN = ring("eigen", [A, B, C, D]);
/** Der Nachbar teilt die Kante B–C. */
const NACHBAR = ring("nachbar", [B, E, F, C]);
const ecke = (index: number, objekt = "eigen", nr = 0): Stelle => ({ objekt, nr, index });

const laufende: { aus(): void }[] = [];

function aufbau(art: GeometrieArt, extra: Partial<GeometrieEingabe> = {}) {
    const handler = new Map<string, (event: unknown) => void>();
    const map = {
        doubleClickZoom: { isEnabled: () => true, disable: vi.fn(), enable: vi.fn() },
        boxZoom: { isEnabled: () => true, disable: vi.fn(), enable: vi.fn() },
        on: vi.fn((name: string, f: (event: unknown) => void) => handler.set(name, f)),
        off: vi.fn(),
        getLayer: () => undefined,
        project: ([lng, lat]: [number, number]) => ({ x: lng * SKALA, y: -lat * SKALA }),
        unproject: ([x, y]: [number, number]) => ({ lng: x / SKALA, lat: -y / SKALA }),
    };
    let owner: InteractionOwner | undefined;
    const interaction = {
        register: vi.fn((o: InteractionOwner) => {
            owner = o;
            return () => (owner = undefined);
        }),
        capture: vi.fn(() => () => undefined),
    };
    const bewegungen: Aenderung[] = [];
    let teile: readonly Teil[] = [EIGEN];
    const eingabe: GeometrieEingabe = {
        art,
        teile: () => teile,
        nachbarn: () => [NACHBAR],
        ziele: () => [],
        orte: () => [],
        fangradius: () => 10,
        handbewegung: (a) => {
            bewegungen.push(a);
            teile = a.teile;
        },
        ...extra,
    };
    const modus = installGeometrieModus(map as never, interaction as never, eingabe)!;
    laufende.push(modus);
    const tasten = { strg: false, umschalt: false };
    const ereignis = (at: { x: number; y: number }) => ({
        point: at,
        originalEvent: { button: 0, ctrlKey: tasten.strg, metaKey: false, shiftKey: tasten.umschalt },
        preventDefault: vi.fn(),
    });
    const kontext = (kind: HitContext["kind"], at: { x: number; y: number }, anfasser?: Stelle): HitContext =>
        ({
            kind,
            point: at,
            screen: at,
            event: ereignis(at),
            features: (layers: readonly string[]) =>
                layers[0] === "anfasser" && anfasser ? [{ properties: anfasser }] : [],
        }) as unknown as HitContext;
    const gib = (kind: HitContext["kind"], context: HitContext): unknown => {
        const claim = owner!.hit(context);
        if (claim !== undefined) owner!.apply(kind, claim as never, context);
        return claim;
    };
    const klicke = (punkt: Punkt, anfasser?: Stelle) => gib("click", kontext("click", pixel(punkt), anfasser));
    const markiere = (punkt: Punkt, stelle: Stelle) => {
        tasten.umschalt = true;
        const claim = klicke(punkt, stelle);
        tasten.umschalt = false;
        return claim;
    };
    /** Einen Anfasser greifen und um `dx` Bildpunkte nach rechts ziehen. */
    const ziehe = (von: Punkt, stelle: Stelle, dx: number) => {
        const start = pixel(von);
        gib("press", kontext("press", start, stelle));
        const ziel = { x: start.x + dx, y: start.y };
        handler.get("mousemove")!(ereignis({ x: start.x + dx / 2, y: start.y }));
        handler.get("mousemove")!(ereignis(ziel));
        handler.get("mouseup")!(ereignis(ziel));
    };
    return { modus, map, bewegungen, tasten, kontext, gib, klicke, markiere, ziehe };
}

const ringeMarkiert = (): number => {
    const bild = zeige.mock.lastCall?.[0] as Bild;
    return bild.ringe.filter((r) => r.art === "markiert").length;
};

beforeEach(() => {
    zeige.mockClear();
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
});
afterEach(() => {
    for (const m of laufende.splice(0)) m.aus();
    vi.unstubAllGlobals();
});

describe("Mehrere Ecken markieren und gemeinsam ziehen", () => {
    it.each([
        ["Gebiet", GEBIET],
        ["Derographie", FLAECHE],
        ["Sprache", SPRACHE],
    ])(
        "🔴 %s: Umschalt + Klick markiert und nimmt wieder heraus, ein Ring je Ecke, keine Handbewegung",
        (_name, art) => {
            const t = aufbau(art);
            t.markiere(B, ecke(1));
            t.markiere(C, ecke(2));
            expect(ringeMarkiert()).toBe(2);
            t.markiere(B, ecke(1));
            expect(ringeMarkiert()).toBe(1);
            expect(t.bewegungen).toHaveLength(0);
        },
    );

    it("🔴 der Zug an einer markierten Ecke bewegt alle um dieselbe Strecke, als EINE Handbewegung, und nimmt die Ecken des Nachbarn mit", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        t.markiere(C, ecke(2));
        t.ziehe(B, ecke(1), 500);
        expect(t.bewegungen).toHaveLength(1);
        const zug = t.bewegungen[0]!;
        expect(zug).toMatchObject({
            art: "ziehen",
            stelle: ecke(1),
            auch: [ecke(2)],
            treffer: undefined,
            getrennt: false,
        });
        const [neu] = zug.teile;
        const dx = neu!.punkte[1]!.x - B.x;
        const dy = neu!.punkte[1]!.y - B.y;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(0);
        expect(neu!.punkte[2]!.x).toBeCloseTo(C.x + dx, 9);
        expect(neu!.punkte[2]!.y).toBeCloseTo(C.y + dy, 9);
        expect(neu!.punkte[0]).toEqual(A);
        expect(neu!.punkte[3]).toEqual(D);
        // B ist die Ecke 0 des Nachbarn, C seine Ecke 3: Beide gehen an die neue Lage.
        expect(zug.mitgezogen.map((m) => m.stelle.index).sort()).toEqual([0, 3]);
        expect(zug.mitgezogen.find((m) => m.stelle.index === 3)!.nach).toEqual(neu!.punkte[2]);
    });

    it("🔴 Strg löst die ganze Gruppe: Nichts zieht mit", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        t.markiere(C, ecke(2));
        t.tasten.strg = true;
        t.ziehe(B, ecke(1), 500);
        expect(t.bewegungen[0]).toMatchObject({ getrennt: true, mitgezogen: [] });
        expect(t.bewegungen[0]!.teile[0]!.punkte[2]).not.toEqual(C);
    });

    it("🔴 die Gruppe rastet nicht ein, auch wenn die gezogene Ecke auf einem Ziel landet", () => {
        const ziele: Ziel[] = [{ art: "ecke", at: E, objekt: "drittes", name: "drittes" }];
        const t = aufbau(GEBIET, { ziele: () => ziele });
        t.markiere(B, ecke(1));
        t.markiere(C, ecke(2));
        t.ziehe(B, ecke(1), pixel(E).x - pixel(B).x);
        expect(t.bewegungen[0]!.treffer).toBeUndefined();
    });

    it("eine einzelne markierte Ecke zieht wie sonst und rastet ein", () => {
        const ziele: Ziel[] = [{ art: "ecke", at: E, objekt: "drittes", name: "drittes" }];
        const t = aufbau(GEBIET, { ziele: () => ziele });
        t.markiere(B, ecke(1));
        t.ziehe(B, ecke(1), pixel(E).x - pixel(B).x);
        expect(t.bewegungen[0]!.treffer?.ziel.objekt).toBe("drittes");
        expect(t.bewegungen[0]).not.toHaveProperty("auch");
    });

    it("🔴 ein Zug an einer unmarkierten Ecke beendet die Markierung und bewegt nur sie", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        t.markiere(C, ecke(2));
        t.ziehe(A, ecke(0), 500);
        const [neu] = t.bewegungen[0]!.teile;
        expect(neu!.punkte[1]).toEqual(B);
        expect(neu!.punkte[2]).toEqual(C);
        expect(ringeMarkiert()).toBe(0);
    });

    it("nach dem Zug bleibt die Markierung, man kann nachfassen; die Ringe stehen an der neuen Lage", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        t.markiere(C, ecke(2));
        t.ziehe(B, ecke(1), 500);
        t.modus.aktualisiere();
        const bild = zeige.mock.lastCall?.[0] as Bild;
        const lagen = bild.ringe.filter((r) => r.art === "markiert").map((r) => r.at);
        expect(lagen).toEqual([t.bewegungen[0]!.teile[0]!.punkte[1], t.bewegungen[0]!.teile[0]!.punkte[2]]);
    });

    it("🔴 ändert sich die Zahl der Ecken, endet die Markierung: Ihre Stellen meinten sonst andere Ecken", () => {
        const t = aufbau(GEBIET);
        t.markiere(C, ecke(2));
        // Doppelklick auf die Ecke A löscht sie; die Ecke C rückt von Stelle 2 auf Stelle 1.
        t.klicke(A, ecke(0));
        t.klicke(A, ecke(0));
        expect(t.bewegungen.at(-1)?.art).toBe("loeschen");
        t.modus.aktualisiere();
        expect(ringeMarkiert()).toBe(0);
    });

    it("🔴 Esc: erst der laufende Zug, dann die Markierung, erst dann fragt der Aufrufer weiter", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        expect(t.modus.abbrechen()).toBe(true);
        expect(ringeMarkiert()).toBe(0);
        expect(t.modus.abbrechen()).toBe(false);
    });

    it("🔴 Umschalt + Klick neben eine Ecke gehört dem Modus und tut nichts; der Druck greift keine Ecke", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        // Der Anspruch hält den Klick vom Objekt darunter fern (ein Fehlklick wechselt nicht das Gebiet).
        t.tasten.umschalt = true;
        expect(t.klicke({ x: 900, y: 900 })).toMatchObject({ ziel: "umschalt" });
        expect(ringeMarkiert()).toBe(1);
        expect(t.gib("press", t.kontext("press", pixel(C), ecke(2)))).toMatchObject({ ziel: "umschalt" });
        expect(t.bewegungen).toHaveLength(0);
    });

    it("ein gewöhnlicher Klick auf eine andere Ecke beendet die Markierung, auf eine markierte nicht", () => {
        const t = aufbau(GEBIET);
        t.markiere(B, ecke(1));
        t.klicke(B, ecke(1));
        expect(ringeMarkiert()).toBe(1);
        t.klicke(C, ecke(2));
        expect(ringeMarkiert()).toBe(0);
    });

    it("🔴 das Zoomen mit Umschalt + Ziehen ruht nur bei den Flächen, und danach geht es wieder", () => {
        const flaeche = aufbau(GEBIET);
        expect(flaeche.map.boxZoom.disable).toHaveBeenCalledOnce();
        flaeche.modus.aus();
        expect(flaeche.map.boxZoom.enable).toHaveBeenCalledOnce();
        const weg = aufbau(WEG);
        expect(weg.map.boxZoom.disable).not.toHaveBeenCalled();
    });

    it("🔴 ein Weg kennt das Markieren nicht: Umschalt + Klick bleibt ein gewöhnlicher Klick auf den Anfasser", () => {
        const t = aufbau(WEG);
        t.tasten.umschalt = true;
        expect(t.klicke(B, ecke(1))).toMatchObject({ ziel: "anfasser" });
        expect(ringeMarkiert()).toBe(0);
    });
});
