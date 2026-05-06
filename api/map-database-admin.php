<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

const AVESMAPS_MAP_NAMESPACE_UUID = '7c22ff08-9d82-46a0-a5d1-f6f47e2b12a5';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf die Map-Datenbank nicht verwalten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    avesmapsAuthorizeMapDatabaseAdmin($config);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    if ($requestMethod === 'GET') {
        avesmapsJsonResponse(200, avesmapsBuildMapDatabaseStatus($pdo));
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET und POST sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    avesmapsRelaxMapDatabaseImportLimits();

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);
    $replaceExisting = filter_var($payload['replace_existing'] ?? false, FILTER_VALIDATE_BOOLEAN);

    $response = match ($action) {
        'install_schema' => avesmapsInstallFutureSchema($pdo),
        'dry_run_geojson' => avesmapsImportGeoJsonMap($pdo, false, false),
        'import_geojson' => avesmapsImportGeoJsonMap($pdo, $replaceExisting, true),
        'install_schema_and_import_geojson' => avesmapsInstallSchemaAndImportGeoJson($pdo, $replaceExisting),
        default => throw new InvalidArgumentException('Die angeforderte Admin-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Map-Datenbank konnte nicht verwaltet werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Map-Datenbank-Aktion konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsAuthorizeMapDatabaseAdmin(array $config): void {
    $configuredImportToken = avesmapsGetConfiguredImportApiToken($config);
    if ($configuredImportToken === '') {
        avesmapsJsonResponse(503, [
            'ok' => false,
            'error' => 'Die Import-API ist auf dem Server noch nicht konfiguriert.',
        ]);
    }

    $requestToken = avesmapsReadImportApiTokenFromRequest();
    if ($requestToken === '' || !hash_equals($configuredImportToken, $requestToken)) {
        avesmapsJsonResponse(401, [
            'ok' => false,
            'error' => 'Das Import-API-Token fehlt oder ist ungueltig.',
        ]);
    }
}

function avesmapsRelaxMapDatabaseImportLimits(): void {
    if (function_exists('set_time_limit')) {
        @set_time_limit(300);
    }

    if (function_exists('ini_set')) {
        @ini_set('memory_limit', '512M');
    }
}

function avesmapsBuildMapDatabaseStatus(PDO $pdo): array {
    $tables = [
        'users',
        'map_features',
        'map_feature_relations',
        'map_proposals',
        'map_revision',
        'map_audit_log',
    ];

    $existingTables = [];
    foreach ($tables as $tableName) {
        $existingTables[$tableName] = avesmapsTableExists($pdo, $tableName);
    }

    $featureCounts = [];
    $revision = 0;
    if ($existingTables['map_features']) {
        $featureCounts = avesmapsFetchMapFeatureCounts($pdo);
    }

    if ($existingTables['map_revision']) {
        $revision = avesmapsFetchMapRevisionForAdmin($pdo);
    }

    return [
        'ok' => true,
        'tables' => $existingTables,
        'revision' => $revision,
        'feature_counts' => $featureCounts,
    ];
}

function avesmapsTableExists(PDO $pdo, string $tableName): bool {
    $statement = $pdo->prepare(
        'SELECT COUNT(*) AS table_count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
            AND table_name = :table_name'
    );
    $statement->execute([
        'table_name' => $tableName,
    ]);

    return (int) $statement->fetchColumn() > 0;
}

function avesmapsFetchMapFeatureCounts(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT feature_type, feature_subtype, COUNT(*) AS feature_count
        FROM map_features
        GROUP BY feature_type, feature_subtype
        ORDER BY feature_type ASC, feature_subtype ASC'
    );

    $counts = [];
    foreach ($statement->fetchAll() as $row) {
        $counts[] = [
            'feature_type' => (string) $row['feature_type'],
            'feature_subtype' => (string) $row['feature_subtype'],
            'count' => (int) $row['feature_count'],
        ];
    }

    return $counts;
}

function avesmapsFetchMapRevisionForAdmin(PDO $pdo): int {
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        return 0;
    }

    return (int) $revision;
}

function avesmapsInstallFutureSchema(PDO $pdo): array {
    $schemaPath = __DIR__ . DIRECTORY_SEPARATOR . 'schema.future.mysql.sql';
    if (!is_file($schemaPath)) {
        throw new RuntimeException('Das Future-Schema wurde auf dem Server nicht gefunden.');
    }

    $schemaSql = file_get_contents($schemaPath);
    if (!is_string($schemaSql) || trim($schemaSql) === '') {
        throw new RuntimeException('Das Future-Schema ist leer oder nicht lesbar.');
    }

    $statementCount = 0;
    foreach (avesmapsSplitSqlStatements($schemaSql) as $sqlStatement) {
        $pdo->exec($sqlStatement);
        $statementCount++;
    }

    return [
        'ok' => true,
        'action' => 'install_schema',
        'executed_statements' => $statementCount,
        'status' => avesmapsBuildMapDatabaseStatus($pdo),
    ];
}

