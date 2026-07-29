<?php

declare(strict_types=1);

// V11: the peak labels for the Landschaften editor's „Höhenraster rechnen" button.
//
// WHY A SEPARATE ENDPOINT, and the same reasoning as paths-geometry.php: the editor loads no
// map_features at all, and the map payload is 17,79 MB for a fraction of what is wanted here --
// 67 label points out of 11.054 features. This answers with a few kilobytes.
//
// WHY api/edit/ AND NOT api/app/. One editor button behind one capability. The public read surface
// does not grow for it (AGENTS.md §4).
//
// 💣 THE SUBTYPE LIST IS THE MODULE'S, NOT A SECOND ONE. `berggipfel` and `vulkan` are what
// ECOSYSTEM_PEAK_SUBTYPES in map-features-ecosystem-height-field.js reads, and a second list here is
// exactly the double bookkeeping `vulkan` already failed once. It is repeated as a literal because
// PHP cannot read the JS constant -- and it is repeated WITH this note, so the next change touches
// both.

require __DIR__ . '/../../_internal/auth.php';

const AVESMAPS_PEAK_LABEL_SUBTYPES = ['berggipfel', 'vulkan'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load peak geometry.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for peak geometry.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // No EnsureTables: map_features has existed since the beginning, and this stays a plain read.
    $placeholders = implode(',', array_fill(0, count(AVESMAPS_PEAK_LABEL_SUBTYPES), '?'));
    $statement = $pdo->prepare(
        "SELECT public_id, geometry_json, properties_json
           FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND feature_subtype IN ({$placeholders})
          ORDER BY id"
    );
    $statement->execute(AVESMAPS_PEAK_LABEL_SUBTYPES);

    $peaks = [];
    $skipped = 0;
    $withHeight = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
        if (($geometry['type'] ?? '') !== 'Point' || !is_array($coordinates) || count($coordinates) < 2) {
            $skipped++;
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $rawHeight = is_array($properties) ? ($properties['height_schritt'] ?? null) : null;
        // 🪤 A peak WITHOUT a height is not an error and not a zero: it travels as null, and the field
        // module substitutes its own default (5.000). Today 16 of 67 carry a height, so this is the
        // normal case, not the exception.
        $height = is_numeric($rawHeight) && (float) $rawHeight > 0.0 ? (float) $rawHeight : null;
        if ($height !== null) {
            $withHeight++;
        }
        // 💣 GeoJSON stores [x, y]. The label layer in the browser carries [lat, lng] = [y, x] and
        // swaps on the way in (peakList in map-features-ecosystem-height-render.js). This endpoint
        // answers in GEOMETRY order, x first -- the order the raster grid wants.
        $peaks[] = [
            'public_id' => (string) $row['public_id'],
            'x' => (float) $coordinates[0],
            'y' => (float) $coordinates[1],
            'height_schritt' => $height,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'skipped' => $skipped,
        'with_height' => $withHeight,
        'peaks' => $peaks,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Peak geometry could not be loaded from the database.');
} catch (Throwable) {
    // No getMessage() to the client: several edit endpoints leak exception text (milestone M1) and
    // this is not the place to add another one.
    avesmapsErrorResponse(500, 'server_error', 'Peak geometry could not be loaded.');
}
