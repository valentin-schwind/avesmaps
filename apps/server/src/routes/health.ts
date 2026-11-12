import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    HealthModeResponse,
    LivenessResponse,
    ReadinessResponse,
    RoutingHealthResponse,
    type SystemEffectiveState,
} from "@avesmaps3d/shared";
import { probeDatabase } from "../database.ts";
import { readStateRow } from "../system/state-row.ts";
import { effectiveView } from "../system/state-store.ts";

/** Direkt verbunden über die Schleife (127.0.0.0/8, ::1). Über Nginx kommt `request.ip` aus `X-Forwarded-For` und ist es nie. */
export function isLoopback(address: string): boolean {
    return /^(127\.|::1$|::ffff:127\.)/u.test(address);
}

const UNKNOWN_STATE: SystemEffectiveState = {
    source: "unknown",
    mode: null,
    mapLock: null,
    systemLock: null,
    revision: null,
    contentRevision: null,
    readAt: null,
    ready: false,
};

/**
 * Die Antwort des Fehlerhandlers (`error-handler.ts`) für jede Route: Das Schema einer Route mit 503 kennt sie, sonst
 * scheiterte die Serialisierung und aus dem 503 würde ein 500 (`route-error-shapes.test.ts`). `/health/routing` fragt
 * die Datenbank nie, der Fall tritt nicht ein; das Schema folgt trotzdem der Regel.
 */
