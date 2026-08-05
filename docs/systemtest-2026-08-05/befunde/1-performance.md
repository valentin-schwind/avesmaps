# Agent 1 — Performance

## Kern

1. **Der groesste Hebel ist eine `.htaccess`-Zeile, nicht der Payload.** Nichts wird komprimiert
   ausser `map-features.php` (das gzippt selbst). `.htaccess` hat kein `mod_deflate`/`AddOutputFilterByType`.
   Gemessen: JS 4,13 → 1,34 MB, CSS 745 → 221 KB, HTML 216 → 49 KB, Politik-Layer 2,83 → 0,73 MB,
   Abenteuer 1,76 → 0,23 MB. **≈ 5,5 MB je Kaltbesuch, ungenutzt.**
2. **`GET /api/locations/` ist der teuerste ungeschuetzte Endpunkt.** Er laedt die ganze
   `map_features`-Tabelle und baut das Routennetz — genau der Pfad, den `api/route/index.php:26`
   mit „62 MB resident, peak 152 MB per call" beziffert und fuer den die sechs Diagnosen hinter
   `edit` verriegelt wurden. Der oeffentliche Zwilling ist offen, ohne Cache, ohne ETag, ohne Limit,
   liefert immer alle 4 854 Orte (938 KB) und ignoriert jeden Query-Parameter.
3. **`GET /api/app/ecosystem-areas.php` zahlt 64 SQL-Anweisungen VOR dem 304** (13 CREATE TABLE,
   16 `information_schema`, 34 INSERT IGNORE). Ein Client mit gueltigem ETag zahlt sie voll.
4. **Der N+1 im abgeleiteten Politik-Layer lebt.** M6 hat nur den Volltabellen-Scan entfernt;
   `territories-derived-layer.php:66-67` feuert weiter **2 Queries je Derived-Feature** — bei Zoom 3
   sind das 122 Features = **244 Queries** je Cache-Miss.
5. **Ein 5-Hz-Timer laeuft ungebremst auf jedem Besuchergeraet**
   (`map-features-boundary-canvas-overlay.js:755`, ungated, ohne Stopp-Bedingung).
6. **Payload-Trimmen bringt am Draht wenig, im Client viel:** die fuenf gefundenen Posten
   (`updated_at` tot, `feature.id` Zwilling, `reference_kind` als 12-Zeichen-Enum,
   `political.hierarchy` 7 948 Knoten fuer 844 verschiedene, `synced_at`/`match_key`/`course_hash` tot)
   sind **3,04 MB roh, aber nur 196 KB gzip**. Der Gewinn liegt im `JSON.parse` und im Speicher.
7. Zwei Stellen in AGENTS.md §10/§1 sind ueberholt (Politik-DDL-vor-Cache ist behoben; `index.html`
   hat 214 `<script src>`, nicht ~117).

---

## AKUT

### B1 `GET /api/app/ecosystem-areas.php` fuehrt 64 SQL-Anweisungen aus, bevor der 304 geprueft wird
- **Kategorie:** AKUT
- **Fundstelle:** `api/app/ecosystem-areas.php:83` (Aufruf) → `api/_internal/app/ecosystem.php:223-848`
- **Beobachtung:** `avesmapsEcosystemEnsureTables($pdo)` steht in Zeile 83, der ETag wird erst in
  Zeile 87 gebildet und der 304-Ausstieg liegt in Zeile 91-94. Gezaehlt in der Funktion:
  **13 × `CREATE TABLE IF NOT EXISTS`**, **16 × `SELECT COUNT(*) FROM information_schema.COLUMNS`**
  (4 in der `ecosystem_area`-Spaltenschleife, 1 Divider, 4 in der `ecosystem_region_type`-Schleife,
  5 in der Audit-Log-Schleife, je 1 fuer `affects_paths` und `offroad_factor`),
  danach `avesmapsEcosystemSeedRegionTypes()` mit **34 × `INSERT IGNORE`** (eine je Zeile in
  `AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED`) und `avesmapsEcosystemMoveIslandsToTopographie()` mit einem
  Waechter-SELECT. Summe **64 Anweisungen**, unabhaengig davon, ob die Antwort 200 oder 304 wird.
