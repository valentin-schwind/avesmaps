import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    OperationReceipt,
    SonderrolleEntziehenBody,
    SonderrolleVergebenBody,
    SonderrollenUebersicht,
    isRole,
    type SonderrollenAbgleichStand,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, loadTarget } from "../auth/admin-guard.ts";
import { hatRecht, protect } from "../auth/plugin.ts";
import { requireRotation, type Sql } from "../auth/session-store.ts";
import {
    ladeRegionen,
    pruefeEinePersonJeRegion,
    pruefeWahl,
    sonderrollenLesbar,
    trageEin,
} from "../auth/sonderrollen.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Sonderrollen (WI-0279; Betreiber 2026-11-03: „Sonderrollen können nur von den Betreibern an alle Personen vergeben werden“):
 *
 *     GET  /api/admin/sonderrollen            Zuteilungen samt Verlauf, Regionen zur Auswahl             assign_roles (V)
 *     POST /api/admin/sonderrollen/vergeben   { personId, sonderrolle, regionen?, grund }                grant_special_capabilities (S)
 *     POST /api/admin/sonderrollen/entziehen  { zuteilungId, grund }                                     grant_special_capabilities (S)
 *
 * Anders als ein Einzelrecht geht eine Sonderrolle an jede Grundrolle und auch ans eigene Konto: Das Bündel gibt einem Betreiber nichts
 * Neues (E9b). Der Grund steht nur für Betreiber in der Antwort und im Protokoll. Die Rechte ändern sich sofort (`requireRotation`).
 *
 * Ist der Weg von Production eingerichtet (`auth/sonderrollen-abgleich.ts`), liest die Stage nur: 409 `sonderrollen_production`.
 *
 * 🪤 Ohne diesen Weg ist die Vergabe auch auf der Stage offen, damit sie sich dort abnehmen lässt.
 */
/** Die Discord-IDs ohne Konto sehen nur Betreiber; ein Admin liest die Zahl. */
const standFuer = (stand: SonderrollenAbgleichStand, betreiber: boolean): SonderrollenAbgleichStand =>
    betreiber ? stand : { ...stand, ohneKonto: [] };

async function verlangeBereit(sql: Sql): Promise<void> {
    if (!(await sonderrollenLesbar(sql))) {
        throw new ApiError(
            503,
            "auth_unavailable",
            "Die Sonderrollen sind auf dieser Instanz noch nicht eingerichtet.",
        );
    }
}

