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
    // 🪤 PRODUKTIONSFORM, und das ist tragend. Die erste Fassung dieses Tests setzte
    // `slug => 'wiki:nordhjaldor'` -- eine Form, die es live NICHT gibt: `political_territory.slug`
    // ist NAMENSabgeleitet (avesmapsPoliticalSlug), der `wiki_key` ist 'wiki:' davor. Und `wiki_name`
    // fehlte ganz, obwohl die Layer-Abfrage `wiki.name AS wiki_name` joint und eine Wiki-Sync-Zeile
    // ihn IMMER traegt. Beides zusammen machte mehrere Zusicherungen zum Vakuum -- eine Mutationsprobe
    // fand einen Riegel `nur wenn wiki_name === ''`, der den Fix fuer genau die GEMELDETE
    // Gebietsklasse abgeschaltet haette und trotzdem gruen blieb (gefunden 12.09.2026).
    return array_merge([
        'geometry_public_id' => 'geo-1',
        'geometry_id' => 1,
        'territory_id' => 4711,
        'territory_public_id' => 'terr-nordhjaldor',
        'slug' => 'nordhjaldor',
        'wiki_key' => 'wiki:nordhjaldor',
        'wiki_name' => 'Nordhjaldor',
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
assert($eigenschaften['wiki_name'] === 'Nordhjaldor', 'C2: wiki_name traegt weiter den Wiki-Namen, nicht den Override');

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
// ⚠️ wiki_name hier ausdruecklich LEER: seit §P ist der Wiki-Name die Vorgabe der Beschriftung und
// wuerde den Gebietsnamen schlagen. Gegenstand von §D ist der Rueckfall auf den GEBIETSNAMEN, also
// muss die Stufe darueber aus dem Weg.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile($veraltet, ['name' => 'Neu-Nordhjaldor', 'wiki_name' => '']),
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
// ⚠️ Eine freie Geometrie traegt ihren Stil unter BEIDEN Schluesseln (territories-geometry.php) --
// der Leser muss beide Seiten fragen, wie der alte Weg auch. Fuer das AGGREGAT gilt das AUSDRUECKLICH
// NICHT: siehe §J.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], [
        'style_json' => null,
        'geometry_style_json' => json_encode($style, JSON_THROW_ON_ERROR),
    ]),
    1049,
    3
)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'H1: auch aus geometry_style_json');

