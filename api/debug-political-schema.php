<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/political-territory-lib.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Debug-Daten nicht laden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET ist erlaubt.',
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // Bewusst admin statt edit, weil Schema- und Beispieldaten sensibel sind.
    avesmapsRequireUserWithCapability('admin');

    $tables = avesmapsDebugFetchAll($pdo, 'SHOW TABLES');

    $tableNames = array_map(
        static fn(array $row): string => (string) array_values($row)[0],
        $tables
    );

    $relevantTables = array_values(array_filter(
        $tableNames,
        static fn(string $tableName): bool => preg_match('/^(political_territory|political_territory_geometry|political_territory_wiki|map_features|users)$/', $tableName) === 1
    ));

    $schema = [];
    foreach ($relevantTables as $tableName) {
        $schema[$tableName] = [
            'columns' => avesmapsDebugFetchAll($pdo, "SHOW COLUMNS FROM `{$tableName}`"),
            'indexes' => avesmapsDebugFetchAll($pdo, "SHOW INDEX FROM `{$tableName}`"),
        ];
    }

    $samples = [];
    foreach (['political_territory', 'political_territory_geometry', 'political_territory_wiki'] as $tableName) {
        if (in_array($tableName, $tableNames, true)) {
            $samples[$tableName] = avesmapsDebugFetchAll(
                $pdo,
                "SELECT * FROM `{$tableName}` ORDER BY id DESC LIMIT 10"
            );
        }
    }

    $geometryPublicId = avesmapsNormalizeSingleLine((string) ($_GET['geometry_public_id'] ?? ''), 80);
    if ($geometryPublicId !== '' && in_array('political_territory_geometry', $tableNames, true)) {
        $selectedGeometry = avesmapsDebugFetchAll(
            $pdo,
            'SELECT *
            FROM political_territory_geometry
            WHERE public_id = :public_id
            LIMIT 1',
            ['public_id' => $geometryPublicId]
        );

        $samples['selected_geometry'] = $selectedGeometry;

        $territoryId = (int) ($selectedGeometry[0]['territory_id'] ?? 0);
        if ($territoryId > 0 && in_array('political_territory', $tableNames, true)) {
            $samples['selected_territory'] = avesmapsDebugFetchAll(
                $pdo,
                'SELECT *
                FROM political_territory
                WHERE id = :id
                LIMIT 1',
                ['id' => $territoryId]
            );

            $samples['selected_territory_chain'] = avesmapsDebugFetchTerritoryChain($pdo, $territoryId);
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'tables' => $tableNames,
        'relevant_tables' => $relevantTables,
        'schema' => $schema,
        'samples' => $samples,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Datenbank konnte nicht abgefragt werden.',
    ]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Debug-Daten konnten nicht geladen werden.',
    ]);
}

function avesmapsDebugFetchAll(PDO $pdo, string $sql, array $params = []): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function avesmapsDebugFetchTerritoryChain(PDO $pdo, int $territoryId): array {
    $chain = [];
    $visited = [];
    $currentId = $territoryId;

    while ($currentId > 0 && !isset($visited[$currentId])) {
        $visited[$currentId] = true;

        $rows = avesmapsDebugFetchAll(
            $pdo,
            'SELECT *
            FROM political_territory
            WHERE id = :id
            LIMIT 1',
            ['id' => $currentId]
        );

        $row = $rows[0] ?? null;
        if (!$row) {
            break;
        }

        array_unshift($chain, $row);
        $currentId = (int) ($row['parent_id'] ?? 0);
    }

    return $chain;
}