import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_DETAIL_KEYS, recordEvent, type AuditEvent } from "../src/auth/audit.ts";
import { REDACTED } from "../src/auth/dissolve.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { authFixture } from "./support/auth-fixture.ts";

/**
 * Schwärzen beim Auflösen (WI-0120 A15, Bauschritt B; Betreiber 2026-10-09: „1 B“): `avesmaps_auth.redact_person_events(uuid)`,
 * Migration 0083.
 *
 * Problemfälle: Freitext zur Person in jeder Art von Eintrag, an dem sie Gegenstand ist (Name, Discord-Name, Passkey, Sperrgrund,
 * Begründung eines Sonderrechts, Legacy-Zuordnung samt Kennung, Notiz ihrer Einladung und des Vorgängers beim Neu-Ausstellen,
 * Einladung an ihre Discord-ID); ihr Gerät und ihre IP, wo sie handelt; Freitext, den sie über eine ANDERE schrieb; Gerät einer
 * anderen Person, die an ihr handelte; eine zweite Person, die nichts damit zu tun hat; ein zweiter Aufruf. Soll: geschwärzt mit
 * Marke, Struktur unverändert, nur diese Person, wiederholbar ohne Wirkung.
 *
 * Die Rechte (die App-Rolle darf nur die Funktion und am Protokoll selbst weiter nur anhängen, die Jobs-Rolle darf sie nicht rufen)
 * prüft `auth-responsibility.test.ts` auf dem Wegwerf-Cluster mit den Rollen des VPS (bis WI-0189 hier per `SET ROLE` in Handrollen).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ROLLBACK = "__zurueck__";
const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Die jüngste Fassung der Funktion: Wer die Tafel ändert, tut es in einer neuen Migration mit `CREATE OR REPLACE`. */
function latestDefinition(): { file: string; text: string } {
    const files = readdirSync(MIGRATIONS)
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .filter((name) =>
            /FUNCTION avesmaps_auth\.redact_person_events/u.test(readFileSync(MIGRATIONS + name, "utf8")),
        );
    const file = files.at(-1);
    if (file === undefined) throw new Error("Keine Migration definiert avesmaps_auth.redact_person_events");
    return { file, text: readFileSync(MIGRATIONS + file, "utf8") };
}

/** Eine Tafel `<name> (action, key)` der Funktion. */
function tableKeys(name: "personal" | "authored"): string[] {
    const { text } = latestDefinition();
    const table = new RegExp(`${name} \\(action, key\\) AS \\(\\s*VALUES([\\s\\S]*?)\\n\\s*\\),`, "u").exec(text)?.[1];
    if (table === undefined) throw new Error(`Tafel \`${name}\` nicht gefunden`);
    return [...table.matchAll(/\('([a-z_.]+)', '([A-Za-z]+)'\)/gu)].map((match) => `${match[1]!}.${match[2]!}`).sort();
}

/** Freitext zur Person, deren GEGENSTAND sie ist. */
const personalKeys = (): string[] => tableKeys("personal");

/** Freitext, den die HANDELNDE Person über das System schreibt (seit 0087, WI-0127 SYS-2): geschwärzt, wenn sie aufgelöst wird. */
const authoredKeys = (): string[] => tableKeys("authored");

/**
 * Was in `details` KEINEN Personenbezug trägt: Codes, Zahlen, Rollen, Rechte, Hinweise auf Token. Jeder Schlüssel der
 * Positivliste steht entweder hier oder in der Tafel der Funktion; ein neuer Schlüssel in `AUDIT_DETAIL_KEYS` lässt den Test
 * fallen, bis jemand ihn eingeordnet hat.
 */
