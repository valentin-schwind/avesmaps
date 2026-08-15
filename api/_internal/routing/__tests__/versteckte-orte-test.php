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

echo "versteckte-orte-test: all asserts passed\n";
