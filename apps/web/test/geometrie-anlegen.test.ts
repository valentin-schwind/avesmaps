import { describe, expect, it, vi } from "vitest";
import {
    ANLEGEN_ANFANG,
    anlegenStand,
    anlegenStart,
    anlegenTut,
    anlegenZiele,
    anlegenZielarten,
    setze,
    wieder,
    zurueck,
    type AnlegenArt,
    type AnlegenEntwurf,
} from "../src/map/geometrie/anlegen";
import { anlegenBild } from "../src/map/geometrie/anlegen-bild";
import { WEG_ANLEGEN } from "../src/map/geometrie/arten";
import type { Punkt, Treffer, Ziel } from "../src/map/geometrie/geometrie";
import { deckungsgleich } from "../src/map/geometrie/rechnung";

/**
 * Der Modus „Anlegen“ des Geometrie-Moduls als reine Rechnung (WI-0177; EDIT-0003 R3, R12, T24 (4)). Problemfälle: Der Klick am Ort
 * beendet nicht; der Klick am Stützpunkt beendet, obwohl der Weg weitergehen soll; ↶ nimmt den festen Anfang weg; das Ende darf auf
 * dem Anfang liegen; ein Punkt des eigenen Entwurfs ist ein Ziel; ein Ring schließt nicht am ersten Punkt; die Kraftlinie setzt
 * Zwischenpunkte.
 */

const ORT: Ziel = { art: "ort", at: { x: 10, y: 10 }, objekt: "ort-1", name: "Gareth" };
const ECKE: Ziel = { art: "ecke", at: { x: 20, y: 10 }, objekt: "weg-1", name: "Reichsstraße 1" };
const treffer = (ziel: Ziel): Treffer => ({ ziel, at: ziel.at, abstand: 2 });
const p = (x: number, y: number): Punkt => ({ x, y });

/** Ein Ring wie die Fläche: schließt am ersten Punkt, ab drei Punkten. */
const RING: AnlegenArt = {
    id: "ring",
    teilart: "ring",
    rundung: (punkte) => [...punkte],
    ziele: () => ["ecke"],
    amZiel: () => "einrasten",
    schliesst: true,
    mindestens: 3,
    pruefe: (punkte) => (punkte.length < 3 ? "zuWenig" : undefined),
};

/** Eine Linie nur zwischen Zielen, wie die Kraftlinie zwischen Nodices. */
const NUR_ZIELE: AnlegenArt = {
    id: "kraftlinie",
    teilart: "linie",
    rundung: (punkte) => [...punkte],
    ziele: () => ["ort"],
    amZiel: () => "beenden",
    nurZiele: true,
    mindestens: 2,
    pruefe: (punkte) => (punkte.length < 2 ? "zuWenig" : undefined),
    loesen: false,
};

function nach(art: AnlegenArt, entwurf: AnlegenEntwurf, at: Punkt, t?: Treffer): AnlegenEntwurf {
    const ergebnis = setze(art, entwurf, at, t);
    if (ergebnis === undefined) throw new Error("nichts gesetzt");
    return ergebnis.entwurf;
}

