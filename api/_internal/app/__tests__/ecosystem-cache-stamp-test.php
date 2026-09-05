<?php
declare(strict_types=1);
require_once __DIR__ . '/../ecosystem.php';
require_once __DIR__ . '/../climate-membership.php';
if (ini_get('zend.assertions') !== '1') { exit(2); }

// Ausschließlich die MySQL-Schreibsyntax übersetzen, die echten Funktionen ausführen.
final class EcosystemStampTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        $statement = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $statement);
        $statement = str_replace('ON DUPLICATE KEY UPDATE revision = revision + 1',
            'ON CONFLICT(id) DO UPDATE SET revision = revision + 1', $statement);
        return parent::exec($statement);
    }
}
$pdo = new EcosystemStampTestPdo('sqlite::memory:');
$pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
$pdo->exec('CREATE TABLE ecosystem_assignment_stamp (id INTEGER PRIMARY KEY, computed_at TEXT)');
$pdo->exec('INSERT INTO ecosystem_revision VALUES (1, 100)');
$vorher = avesmapsClimateReadStamp($pdo);
assert(avesmapsNextEcosystemRevision($pdo, false) === 101);
assert(avesmapsClimateReadStamp($pdo) === $vorher, 'Gelände lässt den Kartenstempel unverändert, auch beim Übergang.');
avesmapsNextEcosystemRevision($pdo, false);
assert(avesmapsClimateReadStamp($pdo) === $vorher);
avesmapsNextEcosystemRevision($pdo);
$klima = avesmapsClimateReadStamp($pdo);
assert($klima !== $vorher, 'Klima-/Beschriftungsänderungen bleiben abgedeckt.');
$pdo->exec("INSERT INTO ecosystem_assignment_stamp VALUES (1, '2026-09-05 10:00:00.123')");
assert(avesmapsClimateReadStamp($pdo) !== $klima, 'Neue Zuordnungen bleiben abgedeckt.');
$pdo->exec('DELETE FROM ecosystem_revision');
assert(avesmapsNextEcosystemRevision($pdo) === 2);
assert(str_starts_with(avesmapsClimateReadStamp($pdo), '2:'), 'Neue Installation initialisiert beide Zähler.');
echo "OK: getrennte Landschafts- und Kartenrevision.\n";
