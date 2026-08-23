<?php

declare(strict_types=1);

/**
 * GET /api/edit/map/kartenarchiv.php?datei=<name.zip> -- ein Kartenarchiv herunterladen.
 * ---------------------------------------------------------------------------
 * Entwurf: docs/superpowers/specs/2026-08-23-kartenarchiv-und-svg-fuer-editoren-design.md
 *
 * DER EINZIGE WEG an die Dateien: uploads/map/ ist per .htaccess dicht (Owner-Entscheid
 * 06.08.2026, Befund A25) -- dieselbe Bauform wie beim Datenbank-Backup, dessen Ablage
 * ebenfalls gesperrt ist und dessen Datei nur durch einen PHP-Riegel herauskommt.
 * Die Begruendung, warum das eine vertretbare Ausnahme ist, steht im Kopf der Bibliothek.
 *
 * Fähigkeit `edit`, nicht `admin`: das Kartenmaterial ist das Arbeitsmaterial der
 * Editoren. ⚠️ Nicht zu verwechseln mit dem Datenbank-Backup nebenan -- das traegt
 * `users.password_hash` und bleibt `admin`.
 *
 * ⚠️ GET, kein POST, und das ist hier richtig: der Aufrufer ist ein gewoehnliches
 * `<a href download>` auf edit/svg-export.php. Ein POST koennte kein Browser-Download mit
 * Fortschrittsanzeige und Fortsetzen sein.
 *
 * Es gibt bewusst KEINE `action=list`: die Liste rendert edit/svg-export.php serverseitig
 * aus derselben Bibliothek. Ein zweiter Weg zur selben Auskunft ist ein zweiter Weg, auf
 * dem sie falsch sein kann.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/map/kartenarchiv.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Diese Herkunft darf das Kartenarchiv nicht laden.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}
if ($requestMethod !== 'GET' && $requestMethod !== 'HEAD') {
    avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist fuer diesen Endpoint erlaubt.');
}

$currentUser = avesmapsRequireUserWithCapability('edit');

$dateiName = (string) ($_GET['datei'] ?? '');
$pfad = avesmapsKartenarchivPfad($dateiName);
if ($pfad === null) {
    // 🔴 Eine Antwort fuer „gibt es nicht" und „darfst du nicht heissen": wer den Ausbruch
    // versucht, soll nicht daran erkennen koennen, welcher der drei Riegel gegriffen hat.
    avesmapsErrorResponse(404, 'archive_not_found', 'Dieses Archiv gibt es nicht.');
}

$groesse = (int) filesize($pfad);
$bereich = avesmapsKartenarchivRange($_SERVER['HTTP_RANGE'] ?? null, $groesse);

if ($bereich['status'] === 416) {
    header('Content-Range: bytes */' . $groesse);
    avesmapsErrorResponse(416, 'range_not_satisfiable', 'Der angeforderte Bereich liegt ausserhalb der Datei.');
}

// Der Beleg -- EINMAL je Download, nicht je Range-Anfrage (Begruendung in der Bibliothek).
// ⚠️ Der Fehlschlag des Protokolls darf den Download nicht aufhalten: die Datei ist die
// Leistung, die Zeile ist die Buchfuehrung darueber. Ein `catch (Throwable)` maskiert hier
// nichts Diagnostisches -- es gibt keinen Aufrufer, dem eine Ausnahme etwas sagen wuerde.
if ($requestMethod === 'GET' && avesmapsKartenarchivIstDownloadStart($bereich)) {
    try {
        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        avesmapsKartenarchivProtokollieren(
            $pdo,
            isset($currentUser['id']) ? (int) $currentUser['id'] : null,
            (string) ($currentUser['username'] ?? ''),
            basename($pfad),
            $groesse
        );
    } catch (Throwable $exception) {
        error_log('kartenarchiv: Protokollzeile fehlgeschlagen: ' . $exception->getMessage());
    }
}

// Eine Uebertragung von 1,73 GB darf nicht am Zeitbudget der Anfrage sterben, und ein
// Abbruch des Browsers soll den Worker nicht weiterdrehen lassen.
@set_time_limit(0);
ignore_user_abort(false);

// Nichts darf vorher ausgegeben worden sein -- ein einzelnes Byte davor macht das ZIP kaputt.
while (ob_get_level() > 0) {
    ob_end_clean();
}

// 💣 Transparente Kompression ueber ein bereits gepacktes ZIP macht die Content-Length zur
// Luege und den Download lautlos unbrauchbar -- dieselbe Falle wie beim .gz des
// Datenbank-Backups. Auf Shared Hosting ist sie ein verbreiteter Standardwert, wird also
// ausdruecklich abgeschaltet statt als abwesend angenommen.
@ini_set('zlib.output_compression', 'Off');

// 💣 Die Datei wird VOR dem ersten Kopf geoeffnet. Danach ist es zu spaet: `avesmapsErrorResponse`
// setzt selbst Koepfe, und nach `http_response_code()` plus `header()` waere die Fehlerantwort eine
// PHP-Warnung im Rumpf einer 200er -- also ein kaputtes ZIP statt einer lesbaren Absage.
$handle = null;
if ($requestMethod === 'GET') {
    $handle = @fopen($pfad, 'rb');
    if ($handle === false) {
        avesmapsErrorResponse(500, 'archive_unreadable', 'Das Archiv ist nicht lesbar.');
    }
    if ($bereich['start'] > 0 && fseek($handle, $bereich['start']) !== 0) {
        fclose($handle);
        avesmapsErrorResponse(500, 'archive_unreadable', 'Das Archiv ist nicht lesbar.');
    }
}

http_response_code($bereich['status']);
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . basename($pfad) . '"');
header('Content-Length: ' . $bereich['length']);
header('Content-Transfer-Encoding: binary');
header('Accept-Ranges: bytes');
header('X-Content-Type-Options: nosniff');
// Arbeitsmaterial hinter einem Login: kein Proxy legt das ab.
header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
if ($bereich['status'] === 206) {
    header('Content-Range: bytes ' . $bereich['start'] . '-' . $bereich['end'] . '/' . $groesse);
}

if ($requestMethod === 'HEAD') {
    exit;
}

// Die Schleife selbst liegt in der Bibliothek -- sie ist die einzige Stelle hier, die man
// wirklich AUSFUEHREN pruefen kann, und dort wird sie es auch (kartenarchiv-test.php).
avesmapsKartenarchivStream($handle, $bereich['length']);
fclose($handle);

exit;
