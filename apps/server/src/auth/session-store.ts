import { isRole, type Role } from "@avesmaps3d/shared";
import type postgres from "postgres";
import type { Database } from "../database.ts";
import type { AuthConfig, AuthEnvironment } from "./config.ts";
import { randomToken, tokenHash } from "./tokens.ts";

/** Ein Postgres-Client oder eine laufende Transaktion. */
export type Sql = Database | postgres.TransactionSql;

/**
 * Sitzungen in PostgreSQL (WI-0120 A3, AUTH-0001 §6.1). Im Cookie steht nur ein Zufallswert, in der Datenbank sein Hash. Bei
 * jeder Anfrage, die ein Recht braucht, liest EINE Abfrage Sitzung, Person, Zugang und Sonderrechte: Sperren, Herabstufen,
 * Entzug und Abmelden wirken mit der nächsten Anfrage, ohne Cache.
 */

export type SessionMethod = "discord" | "password" | "passkey" | "recovery";
export type SessionAssurance = "basic" | "strong" | "recovery";

export interface SessionRecord {
    readonly id: string;
    readonly personId: string;
    readonly displayName: string;
    readonly role: Role;
    readonly grants: readonly string[];
    /** Die Sonderrollen dieser Umgebung (WI-0279); was sie dürfen, sagt `rechteVon`. */
    readonly sonderrollen: readonly string[];
    readonly environment: AuthEnvironment;
    readonly method: SessionMethod;
    readonly assurance: SessionAssurance;
    readonly createdAt: Date;
    /** Die letzte Anfrage VOR dieser (für die Leerlaufgrenze, höchstens einmal je Minute geschrieben). */
    readonly lastSeenAt: Date;
    readonly confirmedAt: Date;
    readonly passkeyConfirmedAt: Date | null;
    readonly expiresAt: Date;
    readonly idleExpiresAt: Date;
    readonly rotateRequired: boolean;
}

export interface NewSession {
    personId: string;
    environment: AuthEnvironment;
    method: SessionMethod;
    assurance: SessionAssurance;
    passkeyConfirmed?: boolean;
    ipPrefix?: string | undefined;
    clientLabel?: string | undefined;
    rotatedFrom?: string;
}

interface SessionRow {
    id: string;
    person_id: string;
    display_name: string;
    role: string;
    grants: string[];
    sonderrollen_lesbar: boolean | null;
    environment: AuthEnvironment;
    method: SessionMethod;
    assurance: SessionAssurance;
    created_at: Date;
    last_seen_at: Date;
    confirmed_at: Date;
    passkey_confirmed_at: Date | null;
    expires_at: Date;
    idle_expires_at: Date;
    rotate_required: boolean;
}

const MINUTE_MS = 60_000;
/** `last_seen_at` höchstens so oft schreiben. */
const TOUCH_INTERVAL_MS = MINUTE_MS;

/**
 * 🔴 **Eine gewöhnliche Sitzung endet nie von selbst** (Betreiber 2026-10-10, auf „Meintest du auch die Sitzung?“: „ja“; davor
 * „entweder ich bin angemeldet oder nicht“). Sie endet nur durch Abmelden, „Sitzungen beenden“ (Konto, Verwaltung,
 * Kommandozeile), Sperren, Entzug des Zugangs, Auflösen des Kontos und die Widerrufe, die Sitzungen schon beenden (Passwort
 * zurückgesetzt, Passkeys widerrufen). Leerlauf (früher 7 Tage) und absolute Laufzeit (früher 30 Tage) entfallen; der Notzugang
 * bleibt bei 60 Minuten, nicht verlängerbar.
 *
 * Warum ein fernes Datum statt `NULL` oder `infinity`: `expires_at` und `idle_expires_at` sind `NOT NULL`, und ein Release
 * davor liest sie (Zwei-Release-Regel; die Spalten bleiben). `infinity` käme in JavaScript als ungültiges Datum an
 * (`toISOString()` wirft). Mit diesem Datum bleiben jede Abfrage (`expires_at > now()`), die Tür, der Kanal `/ws` und
 * `purge_expired()` (löscht nur Beendetes) unverändert richtig.
 */
