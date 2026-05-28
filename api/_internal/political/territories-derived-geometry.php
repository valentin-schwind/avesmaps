<?php

declare(strict_types=1);

function avesmapsPoliticalEnsureDerivedGeometryTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS political_territory_derived_geometry (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            territory_id BIGINT UNSIGNED NOT NULL,
            geometry_geojson JSON NOT NULL,
            label_lng DECIMAL(12, 6) NULL,
            label_lat DECIMAL(12, 6) NULL,
            min_zoom TINYINT UNSIGNED NULL,
            max_zoom TINYINT UNSIGNED NULL,
            min_x DECIMAL(10, 4) NOT NULL,
            min_y DECIMAL(10, 4) NOT NULL,
            max_x DECIMAL(10, 4) NOT NULL,
            max_y DECIMAL(10, 4) NOT NULL,
            source_revision VARCHAR(255) NULL,
            generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_political_territory_derived_geometry_public_id (public_id),
            KEY idx_political_territory_derived_territory (territory_id, is_active),
            KEY idx_political_territory_derived_zoom (min_zoom, max_zoom),
            KEY idx_political_territory_derived_bbox (min_x, min_y, max_x, max_y)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsPoliticalReadDerivedGeometry(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($query['territory_public_id'] ?? $query['public_id'] ?? '')
    );

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'derived_geometry' => avesmapsPoliticalFetchActiveDerivedGeometryForTerritory($pdo, (int) $territory['id']),
    ];
}

function avesmapsPoliticalReadDerivedGeometrySources(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($query['territory_public_id'] ?? $query['public_id'] ?? '')
    );
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $descendantIds = avesmapsPoliticalCollectDerivedGeometryDescendantIds((int) $territory['id'], $territories);

    if ($descendantIds === []) {
        return [
            'ok' => true,
            'territory_public_id' => (string) $territory['public_id'],
            'source_geometries' => [],
            'source_count' => 0,
        ];
    }

    $placeholders = implode(',', array_fill(0, count($descendantIds), '?'));
    $statement = $pdo->prepare(
        'SELECT
            geometry.*,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.short_name AS territory_short_name,
            territory.parent_id AS territory_parent_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1
            AND geometry.territory_id IN (' . $placeholders . ')
        ORDER BY territory.sort_order ASC, territory.name ASC, geometry.id ASC'
    );
    $statement->execute($descendantIds);

    $sourceGeometries = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $sourceGeometries[] = [
            'geometry_public_id' => (string) $row['public_id'],
            'territory_public_id' => (string) $row['territory_public_id'],
            'territory_name' => (string) ($row['territory_name'] ?? ''),
            'territory_short_name' => (string) ($row['territory_short_name'] ?? ''),
            'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
            'source' => (string) ($row['source'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'source_geometries' => $sourceGeometries,
        'source_count' => count($sourceGeometries),
        'descendant_territory_count' => count($descendantIds),
    ];
}

function avesmapsPoliticalSaveDerivedGeometry(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? $payload['public_id'] ?? '')
    );
    $territoryId = (int) $territory['id'];

    if (!avesmapsPoliticalReadBoolean($payload['is_active'] ?? true)) {
        return avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
    }

    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);
    $bounds = avesmapsPoliticalCalculateGeometryBounds($geometry);
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? null);
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

    $labelCenter = avesmapsPoliticalReadDerivedGeometryLabelCenter($payload, $geometry);
    $sourceRevision = avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['source_revision'] ?? $payload['source_signature'] ?? ''), 255));
    $userId = (int) ($user['id'] ?? 0) ?: null;
    $publicId = avesmapsPoliticalUuidV4();

    $pdo->beginTransaction();
    try {
        $deactivateStatement = $pdo->prepare(
            'UPDATE political_territory_derived_geometry
            SET is_active = 0,
                updated_by = :updated_by
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $deactivateStatement->execute([
            'territory_id' => $territoryId,
            'updated_by' => $userId,
        ]);

        $insertStatement = $pdo->prepare(
            'INSERT INTO political_territory_derived_geometry (
                public_id, territory_id, geometry_geojson, label_lng, label_lat,
                min_zoom, max_zoom, min_x, min_y, max_x, max_y,
                source_revision, generated_at, is_active, created_by, updated_by
            ) VALUES (
                :public_id, :territory_id, :geometry_geojson, :label_lng, :label_lat,
                :min_zoom, :max_zoom, :min_x, :min_y, :max_x, :max_y,
                :source_revision, CURRENT_TIMESTAMP(3), 1, :created_by, :updated_by
            )'
        );
        $insertStatement->execute([
            'public_id' => $publicId,
            'territory_id' => $territoryId,
            'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
            'label_lng' => $labelCenter['lng'],
            'label_lat' => $labelCenter['lat'],
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'source_revision' => $sourceRevision,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'derived_geometry' => avesmapsPoliticalFetchDerivedGeometryByPublicId($pdo, $publicId),
    ];
}

function avesmapsPoliticalDeleteDerivedGeometry(PDO $pdo, array $payload, array $user): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? $payload['public_id'] ?? '')
    );

    return avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
}

