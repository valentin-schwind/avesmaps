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
