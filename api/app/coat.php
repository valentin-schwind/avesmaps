<?php

declare(strict_types=1);

// Oeffentlicher, read-only Wappen-Cache/Proxy fuer die Karte. Laedt ein Wappen EINMAL serverseitig
// von wiki-aventurica.de, cached es auf Platte (/uploads/wappen/cache) und liefert es mit langen
// Cache-Headern. Verhindert das Hotlinking hunderter externer SVGs (net::ERR_NO_BUFFER_SPACE) und
// den Spezial:Dateipfad-Redirect-Sturm. Host-Allowlist gegen SSRF. Liefert Bild-Bytes (kein JSON).
//
// 💣 Ein Fehlschlag wird NOTIERT (api/_internal/coat-drossel.php), sonst holt der naechste
// Seitenaufbau dieselbe Adresse erneut -- was uns die Wiki-Sperre eingebracht hat.
//
// GET ?u=<wiki-aventurica-Bild-URL>

require __DIR__ . '/../_internal/bootstrap.php';
// 💣 Kein blankes require: der Deploy laedt Dateien EINZELN hoch und laesst nie etwas weg,
// aber ein abgebrochener Lauf kann coat.php mitnehmen und die Drossel zurueckhalten. Ein
// Fatal Error waere dann die Antwort dieses Endpunkts -- und wichtiger: ein Proxy OHNE
// Drossel ist genau der Zustand, der uns die Wiki-Sperre eingebracht hat. Fehlt sie, geht
// darum gar nichts mehr nach draussen (siehe unten).
require_once __DIR__ . '/../_internal/wiki/datei-riegel.php';
// Die Drossel aus demselben Grund und mit derselben Vorsicht. 🔴 Sie wohnt bewusst NICHT in
// sync.php: die Crawl-Bibliothek je Wappenbild zu laden waere absurd, und genau deshalb hatte
// dieser Endpunkt bis zum 25.08.2026 ueberhaupt keine Drossel.
require_once __DIR__ . '/../_internal/wiki/drossel.php';
$avesmapsCoatDrosselLib = __DIR__ . '/../_internal/coat-drossel.php';
if (is_file($avesmapsCoatDrosselLib)) {
    require $avesmapsCoatDrosselLib;
}

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
//
// 💣 `$absage` SAGT, WARUM ES NICHTS WURDE -- und das ist hier kein Komfort, sondern tragend.
// Ein Abruf, der an Riegel oder Drossel scheitert, hat NIE EINE ANFRAGE GESTELLT und darf
// deshalb keinen Grabstein bekommen. Genau diese Verwechslung war der Fehler vom 23.08.2026:
// der geriegelte Pfad schrieb Grabsteine fuer Adressen, die niemand probiert hatte, und fuenf
// davon schlossen die Wappen-Drossel global -- kaputt genau dann, wenn die Wappen endlich
// geholt werden sollen. Ohne diesen Ausgang waere derselbe Fehler mit dem Crawl-delay zurueck.
function avesmapsCoatFetch(string $url, ?string &$absage = null): array {
    $absage = null;

    // 🔴 DER RIEGEL. Owner 23.08.2026: keine Datei-Abrufe mehr bei Wiki Aventurica.
    if (function_exists('avesmapsWikiDateiAbrufErlaubt') && !avesmapsWikiDateiAbrufErlaubt($url)) {
        $absage = 'geriegelt';
        return [null, ''];
    }

    // 🔴 DER CRAWL-DELAY, und er WARTET NICHT. Dies hier beantwortet einen Seitenaufbau: 20
    // Sekunden Schlaf haelt einen PHP-Arbeiter, und eine Editorliste mit mehreren fehlenden
    // Wappen macht daraus mehrere gleichzeitig -- die Arbeiter-Saettigung aus AGENTS.md §10.
    // Der Abruf wird deshalb ABGEWIESEN statt verzoegert; nachgeholt wird er vom ausdruecklichen
    // Lauf „Hole Wiki-Wappen", der warten darf.
    // ⚠️ FEHLT die Drossel, geht NICHTS raus -- dieselbe Richtung wie beim Dateikopf: ein Proxy
    // ohne Drossel ist der Zustand, der uns die Sperre eingebracht hat.
    if (function_exists('avesmapsWikiDrosselGiltFuer') && avesmapsWikiDrosselGiltFuer($url)) {
        if (!function_exists('avesmapsWikiDrosselPlatzFrei') || !avesmapsWikiDrosselPlatzFrei()) {
            $absage = 'crawl_delay';
            return [null, ''];
        }
    }

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
    // Muss vor der Drosselfrage stehen: die Drossel legt ihren Zustand hier ab und gilt ohne
    // schreibbares Verzeichnis als "zu" -- ohne dieses mkdir kaeme nie wieder ein Wappen durch.
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    // Cache-Treffer: vorhandene Datei <key>.<ext> direkt ausliefern.
    foreach (AVESMAPS_COAT_EXT_TYPES as $ext => $type) {
        $cachedPath = $dir . '/' . $key . '.' . $ext;
        if (is_file($cachedPath)) {
            avesmapsCoatServeFile($cachedPath, $type);
        }
    }

    // Cache-Miss. 🔴 AB HIER GEHT EINE ANFRAGE NACH DRAUSSEN -- und genau hier sass der Vorfall
    // vom 20.-23.08.2026: ein Fehlschlag wurde nirgends notiert, also holte jeder Seitenaufbau
    // dieselben Tausend Adressen erneut, waehrend das Wiki uns bereits sperrte. Die Drossel ist
    // die einzige Frage vor dem Ausgang; wer sie umgeht, baut den Vorfall nach.
    $jetzt = time();
    // ⭐ Das Signal nach aussen. Ohne es ist "die Drossel greift" von "der alte Code laeuft" nicht
    // zu unterscheiden -- daran ist die erste Abnahme dieses Fixes haengengeblieben, weil ein
    // fehlgeschlagener Deploy die Datei gar nicht erst hochgeladen hatte (AGENTS.md §9).
    header('X-Avesmaps-Coat-Drossel: v1');

    // 🔴 DER RIEGEL, und er wird VOR der Drossel gefragt -- aus zwei Gruenden, beide am
    // 23.08.2026 live gemessen:
    // (1) Ohne eigenen Ausgang antwortet ein geriegelter Abruf mit demselben 502 wie ein echter
    //     Fehlschlag. „Haemmern wir noch?" ist dann von AUSSEN nicht zu beantworten -- und genau
    //     diese Frage stand drei Tage lang unbeantwortet im Raum. Die Absage muss ihren Grund
    //     nennen (vgl. absage-ohne-grund-ist-von-aussen-unauffindbar).
    // (2) 💣 SCHLIMMER: der geriegelte Pfad lief in `avesmapsCoatDrosselFehlschlag` und schrieb
    //     einen Grabstein fuer eine Adresse, die NIE PROBIERT WURDE. Nach fuenf davon macht die
    //     Drossel global fuer 30 Minuten zu, ohne dass eine einzige Anfrage nach draussen ging --
    //     und beim Oeffnen des Riegels waeren alle beruehrten Adressen sechs Stunden gesperrt.
    //     Also genau dann kaputt, wenn wir die Wappen endlich holen wollen.
    // ⚠️ Der Riegel in `avesmapsCoatFetch` BLEIBT stehen: er deckt jeden anderen Aufrufer ab.
    if (function_exists('avesmapsWikiDateiAbrufErlaubt') && !avesmapsWikiDateiAbrufErlaubt($url)) {
        header('X-Avesmaps-Coat: geriegelt');
        avesmapsCoatFail(503, 'Abrufe bei Wiki Aventurica sind abgeschaltet.');
    }

    if (!function_exists('avesmapsCoatDrosselDarfHolen')) {
        header('X-Avesmaps-Coat: drossel-fehlt');
        avesmapsCoatFail(503, 'Wappen gerade nicht abrufbar.');
    }
    if (!avesmapsCoatDrosselDarfHolen($dir, $key, $jetzt)) {
        header('X-Avesmaps-Coat: gedrosselt');
        avesmapsCoatFail(503, 'Wappen gerade nicht abrufbar (Drossel aktiv).');
    }
    header('X-Avesmaps-Coat: abruf');

    $absage = null;
    [$bytes, $contentType] = avesmapsCoatFetch($url, $absage);

    // 🔴 ABGEWIESEN IST NICHT FEHLGESCHLAGEN, und der Unterschied ist der Grabstein. Hier ging
    // keine Anfrage nach draussen -- das Wiki hat also nichts versagt, und die Adresse hat sich
    // nichts zuschulden kommen lassen. Wer das zusammenwirft, schliesst nach fuenf Abweisungen
    // die Wappen-Drossel global fuer 30 Minuten, ohne dass ein einziges Byte geflossen ist.
    // ⚠️ 503, nicht 502: 502 hiesse „das Gegenueber hat versagt" -- hier hat es niemand gefragt.
    if ($absage !== null) {
        header('X-Avesmaps-Coat: ' . ($absage === 'crawl_delay' ? 'crawl-delay' : 'geriegelt'));
        avesmapsCoatFail(503, 'Wappen gerade nicht abrufbar (Crawl-delay des Wikis).');
    }

    if ($bytes === null) {
        avesmapsCoatDrosselFehlschlag($dir, $key, $jetzt);
        avesmapsCoatFail(502, 'Wappen konnte nicht geladen werden.');
    }
    $ext = avesmapsCoatExtFromType($contentType, $url);
    if ($ext === null) {
        // Das Wiki hat geantwortet -- der Riegel bleibt offen, nur diese Adresse ruht.
        avesmapsCoatDrosselAdresseRuhen($dir, $key, $jetzt);
        avesmapsCoatFail(415, 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).');
    }
    avesmapsCoatDrosselErfolg($dir, $key, $jetzt);
    $type = AVESMAPS_COAT_EXT_TYPES[$ext];

    // Cachen (best effort) und ausliefern.
    if (is_dir($dir) || @mkdir($dir, 0775, true) || is_dir($dir)) {
        // Write atomically (temp + rename) so concurrent cache-misses cannot serve a truncated image.
        $cachePath = $dir . '/' . $key . '.' . $ext;
        $tmpPath = $cachePath . '.tmp.' . getmypid();
        // No LOCK_EX: $tmpPath is unique per PID, so the flock guards nothing but can block on the NFS
        // lock daemon under a cache-miss burst (pool-wedge risk -- see php-pool hang, 2026-07-17).
        if (@file_put_contents($tmpPath, $bytes) !== false && !@rename($tmpPath, $cachePath)) {
            @unlink($tmpPath);
        }
    }
    avesmapsCoatEmit($bytes, $type);
} catch (Throwable $error) {
    avesmapsCoatFail(500, 'Fehler beim Laden des Wappens.');
}
