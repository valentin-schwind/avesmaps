import { randomInt } from "node:crypto";
import { recordEvent } from "./audit.ts";
import { AUTH_ENVIRONMENTS, type AuthEnvironment } from "./config.ts";
import { revokePersonIssued, type Sql } from "./session-store.ts";
import { sonderrollenLesbar } from "./sonderrollen.ts";
import { throttleKey } from "./throttle.ts";

/**
 * Ein Konto auflösen: das Recht auf Löschung (Art. 17 DSGVO) gegen die Geschichte der Verwaltung (WI-0120; Betreiber
 * 2026-10-09 zur Frage „Löschen gegen Geschichte“: „1 wie empfohlen“, `project-control/work-items/WI-0120-datenschutz-entwurf.md`).
 * Nur über die Kommandozeile (`auth aufloesen`), kein Knopf in der Verwaltung.
 *
 * Kein hartes Löschen der Person (AUTH-0001 §5, Ultra-Review R-04): Ihre Kennung bleibt, damit Protokoll, Einladungen und
 * Sonderrechte, die sie vergeben hat, weiter auf jemanden zeigen. Was die Geschichte nicht braucht, geht:
 *
 * - gelöscht: Passwortweg samt Benutzername (und seine Drossel), Discord-Verknüpfung samt Discord-Angaben, alle Sitzungen
 *   (vorher widerrufen, damit `NOTIFY` aus Migration 0081 Tür und WebSockets sofort räumt), ihre Discord-Umwege und
 *   Passkey-Zeremonien;
 * - geleert: jeder Passkey (Schlüssel, Kennung, Bezeichnung, Geräteangaben; widerrufen), die Notiz und die Discord-Bindung
 *   jeder Einladung an sie samt ihrer Vorgänger beim Neu-Ausstellen (eine noch offene wird zurückgezogen), die Zuordnung eines
 *   Legacy-Namens;
 * - entzogen: offene Links, Sonderrechte (ihre Begründungen geschwärzt), der Zugang in JEDER Umgebung dieser Datenbank;
 * - ersetzt: der Anzeigename durch „Ehemalige Person ⟨Kurzkennung⟩“ (zufällig, aus nichts ableitbar; der Betreiber 2026-10-09:
 *   „Ehemalige Person lassen“), Status `departed`; Sperrvermerk, letzte Anmeldung und „Verantwortlich für:“ (WI-0133) fallen weg.
 *
 * 🔴 Das Protokoll bleibt stehen (AUTH-0001 §5, T18): Verwaltungshandlungen nennen die Person danach mit dem Platzhalter. Freitext
 * mit Personenbezug darin wird geschwärzt (Betreiber 2026-10-09: „1 B“, echt löschen), und zwar nur über
 * `avesmaps_auth.redact_person_events()` (Migration 0083, `SECURITY DEFINER`): frühere Namen, Discord-Name, Passkey-Bezeichnungen,
 * Notiz der Einladung, Sperrgründe, Begründungen von Sonderrechten, Legacy-Name samt Begründung, dazu Gerätebezeichnung und
 * gekürzte IP ihrer eigenen Einträge. Was geschwärzt wird und was bewusst nicht, steht in der Migration. Die App-Rolle hängt am
 * Protokoll weiter nur an. Anmeldungen laufen mit ihren Fristen ab (`purge_expired()`, Migration 0082).
 *
 * Im Betreiber-Kanal (WI-0124, Migration 0106) über `avesmaps_kanal.redact_person_kanal()`: die Geräteangabe im Kontext ihrer Vorgänge;
 * Namen zeigt der Kanal nur über die Kennung, also danach den Platzhalter. Ihre Benachrichtigungen (WI-0136, Migration 0107) verschwinden
 * über `public.redact_person_benachrichtigung()`; als Absenderin steht danach der Platzhalter.
 *
 * Dasselbe für die Medien über `public.redact_person_media()` (Migration 0088, WI-0068 P2): ihre Begründungen im Fachprotokoll, an
 * Einzelentscheidungen, am Einzelbild-Notaus und am Widerruf einer Freigaberegel, der Hash ihrer Anfragen und die Dateinamen ihrer
 * Hochladungen. Dort ist der Gegenstand nie eine Person; ein Grund, den sie schrieb, beschreibt also nur sie selbst.
 *
 * Und für die Karte über `public.redact_person_map_operation()` (Migration 0273, WI-0265 B7, Fachvertrag F.3): der Grund ihrer Rücknahmen
 * (`restoreReason` im Fachprotokoll `map_audit_event`, `MAP_AUDIT_FREE_TEXT_KEYS`) und der Hash ihrer Anfragen (`map_operation.request_hash`). Der Inhalt
 * der Karte bleibt, ebenso die Gründe anderer Personen; die Historie bleibt lesbar und zurücknehmbar, der Reiter „Änderungen“ zeigt die Marke als Grund.
 *
 * 🪤 Alles hier geht mit den Rechten der App-Rolle (`db/auth-grants.psql`), weil das Werkzeug auf dem VPS mit der `.env` der
 * Umgebung läuft: Passkeys und Links darf sie nicht löschen, nur ändern; deshalb werden sie geleert und widerrufen, und die
 * Aufbewahrung entfernt die Links 30 Tage nach ihrem Ablauf. Fehlt Migration 0083 oder ihr Recht, scheitert die ganze Auflösung
 * (nichts geändert) statt still ohne Schwärzung.
 *
 * Wiederholbar: Eine schon aufgelöste Person wird nicht umbenannt; was noch übrig wäre, wird entfernt oder geschwärzt, und nur
 * dann steht ein zweiter Eintrag im Protokoll. So holt ein zweiter Aufruf auch die Schwärzung nach, wenn das Konto vor 0083
 * aufgelöst wurde.
 *
 * 🪤 Fehlt Migration 0088 oder 0273 (oder auf dem VPS das EXECUTE der App-Rolle, das sie aus den Default-Privilegien des Schemas `public`
 * bekommt), scheitert die Auflösung ebenso ganz, statt die Medien oder die Karte still auszulassen. Eine Person, die vor 0273 aufgelöst wurde, bekommt
 * die Schwärzung der Karte mit einem zweiten Aufruf nach (`auth aufloesen` ohne Bestätigung: sie trägt schon den Platzhalter).
 */
