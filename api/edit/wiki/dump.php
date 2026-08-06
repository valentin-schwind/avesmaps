<?php

declare(strict_types=1);

/**
 * WikiDump control endpoint (procurement + hybrid read_step orchestration).
 * ---------------------------------------------------------------------------
 * Capability-gated ('edit') control surface for the offline Wiki Aventurica
 * dump. Procurement delegates to api/_internal/wiki/dump-fetch.php; the hybrid
 * read pass is driven by api/_internal/wiki/dump-hybrid-driver.php (which loops
 * the H1/H4a/H4b step fns over the sandbox state table).
 *
 *   POST { "action": "fetch_dump", "force_refresh"?: bool }
 *        -> downloads (or serves the <24h cached) .bz2. On 401 returns
 *           { ok:false, error:{ code:"dump_unauthorized" } } so the panel can
 *           prompt for fresh credentials.
 *   POST { "action": "set_dump_credentials", "username": "...", "password": "..." }
 *        -> stores the last-working credential pair. The password is write-only:
 *           it is accepted here but NEVER returned by any action.
 *   POST { "action": "start_read" }
 *        -> creates a dump_read run (the 7-phase state-machine row) and returns
 *           { run }. The frontend then loops read_step against run.public_id.
 *   POST { "action": "read_step", "run_id": "<public_id>" }
 *        -> runs ONE bounded step of the current phase and returns
 *           { run, phase, cursor, done, progress }. SANDBOX-SAFE: phases 1-5
 *           write only the state/alias tables; phase 6 (parse_and_upsert) runs
 *           dryRun=TRUE -> NOTHING sharp. Auto-fetches the dump if absent.
 *   POST { "action": "apply", "run_id": "<public_id>" }
 *        -> THE SHARP PATH: runs the parse_and_upsert phase with dryRun=FALSE
 *           (the sole real *_staging write). A SEPARATE action the owner triggers
 *           ONLY after the H5 compare-test is green (progress.md GATE WIRING).
 *   POST { "action": "sync_kind", "kind": "path"|"region"|"settlement"|"territory",
 *          "cursor"?: int, "phase"?: "staging"|"conflict_gen", "conflict_cursor"?: int }
 *        -> WAVE 1 "Syncen": reads the newest COMPLETED dump_read run's sandbox
 *           rows FILTERED to `kind` and upserts them into the matching STAGING
 *           table via the SAME per-kind upserts the sharp apply path uses (so a
 *           settlement->territory promotion still dual-writes). Client-loopable
 *           like read_step; returns
 *           { run, kind, phase, cursor, conflict_cursor, done, progress:{processed,total} }.
 *           kind=settlement runs in TWO client-driven phases: a STAGING phase, then
 *           a CONFLICT_GEN phase that CHUNKS the sharp settlement-conflict
 *           classifier across steps by a map-place id cursor (so the O(n*m) fuzzy
 *           match never runs one-shot -- that hung STRATO). The frontend advances
 *           `cursor` in the staging phase and `conflict_cursor` in the conflict_gen
 *           phase; when staging drains, the response flips phase to 'conflict_gen'
 *           (done stays false, lock stays HELD) until conflict-gen finalizes
 *           (post_actions.settlement_cases:{stored,run_id,by_type}). kind=territory
 *           rebuilds wiki_territory_model ONCE on staging-drain (preserving
 *           parent_locked/overrides). STAGING-ONLY (+ model / wiki_sync_cases +
 *           the tiny conflict-gen accumulator table): never map_features, never
 *           live political_territory. Holds the pipeline lock; releases on done.
 *   POST { "action": "sync_publications", "segment"?: int, "cursor"?: int }
 *        -> COMPUTES what the wiki publication sources built by "Dump holen" would do to
 *           feature_sources and writes it as an Übernahme-Vorschau plan (sync_plan_item).
 *           🔴 SINCE 2026-08-06 IT WRITES NO SOURCE ROW: the editor ticks what may happen
 *           and api/edit/wiki/sync-plan.php ('apply') writes it. Mirrors sync_kind (same
 *           'edit' gate, same pipeline lock, same client-loop) and does NOT reopen the dump
 *           -- avesmapsPublicationPlanStep reads the STAGING tables
 *           (wiki_publication_catalog / wiki_entity_publication) + the live
 *           feature_sources/map_features/political_territory/lore_entry and runs the SAME
 *           override-safe diff the writer runs. Client-loopable; resumable via (segment, id
 *           high-water); returns { stage:'plan', segment, cursor, done, run_id, planned,
 *           counts, skipped_types, no_link, processed, progress }. Holds the pipeline lock
 *           (a second run would replace the open plan); releases on done.
 *   POST { "action": "cleanup_state" }
 *        -> "Dump holen" step 3/3: deletes every dump_read run's sandbox rows
 *           from wiki_dump_hybrid_state/wiki_dump_title_alias EXCEPT the newest
 *           COMPLETED run's, so exactly one dump's sandbox state remains. Called
 *           by the frontend ONLY after its read_step loop reports done. No-op
 *           (deletes nothing) if no dump_read run has ever completed. See
 *           avesmapsWikiDumpHybridCleanupOldSandboxState() for the exact guard.
 *   GET  ?action=status
 *        -> { present, size, age_seconds, last_fetch_at, last_ok_at, username, url }.
 *           Never includes the password.
 *   GET  ?action=last_synced
 *        -> { synced: { settlement, path, region, territory } }, each a MySQL
 *           DATETIME string or null. READ-ONLY (no lock, no writes): backs the
 *           per-tab "Zuletzt gesynct: <date>" labels on panel load/reload, since
 *           those previously only ever came from a fresh sync_kind response and
 *           went blank again after a reload. See
 *           avesmapsWikiDumpSyncKindLastSynced() for the exact source per kind.
 *
 * THE GATE: read_step is dryRun/sandbox-safe; apply is the sole sharp writer and
 * a DISTINCT action. They are never folded together -- the only difference is the
 * $dryRun flag threaded into the parse_and_upsert phase by the shared driver.
 * cleanup_state is a THIRD, independent action: it never touches parse_and_upsert,
 * staging, or live tables -- it only prunes the sandbox/alias tables read_step
 * itself writes, keeping just the most recently completed run's rows.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/wiki/dump-fetch.php';

// The read_step/apply orchestration (H4c-b) drives the H1/H4a/H4b step fns, which
// need the full wiki parse chain (the SAME chain dump-hybrid-read.php documents).
require __DIR__ . '/../../_internal/political/territory.php';
require __DIR__ . '/../../_internal/wiki/sync.php';
// Cross-cutting WikiSync constants (fuzzy cutoff, sync-type tag, DereGlobus/
// Positionskarte coordinate-transform matrices) that were previously declared
// ONLY inside the api/edit/wiki/sync.php ENDPOINT file (never required here).
// The settlement conflict-generation phase below (dump-sync-kind.php ->
// locations-helpers.php) reads them -> live "Undefined constant" fatal ->
// caught -> HTTP 500. See sync-constants.php's docblock.
require __DIR__ . '/../../_internal/wiki/sync-constants.php';
require __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require __DIR__ . '/../../_internal/wiki/territories-tree.php';
require __DIR__ . '/../../_internal/wiki/territories-parsing.php';
require __DIR__ . '/../../_internal/wiki/territories.php';
require __DIR__ . '/../../_internal/wiki/paths.php';
require __DIR__ . '/../../_internal/wiki/powerlines.php';
// The powerline reconcile writes map_features rows, so it needs the map helpers
// (avesmapsNextMapRevision / avesmapsEncodeJson). Function definitions only, no side effects
// on include, and its own require (path-naming.php) is already loaded above via paths.php.
require_once __DIR__ . '/../../_internal/map/features.php';
require __DIR__ . '/../../_internal/wiki/regions.php';
require __DIR__ . '/../../_internal/wiki/locations.php';
require __DIR__ . '/../../_internal/wiki/settlements.php';
require __DIR__ . '/../../_internal/wiki/dump-reader.php';
require __DIR__ . '/../../_internal/wiki/dump-category-layer.php';
require __DIR__ . '/../../_internal/wiki/dump-entity-scan.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-state.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-read.php';
require __DIR__ . '/../../_internal/wiki/dump-hybrid-driver.php';
// Per-kind "Syncen" step + SHARP settlement-conflict generation (Wave 1). Reads
// the newest completed dump_read run's sandbox rows FILTERED to one kind and
// re-upserts them via the SAME per-kind upserts the sharp apply path uses;
// settlements ALSO get their conflict cases written. STAGING-only (+ territory
// model / wiki_sync_cases) -- never map_features or live political_territory.
require __DIR__ . '/../../_internal/wiki/dump-sync-kind.php';
// Wiki-publication-sources sync (Task 4): the publication_sources phase's dispatch case (in
// dump-hybrid-driver.php) calls these -- the pure/DB reconcile library, the pure wikitext
// parsers it consumes, and the shared feature_sources catalog helpers the reconcile writes
// through. All three are function-definitions-only on include (no side effects).
require_once __DIR__ . '/../../_internal/app/feature-sources.php';
require_once __DIR__ . '/../../_internal/wiki/publication-parsing.php';
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';
// Abenteuer (Phase 4): the adventures build phase (dump-hybrid-driver.php) + the owner-triggered
// sync_adventures reconcile action below need the adventure staging/reconcile lib plus the live
// adventure tables + name resolver. adventure-resolve.php require_once-pulls adventures.php + the
// political lib (already loaded above); all three are function-definitions-only on include.
require_once __DIR__ . '/../../_internal/app/adventures.php';
require_once __DIR__ . '/../../_internal/app/adventure-resolve.php';
require_once __DIR__ . '/../../_internal/wiki/adventure-sync.php';
// Kartensammlung (stages 1+2): the citymaps build phase (dump-hybrid-driver.php) + the
// owner-triggered sync_citymaps reconcile below need the citymap staging/reconcile lib plus the live
// citymap tables. The place resolver is the SHARED avesmapsResolvePlacesInTable (adventure-resolve.php
// above, which already whitelists 'citymap_place') -- not a citymap-specific copy. All
// function-definitions-only on include.
require_once __DIR__ . '/../../_internal/app/citymaps.php';
// The Übernahme-Vorschau foundation (design 2026-08-06 §5): sync_citymaps below no longer writes, it
// computes a plan into sync_plan_item. citymap-sync.php calls into this file at RUNTIME, so a missing
// require here is a fatal in the middle of a sync -- which is exactly what the dependency assert in
// __tests__/citymap-sync-test.php exists to catch before a deploy does.
require_once __DIR__ . '/../../_internal/wiki/sync-plan.php';
require_once __DIR__ . '/../../_internal/wiki/citymap-sync.php';
// Flora/Fauna/Spezies/Handelswaren: the lore build phase (dump-hybrid-driver.php) + the
// owner-triggered sync_lore reconcile below. Function-definitions-only on include; the parser
// it pulls in (lore-parsing.php) is likewise side-effect-free.
require_once __DIR__ . '/../../_internal/wiki/lore-sync.php';
// Single-flight concurrency lock (DB-persisted): serializes the WHOLE dump
// pipeline (fetch_dump/start_read/read_step/apply/cleanup_state) so only ONE
// runs at a time across ALL editors. See avesmapsWikiDumpLock* in dump-lock.php.
require __DIR__ . '/../../_internal/wiki/dump-lock.php';

/**
 * Resolve the local dump path for the read_step/apply parser, auto-fetching the
 * dump (Task 5a's avesmapsWikiDumpFetch) if it is not already present. Returns
 * the path on success; on a fetch failure it sends the SAME error envelope
 * fetch_dump sends (dump_unauthorized on 401 so the panel can prompt for creds,
 * else dump_fetch_failed) and EXITS -- so callers may treat a return as "the
 * file is present". Endpoint-layer helper (it emits HTTP + exits); NOT part of
 * the include-safe driver lib.
 */
