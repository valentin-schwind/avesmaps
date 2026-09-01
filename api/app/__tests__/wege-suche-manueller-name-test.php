<?php

declare(strict_types=1);

/**
 * Der Riegel der Kartensuche vor den Wegen -- am ECHTEN Endpunktcode.
 * =========================================================================
 * Owner-Meldung 01.09.2026: „der goblinpfad ist ein manuell angelegter weg mit namen der aber
 * nicht in der suche auftaucht, waer super wenn das ginge (auch fuer alle anderen manuell
 * umbenannte objekte auf der karte)."
 *
 * Der Riegel hiess bis dahin „NUR wiki-verlinkte Wege sind suchbar" (Betreiber-Entscheid
 * 2026-07-05). Sein Zweck waren die Generik-Namen -- „Reichsstrasse-4903" gehoerte nie in die
 * Trefferliste. Der Wiki-Link war dafuer aber das falsche Mass: er warf jeden von Hand
 * angelegten Weg gleich mit hinaus. Jetzt entscheidet der NAME, und dieser Test haelt beide
 * Haelften fest -- die neue Oeffnung UND den alten Grund.
 *
 * 💣 Geprueft wird der ECHTE Endpunkt, nicht eine Abschrift: die Funktionsdefinitionen werden aus
 * der Datei geschnitten und ausgefuehrt, ohne den Anfrage-Teil zu beruehren (dasselbe Verfahren
 * und dieselben zwei Marker wie in map-search-verdrahtung-test.php nebenan -- ein `require` wuerde
 * eine Anfrage ausfuehren).
 *
 * Lauf (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/app/__tests__/wege-suche-manueller-name-test.php
 */

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
require_once __DIR__ . '/../../_internal/wiki/path-naming.php';

$endpunkt = __DIR__ . '/../map-search.php';
$quelle = (string) file_get_contents($endpunkt);

$anfrageBeginn = strpos($quelle, "\ntry {");
$funktionenBeginn = strpos($quelle, 'function avesmapsReadMapSearchQuery');
assert($anfrageBeginn !== false, 'Marker "try {" nicht gefunden -- Endpunkt umgebaut?');
assert($funktionenBeginn !== false, 'Marker der ersten Funktion nicht gefunden -- Endpunkt umgebaut?');

// Kopf mitnehmen: dort stehen die Deckel der Abschnittsquellen, die
// avesmapsBuildMapSearchResults liest. requires und declare raus -- oben schon geladen, und
// __DIR__ zeigte hier woandershin.
$kopf = (string) preg_replace(
    '/^\s*(<\?php|declare\(strict_types=1\);|require(_once)?\s.*?;)\s*$/m',
    '',
    substr($quelle, 0, $anfrageBeginn)
);

// ⚠️ eval() ist hier begruendet und traegt keine Eingabe von aussen -- die einzige Quelle ist eine
// feste Datei DIESES Repos, gelesen ueber __DIR__. Ausfuehrliche Begruendung im Nachbartest.
eval($kopf . "\n" . substr($quelle, $funktionenBeginn));

/** Eine Wegzeile, wie map_features sie liefert. */
function wegZeile(array $properties, string $subtype = 'Pfad'): array {
    return [
        'public_id' => 'weg-1',
        'feature_type' => 'path',
        'feature_subtype' => $subtype,
        'name' => (string) ($properties['name'] ?? ''),
        'geometry_type' => 'LineString',
        'properties_json' => json_encode($properties, JSON_UNESCAPED_UNICODE),
        'min_x' => 100.0,
        'min_y' => 200.0,
        'max_x' => 110.0,
        'max_y' => 210.0,
    ];
}

// ---- 1. DER ANLASS: ein von Hand angelegter Weg ohne Wiki-Artikel -------------------------------
$goblinpfad = avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Goblinpfad',
    'display_name' => 'Goblinpfad',
    'feature_type' => 'path',
    'feature_subtype' => 'Pfad',
]));
assert($goblinpfad !== null, 'Der Goblinpfad faellt weiterhin aus der Suche -- genau die Meldung');
assert($goblinpfad['kind'] === 'path');
assert($goblinpfad['name'] === 'Goblinpfad', 'Angezeigt wird der eigene Name: ' . var_export($goblinpfad['name'] ?? null, true));
// Der Name muss auch WIRKLICH suchbar sein, nicht nur im Ergebnis stehen.
assert(avesmapsCalculateSearchScore($goblinpfad, avesmapsNormalizeSearchText('goblinpfad')) !== null);
assert(avesmapsCalculateSearchScore($goblinpfad, avesmapsNormalizeSearchText('goblin')) !== null);

