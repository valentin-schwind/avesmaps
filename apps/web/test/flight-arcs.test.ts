import { describe, expect, it } from "vitest";
import { Color, createExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FilterSpecification, StyleSpecification } from "maplibre-gl";
import {
    AIR_EDGE_PREFIX,
    AIR_TYPE,
    AVENTURIA_FLIGHT_CARTOGRAPHY,
    AVENTURIA_TRAVEL_MODEL,
    DESIGN_CANON,
    canonColour,
    catmullRomLine,
    type CurvePoint,
    type RouteResponse,
    type RouteSegment,
} from "@avesmaps3d/shared";
import {
    buildFlightTracks,
    flightProfile,
    lotAlpha,
    lotSteps,
    MERCATOR_PER_SCHRITT,
    MERCATOR_PER_UNIT,
    resampleEvenly,
    sampleCounts,
} from "../src/map/flight-path.ts";
import { buildFlightGeometry } from "../src/map/flight-arcs.ts";
import {
    buildRouteLineLayers,
    FLIGHT_COLOUR,
    ROUTE_FLIGHT_IN_SPACE,
    ROUTE_HALO_LAYER_ID,
    ROUTE_LINE_LAYER_ID,
    routeLineFeatures,
    roundCorners,
    segmentShape,
    withRoute,
    type RouteLayerData,
} from "../src/map/route-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Der Flug auf der Karte (WI-0051 F3), ohne Browser: seine Form, seine Farbe, die Linie, die geneigt
 * zurücktritt, und das Höhenprofil der Flugbahn im Raum.
 *
 * 🔴 Der Shader läuft nur im Browser (`e2e/flight-arcs.spec.ts`). Hier steht die Rechnung, deren Ergebnis er
 * als Textur bekommt, und die Geometrie, die er zeichnet.
 */

const BAHN = AVENTURIA_FLIGHT_CARTOGRAPHY.bahn;

it("uses the obstacle-verified flight display without rounding it again", () => {
    const flight = segment(0, [
        [0, 0],
        [10, 10],
        [20, 0],
    ]);
    flight.display = {
        type: "LineString",
        coordinates: [
            [0, 0],
            [5, 10],
            [20, 0],
        ],
    };
    expect(segmentShape(flight)).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 20, y: 0 },
    ]);
});

function segment(index: number, points: [number, number][], subtype = AIR_TYPE): RouteSegment {
    const flight = subtype === AIR_TYPE;
    return {
        index,
        edge_id: flight ? `${AIR_EDGE_PREFIX}a-b` : `e${String(index)}`,
        public_id: "",
        from_node: "a",
        to_node: "b",
        from_node_id: "a",
        to_node_id: "b",
        subtype,
        path_name: "",
        transport_type: flight ? "witchFlight" : "groupFoot",
        distance_units: 10,
        cost_units: 1,
        cost_factor: 1,
        travel_hours: 1,
        flow_time_factor: 1,
        flow_state: "none",
        synthetic: false,
        offroad: false,
        geometry: { type: "LineString", coordinates: points },
    };
}

function route(segments: RouteSegment[], air?: { profile: string; altitude: number }): RouteResponse {
    const place = (name: string): RouteResponse["stages"][number]["from"] => ({
        point: "place",
        place_id: name,
        name,
        x: 0,
        y: 0,
    });
    return {
        found: true,
        failed_leg_index: null,
        ...(air
            ? {
                  air: {
                      profile: air.profile,
                      speed_mph: 40,
                      altitude_schritt: air.altitude,
                      max_above_ground_schritt: air.altitude * 10,
                      ceiling_schritt: 5000,
                  },
              }
            : {}),
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [],
        legs: [],
        segments,
        distance_units: 10,
        travel_hours: 1,
        travel_days: 1,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: 1,
        miles_per_unit: 3,
        air_legs_units: [],
        stages: segments.map((s, index) => ({
            index,
            leg_index: index,
            segment_start: s.index,
            segment_count: 1,
            type: s.subtype,
            transport: s.transport_type,
            flow_state: null,
            path_names: [],
            from: place("A"),
            to: place("B"),
            distance_units: 10,
            travel_hours: 1,
            rest_hours: 0,
        })),
        warnings: [],
    };
}

