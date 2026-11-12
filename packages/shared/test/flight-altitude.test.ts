import { describe, expect, it } from "vitest";
import { flightAltitude, flightSurcharge, type FlightAltitudeInput } from "../src/index.ts";

/**
 * Die Höhe der Flugbahn (WI-0051 F3, WI-0065 Nachtrag 2026-10-03): die eine Rechnung für die Bahn auf der Karte und
 * die rote Linie im Höhenprofil. Regel des Betreibers: erst auf die Reisehöhe, vor Hindernissen höher, höchstens 10 ×
 * Reisehöhe über dem Boden darunter (`reach`) und höchstens 5.000 Schritt über dem Meer (`ceiling`; Betreiber
 * 2026-10-04), Steigen und Sinken mit 1 : 4, nie unter dem Boden.
 */

const base = (ground: number[], over: Partial<FlightAltitudeInput> = {}): FlightAltitudeInput => ({
    ground,
    length: 8000,
    cruise: 800,
    ceiling: 8000,
    reach: 8000,
    clearance: 200,
    hold: 1000,
    slope: 0.25,
    ...over,
});

describe("flightAltitude", () => {
    it("🔴 steigt am Start vom Boden mit 1 : 4 auf die Reisehöhe und sinkt am Ziel mit 1 : 4 auf den Boden", () => {
        const out = flightAltitude(base(Array.from({ length: 9 }, () => 0)));
        // Acht Stücke zu je 1.000 Schritt: 250 Schritt Höhe je Probe, bis die Reisehöhe von 800 erreicht ist.
        expect([...out]).toEqual([0, 250, 500, 750, 800, 750, 500, 250, 0]);
    });

    it("hält über einem Grat die Höhe: Boden plus Mindestabstand, höchstens die Höchstflughöhe", () => {
        // Die Strecke ist lang genug, dass die Bahn mit 1 : 4 bis über den Grat hinaufkommt (64.000 Schritt).
        const ground = Array.from({ length: 17 }, (_, k) => (k === 8 ? 3000 : 100));
        const far = { length: 64000, hold: 8000 };
        const out = flightAltitude(base(ground, far));
        expect(out[8]).toBe(3200);
        expect(Math.max(...out)).toBe(3200);
        // Über der Höchstflughöhe weicht die Rechnung nicht aus (das tut der Weg, F2): Sie liegt auf dem Boden.
        expect(flightAltitude(base(ground, { ...far, ceiling: 2000 }))[8]).toBe(3000);
        // Zu kurz, um hinaufzukommen: Die Bahn steigt nur so schnell, wie 1 : 4 erlaubt, und liegt auf dem Grat.
        expect(flightAltitude(base(ground, { length: 16000 }))[8]).toBe(3000);
    });

    it("liegt nie unter dem Boden, auch wo die Höchstflughöhe niedriger ist als das Gelände", () => {
        const ground = [0, 500, 4000, 500, 0];
        const out = flightAltitude(base(ground, { ceiling: 1000, length: 4000 }));
        for (const [k, height] of out.entries()) expect(height).toBeGreaterThanOrEqual(ground[k]!);
        expect(out[2]).toBe(4000);
    });

    describe("die Höchstgrenzen (Betreiber 2026-10-04)", () => {
        // Der Hexenbesen: Reisehöhe 100, höchstens 1.000 über dem Boden, nie höher als 5.000 über dem Meer.
        const hexe = { cruise: 100, reach: 1000, ceiling: 5000, length: 64000, hold: 8000 };

        it("🔴 steigt über einen Grat von 3.000 bis Boden + Mindestabstand (nicht nur bis 1.000 über dem Meer)", () => {
            const ground = Array.from({ length: 17 }, (_, k) => (k === 8 ? 3000 : 100));
            const out = flightAltitude(base(ground, hexe));
            expect(out[8]).toBe(3200);
            for (const [k, height] of out.entries()) expect(height).toBeGreaterThanOrEqual(ground[k]!);
        });

        it("🔴 nie höher als Boden + 10 × Reisehöhe, auch wo die Hülle mehr verlangte (Steilwand)", () => {
            // Der Boden springt von 0 auf 3.000: Mit 1 : 4 käme die Bahn vor der Wand nicht hinauf (Probe alle 4.000).
            const ground = Array.from({ length: 17 }, (_, k) => (k >= 8 && k <= 10 ? 3000 : 0));
            const out = flightAltitude(base(ground, { ...hexe, length: 64000, hold: 4000 }));
            for (const [k, height] of out.entries()) {
                expect(height, `Probe ${String(k)}`).toBeLessThanOrEqual(ground[k]! + hexe.reach + 1e-9);
                expect(height, `Probe ${String(k)}`).toBeGreaterThanOrEqual(ground[k]!);
            }
            // Vor der Wand hält die Obergrenze sie bei 1.000 (die Hülle verlangte 2.200); auf dem Plateau steht sie
            // 200 über dem Boden.
            expect(out[7]).toBe(1000);
            expect(out[9]).toBe(3200);
        });

        it("🔴 nie höher als 5.000 über dem Meer, auch mit Reisehöhe und Höhe über Grund darüber", () => {
            const flat = Array.from({ length: 17 }, () => 0);
            // Reisehöhe über der Höchstflughöhe: Die Bahn steigt auf 5.000 und nicht weiter.
            for (const [cruise, reach] of [
                [5000, 50000],
                [9999, 99990],
            ] as const) {
                const out = flightAltitude(base(flat, { cruise, reach, ceiling: 5000, length: 128000 }));
                expect(Math.max(...out), `Reisehöhe ${String(cruise)}`).toBe(5000);
            }
            // Boden + Mindestabstand über der Höchstflughöhe (Plateau auf 4.900): ebenso 5.000, nicht 5.100.
            const plateau = Array.from({ length: 17 }, () => 4900);
            const oben = flightAltitude(base(plateau, { cruise: 800, reach: 8000, ceiling: 5000, length: 128000 }));
            expect(Math.max(...oben)).toBe(5000);
        });

        it("auf einem Boden über der Höchstflughöhe liegt die Bahn auf ihm; davor und danach gilt die Obergrenze", () => {
            const ground = [0, 0, 6000, 6000, 0, 0];
            const out = flightAltitude(base(ground, { ...hexe, length: 5000, hold: 1000 }));
            expect(out[2]).toBe(6000);
            expect(out[3]).toBe(6000);
            for (const k of [0, 1, 4, 5]) expect(out[k]!).toBeLessThanOrEqual(5000);
        });

        it("ein Flugmittel, dessen Höhe über Grund unter dem Mindestabstand bleibt, fliegt knapp über dem Boden", () => {
            // Reisehöhe 1 Schritt, also 10 über Grund: Der Abstand von 200 ist nicht zu halten, der Boden ist es.
            const ground = [0, 0, 500, 500, 0, 0];
            const out = flightAltitude(base(ground, { cruise: 1, reach: 10, ceiling: 5000, length: 5000, hold: 1000 }));
            for (const [k, height] of out.entries()) {
                expect(height).toBeGreaterThanOrEqual(ground[k]!);
                expect(height).toBeLessThanOrEqual(ground[k]! + 10 + 1e-9);
            }
        });
    });

    it("eine Probe oder keine: der Boden, ohne Hülle", () => {
        expect([...flightAltitude(base([120]))]).toEqual([120]);
        expect([...flightAltitude(base([]))]).toEqual([]);
    });

    it("rechnet in der Einheit der Eingabe: dieselbe Bahn in Metern und in Kilometern ist dieselbe Gestalt", () => {
        const ground = [0, 100, 50, 0, 0];
        const metres = flightAltitude(base(ground, { length: 4000, cruise: 400, clearance: 100, hold: 1000 }));
        const km = flightAltitude(
            base(
                ground.map((value) => value / 1000),
                { length: 4, cruise: 0.4, clearance: 0.1, hold: 1, ceiling: 8, reach: 8 },
            ),
        );
        for (const [k, value] of metres.entries()) expect(value / 1000).toBeCloseTo(km[k]!, 9);
    });
});

