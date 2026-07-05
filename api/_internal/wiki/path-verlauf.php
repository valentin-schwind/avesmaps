<?php

declare(strict_types=1);

// Verlauf-Sync server logic (docs/refactoring-verlauf-sync.md). Diffs the wiki
// staging `verlauf` course against what map_features carries, so a later wiki
// course edit surfaces as a review case instead of silently drifting. Task 2
// lays the ground helpers (course hashing/station split) and the one-off
// audit-log backfill that stamps `wiki_path.source`/`course_hash` onto
// segments the 2026-07-05 bulk assign already wrote. Tasks 3-5 extend this
// file with the diff/case-building engine and the apply flow.
//
// Deliberately NO top-level requires: this file must be loadable standalone
// (see tools/paths/test-path-verlauf-engine.php, pure-function tests only, no
// PDO). The DB-touching functions below reference avesmapsWikiSyncDecodeJson /
// avesmapsWikiSyncEncodeJson (sync.php) and avesmapsWikiSyncFetchAuditRow /
// avesmapsWikiSyncAuditFeaturePropsChange / avesmapsWikiSyncNextMapRevision
// (locations-helpers.php) only inside function bodies -- the including
// endpoint (api/edit/wiki/paths.php) already loads sync.php and, via
// paths.php/locations.php, locations-helpers.php before this file runs.

// Stable hash of a staging `verlauf` string at a point in time, used to detect
// whether the wiki course changed since a segment was assigned. Empty (after
// trim) verlauf hashes to '' rather than sha1('') so "no course recorded" and
// "course hashed to something" stay distinguishable.
function avesmapsWikiPathCourseHash(string $verlauf): string {
    $trimmed = trim($verlauf);
    return $trimmed === '' ? '' : sha1($trimmed);
}

// Splits a staging `verlauf` string into its ordered station names. Storage
// format is stations joined by ' → ' (U+2192 arrow with surrounding spaces,
// written by avesmapsWikiPathParsePage, api/_internal/wiki/paths.php line
// ~372). Trims each station, drops empties, de-dupes while preserving order.
function avesmapsWikiPathVerlaufStations(string $verlauf): array {
    $stations = [];
    foreach (explode(' → ', $verlauf) as $part) {
        $station = trim($part);
        if ($station !== '' && !in_array($station, $stations, true)) {
            $stations[] = $station;
        }
    }
    return $stations;
}

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

