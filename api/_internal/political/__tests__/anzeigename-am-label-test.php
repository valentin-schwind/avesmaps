<?php

declare(strict_types=1);

/**
 * Fall #123 ("Territorien aendern Ihre Namen nicht", Owner 12.09.2026, Thorwal > Jarltum Nordhjaldor):
 * der im Editor gespeicherte Anzeigename eines Wiki-Sync-Territoriums wurde gespeichert, erreichte
 * aber das Label der Geometrie im politischen Modus nie.
 *
 * 💣 ES WAREN ZWEI UNABHAENGIGE BRUECHE, und jeder allein repariert GAR NICHTS -- wer nur einen
 * findet, haelt den Fall fuer erledigt und die Karte zeigt weiter den alten Namen:
 *   (1) avesmapsPoliticalFindAssignmentDisplayForTerritory filtert auf `localOverride`. Diesen
 *       Schluessel schreibt im ganzen Repo NIEMAND (12.09.2026 nachgezaehlt: die einzigen Stellen,
 *       die ihn setzen, sind der Parser, der ihn zurueckgibt, und die Diagnoseausgabe). Der Sucher
 *       lieferte damit ausnahmslos null.
 *   (2) Dahinter gewann in avesmapsPoliticalLayerRowToFeature der Gebietsname ausnahmslos --
 *       ein Wiki-Sync-Territorium hat IMMER einen, der Override griff also nur bei einer
 *       namenlosen "Freien Geometrie".
 *
 * 🔴 Gefahr, die den naheliegenden Fix verbot: den Filter aus (1) einfach zu entfernen haette mit dem
 * Namen STILL auch Farbe und Deckkraft umgestellt -- der Rueckgabewert jenes Suchers speist
 * avesmapsPoliticalResolveLayerDisplayColor (erster Farbkandidat) und $displayOpacity. Deshalb ein
 * eigener Leser nur fuer den Namen; §E misst, dass die Farbe wirklich unberuehrt bleibt.
 *
 * 🔴 Und der Override geht auf die BESCHRIFTUNG, nie auf `name`: `name` ist MATCHING-Schluessel in
 * avesmapsPoliticalFindInnerBoundaryFeaturesInLayer, die daran entscheidet, welche Innengrenzen
 * verborgen werden (§C).
 *
 * Keine DB, kein HTTP. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *     api/_internal/political/__tests__/anzeigename-am-label-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../media-license.php';
require_once __DIR__ . '/../../coat-url.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-write.php';
require_once __DIR__ . '/../territories-layer.php';

/** Das Wiki-Sync-Territorium aus der Meldung. */
function anzeigenameTestTerritorium(): array
{
    return [
        'public_id' => 'terr-nordhjaldor',
        'id' => 4711,
        'wiki_key' => 'wiki:nordhjaldor',
        'slug' => 'wiki:nordhjaldor',
        'wiki_name' => 'Nordhjaldor',
        'name' => 'Nordhjaldor',
        'color' => '#884422',
        'opacity' => 0.5,
        'valid_to_bf' => 9999,
    ];
}

/** Die Geometriezeile, wie der Layer sie liest. */
function anzeigenameTestZeile(array $style, array $ueberschreibungen = []): array
{
    return array_merge([
        'geometry_public_id' => 'geo-1',
        'geometry_id' => 1,
        'territory_id' => 4711,
        'territory_public_id' => 'terr-nordhjaldor',
        'slug' => 'wiki:nordhjaldor',
        'name' => 'Nordhjaldor',
        'style_json' => json_encode($style, JSON_THROW_ON_ERROR),
    ], $ueberschreibungen);
}

/** Der ECHTE Schreibweg: was der Editor beim Speichern ablegt. */
function anzeigenameTestGespeichert(array $rumpf): array
{
    return avesmapsPoliticalBuildStoredAssignmentDisplay(anzeigenameTestTerritorium(), $rumpf, 0);
}

// ---- A. Der gemeldete Fall, END-ZU-END durch den ECHTEN Schreiber ------------------------------------
// ⚠️ Bewusst NICHT mit einem von Hand gebauten style_json: genau die Luecke zwischen dem, was der
// Schreiber ablegt, und dem, was der Leser verlangt, WAR der Fehler. Eine Attrappe haette ihn versteckt.
$gespeichert = anzeigenameTestGespeichert(['displayName' => 'Jarltum Nordhjaldor']);
assert(
    $gespeichert['displayName'] === 'Jarltum Nordhjaldor',
    'A1: der Schreiber legt den abweichenden Anzeigenamen ab'
);

$style = ['assignmentDisplays' => [$gespeichert]];
$eigenschaften = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($style), 1049, 3)['properties'];

