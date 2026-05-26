<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../political-territory-lib.php';

if (!function_exists('avesmapsPoliticalReadPublicId')) {
    function avesmapsPoliticalReadPublicId(mixed $value): string {
        $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
        if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
            throw new InvalidArgumentException('Die Herrschaftsgebiet-ID ist ungueltig.');
        }

        return strtolower($publicId);
    }
}

if (!function_exists('avesmapsPoliticalNullableInt')) {
    function avesmapsPoliticalNullableInt(mixed $value): ?int {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : null;
    }
}

if (!function_exists('avesmapsPoliticalReadRequiredName')) {
    function avesmapsPoliticalReadRequiredName(mixed $value, string $fieldLabel): string {
        $name = avesmapsNormalizeSingleLine((string) $value, 255);
        if ($name === '') {
            throw new InvalidArgumentException("{$fieldLabel} fehlt.");
        }

        return $name;
    }
}

if (!function_exists('avesmapsPoliticalReadHexColor')) {
    function avesmapsPoliticalReadHexColor(mixed $value): string {
        $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
        if (preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color) !== 1) {
            throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
        }

        return $color;
    }
}

if (!function_exists('avesmapsPoliticalReadOpacity')) {
    function avesmapsPoliticalReadOpacity(mixed $value): float {
        $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
        if ($opacity === false || $opacity < 0 || $opacity > 1) {
            throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
        }

        return (float) $opacity;
    }
}

if (!function_exists('avesmapsPoliticalReadOptionalInt')) {
    function avesmapsPoliticalReadOptionalInt(mixed $value): ?int {
        if ($value === null || $value === '') {
            return null;
        }

        $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
        if ($parsedValue === false) {
            throw new InvalidArgumentException('Ein Zahlenwert ist ungueltig.');
        }

        return (int) $parsedValue;
    }
}

if (!function_exists('avesmapsPoliticalReadOptionalZoom')) {
    function avesmapsPoliticalReadOptionalZoom(mixed $value): ?int {
        if ($value === null || $value === '') {
            return null;
        }

        $zoom = filter_var($value, FILTER_VALIDATE_INT);
        if ($zoom === false || $zoom < 0 || $zoom > 6) {
            throw new InvalidArgumentException('Die Zoomstufe ist ungueltig.');
        }

        return (int) $zoom;
    }
}

if (!function_exists('avesmapsPoliticalReadOptionalUrl')) {
    function avesmapsPoliticalReadOptionalUrl(mixed $value, string $fieldLabel): string {
        return avesmapsNormalizeOptionalUrl((string) ($value ?? ''), 500, $fieldLabel);
    }
}

if (!function_exists('avesmapsPoliticalFetchTerritoryByPublicId')) {
    function avesmapsPoliticalFetchTerritoryByPublicId(PDO $pdo, string $publicId): array {
        $statement = $pdo->prepare(
            'SELECT *
            FROM political_territory
            WHERE public_id = :public_id
            LIMIT 1'
        );
        $statement->execute(['public_id' => $publicId]);
        $territory = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$territory) {
            throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
        }

        return $territory;
    }
}

if (!function_exists('avesmapsPoliticalFetchGeometryByPublicId')) {
    function avesmapsPoliticalFetchGeometryByPublicId(PDO $pdo, string $publicId): array {
        $statement = $pdo->prepare(
            'SELECT *
            FROM political_territory_geometry
            WHERE public_id = :public_id
                AND is_active = 1
            LIMIT 1'
        );
        $statement->execute(['public_id' => $publicId]);
        $geometry = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$geometry) {
            throw new InvalidArgumentException('Die Geometrie wurde nicht gefunden.');
        }

        return $geometry;
    }
}