const WITHOUT_PERSONAL_REFERENCE: Record<string, readonly string[]> = {
    "login.success": ["method", "assurance"],
    "login.failure": ["method", "reason"],
    "login.throttled": ["method"],
    "session.revoked": ["sessionId", "reason", "count"],
    "session.rotated": ["reason"],
    "confirm.success": ["method"],
    "invitation.created": ["role", "validDays", "bound", "tokenHint", "sonderrollen"],
    "invitation.revoked": ["tokenHint"],
    "invitation.reissued": ["tokenHint", "previousHint"],
    "invitation.accepted": ["role", "method", "tokenHint"],
    // Hier sind `from` und `to` Rollen, keine Namen (anders als bei `person.renamed`).
    "person.role_changed": ["from", "to", "revokedCapabilities", "restored", "revokedInvitations", "revokedLinks"],
    "person.locked": ["sessions", "revokedInvitations", "revokedLinks"],
    // „Verantwortlich für:“ (WI-0133): nur wer (selbst oder Betreiber) und ob geleert; der Text steht nie im Protokoll.
    "person.responsibility_changed": ["via", "cleared"],
    // Die Bezeichnung (WI-0279 E10): dass, nicht welche.
    "person.bezeichnung_geaendert": [],
    "person.departed": AUDIT_DETAIL_KEYS["person.departed"],
    "access.revoked": ["role", "sessions", "revokedCapabilities", "revokedInvitations", "revokedLinks"],
    "capability.granted": ["capability"],
    "capability.revoked": ["capability"],
    // Sonderrollen (WI-0279): Rolle und Regionen aus Katalog und Karte; der Grund steht in der Tafel `personal`.
    "sonderrolle.vergeben": ["sonderrolle", "regionen"],
    "sonderrolle.entzogen": ["sonderrolle", "regionen"],
    "sonderrolle.eingeladen": ["sonderrollen", "uebersprungen"],
    "sonderrolle.abgeglichen": ["neu", "entzogen", "ohneKonto", "ruht"],
    "password.set": ["via"],
    "password.disabled": ["failures"],
    "access_link.created": ["kind", "validHours"],
    "access_link.used": ["kind"],
    "passkey.registered": ["via", "backedUp"],
    "passkey.revoked": ["reason", "count", "sessions"],
    // Der Dateiname einer Sicherung, nicht einer Person.
    "backup.downloaded": ["name"],
    "recovery.started": ["via"],
    // Stellung und Sperre sind Codes; der Grund steht in der Tafel `authored`. Dasselbe für die Pause der Warteschlange
    // (WI-0160): `from`/`to` sind `true`/`false`.
    "system.mode_changed": ["from", "to"],
    "system.lock_changed": ["lock", "from", "to"],
    "system.queue_changed": ["from", "to"],
    // Karten herunterladen (WI-0280): Zugang anlegen, Abruf, SVG. `kennung` ist ein kurzes Stück des Schlüssels bzw. eine Zufallskennung
    // des Links (wie `tokenHint`), nie das Geheimnis und kein Name; `fuer_wen` (Freitext zur Person) wird nicht protokolliert.
    "system.karten_zugang": ["aktion", "art", "kennung", "tage", "karten"],
    "system.karten_abruf": ["weg", "kennung", "karten", "bytes"],
    "system.karten_svg": ["aktion", "art"],
    // Quelle und Jobkennung eines Abgleichs (WI-0127 SYS-14).
    "system.sync_requested": ["source", "job"],
    // Höhenmodell (WI-0127 SYS-13): Fassungen, Kennungen und Reglernamen; der Grund steht in der Tafel `authored`.
    "system.terrain_activated": ["from", "to", "rueckweg", "job"],
    "system.terrain_accepted": ["version"],
    "system.terrain_draft_created": ["draft", "base", "regler"],
    "system.terrain_measure_requested": ["draft", "job"],
    "system.terrain_draft_discarded": ["draft"],
    // „Gelände neu rechnen“ (Betreiber 2026-10-17): eine Fassungsnummer und eine Auftragsnummer, kein Personenbezug, kein Grund.
    "system.terrain_recomputed": ["version", "job"],
    // Testwerte von „19 (Test)“ (WI-0240): Fassung, Revision und Auftragsnummer; der Grund steht in der Tafel `authored` (0210).
    "system.terrain_test_changed": ["version", "revision", "job"],
    // Inhaltsschalter (WI-0127 SYS-10): ein Schlüssel aus dem Katalog, `from`/`to` sind an oder aus.
    "system.content_switch_changed": ["key", "from", "to"],
    // Wegfindung (WI-0153): eine Kennung aus dem Register, `from`/`to` sind Zahlen („null“ heißt „die Vorgabe“).
    "system.routing_setting_changed": ["key", "from", "to"],
    // Die Freigabe (WI-0153): eine Anzahl und eine Auftragsnummer, kein Personenbezug.
    "system.routing_settings_applied": ["werte", "job", "seegraph"],
    // Betreiber-Kanal (WI-0124): nur die OPS-Nummer, kein Inhalt.
    "system.kanal_purged": ["ops"],
    "system.kanal_image_removed": ["ops"],
    // Ein Vorgang aus Discord freigegeben (WI-0255 Paket 2): OPS-Nummer und `claudio`/`claudia`/`regel`, nie Text oder Melder; an die Community
    // weitergeleitet (WI-0297) `community` und die COM-Nummer der Redaktion.
    "system.kanal_gesichtet": ["ops", "an", "com"],
    // Community (WI-0268): COM-Nummer, Ergebnis aus dem Katalog und Zählwerte der Aufbewahrung; nie Text, Name oder Kontakt.
    "system.community_abgeschlossen": ["com", "ergebnis"],
    "system.community_wiedereroeffnet": ["com"],
    "system.community_papierkorb": ["com"],
    "system.community_personenbezug_geloescht": ["com"],
    // Mails (WI-0268 C4): COM-Nummer, Ergebnis aus dem Katalog, Nummer der neuen Meldung; nie Adresse, Name oder Text.
    "system.community_antwort_gesendet": ["com", "ergebnis", "weg"],
    // Mailweg (WI-0268 C6a): Nummer und der Empfänger nur als Hash.
    "system.community_mail_neu": ["com", "empfaenger"],
    "system.community_mail_erneut": ["com"],
    "system.community_archiviert": ["com", "ergebnis"],
    "system.community_als_meldung": ["com", "meldung"],
    // Verknüpfungen (WI-0268 C7): COM-Nummer, Kennung der Operation, OPS-Nummer; nie Titel, Nachricht, Name oder Text.
    "system.community_korrektur_verknuepft": ["com", "operation"],
    "system.community_an_kanal": ["com", "ops"],
    // Legacy-Meldungen (WI-0268 C9): nur Zahlen und das Zeichen der Freigabe; nie Name, Text oder Nummer.
    "system.community_legacy_uebernommen": ["geliefert", "angelegt", "vorhanden", "ausgefiltert", "zitat"],
    // Bewertungen (WI-0269): öffentliche Kennung, Zustand und Grund aus festen Katalogen.
    "system.community_bewertung_gesichtet": ["bewertung", "zustand"],
    "system.community_bewertung_freigegeben": ["bewertung", "zustand"],
    "system.community_bewertung_verborgen": ["bewertung", "zustand", "grund"],
    "system.community_bewertung_eingeblendet": ["bewertung", "zustand"],
    "system.community_bewertung_geloescht": ["bewertung", "zustand"],
    "system.community_kartenvorschlag_abgelehnt": ["vorschlag", "zustand"],
    "system.community_kartenvorschlag_angenommen": ["vorschlag", "zustand", "karte"],
    // Social Hub (WI-0270): SOC-Nummer und Kanal aus dem festen Katalog, nie Titel, Text oder Hashtags.
    "system.social_vorgelegt": ["beitrag"],
    "system.social_freigegeben": ["beitrag", "kanal"],
    "system.social_aenderung_veroeffentlicht": ["beitrag", "kanal"],
    "system.social_zurueckgenommen": ["beitrag", "kanal"],
    "system.social_verworfen": ["beitrag"],
    "system.social_erneut_gesendet": ["beitrag", "kanal"],
    "system.social_kanal_notschalter": ["kanal", "an"],
    "system.social_kanal_grenzen": ["kanal", "zeichen", "adresse"],
    "system.social_kanal_geprueft": ["kanal", "faelle", "uebereinstimmend", "freigeschaltet", "zitat"],
    "system.social_hashtags": ["anzahl", "vorausgewaehlt"],
    // Wiederherstellungsantrag (WI-0124 K5): OPS-Nummer, `letzte:<Zeit>`/`aelter` und ein Umfang aus drei Werten, kein Freitext.
    "system.restore_requested": ["ops", "sicherung", "umfang"],
    // Neuigkeiten (WI-0139): Tag und Rubrik, und beim Ändern nur der Zustand von/nach. Der Text des Eintrags steht nie
    // im Protokoll — wer ihn lesen will, liest den Eintrag.
    "system.news_added": ["datum", "rubrik"],
    "system.news_changed": ["von", "nach"],
    // Discord-Tagesbericht (WI-0255): „an“/„aus“, ein Tag und ein Zustand der Zustellung, nie der Text und keine Person.
    "system.discord_routine_changed": ["von", "nach"],
    "system.discord_zustellung_wiederholt": ["tag", "von"],
    // Einstellungen des Discord-Berichts (WI-0255): Feldnamen, eine Uhrzeit, Kanalkennungen; nie der Prompt, keine Person.
    "system.discord_einstellungen_geaendert": ["felder", "uhrzeit", "berichtskanal"],
    // Das Panel Mailpostfach (WI-0268 C6c): Art der Routine, an/aus davor und danach, Zahl der nachgereihten Mails; nie eine Adresse oder ein Text.
    "system.community_mail_routine": ["art", "von", "nach", "nachgereiht"],
    // Production-Freigabe (FREIGABE-0001): zwei Release-Kennungen, keine Namen. Die Akte ist der Vorgang im Kanal.
    "system.production_release": ["release", "von"],
    "system.production_rollback": ["release", "von"],
    "system.production_freigabe_abgebrochen": ["release"],
    // Der Abzug für lokal wird eingespielt (WI-0251): die Kennung des Abzugs und der Schritt, kein Personenbezug.
    "system.abzug_einspielen": ["kennung", "schritt"],
    // Der Abzugs-Schlüssel (WI-0251): angelegt oder widerrufen und die Tage; die Kennung steht im Ziel, nie der Wert.
    "system.abzug_schluessel": ["aktion", "tage"],
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L): der geprüfte Commit und die Kennung der Freigabe (RT-…), kein Personenbezug; beim
    // Volltest (WI-0264) nur das Zeichen `volltest: true`.
    "system.release_test_gestartet": ["commit", "wiederholen", "freigabe", "volltest"],
    "system.release_test_abgebrochen": ["commit", "freigabe", "volltest"],
    // Karteneinstellungen (WI-0166): eine Kennung der Tafel, `from`/`to` eine Zahl oder ein Punkt `{x, y}`.
    "system.map_setting_changed": ["key", "from", "to"],
    // Kartenserien (WI-0220): eine Kennung, die Art der Handlung, `from`/`to` als Stufe, Kennung, Stelle, Kachel oder die NAMEN der
    // geänderten Textfelder — nie der Text selbst und kein Personenbezug.
    "system.map_series_changed": ["series", "aktion", "from", "to"],
    // Zoombänder (WI-0221): eine Anzahl und Kennungen aus dem Katalog.
    "system.zoom_band_changed": ["anzahl", "spuren"],
    // WikiSync (WI-0253 D-1): Bereich, Besitzer, Lauf und Kennung des Auftrags; kein Freitext, kein Personenbezug.
    "system.wikisync_bereich_geschaltet": ["bereich", "von", "nach"],
    "system.wikisync_vorschau_angestossen": ["bereiche", "job"],
    "system.wikisync_uebernahme_angestossen": ["bereiche", "lauf", "job"],
    "system.wikisync_zurueckgenommen": ["bereich", "bereiche", "lauf", "job", "objekt"],
    "system.wikisync_wiki_teil_angestossen": ["bereiche", "lauf", "job"],
    "system.wikisync_artikel_angestossen": ["job"],
    "system.wikisync_dump_holen_angestossen": ["job"],
    // Kanon-Tafeln (WI-0253 UI-1): eine Anzahl und Kennungen der Zeilen.
    "system.kanon_tafel_geaendert": ["anzahl", "zeilen"],
    // Begriffstafel der Regelableitung (WI-0253 §24): eine Anzahl und Wörter des Wikis.
    "system.wikisync_begriffe_geaendert": ["anzahl", "woerter"],
};

