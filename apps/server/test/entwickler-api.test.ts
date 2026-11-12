import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ALTE_API_WEGE,
    ENTWICKLER_API_FEHLER,
    ENTWICKLER_DOKU_URL,
    EntwicklerRoute,
    type RouteResponse,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { RouteRunner, RunOutcome } from "../src/routing/runner.ts";
import {
    nearestWaypoint,
    rankWaypoints,
    resolveWaypoints,
    waypointsById,
    type WaypointIndex,
    type WaypointPlace,
} from "../src/routing/waypoints.ts";
import type { SubjectService } from "../src/subjects/service.ts";

/**
 * Die Entwickler-API, Fassung 1 (WI-0303 P7): der Vertrag nach außen über Stub-Diensten, ohne Datenbank. Die Orte-Liste liest die
 * Datenbank selbst; ihre Abfrage ist dieselbe wie die des Wegpunkt-Index und wird hier nur ohne Datenbank (503) geprüft.
 */

const GARETH = "11111111-1111-4111-8111-111111111111";
const PERRICUM = "22222222-2222-4222-8222-222222222222";
const VERBORGEN = "33333333-3333-4333-8333-333333333333";
const HARTSTEEN = "44444444-4444-4444-8444-444444444444";

const ort = (id: string, name: string, over: Partial<WaypointPlace> = {}): WaypointPlace => ({
    id,
    name,
    subtype: "stadt",
    hidden: false,
    x: 500,
    y: 500,
    ...over,
});

const ORTE: WaypointPlace[] = [
    ort(GARETH, "Gareth", { subtype: "metropole", x: 512.5, y: 480.25 }),
    ort(PERRICUM, "Perricum", { x: 600, y: 470 }),
    ort(HARTSTEEN, "Hartsteen", { subtype: "dorf" }),
    ort(VERBORGEN, "Geheimdorf", { hidden: true }),
];
const LANDMARKE: WaypointPlace = {
    ...ort("l:55555555-5555-4555-8555-555555555555", "Garethhöhle"),
    landmark: "hoehle",
} as WaypointPlace;

const index: WaypointIndex = {
    lookup: async (q, limit) => ({ query: q, ...rankWaypoints([...ORTE, LANDMARKE], q, limit) }),
    resolve: async (names) => resolveWaypoints(ORTE, names),
    byIds: async (ids) => waypointsById([...ORTE, LANDMARKE], ids),
    nearest: async (x, y) => nearestWaypoint(ORTE, x, y),
};

const subjects = {
    detail: vi.fn(async () => ({
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gareth", title: "Gareth", corpus: { key: "wiki-aventurica" } },
        context: {
            territories: {
                relation: "within",
                chains: [
                    [
                        { ref: { kind: "territory", id: "t-reich" }, name: "Mittelreich", type: "kaiserreich" },
                        { ref: { kind: "territory", id: "t-gareth" }, name: "Kaisermark Gareth" },
                    ],
                ],
            },
        },
    })),
} as unknown as SubjectService;

const ROUTE = {
    found: true,
    waypoints: [
        { id: GARETH, name: "Gareth" },
        { id: PERRICUM, name: "Perricum" },
    ],
    segments: [
        {
            geometry: {
                type: "LineString",
                coordinates: [
                    [512.5, 480.25],
                    [550, 475],
                ],
            },
        },
        {
            geometry: {
                type: "LineString",
                coordinates: [
                    [550, 475],
                    [600, 470],
                ],
            },
        },
    ],
    stages: [
        {
            type: "Reichsstrasse",
            transport: "groupFoot",
            path_names: ["Reichsstraße 3"],
            from: { x: 512.5, y: 480.25 },
            to: { x: 600, y: 470 },
            distance_units: 35.123,
            travel_hours: 26.3456,
            rest_hours: 16,
        },
    ],
    distance_units: 35.123,
    miles_per_unit: 3,
    travel_hours: 26.3456,
    rest_hours: 16,
    total_hours: 42.3456,
    travel_days: 3.29,
    hours_per_day: 8,
    warnings: ["cross_country"],
} as unknown as RouteResponse;

function runner(outcome: RunOutcome): RouteRunner & { run: ReturnType<typeof vi.fn> } {
    return {
        run: vi.fn(async () => outcome),
        warm: () => undefined,
        status: () => ({ state: "ready", ageMs: 0 }),
        close: async () => undefined,
    } as unknown as RouteRunner & { run: ReturnType<typeof vi.fn> };
}

const config = { ...loadConfig(), databaseUrl: undefined };

