<?php

declare(strict_types=1);

// DER BACH IST EIN HINDERNIS: EIN FESTER PREIS JE QUERUNG, KEIN AUFSCHLAG JE ZELLE.
//
// 🔴 Owner 31.08.2026: „ich will dass der bach ein hindernis ist / er geht aber nicht drumrum /
// sondern durch" -- und auf die Rueckfrage: „Querungs-Aufschlag", „wie 15 Meilen Gelaende".
//
// 💣 WARUM DER ZELL-AUFSCHLAG DAS NIE KONNTE, gemessen am 31.08.2026: er ist ein Faktor PRO ZELLE,
// und ein Bach ist eine Zelle breit. Sein Gesamtbeitrag ist damit an die Zellbreite gefesselt,
// waehrend der Umweg mit der Geometrie waechst. Selbst bei gesaettigter Furt (10,2) kostete eine
// Querung nur +2,72 Zeit -- genug fuer rund 4,6 Karteneinheiten Umweg und keinen Meter mehr, bei
// JEDEM Stroemungsfaktor. Ein Bach, um den man 10 Einheiten herumlaufen muesste, wurde immer
// durchwatet.
//
// 🔴 DER PREIS WIRD HALBIERT AN DER KANTE GEZAHLT -- beim Hinein UND beim Hinaus. Nur beim Betreten
// zu zahlen waere eine ASYMMETRISCHE Kante (A->B teuer, B->A gratis), und genau davor warnt der
// Kommentar an der Schrittkosten-Stelle: das bricht die Konsistenz des A*, nicht bloss seine Zahlen.
// Halb/halb ergibt in Summe genau eine Querung und ist richtungsunabhaengig.
//
// ⭐ ER WIRKT IN BEIDEN MODI, ohne dass die Hausregel angefasst wird: der Aufschlag ist kein
// FAKTOR, also fasst ihn die „Kuerzeste"-Neutralisierung ($slopeFactor/$groundFactor = 1.0) nicht
// an. Wald und Sumpf bleiben dort neutral wie bisher, Wasser nicht -- und das war es auch vorher
// schon, die Wand sperrt seit jeher in beiden Modi.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/bach-querung-hindernis-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../offroad-data.php';
require_once __DIR__ . '/../offroad-leg.php';

// =================================================================================================
// A. Die Zahl ist die des Owners -- und sie steht in KARTENEINHEITEN, nicht in Meilen
// =================================================================================================
assert(defined('AVESMAPS_ROUTE_OFFROAD_BACH_CROSSING_UNITS'), 'der Querungspreis hat einen Namen');
// 15 Meilen bei AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT Meilen je Einheit.
assert(abs(AVESMAPS_ROUTE_OFFROAD_BACH_CROSSING_UNITS * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT - 15.0) < 1e-9,
    'eine Querung kostet bei Vorgabe-Stroemung wie 15 Meilen Gelaende, gemessen: '
    . (AVESMAPS_ROUTE_OFFROAD_BACH_CROSSING_UNITS * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT));

// =================================================================================================
// B. Der Querungsfaktor: 1,0 bei Vorgabe, und er folgt der Stroemung
// =================================================================================================
$bach = static fn(?float $s, array $linie, string $dir = 'forward'): array => [
    'subtype' => 'Flussweg',
    'flow' => $s === null ? ['dir' => $dir] : ['dir' => $dir, 'factor' => $s],
    'properties' => ['is_bach' => true],
    'geometry' => ['coordinates' => $linie],
];
$faktor = static function (?float $s) use ($bach): float {
    $r = avesmapsCollectRouteRiverBarrierLines([$bach($s, [[0.0, 0.0], [1.0, 1.0]])]);

    return (float) $r['furt'][0]['faktor'];
};
assert(abs($faktor(2.0) - 1.0) < 1e-9, 'Vorgabe-Stroemung 2,0 ist der Anker: Faktor 1,0');
assert(abs($faktor(null) - 1.0) < 1e-9, 'ohne eigenen Faktor ebenso');
assert(abs($faktor(4.0) - 2.0) < 1e-9, 'doppelte Stroemung, doppelter Preis');
assert(abs($faktor(6.0) - 3.0) < 1e-9, 'dreifache Stroemung, dreifacher Preis');
assert(abs($faktor(1.0) - 0.5) < 1e-9, 'ein ruhiger Bach kostet die Haelfte');
// 🔴 Ohne Fliessrichtung gilt der Anker -- die sichere Richtung (lieber zu teuer als gratis).
assert(abs((float) avesmapsCollectRouteRiverBarrierLines(
    [$bach(6.0, [[0.0, 0.0], [1.0, 1.0]], '')])['furt'][0]['faktor'] - 1.0) < 1e-9,
    'ohne Fliessrichtung faellt der Querungsfaktor auf den Anker');

