<?php

declare(strict_types=1);

/**
 * Eine neu berechnete Aussenhuelle hinterlaesst keine Leiche.
 *
 * Der Befund (04.09.2026): political_territory_derived_geometry trug 5.263 inaktive Zeilen gegen 131
 * aktive -- 88 MB, in zehn Tagen nach der letzten Aufraeumung nachgewachsen. Der Erzeuger war
 * avesmapsPoliticalSaveDerivedGeometry: je Neuberechnung wurde die alte Zeile auf is_active = 0
 * gesetzt und eine neue angelegt; nichts liest oder reaktiviert je eine inaktive Huelle. Seit dem
 * 05.09.2026 raeumt der Speicherpfad die ueberholten Zeilen SEINES Gebiets in derselben Transaktion
 * weg. Der Test faehrt den Speicherpfad wirklich -- deshalb kommt generated_at seither aus dem
 * Spalten-Default statt aus einem `CURRENT_TIMESTAMP(3)`, das SQLite nicht parst.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     -d extension=php_mbstring.dll api/_internal/political/__tests__/derived-huelle-ohne-leiche-test.php
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

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../derived-orphans.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT,
    color TEXT, opacity REAL, is_active INTEGER, sort_order INTEGER,
    min_zoom INTEGER, max_zoom INTEGER, valid_from_bf INTEGER, valid_to_bf INTEGER,
    capital_place_id INTEGER, seat_place_id INTEGER, wiki_key TEXT, wiki_url TEXT, valid_label TEXT
)');
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    source TEXT, style_json TEXT, geometry_geojson TEXT,
    created_by INTEGER, created_at TEXT, updated_by INTEGER, updated_at TEXT,
    valid_from_bf INTEGER, valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
// Spaltenliste = Live-DDL vom 04.09.2026 (Dump). generated_at traegt dort DEFAULT CURRENT_TIMESTAMP(3);
// hier der SQLite-Gegenwert, damit der INSERT des Speicherpfads ohne den Wert auskommt.
$pdo->exec('CREATE TABLE political_territory_derived_geometry (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER, geometry_geojson TEXT,
    label_lng REAL, label_lat REAL, min_zoom INTEGER, max_zoom INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, show_inner_boundaries INTEGER DEFAULT 1,
    inner_boundary_geojson TEXT, fill_remainder_geojson TEXT, contested_pieces_geojson TEXT,
    source_revision TEXT, generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, updated_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)');
$pdo->exec('CREATE TABLE political_territory_wiki (
    id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, type TEXT, affiliation_path_json TEXT,
    affiliation_raw TEXT, affiliation_root TEXT, founded_text TEXT, dissolved_text TEXT,
    capital_name TEXT, seat_name TEXT
)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE political_territory_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
    undo_audit_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)');

// Der Zielaufloeser erkennt ein Gebiet an einer UUID -- deshalb echte UUIDs, keine Kuerzel.
const BLATT = '11111111-1111-4111-8111-111111111111';
const GEIST = '22222222-2222-4222-8222-222222222222';
$pdo->exec("INSERT INTO political_territory (id, public_id, name, parent_id, is_active, continent, min_zoom, max_zoom) VALUES
    (1, '" . GEIST . "', 'Neues Herrschaftsgebiet (1008)', NULL, 1, 'Aventurien', 0, 6),
    (2, '" . BLATT . "', 'Támenev',                        NULL, 1, 'Aventurien', 0, 6)");
$pdo->exec("INSERT INTO political_territory_geometry
    (id, public_id, territory_id, is_active, source, created_by, created_at, min_x, min_y, max_x, max_y) VALUES
    (10, 'g-blatt', 2, 1, '', 7, '2026-08-04 10:00:00', 0.0, 0.0, 10.0, 10.0)");
// Die Ausgangslage, wie sie live nach jeder Neuberechnung aussah: eine aktive Huelle, dahinter die
// ueberholten -- und beim Geist eine deaktivierte OHNE Nachfolgerin (Quelle geloescht, weicher Weg).
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (public_id, territory_id, is_active, geometry_geojson, min_x, min_y, max_x, max_y, created_by) VALUES
    ('d-blatt-alt-1', 2, 0, '{}', 0, 0, 10, 10, 7),
    ('d-blatt-alt-2', 2, 0, '{}', 0, 0, 10, 10, 7),
    ('d-blatt-aktiv', 2, 1, '{}', 0, 0, 10, 10, 7),
    ('d-geist-weg',   1, 0, '{}', 0, 0, 10, 10, 7)");
$pdo->exec("INSERT INTO users (id, username) VALUES (7, 'valentin')");

function huellen(PDO $pdo, int $territoryId): array {
    $s = $pdo->prepare('SELECT public_id, is_active FROM political_territory_derived_geometry WHERE territory_id = :t ORDER BY id');
    $s->execute(['t' => $territoryId]);
    return $s->fetchAll(PDO::FETCH_ASSOC);
}
$flaeche = ['type' => 'Polygon', 'coordinates' => [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];

assert(count(huellen($pdo, 2)) === 3, 'Ausgangslage: drei Zeilen fuer das Blatt, eine davon aktiv');

// ===== 1. Neuberechnung: genau EINE Zeile bleibt, die neue, aktiv ===============================
$antwort = avesmapsPoliticalSaveDerivedGeometry($pdo, [
    'territory_public_id' => BLATT,
    'geometry_geojson' => $flaeche,
], ['id' => 7]);
assert(($antwort['ok'] ?? false) === true, 'der Speicherpfad antwortet ok');
$neuePublicId = (string) ($antwort['derived_geometry']['public_id'] ?? '');
assert($neuePublicId !== '' && ($antwort['derived_geometry']['is_active'] ?? false) === true, 'die Antwort traegt die neue, aktive Huelle');
$nachher = huellen($pdo, 2);
assert(count($nachher) === 1, 'nach der Neuberechnung steht fuer das Blatt genau EINE Zeile -- keine ueberholte bleibt liegen');
assert($nachher[0]['public_id'] === $neuePublicId && (int) $nachher[0]['is_active'] === 1, 'und es ist die neue, aktive');
// 💣 Die Gegenprobe zur Reichweite: die Huelle des Geists hat keine Nachfolgerin und ist weich
// deaktiviert -- der Owner-Entscheid vom 16.08.2026. Sie geht den Speicherpfad des Blatts nichts an.
assert(huellen($pdo, 1) === [['public_id' => 'd-geist-weg', 'is_active' => 0]] || huellen($pdo, 1) === [['public_id' => 'd-geist-weg', 'is_active' => '0']],
    'die deaktivierte Huelle eines ANDEREN Gebiets bleibt stehen');

// ===== 2. Weich loeschen, dann neu berechnen: der Leichnam faellt beim Zurueckholen ===============
$loeschung = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, ['id' => 2, 'public_id' => BLATT], ['id' => 7]);
assert($loeschung['hard'] === false, 'ein Blatt mit eigener Flaeche wird nur deaktiviert (der bestehende Vertrag)');
$weich = huellen($pdo, 2);
assert(count($weich) === 1 && (int) $weich[0]['is_active'] === 0, 'die Huelle steht deaktiviert da -- „Grenzen berechnen" kann sie zurueckholen');
$zweite = avesmapsPoliticalSaveDerivedGeometry($pdo, ['territory_public_id' => BLATT, 'geometry_geojson' => $flaeche], ['id' => 7]);
$zurueck = huellen($pdo, 2);
assert(count($zurueck) === 1 && (int) $zurueck[0]['is_active'] === 1 && $zurueck[0]['public_id'] === ($zweite['derived_geometry']['public_id'] ?? null),
    'zurueckgeholt heisst: eine NEUE aktive Zeile, und die deaktivierte ist weg');

// ===== 3. Der Helfer selbst: nur inaktive, nur dieses Gebiet =====================================
$pdo->exec("INSERT INTO political_territory_derived_geometry (public_id, territory_id, is_active, geometry_geojson, min_x, min_y, max_x, max_y) VALUES
    ('d-blatt-fremd-tot', 2, 0, '{}', 0, 0, 1, 1)");
assert(avesmapsPoliticalPruneSupersededDerivedGeometry($pdo, 2) === 1, 'der Helfer entfernt die eine inaktive Zeile des Blatts');
assert(count(huellen($pdo, 2)) === 1 && (int) huellen($pdo, 2)[0]['is_active'] === 1, 'und laesst die aktive stehen');
assert(count(huellen($pdo, 1)) === 1, 'die Zeile des Geists hat er nicht angefasst');
assert(avesmapsPoliticalPruneSupersededDerivedGeometry($pdo, 1) === 1, 'gerufen fuer den Geist, raeumt er dessen Zeile -- die Reichweite ist das Gebiet, das man ihm nennt');

echo "OK: derived-huelle-ohne-leiche-test -- eine Neuberechnung hinterlaesst genau eine aktive Zeile; deaktivierte Huellen anderer Gebiete bleiben.\n";
