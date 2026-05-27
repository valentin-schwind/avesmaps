<?php

declare(strict_types=1);

if (!function_exists('avesmapsPoliticalSyncTerritoryGeometryStyle')) {
    function avesmapsPoliticalSyncTerritoryGeometryStyle(PDO $pdo, int $territoryId, string $color, float $opacity): void {
        if ($territoryId < 1) {
            return;
        }

        $territory = avesmapsPoliticalFetchTerritoryById($pdo, $territoryId);
        $color = avesmapsPoliticalReadHexColor($color);
        $opacity = avesmapsPoliticalReadOpacity($opacity);
        $minZoom = avesmapsPoliticalNullableInt($territory['min_zoom'] ?? null);
        $maxZoom = avesmapsPoliticalNullableInt($territory['max_zoom'] ?? null);

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

        foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
            $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
            $style['fill'] = $color;
            $style['stroke'] = $color;
            $style['fillOpacity'] = $opacity;
            $style = avesmapsPoliticalSyncTerritoryAssignmentDisplayStyle($style, $territory, $color, $opacity, $minZoom, $maxZoom);

            $update->execute([
                'id' => (int) $geometry['id'],
                'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
            ]);
        }
    }
}

if (!function_exists('avesmapsPoliticalClearTerritoryGeometryZoomOverrides')) {
    function avesmapsPoliticalClearTerritoryGeometryZoomOverrides(PDO $pdo, int $territoryId): void {
        if ($territoryId < 1) {
            return;
        }

        $statement = $pdo->prepare(
            'UPDATE political_territory_geometry
            SET min_zoom = NULL,
                max_zoom = NULL
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $statement->execute(['territory_id' => $territoryId]);
    }
}

if (!function_exists('avesmapsPoliticalSyncTerritoryAssignmentDisplayStyle')) {
    function avesmapsPoliticalSyncTerritoryAssignmentDisplayStyle(array $style, array $territory, string $color, float $opacity, ?int $minZoom, ?int $maxZoom): array {
        $displayKey = array_key_exists('assignmentDisplays', $style)
            ? 'assignmentDisplays'
            : (array_key_exists('assignment_displays', $style) ? 'assignment_displays' : 'assignmentDisplays');

        $displays = is_array($style[$displayKey] ?? null) ? array_values($style[$displayKey]) : [];
        if ($displays === []) {
            return $style;
        }

        $territoryPublicId = trim((string) ($territory['public_id'] ?? ''));
        $territorySlug = trim((string) ($territory['slug'] ?? ''));

        foreach ($displays as &$display) {
            if (!is_array($display)) {
                continue;
            }

            $displayTerritoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
            $displayNodeKey = trim((string) ($display['nodeKey'] ?? $display['node_key'] ?? ''));
            $matchesTerritory = $territoryPublicId !== '' && $displayTerritoryPublicId === $territoryPublicId;
            $matchesSlug = $territorySlug !== '' && ($displayNodeKey === $territorySlug || avesmapsPoliticalSlug($displayNodeKey) === $territorySlug);

            if (!$matchesTerritory && !$matchesSlug) {
                continue;
            }

            $display['color'] = $color;
            $display['opacity'] = $opacity;
            $display['zoomMin'] = $minZoom;
            $display['zoomMax'] = $maxZoom;
        }
        unset($display);

        $style[$displayKey] = $displays;

        return $style;
    }
}
