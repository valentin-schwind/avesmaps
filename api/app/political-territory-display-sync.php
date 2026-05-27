<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/political/territory.php';

$debugErrors = filter_var($_GET['debug_errors'] ?? false, FILTER_VALIDATE_BOOL);

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Herrschaftsgebiete nicht bearbeiten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'PATCH' && $requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST und PATCH sind fuer die Herrschaftsgebiet-Anzeige-Synchronisierung erlaubt.',
        ]);
    }

    avesmapsRequireUserWithCapability('edit');

    $payload = avesmapsReadJsonRequest();
    $territoryPublicId = avesmapsNormalizeSingleLine((string) ($payload['territory_public_id'] ?? $payload['public_id'] ?? ''), 80);
    if ($territoryPublicId === '') {
        throw new InvalidArgumentException('Die ID des Herrschaftsgebiets fehlt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $territoryPublicId);
    $updated = avesmapsPoliticalDisplaySyncTerritoryGeometryStyles($pdo, $territory);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'updated_geometries' => $updated,
    ]);
} catch (Throwable $exception) {
    $message = $exception instanceof InvalidArgumentException
        ? $exception->getMessage()
        : 'Die Herrschaftsgebiet-Anzeige konnte nicht synchronisiert werden.';
    if ($debugErrors) {
        $message .= ' [' . get_class($exception) . ': ' . $exception->getMessage() . ']';
    }
    avesmapsJsonResponse($exception instanceof InvalidArgumentException ? 400 : 500, [
        'ok' => false,
        'error' => $message,
    ]);
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
