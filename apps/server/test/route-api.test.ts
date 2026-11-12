import { afterEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    airCeilingAbsolute,
    airMaxAboveGround,
    prepareBorderTerritory,
    type SeasonWindow,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { buildRouteNetwork } from "../src/routing/network.ts";
import { createInlineRunner, type RouteRunner, type RunOutcome } from "../src/routing/runner.ts";
import { RouteService, type RouteQuery } from "../src/routing/service.ts";
import { keyOf, revisionOf } from "./support/routing-revision.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { NO_WATER } from "../src/routing/water.ts";
import type { TollTerritories } from "../src/routing/toll-territories.ts";

/**
 * Der Routenendpunkt (WI-0017 R6): prüft die Adresse, ergänzt Legacys Vorgaben und übersetzt das
 * Ergebnis in HTTP. Die Rechnung selbst prüfen `route-service.test.ts` und `router.test.ts`.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };

/** Eine Steuerung, die jede Anfrage festhält und eine vorgegebene Antwort gibt. */
function recorder(outcome: RunOutcome): RouteRunner & { queries: RouteQuery[] } {
    const queries: RouteQuery[] = [];
    return {
        queries,
        run: async (query) => {
            queries.push(query);
            return outcome;
        },
        warm() {},
        status: () => ({ state: "ready", ageMs: 0 }),
        async close() {},
    };
}

let app: FastifyInstance | undefined;
let appRunner: RouteRunner | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
    appRunner = undefined;
});

/**
 * Eine App je Test und Steuerung, nicht je Anfrage: Mit allen Routen (seit WI-0120 auch Anmeldung, Konto und Verwaltung) kostet der Bau
 * einige hundert Millisekunden, und ein Test mit fünfzehn Anfragen lief über die 5 s. Die vorige App wird geschlossen, statt liegen
 * zu bleiben.
 */
async function get(url: string, runner?: RouteRunner) {
    if (app === undefined || appRunner !== runner) {
        await app?.close();
        app = buildApp(runner ? { config, routeRunner: runner } : { config });
        appRunner = runner;
    }
    return app.inject({ method: "GET", url });
}

