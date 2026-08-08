# Edit-Mode Live-Sync Last senken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der 15-Sekunden-Live-Sync-Poll im Editor soll bei unveränderter Karte fast nichts kosten, damit mehrere gleichzeitig zeichnende Editoren den PHP-Pool nicht mehr sättigen.

**Architecture:** Der Poll wird zweigeteilt. Ein neuer, spottbilliger Endpunkt `map-revision.php` beantwortet „hat sich etwas geändert?" mit einer einzigen indizierten Zeile; der Client holt das teure Delta über `map-features.php?since_revision=N` nur noch, wenn die Revision wirklich vorgerückt ist. Zusätzlich als Absicherung: `map-features.php` steigt bei leerem Delta VOR den sechs tabellenweiten Anreicherungs-Queries aus, und `presence.php` legt seine Tabelle nur noch bei echtem Fehlen an statt bei jedem Poll.

**Tech Stack:** PHP 8 (strict types) + PDO/MySQL, Vanilla-JS (kein Build), Leaflet. Tests: PHP-CLI mit SQLite (`-d extension=php_sqlite3.dll -d extension=php_pdo_sqlite.dll`), Node für die JS-Helfer.

## Global Constraints

- **OS/Shell:** Windows + PowerShell. CRLF-Editfalle: vor dem Editieren `git ls-files --eol <datei>` prüfen; auf CRLF-Dateien einzeilige Edits bevorzugen.
- **Shared Working Tree:** NIE `git add -A`/`git add .`/`git commit -a`. Nur eigene Dateien per Pfad stagen (`git commit --only -- <pfad>`); liegt fremde Arbeit im selben File, nur den eigenen Hunk via `git apply --cached` stagen. `index.html` trägt gerade fremde uncommittete Arbeit — dieses File hier NICHT anfassen.
- **STRATO:** Heiße Endpunkte NIE in Schleifen abfragen; Diagnose nur mit EINZELrequests; nie gegen einen hängenden Server proben.
- **Deploy:** Push auf `master` → ~1–2 min Auto-Deploy; danach Remote-SHA verifizieren; Live-Seite erst nach der Deploy-Verzögerung prüfen. Das Deploy-Stamping hängt `?v=` an JS/CSS an — NIE `?v=` von Hand schreiben.
- **Kein ASSET_VERSION-Bump nötig:** geändert werden `index.html`-verlinkte JS (`routing.js`, `config.js`) und PHP — KEINE dynamisch geladenen Editor-Assets (`territory-editor-inline-host.js` bleibt unberührt).
- **PAYLOAD_VERSION NICHT bumpen:** `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` (map-features.php:22) bleibt `8`. Die Änderungen ändern die Payload-FORM nicht (leeres Delta hat dieselbe Struktur). Ein unnötiger Bump zwingt jeden Client zum 14-MB-Neuladen (ETag-Herde) — genau der Verstärker, den wir vermeiden.
- **Sprache:** Deutsche UI-Strings bleiben deutsch; neue `error`-Messages und Kommentare in Englisch.
- **Commits:** klein, konventionelle Prefixe (`feat/fix/perf/refactor`), direkt auf `master`. Commit-Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `api/app/map-revision.php` — öffentlicher, enrichment-freier Endpunkt; liefert nur `{ok, revision}`. Eine Verantwortung: „aktuelle Kartenrevision lesen".
- **Modify** `js/config.js` — neue Konstante `MAP_REVISION_API_URL` neben `MAP_FEATURES_API_URL`.
- **Modify** `js/routing/routing.js` — `pollLiveMapUpdates` fragt zuerst die Revision ab und holt das Delta nur bei Vorlauf; Hidden-Tab-Gate; neuer reiner Helfer `avesmapsLiveSyncShouldSkipDelta`.
- **Modify** `api/edit/map/presence.php` — DDL raus aus dem Poll-Pfad (lazy ensure-on-error); neuer Helfer `avesmapsIsMissingTableError`.
- **Modify** `api/app/map-features.php` — Leeres-Delta-Frühausstieg vor den sechs Loadern (Defense in Depth).

