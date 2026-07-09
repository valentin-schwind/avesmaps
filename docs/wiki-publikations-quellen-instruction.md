# Wiki-Publikationsquellen — Umsetzungs-Instruction

> **Für die ausführende Session:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen)
> oder `superpowers:executing-plans`, Task für Task. Schritte mit `- [ ]` abhaken.
> **Design/Begründung: `docs/wiki-publikations-quellen-design.md` (§1–§12) — HIER zuerst lesen.** Diese Datei ist das „Wie".

**Goal:** Original-Publikationsquellen aus Wiki Aventurica automatisch als `sources`/`feature_sources` je Kartenelement
führen — als Phase im Dump+Sync, ohne manuelle Overrides je zu überschreiben, und in der Infobox flackerfrei (Quellen
reisen in der map-features-Payload mit).

**Architecture:** Neue Dump+Sync-Phase parst Publikationsseiten (`{{Infobox Produkt}}`) → Katalog und Entity-Seiten
(`==Publikationen==`) → Referenzen, und reconciled sie in eine **Wiki-Ebene** (`origin='wiki_publication'`) von
`feature_sources`; manuelle/community Ebenen bleiben unangetastet. Die Anzeige liest die Quellen aus der
map-features-Payload (geteilter Katalog + schlanke Referenzen), rendert synchron; der bisherige Lazy-Pro-Popup-Fetch
entfällt.

**Tech Stack:** PHP 8 (strict) + MySQL PDO, Vanilla-JS, Leaflet 1.9.4, kein Build. Tests: standalone PHP-Assert-Skript
(`php <datei>`), node-assert (`node <datei>`), `php -l`, `node --check`.

## Global Constraints (gelten für JEDE Task — verbatim aus Spec §2)

- **Wiki-Daten NUR aus Dump/API, KEINE HTML-Crawls** (Betreiber-Policy). Roh-Wikitext aus dem Dump über den
  bestehenden Dump-Reader; Template-Definitionen (F-Shop/PDF-Shop) via `?action=raw` der Template-Seite (API, erlaubt).
- **STRATO: keine schweren Loops** — Phase gechunkt/resumable über `wiki_sync_runs`; keine Pro-Publikation-HTTP-Fetches im Loop.
- **Override-Garantie (hart):** Reconcile schreibt/löscht AUSSCHLIESSLICH `origin='wiki_publication'`. `manual` und
  freigegebene `community`-Zeilen werden NIE angefasst; manuell entfernte Wiki-Zeilen bleiben entfernt (Suppression-Tombstone).
- **Idempotenz:** Identität je Publikation = `wiki_key`; wiederholte Läufe aktualisieren statt zu duplizieren.
- **Erweitern statt neu bauen:** bestehende Tabellen/Funktionen/Komponenten erweitern; neue Tabellen nur im `wiki_*_staging`-Muster.
- **Gold-Envelope** (`{ok:true,…}` / `{ok:false,error:{code,message}}`); **Deutsch-UI**; interne Fehlermeldungen/Code EN; kein `getMessage()`-Leak.
- **Geteilter Checkout:** `git status` zuerst, NUR selbst berührte Dateien per Pfad stagen, nie `git add -A`. Kleine Commits, nach Push Remote-SHA prüfen.
- **Agent baut nur** — der eigentliche Sync-Lauf (Prod-Write) ist owner-getriggert; der Agent verifiziert Parser/Anzeige, nicht den Prod-Reconcile.

## File Structure

- **Modify** `api/_internal/app/feature-sources.php` — Schema-Erweiterung (`sources` 8er-Typ + url-los; `feature_sources`
  +Spalten +Suppression); `origin`-Parameter in Upsert/Link.
