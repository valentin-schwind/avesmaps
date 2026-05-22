<?php

declare(strict_types=1);

require __DIR__ . '/../api/bootstrap.php';
require_once __DIR__ . '/../api/political-territory-lib.php';

$options = getopt('', ['apply', 'limit:', 'geometry-public-id:', 'help']);

if (isset($options['help'])) {
    echo "Avesmaps political breadcrumb default zoom migration\n";
    echo "\n";
    echo "Usage:\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --apply\n";
    echo "  php scripts/apply-political-breadcrumb-default-zooms.php --geometry-public-id=<uuid> --apply\n";
    echo "\n";
    echo "Options:\n";
    echo "  --apply                 Write changes. Without this option the script runs as dry-run.\n";
    echo "  --limit=<n>             Process at most n matching geometries. Useful for testing.\n";
    echo "  --geometry-public-id    Process only one geometry.\n";
    echo "  --help                  Show this help.\n";
    exit(0);
}

$apply = array_key_exists('apply', $options);
$limit = isset($options['limit']) ? max(0, (int) $options['limit']) : null;
$geometryPublicId = trim((string) ($options['geometry-public-id'] ?? ''));

$config = avesmapsLoadApiConfig(__DIR__ . '/../api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
avesmapsPoliticalEnsureTables($pdo);

$geometries = avesmapsFetchPoliticalGeometriesWithAssignmentDisplays($pdo, $geometryPublicId, $limit);
$updateStatement = $pdo->prepare(
    'UPDATE political_territory_geometry
    SET style_json = :style_json
    WHERE id = :id'
);

$scannedGeometries = 0;
$changedGeometries = 0;
$changedDisplays = 0;
$skippedGeometries = 0;
$examples = [];

foreach ($geometries as $geometry) {
    $scannedGeometries++;
    $style = avesmapsDecodePoliticalStyleJson($geometry['style_json'] ?? null);
    $displays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? null;
    if (!is_array($displays) || count($displays) < 1) {
        $skippedGeometries++;
        continue;
    }

    $chainLength = count($displays);
    $geometryChanged = false;
    foreach ($displays as $index => $display) {
        if (!is_array($display)) {
            continue;
        }

        $defaultZoom = avesmapsPoliticalBreadcrumbDefaultZoomRange($chainLength, (int) $index);
        $oldMin = avesmapsNullableInt($display['zoomMin'] ?? $display['zoom_min'] ?? null);
        $oldMax = avesmapsNullableInt($display['zoomMax'] ?? $display['zoom_max'] ?? null);
        if ($oldMin === $defaultZoom['zoomMin'] && $oldMax === $defaultZoom['zoomMax']) {
            continue;
        }

        $displays[$index]['zoomMin'] = $defaultZoom['zoomMin'];
        $displays[$index]['zoomMax'] = $defaultZoom['zoomMax'];
        unset($displays[$index]['zoom_min'], $displays[$index]['zoom_max']);
        $geometryChanged = true;
        $changedDisplays++;

        if (count($examples) < 12) {
            $examples[] = sprintf(
                '%s | Ebene %d/%d | %s: %s-%s -> %d-%d',
                (string) ($geometry['public_id'] ?? ''),
                $index + 1,
                $chainLength,
                avesmapsDescribeAssignmentDisplay($display),
                $oldMin === null ? 'null' : (string) $oldMin,
                $oldMax === null ? 'null' : (string) $oldMax,
                $defaultZoom['zoomMin'],
                $defaultZoom['zoomMax']
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
echo "Scanned geometries: {$scannedGeometries}\n";
echo "Changed geometries: {$changedGeometries}\n";
echo "Changed breadcrumb displays: {$changedDisplays}\n";
echo "Skipped geometries without assignmentDisplays: {$skippedGeometries}\n";

if ($examples !== []) {
    echo "\nExamples:\n";
    foreach ($examples as $example) {
        echo "- {$example}\n";
    }
}

if (!$apply) {
    echo "\nNo database rows were changed. Run again with --apply to write the changes.\n";
}

function avesmapsFetchPoliticalGeometriesWithAssignmentDisplays(PDO $pdo, string $geometryPublicId, ?int $limit): array {
    $conditions = [
        'is_active = 1',
        'style_json IS NOT NULL',
        '(style_json LIKE :assignment_displays_camel OR style_json LIKE :assignment_displays_snake)',
    ];
    $params = [
        'assignment_displays_camel' => '%assignmentDisplays%',
        'assignment_displays_snake' => '%assignment_displays%',
    ];

    if ($geometryPublicId !== '') {
        $conditions[] = 'public_id = :public_id';
        $params['public_id'] = $geometryPublicId;
    }

    $sql = 'SELECT id, public_id, style_json
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

function avesmapsPoliticalBreadcrumbDefaultZoomRange(int $chainLength, int $index): array {
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
            1 => ['zoomMin' => 2, 'zoomMax' => 3],
            default => ['zoomMin' => 4, 'zoomMax' => 6],
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
