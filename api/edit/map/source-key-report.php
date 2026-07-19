<?php

declare(strict_types=1);

// Step 4 of docs/quellen-wiki-key-instruction.md: work out which sources have a wiki key, which
// ones would collapse into one, and where that collides -- and WRITE NOTHING.
//
// This is the material the owner reviews before step 5 is allowed to touch anything. The endpoint
// has no apply mode at all: merging lives in source-merge.php, behind capability 'admin'. Keeping
// the two apart is the point -- a report you can accidentally execute is not a report.
//
// The keys are DERIVED from the freshly dumped wiki_publication_catalog, not read from
// sources.wiki_key: that column is only filled by a publication reconcile, so a report keyed off it
// would stay empty until after the very run it exists to inform.
//
// GET (no parameters). Capability 'edit' -- reviewer material, and it writes nothing.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/feature-sources.php';
// The url route needs the wiki title/alias resolver. Guarded by function_exists inside the report,
// so an installation without WikiSync still gets a valid (key-less) answer instead of a 500.
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf diesen Bericht nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist fuer diesen Bericht erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));

    avesmapsJsonResponse(200, ['ok' => true] + avesmapsSourceWikiKeyReport($pdo, $limit));
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Der Bericht konnte die Datenbank nicht erreichen.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Der Bericht ist fehlgeschlagen.');
}
