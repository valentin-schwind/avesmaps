<?php
// api/_internal/__tests__/create-pdo-argument-test.php
declare(strict_types=1);

/**
 * `avesmapsCreatePdo()` bekommt den DATENBANK-Teilbaum, nie die ganze Konfiguration.
 *
 * 💣 WARUM DAS EINEN EIGENEN TEST BRAUCHT. Die Signatur ist `avesmapsCreatePdo(array $databaseConfig)`
 * — sie nimmt ein Array, und `$config` IST ein Array. PHP beschwert sich also nicht. Erst drinnen
 * sind `driver`, `host`, `port`, `name`, `user` allesamt leer, und die Funktion wirft
 * „Die Datenbank-Konfiguration ist unvollstaendig.". In einem Endpunkt mit einem
 * `catch (Throwable)` am Ende wird daraus ein generisches 500 — der Aufrufer sieht nie, dass es an
 * einer Klammerebene lag.
 *
 * 🔴 GEMESSEN, NICHT AUSGEDACHT: genau so lief `api/edit/map/travel-values.php` vom Tag seiner
 * Veroeffentlichung an (14.08.2026). Das Fenster „Tempowerte" meldete „Die Tempowerte konnten nicht
 * geladen werden.", und weil die Meldung im Client an einem `.catch` haengt, sah ein Netzfehler,
 * ein 500 und ein kaputtes JSON exakt gleich aus. Der Dialog hat NIE geladen.
 *
 * ⭐ Der Test prueft die ganze KLASSE, nicht die eine Zeile: jeder Aufruf im Haus muss erkennbar
 * einen Teilbaum uebergeben. Das ist billig und faengt den naechsten Endpunkt, der abgeschrieben wird.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/create-pdo-argument-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1'.\n");
    exit(2);
}

// __DIR__ = api/_internal/__tests__ -> drei Ebenen bis zur Repo-Wurzel.
$root = dirname(__DIR__, 3);

/** Jede PHP-Datei unter api/ und tools/ — die Aufrufer stehen nicht an einem Ort. */
$files = [];
foreach (['api', 'tools'] as $dir) {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/' . $dir));
    foreach ($iterator as $file) {
        if ($file->isFile() && strtolower($file->getExtension()) === 'php') {
            $files[] = $file->getPathname();
        }
    }
}
assert(count($files) > 100, 'die Dateiliste wurde wirklich gelesen: ' . count($files));

// Erlaubt ist alles, was erkennbar EIN Feld heraussucht (`$config['database']`, `$cfg['database'] ?? []`)
// oder eine Variable weiterreicht, die schon der Teilbaum ist (`$databaseConfig`, `$dbConfig`).
$erlaubt = static function (string $argument): bool {
    $argument = trim($argument);
    if ($argument === '') { return false; }
    if (str_contains($argument, "['database']")) { return true; }
    if (str_contains($argument, '["database"]')) { return true; }
    if (preg_match('/^\$(database|db)[A-Za-z]*$/', $argument) === 1) { return true; }

    return false;
};

$verstoesse = [];
foreach ($files as $path) {
    // Die Definition selbst und die Testdateien, die den Namen nur als Zeichenkette fuehren, sind
    // nicht gemeint.
    if (str_ends_with($path, 'bootstrap.php')) { continue; }
    if (str_contains($path, '__tests__')) { continue; }

    $source = (string) file_get_contents($path);
    if (!str_contains($source, 'avesmapsCreatePdo(')) { continue; }

    // Zeilenweise, damit ein KOMMENTAR, der den Namen nur erwaehnt, kein Befund wird -- die Aufrufe
    // im Haus stehen alle auf einer Zeile.
    foreach (preg_split('/\R/', $source) ?: [] as $nummer => $zeile) {
        $roh = ltrim($zeile);
        if ($roh === '' || str_starts_with($roh, '//') || str_starts_with($roh, '*') || str_starts_with($roh, '#')) {
            continue;
        }
        if (preg_match('/avesmapsCreatePdo\(([^)]*)\)/', $zeile, $treffer) !== 1) { continue; }
        if ($erlaubt($treffer[1])) { continue; }
        $verstoesse[] = str_replace($root . DIRECTORY_SEPARATOR, '', $path) . ':' . ($nummer + 1)
            . ' — avesmapsCreatePdo(' . trim($treffer[1]) . ')';
    }
}

assert(
    $verstoesse === [],
    "avesmapsCreatePdo() bekommt den Datenbank-Teilbaum, nicht die ganze Konfiguration:\n  "
    . implode("\n  ", $verstoesse)
);

echo "create-pdo-argument-test: alle Aufrufer uebergeben den Datenbank-Teilbaum\n";
