<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
// avesmapsDecodeJsonColumnForEdit lives in the map-features library.
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/routing/terrain-calibration.php';
// V10's own landscape reader -- reused, never re-queried (Auftrag §2: „Nicht neu implementieren").
require_once __DIR__ . '/../../_internal/app/path-landscapes.php';

// Read-only feed for the Wege editor (html/wege-editor.html), the EIGHTH list editor.
// Auftrag: docs/wege-editor-instruction.md. GET, capability `edit`.
//
// 🔴 WHY THIS ENDPOINT EXISTS AT ALL. The WikiSync panel's way list groups by WIKI WAY -- one entry
// is one wiki article with N map segments (avesmapsWikiPathMatch). The editor needs the opposite:
// a way IS a map_features row, because that is what „Bearbeiten" edits and what carries a height
// profile. Neither the panel feed nor GET /api/app/map-features.php (21 MB) answers that.
//
// 💣 TWO ACTIONS, AND THE SPLIT IS THE WHOLE DESIGN. `list` is deliberately geometry-free: parsing
// geometry_json for 3.721 ways to compute a length would make opening the editor cost what a route
// costs. The length, the profile and the landscapes are per-way facts and are fetched by `detail`
// when a way is actually picked. Anyone tempted to "just add length to the list" should measure the
// list query first.
//
// ⚠️ NO DDL. This is a read path (AGENTS.md §10 names DDL-before-read as a known hotspot), and a
// missing path_terrain table is a normal state before the first profile run, not an error.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read ways.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for this endpoint.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $action = trim((string) ($_GET['action'] ?? 'list'));

    if ($action === 'list') {
        avesmapsJsonResponse(200, avesmapsPathEditorList($pdo));
    }

    if ($action === 'detail') {
        $publicId = trim((string) ($_GET['public_id'] ?? ''));
        if ($publicId === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'public_id is required.');
        }
        $detail = avesmapsPathEditorDetail($pdo, $publicId);
        if ($detail === null) {
            avesmapsErrorResponse(404, 'not_found', 'No such way.');
        }
        avesmapsJsonResponse(200, $detail);
    }

    avesmapsErrorResponse(400, 'invalid_request', 'Unknown way-editor action: ' . $action);
} catch (PDOException) {
    // PDOException extends RuntimeException -- catch it FIRST so DB details never reach clients.
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
} catch (RuntimeException) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}

/**
 * Every active way, without geometry.
 *
 * `has_profile` is a LEFT JOIN existence flag, not the profile itself: the list needs to show which
 * ways still lack one, and shipping 4.300 profile arrays to draw a badge would be absurd.
 */
