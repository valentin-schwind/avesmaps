# Verlauf-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each staging refresh, wiki `verlauf` (course) changes of assigned ways surface as per-way review cases that can be applied case-by-case (diff-based, hash-guarded), with defer/archive persistence and a German review UI.

**Architecture:** A new dependency-light lib `api/_internal/wiki/path-verlauf.php` holds course-hash helpers, the audit-log backfill, the diff engine (stations → hop routing via the INTERNAL routing engine → target-vs-current segment diff → flags), case-status side-table and apply logic. `api/edit/wiki/paths.php` gains new GET/POST actions routing into it. The existing assign primitives (`avesmapsWikiPathAssignTo`/`ClearAssign` with `single_segment:true`) do all writes, extended with a provenance `wiki_path.source` field. Frontend: a new "Verlauf-Fälle" view inside the existing Wege tab of the WikiSync panel.

**Tech Stack:** PHP 8 strict types + PDO/MySQL (STRATO shared hosting — time-boxed, paginated), vanilla JS (no build step), plain-PHP CLI tests under `tools/paths/`.

**Spec:** `docs/refactoring-verlauf-sync.md` (commit 9b6b5947). Base commit: 9b6b5947.

## Global Constraints

Copied from the spec (§3 Invarianten — FINAL owner decisions, do not "fix"; §6 Fallen):

1. Verlauf-listed places belong to the way INCLUDING their approach — even dead ends. The in-and-back-over-the-same-edge (backtrack) pattern is NOT an error signal for existing data; it is only an info flag in new diffs.
2. Owner-curated segments are NEVER removed automatically by the sync (only reported as `course_conflict`). Owner-curated = `wiki_path.source` missing or ≠ `'verlauf-sync'`.
3. Shared corridors: a segment belongs to exactly ONE wiki way. Existing foreign assignments stay; the sync leaves gaps.
4. Transport separation: roads only land network, rivers (`kind='fluss'`) only river network, Querfeldein/synthetic ALWAYS excluded. Detour guard: discard hops with >15 segments.
5. Never touch routing-graph identity (`public_id`, geometry, `feature_subtype`); `show_label` stays untouched.
6. Small verified commits directly on `master`; subagents NEVER push (controller pushes).
7. `route.segments[].path_id` is the INTERNAL graph id — always use `public_id`.
8. Sync applies ALWAYS use `single_segment:true` (both assign_to and clear_assign semantics).
9. Multiple ways in ONE run: dedupe target sets before writing (shared corridor would otherwise be overstamped by the second batch).
10. `wiki_key` values are ALWAYS taken from staging rows — never self-slugified (iconv swallows umlauts).
11. UI strings German; code comments / commit messages / API error `message` English; `error.code` machine values English.
12. API envelope: `{ok:true,...}` / `{ok:false,error:{code,message}}` via `avesmapsJsonResponse`/`avesmapsErrorResponse` (the endpoint already does this).
13. STRATO: every new server action must be time-boxed/paginated (pattern: `crawl_step`). Never process the full staging table in one request.
14. Tests: plain PHP scripts under `tools/paths/` (check/ok/FAIL pattern of `tools/paths/test-path-wiki-naming.php`), run via `php tools/paths/<file>.php` (exit code 0 = pass).
15. Windows/CRLF: repo is LF (`text=auto`). Do not convert line endings.

**Key existing anchors (verified):**

- `api/edit/wiki/paths.php` — authed endpoint, cap `review`, `$config = avesmapsLoadApiConfig(__DIR__)` at line 17, POST `match`-dispatch at lines 36-72, write-action cache invalidation list at line 75, GET dispatch at lines 92-106.
- `api/_internal/wiki/paths.php` — `avesmapsWikiPathBuildAssignObject(array $stagingRow): array` (line 732), `avesmapsWikiPathAssign(PDO,$wikiKey,$dryRun,$userId=0)` (line 777), `avesmapsWikiPathAssignTo(PDO,$wikiKey,$publicId,$dryRun,$userId=0,$singleSegment=false)` (line 841), `avesmapsWikiPathAssignAll(PDO,$continentFilter,$dryRun)` (line 935), `avesmapsWikiPathClearAssign(PDO,$publicId,$dryRun,$userId=0,$singleSegment=false)` (line 992), `avesmapsWikiPathRowMatchesWay` (line 756). Staging table `wiki_path_staging` (verlauf VARCHAR(1000) = station names joined with `' → '`).
- `api/_internal/wiki/path-naming.php` — `avesmapsWikiPathCanonicalName`, `avesmapsWikiPathNextGenericName` (dependency-free).
- `api/_internal/wiki/locations-helpers.php` — `avesmapsWikiSyncFetchAuditRow(PDO,int $featureId): array` (line 173), `avesmapsWikiSyncAuditFeaturePropsChange(PDO, array $beforeRow, array $newProps, int $revision, int $userId, ?string $newName = null): void` (line 183; action literal `'wiki_sync_update_point'`; after_json = `{public_id, feature_type, name, feature_subtype, properties_json:<new props>, revision}`), `avesmapsWikiSyncNextMapRevision(PDO)`.
- `map_audit_log` (sql/schema.sql:106): `id, feature_id, action, actor_user_id, before_json, after_json, created_at, undone_at, undone_by, undo_audit_id`.
- Routing (internal, NEVER via HTTP): `avesmapsLoadRouteMapData($config)` (`api/_internal/routing/map-data.php:5`, full active map_features load — expensive, build ONCE per request) → `avesmapsBuildRouteNetworkData($mapData)` (`network-data.php:5`) → `avesmapsBuildClientCompatibleRouteGraph($networkData, $request)` (`client-graph.php:24`, NAME-keyed adjacency) → per hop `avesmapsFindClientCompatibleRoute($graph, $fromName, $toName, $request)` (`client-graph.php:363`) → `avesmapsBuildClientRouteDiagnosticSegments($result['segments'])` (`client-graph.php:430`; items carry `public_id`, `synthetic` (bool), `subtype`, `from_node`, `to_node`; synthetic edges have `public_id === ''`). Request shape via `avesmapsNormalizeRouteRequest($raw)` (`request.php:28`); `enabled_transports: {land,river,sea}` booleans — land:true also enables synthetic Querfeldein bridging (`client-graph.php:161`), so synthetic exclusion is done by POST-FILTERING hop results (any synthetic segment ⇒ hop unroutable). Nodes are matched by location NAME (case-insensitive).
- Side-table pattern: `political_capital_case_status` (`api/_internal/political/territory.php:134`), write `avesmapsPoliticalUpdateCapitalCaseStatus` (`territories-write.php:114`: status `'open'` ⇒ DELETE row; `'deferred'`/`'archived'` ⇒ UPSERT), read merge in `avesmapsPoliticalListCapitalCases` (`territories-read.php:183`: open set computed live, persisted statuses merged over it; resolved cases drop out of the compute).
- Frontend: `js/review/review-path-sync.js` — `pathSyncGet(query)`/`pathSyncPost(body)` (lines 5-89), `loadPathWikiSync()` (line 91), `renderPathSyncList()` (line 131; renders view tabs into `#path-sync-tabs` and rows into `#path-sync-list`), module state `pathSyncView` (`all|assigned|missing`), delegated click listeners at lines 385-411. Two-step apply pattern: dry-run POST → `window.confirm` → POST with `{dry_run:false, confirm:"apply"}`. Tab activation via `setWikiSyncPanelTab('paths')` in `js/review/review-wiki-sync.js:197-222` → `loadPathWikiSync()`. DOM containers in `index.html:348-362` (`#path-sync-summary`, `#path-sync-tabs`, `#path-sync-list`).

