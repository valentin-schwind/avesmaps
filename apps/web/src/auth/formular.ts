import { RESPONSIBILITY_MAX } from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { ApiFailure } from "./api";

/**
 * Was eine abgelehnte Anfrage der Anmeldung für ein Formular bedeutet (WI-0120 A9). Die Oberfläche zeigt nie den Text des
 * Servers, sondern einen eigenen Satz zum stabilen Code (ADR-0018); unbekannte Codes bekommen einen allgemeinen.
 */
export interface Phrase {
    key: MessageKey;
    params?: Record<string, number | string>;
}

const PASSWORD_PROBLEMS: Record<string, MessageKey> = {
    too_short: "auth.password.problem.tooShort",
    too_long: "auth.password.problem.tooLong",
    common: "auth.password.problem.common",
    pattern: "auth.password.problem.pattern",
    contextual: "auth.password.problem.contextual",
};

const CODES: Record<string, MessageKey> = {
    login_name_taken: "auth.form.loginNameTaken",
    login_name_invalid: "auth.form.loginNameInvalid",
    display_name_invalid: "auth.form.displayNameInvalid",
    invitation_invalid: "auth.invitation.invalid",
    invitation_requires_discord: "auth.invitation.requiresDiscord",
    link_invalid: "auth.link.invalid",
    account_locked: "auth.login.error.locked",
    no_access: "auth.login.error.noAccess",
    invalid_credentials: "auth.login.error.credentials",
    current_password_wrong: "auth.account.password.currentWrong",
    rate_limited: "auth.form.rateLimited",
    // Die Nacht-Freigabe, die abgebrochen werden sollte, war schon erloschen (WI-0234).
    freigabe_vorbei: "admin.production.nacht.vorbei",
    reauth_required: "auth.form.reauth",
    assurance_required: "auth.form.assurance",
    auth_unavailable: "auth.login.error.unavailable",
    discord_unavailable: "auth.login.error.discordUnavailable",
    network: "auth.login.error.network",
    edit_conflict: "auth.form.conflict",
    // Ein Formular aus Zahlen (WI-0153 „Wegfindung“): Die Oberfläche prüft die Spanne mit derselben Regel, also kommen diese
    // Codes nur, wenn zwei Stände auseinanderlaufen — dann soll da nicht „Es hat nicht geklappt“ stehen. `no_change` steht
    // weiter unten, es gab ihn schon.
    value_out_of_range: "auth.form.outOfRange",
    unknown_setting: "auth.form.unknownSetting",
    passkey_unavailable: "auth.passkey.unavailable",
    passkey_enrollment_required: "auth.passkey.enrollmentRequired",
    passkey_exists: "auth.passkey.exists",
    passkey_rejected: "auth.passkey.rejected",
    no_passkey: "auth.passkey.none",
    current_session: "auth.account.sessions.current",
    last_login_method: "auth.account.discord.lastMethod",
    no_change: "auth.form.noChange",
    // Production-Freigabe (FREIGABE-0001): Jeder Grund hat seinen eigenen Satz — „ging nicht“ hilft niemandem.
    // Einer Verwaltungsroute fehlt Schema oder Recht (error-handler.ts). Nicht die Anmeldung - die hat ihren eigenen Satz.
    not_provisioned: "admin.error.notProvisioned",
    freigabe_unavailable: "admin.production.error.unavailable",
    freigabe_blocked: "admin.production.error.blocked",
    freigabe_stale: "admin.production.error.stale",
    // Release-Test auf dem Entwicklungsrechner (WI-0248 L): Jeder Grund hat seinen eigenen Satz.
    release_test_unavailable: "admin.umgebungen.releaseTest.error.unavailable",
    release_test_stale: "admin.umgebungen.releaseTest.error.stale",
    release_test_laeuft: "admin.umgebungen.releaseTest.error.laeuft",
    release_test_gruen: "admin.umgebungen.releaseTest.error.gruen",
    release_test_sperre: "admin.umgebungen.releaseTest.error.sperre",
    release_test_kein_lauf: "admin.umgebungen.releaseTest.error.keinLauf",
    release_test_kein_roter_lauf: "admin.umgebungen.releaseTest.error.keinRoterLauf",
    release_test_fehler: "admin.umgebungen.releaseTest.error.fehler",
    // WI-0248: Der Start ist die Freigabe; ließ sie sich nicht schreiben, startet nichts.
    release_test_freigabe: "admin.umgebungen.releaseTest.error.freigabe",
    release_test_kein_bericht: "admin.umgebungen.releaseTest.seite.fehlt",
    // Neuigkeiten (WI-0139)
    news_not_found: "admin.news.error.notFound",
    news_unavailable: "admin.news.error.unavailable",
    // Discord-Tagesbericht (WI-0255)
    discord_bericht_fehlt: "admin.discord.error.unavailable",
    discord_zustellung_fehlt: "admin.discord.error.notFound",
    discord_sendet_nicht: "admin.discord.error.sendetNicht",
    discord_nicht_wiederholbar: "admin.discord.error.nichtWiederholbar",
    discord_prompt_ungueltig: "admin.discord.error.promptUngueltig",
    // Mailpostfach (WI-0268 C6c)
    mail_unavailable: "admin.mail.error.unavailable",
    // Verwaltung (A7, AUTH-0001 §7.3)
    self_change: "admin.error.selfChange",
    forbidden_target: "admin.error.forbiddenTarget",
    forbidden_role: "admin.error.forbiddenRole",
    forbidden: "admin.error.forbidden",
    unauthenticated: "admin.error.unauthenticated",
    last_operator: "admin.error.lastOperator",
    rights_changed: "admin.error.rightsChanged",
    no_password_login: "admin.error.noPasswordLogin",
    account_inactive: "admin.error.accountInactive",
    grant_requires_admin: "admin.error.grantRequiresAdmin",
    // Sonderrollen (WI-0279). Die übrigen Codes kann die Oberfläche nicht auslösen, außer zwei Stände laufen auseinander.
    region_vergeben: "admin.sonderrollen.error.regionVergeben",
    sonderrollen_production: "admin.sonderrollen.error.production",
    region_fehlt: "admin.sonderrollen.fehlt.region",
    region_unbekannt: "admin.sonderrollen.error.regionUnbekannt",
    sonderrolle_unbekannt: "admin.sonderrollen.error.unbekannt",
    sonderrolle_ohne_region: "admin.sonderrollen.error.ohneRegion",
    capability_not_grantable: "admin.error.notGrantable",
    has_by_role: "admin.error.hasByRole",
    reason_required: "admin.error.reasonRequired",
    invitation_closed: "admin.error.invitationClosed",
    invitation_binding_required: "admin.error.bindingRequired",
    discord_id_invalid: "admin.error.discordIdInvalid",
    legacy_already_mapped: "admin.error.legacyMapped",
    legacy_machine: "admin.error.legacyMachine",
    not_found: "admin.error.notFound",
    // Betriebszustand und Sperren (WI-0127 SYS-2, SYS-4, SYS-0001 §4.6); die Sperren treffen auch die übrigen Handlungen.
    would_lock_out_self: "admin.system.error.wouldLockOutSelf",
    no_restricted_access_holder: "admin.system.error.noHolder",
    system_state_unknown: "admin.system.error.unknown",
    restricted_mode: "admin.system.error.restricted",
    map_locked: "admin.system.error.mapLocked",
    system_locked: "admin.system.error.systemLocked",
    // Abgleiche (WI-0127 SYS-14).
    sync_running: "admin.sync.error.running",
    sync_unavailable: "admin.sync.error.unavailable",
    // Abzug für lokal (WI-0251).
    abzug_ablage_fehlt: "admin.abzug.error.ablage",
    abzug_laeuft: "admin.abzug.error.laeuft",
    abzug_unbekannt: "admin.abzug.error.unbekannt",
    abzug_link_ungueltig: "admin.abzug.error.link",
    abzug_datei_ungueltig: "admin.abzug.error.datei",
    abzug_einspielen_gesperrt: "admin.abzug.error.gesperrt",
    abzug_sicherung_fehlt: "admin.abzug.error.sicherung",
    karten_zugang_zuviele: "kartenExport.fehler.zuviele",
    karten_zugang_gesehen: "kartenExport.fehler.gesehen",
    karten_zugang_unbekannt: "kartenExport.fehler.unbekannt",
    karten_zugang_umzug: "kartenExport.fehler.umzug",
    export_not_available: "kartenExport.fehler.fehlt",
    abzug_schluessel_zuviele: "admin.abzug.error.schluesselZuviele",
    abzug_schluessel_unbekannt: "admin.abzug.error.schluesselUnbekannt",
    abzug_schluessel_gesehen: "admin.abzug.error.schluesselGesehen",
    abzug_schluessel_fehlt: "admin.abzug.error.schluesselFehlt",
    // Sicherung (WI-0127 SYS-9).
    backup_pending: "admin.backup.error.pending",
    backup_unavailable: "admin.backup.error.unavailable",
    backup_write_failed: "admin.backup.error.writeFailed",
    // Inhaltsschalter (WI-0127 SYS-10).
    unknown_switch: "admin.content.error.unknown",
    last_series: "admin.content.error.lastSeries",
    // Kartenserien (WI-0220)
    labels_in_image: "admin.kartenserien.error.labelsInImage",
    default_visible: "admin.kartenserien.error.defaultVisible",
    kartenserien_production: "admin.kartenserien.production",
    kartenserien_unprovisioned: "admin.kartenserien.source.unprovisioned",
    series_not_ready: "admin.kartenserien.error.notReady",
    in_papierkorb: "admin.kartenserien.error.inPapierkorb",
    label_required: "admin.kartenserien.error.labelRequired",
    unknown_series: "admin.kartenserien.error.unknown",
    // Hochladen und Zerlegen (WI-0220 Schnitt 3)
    kartenserien_kennung_vergeben: "admin.kartenserien.error.kennungVergeben",
    kartenserien_upload_offen: "admin.kartenserien.error.uploadOffen",
    kartenserien_platz: "admin.kartenserien.error.platz",
    kartenserien_kante: "admin.kartenserien.error.kante",
    kartenserien_versatz: "admin.kartenserien.error.versatz",
    kartenserien_pruefsumme: "admin.kartenserien.error.pruefsumme",
    kartenserien_unvollstaendig: "admin.kartenserien.error.unvollstaendig",
    kartenserien_auftrag_laeuft: "admin.kartenserien.error.auftragLaeuft",
    kartenserien_upload_fehlt: "admin.kartenserien.error.uploadFehlt",
    kartenserien_stueck: "admin.kartenserien.error.stueck",
    kartenserien_ablage_fehlt: "admin.kartenserien.error.ablageFehlt",
    kartenserien_fassung_fehlt: "admin.kartenserien.error.fassungFehlt",
    kartenserien_ausgeblendet: "admin.kartenserien.error.ausgeblendet",
    papierkorb_abgelaufen: "admin.kartenserien.error.papierkorbAbgelaufen",
    // Zoombänder (WI-0221)
    unknown_zoom_band: "admin.zoombaender.error.unknown",
    zoom_band_view_only: "admin.zoombaender.error.viewOnly",
    zoom_band_out_of_range: "admin.zoombaender.error.range",
    zoombaender_unprovisioned: "admin.zoombaender.source.unprovisioned",
    // Höhenmodell (WI-0127 SYS-13).
    terrain_version_unknown: "admin.terrain.error.unknown",
    terrain_not_accepted: "admin.terrain.error.notAccepted",
    terrain_no_rollback: "admin.terrain.error.noRollback",
    terrain_draft_invalid: "admin.terrain.error.draftInvalid",
    terrain_already_active: "admin.terrain.error.alreadyActive",
    terrain_draft_not_found: "admin.terrain.error.draftNotFound",
    terrain_measure_running: "admin.terrain.error.measureRunning",
    terrain_measure_unavailable: "admin.terrain.error.measureUnavailable",
    terrain_chain_waiting: "admin.terrain.error.chainWaiting",
};