if (!function_exists('avesmapsPoliticalReadAssignmentDisplaysFromStyle')) {
    function avesmapsPoliticalReadAssignmentDisplaysFromStyle(array $style): array {
        $rawDisplays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? [];
        if (!is_array($rawDisplays)) {
            return [];
        }

        $displays = [];
        foreach ($rawDisplays as $rawDisplay) {
            if (!is_array($rawDisplay)) {
                continue;
            }

            $territoryPublicId = trim((string) (
                $rawDisplay['territoryPublicId']
                ?? $rawDisplay['territory_public_id']
                ?? ''
            ));

            $nodeKey = trim((string) (
                $rawDisplay['nodeKey']
                ?? $rawDisplay['node_key']
                ?? ''
            ));

            $originalName = trim((string) (
                $rawDisplay['originalName']
                ?? $rawDisplay['original_name']
                ?? $rawDisplay['name']
                ?? ''
            ));

            $displayName = trim((string) (
                $rawDisplay['displayName']
                ?? $rawDisplay['display_name']
                ?? ''
            ));

            if ($territoryPublicId === '' && $nodeKey === '' && $originalName === '' && $displayName === '') {
                continue;
            }

            $opacity = $rawDisplay['opacity'] ?? null;
            $displays[] = [
                'territoryPublicId' => $territoryPublicId,
                'territory_public_id' => $territoryPublicId,
                'nodeKey' => $nodeKey,
                'node_key' => $nodeKey,
                'originalName' => $originalName,
                'original_name' => $originalName,
                'displayName' => $displayName,
                'display_name' => $displayName,
                'coatOfArmsUrl' => trim((string) (
                    $rawDisplay['coatOfArmsUrl']
                    ?? $rawDisplay['coat_of_arms_url']
                    ?? ''
                )),
                'color' => trim((string) ($rawDisplay['color'] ?? '')),
                'opacity' => is_numeric($opacity) ? (float) $opacity : null,
                'zoomMin' => avesmapsPoliticalNullableInt($rawDisplay['zoomMin'] ?? $rawDisplay['zoom_min'] ?? null),
                'zoomMax' => avesmapsPoliticalNullableInt($rawDisplay['zoomMax'] ?? $rawDisplay['zoom_max'] ?? null),
            ];
        }

        return $displays;
    }
}

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

    if (!in_array($requestMethod, ['POST', 'PATCH'], true)) {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST und PATCH sind fuer Darstellungs-Overrides erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);

    $response = match ($action) {
        'state' => avesmapsPoliticalDisplayOverrideState($pdo, $payload),
        'snapshot_globals' => avesmapsPoliticalDisplayOverrideSnapshotGlobals($pdo, $payload),
        'restore_globals' => avesmapsPoliticalDisplayOverrideRestoreGlobals($pdo, $payload),
        'reset_local' => avesmapsPoliticalDisplayOverrideResetLocal($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Darstellungs-Override-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Darstellungs-Overrides konnten nicht aus der Datenbank verarbeitet werden.',
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Darstellungs-Overrides konnten nicht verarbeitet werden.',
    ]);
}

function avesmapsPoliticalDisplayOverrideReadGeometry(PDO $pdo, array $payload): array {
    return avesmapsPoliticalFetchGeometryByPublicId(
        $pdo,
        avesmapsPoliticalReadPublicId($payload['geometry_public_id'] ?? $payload['public_id'] ?? '')
    );
}

