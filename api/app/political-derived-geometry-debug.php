<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/political/territory.php';
require_once __DIR__ . '/../_internal/political/territories-support.php';
require_once __DIR__ . '/../_internal/political/territories-read.php';
require_once __DIR__ . '/../_internal/political/territories-layer.php';
require_once __DIR__ . '/../_internal/political/territories-derived-geometry.php';
require_once __DIR__ . '/../_internal/political/territories-derived-layer.php';
require_once __DIR__ . '/../_internal/political/territories-debug.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Herrschaftsgebiets-Diagnosen nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist fuer diese Diagnose erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureDerivedGeometryTables($pdo);

    $yearBf = avesmapsPoliticalReadOptionalInt($_GET['year_bf'] ?? null) ?? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;
    $zoom = avesmapsPoliticalReadOptionalZoom($_GET['zoom'] ?? null) ?? 0;

    $summaryStatement = $pdo->query(
        'SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
            MIN(updated_at) AS oldest_updated_at,
            MAX(updated_at) AS newest_updated_at
        FROM political_territory_derived_geometry'
    );
    $summary = $summaryStatement !== false ? ($summaryStatement->fetch(PDO::FETCH_ASSOC) ?: []) : [];

    $matchingRowsStatement = $pdo->prepare(
        'SELECT
            COUNT(*) AS matching_count
        FROM political_territory_derived_geometry derived
        INNER JOIN political_territory territory ON territory.id = derived.territory_id
        WHERE territory.is_active = 1
            AND derived.is_active = 1
            AND territory.continent = :continent
            AND (territory.valid_from_bf IS NULL OR territory.valid_from_bf <= :year_bf_start)
            AND (territory.valid_to_bf IS NULL OR territory.valid_to_bf = 0 OR territory.valid_to_bf >= :year_bf_end)
            AND (derived.min_zoom IS NULL OR derived.min_zoom <= :zoom_min)
            AND (derived.max_zoom IS NULL OR derived.max_zoom >= :zoom_max)'
    );
    $matchingRowsStatement->bindValue(':continent', AVESMAPS_POLITICAL_DEFAULT_CONTINENT);
    $matchingRowsStatement->bindValue(':year_bf_start', $yearBf, PDO::PARAM_INT);
    $matchingRowsStatement->bindValue(':year_bf_end', $yearBf, PDO::PARAM_INT);
    $matchingRowsStatement->bindValue(':zoom_min', $zoom, PDO::PARAM_INT);
    $matchingRowsStatement->bindValue(':zoom_max', $zoom, PDO::PARAM_INT);
    $matchingRowsStatement->execute();
    $matchingRows = $matchingRowsStatement->fetch(PDO::FETCH_ASSOC) ?: [];

    $layerFeatureProbe = [];
    try {
        $probeFeatures = avesmapsPoliticalReadDerivedLayerFeatures($pdo, $yearBf, $zoom, null);
        $layerFeatureProbe = [
            'ok' => true,
            'count' => count($probeFeatures),
            'ids' => array_values(array_map(static fn(array $feature): string => (string) ($feature['id'] ?? ''), $probeFeatures)),
            'territory_public_ids' => array_values(array_map(static fn(array $feature): string => (string) ($feature['properties']['territory_public_id'] ?? ''), $probeFeatures)),
            'show_inner_boundaries' => array_values(array_map(static fn(array $feature): bool => (bool) ($feature['properties']['show_inner_boundaries'] ?? true), $probeFeatures)),
        ];
    } catch (Throwable $exception) {
        $layerFeatureProbe = [
            'ok' => false,
            'exception' => null,
        ];
    }

    $rowsStatement = $pdo->query(
        'SELECT
            derived.id,
            derived.public_id,
            derived.territory_id,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.short_name AS territory_short_name,
            territory.is_active AS territory_is_active,
            territory.continent,
            territory.valid_from_bf,
            territory.valid_to_bf,
            derived.min_zoom,
            derived.max_zoom,
            derived.show_inner_boundaries,
            derived.is_active,
            derived.generated_at,
            derived.created_at,
            derived.updated_at,
            JSON_TYPE(derived.geometry_geojson) AS geometry_json_type
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        ORDER BY derived.updated_at DESC, derived.id DESC
        LIMIT 50'
    );

    $rows = [];
    foreach (($rowsStatement !== false ? $rowsStatement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
        $rows[] = [
            'id' => (int) ($row['id'] ?? 0),
            'public_id' => (string) ($row['public_id'] ?? ''),
            'territory_id' => (int) ($row['territory_id'] ?? 0),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            'territory_name' => (string) ($row['territory_name'] ?? ''),
            'territory_short_name' => (string) ($row['territory_short_name'] ?? ''),
            'territory_is_active' => (int) ($row['territory_is_active'] ?? 0) === 1,
            'continent' => (string) ($row['continent'] ?? ''),
            'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
            'valid_to_bf' => avesmapsPoliticalNullableInt($row['valid_to_bf'] ?? null),
            'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
            'show_inner_boundaries' => (int) ($row['show_inner_boundaries'] ?? 1) === 1,
            'is_active' => (int) ($row['is_active'] ?? 0) === 1,
            'generated_at' => (string) ($row['generated_at'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
            'geometry_json_type' => (string) ($row['geometry_json_type'] ?? ''),
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'probe' => [
            'year_bf' => $yearBf,
            'zoom' => $zoom,
            'matching_sql_count' => (int) ($matchingRows['matching_count'] ?? 0),
            'layer_features' => $layerFeatureProbe,
        ],
        'summary' => [
            'total_count' => (int) ($summary['total_count'] ?? 0),
            'active_count' => (int) ($summary['active_count'] ?? 0),
            'oldest_updated_at' => (string) ($summary['oldest_updated_at'] ?? ''),
            'newest_updated_at' => (string) ($summary['newest_updated_at'] ?? ''),
        ],
        'rows' => $rows,
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Derived-Geometry-Diagnose konnte nicht geladen werden.');
}