// One-off backfill: stamps wiki_path.source='verlauf-sync' (+ course_hash, when the
// audit verlauf is non-empty) onto segments that the 2026-07-05 assign_all bulk pipeline
// already wrote, using the map_audit_log trail (avesmapsWikiSyncAuditFeaturePropsChange's
// 'wiki_sync_update_point' entries) rather than re-deriving state from map_features alone
// (properties_json.wiki_path never carried `source` before Task 1). Batched via an
// after_id cursor + limit -- STRATO shared hosting, never scan the whole audit table
// unbounded in one request.
//
// $options: date (default '2026-07-05'), after_id (audit-id cursor, default 0),
// limit (default 400, max 800, clamped to >= 1).
function avesmapsWikiPathVerlaufBackfillSource(PDO $pdo, bool $dryRun, int $userId, array $options = []): array {
    $date = trim((string) ($options['date'] ?? '2026-07-05'));
    $afterId = max(0, (int) ($options['after_id'] ?? 0));
    $limit = max(1, min(800, (int) ($options['limit'] ?? 400)));

    $d0 = new DateTimeImmutable($date . ' 00:00:00');
    $d1 = $d0->modify('+1 day');

    $select = $pdo->prepare(
        "SELECT id, feature_id, after_json FROM map_audit_log
        WHERE action = 'wiki_sync_update_point'
          AND created_at >= :d0 AND created_at < :d1
          AND id > :after_id
          AND JSON_EXTRACT(after_json, '$.properties_json.wiki_path.wiki_key') IS NOT NULL
        ORDER BY id ASC
        LIMIT " . $limit
    );
    $select->execute([
        'd0' => $d0->format('Y-m-d H:i:s'),
        'd1' => $d1->format('Y-m-d H:i:s'),
        'after_id' => $afterId,
    ]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $scanned = count($rows);
    $lastAuditId = $afterId;
    $byFeature = [];
    foreach ($rows as $row) {
        $lastAuditId = max($lastAuditId, (int) $row['id']);
        $featureId = (int) $row['feature_id'];
        $after = avesmapsWikiSyncDecodeJson($row['after_json'] ?? null);
        $props = is_array($after['properties_json'] ?? null) ? $after['properties_json'] : [];
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        // Keep the LAST (highest id) entry per feature within this batch.
        $byFeature[$featureId] = [
            'wiki_key' => $wikiKey,
            'verlauf' => (string) ($wikiPath['verlauf'] ?? ''),
        ];
    }

    $skipped = ['inactive_or_missing' => 0, 'reassigned' => 0, 'editor_source' => 0];
    $stamped = 0;
    $sample = [];
    $revision = null;

    if ($byFeature !== []) {
        $featureIds = array_keys($byFeature);
        $placeholders = implode(',', array_fill(0, count($featureIds), '?'));
        $rowsStatement = $pdo->prepare(
            "SELECT id, public_id, name, properties_json FROM map_features
            WHERE feature_type = 'path' AND is_active = 1 AND id IN (" . $placeholders . ')'
        );
        $rowsStatement->execute($featureIds);
        $currentById = [];
        foreach ($rowsStatement->fetchAll(PDO::FETCH_ASSOC) as $currentRow) {
            $currentById[(int) $currentRow['id']] = $currentRow;
        }

        $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');

        foreach ($byFeature as $featureId => $entry) {
            $currentRow = $currentById[$featureId] ?? null;
            $currentProps = $currentRow !== null ? avesmapsWikiSyncDecodeJson($currentRow['properties_json'] ?? null) : null;
            $decision = avesmapsWikiPathVerlaufBackfillDecision($currentProps, $entry['wiki_key'], $entry['verlauf']);

            if ($decision['action'] !== 'stamp') {
                $reason = (string) $decision['reason'];
                if (isset($skipped[$reason])) {
                    $skipped[$reason]++;
                }
                continue;
            }

            $stamped++;
            if (count($sample) < 10) {
                $sample[] = [
                    'public_id' => (string) ($currentRow['public_id'] ?? ''),
                    'name' => (string) ($currentRow['name'] ?? ''),
                    'wiki_key' => $entry['wiki_key'],
                ];
            }

            if (!$dryRun) {
                $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, $featureId);
                $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
                $props = $decision['props'];
                $update->execute([
                    'pj' => avesmapsWikiSyncEncodeJson($props),
                    'rev' => $revision,
                    'id' => $featureId,
                ]);
                // NAME UNCHANGED: this backfill only stamps provenance/course_hash onto
                // wiki_path, never the name column.
                avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, (string) ($auditBefore['name'] ?? ''));
            }
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'scanned' => $scanned,
        'stamped' => $stamped,
        'skipped' => $skipped,
        'next_after_id' => $lastAuditId,
        'complete' => $scanned < $limit,
        'sample' => $sample,
    ];
}

// A hop whose Soll route exceeds this many segments is treated as a routing detour rather than a
// faithful match of the wiki course, and reported as an unroutable hop (reason 'detour'). Keeps a
// wrong Dijkstra shortcut from silently pulling a long unrelated chain into the target set.
const AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS = 15;

// UTF-8-aware lowercasing for case-insensitive station matching (spec: mb_strtolower, UTF-8).
// Falls back to strtolower when the mbstring extension is not loaded, so the standalone engine
// test (tools/paths/test-path-verlauf-engine.php, plain `php`) stays runnable; production always
// has mbstring (used across api/), where German umlauts fold correctly.
function avesmapsWikiPathVerlaufLower(string $value): string {
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

// Reads the current wiki_path assignment of every active path feature, so the diff engine can
// compare the stored course against the staging verlauf without re-querying per case. Decodes
// properties_json once per row; rows without a wiki_path.wiki_key are absent from both indices
// (a segment that carries no wiki assignment is neither part of any way's Ist nor a conflict
// candidate). Returns two views of the same data:
//   byWikiKey[wiki_key][public_id] => ['public_id','name','subtype','source','course_hash']
//   byPublicId[public_id]          => ['wiki_key','name','source']
function avesmapsWikiPathVerlaufReadAssignments(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json
        FROM map_features
        WHERE is_active = 1 AND feature_type = 'path'"
    );

    $byWikiKey = [];
    $byPublicId = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $name = (string) ($row['name'] ?? '');
        $source = (string) ($wikiPath['source'] ?? 'editor');
        $courseHash = (string) ($wikiPath['course_hash'] ?? '');

        $byWikiKey[$wikiKey][$publicId] = [
            'public_id' => $publicId,
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'source' => $source,
            'course_hash' => $courseHash,
        ];
        $byPublicId[$publicId] = [
            'wiki_key' => $wikiKey,
            'name' => $name,
            'source' => $source,
        ];
    }

    return ['byWikiKey' => $byWikiKey, 'byPublicId' => $byPublicId];
}

