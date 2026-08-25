<?php
// api/_internal/routing/__tests__/antwortteile-test.php
declare(strict_types=1);

/**
 * MELDUNG #93 (die vier `include_*` schalten nichts), #94 (`cost` ist ohne Einheit) und #97
 * (der Debug-Block kommt immer mit).
 *
 * 💣 DER BEFUND WAR NICHT „falsch verdrahtet", SONDERN „gar nicht verdrahtet". `include_geometry`,
 * `include_steps`, `include_rests` und `include_air_distance` wurden in request.php geprueft,
 * normalisiert, durchgereicht -- und danach von KEINER Zeile gelesen (`git grep include_geometry`
 * fand ausserhalb von request.php nichts). Ein Feld, das der Vertrag zeigt und der Server annimmt,
 * ohne dass es wirkt, ist schlimmer als ein fehlendes: der Aufrufer glaubt, er habe geschaltet.
 *
 * 🔴 DIE VORGABE BLEIBT DAS HEUTIGE VERHALTEN. Alle vier stehen auf `true`, `debug` ebenso -- wer
 * nichts schickt, bekommt Zeichen fuer Zeichen die alte Antwort plus die neuen Felder. Ein
 * zwischengespeicherter alter Client darf an dieser Aenderung nicht zerbrechen (AGENTS.md §7).
 *
 * 💣 UND `cost` IST KEINE ZEIT. Es ist das Dijkstra-GEWICHT: bei `fastest` die Reisestunde mal
 * `avesmapsTravelValuesWeightFactor` (Kalenderzeit), bei `shortest` die Strecke. Genau deshalb
 * meldete der Melder 31,506 gegen eine Etappensumme von 21,004 -- das Verhaeltnis ist 12/8, der
 * Reisetag des Landes.
 *
 * 💣 UND `cost_units` IST AUCH KEINE STUNDE, was beim Nachrechnen der Meldung erst auffiel: es
 * entsteht als `distance_units / Tempo`, wobei die Strecke in KARTENEINHEITEN steht und das Tempo in
 * MEILEN je Stunde. Eine Karteneinheit ist drei Meilen, die echte Stunde also das Dreifache -- die
 * Karte zeigt fuer dieselbe Live-Route 63,0 Stunden und rechnet sie unabhaengig aus der Geometrie.
 * Abschnitt 6 nagelt beide Umrechnungen fest, damit die Doku nicht von der Rechnung abweicht.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/antwortteile-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../response.php';

// Zwei Landetappen. 💣 `cost_units` ist KEINE Stunde: es ist `distance_units / Tempo`, und
// `distance_units` sind KARTENEINHEITEN, waehrend das Tempo in Meilen je Stunde steht. 4,0 und 3,0
// hier sind also 12,0 und 9,0 echte Reisestunden (mal AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT = 3).
$etappe = static fn(string $von, string $nach, float $stunden, float $strecke): array => [
    'index' => 0, 'edge_id' => $von . '>' . $nach, 'found' => true,
    'path_id' => $von . '>' . $nach, 'feature_id' => 'f', 'public_id' => 'p',
    'from_node' => $von, 'to_node' => $nach,
    'subtype' => 'Strasse', 'transport_type' => 'groupFoot',
    'distance_units' => $strecke, 'cost_units' => $stunden, 'cost_factor' => 1.0,
    'coordinate_count' => 2,
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [$strecke, 0.0]]],
    'synthetic' => false, 'offroad' => false,
    'flow_time_factor' => 1.0, 'flow_state' => '',
    'terrain_time_factor' => 1.0, 'ascent_schritt' => null, 'descent_schritt' => null,
    'max_ascent_gradient' => null, 'max_descent_gradient' => null,
];
$etappen = [$etappe('A', 'B', 4.0, 48.0), $etappe('B', 'C', 3.0, 36.0)];

$dauer = avesmapsRouteDurationFromSegments($etappen);
$route = [
    'found' => true, 'from' => 'A', 'to' => 'C',
    'cost' => 7.0 * avesmapsTravelValuesWeightFactor('groupFoot'),
    'node_count' => 3, 'edge_count' => 2,
    'from_node' => 'A', 'to_node' => 'C',
    'node_ids' => ['A', 'B', 'C'], 'edge_ids' => ['A>B', 'B>C'],
    'segments' => $etappen,
    'duration' => $dauer,
    'air_distance_units' => 80.0,
    'distance_units' => 84.0,
    'debug_context' => ['map_revision' => 7],
];

$antwort = static fn(array $anfrage): array => avesmapsBuildMinimalRouteResponse(
    $route,
    avesmapsNormalizeRouteRequest($anfrage + ['from' => 'A', 'to' => 'C'])
);

// ---- 1. Ohne Angaben bleibt alles da ------------------------------------------------------------
$voll = $antwort([]);
assert(isset($voll['segments']), 'ohne Angabe kommen die Etappen mit');
assert(count($voll['segments']) === 2, 'und zwar beide');
assert(isset($voll['segments'][0]['geometry']), 'ohne Angabe kommt die Geometrie mit');
assert(isset($voll['debug']), 'ohne Angabe kommt der Debug-Block mit');
assert(isset($voll['air_distance_units']), 'ohne Angabe kommt die Luftlinie mit');
assert(isset($voll['duration']['rest_hours_per_day']), 'ohne Angabe kommen die Rastzeiten mit');
// Die Felder, die es schon vorher gab, stehen unveraendert da.
assert($voll['found'] === true && $voll['from'] === 'A' && $voll['to'] === 'C', 'die alten Kopffelder');
assert($voll['summary'] === ['node_count' => 3, 'edge_count' => 2], 'die alte Zusammenfassung');
assert($voll['debug']['node_ids'] === ['A', 'B', 'C'], 'node_ids stehen weiter im Debug-Block');

// ---- 2. include_geometry: false nimmt NUR die Geometrie ----------------------------------------
$ohneGeometrie = $antwort(['include_geometry' => false]);
assert(count($ohneGeometrie['segments']) === 2, 'die Etappen bleiben');
assert(!isset($ohneGeometrie['segments'][0]['geometry']), 'ihre Geometrie faellt weg');
assert($ohneGeometrie['segments'][0]['coordinate_count'] === 2,
    'die Stuetzpunktzahl bleibt -- sie sagt, wie gross die Geometrie waere');
assert($ohneGeometrie['segments'][0]['distance_units'] === 48.0, 'und die Strecke erst recht');

// ---- 3. include_steps: false nimmt die ganze Etappenliste ---------------------------------------
$ohneEtappen = $antwort(['include_steps' => false]);
assert(!array_key_exists('segments', $ohneEtappen), 'die Etappenliste fehlt ganz');
assert($ohneEtappen['summary']['edge_count'] === 2, 'die Zusammenfassung sagt trotzdem, wie viele es waeren');
assert($ohneEtappen['duration']['travel_hours'] === 21.0, 'und die Dauer steht auch ohne Etappen');
assert($ohneEtappen['distance_units'] === 84.0, 'und die Gesamtstrecke ebenso -- sonst waere sie unerreichbar');

// ---- 4. include_air_distance und include_rests --------------------------------------------------
$ohneLuft = $antwort(['include_air_distance' => false]);
assert(!array_key_exists('air_distance_units', $ohneLuft), 'die Luftlinie faellt weg');
$ohneRast = $antwort(['include_rests' => false]);
assert(!array_key_exists('rest_hours_per_day', $ohneRast['duration']), 'die Rastzeiten fallen weg');
assert(isset($ohneRast['duration']['travel_hours']), 'die reine Reisezeit bleibt -- sie ist keine Rast');

// ---- 5. debug: false ist der Kompaktmodus (#97) -------------------------------------------------
// 🔴 UND ER DARF DEM CLIENT NICHTS WEGNEHMEN, WAS ER ZUM ZEICHNEN BRAUCHT. `node_ids` lag bisher
// NUR im Debug-Block, und js/routing/route-engine.js liest sie dort (`debug.node_ids`) -- ein
// Kompaktmodus, der sie mitnimmt, waere kein Kompaktmodus, sondern ein Datenverlust. Sie stehen
// deshalb ZUSAETZLICH am Routenobjekt, wo sie hingehoeren.
$kompakt = $antwort(['debug' => false]);
assert(!array_key_exists('debug', $kompakt), 'der Debug-Block fehlt');
assert($kompakt['node_ids'] === ['A', 'B', 'C'], 'node_ids stehen trotzdem da');
assert($kompakt['edge_ids'] === ['A>B', 'B>C'], 'edge_ids ebenso');
assert(isset($voll['node_ids']), 'und im vollen Modus stehen sie an BEIDEN Stellen -- nichts entfaellt');
assert(strlen(json_encode($kompakt)) < strlen(json_encode($voll)), 'kompakt ist wirklich kleiner');

// ---- 6. Was `cost` ist, und wie ein Client daraus Zeit macht (#94) ------------------------------
// 💣 DIE EINHEITENFALLE, UND SIE IST DER EIGENTLICHE BEFUND HINTER #94: `cost_units` liest sich wie
// eine Stunde und ist keine. 7,0 cost_units sind 21,0 echte Reisestunden.
// ⚠️ Gegengerechnet an der Live-Route Gareth -> Perricum (25.08.2026): Summe der `cost_units`
// 21,004, waehrend der Reiseplan der Karte 63,0 Stunden zeigt -- und der rechnet unabhaengig aus der
// Geometrie (`calculateScaledDistance` mal 3, geteilt durchs Tempo). Faktor exakt 3,000.
assert(abs($dauer['travel_hours'] - 21.0) < 1e-12,
    'echte Reisestunden = Summe der cost_units MAL ' . AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT
    . ', gemeldet: ' . $dauer['travel_hours']);
assert(AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT === 3.0,
    'eine Karteneinheit ist drei Meilen -- der Faktor, an dem die Rechnung oben haengt');
assert(abs($dauer['travel_days'] - 21.0 / AVESMAPS_TRAVEL_LAND_HOURS) < 1e-12,
    'Kalendertage = echte Reisestunden / Reisetag des Landes');
// Und das Verhaeltnis, ueber das der Melder gestolpert ist: `cost` zur Etappensumme wie 12 zu 8.
assert(abs($route['cost'] / 7.0 - 1.5) < 1e-12,
    'cost zur Summe der cost_units steht an Land wie 12 zu 8 -- die 31,506 gegen 21,004 der Meldung');

// ---- 7. Rastzeit ist der Rest des Tages ---------------------------------------------------------
// ⚠️ EINE Quelle: der Reisetag aus travel-values.php (vom Owner im Fenster „Tempowerte" einstellbar).
// Die Rastzeit wird daraus ABGELEITET, nie zweite Zahl daneben -- sonst laufen die beiden bei der
// naechsten Verstellung auseinander, und niemand merkt es.
foreach (['land', 'water', 'night'] as $bereich) {
    $summe = $voll['duration']['travel_hours_per_day'][$bereich] + $voll['duration']['rest_hours_per_day'][$bereich];
    assert(abs($summe - 24.0) < 1e-12, "Reise- und Rastzeit ergeben bei '$bereich' zusammen 24 Stunden");
}

// ---- 8. Eine gemischte Reise rechnet je Etappe mit IHREM Reisetag -------------------------------
// 💣 Land 8, Wasser 12: waeren die Tage ueber einen Mittelwert gerechnet, waere jede gemischte
// Reise falsch -- und ausgerechnet die nennt der Melder als den Fall, der ihn interessiert.
$gemischt = $etappen;
$gemischt[1]['transport_type'] = 'riverSailer';   // 9 Stunden auf dem Wasser
$dauerGemischt = avesmapsRouteDurationFromSegments($gemischt);
assert(abs($dauerGemischt['travel_days'] - (12.0 / 8.0 + 9.0 / 12.0)) < 1e-12,
    'Kalendertage = 12/8 + 9/12, gemeldet: ' . $dauerGemischt['travel_days']);
assert(abs($dauerGemischt['travel_hours'] - 21.0) < 1e-12, 'die reinen Reisestunden bleiben 21');

fwrite(STDOUT, "OK antwortteile-test\n");
