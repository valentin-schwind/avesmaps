<?php

declare(strict_types=1);

/**
 * Hybrid WikiDump migration -- Task H4c-b: the SERVER-SIDE ORCHESTRATION that
 * drives the hybrid read_step over ONE `wiki_sync_runs` row (sync_type
 * `dump_read`).
 * ---------------------------------------------------------------------------
 * H1 (dump-category-layer.php) builds the three online override maps; H4a
 * (dump-hybrid-state.php) fills those maps + the wanted-title breadth into the
 * sandbox state table and exposes the title->title redirect extractor; H4b
 * (dump-hybrid-read.php) adds the two resumable dump-compute steps
 * (wikitext_collect + parse_and_upsert with $dryRun). This file is the driver
 * that wires them into a resumable 7-phase state machine, reusing the
 * phase/stats_json mechanics of avesmapsWikiSyncAdvanceRun (locations.php:145)
 * VERBATIM -- it introduces NO new run-state store.
 *
 * PHASE ORDER (design report §5, one row, sync_type dump_read; the continent map
 * was moved AFTER wikitext_collect by CONTINENT-FIX #1 -- see the ordered-list
 * function's inline note for why):
 *   1. online_class_map     (H1 single-step: avesmapsWikiDumpHybridFillClassMap)
 *   2. online_building_map  (H1 single-step: avesmapsWikiDumpHybridFillBuildingMap)
 *   3. wikitext_collect     (RESUMABLE, cursor = stats['wikitext_cursor']:
 *                            avesmapsWikiDumpHybridWikitextCollectStep -- the
 *                            whole-dump scan that ENUMERATES all 5 kinds into the
 *                            state table, so it must precede the continent map)
 *   4. redirect_aliases     (RESUMABLE, cursor = stats['dump_cursor']: build &
 *                            PERSIST the title->title alias map via H4a's
 *                            avesmapsWikiDumpCollectRedirectTitleAliases + the
 *                            same slug-keyed aliases Pass A writes)
 *   5. online_continent_map (RESUMABLE, cursor = stats['continent_cursor']:
 *                            avesmapsWikiDumpHybridFillContinentMapStep -- now reads
 *                            the FULLY-populated state table via FetchWantedTitles,
 *                            so it covers regions/territories, not just settlements;
 *                            dispatched with an explicit per-step call budget, see
 *                            AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET below)
 *   6. parse_and_upsert     (RESUMABLE, cursor = stats['parse_cursor'], dryRun=
 *                            TRUE inside read_step: avesmapsWikiDumpHybridParseUpsertStep)
 *   7. completed
 *
 * TWO LEVELS OF STEPPING (design §5): the outer phase NAME is the top-level
 * cursor (like avesmapsWikiSyncAdvanceRun); a RESUMABLE phase stays in its
 * phase value across advance calls, advancing only its own inner cursor, until
 * that step's `done` flips -- then the phase name advances. One bounded step
 * PER request; the frontend (H4c-f) drives repetition (CLAUDE.md: never loop a
 * heavy endpoint server-side).
 *
 * THE GATE (progress.md "H4c GATE WIRING", AUTHORITATIVE): the read_step
 * advance action runs phase 6 with dryRun=TRUE -- across the read pass it writes
 * ONLY sandbox/staging tables (the hybrid state table, the alias table, and the
 * publication_sources catalog + entity-ref staging tables), NOTHING sharp. A
 * SEPARATE `apply` action runs phase 6 with dryRun=FALSE (the sole sharp
 * real-*_staging write; it ALSO drives the publication_sources reconcile into
 * feature_sources), which the owner triggers ONLY after the H5 compare-test is
 * green. The two are DISTINCT actions, never folded together.
 *
 * ALIAS PERSISTENCE (design report §4 option a, brief item 4): H4a's
 * avesmapsWikiDumpCollectRedirectTitleAliases() is a PURE collector that stores
 * nothing. The redirect_aliases phase persists its output into a new small
 * self-healing table `wiki_dump_title_alias(run_id, alias_title,
 * canonical_title)` -- chosen over a state-table column because the alias key
 * space (redirect page titles) is DISJOINT from the wanted-set key space (the
 * state table's normalized_title rows): an alias title is NOT a wanted row, so
 * folding it into wiki_dump_hybrid_state would either pollute the wanted-set
 * membership test or need a discriminator column. A dedicated two-VARCHAR table
 * is the simpler persistence and is run-scoped for disposable cleanup parity
 * with the state table. The multi-step wikitext_collect phase loads it fresh
 * each step (bounded SELECT) and passes it to H4b as $titleAliasMap.
 *
 * WHY NOT avesmapsWikiDumpRunPassAStep VERBATIM for phase 4: that function
 * (dump-reader.php:556) is a self-contained SINGLE-phase runner -- it OWNS the
 * run row's phase (`pass_a_redirects`) and status (flips to `completed` when the
 * dump stream ends). Calling it inside this multi-phase machine would hijack the
 * orchestrator's own phase/status columns. So the redirect_aliases phase reuses
 * the same reader primitives (avesmapsWikiDumpOpenReader / -IteratePages), the
 * same slug-keyed alias upsert (avesmapsWikiSyncMonitorStoreAlias), and H4a's
 * title-keyed extractor VERBATIM -- but this driver, not Pass A, owns the run
 * row. The reopen+skip+cursor+time-budget discipline is identical to Pass A.
 *
 * PURE CORE / DB-DISPATCH SPLIT (so the phase-transition + alias-persist logic
 * is unit-testable with injected fake step fns, no DB/dump -- like H4a/H4b):
 *   - avesmapsWikiDumpHybridComputeNextState() is a PURE function: given the
 *     current (phase, stats) and a step result {done, cursor, ...}, it returns
 *     the next (phase, stats, progress, message, status). Zero DB, zero dump.
 *   - avesmapsWikiDumpHybridAdvanceReadStep() is the DB/dispatch driver: it
 *     reads the run row, calls the matching real H1/H4a/H4b step fn for the
 *     current phase (or an INJECTED fake, via the $stepFns seam), threads the
 *     result through the pure transition fn, and persists via the reused
 *     avesmapsWikiSyncUpdateRun.
 *
 * PURITY CONTRACT: side-effect-free on include (only const + function defs --
 * no top-level code, no DB connect, no headers), so a test can `require` it with
 * no MySQL. Every DB / dump touch lives in a function that takes a PDO
 * explicitly.
 *
 * DEPENDENCIES (the caller loads these before invoking any driver fn -- the
 * SAME chain dump-hybrid-read.php documents, since this drives its steps):
 *   _internal/bootstrap.php, political/territory.php, wiki/sync.php,
 *   wiki/sync-monitor.php, wiki/locations.php, wiki/settlements.php,
 *   wiki/paths.php, wiki/regions.php, wiki/territories.php, wiki/dump-reader.php,
 *   wiki/dump-category-layer.php, wiki/dump-entity-scan.php,
 *   wiki/dump-hybrid-state.php, wiki/dump-hybrid-read.php. This file requires
 *   nothing on include.
 */

// ===========================================================================
// 0. Phase constants + the ordered phase list (the outer state-machine cursor).
// ===========================================================================

