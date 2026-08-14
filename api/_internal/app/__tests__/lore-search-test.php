<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../lore-search.php';

$labels = AVESMAPS_LORE_SEARCH_KIND_LABELS;

// Wiki markup in gruppe/typ is real: live values are "[[Fisch]]", "[[Parfüm]]", "profan".
assert(avesmapsLoreSearchStripWikiMarkup('[[Fisch]]') === 'Fisch');
assert(avesmapsLoreSearchStripWikiMarkup('[[Seite|Anzeige]]') === 'Anzeige');
assert(avesmapsLoreSearchStripWikiMarkup('profan') === 'profan');
assert(avesmapsLoreSearchStripWikiMarkup('') === '');

// Modelled on real rows (live 2026-08-02), not invented.
$entryRows = [
    ['wiki_key' => 'alraune', 'kind' => 'flora', 'name' => 'Alraune', 'gruppe' => '', 'typ' => ''],
    ['wiki_key' => 'aal', 'kind' => 'fauna', 'name' => 'Aal', 'gruppe' => '[[Fisch]]', 'typ' => ''],
    ['wiki_key' => '1001-rausch-parfum', 'kind' => 'ware', 'name' => '1001 Rausch', 'gruppe' => 'profan', 'typ' => '[[Parfuem]]'],
    ['wiki_key' => 'kein-ort', 'kind' => 'ware', 'name' => 'Ortlose Ware', 'gruppe' => 'profan', 'typ' => ''],
];
$placesByEntry = [
    'alraune' => [
        ['title' => 'Aventurien', 'wiki_key' => 'aventurien'],
        ['title' => 'Khôm', 'wiki_key' => 'kh-m'],
        ['title' => 'Nebelmoor', 'wiki_key' => 'nebelmoor'],
        ['title' => 'Myranor', 'wiki_key' => 'myranor'],
    ],
    'aal' => [
        ['title' => 'Meer der Sieben Winde', 'wiki_key' => 'meer-der-sieben-winde'],
    ],
    '1001-rausch-parfum' => [
        ['title' => 'Belhanka', 'wiki_key' => 'belhanka'],
    ],
];

$entries = avesmapsBuildLoreSearchEntries($entryRows, $placesByEntry, $labels);
assert(count($entries) === 4);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// A lore entry has no public id of its own -- its wiki_key IS its identity (AGENTS.md §5).
assert($byId['alraune']['kind'] === 'lore');
assert($byId['alraune']['type_label'] === 'Flora');
assert($byId['aal']['type_label'] === 'Fauna');
assert($byId['1001-rausch-parfum']['type_label'] === 'Ware');

// The places travel UNRESOLVED, title and wiki key both: lore_place stores no target_kind and no
// target_public_id at all (design §1.6), so the client is the only side that can resolve them.
assert($byId['alraune']['place_count'] === 4);
assert($byId['alraune']['lore_places'][1]['title'] === 'Khôm');
assert($byId['alraune']['lore_places'][1]['wiki_key'] === 'kh-m');
assert($byId['kein-ort']['place_count'] === 0);
assert($byId['kein-ort']['lore_places'] === []);

// Place titles are search texts -- that is the whole point of the reverse direction: "wo gibt es das?"
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('nebelmoor')) !== null);
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('meer winde')) !== null);

// Name, kind label and kind key all match.
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('alraune')) !== null);
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('flora')) !== null);

// 💣 The wiki brackets must be GONE from the search texts. With them, "[[fisch]]" is a search text in
// its own right and a reader who typed "fisch" gets a row whose connection is invisible.
$haystack = implode(' | ', $byId['aal']['search_texts']);
assert(str_contains($haystack, 'Fisch'));
assert(!str_contains($haystack, '[['));
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('fisch')) !== null);
assert(avesmapsCalculateSearchScore($byId['1001-rausch-parfum'], avesmapsNormalizeSearchText('parfuem')) !== null);

// The raw wiki_key is NOT a search text: it is a join key, and "1001-rausch-parfum" is not a word
// anyone types. lebensraum and continent stay out too (78 of 500 / thin).
assert(!in_array('1001-rausch-parfum', $byId['1001-rausch-parfum']['search_texts'], true));
assert(!in_array('', $byId['alraune']['search_texts'], true));

// A row without a name or without a key is not an entry.
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => 'x', 'kind' => 'flora', 'name' => '  ']], [], $labels) === []);
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => '', 'kind' => 'flora', 'name' => 'X']], [], $labels) === []);