export const SESSION_UNBOUNDED = new Date("9999-12-31T00:00:00.000Z");

/**
 * Die Stufe, die eine Sitzung wirklich trägt. 🔴 **Der zweite Faktor ist allein der Passkey** (Betreiber 2026-10-10, auf die Frage,
 * ob Discord-2FA weiter als zweiter Faktor gilt: „4. B“, also „Für die Verwaltung immer den Passkey verlangen; Discord-Nutzer mit
 * Verwaltungsrechten bestätigen einmal je Sitzung“). `strong` entsteht seitdem nur zusammen mit einem Passkey-Nachweis
 * (`passkey_confirmed_at`, `auth-passkey.ts` `confirmSession`); eine Rotation nimmt beides mit.
 *
 * Eine Sitzung, die vor dem Entscheid über Discord-2FA auf `strong` kam, trägt keinen Passkey-Nachweis und gilt deshalb ab ihrem
 * nächsten Aufruf als `basic`: ohne Migration, ohne Schreiben, auch für Zeilen, die ein älteres Release während eines Wechsels
 * noch so anlegt. Die Spalte `assurance` bleibt (Zwei-Release-Regel); gelesen wird sie nur über diese Regel.
 */
export function effectiveAssurance(stored: SessionAssurance, passkeyConfirmedAt: Date | null): SessionAssurance {
    return stored === "strong" && passkeyConfirmedAt === null ? "basic" : stored;
}

function lifetime(config: AuthConfig, assurance: SessionAssurance, now: Date): Date {
    return assurance === "recovery"
        ? new Date(now.getTime() + config.session.recoveryMinutes * MINUTE_MS)
        : SESSION_UNBOUNDED;
}

/** Eine eben ausgestellte Sitzung: das Token fürs Cookie (nur dieses eine Mal im Klartext) und ihr Ende (`Max-Age`). */
export interface IssuedSession {
    readonly id: string;
    readonly token: string;
    readonly expiresAt: Date;
}

/** Legt eine Sitzung an und gibt das Token für das Cookie zurück. */
export async function createSession(
    sql: Sql,
    config: AuthConfig,
    input: NewSession,
    now: Date = new Date(),
): Promise<IssuedSession> {
    const token = randomToken();
    const expires = lifetime(config, input.assurance, now);
    const idle = expires;
    const [row] = await sql<{ id: string }[]>`
        INSERT INTO avesmaps_auth.session
            (token_hash, person_id, environment, method, assurance, created_at, last_seen_at, idle_expires_at, expires_at,
             confirmed_at, passkey_confirmed_at, ip_prefix, client_label, rotated_from)
        VALUES (${tokenHash(token)}, ${input.personId}, ${input.environment}, ${input.method}, ${input.assurance}, ${now}, ${now},
                ${idle}, ${expires}, ${now}, ${input.passkeyConfirmed === true ? now : null}, ${input.ipPrefix ?? null},
                ${input.clientLabel ?? null}, ${input.rotatedFrom ?? null})
        RETURNING id
    `;
    return { id: row!.id, token, expiresAt: expires };
}

/**
 * Die lebende Sitzung zu einem Token, mit Person, Rolle und Sonderrechten dieser Umgebung. Keine Sitzung, wenn sie
 * abgelaufen, widerrufen oder die Person gesperrt ist oder hier keinen aktiven Zugang mehr hat.
 */
