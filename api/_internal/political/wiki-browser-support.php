<?php

declare(strict_types=1);

function makeStableKey(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    $value = mb_strtolower($value, 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß', 'æ', 'œ', 'ø', 'ð', 'þ'], ['ae', 'oe', 'ue', 'ss', 'ae', 'oe', 'o', 'd', 'th'], $value);

    if (function_exists('iconv')) {
        $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (is_string($transliterated)) {
            $value = $transliterated;
        }
    }

    $value = preg_replace('/[^a-z0-9]+/u', '-', $value) ?? '';
    $value = trim($value, '-');

    return $value;
}

function wikiTitleFromUrl(string $url): string {
    $path = (string)(parse_url($url, PHP_URL_PATH) ?? '');
    $marker = '/wiki/';
    $position = strpos($path, $marker);

    if ($position === false) {
        return '';
    }

    $title = substr($path, $position + strlen($marker));
    $title = rawurldecode($title);
    $title = str_replace('_', ' ', $title);

    return trim($title);
}

function decodeJson(mixed $json, mixed $fallback): mixed {
    if ($json === null || trim((string)$json) === '') {
        return $fallback;
    }

    $decoded = json_decode((string)$json, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        return $fallback;
    }

    return $decoded;
}

function encodeJson(mixed $value): string {
    if ($value === null) {
        return '';
    }

    try {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return '';
    }
}

function value(mixed $value): string {
    if ($value === null) {
        return '';
    }

    if (is_bool($value)) {
        return $value ? '1' : '0';
    }

    if (is_scalar($value)) {
        return trim((string)$value);
    }

    return '';
}

function stringOrNull(mixed $value): ?string {
    $text = value($value);

    return $text === '' ? null : $text;
}

function intOrNull(mixed $value): ?int {
    return is_numeric($value) ? (int)$value : null;
}

function floatOrNull(mixed $value): ?float {
    return is_numeric($value) ? (float)$value : null;
}

function applyCors(array $allowedOrigins): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
    }

    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}

function respondJson(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
