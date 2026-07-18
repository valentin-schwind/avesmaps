<?php

declare(strict_types=1);

// Authed adventure-cover endpoint (cap 'edit'). Two form-POST modes, both keyed by public_id:
//   - UPLOAD  (a file field `cover` is present): validate per finfo-MIME + size, downscale via the SAME
//     shared function the Wappen use (avesmapsWikiSyncMonitorDownscaleCoatBytes), store under
//     /uploads/questcovers/own/, and set adventure.cover_url with field origin 'manual' (an override the
//     wiki sync never touches). SVG is deliberately rejected (XSS risk on own uploads).
//   - REFETCH (mode=refetch, no file): re-pull the adventure's WIKI cover from its staging cover_file
//     into /uploads/questcovers/ (avesmapsAdventureSaveCoverLocal), setting cover_url with origin 'wiki'.
// Modeled on api/edit/wiki/settlement-coat-upload.php. NO public_domain gate -- adventure covers ride the
// Ulisses/F-Shop permission (the reference is enforced at the display layer, not here).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';                     // AVESMAPS_WIKI_PAGE_BASE_URL + wiki sync constants
require_once __DIR__ . '/../../_internal/wiki/locations-helpers.php';        // avesmapsWikiSyncNextMapRevision (NOT in sync.php: it hangs off locations.php, which this endpoint does not load) -- the refetch path calls it
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-identity.php';    // HttpGetBinary / ImageExtension / DownscaleCoatBytes
require_once __DIR__ . '/../../_internal/wiki/territories-tree.php';         // avesmapsWikiSyncNormalizeWikiTreeText (called transitively by PoliticalTerritoryFilePathUrl)
require_once __DIR__ . '/../../_internal/wiki/territories-parsing.php';      // avesmapsWikiSyncPoliticalTerritoryFilePathUrl (cover file -> wiki image URL)
require_once __DIR__ . '/../../_internal/app/adventures.php';                // avesmapsSetAdventureCoverUrl + ensure tables
require_once __DIR__ . '/../../_internal/wiki/adventure-sync.php';           // avesmapsAdventureSaveCoverLocal + staging ensure

