<?php

declare(strict_types=1);

// avesmapsWikiPathVerlaufReadAssignments liest die weiteren Zuweisungen mit (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/path-weitere-verlauf-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../path-verlauf.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT,
    feature_subtype TEXT, properties_json TEXT, is_active INTEGER DEFAULT 1)');
$st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, properties_json) VALUES (:id, :n, 'path', 'Reichsstrasse', :p)");
$st->execute(['id' => 'rs-7', 'n' => 'Reichsstraße 2', 'p' => json_encode([
    'wiki_path' => ['wiki_key' => 'reichsstrasse-2'],
    'wiki_path_weitere' => [['wiki_key' => 'b-renpfad'], ['wiki_key' => ''], 'kaputt'],
])]);
$st->execute(['id' => 'rs-6', 'n' => 'Reichsstraße 2', 'p' => json_encode(['wiki_path' => ['wiki_key' => 'reichsstrasse-2']])]);

$gelesen = avesmapsWikiPathVerlaufReadAssignments($pdo);
assert($gelesen['byPublicId']['rs-7']['weitere'] === ['b-renpfad'], json_encode($gelesen['byPublicId']['rs-7']));
assert($gelesen['byPublicId']['rs-6']['weitere'] === [], 'ohne Liste eine leere Liste');
assert(count($gelesen['byWikiKey']['reichsstrasse-2']) === 2, 'die Hauptzuordnung ist unveraendert');
assert(!isset($gelesen['byWikiKey']['b-renpfad']), 'eine weitere Zuweisung macht den Abschnitt NICHT zum Mitglied des Artikels');

echo "path-weitere-verlauf-test.php: ok\n";
