/**
 * Die Rechtetafel der App-Rolle im Schema `public` (WI-0200; Review S9-02 Schritt 1; Betreiber 2026-10-16: „test is ok, solange es den
 * betrieb nicht anhält. die vorlage kann claudio machen, muss aber daran denken, wenn wieder wo was klemmt. ja können wir machen.“).
 *
 * In `public` gibt das Default-Privileg der Migrationsrolle der App-Rolle jede neue Tafel mit SELECT, INSERT, UPDATE, DELETE und
 * jede Funktion mit EXECUTE (`sql_env` und `grants_sql_tmpl` in `ops/runtime/runtime-foundation.sh`); die Vorlagen unter
 * `apps/server/src/db/*.psql` nehmen nur Einzelnes weg. Diese Tafel sagt umgekehrt, was die App darf: jede Tafel und Sicht genau eine
 * Stufe, jede Funktion ja oder nein. `public-rechte-app-rolle.test.ts` hält sie gegen den Wegwerf-Cluster mit allen Vorlagen.
 *
 * Die Zuordnung folgt den echten Schreibwegen des Fastify-Prozesses: dem Rauchtest der Schreibwege (`schreibwege-app-rolle.test.ts`,
 * jede Anweisung der App-Rolle mitgeschnitten), den Hintergrundläufen im Prozess (Stichprobe, Besuchs- und API-Zähler, Hängt-Melder)
 * und den Vorlagen der Bereiche. Import, Ableitungen und Prüfer laufen als Migrationsrolle, die Aufträge als Jobs-Rolle; beide sind
 * hier nicht berührt.
 *
 * 🔴 Eine neue Tafel, Sicht oder Funktion in `public` braucht hier eine Zeile, sonst wird der Test rot (nur im Testlauf, nie im Betrieb).
 * Schreibt die App an einer neuen Tafel nicht, gehört sie unter „lesen“, und die Vorlage nimmt ihr das Schreiben (bis dahin
 * `BIS_ZUR_VORLAGE`). 🪤 Klemmt ein Schreibweg als App-Rolle (500, `permission denied`), zuerst hier und in der Vorlage nachsehen.
 */

/**
 * - `keine`: kein Recht.
 * - `lesen`: nur SELECT (auch nur an einzelnen Spalten).
 * - `anhaengen`: SELECT und INSERT, nie UPDATE oder DELETE.
 * - `schreiben`: dazu UPDATE oder DELETE, an der Tafel oder an einzelnen Spalten. Welche davon genau, sagt die Vorlage des Bereichs.
 *
 * TRUNCATE, REFERENCES und TRIGGER hat die App nie. Eine Sequenz folgt ihrer Tafel: Benutzen und Setzen nur für anhängen und schreiben.
 * Auch eine Zeilensperre (`SELECT … FOR UPDATE`) braucht in PostgreSQL das UPDATE-Recht; eine gesperrte Tafel steht deshalb unter
 * „schreiben“.
 */
export type Stufe = "keine" | "lesen" | "anhaengen" | "schreiben";

