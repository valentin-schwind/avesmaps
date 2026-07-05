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
