# Besucher & Editor analytics — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the editor "Status" panel tab into Editoren + Besucher sub-tabs and add a privacy-clean, aggregate-only visitor analytics dashboard.

**Architecture:** A self-contained module behind one kill-switch flag. A batched `sendBeacon` posts anonymous events to a tiny PHP endpoint that UPSERTs aggregate counters (tagged visitor/editor); a read endpoint aggregates them for a narrow single-column dashboard rendered with the same SVG/CSS approach as the approved mockup. No raw events, no cookies, no PII.

**Tech Stack:** PHP 8 + MySQL (PDO), vanilla JS (no build), Leaflet app. Design spec: `docs/superpowers/specs/2026-06-28-besucher-analytics-design.md`.

## Global Constraints

- OS: Windows + PowerShell; a Bash tool is also available. Watch the CRLF edit trap — prefer single-line edits on CRLF files; new files are written LF.
- No test framework. Verify with: `php -l <file>`, `php -r '<smoke>'`, `node --check <file>`, `curl` probes against the deployed endpoint, and editor smoke tests. NEVER loop heavy endpoints (STRATO). A single probe only.
- Commit directly to `master`; push triggers a ~1–2 min SFTP auto-deploy; verify the remote SHA after pushing; check the live site only after the deploy delay.
- Docs/comments/commit messages/internal API error messages in English; user-facing UI strings in German; never translate `<option value>` slugs.
- Privacy is binding: aggregate-only, no per-visitor rows, no cookies, referrer reduced to a source, route waypoints as place names (never coordinates), unique counting via an ephemeral daily hash that is discarded.
- Secrets (`api/config.local.php`) are gitignored — never commit them.
- API envelope: success `{ "ok": true, ... }`, error `{ "ok": false, "error": { "code": "...", "message": "..." } }` via `avesmapsJsonResponse` / `avesmapsErrorResponse` from `api/_internal/bootstrap.php`.

---

## File structure

**Backend (new):**
- `api/_internal/analytics/visitor-analytics.php` — the module library: kill-switch check, self-healing DDL, actor-type + ephemeral-hash helpers, referrer/device reducers, the `record`/`increment` writers, the `read`/aggregate readers, the storage-size query.
- `api/app/track.php` — public collection endpoint (the beacon target): reads the JSON event batch, gates on the flag, records events. No auth (anonymous), but capability-aware for the actor split.
- `api/app/visitor-metrics.php` — read endpoint for the dashboard: returns `{ ok, enabled, range, series, totals, storage }`.

**Backend (modified):**
- `api/_internal/bootstrap.php` — expose `avesmapsVisitorAnalyticsEnabled()` to the client config payload (one line in the injected config), so the dashboard + beacon know the flag.

**Frontend (new):**
- `js/app/visitor-tracking.js` — the beacon module: in-memory queue, `trackVisitorEvent(metric, dimension)`, batched `sendBeacon` flush (interval + `pagehide`), and the event hookups to existing controls.
- `js/review/review-visitor-analytics.js` — the Besucher dashboard: fetch metrics, render KPIs/line/heatmap/bars/donuts/storage, plus the Status sub-tab nav (Editoren | Besucher) and the compact Editoren figures.
- `css/components/visitor-analytics.css` — dashboard styling (cards, bars, heatmap, donuts).

**Frontend (modified):**
- `index.html` — wrap the presence section in sub-tabs (Editoren | Besucher), add the Besucher container; add the new `<script>`/`<link>` tags; add the read-endpoint + track-endpoint config + the enabled flag.
- `js/config.js` — add `VISITOR_TRACK_API_URL`, `VISITOR_METRICS_API_URL`, and read the enabled flag from the injected config.

---

## Phase A — Backend

### Task A1: Analytics module — flag, DDL, helpers

**Files:**
- Create: `api/_internal/analytics/visitor-analytics.php`

**Interfaces:**
- Produces: `avesmapsVisitorAnalyticsEnabled(): bool`; `avesmapsVisitorAnalyticsEnsureTables(PDO): void`; `avesmapsVisitorActorType(?array $user): string`; `avesmapsVisitorDailyHash(): string`; `avesmapsVisitorReferrerSource(string $referrer): string`; `avesmapsVisitorDeviceClass(string $ua): string`.

- [ ] **Step 1: Create the module with the flag, DDL and pure helpers**

```php
<?php

declare(strict_types=1);

if (!defined('AVESMAPS_VISITOR_ANALYTICS_ENABLED')) {
    define('AVESMAPS_VISITOR_ANALYTICS_ENABLED', true);
}
if (!defined('AVESMAPS_VISITOR_SALT')) {
    define('AVESMAPS_VISITOR_SALT', 'avesmaps-visitor-salt-override-me');
}

function avesmapsVisitorAnalyticsEnabled(): bool {
    return AVESMAPS_VISITOR_ANALYTICS_ENABLED === true;
}

function avesmapsVisitorAnalyticsEnsureTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_metric (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            day DATE NOT NULL,
            hour TINYINT UNSIGNED NULL,
            actor_type ENUM('visitor','editor') NOT NULL DEFAULT 'visitor',
            metric VARCHAR(40) NOT NULL,
            dimension VARCHAR(190) NOT NULL DEFAULT '',
            count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_visitor_metric (day, hour, actor_type, metric, dimension),
            KEY idx_visitor_metric_metric (metric, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_daily_seen (
            day DATE NOT NULL,
            visitor_hash CHAR(64) NOT NULL,
            PRIMARY KEY (day, visitor_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsVisitorActorType(?array $user): string {
    return ($user !== null && ($user['id'] ?? 0)) ? 'editor' : 'visitor';
}

function avesmapsVisitorClientIp(): string {
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function avesmapsVisitorDailyHash(): string {
    $ip = avesmapsVisitorClientIp();
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $salt = gmdate('Ymd') . '|' . AVESMAPS_VISITOR_SALT;
    return hash('sha256', $salt . '|' . $ip . '|' . $ua);
}

function avesmapsVisitorReferrerSource(string $referrer): string {
    $referrer = trim($referrer);
    if ($referrer === '') {
        return 'direkt';
    }
    $host = strtolower((string) parse_url($referrer, PHP_URL_HOST));
    if ($host === '') {
        return 'direkt';
    }
    $host = preg_replace('/^www\\./', '', $host);
    $engines = ['google' => 'Google', 'bing' => 'Bing', 'duckduckgo' => 'DuckDuckGo', 'ecosia' => 'Ecosia'];
    foreach ($engines as $needle => $label) {
        if (str_contains($host, $needle)) {
            return $label;
        }
    }
    return substr($host, 0, 60);
}

function avesmapsVisitorDeviceClass(string $ua): string {
    $ua = strtolower($ua);
    if (str_contains($ua, 'ipad') || str_contains($ua, 'tablet')) {
        return 'tablet';
    }
    if (str_contains($ua, 'mobi') || str_contains($ua, 'android') || str_contains($ua, 'iphone')) {
        return 'mobil';
    }
    return 'desktop';
}
```

