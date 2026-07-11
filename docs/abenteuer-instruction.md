# Abenteuer-Feature — Implementierungs-Instruction

> **Für die umsetzende Session (Agent oder Mensch).** Diese Datei ist die Arbeitsanweisung; die
> **Begründungen/Entscheidungen** stehen in **[docs/abenteuer-feature-design.md](abenteuer-feature-design.md)**
> (die Spec) — bei Zweifeln immer dort nachlesen. Sprache: Prosa DE, Code/Bezeichner/Commits EN.

**Ziel:** DSA-Abenteuer als Datenbank + Infopanel-Abschnitte an Gegenden (Siedlung/Territorium/Region),
mit Editor, override-sicherem Wiki-Sync und spoiler-gated „Questroute".

**Architektur:** Neues Backend-Entity (`adventure` + `adventure_place`, inline-PHP-DDL, self-healing).
Öffentlicher Katalog-Read `api/app/adventures.php`. Client lädt den Katalog **einmal** (nur bei
`?infopanel=true`), baut Indizes und aggregiert selbst entlang der politischen Hierarchie (kein
Server-Geometrie). Editor als iframe-Overlay (Siedlungseditor-Muster). Sync erweitert die bestehende
Publikations-Ingestion und reconciled override-sicher (`origin`/`status`-Muster wie `feature_sources`).

**Tech-Stack:** Vanilla JS (kein Build), Leaflet 1.9.4 (`L.CRS.Simple`), jQuery 3.6, PHP 8 strict + PDO/MySQL,
STRATO Shared Hosting.

---

## Global Constraints (gelten für JEDE Aufgabe — verbatim aus Spec §16)

- **Quell-Reihenfolge der „Ort"-Liste strikt bewahren** — erster Ort = Startort. Parser/Import dürfen die
  Liste nie umsortieren/reorder-dedupen.
- **Kein Server-Geometrie** — Punkt-in-Polygon/Aggregation nur im Client (STRATO-Perf).
- **Rendering nur bei `IS_INFOPANEL_MODE`** (`?infopanel=true`).
- **Keine automatische Route aus den Ort-Daten** (Plan-Änderung 2026-07-12): die „Ort"-Liste ist KEINE
  Routenreihenfolge; die Questroute ist editor-gepflegt (Design §9), keine On-Map-Routendarstellung.
  „beginnt/spielt" bleibt, entkoppelt von der Route. (Adresszeile weiterhin nie auto-umschreiben, URL-Policy.)
- **Kein Blau, nur Tokens** aus `css/base/tokens.css` (keine hartkodierten Farben/Radien/Trenner).
- **STRATO:** schwere Endpoints nie loopen/proben — immer Einzel-Request.
- **Shared Working Tree:** `git status` zuerst, **nur eigene Dateien per Pfad** stagen, nie `git add -A`.
- **Editor-Assets (C1):** self-contained HTML mit `?v=Date.now()` → **kein** `ASSET_VERSION`-Bump nötig.
- **Envelope:** neue Endpoints antworten im Gold-Contract `{ok:true,…}` / `{ok:false,error:{code,message}}`,
  `error.code` maschinenlesbar englisch.

## Arbeitsweise

- **Eine Phase pro Session** (fokussiert bleiben — die Zersplitterung großer Features in Mega-Sessions war
  die Ursache früherer Qualitätsprobleme). Zu Beginn jeder Phase deren Aufgaben **fein durchplanen**, dann bauen.
- **Kleine, verifizierte Commits** direkt auf `master` (Conventional Commits, Prefix `feat/fix/docs/…`),
  Push ist freigegeben — nach Push **Remote-SHA prüfen**, Live-Site erst nach ~1–2 min Deploy checken.
- **Verifikation** in diesem Repo (kein schweres TDD-Framework):
  - JS-Logik mit Node-Tests neben dem Modul (`js/**/__tests__/*.test.js`, Muster vorhanden), z. B. Auflösung/Aggregation.
  - PHP mit den vorhandenen Test-Dateien (`api/_internal/**/__tests__/*-test.php`, Muster: publication-sync-test.php).
  - UI **im echten Browser** über die Preview-Tools verifizieren (Infopanel öffnen, klicken, Konsole/Network lesen) —
    **nicht** nur per API raten (Owner-Lehre). `?infopanel=true` ist Pflicht zum Sehen.
