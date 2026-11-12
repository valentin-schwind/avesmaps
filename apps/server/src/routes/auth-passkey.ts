import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { ApiErrorBody, MutationEnvelope, OperationReceipt } from "@avesmaps3d/shared";
import { consumeAccessLink, peekAccessLink } from "../auth/access-links.ts";
import { recordEvent } from "../auth/audit.ts";
import { runOperation } from "../auth/operations.ts";
import { activePasskeys, challengeConsumer, createChallenge, relyingPartyFor } from "../auth/passkeys.ts";
import { requestMeta, sessionOnly, setSessionCookie } from "../auth/plugin.ts";
import { rotateSession, type IssuedSession, type SessionRecord, type Sql } from "../auth/session-store.ts";
import {
    verifyAssertion,
    verifyRegistration,
    WebAuthnError,
    type AssertionCredential,
    type RegistrationCredential,
    type RelyingParty,
} from "../auth/webauthn.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Passkeys (WI-0120 A6, ADR-0021, AUTH-0001 §11; Betreiber 2026-10-09: „D2: B′ – Passkeys“):
 *
 *     GET  /api/account/passkeys                       eigene Passkeys dieser Umgebung
 *     POST /api/account/passkeys/register/options      { enrollmentToken? } → Optionen für navigator.credentials.create()
 *     POST /api/account/passkeys/register/verify       { credential, label?, enrollmentToken? }
 *     POST /api/account/passkeys/revoke                { operationId, passkeyId }
 *     POST /api/auth/passkey/confirm/options           Optionen für navigator.credentials.get()
 *     POST /api/auth/passkey/confirm/verify            { credential } → Stufe V und frischer Nachweis für Stufe S
 *
 * Der Passkey ist der EINZIGE zweite Faktor, nach Passwort wie nach Discord (Betreiber 2026-10-10: „4. B“): Erst sein Nachweis in
 * der Sitzung (`passkey_confirmed_at`) hebt sie auf `strong` (`session-store.ts` `effectiveAssurance`).
 *
 * Den ERSTEN Passkey richtet nur ein, wer einen Einrichtungslink für sich hat (vom Betreiber oder über SSH) oder im Notzugang
 * ist; jeden weiteren, wer gerade mit einem vorhandenen bestätigt hat (§11.4). So kann eine gestohlene Discord-Sitzung keinen
 * eigenen Passkey unterschieben.
 */

const B64 = Type.String({ maxLength: 8192, pattern: "^[A-Za-z0-9_-]*$" });
const RegistrationBody = Type.Object(
    {
        credential: Type.Object({
            id: B64,
            rawId: B64,
            type: Type.String({ maxLength: 20 }),
            response: Type.Object({
                clientDataJSON: B64,
                attestationObject: B64,
                transports: Type.Optional(Type.Array(Type.String({ maxLength: 20 }), { maxItems: 8 })),
            }),
            authenticatorAttachment: Type.Optional(Type.Union([Type.String({ maxLength: 20 }), Type.Null()])),
            clientExtensionResults: Type.Optional(Type.Object({})),
        }),
        label: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
        enrollmentToken: Type.Optional(Type.String({ minLength: 43, maxLength: 43 })),
    },
    { additionalProperties: false },
);
const AssertionBody = Type.Object(
    {
        credential: Type.Object({
            id: B64,
            rawId: B64,
            type: Type.String({ maxLength: 20 }),
            response: Type.Object({
                clientDataJSON: B64,
                authenticatorData: B64,
                signature: B64,
                userHandle: Type.Optional(Type.Union([B64, Type.Null()])),
            }),
            authenticatorAttachment: Type.Optional(Type.Union([Type.String({ maxLength: 20 }), Type.Null()])),
            clientExtensionResults: Type.Optional(Type.Object({})),
        }),
    },
    { additionalProperties: false },
);
const OptionsBody = Type.Object(
    { enrollmentToken: Type.Optional(Type.String({ minLength: 43, maxLength: 43 })) },
    { additionalProperties: false },
);
const RevokeBody = Type.Composite([
    MutationEnvelope,
    Type.Object({ passkeyId: Type.String({ maxLength: 40 }) }, { additionalProperties: false }),
]);
const PasskeyList = Type.Object({
    passkeys: Type.Array(
        Type.Object({
            id: Type.String(),
            label: Type.Union([Type.String(), Type.Null()]),
            backedUp: Type.Boolean(),
            createdAt: Type.String(),
            lastUsedAt: Type.Union([Type.String(), Type.Null()]),
        }),
    ),
});
const Options = Type.Object({ publicKey: Type.Record(Type.String(), Type.Unknown()) });
const Ok = Type.Object({ ok: Type.Literal(true) });

