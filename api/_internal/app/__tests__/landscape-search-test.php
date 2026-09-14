<?php

declare(strict_types=1);

/**
 * Landschaften in der Suche -- der reine Kern (api/_internal/app/landscape-search.php).
 * Entwurf: docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md
 *
 * Geprueft wird hier, WAS eine Landschaft zum Suchtreffer macht: der Riegel gegen maschinelle
 * Namen, die Bindung an die EIGENEN Beschriftungen und die Gruppierung. Ob die Quelle bis in die
 * Antwort des Endpunkts kommt, prueft api/app/__tests__/map-search-verdrahtung-test.php.
 */

require_once __DIR__ . '/../../text/ascii-fold.php';
require_once __DIR__ . '/../landscape-search.php';

$wurzel = dirname(__DIR__, 4);

// ---------------------------------------------------------------------------
// A. Der Riegel gegen die GEMEINSAME Fallliste. Der Zwilling im Browser faehrt dieselbe Datei
//    (js/map-features/__tests__/landschaft-autonamen-zwilling.test.js).
// ---------------------------------------------------------------------------

$fixture = json_decode(
    (string) file_get_contents(__DIR__ . '/fixtures/landschaft-autonamen.json'),
    true,
    512,
    JSON_THROW_ON_ERROR
);
$faelle = $fixture['faelle'];
assert(count($faelle) >= 10, 'die Fallliste ist leer oder nicht gelesen');

$arten = array_values(array_unique(array_filter(array_map(
    static fn(array $fall): string => (string) $fall['art'],
    $faelle
))));
$muster = avesmapsLandscapeSearchAutoNamePattern($arten);

foreach ($faelle as $fall) {
    $ist = avesmapsLandscapeSearchNameIsMachineGiven((string) $fall['name'], null, $muster);
    assert(
        $ist === $fall['suche_verborgen'],
        'Fall "' . $fall['name'] . '" (Art "' . $fall['art'] . '"): erwartet '
        . var_export($fall['suche_verborgen'], true) . ', bekommen ' . var_export($ist, true)
    );
    // 🔴 Server ⊇ Browser: was der Browser fuer automatisch haelt, darf nie in der Suche stehen.
    if ($fall['browser_auto'] === true) {
        assert($ist === true, 'Server ⊇ Browser verletzt bei "' . $fall['name'] . '"');
    }
}

// 💣 Der Rueckfall-Griff steht in ZWEI Sprachen. Weicht er ab, vergibt der Browser „Fläche-101“ und
// die Suche haelt es fuer einen Ortsnamen.
$js = (string) file_get_contents($wurzel . '/js/map-features/map-features-ecosystem-naming.js');
assert(
    preg_match('/const ECOSYSTEM_AUTO_NAME_FALLBACK = "([^"]*)";/u', $js, $treffer) === 1,
    'die Konstante des Browsers ist nicht mehr lesbar -- umbenannt?'
);
assert(
    $treffer[1] === AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK,
    'Rueckfall-Griff Browser "' . $treffer[1] . '" gegen Server "' . AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK . '"'
);

// ---------------------------------------------------------------------------
// B. Der Merker. Die Suche fragt STRENGER als der Haken (Entwurf §5).
// ---------------------------------------------------------------------------

assert(avesmapsLandscapeSearchNameIsMachineGiven('Farindel', true, $muster) === true,
    'ausdruecklich automatisch ist verborgen, auch mit menschlich klingendem Namen');
assert(avesmapsLandscapeSearchNameIsMachineGiven('Wald-001', false, $muster) === true,
    '💣 in der Suche schlaegt der NAME ein abgenommenes Haekchen -- „Wald-001“ sucht niemand');
assert(avesmapsLandscapeSearchNameIsMachineGiven('Farindel', false, $muster) === false,
    'ausdruecklich von Hand und ein echter Name: sichtbar');
assert(avesmapsLandscapeSearchNameIsMachineGiven('', null, $muster) === true, 'leer ist kein Name');
assert(avesmapsLandscapeSearchNameIsMachineGiven('   ', null, $muster) === true, 'Leerzeichen sind kein Name');

// Eine Artbezeichnung mit Sonderzeichen darf das Muster nicht aufbrechen.
$sonder = avesmapsLandscapeSearchAutoNamePattern(['Flussland/Flusstal', 'Wald (licht)']);
assert(avesmapsLandscapeSearchNameIsMachineGiven('Flussland/Flusstal-003', null, $sonder) === true);
assert(avesmapsLandscapeSearchNameIsMachineGiven('Wald (licht)-004', null, $sonder) === true);
assert(avesmapsLandscapeSearchNameIsMachineGiven('Waldxlicht)-004', null, $sonder) === false,
    '💣 eine ungeschuetzte Klammer im Muster waere still falsch');

