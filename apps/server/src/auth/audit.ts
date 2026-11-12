import type { AuditBereich } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "./config.ts";
import type { Sql } from "./session-store.ts";

/**
 * Das Protokoll der Anmeldung und Verwaltung (Kap. 10.63, AUTH-0001 §5, ADR-0019). Die App-Rolle darf nur anhängen.
 *
 * 🔴 POSITIVLISTE je Handlung: In `details` landet nur, was hier für die Handlung steht. Nie ein Token, Passwort, OAuth-Code,
 * Einladungslink oder Hash; ein unbekannter Schlüssel wird verworfen und lässt die Tests scheitern (`AUDIT_STRICT`).
 *
 * 🪤 Wer hier einen Freitext ergänzt, der eine Person beschreibt (Name, Grund, Notiz, Bezeichnung), trägt ihn auch in die Tafel
 * `personal` von `avesmaps_auth.redact_person_events()` ein (neue Migration): Beim Auflösen eines Kontos wird er dort geschwärzt.
 * Freitext, den die handelnde Person über das System schreibt (ein Eintrag ohne betroffene Person), gehört in die Tafel `authored`.
 */
export const AUDIT_DETAIL_KEYS = {
    "login.success": ["method", "assurance"],
    "login.failure": ["method", "reason"],
    "login.throttled": ["method"],
    logout: [],
    "session.revoked": ["sessionId", "reason", "count"],
    "session.rotated": ["reason"],
    "confirm.success": ["method"],
    "invitation.created": ["role", "validDays", "note", "bound", "tokenHint", "sonderrollen", "grund"],
    "invitation.revoked": ["tokenHint"],
    "invitation.reissued": ["tokenHint", "previousHint"],
    "invitation.accepted": ["role", "method", "tokenHint"],
    "person.role_changed": ["from", "to", "revokedCapabilities", "restored", "revokedInvitations", "revokedLinks"],
    "person.locked": ["reason", "sessions", "revokedInvitations", "revokedLinks"],
    "person.unlocked": [],
    "person.renamed": ["from", "to"],
    // „Verantwortlich für:“ geändert (WI-0133): `via` `self` (die Person selbst) oder `operator` (ein Betreiber an einer anderen),
    // `cleared` beim Leeren. 🔴 Nie der Text selbst (Datensparsamkeit): So bleibt nichts davon stehen, wenn das Konto aufgelöst wird,
    // und `redact_person_events()` braucht keine Zeile dafür. Einordnung: Konten (SYS-0001 §9d.2, `person.*`).
    "person.responsibility_changed": ["via", "cleared"],
    // Bezeichnung gewählt (WI-0279 E10): Dass, nicht welche. 🔴 Nie die Form selbst, also auch nichts zu schwärzen.
    "person.bezeichnung_geaendert": [],
    // Konto aufgelöst (Kommandozeile, `dissolve.ts`): nur Zahlen und Namen von Anmeldewegen, Rechten und Umgebungen, nie ein Name.
    "person.departed": [
        "methods",
        "sessions",
        "passkeys",
        "links",
        "invitations",
        "revokedIssuedInvitations",
        "revokedIssuedLinks",
        "legacyMappings",
        "revokedCapabilities",
        "capabilityReasons",
        "revokedSonderrollen",
        "sonderrollenReasons",
        "environments",
        "redactedEvents",
        "redactedMedia",
        "redactedMap",
        "responsibility",
        "redactedKanal",
        "benachrichtigungen",
        "redactedCommunity",
    ],
    "access.revoked": ["role", "sessions", "revokedCapabilities", "revokedInvitations", "revokedLinks"],
    "capability.granted": ["capability", "reason"],
    "capability.revoked": ["capability", "reason"],
    // Sonderrollen (WI-0279): die Rolle aus dem Katalog, die Namen der Regionen; der Grund steht in der Tafel `personal` (0303).
    "sonderrolle.vergeben": ["sonderrolle", "regionen", "grund"],
    "sonderrolle.entzogen": ["sonderrolle", "regionen", "grund"],
    // Beim Einlösen einer Einladung: was hinzukam und was ein anderer inzwischen hatte (`regionalkanzler (Weiden)`).
    "sonderrolle.eingeladen": ["sonderrollen", "uebersprungen"],
    // Der Abgleich von Production (WI-0279 E9): nur Zahlen; was je Person geschah, steht in der Tafel.
    "sonderrolle.abgeglichen": ["neu", "entzogen", "ohneKonto", "ruht"],
    "password.set": ["via"],
    "password.changed": [],
    "password.disabled": ["failures"],
    "access_link.created": ["kind", "validHours"],
    "access_link.used": ["kind"],
    "discord.linked": ["discordUsername"],
    "discord.unlinked": [],
    "passkey.registered": ["label", "via", "backedUp"],
    "passkey.revoked": ["label", "reason", "count", "sessions"],
    "passkey.counter_regression": ["label"],
    "legacy.mapped": ["legacyName", "legacyUserId", "evidence"],
    "legacy.unmapped": ["legacyName", "legacyUserId"],
    "backup.requested": [],
    "backup.downloaded": ["name"],
    "recovery.started": ["via"],
    // Betriebszustand (WI-0127 SYS-2, SYS-0001 §4.5): Stellung `normal`/`restricted`, Sperre `map`/`system` mit `true`/`false`. Der
    // Grund ist Freitext der HANDELNDEN Person über das System; er steht in der Tafel `authored` von `redact_person_events()` (0087).
    "system.mode_changed": ["from", "to", "reason"],
    "system.lock_changed": ["lock", "from", "to", "reason"],
    // Die Warteschlange pausieren und fortsetzen (WI-0160): `from`/`to` als `true`/`false`, der Grund wie oben Freitext der
    // handelnden Person über das System (Tafel `authored` von `redact_person_events()`, Migration 0130).
    "system.queue_changed": ["from", "to", "reason"],
    // Abgleiche (WI-0127 SYS-14): die Quelle (`legacy`, `medien`) und die Kennung des eingereihten Jobs, kein Freitext. Ein System-
    // Ereignis (SYS-0001 §9d.2): je Start genau eines, über die Route wie über die Kommandozeile (`abgleich-starten`).
    "system.sync_requested": ["source", "job"],
    // „Sicherung jetzt“ (WI-0127 SYS-9, SYS-0001 §9e): nur die `operation_id` (Spalte), keine Einzelheiten. Nicht `backup.requested`:
    // das gehört zu `create_backup`, dem Kartendaten-Export.
    "system.backup_triggered": [],
    // Der Abzug für lokal wird eingespielt (WI-0251, nur lokal): die Kennung des Abzugs und der Schritt (`eingang`: die Datei liegt bereit, `start`:
    // das Ersetzen beginnt). Kein Freitext, kein Dateiname.
    "system.abzug_einspielen": ["kennung", "schritt"],
    // Der Abzugs-Schlüssel zum Abholen (WI-0251): `angelegt` (für wie viele Tage) oder `widerrufen`. Die Kennung des Schlüssels steht im Ziel, nie sein Wert.
    "system.abzug_schluessel": ["aktion", "tage"],
    // Karten herunterladen (WI-0280): Link oder Schlüssel angelegt, neu ausgestellt, zurückgenommen; ein Abruf; ein SVG-Abzug. Die Kennung, nie der Wert; „für wen“ bleibt
    // in der Tafel, das ist Freitext über Dritte.
    "system.karten_zugang": ["aktion", "art", "kennung", "tage", "karten"],
    "system.karten_abruf": ["weg", "kennung", "karten", "bytes"],
    "system.karten_svg": ["aktion", "art"],
    // Höhenmodell (WI-0127 SYS-13): Fassungen und Kennungen, kein Name. Der Grund ist Freitext der HANDELNDEN Person über das System; er steht
    // in der Tafel `authored` von `redact_person_events()` (Migration 0100).
    // Inhaltsschalter (WI-0127 SYS-10): Schlüssel und Stellung, kein Grund (Blatt B: kein Dialog, kein Grund). Ein System-Ereignis
    // (§9d.2), deshalb nicht `content.switch_changed` wie im Bauplan §4.2.
    "system.content_switch_changed": ["key", "from", "to"],
    // Kenngrößen der Wegfindung (WI-0153, Migration 0132): Kennung und Zahlen, kein Grund (wie der Inhaltsschalter: kein Dialog).
    // `from`/`to` sind Zahlen; `null` heißt „die Vorgabe des Registers“, also vorher nicht verstellt bzw. zurückgesetzt.
    "system.routing_setting_changed": ["key", "from", "to"],
    // Die Freigabe (WI-0153 Schnitt 6): wie viele Werte gerechnet werden und welcher `routing_reload` dafuer in der
    // Warteschlange steht. Kein Freitext, kein Wert - was verstellt wurde, steht in den Ereignissen davor.
    // `seegraph`: die Ableitung des Seegraphen, an der der Reload hängt (WI-0153 7c), sonst `null`.
    "system.routing_settings_applied": ["werte", "job", "seegraph"],
    // Karteneinstellungen (WI-0166, Migration 0134): Kennung und Werte, kein Grund. `from`/`to` sind eine Zahl oder ein Punkt
    // `{x, y}`; `null` heißt „die Vorgabe der Tafel“, also vorher nicht verstellt bzw. zurückgesetzt.
    "system.map_setting_changed": ["key", "from", "to"],
    // Kartenserien (WI-0220): welche Serie, welche Handlung, vorher, nachher. Bei Texten nur die Namen der geänderten Felder.
    "system.map_series_changed": ["series", "aktion", "from", "to"],
    // Zoombänder (WI-0221): wie viele Spuren und welche (Kennungen aus dem Katalog), keine Werte, kein Personenbezug.
    "system.zoom_band_changed": ["anzahl", "spuren"],
    // Wetter (WI-0288 Stufe 2, Migration 0326). Ein Preset: welches, `aktion` `werte` (mit den Kennungen der geänderten Werte, keine Zahlen) oder
    // `zeitpunkt` (der neue Tag, `null` unbestimmt, und mit welchem Preset getauscht wurde). Ein Icon: welches, `aktion` `angelegt` (mit Art),
    // `geaendert` (mit den Namen der geänderten Felder) oder `entfernt`; nie der Name. `materialisiert`: Diese Handlung hat die Vorgaben erst
    // in die Tafel geschrieben. Das Wettermodell wie die Wegfindung: Kennung und Zahlen, `null` heißt die Vorgabe.
    "system.wetter_preset_geaendert": ["preset", "aktion", "werte", "tag", "getauscht", "materialisiert"],
    "system.wetter_symbol_geaendert": ["symbol", "aktion", "art", "felder", "materialisiert"],
    "system.wettermodell_geaendert": ["key", "from", "to"],
    // WikiSync (WI-0253 D-1): welcher Bereich auf wen umgeschaltet wurde (nur noch in Zeilen vor dem Cutoff 2026-11-02, Katalog bleibt für sie), welche Aufträge angestoßen wurden (Bereiche, Lauf der Vorschau, Kennung des Auftrags) und was
    // zurückgenommen wurde. Kennungen und Wörter aus dem Katalog, kein Freitext und kein Personenbezug; WER es war, steht in der Spalte des Akteurs. Die Übernahme selbst
    // schreibt die Jobs-Rolle, die dieses Schema nie sieht: Ihr Auslöser steht in der Operation an der Karte (`map_operation`) und in `wikisync_uebernahme`.
    "system.wikisync_bereich_geschaltet": ["bereich", "von", "nach"],
    "system.wikisync_vorschau_angestossen": ["bereiche", "job"],
    "system.wikisync_uebernahme_angestossen": ["bereiche", "lauf", "job"],
    "system.wikisync_zurueckgenommen": ["bereich", "bereiche", "lauf", "job", "objekt"],
    // Der Wiki-Teil (WI-0253 D-2) und der Vergleich eines Artikels: Bereiche, Lauf und Kennung des Auftrags; den Titel des Artikels trägt der Auftrag, nicht das Ereignis.
    "system.wikisync_wiki_teil_angestossen": ["bereiche", "lauf", "job"],
    "system.wikisync_artikel_angestossen": ["job"],
    // „Dump holen“ (WI-0253 §22): nur die Kennung des Auftrags für Claudios Korridor; Wer, steht in der Spalte des Akteurs.
    "system.wikisync_dump_holen_angestossen": ["job"],
    // Die zwei Tafeln des Kanon-Etiketts (WI-0253 UI-1): wie viele Zeilen und welche (`namensraum:222`, `objektart:place`), keine Werte.
    "system.kanon_tafel_geaendert": ["anzahl", "zeilen"],
    // Die Begriffstafel der Regelableitung (WI-0253 §24): wie viele Wörter und welche (Wörter des Wikis, höchstens 50), keine Pillen und kein Personenbezug.
    "system.wikisync_begriffe_geaendert": ["anzahl", "woerter"],
    "system.terrain_activated": ["from", "to", "reason", "rueckweg", "job"],
    // „Gelände neu rechnen“ (Betreiber 2026-10-17, Topographie F8): welche Fassung, welche Kette. Kein Grund.
    "system.terrain_recomputed": ["version", "job"],
    "system.terrain_accepted": ["version", "reason"],
    "system.terrain_draft_created": ["draft", "base", "regler", "reason"],
    "system.terrain_measure_requested": ["draft", "job"],
    "system.terrain_draft_discarded": ["draft"],
    "system.terrain_test_changed": ["version", "revision", "reason", "job"],
    // Betreiber-Kanal (WI-0124, KANAL-0001 §3.1): „Meldung jetzt löschen“ und „Bild entfernen“ mit genau der OPS-ID, ohne Titel, Text
    // oder Bild („Protokolleintrag ohne Inhalt“).
    "system.kanal_purged": ["ops"],
    "system.kanal_image_removed": ["ops"],
    // Einen Vorgang aus Discord freigeben (WI-0255 Paket 2): OPS-ID und an wen (`claudio`, `claudia`, `regel` = nach der Kategorie), nie Text oder Melder.
    // An die Community weitergeleitet (WI-0297): `an` ist `community`, dazu die COM-Nummer in Production.
    "system.kanal_gesichtet": ["ops", "an", "com"],
    // Community (WI-0268): COM-Nummer und, beim Abschließen, das Ergebnis aus dem festen Katalog; nie Text, Begründung, Name oder Kontakt.
    "system.community_abgeschlossen": ["com", "ergebnis"],
    "system.community_wiedereroeffnet": ["com"],
    "system.community_papierkorb": ["com"],
    "system.community_personenbezug_geloescht": ["com"],
    // Mails (WI-0268 C4): COM-Nummer, beim Archivieren und Antworten das Ergebnis aus dem festen Katalog, beim Weiterführen die Nummer der neuen Meldung; nie Adresse, Name oder Text.
    "system.community_antwort_gesendet": ["com", "ergebnis", "weg"],
    // Mailweg (WI-0268 C6a): eine neue Mail an eine freie Adresse trägt COM-Nummer und den Empfänger NUR als Hash (die ersten 16 Zeichen von sha256 der Adresse in Kleinschrift); Erneut senden nur die Nummer.
    "system.community_mail_neu": ["com", "empfaenger"],
    "system.community_mail_erneut": ["com"],
    "system.community_archiviert": ["com", "ergebnis"],
    "system.community_als_meldung": ["com", "meldung"],
    // Verknüpfungen (WI-0268 C7): COM-Nummer und die Kennung der verknüpften Operation bzw. die OPS-Nummer des Kanal-Vorgangs; nie Titel, Nachricht, Name oder Text.
    "system.community_korrektur_verknuepft": ["com", "operation"],
    "system.community_an_kanal": ["com", "ops"],
    // Legacy-Meldungen (WI-0268 C9): einmalige Übernahme der offenen Meldungen aus Legacy; nur Zahlen und das Zeichen, dass der Betreiber den Lauf ausdrücklich freigegeben hat (das Zitat steht in der Ausgabe des Werkzeugs, nicht hier); nie Name, Text oder Nummer.
    "system.community_legacy_uebernommen": ["geliefert", "angelegt", "vorhanden", "ausgefiltert", "zitat"],
    // Bewertungen (WI-0269, Fachkonzept §14.8): die öffentliche Kennung der Bewertung und der Zustand danach, beim Verbergen der Grund aus dem festen
    // Katalog; nie Name, Text, Datum oder Sterne.
    "system.community_bewertung_gesichtet": ["bewertung", "zustand"],
    "system.community_bewertung_freigegeben": ["bewertung", "zustand"],
    "system.community_bewertung_verborgen": ["bewertung", "zustand", "grund"],
    "system.community_bewertung_eingeblendet": ["bewertung", "zustand"],
    "system.community_bewertung_geloescht": ["bewertung", "zustand"],
    // Kartenvorschläge (WI-0275): die öffentliche Kennung des Vorschlags und der Zustand danach; nie Titel, Link, Name oder der Grund der Ablehnung.
    "system.community_kartenvorschlag_abgelehnt": ["vorschlag", "zustand"],
    "system.community_kartenvorschlag_angenommen": ["vorschlag", "zustand", "karte"],
    // Social Hub (WI-0270, Fachkonzept §15.9): die SOC-Nummer und, wo ein Kanal betroffen ist, der Kanal aus dem festen Katalog; nie Titel, Text oder Hashtags.
    "system.social_vorgelegt": ["beitrag"],
    "system.social_freigegeben": ["beitrag", "kanal"],
    "system.social_aenderung_veroeffentlicht": ["beitrag", "kanal"],
    "system.social_zurueckgenommen": ["beitrag", "kanal"],
    "system.social_verworfen": ["beitrag"],
    "system.social_erneut_gesendet": ["beitrag", "kanal"],
    // Fremde Kanäle des Social Hubs (WI-0268 C12a, Fachkonzept §15.9): der Kanal aus dem festen Katalog und nur Zahlen oder ein Schalter; nie ein Zugangsschlüssel, nie die Adresse der Instanz, nie ein Text.
    // `notschalter`: `an` ist der neue Stand. `grenzen`: Zeichengrenze und Länge einer Adresse, wie die Instanz sie nannte. `geprueft`: das Werkzeug `social:pruefen` nach dem Zuruf des Betreibers (der Wortlaut
    // steht in seiner Ausgabe, nicht hier): Zahl der Fälle, wie viele übereinstimmten, ob der Kanal danach freigeschaltet ist.
    "system.social_kanal_notschalter": ["kanal", "an"],
    "system.social_kanal_grenzen": ["kanal", "zeichen", "adresse"],
    "system.social_kanal_geprueft": ["kanal", "faelle", "uebereinstimmend", "freigeschaltet", "zitat"],
    "system.social_hashtags": ["anzahl", "vorausgewaehlt"],
    // Wiederherstellungsantrag (WI-0124 KANAL-0001 W10, K5): OPS-ID, welche Sicherung, welcher Umfang; der Grund steht im Vorgang, nicht hier.
    "system.restore_requested": ["ops", "sicherung", "umfang"],
    // Neuigkeiten (WI-0139): was angelegt, freigegeben, gebessert oder versteckt wurde — nie der Text selbst. Wer ihn lesen will, liest
    // den Eintrag; das Protokoll sagt, wer wann was mit ihm tat.
    "system.news_added": ["datum", "rubrik"],
    "system.news_changed": ["von", "nach"],
    // Discord-Tagesbericht (WI-0255): die Routine an oder aus, und welche Zustellung von welchem Stand aus wiederholt wurde — nie ihr Text.
    "system.discord_routine_changed": ["von", "nach"],
    "system.discord_zustellung_wiederholt": ["tag", "von"],
    // Die Einstellungen des Discord-Berichts (WI-0255): welche Felder sich änderten (`prompt`, `uhrzeit`, `berichtskanal`), bei Uhrzeit und
    // Berichtskanal der neue Wert (`umgebung`: zurück auf die Vorgabe der Umgebung) — nie der Text des Prompts. Kanalkennungen sind kein Geheimnis.
    "system.discord_einstellungen_geaendert": ["felder", "uhrzeit", "berichtskanal"],
    // Das Panel Mailpostfach (WI-0268 C6c): welche Routine (`abruf`, `versand`), `an`/`aus` davor und danach, und wie viele wartende Mails beim Wiedereinschalten des Versands nachgereiht wurden — nie eine Adresse, ein Betreff oder ein Text.
    "system.community_mail_routine": ["art", "von", "nach", "nachgereiht"],
    // Production-Freigabe (FREIGABE-0001): welches Release, von welchem aus. Die Akte ist der Vorgang im Kanal.
    "system.production_release": ["release", "von"],
    "system.production_rollback": ["release", "von"],
    // Eine Nacht-Freigabe abgebrochen (WI-0234): welches Release freigegeben war.
    "system.production_freigabe_abgebrochen": ["release"],
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L): gestartet und abgebrochen, je mit dem geprüften Commit (die ersten zwölf Stellen);
    // `wiederholen` steht dabei, wenn nur die roten Teile eines früheren Laufs neu liefen („Rote Teile wiederholen“). Seit WI-0248 ist der Start die
    // Production-Freigabe: `freigabe` ist ihre Kennung (`RT-…`, dieselbe wie in `refs/notes/release-auftrag`), kein Name, kein Text. Der Volltest
    // (WI-0264) gibt nichts frei: Er trägt `volltest: true` statt `freigabe`.
    "system.release_test_gestartet": ["commit", "wiederholen", "freigabe", "volltest"],
    "system.release_test_abgebrochen": ["commit", "freigabe", "volltest"],
} as const satisfies Record<string, readonly string[]>;

