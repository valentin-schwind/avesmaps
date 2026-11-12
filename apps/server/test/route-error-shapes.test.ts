import { afterEach, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { WaypointIndex } from "../src/routing/waypoints.ts";

/**
 * Die Fehlerform im Antwortschema (Befund Claudio, Stage 8k, 2026-10-03): `GET /api/route/waypoints/resolve?name=…`
 * (falscher Parameter) antwortete 500 statt 400, „The serializer for the given status code failed“.
 *
 * 🪤 Fastify beantwortet eine ungültige Anfrage selbst, in SEINER Form (`statusCode`, `code`, `error`, `message`), und
 * schickt sie durch das Antwortschema der Route, sobald dieses den Statuscode kennt. Steht für 400 nur die eigene
 * Fehlerform (`{ error: "unknown_waypoint" }`), scheitert die Serialisierung, und aus dem 400 wird ein 500. Dasselbe
 * gilt für 413 (Körper zu groß) und 415 (Medientyp), die Fastify vor der Route beantwortet, und für 503
 * `database_unavailable`, das der Fehlerhandler für jede Route mit Datenbank sendet (`error-handler.ts`).
 */

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
};

/** Das Protokoll geht nirgendwohin: Eine Adresse von 9.000 Zeichen füllte sonst die Ausgabe. */
const SILENT = { write: (): void => undefined };

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

/** Was Fastify selbst sendet, mit seinen Codes; die Meldung ist frei. */
const FASTIFY_ERRORS: Record<number, unknown> = {
    400: { statusCode: 400, code: "FST_ERR_VALIDATION", error: "Bad Request", message: "querystring/q must be string" },
    413: {
        statusCode: 413,
        code: "FST_ERR_CTP_BODY_TOO_LARGE",
        error: "Payload Too Large",
        message: "Request body is too large",
    },
    415: {
        statusCode: 415,
        code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
        error: "Unsupported Media Type",
        message: "Unsupported Media Type: text/plain",
    },
};

/** Dieselben Fälle im Umschlag (ADR-0018), so wie der Fehlerhandler sie für `config.errorEnvelope` sendet. */
const ENVELOPE_ERRORS: Record<number, unknown> = {
    400: { error: { code: "validation_failed", message: "x", details: { issues: [] } } },
    413: { error: { code: "payload_too_large", message: "x" } },
    415: { error: { code: "unsupported_media_type", message: "x" } },
    503: { error: { code: "database_unavailable", message: "x" } },
};

describe("Die Antwortschemata kennen die Fehlerform, in der Fastify oder der Fehlerhandler antwortet", () => {
    /** Alle Routen der Anwendung mit ihren Antwortschemas, so wie Fastify sie beim Anlegen sieht. */
    async function routes(): Promise<{ route: string; response: Record<string, TSchema>; envelope: boolean }[]> {
        const found: { route: string; response: Record<string, TSchema>; envelope: boolean }[] = [];
        app = buildApp({ config, logStream: SILENT });
        app.addHook("onRoute", (options) => {
            const response = (options.schema as { response?: Record<string, TSchema> } | undefined)?.response;
            const methods = Array.isArray(options.method) ? options.method.join("|") : options.method;
            const envelope = options.config?.errorEnvelope === true;
            if (response) found.push({ route: `${methods} ${options.url}`, response, envelope });
        });
        await app.ready();
        return found;
    }

    it("🔴 jede Route mit Antwortschema für 400, 413 oder 415 nimmt Fastifys eigene Antwort an", async () => {
        const all = await routes();
        // Der Test prüft etwas: Es gibt Routen mit 400 im Schema, darunter die gemeldete.
        expect(all.map((entry) => entry.route)).toContain("GET /api/route/waypoints/resolve");
        const declared = all.flatMap((entry) =>
            [400, 413, 415]
                .filter((status) => entry.response[status] !== undefined)
                .map((status) => ({ ...entry, status })),
        );
        expect(declared.length).toBeGreaterThan(4);
        const bad = declared
            .filter(({ response, status, envelope }) =>
                // Routen mit Fehlerumschlag (ADR-0018) bekommen Fastifys Absagen übersetzt.
                envelope
                    ? !Value.Check(response[status] as TSchema, ENVELOPE_ERRORS[status])
                    : !Value.Check(response[status] as TSchema, FASTIFY_ERRORS[status]),
            )
            .map(({ route, status }) => `${route}: ${String(status)}`);
        expect(bad).toEqual([]);
    });

    it("🔴 jede Route mit Antwortschema für 503 nimmt `database_unavailable` des Fehlerhandlers an, und keine führt einen 500", async () => {
        const all = await routes();
        // Die Bereitschaftsprüfung fängt Datenbankfehler selbst ab und antwortet mit ihrer eigenen Form (`ReadinessResponse`).
        const withUnavailable = all.filter(
            (entry) => entry.response[503] !== undefined && !entry.route.endsWith("/health/ready"),
        );
        expect(withUnavailable.length).toBeGreaterThan(4);
        const bad = withUnavailable
            .filter(({ response, envelope }) =>
                envelope
                    ? !Value.Check(response[503] as TSchema, ENVELOPE_ERRORS[503])
                    : !Value.Check(response[503] as TSchema, { error: "database_unavailable" }),
            )
            .map(({ route }) => route);
        expect(bad).toEqual([]);
        expect(all.filter((entry) => entry.response[500] !== undefined).map((entry) => entry.route)).toEqual([]);
    });
});

describe("GET /api/route/waypoints/resolve: ein falscher Parameter ist 400, nie 500", () => {
    const index: WaypointIndex = {
        lookup: async (query) => ({ query, hits: [], truncated: false }),
        resolve: async (names) => names.map(() => null),
        byIds: async (ids) => ids.map(() => null),
        nearest: async () => ({ place: null, distance: null }),
    };

    it("🔴 `name` statt `names`, leer und viel zu lang: 400 in Fastifys Form", async () => {
        app = buildApp({ config, waypointIndex: index, logStream: SILENT });
        // Deutlich über der Grenze (8000 Zeichen), nicht knapp darüber.
        const zuLang = "a".repeat(9000);
        for (const url of [
            "/api/route/waypoints/resolve?name=Gareth",
            "/api/route/waypoints/resolve",
            "/api/route/waypoints/resolve?names=",
            `/api/route/waypoints/resolve?names=${zuLang}`,
        ]) {
            const response = await app.inject({ method: "GET", url });
            expect(response.statusCode, url.slice(0, 80)).toBe(400);
            expect(response.json(), url.slice(0, 80)).toMatchObject({ statusCode: 400, code: "FST_ERR_VALIDATION" });
        }
    });

    it("zu viele Namen sind weiter 400 in der Form der Route, ein gültiger Aufruf 200", async () => {
        app = buildApp({ config, waypointIndex: index, logStream: SILENT });
        const viele = Array.from({ length: 101 }, () => "A").join("~");
        const tooMany = await app.inject({ method: "GET", url: `/api/route/waypoints/resolve?names=${viele}` });
        expect(tooMany.statusCode).toBe(400);
        expect(tooMany.json()).toEqual({ error: "unknown_waypoint", detail: "zu viele Namen" });
        const fine = await app.inject({ method: "GET", url: "/api/route/waypoints/resolve?names=Gareth~Perricum" });
        expect(fine.statusCode).toBe(200);
        expect(fine.json()).toEqual({ places: [null, null] });
    });
});
