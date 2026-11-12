import type { ViewerCapability } from "../viewer.ts";

/**
 * Der Rechtekatalog (WI-0120, AUTH-0001 §7 und §11; Betreiber 2026-10-09, ADR-0013 v3, D5 und D2 B′).
 *
 * 🔴 EINE Stelle für Server, Oberfläche und Tests (Kap. 7.49, Ultra-Review R-02). Rollen sind Vorlagen, die Wahrheit ist
 * die Capability. Kein Code fragt „ist Admin?“; er fragt nach der Capability, die er braucht.
 *
 * - Fünf Rollen in fester Stufenfolge. Besucher haben keine Rolle (kein Konto).
 * - Jede Capability nennt die niedrigste Rolle, die sie aus ihrer Vorlage hat, und die Sicherheitsstufe, die eine Session dafür
 *   braucht (R Redaktion, V Verwaltung, S System; §11.2).
 * - Sonderrechte (`grantable`) folgen nicht aus der Rolle Admin: Der Betreiber teilt sie einzelnen Admins zu (§7.3); er hat sie
 *   selbst aus seiner Rolle. So hängt kein Systemschalter an einer einzigen Person.
 */
export const ROLES = ["tester", "reviewer", "editor", "admin", "operator"] as const;
export type Role = (typeof ROLES)[number];

/** Rang einer Rolle; höher darf mehr. */
export function roleRank(role: Role): number {
    return ROLES.indexOf(role);
}

export function isRole(value: string): value is Role {
    return (ROLES as readonly string[]).includes(value);
}

/**
 * Sicherheitsstufe, die eine Capability verlangt (§11.2):
 * - `r` Redaktion: jede gültige Session.
 * - `v` Verwaltung: Session mit zweitem Faktor oder Notzugang, für die ganze Laufzeit der Session; eine Frist des zweiten Faktors
 *   gibt es nicht (Betreiber 2026-10-10). Der zweite Faktor ist allein der Passkey, nach Passwort wie nach Discord; Discord-2FA
 *   zählt nicht (Betreiber 2026-10-10: „4. B“).
 * - `s` System: wie `v` und dazu ein frischer Passkey-Nachweis unmittelbar vor der Handlung; eine Discord-Sitzung genügt nie.
 */
export type Assurance = "r" | "v" | "s";

export interface CapabilitySpec {
    /** Niedrigste Rolle, die die Capability aus ihrer Vorlage hat. */
    readonly minRole: Role;
    readonly assurance: Assurance;
    /** Sonderrecht: zusätzlich einzeln zuteilbar an Admins (nur durch `grant_special_capabilities`). */
    readonly grantable?: true;
}

