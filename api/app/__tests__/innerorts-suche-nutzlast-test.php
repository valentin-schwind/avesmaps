<?php

declare(strict_types=1);

/**
 * Innerorts in der Kartennutzlast (`in_settlement_places`) und in der Kartensuche -- AUSGEFUEHRT.
 * ===========================================================================
 * Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §6.1, §7
 *
 *   A. der reine Bauer avesmapsBuildInSettlementPlaceList mit Punkten (Form, Vorrang, Dopplung)
 *   B. avesmapsMapFeaturesInSettlementPlaces -- aus dem ECHTEN Endpunkt geschnitten und gegen eine
 *      SQLite-Fixture gefahren (drei Quellen, ein Objekt = ein Eintrag)
 *   C. avesmapsBuildMapSearchResults -- aus dem ECHTEN Endpunkt geschnitten (Verfahren wie
 *      map-search-verdrahtung-test.php): aktiver Punkt = normaler Treffer „in Gareth", genommener Punkt
 *      = `in_settlement`-Treffer seiner Stadt, die Ableitung desselben Artikels faellt heraus
 *
 * ⚠️ eval() liest nur feste Dateien DIESES Repos (ueber __DIR__) -- dieselbe Begruendung wie im
 * Nachbartest map-search-verdrahtung-test.php. Ein `require` wuerde eine Anfrage ausfuehren.
 *
 * Lauf (aus der Wurzel):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/app/__tests__/innerorts-suche-nutzlast-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/text/ascii-fold.php';
require_once __DIR__ . '/../../_internal/app/map-search-scoring.php';
require_once __DIR__ . '/../../_internal/app/search-section.php';
require_once __DIR__ . '/../../_internal/app/in-settlement-search.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/citymap-search.php';
require_once __DIR__ . '/../../_internal/app/game-literature-search.php';
require_once __DIR__ . '/../../_internal/app/lore-search.php';
require_once __DIR__ . '/../../_internal/app/offmap-search.php';
require_once __DIR__ . '/../../_internal/app/landscape-search.php';
require_once __DIR__ . '/../../_internal/wiki/path-naming.php';
require_once __DIR__ . '/../../_internal/app/settlement-places.php';
require_once __DIR__ . '/../../_internal/app/innerorts.php';

$pruefungen = 0;

// ---- Die zwei Endpunkte: Funktionen schneiden und ausfuehren --------------------------------------
$suche = (string) file_get_contents(__DIR__ . '/../map-search.php');
$anfrageBeginn = strpos($suche, "\ntry {");
$funktionenBeginn = strpos($suche, 'function avesmapsReadMapSearchQuery');
assert($anfrageBeginn !== false && $funktionenBeginn !== false, 'Marker der Kartensuche gefunden -- Endpunkt umgebaut?');
$kopf = (string) preg_replace('/^\s*(<\?php|declare\(strict_types=1\);|require(_once)?\s.*?;)\s*$/m', '', substr($suche, 0, $anfrageBeginn));
eval($kopf . "\n" . substr($suche, $funktionenBeginn));

/** Eine Funktion per Tokenizer aus einer Datei schneiden (Klammerzaehlung, Kommentare egal). */
function innerortsFunktionSchneiden(string $quelle, string $name): string
{
    $tokens = token_get_all($quelle);
    $raus = '';
    $drin = false;
    $tiefe = 0;
    foreach ($tokens as $i => $t) {
        $text = is_array($t) ? $t[1] : $t;
        if (!$drin && is_array($t) && $t[0] === T_FUNCTION) {
            for ($j = $i + 1; isset($tokens[$j]) && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE; $j++) {
            }
            if (isset($tokens[$j]) && is_array($tokens[$j]) && $tokens[$j][1] === $name) {
                $drin = true;
            }
        }
        if (!$drin) {
            continue;
        }
        $raus .= $text;
        if ($text === '{' || (is_array($t) && in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) {
            $tiefe++;
        } elseif ($text === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return $raus;
            }
        }
    }
    assert(false, "Funktion {$name} nicht gefunden");

    return '';
}
eval(innerortsFunktionSchneiden((string) file_get_contents(__DIR__ . '/../map-features.php'), 'avesmapsMapFeaturesInSettlementPlaces'));

