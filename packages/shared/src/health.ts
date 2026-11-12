import { Type, type Static } from "@sinclair/typebox";

/**
 * Liveness contract (chapter 10.89). Deliberately dependency free: it answers whether the
 * process itself is alive, not whether its dependencies are reachable.
 */
export const LivenessResponse = Type.Object(
    {
        status: Type.Literal("ok"),
        releaseId: Type.String(),
        uptimeSeconds: Type.Number(),
    },
    { $id: "LivenessResponse", additionalProperties: false },
);

export type LivenessResponse = Static<typeof LivenessResponse>;

/**
 * Readiness contract (chapter 10.90). Reports per dependency, never secrets (chapter 10.92).
 */
export const ReadinessResponse = Type.Object(
    {
        status: Type.Union([Type.Literal("ready"), Type.Literal("degraded")]),
        releaseId: Type.String(),
        checks: Type.Array(
            Type.Object(
                {
                    name: Type.String(),
                    status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
                    detail: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { $id: "ReadinessResponse", additionalProperties: false },
);

export type ReadinessResponse = Static<typeof ReadinessResponse>;

/**
 * Der Zustand des Routenrechners (WI-0075 R5a, `GET /health/routing`). Die Bereitschaftsprüfung `/health/ready` meint
 * nur „Datenbank erreichbar“; ob der Routing-Worker sein Netz geladen hat, sagt erst diese. Beide bleiben getrennt: Auf
 * einer leeren Datenbank (Netz nicht ladbar) bleibt `/health/ready` 200, `/health/routing` meldet `failed`.
 *
 * - `cold`: noch kein Worker gestartet (oder der Server schließt).
 * - `warming`: Der Worker lädt Netz, Standardprofil und Ortsindex vor.
 * - `ready`: Er hat sie geladen (oder später eine Route berechnet); der Server antwortet 200.
 * - `failed`: Das Vorwärmen ist gescheitert, der Worker ist beendet oder wurde ersetzt, oder es gibt keinen (ohne
 *   Datenbank). Der Server antwortet 503.
 */
export const RoutingState = Type.Union([
    Type.Literal("cold"),
    Type.Literal("warming"),
    Type.Literal("ready"),
    Type.Literal("failed"),
]);

export type RoutingState = Static<typeof RoutingState>;

/**
 * Warum `failed`. Nie die Meldung des Fehlers: Sie kann Rollenname, Host und Port der Datenbank tragen (Kap. 10.92);
 * sie steht im Journal des Servers (`routing worker`).
 */
export const RoutingFailureReason = Type.Union([
    Type.Literal("warm_failed"),
    Type.Literal("worker_exited"),
    Type.Literal("worker_stuck"),
    Type.Literal("no_worker"),
]);

export type RoutingFailureReason = Static<typeof RoutingFailureReason>;

export const RoutingHealthResponse = Type.Object(
    {
        state: RoutingState,
        releaseId: Type.String(),
        /** Wie lange der Zustand schon gilt, in Millisekunden (bei `warming`: die bisherige Ladezeit). */
        ageMs: Type.Integer({ minimum: 0 }),
        /** Nur bei `failed`. */
        reason: Type.Optional(RoutingFailureReason),
        /**
         * Der Schlüssel des geladenen Datenstands (`routing_graph_revision`, WI-0125): Der Job `routing_reload` sieht daran, dass der
         * Worker die neue Revision geladen hat. Fehlt, solange keiner geladen ist.
         */
        revision: Type.Optional(Type.String({ pattern: "^[0-9a-f]{12}$" })),
    },
    { $id: "RoutingHealthResponse", additionalProperties: false },
);

export type RoutingHealthResponse = Static<typeof RoutingHealthResponse>;
