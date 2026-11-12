import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA,
    AdminHoehenmodell,
    HoehenmodellAbnehmenBody,
    HoehenmodellEntwurfBody,
    HoehenmodellEntwurfZielBody,
    HoehenmodellNeuRechnenBody,
    HoehenmodellTestBody,
    HoehenmodellWaehlenBody,
    HoehenmodellZurueckBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect, protectEines } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { verwirfEntwurf, legeEntwurfAn, reiheMessungEin } from "../terrain/hoehenmodell-entwurf.ts";
import { readHoehenmodell } from "../terrain/hoehenmodell-lesen.ts";
import { offeneFassung, setzeTestWerte, sperreTest, testStand } from "../terrain/hoehenmodell-test.ts";
import {
    brauchtAbkuehlzeit,
    TERRAIN_TARGET,
    nimmAb,
    rechneNeu,
    rueckwegZiel,
    waehleFassung,
    type Handelnde,
} from "../terrain/hoehenmodell.ts";

/**
 * Das Höhenmodell in der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c, Entscheide §9c.11 und §9c.12).
 *
 *     GET  /api/admin/system/hoehenmodell                    Fassungen, eingestellt/wirksam, Kette, Rückweg, Entwürfe   view_operations (V)
 *     POST /api/admin/system/hoehenmodell/waehlen            { operationId, baseRevision, version, reason }  manage_terrain_recipe + Passkey
 *     POST /api/admin/system/hoehenmodell/zurueck            { operationId, baseRevision, reason }           manage_terrain_recipe + Passkey
 *     POST /api/admin/system/hoehenmodell/neu-rechnen        { operationId }                                manage_terrain_recipe + Passkey
 *     POST /api/admin/system/hoehenmodell/abnehmen           { operationId, version, reason }                manage_terrain_recipe + Passkey
 *     POST /api/admin/system/hoehenmodell/entwurf            { operationId, basis, aenderungen, reason }     manage_terrain_recipe (V)
 *     POST /api/admin/system/hoehenmodell/entwurf/messen     { operationId, draft }                          manage_terrain_recipe (V)
 *     POST /api/admin/system/hoehenmodell/entwurf/verwerfen  { operationId, draft }                          manage_terrain_recipe (V)
 *     POST /api/admin/system/hoehenmodell/test               { operationId, baseRevision, werte, reason }    manage_terrain_recipe (V)
 *     GET  /api/admin/system/hoehenmodell/test/stand         das wirksame Rezept von „19 (Test)“ als JSON    manage_terrain_recipe
 *
 * - Jede schreibende Route schreibt genau ein System-Ereignis (Protokollpflicht, SYS-0001 §9d.2), in derselben Transaktion.
 * - **Schreibklassen** (§9c.7): Wählen, Abnehmen und Entwürfe `system` (unter Systemsperre 423); Zurück `security` (Frage 4 A: auch unter
 *   Sperre; der volle Lauf wartet trotzdem unter Kartensperre, weil eine Person ihn auslöst).
 * - **Wählen und Zurück** reihen die volle Kette ein (`terrain_chain_enqueue`): Ein Wechsel rechnet die ganze Karte neu (§9c.11).
 * - **Neu rechnen** (Betreiber 2026-10-17, Topographie F8 „Du, mit Knopf“): dieselbe Fassung, die volle Kette noch einmal; höchstens eine
 *   wartende Kette (409 `terrain_chain_waiting`). Kein Grund, wie die Freigabe der Wegfindung.
 * - **Abkühlzeit** (WI-0279): In Production warten Wählen und Neu rechnen 30 Minuten nach dem letzten vollen Lauf, außer für Betreiber
 *   (409 `terrain_cooldown` mit `ab`, `terrain/hoehenmodell.ts`).
 */
const handelnde = (session: SessionRecord): Handelnde => ({
    personId: session.personId,
    label: session.displayName,
    actorRef: session.personId,
});

const ACTIVATED = "system.terrain_activated" as const;
const RECOMPUTED = "system.terrain_recomputed" as const;

