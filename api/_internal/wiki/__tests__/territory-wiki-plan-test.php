<?php

declare(strict_types=1);

/**
 * Die COMPUTE-Haelfte der Wiki-Kopie: wie eine Unterschiedszeile aussieht, und welche Zeilen nie eine
 * werden duerfen. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-plan-test.php
 *
 * Teil 1 ist rein (ohne Datenbank). Teil 2 nutzt sqlite fuer die zwei Riegel, die von Natur aus SQL
 * sind: der Leer-Riegel und die Trennung Waise / benutzt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-wiki-plan.php';

// =================================================================================================
// TEIL 1 -- avesmapsTerritoryWikiPlanItem, rein
// =================================================================================================

$staging = [
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'type' => 'Fürstentum',
    'ruler' => 'Growin Sohn des Grimbrand',
    'population' => '181.000',
    'currency' => '',
];

// --- Neu ------------------------------------------------------------------------------------------
$item = avesmapsTerritoryWikiPlanItem(null, $staging);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['name'] === 'Fürstentum Kosch');
assert($item['before'] === [], 'eine neue Kopie hat kein Vorher');
assert(!array_key_exists('currency', $item['after']), 'leere Felder stehen nicht in der Zeile');

// --- Nichts zu tun = keine Zeile --------------------------------------------------------------------
$same = ['name' => 'Fürstentum Kosch', 'type' => 'Fürstentum', 'ruler' => 'Growin Sohn des Grimbrand',
    'population' => '181.000', 'currency' => 'Kosch-Taler'];
assert(
    avesmapsTerritoryWikiPlanItem($same, $staging) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile -- sonst stuende die Vorschau jedes Mal voll'
);

// --- 💣 Ein leerer frischer Wert ueberschreibt nie einen guten -------------------------------------
//
// Der Dump liefert zur Waehrung nichts, in der Kopie steht "Kosch-Taler". Das ist keine Aenderung --
// und darf auch keine Zeile werden, sonst haekelt jemand sie an und loescht damit einen guten Wert.
// Genau diese Falle ist beim Kontinent schon einmal zugeschnappt (sync-monitor-identity.php, COALESCE).
$mirror = $same;
$mirror['ruler'] = 'Blasius von Eberstamm';
$item = avesmapsTerritoryWikiPlanItem($mirror, $staging);
assert($item !== null && $item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['ruler'], '💣 nur das Oberhaupt, NICHT die Waehrung');
assert($item['before']['ruler'] === 'Blasius von Eberstamm');

// --- Die andere Haelfte der Leerwert-Regel: ein LEERER ALTWERT ist kein Schutz --------------------
//
// Nur der FRISCHE Wert darf nie ein leeres Nichts vortaeuschen (siehe oben). Ein leerer oder fehlender
// ALTWERT gegen einen echten frischen Wert ist eine ganz normale Aenderung -- sonst bliebe ein Feld, das
// die Kopie noch nie hatte, fuer immer ungefuellt, weil niemand je gefragt wird.
$emptyMirror = $same;
$emptyMirror['ruler'] = '';
$item = avesmapsTerritoryWikiPlanItem($emptyMirror, $staging);
assert($item !== null && $item['change_type'] === 'changed', 'leerer Altwert gegen echten Frischwert IST eine Aenderung');
assert(array_keys($item['after']) === ['ruler']);
assert($item['after']['ruler'] === 'Growin Sohn des Grimbrand');
assert($item['before']['ruler'] === '', 'das Vorher ist leer, nicht abwesend');

$nullMirror = $same;
$nullMirror['ruler'] = null;
$item = avesmapsTerritoryWikiPlanItem($nullMirror, $staging);
assert($item !== null && $item['change_type'] === 'changed', 'ein NULL-Altwert verhaelt sich wie ein leerer');
assert($item['after']['ruler'] === 'Growin Sohn des Grimbrand');
assert($item['before']['ruler'] === '');

// --- Der Feld-Deckel --------------------------------------------------------------------------------
$manyStaging = [];
$manyMirror = [];
foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $index => $field) {
    $manyStaging[$field] = 'neu-' . $index;
    $manyMirror[$field] = 'alt-' . $index;
}
$item = avesmapsTerritoryWikiPlanItem($manyMirror, $manyStaging);
$limit = AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT;
assert(count($item['after']) === $limit + 1, 'gedeckelt, plus die Zahl der uebrigen');
assert(
    (int) $item['after']['fields_more'] === count(AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS) - $limit,
    'und die Zahl stimmt -- sie ist zugleich das, was eine Veraltung verraet'
);
assert(count($item['before']) === $limit, 'das Vorher zeigt dieselben Felder');

// =================================================================================================
// TEIL 2 -- die zwei Riegel, auf sqlite
// =================================================================================================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE political_territory_wiki (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT)');
$pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_id INTEGER,
    wiki_key TEXT, name TEXT, is_active INTEGER DEFAULT 1)');

$addMirror = static function (PDO $pdo, string $key, string $name): int {
    $pdo->prepare('INSERT INTO political_territory_wiki (wiki_key, name) VALUES (:k, :n)')
        ->execute(['k' => $key, 'n' => $name]);
    return (int) $pdo->lastInsertId();
};

$koschId = $addMirror($pdo, 'wiki:f-rstentum-kosch', 'Fürstentum Kosch');   // lebt, ist im Staging
$wehrsoldId = $addMirror($pdo, 'wiki:grafschaft-wehrsold', 'Grafschaft Wehrsold'); // benutzt ueber wiki_id, Artikel weg
$greifenfurtId = $addMirror($pdo, 'wiki:grafschaft-greifenfurt', 'Grafschaft Greifenfurt'); // benutzt NUR ueber wiki_key, Artikel weg
$altGarethId = $addMirror($pdo, 'wiki:baronie-alt-gareth', 'Baronie Alt-Gareth'); // Waise
$addMirror($pdo, 'wiki:koenigreich-thorwal-alt', 'Königreich Thorwal (alt)');     // Waise

// Ein Kartengebiet zeigt auf Wehrsold -- ueber wiki_id. Ein zweites auf Greifenfurt -- NUR ueber den
// Schluessel (wiki_id NULL, z.B. weil das Gebiet angelegt wurde, bevor es die wiki_id-Spalte gab). Beide
// Pfade muessen "benutzt" ergeben -- die WHERE-Bedingung der Abfrage prueft ausdruecklich ODER.
$pdo->prepare('INSERT INTO political_territory (wiki_id, wiki_key, name) VALUES (:w, :k, :n)')
    ->execute(['w' => $wehrsoldId, 'k' => 'wiki:grafschaft-wehrsold', 'n' => 'Grafschaft Wehrsold']);
$pdo->prepare('INSERT INTO political_territory (wiki_id, wiki_key, name) VALUES (NULL, :k, :n)')
    ->execute(['k' => 'wiki:grafschaft-greifenfurt', 'n' => 'Grafschaft Greifenfurt']);

// --- 💣 Der Leer-Riegel (Entwurf §6c) --------------------------------------------------------------
//
// Leeres Staging heisst "Syncen lief nicht", NICHT "das Wiki hat alles geloescht". Der Schaden waere
// eine Vorschau, die jede Kopie zum Loeschen anbietet -- und irgendwann klickt jemand.
$result = avesmapsTerritoryWikiVanishedRows($pdo, []);
assert($result['orphans'] === [] && $result['in_use'] === [], '💣 leeres Staging => keine einzige Zeile');

$pdo->exec("INSERT INTO political_territory_wiki_test (wiki_key, name) VALUES ('wiki:f-rstentum-kosch', 'Fürstentum Kosch')");

$result = avesmapsTerritoryWikiVanishedRows($pdo, []);
$orphanKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['orphans']);
sort($orphanKeys);
assert($orphanKeys === ['wiki:baronie-alt-gareth', 'wiki:koenigreich-thorwal-alt'], 'genau die zwei Waisen');

// --- 💣 Eine benutzte Kopie wird NIE angeboten -- gleich ueber welchen Pfad sie gefunden wird --------
//
// An ihr haengen sechs Zeilen der Infobox eines echten Gebiets, und es gibt keinen Wiki-Artikel mehr,
// aus dem sie zurueckkaemen. Genannt wird sie trotzdem -- sonst sieht die Gruppe nach "alles erledigt" aus.
// Beide Verweisarten muessen greifen: Wehrsold haengt ueber wiki_id, Greifenfurt NUR ueber wiki_key.
assert(!in_array('wiki:grafschaft-wehrsold', $orphanKeys, true), '💣 benutzte Kopie (wiki_id): keine Loeschzeile');
assert(!in_array('wiki:grafschaft-greifenfurt', $orphanKeys, true), '💣 benutzte Kopie (NUR wiki_key): keine Loeschzeile');
$inUseKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['in_use']);
assert($inUseKeys === ['wiki:grafschaft-greifenfurt', 'wiki:grafschaft-wehrsold'], 'beide Pfade im Vorspann genannt');
assert($result['in_use'][0]['name'] === 'Grafschaft Greifenfurt', 'mit Namen, nicht als Zahl');
assert($result['in_use'][1]['name'] === 'Grafschaft Wehrsold');

// --- Der Behalten-Riegel ---------------------------------------------------------------------------
$result = avesmapsTerritoryWikiVanishedRows($pdo, ['wiki:baronie-alt-gareth']);
$orphanKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['orphans']);
assert($orphanKeys === ['wiki:koenigreich-thorwal-alt'], 'abgelehnte Loeschung wird nie wieder gefragt');

echo "territory-wiki-plan ok\n";