// Stored hash of a way = the most frequent non-empty course_hash among its current segments
// (engine rule 1). Empty string when the way has no hashed segment (never synced). Ties are
// broken by first-seen order (deterministic for a stable segment iteration).
function avesmapsWikiPathVerlaufStoredHash(array $currentSegments): string {
    $counts = [];
    $order = [];
    foreach ($currentSegments as $segment) {
        $hash = (string) ($segment['course_hash'] ?? '');
        if ($hash === '') {
            continue;
        }
        if (!isset($counts[$hash])) {
            $counts[$hash] = 0;
            $order[$hash] = count($order);
        }
        $counts[$hash]++;
    }
    if ($counts === []) {
        return '';
    }
    $best = '';
    $bestCount = -1;
    $bestOrder = PHP_INT_MAX;
    foreach ($counts as $hash => $count) {
        if ($count > $bestCount || ($count === $bestCount && $order[$hash] < $bestOrder)) {
            $best = (string) $hash;
            $bestCount = $count;
            $bestOrder = $order[$hash];
        }
    }
    return $best;
}

// The core diff engine (engine rules 1-13, docs/refactoring-verlauf-sync.md). PURE apart from the
// injected $router and $locationLookup, so the pipeline tests drive it with fixtures (no DB, no
// routing lib). Compares one staging row's `verlauf` course (Soll) against the way's current
// segment assignment (Ist = $assignments['byWikiKey'][wiki_key]) and returns a review case, or
// null when nothing is actionable / the way is not verlauf-syncable.
//
//   $router(string $fromName, string $toName): array -> ['found'=>bool, 'reason'=>string,
//       'segments'=>[['public_id'=>string, 'name'=>string], ...]]  (synthetic Querfeldein already
//       post-filtered out by the caller in avesmapsWikiPathVerlaufListCases).
//   $locationLookup[mb_strtolower(name)] => canonicalName  (case-insensitive station match).
function avesmapsWikiPathVerlaufComputeCase(array $stagingRow, array $assignments, array $locationLookup, callable $router): ?array {
    $wikiKey = (string) ($stagingRow['wiki_key'] ?? '');
    $verlauf = (string) ($stagingRow['verlauf'] ?? '');
    $stagingHash = avesmapsWikiPathCourseHash($verlauf);

    $byWikiKey = is_array($assignments['byWikiKey'] ?? null) ? $assignments['byWikiKey'] : [];
    $byPublicId = is_array($assignments['byPublicId'] ?? null) ? $assignments['byPublicId'] : [];
    $currentSegments = is_array($byWikiKey[$wikiKey] ?? null) ? $byWikiKey[$wikiKey] : [];

    // Rule 13: ways with ZERO current segments are skipped entirely -- verlauf sync updates
    // ASSIGNED ways; initial assignment stays with the existing panel/pipeline.
    if ($currentSegments === []) {
        return null;
    }

    // Rule 1: stored hash = most frequent non-empty course_hash among current segments.
    $storedHash = avesmapsWikiPathVerlaufStoredHash($currentSegments);

    // Rule 2: staging_hash === stored_hash and both non-empty => unchanged (the only cheap exit).
    if ($stagingHash !== '' && $stagingHash === $storedHash) {
        return null;
    }

    // Rule 3: < 2 parsed stations => not routable by definition; never propose removals from an
    // uncomputable course.
    $stations = avesmapsWikiPathVerlaufStations($verlauf);
    if (count($stations) < 2) {
        return null;
    }

    // Rule 4: station -> location by case-insensitive name; unmatched -> flags.missing_stations,
    // chain keeps only matched stations.
    $missingStations = [];
    $matchedChain = [];
    foreach ($stations as $station) {
        $canonical = $locationLookup[avesmapsWikiPathVerlaufLower($station)] ?? null;
        if ($canonical === null) {
            $missingStations[] = $station;
            continue;
        }
        $matchedChain[] = (string) $canonical;
    }

    $flags = [
        'missing_stations' => $missingStations,
        'unroutable_hops' => [],
        'conflicts' => [],
        'backtrack_hops' => [],
    ];

    $baseCase = [
        'wiki_key' => $wikiKey,
        'name' => (string) ($stagingRow['name'] ?? ''),
        'kind' => (string) ($stagingRow['kind'] ?? '') === 'fluss' ? 'fluss' : 'strasse',
        'wiki_url' => (string) ($stagingRow['wiki_url'] ?? ''),
        'staging_id' => (int) ($stagingRow['id'] ?? 0),
        'staging_hash' => $stagingHash,
        'stored_hash' => $storedHash,
        'stations' => $matchedChain,
        'status' => 'open',
    ];

    // Rule 5: matched chain < 2 stations => hint case station_missing, adds/removes empty.
    if (count($matchedChain) < 2) {
        return $baseCase + [
            'type' => 'station_missing',
            'clean' => false,
            'hash_only' => false,
            'flags' => $flags,
            'adds' => [],
            'removes' => [],
            'keeps' => [],
        ];
    }

    // Rule 6: hops = consecutive matched-station pairs. Route each; classify unroutable reasons.
    // Rule 7: Soll = union of routable hops' segment public_ids, with the hop labels that justify
    // each segment (course_hops / adds[].hops / keeps[].hops).
    $sollHops = [];             // public_id => [hop label, ...] (insertion order preserved)
    $hopSegmentIds = [];        // per hop index => [public_id, ...] (for backtrack detection)
    $anyUnroutable = false;
    for ($i = 0; $i < count($matchedChain) - 1; $i++) {
        $fromName = $matchedChain[$i];
        $toName = $matchedChain[$i + 1];
        $label = $fromName . ' → ' . $toName;
        $result = $router($fromName, $toName);

        $found = (bool) ($result['found'] ?? false);
        $segments = is_array($result['segments'] ?? null) ? $result['segments'] : [];
        if (!$found) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'no_route'];
            $anyUnroutable = true;
            continue;
        }

        // Synthetic gap: any segment is a Querfeldein bridge (synthetic true or empty public_id).
        $hasSynthetic = false;
        foreach ($segments as $segment) {
            if (!empty($segment['synthetic']) || (string) ($segment['public_id'] ?? '') === '') {
                $hasSynthetic = true;
                break;
            }
        }
        if ($hasSynthetic) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'synthetic_gap'];
            $anyUnroutable = true;
            continue;
        }

        // Detour: too many segments for a faithful course match.
        if (count($segments) > AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'detour'];
            $anyUnroutable = true;
            continue;
        }

        $thisHopIds = [];
        foreach ($segments as $segment) {
            $publicId = (string) ($segment['public_id'] ?? '');
            if ($publicId === '') {
                continue;
            }
            $thisHopIds[] = $publicId;
            if (!isset($sollHops[$publicId])) {
                $sollHops[$publicId] = [];
            }
            if (!in_array($label, $sollHops[$publicId], true)) {
                $sollHops[$publicId][] = $label;
            }
        }
        $hopSegmentIds[$i] = $thisHopIds;
    }

    // Rule 10: consecutive routable hops sharing >= 1 segment id => the shared middle station is a
    // backtrack (info only, no effect on clean).
    $hopIndices = array_keys($hopSegmentIds);
    for ($j = 0; $j < count($hopIndices) - 1; $j++) {
        $indexA = $hopIndices[$j];
        $indexB = $hopIndices[$j + 1];
        if ($indexB !== $indexA + 1) {
            continue;
        }
        if (array_intersect($hopSegmentIds[$indexA], $hopSegmentIds[$indexB]) !== []) {
            $flags['backtrack_hops'][] = $matchedChain[$indexB];
        }
    }

    // Rule 9 (diff vs current Ist):
    //   adds = Soll - Ist; a Soll segment owned by ANOTHER wiki way is NOT added -> flags.conflicts
    //          (conflict 'foreign'); the sync leaves the gap (invariant 3).
    //   removes = Ist - Soll with source 'verlauf-sync'; owner-curated (source != 'verlauf-sync')
    //          members of Ist - Soll go to flags.conflicts (conflict 'owner'), never removed.
    //   keeps = Soll ∩ Ist (routable), with the hop labels justifying each kept segment.
    $adds = [];
    $keeps = [];
    foreach ($sollHops as $publicId => $hops) {
        $inIst = isset($currentSegments[$publicId]);
        if ($inIst) {
            $keeps[] = ['public_id' => (string) $publicId, 'hops' => $hops];
            continue;
        }
        $foreign = $byPublicId[$publicId] ?? null;
        if (is_array($foreign) && (string) ($foreign['wiki_key'] ?? '') !== $wikiKey && (string) ($foreign['wiki_key'] ?? '') !== '') {
            $flags['conflicts'][] = [
                'public_id' => (string) $publicId,
                'name' => (string) ($foreign['name'] ?? ''),
                'conflict' => 'foreign',
                'other_wiki_key' => (string) ($foreign['wiki_key'] ?? ''),
            ];
            continue;
        }
        $adds[] = ['public_id' => (string) $publicId, 'name' => (string) ($foreign['name'] ?? ''), 'hops' => $hops];
    }

    $removes = [];
    foreach ($currentSegments as $publicId => $segment) {
        if (isset($sollHops[$publicId])) {
            continue;
        }
        if ((string) ($segment['source'] ?? '') === 'verlauf-sync') {
            $removes[] = ['public_id' => (string) $publicId, 'name' => (string) ($segment['name'] ?? '')];
            continue;
        }
        $flags['conflicts'][] = [
            'public_id' => (string) $publicId,
            'name' => (string) ($segment['name'] ?? ''),
            'conflict' => 'owner',
            'other_wiki_key' => $wikiKey,
        ];
    }

    // Rule 8: any unroutable hop forces removes empty (a partial Soll must never trigger removals);
    // adds stay (additive is safe). The case is not clean anyway.
    if ($anyUnroutable) {
        $removes = [];
    }

    // Rule 11: type precedence.
    $hasConflicts = $flags['conflicts'] !== [];
    $hasDiff = $adds !== [] || $removes !== [];
    $hashOnly = false;
    if ($hasConflicts) {
        $type = 'course_conflict';
    } elseif ($hasDiff) {
        $type = 'verlauf_changed';
    } elseif ($missingStations !== []) {
        $type = 'station_missing';
    } elseif ($flags['unroutable_hops'] !== []) {
        $type = 'hops_unroutable';
    } else {
        // Hash changed, segment sets identical, no flags => restamp only.
        $type = 'verlauf_changed';
        $hashOnly = true;
    }

    // Rule 12: clean = verlauf_changed AND all flags empty AND stored_hash != '' (never-synced ways
    // are always manual) AND (adds/removes non-empty OR hash_only).
    $allFlagsEmpty = $missingStations === []
        && $flags['unroutable_hops'] === []
        && $flags['conflicts'] === []
        && $flags['backtrack_hops'] === [];
    $clean = $type === 'verlauf_changed'
        && $allFlagsEmpty
        && $storedHash !== ''
        && ($hasDiff || $hashOnly);

    return $baseCase + [
        'type' => $type,
        'clean' => $clean,
        'hash_only' => $hashOnly,
        'flags' => $flags,
        'adds' => $adds,
        'removes' => $removes,
        'keeps' => $keeps,
    ];
}

