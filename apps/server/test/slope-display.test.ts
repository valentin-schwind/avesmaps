import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, mapPointId } from "@avesmaps3d/shared";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { calibrateRelief, lineShape, type TerrainHeights } from "../src/routing/relief.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { NO_SLOPE, pairSteps, sampleOffsets, slopeShape, steepestOver, sumPairs } from "../src/routing/slope.ts";
import { prepareWater } from "../src/routing/water.ts";
import { profileLine } from "../src/terrain/path-profiles.ts";

/**
 * Die Steigung in der Antwort (WI-0049 S5d): je Abschnitt Anstieg, Abstieg, höchster Punkt, steilster
 * Abtastschritt und Mehrzeit. 🔴 Ohne Gelände gibt es kein Feld.
 */

const model = AVENTURIA_TRAVEL_MODEL;

const anfrage = (land: string): RouteRequest => ({
    optimize: "fastest",
    transports: { land, river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: false, sea: false },
    minimizeTransfers: false,
});
const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });
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

/** Ein Pfad von A (100) nach C (120): bis x = 110 steigt er um 10 %, danach ist er eben. */
const hoehe = (x: number): number => 500 + Math.min(x - 100, 10) * 0.1 * 3000;
const knoten = [ort("A", 100, 100), ort("C", 120, 100)];
const wege = [
    weg("pfad", "Pfad", [
        [100, 100],
        [105, 100],
        [120, 100],
    ]),
];
function profile(height: (x: number) => number = hoehe, mountain = false) {
    const line = profileLine(
        [
            [100, 100],
            [105, 100],
            [120, 100],
        ],
        (x) => ({ height: height(x), mountain }),
        0.2,
    );
    return { profiles: new Map([["pfad", line.pairs]]), samples: new Map([["pfad", line.samples]]) };
}

describe("Die Form eines Stücks", () => {
    const line = profileLine(
        [
            [0, 0],
            [1, 0],
        ],
        (x) => ({ height: 100 + 300 * x, mountain: false }),
        0.2,
    );
    const offsets = sampleOffsets(line.samples, 1) as Int32Array;
    const sums = { ...sumPairs(line.pairs, 0, 1), steps: pairSteps(line.samples, offsets, 0, 1, [3000]) };

    it("in Fahrtrichtung: vorwärts bergauf, rückwärts bergab, mit Vorzeichen", () => {
        const hin = slopeShape(sums, true);
        const zurueck = slopeShape(sums, false);
        expect(hin).toMatchObject({ descent: 0, highest: 400 });
        expect(hin?.ascent).toBeCloseTo(300, 3);
        expect(hin?.steepest).toBeCloseTo(0.1, 6);
        expect(zurueck?.descent).toBeCloseTo(300, 3);
        expect(zurueck?.steepest).toBeCloseTo(-0.1, 6);
    });

    it("ein Teil nimmt nur die Schritte, deren Mitte darin liegt", () => {
        const haelfte = slopeShape(sums, true, { from: 0, to: 1500 });
        expect(haelfte?.ascent).toBeCloseTo(150, 3);
        expect(slopeShape(sums, true, { from: 5000, to: 6000 })).toBeNull();
    });

    it("ohne Höhe keine Form; ohne Abtastwerte nur das ganze Stück aus den Summen", () => {
        expect(slopeShape(NO_SLOPE, true)).toBeNull();
        const alt = { ...sums, steps: null };
        expect(slopeShape(alt, true)?.ascent).toBeCloseTo(300, 3);
        expect(slopeShape(alt, true, { from: 0, to: 1500 })).toBeNull();
    });
});