- **Create** `api/_internal/wiki/publication-parsing.php` — reine Parser (Infobox Produkt, Publikationen-Sektion, Seiten-Ref, URL-Bau).
- **Create** `api/_internal/wiki/publication-sync.php` — Staging-DDL (`wiki_publication_catalog`, `wiki_entity_publication`), Reconcile, Phasen-Orchestrierung.
- **Modify** dump+sync-Orchestrator (`api/_internal/wiki/locations.php` / `dump-entity-scan.php` — die Session lokalisiert die Phasen-Registrierung) — neue Phase „publication_sources" einhängen.
- **Modify** `api/app/map-features.php` (+ ggf. `api/_internal/map/features.php`) — Quell-Katalog + Referenzen in die Payload.
- **Modify** `js/ui/feature-source-markup.js` (`buildSourceListMarkup`) — Seiten/`reference_kind`/url-los rendern.
- **Modify** `js/ui/popups.js` — Lazy-Pfad entfernen, Builder rendern synchron aus Payload.
- **Modify** die Popup-Builder (`map-features-location-marker-entry.js`, `map-features-labels.js`, `map-features-path-rendering.js`, `map-features-region-info-markup.js`, `routing.js`) — Quellen aus Feature-Daten statt Platzhalter.
- **Modify** `js/review/review-feature-sources.js` — 8er-Typ-Dropdown, Wiki-„automatisch"-Gruppe, Entfernen=Suppression.
- **Create** `api/_internal/wiki/__tests__/publication-parsing-test.php`, `js/ui/__tests__/feature-source-markup.test.js` (falls fehlt) — Tests.

---

### Task 1: Schema erweitern (`sources` + `feature_sources` + Staging)

**Files:** Modify `api/_internal/app/feature-sources.php`; Create `api/_internal/wiki/publication-sync.php` (nur die DDL-Funktion in dieser Task).

**Interfaces — Produces:**
- `avesmapsFeatureSourceUpsert(PDO,$url,$label,$type,$official,$userId,$wikiKey='')` — `$wikiKey!==''` → url-lose Quelle erlaubt (`url=''`, `url_hash=SHA256('wikipub:'.$wikiKey)`); `$type`-Whitelist = die 8 Typen.
- `avesmapsFeatureSourceLink(PDO,$entityType,$publicId,$sourceId,$userId,$origin='manual',$refKind=null,$pages=null,$note=null)`.
- `avesmapsEnsurePublicationStagingTables(PDO)` — `wiki_publication_catalog` + `wiki_entity_publication`.

- [ ] **Step 1 — `feature_sources`-Spalten (self-healing).** In `avesmapsEnsureFeatureSourceTables`: nach dem `CREATE TABLE`
  je Spalte ein self-healing `ALTER TABLE` (das Projekt-Muster für Spalten-Adds auf existierende Tabellen suchen — z. B.
  wie `wiki_sync_pages` seine `building_type/coat_url/...`-Spalten bekommt; sonst `ADD COLUMN` in try/catch, Duplicate-Column ignorieren):
  `origin VARCHAR(24) NOT NULL DEFAULT 'manual'`, `reference_kind VARCHAR(16) NULL`, `pages VARCHAR(120) NULL`, `note VARCHAR(200) NULL`.
  `status` existiert schon; neuer erlaubter Wert `'suppressed'`.
