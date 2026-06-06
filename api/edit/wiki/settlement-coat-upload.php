<?php

declare(strict_types=1);

// Authed Upload eines EIGENEN Siedlungs-Wappens (Cap 'review'). Nimmt ein Rasterbild entgegen,
// validiert per finfo-MIME + Größe, legt es unter /uploads/wappen/own/ ab und setzt
// properties.coat = {url, source:'own'} am Orts-Feature (Vorrang vor Wiki-Wappen). SVG ist
// bewusst NICHT erlaubt (XSS-Risiko bei eigenen Uploads).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/settlements.php';

const AVESMAPS_SETTLEMENT_COAT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const AVESMAPS_SETTLEMENT_COAT_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];

try {
    $config = avesmapsLoadApiConfig(__DIR__);
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf keine Wappen hochladen.']);
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur POST ist erlaubt.']);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $publicId = trim((string) ($_POST['public_id'] ?? ''));
    if ($publicId === '') {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'public_id fehlt.']);
    }

    $file = $_FILES['coat'] ?? null;
    if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Keine Datei empfangen.']);
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > AVESMAPS_SETTLEMENT_COAT_MAX_BYTES) {
        avesmapsJsonResponse(413, ['ok' => false, 'error' => 'Datei fehlt oder ist zu groß (max 2 MB).']);
    }

    $tmp = (string) $file['tmp_name'];
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    if (!isset(AVESMAPS_SETTLEMENT_COAT_TYPES[$mime])) {
        avesmapsJsonResponse(415, ['ok' => false, 'error' => 'Nur PNG, JPG, WebP oder GIF erlaubt.']);
    }
    $ext = AVESMAPS_SETTLEMENT_COAT_TYPES[$mime];

    // Feature muss existieren (lädt zugleich die Properties).
    $feature = avesmapsWikiSettlementLoadFeature($pdo, $publicId);

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen/own';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Upload-Verzeichnis nicht verfügbar.']);
    }

    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'ort';
    }
    $filename = $safeId . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
    $target = $dir . '/' . $filename;
    if (!@move_uploaded_file($tmp, $target)) {
        avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Datei konnte nicht gespeichert werden.']);
    }
    @chmod($target, 0644);
    $url = '/uploads/wappen/own/' . $filename;

    $props = $feature['props'];
    $previous = $props['coat'] ?? null;
    $props['coat'] = ['url' => $url, 'source' => 'own', 'license_status' => 'own'];

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id')
        ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $feature['id']]);
    avesmapsWikiSyncNextMapRevision($pdo); // Map-Cache invalidieren

    // Vorheriges eigenes Bild best effort aufräumen.
    if (is_array($previous) && ($previous['source'] ?? '') === 'own') {
        $prevUrl = (string) ($previous['url'] ?? '');
        if (str_starts_with($prevUrl, '/uploads/wappen/own/')) {
            @unlink($docroot . $prevUrl);
        }
    }

    avesmapsJsonResponse(200, ['ok' => true, 'coat' => $props['coat'], 'revision' => $revision]);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => $error->getMessage()]);
}
