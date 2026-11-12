import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { foldName } from "@avesmaps3d/shared";
import {
    nearestWaypoint,
    rankWaypoints,
    resolveWaypoints,
    waypointsById,
    type WaypointIndex,
    type WaypointPlace,
} from "../src/routing/waypoints.ts";

/**
 * Die Wegpunktsuche des Planers (WI-0017, Schritt 2): Legacys Rangfolge, aber mit Akzenten und ß
 * egal, und versteckte Orte mit Vermerk (Betreiber 2026-09-23: wie Legacy).
 */

const ort = (name: string, over: Partial<WaypointPlace> = {}): WaypointPlace => ({
    id: name.toLowerCase(),
    name,
    subtype: "dorf",
    hidden: false,
    x: 0,
    y: 0,
    ...over,
});

const names = (places: WaypointPlace[], query: string, limit = 20): string[] =>
    rankWaypoints(places, query, limit).hits.map((hit) => hit.name);

describe("Wegpunktsuche", () => {
    it("faltet Akzente und ß, damit „Garen“ Garèn und „Strasse“ die Straße findet", () => {
        expect(foldName("Garèn")).toBe("garen");
        expect(foldName("Paßwacht")).toBe("passwacht");
        expect(names([ort("Garèn"), ort("Paßwacht")], "garen")).toEqual(["Garèn"]);
        expect(names([ort("Garèn"), ort("Paßwacht")], "Passw")).toEqual(["Paßwacht"]);
    });

    it("ordnet wie Legacys Planer: exakt, Anfang, Wortanfang, enthält - dann alphabetisch", () => {
        const places = [ort("Hoijangar"), ort("Alt-Garnelen"), ort("Gareth"), ort("Garbeln"), ort("Gar")];
        expect(names(places, "gar")).toEqual(["Gar", "Garbeln", "Gareth", "Alt-Garnelen", "Hoijangar"]);
    });

    it("liefert versteckte Orte mit, als solche gekennzeichnet", () => {
        const { hits } = rankWaypoints([ort("Feenplatz", { hidden: true })], "feen", 20);
        expect(hits).toEqual([expect.objectContaining({ name: "Feenplatz", hidden: true })]);
    });

    it("sucht erst ab zwei Zeichen und sagt, ob es mehr gäbe", () => {
        expect(rankWaypoints([ort("Gareth")], "g", 20)).toEqual({ hits: [], truncated: false });
        const viele = Array.from({ length: 25 }, (_, index) => ort(`Garten ${String(index)}`));
        expect(rankWaypoints(viele, "garten", 20)).toMatchObject({ truncated: true });
        expect(rankWaypoints(viele, "garten", 20).hits).toHaveLength(20);
    });
});

describe("Namen aus einem Link auflösen", () => {
    it("nimmt den Namen, wie er geschrieben ist, sonst ohne Akzente - aber nur eindeutig", () => {
        const places = [ort("Gareth"), ort("Garèn"), ort("Perricum")];
        expect(resolveWaypoints(places, ["Gareth", "perricum", "Garen"]).map((hit) => hit?.name ?? null)).toEqual([
            "Gareth",
            "Perricum",
            "Garèn",
        ]);
    });

    it("🔴 lieber null als vielleicht der falsche Ort (Kap. 9.57)", () => {
        const places = [ort("Garen"), ort("Garèn"), ort("Punin")];
        // „garen" passt ohne Akzente auf zwei Orte, und genau so geschrieben auf keinen: null.
        expect(resolveWaypoints(places, ["garen", "Garèn", "Nirgendwo"]).map((hit) => hit?.name ?? null)).toEqual([
            null,
            "Garèn",
            null,
        ]);
    });
});

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

describe("Der nächste Ort zu einem Kartenpunkt", () => {
    it("nimmt den nächsten sichtbaren Ort - ein versteckter wird nicht verraten", () => {
        const places = [
            ort("Feenplatz", { x: 1, y: 0, hidden: true }),
            ort("Gareth", { x: 5, y: 0 }),
            ort("Perricum", { x: 20, y: 0 }),
        ];
        const near = nearestWaypoint(places, 0, 0);
        expect(near.place?.name).toBe("Gareth");
        expect(near.distance).toBeCloseTo(5, 9);
        expect(nearestWaypoint([], 0, 0)).toEqual({ place: null, distance: null });
    });
});

describe("GET /api/route/waypoints", () => {
    const config = { ...loadConfig(), databaseUrl: undefined };

    it("antwortet im Vertrag, und ohne Datenbank mit 503", async () => {
        const index: WaypointIndex = {
            lookup: async (query, limit) => ({ query, ...rankWaypoints([ort("Gareth")], query, limit) }),
            resolve: async (names) => resolveWaypoints([ort("Gareth"), ort("Perricum")], names),
            byIds: async (ids) => waypointsById([ort("Gareth"), ort("Perricum")], ids),
            nearest: async (x, y) => nearestWaypoint([ort("Gareth", { x: 10, y: 10 })], x, y),
        };
        app = buildApp({ config, waypointIndex: index });
        const response = await app.inject({ method: "GET", url: "/api/route/waypoints?q=gar" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            query: "gar",
            hits: [{ id: "gareth", name: "Gareth", subtype: "dorf", hidden: false, x: 0, y: 0 }],
            truncated: false,
        });

        const nearest = await app.inject({ method: "GET", url: "/api/route/waypoints/nearest?x=12&y=10" });
        expect(nearest.statusCode).toBe(200);
        expect(nearest.json()).toMatchObject({ place: { name: "Gareth" }, distance: 2 });

        const resolved = await app.inject({
            method: "GET",
            url: "/api/route/waypoints/resolve?names=Gareth~Nirgendwo",
        });
        expect(resolved.statusCode).toBe(200);
        expect(resolved.json()).toEqual({
            places: [{ id: "gareth", name: "Gareth", subtype: "dorf", hidden: false, x: 0, y: 0 }, null],
        });
        await app.close();

        app = buildApp({ config });
        const ohne = await app.inject({ method: "GET", url: "/api/route/waypoints?q=gar" });
        expect(ohne.statusCode).toBe(503);
    });

    it("weist eine zu lange Eingabe, ein fremdes Limit oder mehr als 100 Namen ab", async () => {
        const index: WaypointIndex = {
            lookup: async (query) => ({ query, hits: [], truncated: false }),
            resolve: async (names) => names.map(() => null),
            byIds: async (ids) => ids.map(() => null),
            nearest: async () => ({ place: null, distance: null }),
        };
        app = buildApp({ config, waypointIndex: index });
        const vieleNamen = Array.from({ length: 101 }, () => "A").join("~");
        expect(
            (await app.inject({ method: "GET", url: `/api/route/waypoints/resolve?names=${vieleNamen}` })).statusCode,
        ).toBe(400);
        await app.close();
        app = buildApp({ config, waypointIndex: index });
        // Ein fremdes Limit ist eines über der größten Zahl, die die Systemsteuerung erlauben kann (100, WI-0214); darunter
        // nimmt das Schema es an, und der Handler deckelt es auf den eingestellten Wert.
        for (const url of [`/api/route/waypoints?q=${"a".repeat(101)}`, "/api/route/waypoints?q=gar&limit=101"]) {
            expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(400);
        }
    });
});
