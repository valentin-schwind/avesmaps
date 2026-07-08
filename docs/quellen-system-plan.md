# Mehrquellen-System — Implementierungsplan (Teilprojekt #1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infoboxen zeigen mehrere Quellen (Typ + `*`-offiziell), Wiki bleibt auto — Datenmodell,
Lese-Endpoint und geteilte Anzeige (Spec: `docs/quellen-system-design.md`).

**Architecture:** Zwei self-healing Tabellen (`sources`-Katalog + `feature_sources`-Verknüpfung).
Ein öffentlicher Lese-Endpoint liefert die approved Quellen eines Elements in **einer** Query. Im
Frontend rendert **eine** reine, testbare Funktion `buildSourceListMarkup()` die Zeile; **ein**
zentraler `popupopen`-Handler lädt die Quellen lazy nach und füllt einen Platzhalter, den die 4
Popup-Builder emittieren. Wiki kommt synchron aus den vorhandenen Feature-Daten.

**Tech Stack:** PHP 8 (strict) + MySQL PDO; Vanilla JS (kein Build); Leaflet-Popups; Node-`assert`
für reine JS-Units (Muster: `js/map-features/__tests__/point-in-polygon.test.js`); `php -l` für PHP.

## Global Constraints

- **Keine Prod-DB-Writes durch den Agenten.** Nur self-healing DDL. Migration = geliefertes Skript, Owner führt aus.
- **STRATO:** kein N+1; die Quell-Query ist EINE parametrisierte Abfrage. Schwere Endpoints nicht loopen.
- **Envelope (Gold-Contract):** Erfolg `{"ok":true,...}`, Fehler `{"ok":false,"error":{"code","message"}}`.
- **Sprache:** nutzer­sichtbare Strings Deutsch via `tr()` (+ EN in `js/app/i18n-en.js`); Code/Kommentare Englisch.
- **Load-Order:** `map` entsteht in `bootstrap.js` ZULETZT → **nie** `map.on(...)` top-level in einer map-features/ui-Datei; Handler in einer Funktion registrieren, die bootstrap nach map-Erzeugung aufruft.
- **Geteilter Checkout:** nie `git add -A`/`-a`; `git status` zuerst; nur eigene Dateien per Pfad stagen.
- **Deploy:** Push → ~1–2 min Auto-Deploy; Remote-SHA prüfen; PHP-Probes erst ~2 min nach Push.

---

## File Structure

- **Create** `api/_internal/app/feature-sources.php` — DDL-ensure + `avesmapsReadFeatureSources()` (Lese-Logik).
- **Create** `api/app/feature-sources.php` — dünner öffentlicher GET-Endpoint (bootstrap + validate + envelope).
- **Create** `js/ui/feature-source-markup.js` — reine `buildSourceListMarkup()` (module.exports + window-Global).
- **Create** `js/ui/__tests__/feature-source-markup.test.js` — Node-`assert`-Test.
- **Modify** `js/ui/popups.js` — `fetchFeatureSources()` + `handleSourcePopupOpen()` + `wireFeatureSourcePopups(map)`; `featureSourceCreditMarkup()` emittiert den Platzhalter (synchroner Wiki-Fallback).
- **Modify** `js/map-features/map-features-location-marker-entry.js` — Siedlungs-Popup: Platzhalter statt either/or.
- **Modify** `js/ui/popups.js` `labelPopupMarkup` (~:459) — Regionen-Popup: Platzhalter.
- **Modify** Wege-Popup-Builder (im Plan lokalisieren, s. Task 4) — **neu**: Platzhalter-Quell-Zeile.
- **Modify** Territoriums-Viewer (im Plan lokalisieren, s. Task 4) — Platzhalter-Quell-Zeile.
- **Modify** `js/app/bootstrap.js` — `wireFeatureSourcePopups(map)` nach map-Erzeugung aufrufen.
- **Modify** `index.html` — `<script src="js/ui/feature-source-markup.js">` VOR `js/ui/popups.js` einhängen.
- **Modify** `js/app/i18n-en.js` (+ tr-Defaults) — neue Keys `popup.sources`, `popup.officialSource`, `popup.wiki`.
- **Create** `scripts/migrate-other-source-to-sources.php` — idempotentes Migrationsskript (Owner-Run).

