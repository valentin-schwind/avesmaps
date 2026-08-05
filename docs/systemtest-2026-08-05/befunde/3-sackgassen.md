# Agent 3 — Sackgassen (Daten, Payload, Endpunkte, Frontend, Doku)

## Kern

Grösster Fund: der **abgeschaltete Online-Kategorien-Crawler**. `start_run`/`crawl_step` sind laut
`html/wiki-sync-monitor.html:488` durch den Dump ersetzt — ~864 Zeilen PHP in drei Dateien, fünf
Aktionen und drei Tabellen (`wiki_crawl_queue`, `wiki_path_queue`, `wiki_region_queue`) stehen noch,
kein Client ruft sie. Einziger **AKUT**-Befund mit Nutzerwirkung: nach einem fehlgeschlagenen
Flächen-Speichern hält `map-features-ecosystem-draw.js:367` den Umriss ausdrücklich fest — die
Funktion, die ihn wieder einreicht, ruft niemand; beim nächsten Zeichnen ist er still weg.
Zwei **öffentliche Diagnose-Endpunkte ohne Anmeldung** (`political-zoom-coverage-debug.php`,
`source-coverage.php`, 312 Zeilen) haben keinen Aufrufer; der erste fährt ungeschützt
Politik-Layer-Abfragen. `tools/smoke_test.py` — der Stabilisierungs-Check aus AGENTS §11 — prüft eine
gelöschte Datei und den Vor-M1-Pfad `api/map-features.php` und kann nicht mehr grün werden.
Im Datenmodell zwei Schreibgräber: `source_merge_log` (die zugesagte „Umkehrbarkeit" der
Quellen-Zusammenführung hat keinen Leser) und `contact_message` (Name/E-Mail/Text; einziger SELECT
ist ein COUNT fürs Rate-Limit). Im Payload reisen `data-source` (129 KB) und `data-place-name`
(55 KB) ohne einen einzigen Leser mit. Drei in AGENTS §11 als massgeblich geführte Dokumente
beschreiben die Struktur von vor dem M1-Umbau.

**Zahlen je Kategorie:** Datenmodell 6 · Payload 3 · Endpunkte 5 · Frontend 6 · Doku 5 = **25 Befunde**
(3 AKUT: B10, B15, B21 — 22 KANN — kein ZUKUNFT: Sackgassen sind nichts, was man sich wünscht).

**Ausdrücklich NICHT gemeldet** (geprüft, absichtlich so): `api/wiki-sync.php` (Fallback, AGENTS §10),
`map_feature_legacy_properties` (gewolltes Migrations-Backup), die 410-Stubs
`dom-source/dom-sync/playground-seed` (M1-Neutralisierung), `api/discord/*` (externe Aufrufer),
`feature_sources` im Payload (bewusst synchron, AGENTS §5), `wp-line--N` (dynamisch gebaut).

---

## a) Datenmodell

