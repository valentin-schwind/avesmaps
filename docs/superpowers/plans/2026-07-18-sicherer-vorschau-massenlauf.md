# Sicherer, selbstlaufender Vorschau-Massenlauf (Karten + Abenteuer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Vorschauen holen" mass run (Kartensammlung + Abenteuer) run to completion after ONE click without ever saturating the STRATO PHP-FPM pool, and re-arm both currently-disabled editor tiles.

**Architecture:** Four endpoint-agnostic safety mechanisms live in one new side-effect-free module `api/_internal/app/autoget-run.php`: (1) a shared non-blocking MySQL `GET_LOCK` single-flight lock, (2) a ~4s per-step wall-clock budget, (3) `EnsureTables` removed from the step path, (4) a per-run DB kill-switch flag. Both the existing citymap endpoint (retrofitted) and a new adventure-cover endpoint (built to the same pattern) route their step through a shared `avesmapsAutogetGuardedStep()` wrapper. The repetition is driven client-side (the tab loops POSTs); there is no cron/SSH/server chain.

**Tech Stack:** PHP 8 (strict types, PDO/MySQL), vanilla JS (no build step), MySQL `GET_LOCK`/`RELEASE_LOCK`, existing shared helpers (`app-setting.php`, `avesmapsCitymapAutogetOne`, `avesmapsAdventureSaveCoverLocal`). Tests: bare `php` CLI with `assert()` (no DB) + `node` for JS; a Fake-PDO harness for the gate ordering.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec/memories/AGENTS.md.

- **STRATO: never loop a live endpoint.** Prove the safety logic LOCALLY (bare `php` + pure asserts + Fake-PDO); never loop against prod. The image fetch itself needs an owner live run at the end (no local DB).
- **No cron / no SSH-CLI / no server-triggered chain.** Quasi-background only: one click, then the existing client loop drives the steps; tab closed = run pauses, server progress persists.
- **ONE shared lock name for both runs** — system-wide only ONE preview run at a time (maps OR adventures).
- **The due-query must NEVER filter on an origin field** (`thumb_origin`/`field_origins.cover_url`): the default value would exclude everything and the button would silently do nothing. The skip rule lives in CODE and produces a `skipped_manual` state.
- **Write the per-unit state DIRECTLY after each fetch, never lease a batch up front** (else the due-query sees nothing, reports remaining=0, and calls a half-finished run done).
- **Do NOT change the actual image fetch** (`avesmapsCitymapAutogetOne` / `avesmapsAdventureSaveCoverLocal`) — only the calling frame around it.
- **Do NOT touch the session lock** (`api/_internal/auth.php:38`, fix `1a1d5ede`) — already solved, not the root here.
- **ASSET_VERSION:** both editors load with `?v=Date.now()` → NO bump needed; never write a `?v=` by hand.
- **Language:** German user-facing UI strings stay German; code comments, commit messages, and `error.code`/`error.message` in English. `error.message` never leaks `getMessage()`.
- **Envelope:** success `{"ok":true, ...}`; error via `avesmapsErrorResponse(status, 'machine_code', 'human message')`.
- **Tests:** `php -d zend.assertions=1 -d assert.exception=1 <file>` (the tests self-abort with FATAL if assertions are off). No local DB / no `pdo_mysql` / no `sqlite` → only pure functions + the Fake-PDO harness are locally provable. JS tests: bare `node <file>`.
- **Git:** small verified commits; stage ONLY the files you touched, by explicit path (shared working tree — never `git add -A`). Do NOT push to master (that triggers the live deploy → left to the owner).
- **Windows + PowerShell + CRLF:** prefer single-line edits on CRLF files (`html/*.html`, `js/**`).

---

## File Structure

**New files:**
- `api/_internal/app/autoget-run.php` — the four-mechanism core, feature-agnostic. Constants (shared lock name, step budget), pure predicates (`avesmapsAutogetLockAcquired`, `avesmapsAutogetDeadlineReached`), thin DB lock wrappers, and the `avesmapsAutogetGuardedStep()` gate. Side-effect-free on include (const + function defs only), so a test can `require` it with no MySQL — the `dump-lock.php` purity contract.
- `api/_internal/app/__tests__/autoget-run-test.php` — unit tests for the pure wrappers + a Fake-PDO test of the full gate ordering (stopped / busy / ok / release-in-finally).
- `api/edit/map/adventure-cover-autoget.php` — the NEW adventure-cover mass run endpoint (`autoget_step`/`status`/`reset`), same shape as `citymap-autoget.php`.
- `js/review/review-adventure-cover-autoget.js` — the client loop twin (`window.startAdventureCoverAutoget`), mirrors `review-citymap-autoget.js`.

**Modified files:**
- `api/edit/map/citymap-autoget.php` — retrofit the four mechanisms: guarded step + budget, `EnsureTables` out of the `autoget_step` path.
- `api/_internal/app/citymaps.php` — add the citymap kill-switch reader (`avesmapsCitymapAutogetEnabled`).
- `js/review/review-citymap-autoget.js` — understand the new `busy`/`stopped` step responses.
- `api/_internal/app/adventures.php` — add `cover_auto_state` column (self-healing), the adventure kill-switch reader, and the pure skip predicate.
- `api/_internal/wiki/adventure-sync.php` — add the adventure-cover step core (`avesmapsAdventureCoverAutogetStep`).
- `api/_internal/app/__tests__/adventure-cover-autoget-test.php` — unit tests for the adventure pure predicates.
- `html/citymap-editor.html` — re-arm the `ceAutogetBtn` tile (undisable, re-wire).
- `html/adventure-editor.html` — re-arm the `aeAutogetBtn` tile (undisable, add a sub-label, wire a new handler).
- `index.html` — include `review-adventure-cover-autoget.js`.

---

## Task 1: Shared gate module `autoget-run.php` (the four-mechanism core)

**Files:**
- Create: `api/_internal/app/autoget-run.php`
- Test: `api/_internal/app/__tests__/autoget-run-test.php`

**Interfaces:**
- Produces:
  - `const AVESMAPS_AUTOGET_RUN_LOCK = 'avesmaps_preview_autoget';` — the ONE shared lock name (both runs).
  - `const AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS = 4.0;`
  - `avesmapsAutogetLockAcquired(mixed $rawResult): bool` — PURE: interpret a raw `GET_LOCK` column value.
  - `avesmapsAutogetDeadlineReached(float $startedAt, float $now, float $budgetSeconds): bool` — PURE.
  - `avesmapsAutogetAcquireRunLock(PDO $pdo, string $lockName): bool` — DB: `SELECT GET_LOCK(:name, 0)`.
  - `avesmapsAutogetReleaseRunLock(PDO $pdo, string $lockName): void` — DB: `SELECT RELEASE_LOCK(:name)`.
  - `avesmapsAutogetGuardedStep(PDO $pdo, bool $enabled, string $lockName, callable $doStep): array` — kill-switch → lock → `$doStep($pdo)` → release (finally). Returns `['ok'=>true,'stopped'=>true]`, `['ok'=>true,'busy'=>true]`, or whatever `$doStep` returns.

- [ ] **Step 1: Write the failing test**

