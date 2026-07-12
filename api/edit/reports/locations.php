<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Meldungen nicht pruefen.');
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
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind fuer diesen Endpoint erlaubt.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $response = match ($action) {
        'update_status' => avesmapsUpdateLocationReportReviewStatus($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Review-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Meldungen konnten nicht verarbeitet werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Meldungen konnten nicht verarbeitet werden.');
}

function avesmapsListLocationReportsForReview(PDO $pdo): array {
    avesmapsEnsureMapReportsTableForReview($pdo);

    $reports = [];
    $mapStatement = $pdo->prepare(
        'SELECT
            id,
            created_at,
            status,
            report_type,
            report_subtype,
            report_mode,
            entity_type,
            entity_public_id,
            name,
            reporter_name,
            lat,
            lng,
            source,
            sources_json,
            wiki_url,
            comment,
            page_url,
            client_version,
            review_note
        FROM map_reports
        WHERE status = :status
        ORDER BY created_at ASC, id ASC'
    );
    $mapStatement->execute([
        'status' => 'neu',
    ]);

    foreach ($mapStatement->fetchAll() as $report) {
        $report['report_source'] = 'map_reports';
        $report['size'] = $report['report_type'] === 'location' ? $report['report_subtype'] : '';
        // Multi-source #3: expose the source list (array) to the client; drop the raw JSON column.
        $report['sources'] = avesmapsDecodeReportSources($report['sources_json'] ?? null, (string) ($report['source'] ?? ''));
        unset($report['sources_json']);
        $reports[] = $report;
    }

    if (avesmapsReviewTableExists($pdo, 'location_reports')) {
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

        foreach ($statement->fetchAll() as $report) {
            $report['report_source'] = 'location_reports';
            $report['report_type'] = 'location';
            $report['report_subtype'] = (string) ($report['size'] ?? 'dorf');
            $report['sources'] = avesmapsDecodeReportSources(null, (string) ($report['source'] ?? ''));
            $reports[] = $report;
        }
    }

    usort(
        $reports,
        static fn(array $left, array $right): int => [$left['created_at'] ?? '', (int) ($left['id'] ?? 0)] <=> [$right['created_at'] ?? '', (int) ($right['id'] ?? 0)]
    );

    return [
        'ok' => true,
        'reports' => $reports,
    ];
}

function avesmapsUpdateLocationReportReviewStatus(PDO $pdo, array $payload, array $user): array {
    $reportId = filter_var($payload['report_id'] ?? null, FILTER_VALIDATE_INT);
    $reportSource = avesmapsNormalizeSingleLine((string) ($payload['report_source'] ?? 'location_reports'), 40);
    $newStatus = avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 20);
    $reviewNote = avesmapsNormalizeReviewNote($payload['review_note'] ?? null);

    if ($reportId === false || $reportId <= 0) {
        throw new InvalidArgumentException('Es wurde keine gueltige report_id uebergeben.');
    }

    if (!in_array($newStatus, ['approved', 'rejected', 'in_review'], true)) {
        throw new InvalidArgumentException('Der Review-Status ist ungueltig.');
    }

    if (!in_array($reportSource, ['location_reports', 'map_reports'], true)) {
        throw new InvalidArgumentException('Die Meldungsquelle ist ungueltig.');
    }

    if ($reportSource === 'map_reports') {
        avesmapsEnsureMapReportsTableForReview($pdo);
    }

    $reviewedBySql = $reportSource === 'map_reports' ? ', reviewed_by = :reviewed_by' : '';
    $statement = $pdo->prepare(
        "UPDATE {$reportSource}
        SET
            status = :status,
            review_note = :review_note,
            reviewed_at = CURRENT_TIMESTAMP
            {$reviewedBySql}
        WHERE id = :report_id
            AND status = 'neu'"
    );
    $params = [
        'status' => $newStatus,
        'review_note' => $reviewNote,
        'report_id' => $reportId,
    ];
    if ($reportSource === 'map_reports') {
        $params['reviewed_by'] = (int) ($user['id'] ?? 0) ?: null;
    }
    $statement->execute($params);

    if ($statement->rowCount() < 1) {
        avesmapsErrorResponse(404, 'not_found', 'Die gewuenschte Meldung wurde bereits verarbeitet oder nicht gefunden.');
    }

    return [
        'ok' => true,
        'message' => 'Die Meldung wurde aktualisiert.',
        'reviewed_by' => $user['username'] ?? '',
    ];
}

function avesmapsEnsureMapReportsTableForReview(PDO $pdo): void {
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
    // Ensure optional columns exist so the review SELECT can read them even before the first new-schema
    // report is submitted (report-location.php adds them too; this is the defensive read-side gate).
    foreach ([
        'sources_json'     => 'TEXT NULL',
        'report_mode'      => "VARCHAR(16) NOT NULL DEFAULT 'new' AFTER report_subtype",
        'entity_type'      => 'VARCHAR(20) NULL AFTER report_mode',
        'entity_public_id' => 'VARCHAR(80) NULL AFTER entity_type',
    ] as $column => $definition) {
        $quotedColumn = $pdo->quote($column);
        $columnStatement = $pdo->query("SHOW COLUMNS FROM map_reports LIKE {$quotedColumn}");
        if ($columnStatement !== false && $columnStatement->fetch() !== false) {
            continue;
        }
        $pdo->exec("ALTER TABLE map_reports ADD COLUMN {$column} {$definition}");
    }
}

function avesmapsReviewTableExists(PDO $pdo, string $tableName): bool {
    $quotedTableName = $pdo->quote($tableName);
    $statement = $pdo->query("SHOW TABLES LIKE {$quotedTableName}");
    return $statement !== false && $statement->fetch() !== false;
}

function avesmapsNormalizeReviewNote(mixed $value): ?string {
    $normalizedValue = avesmapsNormalizeSingleLine((string) ($value ?? ''), 500);
    return $normalizedValue !== '' ? $normalizedValue : null;
}

// Multi-source #3: decode the stored source list into a clean array for the client. Falls back to a
// single label-only source from the legacy `source` column when there is no JSON (old reports), so the
// review UI + "Anlegen" behave uniformly across schema versions.
function avesmapsDecodeReportSources(mixed $rawJson, string $legacyLabel = ''): array {
    $decoded = is_string($rawJson) && $rawJson !== '' ? json_decode($rawJson, true) : null;
    $list = [];
    if (is_array($decoded)) {
        foreach ($decoded as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $label = trim((string) ($entry['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $list[] = [
                'url' => (string) ($entry['url'] ?? ''),
                'label' => $label,
                'pages' => (string) ($entry['pages'] ?? ''),
                'type' => (string) ($entry['type'] ?? 'sonstiges'),
                'reference_kind' => (string) ($entry['reference_kind'] ?? ''),
                'official' => (bool) ($entry['official'] ?? false),
            ];
        }
    }
    if ($list === [] && trim($legacyLabel) !== '') {
        $list[] = ['url' => '', 'label' => trim($legacyLabel), 'pages' => '', 'type' => 'sonstiges', 'official' => false];
    }
    return $list;
}
