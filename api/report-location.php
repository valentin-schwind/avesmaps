<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

const AVESMAPS_REPORT_TYPES = [
    'location' => ['type' => 'location', 'subtype' => 'dorf'],
    'gebaeude' => ['type' => 'location', 'subtype' => 'gebaeude'],
    'fluss' => ['type' => 'label', 'subtype' => 'fluss'],
    'meer' => ['type' => 'label', 'subtype' => 'meer'],
    'see' => ['type' => 'label', 'subtype' => 'see'],
    'region' => ['type' => 'label', 'subtype' => 'region'],
    'insel' => ['type' => 'label', 'subtype' => 'insel'],
    'gebirge' => ['type' => 'label', 'subtype' => 'gebirge'],
    'berggipfel' => ['type' => 'label', 'subtype' => 'berggipfel'],
    'wald' => ['type' => 'label', 'subtype' => 'wald'],
    'wueste' => ['type' => 'label', 'subtype' => 'wueste'],
    'suempfe_moore' => ['type' => 'label', 'subtype' => 'suempfe_moore'],
    'comment' => ['type' => 'comment', 'subtype' => 'comment'],
    'sonstiges' => ['type' => 'label', 'subtype' => 'sonstiges'],
];
const AVESMAPS_LOCATION_SUBTYPES = ['dorf', 'gebaeude', 'kleinstadt', 'stadt', 'grossstadt', 'metropole'];
const AVESMAPS_REPORT_MAP_MAX_COORDINATE = 1024.0;
const AVESMAPS_REPORT_SPAM_WORDS = ['casino', 'crypto', 'viagra', 'loan', 'betting', 'porn', 'seo'];

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf keine Meldungen senden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur POST-Anfragen sind fuer Meldungen erlaubt.',
        ]);
    }

    $requestPayload = avesmapsReadJsonRequest();
    $mapReport = avesmapsValidateMapReport($requestPayload);
    if ($mapReport['is_spam'] === true) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'message' => 'Karteneintrag wurde gemeldet.',
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapReportsTable($pdo);
    if (avesmapsReportRateLimitExceeded($pdo, avesmapsBuildPrivacyIpHash($config))) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'message' => 'Karteneintrag wurde gemeldet.',
        ]);
    }
    if (avesmapsIsNearDuplicateReport($pdo, $mapReport)) {
        $mapReport['review_note'] = 'Moegliches Duplikat.';
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO map_reports (
            status,
            report_type,
            report_subtype,
            name,
            reporter_name,
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
            ip_hash,
            user_agent
        ) VALUES (
            :status,
            :report_type,
            :report_subtype,
            :name,
            :reporter_name,
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
            :ip_hash,
            :user_agent
        )'
    );

    $ipHash = avesmapsBuildPrivacyIpHash($config);
    $insertStatement->execute([
        'status' => 'neu',
        'report_type' => $mapReport['report_type'],
        'report_subtype' => $mapReport['report_subtype'],
        'name' => $mapReport['name'],
        'reporter_name' => $mapReport['reporter_name'],
        'lat' => $mapReport['lat'],
        'lng' => $mapReport['lng'],
        'source' => $mapReport['source'],
        'wiki_url' => $mapReport['wiki_url'],
        'comment' => $mapReport['comment'],
        'page_url' => $mapReport['page_url'],
        'client_version' => $mapReport['client_version'],
        'review_note' => $mapReport['review_note'] ?? '',
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => '',
        'ip_hash' => $ipHash,
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);

    avesmapsJsonResponse(201, [
        'ok' => true,
        'message' => 'Karteneintrag wurde gemeldet.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException $exception) {
    avesmapsLogLocationReportServerError('database_error', [
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'sqlstate' => (string) ($exception->errorInfo[0] ?? ''),
        'driver_code' => (string) ($exception->errorInfo[1] ?? ''),
        'driver_message' => (string) ($exception->errorInfo[2] ?? ''),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => avesmapsBuildDatabaseErrorMessage($exception),
    ]);
} catch (RuntimeException $exception) {
    avesmapsLogLocationReportServerError('runtime_error', [
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable $exception) {
    avesmapsLogLocationReportServerError('unexpected_error', [
        'exception_class' => $exception::class,
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Meldung konnte nicht verarbeitet werden.',
    ]);
}

function avesmapsValidateMapReport(array $payload): array {
    $honeypotValue = avesmapsNormalizeSingleLine((string) ($payload['website'] ?? ''), 100);
    if ($honeypotValue !== '') {
        return [
            'is_spam' => true,
        ];
    }

    $elapsedMilliseconds = filter_var($payload['elapsed_ms'] ?? null, FILTER_VALIDATE_INT);
    if ($elapsedMilliseconds !== false && $elapsedMilliseconds > 0 && $elapsedMilliseconds < 3000) {
        return [
            'is_spam' => true,
        ];
    }

    $name = avesmapsNormalizeSingleLine((string) ($payload['name'] ?? ''), 80);
    if ($name === '') {
        throw new InvalidArgumentException('Bitte einen Namen angeben.');
    }

    $requestedType = avesmapsNormalizeSingleLine((string) ($payload['report_type'] ?? 'location'), 40);
    if (!array_key_exists($requestedType, AVESMAPS_REPORT_TYPES)) {
        throw new InvalidArgumentException('Die Art der Meldung ist ungueltig.');
    }

    $reportConfig = AVESMAPS_REPORT_TYPES[$requestedType];
    $size = strtolower(avesmapsNormalizeSingleLine((string) ($payload['size'] ?? ''), 40));
    if ($requestedType === 'location') {
        if (!in_array($size, AVESMAPS_LOCATION_SUBTYPES, true) || $size === 'gebaeude') {
            throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
        }
        $reportConfig['subtype'] = $size;
    } elseif ($requestedType === 'gebaeude') {
        $reportConfig['subtype'] = 'gebaeude';
    }

    if ($reportConfig['type'] === 'location' && !in_array($reportConfig['subtype'], AVESMAPS_LOCATION_SUBTYPES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    $source = avesmapsNormalizeSingleLine((string) ($payload['source'] ?? ''), 200);
    if ($source === '' && $requestedType !== 'comment') {
        throw new InvalidArgumentException('Bitte eine Quelle angeben.');
    }
    $comment = avesmapsNormalizeMultiline((string) ($payload['comment'] ?? ''), 800);
    $wikiUrl = avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 300, 'Der Wiki-Link');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    if ($lat < 0 || $lat > AVESMAPS_REPORT_MAP_MAX_COORDINATE || $lng < 0 || $lng > AVESMAPS_REPORT_MAP_MAX_COORDINATE) {
        throw new InvalidArgumentException('Die Meldung ist ungueltig.');
    }

    $spamText = implode(' ', [$name, $source, $wikiUrl, $comment, (string) ($payload['reporter_name'] ?? '')]);
    if (avesmapsContainsSpamText($spamText) || avesmapsIsLinkOnlyText($comment)) {
        return [
            'is_spam' => true,
        ];
    }

    return [
        'is_spam' => false,
        'report_type' => $reportConfig['type'],
        'report_subtype' => $reportConfig['subtype'],
        'name' => $name,
        'reporter_name' => avesmapsNormalizeSingleLine((string) ($payload['reporter_name'] ?? ''), 80),
        'source' => $source,
        'wiki_url' => $wikiUrl,
        'comment' => $comment,
        'lat' => $lat,
        'lng' => $lng,
        'page_url' => avesmapsNormalizeOptionalUrl((string) ($payload['page_url'] ?? ''), 500, 'Die Seiten-URL'),
        'client_version' => avesmapsNormalizeSingleLine((string) ($payload['client_version'] ?? ''), 80),
    ];
}

function avesmapsContainsSpamText(string $value): bool {
    $normalizedValue = mb_strtolower($value);
    foreach (AVESMAPS_REPORT_SPAM_WORDS as $spamWord) {
        if (preg_match('/\b' . preg_quote($spamWord, '/') . '\b/u', $normalizedValue) === 1) {
            return true;
        }
    }

    return false;
}

function avesmapsIsLinkOnlyText(string $value): bool {
    $normalizedValue = trim($value);
    if ($normalizedValue === '') {
        return false;
    }

    $withoutLinks = trim((string) preg_replace('/https?:\/\/\S+/iu', '', $normalizedValue));
    return $withoutLinks === '';
}

function avesmapsBuildPrivacyIpHash(array $config): string {
    $secret = avesmapsGetConfiguredImportApiToken($config);
    if ($secret === '') {
        $secret = (string) ($config['database']['name'] ?? 'avesmaps');
    }

    return hash_hmac('sha256', avesmapsClientIpAddress(), $secret);
}

function avesmapsReportRateLimitExceeded(PDO $pdo, string $ipHash): bool {
    $statement = $pdo->prepare(
        "SELECT COUNT(*)
        FROM map_reports
        WHERE ip_hash = :ip_hash
            AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)"
    );
    $statement->execute([
        'ip_hash' => $ipHash,
    ]);

    return (int) $statement->fetchColumn() >= 5;
}

function avesmapsIsNearDuplicateReport(PDO $pdo, array $mapReport): bool {
    $statement = $pdo->prepare(
        'SELECT name, lat, lng
        FROM map_reports
        WHERE status = :status
            AND report_type = :report_type
            AND report_subtype = :report_subtype
            AND ABS(lat - :lat) <= 2
            AND ABS(lng - :lng) <= 2
        ORDER BY created_at DESC
        LIMIT 20'
    );
    $statement->execute([
        'status' => 'neu',
        'report_type' => $mapReport['report_type'],
        'report_subtype' => $mapReport['report_subtype'],
        'lat' => $mapReport['lat'],
        'lng' => $mapReport['lng'],
    ]);

    $normalizedName = avesmapsNormalizeDuplicateText($mapReport['name']);
    foreach ($statement->fetchAll() as $existingReport) {
        $existingName = avesmapsNormalizeDuplicateText((string) ($existingReport['name'] ?? ''));
        if ($existingName === $normalizedName || levenshtein($existingName, $normalizedName) <= 2) {
            return true;
        }
    }

    return false;
}

function avesmapsNormalizeDuplicateText(string $value): string {
    $normalizedValue = mb_strtolower($value);
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $normalizedValue) ?? '';
}

function avesmapsEnsureMapReportsTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_reports (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            status VARCHAR(20) NOT NULL DEFAULT 'neu',
            report_type VARCHAR(40) NOT NULL,
            report_subtype VARCHAR(60) NOT NULL,
            name VARCHAR(160) NOT NULL,
            reporter_name VARCHAR(80) NULL,
            lat DECIMAL(10, 4) NOT NULL,
            lng DECIMAL(10, 4) NOT NULL,
            source VARCHAR(200) NOT NULL,
            wiki_url VARCHAR(300) NULL,
            comment TEXT NULL,
            page_url VARCHAR(500) NULL,
            client_version VARCHAR(80) NULL,
            review_note TEXT NULL,
            request_origin VARCHAR(255) NULL,
            remote_ip VARCHAR(64) NULL,
            ip_hash CHAR(64) NULL,
            user_agent VARCHAR(500) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            reviewed_at DATETIME(3) NULL,
            reviewed_by BIGINT UNSIGNED NULL,
            PRIMARY KEY (id),
            KEY idx_map_reports_status_created_at (status, created_at),
            KEY idx_map_reports_type_status (report_type, report_subtype, status),
            KEY idx_map_reports_ip_hash_created_at (ip_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    avesmapsEnsureMapReportColumn($pdo, 'reporter_name', 'VARCHAR(80) NULL AFTER name');
    avesmapsEnsureMapReportColumn($pdo, 'ip_hash', 'CHAR(64) NULL AFTER remote_ip');
    avesmapsEnsureMapReportIndex($pdo, 'idx_map_reports_ip_hash_created_at', '(ip_hash, created_at)');
}

function avesmapsEnsureMapReportColumn(PDO $pdo, string $columnName, string $columnDefinition): void {
    $statement = $pdo->prepare('SHOW COLUMNS FROM map_reports LIKE :column_name');
    $statement->execute([
        'column_name' => $columnName,
    ]);
    if ($statement->fetch() !== false) {
        return;
    }

    $pdo->exec("ALTER TABLE map_reports ADD COLUMN {$columnName} {$columnDefinition}");
}

function avesmapsEnsureMapReportIndex(PDO $pdo, string $indexName, string $indexDefinition): void {
    foreach ($pdo->query('SHOW INDEX FROM map_reports') as $indexRow) {
        if (($indexRow['Key_name'] ?? '') === $indexName) {
            return;
        }
    }

    $pdo->exec("ALTER TABLE map_reports ADD KEY {$indexName} {$indexDefinition}");
}

function avesmapsBuildDatabaseErrorMessage(PDOException $exception): string {
    $sqlState = strtoupper((string) ($exception->errorInfo[0] ?? $exception->getCode() ?? ''));
    $driverCode = (string) ($exception->errorInfo[1] ?? '');

    if (in_array($sqlState, ['42S02', '42P01'], true)) {
        return 'Die Tabelle fuer Meldungen fehlt auf dem Server.';
    }

    if (in_array($sqlState, ['1049', '3D000'], true) || $driverCode === '1049') {
        return 'Die konfigurierte Meldungs-Datenbank existiert auf dem Server nicht.';
    }

    if (in_array($sqlState, ['28000', '42501'], true) || in_array($driverCode, ['1044', '1045', '1142'], true)) {
        return 'Der Datenbank-Benutzer darf Meldungen gerade nicht speichern.';
    }

    if (in_array($sqlState, ['08001', '08004', '08006', 'HY000', '57P03'], true) || in_array($driverCode, ['2002', '2003'], true)) {
        return 'Die Meldungs-Datenbank ist aktuell nicht erreichbar.';
    }

    return 'Die Meldung konnte nicht in der Datenbank gespeichert werden.';
}

function avesmapsLogLocationReportServerError(string $label, array $context): void {
    $logPayload = [
        'label' => $label,
        'time' => gmdate('c'),
        'context' => $context,
    ];

    try {
        $encodedPayload = json_encode($logPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        error_log('Avesmaps location report error: ' . $encodedPayload);
    } catch (JsonException) {
        error_log('Avesmaps location report error: ' . $label);
    }
}
