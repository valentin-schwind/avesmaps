<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';

// Dirt-cheap "has the map changed?" probe for the edit-mode live-sync poll. The editor asks this every 15s;
// only when the returned revision advances does it fetch map-features.php?since_revision=N for the actual
// delta. Deliberately public and enrichment-free (one indexed row read) so N editors polling in parallel
// cost almost nothing -- the full map-features.php path runs six table-wide loader queries on every call
// regardless of the delta (see docs/superpowers/plans/2026-07-25-edit-mode-livesync-last.md). The map
// revision number is not sensitive. Mirrors avesmapsFetchMapRevision() in map-features.php (one line, not
// worth a shared include).
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read map data.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET requests are allowed for the map revision.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;

    avesmapsJsonResponse(200, ['ok' => true, 'revision' => $revision === false ? 0 : (int) $revision]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'The map revision could not be read.');
}
