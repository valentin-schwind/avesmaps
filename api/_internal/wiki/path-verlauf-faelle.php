<?php

declare(strict_types=1);

// Case list, recompute and apply flow of the verlauf course sync (Tasks 4-5 of
// docs/refactoring-verlauf-sync.md), split out of path-verlauf.php so that file stays
// readable. Loaded by path-verlauf.php via require_once at the point the block used to
// stand; like its parent this file has NO top-level requires and touches no DB at load
// time, so tools/paths/test-path-verlauf-engine.php keeps running standalone. The
// functions below call the diff/routing helpers that live in path-verlauf.php -- they are
// global, and the two files are always loaded together.

function avesmapsWikiPathVerlaufListCases(PDO $pdo, array $config, array $options = []): array {
    avesmapsWikiPathEnsureTables($pdo);
    avesmapsWikiPathVerlaufEnsureCaseTable($pdo);

    $cursor = max(0, (int) ($options['cursor'] ?? 0));
    $limit = max(1, min(50, (int) ($options['limit'] ?? 20)));
    $stepRuntime = max(3, min(25, (int) ($options['step_runtime'] ?? 15)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    $assignments = avesmapsWikiPathVerlaufReadAssignments($pdo);

    // Persisted review decisions, loaded once per request (Task 4). Applied per case below: a status
    // row only "counts" while its stored course_hash still matches that case's staging_hash -- a newer
    // wiki edit changes the staging hash and the case reopens automatically.
    $statusByWikiKey = [];
    foreach ($pdo->query('SELECT wiki_key, status, course_hash FROM wiki_path_verlauf_case_status') as $statusRow) {
        $statusByWikiKey[(string) $statusRow['wiki_key']] = $statusRow;
    }

    // Routing context, built lazily and reused across staging rows within this request (shared helper).
    $routingContext = avesmapsWikiPathVerlaufBuildRoutingContext($config);
    $buildRouter = $routingContext['router'];
    $lookup = $routingContext['lookup'];
    $towns = $routingContext['towns'];

    $select = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . '
        WHERE id > :cursor
        ORDER BY id ASC
        LIMIT ' . $limit
    );
    $select->bindValue('cursor', $cursor, PDO::PARAM_INT);
    $select->execute();
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $cases = [];
    $scanned = 0;
    $nextCursor = $cursor;
    $stoppedEarly = false;
    foreach ($rows as $row) {
        if ((microtime(true) - $startedAt) >= $stepRuntime) {
            $stoppedEarly = true;
            break;
        }
        $scanned++;
        $nextCursor = (int) ($row['id'] ?? $nextCursor);

        $verlauf = trim((string) ($row['verlauf'] ?? ''));
        if ($verlauf === '') {
            continue;
        }

        // Lazy exit before touching the routing lib: only build the (expensive) router when the
        // hash actually differs -- this mirrors rule 2's cheap exit at the list level so a full
        // scan of unchanged ways never loads map data.
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        $currentSegments = is_array($assignments['byWikiKey'][$wikiKey] ?? null) ? $assignments['byWikiKey'][$wikiKey] : [];
        if ($currentSegments === []) {
            continue;
        }
        $stagingHash = avesmapsWikiPathCourseHash($verlauf);
        $storedHash = avesmapsWikiPathVerlaufStoredHash($currentSegments);
        if ($stagingHash !== '' && $stagingHash === $storedHash) {
            continue;
        }

        $kind = (string) ($row['kind'] ?? '') === 'fluss' ? 'fluss' : 'strasse';
        $router = $buildRouter($kind);
        $case = avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup($kind), $router, $towns());
        if ($case !== null) {
            $statusRow = $statusByWikiKey[$wikiKey] ?? null;
            $case['status'] = $statusRow !== null && (string) $statusRow['course_hash'] === (string) $case['staging_hash']
                ? (string) $statusRow['status']
                : 'open';
            $cases[] = $case;
        }
    }

    $complete = !$stoppedEarly && count($rows) < $limit;

    // Router segments carry no name in production; resolve every empty adds[].name for the whole
    // page in one bounded IN-query before returning (finding #2).
    avesmapsWikiPathVerlaufFillAddNames($pdo, $cases);

    return [
        'ok' => true,
        'cases' => $cases,
        'scanned' => $scanned,
        'next_cursor' => $nextCursor,
        'complete' => $complete,
        'runtime_seconds' => round(microtime(true) - $startedAt, 3),
    ];
}

