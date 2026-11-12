import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import { ApiErrorBody, STATUS_PFAD, STATUS_SCHLUESSEL_MUSTER } from "@avesmaps3d/shared";
import { recordEvent } from "../auth/audit.ts";
import { oauthCookieName, type AuthConfig } from "../auth/config.ts";
import { parseCookies, serializeCookie } from "../auth/cookies.ts";
import type { DiscordClient, DiscordUser } from "../auth/discord-client.ts";
import { acceptInvitation, findOpenInvitation, findOpenInvitationById } from "../auth/invitations.ts";
import {
    FLOW_MINUTES,
    consumeFlow,
    displayNameFrom,
    createFlow,
    safeReturnPath,
    type OAuthFlow,
    type OAuthPurpose,
} from "../auth/discord-flow.ts";
import { startSession, type RequestMeta } from "../auth/password-accounts.ts";
import { appendSetCookie, requestMeta, setSessionCookie } from "../auth/plugin.ts";
import { rotateSession, type Sql } from "../auth/session-store.ts";
import { CommunityFehler, discordVerbinden, schluesselHash, statusLesen } from "../community/db.ts";
import { isNotProvisioned, type Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { throttleAddress } from "../log-address.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Anmelden mit Discord (WI-0120 A5, AUTH-0001 §6.3, §6.6, §6.8; Betreiber 2026-10-09: Discord nur als Ausweis, Scope
 * `identify`, keine Servermitgliedschaft, keine Discord-Rollen).
 *
 *     POST /api/auth/discord/start      { purpose, returnPath? } → { authorizeUrl } und das Nonce-Cookie
 *     GET  /api/auth/discord/callback   Rückkehr von Discord; leitet in die SPA mit `?anmeldung=<Ergebnis>`
 *
 * Zwecke: `login` (es gibt die Person schon), `confirm` (Bestätigung einer laufenden Sitzung, Discord-Zustimmung erzwungen),
 * `link` (Discord an das eigene Konto hängen, nur frisch bestätigt). `invitation` kommt mit den Einladungen (A6).
 * 🔴 Ohne Konto entsteht nie eines: Zugang gibt es nur mit Einladung.
 *
 * **`melder`** (WI-0268 C8, Fachkonzept §8.3 und §8.4): Ein Melder verbindet seine Meldung mit seiner Discord-Kennung, damit `/offen` und `/erledigt` im Avesmaps-Discord seine Website-Meldungen kennen.
 * `POST /api/auth/discord/start { purpose: "melder", schluessel }`: der Statusschlüssel steht im Rumpf (nie in einer Adresse) und im serverseitigen Umweg nur als Hash. Ohne Sitzung, ohne Konto; es entsteht nie eines
 * und nichts wird angemeldet. Der Rückweg liest die Kennung (Bereich `identify`, wie bei den übrigen Zwecken; das Zugangstoken ist danach widerrufen), speichert Kennung und Anzeigename am Melder des Vorgangs
 * (`community_discord_verbinden`) und führt auf `/meldung?discord=<Ergebnis>` zurück. Der Schlüssel steht in keiner Rückkehradresse: Die Seite hat ihn vor dem Sprung in `sessionStorage` gelegt und stellt ihn von dort wieder her.
 *
 * 🔴 **Discord bringt nie den zweiten Faktor** (Betreiber 2026-10-10: „4. B“, also „Für die Verwaltung immer den Passkey verlangen;
 * Discord-Nutzer mit Verwaltungsrechten bestätigen einmal je Sitzung“). Discord meldet nur am Konto, ob dort ein zweiter Faktor
 * eingeschaltet ist, nicht, ob er bei DIESER Anmeldung eingegeben wurde (mit `prompt=none` und einer bestehenden Discord-Sitzung
 * oft nicht). Eine Anmeldung oder Einladung über Discord ergibt deshalb immer Stufe R (`basic`), eine Bestätigung über Discord macht
 * die Sitzung nur frisch (`confirmed_at`, Schritte mit `recent`) und hebt die Stufe nie. Stufe V gibt allein der Passkey
 * (`auth-passkey.ts`).
 *
 * 🔴 **Discords Zwei-Faktor-Angabe wird weder gelesen noch gespeichert** (Betreiber 2026-10-10 auf die Frage, ob sie als bloße
 * Information bleibt: „B: nicht mehr speichern“). Ihre Spalte in `discord_login` fasst kein Code mehr an; Migration 0093 hat sie
 * nullbar gemacht und geleert, ein Release später fällt sie (WI-0120, Nachtrag 2026-10-10).
 */
