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