---

### Task 1: Schema + Lese-Logik (Backend)

**Files:** Create `api/_internal/app/feature-sources.php`.

**Interfaces — Produces:**
- `avesmapsEnsureFeatureSourceTables(PDO $pdo): void`
- `avesmapsReadFeatureSources(PDO $pdo, string $entityType, string $entityPublicId): array` → Liste von `['url'=>string,'label'=>string,'type'=>string,'official'=>bool]`, sortiert offiziell-zuerst dann `created_at ASC`, nur `status='approved'`.

- [ ] **Step 1: Datei anlegen mit DDL + Lese-Funktion**

```php
<?php
declare(strict_types=1);

// Multi-source system (#1): catalog of distinct sources + element<->source links.
// Self-healing DDL (project idiom); dedup by url_hash so arbitrary-length URLs get a
// fixed-length UNIQUE index (avoids the utf8mb4 index-length limit on a long url column).
function avesmapsEnsureFeatureSourceTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url TEXT NOT NULL,
            url_hash CHAR(64) NOT NULL,
            label VARCHAR(200) NOT NULL DEFAULT '',
            source_type VARCHAR(32) NOT NULL DEFAULT 'sonstiges',
            is_official TINYINT(1) NOT NULL DEFAULT 0,
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_sources_url_hash (url_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS feature_sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            source_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_feature_source (entity_type, entity_public_id, source_id),
            KEY idx_feature_lookup (entity_type, entity_public_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// The single read used by the public endpoint. ONE parameterized query, only approved links,
// official-first then insertion order (matches the infobox display order in the spec).
function avesmapsReadFeatureSources(PDO $pdo, string $entityType, string $entityPublicId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $statement = $pdo->prepare(
        "SELECT s.url, s.label, s.source_type, s.is_official
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType, 'id' => $entityPublicId]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    return array_map(static fn(array $r): array => [
        'url' => (string) $r['url'],
        'label' => (string) $r['label'],
        'type' => (string) $r['source_type'],
        'official' => (int) $r['is_official'] === 1,
    ], $rows);
}
```

- [ ] **Step 2: Syntax prüfen** — Run: `php -l api/_internal/app/feature-sources.php` — Expected: `No syntax errors detected`.
- [ ] **Step 3: Commit** — `git add api/_internal/app/feature-sources.php && git commit -m "feat(api/sources): schema + read logic for feature_sources"`

> Hinweis: kein PHP-Unit-Harness im Projekt — die Lese-Logik wird über den Endpoint (Task 2) + Owner-Smoke verifiziert.

---

### Task 2: Öffentlicher Lese-Endpoint (Backend)

**Files:** Create `api/app/feature-sources.php`.

**Interfaces — Consumes:** `avesmapsReadFeatureSources()` (Task 1). **Produces:** `GET /api/app/feature-sources.php?entity_type=&entity_public_id=` → `{ok:true, sources:[...]}`.

- [ ] **Step 1: Endpoint schreiben** — dem bootstrap-Muster eines bestehenden `api/app/*.php` folgen (Includes/Helper: `avesmapsLoadApiConfig`, `avesmapsApplyCorsPolicy`, `avesmapsCreatePdo`, `avesmapsJsonResponse`, `avesmapsErrorResponse` aus `api/_internal/bootstrap.php` — genaue Include-Pfade an einem existierenden app-Endpoint gegenprüfen).

```php
<?php
declare(strict_types=1);

require_once __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/feature-sources.php';

avesmapsLoadApiConfig();
avesmapsApplyCorsPolicy();

$entityType = trim((string) ($_GET['entity_type'] ?? ''));
$entityPublicId = trim((string) ($_GET['entity_public_id'] ?? ''));
$allowedTypes = ['settlement', 'territory', 'region', 'path'];

if (!in_array($entityType, $allowedTypes, true) || $entityPublicId === '') {
    avesmapsErrorResponse(400, 'invalid_request', 'entity_type (settlement|territory|region|path) and entity_public_id are required.');
}

try {
    $pdo = avesmapsCreatePdo();
    $sources = avesmapsReadFeatureSources($pdo, $entityType, $entityPublicId);
    avesmapsJsonResponse(200, ['ok' => true, 'sources' => $sources]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Quellen konnten nicht geladen werden.');
}
```