// ---- I. Rueckbau-Waechter, am TOKENIZER gemessen ---------------------------------------------------
// 🪤 Die erste Fassung schnitt den Quelltext mit zwei preg_replace und suchte die Zeichenkette
// "localOverride". Ein Pruefagent hat sie zweifach widerlegt (12.09.2026): sie blieb gruen, waehrend
// der Leser den ALTEN, gefilterten Sucher aufrief (den sie eigentlich verbieten soll), und ein
// Blockkommentar-Entferner, der vor dem Zeilen-Entferner laeuft, schnitt den Ausschnitt an einem
// streunenden "*/" in einem Regex-Literal von 1008 auf 409 Bytes zusammen -- die in AGENTS.md §11
// beschriebene sync-monitor.php-Falle, hier scharf. Deshalb: PHPs Tokenizer, der Kommentare und
// Zeichenketten von Code UNTERSCHEIDET, statt sie wegzuraten.
/** Die Aufrufe (T_STRING vor "(") im Rumpf einer Funktion -- Kommentare und Strings zaehlen nicht. */
function anzeigenameTestAufrufeIn(string $datei, string $funktion): array
{
    $tokens = token_get_all((string) file_get_contents($datei));
    $anzahl = count($tokens);

    $start = null;
    for ($i = 0; $i < $anzahl; $i++) {
        $t = $tokens[$i];
        if (is_array($t) && $t[0] === T_FUNCTION) {
            for ($j = $i + 1; $j < $anzahl; $j++) {
                if (is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                if (is_array($tokens[$j]) && $tokens[$j][0] === T_STRING && $tokens[$j][1] === $funktion) {
                    $start = $j;
                }
                break;
            }
        }
        if ($start !== null) {
            break;
        }
    }
    assert($start !== null, "Funktion {$funktion} nicht gefunden");

    // Bis zur oeffnenden Klammer des RUMPFES, dann Klammern zaehlen.
    $tiefe = 0;
    $imRumpf = false;
    $aufrufe = [];
    for ($i = $start; $i < $anzahl; $i++) {
        $t = $tokens[$i];
        if ($t === '{') {
            $tiefe++;
            $imRumpf = true;
            continue;
        }
        if ($t === '}') {
            $tiefe--;
            if ($imRumpf && $tiefe === 0) {
                break;
            }
            continue;
        }
        if (!$imRumpf || !is_array($t) || $t[0] !== T_STRING) {
            continue;
        }
        for ($j = $i + 1; $j < $anzahl; $j++) {
            if (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                continue;
            }
            if ($tokens[$j] === '(') {
                $aufrufe[] = $t[1];
            }
            break;
        }
    }

    return $aufrufe;
}

$leserDatei = __DIR__ . '/../territories-read.php';
$layerDatei = __DIR__ . '/../territories-layer.php';

// I1: Der neue Leser darf den GEFILTERTEN Sucher nicht aufrufen -- das ist die benannte Gefahr,
// nicht die blosse Zeichenkette "localOverride".
$imLeser = anzeigenameTestAufrufeIn($leserDatei, 'avesmapsPoliticalFindAssignmentDisplayNameForTerritory');
assert($imLeser !== [], 'I1a: der Ausschnitt ist nicht leer (sonst misst der Waechter nichts)');
assert(
    !in_array('avesmapsPoliticalFindAssignmentDisplayForTerritory', $imLeser, true),
    'I1: der Namensleser delegiert NICHT an den localOverride-gefilterten Sucher (sonst ist Fall #123 zurueck)'
);
assert(
    in_array('avesmapsPoliticalReadAssignmentDisplaysFromStyle', $imLeser, true),
    'I2: er liest die Eintraege ueber den geteilten Parser'
);

// I3: Und der Layer muss den neuen Leser ueberhaupt noch RUFEN. Am Tokenizer, nicht per strpos --
// territories-layer.php nennt den Funktionsnamen auch im KOMMENTAR, ein strpos traefe die Erklaerung.
$imLayer = anzeigenameTestAufrufeIn($layerDatei, 'avesmapsPoliticalLayerRowToFeature');
assert(
    in_array('avesmapsPoliticalFindAssignmentDisplayNameForTerritory', $imLayer, true),
    'I3: avesmapsPoliticalLayerRowToFeature ruft den neuen Leser noch auf'
);

// ---- J. Das AGGREGAT liest KEINEN Override -- und ist nicht reihenfolgeabhaengig -----------------
// 💣 Der Regressionsriegel gegen die eigene erste Fassung dieses Fixes (gefunden von einem Pruefagenten,
// 12.09.2026): avesmapsPoliticalBuildAggregateLayerRow nullt style_json und legt die Ablage des KINDES
// nach geometry_style_json, setzt aber territory_public_id/slug des ELTERNTEILS. Eine Geometrie-Ablage
// traegt die GANZE Vorfahrenkette (§G) -- der Rueckfall las damit den Namen des Elternteils aus der
// KOPIE in einem beliebigen Kind, und welches Kind gewinnt, entscheidet das ORDER BY der Abfrage.
// Ein umbenanntes Kind haette den Namen des ELTERNGEBIETS gekippt, auf dem oeffentlichen Pfad.
$elternteil = [
    'territory_id' => 99,
    'territory_public_id' => 'terr-thorwal',
    'slug' => 'wiki:thorwal',
    'name' => 'Thorwal',
];

// Kind A traegt in SEINER Ablage einen Eintrag fuer den ELTERN-Knoten, Kind B nicht.
$kindA = [
    'geometry_public_id' => 'geo-a',
    'geometry_id' => 11,
    'geometry_geojson' => null,
    'geometry_valid_from_bf' => null,
    'geometry_valid_to_bf' => null,
    'updated_at' => '',
    'style_json' => json_encode(['assignmentDisplays' => [[
        'territoryPublicId' => 'terr-thorwal',
        'nodeKey' => 'wiki:thorwal',
        'displayName' => 'Thorwal (aus Kind A)',
    ]]], JSON_THROW_ON_ERROR),
];
$kindB = array_merge($kindA, [
    'geometry_public_id' => 'geo-b',
    'geometry_id' => 12,
    'style_json' => null,
]);

$quelle = ['territory_id' => 5, 'territory_public_id' => 'terr-kind', 'name' => 'Ein Kind'];

$ausA = avesmapsPoliticalLayerRowToFeature(
    avesmapsPoliticalBuildAggregateLayerRow($elternteil, $kindA, $quelle),
    1049,
    3
)['properties'];
$ausB = avesmapsPoliticalLayerRowToFeature(
    avesmapsPoliticalBuildAggregateLayerRow($elternteil, $kindB, $quelle),
    1049,
    3
)['properties'];

assert($ausA['label_name'] === 'Thorwal', 'J1: das Aggregat zeigt den Namen des Elterngebiets, nicht die Kopie aus Kind A');
assert($ausA['label_name'] === $ausB['label_name'], 'J2: das Aggregat-Label haengt NICHT davon ab, welches Kind zuerst kommt');
assert($ausA['display_name'] === 'Thorwal', 'J3: auch display_name bleibt der Elternname');

// ---- L. WAS DEN TREFFER WIRKLICH TRAEGT -- gemessen, nicht angenommen ------------------------------
// 🪤 Der Leser matcht auf territoryPublicId ODER nodeKey. Gemessen (12.09.2026): in Produktion traegt
// NUR territoryPublicId. `political_territory.slug` ist namensabgeleitet ('nordhjaldor'), der
// gespeicherte nodeKey ist `territory.wiki_key` ('wiki:nordhjaldor') -- die zwei koennen nie gleich
// sein. Diese Zusicherung haelt das FEST, damit der naechste Leser den nodeKey-Zweig nicht fuer eine
// funktionierende Absicherung haelt: faellt territoryPublicId weg, ist der Override WEG.
$nurPublicId = ['assignmentDisplays' => [[
    'territoryPublicId' => 'terr-nordhjaldor',
    'nodeKey' => '',
    'displayName' => 'Jarltum Nordhjaldor',
]]];
$p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($nurPublicId), 1049, 3)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'L1: territoryPublicId allein traegt den Treffer');

