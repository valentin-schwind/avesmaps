import { describe, expect, it } from "vitest";
import { GEBIRGS_PRESETS_VORGABE as P, rueckennetzVorgabe, typVorschlag, type GebirgsStand } from "@avesmaps3d/shared";
import {
    abweichungen,
    aehnlichsterTyp,
    aenderungAus,
    geltendeKammhoehe,
    geltenderWert,
    geltendesMuster,
    geltenderModellwert,
    GEBIRGE_LEER,
    gleich,
    hatKaemme,
    mitModellwert,
    rechnetMitRueckennetz,
    mitMuster,
    mitTyp,
    mitWert,
    ohneModellwert,
    ohneWert,
    stufeMit,
    weichtAb,
    weichtModellAb,
    type GebirgsEntwurf,
} from "../src/landschaftseditor/gebirge-stand.ts";

/**
 * Das Gebirge im Entwurf der Fläche (WI-0178 P4, Fassung 16, Vertrag WI-0226). Problemfälle: ↺ reist als `null` und landet als 0 (ajv);
 * ein Wert gleich dem Preset bleibt als Abweichung stehen; ein Typwechsel behält Legacys alte Werte still; „Keins passt“ springt still auf
 * die Vorgabe der Rechnung; ein unveränderter Stand schickt trotzdem eine Änderung.
 */
const LEGACY: GebirgsStand = { typ: null, werte: { plateau: 0.9, koernung: 14 }, muster: null, kammhoehe: 4000 };

describe("Gebirge im Entwurf (WI-0178 P4)", () => {
    it("🔴 ↺ an Kammhöhe und Plateau geht als `zurueck`, nie als `null`; der Wert daneben als Zahl", () => {
        const jetzt = mitWert(ohneWert({ ...LEGACY, kammhoehe: null }, "plateau"), P, "koernung", 40);
        const aenderung = aenderungAus(LEGACY, jetzt);
        expect(aenderung).toEqual({ werte: { koernung: 40 }, zurueck: ["kammhoehe", "plateau"] });
        expect(JSON.stringify(aenderung)).not.toContain("null");
    });

    it("🔴 ein Wert gleich dem Preset ist keine Abweichung mehr (F2)", () => {
        const kamm: GebirgsStand = { typ: "kammgebirge", werte: { koernung: 20 }, muster: null, kammhoehe: null };
        expect(weichtAb(kamm, P, "koernung")).toBe(true);
        const zurueck = mitWert(kamm, P, "koernung", P.typen.kammgebirge.werte.koernung);
        expect(zurueck.werte).toEqual({});
        expect(abweichungen(zurueck, P)).toBe(0);
        expect(aenderungAus(kamm, zurueck)).toEqual({ zurueck: ["koernung"] });
    });

    it('🔴 die gewürfelte Saat geht als `saat`, zurück auf die abgeleitete als `zurueck: ["saat"]`', () => {
        const ohne: GebirgsStand = { typ: null, werte: {}, muster: null, kammhoehe: null };
        expect(aenderungAus(ohne, { ...ohne, saat: 42 })).toEqual({ saat: 42 });
        expect(aenderungAus({ ...ohne, saat: 42 }, { ...ohne, saat: null })).toEqual({ zurueck: ["saat"] });
        expect(aenderungAus({ ...ohne, saat: null }, ohne)).toBeUndefined();
    });

    it("🔴 ein Typwechsel nimmt Legacys alte Werte zurück, der Typ gilt ganz (Fassung 16, „zurücksetzen“)", () => {
        const jetzt = mitTyp(LEGACY, P, "rumpfgebirge");
        expect(geltenderWert(jetzt, P, "plateau")).toBe(P.typen.rumpfgebirge.werte.plateau);
        expect(aenderungAus(LEGACY, jetzt)).toEqual({ typ: "rumpfgebirge", zurueck: ["plateau", "koernung"] });
        // Die Kammhöhe ist kein Wert des Typs: Sie bleibt.
        expect(jetzt.kammhoehe).toBe(4000);
    });

    it("🔴 „Keins passt“ nimmt die geltenden Werte als eigene, statt still auf die Rechnung zu springen", () => {
        const massig: GebirgsStand = { typ: "massengebirge", werte: { sattel: 0.6 }, muster: null, kammhoehe: null };
        const keins = mitTyp(massig, P, null);
        expect(keins.typ).toBeNull();
        expect(geltenderWert(keins, P, "koernung")).toBe(P.typen.massengebirge.werte.koernung);
        expect(geltenderWert(keins, P, "sattel")).toBe(0.6);
        expect(geltendesMuster(keins, P)).toBe("zellen");
        expect(aenderungAus(massig, keins)?.zurueck).toEqual(["typ"]);
    });

    it("das Grundmuster des Presets ist keine Abweichung; ohne Typ ist „rauschen“ die Vorgabe", () => {
        const kamm: GebirgsStand = { typ: "kammgebirge", werte: {}, muster: null, kammhoehe: null };
        expect(mitMuster(mitMuster(kamm, P, "zellen"), P, "rauschen").muster).toBeNull();
        expect(geltendesMuster(LEGACY, P)).toBe("rauschen");
    });

    it("Kammhöhe: die eigene, sonst die Grundhöhe; die Schnellwahl kennt die Stufe nur bei genau ihrer Höhe", () => {
        expect(geltendeKammhoehe(LEGACY, 1500)).toBe(4000);
        expect(geltendeKammhoehe({ ...LEGACY, kammhoehe: null }, 1500)).toBe(1500);
        expect(stufeMit(P, 1500)).toBe("mittelgebirge");
        expect(stufeMit(P, 1501)).toBeUndefined();
    });

    it("unverändert: keine Änderung, gleich", () => {
        expect(aenderungAus(LEGACY, { ...LEGACY, werte: { ...LEGACY.werte } })).toBeUndefined();
        expect(gleich(LEGACY, { ...LEGACY })).toBe(true);
    });

    it("„ähnlichstes“: das Preset nächst den eigenen Werten; mit Typ oder ohne eigene Werte keins", () => {
        // Legacys Werte eines Kammgebirges (Kammschärfe 0,9, Massigkeit 0,45, Körnung 14) finden es wieder.
        const legacy: GebirgsStand = {
            typ: null,
            werte: { plateau: 0.9, hypsometrie: 0.45, koernung: 14, erosion: 3, einschnitt: 550 },
            muster: null,
            kammhoehe: null,
        };
        expect(aehnlichsterTyp(legacy, P)).toBe("kammgebirge");
        expect(aehnlichsterTyp({ ...legacy, typ: "karst" }, P)).toBeUndefined();
        expect(aehnlichsterTyp({ ...legacy, werte: {} }, P)).toBeUndefined();
    });
});

