import type { FastifyInstance, FastifyRequest } from "fastify";
import {
    ApiErrorBody,
    assignableRoles,
    isRole,
    mayManage,
    roleRank,
    type EditConflictDetails,
    type LinkReceipt,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { AuditAction, AuditEvent } from "./audit.ts";
import type { AuthConfig, AuthEnvironment } from "./config.ts";
import { runOperation } from "./operations.ts";
import { demand, requestMeta } from "./plugin.ts";
import type { SessionRecord, Sql } from "./session-store.ts";

/**
 * Schutzregeln der Verwaltung (WI-0120 A7, AUTH-0001 §7.3; T12, T23):
 *
 * - Niemand handelt hier am eigenen Konto; dafür gibt es das Kontofenster.
 * - Ein Admin handelt nur an Personen unterhalb der eigenen Stufe. An Admins und Betreibern handelt nur der Betreiber, und
 *   immer mit frischem Passkey (`assign_admin`, Stufe S): ernennen, abberufen, sperren, Links und Sitzungen.
 * - Es bleibt immer mindestens ein aktiver Betreiber. Alle Verwaltungshandlungen einer Umgebung laufen dafür nacheinander
 *   (eine Sperre bis zum Ende der Transaktion), sonst könnten sich zwei Betreiber gleichzeitig gegenseitig abberufen.
 */
export const ADMIN_ERRORS = {
    400: ApiErrorBody,
    401: ApiErrorBody,
    403: ApiErrorBody,
    404: ApiErrorBody,
    409: ApiErrorBody,
    413: ApiErrorBody,
    415: ApiErrorBody,
    /** Kartensperre oder Systemsperre (WI-0127 SYS-4): `map_locked`, `system_locked`. */
    423: ApiErrorBody,
    503: ApiErrorBody,
};

/** Verwaltungsantworten landen in keinem Cache. */
export function noStore(app: FastifyInstance): void {
    app.addHook("onSend", async (_request, reply, payload) => {
        void reply.header("cache-control", "no-store");
        return payload;
    });
}

/** Die Sitzung einer geschützten Route; `protect` hat sie schon geprüft. */
export async function adminSession(request: FastifyRequest): Promise<SessionRecord> {
    const session = await request.auth.session();
    if (session === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
    return session;
}

/** Wohin Links zeigen: die öffentliche Adresse der Umgebung, lokal die geprüfte Herkunft der Anfrage. */
export function linkOrigin(request: FastifyRequest, config: AuthConfig): string {
    return config.publicOrigin ?? String(request.headers.origin);
}

export interface Target {
    id: string;
    displayName: string;
    status: "active" | "locked" | "departed";
    revision: number;
    updatedAt: Date;
    role: Role;
    access: "active" | "revoked";
    accessRevision: number;
    accessUpdatedAt: Date;
}

/** Die betroffene Person mit Zugang in dieser Umgebung, gesperrt bis zum Ende der Transaktion; sonst 404. */
export async function loadTarget(sql: Sql, environment: AuthEnvironment, personId: string): Promise<Target> {
    const [row] = await sql<
        {
            id: string;
            display_name: string;
            status: Target["status"];
            revision: number;
            updated_at: Date;
            role: string;
            access: Target["access"];
            access_revision: number;
            access_updated_at: Date;
        }[]
    >`
        SELECT p.id, p.display_name, p.status, p.revision::int AS revision, p.updated_at, a.role, a.status AS access,
               a.revision::int AS access_revision, a.updated_at AS access_updated_at
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment}
         WHERE p.id = ${personId}
           FOR UPDATE OF p, a
    `;
    if (row === undefined || !isRole(row.role)) {
        throw new ApiError(404, "not_found", "Diese Person hat in dieser Umgebung keinen Zugang.");
    }
    return {
        id: row.id,
        displayName: row.display_name,
        status: row.status,
        revision: row.revision,
        updatedAt: row.updated_at,
        role: row.role,
        access: row.access,
        accessRevision: row.access_revision,
        accessUpdatedAt: row.access_updated_at,
    };
}

export function refuseSelf(session: SessionRecord, personId: string): void {
    if (personId === session.personId) {
        throw new ApiError(
            403,
            "self_change",
            "Das eigene Konto lässt sich hier nicht ändern; dafür gibt es das Kontofenster.",
        );
    }
}

/**
 * Darf diese Sitzung an einer Person mit Rolle `role` handeln, und, wenn die Handlung eine Rolle setzt, diese vergeben?
 * Betrifft eine Handlung Admins oder Betreiber, verlangt sie zusätzlich `assign_admin` mit frischem Passkey.
 */
export function guardRole(session: SessionRecord, role: Role, config: AuthConfig, nextRole?: Role): void {
    if (!mayManage(session.role, role)) {
        throw new ApiError(403, "forbidden_target", "Personen auf dieser Stufe verwaltet nur der Betreiber.");
    }
    if (nextRole !== undefined && !assignableRoles(session.role).includes(nextRole)) {
        throw new ApiError(403, "forbidden_role", "Diese Rolle vergibt nur der Betreiber.");
    }
    const admin = roleRank("admin");
    if (roleRank(role) >= admin || (nextRole !== undefined && roleRank(nextRole) >= admin)) {
        demand(session, "assign_admin", config);
    }
}

/**
 * Ein aufgelöstes Konto (`auth aufloesen`, `dissolve.ts`) verwaltet niemand mehr: Sonst gäbe ihm eine Rollenänderung den Zugang
 * zurück, oder ein Einrichtungslink entstünde für eine Person ohne Anmeldeweg.
 */
export function guardTarget(session: SessionRecord, target: Target, config: AuthConfig, nextRole?: Role): void {
    if (target.status === "departed") throw new ApiError(409, "account_inactive", "Dieses Konto ist aufgelöst.");
    refuseSelf(session, target.id);
    guardRole(session, target.role, config, nextRole);
}

/** Würde die Handlung den letzten aktiven Betreiber abberufen, sperren oder aussperren: 409 `last_operator`. */
export async function keepAnOperator(sql: Sql, environment: AuthEnvironment, target: Target): Promise<void> {
    if (target.role !== "operator" || target.status !== "active" || target.access !== "active") return;
    const [row] = await sql<{ others: number }[]>`
        SELECT count(*)::int AS others
          FROM avesmaps_auth.person_access a
          JOIN avesmaps_auth.person p ON p.id = a.person_id AND p.status = 'active'
         WHERE a.environment = ${environment} AND a.role = 'operator' AND a.status = 'active' AND a.person_id <> ${target.id}
    `;
    if ((row?.others ?? 0) === 0) {
        throw new ApiError(409, "last_operator", "Es muss immer mindestens einen aktiven Betreiber geben.");
    }
}

/** 409 `edit_conflict` mit Revision, Zeitpunkt und, aus dem Protokoll, wer zuletzt geändert hat (ADR-0020). */
export async function editConflict(
    sql: Sql,
    input: {
        currentRevision: number;
        changedAt: Date;
        targetPersonId?: string;
        targetRef?: string;
        actions: readonly AuditAction[];
    },
): Promise<ApiError> {
    const [last] = await sql<{ id: string | null; display_name: string | null }[]>`
        SELECT e.actor_person_id AS id, p.display_name
          FROM avesmaps_auth.security_event e
          LEFT JOIN avesmaps_auth.person p ON p.id = e.actor_person_id
         WHERE e.action = ANY(${[...input.actions]})
           AND (e.target_person_id = ${input.targetPersonId ?? null}::uuid OR e.target_ref = ${input.targetRef ?? null}::text)
         ORDER BY e.id DESC
         LIMIT 1
    `;
    const details: EditConflictDetails = {
        currentRevision: input.currentRevision,
        changedAt: input.changedAt.toISOString(),
    };
    if (last?.id != null && last.display_name != null)
        details.changedBy = { id: last.id, displayName: last.display_name };
    return new ApiError(
        409,
        "edit_conflict",
        "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
        details,
    );
}

/** Beendet alle Sonderrechte einer Person in dieser Umgebung und gibt ihre Namen zurück. */
export async function revokeGrants(
    sql: Sql,
    environment: AuthEnvironment,
    personId: string,
    by: string,
    reason: string,
): Promise<string[]> {
    const rows = await sql<{ capability: string }[]>`
        UPDATE avesmaps_auth.capability_grant SET revoked_at = now(), revoked_by = ${by}, revoke_reason = ${reason}
         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
        RETURNING capability
    `;
    return rows.map((row) => row.capability).sort();
}

/** Die Felder, die jeder Protokolleintrag einer Verwaltungshandlung trägt. */
export function actorFields(
    session: SessionRecord,
    request: FastifyRequest,
): Pick<
    AuditEvent,
    "environment" | "actorKind" | "actorPersonId" | "sessionId" | "recovery" | "ipPrefix" | "clientLabel"
> {
    return {
        environment: session.environment,
        actorKind: "person",
        actorPersonId: session.personId,
        sessionId: session.id,
        recovery: session.assurance === "recovery",
        ...requestMeta(request),
    };
}

/**
 * Die Verwaltungssperre je Umgebung bis zum Ende der Transaktion: Verwaltung, Betriebszustand (SYS-0001 §4.5) und die Kommandozeile
 * handeln nacheinander, nie gleichzeitig.
 */
export async function lockAdministration(tx: Sql, environment: AuthEnvironment): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps_auth.admin:${environment}`}))`;
}

/**
 * Eine Verwaltungshandlung: höchstens einmal je `operationId`, alle Handlungen einer Umgebung nacheinander. Unter der Sperre
 * wird die eigene Rolle noch einmal gelesen: Hat eine gleichzeitige Handlung sie gerade geändert (etwa zwei Betreiber, die
 * sich gegenseitig abberufen), gilt die Prüfung vom Anfang der Anfrage nicht mehr.
 */
export function adminOperation(
    database: Database,
    session: SessionRecord,
    input: { operationId: string; body: unknown },
    work: (tx: Sql) => Promise<{ receipt: Omit<OperationReceipt, "operationId" | "status">; event: AuditEvent }>,
): Promise<OperationReceipt> {
    return runOperation(database, input, work, {
        serialize: async (tx) => {
            await lockAdministration(tx, session.environment);
            const [actor] = await tx<{ role: string }[]>`
                SELECT a.role FROM avesmaps_auth.person p
                  JOIN avesmaps_auth.person_access a
                    ON a.person_id = p.id AND a.environment = ${session.environment} AND a.status = 'active'
                 WHERE p.id = ${session.personId} AND p.status = 'active'
            `;
            if (actor?.role !== session.role) {
                throw new ApiError(
                    403,
                    "rights_changed",
                    "Die eigenen Rechte haben sich gerade geändert. Neu laden zeigt sie.",
                );
            }
        },
    });
}

/** Die Antwort mit Link: nur beim ersten Mal; eine Wiederholung bekommt die Quittung und einen Hinweis statt des Links. */
export function linkResponse(
    receipt: OperationReceipt,
    link: { url: string; expiresAt: Date } | undefined,
): LinkReceipt {
    if (receipt.status === "replayed" || link === undefined) {
        const warning = {
            code: "link_shown_once",
            message: "Der Link stand nur in der ersten Antwort. „Neu ausstellen“ erzeugt einen neuen.",
        };
        return { receipt: { ...receipt, warnings: [...receipt.warnings, warning] }, link: null, expiresAt: null };
    }
    return { receipt, link: link.url, expiresAt: link.expiresAt.toISOString() };
}