// Das JS zeichnet `label_name || name` (map-features-boundary-canvas-overlay.js).
assert(
    ($eigenschaften['label_name'] ?: $eigenschaften['name']) === 'Jarltum Nordhjaldor',
    'A2: das Kartenlabel zeigt den gespeicherten Anzeigenamen'
);
assert($eigenschaften['label_display_name'] === 'Jarltum Nordhjaldor', 'A3: label_display_name zieht mit');
// getRegionFeatureName im Client liest display_name ZUERST -- ohne das saehe die Infobox den alten Namen.
assert($eigenschaften['display_name'] === 'Jarltum Nordhjaldor', 'A4: display_name zieht mit (Infobox)');

// ---- B. Ohne Override aendert sich NICHTS ------------------------------------------------------------
// ⚠️ Der Schreiber leert displayName, sobald er dem Originalnamen gleicht -- der haeufige Fall.
$gleich = anzeigenameTestGespeichert(['displayName' => 'Nordhjaldor']);
assert($gleich['displayName'] === '', 'B1: gleicher Name wird als "keine Abweichung" abgelegt');

foreach ([
    'ohne assignmentDisplays' => [],
    'mit leerem displayName' => ['assignmentDisplays' => [$gleich]],
] as $fall => $ohneOverride) {
    $p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($ohneOverride), 1049, 3)['properties'];
    assert($p['label_name'] === 'Nordhjaldor', "B2 ({$fall}): das Label bleibt der Gebietsname");
    assert($p['display_name'] === 'Nordhjaldor', "B3 ({$fall}): display_name bleibt der Gebietsname");
}

// ---- C. `name` ist die KENNUNG und wandert NIE ------------------------------------------------------
// 💣 avesmapsPoliticalFindInnerBoundaryFeaturesInLayer haelt properties.name gegen die
// Zugehoerigkeits-Prosa der Basisflaechen und entscheidet daran, WELCHE INNENGRENZEN VERBORGEN werden.
// Ein umbenanntes `name` verschoebe also still das Grenzbild der Karte -- eine Aenderung, die niemand
// bestellt hat und die man am Label nicht sieht.
assert($eigenschaften['name'] === 'Nordhjaldor', 'C1: name bleibt der kanonische Gebietsname');
assert($eigenschaften['wiki_name'] === '' || $eigenschaften['wiki_name'] === 'Nordhjaldor', 'C2: wiki_name unberuehrt');

// ---- D. Nur `displayName` gewinnt, nie `originalName` ------------------------------------------------
// 🔴 originalName ist der Stand VOR der Umbenennung. Liesse man ihn gewinnen, naegelte ein alter
// Eintrag nach einer Wiki-Umbenennung den VERALTETEN Namen aufs Label -- derselbe Fehler noch einmal,
// nur andersherum. Hier: das Gebiet heisst inzwischen "Neu-Nordhjaldor", der Eintrag kennt nur den alten.
$veraltet = ['assignmentDisplays' => [[
    'territoryPublicId' => 'terr-nordhjaldor',
    'nodeKey' => 'wiki:nordhjaldor',
    'originalName' => 'Nordhjaldor',
    'displayName' => '',
]]];
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile($veraltet, ['name' => 'Neu-Nordhjaldor']),
    1049,
    3
)['properties'];
assert($p['label_name'] === 'Neu-Nordhjaldor', 'D1: ein alter originalName nagelt den Namen NICHT fest');

// ---- E. Farbe und Deckkraft bleiben unberuehrt -------------------------------------------------------
// 💣 Der Regressionsriegel gegen den verworfenen Fix: haette man stattdessen `localOverride` gesetzt
// bzw. den Filter entfernt, waere $assignmentDisplay nicht mehr null -- und dessen `color`/`opacity`
// haetten ab sofort die Farbe JEDES umbenannten Gebiets bestimmt (erster Kandidat in
// avesmapsPoliticalResolveLayerDisplayColor). Sichtbar, still, und nicht Gegenstand der Meldung.
$mitFarbe = anzeigenameTestGespeichert([
    'displayName' => 'Jarltum Nordhjaldor',
    'color' => '#ff0000',
    'opacity' => 0.9,
]);
assert($mitFarbe['color'] === '#ff0000', 'E1: der Schreiber traegt die Farbe des Eintrags');

$ohne = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile(['fill' => '#123456', 'fillOpacity' => 0.25]),
    1049,
    3
)['properties'];
$mit = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile(['fill' => '#123456', 'fillOpacity' => 0.25, 'assignmentDisplays' => [$mitFarbe]]),
    1049,
    3
)['properties'];

assert($mit['label_name'] === 'Jarltum Nordhjaldor', 'E2: der Name kommt trotzdem an');
assert($mit['fill'] === $ohne['fill'], 'E3: der Override aendert die Fuellfarbe NICHT (' . $mit['fill'] . ')');
assert($mit['stroke'] === $ohne['stroke'], 'E4: der Override aendert die Randfarbe NICHT');
assert($mit['fillOpacity'] === $ohne['fillOpacity'], 'E5: der Override aendert die Deckkraft NICHT');

