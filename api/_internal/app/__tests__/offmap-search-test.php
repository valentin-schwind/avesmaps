<?php

declare(strict_types=1);

/**
 * Die siebte Suchquelle: Objekte, die das Wiki kennt und keine Karte zeigt.
 *
 * Geprueft wird der REINE Teil -- ohne MySQL, das Einzige, was auf der
 * Entwicklungsmaschine beweisbar ist (dieselbe Begrenzung wie bei
 * in-settlement-search.php).
 */

require_once __DIR__ . '/../../wiki/sync.php';
require_once __DIR__ . '/../../wiki/place-scope.php';
require_once __DIR__ . '/../../wiki/map-presence.php';
require_once __DIR__ . '/../offmap-search.php';

// ---------------------------------------------------------------------------
// Der Ziel-Index: worauf ein Treffer zeigen darf.
// ---------------------------------------------------------------------------

$targetIndex = avesmapsBuildOffmapTargetIndex(
    [
        ['feature_type' => 'region', 'feature_subtype' => 'region',
         'public_id' => 'reg-weiden', 'name' => 'Weiden'],
        ['feature_type' => 'location', 'feature_subtype' => 'stadt',
         'public_id' => 'loc-gareth', 'name' => 'Gareth'],
    ],
    [['public_id' => 'ter-garetien', 'name' => 'Garetien']]
);

assert($targetIndex[avesmapsPlaceScopeFoldName('Weiden')]['public_id'] === 'reg-weiden');
// 🔴 Die kind-Werte sind die, die spotlightPlaceLookupKeys im Client kennt.
// Ein anderer Wert findet nichts -- der Treffer faellt still in unreachable.
assert($targetIndex[avesmapsPlaceScopeFoldName('Weiden')]['kind'] === 'region');
assert($targetIndex[avesmapsPlaceScopeFoldName('Gareth')]['kind'] === 'settlement');
assert($targetIndex[avesmapsPlaceScopeFoldName('Garetien')]['kind'] === 'territory');

// ---------------------------------------------------------------------------
// Die Eintraege.
// ---------------------------------------------------------------------------

$scopeIndex = ['settlements' => [], 'regions' => ['weiden' => true]];
$presence   = avesmapsBuildMapPresenceIndex([['name' => 'Gareth', 'properties_json' => null]]);

$rows = [
    ['title' => 'Rabenstein', 'type_label' => 'Burg', 'place_raw' => '[[Weiden]]',
     'wiki_url' => 'https://wiki/Rabenstein', 'kind' => 'building'],
    ['title' => 'Steinerne Rinne', 'type_label' => 'Gebirgspass', 'place_raw' => '',
     'wiki_url' => 'https://wiki/Rinne', 'kind' => 'path'],
    ['title' => 'Gareth', 'type_label' => 'Metropole', 'place_raw' => '',
     'wiki_url' => 'https://wiki/Gareth', 'kind' => 'settlement'],
];

$entries = avesmapsBuildOffmapSearchEntries($rows, $targetIndex, $scopeIndex, $presence);
$byName = [];
foreach ($entries as $e) {
    $byName[$e['name']] = $e;
}

assert(!isset($byName['Gareth']), 'Was auf der Karte liegt, gehoert nicht in diese Quelle');

// Der erreichbare Fall.
assert($byName['Rabenstein']['unresolved'] === false, 'aufgeloestes Ziel');
assert($byName['Rabenstein']['place_name'] === 'Weiden', 'Ziel benannt');
// 💣 Ohne public_id landet der Treffer im Client stumm im unreachable-Zweig:
// er saehe richtig aus und taete beim Klick nichts.
assert($byName['Rabenstein']['place_public_id'] === 'reg-weiden', 'Ziel ist ANSPRINGBAR');
assert($byName['Rabenstein']['place_kind'] === 'region', 'mit einer Art, die der Client kennt');
assert($byName['Rabenstein']['type_label'] === 'Burg · Weiden', 'Typzeile nennt den Ort');
assert($byName['Rabenstein']['not_on_map'] === true, 'immer gedaempft');

// Der unerreichbare Fall.
assert($byName['Steinerne Rinne']['unresolved'] === true, 'ohne Rohwert kein Ziel');
assert($byName['Steinerne Rinne']['place_name'] === '', 'und kein erfundener Ortsname');
assert($byName['Steinerne Rinne']['place_public_id'] === '', 'und keine erfundene id');
assert($byName['Steinerne Rinne']['type_label'] === 'Gebirgspass', 'Typzeile ohne Ort');

// 💣 Ein Name, den der Scope-Index kennt, den die KARTE aber nicht zeigt, ist kein
// Ziel. Sonst verspricht der Treffer einen Flug, den der Client nicht fliegen kann.
$ohneKarte = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Ding', 'type_label' => 'Burg', 'place_raw' => '[[Weiden]]',
      'wiki_url' => '', 'kind' => 'building']],
    [],
    $scopeIndex,
    []
);
assert($ohneKarte[0]['unresolved'] === true, 'kein Kartenobjekt = kein Ziel');
assert($ohneKarte[0]['place_name'] === '', 'und kein Rohtext in der Anzeige');