// 💣 The kind switch is PER KIND and its default differs: spezies is OFF unless switched on, the other
// three are ON unless switched off (avesmapsLoreKindDefaultEnabled).
assert(AVESMAPS_LORE_SEARCH_KINDS === ['flora', 'fauna', 'spezies', 'ware']);
assert(avesmapsLoreSearchKindDefaultEnabled('flora') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('ware') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('spezies') === false);
assert(avesmapsLoreSearchSettingKey('fauna') === 'lore_kind_fauna_enabled');

// Reading a stored value: '' means "never written" -> default, '0' means off, anything else on.
assert(avesmapsLoreSearchKindIsEnabled('spezies', '') === false);
assert(avesmapsLoreSearchKindIsEnabled('spezies', '1') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '0') === false);

// avesmapsLoreSearchEnabledKindsFromSettings is the PURE core avesmapsLoreSearchEnabledKinds(PDO) now
// wraps -- fed from avesmapsAppSettingGetManyWithoutDdl's batch read (api/_internal/app/app-setting.php)
// instead of running its own query, so map-search.php can fold this into ONE call with the other
// switches. No stored rows at all -> every kind falls back to its own default.
assert(avesmapsLoreSearchEnabledKindsFromSettings([]) === ['flora', 'fauna', 'ware']);
// A key simply ABSENT from $stored (never written) must read exactly like the '' case above -- not
// like an accidental off.
assert(avesmapsLoreSearchEnabledKindsFromSettings(['lore_kind_spezies_enabled' => '1']) === ['flora', 'fauna', 'spezies', 'ware']);
assert(avesmapsLoreSearchEnabledKindsFromSettings(['lore_kind_flora_enabled' => '0']) === ['fauna', 'ware']);

// Regeln reisen in derselben Ortsliste mit -- der Client hat nie gewusst, woher ein Ort kommt.
$entries = avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'gruppe' => '', 'typ' => '']],
    ['einbeere' => [['title' => 'Der Große Fluss', 'wiki_key' => 'der-grosse-fluss']]],
    AVESMAPS_LORE_SEARCH_KIND_LABELS,
    ['einbeere' => [['title' => 'Farindelwald', 'wiki_key' => 'farindelwald']]]
);
assert(count($entries) === 1);
assert($entries[0]['place_count'] === 2, 'genannter Ort UND Regeltreffer zaehlen beide');
$titles = array_column($entries[0]['lore_places'], 'title');
assert(in_array('Der Große Fluss', $titles, true));
assert(in_array('Farindelwald', $titles, true));
// 💣 Der genannte Ort steht VORN. Er ist die ausdrueckliche Aussage eines Redakteurs; ein
// Regeltreffer ist eine Ableitung. Dieselbe Rangfolge wie in der Infobox.
assert($titles[0] === 'Der Große Fluss');
// Und ein Eintrag ohne Regel bleibt, wie er war.
assert(in_array('Der Große Fluss', array_column(avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'gruppe' => '', 'typ' => '']],
    ['einbeere' => [['title' => 'Der Große Fluss', 'wiki_key' => 'der-grosse-fluss']]],
    AVESMAPS_LORE_SEARCH_KIND_LABELS
)[0]['lore_places'], 'title'), true));

// --- Fix-Runde 1: der PDO-Leser avesmapsFetchLoreRulePlacesByEntry -- Kurzschluss (Befund 1)
// und die jetzt GETEILTE Kettenauswertung (Befund 2, avesmapsLoreRuleChainMatchesSubject in
// lore-rule-match.php) -----------------------------------------------------------------------
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this half would silently pass\n");
    exit(1);
}
require_once __DIR__ . '/../lore-rule-store.php';

$rulePdo = new PDO('sqlite::memory:');
$rulePdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsLoreRuleEnsureTables($rulePdo);

// 'einbeere' matcht Farindel (vegetation/wald) ueber eine einfache Bedingung.
avesmapsLoreRuleSave($rulePdo, 'einbeere', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => null, 'climate_to' => null,
]], 'verbreitung', 7);

