<?php

declare(strict_types=1);

/**
 * Der Schreiber: eine Anweisung je Anfrage, und er wirft NIEMALS nach aussen.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md §3.1
 *
 * 🔴 WARUM HIER SQLITE STEHT UND WAS DAS NICHT BEDEUTET. Die Produktionsanweisung ist MySQLs
 * `INSERT ... ON DUPLICATE KEY UPDATE`; SQLite kennt das nicht. Dieser Test biegt sie deshalb
 * NICHT zurecht -- das waere die Falle aus AGENTS.md (ein SQLite-Test, der eine MySQL-Regression
 * erzwingt, Error 1093). Er nutzt SQLite ausschliesslich als „eine Datenbank, die wirft", um die
 * Zusicherung zu pruefen, auf die es ankommt: dass der Zaehler seinen Fehler fuer sich behaelt.
 * Die Zusammensetzung der Zeilen prueft api-metrics-schluessel-test.php ohne jede Datenbank.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/analytics/__tests__/api-metrics-schreiber-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "UEBERSPRUNGEN: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(0);
}

require __DIR__ . '/../api-metrics.php';

// --- 🔴 Der Zaehler darf einen Fehler NIE nach aussen tragen -----------------------------------
// Er laeuft am Ende JEDER Anfrage, auch der bereits gescheiterten. Eine Ausnahme aus ihm wuerde
// einen echten Fehler ueberschreiben oder eine gesunde Antwort nachtraeglich zerstoeren.
// Die Tabelle gibt es hier absichtlich nicht -- die Anweisung MUSS scheitern.
$ohneTabelle = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$zeilen = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 500, true, 'server_error', 12);
assert(count($zeilen) === 3, 'die Fixture traegt wirklich drei Zeilen');

$geworfen = false;
try {
    avesmapsApiMetricsSchreiben($ohneTabelle, $zeilen);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'der Schreiber schweigt, wenn die Datenbank zickt');

// Dasselbe fuer das Aufraeumen -- es laeuft am selben Ort und unter derselben Regel.
$geworfen = false;
try {
    avesmapsApiMetricsAufraeumen($ohneTabelle);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'das Aufraeumen schweigt ebenfalls');

// Eine leere Zeilenliste ist kein Grund, ueberhaupt etwas zu schicken.
$geworfen = false;
try {
    avesmapsApiMetricsSchreiben($ohneTabelle, []);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'leere Liste: nichts passiert');

// --- Die Anweisung ist EINE, nicht drei ---------------------------------------------------------
// 💣 Drei Zeilen duerfen nicht drei Rundreisen zur Datenbank kosten -- der Zaehler liegt auf dem
// kritischen Pfad, weil es `fastcgi_finish_request` auf STRATO nicht gibt (SAPI cgi-fcgi, gemessen
// 24.08.2026). Geprueft am Quelltext, weil SQLite die MySQL-Anweisung nicht ausfuehren kann.
//
// 💣 Zeilenenden vorher vereinheitlichen: der Arbeitsbaum steht unter Windows und hat CRLF.
$quelle = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../api-metrics.php'));
$schreiber = substr($quelle, strpos($quelle, 'function avesmapsApiMetricsSchreiben'));
$schreiber = substr($schreiber, 0, strpos($schreiber, "\n}\n") + 3);

assert(substr_count($schreiber, '->prepare(') === 1, 'genau eine vorbereitete Anweisung');
assert(substr_count($schreiber, '->execute(') === 1, 'genau eine Ausfuehrung');
assert(str_contains($schreiber, 'ON DUPLICATE KEY UPDATE'), 'MySQL-Aufwaertszaehlung, nicht wegvereinfacht');
assert(str_contains($schreiber, 'count = count + 1'), 'jede eingefuegte Zeile traegt count=1');

// 🔴 Und das try/catch ist die Zusicherung, nicht die Bequemlichkeit.
assert(str_contains($schreiber, 'catch (Throwable'), 'der Schreiber faengt alles');

// --- Der Waechter gegen Doppelregistrierung -----------------------------------------------------
// 💣 bootstrap.php wird an ueber 50 Stellen mit `require` (nicht `require_once`) eingebunden.
// Zwei Registrierungen zaehlten jede Anfrage DOPPELT -- das saehe nach mehr Verkehr aus, nicht
// nach einem Fehler, und niemand wuerde es bemerken.
$bootstrap = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../bootstrap.php'));
$registrierer = substr($bootstrap, strpos($bootstrap, 'function avesmapsApiMetricsRegistrieren'));
$registrierer = substr($registrierer, 0, strpos($registrierer, "\n}\n") + 3);
assert(str_contains($registrierer, 'AVESMAPS_API_METRICS_REGISTRIERT'), 'es gibt einen Waechter');
assert(
    strpos($registrierer, 'AVESMAPS_API_METRICS_REGISTRIERT') < strpos($registrierer, 'register_shutdown_function'),
    'der Waechter steht VOR der Registrierung'
);
assert(substr_count($registrierer, 'register_shutdown_function') === 1, 'genau eine Registrierung');

// 🔴 avesmapsJsonResponse zaehlt NICHT selbst -- sonst faehrt der Fatal-Error-Fall ohne Eintrag.
$antwortFn = substr($bootstrap, strpos($bootstrap, 'function avesmapsJsonResponse'));
$antwortFn = substr($antwortFn, 0, strpos($antwortFn, "\n}\n") + 3);
assert(!str_contains($antwortFn, 'avesmapsApiMetricsSchreiben'), 'JsonResponse schreibt nicht selbst');
assert(str_contains($antwortFn, 'avesmapsApiMetricsMerkeAntwort'), 'JsonResponse hinterlegt nur');

echo "OK: api-metrics-schreiber-test\n";