declare module "fastify" {
    interface FastifyInstance {
        discordClient: DiscordClient | undefined;
    }
}

export type DiscordOutcome =
    | "ok"
    | "bestaetigt"
    | "verknuepft"
    | "abgebrochen"
    | "abgelaufen"
    | "kein_zugang"
    | "gesperrt"
    | "discord_fehler"
    | "discord_vergeben"
    | "schon_verknuepft"
    | "andere_person"
    | "willkommen"
    | "einladung_ungueltig"
    | "schon_konto";

const PER_IP_PER_MINUTE = 30;

/** Was die Rückkehr eines Melders sagt (`?discord=<Ergebnis>` auf `/meldung`). */
export type MelderOutcome = "verbunden" | "abgebrochen" | "discord_fehler" | "nicht_gefunden";

const StartBody = Type.Object(
    {
        purpose: Type.Union([
            Type.Literal("login"),
            Type.Literal("link"),
            Type.Literal("confirm"),
            Type.Literal("invitation"),
            Type.Literal("melder"),
        ]),
        returnPath: Type.Optional(Type.String({ maxLength: 300 })),
        invitationToken: Type.Optional(Type.String({ minLength: 43, maxLength: 43 })),
        /** Nur für `melder`: der Statusschlüssel der Meldung (32 Zufallsbytes, base64url). */
        schluessel: Type.Optional(Type.String({ pattern: STATUS_SCHLUESSEL_MUSTER })),
    },
    { additionalProperties: false },
);
const StartResponse = Type.Object({ authorizeUrl: Type.String() });
const CallbackQuery = Type.Object({
    code: Type.Optional(Type.String({ maxLength: 512 })),
    state: Type.Optional(Type.String({ maxLength: 128 })),
    error: Type.Optional(Type.String({ maxLength: 128 })),
});

function authorizeUrl(config: AuthConfig, state: string, challenge: string, prompt: "none" | "consent"): string {
    const discord = config.discord!;
    const query = new URLSearchParams({
        response_type: "code",
        client_id: discord.clientId,
        scope: "identify",
        state,
        redirect_uri: discord.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt,
    });
    return `${discord.authorizeUrl}?${query.toString()}`;
}

function setFlowCookie(reply: FastifyReply, config: AuthConfig, nonce: string): void {
    appendSetCookie(
        reply,
        serializeCookie(oauthCookieName(config), nonce, { secure: !config.insecureCookie, maxAge: FLOW_MINUTES * 60 }),
    );
}

function clearFlowCookie(reply: FastifyReply, config: AuthConfig): void {
    appendSetCookie(reply, serializeCookie(oauthCookieName(config), "", { secure: !config.insecureCookie, maxAge: 0 }));
}

/**
 * Zurück in die SPA, mit dem Ergebnis als Abfrage; der Pfad ist schon geprüft (`safeReturnPath`). Ohne Pfad (Umweg abgelaufen
 * oder unbekannt) über `/anmelden`: Hinter der Stage-Tür ist nur dieser Einstieg ohne Sitzung erreichbar, die Erklärung käme
 * sonst nie an (WI-0120 R6); die Seite schreibt die Adresse danach auf `/edit`, wie zuvor bei `/`.
 */
function backToApp(
    reply: FastifyReply,
    returnPath: string | null,
    outcome: DiscordOutcome | MelderOutcome,
    parameter: "anmeldung" | "discord" = "anmeldung",
): FastifyReply {
    const target = new URL(returnPath ?? "/anmelden", "http://avesmaps.invalid");
    target.searchParams.set(parameter, outcome);
    void reply.header("cache-control", "no-store");
    void reply.header("referrer-policy", "no-referrer");
    return reply.code(303).header("location", `${target.pathname}${target.search}`).send();
}

