import { shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeDetail, EditorLandscapeTargets } from "@avesmaps3d/shared";
import { createEntwurf, type Entwurf } from "../src/fenster/entwurf-kern";
import type { FormStand } from "../src/map/geometrie/formentwurf";
import type { Punkt, Teil } from "../src/map/geometrie/geometrie";
import {
    createFlaecheVereinfachen,
    festeEcken,
    kreuztSich,
    vereinfachteTeile,
    VEREINFACHEN_VORGABE,
} from "../src/landschaftseditor/flaeche-vereinfachen";
import type { LandschaftBearbeitung } from "../src/landschaftseditor/landschaftseditor-steuerung";

/**
 * „Fläche vereinfachen“ (WI-0233; Thomas 4.1, Werkzeug 4 der Derographie). Problemfälle: Eine gemeinsame Grenze mit der Nachbarin wird nur
 * auf einer Seite ausgedünnt (Lücke, wie in Legacy); eine Ecke am Fluss fällt weg; ein Ring fällt unter drei Ecken; ein Umriss, der sich
 * kreuzt, wird ein Schritt; das Ziehen am Regler füllt den Verlauf; ↶ lässt den Regler stehen; der Modus schreibt selbst.
 */

const p = (x: number, y: number): Punkt => ({ x, y });
const ring = (objekt: string, punkte: Punkt[], nr = 0): Teil => ({
    objekt,
    name: objekt,
    nr,
    art: "ring",
    punkte,
    revision: 3,
});

/** Ein Quadrat 0..100 mit vielen Punkten auf jeder Seite, leicht verrauscht; die rechte Seite (x = 100) teilt es mit der Nachbarin. */
function zackig(): Punkt[] {
    const raus: Punkt[] = [];
    for (let i = 0; i < 20; i++) raus.push(p(i * 5, i % 2 === 0 ? 0 : 0.3));
    for (let i = 0; i < 20; i++) raus.push(p(100, i * 5 + (i % 2 === 0 ? 0 : 0.3)));
    for (let i = 0; i < 20; i++) raus.push(p(100 - i * 5, i % 2 === 0 ? 100 : 99.7));
    for (let i = 0; i < 20; i++) raus.push(p(i % 2 === 0 ? 0 : 0.3, 100 - i * 5));
    return raus;
}
const GRENZE = zackig().filter((q) => q.x === 100);
const NACHBARIN = ring("nachbarin", [...GRENZE, p(200, 100), p(200, 0)]);
const FLUSS = p(55, 99.7);

describe("Die Rechnung", () => {
    it("🔴 feste Ecken: was die Nachbarin derselben Ebene teilt und was auf einem Flussstützpunkt liegt", () => {
        const eigen = ring("flaeche", zackig());
        const [fest] = festeEcken([eigen], [NACHBARIN], [FLUSS]);
        const feste = fest!.map((i) => eigen.punkte[i]!);
        expect(feste).toHaveLength(GRENZE.length + 1);
        expect(feste).toEqual(expect.arrayContaining([...GRENZE, FLUSS]));
    });

    it("🔴 💣 die gemeinsame Grenze bleibt ganz, keine Lücke; dazwischen wird ausgedünnt, und jeder Ring behält drei Ecken", () => {
        const eigen = ring("flaeche", zackig());
        const fest = festeEcken([eigen], [NACHBARIN], [FLUSS]);
        const [neu] = vereinfachteTeile([eigen], fest, 4);
        expect(neu!.punkte.length).toBeLessThan(eigen.punkte.length);
        for (const ecke of [...GRENZE, FLUSS]) expect(neu!.punkte).toContainEqual(ecke);
        // Ohne feste Ecken (wie Legacy) fiele die Grenze auf ihrer Seite weg.
        const [legacy] = vereinfachteTeile([eigen], [[]], 4);
        expect(GRENZE.every((ecke) => legacy!.punkte.some((q) => q.x === ecke.x && q.y === ecke.y))).toBe(false);
        const [winzig] = vereinfachteTeile([ring("dreieck", [p(0, 0), p(10, 0), p(5, 0.01)])], [[]], 20);
        expect(winzig!.punkte).toHaveLength(3);
    });

    it("🔴 ein Umriss, der sich kreuzt, fällt auf; Ecken, die sich nur berühren, und zwei Teilflächen übereinander nicht", () => {
        expect(kreuztSich([ring("a", [p(0, 0), p(10, 0), p(10, 10), p(0, 10)])])).toBe(false);
        expect(kreuztSich([ring("a", [p(0, 0), p(10, 10), p(10, 0), p(0, 10)])])).toBe(true);
        const aussen = ring("a", [p(0, 0), p(10, 0), p(10, 10), p(0, 10)]);
        expect(kreuztSich([aussen, ring("a", [p(2, 2), p(12, 2), p(12, 4)], 1)])).toBe(true);
        expect(kreuztSich([aussen, ring("a", [p(2, 2), p(4, 2), p(4, 4)], 1)])).toBe(false);
        expect(kreuztSich([aussen, ring("b", [p(5, 5), p(15, 5), p(15, 15)])])).toBe(false);
    });
});