Create `api/_internal/app/__tests__/autoget-run-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the autoget safety core. No real DB: the pure wrappers are exercised directly, and the
 * gate ordering (kill-switch -> lock -> step -> release) is exercised through a Fake PDO whose GET_LOCK
 * result is scripted. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/autoget-run-test.php
 *
 * STRATO has no cron and looping a heavy endpoint once saturated the pool (php-pool-hang-incident
 * 2026-07-17). This core is what makes the run safe; there is no local MySQL, so this Fake-PDO harness is
 * the ONLY place the gate ordering is provable before the owner's live run.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../autoget-run.php';

// ---- avesmapsAutogetLockAcquired: interpret a raw GET_LOCK column ------------------------------------
// GET_LOCK(name,0) returns 1 (got it), 0 (timeout/held by another connection), or NULL (error). Drivers
// may surface 1/0 as int OR string, so the predicate normalises to string.
assert(avesmapsAutogetLockAcquired('1') === true);
assert(avesmapsAutogetLockAcquired(1) === true);
assert(avesmapsAutogetLockAcquired('0') === false, '0 = held by another connection -> not acquired');
assert(avesmapsAutogetLockAcquired(0) === false);
assert(avesmapsAutogetLockAcquired(null) === false, 'NULL = GET_LOCK error -> conservatively not acquired');
assert(avesmapsAutogetLockAcquired('') === false);
assert(avesmapsAutogetLockAcquired(false) === false);
echo "lock-acquired ok\n";

// ---- avesmapsAutogetDeadlineReached: the per-step wall-clock budget ----------------------------------
assert(avesmapsAutogetDeadlineReached(1000.0, 1003.9, 4.0) === false, 'under budget -> keep going');
assert(avesmapsAutogetDeadlineReached(1000.0, 1004.0, 4.0) === true, 'exactly at budget -> stop');
assert(avesmapsAutogetDeadlineReached(1000.0, 1010.0, 4.0) === true, 'over budget -> stop');
assert(avesmapsAutogetDeadlineReached(1000.0, 1000.0, 4.0) === false, 'no time passed -> keep going');
echo "deadline ok\n";

// ---- avesmapsAutogetGuardedStep: kill-switch -> lock -> step -> release ------------------------------
// A Fake PDO/PDOStatement, built WITHOUT a driver (empty constructor), that logs every prepared query and
// hands back scripted GET_LOCK results. This lets us prove the exact gate ORDER with no MySQL.
final class FakeAutogetStmt extends PDOStatement
{
    public function __construct(private mixed $col) {}
    public function execute(?array $params = null): bool { return true; }
    public function fetchColumn(int $column = 0): mixed { return $this->col; }
}
final class FakeAutogetPdo extends PDO
{
    /** @var string[] every prepared statement text, in order */
    public array $log = [];
    /** @var array<int,mixed> scripted GET_LOCK results, consumed FIFO */
    public array $lockResults = ['1'];
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->log[] = $query;
        if (str_contains($query, 'GET_LOCK')) {
            $next = array_key_exists(0, $this->lockResults) ? array_shift($this->lockResults) : '0';
            return new FakeAutogetStmt($next);
        }
        return new FakeAutogetStmt(null); // RELEASE_LOCK etc.
    }
}

// (a) kill-switch OFF: returns stopped, never touches the DB, never runs the step.
$pdo = new FakeAutogetPdo();
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, false, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true, 'done' => true];
});
assert($out === ['ok' => true, 'stopped' => true], 'kill-switch off -> stopped envelope');
assert($ran === false, 'kill-switch off -> step never runs');
assert($pdo->log === [], 'kill-switch off -> no lock taken (checked before the lock)');
echo "guarded-step: kill-switch ok\n";

// (b) enabled + lock free: runs the step, then RELEASES the lock (in that order).
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['1'];
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true, 'done' => false, 'remaining' => 7];
});
assert($ran === true, 'lock free -> step runs');
assert($out['remaining'] === 7, 'step result is returned verbatim');
assert(count($pdo->log) === 2, 'exactly two lock statements: acquire + release');
assert(str_contains($pdo->log[0], 'GET_LOCK'), 'acquire first');
assert(str_contains($pdo->log[1], 'RELEASE_LOCK'), 'release after the step');
echo "guarded-step: run+release ok\n";

// (c) enabled + lock HELD by another connection: returns busy, never runs the step, never releases
//     (we do not hold it, so releasing would free the OTHER run's lock).
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['0'];
$ran = false;
$out = avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p) use (&$ran): array {
    $ran = true;
    return ['ok' => true];
});
assert($out === ['ok' => true, 'busy' => true], 'lock held -> busy envelope');
assert($ran === false, 'lock held -> step never runs');
assert(count($pdo->log) === 1 && str_contains($pdo->log[0], 'GET_LOCK'), 'only the acquire, no release');
echo "guarded-step: busy ok\n";

// (d) the step THROWS: the lock is still released (finally), and the throw propagates.
$pdo = new FakeAutogetPdo();
$pdo->lockResults = ['1'];
$threw = false;
try {
    avesmapsAutogetGuardedStep($pdo, true, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $p): array {
        throw new RuntimeException('boom');
    });
} catch (RuntimeException $e) {
    $threw = true;
}
assert($threw === true, 'the step exception propagates');
assert(count($pdo->log) === 2 && str_contains($pdo->log[1], 'RELEASE_LOCK'), 'lock released even on throw');
echo "guarded-step: release-on-throw ok\n";

echo "autoget-run ok\n";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/autoget-run-test.php`
Expected: FAIL — `require`d file does not exist (`Failed opening required '.../autoget-run.php'`).

- [ ] **Step 3: Write the module**

Create `api/_internal/app/autoget-run.php`:

```php
<?php

declare(strict_types=1);

// The four-mechanism safety core for the "Vorschauen holen" mass runs (Kartensammlung + Abenteuer).
// Endpoint-AGNOSTIC on purpose: it governs HOW OFTEN and HOW LONG work happens, never WHAT is fetched, so
// the exact same wrapper serves both runs. Lives in its own file (like app-setting.php) so neither feature
// has to depend on the other's catalog.
//
// WHY MySQL GET_LOCK HERE, WHEN dump-lock.php DELIBERATELY AVOIDS IT: the dump lock must survive ACROSS
// hundreds of client-driven requests (each a new connection), so a connection-scoped lock is useless there
// and it uses a persisted DB row. This lock wants the OPPOSITE: single-flight PER STEP. A step holds the
// lock only while it runs and drops it at the end (or on crash/disconnect -- connection-scoped is exactly
// the auto-release we want). Two concurrent runs can then never WORK at the same instant: whoever holds the
// lock runs its ~4s step; a second tab/reload/agent hitting a step gets GET_LOCK=0 -> {busy:true} and stops.
// Combined with the time budget, a run can no longer saturate the pool no matter how many tabs/clicks
// (php-pool-hang-incident-2026-07-17).
//
// PURITY CONTRACT (mirrors dump-lock.php): side-effect-free on include -- only const + function defs, no
// top-level code, no DB connect, no headers. The genuinely offline-decidable logic (lock-result reading,
// the wall-clock budget) is pure and unit-tested; the DB touches take a PDO explicitly.

// The ONE shared lock name for BOTH runs -- system-wide only one preview run at a time (the calmest choice,
// spec §2). MySQL user-lock names are instance-wide and capped at 64 chars.
const AVESMAPS_AUTOGET_RUN_LOCK = 'avesmaps_preview_autoget';

// Per-step wall-clock budget: a step works until ~4s elapsed, then returns (done:false, remaining:N). This
// REPLACES a fixed source/entity count -- a worker is never held longer than this, and the client just
// calls more often. NB: this bounds the NUMBER of fetches per step; a single hung fetch is capped
// separately by probe.php's own cURL timeout (~20s), not by this budget.
const AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS = 4.0;

/**
 * PURE: did GET_LOCK(name, 0) grant the lock? Returns 1 (got it), 0 (held by another connection), or NULL
 * (error). Drivers surface 1/0 as int OR string, so normalise to string; anything but '1' is "not mine"
 * (conservative: on a NULL error we do NOT run, rather than risk a second concurrent run).
 */
function avesmapsAutogetLockAcquired(mixed $rawResult): bool
{
    return (string) $rawResult === '1';
}

/**
 * PURE: has the per-step wall-clock budget been reached? `>=` so the exact-budget moment stops. Injecting
 * $now (rather than reading microtime here) is what makes this unit-testable.
 */
function avesmapsAutogetDeadlineReached(float $startedAt, float $now, float $budgetSeconds): bool
{
    return ($now - $startedAt) >= $budgetSeconds;
}

/**
 * DB: acquire the shared single-flight lock, NON-BLOCKING (timeout 0 -> returns immediately if held). True
 * iff this connection now holds it.
 */
function avesmapsAutogetAcquireRunLock(PDO $pdo, string $lockName): bool
{
    $stmt = $pdo->prepare('SELECT GET_LOCK(:name, 0)');
    $stmt->execute(['name' => $lockName]);
    return avesmapsAutogetLockAcquired($stmt->fetchColumn());
}

/**
 * DB: release the shared lock. Best-effort (called in a finally); a RELEASE_LOCK on a lock we do not hold
 * is a harmless no-op at the DB level. Connection-scoped, so even if this never runs the lock frees when
 * the request's connection closes.
 */
function avesmapsAutogetReleaseRunLock(PDO $pdo, string $lockName): void
{
    $stmt = $pdo->prepare('SELECT RELEASE_LOCK(:name)');
    $stmt->execute(['name' => $lockName]);
}

/**
 * The guarded step: the gate ORDER that makes a run safe, shared by both endpoints.
 *   1. kill-switch OFF   -> {ok:true, stopped:true}   (checked FIRST, before taking any lock)
 *   2. lock held elsewhere -> {ok:true, busy:true}    (never runs the step, never releases a lock it lacks)
 *   3. otherwise: run $doStep($pdo), ALWAYS release the lock in finally (even on throw).
 *
 * $enabled is passed in already-resolved (the endpoint reads its own per-run kill-switch flag) so this
 * wrapper stays feature-agnostic and directly testable with a bool.
 *
 * @param callable(PDO):array $doStep the feature-specific bounded step; returns the response envelope
 * @return array the stopped/busy envelope, or $doStep's own result
 */
function avesmapsAutogetGuardedStep(PDO $pdo, bool $enabled, string $lockName, callable $doStep): array
{
    if (!$enabled) {
        return ['ok' => true, 'stopped' => true];
    }
    if (!avesmapsAutogetAcquireRunLock($pdo, $lockName)) {
        return ['ok' => true, 'busy' => true];
    }
    try {
        return $doStep($pdo);
    } finally {
        avesmapsAutogetReleaseRunLock($pdo, $lockName);
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/autoget-run-test.php`
Expected: PASS — ends with `autoget-run ok`.

