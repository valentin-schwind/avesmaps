<?php

declare(strict_types=1);

// V9: the store behind the Landschaften editor's „Zugehörigkeit rechnen" button. The BROWSER
// computes (spec docs/superpowers/specs/2026-07-29-landschaften-v9-vorberechnung-design.md); this
// file only takes the result in chunks and stamps the run.
//
// PURITY CONTRACT (mirrors autoget-run.php): side-effect-free on include -- only const and function
// definitions, no DB connect, no headers. The offline-decidable half (row normalisation, the token
// guard) is pure and unit-tested; the DB half takes a PDO explicitly.

require_once __DIR__ . '/ecosystem.php';

// The token of the run currently in flight. It lives on the stamp row, not in app_setting: the stamp
// is already the one row that describes a run, and a second home for the same fact could disagree
// with it.
//
// Rows per chunk the client may send. Not a correctness limit -- the client slices -- but a ceiling
// that keeps a single request small however far the stock grows. At the drawn-out stock the result
// is over a megabyte; in 2.000-row slices that is roughly eleven ordinary requests.
const AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX = 2000;

/**
 * PURE: does the chunk carry the token of the run currently in flight?
 *
 * 💣 This is the job a GET_LOCK cannot do here. A connection-scoped lock dies with its request, and a
 * run spans many of them -- the same reason dump-lock.php keeps a DB row while autoget-run.php can
 * use GET_LOCK for its single-request steps. Two editors computing at once would otherwise interleave
 * their chunks into one result that is neither of theirs. The second `assignment_begin` wins the
 * token, and the first one's next chunk gets a clean 409 instead of silently corrupting the answer.
 *
 * hash_equals rather than `===` costs nothing and keeps the comparison boring.
 */
function avesmapsPathEcosystemTokenMatches(?string $current, string $offered): bool
{
    return $current !== null && $current !== '' && $offered !== '' && hash_equals($current, $offered);
}

/**
 * PURE: validate and normalise one chunk's rows.
 *
 * Throws InvalidArgumentException on anything a correct client cannot have produced -- a wrong
 * `basis`, an inverted interval, a share outside [0,1]. Storing such a row would make a wrong answer
 * indistinguishable from a computed one, which is the failure mode this whole feature has to avoid:
 * the stamp says "computed", and nothing downstream re-checks.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsPathEcosystemNormalizeRows(string $kind, mixed $rows): array
{
    if (!in_array($kind, ['path', 'overlap', 'territory'], true)) {
        throw new InvalidArgumentException('kind must be path, overlap or territory.');
    }
    if ($rows === null || $rows === '') {
        return [];
    }
    if (!is_array($rows)) {
        throw new InvalidArgumentException('rows must be a list.');
    }
    if (count($rows) > AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX) {
        throw new InvalidArgumentException('A chunk carries at most ' . AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX . ' rows.');
    }

    $readId = static function (mixed $value, string $field): string {
        $id = trim((string) $value);
        if ($id === '' || strlen($id) > 36) {
            throw new InvalidArgumentException($field . ' must be a public id.');
        }
        return $id;
    };
    $readShare = static function (mixed $value): float {
        $share = filter_var($value, FILTER_VALIDATE_FLOAT);
        if ($share === false || $share < 0.0 || $share > 1.0) {
            throw new InvalidArgumentException('share must be a fraction between 0 and 1.');
        }
        return (float) $share;
    };

    $normalized = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            throw new InvalidArgumentException('Every row must be an object.');
        }

        if ($kind === 'path') {
            $basis = filter_var($row['basis'] ?? null, FILTER_VALIDATE_INT);
            if ($basis !== 0 && $basis !== 1) {
                throw new InvalidArgumentException('basis must be 0 (chord) or 1 (curve).');
            }
            $seq = filter_var($row['seq'] ?? null, FILTER_VALIDATE_INT);
            // 💣 Refused, never truncated. More than 255 crossings of one area by one way is a broken
            // geometry; cutting it off would store a plausible-looking half answer. Measured maximum
            // on the live stock: 17.
            if ($seq === false || $seq < 0 || $seq > 255) {
                throw new InvalidArgumentException('seq must be between 0 and 255.');
            }
            $enter = filter_var($row['enter'] ?? null, FILTER_VALIDATE_FLOAT);
            $exit = filter_var($row['exit'] ?? null, FILTER_VALIDATE_FLOAT);
            if ($enter === false || $exit === false || $enter < 0.0 || $exit < $enter) {
                throw new InvalidArgumentException('enter and exit must be arc lengths with exit >= enter.');
            }
            $normalized[] = [
                'path' => $readId($row['path'] ?? null, 'path'),
                'area' => $readId($row['area'] ?? null, 'area'),
                'basis' => (int) $basis,
                'seq' => (int) $seq,
                'enter' => (float) $enter,
                'exit' => (float) $exit,
            ];
            continue;
        }

        if ($kind === 'overlap') {
            $region = $readId($row['region'] ?? null, 'region');
            $other = $readId($row['other'] ?? null, 'other');
            if ($region === $other) {
                throw new InvalidArgumentException('A region cannot overlap itself.');
            }
            $normalized[] = ['region' => $region, 'other' => $other, 'share' => $readShare($row['share'] ?? null)];
            continue;
        }

        $normalized[] = [
            'region' => $readId($row['region'] ?? null, 'region'),
            'territory' => $readId($row['territory'] ?? null, 'territory'),
            'share' => $readShare($row['share'] ?? null),
            'is_aggregate' => !empty($row['aggregate']) ? 1 : 0,
        ];
    }

    return $normalized;
}

// ---- the run ---------------------------------------------------------------------------------
// 💣 NO avesmapsEcosystemEnsureTables ANYWHERE BELOW, and that is two reasons in one: its
// information_schema probes are exactly the load of the pool incident of 2026-07-17, and DDL inside
// a transaction commits it silently -- an ALTER in the middle of a chunk would end the transaction
// that chunk relies on. The tables come into being on the area read and write paths, which run long
// before anyone presses the button.

/**
 * Clear the previous result and hand out a token for this run.
 *
 * A run REPLACES, it never merges: half of yesterday's answer beside half of today's would be
 * indistinguishable from a complete one, and the stamp would go on calling it computed.
 */
