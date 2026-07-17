<?php

declare(strict_types=1);

// Localising settlement coats of arms: copy the public-domain ones off wiki-aventurica onto our own
// server, so the map stops hotlinking them. The territory side has done this since forever
// (avesmapsWikiSyncMonitorSaveCoatLocal); settlements only ever got the URL written onto the place
// (avesmapsWikiSettlementBulkRecordCoats), and the "Wappen lokalisieren" button that was supposed to
// finish the job was never wired up (docs/siedlungseditor-plan.md step 1: "Noch keine Logik").
//
// Split into its own file rather than growing settlements.php: the gate below is pure, and a test can
// require THIS file without dragging in the whole settlement API surface and its dependencies.

// Where localised wiki coats land. Deliberately NOT /uploads/wappen/own/ -- that is the human upload
// path, and avesmapsWikiSettlementBulkRecordCoats treats source='own' as untouchable. Mixing the two
// would make an automatic fetch look like someone's own work.
const AVESMAPS_SETTLEMENT_COAT_LOCAL_DIR = '/uploads/wappen/wiki';

/**
 * PURE. What should happen to this place's `properties.coat`? Exactly one answer per coat, so the
 * caller can both act on it and report it -- a run that cannot name why it skipped something reads
 * as "did nothing" (the lesson the link checker already paid for).
 *
 * Returns one of:
 *   due           -- fetch it
 *   own           -- a human uploaded this; never touch it, whatever else the row claims
 *   no_coat       -- nothing to do
 *   other_source  -- not ours to localise (e.g. community)
 *   already_local -- idempotent: a second run is a no-op, which is what terminates the loop
 *   not_free      -- licence does not allow a copy on our server
 *   foreign_host  -- we only fetch from the wiki we have a relationship with
 *
 * @param array<string, mixed> $coat the decoded properties.coat of a location feature
 */
function avesmapsWikiSettlementCoatLocalizeState(array $coat): string
{
    $source = trim((string) ($coat['source'] ?? ''));
    $url = trim((string) ($coat['url'] ?? ''));
    $license = trim((string) ($coat['license_status'] ?? ''));

    // Checked FIRST and before the URL: an own upload is off limits even if the row is otherwise
    // malformed. Same precedence as avesmapsWikiSettlementBulkRecordCoats.
    if ($source === 'own') {
        return 'own';
    }
    if ($url === '') {
        return 'no_coat';
    }
    if ($source !== 'wiki') {
        return 'other_source';
    }
    if (str_starts_with($url, '/uploads/')) {
        return 'already_local';
    }
    // The whole policy hangs here: 'unknown' is the default for a coat nobody classified, so anything
    // that is not explicitly public domain must not be copied (Memory coat-public-domain-policy).
    if ($license !== 'public_domain') {
        return 'not_free';
    }
    if (!avesmapsWikiSettlementCoatUrlIsWikiHost($url)) {
        return 'foreign_host';
    }

    return 'due';
}

/**
 * PURE. Is this URL served by wiki-aventurica itself?
 *
 * Anchored on the host's tail, NOT a substring search: the territory localiser uses
 * `stripos($host, 'wiki-aventurica.de') !== false`, which also accepts
 * `wiki-aventurica.de.attacker.example`. This function is the gate in front of a server-side fetch,
 * so the lookalike must not pass.
 */
function avesmapsWikiSettlementCoatUrlIsWikiHost(string $url): bool
{
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return false;
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if ($scheme !== 'http' && $scheme !== 'https') {
        return false;
    }
    $host = strtolower((string) ($parts['host'] ?? ''));

    return preg_match('/(^|\.)wiki-aventurica\.de$/', $host) === 1;
}

/**
 * PURE. The stored file name for a place's localised coat. public_id, not the settlement name: it is
 * already unique and URL-safe, and a rename must not orphan the file.
 */
function avesmapsWikiSettlementCoatFilename(string $publicId, string $extension): string
{
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', $publicId));
    $slug = trim($slug, '-');
    if ($slug === '') {
        $slug = 'wappen';
    }

    return $slug . '.' . $extension;
}

// ---------------------------------------------------------------------------------------------
// DB + fetch. Requires sync-monitor.php's coat helpers (HttpGetBinary / ImageExtension /
// DownscaleCoatBytes) and sync.php's JSON + revision helpers -- both already loaded by
// api/edit/wiki/settlements.php, resolved at call time like the rest of this layer.
// ---------------------------------------------------------------------------------------------

/**
 * Every location's coat state in one pass, as [state => count]. The scan is a full table walk over
 * the active locations, exactly like avesmapsWikiSettlementBulkRecordCoats next door -- the coat
 * lives inside properties_json, so there is nothing to index on.
 *
 * @return array<string, int>
 */