export const DEPARTED_NAME = "Ehemalige Person";

/** Die Marke für Geschwärztes; dieselbe Zeichenkette steht in Migration 0083 (`auth-redact-events.test.ts` hält beide gleich). */
export const REDACTED = "[geschwärzt]";

/**
 * Widerrufsgründe von Sonderrechten, die Codes sind und nichts über die Person sagen (`revokeGrants` aus `routes/admin-people.ts`,
 * `departed` von hier, die Marke selbst); jeder andere ist der Freitext aus der Verwaltung (`routes/admin-capabilities.ts`) und wird
 * geschwärzt.
 */
const CODED_REVOKE_REASONS = ["role_changed", "access_revoked", "departed", REDACTED];

/** Ohne 0/O und 1/I: Die Kurzkennung wird vorgelesen und abgetippt. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** Alle Umgebungen, deren Verwaltung die Auflösung abwartet: eine Sperre je Umgebung wie `adminOperation`, feste Reihenfolge. */
const ENVIRONMENTS: readonly AuthEnvironment[] = [...AUTH_ENVIRONMENTS].sort();

export type DissolveRefusal = "not_found" | "confirmation" | "last_operator";

/** 🪤 Ohne Parameter-Eigenschaft: `npm run auth` lädt die Quelle mit Node, und das entfernt Typen nur (strip-only). */
export class DissolveRefused extends Error {
    readonly code: DissolveRefusal;
    constructor(code: DissolveRefusal, message: string) {
        super(message);
        this.code = code;
    }
}