describe("Der steilste Abschnitt über ein Fenster", () => {
    // Eben, dann 450 Schritt mit 50 %, dann wieder eben: 225 Schritt Höhe auf einer Rampe.
    const lage = [0, 1000, 1450, 3000];
    const hoehen = [0, 0, 225, 225];

    it("mittelt über die Fensterlänge, das Maximum sitzt an einem Punkt", () => {
        expect(steepestOver(lage, hoehen, 450)).toBeCloseTo(0.5, 12);
        expect(steepestOver(lage, hoehen, 750)).toBeCloseTo(225 / 750, 12);
        expect(steepestOver(lage, hoehen, 1500)).toBeCloseTo(225 / 1500, 12);
    });

    it("ein Stück kürzer als das Fenster zählt als Ganzes; rückwärts mit anderem Vorzeichen", () => {
        expect(steepestOver(lage, hoehen, 5000)).toBeCloseTo(225 / 3000, 12);
        expect(steepestOver([0, 3000], [225, 0], 750)).toBeCloseTo(-225 / 3000, 12);
        expect(steepestOver([0], [5], 750)).toBe(0);
    });
});

describe("Im Router", () => {
    it("🔴 ohne Wegprofile trägt kein Abschnitt eine Steigung", () => {
        const network = buildRouteNetwork(knoten, wege);
        const route = findRoute(network, buildRouteGraph(network, model, anfrage("lightRider")), ["A", "C"]);
        expect(route.found).toBe(true);
        expect(route.segments.some((segment) => segment.slope !== undefined)).toBe(false);
    });

    it("🔴 die Mehrzeit misst gegen denselben Weg eben: nie negativ, bei ebenem Profil 0", () => {
        // Im Gebirge (E3) sitzt der Reiter auf dem Pfad ab - im Ebenen ebenso: Absitzen ist keine Steigung.
        for (const mountain of [false, true]) {
            const steil = buildRouteNetwork(knoten, wege, profile(hoehe, mountain));
            const eben = buildRouteNetwork(
                knoten,
                wege,
                profile(() => 800, mountain),
            );
            for (const transport of ["groupFoot", "lightRider", "caravan"]) {
                const stunden: number[] = [];
                for (const [von, nach] of [
                    ["A", "C"],
                    ["C", "A"],
                ] as const) {
                    const a = findRoute(steil, buildRouteGraph(steil, model, anfrage(transport)), [von, nach]);
                    const b = findRoute(eben, buildRouteGraph(eben, model, anfrage(transport)), [von, nach]);
                    const slope = a.segments[0]?.slope;
                    const flach = b.segments[0]?.slope;
                    if (!slope || !flach) throw new Error("Steigung erwartet");
                    const was = `${transport} ${von} ${String(mountain)}`;
                    expect(flach.extra_hours, was).toBe(0);
                    expect(flach.steepest_grade, was).toBe(0);
                    stunden.push(a.segments[0]?.travel_hours ?? 0);
                    // Im Gebirge eicht die Straße (hier keine): Der Weg eben ist die Bezugszeit selbst. Außerhalb der Gebirge
                    // (F5c) eicht jede Wegart ihr eigenes Mittel, die Bezugszeit steckt in `extra_hours`.
                    if (mountain) {
                        const mehr = (a.segments[0]?.travel_hours ?? 0) - (b.segments[0]?.travel_hours ?? 0);
                        expect(slope.extra_hours, was).toBeCloseTo(mehr, 9);
                    }
                    if (von === "A") expect(slope.extra_hours, was).toBeGreaterThan(0);
                    else expect(slope.extra_hours, was).toBeGreaterThanOrEqual(0);
                    expect(slope.highest_schritt).toBeCloseTo(3500, 3);
                    expect(von === "A" ? slope.ascent_schritt : slope.descent_schritt).toBeCloseTo(3000, 1);
                    expect(slope.steepest_grade).toBeCloseTo(von === "A" ? 0.1 : -0.1, 6);
                }
                if (!mountain) {
                    // 🔴 F5c: Die Eichung hält das Mittel. Hin und zurück über denselben Pfad sind zusammen so lang wie auf dem
                    // ebenen Pfad - der Hang kostet bergauf, was die Gegenrichtung (und das ebene Stück) spart.
                    const ebenHin = findRoute(eben, buildRouteGraph(eben, model, anfrage(transport)), ["A", "C"]);
                    expect(((stunden[0] ?? 0) + (stunden[1] ?? 0)) / 2, `${transport} Mittel`).toBeCloseTo(
                        ebenHin.segments[0]?.travel_hours ?? 0,
                        9,
                    );
                    expect(stunden[0], `${transport} bergauf langsamer`).toBeGreaterThan(stunden[1] as number);
                }
            }
        }
    });

    it("ein geteilter Weg (wp-slice) trägt nur seinen Teil; die Mehrzeit bleibt je Einheit", () => {
        // W liegt ohne eigenen Weg bei x = 110 und wird an den Pfad angebunden: Der Pfad teilt sich dort.
        const mitW = [...knoten, ort("W", 110, 101)];
        const network = buildRouteNetwork(mitW, wege, profile());
        const graph = buildRouteGraph(network, model, anfrage("groupFoot"));
        const hin = findRoute(network, graph, ["A", "W"]);
        const weiter = findRoute(network, graph, ["W", "C"]);
        const steigend = hin.segments.find((segment) => segment.edge_id.startsWith("wp-slice-"));
        const eben = weiter.segments.find((segment) => segment.edge_id.startsWith("wp-slice-"));
        if (!steigend?.slope || !eben?.slope) throw new Error("geteilte Stücke mit Steigung erwartet");
        expect(steigend.slope.ascent_schritt).toBeCloseTo(3000, 1);
        expect(eben.slope.ascent_schritt).toBeCloseTo(0, 6);
        expect(eben.slope.highest_schritt).toBeCloseTo(3500, 3);
        // Die Zeit erbt das Stück je Einheit, die Mehrzeit ebenso: beide Hälften zusammen wie der ganze Weg.
        const ganz = findRoute(network, graph, ["A", "C"]).segments[0]?.slope?.extra_hours ?? 0;
        expect(steigend.slope.extra_hours + eben.slope.extra_hours).toBeCloseTo(ganz, 9);
    });
});