**File structure (locked in):**

- Create `api/_internal/wiki/path-verlauf.php` — ALL new verlauf-sync server logic (hash, stations, backfill, diff engine, case list, case status, apply). The spec says "Funktion in api/_internal/wiki/paths.php"; controller decision: sibling module instead (paths.php is already 1066 lines; precedent: `path-naming.php`). The endpoint routing is unchanged in spirit.
- Modify `api/_internal/wiki/paths.php` — `$assignMeta` plumbing only (Task 1) + `single_segment` fast path (Task 5).
- Modify `api/edit/wiki/paths.php` — new action arms + `require_once` of the new lib.
- Modify `js/review/review-path-sync.js` — new "Verlauf-Fälle" view (Task 6).
- Create `tools/paths/test-path-verlauf-source.php`, `tools/paths/test-path-verlauf-engine.php` — CLI tests.

---

### Task 1: Provenance plumbing — `wiki_path.source`, `course_hash`, `course_hops`

**Files:**
- Modify: `api/_internal/wiki/paths.php` (functions at lines 732, 777, 841, 935)
- Modify: `api/edit/wiki/paths.php` (POST dispatch, lines 36-72)
- Create: `tools/paths/test-path-verlauf-source.php`

**Interfaces:**
- Produces: `avesmapsWikiPathBuildAssignObject(array $stagingRow, array $assignMeta = []): array` — new optional `$assignMeta` with keys `source` (string, whitelist `editor|verlauf-sync`, default `editor`, ALWAYS emitted into the object), `course_hash` (string, emitted only when non-empty), `course_hops` (array of strings, emitted only when non-empty).
- Produces: `avesmapsWikiPathAssign(PDO $pdo, string $wikiKey, bool $dryRun, int $userId = 0, array $assignMeta = []): array`, `avesmapsWikiPathAssignTo(PDO $pdo, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, array $assignMeta = []): array`, `avesmapsWikiPathAssignAll(PDO $pdo, string $continentFilter, bool $dryRun, array $assignMeta = []): array` — each forwards `$assignMeta` into `avesmapsWikiPathBuildAssignObject`.
- Produces: endpoint payload key `source` on `assign`/`assign_to`/`assign_all` (optional; whitelist; invalid non-empty value ⇒ 400 `invalid_source`). `course_hash`/`course_hops` are NOT accepted over HTTP — only server-side callers (Task 5) pass them.
- Semantics later tasks rely on: an editor (re-)assign of a segment REPLACES the whole `wiki_path` object, i.e. resets `source` to `editor` and drops `course_hash`/`course_hops` — the segment becomes owner-curated. This is intended (owner touched it).

**Steps:**

- [ ] **Step 1: Write the failing test** — `tools/paths/test-path-verlauf-source.php`, modeled on `tools/paths/test-path-wiki-grouping.php` (same `check()` pattern and requires: `require __DIR__ . '/../../api/_internal/wiki/sync.php'; require __DIR__ . '/../../api/_internal/wiki/paths.php';`, run via `php -d extension=mbstring tools/paths/test-path-verlauf-source.php` — document that invocation in the file docblock like the grouping test does). Test cases (use a `check(string $label, $actual, $expected)` comparing with `!==` like `test-path-wiki-naming.php`):

```php
$row = ['wiki_key' => 'reichsstrasse-1', 'name' => 'Reichsstraße 1', 'kind' => 'strasse', 'verlauf' => 'A → B', 'wiki_url' => 'https://x/wiki/Reichsstra%C3%9Fe_1'];

// default source
$o = avesmapsWikiPathBuildAssignObject($row);
check('default source is editor', $o['source'] ?? null, 'editor');
check('no course_hash by default', array_key_exists('course_hash', $o), false);
check('no course_hops by default', array_key_exists('course_hops', $o), false);

// whitelist
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'verlauf-sync']);
check('verlauf-sync source kept', $o['source'], 'verlauf-sync');
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'evil']);
check('unknown source falls back to editor', $o['source'], 'editor');

// meta emission
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'verlauf-sync', 'course_hash' => sha1('A → B'), 'course_hops' => ['A → B']]);
check('course_hash emitted', $o['course_hash'], sha1('A → B'));
check('course_hops emitted', $o['course_hops'], ['A → B']);
$o = avesmapsWikiPathBuildAssignObject($row, ['course_hash' => '', 'course_hops' => []]);
check('empty meta omitted', array_key_exists('course_hash', $o) || array_key_exists('course_hops', $o), false);

// existing fields unchanged
check('wiki_key passthrough', $o['wiki_key'], 'reichsstrasse-1');
```

- [ ] **Step 2: Run to verify failure** — `php -d extension=mbstring tools/paths/test-path-verlauf-source.php` → FAIL (source key absent / signature mismatch).

- [ ] **Step 3: Implement** — in `api/_internal/wiki/paths.php`:
  - `avesmapsWikiPathBuildAssignObject(array $stagingRow, array $assignMeta = []): array`: after building the existing array, append:

```php
$source = (string) ($assignMeta['source'] ?? 'editor');
$object['source'] = in_array($source, ['editor', 'verlauf-sync'], true) ? $source : 'editor';
$courseHash = trim((string) ($assignMeta['course_hash'] ?? ''));
if ($courseHash !== '') {
    $object['course_hash'] = $courseHash;
}
$courseHops = $assignMeta['course_hops'] ?? [];
if (is_array($courseHops) && $courseHops !== []) {
    $object['course_hops'] = array_values(array_map('strval', $courseHops));
}
```

  - Add trailing `array $assignMeta = []` param to `avesmapsWikiPathAssign`, `avesmapsWikiPathAssignTo`, `avesmapsWikiPathAssignAll`; forward it to their `avesmapsWikiPathBuildAssignObject` call (lines 793, 877, 950).
  - In `api/edit/wiki/paths.php`: before the POST `match`, read `$assignSource = trim((string) ($payload['source'] ?? ''));` — if `$assignSource !== ''` and not in `['editor','verlauf-sync']`, respond `avesmapsErrorResponse(400, 'invalid_source', 'Unknown assign source.');`. Build `$assignMeta = $assignSource === '' ? [] : ['source' => $assignSource];` and pass as the new last arg of the three assign actions.

