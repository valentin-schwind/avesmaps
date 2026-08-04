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

// The eight editors, plus the map layers that are worked on without opening a window. A value
// outside this list becomes null rather than being stored: the panel list is user-visible and must
// not be fillable with free text.
//
// 💣 'political_map' and 'territories' are deliberately NOT the same code. The write claim is keyed
// on 'territories', so only the territory editor may report it; the political map layer reports its
// own code, which shows the work and grants nothing. Merging the two would let anyone who switched
// that layer on lock every other editor out of saving.
const AVESMAPS_EDITOR_ACTIVITY_AREAS = [
    'territories',
    'paths',
    'ecosystem',
    'settlements',
    'powerlines',
    'citymaps',
    'adventures',
    'wikisync',
    // The map layers, for work done without opening an editor window at all. The standard map is
    // the busiest of them: places, ways and markers are all created there.
    'political_map',
    'standard_map',
    'original_map',
    'plain_map',
];

// Deliberately longer than AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS (90): the green dot may go out
// while the claim survives. The holder may have unsaved work in the editor, and on shared hosting
// one missed request is no proof of absence. The panel stays honest by reporting both ages.
const AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS = 180;

const AVESMAPS_EDITOR_ACTIVITY_LABEL_MAX = 190;

// Both ways of working on territories hold the SAME write claim: the editor window, and the
// political map layer -- where polygons are clicked, moved, split, merged and deleted directly.
// Owner 2026-08-04, after two admins edited the same areas side by side: "am besten waers wenn er
// dieselbe ansicht haette wie im front end - solang ich drauf bin".
//
// An earlier version deliberately let the map layer claim nothing, on the theory that switching a
// layer on is merely looking. It is not: that layer is where the geometry work happens.
const AVESMAPS_TERRITORY_CLAIM_AREAS = ['territories', 'political_map'];

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

    // An admin who pressed "Bearbeiten erzwingen" outranks everyone, so nobody can be locked out of
    // their own map by a colleague who wandered off with a tab open. Among several, the most recent
    // override wins -- so a forced claim can itself be taken over, and the feature cannot deadlock.
    $forced = array_values(array_filter(
        $fresh,
        static fn(array $row): bool => $row['seconds_since_forced'] !== null
            && (int) $row['seconds_since_forced'] <= $claimSeconds
    ));
    if ($forced !== []) {
        usort($forced, static function (array $left, array $right): int {
            // SMALLEST age = most recently forced. The opposite of the arrival rule below, because
            // this asks "who overruled last", not "who was here first".
            $byForced = (int) $left['seconds_since_forced'] <=> (int) $right['seconds_since_forced'];

            return $byForced !== 0 ? $byForced : ((int) $left['user_id'] <=> (int) $right['user_id']);
        });

        return $forced[0];
    }

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
/**
 * @param string|array<int, string> $area one area code, or several that share one claim
 */
function avesmapsReadEditorAreaClaim(PDO $pdo, string|array $area): ?array
{
    // Several codes can share one claim: the territory editor window and the political map layer
    // are two ways of working on the same thing (AVESMAPS_TERRITORY_CLAIM_AREAS). They stay
    // separate codes so the panel can name which one someone is in.
    $areas = is_array($area) ? array_values($area) : [$area];
    $placeholders = implode(', ', array_map(static fn(int $i): string => ':area' . $i, array_keys($areas)));
    $parameters = [];
    foreach ($areas as $index => $code) {
        $parameters['area' . $index] = $code;
    }

    try {
        $statement = $pdo->prepare(
            'SELECT user_id, username, activity_area, activity_label,
                    TIMESTAMPDIFF(SECOND, activity_since,   NOW(3)) AS seconds_since_activity,
                    TIMESTAMPDIFF(SECOND, claim_forced_at,  NOW(3)) AS seconds_since_forced,
                    TIMESTAMPDIFF(SECOND, last_seen,        NOW(3)) AS seconds_since_seen
            FROM editor_presence
            WHERE activity_area IN (' . $placeholders . ')'
        );
        $statement->execute($parameters);
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

// "Bearbeiten erzwingen" -- admin only, enforced by the caller. Stamps an override on the caller's
// own presence row; the next claim read hands them the write right (see avesmapsPickEditorAreaClaim).
// Nothing is taken away from anyone: the previous holder's row is untouched and simply stops
// outranking. That keeps the claim derived, with no state that could be left behind.
function avesmapsForceEditorAreaClaim(PDO $pdo, array $user, string $area): void
{
    $statement = $pdo->prepare(
        'UPDATE editor_presence
        SET claim_forced_at = NOW(3),
            activity_area = :area,
            activity_since = COALESCE(activity_since, NOW(3)),
            last_seen = NOW(3)
        WHERE user_id = :user_id'
    );
    $statement->execute(['area' => $area, 'user_id' => (int) ($user['id'] ?? 0)]);
}

/**
 * The claim held by SOMEONE ELSE, or null when the caller may write.
 *
 * Asymmetric on purpose: when nobody holds the area, everybody may write. A client that fails to
 * report its activity therefore loses its protection -- never its ability to work.
 *
 * @param string|array<int, string> $area
 * @return array<string, mixed>|null
 */
function avesmapsBlockingEditorAreaClaim(PDO $pdo, string|array $area, array $user): ?array
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
        'claim_forced_at' => 'DATETIME(3) NULL',
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
