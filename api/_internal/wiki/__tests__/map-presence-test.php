<?php

declare(strict_types=1);

/**
 * „Liegt dieser Wiki-Titel auf der Karte?" — die geteilte Rechnung.
 *
 * Sie beantwortet dieselbe Frage fuer die Ortsliste des Editors UND fuer die
 * Kartensuche. Laufen die beiden auseinander, meldet die eine Seite ein Objekt als
 * fehlend, das die andere laengst zeigt.
 */

require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../map-presence.php';

$rows = [
    ['name' => 'Gareth', 'properties_json' => null],
    ['name' => 'Ochsenblut', 'properties_json' => json_encode([
        'wiki_settlement' => ['title' => 'Baronie Ochsenblut'],
    ])],
];
$index = avesmapsBuildMapPresenceIndex($rows);

assert(avesmapsIsTitleOnMap('Gareth', $index) === true, 'Kartenname zaehlt');

// 💣 DIE TRAGENDE HAELFTE: der zugewiesene Wiki-Titel zaehlt auch dann, wenn der
// Kartenname abweicht. Ohne sie gilt „Baronie Ochsenblut" als nicht auf der Karte,
// und die Suche boete an, zu etwas zu fliegen, das laengst dasteht.
assert(
    avesmapsIsTitleOnMap('Baronie Ochsenblut', $index) === true,
    'ZUGEWIESENER Wiki-Titel zaehlt auch, wenn der Kartenname abweicht'
);

assert(avesmapsIsTitleOnMap('Rabenstein', $index) === false, 'Unbekanntes nicht');
assert(avesmapsIsTitleOnMap('', $index) === false, 'Leerer Titel nie');

// Die Faltung ist die des Hauses (avesmapsWikiSyncCreateMatchKey): Umlaute und
// Gross-/Kleinschreibung duerfen keinen Unterschied machen.
$gefaltet = avesmapsBuildMapPresenceIndex([['name' => 'Grangor', 'properties_json' => null]]);
assert(avesmapsIsTitleOnMap('GRANGOR', $gefaltet) === true, 'Schreibweise egal');

// Ein properties_json als bereits dekodiertes Array (so kommt es aus manchen
// Lesepfaden) muss genauso zaehlen wie der JSON-String.
$alsArray = avesmapsBuildMapPresenceIndex([
    ['name' => 'Irgendwas', 'properties_json' => ['wiki_settlement' => ['title' => 'Echter Titel']]],
]);
assert(avesmapsIsTitleOnMap('Echter Titel', $alsArray) === true, 'dekodiertes Array zaehlt auch');

// 💣 Kreuzungen zaehlen nicht -- beide Erkennungshaelften pruefen, denn der Name
// entsteht erst im Browser und es gibt Zeilen mit Praefix ohne Subtyp.
$kreuzungen = avesmapsBuildMapPresenceIndex([
    ['name' => 'Kreuzung-12', 'feature_subtype' => 'kreuzung', 'properties_json' => null],
    ['name' => 'Kreuzung-13', 'properties_json' => null],
    ['name' => 'Namenlos', 'feature_subtype' => 'kreuzung', 'properties_json' => null],
]);
assert($kreuzungen === [], 'keine einzige Kreuzung im Index');

// Und die Gegenprobe: ein Ort, dessen Name zufaellig so anfaengt, bleibt drin --
// hier gibt es keinen, aber die Regel darf nicht auf blosses „Kreuz" anspringen.
$kreuzweg = avesmapsBuildMapPresenceIndex([['name' => 'Kreuzweiher', 'properties_json' => null]]);
assert(avesmapsIsTitleOnMap('Kreuzweiher', $kreuzweg) === true, 'nur der volle Praefix zaehlt');

// Kaputtes JSON darf nicht werfen -- der Bestand traegt Altlasten.
$kaputt = avesmapsBuildMapPresenceIndex([['name' => 'Heil', 'properties_json' => '{nicht json']]);
assert(avesmapsIsTitleOnMap('Heil', $kaputt) === true, 'kaputtes JSON kostet nur das Nest, nie die Zeile');

echo "map-presence-test: OK\n";
