<?php

declare(strict_types=1);

/**
 * DAS KANON-ETIKETT: Namensraum-Ablesung + Ableitung.
 *
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kanon-etikett-test.php
 *
 * 💣 DER BEFUND (01.09.2026), und er ist derselbe wie am 30.08.2026 eine Datei weiter.
 * `avesmapsMapFeaturesWikiNamespaces` stand einen Tag lang in api/app/map-features.php -- einer
 * ENDPUNKTdatei, die sich nicht einbinden laesst, ohne die ganze Kartenantwort auszufuehren. In
 * dieser testfreien Zone las sie `$row['properties']`. Diese Spalte gibt es nicht; sie heisst
 * `properties_json` (avesmapsBuildMapFeaturesQuery), und die Schwesterfunktion
 * avesmapsMapFeaturesMergeLegacyOtherSources, die ueber DIESELBEN Zeilen laeuft, liest sie auch so.
 * Gemessen an einer Zeile, die exakt der SELECT-Liste entspricht: die Funktion gab in Produktion
 * AUSNAHMSLOS `[]` zurueck. Der gesamte ns-222-Rang war tot -- ohne Fehler, ohne roten Test, weil
 * „kein Etikett" ein voellig gueltiger Zustand ist. 574 gruene Tests haben nichts davon beruehrt.
 *
 * 🔴 DER SCHLUESSELTAUSCH ALLEIN HAETTE ES NICHT GEHEILT. Die Adresse, die der Quellenkasten
 * zeigt, entsteht erst SPAETER: `avesmapsEnrichMapFeatureWikiUrl` fuellt `wiki_url` ueberhaupt
 * erst per Namensabgleich gegen `wiki_sync_pages`. Aus der Rohzeile gelesen haette das Etikett an
 * einem ANDEREN Artikel gehangen als der Link daneben. Deshalb nimmt die Funktion heute die
 * FERTIGEN GeoJSON-Objekte -- und deshalb steht Gruppe 2 hier.
 */

require_once __DIR__ . '/../feature-sources.php';

if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

/** Ein fertiges GeoJSON-Objekt, so wie avesmapsMapFeatureRowToGeoJsonFeature es liefert. */
function objekt(string $featureType, string $publicId, string $wikiUrl = ''): array
{
    $properties = ['public_id' => $publicId, 'feature_type' => $featureType, 'feature_subtype' => ''];
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    return ['type' => 'Feature', 'geometry' => null, 'properties' => $properties];
}

$WA = 'https://de.wiki-aventurica.de/wiki/';

// ---- 1. Der gemeldete Fall: ein ns-222-Ort wird ueberhaupt erkannt ---------------------------
// ⚠️ „Gareth" fehlt in der Antwort, und das ist richtig: avesmapsWikiTitleNamespace kennt nur
// PRAEFIXE, ein blanker Titel traegt keines. Der Hauptraum steht deshalb nie in dieser Karte --
// er wird nicht herausgefiltert, er entsteht gar nicht erst. Fuer die Ableitung ist das
// gleichbedeutend: `null` faellt durch, und `0` waere offiziell und fiele ebenso durch.
$karte = avesmapsMapFeaturesWikiNamespaces([
    objekt('location', 'p-apfeldorn', $WA . 'Inoffiziell:Apfeldorn'),
    objekt('location', 'p-gareth', $WA . 'Gareth'),
]);
assert($karte === ['settlement:p-apfeldorn' => 222],
    'ns 222 wird unter seinem entity_type abgelesen, der praefixlose Hauptraum gar nicht');

