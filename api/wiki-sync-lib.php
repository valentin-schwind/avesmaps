<?php

declare(strict_types=1);

const AVESMAPS_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_WIKI_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_USER_AGENT = 'Avesmaps WikiSync/1.0';
const AVESMAPS_WIKI_TITLE_BATCH_SIZE = 50;
const AVESMAPS_WIKI_SEARCH_RESULT_LIMIT = 5;
const AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS = 30;
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

    $rawResponse = @file_get_contents($url, false, $context);
    if (!is_string($rawResponse) || $rawResponse === '') {
        throw new RuntimeException('Wiki Aventurica konnte nicht gelesen werden.');
    }

    try {
        $data = json_decode($rawResponse, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('Wiki Aventurica hat ungueltiges JSON geliefert.');
    }

    if (!is_array($data)) {
        throw new RuntimeException('Wiki Aventurica hat keine gueltige Antwort geliefert.');
    }

    return $data;
}