import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from "fastify";
import { VIEWER_CAPABILITIES, rechteVon, type Capability } from "@avesmaps3d/shared";
import { isNotProvisioned } from "../database.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { ApiError } from "../http/api-error.ts";
import { truncatedAddress } from "../log-address.ts";
import type { RouteWriteClass } from "../system/write-guard.ts";
import { checkAssurance, type Confirmation } from "./assurance.ts";
import { clientLabel } from "./client-label.ts";
import { DISABLED_AUTH, sessionCookieName, type AuthConfig } from "./config.ts";
import { parseCookies, serializeCookie } from "./cookies.ts";
import {
    SESSION_UNBOUNDED,
    loadSession,
    rotateSession,
    touchSession,
    type IssuedSession,
    type SessionRecord,
} from "./session-store.ts";
import { isWellFormedToken } from "./tokens.ts";

/**
 * Die Anmeldung in Fastify (WI-0120 A3, AUTH-0001 §6, §8).
 *
 * - `request.auth.session()` lädt die Sitzung erst, wenn eine Route sie braucht, einmal je Anfrage. Öffentliche Lesepfade
 *   (Karte, Kacheln) fragen die Datenbank dafür nie.
 * - Schreibende Anfragen an `/api/auth/*`, `/api/account/*`, `/api/admin/*` und jede schreibende Anfrage, die das
 *   Sitzungscookie mitbringt, müssen von der eigenen Seite kommen (`Sec-Fetch-Site: same-origin`, exakter `Origin`;
 *   Kap. 10.52, AUTH-0001 §6.2). 🪤 Stage und Production sind „same-site“; `SameSite` allein trennt sie nicht.
 * - Eine geschützte Route trägt `...protect("capability")`: Recht, Sicherheitsstufe und Bestätigung prüft der Server.
 *
 * Sitzt am Root vor allen `register`-Aufrufen, weil jede Route ein gekapseltes Plugin ist (`app.ts`).
 */
declare module "fastify" {
    interface FastifyInstance {
        authConfig: AuthConfig;
    }
    interface FastifyRequest {
        auth: AuthContext;
    }
    interface FastifyContextConfig {
        /** `"public"` oder das Recht der Route; der Test `auth-routes.test.ts` verlangt eins von beiden je Route. */
        auth?:
            | "public"
            | "session"
            | "abzug_schluessel"
            | "karten_zugang"
            | { capability: Capability; confirm?: Confirmation };
    }
}