/** Ein oder mehrere Sätze: Ein abgelehntes Passwort nennt jede verletzte Regel einzeln. */
export function formProblems(error: unknown): Phrase[] {
    if (!(error instanceof ApiFailure)) return [{ key: "auth.form.failed" }];
    if (error.code === "password_rejected") {
        const problems = Array.isArray(error.details?.["problems"]) ? (error.details["problems"] as unknown[]) : [];
        const phrases = problems.flatMap((problem) => {
            const key = PASSWORD_PROBLEMS[String(problem)];
            return key === undefined ? [] : [{ key }];
        });
        return phrases.length > 0 ? phrases : [{ key: "auth.password.problem.generic" }];
    }
    // „Verantwortlich für:“ (WI-0133): welche Regel verletzt ist, sagt der Server in `problem`.
    if (error.code === "responsibility_invalid") {
        return error.details?.["problem"] === "too_long"
            ? [{ key: "auth.responsibility.tooLong", params: { max: RESPONSIBILITY_MAX } }]
            : [{ key: "auth.responsibility.line" }];
    }
    if (error.code === "reauth_required" && error.details?.["need"] === "current_password") {
        return [{ key: "auth.account.password.currentMissing" }];
    }
    /**
     * 🔴 **Welche der Sperren es ist, sagt der Server** (Betreiber 2026-10-14). Vorher stand hier ein Sammelsatz: „Entweder
     * ist die Stage nicht grün geprüft, es gibt nichts zu schieben, oder es läuft schon eine Freigabe. Der Stand oben sagt,
     * welches davon.“ Der Stand oben sagte es nicht — `stageGruen: null` steht dort ohne Erklärung. Jetzt kommt der Grund
     * als `details.sperre` mit, und das ist derselbe Satz, den die Seite ohnehin über dem Knopf zeigt.
     */
    if (error.code === "freigabe_blocked") {
        const sperre = String(error.details?.["sperre"] ?? "");
        const key = `admin.production.blocked.${sperre}`;
        if (isMessageKey(key)) return [{ key: key as MessageKey }];
    }
    // Discord-Einstellungen (WI-0255): Warum der Bot den Berichtskanal nicht nutzen kann, sagt der Server in `details.grund`.
    if (error.code === "discord_kanal_unbrauchbar" || error.code === "discord_kanal_nicht_pruefbar") {
        const kanal = t("admin.discord.einstellungen.field.kanalBericht");
        const grund = String(error.details?.["grund"] ?? "");
        const key =
            error.code === "discord_kanal_nicht_pruefbar"
                ? "admin.discord.error.kanalNichtPruefbar"
                : grund === "kein_textkanal"
                  ? "admin.discord.error.kanal.keinText"
                  : `admin.discord.error.kanal.${grund}`;
        if (isMessageKey(key)) return [{ key: key as MessageKey, params: { kanal } }];
    }
    // Die Abkühlzeit des Höhenmodells (WI-0279): ab wann der nächste Lauf geht.
    if (error.code === "terrain_cooldown") {
        const ab = new Date(String(error.details?.["ab"] ?? ""));
        const zeit = ab.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return [{ key: "admin.terrain.error.cooldown", params: { zeit } }];
    }
    const key = CODES[error.code];
    return [{ key: key ?? "auth.form.failed" }];
}

/** Das Datum, bis zu dem ein Link gilt, in der Sprache der Seite. */
export function untilText(iso: string, locale: string | undefined): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