### B1 `source_merge_log` wird beschrieben und nie gelesen — die zugesicherte Umkehrbarkeit hat keinen Weg zurück
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/feature-sources.php:770` (DDL), `:906` (INSERT); `api/edit/map/source-merge.php:19`
- **Beobachtung:** `source-merge.php:19` sagt „reversibel — `source_merge_log` records the prior state BEFORE the old link is cut". Es gibt genau einen INSERT und keinen einzigen SELECT/UPDATE. Die Spalten `prior_origin`, `prior_status`, `prior_pages`, `prior_reference_kind`, `prior_other_source_url`, `merged_by` kommen im ganzen Repo je genau EINMAL vor — in diesem INSERT.
- **Erwartet:** Entweder eine Rücknahme-Aktion, die den Log liest, oder die Zusage im Kommentar auf „protokolliert, Rücknahme von Hand über phpMyAdmin" abschwächen.
- **Beleg:** `rw_scan.py` über alle .php/.js/.sql/.html: `source_merge_log` READ=0, WRITE=1. Gegenprobe `Grep "source_merge_log" api/` → 6 Treffer, alle DDL/INSERT/Kommentar (0 SELECT). `grep -n "source_merge_log" admin/index.php edit/*.php js/**/*.js` → 0 Treffer.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B2 `contact_message` sammelt Name, E-Mail und Freitext — gelesen wird nur `COUNT(*)` fürs Rate-Limit
- **Kategorie:** KANN
- **Fundstelle:** `api/app/contact.php:44` (INSERT), `:162` (einziger SELECT), `:291` (UPDATE delivery_status)
- **Beobachtung:** Die einzige Leseabfrage ist `SELECT COUNT(*) … WHERE ip_hash = :ip_hash AND created_at >= NOW()-1h` (`avesmapsContactRateLimitExceided`). Der eigentliche Inhalt (`sender_name`, `sender_email`, `subject`, `body`) wird nur eingefügt. Das Editor-Postfach (`api/edit/mail/mailbox.php`) liest IMAP, nicht diese Tabelle. Es gibt keine Oberfläche, keine Löschroutine und keine Aufbewahrungsfrist.
- **Erwartet:** Entweder eine Leseoberfläche (das Postfach wäre der Ort) oder nur den `ip_hash` + Zeitstempel behalten und den Inhalt nach dem Mailversand nicht speichern.
- **Beleg:** `Grep "contact_message"` über `*.php,*.js,*.html` (ohne `.claude/`) → 8 Treffer, alle in `api/app/contact.php`. Spalten-Scan: `contact_message.sender_email` = 3 Vorkommen, alle in dieser Datei.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Drei Crawl-Warteschlangen-Tabellen werden nur noch vom abgeschalteten Online-Crawler bedient
- **Kategorie:** KANN
- **Fundstelle:** `wiki_crawl_queue` (`api/_internal/wiki/sync-monitor.php:11,52`), `wiki_path_queue` (`api/_internal/wiki/paths.php:23,88`), `wiki_region_queue` (`api/_internal/wiki/regions.php:30,209`)
- **Beobachtung:** Alle drei werden ausschliesslich von `…Enqueue`/`…StartRun`/`…CrawlStep`/`…RunStatus` befüllt und gelesen. Genau diese Funktionen hängen an den Dispatcher-Aktionen `start_run`/`crawl_step`/`run_status`, die kein Client mehr sendet (siehe B12). `EnsureTables` legt sie trotzdem bei jedem Lauf wieder an.
- **Erwartet:** Mit dem Crawler-Code zusammen entfernen (Reihenfolge: erst Code, dann Tabellen; die Tabellen liegen auf prod und der Deploy löscht nichts).
- **Beleg:** `Grep "AVESMAPS_WIKI_(PATH|REGION)_QUEUE_TABLE|AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE" api/` → 24 Treffer, alle innerhalb der vier genannten Funktionsfamilien. Client-Gegenprobe siehe B11/B12.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B4 Zwei Tabellen existieren nur als DDL in einem JS-Kommentar
- **Kategorie:** KANN
- **Fundstelle:** `js/territory/territory-editor-embedded.js:41` und `:52`
- **Beobachtung:** `CREATE TABLE political_territory_geometry_assignment (…)` und `CREATE TABLE political_territory_geometry_display (…)` stehen als Entwurf in einem Kommentarblock. Beide Namen und alle ihre Spalten (`source_territory_node_key`, `assignment_id`, `node_wiki_key`, `path_json`, …) kommen im gesamten Repo NUR dort vor — kein PHP, kein SQL, keine Migration. Die tatsächliche Umsetzung läuft über `political_territory_geometry`.
- **Erwartet:** Der Entwurfsblock verwirrt beim Lesen (er sieht aus wie das Schema von Record). Entfernen oder mit „VERWORFEN, umgesetzt als political_territory_geometry" überschreiben.
- **Beleg:** `column_scan.py`: alle 11 Spalten der beiden Tabellen haben 0 Vorkommen ausserhalb des DDL-Blocks. `Grep "political_territory_geometry_display|political_territory_geometry_assignment"` über das Repo → 6 Treffer, alle in dieser einen Datei.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B5 `map_share_links.hits` wird bei jedem Aufruf hochgezählt und nirgends gelesen
- **Kategorie:** KANN
- **Fundstelle:** `api/app/share-link.php:24` (DDL), `:92` (`UPDATE … SET hits = hits + 1`)
- **Beobachtung:** Jeder Aufruf eines geteilten Links kostet einen zusätzlichen UPDATE auf `map_share_links`. Die Zahl erscheint in keiner Oberfläche und keiner Abfrage.
- **Erwartet:** Entweder auswerten (wieviel werden Links tatsächlich benutzt?) oder den UPDATE streichen — er ist ein Schreibvorgang je Aufruf auf Shared Hosting.
- **Beleg:** `grep -rn "\bhits\b" api/ js/ html/ edit/` → der einzige Treffer auf dieser Spalte ist `share-link.php:24` (DDL) und `:92` (UPDATE); alle übrigen Treffer sind Prosa in Kommentaren.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Bestätigung: `map_feature_relations` und `map_proposals` sind weiterhin komplett unbenutzt
- **Kategorie:** KANN
- **Fundstelle:** `sql/schema.sql:791` und `:803`, `sql/schema.future.mysql.sql:42` und `:53`
- **Beobachtung:** AGENTS §10 nennt beide als totes Schema; das gilt unverändert. Kein PHP, kein JS berührt sie — auch nicht `SELECT *`. Die Spalten `from_feature_id`, `to_feature_id`, `relation_type`, `proposal_type`, `target_feature_id` haben je 0 Vorkommen ausserhalb der DDL.
- **Erwartet:** Beim nächsten Schema-Aufräumen mit erledigen (aus `sql/` und, nach Owner-Freigabe, aus der DB).
- **Beleg:** `rw_scan.py`: beide READ=0 WRITE=0 DEL=0. `column_scan.py`: 5 Spalten mit 0 Nicht-DDL-Vorkommen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## b) Payload-Sackgassen (`snapshots/map-features.json`, 19,64 MB)

### B7 `properties["data-source"]` reist auf 5.600 Features mit und hat keinen Leser
- **Kategorie:** KANN
- **Fundstelle:** `snapshots/map-features.json`, `features[].properties.data-source` (Wert z. B. `"hybrid"`)
- **Beobachtung:** 5.600 von 11.486 Features tragen das Feld; zusammen 129 KB im Erstpayload. Der `strip-legacy-import-properties.sql`-Lauf hat 28 Altfelder entfernt, dieses aber nicht. Kein Frontend-Code liest es.
- **Erwartet:** In denselben Strip aufnehmen wie die anderen Altfelder (`docs/superpowers/plans/2026-07-28-map-payload-kern-detail.md:177` führt `data-source` bereits in der DETAIL-Liste — die Trennung ist aber nicht umgesetzt, `api/_internal/app/payload-contract.php` existiert nicht).
- **Beleg:** `grep -rn "data-source" js/ index.html html/ css/ edit/` → 18 Treffer, ausnahmslos die anderen Attribute `data-source-src`, `data-sources`, `data-source-id`; kein einziger Zugriff auf `properties["data-source"]`. Gewicht aus `payload_weight.py` (Byte-Summe über den JSON-Snapshot).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 `properties["data-place-name"]` (1.913 Features, 55 KB) — die einzigen Treffer sind gleichnamige DOM-Attribute
- **Kategorie:** KANN
- **Fundstelle:** `snapshots/map-features.json`, `features[].properties.data-place-name`
- **Beobachtung:** Der Name ist eine Dublette von `properties.name`. Die beiden Codestellen, die so heissen, SCHREIBEN ein HTML-Attribut (`js/routing/route-plan.js:541`, `js/map-features/map-features-location-marker-entry.js:195`) und lesen nicht den Payload.
- **Erwartet:** Mit B7 zusammen strippen.
- **Beleg:** `Grep "data-place-name"` über das Repo → 3 Treffer: 2× Attribut-Erzeugung, 1× ein Kommentar in `route-plan.js:531`. Kein `properties["data-place-name"]`. Zum Vergleich: das benachbarte `data-place-type` IST noch in Gebrauch (`js/routing/routing.js:60`, Alt-Rückfall) — deshalb nur `data-place-name` gemeldet.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B9 `wiki_path.course_hash` ist ein reines Server-Feld und fährt trotzdem in jedem Payload mit
- **Kategorie:** KANN
- **Fundstelle:** `snapshots/map-features.json`, `features[].properties.wiki_path.course_hash` (1.832 Wege, 31 KB)
- **Beobachtung:** Der Hash dient dem Verlauf-Sync zur Selbstfütterungs-Sperre (`api/_internal/wiki/path-verlauf.php:62-72`). Er hat serverseitig einen klaren Zweck, wird aber im Client nie gelesen — er ist im `wiki_path`-Block einfach durchgereicht.
- **Erwartet:** Beim Bau des `wiki_path`-Blocks in `api/app/map-features.php` weglassen.
- **Beleg:** `grep -rn "course_hash" js/ index.html html/` → 0 Treffer; `grep -rn "course_hash" api/` → 20 Treffer, alle serverseitig.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## c) Endpunkte

### B10 `api/app/political-zoom-coverage-debug.php` — 169 Zeilen Diagnose, kein Aufrufer, KEINE Anmeldung
- **Kategorie:** AKUT
- **Fundstelle:** `api/app/political-zoom-coverage-debug.php:1-169`, insbesondere `:10-30`
- **Beobachtung:** Die Datei prüft nur die CORS-Herkunft und die Methode; es gibt kein `require auth.php` und kein `avesmapsRequireUserWithCapability`. Sie öffnet eine PDO-Verbindung und fährt Abfragen über die volle Herrschaftsgebiets-Tabelle. Sie liegt in `api/app/` und ist damit NICHT von der `.htaccess`-Sperre für `_internal`/`_schema`/`diagnostics` gedeckt, wird aber vom Deploy mit hochgeladen (`api` steht in der Allowlist). Aufrufer: keiner — der einzige Verweis im Repo ist die Auflistung in `api/README.md:193`.
- **Erwartet:** Entweder hinter `capability edit` (wie das Schwesterstück `political-derived-geometry-debug.php:6`, das `auth.php` einbindet) oder entfernen. AGENTS §9 warnt ausdrücklich, dass wiederholte Politik-Layer-Abfragen die PHP-Worker sättigen — ein unangemeldeter Endpunkt dieser Art ist ein offener Hebel dafür.
- **Beleg:** `grep -n "RequireUser|Capability|auth.php" api/app/political-zoom-coverage-debug.php` → 0 Treffer (dieselbe Abfrage liefert für `political-derived-geometry-debug.php` Zeile 6). `grep -rl "political-zoom-coverage-debug.php"` über das Repo (ohne `.claude/`, ohne `docs/superpowers/`) → nur `api/README.md`. **Nicht live geprüft** (Netzverbot).
- **Sicherheit:** BELEGT (Code) / PLAUSIBEL (Live-Erreichbarkeit)
- **Aufwand:** klein

### B11 `api/app/source-coverage.php` — 143 Zeilen für eine einmalige Messung vom 2026-07-19
- **Kategorie:** KANN
- **Fundstelle:** `api/app/source-coverage.php:1-143`; Verweis `docs/quellen-wiki-key-instruction.md:18`
- **Beobachtung:** Der Endpunkt existiert, um EINE Frage zu beantworten („wie viele Quellen tragen schon eine Wiki-Adresse?"). Die Antwort steht seit dem 2026-07-19 als Zahl im Instruction-Dokument. Kein Client ruft ihn. Er ist ebenfalls unangemeldet — das ist hier bewusst und im Dateikopf begründet (nur Aggregate, keine Parameter), also kein Sicherheitsbefund, aber toter Betriebsballast.
- **Erwartet:** Nach Abschluss der Quellen-Wiki-Key-Arbeit entfernen; die Messung ist im Dokument konserviert.
- **Beleg:** `grep -rl "source-coverage.php"` (ohne `.claude/`, ohne `docs/superpowers/`) → nur `docs/quellen-wiki-key-instruction.md`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Der Online-Kategorien-Crawler ist abgelöst, aber vollständig stehengeblieben: ~864 Zeilen in drei Dateien
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/wiki/sync-monitor.php:315-764` (416 Z.), `api/_internal/wiki/regions.php:262-730` (230 Z.), `api/_internal/wiki/paths.php:136-652` (218 Z.)
- **Beobachtung:** `html/wiki-sync-monitor.html:488` sagt es selbst: „This REPLACES the old online start_run + crawl_step crawler." Betroffen sind je Datei `…Enqueue`, `…StartRun`, `…CrawlStep`, `…RunStatus` plus in `sync-monitor.php` zusätzlich `FetchCategoryMembers` (36 Z.), `FetchListLinks` (47 Z.), `ResolveCanonicalTitles` (34 Z.), `SeedsFromInput`, `ClassifyRole`, `IsRelevantTitle`, `TitleFromHref`, `ReadMaxDepth`. Die zugehörigen Dispatcher-Arme in `api/edit/wiki/{sync-monitor,regions,paths}.php` sind weiterhin verdrahtet — der Code ist also aufrufbar und würde einen Wiki-Crawl starten.
- **Erwartet:** Aktionen aus den drei Dispatchern nehmen, Funktionen entfernen, danach B3 (Tabellen).
- **Beleg:** `Grep "crawl_step|start_run"` über `*.{js,html}` → 5 Treffer, ALLE in Kommentaren (`html/wiki-sync-monitor.html:488-489`, `js/review/review-region-sync.js:4`); kein `fetch`/`POST`. Gegenprobe der tatsächlich gesendeten Aktionen: `grep -rhon "action[\"']*\s*[:=]\s*[\"'\`][a-z_]\{3,40\}" js/ html/ edit/` + dieselbe Abfrage für `action=…` in Query-Strings → 190 verschiedene Aktionsnamen, `start_run`/`crawl_step`/`run_status` ist keiner davon. Zeilenzahlen aus einem Funktionsspann-Zähler über die drei Dateien.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B13 27 weitere Dispatcher-Aktionen in Editor-Endpunkten, die kein Client mehr sendet
- **Kategorie:** KANN
- **Fundstelle:** u. a. `api/edit/wiki/sync-monitor.php:44-208`, `api/edit/wiki/settlements.php`, `api/_internal/political/territories-endpoint.php:149-230`, `api/edit/political/{subtree-display,display-overrides}.php`
- **Beobachtung:** Ohne Client-Verweis:
  `sync-monitor.php`: `apply_coats`, `apply_coats_preview`, `revert_coats`, `revert_identity`, `identity_backups`, `hierarchy_diff`, `model_sample`, `geometry_lookup`, `geometry_model_audit`, `wiki_rows`, `territory_search`, `set_territory_trashed` —
  `settlements.php`: `crawl_buildings`, `crawl_building_type(s)`, `bulk_connect`, `bulk_record_ruins`, `coat_status`, `connect_status`, `enrich_status`, `ruin_status`, `localize_coats_status` —
  `territories-endpoint.php`: `delete_territory`, `save_hierarchy`, `deactivate_legacy_regions`, `restore_legacy_region_geometries`, `capital_assignments` —
  `subtree-display.php`: `invalidate_layer_cache`, `normalize_leaf_zoom_bands`, `set_all_opacity`, `sync_geometry_zoom_to_territory` —
  `display-overrides.php`: `snapshot_globals`, `restore_globals`, `reset_local` —
  `paths.php`: `derive_flow`, `derive_flow_all`, `backfill_verlauf_source`.
  Besonders bemerkenswert: `delete_territory` — der Löschweg für Herrschaftsgebiete wird von keiner Oberfläche mehr benutzt (die Doku `docs/territories.md:65` beschreibt ihn noch).
