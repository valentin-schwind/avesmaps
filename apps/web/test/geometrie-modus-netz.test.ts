import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/feedback/toast", () => ({ showToast: vi.fn() }));
vi.mock("../src/map/geometrie/schicht", () => ({
    GEOMETRIE_ANFASSER_TREFFER: "anfasser",
    GEOMETRIE_KANTE_TREFFER: "kante",
    GEOMETRIE_STEUER_TREFFER: "steuer",
    installGeometrieSchicht: () => ({ zeige: vi.fn(), entferne: vi.fn() }),
}));

import { AVENTURIA, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { FLAECHE, GEBIRGSNETZ, GEBIET, WEG } from "../src/map/geometrie/arten";
import type { Aenderung, GeometrieArt, Punkt, Teil } from "../src/map/geometrie/geometrie";
import { andereEigene, installGeometrieModus, teileNachZug, type GeometrieEingabe } from "../src/map/geometrie/modus";
import type { HitContext, InteractionOwner } from "../src/map/interaction/types";

/**
 * Zwei Zusätze des Modus für das Gebirgsnetz (EDIT-0003 §6, Zuteilung der Orchestrierung 2026-10-20), beide nur auf Angabe:
 * `waehle` (ein einfacher Klick auf Anfasser oder Kante meldet den Teil) und `mitziehenImObjekt` (Kammenden am selben Knoten ziehen
 * zusammen). Problemfälle: ohne Angabe ändert sich das Ziehen oder der Klick einer bestehenden Art; der erste Klick eines Doppelklicks
 * wählt nicht; Strg + Klick oder der zweite Klick wählt; ein eigener Punkt zieht mit, obwohl Strg löst oder ein Ort dort steht.
 */

const space = AVENTURIA.coordinateSpace;
/** Die Attrappe der Karte: 1 Grad der Darstellung = 1000 Bildpunkte, beide Richtungen umkehrbar. */
const SKALA = 1000;
const pixel = (p: Punkt): { x: number; y: number } => {
    const r = toRenderLngLat(space, p);
    return { x: r.lng * SKALA, y: -r.lat * SKALA };
};

const linie = (nr: number, punkte: Punkt[], objekt = "netz"): Teil => ({
    objekt,
    name: objekt,
    nr,
    art: "linie",
    punkte,
    revision: 4,
});
const KNOTEN: Punkt = { x: 500, y: 500 };
const KAMM_A = linie(0, [{ x: 480, y: 500 }, KNOTEN]);
const KAMM_B = linie(1, [KNOTEN, { x: 500, y: 520 }]);
const NETZ: GeometrieArt = { ...WEG, id: "netz-probe", ziele: () => [], rundung: (p) => [...p] };

/** Jeder Modus endet nach dem Fall, auch wenn er rot war: Sonst belegt er das Modul, und der nächste beginnt nicht. */
const laufende: { aus(): void }[] = [];

function aufbau(art: GeometrieArt, teile: readonly Teil[], extra: Partial<GeometrieEingabe> = {}) {
    const handler = new Map<string, (event: unknown) => void>();
    const map = {
        doubleClickZoom: { isEnabled: () => true, disable: vi.fn(), enable: vi.fn() },
        boxZoom: { isEnabled: () => true, disable: vi.fn(), enable: vi.fn() },
        on: vi.fn((art: string, f: (event: unknown) => void) => handler.set(art, f)),
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
    const eingabe: GeometrieEingabe = {
        art,
        teile: () => teile,
        nachbarn: () => [],
        ziele: () => [],
        orte: () => [],
        fangradius: () => 10,
        handbewegung: (a) => bewegungen.push(a),
        ...extra,
    };
    const modus = installGeometrieModus(map as never, interaction as never, eingabe);
    if (modus !== undefined) laufende.push(modus);
    const ereignis = (at: { x: number; y: number }, strg = false) => ({
        point: at,
        originalEvent: { button: 0, ctrlKey: strg, metaKey: false },
        preventDefault: vi.fn(),
    });
    const kontext = (
        kind: HitContext["kind"],
        at: { x: number; y: number },
        treffer: { anfasser?: { objekt: string; nr: number; index: number }; kante?: { objekt: string; nr: number } },
        strg = false,
    ): HitContext =>
        ({
            kind,
            point: at,
            screen: at,
            event: ereignis(at, strg),
            features: (layers: readonly string[]) =>
                layers[0] === "anfasser" && treffer.anfasser
                    ? [{ properties: treffer.anfasser }]
                    : layers[0] === "kante" && treffer.kante
                      ? [{ properties: treffer.kante }]
                      : [],
        }) as unknown as HitContext;
    const gib = (kind: HitContext["kind"], context: HitContext): boolean => {
        const claim = owner!.hit(context);
        if (claim === undefined) return false;
        owner!.apply(kind, claim as never, context);
        return true;
    };
    /** Einen Anfasser greifen und um `dx` Bildpunkte ziehen. */
    const ziehe = (stelle: { objekt: string; nr: number; index: number }, von: Punkt, dx: number, strg = false) => {
        const start = pixel(von);
        gib("press", kontext("press", start, { anfasser: stelle }, strg));
        const ziel = { x: start.x + dx, y: start.y };
        handler.get("mousemove")!(ereignis({ x: start.x + dx / 2, y: start.y }, strg));
        handler.get("mousemove")!(ereignis(ziel, strg));
        handler.get("mouseup")!(ereignis(ziel, strg));
        return fromRenderLngLat(space, map.unproject([ziel.x, ziel.y]));
    };
    /** Einen Anfasser greifen und über die Versätze `dxs` (Bildpunkte nach rechts) führen, am letzten loslassen. */
    const zieheUeber = (stelle: { objekt: string; nr: number; index: number }, von: Punkt, dxs: readonly number[]) => {
        const start = pixel(von);
        gib("press", kontext("press", start, { anfasser: stelle }));
        for (const dx of dxs) handler.get("mousemove")!(ereignis({ x: start.x + dx, y: start.y }));
        handler.get("mouseup")!(ereignis({ x: start.x + dxs.at(-1)!, y: start.y }));
    };
    const klicke = (at: { x: number; y: number }, treffer: Parameters<typeof kontext>[2], strg = false) =>
        gib("click", kontext("click", at, treffer, strg));
    return { modus: modus!, bewegungen, ziehe, zieheUeber, klicke };
}

describe("Löschen an einer gemeinsamen Ecke (OPS-000079)", () => {
    const ring = (objekt: string, punkte: Punkt[]): Teil => ({
        objekt,
        name: objekt,
        nr: 0,
        art: "ring",
        punkte,
        revision: 2,
    });
    const ECKE: Punkt = { x: 510, y: 500 };

    it("🔴 der Modus meldet die Stellen des Nachbarn auf derselben Ecke; ein Weg meldet keine", () => {
        const eigene = ring("eigen", [{ x: 500, y: 500 }, ECKE, { x: 510, y: 510 }, { x: 500, y: 510 }]);
        const nachbar = ring("nachbar", [ECKE, { x: 520, y: 500 }, { x: 520, y: 510 }]);
        const { bewegungen, klicke } = aufbau(GEBIET, [eigene], { nachbarn: () => [nachbar] });
        const anfasser = { objekt: "eigen", nr: 0, index: 1 };
        klicke(pixel(ECKE), { anfasser });
        klicke(pixel(ECKE), { anfasser });
        expect(bewegungen.at(-1)).toMatchObject({
            art: "loeschen",
            entfernt: [{ stelle: { objekt: "nachbar", nr: 0, index: 0 } }],
        });
    });
});

beforeEach(() => {
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
});
afterEach(() => {
    for (const m of laufende.splice(0)) m.aus();
    vi.unstubAllGlobals();
});

describe("Mitziehen im eigenen Objekt (Gebirgsnetz: Kammenden am selben Knoten)", () => {
    it("die Rechnung: nur die anderen Teile desselben Objekts, die deckungsgleichen Punkte an neuer Stelle", () => {
        const fremd = linie(0, [KNOTEN, { x: 1, y: 1 }], "anders");
        expect(andereEigene([KAMM_A, KAMM_B, fremd], { objekt: "netz", nr: 0 })).toEqual([KAMM_B]);
        const nach = { x: 503, y: 500 };
        const neu = teileNachZug([KAMM_A, KAMM_B], { objekt: "netz", nr: 0, index: 1 }, nach, [
            { stelle: { objekt: "netz", nr: 1, index: 0 }, revision: 4, von: KNOTEN, nach },
        ]);
        expect(neu[0]!.punkte[1]).toEqual(nach);
        expect(neu[1]!.punkte[0]).toEqual(nach);
        expect(neu[1]!.punkte[1]).toEqual(KAMM_B.punkte[1]);
    });

    it("🔴 mit `mitziehenImObjekt` zieht das Ende des anderen Kamms mit, in `teile`, nicht in `mitgezogen`", () => {
        const t = aufbau(NETZ, [KAMM_A, KAMM_B], { mitziehenImObjekt: true });
        const nach = t.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 30);
        expect(t.bewegungen).toHaveLength(1);
        const [a, b] = t.bewegungen[0]!.teile;
        expect(a!.punkte[1]!.x).toBeCloseTo(nach.x, 6);
        expect(b!.punkte[0]!.x).toBeCloseTo(nach.x, 6);
        expect(b!.punkte[1]).toEqual(KAMM_B.punkte[1]);
        expect(t.bewegungen[0]!.mitgezogen).toEqual([]);
    });

    it("🔴 ohne Angabe (jede bestehende Art) bleibt der andere eigene Teil liegen; mit Strg löst auch das Netz", () => {
        const ohne = aufbau(NETZ, [KAMM_A, KAMM_B]);
        ohne.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 30);
        expect(ohne.bewegungen[0]!.teile[1]).toBe(KAMM_B);
        ohne.modus.aus();
        const strg = aufbau(NETZ, [KAMM_A, KAMM_B], { mitziehenImObjekt: true });
        strg.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 30, true);
        expect(strg.bewegungen[0]!.teile[1]).toBe(KAMM_B);
        expect(strg.bewegungen[0]!.getrennt).toBe(true);
        strg.modus.aus();
        // Eine Art ohne `mitziehen` zieht auch mit der Angabe nichts mit.
        const starr = aufbau({ ...NETZ, mitziehen: false }, [KAMM_A, KAMM_B], { mitziehenImObjekt: true });
        starr.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 30);
        expect(starr.bewegungen[0]!.teile[1]).toBe(KAMM_B);
    });
});