function avesmapsPathEcosystemBegin(PDO $pdo, int $userId): array
{
    $runToken = avesmapsUuidV4();

    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM path_ecosystem');
        $pdo->exec('DELETE FROM ecosystem_region_overlap');
        $pdo->exec('DELETE FROM ecosystem_region_territory');
        $statement = $pdo->prepare(
            'INSERT INTO ecosystem_assignment_stamp
                 (id, ecosystem_revision, map_revision, area_count, path_count, overlap_rows,
                  territory_rows, path_rows_chord, path_rows_curve, duration_ms, run_token, completed, computed_by)
             VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0, :token, 0, :user)
             ON DUPLICATE KEY UPDATE run_token = VALUES(run_token), completed = 0,
                                     computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
        );
        $statement->execute(['token' => $runToken, 'user' => $userId > 0 ? $userId : null]);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['run_token' => $runToken];
}

function avesmapsPathEcosystemCurrentToken(PDO $pdo): ?string
{
    $statement = $pdo->query('SELECT run_token FROM ecosystem_assignment_stamp WHERE id = 1');
    $token = $statement !== false ? $statement->fetchColumn() : false;

    return ($token === false || $token === null) ? null : (string) $token;
}

/** public_id -> internal id, for the public_ids of ONE chunk. */
function avesmapsPathEcosystemIdMap(PDO $pdo, string $table, array $publicIds, string $where): array
{
    $unique = array_values(array_unique(array_filter($publicIds, static fn($id) => $id !== '')));
    if ($unique === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($unique), '?'));
    $statement = $pdo->prepare("SELECT id, public_id FROM {$table} WHERE {$where} AND public_id IN ({$placeholders})");
    $statement->execute($unique);

    $map = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $map[(string) $row['public_id']] = (int) $row['id'];
    }

    return $map;
}

/**
 * One chunk, one transaction.
 *
 * Rows whose public_id no longer resolves are DROPPED AND COUNTED, never thrown: between computing
 * and saving, an editor in another window may have deleted a way or an area, and losing the other
 * 1.999 rows of the chunk over it would be the wrong trade. The count travels back so the run can
 * say so out loud instead of quietly storing less than it computed.
 */