function avesmapsSplitSqlStatements(string $schemaSql): array {
    $withoutComments = preg_replace('/^\s*--.*$/m', '', $schemaSql) ?? $schemaSql;
    $rawStatements = explode(';', $withoutComments);
    $statements = [];

    foreach ($rawStatements as $rawStatement) {
        $statement = trim($rawStatement);
        if ($statement === '') {
            continue;
        }

        $statements[] = $statement;
    }

    return $statements;
}

function avesmapsInstallSchemaAndImportGeoJson(PDO $pdo, bool $replaceExisting): array {
    $schemaResponse = avesmapsInstallFutureSchema($pdo);
    $importResponse = avesmapsImportGeoJsonMap($pdo, $replaceExisting, true);

    return [
        'ok' => true,
        'action' => 'install_schema_and_import_geojson',
        'schema' => $schemaResponse,
        'import' => $importResponse,
    ];
}

function avesmapsImportGeoJsonMap(PDO $pdo, bool $replaceExisting, bool $writeChanges): array {
    $geoJson = avesmapsLoadMapGeoJson();
    $features = $geoJson['features'];
    $summary = avesmapsBuildGeoJsonImportSummary($features);

    if (!$writeChanges) {
        return [
            'ok' => true,
            'action' => 'dry_run_geojson',
            'source' => 'map/Aventurien_routes.geojson',
            'feature_total' => count($features),
            'feature_counts' => $summary,
        ];
    }

    if (!avesmapsTableExists($pdo, 'map_features')) {
        throw new RuntimeException('Die Future-Tabellen fehlen. Fuehre zuerst install_schema aus.');
    }

    $pdo->beginTransaction();
    try {
        if ($replaceExisting) {
            avesmapsClearImportedMapData($pdo);
        }

        $insertStatement = avesmapsPrepareMapFeatureInsert($pdo);
        foreach ($features as $index => $feature) {
            avesmapsInsertMapFeature($insertStatement, $feature, $index);
        }

        avesmapsIncrementMapRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'action' => 'import_geojson',
        'source' => 'map/Aventurien_routes.geojson',
        'replace_existing' => $replaceExisting,
        'inserted_features' => count($features),
        'feature_counts' => $summary,
        'status' => avesmapsBuildMapDatabaseStatus($pdo),
    ];
}

function avesmapsLoadMapGeoJson(): array {
    $geoJsonPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'map' . DIRECTORY_SEPARATOR . 'Aventurien_routes.geojson';
    if (!is_file($geoJsonPath)) {
        throw new RuntimeException('Die GeoJSON-Datei map/Aventurien_routes.geojson wurde nicht gefunden.');
    }

    $rawGeoJson = file_get_contents($geoJsonPath);
    if (!is_string($rawGeoJson) || trim($rawGeoJson) === '') {
        throw new RuntimeException('Die GeoJSON-Datei ist leer oder nicht lesbar.');
    }

    try {
        $geoJson = json_decode($rawGeoJson, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('Die GeoJSON-Datei enthaelt ungueltiges JSON.');
    }

    if (!is_array($geoJson) || ($geoJson['type'] ?? '') !== 'FeatureCollection' || !is_array($geoJson['features'] ?? null)) {
        throw new RuntimeException('Die GeoJSON-Datei muss eine FeatureCollection enthalten.');
    }

    return $geoJson;
}

function avesmapsBuildGeoJsonImportSummary(array $features): array {
    $counts = [];
    foreach ($features as $feature) {
        [$featureType, $featureSubtype] = avesmapsClassifyMapFeature($feature);
        $key = $featureType . ':' . $featureSubtype;
        if (!isset($counts[$key])) {
            $counts[$key] = [
                'feature_type' => $featureType,
                'feature_subtype' => $featureSubtype,
                'count' => 0,
            ];
        }

        $counts[$key]['count']++;
    }

    usort(
        $counts,
        static fn(array $left, array $right): int => [$left['feature_type'], $left['feature_subtype']] <=> [$right['feature_type'], $right['feature_subtype']]
    );

    return array_values($counts);
}

function avesmapsClearImportedMapData(PDO $pdo): void {
    $pdo->exec('DELETE FROM map_feature_relations');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_features');
}

function avesmapsPrepareMapFeatureInsert(PDO $pdo): PDOStatement {
    return $pdo->prepare(
        'INSERT INTO map_features (
            public_id,
            feature_type,
            feature_subtype,
            name,
            geometry_type,
            geometry_json,
            properties_json,
            style_json,
            min_x,
            min_y,
            max_x,
            max_y,
            sort_order
        ) VALUES (
            :public_id,
            :feature_type,
            :feature_subtype,
            :name,
            :geometry_type,
            :geometry_json,
            :properties_json,
            :style_json,
            :min_x,
            :min_y,
            :max_x,
            :max_y,
            :sort_order
        )
        ON DUPLICATE KEY UPDATE
            feature_type = VALUES(feature_type),
            feature_subtype = VALUES(feature_subtype),
            name = VALUES(name),
            geometry_type = VALUES(geometry_type),
            geometry_json = VALUES(geometry_json),
            properties_json = VALUES(properties_json),
            style_json = VALUES(style_json),
            min_x = VALUES(min_x),
            min_y = VALUES(min_y),
            max_x = VALUES(max_x),
            max_y = VALUES(max_y),
            sort_order = VALUES(sort_order),
            is_active = 1,
            revision = revision + 1'
    );
}

