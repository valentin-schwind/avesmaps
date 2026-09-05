<?php

declare(strict_types=1);

/**
 * Unit tests for the third map-search source: objects that lie INSIDE a settlement and
 * therefore have no map position of their own (Villa Gerbelstein, Plaza der Lüste, the
 * Webergasse). They are found by name and jump to their CITY.
 *
 * Pure functions only -- no DB, no HTTP. The fixtures are real values from the 2026-07-27
 * measurement run.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/in-settlement-search-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n");
    exit(2);
}

// Side-effect free on include (only const + function defs) -- that is exactly why the pure
// builders live here and not in the endpoint, which bootstraps and connects on include.
require __DIR__ . '/../../app/in-settlement-search.php';

// --------------------------------------------------------------- SETTLEMENT INDEX ---
$featureRows = [
    ['feature_type' => 'location', 'feature_subtype' => 'grossstadt', 'name' => 'Mengbilla', 'public_id' => 'pid-mengbilla', 'min_x' => 10.0, 'min_y' => 20.0, 'max_x' => 10.0, 'max_y' => 20.0],
    ['feature_type' => 'location', 'feature_subtype' => 'metropole',  'name' => 'Gareth',    'public_id' => 'pid-gareth',    'min_x' => 30.0, 'min_y' => 40.0, 'max_x' => 30.0, 'max_y' => 40.0],
    // A BUILDING must never become a container: otherwise one building's name could mark
    // another as being "inside" it.
    ['feature_type' => 'location', 'feature_subtype' => 'gebaeude',   'name' => 'Burg Fürstenhort', 'public_id' => 'pid-burg', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 1.0, 'max_y' => 1.0],
    ['feature_type' => 'region',   'feature_subtype' => '',           'name' => 'Koschberge',  'public_id' => 'pid-kosch',  'min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 5.0, 'max_y' => 5.0],
    // Two places of the SAME name -> the name must be dropped, not resolved by coin flip.
    ['feature_type' => 'location', 'feature_subtype' => 'dorf', 'name' => 'Zwilling', 'public_id' => 'pid-a', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 1.0, 'max_y' => 1.0],
    ['feature_type' => 'location', 'feature_subtype' => 'dorf', 'name' => 'Zwilling', 'public_id' => 'pid-b', 'min_x' => 9.0, 'min_y' => 9.0, 'max_x' => 9.0, 'max_y' => 9.0],
];
$index = avesmapsBuildSettlementLocationIndex($featureRows);

assert(isset($index['mengbilla']), 'a settlement must be indexed');
assert($index['mengbilla']['public_id'] === 'pid-mengbilla');
assert($index['mengbilla']['min_x'] === 10.0 && $index['mengbilla']['min_y'] === 20.0);
assert(!isset($index['burg fürstenhort']), 'a BUILDING is not a container and must not be indexed');
assert(!isset($index['koschberge']), 'a region is not a settlement');
assert(!isset($index['zwilling']), 'an AMBIGUOUS name must be dropped -- any jump would be a coin flip');
echo "settlement-index ok\n";

// --------------------------------------------------------------------- ENTRIES ---
$scopeIndex = [
    'settlements' => avesmapsPlaceScopeBuildNameSet(['Mengbilla', 'Gareth', 'Abagund', 'Zwilling']),
    'regions' => avesmapsPlaceScopeBuildNameSet(['Koschberge', 'Abagund']), // Abagund: city AND barony
];
$registryRows = [
    ['title' => 'Plaza der Lüste', 'raw' => '[[Mengbilla]]', 'type_label' => 'Platz', 'wiki_url' => 'https://wiki/Plaza'],
    ['title' => 'Stadionmarkt', 'raw' => '[[Gareth]]: [[Arenaviertel]]', 'type_label' => 'Platz', 'wiki_url' => ''],
    // Outside -> not a hit at all (it belongs on the map, and may already be on it).
    ['title' => 'Burg Fürstenhort', 'raw' => '[[Koschberge]]: [[Greings Klamm]]', 'type_label' => 'Festung', 'wiki_url' => ''],
    // Ambiguous -> deliberately dropped: jumping to the wrong city is worse than no hit.
    ['title' => 'Burg Draustein', 'raw' => '[[Albernia]]: [[Abagund]]', 'type_label' => 'Festung', 'wiki_url' => ''],
    // City is not on the map (or ambiguous there) -> nothing to jump to.
    ['title' => 'Irgendwas', 'raw' => '[[Zwilling]]', 'type_label' => 'Turm', 'wiki_url' => ''],
    // No location field at all.
    ['title' => 'Ohne Standort', 'raw' => '', 'type_label' => 'Turm', 'wiki_url' => ''],
];
$entries = avesmapsBuildInSettlementSearchEntries($registryRows, $index, $scopeIndex);

assert(count($entries) === 2, 'exactly the two unambiguous inside-objects with a mapped city, got ' . count($entries));

$plaza = $entries[0];
assert($plaza['kind'] === 'in_settlement');
assert($plaza['name'] === 'Plaza der Lüste', 'the hit is named after the OBJECT, not the city');
assert($plaza['type_label'] === 'Platz in Mengbilla', 'the label must name the city, got ' . $plaza['type_label']);
// 💣 The jump target is the CITY -- that is what makes the existing location focus work
// unchanged, and it is why the label has to say "not on the map".
assert($plaza['public_id'] === 'pid-mengbilla');
assert($plaza['settlement_public_id'] === 'pid-mengbilla');
assert($plaza['settlement_name'] === 'Mengbilla');
assert($plaza['min_x'] === 10.0 && $plaza['max_y'] === 20.0, 'bounds are the city\'s');
assert($plaza['wiki_url'] === 'https://wiki/Plaza');
// Searching must find the OBJECT only. If the city name were a search text, typing
// "Mengbilla" would return its 32 inside-objects on top of the city itself.
assert($plaza['search_texts'] === ['Plaza der Lüste'], 'only the object name is searchable');

$stadionmarkt = $entries[1];
assert($stadionmarkt['name'] === 'Stadionmarkt');
assert($stadionmarkt['type_label'] === 'Platz in Gareth', 'the COARSEST settlement in the chain wins');
assert($stadionmarkt['public_id'] === 'pid-gareth');
echo "entries ok\n";

// Empty inputs must not explode.
assert(avesmapsBuildInSettlementSearchEntries([], $index, $scopeIndex) === []);
assert(avesmapsBuildInSettlementSearchEntries($registryRows, [], $scopeIndex) === [], 'no cities -> no hits');
assert(avesmapsBuildSettlementLocationIndex([]) === []);
echo "empty-inputs ok\n";

// ------------------------------------------------------------------ SORT ORDER ---
// Inside-objects must rank BEHIND everything that is really on the map: they are a pointer
// to a city, not a map object. avesmapsSearchKindOrder lives in the endpoint (which cannot
// be included here), so the ordering is asserted against its source instead of executed.
$endpointSource = (string) file_get_contents(__DIR__ . '/../../../app/map-search.php');
assert(
    preg_match("/'in_settlement' => 5,/", $endpointSource) === 1,
    "in_settlement must sort after location(0)/label(1)/region(2)/path(3)/powerline(4)"
);
echo "sort-order ok\n";

// ------------------------------------------------- DIE WIKI-URL IM KARTENPAYLOAD ---
// Zweiter Leser dieser Liste seit 2026-08-15: die Infobox-Zeile „Staetten" (Owner-Wunsch).
// Sie verlinkt jeden Namen aufs Wiki -- ohne wiki_url im Payload muesste der Browser die
// Adresse aus dem Titel bauen, also avesmapsWikiSyncMonitorPageUrl ein zweites Mal fuehren.
$placeRows = [[
    'title' => 'Akademie der Erscheinungen',
    'raw' => '[[Mengbilla]]: [[Bishdaria]]',
    'type_label' => 'Magierakademie',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Akademie_der_Erscheinungen',
]];
$places = avesmapsBuildInSettlementPlaceList($placeRows, $scopeIndex);
assert(count($places) === 1, 'die Staette steht in der Payload-Liste');
assert($places[0]['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Akademie_der_Erscheinungen',
    'wiki_url reist mit: ' . var_export($places[0]['wiki_url'] ?? null, true));
assert($places[0]['settlement'] === 'Mengbilla', 'die Stadt bleibt der Schluessel der Zeile');
assert($places[0]['type'] === 'Magierakademie', 'die Art traegt die Gruppenueberschrift');

// Eine Zeile OHNE wiki_url liefert einen leeren String, nie null.
$ohneUrl = avesmapsBuildInSettlementPlaceList(
    [['title' => 'Namenloses Ding', 'raw' => '[[Mengbilla]]', 'type_label' => 'Turm']],
    $scopeIndex
);
assert($ohneUrl[0]['wiki_url'] === '', 'fehlende wiki_url wird zu leerem String, nicht null');
echo "payload wiki_url ok\n";

// ------------------------------------------- GESPEICHERTE STAETTEN (settlement_place) ---
// Vierte Quelle seit 02.09.2026: eine von einem Menschen eingetragene Staette (Garetien-Import,
// „Innerorts einfuegen", api/_internal/app/settlement-places.php) kommt SCHON AUFGELOEST herein
// und steht VOR den Ableitungen -- der `$seen`-Riegel ist derselbe, wer zuerst kommt, gewinnt.
$gespeichert = [[
    'name' => 'Akademie der Erscheinungen', 'settlement' => 'Wandleth', 'type' => 'Tempel',
    'wiki_url' => 'https://www.garetien.de/index.php/Garetien:Akademie',
]];
$mitGespeichert = avesmapsBuildInSettlementPlaceList($placeRows, $scopeIndex, $gespeichert);
assert(count($mitGespeichert) === 1, 'derselbe Name steht EINMAL: ' . count($mitGespeichert));
assert($mitGespeichert[0]['settlement'] === 'Wandleth' && $mitGespeichert[0]['type'] === 'Tempel',
    '💣 die eingetragene Staette schlaegt ihre geratene Ableitung -- andersherum kaeme die Entscheidung des Editors nie an: '
    . json_encode($mitGespeichert[0]));
$nurGespeichert = avesmapsBuildInSettlementPlaceList([], ['settlements' => [], 'regions' => []],
    [['name' => 'Rondratempel', 'settlement' => 'Wandleth']]);
assert(count($nurGespeichert) === 1 && $nurGespeichert[0]['wiki_url'] === '' && $nurGespeichert[0]['type'] === '',
    'ohne Registry-Zeilen tragen die gespeicherten allein -- fehlende Felder sind leere Strings');
assert(avesmapsBuildInSettlementPlaceList([], $scopeIndex,
    [['name' => '', 'settlement' => 'Wandleth'], ['name' => 'X', 'settlement' => '']]) === [],
    'ohne Namen oder ohne Ort faellt eine gespeicherte Zeile heraus');
assert(avesmapsBuildInSettlementPlaceList($placeRows, $scopeIndex) === avesmapsBuildInSettlementPlaceList($placeRows, $scopeIndex, []),
    'ohne gespeicherte Staetten ist alles wie vorher');
echo "gespeicherte staetten ok\n";

// ------------------------------------------------------- DIE GOTTHEIT (Discord #54) ---
// „wo liegt eigentlich der naechste [Gottheit]-Schrein?" -- dafuer muss die Gottheit zweierlei
// sein: sichtbar in der Trefferzeile UND suchbar.
$gottRows = [[
    'title' => 'Tempel der süßen Träume',
    'raw' => '[[Mengbilla]]',
    'type_label' => 'Tempel',
    'deity' => 'Rahja',
    'wiki_url' => '',
]];
$gottTreffer = avesmapsBuildInSettlementSearchEntries($gottRows, $index, $scopeIndex);
assert(count($gottTreffer) === 1, 'der Treffer entsteht');
assert($gottTreffer[0]['type_label'] === 'Rahja-Tempel in Mengbilla',
    'Typzeile nennt die Gottheit: ' . $gottTreffer[0]['type_label']);

// 💣 DER PUNKT: ohne die Gottheit in search_texts findet „rahja" gar nichts.
assert(in_array('Rahja', $gottTreffer[0]['search_texts'], true), 'die Gottheit ist suchbar');
assert(in_array('Tempel der süßen Träume', $gottTreffer[0]['search_texts'], true), 'der Titel bleibt');
// ⚠️ Und der STADTNAME weiterhin NICHT -- sonst faende „Mengbilla" seine 32 Innerorts-Objekte
// alle ein zweites Mal (der Kommentar an der Stelle begruendet das seit 27.07.).
assert(!in_array('Mengbilla', $gottTreffer[0]['search_texts'], true), 'der Stadtname bleibt draussen');

// Mehrwertig: die Beschriftung nennt die erste, suchbar sind beide.
$zweiRows = [[
    'title' => 'Feuersturm-Tempel', 'raw' => '[[Mengbilla]]', 'type_label' => 'Tempel',
    'deity' => 'Ingerimm,Rondra', 'wiki_url' => '',
]];
$zwei = avesmapsBuildInSettlementSearchEntries($zweiRows, $index, $scopeIndex);
assert($zwei[0]['type_label'] === 'Ingerimm-Tempel in Mengbilla', $zwei[0]['type_label']);
assert(in_array('Ingerimm', $zwei[0]['search_texts'], true), 'erste Gottheit suchbar');
assert(in_array('Rondra', $zwei[0]['search_texts'], true), 'ZWEITE Gottheit ebenfalls suchbar');

// Ohne Gottheit bleibt alles wie bisher -- kein „-Tempel", kein leerer Suchtext.
$ohneRows = [[
    'title' => 'Halle der Stille', 'raw' => '[[Mengbilla]]', 'type_label' => 'Tempel',
    'deity' => '', 'wiki_url' => '',
]];
$ohne = avesmapsBuildInSettlementSearchEntries($ohneRows, $index, $scopeIndex);
assert($ohne[0]['type_label'] === 'Tempel in Mengbilla', $ohne[0]['type_label']);
assert($ohne[0]['search_texts'] === ['Halle der Stille'], 'kein leerer Suchtext');

// Ein Weg hat nie eine Weihung -- gleiche Zeilenform, unveraendertes Ergebnis.
$wegRows = [[
    'title' => 'Tempelstraße', 'raw' => '[[Mengbilla]]', 'type_label' => 'Straße',
    'deity' => '', 'wiki_url' => '',
]];
assert(avesmapsBuildInSettlementSearchEntries($wegRows, $index, $scopeIndex)[0]['type_label']
    === 'Straße in Mengbilla', 'Wege unveraendert');
echo "gottheit ok\n";

// -------------------------------- DIE ABFRAGE UEBERLEBT EINE FEHLENDE SPALTE ---
// 💣 Der einzige Fall dieser Datei, der eine echte Datenbank braucht -- und er ist es wert.
// `deity` legt nur avesmapsWikiSettlementEnsureSchema an, und die laeuft NUR im Sync-Pfad.
// Zwischen einem Deploy und dem ersten Dump-Lauf (und auf jeder frischen Installation) gibt es
// die Spalte nicht. Ohne den zweiten Anlauf faengt der catch den Fehler ab und liefert eine
// LEERE Liste -- 1774 Innerorts-Objekte verschwinden lautlos aus der Suche UND aus der
// Infobox-Zeile „Staetten". Genau diese Falle wurde am 15.08.2026 nach dem Deploy bemerkt.
if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $sqlite = new PDO('sqlite::memory:');
    $sqlite->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // Die Tabelle OHNE die Spalte -- der Zustand vor dem ersten Sync.
    $sqlite->exec('CREATE TABLE wiki_sync_pages (title TEXT, building_type TEXT, wiki_url TEXT, standort TEXT, settlement_class TEXT)');
    $sqlite->exec('INSERT INTO wiki_sync_pages VALUES ("Feuersturm-Tempel", "Tempel", "", "[[Khunchom]]", "gebaeude")');
    $ohneSpalte = avesmapsFetchInSettlementSearchRows($sqlite);
    assert(count($ohneSpalte) === 1, 'ohne deity-Spalte darf die Liste NICHT leer sein: ' . count($ohneSpalte));
    assert($ohneSpalte[0]['deity'] === '', 'die Gottheit ist dann leer, nicht null');
    assert($ohneSpalte[0]['type_label'] === 'Tempel', 'alles andere kommt unveraendert an');

    // Und mit der Spalte kommt sie natuerlich mit.
    $sqlite->exec('ALTER TABLE wiki_sync_pages ADD COLUMN deity TEXT');
    $sqlite->exec('UPDATE wiki_sync_pages SET deity = "Ingerimm,Rondra"');
    $mitSpalte = avesmapsFetchInSettlementSearchRows($sqlite);
    assert($mitSpalte[0]['deity'] === 'Ingerimm,Rondra', 'mit Spalte reist die Gottheit mit');
    echo "spalten-rueckfall ok\n";
} else {
    echo "spalten-rueckfall UEBERSPRUNGEN (kein pdo_sqlite)\n";
}

echo "\nALL IN-SETTLEMENT SEARCH TESTS PASSED\n";
