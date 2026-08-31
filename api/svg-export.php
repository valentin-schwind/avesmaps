<?php

declare(strict_types=1);

/**
 * GET /api/svg-export.php -- der jeweils neueste semantische SVG-Abzug der Karte.
 * ---------------------------------------------------------------------------------------
 * Fuer Maschinen: ein Bearer-Token statt Browser-Login und Admin-Cookie. Der Token steht
 * in api/config.local.php unter `svg_export.token` -- dort, wo die Token dieses Projekts
 * gesammelt sind (import_api, discord, changelog, social). Der Abzug ist
 * dieselbe Datei, die /edit/svg-export.php im Browser erzeugt -- gebaut vom naechtlichen
 * Lauf (.github/workflows/svg-export-abzug.yml) mit demselben Bauer
 * (js/pages/svg-export-build.js), 32768 x 32768, viewBox 0 0 1024 1024, alle Ebenen,
 * volle avm:*-Semantik.
 *
 * 🔴 ZWEI FASSUNGEN, seit 31.08.2026. Ohne Parameter die ungeglaettete (Stuetzpunkt-Polygone,
 * M/L/Z) -- unveraendert das, was es seit dem 23.08. gibt. Mit `?smooth=1` die geglaettete
 * (M/L/C/Z, absolute kubische Bezierkurven), also die Geometrie, die der Browser zeichnet:
 * ein maschineller Renderer braucht sie, damit seine Konturen zum Kartenbild passen. Alles
 * Uebrige ist identisch -- dieselben avm:-Attribute, dieselbe viewBox, dieselben Kopfzeilen.
 * ⚠️ Die Wurzelattribute `avm:geglaettet` / `avm:flaechen_geglaettet` der Datei melden den
 * TATSAECHLICHEN Zustand; sie sind die Wahrheit, nicht der Parameter.
 *
 * 🔴 NUR LESEN. Dieser Endpunkt hat keinen Schreibweg, keine Datenbankverbindung und keine
 * Verwaltungsfunktion; er reicht eine Datei durch. Der Token kann nichts anderes.
 *
 * 💣 KEIN PDO. Eine Datenbankverbindung waere unnoetige Last auf dem Shared Hosting fuer
 * einen Endpunkt, der eine Datei durchreicht.
 *
 * ⚠️ `avesmapsLoadApiConfig` WIRFT, wenn weder config.local.php noch die DB-Umgebung da ist.
 * Ein reiner Dateiendpunkt darf daran nicht mit einem 500 zerbrechen -- der Wurf wird
 * gefangen und heisst dasselbe wie ein leerer Token: „auf diesem Server nicht eingerichtet".
 *
 * Vertrag im Fehlerfall wie ueberall: {ok:false, error:{code, message}} (AGENTS.md sec.4).
 */

require __DIR__ . '/_internal/bootstrap.php';
require_once __DIR__ . '/_internal/app/svg-export-ablage.php';

// 🔴 Kein CORS. Ein Bearer-Token gehoert nicht in eine Webseite, und `Access-Control-Allow-*`
// waere die Einladung, ihn dort hineinzuschreiben. Dies ist ein Server-zu-Server-Endpunkt.
$anfrageArt = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($anfrageArt !== 'GET' && $anfrageArt !== 'HEAD') {
    header('Allow: GET, HEAD');
    avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und HEAD sind erlaubt.');
}

// 💣 DER WURF DARF DEN RUECKFALL NICHT VERSCHLUCKEN. `avesmapsLoadApiConfig` wirft, wenn
// weder config.local.php noch die DB-Umgebung da ist -- landete der Aufruf der Tokenfunktion
// IM try-Block, waere die Umgebungsvariable in genau dem Fall unerreichbar, fuer den sie
// gedacht ist (ein Aufbau ohne config.local.php). Also: erst die Konfiguration holen, im
// Fehlerfall ein leeres Array, und DANN den Token suchen.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    $config = [];
}
$erwarteterToken = avesmapsSvgExportConfiguredToken($config);