const AVESMAPS_WIKI_DUMP_READ_SYNC_TYPE = AVESMAPS_WIKI_DUMP_SYNC_TYPE; // 'dump_read'

const AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP = 'online_class_map';
const AVESMAPS_WIKI_DUMP_PHASE_BUILDING_MAP = 'online_building_map';
const AVESMAPS_WIKI_DUMP_PHASE_CONTINENT_MAP = 'online_continent_map';
const AVESMAPS_WIKI_DUMP_PHASE_REDIRECT_ALIASES = 'redirect_aliases';
const AVESMAPS_WIKI_DUMP_PHASE_WIKITEXT_COLLECT = 'wikitext_collect';
const AVESMAPS_WIKI_DUMP_PHASE_PARSE_AND_UPSERT = 'parse_and_upsert';
// Wiki-publication-sources sync (Task 4): build the publication catalog + entity refs from the
// dump (sandbox staging tables), then -- ONLY on the sharp path (dryRun=false) -- reconcile them
// into production feature_sources. Ordered right AFTER redirect_aliases (which it needs, to
// resolve publication link titles via wiki_redirect_alias). See publication-sync.php.
const AVESMAPS_WIKI_DUMP_PHASE_PUBLICATION_SOURCES = 'publication_sources';
// Abenteuer (Phase 4): build the adventure catalog + ordered "Ort" place staging from the dump's
// {{Infobox Produkt}} adventure pages (STAGING ONLY, same infobox scan as publication_sources).
// The sharp reconcile into the live adventure/adventure_place tables is a SEPARATE owner-triggered
// action (sync_adventures), NOT part of this phase -- so "Dump holen" only ever stages adventures.
// See adventure-sync.php.
const AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES = 'adventures';
// Kartensammlung (stages 1+2): build the citymap catalog from the two index PAGES (Stadtplanindex,
// Kartenindex) -- a title match, not an infobox scan, because the maps live in tables on two known
// pages rather than one page each. STAGING ONLY, exactly like adventures: the sharp reconcile into
// the live citymap/citymap_place tables is the owner's separate sync_citymaps action. See
// citymap-sync.php.
const AVESMAPS_WIKI_DUMP_PHASE_CITYMAPS = 'citymaps';
// Flora/Fauna/Spezies/Handelswaren: scans the four lore infoboxes (Tierart, Pflanzenart,
// Spezies, Gegenstandsgruppe) into wiki_lore_catalog + place staging. STAGING ONLY, exactly
// like adventures and citymaps -- the sharp reconcile into lore_entry/lore_place is the owner's
// separate sync_lore action. See lore-sync.php.
//
// Lore SOURCES are not staged here: they ride the publication_sources phase above, which
// recognises lore pages through avesmapsPublicationEntityRefForPage and stages them into
// wiki_entity_publication like every other entity's sources (AGENTS.md §5).
const AVESMAPS_WIKI_DUMP_PHASE_LORE = 'lore';
const AVESMAPS_WIKI_DUMP_PHASE_COMPLETED = 'completed';

/**
 * Per-step API-call budget for the online_continent_map phase (PERF FIX: this
 * used to be dispatched with $callBudget=null, i.e. "no limit", so ONE step
 * walked the entire ~9k-title/~450-batch set in a single request -- each batch
 * is one throttled HTTP call at ~600ms usleep (AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS,
 * sync.php:11) plus the round-trip, so one step took roughly 4.5 MINUTES,
 * starving the lock's between-step heartbeat (dump-lock.php) for that whole
 * window. avesmapsWikiDumpCategoryFetchContinentMap() (dump-category-layer.php:429)
 * already implements a full cursor/callBudget/done resume contract -- it was
 * simply never driven with a bound. 20 calls/step x ~0.6-0.85s/call (throttle +
 * HTTP) ~= 12-17s, comfortably under AVESMAPS_WIKI_DUMP_STEP_SECONDS (28s) even
 * on a slow STRATO connection, while still making solid per-request progress;
 * the phase resumes across steps via stats['continent_cursor'] exactly like the
 * other resumable phases (wikitext_collect, redirect_aliases, parse_and_upsert).
 */
const AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET = 20;

/**
 * The ordered work phases (excluding the terminal `completed`). progress_total
 * is count() of this list; progress_current is the index of the phase currently
 * being worked (0-based -> 1-based on completion), so the frontend can render a
 * "phase N of 6" bar. The order is a CONTRACT -- the pure transition fn walks it
 * by index.
 *
 * @return list<string>
 */
function avesmapsWikiDumpHybridPhaseOrder(): array
{
    return [
        AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP,
        AVESMAPS_WIKI_DUMP_PHASE_BUILDING_MAP,
        // CONTINENT-FIX #1: wikitext_collect (the whole-dump scan) MUST run before
        // online_continent_map. The continent map sources its title list from the
        // state table via avesmapsWikiDumpHybridFetchWantedTitles(); only after the
        // scan has enumerated ALL 5 kinds (paths/regions/settlements/buildings/
        // territories) into the state table does that list cover regions/territories.
        // Running it earlier (its former slot) covered only the H1 settlement/building
        // rows, leaving dump-enumerated regions/territories with the dump-only
        // (I6-broken, literal-category-only) continent. The transition machine is a
        // name-keyed index walker (avesmapsWikiDumpHybridComputeNextState +
        // -ResumableCursorKeys), so reordering this list is self-consistent -- each
        // resumable phase keeps its own cursor key regardless of position.
        AVESMAPS_WIKI_DUMP_PHASE_WIKITEXT_COLLECT,
        AVESMAPS_WIKI_DUMP_PHASE_REDIRECT_ALIASES,
        // Task 4: publication_sources runs RIGHT AFTER redirect_aliases -- its only
        // dependency (it resolves publication link titles via wiki_redirect_alias) -- and
        // BEFORE continent_map / parse_and_upsert, so parse_and_upsert stays the terminal
        // sharp phase (THE GATE contract unchanged). It is independent of continent_map and
        // parse_and_upsert (its reconcile reads LIVE entities + its own staging, not the
        // territory/settlement staging those build). Under read_step (dryRun) it builds ONLY
        // the sandbox staging tables (wiki_publication_catalog + wiki_entity_publication); the
        // sharp production reconcile into feature_sources is gated behind dryRun=false in the
        // dispatch, mirroring parse_and_upsert. Resumable via its own stage marker + cursor.
        AVESMAPS_WIKI_DUMP_PHASE_PUBLICATION_SOURCES,
        // Abenteuer staging runs right after publication_sources (same {{Infobox Produkt}} scan,
        // different payload). STAGING-ONLY, so it is dryRun-agnostic and never a sharp write; the
        // production reconcile is the owner's sync_adventures action.
        AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES,
        // Kartensammlung staging runs right after adventures: same STAGING-ONLY contract, so it is
        // dryRun-agnostic and never a sharp write. It scans for two known index PAGES rather than an
        // infobox. The production reconcile is the owner's sync_citymaps action.
        AVESMAPS_WIKI_DUMP_PHASE_CITYMAPS,
        // Flora/Fauna/Spezies/Handelswaren staging: same STAGING-ONLY contract again, so
        // dryRun-agnostic and never a sharp write. Scans the four lore infoboxes on ordinary
        // article pages. The production reconcile is the owner's sync_lore action.
        AVESMAPS_WIKI_DUMP_PHASE_LORE,
        AVESMAPS_WIKI_DUMP_PHASE_CONTINENT_MAP,
        AVESMAPS_WIKI_DUMP_PHASE_PARSE_AND_UPSERT,
    ];
}

