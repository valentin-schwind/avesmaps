<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/political/territory.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Herrschaftsgebiete nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if (!in_array($requestMethod, ['POST', 'PATCH'], true)) {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST und PATCH sind fuer Subtree-Darstellungen erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);

    $response = match ($action) {
        'update_colors' => avesmapsPoliticalSubtreeDisplayUpdateColors($pdo, $payload, $user),
        'update_opacity' => avesmapsPoliticalSubtreeDisplayUpdateOpacity($pdo, $payload, $user),
        'update_zoom' => avesmapsPoliticalSubtreeDisplayUpdateZoom($pdo, $payload, $user),
        'normalize_leaf_zoom_bands' => avesmapsPoliticalSubtreeDisplayNormalizeLeafZoomBands($pdo, $payload, $user),
        'sync_geometry_zoom_to_territory' => avesmapsPoliticalSubtreeDisplaySyncGeometryZoomToTerritory($pdo, $payload, $user),
        'set_all_opacity' => avesmapsPoliticalSubtreeDisplaySetAllOpacity($pdo, $payload, $user),
        'update_validity' => avesmapsPoliticalSubtreeDisplayUpdateValidity($pdo, $payload, $user),
        'inherit_colors' => avesmapsPoliticalSubtreeDisplayInheritColors($pdo, $payload, $user),
        'inherit_opacity' => avesmapsPoliticalSubtreeDisplayInheritOpacity($pdo, $payload, $user),
        // Reiner Cache-Buster ohne Datenaenderung: die Invalidierung unten (Z. ~54) laeuft nach jeder
        // Aktion -> hier genuegt eine OK-Antwort. Praktisch nach Code-Deploys, die den Layer aendern
        // (z. B. Schraffur-Logik), damit der naechste Load frisch ist statt bis zum TTL gecacht.
        'invalidate_layer_cache' => ['ok' => true, 'invalidated' => true],
        default => throw new InvalidArgumentException('Die Subtree-Darstellungsaktion ist unbekannt.'),
    };

    // Layer-Cache nach JEDER Schreibaktion leeren. Dieser Endpunkt liegt getrennt vom
    // Haupt-Endpunkt (political-territories.php), der seinen Cache selbst invalidiert --
    // hier fehlte das. Folge: "Fuer alle Geschwisterregionen uebernehmen" schrieb Transparenz/
    // Zoom korrekt in die DB, aber der gecachte Layer (TTL 15s Editor / 300s public; der
    // _=-Cachebuster ist NICHT Teil des Cache-Keys) servierte weiter die alten Werte ->
    // Aenderung "kommt nicht an". Inline gehalten (kein Include-Pfad-Risiko), deckungsgleich
    // mit avesmapsPoliticalInvalidateLayerCache().
    avesmapsPoliticalSubtreeDisplayInvalidateLayerCache();

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Subtree-Darstellung konnte nicht in der Datenbank gespeichert werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Subtree-Darstellung konnte nicht verarbeitet werden.');
}

function avesmapsPoliticalSubtreeDisplayInvalidateLayerCache(): void {
    $dir = sys_get_temp_dir() . '/avesmaps_layer_cache';
    if (!is_dir($dir)) {
        return;
    }
    foreach (glob($dir . '/*.json') ?: [] as $file) {
        @unlink($file);
    }
}

