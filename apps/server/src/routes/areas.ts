import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AREA_LOOKUP_LIMITS,
    AREA_LOOKUP_URL,
    AREA_OUTLINE_URL,
    AreaAtQuery,
    AreaAtResponse,
    AreaOutlineQuery,
    AreaOutlineResponse,
    type AreaLookupLayer,
    FastifyErrorBody,
} from "@avesmaps3d/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { areaOutlines, areasAt } from "../areas/area-lookup.ts";
import { watchClientClose } from "../client-closed.ts";

/**
 * `GET /api/areas/at` und `GET /api/areas/outline` (WI-0058): die Kartenauswahl dort, wo die Karte keine
 * Landschaftsflächen zeichnet und deshalb auch keine Kacheln dafür lädt (Betreiber 2026-09-28: „nur bei Bedarf“).
 *
 * 🔴 NUR LESEN. Kein Schreibpfad, kein Nebeneffekt, keine Sitzung.
 *
 * 🔴 Kostenschranke nach dem Muster von `POST /api/route/landscapes` (WI-0037, S-01): alle Parameter im Schema
 * begrenzt (Punkt auf der Karte, höchstens drei Ebenen, Umkreis bis `reachMax`, höchstens `outlineIds`
 * Kennungen), höchstens `concurrent` Abfragen je Prozess gleichzeitig (sonst 503 `busy` mit `Retry-After`),
 * PostgreSQL bricht nach `statementMs` ab (503 über den Fehlerhandler). Die Karte fragt erst, wenn der Zeiger
 * ruht, und merkt sich die letzten Antworten.
 *
 * Antworten dürfen kurz im Cache liegen: Flächen ändern sich nur mit einem Datenstand.
 *
 * 🔴 Schließt der Client die Anfrage vor der Antwort, bricht die Abfrage in der Datenbank ab und der Platz wird frei
 * (WI-0123, wie `POST /api/route/landscapes` seit `bebb4630`). Die Karte bricht ihre alte Frage ab, wenn der Zeiger
 * weiterzieht.
 */

/** Fastifys eigene Antwort auf eine ungültige Anfrage; ohne sie im Schema würde aus dem 400 ein 500. */
const ValidationError = FastifyErrorBody;
const AreaError = Type.Object({
    error: Type.Union([Type.Literal("busy"), Type.Literal("database_unavailable")]),
});

export const areaRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Die laufenden Abfragen dieses Prozesses (Semaphor), beide Routen zusammen.
    let running = 0;
    const guarded = async <T>(
        request: FastifyRequest,
        reply: FastifyReply,
        work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | FastifyReply> => {
        running += 1;
        const closed = watchClientClose(reply);
        try {
            return await work(closed.signal);
        } catch (error) {
            // 🔴 Der Client hat die Anfrage geschlossen: Die Abfrage ist abgebrochen, ihr Fehler (57014) betrifft niemanden
            // mehr, und niemand liest eine Antwort. `hijack`: Fastify schreibt nichts mehr, die Verbindung ist zu.
            if (closed.signal.aborted) {
                request.log.info("client closed the request, area query cancelled");
                return reply.hijack();
            }
            throw error;
        } finally {
            closed.release();
            running -= 1;
        }
    };

    app.get(
        AREA_LOOKUP_URL,
        {
            schema: {
                querystring: AreaAtQuery,
                response: { 200: AreaAtResponse, 400: ValidationError, 503: AreaError },
            },
        },
        async (request, reply) => {
            if (!app.database) return reply.code(503).send({ error: "database_unavailable" });
            if (running >= AREA_LOOKUP_LIMITS.concurrent) {
                void reply.header("Retry-After", "1");
                return reply.code(503).send({ error: "busy" });
            }
            const { x, y, layers, lakes, reach } = request.query;
            const database = app.database;
            return guarded(request, reply, async (signal) => {
                const result = await areasAt(
                    database,
                    {
                        x,
                        y,
                        layers: [...new Set(layers.split(","))] as AreaLookupLayer[],
                        lakes: lakes !== false,
                        reach: reach ?? 0,
                    },
                    undefined,
                    undefined,
                    signal,
                );
                void reply.header("cache-control", "public, max-age=60");
                return result;
            });
        },
    );

    app.get(
        AREA_OUTLINE_URL,
        {
            schema: {
                querystring: AreaOutlineQuery,
                response: { 200: AreaOutlineResponse, 400: ValidationError, 503: AreaError },
            },
        },
        async (request, reply) => {
            if (!app.database) return reply.code(503).send({ error: "database_unavailable" });
            if (running >= AREA_LOOKUP_LIMITS.concurrent) {
                void reply.header("Retry-After", "1");
                return reply.code(503).send({ error: "busy" });
            }
            const { ids, z, smooth } = request.query;
            const database = app.database;
            return guarded(request, reply, async (signal) => {
                const result = await areaOutlines(
                    database,
                    [...new Set(ids.split(","))],
                    z,
                    smooth === true,
                    undefined,
                    undefined,
                    signal,
                );
                void reply.header("cache-control", "public, max-age=300");
                return result;
            });
        },
    );
};
