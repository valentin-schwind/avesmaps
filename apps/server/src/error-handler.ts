import type { FastifyError, FastifyInstance } from "fastify";
import { AUTH_NOT_READY, AUTH_PREFIXES } from "./auth/plugin.ts";
import { isDatabaseUnavailable, isLockTimeout, isNotProvisioned } from "./database.ts";
import { ApiError, apiErrorBody, envelopeForFrameworkError } from "./http/api-error.ts";

/** Wie lange ein Client nach `database_unavailable` warten soll, in Sekunden. */
const DATABASE_RETRY_AFTER = "5";
/** Nach `database_busy` (eine Sperre, kein Ausfall) reicht ein kurzer Moment. */
const BUSY_RETRY_AFTER = "2";
/** Der Satz zu `database_busy` (Hauptorchestrierung 2026-10-19: nicht „Datenbank nicht erreichbar“, wenn nur eine Sperre wartete). */
export const DATABASE_BUSY = "Gerade beschäftigt; in ein paar Sekunden geht es wieder.";

/**
 * Die Meldung zu 503, wenn einer VERWALTUNGSroute Schema oder Recht fehlt.
 *
 * 🔴 Sie muss sagen, was wirklich fehlt. Vorher lief jeder solche Fehler unter `/api/admin/` als `auth_unavailable`
 * hinaus — „Die Anmeldung ist auf dieser Instanz nicht eingerichtet.“ Als der Freigabe-Knopf an einem fehlenden
 * Recht auf `avesmaps_kanal.vorgang` scheiterte, schickte genau dieser Satz den Betreiber in die Irre: Er suchte
 * bei der Anmeldung, der Fehler lag in den Grants (Claudios Befund 2026-10-14).
 */
export const NOT_PROVISIONED =
    "Dieser Teil ist auf dieser Instanz noch nicht eingerichtet: eine Migration oder ein Recht fehlt.";

/**
 * Das feste Kürzel einer Ablehnung fürs Log (OPS-000079, Claudio 2026-11-03: Er sah nur `validation_failed`, nicht welche Regel): `details.reason`, sonst das Feld oder bei Fastifys
 * Schemafehlern Pfad und Regel. Nie der Satz, nie Geometrie oder Personendaten; was nicht wie ein Kürzel aussieht, bleibt draußen.
 */
export function grundDerAblehnung(details: Record<string, unknown> | undefined): string | undefined {
    const issues = details?.["issues"];
    const erstes = Array.isArray(issues) ? (issues[0] as { path?: unknown; rule?: unknown } | undefined) : undefined;
    const kandidat =
        typeof details?.["reason"] === "string"
            ? details["reason"]
            : typeof details?.["field"] === "string"
              ? `feld:${details["field"]}`
              : erstes === undefined
                ? undefined
                : `schema:${String(erstes.path)}:${String(erstes.rule)}`;
    return kandidat !== undefined && /^[\w:./-]{1,100}$/.test(kandidat) ? kandidat : undefined;
}

/**
 * Ein Fehlerhandler für die ganze Anwendung (WI-0037, S-02). Fastifys Standard schreibt `message` und
 * `code` jedes ungefangenen Fehlers in die Antwort; aus einem Datenbankausfall wurden so Rollenname,
 * Host, Port und Schema öffentlich (Kap. 10.92, 10.100).
 *
 * - Ein `ApiError` (ADR-0018) geht mit seinem Status und Code im Umschlag `{ error: { code, message, details? } }` hinaus.
 * - Routen mit `config.errorEnvelope` (ADR-0018) bekommen auch Fastifys eigene Antworten (400, 413, 415), den
 *   Datenbankausfall und jeden anderen Fehler im Umschlag.
 * - Alle übrigen Routen wie bisher: unter 500 Fastifys Standard (die Routenschemas führen `FastifyErrorBody`),
 *   ein Datenbankausfall 503 `{ error: "database_unavailable" }` mit `Retry-After`, alles andere 500 `internal_error`.
 *
 * 🔴 Das Protokoll bleibt vollständig: Meldung, Code und Stack gehen ins Log, nur nicht zum Client. Eine Ablehnung trägt dort ihr Kürzel (`grund`).
 * 🪤 Ein 503-Schema einer Route muss `database_unavailable` zulassen, und kein Schema darf einen 500
 * führen. Sonst scheitert die Serialisierung, und Fastify antwortet mit seiner eigenen Meldung.
 */