function avesmapsPoliticalSubtreeDisplayUpdateColors(PDO $pdo, array $payload, array $user): array {
    $updates = avesmapsPoliticalSubtreeDisplayReadUpdates($payload['updates'] ?? null);
    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET color = :color,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET color = :color
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $color = avesmapsPoliticalSubtreeDisplayReadColor($update['color'] ?? '');
        $publicId = avesmapsPoliticalSubtreeDisplayResolveTerritoryPublicId($pdo, $update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $parameters = [
            ':color' => $color,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = (int) ($user['id'] ?? 0);
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
    }

    return [
        'ok' => true,
        'changed' => $changed,
        'received' => count($updates),
    ];
}

function avesmapsPoliticalSubtreeDisplayUpdateOpacity(PDO $pdo, array $payload, array $user): array {
    $updates = avesmapsPoliticalSubtreeDisplayReadUpdates($payload['updates'] ?? null);
    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET opacity = :opacity,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET opacity = :opacity
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $opacity = avesmapsPoliticalSubtreeDisplayReadOpacity($update['opacity'] ?? null);
        $publicId = avesmapsPoliticalSubtreeDisplayResolveTerritoryPublicId($pdo, $update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $parameters = [
            ':opacity' => $opacity,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = (int) ($user['id'] ?? 0);
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
    }

    return [
        'ok' => true,
        'changed' => $changed,
        'received' => count($updates),
    ];
}

function avesmapsPoliticalSubtreeDisplayReadOptionalZoom(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }
    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    if ($zoom === false || $zoom < 0 || $zoom > 6) {
        throw new InvalidArgumentException('Die Zoomstufe ist ungueltig.');
    }
    return (int) $zoom;
}

function avesmapsPoliticalSubtreeDisplayUpdateZoom(PDO $pdo, array $payload, array $user): array {
    $updates = avesmapsPoliticalSubtreeDisplayReadUpdates($payload['updates'] ?? null);
    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET min_zoom = :min_zoom,
            max_zoom = :max_zoom,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET min_zoom = :min_zoom,
            max_zoom = :max_zoom
        WHERE public_id = :public_id'
    );
    // CRITICAL: the public view reads geometry.min_zoom ?? territory.min_zoom (territories-layer.php). Writing
    // ONLY the territory column (as this used to) left the geometry band stale -> the layer kept rendering the
    // OLD band while the column said otherwise (e.g. column 4-6 but geometry 6-6 -> barony vanished at zoom 4-5
    // = hole). So write BOTH here, exactly like assignment-zoom-sync, and the two can never diverge again.
    $geometryStatement = $pdo->prepare(
        'UPDATE political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         SET g.min_zoom = :min_zoom, g.max_zoom = :max_zoom
         WHERE LOWER(t.public_id) = :public_id AND g.is_active = 1'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $minZoom = avesmapsPoliticalSubtreeDisplayReadOptionalZoom($update['min_zoom'] ?? $update['minZoom'] ?? null);
        $maxZoom = avesmapsPoliticalSubtreeDisplayReadOptionalZoom($update['max_zoom'] ?? $update['maxZoom'] ?? null);
        $publicId = avesmapsPoliticalSubtreeDisplayResolveTerritoryPublicId($pdo, $update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $parameters = [
            ':min_zoom' => $minZoom,
            ':max_zoom' => $maxZoom,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = (int) ($user['id'] ?? 0);
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
        $geometryStatement->execute([
            ':min_zoom' => $minZoom,
            ':max_zoom' => $maxZoom,
            ':public_id' => strtolower((string) $publicId),
        ]);
    }

    return [
        'ok' => true,
        'changed' => $changed,
        'received' => count($updates),
    ];
}

/**
 * Force a single fill opacity across ALL active political territories.
 *
 * The layer resolves opacity in priority order:
 *   assignmentDisplays[].opacity ?? style.fillOpacity ?? geometryStyle.fillOpacity ?? territory.opacity ?? 0.33
 * Writing only the territory column (the old update_opacity) therefore had NO visible effect whenever a higher
 * field was set. This writes every layer: the territory column AND, in each geometry's style_json, the top-level
 * fillOpacity AND every assignmentDisplays[].opacity. ONLY opacity fields are touched -- zoom band, colour and
 * everything else in style_json stay exactly as they are. `opacity` defaults to 0.7. dry-run by default.
 *
 * (Note: the public VIEW already renders POLITICAL_FRONTEND_FILL_OPACITY uniformly; this changes the STORED
 * values, which the editor and any per-territory opacity read.)
 */
function avesmapsPoliticalSubtreeDisplaySetAllOpacity(PDO $pdo, array $payload, array $user): array {
    $apply = filter_var($payload['apply'] ?? false, FILTER_VALIDATE_BOOL);
    $opacity = array_key_exists('opacity', $payload) ? (float) $payload['opacity'] : 0.7;
    $opacity = max(0.0, min(1.0, $opacity));

    $territoryCount = (int) $pdo->query('SELECT COUNT(*) FROM political_territory WHERE is_active = 1')->fetchColumn();
    $geometryRows = $pdo->query(
        'SELECT id, style_json FROM political_territory_geometry WHERE is_active = 1 AND style_json IS NOT NULL'
    )->fetchAll(PDO::FETCH_ASSOC);

    if (!$apply) {
        return ['ok' => true, 'dry_run' => true, 'target_opacity' => $opacity, 'territories' => $territoryCount, 'geometries_with_style' => count($geometryRows)];
    }

    $territoryStatement = $pdo->prepare('UPDATE political_territory SET opacity = :opacity WHERE is_active = 1');
    $territoryStatement->execute([':opacity' => $opacity]);
    $territoriesWritten = $territoryStatement->rowCount();

    $update = $pdo->prepare('UPDATE political_territory_geometry SET style_json = :style_json WHERE id = :id');
    $geometriesWritten = 0;
    foreach ($geometryRows as $row) {
        $style = json_decode((string) ($row['style_json'] ?? ''), true);
        if (!is_array($style)) {
            continue;
        }
        $style['fillOpacity'] = $opacity;
        foreach (['assignmentDisplays', 'assignment_displays'] as $key) {
            if (!isset($style[$key]) || !is_array($style[$key])) {
                continue;
            }
            foreach ($style[$key] as $i => $display) {
                if (is_array($display)) {
                    $style[$key][$i]['opacity'] = $opacity;
                }
            }
        }
        $encoded = json_encode($style, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded === false) {
            continue; // leave malformed style untouched rather than corrupt it
        }
        $update->execute([':style_json' => $encoded, ':id' => (int) $row['id']]);
        $geometriesWritten++;
    }

    return ['ok' => true, 'dry_run' => false, 'target_opacity' => $opacity, 'territories_written' => $territoriesWritten, 'geometries_written' => $geometriesWritten];
}

/**
 * Heal: copy every active geometry's zoom band from its OWN territory's column band.
 *
 * The public view reads `geometry.min_zoom ?? territory.min_zoom` (territories-layer.php). Older band writes
 * (notably the default-zoom reset) updated ONLY the territory column and left the geometry band stale -> the
 * map kept rendering the old band while the column said otherwise (e.g. column 4-6 but geometry 6-6, so the
 * barony vanished at zoom 4-5 = a hole). The two are always meant to be equal (assignment-zoom-sync writes
 * both). This makes the territory column the single source of truth and re-syncs every diverged geometry.
 * dry-run by default; writes only with apply:true.
 */
function avesmapsPoliticalSubtreeDisplaySyncGeometryZoomToTerritory(PDO $pdo, array $payload, array $user): array {
    $apply = filter_var($payload['apply'] ?? false, FILTER_VALIDATE_BOOL);

    $rows = $pdo->query(
        'SELECT t.name AS name,
                CAST(g.min_zoom AS SIGNED) AS g_min, CAST(g.max_zoom AS SIGNED) AS g_max,
                CAST(t.min_zoom AS SIGNED) AS t_min, CAST(t.max_zoom AS SIGNED) AS t_max
         FROM political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         WHERE g.is_active = 1 AND t.is_active = 1
           AND (NOT (g.min_zoom <=> t.min_zoom) OR NOT (g.max_zoom <=> t.max_zoom))'
    )->fetchAll(PDO::FETCH_ASSOC);

    $changes = array_map(static fn(array $r): array => [
        'name' => (string) ($r['name'] ?? ''),
        'geometry_band' => (($r['g_min'] ?? 'null') . '-' . ($r['g_max'] ?? 'null')),
        'territory_band' => (($r['t_min'] ?? 'null') . '-' . ($r['t_max'] ?? 'null')),
    ], $rows);

    if (!$apply) {
        return ['ok' => true, 'dry_run' => true, 'diverging_geometries' => count($changes), 'changes' => array_slice($changes, 0, 60)];
    }

    $written = $pdo->exec(
        'UPDATE political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         SET g.min_zoom = t.min_zoom, g.max_zoom = t.max_zoom
         WHERE g.is_active = 1 AND t.is_active = 1
           AND (NOT (g.min_zoom <=> t.min_zoom) OR NOT (g.max_zoom <=> t.max_zoom))'
    );

    return ['ok' => true, 'dry_run' => false, 'diverging_geometries' => count($changes), 'written' => (int) $written];
}

/**
 * Restore consistent leaf zoom bands across ALL realms.
 *
 * Within one parent, the lowest-level territories (baronies) should share a single zoom band; mixed bands make
 * the parent hand off at a zoom where only some children render, leaving the rest empty. For each parent we take
 * the band MOST of its leaf children already use (= the one that renders correctly) and copy it onto the leaves
 * that differ. Non-leaf children (counties that themselves own baronies) are ignored, so their legitimately
 * varying bands stay untouched. Each leaf is normalized against its OWN siblings only -- never across realms.
 *
 * `apply` defaults to false (dry-run: returns the planned changes without writing). Pass `apply: true` to persist.
 */
function avesmapsPoliticalSubtreeDisplayNormalizeLeafZoomBands(PDO $pdo, array $payload, array $user): array {
    $apply = filter_var($payload['apply'] ?? false, FILTER_VALIDATE_BOOL);

    $rows = $pdo->query(
        'SELECT id, public_id, parent_id, name,
                CAST(min_zoom AS SIGNED) AS min_zoom, CAST(max_zoom AS SIGNED) AS max_zoom
         FROM political_territory
         WHERE is_active = 1'
    )->fetchAll(PDO::FETCH_ASSOC);

    // Group children by parent id; a territory is a LEAF when no active child points at it.
    $childrenByParent = [];
    $hasChildren = [];
    foreach ($rows as $row) {
        if ($row['parent_id'] === null) {
            continue;
        }
        $parentId = (int) $row['parent_id'];
        $childrenByParent[$parentId][] = $row;
        $hasChildren[$parentId] = true;
    }

    $changes = [];
    foreach ($childrenByParent as $kids) {
        $leaves = [];
        foreach ($kids as $kid) {
            if (!isset($hasChildren[(int) $kid['id']])) {
                $leaves[] = $kid;
            }
        }
        if (count($leaves) < 2) {
            continue;
        }
        $counts = [];
        foreach ($leaves as $leaf) {
            $band = ((int) $leaf['min_zoom']) . '-' . ((int) $leaf['max_zoom']);
            $counts[$band] = ($counts[$band] ?? 0) + 1;
        }
        if (count($counts) < 2) {
            continue; // already consistent
        }
        $bands = array_keys($counts);
        usort($bands, static function (string $a, string $b) use ($counts): int {
            if ($counts[$b] !== $counts[$a]) {
                return $counts[$b] <=> $counts[$a]; // most frequent wins
            }
            return ((int) explode('-', $a)[0]) <=> ((int) explode('-', $b)[0]); // tiebreak: lowest min_zoom
        });
        [$targetMin, $targetMax] = array_map('intval', explode('-', $bands[0]));
        foreach ($leaves as $leaf) {
            if ((int) $leaf['min_zoom'] === $targetMin && (int) $leaf['max_zoom'] === $targetMax) {
                continue;
            }
            $changes[] = [
                'public_id' => (string) $leaf['public_id'],
                'name' => (string) ($leaf['name'] ?? ''),
                'from' => ((int) $leaf['min_zoom']) . '-' . ((int) $leaf['max_zoom']),
                'to' => $targetMin . '-' . $targetMax,
                'min_zoom' => $targetMin,
                'max_zoom' => $targetMax,
            ];
        }
    }

    if (!$apply) {
        return ['ok' => true, 'dry_run' => true, 'planned_changes' => count($changes), 'changes' => $changes];
    }

    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory SET min_zoom = :min_zoom, max_zoom = :max_zoom, updated_by = :updated_by WHERE public_id = :public_id'
            : 'UPDATE political_territory SET min_zoom = :min_zoom, max_zoom = :max_zoom WHERE public_id = :public_id'
    );
    // Write the geometry band too (the view reads geometry.min_zoom ?? territory.min_zoom) so this can never
    // leave the two diverged -- same invariant as update_zoom / assignment-zoom-sync.
    $geometryStatement = $pdo->prepare(
        'UPDATE political_territory_geometry g
         JOIN political_territory t ON t.id = g.territory_id
         SET g.min_zoom = :min_zoom, g.max_zoom = :max_zoom
         WHERE LOWER(t.public_id) = :public_id AND g.is_active = 1'
    );
    $written = 0;
    foreach ($changes as $change) {
        $parameters = [
            ':min_zoom' => $change['min_zoom'],
            ':max_zoom' => $change['max_zoom'],
            ':public_id' => $change['public_id'],
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = (int) ($user['id'] ?? 0);
        }
        $statement->execute($parameters);
        $written += $statement->rowCount();
        $geometryStatement->execute([
            ':min_zoom' => $change['min_zoom'],
            ':max_zoom' => $change['max_zoom'],
            ':public_id' => strtolower((string) $change['public_id']),
        ]);
    }

    return ['ok' => true, 'dry_run' => false, 'planned_changes' => count($changes), 'written' => $written, 'changes' => $changes];
}

function avesmapsPoliticalSubtreeDisplayReadOptionalYear(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }
    $year = filter_var($value, FILTER_VALIDATE_INT);
    if ($year === false) {
        throw new InvalidArgumentException('Das Jahr ist ungueltig.');
    }
    return (int) $year;
}

