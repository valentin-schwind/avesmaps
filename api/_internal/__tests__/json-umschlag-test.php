<?php

declare(strict_types=1);

/**
 * Der Anfrage-Umschlag (09.10.2026): STRATOs Webserver weist jede JSON-Anfrage mit mehr als 1000
 * einzelnen Werten mit einer HTML-400 ab, bevor PHP sie sieht -- live gemessen (498 Punkte gehen,
 * 499 nicht). Ein Client verpackt seine Nutzlast deshalb als EINE Zeichenkette
 * (`{"avesmaps_umschlag": "<JSON>"}`), avesmapsReadJsonRequest packt sie aus.
 *
 * Ausführen:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/json-umschlag-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$wirft = static function (callable $lauf): bool {
    try {
        $lauf();
    } catch (InvalidArgumentException) {
        return true;
    }
    return false;
};

// 1. Unverpackt bleibt unverändert -- wer nichts verpackt, merkt keinen Unterschied.
$roh = ['action' => 'list_regions', 'kind' => 'vegetation'];
assert(avesmapsJsonUmschlagAuspacken($roh) === $roh, 'eine normale Nutzlast bleibt, wie sie ist');

// 2. Verpackt kommt GENAU die innere Nutzlast heraus -- samt grosser Geometrie.
$ring = [];
for ($i = 0; $i < 700; $i++) {
    $ring[] = [round(500 + 100 * cos($i), 3), round(500 + 100 * sin($i), 3)];
}
$innen = [
    'action' => 'update_area_geometry',
    'public_id' => '5eef5e3d-7366-4b53-b289-4cdf2f9084f8',
    'expected_revision' => 31,
    'geometry_geojson' => ['type' => 'Polygon', 'coordinates' => [$ring]],
];
$json = json_encode($innen, JSON_THROW_ON_ERROR);
// 🪤 Verglichen wird mit dem, was UNVERPACKT angekommen wäre (dasselbe JSON, direkt dekodiert), nicht
// mit dem PHP-Array davor: json_encode schreibt 600.0 als 600, und das kommt als int zurück.
$unverpacktAngekommen = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
$verpackt = ['avesmaps_umschlag' => $json];
assert(avesmapsJsonUmschlagAuspacken($verpackt) === $unverpacktAngekommen,
    'der Umschlag liefert die Nutzlast Wert für Wert so, wie sie unverpackt angekommen wäre');
assert(count($unverpacktAngekommen['geometry_geojson']['coordinates'][0]) === 700,
    'und zwar auch mit 700 Punkten -- unverpackt wären das 1404 Werte, mehr als der Webserver annimmt');

// 3. 🔴 Nur der EINZIGE Schlüssel ist ein Umschlag. Steht etwas daneben, ist es eine echte Nutzlast,
//    und die wird nie umgedeutet.
$mitNachbar = ['avesmaps_umschlag' => '{"action":"delete_area"}', 'action' => 'list_regions'];
assert(avesmapsJsonUmschlagAuspacken($mitNachbar) === $mitNachbar,
    'ein Feld mit diesem Namen NEBEN anderen Feldern wird nicht ausgepackt');

// 4. Kaputte Umschläge sind ein Fehler der Anfrage (400 mit eigener Meldung), kein stilles Leer.
assert($wirft(static fn () => avesmapsJsonUmschlagAuspacken(['avesmaps_umschlag' => '{kaputt'])),
    'ungültiges JSON im Umschlag wirft');
assert($wirft(static fn () => avesmapsJsonUmschlagAuspacken(['avesmaps_umschlag' => ['action' => 'x']])),
    'ein Umschlag, der keine Zeichenkette ist, wirft -- sonst wäre er wieder 1000 Einzelwerte');
assert($wirft(static fn () => avesmapsJsonUmschlagAuspacken(['avesmaps_umschlag' => '"nur text"'])),
    'ein Umschlag, der kein Objekt enthält, wirft');

// 5. Verdrahtung: avesmapsReadJsonRequest packt aus -- der gemeinsame Eingang fast aller Endpunkte.
//    Wer seinen Rumpf selbst liest (curve-labels-run.php), packt selbst aus; das zählt
//    js/app/__tests__/json-umschlag.test.js nach.
$quelle = (string) file_get_contents(__DIR__ . '/../bootstrap.php');
$start = strpos($quelle, 'function avesmapsReadJsonRequest');
$ende = strpos($quelle, "\n}", (int) $start);
assert($start !== false && $ende !== false
    && str_contains(substr($quelle, (int) $start, (int) $ende - (int) $start), 'return avesmapsJsonUmschlagAuspacken($payload);'),
    'avesmapsReadJsonRequest gibt die Nutzlast durch den Umschlag-Auspacker zurück');

echo "ok - json-umschlag\n";