describe("Rückennetz im Entwurf (WI-0245, Bauplan Gebirge D1/D3)", () => {
    const KAMM = {
        punkte: [
            [502, 510],
            [518, 509],
        ] as [number, number][],
        rang: "haupt" as const,
    };
    const BERG: GebirgsEntwurf = {
        ...GEBIRGE_LEER,
        typ: "kammgebirge",
        netz: { kaemme: [KAMM], nebengipfel: [{ x: 510, y: 512, h: null }] },
        revision: 4,
    };
    const vorschlag = rueckennetzVorgabe(P, "kammgebirge");

    it("🔴 Werte des Rückennetzes: Preset aus dem Vorschlag des Typs, gleich dem Preset ist keine Abweichung, ↺ nimmt den eigenen weg", () => {
        expect(geltenderModellwert(BERG, P, "grat")).toBe(vorschlag.grat);
        const eigen = mitModellwert(BERG, P, "grat", 0.25);
        expect(eigen.modell).toEqual({ grat: 0.25 });
        expect(weichtModellAb(eigen, P, "grat")).toBe(true);
        expect(mitModellwert(eigen, P, "grat", vorschlag.grat).modell).toEqual({});
        // Außerhalb der Grenzen (Gratlinie bis 0,3): an die Grenze gelegt.
        expect(mitModellwert(BERG, P, "grat", 9).modell).toEqual({ grat: 0.3 });
        expect(ohneModellwert(eigen, "grat").modell).toEqual({});
    });

    it("🔴 „Fertig“: Werte des Rückennetzes, ↺ über `zurueck`, das Netz als Ganzes ohne `h: null`, gegen die Revision des Starts", () => {
        const start: GebirgsEntwurf = { ...BERG, modell: { talboden: 0.4 } };
        const jetzt: GebirgsEntwurf = {
            ...ohneModellwert(mitModellwert(start, P, "gratBreite", 0.8), "talboden"),
            netz: {
                ...BERG.netz!,
                nebengipfel: [
                    { x: 510, y: 512, h: null },
                    { x: 505, y: 505, h: 1200 },
                ],
            },
        };
        expect(aenderungAus(start, jetzt)).toEqual({
            modell: { gratBreite: 0.8 },
            netz: {
                mulden: [],
                kaemme: [KAMM],
                nebengipfel: [
                    { x: 510, y: 512 },
                    { x: 505, y: 505, h: 1200 },
                ],
                // Die Höhen an Flüssen und Seen (WI-0249, 0230) gehen immer mit, auch leer: Leer nimmt die gespeicherten weg.
                flussHoehen: [],
                seeHoehen: [],
            },
            zurueck: ["talboden"],
            baseRevision: 4,
        });
        expect(aenderungAus(start, { ...start })).toBeUndefined();
        expect(gleich(start, jetzt)).toBe(false);
        // Die Revision ist kein Wert: Ein neu gelesener Stand mit anderer Revision ist gleich.
        expect(gleich(start, { ...start, revision: 5 })).toBe(true);
    });

    it("🔴 die drei Werte stehen nur mit Kämmen; ein Typwechsel nimmt eigene Werte des Rückennetzes zurück, „Keins passt“ behält, was galt", () => {
        expect(hatKaemme(GEBIRGE_LEER)).toBe(false);
        expect(hatKaemme(BERG)).toBe(true);
        // Nur Nebengipfel: Rückennetz erst mit Köpfen des Typs (WI-0249 P2, Typwert `form.kopf` der Fassung).
        const punkte: GebirgsEntwurf = { ...BERG, netz: { kaemme: [], nebengipfel: [{ x: 510, y: 512, h: null }] } };
        expect(rechnetMitRueckennetz(BERG, P)).toBe(true);
        expect(rechnetMitRueckennetz(punkte, P)).toBe(false);
        const t = P.typen.kammgebirge;
        const vorschlag19 = {
            ...t,
            rueckennetz: { ...typVorschlag("kammgebirge"), form: { ...typVorschlag("kammgebirge").form, kopf: 0.06 } },
        };
        expect(rechnetMitRueckennetz(punkte, { ...P, typen: { ...P.typen, kammgebirge: vorschlag19 } })).toBe(true);
        const eigen: GebirgsEntwurf = { ...BERG, modell: { grat: 0.25 } };
        expect(mitTyp(eigen, P, "gratgebirge").modell).toEqual({});
        expect(mitTyp(eigen, P, null).modell).toEqual({ grat: 0.25, gratBreite: vorschlag.gratBreite });
    });
});