- [ ] **Step 5: Lint**

Run: `php -l api/_internal/app/autoget-run.php`
Expected: `No syntax errors detected`.

- [ ] **Step 6: Commit**

```bash
git add api/_internal/app/autoget-run.php api/_internal/app/__tests__/autoget-run-test.php
git commit -m "feat(autoget): shared single-flight lock + step-budget gate core"
```

---

## Task 2: Retrofit the citymap endpoint (`citymap-autoget.php`)

**Files:**
- Modify: `api/_internal/app/citymaps.php` (add the kill-switch reader near the other enabled-flags, ~line 346-373)
- Modify: `api/edit/map/citymap-autoget.php`

**Interfaces:**
- Consumes: `avesmapsAutogetGuardedStep`, `AVESMAPS_AUTOGET_RUN_LOCK`, `AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS`, `avesmapsAutogetDeadlineReached` (Task 1).
- Produces: `avesmapsCitymapAutogetEnabled(PDO $pdo): bool`; and the endpoint now answers `{busy:true}` / `{stopped:true}` on `autoget_step`.

- [ ] **Step 1: Add the citymap kill-switch reader**

In `api/_internal/app/citymaps.php`, immediately after `avesmapsSetCitymapPreviewsEnabled` (around line 373, the end of the previews-enabled pair), add:

```php

// ---- autoget RUN kill switch (the MASS RUN, not the public display) ----------------------------------
// A per-RUN emergency off, distinct from citymap_previews_enabled (which hides already-fetched previews on
// the public frontend): this stops the "Vorschauen holen" MASS RUN mid-flight, tab-across (the browser
// "Stop" only aborts one tab; PHP keeps running after a disconnect). Every autoget_step reads it first and
// bails with {stopped:true}. The owner flips it by SQL (no UI toggle):
//   INSERT INTO app_setting (setting_key, setting_value) VALUES ('citymap_autoget_enabled','0')
//     ON DUPLICATE KEY UPDATE setting_value='0';   -- '1' re-arms.
// Default ENABLED; only a stored '0' stops the run.
const AVESMAPS_CITYMAP_AUTOGET_SETTING = 'citymap_autoget_enabled';

function avesmapsCitymapAutogetEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_CITYMAP_AUTOGET_SETTING, '1') !== '0';
}
```

- [ ] **Step 2: Lint citymaps.php**

Run: `php -l api/_internal/app/citymaps.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Rewrite the endpoint's require block + step path**

In `api/edit/map/citymap-autoget.php`:

(a) After the existing `require_once` for citymaps.php (line 19), add the gate module:

```php
require_once __DIR__ . '/../../_internal/app/autoget-run.php';
```

(b) Replace the header comment block (lines 5-24, from `// The autoget RUN` down to the `const AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES = 25;` line) with an updated version that keeps the constant but re-frames it as an API-batch cap, not a step size:

```php
// The autoget RUN (cap 'edit'). One bounded, GUARDED step per request; the CLIENT drives the repetition
// (js/review/review-citymap-autoget.js). STRATO has no cron, and looping a heavy endpoint here once
// saturated the PHP workers and looked like a DB outage (php-pool-hang-incident-2026-07-17) -- so there is
// deliberately no "do it all" action, and every step now goes through avesmapsAutogetGuardedStep:
//   - a shared single-flight GET_LOCK (a 2nd tab/reload/agent gets {busy:true}, not a 2nd concurrent run),
//   - a ~4s wall-clock budget (a worker is never held ~15s again),
//   - a DB kill-switch ({stopped:true} tab-across),
//   - and NO EnsureTables on the step path (its information_schema probes were pool-hang load).
//
// THE WORK UNIT IS THE SOURCE URL, NOT THE MAP. 365 maps share 133 map_urls -- twelve towns all point at
// "Land des schwarzen Bären" -- so per-map work would fetch the same picture twelve times. One fetch per
// URL, written to every map that names it.
//
// Kept separate from citymap-image.php on purpose: that is a multipart upload endpoint keyed by one map,
// and a resumable batch step is a different contract. The shared part -- what a fetch MEANS -- lives in
// avesmapsCitymapAutogetOne, which both call.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/autoget-run.php';

// Caps the DISTINCT due sources pulled per step so the ONE wiki API call stays <=50 titles. The step no
// longer runs all of these: avesmapsAutogetGuardedStep's ~4s budget usually stops it well before, and the
// leftovers stay due for the next step. (Was "25 per step ~= 15s"; the fixed 15s was the pool-hang risk.)
const AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES = 25;
```

Note: this replaces the old `require __DIR__ . '/../../_internal/auth.php';` and `require_once ... citymaps.php;` lines (18-19) too — do not leave duplicates. After this edit the file has exactly the three requires above.

(c) Move `EnsureTables` out of the shared path and into status/reset only. Replace the block from line 39 (`$pdo = avesmapsCreatePdo(...)`) through the `status` and `reset` handlers so that `avesmapsCitymapsEnsureTables($pdo);` runs INSIDE the `status` and `reset` branches, not before them. Concretely, replace:

```php
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsCitymapsEnsureTables($pdo);

    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));
```

with:

```php
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));
```

Then in the `status` branch, add `avesmapsCitymapsEnsureTables($pdo);` as the FIRST line inside `if ($action === 'status') {`, and likewise as the FIRST line inside `if ($action === 'reset') {`.

