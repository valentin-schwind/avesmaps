<?php
// api/_internal/routing/__tests__/versteckte-orte-test.php
declare(strict_types=1);

/**
 * Das Merkmal „versteckt" auf dem Weg zum Routengraphen.
 *
 * 🔴 avesmapsBuildRouteLocationData baut seine Ortsobjekte aus einer AUSGESCHRIEBENEN Feldliste --
 * is_nodix und is_ruined stehen dort bis heute nicht, weil der Router sie nie brauchte. is_hidden
 * muss hinein, sonst erreicht das Merkmal den Graphbau nie und die Kandidatenliste in
 * client-graph.php filtert gegen ein Feld, das es nicht gibt. Genau diese Zeile bewacht dieser Test.
 *
 * Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require_once __DIR__ . '/../network-data.php';

$feature = static fn(string $name, bool $hidden): array => [
    'type' => 'Feature',
    'id' => 'loc-' . $name,
    'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 20.0]],
    'properties' => [
        'public_id' => 'loc-' . $name,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => 'dorf',
        'is_hidden' => $hidden,
    ],
];

// ---- das Merkmal ueberlebt die Feldliste --------------------------------------------------------
$versteckt = avesmapsBuildRouteLocationData($feature('Feenplatz', true));
assert(($versteckt['is_hidden'] ?? null) === true, 'ein versteckter Ort traegt is_hidden = true');

$offen = avesmapsBuildRouteLocationData($feature('Gareth', false));
assert(($offen['is_hidden'] ?? null) === false, 'ein gewoehnlicher Ort traegt is_hidden = false');

// ⚠️ Ein Ort, dessen Zeile das Feld gar nicht hat (jeder Bestandsort vor dieser Aenderung), ist NICHT
// versteckt. Kein Null, kein Fehlen -- ein harter Bool, damit die Filterregel in client-graph.php
// nicht drei Zustaende unterscheiden muss.
$alt = avesmapsBuildRouteLocationData([
    'type' => 'Feature', 'id' => 'loc-Alt',
    'geometry' => ['type' => 'Point', 'coordinates' => [1.0, 2.0]],
    'properties' => ['public_id' => 'loc-Alt', 'name' => 'Alt', 'feature_type' => 'location'],
]);
assert(($alt['is_hidden'] ?? null) === false, 'ein Ort ohne das Feld gilt als nicht versteckt');

// ---- der ganze Weg durch avesmapsBuildRouteNetworkData ------------------------------------------
$netz = avesmapsBuildRouteNetworkData(['features' => [$feature('Feenplatz', true), $feature('Gareth', false)]]);
$nachName = [];
foreach ($netz['locations'] as $ort) {
    $nachName[$ort['name']] = $ort;
}
assert(($nachName['Feenplatz']['is_hidden'] ?? null) === true, 'die Netzdaten reichen das Merkmal durch');
assert(($nachName['Gareth']['is_hidden'] ?? null) === false, 'und lassen den offenen Ort offen');

// ================================================================ die Kandidatenliste des Graphbaus

require_once __DIR__ . '/../client-graph.php';

// Eine kleine Welt: A -- H -- C auf y = 10, H ist versteckt und liegt MITTEN auf der Strasse.
$ort = static fn(string $name, float $x, float $y, bool $hidden = false): array => [
    'type' => 'Feature', 'id' => 'loc-' . $name,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
    'properties' => ['public_id' => 'loc-' . $name, 'name' => $name,
        'feature_type' => 'location', 'feature_subtype' => 'dorf', 'is_hidden' => $hidden],
];
// 💣 Der Wegtyp wird GROSS geschrieben: avesmapsNormalizeClientRouteSubtype vergleicht
// zeichengenau, und 'strasse' faellt auf 'Weg' durch -- die Vorlage haette dann eine
// Wegart, die es im Tempospeicher nicht gibt, und der Graph bliebe leer.
$weg = static fn(string $name, array $von, array $bis): array => [
    'type' => 'Feature', 'id' => 'path-' . $name,
    'geometry' => ['type' => 'LineString', 'coordinates' => [$von, $bis]],
    'properties' => ['public_id' => 'path-' . $name, 'name' => $name,
        'feature_type' => 'path', 'feature_subtype' => 'Strasse'],
];

$welt = avesmapsBuildRouteNetworkData(['features' => [
    $ort('A', 5.0, 10.0), $ort('H', 25.0, 10.0, true), $ort('C', 45.0, 10.0),
    $weg('AH', [5.0, 10.0], [25.0, 10.0]),
    $weg('HC', [25.0, 10.0], [45.0, 10.0]),
]]);
$anfrage = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

$gebaut = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage);

// ---- 💣 DER VERSTECKTE ORT BLEIBT IM GRAPHEN, und beide Strassen mit ihm -------------------------
// client-graph.php verwirft jeden Weg, dessen Endpunkt auf keinem Ort liegt. Wer H aus der Ortsliste
// streicht, loescht AH und HC -- aus „ein Ort wird nicht angefahren" wuerde „die Gegend ist nicht
// mehr erreichbar". Das ist der Befund, an dem die ganze Bauform haengt.
assert(isset($gebaut['graph']['H']), 'der versteckte Ort bleibt ein Knoten');
assert($gebaut['graph']['A'] !== [], 'die Strasse A--H existiert weiter');
assert($gebaut['graph']['C'] !== [], 'die Strasse H--C existiert weiter');
assert(isset($gebaut['graph']['A']['H']), 'A und H bleiben verbunden');
assert(isset($gebaut['graph']['H']['C']), 'H und C auch');

// ---- die Kandidatenliste kennt ihn nicht ---------------------------------------------------------
$namen = static function (array $orte): array {
    $liste = [];
    foreach ($orte as $o) {
        $liste[] = (string) ($o['name'] ?? '');
    }
    sort($liste);
    return $liste;
};
assert(isset($gebaut['candidate_locations']), 'der Graphbau gibt seine Kandidatenliste heraus');
assert($namen($gebaut['candidate_locations']) === ['A', 'C'], 'H steht nicht auf der Kandidatenliste');

// ---- ausser er ist das ausdrueckliche Ziel dieser Anfrage ----------------------------------------
// 🔴 Ohne diese Ausnahme fiele ein versteckter Wegpunkt ohne Weganbindung in
// avesmapsConnectClientRouteWaypointsToNearestLandPath aus dem Lookup -- und waere als ZIEL
// unerreichbar. Genau der Fall, den das Merkmal ausdruecklich erhalten soll.
$mitZiel = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage + ['from' => 'A', 'to' => 'H']);
assert($namen($mitZiel['candidate_locations']) === ['A', 'C', 'H'], 'das ausdrueckliche Ziel steht drin');

$ueberVia = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage + ['from' => 'A', 'to' => 'C', 'via' => ['H']]);
assert($namen($ueberVia['candidate_locations']) === ['A', 'C', 'H'], 'auch ein Zwischenziel steht drin');

// ---- die Namensernte selbst ----------------------------------------------------------------------
$wegpunkte = avesmapsCollectRouteRequestWaypointNames(['from' => 'A', 'to' => ' H ', 'via' => ['C', '']]);
assert(isset($wegpunkte['A'], $wegpunkte['H'], $wegpunkte['C']), 'from, to und via zaehlen alle');
assert(count($wegpunkte) === 3, 'und ein leerer Eintrag zaehlt nicht');

echo "versteckte-orte-test: all asserts passed\n";
