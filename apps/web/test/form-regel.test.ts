import { describe, expect, it, vi } from "vitest";
import { bereinigeRinge, mitGemeinsamenEcken, ringSchluessel, type RingPunkt } from "@avesmaps3d/shared";
import { formVerstoesse, neueVerstoesse } from "../src/map/geometrie/form-regel.ts";
import {
    ausDemEntwurf,
    createFormentwurf,
    standNach,
    type FormStand,
    type FormStart,
} from "../src/map/geometrie/formentwurf.ts";
import { formHinweis } from "../src/map/geometrie/formentwurf-texte.ts";
import { FLAECHE } from "../src/map/geometrie/arten.ts";
import type { Aenderung, Punkt, Teil } from "../src/map/geometrie/geometrie.ts";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus.ts";
import { mitziehende, stellenAn } from "../src/map/geometrie/rechnung.ts";

/**
 * Zwei Ablehnungen beim Speichern an einer schmalen Fläche mit Nachbarn (Vali 2026-11-10, Fläche-452, ein Streifen am Fluss bei Zoom 7–8:
 * „An einer Nachbarfläche bewegt sich mehr als die gemeinsamen Ecken.“ und „Ein Ring braucht mindestens drei Ecken.“). Problemfälle: Der
 * Editor lässt einen Schritt zu, den der Server beim Speichern ablehnt; die Prüfung im Editor weicht von der des Servers ab; ein nicht
 * übernommener Schritt bleibt doch im Entwurf, oder seine Marke bleibt nach dem nächsten Schritt stehen.
 *
 * Die Lage: der Streifen „Au“ (0..100 × 0..4), darüber „Wiese“ mit drei gemeinsamen Ecken oben, rechts der Zwickel „Zipfel“ (ein Dreieck an
 * den beiden rechten Ecken), unten „Moor“, das nur die Ecke (0, 0) teilt; seine Ecke (20, −2) ist nicht gemeinsam.
 */

/** Mitten in der Karte (sie reicht von 0 bis 1024): Ecken außerhalb nähme der Entwurf nicht an. */
const P = (x: number, y: number): Punkt => ({ x: x + 300, y: y + 300 });
const ring = (objekt: string, name: string, punkte: Punkt[]): Teil => ({
    objekt,
    name,
    nr: 0,
    art: "ring",
    punkte,
    revision: 1,
});
const AU = ring("au", "Au", [P(0, 0), P(50, 0), P(100, 0), P(100, 4), P(50, 4), P(0, 4)]);
const WIESE = ring("wiese", "Wiese", [P(0, 4), P(50, 4), P(100, 4), P(100, 20), P(0, 20)]);
const ZIPFEL = ring("zipfel", "Zipfel", [P(100, 0), P(110, 2), P(100, 4)]);
const MOOR = ring("moor", "Moor", [P(0, 0), P(20, -2), P(40, -2), P(40, -10), P(0, -10)]);
const START: FormStand = { teile: [AU], nachbarn: [WIESE, ZIPFEL, MOOR] };

/** Ein Zug wie im Geometrie-Modus: die Ecke `index` der Au nach `nach`, die Ecken der Nachbarn darauf ziehen mit (außer mit Strg). */
function zug(stand: FormStand, index: number, nach: Punkt, getrennt = false): Aenderung {
    const au = stand.teile[0]!;
    const von = au.punkte[index]!;
    return {
        art: "ziehen",
        stelle: { objekt: "au", nr: 0, index },
        teile: [{ ...au, punkte: au.punkte.map((p, i) => (i === index ? nach : p)) }],
        mitgezogen: mitziehende(von, nach, stand.nachbarn, [], getrennt),
        treffer: undefined,
        getrennt,
    };
}

/** Doppelklick auf die Ecke `index` der Au: Sie geht, die Ecken der Nachbarn darauf gehen nur, wenn erst der Entwurf sie dorthin brachte. */
function loesche(stand: FormStand, index: number): Aenderung {
    const au = stand.teile[0]!;
    const at = au.punkte[index]!;
    return {
        art: "loeschen",
        stelle: { objekt: "au", nr: 0, index },
        teile: [{ ...au, punkte: au.punkte.filter((_, i) => i !== index) }],
        mitgezogen: [],
        entfernt: stellenAn(at, stand.nachbarn).map(({ objekt, nr, index: i }) => ({
            stelle: { objekt, nr, index: i },
        })),
        treffer: undefined,
        getrennt: false,
    };
}

/** Ein Schritt, wie ihn der Formentwurf rechnet (ohne Prüfung). */
const schritt = (stand: FormStand, aenderung: Aenderung): FormStand =>
    standNach(stand, {
        ...aenderung,
        entfernt: ausDemEntwurf(aenderung.entfernt ?? [], stand, START, 3),
    });