$nurNodeKey = ['assignmentDisplays' => [[
    'territoryPublicId' => '',
    'nodeKey' => 'wiki:nordhjaldor',
    'displayName' => 'Jarltum Nordhjaldor',
]]];
$p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($nurNodeKey), 1049, 3)['properties'];
assert(
    $p['label_name'] === 'Nordhjaldor',
    'L2: der nodeKey-Zweig trifft in Produktionsform NICHT (slug != wiki_key) -- dokumentierte Luecke, kein Schutz'
);

// ⚠️ Ein Eintrag OHNE beide Kennungen darf keine fremde Zeile greifen.
$ohneKennung = ['assignmentDisplays' => [[
    'territoryPublicId' => '',
    'nodeKey' => '',
    'displayName' => 'Fremder Name',
]]];
$p = avesmapsPoliticalLayerRowToFeature(anzeigenameTestZeile($ohneKennung), 1049, 3)['properties'];
assert($p['label_name'] === 'Nordhjaldor', 'L3: ein Eintrag ohne Kennung greift nichts');

// ---- M. DIE SPALTE AM TERRITORIUM schlaegt die alte Ablage -- und traegt Aggregat UND Huelle -------
// 🔴 Das ist der Umbau, den Fall #123 ausgeloest hat: der Anzeigename gehoert dem TERRITORIUM.
// An einer Geometrie-Ablage war er fuer eine Aussenhuelle (keine Stilspalte) und fuer ein Aggregat
// (Ablage des Kindes) strukturell unerreichbar.
$mitSpalte = anzeigenameTestZeile([], ['display_name' => 'Jarltum Nordhjaldor']);
$p = avesmapsPoliticalLayerRowToFeature($mitSpalte, 1049, 3)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'M1: die Spalte traegt das Label');
assert($p['name'] === 'Nordhjaldor', 'M2: `name` bleibt auch hier die Kennung');

