import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    parseMapPointId,
    SHARE_CODE_PATTERN,
    SHARE_LIMITS,
    ShareCreated,
    ShareError,
    SharePayload,
    ShareResolved,
    type WaypointHit,
    FastifyErrorBody,
} from "@avesmaps3d/shared";

/**
 * Die Kurzlinks (WI-0034): `POST /api/share` legt einen an, `GET /api/share/<code>` löst ihn auf.
 *
 * 🔴 **Der erste Schreibpfad, den Besucher auslösen.** Deshalb: nur ein Zustand aus festen Werten
 * (Schema streng, kein Freitext), höchstens 16 KB, nur von der eigenen Seite (`Origin`), gedrosselt
 * je IP und am Tag. Davor steht die Drossel im vhost (Claudio).
 *
 * 🪤 Die Client-IP kommt aus `request.ip`, und die ist nur richtig, weil die App nur dem Proxy auf
 * derselben Maschine traut (`trustProxy: "loopback"` in `app.ts`). Mit `trustProxy: true` gewänne der
 * linke, vom Client fälschbare Eintrag in `X-Forwarded-For`.
 */

/** Fastifys eigene Antwort auf eine ungültige Anfrage; ohne sie im Schema würde aus dem 400 ein 500. */
const ValidationError = FastifyErrorBody;

/** Ein Kurzlink wird nur von der eigenen Seite angelegt: `Origin` muss zum `Host` passen. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin || !host) return false;
    try {
        return new URL(origin).host.toLowerCase() === host.toLowerCase();
    } catch {
        return false;
    }
}

export const shareRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        "/api/share",
        {
            config: { writeClass: "public" },
            bodyLimit: SHARE_LIMITS.bodyBytes,
            schema: {
                body: SharePayload,
                response: {
                    200: ShareCreated,
                    201: ShareCreated,
                    400: ValidationError,
                    403: ShareError,
                    429: ShareError,
                    503: ShareError,
                },
            },
            // Vor allem anderen, auch vor dem Lesen des Körpers: Nichts davon wird gespeichert.
            onRequest: async (request, reply) => {
                void reply.header("cache-control", "no-store");
                if (!isSameOrigin(request.headers.origin, request.headers.host)) {
                    return reply.code(403).send({ error: "forbidden_origin" });
                }
            },
        },
        async (request, reply) => {
            if (!app.shareService) return reply.code(503).send({ error: "database_unavailable" });
            const outcome = await app.shareService.create(request.body, request.ip);
            switch (outcome.kind) {
                case "created":
                    return reply.code(201).send({ code: outcome.code });
                case "existing":
                    return reply.code(200).send({ code: outcome.code });
                case "rate_limited":
                case "daily_budget":
                    request.log.warn({ outcome: outcome.kind }, "Kurzlink gedrosselt");
                    return reply.code(429).send({ error: outcome.kind });
            }
        },
    );

    app.get(
        "/api/share/:code",
        {
            schema: {
                params: Type.Object({ code: Type.String({ pattern: SHARE_CODE_PATTERN }) }),
                response: { 200: ShareResolved, 400: ValidationError, 404: ShareError, 503: ShareError },
            },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async (request, reply) => {
            if (!app.shareService || !app.waypointIndex) return reply.code(503).send({ error: "database_unavailable" });
            const stored = await app.shareService.read(request.params.code);
            // 🔴 Ein 404 wird nie gecacht: Ein korrigierter Tippfehler oder ein später vergebener Code
            // bliebe sonst einen Tag lang unauffindbar (Claudio).
            if (!stored) return reply.code(404).send({ error: "unknown_code" });

            const { waypoints } = stored.payload;
            const placeIds = waypoints.filter((id) => parseMapPointId(id) === null);
            const found = await app.waypointIndex.byIds(placeIds);
            let next = 0;
            // Ein Kartenpunkt trägt seine Lage selbst (`null`); ein verschwundener Ort ist ebenfalls `null`. Eine Landmarke (`l:<uuid>`,
            // WI-0271 L6) löst der Index auf wie einen Ort: mit ihrer Lage von heute, `null`, wenn sie stillgelegt ist oder kein Reiseziel mehr.
            const places: (WaypointHit | null)[] = waypoints.map((id) =>
                parseMapPointId(id) === null ? (found[next++] ?? null) : null,
            );
            // Ein Code ändert sich nie. Die Orte dahinter können umbenannt werden - ein Tag Verzug schadet nicht.
            void reply.header("cache-control", "public, max-age=86400");
            return { code: stored.code, payload: stored.payload, places };
        },
    );
};
