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

echo "request-contract-test: all asserts passed\n";
