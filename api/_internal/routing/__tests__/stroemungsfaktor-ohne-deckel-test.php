<?php

declare(strict_types=1);

// DER STROEMUNGSFAKTOR HAT KEINEN OBEREN RIEGEL MEHR.
//
// 🔴 Owner 31.08.2026, an einem Bildschirmfoto des Dialogs „Weg bearbeiten" („Wert muss kleiner
// als oder gleich 3 sein"): „kannst du hier das limit deaktivieren" -- und auf die Rueckfrage nach
// der neuen Obergrenze: „ganz weg, nur noch >= 1".
//
// 💣 DER RIEGEL STAND AN VIER STELLEN, und drei davon waren fest verdrahtete Literale, keine
// Verweise auf die Konstante:
//   1. index.html          `max="3"` am Eingabefeld  (die Meldung im Bildschirmfoto)
//   2. path-flow.php       AVESMAPS_PATH_FLOW_FACTOR_MAX  (machte aus der eingetippten 4 die
//                          Rueckmeldung „Stroemungsfaktor 3.0 uebernommen")
//   3. client-graph.php    min(3.0, ...) im Router
//   4. route-graph-routing.js  Math.min(3.0, ...) im Browser
// Wer nur die Konstante anhebt, laesst zwei stille Klemmen stehen: das Formular nimmt den Wert an,
// die Reisezeit folgt ihm nicht, und von aussen sieht das wie ein kaputtes Speichern aus.
//
// 🔴 DIE UNTERGRENZE 1,0 BLEIBT. Darunter waere flussaufwaerts SCHNELLER als flussabwaerts -- das
// ist keine Einstellung, das ist ein Vorzeichenfehler.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/stroemungsfaktor-ohne-deckel-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../../wiki/path-flow.php';
require_once __DIR__ . '/../client-graph.php';
require_once __DIR__ . '/../offroad-grid.php';

// =================================================================================================
// A. Der Schreibweg (Wiki-Bibliothek) laesst hohe Werte durch
// =================================================================================================
assert(avesmapsPathFlowClampFactor(4.0) === 4.0, 'die 4 aus dem Bildschirmfoto ueberlebt');
assert(avesmapsPathFlowClampFactor(12.5) === 12.5, 'und auch ein sehr hoher Wert');
assert(avesmapsPathFlowClampFactor(1.0) === 1.0, 'die Untergrenze selbst bleibt gueltig');
assert(avesmapsPathFlowClampFactor(0.4) === 1.0, 'darunter wird auf 1,0 gehoben, nicht durchgelassen');
assert(avesmapsPathFlowClampFactor(-3.0) === 1.0, 'auch negativ');
assert(avesmapsPathFlowClampFactor(NAN) === AVESMAPS_PATH_FLOW_FACTOR_DEFAULT, 'NAN faellt auf die Vorgabe');
assert(avesmapsPathFlowClampFactor(INF) === AVESMAPS_PATH_FLOW_FACTOR_DEFAULT, 'INF ebenso -- is_finite haelt');

// =================================================================================================
// B. Der Router klemmt nicht mehr nach oben -- sonst folgt die Reisezeit dem Wert nicht
// =================================================================================================
$flow = static fn(float $f): array => avesmapsRouteClientNormalizeFlow(
    ['flow' => ['dir' => 'forward', 'factor' => $f]], 'Flussweg');
assert(abs($flow(4.0)['factor'] - 4.0) < 1e-9, 'der Router reicht die 4 durch');
assert(abs($flow(12.5)['factor'] - 12.5) < 1e-9, 'und auch mehr');
assert(abs($flow(0.5)['factor'] - 1.0) < 1e-9, 'nach unten haelt er weiterhin bei 1,0');

// =================================================================================================
// C. Die Furt saettigt SICHTBAR, nicht still
// =================================================================================================
// 💣 Die Faktor-Ebene ist EIN BYTE je Zelle bei Skala 25 -- darstellbar ist hoechstens 255/25 =
// 10,2. Ohne ausdruecklichen Deckel wuerde ein hoher Stroemungsfaktor beim Rastern lautlos
// abgeschnitten: die Furt waere ab einem bestimmten Wert einfach nicht mehr teurer, und niemand
// saehe warum. Der Deckel steht deshalb als benannte Konstante da und wird hier gemessen.
assert(defined('AVESMAPS_ROUTE_OFFROAD_FURT_MAX'), 'die Saettigung hat einen Namen');
assert(abs(AVESMAPS_ROUTE_OFFROAD_FURT_MAX - 255.0 / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE) < 1e-9,
    'und sie IST der Bytedeckel, keine zweite Zahl daneben');