// Ein leerer Titel erzeugt keinen Eintrag.
$leer = avesmapsBuildOffmapSearchEntries(
    [['title' => '  ', 'type_label' => 'Burg', 'place_raw' => '', 'wiki_url' => '', 'kind' => 'building']],
    $targetIndex,
    $scopeIndex,
    []
);
assert($leer === [], 'ohne Titel kein Treffer');

// ---------------------------------------------------------------------------
// Die Kandidaten eines Rohwerts -- drei Formen kommen im Bestand vor.
// ---------------------------------------------------------------------------

assert(
    avesmapsOffmapPlaceCandidates('[[Gareth]]: [[Arenaviertel]]') === ['Gareth', 'Arenaviertel'],
    'Wiki-Markup: alle Ziele in ihrer Reihenfolge'
);
// 💣 Der Trenner „ · " kommt aus avesmapsWikiSettlementParseInfobox (lage = region · staat).
// BEIDE Haelften sind Kandidaten: ist die Region ungezeichnet, der Staat aber schon,
// soll der Staat gewinnen.
assert(
    avesmapsOffmapPlaceCandidates('Garetien · Mittelreich') === ['Garetien', 'Mittelreich'],
    'geputzte Lage: an ihrem Trenner zerlegt'
);
assert(avesmapsOffmapPlaceCandidates('Garetien') === ['Garetien'], 'blanker Name');
assert(avesmapsOffmapPlaceCandidates('   ') === [], 'leer bleibt leer');

// Genau diese Reihenfolge tut ihren Dienst: die erste Haelfte kennt die Karte nicht,
// die zweite schon.
$nurStaat = avesmapsBuildOffmapTargetIndex(
    [], [['public_id' => 'ter-mr', 'name' => 'Mittelreich']]
);
$treffer = avesmapsOffmapResolvePlace('Unbekanntland · Mittelreich', $nurStaat);
assert($treffer !== null && $treffer['name'] === 'Mittelreich', 'der zweite Kandidat rettet den Treffer');

// ---------------------------------------------------------------------------
// 💣 Innerorts gehoert der DRITTEN Quelle -- sonst steht es doppelt in der Liste.
// ---------------------------------------------------------------------------

$stadtIndex = ['settlements' => ['gareth' => true], 'regions' => []];
$innerorts = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Greifax-Palast', 'type_label' => 'Palast',
      'place_raw' => '[[Gareth]]: [[Arenaviertel]]', 'wiki_url' => '', 'kind' => 'building']],
    $targetIndex,
    $stadtIndex,
    []
);
assert($innerorts === [], 'Innerorts-Objekte gehoeren in-settlement-search.php, nicht hierher');

// „unklar" bleibt dagegen drin: dort weiss niemand, ob Stadt oder Gebiet gemeint ist,
// und ein Treffer ohne Sprungziel ist besser als gar keiner.
$unklarIndex = ['settlements' => ['abagund' => true], 'regions' => ['albernia' => true, 'abagund' => true]];
$unklar = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Irgendburg', 'type_label' => 'Burg',
      'place_raw' => '[[Albernia]]: [[Abagund]]', 'wiki_url' => '', 'kind' => 'building']],
    [],
    $unklarIndex,
    []
);
assert(count($unklar) === 1, 'ein unklarer Fall wird gezeigt, nicht verschluckt');
assert($unklar[0]['unresolved'] === true, 'aber ohne vorgetaeuschtes Ziel');

// ---------------------------------------------------------------------------
// Herrschaftsgebiete (Stufe 2). Ihr Sprungziel ist das ELTERNgebiet, und das ist
// ein Territorium -- der Ziel-Index muss es aus den politischen Zeilen kennen.
// ---------------------------------------------------------------------------

$zielIndex = avesmapsBuildOffmapTargetIndex(
    [],
    [['public_id' => 'ter-garetien', 'name' => 'Garetien']]
);
$gebiete = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Baronie Falkenstein', 'type_label' => 'Baronie',
      'place_raw' => 'Garetien', 'wiki_url' => '', 'kind' => 'territory']],
    $zielIndex,
    ['settlements' => [], 'regions' => ['garetien' => true]],
    []
);
assert($gebiete[0]['unresolved'] === false, 'Elterngebiet ist ein gueltiges Ziel');
assert($gebiete[0]['place_kind'] === 'territory', 'und wird als Territorium angesprungen');
assert($gebiete[0]['place_public_id'] === 'ter-garetien');
assert($gebiete[0]['type_label'] === 'Baronie · Garetien');

// 💣 Ein Gebiet OHNE Elterngebiet (eine Wurzel) ist kein Fehler -- es wird gezeigt,
// nur ohne Flug. Sonst verschwaenden ausgerechnet die groessten Reiche.
$wurzel = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Mittelreich', 'type_label' => 'Reich',
      'place_raw' => '', 'wiki_url' => '', 'kind' => 'territory']],
    $zielIndex,
    ['settlements' => [], 'regions' => []],
    []
);
assert(count($wurzel) === 1, 'ein Reich ohne Elterngebiet bleibt auffindbar');
assert($wurzel[0]['unresolved'] === true, 'nur eben ohne Sprungziel');

