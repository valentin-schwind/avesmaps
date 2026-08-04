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
    try {
        $statement = $pdo->prepare(
            'SELECT user_id, username, activity_label,
                    TIMESTAMPDIFF(SECOND, activity_since, NOW(3)) AS seconds_since_activity,
                    TIMESTAMPDIFF(SECOND, last_seen,      NOW(3)) AS seconds_since_seen
            FROM editor_presence
            WHERE activity_area = :area'
        );
        $statement->execute(['area' => $area]);
    } catch (PDOException $exception) {
        // 💣 FAIL OPEN, and this is not a nicety. The presence table may not exist yet (fresh
        // install), and the activity columns certainly do not in the seconds between this feature
        // deploying and the first heartbeat retrofitting them. This function also runs inside the
        // territory WRITE gate -- so letting the exception escape would turn "the claim is not set
        // up yet" into a 500 on every single territory save until somebody happened to open the
        // presence panel. A claim is a protection; a missing protection must never become a block.
        if (!avesmapsIsMissingTableError($exception) && !avesmapsIsMissingColumnError($exception)) {
            throw $exception;
        }

        return null;
    }

    return avesmapsPickEditorAreaClaim($statement->fetchAll(), AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS);
}

// True when the exception means "the table does not exist yet" -- across MySQL (SQLSTATE 42S02 /
// "doesn't exist" / "base table or view not found") and SQLite ("no such table", used by test
// harnesses). Any other error is a real failure and must propagate.
//
// These two live here rather than in presence.php because BOTH callers of the claim need them: the
// presence endpoint to repair the schema, and the territory write gate to stay open while it is
// still missing.
function avesmapsIsMissingTableError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S02') {
        return true;
    }
    $message = strtolower($exception->getMessage());

    return str_contains($message, "doesn't exist")
        || str_contains($message, 'base table or view not found')
        || str_contains($message, 'no such table');
}

// True when the exception means "the column does not exist yet" -- MySQL SQLSTATE 42S22 / "unknown
// column". Separate from the missing-table check because the repair is a different one (ALTER
// TABLE, not CREATE TABLE) and because a live table that predates a retrofit is the normal state
// right after a deploy, not an error worth a 500.
function avesmapsIsMissingColumnError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S22') {
        return true;
    }

    return str_contains(strtolower($exception->getMessage()), 'unknown column');
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
//
// 💣 quote() + query(), NEVER prepare(). api/_internal/bootstrap.php sets
// PDO::ATTR_EMULATE_PREPARES => false, so a prepared statement goes to MySQL's native protocol,
// which does not accept a placeholder in SHOW ... LIKE ?. The first version of this function used
// prepare() and took the entire presence endpoint down: the PDOException it raised is neither
// "missing table" nor "unknown column", so it went straight past the caller's repair catch and
// surfaced as "Der Editor-Status konnte nicht gespeichert werden." on every heartbeat.
// This is the same shape as avesmapsEnsureContactColumn (api/app/contact.php) and
// avesmapsEnsureMapReportColumn (api/app/report-location.php) -- the house pattern, and now the
// pattern here too. Guarded by editor-activity-test.php.
function avesmapsEnsureEditorActivityColumns(PDO $pdo): void
{
    $columns = [
        'activity_area' => 'VARCHAR(40) NULL',
        'activity_label' => 'VARCHAR(190) NULL',
        'activity_since' => 'DATETIME(3) NULL',
    ];

    foreach ($columns as $column => $definition) {
        $quotedColumn = $pdo->quote($column);
        $probe = $pdo->query("SHOW COLUMNS FROM editor_presence LIKE {$quotedColumn}");
        if ($probe !== false && $probe->fetch() !== false) {
            continue;
        }
        $pdo->exec("ALTER TABLE editor_presence ADD COLUMN {$column} {$definition}");
    }
}