function avesmapsPoliticalSubtreeDisplayUpdateValidity(PDO $pdo, array $payload, array $user): array {
    $updates = avesmapsPoliticalSubtreeDisplayReadUpdates($payload['updates'] ?? null);
    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET valid_from_bf = :valid_from_bf,
            valid_to_bf = :valid_to_bf
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $validFrom = avesmapsPoliticalSubtreeDisplayReadOptionalYear($update['valid_from_bf'] ?? $update['startYear'] ?? null);
        $existsUntilToday = filter_var($update['exists_until_today'] ?? $update['existsUntilToday'] ?? false, FILTER_VALIDATE_BOOL);
        $validTo = $existsUntilToday
            ? null
            : avesmapsPoliticalSubtreeDisplayReadOptionalYear($update['valid_to_bf'] ?? $update['endYear'] ?? null);
        $publicId = avesmapsPoliticalSubtreeDisplayResolveTerritoryPublicId($pdo, $update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $parameters = [
            ':valid_from_bf' => $validFrom,
            ':valid_to_bf' => $validTo,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = (int) ($user['id'] ?? 0);
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
    }

    return [
        'ok' => true,
        'changed' => $changed,
        'received' => count($updates),
    ];
}

function avesmapsPoliticalSubtreeDisplayInheritColors(PDO $pdo, array $payload, array $user): array {
    $rootColor = avesmapsPoliticalSubtreeDisplayReadColor($payload['color'] ?? '');
    $hueVarianceRange = avesmapsPoliticalSubtreeDisplayReadHueVarianceRange($payload);
    $hierarchy = avesmapsPoliticalSubtreeDisplayLoadHierarchy($pdo);
    $rootPublicId = trim((string) ($payload['root_territory_public_id'] ?? ''));
    $rootTerritoryId = avesmapsPoliticalSubtreeDisplayReadOptionalTerritoryId($payload['root_territory_id'] ?? null);
    $root = null;

    if ($rootPublicId !== '') {
        $root = $hierarchy['rowsByPublicId'][$rootPublicId] ?? null;
    } elseif ($rootTerritoryId !== null) {
        $root = $hierarchy['rowsById'][$rootTerritoryId] ?? null;
    }

    if (!is_array($root)) {
        throw new InvalidArgumentException('Das ausgewaehlte Wurzelgebiet wurde nicht gefunden.');
    }

    $updatesByPublicId = avesmapsPoliticalSubtreeDisplayBuildColorInheritanceUpdates(
        $hierarchy['childrenByParentId'],
        (int) $root['id'],
        $rootColor,
        $hueVarianceRange
    );
    $descendantsCount = count($updatesByPublicId);

    $normalizedRootPublicId = trim((string) ($root['public_id'] ?? ''));
    if ($normalizedRootPublicId !== '') {
        $updatesByPublicId[$normalizedRootPublicId] = $rootColor;
    }

    if ($updatesByPublicId === []) {
        return [
            'ok' => true,
            'descendants_count' => 0,
            'global_changed' => 0,
            'local_geometry_changed' => 0,
            'local_display_changed' => 0,
            'updates' => [],
        ];
    }

    $userId = (int) ($user['id'] ?? 0);
    $pdo->beginTransaction();
    try {
        $globalChanged = avesmapsPoliticalSubtreeDisplayApplyGlobalColorUpdates($pdo, $updatesByPublicId, $userId);
        [$localGeometryChanged, $localDisplayChanged] = avesmapsPoliticalSubtreeDisplayApplyLocalAssignmentDisplayOverrides(
            $pdo,
            $updatesByPublicId,
            null,
            $userId
        );
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    return [
        'ok' => true,
        'descendants_count' => $descendantsCount,
        'global_changed' => $globalChanged,
        'local_geometry_changed' => $localGeometryChanged,
        'local_display_changed' => $localDisplayChanged,
        'updates' => avesmapsPoliticalSubtreeDisplayColorUpdatesForResponse($updatesByPublicId),
    ];
}

function avesmapsPoliticalSubtreeDisplayInheritOpacity(PDO $pdo, array $payload, array $user): array {
    $rootOpacity = avesmapsPoliticalSubtreeDisplayReadOpacity($payload['opacity'] ?? null);
    $hierarchy = avesmapsPoliticalSubtreeDisplayLoadHierarchy($pdo);
    $rootPublicId = trim((string) ($payload['root_territory_public_id'] ?? ''));
    $rootTerritoryId = avesmapsPoliticalSubtreeDisplayReadOptionalTerritoryId($payload['root_territory_id'] ?? null);
    $root = null;

    if ($rootPublicId !== '') {
        $root = $hierarchy['rowsByPublicId'][$rootPublicId] ?? null;
    } elseif ($rootTerritoryId !== null) {
        $root = $hierarchy['rowsById'][$rootTerritoryId] ?? null;
    }

    if (!is_array($root)) {
        throw new InvalidArgumentException('Das ausgewaehlte Wurzelgebiet wurde nicht gefunden.');
    }

    $updatesByPublicId = avesmapsPoliticalSubtreeDisplayBuildOpacityInheritanceUpdates(
        $hierarchy['childrenByParentId'],
        (int) $root['id'],
        $rootOpacity
    );
    $descendantsCount = count($updatesByPublicId);

    $normalizedRootPublicId = trim((string) ($root['public_id'] ?? ''));
    if ($normalizedRootPublicId !== '') {
        $updatesByPublicId[$normalizedRootPublicId] = $rootOpacity;
    }

    if ($updatesByPublicId === []) {
        return [
            'ok' => true,
            'descendants_count' => 0,
            'global_changed' => 0,
            'local_geometry_changed' => 0,
            'local_display_changed' => 0,
            'updates' => [],
        ];
    }

    $userId = (int) ($user['id'] ?? 0);
    $pdo->beginTransaction();
    try {
        $globalChanged = avesmapsPoliticalSubtreeDisplayApplyGlobalOpacityUpdates($pdo, $updatesByPublicId, $userId);
        [$localGeometryChanged, $localDisplayChanged] = avesmapsPoliticalSubtreeDisplayApplyLocalAssignmentDisplayOverrides(
            $pdo,
            null,
            $updatesByPublicId,
            $userId
        );
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    return [
        'ok' => true,
        'descendants_count' => $descendantsCount,
        'global_changed' => $globalChanged,
        'local_geometry_changed' => $localGeometryChanged,
        'local_display_changed' => $localDisplayChanged,
        'updates' => avesmapsPoliticalSubtreeDisplayOpacityUpdatesForResponse($updatesByPublicId),
    ];
}

function avesmapsPoliticalSubtreeDisplayColorUpdatesForResponse(array $updatesByPublicId): array {
    $updates = [];
    foreach ($updatesByPublicId as $publicId => $color) {
        $updates[] = [
            'territoryPublicId' => (string) $publicId,
            'color' => (string) $color,
        ];
    }
    return $updates;
}

function avesmapsPoliticalSubtreeDisplayOpacityUpdatesForResponse(array $updatesByPublicId): array {
    $updates = [];
    foreach ($updatesByPublicId as $publicId => $opacity) {
        $updates[] = [
            'territoryPublicId' => (string) $publicId,
            'opacity' => (float) $opacity,
        ];
    }
    return $updates;
}

function avesmapsPoliticalSubtreeDisplayLoadHierarchy(PDO $pdo): array {
    $rows = $pdo->query(
        'SELECT id, public_id, parent_id
        FROM political_territory
        WHERE is_active = 1
        ORDER BY id ASC'
    )->fetchAll(PDO::FETCH_ASSOC);

    $rowsByPublicId = [];
    $rowsById = [];
    $childrenByParentId = [];

    foreach ($rows as $row) {
        $rowId = (int) ($row['id'] ?? 0);
        if ($rowId < 1) {
            continue;
        }

        $publicId = trim((string) ($row['public_id'] ?? ''));
        $parentId = is_numeric($row['parent_id'] ?? null) ? (int) $row['parent_id'] : 0;

        $normalizedRow = [
            'id' => $rowId,
            'public_id' => $publicId,
            'parent_id' => $parentId,
        ];

        $rowsById[$rowId] = $normalizedRow;

        if ($publicId !== '') {
            $rowsByPublicId[$publicId] = $normalizedRow;
        }

        if (!isset($childrenByParentId[$parentId])) {
            $childrenByParentId[$parentId] = [];
        }
        $childrenByParentId[$parentId][] = $normalizedRow;
    }

    return [
        'rowsByPublicId' => $rowsByPublicId,
        'rowsById' => $rowsById,
        'childrenByParentId' => $childrenByParentId,
    ];
}

function avesmapsPoliticalSubtreeDisplayBuildColorInheritanceUpdates(
    array $childrenByParentId,
    int $rootId,
    string $rootColor,
    array $hueVarianceRange = []
): array {
    $updatesByPublicId = [];
    $visitedIds = [];
    $stack = [];
    $rootChildren = $childrenByParentId[$rootId] ?? [];
    $rootChildCount = count($rootChildren);

    foreach ($rootChildren as $childIndex => $childRow) {
        $stack[] = [
            'row' => $childRow,
            'parent_color' => $rootColor,
            'depth' => 1,
            'sibling_index' => $childIndex,
            'sibling_count' => $rootChildCount,
        ];
    }

    while ($stack !== []) {
        $current = array_pop($stack);
        $row = $current['row'];
        $rowId = (int) ($row['id'] ?? 0);
        if ($rowId < 1 || isset($visitedIds[$rowId])) {
            continue;
        }
        $visitedIds[$rowId] = true;

        $childColor = avesmapsPoliticalSubtreeDisplayCreateHueVariant(
            (string) ($current['parent_color'] ?? '#888888'),
            (int) ($current['depth'] ?? 1),
            (int) ($current['sibling_index'] ?? 0),
            (int) ($current['sibling_count'] ?? 1),
            $hueVarianceRange
        );
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $updatesByPublicId[$publicId] = $childColor;
        }

        $children = $childrenByParentId[$rowId] ?? [];
        $childCount = count($children);
        foreach ($children as $childIndex => $childRow) {
            $stack[] = [
                'row' => $childRow,
                'parent_color' => $childColor,
                'depth' => ((int) ($current['depth'] ?? 1)) + 1,
                'sibling_index' => $childIndex,
                'sibling_count' => $childCount,
            ];
        }
    }

    return $updatesByPublicId;
}

function avesmapsPoliticalSubtreeDisplayBuildOpacityInheritanceUpdates(array $childrenByParentId, int $rootId, float $rootOpacity): array {
    $updatesByPublicId = [];
    $visitedIds = [];
    $stack = $childrenByParentId[$rootId] ?? [];

    while ($stack !== []) {
        $row = array_pop($stack);
        $rowId = (int) ($row['id'] ?? 0);
        if ($rowId < 1 || isset($visitedIds[$rowId])) {
            continue;
        }
        $visitedIds[$rowId] = true;

        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $updatesByPublicId[$publicId] = $rootOpacity;
        }

        foreach ($childrenByParentId[$rowId] ?? [] as $childRow) {
            $stack[] = $childRow;
        }
    }

    return $updatesByPublicId;
}

function avesmapsPoliticalSubtreeDisplayApplyGlobalColorUpdates(PDO $pdo, array $updatesByPublicId, int $updatedBy): int {
    if ($updatesByPublicId === []) {
        return 0;
    }

    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET color = :color,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET color = :color
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updatesByPublicId as $publicId => $color) {
        $parameters = [
            ':color' => $color,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = $updatedBy;
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
    }

    return $changed;
}

function avesmapsPoliticalSubtreeDisplayApplyGlobalOpacityUpdates(PDO $pdo, array $updatesByPublicId, int $updatedBy): int {
    if ($updatesByPublicId === []) {
        return 0;
    }

    $supportsUpdatedBy = avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn($pdo);
    $statement = $pdo->prepare(
        $supportsUpdatedBy
            ? 'UPDATE political_territory
        SET opacity = :opacity,
            updated_by = :updated_by
        WHERE public_id = :public_id'
            : 'UPDATE political_territory
        SET opacity = :opacity
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updatesByPublicId as $publicId => $opacity) {
        $parameters = [
            ':opacity' => $opacity,
            ':public_id' => $publicId,
        ];
        if ($supportsUpdatedBy) {
            $parameters[':updated_by'] = $updatedBy;
        }
        $statement->execute($parameters);
        $changed += $statement->rowCount();
    }

    return $changed;
}

function avesmapsPoliticalSubtreeDisplayApplyLocalAssignmentDisplayOverrides(PDO $pdo, ?array $colorsByPublicId, ?array $opacityByPublicId, int $updatedBy): array {
    $colorsByPublicId = is_array($colorsByPublicId) ? $colorsByPublicId : [];
    $opacityByPublicId = is_array($opacityByPublicId) ? $opacityByPublicId : [];

    if ($colorsByPublicId === [] && $opacityByPublicId === []) {
        return [0, 0];
    }

    $selectStatement = $pdo->query(
        'SELECT id, style_json
        FROM political_territory_geometry
        WHERE is_active = 1'
    );

    $updateStatement = $pdo->prepare(
        'UPDATE political_territory_geometry
        SET style_json = :style_json,
            updated_by = :updated_by
        WHERE id = :id'
    );

    $localGeometryChanged = 0;
    $localDisplayChanged = 0;

    foreach ($selectStatement->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
        $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
        $displays = null;

        if (is_array($style['assignmentDisplays'] ?? null)) {
            $displays = $style['assignmentDisplays'];
        } elseif (is_array($style['assignment_displays'] ?? null)) {
            $displays = $style['assignment_displays'];
        }

        if (!is_array($displays) || $displays === []) {
            continue;
        }

        $geometryChanged = false;

        foreach ($displays as $index => $display) {
            if (!is_array($display)) {
                continue;
            }

            $territoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
            if ($territoryPublicId === '') {
                continue;
            }

            $displayChanged = false;

            if (isset($colorsByPublicId[$territoryPublicId])) {
                $newColor = (string) $colorsByPublicId[$territoryPublicId];
                $oldColor = trim((string) ($display['color'] ?? ''));
                if ($oldColor !== $newColor) {
                    $display['color'] = $newColor;
                    $displayChanged = true;
                }
            }

            if (isset($opacityByPublicId[$territoryPublicId])) {
                $newOpacity = (float) $opacityByPublicId[$territoryPublicId];
                $oldOpacity = is_numeric($display['opacity'] ?? null)
                    ? round((float) $display['opacity'], 3)
                    : null;
                if ($oldOpacity === null || abs($oldOpacity - $newOpacity) > 0.0005) {
                    $display['opacity'] = $newOpacity;
                    $displayChanged = true;
                }
            }

            if ($displayChanged) {
                $displays[$index] = $display;
                $localDisplayChanged++;
                $geometryChanged = true;
            }
        }

        if (!$geometryChanged) {
            continue;
        }

        $style['assignmentDisplays'] = array_values($displays);
        unset($style['assignment_displays']);

        $updateStatement->execute([
            ':style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
            ':updated_by' => $updatedBy,
            ':id' => (int) $geometry['id'],
        ]);

        $localGeometryChanged++;
    }

    return [$localGeometryChanged, $localDisplayChanged];
}

function avesmapsPoliticalSubtreeDisplayCreateHueVariant(
    string $parentColor,
    int $depth = 1,
    int $siblingIndex = 0,
    int $siblingCount = 1,
    array $hueVarianceRange = []
): string {
    $rgb = avesmapsPoliticalSubtreeDisplayParseHexColorToRgb($parentColor);
    if ($rgb === null) {
        return '#888888';
    }

    $hsv = avesmapsPoliticalSubtreeDisplayRgbToHsv($rgb['red'], $rgb['green'], $rgb['blue']);
    $depthLevel = max(1, $depth);
    $safeSiblingCount = max(1, $siblingCount);
    $safeSiblingIndex = max(0, min($safeSiblingCount - 1, $siblingIndex));

    $depthFactor = 1.0 / (1.0 + (($depthLevel - 1) * 0.45));
    $baseSpan = 14.0 * $depthFactor;
    $densityBoost = min(12.0, max(0, $safeSiblingCount - 1) * 0.55);
    $hueSpan = min(24.0, $baseSpan + ($densityBoost * $depthFactor));
    $minVariance256 = max(0.0, (float) ($hueVarianceRange['min256'] ?? 10.0));
    $maxVariance256 = max($minVariance256, (float) ($hueVarianceRange['max256'] ?? 20.0));
    $minDegrees = ($minVariance256 / 256.0) * 360.0;
    $maxDegrees = ($maxVariance256 / 256.0) * 360.0;
    $hueSpan = max($minDegrees, min($hueSpan, $maxDegrees));

    $centeredOffset = 0.0;
    if ($safeSiblingCount > 1) {
        $position = $safeSiblingIndex / ($safeSiblingCount - 1);
        $centeredOffset = (($position * 2.0) - 1.0) * $hueSpan;
    }

    $jitterLimit = max(0.75, min(2.5, $hueSpan * 0.18));
    $jitter = ((lcg_value() * 2.0) - 1.0) * $jitterLimit;
    $hueOffset = $centeredOffset + $jitter;
    $newHue = fmod($hsv['hue'] + $hueOffset + 360.0, 360.0);

    return avesmapsPoliticalSubtreeDisplayHsvToHex($newHue, $hsv['saturation'], $hsv['value']);
}

function avesmapsPoliticalSubtreeDisplayParseHexColorToRgb(string $color): ?array {
    $normalized = trim($color);
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $normalized)) {
        return null;
    }

    return [
        'red' => hexdec(substr($normalized, 1, 2)),
        'green' => hexdec(substr($normalized, 3, 2)),
        'blue' => hexdec(substr($normalized, 5, 2)),
    ];
}

