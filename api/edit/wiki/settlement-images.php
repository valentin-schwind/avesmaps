<?php

declare(strict_types=1);

// Siedlungs-Header-Bilder (Owner): Editoren laden bis zu 10 eigene Bilder je Siedlung hoch. Jedes wird
// crop-to-fill auf 16:9 (800x450) skaliert und als WebP (Fallback JPEG) unter /uploads/siedlungen/<safeId>/
// abgelegt; die geordnete URL-Liste liegt in properties.images am Orts-Feature. Eigene Bilder haben im
// Infopanel Vorrang vor der generischen Header-Grafik; mehrere werden dort als Lightbox durchblaettert.
//
// POST-Actions:
//   - Upload:  multipart, Feld "image" + "public_id"          -> haengt ein Bild an (max 10)
//   - Delete:  JSON { public_id, url }                         -> entfernt ein Bild + Datei
//   - Reorder: JSON { public_id, order: [url, ...] }           -> setzt die Reihenfolge
// Cap 'review' wie beim Siedlungs-Wappen-Upload. SVG bewusst NICHT erlaubt.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/settlements.php';

const AVESMAPS_SETTLEMENT_IMAGES_MAX = 10;
const AVESMAPS_SETTLEMENT_IMAGE_MAX_BYTES = 12 * 1024 * 1024; // 12 MB Rohupload
const AVESMAPS_SETTLEMENT_IMAGE_W = 800;
const AVESMAPS_SETTLEMENT_IMAGE_H = 450;
const AVESMAPS_SETTLEMENT_IMAGE_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
// Per-image licence (editor-only + public gate). unknown_other is NEVER shown in the frontend
// (map-features.php filters it out). Legacy plain-string images + new uploads default to ai_generated
// ("Von uns KI-generiert") per owner decision, so nothing already uploaded disappears.
const AVESMAPS_SETTLEMENT_IMAGE_LICENSES = ['public_domain', 'cc0', 'ai_generated', 'unknown_other'];
const AVESMAPS_SETTLEMENT_IMAGE_LICENSE_DEFAULT = 'ai_generated';
const AVESMAPS_SETTLEMENT_IMAGE_NOTE_MAX = 2000;

function avesmapsSettlementImageNormalizeLicense($value): string
{
    $v = is_string($value) ? trim($value) : '';
    return in_array($v, AVESMAPS_SETTLEMENT_IMAGE_LICENSES, true) ? $v : AVESMAPS_SETTLEMENT_IMAGE_LICENSE_DEFAULT;
}

function avesmapsSettlementImageNormalizeNote($value): string
{
    $note = trim((string) $value);
    if (mb_strlen($note) > AVESMAPS_SETTLEMENT_IMAGE_NOTE_MAX) {
        $note = mb_substr($note, 0, AVESMAPS_SETTLEMENT_IMAGE_NOTE_MAX);
    }
    return $note;
}

// Crop-to-fill auf 800x450, Ausgabe als WebP (Fallback JPEG, falls GD kein WebP kann). Gibt [bytes, ext]
// oder null. Deckt die Zielbox komplett und schneidet den Ueberstand mittig weg (wie CSS object-fit:cover).
function avesmapsSettlementImageScale(string $srcPath, string $mime): ?array
{
    $creators = [
        'image/jpeg' => 'imagecreatefromjpeg',
        'image/png' => 'imagecreatefrompng',
        'image/webp' => 'imagecreatefromwebp',
        'image/gif' => 'imagecreatefromgif',
    ];
    if (!isset($creators[$mime]) || !function_exists($creators[$mime])) {
        return null;
    }
    $src = @($creators[$mime])($srcPath);
    if (!$src) {
        return null;
    }
    $sw = imagesx($src);
    $sh = imagesy($src);
    if ($sw < 1 || $sh < 1) {
        imagedestroy($src);
        return null;
    }
    $tw = AVESMAPS_SETTLEMENT_IMAGE_W;
    $th = AVESMAPS_SETTLEMENT_IMAGE_H;
    $scale = max($tw / $sw, $th / $sh);
    $nw = (int) round($sw * $scale);
    $nh = (int) round($sh * $scale);
    $dst = imagecreatetruecolor($tw, $th);
    imagecopyresampled($dst, $src, (int) round(($tw - $nw) / 2), (int) round(($th - $nh) / 2), 0, 0, $nw, $nh, $sw, $sh);
    imagedestroy($src);

    ob_start();
    $ext = 'webp';
    if (!function_exists('imagewebp') || !@imagewebp($dst, null, 82)) {
        ob_end_clean();
        ob_start();
        $ext = 'jpg';
        @imagejpeg($dst, null, 86);
    }
    $bytes = (string) ob_get_clean();
    imagedestroy($dst);
    return $bytes !== '' ? [$bytes, $ext] : null;
}

