import { createHash } from "node:crypto";
import type { Sql } from "./session-store.ts";

/**
 * Drossel für Anmeldeversuche (WI-0120 A4, AUTH-0001 §6.4; Kap. 10.64, 10.65; OWASP Authentication):
 * je EINGEGEBENEM Benutzernamen in der Datenbank, auch für Namen, die es nicht gibt (sonst verriete das Drosseln, welche
 * Konten existieren). Die ersten fünf Fehlversuche sind frei, danach wartet der Name 2^(n−5) Sekunden, höchstens 15 Minuten.
 * Ein Erfolg setzt zurück. Keine dauerhafte Sperre. Der Schlüssel ist ein Hash; kein Name steht im Klartext in der Tabelle.
 *
 * Die Drossel je IP läuft im Speicher (`rate-limiter.ts`), ohne IP in der Datenbank; davor steht `limit_req` im vhost.
 */
export const FREE_FAILURES = 5;
export const MAX_WAIT_SECONDS = 15 * 60;

export function throttleKey(kind: "name", value: string): Buffer {
    return createHash("sha256").update(`${kind}:${value}`, "utf8").digest();
}

export function waitSeconds(failures: number): number {
    if (failures < FREE_FAILURES) return 0;
    return Math.min(MAX_WAIT_SECONDS, 2 ** (failures - FREE_FAILURES));
}

/** Wie lange der Name noch warten muss (Sekunden, 0 = sofort). */
export async function throttleRemaining(sql: Sql, key: Buffer, now: Date = new Date()): Promise<number> {
    const [row] = await sql<{ blocked_until: Date | null }[]>`
        SELECT blocked_until FROM avesmaps_auth.login_throttle WHERE key_hash = ${key}
    `;
    const until = row?.blocked_until;
    if (until === null || until === undefined) return 0;
    return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

export async function recordFailure(sql: Sql, key: Buffer, now: Date = new Date()): Promise<number> {
    const [row] = await sql<{ failures: number }[]>`
        INSERT INTO avesmaps_auth.login_throttle (key_hash, kind, failures, updated_at)
        VALUES (${key}, 'name', 1, ${now})
        ON CONFLICT (key_hash) DO UPDATE SET failures = avesmaps_auth.login_throttle.failures + 1, updated_at = ${now}
        RETURNING failures
    `;
    const failures = row!.failures;
    const wait = waitSeconds(failures);
    if (wait > 0) {
        await sql`
            UPDATE avesmaps_auth.login_throttle SET blocked_until = ${new Date(now.getTime() + wait * 1000)} WHERE key_hash = ${key}
        `;
    }
    return failures;
}

export async function clearFailures(sql: Sql, key: Buffer): Promise<void> {
    await sql`DELETE FROM avesmaps_auth.login_throttle WHERE key_hash = ${key}`;
}