- [ ] **Step 2: Syntax prüfen** — Run: `php -l api/app/feature-sources.php` — Expected: `No syntax errors detected`.
- [ ] **Step 3: Commit** — `git add api/app/feature-sources.php && git commit -m "feat(api/sources): public GET /api/app/feature-sources.php (gold envelope, one query)"`
- [ ] **Step 4 (Owner-Smoke, nach Deploy):** `GET /api/app/feature-sources.php?entity_type=settlement&entity_public_id=<eine echte public_id>` → `{"ok":true,"sources":[]}` (leer bis Migration/Verknüpfungen existieren). 🔧 DU.

---

### Task 3: Reine Render-Funktion + Node-Test (Frontend)

**Files:** Create `js/ui/feature-source-markup.js`, Create `js/ui/__tests__/feature-source-markup.test.js`.

**Interfaces — Produces:** `buildSourceListMarkup(wikiUrl, sources, opts)` → HTML-String der Link-Liste (offiziell-zuerst, dann Wiki, dann Rest; `*` an offiziellen; `""` wenn kein Wiki UND keine Quellen). `window.buildSourceListMarkup` + `module.exports`.

- [ ] **Step 1: Failing test schreiben**

```js
const assert = require("assert");
const { buildSourceListMarkup } = require("../feature-source-markup.js");

// wiki only
let out = buildSourceListMarkup("https://wiki/x", [], {});
assert.ok(out.includes(">Wiki") && out.includes("https://wiki/x"), "wiki only");

// order: official -> wiki -> rest; official gets a star
out = buildSourceListMarkup("https://wiki/x", [
  { url: "https://f-shop.de/a", label: "F-Shop", official: true, type: "sonstiges" },
  { url: "https://bp/x", label: "Briefspiel", official: false, type: "briefspiel" },
], {});
const iF = out.indexOf("F-Shop"), iW = out.indexOf(">Wiki"), iB = out.indexOf("Briefspiel");
assert.ok(iF < iW && iW < iB, "order official->wiki->rest");
assert.ok(out.includes("popup-source-official"), "official star");

// empty -> empty string
assert.strictEqual(buildSourceListMarkup("", [], {}), "", "empty");

console.log("feature-source-markup tests passed");
```

- [ ] **Step 2: Run → fails** — Run: `node js/ui/__tests__/feature-source-markup.test.js` — Expected: `Cannot find module '../feature-source-markup.js'`.

- [ ] **Step 3: Implementieren**

