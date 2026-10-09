<?php

declare(strict_types=1);

/**
 * Die Kartensuche findet Objekte auch ueber ihre ART -- am ECHTEN Endpunktcode.
 * =========================================================================
 * Discord #145 (Erdnusbuddha, 30.09.2026): „Können wir bitte die Funktion hinzufügen, das z.b. mit
 * dem Suchbegriff "Akademie" alle Akademien auf der map angezeigt werden." Teil 1 davon (Owner-GO
 * 09.10.2026): die Suche nach der Art. Gemessen davor: „Magierakademie" fand KEINEN Ort auf der Karte,
 * „Akademie" nur die, die das Wort im Namen tragen.
 *
 * Vier Zusagen, jede hier festgehalten:
 *   1. Die Art ist suchbar -- Ortsart (place_kind), Bauwerkstyp und Gottheit aus der Registry beim
 *      Kartenort, die Registry-Art beim Innerorts-Objekt.
 *   2. Sie zaehlt NACHRANGIG: ein Namenstreffer steht immer davor. Sonst schoebe „Fe" ueber
 *      „Festung" jede Burg vor „Ferdok".
 *   3. Ein VERBORGENER Ort bekommt keine Art -- „Wer den Namen kennt, findet ihn" (Owner 15.08.2026).
 *   4. art_texts verlaesst den Server nicht (wie search_texts).
 *
 * Verfahren wie wege-suche-manueller-name-test.php: die Funktionen werden aus der Datei geschnitten
 * und ausgefuehrt, ohne den Anfrage-Teil zu beruehren.
 *
 * Lauf (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/app/__tests__/suche-nach-art-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht 1 -- die Zusicherungen liefen leer.\n");
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
require_once __DIR__ . '/../../_internal/wiki/path-naming.php';

$quelle = (string) file_get_contents(__DIR__ . '/../map-search.php');
$anfrageBeginn = strpos($quelle, "\ntry {");
$funktionenBeginn = strpos($quelle, 'function avesmapsReadMapSearchQuery');
assert($anfrageBeginn !== false && $funktionenBeginn !== false, 'Marker im Endpunkt nicht gefunden -- umgebaut?');
$kopf = (string) preg_replace(
    '/^\s*(<\?php|declare\(strict_types=1\);|require(_once)?\s.*?;)\s*$/m',
    '',
    substr($quelle, 0, $anfrageBeginn)
);
// ⚠️ eval() traegt keine Eingabe von aussen -- die einzige Quelle ist eine feste Datei dieses Repos.
eval($kopf . "\n" . substr($quelle, $funktionenBeginn));

$pruefungen = 0;

/** Eine Ortszeile, wie map_features sie liefert. */
function artOrt(string $publicId, string $name, string $subtype, array $properties = []): array {
    return [
        'public_id' => $publicId,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'name' => $name,
        'geometry_type' => 'Point',
        'properties_json' => json_encode($properties, JSON_UNESCAPED_UNICODE),
        'min_x' => 100.0,
        'min_y' => 200.0,
        'max_x' => 100.0,
        'max_y' => 200.0,
    ];
}

// ---- 1. Der Bewertungskern: die Art zaehlt nachrangig -----------------------------------------
$ferdok = ['search_texts' => ['Ferdok', 'stadt']];
$burg = ['search_texts' => ['Burg Aar', 'gebaeude'], 'art_texts' => ['Festung']];
assert(avesmapsCalculateSearchScore($ferdok, 'fe') === 1, 'Vorbedingung: Namenspraefix ist Stufe 1');
assert(avesmapsCalculateSearchScore($burg, 'fe') === 1 + AVESMAPS_SEARCH_ART_SCORE_OFFSET,
    '💣 ein Artpraefix liegt HINTER jedem Namenstreffer -- sonst schoebe „Fe" jede Burg vor „Ferdok"');