function avesmapsPoliticalSubtreeDisplayRgbToHsv(int $red, int $green, int $blue): array {
    $r = max(0.0, min(1.0, $red / 255.0));
    $g = max(0.0, min(1.0, $green / 255.0));
    $b = max(0.0, min(1.0, $blue / 255.0));

    $max = max($r, $g, $b);
    $min = min($r, $g, $b);
    $delta = $max - $min;

    $hue = 0.0;
    if ($delta > 0.0) {
        if ($max === $r) {
            $hue = fmod((($g - $b) / $delta), 6.0);
        } elseif ($max === $g) {
            $hue = (($b - $r) / $delta) + 2.0;
        } else {
            $hue = (($r - $g) / $delta) + 4.0;
        }
        $hue *= 60.0;
        if ($hue < 0.0) {
            $hue += 360.0;
        }
    }

    $saturation = $max <= 0.0 ? 0.0 : $delta / $max;

    return [
        'hue' => $hue,
        'saturation' => $saturation,
        'value' => $max,
    ];
}

function avesmapsPoliticalSubtreeDisplayHsvToHex(float $hue, float $saturation, float $value): string {
    $s = max(0.0, min(1.0, $saturation));
    $v = max(0.0, min(1.0, $value));
    $h = fmod($hue + 360.0, 360.0);

    $chroma = $v * $s;
    $huePrime = $h / 60.0;
    $secondary = $chroma * (1.0 - abs(fmod($huePrime, 2.0) - 1.0));
    $match = $v - $chroma;

    if ($huePrime < 1.0) {
        [$r, $g, $b] = [$chroma, $secondary, 0.0];
    } elseif ($huePrime < 2.0) {
        [$r, $g, $b] = [$secondary, $chroma, 0.0];
    } elseif ($huePrime < 3.0) {
        [$r, $g, $b] = [0.0, $chroma, $secondary];
    } elseif ($huePrime < 4.0) {
        [$r, $g, $b] = [0.0, $secondary, $chroma];
    } elseif ($huePrime < 5.0) {
        [$r, $g, $b] = [$secondary, 0.0, $chroma];
    } else {
        [$r, $g, $b] = [$chroma, 0.0, $secondary];
    }

    $red = (int) round(($r + $match) * 255.0);
    $green = (int) round(($g + $match) * 255.0);
    $blue = (int) round(($b + $match) * 255.0);

    return sprintf('#%02x%02x%02x', max(0, min(255, $red)), max(0, min(255, $green)), max(0, min(255, $blue)));
}

