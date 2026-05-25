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
    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.',
        ]);
    }

    $statusFilter = avesmapsNormalizeSingleLine((string) ($_GET['status'] ?? 'neu'), 20);
    if ($statusFilter === '') {
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => 'Es wurde kein gueltiger Status uebergeben.',
        ]);
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
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Ortsmeldungen konnten nicht aus der Datenbank geladen werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Ortsmeldungen konnten nicht geladen werden.',
    ]);
}