```js
// Pure, DOM-free source-line renderer. Order: official (with *), then the auto Wiki source, then
// the rest. Injectable escape/labels keep it Node-testable (no browser tr()/DOM). Empty in -> "".
function buildSourceListMarkup(wikiUrl, sources, opts) {
  opts = opts || {};
  const linkClass = opts.linkClass || "popup-source-link";
  const wikiLabel = opts.wikiLabel || "Wiki";
  const officialTooltip = opts.officialTooltip || "offizielle Quelle";
  const esc = opts.escape || ((s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const link = (url, label, official) => {
    const star = official ? `<span class="popup-source-official" title="${esc(officialTooltip)}">*</span>` : "";
    return `<a class="${esc(linkClass)}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}${star} ↗</a>`;
  };
  const list = Array.isArray(sources) ? sources.filter((s) => s && s.url) : [];
  const parts = [];
  for (const s of list.filter((s) => s.official)) parts.push(link(s.url, s.label || s.url, true));
  if (wikiUrl) parts.push(link(wikiUrl, wikiLabel, false));
  for (const s of list.filter((s) => !s.official)) parts.push(link(s.url, s.label || s.url, false));
  return parts.join("  ");
}
if (typeof module !== "undefined" && module.exports) module.exports = { buildSourceListMarkup };
if (typeof window !== "undefined") window.buildSourceListMarkup = buildSourceListMarkup;
```

- [ ] **Step 4: Run → passes** — Run: `node js/ui/__tests__/feature-source-markup.test.js` — Expected: `feature-source-markup tests passed`.
- [ ] **Step 5: Commit** — `git add js/ui/feature-source-markup.js js/ui/__tests__/feature-source-markup.test.js && git commit -m "feat(ui/sources): pure buildSourceListMarkup + node test"`

---

### Task 4: Lazy-Fetch + Popup-Verdrahtung (Frontend, alle 4 Typen)

**Files:** Modify `js/ui/popups.js`, `js/map-features/map-features-location-marker-entry.js`, der Wege-Popup-Builder, der Territoriums-Viewer, `js/app/bootstrap.js`, `index.html`, `js/app/i18n-en.js`.

**Interfaces — Consumes:** `buildSourceListMarkup()` (Task 3), `GET /api/app/feature-sources.php` (Task 2). **Produces:** `fetchFeatureSources(entityType, publicId): Promise<Array>`, `wireFeatureSourcePopups(map): void`, und pro Element ein Platzhalter `<div class="feature-sources" data-entity-type data-entity-id data-wiki-url>{sync wiki fallback}</div>`.

- [ ] **Step 1: `index.html`** — `<script src="js/ui/feature-source-markup.js"></script>` **vor** dem `js/ui/popups.js`-Script einhängen (mit `?v=`-Stamping-fähigem Pfad wie die Nachbarn).

- [ ] **Step 2: i18n-Keys** — in `js/app/i18n-en.js` (+ den DE-Defaults, wo `tr()` seine Fallbacks zieht) ergänzen: `popup.sources` (DE „Quelle(n)", EN „Source(s)"), `popup.officialSource` (DE „offizielle Quelle", EN „official source"), `popup.wiki` (DE „Wiki", EN „Wiki"). Muster an bestehenden popup-Keys abschauen.

- [ ] **Step 3: Fetch + Handler in `js/ui/popups.js`** (Funktions-Deklarationen, KEIN top-level `map.on`):

```js
// Lazy per-popup source fetch (spec §3). Keeps the big map-features payload untouched.
async function fetchFeatureSources(entityType, entityPublicId) {
  try {
    const url = `/api/app/feature-sources.php?entity_type=${encodeURIComponent(entityType)}&entity_public_id=${encodeURIComponent(entityPublicId)}`;
    const response = await fetch(url, { credentials: "same-origin" });
    const payload = await response.json();
    return payload && payload.ok && Array.isArray(payload.sources) ? payload.sources : [];
  } catch (error) {
    return [];
  }
}

// One popupopen handler for ALL element types: find the placeholder the popup builders emit,
// fetch its catalog sources, and replace the (sync wiki-only) content with the full list.
function handleSourcePopupOpen(event) {
  const root = event && event.popup && typeof event.popup.getElement === "function" ? event.popup.getElement() : null;
  const span = root ? root.querySelector(".feature-sources[data-entity-type][data-entity-id]") : null;
  if (!span || span.dataset.sourcesLoaded === "1") return;
  span.dataset.sourcesLoaded = "1";
  const entityType = span.dataset.entityType, entityId = span.dataset.entityId, wikiUrl = span.dataset.wikiUrl || "";
  fetchFeatureSources(entityType, entityId).then((sources) => {
    const list = window.buildSourceListMarkup(wikiUrl, sources, {
      officialTooltip: tr("popup.officialSource"), wikiLabel: tr("popup.wiki"),
    });
    span.innerHTML = list ? `${tr("popup.sources")}: ${list}` : tr("popup.noSource");
  });
}