// 'wurzelkraut': DREI Bedingungen, dieselbe Beweisfigur wie lore-rule-match-test.php --
// links-nach-rechts trifft Finsterkamm NICHT, eine Praezedenz-Lesart ("und bindet staerker")
// WUERDE ihn treffen. T1 Gebirge (trifft Finsterkamm), T2 (davor 'oder') Wald (verfehlt
// Finsterkamm), T3 (davor 'und') "ist Farindel" (verfehlt Finsterkamm).
avesmapsLoreRuleSave($rulePdo, 'wurzelkraut', [
    ['join_op' => 'und', 'area_public_id' => null,
        'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
        'climate_from' => null, 'climate_to' => null],
    ['join_op' => 'oder', 'area_public_id' => null,
        'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
        'climate_from' => null, 'climate_to' => null],
    ['join_op' => 'und', 'area_public_id' => 'a1',
        'types' => [],
        'climate_from' => null, 'climate_to' => null],
], 'verbreitung', 7);

$rulePdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY,
        public_id VARCHAR(36) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        region_type VARCHAR(40) NULL,
        name VARCHAR(190) NOT NULL DEFAULT \'\',
        wiki_region_key VARCHAR(190) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1
    )'
);
$ruleRegionStmt = $rulePdo->prepare(
    'INSERT INTO ecosystem_region (id, public_id, kind, region_type, name, wiki_region_key, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
);
$ruleRegionStmt->execute([1, 'a1', 'vegetation', 'wald', 'Farindel', 'farindel']);
$ruleRegionStmt->execute([2, 'a2', 'topographie', 'gebirge', 'Finsterkamm', null]);

$rulePdo->exec(
    'CREATE TABLE ecosystem_region_overlap (
        region_id INTEGER NOT NULL, other_region_id INTEGER NOT NULL, share REAL NOT NULL
    )'
);
$rulePdo->exec('CREATE TABLE ecosystem_assignment_stamp (id INTEGER PRIMARY KEY, completed INTEGER NOT NULL)');
$rulePdo->exec('INSERT INTO ecosystem_assignment_stamp (id, completed) VALUES (1, 1)');

// Task 7: fuer avesmapsLoreRuleOrderedZoneKeys, dieselben acht Klimazonen wie
// AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED, Nord nach Sued.
$rulePdo->exec(
    'CREATE TABLE ecosystem_region_type (
        kind VARCHAR(16) NOT NULL, type_key VARCHAR(40) NOT NULL, sort_order INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
    )'
);
$typeStmt = $rulePdo->prepare(
    'INSERT INTO ecosystem_region_type (kind, type_key, sort_order, is_active) VALUES (?, ?, ?, 1)'
);
foreach ([
    ['klima', 'polar', 10], ['klima', 'subpolar', 20], ['klima', 'boreal', 30],
    ['klima', 'gemaessigt', 40], ['klima', 'subtropen_winterfeucht', 50],
    ['klima', 'trockene_subtropen', 55], ['klima', 'subtropisch', 60], ['klima', 'tropisch', 70],
] as [$typeKind, $typeKey, $sortOrder]) {
    $typeStmt->execute([$typeKind, $typeKey, $sortOrder]);
}

// --- Befund 1: der Kurzschluss -----------------------------------------------------------
// 'einbeere' selbst haette eine passende Regel UND eine passende Flaeche -- aber es ist nicht
// unter den GEFUNDENEN Eintraegen, also darf der Kurzschluss trotzdem nichts liefern.
//
// Task 7: der Rueckgabewert ist jetzt EIN Umschlag ['places_by_entry' => ..., 'zones_by_entry' => ...]
// statt der nackten places_by_entry-Liste -- der Kurzschluss liefert beide Haelften leer.
assert(avesmapsFetchLoreRulePlacesByEntry($rulePdo, ['andere-pflanze'])
    === ['places_by_entry' => [], 'zones_by_entry' => []],
    'einbeere ist nicht unter den gefundenen Eintraegen -- Kurzschluss muss trotz passender Regel leer liefern');
// Keine gefundenen Eintraege ueberhaupt -> leer ohne jede Abfrage.
assert(avesmapsFetchLoreRulePlacesByEntry($rulePdo, []) === ['places_by_entry' => [], 'zones_by_entry' => []]);
// Sobald 'einbeere' unter den gefundenen Eintraegen ist, rechnet der teure Teil und liefert
// tatsaechlich die Flaeche -- der Kurzschluss unterdrueckt nicht mehr als noetig.
$ruleData = avesmapsFetchLoreRulePlacesByEntry($rulePdo, ['einbeere']);
assert(array_key_exists('places_by_entry', $ruleData) && array_key_exists('zones_by_entry', $ruleData));
assert(array_key_exists('einbeere', $ruleData['places_by_entry']));
// 💣 Task 7, MUTATION TARGET 3: ein REGELORT traegt seine region_public_id ('a1' -- Farindel).
assert($ruleData['places_by_entry']['einbeere']
    === [['title' => 'Farindel', 'wiki_key' => 'farindel', 'region_public_id' => 'a1']],
    'ein Regelort traegt seine region_public_id');