/**
 * The RESUMABLE phases and the stats_json cursor key each one advances (design
 * report §5 "Resume cursor(s) per phase"). A phase NOT in this map is a
 * single-step transition (online_class_map / online_building_map). The cursor
 * value is always a plain int in stats_json (safe -- never the bulk maps, which
 * live in the state table, per the anti-bloat rule in design §2/§3).
 *
 * @return array<string, string> phase => stats_json cursor key
 */
function avesmapsWikiDumpHybridResumableCursorKeys(): array
{
    return [
        AVESMAPS_WIKI_DUMP_PHASE_CONTINENT_MAP => 'continent_cursor',
        AVESMAPS_WIKI_DUMP_PHASE_REDIRECT_ALIASES => 'dump_cursor', // the existing Pass-A field name
        AVESMAPS_WIKI_DUMP_PHASE_WIKITEXT_COLLECT => 'wikitext_cursor',
        AVESMAPS_WIKI_DUMP_PHASE_PARSE_AND_UPSERT => 'parse_cursor',
        // The dump page cursor for the publication_sources catalog/refs sub-stages. Its OTHER
        // sub-state (publication_stage, pub_recon_segment, pub_recon_last_id) + counters ride in
        // stats_json via the step's 'stats_patch' (merged by avesmapsWikiDumpHybridAdvanceReadStep).
        AVESMAPS_WIKI_DUMP_PHASE_PUBLICATION_SOURCES => 'publication_cursor',
        // The dump page cursor for the adventure catalog/place staging build.
        AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES => 'adventure_cursor',
        // The dump page cursor for the citymap catalog build (Stadtplanindex + Kartenindex).
        AVESMAPS_WIKI_DUMP_PHASE_CITYMAPS => 'citymap_cursor',
        // The dump page cursor for the lore catalog build (four infoboxes, ~5.1k entries).
        AVESMAPS_WIKI_DUMP_PHASE_LORE => 'lore_cursor',
    ];
}

// ===========================================================================
// 1. PURE phase-transition core (DB-free, unit-tested with fake step results).
// ===========================================================================

/**
 * PURE: given the CURRENT phase + the accumulated stats + the result of ONE step
 * of that phase, compute the NEXT persisted state (phase, stats, progress,
 * message, status). No DB, no dump -- the single source of truth for "when does
 * a resumable phase stay put vs advance, and when does the run complete".
 *
 * Contract, per design report §5:
 *   - A NON-resumable phase (online_class_map / online_building_map) ALWAYS
 *     advances to the next phase (its step is one unit of work); progress bumps.
 *   - A RESUMABLE phase writes its inner cursor from $stepResult['nextCursor']
 *     (falling back to 'cursor', then the prior value) into its stats key and,
 *     iff $stepResult['done'] is true, advances the phase name + bumps progress;
 *     otherwise it STAYS in the same phase for the next advance call.
 *   - Advancing off the LAST work phase (parse_and_upsert) sets phase
 *     `completed` + status `completed` (progress_current = progress_total).
 *
 * @param string               $phase      the phase whose step just ran
 * @param array<string, mixed> $stats      the run's decoded stats_json (mutated copy returned)
 * @param array<string, mixed> $stepResult the step fn's return (needs at least 'done'; resumable phases also read 'nextCursor'/'cursor')
 * @return array{phase:string, stats:array<string,mixed>, status:string, progress_current:int, progress_total:int, done:bool, phase_advanced:bool}
 */
function avesmapsWikiDumpHybridComputeNextState(string $phase, array $stats, array $stepResult): array
{
    $order = avesmapsWikiDumpHybridPhaseOrder();
    $total = count($order);
    $cursorKeys = avesmapsWikiDumpHybridResumableCursorKeys();

    $index = array_search($phase, $order, true);
    if ($index === false) {
        // Unknown/terminal phase: never advance. (completed rows never reach here
        // via the driver -- guarded before dispatch -- but stay total-safe.)
        return [
            'phase' => $phase,
            'stats' => $stats,
            'status' => $phase === AVESMAPS_WIKI_DUMP_PHASE_COMPLETED ? 'completed' : 'running',
            'progress_current' => $phase === AVESMAPS_WIKI_DUMP_PHASE_COMPLETED ? $total : 0,
            'progress_total' => $total,
            'done' => $phase === AVESMAPS_WIKI_DUMP_PHASE_COMPLETED,
            'phase_advanced' => false,
        ];
    }

    $isResumable = isset($cursorKeys[$phase]);
    $stepDone = (bool) ($stepResult['done'] ?? false);

    // Persist the inner cursor for a resumable phase (always -- even when not yet
    // done, so the NEXT step resumes past the pages/rows this step consumed).
    if ($isResumable) {
        $cursorKey = $cursorKeys[$phase];
        $priorCursor = isset($stats[$cursorKey]) ? (int) $stats[$cursorKey] : 0;
        $nextCursor = $stepResult['nextCursor'] ?? ($stepResult['cursor'] ?? $priorCursor);
        $stats[$cursorKey] = max(0, (int) $nextCursor);
    }

    // A non-resumable phase always advances; a resumable one advances only when
    // its own step reports done.
    $phaseAdvances = !$isResumable || $stepDone;

    if (!$phaseAdvances) {
        // Stay in the same phase; progress reflects the phase index still in flight.
        return [
            'phase' => $phase,
            'stats' => $stats,
            'status' => 'running',
            'progress_current' => (int) $index, // still working phase #index -> current = index
            'progress_total' => $total,
            'done' => false,
            'phase_advanced' => false,
        ];
    }

    $nextIndex = (int) $index + 1;
    if ($nextIndex >= $total) {
        // Advanced off the last work phase -> the whole run is complete.
        return [
            'phase' => AVESMAPS_WIKI_DUMP_PHASE_COMPLETED,
            'stats' => $stats,
            'status' => 'completed',
            'progress_current' => $total,
            'progress_total' => $total,
            'done' => true,
            'phase_advanced' => true,
        ];
    }

    return [
        'phase' => $order[$nextIndex],
        'stats' => $stats,
        'status' => 'running',
        'progress_current' => $nextIndex, // now working phase #nextIndex
        'progress_total' => $total,
        'done' => false,
        'phase_advanced' => true,
    ];
}

/**
 * PURE: a human-readable German message for a persisted state (the `message`
 * column the frontend shows). Separated from the transition fn so the latter
 * stays a pure data function; kept German per the language policy (§8: UI
 * strings stay German).
 */