/** Eine Bearbeitung der Landschaft, so weit der Modus sie braucht: der Entwurfskern als Sicht, Zustand, Lage und „Fertig“. */
function bearbeitungMit(kern: Entwurf<FormStand>) {
    const leere = vi.fn();
    const merkeAufbau = vi.fn();
    const zustand = shallowRef<{ art: string }>({ art: "bereit" });
    const bearbeitung = {
        zustand,
        lage: shallowRef({ frage: false }),
        art: { merkeAufbau },
        fertig: vi.fn(),
        formEntwurf: () => ({
            ...kern,
            beginne(g0: FormStand) {
                if (kern.jetzt() === undefined) kern.beginne(g0);
            },
            leere,
        }),
    } as unknown as LandschaftBearbeitung;
    return { bearbeitung, leere, merkeAufbau, zustand };
}

function aufbau() {
    const kern = createEntwurf<FormStand>();
    const b = bearbeitungMit(kern);
    const detail = {
        id: "flaeche-region",
        name: "Gorische Wüste",
        areas: [{ id: "flaeche", revision: 3, polygons: [[zackig().map((q) => [q.x, q.y] as [number, number])]] }],
    } as unknown as EditorLandscapeDetail;
    const ziele = {
        margin: 15,
        neighbors: [
            {
                id: "nachbarin",
                regionId: "nachbar-region",
                name: "Nachbarin",
                revision: 5,
                polygons: [[NACHBARIN.punkte.map((q) => [q.x, q.y] as [number, number])]],
            },
        ],
        edges: [],
        riverPoints: [{ pathId: "fluss", name: "Gadang", x: FLUSS.x, y: FLUSS.y }],
    } as unknown as EditorLandscapeTargets;
    const aktualisiere = vi.fn();
    const aus = vi.fn();
    const vereinfachen = createFlaecheVereinfachen({
        daten: { landschaft: async () => detail, ziele: async () => ziele },
        ebenen: () => ["vegetation"],
        bearbeitung: () => b.bearbeitung,
        karte: {
            vorschau: () => ({ aktualisiere, markiere: vi.fn(), sperre: vi.fn(), abbrechen: () => false, aus }),
            zeige: async () => undefined,
            massstab: () => 1,
        },
    });
    return { kern, vereinfachen, aus, ...b };
}

