import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { grundDerAblehnung } from "../src/error-handler.ts";
import { ApiError } from "../src/http/api-error.ts";

/**
 * Der Fehlerhandler (WI-0037, S-02): Nichts aus der Datenbank geht an den Client, alles geht ins Log.
 *
 * Vorher antwortete zum Beispiel `GET /api/search` bei fehlschlagender Anmeldung mit
 * `{"statusCode":500,"code":"28P01","message":"password authentication failed for user …"}`.
 */

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
};

/** Was ein Client über die Datenbank nie erfahren darf. */
const LEAKS = [
    /127\.0\.0\.1/,
    /ECONNREFUSED/,
    /password/i,
    /relation/,
    /does not exist/,
    /timeout/i,
    /\b(28P01|28000|57014|42P01)\b/,
];

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

function start(
    database: Database,
    register?: (target: FastifyInstance) => void,
): { app: FastifyInstance; log: string[] } {
    const log: string[] = [];
    app = buildApp({ config, database, logStream: { write: (line) => void log.push(line) } });
    register?.(app);
    return { app, log };
}

function expectNeutral(body: string): void {
    for (const leak of LEAKS) expect(body).not.toMatch(leak);
}

describe("Ablehnungen im Log (OPS-000079, Claudio 2026-11-03)", () => {
    it("🔴 das Kürzel der Regel steht im Log, der Satz mit seinen Zahlen nicht", async () => {
        const { app: ziel, log } = start(
            createDatabase("postgres://niemand:geheim@127.0.0.1:1/nirgends", { max: 1 }),
            (a) => {
                a.get("/api/probe-ablehnung", () => {
                    throw new ApiError(400, "validation_failed", "Die Ecke (300, 330) liegt außerhalb.", {
                        field: "areas",
                        reason: "ecke_ausserhalb",
                    });
                });
            },
        );
        const antwort = await ziel.inject({ method: "GET", url: "/api/probe-ablehnung" });
        expect(antwort.statusCode).toBe(400);
        const zeile = log.find((eintrag) => eintrag.includes("api error"));
        expect(JSON.parse(zeile!)).toMatchObject({ code: "validation_failed", status: 400, grund: "ecke_ausserhalb" });
        expect(log.join("\n")).not.toContain("300, 330");
    });

    it("🔴 ohne Kürzel das Feld oder die Schemaregel; was kein Kürzel ist, bleibt draußen", () => {
        expect(grundDerAblehnung({ reason: "ring_unter_drei", field: "areas" })).toBe("ring_unter_drei");
        expect(grundDerAblehnung({ field: "name" })).toBe("feld:name");
        expect(grundDerAblehnung({ issues: [{ path: "body/areas/0", rule: "minItems" }] })).toBe(
            "schema:body/areas/0:minItems",
        );
        expect(grundDerAblehnung({ reason: "Thomas Braun schrieb (300, 330)" })).toBeUndefined();
        expect(grundDerAblehnung({ areaId: "abc" })).toBeUndefined();
        expect(grundDerAblehnung(undefined)).toBeUndefined();
    });
});

describe("Datenbank nicht erreichbar", () => {
    // Port 1 nimmt nichts an: ECONNREFUSED, ohne dass es eine Datenbank braucht.
    const unreachable = (): Database => createDatabase("postgres://niemand:geheim@127.0.0.1:1/nirgends", { max: 1 });

    const requests = [
        { method: "GET", url: "/api/search?q=Gareth" },
        { method: "GET", url: "/api/powerlines" },
        { method: "GET", url: "/api/route/waypoints?q=Gareth" },
        {
            method: "POST",
            url: "/api/route/landscapes",
            payload: {
                stages: [
                    [
                        [
                            [0, 0],
                            [10, 10],
                        ],
                    ],
                ],
            },
        },
    ] as const;

    for (const request of requests) {
        it(`🔴 ${request.method} ${request.url.split("?")[0]} antwortet 503 database_unavailable, ohne Host und Code`, async () => {
            const { app: target, log } = start(unreachable());
            const response = await target.inject(request);

            expect(response.statusCode).toBe(503);
            expect(response.json()).toEqual({ error: "database_unavailable" });
            expect(response.headers["retry-after"]).toBe("5");
            expect(response.headers["cache-control"]).toBe("no-store");
            expectNeutral(response.body);
            // Das Protokoll behält, was der Client nicht sieht.
            expect(log.join("\n")).toMatch(/ECONNREFUSED/);
        });
    }
});