export const adminSonderrollenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const nurProduction = (): void => {
        if (app.sonderrollenAbgleich === undefined) return;
        throw new ApiError(
            409,
            "sonderrollen_production",
            "Sonderrollen werden in Production vergeben; die Stage übernimmt sie von dort.",
        );
    };

    app.get(
        "/api/admin/sonderrollen",
        { ...protect("assign_roles"), schema: { response: { 200: SonderrollenUebersicht, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const database = app.database!;
            await verlangeBereit(database);
            const zeigtGrund = hatRecht(session, "grant_special_capabilities", app.authConfig);
            const rows = await database<
                {
                    id: string;
                    sonderrolle: string;
                    person_id: string;
                    person_name: string;
                    rolle: string | null;
                    passkeys: number;
                    region_id: string | null;
                    region_name: string | null;
                    granted_at: Date;
                    by_id: string | null;
                    by_name: string | null;
                    reason: string;
                    revoked_at: Date | null;
                    revoked_id: string | null;
                    revoked_name: string | null;
                    revoke_reason: string | null;
                }[]
            >`
                SELECT z.id::text, z.sonderrolle, p.id AS person_id, p.display_name AS person_name,
                       CASE WHEN a.status = 'active' THEN a.role END AS rolle,
                       (SELECT count(*)::int FROM avesmaps_auth.passkey_credential k
                         WHERE k.person_id = p.id AND k.environment = z.environment AND k.revoked_at IS NULL) AS passkeys,
                       z.region_public_id::text AS region_id, r.name AS region_name, z.granted_at,
                       b.id AS by_id, b.display_name AS by_name, z.reason, z.revoked_at,
                       e.id AS revoked_id, e.display_name AS revoked_name, z.revoke_reason
                  FROM avesmaps_auth.sonderrolle_zuteilung z
                  JOIN avesmaps_auth.person p ON p.id = z.person_id
                  LEFT JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = z.environment
                  LEFT JOIN avesmaps_auth.person b ON b.id = z.granted_by
                  LEFT JOIN avesmaps_auth.person e ON e.id = z.revoked_by
                  LEFT JOIN region r ON r.public_id = z.region_public_id
                 WHERE z.environment = ${session.environment}
                 ORDER BY coalesce(z.revoked_at, z.granted_at) DESC, z.id DESC
                 LIMIT 1000
            `;
            return {
                zuteilungen: rows.map((row) => ({
                    id: row.id,
                    sonderrolle: row.sonderrolle,
                    person: { id: row.person_id, displayName: row.person_name },
                    personRolle: row.rolle !== null && isRole(row.rolle) ? row.rolle : null,
                    hatPasskey: row.passkeys > 0,
                    region: row.region_id === null ? null : { id: row.region_id, name: row.region_name ?? "" },
                    vergebenAm: row.granted_at.toISOString(),
                    vergebenVon:
                        row.by_id === null || row.by_name === null ? null : { id: row.by_id, displayName: row.by_name },
                    grund: zeigtGrund ? row.reason : null,
                    entzogenAm: row.revoked_at?.toISOString() ?? null,
                    entzogenVon:
                        row.revoked_id === null || row.revoked_name === null
                            ? null
                            : { id: row.revoked_id, displayName: row.revoked_name },
                    entzugGrund: zeigtGrund ? row.revoke_reason : null,
                })),
                regionen: await ladeRegionen(database),
                ...(app.sonderrollenAbgleich === undefined
                    ? {}
                    : { abgleich: standFuer(app.sonderrollenAbgleich.stand(), zeigtGrund) }),
            };
        },
    );

    app.post(
        "/api/admin/sonderrollen/vergeben",
        {
            ...protect("grant_special_capabilities", { writeClass: "system" }),
            schema: { body: SonderrolleVergebenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            nurProduction();
            const { operationId, personId, sonderrolle, regionen } = request.body;
            const grund = request.body.grund.trim();
            if (grund === "") throw new ApiError(400, "reason_required", "Der Grund fehlt.");
            const { environment } = session;
            await verlangeBereit(app.database!);
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "sonderrollen.vergeben", personId, sonderrolle, regionen, grund } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    if (target.status !== "active" || target.access !== "active") {
                        throw new ApiError(
                            409,
                            "account_inactive",
                            "Diese Person ist gesperrt oder hat hier keinen Zugang.",
                        );
                    }
                    const wahl = await pruefeWahl(tx, sonderrolle, regionen);
                    await pruefeEinePersonJeRegion(tx, environment, wahl, personId);
                    const eingetragen = await trageEin(tx, {
                        personId,
                        environment,
                        wahl,
                        vergebenVon: session.personId,
                        grund,
                    });
                    if (eingetragen.length === 0) {
                        throw new ApiError(409, "no_change", "Die Person hat diese Sonderrolle schon.");
                    }
                    await requireRotation(tx, personId);
                    return {
                        receipt: {
                            environment,
                            affected: eingetragen.map((zeile) => ({ kind: "sonderrolle_zuteilung", id: zeile.id })),
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "sonderrolle.vergeben",
                            targetPersonId: personId,
                            details: {
                                sonderrolle: wahl.sonderrolle,
                                regionen: eingetragen.flatMap((zeile) =>
                                    zeile.region === null ? [] : [zeile.region.name],
                                ),
                                grund,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/sonderrollen/entziehen",
        {
            ...protect("grant_special_capabilities", { writeClass: "security" }),
            schema: { body: SonderrolleEntziehenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            nurProduction();
            const { operationId, zuteilungId } = request.body;
            const grund = request.body.grund.trim();
            if (grund === "") throw new ApiError(400, "reason_required", "Der Grund fehlt.");
            const { environment } = session;
            await verlangeBereit(app.database!);
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "sonderrollen.entziehen", zuteilungId, grund } },
                async (tx) => {
                    const [row] = await tx<
                        { id: string; person_id: string; sonderrolle: string; region_name: string | null }[]
                    >`
                        UPDATE avesmaps_auth.sonderrolle_zuteilung z
                           SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = ${grund}
                          FROM (SELECT y.id, r.name AS region_name FROM avesmaps_auth.sonderrolle_zuteilung y
                                  LEFT JOIN region r ON r.public_id = y.region_public_id
                                 WHERE y.id = ${zuteilungId}::bigint) x
                         WHERE z.id = x.id AND z.environment = ${environment} AND z.revoked_at IS NULL
                        RETURNING z.id::text, z.person_id, z.sonderrolle, x.region_name
                    `;
                    if (row === undefined) {
                        throw new ApiError(409, "no_change", "Diese Sonderrolle ist schon entzogen.");
                    }
                    await requireRotation(tx, row.person_id);
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "sonderrolle_zuteilung", id: row.id }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "sonderrolle.entzogen",
                            targetPersonId: row.person_id,
                            details: {
                                sonderrolle: row.sonderrolle,
                                regionen: row.region_name === null ? [] : [row.region_name],
                                grund,
                            },
                        },
                    };
                },
            );
        },
    );
};
