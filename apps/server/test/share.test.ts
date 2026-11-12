import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_SERIES,
    canonicalSharePayload,
    ROUTE_DEFAULTS,
    SHARE_CODE_ALPHABET,
    SHARE_CODE_LENGTH,
    type SharePayload,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { isSameOrigin } from "../src/routes/share.ts";
import { waypointsById, type WaypointIndex, type WaypointPlace } from "../src/routing/waypoints.ts";
import { createRateLimiter } from "../src/share/rate-limiter.ts";
import { createShareService, type ShareServiceOptions } from "../src/share/share-service.ts";
import {
    databaseShareStore,
    newShareCode,
    sharePayloadHash,
    type ShareStore,
    type StoredShare,
} from "../src/share/share-store.ts";

/**
 * Der Kurzlink (WI-0034) und sein Testvertrag (Kap. 11.4): Was gespeichert wird, wann es gilt, was
 * bei zwei gleichzeitigen Anfragen geschieht - gegen echtes PostgreSQL, nicht gegen einen Ersatz.
 */

const GARETH = "80558060-4299-54aa-b520-814b10819885";
const PERRICUM = "194cd8ed-9aff-57af-b658-ff353ac883a7";
const VERSCHWUNDEN = "00000000-0000-4000-8000-000000000000";

/** Jeder Lauf teilt andere Kartenpunkte: Die Testdatenbank behält Zeilen früherer Läufe nicht, aber zur Sicherheit. */
const somePoint = (): string =>
    `p:${String(randomInt(1, 999))}.${String(randomInt(100, 999))}:${String(randomInt(1, 999))}.5`;

function payload(over: Partial<SharePayload> = {}): SharePayload {
    return {
        v: 1,
        waypoints: [somePoint(), GARETH],
        options: {
            optimize: "fastest",
            minimizeTransfers: false,
            enabled: { land: true, river: true, sea: true },
            transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
            hoursPerDay: 8,
        },
        view: { series: AVENTURIA_SERIES.defaultSeries, view: "standard", layer: "alle" },
        ...over,
    };
}

const ort = (id: string, name: string): WaypointPlace => ({ id, name, subtype: "stadt", hidden: false, x: 1, y: 2 });
const index: WaypointIndex = {
    lookup: async (query) => ({ query, hits: [], truncated: false }),
    resolve: async (names) => names.map(() => null),
    nearest: async () => ({ place: null, distance: null }),
    byIds: async (ids) => waypointsById([ort(GARETH, "Gareth"), ort(PERRICUM, "Perricum")], ids),
};

describe("Kurzlink: der gespeicherte Zustand", () => {
    it("schreibt einen Zustand nur auf eine Weise: Schlüsselreihenfolge, Groß- und Kleinschreibung, Kartenpunkte", () => {
        const base = payload({ waypoints: ["p:547.60:535.5", GARETH.toUpperCase()] });
        const umgestellt = {
            view: { layer: base.view.layer, view: base.view.view, series: base.view.series },
            options: { ...base.options, enabled: { sea: true, river: true, land: true } },
            waypoints: ["p:547.6:535.50", GARETH],
            v: 1,
        } as SharePayload;
        const a = canonicalSharePayload(base);
        const b = canonicalSharePayload(umgestellt);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.waypoints).toEqual(["p:547.6:535.5", GARETH]);
        expect(sharePayloadHash(a)).toMatch(/^[0-9a-f]{64}$/);
        expect(sharePayloadHash(a)).toBe(sharePayloadHash(b));
    });

    it("zieht Codes aus Legacys Alphabet, acht Zeichen, ohne 0, 1, l, o, I, O", () => {
        for (let round = 0; round < 200; round++) {
            const code = newShareCode();
            expect(code).toHaveLength(SHARE_CODE_LENGTH);
            expect([...code].every((char) => SHARE_CODE_ALPHABET.includes(char))).toBe(true);
            expect(code).not.toMatch(/[01loIO]/);
        }
    });

    it("nimmt nur die eigene Seite als Herkunft", () => {
        expect(isSameOrigin("https://stage.avesmaps.de", "stage.avesmaps.de")).toBe(true);
        expect(isSameOrigin("http://localhost:5173", "localhost:5173")).toBe(true);
        expect(isSameOrigin("http://localhost:5173", "localhost:3000")).toBe(false);
        expect(isSameOrigin("https://boese.example", "stage.avesmaps.de")).toBe(false);
        expect(isSameOrigin(undefined, "stage.avesmaps.de")).toBe(false);
        expect(isSameOrigin("null", "stage.avesmaps.de")).toBe(false);
    });

    it("drosselt gleitend je Schlüssel und vergisst nach dem Fenster", () => {
        let now = 0;
        const limiter = createRateLimiter(2, 1000, () => now);
        limiter.record("a");
        limiter.record("a");
        expect(limiter.allows("a")).toBe(false);
        expect(limiter.allows("b")).toBe(true);
        now = 999;
        expect(limiter.allows("a")).toBe(false);
        now = 1000;
        expect(limiter.allows("a")).toBe(true);
    });
});