describe("Während des Zugs (`zieht`, WI-0249 Leistung: die Vorschau zieht nach)", () => {
    it("🔴 je Bewegung die Teile mit dem Punkt unter dem Zeiger, am Ende `undefined` vor der Handbewegung; ohne Angabe wie bisher", () => {
        const folge: string[] = [];
        const t = aufbau(NETZ, [KAMM_A, KAMM_B], {
            mitziehenImObjekt: true,
            zieht: (teile) => folge.push(teile === undefined ? "ende" : `zug ${teile[1]!.punkte[0]!.x.toFixed(2)}`),
            handbewegung: () => folge.push("handbewegung"),
        });
        const nach = t.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 30);
        // Zwei Bewegungen (die halbe und die ganze), der mitgezogene Punkt des anderen Kamms folgt; dann Ende, dann die Handbewegung.
        expect(folge.slice(-2)).toEqual(["ende", "handbewegung"]);
        expect(folge.filter((f) => f.startsWith("zug"))).toHaveLength(2);
        expect(folge.at(-3)).toBe(`zug ${nach.x.toFixed(2)}`);
        t.modus.aus();
        // Ein Druck ohne Bewegung ist kein Zug: nichts gemeldet.
        const still: string[] = [];
        const s = aufbau(NETZ, [KAMM_A], { zieht: () => still.push("x") });
        s.ziehe({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, 0);
        expect(still).toEqual([]);
    });
});