assert(avesmapsCalculateSearchScore($burg, 'festung') === AVESMAPS_SEARCH_ART_SCORE_OFFSET, 'die volle Art trifft (Stufe 0, versetzt)');
assert(avesmapsCalculateSearchScore($burg, 'burg') === 1, 'ein Namenstreffer bleibt ein Namenstreffer, auch wenn eine Art daneben steht');
assert(avesmapsCalculateSearchScore(['search_texts' => ['Burg Aar']], 'festung') === null, 'ohne art_texts trifft die Art nicht');
assert(AVESMAPS_SEARCH_ART_SCORE_OFFSET > 3, 'gekoppelt: der Versatz muss ueber der schlechtesten Namensstufe (3) liegen');
$pruefungen += 6;

// Mehrere Woerter duerfen verschiedene Texte treffen -- Name UND Art.
$tempel = ['search_texts' => ['Haus der Rosen', 'Rahja'], 'art_texts' => ['Tempel']];
assert(avesmapsCalculateSearchScore($tempel, 'rahja tempel') === AVESMAPS_SEARCH_ART_SCORE_OFFSET,
    'ein Wort im Namen, eines in der Art: das schwaechste Wort bestimmt den Rang');
// Nur Art, kein Name: das Objekt ist trotzdem ein Treffer (der leere Name darf nichts abweisen).
assert(avesmapsCalculateSearchScore(['search_texts' => [], 'art_texts' => ['Tempel']], 'tempel') === AVESMAPS_SEARCH_ART_SCORE_OFFSET);
$pruefungen += 2;

// ---- 2. Die Art eines Kartenorts ---------------------------------------------------------------
$registry = [
    'Burg Aar' => ['type' => 'Festung', 'ruined' => false, 'deity' => ''],
    'Haus der Rosen' => ['type' => 'Tempel', 'ruined' => false, 'deity' => 'Rahja,Tsa'],
    'Versteckte Feste' => ['type' => 'Festung', 'ruined' => false, 'deity' => ''],
];
assert(avesmapsLocationSearchArtTexts(['wiki_settlement' => ['title' => 'Burg Aar']], $registry) === ['Festung'],
    'der Bauwerkstyp kommt ueber den Titel der Wiki-Zuweisung');
assert(avesmapsLocationSearchArtTexts(['wiki_settlement' => ['title' => 'Haus der Rosen']], $registry) === ['Tempel', 'Rahja', 'Tsa'],
    'jede Gottheit ist suchbar, nicht nur die erste');
assert(avesmapsLocationSearchArtTexts(['place_kind' => 'Oase'], $registry) === ['Oase'], 'die vom Editor gesetzte Ortsart zaehlt');
assert(avesmapsLocationSearchArtTexts(['place_kind' => 'Oase', 'wiki_settlement' => ['title' => 'Burg Aar']], $registry) === ['Oase'],
    '🔴 die Ortsart ERSETZT den Wiki-Typ wie in der Typzeile -- ein ueberschriebener Typ ist nicht mehr suchbar');
assert(avesmapsLocationSearchArtTexts(['place_kind' => 'Kapelle', 'wiki_settlement' => ['title' => 'Haus der Rosen']], $registry) === ['Kapelle', 'Rahja', 'Tsa'],
    'die Gottheiten bleiben neben der Ortsart suchbar');
assert(avesmapsLocationSearchArtTexts(['wiki_settlement' => ['title' => 'Unbekannt']], $registry) === [], 'ein unbekannter Titel liefert nichts');
assert(avesmapsLocationSearchArtTexts([], $registry) === [], 'ohne Zuweisung und Ortsart keine Art');
assert(avesmapsLocationSearchArtTexts(['is_hidden' => true, 'wiki_settlement' => ['title' => 'Versteckte Feste']], $registry) === [],
    '🔴 ein verborgener Ort bekommt KEINE Art -- „Wer den Namen kennt, findet ihn"');
$pruefungen += 8;

// ---- 3. Ende zu Ende durch avesmapsBuildMapSearchResults --------------------------------------
$zeilen = [
    artOrt('loc-ferdok', 'Ferdok', 'stadt'),
    artOrt('loc-burg', 'Burg Aar', 'gebaeude', ['wiki_settlement' => ['title' => 'Burg Aar']]),
    artOrt('loc-versteckt', 'Versteckte Feste', 'gebaeude', ['is_hidden' => true, 'wiki_settlement' => ['title' => 'Versteckte Feste']]),
];
$suche = static fn(string $q): array => avesmapsBuildMapSearchResults($zeilen, [], $q, 20, bauwerksarten: $registry);
$namen = static fn(array $treffer): array => array_column($treffer, 'name');