/**
 * Was die Bahn über der Reisehöhe kostet (WI-0051 F4, Betreiber 2026-10-04): „der aufstieg zur durchschnittlichen
 * flughöhe kostet nichts“; darüber kostet Steigen (Überstand wächst) und Halten (Überstand bleibt) Zeit.
 */
describe("flightSurcharge", () => {
    const rule = { standard: 800, scale: 8000, climbFactor: 50, holdFactor: 1 };
    const surcharge = (ground: number[], altitude: number[], length = 8000, over: Partial<typeof rule> = {}) =>
        flightSurcharge({ ground, altitude, length, ...rule, ...over });

    it("🔴 auf der Reisehöhe über Grund ist der Zuschlag 0: auch an steilem Gelände, wo die absolute Höhe mit steigt", () => {
        // Eine Wand von 0 auf 3.000 in drei Proben (steiler als 1 : 4): Die Bahn folgt dem Boden mit genau 800 Abstand.
        const ground = [0, 0, 1000, 3000, 3000, 0];
        const altitude = ground.map((height) => height + 800);
        expect(surcharge(ground, altitude)).toEqual({ climb: 0, hold: 0, peak: 0 });
        // Auch unterhalb der Reisehöhe (nur der Mindestabstand) kostet nichts.
        expect(
            surcharge(
                ground,
                ground.map((height) => height + 200),
            ),
        ).toEqual({ climb: 0, hold: 0, peak: 0 });
    });

    it("🔴 der Aufstieg vom Start auf die Reisehöhe ist frei, ebenso das Sinken zum Ziel", () => {
        const out = flightAltitude({
            ground: Array.from({ length: 9 }, () => 0),
            length: 8000,
            cruise: 800,
            ceiling: 8000,
            reach: 8000,
            clearance: 200,
            hold: 1000,
            slope: 0.25,
        });
        expect([...out]).toEqual([0, 250, 500, 750, 800, 750, 500, 250, 0]);
        expect(
            surcharge(
                Array.from({ length: 9 }, () => 0),
                [...out],
            ),
        ).toEqual({ climb: 0, hold: 0, peak: 0 });
    });

    it("steigen über die Reisehöhe: Faktor mal der Zuwachs des Überstands; sinken und die Strecke darüber kosten nur das Halten", () => {
        // Überstand 0, 200, 600, 600, 200, 0 (Boden 0): Der Überstand wächst um 600, die Bahn steigt dabei selbst.
        const ground = [0, 0, 0, 0, 0, 0];
        const altitude = [0, 1000, 1400, 1400, 1000, 0];
        const out = surcharge(ground, altitude, 5000);
        // Von 0 auf 200 (um 200), dann auf 600 (um 400): 600 Schritt Zuwachs, 50 Schritt Strecke je Schritt.
        expect(out.climb).toBeCloseTo(600 * 50, 9);
        // Halten: Probenabstand 1.000, mittlerer Überstand je Stück 100, 400, 600, 400, 100 durch 8.000, Faktor 1.
        expect(out.hold).toBeCloseTo((1000 * (100 + 400 + 600 + 400 + 100)) / 8000, 9);
        expect(out.peak).toBe(600);
        // Der Faktor wirkt linear, und ohne Faktor kostet nichts.
        expect(surcharge(ground, altitude, 5000, { climbFactor: 0, holdFactor: 0 })).toMatchObject({
            climb: 0,
            hold: 0,
        });
        expect(surcharge(ground, altitude, 5000, { climbFactor: 100, holdFactor: 2 }).climb).toBeCloseTo(
            2 * out.climb,
            9,
        );
        expect(surcharge(ground, altitude, 5000, { climbFactor: 100, holdFactor: 2 }).hold).toBeCloseTo(
            2 * out.hold,
            9,
        );
    });

    it("fällt der Boden unter einer gehaltenen Bahn ab, wächst der Überstand, aber das Flugmittel steigt nicht: Das kostet nur das Halten", () => {
        // Die Bahn hält 1.800, der Boden fällt von 1.000 auf 0: Überstand 0, 0, 200, 600, 1000.
        const out = surcharge([1000, 1000, 800, 400, 0], [1800, 1800, 1800, 1800, 1800], 4000);
        expect(out.climb).toBe(0);
        expect(out.hold).toBeGreaterThan(0);
        expect(out.peak).toBe(1000);
    });

    it("steigt die Bahn mit dem Gelände (der Überstand wächst langsamer als die Bahn), zählt nur der Überstand", () => {
        // Boden 0, 400, 800; die Bahn steigt um 800 je Stück, der Überstand dabei um 400.
        const out = surcharge([0, 400, 800], [800, 1600, 2400], 2000);
        expect(out.climb).toBeCloseTo((400 + 400) * 50, 9);
        expect(out.peak).toBe(800);
    });

    it("nie negativ, auch bei unsinnigen Eingaben (Bahn unter dem Boden), und ohne Proben null", () => {
        const out = surcharge([500, 500, 500], [0, 0, 0]);
        expect(out).toEqual({ climb: 0, hold: 0, peak: 0 });
        expect(surcharge([100], [100])).toEqual({ climb: 0, hold: 0, peak: 0 });
        expect(surcharge([], [])).toEqual({ climb: 0, hold: 0, peak: 0 });
        expect(surcharge([0, 0], [900, 900, 900])).toEqual({ climb: 0, hold: 0, peak: 0 });
    });

    it("zusammen mit der Bahn: flach kostet nichts; vor einer steilen Wand kostet das Steigen über die Reisehöhe, und das Folgen des Geländes nicht", () => {
        const flat = Array.from({ length: 41 }, () => 100);
        const input = { cruise: 800, ceiling: 8000, reach: 8000, clearance: 200, hold: 1000, slope: 0.25 };
        const flach = flightAltitude({ ground: flat, length: 40_000, ...input });
        expect(surcharge(flat, [...flach], 40_000)).toEqual({ climb: 0, hold: 0, peak: 0 });
        // Ein Grat von 3.000 Schritt mitten in der Ebene: Die Bahn muss auf 3.200 steigen, schon vor dem Grat über der Reisehöhe.
        const grat = flat.map((height, k) => (k === 20 ? 3000 : height));
        const bahn = flightAltitude({ ground: grat, length: 40_000, ...input });
        const mitGrat = surcharge(grat, [...bahn], 40_000);
        expect(mitGrat.climb).toBeGreaterThan(0);
        expect(mitGrat.hold).toBeGreaterThan(0);
        // Je höher der Grat, desto mehr kostet er.
        const hoeher = grat.map((height, k) => (k === 20 ? 4000 : height));
        const bahnHoeher = flightAltitude({ ground: hoeher, length: 40_000, ...input });
        const mitHoeher = surcharge(hoeher, [...bahnHoeher], 40_000);
        expect(mitHoeher.climb).toBeGreaterThan(mitGrat.climb);
        expect(mitHoeher.hold).toBeGreaterThan(mitGrat.hold);
        expect(mitHoeher.peak).toBeGreaterThan(mitGrat.peak);
    });
});