/** Was der Server zur Nachbarin sagt (`mitGemeinsamenEcken` auf den bereinigten Ringen, wie `landscape-reshape.ts`). */
function serverNimmt(jetzt: FormStand, objekt: string): boolean {
    const tupel = (t: Teil): RingPunkt[] => t.punkte.map((p) => [p.x, p.y] as const);
    const alt = START.nachbarn.find((t) => t.objekt === objekt)!;
    const neu = jetzt.nachbarn.find((t) => t.objekt === objekt)!;
    const eigene = (s: FormStand): Set<string> => new Set(s.teile.flatMap((t) => tupel(t).map(ringSchluessel)));
    const neuBereinigt = bereinigeRinge([[tupel(neu)]]);
    if (neuBereinigt[0]![0]!.length < 3) return false;
    return mitGemeinsamenEcken([[tupel(alt)]], neuBereinigt, eigene(START), eigene(jetzt));
}

describe("Schritte mit der Regel des Servers (form-regel)", () => {
    it("🔴 eine gemeinsame Ecke, auf eine Ecke des kleinen Nachbarn gezogen, lässt ihn unter drei Ecken fallen", () => {
        // Die rechte obere Ecke der Au rastet auf der Spitze des Zipfels ein: Zipfel und Wiese ziehen mit, der Zipfel hat zwei Ecken übereinander.
        const jetzt = schritt(START, zug(START, 3, P(110, 2)));
        expect(serverNimmt(jetzt, "zipfel")).toBe(false);
        expect(formVerstoesse(START, jetzt)).toEqual([
            {
                grund: "zu_wenig_ecken",
                objekt: "zipfel",
                nr: 0,
                name: "Zipfel",
                eigene: false,
                stelle: P(100, 0),
            },
        ]);
    });

    it("🔴 eine fremde Ecke, eingerastet, mitgezogen und mit Strg wieder gelöst, bliebe allein liegen", () => {
        const eingerastet = schritt(START, zug(START, 1, P(20, -2)));
        const mitgezogen = schritt(eingerastet, zug(eingerastet, 1, P(25, -1)));
        // Bis hier nimmt der Server es: Die Ecke des Moors liegt auf einer Ecke der Au.
        expect(serverNimmt(mitgezogen, "moor")).toBe(true);
        expect(formVerstoesse(START, mitgezogen)).toEqual([]);
        const geloest = schritt(mitgezogen, zug(mitgezogen, 1, P(30, 1), true));
        expect(serverNimmt(geloest, "moor")).toBe(false);
        expect(neueVerstoesse(START, mitgezogen, geloest)).toEqual([
            expect.objectContaining({ grund: "nachbar_umgezeichnet", objekt: "moor", name: "Moor", stelle: P(25, -1) }),
        ]);
    });

    it("🔴 dieselbe fremde Ecke, und die eigene Ecke darauf gelöscht: Dem Moor fehlte eine Ecke, die nie gemeinsam war", () => {
        const eingerastet = schritt(START, zug(START, 1, P(20, -2)));
        const mitgezogen = schritt(eingerastet, zug(eingerastet, 1, P(25, -1)));
        const geloescht = schritt(mitgezogen, loesche(mitgezogen, 1));
        expect(serverNimmt(geloescht, "moor")).toBe(false);
        expect(neueVerstoesse(START, mitgezogen, geloescht)).toEqual([
            expect.objectContaining({ grund: "nachbar_umgezeichnet", objekt: "moor", stelle: P(20, -2) }),
        ]);
    });

    it("🟢 eine gemeinsame Ecke mitziehen und mit Strg lösen bleibt erlaubt, wie beim Server", () => {
        const mitgezogen = schritt(START, zug(START, 4, P(50, 6)));
        const geloest = schritt(mitgezogen, zug(mitgezogen, 4, P(50, 2), true));
        for (const stand of [mitgezogen, geloest]) {
            expect(serverNimmt(stand, "wiese")).toBe(true);
            expect(formVerstoesse(START, stand)).toEqual([]);
        }
    });

    it("🔴 ein eigener Ring, dessen Ecken aufeinanderfallen, zählt wie beim Server nur die verschiedenen", () => {
        const dreieck = ring("au", "Au", [P(0, 0), P(10, 0), P(5, 5)]);
        const start: FormStand = { teile: [dreieck], nachbarn: [] };
        const jetzt: FormStand = { teile: [{ ...dreieck, punkte: [P(0, 0), P(10, 0), P(10, 0)] }], nachbarn: [] };
        expect(neueVerstoesse(start, start, jetzt)).toEqual([
            expect.objectContaining({ grund: "zu_wenig_ecken", objekt: "au", eigene: true, stelle: P(0, 0) }),
        ]);
    });

    it("🟢 eine Fläche, die sich schon beim Start kreuzt (Legacy), bleibt bearbeitbar wie am Server", () => {
        const acht = ring("au", "Au", [P(0, 0), P(10, 10), P(10, 0), P(0, 10), P(-5, 5)]);
        const start: FormStand = { teile: [acht], nachbarn: [] };
        const verschoben: FormStand = {
            teile: [{ ...acht, punkte: acht.punkte.map((p, i) => (i === 4 ? P(-6, 5) : p)) }],
            nachbarn: [],
        };
        expect(formVerstoesse(start, verschoben)).toEqual([]);
    });

    it("🟢 was ein Entwurf schon mitbringt, hält den nächsten Schritt nicht auf", () => {
        const kaputt = schritt(START, zug(START, 3, P(110, 2)));
        const weiter = schritt(kaputt, zug(kaputt, 1, P(50, -1)));
        expect(formVerstoesse(START, weiter)).toHaveLength(1);
        expect(neueVerstoesse(START, kaputt, weiter)).toEqual([]);
    });
});

