import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AdminSystemOverview,
    OperationReceipt,
    SystemLockBody,
    SystemModeBody,
    SystemQueueBody,
    type AdminSystemBrief,
    type SystemEffectiveState,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Database } from "../database.ts";
import {
    gemeinsameWarteschlange,
    leseEigeneAnweisung,
    pauseAnsicht,
    reiheZaehlen,
    wirksam,
} from "../jobs/gemeinsame-reihe.ts";
import { standJetzt, type StandLage } from "../jobs/stand-datei.ts";
import {
    SYSTEM_STATE_REF,
    changeLock,
    changeMode,
    changeQueuePause,
    restrictedAccessHolders,
} from "../system/state-changes.ts";
import { isMissingTable, readStateRow, stateView } from "../system/state-row.ts";
import { effectiveView } from "../system/state-store.ts";
import { systemStateUnknown } from "../system/write-guard.ts";

/**
 * Der Betriebszustand in der Verwaltung (WI-0127 SYS-2, SYS-0001 §4.2, §4.5):
 *
 *     GET  /api/admin/system         eingestellt, wirksam auf dieser Instanz, Inhaber des Zugangsrechts,  view_operations (V)
 *                                    Kurzstatus „Betrieb im Moment“ (SYS-5)
 *     POST /api/admin/system/mode    { operationId, baseRevision, mode, reason? }                         manage_system_settings (S)
 *     POST /api/admin/system/lock    { operationId, baseRevision, lock, locked, reason? }                 manage_system_settings (S)
 *     POST /api/admin/system/queue   { operationId, baseRevision, paused, reason? }                       manage_system_settings (S)
 *
 * Stufe S heißt: ein frischer Passkey (≤ 5 min) genau im Moment des Umschaltens (E5); Lesen braucht ihn nicht. Jede Handlung läuft
 * über `adminOperation` (`runOperation` mit der Verwaltungssperre der Umgebung): höchstens einmal je `operationId`, genau ein
 * Protokolleintrag, 409 `edit_conflict` bei veralteter `baseRevision`. Die eigene Instanz liest danach sofort neu; die übrigen
 * weckt das `NOTIFY` der Migration 0087.
 *
 * Beide Handlungen sind Schreibklasse `security` (SYS-4): Keine Sperre hält das Umschalten an, sonst sperrte sie sich selbst ein.
 *
 * 🔴 **Die gemeinsame Warteschlange** (WI-0163 §1.6, §1.7): Mit dem Stand des Dirigenten (`QUEUE_STAND_FILE`) trägt die Antwort die
 * wirksame Pause über alle Umgebungen und die gemeinsame Reihe (`warteschlange`), der Kurzstatus zählt die gemeinsame Reihe, und
 * `/queue` vergleicht den Wunsch mit der WIRKSAMEN Pause. Ohne die Datei gilt die eigene Zeile wie bis WI-0163.
 */

/**
 * Weiß diese Instanz ihren Zustand nicht, schaltet sie nichts (fail-closed, §4.4): 503 mit `Retry-After`. Kein Nachlesen in der
 * Anfrage: Bei toter Datenbank hinge sie sonst bis zur Zeitgrenze der Verbindung; der Takt liest ohnehin alle 5 s.
 */
function requireKnownState(app: FastifyInstance): void {
    if (app.systemState !== undefined && app.systemState.snapshot().source !== "unknown") return;
    throw systemStateUnknown();
}

/** Seit wann dieser Prozess läuft; für den Kurzstatus „Release …, seit …“ und den Systemzustand (SYS-8). */
export const STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/**
 * Laufende und wartende Jobs für den Kurzstatus; `null`, wenn sich die Warteschlange nicht lesen lässt (Tabelle fehlt, Datenbank
 * weg). Eine Abfrage mit zwei Zählern statt der Listen der Statusseite: Hier steht nur die Zahl.
 */
