<?php

declare(strict_types=1);

require __DIR__ . '/../api/bootstrap.php';
require_once __DIR__ . '/../api/political-territory-lib.php';

$arguments = avesmapsParseCommandLineArguments($argv  []);

if ($arguments['help']) {
    echo "Avesmaps political breadcrumb default zoom migration\n";
    echo "\n";
    echo "Usage:\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --apply\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --geometry-public-id=<uuid> --apply\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --geometry-public-id=<uuid> --diagnose\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --3layer 0-1 2-2 3-6 --apply\n";
    echo "\n";
    echo "Options:\n";
    echo "  --apply                 Write changes. Without this option the script runs as dry-run.\n";
    echo "  --diagnose              Print geometry, territory and assignment zoom details without writing.\n";
    echo "  --limit=<n>             Process at most n matching geometries. Useful for testing.\n";
    echo "  --geometry-public-id    Process only one geometry.\n";
    echo "  --1layer ... --Nlayer   Override zoom ranges for an exact breadcrumb depth.\n";
    echo "                         Example: --3layer 0-1 2-2 3-6\n";
    echo "                         En dash is also accepted: --3layer 0–1 2–2 3–6\n";
    echo "  --help                  Show this help.\n";
    exit(0);
}

$apply = $arguments['apply'];
$diagnose = $arguments['diagnose'];
$limit = $arguments['limit'];
$geometryPublicId = $arguments['geometryPublicId'];
$zoomRules = $arguments['zoomRules'];

$config = avesmapsLoadApiConfig(__DIR__ . '/../api');
$pdo = avesmapsCreatePdo($config['database']  []);
avesmapsPoliticalEnsureTables($pdo);

$territoryCache = [];

if ($diagnose) {
    if ($geometryPublicId === '') {
        throw new InvalidArgumentException('--diagnose braucht --geometry-public-id=<uuid>.');
    }
    avesmapsDiagnoseGeometryBreadcrumbZooms($pdo, $geometryPublicId, $zoomRules, $territoryCache);
    exit(0);
}

$geometries = avesmapsFetchActivePoliticalGeometries($pdo, $geometryPublicId, $limit);
$updateStatement = $pdo->prepare(
    'UPDATE political_territory_geometry
    SET style_json = :style_json
    WHERE id = :id'
);
$updateTerritoryStatement = $pdo->prepare(
    'UPDATE political_territory
    SET min_zoom = :min_zoom,
        max_zoom = :max_zoom
    WHERE id = :id'
);

$scannedGeometries = 0;
$changedGeometries = 0;
$changedDisplays = 0;
$createdAssignmentDisplays = 0;
$changedGlobalTerritories = 0;
$skippedWithoutTerritory = 0;
$skippedWithoutChain = 0;
$examples = [];
$territoryExamples = [];
$skippedExamples = [];
$processedTerritoryIds = [];