(d) Replace the entire `// ---- one step ----` section (from line 79's comment down to the closing `avesmapsJsonResponse(200, [...]);` at line 150, i.e. everything between the `if ($action !== 'autoget_step')` guard and the `} catch`) with a guarded, budgeted step:

```php
    // ---- one guarded step ----
    // No EnsureTables here (see the header): the citymap table exists long since. The step body is wrapped
    // by the shared gate (kill-switch -> single-flight lock -> release), so {stopped:true}/{busy:true} can
    // come back instead of the tally, and the client loop handles both.
    $enabled = avesmapsCitymapAutogetEnabled($pdo);
    $result = avesmapsAutogetGuardedStep($pdo, $enabled, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $pdo) use ($dueWhere): array {
        $startedAt = microtime(true);

        $sources = $pdo->query('SELECT DISTINCT map_url FROM citymap WHERE ' . $dueWhere
            . ' ORDER BY map_url LIMIT ' . AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES)->fetchAll(PDO::FETCH_COLUMN);

        $tally = ['ok' => 0, 'no_image' => 0, 'fetch_failed' => 0, 'not_an_image' => 0, 'skipped_manual' => 0];
        $sourcesDone = 0;

        // ONE api call for all this step's wiki titles -- that is the whole reason the run is cheap.
        $wikiImages = [];
        $titles = [];
        foreach ($sources as $mapUrl) {
            $title = avesmapsCitymapWikiPageTitle((string) $mapUrl);
            if ($title !== '' && !in_array($title, $titles, true)) {
                $titles[] = $title;
            }
        }
        if ($titles !== []) {
            $api = avesmapsLinkCheckFetchBody(avesmapsCitymapWikiApiUrl($titles), AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'application/json');
            if ($api['ok']) {
                $wikiImages = avesmapsCitymapPickWikiImages($api['body']);
            }
        }

        $mapsStmt = $pdo->prepare('SELECT public_id, thumb_local_url, thumb_origin FROM citymap
                                    WHERE map_url = :url AND ' . $dueWhere);
        $stateStmt = $pdo->prepare('UPDATE citymap SET thumb_auto_state = :state WHERE public_id = :pid');

        foreach ($sources as $mapUrl) {
            $mapUrl = (string) $mapUrl;
            $mapsStmt->execute(['url' => $mapUrl]);
            $maps = $mapsStmt->fetchAll(PDO::FETCH_ASSOC);
            $title = avesmapsCitymapWikiPageTitle($mapUrl);
            $known = ($title !== '' && isset($wikiImages[$title])) ? $wikiImages[$title] : null;

            foreach ($maps as $map) {
                $publicId = (string) $map['public_id'];
                if (avesmapsCitymapAutogetSkips($map)) {
                    $stateStmt->execute(['state' => 'skipped_manual', 'pid' => $publicId]);
                    $tally['skipped_manual']++;
                    continue;
                }
                $result = avesmapsCitymapAutogetOne($pdo, $publicId, $mapUrl, $known);
                // State written PER MAP, right after its fetch -- never leased in a batch up front.
                $stateStmt->execute(['state' => $result['state'], 'pid' => $publicId]);
                $tally[$result['state']] = ($tally[$result['state']] ?? 0) + 1;
                if ($known === null && $result['state'] === 'ok' && $result['source'] !== '') {
                    $known = $result['source'];
                }
            }
            $sourcesDone++;

            // Time budget REPLACES the old fixed source count: stop after ~4s, leftovers stay due for the
            // next step (they still carry thumb_auto_state IS NULL). Checked per SOURCE (~one fetch each).
            if (avesmapsAutogetDeadlineReached($startedAt, microtime(true), AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS)) {
                break;
            }
        }

        $remaining = (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $dueWhere)->fetchColumn();
        return [
            'ok' => true,
            'done' => $remaining === 0,
            'remaining' => $remaining,
            'sources_done' => $sourcesDone,
            'maps_ok' => $tally['ok'],
            'no_image' => $tally['no_image'],
            'fetch_failed' => $tally['fetch_failed'],
            'not_an_image' => $tally['not_an_image'],
            'skipped' => $tally['skipped_manual'],
        ];
    });
    avesmapsJsonResponse(200, $result);
```

Note the inner `$result` shadows deliberately stay inside the closure; the outer `$result` is the guarded-step envelope. The `$dueWhere`/`$withSource` definitions (lines 45-49) and the `status`/`reset` branches remain above this, unchanged except for the moved `EnsureTables`.

- [ ] **Step 4: Lint the endpoint**

Run: `php -l api/edit/map/citymap-autoget.php`
Expected: `No syntax errors detected`.

- [ ] **Step 5: Regression — existing pure tests stay green**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/citymap-autoget-test.php`
Expected: PASS — ends with `citymap-autoget ok` (this test covers the fetch/route/skip pure functions, which are untouched).

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/citymap-gate-test.php`
Expected: PASS (unchanged gate behaviour).

- [ ] **Step 6: Commit**

```bash
git add api/_internal/app/citymaps.php api/edit/map/citymap-autoget.php
git commit -m "feat(autoget): retrofit citymap run with lock, budget, kill-switch; EnsureTables off step path"
```

---

## Task 3: Citymap client understands `busy`/`stopped` + re-arm the tile

**Files:**
- Modify: `js/review/review-citymap-autoget.js`
- Modify: `html/citymap-editor.html`

**Interfaces:**
- Consumes: the endpoint's new `{busy:true}` / `{stopped:true}` step responses (Task 2).
- Produces: `startCitymapAutoget` now returns `{...totals, busy?:true, stopped?:true}`; the tile is live.

- [ ] **Step 1: Teach the loop the two new outcomes**

In `js/review/review-citymap-autoget.js`, inside `startCitymapAutoget`, replace the loop body's outcome handling. Change the block from `const step = await submitCitymapAutogetAction("autoget_step");` through the `reportCitymapAutogetProgress(...)` call (lines 60-78) to:

```js
			const step = await submitCitymapAutogetAction("autoget_step");

			// Server single-flight lock: another run (other tab / reload / agent) holds it. Stop cleanly and
			// tell the caller -- the tab-local guard alone cannot see a second tab.
			if (step.busy === true) {
				totals.busy = true;
				break;
			}
			// DB kill-switch flipped mid-run: stop cleanly, tab-across emergency off.
			if (step.stopped === true) {
				totals.stopped = true;
				break;
			}

			totals.sources += Number(step.sources_done ?? 0);
			totals.ok += Number(step.maps_ok ?? 0);
			totals.no_image += Number(step.no_image ?? 0);
			totals.fetch_failed += Number(step.fetch_failed ?? 0);
			totals.not_an_image += Number(step.not_an_image ?? 0);
			totals.skipped += Number(step.skipped ?? 0);
			done = step.done === true;

			// A step that found nothing to do IS finished, whatever it claims. Without this a server that
			// keeps answering done=false would spin until the backstop and report an error for a run that
			// actually completed.
			if (!done && Number(step.sources_done ?? 0) === 0) {
				break;
			}

			reportCitymapAutogetProgress(
				`Vorschauen … ${totals.ok} geholt, ${Number(step.remaining ?? 0)} offen`
			);
```

- [ ] **Step 2: Bump the step backstop**

In the same file, change:

```js
const CITYMAP_AUTOGET_MAX_STEPS = 40;
```
to:
```js
// Steps are now ~4s each (was ~15s), so a full run is many more, shorter steps. 133 sources at ~7/step is
// ~20 steps; 200 is far above any real run and far below "forever" (the sources_done===0 break is the real
// terminator).
const CITYMAP_AUTOGET_MAX_STEPS = 200;
```

Also update the stale comment two lines above it (`// 133 sources at 25 per step is ~6 steps; 40 is far above...`) — delete that old sentence so the two comments do not contradict.

- [ ] **Step 3: Node smoke-check the file parses**

Run: `node --check js/review/review-citymap-autoget.js`
Expected: no output (exit 0).

- [ ] **Step 4: Surface busy/stopped in the editor handler**

In `html/citymap-editor.html`, in `handleAutogetClick`, replace the result-reporting block (the `if (!r) { ... } else if (statusEl) { ... }` around lines 1398-1410) with one that names all three "no summary" outcomes:

```js
      if (!r) {
        if (statusEl) statusEl.textContent = "Ein Durchlauf läuft bereits (dieser Tab).";
      } else if (r.busy) {
        if (statusEl) statusEl.textContent = "Ein Durchlauf läuft bereits (anderer Tab oder Server).";
      } else if (r.stopped) {
        if (statusEl) statusEl.textContent = "Durchlauf per Not-Aus gestoppt.";
      } else if (statusEl) {
        // Report EVERY outcome, not just the wins ("kein stilles Abschneiden", owner). Counted in MAPS,
        // because that is what a reader sees -- the sources are only the bracket.
        const parts = [`${r.sources} Quellen · ${r.ok} Karten mit Vorschau`];
        if (r.no_image) parts.push(`${r.no_image} ohne Seitenbild`);
        if (r.fetch_failed) parts.push(`${r.fetch_failed} nicht erreichbar`);
        if (r.not_an_image) parts.push(`${r.not_an_image} kein Bild`);
        if (r.skipped) parts.push(`${r.skipped} übersprungen (eigenes Bild)`);
        statusEl.textContent = parts.join(" · ");
      }
```

- [ ] **Step 5: Re-arm the tile markup**

In `html/citymap-editor.html`, replace the disabled button (lines 425-428) with the armed version:

```html
  <button type="button" class="ce-btn2" id="ceAutogetBtn" title="Holt für alle Karten ohne eigenes Vorschaubild ein Cover (Wiki über die MediaWiki-API, Ulisses über die Produkt-API). Läuft nach einem Klick sicher durch: ein Server-Riegel lässt nur EINEN Lauf gleichzeitig zu, jeder Schritt hält einen Worker nur ~4 s. Eigene Uploads bleiben unangetastet.">
    <span class="t1">Vorschauen holen</span>
    <span class="t2" id="ceAutogetSub">…</span>
  </button>
```

- [ ] **Step 6: Wire the click handler + open-time status**

In `html/citymap-editor.html`, replace the disabled-tile comment block (lines 1461-1463, the `// ceAutogetBtn (Vorschauen holen) is DISABLED for now ...` comment) with the actual wiring:

```js
  document.getElementById("ceAutogetBtn").addEventListener("click", handleAutogetClick);
```

And replace the "No refreshCeAutogetInfo() while the autoget tile is disabled" comment block (lines 1601-1602) with the actual call:

```js
  // Fill the autoget sub-label on open: how many maps are still due (read-only, no lock, no run).
  void refreshCeAutogetInfo();
```

- [ ] **Step 7: Verify the HTML has no obviously broken structure**

Run: `node --check js/review/review-citymap-autoget.js` (already done) and visually confirm the three edits in `html/citymap-editor.html` each changed exactly the intended lines (`git diff html/citymap-editor.html`). Expected: the `disabled` attribute is gone from `ceAutogetBtn`, the click handler is wired, `refreshCeAutogetInfo()` is called on open.

- [ ] **Step 8: Commit**

```bash
git add js/review/review-citymap-autoget.js html/citymap-editor.html
git commit -m "feat(autoget): citymap client handles busy/stopped; re-arm the Vorschauen-holen tile"
```

---

## Task 4: Adventure-cover backend (state column, kill-switch, step core)

**Files:**
- Modify: `api/_internal/app/adventures.php` (add `cover_auto_state` column in `avesmapsAdventuresEnsureTables`; add the kill-switch reader near the other flags ~line 172; add the pure skip predicate)
- Modify: `api/_internal/wiki/adventure-sync.php` (add `avesmapsAdventureCoverAutogetStep`)
- Test: `api/_internal/app/__tests__/adventure-cover-autoget-test.php`

**Interfaces:**
- Consumes: `avesmapsAutogetDeadlineReached`, `AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS` (Task 1); `avesmapsAdventureSaveCoverLocal`, `avesmapsSetAdventureCoverUrl` (existing).
- Produces:
  - `avesmapsAdventureCoverAutogetEnabled(PDO $pdo): bool`; `const AVESMAPS_ADVENTURE_COVER_AUTOGET_SETTING`.
  - `avesmapsAdventureCoverAutogetSkips(array $fieldOrigins): bool` — PURE: skip iff `cover_url` origin is `'manual'` (own upload beats a wiki fetch).
  - `avesmapsAdventureCoverAutogetStep(PDO $pdo, float $budgetSeconds): array` — one bounded step over due adventures; envelope shape `{ok, done, remaining, adventures_done, covers_ok, no_image, fetch_failed, skipped}`.
  - `adventure.cover_auto_state` column (NULL=due | `ok`|`no_image`|`fetch_failed`|`skipped_manual`).

- [ ] **Step 1: Write the failing test (pure predicate)**

Create `api/_internal/app/__tests__/adventure-cover-autoget-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the adventure-cover mass run's PURE part: the skip rule. The step itself (due query, fetch,
 * state write) is DB-bound and proven end-to-end only in the owner's live run (no local MySQL). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-cover-autoget-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../app-setting.php';
require __DIR__ . '/../adventures.php';

// "Own beats wiki" (spec §4, mirrors citymap "own beats auto"): a run NEVER overwrites a manual cover
// upload. The signal is the per-field origin field_origins_json['cover_url'] === 'manual', set by
// avesmapsSetAdventureCoverUrl on an editor upload.
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => 'manual']) === true, 'manual upload -> skip');
// A wiki-fetched cover may be refreshed.
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => 'wiki']) === false);
// No origin recorded yet -> not a manual override -> fetchable (the default is NOT manual here, unlike
// citymap's thumb_origin: an unset cover origin means "never set", so the run may fill it).
assert(avesmapsAdventureCoverAutogetSkips([]) === false);
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => '']) === false);
assert(avesmapsAdventureCoverAutogetSkips(['title' => 'manual']) === false, 'a different field being manual is irrelevant');
echo "adventure-cover skip rule ok\n";

echo "adventure-cover-autoget ok\n";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-cover-autoget-test.php`
Expected: FAIL — `Call to undefined function avesmapsAdventureCoverAutogetSkips()`.

- [ ] **Step 3: Add the `cover_auto_state` column (self-healing)**

In `api/_internal/app/adventures.php`, inside `avesmapsAdventuresEnsureTables`, extend the existing `adventure` self-healing column loop. Change:

```php
    foreach (['link_ulisses' => 'VARCHAR(500)', 'link_fshop' => 'VARCHAR(500)', 'isbn' => 'VARCHAR(20)', 'contained_in' => 'VARCHAR(300)'] as $column => $type) {
```
to:
```php
    // cover_auto_state: the cover mass-run's per-adventure progress marker (NULL=due | ok | no_image |
    // fetch_failed | skipped_manual). Like citymap.thumb_auto_state: EVERY outcome writes a state so the
    // run terminates, and the due-query keys off it (never off an origin field -- that would exclude all).
    foreach (['link_ulisses' => 'VARCHAR(500)', 'link_fshop' => 'VARCHAR(500)', 'isbn' => 'VARCHAR(20)', 'contained_in' => 'VARCHAR(300)', 'cover_auto_state' => 'VARCHAR(20)'] as $column => $type) {
```

(Note: `cover_source` is added separately by `avesmapsEnsureAdventureStagingTables` in adventure-sync.php — leave that as is; it is only ensured on the reconcile/refetch path, which the step will also touch.)

- [ ] **Step 4: Add the kill-switch reader + the pure skip predicate**

In `api/_internal/app/adventures.php`, after `avesmapsSetAdventuresEnabled` (around line 172, end of the feature kill-switch pair), add:

```php

// ---- cover autoget RUN kill switch (the MASS RUN, not the public display) ----------------------------
// A per-RUN emergency off, distinct from adventure_covers_enabled (which hides covers on the public
// frontend): this stops the cover MASS RUN mid-flight, tab-across. Every autoget_step reads it first and
// bails with {stopped:true}. Owner flips it by SQL (no UI toggle):
//   INSERT INTO app_setting (setting_key, setting_value) VALUES ('adventure_cover_autoget_enabled','0')
//     ON DUPLICATE KEY UPDATE setting_value='0';   -- '1' re-arms.
// Default ENABLED; only a stored '0' stops the run.
const AVESMAPS_ADVENTURE_COVER_AUTOGET_SETTING = 'adventure_cover_autoget_enabled';

function avesmapsAdventureCoverAutogetEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_ADVENTURE_COVER_AUTOGET_SETTING, '1') !== '0';
}

// PURE: skip this adventure's cover fetch? Only when the cover is a MANUAL editor upload (own beats wiki,
// spec §4). $fieldOrigins is the decoded field_origins_json map. Unlike citymap's thumb_origin (which
// DEFAULTS to 'manual'), an unset cover origin means "never set" -> fetchable, so we test ONLY for the
// explicit 'manual' value and never invert it into a default-excludes-everything trap.
function avesmapsAdventureCoverAutogetSkips(array $fieldOrigins): bool
{
    return (string) ($fieldOrigins['cover_url'] ?? '') === 'manual';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-cover-autoget-test.php`
Expected: PASS — ends with `adventure-cover-autoget ok`.

- [ ] **Step 6: Lint adventures.php**

Run: `php -l api/_internal/app/adventures.php`
Expected: `No syntax errors detected`.

- [ ] **Step 7: Add the step core in adventure-sync.php**

In `api/_internal/wiki/adventure-sync.php`, at the end of the file (after `avesmapsAdventureReconcileStep` and its helpers), add a new section. It reuses `avesmapsAdventureSaveCoverLocal` (same file) and `avesmapsSetAdventureCoverUrl` (adventures.php), so no new fetch logic:

```php

// ===========================================================================
// 6. Cover mass run (SHARP): pull covers for adventures whose local cover is missing.
// ===========================================================================

/**
 * ONE bounded cover-fetch step. Work unit = an adventure with a wiki_key whose LOCAL cover is still due
 * (cover_auto_state IS NULL). Mirrors citymap-autoget's step: EVERY outcome writes cover_auto_state so the
 * run terminates, the state is written PER adventure right after its fetch (never a batch lease), and the
 * ~4s wall-clock budget stops the step (leftovers stay due). The due-query keys off cover_auto_state, NOT
 * an origin field. Manual uploads are skipped (own beats wiki). Bumps map_revision once if any cover was
 * fetched (covers travel in the map-features payload).
 *
 * Called INSIDE avesmapsAutogetGuardedStep (kill-switch + single-flight lock live there), so this body is
 * only ever reached when the run is enabled and this connection holds the lock.
 *
 * @return array{ok:bool, done:bool, remaining:int, adventures_done:int, covers_ok:int, no_image:int,
 *   fetch_failed:int, skipped:int}
 */
function avesmapsAdventureCoverAutogetStep(PDO $pdo, float $budgetSeconds): array
{
    $startedAt = microtime(true);
    @set_time_limit(30);

    // An adventure is DUE when the run has not touched it yet (cover_auto_state IS NULL) and it has a
    // wiki_key (the only source for a wiki cover). Whether the catalog actually has a cover file, and
    // whether the cover is a manual override, is decided in CODE below -- never in this query (an origin
    // filter here would exclude everything, the trap from citymaps-autoget-vorschauen).
    $dueWhere = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> '' AND cover_auto_state IS NULL";

    $due = $pdo->query(
        'SELECT public_id, wiki_key, field_origins_json FROM adventure WHERE ' . $dueWhere
        . ' ORDER BY id LIMIT 200'
    )->fetchAll(PDO::FETCH_ASSOC);

    $coverFileStmt = $pdo->prepare('SELECT cover_file FROM wiki_adventure_catalog WHERE wiki_key = :wk LIMIT 1');
    $stateStmt = $pdo->prepare('UPDATE adventure SET cover_auto_state = :state WHERE public_id = :pid');
    $sourceStmt = $pdo->prepare('UPDATE adventure SET cover_source = :cs WHERE public_id = :pid');

    $tally = ['ok' => 0, 'no_image' => 0, 'fetch_failed' => 0, 'skipped_manual' => 0];
    $adventuresDone = 0;

    foreach ($due as $row) {
        $publicId = (string) $row['public_id'];
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));

        $origins = [];
        if (!empty($row['field_origins_json'])) {
            $decoded = json_decode((string) $row['field_origins_json'], true);
            if (is_array($decoded)) {
                $origins = $decoded;
            }
        }

        // own beats wiki: never overwrite a manual upload.
        if (avesmapsAdventureCoverAutogetSkips($origins)) {
            $stateStmt->execute(['state' => 'skipped_manual', 'pid' => $publicId]);
            $tally['skipped_manual']++;
            $adventuresDone++;
        } else {
            $coverFileStmt->execute(['wk' => $wikiKey]);
            $coverFile = trim((string) ($coverFileStmt->fetchColumn() ?: ''));

            if ($coverFile === '') {
                // Has a wiki_key but the staging catalog holds no cover file -> nothing to fetch.
                $stateStmt->execute(['state' => 'no_image', 'pid' => $publicId]);
                $tally['no_image']++;
            } else {
                $localUrl = avesmapsAdventureSaveCoverLocal($wikiKey, $coverFile);
                if ($localUrl === '') {
                    $stateStmt->execute(['state' => 'fetch_failed', 'pid' => $publicId]);
                    $tally['fetch_failed']++;
                } else {
                    // Set the cover with origin 'wiki' (field-origin stamped so a manual upload later still
                    // wins) + stamp cover_source so the reconcile treats it as up to date (no re-fetch).
                    avesmapsSetAdventureCoverUrl($pdo, $publicId, $localUrl, 'wiki');
                    $sourceStmt->execute(['cs' => mb_substr($coverFile, 0, 300, 'UTF-8'), 'pid' => $publicId]);
                    $stateStmt->execute(['state' => 'ok', 'pid' => $publicId]);
                    $tally['ok']++;
                }
            }
            $adventuresDone++;
        }

        // Time budget: stop after ~4s; leftovers stay due (cover_auto_state IS NULL) for the next step.
        if (avesmapsAutogetDeadlineReached($startedAt, microtime(true), $budgetSeconds)) {
            break;
        }
    }

    // Covers travel in the map-features payload -> invalidate once if we actually fetched any.
    if ($tally['ok'] > 0) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    $remaining = (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $dueWhere)->fetchColumn();
    return [
        'ok' => true,
        'done' => $remaining === 0,
        'remaining' => $remaining,
        'adventures_done' => $adventuresDone,
        'covers_ok' => $tally['ok'],
        'no_image' => $tally['no_image'],
        'fetch_failed' => $tally['fetch_failed'],
        'skipped' => $tally['skipped_manual'],
    ];
}
```

- [ ] **Step 8: Lint adventure-sync.php**

Run: `php -l api/_internal/wiki/adventure-sync.php`
Expected: `No syntax errors detected`.

Note: `avesmapsAutogetDeadlineReached` and `avesmapsWikiSyncNextMapRevision` are provided by the endpoint's requires (Task 5), not by adventure-sync.php itself — a bare lint only checks syntax, not symbol resolution, so this passes. The functions resolve at runtime through the endpoint's include set (verified in Task 5).

- [ ] **Step 9: Commit**

```bash
git add api/_internal/app/adventures.php api/_internal/wiki/adventure-sync.php api/_internal/app/__tests__/adventure-cover-autoget-test.php
git commit -m "feat(autoget): adventure cover_auto_state, kill-switch, and bounded step core"
```

---

## Task 5: New adventure-cover endpoint (`adventure-cover-autoget.php`)

**Files:**
- Create: `api/edit/map/adventure-cover-autoget.php`

**Interfaces:**
- Consumes: `avesmapsAutogetGuardedStep`, `AVESMAPS_AUTOGET_RUN_LOCK` (Task 1); `avesmapsAdventureCoverAutogetEnabled` (Task 4); `avesmapsAdventureCoverAutogetStep` (Task 4); `avesmapsAdventuresEnsureTables`, `avesmapsEnsureAdventureStagingTables` (existing).
- Produces: the endpoint at `POST /api/edit/map/adventure-cover-autoget.php` with actions `autoget_step`/`status`/`reset`.

- [ ] **Step 1: Create the endpoint**

Create `api/edit/map/adventure-cover-autoget.php` (modelled exactly on `citymap-autoget.php`):

```php
<?php

declare(strict_types=1);

// The adventure-cover autoget RUN (cap 'edit'). One bounded, GUARDED step per request; the CLIENT drives
// the repetition (js/review/review-adventure-cover-autoget.js). Built to the SAME pattern as
// citymap-autoget.php and sharing its safety core (avesmapsAutogetGuardedStep + the ONE lock name): a
// single-flight GET_LOCK, a ~4s budget, a DB kill-switch, and NO EnsureTables on the step path. STRATO has
// no cron; looping a heavy endpoint once saturated the pool (php-pool-hang-incident-2026-07-17).
//
// The work unit is an adventure whose LOCAL cover is missing and that has a wiki cover source. The fetch
// itself is avesmapsAdventureSaveCoverLocal (the same one the reconcile and the single-cover refetch use)
// -- this endpoint only adds the resumable, guarded calling frame.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/adventures.php';                // ensure tables, kill-switch, SetAdventureCoverUrl
require_once __DIR__ . '/../../_internal/app/autoget-run.php';               // the shared gate
require_once __DIR__ . '/../../_internal/wiki/sync.php';                     // avesmapsWikiSyncNextMapRevision (covers travel in the payload)
require_once __DIR__ . '/../../_internal/wiki/adventure-sync.php';           // avesmapsAdventureSaveCoverLocal + avesmapsAdventureCoverAutogetStep + staging ensure

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Vorschauen holen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }
    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));

    // An adventure is due when the run has not touched it (cover_auto_state IS NULL) and it has a wiki_key.
    // The skip rule (manual cover upload) is NOT in this query -- it lives in the step's code, so filtering
    // here on an origin field cannot make the run silently do nothing (citymaps-autoget-vorschauen trap).
    $dueWhere = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> '' AND cover_auto_state IS NULL";
    $withSource = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> ''";

    if ($action === 'status') {
        avesmapsAdventuresEnsureTables($pdo);
        $counts = [];
        $stmt = $pdo->query('SELECT cover_auto_state AS s, COUNT(*) AS c FROM adventure WHERE ' . $withSource . ' GROUP BY cover_auto_state');
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) ($row['s'] ?? '')] = (int) $row['c'];
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'remaining' => (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $dueWhere)->fetchColumn(),
            'total' => (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $withSource)->fetchColumn(),
            'counts' => $counts,
        ]);
    }

    if ($action === 'reset') {
        avesmapsAdventuresEnsureTables($pdo);
        // Clear the state for every adventure that HAS a source, so all are re-checked. Deliberately NOT
        // filtered on origin: a manual upload just becomes skipped_manual again next run (a cheap code
        // check, no fetch), and filtering on origin is exactly the trap that excludes everything.
        $stmt = $pdo->prepare('UPDATE adventure SET cover_auto_state = NULL WHERE ' . $withSource);
        $stmt->execute();
        avesmapsJsonResponse(200, ['ok' => true, 'reset' => $stmt->rowCount()]);
    }

    if ($action !== 'autoget_step') {
        avesmapsErrorResponse(400, 'invalid_request', 'action muss autoget_step, status oder reset sein.');
    }

    // ---- one guarded step ----
    // No EnsureTables here (the adventure table exists long since). The staging table (wiki_adventure_
    // catalog) is read read-only by the step; it too exists after the first "Dump holen". The step body is
    // wrapped by the shared gate, so {stopped:true}/{busy:true} can come back instead of the tally.
    $enabled = avesmapsAdventureCoverAutogetEnabled($pdo);
    $result = avesmapsAutogetGuardedStep($pdo, $enabled, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $pdo): array {
        return avesmapsAdventureCoverAutogetStep($pdo, AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS);
    });
    avesmapsJsonResponse(200, $result);
} catch (Throwable $exception) {
    // No getMessage() to the client (info disclosure, refactoring milestone M1).
    avesmapsErrorResponse(500, 'server_error', 'Der Vorschau-Durchlauf ist fehlgeschlagen.');
}
```

- [ ] **Step 2: Lint the endpoint**

Run: `php -l api/edit/map/adventure-cover-autoget.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Verify symbol resolution across the include set**

The step core (Task 4) references `avesmapsAutogetDeadlineReached` and `avesmapsWikiSyncNextMapRevision`, which this endpoint's requires bring in. Confirm the include set actually defines every function the step calls:

Run:
```bash
php -r "require 'api/edit/map/../../_internal/app/adventures.php'; require 'api/_internal/app/autoget-run.php'; require 'api/_internal/wiki/adventure-sync.php'; var_dump(function_exists('avesmapsAdventureCoverAutogetStep'), function_exists('avesmapsAutogetDeadlineReached'), function_exists('avesmapsAdventureCoverAutogetSkips'), function_exists('avesmapsSetAdventureCoverUrl'));"
```
Expected: four `bool(true)`. (This only loads the pure libs — `sync.php`/`avesmapsWikiSyncNextMapRevision` pull in more of the app and may warn on missing config; that function is verified reachable by adventure-cover.php already using it, so a missing-symbol here would be a require typo to fix.)

If any is `false` or the load fatals on a missing include, fix the require chain before continuing.

- [ ] **Step 4: Commit**

```bash
git add api/edit/map/adventure-cover-autoget.php
git commit -m "feat(autoget): new adventure-cover mass-run endpoint (guarded, resumable)"
```

---

## Task 6: Adventure client loop + re-arm the tile + include

**Files:**
- Create: `js/review/review-adventure-cover-autoget.js`
- Modify: `html/adventure-editor.html`
- Modify: `index.html`

**Interfaces:**
- Consumes: `POST /api/edit/map/adventure-cover-autoget.php` (Task 5).
- Produces: `window.startAdventureCoverAutoget(onProgress)` in the parent document; the `aeAutogetBtn` tile is live.

- [ ] **Step 1: Create the client loop**

Create `js/review/review-adventure-cover-autoget.js` (twin of `review-citymap-autoget.js`):

```js
// The client half of the adventure-cover preview run. Twin of review-citymap-autoget.js: STRATO has no
// cron, the server does ONE bounded, guarded step per request, and the client drives the repetition.
// Looping a heavy endpoint server-side once saturated the PHP workers (php-pool-hang-incident-2026-07-17).
//
// The button lives in the adventure editor DIALOG, which is an iframe -- it calls in via
// window.parent.startAdventureCoverAutoget(onProgress), the same way its "Abenteuer syncen" and "Links
// prüfen" buttons already delegate to the parent. Progress arrives through the callback. NEVER poll: a
// poll only queues behind the running step.

const ADVENTURE_COVER_AUTOGET_URL = "/api/edit/map/adventure-cover-autoget.php";
// Steps are ~4s each; a full run is many short steps. Far above any real run, far below "forever" (the
// adventures_done===0 break is the real terminator).
const ADVENTURE_COVER_AUTOGET_MAX_STEPS = 300;

let isAdventureCoverAutogetRunning = false;
let adventureCoverAutogetProgressSink = null;

function reportAdventureCoverAutogetProgress(text) {
	if (typeof adventureCoverAutogetProgressSink === "function") {
		adventureCoverAutogetProgressSink(text);
	}
}

async function submitAdventureCoverAutogetAction(action) {
	const res = await fetch(ADVENTURE_COVER_AUTOGET_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ action: action }),
	});
	const payload = await res.json().catch(() => null);
	if (!res.ok || !payload || payload.ok !== true) {
		const message = (payload && payload.error && payload.error.message) || ("HTTP " + res.status);
		throw new Error(message);
	}
	return payload;
}