Der Deploy-Allowlist erfasst das ganze `api`-Verzeichnis (`.github/workflows/deploy-avesmaps-strato.yml:90`) → die neue Datei deployt automatisch, keine Allowlist-Änderung nötig.

---

### Task 1: Billiger Revisions-Endpunkt `api/app/map-revision.php`

**Files:**
- Create: `api/app/map-revision.php`
- Test: `scratchpad/test-map-revision-query.php` (Wegwerf-Harness, nicht committen)

**Interfaces:**
- Produces: `GET /api/app/map-revision.php` → `200 {"ok":true,"revision":<int>}`. Öffentlich (kein Auth), keine Anreicherung. Fehlt die `map_revision`-Zeile → `revision:0`.

- [ ] **Step 1: Failing test schreiben** — der Query-Vertrag: vorhandene Revision → int; fehlende Zeile → 0.

```php
<?php
declare(strict_types=1);
// Verifiziert den Revisions-Lesevertrag des neuen Endpunkts gegen echtes SQLite.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');

$readRevision = function (PDO $pdo): int {
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    return $revision === false ? 0 : (int) $revision;
};

$fail = 0;
$check = function (string $l, bool $ok) use (&$fail) { echo ($ok ? "  PASS  " : "  FAIL  ") . $l . "\n"; if (!$ok) $fail++; };

$check('leere Tabelle -> 0', $readRevision($pdo) === 0);
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 4711)');
$check('vorhandene Revision -> int 4711', $readRevision($pdo) === 4711);

echo $fail === 0 ? "\nALL PASSED\n" : "\n{$fail} FAILED\n";
exit($fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Test laufen lassen (muss zunächst grün sein — er prüft die Query, nicht die Datei)**

Run: `php -d extension=php_sqlite3.dll -d extension=php_pdo_sqlite.dll scratchpad/test-map-revision-query.php`
Expected: ALL PASSED (der Vertrag steht fest, bevor die Datei existiert).

- [ ] **Step 3: Endpunkt schreiben**

`api/app/map-revision.php`:
```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';

// Dirt-cheap "has the map changed?" probe for the edit-mode live-sync poll. The editor asks this every 15s;
// only when the returned revision advances does it fetch map-features.php?since_revision=N for the actual
// delta. Deliberately public and enrichment-free (one indexed row read) so N editors polling in parallel
// cost almost nothing -- the full map-features.php path runs six table-wide loader queries on every call
// regardless of the delta (see docs/superpowers/plans/2026-07-25-edit-mode-livesync-last.md). The map
// revision number is not sensitive. Mirrors avesmapsFetchMapRevision() in map-features.php (one line, not
// worth a shared include).
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read map data.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET requests are allowed for the map revision.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;

    avesmapsJsonResponse(200, ['ok' => true, 'revision' => $revision === false ? 0 : (int) $revision]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'The map revision could not be read.');
}
```

- [ ] **Step 4: Syntax prüfen**

Run: `php -l api/app/map-revision.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```bash
git commit --only -m "$(printf 'perf(map): add a cheap map-revision probe endpoint for the edit live-sync poll\n\nThe edit-mode live-sync poll hits map-features.php?since_revision every 15s per\neditor, and that endpoint runs six table-wide loader queries on every call even\nfor an empty delta. This dedicated endpoint answers "has the map changed?" from\none indexed row read, so the client can skip the expensive fetch when nothing\nmoved. Public and enrichment-free; the revision number is not sensitive.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" -- api/app/map-revision.php
```

---

### Task 2: Client pollt zuerst die Revision (+ Hidden-Tab-Gate)

**Files:**
- Modify: `js/config.js` (bei `MAP_FEATURES_API_URL`, Zeile 146)
- Modify: `js/routing/routing.js:203-235` (`pollLiveMapUpdates`)
- Test: `scratchpad/test-livesync-skip.js` (Wegwerf-Harness)

