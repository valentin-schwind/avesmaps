<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/political-territory-lib.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Herrschaftsgebiete nicht bearbeiten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if (!in_array($requestMethod, ['POST', 'PATCH'], true)) {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST und PATCH sind fuer Subtree-Darstellungen erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);

    $response = match ($action) {
        'update_colors' => avesmapsPoliticalSubtreeDisplayUpdateColors($pdo, $payload, $user),
        'update_opacity' => avesmapsPoliticalSubtreeDisplayUpdateOpacity($pdo, $payload, $user),
        'inherit_colors' => avesmapsPoliticalSubtreeDisplayInheritColors($pdo, $payload, $user),
        'inherit_opacity' => avesmapsPoliticalSubtreeDisplayInheritOpacity($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Subtree-Darstellungsaktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Subtree-Darstellung konnte nicht in der Datenbank gespeichert werden.',
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Subtree-Darstellung konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsPoliticalSubtreeDisplayUpdateColors(PDO $pdo, array $payload, array $user): array {
    $updates = avesmapsPoliticalSubtreeDisplayReadUpdates($payload['updates'] ?? null);
    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET color = :color,
            updated_by = :updated_by
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $color = avesmapsPoliticalSubtreeDisplayReadColor($update['color'] ?? '');
        $publicId = avesmapsPoliticalSubtreeDisplayReadPublicId($update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $statement->execute([
            ':color' => $color,
            ':updated_by' => (int) ($user['id'] ?? 0),
            ':public_id' => $publicId,
        ]);
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
    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET opacity = :opacity,
            updated_by = :updated_by
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updates as $update) {
        $opacity = avesmapsPoliticalSubtreeDisplayReadOpacity($update['opacity'] ?? null);
        $publicId = avesmapsPoliticalSubtreeDisplayReadPublicId($update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
        $statement->execute([
            ':opacity' => $opacity,
            ':updated_by' => (int) ($user['id'] ?? 0),
            ':public_id' => $publicId,
        ]);
        $changed += $statement->rowCount();
    }

    return [
        'ok' => true,
        'changed' => $changed,
        'received' => count($updates),
    ];
}

function avesmapsPoliticalSubtreeDisplayInheritColors(PDO $pdo, array $payload, array $user): array {
    $rootPublicId = avesmapsPoliticalSubtreeDisplayReadPublicId($payload['root_territory_public_id'] ?? '');
    $rootColor = avesmapsPoliticalSubtreeDisplayReadColor($payload['color'] ?? '');
    $hierarchy = avesmapsPoliticalSubtreeDisplayLoadHierarchy($pdo);
    $root = $hierarchy['rowsByPublicId'][$rootPublicId] ?? null;

    if (!is_array($root)) {
        throw new InvalidArgumentException('Das ausgewaehlte Wurzelgebiet wurde nicht gefunden.');
    }

    $updatesByPublicId = avesmapsPoliticalSubtreeDisplayBuildColorInheritanceUpdates(
        $hierarchy['childrenByParentId'],
        (int) $root['id'],
        $rootColor
    );

    if ($updatesByPublicId === []) {
        return [
            'ok' => true,
            'descendants_count' => 0,
            'global_changed' => 0,
            'local_geometry_changed' => 0,
            'local_display_changed' => 0,
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
        'descendants_count' => count($updatesByPublicId),
        'global_changed' => $globalChanged,
        'local_geometry_changed' => $localGeometryChanged,
        'local_display_changed' => $localDisplayChanged,
    ];
}

function avesmapsPoliticalSubtreeDisplayInheritOpacity(PDO $pdo, array $payload, array $user): array {
    $rootPublicId = avesmapsPoliticalSubtreeDisplayReadPublicId($payload['root_territory_public_id'] ?? '');
    $rootOpacity = avesmapsPoliticalSubtreeDisplayReadOpacity($payload['opacity'] ?? null);
    $hierarchy = avesmapsPoliticalSubtreeDisplayLoadHierarchy($pdo);
    $root = $hierarchy['rowsByPublicId'][$rootPublicId] ?? null;

    if (!is_array($root)) {
        throw new InvalidArgumentException('Das ausgewaehlte Wurzelgebiet wurde nicht gefunden.');
    }

    $updatesByPublicId = avesmapsPoliticalSubtreeDisplayBuildOpacityInheritanceUpdates(
        $hierarchy['childrenByParentId'],
        (int) $root['id'],
        $rootOpacity
    );

    if ($updatesByPublicId === []) {
        return [
            'ok' => true,
            'descendants_count' => 0,
            'global_changed' => 0,
            'local_geometry_changed' => 0,
            'local_display_changed' => 0,
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
        'descendants_count' => count($updatesByPublicId),
        'global_changed' => $globalChanged,
        'local_geometry_changed' => $localGeometryChanged,
        'local_display_changed' => $localDisplayChanged,
    ];
}

function avesmapsPoliticalSubtreeDisplayLoadHierarchy(PDO $pdo): array {
    $rows = $pdo->query(
        'SELECT id, public_id, parent_id
        FROM political_territory
        WHERE is_active = 1
        ORDER BY id ASC'
    )->fetchAll(PDO::FETCH_ASSOC);

    $rowsByPublicId = [];
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
        'childrenByParentId' => $childrenByParentId,
    ];
}

function avesmapsPoliticalSubtreeDisplayBuildColorInheritanceUpdates(array $childrenByParentId, int $rootId, string $rootColor): array {
    $updatesByPublicId = [];
    $visitedIds = [];
    $stack = [];

    foreach ($childrenByParentId[$rootId] ?? [] as $childRow) {
        $stack[] = [
            'row' => $childRow,
            'parent_color' => $rootColor,
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

        $childColor = avesmapsPoliticalSubtreeDisplayCreateHueVariant((string) ($current['parent_color'] ?? '#888888'));
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $updatesByPublicId[$publicId] = $childColor;
        }

        foreach ($childrenByParentId[$rowId] ?? [] as $childRow) {
            $stack[] = [
                'row' => $childRow,
                'parent_color' => $childColor,
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

    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET color = :color,
            updated_by = :updated_by
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updatesByPublicId as $publicId => $color) {
        $statement->execute([
            ':color' => $color,
            ':updated_by' => $updatedBy,
            ':public_id' => $publicId,
        ]);
        $changed += $statement->rowCount();
    }

    return $changed;
}

function avesmapsPoliticalSubtreeDisplayApplyGlobalOpacityUpdates(PDO $pdo, array $updatesByPublicId, int $updatedBy): int {
    if ($updatesByPublicId === []) {
        return 0;
    }

    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET opacity = :opacity,
            updated_by = :updated_by
        WHERE public_id = :public_id'
    );

    $changed = 0;
    foreach ($updatesByPublicId as $publicId => $opacity) {
        $statement->execute([
            ':opacity' => $opacity,
            ':updated_by' => $updatedBy,
            ':public_id' => $publicId,
        ]);
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

function avesmapsPoliticalSubtreeDisplayCreateHueVariant(string $parentColor): string {
    $rgb = avesmapsPoliticalSubtreeDisplayParseHexColorToRgb($parentColor);
    if ($rgb === null) {
        return '#888888';
    }

    $hsv = avesmapsPoliticalSubtreeDisplayRgbToHsv($rgb['red'], $rgb['green'], $rgb['blue']);
    $hueOffset = avesmapsPoliticalSubtreeDisplayRandomSignedHueOffsetDegrees(10, 20);
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

function avesmapsPoliticalSubtreeDisplayRandomSignedHueOffsetDegrees(float $min256, float $max256): float {
    $magnitude256 = $min256 + (lcg_value() * ($max256 - $min256));
    $degrees = ($magnitude256 / 256.0) * 360.0;
    return random_int(0, 1) === 0 ? -$degrees : $degrees;
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
