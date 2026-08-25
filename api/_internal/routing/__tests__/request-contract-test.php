<?php
// api/_internal/routing/__tests__/request-contract-test.php
declare(strict_types=1);

/**
 * Jedes Feld, das `POST /api/route/` auswertet, steht auch in api/README.md.
 *
 * 💣 WARUM DAS EINEN TEST BRAUCHT -- der Fall, der ihn ausgeloest hat. `enabled_transports`
 * (Land/Fluss/See/Querfeldein einzeln an- und abschaltbar) war seit jeher gebaut: der Client
 * schickt es, `avesmapsRouteNormalizeEnabledTransports` normalisiert es, `avesmapsRouteDomain-
 * Enabled` wertet es aus. Im dokumentierten Vertrag stand es NIRGENDS. Am 16.08.2026 fehlte
 * deshalb eine Stunde lang die Antwort auf „wie erzwinge ich einen reinen Landweg?" -- und die
 * naheliegende Reaktion waere gewesen, ein zweites Feld `allow_river` danebenzubauen. Genau das
 * ist die Doppelwahrheit, die dieser Test verhindert: ein Feld, das wirkt, aber nicht dokumentiert
 * ist, wird beim naechsten Bedarf ein zweites Mal erfunden.
 *
 * ⚠️ Geprueft wird die RICHTUNG „Implementierung -> Dokument". Die Gegenrichtung (ein Feld im
 * Dokument, das es nicht gibt) faengt der Vertrag selbst: eine unbekannte Anfrage wird abgelehnt.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/request-contract-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1'.\n");
    exit(2);
}

// ⚠️ bootstrap.php zuerst: request.php benutzt avesmapsNormalizeSingleLine() daraus, bringt es
// aber nicht selbst mit -- im Endpunkt laedt es der Vorlauf.
require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../client-graph.php';

$readme = (string) file_get_contents(__DIR__ . '/../../../README.md');
assert($readme !== '', 'api/README.md ist lesbar');

// ---- 1. Jedes Vorgabefeld der Anfrage steht im Vertrag -------------------------------------------
foreach (array_keys(AVESMAPS_ROUTE_DEFAULT_REQUEST) as $feld) {
    assert(
        str_contains($readme, '"' . $feld . '"'),
        'api/README.md nennt das Anfragefeld `' . $feld . '` nicht. Ein Feld, das der Server '
        . 'auswertet und der Vertrag verschweigt, wird beim naechsten Bedarf ein zweites Mal erfunden.'
    );
}

// ---- 2. Und die DREI Bereiche von `enabled_transports` einzeln -----------------------------------
// 💣 ES SIND DREI, NICHT VIER. `transports` hat einen vierten Schluessel `synthetic`, aber der
// benennt nur das FAHRZEUG einer Querfeldein-Etappe. Eine Domaene ist er nicht:
// `avesmapsClientRouteDomain` kennt river, sea und sonst land -- Querfeldein faellt unter LAND.
// Der Client schickt trotzdem ein `enabled_transports.synthetic` mit; der Server liest es nie, und
// das ist folgenlos, weil der Client es ohnehin auf `allowLand` setzt. Wer daraus einen vierten
// Riegel machen will, muss die Domaenenfunktion aendern, nicht den Normalisierer.
foreach (['land', 'river', 'sea'] as $bereich) {
    assert(
        str_contains($readme, '"' . $bereich . '"'),
        'api/README.md nennt den Bereich `' . $bereich . '` nicht'
    );
}

// ---- 3. Das Weglassen bleibt „erlaubt" -----------------------------------------------------------
// 💣 DIE RUECKWAERTSKOMPATIBILITAET IST DER VERTRAG. Faellt sie, verlieren alle Bestandsaufrufer
// ohne dieses Feld auf einen Schlag Fluss und See -- und zwar lautlos, als „keine Route gefunden".
$ohne = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B']);
foreach (['land', 'river', 'sea'] as $bereich) {
    assert(
        ($ohne['enabled_transports'][$bereich] ?? null) === true,
        "ohne Angabe ist `$bereich` erlaubt"
    );
}

// Ein einzelner ausgeschalteter Bereich laesst die uebrigen unberuehrt.
$nurLand = avesmapsNormalizeRouteRequest([
    'from' => 'A', 'to' => 'B',
    'enabled_transports' => ['river' => false, 'sea' => false],
]);
assert($nurLand['enabled_transports']['land'] === true, 'Land bleibt an');
assert($nurLand['enabled_transports']['river'] === false, 'Fluss ist aus');
assert($nurLand['enabled_transports']['sea'] === false, 'See ist aus');
// 🔴 QUERFELDEIN HAENGT AM LAND, nicht am Wasser und nicht an einem eigenen Schluessel.
assert(!array_key_exists('synthetic', $nurLand['enabled_transports']),
    'enabled_transports hat drei Bereiche -- ein vierter waere ein Riegel, den niemand liest');
assert(avesmapsClientRouteDomain('Querfeldein') === 'land',
    'Querfeldein faellt unter die Landdomaene -- „nur Strassen" gibt es damit nicht');
assert(avesmapsIsClientRouteDomainEnabled('Querfeldein', $nurLand) === true,
    'bei erlaubtem Land bleiben Querfeldein-Kanten erlaubt');
assert(avesmapsIsClientRouteDomainEnabled('Flussweg', $nurLand) === false, 'Flusswege sind gesperrt');
assert(avesmapsIsClientRouteDomainEnabled('Seeweg', $nurLand) === false, 'Seewege sind gesperrt');

// ---- 4. Und die Fahrzeugwahl bleibt davon unberuehrt ---------------------------------------------
// ⚠️ Zwei unabhaengige Fragen: WELCHES Boot (`transports.river`) und OB ueberhaupt ein Boot
// (`enabled_transports.river`). Sie zu verschmelzen hiesse, ein abgeschaltetes Wasser koennte die
// gespeicherte Bootswahl des Reisenden ueberschreiben.
assert($nurLand['transports']['river'] === AVESMAPS_ROUTE_DEFAULT_REQUEST['transports']['river'],
    'ein abgeschalteter Fluss aendert die Bootswahl nicht');

// ---- 5. Ein dokumentiertes Feld muss auch WIRKEN -------------------------------------------------
// 💣 DIE LUECKE, DIE MELDUNG #93 MOEGLICH GEMACHT HAT. Abschnitt 1 prueft „steht das Feld im
// Vertrag?" -- und genau das war bei `include_geometry`, `include_steps`, `include_rests` und
// `include_air_distance` erfuellt: sie standen im Dokument, request.php pruefte und normalisierte
// sie, der Test war gruen. Gelesen hat sie danach KEINE Zeile. Ein Aufrufer schaltete damit ins
// Leere und glaubte, geschaltet zu haben -- schlimmer als ein fehlendes Feld.
//
// ⚠️ Geprueft wird die Richtung „Vertrag -> WIRKUNG": jeder Schluessel muss ausserhalb von
// request.php irgendwo im Routing-Code vorkommen. Das ist grob (ein Vorkommen ist noch keine
// richtige Auswertung), faengt aber genau den Fall „gar nicht verdrahtet".
$wirkungsQuellen = '';
foreach (array_merge(glob(__DIR__ . '/../*.php'), [__DIR__ . '/../../../route/index.php']) as $datei) {
    if (basename($datei) === 'request.php') {
        continue;   // dort steht jedes Feld per Definition -- das ist die Annahme, nicht die Wirkung
    }
    $wirkungsQuellen .= (string) file_get_contents($datei);
}

// 🔴 EINE Ausnahme, und sie ist begruendet, nicht vergessen. `rest_hours_per_day` ist das
// Gegenstueck des Reisetages (24 minus Reisestunden). Der Reisetag ist aber owner-eingestellt
// (travel-values.php, Fenster „Tempowerte") und wird in `duration.travel_hours_per_day`
// herausgegeben; wuerde das Anfragefeld ihn ueberschreiben, stuenden zwei Reisetag-Modelle im
// System -- genau die Divergenz, die routing.js am 16.08.2026 beseitigt hat. Es wird deshalb
// angenommen, gegen 0..23,5 geprueft und ausdruecklich NICHT ausgewertet; api/README.md sagt das.
$ohneWirkung = ['rest_hours_per_day'];

foreach (array_keys(AVESMAPS_ROUTE_DEFAULT_REQUEST) as $feld) {
    if (in_array($feld, $ohneWirkung, true)) {
        assert(str_contains($readme, 'does not change the'),
            'api/README.md sagt, dass `' . $feld . '` die Antwort nicht veraendert');
        continue;
    }
    assert(str_contains($wirkungsQuellen, "'" . $feld . "'"),
        'Das Anfragefeld `' . $feld . '` wird ausserhalb von request.php nirgends gelesen. '
        . 'Ein Feld, das der Vertrag zeigt und der Server annimmt, ohne dass es wirkt, ist '
        . 'schlimmer als ein fehlendes -- siehe Meldung #93.');
}

// ---- 6. `via` ist gebaut, nicht mehr abgelehnt ---------------------------------------------------
// 🪤 Bis zum 25.08.2026 zeigte der Vertrag `via` in BEIDEN Beispielanfragen, waehrend der Server
// jede nicht-leere Liste mit 400 zurueckwies. Abschnitt 1 sah das nie: das Feld war ja dokumentiert.
// ⚠️ Gesucht wird der CODE, nicht das Wort: die Begruendung in response.php nennt die alte Absage
// weiterhin, und das soll sie auch -- sie erklaert, warum es sie nicht mehr gibt.
assert(!str_contains($wirkungsQuellen, 'AvesmapsRouteViaNotSupportedException'),
    'die Ausnahmeklasse ist raus -- die Bedingung gibt es nicht mehr');
assert(!str_contains($wirkungsQuellen, "'via_not_supported'"),
    'und der Fehlercode wird nirgends mehr gesendet');
$mitVia = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'via' => ['Hartsteen']]);
assert($mitVia['via'] === ['Hartsteen'], 'ein Zwischenort ueberlebt die Normalisierung');
assert(str_contains($readme, 'Intermediate stops'), 'und der Vertrag erklaert ihn');

echo "request-contract-test: all asserts passed\n";