**Interfaces:**
- Consumes: `MAP_REVISION_API_URL` (Task-lokal neu), `mapDataSourceStatus.revision` (routing.js:174), `MAP_FEATURES_API_URL` (config.js:146).
- Produces: reiner Helfer `avesmapsLiveSyncShouldSkipDelta(localRevision, probeOk, probeRevision) -> boolean` (top-level in routing.js) und ein `pollLiveMapUpdates`, das das Delta nur bei Revisions-Vorlauf holt.

- [ ] **Step 1: Failing test für den reinen Entscheidungs-Helfer** — er extrahiert die Funktion aus der ECHTEN Quelldatei (kein Nachbau) und prüft die Verzweigung.

```js
const fs = require("fs");
const src = fs.readFileSync("js/routing/routing.js", "utf8");
const m = src.match(/function avesmapsLiveSyncShouldSkipDelta[\s\S]*?\n\}/);
if (!m) { console.error("FAIL: avesmapsLiveSyncShouldSkipDelta not found in routing.js"); process.exit(1); }
eval(m[0]); // controlled: input is our own repo file, throwaway harness

let fail = 0;
const check = (l, ok) => { console.log((ok ? "  PASS  " : "  FAIL  ") + l); if (!ok) fail++; };

check("gleiche Revision -> skip", avesmapsLiveSyncShouldSkipDelta(100, true, 100) === true);
check("hoehere Revision -> NICHT skip", avesmapsLiveSyncShouldSkipDelta(100, true, 101) === false);
check("Probe fehlgeschlagen -> NICHT skip (Delta holen)", avesmapsLiveSyncShouldSkipDelta(100, false, 100) === false);
check("kaputte Revision -> NICHT skip", avesmapsLiveSyncShouldSkipDelta(100, true, undefined) === false);
check("niedrigere Revision -> skip", avesmapsLiveSyncShouldSkipDelta(100, true, 99) === true);

console.log(fail === 0 ? "\nALL PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `node scratchpad/test-livesync-skip.js`
Expected: FAIL mit „avesmapsLiveSyncShouldSkipDelta not found".

- [ ] **Step 3: `MAP_REVISION_API_URL` in `js/config.js` ergänzen** — direkt nach Zeile 146.

```js
const MAP_REVISION_API_URL = window.AVESMAPS_MAP_REVISION_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/map-revision.php" : "");
```

- [ ] **Step 4: Helfer + geänderten Poll in `js/routing/routing.js` schreiben.** Den reinen Helfer direkt VOR `pollLiveMapUpdates` (vor Zeile 203) einfügen:

```js
// Pure decision for the live-sync poll: skip the expensive map-features delta fetch only when the cheap
// revision probe is trustworthy AND reports no advance past what we already have. A failed/omitted probe
// returns false -> fall through to the delta fetch (old behaviour), never a silent miss.
function avesmapsLiveSyncShouldSkipDelta(localRevision, probeOk, probeRevision) {
	const probed = Number(probeRevision);
	return probeOk === true && Number.isFinite(probed) && probed <= (Number(localRevision) || 0);
}
```

`pollLiveMapUpdates` (203-235) so ersetzen — der Kopf bekommt das Hidden-Tab-Gate, und vor dem Delta-Fetch die Revisions-Probe:

```js
async function pollLiveMapUpdates() {
	if (!IS_EDIT_MODE || !MAP_FEATURES_API_URL || isLiveMapUpdatePending || !mapDataSourceStatus?.revision) {
		return;
	}
	// Hidden tab: nobody is watching -> don't poll. Cuts idle load from backgrounded editor tabs.
	if (typeof document !== "undefined" && document.hidden) {
		return;
	}

	isLiveMapUpdatePending = true;
	try {
		// Cheap "did anything change?" probe first. The full delta fetch below runs table-wide enrichment
		// loaders server-side, so we only pay it when the revision actually advanced. A failed probe falls
		// through to the delta fetch (unchanged behaviour), never a skipped update.
		if (MAP_REVISION_API_URL) {
			const probe = await fetch(MAP_REVISION_API_URL, { headers: { Accept: "application/json" } });
			const probeData = await probe.json().catch(() => ({}));
			if (avesmapsLiveSyncShouldSkipDelta(mapDataSourceStatus.revision, probe.ok && probeData?.ok === true, probeData?.revision)) {
				return; // finally clears isLiveMapUpdatePending
			}
		}

		const url = new URL(MAP_FEATURES_API_URL, window.location.href);
		url.searchParams.set("since_revision", String(mapDataSourceStatus.revision));
		const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(apiErrorMessage(data, "Live-Aktualisierung fehlgeschlagen."));
		}

		const features = Array.isArray(data.features) ? data.features : [];
		if (features.length > 0) {
			features.forEach(applyLiveMapFeatureUpdate);
			refreshPlannerAfterFeatureChange({ updateRoute: true });
			void loadChangeLog();
			showFeedbackToast(`${features.length} Kartenänderung(en) aktualisiert.`, "info");
		}

		if (data.revision && mapDataSourceStatus) {
			mapDataSourceStatus.revision = data.revision;
			updateMapDataStatus({ avesmapsSource: mapDataSourceStatus });
		}
	} catch (error) {
		console.warn("Live-Aktualisierung konnte nicht geladen werden:", error);
	} finally {
		isLiveMapUpdatePending = false;
	}
}
```

- [ ] **Step 5: Test laufen lassen, muss grün sein**

Run: `node scratchpad/test-livesync-skip.js`
Expected: ALL PASSED

- [ ] **Step 6: JS-Syntax beider Dateien prüfen**

Run: `node --check js/routing/routing.js && node --check js/config.js`
Expected: kein Fehler.

- [ ] **Step 7: Commit** (beide eigenen Dateien per Pfad)

```bash
git commit --only -m "$(printf 'perf(editor): live-sync poll probes the cheap revision endpoint before the delta\n\npollLiveMapUpdates now asks map-revision.php whether anything changed and only\nfetches map-features.php?since_revision when the revision actually advanced, so\nN idle editors cost one trivial revision read each instead of the full loader\nset every 15s. Also skips polling entirely while the tab is hidden. A failed\nprobe falls through to the delta fetch, so no update is ever silently missed.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" -- js/routing/routing.js js/config.js
```

---

### Task 3: `presence.php` — Tabelle nur bei echtem Fehlen anlegen

**Files:**
- Modify: `api/edit/map/presence.php` (Zeile 26-39 Handler; neuer Helfer unten)
- Test: `scratchpad/test-missing-table.php` (Wegwerf-Harness)

**Interfaces:**
- Produces: `avesmapsIsMissingTableError(Throwable $e): bool` — erkennt „Tabelle fehlt" über MySQL- UND SQLite-Signale.

- [ ] **Step 1: Failing test für den Erkennungs-Helfer** (aus der echten Datei extrahiert).

```php
<?php
declare(strict_types=1);
$src = file_get_contents('api/edit/map/presence.php');
$start = strpos($src, 'function avesmapsIsMissingTableError');
if ($start === false) { fwrite(STDERR, "FAIL: helper not in presence.php\n"); exit(1); }
$end = strpos($src, "\n}", $start);
eval(substr($src, $start, $end - $start + 2)); // controlled: our own repo file, throwaway harness