if ($erwarteterToken === '') {
    // 💣 Das ist KEIN 401. Ein 401 hiesse „dein Token ist falsch" und schickte den Aufrufer
    // auf die Suche nach einem Fehler, den er nicht hat -- hier fehlt der Schluessel
    // `svg_export.token` in api/config.local.php AUF DEM SERVER. Eine Absage ohne
    // unterscheidbaren Grund ist von aussen unauffindbar.
    avesmapsErrorResponse(503, 'export_not_configured',
        'Der SVG-Export ist auf diesem Server nicht eingerichtet.');
}

$gegebenerToken = avesmapsSvgExportBearerAusAnfrage($_SERVER);
if (!avesmapsSvgExportTokenPasst($erwarteterToken, $gegebenerToken)) {
    // ⚠️ EINE Antwort fuer „kein Token" und „falscher Token". Sie zu unterscheiden verriete
    // einem Probierer, dass sein Format stimmt. Der Token selbst wird nirgends protokolliert.
    header('WWW-Authenticate: Bearer realm="avesmaps-svg-export"');
    avesmapsErrorResponse(401, 'unauthorized', 'Gueltiger Bearer-Token erforderlich.',
        avesmapsSvgExportAbsageDetails($_SERVER));
}

// 🔴 ERST HIER, nach dem Riegel: die Sperre der Ablage heilt sich zur Laufzeit (Hausmuster,
// siehe avesmapsSvgExportEnsureAblage) -- aber eine anonyme Anfrage soll keinen
// Schreibvorgang ausloesen koennen.
// 🔴 `?smooth=1` waehlt die GEGLAETTETE Fassung -- dieselbe Karte mit den Bezierkurven, die
// der Browser zeichnet (M/L/C/Z statt M/L/Z). Sie wird nicht hier erzeugt: dieser Endpunkt
// baut nichts, er reicht eine hinterlegte Datei durch. Die glatte Fassung ist eine ZWEITE
// hinterlegte Datei mit eigenem Zeiger (svg-export-ablage.php).
$variante = avesmapsSvgExportVarianteAusAnfrage($_GET);
$abzug = avesmapsSvgExportAbzug(avesmapsSvgExportEnsureAblage(), $variante);
if ($abzug === null) {
    // 💣 EIN EIGENER GRUND FUER DIE GLATTE FASSUNG, und niemals ersatzweise die rohe. Wer
    // `?smooth=1` bestellt und M/L/Z bekommt, rendert Kanten, die nicht zur Karte passen --
    // und sucht den Fehler bei sich. Eine Antwort, die anders aussieht als bestellt, ist
    // schlimmer als keine.
    if ($variante === AVESMAPS_SVG_EXPORT_VARIANTE_GLATT) {
        avesmapsErrorResponse(404, 'smooth_export_not_available',
            'Es liegt noch kein geglaetteter Abzug bereit. Der naechtliche Lauf erzeugt ihn; '
            . 'ohne ?smooth=1 gibt es die ungeglaettete Fassung.');
    }
    avesmapsErrorResponse(404, 'export_not_available',
        'Es liegt noch kein Abzug bereit. Der naechtliche Lauf erzeugt ihn.');
}