// ---- 2. DIE REGRESSION: eine ROHZEILE darf nichts ergeben ------------------------------------
// 💣 Das ist der eigentliche Waechter dieser Datei. Wer die Funktion je wieder mit `$rows`
// fuettert -- der Aufruf sieht identisch aus, beide sind `array` --, bekommt hier einen roten
// Test statt eines wortlos leeren Etiketts. Die Zeile traegt exakt die Spalten der SELECT-Liste.
$rohzeile = [
    'public_id' => 'p-apfeldorn',
    'feature_type' => 'location',
    'feature_subtype' => '',
    'name' => 'Apfeldorn',
    'geometry_type' => 'Point',
    'geometry_json' => '{}',
    'properties_json' => json_encode(['wiki_url' => $WA . 'Inoffiziell:Apfeldorn']),
    'style_json' => null,
    'is_active' => 1,
    'revision' => 7,
    'updated_at' => '2026-09-01 00:00:00',
];
assert(avesmapsMapFeaturesWikiNamespaces([$rohzeile]) === [],
    'Rohzeilen tragen `properties_json`, kein `properties` -- sie duerfen nichts ergeben');

// ---- 3. Kraftlinien sind dabei ---------------------------------------------------------------
// 💣 `powerline` fehlte in der ersten Zuordnung, weil sie aus dem Altquellen-Sammler abgeschrieben
// wurde -- dessen Kommentar „only these three feature types are in scope" galt fuer die
// ALTQUELLEN. Kraftlinien tragen wiki_url (api/edit/map/powerlines.php:67) und rendern eine
// Kanonzeile (js/map-features/map-features-powerlines.js).
assert(avesmapsMapFeaturesWikiNamespaces([objekt('powerline', 'k-nord', $WA . 'Inoffiziell:Nordlinie')])
    === ['powerline:k-nord' => 222], 'Kraftlinien muessen ein Etikett bekommen koennen');
assert(avesmapsMapFeaturesWikiNamespaces([objekt('label', 'l-moor', $WA . 'Inoffiziell:Moor')])
    === ['region:l-moor' => 222], 'label -> region');
assert(avesmapsMapFeaturesWikiNamespaces([objekt('path', 'w-1', $WA . 'Inoffiziell:Saumpfad')])
    === ['path:w-1' => 222], 'path -> path');
assert(avesmapsMapFeaturesWikiNamespaces([objekt('junction', 'x-1', $WA . 'Inoffiziell:X')]) === [],
    'Kreuzungen haben keine Quellflaeche -- kein Etikett');

// ---- 4. Grabsteine bekommen kein Etikett ------------------------------------------------------
// 💣 Bei gesetztem `since_revision` laesst avesmapsBuildMapFeaturesQuery `is_active = 1` fallen;
// geloeschte Objekte reisen als Grabstein mit, und js/routing/routing.js ruft genau so. Deren
// GeoJSON traegt nur `deleted`/`revision` -- nie eine wiki_url. Der Riegel faellt von selbst,
// statt als dritte handgeschriebene Kopie der is_active-Pruefung.
$grabstein = ['type' => 'Feature', 'geometry' => null,
    'properties' => ['public_id' => 'p-weg', 'deleted' => true, 'revision' => 9, 'updated_at' => '']];
assert(avesmapsMapFeaturesWikiNamespaces([$grabstein]) === [], 'Grabsteine bekommen kein Etikett');
assert(avesmapsMapFeaturesWikiNamespaces([objekt('location', 'p-ohne')]) === [],
    'ohne wiki_url kein Eintrag -- „nicht nachgesehen" ist keine Aussage');
// ⚠️ Ohne public_id gaebe es den Muellschluessel „settlement:" -- ein Etikett fuer nichts.
assert(avesmapsMapFeaturesWikiNamespaces([objekt('location', '', $WA . 'Inoffiziell:X')]) === [],
    'ohne public_id kein Eintrag');
// ⚠️ Und was gar keine Merkmale traegt, faellt ebenfalls durch (kein Fehler, kein Eintrag).
assert(avesmapsMapFeaturesWikiNamespaces([['type' => 'Feature'], ['properties' => 'kaputt'], []]) === [],
    'formlose Eintraege ergeben nichts');