$festung = $suche('Festung');
assert($namen($festung) === ['Burg Aar'], 'die Suche nach der Art findet die Burg -- und nur sie');
assert(!array_key_exists('art_texts', $festung[0]) && !array_key_exists('search_texts', $festung[0]),
    'art_texts verlaesst den Server nicht');
// „Versteckte Feste" trifft hier ueber ihren NAMEN (Wortanfang „Feste", Stufe 2) -- das ist erlaubt.
assert($namen($suche('fe')) === ['Ferdok', 'Versteckte Feste', 'Burg Aar'],
    '💣 die Namenstreffer stehen VOR dem Arttreffer, obwohl „Burg" alphabetisch vorne laege');
assert($namen($suche('Versteckte Feste')) === ['Versteckte Feste'], 'den verborgenen Ort findet, wer seinen Namen kennt');
assert(!in_array('Versteckte Feste', $namen($suche('Festung')), true), 'ueber seine Art findet ihn niemand');
assert($namen(avesmapsBuildMapSearchResults($zeilen, [], 'Festung', 20)) === [],
    'ohne Registry (Vorgabe) bleibt die Suche, wie sie vor dem 09.10.2026 war');
$pruefungen += 6;

// ---- 4. Das Innerorts-Objekt traegt seine Registry-Art -----------------------------------------
$index = avesmapsBuildSettlementLocationIndex([
    ['feature_type' => 'location', 'feature_subtype' => 'stadt', 'name' => 'Punin', 'public_id' => 'pid-punin', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 1.0, 'max_y' => 1.0],
]);
$scope = ['settlements' => avesmapsPlaceScopeBuildNameSet(['Punin']), 'regions' => avesmapsPlaceScopeBuildNameSet([])];
$innerorts = avesmapsBuildInSettlementSearchEntries(
    [['title' => 'Halle der Antimagie', 'raw' => '[[Punin]]', 'type_label' => 'Magierakademie', 'deity' => '', 'wiki_url' => '']],
    $index,
    $scope
);
assert(count($innerorts) === 1 && $innerorts[0]['art_texts'] === ['Magierakademie'], 'das Innerorts-Objekt traegt seine Art');
assert(avesmapsCalculateSearchScore($innerorts[0], 'magierakademie') === AVESMAPS_SEARCH_ART_SCORE_OFFSET,
    '„Magierakademie" findet die Halle der Antimagie, die das Wort nicht im Namen traegt');
assert(avesmapsCalculateSearchScore($innerorts[0], 'akademie') === 3 + AVESMAPS_SEARCH_ART_SCORE_OFFSET,
    '„Akademie" findet sie ueber die Art -- als enthaltenes Wort, hinter allen Namenstreffern');
$pruefungen += 3;

// ---- 5. Der Endpunkt holt die Registry und reicht sie durch (kommentarfrei gelesen) ------------
$ohneKommentare = '';
foreach (token_get_all($quelle) as $t) {
    $ohneKommentare .= (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) ? '' : (is_array($t) ? $t[1] : $t);
}
assert(str_contains($ohneKommentare, '$bauwerksarten = avesmapsLoadWikiSyncBuildingTypes($pdo);'), 'der Endpunkt holt die Registry');
assert(preg_match('/bauwerksarten: \$bauwerksarten\s*\)/', $ohneKommentare) === 1, 'und reicht sie an den Ergebnisbauer');
assert(str_contains($ohneKommentare, 'avesmapsBuildSearchEntry($row, $bauwerksarten)'), 'der Ergebnisbauer reicht sie an jeden Eintrag');
// 🔴 EINE Tafel, zwei Leser: der Lader steht nicht mehr im Nutzlast-Endpunkt.
$nutzlast = (string) file_get_contents(__DIR__ . '/../map-features.php');
assert(!str_contains($nutzlast, 'function avesmapsLoadWikiSyncBuildingTypes'), 'der Lader steht nur EINMAL im Haus');
$pruefungen += 4;

echo "suche-nach-art: alle {$pruefungen} Zusicherungen gruen\n";
