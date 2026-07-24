<?php

declare(strict_types=1);

/**
 * The stored result of a "Dump holen" run.
 *
 * WHY THIS EXISTS: the run takes about ten minutes, and its outcome lived only in a
 * three-second toast plus a status line that the next click overwrote. Nobody watches a
 * ten-minute job to the second, so the most expensive operation in the editor was
 * effectively unobservable. The run's numbers are now written down once, at the end, and
 * surfaced as a read-only category at the top of the conflict centre.
 *
 * Split in two halves: everything above the "STORAGE" banner is PURE (no PDO, no HTTP) and
 * unit-tested in __tests__/dump-report-test.php; the DB half below is a thin wrapper.
 *
 * Design: docs/superpowers/specs/2026-07-24-dump-bericht-konflikte-design.md
 */

// How many reports are kept. Everything older is deleted on every write.
const AVESMAPS_DUMP_REPORT_KEEP = 5;

// A kind counts as "collapsed" only when it falls by BOTH more than this share AND more than
// this absolute amount. Two thresholds, not one: a ratio alone screams about small kinds (5 -> 3
// powerlines is 40 %), an absolute alone misses a proportional collapse in a small kind.
const AVESMAPS_DUMP_REPORT_DROP_RATIO = 0.10;
const AVESMAPS_DUMP_REPORT_DROP_MIN = 50;

/**
 * PURE: reduce a raw client-supplied report to the snapshot we are willing to store.
 *
 * 💣 SCALARS ONLY. `wiki_sync_runs.stats_json` grew to 99 MiB across 99 rows (~1 MiB each)
 * because a JSON column was used as an inter-phase scratchpad and accumulated whole record
 * arrays (settlement_titles, map_places, matches, ...). This table has the same shape and would
 * be the same accident a second time. The normalizer is the guard: anything that is not a
 * scalar (or a flat map of counts) does not survive it, no matter what the client sends.
 *
 * @param array<string,mixed> $raw
 * @return array<string,mixed>
 */
function avesmapsDumpReportNormalize(array $raw): array
{
    $out = [
        'started_at' => avesmapsDumpReportScalarString($raw['started_at'] ?? ''),
        'finished_at' => avesmapsDumpReportScalarString($raw['finished_at'] ?? ''),
        'steps' => [],
        'selftests' => [],
    ];

    foreach ((array) ($raw['steps'] ?? []) as $stepName => $step) {
        if (!is_string($stepName) || !is_array($step)) {
            continue;
        }
        $clean = [];
        foreach ($step as $key => $value) {
            if (!is_string($key)) {
                continue;
            }
            if ($key === 'by_kind') {
                // The one nested shape we keep: a flat kind => count map. Any value that is not
                // an integer count is dropped rather than coerced -- a smuggled list must not
                // become "1" and pretend to be data.
                $byKind = [];
                foreach ((array) $value as $kind => $count) {
                    if (is_string($kind) && (is_int($count) || (is_string($count) && ctype_digit($count)))) {
                        $byKind[$kind] = (int) $count;
                    }
                }
                $clean['by_kind'] = $byKind;
                continue;
            }
            if (is_bool($value) || is_int($value) || is_float($value)) {
                $clean[$key] = $value;
            } elseif (is_string($value)) {
                $clean[$key] = mb_substr($value, 0, 200, 'UTF-8');
            }
            // arrays/objects at any other key: dropped on purpose (see the banner above).
        }
        $out['steps'][mb_substr($stepName, 0, 40, 'UTF-8')] = $clean;
    }

    foreach (['total', 'green', 'red'] as $key) {
        $out['selftests'][$key] = (int) ($raw['selftests'][$key] ?? 0);
    }
    // The names of failed tests are worth keeping (they are what makes the report actionable),
    // but bounded: a handful of short strings, never an unbounded payload.
    $failed = [];
    foreach ((array) ($raw['selftests']['failed'] ?? []) as $name) {
        if (is_string($name) && $name !== '' && count($failed) < 20) {
            $failed[] = mb_substr($name, 0, 80, 'UTF-8');
        }
    }
    $out['selftests']['failed'] = $failed;

    return $out;
}