- [ ] **Step 2: Lint**

Run: `php -l api/_internal/analytics/visitor-analytics.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Smoke-test the pure helpers (no DB)**

Run:
```bash
php -r 'require "api/_internal/analytics/visitor-analytics.php";
echo avesmapsVisitorReferrerSource("https://www.google.com/search?q=x")."\n";
echo avesmapsVisitorReferrerSource("")."\n";
echo avesmapsVisitorReferrerSource("https://wiki-aventurica.de/wiki/Gareth")."\n";
$_SERVER["HTTP_USER_AGENT"]="Mozilla/5.0 (iPhone)"; echo avesmapsVisitorDeviceClass($_SERVER["HTTP_USER_AGENT"])."\n";
echo (avesmapsVisitorActorType(null)).":".(avesmapsVisitorActorType(["id"=>5]))."\n";'
```
Expected:
```
Google
direkt
wiki-aventurica.de
mobil
visitor:editor
```

- [ ] **Step 4: Commit**

```bash
git add api/_internal/analytics/visitor-analytics.php
git commit -m "feat(analytics): visitor analytics module — flag, DDL, helpers"
```

---

### Task A2: Analytics module — writers (increment + unique)

**Files:**
- Modify: `api/_internal/analytics/visitor-analytics.php`

**Interfaces:**
- Consumes: `avesmapsVisitorAnalyticsEnsureTables`, `avesmapsVisitorDailyHash` (Task A1).
- Produces: `avesmapsVisitorIncrement(PDO $pdo, string $actorType, string $metric, string $dimension = '', ?int $hour = null): void`; `avesmapsVisitorRecordUnique(PDO $pdo, string $actorType): void`; `avesmapsVisitorPurgeOldSeen(PDO $pdo): void`.

- [ ] **Step 1: Append the writers to the module**

```php
function avesmapsVisitorIncrement(PDO $pdo, string $actorType, string $metric, string $dimension = '', ?int $hour = null): void {
    $metric = substr(trim($metric), 0, 40);
    if ($metric === '') {
        return;
    }
    $dimension = substr(trim($dimension), 0, 190);
    $statement = $pdo->prepare(
        'INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
        VALUES (UTC_DATE(), :hour, :actor_type, :metric, :dimension, 1)
        ON DUPLICATE KEY UPDATE count = count + 1'
    );
    $statement->execute([
        'hour' => $hour,
        'actor_type' => $actorType === 'editor' ? 'editor' : 'visitor',
        'metric' => $metric,
        'dimension' => $dimension,
    ]);
}

function avesmapsVisitorPurgeOldSeen(PDO $pdo): void {
    $pdo->exec("DELETE FROM visitor_daily_seen WHERE day < UTC_DATE()");
}

function avesmapsVisitorRecordUnique(PDO $pdo, string $actorType): void {
    $hash = avesmapsVisitorDailyHash();
    $insert = $pdo->prepare('INSERT IGNORE INTO visitor_daily_seen (day, visitor_hash) VALUES (UTC_DATE(), :hash)');
    $insert->execute(['hash' => $hash]);
    if ($insert->rowCount() > 0) {
        avesmapsVisitorIncrement($pdo, $actorType, 'unique');
        avesmapsVisitorPurgeOldSeen($pdo);
    }
}
```

- [ ] **Step 2: Lint**

Run: `php -l api/_internal/analytics/visitor-analytics.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Commit**

```bash
git add api/_internal/analytics/visitor-analytics.php
git commit -m "feat(analytics): visitor metric writers (increment + ephemeral unique dedup)"
```

---

### Task A3: Analytics module — readers (aggregate + storage)

**Files:**
- Modify: `api/_internal/analytics/visitor-analytics.php`

**Interfaces:**
- Produces: `avesmapsVisitorReadMetrics(PDO $pdo, string $actorType, int $days): array`; `avesmapsVisitorStorageInfo(PDO $pdo): array`.

- [ ] **Step 1: Append the readers to the module**