foreach ($geometries as $geometry) {
    $scannedGeometries++;
    $style = avesmapsDecodePoliticalStyleJson($geometry['style_json']  null);
    $displays = $style['assignmentDisplays']  $style['assignment_displays']  null;
    $hadAssignmentDisplays = is_array($displays) && count($displays) > 0;
    $territoryId = avesmapsNullableInt($geometry['territory_id']  null);
    $territoryChain = $territoryId === null
         []
        : avesmapsBuildTerritoryChainForGeometry($pdo, $territoryId, $territoryCache);

    if (!$hadAssignmentDisplays) {
        if ($territoryId === null) {
            $skippedWithoutTerritory++;
            avesmapsAddSkippedExample($skippedExamples, $geometry, 'keine territory_id');
            continue;
        }

        if ($territoryChain === []) {
            $skippedWithoutChain++;
            avesmapsAddSkippedExample($skippedExamples, $geometry, 'territory_id verweist auf kein rekonstruierbares political_territory');
            continue;
        }

        $displays = avesmapsBuildAssignmentDisplaysFromTerritoryChain($territoryChain, $zoomRules);
        $createdAssignmentDisplays += count($displays);
    }

    $changedGlobalTerritories += avesmapsApplyGlobalTerritoryBreadcrumbZooms(
        $updateTerritoryStatement,
        $territoryChain,
        $zoomRules,
        $apply,
        $processedTerritoryIds,
        $territoryExamples,
        $territoryCache
    );

    $chainLength = count($displays);
    $geometryChanged = !$hadAssignmentDisplays;
    foreach ($displays as $index => $display) {
        if (!is_array($display)) {
            continue;
        }

        $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
        $oldMin = avesmapsNullableInt($display['zoomMin']  $display['zoom_min']  null);
        $oldMax = avesmapsNullableInt($display['zoomMax']  $display['zoom_max']  null);
        if ($oldMin === $defaultZoom['zoomMin'] && $oldMax === $defaultZoom['zoomMax']) {
            $displays[$index]['zoomMin'] = $defaultZoom['zoomMin'];
            $displays[$index]['zoomMax'] = $defaultZoom['zoomMax'];
            unset($displays[$index]['zoom_min'], $displays[$index]['zoom_max']);
            continue;
        }

        $displays[$index]['zoomMin'] = $defaultZoom['zoomMin'];
        $displays[$index]['zoomMax'] = $defaultZoom['zoomMax'];
        unset($displays[$index]['zoom_min'], $displays[$index]['zoom_max']);
        $geometryChanged = true;
        $changedDisplays++;

        if (count($examples) < 12) {
            $examples[] = sprintf(
                '%s | Ebene %d/%d | %s: %s-%s -> %d-%d%s',
                (string) ($geometry['public_id']  ''),
                $index + 1,
                $chainLength,
                avesmapsDescribeAssignmentDisplay($display),
                $oldMin === null  'null' : (string) $oldMin,
                $oldMax === null  'null' : (string) $oldMax,
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax'],
                $hadAssignmentDisplays  '' : ' | assignmentDisplays neu erzeugt'
            );
        }
    }

    if (!$geometryChanged) {
        continue;
    }

    $changedGeometries++;
    if (!$apply) {
        continue;
    }

    $style['assignmentDisplays'] = array_values($displays);
    unset($style['assignment_displays']);
    $updateStatement->execute([
        'id' => (int) $geometry['id'],
        'style_json' => avesmapsEncodeJsonOrNull($style),
    ]);
}

$mode = $apply  'APPLY' : 'DRY-RUN';
echo "Mode: {$mode}\n";
echo "Scanned active geometries: {$scannedGeometries}\n";
echo "Changed geometries: {$changedGeometries}\n";
echo "Changed breadcrumb displays: {$changedDisplays}\n";
echo "Created breadcrumb displays: {$createdAssignmentDisplays}\n";
echo "Changed global territories: {$changedGlobalTerritories}\n";
echo "Skipped geometries without territory_id: {$skippedWithoutTerritory}\n";
echo "Skipped geometries without reconstructable territory chain: {$skippedWithoutChain}\n";

if ($zoomRules !== []) {
    echo "\nCustom zoom rules:\n";
    foreach ($zoomRules as $chainLength => $ranges) {
        echo '- ' . $chainLength . 'layer: ' . implode(' ', array_map(
            static fn(array $range): string => $range['zoomMin'] . '-' . $range['zoomMax'],
            $ranges
        )) . "\n";
    }
}

if ($examples !== []) {
    echo "\nExamples:\n";
    foreach ($examples as $example) {
        echo "- {$example}\n";
    }
}

if ($territoryExamples !== []) {
    echo "\nGlobal territory examples:\n";
    foreach ($territoryExamples as $example) {
        echo "- {$example}\n";
    }
}

if ($skippedExamples !== []) {
    echo "\nSkipped examples:\n";
    foreach ($skippedExamples as $example) {
        echo "- {$example}\n";
    }
}

if (!$apply) {
    echo "\nNo database rows were changed. Run again with --apply to write the changes.\n";
}