describe("Teile nur zum Wählen (`Teil.fest`, WI-0249: Flüsse und Seen im Kammeditor)", () => {
    const FLUSS: Teil = {
        ...linie(1, [
            { x: 490, y: 520 },
            { x: 500, y: 525 },
        ]),
        fest: true,
    };

    it("🔴 kein Ziehen, kein Setzen, kein Löschen; ein Klick wählt, auch der zweite", () => {
        const waehle = vi.fn();
        const t = aufbau(NETZ, [KAMM_A, FLUSS], { waehle, mitziehenImObjekt: true });
        // Ein Druck auf seinen Anfasser gehört nicht dem Modus: kein Zug, keine Handbewegung.
        t.ziehe({ objekt: "netz", nr: 1, index: 0 }, FLUSS.punkte[0]!, 30);
        expect(t.bewegungen).toEqual([]);
        // Klick und Doppelklick auf den Anfasser wählen, löschen nicht; auf der Kante setzen sie nichts.
        const at = pixel(FLUSS.punkte[1]!);
        t.klicke(at, { anfasser: { objekt: "netz", nr: 1, index: 1 } });
        t.klicke(at, { anfasser: { objekt: "netz", nr: 1, index: 1 } });
        const mitte = pixel({ x: 495, y: 522.5 });
        t.klicke(mitte, { kante: { objekt: "netz", nr: 1 } });
        t.klicke(mitte, { kante: { objekt: "netz", nr: 1 } });
        expect(t.bewegungen).toEqual([]);
        expect(waehle).toHaveBeenCalledWith({ objekt: "netz", nr: 1, index: 1 }, { umschalt: false });
        expect(waehle).toHaveBeenCalledWith({ objekt: "netz", nr: 1 }, { umschalt: false });
    });

    it("ein Punkt des Netzes an derselben Stelle zieht ihn nicht mit (`andereEigene`)", () => {
        expect(andereEigene([KAMM_A, { ...KAMM_B, fest: true }], { objekt: "netz", nr: 0 })).toEqual([]);
    });
});

