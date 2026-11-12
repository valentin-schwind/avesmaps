import type { NavTafel } from "./navigation.ts";

/**
 * Die Tafel der Systemsteuerung (EDIT-0001 §3.3, WI-0128 E2; vorher `ADMIN_ENTRIES` in `apps/web/src/auth/verwaltung.ts`, SYS-0001
 * §6.1): Bereiche der Schiene und ihre Einträge, je Eintrag sein eigenes Recht (AUTH-0001 §12.2: nie „ist Admin“). Ein neuer Eintrag
 * ist eine Zeile hier.
 *
 * Seit SYS-15 (Betreiber 2026-10-10, SYS-0001 §9d) ein eigenes Fenster „Systemsteuerung …“; „Personen & Sicherheit“ ist in die
 * Kontenverwaltung gezogen (`kontenverwaltung.ts`).
 *
 * 🔴 **Vier feste Gruppen** (Betreiber 2026-10-17, Wortlaut in WI-0127 §23): BETRIEB, AUSLIEFERUNG & DATEN, KARTE & EINSTELLUNGEN,
 * REDAKTION & ZUSAMMENARBEIT, je mit den Reitern in seiner Reihenfolge. Die Schiene zeigt die Gruppen als Zwischenüberschriften in
 * Versalien, nicht klickbar, nicht klappbar, ohne Winkel (`FensterSchiene` mit `festeKoepfe`). Jeder neue Reiter gehört in eine der
 * vier (`SYSTEMSTEUERUNG_GRUPPEN` unten; ohne Gruppe typcheckt die Tafel nicht); eine fünfte Gruppe nur mit Entscheidung des Betreibers.
 *
 * - Die Bereiche tragen die Vorsilbe `bereich-`, weil ein Eintrag und sein Bereich sonst dieselbe Kennung haben könnten (eine Kennung je
 *   Tafel); die Oberfläche nennt sie ohne Vorsilbe (`betrieb`, `auslieferung`, `karte`, `redaktion`; Namen `admin.area.*`).
 * - Ein Bereich ohne wählbaren Eintrag fällt weg (`sichtbar`): ein Verweis oder ein späterer Eintrag allein macht keinen Bereich.
 * - Die Kennungen und Rechte der Reiter sind älter als die Gruppen und bleiben; tiefe Links `?verwaltung=<eintrag>` gehen weiter.
 * - „Datenabgleich“ (`abgleiche`, D13, SYS-0001 §9b): sehen darf ihn, wer den Betrieb liest; den Knopf „⇄ Jetzt abgleichen“ je Zeile
 *   zeigt nur ihr Recht (Legacy-Zug und Medien: `run_legacy_sync`).
 * - „Betriebszustand“ sieht, wer `view_operations` hat; umschalten darf darin nur `manage_system_settings` (SYS-5). „Backups“ hängt an
 *   `view_operations` (SYS-9). „Versionen“ (WI-0137, VERSION-0001 §4): die Commits je Release aus `config/releases/`.
 * - Das Protokoll (`protokoll-system`) zeigt den Filter System, mit der Rolle Betreiber dazu „alles“ (WI-0127 §14.4).
 * - „Claudia & Claudio“ (WI-0124 `6aefefb2`) ist der Betreiber-Kanal mit dem eigenen Recht `use_operator_channel` (nur die Rolle
 *   Betreiber); die Kennung bleibt `claudio`, damit `?verwaltung=claudio&ops=…` (WI-0136) ihn findet.
 */