// ---- Fixture ------------------------------------------------------------------------------------
const IOS_GARETH = 'bbbbbbbb-0000-4000-8000-000000000001';
const IOS_PUNIN = 'bbbbbbbb-0000-4000-8000-000000000002';
const IOS_NEUGARETH = 'bbbbbbbb-0000-4000-8000-000000000010';
const IOS_HAFEN = 'bbbbbbbb-0000-4000-8000-000000000011';
const IOS_GELOESCHT = 'bbbbbbbb-0000-4000-8000-000000000012';
const IOS_NG_URL = 'https://de.wiki-aventurica.de/wiki/Neu-Gareth';
const IOS_HAFEN_URL = 'https://de.wiki-aventurica.de/wiki/Alter_Hafen_(Gareth)';

function iosPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT,
        geometry_type TEXT, geometry_json TEXT, properties_json TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 1
    )');
    $pdo->exec('CREATE TABLE wiki_sync_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, building_type TEXT,
        wiki_url TEXT, standort TEXT, settlement_class TEXT, deity TEXT)');
    $pdo->exec('CREATE TABLE political_territory (name TEXT)');
    $seite = $pdo->prepare('INSERT INTO wiki_sync_pages (title, building_type, wiki_url, standort, settlement_class, deity)
        VALUES (:t, :b, :u, :s, :k, \'\')');
    // Die Ableitung kennt Neu-Gareth (dasselbe Objekt wie der Punkt, nur ueber eine ANDERE Schreibweise
    // der Adresse -- Leerzeichen statt Unterstrich) und einen Palast, den es nur im Wiki gibt.
    $seite->execute(['t' => 'Neu-Gareth', 'b' => 'Stadtviertel', 'u' => 'https://www.de.wiki-aventurica.de/wiki/Neu-Gareth', 's' => '[[Gareth]]', 'k' => 'stadtviertel']);
    $seite->execute(['t' => 'Palast der Winde', 'b' => 'Palast', 'u' => 'https://de.wiki-aventurica.de/wiki/Palast_der_Winde', 's' => '[[Gareth]]', 'k' => 'gebaeude']);
    $seite->execute(['t' => 'Alter Hafen', 'b' => 'Hafen', 'u' => 'https://de.wiki-aventurica.de/wiki/Alter Hafen (Gareth)', 's' => '[[Gareth]]', 'k' => 'gebaeude']);

    iosPunkt($pdo, IOS_GARETH, 'Gareth', 'metropole', [], true, 30.0, 40.0);
    iosPunkt($pdo, IOS_PUNIN, 'Punin', 'stadt', [], true, 60.0, 70.0);
    iosPunkt($pdo, IOS_NEUGARETH, 'Neu-Gareth', 'stadtviertel', [
        'wiki_settlement' => ['title' => 'Neu-Gareth', 'wiki_url' => IOS_NG_URL], 'innerorts' => ['ort' => IOS_GARETH],
    ], true, 31.0, 41.0);
    iosPunkt($pdo, IOS_HAFEN, 'Alter Hafen', 'gebaeude', [
        'place_kind' => 'Hafen', 'wiki_settlement' => ['title' => 'Alter Hafen', 'wiki_url' => IOS_HAFEN_URL],
        'innerorts' => ['ort' => IOS_GARETH, 'von_der_karte' => true],
    ], false, 32.0, 42.0);
    // Normal geloescht (ohne Merker): ist keine Staette und kein Treffer.
    iosPunkt($pdo, IOS_GELOESCHT, 'Weggeraeumtes Haus', 'gebaeude', ['innerorts' => ['ort' => IOS_GARETH]], false);

    return $pdo;
}

