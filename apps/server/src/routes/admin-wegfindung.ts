import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AdminWegfindung,
    AVENTURIA,
    OperationReceipt,
    WEGFINDUNG_FREIGABE_URL,
    WEGFINDUNG_URL,
    WegfindungBody,
    WegfindungFreigabeBody,
    type SeegraphStand,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protectEines } from "../auth/plugin.ts";
import { gibWegfindungFrei, seegraphLage, verstelleWegfindung } from "../system/wegfindung.ts";
import {
    leseWegfindung,
    vergissWegfindungswerte,
    wegfindungModell,
    type Wegfindungsstand,
} from "../system/wegfindungsstand.ts";

/**
 * Die Kenngrößen der Wegfindung (WI-0153, Bauplan §9 Schnitt 3; Register `packages/shared/src/wegfindung.ts`):
 *
 *     GET  /api/admin/system/wegfindung             Werte, Freigabe und Auftrag                   view_operations (V)
 *     POST /api/admin/system/wegfindung             { operationId, baseRevision, id, value }  manage_system_settings (S)
 *     POST /api/admin/system/wegfindung/freigeben   { operationId, baseRevision }             manage_system_settings (S)
 *
 * - Verstellen ohne Grund und ohne Dialog, wie der Inhaltsschalter (`admin-inhalte.ts`): Zahl eintragen, der Browser fragt den
 *   Passkey (Stufe S). Genau ein Ereignis `system.routing_setting_changed` (`key`, `from`, `to`) in derselben Transaktion
 *   (Protokollpflicht, SYS-0001 §9d.2); `to: null` heißt zurück auf die Vorgabe.
 * - **Schreibklasse `system`:** Eine Kenngröße der Wegfindung ist eine Einstellung, kein Sicherheitshandgriff; unter
 *   Systemsperre 423. Das prüft der Wächter der Schreibklasse vor dem Handler (`registerWriteGuard`); ein zweiter Aufruf
 *   von `assertWritable` hier war aus der Vorlage kopiert und ist weg (WI-0214, Befund G2-08). Anders als beim Inhaltsschalter gibt es keine Richtung: Kein Wert dieses Reiters schützt etwas.
 * - `baseRevision` ist die Revision der Einstellungen (`routing_setting_state.revision`, Migration 0132); veraltet: 409
 *   `edit_conflict`. Unbekannte Kennung: 400 `unknown_setting`. Außerhalb der Grenzen: 400 `value_out_of_range`.
 * - 🔴 **Wirksam wird eine Änderung erst mit dem Freigeben** (Schnitt 6): Der achte Teil der Routing-Revision hängt an
 *   `routing_setting_applied`, und nur der Freigabeweg schreibt die Tafel fort. Bis dahin ist das Verstellen Speicher und
 *   Protokoll, und die Wegfindung rechnet unverändert weiter.
 */
const EVENT = "system.routing_setting_changed" as const;
const FREIGABE = "system.routing_settings_applied" as const;
const TARGET = "routing:settings" as const;