export const SYSTEMSTEUERUNG = {
    id: "systemsteuerung",
    wurzel: "schiene",
    eintraege: [
        // ── BETRIEB ──
        { id: "bereich-betrieb", unter: null, art: "bereich", rechte: [], kinder: "schiene" },
        { id: "betrieb", unter: "bereich-betrieb", art: "ansicht", rechte: ["view_operations"] },
        // Der Systemzustand (SYS-8, Blatt WI-0119 A7): nur lesen, direkt unter dem Betriebszustand.
        { id: "systemzustand", unter: "bereich-betrieb", art: "ansicht", rechte: ["view_operations"] },
        // Die Statusseite im Fenster, „Warteschlange“ (Betreiber 2026-10-11: „nahtlos inline … ohne dass eine extra seite
        // aufgeht“), für wer den Betrieb liest. Wer nur eigene Jobs sieht (`view_own_jobs`, Editoren), bekommt dafür kein Fenster;
        // `/status.html` bleibt für alle.
        { id: "statusseite", unter: "bereich-betrieb", art: "ansicht", rechte: ["view_operations"] },
        { id: "backup", unter: "bereich-betrieb", art: "ansicht", rechte: ["view_operations"] },
        { id: "protokoll-system", unter: "bereich-betrieb", art: "ansicht", rechte: ["read_audit"] },
        // ── AUSLIEFERUNG & DATEN ──
        { id: "bereich-auslieferung", unter: null, art: "bereich", rechte: [], kinder: "schiene" },
        // Die Umgebungen samt Production-Freigabe (FREIGABE-0001, WI-0204; bis 2026-10-16 hieß der Eintrag „Production“): sehen mit
        // dem Betrieb, schieben mit `release_to_production` (Stufe S). Die Kennung bleibt `production`, damit tiefe Links
        // (`?verwaltung=production`) ihn finden. Der Wert an der Schiene ist die Zahl der Themen, die noch nicht draußen sind.
        { id: "production", unter: "bereich-auslieferung", art: "ansicht", rechte: ["view_operations"] },
        { id: "versionen", unter: "bereich-auslieferung", art: "ansicht", rechte: ["view_operations"] },
        // Der Datenabgleich trägt seit WI-0253 die Unterreiter Legacy | WikiSync: Legacy mit dem Betrieb (ab Admin), WikiSync mit `view_wikisync` (ab
        // Tester; Vali 2026-10-25: „Vorschau und Berichte: alle“). Wer nur WikiSync sieht, sieht in der Systemsteuerung nur diesen Eintrag.
        {
            id: "abgleiche",
            unter: "bereich-auslieferung",
            art: "ansicht",
            rechte: ["view_operations", "view_wikisync"],
        },
        // ── KARTE & EINSTELLUNGEN ──
        { id: "bereich-karte", unter: null, art: "bereich", rechte: [], kinder: "schiene" },
        // Die Kartenserien (WI-0220): sehen mit dem Betrieb, ändern mit dem Sonderrecht `manage_map_series` (Passkey). Vorn in der Gruppe:
        // Der Betreiber hat die Vorlage mit dem Reiter an erster Stelle abgenommen (2026-10-18, Fassung 4: „passt!“).
        // Mit `manage_map_series` auch ohne den Betrieb (Kartograph, WI-0279).
        {
            id: "kartenserien",
            unter: "bereich-karte",
            art: "ansicht",
            rechte: ["view_operations", "manage_map_series"],
        },
        // Die Inhaltsschalter (SYS-10, Blatt WI-0119 A2): sehen mit dem Betrieb, umlegen mit `manage_system_settings` (Stufe S).
        { id: "inhalte", unter: "bereich-karte", art: "ansicht", rechte: ["view_operations"] },
        // Das Höhenmodell (SYS-13): sehen mit dem Betrieb, wählen und Entwürfe mit dem Sonderrecht `manage_terrain_recipe`.
        // Mit `manage_terrain_recipe` auch ohne den Betrieb (Topograph, WI-0279).
        {
            id: "hoehenmodell",
            unter: "bereich-karte",
            art: "ansicht",
            rechte: ["view_operations", "manage_terrain_recipe"],
        },
        // Das Wettermodell (WI-0288 Stufe 4): die Werte des Wetters, die nicht mit der Jahreszeit wandern; direkt unter dem Höhenmodell
        // (Betreiber 2026-11-07: „unter ‚Höhenmodell‘“). Sehen mit dem Betrieb, verstellen mit `manage_weather_model` (Passkey); mit dem
        // Recht auch ohne den Betrieb (Meteorologe, Sonderrolle aus WI-0288 Stufe 2). Der Wert an der Schiene zählt die Abweichungen.
        {
            id: "wettermodell",
            unter: "bereich-karte",
            art: "ansicht",
            rechte: ["view_operations", "manage_weather_model"],
        },
        // Die Karteneinstellungen (WI-0166): die Voreinstellungen jedes Besuchs, zuerst die Startansicht; sehen mit dem Betrieb,
        // verstellen mit `manage_system_settings` (Stufe S). Der Wert an der Schiene ist die Zahl der verstellten Einstellungen.
        { id: "karteneinstellungen", unter: "bereich-karte", art: "ansicht", rechte: ["view_operations"] },
        // Die Wegfindung (WI-0153): sehen mit dem Betrieb, verstellen mit `manage_system_settings` (Stufe S). Der Wert an der
        // Schiene ist die Zahl der Kenngrößen, die von ihrer Vorgabe abweichen.
        // Mit `manage_routing` auch ohne den Betrieb (Odologe, WI-0279).
        { id: "wegfindung", unter: "bereich-karte", art: "ansicht", rechte: ["view_operations", "manage_routing"] },
        // Die Zoombänder (WI-0221): ab welchem bis zu welchem Band jede Art erscheint; sehen mit dem Betrieb, ändern mit
        // `manage_display_settings` (Passkey). Hinten in der Gruppe (Reihenfolge des Betreibers über die Koordination, 2026-10-18). Der
        // Wert an der Schiene ist die Zahl der Spannen, die von ihrer Vorgabe abweichen.
        { id: "zoombaender", unter: "bereich-karte", art: "ansicht", rechte: ["view_operations"] },
        // ── REDAKTION & ZUSAMMENARBEIT ──
        { id: "bereich-redaktion", unter: null, art: "bereich", rechte: [], kinder: "schiene" },
        // Die Neuigkeiten (WI-0139): sehen mit dem Betrieb, freigeben und verstecken mit `manage_news`. Der Wert an der Schiene ist die
        // Zahl der Entwürfe, die auf eine Freigabe warten.
        { id: "neuigkeiten", unter: "bereich-redaktion", art: "ansicht", rechte: ["view_operations"] },
        // Das Mailpostfach (WI-0268 C6c): der Mailweg der Community, Abruf (IMAP) und Versand (SMTP) mit je einem Schalter; sehen mit dem Betrieb, schalten mit `manage_system_settings` (Passkey). Kein Teil des
        // Betriebszustands, der der Notfallhebel der ganzen Umgebung bleibt.
        { id: "mail", unter: "bereich-redaktion", art: "ansicht", rechte: ["view_operations"] },
        // Social Media (WI-0270 C12a, Fachkonzept §15.7; seit 2026-11-03 hier statt im Social Hub): Stand und Notschalter der fremden Kanäle; nur mit `manage_social_channels` (Betreiber, Passkey). Geschrieben wird im Hub.
        { id: "social", unter: "bereich-redaktion", art: "ansicht", rechte: ["manage_social_channels"] },
        { id: "claudio", unter: "bereich-redaktion", art: "ansicht", rechte: ["use_operator_channel"] },
    ],
} as const satisfies NavTafel;