// Die Spalte schlaegt einen abweichenden Alteintrag in style_json.
$alt = ['assignmentDisplays' => [[
    'territoryPublicId' => 'terr-nordhjaldor',
    'nodeKey' => 'wiki:nordhjaldor',
    'displayName' => 'Alter Eintrag',
]]];
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile($alt, ['display_name' => 'Jarltum Nordhjaldor']),
    1049,
    3
)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'M3: die Spalte schlaegt die alte Ablage');

// 💣 Und beim AGGREGAT traegt sie jetzt -- anders als die alte Ablage, die dort reihenfolge-
// abhaengig war (§J). BuildAggregateLayerRow merged die Felder des ANZEIGE-Territoriums herein.
$ausAggregat = avesmapsPoliticalLayerRowToFeature(
    avesmapsPoliticalBuildAggregateLayerRow(
        ['territory_id' => 99, 'territory_public_id' => 'terr-thorwal', 'slug' => 'thorwal',
         'name' => 'Thorwal', 'display_name' => 'Freies Thorwal'],
        ['geometry_public_id' => 'geo-a', 'geometry_id' => 11, 'geometry_geojson' => null,
         'geometry_valid_from_bf' => null, 'geometry_valid_to_bf' => null, 'updated_at' => '',
         'style_json' => null],
        ['territory_id' => 5, 'territory_public_id' => 'terr-kind', 'name' => 'Ein Kind']
    ),
    1049,
    3
)['properties'];
assert($ausAggregat['label_name'] === 'Freies Thorwal', 'M4: das Aggregat traegt die Spalte des Anzeige-Territoriums');
assert($ausAggregat['name'] === 'Thorwal', 'M5: und `name` bleibt kanonisch');

// ⚠️ Der Platzhalter-Riegel gilt auch der Spalte -- die Migration koennte einen aus style_json mitbringen.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], ['display_name' => 'Unabhängig']),
    1049,
    3
)['properties'];
assert($p['label_name'] === 'Nordhjaldor', 'M6: ein Platzhalter in der Spalte wird nicht zum Label');

// ---- N. DER SCHREIBER LOESCHT NICHT, WAS ER NICHT GENANNT BEKOMMT -----------------------------------
// 💣 Die Falle, an der die alte Ablage gestorben ist: `short_name` daneben wird unbedingt aus dem
// Rumpf gesetzt, ein Aufrufer ohne das Feld LOESCHT es. Fuer den Anzeigenamen entscheidet deshalb
// array_key_exists, nicht der Wahrheitswert.
assert(
    avesmapsPoliticalDisplayNameForWrite([], 'Jarltum Nordhjaldor', 'Nordhjaldor') === 'Jarltum Nordhjaldor',
    'N1: ein Rumpf OHNE das Feld laesst den Bestand stehen'
);
assert(
    avesmapsPoliticalDisplayNameForWrite(['display_name' => ''], 'Jarltum Nordhjaldor', 'Nordhjaldor') === null,
    'N2: ein ausdruecklich leeres Feld nimmt den Override zurueck'
);
assert(
    avesmapsPoliticalDisplayNameForWrite(['displayName' => 'Jarltum Nordhjaldor'], null, 'Nordhjaldor') === 'Jarltum Nordhjaldor',
    'N3: camelCase wird ebenso gelesen (der Editor schickt display.displayName)'
);
assert(
    avesmapsPoliticalDisplayNameForWrite(['display_name' => 'Nordhjaldor'], 'Alt', 'Nordhjaldor') === null,
    'N4: gleich dem kanonischen Namen heisst "keine Abweichung"'
);
assert(
    avesmapsPoliticalDisplayNameForWrite(['display_name' => '  Jarltum   Nordhjaldor '], null, 'Nordhjaldor') === 'Jarltum Nordhjaldor',
    'N5: normalisiert wie jeder andere einzeilige Text'
);

