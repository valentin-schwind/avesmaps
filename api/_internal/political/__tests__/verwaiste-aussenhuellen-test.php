<?php

declare(strict_types=1);

/**
 * Eine abgeleitete Aussenhuelle ohne jede Quellflaeche ist gezeichnet, aber unerreichbar.
 * Dieser Test haelt das Praedikat fest, das Scanner, Bulk-Knopf und Loesch-Weiche TEILEN.
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

if (!defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT')) {
    define('AVESMAPS_POLITICAL_DEFAULT_CONTINENT', 'Aventurien');
}

require_once __DIR__ . '/../territories-derived-geometry-shared.php';
require_once __DIR__ . '/../territories-derived-geometry.php';
require_once __DIR__ . '/../derived-orphans.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT,
    color TEXT, opacity REAL, is_active INTEGER, sort_order INTEGER,
    min_zoom INTEGER, max_zoom INTEGER, valid_from_bf INTEGER, valid_to_bf INTEGER
)');
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER
)');
$pdo->exec('CREATE TABLE political_territory_derived_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, created_by INTEGER, created_at TEXT
)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');

// 1 Geist: Huelle, kein Kind, keine eigene Flaeche.  (= "Neues Herrschaftsgebiet (1008)")
// 2 Blatt mit eigener Flaeche.                        (= Támenev)
// 3 Aggregat, dessen Flaeche beim KIND 4 liegt.       (= Grafschaft Winhall)
// 5 Huelle, deren Territorium geloescht wurde.        (dangling)
// 6 Blatt, dessen einzige Flaeche INAKTIV ist.        (= Geist auf dem zweiten Weg)
$pdo->exec("INSERT INTO political_territory (id, public_id, name, parent_id, is_active, continent) VALUES
    (1, 'p-geist',  'Neues Herrschaftsgebiet (1008)', NULL, 1, 'Aventurien'),
    (2, 'p-blatt',  'Támenev',                        NULL, 1, 'Aventurien'),
    (3, 'p-aggr',   'Grafschaft Winhall',             NULL, 1, 'Aventurien'),
    (4, 'p-kind',   'Reichsland Winhall',                3, 1, 'Aventurien'),
    (6, 'p-inaktiv','Gebiet mit toter Flaeche',       NULL, 1, 'Aventurien')");
$pdo->exec("INSERT INTO political_territory_geometry (id, public_id, territory_id, is_active) VALUES
    (10, 'g-blatt', 2, 1),
    (11, 'g-kind',  4, 1),
    (12, 'g-tot',   6, 0)");
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (20, 'd-geist',   1, 1, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00'),
    (21, 'd-blatt',   2, 1,   0.0,   0.0,  10.0,  10.0, 7, '2026-08-04 10:00:00'),
    (22, 'd-aggr',    3, 1,   0.0,   0.0,  20.0,  20.0, 7, '2026-08-04 10:00:00'),
    (23, 'd-dangling',5, 1,   0.0,   0.0,   5.0,   5.0, 7, '2026-08-04 10:00:00'),
    (24, 'd-inaktiv', 6, 1,   0.0,   0.0,   6.0,   6.0, 7, '2026-08-04 10:00:00'),
    (25, 'd-weg',     1, 0, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00')");
$pdo->exec("INSERT INTO users (id, username) VALUES (7, 'valentin')");

$territories  = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
$withGeometry = avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo);

$withKeys = array_keys($withGeometry);
sort($withKeys);
assert($withKeys === [2, 4], 'nur AKTIVE Flaechen aktiver Gebiete zaehlen');

assert(avesmapsPoliticalDerivedHullIsSourceless(1, $territories, $withGeometry) === true,
    'der Geist hat keine Quelle');
assert(avesmapsPoliticalDerivedHullIsSourceless(2, $territories, $withGeometry) === false,
    'ein Blatt mit eigener Flaeche ist keine Waise');
// 💣 Die Gegenprobe, an der die Rechnung haengt: das Aggregat hat SELBST keine Flaeche, seine
// Quelle liegt beim Kind. Wer nur das Gebiet fragt statt der Nachfahren, erklaert Winhall,
// Kosch und die Nordmarken zu Geistern -- live waeren das 111 von 114.
assert(avesmapsPoliticalDerivedHullIsSourceless(3, $territories, $withGeometry) === false,
    'ein Aggregat lebt von den Flaechen seiner Kinder');
assert(avesmapsPoliticalDerivedHullIsSourceless(5, $territories, $withGeometry) === true,
    'eine Huelle ohne Territorium ist erst recht verwaist');
assert(avesmapsPoliticalDerivedHullIsSourceless(6, $territories, $withGeometry) === true,
    'eine INAKTIVE Flaeche ist keine Quelle');

$hulls = avesmapsPoliticalCollectSourcelessDerivedHulls($pdo);
$ids = array_map(static fn(array $r): string => (string) $r['derived_geometry_public_id'], $hulls);
sort($ids);
assert($ids === ['d-dangling', 'd-geist', 'd-inaktiv'], 'genau die drei Waisen, in keiner Reihenfolge fixiert');
// 🔴 Eine bereits deaktivierte Huelle ist kein Fund -- sie zeichnet nichts und ist kein Befund.
assert(!in_array('d-weg', $ids, true), 'inaktive Huellen bleiben draussen');

$geist = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-geist') { $geist = $row; }
}
assert(is_array($geist), 'der Geist ist dabei');
assert((string) $geist['territory_name'] === 'Neues Herrschaftsgebiet (1008)', 'mit seinem Namen');
assert((string) $geist['territory_public_id'] === 'p-geist', 'und seinem Gebiet');
assert((string) $geist['created_by'] === 'valentin', 'und dem Urheber aus users');
assert(abs((float) $geist['area'] - 5884.4) < 0.5, 'Flaeche = Breite x Hoehe der Bounding-Box (64,1 x 91,8)');

$dangling = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-dangling') { $dangling = $row; }
}
assert((string) $dangling['territory_name'] === '(KEIN TERRITORIUM)',
    'dieselbe Beschriftung wie bei verwaisten Konturen -- eine Vokabel, nicht zwei');

echo "OK: verwaiste-aussenhuellen-test\n";