function iosPunkt(PDO $pdo, string $id, string $name, string $subtype, array $props, bool $aktiv = true, float $x = 33.0, float $y = 43.0): void
{
    $pdo->prepare('INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json,
        properties_json, min_x, min_y, max_x, max_y, is_active) VALUES (:p, \'location\', :s, :n, \'Point\', :g, :j, :x, :y, :x2, :y2, :a)')
        ->execute(['p' => $id, 's' => $subtype, 'n' => $name, 'g' => json_encode(['type' => 'Point', 'coordinates' => [$x, $y]]),
            'j' => json_encode($props + ['name' => $name], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'x' => $x, 'y' => $y, 'x2' => $x, 'y2' => $y, 'a' => $aktiv ? 1 : 0]);
}

// =============================================================================================
// A. Der reine Bauer
// =============================================================================================
$scope = ['settlements' => avesmapsPlaceScopeBuildNameSet(['Gareth', 'Punin']), 'regions' => []];
$registry = [
    ['title' => 'Neu-Gareth', 'raw' => '[[Gareth]]', 'type_label' => 'Stadtviertel', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Neu Gareth'],
    ['title' => 'Palast der Winde', 'raw' => '[[Gareth]]', 'type_label' => 'Palast', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Palast_der_Winde'],
];
$gespeichert = [['name' => 'Garetien-Stätte', 'settlement' => 'Gareth', 'type' => 'Schrein', 'wiki_url' => '']];
$punkte = [
    ['name' => 'Neu-Gareth', 'settlement' => 'Gareth', 'type' => 'Stadtviertel', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Neu_Gareth', 'public_id' => 'p-1', 'auf_der_karte' => true],
    ['name' => 'Rahja-Tempel', 'settlement' => 'Gareth', 'type' => 'Tempel', 'wiki_url' => '', 'public_id' => 'p-2', 'auf_der_karte' => false],
    ['name' => 'Rahja-Tempel', 'settlement' => 'Punin', 'type' => 'Tempel', 'wiki_url' => '', 'public_id' => 'p-3', 'auf_der_karte' => true],
];
$liste = avesmapsBuildInSettlementPlaceList($registry, $scope, $gespeichert, $punkte);
$namen = array_map(static fn(array $e): string => $e['name'] . '@' . $e['settlement'], $liste);
assert($namen === ['Neu-Gareth@Gareth', 'Rahja-Tempel@Gareth', 'Rahja-Tempel@Punin', 'Garetien-Stätte@Gareth', 'Palast der Winde@Gareth'],
    'Punkte vorn, zwei gleichnamige Tempel in zwei Staedten bleiben zwei, die Ableitung desselben Artikels faellt: ' . json_encode($namen));
assert($liste[0] === ['name' => 'Neu-Gareth', 'settlement' => 'Gareth', 'type' => 'Stadtviertel',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Neu_Gareth', 'public_id' => 'p-1', 'auf_der_karte' => true], 'Form eines Punkt-Eintrags');
assert($liste[1]['auf_der_karte'] === false, 'ein genommener Punkt: auf_der_karte false');
assert(!array_key_exists('public_id', $liste[3]) && !array_key_exists('auf_der_karte', $liste[4]),
    'gespeicherte und abgeleitete Eintraege behalten ihre Form -- keine neuen Felder');
assert(avesmapsBuildInSettlementPlaceList($registry, $scope, $gespeichert) === avesmapsBuildInSettlementPlaceList($registry, $scope, $gespeichert, []),
    'ohne Punkte aendert sich nichts (vierter Parameter optional)');
// 🔴 Gefiltert wird NUR mit den Punkt-Artikeln: ein Punkt ohne Adresse nimmt keiner Ableitung etwas weg.
$ohneAdresse = avesmapsBuildInSettlementPlaceList($registry, $scope, [], [['name' => 'X', 'settlement' => 'Gareth', 'type' => '', 'wiki_url' => '', 'public_id' => 'p-9', 'auf_der_karte' => true]]);
assert(count($ohneAdresse) === 3, 'ein Punkt ohne Artikel filtert keine Ableitung');
// 💣 Der Name allein entdoppelt nicht: ein UMBENANNTER Punkt („Neugareth") traegt denselben Artikel wie
// die Ableitung „Neu-Gareth" -- nur die Adresse erkennt beide als EIN Objekt.
$umbenannt = avesmapsBuildInSettlementPlaceList($registry, $scope, [], [
    ['name' => 'Neugareth', 'settlement' => 'Gareth', 'type' => 'Stadtviertel', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Neu_Gareth', 'public_id' => 'p-1', 'auf_der_karte' => true],
]);
assert(array_column($umbenannt, 'name') === ['Neugareth', 'Palast der Winde'], 'die Ableitung desselben Artikels faellt auch bei anderem Namen: ' . json_encode(array_column($umbenannt, 'name')));
// Zwei gleichnamige Punkte derselben Stadt sind zwei Datensaetze, zwei `⊕`.
$zwillinge = avesmapsBuildInSettlementPlaceList([], $scope, [], [
    ['name' => 'Tor', 'settlement' => 'Gareth', 'type' => '', 'wiki_url' => '', 'public_id' => 'p-a', 'auf_der_karte' => true],
    ['name' => 'Tor', 'settlement' => 'Gareth', 'type' => '', 'wiki_url' => '', 'public_id' => 'p-b', 'auf_der_karte' => true],
]);
assert(array_column($zwillinge, 'public_id') === ['p-a', 'p-b'], 'Punkte werden untereinander nicht entdoppelt');
$pruefungen += 8;

// =============================================================================================
// B. Die Kartennutzlast -- avesmapsMapFeaturesInSettlementPlaces am echten Code
// =============================================================================================
$pdo = iosPdo();
$staetten = avesmapsMapFeaturesInSettlementPlaces($pdo);
$nachName = [];
foreach ($staetten as $e) {
    $nachName[$e['name']][] = $e;
}
assert(isset($nachName['Neu-Gareth']) && count($nachName['Neu-Gareth']) === 1, 'Neu-Gareth genau einmal (Punkt, nicht Ableitung): ' . json_encode($staetten));
assert(($nachName['Neu-Gareth'][0]['public_id'] ?? '') === IOS_NEUGARETH && $nachName['Neu-Gareth'][0]['auf_der_karte'] === true
    && $nachName['Neu-Gareth'][0]['settlement'] === 'Gareth' && $nachName['Neu-Gareth'][0]['type'] === 'Stadtviertel', 'der Punkt-Eintrag mit Sprungziel');
assert(count($nachName['Alter Hafen'] ?? []) === 1 && $nachName['Alter Hafen'][0]['auf_der_karte'] === false
    && $nachName['Alter Hafen'][0]['public_id'] === IOS_HAFEN, 'der genommene Punkt ist Staette, seine Ableitung (andere Schreibweise der Adresse) faellt');
assert(isset($nachName['Palast der Winde']) && !isset($nachName['Palast der Winde'][0]['public_id']), 'die reine Wiki-Staette bleibt, unveraendert');
assert(!isset($nachName['Weggeraeumtes Haus']), 'ein normal geloeschter Punkt ist keine Staette');
$pruefungen += 5;

// =============================================================================================
// C. Die Kartensuche am echten Code
// =============================================================================================
$zeilen = avesmapsFetchMapSearchRows($pdo);
$inSettlement = avesmapsFetchInSettlementSearchRows($pdo);
$genommen = avesmapsFetchInnerortsVonDerKarteRows($pdo);
assert(array_column($genommen, 'public_id') === [IOS_HAFEN], 'die Suche liest nur den genommenen Punkt nach (nicht den geloeschten)');
$pruefungen++;

$fehlerLog = tempnam(sys_get_temp_dir(), 'ios');
$altesLog = ini_set('error_log', $fehlerLog);
$suchen = static fn(string $q): array => avesmapsBuildMapSearchResults($zeilen, [], $q, 20, $inSettlement, $pdo, innerortsVonDerKarte: $genommen);

$ng = $suchen('Neu-Gareth');
$ngTreffer = array_values(array_filter($ng, static fn(array $e): bool => $e['name'] === 'Neu-Gareth'));
assert(count($ngTreffer) === 1 && $ngTreffer[0]['kind'] === 'location' && $ngTreffer[0]['public_id'] === IOS_NEUGARETH,
    'ein aktiver innerorts-Punkt ist EIN normaler Kartentreffer, kein zusaetzlicher in_settlement: ' . json_encode($ng));
assert(str_ends_with((string) $ngTreffer[0]['type_label'], ' in Gareth'), 'mit dem Zusatz „in Gareth": ' . $ngTreffer[0]['type_label']);
$pruefungen += 2;

$hafen = $suchen('Alter Hafen');
$hafenTreffer = array_values(array_filter($hafen, static fn(array $e): bool => $e['name'] === 'Alter Hafen'));
assert(count($hafenTreffer) === 1, 'der genommene Punkt ist genau EIN Treffer (seine Ableitung faellt): ' . json_encode($hafen));
assert($hafenTreffer[0]['kind'] === 'in_settlement' && $hafenTreffer[0]['public_id'] === IOS_GARETH
    && $hafenTreffer[0]['settlement_public_id'] === IOS_GARETH && $hafenTreffer[0]['type_label'] === 'Hafen in Gareth'
    && $hafenTreffer[0]['min_x'] === 30.0 && $hafenTreffer[0]['wiki_url'] === IOS_HAFEN_URL,
    'Bauform der Innerorts-Treffer, Sprung auf die Stadt: ' . json_encode($hafenTreffer[0]));
$pruefungen += 2;

$palast = array_values(array_filter($suchen('Palast der Winde'), static fn(array $e): bool => $e['name'] === 'Palast der Winde'));
assert(count($palast) === 1 && $palast[0]['kind'] === 'in_settlement', 'eine reine Wiki-Staette bleibt ein Innerorts-Treffer');
assert($suchen('Weggeraeumtes') === [], 'ein normal geloeschter Punkt ist kein Treffer');
$pruefungen += 2;

// Ohne die neue Quelle (alter Aufrufer): der genommene Punkt fehlt, sonst aendert sich nichts.
$ohne = array_values(array_filter(
    avesmapsBuildMapSearchResults($zeilen, [], 'Alter Hafen', 20, $inSettlement, $pdo),
    static fn(array $e): bool => $e['name'] === 'Alter Hafen'
));
assert(count($ohne) === 1 && $ohne[0]['kind'] === 'in_settlement', 'ohne den zwoelften Parameter bleibt die Ableitung stehen (Gegenprobe)');
$pruefungen++;
ini_set('error_log', (string) $altesLog);
@unlink($fehlerLog);

// Der Endpunkt reicht die Quelle wirklich durch (Verdrahtung, kommentarfrei).
$ohneKommentare = '';
foreach (token_get_all($suche) as $t) {
    $ohneKommentare .= (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) ? '' : (is_array($t) ? $t[1] : $t);
}
assert(str_contains($ohneKommentare, '$innerortsVonDerKarte = avesmapsFetchInnerortsVonDerKarteRows($pdo);')
    && str_contains($ohneKommentare, 'innerortsVonDerKarte: $innerortsVonDerKarte)'), 'der Endpunkt holt und uebergibt die genommenen Punkte');
$pruefungen++;

echo "innerorts-suche-nutzlast: alle {$pruefungen} Zusicherungen gruen\n";