- **Erwartet:** Pro Aktion entscheiden: Oberfläche fehlt (dann ist es ein Feature-Loch) oder Aktion ist überholt (dann weg). Sie stehen alle hinter `capability edit`, sind also kein Sicherheitsloch — aber jede ist ein Weg, der ins Nichts führt und den nächsten Leser kostet.
- **Beleg:** `action_scan.py` sammelt alle `match ($action)`-Arme aus 19 Dispatchern (372 Aktionen) und sucht jeden Namen wortgenau in allen `.js`/`.html`-Dateien ausserhalb von `api/` und `docs/`. Stichproben von Hand nachgezogen: `for a in crawl_buildings bulk_connect bulk_record_ruins apply_coats revert_identity hierarchy_diff wiki_rows geometry_model_audit derive_flow; do grep -rho "\b$a\b" js/ html/ index.html edit/ | wc -l; done` → alle 0. `Grep "delete_territory|save_hierarchy|…"` über das Repo → nur PHP-Dispatcher, Doku und ein Plan-Dokument.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B14 `api/edit/map/source-key-report.php`, `api/edit/wiki/publication-art-survey.php`, `api/edit/import-geo.php` — Einmalwerkzeuge ohne Einstieg
- **Kategorie:** KANN
- **Fundstelle:** `api/edit/map/source-key-report.php:1-49`, `api/edit/wiki/publication-art-survey.php:1-117`, `api/edit/import-geo.php:1-188`
- **Beobachtung:** Alle drei sind `edit`-gesperrt und ungefährlich, aber von keiner Oberfläche verlinkt: die Editor-Hülle `edit/index.php` enthält genau zwei Links (Handbuch, Backup). Erreichbar sind sie nur, wenn man die URL kennt. `publication-art-survey.php` wird nur noch in Kommentaren als Quelle einer Messung zitiert (`api/_internal/wiki/publication-parsing.php:170,227`).
- **Erwartet:** Entweder in die Editor-Hülle aufnehmen (dann sind es Werkzeuge) oder als erledigte Einmalläufe entfernen. Kein AKUT — nur: niemand findet sie, wenn er sie braucht.
- **Beleg:** `grep -rl` je Dateiname über das Repo (ohne `.claude/`, `.superpowers/`): `source-key-report.php` → 0 Fremdtreffer, `import-geo.php` → 0, `publication-art-survey.php` → 2 (beide Kommentare). `grep -on "href=\"[^\"]*\"" edit/index.php` → 3 Treffer (CSS, Handbuch, Backup).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## d) Frontend-Code