/** Was die App schreibt, sperrt oder ändert. Die genauen Rechte stehen in der Vorlage des Bereichs (Spalte rechts). */
const SCHREIBEN = [
    // Ortseditor und Wege (map-grants.psql): schreiben ja, löschen nie; am Weg nur Linie, `is_active`, `off_map` und die Felder der
    // Straße (Name, Art, „Name auf der Karte“, W5b) als Spaltenrechte.
    "place",
    "place_unplaced",
    "place_detail",
    "place_wiki_assignment",
    "wiki_key_assignment",
    "site_settlement",
    "path",
    "path_visual",
    // Landschaftseditor (map-grants.psql, WI-0178) und die Sperre während der Bearbeitung (0138). Entfernen (D2, 0163) schreibt
    // `region.is_active`, `region.off_map` und `is_active` der Teile: Die App-Rolle hat UPDATE auf der ganzen Tafel, keine Spaltenrechte.
    "region",
    "region_area",
    "map_label",
    // Das Gebirge im Landschaftseditor: Werte und Netz (`terrain/gebirge-editor.ts`, WI-0178 P4, WI-0245, 0212; `FOR UPDATE` auf der
    // Zeile der Werte, das Netz löschen und neu einfügen, die alten Werte beim Wechsel zum Gebirge löschen), Gipfel (`peak-update.ts`,
    // 0205). Bis 2026-10-20 standen die beiden alten unter „lesen“ und in `BIS_ZUR_VORLAGE`: Die Vorlage hätte den Editor gesperrt.
    "terrain_control",
    "terrain_ridge_edge",
    "terrain_ridge_point",
    "terrain_valley_edge",
    "terrain_hollow_point",
    // Eigene Höhen an Flüssen und Seen (WI-0249, 0230): mit dem Netz geschrieben, ganz ersetzt.
    "terrain_water_height",
    "terrain_peak",
    // Gespeicherte Bezüge der Landmarken (WI-0271 L2, Migration 0276): schreibt der Editor ab L3.
    "terrain_peak_bezug",
    "editor_lock",
    // Die Bitte um Freigabe einer Sperre (WI-0262, 0253): bitten, antworten, alte Zeilen wegräumen; leeren nie.
    "editor_lock_request",
    // Kraftlinien-Editor (map-grants.psql, WI-0205): Abschnitte samt Sperre der Linie (`FOR UPDATE`), Punkte, Wiki-Zuordnung je Abschnitt.
    "powerline",
    "nodix",
    "powerline_wiki_assignment",
    // Die Wiki-Box zuordnen und lösen (map-grants.psql, WI-0271 L4): schreiben ja, löschen nie.
    "terrain_peak_wiki_assignment",
    // Herrschaftsgebiete-Editor (map-grants.psql, WI-0209 B1): Gebiet, Fläche, Anspruch; löschen nie. Die Ableitungen bleiben „lesen“.
    "territory",
    "territory_area",
    "territory_claim",
    // Die 17 Detailfelder (WI-0209 G6): Werte und Vermerke; die Zeile nie löschen, einen Vermerk ohne Wert schon.
    "territory_detail",
    "territory_detail_field_origin",
    // Herkunft je Feld mit Wiki-Wert (map-grants.psql, WI-0225, 0183): setzen mit „Fertig“ (Upsert), löschen nie.
    "field_origin",
    // Medien (media-grants.psql): Werk, Dateien, Rechte, Galerien, Bindungen an Orte, Gebiete, Abenteuer und Stadtpläne. Die Bindungen
    // sperrt der Editor beim Zusammenführen und Lösen mit `FOR UPDATE`, auch die an Abenteuer und Stadtplänen.
    "media_asset",
    "media_creation",
    "media_file",
    "media_rights",
    // 🔴 Die Belege hängt die App an (`asset.evidence`) und löscht sie nur mit dem Werk (`asset.delete`, R4, Betreiber 2026-10-17:
    // „A, nur eigene Uploads“): DELETE ja, UPDATE nie. Stand bis 2026-10-18 unter „anhängen“; mit der Vorlage hätte das endgültige
    // Löschen eines eigenen Uploads mit Beleg als App-Rolle `permission denied` geworfen (Befund WI-0068 R8).
    "media_rights_evidence",
    "media_type_image",
    "media_gallery",
    "media_gallery_item",
    "media_merge",
    "media_publication_suspension",
    // Reisebild-Einreichungen von Besuchern ohne Konto (Migration 0274, WI-0272): anlegen, den Zustand ändern, leeren (`purged`) und, solange
    // kein Eingang auf die Zeile zeigt, löschen; Vorgabe-Rechte der App-Rolle, keine Vorlage nimmt etwas weg.
    "media_submission",
    // Verwendung freigegebener Reisebilder (Migration 0293, WI-0272 S3): anlegen und zurückziehen; Vorlage media-grants.psql.
    "photobox_media",
    "place_media",
    "place_media_gallery",
    "place_media_suppression",
    "territory_media",
    "territory_media_suppression",
    "adventure_media",
    "citymap_media",
    // Kartenvorschläge von Besuchern ohne Konto (Migration 0295, WI-0275 Stufe B): anlegen, den Zustand ändern; löschen nie. Vorgabe-Rechte der App-Rolle.
    "citymap_suggestion",
    // Die Kartensammlung (WI-0068 R5, Migration 0197, Betreiber 2026-10-18 „B jetzt“): Die Medienverwaltung ändert die Eigenschaften
    // einer Karte (UPDATE, Zeilensperre) und ihre Typen (anlegen, stilllegen, wieder aktiv); löschen nie. Die übrigen Kinder der Karte
    // (Orte, Fundstellen, Bezüge, Quellen, Wiki) schreibt weiter nur der Import.
    "citymap",
    "citymap_type",
    // Quellen (map-grants.psql, WI-0254, Migration 0232): Das Fenster „Inhalte bearbeiten“ legt Katalogquellen an, ändert sie und stellt
    // Verwendungen her, ändert und legt sie still (Zeilensperre `FOR UPDATE` auf Quelle und Verknüpfung); löschen nie. Die Etiketten der
    // berührten Träger (`<träger>_canon`, abgeleitet) schreibt dieselbe Operation neu und löscht die Zeile, wo Rang 1 bis 3 nichts mehr sagen.
    // `path_source` seit Runde 6 (Betreiber 2026-10-28): Der Wegeditor schreibt die Quellen der ganzen Straße (auf allen Abschnitten), Zeilensperre inklusive; löschen nie.
    "feature_source",
    "place_source",
    "path_source",
    "territory_source",
    "region_source",
    "terrain_peak_source",
    "place_canon",
    "path_canon",
    "territory_canon",
    "region_canon",
    "terrain_peak_canon",
    // Literatur (map-grants.psql, WI-0254, Migration 0233): Das Fenster „Inhalte bearbeiten“ legt Werke an, ändert sie und ihre geordnete
    // Ortsliste, legt Zeilen still und holt sie zurück (Zeilensperre `FOR UPDATE`), schreibt den Herkunftsvermerk je Feld; löschen nie.
    // `adventure_link` bleibt „lesen“: Die weiteren Links stehen noch nicht im Reiter.
    "adventure",
    "adventure_field_origin",
    "adventure_place",
    // Vorkommen (map-grants.psql, WI-0254, Migration 0234): Das Fenster „Inhalte bearbeiten“ ändert Lore-Einträge, legt Ortszeilen und Quellenverknüpfungen
    // an, ändert, legt still und holt zurück (Zeilensperre `FOR UPDATE`) und schreibt den Herkunftsvermerk je Feld; löschen nie. Die Treffer der Zeilen
    // (`lore_place_target`) sind abgeleitet: Die App legt sie an und ersetzt sie bei einer zurückgeholten Zeile (INSERT und DELETE, kein UPDATE). Regeln
    // und ihre Bedingungen (`lore_rule*`) stehen im Reiter nur lesend; angelegt und still gelegt werden sie seit 0248 allein von der Übernahme der Regelvorschläge (unten).
    "lore_entry",
    "lore_entry_field_origin",
    "lore_entry_source",
    "lore_place",
    "lore_place_target",
    // Korpora (map-grants.psql, WI-0254, Migration 0236): Das Fenster „Inhalte bearbeiten“ legt Korpora an und ändert Angaben und Vorgabe; bei einer Belegstelle
    // schreibt es die Vorgabe auf `feature_source` durch. Löschen nie.
    "source_corpus",
    // Sprachen (map-grants.psql, WI-0261 S2, Migration 0254): Der Spracheditor (S5) legt Sprachen und ihre Teilflächen an, ändert sie, legt sie still und
    // holt sie zurück (Zeilensperre `FOR UPDATE`); löschen nie.
    "sprache",
    "sprache_flaeche",
    // Die Wiki-Artikel einer Sprache (map-grants.psql, WI-0261 S3, Migration 0255): Der Spracheditor (S5) ordnet zu, ändert die Reihenfolge und löst durch Stilllegen;
    // löschen nie. Der WikiSync schreibt die Tafel nie (O6).
    "sprache_wiki",
    // Die Landmarken-Artikel des WikiSync (system-grants.psql, WI-0271 L7, Migration 0290): Die App schreibt nur „nicht auf die Karte“ (Spalte `unterdrueckt`, Zeilensperre
    // `FOR UPDATE`); alles andere schreibt der WikiSync (Jobs-Rolle). Löschen nie.
    "wiki_landmarke_artikel",
    // Systemsteuerung (system-grants.psql, hoehenmodell-grants.psql, news-grants.psql).
    // Karten herunterladen (system-grants.psql, WI-0280, Migration 0313): anlegen und ändern, nie löschen.
    "karten_zugang",
    "karten_abruf",
    "system_state",
    "system_sample",
    "system_hour",
    "content_switch",
    "routing_setting",
    "routing_setting_state",
    "routing_setting_applied",
    "map_setting",
    "map_setting_state",
    // Kartenserien (WI-0220, Migration 0167): Abweichungen und Papierkorb; die Revision sperrt der Schreibweg nicht (Beratungssperre).
    "map_series",
    "map_series_state",
    // Zoombänder (WI-0221, Migration 0168): Abweichungen je Spur.
    "zoom_band_setting",
    "zoom_band_state",
    // Wetter (WI-0288 Stufe 2, Migration 0326): Presets und Icons anlegen (beim ersten Ändern alle auf einmal) und ändern; Icons werden weich
    // entfernt, angelegte Presets hart gelöscht (die 14 festen nie, das prüft der Schreibweg); das Wettermodell wie die Wegfindung, beim
    // Zurücksetzen löschen. Die Revision des Modells steht unter „lesen“.
    "weather_preset",
    "weather_symbol",
    "weather_model_setting",
    // Die Hashtags des Social Hubs (WI-0270, Migration 0312): Das Panel ersetzt die ganze Liste.
    "social_hashtag",
    // Die Kanon-Tafeln je Umgebung (WI-0253 B-2, Migration 0223): Abweichungen der Namensräume und der Objektarten, Revision. Der Schreibweg
    // (`kanon/tafel.ts`) hat noch keine Route (Rechte-Gate offen); die App-Rolle schreibt hier, sobald er eine hat.
    "wiki_namespace_setting",
    "canon_object_label_setting",
    "canon_table_state",
    // Der Bereichsschalter des WikiSync (WI-0253 D-1, Migration 0225): Die Route des Betreibers legt eine Zeile an und löscht sie, die Revision hebt der Trigger.
    "wikisync_bereich_setting",
    "wikisync_bereich_state",
    // Die Begriffstafel der Regelableitung (WI-0253 §24, Migration 0248): Abweichungen vom Startwert (anlegen, ändern, beim Zurücksetzen löschen), die Revision hebt der Trigger (UPDATE nur für die Zeilensperre).
    "wikisync_begriff_setting",
    "wikisync_begriff_state",
    // Die Übernahme der Regelvorschläge (Migration 0248): die Übernahme anlegen, die Rücknahme in drei Spalten nachtragen; löschen nie. Die Regel selbst (`lore_rule`): anlegen, nur den Zustand ändern.
    "wikisync_regel_uebernahme",
    "lore_rule",
    "benachrichtigung",
    "news_entry",
    // Der tägliche Discord-Bericht (WI-0255, Migration 0221, `discord/ablage.ts`): Die Zustelltafel legt die Zeile an (`INSERT … ON CONFLICT DO
    // NOTHING`), beansprucht sie atomar (`UPDATE … FROM (… FOR UPDATE)`) und trägt den Ausgang nach; der Schalter der Routine wird gesperrt
    // und gesetzt. Löschen nie.
    "discord_zustellung",
    "discord_routine",
    "terrain_recipe_choice",
    "terrain_recipe_draft",
    // Werte von „19 (Test)“ (WI-0240, Migration 0210): setzen mit Zeilensperre, sperren nach der Abnahme; löschen nie.
    "terrain_recipe_test",
    // Besucher, API-Zähler, geteilte Adressen: der Prozess zählt und räumt selbst ab.
    "visitor_daily_seen",
    "visitor_live",
    "visitor_metric",
    "api_metric",
    // Diagnosen zu Fehlern im Browser (WI-0202): anlegen, hochzählen, nach 14 Tagen im Takt löschen.
    "client_error_diagnosis",
    "share_link",
] as const;