describe("Schwärzen: Tafel und Marke", () => {
    it("🔴 jeder Schlüssel der Positivliste ist eingeordnet: Freitext zur Person (geschwärzt) oder ohne Personenbezug", () => {
        const personal = personalKeys();
        expect(personal).toEqual(
            [
                "capability.granted.reason",
                "capability.revoked.reason",
                "discord.linked.discordUsername",
                "invitation.created.grund",
                "invitation.created.note",
                "legacy.mapped.evidence",
                "legacy.mapped.legacyName",
                "legacy.mapped.legacyUserId",
                "legacy.unmapped.legacyName",
                "legacy.unmapped.legacyUserId",
                "passkey.counter_regression.label",
                "passkey.registered.label",
                "passkey.revoked.label",
                "person.locked.reason",
                "person.renamed.from",
                "person.renamed.to",
                "sonderrolle.entzogen.grund",
                "sonderrolle.vergeben.grund",
            ].sort(),
        );
        const authored = authoredKeys();
        expect(authored).toEqual(
            [
                "system.lock_changed.reason",
                "system.mode_changed.reason",
                "system.terrain_accepted.reason",
                "system.terrain_activated.reason",
                "system.terrain_draft_created.reason",
                "system.terrain_test_changed.reason",
                // Die Pause der Warteschlange (WI-0160): derselbe Fall wie Stellung und Sperre — Freitext der handelnden Person
                // über das System.
                "system.queue_changed.reason",
            ].sort(),
        );
        const listed = Object.entries(AUDIT_DETAIL_KEYS).flatMap(([action, keys]) =>
            keys.map((key) => `${action}.${key}`),
        );
        const plain = Object.entries(WITHOUT_PERSONAL_REFERENCE).flatMap(([action, keys]) =>
            keys.map((key) => `${action}.${key}`),
        );
        const unsorted = listed.filter(
            (entry) => !personal.includes(entry) && !authored.includes(entry) && !plain.includes(entry),
        );
        expect(unsorted, "neuer Schlüssel in AUDIT_DETAIL_KEYS: einordnen").toEqual([]);
        expect([...personal, ...authored].filter((entry) => !listed.includes(entry))).toEqual([]);
        expect(plain.filter((entry) => personal.includes(entry) || authored.includes(entry))).toEqual([]);
        expect(personal.filter((entry) => authored.includes(entry))).toEqual([]);
    });

    it("🔴 die Marke der Migration ist die des Codes", () => {
        expect(latestDefinition().text).toContain(`'${REDACTED}'`);
    });
});

