import { beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, resolveAirQuery, ROUTE_FLIGHT_SEARCH_LIMIT, type RouteAir } from "@avesmaps3d/shared";
import { airTerrain, boundsAbove } from "../src/routing/air-obstacles.ts";
import type { AirPoint } from "../src/routing/air-route.ts";
import { flyAround, mountainAirFlight } from "../src/routing/air-way.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import { RouteService, type RouteOutcome, type RouteQuery } from "../src/routing/service.ts";
import { gebirge, GIPFEL, wand, wandQuelle } from "./support/air-terrain.ts";
import { shuffled } from "./support/invariants.ts";

/**
 * Determinismus des Flugs (Hardening Review 2026-09-28, Plan 6.34-6.37, 11.51): Dieselbe Anfrage liefert jedes Mal
 * dasselbe, BYTEGLEICH - Wegpunkte, Etappen, Zeiten, Distanzen, Linien. Die Suche des Flugs läuft auf typisierten Feldern
 * mit einem Heap und hält Zwischenspeicher (`airTerrain` je Gelände, Linien und Prüfungen je Anfrage); ein Ergebnis,
 * das von der Reihenfolge der Anfragen, vom Zustand eines Zwischenspeichers oder von einer Iterationsreihenfolge
 * abhinge, fiele hier auf: Jeder Fall läuft mehrfach, in wechselnder Reihenfolge, zwischen anderen Anfragen, auf einem
 * warmen Dienst und auf einem frischen mit frisch gebautem Gelände.
 *
 * Das Gelände: eine Wand (10 × 40 E in der Mitte, 6.000 Schritt) und ein freier Gipfel auf der Luftlinie von A nach B.
 * Seit 2026-10-04 gilt für alle Flugmittel dieselbe Grenze (5.000 − 200 = 4.800 Schritt, Betreiber): Hexe, Greif und das
 * eigene Flugmittel müssen um beides, ob Reisehöhe 100 oder 800.
 */

const model = AVENTURIA_TRAVEL_MODEL;

const frischerDienst = (): RouteService => new RouteService({ mapDomain: "aventuria", model, source: wandQuelle() });

const air = (query: Parameters<typeof resolveAirQuery>[1]): RouteAir => {
    const resolved = resolveAirQuery(model, query);
    if (!resolved.ok || !resolved.air) throw new Error("Flugmittel erwartet");
    return resolved.air;
};
const greif = air({ air: "griffin" });
const hexe = air({ air: "witchFlight" });
const eigenes = air({ air: "custom", air_speed: 12.5, air_altitude: 250 });

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

interface Fall {
    name: string;
    query: RouteQuery;
}

const fliegen = (name: string, waypoints: string[], mittel: RouteAir, extra: Partial<RouteQuery> = {}): Fall => ({
    name,
    query: { ...zuFuss, waypoints, air: mittel, ...extra },
});

/** Zwanzig suchende Etappen sind erlaubt, 21 nicht (`ROUTE_FLIGHT_SEARCH_LIMIT`): die Wand zwischen C und D, hin und her. */
const hinUndHer = (etappen: number): string[] =>
    Array.from({ length: etappen + 1 }, (_, index) => (index % 2 === 0 ? "c" : "d"));

const FAELLE: Fall[] = [
    // Reine Flugroute: nur Luftlinien (abseits von Wand und Gipfel), mit Rast und Reisebeginn.
    fliegen("rein: Greif A-C-E", ["a", "c", "e"], greif, { hoursPerDay: 8 }),
    fliegen("rein: Greif G-B, 24 Stunden, Reisebeginn", ["g", "b"], greif, {
        hoursPerDay: 24,
        departure: { month: "praios", day: 1 },
    }),
    // Gemischt: eine Etappe um den Gipfel, ein wiederholter Wegpunkt, freie Luftlinien, Etappen um die Wand.
    fliegen("gemischt: Hexe A-B-B-C-D-E-H-I", ["a", "b", "b", "c", "d", "e", "h", "i"], hexe, {
        hoursPerDay: 6,
        departure: { month: "efferd", day: 12 },
    }),
    // Hindernis und Umweg, in beiden Richtungen, aus dem Gebirge heraus und mit dem eigenen Flugmittel.
    fliegen("umweg: Hexe C-D", ["c", "d"], hexe),
    fliegen("umweg: Hexe D-C", ["d", "c"], hexe),
    fliegen("umweg: Hexe A-B um den Gipfel", ["a", "b"], hexe),
    fliegen("umweg: Hexe aus der Wand F-C-D-F", ["f", "c", "d", "f"], hexe),
    fliegen("umweg: eigenes Flugmittel C-D mit Reisebeginn", ["c", "d"], eigenes, {
        departure: { month: "rahja", day: 30 },
    }),
    // Das Budget der Suchen: an der Grenze wird gerechnet, darüber vor jeder Suche abgewiesen.
    fliegen("Budget: 20 suchende Etappen", hinUndHer(ROUTE_FLIGHT_SEARCH_LIMIT), hexe),
    fliegen("Budget: 21 suchende Etappen", hinUndHer(ROUTE_FLIGHT_SEARCH_LIMIT + 1), hexe),
    // Dazwischen ein Landweg, damit auch der Graphzwischenspeicher des Dienstes mitspielt.
    { name: "Land: A-B zu Fuß", query: { ...zuFuss, waypoints: ["a", "b"] } },
];

