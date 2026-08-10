<?php

declare(strict_types=1);

/**
 * Der Punkt der ganzen Uebung, als Test: avesmapsLoadRouteWater() liest gezeichnetes Wasser
 * UNABHAENGIG von `is_trial`.
 *
 * 💣 WARUM DAS EINEN EIGENEN TEST WERT IST. `AND a.is_trial = 0` in dieser einen Abfrage war die
 * EINZIGE Stelle im ganzen Repository, die diese Spalte je gelesen hat -- und solange sie stand, waren
 * die als Erprobung gezeichneten Wasserflaechen fuer das Routing unsichtbar, egal wie viel der Owner
 * zeichnet. Die Erprobung ist am 2026-08-01 abgeschafft; wer den Filter je wieder einzieht (er sieht
 * harmlos aus, und der alte Kommentar daneben hat ihn sogar begruendet), macht frisch gezeichnetes
 * Wasser erneut wirkungslos, ohne dass irgendwo ein Fehler auftaucht.
 *
 * ⭐ Laeuft gegen SQLite im Arbeitsspeicher, ohne MySQL und ohne api/config.local.php: die Funktion
 * nimmt eine fertige PDO entgegen, und die Abfrage ist reines Standard-SQL. Die Leselogik IST damit
 * lokal pruefbar, obwohl das Landschaftsmodul sonst DDL auf dem Lesepfad hat.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring -d extension=pdo_sqlite \
 *       api/_internal/routing/__tests__/water-trial-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- run with -d extension=pdo_sqlite.\n");
    exit(2);
}

require __DIR__ . '/../water-areas.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, region_type TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE ecosystem_area (
    id INTEGER PRIMARY KEY, region_id INTEGER, geometry_geojson TEXT,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER, is_trial INTEGER)');

// Ein Meer, ein See, ein Gebirge -- und ein stillgelegtes Meer, das nie mitkommen darf.
$pdo->exec("INSERT INTO ecosystem_region (id, region_type, is_active) VALUES
    (1, 'meer', 1), (2, 'see', 1), (3, 'gebirge', 1), (4, 'meer', 0)");

$square = static fn(float $x, float $y): string => json_encode([
    'type' => 'Polygon',
    'coordinates' => [[[$x, $y], [$x + 10, $y], [$x + 10, $y + 10], [$x, $y + 10], [$x, $y]]],
]);

$insert = $pdo->prepare('INSERT INTO ecosystem_area
    (region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active, is_trial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
//                          region, geometry,        bbox,                active, TRIAL
$insert->execute([1, $square(0, 0),     0,   0,  10,  10, 1, 0]);   // Meer, kein Stempel
$insert->execute([1, $square(100, 0), 100,   0, 110,  10, 1, 1]);   // 🔴 Meer MIT Stempel
$insert->execute([2, $square(200, 0), 200,   0, 210,  10, 1, 1]);   // 🔴 See MIT Stempel
$insert->execute([3, $square(300, 0), 300,   0, 310,  10, 1, 1]);   // Gebirge -- kein Wasser
$insert->execute([1, $square(400, 0), 400,   0, 410,  10, 0, 0]);   // Meer, stillgelegt
$insert->execute([4, $square(500, 0), 500,   0, 510,  10, 1, 0]);   // Meer in stillgelegter Region

$water = avesmapsLoadRouteWater([], $pdo);

// 🔴 DIE ZEILE, UM DIE ES GEHT: 3 Flaechen, nicht 1. Mit `AND a.is_trial = 0` waere es 1 gewesen --
// das gestempelte Meer und der gestempelte See haetten gefehlt, und eine Querfeldein-Kante quer durch
// sie hindurch waere gebaut worden, als gaebe es dort kein Wasser.
assert(count($water['areas']) === 3,
    'gestempelte Wasserflaechen zaehlen mit: erwartet 3, bekommen ' . count($water['areas']));

// Und die drei Ausschluesse, die BLEIBEN muessen -- sonst ist der Test nur ein "gibt alles zurueck".
$minXs = array_map(static fn(array $area): float => $area['min_x'], $water['areas']);
sort($minXs);
assert($minXs === [0.0, 100.0, 200.0], 'genau Meer + gestempeltes Meer + gestempelter See: ' . json_encode($minXs));
assert(!in_array(300.0, $minXs, true), 'ein Gebirge ist kein Wasser (region_type-Filter haelt)');
assert(!in_array(400.0, $minXs, true), 'eine stillgelegte Flaeche kommt nicht mit (is_active haelt)');
assert(!in_array(500.0, $minXs, true), 'eine Flaeche in stillgelegter Region kommt nicht mit (JOIN haelt)');

// Die Funktion darf bei JEDEM Problem nur leer antworten, niemals werfen -- eine Routenanfrage darf
// nicht 500en, weil die Landschaftsebene einen schlechten Tag hat.
$broken = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$empty = avesmapsLoadRouteWater([], $broken);
assert($empty['areas'] === [], 'fehlende Tabellen -> leer, nicht Ausnahme');

// ============================================================ die beiden anderen Leser
//
// 💣 Es waren am Ende DREI Abfragen, nicht eine. `land-areas.php` und `offroad-data.php` kamen mit dem
// A*/„Hierher reisen"-Umbau dazu und trugen denselben Filter nach -- abgeschrieben aus water-areas.php,
// samt Begruendung. Sie standen noch keine zwei Tage, als die Erprobung abgeschafft wurde. Deshalb
// deckt dieser Test alle drei ab: die Falle vermehrt sich durch Abschreiben.