export function registerErrorHandler(app: FastifyInstance): void {
    app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
        const envelope = request.routeOptions.config.errorEnvelope === true;
        if (error instanceof ApiError) {
            if (error.statusCode >= 500) request.log.error({ req: request, err: error }, error.message);
            else
                request.log.info(
                    { code: error.code, status: error.statusCode, grund: grundDerAblehnung(error.details) },
                    "api error",
                );
            void reply.header("cache-control", "no-store");
            // Eine Drossel sagt, wann es wieder geht, auch in der Kopfzeile (RFC 9110; WI-0120 A12, AUTH-0001 T7). Ein 503 sagt es
            // immer, etwa `system_state_unknown` (SYS-0001 §4.6): ohne eigene Angabe wie beim Datenbankausfall.
            const retryAfter = error.details?.["retryAfterSeconds"];
            if ((error.statusCode === 429 || error.statusCode === 503) && typeof retryAfter === "number")
                void reply.header("retry-after", String(Math.max(1, Math.ceil(retryAfter))));
            else if (error.statusCode === 503) void reply.header("retry-after", DATABASE_RETRY_AFTER);
            return reply.code(error.statusCode).send(apiErrorBody(error.code, error.message, error.details));
        }
        // Was an der Anmeldung hängt, sagt vor `migrate`/`db-grants` 503 statt 500 (Claudio 2026-10-09); anderswo bleibt es 500.
        if (isNotProvisioned(error) && AUTH_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
            request.log.error({ req: request, err: error }, error.message);
            void reply.header("cache-control", "no-store");
            // 🔴 Nur die Anmeldewege sagen „Anmeldung“. `/api/admin/` ist Verwaltung: Dort heißt ein fehlendes Recht,
            //    dass dieser Teil nicht eingerichtet ist — nicht, dass niemand sich anmelden kann.
            const anmeldung = request.url.startsWith("/api/auth/") || request.url.startsWith("/api/account/");
            return anmeldung
                ? reply.code(503).send(apiErrorBody("auth_unavailable", AUTH_NOT_READY))
                : reply.code(503).send(apiErrorBody("not_provisioned", NOT_PROVISIONED));
        }
        const unavailable = isDatabaseUnavailable(error);
        if (!unavailable && (error.statusCode ?? 500) < 500) {
            if (!envelope) {
                // Weiter an Fastifys Standard: er loggt auf `info` und antwortet in seiner bekannten Form.
                throw error;
            }
            const mapped = envelopeForFrameworkError(error);
            request.log.info(
                { code: error.code, status: error.statusCode, grund: grundDerAblehnung(mapped.body.error.details) },
                error.message,
            );
            void reply.header("cache-control", "no-store");
            return reply.code(mapped.status).send(mapped.body);
        }
        reply.code(unavailable ? 503 : 500);
        request.log.error({ req: request, res: reply, err: error }, error.message);
        void reply.header("cache-control", "no-store");
        // Eine Sperre (55P03) ist kein Ausfall: Im Umschlag sagt es `database_busy`; ältere Routen kennen nur `database_unavailable`.
        if (unavailable && envelope && isLockTimeout(error)) {
            void reply.header("retry-after", BUSY_RETRY_AFTER);
            return reply.send(apiErrorBody("database_busy", DATABASE_BUSY));
        }
        if (unavailable) {
            void reply.header("retry-after", DATABASE_RETRY_AFTER);
            return reply.send(
                envelope
                    ? apiErrorBody("database_unavailable", "Die Datenbank ist gerade nicht erreichbar.")
                    : { error: "database_unavailable" },
            );
        }
        return reply.send(
            envelope
                ? apiErrorBody("internal_error", "Ein interner Fehler ist aufgetreten.")
                : { error: "internal_error" },
        );
    });
}
