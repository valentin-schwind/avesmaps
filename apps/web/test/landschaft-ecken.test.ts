import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeDetail, EditorLandscapeTargets } from "@avesmaps3d/shared";
import {
    ECKEN_SCHRITTE,
    aufbauAus,
    createEcken,
    operationAus,
    teileAus,
    zieleAus,
    type EckenDaten,
    type EckenOptionen,
} from "../src/landschaftseditor/ecken.ts";
import { createBearbeitung, type FormTeil } from "../src/fenster/bearbeitung.ts";
import type { Entwurf } from "../src/fenster/entwurf-kern.ts";
import type { FormStand } from "../src/map/geometrie/formentwurf.ts";
import { createLandschaftArt } from "../src/landschaftseditor/landschaft-art.ts";
import type { Aenderung, Punkt, Teil } from "../src/map/geometrie/geometrie.ts";
import { operationAus as formOperation } from "../src/map/geometrie/formoperation.ts";
import { aufGemeinsamerKante, mitPunkt } from "../src/map/geometrie/rechnung.ts";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus.ts";
import { nextTick, ref } from "vue";
import { createEckenFuerSeite } from "../src/landschaftseditor/ecken-anbindung.ts";
import type { LandschaftBearbeitung } from "../src/landschaftseditor/landschaftseditor-steuerung.ts";
import type { EditorSperre } from "../src/editor-sperre/sperre.ts";

/** Für die Seitenanbindung (`createEckenFuerSeite`): Server, Karte und Kamera als Attrappen. */
const seitenAttrappen = vi.hoisted(() => ({ modus: undefined as unknown, daten: undefined as unknown }));
vi.mock("../src/landschaftseditor/ecken-daten.ts", () => ({ createEckenDaten: () => seitenAttrappen.daten }));
vi.mock("../src/map/geometrie/modus.ts", () => ({ installGeometrieModus: () => seitenAttrappen.modus }));
vi.mock("../src/map/geometrie/kamera.ts", () => ({ zeigeFrei: () => undefined }));

/**
 * Die Steuerung von „Ecken bearbeiten“ (WI-0178 C1; EDIT-0003 T27 (4), (7)). Problemfälle: Ein Schritt geht verloren oder zählt doppelt;
 * ↶ geht weiter als 20 zurück; ein neuer Schritt nach ↶ behält die alten „vor“-Schritte; „Verwerfen“ lässt etwas stehen; Esc beendet
 * mit ungespeicherten Schritten ohne zu fragen; eine Landschaft ohne Fläche startet einen leeren Modus; Ziele enthalten die eigene
 * Fläche; ein mitgezogener Punkt bleibt beim Nachbarn stehen; der Modus beginnt, obwohl ein anderer die Landschaft hält; das Ende gibt
 * die Sperre nicht frei; eine verlorene Sperre bleibt still; ein Nachbar, den ein anderer bearbeitet, zieht mit (EDIT-0003 §4; der
 * Betreiber korrigierte, wörtlich: „Korrektur: Die gemeinsame Ecke löst sich.“, 2026-10-16).
 */
const BECKEN = "a1a1a1a1-0000-4000-8000-000000000001";
const FLAECHE = "a1a1a1a1-0000-4000-8000-0000000000a1";
const NACHBAR = "a1a1a1a1-0000-4000-8000-0000000000a2";
const detail = (areas: EditorLandscapeDetail["areas"]): EditorLandscapeDetail => ({
    id: BECKEN,
    name: "Becken",
    layer: "topographie",
    circle: "voll",
    order: 1,
    clickLocked: false,
    areas,
    labels: [],
    neighbors: [],
    revision: 3,
});
const QUADRAT: EditorLandscapeDetail["areas"] = [
    {
        id: FLAECHE,
        polygons: [
            [
                [
                    [400, 400],
                    [410, 400],
                    [410, 410],
                    [400, 410],
                ],
            ],
        ],
        affectsPaths: true,
        revision: 2,
    },
];
const ZIELE: EditorLandscapeTargets = {
    margin: 15,
    neighbors: [
        {
            id: NACHBAR,
            regionId: "a1a1a1a1-0000-4000-8000-000000000002",
            name: "Vorgebirge",
            revision: 5,
            polygons: [
                [
                    [
                        [410, 400],
                        [420, 400],
                        [420, 410],
                        [410, 410],
                    ],
                ],
            ],
        },
    ],
    edges: [{ areaId: "a1a1a1a1-0000-4000-8000-0000000000a3", name: "Wald", a: [390, 390], b: [395, 390] }],
    riverPoints: [{ pathId: "a1a1a1a1-0000-4000-8000-0000000000f1", name: "Fluss", x: 405, y: 395 }],
};