/** Die Bytes eines Werts: JSON mit gleicher Schlüsselfolge; `-0` und Nicht-Zahlen bleiben sichtbar, JSON verschluckte sie. */
function bytesOf(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (Object.is(item, -0)) return "-0";
        return typeof item === "number" && !Number.isFinite(item) ? String(item) : item;
    });
}

/** Das Ergebnis in Teilen, damit eine Abweichung sagt, WO: Wegpunkte, Etappen, Abschnitte samt Linien, Zahlen, alles. */
function teile(outcome: RouteOutcome): Record<string, string> {
    if (!outcome.ok) return { ergebnis: bytesOf(outcome) };
    const route = outcome.response;
    return {
        wegpunkte: bytesOf(route.waypoints),
        etappen: bytesOf(route.legs),
        reiseplan: bytesOf(route.stages),
        abschnitte: bytesOf(route.segments),
        zahlen: bytesOf([
            route.found,
            route.distance_units,
            route.travel_hours,
            route.travel_days,
            route.rest_hours,
            route.total_hours,
            route.air_legs_units,
            route.departure,
            route.arrival,
            route.warnings,
        ]),
        alles: bytesOf(route),
    };
}

const abweichend = (referenz: Record<string, string>, jetzt: Record<string, string>): string[] =>
    Object.keys(referenz).filter((teil) => referenz[teil] !== jetzt[teil]);

describe("Determinismus des Flugs", () => {
    // Die Ergebnisse, gegen die alle Wiederholungen verglichen werden: ein frischer Dienst, jeder Fall einmal.
    const referenz = new Map<string, Record<string, string>>();
    const ausgang = new Map<string, RouteOutcome>();

    beforeAll(async () => {
        const dienst = frischerDienst();
        for (const fall of FAELLE) {
            const outcome = await dienst.route(fall.query);
            ausgang.set(fall.name, outcome);
            referenz.set(fall.name, teile(outcome));
        }
    });

    it("die Fälle sind, was sie sein sollen: rein, gemischt, mit Umweg, am Budget", () => {
        const linie = (name: string): number[] => {
            const outcome = ausgang.get(name);
            if (!outcome?.ok) throw new Error(`${name}: Route erwartet`);
            return outcome.response.segments.map((segment) => (segment.geometry.coordinates as unknown[]).length);
        };
        // Rein: nur Luftlinien.
        expect(linie("rein: Greif A-C-E")).toEqual([2, 2]);
        expect(linie("rein: Greif G-B, 24 Stunden, Reisebeginn")).toEqual([2]);
        // Gemischt: Gipfel und Wand kosten Knicke; der wiederholte Wegpunkt hat keinen Abschnitt, D nach E und E nach H
        // sind frei. Die Sperren liegen auf den Etappen A-B, B-C und C-D.
        const gemischt = linie("gemischt: Hexe A-B-B-C-D-E-H-I");
        expect(gemischt).toHaveLength(6);
        expect(gemischt.filter((punkte) => punkte === 2).length).toBeGreaterThanOrEqual(2);
        expect(gemischt.filter((punkte) => punkte > 2).length).toBeGreaterThanOrEqual(3);
        // Umweg.
        for (const name of [
            "umweg: Hexe C-D",
            "umweg: Hexe D-C",
            "umweg: Hexe A-B um den Gipfel",
            "umweg: eigenes Flugmittel C-D mit Reisebeginn",
        ]) {
            expect(Math.max(...linie(name)), name).toBeGreaterThan(2);
        }
        // Am Budget: 20 werden gerechnet, 21 abgewiesen.
        expect(linie("Budget: 20 suchende Etappen")).toHaveLength(ROUTE_FLIGHT_SEARCH_LIMIT);
        expect(ausgang.get("Budget: 21 suchende Etappen")).toEqual({
            ok: false,
            error: "route_too_large",
            detail: `flight_legs:${String(ROUTE_FLIGHT_SEARCH_LIMIT + 1)}`,
        });
    });

    it("🔴 sechs Läufe auf einem warmen Dienst, jedes Mal in anderer Reihenfolge: byteidentisch", async () => {
        const dienst = frischerDienst();
        for (let lauf = 1; lauf <= 6; lauf += 1) {
            // Wechselnde Reihenfolge, dazwischen jedes Mal auch die anderen Fälle: Zwischenspeicher, die von der
            // Vorgeschichte abhängen, fielen hier auf.
            for (const fall of shuffled(FAELLE, lauf * 7919)) {
                const jetzt = teile(await dienst.route(fall.query));
                expect(
                    abweichend(referenz.get(fall.name) as Record<string, string>, jetzt),
                    `${fall.name}, Lauf ${String(lauf)}`,
                ).toEqual([]);
            }
        }
    });

    it("🔴 derselbe Fall fünfmal hintereinander und mit den übrigen dazwischen: byteidentisch", async () => {
        const dienst = frischerDienst();
        for (const fall of FAELLE) {
            for (let wiederholung = 1; wiederholung <= 5; wiederholung += 1) {
                const jetzt = teile(await dienst.route(fall.query));
                expect(
                    abweichend(referenz.get(fall.name) as Record<string, string>, jetzt),
                    `${fall.name} x${String(wiederholung)}`,
                ).toEqual([]);
                // Eine andere Anfrage dazwischen: derselbe Dienst, dasselbe Gelände.
                const anderer = FAELLE[(FAELLE.indexOf(fall) + wiederholung) % FAELLE.length] as Fall;
                await dienst.route(anderer.query);
            }
        }
    });

    it("🔴 ein frischer Dienst mit frisch gebautem Gelände rechnet dasselbe wie ein aufgewärmter", async () => {
        for (const lauf of [1, 2, 3]) {
            const dienst = frischerDienst();
            for (const fall of shuffled(FAELLE, lauf * 104729).reverse()) {
                const jetzt = teile(await dienst.route(fall.query));
                expect(
                    abweichend(referenz.get(fall.name) as Record<string, string>, jetzt),
                    `${fall.name}, frisch ${String(lauf)}`,
                ).toEqual([]);
            }
        }
    });
});