function avesmapsInsertMapFeature(PDOStatement $statement, array $feature, int $index): void {
    $geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
    $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
    [$featureType, $featureSubtype] = avesmapsClassifyMapFeature($feature);
    [$storedProperties, $style] = avesmapsSplitMapFeatureProperties($properties, $featureType, $featureSubtype);
    $bbox = avesmapsBuildGeometryBoundingBox($geometry);

    $statement->execute([
        'public_id' => avesmapsBuildDeterministicPublicId($feature, $index),
        'feature_type' => $featureType,
        'feature_subtype' => $featureSubtype,
        'name' => avesmapsNormalizeNullableSingleLine($properties['name'] ?? null, 160),
        'geometry_type' => avesmapsNormalizeSingleLine((string) ($geometry['type'] ?? ''), 40),
        'geometry_json' => avesmapsEncodeJsonForDatabase($geometry),
        'properties_json' => avesmapsEncodeJsonForDatabase($storedProperties),
        'style_json' => $style === [] ? null : avesmapsEncodeJsonForDatabase($style),
        'min_x' => $bbox['min_x'],
        'min_y' => $bbox['min_y'],
        'max_x' => $bbox['max_x'],
        'max_y' => $bbox['max_y'],
        'sort_order' => $index,
    ]);
}

function avesmapsClassifyMapFeature(array $feature): array {
    $geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
    $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
    $geometryType = (string) ($geometry['type'] ?? '');
    $legacyType = (string) ($properties['type'] ?? '');
    $layer = (string) ($properties['layer'] ?? $properties['data-layer-label'] ?? '');
    $normalizedLayer = avesmapsNormalizeMapSubtype($layer, '');

    if ($geometryType === 'Point') {
        $name = (string) ($properties['name'] ?? '');
        if (str_starts_with($name, 'Kreuzung') || $normalizedLayer === 'kreuzungen') {
            return ['crossing', 'crossing'];
        }

        $settlementClass = avesmapsNormalizeMapSubtype($properties['settlement_class'] ?? '', 'dorf');
        if (in_array($settlementClass, ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf'], true)) {
            return ['location', $settlementClass];
        }

        return ['location', 'dorf'];
    }

    if ($legacyType === 'region' || in_array($geometryType, ['Polygon', 'MultiPolygon'], true)) {
        return ['region', $normalizedLayer !== '' ? $normalizedLayer : 'region'];
    }

    if ($normalizedLayer === 'flusswege') {
        return ['river', 'river'];
    }

    if (in_array($geometryType, ['LineString', 'MultiLineString'], true)) {
        $routeSubtypes = [
            'pfade' => 'pfad',
            'strassen' => 'strasse',
            'reichsstrasse' => 'reichsstrasse',
            'gebirgspaesse' => 'gebirgspass',
            'gebirgspasse' => 'gebirgspass',
            'wustenpfade' => 'wuestenpfad',
            'wuestenpfade' => 'wuestenpfad',
            'meerwege' => 'seeweg',
        ];

        return ['path', $routeSubtypes[$normalizedLayer] ?? ($normalizedLayer !== '' ? $normalizedLayer : 'path')];
    }

    return [avesmapsNormalizeMapSubtype($legacyType, 'feature'), $normalizedLayer !== '' ? $normalizedLayer : 'default'];
}

function avesmapsNormalizeMapSubtype(mixed $value, string $fallback): string {
    $normalizedValue = trim((string) $value);
    if ($normalizedValue === '') {
        return $fallback;
    }

    foreach (avesmapsBuildNormalizedTextCandidates($normalizedValue) as $candidate) {
        $candidate = strtolower($candidate);
        $umlautSearch = json_decode('["\u00df","\u00e4","\u00f6","\u00fc"]', true, 4, JSON_THROW_ON_ERROR);
        $candidate = str_replace($umlautSearch, ['ss', 'ae', 'oe', 'ue'], $candidate);
        $candidate = function_exists('iconv')
            ? iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $candidate)
            : preg_replace('/[^\x00-\x7F]+/', '', $candidate);
        if (!is_string($candidate)) {
            continue;
        }

        $candidate = preg_replace('/[^a-z0-9]+/', '_', $candidate) ?? '';
        $candidate = trim($candidate, '_');
        if ($candidate !== '') {
            return $candidate;
        }
    }

    return $fallback;
}