// Paginated case scan for the review UI (GET ?action=verlauf_cases). Walks wiki_path_staging by an
// id cursor, computes a case per row, and time-boxes the batch (STRATO shared hosting). Builds the
// routing context lazily and at most once per kind per request: the expensive full map load
// (avesmapsLoadRouteMapData) and network build happen only when >= 1 way actually needs routing.
//
// $options: cursor (staging id, default 0), limit (default 20, max 50), step_runtime (seconds,
// default 15, max 25). Response: {ok, cases, scanned, next_cursor, complete, runtime_seconds}.
function avesmapsWikiPathVerlaufListCases(PDO $pdo, array $config, array $options = []): array {
    require_once __DIR__ . '/../routing/request.php';
    require_once __DIR__ . '/../routing/map-data.php';
    require_once __DIR__ . '/../routing/network-data.php';
    require_once __DIR__ . '/../routing/client-graph.php';

    avesmapsWikiPathEnsureTables($pdo);

    $cursor = max(0, (int) ($options['cursor'] ?? 0));
    $limit = max(1, min(50, (int) ($options['limit'] ?? 20)));
    $stepRuntime = max(3, min(25, (int) ($options['step_runtime'] ?? 15)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    $assignments = avesmapsWikiPathVerlaufReadAssignments($pdo);

    // Routing context, built lazily and reused across staging rows within this request.
    $mapData = null;
    $networkData = null;
    $locationLookup = null;
    $routersByKind = [];   // kind => callable
    $buildRouter = static function (string $kind) use ($config, &$mapData, &$networkData, &$locationLookup, &$routersByKind): callable {
        if (isset($routersByKind[$kind])) {
            return $routersByKind[$kind];
        }
        $rawRequest = [
            'from' => 'verlauf-sync',
            'to' => 'verlauf-sync',
            'enabled_transports' => $kind === 'fluss'
                ? ['land' => false, 'river' => true, 'sea' => false]
                : ['land' => true, 'river' => false, 'sea' => false],
        ];
        $request = avesmapsNormalizeRouteRequest($rawRequest);
        $mapData ??= avesmapsLoadRouteMapData($config);
        $networkData ??= avesmapsBuildRouteNetworkData($mapData);
        if ($locationLookup === null) {
            $locationLookup = [];
            foreach ($networkData['locations'] as $location) {
                $name = (string) ($location['name'] ?? '');
                if ($name !== '') {
                    $locationLookup[avesmapsWikiPathVerlaufLower($name)] = $name;
                }
            }
        }
        $graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
        $router = static function (string $from, string $to) use ($graph, $request): array {
            $result = avesmapsFindClientCompatibleRoute($graph, $from, $to, $request);
            if (empty($result['found'])) {
                return ['found' => false, 'reason' => 'no_route', 'segments' => []];
            }
            $segments = avesmapsBuildClientRouteDiagnosticSegments(is_array($result['segments'] ?? null) ? $result['segments'] : []);
            return ['found' => true, 'reason' => '', 'segments' => $segments];
        };
        $routersByKind[$kind] = $router;
        return $router;
    };

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
        $case = avesmapsWikiPathVerlaufComputeCase($row, $assignments, $locationLookup ?? [], $router);
        if ($case !== null) {
            $cases[] = $case;
        }
    }

    $complete = !$stoppedEarly && count($rows) < $limit;

    return [
        'ok' => true,
        'cases' => $cases,
        'scanned' => $scanned,
        'next_cursor' => $nextCursor,
        'complete' => $complete,
        'runtime_seconds' => round(microtime(true) - $startedAt, 3),
    ];
}