describe("Der Modus an der EINEN Bearbeitung (O3)", () => {
    it("🔴 der Start hängt die Form an, merkt den Aufbau und stellt nach der Landung die Vorgabe als EINEN Schritt", async () => {
        const { kern, vereinfachen, merkeAufbau } = aufbau();
        await vereinfachen.starte("flaeche-region");
        expect(merkeAufbau).toHaveBeenCalled();
        const lauf = vereinfachen.laufend.value!;
        expect(lauf).toMatchObject({ name: "Gorische Wüste", phase: "bereit", staerke: VEREINFACHEN_VORGABE });
        expect(lauf.vorher).toBe(80);
        expect(lauf.nachher).toBeLessThan(80);
        expect(lauf.fest).toBe(GRENZE.length + 1);
        expect(kern.lage().ungespeichert).toBe(1);
        // Die Nachbarin bleibt im Entwurf, wie sie war: Sie wird weder geschrieben noch gesperrt.
        expect(kern.jetzt()!.nachbarn).toEqual(kern.start()!.nachbarn);
    });

    it("🔴 Ziehen zeigt nur, Loslassen ist ein Schritt; ↶ holt Stand UND Regler zurück", async () => {
        const { kern, vereinfachen } = aufbau();
        await vereinfachen.starte("flaeche-region");
        const nachVorgabe = vereinfachen.laufend.value!.nachher;
        vereinfachen.staerke(0, false);
        expect(kern.lage().ungespeichert).toBe(1);
        expect(vereinfachen.laufend.value!.staerke).toBe(0);
        vereinfachen.staerke(0, true);
        expect(kern.lage().ungespeichert).toBe(2);
        expect(vereinfachen.laufend.value!.nachher).toBe(80);
        vereinfachen.zurueck();
        expect(vereinfachen.laufend.value).toMatchObject({ staerke: VEREINFACHEN_VORGABE, nachher: nachVorgabe });
        vereinfachen.wieder();
        expect(vereinfachen.laufend.value!.staerke).toBe(0);
    });

    it("🔴 eine Stellung, bei der sich der Umriss kreuzt, wird kein Schritt; der Hinweis nennt, wobei es bleibt", async () => {
        const kern = createEntwurf<FormStand>();
        const b = bearbeitungMit(kern);
        // Eine Delle unten am Umriss, ein Loch darin: Vereinfacht wird die Unterkante gerade, und das Loch ragt über sie hinaus.
        const umriss = [p(0, 0), p(40, 0), p(50, -5), p(60, 0), p(100, 0), p(100, 100), p(0, 100)];
        const loch = [p(45, 1), p(55, 1), p(50, -2)];
        expect(kreuztSich([ring("f", umriss), ring("f", loch, 1)])).toBe(false);
        const vereinfachen = createFlaecheVereinfachen({
            daten: {
                landschaft: async () =>
                    ({
                        id: "r",
                        name: "Delle",
                        areas: [
                            { id: "f", revision: 1, polygons: [[umriss, loch].map((r) => r.map((q) => [q.x, q.y]))] },
                        ],
                    }) as unknown as EditorLandscapeDetail,
                ziele: async () =>
                    ({ margin: 0, neighbors: [], edges: [], riverPoints: [] }) as unknown as EditorLandscapeTargets,
            },
            ebenen: () => [],
            bearbeitung: () => b.bearbeitung,
            karte: {
                vorschau: () => ({
                    aktualisiere: vi.fn(),
                    markiere: vi.fn(),
                    sperre: vi.fn(),
                    abbrechen: () => false,
                    aus: vi.fn(),
                }),
                zeige: () => undefined,
                massstab: () => 1,
            },
        });
        await vereinfachen.starte("r");
        // Schon die Vorgabe (Stärke 4) zöge die Unterkante durch das Loch: kein Schritt, der Regler bleibt bei 0.
        expect(vereinfachen.meldung.value).toEqual({ art: "kreuzt", staerke: VEREINFACHEN_VORGABE, gilt: 0 });
        expect(kern.lage().ungespeichert).toBe(0);
        expect(vereinfachen.laufend.value!.staerke).toBe(0);
        expect(kreuztSich(kern.jetzt()!.teile)).toBe(false);
    });

    it("🔴 Esc mit Ungeschriebenem fragt erst; „Fertig“ ist die Bearbeitung, und ihr Ende hängt die Form ab", async () => {
        const { kern, vereinfachen, aus, leere } = aufbau();
        await vereinfachen.starte("flaeche-region");
        expect(vereinfachen.abbrechen()).toBe(true);
        expect(kern.lage().frage).toBe(true);
        expect(vereinfachen.laufend.value).toBeDefined();
        vereinfachen.beende();
        expect(aus).toHaveBeenCalled();
        expect(leere).toHaveBeenCalled();
        expect(vereinfachen.laufend.value).toBeUndefined();
    });

    it("ohne Teilfläche beginnt nichts, der Hinweis sagt es", async () => {
        const kern = createEntwurf<FormStand>();
        const b = bearbeitungMit(kern);
        const vereinfachen = createFlaecheVereinfachen({
            daten: {
                landschaft: async () => ({ id: "r", name: "Leer", areas: [] }) as unknown as EditorLandscapeDetail,
                ziele: async () =>
                    ({ margin: 0, neighbors: [], edges: [], riverPoints: [] }) as unknown as EditorLandscapeTargets,
            },
            ebenen: () => [],
            bearbeitung: () => b.bearbeitung,
            karte: { vorschau: () => undefined, zeige: () => undefined, massstab: () => 1 },
        });
        await vereinfachen.starte("r");
        expect(vereinfachen.laufend.value).toBeUndefined();
        expect(vereinfachen.meldung.value).toEqual({ art: "ohneFlaeche", name: "Leer" });
        expect(kern.jetzt()).toBeUndefined();
    });
});

