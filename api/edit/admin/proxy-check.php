<?php

declare(strict_types=1);

/**
 * Sitzt ein Zwischenserver vor Avesmaps? (Befund A29, Owner-Auftrag vom 06.08.2026.)
 * ---------------------------------------------------------------------------
 * GET, nur mit der Fähigkeit `admin`, rein lesend. Antwortet mit Wahrheitswerten und Zahlen über
 * die EIGENE Anfrage des Aufrufers -- keine Adresse, keine Kopfzeilen-Inhalte, und es wird nichts
 * gespeichert. Die Regeln dazu stehen in api/_internal/diagnostics/proxy-signals.php.
 *
 * SO WIRD SIE BENUTZT: eingeloggt im Browser aufrufen -- und ohne einen eigenen
 * X-Forwarded-For-Kopf, sonst misst man sich selbst. Die Antwort trägt diese Einschränkung mit.
 *
 *   forwarded_header_present = false  und  proxy_evidence_headers = []
 *       -> nichts deutet auf einen Zwischenserver. Die Drossel darf auf REMOTE_ADDR umgestellt
 *          werden.
 *   forwarded_header_present = true   oder ein Beweis-Kopf ist da
 *       -> es reicht jemand weiter. Dann muss das RECHTESTE Element genommen werden, und ein
 *          Umstellen auf REMOTE_ADDR würde alle Besucher in einen Eimer werfen.
 *
 * 💣 WARUM DAS ÜBERHAUPT EINEN ENDPUNKT BRAUCHT: die gespeicherten Daten können die Frage nicht
 * mehr beantworten. `remote_ip` wird aus gutem Grund nicht mehr geschrieben, und ein Hash verrät
 * keine Topologie -- die Abfrage, die es versuchte, war deshalb nutzlos (sql/a29-proxy-erkennung.sql).
 * Diese Diagnose ist kleiner als die Reparatur, die sie entscheidet.
 *
 * 🔴 NICHT nach api/diagnostics/ gelegt, obwohl der Name dorthin passt: dieser Ordner ist per
 * .htaccess für das Web GESPERRT (AGENTS.md §10) -- ein Endpunkt dort wäre nicht aufrufbar.
 * `admin` und nicht `edit`: die Antwort beschreibt die Netz-Topologie des Servers, und das geht
 * Bearbeiter nichts an.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/diagnostics/proxy-signals.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}
if ($requestMethod !== 'GET') {
    avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.');
}

// ⚠️ Der Riegel steht VOR jeder Auswertung. Er braucht keine Datenbank und diese Antwort auch nicht --
// es wird nichts gelesen, nichts geschrieben und nichts protokolliert.
avesmapsRequireUserWithCapability('admin');

avesmapsJsonResponse(200, ['ok' => true] + avesmapsProxySignals());
