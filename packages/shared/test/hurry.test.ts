import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "../src/travel-model-registry.ts";
import {
    hurryBlockedByGround,
    hurryBlockingLandscapes,
    hurryFactor,
    hurryPacedHours,
    isHurryDay,
} from "../src/transport-rules.ts";

/**
 * Die Eiltempo-Regeln des Reisemodells (WI-0078, Geographia Aventurica S. 123): Jede Zahl steht in
 * `config/travel-model/aventuria.json`, keine im Code. Diese Prüfungen halten fest, WAS dort steht - sie sind der
 * Ort, an dem eine stille Änderung auffällt.
 */

const model = AVENTURIA_TRAVEL_MODEL;

describe("die Faktoren der Geographia", () => {
    it("🔴 Tagesleistung × Faktor ergibt genau die Eilwerte der Quelle (S. 123)", () => {
        const erwartet: Record<string, number> = {
            groupFoot: 45,
            lightWalker: 60,
            groupHorse: 52.5,
            lightRider: 75,
            cart: 31.25,
            wagon: 37.5,
            horseCarriage: 62.5,
            // Der Schlitten hat seit WI-0258 (E3) die Grundleistung der Kaleschka: 42 × 1,25.
            sleigh: 52.5,
        };
        for (const [transport, rule] of Object.entries(model.eiltempo.wert.mittel)) {
            const meilen = model.tagesleistung.wert[transport]?.meilen ?? 0;
            expect(meilen * rule.faktor, transport).toBeCloseTo(erwartet[transport] ?? 0, 10);
        }
        expect(Object.keys(model.eiltempo.wert.mittel).sort()).toEqual(Object.keys(erwartet).sort());
    });

    it("Eilmarsch und Eilritt 1,5, Fahrzeuge und Schlitten 1,25", () => {
        const faktor = (transport: string): number => model.eiltempo.wert.mittel[transport]?.faktor ?? 0;
        expect(["groupFoot", "lightWalker", "groupHorse", "lightRider"].map(faktor)).toEqual([1.5, 1.5, 1.5, 1.5]);
        expect(["cart", "wagon", "horseCarriage", "sleigh"].map(faktor)).toEqual([1.25, 1.25, 1.25, 1.25]);
    });

    it("🔴 Kamel, Fluss, Meer und Flug haben keine Eilregel", () => {
        const ohne = [
            "caravan",
            "riverSailer",
            "riverBarge",
            "riverGalley",
            "rowboat",
            "cargoShip",
            "fastShip",
            "galley",
            "courierDromone",
        ];
        for (const transport of ohne) expect(model.eiltempo.wert.mittel[transport], transport).toBeUndefined();
        expect(hurryFactor(model, "griffin", "Flug")).toBe(1);
    });
});

describe("die Wegarten (Betreiber 2026-10-05: „nimm die vier raus“)", () => {
    it("Reichsstraße, Straße und Weg für alle - Pfad und Wüstenpfad nur zu Fuß", () => {
        for (const transport of Object.keys(model.eiltempo.wert.mittel)) {
            for (const wegart of ["Reichsstrasse", "Strasse", "Weg"]) {
                expect(hurryFactor(model, transport, wegart), `${transport}/${wegart}`).toBeGreaterThan(1);
            }
        }
        for (const wegart of ["Pfad", "Wuestenpfad"]) {
            expect(hurryFactor(model, "groupFoot", wegart)).toBe(1.5);
            expect(hurryFactor(model, "lightWalker", wegart)).toBe(1.5);
            expect(hurryFactor(model, "groupHorse", wegart)).toBe(1);
            expect(hurryFactor(model, "wagon", wegart)).toBe(1);
        }
    });

    it("🔴 Gebirgspass, Querfeldein, Flussweg und Seeweg stehen in keiner Liste", () => {
        for (const [transport, rule] of Object.entries(model.eiltempo.wert.mittel)) {
            for (const wegart of ["Gebirgspass", "Querfeldein", "Flussweg", "Seeweg", "Flug"]) {
                expect(rule.wegarten, `${transport}/${wegart}`).not.toContain(wegart);
                expect(hurryFactor(model, transport, wegart)).toBe(1);
            }
        }
    });
});

describe("was das Eiltempo vereitelt", () => {
    it("aufgeweichter Boden, Tiefschnee und Eis - der Schlitten nur beim ersten", () => {
        for (const zustand of ["aufgeweicht", "tiefschnee", "eis"]) {
            expect(hurryBlockedByGround(model, "groupFoot", zustand), zustand).toBe(true);
        }
        expect(hurryBlockedByGround(model, "sleigh", "tiefschnee")).toBe(false);
        expect(hurryBlockedByGround(model, "sleigh", "eis")).toBe(false);
        expect(hurryBlockedByGround(model, "sleigh", "aufgeweicht")).toBe(true);
    });

    it("leichter Schnee und Tauboden vereiteln es nicht", () => {
        expect(hurryBlockedByGround(model, "groupFoot", "schnee_leicht")).toBe(false);
        expect(hurryBlockedByGround(model, "groupFoot", "tauboden")).toBe(false);
    });

    it("🔴 Sumpf, Dschungel, Urwald und Regenwald - die Landschaftshälfte der Ausschlüsse", () => {
        expect([...hurryBlockingLandscapes(model)].sort()).toEqual(
            ["dschungel", "regenwald", "suempfe_moore", "urwald"].sort(),
        );
    });

    it("jeder gesperrte Bodenzustand ist einer aus der Bodentafel der Jahreszeit", () => {
        for (const zustand of model.eiltempo.wert.bodenSperre) {
            expect(model.jahreszeitBoden.wert.zustaende[zustand], zustand).toBeDefined();
        }
    });
});