export type AuditAction = keyof typeof AUDIT_DETAIL_KEYS;

/**
 * Wo jede Ereignisart im Protokoll steht (WI-0127 SYS-15, SYS-0001 §9d.2): EIN Protokoll, zwei Filter. `konten` zeigt die
 * Kontenverwaltung, `system` die Systemsteuerung (mit der Rolle Betreiber dort dazu alles). Eine neue Art ohne Zeile hier hält den
 * Typecheck an (`Record<AuditAction, …>`), und `system-protokollpflicht.test.ts` prüft die Präfixregel aus §9d.2.
 */
export const AUDIT_BEREICH = {
    "login.success": "konten",
    "login.failure": "konten",
    "login.throttled": "konten",
    logout: "konten",
    "session.revoked": "konten",
    "session.rotated": "konten",
    "confirm.success": "konten",
    "invitation.created": "konten",
    "invitation.revoked": "konten",
    "invitation.reissued": "konten",
    "invitation.accepted": "konten",
    "person.role_changed": "konten",
    "person.locked": "konten",
    "person.unlocked": "konten",
    "person.renamed": "konten",
    "person.responsibility_changed": "konten",
    "person.bezeichnung_geaendert": "konten",
    "person.departed": "konten",
    "access.revoked": "konten",
    "capability.granted": "konten",
    "capability.revoked": "konten",
    "sonderrolle.vergeben": "konten",
    "sonderrolle.entzogen": "konten",
    "sonderrolle.eingeladen": "konten",
    "sonderrolle.abgeglichen": "konten",
    "password.set": "konten",
    "password.changed": "konten",
    "password.disabled": "konten",
    "access_link.created": "konten",
    "access_link.used": "konten",
    "discord.linked": "konten",
    "discord.unlinked": "konten",
    "passkey.registered": "konten",
    "passkey.revoked": "konten",
    "passkey.counter_regression": "konten",
    "legacy.mapped": "konten",
    "legacy.unmapped": "konten",
    "backup.requested": "system",
    "backup.downloaded": "system",
    "recovery.started": "system",
    "system.mode_changed": "system",
    "system.lock_changed": "system",
    "system.queue_changed": "system",
    "system.sync_requested": "system",
    "system.backup_triggered": "system",
    "system.abzug_einspielen": "system",
    "system.abzug_schluessel": "system",
    "system.karten_zugang": "system",
    "system.karten_abruf": "system",
    "system.karten_svg": "system",
    "system.content_switch_changed": "system",
    "system.routing_setting_changed": "system",
    "system.routing_settings_applied": "system",
    "system.map_setting_changed": "system",
    "system.map_series_changed": "system",
    "system.zoom_band_changed": "system",
    "system.wetter_preset_geaendert": "system",
    "system.wetter_symbol_geaendert": "system",
    "system.wettermodell_geaendert": "system",
    "system.wikisync_bereich_geschaltet": "system",
    "system.wikisync_vorschau_angestossen": "system",
    "system.wikisync_uebernahme_angestossen": "system",
    "system.wikisync_zurueckgenommen": "system",
    "system.wikisync_wiki_teil_angestossen": "system",
    "system.wikisync_artikel_angestossen": "system",
    "system.wikisync_dump_holen_angestossen": "system",
    "system.kanon_tafel_geaendert": "system",
    "system.wikisync_begriffe_geaendert": "system",
    "system.terrain_activated": "system",
    "system.terrain_recomputed": "system",
    "system.terrain_accepted": "system",
    "system.terrain_draft_created": "system",
    "system.terrain_measure_requested": "system",
    "system.terrain_draft_discarded": "system",
    "system.terrain_test_changed": "system",
    "system.kanal_purged": "system",
    "system.kanal_image_removed": "system",
    "system.kanal_gesichtet": "system",
    "system.community_abgeschlossen": "system",
    "system.community_wiedereroeffnet": "system",
    "system.community_papierkorb": "system",
    "system.community_personenbezug_geloescht": "system",
    "system.community_antwort_gesendet": "system",
    "system.community_mail_neu": "system",
    "system.community_mail_erneut": "system",
    "system.community_archiviert": "system",
    "system.community_als_meldung": "system",
    "system.community_korrektur_verknuepft": "system",
    "system.community_an_kanal": "system",
    "system.community_legacy_uebernommen": "system",
    "system.community_bewertung_gesichtet": "system",
    "system.community_bewertung_freigegeben": "system",
    "system.community_bewertung_verborgen": "system",
    "system.community_bewertung_eingeblendet": "system",
    "system.community_bewertung_geloescht": "system",
    "system.community_kartenvorschlag_abgelehnt": "system",
    "system.community_kartenvorschlag_angenommen": "system",
    "system.social_vorgelegt": "system",
    "system.social_freigegeben": "system",
    "system.social_aenderung_veroeffentlicht": "system",
    "system.social_zurueckgenommen": "system",
    "system.social_verworfen": "system",
    "system.social_erneut_gesendet": "system",
    "system.social_kanal_notschalter": "system",
    "system.social_kanal_grenzen": "system",
    "system.social_kanal_geprueft": "system",
    "system.social_hashtags": "system",
    "system.restore_requested": "system",
    "system.news_added": "system",
    "system.news_changed": "system",
    "system.discord_routine_changed": "system",
    "system.discord_zustellung_wiederholt": "system",
    "system.discord_einstellungen_geaendert": "system",
    "system.community_mail_routine": "system",
    "system.production_release": "system",
    "system.production_rollback": "system",
    "system.production_freigabe_abgebrochen": "system",
    "system.release_test_gestartet": "system",
    "system.release_test_abgebrochen": "system",
} as const satisfies Record<AuditAction, AuditBereich>;

