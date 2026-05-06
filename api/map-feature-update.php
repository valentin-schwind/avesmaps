<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Kartendaten nicht bearbeiten.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST' && $requestMethod !== 'PATCH') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST oder PATCH sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $result = avesmapsMovePointFeature($pdo, $publicId, $lat, $lng, $user);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'feature' => $result,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht gespeichert werden.',
        'detail' => $exception->getMessage(),
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Das Kartenobjekt konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsReadMapFeaturePublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Feature-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsMovePointFeature(PDO $pdo, string $publicId, float $lat, float $lng, array $user): array {
    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, revision
            FROM map_features
            WHERE public_id = :public_id
                AND is_active = 1
            LIMIT 1
            FOR UPDATE'
        );
        $statement->execute([
            'public_id' => $publicId,
        ]);
        $feature = $statement->fetch();

        if (!$feature) {
            throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
        }

        if ((string) $feature['geometry_type'] !== 'Point') {
            throw new InvalidArgumentException('Aktuell koennen nur Orte verschoben werden.');
        }

        $beforeJson = avesmapsEncodeAuditJson($feature);
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $updateStatement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :lng,
                min_y = :lat,
                max_x = :lng,
                max_y = :lat,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $updateStatement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => json_encode($geometry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'lng' => $lng,
            'lat' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        $afterJson = avesmapsEncodeAuditJson([
            'public_id' => $feature['public_id'],
            'feature_type' => $feature['feature_type'],
            'feature_subtype' => $feature['feature_subtype'],
            'name' => $feature['name'],
            'geometry_type' => 'Point',
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_point', (int) $user['id'], $beforeJson, $afterJson);
        $pdo->commit();

        return [
            'public_id' => $publicId,
            'name' => (string) ($feature['name'] ?? ''),
            'lat' => $lat,
            'lng' => $lng,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}

function avesmapsNextMapRevision(PDO $pdo): int {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Kartenrevision konnte nicht gelesen werden.');
    }

    return (int) $revision;
}

function avesmapsWriteMapAuditLog(PDO $pdo, int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): void {
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
        VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);
}

function avesmapsEncodeAuditJson(array $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