// ---- O. DER FALL DES OWNERS: der Wiki-Name IST der Anzeigename -------------------------------------
// 💣 Hieran ist Fall #123 am Ende gescheitert, nachdem der Lesepfad laengst repariert war.
// avesmapsPoliticalBuildStoredAssignmentDisplay leert `displayName`, wenn er "keine Abweichung"
// bedeutet -- und verglich dafuer gegen `wiki_name ?: name`. Fallen die beiden auseinander, verwirft
// das GENAU den Wert, den ein Editor am ehesten eintippt: den Wiki-Namen.
//
// Der echte Fall, am 12.09.2026 mit den Werten aus den Screenshots des Owners nachgefahren:
//   political_territory.name      = "Nordhjaldor"          <- das zeichnet die Karte
//   political_territory_wiki.name = "Jarltum Nordhjaldor"  <- das zeigt der Editor
// Der Owner tippte "Jarltum Nordhjaldor" -> gleich dem wiki_name -> geleert -> NICHTS gespeichert.
// Der Editor zeigte den Namen trotzdem ueberall (er liest den WIKI-Datensatz, keinen Override), die
// Karte blieb bei "Nordhjaldor". Dreimal gespeichert, dreimal "gespeichert" gemeldet, dreimal weg.
$owner = [
    'public_id' => 'terr-nordhjaldor',
    'id' => 763,
    'wiki_key' => 'wiki:jarltum-nordhjaldor',
    'slug' => 'nordhjaldor',
    'wiki_name' => 'Jarltum Nordhjaldor',
    'name' => 'Nordhjaldor',
    'color' => '#88aa66',
    'opacity' => 0.5,
    'valid_to_bf' => 9999,
];

$eintrag = avesmapsPoliticalBuildStoredAssignmentDisplay($owner, ['displayName' => 'Jarltum Nordhjaldor'], 0);
assert(
    $eintrag['displayName'] === 'Jarltum Nordhjaldor',
    'O1: der Wiki-Name wird als Anzeigename GESPEICHERT (er weicht vom Gebietsnamen ab)'
);

$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile(
        ['assignmentDisplays' => [$eintrag]],
        ['name' => 'Nordhjaldor', 'wiki_name' => 'Jarltum Nordhjaldor', 'slug' => 'nordhjaldor']
    ),
    1049,
    4
)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'O2: und steht am Kartenlabel');
assert($p['name'] === 'Nordhjaldor', 'O3: der kanonische Name bleibt, was er ist');

// ⚠️ Die Leer-Regel selbst bleibt: gleich dem GEBIETSNAMEN heisst weiterhin "keine Abweichung".
$gleich = avesmapsPoliticalBuildStoredAssignmentDisplay($owner, ['displayName' => 'Nordhjaldor'], 0);
assert($gleich['displayName'] === '', 'O4: gleich dem Gebietsnamen -> weiterhin geleert');

// 🔴 Und `originalName` bleibt die HERKUNFTSANGABE (wiki_name zuerst) -- nur der Massstab der
// Leer-Entscheidung hat gewechselt, nicht das, was abgelegt wird.
assert($eintrag['originalName'] === 'Jarltum Nordhjaldor', 'O5: originalName unveraendert (wiki_name zuerst)');
assert($gleich['originalName'] === 'Jarltum Nordhjaldor', 'O6: auch im Leer-Fall');

// ⚠️ Ohne wiki_name aendert sich gar nichts -- der haeufige Fall.
$ohneWiki = ['public_id' => 'terr-x', 'id' => 9, 'slug' => 'x', 'name' => 'Kosch', 'valid_to_bf' => 9999];
assert(
    avesmapsPoliticalBuildStoredAssignmentDisplay($ohneWiki, ['displayName' => 'Kosch'], 0)['displayName'] === '',
    'O7: ohne wiki_name bleibt es beim Gebietsnamen als Massstab'
);