// ---- 5. Fremde Betreiber werden abgewiesen ----------------------------------------------------
// 💣 garetien.de ist hier kein Strohmann: die Uebernahme dieser Briefspielseite wird gerade
// gebaut (js/review/review-garetien-importer.js). Ihr Etikett truege sonst „Wiki Aventurica" als
// Bezeichner -- eine falsche Zuschreibung an einen fremden Betreiber.
assert(avesmapsWikiNamespaceFromWikiUrl('https://www.garetien.de/wiki/Inoffiziell:Apfeldorn') === null,
    'fremder Wirt -> kein Namensraum');
assert(avesmapsWikiNamespaceFromWikiUrl('https://de.wiki-aventurica.de.angreifer.example/wiki/Inoffiziell:X') === null,
    'auf SUFFIX-Grenze pruefen, nicht auf Teilzeichenkette');
// 💣 SCHEMALOS IST NICHT „RELATIV". Die erste Fassung liess einen fehlenden Wirt zu, weil „ein
// relativer Pfad nicht auf einen fremden Betreiber zeigen kann" -- `parse_url` gibt aber fuer
// `garetien.de/wiki/X` GENAUSO keinen Wirt zurueck (alles wird Pfad). Der Riegel griff damit
// genau bei der Form nicht, gegen die er gebaut wurde.
foreach (['garetien.de/wiki/Inoffiziell:X', 'www.garetien.de/wiki/Inoffiziell:X',
          '/wiki/Inoffiziell:Apfeldorn', 'https:/garetien.de/wiki/Inoffiziell:X'] as $ohneWirt) {
    assert(avesmapsWikiNamespaceFromWikiUrl($ohneWirt) === null,
        "ohne erkennbaren Wiki-Wirt kein Namensraum: {$ohneWirt}");
}
// ⚠️ `strtolower` ist tragend -- der Ausdruck traegt kein `i`-Flag, und DNS ist fallunabhaengig.
assert(avesmapsWikiNamespaceFromWikiUrl('HTTPS://DE.WIKI-AVENTURICA.DE/wiki/Inoffiziell:Apfeldorn') === 222,
    'ein grossgeschriebener Wirt ist derselbe Wirt');
// Die realen Formen im Bestand muessen durchkommen -- 276 von 276 tragen ein Schema.
foreach (['https://de.wiki-aventurica.de/wiki/Inoffiziell:X', 'https://www.wiki-aventurica.de/wiki/Inoffiziell:X',
          'https://wiki-aventurica.de/wiki/Inoffiziell:X', '//de.wiki-aventurica.de/wiki/Inoffiziell:X',
          'https://de.wiki-aventurica.de:8080/wiki/Inoffiziell:X'] as $echt) {
    assert(avesmapsWikiNamespaceFromWikiUrl($echt) === 222, "reale Adressform abgewiesen: {$echt}");
}

// ---- 6. Unterseiten, Sonderformen, doppelte Kodierung -----------------------------------------
// 💣 `strrpos('/')` liess von `Inoffiziell:Trutzbach/Zollhaus` nur „Zollhaus" uebrig. 15 der 302
// ns-222-Kartenentitaeten im Dump vom 01.09.2026 tragen einen Schraegstrich.
assert(avesmapsWikiNamespaceFromWikiUrl($WA . 'Inoffiziell:Trutzbach/Zollhaus') === 222,
    'Unterseiten duerfen den Namensraum nicht verlieren');
assert(avesmapsWikiNamespaceFromWikiUrl($WA . 'Inoffiziell:Apfeldorn?action=raw#Geschichte') === 222,
    'Abfrage und Sprungmarke gehoeren nicht zum Titel');
assert(avesmapsWikiNamespaceFromWikiUrl($WA . 'Inoffiziell%3AApfeldorn') === 222, 'Prozentkodierung');
assert(avesmapsWikiNamespaceFromWikiUrl('https://de.wiki-aventurica.de/de/index.php?title=Inoffiziell:X') === 222,
    'zweite Adressform des Wikis');