/** Was die App nur anhängt: Operationen, Fachprotokolle, Provenienz und Abnahmen. */
const ANHAENGEN = [
    // Die Bedingungen und Landschaftsarten der Regeln und die Zeilen der Übernahme (WI-0253 §24): nur anhängen.
    "lore_rule_term",
    "lore_rule_term_type",
    "wikisync_regel_uebernahme_zeile",
    "map_operation",
    "map_audit_event",
    // Welche Operationen eine Rücknahme zurücknimmt (WI-0265 B1, Migration 0262): die App hängt die Zeilen in der Transaktion der Operation an.
    "map_operation_revert_link",
    "media_operation",
    "media_audit_event",
    "media_ingest",
    "media_merge_move",
    "terrain_recipe_acceptance",
    // Verlauf der Werte von „19 (Test)“ (WI-0240): nur anhängen.
    "terrain_recipe_test_event",
] as const;

/** Was die App nur liest. Geschrieben wird es vom Import und den Ableitungen (Migrationsrolle) oder von den Aufträgen (Jobs-Rolle). */
const LESEN = [
    // Die Revision des Wettermodells (WI-0288, Migration 0326): hebt allein der Trigger, der Schreibweg sperrt mit einer Beratungssperre.
    "weather_model_state",
    // Kartendaten aus dem Import: Orte, Wege, Kraftlinien, Regionen, Gebiete, Klima, Gelände, Stätten, Quellen.
    "map_domain",
    // Bewertungen (WI-0269, Migration 0266): die App liest; geschrieben wird nur über die Funktionen des Schemas `avesmaps_community` (SECURITY
    // DEFINER), `community-grants.psql` nimmt ihr INSERT, UPDATE und DELETE. Vorher stand die Tafel hier nur bis zur Vorlage.
    "place_review",
    // Zahl „Gefällt mir“ an Reisebildern (WI-0304, Migration 0337): die App liest sie im Lesepfad der Karte; geschrieben wird nur über `photobox_gefaellt()`, `media-grants.psql` nimmt ihr INSERT, UPDATE und DELETE.
    "photobox_gefaellt",
    "settlement_place",
    "path_wiki_assignment",
    "crossing",
    "powerline_canon",
    "region_retirement",
    "label_class_rank",
    "landscape_display_art",
    "landscape_display_source",
    "territory_state",
    "climate_band",
    "climate_divider",
    "climate_zone_type",
    "site",
    "site_named_place",
    // Ableitungen: Schriftläufe, gerundete Flächen, Gebietsformen, Seewege, Gelände.
    "path_label_run",
    "landscape_label_run",
    "region_area_smooth",
    "climate_band_smooth",
    "territory_border",
    "territory_inner_edge",
    "territory_capital_band",
    "territory_claim_shape",
    "territory_display_area",
    "territory_shape",
    "sea_route_graph",
    "terrain_raster",
    "terrain_dem",
    "terrain_dem_tile",
    "terrain_domain_raster",
    "terrain_continental_base",
    "terrain_path_profile",
    "terrain_display_height",
    "terrain_visual_relief",
    "terrain_visual_relief_tile",
    // Inhalte aus Legacy und dem Wiki, Medienherkunft, Lizenzen, Regeln der Veröffentlichung, Geodaten der Besucher.
    "adventure_link",
    "citymap_link",
    "citymap_place",
    "citymap_related",
    "citymap_source",
    "citymap_wiki_assignment",
    // Das Protokoll der Ableitung der Regelvorschläge (WI-0253 §24, Migration 0248): geschrieben nur vom Auftrag `wiki_vorschau` (Jobs-Rolle), die App liest.
    "wikisync_regel_lauf",
    "wikisync_regel_vorschlag",
    "wikisync_regel_wort",
    // Die Zitate des Wikis je Quelle und Objekt (WI-0254 §12, Migration 0251): geschrieben nur vom Auftrag `wiki_vorschau` (Jobs-Rolle), die App liest sie für die Quellen-Klappbox.
    "wikisync_quelle_zitat",
    "wiki_link_page",
    "wiki_link_target",
    // Der Wiki-Stand der Vorkommen (WI-0253 §23, Migration 0247): geschrieben nur vom WikiSync (Jobs-Rolle), die App liest ihn; die Vorlage nimmt ihr das Schreiben.
    "wiki_lore_snapshot",
    // Der Wiki-Stand der Sprachartikel (WI-0261 S3, Migration 0255): geschrieben nur vom WikiSync (Jobs-Rolle), die App liest ihn; die Vorlage nimmt ihr das Schreiben.
    "wiki_sprache_artikel",
    // Die Treffer der Sprachen (WI-0261 S4, Migration 0256): abgeleitet, geschrieben nur vom Auftrag `sprache_treffer` (Jobs-Rolle, INSERT und DELETE); die App liest
    // sie für die Zeile „Sprachen“ und die Zahlen einer Sprache, die Vorlage (system-grants.psql) nimmt ihr das Schreiben.
    "sprache_treffer",
    // Die Mischgebiete der Sprachen (WI-0261 S5a, Migration 0257): abgeleitet wie die Treffer, geschrieben nur vom Auftrag `sprache_treffer` (Jobs-Rolle, INSERT
    // und DELETE); die App liest, die Vorlage (system-grants.psql) nimmt ihr das Schreiben. Die Karte liest `sprache_misch_render` als Kachel.
    "sprache_misch",
    "wiki_path_snapshot",
    "wiki_powerline_snapshot",
    "wiki_region_snapshot",
    "wiki_region_snapshot_neighbor",
    "wiki_region_snapshot_synonym",
    "wiki_settlement_registry",
    "wiki_settlement_registry_named_place",
    "wiki_settlement_snapshot",
    "wiki_settlement_traffic_link",
    // Der Wiki-Schnappschuss der Gebiete (WI-0209, Migration 0162): geschrieben nur vom Import I23 und einmal von der Migration.
    "wiki_territory_snapshot",
    "wiki_territory_snapshot_unknown",
    // Die Läufe des WikiSync-Abgleichs (WI-0253 C, Migration 0224): Der Auftrag `wiki_vorschau` schreibt sie als Jobs-Rolle, die App liest nur den Bericht.
    "wikisync_lauf",
    "wikisync_lauf_zeile",
    // Das Protokoll der Übernahme und der Rücknahme (WI-0253 D-1, Migration 0225): Die Aufträge schreiben es als Jobs-Rolle, die App liest den Stand der Verwaltung.
    "wikisync_uebernahme",
    "wikisync_uebernahme_befund",
    // Der Wiki-Teil eines Laufs (WI-0253 C-2, Migration 0226): Der Auftrag `wiki_kategorien` schreibt Kopf, Bereiche, Cursor und Werte als Jobs-Rolle, die App liest den Stand der Verwaltung.
    "wikisync_wiki_teil",
    "wikisync_wiki_teil_bereich",
    "wikisync_abfrage_stand",
    "wikisync_abfrage_wert",
    // Der Vergleich eines einzelnen Artikels (WI-0253 D-2, Migration 0237): Der Auftrag `wiki_artikel` schreibt ihn als Jobs-Rolle, die App liest ihn für den Dump-Bericht.
    "wikisync_artikel",
    // Der Stand des Syncs je Objekt (WI-0253, Wiki-Box, Migration 0238): Die Aufträge `wiki_artikel` (mit Objekt) und `wiki_uebernehmen` schreiben ihn als Jobs-Rolle, die App liest ihn für die Box.
    "wikisync_objekt",
    "media_legacy_source",
    "license_catalog",
    "publication_rule",
    "visitor_geo_range",
    // Betrieb: Läufe der Importe, Schemastand, Warteschlange (eingereiht wird über `job_enqueue`), Quarantäne der Medien.
    "migration_run",
    "schema_migration",
    "job",
    "job_dependency",
    "job_event",
    "media_quarantine",
    // Sichten: die Renderansichten liest Martin (Kachelrolle), dazu die Zustandssicht der Warteschlange und die wirksamen Beschriftungen.
    // 🪤 Eine einfache Sicht ist von selbst beschreibbar, und geschrieben wird dann mit den Rechten ihrer Besitzerin.
    "climate_band_render",
    "climate_label_render",
    "map_domain_bounds_render",
    "job_health",
    "landscape_label_run_render",
    "ley_node_render",
    "ley_node_basis_render",
    "map_label_effective",
    "map_label_render",
    "path_label_render",
    "path_label_run_render",
    "path_basis_render",
    "path_label_run_basis_render",
    "path_render",
    "place_render",
    "place_basis_render",
    "powerline_render",
    "region_area_render",
    "region_area_eckig_render",
    "region_area_rund_render",
    "sprache_flaeche_render",
    "sprache_misch_render",
    "terrain_contour_detail_render",
    "terrain_contour_render",
    "terrain_height_band_render",
    // Die Gelände-Sicht der Gipfel (WI-0271, Migration 0268): alle Geländeleser lesen sie statt `terrain_peak`.
    "terrain_peak_gelaende",
    "terrain_peak_render",
    "terrain_water_render",
    "terrain_water_eckig_render",
    "terrain_water_rund_render",
    "territory_border_render",
    "territory_claim_render",
    "territory_fill_render",
    "territory_label_render",
] as const;