describe("die Taktung (F3 = A): nur jeden zweiten Reisetag", () => {
    it("so steht es im Modell - zwei Reisetage, davon ein Eiltag", () => {
        expect(model.eiltempo.wert.taktung).toEqual({ reisetage: 2, eiltage: 1 });
    });

    it("🔴 der erste Reisetag eilt, der zweite nicht, der dritte wieder", () => {
        expect([0, 1, 2, 3, 4, 5].map((day) => isHurryDay(model, day))).toEqual([
            true,
            false,
            true,
            false,
            true,
            false,
        ]);
    });

    it("die Nummer wird abgeschnitten, nicht gerundet - ein halber Tag gehört seinem Tag", () => {
        expect(isHurryDay(model, 0.99)).toBe(true);
        expect(isHurryDay(model, 1.0)).toBe(false);
        expect(isHurryDay(model, 1.99)).toBe(false);
        expect(isHurryDay(model, 2.0)).toBe(true);
    });
});

describe("hurryPacedHours: der volle Faktor am Eiltag, nichts am gewöhnlichen", () => {
    const paced = (over: { hours: number; dayHours?: number; factor?: number; days?: number }) =>
        hurryPacedHours(model, { dayHours: 8, factor: 1.5, days: 0, ...over });

    it("🔴 eine Reise, die an EINEM Tag endet, bekommt die vollen 1,5", () => {
        const result = paced({ hours: 6 });
        expect(result.factor).toBeCloseTo(1.5, 12);
        expect(result.hours).toBeCloseTo(4, 12);
        // Vier wirkliche Stunden von acht: ein halber Reisetag.
        expect(result.days).toBeCloseTo(0.5, 12);
    });

    it("am zweiten Reisetag gilt der Faktor nicht, und das Feld bleibt genau 1", () => {
        const result = paced({ hours: 6, days: 1 });
        expect(result.factor).toBe(1);
        expect(result.hours).toBe(6);
        expect(result.days).toBeCloseTo(1.75, 12);
    });

    it("über die Tagesgrenze wird der Abschnitt geteilt, nicht gemittelt", () => {
        // Tag 1 eilt: acht wirkliche Stunden tragen zwölf normale. Die restlichen sechs gehen normal.
        const result = paced({ hours: 18 });
        expect(result.hours).toBeCloseTo(14, 12);
        expect(result.factor).toBeCloseTo(18 / 14, 12);
        expect(result.days).toBeCloseTo(14 / 8, 12);
    });

    it("🔴 über eine LANGE Reise bleibt der halbe Tag im Eiltempo - wirksam 1,25, nicht 1,2", () => {
        // Zehn Reisetage: fünf eilen (je 12 normale Stunden), fünf nicht (je 8) - 100 normale, 80 wirkliche.
        const result = paced({ hours: 100 });
        expect(result.hours).toBeCloseTo(80, 10);
        expect(result.factor).toBeCloseTo(1.25, 10);
    });

    it("der Reisetag kommt von außen: mit 24 Stunden am Tag eilt die ganze erste Tagesstrecke", () => {
        // Ein Tag von 24 Stunden trägt 36 normale: die ganzen 30 fallen in den ersten, also vollen Eiltag.
        const result = paced({ hours: 30, dayHours: 24 });
        expect(result.hours).toBeCloseTo(30 / 1.5, 12);
        expect(result.factor).toBeCloseTo(1.5, 12);
    });

    it("ohne Faktor zählt der Abschnitt nur Reisetage - auch ein Pass verschiebt die Taktung nicht", () => {
        const result = paced({ hours: 12, factor: 1 });
        expect(result.factor).toBe(1);
        expect(result.hours).toBe(12);
        expect(result.days).toBeCloseTo(1.5, 12);
    });

    it("entartete Eingaben bleiben unverändert", () => {
        expect(paced({ hours: 0 })).toEqual({ hours: 0, days: 0, factor: 1 });
        expect(paced({ hours: 5, dayHours: 0 })).toEqual({ hours: 5, days: 0, factor: 1 });
        expect(paced({ hours: 5, days: Number.NaN }).factor).toBe(1);
    });

    it("🔴 nie länger als normal, und die Zeit verschwindet nicht", () => {
        for (const hours of [0.01, 1, 7.9, 8, 8.1, 16, 100, 1000]) {
            for (const factor of [1, 1.25, 1.5]) {
                for (const days of [0, 0.5, 1, 1.5, 2.75]) {
                    const result = hurryPacedHours(model, { hours, dayHours: 8, factor, days });
                    expect(result.hours, `${hours}/${factor}/${days}`).toBeLessThanOrEqual(hours + 1e-9);
                    expect(result.hours).toBeGreaterThanOrEqual(hours / factor - 1e-9);
                    expect(result.days).toBeCloseTo(days + result.hours / 8, 9);
                    expect(result.factor).toBeCloseTo(hours / result.hours, 9);
                }
            }
        }
    });
});

describe("die normale Tempotafel bleibt unberührt", () => {
    it("kein Eintrag der Tafel `tempo` trägt eine Eilzahl", () => {
        expect(model.tempo.wert["groupFoot"]?.["Strasse"]).toBe(4.4625);
        expect(model.tempo.wert["wagon"]?.["Reichsstrasse"]).toBe(5.355);
    });
});
