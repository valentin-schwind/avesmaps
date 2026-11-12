import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, allowedTransportsForPath, travelSpeed } from "@avesmaps3d/shared";
import { offroadCost, offroadPathBetween } from "../src/routing/map-points.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { buildOffroadBox } from "../src/routing/offroad-grid.ts";
import {
    calibrateRelief,
    KIND_MOUNTAIN,
    KIND_PEAK,
    reliefPlane,
    reliefRules,
    type TerrainHeights,
} from "../src/routing/relief.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import {
    calibrate,
    familyFactor,
    familyStepFactor,
    footFactor,
    NO_SLOPE,
    pairSteps,
    sampleOffsets,
    SLOPE_FAMILIES,
    slopeFamily,
    slopeTimeFactor,
    starWalk,
    STEP_FLOATS,
    sumPairs,
    switchbackGrade,
    type SlopeFamily,
    type SlopeSums,
} from "../src/routing/slope.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { profileLine } from "../src/terrain/path-profiles.ts";

/**
 * Die drei Steigungsfamilien und die Sternregel (WI-0049 S5c, Gutachten MCS-026 Punkte 2, 3, 6).
 * 🔴 Ohne Gelände rechnet jedes Reisemittel wie vorher.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const MEILEN = model.meilenJeKarteneinheit.wert;
const LAND = model.transportmittel.wert.land;

/**
 * Ein Stück mit gleichmäßiger Steigung `grade` über `units` E, durch die echte Abtastung gerechnet;
 * `mountain`: ganz in einer Gebirgsfläche.
 */
function hang(grade: number, units: number, mountain = true): SlopeSums {
    const { pairs, samples } = profileLine(
        [
            [0, 0],
            [units, 0],
        ],
        (x) => ({ height: 1000 + grade * 3000 * x, mountain }),
        model.steigung.wert.steilAb,
    );
    const offsets = sampleOffsets(samples, 1);
    if (!offsets) throw new Error("Abtastwerte erwartet");
    return { ...sumPairs(pairs, 0, 1), steps: pairSteps(samples, offsets, 0, 1, [units * 3000]) };
}

describe("Die drei Familien je Abtastschritt", () => {
    it("EQUID: +10 % 1,42, +20 % 2,01, −20 % 1,42, bergab bis −10 % frei", () => {
        expect(familyStepFactor("EQUID", 0.1, model)).toBeCloseTo(Math.exp(0.35), 12);
        expect(familyStepFactor("EQUID", 0.2, model)).toBeCloseTo(2.01, 2);
        expect(familyStepFactor("EQUID", -0.2, model)).toBeCloseTo(1.42, 2);
        for (const s of [0, -0.05, -0.1]) expect(familyStepFactor("EQUID", s, model)).toBe(1);
    });

    it("WHEEL: 1,5 bei 5 %, bergab erst jenseits des Rollwiderstands 1/30", () => {
        expect(familyStepFactor("WHEEL", 0.05, model)).toBeCloseTo(1.5, 12);
        expect(familyStepFactor("WHEEL", -1 / 30, model)).toBe(1);
        expect(familyStepFactor("WHEEL", -0.07, model)).toBeCloseTo(1 + 200 * (0.07 - 1 / 30) ** 2, 12);
        // Über dem Knick 7,1 % geht der Wagen in Kehren: bei 10 % 2,83 statt der Formel 3.
        expect(familyStepFactor("WHEEL", 0.1, model)).toBeCloseTo(0.1 * 2 * Math.sqrt(200), 12);
    });

    it("FOOT: der Leistungskilometer je Schritt; sanft bergab frei", () => {
        expect(familyStepFactor("FOOT", 0.1, model)).toBeCloseTo(2, 12);
        expect(familyStepFactor("FOOT", -0.1, model)).toBe(1);
        expect(familyStepFactor("FOOT", -0.3, model)).toBeCloseTo(3, 12);
    });

    it("keine Familie wird am Hang schneller als eben, und keine hat einen Deckel", () => {
        for (const family of SLOPE_FAMILIES) {
            for (let s = -3; s <= 3; s += 0.01) expect(familyStepFactor(family, s, model)).toBeGreaterThanOrEqual(1);
            expect(familyStepFactor(family, 1, model)).toBeGreaterThan(4);
        }
    });
});

