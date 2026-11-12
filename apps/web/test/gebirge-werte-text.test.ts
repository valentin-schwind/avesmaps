import { describe, expect, it } from "vitest";
import { GEBIRGS_PRESETS_VORGABE as P } from "@avesmaps3d/shared";
import { GEBIRGE_LEER, type GebirgsEntwurf } from "../src/landschaftseditor/gebirge-stand";
import { leseZahl, werteEinfuegen, werteText } from "../src/landschaftseditor/gebirge-werte-text";

/**
 * „Werte kopieren“ und „Werte einfügen“ (WI-0245, Bauvorlage Gebirge-Entwurf V16). Problemfälle: Der kopierte Text lässt sich am anderen
 * Gebirge nicht einfügen (Typ zuletzt gesetzt, setzt die Werte zurück); das Netz geht verloren; deutsche Zahlen („1.100“, „0,53“) kommen
 * als falsche Zahl an; eine fremde Zeile wird still zu einem Wert.
 */
const QUELLE: GebirgsEntwurf = {
    ...GEBIRGE_LEER,
    typ: "kammgebirge",
    kammhoehe: 2800,
    werte: { plateau: 0.5, koernung: 30 },
    modell: { grat: 0.25 },
    netz: {
        kaemme: [
            {
                punkte: [
                    [500.5, 510],
                    [512, 515.25],
                ],
                rang: "haupt",
            },
        ],
        nebengipfel: [{ x: 505, y: 505, h: 1800 }],
    },
    revision: 3,
};
const lage = (stand: GebirgsEntwurf) => ({
    name: "Probe",
    stand,
    presets: P,
    kammhoehe: stand.kammhoehe ?? 1500,
    peaks: [{ id: "g1", name: "Zinne", height: 3000 }],
    gipfelHoehen: stand === QUELLE ? { g1: 3200 } : {},
});

describe("Werte kopieren und einfügen (WI-0245)", () => {
    it("🔴 der kopierte Text setzt am anderen Gebirge Typ, Kammhöhe, Werte, Rückennetz, Gipfelhöhe und Netz", () => {
        const text = werteText(lage(QUELLE));
        const ziel: GebirgsEntwurf = { ...GEBIRGE_LEER, revision: 7 };
        const r = werteEinfuegen(text, lage(ziel));
        expect(r.uebersprungen).toEqual([]);
        expect(r.stand.typ).toBe("kammgebirge");
        expect(r.stand.kammhoehe).toBe(2800);
        expect(r.stand.werte).toEqual(QUELLE.werte);
        expect(r.stand.modell).toEqual({ grat: 0.25 });
        expect(r.stand.netz).toEqual(QUELLE.netz);
        expect(r.gipfelHoehen).toEqual({ g1: 3200 });
        // Die Revision bleibt die des Ziels: Eingefügt wird gegen seinen Stand.
        expect(r.stand.revision).toBe(7);
    });

    it("🔴 die Saat wandert mit (Migration 0214): als gewürfelte Saat am Ziel, auch negativ; Unsinn wird übersprungen", () => {
        const text = werteText({ ...lage(QUELLE), saat: -12345 });
        expect(text).toContain("Saat: -12345");
        expect(werteEinfuegen(text, lage({ ...GEBIRGE_LEER })).stand.saat).toBe(-12345);
        const kaputt = werteEinfuegen("Saat: 1.5", lage({ ...GEBIRGE_LEER }));
        expect(kaputt.uebersprungen).toEqual(["Saat: 1.5"]);
    });

    it("🔴 deutsche und englische Zahlen; eine fremde Zeile wird übersprungen, nicht still ein Wert", () => {
        expect(leseZahl("1.100")).toBe(1100);
        expect(leseZahl("0,53")).toBe(0.53);
        expect(leseZahl("0.53")).toBe(0.53);
        const r = werteEinfuegen("Unsinn: 4\nGebirge: Egal", lage({ ...GEBIRGE_LEER }));
        expect(r.gesetzt).toBe(0);
        expect(r.uebersprungen).toEqual(["Unsinn: 4"]);
    });
});
