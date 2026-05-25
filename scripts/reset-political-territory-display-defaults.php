<?php

declare(strict_types=1);

require __DIR__ . '/../api/bootstrap.php';
require_once __DIR__ . '/../api/political-territory-lib.php';

$arguments = avesmapsParseDisplayResetArguments($argv ?? []);

if ($arguments['help']) {
    echo "Avesmaps political territory display reset\n";
    echo "\n";
    echo "Usage:\n";
    echo "  php scripts/reset-political-territory-display-defaults.php\n";
    echo "  php scripts/reset-political-territory-display-defaults.php --apply\n";
    echo "  php scripts/reset-political-territory-display-defaults.php --opacity=0.33 --apply\n";
    echo "  php scripts/reset-political-territory-display-defaults.php --territory-public-id=<uuid> --apply\n";
    echo "  php scripts/reset-political-territory-display-defaults.php --geometry-public-id=<uuid> --diagnose\n";
    echo "\n";
    echo "Options:\n";
    echo "  --apply                 Write changes. Without this option the script runs as dry-run.\n";
    echo "  --diagnose              Print one geometry and its local display values without writing.\n";
    echo "  --opacity=<0..1>        Reset opacity/transparency target. Default: 0.33.\n";
    echo "  --limit=<n>             Process at most n matching geometries. Useful for testing.\n";
    echo "  --territory-public-id   Reset only this territory subtree globally and matching geometry displays.\n";
    echo "  --geometry-public-id    Process only one geometry. Also usable with --diagnose.\n";
    echo "  --include-inactive      Also process inactive territories/geometries.\n";
    echo "  --help                  Show this help.\n";
    exit(0);
}

$apply = $arguments['apply'];
$diagnose = $arguments['diagnose'];
$targetOpacity = $arguments['opacity'];
$limit = $arguments['limit'];
$territoryPublicId = $arguments['territoryPublicId'];
$geometryPublicId = $arguments['geometryPublicId'];
$includeInactive = $arguments['includeInactive'];