// Runs steps until the server says done. The re-entrancy guard is global on purpose -- two runs at once
// would only fight over PHP workers, and STRATO has punished exactly that. Returns null (does NOT throw)
// when a run is already in flight in THIS tab; returns totals with .busy/.stopped when the SERVER stops it.
async function startAdventureCoverAutoget(onProgress) {
	if (isAdventureCoverAutogetRunning) {
		return null;
	}
	isAdventureCoverAutogetRunning = true;
	adventureCoverAutogetProgressSink = typeof onProgress === "function" ? onProgress : null;

	const totals = { adventures: 0, ok: 0, no_image: 0, fetch_failed: 0, skipped: 0 };
	try {
		reportAdventureCoverAutogetProgress("Cover werden geholt …");
		let steps = 0;
		let done = false;
		while (!done) {
			if (steps >= ADVENTURE_COVER_AUTOGET_MAX_STEPS) {
				throw new Error("Der Durchlauf wurde nach zu vielen Teilschritten angehalten.");
			}
			steps += 1;

			const step = await submitAdventureCoverAutogetAction("autoget_step");

			// Server single-flight lock: another run holds it (other tab/reload/agent, maps OR adventures --
			// it is ONE shared lock). Stop cleanly and tell the caller.
			if (step.busy === true) {
				totals.busy = true;
				break;
			}
			// DB kill-switch flipped mid-run: stop cleanly.
			if (step.stopped === true) {
				totals.stopped = true;
				break;
			}

			totals.adventures += Number(step.adventures_done ?? 0);
			totals.ok += Number(step.covers_ok ?? 0);
			totals.no_image += Number(step.no_image ?? 0);
			totals.fetch_failed += Number(step.fetch_failed ?? 0);
			totals.skipped += Number(step.skipped ?? 0);
			done = step.done === true;

			// A step that found nothing to do IS finished, whatever it claims.
			if (!done && Number(step.adventures_done ?? 0) === 0) {
				break;
			}

			reportAdventureCoverAutogetProgress(
				`Cover … ${totals.ok} geholt, ${Number(step.remaining ?? 0)} offen`
			);
		}
		return totals;
	} finally {
		isAdventureCoverAutogetRunning = false;
		adventureCoverAutogetProgressSink = null;
	}
}