type Sperre = EckenOptionen["sperre"];
type NimmErgebnis = Awaited<ReturnType<Sperre["nimm"]>>;

function aufbau(
    areas = QUADRAT,
    nimmt: NimmErgebnis = { art: "genommen", sperre: {} as never },
    gehalten: { id: string; name: string }[] = [],
    entwurf?: (ecken: () => ReturnType<typeof createEcken>) => {
        entwurf: Entwurf<FormStand>;
        merkeAufbau: NonNullable<EckenOptionen["merkeAufbau"]>;
    },
) {
    let eingabe: GeometrieEingabe | undefined;
    const modus: GeometrieModus = {
        aktualisiere: vi.fn(),
        markiere: vi.fn(),
        sperre: vi.fn(),
        abbrechen: vi.fn(() => false),
        aus: vi.fn(),
    };
    const daten: EckenDaten = {
        landschaft: vi.fn(async () => detail(areas)),
        ziele: vi.fn(async () => ZIELE),
    };
    const geaendert = vi.fn();
    let verlust: ((ziel: { kind: string; id: string }) => void) | undefined;
    const sperre = {
        nimm: vi.fn(async () => nimmt),
        gib: vi.fn(),
        liste: vi.fn(async () =>
            gehalten.map((sperre) => ({ id: sperre.id, own: false, person: { id: "p", name: sperre.name } })),
        ),
        beiVerlust: vi.fn((hoerer: (ziel: { kind: string; id: string }) => void) => {
            verlust = hoerer;
            return () => undefined;
        }),
    } as unknown as Sperre & { nimm: ReturnType<typeof vi.fn>; gib: ReturnType<typeof vi.fn> };
    const ecken = createEcken({
        sperre,
        daten,
        fangradius: () => 12,
        ebenen: () => ["topographie"],
        karte: {
            ein: (e) => {
                eingabe = e;
                return modus;
            },
            zeige: vi.fn(),
            geaendert,
        },
        ...(entwurf === undefined ? {} : entwurf(() => ecken)),
    });
    /** Eine Handbewegung, wie der Modus sie meldet: die erste Ecke verschoben, die gemeinsame Ecke des Nachbarn zieht mit. */
    const ziehe = (x: number): void => {
        const teile = eingabe!.teile();
        const neu: Teil[] = teile.map((t, i) =>
            i === 0 ? { ...t, punkte: t.punkte.map((p, j) => (j === 1 ? { x, y: 400 } : p)) } : t,
        );
        const aenderung: Aenderung = {
            art: "ziehen",
            stelle: { objekt: FLAECHE, nr: 0, index: 1 },
            teile: neu,
            mitgezogen: [
                {
                    stelle: { objekt: NACHBAR, nr: 0, index: 0 },
                    revision: 5,
                    von: { x: 410, y: 400 },
                    nach: { x, y: 400 },
                },
            ],
            treffer: undefined,
            getrennt: false,
        };
        eingabe!.handbewegung(aenderung);
    };
    return {
        ecken,
        daten,
        geaendert,
        modus,
        ziehe,
        sperre,
        verliere: () => verlust?.({ kind: "landscape", id: BECKEN }),
        eingabe: () => eingabe!,
    };
}