export const adminWegfindungRoutes: FastifyPluginAsyncTypebox = async (app) => {
    /**
     * Der Zustand des zuletzt eingereihten `routing_reload`, wie ihn die Warteschlange führt (`QUEUED`, `RUNNING`,
     * `SUCCEEDED` …). 🪤 Die Leiste erfindet keinen eigenen Zustand: Ist die Warteschlange pausiert (WI-0163), steht
     * der Auftrag auf `QUEUED`, und genau das zeigt sie. Scheitert das Lesen, fehlt nur die Angabe.
     */
    const jobZustand = async (stand: Wegfindungsstand): Promise<string | null> => {
        if (stand.freigabe.job === null) return null;
        try {
            const [row] = await app.database!<{ state: string }[]>`
                SELECT state FROM job WHERE public_id = ${stand.freigabe.job}::uuid
            `;
            return row?.state ?? null;
        } catch (error) {
            app.log.warn({ err: error }, "Wegfindung: Zustand des Auftrags nicht gelesen");
            return null;
        }
    };

    /**
     * Der Seegraph für die Leiste (WI-0153 7b; Betreiber 2026-10-18: „Seewege“ über den einen Knopf): passt er noch zu Meeren, Seen und
     * Häfen, und was macht seine Ableitung. Scheitert das Lesen, fehlt nur die Angabe (dann weckt er den Knopf nicht).
     */
    const seegraphStand = async (): Promise<SeegraphStand> => {
        try {
            // Ohne `wartendId`: Die Kennung des wartenden Auftrags braucht nur die Freigabe, nicht die Leiste.
            const lage = await seegraphLage(app.database!, AVENTURIA.mapDomain);
            return { derivedAt: lage.derivedAt, stale: lage.stale, job: lage.job, jobState: lage.jobState };
        } catch (error) {
            app.log.warn({ err: error }, "Wegfindung: Stand des Seegraphen nicht gelesen");
            return { derivedAt: null, stale: false, job: null, jobState: null };
        }
    };

    app.get(
        WEGFINDUNG_URL,
        {
            ...protectEines(["view_operations", "manage_routing"]),
            schema: { response: { 200: AdminWegfindung, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            const stand = await leseWegfindung(app.database!);
            return wegfindungModell(stand, new Date(), await jobZustand(stand), await seegraphStand());
        },
    );

    app.post(
        WEGFINDUNG_URL,
        {
            ...protectEines(["manage_system_settings", "manage_routing"], { confirm: "passkey", writeClass: "system" }),
            schema: { body: WegfindungBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, id, value } = request.body;
            const antwort = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wegfindung.set", id, value, baseRevision } },
                async (tx) => {
                    const result = await verstelleWegfindung(tx, {
                        id,
                        value,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TARGET,
                                actions: [EVENT],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT,
                            targetRef: TARGET,
                            details: { key: id, from: result.from, to: result.to },
                        },
                    };
                },
            );
            // Erst nach dem COMMIT: Die Lesestelle des Hauptthreads holt den neuen Stand mit der nächsten Anfrage (WI-0214).
            vergissWegfindungswerte(app.database);
            return antwort;
        },
    );

    /**
     * Der EINE Auslöser über den Panelen (Betreiber 2026-10-15: „schau dass es in der warteschlange landet"). Er
     * speichert nichts, er gibt frei: Der gespeicherte Stand wird der gerechnete, und `routing_reload` kommt in die
     * Warteschlange. Erst damit ändert sich die Routing-Revision, und erst damit holen sich die Worker den Stand.
     *
     * Schreibklasse `system` wie das Verstellen; dasselbe Recht, derselbe Passkey, dieselbe `baseRevision`.
     */
    app.post(
        WEGFINDUNG_FREIGABE_URL,
        {
            ...protectEines(["manage_system_settings", "manage_routing"], { confirm: "passkey", writeClass: "system" }),
            schema: { body: WegfindungFreigabeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision } = request.body;
            const antwort = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wegfindung.apply", baseRevision } },
                async (tx) => {
                    const result = await gibWegfindungFrei(tx, {
                        baseRevision,
                        mapDomainId: AVENTURIA.mapDomain,
                        actor: { personId: session.personId, label: session.displayName },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TARGET,
                                actions: [EVENT, FREIGABE],
                            }),
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            // Die Vorarbeit zuerst (Wegprofile bei geändertem Maßstab, WI-0153 7d; der Seegraph, 7c), dann das Laden.
                            derivedWork: [
                                ...result.vorarbeit.map((entry) => ({
                                    kind: entry.kind,
                                    jobId: entry.job,
                                    state: "queued" as const,
                                })),
                                ...(result.job === null
                                    ? []
                                    : [{ kind: "routing_reload", jobId: result.job, state: "queued" as const }]),
                            ],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: FREIGABE,
                            targetRef: TARGET,
                            details: { werte: result.werte, job: result.job, seegraph: result.seegraph },
                        },
                    };
                },
            );
            // Erst nach dem COMMIT: Die Lesestelle des Hauptthreads holt den neuen Stand mit der nächsten Anfrage (WI-0214).
            vergissWegfindungswerte(app.database);
            return antwort;
        },
    );
};