// Recomputes ONE case fresh (never trusts a client-sent segment list -- the owner may edit in
// parallel between compute and write, so the case is always rebuilt from current data). Reads the
// staging row by wiki_key (throws 'case_not_found' when missing), builds the kind's router from the
// shared routing context, and diffs against the passed-in $assignments snapshot. Returns null exactly
// when avesmapsWikiPathVerlaufComputeCase does (unchanged / not verlauf-syncable).
function avesmapsWikiPathVerlaufRecomputeCase(PDO $pdo, string $wikiKey, array $assignments, array $routingContext): ?array {
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $statement->execute(['k' => $wikiKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        throw new RuntimeException('case_not_found: ' . $wikiKey);
    }

    $kind = (string) ($row['kind'] ?? '') === 'fluss' ? 'fluss' : 'strasse';
    $buildRouter = $routingContext['router'];
    $lookup = $routingContext['lookup'];
    $towns = $routingContext['towns'];
    $router = $buildRouter($kind);

    return avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup($kind), $router, $towns());
}

// Restamps the `keeps` of a case in place: sets wiki_path.course_hash = staging_hash and
// course_hops = <this segment's hop labels> on each still-present Ist segment, PRESERVING everything
// else -- especially wiki_path.source (an owner-curated keep stays owner-curated; the hash records
// which course the segment currently traces, not its provenance) and the name column (untouched).
// One shared map revision for the whole batch; each change is audited (undo-restorable). $restamps
// = [public_id => [hop label, ...]] as produced by avesmapsWikiPathVerlaufPlanWrites. $wikiKey is
// this way's key -- a concurrent reassignment that moved a segment to another way must not receive a
// foreign course_hash, so a row whose CURRENT wiki_path.wiki_key no longer matches is skipped.
// Returns the list of public_ids actually written.
function avesmapsWikiPathVerlaufRestampKeeps(PDO $pdo, string $stagingHash, array $restamps, int $userId, string $wikiKey): array {
    if ($restamps === []) {
        return [];
    }
    $publicIds = array_keys($restamps);
    $placeholders = implode(',', array_fill(0, count($publicIds), '?'));
    $select = $pdo->prepare(
        "SELECT id, public_id, name, properties_json FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND public_id IN (" . $placeholders . ')'
    );
    $select->execute(array_values($publicIds));

    $revision = null;
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $restamped = [];
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $current) {
        $publicId = (string) ($current['public_id'] ?? '');
        if (!array_key_exists($publicId, $restamps)) {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($current['properties_json'] ?? null);
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : null;
        // Only restamp a segment that still carries a wiki_path (owner may have unassigned it) AND
        // still belongs to this way (a concurrent reassignment must not get a foreign hash stamp).
        if ($wikiPath === null || (string) ($wikiPath['wiki_key'] ?? '') !== $wikiKey) {
            continue;
        }
        $hops = array_values(array_map('strval', $restamps[$publicId]));
        $wikiPath['course_hash'] = $stagingHash;
        if ($hops !== []) {
            $wikiPath['course_hops'] = $hops;
        } else {
            unset($wikiPath['course_hops']);
        }
        $props['wiki_path'] = $wikiPath;

        $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $current['id']);
        $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
        $update->execute([
            'pj' => avesmapsWikiSyncEncodeJson($props),
            'rev' => $revision,
            'id' => (int) $current['id'],
        ]);
        // NAME UNCHANGED: restamp touches only wiki_path.course_hash/course_hops; the audit after_json
        // keeps the current name so the undo conflict-guard accepts a later rollback.
        avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, (string) ($current['name'] ?? ''));
        $restamped[] = $publicId;
    }

    return $restamped;
}

