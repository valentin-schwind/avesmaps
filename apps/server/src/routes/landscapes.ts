import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    ROUTE_LANDSCAPE_LIMITS,
    RouteLandscapesRequest,
    RouteLandscapesResponse,
    routeLandscapeLength,
    FastifyErrorBody,
} from "@avesmaps3d/shared";
import { watchClientClose } from "../client-closed.ts";
import { routeLandscapes } from "../landscapes/route-landscapes.ts";
import { rechneUnterwegs } from "./stage-lore.ts";

/**
 * `POST /api/route/landscapes` (WI-0035): die Landschaften je Etappe einer Route, die der Browser
 * schon hat.
 *
 * 🔴 POST AUF EINEM LESEPFAD, mit Absicht wie in Legacy (`path-landscapes.php`): Die Linien einer
 * langen Reise sprengten die Adresszeile. Geschrieben wird nichts, deshalb keine Herkunftsprüfung;
 * die Grenzen für Körper, Etappen und Punkte halten die Rechnung klein.
 *
 * ⭐ Ein eigener Endpunkt statt eines Felds in der Routenantwort: Die Route bleibt so schnell, wie sie
 * ist, und die Zeile kommt einen Augenblick später. Das Routing und sein Vertrag bleiben unberührt.
 *
 * 🔴 Kostenschranke (WI-0037, S-01): Punkte nur auf der Karte (Schema), ein Längenbudget
 * (`too_long`, 413), höchstens zwei Abfragen gleichzeitig (sonst 503 `busy` mit `Retry-After`), und
 * PostgreSQL bricht nach 2 s ab. Vor Production kommt `limit_req` im vhost dazu (Stufe 3, Claudio).
 *
 * 🔴 Schließt der Client die Anfrage vor der Antwort, bricht die Abfrage in der Datenbank ab und der Platz in der
 * Zweiergrenze wird frei (WI-0065, Nachtrag).
 *
 * 🔴 **Unterwegs fährt mit** (WI-0292, Vali 2026-11-09: der Planer lief in Production in die Drossel der Reise): Trägt die Anfrage
 * `unterwegs`, rechnet der Server die Vorkommen der Route NEBEN den Landschaften, mit der Schranke von `POST /api/route/unterwegs`
 * (`rechneUnterwegs`), und legt sie als `unterwegs` in die Antwort. Gelingt das nicht (Schranke voll, Zeitbudget, Fehler), fehlt das Feld,
 * die Landschaften kommen trotzdem, und der Browser fragt Unterwegs einzeln. So kostet eine neue Route zwei Fragen in der Zone statt drei.
 */

/** Fastifys eigene Antwort auf eine ungültige Anfrage; ohne sie im Schema würde aus dem 400 ein 500. */
const ValidationError = FastifyErrorBody;
const LandscapeError = Type.Object({
    error: Type.Union([
        Type.Literal("too_many_points"),
        Type.Literal("too_long"),
        Type.Literal("busy"),
        Type.Literal("database_unavailable"),
    ]),
});

export const landscapeRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Die laufenden Abfragen dieses Prozesses (Semaphor). Mehr als zwei belegten den Pool des Servers.
    let running = 0;

    app.post(
        "/api/route/landscapes",
        {
            config: { writeClass: "public" },
            bodyLimit: ROUTE_LANDSCAPE_LIMITS.bodyBytes,
            schema: {
                body: RouteLandscapesRequest,
                response: {
                    200: RouteLandscapesResponse,
                    400: ValidationError,
                    // Zwei Absender: zu viele Punkte (wir) und ein Körper über 1 MB (Fastify, vor dem Lesen).
                    // Nur mit beiden Formen im Schema bleibt die zweite ein 413 statt eines 500.
                    413: Type.Union([LandscapeError, ValidationError]),
                    503: LandscapeError,
                },
            },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async (request, reply) => {
            if (!app.database) return reply.code(503).send({ error: "database_unavailable" });
            const { stages, unterwegs } = request.body;
            const points = stages.reduce(
                (sum, lines) => sum + lines.reduce((inner, line) => inner + line.length, 0),
                0,
            );
            if (points > ROUTE_LANDSCAPE_LIMITS.points) return reply.code(413).send({ error: "too_many_points" });
            if (routeLandscapeLength(stages) > ROUTE_LANDSCAPE_LIMITS.lengthUnits) {
                return reply.code(413).send({ error: "too_long" });
            }
            if (running >= ROUTE_LANDSCAPE_LIMITS.concurrent) {
                void reply.header("Retry-After", "2");
                return reply.code(503).send({ error: "busy" });
            }
            running += 1;
            const closed = watchClientClose(reply);
            // Neben den Landschaften, nicht danach: Die Antwort wartet nur auf die längere der beiden Rechnungen. Ein Fehler hier nimmt den Landschaften nichts.
            const mitfahrt =
                unterwegs === undefined
                    ? undefined
                    : rechneUnterwegs(app, unterwegs.stages).catch((error: unknown) => {
                          request.log.warn({ err: error }, "unterwegs beside the landscapes failed");
                          return "database_unavailable" as const;
                      });
            try {
                const antwort = await routeLandscapes(app.database, stages, undefined, undefined, closed.signal);
                if (mitfahrt === undefined) return antwort;
                const vorkommen = await mitfahrt;
                return typeof vorkommen === "string" ? antwort : { ...antwort, unterwegs: vorkommen };
            } catch (error) {
                // 🔴 Der Client hat die Anfrage geschlossen (der Browser bricht die alte Frage bei jeder neuen Route
                // ab, Nginx meldet 499): Die Abfrage ist abgebrochen, ihr Fehler (57014) betrifft niemanden mehr,
                // und niemand liest eine Antwort. `hijack`: Fastify schreibt nichts mehr, die Verbindung ist zu. Der
                // Platz wird unten frei, sobald die Datenbank ruht.
                if (closed.signal.aborted) {
                    request.log.info("client closed the request, landscape query cancelled");
                    return reply.hijack();
                }
                throw error;
            } finally {
                closed.release();
                running -= 1;
            }
        },
    );
};
