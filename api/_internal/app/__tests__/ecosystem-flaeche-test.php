<?php

declare(strict_types=1);

// Die PHP-Flaechenrechnung muss dasselbe liefern wie ecosystemGeometryArea im Browser
// (js/map-features/map-features-ecosystem-geometry.js) -- sie ERSETZT sie fuer die
// Stapelreihenfolge. Dieselben Faelle, die der JS-Test dort prueft.
//
// 🔴 Das ist keine zweite Wahrheit, sondern ein Umzug: die JS-Fassung der STAPELREGEL faellt im
// selben Umbau weg. Danach rechnet die Reihenfolge nur noch hier.

require_once __DIR__ . '/../ecosystem-flaeche.php';

// --- Einheitsquadrat ------------------------------------------------------------------------------
$quadrat = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
assert(abs(avesmapsEcosystemGeometryArea($quadrat) - 100.0) < 1e-9, 'Quadrat 10x10 = 100');

// --- Wicklungssinn ist egal: eine Flaeche ist eine GROESSE, keine Richtung ------------------------
$rueckwaerts = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]]];
assert(abs(avesmapsEcosystemGeometryArea($rueckwaerts) - 100.0) < 1e-9, 'Wicklungssinn egal');

// --- Ein offener Ring zaehlt wie ein geschlossener ------------------------------------------------
// Die Shoelace-Schleife verbindet letzten und ersten Punkt ohnehin; ein fehlender Schlusspunkt darf
// die Flaeche nicht halbieren.
$offen = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [10, 0], [10, 10], [0, 10]]]];
assert(abs(avesmapsEcosystemGeometryArea($offen) - 100.0) < 1e-9, 'offener Ring = geschlossener Ring');

// --- Loecher werden abgezogen ---------------------------------------------------------------------
$mitLoch = ['type' => 'Polygon', 'coordinates' => [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
]];
assert(abs(avesmapsEcosystemGeometryArea($mitLoch) - 96.0) < 1e-9, 'Loch 2x2 abgezogen');

// --- MultiPolygon summiert, und jeder Teil zieht SEINE Loecher ab ---------------------------------
$multi = ['type' => 'MultiPolygon', 'coordinates' => [
    [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
    ],
    [[[20, 20], [25, 20], [25, 25], [20, 25], [20, 20]]],
]];
assert(abs(avesmapsEcosystemGeometryArea($multi) - 121.0) < 1e-9, 'MultiPolygon: 96 + 25');

// --- Unbrauchbares zaehlt 0 -----------------------------------------------------------------------
// 🪤 0 heisst „ganz oben" in der Stapelung -- der ungefaehrliche Platz: die Flaeche verdeckt nichts,
// sie ist nur selbst erreichbar. Dieselbe Lesart wie in der abgeschafften JS-Regel.
assert(avesmapsEcosystemGeometryArea(null) === 0.0, 'null = 0');
assert(avesmapsEcosystemGeometryArea([]) === 0.0, 'leer = 0');
assert(avesmapsEcosystemGeometryArea(['type' => 'Point', 'coordinates' => [1, 2]]) === 0.0, 'Punkt = 0');
assert(avesmapsEcosystemGeometryArea(['type' => 'Polygon', 'coordinates' => 'kaputt']) === 0.0, 'Koordinaten kein Array = 0');
assert(avesmapsEcosystemGeometryArea(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1]]]]) === 0.0, 'Ring mit 2 Ecken = 0');

// --- Eine Ecke ohne zwei Zahlen macht den ganzen Ring unbrauchbar, nicht bloss sich selbst ---------
// 💣 Sonst kaeme eine willkuerliche Teilflaeche heraus, und die entschiede dann ueber die Stapelung.
$kaputteEcke = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [10, 0], [10], [0, 10], [0, 0]]]];
assert(avesmapsEcosystemGeometryArea($kaputteEcke) === 0.0, 'unvollstaendige Ecke = ganzer Ring 0');

// --- Die Groessenordnung der Karte: 0..1024 --------------------------------------------------------
// Aventurien als Ganzes gegen eine kleine Provinz -- die Reihenfolge, um die es geht.
$gross = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [1024, 0], [1024, 1024], [0, 1024], [0, 0]]]];
$klein = ['type' => 'Polygon', 'coordinates' => [[[100, 100], [110, 100], [110, 110], [100, 110], [100, 100]]]];
assert(avesmapsEcosystemGeometryArea($gross) > avesmapsEcosystemGeometryArea($klein), 'gross > klein');

echo "ok - ecosystem-flaeche\n";
