import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * Das Panel „Mailpostfach“ der Systemsteuerung (WI-0268 C6c; Handover `project-control/handovers/2026-11-01-wi0268-mail-panel-an-claudia.md`): der Mailweg der Community, Abruf per IMAP und Versand per SMTP, mit
 * einem Schalter je Art, dem Betrieb und dem letzten Lauf. Vorbild ist die Routine des Discord-Tagesberichts (`discord.ts`).
 *
 * - Sehen darf, wer den Betrieb liest (`view_operations`), schalten nur `manage_system_settings` mit frischem Passkey.
 * - 🔴 **Nie im Stand:** Nutzer, Kennwort, Absenderadresse, Ablagepfad. Der Stand sagt nur, OB der Zugang hinterlegt ist, und nennt den Server (IMAP- bzw. SMTP-Host) und den Ordner. Eingerichtet wird der Zugang nur auf
 *   dem Server (`ops/production/mail-einrichten.sh`).
 * - Der Schalter liegt in der Datenbank (`avesmaps_community.mail_routine`, Migration 0289) und gilt ZUSÄTZLICH zur Konfiguration in der `.env`: Fehlt dort eine Angabe, ist der Weg aus, gleich wie der Schalter steht.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const MAIL_ADMIN_URL = "/api/admin/system/mail";

/** Die zwei Routinen des Mailwegs. */
export const MAIL_ROUTINE_ARTEN = ["abruf", "versand"] as const;
export type MailRoutineArt = (typeof MAIL_ROUTINE_ARTEN)[number];

/**
 * Was ein Lauf zuletzt ergab (`mail_routine.letzter_lauf`), als Wort aus einer festen Liste: nie der Text eines Servers, nie Adresse, Nutzer oder Kennwort. Die Datenbankfunktion
 * `community_mail_lauf` lehnt jedes andere Wort ab (KC422).
 *
 * - Abruf: `gelesen` (Erfolg), `anmeldung_abgelehnt`, `ordner_fehlt` (beide dauerhaft: Die Pflege wartet danach sechs Stunden), `gestoert` (Netz, Server, Datenbank, Ablage: der nächste Takt versucht es wieder),
 *   `zugang_fehlt` (die Umgebung des Ausführers hat die Angaben nicht), `ausgeschaltet` (der Schalter steht auf aus: keine Verbindung zum Postfach).
 * - Versand: `gesendet` (Erfolg: vom Mailserver angenommen), `anmeldung_abgelehnt`, `adresse_abgelehnt`, `gestoert`, `zugang_fehlt`, `zurueckgehalten` (der Schalter steht auf aus: Die Mail bleibt wartend, kein Versuch).
 */
export const MAIL_ABRUF_ERGEBNISSE = [
    "gelesen",
    "anmeldung_abgelehnt",
    "ordner_fehlt",
    "gestoert",
    "zugang_fehlt",
    "ausgeschaltet",
] as const;
export type MailAbrufErgebnis = (typeof MAIL_ABRUF_ERGEBNISSE)[number];
export const MAIL_VERSAND_ERGEBNISSE = [
    "gesendet",
    "anmeldung_abgelehnt",
    "adresse_abgelehnt",
    "gestoert",
    "zugang_fehlt",
    "zurueckgehalten",
] as const;
export type MailVersandErgebnis = (typeof MAIL_VERSAND_ERGEBNISSE)[number];

/**
 * Warum der Abruf nicht (oder nur mit Vorbehalt) abholt:
 *
 * - `zugang_fehlt`: eine Pflichtangabe der Umgebung fehlt (IMAP-Host, Nutzer, Kennwort oder Ablage) oder ist unbrauchbar.
 * - `ausgeschaltet`: der Schalter steht auf aus.
 * - `anmeldung_abgelehnt`: der letzte Lauf endete mit `anmeldung_abgelehnt` oder `ordner_fehlt`; die Pflege wartet sechs Stunden (`wartenBis`), um das Konto nicht zu sperren.
 * - `nicht_eingerichtet`: der Zugang ist da, aber für den Ordner gibt es keinen Startpunkt (`mail_abruf_stand`). 🔴 Das ist ein VORBEHALT, kein Stillstand: Der Abruf liest dann ab der ersten UID, der erste Lauf
 *   nähme das ganze Postfach als Anfragen auf. Eingerichtet wird der Startpunkt mit `mail-einrichten.sh --abruf-an`. (Der Abstand der Pflege ist im Ausführer fest auf fünf Minuten verdrahtet, er kann nicht fehlen.)
 */
export const MAIL_ABRUF_GRUENDE = [
    "zugang_fehlt",
    "nicht_eingerichtet",
    "ausgeschaltet",
    "anmeldung_abgelehnt",
] as const;
export type MailAbrufGrund = (typeof MAIL_ABRUF_GRUENDE)[number];
export const MAIL_VERSAND_GRUENDE = ["zugang_fehlt", "ausgeschaltet"] as const;
export type MailVersandGrund = (typeof MAIL_VERSAND_GRUENDE)[number];