function avesmapsPoliticalDisplayOverrideState(PDO $pdo, array $payload): array {
    $geometry = avesmapsPoliticalDisplayOverrideReadGeometry($pdo, $payload);
    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
    $assignmentDisplays = avesmapsPoliticalReadAssignmentDisplaysFromStyle($style);
    $territoriesByPublicId = avesmapsPoliticalDisplayOverrideFetchDisplayTerritories($pdo, $style);
    $hasOverride = false;
    $reasons = [];

    $source = trim((string) ($geometry['source'] ?? ''));
    if ($source === 'editor-display') {
        $hasOverride = true;
        $reasons[] = 'geometry_source_display';
    }

    $geometryMinZoom = avesmapsPoliticalNullableInt($geometry['min_zoom'] ?? null);
    $geometryMaxZoom = avesmapsPoliticalNullableInt($geometry['max_zoom'] ?? null);
    if ($geometryMinZoom !== null || $geometryMaxZoom !== null) {
        $hasOverride = true;
        $reasons[] = 'geometry_zoom';
    }

    foreach ($assignmentDisplays as $display) {
        $territoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        if ($territoryPublicId === '' || !isset($territoriesByPublicId[$territoryPublicId])) {
            continue;
        }

        if (avesmapsPoliticalDisplayOverrideDiffersFromTerritory($display, $territoriesByPublicId[$territoryPublicId])) {
            $hasOverride = true;
            $reasons[] = 'assignment_display_changed';
            break;
        }
    }

    $topLevelDisplayFields = [
        'displayName',
        'display_name',
        'name',
        'coatOfArmsUrl',
        'coat_of_arms_url',
        'fill',
        'stroke',
        'color',
        'opacity',
        'fillOpacity',
        'fill_opacity',
    ];
    foreach ($topLevelDisplayFields as $field) {
        if (array_key_exists($field, $style)) {
            $hasOverride = true;
            $reasons[] = 'geometry_style';
            break;
        }
    }

    return [
        'ok' => true,
        'geometry_public_id' => (string) $geometry['public_id'],
        'has_override' => $hasOverride,
        'reasons' => array_values(array_unique($reasons)),
    ];
}

function avesmapsPoliticalDisplayOverrideDiffersFromTerritory(array $display, array $territory): bool {
    $displayName = trim((string) ($display['displayName'] ?? $display['display_name'] ?? ''));
    if ($displayName !== '' && $displayName !== trim((string) ($territory['name'] ?? ''))) {
        return true;
    }

    $coat = trim((string) ($display['coatOfArmsUrl'] ?? $display['coat_of_arms_url'] ?? ''));
    if ($coat !== '' && $coat !== trim((string) ($territory['coat_of_arms_url'] ?? ''))) {
        return true;
    }

    $color = trim((string) ($display['color'] ?? ''));
    if ($color !== '' && mb_strtolower($color) !== mb_strtolower(trim((string) ($territory['color'] ?? '')))) {
        return true;
    }

    if (array_key_exists('opacity', $display) && $display['opacity'] !== null) {
        $displayOpacity = round((float) $display['opacity'], 3);
        $territoryOpacity = round((float) ($territory['opacity'] ?? 0.33), 3);
        if ($displayOpacity !== $territoryOpacity) {
            return true;
        }
    }

    $zoomMin = avesmapsPoliticalNullableInt($display['zoomMin'] ?? $display['zoom_min'] ?? null);
    $zoomMax = avesmapsPoliticalNullableInt($display['zoomMax'] ?? $display['zoom_max'] ?? null);
    if ($zoomMin !== avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null)) {
        return true;
    }
    if ($zoomMax !== avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null)) {
        return true;
    }

    return false;
}

function avesmapsPoliticalDisplayOverrideFetchDisplayTerritories(PDO $pdo, array $style): array {
    $territoryPublicIds = [];
    foreach (avesmapsPoliticalReadAssignmentDisplaysFromStyle($style) as $display) {
        $territoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        if ($territoryPublicId !== '') {
            $territoryPublicIds[$territoryPublicId] = true;
        }
    }

    if ($territoryPublicIds === []) {
        return [];
    }

    $territories = [];
    foreach (array_keys($territoryPublicIds) as $territoryPublicId) {
        try {
            $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $territoryPublicId);
            $territories[(string) $territory['public_id']] = $territory;
        } catch (Throwable) {
            continue;
        }
    }

    return $territories;
}

