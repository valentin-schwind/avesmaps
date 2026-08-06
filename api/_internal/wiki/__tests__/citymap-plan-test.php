<?php

declare(strict_types=1);

/**
 * The citymap COMPUTE half: what a difference row looks like, and which rows must never become one.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/citymap-plan-test.php
 * Exit 0 = all asserts passed.
 *
 * Part 1 is pure (no DB at all). Part 2 uses sqlite for the two gates that are SQL by nature: the
 * empty-catalog gate and the declined-deletion gate.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../citymap-sync.php'; // function definitions only -- no top-level code, no MySQL

// =================================================================================================
// PART 1 -- avesmapsCitymapPlanItem, pure
// =================================================================================================

$desired = [
    'title' => 'Havena – Hafenviertel',
    'map_url' => 'https://de.wiki-aventurica.de/wiki/Havena',
    'art' => 'stadtplan',
    'is_color' => 1,
    'is_labeled' => 1,
    'format' => 'A3',
    'has_scale' => 1,
    'author' => 'Ina Kramer',
    'publisher' => 'Ulisses',
    'note' => null,
];
$noLinks = ['insert' => [], 'update' => [], 'delete' => []];
$wikiPlace = ['origin' => 'wiki', 'status' => 'approved', 'target_kind' => 'unresolved', 'raw_name' => 'Havena'];

// --- Neu ------------------------------------------------------------------------------------------

$item = avesmapsCitymapPlanItem(null, $desired, null, 'Havena', $noLinks, false);
assert($item !== null && $item['change_type'] === 'new', 'eine Karte, die es nicht gibt, ist neu');
assert($item['after']['title'] === 'Havena – Hafenviertel');
assert($item['after']['author'] === 'Ina Kramer');
assert($item['before'] === [], 'eine neue Karte hat kein Vorher');
assert(!array_key_exists('note', $item['after']), 'leere Felder stehen nicht in der Zeile');

// --- 💣 Handarbeit taucht in der Vorschau ueberhaupt nicht auf (design §3.1) -----------------------
//
// Das ist der Grund, warum ein Editor der Liste trauen darf: was hier durchrutscht, wuerde spaeter
// mit einem Haekchen ueberschrieben, das jemand fuer eine Wiki-Karte gesetzt hat.

$manual = ['origin' => 'manual', 'status' => 'approved', 'title' => 'Eigener Titel'];
assert(avesmapsCitymapPlanItem($manual, $desired, null, 'Havena', $noLinks, true) === null, 'eigene Karte: keine Zeile');

$community = ['origin' => 'community', 'status' => 'approved', 'title' => 'X'];
assert(avesmapsCitymapPlanItem($community, $desired, null, 'Havena', $noLinks, true) === null, 'Community-Karte: keine Zeile');

$tombstone = ['origin' => 'wiki', 'status' => 'suppressed', 'title' => 'X'];
assert(avesmapsCitymapPlanItem($tombstone, $desired, null, 'Havena', $noLinks, true) === null, 'Grabstein: keine Zeile');

// --- Nichts zu tun = keine Zeile -------------------------------------------------------------------

$same = ['origin' => 'wiki', 'status' => 'approved'] + $desired;
assert(
    avesmapsCitymapPlanItem($same, $desired, $wikiPlace, 'Havena', $noLinks, false) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile -- sonst stuende die Vorschau jedes Mal voll'
);

// --- Geaendert: nur die abweichenden Felder --------------------------------------------------------

$old = $same;
$old['title'] = 'Havena, Hafen';
$item = avesmapsCitymapPlanItem($old, $desired, $wikiPlace, 'Havena', $noLinks, false);
assert($item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['title'], 'nur das abweichende Feld, nie die ganze Zeile');
assert($item['before']['title'] === 'Havena, Hafen', 'und das Vorher dazu');
assert($item['override'] === []);

// Mehrere Felder auf einmal, und die Reihenfolge folgt der Feldliste des Reconcile-Plans.
$old2 = $same;
$old2['title'] = 'Havena, Hafen';
$old2['has_scale'] = 0;
$item = avesmapsCitymapPlanItem($old2, $desired, $wikiPlace, 'Havena', $noLinks, false);
assert(count($item['after']) === 2 && isset($item['after']['has_scale']));

// --- Der Ort ist ein Unterschied wie jeder andere --------------------------------------------------

$otherPlace = ['origin' => 'wiki', 'status' => 'approved', 'target_kind' => 'unresolved', 'raw_name' => 'Havena (alt)'];
$item = avesmapsCitymapPlanItem($same, $desired, $otherPlace, 'Havena', $noLinks, false);
assert($item !== null && $item['after']['place'] === 'Havena', 'ein besser gelesener Ortsname ist eine Aenderung');
assert($item['before']['place'] === 'Havena (alt)');

// --- 💣 Quelle und Fundstellen sind AUCH ein Unterschied -------------------------------------------
//
// Ohne diese beiden Sonden bliebe eine Karte ohne Quellenverweis fuer immer ohne einen: sie hat kein
// abweichendes FELD, waere also fuer die Vorschau unsichtbar -- und der Schreiber, der den Verweis
// heute nebenbei anlegt, laeuft nur noch, wenn ein Haekchen ihn ruft.

$item = avesmapsCitymapPlanItem($same, $desired, $wikiPlace, 'Havena', $noLinks, true);
assert($item !== null && $item['change_type'] === 'changed', 'fehlender Quellenverweis allein macht eine Zeile');
assert(isset($item['after']['source']));

$withLink = ['insert' => [['url' => 'https://f-shop.de/x', 'label' => 'F-Shop', 'is_paid' => 1]], 'update' => [], 'delete' => []];
$item = avesmapsCitymapPlanItem($same, $desired, $wikiPlace, 'Havena', $withLink, false);
assert($item !== null && isset($item['after']['links']), 'eine neue Fundstelle allein macht eine Zeile');
$item = avesmapsCitymapPlanItem($same, $desired, $wikiPlace, 'Havena', ['insert' => [], 'update' => [], 'delete' => [7]], false);
assert($item !== null && isset($item['after']['links']), 'eine entfallene Fundstelle ebenso');

// --- Der Ort ist der einzige echte Feld-Override bei Karten ----------------------------------------
//
// ⚠️ Bei Stadtkarten ist der Override sonst die GANZE Karte (origin='manual' -> oben, keine Zeile).
// Der Ort ist die Ausnahme: er hat eine eigene Zeile mit eigenem origin und eigener Aufloesung.

$ownPlace = ['origin' => 'manual', 'status' => 'approved', 'target_kind' => 'settlement', 'raw_name' => 'Havena (Hafen)'];
$item = avesmapsCitymapPlanItem($old, $desired, $ownPlace, 'Havena', $noLinks, false);
assert(isset($item['override']['place']), 'ein von Hand gesetzter Ort steht als „bleibt" in der Zeile');
assert($item['override']['place'] === 'Havena (Hafen)');
assert(!isset($item['after']['place']), 'und wird NICHT als Aenderung vorgeschlagen');

// Ein aufgeloester Wiki-Ort ist ebenfalls unantastbar -- aber nur der Vermerk, keine Zeile fuer sich.
$resolved = ['origin' => 'wiki', 'status' => 'approved', 'target_kind' => 'settlement', 'raw_name' => 'Havena (Hafen)'];
assert(
    avesmapsCitymapPlanItem($same, $desired, $resolved, 'Havena', $noLinks, false) === null,
    'ein festgehaltener Ort allein ist kein Grund, den Editor zu fragen'
);

// =================================================================================================
// PART 2 -- the two gates, on sqlite
// =================================================================================================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE citymap (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_key TEXT,
    title TEXT, origin TEXT, status TEXT, parent_id INTEGER)');
$pdo->exec('CREATE TABLE citymap_place (id INTEGER PRIMARY KEY AUTOINCREMENT, citymap_id INTEGER)');
$pdo->exec('CREATE TABLE citymap_link (id INTEGER PRIMARY KEY AUTOINCREMENT, citymap_id INTEGER)');
$pdo->exec('CREATE TABLE citymap_related (id INTEGER PRIMARY KEY AUTOINCREMENT, citymap_id INTEGER, related_citymap_id INTEGER)');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT, status TEXT)');
$pdo->exec('CREATE TABLE wiki_citymap_catalog (wiki_key TEXT PRIMARY KEY)');

$addCard = static function (PDO $pdo, string $key, string $title, string $origin, string $status) : int {
    $pdo->prepare('INSERT INTO citymap (public_id, wiki_key, title, origin, status) VALUES (:p, :k, :t, :o, :s)')
        ->execute(['p' => 'pid-' . $key, 'k' => $key, 't' => $title, 'o' => $origin, 's' => $status]);
    return (int) $pdo->lastInsertId();
};

$puninId = $addCard($pdo, 'stadtplanindex:punin-altstadt', 'Punin – Altstadt', 'wiki', 'approved');
$rivaId = $addCard($pdo, 'stadtplanindex:riva-nordmole', 'Riva – Nordmole', 'wiki', 'approved');
$havenaId = $addCard($pdo, 'stadtplanindex:havena', 'Havena – Hafenviertel', 'wiki', 'approved');
$addCard($pdo, 'stadtplanindex:eigene', 'Eigene Karte', 'manual', 'approved');
$addCard($pdo, 'stadtplanindex:community', 'Community-Karte', 'community', 'approved');
$addCard($pdo, 'stadtplanindex:grabstein', 'Grabstein', 'wiki', 'suppressed');

// Punin haengen zwei Fundorte, eine Fundstelle, ein Verweis und ein Quellenverweis an.
$pdo->prepare('INSERT INTO citymap_place (citymap_id) VALUES (:id), (:id2)')->execute(['id' => $puninId, 'id2' => $puninId]);
$pdo->prepare('INSERT INTO citymap_link (citymap_id) VALUES (:id)')->execute(['id' => $puninId]);
$pdo->prepare('INSERT INTO citymap_related (citymap_id, related_citymap_id) VALUES (:id, :other)')
    ->execute(['id' => $puninId, 'other' => $havenaId]);
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, status) VALUES ('citymap', :p, 'approved')")
    ->execute(['p' => 'pid-stadtplanindex:punin-altstadt']);

// --- 💣 Der Leerkatalog-Riegel (design §4c) --------------------------------------------------------
//
// Ein leerer Katalog heisst "Dump holen lief nicht", NICHT "das Wiki hat alles geloescht". Frueher war
// der Schaden eine stille Massenloeschung; jetzt waere er eine Vorschau mit 457 Loeschvorschlaegen --
// und irgendwann klickt jemand.
assert(avesmapsCitymapVanishedRows($pdo, []) === [], 'leerer Katalog => keine einzige Loeschzeile');

$pdo->exec("INSERT INTO wiki_citymap_catalog (wiki_key) VALUES ('stadtplanindex:havena')");

$rows = avesmapsCitymapVanishedRows($pdo, []);
$keys = array_map(static fn(array $r): string => $r['wiki_key'], $rows);
sort($keys);
assert($keys === ['stadtplanindex:punin-altstadt', 'stadtplanindex:riva-nordmole'], 'genau die zwei verschwundenen Wiki-Karten');
// Eigene, Community und Grabstein stehen nicht dabei, obwohl auch sie nicht im Katalog sind.
assert(!in_array('stadtplanindex:eigene', $keys, true) && !in_array('stadtplanindex:community', $keys, true));
assert(!in_array('stadtplanindex:grabstein', $keys, true));

// Die Zahlen an der Zeile: was mit der Karte ginge.
$punin = null;
foreach ($rows as $row) {
    if ($row['wiki_key'] === 'stadtplanindex:punin-altstadt') {
        $punin = $row;
    }
}
assert($punin !== null);
assert($punin['title'] === 'Punin – Altstadt' && $punin['public_id'] === 'pid-stadtplanindex:punin-altstadt');
assert($punin['place_count'] === 2, 'zwei Fundorte');
assert($punin['link_count'] === 1 && $punin['related_count'] === 1 && $punin['source_count'] === 1);

// --- 💣 Der Behalten-Riegel (design §2/§8) ---------------------------------------------------------

$rows = avesmapsCitymapVanishedRows($pdo, ['stadtplanindex:punin-altstadt']);
assert(count($rows) === 1 && $rows[0]['wiki_key'] === 'stadtplanindex:riva-nordmole', 'abgelehnte Loeschung wird nie wieder gefragt');

// ... und die behaltene Karte bleibt ein WIKI-Eintrag. Das ist die eigentliche Entscheidung des
// Entwurfs: "nicht loeschen" ist NICHT "nie wieder aktualisieren".
$origin = $pdo->query("SELECT origin FROM citymap WHERE wiki_key = 'stadtplanindex:punin-altstadt'")->fetchColumn();
assert($origin === 'wiki', '💣 NICHT manual -- die Pflege laeuft weiter, nur die Loeschfrage ist abbestellt');

// --- Der Einzel-Loescher --------------------------------------------------------------------------

assert(avesmapsCitymapDeleteWikiRow($pdo, 'stadtplanindex:riva-nordmole') === true);
assert((int) $pdo->query("SELECT COUNT(*) FROM citymap WHERE wiki_key = 'stadtplanindex:riva-nordmole'")->fetchColumn() === 0);
// Eine Karte, die uns nicht gehoert, ueberlebt auch einen direkten Aufruf: der origin-Riegel am DELETE.
assert(avesmapsCitymapDeleteWikiRow($pdo, 'stadtplanindex:eigene') === false, 'der origin-Riegel am DELETE haelt');
assert((int) $pdo->query("SELECT COUNT(*) FROM citymap WHERE wiki_key = 'stadtplanindex:eigene'")->fetchColumn() === 1);
assert(avesmapsCitymapDeleteWikiRow($pdo, 'gibt-es-nicht') === false);

echo "citymap-plan ok\n";
