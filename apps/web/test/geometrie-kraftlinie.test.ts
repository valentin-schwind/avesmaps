import { describe, expect, it } from "vitest";
import { powerlineCurvedPoints, powerlineDrawnPath } from "@avesmaps3d/shared";
import { FLAECHE, WEG } from "../src/map/geometrie/arten.ts";
import { bildVon } from "../src/map/geometrie/bild.ts";
import type { Teil, Ziel } from "../src/map/geometrie/geometrie.ts";
import {
    KRAFTLINIE,
    KRAFTLINIEN_SCHEITEL,
    kraftlinienKurve,
    kraftlinienScheitel,
} from "../src/map/geometrie/kraftlinie.ts";
import { einrasten } from "../src/map/geometrie/rechnung.ts";

/**
 * Die Art „Kraftlinie“ im Geometrie-Modul und die drei Kernstellen, die sie braucht (WI-0205 K7; Blatt Kraftlinien; EDIT-0003 T28):
 * Zielart `label`, „Strg löst nicht“, der Steuergriff je Abschnitt.
 *
 * Problemfälle: Die Vorschau biegt anders als die Karte; der Scheitel liegt neben der gezeichneten Bahn oder springt beim Greifen; ein
 * Abschnitt, der Ost → West gespeichert ist, biegt zur falschen Seite; der Bogen geht über ±45 % oder bleibt krumm (−0, Kommazahlen);
 * ein Ende rastet am anderen Ende desselben Abschnitts ein; eine Beschriftung rastet hinter einer Kante ein; Weg und Fläche bekommen
 * einen Steuergriff oder verlieren „Strg löst“.
 */
const abschnitt = (wert: number | undefined, a = { x: 400, y: 400 }, b = { x: 460, y: 420 }): Teil => ({
    objekt: "kl-1",
    name: "Prüflinie",
    nr: 0,
    art: "linie",
    revision: 3,
    punkte: [a, b],
    wert,
});

