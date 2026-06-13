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
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.');
    }

    $statusFilter = avesmapsNormalizeSingleLine((string) ($_GET['status'] ?? 'neu'), 20);
    if ($statusFilter === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Es wurde kein gueltiger Status uebergeben.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
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
        'status' => $statusFilter,
    ]);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'reports' => $statement->fetchAll(),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsmeldungen konnten nicht aus der Datenbank geladen werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsmeldungen konnten nicht geladen werden.');
}
