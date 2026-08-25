<?php
// api/_internal/__tests__/cors-oeffentlicher-vertrag-test.php
declare(strict_types=1);

/**
 * DIE BEIDEN ENDPUNKTE DES STABILEN VERTRAGS SIND FUER JEDE HERKUNFT OFFEN -- UND SONST KEINER.
 *
 * Owner-Entscheid 25.08.2026 („mach die CORS-Liste auf für fremde Herkünfte"), im Anschluss an
 * Meldung #96: ein fremder Entwickler-Client bekam von `GET /api/locations/` eine **403**, weil
 * `avesmapsApplyCorsPolicy` jede nicht gelistete Herkunft abweist. Eine „stabile Entwickler-API",
 * die man aus dem Browser nicht aufrufen kann, ist keine.
 *
 * 💣 DIE POLICY IST EIN GETEILTER HELFER MIT 91 AUFRUFERN. Die Liste im `config`-Array global auf
 * `['*']` zu stellen haette JEDEN Endpunkt geoeffnet -- auch `api/edit/**` (Schreibwege hinter
 * Faehigkeiten), `api/import/**` und `api/diagnostics/**`. Geoeffnet wird deshalb je Endpunkt, per
 * ausdruecklichem zweiten Argument, und dieser Test ist der Riegel dagegen, dass ein dritter
 * Endpunkt das per Abschrift „miterbt".
 *
 * 🔴 UND ES BLEIBT BEI `*` OHNE `Access-Control-Allow-Credentials`. Das ist kein Versehen, sondern
 * die Sicherung: bei `*` schickt der Browser grundsaetzlich KEINE Cookies mit, eine fremde Seite
 * kann also nicht die angemeldete Sitzung eines Editors benutzen. Wer je `Allow-Credentials: true`
 * dazustellt, muss im selben Zug `*` gegen eine echte Liste tauschen -- sonst ist jede Editor-
 * Sitzung von jeder Webseite aus fahrbar.
 *
 * ⚠️ CORS regelt nur, ob BROWSER-JS die Antwort lesen darf. Gegen Abrufe per `curl` hat es nie
 * geschuetzt und tut es weiterhin nicht -- die Last-Frage (AGENTS.md §9) ist davon unberuehrt.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/cors-oeffentlicher-vertrag-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$apiWurzel = dirname(__DIR__, 2);

// ---- 1. Genau ZWEI Endpunkte oeffnen sich, und es sind die dokumentierten ----------------------
$offen = [];
$rekursiv = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($apiWurzel));
foreach ($rekursiv as $datei) {
    if ($datei->getExtension() !== 'php') {
        continue;
    }
    $pfad = str_replace('\\', '/', $datei->getPathname());
    if (str_contains($pfad, '/__tests__/')) {
        continue;
    }
    $inhalt = (string) file_get_contents($pfad);
    // Der Aufruf mit einem zweiten Argument IST die Oeffnung.
    if (preg_match('/avesmapsApplyCorsPolicy\(\s*\$[A-Za-z_]\w*\s*,/', $inhalt) === 1) {
        $offen[] = substr($pfad, strlen(str_replace('\\', '/', $apiWurzel)) + 1);
    }
}
sort($offen);

$erwartet = ['locations/index.php', 'route/index.php'];
assert($offen === $erwartet,
    "Nur die beiden Endpunkte des stabilen Vertrags duerfen CORS oeffnen.\n"
    . 'erwartet: ' . implode(', ', $erwartet) . "\n"
    . 'gefunden: ' . (implode(', ', $offen) ?: '(keiner)') . "\n"
    . '💣 Ein Editor- oder Import-Endpunkt in dieser Liste macht seine Antworten fuer jede fremde '
    . 'Webseite lesbar.');

// ---- 2. Der geteilte Helfer oeffnet NICHT von sich aus -----------------------------------------
// 🔴 Die Vorgabe des Parameters muss „zu" sein. Stuende dort `true`, waeren mit einem Zeichen alle
// 91 Aufrufer offen, und kein einziger Aufrufer saehe anders aus als vorher.
$bootstrap = (string) file_get_contents($apiWurzel . '/_internal/bootstrap.php');
assert(preg_match('/function avesmapsApplyCorsPolicy\(array \$config, bool \$(\w+) = false\)/', $bootstrap, $t) === 1,
    'avesmapsApplyCorsPolicy nimmt einen zweiten Schalter, und der steht per Vorgabe auf `false`');
$schalter = $t[1];

// ---- 3. Keine Anmeldedaten, solange `*` gesendet wird ------------------------------------------
// 💣 Die eine Zeile, die aus einer Oeffnung eine Sicherheitsluecke machte.
// ⚠️ Gesucht wird der SENDEBEFEHL, nicht das Wort: die Begruendung im Code nennt den Kopf und soll
// das auch -- sie erklaert, warum er fehlt. (Dieselbe Falle wie beim Pruefen auf `via_not_supported`.)
assert(preg_match('/header\s*\(\s*.?Access-Control-Allow-Credentials/i', $bootstrap) !== 1,
    'Es wird KEIN Allow-Credentials gesendet -- zusammen mit `*` waere jede Editor-Sitzung '
    . 'von jeder fremden Seite aus fahrbar. Wer es braucht, tauscht im selben Zug `*` gegen eine Liste.');

// ---- 4. Die Oeffnung haengt am Schalter, nicht an der Konfiguration ----------------------------
// ⚠️ Sie muss VOR der Liste greifen: die Liste steht in api/config.local.php auf dem Server, und ein
// Endpunkt des oeffentlichen Vertrags darf nicht davon abhaengen, was dort gepflegt ist.
// ⚠️ Zeilenenden zuerst vereinheitlichen: die Datei liegt unter Windows als CRLF vor, und ein
// Suchmuster mit "\n}" findet dort nichts (AGENTS.md §9, die CRLF-Falle).
$flach = str_replace("\r\n", "\n", $bootstrap);
$rumpf = substr($flach, strpos($flach, 'function avesmapsApplyCorsPolicy'));
$ende = strpos($rumpf, "\n}\n");
assert($ende !== false, 'der Funktionsrumpf laesst sich abgrenzen');
$rumpf = substr($rumpf, 0, $ende);
$posSchalter = strpos($rumpf, 'if ($' . $schalter . ')');
$posListe = strpos($rumpf, 'avesmapsGetAllowedOrigins');
assert($posSchalter !== false && $posListe !== false && $posSchalter < $posListe,
    'der Schalter wird VOR der Herkunftsliste ausgewertet');

// ---- 5. Und der Vertrag sagt es -----------------------------------------------------------------
$readme = (string) file_get_contents($apiWurzel . '/README.md');
assert(str_contains($readme, 'Access-Control-Allow-Origin: *'),
    'api/README.md nennt die Oeffnung der beiden stabilen Endpunkte');

fwrite(STDOUT, "OK cors-oeffentlicher-vertrag-test (" . implode(', ', $offen) . ")\n");
