<?php

declare(strict_types=1);

// Authed Upload eines EIGENEN Siedlungs-Wappens (Cap 'review'). Nimmt ein Rasterbild entgegen,
// validiert per finfo-MIME + Größe, verkleinert es über DIESELBE geteilte Downscale-Funktion wie
// die Territorien-Wappen (avesmapsWikiSyncMonitorDownscaleCoatBytes: längste Kante <= 512px), legt
// es unter /uploads/wappen/own/ ab und setzt properties.coat = {url, source:'own', license_status,
// author, note, uploaded_by, uploaded_at} am Orts-Feature (Vorrang vor Wiki-Wappen).
//
// 🔴 SVG IST SEIT 23.08.2026 ERLAUBT -- hier stand vorher "bewusst NICHT erlaubt (XSS-Risiko bei
// eigenen Uploads)", und diese Entscheidung ist UMGEDREHT worden, nicht uebersehen. Drei Gruende:
//   1. Das Risiko bestand ohnehin: der TERRITORIEN-Upload nimmt SVG seit jeher an, und beide
//      landen im selben Verzeichnis. Eine Sperre, die nur eine von zwei Tueren zuhaelt, schuetzt
//      nichts -- sie macht nur die Dialoge unterschiedlich.
//   2. Seit 23.08.2026 liefert uploads/wappen/.htaccess fuer jedes .svg
//      `Content-Security-Policy: default-src 'none'; sandbox` + nosniff -- live gemessen. Ein
//      direkt aufgerufenes SVG kann damit kein Skript mehr ausfuehren.
//   3. Owner-Auftrag 23.08.2026: die beiden Upload-Dialoge sollen gleich sein. Und die
//      Zwergenreich-Wappen SIND SVG.
// ⚠️ Faellt die .htaccess je weg, faellt Grund 2 mit -- dann gehoert das zurueckgedreht, und zwar
// an BEIDEN Uploads. Der Test wappen-upload-gleichstand-test.php haelt die Kopplung fest.
//
// 🔴 Grenzen und Formate sind seither identisch mit dem Territorien-Upload: 5 MB,
// PNG/JPG/SVG/GIF/WEBP, Datei ODER Bild-URL.
//
// 🔴 Phase 4 (Lizenz-Vereinheitlichung, Aufgabe 4): bis hierher stand license_status fest auf 'own'.
// Der Dialog schickt jetzt Lizenz/Urheber/Kommentar mit; source bleibt UNANGETASTET 'own' -- es sagt,
// WOHER das Bild kam, nicht unter welcher Lizenz, und avesmapsWikiSettlementBulkRecordCoats
// (settlements.php:408) entscheidet an source, ob ein Wiki-Abgleich ueberschreiben darf.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/settlements.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-identity.php'; // shared avesmapsWikiSyncMonitorDownscaleCoatBytes
require_once __DIR__ . '/../../_internal/media-license.php'; // avesmapsMediaLicenseNormalize -- der EINE Katalog (AGENTS §5)
// 💣 avesmapsLinkCheckFetchBody -- der EINZIGE ausgehende Abruf im Haus mit SSRF-Riegel.
// Ohne dieses require waere der Bild-URL-Zweig ein Fatal Error, und ein Fatal antwortet mit
// LEEREM Rumpf ("Unexpected end of JSON input") -- das sieht aus wie ein Netzfehler.
require_once __DIR__ . '/../../_internal/linkcheck/probe.php';

const AVESMAPS_SETTLEMENT_COAT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB -- wie der Territorien-Upload
const AVESMAPS_SETTLEMENT_COAT_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
    // Siehe Kopfkommentar: erlaubt, seit die CSP fuer /uploads/wappen greift.
    'image/svg+xml' => 'svg',
];
// VARCHAR(190)-Konvention wie die uebrigen vier Lizenz-Flaechen (z. B. AVESMAPS_SETTLEMENT_IMAGE_AUTHOR_MAX
// in settlement-images.php) -- hier ohne eigene Spalte, weil der Wert im properties_json steht, aber die
// Grenze bleibt dieselbe.
const AVESMAPS_SETTLEMENT_COAT_AUTHOR_MAX = 190;
const AVESMAPS_SETTLEMENT_COAT_NOTE_MAX = 2000;