describe("Formentwurf: ein Schritt, den der Server ablehnen würde, wird nicht übernommen", () => {
    async function aufbau() {
        let eingabe: GeometrieEingabe | undefined;
        const modus: GeometrieModus = {
            aktualisiere: vi.fn(),
            markiere: vi.fn(),
            sperre: vi.fn(),
            abbrechen: vi.fn(() => false),
            aus: vi.fn(),
        };
        const start: FormStart = {
            sperrId: "au",
            name: "Au",
            teile: START.teile,
            nachbarn: [
                { sperrId: "wiese", name: "Wiese", teile: [WIESE] },
                { sperrId: "zipfel", name: "Zipfel", teile: [ZIPFEL] },
                { sperrId: "moor", name: "Moor", teile: [MOOR] },
            ],
            ziele: () => [],
        };
        const entwurf = createFormentwurf({
            art: FLAECHE,
            quelle: { sperrArt: "landscape", lade: async () => start },
            karte: {
                ein: (e) => {
                    eingabe = e;
                    return modus;
                },
                zeige: vi.fn(),
                geaendert: vi.fn(),
            },
            fangradius: () => 12,
            sperre: {
                nimm: vi.fn(async () => ({ art: "genommen", sperre: {} as never })),
                gib: vi.fn(),
                liste: vi.fn(async () => []),
                beiVerlust: vi.fn(() => () => undefined),
            } as never,
            pruefeSchritte: true,
        });
        await entwurf.starte("au");
        const melde = (bau: (stand: FormStand) => Aenderung): void => eingabe!.handbewegung(bau(entwurf.entwurf()!));
        return { entwurf, modus, melde };
    }

    it("🔴 der Zwickel fiele unter drei Ecken: Der Stand bleibt, die Stelle ist markiert, die Meldung nennt den Zipfel", async () => {
        const { entwurf, modus, melde } = await aufbau();
        melde((s) => zug(s, 3, P(110, 2)));
        expect(entwurf.laufend.value?.ungespeichert).toBe(0);
        expect(entwurf.entwurf()).toEqual(START);
        expect(entwurf.meldung.value).toEqual({
            art: "verhindert",
            grund: "zu_wenig_ecken",
            name: "Zipfel",
            eigen: "Au",
            stelle: P(100, 0),
        });
        expect(modus.markiere).toHaveBeenLastCalledWith([{ at: P(100, 0), art: "fehler" }]);
        expect(modus.aktualisiere).toHaveBeenCalled();
        expect(formHinweis(entwurf.meldung.value!, { ladefehler: "landschaftseditor.ecken.ladefehler" }).ton).toBe(
            "warning",
        );
        // Der nächste erlaubte Schritt geht durch und nimmt die Marke weg.
        melde((s) => zug(s, 4, P(50, 6)));
        expect(entwurf.laufend.value?.ungespeichert).toBe(1);
        expect(modus.markiere).toHaveBeenLastCalledWith([]);
    });

    it("🔴 eingerastet, mitgezogen, dann mit Strg gelöst: der dritte Schritt fehlt im Entwurf, die beiden davor stehen", async () => {
        const { entwurf, modus, melde } = await aufbau();
        melde((s) => zug(s, 1, P(20, -2)));
        melde((s) => zug(s, 1, P(25, -1)));
        melde((s) => zug(s, 1, P(30, 1), true));
        expect(entwurf.laufend.value?.ungespeichert).toBe(2);
        expect(entwurf.entwurf()!.teile[0]!.punkte[1]).toEqual(P(25, -1));
        expect(entwurf.meldung.value).toMatchObject({ art: "verhindert", grund: "nachbar_umgezeichnet", name: "Moor" });
        expect(modus.markiere).toHaveBeenLastCalledWith([{ at: P(25, -1), art: "fehler" }]);
        // ↶ nimmt die Marke weg.
        entwurf.zurueck();
        expect(modus.markiere).toHaveBeenLastCalledWith([]);
    });
});