/** Ein Speicher im Speicher, um die Reihenfolge des Dienstes ohne Datenbank zu prüfen. */
function memoryStore(): ShareStore & { rows: Map<string, StoredShare & { hash: string }> } {
    const rows = new Map<string, StoredShare & { hash: string }>();
    return {
        rows,
        async codeFor(hash) {
            return [...rows.values()].find((row) => row.hash === hash)?.code;
        },
        async insert(code, stored, hash) {
            const taken = [...rows.values()].some(
                (row) => row.code.toLowerCase() === code.toLowerCase() || row.hash === hash,
            );
            if (!taken) rows.set(code, { code, payload: stored, hash });
            return !taken;
        },
        async createdWithin() {
            return rows.size;
        },
        async read(code) {
            return [...rows.values()].find((row) => row.code.toLowerCase() === code.toLowerCase());
        },
    };
}

describe("Kurzlink: die Reihenfolge des Dienstes", () => {
    it("gibt den vorhandenen Code auch dem, den die Drossel schon hält", async () => {
        const store = memoryStore();
        const service = createShareService(store, { limiter: createRateLimiter(1, 60_000) });
        const erster = payload();
        expect(await service.create(erster, "ip")).toMatchObject({ kind: "created" });
        expect(await service.create(payload(), "ip")).toEqual({ kind: "rate_limited" });
        expect(await service.create(erster, "ip")).toMatchObject({ kind: "existing" });
    });

    it("hält das Tagesbudget über alle IPs", async () => {
        const store = memoryStore();
        const service = createShareService(store, { dailyBudget: 2 });
        await service.create(payload(), "a");
        await service.create(payload(), "b");
        expect(await service.create(payload(), "c")).toEqual({ kind: "daily_budget" });
    });

    it("zieht bei einer Codekollision einen neuen Code", async () => {
        const store = memoryStore();
        const codes = ["Abcd2345", "abcd2345", "Zyxw9876"];
        const service = createShareService(store, { newCode: () => codes.shift() ?? "Qrst6789" });
        expect(await service.create(payload(), "a")).toEqual({ kind: "created", code: "Abcd2345" });
        // Derselbe Code in anderer Schreibweise ist vergeben - wie in Legacys MySQL.
        expect(await service.create(payload(), "a")).toEqual({ kind: "created", code: "Zyxw9876" });
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Kurzlink: POST /api/share und GET /api/share/<code> gegen PostgreSQL", () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
    const host = "karte.test";
    const origin = `https://${host}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    afterAll(async () => {
        // Nur, was dieser Lauf angelegt hat: Kartenpunkte aus dem Zufall, dazu Gareth.
        await database`DELETE FROM share_link WHERE payload->'waypoints'->>1 IN (${GARETH}, ${PERRICUM})`;
        await database.end({ timeout: 5 });
    });

    // 🪤 Jede App bekommt ihre eigene Verbindung: `app.close()` beendet die Datenbank, die sie trägt.
    const start = (options: ShareServiceOptions = {}): FastifyInstance => {
        const own = createDatabase(testDatabaseUrl as string, { max: 4 });
        app = buildApp({
            config,
            database: own,
            waypointIndex: index,
            shareService: createShareService(databaseShareStore(own), options),
        });
        return app;
    };
    const post = (target: FastifyInstance, body: unknown, headers: Record<string, string> = {}) =>
        target.inject({
            method: "POST",
            url: "/api/share",
            headers: { host, origin, "content-type": "application/json", ...headers },
            payload: JSON.stringify(body),
        });

    it("🔴 legt einen Code an und gibt für denselben Zustand denselben zurück (201, dann 200)", async () => {
        const target = start();
        const zustand = payload();
        const neu = await post(target, zustand);
        expect(neu.statusCode).toBe(201);
        expect(neu.headers["cache-control"]).toBe("no-store");
        const { code } = neu.json<{ code: string }>();
        expect(code).toMatch(new RegExp(`^[${SHARE_CODE_ALPHABET}]{${String(SHARE_CODE_LENGTH)}}$`));

        const umgestellt = { ...zustand, waypoints: [zustand.waypoints[0], GARETH.toUpperCase()] };
        const wieder = await post(target, umgestellt);
        expect(wieder.statusCode).toBe(200);
        expect(wieder.json()).toEqual({ code });
    });

    it("🔴 zwei gleiche Anfragen zugleich ergeben EINE Zeile und denselben Code", async () => {
        const target = start();
        const zustand = payload();
        const [a, b] = await Promise.all([post(target, zustand), post(target, zustand)]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
        expect(a.json()).toEqual(b.json());
        const hash = sharePayloadHash(canonicalSharePayload(zustand));
        const [row] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM share_link WHERE payload_hash = ${hash}`;
        expect(row?.n).toBe(1);
    });

    it("löst einen Code auf, ohne Rücksicht auf die Schreibweise, mit den Orten von heute", async () => {
        const target = start();
        const zustand = payload({ waypoints: [somePoint(), GARETH, VERSCHWUNDEN, PERRICUM] });
        const { code } = (await post(target, zustand)).json<{ code: string }>();
        const swapped = [...code]
            .map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
            .join("");
        const response = await target.inject({ method: "GET", url: `/api/share/${swapped}` });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("public, max-age=86400");
        const body = response.json<{ code: string; payload: SharePayload; places: ({ name: string } | null)[] }>();
        expect(body.code).toBe(code);
        expect(body.payload).toEqual(canonicalSharePayload(zustand));
        // Kartenpunkt: null (er trägt seine Lage selbst); ein verschwundener Ort: null, nie ein anderer.
        expect(body.places.map((place) => place?.name ?? null)).toEqual([null, "Gareth", null, "Perricum"]);
    });

    it("🔴 trägt die Schalter des Auge-Menüs und die Topographie mit (WI-0072), alte Zustände behalten ihren Code", async () => {
        const target = start();
        const ohne = payload();
        const ohneCode = (await post(target, ohne)).json<{ code: string }>().code;
        // Ohne Abweichung und mit Vorgabe-Topographie ist es derselbe Zustand wie vor WI-0072: derselbe Code.
        const leer = payload({ view: { ...ohne.view, topo: "hoehenlinien", display: {} } });
        const leerAntwort = await post(target, { ...leer, waypoints: ohne.waypoints });
        expect(leerAntwort.statusCode).toBe(200);
        expect(leerAntwort.json()).toEqual({ code: ohneCode });

        const mit = payload({
            waypoints: ohne.waypoints,
            view: { ...ohne.view, view: "landscapes", topo: "hoehenstufen", display: { labels: false, placeLevel: 0 } },
        });
        const angelegt = await post(target, mit);
        expect(angelegt.statusCode).toBe(201);
        const { code } = angelegt.json<{ code: string }>();
        expect(code).not.toBe(ohneCode);
        const gelesen = await target.inject({ method: "GET", url: `/api/share/${code}` });
        const body = gelesen.json<{ payload: SharePayload }>();
        expect(body.payload.view).toEqual({
            series: ohne.view.series,
            view: "landscapes",
            layer: "alle",
            topo: "hoehenstufen",
            display: { placeLevel: 0, labels: false },
        });
        // Ein Zustand ohne die Schlüssel kommt ohne sie zurück (kein `display: {}` im alten Zustand).
        const alt = await target.inject({ method: "GET", url: `/api/share/${ohneCode}` });
        expect(Object.keys(alt.json<{ payload: SharePayload }>().payload.view)).toEqual(["series", "view", "layer"]);

        // Feste Werte, kein Freitext: eine Stufe außerhalb der sechs und ein Nicht-Wahrheitswert werden abgewiesen.
        for (const display of [{ placeLevel: 9 }, { paths: "ja" }, { placeLevel: 1.5 }]) {
            const response = await post(target, { ...ohne, view: { ...ohne.view, display } });
            expect(response.statusCode, JSON.stringify(display)).toBe(400);
        }
        expect((await post(target, { ...ohne, view: { ...ohne.view, topo: "wolken" } })).statusCode).toBe(400);
    });

    it("🔴 antwortet auf einen unbekannten Code mit 404, das nie gecacht wird", async () => {
        const target = start();
        const response = await target.inject({ method: "GET", url: "/api/share/zzzz2222" });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: "unknown_code" });
        expect(response.headers["cache-control"]).toBe("no-store");
        expect((await target.inject({ method: "GET", url: "/api/share/..%2Fetc" })).statusCode).toBe(400);
    });

    it("merkt sich den Tag des Aufrufs, aber schreibt ihn höchstens einmal täglich", async () => {
        const target = start();
        const { code } = (await post(target, payload())).json<{ code: string }>();
        const stand = async () =>
            (
                await database<{ day: string | null; xmin: string }[]>`
                    SELECT last_used_at::text AS day, xmin::text AS xmin FROM share_link WHERE code = ${code}
                `
            )[0];
        expect((await stand())?.day).toBeNull();
        await target.inject({ method: "GET", url: `/api/share/${code}` });
        const erster = await stand();
        const [heute] = await database<{ day: string }[]>`SELECT current_date::text AS day`;
        expect(erster?.day).toBe(heute?.day);
        await target.inject({ method: "GET", url: `/api/share/${code}` });
        // Dieselbe Zeilenversion: Der zweite Aufruf am selben Tag hat nichts geschrieben.
        expect((await stand())?.xmin).toBe(erster?.xmin);
    });

    it("🔴 nimmt nur Zustände aus festen Werten: kein Freitext, keine Namen, 2 bis 100 Wegpunkte", async () => {
        const target = start();
        // Ein zusätzliches Feld entfernt Fastify still (AJV `removeAdditional`), und die kanonische Form
        // kennt ohnehin nur ihre Felder: Der Text kommt nie in die Tabelle.
        const mitNotiz = await post(target, { ...payload(), notiz: "kostenloser Pastebin" });
        expect(mitNotiz.statusCode).toBe(201);
        const { code } = mitNotiz.json<{ code: string }>();
        const [row] = await database<
            { text: string }[]
        >`SELECT payload::text AS text FROM share_link WHERE code = ${code}`;
        expect(row?.text).not.toContain("Pastebin");
        expect(row?.text).not.toContain("notiz");

        const falsch: unknown[] = [
            { ...payload(), waypoints: ["Gareth", "Perricum"] },
            { ...payload(), waypoints: [GARETH] },
            { ...payload(), waypoints: Array.from({ length: 101 }, () => GARETH) },
            { ...payload(), options: { ...payload().options, hoursPerDay: 7.3 } },
            { ...payload(), options: { ...payload().options, transports: { land: "drache", river: "x", sea: "y" } } },
            { ...payload(), view: { ...payload().view, series: "<script>" } },
            { ...payload(), v: 2 },
        ];
        for (const body of falsch) {
            const response = await post(target, body);
            expect(response.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
        }
    });

    it("🔴 legt nur von der eigenen Seite an (403) und liest nichts über 16 KB (413)", async () => {
        const target = start();
        expect((await post(target, payload(), { origin: "https://boese.example" })).statusCode).toBe(403);
        const ohne = await target.inject({
            method: "POST",
            url: "/api/share",
            headers: { host, "content-type": "application/json" },
            payload: JSON.stringify(payload()),
        });
        expect(ohne.statusCode).toBe(403);
        expect(ohne.json()).toEqual({ error: "forbidden_origin" });
        expect(ohne.headers["cache-control"]).toBe("no-store");
        const riesig = { ...payload(), polster: "x".repeat(17 * 1024) };
        expect((await post(target, riesig)).statusCode).toBe(413);
    });

    it("🔴 drosselt je Client-IP hinter dem Proxy, nicht je Proxy", async () => {
        const target = start({ limiter: createRateLimiter(1, 60_000) });
        const von = (ip: string) => ({ "x-forwarded-for": ip });
        expect((await post(target, payload(), von("203.0.113.7"))).statusCode).toBe(201);
        const zweiter = await post(target, payload(), von("203.0.113.7"));
        expect(zweiter.statusCode).toBe(429);
        expect(zweiter.json()).toEqual({ error: "rate_limited" });
        // Ein vom Client vorangestellter, gefälschter Eintrag ändert nichts: Es zählt der letzte vor dem Proxy.
        expect((await post(target, payload(), von("198.51.100.1, 203.0.113.7"))).statusCode).toBe(429);
        expect((await post(target, payload(), von("203.0.113.8"))).statusCode).toBe(201);
    });

    it("hält das Tagesbudget, gezählt in der Datenbank", async () => {
        const store = databaseShareStore(database);
        const target = start({ dailyBudget: await store.createdWithin(24) });
        const response = await post(target, payload());
        expect(response.statusCode).toBe(429);
        expect(response.json()).toEqual({ error: "daily_budget" });
    });
});