async function queueCounts(database: Database): Promise<AdminSystemBrief["queue"]> {
    try {
        const [row] = await database<{ running: number; queued: number }[]>`
            SELECT count(*) FILTER (WHERE state = 'RUNNING')::int AS running,
                   count(*) FILTER (WHERE state = 'QUEUED')::int AS queued
              FROM job
        `;
        return row === undefined ? null : { running: row.running, queued: row.queued };
    } catch {
        return null;
    }
}

/**
 * Der Kurzstatus „Betrieb im Moment“ (WI-0127 SYS-5, SYS-0001 §6.2): die eigene Bereitschaft für Karte und Anmeldung, der Routenrechner
 * wie `/health/routing` (Nginx reicht ihn nicht durch), die Warteschlange. Fragt nichts, was es nicht schon gibt.
 *
 * Mit Stand-Datei (WI-0163) zählt die Warteschlange die gemeinsame Reihe aller Umgebungen; ist der Stand unbekannt, ist sie `null`
 * („Warteschlange unbekannt“), nie die eigene Zahl, die „läuft“ vortäuschen würde.
 */
async function brief(
    app: FastifyInstance,
    effective: SystemEffectiveState,
    lage: StandLage,
): Promise<AdminSystemBrief> {
    const ready = effective.ready ? ("ready" as const) : ("failed" as const);
    return {
        now: new Date().toISOString(),
        releaseId: app.config.releaseId,
        startedAt: STARTED_AT,
        map: ready,
        login: app.config.auth?.environment === undefined ? "off" : ready,
        routing: app.routeRunner?.status().state ?? "failed",
        queue: lage.zustand === "nicht_eingerichtet" ? await queueCounts(app.database!) : reiheZaehlen(lage),
    };
}

