<?php

declare(strict_types=1);

/**
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/endpoint-exact-hit-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 DER ZWILLING VON js/map-features/__tests__/location-at-path-endpoint.test.js.
 * Client und Server bauen denselben Graphen; weicht die Endpunkt-Zuordnung auseinander, liefert die
 * Karte eine andere Route als POST /api/route/. Beide Tests halten dieselben drei Livefaelle fest.
 *
 * Bis 2026-08-07 stand hier ausdruecklich „lowest index wins", damit ein geteilter ?s=-Link stabil
 * bleibt. Der Gedanke war richtig, die Umsetzung entschied aber AUCH dann nach der Reihenfolge,
 * wenn ein Ort exakt getroffen war: gemessen 541 von 11.662 Endpunkten am falschen Ort, 165 Wege
 * als Selbstkante. Die Reihenfolge bleibt Schiedsrichter -- aber erst, wenn kein Ort dasteht.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../client-graph.php';

/** @return array{0: array<int, array<string, mixed>>, 1: array<string, list<int>>} */
function endpointFixture(array $rows): array {
    $locations = [];
    foreach ($rows as $row) {
        $locations[] = ['name' => $row[0], 'route_x' => $row[1], 'route_y' => $row[2]];
    }

    return [$locations, avesmapsBuildClientLocationCellIndex($locations)];
}

function nameAt(array $locations, array $cellIndex, float $x, float $y): ?string {
    $hit = avesmapsFindClientLocationAtPathEndpoint($locations, $cellIndex, [$x, $y]);

    return $hit === null ? null : (string) $hit['name'];
}

// --- Fall 1: Tolakstein / Alarasruh -------------------------------------------------------------
// Livewerte. Abstand 0,623 -- aber dx 0,4087 und dy 0,4701 liegen beide unter der Toleranz 0,5,
// also steckt Alarasruh in Tolaksteins Kasten und stand frueher in der Liste.
[$locations, $cellIndex] = endpointFixture([
    ['Alarasruh', 574.5, 499.5],
    ['Tolakstein', 574.09126, 499.97011],
]);
assert(nameAt($locations, $cellIndex, 574.091, 499.97) === 'Tolakstein',
    'ein Endpunkt auf Tolakstein gehoert Tolakstein, nicht dem frueheren Nachbarn');
assert(nameAt($locations, $cellIndex, 574.5, 499.5) === 'Alarasruh',
    'und Alarasruhs eigener Endpunkt bleibt bei Alarasruh');

// --- Fall 2: Fischbach / Kreuzung-599 -----------------------------------------------------------
// Livewerte, Abstand 0,025. Sechs Wegenden lagen exakt auf Fischbach; alle sechs bekam die Kreuzung.
[$locations, $cellIndex] = endpointFixture([
    ['Kreuzung-599', 713.07, 640.016],
    ['Fischbach', 713.047, 640.008],
]);
assert(nameAt($locations, $cellIndex, 713.047, 640.008) === 'Fischbach',
    'eine Kreuzung 0,025 daneben schnappt Fischbachs eigene Wegenden nicht weg');

// --- Fall 3: Neu-Süderwacht -- die Selbstkante --------------------------------------------------
// Strasse-5831 laeuft von der Feste zum Dorf. Beide Enden loesten auf das Dorf auf: eine Schleife.
// Sichtbar wurde das als Route, die „nach Reichsgrenzfeste Neu-Süderwacht" hiess und im Dorf endete.
[$locations, $cellIndex] = endpointFixture([
    ['Neu-Süderwacht', 431.2, 750.4],
    ['Reichsgrenzfeste Neu-Süderwacht', 431.7, 750.775],
]);
$anfang = nameAt($locations, $cellIndex, 431.7, 750.775);
$ende = nameAt($locations, $cellIndex, 431.2, 750.4);
assert($anfang === 'Reichsgrenzfeste Neu-Süderwacht', 'der Anfang liegt auf der Feste');
assert($ende === 'Neu-Süderwacht', 'das Ende liegt auf dem Dorf');
assert($anfang !== $ende, 'und damit ist Strasse-5831 eine echte Kante statt einer Schleife');

// --- Die Reihenfolge darf bei einem exakten Treffer nichts mehr entscheiden ---------------------
[$locations, $cellIndex] = endpointFixture([
    ['Tolakstein', 574.09126, 499.97011],
    ['Alarasruh', 574.5, 499.5],
]);
assert(nameAt($locations, $cellIndex, 574.091, 499.97) === 'Tolakstein',
    'dieselbe Antwort bei umgedrehter Reihenfolge');

// --- Der 0,5-Kasten bleibt das Fangnetz fuer LOSE Enden -----------------------------------------
// 💣 Nur 97,5 % der Endpunkte liegen naeher als 0,01 an einem Ort. Die uebrigen 246 haengen allein
// an diesem Kasten; faellt er weg, verlieren ihre Wege beide Knoten und Gegenden koppeln ab.
[$locations, $cellIndex] = endpointFixture([['Loses Ende', 100.0, 100.0]]);
assert(nameAt($locations, $cellIndex, 100.3, 100.2) === 'Loses Ende',
    'ein Ende, das auf keinem Ort liegt, faengt weiterhin der 0,5-Kasten');
assert(nameAt($locations, $cellIndex, 100.8, 100.0) === null,
    'jenseits von 0,5 faengt es weiterhin niemand');

// --- Zwei lose Enden im selben Kasten: „lowest index wins" bleibt ------------------------------
// ⚠️ Absicht. Ohne exakten Treffer ist die Reihenfolge willkuerlich, aber sie FASST ZUSAMMEN, und
// dieses Zusammenfassen haelt Knoten im Netz, zwischen denen kein Weg gezeichnet ist. Gemessen:
// auf „naechster gewinnt" umzustellen riss 56 Knoten aus dem Hauptnetz.
[$locations, $cellIndex] = endpointFixture([['Erster', 200.4, 200.0], ['Zweiter', 200.1, 200.0]]);
assert(nameAt($locations, $cellIndex, 200.2, 200.0) === 'Erster',
    'ohne exakten Treffer entscheidet weiter der kleinste Index, nicht der Abstand');

fwrite(STDOUT, "endpoint-exact-hit tests passed\n");