function avesmapsPoliticalDisplayOverrideSnapshotGlobals(PDO $pdo, array $payload): array {
    $displays = is_array($payload['displays'] ?? null) ? $payload['displays'] : [];
    $snapshots = [];
    $seen = [];

    foreach ($displays as $display) {
        if (!is_array($display)) {
            continue;
        }

        $territoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        if ($territoryPublicId === '' || isset($seen[$territoryPublicId])) {
            continue;
        }
        $seen[$territoryPublicId] = true;

        try {
            $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $territoryPublicId);
        } catch (Throwable) {
            continue;
        }

        $snapshots[] = avesmapsPoliticalDisplayOverrideTerritorySnapshot($territory);
    }

    return [
        'ok' => true,
        'snapshots' => $snapshots,
    ];
}

function avesmapsPoliticalDisplayOverrideTerritorySnapshot(array $territory): array {
    return [
        'territory_public_id' => (string) ($territory['public_id'] ?? ''),
        'name' => (string) ($territory['name'] ?? ''),
        'color' => (string) ($territory['color'] ?? '#888888'),
        'opacity' => (float) ($territory['opacity'] ?? 0.33),
        'coat_of_arms_url' => (string) ($territory['coat_of_arms_url'] ?? ''),
        'min_zoom' => avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null),
        'valid_from_bf' => avesmapsPoliticalNullableInt($territory['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNullableInt($territory['valid_to_bf'] ?? null),
    ];
}

function avesmapsPoliticalDisplayOverrideRestoreGlobals(PDO $pdo, array $payload): array {
    $snapshots = is_array($payload['snapshots'] ?? null) ? $payload['snapshots'] : [];
    $changed = 0;

    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET name = :name,
            color = :color,
            opacity = :opacity,
            coat_of_arms_url = :coat_of_arms_url,
            min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf
        WHERE public_id = :public_id'
    );

    foreach ($snapshots as $snapshot) {
        if (!is_array($snapshot)) {
            continue;
        }

        $territoryPublicId = trim((string) ($snapshot['territory_public_id'] ?? $snapshot['territoryPublicId'] ?? ''));
        if ($territoryPublicId === '') {
            continue;
        }

        $statement->execute([
            'public_id' => $territoryPublicId,
            'name' => avesmapsPoliticalReadRequiredName($snapshot['name'] ?? '', 'Der Name des Herrschaftsgebiets'),
            'color' => avesmapsPoliticalReadHexColor($snapshot['color'] ?? '#888888'),
            'opacity' => avesmapsPoliticalReadOpacity($snapshot['opacity'] ?? 0.33),
            'coat_of_arms_url' => avesmapsPoliticalNullableString(avesmapsPoliticalReadOptionalUrl($snapshot['coat_of_arms_url'] ?? '', 'Der Wappen-Link')),
            'min_zoom' => avesmapsPoliticalReadOptionalZoom($snapshot['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalReadOptionalZoom($snapshot['max_zoom'] ?? null),
            'valid_from_bf' => avesmapsPoliticalReadOptionalInt($snapshot['valid_from_bf'] ?? null),
            'valid_to_bf' => avesmapsPoliticalReadOptionalInt($snapshot['valid_to_bf'] ?? null),
        ]);
        $changed += $statement->rowCount();
    }

    return [
        'ok' => true,
        'restored' => $changed,
    ];
}

function avesmapsPoliticalDisplayOverrideResetLocal(PDO $pdo, array $payload, array $user): array {
    $geometry = avesmapsPoliticalDisplayOverrideReadGeometry($pdo, $payload);
    $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);

    unset(
        $style['assignmentDisplays'],
        $style['assignment_displays'],
        $style['displayName'],
        $style['display_name'],
        $style['name'],
        $style['coatOfArmsUrl'],
        $style['coat_of_arms_url'],
        $style['fill'],
        $style['stroke'],
        $style['fillOpacity'],
        $style['fill_opacity'],
        $style['color'],
        $style['opacity']
    );

    $statement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET min_zoom = NULL,
            max_zoom = NULL,
            style_json = :style_json,
            source = :source,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $geometry['id'],
        'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        'source' => 'editor-global-display',
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return [
        'ok' => true,
        'geometry_public_id' => (string) $geometry['public_id'],
        'local_reset' => true,
    ];
}