export const adminSystemRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/system",
        { ...protect("view_operations"), schema: { response: { 200: AdminSystemOverview, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await adminSession(request);
            const database = app.database!;
            let configured: AdminSystemOverview["configured"] = null;
            try {
                const row = await readStateRow(database);
                configured = row === undefined ? null : await stateView(database, row);
            } catch (error) {
                if (!isMissingTable(error)) throw error;
            }
            const holders = await restrictedAccessHolders(database, environment);
            const snapshot = app.systemState?.snapshot();
            const effective: SystemEffectiveState =
                snapshot === undefined
                    ? {
                          source: "unknown",
                          mode: null,
                          mapLock: null,
                          systemLock: null,
                          revision: null,
                          contentRevision: null,
                          readAt: null,
                          ready: false,
                      }
                    : effectiveView(snapshot);
            const stand = await standJetzt(app.warteschlangeStand);
            const pause =
                stand.lage.zustand === "ok"
                    ? await pauseAnsicht(database, stand.lage, stand.umgebung, await leseEigeneAnweisung(database), {
                          full: true,
                      })
                    : null;
            const warteschlange = gemeinsameWarteschlange(stand.lage, stand.umgebung, pause);
            return {
                configured,
                effective,
                restrictedAccessHolders: holders.map((holder) => ({
                    person: { id: holder.id, displayName: holder.displayName },
                    hasPasskey: holder.hasPasskey,
                })),
                brief: await brief(app, effective, stand.lage),
                ...(warteschlange === undefined ? {} : { warteschlange }),
            };
        },
    );

    app.post(
        "/api/admin/system/mode",
        {
            ...protect("manage_system_settings", { writeClass: "security" }),
            schema: { body: SystemModeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            requireKnownState(app);
            const { operationId, baseRevision, mode } = request.body;
            const reason = request.body.reason?.trim() || undefined;
            const environment = session.environment;
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "system.mode", baseRevision, mode, reason } },
                async (tx) => {
                    const change = await changeMode(tx, {
                        environment,
                        mode,
                        reason,
                        baseRevision,
                        actor: { kind: "person", personId: session.personId },
                    });
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: SYSTEM_STATE_REF, id: "1", revision: change.revision }],
                            derivedWork: [],
                            warnings: change.warnings,
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.mode_changed",
                            targetRef: SYSTEM_STATE_REF,
                            details: { from: change.from, to: change.to, reason: change.reason },
                        },
                    };
                },
            );
            await app.systemState?.refresh();
            return receipt;
        },
    );

    app.post(
        "/api/admin/system/lock",
        {
            ...protect("manage_system_settings", { writeClass: "security" }),
            schema: { body: SystemLockBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            requireKnownState(app);
            const { operationId, baseRevision, lock, locked } = request.body;
            const reason = request.body.reason?.trim() || undefined;
            const environment = session.environment;
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "system.lock", baseRevision, lock, locked, reason } },
                async (tx) => {
                    const change = await changeLock(tx, {
                        environment,
                        lock,
                        locked,
                        reason,
                        baseRevision,
                        actor: { kind: "person", personId: session.personId },
                    });
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: SYSTEM_STATE_REF, id: "1", revision: change.revision }],
                            derivedWork: [],
                            warnings: change.warnings,
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.lock_changed",
                            targetRef: SYSTEM_STATE_REF,
                            details: { lock, from: change.from, to: change.to, reason: change.reason },
                        },
                    };
                },
            );
            await app.systemState?.refresh();
            return receipt;
        },
    );

    /**
     * Die Warteschlange pausieren oder fortsetzen (WI-0160, Claudios Entwurf §5). Dieselbe Form wie `/lock`: Stufe S mit frischem
     * Passkey, `baseRevision`, genau ein Protokolleintrag, Schreibklasse `security` (eine Pause unter Sperre schalten zu dürfen ist
     * dasselbe Argument wie bei den Sperren selbst).
     *
     * 🪤 Kein `app.systemState?.refresh()` wegen der Wirkung: Die Pause liest der Claim in der Datenbank und der Worker aus der
     * Datenbank, nicht aus dem Speicher der Fastify-Instanz. Der Aufruf steht trotzdem, damit die Antwort der Verwaltung sofort die
     * neue Revision trägt und „eingestellt gegen wirksam“ nicht grundlos nachzieht.
     *
     * 🔴 Mit frischem Stand des Dirigenten (WI-0163) zählt die WIRKSAME Pause über alle Umgebungen: 409 `no_change` nur, wenn der
     * Wunsch schon wirkt; sonst wird die eigene Zeile geschrieben, auch wenn sie den Wunschwert schon trug. Ohne frischen Stand
     * (keine Datei, unbekannt, veraltet) vergleicht sie mit der eigenen Zeile.
     */
    app.post(
        "/api/admin/system/queue",
        {
            ...protect("manage_system_settings", { writeClass: "security" }),
            schema: { body: SystemQueueBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            requireKnownState(app);
            const { operationId, baseRevision, paused } = request.body;
            const reason = request.body.reason?.trim() || undefined;
            const environment = session.environment;
            const lage = await app.warteschlangeStand.lage();
            const jetzt = wirksam(lage, app.warteschlangeStand.umgebung, await leseEigeneAnweisung(app.database!));
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "system.queue", baseRevision, paused, reason } },
                async (tx) => {
                    const change = await changeQueuePause(tx, {
                        paused,
                        reason,
                        baseRevision,
                        actor: { kind: "person", personId: session.personId },
                        wirksam: jetzt === undefined ? undefined : { paused: jetzt.paused },
                    });
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: SYSTEM_STATE_REF, id: "1", revision: change.revision }],
                            derivedWork: [],
                            warnings: change.warnings,
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.queue_changed",
                            targetRef: SYSTEM_STATE_REF,
                            details: { from: change.from, to: change.to, reason: change.reason },
                        },
                    };
                },
            );
            await app.systemState?.refresh();
            return receipt;
        },
    );
};
