<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $configuredImportToken = avesmapsGetConfiguredImportApiToken($config);
    if ($configuredImportToken === '') {
        avesmapsErrorResponse(503, 'service_unavailable', 'Die Import-API ist auf dem Server noch nicht konfiguriert.');
    }

    $requestToken = avesmapsReadImportApiTokenFromRequest();
    if ($requestToken === '' || !hash_equals($configuredImportToken, $requestToken)) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Das Import-API-Token fehlt oder ist ungueltig.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST-Anfragen sind fuer diesen Endpoint erlaubt.');
    }

    $requestPayload = avesmapsReadJsonRequest();
    $reportId = filter_var($requestPayload['report_id'] ?? null, FILTER_VALIDATE_INT);
    if ($reportId === false || $reportId <= 0) {
        avesmapsErrorResponse(400, 'invalid_request', 'Es wurde keine gueltige report_id uebergeben.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $statement = $pdo->prepare('DELETE FROM location_reports WHERE id = :report_id');
    $statement->execute([
        'report_id' => $reportId,
    ]);

    if ($statement->rowCount() < 1) {
        avesmapsErrorResponse(404, 'not_found', 'Die gewuenschte Ortsmeldung wurde nicht gefunden.');
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'message' => 'Die Ortsmeldung wurde geloescht.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsmeldung konnte nicht geloescht werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsmeldung konnte nicht verarbeitet werden.');
}