/**
 * PURE: a bounded string, or '' for anything that is not one.
 */
function avesmapsDumpReportScalarString(mixed $value): string
{
    return is_string($value) ? mb_substr($value, 0, 40, 'UTF-8') : '';
}

/**
 * PURE: the per-kind counts of a report, or [] when it carries none.
 *
 * @param array<string,mixed>|null $report
 * @return array<string,int>
 */
function avesmapsDumpReportKindCounts(?array $report): array
{
    $counts = [];
    foreach ((array) ($report['steps']['read']['by_kind'] ?? []) as $kind => $count) {
        if (is_string($kind)) {
            $counts[$kind] = (int) $count;
        }
    }

    return $counts;
}

/**
 * PURE: did this run look wrong? Decided ONCE, when the report is stored, and persisted --
 * so rendering the conflict list never recomputes anything.
 *
 * Three rules, in order of how loudly they speak:
 *   1. a self-test came back red,
 *   2. a step did not report ok (an aborted or failed phase),
 *   3. a kind collapsed against the previous run.
 *
 * 💣 Rule 3 is the one that earns its keep. The Art-gate incident swallowed ~430 adventures
 * silently: the run reported success, the numbers were merely lower, and nothing was comparing
 * them to anything. Growth is never notable -- the wiki gaining entries is the normal case --
 * and a kind that did not exist in the previous run is not a collapse.
 *
 * @param array<string,mixed> $report
 * @param array<string,mixed>|null $previous the previously stored report, or null on the first run
 * @return array{notable:bool, reason:string}
 */
function avesmapsDumpReportClassify(array $report, ?array $previous): array
{
    if ((int) ($report['selftests']['red'] ?? 0) > 0) {
        $red = (int) $report['selftests']['red'];
        return ['notable' => true, 'reason' => $red . ' Selbsttest' . ($red === 1 ? '' : 's') . ' rot'];
    }

    foreach ((array) ($report['steps'] ?? []) as $stepName => $step) {
        if (array_key_exists('ok', (array) $step) && ((array) $step)['ok'] === false) {
            return ['notable' => true, 'reason' => 'Schritt „' . (string) $stepName . '" nicht abgeschlossen'];
        }
    }

    if ($previous !== null) {
        $now = avesmapsDumpReportKindCounts($report);
        $was = avesmapsDumpReportKindCounts($previous);
        foreach ($was as $kind => $before) {
            if ($before <= 0 || !array_key_exists($kind, $now)) {
                // Not in the new run at all: the read phase may simply not have carried that kind
                // this time. Absence is not evidence of loss, so it is deliberately not rule 3.
                continue;
            }
            $drop = $before - $now[$kind];
            if ($drop > AVESMAPS_DUMP_REPORT_DROP_MIN && ($drop / $before) > AVESMAPS_DUMP_REPORT_DROP_RATIO) {
                return [
                    'notable' => true,
                    'reason' => $kind . ': ' . $drop . ' weniger als im vorigen Lauf (' . $before . ' → ' . $now[$kind] . ')',
                ];
            }
        }
    }

    return ['notable' => false, 'reason' => ''];
}

/**
 * PURE: per-kind comparison against the previous run, for the report table.
 *
 * A kind present ONLY in the previous run is reported with now=0 -- a kind that vanished
 * entirely is the most severe case there is and must not be silently missing from the table.
 *
 * @param array<string,mixed> $report
 * @param array<string,mixed>|null $previous
 * @return array<string,array{now:int, was:?int, diff:?int}>
 */
