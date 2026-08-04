<?php

declare(strict_types=1);

/**
 * Who is currently working in which editor -- and, for the territory tree, who holds the write
 * right.
 *
 * The claim is DERIVED, never stored. There is no lock table, no acquire and no release: the
 * owner is computed from editor_presence on every request, so a claim cannot leak when a browser
 * dies, and two clients cannot both win a race -- the decision is a total order over the same
 * rows, so it comes out identical for everyone who asks.
 *
 * Design: docs/superpowers/specs/2026-08-04-editor-taetigkeit-und-territorien-sperre-design.md
 */

// The eight editors that exist. A value outside this list becomes null rather than being stored:
// the panel list is user-visible and must not be fillable with free text.
const AVESMAPS_EDITOR_ACTIVITY_AREAS = [
    'territories',
    'paths',
    'ecosystem',
    'settlements',
    'powerlines',
    'citymaps',
    'adventures',
    'wikisync',
];

// Deliberately longer than AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS (90): the green dot may go out
// while the claim survives. The holder may have unsaved work in the editor, and on shared hosting
// one missed request is no proof of absence. The panel stays honest by reporting both ages.
const AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS = 180;

const AVESMAPS_EDITOR_ACTIVITY_LABEL_MAX = 190;

function avesmapsNormalizeEditorActivityArea(?string $area): ?string
{
    $normalized = strtolower(trim((string) $area));

    return in_array($normalized, AVESMAPS_EDITOR_ACTIVITY_AREAS, true) ? $normalized : null;
}

function avesmapsNormalizeEditorActivityLabel(?string $label): ?string
{
    $collapsed = trim((string) preg_replace('/\s+/u', ' ', (string) $label));
    if ($collapsed === '') {
        return null;
    }

    return mb_substr($collapsed, 0, AVESMAPS_EDITOR_ACTIVITY_LABEL_MAX);
}

/**
 * Pure: pick the owner of an area from its candidate rows.
 *
 * Rows come straight from the presence table and carry AGES in seconds, not timestamps -- so no
 * timezone can get between the database and this decision.
 *
 * @param array<int, array<string, mixed>> $rows
 * @return array<string, mixed>|null
 */
function avesmapsPickEditorAreaClaim(array $rows, int $claimSeconds): ?array
{
    $fresh = array_values(array_filter(
        $rows,
        static fn(array $row): bool => (int) ($row['seconds_since_seen'] ?? PHP_INT_MAX) <= $claimSeconds
    ));

    // seconds_since_activity is a DISTANCE: the LARGEST value is the earliest arrival, and the
    // earliest arrival owns the claim. Sorting this ascending silently hands the write right to
    // whoever showed up last. The tie-break on user_id is what makes two simultaneous openings
    // resolve to the same answer on both clients.
    usort($fresh, static function (array $left, array $right): int {
        $byAge = (int) $right['seconds_since_activity'] <=> (int) $left['seconds_since_activity'];

        return $byAge !== 0 ? $byAge : ((int) $left['user_id'] <=> (int) $right['user_id']);
    });

    return $fresh[0] ?? null;
}

/**
 * @return array<string, mixed>|null
 */
function avesmapsReadEditorAreaClaim(PDO $pdo, string $area): ?array
{
    $statement = $pdo->prepare(
        'SELECT user_id, username, activity_label,
                TIMESTAMPDIFF(SECOND, activity_since, NOW(3)) AS seconds_since_activity,
                TIMESTAMPDIFF(SECOND, last_seen,      NOW(3)) AS seconds_since_seen
        FROM editor_presence
        WHERE activity_area = :area'
    );
    $statement->execute(['area' => $area]);

    return avesmapsPickEditorAreaClaim($statement->fetchAll(), AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS);
}

/**
 * The claim held by SOMEONE ELSE, or null when the caller may write.
 *
 * Asymmetric on purpose: when nobody holds the area, everybody may write. A client that fails to
 * report its activity therefore loses its protection -- never its ability to work.
 *
 * @return array<string, mixed>|null
 */
function avesmapsBlockingEditorAreaClaim(PDO $pdo, string $area, array $user): ?array
{
    $claim = avesmapsReadEditorAreaClaim($pdo, $area);
    if ($claim === null || (int) $claim['user_id'] === (int) ($user['id'] ?? 0)) {
        return null;
    }

    return $claim;
}

// Retrofit for the live table: CREATE TABLE IF NOT EXISTS does NOT add columns to a table that
// already exists. Each column is probed on its own -- a half-migrated table (one ALTER applied,
// the next interrupted) would otherwise stay broken forever behind a single all-or-nothing check.
function avesmapsEnsureEditorActivityColumns(PDO $pdo): void
{
    $columns = [
        'activity_area' => 'ALTER TABLE editor_presence ADD COLUMN activity_area VARCHAR(40) NULL',
        'activity_label' => 'ALTER TABLE editor_presence ADD COLUMN activity_label VARCHAR(190) NULL',
        'activity_since' => 'ALTER TABLE editor_presence ADD COLUMN activity_since DATETIME(3) NULL',
    ];

    foreach ($columns as $column => $ddl) {
        $probe = $pdo->prepare('SHOW COLUMNS FROM editor_presence LIKE :column');
        $probe->execute(['column' => $column]);
        if ($probe->fetchColumn() === false) {
            $pdo->exec($ddl);
        }
    }
}