### B15 Ein fehlgeschlagenes Flächen-Speichern hält den Umriss fest — und niemand reicht ihn je wieder ein
- **Kategorie:** AKUT
- **Fundstelle:** `js/map-features/map-features-ecosystem-draw.js:367` (Merken) gegen `:545-552` (`resumePendingEcosystemAreaSave`)
- **Beobachtung:** Im `catch` des Speicherns steht ausdrücklich: „Der Umriss bleibt erhalten -- nach einem Fehlschlag soll niemand neu zeichnen müssen", und `ecosystemPendingAreaRing = ring`. Die einzige Funktion, die diesen Ring wieder einreichen würde, wird nirgends aufgerufen. Die Variable wird an zwei Stellen (`:268`, `:331`) beim Start des nächsten Zeichenvorgangs auf `null` gesetzt — der gehaltene Umriss ist damit still weg, und der Editor muss doch neu zeichnen. Das Versprechen im Kommentar wird nicht eingelöst.
- **Erwartet:** `resumePendingEcosystemAreaSave()` beim Start des nächsten Speicherversuchs (oder beim erneuten Öffnen des Zeichenwerkzeugs) aufrufen — oder den Ring gar nicht erst merken und den Kommentar streichen, damit niemand sich darauf verlässt.
- **Beleg:** `grep -rn "ecosystemPendingAreaRing" js/` → 7 Treffer, alle in dieser Datei (1× Deklaration, 2× `= null` beim Zeichenstart, 1× Setzen im catch, 3× innerhalb der nie gerufenen Resume-Funktion). Bezeichner-Häufigkeitszählung über alle 924 .js/.html/.php/.md-Dateien: `resumePendingEcosystemAreaSave` kommt genau 1× vor (die Deklaration). **Nicht im Browser reproduziert** — der Beweis ist die fehlende Aufrufstelle.
- **Sicherheit:** BELEGT (Code) / PLAUSIBEL (Nutzerwirkung)
- **Aufwand:** klein