```php
function avesmapsVisitorReadMetrics(PDO $pdo, string $actorType, int $days): array {
    $days = max(1, min(3660, $days));
    $actorType = $actorType === 'editor' ? 'editor' : 'visitor';

    $daily = $pdo->prepare(
        "SELECT day, SUM(CASE WHEN metric IN ('pageview','map_load') THEN count ELSE 0 END) AS views,
                SUM(CASE WHEN metric = 'unique' THEN count ELSE 0 END) AS uniques,
                SUM(CASE WHEN metric = 'route' THEN count ELSE 0 END) AS routes
        FROM visitor_metric
        WHERE actor_type = :a AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY day ORDER BY day"
    );
    $daily->execute(['a' => $actorType, 'd' => $days]);

    $heat = $pdo->prepare(
        "SELECT DAYOFWEEK(day) AS dow, hour, SUM(count) AS c
        FROM visitor_metric
        WHERE actor_type = :a AND metric IN ('pageview','map_load') AND hour IS NOT NULL
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY dow, hour"
    );
    $heat->execute(['a' => $actorType, 'd' => $days]);

    $top = static function (string $metric, int $minCount) use ($pdo, $actorType, $days): array {
        $statement = $pdo->prepare(
            "SELECT dimension, SUM(count) AS c FROM visitor_metric
            WHERE actor_type = :a AND metric = :m AND dimension <> ''
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension HAVING c >= :min ORDER BY c DESC LIMIT 8"
        );
        $statement->execute(['a' => $actorType, 'm' => $metric, 'd' => $days, 'min' => $minCount]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    };

    return [
        'daily' => $daily->fetchAll(PDO::FETCH_ASSOC),
        'heatmap' => $heat->fetchAll(PDO::FETCH_ASSOC),
        'search' => $top('search', 3),
        'referrer' => $top('referrer', 1),
        'device' => $top('device', 1),
        'map_mode' => $top('map_mode', 1),
        'route' => $top('route', 3),
        'transport' => $top('transport', 1),
        'route_option' => $top('route_option', 1),
        'display_toggle' => $top('display_toggle', 1),
        'language' => $top('language', 1),
    ];
}

function avesmapsVisitorStorageInfo(PDO $pdo): array {
    $tables = $pdo->query(
        "SELECT table_name AS t, table_rows AS rows, data_length + index_length AS bytes
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE() AND table_name IN ('visitor_metric','visitor_daily_seen')"
    )->fetchAll(PDO::FETCH_ASSOC);
    $total = $pdo->query(
        "SELECT SUM(data_length + index_length) AS bytes FROM information_schema.TABLES WHERE table_schema = DATABASE()"
    )->fetchColumn();
    return ['tables' => $tables, 'database_bytes' => (int) $total];
}
```

- [ ] **Step 2: Lint**

Run: `php -l api/_internal/analytics/visitor-analytics.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Commit**

```bash
git add api/_internal/analytics/visitor-analytics.php
git commit -m "feat(analytics): aggregate readers + storage-size query"
```

---

### Task A4: Collection endpoint `track.php`

**Files:**
- Create: `api/app/track.php`

**Interfaces:**
- Consumes: the whole module (Task A1–A3) + bootstrap helpers (`avesmapsCreatePdo`, `avesmapsReadJsonRequest`, `avesmapsJsonResponse`).
- Produces: `POST /api/app/track.php` accepting `{ "events": [ { "metric": "...", "dimension": "...", "hour": <int|null> }, ... ] }`. Always returns `{ "ok": true }` (a tracking beacon must never surface errors to the page).

- [ ] **Step 1: Confirm the bootstrap include + helper names**

Run: `grep -n "avesmapsCreatePdo\|avesmapsReadJsonRequest\|require.*bootstrap" api/app/map-features.php api/app/map-search.php`
Expected: shows the exact bootstrap require path + helper usage to mirror. Use those exact names/paths in Step 2.

- [ ] **Step 2: Write the endpoint**

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

avesmapsApplyCorsPolicy();

try {
    if (!avesmapsVisitorAnalyticsEnabled()) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    $payload = avesmapsReadJsonRequest();
    $events = is_array($payload['events'] ?? null) ? $payload['events'] : [];
    if ($events === []) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    $user = avesmapsOptionalUser();
    $actorType = avesmapsVisitorActorType($user);

    $pdo = avesmapsCreatePdo();
    avesmapsVisitorAnalyticsEnsureTables($pdo);

    avesmapsVisitorRecordUnique($pdo, $actorType);
    avesmapsVisitorIncrement($pdo, $actorType, 'device', avesmapsVisitorDeviceClass((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')));
    avesmapsVisitorIncrement($pdo, $actorType, 'language', avesmapsVisitorLanguage());
    avesmapsVisitorIncrement($pdo, $actorType, 'referrer', avesmapsVisitorReferrerSource((string) ($payload['referrer'] ?? ($_SERVER['HTTP_REFERER'] ?? ''))));

    $allowed = ['pageview', 'map_load', 'search', 'route', 'route_waypoint', 'transport', 'route_option', 'map_mode', 'display_toggle'];
    $hourly = ['pageview', 'map_load'];
    foreach (array_slice($events, 0, 100) as $event) {
        if (!is_array($event)) {
            continue;
        }
        $metric = (string) ($event['metric'] ?? '');
        if (!in_array($metric, $allowed, true)) {
            continue;
        }
        $hour = in_array($metric, $hourly, true) ? (int) gmdate('G') : null;
        avesmapsVisitorIncrement($pdo, $actorType, $metric, (string) ($event['dimension'] ?? ''), $hour);
    }

    avesmapsJsonResponse(200, ['ok' => true]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(200, ['ok' => true]);
}
```

- [ ] **Step 3: Add the two missing helpers to the module**

Add to `api/_internal/analytics/visitor-analytics.php`:

```php
function avesmapsVisitorLanguage(): string {
    $raw = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
    $first = strtolower(trim(explode(',', $raw)[0] ?? ''));
    $code = substr($first, 0, 2);
    return preg_match('/^[a-z]{2}$/', $code) ? $code : '?';
}
```

And confirm an optional-user helper exists in `api/_internal/auth.php`; if not, add:

```php
function avesmapsOptionalUser(): ?array {
    try {
        return avesmapsRequireUserWithCapability('edit');
    } catch (Throwable $exception) {
        return null;
    }
}
```

(First run `grep -n "function avesmapsOptionalUser\|function avesmapsRequireUserWithCapability" api/_internal/auth.php` — only add `avesmapsOptionalUser` if it is missing.)

- [ ] **Step 4: Lint both files**

Run: `php -l api/app/track.php && php -l api/_internal/analytics/visitor-analytics.php`
Expected: `No syntax errors detected` for both.

- [ ] **Step 5: Commit + push**

```bash
git add api/app/track.php api/_internal/analytics/visitor-analytics.php api/_internal/auth.php
git commit -m "feat(analytics): track.php collection endpoint (batched, flag-gated, anonymous)"
git push origin master
```

- [ ] **Step 6: After ~90s deploy, probe once (NO loop)**