function avesmapsPoliticalSubtreeDisplayReadHueVarianceRange(array $payload): array {
    $min256 = avesmapsPoliticalSubtreeDisplayReadOptionalHueVariance256($payload['hue_variance_min_256'] ?? null);
    $max256 = avesmapsPoliticalSubtreeDisplayReadOptionalHueVariance256($payload['hue_variance_max_256'] ?? null);
    $normalizedMin = $min256 ?? 10.0;
    $normalizedMax = $max256 ?? 20.0;

    if ($normalizedMin > $normalizedMax) {
        [$normalizedMin, $normalizedMax] = [$normalizedMax, $normalizedMin];
    }

    return [
        'min256' => $normalizedMin,
        'max256' => $normalizedMax,
    ];
}

function avesmapsPoliticalSubtreeDisplayReadOptionalHueVariance256(mixed $value): ?float {
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        throw new InvalidArgumentException('Die HSV-Abweichung ist ungueltig.');
    }

    $numericValue = (float) $value;
    if (!is_finite($numericValue) || $numericValue < 0.0 || $numericValue > 256.0) {
        throw new InvalidArgumentException('Die HSV-Abweichung liegt ausserhalb des erlaubten Bereichs (0-256).');
    }

    return round($numericValue, 3);
}

function avesmapsPoliticalSubtreeDisplayReadUpdates(mixed $rawUpdates): array {
    if (!is_array($rawUpdates)) {
        throw new InvalidArgumentException('Es wurden keine Subtree-Aktualisierungen uebergeben.');
    }

    $updates = [];
    foreach ($rawUpdates as $update) {
        if (!is_array($update)) {
            continue;
        }

        $publicId = trim((string) ($update['territory_public_id'] ?? $update['territoryPublicId'] ?? ''));
        if ($publicId === '') {
            continue;
        }

        $updates[] = $update;
    }

    if ($updates === []) {
        throw new InvalidArgumentException('Es wurden keine gueltigen Subtree-Aktualisierungen uebergeben.');
    }

    if (count($updates) > 500) {
        throw new InvalidArgumentException('Zu viele Subtree-Aktualisierungen in einer Anfrage.');
    }

    return $updates;
}