const MINUTE_MS = 60_000;
const within = (moment: Date | null, minutes: number): boolean =>
    moment !== null && Date.now() - moment.getTime() <= minutes * MINUTE_MS;

function uuidBytes(id: string): string {
    return Buffer.from(id.replace(/-/gu, ""), "hex").toString("base64url");
}

export const authPasskeyRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const errors = {
        400: ApiErrorBody,
        401: ApiErrorBody,
        403: ApiErrorBody,
        404: ApiErrorBody,
        409: ApiErrorBody,
        413: ApiErrorBody,
        415: ApiErrorBody,
        503: ApiErrorBody,
    };
    const guarded = { ...sessionOnly(), bodyLimit: 32_768 };

    function relyingParty(request: FastifyRequest): RelyingParty {
        const rp = relyingPartyFor(app.authConfig, request);
        if (rp === undefined) {
            throw new ApiError(
                400,
                "passkey_unavailable",
                "Passkeys gehen nur über eine sichere Adresse (lokal über localhost oder die HTTPS-Adresse im Tailnet).",
            );
        }
        return rp;
    }

    /** Darf diese Sitzung jetzt einen Passkey hinzufügen, und auf welchem Weg (§11.4)? */
    async function enrollmentPath(sql: Sql, session: SessionRecord, rp: RelyingParty, token: string | undefined) {
        if (session.assurance === "recovery") return "recovery" as const;
        const existing = await activePasskeys(sql, session.personId, session.environment, rp.rpId);
        if (existing.length > 0 && within(session.passkeyConfirmedAt, app.authConfig.session.systemStepUpMinutes)) {
            return "passkey" as const;
        }
        if (token !== undefined) {
            const link = await peekAccessLink(sql, token, "passkey_enrollment");
            if (link?.personId === session.personId) return "enrollment_link" as const;
        }
        throw new ApiError(
            403,
            "passkey_enrollment_required",
            existing.length > 0
                ? "Ein weiterer Passkey braucht eine frische Bestätigung mit einem vorhandenen."
                : "Der erste Passkey braucht einen Einrichtungslink von einer Person mit Betreiberrechten.",
        );
    }

    /** Nach Passkey-Nachweis: Sitzung bestätigt, Stufe V (aus `basic`), neues Token. */
    async function confirmSession(tx: Sql, session: SessionRecord): Promise<IssuedSession> {
        await tx`
            UPDATE avesmaps_auth.session
               SET passkey_confirmed_at = now(), confirmed_at = now(),
                   assurance = CASE WHEN assurance = 'basic' THEN 'strong' ELSE assurance END
             WHERE id = ${session.id}
        `;
        return rotateSession(tx, session, "passkey_confirmed");
    }

    app.get(
        "/api/account/passkeys",
        { ...guarded, schema: { response: { 200: PasskeyList, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const session = (await request.auth.session())!;
            const rows = await activePasskeys(
                app.database!,
                session.personId,
                session.environment,
                relyingParty(request).rpId,
            );
            return {
                passkeys: rows.map((row) => ({
                    id: row.id,
                    label: row.label,
                    backedUp: row.backed_up,
                    createdAt: row.created_at.toISOString(),
                    lastUsedAt: row.last_used_at?.toISOString() ?? null,
                })),
            };
        },
    );

    app.post(
        "/api/account/passkeys/register/options",
        { ...guarded, schema: { body: OptionsBody, response: { 200: Options, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const database = app.database!;
            const session = (await request.auth.session())!;
            const rp = relyingParty(request);
            await enrollmentPath(database, session, rp, request.body.enrollmentToken);
            const [person] = await database<{ login_name: string | null }[]>`
                SELECT pl.login_name FROM avesmaps_auth.person p
                  LEFT JOIN avesmaps_auth.password_login pl ON pl.person_id = p.id WHERE p.id = ${session.personId}
            `;
            const existing = await activePasskeys(database, session.personId, session.environment, rp.rpId);
            const challenge = await createChallenge(database, {
                purpose: "register",
                sessionId: session.id,
                personId: session.personId,
            });
            const label = session.environment === "production" ? "Avesmaps" : `Avesmaps (${session.environment})`;
            return {
                publicKey: {
                    challenge,
                    rp: { id: rp.rpId, name: label },
                    user: {
                        id: uuidBytes(session.personId),
                        name: person?.login_name ?? session.displayName,
                        displayName: session.displayName,
                    },
                    pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: "public-key", alg })),
                    timeout: 300_000,
                    attestation: "none",
                    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
                    excludeCredentials: existing.map((row) => ({
                        type: "public-key",
                        id: row.credential_id,
                        transports: row.transports,
                    })),
                },
            };
        },
    );

    app.post(
        "/api/account/passkeys/register/verify",
        { ...guarded, schema: { body: RegistrationBody, response: { 200: Ok, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const database = app.database!;
            const session = (await request.auth.session())!;
            const rp = relyingParty(request);
            const via = await enrollmentPath(database, session, rp, request.body.enrollmentToken);
            const issued = await database.begin(async (tx) => {
                let verified;
                try {
                    verified = await verifyRegistration(
                        request.body.credential as RegistrationCredential,
                        rp,
                        challengeConsumer(tx, "register", session.id),
                    );
                } catch (error) {
                    if (error instanceof WebAuthnError) {
                        throw new ApiError(400, "passkey_rejected", "Der Passkey wurde nicht angenommen.", {
                            reason: error.reason,
                        });
                    }
                    throw error;
                }
                if (
                    via === "enrollment_link" &&
                    (await consumeAccessLink(tx, request.body.enrollmentToken!, "passkey_enrollment")) === undefined
                ) {
                    throw new ApiError(400, "link_invalid", "Dieser Einrichtungslink gilt nicht mehr.");
                }
                const [taken] = await tx<{ id: string }[]>`
                    SELECT id FROM avesmaps_auth.passkey_credential WHERE credential_id = ${verified.credentialId}
                `;
                if (taken !== undefined)
                    throw new ApiError(409, "passkey_exists", "Dieser Passkey ist schon eingerichtet.");
                await tx`
                    INSERT INTO avesmaps_auth.passkey_credential
                        (person_id, environment, rp_id, credential_id, public_key, sign_count, transports, device_type, backed_up, label, created_via)
                    VALUES (${session.personId}, ${session.environment}, ${rp.rpId}, ${verified.credentialId}, ${verified.publicKeySpki},
                            ${verified.signCount}, ${verified.transports}, ${verified.deviceType}, ${verified.backedUp},
                            ${request.body.label ?? null}, ${via})
                `;
                await recordEvent(tx, {
                    environment: session.environment,
                    action: "passkey.registered",
                    actorKind: "person",
                    actorPersonId: session.personId,
                    targetPersonId: session.personId,
                    details: { label: request.body.label ?? null, via, backedUp: verified.backedUp },
                    sessionId: session.id,
                    recovery: session.assurance === "recovery",
                    ...requestMeta(request),
                });
                return confirmSession(tx, session);
            });
            setSessionCookie(reply, app.authConfig, issued);
            return { ok: true as const };
        },
    );

    app.post(
        "/api/auth/passkey/confirm/options",
        { ...guarded, schema: { response: { 200: Options, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const database = app.database!;
            const session = (await request.auth.session())!;
            const rp = relyingParty(request);
            const existing = await activePasskeys(database, session.personId, session.environment, rp.rpId);
            if (existing.length === 0)
                throw new ApiError(400, "no_passkey", "Für dieses Konto ist hier kein Passkey eingerichtet.");
            const challenge = await createChallenge(database, {
                purpose: "confirm",
                sessionId: session.id,
                personId: session.personId,
            });
            return {
                publicKey: {
                    challenge,
                    rpId: rp.rpId,
                    timeout: 300_000,
                    userVerification: "required",
                    allowCredentials: existing.map((row) => ({
                        type: "public-key",
                        id: row.credential_id,
                        transports: row.transports,
                    })),
                },
            };
        },
    );

    app.post(
        "/api/auth/passkey/confirm/verify",
        { ...guarded, schema: { body: AssertionBody, response: { 200: Ok, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const database = app.database!;
            const session = (await request.auth.session())!;
            const rp = relyingParty(request);
            const credential = request.body.credential as AssertionCredential;
            const [stored] = (await activePasskeys(database, session.personId, session.environment, rp.rpId)).filter(
                (row) => row.credential_id === credential.id,
            );
            if (stored === undefined)
                throw new ApiError(400, "passkey_rejected", "Der Passkey wurde nicht angenommen.", {
                    reason: "unknown",
                });
            const outcome = await database.begin(async (tx) => {
                try {
                    const result = await verifyAssertion(
                        credential,
                        {
                            credentialId: stored.credential_id,
                            publicKeySpki: stored.public_key,
                            signCount: Number(stored.sign_count),
                        },
                        rp,
                        challengeConsumer(tx, "confirm", session.id),
                    );
                    await tx`
                        UPDATE avesmaps_auth.passkey_credential SET sign_count = ${result.signCount}, backed_up = ${result.backedUp}, last_used_at = now()
                         WHERE id = ${stored.id}
                    `;
                    await recordEvent(tx, {
                        environment: session.environment,
                        action: "confirm.success",
                        actorKind: "person",
                        actorPersonId: session.personId,
                        targetPersonId: session.personId,
                        details: { method: "passkey" },
                        sessionId: session.id,
                        recovery: session.assurance === "recovery",
                        ...requestMeta(request),
                    });
                    return { issued: await confirmSession(tx, session) };
                } catch (error) {
                    if (error instanceof WebAuthnError) return { reason: error.reason };
                    throw error;
                }
            });
            if ("reason" in outcome) {
                if (outcome.reason === "counter_regression") {
                    // Ein möglicher Klon: Passkey sperren und melden (§11.4).
                    await database.begin(async (tx) => {
                        await tx`
                            UPDATE avesmaps_auth.passkey_credential SET revoked_at = now(), revoke_reason = 'counter_regression'
                             WHERE id = ${stored.id} AND revoked_at IS NULL
                        `;
                        await recordEvent(tx, {
                            environment: session.environment,
                            action: "passkey.counter_regression",
                            actorKind: "system",
                            targetPersonId: session.personId,
                            details: { label: stored.label },
                        });
                    });
                }
                throw new ApiError(403, "passkey_rejected", "Der Passkey wurde nicht angenommen.", {
                    reason: outcome.reason,
                });
            }
            setSessionCookie(reply, app.authConfig, outcome.issued);
            return { ok: true as const };
        },
    );

    app.post(
        "/api/account/passkeys/revoke",
        { ...guarded, schema: { body: RevokeBody, response: { 200: OperationReceipt, ...errors } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const database = app.database!;
            const session = (await request.auth.session())!;
            const strong = session.assurance === "strong" || session.assurance === "recovery";
            if (!strong || !within(session.confirmedAt, app.authConfig.session.stepUpMinutes)) {
                throw new ApiError(403, "reauth_required", "Die Anmeldung muss kurz bestätigt werden.", {
                    need: "confirmation",
                });
            }
            const { operationId, passkeyId } = request.body;
            return runOperation(
                database,
                { operationId, body: { action: "passkey.revoke", passkeyId } },
                async (tx) => {
                    const [row] = await tx<{ label: string | null }[]>`
                    UPDATE avesmaps_auth.passkey_credential
                       SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = 'self'
                     WHERE id = ${passkeyId} AND person_id = ${session.personId} AND revoked_at IS NULL
                    RETURNING label
                `;
                    if (row === undefined) throw new ApiError(404, "not_found", "Diesen Passkey gibt es nicht (mehr).");
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "passkey", id: passkeyId }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            environment: session.environment,
                            action: "passkey.revoked",
                            actorKind: "person",
                            actorPersonId: session.personId,
                            targetPersonId: session.personId,
                            details: { label: row.label, reason: "self", count: 1 },
                            sessionId: session.id,
                            ...requestMeta(request),
                        },
                    };
                },
            );
        },
    );
};
