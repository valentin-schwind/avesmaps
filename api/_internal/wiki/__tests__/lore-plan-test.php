<?php

declare(strict_types=1);

/**
 * Die Zeilenbildung der Vorkommen-Vorschau und ihre drei Riegel. Entwurf:
 * docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §2/§7, Bauplan Sitzung 2 Task 10.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/lore-plan-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../lore-sync.php';

// =================================================================================================
// Teil 1: die reine Zeilenbildung
// =================================================================================================

$desired = [
    'kind' => 'flora', 'wiki_title' => 'Wirselkraut', 'wiki_url' => 'https://wiki/W',
    'name' => 'Wirselkraut', 'gruppe' => 'Heilpflanze', 'typ' => 'Kraut',
    'lebensraum' => 'Wälder', 'synonyme' => '', 'merkmale_json' => '{"a":1}', 'continent' => 'Aventurien',
];
$leerePlaetze = ['add' => [], 'remove' => [], 'kept' => 0, 'suppressed' => 0];
$leereQuellen = ['add' => 0, 'update' => 0, 'remove' => 0, 'add_titles' => [], 'remove_titles' => []];

// --- Neu ---------------------------------------------------------------------------------------
$item = avesmapsLorePlanItem(null, $desired, [], [
    'add' => [['place_wiki_key' => 'weiden'], ['place_wiki_key' => 'donf']],
    'remove' => [], 'kept' => 0, 'suppressed' => 0,
], $leereQuellen);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['name'] === 'Wirselkraut' && $item['before'] === []);
assert($item['after']['occurrences'] === '2 neu');
// Ein leeres Feld auf einem Eintrag, den es noch nicht gibt, ist keine Nachricht.
assert(!isset($item['after']['synonyme']));

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
assert(
    avesmapsLorePlanItem($desired, $desired, [], $leerePlaetze, $leereQuellen) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile'
);

// --- Geändert: nur die abweichenden Felder ------------------------------------------------------
$alt = $desired;
$alt['lebensraum'] = 'Sümpfe';
$item = avesmapsLorePlanItem($alt, $desired, [], $leerePlaetze, $leereQuellen);
assert($item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['lebensraum'] && $item['before']['lebensraum'] === 'Sümpfe');

// --- 💣 merkmale_json gehört nicht in eine Zeile ------------------------------------------------
// Ein JSON-Klumpen als Wert macht die Zeile 800 Zeichen breit, und dann liest niemand mehr die
// daneben. Die Vorschau sagt, DASS er sich ändert.
$alt = $desired;
$alt['merkmale_json'] = '{"a":2}';
$item = avesmapsLorePlanItem($alt, $desired, [], $leerePlaetze, $leereQuellen);
assert($item['after']['merkmale_json'] === 'geändert' && $item['before']['merkmale_json'] === 'anders');
assert(!str_contains(json_encode($item, JSON_UNESCAPED_UNICODE), '"a":1'), 'der Klumpen steht nicht drin');

// --- Ein Feld-Override ist ein „bleibt", keine Änderung ------------------------------------------
$item = avesmapsLorePlanItem($alt, $desired, ['merkmale_json' => 'manual'], $leerePlaetze, $leereQuellen);
assert($item === null, 'ist das einzige abweichende Feld von Hand gesetzt, gibt es nichts zu fragen');
$alt2 = $alt;
$alt2['gruppe'] = 'Unkraut';
$item = avesmapsLorePlanItem($alt2, $desired, ['merkmale_json' => 'manual'], $leerePlaetze, $leereQuellen);
assert(($item['override']['merkmale_json'] ?? '') === 'eigene Merkmale');
assert(!isset($item['after']['merkmale_json']), 'und wird NICHT als Änderung vorgeschlagen');

// --- 🔴 Der Verlust hat ein EIGENES Feld, getrennt vom Zugewinn ----------------------------------
$item = avesmapsLorePlanItem($desired, $desired, [], [
    'add' => [], 'remove' => [1, 2, 3, 4], 'kept' => 1, 'suppressed' => 0,
], $leereQuellen);
assert($item !== null && $item['after']['occurrences_removed'] === 4);
assert(!isset($item['after']['occurrences']), 'kein zweites Feld für dasselbe');

// --- Ein Grabstein steht als „bleibt unterdrückt" da ---------------------------------------------
// Sonst behauptet die Vorschau, das Wiki würde etwas anlegen, was es nie tun wird.
$item = avesmapsLorePlanItem($desired, $desired, [], [
    'add' => [], 'remove' => [], 'kept' => 2, 'suppressed' => 3,
], ['add' => 1, 'update' => 0, 'remove' => 0, 'add_titles' => ['Bote 42'], 'remove_titles' => []]);
assert(str_contains((string) $item['override']['occurrences'], '3 unterdrückte'));

// --- Die Quellen reisen mit (der Reconcile ruft je Eintrag den geteilten Abgleich) ---------------
$item = avesmapsLorePlanItem($desired, $desired, [], $leerePlaetze, [
    'add' => 2, 'update' => 0, 'remove' => 1, 'add_titles' => ['Bote 42'], 'remove_titles' => ['Alte Quelle'],
]);
assert(str_contains((string) $item['after']['sources'], '2 neu'));
assert($item['after']['sources_removed'] === 1);
assert(str_contains((string) $item['after']['sources_removed_titles'], 'Alte Quelle'));

// --- 💣 Leerer Katalog am Anfang: aussteigen, und zwar VOR dem Lauf ------------------------------
assert(avesmapsLorePlanStagingEmpty([], '') === true);
assert(
    avesmapsLorePlanStagingEmpty([], 'wirselkraut') === false,
    'mitten im Lauf ist ein leeres Fenster das ENDE des Katalogs, nicht ein leerer Katalog'
);
assert(avesmapsLorePlanStagingEmpty([['wiki_key' => 'w']], '') === false);

// Und der Ausstieg steht im Rumpf VOR dem Eröffnen des Laufs. Ohne diese Zusicherung wäre die reine
// Funktion oben grün und ein offener, guter Plan trotzdem überschrieben („superseded").
//
// ⚠️ Geprüft wird die FORM, nicht die Stelle: „steht vorher" ist bei einem `if (false && …)` genauso
// wahr wie bei einem wirksamen Riegel -- der Aufruf bliebe stehen und die Reihenfolge stimmte weiter.
// Verlangt sind deshalb die genaue Bedingung UND ein `return` zwischen ihr und dem Eröffnen des Laufs.
// (Presence is not execution -- die Lehre aus 1b450f70.)
$stepSource = (string) file_get_contents(__DIR__ . '/../lore-sync.php');
$stepAt = (int) strpos($stepSource, 'function avesmapsLorePlanStep');
assert($stepAt > 0, 'der Rechen-Schritt existiert');
$guardAt = strpos($stepSource, 'if (avesmapsLorePlanStagingEmpty($staged, $cursor)) {', $stepAt);
$startAt = strpos($stepSource, 'avesmapsSyncPlanStartRun(', $stepAt);
assert(
    is_int($guardAt) && is_int($startAt) && $guardAt < $startAt,
    '🔴 der Leerkatalog-Riegel steht -- unverändert und vor avesmapsSyncPlanStartRun'
);
assert(
    str_contains(substr($stepSource, $guardAt, $startAt - $guardAt), 'return $stats;'),
    '🔴 und er kehrt zurück, statt nur etwas zu vermerken'
);

echo "lore-plan pure ok\n";

// =================================================================================================
// Teil 2: die Stilllegungszeilen (sqlite)
// =================================================================================================

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE wiki_lore_catalog (wiki_key TEXT PRIMARY KEY, name TEXT)');
$pdo->exec('CREATE TABLE lore_entry (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, kind TEXT,
    name TEXT, origin TEXT, status TEXT)');
$pdo->exec('CREATE TABLE lore_place (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_wiki_key TEXT,
    place_wiki_key TEXT, relation TEXT, origin TEXT, status TEXT)');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT,
    entity_public_id TEXT, source_id INT, origin TEXT, status TEXT)');
foreach (['wirselkraut', 'donf', 'tarnele'] as $key) {
    $pdo->prepare("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
        VALUES (?, 'flora', ?, 'wiki', 'active')")->execute([$key, ucfirst($key)]);
}
// Handarbeit und eine längst stillgelegte Zeile: keine von beiden darf je auftauchen.
$pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
    VALUES ('eigenes-kraut', 'flora', 'Eigenes Kraut', 'manual', 'active')");
$pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
    VALUES ('altes-kraut', 'flora', 'Altes Kraut', 'wiki', 'retired')");
$pdo->exec("INSERT INTO lore_place (entry_wiki_key, place_wiki_key, relation, origin, status)
    VALUES ('donf', 'weiden', 'verbreitung', 'wiki', 'active')");
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('lore', 'donf', 7, 'wiki_publication', 'approved')");

// --- 💣 Der Leerkatalog-Riegel steckt IN der Funktion, nicht nur beim Aufrufer -------------------
// Ein leerer Katalog heisst „Dump holen lief nicht", nie „das Wiki hat alles vergessen". Der Schaden
// hat die Form gewechselt, nicht die Größe: früher eine stille Massen-Stilllegung, jetzt eine
// Vorschau, die 5.100 davon vorschlägt -- und irgendwann klickt jemand.
assert(avesmapsLoreRetirableRows($pdo, []) === [], 'leerer Katalog => keine einzige Stilllegungszeile');

// --- Katalog kennt nur noch eines der drei -> genau zwei Zeilen ----------------------------------
$pdo->exec("INSERT INTO wiki_lore_catalog (wiki_key, name) VALUES ('tarnele', 'Tarnele')");
$zeilen = avesmapsLoreRetirableRows($pdo, []);
assert(count($zeilen) === 2, 'zwei verschwundene Wiki-Einträge -- und nur die');
$keys = array_map(static fn(array $r): string => $r['wiki_key'], $zeilen);
assert(!in_array('eigenes-kraut', $keys, true), 'Handarbeit wird nie stillgelegt');
assert(!in_array('altes-kraut', $keys, true), 'und was schon liegt, wird nicht zweimal gefragt');
assert(!in_array('tarnele', $keys, true), 'und was im Katalog steht, schon gar nicht');

// --- 💣 Der Behalten-Riegel (Entwurf §2/§8) ------------------------------------------------------
$zeilen = avesmapsLoreRetirableRows($pdo, ['wirselkraut']);
assert(count($zeilen) === 1 && $zeilen[0]['wiki_key'] === 'donf');
// ... und der behaltene Eintrag bleibt ein WIKI-Eintrag und läuft weiter mit: kein origin='manual',
// kein 'retired'. „Nicht stilllegen" ist nicht „nie wieder aktualisieren".
assert((string) $pdo->query("SELECT origin FROM lore_entry WHERE wiki_key='wirselkraut'")->fetchColumn() === 'wiki');
assert((string) $pdo->query("SELECT status FROM lore_entry WHERE wiki_key='wirselkraut'")->fetchColumn() === 'active');

// --- Die Zahlen an der Zeile sagen, was ERHALTEN bleibt ------------------------------------------
// Bei einer Löschung nennt die Zeile den Verlust; hier nennt sie das Gegenteil, und das ist der ganze
// Unterschied zwischen einem Grabstein und einer Löschung.
assert($zeilen[0]['place_count'] === 1 && $zeilen[0]['source_count'] === 1);
assert($zeilen[0]['name'] === 'Donf' && $zeilen[0]['kind'] === 'flora');

// --- Eine Installation ohne Quellensystem ist kein Fehlschlag ------------------------------------
$pdo->exec('DROP TABLE feature_sources');
$zeilen = avesmapsLoreRetirableRows($pdo, ['wirselkraut']);
assert(count($zeilen) === 1 && $zeilen[0]['source_count'] === 0, 'ohne Quellentabelle: 0, kein Absturz');

echo "lore-plan ok\n";
