import type { AuditAction } from "../auth/audit.ts";
import type { SystemCommand } from "./system-cli.ts";

/**
 * Die Protokollpflicht der Systemsteuerung (WI-0127 SYS-15, SYS-0001 §9d.2): Jede Handlung schreibt GENAU EIN Ereignis, in derselben
 * Transaktion wie die Handlung, mit `operation_id` (Route) bzw. `cli:<Systembenutzer>` (Kommandozeile). Das gilt für Routen und
 * Kommandozeile, heute und für jedes künftige Paket (SYS-9 „Sicherung jetzt“, SYS-10/11 Inhaltsschalter, SYS-13 Höhenmodell).
 *
 * 🔴 Der Wächter: `apps/server/test/system-protokollpflicht.test.ts` verlangt für JEDE schreibende Route unter `/api/admin/system…` und
 * jeden schreibenden Befehl der Kommandozeile der Systemsteuerung eine Zeile hier, ruft jede Handlung einmal und zählt genau einen
 * neuen Eintrag ihrer Art. Eine neue Route oder ein neuer Befehl ohne Zeile macht ihn rot.
 *
 * 🪤 `sperre-loesen` ohne `--art` löst beide Sperren und schreibt dann je gelöster Sperre ein Ereignis (zwei Handlungen); der Wächter
 * ruft den Befehl mit `--art`.
 */
/**
 * Datenstücke eines angelegten Uploads (WI-0220 Schnitt 3): Ein Stück zu 8 MiB ist keine Handlung, sondern Daten einer Handlung, die
 * schon im Protokoll steht (Anlegen, `system.map_series_changed` mit `aktion: "hochladen"`) und deren Abschluss wieder eines schreibt
 * (`aktion: "zerlegen"`). Ein Ereignis je Stück wären 750 Einträge für ein Bild von 6 GB. Der Wächter verlangt, dass jede Route hier
 * ein `PUT` auf einen angelegten Upload ist und ohne angelegten Upload abweist.
 */
export const SYSTEM_ROUTE_DATENSTUECKE = ["PUT /api/admin/system/kartenserien/uploads/:id"] as const;