- **DRY/YAGNI:** die in Spec §15 gelisteten Nahtstellen wiederverwenden, nicht parallel neu bauen.

---

## Phase 1 — Fundament + Siedlungs-Anzeige (beginnt/spielt)

**Deliverable:** echte Abenteuerdaten erscheinen im Infopanel einer **Siedlung** (beginnt/spielt).
Territorien-Aggregation kommt in Phase 2. **(Questroute entfällt — editor-gepflegt, siehe Design §9.)**

### Task 1.1 — Datenmodell (inline-DDL, self-healing)
**Files:** Create `api/_internal/app/adventures.php` (Lib mit `avesmapsAdventuresEnsureTables(PDO): void`).
Muster: `api/_internal/app/feature-sources.php` (idempotentes `CREATE TABLE IF NOT EXISTS` + `$addColumn`-Helfer).

Tabellen (Spalten verbindlich):

```
adventure(
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  wiki_key VARCHAR(190) NULL, wiki_url VARCHAR(500) NULL,   -- UNIQUE(wiki_key) sobald gesetzt
  title VARCHAR(300) NOT NULL,
  product_type VARCHAR(32) NOT NULL,   -- gruppenabenteuer|soloabenteuer|kurzabenteuer|szenario|anthologie|kampagne
  edition VARCHAR(16) NULL,            -- DSA1..DSA5
  bf_year INT NULL, bf_label VARCHAR(120) NULL,
  genre VARCHAR(160) NULL, complexity_gm VARCHAR(60) NULL, complexity_pl VARCHAR(60) NULL,
  is_official TINYINT(1) NOT NULL DEFAULT 1,
  authors VARCHAR(500) NULL, series VARCHAR(200) NULL,
  fshop_code VARCHAR(40) NULL, cover_url VARCHAR(500) NULL,
  field_origins_json JSON NULL,        -- {feld: 'wiki'|'manual'} — Override-Schutz pro Feld
  status VARCHAR(16) NOT NULL DEFAULT 'approved',   -- approved|suppressed (Grabstein)
  origin VARCHAR(16) NOT NULL DEFAULT 'manual',      -- wiki|manual (Herkunft des Datensatzes)
  created_at, updated_at, synced_at
)
adventure_place(
  id INT AUTO_INCREMENT PRIMARY KEY,
  adventure_id INT NOT NULL,           -- INDEX
  sort_order INT NOT NULL,             -- Wiki-Reihenfolge; kleinste = Start
  raw_name VARCHAR(300) NOT NULL,      -- Original-Wikiname (unaufgelöst-Fallback)
  target_kind VARCHAR(16) NOT NULL DEFAULT 'unresolved', -- settlement|territory|region|path|unresolved
  target_public_id VARCHAR(64) NULL,   -- INDEX
  target_wiki_key VARCHAR(190) NULL,   -- INDEX
  role VARCHAR(8) NOT NULL DEFAULT 'play',  -- start|play (Default bei Sync: kleinster sort_order=start)
  origin VARCHAR(16) NOT NULL DEFAULT 'manual', -- wiki|manual
  status VARCHAR(16) NOT NULL DEFAULT 'approved', -- approved|suppressed
  created_at, updated_at,
  INDEX(adventure_id, sort_order)
)
```

**Verifikation:** ein Einzel-Request auf den Read-Endpoint (Task 1.3) ruft `ensureTables` auf; danach in
phpMyAdmin prüfen, dass beide Tabellen existieren. **Nicht** in einer Schleife proben (STRATO).

### Task 1.2 — Testdaten seeden
**Files:** Create `tools/adventures/seed-sample-adventures.php` (CLI, einmalig) **oder** einen kleinen
JSON-Import. Lege ~6 echte Abenteuer mit Ort-Listen an (Beispiele aus der Spec: Siegelbruch =
`Mittelreich, Königreich Garetien, Gareth, Wagenhalt`; ein Bornland-Beispiel `Salderkeim, Irberod, …`).
`sort_order` = Listenposition; `role` = `start` für `sort_order=0`, sonst `play`; `origin='manual'`,
`target_kind='unresolved'` (Auflösung macht Task 1.4). **Reihenfolge unverändert übernehmen.**
**Verifikation:** Read-Endpoint liefert die 6 Abenteuer mit Orten in korrekter Reihenfolge.