// ---- F. Generische Wurzelnamen werden nie zum Label --------------------------------------------------
// ⚠️ "Unabhaengig"/"Umstritten"/"Ungeklaert" sind Hierarchie-Platzhalter, keine Gebietsnamen -- dieselbe
// Regel, die avesmapsPoliticalResolveAssignmentDisplayName schon fuer den alten Weg trug.
// 🪤 Die Werte sind an avesmapsPoliticalIsGenericHierarchyRootName GEMESSEN, nicht geraten: ihre Muster
// verlangen eine Wortgrenze direkt hinter dem Stamm ("/^umstritten\b/"). "Umstrittene Gebiete" faellt
// deshalb NICHT darunter und ist ein echter Name -- der erste Entwurf dieses Tests hat genau das
// angenommen und war zu Recht rot.
foreach (['Unabhängig', 'Umstritten', 'Ungeklärt', 'Unabhängig (Thorwal)'] as $platzhalter) {
    $s = ['assignmentDisplays' => [[
        'territoryPublicId' => 'terr-nordhjaldor',
        'nodeKey' => 'wiki:nordhjaldor',
        'displayName' => $platzhalter,
    ]]];
    $p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($s), 1049, 3)['properties'];
    assert($p['label_name'] === 'Nordhjaldor', "F1 ({$platzhalter}): Platzhalter wird nicht zum Label");
}

// ⚠️ Gegenprobe, damit F1 kein Vakuum ist: ein echter Name muss weiterhin durchkommen.
$s = ['assignmentDisplays' => [[
    'territoryPublicId' => 'terr-nordhjaldor',
    'nodeKey' => 'wiki:nordhjaldor',
    'displayName' => 'Umstrittene Gebiete',
]]];
$p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($s), 1049, 3)['properties'];
assert($p['label_name'] === 'Umstrittene Gebiete', 'F2: ein echter Name kommt durch (F1 ist kein Vakuum)');

// ---- G. Ein Eintrag fuer einen ANDEREN Knoten faerbt nicht ab ----------------------------------------
// ⚠️ style_json traegt die GANZE Kette (Thorwal > Jarltum Nordhjaldor) -- je Knoten einen Eintrag.
// Gegriffen werden darf nur der eigene.
$kette = ['assignmentDisplays' => [
    ['territoryPublicId' => 'terr-thorwal', 'nodeKey' => 'wiki:thorwal', 'displayName' => 'Freies Thorwal'],
    ['territoryPublicId' => 'terr-nordhjaldor', 'nodeKey' => 'wiki:nordhjaldor', 'displayName' => 'Jarltum Nordhjaldor'],
]];
$p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($kette), 1049, 3)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'G1: der eigene Knoten der Kette gewinnt');

// ---- H. Der Eintrag darf auch im geometry_style_json liegen ------------------------------------------
// ⚠️ Beim Aggregat nullt avesmapsPoliticalBuildAggregateLayerRow style_json und legt den Stil der
// Geometrie nach geometry_style_json -- der Leser muss beide Seiten fragen, wie der alte Weg auch.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], [
        'style_json' => null,
        'geometry_style_json' => json_encode($style, JSON_THROW_ON_ERROR),
    ]),
    1049,
    3
)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'H1: auch aus geometry_style_json');

// ---- I. Rueckbau-Waechter ---------------------------------------------------------------------------
// 🔴 Der Leser darf NICHT wieder auf avesmapsPoliticalFindAssignmentDisplayForTerritory umgestellt
// werden -- jene filtert auf einen Schluessel ohne Schreiber, und der Fall waere sofort zurueck.
$leserQuelle = (string) file_get_contents(__DIR__ . '/../territories-read.php');
$leserQuelle = (string) preg_replace('!/\*.*?\*/!su', '', $leserQuelle);
$leserQuelle = (string) preg_replace('!^\s*//.*$!m', '', $leserQuelle);
assert(
    strpos($leserQuelle, 'function avesmapsPoliticalFindAssignmentDisplayNameForTerritory') !== false,
    'I1: der eigene Namensleser existiert noch'
);
// Der Namensleser selbst darf nicht auf localOverride filtern.
$ab = (int) strpos($leserQuelle, 'function avesmapsPoliticalFindAssignmentDisplayNameForTerritory');
$rumpf = substr($leserQuelle, $ab);
$ende = strpos($rumpf, "\n}\n");
$rumpf = $ende === false ? $rumpf : substr($rumpf, 0, $ende);
assert(
    strpos($rumpf, 'localOverride') === false && strpos($rumpf, 'local_override') === false,
    'I3: der Namensleser filtert NICHT auf localOverride (sonst ist Fall #123 zurueck)'
);

fwrite(STDOUT, "OK: anzeigename-am-label-test.php -- alle Zusicherungen gehalten.\n");