function avesmapsBuildNormalizedTextCandidates(string $value): array {
    $candidates = [$value];
    $repairedValue = @mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
    if (is_string($repairedValue) && $repairedValue !== '' && !in_array($repairedValue, $candidates, true)) {
        $candidates[] = $repairedValue;
    }

    return $candidates;
}

function avesmapsSplitMapFeatureProperties(array $properties, string $featureType, string $featureSubtype): array {
    $storedProperties = $properties;
    $style = [];

    foreach (['fill', 'stroke', 'strokeWidth', 'fillOpacity', 'style'] as $styleKey) {
        if (array_key_exists($styleKey, $storedProperties)) {
            $style[$styleKey] = $storedProperties[$styleKey];
            unset($storedProperties[$styleKey]);
        }
    }

    if ($featureType === 'river') {
        $storedProperties['befahrbar'] = true;
        $storedProperties['legacy_route_type'] = 'Flussweg';
    }

    $storedProperties['feature_type'] = $featureType;
    $storedProperties['feature_subtype'] = $featureSubtype;

    return [$storedProperties, $style];
}

function avesmapsBuildGeometryBoundingBox(array $geometry): array {
    $positions = [];
    avesmapsCollectGeoJsonPositions($geometry['coordinates'] ?? null, $positions, 0);

    if ($positions === []) {
        throw new RuntimeException('Eine Geometrie enthaelt keine Koordinaten.');
    }

    $xs = array_column($positions, 'x');
    $ys = array_column($positions, 'y');

    return [
        'min_x' => min($xs),
        'min_y' => min($ys),
        'max_x' => max($xs),
        'max_y' => max($ys),
    ];
}

function avesmapsCollectGeoJsonPositions(mixed $coordinates, array &$positions, int $depth): void {
    if ($depth > 16 || !is_array($coordinates)) {
        return;
    }

    if (
        count($coordinates) >= 2
        && is_numeric($coordinates[0])
        && is_numeric($coordinates[1])
    ) {
        $positions[] = [
            'x' => (float) $coordinates[0],
            'y' => (float) $coordinates[1],
        ];
        return;
    }

    foreach ($coordinates as $childCoordinates) {
        avesmapsCollectGeoJsonPositions($childCoordinates, $positions, $depth + 1);
    }
}

function avesmapsBuildDeterministicPublicId(array $feature, int $index): string {
    $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
    $candidates = [
        $properties['id'] ?? '',
        $properties['svg_id'] ?? '',
        $properties['data-place-id'] ?? '',
        $properties['name'] ?? '',
        $index,
    ];

    $source = implode('|', array_map(static fn(mixed $candidate): string => (string) $candidate, $candidates));
    return avesmapsUuidV5(AVESMAPS_MAP_NAMESPACE_UUID, $source);
}

function avesmapsUuidV5(string $namespaceUuid, string $name): string {
    $namespaceBytes = avesmapsUuidToBytes($namespaceUuid);
    $hash = sha1($namespaceBytes . $name, true);
    $bytes = substr($hash, 0, 16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x50);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

    return avesmapsBytesToUuid($bytes);
}

function avesmapsUuidToBytes(string $uuid): string {
    $hex = str_replace('-', '', strtolower($uuid));
    if (strlen($hex) !== 32 || preg_match('/^[a-f0-9]{32}$/', $hex) !== 1) {
        throw new RuntimeException('Die interne UUID-Namespace-Konfiguration ist ungueltig.');
    }

    $bytes = pack('H*', $hex);
    if (!is_string($bytes)) {
        throw new RuntimeException('Die interne UUID-Namespace-Konfiguration konnte nicht verarbeitet werden.');
    }

    return $bytes;
}

function avesmapsBytesToUuid(string $bytes): string {
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die interne UUID konnte nicht verarbeitet werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsNormalizeNullableSingleLine(mixed $value, int $maxLength): ?string {
    if ($value === null) {
        return null;
    }

    $normalizedValue = avesmapsNormalizeSingleLine((string) $value, $maxLength);
    return $normalizedValue === '' ? null : $normalizedValue;
}

function avesmapsEncodeJsonForDatabase(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsIncrementMapRevision(PDO $pdo): void {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );
}