window.startAdventureCoverAutoget = startAdventureCoverAutoget;
```

- [ ] **Step 2: Node smoke-check the file parses**

Run: `node --check js/review/review-adventure-cover-autoget.js`
Expected: no output (exit 0).

- [ ] **Step 3: Include it in the parent document**

In `index.html`, immediately after the `review-citymap-autoget.js` include (line 1505), add:

```html
		<script src="js/review/review-adventure-cover-autoget.js"></script>
```

- [ ] **Step 4: Re-arm the tile markup + add a sub-label**

In `html/adventure-editor.html`, replace the disabled button (lines 328-331) with the armed version (note the NEW `id="aeAutogetSub"` on the sub-label, which the handler needs):

```html
    <button type="button" class="ae-btn2" id="aeAutogetBtn" title="Holt die Wiki-Cover für alle Abenteuer, deren Cover lokal noch fehlt. Läuft nach einem Klick sicher durch: ein Server-Riegel lässt nur EINEN Vorschau-Lauf gleichzeitig zu (Karten oder Abenteuer), jeder Schritt hält einen Worker nur ~4 s. Eigene Cover-Uploads bleiben unangetastet. Vorher einmal „Dump holen“ + „Abenteuer syncen“.">
      <span class="t1">Vorschauen holen</span>
      <span class="t2" id="aeAutogetSub">…</span>
    </button>