$fail = 0;
$check = function (string $l, bool $ok) use (&$fail) { echo ($ok ? "  PASS  " : "  FAIL  ") . $l . "\n"; if (!$ok) $fail++; };

$mysql = new PDOException("SQLSTATE[42S02]: Base table or view not found: 1146 Table 'x.editor_presence' doesn't exist");
$check('MySQL "doesn\'t exist" erkannt', avesmapsIsMissingTableError($mysql) === true);
$check('SQLite "no such table" erkannt', avesmapsIsMissingTableError(new PDOException('SQLSTATE[HY000]: General error: 1 no such table: editor_presence')) === true);
$check('fremder Fehler NICHT als fehlende Tabelle', avesmapsIsMissingTableError(new PDOException('SQLSTATE[23000]: Integrity constraint violation')) === false);

echo $fail === 0 ? "\nALL PASSED\n" : "\n{$fail} FAILED\n";
exit($fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `php scratchpad/test-missing-table.php`
Expected: FAIL („helper not in presence.php").

- [ ] **Step 3: Helfer + lazy Ensure in `api/edit/map/presence.php` schreiben.** Den unbedingten Aufruf `avesmapsEnsureEditorPresenceTable($pdo);` (Zeile 28) ENTFERNEN und den Handler (Zeile 30-39) so ersetzen:

```php
    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // The presence table is created lazily on first miss, NOT on every poll. Every connected editor hits
    // this endpoint every 30s; a CREATE TABLE IF NOT EXISTS on each call is a metadata probe on the hot
    // path that multiplies with editor count. Try the normal path first; only when the table is genuinely
    // absent do we create it once and retry. Steady state runs zero DDL here.
    try {
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
    } catch (PDOException $exception) {
        if (!avesmapsIsMissingTableError($exception)) {
            throw $exception;
        }
        avesmapsEnsureEditorPresenceTable($pdo);
        if ($requestMethod === 'POST') {
            avesmapsWriteEditorPresenceHeartbeat($pdo, $user);
        }
        $onlineEditors = avesmapsListOnlineEditors($pdo);
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'users' => $onlineEditors,
        'online_seconds' => AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS,
        'visitors' => avesmapsReadVisitorPresence($pdo),
    ]);
```

Und den neuen Helfer bei den anderen Funktionen (z. B. direkt vor `avesmapsEnsureEditorPresenceTable`) ergänzen:

```php
// True when the exception means "the table does not exist yet" -- across MySQL (SQLSTATE 42S02 / "doesn't
// exist" / "base table or view not found") and SQLite ("no such table", used by the test harness). Any
// other error is a real failure and must propagate.
function avesmapsIsMissingTableError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S02') {
        return true;
    }
    $message = strtolower($exception->getMessage());
    return str_contains($message, "doesn't exist")
        || str_contains($message, 'base table or view not found')
        || str_contains($message, 'no such table');
}
```

- [ ] **Step 4: Test grün + Syntax**

Run: `php scratchpad/test-missing-table.php && php -l api/edit/map/presence.php`
Expected: ALL PASSED und `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "$(printf 'perf(presence): create the presence table lazily instead of on every 30s poll\n\npresence.php ran CREATE TABLE IF NOT EXISTS on every call -- a metadata probe on\na path polled every 30s by every connected editor, multiplying with editor\ncount. Try the read/write first and only create the table when it is genuinely\nmissing (matched across MySQL and SQLite), then retry. Steady state runs no DDL.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" -- api/edit/map/presence.php
```

---

### Task 4: `map-features.php` — Frühausstieg bei leerem Delta (Defense in Depth)

**Files:**
- Modify: `api/app/map-features.php` (nach dem 304-Block, vor den Loadern ab Zeile 67)
- Test: `scratchpad/test-delta-exists.php` (Wegwerf-Harness)

**Interfaces:**
- Consumes: `avesmapsParseOptionalPositiveInt` (bereits in map-features.php genutzt, Zeile 125), `$revision` (Zeile 51).
- Produces: kein neues Symbol; ein zusätzlicher Frühausstieg auf dem `since_revision`-Pfad.

- [ ] **Step 1: Failing test für die Delta-Existenz-Query** (der entscheidende Teil).

```php
<?php
declare(strict_types=1);
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_features (id, revision) VALUES (1, 10), (2, 20)');

$hasDelta = function (PDO $pdo, int $since): bool {
    $st = $pdo->prepare('SELECT 1 FROM map_features WHERE revision > :since_revision LIMIT 1');
    $st->execute(['since_revision' => $since]);
    return $st->fetchColumn() !== false;
};

$fail = 0;
$check = function (string $l, bool $ok) use (&$fail) { echo ($ok ? "  PASS  " : "  FAIL  ") . $l . "\n"; if (!$ok) $fail++; };

$check('since=20 (nichts neuer) -> kein Delta', $hasDelta($pdo, 20) === false);
$check('since=15 -> Delta vorhanden (Zeile rev 20)', $hasDelta($pdo, 15) === true);
$check('since=5 -> Delta vorhanden', $hasDelta($pdo, 5) === true);

echo $fail === 0 ? "\nALL PASSED\n" : "\n{$fail} FAILED\n";
exit($fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Test laufen lassen (grün — er prüft den Query-Vertrag vorab)**

Run: `php -d extension=php_sqlite3.dll -d extension=php_pdo_sqlite.dll scratchpad/test-delta-exists.php`
Expected: ALL PASSED.

- [ ] **Step 3: Frühausstieg in `api/app/map-features.php` einsetzen.** Direkt nach dem `if ($ifNoneMatch !== '' && avesmapsETagMatches(...)) { http_response_code(304); exit; }`-Block (endet ~Zeile 64), VOR `$wikiLocationLinks = ...` (Zeile 67):

```php
    // Defence in depth for the live-sync poll: when the client asks for a delta (since_revision) and NOTHING
    // changed since, answer with an empty delta BEFORE running the six table-wide enrichment loaders below.
    // The dedicated map-revision.php probe should already spare us most of these calls, but a direct
    // since_revision request (an old cached client, a retry) must not be able to trigger the full loader set
    // for zero changed rows. The revision index (idx_map_features_revision) makes this a cheap EXISTS check.
    $sinceRevisionProbe = avesmapsParseOptionalPositiveInt($_GET['since_revision'] ?? null, 'since_revision');
    if ($sinceRevisionProbe !== null) {
        $deltaExists = $pdo->prepare('SELECT 1 FROM map_features WHERE revision > :since_revision LIMIT 1');
        $deltaExists->execute(['since_revision' => $sinceRevisionProbe]);
        if ($deltaExists->fetchColumn() === false) {
            avesmapsJsonResponse(200, [
                'ok' => true,
                'revision' => $revision,
                'type' => 'FeatureCollection',
                'features' => [],
                'source_catalog' => (object) [],
                'feature_sources' => (object) [],
            ]);
        }
    }
```

- [ ] **Step 4: Test grün + Syntax**

Run: `php -d extension=php_sqlite3.dll -d extension=php_pdo_sqlite.dll scratchpad/test-delta-exists.php && php -l api/app/map-features.php`
Expected: ALL PASSED und `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "$(printf 'perf(map): short-circuit an empty since_revision delta before the enrichment loaders\n\nmap-features.php ran six table-wide loader queries (political context, source\ncatalog, wiki links, ...) on every since_revision poll even when the delta was\nempty. Answer an empty delta with an indexed EXISTS check first, before any of\nthem. Payload shape is unchanged (same keys, empty), so PAYLOAD_VERSION stays 8.\nDefence in depth behind the map-revision.php probe for any client that still\ncalls this path directly.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" -- api/app/map-features.php
```

---

### Task 5: Deploy + Live-Verifikation (Einzelrequests, gesunde Seite)

**Files:** keine (Deploy + Verifikation)

**Interfaces:** Consumes alle vorigen Tasks.

- [ ] **Step 1: Push + Remote-SHA verifizieren**

```bash
git push origin master
```
Danach: `git rev-parse HEAD` und `git ls-remote origin master` müssen übereinstimmen. Bei Reject: `git fetch origin` + `git rebase --autostash origin/master` + erneut pushen (nie force).

- [ ] **Step 2: Deploy abwarten, dann bestätigen**

Run: `gh run list --limit 1 --json status,conclusion,headSha --jq '.[0]'`
Expected: `status:"completed"`, `conclusion:"success"`, `headSha` = lokaler HEAD.

- [ ] **Step 3: Neuen Endpunkt live prüfen (EIN Request)**

Run (PowerShell): `Invoke-RestMethod -Uri ("https://avesmaps.de/api/app/map-revision.php?cb=" + [guid]::NewGuid()) -TimeoutSec 20`
Expected: `ok:True`, `revision:<zahl>`, Antwort in < ~300 ms.

- [ ] **Step 4: map-features.php-Parität prüfen (EIN Request, kein Loop)** — ein normaler Voll-Load muss unverändert funktionieren.

Run (PowerShell): `(Invoke-WebRequest -Uri ("https://avesmaps.de/api/app/map-features.php?cb=" + [guid]::NewGuid()) -TimeoutSec 60).StatusCode`
Expected: `200`, und die Antwort enthält weiterhin `"ok":true` + `"features"`.

- [ ] **Step 5: Editor-Verhalten im Browser bestätigen (Owner-Session, Netzwerk-Tab).** Editor öffnen; im Netzwerk-Tab beobachten:
  - Der 15-s-Poll trifft jetzt `map-revision.php` (winzig, schnell).
  - `map-features.php?since_revision=...` feuert NUR nach einer echten Änderung (einen Weg speichern → beim nächsten Poll erscheint der Delta-Request, sonst nicht).
  - Kein Dauerfeuer auf `map-features.php` im Leerlauf.
  Single-Tab genügt für die Mechanik; die Mehrbenutzer-Bestätigung macht der Owner in einer echten Zeichen-Session.

- [ ] **Step 6: Scratchpad-Testdateien wegräumen** (nicht committen — es sind Wegwerf-Harnesse). Ergebnis in `pending-fixes.md` eintragen (Nutzersicht, Deutsch, Commit-SHAs), damit die Daily-Fixes-Routine es meldet.

---

## Ehrliche Kalibrierung (kein Schönreden)

- Die Mechanik ist code-belegt. **Der reale Lastgewinn unter Mehrbenutzer-Betrieb ist damit NICHT bewiesen** — er zeigt sich erst, wenn die nächste Zeichen-Session mit mehreren Editoren nicht mehr hängt. Die Verifikation oben belegt nur, dass Leerlauf-Polls jetzt billig sind (die dominante Frequenz).
- Der endgültige Beweis wäre der PHP-Slow-Log eines Crash-Fensters (bei STRATO erst verzögert erhältlich). Bis dahin gilt: Verbesserung plausibel und gemessen an der Poll-Kostenstruktur, nicht am Live-Crash.
- Nicht adressiert (bewusst, eigener Schritt falls nötig): der **aktive** Zeichen-Fall lädt zur Delta-Übertragung weiterhin die sechs Tabellen-Loader — nur eben nur dann, wenn wirklich etwas neu ist. Falls Messungen zeigen, dass schon der aktive Fall sättigt, ist der nächste Hebel, die Anreicherung auf die geänderten Delta-Zeilen zu beschränken statt tabellenweit (größerer Umbau).
- Offen aus dem Ausfall, NICHT Teil dieses Plans: `/tmp` hat nur 4 GB und der Layer-Cache dort läuft nie ab; der Politik-Layer hat als einziger schwerer Endpunkt keinen `app_setting`-Notaus.

## Self-Review

- **Spec-Abdeckung:** „idle-Polls fast gratis" → Task 1+2 (Revisions-Probe) + Task 4 (Server-Frühausstieg). „presence CREATE TABLE pro Poll" → Task 3. „ohne den heißen Endpunkt zu brechen" → PAYLOAD_VERSION bleibt 8, gleiche Payload-Form, Parität in Task 5 Step 4 geprüft. Mehrbenutzer-Multiplikation → Task 2 (weniger Requests/Editor) + Task 3 (kein DDL/Editor).
- **Typkonsistenz:** `avesmapsLiveSyncShouldSkipDelta(localRevision, probeOk, probeRevision)` identisch in Definition (Task 2 Step 4) und Test (Task 2 Step 1). `avesmapsIsMissingTableError(Throwable)` identisch in Task 3. `MAP_REVISION_API_URL` einheitlich.
- **Keine Platzhalter:** jeder Code-Schritt trägt echten Code.
