import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { KANAL_STATUS } from "../kanal.ts";
import { OperationId } from "../operation.ts";

/**
 * Die Sicherung in der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §6.5, §9e). Betreiber 2026-10-10, wörtlich: „warum kann ich in der
 * verwaltung keine backups manuella anstoßen, obwohl wir das dropbox-ding jetzt gemacht haben“, auf Claudios Vorschlag „ja schlag ihr das
 * vor. das kommt in backup“.
 *
 * - **Anzeige:** ein eigenes Lesemodell aus Claudios Statusdatei (`BACKUP_STATUS_FILE`, §3.6), nie ihr roher Inhalt. Fehlt sie, heißt das
 *   „nicht eingerichtet“, kein Fehler (lokal der Normalfall).
 * - **„Sicherung jetzt“:** Die App legt eine Auftragsdatei in `BACKUP_REQUEST_DIR` (§9e); Claudios Seite holt sie ab, drosselt (ein
 *   manueller Lauf je 30 min) und schreibt das Ergebnis in die Statusdatei (`last_request`). Recht `run_backup`, Stufe V, nur Betreiber.
 *   Wiederherstellen bleibt beim Betreiber auf der Kommandozeile.
 * - **„Wiederherstellung beantragen“** (WI-0124 KANAL-0001 W10, K5): Recht `request_restore`, Stufe S. Der Antrag wird ein Vorgang der Art
 *   `wiederherstellung` im Betreiber-Kanal, dringend, zuständig Claudio; aus der App wird nie zurückgespielt. Wer das Recht hat, sieht unter
 *   „Backups“ den offenen Antrag (`wiederherstellung`), den Kanal selbst nur Betreiber.
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
/** Eine Auswahl fester Werte; der Typ bleibt die Vereinigung der Werte (nicht `string`). */
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/**
 * Die Zustände der Sicherung (§6.5): `nicht_eingerichtet` (keine Statusdatei, kein Fehler) · `laeuft` · `aktuell` · `ueberfaellig`
 * (`next_run_at` mehr als 2 h vorbei ohne neuen Lauf) · `fehlgeschlagen` · `unbekannt` (unlesbar, falsche Form, fehlende Angaben).
 */
export const SICHERUNG_ZUSTAENDE = [
    "nicht_eingerichtet",
    "laeuft",
    "aktuell",
    "ueberfaellig",
    "fehlgeschlagen",
    "unbekannt",
] as const;
export type SicherungZustand = (typeof SICHERUNG_ZUSTAENDE)[number];

/** Was Claudios Seite auf einen Auftrag antwortet (`last_request.result`, §9e). */
export const SICHERUNG_ANTWORTEN = ["angenommen", "laeuft_schon", "zu_frueh"] as const;
export type SicherungAntwortArt = (typeof SICHERUNG_ANTWORTEN)[number];

