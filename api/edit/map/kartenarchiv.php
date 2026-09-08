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
 * 🔴 SEIT 08.09.2026 GIBT ES EINEN ZWEITEN RIEGEL: `?token=…` liefert OHNE Sitzung, solange
 * der Link gilt (Owner-Auftrag am selben Tag, damit ein Editor die Karte auch an jemanden
 * ohne Konto schicken kann). Das ist die EINZIGE Ausnahme zu Zusage 3 des Entwurfs vom
 * 23.08.2026, sie ist BESTELLT und keine Aufhebung -- eine DAUERHAFTE Adresse ohne Sitzung
 * gibt es weiterhin nicht. Warum das tragbar ist und was dafuer stimmen muss, steht im Kopf
 * von api/_internal/map/kartenarchiv-link.php. Wer den Ablauf entfernt, entfernt die
 * Begruendung; wer den ganzen Token-Weg entfernt, nimmt eine bestellte Funktion weg (der
 * Rueckbau-Waechter im Test sagt das dann).
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
require_once __DIR__ . '/../../_internal/map/kartenarchiv-link.php';
require_once __DIR__ . '/../../_internal/schema-ensure-once.php';

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

// ================================================================================================
// ZWEI RIEGEL, EIN AUSGANG
// ================================================================================================
//
// Entweder eine angemeldete Sitzung mit `edit` -- oder ein gueltiger, ablaufender Link
// (Owner-Auftrag 08.09.2026, Begruendung im Kopf von api/_internal/map/kartenarchiv-link.php).
//
// 🔴 EIN Ausgang, und das ist Absicht: der Streaming-, Range- und Kopfzeilen-Teil unten ist
// heikel genug, dass er nicht zweimal existieren darf -- ein einziges Byte an der falschen
// Stelle macht das ZIP kaputt, und zwar lautlos. Ein zweiter oeffentlicher Endpunkt waere
// nach der Zonenordnung (AGENTS.md §4) sauberer und hat den Owner am 08.09.2026 trotzdem
// nicht ueberzeugt: „ein endpunkt reicht".
//
// 💣 Der Token gewinnt, wenn beide da sind, und `datei` wird dann NICHT gelesen. Die Datei
// haengt am Token; naehme sie der Parameter, waere ein Link auf die Kacheln (161 MB) zugleich
// einer auf die Gesamtkarte (1,73 GB).
// 💣 DIE WEICHE FRAGT, OB DER PARAMETER DA IST -- nicht, ob er GUELTIG ist. Sonst faellt ein
// verstuemmelter Token in den Sitzungszweig, und der Empfaenger bekommt „Du bist fuer diese
// Aktion nicht angemeldet" auf einen Link, den er von uns hat und fuer den er nie ein Konto
// bekommen wird. Live gemessen am 08.09.2026, genau so. Und es ist der Normalfall, nicht der
// Sonderfall: ein 32-Zeichen-Token in einer Mail wird von Clients umgebrochen.
$tokenRoh = (string) ($_GET['token'] ?? '');
$token = avesmapsKartenarchivLinkTokenNormalisieren($tokenRoh);
$currentUser = null;
$linkZeile = null;
$pdo = null;

