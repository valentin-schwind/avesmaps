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
    if (in_array($source, ['editor-display', 'editor-assignment'], true)) {
        $hasOverride = true;
        $reasons[] = 'geometry_source';
    }

    $geometryMinZoom = avesmapsPoliticalNullableInt($geometry['min_zoom'] ?? null);
    $geometryMaxZoom = avesmapsPoliticalNullableInt($geometry['max_zoom'] ?? null);
    if ($geometryMinZoom !== null || $geometryMaxZoom !== null) {
        $hasOverride = true;
        $reasons[] = 'geometry_zoom';
    }

    if ($assignmentDisplays !== []) {
        $hasOverride = true;
        $reasons[] = 'assignment_displays_local';
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

    $topLevelDisplayFields = ['displayName', 'name', 'coatOfArmsUrl', 'coat_of_arms_url', 'fill', 'stroke', 'fillOpacity'];
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
