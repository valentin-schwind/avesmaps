<?php

declare(strict_types=1);

/**
 * Tests fuer den ABBRUCH-MELDER in api/_internal/bootstrap.php.
 *
 * 🔴 Hintergrund (24.08.2026): ein Zeitlimit oder ein anderer Fatal laeuft an JEDEM try/catch
 * vorbei. PHP bricht ab, der Rumpf bleibt leer, und im Browser steht „Internal server error" --
 * ununterscheidbar von einem Netzfehler. Der Grund stuende im Serverprotokoll, aber bei STRATO
 * gibt es keins, das man lesen kann. Also muss die Antwort selbst den Grund tragen.
 *
 * ⚠️ Der zweite Teil ist ein ABLAUFtest: er startet einen eigenen PHP-Prozess, laesst ihn wirklich
 * abstuerzen und liest, was herauskommt. Ein reiner Funktionstest wuerde beweisen, dass der Satz
 * schoen ist -- nicht, dass er im Ernstfall jemals erscheint.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/__tests__/fatal-melder-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- die Zusicherungen waeren wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$geprueft = 0;
$pruefe = static function (bool $bedingung, string $text) use (&$geprueft): void {
    $geprueft++;
    if (!$bedingung) {
        fwrite(STDERR, "ROT: {$text}\n");
        exit(1);
    }
};

// ------------------------------------------------------------------ DER SATZ ---
$satz = avesmapsFatalMessage([
    'type' => E_ERROR,
    'message' => 'Maximum execution time of 43 seconds exceeded',
    'file' => '/mnt/web108/e0/55/54143555/htdocs/avesmaps/api/_internal/wiki/sync.php',
    'line' => 231,
], 'Dump-Endpunkt');

$pruefe(str_contains($satz, 'Maximum execution time'), 'der eigentliche Grund steht im Satz');
$pruefe(str_contains($satz, 'Dump-Endpunkt'), 'der Zusammenhang steht im Satz');
$pruefe(str_contains($satz, 'sync.php:231'), 'Dateiname und Zeile stehen im Satz');
// ⚠️ Der volle Pfad verraet die Serverstruktur und gehoert nicht in eine Antwort an den Browser.
$pruefe(!str_contains($satz, '/mnt/'), 'der volle Pfad bleibt draussen');
$pruefe(!str_contains($langPfad = avesmapsFatalMessage(['type' => E_ERROR, 'message' => 'Boom in /mnt/web108/htdocs/api/x.php:9', 'file' => 'a.php', 'line' => 1]), '/mnt/'), 'auch ein Pfad IM Meldungstext wird auf den Dateinamen gekuerzt');
$pruefe(str_contains($langPfad, 'x.php:9'), 'der Dateiname samt Zeile bleibt dabei erhalten');
$pruefe(!str_contains($satz, 'htdocs'), 'auch kein Teil davon');

$langer = avesmapsFatalMessage(['type' => E_ERROR, 'message' => str_repeat('x', 500), 'file' => 'a.php', 'line' => 1]);
$pruefe(mb_strlen($langer) < 260, 'eine ellenlange Meldung wird gedeckelt (sie muss in einen Toast passen)');

$leer = avesmapsFatalMessage(['type' => E_ERROR]);
$pruefe(str_contains($leer, 'Grund unbekannt'), 'ohne Meldung steht wenigstens „Grund unbekannt" da, nie eine leere Klammer');

// --------------------------------------------------------------- DER ABLAUF ---
// 💣 Das ist die Zusicherung, die zaehlt: ein echter Prozess, ein echter Abbruch, eine echte
// Antwort. Ohne sie waere nur bewiesen, dass die Formatierung stimmt.
$tempSkript = sys_get_temp_dir() . '/avesmaps-fatal-probe-' . getmypid() . '.php';
$bootstrapPfad = str_replace('\\', '/', realpath(__DIR__ . '/../bootstrap.php'));
file_put_contents($tempSkript, <<<PHP
<?php
require '{$bootstrapPfad}';
avesmapsRegisterFatalReporter('Probe');
diese_funktion_gibt_es_nicht();
PHP);

$ausgabe = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tempSkript) . ' 2>&1');
@unlink($tempSkript);

$pruefe(str_contains($ausgabe, 'server_fatal'), 'der abgestuerzte Prozess antwortet mit dem Code server_fatal, nicht mit Schweigen');
$pruefe(str_contains($ausgabe, 'Probe'), 'die Antwort nennt den Zusammenhang, den der Endpunkt mitgegeben hat');
$pruefe(str_contains($ausgabe, 'diese_funktion_gibt_es_nicht'), 'und den echten Grund');

// ⚠️ Und sie muss gueltiges JSON sein -- ein Client, der sie nicht lesen kann, ist nicht besser dran.
// ⚠️ NICHT die erste geschweifte Klammer nehmen: PHPs eigener Stapel enthaelt „#0 {main}".
$jsonAnfang = strpos($ausgabe, '{"ok"');
$pruefe($jsonAnfang !== false, 'die Antwort enthaelt einen JSON-Rumpf');
$dekodiert = json_decode(substr($ausgabe, (int) $jsonAnfang), true);
$pruefe(is_array($dekodiert), 'der Rumpf ist gueltiges JSON');
$pruefe(($dekodiert['ok'] ?? null) === false, 'er folgt dem Hausvertrag: ok = false');
$pruefe(($dekodiert['error']['code'] ?? '') === 'server_fatal', 'mit dem erwarteten Fehlercode');

echo "fatal-melder-test: {$geprueft} Zusicherungen gruen\n";