function avesmapsPathEditorList(PDO $pdo): array
{
    // The profile table may not exist yet (before the first run) -- ask separately and tolerate it,
    // rather than letting a LEFT JOIN turn a normal state into a 500.
    $withProfile = [];
    try {
        $rows = $pdo->query(
            'SELECT path_id FROM path_terrain WHERE ascent_schritt IS NOT NULL'
        )->fetchAll(PDO::FETCH_COLUMN);
        foreach ($rows as $id) {
            $withProfile[(int) $id] = true;
        }
    } catch (PDOException) {
        $withProfile = [];
    }

    // 💣 DIE UMGEBUNGSRECHTECK-SPALTEN REITEN MIT, und sie sind der Grund, dass die Liste ohne
    // Geometrie auskommt. Ein Weg-NAME steht fuer viele Segmente ("Reichsstrasse 1" hat 26,
    // docs/konfliktmanagement-design.md §6a), und ohne etwas, das sie unterscheidet, waeren das 26
    // gleich aussehende Zeilen. min_x/min_y ordnen sie geografisch, die Diagonale gibt eine grobe
    // Ausdehnung -- alles vier sind echte SPALTEN, kein json_decode ueber 3.721 Zeilen.
    $statement = $pdo->query(
        "SELECT id, public_id, name, feature_subtype, properties_json, revision,
                min_x, min_y, max_x, max_y
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1
          ORDER BY name"
    );

    $ways = [];
    $bySubtype = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
        $wikiPath = is_array($properties['wiki_path'] ?? null) ? $properties['wiki_path'] : null;
        $otherSource = is_array($properties['other_source'] ?? null) ? $properties['other_source'] : null;
        $subtype = (string) $row['feature_subtype'];
        $bySubtype[$subtype] = ($bySubtype[$subtype] ?? 0) + 1;

        $ways[] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) ($properties['display_name'] ?? $row['name'] ?? ''),
            'feature_subtype' => $subtype,
            'revision' => (int) $row['revision'],
            'show_label' => ($properties['show_label'] ?? false) === true,
            'allowed_transports' => is_array($properties['allowed_transports'] ?? null)
                ? array_values($properties['allowed_transports'])
                : [],
            // Wann darf, was darf: je Reisemittel ein optionales Fenster. Fehlt es, gilt ganzjaehrig
            // -- deshalb ist ein leeres Objekt hier der Normalfall und keine fehlende Angabe.
            'transport_seasons' => is_array($properties['transport_seasons'] ?? null)
                ? $properties['transport_seasons']
                : new stdClass(),
            // The wiki way OWNS the name when it is set (R1) -- the client needs to know, because
            // that is what locks the name field and hides „Weg anzeigen".
            'wiki_path' => $wikiPath === null ? null : [
                'wiki_key' => (string) ($wikiPath['wiki_key'] ?? ''),
                'wiki_url' => (string) ($wikiPath['wiki_url'] ?? ''),
                'name' => (string) ($wikiPath['name'] ?? ''),
            ],
            'other_source' => $otherSource === null ? null : [
                'url' => (string) ($otherSource['url'] ?? ''),
                'label' => (string) ($otherSource['label'] ?? ''),
            ],
            'continent' => (string) ($properties['continent'] ?? ''),
            'has_profile' => isset($withProfile[(int) $row['id']]),
            'flow_direction' => (string) ($properties['flow_direction'] ?? ''),
            // Nur zum ORDNEN und UNTERSCHEIDEN der Segmente eines Namens -- nie als Laenge
            // ausgegeben. Die Diagonale eines Umgebungsrechtecks ist eine Schranke, keine Strecke:
            // ein geschwungener Weg ist laenger als seine Diagonale, nie kuerzer. Die echte Laenge
            // liefert `detail` aus der Geometrie.
            'bbox' => [
                (float) $row['min_x'], (float) $row['min_y'],
                (float) $row['max_x'], (float) $row['max_y'],
            ],
        ];
    }

    return [
        'ok' => true,
        'ways' => $ways,
        'summary' => [
            'total' => count($ways),
            'with_profile' => count(array_filter($ways, static fn (array $w): bool => $w['has_profile'])),
            'by_subtype' => $bySubtype,
        ],
        'calibration' => avesmapsTerrainCalibrationRead($pdo),
    ];
}

/**
 * One way, with everything the profile column and the landscape block need.
 *
 * 💣 THE LENGTH LIVES HERE AND NOWHERE ELSE. path_terrain stores four numbers per piece but no
 * length, so the factor cannot be reconstructed from that table alone -- the chord lengths come out
 * of geometry_json, which is exactly why the calibration has to ride along with the profile run
 * rather than being a SQL query.
 */