// ---------------------------------------------------------------------------
// „Welches Gebiet hat nirgends eine Flaeche?" -- die Rechnung, die statt einer
// rekursiven CTE laeuft (sie wuerde pro Tastendruck ~1400 Unterbaeume bauen).
// ---------------------------------------------------------------------------

//   1 Mittelreich
//   +-- 2 Garetien            (hat selbst KEINE Flaeche)
//   |    +-- 3 Falkenstein    (hat eine Flaeche)
//   +-- 4 Nostria             (nichts im ganzen Zweig)
//        +-- 5 Salza
$baum = [
    1 => ['parent_id' => null, 'name' => 'Mittelreich', 'type' => 'Reich', 'wiki_url' => '', 'continent' => 'Aventurien'],
    2 => ['parent_id' => 1, 'name' => 'Garetien', 'type' => 'Koenigreich', 'wiki_url' => '', 'continent' => 'Aventurien'],
    3 => ['parent_id' => 2, 'name' => 'Falkenstein', 'type' => 'Baronie', 'wiki_url' => '', 'continent' => 'Aventurien'],
    4 => ['parent_id' => 1, 'name' => 'Nostria', 'type' => 'Koenigreich', 'wiki_url' => '', 'continent' => 'Aventurien'],
    5 => ['parent_id' => 4, 'name' => 'Salza', 'type' => 'Baronie', 'wiki_url' => '', 'continent' => 'Aventurien'],
];

$ohneFlaeche = avesmapsOffmapTerritoriesWithoutArea($baum, [3]);
$namen = array_map(static fn(array $z): string => $z['title'], $ohneFlaeche);
sort($namen);

// 🔴 Nur Nostria und Salza. Garetien und Mittelreich sind BEDECKT -- ueber Falkenstein,
// ihren Nachfahren. Genau das leistet die Elternkette, und genau das entscheidet auch
// der JOIN in map-search.php; weichen die beiden ab, erscheint ein Gebiet doppelt.
assert($namen === ['Nostria', 'Salza'], 'nur der Zweig ganz ohne Flaeche, Vorfahren sind bedeckt');

$nostria = null;
foreach ($ohneFlaeche as $zeile) {
    if ($zeile['title'] === 'Nostria') {
        $nostria = $zeile;
    }
}
assert($nostria['place_raw'] === 'Mittelreich', 'das Elterngebiet ist der Rohwert');
assert($nostria['type_label'] === 'Koenigreich', 'die Art kommt aus `type`, nicht aus einem geratenen Feld');
assert($nostria['kind'] === 'territory');

// Ohne jede Flaeche ist ALLES unbedeckt.
assert(count(avesmapsOffmapTerritoriesWithoutArea($baum, [])) === 5, 'ohne Flaechen faellt nichts heraus');

// Ein anderer Kontinent gehoert nicht auf diese Karte.
$myranor = $baum;
$myranor[5]['continent'] = 'Myranor';
$ohneMyranor = avesmapsOffmapTerritoriesWithoutArea($myranor, [3]);
assert(count($ohneMyranor) === 1, 'Myranor faellt heraus, Nostria bleibt');

// 💣 Ein Zyklus in parent_id darf die Suche nicht haengen lassen -- und zwar keine
// einzige Anfrage, nicht nur diese eine. Ohne den Tiefenzaehler laeuft die
// Elternkette hier fuer immer.
$zyklus = [
    1 => ['parent_id' => 2, 'name' => 'A', 'type' => '', 'wiki_url' => '', 'continent' => ''],
    2 => ['parent_id' => 1, 'name' => 'B', 'type' => '', 'wiki_url' => '', 'continent' => ''],
];
$ausZyklus = avesmapsOffmapTerritoriesWithoutArea($zyklus, [1]);
assert($ausZyklus === [], 'der Zyklus wird durchlaufen und endet -- ohne Haenger');

// ---------------------------------------------------------------------------
// Die Rangfolge: wer hinfliegen kann, steht vorn.
// ---------------------------------------------------------------------------

$mit  = ['score' => 10, 'unresolved' => false, 'name' => 'Zwiebel'];
$ohne = ['score' => 10, 'unresolved' => true,  'name' => 'Apfel'];
assert(avesmapsOffmapSearchCompare($mit, $ohne) < 0, 'erreichbar schlaegt unerreichbar');
assert(avesmapsOffmapSearchCompare($ohne, $mit) > 0, 'und andersherum genauso');

// Der Punktestand bleibt aber die erste Frage.
$besser = ['score' => 1, 'unresolved' => true, 'name' => 'Apfel'];
assert(avesmapsOffmapSearchCompare($besser, $mit) < 0, 'Punktestand schlaegt Erreichbarkeit');

// Bei Gleichstand entscheidet der Name.
$a = ['score' => 5, 'unresolved' => false, 'name' => 'Apfel'];
$b = ['score' => 5, 'unresolved' => false, 'name' => 'Zwiebel'];
assert(avesmapsOffmapSearchCompare($a, $b) < 0, 'sonst alphabetisch');

echo "offmap-search-test: OK\n";
