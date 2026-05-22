<?php

declare(strict_types=1);

require __DIR__ . '/../api/bootstrap.php';
require_once __DIR__ . '/../api/political-territory-lib.php';

$arguments = avesmapsParseCommandLineArguments($argv ?? []);

if ($arguments['help']) {
    echo "Avesmaps political breadcrumb default zoom migration\n";
    echo "\n";
    echo "Usage:\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --apply\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --geometry-public-id=<uuid> --apply\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --3layer 0-1 2-2 3-6 --apply\n";
    echo "\n";
    echo "Options:\n";
    echo "  --apply                 Write changes. Without this option the script runs as dry-run.\n";
    echo "  --limit=<n>             Process at most n matching geometries. Useful for testing.\n";
    echo "  --geometry-public-id    Process only one geometry.\n";
    echo "  --1layer ... --Nlayer   Override zoom ranges for an exact breadcrumb depth.\n";
    echo "                         Example: --3layer 0-1 2-2 3-6\n";
    echo "                         En dash is also accepted: --3layer 0–1 2–2 3–6\n";
    echo "  --help                  Show this help.\n";
    exit(0);
}

$apply = $arguments['apply'];
$limit = $arguments['limit'];
$geometryPublicId = $arguments['geometryPublicId'];
$zoomRules = $arguments['zoomRules'];

$config = avesmapsLoadApiConfig(__DIR__ . '/../api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
avesmapsPoliticalEnsureTables($pdo);

$territoryCache = [];
$geometries = avesmapsFetchActivePoliticalGeometries($pdo, $geometryPublicId, $limit);
$updateStatement = $pdo->prepare(
    'UPDATE political_territory_geometry
    SET style_json = :style_json
    WHERE id = :id'
);

$scannedGeometries = 0;
$changedGeometries = 0;
$changedDisplays = 0;
$createdAssignmentDisplays = 0;
$skippedWithoutTerritory = 0;
$skippedWithoutChain = 0;
$examples = [];
$skippedExamples = [];

foreach ($geometries as $geometry) {
    $scannedGeometries++;
    $style = avesmapsDecodePoliticalStyleJson($geometry['style_json'] ?? null);
    $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? null;
    $hadAssignmentDisplays = is_array($displays) && count($displays) > 0;

    if (!$hadAssignmentDisplays) {
        $territoryId = avesmapsNullableInt($geometry['territory_id'] ?? null);
        if ($territoryId === null) {
            $skippedWithoutTerritory++;
            avesmapsAddSkippedExample($skippedExamples, $geometry, 'keine territory_id');
            continue;
        }

        $territoryChain = avesmapsBuildTerritoryChainForGeometry($pdo, $territoryId, $territoryCache);
        if ($territoryChain === []) {
            $skippedWithoutChain++;
            avesmapsAddSkippedExample($skippedExamples, $geometry, 'territory_id verweist auf kein rekonstruierbares political_territory');
            continue;
        }

        $displays = avesmapsBuildAssignmentDisplaysFromTerritoryChain($territoryChain, $zoomRules);
        $createdAssignmentDisplays += count($displays);
    }

    $chainLength = count($displays);
    $geometryChanged = !$hadAssignmentDisplays;
    foreach ($displays as $index => $display) {
        if (!is_array($display)) {
            continue;
        }

        $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
        $oldMin = avesmapsNullableInt($display['zoomMin'] ?? $display['zoom_min'] ?? null);
        $oldMax = avesmapsNullableInt($display['zoomMax'] ?? $display['zoom_max'] ?? null);
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
                (string) ($geometry['public_id'] ?? ''),
                $index + 1,
                $chainLength,
                avesmapsDescribeAssignmentDisplay($display),
                $oldMin === null ? 'null' : (string) $oldMin,
                $oldMax === null ? 'null' : (string) $oldMax,
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax'],
                $hadAssignmentDisplays ? '' : ' | assignmentDisplays neu erzeugt'
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

$mode = $apply ? 'APPLY' : 'DRY-RUN';
echo "Mode: {$mode}\n";
echo "Scanned active geometries: {$scannedGeometries}\n";
echo "Changed geometries: {$changedGeometries}\n";
echo "Changed breadcrumb displays: {$changedDisplays}\n";
echo "Created breadcrumb displays: {$createdAssignmentDisplays}\n";
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
            ? ['zoomMin' => 0, 'zoomMax' => 1]
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
        $parentId = avesmapsNullableInt($territory['parent_id'] ?? null);
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
        'SELECT id, public_id, parent_id, name, short_name, type, color, opacity, coat_of_arms_url, valid_from_bf, valid_to_bf
        FROM political_territory
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $territoryId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    $territoryCache[$territoryId] = is_array($row) ? $row : null;
    return $territoryCache[$territoryId];
}

function avesmapsBuildAssignmentDisplaysFromTerritoryChain(array $territoryChain, array $zoomRules): array {
    $chainLength = count($territoryChain);
    $path = [];
    $pathKeys = [];
    $displays = [];

    foreach ($territoryChain as $index => $territory) {
        $name = trim((string) ($territory['short_name'] ?? '')) ?: trim((string) ($territory['name'] ?? 'Herrschaftsgebiet'));
        $publicId = trim((string) ($territory['public_id'] ?? ''));
        $zoomRange = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index, $zoomRules);
        $path[] = $name;
        $pathKeys[] = $publicId;

        $displays[] = [
            'nodeId' => $publicId,
            'nodeKey' => $publicId,
            'wikiKey' => $publicId,
            'rowId' => null,
            'territoryPublicId' => $publicId,
            'territoryId' => avesmapsNullableInt($territory['id'] ?? null),
            'name' => $name,
            'displayName' => $name,
            'coatOfArmsUrl' => trim((string) ($territory['coat_of_arms_url'] ?? '')),
            'zoomMin' => $zoomRange['zoomMin'],
            'zoomMax' => $zoomRange['zoomMax'],
            'color' => trim((string) ($territory['color'] ?? '#888888')) ?: '#888888',
            'opacity' => avesmapsReadOpacity($territory['opacity'] ?? null),
            'startYear' => avesmapsNullableInt($territory['valid_from_bf'] ?? null),
            'endYear' => avesmapsNullableInt($territory['valid_to_bf'] ?? null),
            'existsUntilToday' => avesmapsNullableInt($territory['valid_to_bf'] ?? null) === null,
            'depth' => $index,
            'path' => $path,
            'pathKeys' => $pathKeys,
            'kind' => trim((string) ($territory['type'] ?? 'Herrschaftsgebiet')) ?: 'Herrschaftsgebiet',
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

function avesmapsAddSkippedExample(array &$skippedExamples, array $geometry, string $reason): void {
    if (count($skippedExamples) >= 12) {
        return;
    }

    $skippedExamples[] = sprintf(
        '#%s | %s | territory_id=%s | %s',
        (string) ($geometry['id'] ?? ''),
        (string) ($geometry['public_id'] ?? ''),
        (string) ($geometry['territory_id'] ?? 'null'),
        $reason
    );
}

function avesmapsParseCommandLineArguments(array $argv): array {
    $arguments = [
        'apply' => false,
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

    return is_array($decoded) ? $decoded : [];
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
    return $number === false ? null : (int) $number;
}

function avesmapsDescribeAssignmentDisplay(array $display): string {
    $name = trim((string) ($display['displayName'] ?? $display['name'] ?? $display['originalName'] ?? ''));
    $publicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
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