function avesmapsWikiDumpHybridPhaseMessage(string $phase, bool $completed): string
{
    if ($completed || $phase === AVESMAPS_WIKI_DUMP_PHASE_COMPLETED) {
        return 'Dump-Read abgeschlossen.';
    }

    switch ($phase) {
        case AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP:
            return 'Online-Klassenkarte wird geladen.';
        case AVESMAPS_WIKI_DUMP_PHASE_BUILDING_MAP:
            return 'Online-Bauwerkskarte wird geladen.';
        case AVESMAPS_WIKI_DUMP_PHASE_CONTINENT_MAP:
            return 'Online-Kontinentkarte wird geladen.';
        case AVESMAPS_WIKI_DUMP_PHASE_REDIRECT_ALIASES:
            return 'Weiterleitungs-Aliase werden aus dem Dump gelesen.';
        case AVESMAPS_WIKI_DUMP_PHASE_WIKITEXT_COLLECT:
            return 'Wikitext wird aus dem Dump gesammelt.';
        case AVESMAPS_WIKI_DUMP_PHASE_PARSE_AND_UPSERT:
            return 'Datensaetze werden geparst (Probelauf).';
        case AVESMAPS_WIKI_DUMP_PHASE_PUBLICATION_SOURCES:
            return 'Publikationsquellen werden aus dem Dump abgeglichen.';
        default:
            return 'Dump-Read laeuft.';
    }
}

// ===========================================================================
// 2. TITLE->TITLE alias table -- self-healing DDL + upsert + load.
// ===========================================================================

/**
 * Idempotently create `wiki_dump_title_alias` (self-healing DDL, same inline
 * pattern the rest of the codebase uses). One row per (run_id, alias_title): the
 * normalized redirect page title -> the normalized canonical target title, as
 * H4a's avesmapsWikiDumpCollectRedirectTitleAliases() produces. Run-scoped for
 * disposable cleanup parity with wiki_dump_hybrid_state. Every writer below
 * calls this first, so a caller never needs to remember to.
 */
function avesmapsWikiDumpHybridEnsureTitleAliasTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_dump_title_alias (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            alias_title VARCHAR(255) NOT NULL,
            canonical_title VARCHAR(255) NOT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_dump_title_alias_run_alias (run_id, alias_title),
            KEY idx_dump_title_alias_run (run_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * PURE: turn a title->title alias map (as avesmapsWikiDumpCollectRedirectTitleAliases()
 * returns: normalized alias title => normalized canonical title) into the list
 * of {alias_title, canonical_title} rows to persist. A degenerate empty side
 * contributes nothing (mirrors the extractor's own skip conditions). Separated
 * from the DB upsert so the round-trip shape is unit-testable without a DB.
 *
 * @param array<string, string> $aliasMap normalized alias title => normalized canonical title
 * @return list<array{alias_title: string, canonical_title: string}>
 */
function avesmapsWikiDumpHybridComputeTitleAliasRows(array $aliasMap): array
{
    $rows = [];
    foreach ($aliasMap as $aliasTitle => $canonicalTitle) {
        $aliasTitle = (string) $aliasTitle;
        $canonicalTitle = (string) $canonicalTitle;
        if ($aliasTitle === '' || $canonicalTitle === '') {
            continue;
        }
        $rows[] = [
            'alias_title' => $aliasTitle,
            'canonical_title' => $canonicalTitle,
        ];
    }

    return $rows;
}

/**
 * Persist a batch of title->title alias rows for a run via one parameterized
 * INSERT ... ON DUPLICATE KEY UPDATE keyed on (run_id, alias_title) -- last
 * write wins, matching the extractor's own upsert-consistent semantics. Safe to
 * call across multiple redirect_aliases steps (each step persists the aliases it
 * found in its page window). Calls the DDL first (idempotent).
 *
 * @param array<string, string> $aliasMap normalized alias title => normalized canonical title
 * @return int rows written this call
 */
function avesmapsWikiDumpHybridPersistTitleAliases(PDO $pdo, int $runId, array $aliasMap): int
{
    $rows = avesmapsWikiDumpHybridComputeTitleAliasRows($aliasMap);
    if ($rows === []) {
        return 0;
    }

    avesmapsWikiDumpHybridEnsureTitleAliasTable($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO wiki_dump_title_alias (run_id, alias_title, canonical_title)
         VALUES (:run_id, :alias_title, :canonical_title)
         ON DUPLICATE KEY UPDATE canonical_title = VALUES(canonical_title)'
    );

    $written = 0;
    foreach ($rows as $row) {
        $statement->execute([
            'run_id' => $runId,
            'alias_title' => $row['alias_title'],
            'canonical_title' => $row['canonical_title'],
        ]);
        $written++;
    }

    return $written;
}

/**
 * Load the full title->title alias map for a run back into the shape H4b's
 * avesmapsWikiDumpHybridWikitextCollectStep() expects as $titleAliasMap
 * (normalized alias title => normalized canonical title). Rebuilt fresh each
 * wikitext_collect step; the alias set is small (only redirect pages), so this
 * is a bounded read. Thin DB accessor; owner-live-verified (tests inject the map
 * directly).
 *
 * @return array<string, string>
 */
function avesmapsWikiDumpHybridLoadTitleAliases(PDO $pdo, int $runId): array
{
    avesmapsWikiDumpHybridEnsureTitleAliasTable($pdo);

    $statement = $pdo->prepare(
        'SELECT alias_title, canonical_title FROM wiki_dump_title_alias WHERE run_id = :run_id'
    );
    $statement->execute(['run_id' => $runId]);

    $map = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $alias = (string) ($row['alias_title'] ?? '');
        $canonical = (string) ($row['canonical_title'] ?? '');
        if ($alias !== '' && $canonical !== '') {
            $map[$alias] = $canonical;
        }
    }

    return $map;
}

// ===========================================================================
// 3. redirect_aliases STEP (resumable page-walk; SANDBOX + alias-table writes).
// ===========================================================================

/**
 * Process ONE bounded redirect_aliases step: reopen the dump, skip $cursor
 * pages, stream up to the page/time budget, and for every <redirect> page
 * persist BOTH (a) the title->title alias (via H4a's pure extractor +
 * avesmapsWikiDumpHybridPersistTitleAliases) so wikitext_collect can resolve a
 * wanted title that is itself a redirect, AND (b) the slug-keyed alias
 * (alias_slug -> canonical_wiki_key) via the SAME avesmapsWikiSyncMonitorStoreAlias
 * upsert Pass A uses -- verbatim, so the existing wiki_redirect_alias output is
 * unchanged for any territory consumer.
 *
 * This mirrors avesmapsWikiDumpRunPassAStep's reopen+skip+cursor+budget
 * discipline EXACTLY, but does NOT own the run row's phase/status (the driver
 * does). Cursor = a page counter (stats['dump_cursor']). done=true iff the
 * stream ran to exhaustion within the budget.
 *
 * @param PDO           $pdo
 * @param string        $dumpPath path to the .bz2/.gz/.xml dump
 * @param int           $runId    numeric wiki_sync_runs.id
 * @param int           $cursor   number of leading <page> elements already consumed
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows; default = real reader
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, title_aliases_written:int, slug_aliases_written:int}
 */
function avesmapsWikiDumpHybridRedirectAliasStep(
    PDO $pdo,
    string $dumpPath,
    int $runId,
    int $cursor = 0,
    ?callable $pageSource = null
): array {
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) AVESMAPS_WIKI_DUMP_STEP_SECONDS;

    avesmapsWikiDumpHybridEnsureTitleAliasTable($pdo);

    $source = $pageSource ?? static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };

    $pagesScanned = 0;
    $redirectPages = [];                 // only the <redirect> pages in this window (title + redirect fields only -- no wikitext bodies held)
    $slugTitlesByCanonical = [];         // canonical_wiki_key => [alias page titles] (Pass A shape)
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $target = avesmapsWikiDumpPageRedirectTarget($page);
        if ($target !== null && trim((string) ($page['title'] ?? '')) !== '') {
            // (a) title->title: keep the minimal shape H4a's extractor reads (title +
            //     redirect only -- never the wikitext body, so memory stays bounded);
            //     the extractor is called ONCE over the whole window below so its
            //     native last-write-wins semantics apply, verbatim.
            $redirectPages[] = ['title' => (string) $page['title'], 'redirect' => $target];

            // (b) slug-keyed: EXACTLY Pass A's derivation + upsert grouping.
            $canonical = avesmapsWikiDumpCanonicalWikiKeyForTitle($target);
            if ($canonical !== '') {
                $slugTitlesByCanonical[$canonical][] = (string) $page['title'];
            }
        }

        if ($pagesScanned >= AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET || microtime(true) >= $deadline) {
            $streamExhausted = false;
            break;
        }
    }

    // Persist this window's title->title aliases (new table) + slug aliases (reused
    // Pass A upsert, verbatim). H4a's extractor runs over the whole window at once
    // so a duplicate alias within the window resolves last-write-wins as documented.
    $titleAliasBatch = avesmapsWikiDumpCollectRedirectTitleAliases($redirectPages);
    $titleAliasesWritten = avesmapsWikiDumpHybridPersistTitleAliases($pdo, $runId, $titleAliasBatch);

    $slugAliasesWritten = 0;
    foreach ($slugTitlesByCanonical as $canonicalWikiKey => $titles) {
        avesmapsWikiSyncMonitorStoreAlias($pdo, $titles, (string) $canonicalWikiKey);
        $slugAliasesWritten++;
    }

    $done = $streamExhausted;
    $nextCursor = max(0, $cursor) + $pagesScanned;

    return [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $nextCursor,
        'pages_scanned' => $pagesScanned,
        'title_aliases_written' => $titleAliasesWritten,
        'slug_aliases_written' => $slugAliasesWritten,
    ];
}

