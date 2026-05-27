<?php

declare(strict_types=1);

define('AVESMAPS_WIKI_DOM_SOURCE_DIR', dirname(__DIR__, 2));

function wikiDomLockStatusPayload(): array {
    $lockPath = AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.lock';
    $cancelPath = AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.cancel';
    $running = false;
    $lockMtime = is_file($lockPath) ? filemtime($lockPath) : false;
    $lockAgeSeconds = $lockMtime !== false ? max(0, time() - (int) $lockMtime) : null;

    if (is_file($lockPath)) {
        $handle = @fopen($lockPath, 'c+');
        if (is_resource($handle)) {
            if (@flock($handle, LOCK_EX | LOCK_NB)) {
                @flock($handle, LOCK_UN);
            } else {
                $running = true;
            }
            @fclose($handle);
        } else {
            $running = true;
        }
    }

    return [
        'ok' => true,
        'running' => $running,
        'lock_exists' => is_file($lockPath),
        'cancel_requested' => is_file($cancelPath),
        'lock_age_seconds' => $lockAgeSeconds,
        'checked_at' => date(DATE_ATOM),
    ];
}

function wikiDomJsonOut(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

$action = trim((string) ($_GET['action'] ?? ''));
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'status') {
    wikiDomJsonOut(wikiDomLockStatusPayload());
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'cancel') {
    $cancelPath = AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.cancel';
    if (@file_put_contents($cancelPath, date(DATE_ATOM) . "\n") === false) {
        wikiDomJsonOut(['ok' => false, 'error' => 'Abbruchsignal konnte nicht geschrieben werden.'], 500);
    }
    $payload = wikiDomLockStatusPayload();
    $payload['message'] = $payload['running']
        ? 'Abbruch angefordert. Der Import stoppt nach der aktuellen Seite.'
        : 'Abbruchsignal gesetzt. Es läuft aktuell kein Import.';
    wikiDomJsonOut($payload);
}

$sourcePath = __DIR__ . '/dom-source.php';
$source = file_get_contents($sourcePath);
if (!is_string($source) || trim($source) === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Wiki-DOM-Sync-Quelle konnte nicht geladen werden.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$source = preg_replace('/^\s*<\?php\s*/u', '', $source, 1) ?? $source;
$source = str_replace('__DIR__', 'AVESMAPS_WIKI_DOM_SOURCE_DIR', $source);
require_once __DIR__ . '/dom-filter.php';
$source = avesmapsWikiDomPatchSource($source);

$tempPath = tempnam(sys_get_temp_dir(), 'avesmaps-wiki-dom-sync-');
if (!is_string($tempPath) || $tempPath === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Temporäre Sync-Datei konnte nicht erzeugt werden.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
file_put_contents($tempPath, "<?php\n" . $source);
register_shutdown_function(static function () use ($tempPath): void { @unlink($tempPath); });
require $tempPath;
