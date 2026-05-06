<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Ortsmeldungen nicht pruefen.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        avesmapsJsonResponse(200, avesmapsListLocationReportsForReview($pdo));
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET und POST sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $response = match ($action) {
        'update_status' => avesmapsUpdateLocationReportReviewStatus($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Review-Aktion ist unbekannt.'),
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
        'error' => 'Die Ortsmeldungen konnten nicht verarbeitet werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Ortsmeldungen konnten nicht verarbeitet werden.',
    ]);
}

function avesmapsListLocationReportsForReview(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            id,
            created_at,
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
            review_note
        FROM location_reports
        WHERE status = :status
        ORDER BY created_at ASC, id ASC'
    );
    $statement->execute([
        'status' => 'neu',
    ]);

    return [
        'ok' => true,
        'reports' => $statement->fetchAll(),
    ];
}

function avesmapsUpdateLocationReportReviewStatus(PDO $pdo, array $payload, array $user): array {
    $reportId = filter_var($payload['report_id'] ?? null, FILTER_VALIDATE_INT);
    $newStatus = avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 20);
    $reviewNote = avesmapsNormalizeReviewNote($payload['review_note'] ?? null);

    if ($reportId === false || $reportId <= 0) {
        throw new InvalidArgumentException('Es wurde keine gueltige report_id uebergeben.');
    }

    if (!in_array($newStatus, ['approved', 'rejected', 'in_review'], true)) {
        throw new InvalidArgumentException('Der Review-Status ist ungueltig.');
    }

    $statement = $pdo->prepare(
        'UPDATE location_reports
        SET
            status = :status,
            review_note = :review_note,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = :report_id'
    );
    $statement->execute([
        'status' => $newStatus,
        'review_note' => $reviewNote,
        'report_id' => $reportId,
    ]);

    if ($statement->rowCount() < 1) {
        avesmapsJsonResponse(404, [
            'ok' => false,
            'error' => 'Die gewuenschte Ortsmeldung wurde nicht gefunden.',
        ]);
    }

    return [
        'ok' => true,
        'message' => 'Die Ortsmeldung wurde aktualisiert.',
        'reviewed_by' => $user['username'] ?? '',
    ];
}

function avesmapsNormalizeReviewNote(mixed $value): ?string {
    $normalizedValue = avesmapsNormalizeSingleLine((string) ($value ?? ''), 500);
    return $normalizedValue !== '' ? $normalizedValue : null;
}
