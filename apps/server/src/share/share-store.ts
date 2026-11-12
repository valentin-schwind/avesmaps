import { createHash, randomInt } from "node:crypto";
import { SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH, type SharePayload } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";

/**
 * Der Speicher der Kurzlinks (WI-0034, Migration 0041). Er schreibt nur neue Zeilen; eine Zeile
 * ändert sich danach nie, außer dem Tag ihres letzten Aufrufs.
 */

/** Ein neuer Code, gleichverteilt aus Legacys Alphabet. */
export function newShareCode(): string {
    let code = "";
    for (let index = 0; index < SHARE_CODE_LENGTH; index++) {
        code += SHARE_CODE_ALPHABET.charAt(randomInt(SHARE_CODE_ALPHABET.length));
    }
    return code;
}

/** SHA-256 der kanonischen Schreibweise (`canonicalSharePayload`): derselbe Zustand, dieselbe Summe. */
export function sharePayloadHash(canonical: SharePayload): string {
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface StoredShare {
    code: string;
    payload: SharePayload;
}

export interface ShareStore {
    /** Der Code, der diesen Zustand schon trägt. */
    codeFor(payloadHash: string): Promise<string | undefined>;
    /** `false`, wenn Code oder Zustand schon vergeben sind; dann entscheidet der Aufrufer. */
    insert(code: string, payload: SharePayload, payloadHash: string): Promise<boolean>;
    /** Neue Codes seit so vielen Stunden, für das Tagesbudget. */
    createdWithin(hours: number): Promise<number>;
    /** Der Zustand hinter einem Code, ohne Rücksicht auf die Schreibweise; merkt sich den Tag des Aufrufs. */
    read(code: string): Promise<StoredShare | undefined>;
}

export function databaseShareStore(database: Database): ShareStore {
    return {
        async codeFor(payloadHash) {
            const [row] = await database<{ code: string }[]>`
                SELECT code FROM share_link WHERE payload_hash = ${payloadHash}
            `;
            return row?.code;
        },
        async insert(code, payload, payloadHash) {
            const rows = await database`
                INSERT INTO share_link (code, payload, payload_hash)
                VALUES (${code}, ${database.json(payload)}, ${payloadHash})
                ON CONFLICT DO NOTHING
                RETURNING code
            `;
            return rows.length === 1;
        },
        async createdWithin(hours) {
            const [row] = await database<{ count: number }[]>`
                SELECT count(*)::int AS count FROM share_link
                WHERE created_at > now() - make_interval(hours => ${hours})
            `;
            return row?.count ?? 0;
        },
        async read(code) {
            // 🪤 Der Tag des Aufrufs wird höchstens einmal täglich geschrieben: Ein beliebter Link soll
            // nicht bei jedem Öffnen eine Zeile sperren.
            const [row] = await database<StoredShare[]>`
                WITH hit AS (
                    SELECT code, payload, last_used_at FROM share_link WHERE lower(code) = lower(${code})
                ), touched AS (
                    UPDATE share_link SET last_used_at = current_date
                    WHERE code IN (SELECT code FROM hit WHERE last_used_at IS DISTINCT FROM current_date)
                )
                SELECT code, payload FROM hit
            `;
            return row;
        },
    };
}