// ⚠️ Und ohne GEBIETSNAMEN faellt der Massstab auf die Herkunftsangabe zurueck -- sonst waere er die
// leere Zeichenkette, die niemals gleich ist, und JEDE Eingabe kaeme als "Abweichung" durch. Das
// betrifft Zeilen ohne eigenen Namen (frisch aus dem Wiki angelegt, bevor der Name steht).
$ohneName = ['public_id' => 'terr-y', 'id' => 10, 'slug' => 'y', 'name' => '', 'wiki_name' => 'Wiki-Name', 'valid_to_bf' => 9999];
assert(
    avesmapsPoliticalBuildStoredAssignmentDisplay($ohneName, ['displayName' => 'Wiki-Name'], 0)['displayName'] === '',
    'O8: ohne Gebietsnamen gilt die Herkunftsangabe als Massstab (Rueckfall)'
);
assert(
    avesmapsPoliticalBuildStoredAssignmentDisplay($ohneName, ['displayName' => 'Etwas anderes'], 0)['displayName'] === 'Etwas anderes',
    'O9: und eine echte Abweichung kommt dort trotzdem durch'
);

// ---- P. DIE RANGFOLGE DER BESCHRIFTUNG: Override > WIKI-NAME > Gebietsname ---------------------------
// 🔴 Owner 12.09.2026, woertlich: "Jarltum Nordhjaldor heisst es im Wiki. Also will ich dass es
// Jarltum Nordhjaldor heisst. es sei denn jemand ueberschreibt den Namen."
// Damit ist der WIKI-NAME die Vorgabe der Beschriftung -- ohne dass jemand irgendwo etwas eintippt.

// P1: der Normalfall. KEIN Override, wiki_name gesetzt -> der Wiki-Name steht auf der Karte.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], ['name' => 'Nordhjaldor', 'wiki_name' => 'Jarltum Nordhjaldor']),
    1049,
    4
)['properties'];
assert($p['label_name'] === 'Jarltum Nordhjaldor', 'P1: ohne Override gewinnt der WIKI-Name');
assert($p['display_name'] === 'Jarltum Nordhjaldor', 'P2: und die Infobox zieht mit');
assert($p['name'] === 'Nordhjaldor', 'P3: `name` bleibt der kanonische Gebietsname (Matching-Schluessel)');

// P4: ein ausdruecklicher Anzeigename SCHLAEGT den Wiki-Namen -- "es sei denn jemand ueberschreibt".
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], [
        'name' => 'Nordhjaldor',
        'wiki_name' => 'Jarltum Nordhjaldor',
        'display_name' => 'Das Nordjarltum',
    ]),
    1049,
    4
)['properties'];
assert($p['label_name'] === 'Das Nordjarltum', 'P4: der Override schlaegt den Wiki-Namen');

// P5: auch der Override aus der ALTEN Ablage schlaegt ihn (bis die Migration gelaufen ist).
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile(
        ['assignmentDisplays' => [[
            'territoryPublicId' => 'terr-nordhjaldor',
            'nodeKey' => 'nordhjaldor',
            'displayName' => 'Das Nordjarltum',
        ]]],
        ['name' => 'Nordhjaldor', 'wiki_name' => 'Jarltum Nordhjaldor']
    ),
    1049,
    4
)['properties'];
assert($p['label_name'] === 'Das Nordjarltum', 'P5: auch aus der alten Ablage');

// P6: ohne Wiki-Namen bleibt der Gebietsname -- der Rueckfall.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], ['name' => 'Nordhjaldor', 'wiki_name' => '']),
    1049,
    4
)['properties'];
assert($p['label_name'] === 'Nordhjaldor', 'P6: ohne Wiki-Namen der Gebietsname');

// P7: 💣 Und die ABGELEITETE AUSSENHUELLE traegt ihn ebenso -- sie hat keine Stilablage, aber ihre
// Abfrage joint political_territory_wiki genauso. Ohne das saehe ein Gebiet MIT Huelle (die
// Elterngebiete, ~131 Stueck) weiterhin die Kurzform, und genau die traegt bei Tiefzoom das Label.
$p = avesmapsPoliticalLayerRowToFeature(
    anzeigenameTestZeile([], [
        'style_json' => null,
        'name' => 'Thorwal',
        'wiki_name' => 'Freies Thorwal',
    ]),
    1049,
    2
)['properties'];
assert($p['label_name'] === 'Freies Thorwal', 'P7: auch ohne jede Stilablage (Huellen-Form)');

fwrite(STDOUT, "OK: anzeigename-am-label-test.php -- alle Zusicherungen gehalten.\n");