// =================================================================================================
// C. DIE FIXTURE -- und ihr Umweg ist NACHGEWIESEN, nicht behauptet
// =================================================================================================
// 💣 Der erste Messversuch am 31.08.2026 hatte eine Kiste, in der schon die WAND absagte: es gab gar
// keinen Weg herum, der Suchlauf hat nie gewaehlt, und jede Zahl daraus war wertlos. Deshalb wird
// der Umweg hier zuerst mit einer Wand erzwungen und vermessen.
$linie = [[10.0, -200.0], [10.0, 4.0]];   // senkrechter Bach, Kopf bei y = 4
$tempo = 2.30;

$lauf = static function (array $gewaesser, bool $strecke) use ($tempo): ?array {
    $box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 0.0);
    $keinWasser = avesmapsPrepareRouteAreas([]);
    $e = avesmapsOffroadBuildPlanes($box, $keinWasser, null, $gewaesser, false);
    $gerade = $strecke
        ? avesmapsOffroadStraightPathIfDry($box, $keinWasser, $e['factors'], $e['heights'], $tempo,
            0.0, 0.0, 20.0, 0.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $e['rasters'], $e['wand'],
            $e['furtlinien'])
        : null;
    $p = $gerade ?? avesmapsOffroadFindPath($box, $e['blocked'], $e['factors'], $e['heights'], $tempo,
        0.0, 0.0, 20.0, 0.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $e['rasters'], $strecke,
        $e['furtplane']);
    if ($p === null) { return null; }
    $maxY = 0.0;
    foreach ($p['points'] ?? [] as $pt) { $maxY = max($maxY, (float) $pt[1]); }
    $p['herum'] = $maxY >= 4.0;

    return $p;
};

$ohne = $lauf(['wand' => [], 'furt' => []], false);
$wand = $lauf(['wand' => [$linie], 'furt' => []], false);
assert($ohne !== null && $wand !== null, 'die Fixture traegt BEIDE Faelle -- sonst misst sie nichts');
assert($wand['herum'], 'die Wand fuehrt nachweislich HERUM -- ein Umweg existiert also');
$umwegKosten = (float) $wand['distance'] - (float) $ohne['distance'];
assert($umwegKosten > 3.0 && $umwegKosten < 5.0,
    'und er kostet rund 4 Einheiten: ' . $umwegKosten);

// =================================================================================================
// D. DAS KERNVERSPRECHEN: der Bach lenkt -- in BEIDEN Modi
// =================================================================================================
// Der Preis bei Vorgabe-Stroemung (5,0 Einheiten) ist teurer als der Umweg (~3,96) -> HERUM.
// Ein ruhiger Bach (Faktor 0,5 -> 2,5 Einheiten) ist billiger als der Umweg -> DURCH.
// 🔴 Genau dieses Paar ist der Beweis, dass der Preis WIRKLICH ordnet und nicht nur draufaddiert.
foreach ([['KUERZESTE', true], ['SCHNELLSTE', false]] as [$name, $strecke]) {
    $vorgabe = $lauf(avesmapsCollectRouteRiverBarrierLines([$bach(null, $linie)]) + ['wand' => []], $strecke);
    assert($vorgabe !== null && $vorgabe['herum'],
        $name . ': ein Bach auf Vorgabe-Stroemung wird UMGANGEN');

    $ruhig = $lauf(avesmapsCollectRouteRiverBarrierLines([$bach(1.0, $linie)]) + ['wand' => []], $strecke);
    assert($ruhig !== null && !$ruhig['herum'],
        $name . ': ein ruhiger Bach (halber Preis) wird durchwatet -- der Preis ist keine Wand');

    $stark = $lauf(avesmapsCollectRouteRiverBarrierLines([$bach(6.0, $linie)]) + ['wand' => []], $strecke);
    assert($stark !== null && $stark['herum'], $name . ': ein starker erst recht');
}