function avesmapsWikiDumpEnsureDumpPresentOrFail(PDO $pdo): string
{
    $path = avesmapsWikiDumpStoragePath();
    if (is_file($path)) {
        // ETAPPE 2: prefer the plain-xml speed cache when it is fresh; else the .bz2.
        return avesmapsWikiDumpPreferredReadPath();
    }

    $result = avesmapsWikiDumpFetch($pdo, false);
    if (($result['ok'] ?? false) === true && is_file($path)) {
        return avesmapsWikiDumpPreferredReadPath();
    }

    $code = (string) ($result['code'] ?? 'dump_fetch_failed');
    if ($code === 'dump_unauthorized') {
        avesmapsErrorResponse(
            401,
            'dump_unauthorized',
            'The dump server rejected the stored credentials (HTTP 401). Enter new credentials to continue.'
        );
    }

    avesmapsErrorResponse(
        502,
        'dump_fetch_failed',
        'The dump could not be downloaded from the wiki server.'
    );
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not use the dump endpoint.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    // Editor-only surface (same capability as the WikiSync editor endpoints).
    $currentUser = avesmapsRequireUserWithCapability('edit');
    // The lock holder identity is resolved from THIS auth/capability context (the
    // same context that gates every dump action), so "who holds the pipeline" is
    // always the acting editor. user_id is the re-entry key; username is display-only.
    $lockUserId = (int) ($currentUser['id'] ?? 0);
    $lockUsername = (string) ($currentUser['username'] ?? '');
    // Tracks whether THIS request currently holds the lock, so the outer catch can
    // release it on ANY throw in a mutating flow (holder-guarded release is a no-op
    // if a stale-takeover already reassigned it). GET/status never acquires.
    $lockHeldByThisRequest = false;

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'status'), 60);

        if ($action === 'last_synced') {
            // Read-only per-kind "Zuletzt gesynct" status (see
            // avesmapsWikiDumpSyncKindLastSynced's docblock for the source per
            // kind). Fills the panel's persistent labels on load/reload; never
            // acquires the pipeline lock and writes nothing.
            $lastSynced = avesmapsWikiDumpSyncKindLastSynced($pdo);
            avesmapsJsonResponse(200, ['ok' => true, 'synced' => $lastSynced]);
        }

        if ($action !== 'status') {
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown dump action for GET.');
        }

        $status = avesmapsWikiDumpStatus($pdo);
        avesmapsJsonResponse(200, ['ok' => true, 'status' => $status]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET and POST are allowed for the dump endpoint.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 60);

    switch ($action) {
        case 'fetch_dump':
            // Acquire the whole-pipeline lock: fetch_dump BEGINS the "Dump holen"
            // chain (fetch -> start_read -> read_step* -> cleanup_state). Held for
            // the whole chain (same-holder re-entry across the later actions); the
            // terminal cleanup_state releases it. A DIFFERENT live holder is rejected
            // here (WikiDumpLockBusyException -> 409), so a second editor cannot
            // start a competing fetch. NOT released on success below -- the chain
            // continues in the next request as the same holder.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'fetch_dump');
            $lockHeldByThisRequest = true;

            $forceRefresh = filter_var($payload['force_refresh'] ?? false, FILTER_VALIDATE_BOOLEAN);
            $result = avesmapsWikiDumpFetch($pdo, $forceRefresh);

            if (($result['ok'] ?? false) === true) {
                // ETAPPE 2: decompress the .bz2 to a plain .xml ONCE here. fetch_dump
                // already tolerates the multi-minute download, so this ~15-30 s job is
                // safe (not a bounded read_step). Best-effort: on failure every reader
                // falls back to the .bz2 (avesmapsWikiDumpPreferredReadPath).
                avesmapsWikiDumpEnsureDecompressedXml();
                avesmapsJsonResponse(200, [
                    'ok' => true,
                    'from_cache' => (bool) ($result['from_cache'] ?? false),
                    'size' => (int) ($result['size'] ?? 0),
                    'age_seconds' => (int) ($result['age_seconds'] ?? 0),
                ]);
            }

            // Distinguish the 401 credential-prompt signal from a generic failure.
            $code = (string) ($result['code'] ?? 'dump_fetch_failed');
            if ($code === 'dump_unauthorized') {
                avesmapsErrorResponse(
                    401,
                    'dump_unauthorized',
                    'The dump server rejected the stored credentials (HTTP 401). Enter new credentials to continue.'
                );
            }

            avesmapsErrorResponse(
                502,
                'dump_fetch_failed',
                'The dump could not be downloaded from the wiki server.'
            );
            // no break -- avesmapsErrorResponse exits.

        case 'set_dump_credentials':
            // Narrower than the endpoint's 'edit' gate: writing the SHARED credential
            // pair has blast radius (a bad pair makes every editor's fetch 401 until
            // fixed), and doc §5.0 specifies the dump-credential setting is admin-only.
            avesmapsRequireUserWithCapability('admin');
            $username = (string) ($payload['username'] ?? '');
            $password = (string) ($payload['password'] ?? '');
            try {
                avesmapsWikiDumpSetCredentials($pdo, $username, $password);
            } catch (InvalidArgumentException $exception) {
                avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
            }
            // Echo the stored username back for the prefill; NEVER the password.
            avesmapsJsonResponse(200, ['ok' => true, 'username' => trim($username)]);
            // no break -- avesmapsJsonResponse exits.

        case 'start_read':
            // Acquire the whole-pipeline lock BEFORE inserting a run row. Without this
            // the pre-lock bug is exactly here: every start_read used to INSERT a fresh
            // wiki_sync_runs row unconditionally, so two users each spawned a run. Now a
            // DIFFERENT live holder is rejected (409) and no second run is created. If
            // this same user already holds the lock (the "Dump holen" chain acquired it
            // in fetch_dump, or the apply chain is re-entering), this is a same-holder
            // re-entry no-op that just refreshes the heartbeat. Held across the loop;
            // the terminal action (cleanup_state / apply-done) releases.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'start_read');
            $lockHeldByThisRequest = true;

            // Create a new dump_read run (the 7-phase state machine's row). The
            // frontend (H4c-f) then loops read_step against the returned run_id.
            $startResult = avesmapsWikiDumpHybridStartRun($pdo, $lockUserId ?: null);
            // Record the run_id on the lock so a stale-takeover diagnostic / the busy
            // message can point at the exact wedged run.
            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'start_read', (string) ($startResult['run']['public_id'] ?? '') ?: null);
            avesmapsJsonResponse(200, ['ok' => true, 'run' => $startResult['run']]);
            // no break -- avesmapsJsonResponse exits.

        case 'read_step':
            // ONE bounded step of the hybrid read pass. SANDBOX-SAFE: phases 1-5
            // write only the state/alias tables; phase 6 runs dryRun=TRUE (nothing
            // sharp). If the dump file is absent, auto-fetch it first (Task 5a).
            $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
            // Acquire-or-throw on EVERY step: this is both the concurrency gate for the
            // (up-to-2000-request) loop AND the heartbeat that keeps a long legit read
            // from being judged stale. Same holder -> re-entry refresh; a DIFFERENT live
            // holder is rejected (409) so a second editor's loop stops after one step
            // instead of interleaving sandbox writes. NOT released on done -- the
            // "Dump holen" chain proceeds to cleanup_state as the same holder.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'read_step', $runPublicId);
            $lockHeldByThisRequest = true;
            $dumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $stepResult = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, true);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $stepResult['run'],
                'phase' => $stepResult['phase'],
                'cursor' => $stepResult['cursor'],
                'done' => $stepResult['done'],
                'progress' => $stepResult['progress'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'apply':
            // THE SHARP PATH (the ONLY real *_staging write). A SEPARATE action the
            // owner triggers ONLY after the H5 compare-test is green: it runs the
            // parse_and_upsert phase with dryRun=FALSE. Distinct from read_step by
            // design (progress.md "H4c GATE WIRING"). Same 'edit' gate as the other
            // dump write actions; one bounded step per call (the frontend loops).
            $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
            // The apply path is ALSO a client-driven loop, so it ALSO holds the lock:
            // acquire-or-throw on every apply step (heartbeat + concurrency gate). This
            // is the CRITICAL guard -- two concurrent applies are the worst hazard
            // (both ON DUPLICATE KEY UPDATE the run_id-less staging tables, silently
            // mixing two dump snapshots). A DIFFERENT live holder is rejected (409).
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'apply', $runPublicId);
            $lockHeldByThisRequest = true;
            $dumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $applyResult = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, false);
            // Terminal release: apply is the LAST action of the apply chain, so once its
            // state machine reports done, free the lock for the next editor. (read_step
            // deliberately does NOT release on done -- its chain continues to cleanup.)
            if (($applyResult['done'] ?? false) === true) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $applyResult['run'],
                'phase' => $applyResult['phase'],
                'cursor' => $applyResult['cursor'],
                'done' => $applyResult['done'],
                'progress' => $applyResult['progress'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_kind':
            // WAVE 1 per-kind "Syncen" step. Reads the newest COMPLETED dump_read
            // run's sandbox rows FILTERED to `kind` and upserts them into STAGING
            // via the SAME sharp per-kind upserts the apply path uses. Client-driven
            // loop, so it ALSO holds the lock: acquire-or-throw on every step
            // (heartbeat + concurrency gate). This is a REAL staging write, so a
            // second concurrent editor is rejected (409) -- two concurrent per-kind
            // syncs would ON DUPLICATE KEY UPDATE the run_id-less staging tables and
            // silently mix snapshots, the same hazard apply guards against.
            $syncKind = avesmapsNormalizeSingleLine((string) ($payload['kind'] ?? ''), 40);
            if (!in_array($syncKind, AVESMAPS_WIKI_DUMP_SYNC_KINDS, true)) {
                avesmapsErrorResponse(400, 'invalid_request', 'Unknown or missing sync kind (path|region|settlement|territory).');
            }
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_' . $syncKind);
            $lockHeldByThisRequest = true;

            // Resolve the sandbox run (newest completed dump_read run) + its int id.
            $syncRunId = avesmapsWikiDumpSyncKindResolveDumpRunId($pdo);
            $syncEntityKinds = avesmapsWikiDumpSyncKindEntityKinds($syncKind);

            // Two-phase for settlement: a STAGING phase (per-kind upserts, like every
            // kind) followed by a CONFLICT_GEN phase (the sharp classifier). The
            // conflict phase is CHUNKED across steps (a map-place id cursor) so the
            // O(n*m) fuzzy match never runs one-shot -- that one-shot was PHP-fatalling
            // on STRATO's max_execution_time and freezing the tab. Other kinds have no
            // conflict phase. The phase is threaded through the request payload.
            $syncPhase = avesmapsNormalizeSingleLine((string) ($payload['phase'] ?? 'staging'), 20);
            if ($syncPhase !== 'conflict_gen') {
                $syncPhase = 'staging';
            }

            // --- CONFLICT_GEN phase (settlement only): one chunked classifier step ---
            if ($syncPhase === 'conflict_gen' && $syncKind === 'settlement') {
                $conflictCursor = (int) ($payload['conflict_cursor'] ?? 0);
                $conflictStep = avesmapsWikiDumpSettlementConflictsGenerateStep(
                    $pdo,
                    null,
                    $lockUserId,
                    $conflictCursor
                );
                $conflictDone = ($conflictStep['done'] ?? false) === true;

                $syncPostActions = [];
                if ($conflictDone) {
                    // The finalize step reports its own by_type/stored for THAT step; the
                    // frontend note only needs a non-zero stored to confirm completion.
                    $syncPostActions['settlement_cases'] = [
                        'stored' => (int) ($conflictStep['stored'] ?? 0),
                        'run_id' => (int) ($conflictStep['run_id'] ?? 0),
                        'by_type' => $conflictStep['by_type'] ?? [],
                    ];
                }

                avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_' . $syncKind);
                if ($conflictDone) {
                    // Whole settlement sync chain (staging + conflict-gen) is done: stamp
                    // the location run the cases key to, so "Letzte Sync" (which reads the
                    // newest completed LOCATION run's completed_at, see
                    // avesmapsWikiDumpSyncKindLastSynced) reflects THIS sync rather than
                    // the first-ever one avesmapsWikiDumpSettlementCaseRunId reused.
                    $syncCompletedRunId = (int) ($conflictStep['run_id'] ?? 0);
                    if ($syncCompletedRunId > 0) {
                        $pdo->prepare('UPDATE wiki_sync_runs SET completed_at = CURRENT_TIMESTAMP(3) WHERE id = :id')
                            ->execute(['id' => $syncCompletedRunId]);
                    }

                    // Whole chain (staging + conflict-gen) done -> hand the lock back.
                    avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                    $lockHeldByThisRequest = false;
                }

                $conflictProgress = is_array($conflictStep['progress'] ?? null) ? $conflictStep['progress'] : [];
                $syncRunRow = avesmapsWikiDumpSyncKindFetchRunById($pdo, $syncRunId);
                avesmapsJsonResponse(200, [
                    'ok' => true,
                    'run' => $syncRunRow !== null ? avesmapsWikiSyncPublicRun($syncRunRow) : null,
                    'kind' => $syncKind,
                    'phase' => 'conflict_gen',
                    // Echo BOTH cursors so the loop keeps advancing the right one.
                    'cursor' => (int) ($payload['cursor'] ?? 0),
                    'conflict_cursor' => (int) ($conflictStep['cursor'] ?? $conflictCursor),
                    'done' => $conflictDone,
                    // Cases upserted by THIS step (the frontend sums these across the
                    // conflict-gen phase for the "+N Konfliktfaelle" note, since cases
                    // are written incrementally across steps, not all at the end).
                    'conflict_stored' => (int) ($conflictStep['stored'] ?? 0),
                    'progress' => [
                        'processed' => (int) ($conflictProgress['processed'] ?? 0),
                        'total' => (int) ($conflictProgress['total'] ?? 0),
                    ],
                    'post_actions' => $syncPostActions,
                ]);
                // no break -- avesmapsJsonResponse exits.
            }

            // --- STAGING phase (all kinds) -------------------------------------
            $syncCursor = (int) ($payload['cursor'] ?? 0);
            $syncTotal = avesmapsWikiDumpSyncKindCountRows($pdo, $syncRunId, $syncEntityKinds);
            $syncStep = avesmapsWikiDumpSyncKindStep($pdo, $syncRunId, $syncKind, $syncCursor);
            $stagingDone = ($syncStep['done'] ?? false) === true;

            // On staging-drain, the post-action depends on the kind:
            //   territory  -> rebuild the sandbox territory model ONCE (parent_conflict
            //                 refreshed; parent_locked/overrides PRESERVED, I4).
            //   settlement -> HAND OFF to the chunked conflict_gen phase (do NOT finish,
            //                 do NOT release the lock) -- the frontend loop then drives
            //                 conflict_gen to completion. This replaces the old one-shot
            //                 avesmapsWikiDumpSettlementConflictsGenerate post-action
            //                 that hung.
            $syncPostActions = [];
            $handOffToConflictGen = false;
            if ($stagingDone) {
                if ($syncKind === 'territory') {
                    $rebuild = avesmapsWikiSyncMonitorRebuildModel($pdo);
                    $rebuildSummary = is_array($rebuild['summary'] ?? null) ? $rebuild['summary'] : [];
                    $syncPostActions['territory_model'] = [
                        'rebuilt' => true,
                        'nodes' => (int) ($rebuildSummary['total'] ?? 0),
                    ];
                } elseif ($syncKind === 'settlement') {
                    $handOffToConflictGen = true;
                }
            }

            // Refresh the heartbeat so the (possibly slow) post-action does not make
            // this hold look stale to a stale-takeover. Release only when the WHOLE
            // chain is done: for settlement that is the END of conflict_gen, not here,
            // so the lock is HELD across the hand-off (still $lockHeldByThisRequest).
            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_' . $syncKind);
            if ($stagingDone && !$handOffToConflictGen) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            // Accurate processed count (rows of this kind with id <= the new cursor;
            // the cursor is a row id, not a count, and ids interleave across kinds).
            $syncNextCursor = (int) ($syncStep['nextCursor'] ?? $syncCursor);
            $syncProcessed = $stagingDone
                ? $syncTotal
                : avesmapsWikiDumpSyncKindCountRows($pdo, $syncRunId, $syncEntityKinds, $syncNextCursor);

            // For settlement, staging-drain is NOT the end: report done=false and flip
            // the frontend into the conflict_gen phase (its own cursor starts at 0).
            $syncResponseDone = $stagingDone && !$handOffToConflictGen;
            $syncResponsePhase = $handOffToConflictGen ? 'conflict_gen' : 'staging';

            $syncRunRow = avesmapsWikiDumpSyncKindFetchRunById($pdo, $syncRunId);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => $syncRunRow !== null ? avesmapsWikiSyncPublicRun($syncRunRow) : null,
                'kind' => $syncKind,
                'phase' => $syncResponsePhase,
                'cursor' => $syncNextCursor,
                'conflict_cursor' => 0,
                'done' => $syncResponseDone,
                'progress' => [
                    'processed' => $syncProcessed,
                    'kept_this_step' => (int) ($syncStep['kept'] ?? 0),
                    'processed_this_step' => (int) ($syncStep['processed_this_step'] ?? 0),
                    'total' => $syncTotal,
                ],
                'post_actions' => $syncPostActions,
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_publications':
            // 🔴 THIS ACTION NO LONGER WRITES (design 2026-08-06 §6, session 2). It COMPUTES what the
            // wiki publication sources would do to feature_sources and writes that as a plan into
            // sync_plan_item; an editor then ticks what may happen, and api/edit/wiki/sync-plan.php
            // (action 'apply') does the writing. "Dump holen" therefore ends in a preview instead of a
            // write -- which is the whole point: this reconcile can REMOVE source references, and until
            // now it did so without asking, at the end of a ten-minute job nobody watches to the end.
            //
            // It still does NOT reopen the dump -- avesmapsPublicationPlanStep reads the STAGING tables
            // (wiki_publication_catalog / wiki_entity_publication, populated during "Dump holen") plus
            // the live feature_sources / map_features / political_territory / lore_entry, and calls the
            // SAME pure diff the writer uses, so the preview shows exactly what the writer would do
            // (manual and community links, and suppressed tombstones, never even appear).
            //
            // ⚠️ The OTHER door stays sharp: avesmapsPublicationSyncPhaseStep's 'reconcile' sub-stage
            // (dump-hybrid-driver.php, dryRun=false) still calls avesmapsPublicationReconcileStep. That
            // one belongs to the ways/regions/places apply pipeline and is session 3's business.
            //
            // ⚠️ The lock is kept even though nothing is written: the run REPLACES whatever plan was
            // lying around (design §6). Resumable via (segment, id high-water); one bounded step per
            // call (STRATO: no server-side loop).
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_publications');
            $lockHeldByThisRequest = true;

            // Ensure the staging tables (read) + the feature_sources catalog/provenance columns exist
            // before the step -- idempotent, and the plan step reads both.
            avesmapsEnsurePublicationStagingTables($pdo);
            avesmapsEnsureFeatureSourceTables($pdo);

            // Resumable cursor: segment index (0..4 over territory/settlement/region/path/lore) + the
            // id high-water within the segment. Both are echoed back so the loop advances them.
            $pubSegment = max(0, (int) ($payload['segment'] ?? 0));
            $pubLastId = max(0, (int) ($payload['cursor'] ?? 0));
            $pubStep = avesmapsPublicationPlanStep($pdo, $pubSegment, $pubLastId, $lockUserId);
            $pubDone = ($pubStep['done'] ?? false) === true;

            // Refresh the heartbeat so a slow step is not judged stale; release only when every segment
            // is through -- same terminal-release discipline as sync_kind's staging drain / apply.
            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_publications');
            if ($pubDone) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'stage' => 'plan',
                // Echo the advanced cursor so the client loop resumes from exactly here.
                'segment' => (int) ($pubStep['nextSegment'] ?? $pubSegment),
                'cursor' => (int) ($pubStep['nextLastId'] ?? $pubLastId),
                'done' => $pubDone,
                // The run the preview will read. Server-derived from the cursor, never client-supplied.
                'run_id' => (int) ($pubStep['run_id'] ?? 0),
                // Per-STEP delta: difference rows written into the plan (the client sums them).
                'planned' => (int) ($pubStep['planned'] ?? 0),
                'processed' => (int) ($pubStep['processed'] ?? 0),
                // Only filled on the LAST step, when the plan is complete.
                'counts' => (array) ($pubStep['counts'] ?? []),
                // Types the staging knows nothing about were SKIPPED, not emptied -- the client says so
                // instead of letting the editor read a short list as "there is nothing".
                'skipped_types' => (array) ($pubStep['skipped_types'] ?? []),
                // Catalog context (cheap COUNT): how many catalogued publications have no shop link.
                'no_link' => avesmapsPublicationCountCatalogNoLink($pdo),
                'progress' => [
                    'processed' => (int) ($pubStep['processed'] ?? 0),
                    'segment' => (int) ($pubStep['nextSegment'] ?? $pubSegment),
                    'total' => count(avesmapsPublicationReconcileSegmentOrder()),
                ],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_powerlines':
            // OWNER-triggered PRODUCTION reconcile of the Kraftlinien staged by "Dump holen"
            // (wiki_powerline_staging) onto the live map_features powerline rows. Same 'edit' gate and
            // single-flight pipeline lock as its siblings, but NO cursor loop: 23 staged articles
            // against 162 segments fit in one request, so a resumable machine would be ceremony.
            //
            // The join is the NAME -- a powerline is many segments sharing one lore name, the same
            // 1-to-N shape roads have. OVERRIDE-SAFE: writes ONLY properties.wiki_powerline; the
            // editor's own properties.wiki_url and properties.description are never touched, so a
            // hand-set link survives every sync (unit-tested, powerline-parsing-test.php).
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_powerlines');
            $lockHeldByThisRequest = true;

            $powerlineResult = avesmapsWikiPowerlineReconcile($pdo, $lockUserId);

            avesmapsWikiDumpLockRelease($pdo, $lockUserId);
            $lockHeldByThisRequest = false;

            avesmapsJsonResponse(200, [
                'ok' => true,
                'stage' => 'reconcile',
                'done' => true,
                // An empty staging is a STATE, not an error -- the client says so by name.
                'staged' => (int) ($powerlineResult['staged'] ?? 0),
                'linked' => (int) ($powerlineResult['linked'] ?? 0),
                'updated' => (int) ($powerlineResult['updated'] ?? 0),
                'cleared' => (int) ($powerlineResult['cleared'] ?? 0),
                'unchanged' => (int) ($powerlineResult['unchanged'] ?? 0),
                'matched_names' => (int) ($powerlineResult['matched_names'] ?? 0),
                // Wiki lines with no segment on our map. Reported, not an error: nobody may have
                // drawn them yet, or our spelling differs ("Bruecke nach/von Akrabaal").
                'unmatched_names' => array_values((array) ($powerlineResult['unmatched_names'] ?? [])),
                // Diagnostics: which layer is empty (see avesmapsWikiPowerlineReconcile).
                'sandbox_rows' => (int) ($powerlineResult['sandbox_rows'] ?? 0),
                'run_id' => (int) ($powerlineResult['run_id'] ?? 0),
                'run_completed_at' => (string) ($powerlineResult['run_completed_at'] ?? ''),
                // The newest dump run of ANY status -- reveals a crashed 'running' run and the
                // phase it died in (a completed-only view hides that "Dump holen" is failing).
                'latest_run_status' => (string) ($powerlineResult['latest_run_status'] ?? ''),
                'latest_run_phase' => (string) ($powerlineResult['latest_run_phase'] ?? ''),
                'latest_run_message' => (string) ($powerlineResult['latest_run_message'] ?? ''),
                'latest_run_updated_at' => (string) ($powerlineResult['latest_run_updated_at'] ?? ''),
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_adventures':
            // 🔴 THIS ACTION NO LONGER WRITES (design 2026-08-06 §6, session 2). It COMPUTES what the
            // wiki adventure catalog would do to the live adventure / adventure_place tables and writes
            // that as a plan into sync_plan_item; an editor then ticks what may happen, and
            // api/edit/wiki/sync-plan.php (action 'apply') does the writing -- including the cover
            // download, which is a real side effect and now waits for a checkmark too. The name stays
            // because it is the same button and the same first half of the same job.
            //
            // It still does NOT reopen the dump: avesmapsAdventurePlanStep reads the STAGING tables
            // (wiki_adventure_catalog / wiki_adventure_place_staging, populated during "Dump holen")
            // plus the live tables, and calls the same pure plans the writer uses -- so the preview
            // shows exactly what the writer would do, override-safety included (manual fields and
            // suppressed place tombstones never even appear). Resumable via a wiki_key high-water
            // cursor; one bounded step per call (STRATO: no server-side loop).
            //
            // ⚠️ The lock is kept even though nothing is written: the run REPLACES whatever plan was
            // lying around (design §6), so two editors computing at once would still take each other's
            // work away.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_adventures');
            $lockHeldByThisRequest = true;

            if (function_exists('avesmapsAdventuresEnsureTables')) {
                avesmapsAdventuresEnsureTables($pdo);
            }
            avesmapsEnsureAdventureStagingTables($pdo);

            $advCursor = avesmapsNormalizeSingleLine((string) ($payload['cursor'] ?? ''), 190);
            $advStep = avesmapsAdventurePlanStep($pdo, $advCursor, $lockUserId);
            $advDone = ($advStep['done'] ?? false) === true;

            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_adventures');
            if ($advDone) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'stage' => 'plan',
                // Echo the advanced wiki_key high-water so the client loop resumes from exactly here.
                'cursor' => (string) ($advStep['nextCursor'] ?? $advCursor),
                'done' => $advDone,
                // The run the preview will read. Server-derived from the cursor, never client-supplied.
                'run_id' => (int) ($advStep['run_id'] ?? 0),
                // Per-STEP delta: difference rows written into the plan (the client sums them).
                'planned' => (int) ($advStep['planned'] ?? 0),
                'processed' => (int) ($advStep['processed'] ?? 0),
                // Only filled on the LAST step, when the plan is complete.
                'counts' => (array) ($advStep['counts'] ?? []),
                'progress' => [
                    'processed' => (int) ($advStep['processed'] ?? 0),
                    'total' => avesmapsAdventureCountCatalog($pdo),
                ],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'build_lore_staging':
            // Runs ONLY the lore staging build over the already-cached dump, without the full
            // "Dump holen" state machine. Reason this exists: the lore phase sits 8th of 10 in
            // avesmapsWikiDumpHybridReadPhasesInOrder, so a run that stops early never reaches it
            // -- and demanding a complete re-run just to fill one staging table is a poor trade
            // when avesmapsLoreBuildCatalogStep is self-contained anyway.
            //
            // STAGING-ONLY, exactly like the phase it mirrors: it writes wiki_lore_catalog and the
            // place/source staging, never a live table. The sharp write stays sync_lore. The dump
            // itself is NOT re-downloaded when the cached .bz2 is under 24h old (dump-fetch.php).
            // One bounded step per call, resumable via an integer page cursor.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'build_lore_staging');
            $lockHeldByThisRequest = true;

            $loreDumpPath = avesmapsWikiDumpEnsureDumpPresentOrFail($pdo);
            $loreBuildCursor = (int) ($payload['cursor'] ?? 0);
            $loreBuild = avesmapsLoreBuildCatalogStep($pdo, $loreDumpPath, $loreBuildCursor);
            $loreBuildDone = ($loreBuild['done'] ?? false) === true;

            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'build_lore_staging');
            if ($loreBuildDone) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'stage' => 'build',
                'cursor' => (int) ($loreBuild['nextCursor'] ?? $loreBuildCursor),
                'done' => $loreBuildDone,
                'pages_scanned' => (int) ($loreBuild['pages_scanned'] ?? 0),
                'found_this_step' => (int) ($loreBuild['found_this_step'] ?? 0),
                'staged_total' => avesmapsLoreCountStaging($pdo),
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_lore':
            // 🔴 THIS ACTION NO LONGER WRITES (design 2026-08-06 §6, session 2). It COMPUTES what the
            // wiki lore catalog (flora / fauna / species / trade goods, built by "Dump holen") would do
            // to the live lore_entry / lore_place tables -- plus, per entry, to its sources in the SHARED
            // feature_sources (entity_type='lore', origin='wiki_publication'; lore has had no source
            // table of its own since 2026-07-22, AGENTS.md §5) -- and writes that as a plan into
            // sync_plan_item. An editor then ticks what may happen, and api/edit/wiki/sync-plan.php
            // ('apply') does the writing.
            //
            // ⚠️ WHAT LOOKS LIKE A DELETION HERE IS A TOMBSTONE: an entry the wiki no longer lists is
            // RETIRED (status='retired'), never deleted -- it keeps its occurrences, its sources and its
            // wiki_key, and the next sync revives it by itself. The preview says exactly that, because a
            // warning that claims more than happens is a warning that gets clicked away.
            //
            // It does NOT reopen the dump: avesmapsLorePlanStep reads the STAGING tables
            // (wiki_lore_catalog + place staging) plus the live tables and runs the SAME override-safe
            // diff the writer runs -- manual fields and suppressed place tombstones never even appear.
            // Resumable via a wiki_key high-water cursor; one bounded step per call (STRATO: no
            // server-side loop, and ~5.1k catalog rows would never fit in one request anyway).
            //
            // ⚠️ The lock is kept even though nothing is written: the run REPLACES whatever plan was
            // lying around (design §6).
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_lore');
            $lockHeldByThisRequest = true;

            avesmapsLoreEnsureStagingTables($pdo);
            avesmapsLoreEnsureLiveTables($pdo);
            // Lore sources live in the SHARED system, so the plan reads the publication staging and the
            // feature_sources catalogue. Both idempotent -- the same pair sync_publications ensures.
            avesmapsEnsurePublicationStagingTables($pdo);
            avesmapsEnsureFeatureSourceTables($pdo);

            $loreCursor = avesmapsNormalizeSingleLine((string) ($payload['cursor'] ?? ''), 190);
            $loreStep = avesmapsLorePlanStep($pdo, $loreCursor, $lockUserId);
            $loreDone = ($loreStep['done'] ?? false) === true;

            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_lore');
            if ($loreDone) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                // Immer true: der SCHRITT ist gelaufen. Ein leeres Staging ist ein Zustand,
                // kein Fehler -- der Client erkennt ihn an staging_empty und nennt den Grund.
                'ok' => true,
                'stage' => 'plan',
                // Echo the advanced wiki_key high-water so the client loop resumes from exactly here.
                'cursor' => (string) ($loreStep['nextCursor'] ?? $loreCursor),
                'done' => $loreDone,
                // The run the preview will read. Server-derived from the cursor, never client-supplied.
                'run_id' => (int) ($loreStep['run_id'] ?? 0),
                // Per-STEP delta: difference rows written into the plan (the client sums them).
                'planned' => (int) ($loreStep['planned'] ?? 0),
                'processed' => (int) ($loreStep['processed_this_step'] ?? 0),
                // Only filled on the LAST step, when the plan is complete and the tombstone rows are in.
                'counts' => (array) ($loreStep['counts'] ?? []),
                // Zwei Zustände, keine Fehler: „Dump holen" lief nicht (staging_empty), bzw. das Staging
                // kennt keine Lore-Quellen -> sie wurden BEWUSST nicht angefasst und stehen in keiner
                // Planzeile.
                'staging_empty' => ($loreStep['staging_empty'] ?? false) === true,
                'sources_staging_empty' => ($loreStep['sources_staging_empty'] ?? false) === true,
                'progress' => [
                    'processed' => (int) ($loreStep['processed_this_step'] ?? 0),
                    'total' => avesmapsLoreCountStaging($pdo),
                ],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'sync_citymaps':
            // 🔴 THIS ACTION NO LONGER WRITES (design 2026-08-06 §6). It COMPUTES what the wiki citymap
            // catalog would do to the live tables and writes that as a plan into sync_plan_item; an
            // editor then ticks what may happen, and api/edit/wiki/sync-plan.php (action 'apply') does
            // the writing. The name stays because it is the same button and the same first half of the
            // same job -- and because the client loop, the 'edit' gate and the single-flight pipeline
            // lock below are unchanged.
            //
            // It still does NOT reopen the dump: avesmapsCitymapPlanStep reads the STAGING table
            // (wiki_citymap_catalog, populated during "Dump holen") plus the live tables, and calls the
            // same pure plans the writer uses -- so the preview shows exactly what the writer would do,
            // override-safety included (manual/community cards and suppressed tombstones never even
            // appear). Resumable via a wiki_key high-water cursor; one bounded step per call (STRATO:
            // no server-side loop).
            //
            // ⚠️ The lock is kept even though nothing is written: the run REPLACES whatever plan was
            // lying around (design §6), so two editors computing at once would still take each other's
            // work away.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'sync_citymaps');
            $lockHeldByThisRequest = true;

            avesmapsEnsureCitymapStagingTables($pdo);

            $cmCursor = avesmapsNormalizeSingleLine((string) ($payload['cursor'] ?? ''), 190);
            $cmStep = avesmapsCitymapPlanStep($pdo, $cmCursor, $lockUserId);
            $cmDone = ($cmStep['done'] ?? false) === true;

            avesmapsWikiDumpLockHeartbeat($pdo, $lockUserId, 'sync_citymaps');
            if ($cmDone) {
                avesmapsWikiDumpLockRelease($pdo, $lockUserId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'stage' => 'plan',
                // Echo the advanced wiki_key high-water so the client loop resumes from exactly here.
                'cursor' => (string) ($cmStep['nextCursor'] ?? $cmCursor),
                'done' => $cmDone,
                // The run the preview will read. Server-derived from the cursor, never client-supplied.
                'run_id' => (int) ($cmStep['run_id'] ?? 0),
                // Per-STEP delta: difference rows written in this step (the client sums them).
                'planned' => (int) ($cmStep['planned'] ?? 0),
                'processed' => (int) ($cmStep['processed'] ?? 0),
                // Only filled on the LAST step, when the plan is complete and the deletions are in.
                'counts' => (array) ($cmStep['counts'] ?? []),
                'progress' => [
                    'processed' => (int) ($cmStep['processed'] ?? 0),
                    'total' => avesmapsCitymapCountCatalog($pdo),
                ],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'cleanup_state':
            // "Dump holen" step 3/3 (frontend calls this ONLY after its read_step loop
            // reports done for a successful scan). Deletes every OTHER dump_read run's
            // sandbox rows, keeping just the newest COMPLETED run's -- "immer genau ein
            // Dump drin". Never touches parse_and_upsert/staging/live tables; the DELETE
            // itself is guarded inside avesmapsWikiDumpHybridCleanupOldSandboxState()
            // (transaction, re-derives the kept run server-side, no-op if no run has
            // ever completed). Same 'edit' gate as the other dump actions.
            // cleanup_state is the TERMINAL action of the "Dump holen" (read) chain.
            // Acquire-or-throw first: the holder re-enters (fetch/start_read/read_step
            // already established the hold), a DIFFERENT live holder is rejected. Then
            // run the cleanup and RELEASE -- the whole chain is now done, so the lock is
            // handed back to the next editor.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $lockUserId, $lockUsername, 'cleanup_state');
            $lockHeldByThisRequest = true;
            $cleanupResult = avesmapsWikiDumpHybridCleanupOldSandboxState($pdo);
            avesmapsWikiDumpLockRelease($pdo, $lockUserId);
            $lockHeldByThisRequest = false;
            avesmapsJsonResponse(200, [
                'ok' => true,
                'kept_run_id' => $cleanupResult['kept_run_id'],
                'deleted_state_rows' => $cleanupResult['deleted_state_rows'],
                'deleted_alias_rows' => $cleanupResult['deleted_alias_rows'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'save_report':
            // Writes down what the run just did, so its result outlives the toast. The client
            // drives "Dump holen" step by step and therefore already holds the per-step totals;
            // it posts them here ONCE, after cleanup_state.
            //
            // Deliberately NO lock: the "Dump holen" chain releases the pipeline lock at
            // cleanup_state, and this call comes after it. Taking the lock again would let a
            // bookkeeping write block the next editor's real work.
            //
            // A failure here must never look like a failed dump -- the run already succeeded and
            // is never rolled back. The client treats this call as best-effort (see
            // review-wiki-sync.js) and still shows the numbers it holds in memory.
            require_once __DIR__ . '/../../_internal/wiki/dump-report.php';
            $reportRunPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
            $reportRunStatement = $pdo->prepare('SELECT id FROM wiki_sync_runs WHERE public_id = :public_id LIMIT 1');
            $reportRunStatement->execute(['public_id' => $reportRunPublicId]);
            $reportRunId = (int) $reportRunStatement->fetchColumn();
            if ($reportRunId <= 0) {
                avesmapsErrorResponse(404, 'run_not_found', 'Zu dieser Lauf-Kennung gibt es keinen Eintrag.');
            }
            $reportPayload = $payload['report'] ?? null;
            if (!is_array($reportPayload)) {
                avesmapsErrorResponse(400, 'invalid_request', 'report muss ein Objekt sein.');
            }
            $reportVerdict = avesmapsDumpReportStore($pdo, $reportRunId, $reportPayload);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'notable' => $reportVerdict['notable'],
                'reason' => $reportVerdict['reason'],
                // Echo the STORED report back: by_kind/entries are derived server-side, so a
                // client rendering its own draft would show a report with no counts in it.
                'report' => $reportVerdict['report'],
                'delta' => $reportVerdict['delta'],
            ]);
            // no break -- avesmapsJsonResponse exits.

        default:
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown dump action.');
    }
} catch (WikiDumpLockBusyException $busy) {
    // A second concurrent editor tried a dump action while another holds the
    // pipeline lock. Reject cleanly (HTTP 409) with the standard envelope +
    // machine code so the frontend shows the busy message and STOPS its loop
    // gracefully (never spins up to 2000 times). This request never held the
    // lock (it lost the race), so nothing to release here.
    avesmapsErrorResponse(409, 'dump_locked', $busy->getMessage());
} catch (InvalidArgumentException $exception) {
    // Malformed JSON body etc. Safe to surface (never contains credentials).
    // Release the lock if this request acquired one before the throw (holder-guarded).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    // Do NOT leak the DB error text (it can echo bound values in some drivers).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsServerErrorResponse($exception, 'wiki-dump');
} catch (Throwable $error) {
    // ANY other failure in a mutating flow releases the lock so a crash cannot
    // wedge the pipeline (the stale-takeover is the backstop if even this fails).
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $lockUserId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsServerErrorResponse($error, 'wiki-dump');
}