describeWithDatabase("avesmaps_auth.redact_person_events", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    interface Row {
        id: string;
        action: string;
        at: Date;
        actor_kind: string;
        actor_person_id: string | null;
        target_person_id: string | null;
        target_ref: string | null;
        details: Record<string, unknown>;
        operation_id: string | null;
        request_hash: Buffer | null;
        receipt: unknown;
        ip_prefix: string | null;
        client_label: string | null;
    }

    const rows = async (ids: Record<string, string>): Promise<Record<string, Row>> => {
        const found = await database<Row[]>`
            SELECT id::text, action, at, actor_kind, actor_person_id, target_person_id, target_ref, details, operation_id,
                   request_hash, receipt, ip_prefix, client_label
              FROM avesmaps_auth.security_event WHERE id = ANY(${Object.values(ids)}::bigint[])
        `;
        const byId = new Map(found.map((row) => [row.id, row]));
        return Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, byId.get(id)!]));
    };

    /** Ein Eintrag, wie ihn die Anwendung schreibt; gibt seine Kennung zurück. */
    async function event(entry: Omit<AuditEvent, "environment">, operation = false): Promise<string> {
        const operationId = operation ? randomUUID() : undefined;
        await recordEvent(database, {
            environment: "test",
            ...entry,
            ...(operation
                ? {
                      operationId,
                      requestHash: randomBytes(32),
                      receipt: { operationId, status: "applied", environment: "test", affected: [], derivedWork: [] },
                  }
                : {}),
        });
        const [row] = await database<{ id: string }[]>`SELECT max(id)::text AS id FROM avesmaps_auth.security_event`;
        return row!.id;
    }

    async function invitation(input: {
        by: string;
        note: string;
        accepted?: string;
        bound?: string;
        replacedBy?: string;
    }): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.invitation
                (token_hash, token_hint, environment, role, note, bound_discord_user_id, created_by, expires_at, accepted_at,
                 accepted_person_id, revoked_at, replaced_by)
            VALUES (${randomBytes(32)}, 'abcd', 'test', 'editor', ${input.note}, ${input.bound ?? null}, ${input.by},
                    now() + interval '3 days', ${input.accepted === undefined ? null : new Date()}, ${input.accepted ?? null},
                    ${input.replacedBy === undefined ? null : new Date()}, ${input.replacedBy ?? null})
            RETURNING id::text
        `;
        return row!.id;
    }

    const mine = { ipPrefix: "203.0.113.0", clientLabel: "Firefox · Windows" };
    const theirs = { ipPrefix: "198.51.100.0", clientLabel: "Edge · macOS" };

    /** Alrik (wird aufgelöst), Odila (handelt an ihm), Quirin (unbeteiligt) und ein Protokoll mit allem, was vorkommen kann. */
    async function world() {
        const alrik = (await fixture.person("admin", { name: "Alrik Schwärzbar" })).id;
        const odila = (await fixture.person("operator", { name: "Odila" })).id;
        const quirin = (await fixture.person("editor", { name: "Quirin" })).id;
        const discord = `${String(Date.now())}${String(randomInt(10_000, 99_999))}`;
        await database`
            INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id, discord_username) VALUES (${alrik}, ${discord}, 'alrik_d')
        `;
        const accepted = await invitation({ by: odila, note: "Für Alrik aus Gareth", accepted: alrik });
        const earlier = await invitation({ by: odila, note: "Für Alrik aus Gareth", replacedBy: accepted });
        const second = await invitation({ by: odila, note: "Für Alrik, zweiter Versuch", bound: discord });
        const foreign = await invitation({ by: odila, note: "Für Quirin", accepted: quirin });
        const self = { actorKind: "person", actorPersonId: alrik, targetPersonId: alrik, ...mine } as const;
        const byOdila = { actorKind: "person", actorPersonId: odila, ...theirs } as const;
        const ids = {
            renamed: await event(
                { ...self, action: "person.renamed", details: { from: "Alrik", to: "Alrik Schwärzbar" } },
                true,
            ),
            discord: await event({ ...self, action: "discord.linked", details: { discordUsername: "alrik_d" } }),
            passkey: await event({
                ...self,
                action: "passkey.registered",
                details: { label: "Alriks Telefon", via: "passkey", backedUp: true },
            }),
            regression: await event({
                actorKind: "system",
                targetPersonId: alrik,
                action: "passkey.counter_regression",
                details: { label: "Alriks Telefon" },
            }),
            login: await event({
                ...self,
                action: "login.success",
                details: { method: "password", assurance: "basic" },
            }),
            failure: await event({
                actorKind: "anonymous",
                targetPersonId: alrik,
                action: "login.failure",
                details: { method: "password", reason: "wrong_password" },
                ...mine,
            }),
            locked: await event(
                {
                    ...byOdila,
                    targetPersonId: alrik,
                    action: "person.locked",
                    details: { reason: "Alrik pöbelt", sessions: 1 },
                },
                true,
            ),
            granted: await event(
                {
                    ...byOdila,
                    targetPersonId: alrik,
                    action: "capability.granted",
                    details: { capability: "access_restricted_mode", reason: "Vertretung für Alrik" },
                },
                true,
            ),
            role: await event(
                {
                    ...byOdila,
                    targetPersonId: alrik,
                    action: "person.role_changed",
                    details: { from: "editor", to: "admin" },
                },
                true,
            ),
            legacy: await event(
                {
                    ...byOdila,
                    targetPersonId: alrik,
                    targetRef: "legacy:918273645",
                    action: "legacy.mapped",
                    details: { legacyName: "alrik_alt", legacyUserId: 918273645, evidence: "Selber Discord-Name" },
                },
                true,
            ),
            invited: await event(
                {
                    ...byOdila,
                    targetRef: accepted,
                    action: "invitation.created",
                    details: {
                        role: "editor",
                        validDays: 7,
                        note: "Für Alrik aus Gareth",
                        bound: false,
                        tokenHint: "abcd",
                    },
                },
                true,
            ),
            invitedEarlier: await event(
                {
                    ...byOdila,
                    targetRef: earlier,
                    action: "invitation.created",
                    details: {
                        role: "editor",
                        validDays: 7,
                        note: "Für Alrik aus Gareth",
                        bound: false,
                        tokenHint: "wxyz",
                    },
                },
                true,
            ),
            invitedSecond: await event(
                {
                    ...byOdila,
                    targetRef: second,
                    action: "invitation.created",
                    details: {
                        role: "editor",
                        validDays: 3,
                        note: "Für Alrik, zweiter Versuch",
                        bound: true,
                        tokenHint: "efgh",
                    },
                },
                true,
            ),
            accepted: await event({
                ...self,
                targetPersonId: null,
                targetRef: accepted,
                action: "invitation.accepted",
                details: { role: "editor", method: "discord", tokenHint: "abcd" },
            }),
            // Was Alrik über eine ANDERE schrieb, beschreibt sie: bleibt bis zu ihrer Auflösung; nur sein Gerät geht.
            lockedQuirin: await event(
                {
                    ...self,
                    targetPersonId: quirin,
                    action: "person.locked",
                    details: { reason: "Quirin hat Spam verteilt", sessions: 0 },
                },
                true,
            ),
            quirinRenamed: await event({
                actorKind: "person",
                actorPersonId: quirin,
                targetPersonId: quirin,
                action: "person.renamed",
                details: { from: "Quirin", to: "Quirin II" },
                ...theirs,
            }),
            invitedQuirin: await event(
                {
                    ...byOdila,
                    targetRef: foreign,
                    action: "invitation.created",
                    details: { role: "editor", validDays: 7, note: "Für Quirin", bound: false, tokenHint: "ijkl" },
                },
                true,
            ),
        };
        return { alrik, quirin, ids };
    }

    /** Ruft die Funktion in einer Transaktion (als App-Rolle: `auth-responsibility.test.ts`). */
    async function redact(personId: string | null, commit = true): Promise<number> {
        let count = -1;
        try {
            await database.begin(async (tx) => {
                const [row] = await tx<
                    { n: number }[]
                >`SELECT avesmaps_auth.redact_person_events(${personId})::int AS n`;
                count = row!.n;
                if (!commit) throw new Error(ROLLBACK);
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
        }
        return count;
    }

    it("🔴 schwärzt den Freitext, dessen Gegenstand die Person ist; Kennung, Art, Zeit, wer an wem, Operation und Quittung bleiben", async () => {
        const { alrik, ids } = await world();
        const before = await rows(ids);
        expect(await redact(alrik)).toBe(15);
        const after = await rows(ids);

        expect(after.renamed!.details).toEqual({ from: REDACTED, to: REDACTED });
        expect(after.discord!.details).toEqual({ discordUsername: REDACTED });
        expect(after.passkey!.details).toEqual({ label: REDACTED, via: "passkey", backedUp: true });
        expect(after.regression!.details).toEqual({ label: REDACTED });
        expect(after.locked!.details).toEqual({ reason: REDACTED, sessions: 1 });
        expect(after.granted!.details).toEqual({ capability: "access_restricted_mode", reason: REDACTED });
        expect(after.legacy!.details).toEqual({ legacyName: REDACTED, legacyUserId: REDACTED, evidence: REDACTED });
        expect(after.legacy!.target_ref).toBe(REDACTED);
        for (const name of ["invited", "invitedEarlier", "invitedSecond"] as const) {
            expect(after[name]!.details["note"], name).toBe(REDACTED);
            expect(after[name]!.target_ref, name).toBe(before[name]!.target_ref);
        }
        // Codes und Rollen tragen keinen Personenbezug.
        expect(after.role!.details).toEqual({ from: "editor", to: "admin" });
        expect(after.login!.details).toEqual(before.login!.details);
        expect(after.failure!.details).toEqual(before.failure!.details);

        // Der Prüfwert des Anfrageinhalts geht überall dort, wo sie Gegenstand ist; die Operation bleibt erkennbar.
        for (const name of [
            "renamed",
            "locked",
            "granted",
            "role",
            "legacy",
            "invited",
            "invitedEarlier",
            "invitedSecond",
        ]) {
            expect(after[name]!.request_hash, name).toBeNull();
            expect(after[name]!.operation_id, name).toBe(before[name]!.operation_id);
            expect(after[name]!.receipt, name).toEqual(before[name]!.receipt);
        }
        const structure = (row: Row) => ({
            id: row.id,
            action: row.action,
            at: row.at,
            actor: [row.actor_kind, row.actor_person_id],
            target: row.target_person_id,
            operation: row.operation_id,
            receipt: row.receipt,
        });
        for (const name of Object.keys(ids)) expect(structure(after[name]!), name).toEqual(structure(before[name]!));
    });

    it("🔴 Gerät und IP gehen, wo sie handelt oder niemand an ihrem Konto handelt; Odilas bleiben", async () => {
        const { alrik, ids } = await world();
        await redact(alrik);
        const after = await rows(ids);
        for (const name of ["renamed", "discord", "passkey", "login", "failure", "accepted", "lockedQuirin"] as const) {
            expect({ ip: after[name]!.ip_prefix, client: after[name]!.client_label }, name).toEqual({
                ip: null,
                client: null,
            });
        }
        for (const name of ["locked", "granted", "role", "legacy", "invited"] as const) {
            expect({ ip: after[name]!.ip_prefix, client: after[name]!.client_label }, name).toEqual({
                ip: theirs.ipPrefix,
                client: theirs.clientLabel,
            });
        }
    });

    it("🔴 nur diese Person: was sie über eine andere schrieb und was andere betrifft, bleibt", async () => {
        const { alrik, ids } = await world();
        const before = await rows(ids);
        await redact(alrik);
        const after = await rows(ids);
        expect(after.lockedQuirin!.details).toEqual({ reason: "Quirin hat Spam verteilt", sessions: 0 });
        expect(after.lockedQuirin!.request_hash).toEqual(before.lockedQuirin!.request_hash);
        expect(after.quirinRenamed).toEqual(before.quirinRenamed);
        expect(after.invitedQuirin).toEqual(before.invitedQuirin);
        // Nirgends in ihren Einträgen steht danach noch ein Name, die Discord-Angabe oder die Legacy-Kennung.
        const hers = await database<{ row: string }[]>`
            SELECT to_jsonb(e)::text AS row FROM avesmaps_auth.security_event e
             WHERE e.id = ANY(${Object.entries(ids)
                 .filter(([name]) => !["lockedQuirin", "quirinRenamed", "invitedQuirin"].includes(name))
                 .map(([, id]) => id)}::bigint[])
        `;
        const written = hers.map((entry) => entry.row).join("\n");
        for (const trace of [
            "Alrik",
            "alrik",
            "918273645",
            "Gareth",
            "Telefon",
            "pöbelt",
            "Vertretung",
            "Selber",
            "Firefox",
        ]) {
            expect(written).not.toContain(trace);
        }
    });

    it("🔴 der Grund einer Umschaltung des Betriebs (0087): geschwärzt mit dem Prüfwert, wenn die HANDELNDE Person aufgelöst wird; fremde und Kommandozeile bleiben", async () => {
        const alrik = (await fixture.person("operator", { name: "Alrik Umschalter" })).id;
        const odila = (await fixture.person("operator", { name: "Odila" })).id;
        const system = { targetRef: "system_state" } as const;
        const ids = {
            mode: await event(
                {
                    actorKind: "person",
                    actorPersonId: alrik,
                    ...system,
                    action: "system.mode_changed",
                    details: { from: "normal", to: "restricted", reason: "Alrik prüft die Stage allein" },
                    ...mine,
                },
                true,
            ),
            lock: await event(
                {
                    actorKind: "person",
                    actorPersonId: alrik,
                    ...system,
                    action: "system.lock_changed",
                    details: { lock: "map", from: false, to: true, reason: "Alrik zieht um" },
                    ...mine,
                },
                true,
            ),
            // Ohne Grund (zurück auf Normal): nichts zu schwärzen außer dem Prüfwert und dem Gerät.
            back: await event(
                {
                    actorKind: "person",
                    actorPersonId: alrik,
                    ...system,
                    action: "system.mode_changed",
                    details: { from: "restricted", to: "normal", reason: null },
                    ...mine,
                },
                true,
            ),
            odila: await event(
                {
                    actorKind: "person",
                    actorPersonId: odila,
                    ...system,
                    action: "system.lock_changed",
                    details: { lock: "system", from: false, to: true, reason: "Odila sichert" },
                    ...theirs,
                },
                true,
            ),
            cli: await event({
                actorKind: "cli",
                actorLabel: "cli:root",
                ...system,
                action: "system.mode_changed",
                details: { from: "restricted", to: "normal", reason: "Rückweg" },
            }),
        };
        const before = await rows(ids);
        expect(await redact(alrik)).toBe(3);
        const after = await rows(ids);
        expect(after.mode!.details).toEqual({ from: "normal", to: "restricted", reason: REDACTED });
        expect(after.lock!.details).toEqual({ lock: "map", from: false, to: true, reason: REDACTED });
        expect(after.back!.details).toEqual({ from: "restricted", to: "normal", reason: null });
        for (const name of ["mode", "lock", "back"] as const) {
            expect(after[name]!.request_hash, name).toBeNull();
            expect({ ip: after[name]!.ip_prefix, client: after[name]!.client_label }, name).toEqual({
                ip: null,
                client: null,
            });
            expect(after[name]!.operation_id, name).toBe(before[name]!.operation_id);
            expect(after[name]!.receipt, name).toEqual(before[name]!.receipt);
            expect(after[name]!.target_ref, name).toBe("system_state");
        }
        expect(after.odila).toEqual(before.odila);
        expect(after.cli).toEqual(before.cli);
        expect(await redact(alrik)).toBe(0);
        // Der Eintrag der Kommandozeile hat keine Person, die `cleanup` fände.
        await database`DELETE FROM avesmaps_auth.security_event WHERE id = ${ids.cli}::bigint`;
    });

    it("🔴 wiederholbar: ein zweiter Aufruf ändert nichts und gibt 0; ohne Person 0", async () => {
        const { alrik, ids } = await world();
        expect(await redact(alrik)).toBeGreaterThan(0);
        const once = await rows(ids);
        expect(await redact(alrik)).toBe(0);
        expect(await rows(ids)).toEqual(once);
        expect(await redact(randomUUID())).toBe(0);
        expect(await redact(null)).toBe(0);
    });

    it("🔴 zurückgerollt ändert sie nichts (der Trockenlauf von `aufloesen`)", async () => {
        const { alrik, ids } = await world();
        const before = await rows(ids);
        expect(await redact(alrik, false)).toBe(15);
        expect(await rows(ids)).toEqual(before);
    });

    it("🔴 Rechte der Funktion: Besitzer, fester Suchpfad, PUBLIC ohne EXECUTE", async () => {
        const [row] = await database<{ definer: boolean; config: string[] | null; open: boolean }[]>`
            SELECT p.prosecdef AS definer, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS open
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'avesmaps_auth' AND p.proname = 'redact_person_events'
        `;
        expect(row).toEqual({ definer: true, config: ["search_path=pg_catalog, pg_temp"], open: false });
    });
});