function avesmapsDumpReportDelta(array $report, ?array $previous): array
{
    $now = avesmapsDumpReportKindCounts($report);
    $was = $previous === null ? [] : avesmapsDumpReportKindCounts($previous);

    $out = [];
    foreach ($now as $kind => $count) {
        $out[$kind] = $previous === null
            ? ['now' => $count, 'was' => null, 'diff' => null]
            : ['now' => $count, 'was' => $was[$kind] ?? 0, 'diff' => $count - ($was[$kind] ?? 0)];
    }
    foreach ($was as $kind => $before) {
        if (!array_key_exists($kind, $out)) {
            $out[$kind] = ['now' => 0, 'was' => $before, 'diff' => -$before];
        }
    }

    return $out;
}

/**
 * PURE: given report ids newest-first, which ones fall outside the retention window.
 *
 * @param list<int> $idsNewestFirst
 * @return list<int>
 */
function avesmapsDumpReportPruneIds(array $idsNewestFirst): array
{
    return array_values(array_slice($idsNewestFirst, AVESMAPS_DUMP_REPORT_KEEP));
}

// ===========================================================================
// STORAGE (PDO). Everything above this line is pure and unit-tested.
// ===========================================================================

/**
 * Self-healing schema, matching the inline `CREATE TABLE IF NOT EXISTS` pattern the rest of the
 * wiki layer uses (see dump-hybrid-state.php). `run_id` is a plain BIGINT UNSIGNED referencing
 * wiki_sync_runs.id with no FOREIGN KEY -- this table is disposable by design.
 */
function avesmapsEnsureDumpReportTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_dump_report (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            duration_s INT UNSIGNED NOT NULL DEFAULT 0,
            notable TINYINT(1) NOT NULL DEFAULT 0,
            notable_reason VARCHAR(255) NULL,
            report_json MEDIUMTEXT NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_dump_report_run (run_id),
            KEY idx_dump_report_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * Per-kind counts for one run, straight from the sandbox state table.
 *
 * 💣 This is SERVER-derived on purpose. The client cannot supply it: the read loop's progress
 * envelope carries phase cursors and per-step counters, never per-kind totals -- so a
 * client-built by_kind would be guesswork, and the collapse rule (avesmapsDumpReportClassify
 * rule 3) would have nothing to stand on. One GROUP BY over the run's own rows is both cheaper
 * and authoritative.
 *
 * Safe to call after cleanup_state: that step deletes every OTHER run's sandbox rows and keeps
 * the newest completed one -- which is exactly this run.
 *
 * @return array<string,int>
 */
function avesmapsDumpReportKindCountsForRun(PDO $pdo, int $runId): array
{
    $statement = $pdo->prepare(
        "SELECT entity_kind, COUNT(*) AS n
           FROM wiki_dump_hybrid_state
          WHERE run_id = :run AND entity_kind IS NOT NULL AND entity_kind <> ''
       GROUP BY entity_kind"
    );
    $statement->execute(['run' => $runId]);

    $counts = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $counts[(string) $row['entity_kind']] = (int) $row['n'];
    }

    return $counts;
}

/**
 * The newest stored report, decoded, or null when there is none.
 *
 * A row whose report_json is unreadable is treated as absent rather than thrown: a report is a
 * convenience, and it must never be able to break the conflict list that renders it.
 *
 * @return array<string,mixed>|null
 */
function avesmapsDumpReportLatest(PDO $pdo): ?array
{
    avesmapsEnsureDumpReportTable($pdo);
    $row = $pdo->query(
        'SELECT id, run_id, created_at, duration_s, notable, notable_reason, report_json
           FROM wiki_dump_report ORDER BY id DESC LIMIT 1'
    )->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    $decoded = json_decode((string) $row['report_json'], true);
    if (!is_array($decoded)) {
        return null;
    }

    return [
        'run_id' => (int) $row['run_id'],
        'created_at' => (string) $row['created_at'],
        'duration_s' => (int) $row['duration_s'],
        'notable' => (int) $row['notable'] === 1,
        'notable_reason' => (string) ($row['notable_reason'] ?? ''),
        'report' => $decoded,
        'delta' => avesmapsDumpReportDelta($decoded, avesmapsDumpReportPreviousDecoded($pdo, (int) $row['id'])),
    ];
}

/**
 * The report stored immediately BEFORE $beforeId, decoded, or null.
 *
 * @return array<string,mixed>|null
 */