$config = avesmapsLoadApiConfig(__DIR__ . '/../api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
avesmapsPoliticalEnsureTables($pdo);

$territoriesById = avesmapsFetchDisplayResetTerritoriesById($pdo, $includeInactive);
$territoriesByPublicId = avesmapsIndexDisplayResetTerritoriesByPublicId($territoriesById);
$targetTerritoryIds = avesmapsBuildDisplayResetTargetTerritoryIds($territoriesById, $territoriesByPublicId, $territoryPublicId);
$defaultsByTerritoryId = avesmapsBuildDisplayResetDefaults($territoriesById, $targetOpacity);
$defaultsByPublicId = avesmapsIndexDisplayResetDefaultsByPublicId($defaultsByTerritoryId, $territoriesById);

if ($diagnose) {
    if ($geometryPublicId === '') {
        throw new InvalidArgumentException('--diagnose braucht --geometry-public-id=<uuid>.');
    }
    avesmapsDiagnoseDisplayResetGeometry($pdo, $geometryPublicId, $defaultsByPublicId, $territoriesById);
    exit(0);
}

$updateTerritoryStatement = $pdo->prepare(
    'UPDATE political_territory
    SET color = :color,
        opacity = :opacity
    WHERE id = :id'
);
$updateGeometryStatement = $pdo->prepare(
    'UPDATE political_territory_geometry
    SET style_json = :style_json
    WHERE id = :id'
);

$changedGlobalTerritories = 0;
$globalExamples = [];

foreach ($territoriesById as $territoryId => $territory) {
    if (!isset($targetTerritoryIds[$territoryId])) {
        continue;
    }

    $default = $defaultsByTerritoryId[$territoryId] ?? null;
    if ($default === null) {
        continue;
    }

    $oldColor = avesmapsNormalizeDisplayResetColor($territory['color'] ?? '') ?: '#888888';
    $oldOpacity = avesmapsReadDisplayResetOpacity($territory['opacity'] ?? null);
    if ($oldColor === $default['color'] && abs($oldOpacity - $default['opacity']) < 0.0005) {
        continue;
    }

    $changedGlobalTerritories++;
    if (count($globalExamples) < 12) {
        $globalExamples[] = sprintf(
            '#%d | %s | %s: %s / %.3f -> %s / %.3f',
            $territoryId,
            (string) ($territory['public_id'] ?? ''),
            avesmapsDisplayResetTerritoryName($territory),
            $oldColor,
            $oldOpacity,
            $default['color'],
            $default['opacity']
        );
    }

    if ($apply) {
        $updateTerritoryStatement->execute([
            'id' => $territoryId,
            'color' => $default['color'],
            'opacity' => $default['opacity'],
        ]);
    }
}

$geometries = avesmapsFetchDisplayResetGeometries($pdo, $geometryPublicId, $limit, $includeInactive);
$scannedGeometries = 0;
$changedGeometries = 0;
$changedDisplays = 0;
$clearedTopLevelStyleFields = 0;
$skippedDisplaysWithoutDefault = 0;
$geometryExamples = [];
$skippedExamples = [];

foreach ($geometries as $geometry) {
    $scannedGeometries++;
    $style = avesmapsDecodeDisplayResetStyleJson($geometry['style_json'] ?? null);
    $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? null;
    $geometryChanged = false;
    $localDisplayChanges = 0;

    if (is_array($displays)) {
        foreach ($displays as $index => $display) {
            if (!is_array($display)) {
                continue;
            }

            $publicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
            if ($publicId === '' || !isset($defaultsByPublicId[$publicId])) {
                $skippedDisplaysWithoutDefault++;
                avesmapsAddDisplayResetSkippedExample($skippedExamples, $geometry, $display, 'kein Default fuer territoryPublicId');
                continue;
            }

            $default = $defaultsByPublicId[$publicId];
            $oldColor = avesmapsNormalizeDisplayResetColor($display['color'] ?? '') ?: '#888888';
            $oldOpacity = avesmapsReadDisplayResetOpacity($display['opacity'] ?? null);
            if ($oldColor === $default['color'] && abs($oldOpacity - $default['opacity']) < 0.0005) {
                $displays[$index]['color'] = $default['color'];
                $displays[$index]['opacity'] = $default['opacity'];
                continue;
            }

            $displays[$index]['color'] = $default['color'];
            $displays[$index]['opacity'] = $default['opacity'];
            $geometryChanged = true;
            $localDisplayChanges++;
            $changedDisplays++;

            if (count($geometryExamples) < 12) {
                $geometryExamples[] = sprintf(
                    '%s | %s: %s / %.3f -> %s / %.3f',
                    (string) ($geometry['public_id'] ?? ''),
                    avesmapsDescribeDisplayResetDisplay($display),
                    $oldColor,
                    $oldOpacity,
                    $default['color'],
                    $default['opacity']
                );
            }
        }
    }

    foreach (['color', 'fill', 'stroke', 'opacity', 'fillOpacity', 'fill_opacity'] as $field) {
        if (array_key_exists($field, $style)) {
            unset($style[$field]);
            $geometryChanged = true;
            $clearedTopLevelStyleFields++;
        }
    }

    if (!$geometryChanged) {
        continue;
    }

    $changedGeometries++;
    if (!$apply) {
        continue;
    }

    if (is_array($displays)) {
        $style['assignmentDisplays'] = array_values($displays);
        unset($style['assignment_displays']);
    }

    $updateGeometryStatement->execute([
        'id' => (int) $geometry['id'],
        'style_json' => avesmapsEncodeDisplayResetJsonOrNull($style),
    ]);
}

$mode = $apply ? 'APPLY' : 'DRY-RUN';
echo "Mode: {$mode}\n";
echo "Target opacity: " . number_format($targetOpacity, 3, '.', '') . "\n";
echo "Scanned territories: " . count($territoriesById) . "\n";
echo "Target territories: " . count($targetTerritoryIds) . "\n";
echo "Changed global territories: {$changedGlobalTerritories}\n";
echo "Scanned geometries: {$scannedGeometries}\n";
echo "Changed geometries: {$changedGeometries}\n";
echo "Changed local assignment displays: {$changedDisplays}\n";
echo "Cleared top-level local style fields: {$clearedTopLevelStyleFields}\n";
echo "Skipped local displays without default: {$skippedDisplaysWithoutDefault}\n";

if ($globalExamples !== []) {
    echo "\nGlobal territory examples:\n";
    foreach ($globalExamples as $example) {
        echo "- {$example}\n";
    }
}

if ($geometryExamples !== []) {
    echo "\nLocal geometry examples:\n";
    foreach ($geometryExamples as $example) {
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

function avesmapsFetchDisplayResetTerritoriesById(PDO $pdo, bool $includeInactive): array {
    $sql = 'SELECT id, public_id, parent_id, name, short_name, type, color, opacity, is_active
        FROM political_territory';
    if (!$includeInactive) {
        $sql .= ' WHERE is_active = 1';
    }
    $sql .= ' ORDER BY id ASC';

    $statement = $pdo->query($sql);
    $territories = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $id = avesmapsNullableDisplayResetInt($row['id'] ?? null);
        if ($id !== null) {
            $territories[$id] = $row;
        }
    }
    return $territories;
}

function avesmapsIndexDisplayResetTerritoriesByPublicId(array $territoriesById): array {
    $index = [];
    foreach ($territoriesById as $id => $territory) {
        $publicId = trim((string) ($territory['public_id'] ?? ''));
        if ($publicId !== '') {
            $index[$publicId] = (int) $id;
        }
    }
    return $index;
}

function avesmapsBuildDisplayResetTargetTerritoryIds(array $territoriesById, array $territoriesByPublicId, string $territoryPublicId): array {
    if ($territoryPublicId === '') {
        return array_fill_keys(array_map('intval', array_keys($territoriesById)), true);
    }

    $rootId = $territoriesByPublicId[$territoryPublicId] ?? null;
    if ($rootId === null) {
        throw new InvalidArgumentException('territory-public-id wurde nicht gefunden: ' . $territoryPublicId);
    }

    $targets = [(int) $rootId => true];
    $changed = true;
    while ($changed) {
        $changed = false;
        foreach ($territoriesById as $id => $territory) {
            $parentId = avesmapsNullableDisplayResetInt($territory['parent_id'] ?? null);
            if ($parentId !== null && isset($targets[$parentId]) && !isset($targets[(int) $id])) {
                $targets[(int) $id] = true;
                $changed = true;
            }
        }
    }

    return $targets;
}

function avesmapsBuildDisplayResetDefaults(array $territoriesById, float $opacity): array {
    $defaults = [];
    $chainCache = [];
    foreach ($territoriesById as $id => $territory) {
        $chain = avesmapsBuildDisplayResetTerritoryChain((int) $id, $territoriesById, $chainCache);
        $depth = max(0, count($chain) - 1);
        $root = $chain[0] ?? $territory;
        $defaults[(int) $id] = [
            'color' => avesmapsCreateDisplayResetTerritoryColor($territory, $root, $depth),
            'opacity' => $opacity,
        ];
    }
    return $defaults;
}

function avesmapsIndexDisplayResetDefaultsByPublicId(array $defaultsByTerritoryId, array $territoriesById): array {
    $index = [];
    foreach ($defaultsByTerritoryId as $territoryId => $default) {
        $publicId = trim((string) ($territoriesById[(int) $territoryId]['public_id'] ?? ''));
        if ($publicId !== '') {
            $index[$publicId] = $default;
        }
    }
    return $index;
}

function avesmapsBuildDisplayResetTerritoryChain(int $territoryId, array $territoriesById, array &$chainCache): array {
    if (isset($chainCache[$territoryId])) {
        return $chainCache[$territoryId];
    }

    $chain = [];
    $seen = [];
    $currentId = $territoryId;
    while ($currentId > 0 && isset($territoriesById[$currentId]) && !isset($seen[$currentId])) {
        $seen[$currentId] = true;
        $territory = $territoriesById[$currentId];
        array_unshift($chain, $territory);
        $parentId = avesmapsNullableDisplayResetInt($territory['parent_id'] ?? null);
        if ($parentId === null || $parentId === $currentId) {
            break;
        }
        $currentId = $parentId;
    }

    $chainCache[$territoryId] = $chain;
    return $chain;
}

function avesmapsCreateDisplayResetTerritoryColor(array $territory, array $root, int $depth): string {
    $rootSeed = avesmapsDisplayResetHashString((string) ($root['public_id'] ?? $root['short_name'] ?? $root['name'] ?? 'Herrschaftsgebiet'));
    $nodeSeed = avesmapsDisplayResetHashString((string) ($territory['public_id'] ?? $territory['short_name'] ?? $territory['name'] ?? 'Herrschaftsgebiet'));
    $baseHue = $rootSeed % 360;
    $hueOffset = $depth === 0 ? 0 : (($nodeSeed % 37) - 18) + ($depth * 4);
    $hue = ($baseHue + $hueOffset + 360) % 360;
    $saturation = avesmapsClampDisplayResetNumber(58 + ($rootSeed % 18) - min($depth * 3, 12), 44, 74);
    $value = avesmapsClampDisplayResetNumber(54 + ($nodeSeed % 18) + min($depth * 3, 10), 48, 78);
    return avesmapsDisplayResetHsvToHex($hue, $saturation, $value);
}

function avesmapsDisplayResetHashString(string $value): int {
    $hash = 2166136261;
    $length = strlen($value);
    for ($index = 0; $index < $length; $index++) {
        $hash ^= ord($value[$index]);
        $hash = ($hash * 16777619) & 0xffffffff;
    }
    return $hash;
}

function avesmapsDisplayResetHsvToHex(float $hue, float $saturationPercent, float $valuePercent): string {
    $saturation = avesmapsClampDisplayResetNumber($saturationPercent, 0, 100) / 100;
    $value = avesmapsClampDisplayResetNumber($valuePercent, 0, 100) / 100;
    $chroma = $value * $saturation;
    $huePrime = fmod(avesmapsModuloDisplayResetNumber($hue, 360), 360) / 60;
    $secondary = $chroma * (1 - abs(fmod($huePrime, 2) - 1));
    $match = $value - $chroma;

    if ($huePrime < 1) {
        [$red, $green, $blue] = [$chroma, $secondary, 0];
    } elseif ($huePrime < 2) {
        [$red, $green, $blue] = [$secondary, $chroma, 0];
    } elseif ($huePrime < 3) {
        [$red, $green, $blue] = [0, $chroma, $secondary];
    } elseif ($huePrime < 4) {
        [$red, $green, $blue] = [0, $secondary, $chroma];
    } elseif ($huePrime < 5) {
        [$red, $green, $blue] = [$secondary, 0, $chroma];
    } else {
        [$red, $green, $blue] = [$chroma, 0, $secondary];
    }

    return sprintf(
        '#%02x%02x%02x',
        (int) round(avesmapsClampDisplayResetNumber(($red + $match) * 255, 0, 255)),
        (int) round(avesmapsClampDisplayResetNumber(($green + $match) * 255, 0, 255)),
        (int) round(avesmapsClampDisplayResetNumber(($blue + $match) * 255, 0, 255))
    );
}

function avesmapsModuloDisplayResetNumber(float $value, float $divisor): float {
    $result = fmod($value, $divisor);
    return $result < 0 ? $result + $divisor : $result;
}

function avesmapsClampDisplayResetNumber(float|int $value, float|int $min, float|int $max): float {
    return max((float) $min, min((float) $max, (float) $value));
}

function avesmapsFetchDisplayResetGeometries(PDO $pdo, string $geometryPublicId, ?int $limit, bool $includeInactive): array {
    $conditions = [];
    $params = [];
    if (!$includeInactive) {
        $conditions[] = 'is_active = 1';
    }
    if ($geometryPublicId !== '') {
        $conditions[] = 'public_id = :public_id';
        $params['public_id'] = $geometryPublicId;
    }

    $sql = 'SELECT id, public_id, territory_id, style_json FROM political_territory_geometry';
    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }
    $sql .= ' ORDER BY id ASC';
    if ($limit !== null && $limit > 0) {
        $sql .= ' LIMIT ' . $limit;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function avesmapsDecodeDisplayResetStyleJson(mixed $value): array {
    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function avesmapsEncodeDisplayResetJsonOrNull(array $value): ?string {
    if ($value === []) {
        return null;
    }

    $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (!is_string($json)) {
        throw new RuntimeException('style_json konnte nicht serialisiert werden.');
    }
    return $json;
}

function avesmapsReadDisplayResetOpacity(mixed $value): float {
    if ($value === null || $value === '') {
        return 0.33;
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        return 0.33;
    }
    return max(0.0, min(1.0, $number));
}

function avesmapsNormalizeDisplayResetColor(mixed $value): string {
    $color = trim((string) $value);
    return preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1 ? mb_strtolower($color) : '';
}

function avesmapsNullableDisplayResetInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }
    $number = (int) $value;
    return $number > 0 ? $number : null;
}

function avesmapsDisplayResetTerritoryName(array $territory): string {
    return trim((string) ($territory['short_name'] ?? '')) ?: trim((string) ($territory['name'] ?? 'Herrschaftsgebiet'));
}

function avesmapsDescribeDisplayResetDisplay(array $display): string {
    return trim((string) ($display['displayName'] ?? $display['name'] ?? $display['territoryPublicId'] ?? 'Herrschaftsgebiet'));
}

function avesmapsDiagnoseDisplayResetGeometry(PDO $pdo, string $geometryPublicId, array $defaultsByPublicId, array $territoriesById): void {
    $statement = $pdo->prepare(
        'SELECT id, public_id, territory_id, style_json, is_active
        FROM political_territory_geometry
        WHERE public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $geometryPublicId]);
    $geometry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($geometry)) {
        echo "No geometry found for public_id={$geometryPublicId}\n";
        return;
    }

    $style = avesmapsDecodeDisplayResetStyleJson($geometry['style_json'] ?? null);
    $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? [];

    echo "Diagnosis\n";
    echo "Geometry: #" . (string) $geometry['id'] . " / " . (string) $geometry['public_id'] . "\n";
    echo "Geometry active: " . (string) $geometry['is_active'] . "\n";
    echo "Geometry territory_id: " . (string) ($geometry['territory_id'] ?? 'null') . "\n";
    echo "style_json present: " . (is_string($geometry['style_json'] ?? null) && trim((string) $geometry['style_json']) !== '' ? 'yes' : 'no') . "\n";
    echo "assignmentDisplays count: " . (is_array($displays) ? count($displays) : 0) . "\n";

    foreach (['color', 'fill', 'stroke', 'opacity', 'fillOpacity', 'fill_opacity'] as $field) {
        if (array_key_exists($field, $style)) {
            echo "Top-level local style field: {$field}=" . (string) $style[$field] . "\n";
        }
    }

    if (!is_array($displays)) {
        return;
    }

    echo "\nStored assignmentDisplays:\n";
    foreach ($displays as $index => $display) {
        if (!is_array($display)) {
            continue;
        }
        $publicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        $default = $defaultsByPublicId[$publicId] ?? null;
        echo sprintf(
            '- Ebene %d | %s | territoryPublicId=%s | stored %s / %.3f | default %s / %.3f' . "\n",
            $index + 1,
            avesmapsDescribeDisplayResetDisplay($display),
            $publicId,
            avesmapsNormalizeDisplayResetColor($display['color'] ?? '') ?: '#888888',
            avesmapsReadDisplayResetOpacity($display['opacity'] ?? null),
            $default['color'] ?? 'none',
            $default['opacity'] ?? 0.0
        );
    }
}