- [ ] **Step 4: Run tests** — `php -d extension=mbstring tools/paths/test-path-verlauf-source.php` → all ok, exit 0. Also run the existing suites to catch signature fallout: `php tools/paths/test-path-wiki-naming.php` and `php -d extension=mbstring tools/paths/test-path-wiki-grouping.php` → pass.

- [ ] **Step 5: Lint the touched PHP** — `php -l api/_internal/wiki/paths.php && php -l api/edit/wiki/paths.php` → no syntax errors.

- [ ] **Step 6: Commit** — `git add -A tools/paths/test-path-verlauf-source.php api/_internal/wiki/paths.php api/edit/wiki/paths.php && git commit -m "feat(verlauf-sync): wiki_path provenance source + course meta plumbing (T1)"`

---

### Task 2: Course-hash helpers + audit-log backfill (`backfill_verlauf_source`)

**Files:**
- Create: `api/_internal/wiki/path-verlauf.php`
- Modify: `api/edit/wiki/paths.php` (add `require_once __DIR__ . '/../../_internal/wiki/path-verlauf.php';` after the paths.php require; add POST arm)
- Create: `tools/paths/test-path-verlauf-engine.php` (started here, extended in Task 3)

**Interfaces:**
- Produces: `avesmapsWikiPathCourseHash(string $verlauf): string` — `sha1(trim($verlauf))`, but `''` when the trimmed string is empty.
- Produces: `avesmapsWikiPathVerlaufStations(string $verlauf): array` — splits the staging `verlauf` on `' → '` (U+2192 with surrounding spaces, the storage format written by `avesmapsWikiPathParsePage` line 372), trims, drops empties, de-dupes preserving order.
- Produces: `avesmapsWikiPathVerlaufBackfillSource(PDO $pdo, bool $dryRun, int $userId, array $options = []): array` — options `date` (default `'2026-07-05'`), `after_id` (audit-id cursor, default 0), `limit` (default 400, max 800). Response `{ok, dry_run, scanned, stamped, skipped: {inactive_or_missing, reassigned, editor_source}, next_after_id, complete, sample}`.
- Produces: endpoint POST action `backfill_verlauf_source` (dry-run gated like the other write actions: writes only when `dry_run === false && confirm === 'apply'`).

**Backfill logic (spec T2, recommended variant):**
1. `SELECT id, feature_id, after_json FROM map_audit_log WHERE action = 'wiki_sync_update_point' AND created_at >= :d0 AND created_at < :d1 AND id > :after_id AND JSON_EXTRACT(after_json, '$.properties_json.wiki_path.wiki_key') IS NOT NULL ORDER BY id ASC LIMIT <limit>` with `d0 = date . ' 00:00:00'`, `d1 = date +1 day . ' 00:00:00'` (compute via `DateTimeImmutable`).
2. Decode `after_json`; keep per `feature_id` the LAST (highest id) entry in the batch: `$byFeature[featureId] = ['wiki_key' => ..., 'verlauf' => (string)(after.properties_json.wiki_path.verlauf ?? '')]`.
3. Load the current rows: `SELECT id, public_id, name, properties_json FROM map_features WHERE feature_type = 'path' AND is_active = 1 AND id IN (...)`.
4. Per feature decide (pure helper, see test): skip when row missing/inactive (`inactive_or_missing`), skip when current `wiki_path` absent or `wiki_path.wiki_key !== auditWikiKey` (`reassigned`), skip when current `wiki_path.source === 'editor'` (`editor_source` — explicitly owner-claimed later). Otherwise stamp: `wiki_path.source = 'verlauf-sync'` and, when the audit verlauf is non-empty, `wiki_path.course_hash = avesmapsWikiPathCourseHash($auditVerlauf)` (hash of the verlauf AT ASSIGN TIME — that is the point of the backfill). Re-stamping a row already at `source === 'verlauf-sync'` is allowed (idempotent, later audit entry wins across batches).
5. Writes: one `avesmapsWikiSyncNextMapRevision($pdo)` per request (lazy, only when ≥1 stamp), per row `avesmapsWikiSyncFetchAuditRow` before, `UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id` (NAME UNCHANGED — do not touch the `name` column), then `avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, (string) $auditBefore['name'])`.
6. `next_after_id` = last scanned audit id; `complete` = fewer rows fetched than limit. `sample` = first 10 stamped `{public_id, name, wiki_key}`.

Extract the per-feature decision as a pure function so it is CLI-testable without DB:

```php
// Decides the backfill action for one feature. $currentProps = decoded properties_json
// (or null when the row is missing/inactive). Returns ['action' => 'stamp'|'skip',
// 'reason' => ''|'inactive_or_missing'|'reassigned'|'editor_source', 'props' => array|null].
function avesmapsWikiPathVerlaufBackfillDecision(?array $currentProps, string $auditWikiKey, string $auditVerlauf): array {
    if ($currentProps === null) {
        return ['action' => 'skip', 'reason' => 'inactive_or_missing', 'props' => null];
    }
    $wikiPath = $currentProps['wiki_path'] ?? null;
    if (!is_array($wikiPath) || (string) ($wikiPath['wiki_key'] ?? '') !== $auditWikiKey || $auditWikiKey === '') {
        return ['action' => 'skip', 'reason' => 'reassigned', 'props' => null];
    }
    if ((string) ($wikiPath['source'] ?? '') === 'editor') {
        return ['action' => 'skip', 'reason' => 'editor_source', 'props' => null];
    }
    $wikiPath['source'] = 'verlauf-sync';
    $hash = avesmapsWikiPathCourseHash($auditVerlauf);
    if ($hash !== '') {
        $wikiPath['course_hash'] = $hash;
    }
    $currentProps['wiki_path'] = $wikiPath;
    return ['action' => 'stamp', 'reason' => '', 'props' => $currentProps];
}
```

**Steps:**

- [ ] **Step 1: Failing tests** — start `tools/paths/test-path-verlauf-engine.php` (require `api/_internal/wiki/path-verlauf.php` ONLY — keep the new lib loadable standalone: it must NOT require paths.php/sync.php at top level; the DB functions reference helpers only inside function bodies):

```php
check('hash of empty is empty', avesmapsWikiPathCourseHash('  '), '');
check('hash trims', avesmapsWikiPathCourseHash(' A → B '), sha1('A → B'));
check('stations split', avesmapsWikiPathVerlaufStations('Punin → Ragath → Punin → Kuslik'), ['Punin', 'Ragath', 'Kuslik']);
check('stations empty', avesmapsWikiPathVerlaufStations(''), []);
// backfill decisions
$d = avesmapsWikiPathVerlaufBackfillDecision(null, 'k', 'A → B');
check('missing row skipped', $d['reason'], 'inactive_or_missing');
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'other']], 'k', 'A → B');
check('reassigned skipped', $d['reason'], 'reassigned');
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'editor']], 'k', 'A → B');
check('editor source protected', $d['reason'], 'editor_source');
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k']], 'k', 'A → B');
check('stamp sets source', $d['props']['wiki_path']['source'], 'verlauf-sync');
check('stamp sets hash', $d['props']['wiki_path']['course_hash'], sha1('A → B'));
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync', 'course_hash' => 'old']], 'k', '');
check('empty verlauf keeps old hash', $d['props']['wiki_path']['course_hash'], 'old');
check('restamp allowed', $d['props']['wiki_path']['source'], 'verlauf-sync');
```

