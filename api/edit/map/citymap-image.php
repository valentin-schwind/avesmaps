<?php

declare(strict_types=1);

// Authed citymap-image endpoint (cap 'edit', Spec §3.4). Form-POST, keyed by public_id + slot:
//   - UPLOAD (a file field `image` is present): validate per finfo-MIME + size, bound the longest edge
//     via the SAME shared function the Wappen and the adventure covers use
//     (avesmapsWikiSyncMonitorDownscaleCoatBytes), store under /uploads/kartensammlungen/<safeId>/, and
//     write citymap.<slot>_local_url. SVG is deliberately rejected (XSS risk on own uploads).
//   - DELETE (mode=delete, no file): clear the slot and unlink our copy.
//
// TWO SLOTS with separate rules: 'thumb' (the preview, longest edge 400px) and 'map' (the full map,
// longest edge 4000px). They also carry SEPARATE LICENCES (owner decision, §3.3) -- a source may have a
// free cover and a protected map -- which is why nothing here is shared between them beyond the plumbing.
//
// NO server-side fetch of an external image, ever (Spec §3.4/§6). The adventure "Wiki-Cover neu ziehen"
// mode only exists because that URL is DERIVED from a wiki filename and never comes from the client;
// fetching an arbitrary citymap URL the editor typed would be SSRF. Upload only -- hence no `refetch`
// branch here.
//
// The licence is NOT enforced on upload: the editor's own rule is to show the upload button only for a
// free licence (§3.3), but the authoritative gate is the READ (avesmapsCitymapPublicThumbUrl /
// ...MapLocalUrl in the citymap library). Refusing here would only break the upload-then-classify order
// without adding safety -- a stored file that may not be shown simply never leaves the box.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-identity.php'; // avesmapsWikiSyncMonitorDownscaleCoatBytes
require_once __DIR__ . '/../../_internal/app/citymaps.php';               // avesmapsSetCitymapImage + ensure tables

const AVESMAPS_CITYMAP_IMAGE_MAX_BYTES = 12 * 1024 * 1024; // 12 MB raw upload (Spec §3.4)
const AVESMAPS_CITYMAP_IMAGE_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
// Longest edge per slot (Spec §3.4). A thumb only ever fills a strip card; a map is meant to be read.
const AVESMAPS_CITYMAP_THUMB_MAX_EDGE = 400;
const AVESMAPS_CITYMAP_MAP_MAX_EDGE = 4000;
const AVESMAPS_CITYMAP_UPLOAD_DIR = '/uploads/kartensammlungen';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Kartenbilder setzen.');
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
    $slot = trim((string) ($_POST['slot'] ?? ''));
    if ($slot !== 'thumb' && $slot !== 'map') {
        avesmapsErrorResponse(400, 'invalid_request', 'slot muss thumb oder map sein.');
    }
    $mode = trim((string) ($_POST['mode'] ?? ''));
    $file = $_FILES['image'] ?? null;
    $hasFile = is_array($file) && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK;

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'karte';
    }
    $dir = $docroot . AVESMAPS_CITYMAP_UPLOAD_DIR . '/' . $safeId;
    $column = $slot === 'thumb' ? 'thumb_local_url' : 'map_local_url';

    // The map must exist, and we need its current file for cleanup. Reading the column directly (rather
    // than via the detail read) keeps this endpoint independent of the editor payload shape.
    avesmapsCitymapsEnsureTables($pdo);
    $previous = $pdo->prepare('SELECT ' . $column . ' FROM citymap WHERE public_id = :pid LIMIT 1');
    $previous->execute(['pid' => $publicId]);
    $previousRaw = $previous->fetchColumn();
    if ($previousRaw === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Karte wurde nicht gefunden.');
    }
    $previousUrl = (string) ($previousRaw ?? '');

    // Remove OUR copy of a previous upload. Realpath-confined even though these columns are not
    // editor-writable (only this endpoint ever writes them): reduce to a basename inside the fixed
    // directory and confine before unlink, so no stored value can ever escape it (path traversal).
    $unlinkPrevious = static function (string $url, string $dir, string $keepUrl) use ($safeId): void {
        $prefix = AVESMAPS_CITYMAP_UPLOAD_DIR . '/' . $safeId . '/';
        if ($url === '' || $url === $keepUrl || !str_starts_with($url, $prefix) || str_contains($url, '..')) {
            return;
        }
        $name = basename((string) parse_url($url, PHP_URL_PATH));
        $realDir = realpath($dir);
        $realCandidate = $name !== '' ? realpath($dir . '/' . $name) : false;
        if ($realCandidate !== false && $realDir !== false && str_starts_with($realCandidate, $realDir . DIRECTORY_SEPARATOR)) {
            @unlink($realCandidate);
        }
    };

    // --------------------------------------------------------------------- DELETE ---
    if ($mode === 'delete' && !$hasFile) {
        $result = avesmapsSetCitymapImage($pdo, $publicId, $slot, null);
        $unlinkPrevious($previousUrl, $dir, '');
        avesmapsJsonResponse(200, ['ok' => true] + $result);
    }

    // --------------------------------------------------------------------- UPLOAD ---
    if (!$hasFile || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        avesmapsErrorResponse(400, 'invalid_request', 'Keine Datei empfangen.');
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > AVESMAPS_CITYMAP_IMAGE_MAX_BYTES) {
        avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 12 MB).');
    }
    $tmp = (string) $file['tmp_name'];
    // finfo sniffs the real bytes -- $_FILES['type'] is client-supplied and means nothing.
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    if (!isset(AVESMAPS_CITYMAP_IMAGE_TYPES[$mime])) {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG, WebP oder GIF erlaubt.');
    }
    $ext = AVESMAPS_CITYMAP_IMAGE_TYPES[$mime];

    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
    }
    $filename = $slot . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    $target = $dir . '/' . $filename;
    if (!@move_uploaded_file($tmp, $target)) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);

    // Bound the longest edge via the shared downscaler (format + transparency preserved; GIF passes
    // through; never fails -> original kept on doubt). Same call the adventure covers make.
    $maxEdge = $slot === 'thumb' ? AVESMAPS_CITYMAP_THUMB_MAX_EDGE : AVESMAPS_CITYMAP_MAP_MAX_EDGE;
    $originalBytes = (string) @file_get_contents($target);
    if ($originalBytes !== '') {
        $scaledBytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($originalBytes, $ext, $maxEdge);
        if ($scaledBytes !== '' && $scaledBytes !== $originalBytes) {
            @file_put_contents($target, $scaledBytes);
        }
    }

    // Spec §3.4 side effect: GD gives us the dimensions, so width_px/height_px fill themselves. Measured
    // on the STORED file, not the original -- it describes the artifact we actually serve, which for an
    // oversized upload is the 4000px-bounded copy rather than the raw original.
    $width = null;
    $height = null;
    if ($slot === 'map') {
        $dimensions = @getimagesize($target);
        if (is_array($dimensions) && (int) ($dimensions[0] ?? 0) > 0) {
            $width = (int) $dimensions[0];
            $height = (int) $dimensions[1];
        }
    }

    $url = AVESMAPS_CITYMAP_UPLOAD_DIR . '/' . $safeId . '/' . $filename;
    $result = avesmapsSetCitymapImage($pdo, $publicId, $slot, $url, $width, $height);
    $unlinkPrevious($previousUrl, $dir, $url);

    // No avesmapsNextMapRevision() here, unlike the adventure covers: citymap images do NOT travel in the
    // map-features payload (Spec §6) -- they ride api/app/citymaps.php -- so there is no ETag to bust and
    // no reason to invalidate 14 MB for every client.
    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