export const SYSTEM_ROUTE_EVENTS = {
    "POST /api/admin/system/mode": "system.mode_changed",
    "POST /api/admin/system/lock": "system.lock_changed",
    "POST /api/admin/system/queue": "system.queue_changed",
    "POST /api/admin/system/abgleiche/start": "system.sync_requested",
    "POST /api/admin/system/backup/start": "system.backup_triggered",
    // Der Abzug für lokal (WI-0251): Erstellen und Link auf Stage und Production („Abzug angestoßen“, „Abzug heruntergeladen“), Eingang und
    // Einspielen lokal.
    "POST /api/admin/system/abzug/erstellen": "backup.requested",
    "POST /api/admin/system/abzug/link": "backup.downloaded",
    "PUT /api/admin/system/abzug/eingang": "system.abzug_einspielen",
    "POST /api/admin/system/abzug/einspielen": "system.abzug_einspielen",
    // Den Abzug selbst abholen (WI-0251): Schlüssel anlegen und widerrufen (Stage, Production); lokal einen Schlüssel hinterlegen und holen.
    "POST /api/admin/system/abzug/schluessel": "system.abzug_schluessel",
    "POST /api/admin/system/abzug/schluessel/widerrufen": "system.abzug_schluessel",
    "POST /api/admin/system/abzug/quelle": "system.abzug_einspielen",
    "POST /api/admin/system/abzug/holen": "system.abzug_einspielen",
    "POST /api/admin/system/backup/wiederherstellung": "system.restore_requested",
    "POST /api/admin/system/content-switches": "system.content_switch_changed",
    // Kenngrößen der Wegfindung (WI-0153): je verstelltem oder zurückgesetztem Wert genau ein Ereignis.
    "POST /api/admin/system/wegfindung": "system.routing_setting_changed",
    // Der Knopf über den Panelen (Schnitt 6): ein Ereignis je Freigabe, mit der Zahl der Werte und dem Auftrag.
    "POST /api/admin/system/wegfindung/freigeben": "system.routing_settings_applied",
    // Karteneinstellungen (WI-0166): je verstellter oder zurückgesetzter Einstellung genau ein Ereignis.
    "POST /api/admin/system/karteneinstellungen": "system.map_setting_changed",
    // Kartenserien (WI-0220): je Handlung (Texte, Sichtbarkeit, Vorgabe, Reihe, Bild, Papierkorb) genau ein Ereignis.
    "POST /api/admin/system/kartenserien": "system.map_series_changed",
    // Hochladen (WI-0220 Schnitt 3): Anlegen und Abschluss je ein Ereignis; die Stücke dazwischen stehen in SYSTEM_ROUTE_DATENSTUECKE.
    "POST /api/admin/system/kartenserien/uploads": "system.map_series_changed",
    "POST /api/admin/system/kartenserien/uploads/:id/abschluss": "system.map_series_changed",
    // Übernahme nach Production (WI-0220 Schnitt 4): das Einreihen auf der Stage ein Ereignis, das Übernehmen auf Production eines.
    "POST /api/admin/system/kartenserien/production": "system.map_series_changed",
    // Zoombänder (WI-0221): ein „Übernehmen“ mit allen geänderten Spannen, genau ein Ereignis.
    "POST /api/admin/system/zoombaender": "system.zoom_band_changed",
    // Wettermodell (WI-0288 Stufe 2): je verstelltem oder zurückgesetztem Wert genau ein Ereignis.
    "POST /api/admin/system/wettermodell": "system.wettermodell_geaendert",
    "POST /api/admin/system/hoehenmodell/waehlen": "system.terrain_activated",
    "POST /api/admin/system/hoehenmodell/zurueck": "system.terrain_activated",
    "POST /api/admin/system/hoehenmodell/neu-rechnen": "system.terrain_recomputed",
    "POST /api/admin/system/hoehenmodell/abnehmen": "system.terrain_accepted",
    "POST /api/admin/system/hoehenmodell/entwurf": "system.terrain_draft_created",
    "POST /api/admin/system/hoehenmodell/entwurf/messen": "system.terrain_measure_requested",
    "POST /api/admin/system/hoehenmodell/entwurf/verwerfen": "system.terrain_draft_discarded",
    // „19 (Test)“ (WI-0240): jedes Setzen der Werte genau ein Ereignis.
    "POST /api/admin/system/hoehenmodell/test": "system.terrain_test_changed",
    // Neuigkeiten (WI-0139): Anlegen und jede Zustandsaenderung eines Eintrags.
    "POST /api/admin/system/news": "system.news_added",
    "POST /api/admin/system/news/:id": "system.news_changed",
    // Der Discord-Tagesbericht (WI-0255): die Routine schalten, eine heutige Zustellung von Hand wiederholen.
    "POST /api/admin/system/discord/routine": "system.discord_routine_changed",
    "POST /api/admin/system/discord/zustellungen/:id/wiederholen": "system.discord_zustellung_wiederholt",
    "POST /api/admin/system/discord/einstellungen": "system.discord_einstellungen_geaendert",
    // Das Panel Mailpostfach (WI-0268 C6c): die Routine von Abruf oder Versand schalten.
    "POST /api/admin/system/mail/routine": "system.community_mail_routine",
    // Production-Freigabe (FREIGABE-0001): Hin- und Rueckweg. Beide tragen das Release und den Stand davor.
    "POST /api/admin/system/production/release": "system.production_release",
    "POST /api/admin/system/production/rollback": "system.production_rollback",
    // Eine Nacht-Freigabe abbrechen (WI-0234): jeder aktive Betreiber, ohne Passkey.
    "POST /api/admin/system/production/abbrechen": "system.production_freigabe_abgebrochen",
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L; Routen nur lokal): Start mit Passkey, Abbrechen ohne.
    "POST /api/admin/system/release-test/starten": "system.release_test_gestartet",
    "POST /api/admin/system/release-test/abbrechen": "system.release_test_abgebrochen",
} as const satisfies Record<string, AuditAction>;

export const SYSTEM_COMMAND_EVENTS = {
    "betrieb-normal": "system.mode_changed",
    "betrieb-einschraenken": "system.mode_changed",
    "sperre-setzen": "system.lock_changed",
    "sperre-loesen": "system.lock_changed",
    "warteschlange-pausieren": "system.queue_changed",
    "warteschlange-fort": "system.queue_changed",
    "abgleich-starten": "system.sync_requested",
    "gelaende-waehlen": "system.terrain_activated",
    "kartenserie-uebernehmen": "system.map_series_changed",
} as const satisfies Record<
    Exclude<SystemCommand, "betrieb-zeigen" | "gelaende-zeigen" | "abgleich-zeigen">,
    AuditAction
>;