export const CAPABILITIES = {
    // Editor-Ansicht, heute `ViewerCapability` (viewer.ts)
    view_editor_series: { minRole: "tester", assurance: "r" },
    view_flow_directions: { minRole: "tester", assurance: "r" },
    search_sea_route_names: { minRole: "tester", assurance: "r" },
    pin_selection: { minRole: "tester", assurance: "r" },
    use_editor_menu: { minRole: "reviewer", assurance: "r" },
    // Redaktion
    moderate_submissions: { minRole: "reviewer", assurance: "r" },
    // Die Community moderieren (WI-0268, Fachkonzept WI-0263 §9): Vorgänge in den Papierkorb legen und zurückholen, die Zuständigkeit anderer
    // setzen und den Personenbezug eines Vorgangs löschen (letzteres mit frischem Passkey an der Route). Lesen und Bearbeiten bleibt
    // `moderate_submissions`; dieses Recht kommt nur obendrauf. Kein Sonderrecht: ab Admin aus der Vorlage, Stufe V wie alles ab Admin.
    moderate_community: { minRole: "admin", assurance: "v" },
    // Die Mails der Community (WI-0268 C4, Fachkonzept WI-0263 §9, Entscheidung E3, Vali 2026-10-31: „Die Betreiber und Social-Media-Manager (rolle, die noch kommt)“):
    // Anfragen und Mails enthalten Namen und Adressen, darum lesen sie nur die Betreiber (der Social-Media-Manager kommt mit dem Rollenstrang, Weg B der Rollen-Discovery) - nicht
    // jeder, der Meldungen bearbeitet. `read_mailbox` öffnet den Reiter Mails und liest Anfragen samt Absender; `answer_community` schreibt nach außen (antworten, später Mails).
    // Kein Sonderrecht: ab Betreiber aus der Vorlage, Stufe V wie alles ab Admin.
    read_mailbox: { minRole: "operator", assurance: "v" },
    answer_community: { minRole: "operator", assurance: "v" },
    // Eine NEUE Mail an eine freie Adresse schreiben (WI-0268 C6a, Fachkonzept WI-0263 §9, Rückmeldung Vali 2026-10-30): eine Antwort geht nur an die Adresse des Vorgangs, eine neue Mail an irgendeine
    // - ein anderes Risiko, darum ein eigenes Recht, später einzeln zuteilbar. Kein Sonderrecht: ab Betreiber aus der Vorlage, Stufe V wie alles ab Admin. Dazu eine Tagesgrenze je Person.
    send_new_mail: { minRole: "operator", assurance: "v" },
    // Die Medienverwaltung öffnen und ihre privaten Angaben lesen (Prompt, Rechtenotiz, Belege, Ingest-Akteur, private
    // Speicherangaben; WI-0068, Betreiber 2026-10-09 zum Mockup-Blatt, Frage 1): ab Reviewer, Stufe R. Jeder MAM-Lesepfad
    // verlangt sie (`apps/server/src/routes/media-editor.ts`); die Rolle prüft kein Code.
    view_media_private: { minRole: "reviewer", assurance: "r" },
    edit_map_objects: { minRole: "editor", assurance: "r" },
    edit_map_geometry: { minRole: "editor", assurance: "r" },
    manage_sources: { minRole: "editor", assurance: "r" },
    upload_media: { minRole: "editor", assurance: "r" },
    review_media_rights: { minRole: "editor", assurance: "r" },
    // Einzelbild-Notaus im MAM (WI-0119 F2, AUTH-0001 §7.2; Betreiber 2026-10-10: „Normale Rechteprüfung soll nicht jedes Mal
    // einen Passkey verlangen“): eine eigene Capability der Stufe S, damit `review_media_rights` ohne Passkey bleibt. Sie steht
    // seit SYS-0 (WI-0127) im Katalog; eine Wirkung hat sie erst mit der Operation aus WI-0068.
    suspend_media_publication: { minRole: "editor", assurance: "s" },
    publish_media: { minRole: "editor", assurance: "r" },
    social_communication: { minRole: "editor", assurance: "r" },
    view_own_jobs: { minRole: "editor", assurance: "r" },
    // Verwaltung
    view_operations: { minRole: "admin", assurance: "v" },
    read_audit: { minRole: "admin", assurance: "v" },
    manage_people: { minRole: "admin", assurance: "v" },
    manage_invitations: { minRole: "admin", assurance: "v" },
    assign_roles: { minRole: "admin", assurance: "v" },
    create_backup: { minRole: "admin", assurance: "v" },
    manage_display_settings: { minRole: "admin", assurance: "v" },
    // System: Leitung (Betreiber) und Sonderrechte
    assign_admin: { minRole: "operator", assurance: "s" },
    grant_special_capabilities: { minRole: "operator", assurance: "s" },
    // Einrichtungslink für den ersten Passkey ausstellen, alle Passkeys einer Person widerrufen (§11.4)
    manage_passkeys: { minRole: "operator", assurance: "s" },
    // Medien endgültig löschen (nur unreferenziert, nach der Vorprüfung im MAM) und Freigaberegeln anlegen oder widerrufen
    // (Betreiberzitat bleibt Pflicht): nur die Betreiber-Vorlage, Stufe S (WI-0068, Betreiber 2026-10-09, Frage 1). Keine
    // Sonderrechte: Ein Admin bekommt sie auch nicht zugeteilt. Eine Wirkung haben sie erst mit den Operationen aus WI-0068.
    delete_media: { minRole: "operator", assurance: "s" },
    manage_media_rules: { minRole: "operator", assurance: "s" },
    // Die Lizenz eines Community-Uploads (Reisebild, Kartenvorschlag) ändern (Betreiber 2026-11-06, WI-0282: „die lizenz von bilder die nutzer
    // hochladen darf nicht geändert werden- nur durch den betreiber“). Nur die Betreiber-Vorlage, kein Sonderrecht; freigeben dürfen Editoren.
    edit_community_license: { minRole: "operator", assurance: "v" },
    // „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17): ein Lauf über den Bestand, nur die
    // Betreiber-Vorlage, Stufe S (§21; Betreiber 2026-10-11: „Auf Stage drückt den Klick der Betreiber selbst“). Die einzelne
    // Zusammenführung bleibt bei `upload_media`.
    merge_media_all: { minRole: "operator", assurance: "s" },
    // Den Legacy-Zug und die Medien aus Legacy in der Verwaltung starten („Abgleiche“, WI-0127 SYS-14): nur die Betreiber-Vorlage,
    // kein Sonderrecht (Betreiber 2026-10-10: „editoren dürfen nicht den legacy zug starten, das dürfen nur betreiber“). Stufe V wie
    // jede Verwaltungshandlung, ohne frischen Passkey: Ein Zug sperrt niemanden aus, und der nächste Zug überschreibt ihn.
    run_legacy_sync: { minRole: "operator", assurance: "v" },
    // Einen Legacy-Zug je Kategorie in PRODUCTION auslösen („Legacy-Zug: Landschaften / Wege / Orte“, WI-0141, Handover
    // 2026-10-13). Eigenes Recht und Stufe S, weil die Begründung für Stufe V hier nicht gilt: Dieser Zug ersetzt die Tafeln
    // seiner Kategorie in der LESEKARTE, die Besucher sehen — „der nächste Zug überschreibt ihn“ stimmt dann nicht mehr. Claudio
    // verlangt den Passkey im Auftrag („nur Rolle Betreiber, mit Passkey“); senkt der Betreiber ihn auf `v`, bleibt alles andere.
    run_legacy_zug: { minRole: "operator", assurance: "s" },
    // Den Production-Zug auf der STAGE auslösen („Production-Zug holen“, WI-0144, Betreiber 2026-10-14: „für die stage ist
    // production die einzige wahrheit“). Eigenes Recht und Stufe S aus demselben Grund wie `run_legacy_zug`: Dieser Zug ersetzt
    // die Kartendaten einer ganzen Umgebung — Daten, Kacheln, Medien —, also stimmt „der nächste Zug überschreibt ihn“ nicht.
    // Eigenes Recht, damit das Protokoll den Legacy-Zug und den Production-Zug auseinanderhält.
    run_production_pull: { minRole: "operator", assurance: "s" },
    // Einen Abzug von Stage oder Production LOKAL einspielen („Abzug einspielen“, WI-0251; Vali 2026-10-24: „ja von stage und production,
    // aber ohne die accounts, statistiken und alle kartendaten auch“). Nur die Betreiber-Vorlage, Stufe S wie der Production-Zug: Es ersetzt
    // die Kartendaten der lokalen Entwicklungsdatenbank. Die Route gibt es nur auf dem Entwicklungsrechner. Das Erstellen und Herunterladen
    // eines Abzugs auf Stage und Production hängt an `create_backup` („Kartendaten-Export“, ADR-0013).
    run_abzug_einspielen: { minRole: "operator", assurance: "s" },
    // „Sicherung jetzt“ in der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §9e, Vertrag mit Claudio): nur die Betreiber-Vorlage, Stufe V.
    // Eine zusätzliche Sicherung überschreibt nichts und spielt nichts zurück; Claudios Seite drosselt. Nicht `create_backup` (der
    // Kartendaten-Export).
    run_backup: { minRole: "operator", assurance: "v" },
    // „Verantwortlich für:“ bei jeder Person setzen (WI-0133, Betreiber 2026-10-10: „das allepersonen mit account für sich (und den den
    // betreibern) editiere können“): nur die Betreiber-Vorlage, kein Sonderrecht, Stufe V wie jede Verwaltungshandlung. Den eigenen
    // Eintrag ändert jede Person ohne dieses Recht im Konto (`/api/account/responsibility`, nur Sitzung).
    set_responsibility: { minRole: "operator", assurance: "v" },
    // Der Betreiber-Kanal (WI-0124, KANAL-0001 §4.1; Betreiber 2026-10-11, Frage 2 = B: „B Thomas ist Betreiber. eigener kanal. admins
    // brauchen es (noch nicht), freischalten kann man immer noch.“): lesen, melden, antworten, Bilder, abnehmen, wieder öffnen, löschen.
    // Nur die Betreiber-Vorlage, kein Sonderrecht; Stufe V ohne frischen Passkey (W9, passt zu E5 „alle 5 min passkey ist zuviel“).
    use_operator_channel: { minRole: "operator", assurance: "v" },
    // Im eingeschränkten Betrieb hineinkommen ist Stufe V, nicht S (WI-0119 E5 A, SYS-0001 W4; Betreiber 2026-10-09: „alle 5 min
    // passkey ist zuviel“). Den frischen Passkey verlangt das Umschalten über `manage_system_settings`, nicht das Hineinkommen.
    access_restricted_mode: { minRole: "operator", assurance: "v", grantable: true },
    manage_system_settings: { minRole: "operator", assurance: "s", grantable: true },
    request_restore: { minRole: "operator", assurance: "s", grantable: true },
    // Das Höhenmodell (WI-0127 SYS-13, SYS-0001 §9c.12 Frage 3 B): Entwürfe anlegen und messen (Stufe V); Wählen, Zurück und Abnehmen
    // verlangen an der Route zusätzlich den frischen Passkey (Stufe S im Moment, wie §4.1). Ein Sonderrecht, das der Betreiber zuteilt.
    manage_terrain_recipe: { minRole: "operator", assurance: "v", grantable: true },
    // Die Kartenserien (WI-0220): Namen, Texte, Sichtbarkeit, Vorgabe, Reihenfolge, Bild im Fächer, Papierkorb; später Hochladen und
    // Ersetzen. Jede Handlung verlangt an der Route den frischen Passkey (Stufe S im Moment). Ein Sonderrecht, das der Betreiber
    // zuteilt, wie das Höhenmodell: Eine Kartenserie ändert, was jeder Besucher sieht.
    manage_map_series: { minRole: "operator", assurance: "v", grantable: true },
    // Die Neuigkeiten (WI-0139): einen Entwurf der täglichen Routine freigeben, einen Satz bessern, einen Eintrag verstecken und
    // einen eigenen anlegen. Stufe V, nicht S: Es ist redaktionelle Arbeit an öffentlichem Text, kein Systemschalter — und es passiert
    // täglich, da wäre ein frischer Passkey je Handlung zuviel (wie E5, „alle 5 min passkey ist zuviel“). Ein Sonderrecht, damit der
    // Betreiber es einem Admin geben kann, ohne ihm den Betrieb zu öffnen. 🔴 Gelöscht wird nie, auch mit diesem Recht nicht.
    manage_news: { minRole: "operator", assurance: "v", grantable: true },
    // Die fremden Kanäle des Social Hubs verwalten (WI-0268 C12a, Fachkonzept §15.7): den Notschalter eines Kanals setzen und lösen und seine Grenzen neu lesen. Freigeben und Senden bleibt bei `manage_news`;
    // dieses Recht schaltet dagegen ab und an, wohin der Hub überhaupt senden darf. Stufe S (frischer Passkey unmittelbar davor), nur die Betreiber-Vorlage, kein Sonderrecht: Ein Admin bekommt es auch zugeteilt nicht.
    manage_social_channels: { minRole: "operator", assurance: "s" },
    // Karten herunterladen (WI-0280; Vali 2026-11-05: „karten herunterladen ab editoren mit der stellung kartograph freischalten, sonst nur admins und betreiber“): die
    // Kartendateien als ZIP, Token-Links und API-Schlüssel. Ab Admin aus der Vorlage, darunter über die Sonderrolle Kartograph. Stufe V wie alles ab Admin.
    export_maps: { minRole: "admin", assurance: "v" },
    // Nach Production schieben und zurückholen (FREIGABE-0001; Betreiber 2026-10-13). Stufe S, also der Passkey unmittelbar
    // davor: Hier geht etwas nach draußen, und es ist kein täglicher Handgriff. Ein Sonderrecht, damit der Betreiber es
    // einem Admin geben kann, ohne ihm den Betrieb zu öffnen.
    release_to_production: { minRole: "operator", assurance: "s", grantable: true },
    // Das Umgebungsmenü an der Pille der Kopfleiste (WI-0180; Betreiber 2026-10-16: auf die Frage „Ab welcher Rolle darf man
    // zwischen Stage und Production wechseln?“ gewählt „Nur Betreiber“): der Wechsel zwischen Lokal, Stage und Production und der
    // Stand beider Umgebungen. Kein Sonderrecht, damit „nur Betreiber“ auch dann gilt, wenn ein Admin Sonderrechte bekommt; die
    // Vorlage `operator` ist die eine Zeile, die eine spätere Öffnung ändert. Stufe V wie alles ab Admin (Test „Sicherheitsstufen“):
    // Die Route mit dem Stand verlangt den zweiten Faktor; die Links des Menüs zeigt die Oberfläche nach der Rolle, sie brauchen keinen.
    switch_environment: { minRole: "operator", assurance: "v" },
    // WikiSync (WI-0253, Rechte-Gate 6.2; Vali 2026-10-25: „Dump holen: nur betreiber · Vorschau und Berichte: alle · WikiSync: alle nur admins · WikiSync:
    // einzelne objekttypen: alle editoren · Namensräume, Ohne Wiki-Artikel und ohne Quelle, (alle automatischen einstellungen): nur admins“). Noch ohne Routen;
    // der Passkey („V“) steht hier, den frischen Nachweis vor dem Start verlangt später die Route (wie das Höhenmodell). Claudias Festlegung, wo Vali nichts
    // sagte: Einzelartikel vergleichen ab Editor (löst eine Wiki-Anfrage aus, ohne Passkey), Zurücknehmen ab Admin, Regeln übernehmen ab Editor.
    // Den Dump holen darf nur die Betreiber-Vorlage (ein Dump für beide Umgebungen); kein Sonderrecht.
    fetch_wiki_dump: { minRole: "operator", assurance: "v" },
    // Die Vorschau berechnen und den Dump-Bericht und den Laufbericht lesen: Es ändert nichts, jede Rolle mit Konto.
    view_wikisync: { minRole: "tester", assurance: "r" },
    // WikiSync starten: über alle Bereiche („Alle“) nur Admins, für einzelne Bereiche schon Editoren.
    run_wikisync_all: { minRole: "admin", assurance: "v" },
    run_wikisync_areas: { minRole: "editor", assurance: "v" },
    // Die zwei Tafeln des Kanon-Etiketts (Namensräume; Objekte ohne Wiki-Artikel und ohne Quelle) und jede weitere automatische Einstellung.
    manage_canon_tables: { minRole: "admin", assurance: "v" },
    compare_wiki_article: { minRole: "editor", assurance: "r" },
    undo_wikisync_run: { minRole: "admin", assurance: "v" },
    apply_wiki_lore_rules: { minRole: "editor", assurance: "v" },
    // Die Karte nach Fach geteilt (WI-0279, Pakete 3 und 6): Eigenschaften der Herrschaftsgebiete und der Derographie bleiben bei jedem Editor. Form, Hierarchie, Zoombänder und
    // Gebirge stehen ab Admin und kommen darunter nur über Politologe, Derograph und Topograph (E1, E2, E2a). Stufe R (E11, Betreiber: kein Passkey), wie `edit_map_geometry`.
    edit_territories: { minRole: "editor", assurance: "r" },
    edit_territory_form: { minRole: "admin", assurance: "r" },
    edit_landscapes: { minRole: "editor", assurance: "r" },
    edit_landscape_form: { minRole: "admin", assurance: "r" },
    edit_mountains: { minRole: "admin", assurance: "r" },
    // Fachrechte aus den Sammelrechten gelöst (WI-0279, Bauplan): Wer sie nur über eine Sonderrolle hat, kommt damit an genau diesen einen
    // Handgriff, nicht an Betrieb, Moderation oder die ganze Medienverwaltung. Die Betreiber haben sie aus ihrer Vorlage.
    // Die Wegfindung verstellen und freigeben. Stufe V, damit das Lesen ohne Passkey geht; die Schreibwege verlangen ihn selbst (`confirm`).
    manage_routing: { minRole: "operator", assurance: "v" },
    // Im Social Hub fremde und eigene Beiträge freigeben, veröffentlichen, zurücknehmen, erneut senden, Bildrechte bestätigen; ohne Neuigkeiten und Discord-Routine.
    publish_social: { minRole: "operator", assurance: "v" },
    // Nur die Übernahme einer Kartenserie nach Production, nicht die Production-Freigabe.
    release_map_series: { minRole: "operator", assurance: "s" },
    // Anfragen in den Papierkorb legen und zurückholen, ohne die Moderation der Meldungen.
    trash_mail: { minRole: "operator", assurance: "v" },
    // Reisebilder prüfen und freigeben, ohne dass das die Meldungen öffnet.
    moderate_photobox: { minRole: "reviewer", assurance: "r" },
    // Kartenvorschläge der Besucher prüfen und annehmen, ohne dass das die Meldungen öffnet.
    moderate_map_suggestions: { minRole: "reviewer", assurance: "r" },
    // Karten der Kartensammlung ändern und ihre Bilder hochladen, ohne die übrige Medienverwaltung.
    edit_map_collection: { minRole: "editor", assurance: "r" },
    // Bilder für den Social Hub hochladen (Kategorie „Social Media Posts“), ohne die übrige Medienverwaltung.
    upload_social_image: { minRole: "editor", assurance: "r" },
    // Das Wetter (WI-0288 Stufe 2, Betreiber 2026-11-07): Presets und Icons des Wetter-Editors ändern, anlegen und löschen. Wie die übrigen
    // Rechte der Editoren ab Editor, Stufe R ohne Passkey.
    edit_weather: { minRole: "editor", assurance: "r" },
    // Das Wettermodell der Systemsteuerung verstellen und zurücksetzen (Betreiber 2026-11-07: „Zugang bekommt die neue Rolle Meteorologe“).
    // Wie `manage_routing`: aus der Vorlage nur die Betreiber, darunter über die Sonderrolle Meteorologe; Stufe V, den frischen Passkey
    // verlangt die Route. Lesen ist öffentlich (`GET /api/wetter`).
    manage_weather_model: { minRole: "operator", assurance: "v" },
    // Das Sprachmodul (WI-0279, Betreiber 2026-11-08: „neue Sonderrolle: "Linguist" -> mit schreibzugriff auf das sprachmodul“): Sprachen,
    // ihre Teilflächen und Wiki-Artikel im Spracheditor anlegen, ändern, stilllegen und zurücknehmen, dazu die Sperre einer Sprache. Aus
    // `manage_sources` gelöst, damit der Linguist nicht auch Quellen, Literatur, Vorkommen und Korpora schreibt. Ab Admin, darunter nur über den
    // Linguisten (E17a, Betreiber 2026-11-08 per Antwortknopf „Nur Linguisten“): normale Editoren lesen das Sprachmodul nur. Stufe R ohne Passkey wie E11.
    edit_languages: { minRole: "admin", assurance: "r" },
} as const satisfies Record<string, CapabilitySpec>;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as Capability[];