// 'einbeere' hat KEINE Klimaspanne in ihrer Bedingung -> keine Zonen fuer sie.
assert(($ruleData['zones_by_entry']['einbeere'] ?? []) === [], 'ohne Klimaspanne keine Zonen');

// --- Befund 2: die geteilte Kettenauswertung ----------------------------------------------
// 💣 Der eigentliche Beweis: eine Praezedenz-Mutation an avesmapsLoreRuleChainMatchesSubject
// (der EINEN neuen gemeinsamen Stelle) muss DIESEN Test UND lore-rule-match-test.php gleichzeitig
// rot machen -- das ist der Sinn der Zusammenlegung.
$ruleData = avesmapsFetchLoreRulePlacesByEntry($rulePdo, ['wurzelkraut']);
$wurzelkrautTitles = array_column($ruleData['places_by_entry']['wurzelkraut'] ?? [], 'title');
assert(!in_array('Finsterkamm', $wurzelkrautTitles, true),
    'links-nach-rechts liefert FALSCH fuer Finsterkamm -- eine Praezedenz-Lesart liefert hier WAHR und faellt durch');

// --- Task 7: rule_zones kommt aus der REGEL, nicht aus der Flaechenrechnung ---------------
avesmapsLoreRuleSave($rulePdo, 'sonnenblume', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt',
]], 'verbreitung', 7);
$sonnenblumeData = avesmapsFetchLoreRulePlacesByEntry($rulePdo, ['sonnenblume']);
assert($sonnenblumeData['zones_by_entry']['sonnenblume'] === ['boreal', 'gemaessigt'],
    'die erlaubten Zonen kommen aus der Klimaspanne der Regel, Nord nach Sued');

// --- Task 7: avesmapsBuildLoreSearchEntries -- region_public_id nur am Regelort, rule_zones
// nur am EINTRAG, nie am Ort -------------------------------------------------------------
$task7Entries = avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'gruppe' => '', 'typ' => '']],
    ['einbeere' => [['title' => 'Der Grosse Fluss', 'wiki_key' => 'der-grosse-fluss']]],
    AVESMAPS_LORE_SEARCH_KIND_LABELS,
    ['einbeere' => [['title' => 'Farindel', 'wiki_key' => 'farindel', 'region_public_id' => 'a1']]],
    ['einbeere' => ['boreal', 'gemaessigt']]
);
$task7Places = $task7Entries[0]['lore_places'];
// Der genannte Ort steht VORN (bestehende Rangfolge) und traegt keine region_public_id.
assert($task7Places[0]['title'] === 'Der Grosse Fluss');
assert(!array_key_exists('region_public_id', $task7Places[0]),
    '💣 MUTATION TARGET 3: ein genannter Ort hat keine region_public_id -- er hat keine Region');
assert($task7Places[1]['region_public_id'] === 'a1', 'der Regelort dahinter traegt seine region_public_id');
// rule_zones sitzt am EINTRAG, nicht an einem der beiden Orte.
assert($task7Entries[0]['rule_zones'] === ['boreal', 'gemaessigt'], 'rule_zones steht am Eintrag');
foreach ($task7Places as $place) {
    assert(!array_key_exists('rule_zones', $place),
        '💣 MUTATION TARGET 4: rule_zones darf nicht je Ort stehen, nur je Eintrag');
}
// Ein Eintrag ohne Regel -> leere Liste, kein fehlendes Feld.
$noRuleEntries = avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'kein-ort', 'kind' => 'ware', 'name' => 'Ortlose Ware', 'gruppe' => '', 'typ' => '']],
    [],
    AVESMAPS_LORE_SEARCH_KIND_LABELS
);
assert($noRuleEntries[0]['rule_zones'] === [], 'ein Eintrag ohne Regel bekommt eine leere Zonenliste');

echo "lore-search: OK\n";