### B16 `js/territory/territory-editor-preview.js` — 105 Zeilen, die keine Seite lädt
- **Kategorie:** KANN
- **Fundstelle:** `js/territory/territory-editor-preview.js:1-105`
- **Beobachtung:** Die Datei steht weder in `index.html` noch in `html/political-territory-editor.html` noch in der dynamischen Ladeliste von `js/territory/territory-editor-inline-host.js`. Sie ist die einzige der 25 nicht in `index.html` eingebundenen JS-Dateien, die von GAR NICHTS referenziert wird (alle übrigen 24 werden vom Inline-Host, von `html/*.html` oder von `html/wege-editor.html` geladen). Drei ihrer sechs Funktionen (`isTreeNodeAssignedToMap`, `getTreeCoverageStatus`, und in der Folge `getTreeMapStatus`) existieren in identischer Aufgabe zusätzlich in `territory-editor-embedded.js` und `territory-wiki-tree.js` — die Datei ist der abgehängte Rest einer Aufteilung.
- **Erwartet:** Entfernen. Solange sie liegt, sieht ihr Inhalt aus wie eine dritte Quelle für die Baumabdeckung.
- **Beleg:** `orphan_js.py` prüft für jede der 25 Dateien den Basisnamen gegen alle .js/.html/.php/.md/.yml/.py im Repo → `territory-editor-preview.js`: `refs: []`. Gegenprobe von Hand: `grep -rn "territory-editor-preview" .` (ohne `.claude/`) → 0 Treffer.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B17 27 globale JS-Funktionen sind deklariert und werden nirgends gerufen
- **Kategorie:** KANN
- **Fundstelle:** u. a. `js/app/utils.js:26` (`attachTypeFilter`), `:90` (`attachRadioFilter`); `js/map-features/map-features-location-marker-rendering.js:9,21,35,49` (`locationZoomScale`, `getVillageMarkerStyle`, `getBuildingMarkerStyle`, `isVillageMarkerStyleLocation`); `js/ui/popups.js:337,630` (`locationAddToRouteActionMarkup`, `waypointRemoveActionMarkup`); `js/review/review-core.js:1,100,104`; `js/routing/route-request.js:40` (`buildRouteRequestFromPlannerState`); `js/routing/route-graph-core.js:1` (`getVisualPathLatLngCoordinates`); `js/ui/spotlight-search.js:777` (`invalidateSpotlightSearchEntryCache`); `js/map-features/map-features-lore.js:293`; `js/map-features/map-features-boundary-canvas-overlay.js:593`; `js/map-features/map-features-region-geometry-helpers.js:174,339`; `js/territory/territory-derived-geometry-editor.js:470,474`; `js/territory/territory-editor-embedded.js:1080`; `js/territory/territory-editor-link.js:89`; `js/review/{review-paths.js:172, review-settlement-list.js:260, review-region-assignment-state.js:114}`; `js/app/wiki-deeplink.js:46`; `js/map-features/map-features-ecosystem-draw.js:545` (= B15)
- **Beobachtung:** Von 3.006 obersten Funktionen im `js/`-Baum kommen 27 im gesamten Repo genau so oft vor, wie sie deklariert werden — also kein einziges Mal als Aufruf, auch nicht als `window.X` oder in einem `onclick=`-String. Vier davon (`locationZoomScale`, `getVillageMarkerStyle`, `getBuildingMarkerStyle`, `isVillageMarkerStyleLocation`, 40 Zeilen zusammen) bilden die alte Marker-Stilberechnung, die vom Canvas-Renderer abgelöst wurde. Zwei (`locationAddToRouteActionMarkup`, `waypointRemoveActionMarkup`) sind Popup-Bausteine.
- **Erwartet:** Löschen. Zwei Sonderfälle vorher ansehen: `invalidateSpotlightSearchEntryCache` (ein nie geleerter Suchcache kann ein Datenfrische-Problem sein) und `resumePendingEcosystemAreaSave` (B15) — dort ist der fehlende Aufruf der Fehler, nicht die Funktion.
- **Beleg:** `frontend_scan2.py`: ein Durchlauf zählt alle Bezeichner über 924 Dateien (`.js/.html/.php/.md`, ohne `.claude/`, `.superpowers/`, `js/third-party/`); gemeldet wird `freq[name] <= Anzahl Deklarationen`. Handprobe für 14 der 27: `for f in attachTypeFilter … ; do grep -rho "\b$f\b" js/ html/ index.html css/ api/ edit/ | wc -l; done` → jeweils exakt `1`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B18 Vier CSS-Blöcke ohne jedes Markup, darunter das Gerippe eines gelöschten Werkzeugs
- **Kategorie:** KANN
- **Fundstelle:** `css/pages/wege-editor.css:173-186,194-195` (`.wp-dist*`, `.wp-delta--up/--down`, 15 Regeln); `css/features/ecosystem-layer.css` (`.ecosystem-region-dialog*` + `.ecosystem-draw-toggle` + `.ecosystem-controls__note`, ~12 Regeln); `css/features/map-labels.css:485-501` (`.legacy-leiche-label`, `#legacy-leichen-toggle`)
- **Beobachtung:** `.legacy-leiche-label` und `#legacy-leichen-toggle` sind der Rest der „Datenleichen"-Editor-Diagnose — die Klassen kommen ausser in dieser CSS-Datei nirgendwo im Repo vor. `.ecosystem-draw-toggle` gehört zum Knopf „Fläche zeichnen", der laut `js/map-features/map-features-ecosystem-draw.js:554` am 2026-07-27 aus der Leiste geflogen ist (die JS-Funktion ist dort ausdrücklich als NO-OP stehengeblieben, das CSS aber ungenannt). `.wp-dist*` beschreibt eine Verteilungsanzeige, die der Wege-Editor nicht baut.
- **Erwartet:** Entfernen. (Nicht betroffen und deshalb NICHT gemeldet: `.wp-line--2/3/4`, `.map-label--*` und `.wp-dist__seg--N`-artige Namen, soweit sie dynamisch zusammengesetzt werden — `js/routing/travel-model-curves.js:46` baut `"wp-line wp-line--" + (index+1)`.)
- **Beleg:** `css_scan.py` vergleicht alle 1.959 CSS-Klassennamen gegen die Bezeichner-Menge aller `.html/.js/.php` (ohne `docs/`, ohne `js/third-party/`). Handprobe: `grep -rn "wp-dist" js/ html/ index.html` → 0; `grep -rn "ecosystem-region-dialog" js/ html/ index.html` → 0; `grep -rn "ecosystem-draw-toggle" js/ html/ index.html` → 0; `grep -rn "legacy-leiche" .` (ohne `.claude/`) → 3 Treffer, alle in `css/features/map-labels.css`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B19 Zwei Wegwerf-Prüfseiten und ihre Datendatei liegen versioniert im Repo-Wurzelverzeichnis
- **Kategorie:** KANN
- **Fundstelle:** `verify-ecosystem-v5-entwurf.html`, `verify-landschaften-v10.html`, `entwurf.json` (17 KB)
- **Beobachtung:** Von den 31 `verify-*`-Dateien im Arbeitsbaum sind genau diese zwei **eingecheckt** (`git ls-files | grep ^verify-`); die übrigen 29 sind unversionierte Reste anderer Sitzungen und gehen mich nichts an. `entwurf.json` ist ebenfalls eingecheckt und wird nur von `verify-ecosystem-v5-entwurf.html` und einem Plan-Dokument benutzt. Ausgeliefert wird nichts davon — die Deploy-Allowlist listet Wurzeldateien einzeln auf und enthält sie nicht.
- **Erwartet:** Aus dem Repo nehmen (Prüfseiten gehören nach `.superpowers/`, das ist gitignoriert). Zusatzhinweis: `.claude/` liegt mit 2,2 GB und 57 Worktrees im Wurzelverzeichnis und steht NICHT in `.gitignore` — bei einem `git add -A` (in AGENTS §9 ohnehin verboten) wäre das ein sehr teurer Unfall.
- **Beleg:** `git ls-files | grep "^verify-"` → 2 Zeilen. `git status --porcelain | grep verify-` → 31 mit `??`. `git ls-files | grep -E "^(layer0|entwurf)\.json$"` → nur `entwurf.json`. `du -sh .claude` → 2,2 GB; `cat .gitignore` enthält `.superpowers/`, aber kein `.claude/`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B20 Die Deploy-Allowlist enthält drei Verzeichnisse, die es nicht mehr gibt
- **Kategorie:** KANN
- **Fundstelle:** `.github/workflows/deploy-avesmaps-strato.yml:91` (`"assets"`), `:99` (`"map"`), `:100` (`"politics"`)
- **Beobachtung:** `ls -d map politics assets` → alle drei fehlen. `/map` und `/politics` wurden laut AGENTS §10 am 2026-06-14 vom Server entfernt; die Allowlist wurde nicht nachgezogen. Wirkungslos, weil `copy_item()` mit `[[ -e "$item" ]]` prüft — aber die Liste ist damit keine verlässliche Antwort mehr auf „was wird ausgeliefert".
- **Erwartet:** Die drei Zeilen streichen.
- **Beleg:** `grep -n "\"assets\"\|\"map\"\|\"politics\"" .github/workflows/deploy-avesmaps-strato.yml` → Zeilen 91/99/100 im Array `deploy_items`; `ls -d map politics assets` → „No such file or directory" für alle drei.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## e) Doku-Sackgassen