function avesmapsFetchActivePoliticalGeometries(PDO $pdo, string $geometryPublicId, ?int $limit): array {
    $conditions = ['is_active = 1'];
    $params = [];

    if ($geometryPublicId !== '') {
        $conditions[] = 'public_id = :public_id';
        $params['public_id'] = $geometryPublicId;
    }

    $sql = 'SELECT id, public_id, territory_id, style_json
        FROM political_territory_geometry
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY id ASC';
    if ($limit !== null && $limit > 0) {
        $sql .= ' LIMIT ' . $limit;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function avesmapsPoliticalBreadcrumbDefaultZoomRange(int $chainLength, int $index, array $customRules = []): array {
    if (isset($customRules[$chainLength][$index])) {
        return $customRules[$chainLength][$index];
    }

    if ($chainLength <= 1) {
        return ['zoomMin' => 0, 'zoomMax' => 6];
    }

    if ($chainLength === 2) {
        return $index === 0
             ['zoomMin' => 0, 'zoomMax' => 1]
            : ['zoomMin' => 2, 'zoomMax' => 6];
    }

    if ($chainLength === 3) {
        return match ($index) {
            0 => ['zoomMin' => 0, 'zoomMax' => 1],
            1 => ['zoomMin' => 2, 'zoomMax' => 2],
            default => ['zoomMin' => 3, 'zoomMax' => 6],
        };
    }

    if ($chainLength === 4) {
        return match ($index) {
            0 => ['zoomMin' => 0, 'zoomMax' => 1],
            1 => ['zoomMin' => 2, 'zoomMax' => 2],
            2 => ['zoomMin' => 3, 'zoomMax' => 3],
            default => ['zoomMin' => 4, 'zoomMax' => 6],
        };
    }

    if ($chainLength === 5) {
        return match ($index) {
            0 => ['zoomMin' => 0, 'zoomMax' => 1],
            1 => ['zoomMin' => 2, 'zoomMax' => 2],
            2 => ['zoomMin' => 3, 'zoomMax' => 3],
            3 => ['zoomMin' => 4, 'zoomMax' => 4],
            default => ['zoomMin' => 5, 'zoomMax' => 6],
        };
    }

    if ($index === 0) {
        return ['zoomMin' => 0, 'zoomMax' => 1];
    }
    if ($index === 1) {
        return ['zoomMin' => 2, 'zoomMax' => 2];
    }
    if ($index === 2) {
        return ['zoomMin' => 3, 'zoomMax' => 3];
    }
    if ($index === 3) {
        return ['zoomMin' => 4, 'zoomMax' => 4];
    }
    if ($index === 4) {
        return ['zoomMin' => 5, 'zoomMax' => 5];
    }

    return ['zoomMin' => 6, 'zoomMax' => 6];
}

function avesmapsBuildTerritoryChainForGeometry(PDO $pdo, int $territoryId, array &$territoryCache): array {
    $chain = [];
    $seen = [];
    $currentTerritoryId = $territoryId;

    while ($currentTerritoryId > 0 && !isset($seen[$currentTerritoryId])) {
        $seen[$currentTerritoryId] = true;
        $territory = avesmapsFetchTerritoryForBreadcrumb($pdo, $currentTerritoryId, $territoryCache);
        if ($territory === null) {
            break;
        }

        $chain[] = $territory;
        $parentId = avesmapsNullableInt($territory['parent_id']  null);
        if ($parentId === null || $parentId === $currentTerritoryId) {
            break;
        }

        $currentTerritoryId = $parentId;
    }

    return array_reverse($chain);
}

function avesmapsFetchTerritoryForBreadcrumb(PDO $pdo, int $territoryId, array &$territoryCache): ?array {
    if (array_key_exists($territoryId, $territoryCache)) {
        return $territoryCache[$territoryId];
    }

    $statement = $pdo->prepare(
        'SELECT id, public_id, parent_id, name, short_name, type, color, opacity, coat_of_arms_url, valid_from_bf, valid_to_bf, min_zoom, max_zoom
        FROM political_territory
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $territoryId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    $territoryCache[$territoryId] = is_array($row)  $row : null;
    return $territoryCache[$territoryId];
}

function avesmapsApplyGlobalTerritoryBreadcrumbZooms(
    PDOStatement $updateStatement,
    array $territoryChain,
    array $zoomRules,
    bool $apply,
    array &$processedTerritoryIds,
    array &$territoryExamples,
    array &$territoryCache
): int {
    if ($territoryChain === []) {
        return 0;
    }

    $changedTerritories = 0;
    $chainLength = count($territoryChain);
    foreach ($territoryChain as $index => $territory) {
        $territoryId = avesmapsNullableInt($territory['id']  null);
        if ($territoryId === null || isset($processedTerritoryIds[$territoryId])) {
            continue;
        }
        $processedTerritoryIds[$territoryId] = true;

        $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
        $oldMin = avesmapsNullableInt($territory['min_zoom']  null);
        $oldMax = avesmapsNullableInt($territory['max_zoom']  null);
        if ($oldMin === $defaultZoom['zoomMin'] && $oldMax === $defaultZoom['zoomMax']) {
            continue;
        }

        $changedTerritories++;
        if (count($territoryExamples) < 12) {
            $territoryExamples[] = sprintf(
                '#%d | Ebene %d/%d | %s (%s): %s-%s -> %d-%d',
                $territoryId,
                $index + 1,
                $chainLength,
                trim((string) ($territory['short_name']  '')) ?: trim((string) ($territory['name']  'Herrschaftsgebiet')),
                (string) ($territory['public_id']  ''),
                $oldMin === null  'null' : (string) $oldMin,
                $oldMax === null  'null' : (string) $oldMax,
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax']
            );
        }

        if (!$apply) {
            continue;
        }

        $updateStatement->execute([
            'id' => $territoryId,
            'min_zoom' => $defaultZoom['zoomMin'],
            'max_zoom' => $defaultZoom['zoomMax'],
        ]);

        if (isset($territoryCache[$territoryId]) && is_array($territoryCache[$territoryId])) {
            $territoryCache[$territoryId]['min_zoom'] = $defaultZoom['zoomMin'];
            $territoryCache[$territoryId]['max_zoom'] = $defaultZoom['zoomMax'];
        }
    }

    return $changedTerritories;
}

function avesmapsBuildAssignmentDisplaysFromTerritoryChain(array $territoryChain, array $zoomRules): array {
    $chainLength = count($territoryChain);
    $path = [];
    $pathKeys = [];
    $displays = [];

    foreach ($territoryChain as $index => $territory) {
        $name = trim((string) ($territory['short_name']  '')) ?: trim((string) ($territory['name']  'Herrschaftsgebiet'));
        $publicId = trim((string) ($territory['public_id']  ''));
        $zoomRange = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
        $path[] = $name;
        $pathKeys[] = $publicId;

        $displays[] = [
            'nodeId' => $publicId,
            'nodeKey' => $publicId,
            'wikiKey' => $publicId,
            'rowId' => null,
            'territoryPublicId' => $publicId,
            'territoryId' => avesmapsNullableInt($territory['id']  null),
            'name' => $name,
            'displayName' => $name,
            'coatOfArmsUrl' => trim((string) ($territory['coat_of_arms_url']  '')),
            'zoomMin' => $zoomRange['zoomMin'],
            'zoomMax' => $zoomRange['zoomMax'],
            'color' => trim((string) ($territory['color']  '#888888')) ?: '#888888',
            'opacity' => avesmapsReadOpacity($territory['opacity']  null),
            'startYear' => avesmapsNullableInt($territory['valid_from_bf']  null),
            'endYear' => avesmapsNullableInt($territory['valid_to_bf']  null),
            'existsUntilToday' => avesmapsNullableInt($territory['valid_to_bf']  null) === null,
            'depth' => $index,
            'path' => $path,
            'pathKeys' => $pathKeys,
            'kind' => trim((string) ($territory['type']  'Herrschaftsgebiet')) ?: 'Herrschaftsgebiet',
        ];
    }

    return $displays;
}

function avesmapsReadOpacity(mixed $value): float {
    if ($value === null || $value === '') {
        return 0.33;
    }

    $number = (float) $value;
    if (!is_finite($number)) {
        return 0.33;
    }

    return max(0.0, min(1.0, $number));
}

function avesmapsDiagnoseGeometryBreadcrumbZooms(PDO $pdo, string $geometryPublicId, array $zoomRules, array &$territoryCache): void {
    $statement = $pdo->prepare(
        'SELECT g.id, g.public_id, g.territory_id, g.min_zoom AS geometry_min_zoom, g.max_zoom AS geometry_max_zoom, g.style_json, g.is_active,
            t.id AS territory_row_id, t.public_id AS territory_public_id, t.name AS territory_name, t.parent_id AS territory_parent_id,
            t.min_zoom AS territory_min_zoom, t.max_zoom AS territory_max_zoom, t.is_active AS territory_is_active
        FROM political_territory_geometry g
        LEFT JOIN political_territory t ON t.id = g.territory_id
        WHERE g.public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $geometryPublicId]);
    $geometry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($geometry)) {
        echo "No geometry found for public_id={$geometryPublicId}\n";
        return;
    }

    $style = avesmapsDecodePoliticalStyleJson($geometry['style_json']  null);
    $displays = $style['assignmentDisplays']  $style['assignment_displays']  null;
    $hasDisplays = is_array($displays) && count($displays) > 0;
    $territoryId = avesmapsNullableInt($geometry['territory_id']  null);
    $chain = $territoryId === null  [] : avesmapsBuildTerritoryChainForGeometry($pdo, $territoryId, $territoryCache);

    echo "Diagnosis\n";
    echo "Geometry: #" . (string) $geometry['id'] . " / " . (string) $geometry['public_id'] . "\n";
    echo "Geometry active: " . (string) $geometry['is_active'] . "\n";
    echo "Geometry territory_id: " . avesmapsFormatNullableValue($geometry['territory_id']  null) . "\n";
    echo "Geometry min_zoom/max_zoom: " . avesmapsFormatZoomPair($geometry['geometry_min_zoom']  null, $geometry['geometry_max_zoom']  null) . "\n";
    echo "Territory row: #" . avesmapsFormatNullableValue($geometry['territory_row_id']  null) . " / " . avesmapsFormatNullableValue($geometry['territory_public_id']  null) . " / " . avesmapsFormatNullableValue($geometry['territory_name']  null) . "\n";
    echo "Territory active: " . avesmapsFormatNullableValue($geometry['territory_is_active']  null) . "\n";
    echo "Territory parent_id: " . avesmapsFormatNullableValue($geometry['territory_parent_id']  null) . "\n";
    echo "Territory min_zoom/max_zoom: " . avesmapsFormatZoomPair($geometry['territory_min_zoom']  null, $geometry['territory_max_zoom']  null) . "\n";
    echo "style_json present: " . (is_string($geometry['style_json']  null) && trim((string) $geometry['style_json']) !== ''  'yes' : 'no') . "\n";
    echo "assignmentDisplays present: " . ($hasDisplays  'yes' : 'no') . "\n";
    echo "assignmentDisplays count: " . ($hasDisplays  count($displays) : 0) . "\n";

    if ($chain !== []) {
        echo "\nReconstructed territory chain:\n";
        $chainLength = count($chain);
        foreach ($chain as $index => $territory) {
            $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
            echo sprintf(
                '- Ebene %d/%d | #%s | %s | %s | territory zoom %s | default %d-%d' . "\n",
                $index + 1,
                $chainLength,
                (string) ($territory['id']  ''),
                (string) ($territory['public_id']  ''),
                trim((string) ($territory['short_name']  '')) ?: trim((string) ($territory['name']  '')),
                avesmapsFormatZoomPair($territory['min_zoom']  null, $territory['max_zoom']  null),
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax']
            );
        }
    } else {
        echo "\nReconstructed territory chain: none\n";
    }

    if ($hasDisplays) {
        echo "\nStored assignmentDisplays:\n";
        $chainLength = count($displays);
        foreach ($displays as $index => $display) {
            if (!is_array($display)) {
                continue;
            }
            $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
            $storedMin = $display['zoomMin']  $display['zoom_min']  null;
            $storedMax = $display['zoomMax']  $display['zoom_max']  null;
            echo sprintf(
                '- Ebene %d/%d | %s | territoryPublicId=%s | stored %s | default %d-%d' . "\n",
                $index + 1,
                $chainLength,
                avesmapsDescribeAssignmentDisplay($display),
                (string) ($display['territoryPublicId']  $display['territory_public_id']  ''),
                avesmapsFormatZoomPair($storedMin, $storedMax),
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax']
            );
        }
    }
}

function avesmapsFormatNullableValue(mixed $value): string {
    if ($value === null || $value === '') {
        return 'null';
    }

    return (string) $value;
}

function avesmapsFormatZoomPair(mixed $min, mixed $max): string {
    return avesmapsFormatNullableValue($min) . '-' . avesmapsFormatNullableValue($max);
}

function avesmapsAddSkippedExample(array &$skippedExamples, array $geometry, string $reason): void {
    if (count($skippedExamples) >= 12) {
        return;
    }

    $skippedExamples[] = sprintf(
        '#%s | %s | territory_id=%s | %s',
        (string) ($geometry['id']  ''),
        (string) ($geometry['public_id']  ''),
        (string) ($geometry['territory_id']  'null'),
        $reason
    );
}

function avesmapsParseCommandLineArguments(array $argv): array {
    $arguments = [
        'apply' => false,
        'diagnose' => false,
        'help' => false,
        'limit' => null,
        'geometryPublicId' => '',
        'zoomRules' => [],
    ];
    $tokens = array_slice($argv, 1);
    $count = count($tokens);

    for ($index = 0; $index < $count; $index++) {
        $token = (string) $tokens[$index];
        if ($token === '--apply') {
            $arguments['apply'] = true;
            continue;
        }
        if ($token === '--diagnose') {
            $arguments['diagnose'] = true;
            continue;
        }
        if ($token === '--help' || $token === '-h') {
            $arguments['help'] = true;
            continue;
        }
        if (str_starts_with($token, '--limit=')) {
            $arguments['limit'] = max(0, (int) substr($token, strlen('--limit=')));
            continue;
        }
        if ($token === '--limit') {
            $value = avesmapsReadNextCliValue($tokens, $index, '--limit');
            $arguments['limit'] = max(0, (int) $value);
            continue;
        }
        if (str_starts_with($token, '--geometry-public-id=')) {
            $arguments['geometryPublicId'] = trim(substr($token, strlen('--geometry-public-id=')));
            continue;
        }
        if ($token === '--geometry-public-id') {
            $arguments['geometryPublicId'] = trim(avesmapsReadNextCliValue($tokens, $index, '--geometry-public-id'));
            continue;
        }
        if (preg_match('/^--([1-9][0-9]*)layer(?:=(.*))?$/', $token, $matches) === 1) {
            $layerCount = (int) $matches[1];
            $rangeTokens = [];
            if (isset($matches[2]) && trim((string) $matches[2]) !== '') {
                $rangeTokens = preg_split('/\s+/', trim((string) $matches[2])) ?: [];
            }

            while ($index + 1 < $count && !str_starts_with((string) $tokens[$index + 1], '--')) {
                $index++;
                $rangeTokens[] = (string) $tokens[$index];
            }

            $arguments['zoomRules'][$layerCount] = avesmapsParseLayerZoomRanges($layerCount, $rangeTokens);
            continue;
        }

        throw new InvalidArgumentException("Unbekannter Parameter: {$token}");
    }

    ksort($arguments['zoomRules']);
    return $arguments;
}

function avesmapsReadNextCliValue(array $tokens, int &$index, string $optionName): string {
    if (!isset($tokens[$index + 1]) || str_starts_with((string) $tokens[$index + 1], '--')) {
        throw new InvalidArgumentException("{$optionName} braucht einen Wert.");
    }

    $index++;
    return (string) $tokens[$index];
}

function avesmapsParseLayerZoomRanges(int $layerCount, array $rangeTokens): array {
    if ($rangeTokens === []) {
        throw new InvalidArgumentException("--{$layerCount}layer braucht {$layerCount} Zoom-Bereiche.");
    }
    if (count($rangeTokens) !== $layerCount) {
        throw new InvalidArgumentException("--{$layerCount}layer erwartet {$layerCount} Zoom-Bereiche, bekommen: " . count($rangeTokens));
    }

    $ranges = [];
    foreach ($rangeTokens as $rangeToken) {
        $ranges[] = avesmapsParseZoomRangeToken((string) $rangeToken);
    }

    return $ranges;
}

function avesmapsParseZoomRangeToken(string $rangeToken): array {
    $normalized = str_replace(["\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}", "\u{2212}"], '-', trim($rangeToken));
    if (preg_match('/^(\d+)\s*-\s*(\d+)$/', $normalized, $matches) !== 1) {
        throw new InvalidArgumentException("Ungueltiger Zoom-Bereich: {$rangeToken}. Erwartet wird z.B. 0-1.");
    }

    $zoomMin = (int) $matches[1];
    $zoomMax = (int) $matches[2];
    if ($zoomMin < 0 || $zoomMax > 6 || $zoomMin > $zoomMax) {
        throw new InvalidArgumentException("Ungueltiger Zoom-Bereich: {$rangeToken}. Erlaubt sind Werte von 0 bis 6 und min <= max.");
    }

    return ['zoomMin' => $zoomMin, 'zoomMax' => $zoomMax];
}

function avesmapsDecodePoliticalStyleJson(mixed $value): array {
    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    try {
        $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decoded)  $decoded : [];
}

function avesmapsEncodeJsonOrNull(array $value): ?string {
    if ($value === []) {
        return null;
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsNullableInt(mixed $value): ?int {
    if ($value === '' || $value === null || !isset($value)) {
        return null;
    }

    $number = filter_var($value, FILTER_VALIDATE_INT);
    return $number === false  null : (int) $number;
}

function avesmapsDescribeAssignmentDisplay(array $display): string {
    $name = trim((string) ($display['displayName']  $display['name']  $display['originalName']  ''));
    $publicId = trim((string) ($display['territoryPublicId']  $display['territory_public_id']  ''));
    if ($name !== '' && $publicId !== '') {
        return "{$name} ({$publicId})";
    }
    if ($name !== '') {
        return $name;
    }
    if ($publicId !== '') {
        return $publicId;
    }

    return 'unbekannter Breadcrumb';
}