describe("Kehrenregel (E1)", () => {
    it("der Knick folgt aus der Formel: Tier 28,6 % auf und ab, Wagen 7,1 % auf und 7,8 % ab", () => {
        expect(switchbackGrade("EQUID", true, model)).toBeCloseTo(1 / 3.5, 12);
        expect(switchbackGrade("EQUID", false, model)).toBeCloseTo(1 / 3.5, 12);
        expect(switchbackGrade("WHEEL", true, model)).toBeCloseTo(1 / Math.sqrt(200), 12);
        expect(switchbackGrade("WHEEL", false, model)).toBeCloseTo(Math.sqrt(1 / 200 + 1 / 900), 12);
        expect(switchbackGrade("FOOT", true, model)).toBeNull();
    });

    it("🔴 am Knick ist Zeit je Höhenmeter am kleinsten; darüber wächst der Faktor linear", () => {
        for (const family of ["EQUID", "WHEEL"] as const) {
            for (const uphill of [true, false]) {
                const knick = switchbackGrade(family, uphill, model) as number;
                const sign = uphill ? 1 : -1;
                const best = familyStepFactor(family, sign * knick, model) / knick;
                for (let g = 0.005; g <= 3; g += 0.005) {
                    expect(familyStepFactor(family, sign * g, model) / g).toBeGreaterThanOrEqual(best - 1e-9);
                }
                // Stetig am Knick, doppelt so steil ist doppelt so teuer.
                expect(familyStepFactor(family, sign * knick * 1.000001, model)).toBeCloseTo(best * knick, 5);
                expect(familyStepFactor(family, sign * 4 * knick, model)).toBeCloseTo(4 * best * knick, 9);
            }
        }
    });

    it("ohne Kehren im Reisemodell gilt die Formel ungebremst", () => {
        const ohne = structuredClone(model);
        ohne.steigung.wert.familien.WHEEL.kehren = false;
        expect(switchbackGrade("WHEEL", true, ohne)).toBeNull();
        expect(familyStepFactor("WHEEL", 0.1, ohne)).toBeCloseTo(3, 12);
    });
});