/** Was die App gar nicht sieht: die Anzeigehöhen der Topographie (Kap. 5.32a; ein Rechenpfad darf sie nie lesen). */
const KEINE = ["terrain_contour", "terrain_height_band"] as const;

function tafel(): Readonly<Record<string, Stufe>> {
    const eintraege: [string, Stufe][] = [
        ...SCHREIBEN.map((name): [string, Stufe] => [name, "schreiben"]),
        ...ANHAENGEN.map((name): [string, Stufe] => [name, "anhaengen"]),
        ...LESEN.map((name): [string, Stufe] => [name, "lesen"]),
        ...KEINE.map((name): [string, Stufe] => [name, "keine"]),
    ];
    const doppelt = eintraege.map(([name]) => name).filter((name, index, alle) => alle.indexOf(name) !== index);
    if (doppelt.length > 0) throw new Error(`public-rechte.ts: doppelt eingetragen: ${doppelt.join(", ")}`);
    return Object.fromEntries(eintraege);
}

/** Jede Tafel und Sicht in `public` (ohne PostGIS) mit ihrer Stufe. */
export const TAFELN = tafel();

/**
 * Jede Funktion der Migrationsrolle in `public` (nach Name, auch für Überladungen): darf die App sie ausführen?
 *
 * Ja nur, wenn der Fastify-Prozess sie ruft, ein CHECK einer Tafel sie braucht, an die die App schreibt, oder eine Sicht, die die App
 * liest (PostgreSQL prüft dort mit den Rechten des Lesers). Auslöserfunktionen (`RETURNS trigger`) ruft niemand direkt; das Feuern
 * prüft kein EXECUTE, deshalb nein.
 */