// 🔴 DIE KOEPFE GEHEN MIT DER ANTWORT RAUS, nie vor der Arbeit. Ein ETag, der auch einen
// Fehler begleitet, laesst einen Client seinen Fehlertext unter diesem Tag ablegen und
// bekommt danach 304 -- „deine Kopie ist aktuell" fuer eine Fehlermeldung. Hier steht die
// Datei bereits fest, wenn diese Zeile laeuft.
header('ETag: ' . $abzug['etag']);
// 💣 UND DIESELBE PRUEFSUMME NOCH EINMAL, UNTER EIGENEM NAMEN. Gemessen 23.08.2026: vor
// STRATO sitzt etwas, das die Antwort umschreibt (`Vary: X-Forwarded-For,User-Agent,…`) und
// dabei `ETag` UND `Content-Length` verwirft -- die Antwort kommt `chunked` an. Betroffen ist
// jede PHP-Antwort, nicht nur diese: `api/app/zoom-bands.php` setzt ebenfalls einen ETag, und
// auch der kommt nicht an. Eigene `X-`Koepfe ueberleben dagegen (nachgemessen an
// `X-Robots-Tag` und den Fassungsstempeln).
// ⚠️ Der ETag bleibt trotzdem stehen: kommt er durch, funktioniert die normale
// 304-Aushandlung, und `If-None-Match` wertet der Endpunkt ohnehin aus. Wer sich NICHT darauf
// verlassen will, vergleicht diese Zeile -- sie ist derselbe sha256, nur ohne Anfuehrungszeichen.
header('X-Avesmaps-SHA256: ' . $abzug['sha256']);
header('Cache-Control: private, no-cache');
header('X-Avesmaps-Kartenfassung: ' . $abzug['kartenfassung']);
header('X-Avesmaps-Landschaftsfassung: ' . $abzug['landschaftsfassung']);
header('X-Avesmaps-Exported-At: ' . $abzug['exportiert']);
// 🔴 `routine` (naechtlicher Lauf, feste Einstellungen) oder `manuell` (der Owner auf
// /edit/svg-export.php, mit seinen Reglern). Wer den Abzug maschinell auswertet, muss das
// unterscheiden koennen -- ein geglaetteter Handabzug hat andere Geometrie als der
// ungeglaettete der Routine, und die Fassungsstempel sagen darueber nichts.
header('X-Avesmaps-Quelle: ' . $abzug['quelle']);
// ⚠️ Welche Fassung das hier ist -- additiv, damit ein HEAD sie ohne Parsen erfaehrt und ein
// Client nach einem 304 weiss, worauf sich sein Hash bezieht. Die Datei selbst sagt es in
// ihren Wurzelattributen; diese Zeile erspart, dafuer 8 MB zu laden.
header('X-Avesmaps-Variante: ' . $variante);

// 💣 ZWEI GUELTIGE FORMEN, und die zweite ist die WICHTIGERE. Der Client bekommt den ETag
// gar nicht zu sehen -- der Proxy vor STRATO wirft ihn weg (siehe oben). Was er von uns
// bekommt, ist `X-Avesmaps-SHA256`: derselbe Hash OHNE Anfuehrungszeichen. Schickt er den
// zurueck, traefe die reine ETag-Regel NICHT, und er laedt 8,6 MB -- jedes Mal, ohne es je zu
// merken, denn ein 200 sieht voellig normal aus. Von einem Aufrufer zu verlangen, dass er
// Anfuehrungszeichen um einen Wert setzt, den er nie in dieser Form gesehen hat, ist keine
// Strenge, sondern eine Falle.
// 🔴 Geprueft wird zweimal mit der GETEILTEN Regel (avesmapsETagMatches), nur gegen zwei
// Zielwerte -- keine zweite Umsetzung des Vergleichs (api/_internal/__tests__/etag-shared-test.php).
$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
$trifft = $ifNoneMatch !== ''
    && (avesmapsETagMatches($ifNoneMatch, $abzug['etag'])
        || avesmapsETagMatches($ifNoneMatch, $abzug['sha256']));
if ($trifft) {
    http_response_code(304);
    exit;
}

header('Content-Type: image/svg+xml; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $abzug['dateiname'] . '"');
header('Content-Length: ' . $abzug['bytes']);
// Ein Abzug ist rund 8 MB; ein `Content-Encoding` darueber kostet auf dem Shared Hosting
// Rechenzeit und macht `Content-Length` zunichte.
header('X-Content-Type-Options: nosniff');

if ($anfrageArt === 'HEAD') {
    exit;
}

// 💣 readfile(), NICHT file_get_contents(). Der Abzug ist groesser als das, was ein
// PHP-Prozess auf dem Shared Hosting bequem im Speicher haelt; readfile streamt. Und der
// Ausgabepuffer muss vorher weg, sonst puffert PHP die ganze Datei doch wieder.
while (ob_get_level() > 0) {
    ob_end_flush();
}
readfile($abzug['pfad']);