- **Erwartet:** Wie beim Politik-Layer (`territories-endpoint.php:41-59`) und wie es
  `api/app/map-features.php:382-396` ausdruecklich fuer sich festlegt („the hot map-features path must
  not run DDL"): Revision lesen → ETag → 304, und erst auf dem Miss-Pfad (oder nur im Schreib-Dispatcher)
  die Tabellen sicherstellen.
- **Beleg:** Datei gelesen (`api/app/ecosystem-areas.php`, `api/_internal/app/ecosystem.php:223-848,
  904-922`); Zaehlung per Skript
  `scratchpad/systemtest/ddl-count.js` → `CREATE=13 ALTER=6 IDX=1 info_schema=4(Vorkommen im Quelltext)`
  plus manuelle Aufloesung der vier Schleifen auf 16 Ausfuehrungen; Saatzeilen per Skript gezaehlt (34).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B2 `GET /api/locations/` ist der ungeschuetzte Zwilling eines Pfades, den das Projekt selbst mit 152 MB Spitze beziffert
- **Kategorie:** AKUT
- **Fundstelle:** `api/locations/index.php:26-35`, Vergleich `api/route/index.php:25-32, 55-57`
- **Beobachtung:** `api/locations/index.php` ruft `avesmapsLoadRouteMapData($config)` +
  `avesmapsBuildRouteNetworkData(...)` — dieselben zwei Aufrufe wie die Diagnose `network-data`
  (`api/route/index.php:56-57`). Der Kommentar direkt darueber (`:26-27`) sagt:
  „Every one of the six diagnostics loads the complete feature table (measured: 62 MB resident, peak
  152 MB per call)" — und deshalb steht in `:30-32` `avesmapsRequireUserWithCapability('edit')`
  fuer die Diagnosen. Der oeffentliche Endpunkt hat diesen Schutz nicht. Er liest ausserdem
  **keinen einzigen Query-Parameter** (kein `limit`, `offset`, `bbox`, `q`), setzt weder ETag noch
  `Cache-Control` noch Kompression und antwortet immer mit allen 4 854 Orten.
  Gemessen am Snapshot: 938,1 KB, davon `public_id` 241,8 KB und `id` 208,6 KB — **byteweise identische
  Zwillinge**, also 22 % des Payloads reine Doppelung.
- **Erwartet:** Der stabile oeffentliche Vertrag braucht (a) einen ETag auf `map_revision` — er
  aendert sich selten, fast jede Anfrage koennte 304 sein —, (b) `limit`/`offset` oder wenigstens
  `bbox`, (c) gzip. Eine Sperre wie bei den Diagnosen ist hier falsch (der Endpunkt ist absichtlich
  oeffentlich), ein Cache ist die richtige Antwort.
- **Beleg:** `api/locations/index.php` vollstaendig gelesen (93 Zeilen, kein `$_GET` darin);
  `api/route/index.php:14-57` gelesen; Feldgroessen per node aus
  `snapshots/locations-api.json` gezaehlt; `api/README.md:141-166` dokumentiert keinen Parameter.
- **Sicherheit:** BELEGT (Kosten-Zahl 62/152 MB ist die Messung des Projekts, nicht meine)
- **Aufwand:** klein (<1h) fuer ETag+gzip, mittel fuer Paginierung

### B3 N+1 im abgeleiteten Politik-Layer: 2 Queries je Derived-Feature (244 bei Zoom 3)
- **Kategorie:** AKUT
- **Fundstelle:** `api/_internal/political/territories-derived-layer.php:61-67`, `:492-516`, `:518-544`
- **Beobachtung:** In `foreach ($derivedFeatures as &$feature)` werden je Feature
  `avesmapsPoliticalReadDerivedSourceTerritoryPublicIds()` **und**
  `avesmapsPoliticalReadDerivedSourceGeometryPublicIds()` aufgerufen. Der M6-Kommentar (`:58-60`)
  sagt, der Snapshot habe den „full political_territory scan per derived feature" beseitigt — das
  stimmt fuer `avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds` (nutzt `$territoriesSnapshot`).
  Die beiden Aufloeser selbst laufen aber unveraendert je Feature in die Datenbank:
  `:499` `$pdo->prepare('SELECT public_id FROM political_territory WHERE id IN (…)')` und
  `:525` `$pdo->prepare('SELECT geometry.public_id FROM political_territory_geometry … IN (…)')`.
  Im Snapshot `political-zoom3.json` tragen **122 von 379** Features
  `derived_source_territory_public_ids` → **244 Queries je Cache-Miss**. Zusaetzlich laeuft
  `avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds` (mit der Nachfahren-Sammlung) **zweimal je
  Feature**, weil beide Aufloeser ihn getrennt rufen.
- **Erwartet:** Beide `IN`-Mengen ueber alle Derived-Features einsammeln und in **zwei** Queries
  aufloesen — dieselbe Form, die `map-features.php` fuer `feature_sources` schon nutzt
  („two collect-queries, no N+1", `:153-159`).
- **Beleg:** Datei gelesen; Feature-Zaehlung per node aus `snapshots/political-zoom3.json`
  (`features: 379`, `mit derived_source_territory_public_ids: 122`).
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (1 Tag)

### B4 Jeder Besucher loest im Minutentakt 2 × `CREATE TABLE` aus
- **Kategorie:** AKUT
- **Fundstelle:** `js/app/visitor-tracking.js:9,149` → `api/app/track.php:35` →
  `api/_internal/analytics/visitor-analytics.php:16-38`
- **Beobachtung:** `VISITOR_PRESENCE_PING_MS = 60000`; der Timer laeuft, solange der Tab offen ist,
  und schickt zusaetzlich bei jedem `visibilitychange` und `pagehide`. `track.php:35` ruft
  ungeschuetzt `avesmapsVisitorAnalyticsEnsureTables($pdo)` — **2 × `CREATE TABLE IF NOT EXISTS`**.
  Bei 20 gleichzeitigen Besuchern sind das 40 DDL-Anweisungen je Minute, dauerhaft, fuer eine
  Anwesenheitsmeldung.
- **Erwartet:** Das Tabellen-Anlegen gehoert einmalig in den Editor-/Setup-Pfad
  (`visitor-metrics.php` waere ein akzeptabler Ort), nicht in den Ping. Genau diese Trennung
  existiert schon als `avesmapsAppSettingGetWithoutDdl` neben `avesmapsAppSettingGet`.
- **Beleg:** beide Dateien gelesen; Zaehlung per `ddl-count.js`
  (`avesmapsVisitorAnalyticsEnsureTables … CREATE=2`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B5 Ein ungebremster 5-Hz-Timer scannt auf jedem Besuchergeraet dauerhaft alle Politik-Features
- **Kategorie:** AKUT
- **Fundstelle:** `js/map-features/map-features-boundary-canvas-overlay.js:755-763`
- **Beobachtung:** `window.setInterval(function(){ … }, 200)` steht auf der obersten Ebene der IIFE
  `initBoundaryCanvasOverlay` (Zeile 15) — **nach** dem Ende des `?labeltune`-Panels (Zeile 748) und
  **ohne** Gate auf `IS_EDIT_MODE`, ohne Stoppbedingung, ohne `clearInterval` irgendwo in der Datei.
  Er iteriert bei jedem Tick das ganze `regionData` (Zoom 3: 379 Eintraege) und baut per `+=` eine
  Signaturzeichenkette. Das sind ~1 900 Iterationen/Sekunde plus String-Allokationen, dauerhaft,
  auch auf dem Handy und auch wenn der Politik-Layer gar nicht sichtbar ist.
  Der Kommentar begruendet ihn mit „robust gegen den cache-fragilen Loader-Hook" — er ersetzt also
  ein Ereignis durch Pollen.
- **Erwartet:** Der Loader ruft nach jedem erfolgreichen Layer-Load ohnehin schon
  `window.AvesmapsBoundaryCanvasOverlay?.redraw?.()`
  (`map-features-political-territory-loader.js:695`) — das ist das Ereignis, das der Timer nachbaut.
  Zumindest gehoert er hinter `IS_EDIT_MODE` und/oder in ein `requestIdleCallback`.
- **Beleg:** Zeilen 15-40, 688-768 der Datei gelesen (kein `return` vor dem Timer, keine Gate-Bedingung);
  `grep -rn "setInterval(" js/` liefert genau diesen Treffer ohne Gate; Feature-Zahl aus
  `snapshots/political-zoom3.json`.
- **Sicherheit:** BELEGT (Code); die konkrete CPU-Last je Geraet ist nicht gemessen
- **Aufwand:** klein (<1h)

### B6 `POLITICAL_LAYER_CACHE` raeumt abgelaufene Eintraege nie weg — der Zeitregler laesst ihn unbegrenzt wachsen
- **Kategorie:** AKUT
- **Fundstelle:** `js/app/api-client.js:124-125, 189-196`
- **Beobachtung:** `const POLITICAL_LAYER_CACHE = new Map()` mit `TTL_MS = 5000`. Eintraege werden in
  `:190` gesetzt, in `:195` nur bei **Fehlschlag** geloescht und in `:141` nur bei einem Edit
  komplett geleert. Es gibt **keinen TTL-Sweep**: ein abgelaufener Eintrag wird zwar nicht mehr
  gelesen, bleibt aber als aufgeloestes Promise mit dem vollstaendigen Layer-Objekt im Speicher.
  Der Cache-Schluessel enthaelt `year_bf` (Regler 0–1049, `index.html:1017`) und `zoom` — beim
  Ziehen des Zeitreglers ueber die Zeitachse entstehen so bis zu 1 050 × 7 Eintraege mit je
  ~2,8 MB rohem Layer.
  **Der Zwillings-Cache im selben Feature macht es richtig:**
  `map-features-political-territory-loader.js:384-389` raeumt explizit ab
  („Evict expired entries so the cache cannot grow unbounded (e.g. timeline scrubbing across many
  years)") — genau die Gefahr, gegen die der eine Cache geschuetzt ist und der andere nicht.
- **Erwartet:** Derselbe Sweep in `api-client.js`, oder eine harte Obergrenze (LRU, z. B. 8 Eintraege).
- **Beleg:** beide Dateien gelesen und gegenuebergestellt; Reglerbereich aus `index.html:1017`
  (`min="0" max="1049"`).
- **Sicherheit:** BELEGT (Code); der tatsaechliche Speicherverbrauch beim Scrubben ist nicht im
  Browser gemessen
- **Aufwand:** klein (<1h)

### B7 Der serverseitige Layer-Cache hat einen Schluesselraum von ~14 700 Dateien und wird nur per `glob`+`unlink` geleert
- **Kategorie:** AKUT
- **Fundstelle:** `api/_internal/political/territories-derived-layer.php:8-38`
- **Beobachtung:** Cache-Datei = `sys_get_temp_dir()/avesmaps_layer_cache/<sha1>.json`, Schluessel aus
  `zoom | year_bf | edit_mode | bbox`. `year_bf` kommt vom Regler (0–1049), `zoom` 0–6,
  `edit_mode` 0/1 → bis zu **14 700 Dateien** von je 0,7–2,8 MB. Es gibt **keine Altersbereinigung**;
  die TTL (300 s bzw. 15 s) verhindert nur das *Lesen* alter Dateien, nicht ihr Liegenbleiben.
  Der einzige Loeschpfad ist `avesmapsPoliticalInvalidateLayerCache()` — `glob('*.json')` +
  `@unlink` je Datei, ausgeloest nur von einem Politik-Schreibvorgang
  (`territories-endpoint.php:237`). Auf NFS ist das dann ein Sturm von n `unlink`-Aufrufen in einem
  Request.
- **Erwartet:** Beim Schreiben der Datei die aeltesten wegraeumen (oder Dateien aelter als 1 h),
  und `year_bf` auf die Werte quantisieren, fuer die es ueberhaupt unterschiedliche Daten gibt.
- **Beleg:** Datei gelesen; Reglerbereich aus `index.html:1017`; Aufrufer
  `territories-endpoint.php:47-58, 108-119, 237` gelesen. Nicht auf dem Server nachgezaehlt
  (keine Live-Anfragen erlaubt).
- **Sicherheit:** PLAUSIBEL (der Schluesselraum ist belegt, der reale Dateibestand nicht)
- **Aufwand:** klein (<1h)

---

## KANN

### B8 Nichts wird komprimiert ausser `map-features.php` — ~5,5 MB je Kaltbesuch verschenkt
- **Kategorie:** KANN
- **Fundstelle:** `.htaccess` (kein `mod_deflate`), `api/_internal/bootstrap.php:164-173`
  (`avesmapsJsonResponse` ohne `Content-Encoding`), Gegenbeispiel `api/app/map-features.php:361-380`
- **Beobachtung:** `.htaccess` regelt `Cache-Control` fuer JS/CSS/HTML/Medien, enthaelt aber
  **keine einzige Kompressionsdirektive**. `avesmapsJsonResponse()` — der Ausgabepfad fast aller
  Endpunkte — setzt nur `Content-Type` und `echo json_encode(...)`. Nur `map-features.php` gzippt
  selbst und begruendet das in `:188` mit der eigenen Messung: „diese Antwort wird vom Server nicht
  komprimiert (gemessen: content-encoding none)". Gemessen an den Snapshots und am Repo:

  | Sache | roh | gzip -6 | Ersparnis |
  |---|---|---|---|
  | JS (215 Dateien aus `index.html`) | 4,13 MB | 1,34 MB | 2,79 MB |
  | CSS (`css/`-Baum, 65 Dateien) | 745 KB | 221 KB | 524 KB |
  | `index.html` | 216 KB | 49 KB | 167 KB |
  | Politik-Layer (zoom 3) | 2,83 MB | 0,73 MB | 2,10 MB |
  | Abenteuer | 1,76 MB | 0,23 MB | 1,53 MB |
  | Landschaften | 1,66 MB | 0,47 MB | 1,19 MB |
  | Locations-API | 0,92 MB | 0,20 MB | 0,72 MB |
  | Kartensammlung | 0,51 MB | 0,05 MB | 0,46 MB |

  Statisch allein (JS+CSS+HTML) sind das **3,48 MB je Erstbesuch**.
- **Erwartet:** Ein `<IfModule mod_deflate.c>`-Block mit `AddOutputFilterByType DEFLATE` fuer
  `text/html application/javascript text/css application/json` in `.htaccess`. Der `<IfModule>`-Rahmen
  macht ihn risikolos, falls STRATO das Modul nicht hat; ist es nicht da, bleibt der zweite Weg,
  `avesmapsJsonResponse()` denselben `gzencode`-Zweig zu geben, den `map-features.php` schon hat.
- **Beleg:** `.htaccess` Zeilen 1-60 gelesen; `bootstrap.php:164-173` gelesen; alle Zahlen mit
  `zlib.gzipSync(level 6)` in node ueber die echten Dateien bzw. `snapshots/` gemessen
  (`scratchpad/systemtest/assets.js`).
- **Sicherheit:** BELEGT fuer „keine Kompressionsdirektive + gemessene Groessen";
  PLAUSIBEL dafuer, dass `mod_deflate` auf STRATO verfuegbar ist
- **Aufwand:** klein (<1h)

### B9 `properties.updated_at` wird von keinem Frontend-Modul gelesen — 0,43 MB in jedem Payload
- **Kategorie:** KANN
- **Fundstelle:** `api/app/map-features.php:456`, Payload-Feld `properties.updated_at`
- **Beobachtung:** Jedes der 11 486 Features traegt `updated_at` (0,427 MB gesamt). `grep -rn
  "updated_at" js/ --include=*.js` liefert **genau zwei Dateien**: `review-wiki-sync.js` (liest
  `run.updated_at` aus der WikiSync-Antwort) und `territory-editor-embedded.js` (DDL-Text in einem
  String). Weder `index.html` noch `html/*.html` lesen es. Das Feld reist also 11 486-mal mit,
  ohne dass es je jemand nachschlaegt — dieselbe Lage wie beim schon entfernten `svg_id`
  (`map-features.php:532-539`).
- **Erwartet:** Streichen wie `svg_id`, mit `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION`-Bump.
  ⚠️ Vorher pruefen, ob der Editor-Delta-Pfad (`since_revision`) es braucht — im JS steht es nicht.
- **Beleg:** `grep -rn "updated_at" js/ --include=*.js` (6 Treffer, alle in den zwei genannten
  Dateien), `grep -c "updated_at" index.html` = 0, `grep -rn … html/` = 1 (Diagnoseseite mit
  anderem Payload); Groesse per node ueber `snapshots/map-features.json`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B10 `political.hierarchy` wiederholt 7 948 Knoten, von denen nur 844 verschieden sind
- **Kategorie:** KANN
- **Fundstelle:** `api/app/map-features.php:812-821` (`$hierarchy[] = [...]` je Kettenglied)
- **Beobachtung:** `properties.political` ist mit **2,037 MB** das groesste Einzelfeld des Payloads;
  davon **1,518 MB nur `hierarchy`**. Gemessen: 7 948 Hierarchie-Knoten auf 2 622 Orten, davon
  **844 verschieden**; 736 verschiedene Ketten. Jeder Knoten traegt `name`, `short_name`, `type`,
  `territory_public_id`, `coat_url` — „Kaiserreich Mittelreich" mit seinem Wappen-URL steht so
  hunderte Male im selben Payload.
  Der Payload kennt das Muster bereits und begruendet es selbst: `climate_zones` reist als
  Woerterbuch, weil sonst „sieben Strings 4.650-mal" wiederholt wuerden (`map-features.php:205-207`),
  und `source_catalog` ist genau dieselbe Bauart.
- **Erwartet:** `territory_nodes` als geteiltes Woerterbuch auf Payload-Ebene, `hierarchy` als
  Index-Liste — die Bauart, die zwei Nachbarfelder im selben Payload schon haben.
- **Beleg:** node-Auszaehlung ueber `snapshots/map-features.json`
  (`hierarchy 1.518 MB · 7948 Knoten · 844 verschieden · 736 Ketten`);
  Nachbau gemessen in `scratchpad/systemtest/payload-trim.js`: **−1,36 MB roh, −58 KB gzip**.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (1 Tag — Server + `feature-source-markup`/Popup-Leser + Payload-Version)

### B11 `reference_kind` reist 60 185-mal als 12-Zeichen-Wort fuer 3 moegliche Werte
- **Kategorie:** KANN
- **Fundstelle:** `api/app/map-features.php:914-916`, Payload-Block `feature_sources`
- **Beobachtung:** Der Block `feature_sources` ist **5,543 MB** = 28 % des ganzen Payloads
  (61 482 Referenzen ueber 6 256 Schluessel: path 2,53 MB · settlement 1,40 · region 0,90 ·
  territory 0,66 · citymap 0,04). Davon entfallen **1,626 MB auf `reference_kind`** —
  und das Feld hat genau drei Werte: `erwaehnung` (29 742×), `ergaenzend` (20 590×),
  `ausfuehrlich` (9 853×). Weitere 1,098 MB gehen auf `pages`, 1,297 MB auf `note`.
- **Erwartet:** Ein-Zeichen-Enum (oder Index in eine Payload-Vokabelliste, wie `climate_zones`).
  ⚠️ Ehrlich dazu: **am Draht bringt das nur 25 KB** — wiederholte Woerter komprimiert gzip fast
  vollstaendig weg. Der Gewinn ist die `JSON.parse`-Zeit und der Heap im Browser.
- **Beleg:** node-Auszaehlung ueber `snapshots/map-features.json`; Ersatzmessung in
  `payload-trim.js`: **−0,54 MB roh, −25 KB gzip**. Frontend-Leser existieren
  (`js/ui/feature-source-markup.js:67-96`) — das Feld ist also **nicht** tot, nur teuer kodiert.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B12 `feature.id` ist der Zwilling von `properties.public_id` (0,48 MB), `id`/`public_id` in der Locations-API ebenso (208 KB)
- **Kategorie:** KANN
- **Fundstelle:** `api/app/map-features.php:500` bzw. `api/locations/index.php:62-63`
- **Beobachtung:** Im Kartenpayload steht die public_id zweimal: als `feature.id` und als
  `properties.public_id` (11 486 Features, 0,493 MB). Alle 12 Leser im Frontend lesen die Kette
  `properties.public_id || feature.id` (z. B. `map-features-feature-dispatcher.js:92`,
  `map-features-labels.js:19`), nur `map-features-path-lifecycle.js:47` und
  `map-features-powerlines.js:493/603` fangen mit `feature.id` an. In der Locations-API sind
  `id` und `public_id` in allen 4 854 Zeilen byteweise identisch (208,6 + 241,8 KB von 938 KB).
- **Erwartet:** Eine ID. In `map-features` ist die Reihenfolge der Leser vorher umzudrehen (drei
  Stellen), dann faellt `feature.id`; in der Locations-API ist `id` schlicht doppelt.
- **Beleg:** node-Auszaehlung ueber beide Snapshots; `grep -rn "feature\.id\b" js/` (13 Treffer,
  gelesen); Messung in `payload-trim.js`: **−0,48 MB roh, −63 KB gzip**.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B13 Drei Wiki-Unterfelder reisen mit, die niemand liest (0,23 MB)
- **Kategorie:** KANN
- **Fundstelle:** `properties.wiki_settlement.synced_at` / `.match_key`, `wiki_path.synced_at` /
  `.course_hash`, `wiki_region.synced_at`
- **Beobachtung:** Gemessen: `synced_at` 0,0726 + 0,0664 + 0,0196 MB, `match_key` 0,0426 MB,
  `course_hash` 0,0304 MB = **0,232 MB**. Im Frontend: `grep -rn "synced_at" js/` = 1 Treffer
  (`review-label-wiki.js:75`, liest `row.synced_at` aus einer WikiSync-Staging-Antwort, nicht aus dem
  Kartenpayload), `match_key` = 1 Treffer (ein Kommentar in `review-path-sync.js:1049`),
  `course_hash` = **0 Treffer**.
- **Erwartet:** Serverseitig aus dem Payload-Zweig streichen (Payload-Version heben).
- **Beleg:** node-Auszaehlung ueber `snapshots/map-features.json`; die drei greps ausgefuehrt und
  die Treffer einzeln gelesen; Messung in `payload-trim.js`: **−0,23 MB roh, −29 KB gzip**.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B14 1 079 KB Editor-Code (26 % allen JS) laedt jeder oeffentliche Besucher mit
- **Kategorie:** KANN
- **Fundstelle:** `index.html` (215 `<script src>`-Tags, keiner mit `defer`/`async`)
- **Beobachtung:** Gemessen ueber die Tags in `index.html`: **4,13 MB JS in 215 Dateien**,
  davon `js/review/` **913 KB (47 Dateien)** und `js/territory/` **166 KB (9 Dateien)**.
  Die groessten Einzelposten sind Editor-Werkzeuge: `review-wiki-sync.js` 164 KB,
  `review-path-sync.js` 64 KB, `review-settlement-list.js` 63 KB. Keine dieser Dateien hat in den
  ersten 40 Zeilen ein `IS_EDIT_MODE`-Gate, und im `index.html` steht kein bedingtes Laden.
  Alle 215 Tags sind klassische, blockierende `<script>` (5 im `<head>`, 209 am Ende des `<body>`) —
  **kein einziges `defer`, kein `async`**; die Ausfuehrung ist damit streng sequentiell.
  Nebenbefund: `js/app/i18n-en.js` (70 KB) laedt auch ohne `?lang=en`.
- **Erwartet:** Die Editor-Buendel serverseitig nur im Edit-Modus in die Seite schreiben (der
  Einstiegspunkt `edit/index.php` existiert bereits), oder wenigstens `defer` auf allen Tags —
  das aendert an der Ausfuehrungsreihenfolge nichts (die bleibt die Dokumentreihenfolge und damit
  der in AGENTS.md §3 genannte Vertrag), gibt dem Parser aber die Seite frei.
- **Beleg:** `scratchpad/systemtest/assets.js` (Groessen je Verzeichnis aus den echten Dateien);
  `grep -c '<script src=' index.html` = 214, `grep -c 'defer'`/`'async'` in den Tags = 0;
  `head -40` der fuenf groessten Editor-Dateien auf `IS_EDIT_MODE` geprueft (0 Treffer).
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (1 Tag)

### B15 Die Killschalter von Abenteuer/Kartensammlung legen bei jedem Aufruf `app_setting` an
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/citymaps.php:348, 367`, `api/_internal/app/adventures.php:172, 192`
- **Beobachtung:** `avesmapsCitymapsEnabled`, `avesmapsCitymapPreviewsEnabled`,
  `avesmapsAdventuresEnabled` und `avesmapsAdventuresCoversEnabled` rufen alle
  `avesmapsAppSettingGet()`, und das ist die Variante **mit** `CREATE TABLE IF NOT EXISTS app_setting`
  (`api/_internal/app/app-setting.php:19-25`). Der Kommentar in derselben Datei (`:50-52`) nennt das
  ausdruecklich „the very antipattern AGENTS.md §10 lists" und stellt
  `avesmapsAppSettingGetWithoutDdl()` daneben — genutzt wird die richtige Variante von
  `map-features.php` und `map-search.php`, nicht aber hier.
  Damit kostet ein oeffentliches `GET /api/app/citymaps.php`: 2 × AppSettingGet (2 CREATE) +
  `avesmapsCitymapsEnsureTables` (5 CREATE + 1 `information_schema`) +
  `avesmapsLinkCheckEnsureTables` (2 CREATE) = **9 `CREATE TABLE`**.
  Ein `GET /api/app/adventures.php`: 2 + 3 + 2 = **7 `CREATE TABLE` und 7 `information_schema`**.
- **Erwartet:** `avesmapsAppSettingGetWithoutDdl` (fail-open auf den Default) — die Funktion existiert
  genau dafuer.
- **Beleg:** alle genannten Funktionen gelesen; Zaehlung per `ddl-count.js`
  (`avesmapsCitymapsEnsureTables CREATE=5 info_schema=1`,
  `avesmapsAdventuresEnsureTables CREATE=3`, `avesmapsLinkCheckEnsureTables CREATE=2`);
  die 7 `information_schema`-Ausfuehrungen in `adventures.php:80-134` manuell aufgeloest
  (1 + 5 aus der Spaltenschleife + 1).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B16 Der Abenteuer-/Landschaften-Ensure fragt Spalte fuer Spalte — der richtige Weg steht in der Nachbardatei
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/adventures.php:80-134`, `api/_internal/app/ecosystem.php:321-339,
  440-465, 570-600`; Gegenbeispiel `api/_internal/app/citymaps.php:244-250`
- **Beobachtung:** Beide fragen je Spalte einzeln `SELECT COUNT(*) FROM information_schema.COLUMNS`
  (Abenteuer 7×, Landschaften 16×). `citymaps.php` loest dasselbe Problem mit **einer** Abfrage
  („Fetch the existing column set in ONE information_schema query, then check in PHP. … per request
  against information_schema — a needless load multiplier (see php-pool hang, 2026-07-17)").
  Es gibt also im selben Verzeichnis ein Muster, eine Begruendung und einen Vorfall dazu — und zwei
  Dateien, die es nicht uebernommen haben.
- **Erwartet:** Ein `SELECT COLUMN_NAME … WHERE TABLE_NAME IN (…)` je Ensure, danach Pruefung in PHP.
- **Beleg:** alle drei Stellen gelesen; `grep -c "columnExists"` bzw. `information_schema` in den
  Funktionsrumpfen ausgezaehlt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B17 Der Editor-Delta-Poll liefert alle 15 s mindestens 5,87 MB, auch wenn sich ein Punkt bewegt hat
- **Kategorie:** KANN
- **Fundstelle:** `js/routing/routing.js:278-286` (Timer) → `api/app/map-features.php:190-209`
- **Beobachtung:** Im Edit-Modus laeuft `setInterval(pollLiveMapUpdates, 15000)` gegen
  `map-features.php?since_revision=N`. Der ETag verhindert die Antwort, solange sich nichts aendert
  (gut). Sobald sich aber **irgendetwas** aendert, baut der Endpunkt die payload-weiten Bloecke
  ungefiltert neu und schickt sie mit: `feature_sources` 5,543 MB + `source_catalog` 0,216 MB +
  `in_settlement_places` 0,113 MB = **5,87 MB Sockel**, unabhaengig davon, dass `since_revision`
  vielleicht ein einziges Feature liefert. Bei mehreren gleichzeitig offenen Editoren multipliziert
  sich das.
- **Erwartet:** Bei gesetztem `since_revision` die drei Bloecke weglassen (oder auf die betroffenen
  `public_id`s einschraenken) — der Client hat sie aus dem Erstladen schon.
- **Beleg:** `routing.js:278-286` und `map-features.php:100-209` gelesen; Blockgroessen per node aus
  `snapshots/map-features.json`.
- **Sicherheit:** BELEGT (Code + gemessene Groessen); der Live-Fall ist nicht nachgestellt
- **Aufwand:** klein (<1h)

### B18 Der `zoomend`-Handler schreibt bei jedem Zoom per `querySelectorAll` in jedes Regionen-Label
- **Kategorie:** KANN
- **Fundstelle:** `js/app/bootstrap.js:137-149`
- **Beobachtung:** Der Handler macht `document.querySelectorAll(".region-label").forEach(e =>
  e.style.fontSize = size + "px")` und ruft danach `syncLabelIcons()`, `syncPathRendering()`,
  `syncPathLabels()`, `syncPowerlineLabels()` und `schedulePoliticalTerritoryLayerReload()` —
  fuenf vollstaendige Neusynchronisationen plus ein Netzabruf, in einem synchronen Handler.
  Der Schriftgroessen-Teil ist reines CSS (`9 + zoom*3` px) und liesse sich mit einer
  `--region-label-size`-Variable am Kartencontainer in **einem** Stilschreibvorgang erledigen,
  statt in n Inline-Styles.
- **Erwartet:** Schriftgroesse ueber eine CSS-Variable, Rest in `requestAnimationFrame`.
- **Beleg:** `js/app/bootstrap.js:137-155` gelesen. Die Anzahl der `.region-label`-Elemente ist
  **nicht gemessen** (keine Browser-Sitzung); sie liegt in der Groessenordnung der Politik-Features
  (379 bei Zoom 3, mehr bei hoeherem Zoom).
- **Sicherheit:** PLAUSIBEL
- **Aufwand:** klein (<1h)

### B19 `coat.php` macht bis zu 6 NFS-`is_file`-Proben je Wappen und raeumt seinen Cache nie auf
- **Kategorie:** KANN
- **Fundstelle:** `api/app/coat.php:15-22, 131-136, 150-159`
- **Beobachtung:** Die Cache-Suche laeuft `foreach (AVESMAPS_COAT_EXT_TYPES as $ext => …)` mit
  **6 Endungen** (png/jpg/jpeg/svg/gif/webp) und ruft je Endung `is_file()` — beim Treffer auf `.webp`
  also 6 Proben, beim Miss ebenfalls 6. Der Zielordner `/uploads/wappen/cache` wird nie beschnitten;
  jede je angefragte Wappen-URL bleibt dort dauerhaft liegen.
  Nebenbefund im selben Bereich: `avesmapsCoatUrlCacheBust()` (`api/_internal/coat-url.php:34`)
  ruft `@filemtime()` je verschiedener Upload-URL — im Kartenpayload sind das **392 verschiedene
  `/uploads/wappen`-URLs** (und 88 `/uploads/siedlungen`), also bis zu 480 NFS-`stat`-Aufrufe je
  ungecachtem `map-features`-Request. Die statische Memoisierung in `:19/:26-28` verhindert
  immerhin, dass es die 6 753 Vorkommen werden.
- **Erwartet:** Endung in der Cache-Datei mitfuehren (z. B. `<sha1>.ext` in einer Indexdatei oder
  `glob($dir.'/'.$key.'.*')` — ein Verzeichniszugriff statt sechs), und einen Aufraeumlauf.
  Fuer die 480 `filemtime` waere der `mtime` in der Datenbank die billigere Wahrheit.
- **Beleg:** `api/app/coat.php` gelesen; URL-Auszaehlung per node ueber `snapshots/map-features.json`
  (`upload-URLs gesamt: 6753, verschieden: 480, wappen: 392, siedlungen: 88`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

### B20 Im Politik-Modus laedt/zeichnet jedes `moveend` die ganze Ebene neu — der Pan-Riegel gilt nur den anderen Modi
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/map-features-political-territory-loader.js:625-631`,
  `js/app/bootstrap.js:151-155`
- **Beobachtung:** `schedulePoliticalTerritoryLayerReload` hat einen Pan-Riegel — aber ausdruecklich
  nur fuer die Grenzen-Modi: „Im political-Modus (Fuellung/Edit/Timeline) bleibt das bisherige
  Lade-auf-jedes-moveend." Netzseitig faengt der 5-s-`POLITICAL_LAYER_CACHE` das meist ab (gleiche
  URL bei gleichem Zoom+Jahr), aber der Render-Pfad laeuft trotzdem voll durch:
  `clearRenderedRegionLayers()` und danach `addRegionFeatureToMap()` fuer **alle** Features
  (379 bei Zoom 3), plus `syncRegionVisibility()`, zwei Canvas-Redraws und die Label-Kollision
  (`:686-706`). Das ist ein kompletter Layer-Neuaufbau je Verschieben.
- **Erwartet:** Denselben Riegel wie in den anderen Modi (unveraenderter Zoom + geladene Daten →
  kein Neuaufbau), da die Anfrageparameter beim reinen Pannen ohnehin identisch sind.
- **Beleg:** beide Dateien gelesen (`:601-645` und `:656-720`); Feature-Zahl aus
  `snapshots/political-zoom3.json`.
- **Sicherheit:** BELEGT (Code); die Renderzeit ist nicht im Browser gemessen
- **Aufwand:** klein (<1h)

### B21 AGENTS.md §10 und §1 sind an zwei Performance-Stellen ueberholt
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:254-256` und `AGENTS.md:15-17`
- **Beobachtung:** (a) §10 sagt: „`territories-endpoint.php` runs DDL + metadata probes before its
  cache read on every political-layer request". Das ist **behoben**:
  `api/_internal/political/territories-endpoint.php:41-59` hat einen Fast-Path, der den Cache
  **vor** `avesmapsCreatePdo` und vor beiden `Ensure`-Aufrufen liest, mit genau dieser Begruendung
  im Kommentar. Wer §10 liest, sucht den Fehler an der falschen Stelle — und uebersieht, dass
  **`ecosystem-areas.php` heute genau das tut, was §10 dem Politik-Layer noch nachsagt** (B1).
  (b) §1 sagt „`index.html` hand-includes ~117 `<script>`/`<link>` tags" — tatsaechlich sind es
  **214 `<script src>` + 15 `<link>`**, also fast das Doppelte.
- **Erwartet:** §10 auf `ecosystem-areas.php` umschreiben, §1 auf die echte Zahl.
- **Beleg:** `territories-endpoint.php:41-63` gelesen; `grep -c '<script src=' index.html` = 214,
  `grep -c '<link' index.html` = 15.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

## ZUKUNFT

### B22 Brotli statt gzip fuer den Kartenpayload waere 4,5-mal so viel wie das ganze Feld-Aufraeumen
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `api/app/map-features.php:366-375`
- **Beobachtung:** Gemessen am echten Payload: gzip -6 = 2,742 MB (das ist der heutige Stand),
  gzip -1 = 3,27 MB, **brotli q5 = 1,86 MB**. Das sind **−0,88 MB** gegenueber heute — waehrend
  alle fuenf Payload-Kuerzungen aus B9–B13 zusammen nur **−196 KB gzip** bringen.
  Die CPU-Zeit ist vergleichbar (node: gzip -6 179 ms, brotli q5 166 ms).
- **Erwartet:** `if (str_contains($accept, 'br') && function_exists('brotli_compress'))` vor dem
  gzip-Zweig, mit gzip als Rueckfall. ⚠️ Ob PHP auf STRATO die Brotli-Erweiterung hat, ist **nicht
  geprueft** (keine Live-Anfragen); ohne sie bliebe nur `mod_brotli` in `.htaccess`.
- **Beleg:** `zlib.brotliCompressSync(quality 5)` in node ueber `snapshots/map-features.json`.
- **Sicherheit:** BELEGT fuer die Groessen, PLAUSIBEL fuer die Verfuegbarkeit
- **Aufwand:** klein (<1h)

### B23 `GET /api/locations/` braucht `limit`/`bbox`/`q` — der Testlauf selbst ist darueber gestolpert
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `api/locations/index.php`, `api/README.md:141-166`
- **Beobachtung:** Die Vorbereitung dieses Systemtests hat `?limit=25` angefragt und 960 KB bekommen.
  Der Parameter ist nicht dokumentiert und wird nicht gelesen (B2) — aber genau so wird ein fremder
  Entwickler den Endpunkt anfassen. Der Vertrag ist als „stabile oeffentliche Entwickler-API"
  ausgewiesen (AGENTS.md §4) und hat keinen einzigen Filter.
- **Erwartet:** `limit`/`offset` (Default z. B. 500), `bbox`, `q` als Praefixsuche — und
  unbekannte Parameter entweder ehrlich mit `400 invalid_request` ablehnen oder dokumentieren.
- **Beleg:** `api/locations/index.php` vollstaendig gelesen (kein `$_GET`); `api/README.md:141-166`;
  Snapshot `locations-api.json` mit `location_count` = 4854 bei angefragtem `limit=25`.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (1 Tag)

---

## Was ich geprueft und NICHT als Befund gewertet habe

- **`api/app/map-features.php` selbst ist sauber gebaut.** ~20 Queries, **kein DDL**, ETag vor
  jeder teuren Arbeit, Sammel-Queries statt N+1, expliziter Kommentar an jeder Stelle, warum die
  DDL-freie Variante genommen wurde. Es ist die Referenz, an der die anderen Endpunkte gemessen
  gehoeren — nicht umgekehrt.
- **Der Politik-Layer-Fast-Path** (`territories-endpoint.php:41-59`) und das bewusste Weglassen von
  `LOCK_EX` (`:133-135`, `coat.php:154-155`) sind belegt begruendete Entscheidungen (NFS-Lock-Daemon,
  Vorfall 2026-07-17) — kein Befund.
- **Der Voll-Graphbau je Route** (`api/route/index.php:321-325`) ist bekannt, mit `set_time_limit(30)`
  begrenzt und im Code begruendet — kein neuer Befund.
- **Die Spotlight-Poller** (`spotlight-search-focus.js:243, 390`, je 150 ms) haben Stoppbedingungen
  und laufen nur waehrend einer Interaktion.
- **`map-search.php`** nutzt durchgaengig `…WithoutDdl` und begruendet das (`:83-89`) — vorbildlich.
- **Bekannte 💣-Fallen aus AGENTS.md** (Umlaut-Faltung, fehlende Konturen im Frontend, ×25-Gewicht,
  ein-Member-gzip beim Backup, `overflow-anchor: none`) habe ich nicht als Befunde gefuehrt.

## Verwendete Messskripte (im Arbeitsverzeichnis)

- `ddl-count.js` — zaehlt CREATE/ALTER/`information_schema` je `Ensure`-Funktion
- `nplus1.js` — findet DB-Aufrufe innerhalb von `foreach`/`while` in `api/`
- `assets.js` — Groessen der 215 `<script src>` + CSS-Baum aus `index.html`
- `payload-trim.js` — misst jede Payload-Kuerzung roh **und** gzip gegen den echten Snapshot

Keine einzige Netzwerkanfrage an avesmaps.de. Nichts committet, nichts gepusht, keine Datei im
Arbeitsbaum veraendert.