describe("Einrasten am Ausgangspunkt (Gebirgsnetz: Kammende am Gipfel)", () => {
    const amKnoten = (art: "gipfel" | "ecke") => [{ art, at: KNOTEN, objekt: "g-1", name: "Gipfel" }] as const;
    const ENDEN: GeometrieArt = { ...NETZ, ziele: () => ["gipfel", "ecke"] };

    it("🔴 vom Gipfel weg- und zurückgezogen rastet das Kammende wieder am selben Gipfel ein: der Punkt bleibt genau dort", () => {
        const t = aufbau(ENDEN, [KAMM_A], { ziele: () => amKnoten("gipfel") });
        t.zieheUeber({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, [15, 30, 3]);
        // Eingerastet am Ausgangspunkt: keine Handbewegung, nichts verschoben.
        expect(t.bewegungen).toEqual([]);
    });

    it("eine Ecke am Ausgangspunkt nimmt der Zug weiter nicht an (sonst rastete jeder Zug an sich selbst ein)", () => {
        const t = aufbau(ENDEN, [KAMM_A], { ziele: () => amKnoten("ecke") });
        t.zieheUeber({ objekt: "netz", nr: 0, index: 1 }, KNOTEN, [15, 30, 3]);
        expect(t.bewegungen).toHaveLength(1);
        expect(t.bewegungen[0]!.treffer).toBeUndefined();
        expect(t.bewegungen[0]!.teile[0]!.punkte[1]).not.toEqual(KNOTEN);
    });
});

describe("Einfacher Klick wählt (`waehle`)", () => {
    const RING: Teil = {
        objekt: "f",
        name: "f",
        nr: 0,
        art: "ring",
        revision: 2,
        punkte: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
        ],
    };

    it("🔴 ein Klick auf Kante oder Anfasser meldet den Teil, auch der erste eines Doppelklicks; der zweite nicht", () => {
        const waehle = vi.fn();
        const t = aufbau(NETZ, [KAMM_A, KAMM_B], { waehle });
        const mitte = pixel({ x: 490, y: 500 });
        expect(t.klicke(mitte, { kante: { objekt: "netz", nr: 0 } })).toBe(true);
        // Seit WI-0249 P9 mit der Art des Klicks (Umschalt für die Mehrfachauswahl) und am Anfasser mit seiner Stelle.
        expect(waehle).toHaveBeenLastCalledWith({ objekt: "netz", nr: 0 }, { umschalt: false });
        // Der zweite Klick am selben Fleck ist der Doppelklick: Er setzt einen Punkt und wählt nicht noch einmal.
        t.klicke(mitte, { kante: { objekt: "netz", nr: 0 } });
        expect(waehle).toHaveBeenCalledTimes(1);
        expect(t.bewegungen.map((b) => b.art)).toEqual(["einfuegen"]);
        t.klicke(pixel(KAMM_B.punkte[1]!), { anfasser: { objekt: "netz", nr: 1, index: 1 } });
        expect(waehle).toHaveBeenLastCalledWith({ objekt: "netz", nr: 1, index: 1 }, { umschalt: false });
    });

    it("🔴 mit Strg wählt der Klick nicht (Strg gehört der Kante und dem Trennen)", () => {
        const waehle = vi.fn();
        const t = aufbau(NETZ, [KAMM_A, KAMM_B], { waehle });
        t.klicke(pixel({ x: 490, y: 500 }), { kante: { objekt: "netz", nr: 0 } }, true);
        expect(waehle).not.toHaveBeenCalled();
    });

    it("🔴 im Kammeditor teilt Strg + Klick keinen Kamm (Betreiber 2026-10-25); in den übrigen Editoren setzt er vier Punkte", () => {
        const mitte = pixel({ x: 490, y: 500 });
        const weg = aufbau(NETZ, [KAMM_A, KAMM_B]);
        weg.klicke(mitte, { kante: { objekt: "netz", nr: 0 } }, true);
        expect(weg.bewegungen.map((b) => b.art)).toEqual(["einfuegen"]);
        expect(weg.bewegungen[0]!.teile[0]!.punkte).toHaveLength(KAMM_A.punkte.length + 4);
        weg.modus.aus();
        const netz = aufbau({ ...GEBIRGSNETZ, rundung: (p) => [...p] }, [KAMM_A, KAMM_B], { waehle: vi.fn() });
        netz.klicke(mitte, { kante: { objekt: "netz", nr: 0 } }, true);
        // Auch der zweite Strg-Klick am selben Fleck setzt nichts: Strg hat an der Kante des Netzes keine Bedeutung.
        netz.klicke(mitte, { kante: { objekt: "netz", nr: 0 } }, true);
        expect(netz.bewegungen).toEqual([]);
        // Strg beim Ziehen löst im Netz weiter (kein Teilen, aber Trennen).
        expect(GEBIRGSNETZ.loesen).toBeUndefined();
    });

    it("ohne Angabe tut der einfache Klick nichts; der Doppelklick in die Fläche (T59) läuft wie bisher und wählt nie", () => {
        const t = aufbau(FLAECHE, [RING]);
        const innen = pixel({ x: 30, y: 10 });
        // Der erste Klick ins Innere fällt durch, der zweite gehört dem Modus und setzt den Punkt.
        expect(t.klicke(innen, {})).toBe(false);
        expect(t.klicke(innen, {})).toBe(true);
        expect(t.bewegungen.map((b) => b.art)).toEqual(["einfuegen"]);
        t.modus.aus();
        const waehle = vi.fn();
        const mit = aufbau(FLAECHE, [RING], { waehle });
        mit.klicke(innen, {});
        mit.klicke(innen, {});
        expect(waehle).not.toHaveBeenCalled();
    });
});
