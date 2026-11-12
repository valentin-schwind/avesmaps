import { afterEach, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { RoutingHealthResponse } from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import type { ServerConfig } from "../src/config.ts";
import type { RouteRunner, RouteRunnerStatus } from "../src/routing/runner.ts";

const baseConfig: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
};

let app: FastifyInstance | undefined;

afterEach(async () => {
    await app?.close();
    app = undefined;
});

describe("liveness", () => {
    it("reports ok without any dependency", async () => {
        app = buildApp({ config: baseConfig });
        const response = await app.inject({ method: "GET", url: "/health" });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: "ok", releaseId: "test" });
    });
});

describe("readiness", () => {
    it("reports degraded with 503 when no database is configured", async () => {
        app = buildApp({ config: baseConfig });
        const response = await app.inject({ method: "GET", url: "/health/ready" });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
            status: "degraded",
            checks: [{ name: "database", status: "failed" }],
        });
    });

    const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
    const itWithDatabase = testDatabaseUrl ? it : it.skip;

    // Chapter 11.10: database semantics are verified against real PostgreSQL/PostGIS.
    // Without TEST_DATABASE_URL this skips visibly instead of passing silently (chapter 11.155).
    itWithDatabase("reports ready when PostGIS answers", async () => {
        const database = createDatabase(testDatabaseUrl as string);
        app = buildApp({ config: { ...baseConfig, databaseUrl: testDatabaseUrl }, database });
        const response = await app.inject({ method: "GET", url: "/health/ready" });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            status: "ready",
            checks: [{ name: "database", status: "ok" }],
        });
        expect(response.json().checks[0].detail).toContain("postgis");
    });
});

/** Eine Steuerung, deren Zustand der Test vorgibt. */
function runnerIn(status: RouteRunnerStatus): RouteRunner {
    return {
        run: async () => ({ ok: false, error: "routing_failed" }),
        warm() {},
        status: () => status,
        async close() {},
    };
}

describe("routing readiness (WI-0075 R5a, GET /health/routing)", () => {
    const get = async (status: RouteRunnerStatus | undefined) => {
        app = buildApp({ config: baseConfig, ...(status ? { routeRunner: runnerIn(status) } : {}) });
        return app.inject({ method: "GET", url: "/health/routing" });
    };

    it("ready: 200 mit dem Zustand, der Version und der Dauer", async () => {
        const response = await get({ state: "ready", ageMs: 4200 });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ state: "ready", releaseId: "test", ageMs: 4200 });
        expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("cold und warming: 503 mit dem Zustand, damit ein Gate wartet statt abzubrechen", async () => {
        for (const state of ["cold", "warming"] as const) {
            const response = await get({ state, ageMs: 10 });
            expect(response.statusCode, state).toBe(503);
            expect(response.json(), state).toEqual({ state, releaseId: "test", ageMs: 10 });
        }
    });

    it("🔴 failed: 503 mit dem Grund, ohne Fehlermeldung", async () => {
        for (const reason of ["warm_failed", "worker_exited", "worker_stuck"] as const) {
            const response = await get({ state: "failed", reason, ageMs: 0 });
            expect(response.statusCode, reason).toBe(503);
            expect(response.json(), reason).toEqual({ state: "failed", releaseId: "test", ageMs: 0, reason });
        }
    });

    it("ohne Steuerung (keine Datenbank) ist es failed/no_worker, nicht ewig cold", async () => {
        const response = await get(undefined);
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ state: "failed", releaseId: "test", ageMs: 0, reason: "no_worker" });
    });

    it("jede Antwort erfüllt das Schema des Vertrags, und das Schema lehnt Fremdes ab (Fastify-Fehlerform bleibt)", async () => {
        const ready = await get({ state: "ready", ageMs: 1 });
        expect(Value.Check(RoutingHealthResponse, ready.json())).toBe(true);
        expect(
            Value.Check(RoutingHealthResponse, { state: "ready", releaseId: "x", ageMs: 1, message: "Error: x" }),
        ).toBe(false);
        expect(Value.Check(RoutingHealthResponse, { state: "halb", releaseId: "x", ageMs: 1 })).toBe(false);
    });

    // Ohne TEST_DATABASE_URL gibt es keine Aussage über /health/ready: sichtbarer Skip, nie stilles Grün (Kap. 11.155).
    const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
    const itWithDatabase = testDatabaseUrl ? it : it.skip;

    itWithDatabase("🔴 /health/ready bleibt unberührt: gesund, auch wenn der Routenrechner failed meldet", async () => {
        const database = createDatabase(testDatabaseUrl as string);
        app = buildApp({
            config: { ...baseConfig, databaseUrl: testDatabaseUrl },
            database,
            routeRunner: runnerIn({ state: "failed", reason: "warm_failed", ageMs: 0 }),
        });
        expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/health/routing" })).statusCode).toBe(503);
    });
});

describe("/health/lokal (WI-0189)", () => {
    it("nennt auf dem Entwicklungsrechner Checkout, Commit und ob Kacheln und Medien gesetzt sind", async () => {
        app = buildApp({ config: { ...baseConfig, releaseId: "dev" } });
        const response = await app.inject({ method: "GET", url: "/health/lokal", remoteAddress: "127.0.0.1" });

        expect(response.statusCode).toBe(200);
        const body = response.json<{ checkout: string; commit: string | null; tileRoot: boolean; pid: number }>();
        expect(body.checkout.endsWith("/apps/server/src/routes")).toBe(false);
        expect(process.cwd().replace(/\\/g, "/").startsWith(body.checkout)).toBe(true);
        expect(typeof body.tileRoot).toBe("boolean");
        expect(body.pid).toBe(process.pid);
    });

    it("🔴 gibt es außerhalb des Entwicklungsrechners nicht, und von außen nie", async () => {
        app = buildApp({ config: baseConfig });
        expect((await app.inject({ method: "GET", url: "/health/lokal", remoteAddress: "127.0.0.1" })).statusCode).toBe(
            404,
        );
        await app.close();
        app = buildApp({ config: { ...baseConfig, releaseId: "dev" } });
        expect((await app.inject({ method: "GET", url: "/health/lokal", remoteAddress: "10.0.0.7" })).statusCode).toBe(
            404,
        );
    });
});
