<?php

declare(strict_types=1);

// The autoget RUN (cap 'edit'). One bounded, GUARDED step per request; the CLIENT drives the repetition
// (js/review/review-citymap-autoget.js). STRATO has no cron, and looping a heavy endpoint here once
// saturated the PHP workers and looked like a DB outage (php-pool-hang-incident-2026-07-17) -- so there is
// deliberately no "do it all" action, and every step now goes through avesmapsAutogetGuardedStep:
//   - a shared single-flight GET_LOCK (a 2nd tab/reload/agent gets {busy:true}, not a 2nd concurrent run),
//   - a ~4s wall-clock budget (a worker is never held ~15s again),
//   - a DB kill-switch ({stopped:true} tab-across),
//   - and NO EnsureTables on the step path (its information_schema probes were pool-hang load).
//
// THE WORK UNIT IS THE SOURCE URL, NOT THE MAP. 365 maps share 133 map_urls -- twelve towns all point at
// "Land des schwarzen Bären" -- so per-map work would fetch the same picture twelve times. One fetch per
// URL, written to every map that names it.
//
// Kept separate from citymap-image.php on purpose: that is a multipart upload endpoint keyed by one map,
// and a resumable batch step is a different contract. The shared part -- what a fetch MEANS -- lives in
// avesmapsCitymapAutogetOne, which both call.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/autoget-run.php';