describe("Ecken bearbeiten: Steuerung", () => {
    it("🔴 Start: Ringe der Teilflächen mit Revision, Ziele ohne eigene Fläche, Ebenen der Karte an den Server", async () => {
        const { ecken, daten, eingabe } = aufbau();
        await ecken.starte(BECKEN);
        expect(daten.ziele).toHaveBeenCalledWith(BECKEN, ["topographie"], expect.anything());
        expect(ecken.laufend.value).toMatchObject({
            name: "Becken",
            phase: "bereit",
            ungespeichert: 0,
            zurueck: false,
        });
        expect(eingabe().teile()).toHaveLength(1);
        expect(eingabe().teile()[0]).toMatchObject({ objekt: FLAECHE, nr: 0, art: "ring", revision: 2 });
        expect(eingabe().nachbarn()[0]).toMatchObject({ objekt: NACHBAR, revision: 5 });
        expect(
            eingabe()
                .ziele()
                .some((ziel) => ziel.objekt === FLAECHE),
        ).toBe(false);
        expect(
            eingabe()
                .ziele()
                .filter((ziel) => ziel.art === "ecke")
                .map((ziel) => ziel.objekt),
        ).toContain("a1a1a1a1-0000-4000-8000-0000000000f1");
    });

    it("🔴 Entwurf: jeder Schritt zählt einmal, ↶ ↷, ein neuer Schritt nach ↶ verwirft das Vor; der Nachbar zieht mit", async () => {
        const { ecken, eingabe, ziehe } = aufbau();
        await ecken.starte(BECKEN);
        ziehe(411);
        ziehe(412);
        expect(ecken.laufend.value).toMatchObject({ ungespeichert: 2, zurueck: true, wieder: false });
        expect(eingabe().nachbarn()[0]!.punkte[0]).toEqual({ x: 412, y: 400 });
        ecken.zurueck();
        expect(ecken.laufend.value).toMatchObject({ ungespeichert: 1, wieder: true });
        expect(eingabe().teile()[0]!.punkte[1]).toEqual({ x: 411, y: 400 });
        ziehe(413);
        expect(ecken.laufend.value).toMatchObject({ ungespeichert: 2, wieder: false });
        ecken.verwerfen();
        expect(ecken.laufend.value).toMatchObject({ ungespeichert: 0, zurueck: false, wieder: false });
        expect(eingabe().teile()[0]!.punkte[1]).toEqual({ x: 410, y: 400 });
        expect(eingabe().nachbarn()[0]!.punkte[0]).toEqual({ x: 410, y: 400 });
        expect(ecken.meldung.value).toEqual({ art: "verworfen", name: "Becken" });
    });

    it("🔴 ↶ geht höchstens 20 Schritte zurück (T27 (7))", async () => {
        const { ecken, ziehe } = aufbau();
        await ecken.starte(BECKEN);
        // In kleinen Schritten, damit die Nachbarin (bis x = 420) sich nicht kreuzt: Das nähme der Entwurf nicht an (`form-regel.ts`).
        for (let i = 0; i < ECKEN_SCHRITTE + 5; i += 1) ziehe(411 + i * 0.3);
        let schritte = 0;
        while (ecken.laufend.value?.zurueck === true) {
            ecken.zurueck();
            schritte += 1;
        }
        expect(schritte).toBe(ECKEN_SCHRITTE);
        expect(ecken.laufend.value?.ungespeichert).toBe(5);
    });

    it("🔴 Esc: mit ungespeicherten Schritten erst die Frage; „Weiter bearbeiten“ bleibt, „Verwerfen“ beendet", async () => {
        const { ecken, modus, ziehe } = aufbau();
        await ecken.starte(BECKEN);
        ziehe(411);
        expect(ecken.abbrechen()).toBe(true);
        expect(ecken.laufend.value?.frage).toBe(true);
        ecken.antworte(false);
        expect(ecken.laufend.value).toMatchObject({ frage: false, ungespeichert: 1 });
        expect(ecken.abbrechen()).toBe(true);
        ecken.antworte(true);
        expect(ecken.laufend.value).toBeUndefined();
        expect(modus.aus).toHaveBeenCalled();
        // Ohne Schritte endet Esc gleich.
        await ecken.starte(BECKEN);
        expect(ecken.abbrechen()).toBe(true);
        expect(ecken.laufend.value).toBeUndefined();
        expect(ecken.abbrechen()).toBe(false);
    });

    it("„Fertig“ ohne Schritt beendet; einen eigenen Schreibweg hat der Modus nicht mehr (O3: die Bearbeitung schreibt)", async () => {
        const { ecken } = aufbau();
        await ecken.starte(BECKEN);
        await ecken.fertig();
        expect(ecken.laufend.value).toBeUndefined();
        expect(ecken.schreibbar).toBe(false);
    });

    it("Ringe werden wieder Polygone, Löcher bleiben an ihrem Polygon; unveränderte Teilflächen fehlen", () => {
        const zwei: Parameters<typeof teileAus>[0] = [
            {
                id: FLAECHE,
                polygons: [
                    [
                        [
                            [0, 0],
                            [9, 0],
                            [9, 9],
                        ],
                        [
                            [1, 1],
                            [2, 1],
                            [2, 2],
                        ],
                    ],
                    [
                        [
                            [20, 0],
                            [29, 0],
                            [29, 9],
                        ],
                    ],
                ],
                revision: 4,
            },
            {
                id: NACHBAR,
                polygons: [
                    [
                        [
                            [40, 0],
                            [49, 0],
                            [49, 9],
                        ],
                    ],
                ],
                revision: 6,
            },
        ];
        const start = { teile: teileAus(zwei, "Becken"), nachbarn: [] };
        const jetzt = {
            teile: start.teile.map((teil) =>
                teil.objekt === FLAECHE && teil.nr === 2
                    ? { ...teil, punkte: [...teil.punkte, { x: 25, y: 12 }] }
                    : teil,
            ),
            nachbarn: [],
        };
        const body = operationAus(start, jetzt, aufbauAus(zwei), "a1a1a1a1-0000-4000-8000-0000000000e2");
        expect(body.areas).toHaveLength(1);
        expect(body.areas[0]).toMatchObject({ id: FLAECHE, baseRevision: 4 });
        expect(body.areas[0]!.polygons.map((polygon) => polygon.length)).toEqual([2, 1]);
        expect(body.areas[0]!.polygons[1]![0]).toContainEqual([25, 12]);
    });

    it("eine Landschaft ohne Fläche startet keinen Modus und sagt warum", async () => {
        const { ecken } = aufbau([]);
        await ecken.starte(BECKEN);
        expect(ecken.laufend.value).toBeUndefined();
        expect(ecken.meldung.value).toEqual({ art: "ohneFlaeche", name: "Becken" });
    });

    it("Ringe über Polygone und Löcher zählen durch; Ecken der Kanten stehen einmal", () => {
        const teile = teileAus(
            [
                {
                    id: FLAECHE,
                    revision: 1,
                    polygons: [
                        [
                            [
                                [0, 0],
                                [9, 0],
                                [9, 9],
                            ],
                            [
                                [1, 1],
                                [2, 1],
                                [2, 2],
                            ],
                        ],
                        [
                            [
                                [20, 20],
                                [29, 20],
                                [29, 29],
                            ],
                        ],
                    ],
                },
            ],
            "Becken",
        );
        expect(teile.map((teil) => teil.nr)).toEqual([0, 1, 2]);
        const ziele = zieleAus(
            {
                margin: 15,
                neighbors: [],
                edges: [
                    { areaId: "x", name: "X", a: [0, 0], b: [1, 0] },
                    { areaId: "x", name: "X", a: [1, 0], b: [2, 0] },
                ],
                riverPoints: [],
            },
            [],
        );
        expect(ziele.filter((ziel) => ziel.art === "ecke")).toHaveLength(3);
        expect(ziele.filter((ziel) => ziel.art === "kante")).toHaveLength(2);
    });

    it("🔴 Sperre: erst gesperrt, dann bearbeitet; hält ein anderer die Landschaft, beginnt kein Modus", async () => {
        const fremd = {
            art: "gesperrt",
            sperre: { person: { id: "x", name: "Thomas" } },
        } as unknown as NimmErgebnis;
        const { ecken, sperre, modus } = aufbau(QUADRAT, fremd);
        await ecken.starte(BECKEN);
        expect(sperre.nimm).toHaveBeenCalledWith({ kind: "landscape", id: BECKEN }, "form");
        expect(ecken.laufend.value).toBeUndefined();
        expect(modus.aus).not.toHaveBeenCalled();
        expect(ecken.meldung.value).toEqual({ art: "gesperrt", name: "Becken", wer: "Thomas" });
        expect(sperre.gib).not.toHaveBeenCalled();
    });

    it("🔴 Sperre: das Ende gibt sie frei; geht sie verloren, sagt die Steuerung es, und der Entwurf bleibt", async () => {
        const { ecken, sperre, ziehe, verliere } = aufbau();
        await ecken.starte(BECKEN);
        ziehe(411);
        verliere();
        expect(ecken.meldung.value).toEqual({ art: "verloren", name: "Becken" });
        expect(ecken.laufend.value?.ungespeichert).toBe(1);
        expect(ecken.abbrechen()).toBe(true);
        ecken.antworte(true);
        // Verloren ist verloren: Das Ende gibt nichts frei, was ein anderer hält.
        expect(sperre.gib).not.toHaveBeenCalled();
        await ecken.starte(BECKEN);
        ecken.beende();
        expect(sperre.gib).toHaveBeenCalledWith({ kind: "landscape", id: BECKEN });
    });

    it("🔴 hält ein anderer den Nachbarn, löst sich die gemeinsame Ecke: er zieht nicht mit, man rastet nur ein, ein Hinweis sagt wer", async () => {
        const { ecken, eingabe, ziehe } = aufbau(QUADRAT, undefined, [
            { id: "a1a1a1a1-0000-4000-8000-000000000002", name: "Thomas" },
        ]);
        await ecken.starte(BECKEN);
        expect(eingabe().nachbarn()).toEqual([]);
        const amNachbarn = eingabe()
            .ziele()
            .filter((ziel) => ziel.objekt === NACHBAR);
        expect(amNachbarn.length).toBeGreaterThan(0);
        expect(amNachbarn.every((ziel) => ziel.stelle === undefined)).toBe(true);
        // Die gezogene Ecke (410, 400) liegt auf einer Ecke des gehaltenen Vorgebirges.
        ziehe(415);
        expect(ecken.meldung.value).toEqual({ art: "geloest", name: "Vorgebirge", wer: "Thomas" });
        expect(ecken.entwurf()?.nachbarn).toEqual([]);
    });
});

