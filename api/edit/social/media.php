<?php

declare(strict_types=1);

// Upload for the social hub (Entwurf §5). Form-POST with a file field `media`.
//
// 🔴 THE RIGHTS GATE RUNS BEFORE A SINGLE BYTE REACHES THE DISK, exactly as in
// api/edit/map/citymap-image.php. A hidden button is not enforcement: anyone holding the capability
// can POST here directly. And the stake is higher than for a city map -- what leaves here stands
// publicly under the project's name and cannot be recalled. A scan from a DSA book would not be an
// inaccuracy on a map, it would be a copyright infringement under the editors' own name.
//
// NO server-side fetch of a remote picture, ever: that would turn this endpoint into a
// general-purpose fetcher for anyone with a session (SSRF). Upload only, hence no `url` parameter.
//
// Files land in /uploads/social/, deliberately NOT in the repository -- it would grow with every
// post. That directory has no .htaccess and must never get one: Meta LOADS the picture from its
// public URL, it cannot be attached to the request.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/media.php';

// Two answers, both of which the editor can honestly give (Entwurf §5). Anything else is refused
// rather than guessed -- normalising an unknown value to "own work" would be the project claiming
// authorship of something nobody vouched for.
const AVESMAPS_SOCIAL_LICENSES = ['own_work', 'free_license'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Medien hochladen.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('social');

    // ---- THE RIGHTS GATE, before anything is read or stored ------------------------------------
    $license = trim((string) ($_POST['license'] ?? ''));
    if (!in_array($license, AVESMAPS_SOCIAL_LICENSES, true)) {
        avesmapsErrorResponse(400, 'invalid_request',
            'Bitte Herkunft und Rechte angeben: eigenes Werk oder freie Lizenz.');
    }
    $source = trim((string) ($_POST['source'] ?? ''));
    if ($license === 'free_license' && $source === '') {
        // "Free licence" without a source is an unverifiable claim. Naming the source IS the value of
        // that option; without the name it is indistinguishable from "I found it somewhere".
        avesmapsErrorResponse(400, 'invalid_request',
            'Bei freier Lizenz muss die Quelle angegeben werden.');
    }

    $file = $_FILES['media'] ?? null;
    if (!is_array($file)
        || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
        || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        avesmapsErrorResponse(400, 'invalid_request', 'Keine Datei empfangen.');
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > AVESMAPS_SOCIAL_MEDIA_MAX_BYTES) {
        avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 12 MB).');
    }

    $tmp = (string) $file['tmp_name'];
    // finfo sniffs the REAL bytes; $_FILES['type'] is client-supplied and means nothing. SVG is not
    // in the whitelist and must not be added -- an SVG we host is script we host.
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    if (!isset(AVESMAPS_SOCIAL_MEDIA_TYPES[$mime])) {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG oder WebP erlaubt.');
    }

    $raw = (string) @file_get_contents($tmp);
    $encoded = avesmapsSocialEncodeImageBytes($raw);
    if ($encoded['bytes'] === '') {
        avesmapsErrorResponse(415, 'unsupported_media_type',
            'Das Bild konnte nicht gelesen werden.');
    }

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . AVESMAPS_SOCIAL_UPLOAD_DIR;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
    }

    // A random name, never the uploaded one: an editor's filename is neither unique nor safe as a
    // path segment, and the extension comes from the ENCODER, not from what was sent.
    $filename = 'post-' . bin2hex(random_bytes(8)) . '.' . $encoded['ext'];
    $target = $dir . '/' . $filename;
    // Written rather than moved, because the bytes went through the encoder. The upload guarantee
    // still holds: is_uploaded_file gated $tmp above and finfo read the real MIME off the bytes.
    if (@file_put_contents($target, $encoded['bytes']) === false) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'url' => AVESMAPS_SOCIAL_UPLOAD_DIR . '/' . $filename,
        'width' => $encoded['width'],
        'height' => $encoded['height'],
        'cropped' => $encoded['cropped'],
        'bytes' => strlen($encoded['bytes']),
        'license' => $license,
        'source' => $source,
        // What the hub shows as "✓ Passt für …" BEFORE publishing -- the whole reason this endpoint
        // reports the size back instead of just a URL.
        'fits' => avesmapsSocialMediaFitsChannels($encoded['width'], $encoded['height']),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