- [ ] **Step 2: Run to verify failure** — `php tools/paths/test-path-verlauf-engine.php` → FAIL (file/functions missing).

- [ ] **Step 3: Implement `api/_internal/wiki/path-verlauf.php`** — file header comment (English) naming the spec doc; `declare(strict_types=1)`; NO top-level requires (document that the including endpoint must load `paths.php` + `locations-helpers.php` context first — it already does via `sync.php`/`locations.php`). Implement `avesmapsWikiPathCourseHash`, `avesmapsWikiPathVerlaufStations` (split on `' → '` via `explode`, note the arrow is UTF-8 U+2192), `avesmapsWikiPathVerlaufBackfillDecision` (code above), and `avesmapsWikiPathVerlaufBackfillSource` per the numbered logic. Use `avesmapsWikiSyncDecodeJson`/`avesmapsWikiSyncEncodeJson` for JSON round-trips.

- [ ] **Step 4: Wire the endpoint** — in `api/edit/wiki/paths.php`: add the `require_once`; add POST arm:

```php
'backfill_verlauf_source' => avesmapsWikiPathVerlaufBackfillSource(
    $pdo,
    !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
    (int) ($user['id'] ?? 0),
    $options
),
```

and add `'backfill_verlauf_source'` to the cache-invalidation action list at line 75.

- [ ] **Step 5: Run tests + lint** — `php tools/paths/test-path-verlauf-engine.php` → ok; `php -l api/_internal/wiki/path-verlauf.php && php -l api/edit/wiki/paths.php`.

- [ ] **Step 6: Commit** — `git commit -m "feat(verlauf-sync): course-hash helpers + audit-log source backfill (T2)"`

---

### Task 3: Diff engine + GET action `verlauf_cases`

**Files:**
- Modify: `api/_internal/wiki/path-verlauf.php`
- Modify: `api/edit/wiki/paths.php` (GET arm; pass `$config`)
- Modify: `tools/paths/test-path-verlauf-engine.php` (extend)

**Interfaces:**
- Consumes: Task 2 helpers; routing internals (anchors above); `avesmapsWikiPathEnsureTables` (staging table).
- Produces: `avesmapsWikiPathVerlaufReadAssignments(PDO $pdo): array` — one scan of active path features; returns `['byWikiKey' => [wiki_key => [publicId => ['public_id','name','subtype','source','course_hash']]], 'byPublicId' => [publicId => ['wiki_key','name','source']]]` (segments without `wiki_path` are absent from both).
- Produces: `avesmapsWikiPathVerlaufComputeCase(array $stagingRow, array $assignments, array $locationLookup, callable $router): ?array` — PURE apart from the injected `$router(string $fromName, string $toName): array` (returns `['found'=>bool,'reason'=>string,'segments'=>[['public_id'=>...,'name'=>...]]]`) and `$locationLookup` (`[mb_strtolower(name) => canonicalName]`). Returns the case array or `null` (unchanged / not computable).
- Produces: `avesmapsWikiPathVerlaufListCases(PDO $pdo, array $config, array $options = []): array` — options `cursor` (staging id), `limit` (default 20, max 50), `step_runtime` (default 15, max 25 seconds). Response `{ok, cases, scanned, next_cursor, complete, runtime_seconds}`.
- Produces: endpoint GET `?action=verlauf_cases&cursor=<id>&limit=<n>`.

**Case object shape (contract for Tasks 4-6):**

```php
[
  'wiki_key' => string, 'name' => string, 'kind' => 'strasse'|'fluss', 'wiki_url' => string,
  'staging_id' => int,
  'type' => 'verlauf_changed'|'station_missing'|'hops_unroutable'|'course_conflict',
  'clean' => bool,           // eligible for bulk apply
  'hash_only' => bool,       // hash changed but segment sets identical (apply only restamps)
  'staging_hash' => string, 'stored_hash' => string,
  'stations' => [string,...],                       // parsed chain
  'flags' => [
     'missing_stations' => [string,...],
     'unroutable_hops' => [['from'=>s,'to'=>s,'reason'=>'no_route'|'synthetic_gap'|'detour']],
     'conflicts' => [['public_id'=>s,'name'=>s,'conflict'=>'foreign'|'owner','other_wiki_key'=>s]],
     'backtrack_hops' => [string,...],               // info only, station names
  ],
  'adds' => [['public_id'=>s,'name'=>s,'hops'=>[string,...]]],
  'removes' => [['public_id'=>s,'name'=>s]],
  'status' => 'open',        // Task 4 merges persisted defer/archive
]
```

**Engine rules (all FINAL, from spec):**
1. Stored hash of a way = most frequent non-empty `course_hash` among its current segments (`''` when none — never-synced way).
2. `staging_hash === stored_hash` and both non-empty ⇒ `null` (unchanged — the only cheap exit; this is the diff-based core).
3. `< 2` parsed stations ⇒ `null` (course not routable by definition; never propose removals from an uncomputable course).
4. Station → location by case-insensitive name via `$locationLookup`; unmatched go to `flags.missing_stations`; the chain keeps only matched stations (spec: "Stationskette = [[Links]] ∩ existierende Karten-Orte").
5. If the matched chain has `< 2` stations ⇒ hint case `station_missing`, `adds/removes = []`.
6. Hops = consecutive matched-station pairs. Per hop call `$router`; unroutable reasons: `no_route` (not found), `synthetic_gap` (any segment `synthetic === true` or `public_id === ''` — Querfeldein is ALWAYS excluded per invariant 4), `detour` (> `AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS = 15` segments).
7. Target set (Soll) = union of routable hops' segment `public_id`s; per segment record the hop labels (`"From → To"`) that justify it → `course_hops`/`adds[].hops`.
8. **Removal safety guard:** when ANY hop is unroutable, `removes` is forced empty (a partial Soll must never trigger removals); adds stay (additive is safe). The case is not clean anyway.
9. Diff vs current (Ist = `byWikiKey[wiki_key]`):
   - adds = Soll − Ist; an add whose segment belongs to ANOTHER wiki way (per `byPublicId`) is NOT added — it goes to `flags.conflicts` with `conflict:'foreign'` (invariant 3: sync leaves gaps).
   - removes = Ist − Soll with `source === 'verlauf-sync'`; owner-curated members of Ist − Soll go to `flags.conflicts` with `conflict:'owner'` (invariant 2: NEVER auto-removed).