/** Die Ereignisarten eines Bereichs, für den Filter des Protokolls. */
export function actionsIn(bereich: AuditBereich): AuditAction[] {
    return (Object.keys(AUDIT_BEREICH) as AuditAction[]).filter((action) => AUDIT_BEREICH[action] === bereich);
}

export interface AuditEvent {
    environment: AuthEnvironment;
    action: AuditAction;
    actorKind: "person" | "cli" | "system" | "anonymous";
    actorPersonId?: string | null | undefined;
    actorLabel?: string | null | undefined;
    targetPersonId?: string | null | undefined;
    targetRef?: string | null | undefined;
    details?: Record<string, unknown> | undefined;
    operationId?: string | null | undefined;
    requestHash?: Buffer | null | undefined;
    receipt?: unknown;
    sessionId?: string | null | undefined;
    recovery?: boolean | undefined;
    ipPrefix?: string | null | undefined;
    clientLabel?: string | null | undefined;
}

/** In Tests scheitert ein unbekannter Schlüssel laut; im Betrieb wird er nur verworfen. */
const AUDIT_STRICT = process.env["VITEST"] !== undefined;

export function filterDetails(action: AuditAction, details: Record<string, unknown> = {}): Record<string, unknown> {
    const allowed = new Set<string>(AUDIT_DETAIL_KEYS[action]);
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        if (allowed.has(key)) kept[key] = value;
        else if (AUDIT_STRICT) throw new Error(`Protokoll ${action}: Schlüssel ${key} steht nicht in der Positivliste`);
    }
    return kept;
}

export async function recordEvent(sql: Sql, event: AuditEvent): Promise<void> {
    await sql`
        INSERT INTO avesmaps_auth.security_event
            (environment, actor_kind, actor_person_id, actor_label, action, target_person_id, target_ref, details,
             operation_id, request_hash, receipt, session_id, recovery, ip_prefix, client_label)
        VALUES (${event.environment}, ${event.actorKind}, ${event.actorPersonId ?? null}, ${event.actorLabel ?? null},
                ${event.action}, ${event.targetPersonId ?? null}, ${event.targetRef ?? null},
                ${sql.json(filterDetails(event.action, event.details) as never)}, ${event.operationId ?? null},
                ${event.requestHash ?? null}, ${event.receipt === undefined ? null : sql.json(event.receipt as never)},
                ${event.sessionId ?? null}, ${event.recovery ?? false}, ${event.ipPrefix ?? null}, ${event.clientLabel ?? null})
    `;
}