function avesmapsWikiSettlementCoatLocalizeCounts(PDO $pdo): array
{
    $counts = [];
    $rows = $pdo->query("SELECT properties_json FROM map_features WHERE feature_type='location' AND is_active=1")
        ?: [];
    foreach ($rows as $row) {
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $coat = is_array($props['coat'] ?? null) ? $props['coat'] : [];
        $state = avesmapsWikiSettlementCoatLocalizeState($coat);
        $counts[$state] = ($counts[$state] ?? 0) + 1;
    }

    return $counts;
}

/** How many coats still want fetching -- the client's loop condition. */
function avesmapsWikiSettlementPendingLocalizeCoats(PDO $pdo): int
{
    return (int) (avesmapsWikiSettlementCoatLocalizeCounts($pdo)['due'] ?? 0);
}

/**
 * ONE bounded step: fetch up to $limit due coats, store them under /uploads/wappen/wiki and point the
 * place at the local copy. Resumable -- the client repeats until remaining=0, exactly like the
 * territory button. Never loops the whole set in one request (STRATO, AGENTS.md §9).
 *
 * A failure is recorded and moved past, not retried in-loop: the coat keeps its wiki URL, so it stays
 * visible and simply remains 'due'. The reported `failed` count is what stops the client (no progress
 * -> stop), which is why the run cannot spin forever on a dead image.
 *
 * @return array{ok:bool, processed:int, localized:int, failed:int, remaining:int, errors:array, counts:array}
 */
function avesmapsWikiSettlementLocalizeCoats(PDO $pdo, int $limit = 10, int $sleepMs = 150): array
{
    $limit = max(1, min(40, $limit));
    $sleepMs = max(0, min(3000, $sleepMs));
    @set_time_limit(max(30, $limit * 4 + 20));

    $rows = $pdo->query("SELECT id, public_id, properties_json FROM map_features WHERE feature_type='location' AND is_active=1")
        ->fetchAll(PDO::FETCH_ASSOC);

    $due = [];
    foreach ($rows as $row) {
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $coat = is_array($props['coat'] ?? null) ? $props['coat'] : [];
        if (avesmapsWikiSettlementCoatLocalizeState($coat) !== 'due') {
            continue;
        }
        $due[] = ['id' => (int) $row['id'], 'public_id' => (string) $row['public_id'], 'props' => $props];
    }
    $totalDue = count($due);
    $batch = array_slice($due, 0, $limit);
    if ($batch === []) {
        return ['ok' => true, 'processed' => 0, 'localized' => 0, 'failed' => 0, 'remaining' => 0,
            'errors' => [], 'counts' => avesmapsWikiSettlementCoatLocalizeCounts($pdo)];
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . AVESMAPS_SETTLEMENT_COAT_LOCAL_DIR;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Ordner ' . AVESMAPS_SETTLEMENT_COAT_LOCAL_DIR . ' konnte nicht angelegt werden (Schreibrechte?).'];
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $localized = 0;
    $failed = 0;
    $errors = [];
    $lastIndex = count($batch) - 1;

    foreach ($batch as $index => $item) {
        $coat = $item['props']['coat'];
        $sourceUrl = (string) $coat['url'];
        $fail = static function (string $message) use (&$failed, &$errors, $item): void {
            $failed++;
            if (count($errors) < 20) {
                $errors[] = ['public_id' => $item['public_id'], 'error' => $message];
            }
        };

        $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($sourceUrl);
        if ($downloaded === null) {
            $fail('Wappen konnte nicht heruntergeladen werden.');
        } else {
            $ext = avesmapsWikiSyncMonitorImageExtension($downloaded['content_type'], $sourceUrl);
            if ($ext === null) {
                $fail('Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).');
            } else {
                $filename = avesmapsWikiSettlementCoatFilename($item['public_id'], $ext);
                $bytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($downloaded['bytes'], $ext);
                if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
                    $fail('Wappen konnte nicht gespeichert werden (Schreibrechte?).');
                } else {
                    // source stays 'wiki' and the licence stays public_domain -- localising changes
                    // WHERE the file is, not who made it. wiki_url keeps the provenance visible.
                    $props = $item['props'];
                    $props['coat'] = [
                        'url' => AVESMAPS_SETTLEMENT_COAT_LOCAL_DIR . '/' . $filename,
                        'source' => 'wiki',
                        'license_status' => 'public_domain',
                        'author' => (string) ($coat['author'] ?? ''),
                        'attribution' => (string) ($coat['attribution'] ?? ''),
                        'wiki_url' => $sourceUrl,
                    ];
                    $update->execute([
                        'pj' => avesmapsWikiSyncEncodeJson($props),
                        'rev' => $revision,
                        'id' => $item['id'],
                    ]);
                    $localized++;
                }
            }
        }
        if ($index < $lastIndex) {
            avesmapsWikiSyncMonitorSleep($sleepMs);
        }
    }

    return [
        'ok' => true,
        'processed' => count($batch),
        'localized' => $localized,
        'failed' => $failed,
        'remaining' => max(0, $totalDue - $localized),
        'errors' => $errors,
        'counts' => avesmapsWikiSettlementCoatLocalizeCounts($pdo),
    ];
}