// ===========================================================================
// 4. Run creation + a thin title-list accessor for the continent phase.
// ===========================================================================

/**
 * Create a new dump_read run in wiki_sync_runs, seeded at the first work phase.
 * Reuses avesmapsWikiSyncEnsureCoreTables + the same wiki_sync_runs row the
 * online crawler uses (a DIFFERENT sync_type, so the two flows never collide).
 * progress_total = the number of work phases. Returns the run's public_id.
 *
 * @return array{ok:bool, run:array<string,mixed>}
 */
function avesmapsWikiDumpHybridStartRun(PDO $pdo, ?int $createdBy = null): array
{
    avesmapsWikiSyncEnsureCoreTables($pdo);

    $publicId = avesmapsWikiSyncUuidV4();
    $order = avesmapsWikiDumpHybridPhaseOrder();

    $statement = $pdo->prepare(
        'INSERT INTO wiki_sync_runs
            (public_id, sync_type, status, phase, progress_current, progress_total, message, stats_json, created_by)
        VALUES
            (:public_id, :sync_type, :status, :phase, 0, :progress_total, :message, :stats_json, :created_by)'
    );
    $statement->execute([
        'public_id' => $publicId,
        'sync_type' => AVESMAPS_WIKI_DUMP_READ_SYNC_TYPE,
        'status' => 'running',
        'phase' => AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP,
        'progress_total' => count($order),
        'message' => avesmapsWikiDumpHybridPhaseMessage(AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP, false),
        'stats_json' => avesmapsWikiSyncEncodeJson([]),
        'created_by' => $createdBy,
    ]);

    return [
        'ok' => true,
        'run' => avesmapsWikiDumpHybridPublicRun(avesmapsWikiSyncFetchRunByPublicId($pdo, $publicId)),
    ];
}

/**
 * The union of wanted titles for a run = every state-table row's normalized
 * title (the class + building fills established these rows; their existence IS
 * the wanted-set, per design §3). This is the $titles list the continent phase
 * feeds H1's resumable continent builder -- rebuilt fresh each continent step
 * from a bounded read, never held resident in stats_json (anti-bloat). ORDER BY
 * id so the offset cursor is STABLE across steps (H1's continent cursor is a
 * title-list offset).
 *
 * @return list<string>
 */
function avesmapsWikiDumpHybridFetchWantedTitles(PDO $pdo, int $runId): array
{
    avesmapsWikiDumpHybridEnsureStateTable($pdo);

    $statement = $pdo->prepare(
        'SELECT normalized_title FROM wiki_dump_hybrid_state WHERE run_id = :run_id ORDER BY id'
    );
    $statement->execute(['run_id' => $runId]);

    $titles = [];
    while (($title = $statement->fetchColumn()) !== false) {
        $titles[] = (string) $title;
    }

    return $titles;
}

/**
 * A dump_read-shaped public run projection. avesmapsWikiSyncPublicRun()
 * hardcodes the online-crawl stats keys (settlement_title_count etc.), which are
 * meaningless for dump_read; this projection returns the phase, progress, and
 * the dump_read cursors/counters the frontend (H4c-f) actually renders. The
 * per-request actions ALSO return an explicit {phase, cursor, done, progress}
 * envelope (the brief's contract); this projection is the run-row mirror.
 *
 * @param array<string, mixed> $run a wiki_sync_runs row
 * @return array<string, mixed>
 */
function avesmapsWikiDumpHybridPublicRun(array $run): array
{
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    $phase = (string) ($run['phase'] ?? '');
    $cursorKeys = avesmapsWikiDumpHybridResumableCursorKeys();

    return [
        'id' => (string) $run['public_id'],
        'public_id' => (string) $run['public_id'],
        'sync_type' => (string) ($run['sync_type'] ?? ''),
        'status' => (string) $run['status'],
        'phase' => $phase,
        'progress_current' => (int) $run['progress_current'],
        'progress_total' => (int) $run['progress_total'],
        'message' => (string) ($run['message'] ?? ''),
        'created_at' => (string) ($run['created_at'] ?? ''),
        'updated_at' => (string) ($run['updated_at'] ?? ''),
        'completed_at' => (string) ($run['completed_at'] ?? ''),
        'cursor' => isset($cursorKeys[$phase]) ? (int) ($stats[$cursorKeys[$phase]] ?? 0) : 0,
        'cursors' => [
            'continent_cursor' => (int) ($stats['continent_cursor'] ?? 0),
            'dump_cursor' => (int) ($stats['dump_cursor'] ?? 0),
            'wikitext_cursor' => (int) ($stats['wikitext_cursor'] ?? 0),
            'parse_cursor' => (int) ($stats['parse_cursor'] ?? 0),
        ],
    ];
}