function avesmapsPoliticalSubtreeDisplayReadPublicId(mixed $value): string {
    $publicId = trim((string) $value);
    if ($publicId === '') {
        throw new InvalidArgumentException('Die Territory-ID ist ungueltig.');
    }

    return $publicId;
}

// Loest eine Update-Ziel-ID auf die echte territory.public_id (UUID) auf. UUIDs werden direkt
// verwendet; ein stabiler wiki:-Key (aus wiki-aventurica, ueberlebt Baum-/DB-Aenderungen) wird
// ueber wiki_key auf die aktuelle Territory-UUID gemappt. So greift z. B. der Wurzelknoten der
// Farbhierarchie, der bewusst per wiki_key statt per fluechtiger UUID adressiert wird.
function avesmapsPoliticalSubtreeDisplayResolveTerritoryPublicId(PDO $pdo, mixed $value): string {
    $raw = avesmapsPoliticalSubtreeDisplayReadPublicId($value);
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $raw) === 1) {
        return strtolower($raw);
    }

    $wikiKey = $raw;
    if (stripos($wikiKey, 'wiki:') === 0) {
        $wikiKey = substr($wikiKey, 5);
    }
    $wikiKey = trim($wikiKey);
    if ($wikiKey !== '') {
        // A wiki-key shared by MULTIPLE active territories is AMBIGUOUS: picking the oldest (ORDER BY id)
        // could land the write on a DIFFERENT realm than the editor intended -- the subtree caller (e.g. the
        // "reset super-/sub-regions to default zoom" checkbox) must ONLY ever touch its own realm. Fetch two
        // and resolve ONLY when the key is unique; otherwise fall through to the raw value (which matches no
        // row -> no write) instead of corrupting a foreign territory. UUIDs (handled above) and unique keys
        // are unaffected.
        $statement = $pdo->prepare(
            'SELECT territory.public_id
            FROM political_territory territory
            INNER JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
            WHERE territory.is_active = 1 AND wiki.wiki_key = :wiki_key
            ORDER BY territory.id ASC
            LIMIT 2'
        );
        $statement->execute([':wiki_key' => $wikiKey]);
        $matches = $statement->fetchAll(PDO::FETCH_COLUMN, 0);
        if (count($matches) === 1) {
            $resolved = trim((string) $matches[0]);
            if ($resolved !== '') {
                return $resolved;
            }
        }
    }

    // Fallback: raw value back (likely matches nothing -> no write; same as before, no regression).
    return $raw;
}

