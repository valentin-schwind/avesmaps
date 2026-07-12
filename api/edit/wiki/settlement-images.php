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

// Normalisiert properties.images auf eine flache Liste von /uploads/siedlungen/-URLs (Strings). Aeltere
// Objekt-Form {url:...} wird mitgenommen; fremde/absolute URLs werden verworfen (nur eigener Upload-Pfad).
function avesmapsSettlementImagesList(array $props): array
{
    $raw = $props['images'] ?? [];
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $item) {
        $url = is_array($item) ? (string) ($item['url'] ?? '') : (string) $item;
        $url = trim($url);
        if ($url !== '' && str_starts_with($url, '/uploads/siedlungen/') && !in_array($url, $out, true)) {
            $out[] = $url;
        }
    }
    return $out;
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
        $images[] = $url;
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $images, $user);
        avesmapsJsonResponse(200, ['ok' => true, 'url' => $url, 'images' => $images, 'revision' => $revision]);
    }

    // ----- DELETE -----
    $action = (string) ($body['action'] ?? '');
    if ($action === 'delete') {
        $url = trim((string) ($body['url'] ?? ''));
        if ($url === '' || !in_array($url, $images, true)) {
            avesmapsErrorResponse(404, 'not_found', 'Bild nicht gefunden.');
        }
        $images = array_values(array_filter($images, static fn ($u) => $u !== $url));
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $images, $user);
        // Datei best effort loeschen (nur im eigenen Upload-Pfad).
        if (str_starts_with($url, '/uploads/siedlungen/')) {
            @unlink($docroot . $url);
        }
        avesmapsJsonResponse(200, ['ok' => true, 'images' => $images, 'revision' => $revision]);
    }

    // ----- REORDER -----
    if ($action === 'reorder') {
        $order = $body['order'] ?? [];
        if (!is_array($order)) {
            avesmapsErrorResponse(400, 'invalid_request', 'order[] fehlt.');
        }
        $wanted = [];
        foreach ($order as $u) {
            $u = trim((string) $u);
            if (in_array($u, $images, true) && !in_array($u, $wanted, true)) {
                $wanted[] = $u;
            }
        }
        // Nicht genannte Bilder hinten anhaengen -> nie stiller Verlust.
        foreach ($images as $u) {
            if (!in_array($u, $wanted, true)) {
                $wanted[] = $u;
            }
        }
        $revision = avesmapsSettlementImagesPersist($pdo, $feature, $wanted, $user);
        avesmapsJsonResponse(200, ['ok' => true, 'images' => $wanted, 'revision' => $revision]);
    }

    avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion.');
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
