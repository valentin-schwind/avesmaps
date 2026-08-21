<?php

declare(strict_types=1);

require_once __DIR__ . '/../text/ascii-fold.php';

function makeStableKey(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    $value = mb_strtolower($value, 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß', 'æ', 'œ', 'ø', 'ð', 'þ'], ['ae', 'oe', 'ue', 'ss', 'ae', 'oe', 'o', 'd', 'th'], $value);

    // Deterministic table, NOT iconv//TRANSLIT. ä/ö/ü are already mapped to
    // ae/oe/ue above, so the fold only sees residual accents here -- for those
    // it reproduces what the server produced before ('Côte' -> 'c-te').
    $value = avesmapsFoldToAscii($value);

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

/**
 * Baut die WHERE-Bedingung der Wiki-Browser-Suche samt ihrer Werte.
 *
 * 💣 Jeder benannte Platzhalter darf hier nur EINMAL vorkommen. avesmapsCreatePdo setzt
 * ATTR_EMULATE_PREPARES => false, und MySQL lehnt ein Statement mit wiederholtem Platzhalter
 * dann mit HY093 ab. Bis zum 21.08.2026 stand hier achtmal ':q' bei einer einzigen Bindung:
 * JEDE Suche antwortete mit HTTP 500 (q=Gareth, q=Irak, q=Kemi, q=Irakema -- alle gemessen),
 * ohne q kam 200. Das catch (Throwable) am Ende des Endpunkts machte daraus ein nacktes
 * 'Internal server error.', weshalb es von aussen nicht zu diagnostizieren war.
 *
 * ⚠️ Dieselbe Falle wie bei "Was ist hier?" (AGENTS.md §11) -- sie stand damit zum zweiten Mal
 * im Haus. Gewacht von __tests__/wiki-browser-suche-platzhalter-test.php, und zwar STATISCH:
 * sqlite ERLAUBT den wiederholten Platzhalter, ein Test dagegen bliebe gruen.
 */
function avesmapsPoliticalWikiBrowserSearchCondition(string $search): array {
    $spalten = ['name', 'type', 'affiliation_raw', 'affiliation_root', 'status', 'capital_name', 'seat_name', 'ruler'];

    $teile = [];
    $params = [];
    foreach ($spalten as $index => $spalte) {
        $platzhalter = ':q' . ($index + 1);
        $teile[] = $spalte . ' LIKE ' . $platzhalter;
        $params[$platzhalter] = '%' . $search . '%';
    }

    return ['(' . implode(' OR ', $teile) . ')', $params];
}
