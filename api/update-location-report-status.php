<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);
    $configuredImportToken = avesmapsGetConfiguredImportApiToken($config);
    if ($configuredImportToken === '') {
        avesmapsJsonResponse(503, [
            'ok' => false,
            'error' => 'Die Import-API ist auf dem Server noch nicht konfiguriert.',
        ]);
    }

    $requestToken = avesmapsReadImportApiTokenFromRequest();
    if ($requestToken === '' || !hash_equals($configuredImportToken, $requestToken)) {
        avesmapsJsonResponse(401, [
            'ok' => false,
            'error' => 'Das Import-API-Token fehlt oder ist ungueltig.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST-Anfragen sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $requestPayload = avesmapsReadJsonRequest();
    $reportId = filter_var($requestPayload['report_id'] ?? null, FILTER_VALIDATE_INT);
    $newStatus = avesmapsNormalizeSingleLine((string) ($requestPayload['status'] ?? ''), 20);

    if ($reportId === false || $reportId <= 0) {
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => 'Es wurde keine gueltige report_id uebergeben.',
        ]);
    }

    if ($newStatus === '') {
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => 'Es wurde kein gueltiger Status uebergeben.',
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $statement = $pdo->prepare(
        'UPDATE location_reports
        SET
            status = :status,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = :report_id'
    );
    $statement->execute([
        'status' => $newStatus,
        'report_id' => $reportId,
    ]);

    if ($statement->rowCount() < 1) {
        avesmapsJsonResponse(404, [
            'ok' => false,
            'error' => 'Die gewuenschte Ortsmeldung wurde nicht gefunden.',
        ]);
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'message' => 'Der Status der Ortsmeldung wurde aktualisiert.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Status der Ortsmeldung konnte nicht aktualisiert werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Der Status der Ortsmeldung konnte nicht verarbeitet werden.',
    ]);
}
