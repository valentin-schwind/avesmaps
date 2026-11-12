import type { KanalSchalter } from "@avesmaps3d/shared";
import { kanalSchalter } from "../kanal/schalter.ts";

/**
 * Einstellungen der Anmeldung (WI-0120 A3, AUTH-0001 §6). Werte kommen nur aus der Umgebung (Kap. 10.4, 10.151).
 *
 * 🔴 AUS, solange die Umgebung nicht benannt ist: Ohne `AVESMAPS_ENV` (und außerhalb der lokalen Entwicklung) gibt es keine
 * Anmeldung. Ein Release mit diesem Code darf also auf eine Stage, deren `.env` den Schlüssel noch nicht kennt: alles läuft
 * wie bisher, nur Anmelden geht nicht. So hängt kein anderes Release an Claudios Vorbereitung (AUTH-0001 R2).
 */
export const AUTH_ENVIRONMENTS = ["development", "staging", "production", "test"] as const;
export type AuthEnvironment = (typeof AUTH_ENVIRONMENTS)[number];

export interface AuthConfig {
    /** Ohne Umgebung bleibt die Anmeldung aus. */
    readonly environment: AuthEnvironment | undefined;
    /**
     * Ob der Betreiber-Kanal hier lebt (`KANAL`, WI-0124; Betreiber 2026-10-13). Bei `aus` fällt `use_operator_channel` aus jeder
     * Sitzung (`kanal/schalter.ts`). Er steht hier und nicht nur in `ServerConfig`, weil die Rechte ihn brauchen und `demand` nur
     * diese Konfiguration kennt; gelesen wird er an einer Stelle (`kanalSchalter`).
     */
    readonly kanal?: KanalSchalter | undefined;
    /** Die öffentliche Herkunft (`https://stage.avesmaps.de`); lokal ohne Wert: Herkunft aus dem `Host` der Anfrage. */
    readonly publicOrigin: string | undefined;
    /** Nur `development`: Cookie ohne `Secure` und ohne `__Host-`, für `http://<Tailscale-IP>`. */
    readonly insecureCookie: boolean;
    /**
     * Nur `development`: die HTTPS-Adresse im Tailnet (`<rechner>.<tailnet>.ts.net`, `AUTH_LOCAL_HTTPS_HOST`), unter der Passkeys
     * lokal neben `localhost` gehen (WI-0180 §13). Das Startskript setzt sie aus `tailscale status`; ohne Wert nur `localhost`.
     */
    readonly localHttpsHost?: string | undefined;
    /** Was ein nicht angemeldeter Besucher sieht: `visitor` (nichts) oder `editor` (Editor-Ansicht ohne Schreibrecht, Stage-Übergang). */
    readonly anonymousView: "visitor" | "editor";
    /** Discord als Ausweis (AUTH-0001 §6.3); ohne Client-ID und Geheimnis gibt es nur die Passwortanmeldung. */
    readonly discord?: DiscordConfig | undefined;
    /**
     * Fristen der Sitzung. Eine gewöhnliche Sitzung hat seit 2026-10-10 KEINE (kein Leerlauf, keine absolute Laufzeit; Betreiber:
     * „ja“ auf „Meintest du auch die Sitzung?“, `session-store.ts` `SESSION_UNBOUNDED`), ebenso keine Frist des zweiten Faktors.
     */
    readonly session: {
        /** Heikle Handlungen: Bestätigung höchstens so alt (Minuten). Stufe V selbst hat keine Frist mehr (Betreiber 2026-10-10). */
        readonly stepUpMinutes: number;
        /** Stufe S: frischer Passkey-Nachweis höchstens so alt (Minuten). */
        readonly systemStepUpMinutes: number;
        /** Notzugang: Lebensdauer (Minuten), nicht verlängerbar. */
        readonly recoveryMinutes: number;
    };
}

/**
 * Eine Discord-Applikation je Umgebung (ADR-0013, Recherche A7). Das Geheimnis kommt nur aus der Umgebung (`.env` auf dem
 * VPS, Claudio; lokal trägt es der Betreiber selbst ein) und wird nie geloggt.
 */