export function isCapability(value: string): value is Capability {
    return Object.hasOwn(CAPABILITIES, value);
}

/** Die Sonderrechte, die der Betreiber einzeln zuteilen kann. */
export const GRANTABLE_CAPABILITIES = CAPABILITY_NAMES.filter(
    (name) => (CAPABILITIES[name] as CapabilitySpec).grantable === true,
);

/** Mindestrolle für ein zugeteiltes Sonderrecht (§7.3: nur an Admins). */
export const GRANT_MIN_ROLE: Role = "admin";

/**
 * Die Capabilities einer Person in einer Umgebung: alles aus der Rollenvorlage, dazu die zugeteilten Sonderrechte, sofern die
 * Rolle sie überhaupt tragen darf. Ein Sonderrecht an einer zu niedrigen Rolle (etwa nach einer Herabstufung) zählt nicht.
 */
export function capabilitiesFor(role: Role, grants: Iterable<string> = []): ReadonlySet<Capability> {
    const rank = roleRank(role);
    const result = new Set<Capability>();
    for (const name of CAPABILITY_NAMES) {
        if (rank >= roleRank(CAPABILITIES[name].minRole)) result.add(name);
    }
    if (rank >= roleRank(GRANT_MIN_ROLE)) {
        for (const grant of grants) {
            if (isCapability(grant) && (CAPABILITIES[grant] as CapabilitySpec).grantable === true) result.add(grant);
        }
    }
    return result;
}

