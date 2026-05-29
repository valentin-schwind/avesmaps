<?php

declare(strict_types=1);

function avesmapsPoliticalAssignGeometryToTerritoryWithValidity(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );
    $territory = avesmapsPoliticalFetchTerritoryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['territory_public_id'] ?? '')
    );

    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $style['fill'] = (string) ($territory['color'] ?? '#888888');
    $style['stroke'] = (string) ($territory['color'] ?? '#888888');
    $style['fillOpacity'] = (float) ($territory['opacity'] ?? 0.33);

    $validity = [
        'startYear' => $payload['valid_from_bf'] ?? $geometry['valid_from_bf'] ?? $territory['valid_from_bf'] ?? null,
        'endYear' => $payload['valid_to_bf'] ?? $geometry['valid_to_bf'] ?? $territory['valid_to_bf'] ?? null,
        'existsUntilToday' => avesmapsPoliticalReadBoolean($payload['valid_to_open'] ?? false),
    ];

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET territory_id = :territory_id,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            min_zoom = NULL,
            max_zoom = NULL,
            style_json = :style_json,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'territory_id' => (int) $territory['id'],
        'valid_from_bf' => avesmapsPoliticalReadOptionalInt($validity['startYear']),
        'valid_to_bf' => avesmapsPoliticalReadEditorValidTo($validity, $geometry['valid_to_bf'] ?? null),
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'source' => 'editor-assignment',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return avesmapsPoliticalResponseForGeometry($pdo, (string) $geometry['public_id']);
}