/** Ein Modus über einer Fläche `umriss` mit den Nachbarinnen `nachbarn` (Massstab 1: Stärke = Toleranz). */
function modusUeber(umriss: Punkt[], nachbarn: Punkt[][] = []) {
    const kern = createEntwurf<FormStand>();
    const b = bearbeitungMit(kern);
    const vereinfachen = createFlaecheVereinfachen({
        daten: {
            landschaft: async () =>
                ({
                    id: "r",
                    name: "Vorderkosch",
                    areas: [{ id: "f", revision: 1, polygons: [[umriss.map((q) => [q.x, q.y])]] }],
                }) as unknown as EditorLandscapeDetail,
            ziele: async () =>
                ({
                    margin: 0,
                    neighbors: nachbarn.map((ring, i) => ({
                        id: `n${String(i)}`,
                        regionId: `nr${String(i)}`,
                        name: "Nachbarin",
                        revision: 1,
                        polygons: [[ring.map((q) => [q.x, q.y])]],
                    })),
                    edges: [],
                    riverPoints: [],
                }) as unknown as EditorLandscapeTargets,
        },
        ebenen: () => [],
        bearbeitung: () => b.bearbeitung,
        karte: {
            vorschau: () => ({
                aktualisiere: vi.fn(),
                markiere: vi.fn(),
                sperre: vi.fn(),
                abbrechen: () => false,
                aus: vi.fn(),
            }),
            zeige: () => undefined,
            massstab: () => 1,
        },
    });
    return { kern, vereinfachen };
}

describe("🔴 Nachbesserung nach der Probe an Vorderkosch (Orchestrierung 2026-10-19)", () => {
    it("💣 fällt bei der Vorgabe nichts weg, ist sie kein Schritt: „0 ungespeichert“, der Regler steht trotzdem auf 4", async () => {
        const { kern, vereinfachen } = modusUeber([p(0, 0), p(10, 0), p(10, 10), p(0, 10)]);
        await vereinfachen.starte("r");
        expect(vereinfachen.laufend.value).toMatchObject({
            staerke: VEREINFACHEN_VORGABE,
            vorher: 4,
            nachher: 4,
            allesFest: false,
        });
        expect(kern.lage().ungespeichert).toBe(0);
        // Auch eine andere Stärke ohne Wirkung macht keinen Schritt.
        vereinfachen.staerke(2, true);
        expect(kern.lage().ungespeichert).toBe(0);
        expect(vereinfachen.laufend.value!.staerke).toBe(2);
    });

    it("🔴 ist jede Ecke mit einer Nachbarin verbunden, heißt es „alles fest“, und nichts wird ein Schritt", async () => {
        const umriss = [p(0, 0), p(5, 0), p(10, 0), p(10, 10), p(0, 10)];
        const { kern, vereinfachen } = modusUeber(umriss, [
            umriss.slice(0, 3).concat([p(5, -10)]),
            umriss.slice(2).concat([p(5, 20)]),
        ]);
        await vereinfachen.starte("r");
        expect(vereinfachen.laufend.value).toMatchObject({ vorher: 5, nachher: 5, fest: 5, allesFest: true });
        vereinfachen.staerke(20, true);
        expect(kern.lage().ungespeichert).toBe(0);
    });
});

describe("🔴 der Hinweis nach „Fertig“", () => {
    it("💣 „Fertig“ beendet den Modus, bevor die Bearbeitung „gespeichert“ meldet; der Hinweis kommt trotzdem (Browserfall 2026-10-19)", async () => {
        const { vereinfachen, zustand } = aufbau();
        await vereinfachen.starte("flaeche-region");
        const { vorher, nachher } = vereinfachen.laufend.value!;
        zustand.value = { art: "speichert" };
        // So endet es in der Bearbeitung: erst `ende()` (der Formbesitzer endet), dann der Zustand „gespeichert“.
        vereinfachen.beende();
        zustand.value = { art: "gespeichert" };
        expect(vereinfachen.meldung.value).toEqual({ art: "gespeichert", name: "Gorische Wüste", vorher, nachher });
    });
});
