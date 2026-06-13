<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/political/territory.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Herrschaftsgebiete nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'PATCH' && $requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST und PATCH sind fuer die Herrschaftsgebiet-Anzeige-Synchronisierung erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');

    $payload = avesmapsReadJsonRequest();
    $territoryPublicId = avesmapsNormalizeSingleLine((string) ($payload['territory_public_id'] ?? $payload['public_id'] ?? ''), 80);
    if ($territoryPublicId === '') {
        throw new InvalidArgumentException('Die ID des Herrschaftsgebiets fehlt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $territory = avesmapsPoliticalDisplaySyncFetchTerritoryByPublicId($pdo, $territoryPublicId);
    $updated = avesmapsPoliticalDisplaySyncTerritoryGeometryStyles($pdo, $territory);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'updated_geometries' => $updated,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Herrschaftsgebiet-Anzeige konnte nicht synchronisiert werden.');
}

function avesmapsPoliticalDisplaySyncFetchTerritoryByPublicId(PDO $pdo, string $publicId): array {
    $normalizedPublicId = avesmapsNormalizeSingleLine($publicId, 80);
    if ($normalizedPublicId === '') {
        throw new InvalidArgumentException('Die ID des Herrschaftsgebiets fehlt.');
    }

    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $normalizedPublicId]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$territory) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    return $territory;
}

function avesmapsPoliticalDisplaySyncTerritoryGeometryStyles(PDO $pdo, array $territory): int {
    $territoryId = (int) ($territory['id'] ?? 0);
    if ($territoryId < 1) {
        return 0;
    }

    $color = (string) ($territory['color'] ?? '#888888');
    $opacity = (float) ($territory['opacity'] ?? 0.33);
    $minZoom = avesmapsPoliticalDisplaySyncNullableInt($territory['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalDisplaySyncNullableInt($territory['max_zoom'] ?? null);
    $territoryPublicId = trim((string) ($territory['public_id'] ?? ''));
    $territorySlug = trim((string) ($territory['slug'] ?? ''));

    $select = $pdo->prepare(
        'SELECT id, style_json
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $select->execute(['territory_id' => $territoryId]);

    $update = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET style_json = :style_json
        WHERE id = :id'
    );

    $updated = 0;
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
        $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;
        $style = avesmapsPoliticalDisplaySyncAssignmentDisplays($style, $territoryPublicId, $territorySlug, $color, $opacity, $minZoom, $maxZoom);

        $update->execute([
            'id' => (int) ($geometry['id'] ?? 0),
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        ]);
        $updated += $update->rowCount();
    }

    return $updated;
}

function avesmapsPoliticalDisplaySyncAssignmentDisplays(array $style, string $territoryPublicId, string $territorySlug, string $color, float $opacity, ?int $minZoom, ?int $maxZoom): array {
    foreach (['assignmentDisplays', 'assignment_displays'] as $displayKey) {
        if (!is_array($style[$displayKey] ?? null)) {
            continue;
        }

        $displays = array_values($style[$displayKey]);
        foreach ($displays as &$display) {
            if (!is_array($display)) {
                continue;
            }

            $displayTerritoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
            $displayNodeKey = trim((string) ($display['nodeKey'] ?? $display['node_key'] ?? ''));
            $matchesPublicId = $territoryPublicId !== '' && $displayTerritoryPublicId === $territoryPublicId;
            $matchesSlug = $territorySlug !== '' && ($displayNodeKey === $territorySlug || avesmapsPoliticalSlug($displayNodeKey) === $territorySlug);

            if (!$matchesPublicId && !$matchesSlug) {
                continue;
            }

            $display['color'] = $color;
            $display['opacity'] = $opacity;
            $display['zoomMin'] = $minZoom;
            $display['zoomMax'] = $maxZoom;
        }
        unset($display);

        $style[$displayKey] = $displays;
    }

    return $style;
}

function avesmapsPoliticalDisplaySyncNullableInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    return (int) $value;
}
