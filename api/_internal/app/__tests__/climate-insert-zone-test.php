<?php

declare(strict_types=1);

/**
 * Der Test zum Auftrag vom 2026-08-03: „Die vorhandenen Klimazonen und ihre Grenzlinien sind bereits
 * korrekt und duerfen nicht veraendert, verschoben oder neu berechnet werden."
 *
 * 🔴 WAS HIER BEWIESEN WIRD: eine Zone zwischen zwei bestehende zu schieben laesst jede vorhandene
 * Trennlinie BYTEGLEICH stehen. Bis heute tat der Abgleich das Gegenteil -- er loeschte bei jeder
 * Aenderung der Zonenzahl ALLE Linien und verteilte sie gleichmaessig neu. Eine einzige Saatzeile
 * haette damit jede von Hand gezogene Grenze vernichtet.
 *
 * Laeuft gegen pdo_sqlite, weil der Abgleich reine DML ist (kein DDL, keine MySQL-Eigenheiten):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/climate-insert-zone-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../climate-zones.php';
require __DIR__ . '/../ecosystem.php';

// ---- Aufbau: sieben Zonen, sechs von Hand gezogene Linien -------------------------------------------

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INT, is_active INT DEFAULT 1)');
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, kind TEXT, region_type TEXT, is_active INT DEFAULT 1)');
$pdo->exec('CREATE TABLE ecosystem_climate_divider (seq INT PRIMARY KEY, geometry_geojson TEXT, revision INT DEFAULT 1, south_type_key TEXT, updated_by INT)');

$alteZonen = [
    ['polar', 'Polare Zone', 10], ['subpolar', 'Subpolare Zone', 20], ['boreal', 'Boreale Zone', 30],
    ['gemaessigt', 'Gemäßigte Zone', 40], ['subtropen_winterfeucht', 'Winterfeuchte Subtropen', 50],
    ['subtropisch', 'Subtropische Zone', 60], ['tropisch', 'Tropische Zone', 70],
];
foreach ($alteZonen as $index => [$key, $label, $sort]) {
    $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES (?, ?, ?, ?)')
        ->execute(['klima', $key, $label, $sort]);
    $pdo->prepare('INSERT INTO ecosystem_region (id, public_id, kind, region_type) VALUES (?, ?, ?, ?)')
        ->execute([$index + 1, 'r-' . $key, 'klima', $key]);
}

// Von Hand gezogen, mit Knick und Ueberhang -- genau die Arbeit, die nicht verlorengehen darf.
$handarbeit = [
    [[0, 880], [400, 860], [1024, 870]],
    [[0, 760], [300, 740], [700, 780], [1024, 755]],
    [[0, 640], [1024, 620]],
    [[0, 505], [250, 500], [520, 470], [1024, 495]],
    // Die Oberkante der Wueste, mit einer Blase -- ihre Form ist der Bezugspunkt des Auftrags.
    [[0, 380], [300, 375], [520, 330], [430, 300], [660, 295], [1024, 360]],
    [[0, 200], [1024, 210]],
];
foreach ($handarbeit as $index => $punkte) {
    $pdo->prepare('INSERT INTO ecosystem_climate_divider (seq, geometry_geojson, revision, south_type_key) VALUES (?, ?, ?, ?)')
        ->execute([
            $index + 1,
            json_encode(avesmapsClimateNormalizeDivider(['type' => 'LineString', 'coordinates' => $punkte])),
            7,
            $alteZonen[$index + 1][0],
        ]);
}

$vorher = [];
foreach ($pdo->query('SELECT south_type_key, geometry_geojson, revision FROM ecosystem_climate_divider')->fetchAll() as $row) {
    $vorher[(string) $row['south_type_key']] = ['geo' => (string) $row['geometry_geojson'], 'rev' => (int) $row['revision']];
}
assert(count($vorher) === 6, 'six hand-drawn dividers to start with');

// ---- Der Einschub ------------------------------------------------------------------------------------
// Die neue Zone kommt zwischen die winterfeuchten Subtropen und die Subtropische Zone.

$pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES (?, ?, ?, ?)')
    ->execute(['klima', 'trockene_subtropen', 'Trockene Subtropen', 55]);
$pdo->prepare('INSERT INTO ecosystem_region (id, public_id, kind, region_type) VALUES (?, ?, ?, ?)')
    ->execute([99, 'r-trockene_subtropen', 'klima', 'trockene_subtropen']);

$zonen = avesmapsEcosystemClimateZones($pdo);
assert(count($zonen) === 8, 'eight zones after the insert');
assert($zonen[5]['type_key'] === 'trockene_subtropen', 'and the new one sits at position six, north to south');

$geaendert = avesmapsEcosystemClimateReconcileDividers($pdo, $zonen, 0);
assert($geaendert === true, 'the reconciler reports that it wrote something');

// ---- 🔴 DIE EIGENTLICHE PRUEFUNG: nichts Vorhandenes wurde angefasst --------------------------------

$nachher = [];
foreach ($pdo->query('SELECT seq, south_type_key, geometry_geojson, revision FROM ecosystem_climate_divider ORDER BY seq')->fetchAll() as $row) {
    $nachher[(string) $row['south_type_key']] = [
        'seq' => (int) $row['seq'], 'geo' => (string) $row['geometry_geojson'], 'rev' => (int) $row['revision'],
    ];
}
assert(count($nachher) === 7, 'seven dividers for eight zones');

foreach ($vorher as $key => $alt) {
    assert(isset($nachher[$key]), "the divider below '{$key}' still exists");
    assert($nachher[$key]['geo'] === $alt['geo'], "the divider below '{$key}' is BYTE-IDENTICAL -- not moved, not recomputed");
    assert($nachher[$key]['rev'] === $alt['rev'], "and its revision is untouched, so no client runs into a false conflict");
}

// Die neue Linie ist die EINZIGE, die dazugekommen ist.
assert(isset($nachher['trockene_subtropen']), 'the new band has its own divider');
assert(count(array_diff(array_keys($nachher), array_keys($vorher))) === 1, 'exactly one divider is new');

// ---- Die UNTERKANTE des neuen Bandes ist die unveraenderte Wuesten-Oberkante ------------------------
// „Die untere Begrenzung des neuen Bandes muss exakt der vorhandenen Oberkante der Zone folgen." Das
// ist keine Rechnung, sondern eine Folge der Bauart: das Band zwischen Linie 5 und Linie 6 hat als
// Unterkante Linie 6 -- und die ist byteweise dieselbe wie vorher (oben geprueft).

$wuestenkante = json_decode($vorher['subtropisch']['geo'], true)['coordinates'];
$neueLinie = json_decode($nachher['trockene_subtropen']['geo'], true)['coordinates'];

// 🪤 Die OBERkante ist hier eine Gerade, keine angehobene Kopie -- die Wuestenkante hat eine Blase, und
// deren parallel angehobene Kopie schneidet ihr eigenes Original (in climate-zones-test.php als reine
// Rechnung nachgestellt). Der zweite Weg legt dann eine Gerade in den freien Streifen.
$hoechsteWueste = max(array_column($wuestenkante, 1));
$tiefsteObere = min(array_column(json_decode($vorher['subtropen_winterfeucht']['geo'], true)['coordinates'], 1));
foreach ($neueLinie as [$unusedX, $y]) {
    assert($y > $hoechsteWueste, 'the new line runs entirely above the desert edge');
    assert($y < $tiefsteObere, 'and entirely below its upper neighbour');
}
assert(!avesmapsClimatePolylinesCross($neueLinie, $wuestenkante), 'and it crosses neither of them');

// ---- Die Reihenfolge stimmt, und der Verbund ist gueltig --------------------------------------------

$erwartet = ['subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht', 'trockene_subtropen', 'subtropisch', 'tropisch'];
foreach ($erwartet as $index => $key) {
    assert($nachher[$key]['seq'] === $index + 1, "divider for '{$key}' is numbered " . ($index + 1));
}
avesmapsClimateAssertOrder(array_map(
    static fn(array $d): array => avesmapsClimateNormalizeDivider(json_decode($d['geo'], true)),
    array_map(static fn(string $k): array => $nachher[$k], $erwartet)
));

// ---- Und ein zweiter Lauf schreibt nichts mehr ------------------------------------------------------
// 💣 Ohne das haette jeder Aufruf von climate_get die Reihenfolge neu geschrieben und die Revision
// gehoben -- also jedem Besucher bei jedem Editoraufruf den Flaechen-Cache entwertet.

assert(avesmapsEcosystemClimateReconcileDividers($pdo, avesmapsEcosystemClimateZones($pdo), 0) === false,
    'a second run is a no-op');

fwrite(STDOUT, "climate-insert-zone-test: OK\n");
