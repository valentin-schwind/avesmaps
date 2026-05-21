<?php

declare(strict_types=1);

define('AVESMAPS_WIKI_DOM_SOURCE_DIR', __DIR__);

$sourcePath = __DIR__ . '/wiki-dom-sync-source.php';
$source = file_get_contents($sourcePath);
if (!is_string($source) || trim($source) === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Wiki-DOM-Sync-Quelle konnte nicht geladen werden.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$source = preg_replace('/^\s*<\?php\s*/u', '', $source, 1) ?? $source;
$source = str_replace('__DIR__', 'AVESMAPS_WIKI_DOM_SOURCE_DIR', $source);
require_once __DIR__ . '/wiki-dom-sync-filter.php';
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