describe("Die Zuordnung steht im Reisemodell", () => {
    it("Fuß, Reit- und Lasttier, Wagen", () => {
        const families = Object.fromEntries(LAND.map((transport) => [transport, slopeFamily(model, transport)]));
        expect(families).toEqual({
            groupFoot: "FOOT",
            lightWalker: "FOOT",
            groupHorse: "EQUID",
            lightRider: "EQUID",
            caravan: "EQUID",
            horseCarriage: "WHEEL",
            // WI-0069: Karren und Fuhrwerk (Betreiber), der Schlitten als gezogenes Fahrzeug (Setzung).
            cart: "WHEEL",
            wagon: "WHEEL",
            sleigh: "WHEEL",
        });
        expect(slopeFamily(model, "unbekannt")).toBe("FOOT");
    });

    it("jedes Landmittel steht in genau einer Familie, und nur Landmittel", () => {
        const listed = SLOPE_FAMILIES.flatMap((family) => model.steigung.wert.familien[family].reisemittel);
        expect([...listed].sort()).toEqual([...LAND].sort());
    });

    it("🔴 jedes Tier-Mittel, das querfeldein darf, geht im Sterngelände wie die Gruppe zu Fuß (E2, E4)", () => {
        // 🪤 Ohne Kehren war μ von EQUID über die Gebirgsraster unbrauchbar (Klippen über 500 % trugen fast
        // alles); ohne Sternregel ginge ein Tier-Mittel dort fast im Flachtempo.
        const sterne = model.steigung.wert.sternregel;
        expect(sterne.imGebirge).toEqual(["Pfad", "Querfeldein"]);
        for (const transport of allowedTransportsForPath(model, "Querfeldein", null, null)) {
            if (slopeFamily(model, transport) === "FOOT") continue;
            // Wagen betreten das Gebirge nicht (WI-0258, `querfeldeinFahrzeuge`): Sie steigen nie ab, es gibt keine Sternregel.
            if (model.querfeldeinFahrzeuge.wert.reisemittel.includes(transport)) {
                expect(starWalk(model, transport, "Querfeldein"), transport).toBeNull();
                continue;
            }
            expect(sterne.absteigen[transport], transport).toBe("groupFoot");
            expect(starWalk(model, transport, "Querfeldein")?.family).toBe("FOOT");
            expect(starWalk(model, transport, "Pfad")?.family).toBe("FOOT");
            // Weg und Passstrecke bleiben geritten.
            expect(starWalk(model, transport, "Weg")).toBeNull();
            expect(starWalk(model, transport, "Gebirgspass")).toBeNull();
        }
        expect(starWalk(model, "groupFoot", "Pfad")).toBeNull();
        expect(starWalk(model, "horseCarriage", "Pfad")).toBeNull();
    });
});

describe("Abtastwerte eines Profils", () => {
    it("tragen dieselben Schritte wie die Summen: FOOT aus beiden gleich", () => {
        const s = hang(0.15, 1);
        expect(s.steps).not.toBeNull();
        const steps = s.steps as Float64Array;
        const rise = [...steps].filter((_, index) => index % STEP_FLOATS === 0);
        expect(rise.reduce((sum, value) => sum + value, 0)).toBeCloseTo(s.up, 2);
        // FOOT je Schritt über die Länge gemittelt ist der Leistungskilometer aus den Summen.
        const extra = rise.reduce((sum, value, index) => {
            const run = steps[STEP_FLOATS * index + 1] as number;
            return sum + run * (familyStepFactor("FOOT", value / run, model) - 1);
        }, 0);
        expect(1 + extra / (MEILEN * 1000)).toBeCloseTo(footFactor(s, MEILEN, true, model), 4);
    });

    it("ein Paar ohne Höhe trägt nur [0, 0]; eine Reihe, die nicht passt, gilt nicht", () => {
        const { samples } = profileLine(
            [
                [0, 0],
                [1, 0],
            ],
            () => null,
            0.2,
        );
        expect([...samples]).toEqual([0, 0]);
        expect(sampleOffsets(Float32Array.from([3, 750, 1, 0, 2, 0]), 1)).toBeNull();
        expect(sampleOffsets(Float32Array.from([2, 750, 1, 0, 2, 0]), 1)).toEqual(Int32Array.from([0]));
    });

    it("🔴 ein Schritt ist Gebirge, wenn beide Enden in einer Gebirgsfläche liegen (je Abtastschritt)", () => {
        // 1 E abgetastet in vier Schritten; die Gebirgsfläche beginnt bei x = 0,4.
        const { samples } = profileLine(
            [
                [0, 0],
                [1, 0],
            ],
            (x) => ({ height: 100 * x, mountain: x >= 0.4 }),
            0.2,
        );
        const offsets = sampleOffsets(samples, 1) as Int32Array;
        const steps = pairSteps(samples, offsets, 0, 1, [3000]);
        const lage = [...steps].filter((_, index) => index % STEP_FLOATS === 2);
        expect(lage).toEqual([0, 0, 1, 1]);
    });

    it("ohne Abtastwerte (Profil vor S5c) gehen Reittier und Wagen wie zu Fuß", () => {
        const s = { ...hang(0.2, 1), steps: null };
        for (const family of SLOPE_FAMILIES) {
            expect(familyFactor(family, s, MEILEN, true, model)).toBe(footFactor(s, MEILEN, true, model));
        }
    });

    it("EQUID und WHEEL rechnen je Richtung", () => {
        const s = hang(0.1, 1);
        expect(familyFactor("EQUID", s, MEILEN, true, model)).toBeCloseTo(Math.exp(0.35), 4);
        expect(familyFactor("EQUID", s, MEILEN, false, model)).toBe(1);
        expect(familyFactor("WHEEL", s, MEILEN, true, model)).toBeCloseTo(familyStepFactor("WHEEL", 0.1, model), 4);
        expect(familyFactor("WHEEL", s, MEILEN, false, model)).toBeCloseTo(familyStepFactor("WHEEL", -0.1, model), 4);
    });
});

