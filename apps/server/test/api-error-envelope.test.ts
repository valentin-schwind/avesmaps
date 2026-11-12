import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ApiErrorBody, FastifyErrorBody } from "@avesmaps3d/shared";
import { registerErrorHandler } from "../src/error-handler.ts";
import { ApiError } from "../src/http/api-error.ts";

/**
 * Der Fehlerumschlag (M10 a, ADR-0018): Routen mit `config.errorEnvelope` antworten in JEDEM Fehlerfall als
 * `{ error: { code, message, details? } }`, auch wenn Fastify selbst die Anfrage abweist (400, 413, 415) oder die Datenbank
 * fehlt. Alle anderen Routen bleiben, wie sie sind; ein `ApiError` geht überall im Umschlag hinaus.
 */

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

/** Ein Fehler, den `isDatabaseUnavailable` als Verbindungsabbruch erkennt. */
function connectionRefused(): Error {
    return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433 user=geheim"), { code: "ECONNREFUSED" });
}

async function build(): Promise<FastifyInstance> {
    const instance = Fastify({ logger: false, bodyLimit: 64 }).withTypeProvider<TypeBoxTypeProvider>();
    registerErrorHandler(instance);
    const Body = Type.Object({ name: Type.String({ minLength: 1 }), count: Type.Integer() });
    const response = { 400: ApiErrorBody, 409: ApiErrorBody, 413: ApiErrorBody, 415: ApiErrorBody, 503: ApiErrorBody };
    instance.post(
        "/envelope",
        {
            config: { errorEnvelope: true },
            schema: { body: Body, response: { 200: Type.Object({ ok: Type.Boolean() }), ...response } },
        },
        async () => ({ ok: true }),
    );
    instance.get("/envelope/conflict", { config: { errorEnvelope: true }, schema: { response } }, async () => {
        throw new ApiError(409, "edit_conflict", "Jemand hat das inzwischen geändert.", { currentRevision: 3 });
    });
    instance.get("/envelope/boom", { config: { errorEnvelope: true } }, async () => {
        throw new Error("SELECT geheim FROM avesmaps_auth.session");
    });
    instance.get("/envelope/database", { config: { errorEnvelope: true } }, async () => {
        throw connectionRefused();
    });
    instance.post(
        "/legacy",
        { schema: { body: Body, response: { 200: Type.Object({ ok: Type.Boolean() }), 400: FastifyErrorBody } } },
        async () => ({ ok: true }),
    );
    instance.get("/legacy/database", async () => {
        throw connectionRefused();
    });
    instance.get("/legacy/api-error", async () => {
        throw new ApiError(403, "forbidden", "Dafür fehlt das Recht.");
    });
    await instance.ready();
    return instance;
}

function expectEnvelope(body: unknown, code: string): void {
    expect(Value.Check(ApiErrorBody, body), JSON.stringify(body)).toBe(true);
    expect((body as ApiErrorBody).error.code).toBe(code);
}

describe("Routen mit Fehlerumschlag", () => {
    it("🔴 eine ungültige Anfrage ist 400 `validation_failed`, mit Feld und Regel, ohne den eingegebenen Wert", async () => {
        app = await build();
        const response = await app.inject({ method: "POST", url: "/envelope", payload: { name: "", count: "viele" } });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expectEnvelope(body, "validation_failed");
        expect(JSON.stringify(body)).not.toContain("viele");
        expect(
            (body as { error: { details: { issues: { path: string; rule: string }[] } } }).error.details.issues[0],
        ).toMatchObject({
            path: expect.stringMatching(/^body/),
            rule: expect.any(String),
        });
    });

    it("🔴 kaputtes JSON, falscher Medientyp und Übergröße kommen im Umschlag", async () => {
        app = await build();
        const broken = await app.inject({
            method: "POST",
            url: "/envelope",
            headers: { "content-type": "application/json" },
            payload: "{ kaputt",
        });
        expect(broken.statusCode).toBe(400);
        expectEnvelope(broken.json(), "validation_failed");

        const text = await app.inject({
            method: "POST",
            url: "/envelope",
            headers: { "content-type": "application/xml" },
            payload: "<hallo/>",
        });
        expect(text.statusCode).toBe(415);
        expectEnvelope(text.json(), "unsupported_media_type");

        const big = await app.inject({
            method: "POST",
            url: "/envelope",
            payload: { name: "x".repeat(200), count: 1 },
        });
        expect(big.statusCode).toBe(413);
        expectEnvelope(big.json(), "payload_too_large");
    });

    it("🔴 ein `ApiError` behält Status, Code und Details", async () => {
        app = await build();
        const response = await app.inject({ method: "GET", url: "/envelope/conflict" });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({
            error: {
                code: "edit_conflict",
                message: "Jemand hat das inzwischen geändert.",
                details: { currentRevision: 3 },
            },
        });
        expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("🔴 ein unerwarteter Fehler ist 500 `internal_error` ohne Meldung, SQL oder Stack", async () => {
        app = await build();
        const response = await app.inject({ method: "GET", url: "/envelope/boom" });
        expect(response.statusCode).toBe(500);
        expectEnvelope(response.json(), "internal_error");
        expect(response.body).not.toContain("geheim");
        expect(response.body).not.toContain("avesmaps_auth");
    });

    it("🔴 eine fehlende Datenbank ist 503 `database_unavailable` mit `Retry-After`, ohne Verbindungsdaten", async () => {
        app = await build();
        const response = await app.inject({ method: "GET", url: "/envelope/database" });
        expect(response.statusCode).toBe(503);
        expect(response.headers["retry-after"]).toBe("5");
        expectEnvelope(response.json(), "database_unavailable");
        expect(response.body).not.toContain("5433");
    });
});

describe("Routen ohne Fehlerumschlag bleiben unverändert", () => {
    it('🔴 Fastifys eigene 400-Antwort und `{ error: "database_unavailable" }` wie bisher', async () => {
        app = await build();
        const invalid = await app.inject({ method: "POST", url: "/legacy", payload: { name: "" } });
        expect(invalid.statusCode).toBe(400);
        expect(Value.Check(FastifyErrorBody, invalid.json())).toBe(true);

        const database = await app.inject({ method: "GET", url: "/legacy/database" });
        expect(database.statusCode).toBe(503);
        expect(database.json()).toEqual({ error: "database_unavailable" });
    });

    it("🔴 ein `ApiError` geht auch dort im Umschlag hinaus", async () => {
        app = await build();
        const response = await app.inject({ method: "GET", url: "/legacy/api-error" });
        expect(response.statusCode).toBe(403);
        expectEnvelope(response.json(), "forbidden");
    });
});