if ($tokenRoh !== '') {
    // Unbrauchbare Form: dieselbe nichtssagende Antwort wie ein unbekannter Token. Ein Hinweis
    // auf die erwartete Laenge waere eine Hilfe beim Raten und hilft dem Empfaenger nicht --
    // er kann seinen Link nur neu anfordern.
    if ($token === '') {
        avesmapsErrorResponse(404, 'archive_not_found', 'Dieses Archiv gibt es nicht.');
    }

    // ⚠️ Hier braucht es die Datenbank VOR der ersten Kopfzeile -- ein Fehlschlag muss eine
    // lesbare Absage werden, nicht ein halb ausgeliefertes Archiv.
    try {
        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        // ⚠️ Durch `avesmapsSchemaEnsureOnce` und nicht roh: ein Download mit Fortsetzen stellt
        // Dutzende Range-Anfragen, und jede einzelne liefe sonst in ein `CREATE TABLE IF NOT
        // EXISTS` -- genau die Last, die §10 der AGENTS.md fuer die Takt-Pfade abgebaut hat.
        // 💣 Der Schluessel traegt die MTIME dieser Datei: eine neue Spalte aendert sie, und der
        // Ensure laeuft sofort wieder statt bis zu eine Stunde auszustehen.
        avesmapsSchemaEnsureOnce(
            'kartenarchiv_link',
            __DIR__ . '/../../_internal/map/kartenarchiv-link.php',
            static fn() => avesmapsKartenarchivLinkEnsureTable($pdo)
        );
        $linkZeile = avesmapsKartenarchivLinkFinden($pdo, $token);
    } catch (Throwable $exception) {
        error_log('kartenarchiv: Link-Riegel nicht pruefbar: ' . $exception->getMessage());
        avesmapsErrorResponse(503, 'link_check_failed', 'Der Link laesst sich gerade nicht pruefen. Bitte spaeter erneut versuchen.');
    }

    if ($linkZeile === null) {
        // Unbekannter Token: dieselbe nichtssagende Antwort wie ein erratener Dateiname.
        avesmapsErrorResponse(404, 'archive_not_found', 'Dieses Archiv gibt es nicht.');
    }

    // 🔴 Abgelaufen bekommt eine EIGENE, sprechende Antwort -- anders als beim Pfad-Ausbruch,
    // wo Schweigen richtig ist. Wer diesen Token hat, hat ihn von uns bekommen; ein stummes
    // 404 liesse ihn beim Absender melden „dein Link geht nicht", und niemand wuesste warum.
    // Verraten wird dabei nichts, was der Empfaenger nicht schon weiss.
    if (!avesmapsKartenarchivLinkIstGueltig($linkZeile, avesmapsKartenarchivLinkJetzt())) {
        avesmapsErrorResponse(410, 'link_expired', 'Dieser Downloadlink ist abgelaufen. Bitte frag nach einem neuen.');
    }

    $dateiName = (string) ($linkZeile['file_name'] ?? '');
} else {
    $currentUser = avesmapsRequireUserWithCapability('edit');
    $dateiName = (string) ($_GET['datei'] ?? '');
}

// 🔴 BEIDE Wege gehen durch den Pfad-Riegel. Eine Zeile in der Datenbank ist kein Beleg dafuer,
// dass die Datei noch dort liegt und dort liegen darf -- und ein Riegel, der einen von zwei
// Wegen bindet, ist keiner.
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
        $pdo ??= avesmapsCreatePdo($config['database'] ?? []);

        // 🔴 Zusage 4 des Entwurfs vom 23.08.2026 -- „jeder Download hinterlaesst eine Zeile mit
        // Namen" -- gilt auf BEIDEN Wegen. Auf dem Token-Weg gibt es keinen angemeldeten Namen,
        // also traegt die Zeile den ERZEUGER des Links und dessen Zweck. Ein leeres Feld waere
        // das lautlose Ende dieser Zusage: die Tabelle saehe weiter gepflegt aus.
        if ($linkZeile !== null) {
            $akteurId = null;
            $akteurName = avesmapsKartenarchivLinkBeleg(
                (string) ($linkZeile['creator_name'] ?? ''),
                (string) ($linkZeile['note'] ?? '')
            );
            avesmapsKartenarchivLinkTrefferZaehlen($pdo, (int) $linkZeile['id']);
        } else {
            $akteurId = isset($currentUser['id']) ? (int) $currentUser['id'] : null;
            $akteurName = (string) ($currentUser['username'] ?? '');
        }

        avesmapsKartenarchivProtokollieren($pdo, $akteurId, $akteurName, basename($pfad), $groesse);
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