// Called from bootstrap AFTER map exists (load-order constraint).
function wireFeatureSourcePopups(map) {
  if (map && typeof map.on === "function") map.on("popupopen", handleSourcePopupOpen);
}
```

> `tr("popup.noSource")` = der bestehende „Keine Quelle gefunden"-String (Key gegenprüfen; sonst den vorhandenen verwenden).

- [ ] **Step 4: bootstrap** — in `js/app/bootstrap.js`, dort wo andere Post-map-Wirings passieren, `wireFeatureSourcePopups(map);` aufrufen.

- [ ] **Step 5: Platzhalter-Helper + Umbau `featureSourceCreditMarkup`** in `js/ui/popups.js`: eine Funktion, die den Platzhalter samt synchronem Wiki-Fallback baut (wird von den Buildern genutzt):

```js
// The placeholder every builder emits: shows the wiki link synchronously (or nothing), then the
// popupopen handler swaps in the full source list. entityType/publicId drive the lazy fetch.
function featureSourcesPlaceholderMarkup(entityType, entityPublicId, wikiUrl, linkClass) {
  const sync = wikiUrl
    ? `${tr("popup.sources")}: ${window.buildSourceListMarkup(wikiUrl, [], { wikiLabel: tr("popup.wiki") })}`
    : tr("popup.noSource");
  return `<div class="feature-sources" data-entity-type="${entityType}" data-entity-id="${escapeHtml(String(entityPublicId || ""))}" data-wiki-url="${escapeHtml(String(wikiUrl || ""))}">${sync}</div>`;
}
```
(`escapeHtml` = die im File vorhandene Escape-Funktion verwenden.)

- [ ] **Step 6: Siedlungen** — in `js/map-features/map-features-location-marker-entry.js` (`buildLocationMarkerPopupHtml`, ~:8-59) die bisherige either/or-Quell-Zeile durch `featureSourcesPlaceholderMarkup("settlement", markerEntry.publicId, markerEntry.location.wikiUrl, linkClass)` ersetzen.

- [ ] **Step 7: Regionen** — in `labelPopupMarkup` (`js/ui/popups.js` ~:459) die Wiki-Zeile durch den Platzhalter (`entityType="region"`, die Region-`public_id`, deren `wiki_url`) ersetzen.

- [ ] **Step 8: Wege/Flüsse** — den Pfad-Popup-Builder lokalisieren (grep im Repo nach dem Weg/Fluss-Popup-Aufbau, z. B. `path`/`river` Popup in `js/map-features/` bzw. `js/ui/popups.js`) und dort **erstmals** eine Quell-Zeile via `featureSourcesPlaceholderMarkup("path", <path public_id>, <path wiki_url>, linkClass)` einfügen — gleiches Muster wie Siedlungen.

- [ ] **Step 9: Territorien** — den Territoriums-Viewer/Detail lokalisieren (wo Endnutzer Territoriums-Infos sehen; grep nach der Territoriums-Popup/Detail-Anzeige) und die Quell-Zeile via `featureSourcesPlaceholderMarkup("territory", <territory public_id/wiki_key — konsistent mit dem im Schema gewählten entity_public_id>, <territory wiki_url>, linkClass)` ergänzen.

- [ ] **Step 10: Syntax** — Run: `node --check js/ui/popups.js && node --check js/ui/feature-source-markup.js && node --check js/map-features/map-features-location-marker-entry.js && node --check js/app/bootstrap.js` — Expected: alle ohne Fehler.
- [ ] **Step 11: Commit** — nur die berührten Dateien per Pfad stagen; `git commit -m "feat(ui/sources): lazy per-popup source list across settlements/regions/paths/territories"`.
- [ ] **Step 12 (Owner-Smoke, nach Deploy):** Element mit Wiki öffnen → „Quelle(n): Wiki ↗"; nach Migration/Verknüpfung erscheinen weitere Quellen (offizielle mit `*`); Element ohne alles → „Keine Quelle gefunden". Wege zeigen erstmals eine Quell-Zeile. 🔧 DU.

---

### Task 5: Migrationsskript (Owner-Run, kein Agent-Prod-Write)

**Files:** Create `scripts/migrate-other-source-to-sources.php`.

**Interfaces — Consumes:** `avesmapsEnsureFeatureSourceTables()` (Task 1). **Produces:** idempotentes Skript, das je map_features-Element mit `properties.other_source {url,label}` einen `sources`-Eintrag (dedup per `url_hash`, `source_type='sonstiges'`, `is_official=0`) + eine `feature_sources`-Verknüpfung upsertet. Dry-run per Default, `--confirm` schreibt.

- [ ] **Step 1: Skript schreiben** (CLI, Owner führt aus; nutzt die Projekt-PDO-/JSON-Helfer):

```php
<?php
declare(strict_types=1);
// Owner-run migration: existing single properties.other_source {url,label} on settlements/regions/
// paths -> a catalog source (type 'sonstiges', not official) + an approved feature_sources link.
// Idempotent (INSERT ... ON DUPLICATE KEY / IGNORE via the UNIQUE keys). Dry-run unless --confirm.
require_once __DIR__ . '/../api/_internal/bootstrap.php';
require_once __DIR__ . '/../api/_internal/app/feature-sources.php';