export interface DiscordConfig {
    readonly clientId: string;
    readonly clientSecret: string;
    /** Muss exakt einer im Developer Portal eingetragenen Adresse entsprechen. */
    readonly redirectUri: string;
    readonly authorizeUrl: string;
    /** `https://discord.com/api/v10`; in Tests ein lokaler Ersatz. */
    readonly apiBase: string;
}

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_API_BASE = "https://discord.com/api/v10";

export const DEFAULT_SESSION = {
    stepUpMinutes: 15,
    systemStepUpMinutes: 5,
    recoveryMinutes: 60,
} as const;

const EIN_TAG_MINUTEN = 24 * 60;

/**
 * Lokal und auf der Stage fragt der Passkey einmal am Tag (Vali 2026-11-07: „einmal am tag eine passkeyabfrage erfolgen muss, aber
 * nicht ständig bei jedem vorgang“). Die Frist läuft je Sitzung ab der letzten Bestätigung und gilt auch für die Release-Rechte (Vali
 * 2026-11-07, Antwortknopf „Ja, auch Release“).
 * 🔴 Production, die Tests und ein Release ohne benannte Umgebung bleiben bei `DEFAULT_SESSION`.
 * 🔴 Das Fenster ist keine Freigabe: Den Start des Release-Tests drückt weiter der Betreiber selbst, kein Agent (`AGENTS.md`, „Stage,
 * Production und Operations“). Seit dem Fenster hält das allein diese Regel, nicht der Passkey.
 */
function sessionFristen(environment: AuthEnvironment | undefined): AuthConfig["session"] {
    return environment === "development" || environment === "staging"
        ? { ...DEFAULT_SESSION, stepUpMinutes: EIN_TAG_MINUTEN, systemStepUpMinutes: EIN_TAG_MINUTEN }
        : DEFAULT_SESSION;
}

export const DISABLED_AUTH: AuthConfig = {
    environment: undefined,
    kanal: "an",
    publicOrigin: undefined,
    insecureCookie: false,
    anonymousView: "visitor",
    session: DEFAULT_SESSION,
};

/**
 * Ob Discord an ist und, wenn nicht, warum: als Satz ohne Wert, für das Journal beim Start (Claudio 2026-10-09: Ein fehlendes
 * Geheimnis schaltet Discord ab, mit einer klaren Zeile, statt den Dienst nicht starten zu lassen).
 */
export function discordState(environment: NodeJS.ProcessEnv): { on: true } | { on: false; reason: string } {
    const id = (environment["DISCORD_CLIENT_ID"] ?? "") !== "";
    const secret = (environment["DISCORD_CLIENT_SECRET"] ?? "") !== "";
    if (id && secret) return { on: true };
    if (id) return { on: false, reason: "DISCORD_CLIENT_SECRET fehlt" };
    if (secret) return { on: false, reason: "DISCORD_CLIENT_ID fehlt" };
    return { on: false, reason: "DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET fehlen" };
}

function isEnvironment(value: string | undefined): value is AuthEnvironment {
    return value !== undefined && (AUTH_ENVIRONMENTS as readonly string[]).includes(value);
}

