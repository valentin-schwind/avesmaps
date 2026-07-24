# Dump report in the conflict centre — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The result of a ten-minute "Dump holen" run is stored once at the end and stays findable as its own read-only category at the top of the conflict centre.

**Architecture:** The client already receives per-step totals while driving the run; at the end it POSTs them once to `dump.php {action:"save_report"}`. The server classifies "notable", stores one row per run in `wiki_dump_report` (newest 5 kept), and `conflicts.php` returns the newest row as a separate top-level `dump_report` key — NOT as a conflict, so severity/status counters stay untouched.

**Tech Stack:** PHP 8 strict types + PDO (no framework), vanilla JS (no build step), inline `CREATE TABLE IF NOT EXISTS` schema pattern.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-dump-bericht-konflikte-design.md`.
- **Shared working tree:** never `git add -A` / `git add .` / `git commit -a`. Stage by explicit path only.
- Code comments, commit messages, docs in **English**; user-facing UI strings stay **German**.
- **Never write a `?v=` by hand.** `review-wiki-sync.js` hangs off `index.html` and is stamped by the deploy. `ASSET_VERSION` governs only the dynamically loaded editor assets and is NOT touched.
- Do not edit `html/editor-handbuch.html` (owned by the nightly routine). Only the commit subject must name the visible effect.
- `report_json` holds **scalars only** — never record lists (the `wiki_sync_runs.stats_json` 99-MiB lesson).
- Retention constant `AVESMAPS_DUMP_REPORT_KEEP = 5`; drop thresholds `AVESMAPS_DUMP_REPORT_DROP_RATIO = 0.10`, `AVESMAPS_DUMP_REPORT_DROP_MIN = 50`.
- Test command (assertions MUST be on, else asserts are silent no-ops):
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>`
- No local DB and no local dump: DB-bound behaviour and the real run are **not** locally verifiable and must not be claimed as verified.

---

### Task 1: Pure core — classify, delta, prune selection

**Files:**
- Create: `api/_internal/wiki/dump-report.php`
- Test: `api/_internal/wiki/__tests__/dump-report-test.php`

**Interfaces:**
- Produces:
  - `avesmapsDumpReportClassify(array $report, ?array $previous): array` → `['notable'=>bool,'reason'=>string]`
  - `avesmapsDumpReportDelta(array $report, ?array $previous): array` → `kind => ['now'=>int,'was'=>?int,'diff'=>?int]`
  - `avesmapsDumpReportPruneIds(array $idsNewestFirst): array` → ids to delete
  - `avesmapsDumpReportNormalize(array $raw): array` → the stored snapshot, scalars only

- [ ] **Step 1: Write the failing test** (`api/_internal/wiki/__tests__/dump-report-test.php`)

Guard + cases: classify fires on red selftest, on a step without `ok`, and on a collapse only when BOTH thresholds are exceeded; delta handles first-ever run and kinds present on one side only; prune keeps exactly the newest 5; normalize strips non-scalar payloads.

- [ ] **Step 2: Run it, expect FAIL** (`require` of a missing file / undefined function)

- [ ] **Step 3: Implement the four pure functions** in `dump-report.php` (no PDO in this half of the file)

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** `api/_internal/wiki/dump-report.php` + its test

---

### Task 2: Storage — schema, write, read

**Files:**
- Modify: `api/_internal/wiki/dump-report.php` (append the DB half)

**Interfaces:**
- Consumes: Task 1's pure functions.
- Produces:
  - `avesmapsEnsureDumpReportTable(PDO $pdo): void`
  - `avesmapsDumpReportStore(PDO $pdo, int $runId, array $raw): array`
  - `avesmapsDumpReportLatest(PDO $pdo): ?array`
  - `avesmapsDumpReportPrune(PDO $pdo): int`

Schema per spec §4.1: `id`, `run_id` UNIQUE, `created_at`, `duration_s`, `notable`, `notable_reason`, `report_json`.

`Store` = normalize → load previous → classify → upsert on `run_id` → prune. Idempotent for a repeated save of the same run.

- [ ] **Step 1:** Write schema + the three DB functions, following the inline `CREATE TABLE IF NOT EXISTS` pattern used by `dump-hybrid-state.php`.
- [ ] **Step 2:** `php -l` clean.
- [ ] **Step 3:** Re-run Task 1's tests (must stay green — the DB half must not break the pure half).
- [ ] **Step 4: Commit**

---

### Task 3: Endpoint — `save_report` action

**Files:**
- Modify: `api/edit/wiki/dump.php` (new `case 'save_report':` in the action switch, alongside `cleanup_state`)

Capability-gated exactly like the neighbouring actions. Reads `run_id` (public id → internal id via the same resolver the other actions use) and `report`. Responds `{ok:true, notable, reason}`.

- [ ] **Step 1:** Add the case, mirroring the surrounding actions' auth/lock/response shape.
- [ ] **Step 2:** `php -l` clean.
- [ ] **Step 3: Commit**

---

### Task 4: Conflict centre — separate `dump_report` key

**Files:**
- Modify: `api/edit/map/conflicts.php` (response assembly, near `'rules' => …`)

Add `'dump_report' => avesmapsDumpReportLatest($pdo)` (or `null`). **Not** appended to `conflicts`, so `summary.total` / `by_severity` / `by_status` stay exactly as before.

- [ ] **Step 1:** Add the key + the lazy `require_once` of `dump-report.php`.
- [ ] **Step 2:** `php -l` clean.
- [ ] **Step 3: Commit**

---

### Task 5: Client — collect, save, render

**Files:**
- Modify: `js/review/review-wiki-sync.js`

Three changes:
1. `startWikiSyncDumpRead` collects per-step totals into one object during its existing 4 steps (it already holds them for the toast).
2. After step 4, one `submitWikiSyncDumpAction("save_report", {run_id, report})`, wrapped so a save failure never turns a successful run into a failed one — the overlay still shows the numbers and says storing failed.
3. The Dump-Report overlay gets a **"Lauf"** section above "Selbsttests" (existing design tokens, `textContent`/safe DOM as the rest of the overlay does), and can be opened from a stored report.

- [ ] **Step 1:** Implement the three changes.
- [ ] **Step 2:** `node --check js/review/review-wiki-sync.js`
- [ ] **Step 3: Commit**

---

### Task 6: Conflicts UI — the pinned category

**Files:**
- Modify: the conflict-centre renderer (locate the "Konflikte" list renderer that consumes `conflicts.php`)

Renders a pinned row above the list: label **"Letzter Dump-Lauf"**, quiet/grey when `notable` is false, marked when true (with `notable_reason`). Click opens the existing Dump-Report overlay populated from `dump_report`. Renders "kein Bericht vorhanden" when the key is `null`.

- [ ] **Step 1:** Locate the renderer, add the pinned row.
- [ ] **Step 2:** `node --check` on the touched file.
- [ ] **Step 3: Commit + push**

---

## Verification

- All wiki unit tests green with the assertion flags (Task 1's file plus the existing suite as a regression check).
- `php -l` on every touched PHP file; `node --check` on every touched JS file.
- **Not verifiable locally, must be stated as such:** the schema creation, the save round-trip, the conflict-centre rendering, and the real run. Owner action: one "Dump holen".
