<?php

declare(strict_types=1);

const AVESMAPS_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_WIKI_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_USER_AGENT = 'Avesmaps WikiSync/1.0';
const AVESMAPS_WIKI_TITLE_BATCH_SIZE = 50;
const AVESMAPS_WIKI_SEARCH_RESULT_LIMIT = 5;
const AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS = 30;
const AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS = 600000;
const AVESMAPS_WIKI_REQUEST_RETRY_COUNT = 3;
const AVESMAPS_WIKI_REQUEST_RETRY_BASE_DELAY_MICROSECONDS = 1200000;
const AVESMAPS_WIKI_LOCK_TTL_SECONDS = 120;

function avesmapsWikiSyncDecodeJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    try {
        $decodedValue = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decodedValue) ? $decodedValue : [];
}

function avesmapsWikiSyncEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsWikiSyncReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsWikiSyncReadPublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die WikiSync-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsWikiSyncUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsWikiSyncRelaxLimits(): void {
    if (function_exists('set_time_limit')) {
        @set_time_limit(300);
    }

    if (function_exists('ini_set')) {
        @ini_set('memory_limit', '512M');
    }
}

function avesmapsWikiSyncLogServerError(string $label, array $context): void {
    $payload = [
        'label' => $label,
        'context' => $context,
    ];

    try {
        error_log('Avesmaps WikiSync error: ' . avesmapsWikiSyncEncodeJson($payload));
    } catch (Throwable) {
        error_log('Avesmaps WikiSync error: ' . $label);
    }
}

function avesmapsWikiSyncPageUrl(string $title): string {
    return AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', $title)));
}

function avesmapsWikiSyncApiRequest(array $params): array {
    $queryParams = [
        'format' => 'json',
        'formatversion' => '2',
    ] + $params;
    $url = AVESMAPS_WIKI_API_URL . '?' . http_build_query($queryParams, '', '&', PHP_QUERY_RFC3986);

    $lastRawResponse = '';
    $lastStatusCode = 0;

    for ($attempt = 0; $attempt <= AVESMAPS_WIKI_REQUEST_RETRY_COUNT; $attempt++) {
        if ($attempt === 0) {
            avesmapsWikiSyncThrottleWikiRequest();
        } else {
            avesmapsWikiSyncBackoffWikiRequest($attempt);
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS,
                'header' => "User-Agent: " . AVESMAPS_WIKI_USER_AGENT . "\r\nAccept: application/json\r\n",
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $http_response_header = null;
        $rawResponse = @file_get_contents($url, false, $context);
        $lastRawResponse = is_string($rawResponse) ? $rawResponse : '';
        // A connection-level failure (DNS/timeout/reset -- no response reaches
        // the wrapper at all) leaves $http_response_header unset, which
        // avesmapsWikiSyncReadHttpStatusCode() already reports as 0. The
        // explicit reset above (rather than trusting "unset") guards against a
        // PHP quirk: $http_response_header is NOT cleared by a failing
        // file_get_contents() call, so without the reset a connection failure
        // on attempt N>0 could silently inherit attempt N-1's real HTTP status
        // line instead of correctly reading as 0.
        $lastStatusCode = $rawResponse === false ? 0 : avesmapsWikiSyncReadHttpStatusCode($http_response_header ?? []);

        if (
            $lastStatusCode === 429
            || $lastStatusCode === 502
            || $lastStatusCode === 503
            || $lastStatusCode === 504
        ) {
            avesmapsWikiSyncLogServerError('wiki_api_temporary_http_error', [
                'url' => $url,
                'status_code' => $lastStatusCode,
                'attempt' => $attempt + 1,
            ]);
            continue;
        }

        if ($rawResponse === false) {
            // Transient connection-level failure (DNS/timeout/reset): no HTTP
            // response reached us at all. Retry it the same way as a 5xx --
            // this used to fall through to the generic empty-response branch
            // below and retry silently/unlogged; it now gets the same
            // explicit, logged treatment as the other temporary failures.
            avesmapsWikiSyncLogServerError('wiki_api_connection_failure', [
                'url' => $url,
                'attempt' => $attempt + 1,
            ]);
            continue;
        }

        if (!is_string($rawResponse) || $rawResponse === '') {
            continue;
        }

        try {
            $data = json_decode($rawResponse, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            $responsePrefix = substr($rawResponse, 0, 500);

            avesmapsWikiSyncLogServerError('wiki_api_invalid_json', [
                'json_error' => $exception->getMessage(),
                'url' => $url,
                'status_code' => $lastStatusCode,
                'response_prefix' => $responsePrefix,
            ]);

            if ($lastStatusCode >= 500 && $attempt < AVESMAPS_WIKI_REQUEST_RETRY_COUNT) {
                continue;
            }

            throw new RuntimeException(
                'Wiki Aventurica hat ungueltiges JSON geliefert. URL: '
                . $url
                . ' Antwort: '
                . $responsePrefix
            );
        }

        if (!is_array($data)) {
            throw new RuntimeException('Wiki Aventurica hat keine gueltige Antwort geliefert.');
        }

        return $data;
    }

    $responsePrefix = substr($lastRawResponse, 0, 500);
    throw new RuntimeException(
        'Wiki Aventurica konnte nicht gelesen werden. HTTP-Status: '
        . $lastStatusCode
        . ' URL: '
        . $url
        . ($responsePrefix !== '' ? ' Antwort: ' . $responsePrefix : '')
    );
}

function avesmapsWikiSyncThrottleWikiRequest(): void {
    $jitter = random_int(0, 250000);
    usleep(AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS + $jitter);
}

function avesmapsWikiSyncBackoffWikiRequest(int $attempt): void {
    $multiplier = max(1, $attempt);
    $jitter = random_int(0, 500000);
    usleep((AVESMAPS_WIKI_REQUEST_RETRY_BASE_DELAY_MICROSECONDS * $multiplier) + $jitter);
}

function avesmapsWikiSyncReadHttpStatusCode(array $headers): int {
    foreach ($headers as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', (string) $header, $matches) === 1) {
            return (int) $matches[1];
        }
    }

    return 0;
}

function avesmapsWikiSyncCreateMatchKey(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, false);
}

function avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, true);
}

function avesmapsWikiSyncCreateMatchKeyInternal(string $value, bool $preserveHistoricalSuffix): string {
    $value = $preserveHistoricalSuffix
        ? avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix($value)
        : avesmapsWikiSyncStripParentheticalSuffix($value);
    $value = mb_strtolower($value);
    $value = str_replace(["\u{00DF}", "\u{00E6}", "\u{0153}", "\u{00F8}", "\u{00F0}", "\u{00FE}"], ['ss', 'ae', 'oe', 'o', 'd', 'th'], $value);
    if (function_exists('iconv')) {
        $transliteratedValue = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (is_string($transliteratedValue)) {
            $value = $transliteratedValue;
        }
    }
    $value = preg_replace('/[\s_\-\'\x{2019}\x{02BC}`\x{00B4}]+/u', '', $value) ?? '';
    $value = preg_replace('/[^a-z0-9]+/u', '', $value) ?? '';

    return $value;
}

function avesmapsWikiSyncStripParentheticalSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, false);
}

function avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, true);
}

function avesmapsWikiSyncStripParentheticalSuffixInternal(string $title, bool $preserveHistoricalSuffix): string {
    $normalizedTitle = trim($title);
    if ($normalizedTitle === '') {
        return '';
    }

    if ($preserveHistoricalSuffix && avesmapsWikiSyncHasTrailingParentheticalSuffix($normalizedTitle)) {
        return $normalizedTitle;
    }

    return trim(preg_replace('/\s+\([^)]*\)\s*$/u', '', $normalizedTitle) ?? $normalizedTitle);
}

function avesmapsWikiSyncHasTrailingParentheticalSuffix(string $value): bool {
    return preg_match('/\([^)]*\)\s*$/u', $value) === 1;
}

function avesmapsWikiSyncEnsureCoreTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_runs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
            status VARCHAR(20) NOT NULL DEFAULT 'running',
            phase VARCHAR(60) NOT NULL DEFAULT 'settlement_titles',
            progress_current INT NOT NULL DEFAULT 0,
            progress_total INT NOT NULL DEFAULT 4,
            message VARCHAR(255) NULL,
            stats_json JSON NULL,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            completed_at DATETIME(3) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_runs_public_id (public_id),
            KEY idx_wiki_sync_runs_status_created (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_pages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_page_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            normalized_key VARCHAR(255) NOT NULL,
            wiki_url VARCHAR(500) NOT NULL,
            settlement_class VARCHAR(60) NULL,
            settlement_label VARCHAR(120) NULL,
            categories_json JSON NULL,
            coordinates_json JSON NULL,
            content_hash CHAR(64) NULL,
            fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_pages_title (title),
            KEY idx_wiki_sync_pages_normalized_key (normalized_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWikiSyncFetchRunByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_runs WHERE public_id = :public_id LIMIT 1');
    $statement->execute(['public_id' => $publicId]);
    $run = $statement->fetch();
    if (!$run) {
        throw new InvalidArgumentException('Der WikiSync-Lauf wurde nicht gefunden.');
    }

    return $run;
}

/**
 * Newest COMPLETED wiki_sync_runs row. With $syncType = null (default) this is
 * ACROSS ALL sync types -- the historical behaviour every existing caller relies
 * on. Pass a $syncType (e.g. AVESMAPS_WIKI_SYNC_TYPE_LOCATION) to scope the lookup
 * to one run type: the case-list path needs this because after "Dump holen" the
 * newest completed run is a dump_read run, but the settlement conflict cases are
 * keyed to a LOCATION run (avesmapsWikiDumpSettlementCaseRunId) -- an unscoped
 * lookup would resolve the dump_read run and the WHERE last_seen_run_id filter
 * would then match 0 cases. Only the case-list reader passes a type; do NOT change
 * the other (untyped) callers, whose semantics are "newest completed run of any
 * kind".
 *
 * @param string|null $syncType null = any type (unchanged); a value scopes to it.
 */
function avesmapsWikiSyncFetchLatestCompletedRun(PDO $pdo, ?string $syncType = null): ?array {
    if ($syncType === null) {
        $statement = $pdo->query(
            "SELECT *
            FROM wiki_sync_runs
            WHERE status = 'completed'
            ORDER BY completed_at DESC, id DESC
            LIMIT 1"
        );
        $run = $statement !== false ? $statement->fetch() : false;

        return $run ?: null;
    }

    $statement = $pdo->prepare(
        "SELECT *
        FROM wiki_sync_runs
        WHERE status = 'completed' AND sync_type = :sync_type
        ORDER BY completed_at DESC, id DESC
        LIMIT 1"
    );
    $statement->execute(['sync_type' => $syncType]);
    $run = $statement->fetch();

    return $run ?: null;
}

function avesmapsWikiSyncFetchLatestActiveRun(PDO $pdo, string $syncType = AVESMAPS_WIKI_SYNC_TYPE_LOCATION): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM wiki_sync_runs
        WHERE sync_type = :sync_type
            AND status = :status
            AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ' . AVESMAPS_WIKI_LOCK_TTL_SECONDS . ' SECOND)
        ORDER BY updated_at DESC, id DESC
        LIMIT 1'
    );
    $statement->execute([
        'sync_type' => $syncType,
        'status' => 'running',
    ]);

    $run = $statement->fetch(PDO::FETCH_ASSOC);
    return is_array($run) ? $run : null;
}

function avesmapsWikiSyncPublicRun(array $run): array {
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    return [
        'id' => (string) $run['public_id'],
        'public_id' => (string) $run['public_id'],
        'status' => (string) $run['status'],
        'phase' => (string) $run['phase'],
        'progress_current' => (int) $run['progress_current'],
        'progress_total' => (int) $run['progress_total'],
        'message' => (string) ($run['message'] ?? ''),
        'created_at' => (string) $run['created_at'],
        'updated_at' => (string) $run['updated_at'],
        'completed_at' => (string) ($run['completed_at'] ?? ''),
        'stats' => [
            'settlement_title_count' => (int) ($stats['settlement_title_count'] ?? 0),
            'map_place_count' => (int) ($stats['map_place_count'] ?? 0),
            'matched_count' => (int) ($stats['matched_count'] ?? 0),
            'unresolved_count' => (int) ($stats['unresolved_count'] ?? 0),
            'missing_wiki_place_count' => (int) ($stats['missing_wiki_place_count'] ?? 0),
            'case_count' => (int) ($stats['case_count'] ?? 0),
            'political_territory_received' => (int) ($stats['political_territories']['received'] ?? 0),
            'political_territory_created' => (int) ($stats['political_territories']['territory_created'] ?? 0),
            'political_territory_updated' => (int) ($stats['political_territories']['wiki_updated'] ?? 0),
            'political_territory_geometry_seeded' => (int) ($stats['political_territories']['geometry_seeded'] ?? 0),
        ],
    ];
}

function avesmapsWikiSyncUpdateRun(PDO $pdo, int $runId, string $status, string $phase, int $progressCurrent, string $message, array $stats): void {
    $statement = $pdo->prepare(
        'UPDATE wiki_sync_runs
        SET status = :status,
            phase = :phase,
            progress_current = :progress_current,
            message = :message,
            stats_json = :stats_json
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $runId,
        'status' => $status,
        'phase' => $phase,
        'progress_current' => $progressCurrent,
        'message' => $message,
        'stats_json' => avesmapsWikiSyncEncodeJson($stats),
    ]);
}

function avesmapsWikiSyncFetchCase(PDO $pdo, int $caseId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_cases WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $caseId]);
    $case = $statement->fetch();
    if (!$case) {
        throw new InvalidArgumentException('Der WikiSync-Fall wurde nicht gefunden.');
    }

    return $case;
}

function avesmapsWikiSyncReadPositiveInt(mixed $value, string $fieldName): int {
    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false || $parsedValue < 1) {
        throw new InvalidArgumentException("{$fieldName} ist ungueltig.");
    }

    return (int) $parsedValue;
}