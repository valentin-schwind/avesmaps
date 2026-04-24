<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

const AVESMAPS_ALLOWED_LOCATION_SIZES = ['dorf', 'kleinstadt', 'stadt', 'grossstadt', 'metropole'];

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf keine Ortsmeldungen senden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST-Anfragen sind fuer Ortsmeldungen erlaubt.',
        ]);
    }

    $requestPayload = avesmapsReadJsonRequest();
    $locationReport = avesmapsValidateLocationReport($requestPayload);
    if ($locationReport['is_spam'] === true) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'message' => 'Ort wurde gemeldet.',
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $insertStatement = $pdo->prepare(
        'INSERT INTO location_reports (
            status,
            name,
            size,
            lat,
            lng,
            source,
            wiki_url,
            comment,
            page_url,
            client_version,
            review_note,
            request_origin,
            remote_ip,
            user_agent
        ) VALUES (
            :status,
            :name,
            :size,
            :lat,
            :lng,
            :source,
            :wiki_url,
            :comment,
            :page_url,
            :client_version,
            :review_note,
            :request_origin,
            :remote_ip,
            :user_agent
        )'
    );

    $insertStatement->execute([
        'status' => 'neu',
        'name' => $locationReport['name'],
        'size' => $locationReport['size'],
        'lat' => $locationReport['lat'],
        'lng' => $locationReport['lng'],
        'source' => $locationReport['source'],
        'wiki_url' => $locationReport['wiki_url'],
        'comment' => $locationReport['comment'],
        'page_url' => $locationReport['page_url'],
        'client_version' => $locationReport['client_version'],
        'review_note' => '',
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);

    avesmapsJsonResponse(201, [
        'ok' => true,
        'message' => 'Ort wurde gemeldet.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Ortsmeldung konnte nicht in der Datenbank gespeichert werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Ortsmeldung konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsValidateLocationReport(array $payload): array {
    $honeypotValue = avesmapsNormalizeSingleLine((string) ($payload['website'] ?? ''), 100);
    if ($honeypotValue !== '') {
        return [
            'is_spam' => true,
        ];
    }

    $name = avesmapsNormalizeSingleLine((string) ($payload['name'] ?? ''), 80);
    if ($name === '') {
        throw new InvalidArgumentException('Bitte einen Ortsnamen angeben.');
    }

    $size = strtolower(avesmapsNormalizeSingleLine((string) ($payload['size'] ?? ''), 40));
    if (!in_array($size, AVESMAPS_ALLOWED_LOCATION_SIZES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    $source = avesmapsNormalizeSingleLine((string) ($payload['source'] ?? ''), 200);
    if ($source === '') {
        throw new InvalidArgumentException('Bitte eine Quelle angeben.');
    }

    return [
        'is_spam' => false,
        'name' => $name,
        'size' => $size,
        'source' => $source,
        'wiki_url' => avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 300, 'Der Wiki-Link'),
        'comment' => avesmapsNormalizeMultiline((string) ($payload['comment'] ?? ''), 800),
        'lat' => avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat'),
        'lng' => avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng'),
        'page_url' => avesmapsNormalizeOptionalUrl((string) ($payload['page_url'] ?? ''), 500, 'Die Seiten-URL'),
        'client_version' => avesmapsNormalizeSingleLine((string) ($payload['client_version'] ?? ''), 80),
    ];
}