/**
 * „Ecken bearbeiten“ im EINEN Entwurf der Landschaft (O3, EDIT-0003 T44; `ecken-anbindung.ts`): Der Formentwurf nimmt die Sicht der
 * Bearbeitung statt eines eigenen Kerns. Problemfälle: Felder und Form gehen in zwei Operationen; ↶ kennt nur die Ecken; nach „Fertig“
 * läuft der Modus weiter; ein Konflikt beendet den Modus oder verwirft den Entwurf.
 */
describe("Ecken bearbeiten im gemeinsamen Entwurf (O3)", () => {
    function imEntwurf(antwort: { status: number; body: unknown } = { status: 200, body: { mapRevision: 88 } }) {
        const gesendet: unknown[] = [];
        let gelesen = detail(QUADRAT);
        const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                gesendet.push(JSON.parse(String(init.body)));
                const ok = antwort.status === 200;
                return new Response(
                    JSON.stringify(
                        ok
                            ? {
                                  operationId: "op",
                                  status: "applied",
                                  environment: "test",
                                  affected: [],
                                  derivedWork: [],
                                  warnings: [],
                                  mapRevision: 88,
                              }
                            : antwort.body,
                    ),
                    { status: antwort.status },
                );
            }
            void url;
            return new Response(JSON.stringify(gelesen), { status: 200 });
        }) as unknown as typeof fetch;
        const art = createLandschaftArt(fetcher);
        const karte = { geaendert: vi.fn() };
        const bearbeitung = createBearbeitung(art, {
            id: BECKEN,
            titel: "Becken",
            sperre: {
                nimm: vi.fn(async () => ({ art: "genommen", sperre: {} }) as never),
                gib: vi.fn(),
                beiVerlust: () => () => undefined,
            },
            karte,
            neueKennung: () => "a1a1a1a1-0000-4000-8000-0000000000e2",
        });
        const t = aufbau(QUADRAT, undefined, [], (ecken) => {
            const teil: FormTeil = {
                zurueck: () => ecken().zurueck(),
                wieder: () => ecken().wieder(),
                verwerfen: () => ecken().verwerfen(),
                abbrechen: () => ecken().abbrechen(),
                beende: () => ecken().beende(),
            };
            return { entwurf: bearbeitung.formEntwurf(teil), merkeAufbau: (a) => art.merkeAufbau(a) };
        });
        return { ...t, bearbeitung, gesendet, karte, setzeGelesen: (d: EditorLandscapeDetail) => (gelesen = d) };
    }

    it("🔴 Name und gezogene Ecke samt Nachbarin gehen als EINE Operation landscape.update; danach endet der Modus", async () => {
        const t = imEntwurf();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        await t.ecken.starte(BECKEN);
        t.bearbeitung.feld((f) => ({ ...f, name: "Großes Becken" }), "name");
        t.bearbeitung.feldVerlassen();
        t.ziehe(413);
        expect(t.ecken.laufend.value).toMatchObject({ ungespeichert: 2 });
        await t.bearbeitung.fertig();
        expect(t.gesendet).toEqual([
            {
                operationId: "a1a1a1a1-0000-4000-8000-0000000000e2",
                baseRevision: 3,
                changes: { name: "Großes Becken" },
                areas: [
                    {
                        id: FLAECHE,
                        baseRevision: 2,
                        polygons: [
                            [
                                [
                                    [400, 400],
                                    [413, 400],
                                    [410, 410],
                                    [400, 410],
                                ],
                            ],
                        ],
                    },
                    {
                        id: NACHBAR,
                        baseRevision: 5,
                        polygons: [
                            [
                                [
                                    [413, 400],
                                    [420, 400],
                                    [420, 410],
                                    [410, 410],
                                ],
                            ],
                        ],
                    },
                ],
            },
        ]);
        expect(t.karte.geaendert).toHaveBeenCalledWith(88);
        expect(t.ecken.laufend.value).toBeUndefined();
        expect(t.modus.aus).toHaveBeenCalled();
    });

    it("🔴 ↶ nimmt den jüngsten Schritt, ob Ecke oder Feld, und die Karte zeichnet neu", async () => {
        const t = imEntwurf();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        await t.ecken.starte(BECKEN);
        t.ziehe(413);
        t.bearbeitung.feld((f) => ({ ...f, name: "Großes Becken" }), "name");
        t.bearbeitung.zurueck();
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Becken");
        expect(t.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 413, y: 400 });
        t.bearbeitung.zurueck();
        expect(t.eingabe().teile()[0]!.punkte[1]).toEqual({ x: 410, y: 400 });
        expect(t.modus.aktualisiere).toHaveBeenCalled();
    });

    it("🔴 ein Konflikt lässt Modus und Entwurf stehen", async () => {
        const t = imEntwurf({
            status: 409,
            body: { error: { code: "edit_conflict", message: "Jemand war schneller.", details: {} } },
        });
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        await t.ecken.starte(BECKEN);
        t.ziehe(412);
        t.setzeGelesen({ ...detail([{ ...QUADRAT[0]!, revision: 3 }]), revision: 3 });
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "konflikt", fremde: ["form"], beide: ["form"] });
        expect(t.ecken.laufend.value).toMatchObject({ phase: "bereit", ungespeichert: 1 });
    });
});