// Normalisiert properties.images auf eine Liste von Objekten {url, license, note}. Legacy-Strings werden
// zu {url, license: DEFAULT (ai_generated), note: ''}; fremde/absolute URLs werden verworfen (nur eigener
// Upload-Pfad). Dedup nach URL. Reihenfolge bleibt erhalten.
function avesmapsSettlementImagesList(array $props): array
{
    $raw = $props['images'] ?? [];
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    $seen = [];
    foreach ($raw as $item) {
        $url = is_array($item) ? (string) ($item['url'] ?? '') : (string) $item;
        $url = trim($url);
        if ($url === '' || !str_starts_with($url, '/uploads/siedlungen/') || isset($seen[$url])) {
            continue;
        }
        $seen[$url] = true;
        $out[] = [
            'url' => $url,
            'license' => is_array($item) ? avesmapsSettlementImageNormalizeLicense($item['license'] ?? null) : AVESMAPS_SETTLEMENT_IMAGE_LICENSE_DEFAULT,
            'note' => is_array($item) ? avesmapsSettlementImageNormalizeNote($item['note'] ?? '') : '',
        ];
    }
    return $out;
}

// URL-Liste aus der Objekt-Liste (für in_array-Prüfungen bei delete/reorder/set_meta).
function avesmapsSettlementImageUrls(array $images): array
{
    return array_map(static fn (array $im): string => (string) ($im['url'] ?? ''), $images);
}

// Schreibt die neue Bilderliste ins Feature + zieht eine Map-Revision (Cache-Invalidierung + Audit).
function avesmapsSettlementImagesPersist(PDO $pdo, array $feature, array $images, array $user): int
{
    $props = $feature['props'];
    $auditBefore = avesmapsWikiSettlementAuditRow($pdo, (int) $feature['id']);
    if ($images) {
        $props['images'] = array_values($images);
    } else {
        unset($props['images']);
    }
    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id')
        ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $feature['id']]);
    avesmapsWikiSettlementAuditAssignment($pdo, $auditBefore, $props, $revision, (int) ($user['id'] ?? 0));
    avesmapsWikiSyncNextMapRevision($pdo); // Map-Cache invalidieren
    return $revision;
}

