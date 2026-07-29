<?php

declare(strict_types=1);

// V9: the way geometry for the Landschaften editor's „Zugehörigkeit rechnen" button.
//
// WHY A SEPARATE ENDPOINT. The editor loads no map_features at all today, and the map payload is
// 17,79 MB uncompressed (measured 2026-07-29) for a fraction of what is wanted here: 5.650
// LineStrings out of 11.054 features, without properties, sources or styles. This answers with
// roughly 1,5 MB.
//
// WHY api/edit/ AND NOT api/app/. It serves one editor button behind one capability. The public read
// surface does not grow for it (AGENTS.md §4) -- the same reasoning that put `list_regions` behind
// the gate instead of on the public path.
//
// NO INTERNAL IDS IN THE PAYLOAD. The client computes with public_ids; the save actions resolve them
// server-side (api/_internal/app/path-ecosystem.php). Internal keys stay internal, even here.

require __DIR__ . '/../../_internal/auth.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load way geometry.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for way geometry.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // No EnsureTables: map_features has existed since the beginning, and this endpoint has to stay a
    // plain read -- being cheap enough to sit behind one click is its entire purpose.
    $statement = $pdo->query(
        "SELECT public_id, geometry_json, min_x, min_y, max_x, max_y
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1
          ORDER BY id"
    );

    $paths = [];
    $skipped = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        // A way whose geometry does not decode is skipped rather than aborting the read: one broken
        // row must not cost the editor the other 5.649. The count travels so a run can say so.
        if (!is_array($geometry) || ($geometry['type'] ?? '') !== 'LineString' || !is_array($geometry['coordinates'] ?? null)) {
            $skipped++;
            continue;
        }
        $paths[] = [
            'public_id' => (string) $row['public_id'],
            'geometry' => $geometry,
            'bounds' => [
                'min_x' => (float) $row['min_x'],
                'min_y' => (float) $row['min_y'],
                'max_x' => (float) $row['max_x'],
                'max_y' => (float) $row['max_y'],
            ],
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        // Stamped into the run, so a later reader can tell which map stand the stored intervals
        // describe. A way edit bumps map_revision but never ecosystem_revision, so both are needed
        // to answer "is this still current".
        'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'skipped' => $skipped,
        'paths' => $paths,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Way geometry could not be loaded from the database.');
} catch (Throwable) {
    // No getMessage() to the client: several edit endpoints leak exception text (milestone M1) and
    // this is not the place to add another one.
    avesmapsErrorResponse(500, 'server_error', 'Way geometry could not be loaded.');
}