/**
 * 🔴 Die vier Gruppen der Systemsteuerung (Betreiber 2026-10-17, WI-0127 §23): „Jeder künftig hinzukommende Reiter der Systemsteuerung
 * muss einer dieser vier Gruppen zugeordnet werden. … Keine neuen ungruppierten Reiter und keine fünfte Gruppe ohne meine ausdrückliche
 * Entscheidung.“ Die Reihenfolge ist die der Schiene.
 */
export const SYSTEMSTEUERUNG_GRUPPEN = [
    "bereich-betrieb",
    "bereich-auslieferung",
    "bereich-karte",
    "bereich-redaktion",
] as const;
export type SystemsteuerungsGruppe = (typeof SYSTEMSTEUERUNG_GRUPPEN)[number];

type SystemsteuerungsEintrag = (typeof SYSTEMSTEUERUNG)["eintraege"][number];
/**
 * Ein Reiter ohne eine der vier Gruppen typcheckt nicht: Steht ein Eintrag unter etwas anderem als einer Gruppe (oder unter `null`,
 * ohne Bereich zu sein), ist dieser Typ nicht `never`, und die Zeile darunter scheitert. Eine fünfte Gruppe scheitert ebenso.
 */
type OhneGruppe = Exclude<
    Extract<SystemsteuerungsEintrag, { art: Exclude<SystemsteuerungsEintrag["art"], "bereich"> }>["unter"],
    SystemsteuerungsGruppe
>;
type FremdeGruppe = Exclude<Extract<SystemsteuerungsEintrag, { art: "bereich" }>["id"], SystemsteuerungsGruppe>;
export const SYSTEMSTEUERUNG_JEDER_REITER_IN_EINER_GRUPPE: [OhneGruppe | FremdeGruppe] extends [never] ? true : never =
    true;

/** Die Vorsilbe der Bereiche in dieser Tafel und in der Kontenverwaltung. */
export const SYSTEMSTEUERUNG_BEREICH = "bereich-";