try {
    $config = avesmapsLoadApiConfig(__DIR__);
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Bilder verwalten.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $isUpload = isset($_FILES['image']);
    $body = $isUpload ? [] : (avesmapsReadJsonRequest() ?? []);
    $publicId = trim((string) ($isUpload ? ($_POST['public_id'] ?? '') : ($body['public_id'] ?? '')));
    if ($publicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'public_id fehlt.');
    }

    $feature = avesmapsWikiSettlementLoadFeature($pdo, $publicId); // wirft, wenn nicht vorhanden
    $images = avesmapsSettlementImagesList($feature['props']);

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'ort';
    }

    // ----- UPLOAD -----
    if ($isUpload) {
        if (count($images) >= AVESMAPS_SETTLEMENT_IMAGES_MAX) {
            avesmapsErrorResponse(409, 'limit_reached', 'Maximal ' . AVESMAPS_SETTLEMENT_IMAGES_MAX . ' Bilder je Siedlung.');
        }
        $file = $_FILES['image'];
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
            avesmapsErrorResponse(400, 'invalid_request', 'Keine Datei empfangen.');
        }
        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > AVESMAPS_SETTLEMENT_IMAGE_MAX_BYTES) {
            avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 12 MB).');
        }
        $tmp = (string) $file['tmp_name'];
        $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!isset(AVESMAPS_SETTLEMENT_IMAGE_TYPES[$mime])) {
            avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG, WebP oder GIF erlaubt.');
        }

        $scaled = avesmapsSettlementImageScale($tmp, $mime);
        if ($scaled === null) {
            avesmapsErrorResponse(500, 'server_error', 'Bild konnte nicht verarbeitet werden.');
        }
        [$bytes, $ext] = $scaled;

        $dir = $docroot . '/uploads/siedlungen/' . $safeId;
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
        }
        $filename = bin2hex(random_bytes(8)) . '.' . $ext;
        $target = $dir . '/' . $filename;
        if (@file_put_contents($target, $bytes) === false) {
            avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
        }
        @chmod($target, 0644);

        $url = '/uploads/siedlungen/' . $safeId . '/' . $filename;
        $images[] = ['url' => $url, 'license' => AVESMAPS_SETTLEMENT_IMAGE_LICENSE_DEFAULT, 'note' => ''];
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $images, $user);
        avesmapsJsonResponse(200, ['ok' => true, 'url' => $url, 'images' => $images, 'revision' => $revision]);
    }

    // ----- DELETE -----
    $action = (string) ($body['action'] ?? '');
    if ($action === 'delete') {
        $url = trim((string) ($body['url'] ?? ''));
        if ($url === '' || !in_array($url, avesmapsSettlementImageUrls($images), true)) {
            avesmapsErrorResponse(404, 'not_found', 'Bild nicht gefunden.');
        }
        $images = array_values(array_filter($images, static fn (array $im): bool => ($im['url'] ?? '') !== $url));
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $images, $user);
        // Datei best effort loeschen (nur im eigenen Upload-Pfad).
        if (str_starts_with($url, '/uploads/siedlungen/')) {
            @unlink($docroot . $url);
        }
        avesmapsJsonResponse(200, ['ok' => true, 'images' => $images, 'revision' => $revision]);
    }

    // ----- REORDER ----- (order = URL-Liste; Objekte werden entlang der URLs neu sortiert)
    if ($action === 'reorder') {
        $order = $body['order'] ?? [];
        if (!is_array($order)) {
            avesmapsErrorResponse(400, 'invalid_request', 'order[] fehlt.');
        }
        $byUrl = [];
        foreach ($images as $im) {
            $byUrl[(string) ($im['url'] ?? '')] = $im;
        }
        $wanted = [];
        $used = [];
        foreach ($order as $u) {
            $u = trim((string) $u);
            if (isset($byUrl[$u]) && !isset($used[$u])) {
                $used[$u] = true;
                $wanted[] = $byUrl[$u];
            }
        }
        // Nicht genannte Bilder hinten anhaengen -> nie stiller Verlust.
        foreach ($images as $im) {
            $u = (string) ($im['url'] ?? '');
            if (!isset($used[$u])) {
                $used[$u] = true;
                $wanted[] = $im;
            }
        }
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $wanted, $user);
        avesmapsJsonResponse(200, ['ok' => true, 'images' => $wanted, 'revision' => $revision]);
    }

    // ----- SET_META ----- (Lizenz + Kommentar/Prompt eines Bildes setzen)
    if ($action === 'set_meta') {
        $url = trim((string) ($body['url'] ?? ''));
        if ($url === '' || !in_array($url, avesmapsSettlementImageUrls($images), true)) {
            avesmapsErrorResponse(404, 'not_found', 'Bild nicht gefunden.');
        }
        $license = avesmapsSettlementImageNormalizeLicense($body['license'] ?? null);
        $note = avesmapsSettlementImageNormalizeNote($body['note'] ?? '');
        foreach ($images as &$im) {
            if ((string) ($im['url'] ?? '') === $url) {
                $im['license'] = $license;
                $im['note'] = $note;
                break;
            }
        }
        unset($im);
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $images, $user);
        avesmapsJsonResponse(200, ['ok' => true, 'images' => $images, 'revision' => $revision]);
    }

    avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion.');
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