function avesmapsPoliticalDeleteDerivedGeometryForTerritory(PDO $pdo, array $territory, array $user): array {
    $statement = $pdo->prepare(
        'UPDATE political_territory_derived_geometry
        SET is_active = 0,
            updated_by = :updated_by
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $statement->execute([
        'territory_id' => (int) $territory['id'],
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'derived_geometry' => null,
        'deactivated' => true,
        'affected' => $statement->rowCount(),
    ];
}

function avesmapsPoliticalReadDerivedGeometryLabelCenter(array $payload, array $geometry): array {
    $labelLng = $payload['label_lng'] ?? null;
    $labelLat = $payload['label_lat'] ?? null;
    if (is_numeric($labelLng) && is_numeric($labelLat)) {
        return [
            'lng' => (float) $labelLng,
            'lat' => (float) $labelLat,
        ];
    }

    $computed = avesmapsPoliticalComputeGeometryLabelCenter($geometry);
    if ($computed !== null) {
        return $computed;
    }

    throw new InvalidArgumentException('Fuer die abgeleitete Geometrie konnte keine Labelposition berechnet werden.');
}

function avesmapsPoliticalFetchActiveDerivedGeometryForTerritory(PDO $pdo, int $territoryId): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_derived_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1
        ORDER BY updated_at DESC, id DESC
        LIMIT 1'
    );
    $statement->execute(['territory_id' => $territoryId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? avesmapsPoliticalDerivedGeometryRowToPublic($row) : null;
}

function avesmapsPoliticalFetchDerivedGeometryByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_derived_geometry
        WHERE public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Die abgeleitete Geometrie konnte nicht gelesen werden.');
    }

    return avesmapsPoliticalDerivedGeometryRowToPublic($row);
}

function avesmapsPoliticalDerivedGeometryRowToPublic(array $row): array {
    return [
        'id' => (int) $row['id'],
        'public_id' => (string) $row['public_id'],
        'territory_id' => (int) $row['territory_id'],
        'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
        'label_lng' => is_numeric($row['label_lng'] ?? null) ? (float) $row['label_lng'] : null,
        'label_lat' => is_numeric($row['label_lat'] ?? null) ? (float) $row['label_lat'] : null,
        'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
        'source_revision' => (string) ($row['source_revision'] ?? ''),
        'generated_at' => (string) ($row['generated_at'] ?? ''),
        'is_active' => (int) ($row['is_active'] ?? 0) === 1,
    ];
}

function avesmapsPoliticalFetchDerivedGeometrySourceTerritories(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, parent_id, name, short_name, sort_order
        FROM political_territory
        WHERE is_active = 1
            AND continent = :continent
        ORDER BY sort_order ASC, name ASC'
    );
    $statement->execute(['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);

    $territories = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territories[(int) $row['id']] = $row;
    }

    return $territories;
}

function avesmapsPoliticalCollectDerivedGeometryDescendantIds(int $territoryId, array $territories): array {
    $childrenByParent = [];
    foreach ($territories as $candidateId => $territory) {
        $parentId = (int) ($territory['parent_id'] ?? 0);
        if ($parentId > 0) {
            $childrenByParent[$parentId][] = (int) $candidateId;
        }
    }

    $descendantIds = [];
    $queue = $childrenByParent[$territoryId] ?? [];
    $visited = [$territoryId => true];

    while ($queue !== []) {
        $currentId = (int) array_shift($queue);
        if ($currentId < 1 || isset($visited[$currentId])) {
            continue;
        }

        $visited[$currentId] = true;
        $descendantIds[] = $currentId;

        foreach ($childrenByParent[$currentId] ?? [] as $childId) {
            if (!isset($visited[(int) $childId])) {
                $queue[] = (int) $childId;
            }
        }
    }

    return $descendantIds;
}
