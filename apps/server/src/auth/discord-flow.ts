import { createHash } from "node:crypto";
import type { Sql } from "./session-store.ts";
import { randomToken, sameSecret, tokenHash } from "./tokens.ts";
import type { DiscordUser } from "./discord-client.ts";

/**
 * Ein laufender Discord-Umweg (WI-0120 A5, AUTH-0001 §6.3, T1, T2): `state` (einmalig, zehn Minuten) bindet die Rückkehr an
 * genau diesen Start, das Browser-Nonce im Cookie bindet sie an genau diesen Browser (Login-CSRF), PKCE S256 macht einen
 * abgefangenen Code ohne den Verifier wertlos. In der Datenbank stehen `state` und Nonce nur als Hash; der Verifier muss
 * im Klartext an Discord und lebt zehn Minuten.
 *
 * Der Zweck `melder` (WI-0268 C8, Fachkonzept §8.3): Ein Melder ohne Konto verbindet seine Meldung mit seiner Discord-Kennung. Der Umweg trägt den HASH des Statusschlüssels (`melder_hash`; der Schlüssel selbst
 * steht nie in der Datenbank, in einer Adresse oder einem Protokoll). Der Hash wird beim Verbrauchen des Umwegs gelesen und in derselben Anweisung geleert.
 */
export type OAuthPurpose = "login" | "link" | "invitation" | "confirm" | "melder";

export const FLOW_MINUTES = 10;

export interface OAuthFlow {
    id: string;
    purpose: OAuthPurpose;
    personId: string | null;
    sessionId: string | null;
    invitationId: string | null;
    returnPath: string | null;
    codeVerifier: string;
    /** Nur beim Zweck `melder`: sha256 des Statusschlüssels der Meldung, die verbunden wird. */
    melderHash: Buffer | null;
}

export function pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Nur ein Pfad der eigenen Seite: beginnt mit genau einem `/`, ohne Rückstrich, ohne Steuerzeichen (T2, keine offene Weiterleitung). */
export function safeReturnPath(value: string | undefined | null): string | null {
    if (value === undefined || value === null || value.length > 300) return null;
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
    // eslint-disable-next-line no-control-regex -- genau Steuerzeichen sind hier verboten
    if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
    if (value.startsWith("/api/")) return null;
    return value;
}

/** Ein Anzeigename aus einer Eingabe: NFC, ohne Steuer- und Richtungszeichen, getrimmt, höchstens 40 Zeichen (T20). */
export function cleanDisplayName(value: string): string {
    const clean = value
        .normalize("NFC")
        // Steuerzeichen (C0, DEL, C1), Zeilen- und Absatztrenner, Bidi- und Nullbreitenzeichen fallen weg: Der Name steht in Protokollen und
        // in zeilenweise gelesenen Proben (Claudio 2026-10-13, Feldtrenner im Freigabe-Abholer \u00a73).
        .replace(/[\p{Cc}\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
        .trim();
    return [...clean].slice(0, 40).join("").trim();
}

/** Ein Anzeigename aus Discord: Anzeigename vor Benutzername; leer ergibt „Discord-Konto“. */
export function displayNameFrom(user: DiscordUser): string {
    const name = cleanDisplayName(user.globalName ?? user.username);
    return name === "" ? "Discord-Konto" : name;
}

export async function createFlow(
    sql: Sql,
    input: {
        purpose: OAuthPurpose;
        personId?: string | null;
        sessionId?: string | null;
        invitationId?: string | null;
        returnPath?: string | null;
        /** Nur für `melder`: sha256 des Statusschlüssels. */
        melderHash?: Buffer | null;
    },
    now: Date = new Date(),
): Promise<{ state: string; nonce: string; challenge: string }> {
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    // Die Spalte `melder_hash` (Migration 0283) fasst nur der Zweck `melder` an: Die übrigen Zwecke schreiben wie vor C8, auch gegen ein Schema, das sie noch nicht hat.
    if (input.melderHash === undefined || input.melderHash === null) {
        await sql`
            INSERT INTO avesmaps_auth.oauth_flow
                (state_hash, browser_nonce_hash, code_verifier, purpose, person_id, session_id, invitation_id, return_path, created_at, expires_at)
            VALUES (${tokenHash(state)}, ${tokenHash(nonce)}, ${verifier}, ${input.purpose}, ${input.personId ?? null},
                    ${input.sessionId ?? null}, ${input.invitationId ?? null}, ${input.returnPath ?? null}, ${now},
                    ${new Date(now.getTime() + FLOW_MINUTES * 60_000)})
        `;
    } else {
        await sql`
            INSERT INTO avesmaps_auth.oauth_flow
                (state_hash, browser_nonce_hash, code_verifier, purpose, person_id, session_id, invitation_id, return_path, melder_hash, created_at, expires_at)
            VALUES (${tokenHash(state)}, ${tokenHash(nonce)}, ${verifier}, ${input.purpose}, ${input.personId ?? null},
                    ${input.sessionId ?? null}, ${input.invitationId ?? null}, ${input.returnPath ?? null}, ${input.melderHash}, ${now},
                    ${new Date(now.getTime() + FLOW_MINUTES * 60_000)})
        `;
    }
    return { state, nonce, challenge: pkceChallenge(verifier) };
}

/**
 * Verbraucht den Umweg zu `state` genau einmal. Ohne passendes Browser-Nonce, abgelaufen oder schon benutzt: `undefined`.
 * Verbraucht wird auch bei falschem Nonce: Ein fremder Browser kann einen Umweg nur verbrennen, nie benutzen.
 */
export async function consumeFlow(sql: Sql, state: string, nonce: string | undefined): Promise<OAuthFlow | undefined> {
    const [row] = await sql<
        {
            id: string;
            purpose: OAuthPurpose;
            person_id: string | null;
            session_id: string | null;
            invitation_id: string | null;
            return_path: string | null;
            code_verifier: string;
            browser_nonce_hash: Buffer;
        }[]
    >`
        UPDATE avesmaps_auth.oauth_flow SET consumed_at = now()
         WHERE state_hash = ${tokenHash(state)} AND consumed_at IS NULL AND expires_at > now()
        RETURNING id, purpose, person_id, session_id, invitation_id, return_path, code_verifier, browser_nonce_hash
    `;
    if (row === undefined) return undefined;
    // Der Hash des Statusschlüssels wird gelesen und im selben Zug geleert, auch wenn das Nonce nicht passt: Ein verbrannter Umweg behält nichts.
    const melderHash = row.purpose === "melder" ? await nimmMelderHash(sql, row.id) : null;
    if (nonce === undefined || !sameSecret(tokenHash(nonce), row.browser_nonce_hash)) return undefined;
    return {
        id: row.id,
        purpose: row.purpose,
        personId: row.person_id,
        sessionId: row.session_id,
        invitationId: row.invitation_id,
        returnPath: row.return_path,
        codeVerifier: row.code_verifier,
        melderHash,
    };
}

/** Liest `melder_hash` eines Umwegs und leert die Spalte in derselben Anweisung. */
async function nimmMelderHash(sql: Sql, id: string): Promise<Buffer | null> {
    const [zeile] = await sql<{ melder_hash: Buffer | null }[]>`
        UPDATE avesmaps_auth.oauth_flow f SET melder_hash = NULL
          FROM (SELECT id, melder_hash FROM avesmaps_auth.oauth_flow WHERE id = ${id}) alt
         WHERE f.id = alt.id
        RETURNING alt.melder_hash
    `;
    return zeile?.melder_hash ?? null;
}