async function liveSession(sql: Sql, sessionId: string | null, personId: string | null) {
    if (sessionId === null || personId === null) return undefined;
    const [row] = await sql<{ id: string }[]>`
        SELECT id FROM avesmaps_auth.session
         WHERE id = ${sessionId} AND person_id = ${personId} AND revoked_at IS NULL AND expires_at > now() AND idle_expires_at > now()
    `;
    return row;
}

async function updateDiscordProfile(sql: Sql, personId: string, user: DiscordUser): Promise<void> {
    await sql`
        UPDATE avesmaps_auth.discord_login
           SET discord_username = ${user.username}, discord_global_name = ${user.globalName}, last_login_at = now()
         WHERE person_id = ${personId}
    `;
}

/** Was der Zweck mit dem geprüften Discord-Konto tut; liefert das Ergebnis für die SPA. */
async function complete(
    database: Database,
    config: AuthConfig,
    flow: OAuthFlow,
    user: DiscordUser,
    reply: FastifyReply,
    meta: RequestMeta,
): Promise<DiscordOutcome> {
    const environment = config.environment!;
    const [known] = await database<{ person_id: string; status: string; access: string | null }[]>`
        SELECT dl.person_id, p.status, a.status AS access
          FROM avesmaps_auth.discord_login dl
          JOIN avesmaps_auth.person p ON p.id = dl.person_id
          LEFT JOIN avesmaps_auth.person_access a ON a.person_id = dl.person_id AND a.environment = ${environment}
         WHERE dl.discord_user_id = ${user.id}
    `;

    if (flow.purpose === "login") {
        if (known === undefined) return "kein_zugang";
        if (known.status !== "active") return "gesperrt";
        if (known.access !== "active") return "kein_zugang";
        const session = await database.begin(async (tx) => {
            await updateDiscordProfile(tx, known.person_id, user);
            return startSession(tx, config, known.person_id, "discord", "basic", meta);
        });
        setSessionCookie(reply, config, session);
        return "ok";
    }

    if (flow.purpose === "invitation") {
        // Eine Einladung ist immer eine NEUE Person. Gibt es das Discord-Konto hier schon, bleibt die Einladung offen.
        if (known !== undefined) return "schon_konto";
        const invitation =
            flow.invitationId === null ? undefined : await findOpenInvitationById(database, flow.invitationId);
        if (invitation === undefined) return "einladung_ungueltig";
        if (invitation.boundDiscordUserId !== null && invitation.boundDiscordUserId !== user.id) return "andere_person";
        const session = await database.begin(async (tx) => {
            const personId = await acceptInvitation(tx, invitation, displayNameFrom(user), meta);
            if (personId === undefined)
                throw new ApiError(409, "invitation_invalid", "Diese Einladung wurde gerade schon angenommen.");
            await tx`
                INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id, discord_username, discord_global_name, last_login_at)
                VALUES (${personId}, ${user.id}, ${user.username}, ${user.globalName}, now())
            `;
            await recordEvent(tx, {
                environment,
                action: "invitation.accepted",
                actorKind: "person",
                actorPersonId: personId,
                targetPersonId: personId,
                targetRef: invitation.id,
                details: { role: invitation.role, method: "discord", tokenHint: invitation.tokenHint },
                ...meta,
            });
            return startSession(tx, config, personId, "discord", "basic", meta);
        });
        setSessionCookie(reply, config, session);
        return "willkommen";
    }

    // `confirm` und `link` gehören zu einer laufenden Sitzung derselben Person.
    const session = await liveSession(database, flow.sessionId, flow.personId);
    if (session === undefined) return "abgelaufen";

    if (flow.purpose === "confirm") {
        if (known?.person_id !== flow.personId) return "andere_person";
        const rotated = await database.begin(async (tx) => {
            await updateDiscordProfile(tx, flow.personId!, user);
            // Nur frisch, nie stärker: Discord ist kein zweiter Faktor (Betreiber 2026-10-10, „4. B“).
            await tx`UPDATE avesmaps_auth.session SET confirmed_at = now() WHERE id = ${session.id}`;
            const next = await rotateSession(tx, session, "confirmed");
            await recordEvent(tx, {
                environment,
                action: "confirm.success",
                actorKind: "person",
                actorPersonId: flow.personId,
                targetPersonId: flow.personId,
                details: { method: "discord" },
                sessionId: next.id,
                ...meta,
            });
            return next;
        });
        setSessionCookie(reply, config, rotated);
        return "bestaetigt";
    }

    // link
    if (known !== undefined) return known.person_id === flow.personId ? "schon_verknuepft" : "discord_vergeben";
    const [own] = await database<{ person_id: string }[]>`
        SELECT person_id FROM avesmaps_auth.discord_login WHERE person_id = ${flow.personId}
    `;
    if (own !== undefined) return "schon_verknuepft";
    await database.begin(async (tx) => {
        await tx`
            INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id, discord_username, discord_global_name)
            VALUES (${flow.personId}, ${user.id}, ${user.username}, ${user.globalName})
        `;
        await recordEvent(tx, {
            environment,
            action: "discord.linked",
            actorKind: "person",
            actorPersonId: flow.personId,
            targetPersonId: flow.personId,
            details: { discordUsername: user.username },
            sessionId: session.id,
            ...meta,
        });
    });
    return "verknuepft";
}