export async function loadSession(
    sql: Sql,
    token: string,
    environment: AuthEnvironment,
): Promise<SessionRecord | undefined> {
    const rows = await sql<SessionRow[]>`
        SELECT s.id, s.person_id, p.display_name, a.role, s.environment, s.method, s.assurance, s.created_at, s.last_seen_at,
               s.confirmed_at, s.passkey_confirmed_at, s.expires_at, s.idle_expires_at, s.rotate_required,
               coalesce(array_agg(g.capability ORDER BY g.capability) FILTER (WHERE g.capability IS NOT NULL), '{}') AS grants,
               has_table_privilege(current_user, to_regclass('avesmaps_auth.sonderrolle_zuteilung')::oid, 'SELECT') AS sonderrollen_lesbar
          FROM avesmaps_auth.session s
          JOIN avesmaps_auth.person p ON p.id = s.person_id AND p.status = 'active'
          JOIN avesmaps_auth.person_access a
            ON a.person_id = s.person_id AND a.environment = s.environment AND a.status = 'active'
          LEFT JOIN avesmaps_auth.capability_grant g
            ON g.person_id = s.person_id AND g.environment = s.environment AND g.revoked_at IS NULL
         WHERE s.token_hash = ${tokenHash(token)} AND s.environment = ${environment}
           AND s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now()
         GROUP BY s.id, p.id, a.person_id, a.environment
    `;
    const row = rows[0];
    if (row === undefined || !isRole(row.role)) return undefined;
    // 🪤 Eine eigene Abfrage hinter der Prüfung (WI-0279): Die Rechte an der Tafel spielt Claudio ein, oft nach der Migration. Eine Abfrage, die
    // die Tafel nennt, schlüge bis dahin fehl und nähme jeder Anfrage die Anmeldung. Sind die Rechte überall da, gehört sie in die obere.
    const sonderrollen =
        row.sonderrollen_lesbar === true
            ? await sql<{ sonderrolle: string }[]>`
                  SELECT DISTINCT sonderrolle FROM avesmaps_auth.sonderrolle_zuteilung
                   WHERE person_id = ${row.person_id} AND environment = ${row.environment} AND revoked_at IS NULL
                   ORDER BY sonderrolle
              `
            : [];
    return {
        id: row.id,
        personId: row.person_id,
        displayName: row.display_name,
        role: row.role,
        grants: row.grants,
        sonderrollen: sonderrollen.map((zeile) => zeile.sonderrolle),
        environment: row.environment,
        method: row.method,
        assurance: effectiveAssurance(row.assurance, row.passkey_confirmed_at),
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        confirmedAt: row.confirmed_at,
        passkeyConfirmedAt: row.passkey_confirmed_at,
        expiresAt: row.expires_at,
        idleExpiresAt: row.idle_expires_at,
        rotateRequired: row.rotate_required,
    };
}

/**
 * Merkt die letzte Anfrage, höchstens einmal je Minute. Eine gewöhnliche Sitzung, die noch ein Ende aus der Zeit vor dem
 * 2026-10-10 trägt (7 / 30 Tage), verliert es dabei (`SESSION_UNBOUNDED`); ein Notzugang behält seine 60 Minuten.
 */
export async function touchSession(sql: Sql, session: SessionRecord, now: Date = new Date()): Promise<void> {
    if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
    const end = session.assurance === "recovery" ? session.expiresAt : SESSION_UNBOUNDED;
    await sql`
        UPDATE avesmaps_auth.session SET last_seen_at = ${now}, idle_expires_at = ${end}, expires_at = ${end}
         WHERE id = ${session.id} AND revoked_at IS NULL
    `;
}

/**
 * Ersetzt eine Sitzung durch eine neue mit neuem Token (Kap. 10.50: nach Rechteänderung und Bestätigung). Die alte erlischt;
 * Anmeldeweg, Stufe und Bestätigungen gehen mit. Eine gewöhnliche Sitzung ist danach unbefristet (`SESSION_UNBOUNDED`, auch eine
 * aus der Zeit vor dem 2026-10-10), ein Notzugang behält sein Ende.
 */
