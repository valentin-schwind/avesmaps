import type { FastifyInstance } from "fastify";
import type { SessionRecord } from "../auth/session-store.ts";
import { statusViewOf } from "../auth/status-view.ts";
import { admitsInMode } from "../system/restricted-access.ts";

/** Der Hinweis am Zeiger, dass diese Instanz Bereichsereignisse über `/ws` sendet (Kanal `area`, WI-0125). */
export const LIVE_HEADER = "x-avesmaps-live";

/**
 * Gibt es `/ws` mit dem Kanal `area`? Nur dann hört eine Karte auf neue Kacheln; sonst versucht sie es gar nicht
 * erst (`map/terrain/terrain-live.ts`). `/ws` gibt es, wo die Statusseite an ist (`routes/realtime.ts`).
 *
 * 🔴 Der Hinweis ist eine Eigenschaft der INSTANZ, nicht der Daten. Deshalb trägt ihn jeder Zeiger, über den eine
 * Karte den Kanal entdecken kann - der des Geländes und der der Anzeigehöhen. Eine Karte ohne Grafikkarte liest den
 * Geländezeiger gar nicht erst (WI-0049, Betreiber 2026-09-27 „3: A“; ADR-0011 Punkt 4) und entdeckt den Kanal nur
 * über die Anzeigehöhen - deshalb steht er dort auf JEDER Antwort, auch auf einer 404: Ob Höhen abgeleitet sind,
 * sagt nichts darüber, ob die Instanz Ereignisse sendet. Welche Antworten ihn tragen, hält
 * `apps/server/test/live-hint.test.ts` fest.
 */
export function offersAreaEvents(app: FastifyInstance): boolean {
    return app.config.statusPage !== false && app.database !== undefined;
}

/**
 * Darf DIESE Sitzung den Kanal betreten (WI-0197)? Der Hinweis oben sagt nur, dass es ihn gibt. Wer am Handschlag abgewiesen
 * würde, soll es gar nicht erst versuchen: Der Browser schreibt jeden abgewiesenen Handschlag als Fehler in die Konsole, auf
 * Production bei jedem Besucher (gemessen 2026-10-16). `GET /api/auth/session` meldet es als `liveChannel`.
 *
 * 🔴 Dieselbe Regel wie `admit` in `routes/realtime.ts`: ohne eingerichtete Anmeldung jeder, sonst `statusViewOf` und im
 * eingeschränkten Betrieb `admitsInMode`. Die Herkunft prüft erst der Handschlag; ein Browser schickt sie von selbst.
 */
export function liveChannelFor(app: FastifyInstance, session: SessionRecord | undefined): boolean {
    if (!offersAreaEvents(app)) return false;
    const auth = app.authConfig;
    if (auth.environment === undefined) return true;
    const verdict = statusViewOf(session, auth);
    if (verdict === 401 || verdict === 403) return false;
    return admitsInMode(app.systemState?.snapshot(), session);
}