describe("Anlegen: der Entwurf (WI-0177)", () => {
    it("🔴 Weg: am Ort beendet der Klick, am Stützpunkt rastet er nur ein (P5, R12)", () => {
        let e = anlegenStart({ at: p(0, 0), ziel: undefined });
        const amStuetzpunkt = setze(WEG_ANLEGEN, e, p(19, 10), treffer(ECKE));
        expect(amStuetzpunkt?.beenden).toBe(false);
        expect(amStuetzpunkt?.entwurf.punkte.at(-1)).toEqual({ at: ECKE.at, ziel: ECKE });
        e = amStuetzpunkt!.entwurf;
        const amOrt = setze(WEG_ANLEGEN, e, p(11, 11), treffer(ORT));
        expect(amOrt?.beenden).toBe(true);
        expect(amOrt?.entwurf.punkte.map((q) => q.at)).toEqual([p(0, 0), ECKE.at, ORT.at]);
    });

    it("🔴 der erste Punkt beendet nie, auch nicht am Ort", () => {
        const ergebnis = setze(WEG_ANLEGEN, anlegenStart(), p(10, 10), treffer(ORT));
        expect(ergebnis?.beenden).toBe(false);
        expect(anlegenTut(WEG_ANLEGEN, anlegenStart(), ORT)).toBe("einrasten");
    });

    it("ein Klick auf den letzten Punkt setzt nichts (kein Doppelpunkt)", () => {
        const e = anlegenStart({ at: p(5, 5), ziel: undefined });
        expect(setze(WEG_ANLEGEN, e, p(5, 5), undefined)).toBeUndefined();
    });

    it("🔴 ↶ nimmt den festen Anfang nie, ↷ holt zurück, ein neuer Punkt löscht ↷", () => {
        const start = anlegenStart({ at: p(0, 0), ziel: ORT });
        let e = nach(WEG_ANLEGEN, start, p(5, 0));
        e = nach(WEG_ANLEGEN, e, p(9, 0));
        e = zurueck(e);
        expect(e.punkte.map((q) => q.at)).toEqual([p(0, 0), p(5, 0)]);
        expect(anlegenStand(WEG_ANLEGEN, e)).toMatchObject({ abschnitte: 1, zurueck: true, wieder: true });
        e = zurueck(zurueck(e));
        expect(e.punkte.map((q) => q.at)).toEqual([p(0, 0)]);
        expect(anlegenStand(WEG_ANLEGEN, e)).toMatchObject({ zurueck: false, fertig: "zuWenig" });
        e = wieder(e);
        expect(e.punkte).toHaveLength(2);
        e = nach(WEG_ANLEGEN, e, p(7, 7));
        expect(e.wieder).toEqual([]);
    });

    it("🔴 Weg: fertig ab zwei Punkten, nie mit dem Ende auf dem Anfang", () => {
        expect(WEG_ANLEGEN.pruefe([p(0, 0)])).toBe("zuWenig");
        expect(WEG_ANLEGEN.pruefe([p(0, 0), p(1, 0), p(0, 0)])).toBe("aufeinander");
        expect(WEG_ANLEGEN.pruefe([p(0, 0), p(1, 0)])).toBeUndefined();
    });

    it("🔴 Punkte des eigenen Entwurfs sind keine Ziele; beim Ring schließt der Anfang ab drei Punkten", () => {
        const eigener: Ziel = { art: "ecke", at: p(0, 0), objekt: "weg-2", name: "" };
        let e = anlegenStart({ at: p(0, 0), ziel: undefined });
        expect(anlegenZiele(WEG_ANLEGEN, e, [eigener, ECKE])).toEqual([ECKE]);
        e = nach(RING, e, p(5, 0));
        expect(anlegenZiele(RING, e, []).map((z) => z.objekt)).toEqual([]);
        e = nach(RING, e, p(5, 5));
        const ziele = anlegenZiele(RING, e, []);
        expect(ziele.map((z) => z.objekt)).toEqual([ANLEGEN_ANFANG]);
        const schliessen = setze(RING, e, p(0.1, 0), treffer(ziele[0]!));
        expect(schliessen?.beenden).toBe(true);
        // Der Ring wiederholt seinen Anfang nicht.
        expect(schliessen?.entwurf.punkte).toHaveLength(3);
        expect(anlegenZielarten(RING, e)).toContain("ecke");
    });

    it("🔴 viele Ziele und viele Ecken: Das Filtern baut keine Zeichenkette je Paar (WI-0283 §7)", () => {
        let e = anlegenStart();
        for (let i = 0; i < 40; i++) e = nach(RING, e, p(i, 100));
        const ziele: Ziel[] = Array.from({ length: 5000 }, (_, i) => ({
            art: "ecke",
            at: p(i * 0.1, 500),
            objekt: `o${i}`,
            name: "",
        }));
        const fixiert = vi.spyOn(Number.prototype, "toFixed");
        const raus = anlegenZiele(RING, e, ziele);
        const aufrufe = fixiert.mock.calls.length;
        fixiert.mockRestore();
        expect(aufrufe).toBe(0);
        expect(raus).toHaveLength(5001);
    });

    it("deckungsgleich bleibt die Gleichheit auf fünf Stellen", () => {
        expect(deckungsgleich(p(1.000001, 2), p(1.000004, 2))).toBe(true);
        expect(deckungsgleich(p(1.000004, 2), p(1.000006, 2))).toBe(false);
        expect(deckungsgleich(p(1, 2), p(1.00002, 2))).toBe(false);
        expect(deckungsgleich(p(1, 2), p(1, 2))).toBe(true);
    });

    it("🔴 nur zwischen Zielen: neben einem Ziel setzt der Klick nichts, am Ziel beendet er", () => {
        const e = anlegenStart({ at: p(10, 10), ziel: ORT });
        expect(setze(NUR_ZIELE, e, p(15, 15), undefined)).toBeUndefined();
        const anderer: Ziel = { ...ORT, at: p(30, 30), objekt: "ort-2" };
        expect(setze(NUR_ZIELE, e, p(30, 30), treffer(anderer))?.beenden).toBe(true);
    });
});

describe("Anlegen: das Bild", () => {
    it("Kante aus den gesetzten Punkten, Gummiband gestrichelt zum Zeiger, Hülle und Kringel", () => {
        let e = anlegenStart({ at: p(0, 0), ziel: undefined });
        e = nach(WEG_ANLEGEN, e, p(10, 0));
        const bild = anlegenBild(
            WEG_ANLEGEN,
            { entwurf: e, zeiger: ORT.at, treffer: treffer(ORT), rastet: true, andock: [ORT] },
            10,
        );
        expect(bild.linien.map((l) => l.rolle)).toEqual(["kante", "folge"]);
        expect(bild.linien[1]?.coords).toEqual([p(10, 0), ORT.at]);
        expect(bild.anfasser.map((a) => a.ende)).toEqual([true, true]);
        expect(bild.ringe.map((r) => r.art)).toEqual(["huelle", "kringel"]);
        expect(bild.andock).toEqual([ORT.at]);
    });

    it("ohne Zeiger kein Gummiband, mit einem Punkt keine Kante", () => {
        const bild = anlegenBild(
            WEG_ANLEGEN,
            { entwurf: anlegenStart({ at: p(0, 0), ziel: undefined }), andock: [] },
            10,
        );
        expect(bild.linien).toEqual([]);
        expect(bild.anfasser).toHaveLength(1);
    });
});