describe("Kraftlinie im Geometrie-Modul (WI-0205 K7)", () => {
    it("🔴 die Vorschau ist dieselbe Rechnung wie die Karte (powerlineDrawnPath mit dem Bogen des Abschnitts)", () => {
        const teil = abschnitt(20);
        expect(KRAFTLINIE.rundung(teil.punkte, teil)).toEqual(powerlineDrawnPath(teil.punkte, 20));
        // Ohne Bogen gerade: genau die zwei Enden.
        expect(KRAFTLINIE.rundung(teil.punkte, abschnitt(undefined))).toEqual(teil.punkte);
        const bild = bildVon(KRAFTLINIE, { teile: [teil], nachbarn: [], mitgezogen: [], andock: [], marken: [] }, 12);
        expect(bild.linien.find((l) => l.rolle === "kante")?.coords).toEqual(powerlineDrawnPath(teil.punkte, 20));
        expect(bild.anfasser).toHaveLength(2);
    });

    it("🔴 der Scheitel liegt auf der gezeichneten Bahn bei t = 0,5, auch Ost → West gespeichert", () => {
        for (const [a, b] of [
            [
                { x: 400, y: 400 },
                { x: 460, y: 420 },
            ],
            [
                { x: 460, y: 420 },
                { x: 400, y: 400 },
            ],
            [
                { x: 300, y: 500 },
                { x: 300, y: 440 },
            ],
        ] as const) {
            for (const curve of [-45, -12, 0, 7, 33]) {
                const mitte = powerlineCurvedPoints(a, b, curve, 2)[1]!;
                const scheitel = kraftlinienScheitel(a, b, curve);
                expect(scheitel.x).toBeCloseTo(mitte.x, 9);
                expect(scheitel.y).toBeCloseTo(mitte.y, 9);
                // Greift man den Scheitel, ohne zu ziehen, bleibt der Bogen.
                expect(kraftlinienKurve(a, b, scheitel)).toBe(curve);
            }
        }
    });

    it("🔴 der Zug am Scheitel begrenzt auf ±45 % und rundet auf ganze Prozent, ohne −0", () => {
        const teil = abschnitt(0);
        const weit = kraftlinienScheitel(teil.punkte[0]!, teil.punkte[1]!, 45);
        const ueber = { x: weit.x + (weit.x - 430) * 3, y: weit.y + (weit.y - 410) * 3 };
        expect(KRAFTLINIEN_SCHEITEL.wert(teil, ueber)).toBe(45);
        const gegen = { x: 430 - (ueber.x - 430), y: 410 - (ueber.y - 410) };
        expect(KRAFTLINIEN_SCHEITEL.wert(teil, gegen)).toBe(-45);
        const knapp = kraftlinienScheitel(teil.punkte[0]!, teil.punkte[1]!, 12.4);
        expect(KRAFTLINIEN_SCHEITEL.wert(teil, knapp)).toBe(12);
        expect(Object.is(KRAFTLINIEN_SCHEITEL.wert(teil, { x: 430, y: 409.9999 }), -0)).toBe(false);
    });

    it("🔴 das Bild trägt je Abschnitt einen Steuergriff am Scheitel; der gezogene ist hervorgehoben", () => {
        const erster = abschnitt(20);
        const zweiter: Teil = { ...abschnitt(-10, { x: 460, y: 420 }, { x: 520, y: 380 }), objekt: "kl-2" };
        const bild = bildVon(
            KRAFTLINIE,
            {
                teile: [erster, zweiter],
                nachbarn: [],
                mitgezogen: [],
                andock: [],
                marken: [],
                gesteuert: { objekt: "kl-2", nr: 0 },
            },
            12,
        );
        expect(bild.steuergriffe).toEqual([
            { at: kraftlinienScheitel(erster.punkte[0]!, erster.punkte[1]!, 20), objekt: "kl-1", nr: 0, aktiv: false },
            {
                at: kraftlinienScheitel(zweiter.punkte[0]!, zweiter.punkte[1]!, -10),
                objekt: "kl-2",
                nr: 0,
                aktiv: true,
            },
        ]);
    });

    it("🔴 Enden rasten an Ort, Beschriftung und Kraftlinienpunkt ein, nie am anderen Ende; die Beschriftung geht der Kante vor", () => {
        const teil = abschnitt(0);
        const stelle = { objekt: "kl-1", nr: 0, index: 1 };
        expect(KRAFTLINIE.ziele(stelle, teil)).toEqual(["ort", "label", "ecke"]);
        const amAnfang: Ziel = { art: "ecke", at: { x: 400, y: 400 }, objekt: "kl-1", name: "Prüflinie" };
        expect(KRAFTLINIE.zielErlaubt(amAnfang, stelle, teil)).toBe(false);
        const anderswo: Ziel = { art: "label", at: { x: 470, y: 425 }, objekt: "lb-1", name: "Nodix" };
        expect(KRAFTLINIE.zielErlaubt(anderswo, stelle, teil)).toBe(true);
        // Beschriftung und Kante gleich weit vom Zeiger: Die Beschriftung gewinnt wie Ort und Ecke.
        const schirm = (p: { x: number; y: number }) => p;
        const kante: Ziel = { art: "kante", at: { x: 100, y: 95 }, bis: { x: 100, y: 105 }, objekt: "w", name: "Weg" };
        const label: Ziel = { art: "label", at: { x: 104, y: 100 }, objekt: "lb", name: "Nodix" };
        const treffer = einrasten({ x: 102, y: 100 }, [kante, label], ["label", "kante"], 10, schirm, () => true);
        expect(treffer?.ziel.art).toBe("label");
    });

    it("🔴 Strg löst nur bei der Kraftlinie nicht; nur sie hat einen Steuergriff, keinen Punkt dazwischen und nichts zieht mit", () => {
        expect(KRAFTLINIE.loesen).toBe(false);
        expect(WEG.loesen).toBeUndefined();
        expect(FLAECHE.loesen).toBeUndefined();
        expect(WEG.steuergriff).toBeUndefined();
        expect(FLAECHE.steuergriff).toBeUndefined();
        const teil = abschnitt(0);
        expect(KRAFTLINIE.einfuegen).toBe(false);
        expect(KRAFTLINIE.loeschbar({ objekt: "kl-1", nr: 0, index: 0 }, teil)).toBe(false);
        expect(KRAFTLINIE.mitziehen).toBe(false);
        // Weg und Fläche zeichnen weiter ohne Steuergriffe.
        const weg: Teil = { ...teil, objekt: "w-1", wert: undefined };
        expect(
            bildVon(WEG, { teile: [weg], nachbarn: [], mitgezogen: [], andock: [], marken: [] }, 12).steuergriffe,
        ).toEqual([]);
    });
});