### Task 1.3 — Read-API `api/app/adventures.php` (Katalog-Modus)
**Files:** Create `api/app/adventures.php` (HTTP-Wrapper) → nutzt `api/_internal/bootstrap.php`
(`avesmapsCreatePdo`, `avesmapsApplyCorsPolicy`, `avesmapsJsonResponse`) + die Lib aus 1.1.
**Produces (Client-Vertrag):**
```
GET /api/app/adventures.php  ->  { ok:true, adventures:[ {
   public_id, title, wiki_url, product_type, edition, bf_year, bf_label, genre,
   complexity_gm, complexity_pl, is_official, fshop_code, cover_url, series,
   places:[ { role, target_kind, target_public_id, target_wiki_key, raw_name, sort_order } ] } ] }
```
Nur `status='approved'`-Zeilen. **Verifikation:** ein Browser-/curl-Fetch → `ok:true`, Array gefüllt,
`places` in `sort_order`-Reihenfolge.

### Task 1.4 — Namensauflösung (Ort → Entity)
**Files:** Create `api/_internal/app/adventure-resolve.php` mit
`avesmapsAdventureResolvePlace(PDO, string $rawName): array {kind, public_id, wiki_key}`.
**Logik (Spec §5):** kanonischen Wiki-Key bilden (`avesmapsWikiDumpCanonicalWikiKeyForTitle`,
`api/_internal/wiki/dump-reader.php:436`) + Redirect über `wiki_redirect_alias`; dann in Präzedenz suchen:
Siedlung (`map_features.wiki_url`) → Territorium (`political_territory.wiki_key`) → Region → Weg
(`wiki_path.wiki_url`); Vergleich diakritika-/separator-insensitiv (Server-Pendant zu
`normalizeWikiDeeplinkKey`). Kein Treffer → `unresolved`. Ein „resolve all"-Action am Endpoint
aktualisiert `adventure_place.target_*` (nur wo `origin!='manual'`).
**Verifikation:** Node/PHP-Test: `Gareth`→settlement, `Königreich Garetien`→territory, `Bornstraße`→path,
`Hardener Seenplatte`→region; Umlaut-Fall (`Fürstentum …`) trifft.

### Task 1.5 — Client-Katalog + Index
**Files:** Create `js/map-features/map-features-adventures.js`; einbinden in `index.html` (nach den
Infopanel-Skripten). **Produces:**
- `window.avesmapsLoadAdventureCatalog()` — ein Fetch auf `adventures.php`, nur wenn `IS_INFOPANEL_MODE`;
  baut `Map`s: `bySettlement[wiki_key]`, `byTerritory[wiki_key]`, `byRegion[wiki_key]`.
- `window.getAdventuresForPlace(placeRef, { role })` — `role` `'start'` (beginnt) | `'play'` (spielt) | `'all'`.
- `window.getAdventurePlaces(publicId)` — alle Orte eines Abenteuers (für die Questroute).

**Verifikation:** Node-Test der Index-/Filterlogik; im Browser `getAdventuresForPlace(...)` in der Konsole.

### Task 1.6 — Einspeisung in die Siedlungs-Anzeige + De-Blue
**Files:** Modify `js/map-features/map-features-place-extras.js` (Daten aus dem Index statt Platzhalter;
`getPlaceAdventures*` an `getAdventuresForPlace` hängen). Modify `css/features/place-extras.css`
(Blau `#3f6fa0` → `var(--color-link)`; hartkodierte Braun-/Grau-Werte auf Tokens ziehen).
Neuer **Button „Spielt hier (Spoiler)"** unter dem beginnt-Streifen, der die spielt-Liste **inline nach
Klick** einblendet (Delegation-Muster wie die bestehende `.avesmaps-adv__sort`/`__all`-Behandlung).
**Verifikation (Browser):** `?infopanel=true`, Siedlung mit Abenteuern klicken → beginnt-Streifen echt;
Spoiler-Button gibt spielt-Liste frei; Screenshot hell+dunkel.