```

- [ ] **Step 5: Add the handler + busy helper + status refresh**

In `html/adventure-editor.html`, right before the wiring line `document.getElementById("aeSyncBtn").addEventListener("click", handleAeSyncClick);` (line 1348), add the handler set (modelled on `handleAeLinkCheckClick` + citymap's `handleAutogetClick`):

```js
  // ---- Cover autoget (all adventures) ----
  // Delegates to window.parent.startAdventureCoverAutoget -- the loop lives in the parent
  // (js/review/review-adventure-cover-autoget.js) because this editor is an iframe and the run must
  // outlive its own status line, exactly like "Abenteuer syncen" and "Links prüfen".
  let aeAutogetRunning = false;

  function setAeAutogetBusy(isBusy) {
    aeAutogetRunning = isBusy;
    const button = document.getElementById("aeAutogetBtn");
    if (!button) return;
    button.disabled = isBusy;
    const label = button.querySelector(".t1");
    if (label) label.textContent = isBusy ? "Holt …" : "Vorschauen holen";
  }

  // Read-only, no lock, no run -- fills the sub-label with how many covers are still due.
  async function refreshAeAutogetInfo() {
    const el = document.getElementById("aeAutogetSub");
    if (!el) return;
    try {
      const res = await fetch("/api/edit/map/adventure-cover-autoget.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "status" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || payload.ok !== true) throw new Error(`HTTP ${res.status}`);
      el.textContent = payload.remaining > 0
        ? `${payload.remaining} von ${payload.total} offen`
        : `${payload.total} Abenteuer geprüft`;
    } catch (e) {
      el.textContent = "Status unbekannt";
    }
  }

  async function handleAeAutogetClick() {
    if (aeAutogetRunning) return;
    const statusEl = document.getElementById("aeAutogetSub");
    let parentWindow;
    try { parentWindow = window.parent; } catch (e) { parentWindow = null; }
    if (!parentWindow || parentWindow === window || typeof parentWindow.startAdventureCoverAutoget !== "function") {
      if (statusEl) statusEl.textContent = "Nur im eingebetteten Editor verfügbar.";
      return;
    }
    if (!window.confirm("Für alle Abenteuer ohne lokales Cover das Wiki-Cover holen?\n\nEigene Uploads bleiben unangetastet. Der Durchlauf lässt sich fortsetzen und jederzeit stoppen.")) {
      return;
    }
    setAeAutogetBusy(true);
    try {
      const r = await parentWindow.startAdventureCoverAutoget((text) => {
        if (statusEl) statusEl.textContent = text;
      });
      if (!r) {
        if (statusEl) statusEl.textContent = "Ein Durchlauf läuft bereits (dieser Tab).";
      } else if (r.busy) {
        if (statusEl) statusEl.textContent = "Ein Durchlauf läuft bereits (anderer Tab oder Server).";
      } else if (r.stopped) {
        if (statusEl) statusEl.textContent = "Durchlauf per Not-Aus gestoppt.";
      } else if (statusEl) {
        // Report EVERY outcome, not just the wins ("kein stilles Abschneiden", owner).
        const parts = [`${r.adventures} Abenteuer · ${r.ok} Cover geholt`];
        if (r.no_image) parts.push(`${r.no_image} ohne Cover-Quelle`);
        if (r.fetch_failed) parts.push(`${r.fetch_failed} nicht erreichbar`);
        if (r.skipped) parts.push(`${r.skipped} übersprungen (eigenes Cover)`);
        statusEl.textContent = parts.join(" · ");
      }
      await loadList();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Fehlgeschlagen: " + (e && e.message ? e.message : String(e));
    } finally {
      setAeAutogetBusy(false);
    }
  }

```

- [ ] **Step 6: Wire the click handler + open-time status**

In `html/adventure-editor.html`, after the existing wiring line `document.getElementById("aeLinkCheckBtn").addEventListener("click", handleAeLinkCheckClick);` (line 1349), add:

```js
  document.getElementById("aeAutogetBtn").addEventListener("click", handleAeAutogetClick);
```

And after the existing `void refreshAeSyncedInfo();` (line 1352), add:

```js
  void refreshAeAutogetInfo();
```

- [ ] **Step 7: Verify the edits**

Run: `node --check js/review/review-adventure-cover-autoget.js` (already done) and `git diff html/adventure-editor.html index.html`.
Expected: `aeAutogetBtn` no longer has `disabled`; it has an `aeAutogetSub` sub-label; the handler is wired; `refreshAeAutogetInfo()` is called on open; `index.html` includes the new script exactly once.

- [ ] **Step 8: Commit**

```bash
git add js/review/review-adventure-cover-autoget.js html/adventure-editor.html index.html
git commit -m "feat(autoget): adventure cover client loop + re-arm the Vorschauen-holen tile"
```

---

## Verification (whole feature)

- [ ] **All pure/unit tests green:**
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/autoget-run-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-cover-autoget-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/citymap-autoget-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/citymap-gate-test.php
node --check js/review/review-citymap-autoget.js
node --check js/review/review-adventure-cover-autoget.js
```
Expected: each PHP test ends with its `... ok` line; each `node --check` is silent (exit 0).

- [ ] **All touched PHP lints clean:**
```bash
php -l api/_internal/app/autoget-run.php
php -l api/_internal/app/citymaps.php
php -l api/_internal/app/adventures.php
php -l api/_internal/wiki/adventure-sync.php
php -l api/edit/map/citymap-autoget.php
php -l api/edit/map/adventure-cover-autoget.php
```
Expected: `No syntax errors detected` for each.

- [ ] **What is proven locally vs. what needs the owner:** The safety logic (single-flight lock ordering, ~4s budget, kill-switch → stopped) is proven by `autoget-run-test.php` (pure wrappers + Fake-PDO gate ordering). The image fetch itself (citymap wiki/ulisses, adventure covers) and the real GET_LOCK/RELEASE_LOCK round-trip need a real MySQL and are **owner-live only** (no local DB) — see the owner handoff below.

- [ ] **Owner live run (🔧 DU):** after the deploy: (1) `?edit=1` → WikiSync → „Dump holen“ + „Abenteuer syncen“ (so the staging catalog holds cover files); (2) Kartensammlung editieren → „Vorschauen holen“ → watch it run to completion; (3) Abenteuereditor → „Vorschauen holen“ → same. Emergency off (either run), via phpMyAdmin:
```sql
INSERT INTO app_setting (setting_key, setting_value) VALUES ('citymap_autoget_enabled','0')
  ON DUPLICATE KEY UPDATE setting_value='0';           -- stop the map run  ('1' re-arms)
INSERT INTO app_setting (setting_key, setting_value) VALUES ('adventure_cover_autoget_enabled','0')
  ON DUPLICATE KEY UPDATE setting_value='0';           -- stop the cover run ('1' re-arms)
```

- [ ] **Do NOT push to master** — the master push triggers the live deploy; leave it to the owner (autocommit locally is fine; the deploy is the owner's call).

---

## Self-Review (checked against the spec)

**Spec coverage:**
- §2.1 shared single-flight lock → Task 1 (`AVESMAPS_AUTOGET_RUN_LOCK`, `avesmapsAutogetGuardedStep`), used by Task 2 + Task 5. ONE shared name. ✅
- §2.2 ~4s budget replacing the fixed count → Task 1 (`avesmapsAutogetDeadlineReached`) + Task 2 (citymap loop) + Task 4 (adventure step). ✅
- §2.3 EnsureTables off the step path → Task 2 (moved into status/reset only) + Task 5 (never called on autoget_step). ✅
- §2.4 DB kill-switch, per run → Task 2 (`citymap_autoget_enabled`) + Task 4 (`adventure_cover_autoget_enabled`), both read first in the guarded step. ✅
- §3 citymap retrofit (endpoint + kill-switch reader; `avesmapsCitymapAutogetOne` untouched; client understands busy/stopped; MAX_STEPS raised) → Tasks 2, 3. ✅
- §4 adventure run NEW (endpoint, `cover_auto_state`, due-query not filtered on origin, state per adventure, reuses `avesmapsAdventureSaveCoverLocal`, own>wiki, client twin) → Tasks 4, 5, 6. ✅
- §5 both tiles re-armed (undisable, wire, busy/stopped in sub-label; no ASSET_VERSION bump) → Tasks 3, 6. ✅
- §6 non-goals respected: no cron/SSH/chain; image fetch unchanged; session lock untouched. ✅
- §7 verification: safety logic locally provable (Fake-PDO), image fetch is owner-live. ✅
- §8 every named anchor file is touched in a task. ✅

**Placeholder scan:** every code step contains the actual code; every command has an expected output. No TBD/TODO. ✅

**Type consistency:** citymap step envelope keys (`sources_done`, `maps_ok`, `no_image`, `fetch_failed`, `not_an_image`, `skipped`, `done`, `remaining`) match what `review-citymap-autoget.js` reads. Adventure envelope keys (`adventures_done`, `covers_ok`, `no_image`, `fetch_failed`, `skipped`, `done`, `remaining`) match what `review-adventure-cover-autoget.js` reads. `avesmapsAutogetGuardedStep(PDO, bool, string, callable)` is called with that exact signature in both endpoints. `avesmapsAdventureCoverAutogetSkips(array)` takes the decoded origins map in both the test and the step. ✅

**Deliberate design decisions (made transparent to the owner, not re-negotiated):**
1. **GET_LOCK is correct here even though `dump-lock.php` rejected it** — different lock lifetime (per-step single-flight vs. across-request run reservation). Documented in `autoget-run.php`'s header.
2. **The kill-switch is a NEW dedicated per-run flag** (`citymap_autoget_enabled` / `adventure_cover_autoget_enabled`), separate from the display flags (`citymap_previews_enabled` / `adventure_covers_enabled`) — "stop the run" ≠ "hide previews" (incident memory: "kill-switch for the RUN, not just the display"). Per-run (not one shared flag) because §2.1 makes the LOCK explicitly shared and §2.4 does not, giving the owner a precise stop for either run. No UI toggle (YAGNI); the owner flips it by SQL (documented in the handoff + the code comment).
```