$furt = static function (float $stroemung): float {
    $r = avesmapsCollectRouteRiverBarrierLines([[
        'subtype' => 'Flussweg',
        'flow' => ['dir' => 'forward', 'factor' => $stroemung],
        'properties' => ['is_bach' => true],
        'geometry' => ['coordinates' => [[0.0, 0.0], [1.0, 1.0]]],
    ]]);

    return (float) $r['furt'][0]['faktor'];
};

// Unterhalb der Saettigung gilt die Kopplung unveraendert weiter.
assert(abs($furt(4.0) - 6.0) < 1e-9, 'Stroemung 4,0 ergibt Furt 6,0 (1,5 x)');
assert(abs($furt(6.0) - 9.0) < 1e-9, 'Stroemung 6,0 ergibt 9,0');
// Und darueber steht der Deckel -- gemessen, nicht behauptet.
assert(abs($furt(20.0) - AVESMAPS_ROUTE_OFFROAD_FURT_MAX) < 1e-9,
    'sehr starke Stroemung saettigt bei ' . AVESMAPS_ROUTE_OFFROAD_FURT_MAX . ', gemessen: ' . $furt(20.0));
// ⚠️ Der Uebergang liegt bei Stroemung 6,8; knapp darunter darf noch NICHTS gedeckelt sein.
assert($furt(6.7) < AVESMAPS_ROUTE_OFFROAD_FURT_MAX, 'knapp unter dem Uebergang wirkt die Kopplung voll');

// =================================================================================================
// D. Kein Literal 3.0 mehr in den zwei Spiegeln
// =================================================================================================
// 🪤 Kommentare duerfen die alte Zahl nennen (die Geschichte gehoert dokumentiert); geprueft wird
// nur der CODE. Ohne das Strippen schlaegt die Zusicherung an der Warnung an, die vor ihr warnt.
$ohneKommentare = static function (string $text): string {
    $text = (string) preg_replace('~/\*.*?\*/~s', '', $text);
    $zeilen = preg_split('~\R~', $text) ?: [];

    return implode("\n", array_filter($zeilen, static fn(string $z): bool => !str_starts_with(trim($z), '//')));
};
$lies = static fn(string $rel): string => (string) file_get_contents(__DIR__ . '/../../../../' . $rel);

$router = $ohneKommentare($lies('api/_internal/routing/client-graph.php'));
assert(!str_contains($router, 'min(3.0'), 'der Router hat kein hartes min(3.0 mehr');
$browser = $ohneKommentare($lies('js/routing/route-graph-routing.js'));
assert(!str_contains($browser, 'Math.min(3.0'), 'der Browser ebenso wenig');
$markup = $ohneKommentare($lies('index.html'));
assert(preg_match('~id="path-flow-factor"[^>]*max="~', $markup) !== 1,
    'das Eingabefeld traegt kein max mehr -- sonst meldet der Browser weiter „kleiner als oder gleich 3"');
assert(preg_match('~id="path-flow-factor"[^>]*min="1"~', $markup) === 1,
    'die Untergrenze steht weiterhin am Feld');

// =================================================================================================
// E. 🪤 DIE SIEBTE KLEMME -- und warum die Suche sie zuerst verfehlt hat
// =================================================================================================
// 💣 Sie stand in js/review/review-path-flow.js als `Math.min(3, ...)` -- OHNE Nachkomma. Das
// Inventar suchte `min(3.0` und fand sie deshalb nicht; live blieb damit die ANZEIGE geklemmt: der
// Server speicherte den eingestellten Wert, das Feld zeigte hoechstens 3,0, und fuer den Editor sah
// es aus, als wuerde seine Eingabe zurueckgesetzt.
// ⭐ Die Lehre steckt im MUSTER: gesucht wird jetzt schreibweisenunabhaengig (3, 3.0, 3.00) und ueber
// ALLE Dateien, die den Faktor anfassen. Ein Suchmuster, das eine Schreibweise voraussetzt, findet
// die andere nie -- dieselbe Falle wie beim Zoomband-Inventar (AGENTS.md §11).
$klemmenMuster = '~(?:Math\\.)?min\\(\\s*3(?:\\.0+)?\\s*,~';
foreach ([
    'js/review/review-path-flow.js',
    'js/routing/route-node.js',
    'js/routing/route-graph-routing.js',
    'api/_internal/routing/client-graph.php',
    'api/_internal/wiki/path-flow.php',
] as $datei) {
    $quelle = $ohneKommentare($lies($datei));
    assert(preg_match($klemmenMuster, $quelle) !== 1,
        $datei . ' klemmt den Stroemungsfaktor wieder auf 3 -- in irgendeiner Schreibweise');
}

fwrite(STDOUT, "stroemungsfaktor-ohne-deckel-test: OK\n");
