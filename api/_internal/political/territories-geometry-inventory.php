<?php

declare(strict_types=1);

/**
 * Read-only Diagnose ("Datenleichen-Scanner"): listet alle aktiven politischen Geometrien
 * mit Territorium, Quelle (source), Bounding-Box-Flaeche und Urheber/Zeitstempel.
 * Nach Flaeche absteigend sortiert, damit ueberdimensionierte/verirrte Geometrien oben stehen.
 * Hinter 'review'-Capability gegated (siehe Endpoint), daher duerfen Nutzernamen enthalten sein.
 */
function avesmapsPoliticalReadGeometryInventory(PDO $pdo, array $query): array
{
    $limit = avesmapsPoliticalReadOptionalInt($query['limit'] ?? null) ?? 500;
    $limit = max(1, min(2000, $limit));
    $includeInactive = avesmapsPoliticalReadBoolean($query['include_inactive'] ?? false);
    // Geometrien (geometry_json) nur auf Wunsch mitliefern (z. B. fuer das Konturen-Overlay im Editor),
    // damit Standard-Aufrufe leicht bleiben.
    $includeLegacyGeometry = avesmapsPoliticalReadBoolean($query['legacy_geometry'] ?? false);

    $activeCondition = $includeInactive ? '1 = 1' : 'g.is_active = 1';

    $statement = $pdo->query(
        'SELECT
            g.public_id,
            g.territory_id,
            g.source,
            g.is_active,
            g.valid_from_bf,
            g.valid_to_bf,
            g.min_zoom,
            g.max_zoom,
            g.min_x, g.min_y, g.max_x, g.max_y,
            g.created_at,
            g.updated_at,
            cu.username AS created_by_username,
            uu.username AS updated_by_username,
            t.name AS territory_name,
            t.type AS territory_type,
            t.public_id AS territory_public_id,
            t.continent AS territory_continent,
            t.is_active AS territory_is_active,
            p.name AS parent_name
        FROM political_territory_geometry g
        LEFT JOIN political_territory t ON t.id = g.territory_id
        LEFT JOIN political_territory p ON p.id = t.parent_id
        LEFT JOIN users cu ON cu.id = g.created_by
        LEFT JOIN users uu ON uu.id = g.updated_by
        WHERE ' . $activeCondition . '
        ORDER BY ((g.max_x - g.min_x) * (g.max_y - g.min_y)) DESC, g.id DESC'
    );

    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    $geometries = [];
    $bySource = [];
    $byCreator = [];
    foreach ($rows as $row) {
        $minX = (float) ($row['min_x'] ?? 0);
        $minY = (float) ($row['min_y'] ?? 0);
        $maxX = (float) ($row['max_x'] ?? 0);
        $maxY = (float) ($row['max_y'] ?? 0);
        $area = round(max(0.0, $maxX - $minX) * max(0.0, $maxY - $minY), 1);

        $source = (string) ($row['source'] ?? '');
        $creator = (string) ($row['created_by_username'] ?? '');
        $bySource[$source !== '' ? $source : '(leer)'] = ($bySource[$source !== '' ? $source : '(leer)'] ?? 0) + 1;
        $creatorKey = $creator !== '' ? $creator : '(unbekannt/vor Audit)';
        $byCreator[$creatorKey] = ($byCreator[$creatorKey] ?? 0) + 1;

        $territoryName = (string) ($row['territory_name'] ?? '');

        $geometries[] = [
            'geometry_public_id' => (string) ($row['public_id'] ?? ''),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            'territory_name' => $territoryName !== '' ? $territoryName : '(KEIN TERRITORIUM)',
            'territory_type' => (string) ($row['territory_type'] ?? ''),
            'territory_is_active' => (int) ($row['territory_is_active'] ?? 0) === 1,
            'territory_continent' => (string) ($row['territory_continent'] ?? ''),
            'parent_name' => (string) ($row['parent_name'] ?? ''),
            'source' => $source,
            'area' => $area,
            'bbox' => [round($minX, 1), round($minY, 1), round($maxX, 1), round($maxY, 1)],
            'is_active' => (int) ($row['is_active'] ?? 0) === 1,
            'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
            'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
            'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
            'valid_to_bf' => avesmapsPoliticalNullableInt($row['valid_to_bf'] ?? null),
            'created_by' => $creator,
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_by' => (string) ($row['updated_by_username'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    arsort($bySource);
    arsort($byCreator);

    // Legacy-Regionen aus map_features (feature_type='region', alter Seed-Import). Das ist die
    // EINZIGE Flaechenquelle ausserhalb des political_territory-Systems (also "nicht thomas/valentin");
    // sie wird im Layer nur als Fallback eingeblendet, wenn ein Territorium keine eigene Geometrie hat.
    $legacyRegions = [];
    if (function_exists('avesmapsPoliticalFetchLegacyRegionFeaturesByExactName')) {
        foreach (avesmapsPoliticalFetchLegacyRegionFeaturesByExactName($pdo) as $legacyRegion) {
            $lMinX = (float) ($legacyRegion['min_x'] ?? 0);
            $lMinY = (float) ($legacyRegion['min_y'] ?? 0);
            $lMaxX = (float) ($legacyRegion['max_x'] ?? 0);
            $lMaxY = (float) ($legacyRegion['max_y'] ?? 0);
            $legacyEntry = [
                'public_id' => (string) ($legacyRegion['public_id'] ?? ''),
                'name' => (string) ($legacyRegion['name'] ?? ''),
                'area' => round(max(0.0, $lMaxX - $lMinX) * max(0.0, $lMaxY - $lMinY), 1),
                'bbox' => [round($lMinX, 1), round($lMinY, 1), round($lMaxX, 1), round($lMaxY, 1)],
            ];
            if ($includeLegacyGeometry) {
                $legacyEntry['geometry'] = avesmapsPoliticalDecodeJson($legacyRegion['geometry_json'] ?? null);
            }
            $legacyRegions[] = $legacyEntry;
        }
        usort($legacyRegions, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);
    }

    return [
        'ok' => true,
        'total' => count($geometries),
        'by_source' => $bySource,
        'by_creator' => $byCreator,
        'geometries' => array_slice($geometries, 0, $limit),
        // Nicht-political Altlasten (map_features). Quelle/Urheber: alter Seed-Import, NICHT thomas/valentin.
        'legacy_region_total' => count($legacyRegions),
        'legacy_regions' => array_slice($legacyRegions, 0, $limit),
    ];
}

/**
 * Tiefe Punkt-Kollision: testet einen GeoJSON-Punkt (x,y) gegen ALLE aktiven Geometrien direkt
 * aus der DB (political_territory_geometry + Legacy map_features-Regionen), OHNE die Layer-Filter
 * (Kontinent/Jahr/Zoom-Band). Findet damit auch Leichen, die der normale Layer nie ausliefert.
 * Rein lesend. Hinter 'review'-Capability (Endpoint), daher mit Urheber/Pfad.
 */
function avesmapsPipRingContains(array $ring, float $px, float $py): bool
{
    $inside = false;
    $n = count($ring);
    if ($n < 3) {
        return false;
    }
    $j = $n - 1;
    for ($i = 0; $i < $n; $i++) {
        $xi = (float) ($ring[$i][0] ?? 0);
        $yi = (float) ($ring[$i][1] ?? 0);
        $xj = (float) ($ring[$j][0] ?? 0);
        $yj = (float) ($ring[$j][1] ?? 0);
        if (($yi > $py) !== ($yj > $py)) {
            $denom = ($yj - $yi);
            if ($denom === 0.0) {
                $denom = 1e-12;
            }
            $xint = ($xj - $xi) * ($py - $yi) / $denom + $xi;
            if ($px < $xint) {
                $inside = !$inside;
            }
        }
        $j = $i;
    }
    return $inside;
}

function avesmapsPipGeometryContains($geo, float $px, float $py): bool
{
    if (!is_array($geo)) {
        return false;
    }
    $type = (string) ($geo['type'] ?? '');
    $coords = $geo['coordinates'] ?? null;
    if (!is_array($coords)) {
        return false;
    }
    $polys = $type === 'Polygon' ? [$coords] : ($type === 'MultiPolygon' ? $coords : []);
    foreach ($polys as $poly) {
        if (!is_array($poly) || !isset($poly[0]) || !is_array($poly[0])) {
            continue;
        }
        if (avesmapsPipRingContains($poly[0], $px, $py)) {
            $inHole = false;
            $rings = count($poly);
            for ($h = 1; $h < $rings; $h++) {
                if (is_array($poly[$h]) && avesmapsPipRingContains($poly[$h], $px, $py)) {
                    $inHole = true;
                    break;
                }
            }
            if (!$inHole) {
                return true;
            }
        }
    }
    return false;
}

function avesmapsPoliticalReadGeometryCollision(PDO $pdo, array $query): array
{
    $px = isset($query['x']) ? (float) $query['x'] : null;
    $py = isset($query['y']) ? (float) $query['y'] : null;
    if ($px === null || $py === null) {
        return ['ok' => false, 'error' => 'x und y (GeoJSON-Koordinaten) erforderlich.'];
    }

    // Territorien fuer Pfad-Aufloesung
    $territories = [];
    foreach ($pdo->query('SELECT id, public_id, name, parent_id, wiki_id, is_active FROM political_territory')->fetchAll(PDO::FETCH_ASSOC) as $t) {
        $territories[(int) $t['id']] = $t;
    }
    $pathOf = static function (?int $tid) use ($territories): string {
        $out = [];
        $seen = [];
        while ($tid !== null && $tid > 0 && isset($territories[$tid]) && !isset($seen[$tid])) {
            $seen[$tid] = true;
            $out[] = (string) ($territories[$tid]['name'] ?? '');
            $tid = (int) ($territories[$tid]['parent_id'] ?? 0) ?: null;
        }
        return implode(' <- ', $out);
    };

    $political = [];
    $stmt = $pdo->query(
        'SELECT g.public_id, g.geometry_geojson, g.source, g.is_active, g.created_at,
                g.territory_id, cu.username AS created_by_username
         FROM political_territory_geometry g
         LEFT JOIN users cu ON cu.id = g.created_by
         WHERE g.is_active = 1'
    );
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geo = avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null);
        if (!avesmapsPipGeometryContains($geo, $px, $py)) {
            continue;
        }
        $tid = (int) ($row['territory_id'] ?? 0) ?: null;
        $terr = $tid !== null ? ($territories[$tid] ?? null) : null;
        $political[] = [
            'geometry_public_id' => (string) ($row['public_id'] ?? ''),
            'territory_public_id' => (string) ($terr['public_id'] ?? ''),
            'territory_name' => (string) ($terr['name'] ?? '(KEIN TERRITORIUM)'),
            'territory_active' => $terr !== null ? ((int) ($terr['is_active'] ?? 0) === 1) : null,
            'has_wiki' => $terr !== null ? !empty($terr['wiki_id']) : null,
            'path' => $pathOf($tid),
            'source' => (string) ($row['source'] ?? ''),
            'created_by' => (string) ($row['created_by_username'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }

    $legacy = [];
    if (function_exists('avesmapsPoliticalFetchLegacyRegionFeaturesByExactName')) {
        foreach (avesmapsPoliticalFetchLegacyRegionFeaturesByExactName($pdo) as $lr) {
            $geo = avesmapsPoliticalDecodeJson($lr['geometry_json'] ?? null);
            if (!avesmapsPipGeometryContains($geo, $px, $py)) {
                continue;
            }
            $legacy[] = [
                'public_id' => (string) ($lr['public_id'] ?? ''),
                'name' => (string) ($lr['name'] ?? ''),
            ];
        }
    }

    return [
        'ok' => true,
        'point' => ['x' => $px, 'y' => $py],
        'political_hits' => $political,
        'legacy_hits' => $legacy,
    ];
}