const AVESMAPS_ADVENTURE_COVER_MAX_BYTES = 3 * 1024 * 1024; // 3 MB (covers are larger than coats)
const AVESMAPS_ADVENTURE_COVER_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Cover setzen.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $publicId = trim((string) ($_POST['public_id'] ?? ''));
    if ($publicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'public_id fehlt.');
    }
    $mode = trim((string) ($_POST['mode'] ?? ''));
    $file = $_FILES['cover'] ?? null;
    $hasFile = is_array($file) && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK;

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');

    // ------------------------------------------------------------------- REFETCH ---
    if ($mode === 'refetch' && !$hasFile) {
        avesmapsAdventuresEnsureTables($pdo);
        avesmapsEnsureAdventureStagingTables($pdo);
        $sel = $pdo->prepare('SELECT wiki_key FROM adventure WHERE public_id = :pid LIMIT 1');
        $sel->execute(['pid' => $publicId]);
        $wikiKey = trim((string) ($sel->fetchColumn() ?: ''));
        if ($wikiKey === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Dieses Abenteuer hat keinen Wiki-Eintrag — es gibt kein Wiki-Cover zum Ziehen.');
        }
        $catalog = $pdo->prepare('SELECT cover_file FROM wiki_adventure_catalog WHERE wiki_key = :wk LIMIT 1');
        $catalog->execute(['wk' => $wikiKey]);
        $coverFile = trim((string) ($catalog->fetchColumn() ?: ''));
        if ($coverFile === '') {
            avesmapsErrorResponse(404, 'not_found', 'Kein Wiki-Cover im Staging. Zuerst „Dump holen" + „Abenteuer syncen".');
        }
        $localUrl = avesmapsAdventureSaveCoverLocal($wikiKey, $coverFile);
        if ($localUrl === '') {
            avesmapsErrorResponse(502, 'fetch_failed', 'Das Wiki-Cover konnte nicht geladen werden.');
        }
        $result = avesmapsSetAdventureCoverUrl($pdo, $publicId, $localUrl, 'wiki');
        // Stamp cover_source so the batch reconcile treats this cover as up to date (no re-fetch).
        $pdo->prepare('UPDATE adventure SET cover_source = :cs WHERE public_id = :pid')
            ->execute(['cs' => mb_substr($coverFile, 0, 300, 'UTF-8'), 'pid' => $publicId]);
        avesmapsWikiSyncNextMapRevision($pdo); // covers travel in the map-features payload -> invalidate
        avesmapsJsonResponse(200, ['ok' => true] + $result);
    }

    // -------------------------------------------------------------------- UPLOAD ---
    if (!$hasFile || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        avesmapsErrorResponse(400, 'invalid_request', 'Keine Datei empfangen.');
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > AVESMAPS_ADVENTURE_COVER_MAX_BYTES) {
        avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 3 MB).');
    }
    $tmp = (string) $file['tmp_name'];
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    if (!isset(AVESMAPS_ADVENTURE_COVER_TYPES[$mime])) {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG, WebP oder GIF erlaubt.');
    }
    $ext = AVESMAPS_ADVENTURE_COVER_TYPES[$mime];

    // Adventure must exist (also gives us the previous cover for cleanup).
    $prev = $pdo->prepare('SELECT id, cover_url FROM adventure WHERE public_id = :pid LIMIT 1');
    $prev->execute(['pid' => $publicId]);
    $prevRow = $prev->fetch(PDO::FETCH_ASSOC);
    if ($prevRow === false) {
        avesmapsErrorResponse(404, 'not_found', 'Das Abenteuer wurde nicht gefunden.');
    }

    $dir = $docroot . '/uploads/questcovers/own';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
    }
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'abenteuer';
    }
    $filename = $safeId . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
    $target = $dir . '/' . $filename;
    if (!@move_uploaded_file($tmp, $target)) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);

    // Downscale via the SAME shared function the Wappen use (longest edge bounded; format + transparency
    // preserved; GIF passes through; never fails -> original kept on doubt).
    $originalBytes = (string) @file_get_contents($target);
    if ($originalBytes !== '') {
        $scaledBytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($originalBytes, $ext, AVESMAPS_ADVENTURE_COVER_MAX_EDGE);
        if ($scaledBytes !== '' && $scaledBytes !== $originalBytes) {
            @file_put_contents($target, $scaledBytes);
        }
    }

    $url = '/uploads/questcovers/own/' . $filename;
    $result = avesmapsSetAdventureCoverUrl($pdo, $publicId, $url, 'manual');
    // A manual upload supersedes any wiki-fetched cover: clear cover_source so a later reconcile does not
    // "restore" the wiki cover (the field-origin 'manual' already protects it, this just keeps state clean).
    $pdo->prepare('UPDATE adventure SET cover_source = NULL WHERE public_id = :pid')->execute(['pid' => $publicId]);

    // Clean up a previous OWN upload (best effort; never touch a wiki-fetched /uploads/questcovers/<slug>).
    // cover_url is an EDITOR-writable field (a free text input in the editor), so it is NOT trusted as a
    // filesystem path: reduce it to a basename inside the fixed own-dir and realpath-confine before unlink,
    // so a crafted "/uploads/questcovers/own/../../.." can never escape the directory (path traversal).
    $previousUrl = (string) ($prevRow['cover_url'] ?? '');
    if ($previousUrl !== $url && str_starts_with($previousUrl, '/uploads/questcovers/own/') && !str_contains($previousUrl, '..')) {
        $prevName = basename((string) parse_url($previousUrl, PHP_URL_PATH));
        $realDir = realpath($dir);
        $realCandidate = $prevName !== '' ? realpath($dir . '/' . $prevName) : false;
        if ($realCandidate !== false && $realDir !== false && str_starts_with($realCandidate, $realDir . DIRECTORY_SEPARATOR)) {
            @unlink($realCandidate);
        }
    }

    avesmapsWikiSyncNextMapRevision($pdo); // covers travel in the map-features payload -> invalidate
    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