Run:
```bash
curl -s -X POST "https://avesmaps.de/api/app/track.php" -H "Content-Type: application/json" \
  -d '{"events":[{"metric":"map_load"},{"metric":"search","dimension":"Gareth"}],"referrer":"https://www.google.com/"}'
```
Expected: `{"ok":true}`. The `visitor_metric` + `visitor_daily_seen` tables now exist (self-healing DDL ran).

---

### Task A5: Read endpoint `visitor-metrics.php`

**Files:**
- Create: `api/app/visitor-metrics.php`

**Interfaces:**
- Consumes: the module readers (Task A3) + auth (edit capability — the dashboard is editor-only).
- Produces: `GET /api/app/visitor-metrics.php?actor=visitor|editor&days=30` → `{ ok, enabled, actor, days, metrics, storage }`.

- [ ] **Step 1: Write the endpoint**

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

avesmapsApplyCorsPolicy();

try {
    avesmapsRequireUserWithCapability('edit');

    if (!avesmapsVisitorAnalyticsEnabled()) {
        avesmapsJsonResponse(200, ['ok' => true, 'enabled' => false]);
    }

    $actor = ($_GET['actor'] ?? 'visitor') === 'editor' ? 'editor' : 'visitor';
    $days = (int) ($_GET['days'] ?? 30);

    $pdo = avesmapsCreatePdo();
    avesmapsVisitorAnalyticsEnsureTables($pdo);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'enabled' => true,
        'actor' => $actor,
        'days' => $days,
        'metrics' => avesmapsVisitorReadMetrics($pdo, $actor, $days),
        'storage' => avesmapsVisitorStorageInfo($pdo),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Besucher-Statistik konnte nicht geladen werden.');
}
```

- [ ] **Step 2: Lint**

Run: `php -l api/app/visitor-metrics.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Commit + push**

```bash
git add api/app/visitor-metrics.php
git commit -m "feat(analytics): visitor-metrics read endpoint (edit-gated, aggregates + storage)"
git push origin master
```

- [ ] **Step 4: After deploy, probe once**

Run: `curl -s "https://avesmaps.de/api/app/visitor-metrics.php?days=30" | head -c 200`
Expected: an auth error envelope (`"ok":false` / not authenticated) — the endpoint exists and is edit-gated. (Authenticated verification happens in the editor smoke test, Task C5.)

---

### Task A6: Expose the kill-switch flag to the client config

**Files:**
- Modify: `api/_internal/bootstrap.php` (the injected client-config builder)

**Interfaces:**
- Produces: `window.AVESMAPS_VISITOR_ANALYTICS_ENABLED` (bool) in the page's injected config.

- [ ] **Step 1: Find the client-config injection point**

Run: `grep -rn "AVESMAPS_MAP_FEATURES_ENDPOINT\|window.AVESMAPS_" api/ index.html js/config.js | head`
Expected: shows where `window.AVESMAPS_*` values are produced (PHP-injected config block or `js/config.js` defaults). Note the exact mechanism.

- [ ] **Step 2: Add the flag at that injection point**

Add the boolean next to the existing endpoints (mirror their exact syntax found in Step 1), value from `require_once api/_internal/analytics/visitor-analytics.php; avesmapsVisitorAnalyticsEnabled()`. If config is injected via a PHP block in `index.html`/a header include, add:

```php
window.AVESMAPS_VISITOR_ANALYTICS_ENABLED = <?php echo avesmapsVisitorAnalyticsEnabled() ? 'true' : 'false'; ?>;
```

If there is no PHP-side config injection (pure static `js/config.js`), instead default it in `js/config.js` (Task B-side reads it from the metrics endpoint response, so this becomes optional) — document which path was taken in the commit message.

- [ ] **Step 3: Lint the touched file**

Run: `php -l <touched php file>` (skip if only `js/config.js` changed) and/or `node --check js/config.js`
Expected: no syntax errors.

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "feat(analytics): expose kill-switch flag to the client config"
git push origin master
```

---

## Phase B — Frontend collection (beacon)

### Task B1: Beacon module skeleton + flush

**Files:**
- Create: `js/app/visitor-tracking.js`
- Modify: `js/config.js` (add `VISITOR_TRACK_API_URL`)
- Modify: `index.html` (add the `<script>` tag — load order: after `js/config.js`, before the feature modules)

**Interfaces:**
- Consumes: `window.AVESMAPS_VISITOR_ANALYTICS_ENABLED` (Task A6), `VISITOR_TRACK_API_URL`.
- Produces: global `trackVisitorEvent(metric, dimension)` and `flushVisitorEvents()`.

- [ ] **Step 1: Add the endpoint constant to `js/config.js`**

Find the line defining `MAP_FEATURES_API_URL` and add directly below it:

```js
const VISITOR_TRACK_API_URL = window.AVESMAPS_VISITOR_TRACK_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/track.php" : "");
const VISITOR_METRICS_API_URL = window.AVESMAPS_VISITOR_METRICS_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/visitor-metrics.php" : "");
```

- [ ] **Step 2: Write the beacon module**

```js
const visitorEventQueue = [];
let visitorTrackingFlushTimer = null;

function visitorTrackingEnabled() {
	return window.AVESMAPS_VISITOR_ANALYTICS_ENABLED !== false && typeof VISITOR_TRACK_API_URL === "string" && VISITOR_TRACK_API_URL !== "";
}

function trackVisitorEvent(metric, dimension = "") {
	if (!visitorTrackingEnabled() || typeof metric !== "string" || metric === "") {
		return;
	}
	visitorEventQueue.push({ metric, dimension: String(dimension || "").slice(0, 190) });
	if (visitorEventQueue.length >= 25) {
		flushVisitorEvents();
	} else if (visitorTrackingFlushTimer === null) {
		visitorTrackingFlushTimer = window.setTimeout(flushVisitorEvents, 15000);
	}
}

