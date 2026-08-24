<?php

declare(strict_types=1);

/**
 * Test der Einstellungsregeln der Kurvenbeschriftung. Keine DB, kein HTTP.
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/curve-label-store-test.php
 *
 * Warum diese Regeln einen Test verdienen und keinen Kommentar: beide scheitern LEISE.
 *  - Eine fehlende Einstellung als „an" zu lesen aendert 657 Labels auf einen Schlag.
 *  - Ein Winkel von 360 Grad ist sichtbar 0 und numerisch nicht -- roh geprueft schaltet die
 *    Umstellregel dort eine Kurve ein, wo niemand etwas gedreht haben wollte.
 */

require_once __DIR__ . '/../curve-label-store.php';

// ------------------------------------------------------------------ DIE EINSTELLUNG ---

// 🔴 Fehlt der Schluessel, ist die Kurvenbeschriftung AUS. Ein leeres properties_json darf niemals
// 657 Labels umstellen.
$vorgabe = avesmapsCurveLabelSettingsFromProperties(null);
assert($vorgabe === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelSettingsFromProperties([]) === ['enabled' => false, 'max_labels' => 1]);

// Gesetzte Werte kommen durch.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 2])
    === ['enabled' => true, 'max_labels' => 2]);

// 🔴 Der Deckel ist 3 (Owner 22.08.2026), und er wird geklemmt statt abgelehnt.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 9])['max_labels'] === 3);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 0])['max_labels'] === 1);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => -4])['max_labels'] === 1);

// Unsinn im JSON kippt nicht auf „an".
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 'vielleicht'])['enabled'] === false);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 1])['enabled'] === true);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 'zwei'])['max_labels'] === 1);

// ------------------------------------------------------------------ BEFUND 7: DER KLEMMHELFER ---
// 💣 Derselbe Klemmausdruck stand VIERMAL in curve-label-store.php. avesmapsCurveClampMaxLabels
// ist jetzt die einzige Stelle, die den Deckel (3) und die Untergrenze (1) kennt -- alle vier
// Aufrufer sind ueber diese Funktion bereits indirekt mitgeprueft.
// ⚠️ Einer von ihnen (avesmapsCurveLabelRolloutFor) ist am 24.08.2026 mit dem Umstelllauf
// gefallen; es sind seither drei.
assert(avesmapsCurveClampMaxLabels(1) === 1);
assert(avesmapsCurveClampMaxLabels(3) === 3);
assert(avesmapsCurveClampMaxLabels(0) === 1);
assert(avesmapsCurveClampMaxLabels(-5) === 1);
assert(avesmapsCurveClampMaxLabels(9) === 3);

// -------------------------------------------------- DIE UMSTELLREGEL -- GEFALLEN 24.08.2026 ---
// 🔴 Hier standen 12 Zusicherungen zu avesmapsCurveLabelRolloutFor (Rotation modulo 360, Anzahl
// gedeckelt auf 3). Die Funktion gibt es nicht mehr: der einmalige Umstelllauf ist ersatzlos
// entfernt, weil er seine Arbeit getan hat (Entwurf §3, api/_internal/app/curve-label-store.php).
// ⚠️ Der Vermerk steht hier, damit niemand die Luecke fuer verlorene Abdeckung haelt und die
// Zusicherungen „wiederherstellt" -- sie haetten kein Subjekt mehr.

// ------------------------------------------------------------------ ANHAENGEN ---

$features = [
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l1', 'ecosystem_region_public_id' => 'r1']],
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l2', 'ecosystem_region_public_id' => 'r2']],
    ['properties' => ['feature_type' => 'label', 'public_id' => 'l3']],
    ['properties' => ['feature_type' => 'location', 'public_id' => 'o1', 'ecosystem_region_public_id' => 'r1']],
];
$byRegion = ['r1' => ['line' => [[1.0, 2.0], [3.0, 4.0]], 'max_labels' => 2]];
avesmapsCurveApplyToFeatures($features, $byRegion);