### B21 `tools/smoke_test.py` kann seit dem M1-Umbau nicht mehr grün werden
- **Kategorie:** AKUT
- **Fundstelle:** `tools/smoke_test.py:29`, `:123`, `:128`; beschrieben in `docs/stabilization-smoke-test.md:18`
- **Beobachtung:** Drei Fehler in einem Werkzeug, das AGENTS §11 als Stabilisierungsprüfung führt:
  (1) `FRONTEND_SCRIPT_PATHS` enthält `"js/map-features.js"` — die Datei gibt es nicht mehr (aufgeteilt nach `js/map-features/`), der Check meldet also immer `HTTP 404`;
  (2) `check_sql_features()` ruft `api/map-features.php`, der Endpunkt heisst seit M1 `api/app/map-features.php` — der zentrale Datencheck und der davon abhängige `check_feature_consistency()` fallen aus;
  (3) `:123` verlangt, dass `js/config.js` den Text `api/map-features.php` enthält; dort steht `"api/app/map-features.php"` (`js/config.js:234`), was den Teilstring `api/map-features.php` NICHT enthält — der Check meldet „does not contain expected SQL/stylized configuration".
  Ergebnis: Ein Lauf produziert drei Fehlalarme und prüft die Daten gar nicht. Das ist schlimmer als kein Smoke-Test, weil ein FAIL nichts mehr bedeutet.