10. Backtrack info flag: consecutive hops sharing ≥1 segment id ⇒ push the middle station name to `flags.backtrack_hops` (info ONLY — no effect on clean; invariant 1).
11. Type precedence: conflicts non-empty ⇒ `course_conflict`; else adds/removes non-empty ⇒ `verlauf_changed`; else missing stations ⇒ `station_missing`; else unroutable hops ⇒ `hops_unroutable`; else (hash changed, sets identical, no flags) ⇒ `verlauf_changed` with `hash_only:true`.
12. `clean` = type `verlauf_changed` AND all flags empty AND `stored_hash !== ''` (never-synced ways are ALWAYS manual — the conservative default of spec T2) AND (adds/removes non-empty OR hash_only).
13. Ways with NO current segments and NO staging match on the map: cases are still computed when the staging row has ≥2 matched stations and routable hops produce adds — but to avoid flooding, ways with ZERO current segments are skipped entirely (`null`): the verlauf sync updates ASSIGNED ways; initial assignment stays with the existing panel/pipeline flows.

**Routing context (in `avesmapsWikiPathVerlaufListCases`):** build lazily, at most once per kind per request:

```php
$rawRequest = [
    'from' => 'verlauf-sync', 'to' => 'verlauf-sync',
    'enabled_transports' => $kind === 'fluss'
        ? ['land' => false, 'river' => true, 'sea' => false]
        : ['land' => true, 'river' => false, 'sea' => false],
];
$request = avesmapsNormalizeRouteRequest($rawRequest); // verify in request.php: from/to are only required non-empty strings
$mapData ??= avesmapsLoadRouteMapData($config);        // ONCE per request (expensive full load)
$networkData ??= avesmapsBuildRouteNetworkData($mapData);
$graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
$locationLookup = [];                                   // from $networkData['locations'] names
foreach ($networkData['locations'] as $location) { $locationLookup[mb_strtolower((string) $location['name'], 'UTF-8')] = (string) $location['name']; }
$router = static function (string $from, string $to) use ($graph, $request): array { /* find + diagnostic segments + shape mapping */ };
```

`require_once` the routing files inside the context builder function (not top-level — keeps the lib standalone-loadable): `request.php`, `map-data.php`, `network-data.php`, `client-graph.php` from `__DIR__ . '/../routing/'`.

The list loop: `SELECT * FROM wiki_path_staging WHERE id > :cursor ORDER BY id ASC LIMIT :limit`; per row compute the case (skip rows with `verlauf` empty — count as scanned); time-box via `microtime(true)` against `step_runtime` and `@set_time_limit($stepRuntime + 15)` (pattern `avesmapsWikiPathCrawlStep`, paths.php:197-207); stop early and return `next_cursor` = last processed staging id, `complete` = no rows left AND not stopped early.

**Steps:**

- [ ] **Step 1: Failing tests** — extend `tools/paths/test-path-verlauf-engine.php`. Build a fake `$router` closure over a fixture map and drive `avesmapsWikiPathVerlaufComputeCase` through the rules (no DB, no routing lib):

```php
$lookup = ['punin' => 'Punin', 'ragath' => 'Ragath', 'kuslik' => 'Kuslik'];
$routes = [
    'Punin|Ragath' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'Reichsstraße 12'], ['public_id' => 's2', 'name' => 'Reichsstraße 12']]],
    'Ragath|Kuslik' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's3', 'name' => 'Reichsstraße 12']]],
];
$router = static fn(string $f, string $t): array => $routes[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$staging = ['id' => 7, 'wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'kind' => 'strasse', 'wiki_url' => 'https://x/wiki/R12', 'verlauf' => 'Punin → Ragath → Kuslik'];
$assignments = ['byWikiKey' => ['w1' => ['s1' => ['public_id' => 's1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash'], 's9' => ['public_id' => 's9', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash']]], 'byPublicId' => ['s1' => ['wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync'], 's9' => ['wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync']]];

$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments, $lookup, $router);
check('case type changed', $case['type'], 'verlauf_changed');
check('adds are s2,s3', array_column($case['adds'], 'public_id'), ['s2', 's3']);
check('remove s9', array_column($case['removes'], 'public_id'), ['s9']);
check('clean', $case['clean'], true);
check('add hop labels', $case['adds'][0]['hops'], ['Punin → Ragath']);

// unchanged hash => null
$assignments2 = $assignments;
$assignments2['byWikiKey']['w1']['s1']['course_hash'] = avesmapsWikiPathCourseHash($staging['verlauf']);
$assignments2['byWikiKey']['w1']['s9']['course_hash'] = avesmapsWikiPathCourseHash($staging['verlauf']);
check('unchanged is null', avesmapsWikiPathVerlaufComputeCase($staging, $assignments2, $lookup, $router), null);

// owner-curated remove => conflict, type course_conflict, not clean
$assignments3 = $assignments;
$assignments3['byWikiKey']['w1']['s9']['source'] = 'editor';
$assignments3['byPublicId']['s9']['source'] = 'editor';
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments3, $lookup, $router);
check('owner conflict type', $case['type'], 'course_conflict');
check('owner conflict flagged', $case['flags']['conflicts'][0]['conflict'], 'owner');
check('owner segment not in removes', $case['removes'], []);
check('conflict not clean', $case['clean'], false);

// foreign add => conflict + gap
$assignments4 = $assignments;
$assignments4['byPublicId']['s2'] = ['wiki_key' => 'OTHER', 'name' => 'Fremdweg', 'source' => 'editor'];
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments4, $lookup, $router);
check('foreign conflict', $case['flags']['conflicts'][0]['conflict'], 'foreign');
check('foreign not added', in_array('s2', array_column($case['adds'], 'public_id'), true), false);

// missing station => flagged, chain shrinks
$staging5 = $staging; $staging5['verlauf'] = 'Punin → Phantasia → Kuslik';
$routes['Punin|Kuslik'] = ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'x']]];
$router5 = static fn(string $f, string $t): array => $routes[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($staging5, $assignments, $lookup, $router5);
check('missing station flagged', $case['flags']['missing_stations'], ['Phantasia']);
check('missing station not clean', $case['clean'], false);

// unroutable hop => removes suppressed
$staging6 = $staging;
$router6 = static fn(string $f, string $t): array => $f === 'Punin' && $t === 'Ragath' ? $routes['Punin|Ragath'] : ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($staging6, $assignments, $lookup, $router6);
check('unroutable flagged', $case['flags']['unroutable_hops'][0]['reason'], 'no_route');
check('removes suppressed on unroutable', $case['removes'], []);

// never-synced way (no stored hash) => manual (not clean)
$assignments7 = $assignments;
unset($assignments7['byWikiKey']['w1']['s1']['course_hash'], $assignments7['byWikiKey']['w1']['s9']['course_hash']);
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments7, $lookup, $router);
check('never-synced not clean', $case['clean'], false);

// zero current segments => null
$case = avesmapsWikiPathVerlaufComputeCase($staging, ['byWikiKey' => [], 'byPublicId' => []], $lookup, $router);
check('unassigned way skipped', $case, null);

// hash-only: same sets, different hash
$stagingH = $staging; // Soll = s1,s2,s3
$assignH = ['byWikiKey' => ['w1' => ['s1' => ['public_id' => 's1', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old'], 's2' => ['public_id' => 's2', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old'], 's3' => ['public_id' => 's3', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old']]], 'byPublicId' => ['s1' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync'], 's2' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync'], 's3' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync']]];
$case = avesmapsWikiPathVerlaufComputeCase($stagingH, $assignH, $lookup, $router);
check('hash-only detected', $case['hash_only'], true);
check('hash-only clean', $case['clean'], true);
check('hash-only empty diff', [$case['adds'], $case['removes']], [[], []]);
```