// ---------------------------------------------------------------------------
// C. Die Artbezeichnung -- EINE Regel mit dem Tooltip der Flaeche.
// ---------------------------------------------------------------------------

$typeLabels = ['vegetation|wald' => 'Wald', 'topographie|insel' => 'Insel'];
assert(avesmapsEcosystemRegionTypeLabel($typeLabels, 'vegetation', 'wald') === 'Wald');
assert(avesmapsEcosystemRegionTypeLabel($typeLabels, 'vegetation', 'moor') === 'moor',
    'ohne Katalogzeile faellt die Art auf ihren Schluessel zurueck, nicht auf nichts');
assert(avesmapsEcosystemRegionTypeLabel($typeLabels, 'topographie', 'wald') === 'wald',
    'ein type_key ist nur je Ebene eindeutig');
assert(avesmapsEcosystemRegionTypeLabel($typeLabels, 'vegetation', null) === '', 'ohne Art keine Bezeichnung');
assert(avesmapsEcosystemRegionTypeLabel($typeLabels, 'vegetation', '  ') === '', 'Leerzeichen sind keine Art');

// ---------------------------------------------------------------------------
// D. EIGENE Beschriftungen -- nach IDENTITAET, nie nach Namen (Owner 14.09.2026).
// ---------------------------------------------------------------------------

$labelName = static fn(array $row, array $properties): string => (string) ($properties['text'] ?? $row['name'] ?? '');
$mapRows = [
    // Der Zeiger steht an der Beschriftung.
    ['public_id' => 'l-tann', 'feature_type' => 'label', 'name' => 'Tannwald',
        'properties_json' => '{"text":"Tannwald","ecosystem_region_public_id":"r-tann"}'],
    // Der Zeiger steht an der Region (label_public_id).
    ['public_id' => 'l-blent', 'feature_type' => 'label', 'name' => 'Blentforst',
        'properties_json' => '{"text":"Blentforst"}'],
    // Ein FREIES Label gleichen Namens -- ein Vulkan an anderer Stelle. Es gehoert Ceälan NICHT.
    ['public_id' => 'l-vulkan', 'feature_type' => 'label', 'name' => 'Ceälan',
        'properties_json' => '{"text":"Ceälan"}'],
    // Ein Ort, der zufaellig eine Regionskennung im JSON traegt, ist keine Beschriftung.
    ['public_id' => 'o-tann', 'feature_type' => 'location', 'name' => 'Tannwald',
        'properties_json' => '{"ecosystem_region_public_id":"r-mistel"}'],
];
$regionRowsFuerBindung = [
    ['public_id' => 'r-tann', 'label_public_id' => null],
    ['public_id' => 'r-blent', 'label_public_id' => 'l-blent'],
    // 💣 Ein toter Zeiger: das Label gibt es nicht mehr. Er darf nicht als Beschriftung zaehlen.
    ['public_id' => 'r-cealan', 'label_public_id' => 'l-geloescht'],
    ['public_id' => 'r-mistel', 'label_public_id' => null],
];
$eigene = avesmapsLandscapeSearchOwnLabelNames($mapRows, $regionRowsFuerBindung, $labelName);
assert(isset($eigene['r-tann']['tannwald']), 'der Zeiger an der Beschriftung bindet');
assert(isset($eigene['r-blent']['blentforst']), 'der Zeiger an der Region bindet');
assert(!isset($eigene['r-cealan']), '💣 ein toter Zeiger und ein fremdes gleichnamiges Label sind KEINE eigene Beschriftung');
assert(!isset($eigene['r-mistel']), 'ein Ort ist keine Beschriftung');

// ---------------------------------------------------------------------------
// E. Die Eintraege: Riegel, Ebene, Bindung, Gruppierung.
// ---------------------------------------------------------------------------