// ---- 2. DER ALTE GRUND BLEIBT: maschinelle Namen bleiben draussen -------------------------------
// 💣 Faellt diese Haelfte, fuellt ein einziges Allerweltswort die Trefferliste: 2448 der 3721
// wiki-losen Wege heissen `<Wegart>-<n>` (gemessen 2026-07-20).
foreach (['Reichsstrasse-4903', 'Weg-17', 'Gebirgspass-42', 'Meer-835', 'Pfad'] as $muell) {
    $eintrag = avesmapsBuildSearchEntry(wegZeile([
        'name' => $muell,
        'display_name' => $muell,
        'feature_type' => 'path',
        'feature_subtype' => 'Pfad',
    ]));
    assert($eintrag === null, 'maschineller Name in der Suche gelandet: ' . $muell);
}

// ---- 2b. Gemessen wird gegen die EIGENE Wegart, nicht gegen alle acht ---------------------------
// 🪤 Ein Pfad namens „Weg" ist ein Name -- die Karte zeichnet ihn (shouldShowRoutePathDisplayName
// misst ebenfalls nur gegen die Wegart DIESES Wegs). Mit der vollen Liste faellt er hier heraus,
// waehrend der Browser ihn indiziert; der Unterschied ist still und war beim Bauen schon einmal da.
$pfadNamensWeg = avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Weg', 'display_name' => 'Weg', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
], 'Pfad'));
assert($pfadNamensWeg !== null, 'ein Pfad namens „Weg" traegt einen Namen -- die Karte zeichnet ihn');
// ...ein WEG namens „Weg" dagegen nicht.
assert(avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Weg', 'display_name' => 'Weg', 'feature_type' => 'path', 'feature_subtype' => 'Weg',
], 'Weg')) === null, 'der nackte Wegtyp auf seiner eigenen Wegart ist kein Name');

// ---- 3. Ein Weg ohne jeden eigenen Namen bleibt draussen ----------------------------------------
assert(avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Weg-3',
    'feature_type' => 'path',
    'feature_subtype' => 'Weg',
], 'Weg')) === null, 'ein Weg ohne display_name/original_name hat keinen lesbaren Namen');

// ---- 4. Der Wiki-Weg bleibt unveraendert vorn ---------------------------------------------------
// R1: die Zuweisung benennt den Weg, auch wenn das Segment noch einen Alt-Namen traegt. Diese
// Zusicherung ist AELTER als die Oeffnung und darf von ihr nicht angefasst worden sein.
$wikiWeg = avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Reichsstrasse-16',
    'display_name' => 'Reichsstrasse-16',
    'feature_type' => 'path',
    'feature_subtype' => 'Reichsstrasse',
    'wiki_path' => ['name' => 'Reichsstraße 2', 'wiki_key' => 'wiki:reichsstrasse-2'],
], 'Reichsstrasse'));
assert($wikiWeg !== null, 'ein wiki-zugewiesener Weg muss suchbar bleiben');
assert($wikiWeg['name'] === 'Reichsstraße 2', 'der Wiki-Name schlaegt den Alt-Namen des Segments');

// ---- 5. Gruppiert wird ueber Name + Wegart, nicht ueber das Segment -----------------------------
// Zwei Abschnitte desselben Wegs muessen EINEN Treffer ergeben -- sonst steht der Goblinpfad
// achtmal in der Liste, so oft wie er Abschnitte hat.
$abschnittA = avesmapsBuildSearchEntry(wegZeile([
    'name' => 'Goblinpfad', 'display_name' => 'Goblinpfad', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
]));
$zeileB = wegZeile([
    'name' => 'Goblinpfad', 'display_name' => 'Goblinpfad', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
]);
$zeileB['public_id'] = 'weg-2';
$abschnittB = avesmapsBuildSearchEntry($zeileB);
assert(
    $abschnittA['group_key'] === $abschnittB['group_key'],
    'zwei Abschnitte desselben Wegs muessen dieselbe Suchgruppe bilden'
);

// ---- 6. Der ganze Weg durch avesmapsBuildMapSearchResults --------------------------------------
// Ein gruener Test von avesmapsBuildSearchEntry beweist nicht, dass der Treffer bis in die
// Antwort laeuft: der Wegzweig ist der EINZIGE, der ueber $pathGroups geht statt direkt in
// $results -- und ein leerer Gruppenschluessel wirft ihn dort wortlos weg.
$zeileA = wegZeile([
    'name' => 'Goblinpfad', 'display_name' => 'Goblinpfad', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
]);
$ergebnisse = avesmapsBuildMapSearchResults([$zeileA, $zeileB], [], 'Goblinpfad', 20);
assert(count($ergebnisse) === 1, 'erwartet genau EIN Weg-Ergebnis, bekommen: ' . count($ergebnisse));
assert($ergebnisse[0]['name'] === 'Goblinpfad');
assert($ergebnisse[0]['kind'] === 'path');
assert(
    $ergebnisse[0]['public_ids'] === ['weg-1', 'weg-2'],
    'beide Abschnitte reisen mit, damit die Auswahl den GANZEN Weg zeigt: '
        . json_encode($ergebnisse[0]['public_ids'])
);

echo "wege-suche-manueller-name: alle Zusicherungen gruen\n";
