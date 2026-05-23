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
        $publicId = avesmapsPoliticalReadPublicId($update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
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
        $publicId = avesmapsPoliticalReadPublicId($update['territory_public_id'] ?? $update['territoryPublicId'] ?? '');
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