- [ ] **Step 2: Run to verify failure** — `php tools/paths/test-path-verlauf-engine.php` → FAIL on the new checks.

- [ ] **Step 3: Implement** `avesmapsWikiPathVerlaufComputeCase` + `avesmapsWikiPathVerlaufReadAssignments` + `avesmapsWikiPathVerlaufListCases` + `const AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS = 15;` in `path-verlauf.php` per the rules and routing-context code above. In `avesmapsWikiPathVerlaufReadAssignments` decode `properties_json` once per row and read `wiki_path.{wiki_key,source,course_hash}`; skip rows without `wiki_path.wiki_key`.

- [ ] **Step 4: Wire GET arm** — in `api/edit/wiki/paths.php` GET dispatch:

```php
'verlauf_cases' => avesmapsWikiPathVerlaufListCases($pdo, $config, [
    'cursor' => (int) ($_GET['cursor'] ?? 0),
    'limit' => (int) ($_GET['limit'] ?? 20),
    'step_runtime' => (int) ($_GET['step_runtime'] ?? 15),
]),
```

- [ ] **Step 5: Run tests + lint** — `php tools/paths/test-path-verlauf-engine.php` → all ok; `php -l` both files.

- [ ] **Step 6: Commit** — `git commit -m "feat(verlauf-sync): diff engine + paginated verlauf_cases action (T3)"`

---

### Task 4: Case-status side-table (defer/archive)

**Files:**
- Modify: `api/_internal/wiki/path-verlauf.php`
- Modify: `api/edit/wiki/paths.php` (3 POST arms)

**Interfaces:**
- Consumes: `avesmapsWikiPathCourseHash`, staging table.
- Produces: `avesmapsWikiPathVerlaufEnsureCaseTable(PDO $pdo): void`, `avesmapsWikiPathVerlaufUpdateCaseStatus(PDO $pdo, string $wikiKey, string $status, ?array $resolution, int $userId): array` (status `open|deferred|archived`; `open` DELETEs the row — exact `political_capital_case_status` pattern, `territories-write.php:114-145`).
- Produces: POST actions `defer_verlauf_case`, `archive_verlauf_case`, `reopen_verlauf_case` — payload `{wiki_key, resolution?}`; response `{ok, wiki_key, status}`.
- Produces: `avesmapsWikiPathVerlaufListCases` merges persisted statuses: a status row applies ONLY while its stored `course_hash` equals the current staging hash — a NEWER wiki edit reopens the case automatically (deviation from the capital pattern, justified: verlauf cases are versioned by course; an archived decision must not swallow a later, different change). Task 5's successful apply DELETEs the status row (like `assign_capital`, `territories-write.php:99-100`).

**DDL (in `avesmapsWikiPathVerlaufEnsureCaseTable`, self-healing pattern):**

