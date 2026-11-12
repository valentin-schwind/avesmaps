import { shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeDetail, EditorLandscapeTargets, LandscapeBrushBody } from "@avesmaps3d/shared";
import { createEntwurf, type Entwurf } from "../src/fenster/entwurf-kern";
import type { FormStand } from "../src/map/geometrie/formentwurf";
import { aufbauAus, operationAus } from "../src/map/geometrie/formoperation";
import type { Punkt, Teil } from "../src/map/geometrie/geometrie";
import {
    createFlaecheMalen,
    naechsterRadius,
    pinselEcken,
    PINSEL,
    polygoneAusTeilen,
    teileAusPolygonen,
    verduennt,
    viertelAbschnitte,
    wirksam,
} from "../src/landschaftseditor/flaeche-malen";
import type { LandschaftBearbeitung } from "../src/landschaftseditor/landschaftseditor-steuerung";

/**
 * „Fläche malen“ und „Fläche radieren“ (WI-0178 Werkzeug 6; T41 (5) „Ja, Alt und Zeichen“). Problemfälle: Der Pinsel wächst über 400 oder
 * fällt unter 6 Bildpunkte; die Spur schickt jeden Mauspunkt; Alt wirkt nicht oder bleibt hängen; ein Strich, der ein neues Stück oder ein
 * Loch anlegt, wird von „Fertig“ falsch zu Polygonen gefasst; der Strich geht an den Nachbarn; ein abgelehnter Strich wird ein Schritt.
 */

const p = (x: number, y: number): Punkt => ({ x, y });
const RECHTECK: [number, number][] = [
    [500, 500],
    [540, 500],
    [540, 520],
    [500, 520],
];

describe("Der Pinsel", () => {
    it("🔴 Radius 6 bis 400, Strg+Mausrad × 1,18; Ecken 8 bis 32 nach der Größe (Legacy)", () => {
        expect(PINSEL.VORGABE).toBe(40);
        expect(naechsterRadius(40, true)).toBeCloseTo(47.2, 5);
        expect(naechsterRadius(40, false)).toBeCloseTo(40 / 1.18, 5);
        expect(naechsterRadius(390, true)).toBe(400);
        expect(naechsterRadius(6.5, false)).toBe(6);
        expect([10, 20, 40, 80, 400].map(pinselEcken)).toEqual([8, 12, 17, 25, 32]);
        expect(viertelAbschnitte(10)).toBe(2);
        expect(viertelAbschnitte(400)).toBe(8);
    });

    it("🔴 die Spur verdünnt auf den Stempelabstand, der letzte Punkt bleibt; Alt gibt das Gegenwerkzeug", () => {
        const spur = [p(0, 0), p(1, 0), p(2, 0), p(5, 0), p(6, 0), p(6.5, 0)];
        expect(verduennt(spur, 5)).toEqual([p(0, 0), p(5, 0), p(6.5, 0)]);
        expect(wirksam({ art: "malen", gegen: false })).toBe("malen");
        expect(wirksam({ art: "malen", gegen: true })).toBe("radieren");
        expect(wirksam({ art: "radieren", gegen: true })).toBe("malen");
    });
});

describe("Ringe und Stücke", () => {
    const vorlage: Teil = { objekt: "a", name: "Wald", nr: 0, art: "ring", punkte: [], revision: 4 };
    it("🔴 ein Strich mit neuem Stück und Loch: „Fertig“ fasst die Ringe nach dem Stück, nicht nach dem gelesenen Aufbau", () => {
        const neu = teileAusPolygonen(
            [
                [
                    [
                        [0, 0],
                        [10, 0],
                        [10, 10],
                    ],
                    [
                        [2, 2],
                        [3, 2],
                        [3, 3],
                    ],
                ],
                [
                    [
                        [20, 0],
                        [30, 0],
                        [30, 10],
                    ],
                ],
            ],
            vorlage,
        );
        expect(neu.map((teil) => [teil.nr, teil.stueck])).toEqual([
            [0, 0],
            [1, 0],
            [2, 1],
        ]);
        expect(polygoneAusTeilen(neu, "a", [1])).toHaveLength(2);
        const start: FormStand = { teile: [{ ...vorlage, punkte: [p(0, 0), p(1, 0), p(1, 1)] }], nachbarn: [] };
        // Der gemerkte Aufbau sagt „ein Polygon mit einem Ring“; die Stücke gewinnen.
        const op = operationAus(start, { teile: neu, nachbarn: [] }, new Map([["a", [1]]]), "op");
        expect(op.areas).toHaveLength(1);
        expect(op.areas[0]!.baseRevision).toBe(4);
        expect(op.areas[0]!.polygons.map((polygon) => polygon.length)).toEqual([2, 1]);
    });

    it("ohne Stücke gilt der Aufbau des gelesenen Stands", () => {
        const teile: Teil[] = [0, 1, 2].map((nr) => ({ ...vorlage, nr, punkte: [p(nr, 0), p(nr + 1, 0), p(nr, 1)] }));
        expect(polygoneAusTeilen(teile, "a", [2, 1]).map((polygon) => polygon.length)).toEqual([2, 1]);
    });
});