export interface AuthContext {
    /** Die Sitzung dieser Anfrage; `undefined` ohne Anmeldung. Einmal geladen, rotiert bei Bedarf. */
    session(): Promise<SessionRecord | undefined>;
    /** Was diese Anfrage darf: aus Rolle und Sonderrechten, ohne Anmeldung die Besucher- oder Übergangsansicht. */
    capabilities(): Promise<ReadonlySet<Capability>>;
    /**
     * Erneuert das Sitzungscookie mit voller Laufzeit (`SESSION_COOKIE_MAX_AGE_S`), falls diese Anfrage es nicht schon gesetzt hat
     * (Rotation). Nur `GET /api/auth/session` ruft es, beim Laden jeder Seite; die Tür nie (sie schreibt nichts, `gate.ts`).
     */
    renewCookie(): Promise<void>;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const AUTH_PREFIXES = ["/api/auth/", "/api/account/", "/api/admin/"] as const;

/** Die Meldung zu 503 `auth_unavailable`, solange Schema oder Rechte der Anmeldung fehlen (eine Instanz vor `migrate`/`db-grants`). */
export const AUTH_NOT_READY = "Die Anmeldung ist auf dieser Instanz noch nicht bereit.";

/** Hängt ein `Set-Cookie` an, ohne ein schon gesetztes zu verlieren. */
export function appendSetCookie(reply: FastifyReply, value: string): void {
    const previous = reply.getHeader("set-cookie");
    const list = previous === undefined ? [] : Array.isArray(previous) ? previous.map(String) : [String(previous)];
    void reply.header("set-cookie", [...list, value]);
}

/**
 * Das Höchste, was ein Browser einem Cookie an Laufzeit lässt: Chrome kappt `Max-Age` bei 400 Tagen (RFC 6265bis, „cookie
 * lifetime limits“). Eine Sitzung hat seit 2026-10-10 kein Ende mehr; das Cookie bekommt dieses Maximum und es bei jedem Laden
 * der Seite neu (`renewCookie`), damit eine benutzte Sitzung nie abläuft.
 */
export const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * Das Sitzungscookie lebt so lange wie die Sitzung selbst (AUTH-0001 §6.1, §11.2): `Max-Age` ist ihr verbleibendes Ende,
 * höchstens `SESSION_COOKIE_MAX_AGE_S`; eine gewöhnliche Sitzung hat keines (also das Maximum), ein Notzugang seine 60 Minuten.
 * Ein Cookie ohne `Max-Age` werfen mobile Browser beim Beenden weg, und die Anmeldung wäre auf dem Handy so lästig wie Basic
 * Auth (Betreiber 2026-10-09: „ich will auf der stage nur basic-auth loswerden weil es das aufm handy nicht speichert“).
 */
export function setSessionCookie(
    reply: FastifyReply,
    config: AuthConfig,
    session: Pick<IssuedSession, "token" | "expiresAt">,
    now: number = Date.now(),
): void {
    const remaining = Math.ceil((session.expiresAt.getTime() - now) / 1000);
    const maxAge = Math.max(0, Math.min(SESSION_COOKIE_MAX_AGE_S, remaining));
    appendSetCookie(
        reply,
        serializeCookie(sessionCookieName(config), session.token, { secure: !config.insecureCookie, maxAge }),
    );
}

export function clearSessionCookie(reply: FastifyReply, config: AuthConfig): void {
    appendSetCookie(
        reply,
        serializeCookie(sessionCookieName(config), "", { secure: !config.insecureCookie, maxAge: 0 }),
    );
}

/** Kommt die Anfrage von der eigenen Seite? (OWASP CSRF: Fetch Metadata zuerst, `Origin` als Pflicht-Rückfall.) */
export function sameOriginRequest(request: FastifyRequest, config: AuthConfig): boolean {
    return sameOriginHeaders(request.headers, config);
}

/**
 * Dieselbe Prüfung an rohen Kopfzeilen: am Handschlag von `/ws`, der an Fastify vorbeiläuft (WI-0120 A11). Ein Browser schickt
 * dort immer `Origin`; ohne die Prüfung könnte eine fremde Seite mit dem Cookie der Person mithören (Cross-Site WebSocket Hijacking).
 */
export function sameOriginHeaders(headers: IncomingHttpHeaders, config: AuthConfig): boolean {
    const site = headers["sec-fetch-site"];
    if (typeof site === "string" && site !== "same-origin") return false;
    const origin = headers.origin;
    if (typeof origin !== "string" || origin === "" || origin === "null") return false;
    if (config.publicOrigin !== undefined) return origin === config.publicOrigin;
    try {
        return new URL(origin).host.toLowerCase() === (headers.host ?? "").toLowerCase();
    } catch {
        return false;
    }
}

export function requestMeta(request: FastifyRequest): {
    ipPrefix: string | undefined;
    clientLabel: string | undefined;
} {
    return { ipPrefix: truncatedAddress(request.ip), clientLabel: clientLabel(request.headers["user-agent"]) };
}

function createAuthContext(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): AuthContext {
    const config = app.authConfig;
    let loaded: Promise<SessionRecord | undefined> | undefined;
    /** Das Token, das der Browser nach dieser Anfrage trägt, und ob sie das Cookie schon gesetzt hat (Rotation). */
    let current: { token: string; cookieSet: boolean } | undefined;
    const lookup = async (): Promise<SessionRecord | undefined> => {
        const database = app.database;
        if (config.environment === undefined || database === undefined) return undefined;
        const token = parseCookies(request.headers.cookie).get(sessionCookieName(config));
        if (token === undefined) return undefined;
        const session = isWellFormedToken(token) ? await loadSession(database, token, config.environment) : undefined;
        if (session === undefined) {
            clearSessionCookie(reply, config);
            return undefined;
        }
        await touchSession(database, session);
        if (!session.rotateRequired) {
            current = { token, cookieSet: false };
            return session;
        }
        const rotated = await rotateSession(database, session, "rotated");
        setSessionCookie(reply, config, rotated);
        current = { token: rotated.token, cookieSet: true };
        return { ...session, id: rotated.id, rotateRequired: false };
    };
    // Fehlen Schema oder Rechte noch (der Korridor startet Fastify vor `migrate`, Claudio 2026-10-09): 503, kein 500 und kein Absturz.
    const load = async (): Promise<SessionRecord | undefined> => {
        try {
            return await lookup();
        } catch (error) {
            if (isNotProvisioned(error)) throw new ApiError(503, "auth_unavailable", AUTH_NOT_READY);
            throw error;
        }
    };
    return {
        session: () => (loaded ??= load()),
        renewCookie: async () => {
            const session = await (loaded ??= load());
            if (session === undefined || current === undefined || current.cookieSet) return;
            const end = session.assurance === "recovery" ? session.expiresAt : SESSION_UNBOUNDED;
            setSessionCookie(reply, config, { token: current.token, expiresAt: end });
            current = { ...current, cookieSet: true };
        },
        capabilities: async () => {
            const session = await (loaded ??= load());
            if (session !== undefined) return rechteHier(rechteVon(session), config.kanal);
            // Ohne eingerichtete Anmeldung gilt die Instanz als geschützt (Basic Auth, lokal): die Editor-Ansicht wie vor WI-0120,
            // dieselbe, die der Client dann zeigt (`session-state.ts`). Sonst entscheidet die Übergangsansicht.
            const editorView = config.environment === undefined || config.anonymousView === "editor";
            return new Set<Capability>(editorView ? VIEWER_CAPABILITIES : []);
        },
    };
}

export function registerAuth(app: FastifyInstance, config: AuthConfig = DISABLED_AUTH): void {
    app.decorate("authConfig", config);
    app.decorateRequest("auth", null as unknown as AuthContext);
    app.addHook("onRequest", async (request, reply) => {
        request.auth = createAuthContext(app, request, reply);
        if (!UNSAFE_METHODS.has(request.method)) return;
        const authPath = AUTH_PREFIXES.some((prefix) => request.url.startsWith(prefix));
        const withCookie = parseCookies(request.headers.cookie).has(sessionCookieName(config));
        if ((authPath || withCookie) && !sameOriginRequest(request, config)) {
            throw new ApiError(403, "forbidden_origin", "Diese Anfrage muss von Avesmaps selbst kommen.");
        }
    });
}

/**
 * Hat die Sitzung das Recht (nach Rolle und Zuteilung), ohne die Sicherheitsstufe oder eine Bestätigung zu prüfen? Für die Oberfläche: Ob eine Schaltfläche dasteht, hängt am Recht; den frischen Passkey
 * einer Stufe S verlangt erst die Route der Handlung (`protect`, `demand`).
 */
export function hatRecht(session: SessionRecord, capability: Capability, config: AuthConfig): boolean {
    return rechteHier(rechteVon(session), config.kanal).has(capability);
}

/**
 * Verlangt von einer Sitzung ein Recht samt Sicherheitsstufe und Bestätigung: 403 `forbidden`, `assurance_required` oder
 * `reauth_required`. `protect` nutzt es für das Recht der Route; eine Route ruft es selbst für ein Recht, das erst der
 * Inhalt verlangt (etwa `assign_admin`, sobald eine Handlung Admins betrifft).
 */
export function demand(
    session: SessionRecord,
    capability: Capability,
    config: AuthConfig,
    confirm?: Confirmation,
): void {
    if (!rechteHier(rechteVon(session), config.kanal).has(capability)) {
        throw new ApiError(403, "forbidden", "Dafür fehlt das Recht.");
    }
    const verdict = checkAssurance(session, capability, config, confirm);
    if (!verdict.ok) {
        const message =
            verdict.code === "assurance_required"
                ? "Dafür ist eine Anmeldung mit zweitem Faktor nötig."
                : "Die Anmeldung muss kurz bestätigt werden.";
        throw new ApiError(403, verdict.code, message, { need: verdict.need });
    }
}

/**
 * Der Wächter einer geschützten Route: angemeldet (401), Recht (403 `forbidden`), Sicherheitsstufe (403
 * `assurance_required`) und Bestätigung (403 `reauth_required`). Mit `...protect(…)` in die Routenoptionen. Er läuft vor der
 * Schemaprüfung (`preValidation`): Wer nicht darf, bekommt 401/403 und erfährt nichts über die erwartete Form der Anfrage.
 *
 * Eine schreibende Route nennt hier auch ihre Klasse (`writeClass`, WI-0127 SYS-4, `system/write-guard.ts`).
 */
export function protect(
    capability: Capability,
    options: { confirm?: Confirmation; writeClass?: RouteWriteClass } = {},
): {
    config: {
        auth: { capability: Capability; confirm?: Confirmation };
        errorEnvelope: true;
        writeClass?: RouteWriteClass;
    };
    preValidation: preValidationAsyncHookHandler;
} {
    const preValidation: preValidationAsyncHookHandler = async function (request) {
        const config = this.authConfig;
        if (config.environment === undefined || this.database === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        const session = await request.auth.session();
        if (session === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
        demand(session, capability, config, options.confirm);
    };
    const auth = options.confirm === undefined ? { capability } : { capability, confirm: options.confirm };
    const writeClass = options.writeClass === undefined ? {} : { writeClass: options.writeClass };
    return { config: { auth, errorEnvelope: true, ...writeClass }, preValidation };
}

/**
 * Verlangt eines von mehreren Rechten (WI-0279): das erste, das die Sitzung hat, samt seiner Stufe und der Bestätigung; hat sie keines, 403 wie
 * beim ersten. So kommt eine Sonderrolle mit ihrem Fachrecht an eine Route, und wer heute ein Sammelrecht trägt, behält seinen Weg.
 */
export function demandEines(
    session: SessionRecord,
    rechte: readonly [Capability, ...Capability[]],
    config: AuthConfig,
    confirm?: Confirmation,
): void {
    demand(session, rechte.find((recht) => hatRecht(session, recht, config)) ?? rechte[0], config, confirm);
}

/** Wie `protect`, aber eines der Rechte genügt. Das erste steht in `config.auth.capability`, alle in `config.auth.eines`. */
export function protectEines(
    rechte: readonly [Capability, ...Capability[]],
    options: { confirm?: Confirmation; writeClass?: RouteWriteClass } = {},
): {
    config: {
        auth: { capability: Capability; eines: readonly Capability[]; confirm?: Confirmation };
        errorEnvelope: true;
        writeClass?: RouteWriteClass;
    };
    preValidation: preValidationAsyncHookHandler;
} {
    const preValidation: preValidationAsyncHookHandler = async function (request) {
        const config = this.authConfig;
        if (config.environment === undefined || this.database === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        const session = await request.auth.session();
        if (session === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
        demandEines(session, rechte, config, options.confirm);
    };
    const auth = {
        capability: rechte[0],
        eines: rechte,
        ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    };
    const writeClass = options.writeClass === undefined ? {} : { writeClass: options.writeClass };
    return { config: { auth, errorEnvelope: true, ...writeClass }, preValidation };
}

/**
 * Der Wächter für Handlungen am eigenen Konto: nur eine gültige Sitzung (401 ohne), kein besonderes Recht. Was eine solche
 * Handlung zusätzlich verlangt (aktuelles Passwort, frische Bestätigung), prüft die Route selbst. Ihre Schreibklasse ist immer
 * `account` (SYS-4): das eigene Konto bleibt unter beiden Sperren offen.
 */
export function sessionOnly(): {
    config: { auth: "session"; errorEnvelope: true; writeClass: "account" };
    preValidation: preValidationAsyncHookHandler;
} {
    const preValidation: preValidationAsyncHookHandler = async function (request) {
        if (this.authConfig.environment === undefined || this.database === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        if ((await request.auth.session()) === undefined) {
            throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
        }
    };
    return { config: { auth: "session", errorEnvelope: true, writeClass: "account" }, preValidation };
}
