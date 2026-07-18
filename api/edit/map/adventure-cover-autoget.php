<?php

declare(strict_types=1);

// The adventure-cover autoget RUN (cap 'edit'). One bounded, GUARDED step per request; the CLIENT drives
// the repetition (js/review/review-adventure-cover-autoget.js). Built to the SAME pattern as
// citymap-autoget.php and sharing its safety core (avesmapsAutogetGuardedStep + the ONE lock name): a
// single-flight GET_LOCK, a ~4s budget, a DB kill-switch, and NO EnsureTables on the step path. STRATO has
// no cron; looping a heavy endpoint once saturated the pool (php-pool-hang-incident-2026-07-17).
//
// The work unit is an adventure whose LOCAL cover is missing and that has a wiki cover source. The fetch
// itself is avesmapsAdventureSaveCoverLocal (the same one the reconcile and the single-cover refetch use)
// -- this endpoint only adds the resumable, guarded calling frame.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/adventures.php';                // ensure tables, kill-switch, SetAdventureCoverUrl
require_once __DIR__ . '/../../_internal/app/autoget-run.php';               // the shared gate
require_once __DIR__ . '/../../_internal/wiki/sync.php';                     // AVESMAPS_WIKI_PAGE_BASE_URL + wiki sync constants (used by adventure-sync helpers)
require_once __DIR__ . '/../../_internal/wiki/locations-helpers.php';        // avesmapsWikiSyncNextMapRevision (covers travel in the map-features payload -> invalidate). NOT in sync.php: it hangs off locations.php, which this endpoint does not load.
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-identity.php';    // HttpGetBinary / ImageExtension / DownscaleCoatBytes (the cover fetch helpers)
require_once __DIR__ . '/../../_internal/wiki/territories-parsing.php';      // avesmapsWikiSyncPoliticalTerritoryFilePathUrl (cover file -> wiki image URL)
require_once __DIR__ . '/../../_internal/wiki/adventure-sync.php';           // avesmapsAdventureSaveCoverLocal + avesmapsAdventureCoverAutogetStep + staging ensure

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Vorschauen holen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }
    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));

    // An adventure is due when the run has not touched it (cover_auto_state IS NULL) and it has a wiki_key.
    // The skip rule (manual cover upload) is NOT in this query -- it lives in the step's code, so filtering
    // here on an origin field cannot make the run silently do nothing (citymaps-autoget-vorschauen trap).
    $dueWhere = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> '' AND cover_auto_state IS NULL";
    $withSource = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> ''";

    if ($action === 'status') {
        avesmapsAdventuresEnsureTables($pdo);
        $counts = [];
        $stmt = $pdo->query('SELECT cover_auto_state AS s, COUNT(*) AS c FROM adventure WHERE ' . $withSource . ' GROUP BY cover_auto_state');
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) ($row['s'] ?? '')] = (int) $row['c'];
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'remaining' => (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $dueWhere)->fetchColumn(),
            'total' => (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $withSource)->fetchColumn(),
            'counts' => $counts,
        ]);
    }

    if ($action === 'reset') {
        avesmapsAdventuresEnsureTables($pdo);
        // Clear the state for every adventure that HAS a source, so all are re-checked. Deliberately NOT
        // filtered on origin: a manual upload just becomes skipped_manual again next run (a cheap code
        // check, no fetch), and filtering on origin is exactly the trap that excludes everything.
        $stmt = $pdo->prepare('UPDATE adventure SET cover_auto_state = NULL WHERE ' . $withSource);
        $stmt->execute();
        avesmapsJsonResponse(200, ['ok' => true, 'reset' => $stmt->rowCount()]);
    }

    if ($action !== 'autoget_step') {
        avesmapsErrorResponse(400, 'invalid_request', 'action muss autoget_step, status oder reset sein.');
    }

    // ---- one guarded step ----
    // No EnsureTables here (the adventure table exists long since). The staging table (wiki_adventure_
    // catalog) is read read-only by the step; it too exists after the first "Dump holen". The step body is
    // wrapped by the shared gate, so {stopped:true}/{busy:true} can come back instead of the tally.
    $enabled = avesmapsAdventureCoverAutogetEnabled($pdo);
    $result = avesmapsAutogetGuardedStep($pdo, $enabled, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $pdo): array {
        return avesmapsAdventureCoverAutogetStep($pdo, AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS);
    });
    avesmapsJsonResponse(200, $result);
} catch (Throwable $exception) {
    // No getMessage() to the client (info disclosure, refactoring milestone M1).
    avesmapsErrorResponse(500, 'server_error', 'Der Vorschau-Durchlauf ist fehlgeschlagen.');
}