function avesmapsAddDisplayResetSkippedExample(array &$examples, array $geometry, array $display, string $reason): void {
    if (count($examples) >= 12) {
        return;
    }
    $examples[] = sprintf(
        '%s | %s | territoryPublicId=%s | %s',
        (string) ($geometry['public_id'] ?? ''),
        avesmapsDescribeDisplayResetDisplay($display),
        (string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''),
        $reason
    );
}

function avesmapsParseDisplayResetArguments(array $argv): array {
    $arguments = [
        'apply' => false,
        'diagnose' => false,
        'help' => false,
        'includeInactive' => false,
        'limit' => null,
        'opacity' => 0.33,
        'territoryPublicId' => '',
        'geometryPublicId' => '',
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
        if ($token === '--include-inactive') {
            $arguments['includeInactive'] = true;
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
            $arguments['limit'] = max(0, (int) avesmapsReadDisplayResetNextCliValue($tokens, $index, '--limit'));
            continue;
        }
        if (str_starts_with($token, '--opacity=')) {
            $arguments['opacity'] = avesmapsParseDisplayResetOpacityArgument(substr($token, strlen('--opacity=')));
            continue;
        }
        if ($token === '--opacity') {
            $arguments['opacity'] = avesmapsParseDisplayResetOpacityArgument(avesmapsReadDisplayResetNextCliValue($tokens, $index, '--opacity'));
            continue;
        }
        if (str_starts_with($token, '--territory-public-id=')) {
            $arguments['territoryPublicId'] = trim(substr($token, strlen('--territory-public-id=')));
            continue;
        }
        if ($token === '--territory-public-id') {
            $arguments['territoryPublicId'] = trim(avesmapsReadDisplayResetNextCliValue($tokens, $index, '--territory-public-id'));
            continue;
        }
        if (str_starts_with($token, '--geometry-public-id=')) {
            $arguments['geometryPublicId'] = trim(substr($token, strlen('--geometry-public-id=')));
            continue;
        }
        if ($token === '--geometry-public-id') {
            $arguments['geometryPublicId'] = trim(avesmapsReadDisplayResetNextCliValue($tokens, $index, '--geometry-public-id'));
            continue;
        }

        throw new InvalidArgumentException('Unbekannte Option: ' . $token);
    }

    return $arguments;
}

function avesmapsReadDisplayResetNextCliValue(array $tokens, int &$index, string $optionName): string {
    if (!isset($tokens[$index + 1])) {
        throw new InvalidArgumentException($optionName . ' braucht einen Wert.');
    }
    $index++;
    return (string) $tokens[$index];
}

function avesmapsParseDisplayResetOpacityArgument(string $value): float {
    if (!is_numeric($value)) {
        throw new InvalidArgumentException('--opacity muss eine Zahl zwischen 0 und 1 sein.');
    }
    $opacity = (float) $value;
    if ($opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('--opacity muss zwischen 0 und 1 liegen.');
    }
    return round($opacity, 3);
}