describe("andere Fehler ab 500", () => {
    it("🔴 ein ungefangener Fehler wird ein neutrales 500 internal_error, die Meldung steht nur im Log", async () => {
        const { app: target, log } = start(createDatabase("postgres://127.0.0.1:1/x", { max: 1 }), (a) =>
            a.get("/kaputt", () => {
                throw new Error('relation "geheime_tabelle" does not exist');
            }),
        );
        const response = await target.inject({ method: "GET", url: "/kaputt" });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: "internal_error" });
        expect(response.headers["cache-control"]).toBe("no-store");
        expectNeutral(response.body);
        const line = log.find((entry) => entry.includes("geheime_tabelle"));
        expect(line, "die Meldung fehlt im Protokoll").toBeDefined();
        expect(JSON.parse(line as string)).toMatchObject({
            level: 50,
            err: { stack: expect.stringContaining("Error") },
        });
    });

    it("🪤 Fehler der Anfrage bleiben in Fastifys Form: Der Client erfährt, was an SEINER Anfrage falsch war", async () => {
        const { app: target } = start(createDatabase("postgres://127.0.0.1:1/x", { max: 1 }));
        const response = await target.inject({ method: "GET", url: "/api/search" });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ statusCode: 400, code: "FST_ERR_VALIDATION", error: "Bad Request" });
        expect(response.json<{ message: string }>().message).toContain("q");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

// Kap. 11.10: die SQLSTATE kommen aus echtem PostgreSQL, nicht aus nachgebauten Fehlern.
describeWithDatabase("Fehler aus echtem PostgreSQL", () => {
    it("🔴 eine unbekannte Rolle (Klasse 28) antwortet 503, ohne Rollenname", async () => {
        const url = new URL(testDatabaseUrl as string);
        url.username = "gibt_es_nicht_wi0037";
        url.password = "falsch";
        const { app: target, log } = start(createDatabase(url.toString(), { max: 1 }));
        const response = await target.inject({ method: "GET", url: "/api/search?q=Gareth" });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "database_unavailable" });
        expect(response.body).not.toContain("gibt_es_nicht_wi0037");
        expect(log.join("\n")).toContain("gibt_es_nicht_wi0037");
    });

    it("🔴 eine abgebrochene Abfrage (statement_timeout, 57014) antwortet 503", async () => {
        const database = createDatabase(testDatabaseUrl as string, { max: 1 });
        const { app: target } = start(database, (a) =>
            a.get("/langsam", async () =>
                database.begin(async (transaction) => {
                    await transaction`SET LOCAL statement_timeout = 100`;
                    return transaction`SELECT pg_sleep(2)`;
                }),
            ),
        );
        const response = await target.inject({ method: "GET", url: "/langsam" });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "database_unavailable" });
    });

    it("🔴 ein Fehler im SQL (42P01) wird 500 internal_error, ohne Tabellenname", async () => {
        const database = createDatabase(testDatabaseUrl as string, { max: 1 });
        const { app: target, log } = start(database, (a) =>
            a.get("/fehler", async () => database`SELECT * FROM geheime_tabelle_wi0037`),
        );
        const response = await target.inject({ method: "GET", url: "/fehler" });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: "internal_error" });
        expectNeutral(response.body);
        expect(log.join("\n")).toContain("geheime_tabelle_wi0037");
    });
});
