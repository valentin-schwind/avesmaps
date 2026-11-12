import type { DiscordConfig } from "./config.ts";

/**
 * Der Draht zu Discord (WI-0120 A5, AUTH-0001 §6.3; Recherche A1–A5). Nur drei Aufrufe: Code gegen Token tauschen (mit PKCE),
 * `/users/@me` lesen, Token widerrufen. Das Token lebt nur in dieser Funktion; es wird nie gespeichert und nie geloggt
 * (Kap. 10.45: „Discord-Access-Tokens sind nicht die Session“).
 *
 * - Token- und Widerrufsendpunkt nehmen nur `application/x-www-form-urlencoded`.
 * - Jede Anfrage hat eine Frist von 10 s und wird bei 4xx nie wiederholt.
 * - Die Snowflake bleibt Text (bis 64 Bit, in JavaScript nie `Number`).
 * - Übernommen werden nur Kennung, Benutzername und Anzeigename. Discords Zwei-Faktor-Angabe bleibt draußen (Betreiber 2026-10-10:
 *   „B: nicht mehr speichern“; schon vorher zählte sie nicht als Faktor, „4. B“). Ein Wächter in `auth-discord.test.ts` hält jeden
 *   Quelltext davon frei.
 */
export interface DiscordUser {
    id: string;
    username: string;
    globalName: string | null;
}

export interface DiscordClient {
    /** Tauscht den Code; gibt `undefined` zurück, wenn Discord ablehnt oder nicht erreichbar ist. */
    exchangeCode(code: string, codeVerifier: string): Promise<{ accessToken: string } | undefined>;
    fetchUser(accessToken: string): Promise<DiscordUser | undefined>;
    /** Bestmöglich: ein Fehler beim Widerruf hält keine Anmeldung auf. */
    revoke(accessToken: string): Promise<void>;
}

/** Feste Zeitgrenze je Aufruf, keine Wiederholung (Claudio 2026-10-09: höchstens 5 s). */
const TIMEOUT_MS = 5_000;
const USER_AGENT = "DiscordBot (https://avesmaps.de, 1.0) Avesmaps3D-Anmeldung";

function form(values: Record<string, string>): string {
    return new URLSearchParams(values).toString();
}

export function createDiscordClient(config: DiscordConfig, fetcher: typeof fetch = fetch): DiscordClient {
    const credentials = { client_id: config.clientId, client_secret: config.clientSecret };
    const post = (path: string, body: Record<string, string>) =>
        fetcher(`${config.apiBase}${path}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
            body: form({ ...body, ...credentials }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    return {
        async exchangeCode(code, codeVerifier) {
            try {
                const response = await post("/oauth2/token", {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: config.redirectUri,
                    code_verifier: codeVerifier,
                });
                if (!response.ok) return undefined;
                const body = (await response.json()) as { access_token?: unknown; token_type?: unknown };
                return typeof body.access_token === "string" ? { accessToken: body.access_token } : undefined;
            } catch {
                return undefined;
            }
        },
        async fetchUser(accessToken) {
            try {
                const response = await fetcher(`${config.apiBase}/users/@me`, {
                    headers: { authorization: `Bearer ${accessToken}`, "user-agent": USER_AGENT },
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });
                if (!response.ok) return undefined;
                const body = (await response.json()) as Record<string, unknown>;
                if (typeof body["id"] !== "string" || !/^[0-9]{15,21}$/u.test(body["id"])) return undefined;
                return {
                    id: body["id"],
                    username: typeof body["username"] === "string" ? body["username"] : "",
                    globalName: typeof body["global_name"] === "string" ? body["global_name"] : null,
                };
            } catch {
                return undefined;
            }
        },
        async revoke(accessToken) {
            try {
                await post("/oauth2/token/revoke", { token: accessToken, token_type_hint: "access_token" });
            } catch {
                // bestmöglich
            }
        },
    };
}