export const FUNKTIONEN: Readonly<Record<string, boolean>> = {
    // Glocke: der Hängt-Melder im Prozess und die Auslöser des Kanals im Namen der App (system-grants.psql).
    benachrichtige: true,
    redact_person_benachrichtigung: true,
    redact_person_media: true,
    // Konto auflösen schwärzt auch das Kartenprotokoll (WI-0265 B7, Migration 0273): `auth aufloesen` ruft sie als App-Rolle, SECURITY DEFINER.
    redact_person_map_operation: true,
    connection_counts: true,
    // Einreihen in die Warteschlange und die Geländekette aus der Systemsteuerung.
    job_enqueue: true,
    terrain_chain_enqueue: true,
    // Release-Test und Production-Freigabe in der Warteschlange (WI-0248, Migration 0228): die App ruft sie, SECURITY DEFINER.
    release_test_einreihen: true,
    // Der Volltest (WI-0264, Migration 0267): derselbe Auftrag mit `volltest`, ohne Freigabe.
    release_test_volltest_einreihen: true,
    release_test_abbrechen: true,
    freigabe_auftrag_einreihen: true,
    // Das Gelände im Umkreis als Folge der Schreibnaht (WI-0223, Migration 0169).
    terrain_local_enqueue: true,
    // Folgeaufträge der Schreibnaht gleitend sammeln (WI-0229, Migration 0203).
    job_sammeln: true,
    // Die Treffer der Sprachen als Folge der Schreibnaht und des Spracheditors (WI-0261 S4, Migration 0256): vereinigt den Umfang des wartenden Auftrags.
    sprache_treffer_sammeln: true,
    // Editoren: Lage in der Domäne (CHECK an place, map_label, region_area), Fachprotokoll, Stätte eines Kartenpunkts.
    map_domain_contains: true,
    map_event_add: true,
    site_punkt_fuer_ort: true,
    // „Gefällt mir“ an einem Reisebild (WI-0304, Migration 0337): öffentliche Route, SECURITY DEFINER.
    photobox_gefaellt: true,
    // Medien: CHECK an media_file und media_rights_evidence.
    media_storage_key_is_relative: true,
    // Flächen am Punkt (`areas/area-lookup.ts`, Lage, Kontext eines Objekts).
    region_area_is_smoothed: true,
    terrain_water_smooth: true,

    // Warteschlange und Korridor: nur die Jobs-Rolle, über die Verben der Migrationsrolle (jobs-grants.psql, grants_sql_tmpl).
    benachrichtigung_einreihen: false,
    benachrichtigung_purge_expired: false,
    job_chain_cancel_waiting: false,
    job_event_add: false,
    job_insert: false,
    job_sync_claim: false,
    job_sync_claim_id: false,
    job_sync_discard: false,
    job_sync_finish: false,
    job_sync_kategorie: false,
    job_sync_phase: false,
    news_add: false,
    // Aufbewahrung der Reisebilder (WI-0272): nur die Jobs-Rolle (media-grants.psql).
    photobox_aufbewahren: false,
    // Aufbewahrung der Kartenvorschläge (WI-0275 B2): nur die Jobs-Rolle (media-grants.psql).
    kartenvorschlag_aufbewahren: false,
    // Ableitungen (Migrationsrolle); region_area_smooth_derive hat seit 0072 keinen Aufrufer.
    climate_band_smooth_derive: false,
    climate_band_smooth_is_stale: false,
    climate_band_smooth_recipe: false,
    region_area_smooth_derive: false,
    region_area_smooth_is_stale: false,
    region_area_smooth_recipe: false,
    territory_area_valid: false,
    // Nur in Renderansichten und Kachelfunktionen (Martin, Kachelrolle).
    climate_band_edge_span: false,
    label_collision_rank: false,
    map_domain_to_render: false,
    landscape_label_run_tile: false,
    ley_node_tile: false,
    path_label_run_tile: false,
    path_tile: false,
    place_tile: false,
    region_area_tile: false,
    terrain_contour_detail_tile: false,
    terrain_contour_tile: false,
    terrain_height_band_tile: false,
    terrain_water_tile: false,
    territory_border_tile: false,
    territory_tile: false,
    // Auslöser.
    climate_band_guard: false,
    content_switch_bump: false,
    map_setting_bump: false,
    map_series_bump: false,
    zoom_band_bump: false,
    weather_model_bump: false,
    canon_table_bump: false,
    wikisync_bereich_bump: false,
    wikisync_begriff_bump: false,
    media_gallery_item_touches_gallery: false,
    media_publication_suspension_bytes_of_asset: false,
    media_publication_suspension_guard: false,
    // Rechte und Entstehung einer erzeugten Kartenvorschau folgen ihrer Karte (WI-0287, 0320); media-grants.psql nimmt der App das Recht.
    media_rights_folgt_quelle: false,
    media_rights_an_erzeugte: false,
    media_asset_entstehung_folgt_quelle: false,
    media_asset_entstehung_an_erzeugte: false,
    place_media_binding_not_suppressed: false,
    place_media_suppression_has_no_binding: false,
    revision_bump: false,
    revision_bump_forward: false,
    routing_setting_bump: false,
    // Der Zyklus-Trigger der Gebiete (0145, WI-0209 B1): läuft als Trigger, die App ruft ihn nie.
    territory_no_cycle: false,
    system_state_notify: false,
    terrain_dem_tile_set_revision: false,
    territory_media_binding_not_suppressed: false,
    territory_media_suppression_has_no_binding: false,
};