// Das Label seiner Region bekommt Kurve und Anzahl.
assert($features[0]['properties']['curve_label_line'] === [[1.0, 2.0], [3.0, 4.0]]);
assert($features[0]['properties']['curve_label_max'] === 2);

// 🔴 Eine Region OHNE Kurve bekommt keinen Schluessel -- nicht `null`, nicht `[]`. Der Client
// unterscheidet „hat keine Kurve" an der Abwesenheit; ein leeres Feld waere eine leere Kurve.
assert(!array_key_exists('curve_label_line', $features[1]['properties']));

// Ein Label ohne Region bleibt unberuehrt.
assert(!array_key_exists('curve_label_line', $features[2]['properties']));

// 💣 Nur LABELS. Ein Ort, der zufaellig in derselben Region liegt, bekommt nichts -- er hat keine
// Achse und traegt seinen Namen neben seinem Punkt.
assert(!array_key_exists('curve_label_line', $features[3]['properties']));

// Ein leeres Verzeichnis aendert nichts und wirft nicht.
$unveraendert = $features;
avesmapsCurveApplyToFeatures($features, []);
assert($features === $unveraendert);

// ------------------------------------------------------------------ ZWISCHENSPEICHER ---

// 🔴 Befund 8 der Zweigpruefung: der Fingerabdruck ist jetzt das PAAR aus Revisionssumme UND
// Flaechenzahl (rev, cnt) -- SUM(geometry_revision) allein kollidiert (eigene Probe weiter unten).
$blob = json_encode([
    'version' => 1,
    'regions' => [
        'r1' => ['rev' => 7, 'cnt' => 1, 'max' => 2, 'line' => [[1.0, 2.0], [3.0, 4.0]]],
        'r2' => ['rev' => 3, 'cnt' => 1, 'max' => 1, 'line' => [[5.0, 6.0], [7.0, 8.0]]],
    ],
]);

// Passt der Fingerabdruck, kommt die Kurve.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => ['rev' => 7, 'cnt' => 1], 'r2' => ['rev' => 3, 'cnt' => 1]]);
assert(array_keys($geladen) === ['r1', 'r2']);
assert($geladen['r1']['line'] === [[1.0, 2.0], [3.0, 4.0]]);
assert($geladen['r1']['max_labels'] === 2);

// 💣 Eine VERALTETE Kurve wird weggelassen, nicht ausgeliefert. Jemand hat die Flaeche geaendert;
// die alte Achse gehoert zu einer Geometrie, die es nicht mehr gibt. Die Karte zeichnet dann eine
// Gerade -- sichtbar schlichter, aber nicht falsch.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => ['rev' => 8, 'cnt' => 1], 'r2' => ['rev' => 3, 'cnt' => 1]]);
assert(array_keys($geladen) === ['r2']);

// 💣 Befund 8: gleiche SUMME, andere FLAECHENZAHL ist EBENFALLS veraltet -- genau der Fall, den
// eine reine Summenpruefung nicht bemerkt haette (eine Flaeche stillgelegt, Summe zufaellig
// unveraendert).
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => ['rev' => 7, 'cnt' => 2], 'r2' => ['rev' => 3, 'cnt' => 1]]);
assert(array_keys($geladen) === ['r2'], 'gleiche Summe, andere Flaechenzahl muss als veraltet gelten');

// Eine Region, die es nicht mehr gibt, faellt heraus.
assert(avesmapsCurveBaselinesFromCache($blob, []) === []);