export const adminHoehenmodellRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const domain = AVENTURIA.mapDomain;
    const profil = (): "voll" | "abgenommen" => app.config.hoehenmodell ?? "voll";

    app.get(
        "/api/admin/system/hoehenmodell",
        {
            ...protectEines(["view_operations", "manage_terrain_recipe"]),
            schema: { response: { 200: AdminHoehenmodell, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return readHoehenmodell(app.database!, domain, profil());
        },
    );

    const conflict = (current: { revision: number; changedAt: Date }) =>
        editConflict(app.database!, {
            currentRevision: current.revision,
            changedAt: current.changedAt,
            targetRef: TERRAIN_TARGET(domain),
            actions: [ACTIVATED],
        });

    app.post(
        "/api/admin/system/hoehenmodell/waehlen",
        {
            ...protect("manage_terrain_recipe", { confirm: "passkey", writeClass: "system" }),
            schema: { body: HoehenmodellWaehlenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, version, reason } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.choose", version, reason } },
                async (tx) => {
                    const chosen = await waehleFassung(tx, {
                        domain,
                        version,
                        reason,
                        actor: handelnde(session),
                        profil: profil(),
                        baseRevision,
                        abkuehlen: brauchtAbkuehlzeit(session),
                        conflict,
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "terrain_full", jobId: chosen.job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: ACTIVATED,
                            targetRef: TERRAIN_TARGET(domain),
                            details: { from: chosen.from, to: chosen.to, reason, rueckweg: false, job: chosen.job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/neu-rechnen",
        {
            ...protect("manage_terrain_recipe", { confirm: "passkey", writeClass: "system" }),
            schema: { body: HoehenmodellNeuRechnenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.recompute" } },
                async (tx) => {
                    const lauf = await rechneNeu(tx, {
                        domain,
                        actor: handelnde(session),
                        abkuehlen: brauchtAbkuehlzeit(session),
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "terrain_full", jobId: lauf.job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: RECOMPUTED,
                            targetRef: TERRAIN_TARGET(domain),
                            details: { version: lauf.version, job: lauf.job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/zurueck",
        {
            ...protect("manage_terrain_recipe", { confirm: "passkey", writeClass: "security" }),
            schema: { body: HoehenmodellZurueckBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, reason } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.back", reason } },
                async (tx) => {
                    const ziel = await rueckwegZiel(tx, domain);
                    if (ziel === null) {
                        throw new ApiError(409, "terrain_no_rollback", "Es gibt keine abgenommene vorige Fassung.");
                    }
                    const chosen = await waehleFassung(tx, {
                        domain,
                        version: ziel,
                        reason,
                        actor: handelnde(session),
                        profil: profil(),
                        baseRevision,
                        rueckweg: true,
                        conflict,
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "terrain_full", jobId: chosen.job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: ACTIVATED,
                            targetRef: TERRAIN_TARGET(domain),
                            details: { from: chosen.from, to: chosen.to, reason, rueckweg: true, job: chosen.job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/abnehmen",
        {
            ...protect("manage_terrain_recipe", { confirm: "passkey", writeClass: "system" }),
            schema: { body: HoehenmodellAbnehmenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, version, reason } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.accept", version, reason } },
                async (tx) => {
                    await nimmAb(tx, { domain, version, reason, actor: handelnde(session) });
                    // Abgenommen stehen die Werte von „19 (Test)“ fest (WI-0240); ihr Stand geht als Datei ins Repository.
                    if (offeneFassung()?.version === version) await sperreTest(tx, domain, version);
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.terrain_accepted",
                            targetRef: TERRAIN_TARGET(domain),
                            details: { version, reason },
                        },
                    };
                },
            );
        },
    );

    // „19 (Test)“ (WI-0240; Betreiber 2026-10-19: „wir ändern eigenschaften von test 19 live auf der stage“): die Werte über der Datei
    // der offenen Fassung setzen, ohne Passkey wie ein Entwurf. Ist die Fassung gewählt, rechnet die volle Kette sofort neu.
    app.post(
        "/api/admin/system/hoehenmodell/test",
        {
            ...protect("manage_terrain_recipe", { writeClass: "system" }),
            schema: { body: HoehenmodellTestBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, werte, reason } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.test", werte, reason } },
                async (tx) => {
                    const gesetzt = await setzeTestWerte(tx, {
                        domain,
                        werte,
                        baseRevision,
                        reason,
                        actor: handelnde(session),
                        profil: profil(),
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TERRAIN_TARGET(domain),
                                actions: ["system.terrain_test_changed"],
                            }),
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork:
                                gesetzt.job === null
                                    ? []
                                    : [{ kind: "terrain_full", jobId: gesetzt.job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.terrain_test_changed",
                            targetRef: TERRAIN_TARGET(domain),
                            details: { version: gesetzt.version, revision: gesetzt.revision, reason, job: gesetzt.job },
                        },
                    };
                },
            );
        },
    );

    // Der Stand von „19 (Test)“ als Datei (WI-0240): der Weg ins Repository nach der Abnahme (19.json, dann `accepted`).
    app.get(
        "/api/admin/system/hoehenmodell/test/stand",
        { ...protect("manage_terrain_recipe") },
        async (request, reply) => {
            await adminSession(request);
            const stand = await testStand(app.database!, domain, profil());
            if (stand === null)
                throw new ApiError(409, "terrain_test_unavailable", "Es gibt keine offene Fassung mit Testwerten.");
            return reply
                .header("content-type", "application/json; charset=utf-8")
                .header("content-disposition", `attachment; filename="${String(stand.version)}.json"`)
                .send(`${JSON.stringify(stand, null, 4)}
`);
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/entwurf",
        {
            ...protect("manage_terrain_recipe", { writeClass: "system" }),
            schema: { body: HoehenmodellEntwurfBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, basis, aenderungen, reason } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.draft", basis, aenderungen, reason } },
                async (tx) => {
                    const draft = await legeEntwurfAn(tx, {
                        domain,
                        basis,
                        aenderungen,
                        reason,
                        actor: handelnde(session),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.terrain_draft_created",
                            targetRef: TERRAIN_TARGET(domain),
                            details: { draft, base: basis, regler: Object.keys(aenderungen).sort(), reason },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/entwurf/messen",
        {
            ...protect("manage_terrain_recipe", { writeClass: "system" }),
            schema: { body: HoehenmodellEntwurfZielBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            if (profil() !== "voll") {
                throw new ApiError(503, "terrain_measure_unavailable", "Auf dieser Umgebung wird nicht gemessen.");
            }
            const { operationId, draft } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.measure", draft } },
                async (tx) => {
                    const job = await reiheMessungEin(tx, { domain, draft, actor: handelnde(session) });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "terrain_preview", jobId: job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.terrain_measure_requested",
                            targetRef: TERRAIN_TARGET(domain),
                            details: { draft, job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/system/hoehenmodell/entwurf/verwerfen",
        {
            ...protect("manage_terrain_recipe", { writeClass: "system" }),
            schema: { body: HoehenmodellEntwurfZielBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, draft } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "terrain.discard", draft } },
                async (tx) => {
                    await verwirfEntwurf(tx, { domain, draft });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.terrain_draft_discarded",
                            targetRef: TERRAIN_TARGET(domain),
                            details: { draft },
                        },
                    };
                },
            );
        },
    );
};