function avesmapsDumpReportPreviousDecoded(PDO $pdo, int $beforeId): ?array
{
    $statement = $pdo->prepare(
        'SELECT report_json FROM wiki_dump_report WHERE id < :id ORDER BY id DESC LIMIT 1'
    );
    $statement->execute(['id' => $beforeId]);
    $json = $statement->fetchColumn();
    if (!is_string($json)) {
        return null;
    }
    $decoded = json_decode($json, true);

    return is_array($decoded) ? $decoded : null;
}

/**
 * Store one run's report: normalize -> classify against the previous one -> upsert -> prune.
 * Idempotent per run_id (a repeated save of the same run overwrites rather than duplicating).
 *
 * @param array<string,mixed> $raw
 * @return array{notable:bool, reason:string}
 */
function avesmapsDumpReportStore(PDO $pdo, int $runId, array $raw): array
{
    avesmapsEnsureDumpReportTable($pdo);

    $report = avesmapsDumpReportNormalize($raw);
    // Fill the per-kind counts server-side, overriding whatever the client sent. See
    // avesmapsDumpReportKindCountsForRun: the client has no access to these numbers, so this is
    // the only place they can come from -- and the collapse rule depends on them being real.
    $byKind = avesmapsDumpReportKindCountsForRun($pdo, $runId);
    if ($byKind !== []) {
        $report['steps']['read'] = ($report['steps']['read'] ?? []) + [];
        $report['steps']['read']['by_kind'] = $byKind;
    }
    // Compare against the newest EXISTING row. Done before the upsert so that re-saving the same
    // run does not end up comparing the run against itself.
    $previousJson = $pdo->prepare(
        'SELECT report_json FROM wiki_dump_report WHERE run_id <> :run ORDER BY id DESC LIMIT 1'
    );
    $previousJson->execute(['run' => $runId]);
    $previousRaw = $previousJson->fetchColumn();
    $previous = is_string($previousRaw) ? json_decode($previousRaw, true) : null;
    $verdict = avesmapsDumpReportClassify($report, is_array($previous) ? $previous : null);

    $duration = 0;
    $startedAt = strtotime((string) ($report['started_at'] ?? ''));
    $finishedAt = strtotime((string) ($report['finished_at'] ?? ''));
    if ($startedAt !== false && $finishedAt !== false && $finishedAt > $startedAt) {
        $duration = $finishedAt - $startedAt;
    }

    $pdo->prepare(
        'INSERT INTO wiki_dump_report (run_id, duration_s, notable, notable_reason, report_json)
         VALUES (:run, :dur, :notable, :reason, :json)
         ON DUPLICATE KEY UPDATE
            duration_s = VALUES(duration_s), notable = VALUES(notable),
            notable_reason = VALUES(notable_reason), report_json = VALUES(report_json),
            created_at = CURRENT_TIMESTAMP(3)'
    )->execute([
        'run' => $runId,
        'dur' => $duration,
        'notable' => $verdict['notable'] ? 1 : 0,
        'reason' => mb_substr($verdict['reason'], 0, 255, 'UTF-8'),
        'json' => (string) json_encode($report, JSON_UNESCAPED_UNICODE),
    ]);

    avesmapsDumpReportPrune($pdo);

    return $verdict;
}

/**
 * Delete everything outside the retention window. Returns how many rows went.
 */
function avesmapsDumpReportPrune(PDO $pdo): int
{
    $ids = [];
    foreach ($pdo->query('SELECT id FROM wiki_dump_report ORDER BY id DESC')->fetchAll(PDO::FETCH_COLUMN) ?: [] as $id) {
        $ids[] = (int) $id;
    }
    $doomed = avesmapsDumpReportPruneIds($ids);
    if ($doomed === []) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($doomed), '?'));
    $delete = $pdo->prepare("DELETE FROM wiki_dump_report WHERE id IN ({$placeholders})");
    $delete->execute($doomed);

    return $delete->rowCount();
}
