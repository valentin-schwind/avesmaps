<?php

declare(strict_types=1);

/**
 * Kommt dieser Server nach draussen? (Vorfall vom 30.08.2026.)
 * ---------------------------------------------------------------------------
 * GET, nur mit der Faehigkeit `admin`, rein lesend. Antwortet mit dem Befund je Ziel: erreicht
 * oder nicht, in welcher Phase es haengt, welche Adresse angesteuert wurde, und wie dieser Server
 * nach aussen auftritt. Die Regeln dazu stehen in api/_internal/diagnostics/ausgang-sonde.php.
 *
 * SO WIRD SIE BENUTZT: eingeloggt im Browser aufrufen. Die drei Ziele werden nacheinander
 * versucht; im schlimmsten Fall dauert das die Summe ihrer Deckel.
 *
 *   mastodon.phase = "tcp"   -> die Gegenseite verwirft unsere Pakete. Mit `gemeldete_ausgangs_ip`
 *                               laesst sich die Entsperrung erbitten.
 *   mastodon.phase = "dns"   -> der Name loest hier nicht auf; das Problem liegt bei uns.
 *   mastodon.ziel_ip weicht  -> DNS zeigt hier woandershin als in der Welt; ebenfalls bei uns.
 *   kontrolle nicht ok       -> nicht das Ziel ist zu, sondern unser Ausgang. Dann ist es STRATO.
 *
 * 💣 WARUM DAS EINEN ENDPUNKT BRAUCHT: der Absendeweg kann die Frage nicht beantworten.
 * `social_post_target.error` sagt bei allen drei Ursachen denselben Satz („Connection timed out"),
 * und die drei haben nichts miteinander zu tun. Ohne diese Trennung raet man, auf wessen Seite der
 * Fehler liegt -- und schreibt im Zweifel eine fremde Administration wegen eines eigenen Fehlers an.
 *
 * 🔴 NICHT nach api/diagnostics/ gelegt, obwohl der Name dorthin passt: dieser Ordner ist per
 * .htaccess fuer das Web GESPERRT (AGENTS.md §10) -- ein Endpunkt dort waere nicht aufrufbar.
 * `admin` und nicht `edit`: die Antwort beschreibt die Netzlage des Servers samt seiner
 * Ausgangsadresse, und das geht Bearbeiter nichts an.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/diagnostics/ausgang-sonde.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
// OPTIONS bleibt vor dem Riegel: eine CORS-Vorabfrage traegt keine Anmeldedaten und darf keine
// verlangen. Das ist die EINZIGE Ausnahme.
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}

// ⚠️ Der Riegel steht VOR der Methodenpruefung -- dieselbe Reihenfolge wie beim Nachbarn
// proxy-check.php, und aus demselben Grund: ein anonymer POST bekaeme sonst 405 statt 401 und
// wuesste damit, dass es diesen Endpunkt gibt und dass er GET nimmt (Befund A33).
avesmapsRequireUserWithCapability('admin');

if ($requestMethod !== 'GET') {
    avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.');
}

// 💣 PHP haelt die Sitzungsdatei waehrend der ganzen Anfrage gesperrt, und diese hier wartet im
// schlimmsten Fall drei Deckel lang. Ohne dies fror der eigene Aufruf den restlichen Editor FUER
// DENSELBEN Benutzer ein -- gemessen und beschrieben an api/edit/map/link-check.php. Unterhalb
// wird die Sitzung nicht mehr angefasst; die Faehigkeit ist oben bereits aufgeloest.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

avesmapsJsonResponse(200, ['ok' => true] + avesmapsAusgangBefund());