### Task 1.7 — ENTFALLEN (Plan-Änderung 2026-07-12)
Die ursprünglich aus der „Ort"-Liste abgeleitete Questroute (Planer-Sprung + gestrichelte Linie) ist
**verworfen**, weil die „Ort"-Liste die Routenreihenfolge **nicht** abbildet (Design §9). Sie wurde in
Phase 1 gebaut und wieder **entfernt** (Dateien `map-features-questroute.js` + `css/features/questroute.css`
gelöscht, Karten-Button + `placeCount` raus). Die Route wird **editor-gepflegt** (Phase 3+, Siedlungsebene);
`getAdventurePlaces(publicId)` bleibt als Datengrundlage. **Keine On-Map-Routendarstellung** aus Ort-Daten.

---

## Phase 2 — Aggregation (Territorium/Region) + „Alle anzeigen"-Dialog

**Deliverable:** Klick auf ein Territorium/Region zeigt „Abenteuer in <Gegend>"; „Alle anzeigen" öffnet den
verschachtelten Dialog mit Umschalter.

- **2.1** Subtree-Aggregation im Client: `getAdventuresForTerritorySubtree(wikiKey, {role})` — nutzt
  `territory_wiki_key` je Siedlung (Ray-Cast, `map_features.properties_json`) + `parent_wiki_key`-Baum;
  **deepest-wins** je Abenteuer (Semantik wie `pickDeepestTerritory`/`depthOf` in
  `map-features-settlement-territory-assign.js`). Node-Test mit Mini-Baum.
- **2.2** Territorien-/Regionen-Block im Infopanel: in `avesmapsShowRegionInInfopanel`
  (`map-features-infopanel.js:447`) nach dem `territory-detail.php`-Fetch den Abenteuer-Block anhängen
  (Naht `createRegionWikiInfoBoxMarkup`, `map-features-region-info-markup.js`).
- **2.3** „Alle anzeigen"-Dialog: verschachtelte Rahmen (Rang-Pill + „N direkt"), globaler Umschalter
  „beginnt hier | spielt hier (Spoiler)". CSS auf `.avesmaps-adv-dialog*` (`place-extras.css:184`) aufsetzen;
  Rahmen bewusste Kachel-Ausnahme (warm getönt, Einrückung). **Entwurf** vorher zeigen (show_widget/Preview).
- **Verifikation (Browser):** Garetien klicken → Block + Dialog; nichts doppelt; Umschalter/Zähler stimmen.

---

## Phase 3 — Editor (C1, iframe-Overlay)

