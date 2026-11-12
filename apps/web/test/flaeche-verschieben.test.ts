import { shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeDetail, EditorLandscapeTargets } from "@avesmaps3d/shared";
import { createEntwurf, type Entwurf } from "../src/fenster/entwurf-kern";
import type { FormStand } from "../src/map/geometrie/formentwurf";
import type { Punkt, Teil } from "../src/map/geometrie/geometrie";
import {
    createFlaecheVerschieben,
    inTeilflaeche,
    verschobeneTeile,
} from "../src/landschaftseditor/flaeche-verschieben";
import type { LandschaftBearbeitung } from "../src/landschaftseditor/landschaftseditor-steuerung";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italienisch } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { GEMEINSAME_ECKEN_STELLE, ohneTeil } from "../src/landschaftseditor/flaeche-verschieben";

const VERSCHIEBEN_TAFELN = { da, de, en, es, fr, it: italienisch, nl, pl, sv };

/**
 * „Verschieben“ (WI-0178 Werkzeug 7; Betreiber 2026-10-19 „A“). Problemfälle: Die Nachbarin wandert mit, oder ihre gemeinsame Ecke wird
 * mitgezogen; eine zweite Teilfläche derselben Landschaft wandert mit; das Hängen an der Maus füllt den Verlauf; ein Klick an derselben
 * Stelle wird ein Schritt; ein Klick neben der abgesetzten Fläche hebt sie auf; Esc lässt den Modus stehen, obwohl nichts ungespeichert ist;
 * der Modus schreibt selbst.
 */

const p = (x: number, y: number): Punkt => ({ x, y });
const quadrat = (x0: number, y0: number, s: number): [number, number][] => [
    [x0, y0],
    [x0 + s, y0],
    [x0 + s, y0 + s],
    [x0, y0 + s],
];
const ring = (objekt: string, punkte: Punkt[], nr = 0): Teil => ({
    objekt,
    name: objekt,
    nr,
    art: "ring",
    punkte,
    revision: 3,
});

describe("Die Rechnung", () => {
    it("🔴 nur die Ringe dieser Teilfläche wandern, mit Loch; die andere Teilfläche und alles andere bleiben", () => {
        const teile = [
            ring("a", [p(0, 0), p(10, 0), p(10, 10)]),
            ring("a", [p(2, 2), p(3, 2), p(3, 3)], 1),
            ring("b", [p(20, 0), p(30, 0), p(30, 10)]),
        ];
        const neu = verschobeneTeile(teile, "a", 5, -1);
        expect(neu[0]!.punkte).toEqual([p(5, -1), p(15, -1), p(15, 9)]);
        expect(neu[1]!.punkte).toEqual([p(7, 1), p(8, 1), p(8, 2)]);
        expect(neu[2]).toBe(teile[2]);
    });

    it("🔴 in der Teilfläche heißt: in einem Stück, nicht im Loch, nicht in einer anderen Teilfläche", () => {
        const teile = [
            ring(
                "a",
                quadrat(0, 0, 10).map(([x, y]) => p(x, y)),
            ),
            ring(
                "a",
                quadrat(4, 4, 2).map(([x, y]) => p(x, y)),
                1,
            ),
            ring(
                "a",
                quadrat(20, 0, 5).map(([x, y]) => p(x, y)),
                2,
            ),
            ring(
                "b",
                quadrat(40, 0, 5).map(([x, y]) => p(x, y)),
            ),
        ];
        expect(inTeilflaeche(teile, "a", p(1, 1))).toBe(true);
        expect(inTeilflaeche(teile, "a", p(5, 5))).toBe(false);
        expect(inTeilflaeche(teile, "a", p(22, 2))).toBe(true);
        expect(inTeilflaeche(teile, "a", p(15, 5))).toBe(false);
        expect(inTeilflaeche(teile, "a", p(42, 2))).toBe(false);
    });
});