describe("GET /api/route", () => {
    it("ergänzt Legacys Vorgaben und schreibt die Kennungen klein", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A.toUpperCase()},${B}`, runner);
        expect(runner.queries[0]).toEqual({
            // Wer fragt, zählt für die Drossel je Client (S-04).
            client: "127.0.0.1",
            waypoints: [A, B],
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: true, sea: true },
            minimizeTransfers: false,
            // Eiltempo (WI-0078) ist aus, solange die Adresse nichts sagt: Ein alter Aufruf behält sein Tempo.
            hurry: false,
            hoursPerDay: 8,
        });
    });

    it("🔴 Eiltempo nur, wenn die Adresse es verlangt (WI-0078)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&hurry=true`, runner);
        expect(runner.queries[0]).toMatchObject({ hurry: true });
        await get(`/api/route?waypoints=${A},${B}&hurry=false`, runner);
        expect(runner.queries[1]).toMatchObject({ hurry: false });
    });

    it("🔴 nimmt den früheren Seewege-Schalter an, damit alte Links gehen, und übergeht ihn (WI-0153 Schnitt 7e)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&sea_routing=seaways`, runner);
        expect(runner.queries[0]).not.toHaveProperty("seaRouting");
        expect((await get(`/api/route?waypoints=${A},${B}&sea_routing=frei`, runner)).statusCode).toBe(400);
        expect(runner.queries).toHaveLength(1);
    });

    it("liest die Reisestunden pro Tag in halben Stunden, zwischen 0,5 und 24", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&hours_per_day=10.5`, runner);
        expect(runner.queries[0]).toMatchObject({ hoursPerDay: 10.5 });
        for (const value of ["0", "24.5", "7.3", "acht"]) {
            const url = `/api/route?waypoints=${A},${B}&hours_per_day=${value}`;
            expect((await get(url, runner)).statusCode, url).toBe(400);
        }
        expect(runner.queries).toHaveLength(1);
    });

    it("liest den Reisebeginn als Monat und Tag; auch die Namenlosen Tage sind ein Aufbruch (WI-0038, Betreiber 2026-11-07)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&start_month=firun&start_day=12`, runner);
        await get(`/api/route?waypoints=${A},${B}&start_month=praios`, runner);
        await get(`/api/route?waypoints=${A},${B}&start_month=namenlos&start_day=3`, runner);
        // Ein Tag ohne Monat ist kein Reisebeginn (Legacy: startDay nur mit startMonth).
        await get(`/api/route?waypoints=${A},${B}&start_day=5`, runner);
        expect(runner.queries.map((query) => query.departure)).toEqual([
            { month: "firun", day: 12 },
            { month: "praios", day: 1 },
            { month: "namenlos", day: 3 },
            undefined,
        ]);
        for (const query of [
            "start_month=Firun",
            "start_month=firun&start_day=31",
            "start_month=namenlos&start_day=6",
        ]) {
            const url = `/api/route?waypoints=${A},${B}&${query}`;
            expect((await get(url, runner)).statusCode, url).toBe(400);
        }
        expect(runner.queries).toHaveLength(4);
    });

    it("🔴 ohne air reicht die Anfrage keinen Flug weiter (WI-0051)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&land=lightRider`, runner);
        expect(runner.queries).toHaveLength(1);
        expect(Object.keys(runner.queries[0] ?? {})).not.toContain("air");
    });

    it("liest den Flug: ein Flugmittel mit den Werten des Reisemodells oder ein eigenes (WI-0051)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(`/api/route?waypoints=${A},${B}&air=griffin`, runner);
        await get(`/api/route?waypoints=${A},${B}&air=custom&air_speed=12.5&air_altitude=3000`, runner);
        await get(`/api/route?waypoints=${A},${B}&air=custom&air_speed=40`, runner);
        // Die übrigen Optionen werden angenommen und reisen mit; der Flug beachtet sie nicht.
        await get(`/api/route?waypoints=${A},${B}&air=airship&domains=sea&optimize=shortest&hours_per_day=10`, runner);
        // Die Höhe über Grund folgt aus der Reisehöhe (Betreiber 2026-10-04), beim eigenen Flugmittel ebenso; die
        // absolute Höchstflughöhe ist für alle dieselbe.
        const reich = (altitude: number) => airMaxAboveGround(AVENTURIA_TRAVEL_MODEL, altitude);
        const decke = airCeilingAbsolute(AVENTURIA_TRAVEL_MODEL);
        expect(runner.queries.map((query) => query.air)).toEqual([
            {
                profile: "griffin",
                speedMph: 50,
                altitudeSchritt: 800,
                maxAboveGroundSchritt: reich(800),
                ceilingSchritt: decke,
            },
            {
                profile: "custom",
                speedMph: 12.5,
                altitudeSchritt: 3000,
                maxAboveGroundSchritt: reich(3000),
                ceilingSchritt: decke,
            },
            {
                profile: "custom",
                speedMph: 40,
                altitudeSchritt: 250,
                maxAboveGroundSchritt: reich(250),
                ceilingSchritt: decke,
            },
            {
                profile: "airship",
                speedMph: 12.5,
                altitudeSchritt: 1000,
                maxAboveGroundSchritt: reich(1000),
                ceilingSchritt: decke,
            },
        ]);
        expect(runner.queries[3]).toMatchObject({ hoursPerDay: 10, optimize: "shortest" });
    });

    it("🔴 eine eigene Höchstflughöhe liest die Adresse nicht: Sie folgt immer aus dem Reisemodell (F2, Betreiber 2026-10-04)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        // Fastify entfernt Unbekanntes aus der Adresse (removeAdditional), wie jeden fremden Parameter.
        await get(
            `/api/route?waypoints=${A},${B}&air=custom&air_speed=40&air_altitude=300&air_ceiling=99999&air_max_above_ground=99999`,
            runner,
        );
        expect(runner.queries[0]?.air).toEqual({
            profile: "custom",
            speedMph: 40,
            altitudeSchritt: 300,
            maxAboveGroundSchritt: airMaxAboveGround(AVENTURIA_TRAVEL_MODEL, 300),
            ceilingSchritt: airCeilingAbsolute(AVENTURIA_TRAVEL_MODEL),
        });
    });

    it("🔴 weist falsche Flugwerte mit 400 in Fastifys Form ab, bevor gerechnet wird (WI-0051)", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        for (const query of [
            "air=drache",
            "air=Griffin",
            "air=custom",
            "air=custom&air_speed=0.5",
            "air=custom&air_speed=1000",
            "air=custom&air_speed=12.55",
            "air=custom&air_speed=schnell",
            "air=custom&air_speed=40&air_altitude=0",
            "air=custom&air_speed=40&air_altitude=10000",
            "air=custom&air_speed=40&air_altitude=12.5",
            "air=griffin&air_speed=40",
            "air=griffin&air_altitude=900",
            "air_speed=40",
        ]) {
            const url = `/api/route?waypoints=${A},${B}&${query}`;
            const response = await get(url, runner);
            expect(response.statusCode, url).toBe(400);
            expect(response.json(), url).toMatchObject({ statusCode: 400, code: "FST_ERR_VALIDATION" });
        }
        expect(runner.queries).toHaveLength(0);
        const response = await get(`/api/route?waypoints=${A},${B}&air=custom&air_speed=12.55`, runner);
        expect(response.json()).toEqual({
            statusCode: 400,
            code: "FST_ERR_VALIDATION",
            error: "Bad Request",
            message: "querystring/air_speed must have at most 1 decimal places",
        });
    });

    it("nimmt bis zu 100 Wegpunkte an (Betreiber 2026-09-23), den 101. nicht", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        const hundert = Array.from({ length: 100 }, () => A).join(",");
        await get(`/api/route?waypoints=${hundert}`, runner);
        expect(runner.queries[0]?.waypoints).toHaveLength(100);
        expect((await get(`/api/route?waypoints=${hundert},${A}`, runner)).statusCode).toBe(400);
    });

    it("liest Wegarten, Mittel und Optionen aus der Adresse", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        await get(
            `/api/route?waypoints=${A},${B}&domains=land&land=lightRider&optimize=shortest&minimize_transfers=true`,
            runner,
        );
        expect(runner.queries[0]).toMatchObject({
            optimize: "shortest",
            transports: { land: "lightRider" },
            enabled: { land: true, river: false, sea: false },
            minimizeTransfers: true,
        });
    });

    it("🔴 weist eine unvollständige oder fremde Adresse ab, bevor gerechnet wird", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        const zuViele = Array.from({ length: 101 }, () => A).join(",");
        for (const url of [
            `/api/route?waypoints=${A}`,
            `/api/route?waypoints=${zuViele}`,
            `/api/route?waypoints=${A},kein-ort`,
            `/api/route?waypoints=${A},${B}&land=cargoShip`,
            `/api/route?waypoints=${A},${B}&domains=luft`,
        ]) {
            expect((await get(url, runner)).statusCode, url).toBe(400);
        }
        expect(runner.queries).toHaveLength(0);
    });

    it("ein unbekannter Ort ist 400 mit seiner Kennung", async () => {
        const response = await get(
            `/api/route?waypoints=${A},${B}`,
            recorder({ ok: false, error: "unknown_waypoint", detail: B }),
        );
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "unknown_waypoint", detail: B });
    });

    it("🪤 ausgelastet oder zu langsam ist 503 mit Retry-After, nicht 500", async () => {
        for (const error of ["routing_busy", "routing_timeout", "routing_failed"] as const) {
            const response = await get(`/api/route?waypoints=${A},${B}`, recorder({ ok: false, error }));
            expect(response.statusCode).toBe(503);
            expect(response.headers["retry-after"]).toBe("2");
            expect(response.json()).toEqual({ error });
        }
    });

    it("nimmt Kartenpunkte als Wegpunkt und beantwortet ihre Absage mit 422", async () => {
        const runner = recorder({ ok: false, error: "point_not_on_land", detail: "p:210:-100.5" });
        const response = await get(`/api/route?waypoints=${A},p:210:-100.5`, runner);
        expect(runner.queries[0]?.waypoints).toEqual([A, "p:210:-100.5"]);
        expect(response.statusCode).toBe(422);
        expect(response.json()).toEqual({ error: "point_not_on_land", detail: "p:210:-100.5" });
        // Mehr als drei Nachkommastellen oder eine dritte Zahl sind keine Kennung.
        expect((await get(`/api/route?waypoints=${A},p:1.2345:2`, runner)).statusCode).toBe(400);
        expect((await get(`/api/route?waypoints=${A},p:1:2:3`, runner)).statusCode).toBe(400);
    });

    it("🔴 S-04: höchstens 10 Kartenpunkte je Anfrage; der elfte ist 400, bevor gerechnet wird", async () => {
        const runner = recorder({ ok: false, error: "point_not_on_land", detail: "p:1:1" });
        const punkte = (n: number) => Array.from({ length: n }, (_, index) => `p:${String(index)}:1`).join(",");
        const zuViele = await get(`/api/route?waypoints=${A},${punkte(11)}`, runner);
        expect(zuViele.statusCode).toBe(400);
        expect(zuViele.json()).toEqual({ error: "too_many_map_points", detail: "11" });
        expect(runner.queries).toHaveLength(0);
        expect((await get(`/api/route?waypoints=${A},${punkte(10)}`, runner)).statusCode).toBe(422);
        expect(runner.queries).toHaveLength(1);
    });

    it("ohne Datenbank gibt es keine Route: 503", async () => {
        const response = await get(`/api/route?waypoints=${A},${B}`);
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "database_unavailable" });
    });

    /**
     * 💣 **Der Fall Solfurt** (Betreiber 2026-10-14, nachgebaut aus den Production-Daten). Die Galebra läuft 0,625 Einheiten
     * an Solfurt vorbei, ohne den Ort zu berühren — zu weit für den Ortskasten (±0,5) und tausendfach zu weit für den
     * Fangradius zwischen Wegenden (0,001). Der Ort hängt nur an seinem Landweg, und der Router kam auf den Fluss nicht
     * hinauf: Kaldenberg → Solfurt rechnete 219 statt 8,7 Einheiten.
     *
     * 🔴 Betreiber: „Wenn eine Domäne sonst unerreichbar ist, soll er versuchen zum nächsten Punkt querfeldein zu kommen.“
     * Hier nachgebaut im Kleinen: zwei Orte am Fluss, beide nur über einen Landweg angebunden, der Fluss 0,6 daneben.
     */
    it("🔴 eine sonst unerreichbare Domäne bekommt einen Anker querfeldein", async () => {
        const ort = (id: string, name: string, x: number, y: number) => ({
            id,
            name,
            kind: "place" as const,
            isHidden: false,
            x,
            y,
        });
        const weg = (publicId: string, name: string, subtype: string, points: [number, number][]) => ({
            public_id: publicId,
            name,
            subtype,
            coordinates: JSON.stringify({ type: "LineString", coordinates: points }),
            allowed_transports: null,
            transport_domain: null,
            flow_direction: null,
            flow_factor: null,
        });
        const quelle = {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network: buildRouteNetwork(
                    [ort(A, "Oben", 100, 100), ort(B, "Unten", 100, 120)],
                    [
                        // Der Fluss laeuft an BEIDEN Orten 0,6 vorbei - gerade zu weit fuer den Ortskasten.
                        weg("fluss", "Fluss", "Flussweg", [
                            [100.6, 100],
                            [100.6, 120],
                        ]),
                        // Der Landweg verbindet sie, aber ueber einen weiten Bogen nach Westen.
                        weg("landweg", "Landweg", "Strasse", [
                            [100, 100],
                            [60, 110],
                            [100, 120],
                        ]),
                    ],
                ),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        };
        const runner = createInlineRunner(
            new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: quelle }),
        );
        const response = await get(`/api/route?waypoints=${A},${B}&river=riverSailer`, runner);
        expect(response.statusCode).toBe(200);
        const route = response.json();
        expect(route.found).toBe(true);
        // Ueber den Fluss sind es rund 20 Einheiten plus zweimal 0,6 querfeldein; der Landbogen misst ueber 80.
        expect(route.distance_units).toBeLessThan(40);
        expect(route.segments.some((s: { path_name: string }) => s.path_name === "Fluss")).toBe(true);
    });

    it("liefert eine echte Route im Vertrag", async () => {
        const quelle = {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network: buildRouteNetwork(
                    [
                        { id: A, name: "Anfang", kind: "place" as const, isHidden: false, x: 100, y: 100 },
                        { id: B, name: "Ende", kind: "place" as const, isHidden: false, x: 110, y: 100 },
                    ],
                    [
                        {
                            public_id: "weg",
                            name: "Weg",
                            subtype: "Strasse",
                            coordinates: JSON.stringify({
                                type: "LineString",
                                coordinates: [
                                    [100, 100],
                                    [110, 100],
                                ],
                            }),
                            allowed_transports: null,
                            transport_domain: null,
                            flow_direction: null,
                            flow_factor: null,
                        },
                    ],
                ),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        };
        const runner = createInlineRunner(
            new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: quelle }),
        );
        const response = await get(`/api/route?waypoints=${A},${B}&domains=land`, runner);
        expect(response.statusCode).toBe(200);
        const route = response.json();
        expect(route).toMatchObject({ found: true, routing_graph_revision: keyOf("r1"), warnings: [] });
        expect(route.segments[0]).toMatchObject({ from_node: "Anfang", to_node: "Ende", subtype: "Strasse" });
        expect(route.waypoints).toEqual([
            { id: A, name: "Anfang" },
            { id: B, name: "Ende" },
        ]);
        // Eine Rechnung, auf dem Server: Etappe, Stunden, Rast und Drachenflug kommen fertig an.
        expect(route.stages).toHaveLength(1);
        expect(route.stages[0]).toMatchObject({
            leg_index: 0,
            segment_start: 0,
            segment_count: 1,
            type: "Strasse",
            transport: "groupFoot",
            from: { point: "place", place_id: A, name: "Anfang" },
            to: { point: "place", place_id: B, name: "Ende" },
            distance_units: 10,
        });
        // 10 Einheiten = 30 Meilen, Straße zu Fuß 4,4625 Meilen/h, mal Zeitfaktor 1,19: genau der 8-h-Tag
        // von „Wege des Entdeckers“, also keine Rast.
        expect(route.stages[0].travel_hours).toBeCloseTo((30 / 4.4625) * 1.19, 6);
        expect(route.segments[0].travel_hours).toBeCloseTo(route.travel_hours, 9);
        expect(route).toMatchObject({ hours_per_day: 8, rest_hours: 0, miles_per_unit: 3, air_legs_units: [10] });
        expect(route.total_hours).toBeCloseTo(route.travel_hours, 9);
    });

    it("liefert einen Flug im Vertrag: Echo, Flugabschnitte und Etappen (WI-0051)", async () => {
        const quelle = {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                // Kein Weg zwischen den Wegpunkten: Der Flug braucht keinen. Ein Weg abseits genügt der Prüfung des
                // Netzes vor der Aktivierung (M6: ohne Kanten wird ein Stand nie aktiv).
                network: buildRouteNetwork(
                    [
                        { id: A, name: "Anfang", kind: "place" as const, isHidden: false, x: 100, y: 100 },
                        { id: B, name: "Ende", kind: "place" as const, isHidden: false, x: 110, y: 100 },
                        { id: "c", name: "Abseits", kind: "place" as const, isHidden: false, x: 200, y: 200 },
                        { id: "d", name: "Weit ab", kind: "place" as const, isHidden: false, x: 210, y: 200 },
                    ],
                    [
                        {
                            public_id: "abseits",
                            name: "Abseits",
                            subtype: "Strasse",
                            coordinates: JSON.stringify({
                                type: "LineString",
                                coordinates: [
                                    [200, 200],
                                    [210, 200],
                                ],
                            }),
                            allowed_transports: null,
                            transport_domain: null,
                            flow_direction: null,
                            flow_factor: null,
                        },
                    ],
                ),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        };
        const runner = createInlineRunner(
            new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: quelle }),
        );
        const response = await get(`/api/route?waypoints=${A},${B},p:110:120&air=hippogriff`, runner);
        expect(response.statusCode).toBe(200);
        const route = response.json();
        expect(route).toMatchObject({
            found: true,
            air: {
                profile: "hippogriff",
                speed_mph: 40,
                altitude_schritt: 400,
                max_above_ground_schritt: airMaxAboveGround(AVENTURIA_TRAVEL_MODEL, 400),
                ceiling_schritt: airCeilingAbsolute(AVENTURIA_TRAVEL_MODEL),
            },
            distance_units: 30,
            air_legs_units: [10, 20],
            warnings: [],
        });
        // 10 Einheiten = 30 Meilen mit 40 Meilen/h, dann 20 Einheiten = 60 Meilen.
        expect(route.segments.map((segment: { travel_hours: number }) => segment.travel_hours)).toEqual([0.75, 1.5]);
        expect(route.segments[1]).toMatchObject({
            edge_id: `flug-${B}-p:110:120`,
            subtype: "Flug",
            transport_type: "hippogriff",
            to_node: "Kartenpunkt",
            public_id: "",
            path_name: "",
            synthetic: false,
            offroad: false,
            cost_factor: 1,
        });
        expect(route.stages).toHaveLength(2);
        expect(route.stages[1]).toMatchObject({
            type: "Flug",
            transport: "hippogriff",
            from: { point: "place", name: "Ende" },
            to: { point: "point", place_id: "p:110:120" },
        });
    });

    it("🔴 S-10: eine Route über der Antwortgrenze wird 422 route_too_large, mit dem, was überlief", async () => {
        const quelle = {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network: buildRouteNetwork(
                    [
                        { id: A, name: "Anfang", kind: "place" as const, isHidden: false, x: 100, y: 100 },
                        { id: B, name: "Ende", kind: "place" as const, isHidden: false, x: 110, y: 100 },
                    ],
                    [
                        {
                            public_id: "weg",
                            name: "Weg",
                            subtype: "Strasse",
                            coordinates: JSON.stringify({
                                type: "LineString",
                                coordinates: [
                                    [100, 100],
                                    [110, 100],
                                ],
                            }),
                            allowed_transports: null,
                            transport_domain: null,
                            flow_direction: null,
                            flow_factor: null,
                        },
                    ],
                ),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        };
        const service = (limits: { segments: number; stages: number }) =>
            createInlineRunner(
                new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: quelle, limits }),
            );
        // Hin und zurück, fünfmal: 9 Abschnitte, 9 Etappen.
        const hinUndHer = Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? A : B)).join(",");
        const url = `/api/route?waypoints=${hinUndHer}&domains=land`;
        const segments = await get(url, service({ segments: 8, stages: 1000 }));
        expect(segments.statusCode).toBe(422);
        expect(segments.json()).toEqual({ error: "route_too_large", detail: "segments:9" });
        const stages = await get(url, service({ segments: 4000, stages: 8 }));
        expect(stages.statusCode).toBe(422);
        expect(stages.json()).toEqual({ error: "route_too_large", detail: "stages:9" });
        // Mit der echten Grenze geht dieselbe Reise durch.
        expect((await get(url, service({ segments: 4000, stages: 1000 }))).statusCode).toBe(200);
    });

    it("🔴 liefert Reisebeginn, Sperre, Absage und Daten im Vertrag (WI-0038)", async () => {
        const sommer = { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 };
        const strecke = (
            id: string,
            coordinates: [number, number][],
            seasons: Record<string, SeasonWindow> | null,
        ) => ({
            public_id: id,
            name: id === "pass" ? "Hochpass" : id,
            subtype: "Strasse",
            coordinates: JSON.stringify({ type: "LineString", coordinates }),
            allowed_transports: null,
            transport_domain: null,
            flow_direction: null,
            flow_factor: null,
            transport_seasons: seasons,
        });
        const dienst = (umweg: boolean) =>
            createInlineRunner(
                new RouteService({
                    mapDomain: "aventuria",
                    model: AVENTURIA_TRAVEL_MODEL,
                    source: {
                        revision: async () => revisionOf("r1"),
                        load: async () => ({
                            network: buildRouteNetwork(
                                [
                                    { id: A, name: "Anfang", kind: "place" as const, isHidden: false, x: 100, y: 100 },
                                    { id: B, name: "Ende", kind: "place" as const, isHidden: false, x: 110, y: 100 },
                                    { id: "c", name: "Mitte", kind: "place" as const, isHidden: false, x: 105, y: 110 },
                                ],
                                [
                                    strecke(
                                        "pass",
                                        [
                                            [100, 100],
                                            [110, 100],
                                        ],
                                        { groupFoot: sommer },
                                    ),
                                    ...(umweg
                                        ? [
                                              strecke(
                                                  "ac",
                                                  [
                                                      [100, 100],
                                                      [105, 110],
                                                  ],
                                                  null,
                                              ),
                                              strecke(
                                                  "cb",
                                                  [
                                                      [105, 110],
                                                      [110, 100],
                                                  ],
                                                  null,
                                              ),
                                          ]
                                        : []),
                                ],
                            ),
                            water: NO_WATER,
                            land: NO_WATER,
                            rivers: NO_RIVERS,
                            ground: NO_GROUND,
                            climate: NO_CLIMATE,
                            revision: revisionOf("r1"),
                        }),
                    },
                }),
            );
        const ohne = (await get(`/api/route?waypoints=${A},${B}`, dienst(true))).json();
        expect(ohne.seasonal_ways).toMatchObject([{ path_name: "Hochpass", open_to: { month: "efferd", day: 30 } }]);
        const winter = await get(`/api/route?waypoints=${A},${B}&start_month=firun&start_day=3`, dienst(true));
        expect(winter.statusCode).toBe(200);
        const route = winter.json();
        expect(route.departure).toEqual({ month: "firun", day: 3, nameless: false, season: "winter", years_passed: 0 });
        expect(route.closures[0]).toMatchObject({ blocked: false, diverges_at_node: "Anfang" });
        expect(route.closures[0].avoided[0]).toMatchObject({ kind: "season", path_name: "Hochpass" });
        expect(route.stages[0].start_date).toMatchObject({ month: "firun", day: 3 });
        const zu = await get(`/api/route?waypoints=${A},${B}&start_month=firun`, dienst(false));
        expect(zu.statusCode).toBe(200);
        expect(zu.json()).toMatchObject({
            found: false,
            reason: "season_closed",
            closures: [{ blocked: true, actual: null }],
        });
    });
});