$region = static fn(string $id, string $name, string $kind, ?string $type, array $bbox, array $extra = []): array => $extra + [
    'public_id' => $id,
    'name' => $name,
    'kind' => $kind,
    'region_type' => $type,
    'label_public_id' => null,
    'properties_json' => null,
    // DECIMAL kommt aus PDO als Zeichenkette.
    'min_x' => $bbox[0] === null ? null : (string) $bbox[0],
    'min_y' => $bbox[1] === null ? null : (string) $bbox[1],
    'max_x' => $bbox[2] === null ? null : (string) $bbox[2],
    'max_y' => $bbox[3] === null ? null : (string) $bbox[3],
];
$regionRows = [
    $region('r-tann', 'Tannwald', 'vegetation', 'wald', [10, 10, 20, 20]),
    $region('r-mistel', 'Mistelwald', 'vegetation', 'wald', [30.5, 40, 35, 45]),
    $region('r-perlen-1', 'Archipel der Perlen', 'topographie', 'insel', [1, 1, 2, 2]),
    $region('r-perlen-2', 'Archipel der Perlen', 'topographie', 'insel', [5, 0, 6, 3]),
    $region('r-oede-t', 'Große Öde', 'topographie', 'tiefebene', [50, 50, 60, 60]),
    $region('r-oede-v', 'Große Öde', 'vegetation', 'steppe', [50, 50, 60, 60]),
    $region('r-cealan', 'Ceälan', 'topographie', 'insel', [70, 70, 71, 71], ['label_public_id' => 'l-geloescht']),
    $region('r-blent', 'Blentforst', 'vegetation', 'wald', [80, 80, 81, 81], ['label_public_id' => 'l-blent']),
    $region('r-finster', 'Finsterkamm', 'derographisch', null, [90, 90, 99, 99]),
    $region('r-auto', 'Wald-001', 'vegetation', 'wald', [1, 1, 2, 2]),
    $region('r-flaeche', 'Fläche-048', 'vegetation', 'urwald', [1, 1, 2, 2]),
    // Die Art „Sumpf" ist im Katalog stillgelegt -- ihr alter Griff bleibt trotzdem ein Griff.
    $region('r-sumpf', 'Sumpf-003', 'vegetation', 'moor', [1, 1, 2, 2]),
    $region('r-klima', 'Polare Zone', 'klima', 'polar', [0, 900, 1024, 1024]),
    $region('r-ohne-flaeche', 'Leerwald', 'vegetation', 'wald', [null, null, null, null]),
    $region('r-merker', 'Farindel', 'vegetation', 'wald', [1, 1, 2, 2], ['properties_json' => '{"auto_name": true}']),
];
$aktiveArten = [
    'vegetation|wald' => 'Wald',
    'vegetation|urwald' => 'Urwald',
    'vegetation|steppe' => 'Steppe',
    'topographie|insel' => 'Insel',
    'topographie|tiefebene' => 'Tiefebene',
    'klima|polar' => 'Polare Zone',
];
$griffe = array_merge(array_values($aktiveArten), ['Sumpf']);
$eintraege = avesmapsBuildLandscapeSearchEntries(
    $regionRows,
    $aktiveArten,
    $griffe,
    avesmapsLandscapeSearchOwnLabelNames($mapRows, $regionRows, $labelName)
);

$namen = array_map(static fn(array $e): string => $e['name'], $eintraege);
sort($namen);
assert(
    $namen === ['Archipel der Perlen', 'Ceälan', 'Finsterkamm', 'Große Öde', 'Große Öde', 'Mistelwald'],
    'falsche Treffermenge: ' . json_encode($namen, JSON_UNESCAPED_UNICODE)
);

$nachName = [];
foreach ($eintraege as $eintrag) {
    $nachName[$eintrag['name'] . '|' . $eintrag['ecosystem_kind']] = $eintrag;
}

$mistel = $nachName['Mistelwald|vegetation'];
assert($mistel['kind'] === 'landscape');
assert($mistel['public_id'] === 'r-mistel');
assert($mistel['public_ids'] === ['r-mistel']);
assert($mistel['type_label'] === 'Wald');
assert($mistel['feature_subtype'] === 'wald');
assert($mistel['min_x'] === 30.5 && $mistel['max_y'] === 45.0, 'die bbox reist als Zahl');
assert(in_array('Mistelwald', $mistel['search_texts'], true) && in_array('Wald', $mistel['search_texts'], true));

// 🔴 Mehrere Regionen gleichen Namens, gleicher Ebene und gleicher Art: EIN Treffer, die Huellbox ALLER.
$perlen = $nachName['Archipel der Perlen|topographie'];
assert($perlen['public_ids'] === ['r-perlen-1', 'r-perlen-2'], 'beide Regionen im selben Treffer');
assert([$perlen['min_x'], $perlen['min_y'], $perlen['max_x'], $perlen['max_y']] === [1.0, 0.0, 6.0, 3.0],
    'die Huellbox umschliesst alle Flaechen: ' . json_encode($perlen));

// Gleicher Name, andere Ebene: zwei Treffer.
assert(isset($nachName['Große Öde|topographie'], $nachName['Große Öde|vegetation']));

// Ohne Art: keine Bezeichnung -- die Zeile ergaenzt der Browser um die Ebene.
assert($nachName['Finsterkamm|derographisch']['type_label'] === '');
assert($nachName['Finsterkamm|derographisch']['feature_subtype'] === '');

// Interne Felder bleiben drinnen.
foreach ($eintraege as $eintrag) {
    assert(!array_key_exists('group_key', $eintrag), 'kein Gruppenschluessel in der Antwort');
    assert(!array_key_exists('properties_json', $eintrag), 'kein Rohfeld in der Antwort');
}

echo "landscape-search-test: OK\n";