// 🔴 Unsinn im Zwischenspeicher ergibt LEER, nie eine halbe Kurve und nie eine Ausnahme. Der
// Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
assert(avesmapsCurveBaselinesFromCache('', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);
assert(avesmapsCurveBaselinesFromCache('kein json', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);
assert(avesmapsCurveBaselinesFromCache('null', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1}', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);

// 💣 Eine kuenftige Fassung des Formats wird IGNORIERT, nicht falsch gelesen. Ohne diese Pruefung
// liest eine alte Auslieferung ein neues Feld als altes -- und niemand sieht es.
assert(avesmapsCurveBaselinesFromCache(
    '{"version":2,"regions":{"r1":{"rev":7,"cnt":1,"max":1,"line":[[1,2],[3,4]]}}}',
    ['r1' => ['rev' => 7, 'cnt' => 1]]
) === []);

// Eine Zeile ohne Linie ist keine Kurve.
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"cnt":1,"max":1}}}', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"cnt":1,"max":1,"line":[[1,2]]}}}', ['r1' => ['rev' => 7, 'cnt' => 1]]) === []);

// 💣 Eine kaputte Region reisst die anderen NICHT mit. Das braucht ZWEI Regionen, um ueberhaupt
// sichtbar zu sein -- mit nur einer sehen "diese Region weglassen" und "alles weglassen" identisch
// aus, und genau daran ist der erste Entwurf vorbeigelaufen.
$gemischt = '{"version":1,"regions":{'
    . '"kaputt":{"rev":1,"cnt":1,"max":1,"line":[[1,2],["x",4]]},'
    . '"heil":{"rev":2,"cnt":1,"max":1,"line":[[5,6],[7,8]]}}}';
$geladen = avesmapsCurveBaselinesFromCache($gemischt, ['kaputt' => ['rev' => 1, 'cnt' => 1], 'heil' => ['rev' => 2, 'cnt' => 1]]);
assert(array_keys($geladen) === ['heil']);
assert($geladen['heil']['line'] === [[5.0, 6.0], [7.0, 8.0]]);

// Dasselbe fuer die uebrigen Fehlerklassen, damit keine von ihnen heimlich eskaliert.
$gemischt2 = '{"version":1,"regions":{'
    . '"ohneLinie":{"rev":1,"cnt":1,"max":1},'
    . '"zuKurz":{"rev":1,"cnt":1,"max":1,"line":[[1,2]]},'
    . '"veraltet":{"rev":9,"cnt":1,"max":1,"line":[[1,2],[3,4]]},'
    . '"heil":{"rev":2,"cnt":1,"max":1,"line":[[5,6],[7,8]]}}}';
$geladen2 = avesmapsCurveBaselinesFromCache($gemischt2, [
    'ohneLinie' => ['rev' => 1, 'cnt' => 1],
    'zuKurz' => ['rev' => 1, 'cnt' => 1],
    'veraltet' => ['rev' => 1, 'cnt' => 1],
    'heil' => ['rev' => 2, 'cnt' => 1],
]);
assert(array_keys($geladen2) === ['heil']);

// ------------------------------------------------------------------ SAMMELLAUF ---

// Der Bauer der Ablage: nur eingeschaltete Regionen, Linie auf Lieferdichte gebracht, drei
// Nachkommastellen, Fingerabdruck (rev, cnt) vollstaendig uebernommen (Befund 8).
$gebaut = avesmapsCurveBuildCachePayload([
    'r1' => [
        'rev' => 7,
        'cnt' => 2,
        'settings' => ['enabled' => true, 'max_labels' => 2],
        'geometries' => [['type' => 'Polygon', 'coordinates' => [[
            [0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0], [0.0, 0.0],
        ]]]],
    ],
    'r2' => [
        'rev' => 3,
        'cnt' => 1,
        'settings' => ['enabled' => false, 'max_labels' => 1],
        'geometries' => [['type' => 'Polygon', 'coordinates' => [[
            [0.0, 0.0], [50.0, 0.0], [50.0, 10.0], [0.0, 10.0], [0.0, 0.0],
        ]]]],
    ],
]);
$daten = json_decode($gebaut, true);
assert($daten['version'] === 1);

// 🔴 Eine ausgeschaltete Region steht NICHT in der Ablage. Sie mitzuschreiben hiesse, jede Karte
// Kurven ausliefern zu lassen, die niemand sehen soll.
assert(array_keys($daten['regions']) === ['r1']);
assert($daten['regions']['r1']['rev'] === 7);
assert($daten['regions']['r1']['cnt'] === 2);
assert($daten['regions']['r1']['max'] === 2);

