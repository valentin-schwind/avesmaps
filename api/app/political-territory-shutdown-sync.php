<?php

// This file is loaded through api/app/.user.ini.
// It intentionally does not declare or override functions from political-territories.php.
// The political API already saves territory colors and zoom ranges before responding.
// This shutdown sync mirrors those values into stored assignmentDisplays, which otherwise
// keep stale display colors for synthetic territories without Wiki assignments.

$GLOBALS['avesmapsPoliticalShutdownRequestBody'] = file_get_contents('php://input');

register_shutdown_function(static function (): void {
    $payload = avesmapsPoliticalShutdownReadPayload();
    if (!is_array($payload) || (string) ($payload['action'] ?? '') !== 'update_territory') {
        return;
    }

    $territoryPublicId = trim((string) ($payload['territory_public_id'] ?? $payload['public_id'] ?? ''));
    if ($territoryPublicId === '') {
        return;
    }

    if (
        !function_exists('avesmapsApiRoot')
        || !function_exists('avesmapsLoadApiConfig')
        || !function_exists('avesmapsCreatePdo')
        || !function_exists('avesmapsPoliticalFetchTerritoryByPublicId')
        || !function_exists('avesmapsPoliticalDecodeJson')
        || !function_exists('avesmapsPoliticalEncodeJsonOrNull')
    ) {
        return;
    }

    try {
        $config = avesmapsLoadApiConfig(avesmapsApiRoot());
        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $territoryPublicId);
        avesmapsPoliticalShutdownSyncTerritoryDisplays($pdo, $territory);
    } catch (Throwable) {
        // Never break the API response from a best-effort post-response sync.
    }
});

function avesmapsPoliticalShutdownReadPayload(): ?array {
    $raw = $GLOBALS['avesmapsPoliticalShutdownRequestBody'] ?? '';
    if (!is_string($raw) || trim($raw) === '') {
        $raw = file_get_contents('php://input');
    }

    if (!is_string($raw) || trim($raw) === '') {
        return null;
    }

    try {
        $payload = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return null;
    }

    return is_array($payload) ? $payload : null;
}

function avesmapsPoliticalShutdownSyncTerritoryDisplays(PDO $pdo, array $territory): void {
    $territoryId = (int) ($territory['id'] ?? 0);
    if ($territoryId < 1) {
        return;
    }

    $color = (string) ($territory['color'] ?? '#888888');
    $opacity = (float) ($territory['opacity'] ?? 0.33);
    $minZoom = isset($territory['min_zoom']) ? avesmapsPoliticalNullableInt($territory['min_zoom']) : null;
    $maxZoom = isset($territory['max_zoom']) ? avesmapsPoliticalNullableInt($territory['max_zoom']) : null;
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

    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $geometry) {
        $style = avesmapsPoliticalDecodeJson($geometry['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;

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

        $update->execute([
            'id' => (int) ($geometry['id'] ?? 0),
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
        ]);
    }
}
