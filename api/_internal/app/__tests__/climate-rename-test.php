<?php

declare(strict_types=1);

/**
 * Unit test for renaming a climate zone in the LIVING stock. Needs pdo_sqlite, no MySQL.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       -d extension=php_mbstring.dll api/_internal/app/__tests__/climate-rename-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 WHY THIS EXISTS. avesmapsEcosystemSeedRegionTypes writes with INSERT IGNORE: it creates missing
 * types and NEVER touches existing ones. So editing a label in AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED
 * changes only how a FRESH database looks -- the running one keeps the old name, silently, and the
 * rename looks done in the diff while nothing moved on the site. That is the failure this guards.
 *
 * The expectations read the seed constant instead of spelling names out, so the test survives the
 * NEXT rename too -- it tests the mechanism, not today's wording.
 */

require_once __DIR__ . '/../ecosystem.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(1);
}

/** The label the seed currently gives a zone. */
$seedLabel = static function (string $typeKey): string {
    foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $key, $label, $sortOrder]) {
        if ($kind === 'klima' && $key === $typeKey) {
            return $label;
        }
    }
    throw new RuntimeException("die Zone {$typeKey} steht nicht mehr in der Saat");
};

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INT)');
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT, region_type TEXT)');

// Der Bestand, wie er VOR der Umbenennung aussah: die Art traegt einen alten Namen, und ihre Region
// traegt genau denselben (so legt avesmapsEcosystemClimateEnsure sie an).
$seedRow = static function (PDO $pdo, string $key, string $label, int $sort, string $regionName): void {
    $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES (?, ?, ?, ?)')
        ->execute(['klima', $key, $label, $sort]);
    $pdo->prepare('INSERT INTO ecosystem_region (public_id, name, kind, region_type) VALUES (?, ?, ?, ?)')
        ->execute(['r-' . $key, $regionName, 'klima', $key]);
};

$seedRow($pdo, 'trockene_subtropen', 'Alter Name A', 55, 'Alter Name A');
$seedRow($pdo, 'subtropisch', 'Alter Name B', 60, 'Alter Name B');
// Diese hier ist bereits richtig benannt und darf gar nicht angefasst werden.
$seedRow($pdo, 'tropisch', $seedLabel('tropisch'), 70, $seedLabel('tropisch'));
// Eine Region, die der Owner SELBST umbenannt hat. Ihr Name ist im Regionen-Editor bearbeitbar und
// darf von einer Textkorrektur an der Art nicht ueberschrieben werden.
$seedRow($pdo, 'polar', 'Alter Name C', 10, 'Ganz oben, von Hand benannt');

$label = static fn(PDO $pdo, string $key): string => (string) $pdo
    ->query("SELECT label FROM ecosystem_region_type WHERE kind = 'klima' AND type_key = '{$key}'")
    ->fetchColumn();
$regionName = static fn(PDO $pdo, string $key): string => (string) $pdo
    ->query("SELECT name FROM ecosystem_region WHERE kind = 'klima' AND region_type = '{$key}'")
    ->fetchColumn();

// ---------------------------------------------------------------- der Lauf ---------------------

assert(avesmapsEcosystemClimateReconcileLabels($pdo) === true,
    'es gab etwas umzubenennen, also meldet der Lauf eine Aenderung (und die Revision steigt)');

// Beide Stellen sind mitgezogen -- das Vokabular UND der Name im Bestand.
assert($label($pdo, 'trockene_subtropen') === $seedLabel('trockene_subtropen'),
    'die Art traegt jetzt den Namen aus der Saat');
assert($regionName($pdo, 'trockene_subtropen') === $seedLabel('trockene_subtropen'),
    '💣 und die REGION auch -- die Karte und „Fuehrt durch" lesen ihren Namen, nicht das Label');
assert($label($pdo, 'subtropisch') === $seedLabel('subtropisch'), 'dasselbe fuer die zweite Zone');
assert($regionName($pdo, 'subtropisch') === $seedLabel('subtropisch'), 'auch bei ihr beide Stellen');

// 🔴 Die eigene Benennung des Owners ueberlebt. Nur das Label der Art wandert mit.
assert($regionName($pdo, 'polar') === 'Ganz oben, von Hand benannt',
    '🔴 eine selbst benannte Region behaelt ihren Namen -- sonst frisst eine Textkorrektur die Arbeit des Owners');
assert($label($pdo, 'polar') === $seedLabel('polar'),
    'ihre ART wird trotzdem richtig beschriftet -- das eine hat mit dem anderen nichts zu tun');

// ---------------------------------------------------------------- idempotent -------------------

assert(avesmapsEcosystemClimateReconcileLabels($pdo) === false,
    'ein zweiter Lauf direkt danach schreibt nichts mehr und hebt die Revision nicht');
assert($regionName($pdo, 'polar') === 'Ganz oben, von Hand benannt', 'und ruehrt die Handarbeit auch beim zweiten Mal nicht an');
assert($regionName($pdo, 'tropisch') === $seedLabel('tropisch'), 'die bereits richtige Zone bleibt, wie sie war');

// ---------------------------------------------------------------- leerer Bestand ---------------
// Vor der ersten Saat gibt es nichts umzubenennen -- und schon gar keinen Fehler.

$leer = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$leer->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INT)');
$leer->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT, region_type TEXT)');
assert(avesmapsEcosystemClimateReconcileLabels($leer) === false, 'ohne Saat passiert nichts');

fwrite(STDOUT, "climate-rename-test: OK\n");