// Lieferdichte: 32 Punkte, nicht die 120 der Rechnung.
assert(count($daten['regions']['r1']['line']) === 32);

// Drei Nachkommastellen -- die Quelle hat nicht mehr Aussagekraft, und die Nutzlast ist der Preis.
foreach ($daten['regions']['r1']['line'] as $punkt) {
    assert(round($punkt[0], 3) === $punkt[0]);
    assert(round($punkt[1], 3) === $punkt[1]);
}

// 💣 Was hier herauskommt, muss der Leser aus Aufgabe 7 wieder hereinbekommen. Die beiden Formate
// EINZELN zu testen liesse genau die Naht ungeprueft, an der sie auseinanderlaufen.
$zurueck = avesmapsCurveBaselinesFromCache($gebaut, ['r1' => ['rev' => 7, 'cnt' => 2], 'r2' => ['rev' => 3, 'cnt' => 1]]);
assert(array_keys($zurueck) === ['r1']);
assert(count($zurueck['r1']['line']) === 32);
assert($zurueck['r1']['max_labels'] === 2);

// Eine Region ohne brauchbare Geometrie faellt still heraus, sie bricht den Lauf nicht ab.
$mitMuell = avesmapsCurveBuildCachePayload([
    'r3' => ['rev' => 1, 'cnt' => 1, 'settings' => ['enabled' => true, 'max_labels' => 1], 'geometries' => []],
]);
assert(json_decode($mitMuell, true)['regions'] === []);

// ------------------------------------------------------------------ BEFUND 8: DIE KOLLISIONSPROBE ---
// Eine Region mit EINER Flaeche der Revision 3 und eine mit DREI Flaechen der Revision 1 ergeben
// beide die reine Summe 3 -- SUM(geometry_revision) allein kann sie nicht unterscheiden ("eine
// Flaeche mit Revision 3 stilllegen" und "eine andere dreimal bearbeiten ergibt dieselbe Summe").
// Der Fingerabdruck (rev, cnt) tut es.
$einesRechteck = [['type' => 'Polygon', 'coordinates' => [[
    [0.0, 0.0], [40.0, 0.0], [40.0, 25.0], [0.0, 25.0], [0.0, 0.0],
]]]];
$einLappen = avesmapsCurveBuildCachePayload([
    'x' => ['rev' => 3, 'cnt' => 1, 'settings' => ['enabled' => true, 'max_labels' => 1], 'geometries' => $einesRechteck],
]);
$dreiLappen = avesmapsCurveBuildCachePayload([
    'x' => ['rev' => 3, 'cnt' => 3, 'settings' => ['enabled' => true, 'max_labels' => 1], 'geometries' => $einesRechteck],
]);
$regionEinLappen = json_decode($einLappen, true)['regions']['x'];
$regionDreiLappen = json_decode($dreiLappen, true)['regions']['x'];
assert($regionEinLappen['rev'] === $regionDreiLappen['rev'], 'die reine Summe ist bewusst gleich -- das ist die Kollision');
assert($regionEinLappen['cnt'] !== $regionDreiLappen['cnt'], 'die Flaechenzahl unterscheidet, was die Summe allein nicht kann');

// Ein Leser mit dem Fingerabdruck der "3 Flaechen"-Lage darf die "1 Flaeche"-Ablage NICHT als
// aktuell akzeptieren, obwohl die Revisionssumme uebereinstimmt.
$geladenKollision = avesmapsCurveBaselinesFromCache($einLappen, ['x' => ['rev' => 3, 'cnt' => 3]]);
assert($geladenKollision === [], 'Befund 8: reine Summengleichheit darf die Kurve NICHT durchlassen');