describe("Normierung je Familie", () => {
    const stueck = (subtype: string, distance: number, sums: SlopeSums) => ({ subtype, distance, sums });
    const paesse = [
        stueck("Gebirgspass", 2, hang(0.12, 2)),
        stueck("Gebirgspass", 1, hang(0, 1)),
        stueck("Gebirgspass", 3, hang(0.3, 3)),
    ];
    const strassen = [stueck("Strasse", 4, hang(0.04, 4)), stueck("Strasse", 6, NO_SLOPE)];
    const eichung = calibrate([...paesse, ...strassen], model);

    it("🔴 der Pass trifft in jeder Familie im Mittel genau die GA, steile langsamer als flache", () => {
        for (const family of SLOPE_FAMILIES) {
            let zeit = 0;
            let laenge = 0;
            for (const p of paesse) {
                for (const vor of [true, false]) {
                    zeit += p.distance * slopeTimeFactor(p.subtype, p.distance, p.sums, vor, model, eichung, family);
                    laenge += p.distance;
                }
            }
            expect(zeit / laenge, family).toBeCloseTo(1, 9);
            const flach = slopeTimeFactor("Gebirgspass", 1, hang(0, 1), true, model, eichung, family);
            const steil = slopeTimeFactor("Gebirgspass", 3, hang(0.3, 3), true, model, eichung, family);
            expect(flach, family).toBeLessThan(1);
            expect(steil, family).toBeGreaterThan(1);
        }
    });

    it("jede Familie hat ihr eigenes μ; der Wagen leidet am Hang am meisten", () => {
        const mu = (family: SlopeFamily) => eichung[family].gaSlope["Gebirgspass"] as number;
        expect(mu("WHEEL")).toBeGreaterThan(mu("FOOT"));
        expect(eichung.WHEEL.street).toBeGreaterThan(eichung.EQUID.street);
        // Eine ebene Straße rechnet in jeder Familie mit dem eigenen μ.
        for (const family of SLOPE_FAMILIES) {
            expect(slopeTimeFactor("Strasse", 6, NO_SLOPE, true, model, eichung, family)).toBeCloseTo(
                1 / eichung[family].street,
                12,
            );
        }
    });

    it("🔴 ohne Wegprofile (Eichung null) gilt für jede Familie Faktor 1", () => {
        for (const family of SLOPE_FAMILIES) {
            expect(slopeTimeFactor("Pfad", 1, hang(0.3, 1), true, model, null, family)).toBe(1);
        }
    });
});