- [ ] **Step 2 — 8er-Typ-Whitelist** in `avesmapsFeatureSourceUpsert`: `['regionalspielhilfe','abenteuer','aventurischer_bote','quellenband','roman','briefspiel','regelbuch','sonstiges']`; unbekannt → `'sonstiges'`.
- [ ] **Step 3 — url-lose Identität.** `avesmapsFeatureSourceUpsert` um `$wikiKey=''` erweitern: wenn `$url===''` UND `$wikiKey!==''` → `$hash = hash('sha256','wikipub:'.$wikiKey)`, sonst wie bisher `hash('sha256',$url)`. Der Aufruf-Contract für Publikationen: url-lose Quelle IMMER mit `$wikiKey`.
- [ ] **Step 4 — `origin`/Referenz-Felder in Link.** `avesmapsFeatureSourceLink` um `$origin,$refKind,$pages,$note` erweitern; `INSERT … ON DUPLICATE KEY UPDATE` aktualisiert `reference_kind/pages/note` (aber NICHT `origin`, wenn schon `manual`). Bestehende Aufrufer (Editor) rufen ohne die neuen Args → Default `origin='manual'`, Rest `null` (rückwärtskompatibel).
- [ ] **Step 5 — Staging-DDL** in `publication-sync.php`, `avesmapsEnsurePublicationStagingTables(PDO)`:
  `wiki_publication_catalog(wiki_key VARCHAR(190) PK, title VARCHAR(300), art VARCHAR(80), source_type VARCHAR(32), isbn VARCHAR(20), f_shop_url TEXT, pdf_shop_url TEXT, chosen_url TEXT, has_link TINYINT(1), synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))`;
  `wiki_entity_publication(id BIGINT UNSIGNED AUTO_INCREMENT PK, entity_wiki_key VARCHAR(190), publication_wiki_key VARCHAR(190), reference_kind VARCHAR(16), pages VARCHAR(120) NULL, note VARCHAR(200) NULL, UNIQUE KEY uq(entity_wiki_key,publication_wiki_key))`. Beide `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`.