function avesmapsPoliticalSubtreeDisplayReadOptionalTerritoryId(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        throw new InvalidArgumentException('Die Territory-ID ist ungueltig.');
    }

    $territoryId = (int) $value;
    if ($territoryId < 1) {
        throw new InvalidArgumentException('Die Territory-ID ist ungueltig.');
    }

    return $territoryId;
}

function avesmapsPoliticalSubtreeDisplayHasTerritoryUpdatedByColumn(PDO $pdo): bool {
    static $hasUpdatedByColumn = null;
    if ($hasUpdatedByColumn !== null) {
        return $hasUpdatedByColumn;
    }

    $row = $pdo->query("SHOW COLUMNS FROM political_territory LIKE 'updated_by'")->fetch(PDO::FETCH_ASSOC);
    $hasUpdatedByColumn = is_array($row);
    return $hasUpdatedByColumn;
}

function avesmapsPoliticalSubtreeDisplayReadColor(mixed $value): string {
    $color = trim((string) $value);
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
        throw new InvalidArgumentException('Eine uebergebene Farbe ist ungueltig.');
    }

    return mb_strtolower($color);
}

function avesmapsPoliticalSubtreeDisplayReadOpacity(mixed $value): float {
    if (!is_numeric($value)) {
        throw new InvalidArgumentException('Eine uebergebene Transparenz ist ungueltig.');
    }

    $opacity = (float) $value;
    if ($opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Eine uebergebene Transparenz liegt ausserhalb des erlaubten Bereichs.');
    }

    return round($opacity, 3);
}