/** Welche Stufe eine Capability verlangt. */
export function assuranceFor(capability: Capability): Assurance {
    return CAPABILITIES[capability].assurance;
}

/**
 * Darf eine Person mit Rolle `actor` an einer Person mit Rolle `target` handeln (sperren, Rolle ändern, Sitzungen beenden)?
 * Nur unterhalb der eigenen Stufe; Admins und Betreiber verwaltet nur der Betreiber (§7.3).
 */
export function mayManage(actor: Role, target: Role): boolean {
    if (actor === "operator") return true;
    if (actor !== "admin") return false;
    return roleRank(target) < roleRank("admin");
}

/** Welche Rollen eine Person mit Rolle `actor` vergeben oder einladen darf. */
export function assignableRoles(actor: Role): readonly Role[] {
    if (actor === "operator") return ROLES;
    if (actor === "admin") return ROLES.filter((role) => roleRank(role) < roleRank("admin"));
    return [];
}

/** Einladungen mit diesen Rollen sind immer an eine Discord-ID gebunden (D3, Betreiber 2026-10-09). */
export function invitationRequiresDiscordBinding(role: Role): boolean {
    return roleRank(role) >= roleRank("admin");
}

/** Die Capabilities, die der Client als `ViewerCapability` kennt (viewer.ts). */
export const VIEWER_CAPABILITIES: readonly ViewerCapability[] = [
    "view_editor_series",
    "view_flow_directions",
    "search_sea_route_names",
    "pin_selection",
    "use_editor_menu",
];
