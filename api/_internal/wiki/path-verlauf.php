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
// 'reason' => ''|'inactive_or_missing'|'reassigned'|'editor_source'|'already_stamped',
// 'props' => array|null].
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
    $hash = avesmapsWikiPathCourseHash($auditVerlauf);
    // Self-feed guard: a segment already stamped by verlauf-sync whose stored course_hash already
    // matches this audit verlauf is a no-op -- re-stamping it would write a fresh audit row that the
    // backfill's own scan filter then matches, so the cursor never reaches `complete`. Skip it
    // without an UPDATE. The empty/absent case (no stored hash, empty audit verlauf) also matches:
    // both sides hash to '' and nothing would change.
    if ((string) ($wikiPath['source'] ?? '') === 'verlauf-sync' && (string) ($wikiPath['course_hash'] ?? '') === $hash) {
        return ['action' => 'skip', 'reason' => 'already_stamped', 'props' => null];
    }
    $wikiPath['source'] = 'verlauf-sync';
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

    $skipped = ['inactive_or_missing' => 0, 'reassigned' => 0, 'editor_source' => 0, 'already_stamped' => 0];
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
//   byWikiKey[wiki_key][public_id] => ['public_id','name','subtype','source','course_hash','course_hops']
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
        // Current hop labels for this segment (Task 5 restamp compares stored vs. Soll hops to skip
        // a no-op restamp when both hash and hops already match).
        $courseHops = is_array($wikiPath['course_hops'] ?? null) ? array_values(array_map('strval', $wikiPath['course_hops'])) : [];

        $byWikiKey[$wikiKey][$publicId] = [
            'public_id' => $publicId,
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'source' => $source,
            'course_hash' => $courseHash,
            'course_hops' => $courseHops,
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
//       'segments'=>[['public_id'=>string, 'name'=>string], ...], 'via'=>[node names between the
//       endpoints]]  (synthetic Querfeldein already post-filtered out by the caller in
//       avesmapsWikiPathVerlaufListCases).
//   $locationLookup[mb_strtolower(name)] => canonicalName  (case-insensitive station match).
//   $townLookup[mb_strtolower(name)] => true for settlements of rank kleinstadt and above.
//       When non-empty, a hop whose route passes THROUGH such a town that the wiki chain does
//       not list is unroutable (reason 'foreign_town') -- owner rule 2026-07-06: assignment may
//       only run on routes between the wiki-listed cities (Reichsstrasse 3 detoured via
//       Alfenmohn/Winhall corridors otherwise).
function avesmapsWikiPathVerlaufComputeCase(array $stagingRow, array $assignments, array $locationLookup, callable $router, array $townLookup = []): ?array {
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

    // Foreign-town guard whitelist: every wiki-listed station (matched or not) is a
    // legitimate through-town; everything else of town rank flags the hop.
    $stationKeys = [];
    foreach ($stations as $station) {
        $stationKeys[avesmapsWikiPathVerlaufLower($station)] = true;
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
    $sollNames = [];            // public_id => router-provided segment name (first non-empty wins)
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

        // Foreign-town guard: the hop must not pass THROUGH a town the wiki chain does not
        // list (routing "fastest" otherwise drags the way over foreign corridors).
        if ($townLookup !== []) {
            $foreignTowns = [];
            foreach ((is_array($result['via'] ?? null) ? $result['via'] : []) as $viaName) {
                $viaKey = avesmapsWikiPathVerlaufLower((string) $viaName);
                if (isset($townLookup[$viaKey]) && !isset($stationKeys[$viaKey]) && !in_array((string) $viaName, $foreignTowns, true)) {
                    $foreignTowns[] = (string) $viaName;
                }
            }
            if ($foreignTowns !== []) {
                $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'foreign_town', 'towns' => $foreignTowns];
                $anyUnroutable = true;
                continue;
            }
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
            if (($sollNames[$publicId] ?? '') === '') {
                $segmentName = (string) ($segment['name'] ?? '');
                if ($segmentName !== '') {
                    $sollNames[$publicId] = $segmentName;
                }
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
        // Prefer the router's own segment name (rule 7 data); fall back to the current
        // assignment index for completeness (e.g. a foreign-owned segment we skipped above,
        // or a router result that omitted the name).
        $addName = $sollNames[$publicId] ?? '';
        if ($addName === '') {
            $addName = (string) ($foreign['name'] ?? '');
        }
        $adds[] = ['public_id' => (string) $publicId, 'name' => $addName, 'hops' => $hops];
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

// Pure write planner (Task 5). Turns a recomputed case (Soll) plus the way's CURRENT segment state
// into the exact set of writes ApplyCase executes, honouring the owner-edit-since-compute traps:
//   - adds     => [public_id => hops]  every routable Soll-Add (always written single-segment).
//   - removes  => [public_id, ...]      Ist-Removes whose CURRENT source is STILL 'verlauf-sync'
//                                        (owner may have flipped it or the row may have vanished
//                                        from Ist between compute and write -> drop it, never clear).
//   - restamps => [public_id => hops]   Soll ∩ Ist keeps whose stored course_hash != staging_hash OR
//                                        whose stored course_hops differ from this keep's hops
//                                        (hash-only cases restamp here; provenance/source untouched).
// $currentByPublicId[public_id] => ['source' => s, 'course_hash' => s, 'course_hops' => array].
function avesmapsWikiPathVerlaufPlanWrites(array $case, array $currentByPublicId): array {
    $stagingHash = (string) ($case['staging_hash'] ?? '');

    $adds = [];
    foreach (is_array($case['adds'] ?? null) ? $case['adds'] : [] as $add) {
        $publicId = (string) ($add['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $adds[$publicId] = is_array($add['hops'] ?? null) ? array_values(array_map('strval', $add['hops'])) : [];
    }

    $removes = [];
    foreach (is_array($case['removes'] ?? null) ? $case['removes'] : [] as $remove) {
        $publicId = (string) ($remove['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $current = $currentByPublicId[$publicId] ?? null;
        // Owner may have re-touched (source flipped) or unassigned the segment between compute and
        // write: only clear rows still owned by verlauf-sync (invariant 2 / spec §3 remove rule).
        if (is_array($current) && (string) ($current['source'] ?? '') === 'verlauf-sync') {
            $removes[] = $publicId;
        }
    }

    $restamps = [];
    foreach (is_array($case['keeps'] ?? null) ? $case['keeps'] : [] as $keep) {
        $publicId = (string) ($keep['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $current = $currentByPublicId[$publicId] ?? null;
        if (!is_array($current)) {
            continue;
        }
        $hops = is_array($keep['hops'] ?? null) ? array_values(array_map('strval', $keep['hops'])) : [];
        $currentHops = is_array($current['course_hops'] ?? null) ? array_values(array_map('strval', $current['course_hops'])) : [];
        $hashMatches = (string) ($current['course_hash'] ?? '') === $stagingHash;
        if ($hashMatches && $currentHops === $hops) {
            continue;
        }
        $restamps[$publicId] = $hops;
    }

    return ['adds' => $adds, 'removes' => $removes, 'restamps' => $restamps];
}

// Case-status side-table (Task 4): persists ONLY the user's review decision (deferred/archived) per
// wiki way, keyed by wiki_key. "open" cases are computed live in avesmapsWikiPathVerlaufListCases (a
// staging row whose hash differs from the way's current stored hash); a persisted status applies only
// while its stored course_hash still matches that staging hash -- a later wiki course edit changes the
// staging hash and the case reopens automatically (deviation from the political_capital_case_status
// pattern, justified because verlauf cases are versioned by course). Convention as elsewhere in the
// schema: no FK constraints.
function avesmapsWikiPathVerlaufEnsureCaseTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_path_verlauf_case_status (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

// Persists the user's review decision for a verlauf-sync case. defer/archive upsert the override,
// stamped with the wiki way's CURRENT staging hash (so a later wiki edit auto-reopens the case, see
// the table comment above); reopen ('open') removes it so the case falls back to its live-computed
// open state. The apply path (Task 5) deletes the row entirely on a successful sync, same as
// avesmapsPoliticalAssignCapital does for political_capital_case_status.
function avesmapsWikiPathVerlaufUpdateCaseStatus(PDO $pdo, string $wikiKey, string $status, ?array $resolution, int $userId): array {
    avesmapsWikiPathVerlaufEnsureCaseTable($pdo);

    if (!in_array($status, ['open', 'deferred', 'archived'], true)) {
        throw new RuntimeException('Unknown case status.');
    }

    if ($status === 'open') {
        $pdo->prepare('DELETE FROM wiki_path_verlauf_case_status WHERE wiki_key = :k')
            ->execute(['k' => $wikiKey]);
        return ['ok' => true, 'wiki_key' => $wikiKey, 'status' => 'open'];
    }

    $stagingStatement = $pdo->prepare('SELECT verlauf FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $stagingStatement->execute(['k' => $wikiKey]);
    $stagingRow = $stagingStatement->fetch(PDO::FETCH_ASSOC);
    if ($stagingRow === false) {
        throw new RuntimeException('Unknown wiki way: ' . $wikiKey);
    }
    $courseHash = avesmapsWikiPathCourseHash((string) ($stagingRow['verlauf'] ?? ''));

    $resolutionJson = $resolution !== null
        ? json_encode($resolution, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        : null;
    $reviewedBy = $userId > 0 ? $userId : null;

    $statement = $pdo->prepare(
        'INSERT INTO wiki_path_verlauf_case_status (wiki_key, status, course_hash, resolution_json, reviewed_by)
        VALUES (:wiki_key, :status, :course_hash, :resolution_json, :reviewed_by)
        ON DUPLICATE KEY UPDATE status = VALUES(status), course_hash = VALUES(course_hash), resolution_json = VALUES(resolution_json), reviewed_by = VALUES(reviewed_by)'
    );
    $statement->execute([
        'wiki_key' => $wikiKey,
        'status' => $status,
        'course_hash' => $courseHash,
        'resolution_json' => $resolutionJson,
        'reviewed_by' => $reviewedBy,
    ]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'status' => $status];
}

// Paginated case scan for the review UI (GET ?action=verlauf_cases). Walks wiki_path_staging by an
// id cursor, computes a case per row, and time-boxes the batch (STRATO shared hosting). Builds the
// routing context lazily and at most once per kind per request: the expensive full map load
// (avesmapsLoadRouteMapData) and network build happen only when >= 1 way actually needs routing.
//
// $options: cursor (staging id, default 0), limit (default 20, max 50), step_runtime (seconds,
// default 15, max 25). Response: {ok, cases, scanned, next_cursor, complete, runtime_seconds}.
// Shared lazy routing context for the verlauf-sync case engine (used by both ListCases and the
// ApplyCase/ApplyCleanCases flow). Loads the routing libs, then builds -- at most once per kind per
// request, and only when actually asked -- a router closure per transport kind plus the station
// name lookup. The expensive avesmapsLoadRouteMapData / network build happen lazily on first
// router() call, so a scan that never needs routing never pays for them. Returns:
//   ['router' => fn(string $kind): callable,  'lookup' => fn(): array (name-lower => canonicalName)]
// The lookup is populated as a side effect of the first router() call (it needs the loaded network);
// callers pass lookup() into avesmapsWikiPathVerlaufComputeCase AFTER building the kind's router.
function avesmapsWikiPathVerlaufBuildRoutingContext(array $config): array {
    require_once __DIR__ . '/../routing/request.php';
    require_once __DIR__ . '/../routing/map-data.php';
    require_once __DIR__ . '/../routing/network-data.php';
    require_once __DIR__ . '/../routing/client-graph.php';

    $mapData = null;
    $networkData = null;
    $locationLookup = null;
    $townLookup = null;    // lowered name => true for kleinstadt and above (foreign-town guard)
    $routersByKind = [];   // kind => callable

    $router = static function (string $kind) use ($config, &$mapData, &$networkData, &$locationLookup, &$townLookup, &$routersByKind): callable {
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
            $townLookup = [];
            foreach ($networkData['locations'] as $location) {
                $name = (string) ($location['name'] ?? '');
                if ($name === '') {
                    continue;
                }
                $locationLookup[avesmapsWikiPathVerlaufLower($name)] = $name;
                if (in_array(strtolower((string) ($location['subtype'] ?? '')), ['metropole', 'grossstadt', 'stadt', 'kleinstadt'], true)) {
                    $townLookup[avesmapsWikiPathVerlaufLower($name)] = true;
                }
            }
        }
        $graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
        $kindRouter = static function (string $from, string $to) use ($graph, $request): array {
            $result = avesmapsFindClientCompatibleRoute($graph, $from, $to, $request);
            if (empty($result['found'])) {
                return ['found' => false, 'reason' => 'no_route', 'segments' => []];
            }
            $segments = avesmapsBuildClientRouteDiagnosticSegments(is_array($result['segments'] ?? null) ? $result['segments'] : []);
            // node_ids are graph node NAMES; the intermediate ones feed the foreign-town guard.
            $nodeIds = is_array($result['node_ids'] ?? null) ? $result['node_ids'] : [];
            $via = array_map('strval', array_slice($nodeIds, 1, max(0, count($nodeIds) - 2)));
            return ['found' => true, 'reason' => '', 'segments' => $segments, 'via' => $via];
        };
        $routersByKind[$kind] = $kindRouter;
        return $kindRouter;
    };

    $lookup = static function () use (&$locationLookup): array {
        return $locationLookup ?? [];
    };
    $towns = static function () use (&$townLookup): array {
        return $townLookup ?? [];
    };

    return ['router' => $router, 'lookup' => $lookup, 'towns' => $towns];
}

// Batch-fills missing adds[].name across a set of cases from map_features in ONE bounded IN-query.
// The real router segments (avesmapsBuildClientRouteDiagnosticSegments) carry no `name` key, so the
// rule-7 router-name channel comes up empty in production and adds[].name is often '' (a foreign
// row's name from $byPublicId is the only other source, and that rarely fires). This restores the
// UI label without touching the routing lib: collect every add id whose name is still empty across
// all $cases, resolve names once, then patch the case arrays in place. Cases are passed by reference.
function avesmapsWikiPathVerlaufFillAddNames(PDO $pdo, array &$cases): void {
    $missingIds = [];
    foreach ($cases as $case) {
        foreach (is_array($case['adds'] ?? null) ? $case['adds'] : [] as $add) {
            $publicId = (string) ($add['public_id'] ?? '');
            if ($publicId !== '' && (string) ($add['name'] ?? '') === '') {
                $missingIds[$publicId] = true;
            }
        }
    }
    if ($missingIds === []) {
        return;
    }

    $ids = array_keys($missingIds);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $select = $pdo->prepare(
        "SELECT public_id, name FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND public_id IN (" . $placeholders . ')'
    );
    $select->execute($ids);
    $nameById = [];
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $nameById[(string) ($row['public_id'] ?? '')] = (string) ($row['name'] ?? '');
    }

    foreach ($cases as &$case) {
        if (!is_array($case['adds'] ?? null)) {
            continue;
        }
        foreach ($case['adds'] as &$add) {
            $publicId = (string) ($add['public_id'] ?? '');
            if ($publicId !== '' && (string) ($add['name'] ?? '') === '' && ($nameById[$publicId] ?? '') !== '') {
                $add['name'] = $nameById[$publicId];
            }
        }
        unset($add);
    }
    unset($case);
}

// Single-case convenience wrapper for avesmapsWikiPathVerlaufFillAddNames: patches one case's
// adds[].name in place via the same one-query path.
function avesmapsWikiPathVerlaufFillAddNamesForCase(PDO $pdo, array &$case): void {
    $wrapper = [$case];
    avesmapsWikiPathVerlaufFillAddNames($pdo, $wrapper);
    $case = $wrapper[0];
}

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
        $case = avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup(), $router, $towns());
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

    return avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup(), $router, $towns());
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
        $case = avesmapsWikiPathVerlaufComputeCase($row, $assignments, $lookup(), $router, $towns());
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