// ------------------------------------------------------------------ BEFUND 3: REIHENFOLGE IN map-features.php ---
// 🔴 avesmapsCurveApplyToFeatures muss NACH avesmapsEcosystemApplyLabelRegionsToFeatures stehen --
// rund 137 Labels bekommen ihren ecosystem_region_public_id erst dort. Vertauscht verlieren genau
// die ihre Kurve, WORTLOS, bei gruenem Testfeld. Nach dem Vorbild in
// api/_internal/app/__tests__/settlement-coat-gate-test.php:64-68.
$mapFeaturesQuelle = file_get_contents(__DIR__ . '/../../../app/map-features.php');
$posEcosystemLink = strpos($mapFeaturesQuelle, 'avesmapsEcosystemApplyLabelRegionsToFeatures(');
$posCurveApply = strpos($mapFeaturesQuelle, 'avesmapsCurveApplyToFeatures(');
assert($posEcosystemLink !== false && $posCurveApply !== false, 'eine der beiden Stellen fehlt in map-features.php');
assert($posEcosystemLink < $posCurveApply, 'avesmapsCurveApplyToFeatures muss NACH avesmapsEcosystemApplyLabelRegionsToFeatures stehen');

// ------------------------------------------------------------------ BEFUND 2: KEIN DECODE FUER AUS ---
// Die Einstellung steht bereits beim ERSTEN Zeilentreffer der Region fest (sie haengt an
// r.properties_json, nicht an der Flaeche) -- json_decode() der Geometrie darf fuer eine
// ausgeschaltete Region nie laufen (91 % Verschwendung am Umstelltag, AGENTS.md §9). Strukturell
// geprueft wie Befund 3 oben: die Ueberspring-Pruefung muss VOR dem json_decode der Geometrie im
// Quelltext von avesmapsCurveRebuildCache stehen.
$storeQuelle = file_get_contents(__DIR__ . '/../curve-label-store.php');
$funcStart = strpos($storeQuelle, 'function avesmapsCurveRebuildCache(');
assert($funcStart !== false, 'avesmapsCurveRebuildCache fehlt');
$posEnabledSkip = strpos($storeQuelle, "if (!\$regionen[\$regionId]['settings']['enabled']) {", $funcStart);
$posGeomDecode = strpos($storeQuelle, "json_decode((string) \$row['geometry_geojson']", $funcStart);
assert($posEnabledSkip !== false && $posGeomDecode !== false, 'eine der beiden Stellen fehlt in avesmapsCurveRebuildCache');
assert($posEnabledSkip < $posGeomDecode, 'die Region muss VOR dem json_decode der Geometrie als ausgeschaltet erkannt werden');

// ------------------------------------------------------ DER SCHREIBER: NUR GENANNTES ANFASSEN ---
// 💣 DIE TRAGENDE ZUSICHERUNG. Der Wert steht an ZWEI Oberflaechen (Beschriftungs- und
// Flaechendialog) und beide speichern dieselbe Region. Wer ein NICHT genanntes Feld schreibt, nimmt
// mit dem Speichern des einen Dialogs die Aenderung des anderen wortlos zurueck.
$bestand = json_encode(['curve_label' => true, 'curve_label_max' => 3]);

// Nichts genannt -> gar nichts schreiben.
assert(avesmapsCurveLabelApplyToProperties($bestand, null, null) === []);
assert(avesmapsCurveLabelApplyToProperties(null, null, null) === []);

// Nur den Haken genannt -> die Zahl bleibt, wie sie war.
$nurHaken = avesmapsCurveLabelApplyToProperties($bestand, false, null);
$p = json_decode((string) $nurHaken['properties_json'], true);
assert(!array_key_exists('curve_label', $p), 'aus muss den Schluessel ENTFERNEN, nicht false schreiben');
assert($p['curve_label_max'] === 3, 'eine nicht genannte Zahl darf sich nicht bewegen');

// Nur die Zahl genannt -> der Haken bleibt, wie er war.
$nurZahl = avesmapsCurveLabelApplyToProperties($bestand, null, 2);
$p = json_decode((string) $nurZahl['properties_json'], true);
assert($p['curve_label'] === true, 'ein nicht genannter Haken darf sich nicht bewegen');
assert($p['curve_label_max'] === 2);