// =================================================================================================
// E. Die gemeldete ZEIT traegt den Preis -- sonst lenkt er, ohne sich zu zeigen
// =================================================================================================
$durch = $lauf(avesmapsCollectRouteRiverBarrierLines([$bach(1.0, $linie)]) + ['wand' => []], false);
// Eine Querung bei Faktor 0,5 kostet 0,5 x CROSSING_UNITS Einheiten.
$preis = (AVESMAPS_ROUTE_OFFROAD_BACH_CROSSING_UNITS * 0.5) / $tempo;
$aufschlag = (float) $durch['time'] - (float) $ohne['time'];
// ⚠️ GESPANNE STATT PUNKTLANDUNG, und der Grund gehoert dokumentiert: gezaehlt werden RASTERKANTEN.
// Die Messung tastet die vereinfachte Linie neu ab und kann das Furtband anders durchstossen als der
// Suchlauf es tat -- eine schraege Querung beruehrt mehr Bandzellen als eine gerade. Der Aufschlag
// ist damit mindestens eine Querung und hoechstens gut zwei; eine exakte Zahl hier waere eine
// Scheingenauigkeit, die beim naechsten Zellmass umfaellt.
assert($aufschlag > $preis * 0.9,
    'die durchwatende Etappe meldet mindestens eine Querung: ' . $aufschlag . ' gegen ' . $preis);
assert($aufschlag < $preis * 2.5,
    'und nicht ein Vielfaches davon: ' . $aufschlag . ' gegen ' . $preis);
// 🔴 Die Gegenprobe, ohne die das oben auch von Rauschen erfuellt waere: OHNE Bach ist er null.
assert(abs((float) $lauf(['wand' => [], 'furt' => []], false)['time'] - (float) $ohne['time']) < 1e-9,
    'ohne Bach traegt dieselbe Etappe keinen Aufschlag');
// 💣 Und die STRECKE bleibt unangetastet -- wer den Preis in die Laenge legte, loege auf der Karte.
assert(abs((float) $durch['distance'] - (float) $ohne['distance']) < 0.5,
    'die Strecke traegt ihn NICHT: ' . $durch['distance'] . ' gegen ' . $ohne['distance']);

// =================================================================================================
// F. Die Gerade-Abkuerzung umgeht das Ganze nicht mehr
// =================================================================================================
// 💣 Sie fragte nur die WAND-Linien und nahm die Gerade, bevor der A* ueberhaupt lief -- genau das
// zeigte das Bild des Owners: eine schnurgerade Linie quer durch den Bach.
$box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 0.0);
$keinWasser = avesmapsPrepareRouteAreas([]);
$g = avesmapsCollectRouteRiverBarrierLines([$bach(null, $linie)]);
$e = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => $g['furt']], false);
$gerade = avesmapsOffroadStraightPathIfDry($box, $keinWasser, $e['factors'], $e['heights'], $tempo,
    0.0, 0.0, 20.0, 0.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $e['rasters'], $e['wand'], $e['furtlinien']);
assert($gerade === null, 'quert die Gerade eine Furt, wird sie verworfen -- danach entscheidet der A*');
// ⚠️ Ohne Furt bleibt sie selbstverstaendlich erhalten.
$e2 = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => []], false);
assert(avesmapsOffroadStraightPathIfDry($box, $keinWasser, $e2['factors'], $e2['heights'], $tempo,
    0.0, 0.0, 20.0, 0.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $e2['rasters'], $e2['wand'], $e2['furtlinien']) !== null,
    'ohne Furt nimmt der Streckenmodus weiterhin die Gerade');

fwrite(STDOUT, "bach-querung-hindernis-test: OK\n");