const data = (r: RouteResponse, extra: Partial<RouteLayerData> = {}): RouteLayerData => ({
    route: r,
    stale: false,
    selectedStage: null,
    waypoints: [],
    ...extra,
});

/** Punin → Perricum mit dem Hippogriff, der F2-Weg vom 2026-09-28 in Kartenkoordinaten. */
const HIPPOGRIFF: [number, number][] = [
    [518.257, 441.229],
    [579.5, 498.531],
    [584.467, 501.499],
    [631.281, 507.328],
];
/** Baburin → Gareth mit dem Hexenbesen, ebenso. */
const HEXENBESEN: [number, number][] = [
    [612.877, 476.036],
    [600.001, 513.04],
    [596.978, 516.792],
    [551.625, 532.969],
];

/** Schneidet sich der Zug selbst? */
function schneidetSich(line: readonly CurvePoint[]): boolean {
    const kreuzt = (p: CurvePoint, q: CurvePoint, r: CurvePoint, s: CurvePoint): boolean => {
        const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
        if (d === 0) return false;
        const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
        const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
        return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
    };
    for (let i = 0; i + 1 < line.length; i += 1) {
        for (let j = i + 2; j + 1 < line.length; j += 1) {
            if (
                kreuzt(
                    line[i] as CurvePoint,
                    line[i + 1] as CurvePoint,
                    line[j] as CurvePoint,
                    line[j + 1] as CurvePoint,
                )
            )
                return true;
        }
    }
    return false;
}

/** Wie weit ein Punkt höchstens vom Zug entfernt liegt. */
function abstandZumZug(line: readonly CurvePoint[], zug: readonly [number, number][]): number {
    let weitester = 0;
    for (const p of line) {
        let naechster = Number.POSITIVE_INFINITY;
        for (let i = 0; i + 1 < zug.length; i += 1) {
            const [ax, ay] = zug[i] as [number, number];
            const [bx, by] = zug[i + 1] as [number, number];
            const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2)) : 0;
            naechster = Math.min(naechster, Math.hypot(p.x - ax - t * (bx - ax), p.y - ay - t * (by - ay)));
        }
        weitester = Math.max(weitester, naechster);
    }
    return weitester;
}