/** So lange wartet die Pflege nach einem dauerhaften Fehler des Abrufs (`MAIL_ABRUF_DAUERHAFT`, `jobs/worker.ts`). */
export const MAIL_ABRUF_WARTEZEIT_MS = 6 * 3_600_000;

const MailRoutine = Type.Object(
    {
        aktiv: Type.Boolean(),
        geaendertAt: Nullable(Type.String()),
        geaendertVon: Nullable(Type.String()),
    },
    strict,
);

/** `GET /api/admin/system/mail` — der Abruf: Betrieb, Routine, Zugang (nur ob), Server, Ordner, letzter Lauf, letzter Erfolg und der Startpunkt (nur lesend). */
export const MailAbrufStand = Type.Object(
    {
        betrieb: literals(["holt_ab", "holt_nicht_ab"] as const),
        /** `null`: nichts zu sagen. Bei `holt_nicht_ab` der Grund; `nicht_eingerichtet` ist ein Vorbehalt bei `holt_ab` (siehe `MAIL_ABRUF_GRUENDE`). */
        grund: Nullable(literals(MAIL_ABRUF_GRUENDE)),
        /** Nur bei `anmeldung_abgelehnt`: ab wann die Pflege wieder fragt (ISO), solange das in der Zukunft liegt. */
        wartenBis: Nullable(Type.String()),
        zugang: literals(["hinterlegt", "fehlt"] as const),
        /** Der IMAP-Host, wenn die Umgebung einen brauchbaren trägt; sonst `null`. */
        server: Nullable(Type.String()),
        /** Der Ordner, der gelesen wird (Vorgabe `INBOX`). */
        ordner: Type.String(),
        routine: MailRoutine,
        letzterLauf: Nullable(Type.Object({ at: Type.String(), ergebnis: literals(MAIL_ABRUF_ERGEBNISSE) }, strict)),
        letzterErfolg: Nullable(
            Type.Object(
                {
                    at: Type.String(),
                    neu: Type.Integer({ minimum: 0 }),
                    angehaengt: Type.Integer({ minimum: 0 }),
                    unlesbar: Type.Integer({ minimum: 0 }),
                    zuGross: Type.Integer({ minimum: 0 }),
                },
                strict,
            ),
        ),
        /** `UIDVALIDITY` und letzte gelesene UID des Ordners; `null`: noch keiner gesetzt. */
        startpunkt: Nullable(
            Type.Object({ uidValidity: Type.Integer({ minimum: 0 }), letzteUid: Type.Integer({ minimum: 0 }) }, strict),
        ),
        /** Wann zuletzt eine Mail angenommen wurde (ISO); `null`: noch keine. */
        letzteMailAt: Nullable(Type.String()),
    },
    strict,
);
export type MailAbrufStand = Static<typeof MailAbrufStand>;

/** Der Versand: Betrieb, Routine, Zugang (nur ob), Server, letzter Lauf, letzter Erfolg, wartende Mails und Fehler der letzten sieben Tage. */
export const MailVersandStand = Type.Object(
    {
        betrieb: literals(["sendet", "sendet_nicht"] as const),
        grund: Nullable(literals(MAIL_VERSAND_GRUENDE)),
        zugang: literals(["hinterlegt", "fehlt"] as const),
        /** Der SMTP-Host, wenn die Umgebung einen brauchbaren trägt; sonst `null`. */
        server: Nullable(Type.String()),
        routine: MailRoutine,
        letzterLauf: Nullable(Type.Object({ at: Type.String(), ergebnis: literals(MAIL_VERSAND_ERGEBNISSE) }, strict)),
        /** `kopieFehlt`: Die Mail ging hinaus, ihre Kopie im Ordner „Gesendet“ aber nicht (C6d). */
        letzterErfolg: Nullable(Type.Object({ at: Type.String(), kopieFehlt: Type.Optional(Type.Boolean()) }, strict)),
        /** Mails im Zustand „wartet“ (werden gesendet, sobald der Versand an ist). */
        wartend: Type.Integer({ minimum: 0 }),
        /** Mails, die in den letzten sieben Tagen angelegt wurden und als „nicht zugestellt“ enden. */
        fehler7Tage: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type MailVersandStand = Static<typeof MailVersandStand>;

export const MailStand = Type.Object({ abruf: MailAbrufStand, versand: MailVersandStand }, strict);
export type MailStand = Static<typeof MailStand>;

/**
 * `POST /api/admin/system/mail/routine` — die Routine einer Art an- oder ausschalten (Passkey). Es zählt der Zielzustand, nicht „umschalten“: Zwei gleichzeitige Klicks setzen dasselbe. Wird der Versand
 * wieder eingeschaltet, reiht die Route in derselben Transaktion für jede wartende Mail einen Versandauftrag nach.
 */
export const MailRoutineBody = Type.Object(
    { operationId: OperationId, art: literals(MAIL_ROUTINE_ARTEN), aktiv: Type.Boolean() },
    strict,
);
export type MailRoutineBody = Static<typeof MailRoutineBody>;