/**
 * 5.2 (Thomas 2026-10-19, Flächen-Konzept „gemeinsame Kanten“): Ein neuer Punkt auf der gemeinsamen Kante kommt in derselben
 * Handbewegung auch in die Nachbarfläche, sonst öffnet ihn das erste Ziehen zu einer Lücke oder Überlappung. Gerechnet wie im Modus:
 * `aufGemeinsamerKante` über die Nachbarn, die der Formentwurf ihm reicht.
 */
describe("Ecken bearbeiten: neuer Punkt auf einer gemeinsamen Kante (5.2)", () => {
    const AT: Punkt = { x: 410, y: 405 };
    /** Ein Doppelklick auf die Kante (410,400)–(410,410): im Becken die Strecke 1→2, also Stelle 2. */
    const einfuegen = (eingabe: GeometrieEingabe): Aenderung => {
        const teil = eingabe.teile()[0]!;
        const eingefuegt = aufGemeinsamerKante(teil, 2, AT, eingabe.nachbarn());
        return {
            art: "einfuegen",
            stelle: { objekt: FLAECHE, nr: 0, index: 2 },
            teile: [{ ...teil, punkte: mitPunkt(teil.punkte, 2, AT) }],
            mitgezogen: [],
            ...(eingefuegt.length > 0 ? { eingefuegt } : {}),
            treffer: undefined,
            getrennt: false,
        };
    };

    it("🔴 Landschaft–Landschaft: derselbe Punkt kommt ins Vorgebirge, und die Operation schreibt beide Flächen", async () => {
        const { ecken, eingabe } = aufbau();
        await ecken.starte(BECKEN);
        const vorher = ecken.entwurf()!;
        const aenderung = einfuegen(eingabe());
        expect(aenderung.eingefuegt).toEqual([{ stelle: { objekt: NACHBAR, nr: 0, index: 4 }, revision: 5, at: AT }]);
        eingabe().handbewegung(aenderung);
        expect(ecken.entwurf()?.nachbarn[0]?.punkte).toEqual([
            { x: 410, y: 400 },
            { x: 420, y: 400 },
            { x: 420, y: 410 },
            { x: 410, y: 410 },
            AT,
        ]);
        const operation = formOperation(
            vorher,
            ecken.entwurf()!,
            new Map([
                [FLAECHE, [1]],
                [NACHBAR, [1]],
            ]),
            "op",
        );
        expect(operation.areas.map((a) => [a.id, a.baseRevision, a.polygons[0]![0]!.length])).toEqual([
            [FLAECHE, 2, 5],
            [NACHBAR, 5, 5],
        ]);
    });

    it("🔴 hält ein anderer das Vorgebirge, bekommt es keinen Punkt: der Modus kennt es nicht als Nachbarn", async () => {
        const { ecken, eingabe } = aufbau(QUADRAT, undefined, [
            { id: "a1a1a1a1-0000-4000-8000-000000000002", name: "Thomas" },
        ]);
        await ecken.starte(BECKEN);
        const aenderung = einfuegen(eingabe());
        expect(aenderung.eingefuegt).toBeUndefined();
        eingabe().handbewegung(aenderung);
        expect(ecken.entwurf()?.nachbarn).toEqual([]);
        expect(ecken.entwurf()?.teile[0]?.punkte).toHaveLength(5);
    });
});