export interface DissolveCounts {
    /** Gelöschte Anmeldewege: `password`, `discord`. */
    methods: string[];
    sessions: number;
    passkeys: number;
    links: number;
    invitations: number;
    /** Von der Person ausgestellte, noch offene Einladungen und Zugangslinks, zurückgezogen (G2-01). */
    revokedIssuedInvitations: number;
    revokedIssuedLinks: number;
    legacyMappings: number;
    revokedCapabilities: string[];
    /** Sonderrechte, deren Begründung (oder freier Widerrufsgrund) geschwärzt wurde. */
    capabilityReasons: number;
    /** Sonderrollen, die mit dem Konto enden (WI-0279). */
    revokedSonderrollen: string[];
    /** Zuteilungen und Einladungszeilen von Sonderrollen, deren Grund geschwärzt wurde. */
    sonderrollenReasons: number;
    environments: string[];
    /** Protokolleinträge, in denen etwas geschwärzt oder geleert wurde (Migration 0083). */
    redactedEvents: number;
    /** Zeilen der Medientabellen, in denen etwas geschwärzt oder geleert wurde (Migration 0088). */
    redactedMedia: number;
    /** Zeilen des Kartenprotokolls, in denen etwas geschwärzt oder geleert wurde: Gründe von Rücknahmen, Hashes ihrer Operationen (Migration 0273). */
    redactedMap: number;
    /** „Verantwortlich für:“ geleert (WI-0133): 1, wenn ein Text dastand, sonst 0. */
    responsibility: number;
    /** Vorgänge des Betreiber-Kanals, deren Geräteangabe geleert wurde (Migration 0106). */
    redactedKanal: number;
    /** Benachrichtigungen an die Person, gelöscht (Migration 0107). */
    benachrichtigungen: number;
    /** Zeilen der Community (Zuständigkeit, Verfasser, Melderkonto, Notizen, Verlauf), die auf die Person zeigten (Migration 0265); 0 ohne das Schema. */
    redactedCommunity: number;
}

export interface DissolveResult {
    personId: string;
    /** Der Name VOR der Auflösung, nur für die Ausgabe am Terminal; er steht nie im Protokoll. */
    previousName: string;
    displayName: string;
    alreadyDeparted: boolean;
    /** Hat sich etwas geändert? Nur dann steht ein Eintrag im Protokoll. */
    changed: boolean;
    counts: DissolveCounts;
}

export interface DissolveInput {
    personId: string;
    /** Die Umgebung des Werkzeugs; dort steht der Protokolleintrag. */
    environment: AuthEnvironment;
    actorLabel: string;
    /** Der Anzeigename, den die Kommandozeile zur Bestätigung verlangt; fehlt er, prüft die Funktion ihn nicht (Trockenlauf). */
    expectName?: string | undefined;
}

const normalized = (name: string): string => name.normalize("NFC").trim();

function randomCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
}

/** Ein Platzhalter, den noch keine Person trägt. */
async function freePlaceholder(tx: Sql): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = `${DEPARTED_NAME} ${randomCode()}`;
        const [taken] = await tx`SELECT 1 FROM avesmaps_auth.person WHERE display_name = ${candidate}`;
        if (taken === undefined) return candidate;
    }
    throw new Error("Kein freier Platzhalter gefunden");
}