$confirm = in_array('--confirm', $argv, true);
$pdo = avesmapsCreatePdo();
avesmapsEnsureFeatureSourceTables($pdo);

$typeByFeature = ['location' => 'settlement', 'region' => 'region', 'path' => 'path'];
$rows = $pdo->query("SELECT public_id, feature_type, properties_json FROM map_features WHERE is_active = 1")->fetchAll(PDO::FETCH_ASSOC);
$linked = 0;
foreach ($rows as $row) {
    $entityType = $typeByFeature[(string) $row['feature_type']] ?? null;
    if ($entityType === null) { continue; }
    $props = json_decode((string) $row['properties_json'], true);
    $other = is_array($props) ? ($props['other_source'] ?? null) : null;
    $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
    if ($url === '') { continue; }
    $label = is_array($other) ? trim((string) ($other['label'] ?? '')) : '';
    $hash = hash('sha256', $url);
    if ($confirm) {
        $pdo->prepare("INSERT INTO sources (url, url_hash, label, source_type, is_official)
                       VALUES (:u, :h, :l, 'sonstiges', 0)
                       ON DUPLICATE KEY UPDATE label = IF(label = '', VALUES(label), label)")
            ->execute(['u' => $url, 'h' => $hash, 'l' => $label]);
        $sourceId = (int) $pdo->query("SELECT id FROM sources WHERE url_hash = " . $pdo->quote($hash))->fetchColumn();
        $pdo->prepare("INSERT IGNORE INTO feature_sources (entity_type, entity_public_id, source_id, status)
                       VALUES (:t, :id, :sid, 'approved')")
            ->execute(['t' => $entityType, 'id' => (string) $row['public_id'], 'sid' => $sourceId]);
    }
    $linked++;
    echo ($confirm ? "linked " : "would link ") . $entityType . " " . $row['public_id'] . " -> " . $url . "\n";
}
echo ($confirm ? "DONE. " : "DRY-RUN. ") . $linked . " other_source links.\n";
```

- [ ] **Step 2: Syntax** — Run: `php -l scripts/migrate-other-source-to-sources.php` — Expected: `No syntax errors detected`.
- [ ] **Step 3: Commit** — `git add scripts/migrate-other-source-to-sources.php && git commit -m "chore(sources): owner-run migration script other_source -> sources+feature_sources"`
- [ ] **Step 4 (🔧 DU):** nach Deploy Dry-run (`php scripts/migrate-other-source-to-sources.php`) prüfen, dann `--confirm`. Territorien haben kein other_source → nicht Teil der Migration.

---

## Self-Review (nach dem Schreiben)

- **Spec-Coverage:** Datenmodell (T1), Endpoint (T3-API/T2), Anzeige-Umbau + 4 Typen + Wege-neu (T3/T4), Migration (T5), Wiki-auto (T3/T4-Platzhalter), Reihenfolge/`*`/Leerfall (T3). ✅
- **Offene Plan-Aufgaben (bewusst, kein Platzhalter-Verstoß):** exakter Wege-Popup-Builder (T4/8) + Territoriums-Viewer (T4/9) + Territoriums-`entity_public_id`-Wahl (public_id vs wiki_key) — Implementer lokalisiert per grep und wendet das identische Muster an.
- **Typkonsistenz:** `buildSourceListMarkup`, `fetchFeatureSources`, `featureSourcesPlaceholderMarkup`, `wireFeatureSourcePopups`, `avesmapsReadFeatureSources`, `avesmapsEnsureFeatureSourceTables` durchgängig gleich benannt. ✅
