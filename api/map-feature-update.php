<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

const AVESMAPS_LOCATION_SUBTYPES = ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude'];

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Kartendaten nicht bearbeiten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST' && $requestMethod !== 'PATCH' && $requestMethod !== 'DELETE') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST, PATCH oder DELETE sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'move_point'), 40);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $result = match ($action) {
        'move_point' => avesmapsMovePointFeature($pdo, $payload, $user),
        'update_point' => avesmapsUpdatePointFeatureDetails($pdo, $payload, $user),
        'create_point' => avesmapsCreatePointFeature($pdo, $payload, $user),
        'create_crossing' => avesmapsCreateCrossingFeature($pdo, $payload, $user),
        'create_path' => avesmapsCreatePathFeature($pdo, $payload, $user),
        'update_path_details' => avesmapsUpdatePathFeatureDetails($pdo, $payload, $user),
        'update_path_geometry' => avesmapsUpdatePathFeatureGeometry($pdo, $payload, $user),
        'create_label' => avesmapsCreateLabelFeature($pdo, $payload, $user),
        'update_label' => avesmapsUpdateLabelFeature($pdo, $payload, $user),
        'move_label' => avesmapsMoveLabelFeature($pdo, $payload, $user),
        'create_region' => avesmapsCreateRegionFeature($pdo, $payload, $user),
        'update_region' => avesmapsUpdateRegionFeature($pdo, $payload, $user),
        'update_region_geometry' => avesmapsUpdateRegionFeatureGeometry($pdo, $payload, $user),
        'delete_feature' => avesmapsDeleteMapFeature($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Edit-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, [
        'ok' => true,
        'feature' => $result,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht gespeichert werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsReadMapFeaturePublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Feature-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsReadLocationName(mixed $value): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException('Der Ortsname fehlt.');
    }

    return $name;
}

function avesmapsReadFeatureName(mixed $value, string $fieldLabel): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException("{$fieldLabel} fehlt.");
    }

    return $name;
}

function avesmapsReadLocationSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'dorf'), 60);
    if (!in_array($subtype, AVESMAPS_LOCATION_SUBTYPES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    return $subtype;
}

function avesmapsLocationSubtypeLabel(string $subtype): string {
    return match ($subtype) {
        'metropole' => 'Metropole',
        'grossstadt' => 'Grosse Stadt',
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleine Stadt',
        'gebaeude' => 'Besondere Bauwerke/Staetten',
        default => 'Dorf',
    };
}

function avesmapsReadLocationDescription(mixed $value): string {
    return avesmapsNormalizeMultiline((string) $value, 1200);
}

function avesmapsReadPathSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'Weg'), 60);
    $allowedSubtypes = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Der Wegtyp ist ungueltig.');
    }

    return $subtype;
}

function avesmapsReadLabelSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'region'), 40);
    $allowedSubtypes = ['region', 'fluss', 'meer', 'gebirge', 'wald', 'kontinent', 'wueste', 'suempfe_moore', 'see', 'insel', 'sonstiges'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Die Label-Kategorie ist ungueltig.');
    }

    return $subtype;
}

function avesmapsReadLabelText(mixed $value): string {
    return avesmapsReadFeatureName($value, 'Der Labeltext');
}

function avesmapsReadLabelSize(mixed $value): int {
    $size = filter_var($value, FILTER_VALIDATE_INT);
    if ($size === false || $size < 10 || $size > 56) {
        throw new InvalidArgumentException('Die Label-Groesse ist ungueltig.');
    }

    return (int) $size;
}

function avesmapsReadLabelRotation(mixed $value): int {
    $rotation = filter_var($value, FILTER_VALIDATE_INT);
    if ($rotation === false || $rotation < -180 || $rotation > 180) {
        throw new InvalidArgumentException('Die Label-Rotation ist ungueltig.');
    }

    return (int) $rotation;
}

function avesmapsReadLabelZoom(mixed $value): int {
    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    if ($zoom === false || $zoom < 0 || $zoom > 5) {
        throw new InvalidArgumentException('Die Label-Zoomstufe ist ungueltig.');
    }

    return (int) $zoom;
}

function avesmapsReadLabelPriority(mixed $value): int {
    $priority = filter_var($value, FILTER_VALIDATE_INT);
    if ($priority === false || $priority < 1 || $priority > 5) {
        throw new InvalidArgumentException('Die Label-Prioritaet ist ungueltig.');
    }

    return (int) $priority;
}

function avesmapsReadHexColor(mixed $value): string {
    $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
    if (!preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color)) {
        throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
    }

    return $color;
}

function avesmapsReadOpacity(mixed $value): float {
    $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
    if ($opacity === false || $opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
    }

    return (float) $opacity;
}

function avesmapsReadPolygonCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 1 || !is_array($value[0] ?? null) || count($value[0]) < 4) {
        throw new InvalidArgumentException('Eine Region braucht mindestens drei Punkte.');
    }

    $ring = [];
    foreach ($value[0] as $coordinate) {
        if (!is_array($coordinate) || count($coordinate) !== 2) {
            throw new InvalidArgumentException('Die Regionskoordinaten sind ungueltig.');
        }
        $ring[] = [
            avesmapsParseMapCoordinate($coordinate[0], 'lng'),
            avesmapsParseMapCoordinate($coordinate[1], 'lat'),
        ];
    }

    return [$ring];
}

function avesmapsReadOptionalWikiUrl(mixed $value): string {
    return avesmapsNormalizeOptionalUrl((string) $value, 500, 'Der Wiki-Aventurica-Link');
}

function avesmapsFetchEditableFeature(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, revision
        FROM map_features
        WHERE public_id = :public_id
            AND is_active = 1
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute([
        'public_id' => $publicId,
    ]);

    $feature = $statement->fetch();
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }

    return $feature;
}

function avesmapsFetchEditablePointFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'Point') {
        throw new InvalidArgumentException('Aktuell kann diese Aktion nur Punkte bearbeiten.');
    }

    return $feature;
}

function avesmapsFetchEditableLineStringFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'LineString') {
        throw new InvalidArgumentException('Diese Aktion kann nur Wege bearbeiten.');
    }

    return $feature;
}

function avesmapsMovePointFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_lng,
                min_y = :min_lat,
                max_x = :max_lng,
                max_y = :max_lat,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_lng' => $lng,
            'min_lat' => $lat,
            'max_lng' => $lng,
            'max_lat' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, (string) ($feature['name'] ?? ''), (string) $feature['feature_subtype'], $lat, $lng, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePointFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['feature_type'] = 'location';
        $properties['feature_subtype'] = $subtype;
        $properties['settlement_class'] = $subtype;
        $properties['settlement_class_label'] = avesmapsLocationSubtypeLabel($subtype);
        if ($description === '') {
            unset($properties['description']);
        } else {
            $properties['description'] = $description;
        }
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }

        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'name' => $name,
            'feature_subtype' => $subtype,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePointFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'settlement_class' => $subtype,
        'settlement_class_label' => avesmapsLocationSubtypeLabel($subtype),
    ];
    if ($description !== '') {
        $properties['description'] = $description;
    }
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_point', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'name' => $name,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateCrossingFeature(PDO $pdo, array $payload, array $user): array {
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $name = 'Kreuzung';
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'junction',
        'feature_subtype' => 'crossing',
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_crossing', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, 'crossing', $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePathFeature(PDO $pdo, array $payload, array $user): array {
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');
    $name = avesmapsReadFeatureName($payload['name'] ?? $subtype, 'Der Wegname');
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'LineString',
        'coordinates' => $coordinates,
    ];
    $properties = [
        'name' => $name,
        'display_name' => $name,
        'feature_type' => 'path',
        'feature_subtype' => $subtype,
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'LineString',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_path', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePathFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Wegname');
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $name;
        $properties['display_name'] = $name;
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $subtype;
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_details', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'name' => $name,
            'feature_subtype' => $subtype,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePathFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $name = avesmapsNormalizeSingleLine((string) ($feature['name'] ?? $properties['name'] ?? 'Weg'), 160) ?: 'Weg';
        $subtype = avesmapsReadPathSubtype($feature['feature_subtype'] ?? $properties['feature_subtype'] ?? 'Weg');
        $geometry = [
            'type' => 'LineString',
            'coordinates' => $coordinates,
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $text,
        'text' => $text,
        'feature_type' => 'label',
        'feature_subtype' => $subtype,
        'size' => $size,
        'rotation' => $rotation,
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'priority' => $priority,
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'feature_subtype' => $subtype,
            'name' => $text,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['name'] = $text;
        $properties['text'] = $text;
        $properties['feature_type'] = 'label';
        $properties['feature_subtype'] = $subtype;
        $properties['size'] = $size;
        $properties['rotation'] = $rotation;
        $properties['min_zoom'] = $minZoom;
        $properties['max_zoom'] = $maxZoom;
        $properties['priority'] = $priority;
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [0, 0];
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $text,
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, (float) $coordinates[1], (float) $coordinates[0], $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsMoveLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, (string) $feature['name'], (string) $feature['feature_subtype'], $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadFeatureName($payload['name'] ?? 'Neue Region', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $publicId = avesmapsUuidV4();
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $properties = [
        'type' => 'region',
        'name' => $name,
        'fill' => $color,
        'stroke' => $color,
        'fillOpacity' => $opacity,
        'feature_type' => 'region',
        'feature_subtype' => 'region',
    ];
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'region',
            'feature_subtype' => 'region',
            'name' => $name,
            'geometry_type' => 'Polygon',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_region', (int) $user['id'], '{}', avesmapsEncodeAuditJson(['public_id' => $publicId, 'name' => $name, 'revision' => $revision]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['type'] = 'region';
        $properties['name'] = $name;
        $properties['fill'] = $color;
        $properties['stroke'] = $color;
        $properties['fillOpacity'] = $opacity;
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }
        $style = avesmapsDecodeJsonColumnForEdit($feature['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :properties_json, style_json = :style_json, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'name' => $name, 'properties_json' => avesmapsEncodeJson($properties), 'style_json' => avesmapsEncodeJson($style), 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson(['public_id' => $publicId, 'name' => $name, 'revision' => $revision]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null), $properties + $style, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET geometry_json = :geometry_json, min_x = :min_x, min_y = :min_y, max_x = :max_x, max_y = :max_y, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'geometry_json' => avesmapsEncodeJson($geometry), 'min_x' => $bounds['min_x'], 'min_y' => $bounds['min_y'], 'max_x' => $bounds['max_x'], 'max_y' => $bounds['max_y'], 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson(['public_id' => $publicId, 'revision' => $revision]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, (string) $feature['name'], $geometry, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsDeleteMapFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET is_active = 0,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'delete_feature', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'is_active' => 0,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return [
            'public_id' => $publicId,
            'deleted' => true,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsReadPointCoordinatesFromGeometry(array $geometry): array {
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates) || count($coordinates) < 2 || !is_numeric($coordinates[0]) || !is_numeric($coordinates[1])) {
        throw new RuntimeException('Die Point-Geometrie ist ungueltig.');
    }

    return [(float) $coordinates[0], (float) $coordinates[1]];
}

function avesmapsReadLineStringCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 2) {
        throw new InvalidArgumentException('Ein Weg braucht mindestens Start- und Endpunkt.');
    }

    $coordinates = [];
    foreach ($value as $index => $coordinatePair) {
        if (!is_array($coordinatePair) || count($coordinatePair) < 2) {
            throw new InvalidArgumentException('Die Wegkoordinaten sind ungueltig.');
        }

        $lat = avesmapsParseMapCoordinate($coordinatePair[0] ?? null, "coordinates[{$index}][0]");
        $lng = avesmapsParseMapCoordinate($coordinatePair[1] ?? null, "coordinates[{$index}][1]");
        $coordinates[] = [$lng, $lat];
    }

    $firstCoordinate = $coordinates[0];
    $lastCoordinate = $coordinates[count($coordinates) - 1];
    if (abs($firstCoordinate[0] - $lastCoordinate[0]) < 0.0001 && abs($firstCoordinate[1] - $lastCoordinate[1]) < 0.0001) {
        throw new InvalidArgumentException('Start und Ziel des Weges duerfen nicht identisch sein.');
    }

    return $coordinates;
}