// ===========================================================================
// 5. The read_step DISPATCH driver (calls the real -- or injected -- step fns).
// ===========================================================================

/**
 * Run ONE bounded step of the CURRENT phase of a dump_read run, then persist the
 * next state. This is the engine behind BOTH the read_step action (dryRun=TRUE
 * on phase 6) and the apply action (dryRun=FALSE on phase 6) -- the SOLE
 * difference between them is the $dryRun flag threaded into the parse_and_upsert
 * phase. Every other phase behaves identically in both actions (they are all
 * sandbox-safe), so an `apply` call that arrives while the run is still in an
 * earlier phase simply advances that earlier phase (harmless) -- but in practice
 * the frontend only issues `apply` once read_step has driven the run to phase 6.
 *
 * DISPATCH: for the current phase it calls the matching real H1/H4a/H4b step fn
 * (or an INJECTED fake from $stepFns, keyed by phase -- the unit-test seam,
 * mirroring H4a/H4b's injected-fn tests), gets a step result {done, nextCursor,
 * ...}, threads it through the PURE avesmapsWikiDumpHybridComputeNextState(), and
 * persists via the reused avesmapsWikiSyncUpdateRun(). One step per call; the
 * frontend loops.
 *
 * THE GATE: this function NEVER decides dryRun on its own -- the caller passes it
 * ($dryRun=true for read_step, false for apply). The parse_and_upsert dispatch
 * is the ONLY place $dryRun is consumed; every earlier phase ignores it. So a
 * read_step call is structurally incapable of a sharp write (it always passes
 * dryRun=true), and the sharp write happens ONLY on the apply path.
 *
 * @param PDO                          $pdo
 * @param string                       $runPublicId the dump_read run's public_id
 * @param string                       $dumpPath    resolved local dump path (for the dump-walking phases)
 * @param bool                         $dryRun      threaded into parse_and_upsert ONLY: true=read_step, false=apply(sharp)
 * @param array<string, callable>|null $stepFns     test seam: phase => fake step fn(pdo, ctx) => result; null = real dispatch
 * @return array{ok:bool, run:array<string,mixed>, phase:string, cursor:int, done:bool, progress:array<string,mixed>, step?:array<string,mixed>}
 */
function avesmapsWikiDumpHybridAdvanceReadStep(
    PDO $pdo,
    string $runPublicId,
    string $dumpPath,
    bool $dryRun = true,
    ?array $stepFns = null
): array {
    avesmapsWikiSyncRelaxLimits();

    $run = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);

    // Idempotent terminal: a completed run just echoes its final state.
    if ((string) $run['status'] === 'completed' || (string) $run['phase'] === AVESMAPS_WIKI_DUMP_PHASE_COMPLETED) {
        $public = avesmapsWikiDumpHybridPublicRun($run);
        return [
            'ok' => true,
            'run' => $public,
            'phase' => AVESMAPS_WIKI_DUMP_PHASE_COMPLETED,
            'cursor' => 0,
            'done' => true,
            'progress' => avesmapsWikiDumpHybridProgressEnvelope($public, null),
        ];
    }

    if ((string) $run['status'] !== 'running') {
        throw new RuntimeException('Dieser Dump-Read-Lauf ist nicht aktiv.');
    }

    $runId = (int) $run['id'];
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    $phase = (string) $run['phase'];

    // Run one bounded step of the current phase (real dispatch, or an injected fake).
    $stepResult = avesmapsWikiDumpHybridDispatchPhaseStep(
        $pdo,
        $phase,
        $runId,
        $stats,
        $dumpPath,
        $dryRun,
        $stepFns
    );

    // Additive persistence seam: a phase step may carry EXTRA run-scoped sub-state / counters
    // (beyond its single cursor key) by returning a 'stats_patch' map, merged into $stats BEFORE
    // the pure transition below so it lands in stats_json. No pre-Task-4 step returns this key,
    // so every other phase is byte-for-byte unchanged. Used by publication_sources for its
    // stage marker + reconcile sub-cursor + {publications, entity_refs, links_*, no_link} counters.
    if (isset($stepResult['stats_patch']) && is_array($stepResult['stats_patch'])) {
        foreach ($stepResult['stats_patch'] as $patchKey => $patchValue) {
            $stats[(string) $patchKey] = $patchValue;
        }
    }

    // PURE transition -> next persisted state.
    $next = avesmapsWikiDumpHybridComputeNextState($phase, $stats, $stepResult);
    $message = avesmapsWikiDumpHybridPhaseMessage($next['phase'], $next['done']);

    avesmapsWikiSyncUpdateRun(
        $pdo,
        $runId,
        $next['status'],
        $next['phase'],
        $next['progress_current'],
        $message,
        $next['stats']
    );
    if ($next['done']) {
        $pdo->prepare('UPDATE wiki_sync_runs SET completed_at = CURRENT_TIMESTAMP(3) WHERE id = :id')
            ->execute(['id' => $runId]);
    }

    $updatedRun = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
    $public = avesmapsWikiDumpHybridPublicRun($updatedRun);

    $cursorKeys = avesmapsWikiDumpHybridResumableCursorKeys();
    // The cursor of the phase that JUST RAN (so a caller sees this step's progress).
    $ranCursor = isset($cursorKeys[$phase]) ? (int) ($next['stats'][$cursorKeys[$phase]] ?? 0) : 0;

    return [
        'ok' => true,
        'run' => $public,
        'phase' => $public['phase'],
        'cursor' => $ranCursor,
        'done' => (bool) $next['done'],
        'progress' => avesmapsWikiDumpHybridProgressEnvelope($public, $stepResult),
        'step' => $stepResult,
    ];
}

/**
 * Dispatch ONE step of $phase to its real H1/H4a/H4b step fn -- or to an injected
 * fake ($stepFns[$phase], the unit-test seam). A fake receives ($pdo, $ctx) where
 * $ctx carries the phase inputs (runId, cursor, dumpPath, dryRun, titles) and
 * returns a step-result array with at least 'done' (+ 'nextCursor' for resumable
 * phases). The real branch below wires each phase to the exact H-task fn.
 *
 * @param array<string, mixed>         $stats
 * @param array<string, callable>|null $stepFns
 * @return array<string, mixed> the step result (needs 'done'; resumable phases also 'nextCursor')
 */