/**
 * Der Rückweg des Zwecks `melder`: Kennung und Anzeigename an den Melder des Vorgangs zum Statusschlüssel (nur sein Hash steht im Umweg). Kein Konto, keine Sitzung, kein Cookie der Anmeldung.
 * 🔴 Die Kennung geht nur an die Datenbankfunktion; kein Fehlertext und kein Protokoll nennt sie.
 */
async function connectMelder(database: Database, flow: OAuthFlow, user: DiscordUser): Promise<MelderOutcome> {
    if (flow.melderHash === null) return "nicht_gefunden";
    try {
        await discordVerbinden(database, flow.melderHash, user.id, displayNameFrom(user));
        return "verbunden";
    } catch (error) {
        if (error instanceof CommunityFehler && error.code === "community_not_found") return "nicht_gefunden";
        return "discord_fehler";
    }
}

export const authDiscordRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const limiter = createRateLimiter(PER_IP_PER_MINUTE, 60_000);
    const errors = {
        400: ApiErrorBody,
        401: ApiErrorBody,
        403: ApiErrorBody,
        415: ApiErrorBody,
        429: ApiErrorBody,
        503: ApiErrorBody,
    };

    app.post(
        "/api/auth/discord/start",
        {
            config: { auth: "public", errorEnvelope: true, writeClass: "account" },
            bodyLimit: 2048,
            schema: { body: StartBody, response: { 200: StartResponse, ...errors } },
        },
        async (request, reply) => {
            const config = app.authConfig;
            if (config.environment === undefined || app.database === undefined) {
                throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
            }
            if (config.discord === undefined || app.discordClient === undefined) {
                throw new ApiError(
                    503,
                    "discord_unavailable",
                    "Die Anmeldung mit Discord ist hier nicht eingerichtet.",
                );
            }
            if (!limiter.allows(throttleAddress(request.ip))) {
                throw new ApiError(429, "rate_limited", "Zu viele Versuche. Gleich noch einmal versuchen.", {
                    retryAfterSeconds: 60,
                });
            }
            limiter.record(throttleAddress(request.ip));
            const purpose: OAuthPurpose = request.body.purpose;
            let personId: string | null = null;
            let sessionId: string | null = null;
            let invitationId: string | null = null;
            let melderHash: Buffer | null = null;
            if (purpose === "melder") {
                const schluessel = request.body.schluessel;
                if (schluessel === undefined) {
                    throw new ApiError(400, "validation_failed", "Die Anfrage ist unvollständig oder falsch geformt.");
                }
                // Gibt es die Meldung noch? Derselbe Satz und Status wie die Statusseite, ohne zu verraten, ob es sie gab. Fehlt das Modul, ist die Verbindung nicht möglich.
                let da: Awaited<ReturnType<typeof statusLesen>>;
                try {
                    da = await statusLesen(app.database, schluessel);
                } catch (error) {
                    if (isNotProvisioned(error)) {
                        throw new ApiError(503, "community_unavailable", "Die Community ist hier nicht eingerichtet.");
                    }
                    throw error;
                }
                if (da === null) {
                    throw new ApiError(404, "community_not_found", "Zu diesem Link gibt es keine Meldung (mehr).");
                }
                melderHash = schluesselHash(schluessel);
            } else if (purpose === "invitation") {
                const token = request.body.invitationToken;
                const invitation =
                    token === undefined ? undefined : await findOpenInvitation(app.database, token, config.environment);
                if (invitation === undefined) {
                    throw new ApiError(
                        400,
                        "invitation_invalid",
                        "Diese Einladung gilt nicht mehr. Eine neue kommt von der Verwaltung.",
                    );
                }
                invitationId = invitation.id;
            } else if (purpose !== "login") {
                const session = await request.auth.session();
                if (session === undefined)
                    throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
                personId = session.personId;
                sessionId = session.id;
                const recent = Date.now() - session.confirmedAt.getTime() <= config.session.stepUpMinutes * 60_000;
                if (purpose === "link" && !recent) {
                    throw new ApiError(403, "reauth_required", "Die Anmeldung muss kurz bestätigt werden.", {
                        need: "confirmation",
                    });
                }
            }
            const flow = await createFlow(app.database, {
                purpose,
                personId,
                sessionId,
                invitationId,
                // Ein Melder kehrt immer auf die Statusseite zurück (`/meldung`), gleich was der Rumpf sagt.
                returnPath: purpose === "melder" ? STATUS_PFAD : safeReturnPath(request.body.returnPath),
                melderHash,
            });
            setFlowCookie(reply, config, flow.nonce);
            void reply.header("cache-control", "no-store");
            return {
                authorizeUrl: authorizeUrl(
                    config,
                    flow.state,
                    flow.challenge,
                    purpose === "login" ? "none" : "consent",
                ),
            };
        },
    );

    app.get(
        "/api/auth/discord/callback",
        { config: { auth: "public" }, schema: { querystring: CallbackQuery } },
        async (request, reply) => {
            const config = app.authConfig;
            const database = app.database;
            const client = app.discordClient;
            clearFlowCookie(reply, config);
            if (
                config.environment === undefined ||
                database === undefined ||
                client === undefined ||
                config.discord === undefined
            ) {
                return backToApp(reply, null, "discord_fehler");
            }
            const { code, state, error } = request.query;
            if (state === undefined) return backToApp(reply, null, "abgelaufen");
            const nonce = parseCookies(request.headers.cookie).get(oauthCookieName(config));
            const flow = await consumeFlow(database, state, nonce);
            if (flow === undefined) return backToApp(reply, null, "abgelaufen");
            if (flow.purpose === "melder") {
                // Der Weg des Melders hat sein eigenes Ergebnis und seinen eigenen Parameter (`?discord=`): Er meldet nichts an und setzt keinen Cookie.
                if (error !== undefined || code === undefined) {
                    return backToApp(reply, flow.returnPath, "abgebrochen", "discord");
                }
                const token = await client.exchangeCode(code, flow.codeVerifier);
                if (token === undefined) return backToApp(reply, flow.returnPath, "discord_fehler", "discord");
                const user = await client.fetchUser(token.accessToken);
                await client.revoke(token.accessToken);
                if (user === undefined) return backToApp(reply, flow.returnPath, "discord_fehler", "discord");
                return backToApp(reply, flow.returnPath, await connectMelder(database, flow, user), "discord");
            }
            if (error !== undefined || code === undefined) {
                // Ohne frühere Freigabe kann `prompt=none` scheitern: dann einmal mit Zustimmungsschirm (Recherche A1, auf Stage zu prüfen).
                if (flow.purpose === "login" && error !== "access_denied") {
                    const retry = await createFlow(database, { purpose: "login", returnPath: flow.returnPath });
                    setFlowCookie(reply, config, retry.nonce);
                    return reply
                        .code(303)
                        .header("cache-control", "no-store")
                        .header("location", authorizeUrl(config, retry.state, retry.challenge, "consent"))
                        .send();
                }
                return backToApp(reply, flow.returnPath, "abgebrochen");
            }
            const token = await client.exchangeCode(code, flow.codeVerifier);
            if (token === undefined) return backToApp(reply, flow.returnPath, "discord_fehler");
            const user = await client.fetchUser(token.accessToken);
            await client.revoke(token.accessToken);
            if (user === undefined) return backToApp(reply, flow.returnPath, "discord_fehler");
            const outcome = await complete(database, config, flow, user, reply, requestMeta(request));
            return backToApp(reply, flow.returnPath, outcome);
        },
    );
};
