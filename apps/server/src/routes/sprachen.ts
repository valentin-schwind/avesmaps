import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { FastifyErrorBody } from "@avesmaps3d/shared";
import { listeSprachen, spracheLesen } from "../sprachen/lesen.ts";
import { SpracheMitTrefferSchema, SpracheParamsSchema, SprachenListeSchema } from "../sprachen/schema.ts";
import { sprachenMindestanteil, trefferDerSprache } from "../sprachen/treffer.ts";

/**
 * Die Sprachen als Kartenebene, öffentlich und nur lesend (WI-0261 S2):
 *
 *     GET /api/sprachen              die aktiven Sprachen mit Namen, Farbe, Reihenfolge und Kennzahlen (Legende, Ebene)
 *     GET /api/sprachen/:schluessel  eine Sprache mit ihren aktiven Teilflächen (Fläche und Hülle) und den Zahlen ihrer Treffer je Art
 *                                    (`treffer`, WI-0261 S4: Orte, Herrschaftsgebiete, Regionen, Wege ab dem Mindestanteil der
 *                                    Karteneinstellungen); 404, wenn es sie nicht gibt oder sie stillgelegt ist
 *
 * 🔴 Die Geometrie liefern diese Wege nie: Sie kommt als Kachel aus `sprache_flaeche_render` (Martin). Hier steht, was die Legende, die
 * Infobox und die Suche brauchen.
 *
 * `no-cache` mit ETag: Der Spracheditor (S5) ändert Farbe und Reihenfolge, und die nächste Anfrage soll es sehen; unverändert antwortet
 * der Server mit 304 (wie der Zeiger der Herrschaftsgebiete).
 *
 * 🪤 Fehlerform im Antwortschema: Steht 400 im Schema, braucht es Fastifys eigene Form, sonst wird aus dem 400 ein 500
 * (`route-error-shapes.test.ts`); 503 muss `database_unavailable` des Fehlerhandlers zulassen.
 */

const NotFound = Type.Object({ error: Type.Literal("not_found") });
const Unavailable = Type.Object({ error: Type.Literal("database_unavailable") });

export const spracheRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/sprachen",
        {
            config: { auth: "public" },
            schema: { response: { 200: SprachenListeSchema, 304: Type.Null(), 503: Unavailable } },
        },
        async (request, reply) => {
            if (!app.database)
                return reply.code(503).header("cache-control", "no-store").send({ error: "database_unavailable" });
            const sprachen = await listeSprachen(app.database);
            const etag = etagVon(sprachen);
            void reply.header("cache-control", "no-cache").header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return { sprachen };
        },
    );

    app.get(
        "/api/sprachen/:schluessel",
        {
            config: { auth: "public" },
            schema: {
                params: SpracheParamsSchema,
                response: {
                    200: SpracheMitTrefferSchema,
                    304: Type.Null(),
                    400: FastifyErrorBody,
                    404: NotFound,
                    503: Unavailable,
                },
            },
        },
        async (request, reply) => {
            if (!app.database)
                return reply.code(503).header("cache-control", "no-store").send({ error: "database_unavailable" });
            const gelesen = await spracheLesen(app.database, request.params.schluessel);
            if (gelesen === null)
                return reply.code(404).header("cache-control", "no-store").send({ error: "not_found" });
            // Die Zahlen nach der Schwelle von jetzt: Der ETag hängt am Inhalt, also auch an einer verstellten Schwelle.
            const mindestanteil = await sprachenMindestanteil(app.database);
            const treffer = await trefferDerSprache(app.database, gelesen.schluessel, mindestanteil);
            const sprache = { ...gelesen, treffer: treffer ?? { orte: 0, gebiete: 0, regionen: 0, wege: 0 } };
            const etag = etagVon(sprache);
            void reply.header("cache-control", "no-cache").header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return sprache;
        },
    );
};

/** Der ETag hängt an dem, was tatsächlich dasteht. */
function etagVon(inhalt: unknown): string {
    return `"${createHash("sha256").update(JSON.stringify(inhalt)).digest("hex").slice(0, 16)}"`;
}