- **Erwartet:** Pfade nachziehen (`js/map-features/map-features-feature-dispatcher.js` o. ä., `api/app/map-features.php`) und `docs/stabilization-smoke-test.md:18` mit korrigieren.
- **Beleg:** `sed -n '20,32p;110,130p' tools/smoke_test.py` gelesen; `ls js/map-features.js` → „No such file"; `grep -n "map-features" js/config.js` → `:234 … "api/app/map-features.php"`. **Nicht ausgeführt** (das Werkzeug macht Live-Anfragen an avesmaps.de — verboten).
- **Sicherheit:** BELEGT (Code) / PLAUSIBEL (Lauf-Ergebnis)
- **Aufwand:** klein

### B22 `docs/map-features-rest-architecture.md` beschreibt eine Datei, die es nicht mehr gibt — und AGENTS §11 nennt es massgeblich
- **Kategorie:** KANN
- **Fundstelle:** `docs/map-features-rest-architecture.md:1` („Rest architecture: `js/map-features.js`"), 50 nicht mehr existierende Pfade, u. a. `:126,145,158,181,224-235,387,458,461`
- **Beobachtung:** Das Dokument beschreibt den Zustand NACH den ersten Aufteilungen und VOR dem Umzug nach `js/map-features/`. Alle 50 genannten Dateien tragen noch den flachen Namen (`js/map-features-labels.js` statt `js/map-features/map-features-labels.js`). AGENTS §11 führt es als „structure of the map-features layer" — wer danach sucht, findet nichts.
- **Erwartet:** Entweder auf die heutigen Pfade heben oder — ehrlicher — als erledigt in `docs/` archivieren und den Verweis in AGENTS §11 auf `docs/refactoring-map.md` bzw. den heutigen Baum umbiegen.
- **Beleg:** `doc_scan.py` zieht aus jedem Doku-Dokument alle Zeichenketten der Form `<dir>/<pfad>.<ext>` und prüft sie gegen die tatsächliche Dateiliste → 50 fehlende Pfade in dieser Datei. Stichprobe: `ls js/map-features.js` → fehlt; `ls js/map-features/map-features-labels.js` → vorhanden.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B23 `docs/refactoring-map.md` beschreibt die flache Vor-M1-API — ebenfalls in AGENTS §11 als massgeblich geführt
- **Kategorie:** KANN
- **Fundstelle:** `docs/refactoring-map.md:9,39,62,82,87,88,89,96,98,100,144` (25 nicht existierende Pfade)
- **Beobachtung:** Genannt werden u. a. `api/map-features.php`, `api/map-search.php`, `api/political-territories.php`, `api/report-location.php`, `api/political-territory-lib.php`, `api/editor-presence.php` — sämtlich vor M1 abgelöst. `:100` und `:144` beschreiben ausserdem `api/wiki-dom-sync.php` als lebendigen Mechanismus („generates patched temporary PHP files at runtime"); das ist genau die Fläche, die am 2026-06-13 aus Sicherheitsgründen stillgelegt wurde (`api/edit/wiki/dom-sync.php:5-11`, jetzt ein 410-Stub).
- **Erwartet:** Mindestens `:100` und `:144` sofort korrigieren — ein Dokument, das eine bewusst stillgelegte Sicherheitslücke als aktuelle Architektur beschreibt, kann jemanden dazu bringen, sie wiederherzustellen.
- **Beleg:** `doc_scan.py` → 25 fehlende Pfade; `sed -n '95,105p;140,148p' docs/refactoring-map.md` gelesen; `head -12 api/edit/wiki/dom-sync.php` zeigt den 410-Stub mit Begründung.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B24 Die Einrichtungsanleitung in `README.md` nennt drei Dateien, die es nicht gibt
- **Kategorie:** KANN
- **Fundstelle:** `README.md:79`, `:135`, `:139`
- **Beobachtung:** „Then the static files and `api/report-location.php` can run directly" (`:79`) und „The file `api/report-location.php` accepts new location reports" (`:135`) — der Endpunkt heisst `api/app/report-location.php`. „Run the matching SQL schema from `api/schema.mysql.sql` or `api/schema.pgsql.sql`" (`:139`) — die Dateien liegen unter `sql/schema.mysql.sql` bzw. `sql/schema.pgsql.sql`. Wer die README zum ersten Mal befolgt, scheitert an Schritt 1.
- **Erwartet:** Drei Pfade korrigieren.
- **Beleg:** `doc_scan.py` → 4 fehlende Pfade in `README.md` (der vierte, `api/config.local.php`, ist gitignoriert und kein Fehler). `ls sql/` bestätigt `schema.mysql.sql`, `schema.pgsql.sql`; `ls api/app/report-location.php` vorhanden, `api/report-location.php` nicht.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B25 `api/_schema/` enthält nur noch eine `.htaccess` — drei Dokumente und AGENTS §4 verweisen weiterhin auf Schemadateien darin
- **Kategorie:** KANN
- **Fundstelle:** `api/README.md:267-269`, `docs/repository-data-policy.md:82-84`, `AGENTS.md:100` (nennt `_schema` als zu sperrendes Verzeichnis)
- **Beobachtung:** `ls -la api/_schema/` zeigt genau eine Datei: `.htaccess` (152 Bytes). Die referenzierten `api/_schema/{mysql,pgsql,future.mysql}.sql` existieren nicht; die Schemata liegen in `sql/`. Die `.htaccess`-Sperre ist damit korrekt, aber sie schützt ein leeres Verzeichnis, und zwei Dokumente schicken den Leser dorthin.
- **Erwartet:** Verweise auf `sql/` umbiegen; das leere `api/_schema/` samt `.htaccess` kann bleiben (Server-Altbestand) oder mitgehen — das ist eine Owner-Entscheidung.
- **Beleg:** `ls -la api/_schema/` → 1 Datei. `doc_scan.py` meldet dieselben drei Pfade in `api/README.md` und `docs/repository-data-policy.md`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Anhang — verwendete Prüfwerkzeuge

Alle im Arbeitsverzeichnis, alle schliessen `.claude/` (57 Worktrees, 2,2 GB) und `.superpowers/` aus —
ohne diesen Ausschluss vervielfachen sich sämtliche Trefferzahlen und jede Aussage wäre falsch:

| Skript | Was es tut | Ausgabe |
|---|---|---|
| `ddl_extract.py` | sammelt `CREATE TABLE`/`ALTER … ADD` aus PHP+SQL+JS | `ddl.json` — 82 Tabellen |
| `usage_scan.py` | Tabellenname gegen das ganze Repo | `table_usage.json` |
| `column_scan.py` | 807 Spalten, DDL-Blöcke vorher entfernt | `column_report.txt` |
| `rw_scan.py` | je Tabelle: gibt es SELECT/INSERT/UPDATE/DELETE? | `rw_report.txt` |
| `endpoint_scan.py` | 289 PHP-Dateien unter `api/` gegen alle Aufrufer | `endpoint_usage.json` |
| `action_scan.py` | 372 Dispatcher-Aktionen aus 19 Endpunkten gegen alle Clients | `action_report.txt` |
| `payload_scan.py` / `payload_weight.py` | Bytegewicht je JSON-Pfad im 19,64-MB-Snapshot + Leser | `payload_report.txt`, `payload_weight.txt` |
| `frontend_scan2.py` | Bezeichnerhäufigkeit über 924 Dateien; 3.006 JS-Funktionen | `frontend_report.txt` |
| `orphan_js.py` | die 25 nicht in `index.html` eingebundenen JS-Dateien | Konsole |
| `css_scan.py` | 1.959 CSS-Klassen gegen alles Markup | Konsole |
| `doc_scan.py` | Dateipfade in Dokumenten gegen die echte Dateiliste | Konsole |
| `client_endpoints.py` | Client-URLs auf `api/*.php`, die es nicht gibt | 1 Treffer (`api/wiki-sync.php`, gewollt) |

Keine einzige Netzanfrage an avesmaps.de. Nichts geschrieben, nichts committet, keine fremde Datei
angefasst; im Repo wurde ausschliesslich gelesen.