/** Löst ein Konto auf, in der übergebenen Transaktion. Wer sie zurückrollt, hat einen Trockenlauf. */
export async function dissolvePerson(tx: Sql, input: DissolveInput): Promise<DissolveResult> {
    const id = input.personId;
    // Erst die Sperren der Verwaltung (feste Reihenfolge), dann die Zeile: wie `adminOperation` mit `loadTarget`.
    for (const environment of ENVIRONMENTS) {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps_auth.admin:${environment}`}))`;
    }
    const [person] = await tx<{ display_name: string; status: "active" | "locked" | "departed" }[]>`
        SELECT display_name, status FROM avesmaps_auth.person WHERE id = ${id} FOR UPDATE
    `;
    if (person === undefined) throw new DissolveRefused("not_found", "Diese Person gibt es nicht.");
    const alreadyDeparted = person.status === "departed";
    if (!alreadyDeparted && input.expectName !== undefined) {
        if (normalized(input.expectName) !== normalized(person.display_name)) {
            throw new DissolveRefused(
                "confirmation",
                `Die Bestätigung passt nicht: Die Person heißt „${person.display_name}“.`,
            );
        }
    }

    // Nie der letzte aktive Betreiber einer Umgebung (AUTH-0001 §7.3, `keepAnOperator`).
    const alone = await tx<{ environment: string }[]>`
        SELECT a.environment FROM avesmaps_auth.person_access a
          JOIN avesmaps_auth.person p ON p.id = a.person_id AND p.status = 'active'
         WHERE a.person_id = ${id} AND a.role = 'operator' AND a.status = 'active'
           AND NOT EXISTS (
               SELECT 1 FROM avesmaps_auth.person_access o
                 JOIN avesmaps_auth.person q ON q.id = o.person_id AND q.status = 'active'
                WHERE o.environment = a.environment AND o.role = 'operator' AND o.status = 'active' AND o.person_id <> a.person_id
           )
         ORDER BY a.environment
    `;
    if (alone.length > 0) {
        throw new DissolveRefused(
            "last_operator",
            `Es muss immer mindestens einen aktiven Betreiber geben (${alone.map((row) => row.environment).join(", ")}).`,
        );
    }

    // Das Protokoll zuerst: Die Funktion findet die Einladungen an ihre Discord-ID über die Verknüpfung, die gleich gelöscht wird.
    const [redaction] = await tx<{ events: number }[]>`
        SELECT avesmaps_auth.redact_person_events(${id})::int AS events
    `;
    const [mediaRedaction] = await tx<{ rows: number }[]>`
        SELECT public.redact_person_media(${id})::int AS rows
    `;
    const [mapRedaction] = await tx<{ rows: number }[]>`
        SELECT public.redact_person_map_operation(${id})::int AS rows
    `;
    const [kanalRedaction] = await tx<{ rows: number }[]>`
        SELECT avesmaps_kanal.redact_person_kanal(${id})::int AS rows
    `;
    const [benachrichtigungen] = await tx<{ rows: number }[]>`
        SELECT public.redact_person_benachrichtigung(${id})::int AS rows
    `;
    // Die Community (WI-0268, Migration 0265) ist neu: Fehlt das Schema oder darf die Rolle die Funktion nicht rufen, entfällt der Schritt, statt
    // die Auflösung scheitern zu lassen. 🪤 Erst im Katalog fragen und DANN rufen: Ein Aufruf einer fehlenden Funktion bräche die Transaktion.
    const [communityDa] = await tx<{ ok: boolean }[]>`
        SELECT coalesce((
            SELECT has_schema_privilege(p.pronamespace, 'USAGE') AND has_function_privilege(p.oid, 'EXECUTE')
              FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('avesmaps_community.redact_person_community(uuid)')
        ), false) AS ok
    `;
    const communityRedaction =
        communityDa?.ok === true
            ? (
                  await tx<{ rows: number }[]>`
                      SELECT avesmaps_community.redact_person_community(${id}::uuid)::int AS rows
                  `
              )[0]
            : undefined;

    // Sitzungen: erst widerrufen (der Trigger meldet es, Tür und WebSockets räumen sofort), dann mit allem, was auf sie zeigt, weg.
    await tx`
        UPDATE avesmaps_auth.session SET revoked_at = now(), revoke_reason = 'departed'
         WHERE person_id = ${id} AND revoked_at IS NULL
    `;
    await tx`
        DELETE FROM avesmaps_auth.oauth_flow
         WHERE person_id = ${id} OR session_id IN (SELECT s.id FROM avesmaps_auth.session s WHERE s.person_id = ${id})
    `;
    await tx`
        DELETE FROM avesmaps_auth.webauthn_challenge
         WHERE person_id = ${id} OR session_id IN (SELECT s.id FROM avesmaps_auth.session s WHERE s.person_id = ${id})
    `;
    const sessions = await tx`DELETE FROM avesmaps_auth.session WHERE person_id = ${id}`;

    // Anmeldewege.
    const methods: string[] = [];
    const [password] = await tx<{ login_name: string }[]>`
        DELETE FROM avesmaps_auth.password_login WHERE person_id = ${id} RETURNING login_name
    `;
    if (password !== undefined) {
        methods.push("password");
        await tx`DELETE FROM avesmaps_auth.login_throttle WHERE key_hash = ${throttleKey("name", password.login_name)}`;
    }
    const [discord] = await tx<{ discord_user_id: string }[]>`
        DELETE FROM avesmaps_auth.discord_login WHERE person_id = ${id} RETURNING discord_user_id
    `;
    if (discord !== undefined) methods.push("discord");

    // Passkeys: Die App-Rolle darf sie nicht löschen; geleert und widerrufen bleibt nur, dass es einen gab.
    const passkeys = await tx`
        UPDATE avesmaps_auth.passkey_credential
           SET credential_id = 'aufgeloest:' || id::text, public_key = ''::bytea, label = NULL, transports = '{}',
               device_type = NULL, backed_up = false, sign_count = 0, last_used_at = NULL,
               revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, 'departed')
         WHERE person_id = ${id} AND credential_id NOT LIKE 'aufgeloest:%'
    `;

    // Offene Links verfallen; die Aufbewahrung löscht sie 30 Tage nach ihrem Ablauf.
    const links = await tx`
        UPDATE avesmaps_auth.access_link SET revoked_at = now()
         WHERE person_id = ${id} AND used_at IS NULL AND revoked_at IS NULL
    `;

    // Was die Person für andere ausgestellt hat und noch offen ist, gilt nicht mehr (G2-01).
    const issued = await revokePersonIssued(tx, id, null);

    // Einladungen: „Für wen?“ und die Discord-Bindung beschreiben die Person; eine noch offene an ihre Discord-ID wird zurückgezogen.
    // Neu ausgestellt trug der Vorgänger dieselbe Notiz (`replaced_by` zeigt auf den Nachfolger); dieselbe Menge wie in 0083.
    const discordId = discord?.discord_user_id ?? null;
    // Sonderrollen (WI-0279): Sie enden mit dem Konto, und ihr Grund sagt, warum gerade sie die Rolle bekam, wie bei den Sonderrechten. Die
    // Zeilen einer Einladung zuerst: Die Menge hängt an der Discord-Bindung, die gleich darunter geleert wird.
    const sonderrollenGelesen = await sonderrollenLesbar(tx);
    const sonderrollenEnde = sonderrollenGelesen
        ? await tx<{ sonderrolle: string }[]>`
              UPDATE avesmaps_auth.sonderrolle_zuteilung SET revoked_at = now(), revoke_reason = 'departed'
               WHERE person_id = ${id} AND revoked_at IS NULL
              RETURNING sonderrolle
          `
        : [];
    let sonderrollenReasons = 0;
    if (sonderrollenGelesen) {
        const einladung = await tx`
            WITH RECURSIVE own (id) AS (
                SELECT i.id FROM avesmaps_auth.invitation i
                 WHERE i.accepted_person_id = ${id}
                    OR (${discordId}::text IS NOT NULL AND i.bound_discord_user_id = ${discordId}::text)
                UNION
                SELECT earlier.id FROM avesmaps_auth.invitation earlier JOIN own o ON earlier.replaced_by = o.id
            )
            UPDATE avesmaps_auth.invitation_sonderrolle SET reason = ${REDACTED}
             WHERE invitation_id IN (SELECT o.id FROM own o) AND reason <> ${REDACTED}
        `;
        const zuteilung = await tx`
            UPDATE avesmaps_auth.sonderrolle_zuteilung
               SET reason = ${REDACTED},
                   revoke_reason = CASE WHEN revoke_reason IS NULL OR revoke_reason = ANY(${CODED_REVOKE_REASONS}::text[])
                                        THEN revoke_reason ELSE ${REDACTED} END
             WHERE person_id = ${id}
               AND (reason <> ${REDACTED}
                    OR (revoke_reason IS NOT NULL AND NOT revoke_reason = ANY(${CODED_REVOKE_REASONS}::text[])))
        `;
        sonderrollenReasons = einladung.count + zuteilung.count;
    }
    const invitations = await tx`
        WITH RECURSIVE own (id) AS (
            SELECT i.id FROM avesmaps_auth.invitation i
             WHERE i.accepted_person_id = ${id}
                OR (${discordId}::text IS NOT NULL AND i.bound_discord_user_id = ${discordId}::text)
            UNION
            SELECT earlier.id FROM avesmaps_auth.invitation earlier JOIN own o ON earlier.replaced_by = o.id
        )
        UPDATE avesmaps_auth.invitation
           SET note = NULL, bound_discord_user_id = NULL,
               revoked_at = CASE WHEN accepted_at IS NULL AND revoked_at IS NULL THEN now() ELSE revoked_at END
         WHERE id IN (SELECT o.id FROM own o)
           AND (note IS NOT NULL OR bound_discord_user_id IS NOT NULL OR (accepted_at IS NULL AND revoked_at IS NULL))
    `;

    // Ein Legacy-Name, der ihr zugeordnet war, steht wieder für sich („⟨Name⟩ (Legacy)“), ohne Begründung, die sie beschreibt.
    const legacyMappings = await tx`
        UPDATE avesmaps_auth.legacy_identity SET person_id = NULL, mapped_by = NULL, mapped_at = NULL, evidence = NULL
         WHERE person_id = ${id}
    `;

    const capabilities = await tx<{ capability: string }[]>`
        UPDATE avesmaps_auth.capability_grant SET revoked_at = now(), revoke_reason = 'departed'
         WHERE person_id = ${id} AND revoked_at IS NULL
        RETURNING capability
    `;
    // Die Begründung sagt, warum gerade sie ein Recht bekam; im Protokoll ist sie geschwärzt (0083), hier ebenso. `reason` ist
    // Pflicht, deshalb die Marke statt NULL; ein Code als Widerrufsgrund bleibt.
    const capabilityReasons = await tx`
        UPDATE avesmaps_auth.capability_grant
           SET reason = ${REDACTED},
               revoke_reason = CASE WHEN revoke_reason IS NULL OR revoke_reason = ANY(${CODED_REVOKE_REASONS}::text[])
                                    THEN revoke_reason ELSE ${REDACTED} END
         WHERE person_id = ${id}
           AND (reason <> ${REDACTED}
                OR (revoke_reason IS NOT NULL AND NOT revoke_reason = ANY(${CODED_REVOKE_REASONS}::text[])))
    `;
    const environments = await tx<{ environment: string }[]>`
        UPDATE avesmaps_auth.person_access SET status = 'revoked', revoked_at = now(), revoked_by = NULL
         WHERE person_id = ${id} AND status = 'active'
        RETURNING environment
    `;

    // „Verantwortlich für:“ beschreibt die Person (WI-0133); es geht mit dem Konto, auch bei einem zweiten Aufruf. Das Protokoll trägt
    // den Text nie (`person.responsibility_changed` nur mit `via` und `cleared`), dort ist nichts zu schwärzen.
    const responsibility = await tx`
        UPDATE avesmaps_auth.person SET responsible_for = NULL WHERE id = ${id} AND responsible_for IS NOT NULL
    `;

    // Die Bezeichnung (WI-0279 E10) geht ebenso; das Protokoll nennt die Form nie.
    await tx`UPDATE avesmaps_auth.person SET bezeichnung = NULL WHERE id = ${id} AND bezeichnung IS NOT NULL`;

    let displayName = person.display_name;
    if (!alreadyDeparted) {
        displayName = await freePlaceholder(tx);
        await tx`
            UPDATE avesmaps_auth.person
               SET display_name = ${displayName}, status = 'departed', locked_at = NULL, locked_by = NULL, lock_reason = NULL,
                   last_login_at = NULL
             WHERE id = ${id}
        `;
    }

    const counts: DissolveCounts = {
        methods,
        sessions: sessions.count,
        passkeys: passkeys.count,
        links: links.count,
        invitations: invitations.count,
        revokedIssuedInvitations: issued.revokedInvitations,
        revokedIssuedLinks: issued.revokedLinks,
        legacyMappings: legacyMappings.count,
        revokedCapabilities: [...new Set(capabilities.map((row) => row.capability))].sort(),
        capabilityReasons: capabilityReasons.count,
        revokedSonderrollen: [...new Set(sonderrollenEnde.map((row) => row.sonderrolle))].sort(),
        sonderrollenReasons,
        environments: environments.map((row) => row.environment).sort(),
        redactedEvents: redaction!.events,
        redactedMedia: mediaRedaction!.rows,
        redactedMap: mapRedaction!.rows,
        responsibility: responsibility.count,
        redactedKanal: kanalRedaction!.rows,
        benachrichtigungen: benachrichtigungen!.rows,
        redactedCommunity: communityRedaction?.rows ?? 0,
    };
    const changed =
        !alreadyDeparted ||
        methods.length > 0 ||
        counts.sessions +
            counts.passkeys +
            counts.links +
            counts.invitations +
            counts.legacyMappings +
            counts.revokedIssuedInvitations +
            counts.revokedIssuedLinks >
            0 ||
        counts.revokedCapabilities.length + counts.revokedSonderrollen.length + counts.environments.length > 0 ||
        counts.capabilityReasons +
            counts.sonderrollenReasons +
            counts.redactedEvents +
            counts.redactedMedia +
            counts.redactedMap +
            counts.responsibility +
            counts.redactedKanal +
            counts.benachrichtigungen +
            counts.redactedCommunity >
            0;
    if (changed) {
        // Ohne den alten Namen: Das Protokoll nennt die Person über ihre Kennung, und die heißt ab jetzt wie der Platzhalter.
        await recordEvent(tx, {
            environment: input.environment,
            action: "person.departed",
            actorKind: "cli",
            actorLabel: input.actorLabel,
            targetPersonId: id,
            details: { ...counts },
        });
    }
    return { personId: id, previousName: person.display_name, displayName, alreadyDeparted, changed, counts };
}