/**
 * Was erst die Vorlage von Claudio schließt (S9-02 Schritt 2, Handover
 * `project-control/handovers/2026-10-16-rechtetafel-public-an-claudio.md`): Heute gibt das Default-Privileg der App-Rolle an diesen
 * Tafeln und Sichten noch Schreibrechte und an diesen Funktionen EXECUTE. Der Test lässt die Abweichung durch, verlangt aber, dass
 * sie noch besteht; ist ein Eintrag erledigt, wird er rot, und die Zeile gehört weg (am besten im selben Commit wie die Vorlage).
 * Die Sequenzen dieser Tafeln laufen mit; `sequenzen` nennt die übrigen, deren Tafel die App schon heute nur liest. Die Liste wird nur
 * kürzer; eine neue Lesetafel kommt hier nur bis zur Vorlage hinein.
 */
export const BIS_ZUR_VORLAGE: {
    readonly tafeln: readonly string[];
    readonly funktionen: readonly string[];
    readonly sequenzen: readonly string[];
} = {
    tafeln: [
        "adventure_link",
        "citymap_link",
        "citymap_place",
        "citymap_related",
        "citymap_source",
        "citymap_wiki_assignment",
        "climate_band",
        "climate_band_smooth",
        "climate_divider",
        "climate_zone_type",
        "crossing",
        "label_class_rank",
        "landscape_display_art",
        "landscape_display_source",
        "license_catalog",
        "map_domain",
        "media_legacy_source",
        "migration_run",
        "path_wiki_assignment",
        "powerline_canon",
        "publication_rule",
        "region_retirement",
        "sea_route_graph",
        "settlement_place",
        "terrain_continental_base",
        "terrain_dem",
        "terrain_dem_tile",
        "terrain_display_height",
        "terrain_domain_raster",
        "terrain_path_profile",
        "terrain_raster",
        "terrain_visual_relief",
        "terrain_visual_relief_tile",
        "territory_border",
        "territory_capital_band",
        "territory_claim_shape",
        "territory_display_area",
        "territory_inner_edge",
        "territory_shape",
        "territory_state",
        "visitor_geo_range",
        "wiki_link_page",
        "wiki_link_target",
        "wiki_path_snapshot",
        "wiki_powerline_snapshot",
        "wiki_region_snapshot",
        "wiki_region_snapshot_neighbor",
        "wiki_region_snapshot_synonym",
        "wiki_settlement_registry",
        "wiki_settlement_registry_named_place",
        "wiki_settlement_snapshot",
        "wiki_settlement_traffic_link",
        "wiki_territory_snapshot",
        "wiki_territory_snapshot_unknown",
        "climate_band_render",
        "map_domain_bounds_render",
        "ley_node_basis_render",
        "path_basis_render",
        "path_label_run_basis_render",
        "place_basis_render",
        "region_area_eckig_render",
        "region_area_rund_render",
        "terrain_water_eckig_render",
        "terrain_water_rund_render",
        "climate_label_render",
        "job_health",
        "landscape_label_run_render",
        "ley_node_render",
        "map_label_effective",
        "map_label_render",
        "path_label_render",
        "path_label_run_render",
        "path_render",
        "place_render",
        "powerline_render",
        "region_area_render",
        "sprache_flaeche_render",
        "sprache_misch_render",
        "terrain_contour_detail_render",
        "terrain_contour_render",
        "terrain_height_band_render",
        "terrain_peak_gelaende",
        "terrain_peak_render",
        "terrain_water_render",
        "territory_border_render",
        "territory_claim_render",
        "territory_fill_render",
        "territory_label_render",
    ],
    funktionen: [
        "benachrichtigung_purge_expired",
        "climate_band_edge_span",
        "climate_band_guard",
        "climate_band_smooth_derive",
        "climate_band_smooth_is_stale",
        "climate_band_smooth_recipe",
        "content_switch_bump",
        "label_collision_rank",
        "landscape_label_run_tile",
        "ley_node_tile",
        "map_domain_to_render",
        "map_setting_bump",
        "map_series_bump",
        "zoom_band_bump",
        "weather_model_bump",
        "canon_table_bump",
        "wikisync_bereich_bump",
        "wikisync_begriff_bump",
        "media_gallery_item_touches_gallery",
        "media_publication_suspension_bytes_of_asset",
        "media_publication_suspension_guard",
        "path_label_run_tile",
        "path_tile",
        "place_tile",
        "place_media_binding_not_suppressed",
        "place_media_suppression_has_no_binding",
        "region_area_smooth_derive",
        "region_area_smooth_is_stale",
        "region_area_smooth_recipe",
        "region_area_tile",
        "revision_bump",
        "revision_bump_forward",
        "routing_setting_bump",
        "system_state_notify",
        "terrain_contour_detail_tile",
        "terrain_contour_tile",
        "terrain_dem_tile_set_revision",
        "terrain_height_band_tile",
        "terrain_water_tile",
        "territory_area_valid",
        "territory_border_tile",
        "territory_media_binding_not_suppressed",
        "territory_media_suppression_has_no_binding",
        "territory_no_cycle",
        "territory_tile",
    ],
    sequenzen: [
        "job_event_seq_seq",
        "job_id_seq",
        "landscape_label_run_id_seq",
        "media_quarantine_id_seq",
        "site_id_seq",
        "site_named_place_id_seq",
        "terrain_contour_id_seq",
        "terrain_height_band_id_seq",
    ],
};