```sql
CREATE TABLE IF NOT EXISTS wiki_path_verlauf_case_status (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wiki_key VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    course_hash CHAR(40) NOT NULL DEFAULT '',
    resolution_json JSON NULL,
    reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    reviewed_by BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_path_verlauf_case_key (wiki_key),
    KEY idx_wiki_path_verlauf_case_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

**Steps:**

- [ ] **Step 1: Implement** — `avesmapsWikiPathVerlaufUpdateCaseStatus`: validate `$status` ∈ `['open','deferred','archived']` (else `RuntimeException('Unknown case status.')`); `open` ⇒ `DELETE FROM wiki_path_verlauf_case_status WHERE wiki_key = :k`; else look up the CURRENT staging hash (`SELECT verlauf FROM wiki_path_staging WHERE wiki_key = :k LIMIT 1`, hash via `avesmapsWikiPathCourseHash`; unknown wiki_key ⇒ `RuntimeException('Unknown wiki way: ...')`) and UPSERT (`INSERT ... ON DUPLICATE KEY UPDATE status=VALUES(status), course_hash=VALUES(course_hash), resolution_json=VALUES(resolution_json), reviewed_by=VALUES(reviewed_by)`). In `avesmapsWikiPathVerlaufListCases`: load all status rows once (`SELECT wiki_key, status, course_hash FROM ...`) into a map; per computed case set `status` = persisted status if a row exists AND `row.course_hash === case.staging_hash`, else `'open'`.

- [ ] **Step 2: Wire POST arms** — `defer_verlauf_case` / `archive_verlauf_case` / `reopen_verlauf_case` calling `avesmapsWikiPathVerlaufUpdateCaseStatus($pdo, (string)($payload['wiki_key'] ?? ''), 'deferred'|'archived'|'open', is_array($payload['resolution'] ?? null) ? $payload['resolution'] : null, (int)($user['id'] ?? 0))`. These do NOT enter the map-cache invalidation list (no map_features write).

- [ ] **Step 3: Verify + lint** — `php -l` both files; run `php tools/paths/test-path-verlauf-engine.php` (must still pass — list merge is DB-side, not unit-tested).

- [ ] **Step 4: Commit** — `git commit -m "feat(verlauf-sync): case-status side-table with defer/archive actions (T4)"`

---

### Task 5: Apply backend (`apply_verlauf_case`, `apply_verlauf_cases_clean`)

**Files:**
- Modify: `api/_internal/wiki/paths.php` (single_segment fast path)
- Modify: `api/_internal/wiki/path-verlauf.php` (apply functions)
- Modify: `api/edit/wiki/paths.php` (2 POST arms + cache list)
- Modify: `tools/paths/test-path-verlauf-engine.php` (plan-of-writes tests)

**Interfaces:**
- Consumes: Task 1 `$assignMeta`, Task 3 case computation, Task 4 status delete.
- Produces: `avesmapsWikiPathVerlaufApplyCase(PDO $pdo, array $config, string $wikiKey, bool $dryRun, int $userId): array` — recomputes the case SERVER-SIDE (never trusts client segment lists; owner edits in parallel — staleness trap from the base session), then executes it. Response `{ok, dry_run, wiki_key, case, adds_applied, removes_applied, restamped, skipped_conflicts, segments_updated}`.
- Produces: `avesmapsWikiPathVerlaufApplyCleanCases(PDO $pdo, array $config, bool $dryRun, int $userId, array $options = []): array` — cursor/time-boxed loop (options like `verlauf_cases`), applies ONLY `clean` cases with `status === 'open'`; response `{ok, dry_run, applied_cases: [{wiki_key,name,adds_applied,removes_applied,restamped}], skipped_not_clean, scanned, next_cursor, complete}`.
- Produces: POST actions `apply_verlauf_case` (payload `{wiki_key, dry_run, confirm}`) and `apply_verlauf_cases_clean` (payload `{dry_run, confirm, cursor?, limit?}`), both in the cache-invalidation list.
- Produces (perf, behavior-preserving): `avesmapsWikiPathAssignTo` with `$singleSegment === true` fetches ONLY the target row (`SELECT id, public_id, name, properties_json FROM map_features WHERE public_id = :p AND is_active = 1 AND feature_type = 'path' AND name <> '' LIMIT 1`) instead of the full path scan; `avesmapsWikiPathClearAssign` with `$singleSegment === true` fetches the target row the same way plus a names-only pool query (`SELECT name FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''`) for `avesmapsWikiPathNextGenericName`. Same results as before — the existing loop semantics for `single_segment` only ever touch the target row.

**Apply execution order (per case; spec T5 + Fallen):**
1. Recompute: staging row by `wiki_key` (error `case_not_found` when missing), `avesmapsWikiPathVerlaufReadAssignments`, routing context for the way's `kind`, `avesmapsWikiPathVerlaufComputeCase`. `null` ⇒ error envelope `RuntimeException('Nothing to apply (case unchanged).')` → the endpoint's generic handler; return shape for dry-run: the case preview.
2. Dry-run: return the recomputed case, no writes.
3. Adds: per `adds[].public_id` → `avesmapsWikiPathAssignTo($pdo, $wikiKey, $publicId, false, $userId, true, ['source' => 'verlauf-sync', 'course_hash' => $case['staging_hash'], 'course_hops' => $add['hops']])` (ALWAYS `single_segment:true` — spec T5: name-group matching is dangerous in sync context). Collect `segments_updated`.
4. Removes: per `removes[].public_id` → re-read the row's current `wiki_path.source` right before the write; ONLY when it is `'verlauf-sync'` call `avesmapsWikiPathClearAssign($pdo, $publicId, false, $userId, true)`; otherwise count into `skipped_conflicts` (owner touched it between compute and write).
5. Restamp keeps: segments in Soll ∩ Ist whose `wiki_path.course_hash !== staging_hash` OR whose `course_hops` differ → direct `UPDATE` of `properties_json` setting `wiki_path.course_hash = staging_hash`, `wiki_path.course_hops = <hop labels for this segment>` while PRESERVING everything else — especially `source` (an owner-curated keep stays owner-curated: hash ≠ provenance). Name column untouched. Audited via `avesmapsWikiSyncFetchAuditRow` + `avesmapsWikiSyncAuditFeaturePropsChange(..., (string) $before['name'])`, one shared revision.
6. Delete the case-status row for `wiki_key` (Task 4 pattern).
7. `hash_only` cases: steps 3-4 are no-ops, step 5 restamps — this is how repeated scans go quiet.

**Bulk rules:** iterate staging rows by cursor exactly like `verlauf_cases`; skip non-clean/non-open; before applying a case, drop any of its `adds` whose `public_id` was already claimed by an EARLIER case in this run (`$claimedThisRun` set) — if that drops anything, SKIP the whole case as `skipped_not_clean` (it will resurface next scan; safer than writing a silently partial course — Falle: "Soll-Mengen VOR dem Schreiben gegeneinander deduplizieren"). After each applied case, add its Soll ids to `$claimedThisRun`.

**Steps:**

- [ ] **Step 1: Failing tests** — extend `tools/paths/test-path-verlauf-engine.php` with a pure planning helper so the write plan is testable without DB. Implement `avesmapsWikiPathVerlaufPlanWrites(array $case, array $currentByPublicId): array` in `path-verlauf.php` (used by ApplyCase) returning `['adds' => [publicId => hops], 'removes' => [publicId,...], 'restamps' => [publicId => hops]]`, where `$currentByPublicId` = `[publicId => ['source' => s, 'course_hash' => s, 'course_hops' => array]]` for the way's current segments:

```php
$case = ['staging_hash' => 'newhash', 'hash_only' => false,
    'adds' => [['public_id' => 's2', 'name' => 'n', 'hops' => ['A → B']]],
    'removes' => [['public_id' => 's9', 'name' => 'n']],
    'keeps' => [['public_id' => 's1', 'hops' => ['A → B']]]];
$current = ['s1' => ['source' => 'editor', 'course_hash' => 'old', 'course_hops' => []], 's9' => ['source' => 'verlauf-sync', 'course_hash' => 'old', 'course_hops' => []]];
$plan = avesmapsWikiPathVerlaufPlanWrites($case, $current);
check('plan adds', $plan['adds'], ['s2' => ['A → B']]);
check('plan removes only sync source', $plan['removes'], ['s9']);
check('plan restamps stale keep', $plan['restamps'], ['s1' => ['A → B']]);
// keep already current => no restamp
$current2 = $current; $current2['s1'] = ['source' => 'editor', 'course_hash' => 'newhash', 'course_hops' => ['A → B']];
$plan = avesmapsWikiPathVerlaufPlanWrites($case, $current2);
check('no restamp when current', $plan['restamps'], []);
// remove whose source flipped to editor since compute => dropped
$current3 = $current; $current3['s9']['source'] = 'editor';
$plan = avesmapsWikiPathVerlaufPlanWrites($case, $current3);
check('editor-flipped remove dropped', $plan['removes'], []);
```

  (Task 3's `avesmapsWikiPathVerlaufComputeCase` must emit `keeps` = Soll ∩ Ist with hop labels for this to work — add it to the case shape: `'keeps' => [['public_id'=>s,'hops'=>[...]]]`, excluded when removes are suppressed? No: keeps are always emitted for routable Soll. Update the Task 3 tests' expectations accordingly if the reviewer flags a mismatch.)

- [ ] **Step 2: Run to verify failure**, then **implement**: the fast paths in `avesmapsWikiPathAssignTo`/`avesmapsWikiPathClearAssign` (replace the full `$paths` query with the targeted queries when `$singleSegment`; keep the loop body identical), `avesmapsWikiPathVerlaufPlanWrites`, `avesmapsWikiPathVerlaufApplyCase`, `avesmapsWikiPathVerlaufApplyCleanCases` per the rules above.

- [ ] **Step 3: Wire POST arms** — both actions, gated `!(($payload['dry_run'] ?? true) === false && (string)($payload['confirm'] ?? '') === 'apply')`, added to the line-75 invalidation list.

- [ ] **Step 4: Run ALL tests + lint** — `php -d extension=mbstring tools/paths/test-path-verlauf-source.php && php tools/paths/test-path-verlauf-engine.php && php tools/paths/test-path-wiki-naming.php && php -d extension=mbstring tools/paths/test-path-wiki-grouping.php`; `php -l` on the three PHP files.

- [ ] **Step 5: Commit** — `git commit -m "feat(verlauf-sync): case apply backend with single-segment writes + clean bulk apply (T5)"`

---

### Task 6: Frontend — "Verlauf-Fälle" view in the Wege panel

**Files:**
- Modify: `js/review/review-path-sync.js`

**Interfaces:**
- Consumes: GET `?action=verlauf_cases&cursor&limit`, POST `apply_verlauf_case` / `apply_verlauf_cases_clean` / `defer_verlauf_case` / `archive_verlauf_case` / `reopen_verlauf_case` (shapes from Tasks 3-5) via the existing `pathSyncGet`/`pathSyncPost` helpers.
- UI language: German. Code comments: English. No `index.html` change needed (`#path-sync-tabs`/`#path-sync-list` are JS-rendered).