function avesmapsPathEditorDetail(PDO $pdo, string $publicId): ?array
{
    $statement = $pdo->prepare(
        "SELECT id, public_id, name, feature_subtype, geometry_json, properties_json, revision
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND public_id = :pid
          LIMIT 1"
    );
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return null;
    }

    $geometry = avesmapsDecodeJsonColumnForEdit($row['geometry_json'] ?? null);
    $coordinates = is_array($geometry) && ($geometry['type'] ?? '') === 'LineString'
        && is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
    $pieceLengths = avesmapsTerrainCalibrationPieceLengths($coordinates);

    $terrain = null;
    try {
        $profileStatement = $pdo->prepare(
            'SELECT ascent_schritt, descent_schritt, profile_json, path_revision, heightmap_stamp
               FROM path_terrain WHERE path_id = :id LIMIT 1'
        );
        $profileStatement->execute(['id' => (int) $row['id']]);
        $profileRow = $profileStatement->fetch(PDO::FETCH_ASSOC);
        if ($profileRow !== false) {
            $decoded = $profileRow['profile_json'] === null
                ? null
                : json_decode((string) $profileRow['profile_json'], true);
            $terrain = [
                'ascent' => $profileRow['ascent_schritt'] === null ? null : (float) $profileRow['ascent_schritt'],
                'descent' => $profileRow['descent_schritt'] === null ? null : (float) $profileRow['descent_schritt'],
                'profile' => is_array($decoded) ? $decoded : null,
                // 🔴 A path_revision mismatch means the stored profile describes a DIFFERENT
                // geometry of this way. The router drops it; the editor must SAY so rather than
                // draw a curve for a shape that no longer exists.
                'stale_geometry' => (int) $profileRow['path_revision'] !== (int) $row['revision'],
                'heightmap_stamp' => (string) $profileRow['heightmap_stamp'],
            ];
        }
    } catch (PDOException) {
        $terrain = null;
    }

    return [
        'ok' => true,
        'public_id' => (string) $row['public_id'],
        'feature_subtype' => (string) $row['feature_subtype'],
        'revision' => (int) $row['revision'],
        'length_units' => array_sum($pieceLengths),
        'piece_lengths' => $pieceLengths,
        'terrain' => $terrain,
        'landscapes' => avesmapsPathEditorLandscapes($pdo, (string) $row['public_id']),
    ];
}

/**
 * Which landscapes this way runs through -- READ ONLY, and through the EXISTING reader.
 *
 * 🔴 Owner decision 2026-08-02: computing this stays in the landscape editor („Zugehörigkeit
 * rechnen"). This reads the stored result of that run; the editor links across rather than offering
 * a second button that would drift from the first.
 *
 * ⭐ avesmapsPathLandscapesRead is V10's own reader -- the one behind „Führt durch" in the route
 * planner and both infoboxes. Calling it means the editor cannot disagree with what a visitor sees;
 * a second query over path_ecosystem would be a second truth about the same fact. (It also spares
 * this file the join over `basis`/`seq`, where the share is a distance span and not a column.)
 *
 * A missing stamp means the run never happened -- a normal state, not an error.
 */
function avesmapsPathEditorLandscapes(PDO $pdo, string $publicId): array
{
    if (avesmapsPathLandscapesStamp($pdo) === null) {
        return [];
    }

    $result = avesmapsPathLandscapesRead($pdo, [$publicId]);
    $path = $result['paths'][$publicId] ?? null;
    $catalogue = $result['landscapes'] ?? [];
    if (!is_array($path) || !is_array($path['in'] ?? null)) {
        return [];
    }

    $totalLength = (float) ($path['length'] ?? 0);
    $out = [];
    foreach ($path['in'] as $pair) {
        $region = $catalogue[$pair[0] ?? ''] ?? null;
        if (!is_array($region)) {
            continue;   // catalogue and assignment disagree -- skip, never guess a name
        }
        $covered = (float) ($pair[1] ?? 0);
        $out[] = [
            'name' => (string) ($region['name'] ?? ''),
            'art' => (string) ($region['art'] ?? ''),
            'kind' => (string) ($region['kind'] ?? ''),
            'wiki_url' => (string) ($region['wiki_url'] ?? ''),
            'share' => $totalLength > 0 ? $covered / $totalLength : 0.0,
        ];
    }

    usort($out, static fn (array $a, array $b): int => $b['share'] <=> $a['share']);

    return $out;
}