describe("Determinismus der Umwege (air-way.ts)", () => {
    const grenze = 800;
    const punkt = (id: string, x: number, y: number): AirPoint => ({ id, name: id, x, y });
    const paare: [AirPoint, AirPoint][] = [
        [punkt("c", 20, 50), punkt("d", 80, 50)],
        [punkt("d", 80, 50), punkt("c", 20, 50)],
        [punkt("a", 20, 20), punkt("b", 80, 20)],
        [punkt("f", 50, 42), punkt("e", 50, 90)],
    ];

    it("🔴 flyAround liefert Punkte, Länge, Sperre, Suchen, Zellen und Byte gleich, in jeder Reihenfolge und auf frischem Gelände", () => {
        const rechne = (terrain: ReturnType<typeof airTerrain>, index: number): string => {
            const [from, to] = paare[index] as [AirPoint, AirPoint];
            const bounds = boundsAbove(terrain, grenze);
            if (!bounds) throw new Error("Gelände über der Grenze erwartet");
            return bytesOf(flyAround(terrain, grenze, from, to, bounds));
        };
        const referenzen = paare.map((_, index) => rechne(airTerrain(gebirge(wand, [GIPFEL])), index));
        const warm = airTerrain(gebirge(wand, [GIPFEL]));
        for (let lauf = 1; lauf <= 6; lauf += 1) {
            for (const index of shuffled([...paare.keys()], lauf * 31)) {
                expect(rechne(warm, index), `Paar ${String(index)}, Lauf ${String(lauf)}`).toBe(referenzen[index]);
                expect(
                    rechne(airTerrain(gebirge(wand, [GIPFEL])), index),
                    `Paar ${String(index)}, frisch ${String(lauf)}`,
                ).toBe(referenzen[index]);
            }
        }
    });

    it("🔴 ein Flug je Anfrage gibt seine Linie mehrfach dieselbe: gleiche Etappe, gleiches Feld, Rückweg eine eigene Etappe", () => {
        const terrain = airTerrain(gebirge(wand, [GIPFEL]));
        const flight = mountainAirFlight(terrain, grenze);
        const [c, d] = paare[0] as [AirPoint, AirPoint];
        const [a, b] = paare[2] as [AirPoint, AirPoint];
        const hin = bytesOf(flight.way(c, d));
        for (let wiederholung = 0; wiederholung < 5; wiederholung += 1) {
            expect(bytesOf(flight.way(c, d))).toBe(hin);
            // Dazwischen andere Etappen und der Rückweg.
            flight.way(d, c);
            flight.way(a, b);
        }
        // Ein zweiter Flug derselben Anfrageart rechnet die Linie von vorn und kommt zu denselben Bytes.
        expect(bytesOf(mountainAirFlight(terrain, grenze).way(c, d))).toBe(hin);
    });
});