- [ ] **Step 6 — `php -l`** auf beide Dateien (Erwartung: „No syntax errors"). **Commit** (`git add` nur diese zwei Dateien).

> Schema-Verifikation echt = beim ersten Phasenlauf (self-healing, owner-getriggert). Hier reicht `php -l` + Idempotenz durch `IF NOT EXISTS`/try-catch.

---

### Task 2: Reine Parser (Infobox, Publikationen-Sektion, Seiten-Ref)

**Files:** Create `api/_internal/wiki/publication-parsing.php`; Create `api/_internal/wiki/__tests__/publication-parsing-test.php`.
**Consumes:** `avesmapsWikiSyncMonitorExtractInfoboxBlock`, `avesmapsWikiSyncMonitorParseTemplateParams` (aus `sync-monitor-parsing.php`).
**Produces (reine Funktionen):**
- `avesmapsWikiParsePageRef(string $text): array` → `['pages'=>string|null,'note'=>string|null]`.
- `avesmapsWikiParsePublicationsSection(string $wikitext): array` → Liste `['title'=>…,'reference_kind'=>…,'pages'=>…,'note'=>…]`.
- `avesmapsWikiParseProductInfobox(string $wikitext): ?array` → `['title'=>…,'art'=>…,'source_type'=>…,'isbn'=>…,'f_shop_pid'=>…,'pdf_shop_id'=>…]`.
- `avesmapsWikiMapArtToSourceType(string $art, string $unterkategorie=''): string`.

- [ ] **Step 1 — Test `avesmapsWikiParsePageRef` (schreiben, MUSS fehlschlagen).** In `publication-parsing-test.php`:
  ```php
  require __DIR__ . '/../publication-parsing.php';
  $r = avesmapsWikiParsePageRef("Seite 54");        assert($r['pages'] === '54' && $r['note'] === null);
  $r = avesmapsWikiParsePageRef("Seiten 40, '''145'''"); assert($r['pages'] === '40, 145' && $r['note'] === null);
  $r = avesmapsWikiParsePageRef("Seite 176 <small>(Zerstörung)</small>"); assert($r['pages'] === '176' && $r['note'] === 'Zerstörung');
  $r = avesmapsWikiParsePageRef("");                 assert($r['pages'] === null && $r['note'] === null);
  echo "pageref ok\n";
  ```
- [ ] **Step 2 — `php api/_internal/wiki/__tests__/publication-parsing-test.php`** → Erwartung: Fatal „call to undefined function".
- [ ] **Step 3 — Implementieren** `avesmapsWikiParsePageRef`: Fettung `'''` strippen, `<small>…</small>`/Klammer-Inhalt als `note` extrahieren, Ziffern-Gruppen (mit `,`) als `pages` normalisieren (Format `"40, 145"`); leer/keine Ziffern → `pages=null`.
- [ ] **Step 4 — Test läuft grün** (`php …test.php` → „pageref ok").
- [ ] **Step 5 — Test `avesmapsWikiParsePublicationsSection`** anhängen (nutze das verifizierte A'Sarar-Beispiel aus Spec §3):
  ```php
  $wt = "==Publikationen==\n===Ausführliche Quellen===\n*[[Efferds Wogen]] Seite 54\n*[[Im Bann des Diamanten]] Seiten 40, '''145'''\n===Erwähnungen===\n*[[Historia Aventurica]] Seite 176 <small>(Zerstörung)</small>\n===Bildquellen===\n*[[Egal]] Seite 1\n";
  $out = avesmapsWikiParsePublicationsSection($wt);
  assert(count($out) === 3); // Bildquellen ignoriert
  assert($out[0]['title']==='Efferds Wogen' && $out[0]['reference_kind']==='ausfuehrlich' && $out[0]['pages']==='54');
  assert($out[2]['title']==='Historia Aventurica' && $out[2]['reference_kind']==='erwaehnung' && $out[2]['note']==='Zerstörung');
  echo "section ok\n";
  ```
  Fail-Lauf, dann implementieren: `==Publikationen==`-Block isolieren; je `===Unterabschnitt===` das `reference_kind`
  bestimmen (`Ausführliche`→`ausfuehrlich`, `Ergänzende`→`ergaenzend`, `Erwähnungen`→`erwaehnung`; `Elektronische/Bildquellen`
  überspringen); je `*[[Titel]] Rest`-Zeile Titel aus dem ersten Wikilink + `avesmapsWikiParsePageRef(Rest)`. Grün-Lauf.
- [ ] **Step 6 — Test `avesmapsWikiParseProductInfobox` + `avesmapsWikiMapArtToSourceType`** (Efferds-Wogen-Beispiel aus Spec §3):
  ```php
  $info = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Efferds Wogen\n|Art=Spielhilfe\n|ISBN=978-3-940424-11-2\n|Direktlinks={{F-Shop|PID=12017}}\n|Download={{PDF-Shop|ID=109956|ISBN=978-3-86889-664-0}}\n}}");
  assert($info['title']==='Efferds Wogen' && $info['isbn']==='978-3-940424-11-2');
  assert($info['f_shop_pid']==='12017' && $info['pdf_shop_id']==='109956');
  assert(avesmapsWikiMapArtToSourceType('Abenteuer')==='abenteuer');
  assert(avesmapsWikiMapArtToSourceType('Regionalspielhilfe')==='regionalspielhilfe');
  assert(avesmapsWikiMapArtToSourceType('Unbekanntes Dings')==='sonstiges');
  echo "infobox ok\n";
  ```
  Fail, implementieren (Infobox via `…ExtractInfoboxBlock`/`ParseTemplateParams`; `f_shop_pid`/`pdf_shop_id` per Regex aus
  `{{F-Shop|PID=…}}`/`{{PDF-Shop|ID=…}}`), grün.
- [ ] **Step 7 — `avesmapsWikiMapArtToSourceType`-Tabelle** (Starter; die Session MUSS die reale `Art`-Werte-Menge aus dem
  Dump ziehen — `SELECT DISTINCT`-Äquivalent beim Testlauf über Publikationsseiten — und die Tabelle vervollständigen,
  Rest→`sonstiges`): `Abenteuer|Kaufabenteuer|Soloabenteuer|Gruppenabenteuer→abenteuer`; `Regionalspielhilfe→regionalspielhilfe`;
  `Quellenband→quellenband`; `Roman→roman`; `Regelband|Regelwerk|Basisregelwerk→regelbuch`; `Briefspiel→briefspiel`;
  `Aventurischer Bote→aventurischer_bote`; sonst `sonstiges`.
- [ ] **Step 8 — Commit** (nur die zwei Parser-Dateien).

---

### Task 3: Shop-URL-Konstruktion (Template-Muster aus dem Wiki ableiten)

**Files:** Modify `api/_internal/wiki/publication-parsing.php` (+ Test).
**Produces:** `avesmapsWikiBuildPublicationUrl(?string $fShopPid, ?string $pdfShopId): array` → `['chosen_url'=>string,'has_link'=>bool]`, Hierarchie F-Shop > PDF-Shop > `''`.

- [ ] **Step 1 — Template-Muster BELEGEN, nicht raten.** `Template:F-Shop` und `Template:PDF-Shop` als Rohwikitext holen
  (`https://de.wiki-aventurica.de/wiki/Vorlage:F-Shop?action=raw`, dito `Vorlage:PDF-Shop`) und die URL-Bildung ablesen.
  PDF-Shop ist bestätigt `https://www.ulisses-ebooks.de/de/product/<ID>/` (Beleg: Community-URL `…/product/100144/…`).
  Das ermittelte F-Shop-Muster als Kommentar mit Beleg-Datum in die Funktion schreiben.
- [ ] **Step 2 — Test** (mit dem belegten Muster; PDF-Shop-Assert ist fix, F-Shop-Assert = das ermittelte Muster):
  ```php
  $u = avesmapsWikiBuildPublicationUrl('12017', '109956'); assert($u['has_link'] === true); // F-Shop gewinnt
  $u = avesmapsWikiBuildPublicationUrl(null, '109956'); assert($u['chosen_url'] === 'https://www.ulisses-ebooks.de/de/product/109956/');
  $u = avesmapsWikiBuildPublicationUrl(null, null); assert($u['chosen_url'] === '' && $u['has_link'] === false);
  echo "url ok\n";
  ```
- [ ] **Step 3 — Implementieren** (Hierarchie, Muster aus Step 1), **Test grün, Commit.**
- [ ] **Step 4 — Falls F-Shop-Muster nicht sicher belegbar:** F-Shop-Zweig überspringen (dann PDF-Shop bevorzugt, sonst kein Link) und in der Datei + im Owner-Report vermerken. NIE eine geratene URL ausliefern.

---

### Task 4: Sync-Phase „publication_sources" + Reconcile (Override-sicher, idempotent)

**Files:** Modify `api/_internal/wiki/publication-sync.php`; Modify den Phasen-Orchestrator (Session lokalisiert; vgl. Explore: `dump-entity-scan.php` / `locations.php` / `wiki_sync_runs`-Phasen).
**Consumes:** Task-1/2/3-Funktionen; Dump-Reader; `avesmapsWikiSyncCreateMatchKey`/`avesmapsPoliticalBuildWikiKey` (bit-genaue `wiki_key`-Ableitung, Invariante I1); `wiki_redirect_alias`.
**Produces:** `avesmapsPublicationReconcileEntity(PDO,$entityType,$entityPublicId,$entityWikiKey,$userId): array` (Zähler) + `avesmapsPublicationDiffLinks(array $current, array $desired): array` (reine Diff-Funktion).

- [ ] **Step 1 — Reine Diff-Funktion zuerst (TDD).** `avesmapsPublicationDiffLinks($current,$desired)` → `['add'=>[],'update'=>[],'remove'=>[]]`.
  `$current` = existierende `feature_sources` des Elements mit `origin`/`status`/`source_id`; `$desired` = gewünschte Wiki-Verknüpfungen (source_id + refKind/pages/note).
  Test (`publication-parsing-test.php` erweitern oder neues Test-File):
  ```php
  // Override-Garantie: manuelle Zeile NIE in remove; suppressed NIE in add.
  $cur = [['source_id'=>1,'origin'=>'manual','status'=>'approved'],
          ['source_id'=>2,'origin'=>'wiki_publication','status'=>'approved'],
          ['source_id'=>3,'origin'=>'wiki_publication','status'=>'suppressed']];
  $des = [['source_id'=>2,'reference_kind'=>'ausfuehrlich','pages'=>'54','note'=>null], // bleibt (update)
          ['source_id'=>3,'reference_kind'=>'erwaehnung','pages'=>null,'note'=>null],   // suppressed -> NICHT add
          ['source_id'=>4,'reference_kind'=>'ausfuehrlich','pages'=>'7','note'=>null]];  // neu -> add
  $d = avesmapsPublicationDiffLinks($cur,$des);
  assert(in_array(4, array_column($d['add'],'source_id')));
  assert(!in_array(3, array_column($d['add'],'source_id')));   // Suppression respektiert
  assert(count($d['remove']) === 0);                            // source_id 1 (manual) NICHT entfernt; 2/3 bleiben
  echo "diff ok\n";
  ```
  Regel: `remove` = nur `origin='wiki_publication' AND status='approved'`-Zeilen, deren `source_id` NICHT in `$desired`.
  `add` = `$desired`-Zeilen ohne existierende Zeile (egal welchen origins? NEIN — wenn eine `manual`-Zeile mit derselben
  `source_id` existiert, KEIN Wiki-Add, die manuelle gewinnt) und NICHT `suppressed`. `update` = existierende
  `wiki_publication`-Zeile, refKind/pages/note angleichen. Fail→implement→grün.
- [ ] **Step 2 — `avesmapsPublicationReconcileEntity`** verdrahten: `$desired` aus `wiki_entity_publication`+`wiki_publication_catalog`
  (je Publikation `source_id` via `avesmapsFeatureSourceUpsert(url=chosen_url|'', label=title, type=source_type, official=true, userId, wikiKey=publication_wiki_key)`);
  Diff anwenden (`avesmapsFeatureSourceLink(origin='wiki_publication',…)` für add/update; für remove `DELETE` NUR
  `WHERE origin='wiki_publication' AND status='approved'`). Idempotent (zweiter Lauf → 0 add/remove).
- [ ] **Step 3 — Katalog-Aufbau** (`avesmapsPublicationBuildCatalog`): über Publikationsseiten des Dumps
  (Erkennung: Seite hat `{{Infobox Produkt}}`) → `avesmapsWikiParseProductInfobox` + `avesmapsWikiBuildPublicationUrl` → Upsert `wiki_publication_catalog`.
- [ ] **Step 4 — Referenz-Aufbau** (`avesmapsPublicationBuildEntityRefs`): über die 4 Entity-Typen (Seiten mit `==Publikationen==`)
  → `avesmapsWikiParsePublicationsSection` → Publikationstitel via `wiki_redirect_alias` auf `wiki_key` auflösen → Upsert `wiki_entity_publication`.
- [ ] **Step 5 — Phase registrieren** „publication_sources" in der Dump+Sync-Pipeline, resumable (Cursor in `wiki_sync_runs.stats_json`),
  gechunkt (kein Loop über ALLE Elemente in einem Request; Batch-Größe wie die anderen Phasen). Zähler in die Stats:
  `{publications, entity_refs, links_added, links_removed, links_updated, no_link}`.
- [ ] **Step 6 — `php -l`** auf alle berührten PHP-Dateien; **Diff-Test grün**; **Commit.**
- [ ] **Step 7 — 🔧 OWNER-SMOKE (Prod-Write, NICHT der Agent):** Dump+Sync anstoßen; danach prüfen:
  `curl ".../api/app/feature-sources.php?entity_type=settlement&entity_public_id=<A'Sarar-id b5ef2dce-…>"` → enthält „Efferds Wogen" + „Im Bann des Diamanten" (letzteres ohne Link). Zweiter Lauf → Stats `links_added=0` (Idempotenz).
  Manuelle Quelle vorher setzen + nach dem Lauf prüfen, dass sie noch da ist (Override-Garantie).

---

### Task 5: Anzeige „B" — Quellen in der map-features-Payload, synchroner Render

**Files:** Modify `api/app/map-features.php` (+ ggf. `api/_internal/map/features.php`); Modify `js/ui/feature-source-markup.js` (+ Test);
Modify `js/ui/popups.js`; Modify die 5 Popup-Builder; (Editor-Read-Endpoint `api/app/feature-sources.php` BLEIBT für den Editor).

- [ ] **Step 1 — Payload erweitern.** map-features-Antwort bekommt EINMAL `"source_catalog": { "<id>": {url,label,type,official} }`
  (nur tatsächlich verlinkte Quellen, `status='approved'`) und je Feature `"sources": [ {source_id, reference_kind, pages, note} ]`.
  Eine zusätzliche Query (Katalog) + eine (Referenzen, gruppiert je entity_public_id) — KEIN N+1 (zwei Sammel-Queries, in PHP zuordnen).
- [ ] **Step 2 — Payload-Zunahme MESSEN** und im Owner-Report nennen: `curl -s .../api/app/map-features.php | wc -c` vor/nach (Basis war ~18,4 MB).
  Falls unerwartet groß (>+2 MB): mit Owner rücksprechen, bevor festgezurrt.
- [ ] **Step 3 — `buildSourceListMarkup` erweitern (TDD, node-assert).** In `js/ui/__tests__/feature-source-markup.test.js`:
  ```js
  const { buildSourceListMarkup } = require("../feature-source-markup.js");
  // url-lose Quelle = Klartext (kein <a>), Seiten angezeigt, Erwähnung markiert, official-first + *
  const html = buildSourceListMarkup("https://wiki/x", [
    { url:"https://f-shop/1", label:"Efferds Wogen", official:true, type:"regionalspielhilfe", pages:"54", reference_kind:"ausfuehrlich" },
    { url:"", label:"Im Bann des Diamanten", official:true, type:"regionalspielhilfe", pages:"40, 145", reference_kind:"ausfuehrlich" },
    { url:"https://x/2", label:"Historia Aventurica", official:false, type:"quellenband", pages:"176", reference_kind:"erwaehnung", note:"Zerstörung" },
  ], { wikiLabel:"Wiki Aventurica" });
  const assert = require("assert");
  assert.ok(html.includes("Efferds Wogen") && html.includes("S. 54"));
  assert.ok(html.includes("Im Bann des Diamanten") && !/href="[^"]*Diamanten/.test(html)); // url-los = kein Link
  assert.ok(html.includes("Wiki Aventurica"));
  console.log("markup ok");
  ```
  `node js/ui/__tests__/feature-source-markup.test.js` → fail; dann `buildSourceListMarkup` erweitern (Signatur bleibt
  `(wikiUrl, sources, opts)`, `sources[]` trägt jetzt optional `pages/reference_kind`): url-lose Quelle als `<span>`,
  `pages`→„ S. …", `reference_kind==='erwaehnung'`→dezente Markierung; Reihenfolge official→wiki→rest bleibt. Grün, Commit.
- [ ] **Step 4 — Builder auf Payload umstellen.** In den 5 Buildern statt `featureSourcesPlaceholderMarkup(...)` die Quellen
  synchron rendern: `"Quellen: " + buildSourceListMarkup(wikiUrl, feature.sources_resolved, {...})`, wobei `sources_resolved`
  = die Feature-`sources[]` gegen `window.__sourceCatalog` (aus der Payload beim Laden gesetzt) aufgelöst. Kein `data-*`-Platzhalter mehr.
- [ ] **Step 5 — Lazy-Pfad ENTFERNEN** in `js/ui/popups.js`: `featureSourcesPlaceholderMarkup`, `handleSourcePopupOpen`,
  `fetchFeatureSources`, `featureSourceCache`, `featureSourceCacheKey`, `applyFeatureSourceList`, `wireFeatureSourcePopups`
  + deren `map.on("popupopen"/"tooltipopen", …)`-Registrierung. `node --check js/ui/popups.js`.
- [ ] **Step 6 — Verifizieren (read-only, kein Write):** nach Deploy A'Sarar-Popup öffnen (Deep-Link `?siedlung=A'Sarar`) →
  „Quellen: Efferds Wogen … " steht SOFORT, **kein** Zucken, kein `fetchFeatureSources` im Network-Log. **Commit.**

---

### Task 6: Editor — 8er-Typ, Wiki-„automatisch"-Gruppe, Entfernen=Suppression

**Files:** Modify `js/review/review-feature-sources.js` (+ Test); bump `ASSET_VERSION` NUR falls der Editor über den
territory-inline-host geladen wird (Siedlungseditor-iframe lädt mit `?v=Date.now()` → nicht nötig; prüfen).

- [ ] **Step 1 — 8er-Typ-Dropdown (node-assert).** Test in `js/review/__tests__/feature-sources-render.test.js` erweitern:
  `renderFeatureSourceEditorHtml({wiki_url:'',sources:[]})` enthält `value="regionalspielhilfe"` … `value="regelbuch"` (alle 8).
  Fail→`FEATURE_SOURCE_TYPES`+`FEATURE_SOURCE_TYPE_LABELS` auf die 8 erweitern→grün.
- [ ] **Step 2 — Wiki-„automatisch"-Gruppe.** Quellen mit `origin==='wiki_publication'` (das `list`-Endpoint muss `origin` je
  Quelle mitliefern — `avesmapsListFeatureSourcesForEdit` erweitern) unter einer Zwischenüberschrift „Aus dem Wiki (automatisch)"
  rendern; ihr Entfernen-✕ ruft `remove` mit Semantik **Suppression** (Backend: `origin='wiki_publication'` → `status='suppressed'`
  statt hartem DELETE, damit der nächste Sync sie nicht wieder anlegt). Test: Render zeigt die Gruppe; `php -l` Endpoint.
- [ ] **Step 3 — `node --check` + Render-Test grün; Commit.**
- [ ] **Step 4 — 🔧 OWNER-SMOKE:** Wiki-Quelle im Editor „entfernen" → nach nächstem Sync bleibt sie weg (Suppression); manuelle Add bleibt.

---

### Task 7: Abschluss

- [ ] **Doku:** `docs/wiki-publikations-quellen-design.md` als „umgesetzt" markieren; AGENTS.md §5 „planned" → „shipped".
- [ ] **Definition of Done:** A'Sarar-Infobox zeigt Publikationsquellen flackerfrei; url-lose Publikation als Klartext; zweiter
  Sync idempotent; manuelle/suppressed Overrides überleben einen Sync; Payload-Zunahme dokumentiert.
- [ ] **Owner-Freigabe** der Wordings (Badge-Typen, „Aus dem Wiki (automatisch)", Erwähnungs-Markierung) einholen.
- [ ] **NICHT in Scope (Fast-Follow-Instruction):** Community-„Quelle vorschlagen" (`origin='community'`, `status='pending'`,
  Erweiterung `report-location.php`/`review-report-flow.js`, Vorbefüllen aus dem angeklickten Eintrag).

---

## Self-Review (Autor)

- **Spec-Deckung:** §4 Entscheidungen → Task 2/3/5/6; §5 Datenmodell → Task 1; §6 URL → Task 3; §7 Sync/Override/Idempotenz → Task 4; §8 Anzeige B → Task 5; §9 Community → bewusst out (Task 7). §10 Edge Cases: stärkstes reference_kind, Ref ohne Seite, Publikation ohne Infobox (name-only via `$wikiKey`), Redirects → in Task 2/4 abgedeckt.
- **Typkonsistenz:** `reference_kind ∈ {ausfuehrlich,ergaenzend,erwaehnung}`, `origin ∈ {wiki_publication,manual,community}`, `status +suppressed`, 8er-`source_type` — überall gleich.
- **Keine Platzhalter:** Implementierungs-Details, die vom echten Dump/Template abhängen (Art-Werte-Menge, F-Shop-URL-Muster), sind als BELEGEN-Schritte mit Fallback formuliert, nicht als „TODO".