require __DIR__ . '/../land-areas.php';
require __DIR__ . '/../offroad-data.php';

// --- Land: `kontinent` + `insel`. Ein gestempelter Kontinent muss Land bleiben.
$landPdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$landPdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, region_type TEXT, kind TEXT, is_active INTEGER)');
$landPdo->exec('CREATE TABLE ecosystem_area (
    id INTEGER PRIMARY KEY, region_id INTEGER, geometry_geojson TEXT,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER, is_trial INTEGER)');
$landPdo->exec("INSERT INTO ecosystem_region (id, region_type, kind, is_active) VALUES
    (1, 'kontinent', 'derographisch', 1), (2, 'insel', 'derographisch', 1), (3, 'meer', 'derographisch', 1)");
$landInsert = $landPdo->prepare('INSERT INTO ecosystem_area
    (region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active, is_trial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
$landInsert->execute([1, $square(0, 0),     0, 0,  10, 10, 1, 1]);   // Kontinent MIT Stempel
$landInsert->execute([2, $square(100, 0), 100, 0, 110, 10, 1, 1]);   // Insel MIT Stempel
$landInsert->execute([3, $square(200, 0), 200, 0, 210, 10, 1, 0]);   // Meer -- kein Land

$land = avesmapsLoadRouteLand([], $landPdo);
// Faellt dieser Test, verweigert „Hierher reisen" den Dienst auf gezeichnetem Land: dieser Leser lehnt
// im Zweifel ab, also sieht eine fehlende Zeile aus wie Ozean.
assert(count($land['areas']) === 2,
    'gestempeltes Land zaehlt mit: erwartet 2, bekommen ' . count($land['areas']));

// --- Gelaende: die Offroad-Faktorebene. Ein gestempeltes Gebirge muss den A* bremsen.
$offPdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$offPdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, region_type TEXT, kind TEXT, is_active INTEGER)');
$offPdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, offroad_factor REAL)');
$offPdo->exec('CREATE TABLE ecosystem_area (
    id INTEGER PRIMARY KEY, region_id INTEGER, geometry_geojson TEXT,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER, is_trial INTEGER)');
$offPdo->exec("INSERT INTO ecosystem_region (id, region_type, kind, is_active) VALUES (1, 'gebirge', 'topographie', 1)");
$offPdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, offroad_factor) VALUES ('topographie', 'gebirge', 2.50)");
$offPdo->prepare('INSERT INTO ecosystem_area
    (region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active, is_trial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([1, $square(0, 0), 0, 0, 10, 10, 1, 1]);              // Gebirge MIT Stempel

// ⚠️ Die Box kommt aus avesmapsBuildOffroadBox, nicht von Hand: sie traegt `cell_count` und die
// Rasterbreite, und ein handgestricktes Feld laesst den Rasterer ins Leere greifen.
$offBox = avesmapsBuildOffroadBox(1.0, 1.0, 9.0, 9.0);
$plane = avesmapsOffroadLoadFactorPlane($offPdo, $offBox);
// '' heisst „nichts bekannt" und wird ueberall als Faktor 1,0 gelesen -- das Gebirge kostet dann
// nichts. Am 2026-07-30 war genau das der Livezustand: ALLE 17 gebirge-Flaechen trugen den Stempel.
assert($plane !== '', 'ein gestempeltes Gebirge liefert eine Gelaendeebene, keine leere Zeichenkette');

echo "water-trial-test: all asserts passed (Wasser, Land und Gelaende)
";