describe("🔴 travel_costs im Vertrag (WI-0065 U4): der Serialisierer lässt kein Feld still weg", () => {
    const C = "cccccccc-0000-4000-8000-000000000003";
    const D = "dddddddd-0000-4000-8000-000000000004";
    const strecke = (id: string, coordinates: [number, number][]) => ({
        public_id: id,
        name: id,
        subtype: "Strasse",
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    });
    const quadrat = (id: string, name: string, x0: number, x1: number, shortName?: string) => {
        const territory = prepareBorderTerritory({
            id,
            name,
            shortName,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [x0, 0],
                        [x1, 0],
                        [x1, 200],
                        [x0, 200],
                        [x0, 0],
                    ],
                ],
            },
        });
        if (territory === null) throw new Error("kein Polygon");
        return territory;
    };
    // West bis x = 150, Ost ab dort: die Straße von A nach B kreuzt die Grenze einmal. C und D liegen abseits.
    const gebiete: TollTerritories = {
        territories: [
            quadrat("west", "Großes Westreich am Meer", 0, 150, "Westreich"),
            quadrat("ost", "Ostreich", 150, 400),
        ],
        yearBf: 1049,
    };
    const dienst = (territories?: TollTerritories) =>
        createInlineRunner(
            new RouteService({
                mapDomain: "aventuria",
                model: AVENTURIA_TRAVEL_MODEL,
                source: {
                    revision: async () => revisionOf("r1"),
                    load: async () => ({
                        network: buildRouteNetwork(
                            [
                                { id: A, name: "Anfang", kind: "place" as const, isHidden: false, x: 100, y: 100 },
                                { id: B, name: "Ende", kind: "place" as const, isHidden: false, x: 250, y: 100 },
                                { id: C, name: "Abseits", kind: "place" as const, isHidden: false, x: 300, y: 300 },
                                { id: D, name: "Weit ab", kind: "place" as const, isHidden: false, x: 310, y: 300 },
                            ],
                            [
                                strecke("weg", [
                                    [100, 100],
                                    [250, 100],
                                ]),
                                strecke("abseits", [
                                    [300, 300],
                                    [310, 300],
                                ]),
                            ],
                        ),
                        water: NO_WATER,
                        land: NO_WATER,
                        rivers: NO_RIVERS,
                        ground: NO_GROUND,
                        climate: NO_CLIMATE,
                        ...(territories ? { territories } : {}),
                        revision: revisionOf("r1"),
                    }),
                },
            }),
        );

    it("die Kosten aller vier Stufen und die Grenzen kommen über HTTP an", async () => {
        const response = await get(`/api/route?waypoints=${A},${B}&domains=land`, dienst(gebiete));
        expect(response.statusCode).toBe(200);
        const costs = response.json().travel_costs;
        // Ein Feld ohne Schemaeintrag verschwände ohne Fehler: jedes einzeln prüfen.
        expect(costs).toBeDefined();
        expect(costs.territory_year_bf).toBe(1049);
        expect(costs.borders.count).toBe(1);
        expect(costs.borders.harbour_toll_unknown).toBe(false);
        expect(costs.borders.crossings).toHaveLength(1);
        expect(costs.borders.crossings[0]).toMatchObject({
            from: { id: "west", name: "Großes Westreich am Meer", short_name: "Westreich" },
            to: { id: "ost", name: "Ostreich", short_name: "Ostreich" },
            y: 100,
        });
        expect(costs.borders.crossings[0].x).toBeGreaterThanOrEqual(150);
        expect(costs.borders.crossings[0].x).toBeLessThan(151);
        expect(Object.keys(costs.by_lodging)).toEqual(["frei", "strohsack", "bett", "zimmer"]);
        // Zoll je Stufe: eine Grenze mal Tafel (1 H, 5 H, 1 D, 5 D).
        const toll = (level: string) =>
            costs.by_lodging[level].rows.find((row: { key: string }) => row.key === "tolls");
        expect([toll("frei"), toll("strohsack"), toll("bett"), toll("zimmer")]).toEqual([
            { key: "tolls", heller: 1, status: "SOURCE_RULE", count: 1 },
            { key: "tolls", heller: 5, status: "SOURCE_RULE", count: 1 },
            { key: "tolls", heller: 100, status: "SOURCE_RULE", count: 1 },
            { key: "tolls", heller: 500, status: "SOURCE_RULE", count: 1 },
        ]);
        expect(costs.by_lodging.bett).toMatchObject({ complete: true, mounts: 0 });
        expect(typeof costs.by_lodging.bett.total).toBe("number");
        expect(costs.by_lodging.bett.nights).toEqual({ inn: expect.any(Number), open: 0, aboard: 0 });
        // Größe: 2 KB bei zwei Grenzen in der Messung; hier eine.
        expect(JSON.stringify(costs).length).toBeLessThan(4096);
    });

    it("🔴 ohne abgeleitete Gebiete: Grenzen und Jahr null, der Zoll in jeder Stufe null und UNKNOWN - nie 0", async () => {
        for (const territories of [undefined, { territories: [], yearBf: null } satisfies TollTerritories]) {
            const response = await get(`/api/route?waypoints=${A},${B}&domains=land`, dienst(territories));
            const costs = response.json().travel_costs;
            expect(costs.borders).toBeNull();
            expect(costs.territory_year_bf).toBeNull();
            for (const level of ["frei", "strohsack", "bett", "zimmer"]) {
                expect(costs.by_lodging[level].rows.at(-1)).toEqual({
                    key: "tolls",
                    heller: null,
                    status: "UNKNOWN",
                    count: 0,
                });
                expect(costs.by_lodging[level].complete).toBe(false);
            }
        }
    });

    it("keine Route, keine Kosten: found false trägt kein travel_costs", async () => {
        // Nur Seewege erlaubt, und das Netz hat keine: keine Route.
        const response = await get(`/api/route?waypoints=${A},${B}&domains=sea`, dienst(gebiete));
        expect(response.statusCode).toBe(200);
        const route = response.json();
        expect(route).toMatchObject({ found: false, reason: "network_disconnected" });
        expect(route).not.toHaveProperty("travel_costs");
    });

    it("im Flug gibt es keine Kosten (Plan 6.37): kein travel_costs", async () => {
        const response = await get(`/api/route?waypoints=${A},${B}&air=hippogriff`, dienst(gebiete));
        expect(response.statusCode).toBe(200);
        const route = response.json();
        expect(route.found).toBe(true);
        expect(route).not.toHaveProperty("travel_costs");
    });

    it("der Request ändert sich nicht: die Unterbringung ist keine Angabe der Anfrage (der Planer schickt sie nie)", async () => {
        const plain = await get(`/api/route?waypoints=${A},${B}&domains=land`, dienst(gebiete));
        const withLodging = await get(`/api/route?waypoints=${A},${B}&domains=land&lodging=zimmer`, dienst(gebiete));
        expect(plain.statusCode).toBe(200);
        // Fastify lässt Unbekanntes aus der Adresse weg: dieselbe Antwort, dieselben vier Stufen.
        expect(withLodging.statusCode).toBe(200);
        expect(withLodging.json()).toEqual(plain.json());
    });
});