function avesmapsPathEcosystemChunk(PDO $pdo, array $payload): array
{
    $kind = avesmapsNormalizeSingleLine((string) ($payload['kind'] ?? ''), 16);
    $rows = avesmapsPathEcosystemNormalizeRows($kind, $payload['rows'] ?? []);
    $offered = trim((string) ($payload['run_token'] ?? ''));
    if (!avesmapsPathEcosystemTokenMatches(avesmapsPathEcosystemCurrentToken($pdo), $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another assignment run has started. Start over.');
    }
    if ($rows === []) {
        return ['written' => 0, 'skipped' => 0];
    }

    $written = 0;
    $skipped = 0;
    $pdo->beginTransaction();
    try {
        if ($kind === 'path') {
            $pathIds = avesmapsPathEcosystemIdMap($pdo, 'map_features', array_column($rows, 'path'), "feature_type = 'path' AND is_active = 1");
            $areaIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_area', array_column($rows, 'area'), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO path_ecosystem (path_id, area_id, basis, seq, enter_distance_mapunits, exit_distance_mapunits)
                 VALUES (:path, :area, :basis, :seq, :enter, :exit)
                 ON DUPLICATE KEY UPDATE enter_distance_mapunits = VALUES(enter_distance_mapunits),
                                         exit_distance_mapunits = VALUES(exit_distance_mapunits)'
            );
            foreach ($rows as $row) {
                if (!isset($pathIds[$row['path']], $areaIds[$row['area']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute([
                    'path' => $pathIds[$row['path']],
                    'area' => $areaIds[$row['area']],
                    'basis' => $row['basis'],
                    'seq' => $row['seq'],
                    'enter' => $row['enter'],
                    'exit' => $row['exit'],
                ]);
                $written++;
            }
        } elseif ($kind === 'overlap') {
            $regionIds = avesmapsPathEcosystemIdMap(
                $pdo,
                'ecosystem_region',
                array_merge(array_column($rows, 'region'), array_column($rows, 'other')),
                'is_active = 1'
            );
            $insert = $pdo->prepare(
                'INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (:region, :other, :share)
                 ON DUPLICATE KEY UPDATE share = VALUES(share)'
            );
            foreach ($rows as $row) {
                if (!isset($regionIds[$row['region']], $regionIds[$row['other']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute(['region' => $regionIds[$row['region']], 'other' => $regionIds[$row['other']], 'share' => $row['share']]);
                $written++;
            }
        } else {
            $regionIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_region', array_column($rows, 'region'), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO ecosystem_region_territory (region_id, territory_public_id, share, is_aggregate)
                 VALUES (:region, :territory, :share, :aggregate)
                 ON DUPLICATE KEY UPDATE share = VALUES(share), is_aggregate = VALUES(is_aggregate)'
            );
            foreach ($rows as $row) {
                if (!isset($regionIds[$row['region']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute([
                    'region' => $regionIds[$row['region']],
                    'territory' => $row['territory'],
                    'share' => $row['share'],
                    'aggregate' => $row['is_aggregate'],
                ]);
                $written++;
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['written' => $written, 'skipped' => $skipped];
}

/**
 * Close the run: count what actually landed, record how long the browser took, mark it complete.
 *
 * 💣 The counts come from COUNT(*), never from what the client claims it sent. A chunk that dropped
 * unresolvable rows would otherwise leave the stamp promising more than the tables hold.
 */
function avesmapsPathEcosystemCommit(PDO $pdo, array $payload, int $userId): array
{
    $offered = trim((string) ($payload['run_token'] ?? ''));
    if (!avesmapsPathEcosystemTokenMatches(avesmapsPathEcosystemCurrentToken($pdo), $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another assignment run has started. Start over.');
    }

    $count = static fn(string $sql): int => (int) $pdo->query($sql)->fetchColumn();
    $statement = $pdo->prepare(
        'UPDATE ecosystem_assignment_stamp
            SET ecosystem_revision = :eco, map_revision = :map, area_count = :areas, path_count = :paths,
                overlap_rows = :overlap, territory_rows = :territory,
                path_rows_chord = :chord, path_rows_curve = :curve,
                duration_ms = :duration, completed = 1, computed_by = :user, computed_at = CURRENT_TIMESTAMP(3)
          WHERE id = 1'
    );
    $statement->execute([
        'eco' => avesmapsReadEcosystemRevision($pdo),
        'map' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'areas' => max(0, (int) ($payload['area_count'] ?? 0)),
        'paths' => max(0, (int) ($payload['path_count'] ?? 0)),
        'overlap' => $count('SELECT COUNT(*) FROM ecosystem_region_overlap'),
        'territory' => $count('SELECT COUNT(*) FROM ecosystem_region_territory'),
        'chord' => $count('SELECT COUNT(*) FROM path_ecosystem WHERE basis = 0'),
        'curve' => $count('SELECT COUNT(*) FROM path_ecosystem WHERE basis = 1'),
        'duration' => max(0, (int) ($payload['duration_ms'] ?? 0)),
        'user' => $userId > 0 ? $userId : null,
    ]);

    return avesmapsPathEcosystemStatus($pdo);
}

/**
 * The stamp plus the CURRENT revisions, so the button can say „veraltet" without a second request.
 *
 * A run that never committed comes back with completed = false, readable as "incomplete" -- which is
 * a different thing from "empty", and an empty run is a legitimate result.
 */
function avesmapsPathEcosystemStatus(PDO $pdo): array
{
    $statement = $pdo->query('SELECT * FROM ecosystem_assignment_stamp WHERE id = 1');
    $stamp = $statement !== false ? $statement->fetch(PDO::FETCH_ASSOC) : false;

    return [
        'stamp' => $stamp === false ? null : [
            'ecosystem_revision' => (int) $stamp['ecosystem_revision'],
            'map_revision' => (int) $stamp['map_revision'],
            'area_count' => (int) $stamp['area_count'],
            'path_count' => (int) $stamp['path_count'],
            'overlap_rows' => (int) $stamp['overlap_rows'],
            'territory_rows' => (int) $stamp['territory_rows'],
            'path_rows_chord' => (int) $stamp['path_rows_chord'],
            'path_rows_curve' => (int) $stamp['path_rows_curve'],
            'duration_ms' => (int) $stamp['duration_ms'],
            'completed' => (int) $stamp['completed'] === 1,
            'computed_at' => (string) $stamp['computed_at'],
        ],
        'current' => [
            'ecosystem_revision' => avesmapsReadEcosystemRevision($pdo),
            'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        ],
    ];
}