// Der Deckel gilt auch hier -- ueber avesmapsCurveClampMaxLabels, nie ueber eine abgeschriebene 3.
assert(json_decode((string) avesmapsCurveLabelApplyToProperties(null, true, 9)['properties_json'], true)['curve_label_max'] === 3);
assert(json_decode((string) avesmapsCurveLabelApplyToProperties(null, true, 0)['properties_json'], true)['curve_label_max'] === 1);
assert(json_decode((string) avesmapsCurveLabelApplyToProperties(null, true, -4)['properties_json'], true)['curve_label_max'] === 1);

// 💣 DREI SCHREIBER TEILEN EIN properties_json. Ein fremder Schluessel muss den Schreibvorgang
// ueberleben -- sonst loescht das Umlegen des Hakens den Merker wiki_no_article gleich mit.
$mitFremd = json_encode(['wiki_no_article' => true, 'field_origins' => ['name' => 'manual']]);
$p = json_decode((string) avesmapsCurveLabelApplyToProperties($mitFremd, true, 2)['properties_json'], true);
assert($p['wiki_no_article'] === true, 'ein fremder Schluessel darf nicht verlorengehen');
assert($p['field_origins'] === ['name' => 'manual'], 'die Feldherkunft darf nicht verlorengehen');
assert($p['curve_label'] === true && $p['curve_label_max'] === 2);

// Bleibt nichts uebrig, wird die Spalte NULL.
assert(avesmapsCurveLabelApplyToProperties(json_encode(['curve_label' => true]), false, null)['properties_json'] === null);

// Eine kaputte Ablage wirft nicht, sie faengt bei leer an.
$p = json_decode((string) avesmapsCurveLabelApplyToProperties('{kaputt', true, null)['properties_json'], true);
assert($p === ['curve_label' => true]);

// Schreiber und Leser muessen denselben Dialekt sprechen.
$rund = avesmapsCurveLabelApplyToProperties(null, true, 2)['properties_json'];
assert(avesmapsCurveLabelSettingsFromProperties(json_decode((string) $rund, true))
    === ['enabled' => true, 'max_labels' => 2], 'Schreiber und Leser muessen zusammenpassen');

// ----------------------------------------------------- VERDRAHTUNG: wird der Schreiber gerufen? ---
// 💣 Ein gruener Test beweist nichts ohne Verdrahtung: avesmapsCurveLabelRolloutFor stand fertig und
// getestet da, ohne dass irgendetwas sie rief -- deshalb trug am 23.08.2026 genau EINE Flaeche eine
// Kurve. Diese Zusicherung nagelt fest, dass der Schreiber im Schreibweg der Landschaften steht.
$ecoQuelle = file_get_contents(__DIR__ . '/../ecosystem.php');
assert(strpos($ecoQuelle, 'avesmapsCurveLabelApplyToProperties(') !== false,
    'der Schreiber ist nicht in ecosystem.php verdrahtet');
$posHerkunft = strpos($ecoQuelle, 'avesmapsEcosystemApplyRegionFieldOrigins($before');
$posKurve = strpos($ecoQuelle, 'avesmapsCurveLabelApplyToProperties(');
assert($posHerkunft !== false && $posKurve !== false);
assert($posHerkunft < $posKurve, 'der Kurvenschreiber muss NACH der Feldherkunft stehen -- beide schreiben properties_json');

// ------------------------------------------- die gerechnete Kurve muss BEIM BROWSER ANKOMMEN ---
//
// 💣 Owner 24.08.2026: „speichern loest aber nicht automatisch ‚Labelkurve aktualisieren‘ aus".
// Gerechnet hat update_region seit dem 23.08. schon -- die fertige Kurve kam nur nie heraus: die
// Antwort trug `region` und `revision`, sonst nichts. Der Kartenpayload wird nach einem Speichern
// nicht neu geholt, also blieb das Bild stehen. Aus Sicht des Editors war das nicht von „es rechnet
// gar nicht" zu unterscheiden -- und im Flaechendialog stand genau das als Einschraenkung.

