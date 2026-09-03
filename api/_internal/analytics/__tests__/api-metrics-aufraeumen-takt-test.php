<?php
// api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php
// Das Aufraeumen fragt nur bei jedem hundertsten Request nach -- die Marke ist ein Upsert auf EINE
// Zeile, die alle Anfragen aller Besucher teilen (gemessen 03.09.2026: zwei Schreibvorgaenge je Request).
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/analytics/api-metrics.php';

assert(AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT === 100, 'jeder hundertste');
assert(avesmapsApiMetricsAufraeumenFaellig(1) === true, 'Wurf 1 -> faellig');
for ($w = 2; $w <= 100; $w++) {
    assert(avesmapsApiMetricsAufraeumenFaellig($w) === false, 'Wurf ' . $w . ' -> nicht faellig');
}

// Der Kopf von avesmapsApiMetricsAufraeumen wirft den Wuerfel VOR der ersten Anweisung.
$quelle = (string) file_get_contents($WURZEL . '/api/_internal/analytics/api-metrics.php');
$quelle = (string) preg_replace('#/\*.*?\*/#s', '', $quelle);
$quelle = (string) preg_replace('#^\s*//.*$#m', '', $quelle);
$start = strpos($quelle, 'function avesmapsApiMetricsAufraeumen(PDO $pdo): void');
assert($start !== false);
$rumpf = substr($quelle, $start, 400);
$wurf = strpos($rumpf, 'avesmapsApiMetricsAufraeumenFaellig(random_int(1, AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT))');
$prepare = strpos($rumpf, '$pdo->prepare(');
assert($wurf !== false && $prepare !== false && $wurf < $prepare, 'der Wuerfel steht vor dem ersten prepare');

fwrite(STDOUT, "OK api-metrics-aufraeumen-takt-test\n");
