<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../political-territory-lib.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf Herrschaftsgebiets-Zoomstufen nicht synchronisieren.']);
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur POST ist erlaubt.']);
    }

    avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $zoomByTerritory = avesmapsPoliticalReadAssignmentZoomSyncPayload($payload);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $result = avesmapsPoliticalSyncAssignmentZoomsAcrossGeometries($pdo, $zoomByTerritory);

    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (Throwable $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => $exception instanceof InvalidArgumentException
            ? $exception->getMessage()
            : 'Die Herrschaftsgebiets-Zoomstufen konnten nicht synchronisiert werden.',
    ]);
}

function avesmapsPoliticalReadAssignmentZoomSyncPayload(array $payload): array {
    $rawDisplays = $payload['displays'] ?? $payload['assignment']['displays'] ?? [];
    if (!is_array($rawDisplays)) {
        throw new InvalidArgumentException('Die Breadcrumb-Zoomstufen fehlen.');
    }

    $zoomByTerritory = [];
    foreach ($rawDisplays as $display) {
        if (!is_array($display)) {
            continue;
        }

        $territoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        if ($territoryPublicId === '') {
            continue;
        }

        $territoryPublicId = avesmapsPoliticalReadPublicId($territoryPublicId);
        $minZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMin'] ?? $display['zoom_min'] ?? null);
        $maxZoom = avesmapsPoliticalReadOptionalZoom($display['zoomMax'] ?? $display['zoom_max'] ?? null);
        avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);
        $zoomByTerritory[$territoryPublicId] = ['zoomMin' => $minZoom, 'zoomMax' => $maxZoom];
    }

    return $zoomByTerritory;
}

function avesmapsPoliticalSyncAssignmentZoomsAcrossGeometries(PDO $pdo, array $zoomByTerritory): array {
    if ($zoomByTerritory === []) {
        return ['updated_geometries' => 0, 'updated_displays' => 0];
    }

    $selectStatement = $pdo->query('SELECT id, style_json FROM political_territory_geometry WHERE is_active = 1 AND style_json IS NOT NULL');
    if ($selectStatement === false) {
        return ['updated_geometries' => 0, 'updated_displays' => 0];
    }

    $updateStatement = $pdo->prepare('UPDATE political_territory_geometry SET style_json = :style_json WHERE id = :id');
    $updatedGeometries = 0;
    $updatedDisplays = 0;

    foreach ($selectStatement->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
        $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
        $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? null;
        if (!is_array($displays)) {
            continue;
        }

        $changed = false;
        foreach ($displays as $index => $display) {
            if (!is_array($display)) {
                continue;
            }

            $territoryPublicId = strtolower(trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? '')));
            if ($territoryPublicId === '' || !isset($zoomByTerritory[$territoryPublicId])) {
                continue;
            }

            $zoom = $zoomByTerritory[$territoryPublicId];
            if (($display['zoomMin'] ?? null) === $zoom['zoomMin'] && ($display['zoomMax'] ?? null) === $zoom['zoomMax']) {
                continue;
            }

            $displays[$index]['zoomMin'] = $zoom['zoomMin'];
            $displays[$index]['zoomMax'] = $zoom['zoomMax'];
            unset($displays[$index]['zoom_min'], $displays[$index]['zoom_max']);
            $changed = true;
            $updatedDisplays++;
        }

        if (!$changed) {
            continue;
        }

        $style['assignmentDisplays'] = array_values($displays);
        unset($style['assignment_displays']);
        $updateStatement->execute([
            'id' => (int) $geometry['id'],
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        ]);
        $updatedGeometries++;
    }

    return ['updated_geometries' => $updatedGeometries, 'updated_displays' => $updatedDisplays];
}