describe("Die Form eines Flugs, flach wie geneigt (Betreiber 2026-09-28: „3. ja“)", () => {
    it("eine Luftlinie bleibt gerade", () => {
        const shape = segmentShape(
            segment(0, [
                [500, 500],
                [600, 520],
            ]),
        );
        expect(shape).toEqual([
            { x: 500, y: 500 },
            { x: 600, y: 520 },
        ]);
    });

    it("🔴 ein F2-Umweg wird rund ohne Schleife, wo Catmull-Rom eine schlug", () => {
        for (const zug of [HIPPOGRIFF, HEXENBESEN]) {
            const punkte = zug.map(([x, y]) => ({ x, y }));
            // Der Grund für die eigene Form: Die Kurve der Wege schneidet sich hier selbst.
            expect(schneidetSich(catmullRomLine(punkte))).toBe(true);
            const shape = segmentShape(segment(0, zug));
            expect(schneidetSich(shape)).toBe(false);
            expect(shape.length).toBeGreaterThan(zug.length * 4);
            expect(shape[0]).toEqual(punkte[0]);
            expect(shape[shape.length - 1]).toEqual(punkte[punkte.length - 1]);
            // Rund, aber nah am Weg: gemessen an acht F2-Linien höchstens 1,35 E.
            expect(abstandZumZug(shape, zug)).toBeLessThan(1.5);
            // Keine Kehre: Aufeinanderfolgende Stücke biegen nie um mehr als 90°.
            for (let i = 1; i + 1 < shape.length; i += 1) {
                const a = shape[i - 1] as CurvePoint;
                const b = shape[i] as CurvePoint;
                const c = shape[i + 1] as CurvePoint;
                expect((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it("jeder andere Abschnitt bleibt Catmull-Rom wie vorher", () => {
        const zug: [number, number][] = [
            [0, 0],
            [10, 0],
            [10, 10],
        ];
        const shape = segmentShape(segment(0, zug, "Strasse"));
        expect(shape).toEqual(catmullRomLine(zug.map(([x, y]) => ({ x, y }))));
    });

    it("das Abschneiden hält Anfang und Ende und rundet jede innere Ecke", () => {
        const eins = roundCorners(
            [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
            ],
            1,
        );
        expect(eins).toEqual([
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 1 },
            { x: 4, y: 4 },
        ]);
        expect(
            roundCorners(
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                ],
                3,
            ),
        ).toHaveLength(2);
    });
});

describe("Die Farbe eines Flugs (Betreiber 2026-09-28: „alle flüge sollen eine rote flugbahn bekommen“)", () => {
    it("🔴 jeder Flug ist rot, gleich mit welchem Flugmittel", () => {
        expect(FLIGHT_COLOUR).toBe("routeFlight");
    });

    it("der Kanon trägt das Rot ohne Dunkelwert, wie jede Farbe der Route", () => {
        expect(canonColour("routeFlight")).toBe("#d0312d");
        expect(DESIGN_CANON.colourDark?.["routeFlight"]).toBeUndefined();
    });

    it("die Linie malt Gold für die gewählte Etappe, sonst Rot für einen Flug, sonst Blau", () => {
        const linie = findLayer(buildRouteLineLayers(), ROUTE_LINE_LAYER_ID, "line");
        const farbe = createExpression(
            linie?.paint?.["line-color"],
            "line-color",
            propertySpec("paint_line", "line-color"),
        );
        if (farbe.result !== "success") throw new Error("line-color übersetzt nicht");
        const an = (properties: Record<string, unknown>): string =>
            (farbe.value.evaluate({ zoom: 5 }, { type: 2, properties } as never) as Color).toString();
        expect(an({ selected: true, colour: "routeFlight" })).toBe(
            Color.parse(canonColour("routeSelected"))?.toString(),
        );
        expect(an({ selected: false, colour: "routeFlight" })).toBe(
            Color.parse(canonColour("routeFlight"))?.toString(),
        );
        expect(an({ selected: false, colour: "route" })).toBe(Color.parse(canonColour("route"))?.toString());
    });

    it("die Merkmale der Linie: jeder Flug trägt `flight` und Rot, ein Landweg bleibt blau", () => {
        const flug = routeLineFeatures(
            data(route([segment(0, HEXENBESEN)], { profile: "witchFlight", altitude: 100 })),
        );
        expect(flug.features[0]?.properties).toMatchObject({ flight: true, colour: "routeFlight" });
        const greif = routeLineFeatures(data(route([segment(0, HEXENBESEN)], { profile: "griffin", altitude: 800 })));
        expect(greif.features[0]?.properties).toMatchObject({ flight: true, colour: "routeFlight" });
        const land = routeLineFeatures(data(route([segment(0, HEXENBESEN, "Strasse")])));
        expect(land.features[0]?.properties).toMatchObject({ flight: false, colour: "route" });
    });
});

describe("Geneigt tritt die Linie für den Flug zurück, flach bleibt alles wie vorher", () => {
    const layers = buildRouteLineLayers();
    const filterOf = (id: string): FilterSpecification => {
        const layer = findLayer(layers, id, "line");
        if (!layer?.filter) throw new Error(`${id} hat keinen Filter`);
        return layer.filter;
    };
    const zeigt = (id: string, geneigt: boolean, properties: Record<string, unknown>): boolean =>
        featureFilter(filterOf(id), "filter", { [ROUTE_FLIGHT_IN_SPACE]: geneigt }).filter({ zoom: 5 }, {
            type: 2,
            properties,
        } as never);

    it("🔴 flach zeichnen Saum und Linie jeden Flug, geneigt keinen; Landwege in beiden Fällen", () => {
        for (const id of [ROUTE_HALO_LAYER_ID, ROUTE_LINE_LAYER_ID]) {
            expect(zeigt(id, false, { flight: true, offroad: false })).toBe(true);
            expect(zeigt(id, true, { flight: true, offroad: false })).toBe(false);
            expect(zeigt(id, true, { flight: false, offroad: false })).toBe(true);
            expect(zeigt(id, false, { flight: false, offroad: false })).toBe(true);
            // Querfeldein zeichnen weiter die Pillen.
            expect(zeigt(id, false, { flight: false, offroad: true })).toBe(false);
        }
    });

    it("der Stil nennt die Vorgabe flach und besteht MapLibres Prüfung", () => {
        const style = withRoute(
            { version: 8, sources: {}, layers: [] } as StyleSpecification,
            data(route([segment(0, HEXENBESEN)], { profile: "witchFlight", altitude: 100 })),
        );
        expect(style.state).toEqual({ [ROUTE_FLIGHT_IN_SPACE]: { default: false } });
        expect(validateStyleMin(style as never)).toEqual([]);
    });

    it("🔴 2D wie vorher: Form und Filter eines Landwegs unverändert, ein Flug nur in Farbe und Rundung", () => {
        const zug: [number, number][] = [
            [0, 0],
            [10, 0],
            [10, 10],
        ];
        const land = routeLineFeatures(data(route([segment(0, zug, "Strasse")]))).features[0];
        const vorher = catmullRomLine(zug.map(([x, y]) => ({ x, y })));
        expect(land?.geometry.coordinates).toHaveLength(vorher.length);
        const alt = featureFilter(["!=", ["get", "offroad"], true], "filter");
        for (const properties of [
            { flight: false, offroad: false },
            { flight: false, offroad: true },
            { flight: true, offroad: false },
        ]) {
            expect(zeigt(ROUTE_LINE_LAYER_ID, false, properties)).toBe(
                alt.filter({ zoom: 5 }, { type: 2, properties } as never),
            );
        }
    });
});

describe("Das Höhenprofil der Flugbahn im echten Maßstab (Betreiber 2026-09-28: „A“)", () => {
    // Betreiber: „zuerst steigt das flugmittel auf die durchschnittliche flughöhe, erst wenn hindernisse kommen,
    // steigt das fluggerät bis 1000% an. wenn es dann nicht ausweichen kann, weicht es aus“.
    const S = MERCATOR_PER_SCHRITT;
    const E = MERCATOR_PER_UNIT;
    /**
     * 100 E lang (300 Meilen), je 1/16 E eine Probe; wie ein Greif: Reisehöhe 800, höchstens 8.000 über Grund und
     * (Betreiber 2026-10-04, für alle) höchstens 5.000 über dem Meer.
     */
    const LAENGE = 100;
    const N = 1600;
    const GREIF = { cruise: 800, reach: 8000 };
    const HEXE = { cruise: 100, reach: 1000 };
    const bahn = (boden: (e: number) => number = () => 0, flieger: { cruise: number; reach: number } = GREIF) => {
        const ground = new Float32Array(N + 1);
        for (let k = 0; k <= N; k += 1) ground[k] = boden((LAENGE * k) / N) * S;
        return {
            ground,
            length: LAENGE * E,
            cruise: flieger.cruise * S,
            reach: flieger.reach * S,
            ceiling: 5000 * S,
            clearance: 200 * S,
        };
    };
    /** Das Profil in Schritt ohne Überhöhung, an der Stelle `e` Karteneinheiten. */
    const hoehe = (z: Float32Array, e: number): number => (z[Math.round((e / LAENGE) * N)] as number) / S;
    /** Ein Grat der Höhe `h` von `von` bis `bis` (in E). */
    const grat =
        (h: number, von: number, bis: number) =>
        (e: number): number =>
            e >= von && e <= bis ? h : 0;

    it("🔴 der Maßstab ist der des Geländes: 1 Schritt = 1 / (1024 · 3000) Mercator", () => {
        expect(S * 1024 * 3000).toBeCloseTo(1, 9);
        expect(E * 1024).toBeCloseTo(1, 9);
        expect(BAHN).toEqual({ steigung: 0.25, haltenEinheiten: 2 });
    });

    it("🔴 über der Ebene: vom Boden mit 1 : 4 auf die Reisehöhe, halten, mit 1 : 4 ins Ziel", () => {
        const z = flightProfile(bahn(), 1);
        expect(z[0]).toBe(0);
        expect(z[N]).toBe(0);
        // Eine halbe E sind 1.500 Schritt: Nach ihnen ist das Flugmittel 375 Schritt hoch.
        expect(hoehe(z, 0.5)).toBeCloseTo(375, 3);
        expect(hoehe(z, LAENGE - 0.5)).toBeCloseTo(375, 3);
        // Nach 3.200 Schritt (1,07 E) ist es auf 800 und bleibt dort.
        for (const e of [1.1, 20, 50, 80, 98.9]) expect(hoehe(z, e)).toBeCloseTo(800, 3);
    });

    it("🔴 ein Grat höher als die Reisehöhe: 200 Schritt darüber, rechtzeitig mit 1 : 4 gestiegen", () => {
        const z = flightProfile(bahn(grat(2000, 50, 52)), 1);
        expect(hoehe(z, 51)).toBeCloseTo(2200, 3);
        // Den Bedarf hält es 2 E vor dem Grat; 1 E davor ist es erst 750 Schritt tiefer.
        expect(hoehe(z, 48)).toBeCloseTo(2200, 3);
        expect(hoehe(z, 47)).toBeCloseTo(2200 - 750, 3);
        expect(hoehe(z, 30)).toBeCloseTo(800, 3);
    });

    it("🔴 ein Grat über der Höchstflughöhe: gekappt, nie über 5.000 über dem Meer, und nie unter dem Boden", () => {
        const knapp = flightProfile(bahn(grat(4900, 50, 52)), 1);
        expect(hoehe(knapp, 51)).toBeCloseTo(5000, 3);
        const zuHoch = bahn(grat(6000, 50, 52));
        const hoch = flightProfile(zuHoch, 1);
        // Über dem Grat steht die Bahn auf ihm (dort hätte F2 ausweichen müssen), daneben höchstens 5.000.
        expect(hoehe(hoch, 51)).toBeCloseTo(6000, 3);
        expect(hoehe(hoch, 49)).toBeCloseTo(5000, 3);
        for (let k = 0; k <= N; k += 1) {
            expect(hoch[k] as number).toBeGreaterThanOrEqual(zuHoch.ground[k] as number);
            if ((zuHoch.ground[k] as number) === 0)
                expect(hoch[k] as number).toBeLessThanOrEqual(5000 * S * (1 + 1e-6));
        }
    });

    it("🔴 Betreiber 2026-10-04: Der Hexenbesen steigt über einen Grat von 3.000 (200 darüber), nie höher als 1.000 über dem Boden", () => {
        // Die Wand: Der Boden springt auf 3.000. Mit 1 : 4 käme die Bahn davor nicht hinauf; die Obergrenze (Boden +
        // 1.000) gewinnt, vor der Wand also 1.000, auf dem Grat 200 darüber.
        const wand = bahn(grat(3000, 50, 52), HEXE);
        const z = flightProfile(wand, 1);
        expect(hoehe(z, 51)).toBeCloseTo(3200, 3);
        expect(hoehe(z, 49)).toBeCloseTo(1000, 3);
        // Über der Ebene gilt der Mindestabstand von 200 (größer als die Reisehöhe von 100, so war es schon vorher).
        expect(hoehe(z, 20)).toBeCloseTo(200, 3);
        for (let k = 0; k <= N; k += 1) {
            const boden = wand.ground[k] as number;
            expect(z[k] as number).toBeGreaterThanOrEqual(boden);
            expect(z[k] as number).toBeLessThanOrEqual(boden + 1000 * S * (1 + 1e-6));
        }
    });

    it("🔴 Betreiber 2026-10-04: Ein Hügelland von 2.000 überfliegt der Hexenbesen im Abstand von 200, ohne in die Täler zu sinken", () => {
        // Sanft ansteigendes Gelände: Die Bahn folgt ihm mit 200 Schritt Abstand (nicht der Reisehöhe über dem Meer).
        const hang = bahn((e) => (e >= 40 && e <= 60 ? 2000 * Math.sin(((e - 40) / 20) * Math.PI) : 0), HEXE);
        const z = flightProfile(hang, 1);
        expect(hoehe(z, 50)).toBeCloseTo(2200, 3);
        for (let k = 0; k <= N; k += 1) {
            expect(z[k] as number).toBeGreaterThanOrEqual(hang.ground[k] as number);
            expect(z[k] as number).toBeLessThanOrEqual((hang.ground[k] as number) + 1000 * S * (1 + 1e-6));
        }
    });

    it("🔴 zwischen zwei nahen Graten hält es die Höhe, zwischen fernen sinkt es auf die Reisehöhe", () => {
        const nah = flightProfile(
            bahn((e) => grat(3000, 40, 42)(e) + grat(3000, 45, 47)(e)),
            1,
        );
        expect(hoehe(nah, 43.5)).toBeCloseTo(3200, 3);
        const fern = flightProfile(
            bahn((e) => grat(3000, 30, 32)(e) + grat(3000, 60, 62)(e)),
            1,
        );
        expect(hoehe(fern, 46)).toBeCloseTo(800, 3);
        // Dazwischen sinkt und steigt es nie steiler als 1 : 4.
        for (let k = 1; k <= N; k += 1) {
            const dz = Math.abs((fern[k] as number) - (fern[k - 1] as number));
            // Das Profil steht in 32-Bit-Zahlen wie die Textur: ein Hauch Rundung.
            expect(dz).toBeLessThanOrEqual(0.25 * ((LAENGE * E) / N) * (1 + 1e-4));
        }
    });

    it("🔴 ein Grat gleich am Start: das Flugmittel steigt mit 1 : 4 auf, wo der Boden höher ist, auf dem Boden", () => {
        const z = flightProfile(bahn(grat(3000, 0.5, 1)), 1);
        expect(z[0]).toBe(0);
        expect(hoehe(z, 0.25)).toBeCloseTo(187.5, 3);
        expect(hoehe(z, 0.75)).toBeCloseTo(3000, 3);
        const g = bahn(grat(3000, 0.5, 1)).ground;
        for (let k = 0; k <= N; k += 1) expect(z[k] as number).toBeGreaterThanOrEqual(g[k] as number);
    });

    it("🔴 Start und Ziel auf dem Boden der Wegpunkte, auch hoch im Gebirge", () => {
        const z = flightProfile(
            bahn((e) => (e <= 2 || e >= 98 ? 1500 : 0)),
            1,
        );
        expect(hoehe(z, 0)).toBeCloseTo(1500, 3);
        expect(hoehe(z, LAENGE)).toBeCloseTo(1500, 3);
    });

    it("🔴 mal der Überhöhung: Beim Neigen wächst die Bahn genau mit den Bergen", () => {
        const b = bahn(grat(2000, 50, 52));
        const voll = flightProfile(b, 1);
        const halb = flightProfile(b, 0.5);
        for (let k = 0; k <= N; k += 50) expect(halb[k]).toBeCloseTo((voll[k] as number) * 0.5, 12);
        expect(flightProfile(b, 0).every((z) => z === 0)).toBe(true);
    });

    it("Reisehöhe und beide Höchstgrenzen aus der Route, der Mindestabstand aus dem Reisemodell", () => {
        const r = route([segment(0, HEXENBESEN)], { profile: "witchFlight", altitude: 100 });
        r.air = {
            profile: "witchFlight",
            speed_mph: 40,
            altitude_schritt: 100,
            max_above_ground_schritt: 1000,
            ceiling_schritt: 5000,
        };
        const [track] = buildFlightTracks(data(r));
        expect((track?.cruise ?? 0) / S).toBeCloseTo(100, 6);
        expect((track?.reach ?? 0) / S).toBeCloseTo(1000, 6);
        expect((track?.ceiling ?? 0) / S).toBeCloseTo(5000, 6);
        expect((track?.clearance ?? 0) / S).toBeCloseTo(AVENTURIA_TRAVEL_MODEL.flug.wert.mindestabstandSchritt, 6);
    });
});

describe("Proben und Lote", () => {
    const P = AVENTURIA_FLIGHT_CARTOGRAPHY.proben;

    it("ein langer Abschnitt allein bekommt die Höchstzahl, viele teilen sich die Route, keiner unter dem Mindestmaß", () => {
        expect(sampleCounts([0.13])).toEqual([P.jeAbschnittHoechstens]);
        const viele = sampleCounts(Array.from({ length: 99 }, () => 0.13));
        expect(new Set(viele)).toEqual(new Set([Math.floor(P.jeRouteHoechstens / 99)]));
        const sehrViele = sampleCounts(Array.from({ length: 999 }, () => 0.13));
        expect(new Set(sehrViele)).toEqual(new Set([P.jeAbschnittMindestens]));
        const gemischt = sampleCounts([0.13, 0.13, 0.13, 0.13, 0.13, 0.13, 0.13, 0.13, 0.13, 0.001]);
        expect(gemischt.slice(0, 9).every((n) => n === Math.floor(P.jeRouteHoechstens * (0.13 / 1.171)))).toBe(true);
        expect(gemischt[9]).toBe(P.jeAbschnittMindestens);
    });

    it("gleiche Abstände, Anfang und Ende auf den Wegpunkten", () => {
        const { x, y, length } = resampleEvenly(
            [
                [0, 0],
                [3, 0],
                [3, 1],
            ],
            5,
        );
        expect(length).toBe(4);
        expect([...x]).toEqual([0, 1, 2, 3, 3]);
        expect([...y]).toEqual([0, 0, 0, 0, 1]);
    });

    it("die Lote stehen in Halbierungen; eine neue Teilung blendet ein, sobald Platz ist", () => {
        const lote = lotSteps(32);
        expect(lote).toHaveLength(31);
        expect(lote[15]).toEqual({ anteil: 0.5, stufe: 1 });
        expect(lote[7]).toEqual({ anteil: 0.25, stufe: 2 });
        expect(lote[0]).toEqual({ anteil: 1 / 32, stufe: 5 });
        expect(lotAlpha(1, 96, 48)).toBe(1);
        expect(lotAlpha(2, 96, 48)).toBe(0);
        expect(lotAlpha(2, 192, 48)).toBe(1);
        expect(lotAlpha(2, 144, 48)).toBeCloseTo(Math.log2(3) - 1, 6);
        expect(lotAlpha(1, 0, 48)).toBe(0);
    });
});

describe("Die Bahnen einer Route", () => {
    it("nur Flugabschnitte, mit Reisehöhe, Farbe, Gold und Deckkraft wie ihre Linie", () => {
        const r = route([segment(0, HEXENBESEN), segment(1, HIPPOGRIFF)], { profile: "witchFlight", altitude: 100 });
        const tracks = buildFlightTracks(data(r, { selectedStage: 1 }));
        expect(tracks).toHaveLength(2);
        expect(tracks[0]).toMatchObject({ stage: 0, segment: 0, colour: "routeFlight", alpha: 1 });
        expect(tracks[1]).toMatchObject({ stage: 1, segment: 1, colour: "routeSelected" });
        expect((tracks[0]?.cruise ?? 0) / MERCATOR_PER_SCHRITT).toBeCloseTo(100, 6);
        const veraltet = buildFlightTracks(data(r, { stale: true, selectedStage: 1 }));
        expect(veraltet[1]).toMatchObject({ colour: "routeFlight", alpha: DESIGN_CANON.route.staleFactor });
        const gemischt = route([segment(0, HEXENBESEN, "Strasse")]);
        expect(buildFlightTracks(data(gemischt))).toEqual([]);
    });

    it("die Geometrie: je Probe zwei Ecken, je Lot vier, die Proben der Bahnen hintereinander", () => {
        const r = route([segment(0, HEXENBESEN), segment(1, HIPPOGRIFF)], { profile: "griffin", altitude: 800 });
        const tracks = buildFlightTracks(data(r));
        const g = buildFlightGeometry(tracks);
        const n0 = tracks[0]?.x.length ?? 0;
        const n1 = tracks[1]?.x.length ?? 0;
        expect(g.offsets).toEqual([0, n0]);
        expect(g.samples).toBe(n0 + n1);
        expect(g.bands.length).toBe((n0 + n1) * 2 * 16);
        expect(g.bandIndices.length).toBe((n0 - 1 + n1 - 1) * 6);
        const lote = AVENTURIA_FLIGHT_CARTOGRAPHY.zeichnung.lote.teileHoechstens - 1;
        expect(g.lots.length).toBe(2 * lote * 4 * 7);
        expect(g.lotIndices.length).toBe(2 * lote * 6);
    });
});