export const SicherungLauf = Type.Object(
    {
        startedAt: Nullable(Moment),
        finishedAt: Nullable(Moment),
        result: Nullable(literals(["ok", "failed", "running"] as const)),
        errorCode: Nullable(Type.String()),
        /** `timer` (der tägliche Lauf) oder `manual` („Sicherung jetzt“); fehlt bei älteren Dateien. */
        trigger: Nullable(literals(["timer", "manual"] as const)),
        /** Nur bei `manual`: die `operation_id` des Auftrags. */
        operationId: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type SicherungLauf = Static<typeof SicherungLauf>;

export const SicherungTeil = Type.Object(
    {
        kind: Type.String(),
        bytes: Nullable(Type.Integer({ minimum: 0 })),
        /** Gekürzt auf 12 Zeichen: zum Wiedererkennen, nicht zum Prüfen. */
        sha256: Nullable(Type.String()),
        encrypted: Nullable(Type.Boolean()),
        /** Wohin außer Haus (`dropbox`), sonst `null`. */
        offsite: Nullable(Type.String()),
        offsiteVerifiedAt: Nullable(Moment),
    },
    { additionalProperties: false },
);
export type SicherungTeil = Static<typeof SicherungTeil>;

export const SicherungAufbewahrung = Type.Object(
    {
        local: Nullable(Type.Integer({ minimum: 0 })),
        daily: Nullable(Type.Integer({ minimum: 0 })),
        weekly: Nullable(Type.Integer({ minimum: 0 })),
        monthly: Nullable(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
);
export type SicherungAufbewahrung = Static<typeof SicherungAufbewahrung>;

/** Ein Auftrag, der in `BACKUP_REQUEST_DIR` liegt und noch nicht abgeholt ist. */
export const SicherungAuftrag = Type.Object(
    { operationId: Type.String(), requestedAt: Moment },
    { additionalProperties: false },
);
export type SicherungAuftrag = Static<typeof SicherungAuftrag>;

/** Die letzte Antwort von Claudios Seite auf einen Auftrag (`last_request`). Eine unbekannte Antwort heißt `null`. */
export const SicherungAntwort = Type.Object(
    { operationId: Nullable(Type.String()), at: Nullable(Moment), result: Nullable(literals(SICHERUNG_ANTWORTEN)) },
    { additionalProperties: false },
);
export type SicherungAntwort = Static<typeof SicherungAntwort>;

/** `GET /api/admin/system/backup`. */
/** Welche Sicherung ein Wiederherstellungsantrag meint: die letzte erfolgreiche (die Zeit setzt der Server) oder eine ältere (im Grund). */
export const WIEDERHERSTELLUNG_SICHERUNGEN = ["letzte", "aelter"] as const;
export type WiederherstellungSicherung = (typeof WIEDERHERSTELLUNG_SICHERUNGEN)[number];
/** Der Umfang eines Wiederherstellungsantrags (dieselben Werte prüft `avesmaps_kanal.kanal_wiederherstellung`). */
export const WIEDERHERSTELLUNG_UMFAENGE = ["datenbank", "datenbank_medien", "einstellungen"] as const;
export type WiederherstellungUmfang = (typeof WIEDERHERSTELLUNG_UMFAENGE)[number];
export const WIEDERHERSTELLUNG_GRUND_MAX = 2000;

/** Der offene Wiederherstellungsantrag unter „Backups“: OPS-ID, Stand im Kanal, wann, welcher Umfang und welche Sicherung. */
export const SicherungWiederherstellung = Type.Object(
    {
        ops: Type.String(),
        status: literals(KANAL_STATUS),
        beantragtAt: Moment,
        umfang: literals(WIEDERHERSTELLUNG_UMFAENGE),
        /** `letzte:<Zeit>`, `letzte:unbekannt` oder `aelter`. */
        sicherung: Type.String(),
    },
    { additionalProperties: false },
);
export type SicherungWiederherstellung = Static<typeof SicherungWiederherstellung>;

export const AdminSicherung = Type.Object(
    {
        /** Die Uhr des Servers, für „vor … min“ und „noch nicht abgeholt“. */
        now: Moment,
        zustand: literals(SICHERUNG_ZUSTAENDE),
        /** Wann die Statusdatei zuletzt geschrieben wurde (`updated_at`). */
        stand: Nullable(Moment),
        letzterLauf: Nullable(SicherungLauf),
        letzteErfolgreiche: Nullable(Moment),
        ausserHaus: Type.Object(
            {
                /** Ist eine Kopie außer Haus eingerichtet (`offsite_configured`)? */
                eingerichtet: Nullable(Type.Boolean()),
                /** Wann die jüngste Kopie außer Haus geprüft wurde. */
                geprueftAm: Nullable(Moment),
            },
            { additionalProperties: false },
        ),
        probelauf: Nullable(
            Type.Object(
                { at: Nullable(Moment), result: Nullable(literals(["ok", "failed"] as const)) },
                { additionalProperties: false },
            ),
        ),
        naechsterLauf: Nullable(Moment),
        aufbewahrung: Nullable(SicherungAufbewahrung),
        teile: Type.Array(SicherungTeil),
        /** Eine Statusdatei mit höherer `schema_version`: gelesen wird, was bekannt ist. */
        neueresFormat: Type.Boolean(),
        /** Der jüngste offene Wiederherstellungsantrag dieser Umgebung; nur mit `request_restore`, sonst `null` (K5). */
        wiederherstellung: Type.Optional(Nullable(SicherungWiederherstellung)),
        anstossen: Type.Object(
            {
                /** Ist `BACKUP_REQUEST_DIR` gesetzt? Sonst ist der Knopf aus („Auf dieser Umgebung gibt es keine Sicherung.“). */
                moeglich: Type.Boolean(),
                wartend: Nullable(SicherungAuftrag),
                letzteAntwort: Nullable(SicherungAntwort),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type AdminSicherung = Static<typeof AdminSicherung>;

/** `POST /api/admin/system/backup/start`. */
export const SicherungStartBody = Type.Object({ operationId: OperationId }, { additionalProperties: false });
export type SicherungStartBody = Static<typeof SicherungStartBody>;

/** `POST /api/admin/system/backup/wiederherstellung` (K5): welche Sicherung, welcher Umfang, Grund (Pflicht). */
export const WiederherstellungBody = Type.Object(
    {
        operationId: OperationId,
        sicherung: literals(WIEDERHERSTELLUNG_SICHERUNGEN),
        umfang: literals(WIEDERHERSTELLUNG_UMFAENGE),
        grund: Type.String({ minLength: 1, maxLength: WIEDERHERSTELLUNG_GRUND_MAX }),
    },
    { additionalProperties: false },
);
export type WiederherstellungBody = Static<typeof WiederherstellungBody>;

/** Nach so vielen Sekunden sagt die Anzeige zu einem liegenden Auftrag „noch nicht abgeholt“ (§9e). */
export const SICHERUNG_ABHOLEN_S = 60;

/**
 * Die Fachcodes (ADR-0018): `backup_pending` (409) ein Auftrag liegt schon und wartet auf die Abholung; `backup_unavailable` (503) diese
 * Umgebung hat keine Sicherung (`BACKUP_REQUEST_DIR` fehlt); `backup_write_failed` (503) die Auftragsdatei ließ sich nicht schreiben.
 */
export const SICHERUNG_ERROR_STATUS = {
    backup_pending: 409,
    backup_unavailable: 503,
    backup_write_failed: 503,
} as const;
export type SicherungErrorCode = keyof typeof SICHERUNG_ERROR_STATUS;