// Reads the CURRENT wiki_path.source AND wiki_key of a single segment right before a remove write
// (owner may have re-touched or reassigned it between compute and write). Both come out '' when the
// row is gone / carries no wiki_path. The caller clears only when source is still 'verlauf-sync' AND
// wiki_key still equals this way's key (a concurrent reassignment must not be cleared by this way).
function avesmapsWikiPathVerlaufCurrentAssignment(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id = :p AND is_active = 1 AND feature_type = 'path' LIMIT 1");
    $statement->execute(['p' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return ['source' => '', 'wiki_key' => ''];
    }
    $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
    $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
    return [
        'source' => (string) ($wikiPath['source'] ?? ''),
        'wiki_key' => (string) ($wikiPath['wiki_key'] ?? ''),
    ];
}

// Applies a single verlauf-sync case (POST apply_verlauf_case). ALWAYS recomputes server-side.
// Thin public wrapper: builds the shared per-request state (full-table assignment snapshot + lazy
// routing context) ONCE, recomputes the case against it, then delegates the write to
// avesmapsWikiPathVerlaufApplyCaseWithContext. The bulk path (ApplyCleanCases) reuses that same
// internal entry point with its already-built shared state, so a batch pays for exactly one
// ReadAssignments + one routing context instead of one per case.
// Execution order (spec T5 / §3):
//   1. Recompute the case (case_not_found when the staging row is gone; RuntimeException 'Nothing to
//      apply (case unchanged).' when nothing is actionable -> the endpoint's generic handler).
//   2. Dry-run: return the recomputed case preview, no writes.
//   3. Adds: each add via avesmapsWikiPathAssignTo(..., single_segment:true, source='verlauf-sync',
//      course_hash=staging_hash, course_hops=<this add's hops>). single_segment ALWAYS -- name-group
//      matching is dangerous in the sync context.
//   4. Removes: re-read each row's CURRENT wiki_path.source right before the write; clear only when it
//      is still 'verlauf-sync' (single_segment:true), else count skipped_conflicts.
//   5. Restamp keeps whose stored course_hash/course_hops drifted (source preserved, name untouched).
//   6. Delete the case-status row for wiki_key (Task 4 pattern).
// hash_only cases: steps 3-4 are no-ops, step 5 restamps -- repeated scans go quiet.
function avesmapsWikiPathVerlaufApplyCase(PDO $pdo, array $config, string $wikiKey, bool $dryRun, int $userId): array {
    avesmapsWikiPathEnsureTables($pdo);
    avesmapsWikiPathVerlaufEnsureCaseTable($pdo);
    $wikiKey = trim($wikiKey);

    $assignments = avesmapsWikiPathVerlaufReadAssignments($pdo);
    $routingContext = avesmapsWikiPathVerlaufBuildRoutingContext($config);
    $case = avesmapsWikiPathVerlaufRecomputeCase($pdo, $wikiKey, $assignments, $routingContext);
    if ($case === null) {
        throw new RuntimeException('Nothing to apply (case unchanged).');
    }

    return avesmapsWikiPathVerlaufApplyCaseWithContext($pdo, $wikiKey, $case, $dryRun, $userId, $assignments, $config, $routingContext);
}

// Internal case-apply body shared by the single-case wrapper (avesmapsWikiPathVerlaufApplyCase) and
// the bulk loop (avesmapsWikiPathVerlaufApplyCleanCases). Accepts the ALREADY-recomputed $case and the
// shared batch-start $assignments snapshot instead of rebuilding both per case -- this is the whole
// point of the extraction: on STRATO a bulk batch must not re-run the expensive full-map ReadAssignments
// / route-map load once per applied case.
//
// STALENESS NOTE (shared-state handoff): reusing the batch-start $assignments across applied cases is
// SAFE even though an earlier case in the same run may have written segments $assignments does not yet
// reflect, because (a) removes are gated by a LIVE per-row wiki_path.source/wiki_key re-read (step 4 /
// avesmapsWikiPathVerlaufCurrentAssignment) immediately before each clear, so a segment an earlier case
// turned into a verlauf-sync member is judged on its real current source, not the stale snapshot; and
// (b) any segment an earlier case wrote is in the caller's $claimedThisRun set, and a later case whose
// adds overlap it is skipped WHOLE (skipped_not_clean) before ever reaching this function -- so stale
// $assignments (here used only to seed $currentByPublicId for the keeps/restamp diff) can only cause a
// conservative skip of a no-op restamp, never a wrong write.
function avesmapsWikiPathVerlaufApplyCaseWithContext(PDO $pdo, string $wikiKey, array $case, bool $dryRun, int $userId, array $assignments, array $config = [], ?array $routingContext = null): array {
    if ($dryRun) {
        // Preview goes to the client: resolve empty adds[].name (router segments carry none in
        // production) in one bounded IN-query before returning it (finding #2).
        avesmapsWikiPathVerlaufFillAddNamesForCase($pdo, $case);
        return [
            'ok' => true,
            'dry_run' => true,
            'wiki_key' => $wikiKey,
            'case' => $case,
            'adds_applied' => 0,
            'adds_failed' => 0,
            'removes_applied' => 0,
            'restamped' => 0,
            'skipped_conflicts' => 0,
            'segments_updated' => [],
        ];
    }

    $stagingHash = (string) ($case['staging_hash'] ?? '');
    // DEAD PLAN BRANCH: $currentByPublicId is seeded ONLY from keeps, so PlanWrites' remove branch is
    // structurally empty here -- production removes go through the step-4 live re-read loop below, NOT
    // through $plan['removes']. Do not assume the plan drives removes.
    $currentByPublicId = [];
    foreach ($case['keeps'] as $keep) {
        $publicId = (string) ($keep['public_id'] ?? '');
        $ist = $assignments['byWikiKey'][$wikiKey][$publicId] ?? null;
        if (is_array($ist)) {
            $currentByPublicId[$publicId] = [
                'source' => (string) ($ist['source'] ?? ''),
                'course_hash' => (string) ($ist['course_hash'] ?? ''),
                'course_hops' => is_array($ist['course_hops'] ?? null) ? $ist['course_hops'] : [],
            ];
        }
    }
    $plan = avesmapsWikiPathVerlaufPlanWrites($case, $currentByPublicId);

    $segmentsUpdated = [];

    // Step 3: adds (always single_segment, stamped as verlauf-sync with this course's hash/hops).
    $addsApplied = 0;
    $addsFailed = 0;
    foreach ($case['adds'] as $add) {
        $publicId = (string) ($add['public_id'] ?? '');
        if ($publicId === '' || !isset($plan['adds'][$publicId])) {
            continue;
        }
        $assignMeta = [
            'source' => 'verlauf-sync',
            'course_hash' => $stagingHash,
            'course_hops' => $plan['adds'][$publicId],
        ];
        $result = avesmapsWikiPathAssignTo($pdo, $wikiKey, $publicId, false, $userId, true, $assignMeta);
        if (($result['type_ok'] ?? true) === true && (int) ($result['applied'] ?? 0) > 0) {
            $addsApplied++;
            foreach (($result['segments_updated'] ?? []) as $segment) {
                $segmentsUpdated[] = $segment;
            }
        } else {
            // An add that the assign refused (type mismatch) or that touched no row: previously silent
            // (adds_applied just came out lower). Counted so the live verification can see it.
            $addsFailed++;
        }
    }

    // Step 4: removes (re-read current source right before the write; only clear verlauf-sync rows).
    $removesApplied = 0;
    $skippedConflicts = 0;
    foreach ($case['removes'] as $remove) {
        $publicId = (string) ($remove['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        // Owner may have flipped the source or reassigned the segment to another way since compute:
        // clear only a row still owned by verlauf-sync AND still on this way (else skipped_conflicts).
        $currentAssignment = avesmapsWikiPathVerlaufCurrentAssignment($pdo, $publicId);
        if ($currentAssignment['source'] !== 'verlauf-sync' || $currentAssignment['wiki_key'] !== $wikiKey) {
            $skippedConflicts++;
            continue;
        }
        $result = avesmapsWikiPathClearAssign($pdo, $publicId, false, $userId, true);
        if ((int) ($result['applied'] ?? 0) > 0) {
            $removesApplied++;
            foreach (($result['segments_updated'] ?? []) as $segment) {
                $segmentsUpdated[] = $segment;
            }
        }
    }

    // Step 5: restamp keeps whose stored course drifted (source/name preserved; foreign-key rows skipped).
    $restamped = avesmapsWikiPathVerlaufRestampKeeps($pdo, $stagingHash, $plan['restamps'], $userId, $wikiKey);

    // Step 5b (Flussrichtung spec §3 trigger 3): after a river way's course was applied,
    // derive its flow direction from the FRESH assignment. Never fails the apply -- the
    // course writes above are already committed; a derivation problem is reported, not thrown.
    // Dry-run applies return before this point: the flow preview is derive_flow's own dry-run.
    $flowResult = null;
    if ((string) ($case['kind'] ?? '') === 'fluss' && $routingContext !== null && function_exists('avesmapsWikiPathFlowDeriveForWay')) {
        try {
            $flowResult = avesmapsWikiPathFlowDeriveForWay($pdo, $config, $wikiKey, false, $userId, $routingContext);
            foreach (($flowResult['segments_updated'] ?? []) as $segment) {
                $segmentsUpdated[] = $segment;
            }
            unset($flowResult['segments_updated']);
        } catch (Throwable $error) {
            $flowResult = ['ok' => false, 'error' => 'derive_failed'];
        }
    }

    // Step 6: a successful sync clears any deferred/archived decision for this way (Task 4 pattern:
    // deleting the row falls the case back to its live-computed open state, which is now quiet).
    $pdo->prepare('DELETE FROM wiki_path_verlauf_case_status WHERE wiki_key = :k')->execute(['k' => $wikiKey]);

    return [
        'ok' => true,
        'dry_run' => false,
        'wiki_key' => $wikiKey,
        'case' => $case,
        'adds_applied' => $addsApplied,
        'adds_failed' => $addsFailed,
        'removes_applied' => $removesApplied,
        'restamped' => count($restamped),
        'skipped_conflicts' => $skippedConflicts,
        'segments_updated' => $segmentsUpdated,
        'flow' => $flowResult,
    ];
}

// Bulk apply (POST apply_verlauf_cases_clean). Walks wiki_path_staging by an id cursor exactly like
// avesmapsWikiPathVerlaufListCases, applies ONLY clean cases with status 'open', and time-boxes the
// batch (STRATO). Cross-case dedupe via $claimedThisRun: before applying a case, drop any add whose
// public_id an EARLIER case in this run already claimed; if that drops anything, SKIP the whole case
// (skipped_not_clean) rather than write a silently partial course -- it resurfaces next scan. After
// each applied case, its Soll ids (adds + keeps) join $claimedThisRun.
//
// $options: cursor (staging id, default 0), limit (default 20, max 50), step_runtime (seconds,
// default 15, max 25). Response: {ok, dry_run, applied_cases, skipped_not_clean, scanned, next_cursor,
// complete}.
function avesmapsWikiPathVerlaufApplyCleanCases(PDO $pdo, array $config, bool $dryRun, int $userId, array $options = []): array {
    avesmapsWikiPathEnsureTables($pdo);
    avesmapsWikiPathVerlaufEnsureCaseTable($pdo);

    $cursor = max(0, (int) ($options['cursor'] ?? 0));
    $limit = max(1, min(50, (int) ($options['limit'] ?? 20)));
    $stepRuntime = max(3, min(25, (int) ($options['step_runtime'] ?? 15)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    $assignments = avesmapsWikiPathVerlaufReadAssignments($pdo);

    $statusByWikiKey = [];
    foreach ($pdo->query('SELECT wiki_key, status, course_hash FROM wiki_path_verlauf_case_status') as $statusRow) {
        $statusByWikiKey[(string) $statusRow['wiki_key']] = $statusRow;
    }

    $routingContext = avesmapsWikiPathVerlaufBuildRoutingContext($config);
    $buildRouter = $routingContext['router'];
    $lookup = $routingContext['lookup'];
    $towns = $routingContext['towns'];

    $select = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . '
        WHERE id > :cursor
        ORDER BY id ASC
        LIMIT ' . $limit
    );
    $select->bindValue('cursor', $cursor, PDO::PARAM_INT);
    $select->execute();
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $appliedCases = [];
    $skippedNotClean = 0;
    $scanned = 0;
    $nextCursor = $cursor;
    $stoppedEarly = false;
    $claimedThisRun = [];   // public_id => true (Soll ids claimed by an earlier applied case)

    foreach ($rows as $row) {
        if ((microtime(true) - $startedAt) >= $stepRuntime) {
            $stoppedEarly = true;
            break;
        }
        $scanned++;
        $nextCursor = (int) ($row['id'] ?? $nextCursor);

        $verlauf = trim((string) ($row['verlauf'] ?? ''));
        if ($verlauf === '') {
            continue;
        }

        // Cheap exits (mirror ListCases): unassigned or unchanged ways never load the router.
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        $currentSegments = is_array($assignments['byWikiKey'][$wikiKey] ?? null) ? $assignments['byWikiKey'][$wikiKey] : [];
        if ($currentSegments === []) {
            continue;
        }
        $stagingHash = avesmapsWikiPathCourseHash($verlauf);
        $storedHash = avesmapsWikiPathVerlaufStoredHash($currentSegments);
        if ($stagingHash !== '' && $stagingHash === $storedHash) {
            continue;
        }

        $kind = (string) ($row['kind'] ?? '') === 'fluss' ? 'fluss' : 'strasse';
        $router = $buildRouter($kind);
        $case = avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup($kind), $router, $towns());
        if ($case === null) {
            continue;
        }

        // Only clean, open cases are auto-applied (a persisted defer/archive is respected).
        if (($case['clean'] ?? false) !== true) {
            $skippedNotClean++;
            continue;
        }
        $statusRow = $statusByWikiKey[$wikiKey] ?? null;
        $status = $statusRow !== null && (string) $statusRow['course_hash'] === (string) $case['staging_hash']
            ? (string) $statusRow['status']
            : 'open';
        if ($status !== 'open') {
            $skippedNotClean++;
            continue;
        }

        // Cross-case dedupe (trap: deduplicate Soll sets against each other BEFORE writing). If an
        // earlier applied case in this run claimed any of this case's add ids, skip the whole case --
        // writing a partial course would silently drop segments; it resurfaces on the next scan.
        $conflictWithEarlier = false;
        foreach ($case['adds'] as $add) {
            if (isset($claimedThisRun[(string) ($add['public_id'] ?? '')])) {
                $conflictWithEarlier = true;
                break;
            }
        }
        if ($conflictWithEarlier) {
            $skippedNotClean++;
            continue;
        }

        if ($dryRun) {
            $appliedCases[] = [
                'wiki_key' => $wikiKey,
                'name' => (string) ($case['name'] ?? ''),
                'adds' => is_array($case['adds'] ?? null) ? $case['adds'] : [],
                'adds_applied' => 0,
                'adds_failed' => 0,
                'removes_applied' => 0,
                'restamped' => 0,
            ];
        } else {
            // Reuse the loop's already-computed $case and the shared batch-start $assignments instead
            // of the public wrapper (which would re-run ReadAssignments + rebuild the routing context
            // and re-recompute the case per row). Safe per the staleness note on
            // avesmapsWikiPathVerlaufApplyCaseWithContext.
            $applied = avesmapsWikiPathVerlaufApplyCaseWithContext($pdo, $wikiKey, $case, false, $userId, $assignments, $config, $routingContext);
            $appliedCases[] = [
                'wiki_key' => $wikiKey,
                'name' => (string) ($case['name'] ?? ''),
                'adds_applied' => (int) ($applied['adds_applied'] ?? 0),
                'adds_failed' => (int) ($applied['adds_failed'] ?? 0),
                'removes_applied' => (int) ($applied['removes_applied'] ?? 0),
                'restamped' => (int) ($applied['restamped'] ?? 0),
            ];
        }

        // Claim this case's whole Soll (adds + keeps) so a later shared-trasse case is skipped.
        foreach ($case['adds'] as $add) {
            $claimedThisRun[(string) ($add['public_id'] ?? '')] = true;
        }
        foreach ($case['keeps'] as $keep) {
            $claimedThisRun[(string) ($keep['public_id'] ?? '')] = true;
        }
    }

    $complete = !$stoppedEarly && count($rows) < $limit;

    // Dry-run previews surface adds[] to the client; resolve every empty name across the whole batch
    // in one bounded IN-query (finding #2). The sharp path carries no adds[] in its summary rows.
    if ($dryRun) {
        avesmapsWikiPathVerlaufFillAddNames($pdo, $appliedCases);
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'applied_cases' => $appliedCases,
        'skipped_not_clean' => $skippedNotClean,
        'scanned' => $scanned,
        'next_cursor' => $nextCursor,
        'complete' => $complete,
    ];
}