**Deliverable:** Abenteuer anlegen/bearbeiten, Orte zuordnen, Startort markieren, Orte suppress/hinzufügen —
alles override-fest; Button unter „Dump holen". **Zusätzlich (Plan-Änderung 2026-07-12): optionale
editor-gepflegte Questroute** — je Abenteuer/Siedlung eine **intern definierte Ortsfolge** (NICHT aus der
„Ort"-Liste), Grundlage für eine spätere bewusste Darstellung. „beginnt/spielt" bleibt davon entkoppelt.

- **3.1** Editor-Seite `html/adventure-editor.html` (self-contained; Muster
  `html/wiki-sync-settlement-editor.html`) + Opener `openAvesmapsAdventureEditorOverlay()` (Muster
  `review-settlement-list.js:483`, `?v=Date.now()`). Overlay-CSS-Klassen wiederverwenden.
- **3.2** Edit-Endpoints unter `api/edit/…/adventures.php` (capability-gated, `avesmapsRequireUserWithCapability`):
  Actions `list`, `detail`, `upsert_adventure`, `set_place` (kind/target/role/sort_order), `suppress_place`,
  `add_place`, `resolve_place`. **Jede manuelle Änderung** setzt `origin='manual'` (Feld → `field_origins_json`,
  Ort-Link → `adventure_place.origin='manual'`; entferntes Wiki-Link → `status='suppressed'`).
- **3.3** Ort-Autocomplete im Editor gegen Siedlung/Territorium/Region/Weg (Client:
  `normalizeWikiDeeplinkKey` + `wiki_url`-Vergleich; Fallback `map-search.php`).
- **3.4** Button **„Abenteuereditor" unter „Dump holen"** im Block `.wiki-sync-dump-central`
  (`index.html:342–355`, über den Tabs) + `<span id="adventure-editor-synced" hidden>`; Opener in
  `bootstrap.js` neben `#settlement-editor-open` registrieren.
- **Verifikation (Browser):** Abenteuer anlegen, Orte zuordnen, Start umsetzen, Reload → Änderung bleibt;
  Override-Feld sichtbar markiert.

---

## Phase 4 — Wiki-Sync (override-sicher)

**Deliverable:** „Dump holen" befüllt/aktualisiert Abenteuer aus dem Wiki, ohne manuelle Overrides zu zerstören;
Datum „Abenteuer gesynct: …" erscheint neben dem Button.

- **4.0 Vorabcheck:** verifizieren, dass die Abenteuer-Infobox vom bestehenden `publication-sync`-Parser
  erfasst wird (gleiches Template/Feldnamen). Falls nicht: Parser-Erweiterung statt reiner Feld-Ergänzung.
- **4.1** Ingestion erweitern (`api/_internal/wiki/publication-sync.php` + Staging): pro Publikation
  zusätzlich `Ort` (in **Quell-Reihenfolge**), `Produkttyp`, `Komplexität`, `Genre`, `F-Shop-Code`, `Cover`,
  `Regelsystem`, `Derisches Datum` erfassen; „Abenteuer" = Publikationen mit Abenteuer-Produkttyp. Nur Staging schreiben.
- **4.2** Reconcile `avesmapsAdventureDiffLinks($current,$desired)` (reiner Planer, Muster
  `avesmapsPublicationDiffLinks`): schreibt/aktualisiert/löscht **nur** `origin='wiki' AND status='approved'`;
  `manual`+`suppressed` unangetastet; idempotent per `wiki_key`. Gilt für Abenteuer-Felder **und**
  `adventure_place` (inkl. `role`-Schutz). Test-Datei `__tests__/adventure-sync-test.php`.
- **4.3** Last-Sync: Kind `adventure` in `AVESMAPS_WIKI_DUMP_SYNC_KINDS` (`dump-sync-kind.php:84`) +
  Zweig in `avesmapsWikiDumpSyncKindLastSynced` (`:150`); Frontend-Eintrag in der Fill-Array-Stelle
  `review-wiki-sync.js:554` (`["adventure-editor-synced", synced && synced.adventure]`).
- **Verifikation:** Sync für ein bekanntes Abenteuer laufen lassen (Einzel-Request!); Reconcile zweimal →
  idempotent; vorher gesetzte manuelle Overrides bleiben; Datum erscheint.

---

## Phase 5 — Cover + F-Shop-Politur

**Deliverable:** echte Cover (proxy-gecacht), Klick → Ulisses-F-Shop.

- **5.1** Cover-Proxy-Cache (Muster `coat.php`): serverseitig holen/cachen, nicht hotlinken.
- **5.2** F-Shop-Link-Builder aus `fshop_code` **+ F-Shop-UID** — ⚠️ **Owner liefert exaktes UID-/URL-Format**
  (vor Phase 5 erfragen). Cover-Klick → Produktseite.
- **Verifikation (Browser):** Cover lädt aus dem Cache; Klick öffnet die richtige F-Shop-Seite mit UID.

---

## Abschluss-Aufgaben (nach Phase 1, laufend)
- Beide Docs in **AGENTS.md §11** (Doku-Index) eintragen: die Spec + diese Instruction.
- Kurzer Memory-Pointer aktualisieren (der Infopanel-Memory nennt „OFFEN Phase-6-DATEN (Abenteuer)" —
  auf „in Umsetzung, siehe docs/abenteuer-*" setzen).

## Self-Review-Abgleich (Spec → Phasen)
Spec §3/§4 (Rollen/Spoiler) → Task 1.6, 2.3. §5 (Auflösung) → 1.4, 3.3. §6 (Aggregation) → 2.1.
§7 (Read-API) → 1.3, 1.5. §8 (Anzeige/De-Blue) → 1.6, 2.2, 2.3. §9 (Questroute) → **editor-gepflegt, Phase 3+ (Task 1.7 entfallen)**.
§10 (Editor/Button) → Phase 3. §11 (Sync/Override/Datum) → Phase 4. §12 (Cover/F-Shop) → Phase 5.
Alle Spec-Abschnitte sind abgedeckt.