**Behavior:**
1. `renderPathSyncList()` adds a fourth view tab `Verlauf-Fälle` (`pathSyncView === 'cases'`). First activation (and a „Neu berechnen" button) triggers `loadVerlaufCases()`.
2. `loadVerlaufCases()`: sequential cursor loop (`cursor=0` → follow `next_cursor` until `complete`; NEVER parallel — STRATO), accumulating into module state `verlaufCases`; progress text in `#path-sync-summary` (`Prüfe Verläufe … (n Wege geprüft, m Fälle)`); re-render after each page. Guard against double-start (`verlaufCasesLoading` flag).
3. Rendering into `#path-sync-list`, grouped: open cases by type with German headers — `Verlauf geändert` (verlauf_changed), `Konflikt (manuell)` (course_conflict), `Ort fehlt` (station_missing), `Nicht routbar` (hops_unroutable) — then `<details>` sections `Zurückgestellt` / `Archiviert` (pattern: `renderWikiSyncCases()` in `js/review/review-wiki-sync-cases.js:40-42`). Per case: way name (link to `wiki_url`, `target="_blank"`), kind badge (Straße/Fluss), flags as German chips (fehlende Orte, unroutbare Etappen mit Grund, Konflikte mit Segmentnamen und `fremd`/`Owner` label, Backtrack-Hinweis), adds as `+ <name> (<hops>)` (green class), removes as `− <name>` (red class), `hash_only` cases as `Nur Kurs-Stempel aktualisieren`.
4. Buttons per open case: `Übernehmen` → POST `apply_verlauf_case` dry-run → `window.confirm` with counts (`„<Name>": <a> Segmente zuweisen, <r> lösen. Übernehmen?`) → POST with `{dry_run:false, confirm:'apply'}` → remove case from local state, status message with applied counts. `Zurückstellen` / `Archivieren` → POST defer/archive (no confirm) → move case to that section. Deferred/archived cases get `Wieder öffnen` → POST reopen → back to open.
5. Top bar of the cases view: count summary + `Alle unstrittigen übernehmen` button (enabled when ≥1 case has `clean === true` and `status === 'open'`): `window.confirm` with the clean count → sequential cursor loop over POST `apply_verlauf_cases_clean {dry_run:false, confirm:'apply', cursor, limit}` until `complete`, then full `loadVerlaufCases()` re-scan. Non-clean cases are untouched by the server (DoD 5).
6. Follow existing code style: module-level state consts, delegated click handler pattern (extend the existing `document.addEventListener("click", ...)` blocks at lines 385-411 with `data-verlauf-action="apply|defer|archive|reopen|apply-clean|rescan"` + `data-wiki-key` attributes), `escapeHtml`-style helper if one exists in the file (check; if not, reuse whatever the file already does for user strings — it builds HTML with template literals; keep consistent).

**Steps:**

- [ ] **Step 1: Implement** the view per behavior 1-6.
- [ ] **Step 2: Syntax check** — `node --check js/review/review-path-sync.js` → OK.
- [ ] **Step 3: Manual smoke note** — no local backend; real verification happens in Task 7 live. State this in the report instead of claiming UI verification.
- [ ] **Step 4: Commit** — `git commit -m "feat(verlauf-sync): Verlauf-Faelle review view in the Wege panel (T6)"`

---

### Task 7: Push, deploy, live verification (DoD) — CONTROLLER ONLY

Not dispatched to an implementer. Controller: push to `master`, verify remote SHA, wait ~2 min (js deploys before api — never probe PHP earlier). Then via authed owner browser session (claude-in-chrome on avesmaps.de, single requests, no loops):

1. `backfill_verlauf_source` dry-run → inspect counts/sample → apply (cursor loop until complete).
2. GET `verlauf_cases` full scan (sequential cursor) → verify case types + counts plausible; verify a `course_conflict`/manual case shows owner-curated protection (DoD 3), `station_missing`/`hops_unroutable` appear as hint cases (DoD 4).
3. Apply ONE small clean case (dry-run → apply) → verify segments renamed to canonical name, `source='verlauf-sync'`, `course_hash` current (via map-features fetch), way label/deep-link follow (DoD 2).
4. Undo probe: undo ONE sync-assigned segment in the Änderungs-Verlauf → segment restored (DoD 6); re-apply the case afterwards.
5. `apply_verlauf_cases_clean` dry-run → confirm it lists only clean cases (DoD 5). Whether to bulk-apply for real: owner comfort feature — leave the actual bulk run to the owner (🔧 DU).
6. DoD 1 strict (wiki edit ⇒ exactly ONE new case) needs a staging `verlauf` mutation — no endpoint writes staging directly. 🔧 DU (owner): one-line phpMyAdmin `UPDATE wiki_path_staging SET verlauf = ... WHERE wiki_key = ...` on a test way, then re-scan. Alternative: a real edit in Wiki Aventurica + re-crawl of that page. Document in the final summary.

---

## Self-Review Notes

- Spec coverage: T1→Task 1, T2→Task 2, T3→Task 3, T4→Task 4, T5→Task 5, T6→Task 6, DoD→Task 7. Karten-Diff-Vorschau is explicitly Phase 2 (out of scope, spec §4 T6).
- Case shape includes `keeps` (added for Task 5's restamp) — Task 3 implementer: emit `keeps` = routable Soll ∩ Ist with hop labels.
- Type consistency: `$assignMeta` (Tasks 1/5), case shape (Tasks 3/4/5/6), action names (`backfill_verlauf_source`, `verlauf_cases`, `defer/archive/reopen_verlauf_case`, `apply_verlauf_case`, `apply_verlauf_cases_clean`) — all spelled identically across tasks.
