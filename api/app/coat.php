<?php

declare(strict_types=1);

// Oeffentlicher, read-only Wappen-Cache/Proxy fuer die Karte. Laedt ein Wappen EINMAL serverseitig
// von wiki-aventurica.de, cached es auf Platte (/uploads/wappen/cache) und liefert es mit langen
// Cache-Headern. Verhindert das Hotlinking hunderter externer SVGs (net::ERR_NO_BUFFER_SPACE) und
// den Spezial:Dateipfad-Redirect-Sturm. Host-Allowlist gegen SSRF. Liefert Bild-Bytes (kein JSON).
//
// GET ?u=<wiki-aventurica-Bild-URL>

require __DIR__ . '/../_internal/bootstrap.php';

const AVESMAPS_COAT_ALLOWED_HOST_SUFFIX = 'wiki-aventurica.de';
const AVESMAPS_COAT_EXT_TYPES = [
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'svg' => 'image/svg+xml',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
];

function avesmapsCoatFail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $message;
    exit;
}

function avesmapsCoatHeaders(string $type, int $length): void {
    header('Content-Type: ' . $type);
    if ($length > 0) {
        header('Content-Length: ' . $length);
    }
    header('Cache-Control: public, max-age=31536000, immutable');
    header('X-Content-Type-Options: nosniff');
    // SVG koennte Skripte enthalten -> bei Direktaufruf neutralisieren (als <img> ohnehin inert).
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox");
}

function avesmapsCoatServeFile(string $path, string $type): void {
    avesmapsCoatHeaders($type, (int) @filesize($path));
    readfile($path);
    exit;
}

function avesmapsCoatEmit(string $bytes, string $type): void {
    avesmapsCoatHeaders($type, strlen($bytes));
    echo $bytes;
    exit;
}

function avesmapsCoatExtFromType(string $contentType, string $url): ?string {
    $ct = strtolower(trim(explode(';', $contentType)[0]));
    foreach (AVESMAPS_COAT_EXT_TYPES as $ext => $type) {
        if ($type === $ct) {
            return $ext === 'jpeg' ? 'jpg' : $ext;
        }
    }
    $ext = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
    if (isset(AVESMAPS_COAT_EXT_TYPES[$ext])) {
        return $ext === 'jpeg' ? 'jpg' : $ext;
    }
    return null;
}

// Laedt eine Bild-URL serverseitig (cURL, folgt Redirects, nur HTTP/HTTPS). [bytes, content_type] oder [null, ''].
function avesmapsCoatFetch(string $url): array {
    if (!function_exists('curl_init')) {
        return [null, ''];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT => 'AvesmapsWappenBot/1.0 (+https://avesmaps.de)',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($body === false || $code < 200 || $code >= 300 || $body === '') {
        return [null, ''];
    }
    return [(string) $body, $type];
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsCoatFail(403, 'Diese Herkunft darf keine Wappen laden.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if ($method !== 'GET') {
        avesmapsCoatFail(405, 'Nur GET-Anfragen sind erlaubt.');
    }

    $url = trim((string) ($_GET['u'] ?? ''));
    if ($url === '') {
        avesmapsCoatFail(400, 'Parameter "u" fehlt.');
    }

    $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if (($scheme !== 'http' && $scheme !== 'https') || $host === '') {
        avesmapsCoatFail(400, 'Ungueltige Bild-URL.');
    }
    // Host-Allowlist (Suffix-Match) gegen SSRF.
    if ($host !== AVESMAPS_COAT_ALLOWED_HOST_SUFFIX && !str_ends_with($host, '.' . AVESMAPS_COAT_ALLOWED_HOST_SUFFIX)) {
        avesmapsCoatFail(403, 'Nur Wappen von wiki-aventurica.de sind erlaubt.');
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 2)), '/');
    $dir = $docroot . '/uploads/wappen/cache';
    $key = sha1($url);

    // Cache-Treffer: vorhandene Datei <key>.<ext> direkt ausliefern.
    foreach (AVESMAPS_COAT_EXT_TYPES as $ext => $type) {
        $cachedPath = $dir . '/' . $key . '.' . $ext;
        if (is_file($cachedPath)) {
            avesmapsCoatServeFile($cachedPath, $type);
        }
    }

    // Cache-Miss: einmalig serverseitig laden.
    [$bytes, $contentType] = avesmapsCoatFetch($url);
    if ($bytes === null) {
        avesmapsCoatFail(502, 'Wappen konnte nicht geladen werden.');
    }
    $ext = avesmapsCoatExtFromType($contentType, $url);
    if ($ext === null) {
        avesmapsCoatFail(415, 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).');
    }
    $type = AVESMAPS_COAT_EXT_TYPES[$ext];

    // Cachen (best effort) und ausliefern.
    if (is_dir($dir) || @mkdir($dir, 0775, true) || is_dir($dir)) {
        // Write atomically (temp + rename) so concurrent cache-misses cannot serve a truncated image.
        $cachePath = $dir . '/' . $key . '.' . $ext;
        $tmpPath = $cachePath . '.tmp.' . getmypid();
        if (@file_put_contents($tmpPath, $bytes, LOCK_EX) !== false && !@rename($tmpPath, $cachePath)) {
            @unlink($tmpPath);
        }
    }
    avesmapsCoatEmit($bytes, $type);
} catch (Throwable $error) {
    avesmapsCoatFail(500, 'Fehler beim Laden des Wappens.');
}
