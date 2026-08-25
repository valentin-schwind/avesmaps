<?php

declare(strict_types=1);

/**
 * Der Lesepfad: Zeitraumschranken und das Aufteilen der rohen `antwort`-Zeilen auf die drei
 * Karten (Endpunkte, Klassen, Zonen).
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md §5
 *
 * ⚠️ Die SQL selbst ist nur angemeldet gegen MySQL pruefbar -- eine unangemeldete Probe endet am
 * edit-Riegel. Deshalb steht die ganze Formung hier in einer reinen Funktion, die ohne Datenbank
 * geprueft wird, und avesmapsApiMetricsLesen holt nur die Zeilen.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-lesen-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../api-metrics.php';

// --- Die Zeitraumschranke ----------------------------------------------------------------------
assert(avesmapsApiMetricsTageGrenze(7) === 7);
assert(avesmapsApiMetricsTageGrenze('30') === 30);
assert(avesmapsApiMetricsTageGrenze(0) === 1, 'unter 1 wird 1');
assert(avesmapsApiMetricsTageGrenze(-5) === 1);
assert(avesmapsApiMetricsTageGrenze(99999) === 400, 'nie ueber die Aufbewahrung hinaus');
assert(avesmapsApiMetricsTageGrenze('keine Zahl') === 1);
assert(avesmapsApiMetricsTageGrenze(null) === 1);

// --- Das Aufteilen -----------------------------------------------------------------------------
$roh = [
    ['dimension' => 'app/map-features|2xx', 'c' => 100],
    ['dimension' => 'app/map-features|5xx', 'c' => 5],
    ['dimension' => 'route/index|2xx', 'c' => 20],
    ['dimension' => 'edit/map/features|leer', 'c' => 3],
    ['dimension' => 'kaputt-ohne-trenner', 'c' => 9],
];
$auf = avesmapsApiMetricsAufteilen($roh);

// Endpunkte: ueber die Klassen summiert, absteigend.
assert($auf['endpunkte'][0] === ['dimension' => 'app/map-features', 'c' => 105]);
assert($auf['endpunkte'][1] === ['dimension' => 'route/index', 'c' => 20]);
assert($auf['endpunkte'][2] === ['dimension' => 'edit/map/features', 'c' => 3]);

// Klassen: ueber die Endpunkte summiert.
$klassen = [];
foreach ($auf['klassen'] as $zeile) {
    $klassen[$zeile['dimension']] = $zeile['c'];
}
assert($klassen['2xx'] === 120);
assert($klassen['5xx'] === 5);
assert($klassen['leer'] === 3, 'die leeren Antworten sind eine eigene Klasse');

// Zonen: aus dem Endpunktschluessel ABGELEITET, nicht gespeichert -- zwei Speicherorte fuer
// dieselbe Aussage laufen auseinander, sobald jemand die Zonenregel aendert.
$zonen = [];
foreach ($auf['zonen'] as $zeile) {
    $zonen[$zeile['dimension']] = $zeile['c'];
}
assert($zonen['app'] === 105);
assert($zonen['offen'] === 20);
assert($zonen['edit'] === 3);

// 🪤 Eine Zeile ohne Trenner darf nichts umbringen und nichts erfinden.
assert(!isset($zonen['kaputt-ohne-trenner']), 'unbrauchbare Zeilen fallen heraus');
assert(count($auf['endpunkte']) === 3, 'und tauchen auch bei den Endpunkten nicht auf');

// 💣 Ein Endpunktschluessel darf selbst keinen Trenner tragen -- geschnitten wird am LETZTEN,
// sonst zerlegte ein Schluessel mit Sonderzeichen die Klasse. Gegenprobe mit einem konstruierten
// Fall, der nur ueber strrpos richtig herauskommt.
$mitTrenner = avesmapsApiMetricsAufteilen([['dimension' => 'a|b|4xx', 'c' => 7]]);
assert($mitTrenner['endpunkte'][0]['dimension'] === 'a|b');
assert($mitTrenner['klassen'][0]['dimension'] === '4xx');

// Leere Eingabe ergibt leere Listen, keine Warnung und keine erfundene Null.
$leer = avesmapsApiMetricsAufteilen([]);
assert($leer['endpunkte'] === [] && $leer['klassen'] === [] && $leer['zonen'] === []);

echo "OK: api-metrics-lesen-test\n";