const DatabaseUnavailable = Type.Object({ error: Type.Literal("database_unavailable") });

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/health",
        {
            schema: {
                response: { 200: LivenessResponse },
            },
        },
        async () => ({
            status: "ok" as const,
            releaseId: app.config.releaseId,
            uptimeSeconds: Math.round(process.uptime()),
        }),
    );

    app.get(
        "/health/ready",
        {
            schema: {
                response: { 200: ReadinessResponse, 503: ReadinessResponse },
            },
        },
        async (_request, reply) => {
            const checks: ReadinessResponse["checks"] = [];

            if (!app.database) {
                checks.push({ name: "database", status: "failed", detail: "DATABASE_URL is not configured" });
            } else {
                const probe = await probeDatabase(app.database);
                checks.push({
                    name: "database",
                    status: probe.isReachable ? "ok" : "failed",
                    detail: probe.detail,
                });
            }

            const isReady = checks.every((check) => check.status === "ok");
            const body: ReadinessResponse = {
                status: isReady ? "ready" : "degraded",
                releaseId: app.config.releaseId,
                checks,
            };
            return reply.code(isReady ? 200 : 503).send(body);
        },
    );

    /**
     * Ist der Routenrechner bereit (WI-0075 R5a)? 200 nur bei `ready`, sonst 503 mit dem Zustand. Gate für Blue/Green:
     * `/health/ready` 200 UND `/health/routing` 200, bevor ein neuer Server Verkehr bekommt.
     *
     * 🔴 Getrennt von `/health/ready`: Auf einer leeren Datenbank (Netz nicht ladbar) muss `/health/ready` 200 bleiben,
     * der Server ist gesund, nur ohne Daten. Die Antwort liest nur den Zustand der Steuerung, sie fragt weder die
     * Datenbank noch den Worker. Wie `/health/ready` nur von 127.0.0.1 gedacht: Wer sie prüft, spricht den Server
     * unmittelbar an (Nginx reicht nur `/health` und `/health/ready` durch; alles andere ist dort die Oberfläche).
     */
    app.get(
        "/health/routing",
        {
            schema: {
                response: { 200: RoutingHealthResponse, 503: Type.Union([RoutingHealthResponse, DatabaseUnavailable]) },
            },
        },
        async (_request, reply) => {
            const status = app.routeRunner?.status();
            // Ohne Datenbank gibt es keinen Rechner und wird nie einer: scheitern, nicht „kalt“ bleiben.
            const body: RoutingHealthResponse = status
                ? {
                      state: status.state,
                      releaseId: app.config.releaseId,
                      ageMs: status.ageMs,
                      ...(status.reason !== undefined ? { reason: status.reason } : {}),
                      ...(status.revision !== undefined ? { revision: status.revision } : {}),
                  }
                : { state: "failed", releaseId: app.config.releaseId, ageMs: 0, reason: "no_worker" };
            void reply.header("cache-control", "no-store");
            return reply.code(body.state === "ready" ? 200 : 503).send(body);
        },
    );

    /**
     * Der Betriebszustand dieser Instanz (WI-0127 SYS-2, SYS-0001 §4.2; Claudio 2026-10-09 Punkt 8): flach der WIRKSAME Zustand aus
     * dem Speicher, daneben der EINGESTELLTE frisch aus der Datenbank (`null`, wenn er sich nicht lesen lässt) und der Stand von
     * `LISTEN`. Claudios Postflight vergleicht beides mit seiner Probe von der öffentlichen Adresse. Immer 200: eine Anzeige, kein Gate.
     *
     * 🔴 Nur über die Schleife. Nginx reicht `/health/mode` nicht durch (dort ist es die Oberfläche); zusätzlich antwortet die Route
     * jeder Anfrage, die nicht unmittelbar von 127.0.0.1 oder ::1 kommt, wie einer unbekannten Adresse (404).
     */
    app.get("/health/mode", { schema: { response: { 200: HealthModeResponse } } }, async (request, reply) => {
        if (!isLoopback(request.ip)) return reply.callNotFound();
        const store = app.systemState;
        const snapshot = store?.snapshot();
        let configured: HealthModeResponse["configured"] = null;
        if (app.database !== undefined) {
            try {
                const row = await readStateRow(app.database);
                if (row !== undefined) {
                    configured = {
                        mode: row.mode,
                        mapLock: row.mapLock,
                        systemLock: row.systemLock,
                        revision: row.revision,
                        contentRevision: row.contentRevision,
                    };
                }
            } catch {
                // Nicht lesbar (Datenbank weg, Tabelle fehlt): eingestellt ist dann unbekannt, die Anzeige antwortet trotzdem.
            }
        }
        void reply.header("cache-control", "no-store");
        return {
            releaseId: app.config.releaseId,
            ...(snapshot === undefined ? UNKNOWN_STATE : effectiveView(snapshot)),
            listen:
                snapshot === undefined
                    ? { connected: false, generation: 0, lastResyncAt: null }
                    : {
                          connected: snapshot.listen.connected,
                          generation: snapshot.listen.generation,
                          lastResyncAt: snapshot.listen.lastResyncAt?.toISOString() ?? null,
                      },
            configured,
        };
    });

    /**
     * Welcher Checkout hier läuft (WI-0189, Review T2-06): Wurzel, Commit und ob `TILE_ROOT` und `MEDIA_ROOT` gesetzt sind. Die
     * Browsertests geben es zu Beginn aus, damit ein Lauf festhält, gegen welchen Fastify er lief; am 2026-10-04 und am 2026-10-08
     * maßen Sitzungen gegen einen fremden oder falsch gestarteten Server. 🔴 Nur auf dem Entwicklungsrechner (`releaseId` `dev`, auf
     * Stage und Production gibt es die Route gar nicht) und nur über die Schleife wie `/health/mode`.
     */
    if (app.config.releaseId === "dev") {
        const wurzel = fileURLToPath(new URL("../../../../", import.meta.url))
            .replace(/\\/g, "/")
            .replace(/\/$/, "");
        const gestartet = new Date().toISOString();
        app.get("/health/lokal", async (request, reply) => {
            if (!isLoopback(request.ip)) return reply.callNotFound();
            let commit: string | null = null;
            try {
                commit = execFileSync("git", ["-C", wurzel, "rev-parse", "--short=8", "HEAD"], {
                    encoding: "utf8",
                }).trim();
            } catch {
                // Kein git oder kein Repository: Der Rest der Antwort gilt trotzdem.
            }
            void reply.header("cache-control", "no-store");
            return {
                checkout: wurzel,
                commit,
                tileRoot: Boolean(process.env["TILE_ROOT"]),
                mediaRoot: Boolean(process.env["MEDIA_ROOT"]),
                pid: process.pid,
                gestartet,
            };
        });
    }
};
