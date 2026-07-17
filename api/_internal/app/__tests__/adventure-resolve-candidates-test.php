<?php

declare(strict_types=1);

/**
 * Regression test for the CANDIDATE LOADER in api/_internal/app/adventure-resolve.php --
 * avesmapsAdventureLoadCandidates(), i.e. "which map_features rows can a place name resolve to".
 *
 * Unlike adventure-resolve-test.php (pure matcher, candidate maps handed in ready-made), this one has
 * to touch a PDO: the bug it guards lives in the loader's SQL WHERE clause, so a test that stubbed the
 * rows out would stay green while the query still filtered them away -- a false green of exactly the
 * kind adventure-resolve-test.php warns about. An in-memory SQLite DB is the smallest thing that
 * exercises the REAL query text. No MySQL, no network. Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/adventure-resolve-candidates-test.php
 * Exit 0 = all asserts passed.
 *
 * WHAT IT PINS (owner report 2026-07-17, "Regengebirge wird nicht aufgelöst"): a landscape label is
 * a resolvable place regardless of WHICH landscape subtype it carries. map_features labels have 19
 * subtypes (api/_internal/map/features.php: region, gebirge, wald, insel, kontinent, ...); only 140
 * of the 529 live landscape labels are subtype='region'. The loader used to scan that one subtype,
 * so the other 389 -- Regengebirge (gebirge), Aventurien (kontinent) -- could never resolve. The
 * gate is the WIKI LINK, not the subtype.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll "
        . "-d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../adventure-resolve.php';

// Minimal stand-ins for the two tables the loader reads. Only the columns it selects/filters on --
// the real DDL lives inline in the app libs and is MySQL-flavoured.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT, properties_json TEXT, is_active INTEGER
)');
$pdo->exec("CREATE TABLE political_territory (public_id TEXT, wiki_key TEXT)");

// Landscape label rows in the LIVE shape: the wiki link sits NESTED under properties.wiki_region.
$insert = $pdo->prepare('INSERT INTO map_features VALUES (:pid, :type, :subtype, :name, :props, 1)');
$label = static function (string $pid, string $subtype, string $name) use ($insert): void {
    $insert->execute([
        'pid' => $pid, 'type' => 'label', 'subtype' => $subtype, 'name' => $name,
        'props' => json_encode([
            'name' => $name,
            'feature_type' => 'label',
            'feature_subtype' => $subtype,
            'wiki_region' => ['wiki_key' => strtolower($name), 'name' => $name,
                'wiki_url' => 'https://de.wiki-aventurica.de/wiki/' . str_replace(' ', '_', $name)],
        ], JSON_UNESCAPED_UNICODE),
    ]);
};

$label('L-REGENGEBIRGE', 'gebirge', 'Regengebirge');       // the owner's report
$label('L-AVENTURIEN', 'kontinent', 'Aventurien');         // 8 unresolved citymaps on the live payload
$label('L-RASCHTULSWALL', 'region', 'Raschtulswall');      // control: already worked, must keep working
$label('L-NAMENLOS', 'wald', 'Namenloser Forst');          // control: no wiki link -> NOT a candidate
$pdo->prepare('UPDATE map_features SET properties_json = :p WHERE public_id = :i')
    ->execute(['p' => json_encode(['name' => 'Namenloser Forst']), 'i' => 'L-NAMENLOS']);

$candidates = avesmapsAdventureLoadCandidates($pdo);

// 1) THE BUG: a Gebirge label is a region candidate, findable by its page name.
$m = avesmapsAdventureMatchCandidates('Regengebirge', $candidates);
assert($m['kind'] === 'region', "Regengebirge muss als Region aufloesen, war: {$m['kind']}");
assert($m['public_id'] === 'L-REGENGEBIRGE', "falsche public_id: {$m['public_id']}");
echo "gebirge-label resolves (Regengebirge) ok\n";

// 2) Same cause, different subtype -- a continent label.
$m = avesmapsAdventureMatchCandidates('Aventurien', $candidates);
assert($m['kind'] === 'region' && $m['public_id'] === 'L-AVENTURIEN', 'Aventurien (kontinent) muss aufloesen');
echo "kontinent-label resolves (Aventurien) ok\n";

// 3) NO REGRESSION: the subtype that already worked still resolves to the same row.
$m = avesmapsAdventureMatchCandidates('Raschtulswall', $candidates);
assert($m['kind'] === 'region' && $m['public_id'] === 'L-RASCHTULSWALL', 'Raschtulswall darf nicht brechen');
echo "region-label still resolves (Raschtulswall) ok\n";

// 4) The gate is the WIKI LINK, not the subtype: a label without one stays unresolved.
$m = avesmapsAdventureMatchCandidates('Namenloser Forst', $candidates);
assert($m['kind'] === 'unresolved', "Label ohne Wiki-Link darf nicht aufloesen, war: {$m['kind']}");
echo "label without wiki link stays unresolved ok\n";

echo "\nALL OK\n";
