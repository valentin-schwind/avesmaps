import { afterEach, describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { firstNonFinite } from "../src/finite-validator.ts";

/**
 * G4-02: "Infinity", "-Infinity" und "1e400" werden von Ajv (coerceTypes) zu ±Infinity und bestehen jede Zahlengrenze.
 * Der umhüllte Prüfer lehnt sie zentral ab, für Query, Körper und Pfadparameter, im Umschlag (ADR-0018).
 */

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
};
const SILENT = { write: (): void => undefined };

let app: FastifyInstance | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

function build(): FastifyInstance {
    const instance = buildApp({ config, logStream: SILENT });
    const zahl = Type.Integer({ minimum: 1, maximum: 50 });
    const options = { config: { errorEnvelope: true } };
    instance.get(
        "/t/query",
        { ...options, schema: { querystring: Type.Object({ limit: Type.Optional(zahl) }) } },
        () => ({
            ok: true,
        }),
    );
    instance.get("/t/param/:n", { ...options, schema: { params: Type.Object({ n: zahl }) } }, (request) => ({
        n: (request.params as { n: number }).n,
    }));
    instance.post(
        "/t/body",
        { ...options, schema: { body: Type.Object({ n: zahl, f: Type.Optional(Type.Number()) }) } },
        (request) => ({
            n: (request.body as { n: number }).n,
        }),
    );
    return instance;
}

describe("nicht endliche Zahlen sind 400 im Umschlag", () => {
    for (const wert of ["Infinity", "-Infinity", "1e400", "-1e400"]) {
        it(`${wert}: Query, Pfadparameter und Körper`, async () => {
            app = build();
            const query = await app.inject({ method: "GET", url: `/t/query?limit=${wert}` });
            const param = await app.inject({ method: "GET", url: `/t/param/${wert}` });
            // Im Körper nur als Zahl lesbar (`1e400` wird beim Lesen zu Infinity), als Zeichenkette über die Umwandlung.
            const zahlImKoerper = await app.inject({
                method: "POST",
                url: "/t/body",
                headers: { "content-type": "application/json" },
                payload: `{"n":3,"f":${wert.startsWith("-") ? "-1e400" : "1e400"}}`,
            });
            const textImKoerper = await app.inject({ method: "POST", url: "/t/body", payload: { n: wert } });
            for (const response of [query, param, zahlImKoerper, textImKoerper]) {
                expect(response.statusCode, response.body).toBe(400);
                expect(response.json(), response.body).toMatchObject({ error: { code: "validation_failed" } });
            }
        });
    }

    it('"5" in der Query und im Pfad gehen weiter, "-3" bleibt an der Grenze (400 wie vorher)', async () => {
        app = build();
        expect((await app.inject({ method: "GET", url: "/t/query?limit=5" })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/t/param/5" })).json()).toEqual({ n: 5 });
        // Ohne Datenbank hält die Schreibsperre einen POST nach der Schemaprüfung an (503); entscheidend ist: keine Absage der Prüfung.
        const koerper = await app.inject({ method: "POST", url: "/t/body", payload: { n: "5", f: 2.5 } });
        expect(koerper.statusCode, koerper.body).not.toBe(400);
        const minus = await app.inject({ method: "GET", url: "/t/query?limit=-3" });
        expect(minus.statusCode).toBe(400);
        expect(minus.json()).toMatchObject({ error: { code: "validation_failed" } });
    });

    it("firstNonFinite findet die Stelle auch tief im Körper und kennt Schleifen nicht", () => {
        expect(firstNonFinite({ a: [1, { b: Infinity }] })).toBe("/a/1/b");
        expect(firstNonFinite({ a: [1, 2], b: "x", c: null })).toBeUndefined();
        expect(firstNonFinite(Number.NaN)).toBe("");
        // Rohkörper eigener Parser (Buffer, Stream mit Rückverweis) werden nicht durchlaufen.
        expect(firstNonFinite(Buffer.alloc(1_000_000))).toBeUndefined();
        class Knoten {
            selbst: unknown = this;
            wert = Infinity;
        }
        expect(firstNonFinite({ roh: new Knoten() })).toBe("/roh/wert");
        const ohneProto = Object.create(null) as Record<string, unknown>;
        ohneProto["limit"] = Infinity;
        expect(firstNonFinite(ohneProto)).toBe("/limit");
    });
});