assert(avesmapsCurveAntwortAnteil(null) === [],
    '🔴 nicht gerechnet heisst SCHWEIGEN, nicht „leere Kurve“');

$anteil = avesmapsCurveAntwortAnteil(['line' => [[1.0, 2.0], [3.0, 4.0]], 'max' => 2, 'gerechnet' => true]);
assert($anteil['curve_label_line'] === [[1.0, 2.0], [3.0, 4.0]], 'die Linie reist mit');
assert($anteil['curve_label_max'] === 2, 'und die Zahl der Namen');
assert($anteil['curve_gerechnet'] === true, 'und die Auskunft, ob ueberhaupt gerechnet wurde');

// 🔴 DIESELBEN SCHLUESSEL WIE BEIM MENUEKNOPF. Der Browser wendet beide Antworten mit demselben
// Aufruf an; zwei Formen fuer dieselbe Kurve waeren die Stelle, an der die Koordinaten auseinander
// laufen (AGENTS.md §5). Geprueft gegen den Knopf-Rueckgabewert in ecosystem.php.
foreach (['curve_label_line', 'curve_label_max'] as $schluessel) {
    assert(strpos($ecoQuelle, "'{$schluessel}' =>") !== false,
        "der Menueknopf antwortet mit {$schluessel} -- der Speicherweg muss denselben Namen benutzen");
    assert(array_key_exists($schluessel, $anteil), "und {$schluessel} steht im Anteil des Speicherwegs");
}

// Eine unsinnige Zahl wird gedeckelt statt durchgereicht -- derselbe Deckel wie ueberall sonst.
assert(avesmapsCurveAntwortAnteil(['max' => 99])['curve_label_max'] === 3, 'der Deckel gilt auch hier');
assert(avesmapsCurveAntwortAnteil([])['curve_label_line'] === null,
    'ein Ergebnis ohne Linie sagt null -- der Browser laesst dann eine vorhandene Kurve stehen');

// ---- und der Speicherweg gibt ihn auch heraus ------------------------------------------------------
// 🪤 Ohne Kommentare geprueft: die Begruendung ueber der Fundstelle nennt den Funktionsnamen ebenfalls.
$ecoOhneKommentare = (string) preg_replace(['~/\*.*?\*/~s', '~//[^\n]*~'], '', $ecoQuelle);
$updAnfang = strpos($ecoOhneKommentare, 'function avesmapsUpdateEcosystemRegion(');
assert($updAnfang !== false, 'avesmapsUpdateEcosystemRegion gibt es noch');
$updEnde = strpos($ecoOhneKommentare, "\nfunction ", $updAnfang + 1);
$updRumpf = substr($ecoOhneKommentare, $updAnfang, ($updEnde === false ? strlen($ecoOhneKommentare) : $updEnde) - $updAnfang);
assert(strpos($updRumpf, 'avesmapsCurveAntwortAnteil(') !== false,
    '💣 das Speichern gibt die gerechnete Kurve heraus -- sonst sieht der Editor keine Wirkung');

// ---- und der Browser reicht sie an den Anwender weiter ----------------------------------------------
// 💣 Die andere Haelfte: der Server kann die Linie mitschicken, solange der Dialog sie nicht
// weitergibt, aendert sich am Bild nichts. Genau diese Luecke war der gemeldete Fehler.
$dialog = (string) file_get_contents(__DIR__ . '/../../../../js/map-features/map-features-ecosystem-properties.js');
$dialogOhneKommentare = (string) preg_replace(['~/\*.*?\*/~s', '~//[^\n]*~'], '', $dialog);
assert(strpos($dialogOhneKommentare, 'curve_label_line') !== false,
    '💣 der Flaechendialog reicht die gerechnete Linie an avesmapsCurveSettingAufLabelsAnwenden weiter');

echo "curve-label-store tests passed\n";
