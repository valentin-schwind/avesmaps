<?php

declare(strict_types=1);

// PHP-Zwilling der Endenbenennung (Entwurf 2026-09-14 §4). Liest dieselbe Fixture wie der JS-Test.
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/weg-abschnitt-ende-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../weg-abschnitt-ende.php';

$wurzel = dirname(__DIR__, 4);
$fixture = json_decode((string) file_get_contents($wurzel . '/tools/paths/fixtures/weg-abschnitt-enden.json'), true);
$index = avesmapsWegOrtIndex($fixture['orte']);
foreach ($fixture['faelle'] as $fall) {
    $ist = avesmapsWegEndeName($fall['punkt'], $index, (float) $fixture['toleranz']);
    assert($ist === $fall['erwartet'], $fall['warum'] . ': ' . $ist);
}

// Drei Stellen derselben Zahl
assert(AVESMAPS_WEG_ENDE_TOLERANZ === (float) $fixture['toleranz']);
$clientGraph = (string) file_get_contents($wurzel . '/api/_internal/routing/client-graph.php');
assert(preg_match('/const AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT = ([0-9.]+);/', $clientGraph, $treffer) === 1);
assert((float) $treffer[1] === AVESMAPS_WEG_ENDE_TOLERANZ, 'Toleranz weicht vom Router ab');

// Orte lesen: Orte und beide Kreuzungsarten, aktiv
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_json TEXT, is_active INTEGER DEFAULT 1)');
$st = $pdo->prepare('INSERT INTO map_features (name, feature_type, feature_subtype, geometry_json, is_active) VALUES (?, ?, ?, ?, ?)');
$st->execute(['Silkwiesen', 'location', 'dorf', '{"type":"Point","coordinates":[100,50]}', 1]);
$st->execute(['Kreuzung', 'crossing', 'crossing', '{"type":"Point","coordinates":[102,52]}', 1]);
$st->execute(['', 'junction', 'crossing', '{"type":"Point","coordinates":[103,53]}', 1]);
$st->execute(['Alt', 'location', 'dorf', '{"type":"Point","coordinates":[1,1]}', 0]);
$st->execute(['Reichsstraße 2', 'path', 'Reichsstrasse', '{"type":"LineString","coordinates":[[0,0],[1,1]]}', 1]);
$orte = avesmapsWegOrteLesen($pdo);
assert(count($orte) === 3, json_encode($orte));
assert($orte[0] === ['name' => 'Silkwiesen', 'x' => 100.0, 'y' => 50.0, 'kreuzung' => false]);
assert($orte[1]['kreuzung'] === true && $orte[2]['kreuzung'] === true);

echo "weg-abschnitt-ende-test.php: ok\n";