function flushVisitorEvents() {
	window.clearTimeout(visitorTrackingFlushTimer);
	visitorTrackingFlushTimer = null;
	if (!visitorTrackingEnabled() || visitorEventQueue.length === 0) {
		return;
	}
	const batch = visitorEventQueue.splice(0, visitorEventQueue.length);
	const body = JSON.stringify({ events: batch, referrer: document.referrer || "" });
	try {
		const blob = new Blob([body], { type: "application/json" });
		if (!navigator.sendBeacon || !navigator.sendBeacon(VISITOR_TRACK_API_URL, blob)) {
			void fetch(VISITOR_TRACK_API_URL, { method: "POST", body, headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true });
		}
	} catch (error) {
		/* tracking is best-effort; never disturb the page */
	}
}

window.addEventListener("pagehide", flushVisitorEvents);
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") {
		flushVisitorEvents();
	}
});
window.trackVisitorEvent = trackVisitorEvent;
```

- [ ] **Step 3: Add the `<script>` tag to `index.html`**

Find the `<script src="js/config.js"></script>` line; add directly after it:

```html
<script src="js/app/visitor-tracking.js"></script>
```

- [ ] **Step 4: Verify syntax**

Run: `node --check js/app/visitor-tracking.js && node --check js/config.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add js/app/visitor-tracking.js js/config.js index.html
git commit -m "feat(analytics): client beacon module (queue + batched sendBeacon flush)"
```

---

### Task B2: Wire the event hooks

**Files:**
- Modify: `js/app/visitor-tracking.js` (add a self-contained `installVisitorTrackingHooks()` that listens to existing DOM/events — avoids sprinkling calls across many files)

**Interfaces:**
- Consumes: `trackVisitorEvent` (Task B1); existing globals `getSelectedMapLayerMode` and the `#mapLayerModeSelect` control.
- Produces: page-load + map_mode + display_toggle + search + route events.

- [ ] **Step 1: Confirm the hook points**

Run: `grep -n "mapLayerModeSelect\|id=\"display-options\|spotlight\|buildRouteOptionsFromPlannerControls\|function.*planRoute\|renderRoute" index.html js/routing/route-engine.js js/ui/spotlight-search-focus.js | head -20`
Expected: shows the search submit point, the route-plan function, and the display-options container — note the exact element ids / function names to hook.

- [ ] **Step 2: Append the hook installer**

```js
function installVisitorTrackingHooks() {
	if (!visitorTrackingEnabled()) {
		return;
	}
	trackVisitorEvent("pageview");
	trackVisitorEvent("map_load");

	const modeSelect = document.getElementById("mapLayerModeSelect");
	if (modeSelect) {
		modeSelect.addEventListener("change", () => trackVisitorEvent("map_mode", modeSelect.value));
	}

	const displayOptions = document.querySelector(".display-options");
	if (displayOptions) {
		displayOptions.addEventListener("change", (event) => {
			const input = event.target;
			if (input && input.type === "checkbox") {
				trackVisitorEvent("display_toggle", (input.id || input.name || "toggle") + ":" + (input.checked ? "on" : "off"));
			}
		});
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", installVisitorTrackingHooks, { once: true });
} else {
	installVisitorTrackingHooks();
}
```

- [ ] **Step 3: Hook search — add ONE line where a spotlight search resolves**

In the spotlight search submit/resolve path (found in Step 1), after a search term is accepted, add:

```js
trackVisitorEvent("search", String(query || "").slice(0, 80));
```
(Use the actual local variable holding the query; keep it to a single added line.)

- [ ] **Step 4: Hook route-planned — add lines where a route is rendered**

In `js/routing/route-engine.js`, right after a route is successfully built (where `routeOptions` and the resolved waypoints are known), add:

```js
const wpNames = (resolvedWaypoints || []).map((w) => (w && w.name ? String(w.name) : "Kartenpunkt"));
wpNames.forEach((n) => trackVisitorEvent("route_waypoint", n));
if (wpNames.length >= 2) {
	trackVisitorEvent("route", wpNames[0] + " → " + wpNames[wpNames.length - 1]);
}
trackVisitorEvent("route_option", useShortest ? "kürzeste" : "schnellste");
if (routeOptions.landOption) { trackVisitorEvent("transport", String(routeOptions.landOption)); }
if (routeOptions.riverOption) { trackVisitorEvent("transport", String(routeOptions.riverOption)); }
```
(Adapt `resolvedWaypoints` / `useShortest` to the actual locals confirmed in Step 1.)

- [ ] **Step 5: Verify syntax of every touched JS file**

Run: `node --check js/app/visitor-tracking.js && node --check js/routing/route-engine.js && node --check <search file>`
Expected: no output.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(analytics): wire page/map/search/route/mode/toggle tracking hooks"
git push origin master
```

- [ ] **Step 7: After deploy, live round-trip check (open the live site once, then probe)**

Load `https://avesmaps.de` in a browser once (generates events), then after ~20s probe the editor read endpoint is not required here — instead confirm rows landed via a single tracked POST already done in A4. Manual: open the site, switch the map mode, do a search; events flush on tab-hide. (Full visual verification in Task C5.)

---

## Phase C — Frontend UI (Status sub-tabs + Besucher dashboard)

### Task C1: Status sub-tab nav + section split in `index.html`

**Files:**
- Modify: `index.html` (the `data-editor-panel-section="presence"` section, ~line 261)

**Interfaces:**
- Produces: a sub-tab nav `[data-status-subtab="editoren|besucher"]` and two containers `[data-status-subsection="editoren"]` (wraps the existing presence list) and `[data-status-subsection="besucher"]` (empty mount `#visitor-dashboard`).

- [ ] **Step 1: Read the current presence section**

Run: `grep -n "data-editor-panel-section=\"presence\"" index.html`
Then read the ~8 lines of that section to capture the exact existing markup (`presence-panel-status`, `presence-user-list`).

- [ ] **Step 2: Wrap it in sub-tabs**

Replace the presence `<section>` body so it becomes:

```html
<nav class="status-subtabs" aria-label="Status-Bereiche">
	<button class="status-subtab is-active" type="button" data-status-subtab="editoren">Editoren</button>
	<button class="status-subtab" type="button" data-status-subtab="besucher">Besucher</button>
</nav>
<div class="status-subsection is-active" data-status-subsection="editoren">
	<p id="presence-panel-status" class="review-panel__status" role="status" aria-live="polite">Nutzerstatus wird geladen...</p>
	<div id="presence-user-list" class="review-panel__list"></div>
	<div id="editor-activity-figures"></div>
</div>
<div class="status-subsection" data-status-subsection="besucher">
	<div id="visitor-dashboard"></div>
</div>
```
(Keep the exact existing ids `presence-panel-status` + `presence-user-list` so the current presence JS is untouched.)

- [ ] **Step 3: Add the new CSS + JS tags**

Add near the other `css/components/*` links: `<link rel="stylesheet" href="css/components/visitor-analytics.css" />`
Add near the other `js/review/*` scripts: `<script src="js/review/review-visitor-analytics.js"></script>`

- [ ] **Step 4: Sanity-check structure**

Run: `grep -c "data-status-subsection" index.html`
Expected: `2`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(analytics): split Status tab into Editoren + Besucher sub-tabs"
```

---

### Task C2: Dashboard CSS

**Files:**
- Create: `css/components/visitor-analytics.css`

- [ ] **Step 1: Write the stylesheet**

```css
.status-subtabs { display: flex; gap: 18px; padding: 4px 12px 0; border-bottom: 1px solid #e7d8c6; }
.status-subtab { background: none; border: none; padding: 8px 2px; font-size: 13px; color: #8a7355; cursor: pointer; border-bottom: 2px solid transparent; }
.status-subtab.is-active { color: #5a4a3a; font-weight: 700; border-bottom-color: #5a4a3a; }
.status-subsection { display: none; padding: 12px; }
.status-subsection.is-active { display: block; }
.va-pills { display: flex; gap: 6px; margin-bottom: 14px; }
.va-pill { font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid #cdb79f; background: #fffaf5; color: #8a7355; cursor: pointer; }
.va-pill.is-active { background: #5a4a3a; color: #fffaf5; border-color: #5a4a3a; }
.va-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.va-kpi { background: #f6efe6; border-radius: 8px; padding: 11px; }
.va-kpi__label { font-size: 12px; color: #8a7355; }
.va-kpi__value { font-size: 20px; font-weight: 700; color: #5a4a3a; }
.va-kpi__trend { font-size: 12px; color: #1d9e75; }
.va-card { background: #fffaf5; border: 1px solid #cdb79f; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
.va-card__label { font-size: 13px; font-weight: 700; color: #5a4a3a; margin: 0 0 10px; }
.va-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.va-row__name { width: 48%; color: #5a4a3a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.va-row__track { flex: 1; height: 8px; background: #efe6d9; border-radius: 4px; overflow: hidden; }
.va-row__fill { height: 100%; border-radius: 4px; background: #2a78d6; }
.va-row__val { color: #8a7355; font-size: 12px; min-width: 34px; text-align: right; }
.va-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.va-storage { font-size: 12px; color: #8a7355; }
.va-off { padding: 24px 12px; text-align: center; color: #8a7355; font-size: 13px; }
```

- [ ] **Step 2: Commit**

```bash
git add css/components/visitor-analytics.css
git commit -m "feat(analytics): Besucher dashboard stylesheet (parchment skin)"
```

---

### Task C3: Sub-tab toggle + Editoren figures + dashboard load

**Files:**
- Create: `js/review/review-visitor-analytics.js`

**Interfaces:**
- Consumes: `VISITOR_METRICS_API_URL`, `IS_EDIT_MODE`.
- Produces: sub-tab toggle behavior; `loadVisitorDashboard()`; lazy load on first Besucher open.

- [ ] **Step 1: Write the controller (sub-tab toggle + lazy dashboard load)**

```js
(function wireStatusSubtabs() {
	const nav = document.querySelector(".status-subtabs");
	if (!nav) {
		return;
	}
	let dashboardLoaded = false;
	nav.addEventListener("click", (event) => {
		const button = event.target.closest("[data-status-subtab]");
		if (!button) {
			return;
		}
		const target = button.dataset.statusSubtab;
		nav.querySelectorAll("[data-status-subtab]").forEach((b) => b.classList.toggle("is-active", b === button));
		document.querySelectorAll("[data-status-subsection]").forEach((s) => s.classList.toggle("is-active", s.dataset.statusSubsection === target));
		if (target === "besucher" && !dashboardLoaded) {
			dashboardLoaded = true;
			void loadVisitorDashboard();
		}
	});
})();

let visitorDashboardDays = 30;

async function loadVisitorDashboard() {
	const mount = document.getElementById("visitor-dashboard");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	mount.innerHTML = '<div class="va-off">Wird geladen ...</div>';
	let data;
	try {
		const response = await fetch(`${VISITOR_METRICS_API_URL}?actor=visitor&days=${visitorDashboardDays}&_=${Date.now()}`, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		data = await response.json();
	} catch (error) {
		mount.innerHTML = '<div class="va-off">Konnte die Statistik nicht laden.</div>';
		return;
	}
	if (!data || data.ok !== true) {
		mount.innerHTML = '<div class="va-off">Konnte die Statistik nicht laden.</div>';
		return;
	}
	if (data.enabled === false) {
		mount.innerHTML = '<div class="va-off">Besucher-Statistik ist ausgeschaltet.</div>';
		return;
	}
	renderVisitorDashboard(mount, data);
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check js/review/review-visitor-analytics.js`
Expected: FAIL — `renderVisitorDashboard` is referenced but not yet defined. That is expected; it is added in Task C4. (Document the expected-fail; do not commit a half file — proceed straight to C4, then lint+commit together.)

---

### Task C4: Dashboard rendering (KPIs, line, heatmap, bars, donuts, storage)

**Files:**
- Modify: `js/review/review-visitor-analytics.js` (append `renderVisitorDashboard` + helpers)

**Interfaces:**
- Consumes: the `data` shape from `visitor-metrics.php` (Task A5): `data.metrics.{daily,heatmap,search,referrer,device,map_mode,route,...}`, `data.storage.{tables,database_bytes}`.
- Produces: `renderVisitorDashboard(mount, data)`.

- [ ] **Step 1: Append the renderer + helpers (lifts the proven mockup SVG/CSS approach)**

```js
function vaEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function vaBytes(n) {
	const v = Number(n) || 0;
	if (v < 1024) { return v + " B"; }
	if (v < 1048576) { return (v / 1024).toFixed(1) + " KB"; }
	return (v / 1048576).toFixed(1) + " MB";
}

function vaBars(rows, col) {
	const items = (rows || []).map((r) => ({ name: r.dimension, val: Number(r.c) || 0 }));
	if (items.length === 0) { return '<div class="va-storage">noch keine Daten</div>'; }
	const max = Math.max.apply(null, items.map((i) => i.val));
	return items.map((i) =>
		`<div class="va-row"><span class="va-row__name">${vaEscape(i.name)}</span><span class="va-row__track"><span class="va-row__fill" style="width:${Math.round(i.val / max * 100)}%;background:${col}"></span></span><span class="va-row__val">${i.val}</span></div>`
	).join("");
}

function vaLine(daily) {
	const views = (daily || []).map((d) => Number(d.views) || 0);
	const uniq = (daily || []).map((d) => Number(d.uniques) || 0);
	const n = Math.max(views.length, 1);
	const max = Math.max(1, Math.max.apply(null, views.concat([1])) * 1.05);
	const w = 360, h = 90, p = 6;
	const path = (arr) => arr.map((v, i) => {
		const x = p + i * ((w - 2 * p) / Math.max(n - 1, 1));
		const y = h - p - (v / max) * (h - 2 * p);
		return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
	}).join(" ");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Aufrufe und eindeutige Besucher über Zeit"><path d="${path(views)}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/><path d="${path(uniq)}" fill="none" stroke="#1baf7a" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function vaHeatmap(rows) {
	const grid = {};
	(rows || []).forEach((r) => { grid[(Number(r.dow) - 1) + "_" + Number(r.hour)] = Number(r.c) || 0; });
	const max = Math.max.apply(null, Object.values(grid).concat([1]));
	const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
	let html = '<div style="display:flex;flex-direction:column;gap:2px">';
	for (let d = 1; d < 7; d++) {
		html += `<div style="display:flex;gap:2px;align-items:center"><span style="width:18px;font-size:10px;color:#8a7355">${days[d]}</span><div style="display:flex;gap:2px;flex:1">`;
		for (let hh = 0; hh < 24; hh++) {
			const t = (grid[d + "_" + hh] || 0) / max;
			html += `<div title="${days[d]} ${hh} Uhr" style="flex:1;height:13px;border-radius:2px;background:rgba(42,120,214,${(0.06 + t * 0.9).toFixed(2)})"></div>`;
		}
		html += "</div></div>";
	}
	html += `<div style="display:flex;gap:2px;align-items:center"><span style="width:18px;font-size:10px;color:#8a7355">${days[0]}</span><div style="display:flex;gap:2px;flex:1">`;
	for (let hh = 0; hh < 24; hh++) {
		const t = (grid["0_" + hh] || 0) / max;
		html += `<div style="flex:1;height:13px;border-radius:2px;background:rgba(42,120,214,${(0.06 + t * 0.9).toFixed(2)})"></div>`;
	}
	return html + "</div></div>";
}

function vaDonut(rows, cols) {
	const items = (rows || []).map((r) => ({ name: r.dimension, val: Number(r.c) || 0 }));
	const tot = items.reduce((a, i) => a + i.val, 0) || 1;
	const r = 26, c = 2 * Math.PI * r;
	let off = 0, seg = "";
	items.forEach((it, i) => {
		const frac = it.val / tot;
		seg += `<circle cx="34" cy="34" r="${r}" fill="none" stroke="${cols[i % cols.length]}" stroke-width="13" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-off * c).toFixed(1)}" transform="rotate(-90 34 34)"/>`;
		off += frac;
	});
	const leg = items.map((it, i) =>
		`<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#8a7355;margin:2px 0"><span style="width:8px;height:8px;border-radius:2px;background:${cols[i % cols.length]}"></span>${vaEscape(it.name)} ${Math.round(it.val / tot * 100)}%</div>`
	).join("");
	return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><svg viewBox="0 0 68 68" width="78" height="78" role="img" aria-label="Verteilung"></svg>`.replace("></svg>", ">" + seg + "</svg>") + `<div style="align-self:flex-start">${leg}</div></div>`;
}

function renderVisitorDashboard(mount, data) {
	const m = data.metrics || {};
	const sum = (arr, key) => (arr || []).reduce((a, r) => a + (Number(r[key]) || 0), 0);
	const views = sum(m.daily, "views");
	const uniq = sum(m.daily, "uniques");
	const routes = sum(m.daily, "routes");
	const stoRows = (data.storage && data.storage.tables) || [];
	const stoBytes = stoRows.reduce((a, t) => a + (Number(t.bytes) || 0), 0);
	const stoRowsN = stoRows.reduce((a, t) => a + (Number(t.rows) || 0), 0);

	mount.innerHTML =
		`<div class="va-pills">${[7, 30, 365, 3660].map((d) => `<span class="va-pill${d === visitorDashboardDays ? " is-active" : ""}" data-va-days="${d}">${d === 7 ? "7 T" : d === 30 ? "30 T" : d === 365 ? "12 M" : "Alles"}</span>`).join("")}</div>`
		+ `<div class="va-kpis">`
		+ `<div class="va-kpi"><div class="va-kpi__label">Aufrufe</div><div class="va-kpi__value">${views.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Eindeutige</div><div class="va-kpi__value">${uniq.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Routen</div><div class="va-kpi__value">${routes.toLocaleString("de-DE")}</div></div>`
		+ `</div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivität über Zeit</div>${vaLine(m.daily)}</div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivste Zeiten</div>${vaHeatmap(m.heatmap)}</div>`
		+ `<div class="va-card"><div class="va-card__label">Top-Suchbegriffe</div>${vaBars(m.search, "#2a78d6")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Herkunft</div>${vaBars(m.referrer, "#4a3aa7")}</div>`
		+ `<div class="va-two"><div class="va-card"><div class="va-card__label">Geräte</div>${vaDonut(m.device, ["#2a78d6", "#1baf7a", "#eda100"])}</div>`
		+ `<div class="va-card"><div class="va-card__label">Kartenansicht</div>${vaDonut(m.map_mode, ["#2a78d6", "#4a3aa7", "#eda100", "#888780"])}</div></div>`
		+ `<div class="va-card"><div class="va-card__label">Beliebteste Routen</div>${vaBars(m.route, "#1baf7a")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Speicher</div><div class="va-storage">Analytics-Tabellen: ${vaBytes(stoBytes)} · ${stoRowsN.toLocaleString("de-DE")} Zeilen<br>Datenbank gesamt: ${vaBytes(data.storage && data.storage.database_bytes)}</div></div>`;

	mount.querySelectorAll("[data-va-days]").forEach((pill) => {
		pill.addEventListener("click", () => { visitorDashboardDays = Number(pill.dataset.vaDays); void loadVisitorDashboard(); });
	});
}
```

- [ ] **Step 2: Verify syntax (now complete)**

Run: `node --check js/review/review-visitor-analytics.js`
Expected: no output (success).

- [ ] **Step 3: Commit + push**

```bash
git add js/review/review-visitor-analytics.js
git commit -m "feat(analytics): Besucher dashboard rendering (KPIs, line, heatmap, bars, donuts, storage)"
git push origin master
```

---

### Task C5: Editoren activity figures + final editor smoke test

**Files:**
- Modify: `js/review/review-visitor-analytics.js` (add `loadEditorActivityFigures()` reading `actor=editor`)

**Interfaces:**
- Consumes: `VISITOR_METRICS_API_URL`, the `#editor-activity-figures` mount (Task C1).

- [ ] **Step 1: Append the editor-figures loader**

```js
async function loadEditorActivityFigures() {
	const mount = document.getElementById("editor-activity-figures");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE || window.AVESMAPS_VISITOR_ANALYTICS_ENABLED === false) {
		return;
	}
	try {
		const response = await fetch(`${VISITOR_METRICS_API_URL}?actor=editor&days=7&_=${Date.now()}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
		const data = await response.json();
		if (!data || data.ok !== true || data.enabled === false) {
			return;
		}
		const edits = (data.metrics.daily || []).reduce((a, r) => a + (Number(r.views) || 0), 0);
		mount.innerHTML = `<div class="va-card" style="margin-top:10px"><div class="va-card__label">Editoren-Aktivität (7 T)</div><div class="va-storage">Editor-Aufrufe: ${edits.toLocaleString("de-DE")}</div></div>`;
	} catch (error) {
		/* best-effort */
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => loadEditorActivityFigures(), { once: true });
} else {
	loadEditorActivityFigures();
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check js/review/review-visitor-analytics.js`
Expected: no output.

- [ ] **Step 3: Commit + push**

```bash
git add js/review/review-visitor-analytics.js
git commit -m "feat(analytics): compact Editoren activity figures in the Status tab"
git push origin master
```

- [ ] **Step 4: Editor smoke test (manual, after deploy)**

1. Open the live site in the editor (edit mode), browse + search + plan a route + switch the map mode (generates events; they flush on tab-hide/15s).
2. Open the editor panel → `Status` → `Besucher` sub-tab → the dashboard loads (KPIs, line, heatmap, bars, donuts, Speicher card with table size).
3. Toggle the time-range pills (7 T / 30 T / 12 M / Alles) → the dashboard reloads.
4. Switch to the `Editoren` sub-tab → presence list intact + the compact "Editoren-Aktivität" figure.
5. Kill-switch check: set `define('AVESMAPS_VISITOR_ANALYTICS_ENABLED', false);` in `api/config.local.php` on the server → the Besucher tab shows "ausgeschaltet" and `track.php` returns `{ok:true}` without writing.

---

## Self-review

**Spec coverage:**
- §2 privacy (anonymous aggregate, ephemeral daily hash, referrer reduction, waypoint names, display thresholds) → A1 (hash/referrer), A2 (unique dedup + purge), A3 (`HAVING c >= min` thresholds), B2 (waypoint names / "Kartenpunkt"). ✔
- §3 UI (sub-tabs, Editoren figures, Besucher dashboard, narrow column, ausgeschaltet state) → C1, C2, C3, C4, C5. ✔
- §4 data model (`visitor_metric` + `visitor_daily_seen`, self-healing DDL, hour-nullable) → A1. ✔
- §5 taxonomy (all metrics) → A4 allow-list + B2 hooks. ✔
- §6 collection (batched sendBeacon, actor split, capture points) → B1, B2; server actor tag A4. ✔
- §7 read/aggregate → A5, A3. ✔
- §8 visualisation (forms + thresholds) → C4. ✔
- §9 STRATO (batched, tiny UPSERT, single probes) → enforced in every push/probe step. ✔
- §10 kill switch + storage card → A6 (flag exposure), A4/A5 (server gating), C3/C4 (ausgeschaltet + Speicher card). ✔
- §11 non-goals — nothing added beyond scope. ✔
- §12 open items — flag home (A6 Step 1–2), endpoint URL/auth (A5), threshold values (A3, baked in), hook points (B2 Step 1), salt (A1 `AVESMAPS_VISITOR_SALT`). ✔

**Placeholder scan:** the only deferred decisions are wrapped in explicit "confirm via grep" steps (A4.1, A6.1, B2.1) that produce the exact names before code is written — no blind TODOs. The route/search hooks (B2.3–B2.4) name the single line to add and the locals to adapt, confirmed in B2.1.

**Type consistency:** `trackVisitorEvent(metric, dimension)` used identically in B1/B2; the read shape `{metrics:{daily,heatmap,search,...}, storage:{tables,database_bytes}}` produced in A3/A5 matches the keys consumed in C4; `actor_type` enum values `visitor`/`editor` consistent across A1–A5; `AVESMAPS_VISITOR_ANALYTICS_ENABLED` consistent across A1/A4/A5/A6/B1/C3/C5.
