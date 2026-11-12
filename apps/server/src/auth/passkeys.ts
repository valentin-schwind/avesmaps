import type { FastifyRequest } from "fastify";
import type { AuthConfig } from "./config.ts";
import type { Sql } from "./session-store.ts";
import { randomToken, tokenHash } from "./tokens.ts";
import type { RelyingParty } from "./webauthn.ts";

/**
 * Passkeys: Relying Party, Challenges und Speicher (WI-0120 A6, ADR-0021, AUTH-0001 §11.4).
 */

/**
 * RP-ID = Host der Umgebung, Herkunft genau `PUBLIC_ORIGIN`. Lokal über `localhost` und, wenn eingestellt, über die HTTPS-Adresse
 * im Tailnet (`localHttpsHost`, WI-0180 §13; Betreiber 2026-10-17: „schalte Passkeys lokal auf der ts.net-Adresse frei“). Dort
 * nur über `https://`: Ein Browser gibt WebAuthn nur einer sicheren Adresse, und die Herkunft muss genau passen.
 */
export function relyingPartyFor(
    config: AuthConfig,
    request: Pick<FastifyRequest, "headers">,
): RelyingParty | undefined {
    if (config.publicOrigin !== undefined) {
        return { rpId: new URL(config.publicOrigin).hostname, origins: [config.publicOrigin] };
    }
    const host = request.headers.host;
    if (host === undefined) return undefined;
    const name = host.split(":")[0]!.toLowerCase();
    if (config.localHttpsHost !== undefined && name === config.localHttpsHost) {
        return { rpId: name, origins: [`https://${host.toLowerCase()}`] };
    }
    if (name !== "localhost") return undefined;
    return { rpId: "localhost", origins: [`http://${host}`, `https://${host}`] };
}

export const CHALLENGE_MINUTES = 5;
export type ChallengePurpose = "register" | "confirm" | "login";

export async function createChallenge(
    sql: Sql,
    input: { purpose: ChallengePurpose; sessionId: string; personId: string },
    now: Date = new Date(),
): Promise<string> {
    const challenge = randomToken();
    await sql`
        INSERT INTO avesmaps_auth.webauthn_challenge (challenge_hash, session_id, person_id, purpose, created_at, expires_at)
        VALUES (${tokenHash(challenge)}, ${input.sessionId}, ${input.personId}, ${input.purpose}, ${now},
                ${new Date(now.getTime() + CHALLENGE_MINUTES * 60_000)})
    `;
    return challenge;
}

/** Verbraucht eine Challenge genau einmal, nur für denselben Zweck und dieselbe Sitzung. */
export function challengeConsumer(
    sql: Sql,
    purpose: ChallengePurpose,
    sessionId: string,
): (challenge: string) => Promise<boolean> {
    return async (challenge) => {
        const rows = await sql`
            UPDATE avesmaps_auth.webauthn_challenge SET consumed_at = now()
             WHERE challenge_hash = ${tokenHash(challenge)} AND purpose = ${purpose} AND session_id = ${sessionId}
               AND consumed_at IS NULL AND expires_at > now()
        `;
        return rows.count === 1;
    };
}

export interface PasskeyRow {
    id: string;
    credential_id: string;
    public_key: Buffer;
    sign_count: string;
    transports: string[];
    label: string | null;
    backed_up: boolean;
    device_type: string | null;
    created_at: Date;
    last_used_at: Date | null;
}

/** Die aktiven Passkeys einer Person in dieser Umgebung und RP-ID. */
export async function activePasskeys(
    sql: Sql,
    personId: string,
    environment: string,
    rpId: string,
): Promise<PasskeyRow[]> {
    return sql<PasskeyRow[]>`
        SELECT id, credential_id, public_key, sign_count::text AS sign_count, transports, label, backed_up, device_type, created_at, last_used_at
          FROM avesmaps_auth.passkey_credential
         WHERE person_id = ${personId} AND environment = ${environment} AND rp_id = ${rpId} AND revoked_at IS NULL
         ORDER BY created_at
    `;
}