describe("Querfeldein", () => {
    /** Ein Kamm von 3.000 Schritt bei x = 10 in einem Gebirge von 20 × 20 E. */
    function kamm(): TerrainHeights {
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
        return { rasters: [raster], cones: [], rule, mu: calibrateRelief([raster], [], rule, model) };
    }
    const t = kamm();

    it("die Linie über den Kamm: hinauf und hinunter, der Kamm als höchster Punkt", () => {
        const shape = lineShape(t, [
            [4, 10],
            [16, 10],
        ]);
        expect(shape?.highest).toBeCloseTo(3000, -1);
        expect(shape?.ascent).toBeCloseTo(shape?.descent ?? 0, -1);
        expect(
            lineShape(t, [
                [30, 10],
                [40, 10],
            ]),
        ).toBeNull();
    });

    it("🔴 der Gang zu einem Kartenpunkt im Gebirge meldet Steigung, ohne Gelände nicht", () => {
        const land = prepareWater([
            {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [60, 0],
                            [60, 60],
                            [0, 60],
                            [0, 0],
                        ],
                    ],
                },
                minX: 0,
                minY: 0,
                maxX: 60,
                maxY: 60,
            },
        ]);
        const orte = [ort("D", 30, 10), ort("E", 40, 10)];
        const pfad = [
            weg("ebene", "Pfad", [
                [30, 10],
                [40, 10],
            ]),
        ];
        const network = buildRouteNetwork(orte, pfad);
        const graph = buildRouteGraph(network, model, anfrage("lightRider"));
        const punkt = mapPointId({ x: 8, y: 10 });
        const mit = findRoute(network, graph, [punkt, "E"], { land, rivers: NO_RIVERS, heights: t });
        const ohne = findRoute(network, graph, [punkt, "E"], { land, rivers: NO_RIVERS });
        const gang = mit.segments.find((segment) => segment.offroad);
        expect(gang?.slope?.highest_schritt).toBeGreaterThan(1000);
        // Abgesessen im Gebirge, dazu der Gebirgsfaktor: die Mehrzeit ist groß und positiv.
        expect(gang?.slope?.extra_hours).toBeGreaterThan(0);
        expect(gang?.slope?.extra_hours).toBeLessThan(gang?.travel_hours ?? 0);
        expect(ohne.segments.some((segment) => segment.slope !== undefined)).toBe(false);
        // Der Weg zwischen D und E liegt außerhalb des Geländes und trägt keine.
        expect(mit.segments.filter((segment) => !segment.synthetic).every((segment) => !segment.slope)).toBe(true);
    });
});