export function loadAuthConfig(environment: NodeJS.ProcessEnv): AuthConfig {
    const named = environment["AVESMAPS_ENV"];
    if (named !== undefined && !isEnvironment(named)) {
        throw new Error(`AVESMAPS_ENV ist keine bekannte Umgebung: ${named}`);
    }
    const local = (environment["RELEASE_ID"] ?? "dev") === "dev";
    const resolved: AuthEnvironment | undefined = named ?? (local ? "development" : undefined);
    // 🔴 Startsperre (Betreiber 2026-10-17 auf „Sollen die zwei falschen Einstellungen den Server am Start hindern?“: Knopf
    // „Ja, beide“; Qualitätsreview 2026-10-12 §6.2): `development` mit `NODE_ENV=production` hieße Cookies ohne `Secure` und keine
    // https-Pflicht auf einem Server, der sich für einen echten hält. Technischer Abbruch wie ein Tippfehler, keine Prüfung.
    if (named === "development" && environment["NODE_ENV"] === "production") {
        throw new Error("AVESMAPS_ENV=development verträgt sich nicht mit NODE_ENV=production.");
    }
    const insecureCookie = environment["AUTH_INSECURE_COOKIE"] === "1";
    if (insecureCookie && resolved !== "development") {
        throw new Error("AUTH_INSECURE_COOKIE=1 ist nur in der lokalen Entwicklung erlaubt.");
    }
    const localHttpsHost = environment["AUTH_LOCAL_HTTPS_HOST"]?.trim().toLowerCase() || undefined;
    if (localHttpsHost !== undefined && resolved !== "development") {
        throw new Error("AUTH_LOCAL_HTTPS_HOST ist nur in der lokalen Entwicklung erlaubt.");
    }
    if (
        localHttpsHost !== undefined &&
        !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u.test(localHttpsHost)
    ) {
        throw new Error(`AUTH_LOCAL_HTTPS_HOST ist kein Hostname: ${localHttpsHost}`);
    }
    const publicOrigin = environment["PUBLIC_ORIGIN"];
    if ((resolved === "staging" || resolved === "production") && publicOrigin === undefined) {
        throw new Error(`PUBLIC_ORIGIN fehlt für AVESMAPS_ENV=${resolved}.`);
    }
    if (
        publicOrigin !== undefined &&
        (resolved === "staging" || resolved === "production") &&
        !publicOrigin.startsWith("https://")
    ) {
        throw new Error("PUBLIC_ORIGIN muss in Stage und Production mit https:// beginnen.");
    }
    // 🔴 Wer nicht angemeldet ist, sieht die Besucheransicht - in JEDER Umgebung, auch lokal (Betreiber 2026-10-12: „da kommen
    // sachen für editoren obwohl ich nicht eingeloggt bin“; derselbe Satz steht an `scripts/dev/start-local-stack.ps1`, das
    // `AUTH_ANONYMOUS_VIEW=visitor` setzt). Die Übergangsansicht `editor` (WI-0120 A9) ist älter als die Anmeldung und gibt es nur
    // noch, wenn jemand sie ausdrücklich verlangt.
    // 🪤 Die Vorgabe stand bis zum Qualitätsreview 2026-10-12 nur im Startskript, nicht hier: `npm run dev:server` sieht das Skript
    // nie, und ohne den Schlüssel in der `.env` bekam ein anonymer Aufruf wieder die Editor-Ansicht - und mit ihr die ganze
    // Statusseite (`auth/status-view.ts`, `statusViewOf` gibt bei `anonymousView: "editor"` ohne Sitzung `view: "all"`).
    const requested = environment["AUTH_ANONYMOUS_VIEW"];
    const anonymousView = requested === "editor" || requested === "visitor" ? requested : "visitor";
    // 🔴 Startsperre (Betreiber 2026-10-17, dieselbe Frage; Qualitätsreview §6.4): die Übergangsansicht nur noch lokal, auch nicht
    // mehr auf der Stage.
    if (anonymousView === "editor" && resolved !== "development") {
        throw new Error("AUTH_ANONYMOUS_VIEW=editor gibt es nur lokal.");
    }
    const origin = publicOrigin?.replace(/\/+$/u, "");
    const clientId = environment["DISCORD_CLIENT_ID"];
    const clientSecret = environment["DISCORD_CLIENT_SECRET"];
    const discord: DiscordConfig | undefined =
        discordState(environment).on && clientId !== undefined && clientSecret !== undefined
            ? {
                  clientId,
                  clientSecret,
                  redirectUri:
                      environment["DISCORD_REDIRECT_URI"] ??
                      `${origin ?? "http://localhost:5173"}/api/auth/discord/callback`,
                  authorizeUrl: DISCORD_AUTHORIZE_URL,
                  apiBase: DISCORD_API_BASE,
              }
            : undefined;
    return {
        environment: resolved,
        kanal: kanalSchalter(environment),
        publicOrigin: origin,
        insecureCookie,
        ...(localHttpsHost === undefined ? {} : { localHttpsHost }),
        anonymousView,
        discord,
        session: sessionFristen(resolved),
    };
}

/** Der Name des Session-Cookies; `__Host-` verlangt `Secure`, `Path=/` und kein `Domain` (AUTH-0001 §6.1). */
export function sessionCookieName(config: AuthConfig): string {
    return config.insecureCookie ? "avesmaps-session" : "__Host-avesmaps-session";
}

/** Der Name des Cookies eines laufenden Discord-Umwegs (AUTH-0001 §6.3). */
export function oauthCookieName(config: AuthConfig): string {
    return config.insecureCookie ? "avesmaps-oauth" : "__Host-avesmaps-oauth";
}