// Caps the DISTINCT due sources pulled per step so the ONE wiki API call stays <=50 titles. The step no
// longer runs all of these: avesmapsAutogetGuardedStep's ~4s budget usually stops it well before, and the
// leftovers stay due for the next step. (Was "25 per step ~= 15s"; the fixed 15s was the pool-hang risk.)
const AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES = 25;

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

    // A map is due when nobody has tried it yet and it has a source to try. The skip rule is deliberately
    // NOT in this query: thumb_origin DEFAULTS to 'manual', so filtering on it here would make nothing due
    // at all and the button would silently do nothing. See avesmapsCitymapAutogetSkips.
    $dueWhere = "thumb_auto_state IS NULL AND TRIM(COALESCE(map_url, '')) <> ''";
    $withSource = "TRIM(COALESCE(map_url, '')) <> ''";

    if ($action === 'status') {
        avesmapsCitymapsEnsureTables($pdo);
        $counts = [];
        $stmt = $pdo->query('SELECT thumb_auto_state AS s, COUNT(*) AS c FROM citymap WHERE ' . $withSource . ' GROUP BY thumb_auto_state');
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) ($row['s'] ?? '')] = (int) $row['c'];
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'remaining' => (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $dueWhere)->fetchColumn(),
            'total' => (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $withSource)->fetchColumn(),
            'counts' => $counts,
        ]);
    }

    if ($action === 'reset') {
        avesmapsCitymapsEnsureTables($pdo);
        // Everything EXCEPT a real upload. Deliberately not `WHERE thumb_origin = 'auto'`: a map the run
        // found nothing for has no picture and therefore still carries the DEFAULT 'manual', so that
        // condition would exclude exactly the maps worth retrying (the wiki gains images over time).
        $stmt = $pdo->prepare("UPDATE citymap SET thumb_auto_state = NULL
                                WHERE NOT (TRIM(COALESCE(thumb_local_url, '')) <> '' AND thumb_origin = 'manual')");
        $stmt->execute();
        avesmapsJsonResponse(200, ['ok' => true, 'reset' => $stmt->rowCount()]);
    }

    if ($action !== 'autoget_step') {
        avesmapsErrorResponse(400, 'invalid_request', 'action muss autoget_step, status oder reset sein.');
    }

    // ---- one guarded step ----
    // No EnsureTables here (see the header): the citymap table exists long since. The step body is wrapped
    // by the shared gate (kill-switch -> single-flight lock -> release), so {stopped:true}/{busy:true} can
    // come back instead of the tally, and the client loop handles both.
    $enabled = avesmapsCitymapAutogetEnabled($pdo);
    $result = avesmapsAutogetGuardedStep($pdo, $enabled, AVESMAPS_AUTOGET_RUN_LOCK, function (PDO $pdo) use ($dueWhere): array {
        $startedAt = microtime(true);

        $sources = $pdo->query('SELECT DISTINCT map_url FROM citymap WHERE ' . $dueWhere
            . ' ORDER BY map_url LIMIT ' . AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES)->fetchAll(PDO::FETCH_COLUMN);

        $tally = ['ok' => 0, 'no_image' => 0, 'fetch_failed' => 0, 'not_an_image' => 0, 'skipped_manual' => 0];
        $sourcesDone = 0;

        // ONE api call for all this step's wiki titles -- that is the whole reason the run is cheap (133
        // sources cost ~6 requests instead of 133 HTML fetches, which would also break the operator's "no
        // HTML crawls" request). Done before touching any map, so a title's picture is known when its maps
        // come up.
        $wikiImages = [];
        $titles = [];
        foreach ($sources as $mapUrl) {
            $title = avesmapsCitymapWikiPageTitle((string) $mapUrl);
            if ($title !== '' && !in_array($title, $titles, true)) {
                $titles[] = $title;
            }
        }
        if ($titles !== []) {
            $api = avesmapsLinkCheckFetchBody(avesmapsCitymapWikiApiUrl($titles), AVESMAPS_CITYMAP_AUTOGET_API_MAX_BYTES, 'application/json');
            // A dead API call is not fatal: every wiki map in this step then falls through to its own
            // resolve inside avesmapsCitymapAutogetOne and records its own state. Slower, still correct.
            if ($api['ok']) {
                $wikiImages = avesmapsCitymapPickWikiImages($api['body']);
            }
        }

        $mapsStmt = $pdo->prepare('SELECT public_id, thumb_local_url, thumb_origin FROM citymap
                                    WHERE map_url = :url AND ' . $dueWhere);
        $stateStmt = $pdo->prepare('UPDATE citymap SET thumb_auto_state = :state WHERE public_id = :pid');

        foreach ($sources as $mapUrl) {
            $mapUrl = (string) $mapUrl;
            $mapsStmt->execute(['url' => $mapUrl]);
            $maps = $mapsStmt->fetchAll(PDO::FETCH_ASSOC);
            $title = avesmapsCitymapWikiPageTitle($mapUrl);
            $known = ($title !== '' && isset($wikiImages[$title])) ? $wikiImages[$title] : null;

            foreach ($maps as $map) {
                $publicId = (string) $map['public_id'];
                if (avesmapsCitymapAutogetSkips($map)) {
                    $stateStmt->execute(['state' => 'skipped_manual', 'pid' => $publicId]);
                    $tally['skipped_manual']++;
                    continue;
                }
                $one = avesmapsCitymapAutogetOne($pdo, $publicId, $mapUrl, $known);
                // State written PER MAP, right after its fetch -- never leased in a batch up front. Leasing
                // rows and then hitting a time budget makes the due-query see nothing, report remaining=0,
                // and call a half-finished run done (the linkchecker's second trap).
                $stateStmt->execute(['state' => $one['state'], 'pid' => $publicId]);
                $tally[$one['state']] = ($tally[$one['state']] ?? 0) + 1;
                // One resolved source serves all its maps: reuse the URL the first fetch found, so the
                // twelve towns sharing a book do not each ask the API again.
                if ($known === null && $one['state'] === 'ok' && $one['source'] !== '') {
                    $known = $one['source'];
                }
            }
            $sourcesDone++;

            // Time budget REPLACES the old fixed source count: stop after ~4s, leftovers stay due for the
            // next step (they still carry thumb_auto_state IS NULL). Checked per SOURCE (~one fetch each).
            if (avesmapsAutogetDeadlineReached($startedAt, microtime(true), AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS)) {
                break;
            }
        }

        $remaining = (int) $pdo->query('SELECT COUNT(*) FROM citymap WHERE ' . $dueWhere)->fetchColumn();
        return [
            'ok' => true,
            'done' => $remaining === 0,
            'remaining' => $remaining,
            'sources_done' => $sourcesDone,
            'maps_ok' => $tally['ok'],
            'no_image' => $tally['no_image'],
            'fetch_failed' => $tally['fetch_failed'],
            'not_an_image' => $tally['not_an_image'],
            'skipped' => $tally['skipped_manual'],
        ];
    });
    avesmapsJsonResponse(200, $result);
} catch (Throwable $exception) {
    // No getMessage() to the client: several edit endpoints leak exception text (refactoring milestone
    // M1) and this is not the place to add another one.
    avesmapsErrorResponse(500, 'server_error', 'Der Vorschau-Durchlauf ist fehlgeschlagen.');
}