function avesmapsSettlementCoatNormalizeAuthor($value): string
{
    $author = trim((string) $value);
    if (mb_strlen($author) > AVESMAPS_SETTLEMENT_COAT_AUTHOR_MAX) {
        $author = mb_substr($author, 0, AVESMAPS_SETTLEMENT_COAT_AUTHOR_MAX);
    }
    return $author;
}

function avesmapsSettlementCoatNormalizeNote($value): string
{
    $note = trim((string) $value);
    if (mb_strlen($note) > AVESMAPS_SETTLEMENT_COAT_NOTE_MAX) {
        $note = mb_substr($note, 0, AVESMAPS_SETTLEMENT_COAT_NOTE_MAX);
    }
    return $note;
}

try {
    $config = avesmapsLoadApiConfig(__DIR__);
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Wappen hochladen.');
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

    $publicId = trim((string) ($_POST['public_id'] ?? ''));
    if ($publicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'public_id fehlt.');
    }

    // DATEI ODER BILD-URL -- wie beim Territorien-Upload (Owner 23.08.2026: die Dialoge sollen
    // gleich sein). Die Bytes landen in $coatBytes, alles danach ist fuer beide Wege identisch.
    $file = $_FILES['coat'] ?? null;
    $sourceUrl = trim((string) ($_POST['coat_url'] ?? ''));
    $coatBytes = null;

    if (is_array($file) && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK
        && is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > AVESMAPS_SETTLEMENT_COAT_MAX_BYTES) {
            avesmapsErrorResponse(413, 'payload_too_large', 'Datei fehlt oder ist zu groß (max 5 MB).');
        }
        $coatBytes = (string) @file_get_contents((string) $file['tmp_name']);
    } elseif ($sourceUrl !== '') {
        // 🔴 avesmapsLinkCheckFetchBody, NICHT avesmapsWikiSyncMonitorHttpGetBinary. Der eine hat
        // einen SSRF-Riegel (Schema-Whitelist, private/loopback/Metadaten-Bereiche, und er prueft
        // nach dem Abruf die Peer-IP gegen DNS-Rebinding), der andere hat keinen. Die URL kommt
        // aus einem Eingabefeld -- ohne Riegel liesse sich der Server damit auf 169.254.169.254
        // schicken. ⚠️ Der Territorien-Upload nimmt hier noch den ungeschuetzten Weg; das ist ein
        // Altbestand, kein Vorbild.
        // 🔴 In avesmapsWikiAusdruecklicherAbruf gewickelt: der Datei-Riegel gilt der ANZEIGE,
        // nicht dem Editor, der eine Adresse eintippt und auf "Hochladen" drueckt.
        $geholt = avesmapsWikiAusdruecklicherAbruf(
            static fn (): array => avesmapsLinkCheckFetchBody(
                $sourceUrl,
                AVESMAPS_SETTLEMENT_COAT_MAX_BYTES,
                'image/*'
            )
        );
        if (($geholt['truncated'] ?? false) === true) {
            avesmapsErrorResponse(413, 'payload_too_large', 'Das Bild ist zu groß (max 5 MB).');
        }
        if (($geholt['ok'] ?? false) !== true || ($geholt['body'] ?? '') === '') {
            // ⚠️ Den Grund nennen: zeigt die Adresse aufs Wiki und wir sind dort gesperrt, ist das
            // KEIN Bedienfehler -- ohne diesen Satz sucht der Editor bei sich.
            avesmapsErrorResponse(502, 'fetch_failed', avesmapsWikiDateiIstWikiHost($sourceUrl)
                ? 'Wiki Aventurica hat die Anfrage verweigert (502). Bitte die Datei direkt hochladen.'
                : 'Das Bild konnte von dieser Adresse nicht geladen werden.');
        }
        $coatBytes = (string) $geholt['body'];
    } else {
        avesmapsErrorResponse(400, 'invalid_request', 'Bitte eine Bilddatei hochladen oder eine Bild-URL angeben.');
    }

    // 🔴 Der Typ kommt aus den BYTES, nie aus dem Dateinamen oder dem Content-Type der Gegenseite.
    // Beim Citymap-Autoget steht dieselbe Lehre: die Ulisses-CDN meldet "image/jpg", was gar kein
    // MIME-Typ ist -- wer dem Header glaubt, lehnt gueltige Bilder ab und nimmt ungueltige an.
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->buffer((string) $coatBytes);
    if (!isset(AVESMAPS_SETTLEMENT_COAT_TYPES[$mime])) {
        avesmapsErrorResponse(415, 'unsupported_media_type', 'Nur PNG, JPG, SVG, GIF oder WebP erlaubt.');
    }
    $ext = AVESMAPS_SETTLEMENT_COAT_TYPES[$mime];

    // Feature muss existieren (lädt zugleich die Properties).
    $feature = avesmapsWikiSettlementLoadFeature($pdo, $publicId);

    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen/own';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        avesmapsErrorResponse(500, 'server_error', 'Upload-Verzeichnis nicht verfügbar.');
    }

    $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId);
    if ($safeId === '' || $safeId === null) {
        $safeId = 'ort';
    }
    $filename = $safeId . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
    $target = $dir . '/' . $filename;
    // Beide Wege schreiben dieselben Bytes -- kein move_uploaded_file mehr, das nur den
    // Datei-Zweig bedienen wuerde.
    if (@file_put_contents($target, (string) $coatBytes) === false) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);

    // Verkleinern wie bei den Territorien-Wappen: dieselbe geteilte Funktion (längste Kante <= 512px,
    // Format + Transparenz bleiben, GIF/SVG unangetastet, fällt nie -> im Zweifel Original behalten).
    $originalBytes = (string) @file_get_contents($target);
    if ($originalBytes !== '') {
        $scaledBytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($originalBytes, $ext);
        if ($scaledBytes !== '' && $scaledBytes !== $originalBytes) {
            @file_put_contents($target, $scaledBytes);
        }
    }

    $url = '/uploads/wappen/own/' . $filename;

    // 🔴 Lizenz/Urheber/Kommentar kommen erstmals aus dem Formular (Phase 4, Aufgabe 4) -- normalisiert,
    // nie vertraut. Vorgabe 'ai_generated': genau das ist der Bestand, die Editoren haben ihre Wappen mit
    // KI erzeugt (Owner 16.08.2026), und Phase 2 hat 'own' deshalb dorthin migriert.
    $license = avesmapsMediaLicenseNormalize($_POST['license'] ?? null, 'ai_generated');
    $author = avesmapsSettlementCoatNormalizeAuthor($_POST['author'] ?? '');
    $note = avesmapsSettlementCoatNormalizeNote($_POST['note'] ?? '');

    $props = $feature['props'];
    $previous = $props['coat'] ?? null;
    $auditBefore = avesmapsWikiSettlementAuditRow($pdo, (int) $feature['id']);
    // 🔴 uploaded_by/uploaded_at setzt AUSSCHLIESSLICH der Server, nie das Formular -- sonst waere der
    // Nachweis faelschbar. $user kommt aus avesmapsRequireUserWithCapability() weiter oben.
    // Ein hochgeladenes Wappen hebt „kein Wappen" auf -- sonst muesste der Editor erst
    // entsperren, bevor er hochladen darf.
    unset($props['coat_none']);
    $props['coat'] = [
        'url' => $url,
        'source' => 'own',
        'license_status' => $license,
        'author' => $author,
        'note' => $note,
        'uploaded_by' => (string) ($user['username'] ?? ''),
        'uploaded_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id')
        ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $feature['id']]);
    avesmapsWikiSettlementAuditAssignment($pdo, $auditBefore, $props, $revision, (int) ($user['id'] ?? 0));
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
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
