import { describe, expect, it } from "vitest";
import { SMOOTH_NET_OPTIONS, smoothNet } from "@avesmaps3d/shared";
import { FLAECHE, rundeRing } from "../src/map/geometrie/arten.ts";
import { bildVon } from "../src/map/geometrie/bild.ts";
import type { Teil, Ziel } from "../src/map/geometrie/geometrie.ts";

/**
 * Die Art „Fläche“ im Geometrie-Modul (WI-0178 C1; EDIT-0004 §2.3; EDIT-0003 T27 (6)). Problemfälle: Die Vorschau rundet anders als
 * die Karte; der eckige Umriss fehlt neben der Rundung; eine Ecke rastet an der eigenen Teilfläche ein; eine Fläche fällt unter drei
 * Ecken; eine Kante nimmt keinen eingefügten Punkt.
 */
const quadrat: Teil = {
    objekt: "f-1",
    name: "Probe",
    nr: 0,
    art: "ring",
    revision: 1,
    punkte: [
        { x: 400, y: 400 },
        { x: 410, y: 400 },
        { x: 410, y: 410 },
        { x: 400, y: 410 },
    ],
};

describe("Fläche im Geometrie-Modul", () => {
    it("🔴 die Vorschau rundet wie die Karte: ein Ring allein ergibt dieselben Punkte wie das Netz", () => {
        const geschlossen = [...quadrat.punkte, quadrat.punkte[0]!];
        const vorschau = rundeRing(geschlossen);
        const ring = Float64Array.from(geschlossen.flatMap((p) => [p.x, p.y]));
        const netz = smoothNet([{ id: 1, layer: "vegetation", polygons: [[ring]] }], SMOOTH_NET_OPTIONS).shapes.get(
            1,
        )![0]![0]!;
        const punkte = (coords: Float64Array): Set<string> => {
            const aus = new Set<string>();
            for (let i = 0; i + 1 < coords.length; i += 2)
                aus.add(`${coords[i]!.toFixed(6)} ${coords[i + 1]!.toFixed(6)}`);
            return aus;
        };
        expect(new Set(vorschau.map((p) => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`))).toEqual(punkte(netz));
        expect(vorschau.length).toBeGreaterThan(quadrat.punkte.length);
    });

    it("🔴 Bild: die Rundung als Kante und der eckige Umriss dünn dazu (T27 (6))", () => {
        const bild = bildVon(FLAECHE, { teile: [quadrat], nachbarn: [], mitgezogen: [], andock: [], marken: [] }, 12);
        expect(bild.linien.map((linie) => linie.rolle)).toEqual(["kante", "ecken"]);
        const ecken = bild.linien.find((linie) => linie.rolle === "ecken")!;
        expect(ecken.coords).toEqual([...quadrat.punkte, quadrat.punkte[0]]);
        // Ein Anfasser je Ecke, keiner ist ein Ende (ein Ring hat keine).
        expect(bild.anfasser.map((anfasser) => anfasser.ende)).toEqual([false, false, false, false]);
    });

    it("🔴 Bild mit ausgeschalteter Rundung (Taste R): die Kante gerade durch die Punkte, kein dünner Umriss, die Anfasser bleiben", () => {
        const bild = bildVon(
            FLAECHE,
            { teile: [quadrat], nachbarn: [], mitgezogen: [], andock: [], marken: [], eckig: true },
            12,
        );
        expect(bild.linien.map((linie) => linie.rolle)).toEqual(["kante"]);
        expect(bild.linien[0]!.coords).toEqual([...quadrat.punkte, quadrat.punkte[0]]);
        expect(bild.anfasser).toHaveLength(4);
    });

    it("🔴 Regeln: Ecke und Kante als Ziel, nie die eigene Teilfläche; drei Ecken bleiben; Einfügen geht", () => {
        const stelle = { objekt: "f-1", nr: 0, index: 1 };
        expect(FLAECHE.ziele(stelle, quadrat)).toEqual(["ecke", "kante"]);
        const ziel = (objekt: string): Ziel => ({ art: "ecke", at: { x: 1, y: 1 }, objekt, name: "x" });
        expect(FLAECHE.zielErlaubt(ziel("f-1"), stelle, quadrat)).toBe(false);
        expect(FLAECHE.zielErlaubt(ziel("f-2"), stelle, quadrat)).toBe(true);
        expect(FLAECHE.loeschbar(stelle, quadrat)).toBe(true);
        expect(FLAECHE.loeschbar(stelle, { ...quadrat, punkte: quadrat.punkte.slice(0, 3) })).toBe(false);
        expect([FLAECHE.mindestens, FLAECHE.einfuegen, FLAECHE.mitziehen]).toEqual([3, true, true]);
    });
});