describe("Sternregel querfeldein", () => {
    /** Ein Gebirge von 20 × 20 E mit einem Kamm bei x = 10 und ein freier Gipfel bei (40, 10). */
    function gebirge(): TerrainHeights {
        const cell = 0.25;
        const width = 81;
        const samples = new Uint16Array(width * width);
        for (let j = 0; j < width; j += 1) {
            for (let i = 0; i < width; i += 1) {
                samples[j * width + i] = Math.max(1, Math.round(3000 * Math.max(0, 1 - Math.abs(i * cell - 10) / 3)));
            }
        }
        const raster = { cell, originX: 0, originY: 0, width, height: width, samples, maxX: 20, maxY: 20 };
        const rule = { kind: "steigung" as const, steigung: 0.3 };
        const cones = [{ x: 40, y: 10, h: 1000, radius: 1000 / (0.3 * 3000) }];
        return { rasters: [raster], cones, rule, mu: calibrateRelief([raster], cones, rule, model) };
    }
    const t = gebirge();
    const tempo = (transport: string) => travelSpeed(model, transport, "Querfeldein") as number;

    // Geführt querfeldein im Gebirge (WdE S. 161, WI-0258 E5): Tier 3 gegen Fuß 6, also das Doppelte der Zeit zu Fuß.
    const GEFUEHRT = 6 / 3;

    it("im Gebirge geht der Reiter wie die Gruppe zu Fuß, geführt und halb so schnell; am freien Gipfel reitet er (EQUID)", () => {
        const reiter = reliefRules(t, model, "lightRider");
        expect(reiter.mountain.family).toBe("FOOT");
        expect(reiter.mountain.scale).toBeCloseTo(
            ((tempo("lightRider") / tempo("groupFoot")) * GEFUEHRT * 3.5) / t.mu.FOOT.mountain,
            12,
        );
        expect(reiter.peak).toEqual({ family: "EQUID", scale: 2 / t.mu.EQUID.peak });
        const gruppe = reliefRules(t, model, "groupHorse");
        expect(gruppe.mountain.scale).toBeCloseTo(
            ((tempo("groupHorse") / tempo("groupFoot")) * GEFUEHRT * 3.5) / t.mu.FOOT.mountain,
            12,
        );
        // Die Karawane führt ihre Lasttiere; ihr Tempo ist das der Fußgruppe, im Gebirge halbiert (geführt, E5, S-5).
        expect(reliefRules(t, model, "caravan").mountain).toEqual({
            family: "FOOT",
            scale: (GEFUEHRT * 3.5) / t.mu.FOOT.mountain,
        });
        expect(reliefRules(t, model, "groupFoot").mountain).toEqual({
            family: "FOOT",
            scale: 3.5 / t.mu.FOOT.mountain,
        });
    });

    it("die Ebene rechnet im Gebirge mit der Sternregel und am Gipfel mit der Familie", () => {
        const plane = reliefPlane(buildOffroadBox(0, 0, 44, 20, 0.25), t, model, "lightRider");
        if (!plane) throw new Error("Ebene erwartet");
        const ratio = tempo("lightRider") / tempo("groupFoot");
        expect(plane.step(KIND_MOUNTAIN, 1000, 1000, 0.25)).toBeCloseTo(
            (ratio * GEFUEHRT * 3.5) / t.mu.FOOT.mountain,
            12,
        );
        // +20 % am Gipfel: EQUID 2,01, nicht der Leistungskilometer 3.
        expect(plane.step(KIND_PEAK, 0, 150, 0.25)).toBeCloseTo((2 * Math.exp(0.7)) / t.mu.EQUID.peak, 12);
    });

    it("🔴 ein Gang ganz im Gebirge dauert zu Pferd (geführt) doppelt so lange wie zu Fuß (WdE: 3 gegen 6)", () => {
        const von = { x: 4, y: 12 };
        const nach = { x: 16, y: 8 };
        const gang = (transport: string) => {
            const cost = offroadCost(model, { transport, speed: tempo(transport) }, "fastest");
            const world = { water: NO_WATER, rivers: NO_RIVERS, heights: { terrain: t, model, transport } };
            const path = offroadPathBetween(world, cost, von, nach);
            if (!path) throw new Error("Weg erwartet");
            return path;
        };
        const reiter = gang("lightRider");
        const fuss = gang("groupFoot");
        expect(reiter.points).toEqual(fuss.points);
        expect(reiter.time).toBeCloseTo(fuss.time * 2, 9);
        // Ohne Gelände wäre er schneller als zu Fuß.
        const flach = offroadPathBetween(
            { water: NO_WATER, rivers: NO_RIVERS },
            offroadCost(model, { transport: "lightRider", speed: tempo("lightRider") }, "fastest"),
            von,
            nach,
        );
        expect(flach?.time).toBeLessThan(fuss.time);
    });

    it("🔴 ohne Gelände bleibt querfeldein für jedes Mittel wie vorher", () => {
        for (const transport of allowedTransportsForPath(model, "Querfeldein", null, null)) {
            const cost = offroadCost(model, { transport, speed: tempo(transport) }, "fastest");
            const world = { water: NO_WATER, rivers: NO_RIVERS };
            const a = offroadPathBetween(world, cost, { x: 4, y: 12 }, { x: 16, y: 8 });
            const b = offroadPathBetween({ ...world, heights: null }, cost, { x: 4, y: 12 }, { x: 16, y: 8 });
            expect(b, transport).toEqual(a);
        }
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
        allowed_transports: subtype === "Pfad" ? ["horseCarriage", ...LAND] : null,
        transport_domain: subtype === "Pfad" ? "land" : null,
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
        weg("pfad", "Pfad", [
            [110, 100],
            [120, 100],
        ]),
    ];
    const anfrage = (land: string, optimize: RouteRequest["optimize"] = "fastest"): RouteRequest => ({
        optimize,
        transports: { land, river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: false, sea: false },
        minimizeTransfers: false,
    });
    /**
     * Die Profile der beiden Wege über die echte Abtastung: der Pass steigt um 12 %, der Pfad um 6 %.
     * `mountain`: Beide liegen in einer Gebirgsfläche, sonst etwa am Kegel eines freien Gipfels.
     */
    function profile(mountain = false) {
        const pairs = new Map<string, Float32Array>();
        const samples = new Map<string, Float32Array>();
        const lines: [string, [number, number][], number][] = [
            ["pass", wege[0] ? JSON.parse(wege[0].coordinates).coordinates : [], 0.12],
            ["pfad", wege[1] ? JSON.parse(wege[1].coordinates).coordinates : [], 0.06],
        ];
        for (const [id, coordinates, grade] of lines) {
            const line = profileLine(coordinates, (x) => ({ height: 500 + (x - 100) * grade * 3000, mountain }), 0.2);
            pairs.set(id, line.pairs);
            samples.set(id, line.samples);
        }
        return { profiles: pairs, samples };
    }

    it("🔴 ohne Wegprofile rechnet jedes Landmittel genau wie vorher", () => {
        const ohne = buildRouteNetwork(knoten, wege);
        const leer = buildRouteNetwork(knoten, wege, { profiles: new Map(), samples: new Map() });
        for (const transport of LAND) {
            const a = findRoute(ohne, buildRouteGraph(ohne, model, anfrage(transport)), ["A", "C"]);
            const b = findRoute(leer, buildRouteGraph(leer, model, anfrage(transport)), ["A", "C"]);
            expect(b.found, transport).toBe(a.found);
            expect(b.travelHours, transport).toBe(a.travelHours);
            expect(b.segments.map((s) => s.cost_units)).toEqual(a.segments.map((s) => s.cost_units));
        }
    });

    it("mit Profil: jede Familie ihre eigene Steigung, der Wagen am stärksten gebremst", () => {
        const ordinaryRoads = wege.map((path) => (path.subtype === "Pfad" ? { ...path, subtype: "Weg" } : path));
        const network = buildRouteNetwork(knoten, ordinaryRoads, profile(true));
        const ohne = buildRouteNetwork(knoten, ordinaryRoads);
        const verhaeltnis = (transport: string) => {
            const mit = findRoute(network, buildRouteGraph(network, model, anfrage(transport)), ["B", "C"]);
            const eben = findRoute(ohne, buildRouteGraph(ohne, model, anfrage(transport)), ["B", "C"]);
            return mit.travelHours / eben.travelHours;
        };
        // Bergauf 6 % auf dem Pfad: zu Fuß 1,6, zu Pferd e^0,21 = 1,23, im Wagen 1 + 200 · 0,0036 = 1,72.
        const fuss = verhaeltnis("groupFoot");
        const pferd = verhaeltnis("lightRider");
        const wagen = verhaeltnis("horseCarriage");
        expect(pferd).toBeLessThan(fuss);
        expect(wagen).toBeGreaterThan(fuss);
        const link = network.links.find((l) => l.pathPublicId === "pfad");
        if (!link?.slope) throw new Error("Profil erwartet");
        const eichung = calibrate(
            network.links.map((l) => ({ subtype: l.subtype, distance: l.distance, sums: l.slope ?? NO_SLOPE })),
            model,
        );
        expect(wagen).toBeCloseTo(slopeTimeFactor("Weg", link.distance, link.slope, true, model, eichung, "WHEEL"), 9);
    });

    it("🔴 Pfad in einer Gebirgsfläche: Reiter und Karawane gehen geführt, mit 7/9 des Tempos der Gruppe zu Fuß (E3, E5); der Pass bleibt geritten", () => {
        const network = buildRouteNetwork(knoten, wege, profile(true));
        const stunden = (transport: string, von: string, nach: string) =>
            findRoute(network, buildRouteGraph(network, model, anfrage(transport)), [von, nach]).travelHours;
        for (const transport of ["lightRider", "groupHorse", "caravan"]) {
            // WdE S. 161, Gebirge: Pfad zu Fuß 9, Pferd geführt 7 Meilen am Tag.
            expect(stunden(transport, "B", "C") / stunden("groupFoot", "B", "C"), transport).toBeCloseTo(9 / 7, 6);
            expect(stunden(transport, "C", "B") / stunden("groupFoot", "C", "B"), transport).toBeCloseTo(9 / 7, 6);
        }
        // Auf dem Pass reitet er schneller als die Gruppe zu Fuß.
        expect(stunden("lightRider", "A", "B")).toBeLessThan(stunden("groupFoot", "A", "B"));
        // Derselbe Pfad außerhalb der Gebirgsflächen wird geritten.
        const draussen = buildRouteNetwork(knoten, wege, profile(false));
        const geritten = findRoute(draussen, buildRouteGraph(draussen, model, anfrage("lightRider")), ["B", "C"]);
        expect(geritten.travelHours).toBeLessThan(stunden("groupFoot", "B", "C"));
    });

    it("ohne Abtastwerte (Profil vor S5c) greift auf dem Weg keine Sternregel", () => {
        const { profiles } = profile(true);
        const network = buildRouteNetwork(knoten, wege, { profiles });
        const zeit = (transport: string) =>
            findRoute(network, buildRouteGraph(network, model, anfrage(transport)), ["B", "C"]).travelHours;
        expect(zeit("lightRider")).toBeLessThan(zeit("groupFoot"));
    });

    it("„Kürzeste“ wählt ohne Steigung, die Zeit rechnet sie mit", () => {
        const network = buildRouteNetwork(knoten, wege, profile(true));
        const ohne = buildRouteNetwork(knoten, wege);
        const mit = findRoute(network, buildRouteGraph(network, model, anfrage("horseCarriage", "shortest")), [
            "A",
            "C",
        ]);
        const eben = findRoute(ohne, buildRouteGraph(ohne, model, anfrage("horseCarriage", "shortest")), ["A", "C"]);
        expect(mit.nodeIds).toEqual(eben.nodeIds);
        expect(mit.distanceUnits).toBe(eben.distanceUnits);
        expect(mit.travelHours).not.toBe(eben.travelHours);
    });
});