function bearbeitungMit(kern: Entwurf<FormStand>) {
    const leere = vi.fn();
    const merkeAufbau = vi.fn();
    const zustand = shallowRef<{ art: string }>({ art: "bereit" });
    const lage = shallowRef({ frage: false });
    const bearbeitung = {
        zustand,
        lage,
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
    return { bearbeitung, leere, merkeAufbau, zustand, lage };
}

/** Eine Landschaft mit zwei Teilflächen; die Nachbarin teilt mit „a“ die Kante x = 10. */
function aufbau(areas = ["a", "b"]) {
    const kern = createEntwurf<FormStand>();
    const b = bearbeitungMit(kern);
    const detail = {
        id: "r",
        name: "Goldene Au",
        areas: areas.map((id, i) => ({ id, revision: 3, polygons: [[quadrat(i * 50, 0, 10)]] })),
    } as unknown as EditorLandscapeDetail;
    const ziele = {
        margin: 15,
        neighbors: [{ id: "n", regionId: "nr", name: "Nachbarin", revision: 5, polygons: [[quadrat(10, 0, 10)]] }],
        edges: [],
        riverPoints: [],
    } as unknown as EditorLandscapeTargets;
    let zeiger: { bewege(punkt: Punkt): void; klick(punkt: Punkt): void } | undefined;
    const aktualisiere = vi.fn();
    const aus = vi.fn();
    const zeige = vi.fn();
    const verschieben = createFlaecheVerschieben({
        daten: { landschaft: async () => detail, ziele: async () => ziele },
        ebenen: () => ["vegetation"],
        bearbeitung: () => b.bearbeitung,
        karte: {
            an: (_bild, z) => {
                zeiger = z;
                return { aktualisiere, aus };
            },
            zeige,
        },
    });
    const z = () => zeiger!;
    const a = () => kern.jetzt()!.teile.find((teil) => teil.objekt === "a")!.punkte;
    return { kern, verschieben, z, a, aus, zeige, ...b };
}

describe("Der Modus an der EINEN Bearbeitung (O3)", () => {
    it("🔴 nach dem Start hängt die Teilfläche an der Maus: Zeigen bewegt nur die Vorschau, erst der Klick ist ein Schritt", async () => {
        const { kern, verschieben, z, a, merkeAufbau, zeige } = aufbau();
        await verschieben.starte("r", "a", p(5, 5));
        expect(merkeAufbau).toHaveBeenCalled();
        // Die Kamera bekommt die Teile der Teilfläche (`map/geometrie/kamera.ts`, „zu sehen“ an der Form gemessen).
        expect(zeige).toHaveBeenCalledWith([
            expect.objectContaining({ punkte: [p(0, 0), p(10, 0), p(10, 10), p(0, 10)] }),
        ]);
        expect(verschieben.laufend.value).toMatchObject({ name: "Goldene Au", phase: "bereit", haengt: true });
        z().bewege(p(8, 9));
        expect(verschieben.stand()!.teile[0]!.punkte[0]).toEqual(p(3, 4));
        expect(kern.lage().ungespeichert).toBe(0);
        z().klick(p(105, 5));
        expect(kern.lage().ungespeichert).toBe(1);
        expect(a()).toEqual([p(100, 0), p(110, 0), p(110, 10), p(100, 10)]);
        expect(verschieben.laufend.value!.haengt).toBe(false);
    });

    it("🔴 💣 gemeinsame Ecken lösen sich: die Nachbarin und die andere Teilfläche bleiben, wo sie waren", async () => {
        const { kern, verschieben, z, a } = aufbau();
        await verschieben.starte("r", "a", p(5, 5));
        z().klick(p(5, 25));
        expect(a()).toEqual([p(0, 20), p(10, 20), p(10, 30), p(0, 30)]);
        expect(kern.jetzt()!.nachbarn).toEqual(kern.start()!.nachbarn);
        expect(kern.jetzt()!.nachbarn[0]!.punkte).toContainEqual(p(10, 0));
        expect(kern.jetzt()!.teile.find((teil) => teil.objekt === "b")).toEqual(
            kern.start()!.teile.find((teil) => teil.objekt === "b"),
        );
    });

    it("🔴 ein Klick an der Griffstelle setzt nur ab, kein Schritt", async () => {
        const { kern, verschieben, z } = aufbau();
        await verschieben.starte("r", "a", p(5, 5));
        z().bewege(p(50, 50));
        z().klick(p(5, 5));
        expect(kern.lage().ungespeichert).toBe(0);
        expect(verschieben.laufend.value!.haengt).toBe(false);
    });

    it("🔴 abgesetzt: ein Klick daneben tut nichts, ein Klick auf sie hebt sie auf; ↶ holt den Schritt davor", async () => {
        const { kern, verschieben, z, a } = aufbau();
        await verschieben.starte("r", "a", p(5, 5));
        z().klick(p(105, 5));
        z().klick(p(5, 5));
        expect(verschieben.laufend.value!.haengt).toBe(false);
        z().klick(p(101, 1));
        expect(verschieben.laufend.value!.haengt).toBe(true);
        z().klick(p(101, 21));
        expect(kern.lage().ungespeichert).toBe(2);
        expect(a()[0]).toEqual(p(100, 20));
        verschieben.zurueck();
        expect(a()[0]).toEqual(p(100, 0));
        verschieben.wieder();
        expect(a()[0]).toEqual(p(100, 20));
    });

    it("🔴 Esc ohne Ungeschriebenes endet sofort, auch wenn sie noch hängt; mit Ungeschriebenem fragt es erst", async () => {
        const leer = aufbau();
        await leer.verschieben.starte("r", "a", p(5, 5));
        leer.z().bewege(p(50, 50));
        expect(leer.verschieben.abbrechen()).toBe(true);
        expect(leer.verschieben.laufend.value).toBeUndefined();
        expect(leer.aus).toHaveBeenCalled();
        expect(leer.leere).toHaveBeenCalled();

        const voll = aufbau();
        await voll.verschieben.starte("r", "a", p(5, 5));
        voll.z().klick(p(105, 5));
        voll.z().klick(p(105, 5));
        expect(voll.verschieben.laufend.value!.haengt).toBe(true);
        expect(voll.verschieben.abbrechen()).toBe(true);
        expect(voll.kern.lage().frage).toBe(true);
        expect(voll.verschieben.laufend.value).toMatchObject({ haengt: false });
        expect(voll.verschieben.stand()!.teile[0]!.punkte[0]).toEqual(p(100, 0));
    });

    it("🔴 während „Fertig“ schreibt und während die Frage steht, tun Zeigen und Klick nichts; danach sagt der Hinweis „verschoben“", async () => {
        const { kern, verschieben, z, zustand, lage } = aufbau();
        await verschieben.starte("r", "a", p(5, 5));
        z().klick(p(105, 5));
        lage.value = { frage: true };
        z().klick(p(105, 5));
        expect(verschieben.laufend.value!.haengt).toBe(false);
        lage.value = { frage: false };
        zustand.value = { art: "speichert" };
        z().klick(p(105, 5));
        expect(verschieben.laufend.value!.haengt).toBe(false);
        expect(kern.lage().ungespeichert).toBe(1);
        verschieben.beende();
        zustand.value = { art: "gespeichert" };
        expect(verschieben.meldung.value).toEqual({ art: "gespeichert", name: "Goldene Au" });
    });

    it("ohne diese Teilfläche beginnt nichts, der Hinweis sagt es", async () => {
        const { kern, verschieben } = aufbau(["b"]);
        await verschieben.starte("r", "a", p(5, 5));
        expect(verschieben.laufend.value).toBeUndefined();
        expect(verschieben.meldung.value).toEqual({ art: "ohneFlaeche", name: "Goldene Au" });
        expect(kern.jetzt()).toBeUndefined();
    });
});

describe("Gestensatz an einer Art ohne Nachbarn (WI-0261, Editor-Orchestrierung 2026-10-31)", () => {
    it("🔴 in jeder Tafel steht „gemeinsame Ecken …“ an derselben Stelle; ohne ihn bleibt der übrige Satz", () => {
        for (const [sprache, tafel] of Object.entries(VERSCHIEBEN_TAFELN)) {
            const gesten = tafel["landschaftseditor.verschieben.gesten"].split(" · ");
            const finger = tafel["landschaftseditor.verschieben.gestenFinger"].split(" · ");
            expect(gesten, sprache).toHaveLength(7);
            expect(finger, sprache).toHaveLength(3);
        }
        expect(ohneTeil(de["landschaftseditor.verschieben.gesten"], GEMEINSAME_ECKEN_STELLE.gesten)).toBe(
            "Die Fläche folgt der Maus · ein Klick setzt sie ab · ein Klick auf sie hebt sie wieder auf · gestrichelt, wo sie lag · Enter schreibt · Esc fragt",
        );
        expect(ohneTeil(de["landschaftseditor.verschieben.gestenFinger"], GEMEINSAME_ECKEN_STELLE.gestenFinger)).toBe(
            "Tippen setzt die Fläche dort ab · Tippen auf sie hebt sie wieder auf",
        );
    });
});
