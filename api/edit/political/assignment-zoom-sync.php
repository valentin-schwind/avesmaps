<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/political/territory.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Herrschaftsgebiets-Zoomstufen nicht synchronisieren.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);

    if (!empty($payload['resync_all'])) {
        // One-time backfill of the min_zoom/max_zoom columns from every stored display band.
        $result = avesmapsPoliticalResyncAllAssignmentZooms($pdo);
    } else {
        $zoomByTerritory = avesmapsPoliticalReadAssignmentZoomSyncPayload($payload);
        $result = avesmapsPoliticalSyncAssignmentZoomsAcrossGeometries($pdo, $zoomByTerritory);
    }

    // Editor-Write -> Layer-Cache sofort leeren (sonst bleibt die Karte bis TTL stale).
    avesmapsPoliticalAssignmentZoomSyncInvalidateLayerCache();
    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Herrschaftsgebiets-Zoomstufen konnten nicht synchronisiert werden.');
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

    // Zusaetzlich die min_zoom/max_zoom-SPALTEN setzen, die die oeffentliche View liest
    // (geometry.min_zoom ?? territory.min_zoom, territories-layer.php) UND die Suche (territory.min_zoom).
    // Ohne das zeigte der Editor das display-Band, die Karte aber die stehengebliebenen Spalten -> die
    // beiden liefen auseinander (z. B. Editor 0-6, Karte 0-1).
    $updateTerritoryZoom = $pdo->prepare(
        'UPDATE political_territory SET min_zoom = :min_zoom, max_zoom = :max_zoom WHERE LOWER(public_id) = :public_id'
    );
    $updateGeometryZoom = $pdo->prepare(
        'UPDATE political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         SET g.min_zoom = :min_zoom, g.max_zoom = :max_zoom
         WHERE LOWER(t.public_id) = :public_id AND g.is_active = 1'
    );
    $updatedColumns = 0;
    foreach ($zoomByTerritory as $territoryPublicId => $zoom) {
        $params = ['min_zoom' => $zoom['zoomMin'], 'max_zoom' => $zoom['zoomMax'], 'public_id' => strtolower((string) $territoryPublicId)];
        $updateTerritoryZoom->execute($params);
        $updatedColumns += $updateTerritoryZoom->rowCount();
        $updateGeometryZoom->execute($params);
    }

    return ['updated_geometries' => $updatedGeometries, 'updated_displays' => $updatedDisplays, 'updated_columns' => $updatedColumns];
}

// SAFE one-time backfill of ONLY the min_zoom/max_zoom COLUMNS the public view reads
// (geometry.min_zoom ?? territory.min_zoom; map-search t.min_zoom). For each active geometry it reads
// the display band of ITS OWN territory (deterministic) and writes only the COLUMNS. It NEVER touches
// any assignmentDisplays.
//
// HISTORY: the earlier version built a "last geometry wins" map across ALL displays and reused
// avesmapsPoliticalSyncAssignmentZoomsAcrossGeometries, which ALSO rewrites the display bands. Because
// the same territory's band is scattered redundantly across ancestor-hull style_json (global-display
// quirk) and those copies had drifted, the bulk pass homogenised every territory to an arbitrary value
// -> it scrambled the editor zoom bands of many territories. This version cannot do that (read-only on
// displays, no cross-geometry "last wins").
function avesmapsPoliticalResyncAllAssignmentZooms(PDO $pdo): array {
    $selectStatement = $pdo->query(
        'SELECT g.id AS geometry_id, g.style_json, t.id AS territory_id, t.public_id AS territory_public_id
         FROM political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         WHERE g.is_active = 1 AND g.style_json IS NOT NULL'
    );
    if ($selectStatement === false) {
        return ['updated_geometries' => 0, 'updated_columns' => 0];
    }

    $updateGeometryZoom = $pdo->prepare('UPDATE political_territory_geometry SET min_zoom = :min_zoom, max_zoom = :max_zoom WHERE id = :id');
    $updateTerritoryZoom = $pdo->prepare('UPDATE political_territory SET min_zoom = :min_zoom, max_zoom = :max_zoom WHERE id = :id');
    $updatedGeometries = 0;
    $updatedColumns = 0;

    foreach ($selectStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $style = avesmapsPoliticalDecodeJson($row['style_json'] ?? null);
        $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? null;
        if (!is_array($displays)) {
            continue;
        }

        $ownPublicId = strtolower(trim((string) ($row['territory_public_id'] ?? '')));
        $minZoom = null;
        $maxZoom = null;
        $found = false;
        foreach ($displays as $display) {
            if (!is_array($display)) {
                continue;
            }
            $pid = strtolower(trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? '')));
            if ($pid !== $ownPublicId) {
                continue;
            }
            $min = $display['zoomMin'] ?? $display['zoom_min'] ?? null;
            $max = $display['zoomMax'] ?? $display['zoom_max'] ?? null;
            if ($min === null && $max === null) {
                continue;
            }
            $minZoom = $min === null ? null : (int) $min;
            $maxZoom = $max === null ? null : (int) $max;
            $found = true;
            break;
        }
        if (!$found) {
            continue;
        }

        $updateGeometryZoom->execute(['min_zoom' => $minZoom, 'max_zoom' => $maxZoom, 'id' => (int) $row['geometry_id']]);
        $updatedGeometries++;
        $updateTerritoryZoom->execute(['min_zoom' => $minZoom, 'max_zoom' => $maxZoom, 'id' => (int) $row['territory_id']]);
        $updatedColumns += $updateTerritoryZoom->rowCount();
    }

    return ['updated_geometries' => $updatedGeometries, 'updated_columns' => $updatedColumns];
}

function avesmapsPoliticalAssignmentZoomSyncInvalidateLayerCache(): void {
    $dir = sys_get_temp_dir() . '/avesmaps_layer_cache';
    if (!is_dir($dir)) {
        return;
    }
    foreach (glob($dir . '/*.json') ?: [] as $file) {
        @unlink($file);
    }
}
