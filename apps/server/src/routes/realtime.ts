import type { IncomingMessage } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import { getJobsConfig, type JobsConfig } from "@avesmaps3d/shared";
import { watchAuthChanges } from "../auth/change-watch.ts";
import { sessionCookieName } from "../auth/config.ts";
import { parseCookies } from "../auth/cookies.ts";
import { sameOriginHeaders } from "../auth/plugin.ts";
import { loadSession } from "../auth/session-store.ts";
import { statusViewOf } from "../auth/status-view.ts";
import { isWellFormedToken } from "../auth/tokens.ts";
import { jobsProfileName } from "../jobs/profile.ts";
import { JobEventHub } from "../realtime/hub.ts";
import { RealtimeServer, type RealtimeAdmission } from "../realtime/server.ts";
import { WS_CLOSE } from "../realtime/websocket.ts";
import { admitsInMode, modeKnown } from "../system/restricted-access.ts";

/**
 * `/ws` im Server (JOBS-0001 V5): der Grundkanal der Statusseite. Die Aufwertung läuft über das `upgrade`-Ereignis des HTTP-Servers,
 * Fastify selbst kennt keine WebSockets; Nginx reicht `Upgrade` für `= /ws` bereits durch (`staging-deploy.sh` D8).
 *
 * 🔴 Beim Beenden kommt `1001 going away` (im `preClose`, bevor der Listener schließt): Der Client verbindet mit Backoff und Jitter neu
 * und stellt sein Abonnement wieder her; HTTP holt den Stand. Eine Verbindung zum Hub (`LISTEN`) entsteht erst mit dem ersten Abonnenten.
 *
 * Mit eingerichteter Anmeldung (WI-0120 A11, AUTH-0001 §8): Der Handschlag prüft Herkunft, Sitzung und Recht wie die Statusrouten
 * (`statusViewOf`); das Cookie liest er selbst, weil der Handschlag an Fastify vorbeiläuft. Ändern sich Sitzung oder Rechte einer
 * Person, meldet die Datenbank das (`NOTIFY`, Migration 0081), und ihre Verbindungen werden neu geprüft.
 *
 * Im eingeschränkten Betrieb (WI-0127 SYS-4, SYS-0001 §4.4) kommen nur Personen mit `access_restricted_mode` und zweitem Faktor herein,
 * sonst 503; jeder Wechsel der Stellung prüft die offenen Verbindungen neu und schließt nicht zugelassene mit 4001.
 */

export interface RealtimeRoutesOptions {
    config?: JobsConfig;
    pingEveryMs?: number;
    idleTimeoutMs?: number;
    /** Wie oft der Einlass jeder Verbindung neu geprüft wird (ms); Tests nehmen einen kurzen Takt. */
    recheckEveryMs?: number;
}

export const realtimeRoutes: FastifyPluginAsync<RealtimeRoutesOptions> = async (app, options) => {
    const database = app.database;
    if (app.config.statusPage === false || !database) return;
    const config = options.config ?? getJobsConfig(app.config.jobsProfile ?? jobsProfileName(process.env));
    const auth = app.authConfig;
    const environment = auth.environment;

    /**
     * Der Einlass am Handschlag; ohne eingerichtete Anmeldung entfällt er (wie vor WI-0120). Im eingeschränkten Betrieb kommt nur
     * herein, wer `access_restricted_mode` mit zweitem Faktor hat (WI-0127 SYS-4, SYS-0001 §4.4), sonst 503; bei unbekanntem
     * Betriebszustand ebenso (fail-closed).
     */
    async function admit(request: IncomingMessage): Promise<RealtimeAdmission> {
        if (!sameOriginHeaders(request.headers, auth)) return { ok: false, status: 403 };
        const token = parseCookies(request.headers.cookie).get(sessionCookieName(auth));
        const load = () =>
            environment !== undefined && token !== undefined && isWellFormedToken(token)
                ? loadSession(database!, token, environment)
                : Promise.resolve(undefined);
        const session = await load();
        const verdict = statusViewOf(session, auth);
        if (verdict === 401 || verdict === 403) return { ok: false, status: verdict };
        if (!admitsInMode(app.systemState?.snapshot(), session)) return { ok: false, status: 503 };
        void watching();
        const viewer = {
            view: verdict.view,
            personId: verdict.personId,
            expiresAtMs: session?.expiresAt.getTime() ?? null,
        } as const;
        return {
            ok: true,
            viewer,
            recheck: async () => {
                const now = await load();
                const next = statusViewOf(now, auth);
                if (typeof next !== "object" || next.view !== viewer.view || next.personId !== viewer.personId)
                    return false;
                // Bei unbekanntem Zustand bleibt eine offene Verbindung stehen; der Handschlag danach ist fail-closed.
                const snapshot = app.systemState?.snapshot();
                return !modeKnown(snapshot) || admitsInMode(snapshot, now);
            },
        };
    }

    const hub = new JobEventHub(database, { log: app.log });
    const server = new RealtimeServer({
        hub,
        database,
        releaseId: app.config.releaseId,
        maxConnections: config.wsMaxConnections,
        log: app.log,
        ...(environment === undefined ? {} : { admit }),
        ...(options.pingEveryMs === undefined ? {} : { pingEveryMs: options.pingEveryMs }),
        ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
        ...(options.recheckEveryMs === undefined ? {} : { recheckEveryMs: options.recheckEveryMs }),
    });
    // Die `LISTEN`-Verbindung entsteht mit der ersten angenommenen Verbindung, wie beim Hub der Queue: bis dahin kostet sie nichts.
    let unwatch: Promise<() => Promise<void>> | undefined;
    const watching = (): Promise<() => Promise<void>> =>
        (unwatch ??= watchAuthChanges(
            database,
            (personId) => server.recheckPerson(personId),
            app.log,
            () => server.recheckAll(),
        ));

    // Jeder Wechsel der Stellung prüft alle offenen Verbindungen dieser Instanz neu (SYS-0001 §4.4): Wer im eingeschränkten Betrieb
    // nicht hereinkäme, bekommt 4001; die Sitzungen bleiben gültig und tragen nach dem Zurückschalten wieder.
    const unwatchState =
        environment === undefined
            ? undefined
            : app.systemState?.onChange((previous, next) => {
                  if (next.mode !== null && next.mode !== previous.mode) server.recheckAll();
              });

    app.server.on("upgrade", (request, socket, head) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/ws") {
            socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
            return;
        }
        server.handleUpgrade(request, socket, head);
    });

    app.addHook("preClose", async () => {
        server.closeAll(WS_CLOSE.goingAway, "going away");
    });
    app.addHook("onClose", async () => {
        unwatchState?.();
        server.stop();
        await (
            await unwatch
        )?.();
        await hub.close();
    });
};