// 💣 Beide Formen muessen DASSELBE sagen. Doppelt kodiert ist der Titel kein Namensraum mehr --
// `parse_str` loest schon auf, ein zweites rawurldecode machte aus %253A wieder einen Doppelpunkt.
assert(avesmapsWikiNamespaceFromWikiUrl($WA . 'Inoffiziell%253AApfeldorn')
    === avesmapsWikiNamespaceFromWikiUrl('https://de.wiki-aventurica.de/de/index.php?title=Inoffiziell%253AApfeldorn'),
    'beide Adressformen muessen denselben Titel gleich beantworten');
// ⚠️ `?title[]=X` ist ein ARRAY -- ein `(string)` darauf waere eine PHP-Meldung im Protokoll.
// 💣 DER RUECKGABEWERT ALLEIN PRUEFT DAS NICHT: `(string) ['x']` ist `'Array'`, und das ergibt
// ebenfalls `null`. Diese Zusicherung war deshalb blind fuer genau das, was ihr Text behauptet --
// die Meldung muss zur Ausnahme gemacht werden, sonst prueft sie nur das halbe Versprechen.
$vorherigerHandler = set_error_handler(static function (int $stufe, string $text): bool {
    throw new RuntimeException("PHP-Meldung: {$text}");
});
try {
    $arrayForm = avesmapsWikiNamespaceFromWikiUrl('https://de.wiki-aventurica.de/de/index.php?title[]=Inoffiziell:X');
    assert($arrayForm === null, 'ein Feld statt einer Zeichenkette ergibt `null`');
    $arrayForm = avesmapsWikiNamespaceFromWikiUrl('https://de.wiki-aventurica.de/de/index.php?title[a]=Inoffiziell:X');
    assert($arrayForm === null, 'auch als assoziatives Feld');
} finally {
    set_error_handler($vorherigerHandler);
}

// ---- 7. Die Ableitung: die drei Raenge --------------------------------------------------------
$katalog = [
    1 => ['label' => 'Goldene Fluegel', 'type' => 'abenteuer', 'official' => 1],
    2 => ['label' => 'Briefspiel (Garetien)', 'type' => 'briefspiel', 'official' => 0],
    3 => ['label' => 'Nordwacht', 'type' => 'briefspiel', 'official' => 0],
    'os:p-alt' => ['label' => 'Alte Quelle', 'type' => 'sonstige', 'official' => 0],
];
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [
    'settlement:p-off' => [['source_id' => 1], ['source_id' => 2]], // offiziell schlaegt inoffiziell
    'settlement:p-brief' => [['source_id' => 2]],
    'settlement:p-zwei' => [['source_id' => 2], ['source_id' => 3]],
    'settlement:p-alt' => [['source_id' => 'os:p-alt']],
    'settlement:p-leer' => [],
    'settlement:p-geist' => [['source_id' => 999]], // Verweis ohne Katalogzeile
], []);
assert($kanon['settlement:p-off'] === ['kanon' => 'offiziell'],
    'eine offizielle Quelle schlaegt zehn inoffizielle -- Owner 27.08.2026');