function avesmapsWikiDumpHybridDispatchPhaseStep(
    PDO $pdo,
    string $phase,
    int $runId,
    array $stats,
    string $dumpPath,
    bool $dryRun,
    ?array $stepFns
): array {
    $cursorKeys = avesmapsWikiDumpHybridResumableCursorKeys();
    $cursor = isset($cursorKeys[$phase]) ? (int) ($stats[$cursorKeys[$phase]] ?? 0) : 0;

    // Test seam: an injected fake for this phase short-circuits the real step fn.
    if ($stepFns !== null && isset($stepFns[$phase]) && is_callable($stepFns[$phase])) {
        return (array) ($stepFns[$phase])($pdo, [
            'runId' => $runId,
            'cursor' => $cursor,
            'dumpPath' => $dumpPath,
            'dryRun' => $dryRun,
            'stats' => $stats,
        ]);
    }

    switch ($phase) {
        case AVESMAPS_WIKI_DUMP_PHASE_CLASS_MAP:
            $r = avesmapsWikiDumpHybridFillClassMap($pdo, $runId);
            return ['done' => true, 'written' => (int) ($r['written'] ?? 0), 'title_count' => count($r['titles'] ?? [])];

        case AVESMAPS_WIKI_DUMP_PHASE_BUILDING_MAP:
            $r = avesmapsWikiDumpHybridFillBuildingMap($pdo, $runId);
            return ['done' => true, 'written' => (int) ($r['written'] ?? 0), 'title_count' => count($r['titles'] ?? [])];

        case AVESMAPS_WIKI_DUMP_PHASE_CONTINENT_MAP:
            $titles = avesmapsWikiDumpHybridFetchWantedTitles($pdo, $runId);
            // PERF FIX: an explicit per-step call budget (see the constant's docblock
            // above) so this phase is bounded like every other resumable phase --
            // NOT the ~4.5-minute single-step "process everything" default of null.
            $r = avesmapsWikiDumpHybridFillContinentMapStep($pdo, $runId, $titles, $cursor, AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'written' => (int) ($r['written'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_REDIRECT_ALIASES:
            $r = avesmapsWikiDumpHybridRedirectAliasStep($pdo, $dumpPath, $runId, $cursor);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'pages_scanned' => (int) ($r['pages_scanned'] ?? 0),
                'title_aliases_written' => (int) ($r['title_aliases_written'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_WIKITEXT_COLLECT:
            $aliasMap = avesmapsWikiDumpHybridLoadTitleAliases($pdo, $runId);
            $r = avesmapsWikiDumpHybridWikitextCollectStep(
                $pdo,
                $dumpPath,
                $runId,
                $cursor,
                $cursor, // stepIndex: use the page cursor as a monotonic-ish log tag
                null,
                null,
                $aliasMap
            );
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'pages_scanned' => (int) ($r['pages_scanned'] ?? 0),
                'found_this_step' => (int) ($r['found_this_step'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_PARSE_AND_UPSERT:
            // THE GATE: $dryRun is true for read_step (sandbox), false for apply
            // (the sole sharp write). This is the ONLY phase that consumes $dryRun.
            $r = avesmapsWikiDumpHybridParseUpsertStep($pdo, $runId, $cursor, $dryRun);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'processed_this_step' => (int) ($r['processed_this_step'] ?? 0),
                'kept' => (int) ($r['kept'] ?? 0),
                'dry_run' => (bool) ($r['dry_run'] ?? $dryRun),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_PUBLICATION_SOURCES:
            // Build the publication catalog + entity refs from the dump (sandbox staging), then --
            // ONLY when $dryRun is false (the sharp apply path, mirroring parse_and_upsert) --
            // reconcile them into production feature_sources. Under read_step ($dryRun=true) the
            // phase completes after the refs sub-stage, so the dry scan writes NOTHING sharp.
            // userId=0 -> NULL created_by (a system-driven sync). Extra sub-state + counters are
            // carried back to stats_json via 'stats_patch'.
            $r = avesmapsPublicationSyncPhaseStep($pdo, $runId, $stats, $dumpPath, $dryRun, 0);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'stats_patch' => is_array($r['stats_patch'] ?? null) ? $r['stats_patch'] : [],
                'stage' => (string) ($r['stage'] ?? ''),
                'publications' => (int) ($r['publications'] ?? 0),
                'entity_refs' => (int) ($r['entity_refs'] ?? 0),
                'links_added' => (int) ($r['links_added'] ?? 0),
                'links_removed' => (int) ($r['links_removed'] ?? 0),
                'links_updated' => (int) ($r['links_updated'] ?? 0),
                'no_link' => (int) ($r['no_link'] ?? 0),
                'processed_this_step' => (int) ($r['processed_this_step'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES:
            // Build the adventure catalog + ordered place staging from the dump (STAGING ONLY, both
            // read_step and apply -- there is no sharp adventure write here; the owner's
            // sync_adventures action reconciles staging into the live tables). Same dump-page cursor
            // contract as the publication catalog build.
            $r = avesmapsAdventureBuildCatalogStep($pdo, $dumpPath, $cursor);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'pages_scanned' => (int) ($r['pages_scanned'] ?? 0),
                'found_this_step' => (int) ($r['found_this_step'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_CITYMAPS:
            // Build the citymap catalog from the two index pages (STAGING ONLY, both read_step and
            // apply -- the owner's sync_citymaps action does the sharp write). Same dump-page cursor
            // contract as the adventure/publication catalog builds.
            $r = avesmapsCitymapBuildCatalogStep($pdo, $dumpPath, $cursor);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'pages_scanned' => (int) ($r['pages_scanned'] ?? 0),
                'found_this_step' => (int) ($r['found_this_step'] ?? 0),
                // Surfaces whether the REAL dump escapes apostrophes the way the API does (13) or not
                // (0). The dump is basic-auth + server-only, so this run is the first chance to know.
                'escaped_names_seen' => (int) ($r['escaped_names_seen'] ?? 0),
            ];

        case AVESMAPS_WIKI_DUMP_PHASE_LORE:
            // Build the lore catalog + place/source staging from the four lore infoboxes
            // (STAGING ONLY, both read_step and apply -- the owner's sync_lore action does the
            // sharp write). Same dump-page cursor contract as the adventure/citymap builds.
            $r = avesmapsLoreBuildCatalogStep($pdo, $dumpPath, $cursor);
            return [
                'done' => (bool) ($r['done'] ?? false),
                'nextCursor' => (int) ($r['nextCursor'] ?? $cursor),
                'pages_scanned' => (int) ($r['pages_scanned'] ?? 0),
                'found_this_step' => (int) ($r['found_this_step'] ?? 0),
            ];

        default:
            throw new RuntimeException('Die Dump-Read-Phase ist unbekannt: ' . $phase);
    }
}

/**
 * PURE: the {phase, cursor, done, progress:{...}} progress envelope the brief's
 * action contract returns, merging the run projection with the just-run step
 * result's per-phase counters (pages_scanned / found / written / processed /
 * kept) so the frontend can render live per-step numbers.
 *
 * @param array<string, mixed>      $public    avesmapsWikiDumpHybridPublicRun() output
 * @param array<string, mixed>|null $stepResult the step fn's return, or null for a terminal echo
 * @return array<string, mixed>
 */
function avesmapsWikiDumpHybridProgressEnvelope(array $public, ?array $stepResult): array
{
    $progress = [
        'phase' => (string) ($public['phase'] ?? ''),
        'progress_current' => (int) ($public['progress_current'] ?? 0),
        'progress_total' => (int) ($public['progress_total'] ?? 0),
        'cursors' => $public['cursors'] ?? [],
    ];

    if (is_array($stepResult)) {
        foreach ([
            'pages_scanned', 'found_this_step', 'written', 'processed_this_step', 'kept', 'title_count',
            'title_aliases_written', 'dry_run',
            // publication_sources counters (Task 4): run totals surfaced per step.
            'stage', 'publications', 'entity_refs', 'links_added', 'links_removed', 'links_updated', 'no_link',
            // citymaps: how many escaped names (Al\'Anfa) the REAL dump carried -- the one question
            // the API could not answer before this code existed.
            'escaped_names_seen',
        ] as $key) {
            if (array_key_exists($key, $stepResult)) {
                $progress[$key] = $stepResult[$key];
            }
        }
    }

    return $progress;
}

// ===========================================================================
// 6. Sandbox cleanup ("Dump holen" seam): keep exactly ONE dump_read run's
//    sandbox state after a successful scan.
// ===========================================================================

/**
 * "Dump holen" (fetch -> scan -> cleanup) button seam: after a dump_read run
 * has SUCCESSFULLY completed its sandbox read, delete every OTHER dump_read
 * run's rows from `wiki_dump_hybrid_state` and `wiki_dump_title_alias`, so
 * exactly one run's sandbox state remains -- the owner's "immer genau ein
 * Dump drin" requirement. This is invoked as a SEPARATE `cleanup_state`
 * action from the frontend, once the read_step loop reports done -- NOT
 * folded into avesmapsWikiDumpHybridAdvanceReadStep()/-ComputeNextState(),
 * because that engine is also reused BY THE SHARP `apply` ACTION (same
 * dispatch/transition fns, only $dryRun differs -- see the driver's own
 * "THE GATE" docblock above); embedding a DELETE into a phase transition
 * both of those actions share would risk firing cleanup on the apply path
 * too, which is explicitly out of scope for this task (apply/parse_and_upsert
 * are untouched). A distinct action also mirrors how fetch_dump / start_read
 * / read_step / apply are already separate actions in api/edit/wiki/dump.php.
 *
 * SAFETY (the only new destructive op this task adds):
 *   - Only ever considers rows for `sync_type = 'dump_read'` runs (never
 *     touches the online WikiSync crawler's `location`-type run rows, even
 *     though the two tables this fn deletes from are dump_read-only anyway).
 *   - The KEPT run is always the newest run with `status = 'completed'`
 *     (ORDER BY completed_at DESC, id DESC) -- never the run that just
 *     asked for cleanup by id, so a caller cannot accidentally pass the
 *     wrong id and wipe the run it meant to keep; the kept run is always
 *     re-derived from "what actually finished most recently".
 *   - If NO dump_read run has ever reached status = 'completed' (e.g. only
 *     an in-progress or failed run exists), there is nothing to keep ->
 *     the function is a strict no-op (0 rows deleted, kept_run_id = null).
 *     This is what makes it structurally incapable of wiping an
 *     in-progress-only state: DELETE ... WHERE run_id IN (<dump_read ids>)
 *     AND run_id != <kept id> only ever executes once a kept id is known.
 *   - If exactly one dump_read run exists (whether completed or not), that
 *     run -- if completed -- becomes the kept run and the "delete others"
 *     set is empty, so nothing is deleted.
 *   - The "delete others" set additionally excludes any run with
 *     `status = 'running'` (a concurrent in-progress dump_read run), even
 *     though such a run is never the kept one either -- this is what stops
 *     cleanup from deleting a second run's sandbox state out from under it
 *     while that run is still mid-scan.
 *   - Wrapped in a transaction; every value is bound via prepared
 *     statements (never string-interpolated).
 *
 * @return array{kept_run_id: ?int, deleted_state_rows: int, deleted_alias_rows: int}
 */
function avesmapsWikiDumpHybridCleanupOldSandboxState(PDO $pdo): array
{
    avesmapsWikiDumpHybridEnsureStateTable($pdo);
    avesmapsWikiDumpHybridEnsureTitleAliasTable($pdo);

    $pdo->beginTransaction();
    try {
        // The run to KEEP: the newest COMPLETED dump_read run, always re-derived here
        // (never trusted from a caller-supplied id) so this function can never keep
        // the wrong run. FOR UPDATE serializes concurrent cleanup calls against the
        // same completed-run set.
        $keepStatement = $pdo->prepare(
            "SELECT id FROM wiki_sync_runs
             WHERE sync_type = :sync_type AND status = 'completed'
             ORDER BY completed_at DESC, id DESC
             LIMIT 1
             FOR UPDATE"
        );
        $keepStatement->execute(['sync_type' => AVESMAPS_WIKI_DUMP_READ_SYNC_TYPE]);
        $keepRunId = $keepStatement->fetchColumn();

        // No completed run at all -> nothing is safe to call "the kept dump", so
        // there is nothing to clean up either. Never deletes an in-progress-only
        // (or failed-only) run's sandbox state.
        if ($keepRunId === false || $keepRunId === null) {
            $pdo->commit();
            return ['kept_run_id' => null, 'deleted_state_rows' => 0, 'deleted_alias_rows' => 0];
        }
        $keepRunId = (int) $keepRunId;

        // Every OTHER TERMINAL (non-'running') dump_read run's id -- the deletion scope.
        // Scoped to sync_type = 'dump_read' so this can never reach a `location`-type
        // wiki_sync_runs row (though the two target tables are dump_read-only anyway).
        // Excluding status = 'running' is the concurrency guard: without it, a SECOND
        // dump_read run that is still mid-scan (status still 'running') when this
        // cleanup fires would land in the delete set purely because it isn't the kept
        // id, and its wiki_dump_hybrid_state / wiki_dump_title_alias rows would be
        // deleted out from under that in-flight scan. This tool has a single owner (low
        // likelihood), but the guard is cheap and matches the "never wipe an
        // in-progress run" invariant already documented above for the
        // no-completed-run case.
        $otherRunsStatement = $pdo->prepare(
            "SELECT id FROM wiki_sync_runs WHERE sync_type = :sync_type AND id != :keep_run_id AND status != 'running'"
        );
        $otherRunsStatement->execute([
            'sync_type' => AVESMAPS_WIKI_DUMP_READ_SYNC_TYPE,
            'keep_run_id' => $keepRunId,
        ]);
        $otherRunIds = array_map('intval', $otherRunsStatement->fetchAll(PDO::FETCH_COLUMN));

        if ($otherRunIds === []) {
            // Exactly one dump_read run exists (this one) -> nothing to delete.
            $pdo->commit();
            return ['kept_run_id' => $keepRunId, 'deleted_state_rows' => 0, 'deleted_alias_rows' => 0];
        }

        $placeholders = implode(',', array_fill(0, count($otherRunIds), '?'));

        $deleteState = $pdo->prepare("DELETE FROM wiki_dump_hybrid_state WHERE run_id IN ({$placeholders})");
        $deleteState->execute($otherRunIds);
        $deletedStateRows = $deleteState->rowCount();

        $deleteAlias = $pdo->prepare("DELETE FROM wiki_dump_title_alias WHERE run_id IN ({$placeholders})");
        $deleteAlias->execute($otherRunIds);
        $deletedAliasRows = $deleteAlias->rowCount();

        $pdo->commit();

        return [
            'kept_run_id' => $keepRunId,
            'deleted_state_rows' => $deletedStateRows,
            'deleted_alias_rows' => $deletedAliasRows,
        ];
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}