function bearbeitungMit(kern: Entwurf<FormStand>) {
    const zustand = shallowRef<{ art: string }>({ art: "bereit" });
    const lage = shallowRef({ frage: false });
    const bearbeitung = {
        zustand,
        lage,
        art: { merkeAufbau: vi.fn() },
        fertig: vi.fn(),
        formEntwurf: () => ({
            ...kern,
            beginne(g0: FormStand) {
                if (kern.jetzt() === undefined) kern.beginne(g0);
            },
            leere: vi.fn(),
        }),
    } as unknown as LandschaftBearbeitung;
    return { bearbeitung, zustand, lage };
}

function aufbau(antwort: () => { ok: true; polygons: [number, number][][][] } | { ok: false; satz: string }) {
    const kern = createEntwurf<FormStand>();
    const b = bearbeitungMit(kern);
    const detail = {
        id: "r",
        name: "Krötensumpf",
        areas: [{ id: "a", revision: 4, polygons: [[RECHTECK]] }],
    } as unknown as EditorLandscapeDetail;
    const ziele = {
        margin: 15,
        neighbors: [
            {
                id: "n",
                regionId: "nr",
                name: "Nachbarin",
                revision: 7,
                polygons: [
                    [
                        [
                            [540, 500],
                            [560, 500],
                            [560, 520],
                        ],
                    ],
                ],
            },
        ],
        edges: [],
        riverPoints: [],
    } as unknown as EditorLandscapeTargets;
    const gesendet: LandscapeBrushBody[] = [];
    const malen = createFlaecheMalen({
        daten: { landschaft: async () => detail, ziele: async () => ziele },
        strich: async (_regionId, body) => {
            gesendet.push(body);
            return antwort();
        },
        ebenen: () => ["vegetation"],
        bearbeitung: () => b.bearbeitung,
        karte: { an: () => ({ aktualisiere: vi.fn(), aus: vi.fn() }), zeige: vi.fn() },
    });
    return { kern, malen, gesendet, ...b };
}

const GROESSER: [number, number][][][] = [
    [
        [
            [500, 500],
            [560, 500],
            [560, 520],
            [500, 520],
        ],
    ],
];

describe("Der Modus an der EINEN Bearbeitung (O3)", () => {
    it("🔴 ein Strich ist EIN Schritt: die Teilfläche aus dem Entwurf, die verdünnte Spur, der Radius in Karteneinheiten; die Nachbarin bleibt", async () => {
        const { kern, malen, gesendet } = aufbau(() => ({ ok: true, polygons: GROESSER }));
        await malen.starte("r", "a", "malen");
        expect(malen.laufend.value).toMatchObject({ phase: "bereit", art: "malen", radius: 40, name: "Krötensumpf" });
        await malen.strich([p(540, 510), p(541, 510), p(560, 510)], 0.5);
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]).toMatchObject({ areaId: "a", mode: "malen", radius: 20, quadSegs: 4 });
        expect(gesendet[0]!.polygons).toEqual([[RECHTECK]]);
        // Stempelabstand 0,55 × 20 = 11: der zweite Punkt fällt weg, der letzte bleibt.
        expect(gesendet[0]!.line).toEqual([
            [540, 510],
            [560, 510],
        ]);
        expect(kern.lage().ungespeichert).toBe(1);
        expect(kern.jetzt()!.teile.find((teil) => teil.objekt === "a")!.punkte).toHaveLength(4);
        expect(kern.jetzt()!.nachbarn).toEqual(kern.start()!.nachbarn);
        malen.zurueck();
        expect(kern.lage().ungespeichert).toBe(0);
    });

    it("🔴 Alt gibt das Gegenwerkzeug für den nächsten Strich; die Größe überlebt das Ende des Modus", async () => {
        const { malen, gesendet } = aufbau(() => ({ ok: true, polygons: GROESSER }));
        await malen.starte("r", "a", "malen");
        malen.gegen(true);
        malen.setzeRadius(80);
        await malen.strich([p(520, 510)], 1);
        expect(gesendet[0]).toMatchObject({ mode: "radieren", radius: 80 });
        malen.beende();
        await malen.starte("r", "a", "radieren");
        expect(malen.laufend.value).toMatchObject({ art: "radieren", gegen: false, radius: 80 });
    });

    it("🔴 ein abgelehnter Strich (ganz wegradiert) ist kein Schritt; der Hinweis sagt den Satz des Servers", async () => {
        const { kern, malen } = aufbau(() => ({
            ok: false,
            satz: "Eine Fläche ganz wegzuradieren geht nur über „Fläche entfernen …“.",
        }));
        await malen.starte("r", "a", "radieren");
        await malen.strich([p(520, 510)], 10);
        expect(kern.lage().ungespeichert).toBe(0);
        expect(malen.meldung.value).toEqual({
            art: "grenze",
            satz: "Eine Fläche ganz wegzuradieren geht nur über „Fläche entfernen …“.",
        });
        expect(malen.laufend.value!.rechnet).toBe(false);
    });

    it("während die Frage steht oder geschrieben wird, beginnt kein Strich", async () => {
        const { malen, gesendet, lage, zustand } = aufbau(() => ({ ok: true, polygons: GROESSER }));
        await malen.starte("r", "a", "malen");
        lage.value = { frage: true };
        await malen.strich([p(520, 510)], 1);
        lage.value = { frage: false };
        zustand.value = { art: "speichert" };
        await malen.strich([p(520, 510)], 1);
        expect(gesendet).toHaveLength(0);
        expect(aufbauAus([{ id: "a", polygons: [[RECHTECK]] }]).get("a")).toEqual([1]);
    });
});