function avesmapsCalculateLineStringBounds(array $coordinates): array {
    $xValues = array_map(static fn(array $coordinate): float => (float) $coordinate[0], $coordinates);
    $yValues = array_map(static fn(array $coordinate): float => (float) $coordinate[1], $coordinates);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsNextMapSortOrder(PDO $pdo): int {
    $statement = $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM map_features');
    $sortOrder = $statement !== false ? $statement->fetchColumn() : false;

    return $sortOrder === false ? 1 : (int) $sortOrder;
}

function avesmapsNextMapRevision(PDO $pdo): int {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Kartenrevision konnte nicht gelesen werden.');
    }

    return (int) $revision;
}

function avesmapsWriteMapAuditLog(PDO $pdo, int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): void {
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
        VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);
}

function avesmapsBuildPointFeatureResponse(string $publicId, string $name, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    return [
        'public_id' => $publicId,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'location_type' => $subtype,
        'location_type_label' => avesmapsLocationSubtypeLabel($subtype),
        'description' => (string) ($properties['description'] ?? ''),
        'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
        'lat' => $lat,
        'lng' => $lng,
        'revision' => $revision,
    ];
}

function avesmapsBuildLineStringFeatureResponse(string $publicId, string $name, string $subtype, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['feature_type'] = 'path';
    $properties['feature_subtype'] = $subtype;
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties + [
            'name' => $name,
        ],
    ];
}

function avesmapsBuildLabelFeatureResponse(string $publicId, string $text, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['name'] = $text;
    $properties['text'] = $text;
    $properties['feature_type'] = 'label';
    $properties['feature_subtype'] = $subtype;
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ],
        'properties' => $properties,
    ];
}

function avesmapsBuildRegionFeatureResponse(string $publicId, string $name, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['type'] = 'region';
    $properties['name'] = $name;
    $properties['feature_type'] = 'region';
    $properties['feature_subtype'] = 'region';
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties,
    ];
}

function avesmapsDecodeJsonColumnForEdit(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : [];
}

function avesmapsEncodeAuditJson(array $value): string {
    return avesmapsEncodeJson($value);
}

function avesmapsEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
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

function avesmapsRollbackAndRethrow(PDO $pdo, Throwable $exception): never {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    throw $exception;
}
