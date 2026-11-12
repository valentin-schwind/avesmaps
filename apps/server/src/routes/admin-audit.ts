import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AuditPage, AuditQuery } from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import { actionsIn } from "../auth/audit.ts";
import { protect } from "../auth/plugin.ts";
import { likeMuster } from "../db/like-muster.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Das Protokoll lesen (WI-0120 A7, AUTH-0001 §5 `security_event`, Kap. 10.63): neueste zuerst, gefiltert nach Handlung oder
 * Gruppe (`person.`), Person (handelnd oder betroffen) und Zeitraum; weiterblättern mit `before`. Seit SYS-15 (SYS-0001 §9d.2) dazu der
 * Bereich: `konten` für die Kontenverwaltung, `system` für die Systemsteuerung (`AUDIT_BEREICH`); ohne ihn alles.
 *
 *     GET /api/admin/audit?bereich=&action=&personId=&from=&to=&before=&limit=&q=&qAktionen=     read_audit (V)
 *
 * `q` (Betreiber 2026-10-11): Freitext in Handlung, Namen und den Werten der Details; `qAktionen` sind die Handlungen, deren Titel in der
 * Oberfläche passt. Gesucht wird in der Datenbank, nicht in der geladenen Seite: Das Protokoll blättert in Seiten zu 50.
 */
const DEFAULT_LIMIT = 50;

function moment(value: string | undefined, field: string): Date | undefined {
    if (value === undefined) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new ApiError(400, "validation_failed", "Ein Zeitpunkt ist ungültig.", {
            issues: [{ path: `/${field}`, rule: "date-time" }],
        });
    }
    return parsed;
}

export const adminAuditRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/audit",
        {
            ...protect("read_audit"),
            schema: { querystring: AuditQuery, response: { 200: AuditPage, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const { environment } = await adminSession(request);
            const { action, personId, before, bereich, q, qAktionen } = request.query;
            const muster = q === undefined ? null : likeMuster(q);
            const titelTreffer = qAktionen === undefined ? [] : qAktionen.split(",");
            const from = moment(request.query.from, "from");
            const to = moment(request.query.to, "to");
            const limit = request.query.limit ?? DEFAULT_LIMIT;
            const sql = app.database!;
            const rows = await sql<
                {
                    id: string;
                    at: Date;
                    action: string;
                    actor_kind: "person" | "cli" | "system" | "anonymous";
                    actor_label: string | null;
                    target_ref: string | null;
                    details: Record<string, unknown>;
                    recovery: boolean;
                    operation_id: string | null;
                    client_label: string | null;
                    ip_prefix: string | null;
                    actor_id: string | null;
                    actor_name: string | null;
                    target_id: string | null;
                    target_name: string | null;
                }[]
            >`
                SELECT e.id::text, e.at, e.action, e.actor_kind, e.actor_label, e.target_ref, e.details, e.recovery,
                       e.operation_id, e.client_label, e.ip_prefix,
                       a.id AS actor_id, a.display_name AS actor_name, t.id AS target_id, t.display_name AS target_name
                  FROM avesmaps_auth.security_event e
                  LEFT JOIN avesmaps_auth.person a ON a.id = e.actor_person_id
                  LEFT JOIN avesmaps_auth.person t ON t.id = e.target_person_id
                 WHERE e.environment = ${environment}
                   ${
                       action === undefined
                           ? sql``
                           : action.endsWith(".")
                             ? sql`AND starts_with(e.action, ${action})`
                             : sql`AND e.action = ${action}`
                   }
                   ${bereich === undefined ? sql`` : sql`AND e.action = ANY(${actionsIn(bereich)}::text[])`}
                   ${personId === undefined ? sql`` : sql`AND (e.actor_person_id = ${personId} OR e.target_person_id = ${personId})`}
                   ${from === undefined ? sql`` : sql`AND e.at >= ${from}`}
                   ${to === undefined ? sql`` : sql`AND e.at < ${to}`}
                   ${before === undefined ? sql`` : sql`AND e.id < ${before}::bigint`}
                   ${
                       muster === null
                           ? sql``
                           : sql`AND (e.action ILIKE ${muster} ESCAPE '\\'
                                  OR a.display_name ILIKE ${muster} ESCAPE '\\'
                                  OR t.display_name ILIKE ${muster} ESCAPE '\\'
                                  OR e.actor_label ILIKE ${muster} ESCAPE '\\'
                                  OR e.target_ref ILIKE ${muster} ESCAPE '\\'
                                  OR EXISTS (SELECT 1 FROM jsonb_each_text(e.details) d WHERE d.value ILIKE ${muster} ESCAPE '\\')
                                  OR e.action = ANY(${titelTreffer}::text[]))`
                   }
                 ORDER BY e.id DESC
                 LIMIT ${limit + 1}
            `;
            const page = rows.slice(0, limit);
            return {
                events: page.map((row) => ({
                    id: row.id,
                    at: row.at.toISOString(),
                    action: row.action,
                    actorKind: row.actor_kind,
                    actor:
                        row.actor_id === null || row.actor_name === null
                            ? null
                            : { id: row.actor_id, displayName: row.actor_name },
                    actorLabel: row.actor_label,
                    target:
                        row.target_id === null || row.target_name === null
                            ? null
                            : { id: row.target_id, displayName: row.target_name },
                    targetRef: row.target_ref,
                    details: row.details,
                    recovery: row.recovery,
                    operationId: row.operation_id,
                    clientLabel: row.client_label,
                    ipPrefix: row.ip_prefix,
                })),
                next: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
            };
        },
    );
};