describe("Ecken bearbeiten an der Seite: das Fenster trägt die Form", () => {
    it("🔴 wird das Fenster abgelegt (Esc im angedockten Fenster), endet der Modus; die Bearbeitung und ihr Entwurf bleiben", async () => {
        const modus: GeometrieModus = {
            aktualisiere: vi.fn(),
            markiere: vi.fn(),
            sperre: vi.fn(),
            abbrechen: vi.fn(() => false),
            aus: vi.fn(),
        };
        seitenAttrappen.modus = modus;
        seitenAttrappen.daten = { landschaft: vi.fn(async () => detail(QUADRAT)), ziele: vi.fn(async () => ZIELE) };
        const fetcher = vi.fn(async () => new Response(JSON.stringify(detail(QUADRAT)), { status: 200 }));
        const art = createLandschaftArt(fetcher as unknown as typeof fetch);
        const sperre = {
            nimm: vi.fn(async () => ({ art: "genommen", sperre: {} })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
            liste: vi.fn(async () => []),
        } as unknown as EditorSperre;
        const bearbeitung = Object.assign(
            createBearbeitung(art, {
                id: BECKEN,
                titel: "Becken",
                sperre: sperre as never,
                karte: { geaendert: vi.fn() },
                neueKennung: () => "a1a1a1a1-0000-4000-8000-0000000000e3",
            }),
            { art },
        ) as unknown as LandschaftBearbeitung;
        const getragen = ref(true);
        const ecken = createEckenFuerSeite({
            karte: () => ({ map: {} as never, interaction: {} as never, camera: {} as never }),
            ebenen: () => ["topographie"],
            sperre,
            bearbeitung: () => bearbeitung,
            getragen: () => getragen.value,
        });
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        await ecken.starte(BECKEN);
        expect(ecken.laufend.value).toMatchObject({ phase: "bereit" });
        getragen.value = false;
        await nextTick();
        expect(ecken.laufend.value).toBeUndefined();
        expect(modus.aus).toHaveBeenCalled();
        expect(bearbeitung.zustand.value.art).toBe("bereit");
    });
});