assert($kanon['settlement:p-brief'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Briefspiel (Garetien)'],
    'eine einzige inoffizielle Quelle gibt ihren Namen her');
assert($kanon['settlement:p-zwei'] === ['kanon' => 'inoffiziell', 'bezeichner_type' => 'briefspiel', 'bezeichner_count' => 2],
    'zwei verschiedene Namen -> Typ + Anzahl, damit die Anzeige „Briefspiel (2)" bauen kann');
// 💣 GEZAEHLT WERDEN DIE QUELLEN, NICHT DIE NAMEN. Bei „2 Quellen / 2 Namen" sind beide Zahlen
// gleich, und genau daran war der erste Testfall blind: ein `count($labels)` an dieser Stelle
// waere gruen geblieben. Drei Quellen unter zwei Namen trennen die beiden Zaehlungen.
$kanonDrei = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-drei' => [['source_id' => 2], ['source_id' => 3], ['source_id' => 'os:p-alt']]], []);
assert(($kanonDrei['settlement:p-drei']['bezeichner_count'] ?? 0) === 3,
    'die Anzahl zaehlt QUELLEN (3), nicht verschiedene Namen (3 hier, aber siehe unten)');
$kanonDrei = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-drei' => [['source_id' => 2], ['source_id' => 2], ['source_id' => 3]]], []);
assert(($kanonDrei['settlement:p-drei']['bezeichner_count'] ?? 0) === 3,
    'drei Quellen unter zwei Namen zaehlen als 3, sonst sagt die Anzeige „Briefspiel (2)" bei dreien');
// 💣 NICHT nach int wandeln: `(int) 'os:p-alt'` ist 0, und die Altquelle waere verloren.
assert($kanon['settlement:p-alt'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Alte Quelle'],
    'die synthetischen `os:`-Schluessel der Altquellen muessen heil bleiben');
assert(!isset($kanon['settlement:p-leer']), 'gar keine Quelle -> gar kein Eintrag');
assert(!isset($kanon['settlement:p-geist']),
    'ein Verweis ohne Katalogzeile ist keine Aussage -- eine Datenluecke darf kein Etikett setzen');

// ---- 8. Rang 2: der Namensraum, wenn sonst nichts da ist --------------------------------------
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], ['settlement:p-apfeldorn' => 222]);
assert($kanon['settlement:p-apfeldorn'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'],
    'ein ns-222-Objekt ohne jede Quellzeile ist trotzdem inoffiziell -- der Zweck des Umbaus');
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], ['settlement:p-gareth' => 0]);
assert(!isset($kanon['settlement:p-gareth']), 'ns 0 ohne Quelle bleibt ohne Etikett');
// ⚠️ ns 218 (DSK) und ns 220 (Elf) sind OFFIZIELLE Inhaltsraeume -- Owner 01.09.2026: „elf ist
// offiziell, ilaris nicht". Sie duerfen kein inoffizielles Etikett ausloesen. Ein Etikett
// „offiziell" setzen sie aber auch nicht: das taete nur eine offizielle QUELLE (Rang 1).
foreach ([218, 220] as $offiziellerRaum) {
    $kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], ['settlement:p-x' => $offiziellerRaum]);
    assert(!isset($kanon['settlement:p-x']), "ns {$offiziellerRaum} ist offiziell -- kein inoffizielles Etikett");
}
// 🔴 ns 444 (Ilaris) IST ein Inhaltsraum, nur ein unoffizieller -- Owner 01.09.2026: „elf ist
// offiziell, ilaris nicht". Er traegt deshalb dasselbe Etikett wie ns 222.
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], ['settlement:p-ilaris' => 444]);
assert($kanon['settlement:p-ilaris'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'],
    'Ilaris ist ein unoffizieller Inhaltsraum, kein unbekannter');
// ⚠️ Ein Raum, der GAR KEIN Inhalt ist (Kategorie, Datei, Vorlage), gibt `null` zurueck -- und
// `null` ist keine Aussage. Mit einem blossen `false` fuer alles Unbekannte waere jede
// Kategorieseite „inoffiziell": eine Behauptung, die niemand aufgestellt hat.
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], ['settlement:p-kategorie' => 14]);
assert(!isset($kanon['settlement:p-kategorie']), '`null` heisst „nicht gefragt", nicht „inoffiziell"');
// Owner 31.08.2026: „gibt es was Offizielles, is uns ns222 egal".
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-doppelt' => [['source_id' => 1]]], ['settlement:p-doppelt' => 222]);
assert($kanon['settlement:p-doppelt'] === ['kanon' => 'offiziell'],
    'eine offizielle Quelle schlaegt auch den inoffiziellen Namensraum');

