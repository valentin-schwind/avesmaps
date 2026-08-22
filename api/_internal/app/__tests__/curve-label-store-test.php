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

// ------------------------------------------------------------------ DIE UMSTELLREGEL ---

// Rotation 0 ueberall -> bleibt aus. Das sind 601 der 657 Labels; sie duerfen sich am Umstelltag
// nicht um ein Pixel bewegen.
assert(avesmapsCurveLabelRolloutFor([0]) === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelRolloutFor([0, 0, 0]) === ['enabled' => false, 'max_labels' => 3]);

// Eine echte Drehung schaltet ein.
assert(avesmapsCurveLabelRolloutFor([326])['enabled'] === true);

// 💣 360 Grad ist sichtbar 0. Genau ein Label im Livebestand hat das: „Weiden", das einzige
// gedrehte derographische. Roh geprueft bekaeme es eine Kurve, obwohl dort niemand etwas gedreht
// haben wollte.
assert(avesmapsCurveLabelRolloutFor([360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([720])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-90])['enabled'] === true);

// 🔴 Die Anzahl ist „so viele Labels wie vorhanden, hoechstens 3" -- nicht fest 1. Fuenf gedrehte
// Regionen tragen heute zwei Labels; auf 1 gesetzt verloeren sie einen Namen.
assert(avesmapsCurveLabelRolloutFor([300, 300]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([317, 325]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([10, 20, 30, 40]) === ['enabled' => true, 'max_labels' => 3]);

// Eine Region ohne Label ergibt keine Umstellung.
assert(avesmapsCurveLabelRolloutFor([]) === ['enabled' => false, 'max_labels' => 1]);

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

$blob = json_encode([
    'version' => 1,
    'regions' => [
        'r1' => ['rev' => 7, 'max' => 2, 'line' => [[1.0, 2.0], [3.0, 4.0]]],
        'r2' => ['rev' => 3, 'max' => 1, 'line' => [[5.0, 6.0], [7.0, 8.0]]],
    ],
]);

// Passt die Revision, kommt die Kurve.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => 7, 'r2' => 3]);
assert(array_keys($geladen) === ['r1', 'r2']);
assert($geladen['r1']['line'] === [[1.0, 2.0], [3.0, 4.0]]);
assert($geladen['r1']['max_labels'] === 2);

// 💣 Eine VERALTETE Kurve wird weggelassen, nicht ausgeliefert. Jemand hat die Flaeche geaendert;
// die alte Achse gehoert zu einer Geometrie, die es nicht mehr gibt. Die Karte zeichnet dann eine
// Gerade -- sichtbar schlichter, aber nicht falsch.
$geladen = avesmapsCurveBaselinesFromCache($blob, ['r1' => 8, 'r2' => 3]);
assert(array_keys($geladen) === ['r2']);

// Eine Region, die es nicht mehr gibt, faellt heraus.
assert(avesmapsCurveBaselinesFromCache($blob, []) === []);

// 🔴 Unsinn im Zwischenspeicher ergibt LEER, nie eine halbe Kurve und nie eine Ausnahme. Der
// Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
assert(avesmapsCurveBaselinesFromCache('', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('kein json', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('null', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1}', ['r1' => 7]) === []);

// 💣 Eine kuenftige Fassung des Formats wird IGNORIERT, nicht falsch gelesen. Ohne diese Pruefung
// liest eine alte Auslieferung ein neues Feld als altes -- und niemand sieht es.
assert(avesmapsCurveBaselinesFromCache('{"version":2,"regions":{"r1":{"rev":7,"max":1,"line":[[1,2],[3,4]]}}}', ['r1' => 7]) === []);

// Eine Zeile ohne Linie ist keine Kurve.
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"max":1}}}', ['r1' => 7]) === []);
assert(avesmapsCurveBaselinesFromCache('{"version":1,"regions":{"r1":{"rev":7,"max":1,"line":[[1,2]]}}}', ['r1' => 7]) === []);

// 💣 Eine kaputte Region reisst die anderen NICHT mit. Das braucht ZWEI Regionen, um ueberhaupt
// sichtbar zu sein -- mit nur einer sehen "diese Region weglassen" und "alles weglassen" identisch
// aus, und genau daran ist der erste Entwurf vorbeigelaufen.
$gemischt = '{"version":1,"regions":{'
    . '"kaputt":{"rev":1,"max":1,"line":[[1,2],["x",4]]},'
    . '"heil":{"rev":2,"max":1,"line":[[5,6],[7,8]]}}}';
$geladen = avesmapsCurveBaselinesFromCache($gemischt, ['kaputt' => 1, 'heil' => 2]);
assert(array_keys($geladen) === ['heil']);
assert($geladen['heil']['line'] === [[5.0, 6.0], [7.0, 8.0]]);

// Dasselbe fuer die uebrigen Fehlerklassen, damit keine von ihnen heimlich eskaliert.
$gemischt2 = '{"version":1,"regions":{'
    . '"ohneLinie":{"rev":1,"max":1},'
    . '"zuKurz":{"rev":1,"max":1,"line":[[1,2]]},'
    . '"veraltet":{"rev":9,"max":1,"line":[[1,2],[3,4]]},'
    . '"heil":{"rev":2,"max":1,"line":[[5,6],[7,8]]}}}';
$geladen2 = avesmapsCurveBaselinesFromCache($gemischt2, ['ohneLinie' => 1, 'zuKurz' => 1, 'veraltet' => 1, 'heil' => 2]);
assert(array_keys($geladen2) === ['heil']);

echo "curve-label-store tests passed\n";
