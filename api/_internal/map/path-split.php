<?php

declare(strict_types=1);

require_once __DIR__ . '/../app/feature-sources.php';

/** Teilt ausschliesslich die gespeicherte Geometrie; Eigenschaften bleiben serverseitig. */
function avesmapsSplitPathFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $nodeIndex = $payload['node_index'] ?? null;
    if (!is_int($nodeIndex) || avesmapsReadOptionalRevision($payload['expected_revision'] ?? null) === null) {
        throw new InvalidArgumentException('Teilungsknoten und Kartenobjekt-Version fehlen.');
    }

    // DDL muss VOR der Transaktion laufen: MySQL wuerde sie sonst implizit abschliessen.
    avesmapsEnsureFeatureSourceTables($pdo);
    $pdo->beginTransaction();
    try {
        $original = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        if ($original['feature_type'] !== 'path') {
            throw new InvalidArgumentException('Nur Wege koennen hier geteilt werden.');
        }
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $original, $user);
        $geometry = avesmapsDecodeJsonColumnForEdit($original['geometry_json']);
        $coordinates = $geometry['coordinates'] ?? [];
        if (!is_array($payload['expected_coordinates'] ?? null) || $payload['expected_coordinates'] != $coordinates) {
            throw new AvesmapsConflictException('Der Wegverlauf ist noch nicht gespeichert oder wurde inzwischen geaendert. Bitte neu laden.');
        }
        if ($nodeIndex <= 0 || $nodeIndex >= count($coordinates) - 1) {
            throw new InvalidArgumentException('Nur Zwischenknoten koennen einen Weg teilen.');
        }
        $parts = [array_slice($coordinates, 0, $nodeIndex + 1), array_slice($coordinates, $nodeIndex)];
        foreach ($parts as $part) {
            // Der vorhandene Leser erwartet Leaflet [lat, lng], der Bestand ist GeoJSON [x, y].
            avesmapsReadLineStringCoordinates(array_map(static fn(array $point): array => [$point[1], $point[0]], $part));
        }
        $properties = avesmapsDecodeJsonColumnForEdit($original['properties_json']);
        // Technische Identitaet darf nicht aus einem alten Import mitkopiert werden.
        unset($properties['public_id'], $properties['revision']);
        $revision = avesmapsNextMapRevision($pdo);
        $crossingGeometry = ['type' => 'Point', 'coordinates' => $coordinates[$nodeIndex]];
        $crossingProperties = ['name' => 'Kreuzung', 'feature_type' => 'junction', 'feature_subtype' => 'crossing'];
        $crossingId = avesmapsInsertSplitFeature($pdo, 'junction', 'crossing', 'Kreuzung', $crossingGeometry,
            $crossingProperties, null, $revision, (int) $user['id'], 'create_crossing');

        $copySources = $pdo->prepare(
            "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin,
                reference_kind, pages, note, created_by, created_at)
             SELECT entity_type, :target, source_id, status, origin, reference_kind, pages, note, created_by, created_at
             FROM feature_sources WHERE entity_type = 'path' AND entity_public_id = :original"
        );
        $paths = [];
        foreach ($parts as $part) {
            $partGeometry = ['type' => 'LineString', 'coordinates' => $part];
            $newId = avesmapsInsertSplitFeature($pdo, 'path', $original['feature_subtype'], $original['name'],
                $partGeometry, $properties, $original['style_json'], $revision, (int) $user['id'], 'create_path');
            // Auch suppressed und wiki_publication gehoeren zur geerbten Aussage. Der Katalog bleibt EINER.
            $copySources->execute(['target' => $newId, 'original' => $publicId]);
            $paths[] = avesmapsBuildLineStringFeatureResponse($newId, $original['name'], $original['feature_subtype'],
                $partGeometry, $properties, $revision);
        }

        $deactivate = $pdo->prepare('UPDATE map_features SET is_active = 0, revision = :revision, updated_by = :actor WHERE id = :id');
        $deactivate->execute(['revision' => $revision, 'actor' => (int) $user['id'], 'id' => (int) $original['id']]);
        // Die alten Quellen bleiben am deaktivierten Original fuer dessen bestehende Audit-Ruecknahme.
        avesmapsWriteMapAuditLog($pdo, (int) $original['id'], 'delete_feature', (int) $user['id'],
            avesmapsEncodeAuditJson($original), avesmapsEncodeAuditJson([
                'public_id' => $publicId, 'is_active' => 0, 'revision' => $revision,
            ]));
        $crossing = avesmapsBuildPointFeatureResponse($crossingId, 'Kreuzung', 'crossing',
            (float) $coordinates[$nodeIndex][1], (float) $coordinates[$nodeIndex][0], $crossingProperties, $revision);
        $pdo->commit();

        return ['revision' => $revision, 'paths' => $paths, 'crossing' => $crossing];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

/** Ein Teilungsobjekt samt bestehendem Einzel-Audit; Transaktion und Revision gehoeren dem Aufrufer. */
function avesmapsInsertSplitFeature(
    PDO $pdo, string $type, string $subtype, string $name, array $geometry, array $properties,
    ?string $styleJson, int $revision, int $userId, string $action
): string {
    $publicId = avesmapsUuidV4();
    $points = $geometry['type'] === 'Point' ? [$geometry['coordinates']] : $geometry['coordinates'];
    $bounds = avesmapsCalculateLineStringBounds($points);
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type,
            geometry_json, properties_json, style_json, min_x, min_y, max_x, max_y, sort_order, revision, created_by, updated_by)
         VALUES (:public_id, :feature_type, :feature_subtype, :name, :geometry_type,
            :geometry_json, :properties_json, :style_json, :min_x, :min_y, :max_x, :max_y, :sort_order, :revision, :created_by, :updated_by)'
    );
    $row = [
        'public_id' => $publicId, 'feature_type' => $type, 'feature_subtype' => $subtype, 'name' => $name,
        'geometry_type' => $geometry['type'], 'geometry_json' => avesmapsEncodeJson($geometry),
        'properties_json' => avesmapsEncodeJson($properties), 'style_json' => $styleJson,
        'min_x' => $bounds['min_x'], 'min_y' => $bounds['min_y'], 'max_x' => $bounds['max_x'], 'max_y' => $bounds['max_y'],
        'sort_order' => avesmapsNextMapSortOrder($pdo), 'revision' => $revision, 'created_by' => $userId, 'updated_by' => $userId,
    ];
    $insert->execute($row);
    avesmapsWriteMapAuditLog($pdo, (int) $pdo->lastInsertId(), $action, $userId, '{}', avesmapsEncodeAuditJson($row));

    return $publicId;
}