// ---- 9. RANG 2 STEHT VOR RANG 3 -- der Namensraum schlaegt die Quellzeile ---------------------
// 🔴 SO HAELT ES ENTWURF §2.1 FEST (Owner-Freigabe 27.08.2026): offizielle Quelle · ns 222 ·
// inoffizielle Quelle · ohne Quelle. Vom 31.08. bis zum 02.09.2026 stand hier das GEGENTEIL,
// mit dieser Begruendung:
//
//   „trotzdem find ichs nett, wenn da briefspiel steht, wenns ein briefspiel-ort ist"
//   (Owner 27.08.2026)
//
// 💣 DER SATZ GILT WEITER -- ER TRIFFT DIESEN FALL NUR NICHT. Bei einem ns-222-Objekt IST die
// „Quelle" der Wiki-Artikel selbst, und ihr `label` ist deshalb der SEITENTITEL, kein
// Korpusname: es stand „INOFFIZIELL │ Apfeldorn" da, wo „│ Wiki Aventurica" hingehoert
// (Owner-Meldung 02.09.2026). Ein Seitentitel an der Stelle eines Korpusnamens ist nicht
// genauer, sondern eine andere Aussage.
// ⭐ Und die echten Korpora bleiben unberuehrt: von 608 inoffiziellen Objekten des Livebestands
// liegt genau EINES in ns 222 (02.09.2026 gemessen).
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-beides' => [['source_id' => 2]]], ['settlement:p-beides' => 222]);
assert($kanon['settlement:p-beides'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'],
    'ns 222 schlaegt die inoffizielle Quellzeile -- ihr Label waere hier der Seitentitel');

// ⚠️ UND DIE GEGENPROBE, die diese Zusicherung erst zu einer macht: OHNE ns 222 behaelt dieselbe
// Quelle ihren Namen. Sonst waere „Wiki Aventurica" ein Rueckfall fuer alles, und die 283
// „Briefspiel"-, 113 „AlmadaWiki"- und 54 „Albernisches Briefspiel"-Objekte verloeren ihn.
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-nurquelle' => [['source_id' => 2]]], []);
assert($kanon['settlement:p-nurquelle'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Briefspiel (Garetien)'],
    'ohne inoffiziellen Namensraum bleibt der Korpusname der Quelle stehen');

// 🔴 Und „Wiki Aventurica" gilt NUR dem Wiki (Owner 02.09.2026: „soll nur dranstehen, wenn es ein
// ns222 fall ist"). Ein Raum, der KEIN Inhalt ist, loest nichts aus -- das prueft Abschnitt 8
// oben; hier die zweite Haelfte: ein OFFIZIELLER Inhaltsraum ebenso wenig.
foreach ([0 => 'Hauptraum', 218 => 'DSK', 220 => 'Elf'] as $raum => $name) {
    $kanon = avesmapsFeatureSourcesDeriveKanon($katalog,
        ['settlement:p-raum' => [['source_id' => 2]]], ['settlement:p-raum' => $raum]);
    assert($kanon['settlement:p-raum'] === ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Briefspiel (Garetien)'],
        "ns {$raum} ({$name}) ist offiziell und darf die Quellzeile nicht ueberschreiben");
}

// ---- 10. Beide Mengen bilden den Suchraum -----------------------------------------------------
// Objekte, deren einzige Herkunft ihr Wiki-Artikel ist, stehen NICHT in $refs.
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog,
    ['settlement:p-brief' => [['source_id' => 2]]], ['settlement:p-nurwiki' => 222]);
assert(isset($kanon['settlement:p-brief'], $kanon['settlement:p-nurwiki']),
    'die Vereinigung beider Schluesselmengen ist der Suchraum, nicht $refs allein');

// ---- 11. Der ganze Weg, wie ihn der Endpunkt geht ---------------------------------------------
$kanon = avesmapsFeatureSourcesDeriveKanon($katalog, [], avesmapsMapFeaturesWikiNamespaces([
    objekt('location', 'p-apfeldorn', $WA . 'Inoffiziell:Apfeldorn'),
    objekt('location', 'p-gareth', $WA . 'Gareth'),
    objekt('powerline', 'k-nord', $WA . 'Inoffiziell:Nordlinie'),
]));
assert($kanon === [
    'settlement:p-apfeldorn' => ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'],
    'powerline:k-nord' => ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'],
], 'die Abnahme: aus ns 222 wird ein inoffizielles Etikett, aus ns 0 keines');

// ---- 12. Der Endpunkt fuettert sie auch wirklich mit den OBJEKTEN -----------------------------
// 💣 Ohne diese Zusicherung waere alles darueber gruen und die Karte trotzdem leer: der Fehler
// war nie in der Funktion, sondern in dem, was der Endpunkt ihr reicht.
// ⚠️ Erst der Pfad, dann der Inhalt. `strpos` auf einer leeren Zeichenkette schlaegt IMMER fehl:
// ohne diesen Riegel meldete ein verrutschter Pfad „der Endpunkt uebergibt $rows" -- eine
// Falschaussage ueber Code, den der Test nie gelesen hat. (Genau so ist er beim ersten Lauf
// umgefallen.)
$endpunktPfad = __DIR__ . '/../../../app/map-features.php';
assert(is_file($endpunktPfad), "die Endpunktdatei muss unter {$endpunktPfad} liegen");
$endpunkt = (string) file_get_contents($endpunktPfad);
assert(strpos($endpunkt, 'avesmapsMapFeaturesWikiNamespaces($features)') !== false,
    'der Endpunkt muss die FERTIGEN Objekte uebergeben, nicht $rows');
assert(strpos($endpunkt, 'function avesmapsMapFeaturesWikiNamespaces') === false,
    'sie darf nicht in die Endpunktdatei zurueckwandern -- dort erreicht sie kein Test');
// 💣 AM ZEILENANFANG SUCHEN, NICHT IRGENDWO. `strpos` findet einen AUSKOMMENTIERTEN Aufruf
// genauso wie einen lebenden -- `//` entfernt den Text ja nicht. Eine Quelltextzusicherung, die
// das nicht beachtet, bewacht die Schreibweise und nicht die Verdrahtung. Nachgemessen: mit
// auskommentiertem Sammleraufruf blieb der Test gruen.
$stelle = static function (string $muster) use ($endpunkt): int {
    assert(preg_match('/^[ \t]*' . preg_quote($muster, '/') . '/m', $endpunkt, $t, PREG_OFFSET_CAPTURE) === 1,
        "im Endpunkt fehlt der Aufruf: {$muster}");
    return (int) $t[0][1];
};
$reihenfolge = $stelle('$features = array_map(');
$ableitung = $stelle('$featureKanon = avesmapsFeatureSourcesDeriveKanon(');
assert($reihenfolge < $ableitung,
    'die Ableitung muss NACH dem Objektbau stehen -- davor gibt es die angereicherte wiki_url nicht');
// 💣 UND DIESE ZEILE STAND ZUERST ALS `assert(strpos(…) < $ableitung, …)` DA. Sie konnte damit
// NIE rot werden: verschwindet der bewachte Aufruf, gibt `strpos` `false` zurueck, und PHP
// vergleicht `false < 12345` BOOLESCH (`false < true`) -- also wahr. Die Zusicherung hielt genau
// dann, wenn sie haette greifen muessen.
// ⚠️ Eine Warnung davor stand schon weiter oben und half nichts, weil sie nur den Sonderfall
// „leere Datei" nannte statt der Regel: KEIN `strpos`-Rueckgabewert wird verglichen, bevor er auf
// `!== false` geprueft ist. Deshalb sucht $stelle() oben jetzt fuer alle drei -- und wirft selbst,
// statt ein `false` weiterzureichen.
assert($stelle('avesmapsMapFeaturesMergeLegacyOtherSources($rows') < $ableitung,
    'und NACH dem Altquellen-Sammler, sonst fehlt Objekten mit reiner Altquelle das Etikett');

echo "kanon-etikett-test.php: alle Zusicherungen erfuellt\n";
