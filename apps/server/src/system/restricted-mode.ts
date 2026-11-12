import type { FastifyInstance } from "fastify";
import type { Gate } from "../auth/gate.ts";
import { apiErrorBody } from "../http/api-error.ts";
import { modeKnown } from "./restricted-access.ts";

/**
 * Der eingeschränkte Betrieb in der Anwendung selbst (WI-0127 SYS-3, SYS-0001 §4.4): auch ohne Nginx davor (lokal, über die Schleife,
 * ein Fehler im vhost). Ist die Stellung `restricted`, lehnt die Anwendung jede Anfrage ohne Zugangsrecht mit 503 `restricted_mode` und
 * `Retry-After: 60` ab, außer den Sicherheitswegen der Anmeldung (`/api/auth/*` samt Tür), der Gesundheit und dem Inhaltsstand.
 *
 * Zugangsrecht heißt dasselbe wie an der Tür und an `/ws`: `access_restricted_mode` mit zweitem Faktor (`holdsRestrictedAccess`). Die
 * Antwort kommt aus dem Speicher der Tür (`gate.access`), also ohne Datenbankfrage je Kachel; ein Entzug wirkt über denselben Kanal.
 *
 * - 🔴 **Im Normalbetrieb liest der Haken nichts**, weder Cookie noch Sitzung: öffentliche Lesepfade bleiben wie heute (AUTH-0001
 *   §6.1).
 * - **Unbekannter Zustand** (Zeile unlesbar, Datenbank weg): Der Haken lässt durch, wie SYS-0001 §4.4 ihn beschreibt (nur
 *   `restricted`). Fail-closed ist dort die Tür (nicht bereit: 503, Nginx zeigt die Störungsseite) und der Schreibweg (`map` und
 *   `system`: 503 `system_state_unknown`, SYS-4). Sicherheitshandgriffe (sperren, Sitzungen beenden) müssen gerade dann gehen, wenn
 *   die Zeile unlesbar ist, die Datenbank aber antwortet (SYS-4, WI-0127 §10.4 C2); ein Haken, der sie anhielte, nähme der Verwaltung
 *   ihren Notgriff.
 * - Er wirkt nur mit eingerichteter Anmeldung (`AVESMAPS_ENV`) und einem Betriebszustand (Datenbank); ohne Anmeldung gibt es kein
 *   Zugangsrecht, ohne Datenbank keinen Zustand, und beides gilt nur für Tests und Werkzeuge (wie der Einlass von `/ws`).
 * - Er antwortet selbst, statt zu werfen: Die Routenschemas der Karte kennen für 503 nur ihre eigene Form, und an ihnen würde der
 *   Umschlag sonst scheitern. Entschieden wird an der gefundenen Route (`routeOptions.url`), nie am rohen Pfad.
 */

/** Was ohne Zugangsrecht offen bleibt (SYS-0001 §4.4): Anmeldung samt Tür, Gesundheit, der Stand der Inhaltsschalter (SYS-10). */
export function freeInRestrictedMode(method: string, route: string | undefined): boolean {
    if (route === undefined) return false;
    if (route.startsWith("/api/auth/")) return true;
    if (route === "/health" || route.startsWith("/health/")) return true;
    return (method === "GET" || method === "HEAD") && route === "/api/content-state";
}

export const RESTRICTED_RETRY_AFTER_S = 60;

export function registerRestrictedMode(app: FastifyInstance, gate: Gate): void {
    if (app.authConfig.environment === undefined) return;
    app.addHook("onRequest", async (request, reply) => {
        const snapshot = app.systemState?.snapshot();
        if (!modeKnown(snapshot) || snapshot.mode !== "restricted") return;
        if (freeInRestrictedMode(request.method, request.routeOptions.url)) return;
        let admitted = false;
        try {
            admitted = (await gate.access(request.headers.cookie)).restricted;
        } catch {
            // Sitzung nicht lesbar (Datenbank weg): ohne Nachweis kein Zugang.
        }
        if (admitted) return;
        return reply
            .code(503)
            .header("cache-control", "no-store")
            .header("retry-after", String(RESTRICTED_RETRY_AFTER_S))
            .type("application/json; charset=utf-8")
            .send(
                JSON.stringify(
                    apiErrorBody(
                        "restricted_mode",
                        "Avesmaps ist gerade eingeschränkt: Nur berechtigte Personen kommen hinein.",
                    ),
                ),
            );
    });
}
