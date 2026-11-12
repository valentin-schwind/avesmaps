import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { inhaltsEtag, sendeMitEtag } from "../src/http/json-mit-etag.ts";

/**
 * Die gemeinsame Antwort der Editorlisten mit ETag (WI-0235): einmal serialisieren, denselben Text für ETag und Körper. Vorher stand
 * dieselbe Hashfunktion in fünf Dateien, und jede Route serialisierte die Liste zweimal.
 */
const LISTE = {
    rows: [
        { id: "a", name: "Gareth", n: 1 },
        { id: "b", name: "Punin", n: 2 },
    ],
};

/** Die Formel, die bis WI-0235 in `editorPlacesEtag` und den vier Geschwistern stand. */
const alterEtag = (inhalt: unknown): string =>
    `W/"${createHash("sha256").update(JSON.stringify(inhalt)).digest("base64url").slice(0, 32)}"`;

async function server() {
    const app = Fastify();
    app.get("/liste", async (request, reply) => sendeMitEtag(request, reply, LISTE));
    await app.ready();
    return app;
}

describe("sendeMitEtag", () => {
    it("🔴 bytegleich: derselbe ETag wie die alte Formel, damit kein Browserspeicher nach dem Release verfällt", () => {
        expect(inhaltsEtag(JSON.stringify(LISTE))).toBe(alterEtag(LISTE));
    });

    it("200 mit ETag, privat, und genau dem JSON der Liste", async () => {
        const app = await server();
        const antwort = await app.inject({ method: "GET", url: "/liste" });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["etag"]).toBe(alterEtag(LISTE));
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        expect(antwort.headers["content-type"]).toBe("application/json; charset=utf-8");
        expect(antwort.body).toBe(JSON.stringify(LISTE));
        await app.close();
    });

    it("🔴 304 ohne Körper, wenn der Browser diesen Stand schon hat", async () => {
        const app = await server();
        const antwort = await app.inject({
            method: "GET",
            url: "/liste",
            headers: { "if-none-match": alterEtag(LISTE) },
        });
        expect(antwort.statusCode).toBe(304);
        expect(antwort.body).toBe("");
        await app.close();
    });

    it("ein anderer Stand im Browser bekommt den neuen Körper", async () => {
        const app = await server();
        const antwort = await app.inject({ method: "GET", url: "/liste", headers: { "if-none-match": 'W/"alt"' } });
        expect(antwort.statusCode).toBe(200);
        expect(JSON.parse(antwort.body)).toEqual(LISTE);
        await app.close();
    });
});
