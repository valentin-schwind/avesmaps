import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import {
    calibrate,
    footFactor,
    NO_HEIGHT,
    NO_SLOPE,
    PAIR_FLOATS,
    slopeTimeFactor,
    sumPairs,
    type SlopeSums,
} from "../src/routing/slope.ts";
import { heightAt, profileLine, type HeightSource } from "../src/terrain/path-profiles.ts";

/** Die Paare eines Profils; die Höhen zählen hier als Gebirgsfläche (die Lage prüft `slope-families`). */
const profilePairs = (
    coordinates: [number, number][],
    height: (x: number, y: number) => number | null,
    steep: number,
): Float32Array =>
    profileLine(
        coordinates,
        (x, y) => {
            const h = height(x, y);
            return h === null ? null : { height: h, mountain: true };
        },
        steep,
    ).pairs;

/**
 * Steigung im Routing (WI-0049 S5a, Gutachten MCS-026): Leistungskilometer, Eichung an der GA und die
 * Profile der Wege. 🔴 Ohne Wegprofile rechnet alles wie vor S5a.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const MEILEN = model.meilenJeKarteneinheit.wert;

const sums = (extra: Partial<SlopeSums>): SlopeSums => ({ ...NO_SLOPE, known: true, highest: 0, ...extra });

describe("Leistungskilometer (J+S)", () => {
    it("100 Schritt Anstieg kosten eine Meile mehr, 150 Schritt steiler Abstieg auch", () => {
        expect(footFactor(sums({ up: 100 }), 1, true, model)).toBeCloseTo(2, 12);
        expect(footFactor(sums({ steepDown: 150 }), 1, true, model)).toBeCloseTo(2, 12);
        expect(footFactor(sums({ up: 300, steepDown: 150 }), 2, true, model)).toBeCloseTo(3, 12);
    });

    it("sanfter Abstieg ist frei, bergab gibt es keinen Bonus", () => {
        expect(footFactor(sums({ down: 500 }), 1, true, model)).toBe(1);
    });

    it("rückwärts ist der Abstieg der Anstieg und der steile Anstieg der steile Abstieg", () => {
        const s = sums({ up: 100, down: 0, steepUp: 150 });
        expect(footFactor(s, 1, true, model)).toBeCloseTo(2, 12);
        expect(footFactor(s, 1, false, model)).toBeCloseTo(2, 12);
        expect(footFactor(sums({ up: 100 }), 1, false, model)).toBe(1);
    });

    it("kein Deckel mehr bei 4: ein 40-%-Hang kostet das Fünffache", () => {
        expect(footFactor(sums({ up: 400 }), 1, true, model)).toBeCloseTo(5, 12);
    });

    it("ohne Höhe weiß das Stück nichts: Faktor 1", () => {
        expect(footFactor(NO_SLOPE, 1, true, model)).toBe(1);
    });
});

describe("Paare eines Profils", () => {
    const paar = (werte: number[]): number[] => [...werte, ...new Array(PAIR_FLOATS - werte.length).fill(0)];

    it("zählt nur die Paare des Stücks und überspringt Paare ohne Höhe", () => {
        const profil = Float32Array.from([
            ...paar([10, 0, 0, 0, 500, 0.1, 0]),
            ...paar([0, 0, 0, 0, NO_HEIGHT]),
            ...paar([20, 5, 0, 0, 700, 0.3, 0.05]),
        ]);
        const alle = sumPairs(profil, 0, 3);
        expect(alle).toMatchObject({ up: 30, down: 5, known: true, highest: 700 });
        expect(alle.steepestUp).toBeCloseTo(0.3, 6);
        expect(sumPairs(profil, 1, 1).known).toBe(false);
        expect(sumPairs(profil, 2, 1).up).toBe(20);
    });
});

describe("Eichung an der GA", () => {
    const stueck = (subtype: string, distance: number, s: SlopeSums) => ({ subtype, distance, sums: s });

    it("🔴 ein Pass mit Höhe trifft im Mittel genau die GA, steile langsamer, flache schneller", () => {
        const paesse = [
            stueck("Gebirgspass", 2, sums({ up: 600, down: 600 })),
            stueck("Gebirgspass", 1, sums({ up: 0, down: 0 })),
            stueck("Gebirgspass", 3, sums({ up: 1200, steepDown: 300, down: 300 })),
        ];
        const eichung = calibrate([...paesse, stueck("Strasse", 5, NO_SLOPE)], model);
        let zeit = 0;
        let laenge = 0;
        for (const p of paesse) {
            for (const vor of [true, false]) {
                zeit += p.distance * slopeTimeFactor(p.subtype, p.distance, p.sums, vor, model, eichung);
                laenge += p.distance;
            }
        }
        // Der Pass im Mittel genau GA 0,4.
        expect(zeit / laenge).toBeCloseTo(1, 9);
        const flach = slopeTimeFactor("Gebirgspass", 1, sums({}), true, model, eichung);
        expect(flach).toBeLessThan(1);
    });

    it("ein Pass ohne Höhe bleibt genau bei der GA", () => {
        const eichung = calibrate([stueck("Gebirgspass", 2, sums({ up: 600 }))], model);
        expect(slopeTimeFactor("Gebirgspass", 2, NO_SLOPE, true, model, eichung)).toBe(1);
    });

    it("die übrigen Landwege werden an der Straße geeicht", () => {
        const eichung = calibrate(
            [stueck("Strasse", 3, sums({ up: 90, down: 90 })), stueck("Strasse", 7, NO_SLOPE)],
            model,
        );
        const mu = eichung.FOOT.street;
        expect(mu).toBeGreaterThan(1);
        expect(slopeTimeFactor("Strasse", 7, NO_SLOPE, true, model, eichung)).toBeCloseTo(1 / mu, 12);
        // Ein Drittel E ist eine Meile: 100 Schritt hinauf verdoppeln die Zeit.
        expect(slopeTimeFactor("Pfad", 1 / MEILEN, sums({ up: 100 }), true, model, eichung)).toBeCloseTo(2 / mu, 12);
    });

    it("🔴 ohne Wegprofile (Eichung null) und auf dem Wasser gilt Faktor 1", () => {
        expect(slopeTimeFactor("Strasse", 1, sums({ up: 500 }), true, model, null)).toBe(1);
        const eichung = calibrate([stueck("Strasse", 1, NO_SLOPE)], model);
        expect(slopeTimeFactor("Flussweg", 1, sums({ up: 500 }), true, model, eichung)).toBe(1);
        expect(slopeTimeFactor("Seeweg", 1, sums({ up: 500 }), true, model, eichung)).toBe(1);
    });
});

describe("Profile der Wege", () => {
    const quadrat = {
        type: "Polygon" as const,
        coordinates: [
            [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
            ],
        ],
    };
    // Ein Raster von 11 × 11 Zellen à 1 E, Höhe = 100 · x Schritt (steigt nach Osten).
    const samples = new Uint16Array(11 * 11);
    for (let j = 0; j < 11; j += 1) for (let i = 0; i < 11; i += 1) samples[j * 11 + i] = 100 * i;
    const source: HeightSource = {
        rasters: [
            {
                raster: { cell: 1, originX: 0, originY: 0, width: 11, height: 11, samples },
                geometry: quadrat,
                bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
                fingerprint: "test",
            },
        ],
        peaks: [],
        rule: { kind: "steigung", steigung: 0.3 },
    };

    it("liest innerhalb der Fläche bilinear und außerhalb nichts", () => {
        expect(heightAt(source, 2.5, 5)).toBeCloseTo(250, 9);
        expect(heightAt(source, 11, 5)).toBeNull();
    });

    it("zählt je Paar Anstieg und Abstieg; steil erst echt über der Schwelle", () => {
        // 100 Schritt je E = 100 / 3.000: flach genug; der Hang mit 1.000 Schritt je E ist steil.
        const flach = profilePairs(
            [
                [1, 5],
                [3, 5],
            ],
            (x, y) => heightAt(source, x, y),
            0.2,
        );
        expect(flach[0]).toBeCloseTo(200, 3);
        expect(flach[2]).toBe(0);
        expect(flach[4]).toBeCloseTo(300, 3);
        const steil = profilePairs(
            [
                [0, 0],
                [1, 0],
            ],
            (x) => 1000 * x,
            0.2,
        );
        expect(steil[0]).toBeCloseTo(1000, 3);
        expect(steil[2]).toBeCloseTo(1000, 3);
        expect(steil[5]).toBeCloseTo(1000 / 3000, 6);
        // Genau 20 % ist nicht steil (Legacy: echt größer).
        const grenze = profilePairs(
            [
                [0, 0],
                [0.25, 0],
            ],
            (x) => 0.2 * 3000 * x,
            0.2,
        );
        expect(grenze[2]).toBe(0);
    });

    it("🔴 ein Schritt mit einem Ende ohne Höhe zählt nicht: kein Sprung am Rand der Fläche", () => {
        // Abgetastet bei 8,6 … 9,85 innen, ab 10,1 außen: Der Schritt über den Rand zählt nicht.
        const pairs = profilePairs(
            [
                [8.6, 5],
                [11.6, 5],
            ],
            (x, y) => heightAt(source, x, y),
            0.2,
        );
        expect(pairs[0]).toBeCloseTo(125, 3);
        expect(pairs[1]).toBe(0);
        const draussen = profilePairs(
            [
                [20, 5],
                [22, 5],
            ],
            (x, y) => heightAt(source, x, y),
            0.2,
        );
        expect(draussen[4]).toBe(NO_HEIGHT);
    });
});

describe("Im Router", () => {
    const ort = (id: string, x: number, y: number): RouteNode => ({
        id,
        name: id,
        kind: "place",
        isHidden: false,
        x,
        y,
    });
    const weg = (id: string, subtype: string, coordinates: [number, number][]) => ({
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    });
    const knoten = [ort("A", 100, 100), ort("B", 110, 100), ort("C", 120, 100)];
    const wege = [
        weg("pass", "Gebirgspass", [
            [100, 100],
            [105, 100],
            [110, 100],
        ]),
        weg("strasse", "Strasse", [
            [110, 100],
            [120, 100],
        ]),
    ];
    const zuFuss: RouteRequest = {
        optimize: "fastest",
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: false, sea: false },
        minimizeTransfers: false,
    };
    const profil = (paare: number[][]): Float32Array => Float32Array.from(paare.flat());

    it("🔴 ohne Wegprofile rechnet der Router genau wie vor S5a", () => {
        const ohne = buildRouteNetwork(knoten, wege);
        const leer = buildRouteNetwork(knoten, wege, { profiles: new Map() });
        const a = findRoute(ohne, buildRouteGraph(ohne, model, zuFuss), ["A", "C"]);
        const b = findRoute(leer, buildRouteGraph(leer, model, zuFuss), ["A", "C"]);
        expect(b.travelHours).toBe(a.travelHours);
        expect(b.segments.map((s) => s.cost_units)).toEqual(a.segments.map((s) => s.cost_units));
    });

    it("mit Profil: bergauf länger als bergab, und die Hälften eines geteilten Passes behalten die Eichung", () => {
        const profiles = new Map([
            // Pass: erste Hälfte 1.500 Schritt hinauf, zweite flach. Straße ohne Höhe.
            [
                "pass",
                profil([
                    [1500, 0, 0, 0, 1500, 0.2, 0],
                    [0, 0, 0, 0, 1500, 0, 0],
                ]),
            ],
            ["strasse", profil([[0, 0, 0, 0, NO_HEIGHT, 0, 0]])],
        ]);
        const network = buildRouteNetwork(knoten, wege, { profiles });
        const graph = buildRouteGraph(network, model, zuFuss);
        const hin = findRoute(network, graph, ["A", "B"]);
        const zurueck = findRoute(network, graph, ["B", "A"]);
        expect(hin.travelHours).toBeGreaterThan(zurueck.travelHours);
        // Nur ein Pass: Er ist die Eichung selbst, also im Mittel beider Richtungen genau die GA.
        const ohne = buildRouteNetwork(knoten, wege);
        const ga = findRoute(ohne, buildRouteGraph(ohne, model, zuFuss), ["A", "B"]).travelHours;
        expect((hin.travelHours + zurueck.travelHours) / 2).toBeCloseTo(ga, 9);
    });
});