export async function rotateSession(
    sql: Sql,
    session: Pick<SessionRecord, "id">,
    reason: string,
): Promise<IssuedSession> {
    const token = randomToken();
    const [row] = await sql<{ id: string; expires_at: Date }[]>`
        WITH old AS (
            UPDATE avesmaps_auth.session SET revoked_at = now(), revoke_reason = ${reason}
             WHERE id = ${session.id} AND revoked_at IS NULL
            RETURNING *
        )
        INSERT INTO avesmaps_auth.session
            (token_hash, person_id, environment, method, assurance, created_at, last_seen_at, idle_expires_at, expires_at,
             confirmed_at, passkey_confirmed_at, ip_prefix, client_label, rotated_from)
        SELECT ${tokenHash(token)}, person_id, environment, method, assurance, created_at, now(),
               CASE WHEN assurance = 'recovery' THEN idle_expires_at ELSE ${SESSION_UNBOUNDED} END,
               CASE WHEN assurance = 'recovery' THEN expires_at ELSE ${SESSION_UNBOUNDED} END,
               confirmed_at, passkey_confirmed_at, ip_prefix, client_label, id
          FROM old
        RETURNING id, expires_at
    `;
    if (row === undefined) throw new Error("Sitzung war schon widerrufen");
    return { id: row.id, token, expiresAt: row.expires_at };
}

/** Beendet eine Sitzung. */
export async function revokeSession(sql: Sql, sessionId: string, by: string | null, reason: string): Promise<boolean> {
    const rows = await sql`
        UPDATE avesmaps_auth.session SET revoked_at = now(), revoked_by = ${by}, revoke_reason = ${reason}
         WHERE id = ${sessionId} AND revoked_at IS NULL
    `;
    return rows.count > 0;
}

/** Beendet alle Sitzungen einer Person (Sperre, Passwort zurückgesetzt), wahlweise bis auf eine. */
export async function revokePersonSessions(
    sql: Sql,
    personId: string,
    by: string | null,
    reason: string,
    except?: string,
): Promise<string[]> {
    const rows = await sql<{ id: string }[]>`
        UPDATE avesmaps_auth.session SET revoked_at = now(), revoked_by = ${by}, revoke_reason = ${reason}
         WHERE person_id = ${personId} AND revoked_at IS NULL AND (${except ?? null}::uuid IS NULL OR id <> ${except ?? null}::uuid)
        RETURNING id
    `;
    return rows.map((row) => row.id);
}

/**
 * Zieht zurück, was eine Person für andere ausgestellt hat und noch offen ist: Einladungen und Zugangslinks mit `created_by` =
 * Person (G2-01). Ohne `environment` (Sperre) alle Einladungen; mit `environment` (Zugangsentzug, Herabstufung) nur die dieser
 * Umgebung, und die Links nur, wenn der Person danach in keiner Umgebung ein Zugang bleibt (`access_link` kennt keine Umgebung), oder
 * mit `linkUmfang = "alle"` immer (Herabstufung: der Zugang bleibt, das Recht zum Ausstellen nicht). Läuft in der
 * Transaktion des Aufrufers; die Auflösung eines Kontos kann es mit einer Zeile aufrufen.
 */
export async function revokePersonIssued(
    sql: Sql,
    personId: string,
    by: string | null,
    environment?: string,
    linkUmfang: "ohne-zugang" | "alle" = "ohne-zugang",
): Promise<{ revokedInvitations: number; revokedLinks: number }> {
    const invitations = await sql`
        UPDATE avesmaps_auth.invitation SET revoked_at = now(), revoked_by = ${by}
         WHERE created_by = ${personId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
           AND (${environment ?? null}::text IS NULL OR environment = ${environment ?? null})
    `;
    const links = await sql`
        UPDATE avesmaps_auth.access_link SET revoked_at = now()
         WHERE created_by = ${personId} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
           AND (
               ${environment ?? null}::text IS NULL
               OR ${linkUmfang === "alle"}::boolean
               OR NOT EXISTS (
                   SELECT 1 FROM avesmaps_auth.person_access a WHERE a.person_id = ${personId} AND a.status = 'active'
               )
           )
    `;
    return { revokedInvitations: invitations.count, revokedLinks: links.count };
}

/** Verlangt beim nächsten Besuch ein neues Token (Rechteänderung einer anderen Person, Kap. 10.50). */
export async function requireRotation(sql: Sql, personId: string): Promise<void> {
    await sql`UPDATE avesmaps_auth.session SET rotate_required = true WHERE person_id = ${personId} AND revoked_at IS NULL`;
}