describe("Entwickler-API v1", () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    it("liest einen Ort mit Wiki-Artikel und Gebieten, offen für jede Herkunft", async () => {
        app = buildApp({ config, waypointIndex: index, subjects });
        const antwort = await app.inject({
            method: "GET",
            url: `/api/v1/orte/${GARETH.toUpperCase()}`,
            headers: { origin: "https://fremd.example" },
        });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["access-control-allow-origin"]).toBe("*");
        expect(antwort.headers["cache-control"]).toBe("public, max-age=60");
        expect(antwort.json()).toEqual({
            vertrag: 1,
            id: GARETH,
            name: "Gareth",
            art: "metropole",
            x: 512.5,
            y: 480.25,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Gareth", titel: "Gareth" },
            gebiete: [
                [
                    { id: "t-reich", name: "Mittelreich", art: "kaiserreich" },
                    { id: "t-gareth", name: "Kaisermark Gareth" },
                ],
            ],
        });
    });

    it("kennt einen unbekannten Ort und eine falsche Kennung nur im Umschlag, auch dann mit CORS", async () => {
        app = buildApp({ config, waypointIndex: index, subjects });
        const fehlt = await app.inject({ method: "GET", url: "/api/v1/orte/99999999-9999-4999-8999-999999999999" });
        expect(fehlt.statusCode).toBe(404);
        expect(fehlt.json()).toEqual({ error: { code: "not_found", message: "Diesen Ort gibt es nicht." } });
        expect(fehlt.headers["access-control-allow-origin"]).toBe("*");

        const falsch = await app.inject({ method: "GET", url: "/api/v1/orte/gareth" });
        expect(falsch.statusCode).toBe(400);
        expect(falsch.json().error.code).toBe("validation_failed");
        expect(falsch.headers["access-control-allow-origin"]).toBe("*");
    });

    it("sucht nur sichtbare Orte, keine Landmarken, und sagt, ob es mehr gibt", async () => {
        app = buildApp({ config, waypointIndex: index });
        const antwort = await app.inject({ method: "GET", url: "/api/v1/suche?q=gare" });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("public, max-age=60");
        expect(antwort.json()).toEqual({
            vertrag: 1,
            anfrage: "gare",
            treffer: [{ id: GARETH, name: "Gareth", art: "metropole", x: 512.5, y: 480.25 }],
            gekuerzt: false,
        });
        const verborgen = await app.inject({ method: "GET", url: "/api/v1/suche?q=geheim" });
        expect(verborgen.json().treffer).toEqual([]);

        const knapp = await app.inject({ method: "GET", url: "/api/v1/suche?q=e&limit=1" });
        expect(knapp.json().treffer).toEqual([]);
        const zwei = await app.inject({ method: "GET", url: "/api/v1/suche?q=ha&limit=1" });
        expect(zwei.json()).toMatchObject({ treffer: [{ name: "Hartsteen" }], gekuerzt: false });
    });

    it("rechnet eine Route über Namen und Kennungen und gibt die schmale Sicht zurück", async () => {
        const wegfindung = runner({ ok: true, response: ROUTE });
        app = buildApp({ config, waypointIndex: index, routeRunner: wegfindung });
        const antwort = await app.inject({
            method: "GET",
            url: `/api/v1/route?von=gareth&nach=${PERRICUM}&ueber=Hartsteen&optimierung=kuerzeste&wege=land,see`,
        });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["access-control-allow-origin"]).toBe("*");
        const route: unknown = antwort.json();
        expect(Value.Check(EntwicklerRoute, route)).toBe(true);
        expect(route).toEqual({
            vertrag: 1,
            gefunden: true,
            orte: [
                { id: GARETH, name: "Gareth" },
                { id: PERRICUM, name: "Perricum" },
            ],
            meilen: 105.37,
            reisestunden: 26.35,
            raststunden: 16,
            gesamtstunden: 42.35,
            reisetage: 3.29,
            stundenProTag: 8,
            etappen: [
                {
                    art: "Reichsstrasse",
                    mittel: "groupFoot",
                    wege: ["Reichsstraße 3"],
                    von: { x: 512.5, y: 480.25 },
                    nach: { x: 600, y: 470 },
                    meilen: 105.37,
                    reisestunden: 26.35,
                    raststunden: 16,
                },
            ],
            linie: [
                [512.5, 480.25],
                [550, 475],
                [600, 470],
            ],
            hinweise: ["querfeldein"],
        });
        expect(wegfindung.run).toHaveBeenCalledWith(
            expect.objectContaining({
                waypoints: [GARETH, HARTSTEEN, PERRICUM],
                optimize: "shortest",
                enabled: { land: true, river: false, sea: true },
            }),
        );
    });

    it("findet einen verborgenen Ort nur über seine Kennung, nie über den Namen", async () => {
        const wegfindung = runner({ ok: true, response: ROUTE });
        app = buildApp({ config, waypointIndex: index, routeRunner: wegfindung });
        const name = await app.inject({ method: "GET", url: "/api/v1/route?von=Gareth&nach=Geheimdorf" });
        expect(name.statusCode).toBe(404);
        expect(name.json().error).toMatchObject({ code: "place_not_found", details: { feld: "nach" } });

        const halt = await app.inject({
            method: "GET",
            url: "/api/v1/route?von=Gareth&nach=Perricum&ueber=Hartsteen~Nirgendwo",
        });
        expect(halt.json().error).toMatchObject({ code: "place_not_found", details: { feld: "ueber", index: 1 } });

        const kennung = await app.inject({ method: "GET", url: `/api/v1/route?von=Gareth&nach=${VERBORGEN}` });
        expect(kennung.statusCode).toBe(200);
    });

    it("weist zu viele Zwischenhalte ab und meldet eine ausgelastete Wegfindung mit Retry-After", async () => {
        app = buildApp({ config, waypointIndex: index, routeRunner: runner({ ok: false, error: "routing_busy" }) });
        const viele = Array.from({ length: 11 }, () => "Hartsteen").join("~");
        const zuViele = await app.inject({
            method: "GET",
            url: `/api/v1/route?von=Gareth&nach=Perricum&ueber=${viele}`,
        });
        expect(zuViele.statusCode).toBe(400);
        expect(zuViele.json().error.code).toBe("validation_failed");

        const besetzt = await app.inject({ method: "GET", url: "/api/v1/route?von=Gareth&nach=Perricum" });
        expect(besetzt.statusCode).toBe(503);
        expect(besetzt.headers["retry-after"]).toBe("2");
        expect(besetzt.json().error.code).toBe("routing_unavailable");
    });

    it("antwortet ohne Datenbank mit 503 im Umschlag", async () => {
        app = buildApp({ config });
        for (const url of [
            "/api/v1/orte",
            `/api/v1/orte/${GARETH}`,
            "/api/v1/suche?q=ga",
            "/api/v1/route?von=a&nach=b",
        ]) {
            const antwort = await app.inject({ method: "GET", url });
            expect(antwort.statusCode, url).toBe(503);
            expect(antwort.json().error.code, url).toBe("database_unavailable");
            expect(antwort.headers["retry-after"], url).toBe("5");
        }
    });

    it("schickt die alte Legacy-API mit 410 zur neuen, auch mit Formulardaten", async () => {
        app = buildApp({ config });
        for (const alt of ALTE_API_WEGE) {
            const antwort = await app.inject({
                method: alt.methode,
                url: alt.pfad,
                ...(alt.methode === "POST"
                    ? {
                          headers: { "content-type": "application/x-www-form-urlencoded" },
                          payload: "from=Gareth&to=Tuzak",
                      }
                    : {}),
            });
            expect(antwort.statusCode, alt.pfad).toBe(410);
            expect(antwort.headers["access-control-allow-origin"], alt.pfad).toBe("*");
            expect(antwort.json().error, alt.pfad).toMatchObject({
                code: "api_gone",
                details: { doku: ENTWICKLER_DOKU_URL, nachfolger: alt.nachfolger },
            });
        }
    });

    it("beantwortet die Vorabfrage eines Browsers, aber nicht für die Karten-API mit Schlüssel", async () => {
        app = buildApp({ config });
        const vorab = await app.inject({
            method: "OPTIONS",
            url: "/api/route/",
            headers: { origin: "https://fremd.example" },
        });
        expect(vorab.statusCode).toBe(204);
        expect(vorab.headers["access-control-allow-origin"]).toBe("*");
        expect(vorab.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");

        const karten = await app.inject({ method: "GET", url: "/api/v1/karten" });
        expect(karten.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("liefert den Vertrag als OpenAPI 3.1 mit den vier Wegen und kennt jeden Fehlercode der Doku", async () => {
        app = buildApp({ config });
        const antwort = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
        expect(antwort.statusCode).toBe(200);
        const vertrag = antwort.json<{ openapi: string; paths: Record<string, unknown> }>();
        expect(vertrag.openapi).toBe("3.1.0");
        expect(Object.keys(vertrag.paths)).toEqual(
            expect.arrayContaining(["/api/v1/orte", "/api/v1/orte/{id}", "/api/v1/suche", "/api/v1/route"]),
        );
        expect(JSON.stringify(vertrag)).not.toContain("/api/v1/karten");
        expect(Object.keys(ENTWICKLER_API_FEHLER).sort()).toEqual(
            [
                "api_gone",
                "database_unavailable",
                "not_found",
                "place_not_found",
                "route_too_large",
                "routing_unavailable",
                "server_busy",
                "validation_failed",
            ].sort(),
        );
    });
});
