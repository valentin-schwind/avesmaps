<?php

declare(strict_types=1);

/**
 * Die Zeilenbildung der Abenteuer-Vorschau. Entwurf:
 * docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §2/§7, Bauplan Sitzung 2 Task 1.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/game-literature-plan-test.php
 * Exit 0 = alle Zusicherungen halten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../game-literature-sync.php';

// =================================================================================================
// Teil 1: die reine Zeilenbildung (ohne DB)
// =================================================================================================

$desired = [
    'title' => 'Die Sieben Gezeichneten', 'product_type' => 'gruppenabenteuer', 'edition' => 'DSA5',
    'genre' => 'Intrige', 'complexity_gm' => 'hoch', 'complexity_pl' => 'mittel',
    'authors' => 'Ina Kramer', 'series' => 'Sieben Gezeichnete', 'fshop_code' => 'US25001',
    'wiki_url' => 'https://wiki/DSG',
];
$noPlaces = ['add' => [], 'update' => [], 'remove' => []];

// --- Neu ---------------------------------------------------------------------------------------
$item = avesmapsGameLiteraturePlanItem(null, $desired, [], [
    'add' => [['sort_order' => 0, 'raw_name' => 'Havena', 'role' => 'start']],
    'update' => [], 'remove' => [],
], false, false);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['title'] === 'Die Sieben Gezeichneten');
assert($item['before'] === [], 'ein neues Abenteuer hat kein Vorher');
assert($item['after']['places'] === '1 neu', 'die Orte stehen als kurzer Text in der Zeile');

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
$gleich = $desired + ['cover_url' => '', 'cover_source' => ''];
assert(
    avesmapsGameLiteraturePlanItem($gleich, $desired, [], $noPlaces, false, false) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile'
);

// --- Geändert: nur die abweichenden Felder ------------------------------------------------------
$alt = $gleich;
$alt['genre'] = 'Reise';
$item = avesmapsGameLiteraturePlanItem($alt, $desired, [], $noPlaces, false, false);
assert($item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['genre'], 'nur das abweichende Feld, keine ganze Zeile');
assert($item['before']['genre'] === 'Reise');

// --- 💣 Ein Feld-Override ist ein „bleibt", keine Änderung ---------------------------------------
// Abenteuer sind die erste Art mit Overrides JE FELD (field_origins_json) -- bei den Karten ist der
// Override die ganze Karte. Genau dafür steht override_json im Entwurf §5.
$item = avesmapsGameLiteraturePlanItem($alt, $desired, ['genre' => 'manual'], $noPlaces, false, false);
assert($item === null, 'ist das einzige abweichende Feld von Hand gesetzt, gibt es nichts zu fragen');
$alt2 = $alt;
$alt2['authors'] = 'Unbekannt';
$item = avesmapsGameLiteraturePlanItem($alt2, $desired, ['genre' => 'manual'], $noPlaces, false, false);
assert(isset($item['override']['genre']) && $item['override']['genre'] === 'Reise');
assert(!isset($item['after']['genre']), 'und wird NICHT als Änderung vorgeschlagen');
assert(isset($item['after']['authors']), 'die andere Änderung steht sehr wohl da');

// --- Das Titelbild: die Zeile sagt es, der Rechenlauf lädt es NICHT ------------------------------
// 💣 avesmapsGameLiteratureSaveCoverLocal holt das Bild über HTTP und schreibt es nach
// /uploads/questcovers. In der Rechen-Hälfte hat es nichts zu suchen -- die Zeile trägt deshalb
// einen Satz statt einer URL, die es noch nicht gibt.
$item = avesmapsGameLiteraturePlanItem($gleich, $desired, [], $noPlaces, true, false);
assert($item !== null && $item['after']['cover'] === 'wird neu geladen');

// --- Die Übernahme eines Platzhalters steht in der Zeile ----------------------------------------
$item = avesmapsGameLiteraturePlanItem($gleich, $desired, [], $noPlaces, false, true);
assert(
    $item !== null && isset($item['after']['adopt']),
    'dass ein von Hand angelegter Platzhalter zum Wiki-Abenteuer wird, ist der Rede wert'
);

// --- 🔴 Der Verlust hat ein EIGENES Feld --------------------------------------------------------
// Nicht "Orte: 3 entfällt" mitten in einer Aufzählung: das Feld heisst „Orte entfallen" und wird
// vom Bauteil in Warnfarbe gezeichnet (SYNC_PLAN_LOSS_FIELDS). Sonst geht der Verlust in einer
// vorangehäkelten Zeile unter -- Entscheidung 1 des Bauplans.
$item = avesmapsGameLiteraturePlanItem($gleich, $desired, [], [
    'add' => [], 'update' => [], 'remove' => [['id' => 5], ['id' => 6], ['id' => 7]],
], false, false);
assert($item !== null && $item['after']['places_removed'] === 3);
assert(!isset($item['after']['places']), 'kein zweites Feld für dasselbe');

// Zugewinn und Verlust zusammen: zwei Felder, zwei Farben.
$item = avesmapsGameLiteraturePlanItem($gleich, $desired, [], [
    'add' => [['sort_order' => 3, 'raw_name' => 'Neu', 'role' => 'play']],
    'update' => [['id' => 1, 'sort_order' => 0, 'raw_name' => 'Havena', 'role' => 'start']],
    'remove' => [['id' => 9]],
], false, false);
assert($item['after']['places'] === '1 neu, 1 geändert' && $item['after']['places_removed'] === 1);

echo "adventure-plan pure ok\n";

// =================================================================================================
// Teil 2: die read-only-Suche (sqlite)
// =================================================================================================

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE adventure (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT,
    wiki_key TEXT, title TEXT, product_type TEXT, origin TEXT, status TEXT,
    field_origins_json TEXT, cover_url TEXT, cover_source TEXT, edition TEXT, genre TEXT,
    complexity_gm TEXT, complexity_pl TEXT, authors TEXT, series TEXT, fshop_code TEXT, wiki_url TEXT)');
$pdo->exec('CREATE TABLE adventure_place (id INTEGER PRIMARY KEY AUTOINCREMENT, adventure_id INT,
    sort_order INT, raw_name TEXT, role TEXT, origin TEXT, status TEXT)');
$pdo->exec("INSERT INTO adventure (public_id, wiki_key, title, origin, status, field_origins_json)
    VALUES ('p1', 'die-sieben-gezeichneten', 'Die Sieben Gezeichneten', 'wiki', 'approved', '{}')");
$pdo->exec("INSERT INTO adventure (public_id, wiki_key, title, origin, status, field_origins_json)
    VALUES ('p2', NULL, 'Der Platzhalter', 'manual', 'approved', '{}')");
$pdo->exec("INSERT INTO adventure_place (adventure_id, sort_order, raw_name, role, origin, status)
    VALUES (2, 0, 'Irgendwo', 'start', 'wiki', 'approved')");

// Über den wiki_key gefunden -> keine Übernahme.
$found = avesmapsGameLiteraturePlanFindRow($pdo, [
    'wiki_key' => 'die-sieben-gezeichneten', 'title' => 'Die Sieben Gezeichneten',
]);
assert($found['current'] !== null && $found['adopting'] === false);
assert((string) $found['current']['public_id'] === 'p1', 'die Zeile kommt mit, nicht nur ihre id');

// Über den Titel gefunden -> Übernahme, und weil nichts von Hand gesetzt ist, verliert der
// Platzhalter seine Orte (genau das tut avesmapsGameLiteratureFindOrAdoptRow).
$found = avesmapsGameLiteraturePlanFindRow($pdo, ['wiki_key' => 'der-platzhalter', 'title' => 'Der Platzhalter']);
assert($found['adopting'] === true && $found['clears_places'] === true);

// 🔴 UND SIE HAT NICHTS GESCHRIEBEN. Das ist die eigentliche Zusicherung: die Vorlage
// (avesmapsGameLiteratureFindOrAdoptRow) ANTWORTET durch Schreiben -- sie setzt wiki_key, dreht origin
// auf 'wiki' und löscht die Platzhalter-Orte. Eine Vorschau, die das täte, hätte die Übernahme
// schon vollzogen, bevor jemand ein Häkchen gesehen hat.
assert((string) $pdo->query("SELECT origin FROM adventure WHERE public_id='p2'")->fetchColumn() === 'manual');
assert($pdo->query("SELECT wiki_key FROM adventure WHERE public_id='p2'")->fetchColumn() === null);
assert((int) $pdo->query('SELECT COUNT(*) FROM adventure_place')->fetchColumn() === 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM adventure')->fetchColumn() === 2, 'und nichts angelegt');

// Ein von Hand bearbeiteter Platzhalter behält seine Orte.
$pdo->exec("UPDATE adventure SET field_origins_json='{\"genre\":\"manual\"}' WHERE public_id='p2'");
$found = avesmapsGameLiteraturePlanFindRow($pdo, ['wiki_key' => 'der-platzhalter', 'title' => 'Der Platzhalter']);
assert($found['adopting'] === true && $found['clears_places'] === false);
assert(($found['field_origins']['genre'] ?? '') === 'manual', 'und seine Overrides sind bekannt');

// Nichts gefunden -> neu.
$found = avesmapsGameLiteraturePlanFindRow($pdo, ['wiki_key' => 'unbekannt', 'title' => 'Unbekannt']);
assert($found['current'] === null && $found['adopting'] === false && $found['clears_places'] === false);

echo "adventure-plan ok\n";
