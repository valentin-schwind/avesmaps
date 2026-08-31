<?php

declare(strict_types=1);

// V14: the cross-country A*. One calculator, two callers -- „Hierher reisen" (right click) and, later,
// the automatic detour trigger.
// Spec: docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md §5, whose first half was
// already designed AND MEASURED in V11 §10. Nothing here is derived anew; it is that entry taken over.
//
// PURITY CONTRACT: side-effect-free on include. Everything in this file is pure -- no PDO, no I/O.
// The two things that need the database (the water/land areas and the height rasters) are handed in
// already loaded, by land-areas.php, water-areas.php and heightmap-box.php.
//
// 💣 THE GRID IS NEVER A PHP ARRAY. Measured 33,2 bytes per cell as integers against 1 byte as a
// binary string: 568.000 cells are 18 MB one way and 0,5 MB the other (V11 §10.2). Every plane below
// is a string, read with $s[$i] and written with $s[$i] = chr(...).

require_once __DIR__ . '/land-areas.php';
// Fuer avesmapsGetRouteTransportType (die Flussweg-Erkennung). network-data.php verlangt nichts --
// ein Blatt, kein Zirkel.
require_once __DIR__ . '/network-data.php';
// 🔴 WEGEN avesmapsRouteClientNormalizeFlow: die Furt kostet seit dem 31.08.2026 nach der
// Stroemung, und die Klemme [1,0 ... 3,0] samt Vorgabe 2,0 soll NICHT ein drittes Mal
// abgeschrieben werden (sie steht schon zweimal -- in der Wiki-Bibliothek und als deren
// bewusster Spiegel in client-graph.php). ⚠️ Kein Kreis: client-graph.php zieht offroad-* nicht.
require_once __DIR__ . '/client-graph.php';
require_once __DIR__ . '/terrain-factor.php';
require_once __DIR__ . '/../app/heightmap.php';

// ============================================================ the screws the owner may turn

// Cell width in map units. 0,5 units = 1.500 Schritt.
//
// 🔴 THE SEEN DECIDE THIS, NOT THE GEBIRGE. Measured narrowest bbox side per kind: Meer p50 129,9,
// Gebirge 26,4, Wald 15,0 -- and See 1,6, with 24 of 296 narrower than a single cell at 1,0. Since a
// touched cell counts as water, a 1 km wide lake would become a 3 km wall and a 60 km detour. At 0,5
// the typical lake is three cells wide and keeps its shape.
const AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS = 0.5;

// 💣 LOAD-BEARING FOR „Hierher reisen", where the boxes are large: air line from an arbitrary map
// point to the nearest named place is p50 39,5 / p90 157,8 / max 290 units -- p50 10.600 cells and
// max 568.000 (V11 §10.1). At 568.000 a MINIMAL A* already measured 816 ms, and the real one adds a
// height read, the curve, a terrain byte and a multiplication per relaxation (3-5x), with STRATO
// shared hosting another 2-3x on top: 5 to 12 seconds. Over the cap the code coarsens FOR THIS ONE
// REQUEST and writes the width it actually used into the answer.
const AVESMAPS_ROUTE_OFFROAD_CELL_LIMIT = 150000;

// The box is the bbox of the two points plus a margin, so the way may bulge out around an obstacle.
const AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_FRACTION = 0.30;
const AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_MIN = 2.0;

// ⚠️ 0,10 AND NOT MORE. Measured over the four reference cases it turns 15/13/21/34 raw grid points
// into 4/5/10/6 at a length change of 0,00 %. At 0,25 the line already shortens by 1,2-1,9 % -- and
// the length IS a travel time, so it may not shrink because the drawing gets prettier.
const AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS = 0.10;

// Factors are carried as one byte per cell at this scale: 2,20 -> 55. The cap is 255 / scale.
//
// 💣 25 UND NICHT 50, seit dem 14.08.2026 (Entwurf 2026-08-07-tempowerte-design.md §7). Seit die
// Ebene den Multiplikator „Basis ÷ terrain_speed_factor" traegt, ist der groesste Wert nicht mehr
// der gesaete offroad_factor 3,00, sondern der Sumpf: 0,75 ÷ 0,10 = 7,50. Bei Maszstab 50 liegt der
// Deckel bei 5,10 -- der Sumpf waere still gedeckelt und damit 32 % zu schnell, ohne Fehler und ohne
// Warnung. Bei 25 liegt er bei 10,20, die Aufloesung bleibt 0,04.
// ⚠️ Der Maszstab wird NICHT weiter gesenkt „fuer alle Faelle": ein Byte je Zelle ist die ganze
// Sparsamkeit dieser Ebene, und jede Halbierung halbiert die Aufloesung mit.
// Bewacht von __tests__/terrain-speed-factor-test.php (Abschnitt A).
const AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE = 25.0;

// Der Aufschlag fuer das Queren eines BACHS. Ein Bach ist seit dem 30.08.2026 ein `Flussweg` mit
// `properties.is_bach` -- er bleibt ein Hindernis, aber er ist keine Wand mehr.
//
// 🔴 3,0, UND ES IST EIN EINGEFRORENER WERT. Owner 30.08.2026, woertlich: „ja ein bach wird
// ueberquert werden koennen, aber nur mit etwas erschwernis, ich wollte aber nicht, dass du ihn
// komplett aus der hinternis erkennung rausnimmst." Ausdruecklich KEIN Regler: das Fenster
// „Tempowerte" beschreibt Reisemittel und Untergruende, ein Bach ist weder das eine noch das andere.
// ⭐ Die Einordnung, damit die Zahl nicht beliebig aussieht: eine Zelle ist
// AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS = 0,5 Karteneinheiten = 1,5 Meilen breit, das Queren kostet
// also so viel Zeit wie 4,5 Meilen offenes Gelaende -- 3 Meilen MEHR, als der Reisende dort ohnehin
// bezahlt haette. Zum Vergleich traegt das Gebirge in der Faktorebene rund 3,75 (0,75 ÷ 0,20) --
// aber ueber seine ganze Ausdehnung. Der Bach ist ein kurzer, harter Schritt, kein Band.
// ⭐ Gemessen am 30.08.2026 an der Fixture von __tests__/bach-furt-test.php: eine Gelaendeetappe
// von 30,11 Einheiten (rund 90 Meilen), die genau EINEN Bach quert, wird um 3,3 % teurer -- das
// entspricht 4,6 Meilen offenen Gelaendes (der Laengenaufschlag der Etappe steckt darin).
// ⚠️ Er wirkt NUR unter „Schnellste". Unter „Kuerzeste" ist das Gewicht die Strecke, und dort sind
// Boden und Steigung von jeher neutralisiert (siehe avesmapsOffroadFindPath) -- Wald, Sumpf und
// Gebirge bremsen dort ebenso wenig. Das ist die Hausregel und kein Versehen.
const AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR = 3.0;

// 🔴 DIE STROEMUNG, BEI DER EINE FURT GENAU AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR KOSTET.
// Owner 31.08.2026: „die gewichtung der schwierigkeit der ueberquerung der furt an den
// stroemungsfaktor gekoppelt, 3-fache stroemung = 3-fache kosten" -- und auf die Rueckfrage nach
// dem Anker: der Vorgabe-Bach soll bleiben, was er war. Daraus wird
//     furt = BACH_FACTOR * stroemung / BACH_FLOW_ANKER   (= 1,5 x Stroemung)
// ⚠️ Live gemessen am 31.08.2026: 49 Baeche, KEINER mit eigenem `flow.factor`. Mit dem Anker 2,0
// aendert sich damit an keiner Route etwas -- die Kopplung greift erst, wenn ein Editor an einem
// Bach dreht. Ein Anker von 1,0 haette jede Gelaenderoute mit Bach sofort verbilligt.
// 💣 EIGENE KONSTANTE, KEIN VERWEIS AUF AVESMAPS_PATH_FLOW_FACTOR_DEFAULT (dessen Wert sie heute
// teilt). Die zwei bedeuten Verschiedenes: jener ist „welche Stroemung nehmen wir an, wenn keine
// eingetragen ist", diese ist „bei welcher Stroemung kostet eine Furt den Grundwert". Zoege jemand
// die Vorgabe auf 2,5, waere die Furt sonst still um ein Viertel teurer geworden.
const AVESMAPS_ROUTE_OFFROAD_BACH_FLOW_ANKER = 2.0;

// 🔴 DIE SAETTIGUNG DER FURT, ALS ZAHL STATT ALS NEBENWIRKUNG. Die Faktor-Ebene ist EIN BYTE je
// Zelle bei AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE -- darstellbar ist hoechstens 255/Skala = 10,2.
// Solange der Stroemungsfaktor bei 3,0 geklemmt war, konnte die Furt (1,5 x Stroemung) diesen Wert
// gar nicht erreichen; seit dem 31.08.2026 hat der Faktor keinen oberen Riegel mehr, und ab
// Stroemung 6,8 wuerde beim Rastern lautlos abgeschnitten.
// 💣 STILL WAERE ES GENAU DIE SORTE FEHLER, DIE MAN NIE FINDET: die Furt hoerte einfach auf,
// teurer zu werden, und niemand saehe warum. Deshalb ein NAME und eine gemessene Zusicherung
// (stroemungsfaktor-ohne-deckel-test.php) statt eines Ueberlaufs im Byte.
const AVESMAPS_ROUTE_OFFROAD_FURT_MAX = 255.0 / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE;

/**
 * PURE: der Furt-Aufschlag EINES Bachs, aus seiner Stroemung.
 *
 * 💣 DIE KLEMME KOMMT AUS DEM VORHANDENEN LESER. `avesmapsRouteClientNormalizeFlow` haelt
 * [1,0 ... 3,0] und die Vorgabe 2,0; eine eigene Rechnung hier waere die dritte Fassung derselben
 * Regel und liefe beim ersten Dreh an einer der anderen auseinander.
 * 🔴 OHNE FLIESSRICHTUNG GILT DER ANKER, nicht „keine Erschwernis": der Leser gibt dort `null`
 * zurueck, und die sichere Richtung ist eine Furt zu teuer statt eines Bachs, den man gratis
 * durchwatet.
 * ⚠️ EINE ZAHL, ZWEI ROLLEN (Owner: „passt so, eine zahl genuegt"): `flow.factor` heisst im Editor
 * „Stroemungsfaktor (flussaufwaerts x)" und sagte bisher nur, wie viel langsamer man GEGEN die
 * Stroemung faehrt. Er sagt jetzt zusaetzlich, wie schwer man quer hindurchkommt.
 */
function avesmapsOffroadFurtFaktor(array $path): float
{
    $flow = avesmapsRouteClientNormalizeFlow($path, (string) ($path['subtype'] ?? ''));
    $stroemung = is_array($flow) && isset($flow['factor'])
        ? (float) $flow['factor']
        : AVESMAPS_ROUTE_OFFROAD_BACH_FLOW_ANKER;

    $furt = AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR * $stroemung / AVESMAPS_ROUTE_OFFROAD_BACH_FLOW_ANKER;

    return min($furt, AVESMAPS_ROUTE_OFFROAD_FURT_MAX);
}

// 16 bit per cell, and the value IS the height in Schritt (V11 §3.2: no white point, no scaling).
// 💣 65535 means „NO DATA", not „very high". `null` and `0` are different things all the way through
// this house -- 0 is measured level ground, and the largest real height is ~15.000 Schritt.
const AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN = 65535;

// ============================================================ 1. the box

/**
 * PURE: the search box for two points -- bbox plus margin, snapped to whole cells.
 *
 * Over the cell cap the width DOUBLES until the box fits, so the width reported back to the caller
 * is always a clean multiple of the configured one.
 */
function avesmapsBuildOffroadBox(
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $cell = AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS,
    int $cellLimit = AVESMAPS_ROUTE_OFFROAD_CELL_LIMIT
): array {
    $margin = max(AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_MIN, hypot($x2 - $x1, $y2 - $y1) * AVESMAPS_ROUTE_OFFROAD_BOX_MARGIN_FRACTION);
    $minX = min($x1, $x2) - $margin;
    $minY = min($y1, $y2) - $margin;
    $maxX = max($x1, $x2) + $margin;
    $maxY = max($y1, $y2) + $margin;

    $width = $maxX - $minX;
    $height = $maxY - $minY;
    $requested = $cell > 0.0 ? $cell : AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS;
    $cell = $requested;
    $cols = (int) ceil($width / $cell) + 1;
    $rows = (int) ceil($height / $cell) + 1;
    while ($cols * $rows > $cellLimit) {
        $cell *= 2.0;
        $cols = (int) ceil($width / $cell) + 1;
        $rows = (int) ceil($height / $cell) + 1;
    }

    return [
        'min_x' => $minX,
        'min_y' => $minY,
        'max_x' => $minX + $cols * $cell,
        'max_y' => $minY + $rows * $cell,
        'cell' => $cell,
        'cols' => $cols,
        'rows' => $rows,
        'cell_count' => $cols * $rows,
        'coarsened' => $cell > $requested,
    ];
}

/** PURE: the centre of a cell, in map units. */
function avesmapsOffroadCellCentre(array $box, int $col, int $row): array
{
    return [
        $box['min_x'] + ($col + 0.5) * $box['cell'],
        $box['min_y'] + ($row + 0.5) * $box['cell'],
    ];
}

/** PURE: the cell a map point falls into, clamped into the box. */
function avesmapsOffroadCellOf(array $box, float $x, float $y): array
{
    $col = (int) floor(($x - $box['min_x']) / $box['cell']);
    $row = (int) floor(($y - $box['min_y']) / $box['cell']);

    return [
        max(0, min($box['cols'] - 1, $col)),
        max(0, min($box['rows'] - 1, $row)),
    ];
}

// ============================================================ 2. rasterising areas into the box

/**
 * PURE: walk every cell an area touches and hand it to $mark(int $index).
 *
 * Two passes, and both are needed:
 *   * a scanline over cell CENTRES fills the interior;
 *   * a walk along every edge catches areas thinner than a cell.
 * Together they implement „a touched cell counts", which is the safe direction for an obstacle
 * (rather go round than through) and the reason 0,5 is fine for a 1,6-unit lake.
 */
function avesmapsOffroadForEachTouchedCell(array $box, array $prepared, callable $mark): void
{
    $cell = $box['cell'];
    foreach (($prepared['areas'] ?? []) as $area) {
        if ($area['min_x'] > $box['max_x'] || $area['max_x'] < $box['min_x']
            || $area['min_y'] > $box['max_y'] || $area['max_y'] < $box['min_y']) {
            continue;
        }

        // -- interior, by cell centre
        $rowFrom = max(0, (int) floor(($area['min_y'] - $box['min_y']) / $cell) - 1);
        $rowTo = min($box['rows'] - 1, (int) ceil(($area['max_y'] - $box['min_y']) / $cell) + 1);
        $colFrom = max(0, (int) floor(($area['min_x'] - $box['min_x']) / $cell) - 1);
        $colTo = min($box['cols'] - 1, (int) ceil(($area['max_x'] - $box['min_x']) / $cell) + 1);
        for ($row = $rowFrom; $row <= $rowTo; $row++) {
            $y = $box['min_y'] + ($row + 0.5) * $cell;
            for ($col = $colFrom; $col <= $colTo; $col++) {
                $x = $box['min_x'] + ($col + 0.5) * $cell;
                if (avesmapsEcosystemPointInEdges($x, $y, $area['edges'])) {
                    $mark($row * $box['cols'] + $col);
                }
            }
        }

        // -- outline, in half-cell steps, so nothing thinner than a cell slips through
        foreach ($area['edges'] as $edge) {
            [$ex1, $ey1, $ex2, $ey2] = [$edge[0], $edge[1], $edge[2], $edge[3]];
            $steps = (int) ceil(hypot($ex2 - $ex1, $ey2 - $ey1) / ($cell * 0.5));
            for ($step = 0; $step <= $steps; $step++) {
                $t = $steps === 0 ? 0.0 : $step / $steps;
                $x = $ex1 + ($ex2 - $ex1) * $t;
                $y = $ey1 + ($ey2 - $ey1) * $t;
                if ($x < $box['min_x'] || $y < $box['min_y'] || $x > $box['max_x'] || $y > $box['max_y']) {
                    continue;
                }
                [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
                $mark($row * $box['cols'] + $col);
            }
        }
    }
}

/**
 * PURE: the occupancy plane -- "\x01" where water blocks, "\x00" elsewhere.
 *
 * 💣 The water areas come from V13's loader, unchanged. There is no second notion of water in this
 * house, and building one here would be the exact mistake the sources system paid for once.
 */
function avesmapsOffroadRasteriseBlocked(array $box, array $water, array $riverLines = []): string
{
    $plane = str_repeat("\x00", $box['cell_count']);
    avesmapsOffroadForEachTouchedCell($box, $water, static function (int $index) use (&$plane): void {
        $plane[$index] = "\x01";
    });
    avesmapsOffroadRasteriseRiverLines($box, $plane, $riverLines);

    return $plane;
}

/**
 * PURE: jede von den Linien beruehrte Zelle, samt der Eckzellen des Treppenschritts.
 *
 * 🔴 DIE GEMEINSAME SCHRITTLOGIK BEIDER LINIEN-RASTERER: der WAND (Fluss, Sperrebene) und der FURT
 * (Bach, Faktorebene). Bis zum 30.08.2026 gab es nur einen Rasterer und die Logik stand einmal da.
 * Ein zweiter, von Hand abgeschriebener haette genau die Divergenz erzeugt, die dieses Haus bei den
 * Listenzeilen (sieben Rezepturen) und der Wiki-Zuweisung (sechs Fassungen) schon zweimal bezahlt
 * hat -- und sie waere hier still: die Furt wuerde einfach ein paar Zellen weniger treffen.
 *
 * 💣 JEDE BERUEHRTE ZELLE, UND DIE ECKEN DAZU. Der Suchlauf geht ueber ACHT Nachbarn. Eine schraege
 * Linie markiert eine Treppe aus Zellen, und zwischen zwei diagonal benachbarten markierten Zellen
 * schluepft er hindurch, solange die beiden Eckzellen frei bleiben. Bei der WAND macht eine einzige
 * durchlaessige Zelle an einer Flussmuendung die ganze Sperre wirkungslos; bei der FURT laeuft der
 * Schritt genau dort kostenlos vorbei, und der Aufschlag ist wirkungslos, ohne dass etwas fehlt.
 * Beide Male faellt es an genau einer Route auf.
 *
 * 💣 Die Zellbreite IST die Gewaesserbreite (0,5 Einheiten = 1,5 Meilen) -- grosszuegig fuer einen
 * Bach, knapp fuer den Grossen Fluss. Es ist EINE Regel ohne Datenfeld; ein Groessenfeld je Gewaesser
 * waere ein eigenes Vorhaben (Owner-Entscheid 15.08.2026).
 *
 * $markiere bekommt den fertigen ZELLINDEX -- die Randpruefung liegt hier, damit sie kein Aufrufer
 * vergessen kann (ein Schreibzugriff hinter dem Ende einer PHP-Zeichenkette fuellt sie stillschweigend
 * mit Leerzeichen auf, und ein Leerzeichen ist Byte 32, also Faktor 1,28).
 */
function avesmapsOffroadForEachLineCell(array $box, array $lines, callable $markiere): void
{
    if ($lines === []) { return; }
    // Schrittweite unter einer halben Zelle: so kann keine Zelle uebersprungen werden.
    $step = $box['cell'] * 0.4;
    if ($step <= 0.0) { return; }

    $zelle = static function (int $col, int $row) use ($box, $markiere): void {
        if ($col < 0 || $col >= $box['cols'] || $row < 0 || $row >= $box['rows']) { return; }
        $markiere($row * $box['cols'] + $col);
    };

    foreach ($lines as $line) {
        $count = is_array($line) ? count($line) : 0;
        for ($i = 0; $i < $count - 1; $i++) {
            $ax = (float) $line[$i][0];     $ay = (float) $line[$i][1];
            $bx = (float) $line[$i + 1][0]; $by = (float) $line[$i + 1][1];
            // Huellbox-Vorfilter: ein Fluss weit ausserhalb der Kiste kostet nichts.
            if (max($ax, $bx) < $box['min_x'] || min($ax, $bx) > $box['max_x']) { continue; }
            if (max($ay, $by) < $box['min_y'] || min($ay, $by) > $box['max_y']) { continue; }

            $length = hypot($bx - $ax, $by - $ay);
            $steps = max(1, (int) ceil($length / $step));
            $previous = null;
            for ($s = 0; $s <= $steps; $s++) {
                $t = $s / $steps;
                [$col, $row] = avesmapsOffroadCellOf($box, $ax + ($bx - $ax) * $t, $ay + ($by - $ay) * $t);
                $zelle($col, $row);
                // Die beiden Eckzellen des Treppenschritts -- ohne sie bleibt eine diagonale Luecke.
                if ($previous !== null && $previous[0] !== $col && $previous[1] !== $row) {
                    $zelle($previous[0], $row);
                    $zelle($col, $previous[1]);
                }
                $previous = [$col, $row];
            }
        }
    }
}

/**
 * Die Flusslinien in die Sperrebene -- ein Fluss ist im Gelaende eine Wand, wie Meer und See.
 *
 * 🔴 Er ist bei uns keine FLAECHE, sondern ein `Flussweg`-WEG. Deshalb steht er nicht in $water und
 * musste bis zum 15.08.2026 gar nicht ueberquert werden -- er war schlicht nicht da. Gequert wird
 * seither nur, wo ein gezeichneter Weg quert: das ist die Bruecke, und die wirkt von selbst, weil
 * Wege Graph-Kanten sind und das Gitter nie sehen.
 *
 * ⚠️ Was hier ankommt, ist die WAND-Haelfte aus avesmapsCollectRouteRiverBarrierLines. Ein Bach
 * gehoert nicht hierher, sondern in avesmapsOffroadRasteriseBachFactor.
 */
function avesmapsOffroadRasteriseRiverLines(array $box, string &$plane, array $riverLines): void
{
    avesmapsOffroadForEachLineCell($box, $riverLines, static function (int $index) use (&$plane): void {
        $plane[$index] = "\x01";
    });
}

/**
 * PURE: die Bachlinien als AUFSCHLAG in die Faktorebene -- eine Furt, keine Wand.
 *
 * 🔴 EIN BACH SPERRT NICHT, ER KOSTET (Owner 30.08.2026). Der Faktor liegt auf den beruehrten Zellen,
 * und weil der Suchlauf jeden Schritt mit `max($currentFactor, $nextFactor)` bepreist, verteuert er
 * jeden Schritt, der eine Bachzelle beruehrt -- also genau das Queren, und nur das.
 *
 * 🔴 UEBERLAGERT WIRD PER MAXIMUM, wie die drei Landschaftsebenen untereinander
 * (avesmapsOffroadCombineFactorPlanes): eine Bachzelle im Sumpf nimmt den teureren der beiden Werte.
 * ⭐ Gerechnet wird das hier auf den BERUEHRTEN Zellen statt ueber eine zweite volle Ebene und
 * avesmapsOffroadCombineFactorPlanes -- die Wirkung ist dieselbe, aber der Vergleich zweier ganzer
 * Ebenen ist eine PHP-Schleife ueber bis zu 150.000 Zellen fuer eine Handvoll Bachzellen, und das
 * dreimal je Anfrage (die drei Zusammenbau-Stellen). Auf Shared Hosting ist das der Unterschied
 * zwischen Fix und Last.
 *
 * 💣 EINE LEERE EBENE HEISST „ueberall 1,0", NICHT „keine Ebene". Ohne Landschaftsdaten kommt
 * avesmapsOffroadLoadFactorPlane mit '' zurueck; der Bach braucht trotzdem eine Ebene, in die er
 * schreiben kann, sonst waere er ausgerechnet dort wirkungslos, wo sonst nichts bremst.
 * 💣 UND EINE EBENE FALSCHER LAENGE WIRD NICHT ANGEFASST. Ein Schreibzugriff hinter dem Ende einer
 * PHP-Zeichenkette verlaengert sie mit LEERZEICHEN -- Byte 32, also Faktor 1,28 auf jeder Zelle
 * dazwischen. Das waere ein stiller Gelaendeaufschlag ueber die halbe Kiste.
 */
function avesmapsOffroadRasteriseBachFactor(array $box, string $factors, array $bachLines): string
{
    if ($bachLines === []) { return $factors; }

    // 💣 ZWEITER EINGANG, DIESELBE REGEL. Diese Funktion wird auch DIREKT gerufen (Einheitstests,
    // und wer sie sonst noch findet), nicht nur ueber avesmapsOffroadBuildPlanes. Sie normalisiert
    // deshalb selbst -- ueber DENSELBEN Leser, nicht ueber eine zweite Fassung. Eine flache
    // Punktliste bedeutet dabei den Anker, nie „kein Aufschlag".
    $bachLines = avesmapsOffroadFordLines(['furt' => $bachLines]);
    if ($bachLines === []) { return $factors; }

    $cells = (int) $box['cell_count'];
    if ($factors === '') { $factors = str_repeat("\x00", $cells); }
    if (strlen($factors) !== $cells) { return $factors; }

    // 🔴 JE LINIE IHR EIGENER WERT (seit 31.08.2026): der Aufschlag haengt an der Stroemung des
    // einzelnen Bachs, nicht mehr an einer Konstanten fuer alle. Deshalb ein Durchgang je Linie.
    // ⚠️ Der Deckel 255 ist bei Skala 25 ein Faktor von 10,2 -- die Furt reicht hoechstens bis 4,5
    // (Stroemung 3,0), er kann also nur greifen, wenn jemand an den Konstanten dreht.
    foreach ($bachLines as $linie) {
        $byte = (int) round(((float) $linie['faktor']) * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
        $byte = max(0, min(255, $byte));
        if ($byte === 0) { continue; }
        $character = chr($byte);
        avesmapsOffroadForEachLineCell($box, [$linie['coords']], static function (int $index) use (&$factors, $byte, $character): void {
            if (ord($factors[$index]) < $byte) { $factors[$index] = $character; }
        });
    }

    return $factors;
}

/**
 * PURE: ONE factor plane, one byte per cell, `chr(round(factor x SCALE))`; 0 means „nothing here".
 *
 * $layers is a list of ['prepared' => <prepared areas>, 'factor' => float]. Within ONE plane the
 * larger factor wins, which is the same maximum rule the three planes are combined by.
 */
function avesmapsOffroadRasteriseFactors(array $box, array $layers): string
{
    $plane = str_repeat("\x00", $box['cell_count']);
    foreach ($layers as $layer) {
        $prepared = is_array($layer['prepared'] ?? null) ? $layer['prepared'] : [];
        $byte = (int) round(((float) ($layer['factor'] ?? 1.0)) * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
        $byte = max(0, min(255, $byte));
        if ($byte === 0) { continue; }
        $character = chr($byte);
        avesmapsOffroadForEachTouchedCell($box, $prepared, static function (int $index) use (&$plane, $byte, $character): void {
            if (ord($plane[$index]) < $byte) { $plane[$index] = $character; }
        });
    }

    return $plane;
}

/**
 * PURE: the three kind planes into one, cell by cell, by MAXIMUM.
 *
 * 🔴 MAXIMUM, NOT PRODUCT, and this is a decision rather than an implementation detail (V11 §10.3):
 * `derographisch`, `vegetation` and `topographie` lie on top of each other, so a cell is „Kosch" AND
 * „Wald" AND „Gebirge" at once. Multiplying turns wood-in-mountains-in-a-region into a factor nobody
 * can explain afterwards.
 */
function avesmapsOffroadCombineFactorPlanes(array $planes): string
{
    $planes = array_values(array_filter($planes, static fn($plane): bool => is_string($plane) && $plane !== ''));
    if ($planes === []) { return ''; }

    $combined = array_shift($planes);
    $length = strlen($combined);
    foreach ($planes as $plane) {
        for ($index = 0; $index < $length; $index++) {
            if ($plane[$index] > $combined[$index]) { $combined[$index] = $plane[$index]; }
        }
    }

    return $combined;
}

/** PURE: the terrain factor at a map point; 1,0 where no landscape is known. */
function avesmapsOffroadFactorAt(array $box, string $plane, float $x, float $y): float
{
    if ($plane === '') { return 1.0; }
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
    $byte = ord($plane[$row * $box['cols'] + $col]);

    return $byte === 0 ? 1.0 : $byte / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE;
}

/**
 * PURE: the height plane -- 16 bit per cell, the value IS the height in Schritt.
 *
 * $rasters are already decoded (avesmapsHeightmapDecode). The sum over every raster covering a point
 * is V8's rule and the reader MUST sum: each raster holds only its own area's field, so reading „the
 * one raster that contains the point" is too low in every overlap strip and shows nothing unusual
 * doing it.
 */
function avesmapsOffroadSampleHeights(array $box, array $rasters): string
{
    $plane = str_repeat("\xFF\xFF", $box['cell_count']);
    if ($rasters === []) { return $plane; }

    // ⚠️ ONLY THE CELLS A RASTER CAN REACH. Sampling the whole box would ask every raster about
    // every cell -- at the 150.000-cell cap that is six figures of bilinear lookups to learn „no
    // data" for ground no raster covers. A raster is a mountain range; a box is a journey.
    $unionMinX = INF; $unionMinY = INF; $unionMaxX = -INF; $unionMaxY = -INF;
    foreach ($rasters as $raster) {
        $unionMinX = min($unionMinX, $raster['origin_x']);
        $unionMinY = min($unionMinY, $raster['origin_y']);
        $unionMaxX = max($unionMaxX, $raster['origin_x'] + ($raster['width'] - 1) * $raster['cell']);
        $unionMaxY = max($unionMaxY, $raster['origin_y'] + ($raster['height'] - 1) * $raster['cell']);
    }
    $rowFrom = max(0, (int) floor(($unionMinY - $box['min_y']) / $box['cell']) - 1);
    $rowTo = min($box['rows'] - 1, (int) ceil(($unionMaxY - $box['min_y']) / $box['cell']) + 1);
    $colFrom = max(0, (int) floor(($unionMinX - $box['min_x']) / $box['cell']) - 1);
    $colTo = min($box['cols'] - 1, (int) ceil(($unionMaxX - $box['min_x']) / $box['cell']) + 1);

    for ($row = $rowFrom; $row <= $rowTo; $row++) {
        $y = $box['min_y'] + ($row + 0.5) * $box['cell'];
        for ($col = $colFrom; $col <= $colTo; $col++) {
            $x = $box['min_x'] + ($col + 0.5) * $box['cell'];
            $height = avesmapsHeightmapSampleSum($rasters, $x, $y);
            if ($height === null) { continue; }
            $value = (int) round($height);
            $value = max(0, min(AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN - 1, $value));
            $offset = 2 * ($row * $box['cols'] + $col);
            $packed = pack('v', $value);
            $plane[$offset] = $packed[0];
            $plane[$offset + 1] = $packed[1];
        }
    }

    return $plane;
}

/** PURE: the height of one cell in Schritt, or null where nothing is known. */
function avesmapsOffroadHeightAtCell(?string $plane, int $index): ?float
{
    if ($plane === null || $plane === '') { return null; }
    $value = unpack('v', $plane, 2 * $index)[1];

    return $value === AVESMAPS_ROUTE_OFFROAD_HEIGHT_UNKNOWN ? null : (float) $value;
}

// ============================================================ 3. the A* itself

/**
 * PURE: the cheapest cross-country way from (x1,y1) to (x2,y2), or null when there is none.
 *
 * Cost of a step: `Strecke / Grundtempo(Querfeldein) x Steigungsfaktor x Geländefaktor` -- the V11
 * §10 formula, with the slope factor taken from the ONE place the model lives
 * (avesmapsTerrainLeistungsFactor), never recomputed here.
 *
 * ⭐ THE HEURISTIC IS SHARP, and no measurement is needed to know it. The Leistungskilometer model
 * has no floor (`terrain-factor.php:60-63`: „THERE IS NO FLOOR ANY MORE"), and the factor plane never
 * carries anything below 1,0: since 2026-08-14 it is loaded as `Basis ÷ terrain_speed_factor` with the
 * filter `terrain_speed_factor < Basis` (`offroad-data.php`), so the quotient is > 1 by construction --
 * previously the same guarantee came from `offroad_factor > 1.00`. So the smallest possible factor is
 * EXACTLY 1,0 and
 * `air line / speed` never overestimates. V14 §5.3 planned to measure the smallest occurring factor;
 * that measurement is void, because the answer is structural.
 *
 * ⚠️ Start and target cells are forced passable (§5.2). 571 of 4.653 places lie geometrically INSIDE
 * water -- without this every harbour town answers „kein Weg" before the search begins.
 *
 * Returns ['points' => [[x,y],...], 'distance' => map units, 'time' => graph cost, 'cells_opened' => int].
 * The points are STITCHED to the real endpoints and simplified; distance is measured over exactly
 * those points.
 *
 * 💣 `time` IS THE GRAPH'S COST UNIT, NOT HOURS. The whole client graph computes
 * `Strecke[Karteneinheiten] / Tempo[km/h]` (`client-graph.php:386`) -- consistent everywhere, and
 * three times smaller than real hours because one map unit is three Meilen. This function uses the
 * same convention deliberately: an edge that priced itself in hours would be three times dearer than
 * every road it competes with, and Dijkstra would refuse to use it. Reading it AS hours is the
 * Faktor-3 trap that already went live once.
 */
function avesmapsOffroadFindPath(
    array $box,
    string $blocked,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = [],
    bool $weightByDistance = false
): ?array {
    if ($speed <= 0.0) { return null; }

    $cols = $box['cols'];
    $rows = $box['rows'];
    $cell = $box['cell'];
    [$startCol, $startRow] = avesmapsOffroadCellOf($box, $x1, $y1);
    [$goalCol, $goalRow] = avesmapsOffroadCellOf($box, $x2, $y2);
    $start = $startRow * $cols + $startCol;
    $goal = $goalRow * $cols + $goalCol;

    if ($start === $goal) {
        return avesmapsOffroadFinishPath([[$x1, $y1], [$x2, $y2]], $speed, $factors, $heights, $box, $eps, 0, $rasters);
    }

    // §5.2, and it is the reason $blocked is edited by value: the freeing applies to THIS request.
    //
    // 💣 ONE CELL IS NOT ENOUGH, and finding that out is what this rule is worth. A harbour town does
    // not sit on the edge of the sea polygon, it sits INSIDE it -- freeing only its own cell leaves
    // all eight neighbours blocked and the search is trapped before its first step. Freed is
    // therefore everything within V13's COASTAL TOLERANCE of an endpoint.
    //
    // ⭐ That constant is reused rather than invented: 1,0 map unit is the measured width of coastal
    // drawing slop (V13 §9 -- at 1,0 exactly 23 bridges come back and all 23 are coastal hops, while
    // all 7 real sea crossings stay blocked). A second number here would be a second answer to the
    // same question, and the two would drift.
    avesmapsOffroadFreeAround($box, $blocked, $x1, $y1);
    avesmapsOffroadFreeAround($box, $blocked, $x2, $y2);

    $goalCentre = avesmapsOffroadCellCentre($box, $goalCol, $goalRow);
    $best = [$start => 0.0];
    $cameFrom = [];
    $closed = str_repeat("\x00", $box['cell_count']);
    $queue = new SplPriorityQueue();
    $queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);
    $queue->insert($start, 0.0);
    $opened = 0;

    // 8 neighbours as (dCol, dRow); the diagonal step is sqrt(2) cells long.
    $neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    $found = false;

    while (!$queue->isEmpty()) {
        $current = $queue->extract();
        if ($closed[$current] === "\x01") { continue; }
        $closed[$current] = "\x01";
        $opened++;
        if ($current === $goal) { $found = true; break; }

        $currentRow = intdiv($current, $cols);
        $currentCol = $current - $currentRow * $cols;
        $currentHeight = avesmapsOffroadHeightAtCell($heights, $current);
        $currentFactor = $factors === null || $factors === ''
            ? 1.0
            : (ord($factors[$current]) === 0 ? 1.0 : ord($factors[$current]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);

        foreach ($neighbours as [$deltaCol, $deltaRow]) {
            $nextCol = $currentCol + $deltaCol;
            $nextRow = $currentRow + $deltaRow;
            if ($nextCol < 0 || $nextRow < 0 || $nextCol >= $cols || $nextRow >= $rows) { continue; }
            $next = $nextRow * $cols + $nextCol;
            if ($blocked[$next] === "\x01" || $closed[$next] === "\x01") { continue; }

            $distance = ($deltaCol !== 0 && $deltaRow !== 0) ? $cell * M_SQRT2 : $cell;

            // The slope factor for this one step, from the two cell heights. Unknown on either side
            // means „no height data here" -> factor 1,0, exactly as V11 already does for ways.
            $nextHeight = avesmapsOffroadHeightAtCell($heights, $next);
            $slopeFactor = 1.0;
            if ($currentHeight !== null && $nextHeight !== null) {
                $ascent = max(0.0, $nextHeight - $currentHeight);
                $drop = max(0.0, $currentHeight - $nextHeight);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $distance) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($ascent, $steepDrop, $distance);
            }

            $nextFactor = $factors === null || $factors === ''
                ? 1.0
                : (ord($factors[$next]) === 0 ? 1.0 : ord($factors[$next]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
            // The larger of the two cells, so the cost of a step does not depend on its direction --
            // an asymmetric edge would break A*'s consistency, not just its numbers.
            $groundFactor = max($currentFactor, $nextFactor);

            // 🔴 „KUERZESTE“ HEISST: DAS GEWICHT IST DIE STRECKE. Wald, Sumpf und Gebirge bremsen,
            // sie verlaengern nicht -- auf eine Meilenzahl haben sie keinen Einfluss, also hat eine
            // kuerzeste Linie keinen Grund, ihnen auszuweichen. Nur Wasser sperrt, und das steht
            // schon in $blocked.
            //
            // 💣 NEUTRALISIERT WIRD NUR HIER, IN DER SCHLEIFE. Die Ebenen $factors/$heights/$rasters
            // fliessen unveraendert an avesmapsOffroadFinishPath weiter -- sie auf null zu setzen
            // naehme der MESSUNG das Gelaende, und die kuerzeste Etappe haette dann eine Laenge,
            // aber keine Reisezeit und keinen Anstieg (Entwurf §3.2).
            if ($weightByDistance) { $slopeFactor = 1.0; $groundFactor = 1.0; }

            $cost = ($best[$current] ?? INF) + ($distance / $speed) * $slopeFactor * $groundFactor;
            if ($cost >= ($best[$next] ?? INF)) { continue; }

            $best[$next] = $cost;
            $cameFrom[$next] = $current;
            $centre = avesmapsOffroadCellCentre($box, $nextCol, $nextRow);
            $heuristic = hypot($goalCentre[0] - $centre[0], $goalCentre[1] - $centre[1]) / $speed;
            $queue->insert($next, -($cost + $heuristic));
        }
    }

    if (!$found) { return null; }

    $cells = [];
    for ($node = $goal; $node !== $start; $node = $cameFrom[$node]) { $cells[] = $node; }
    $cells[] = $start;
    $cells = array_reverse($cells);

    $points = [];
    foreach ($cells as $node) {
        $nodeRow = intdiv($node, $cols);
        $points[] = avesmapsOffroadCellCentre($box, $node - $nodeRow * $cols, $nodeRow);
    }

    // 💣 STITCHED TO THE REAL ENDPOINTS (§5.4). A cell centre lies up to 0,35 units off the real
    // point at width 0,5; measured on Gluckenhang -> Wasserburg the raw A* reported 2,2 units against
    // an air line of 2,5 -- a way shorter than the straight line, which cannot be. Replacing the two
    // outer centres and recomputing the length over the stitched sequence is what makes every short
    // hop honest.
    $points[0] = [$x1, $y1];
    $points[count($points) - 1] = [$x2, $y2];

    return avesmapsOffroadFinishPath($points, $speed, $factors, $heights, $box, $eps, $opened, $rasters);
}

/**
 * EIN Dijkstra-Lauf vom Kartenpunkt nach aussen, der ALLE Ausstiegskandidaten bedient.
 *
 * 🔴 ER ERSETZT EINEN LAUF JE KANDIDAT. Gemessen an der Route des Owners (Salmingen ->
 * Kartenpunkt) waren das 15 Laeufe je Anfrage, die alle dasselbe Gelaende durchsuchen. Genau das
 * macht „jeder gezeichnete Punkt ist ein Kandidat" ueberhaupt bezahlbar: ein zusaetzlicher
 * Kandidat ist danach ein Nachschlagen, kein zweiter Lauf.
 *
 * 🔴 JEDER SCHRITT WIRD IN GEGENRICHTUNG BEPREIST. Der Reisende geht vom Ausstieg ZUM
 * Kartenpunkt; dieser Lauf geht vom Kartenpunkt WEG. Die Schrittkosten sind nicht symmetrisch --
 * avesmapsTerrainLeistungsFactor bestraft Steigung anders als Gefaelle. Der Anstieg eines
 * Suchschritts u->v ist deshalb `Hoehe(u) - Hoehe(v)`, nicht umgekehrt. Ohne den Tausch waehlt
 * der Lauf die guenstigste RUECKREISE. (avesmapsAddOffroadEdge behandelt denselben Tausch beim
 * Umdrehen der Kante; V11 §6.3 ist genau diese Fehlerklasse.)
 *
 * ⚠️ KEINE HEURISTIK. Ohne einzelnes Ziel gibt es keine zulaessige Schaetzung; der Lauf ist ein
 * reiner Dijkstra. Die Bremse dagegen ist der Abbruch, sobald das letzte Ziel geschlossen ist --
 * NICHT die volle Kiste. Ohne ihn laeuft er ueber bis zu 150.000 Zellen und ist langsamer als
 * die Laeufe, die er ersetzt.
 *
 * @param array $goals [$key => ['x' => float, 'y' => float], ...]
 * @return array [$key => <Pfad wie avesmapsOffroadFindPath> | null]
 */
function avesmapsOffroadFindPathsFromPoint(
    array $box,
    string $blocked,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x,
    float $y,
    array $goals,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = [],
    bool $weightByDistance = false
): array {
    $result = [];
    foreach ($goals as $key => $goal) { $result[$key] = null; }
    if ($speed <= 0.0 || $goals === []) { return $result; }

    $cols = $box['cols'];
    $rows = $box['rows'];
    $cell = $box['cell'];
    [$startCol, $startRow] = avesmapsOffroadCellOf($box, $x, $y);
    $start = $startRow * $cols + $startCol;

    // ⚠️ Freigelegt wird um den Kartenpunkt UND um jedes Ziel. Ein Ausstieg, dessen Zelle im
    // Wasserpolygon liegt (Ufer-Zeichenspiel), waere sonst von der ersten Zelle an eingemauert --
    // dieselbe Begruendung wie beim Einzellauf (§5.2).
    avesmapsOffroadFreeAround($box, $blocked, $x, $y);

    // 🔴 NUR DER KARTENPUNKT WIRD IM GEMEINSAMEN GITTER FREIGELEGT. Ein Ziel, in dessen Umkreis
    // Wasser liegt, bekommt seinen EIGENEN Lauf mit einer eigenen Kopie des Gitters -- genau wie vor
    // dem 15.08.2026, als jeder Kandidat seinen eigenen A* hatte. Sonst oeffnet die Toleranz des
    // einen Kandidaten den See fuer die Etappen aller anderen (gemessen: 14,01 statt 21,90 Einheiten
    // quer durch ein Band von 1,6 Einheiten, dem Median der Seen).
    // ⚠️ Das kostet einen zusaetzlichen Suchlauf JE NASSEM Kandidaten -- live sind das 0 bis 2 von 35.
    $goalCells = [];
    $openGoals = [];
    $isolated = [];
    foreach ($goals as $key => $goal) {
        if (avesmapsOffroadHasBlockedNear($box, $blocked, (float) $goal['x'], (float) $goal['y'])) {
            $isolated[$key] = $goal;
            continue;
        }
        [$goalCol, $goalRow] = avesmapsOffroadCellOf($box, (float) $goal['x'], (float) $goal['y']);
        $goalCell = $goalRow * $cols + $goalCol;
        $goalCells[$key] = $goalCell;
        $openGoals[$goalCell] = true;
    }

    $best = [$start => 0.0];
    $cameFrom = [];
    $closed = str_repeat("\x00", $box['cell_count']);
    $queue = new SplPriorityQueue();
    $queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);
    $queue->insert($start, 0.0);
    $opened = 0;
    if (isset($openGoals[$start])) { unset($openGoals[$start]); }
    $remaining = count($openGoals);

    // 8 Nachbarn als (dCol, dRow); der diagonale Schritt ist sqrt(2) Zellen lang.
    $neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (!$queue->isEmpty() && $remaining > 0) {
        $current = $queue->extract();
        if ($closed[$current] === "\x01") { continue; }
        $closed[$current] = "\x01";
        $opened++;
        if (isset($openGoals[$current])) { unset($openGoals[$current]); $remaining--; }

        $currentRow = intdiv($current, $cols);
        $currentCol = $current - $currentRow * $cols;
        $currentHeight = avesmapsOffroadHeightAtCell($heights, $current);
        $currentFactor = $factors === null || $factors === ''
            ? 1.0
            : (ord($factors[$current]) === 0 ? 1.0 : ord($factors[$current]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);

        foreach ($neighbours as [$deltaCol, $deltaRow]) {
            $nextCol = $currentCol + $deltaCol;
            $nextRow = $currentRow + $deltaRow;
            if ($nextCol < 0 || $nextRow < 0 || $nextCol >= $cols || $nextRow >= $rows) { continue; }
            $next = $nextRow * $cols + $nextCol;
            if ($blocked[$next] === "\x01" || $closed[$next] === "\x01") { continue; }

            $distance = ($deltaCol !== 0 && $deltaRow !== 0) ? $cell * M_SQRT2 : $cell;

            $nextHeight = avesmapsOffroadHeightAtCell($heights, $next);
            $slopeFactor = 1.0;
            if ($currentHeight !== null && $nextHeight !== null) {
                // 🔴 GEGENRICHTUNG: der Reisende geht $next -> $current.
                $ascent = max(0.0, $currentHeight - $nextHeight);
                $drop = max(0.0, $nextHeight - $currentHeight);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $distance) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($ascent, $steepDrop, $distance);
            }

            $nextFactor = $factors === null || $factors === ''
                ? 1.0
                : (ord($factors[$next]) === 0 ? 1.0 : ord($factors[$next]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
            // Der groessere der beiden Werte, damit die Kosten eines Schritts nicht von seiner
            // Richtung abhaengen -- wie beim Einzellauf.
            $groundFactor = max($currentFactor, $nextFactor);

            // 🔴 „KUERZESTE“ HEISST: DAS GEWICHT IST DIE STRECKE. Wald, Sumpf und Gebirge bremsen,
            // sie verlaengern nicht -- auf eine Meilenzahl haben sie keinen Einfluss, also hat eine
            // kuerzeste Linie keinen Grund, ihnen auszuweichen. Nur Wasser sperrt, und das steht
            // schon in $blocked.
            //
            // 💣 NEUTRALISIERT WIRD NUR HIER, IN DER SCHLEIFE. Die Ebenen $factors/$heights/$rasters
            // fliessen unveraendert an avesmapsOffroadFinishPath weiter -- sie auf null zu setzen
            // naehme der MESSUNG das Gelaende, und die kuerzeste Etappe haette dann eine Laenge,
            // aber keine Reisezeit und keinen Anstieg (Entwurf §3.2).
            if ($weightByDistance) { $slopeFactor = 1.0; $groundFactor = 1.0; }

            $cost = ($best[$current] ?? INF) + ($distance / $speed) * $slopeFactor * $groundFactor;
            if ($cost >= ($best[$next] ?? INF)) { continue; }

            $best[$next] = $cost;
            $cameFrom[$next] = $current;
            $queue->insert($next, -$cost);
        }
    }

    foreach ($goalCells as $key => $goalCell) {
        if ($goalCell !== $start && !isset($cameFrom[$goalCell])) { continue; }

        // Von der Zielzelle zurueck zum Start: die Reihenfolge ist bereits die des Reisenden.
        $cells = [];
        for ($node = $goalCell; $node !== $start; $node = $cameFrom[$node]) { $cells[] = $node; }
        $cells[] = $start;

        $points = [];
        foreach ($cells as $node) {
            $nodeRow = intdiv($node, $cols);
            $points[] = avesmapsOffroadCellCentre($box, $node - $nodeRow * $cols, $nodeRow);
        }
        if (count($points) < 2) { $points = [[0.0, 0.0], [0.0, 0.0]]; }

        // 💣 An die echten Endpunkte vernaeht (§5.4), wie beim Einzellauf: eine Zellmitte liegt bei
        // Breite 0,5 bis zu 0,35 Einheiten neben dem echten Punkt, und ohne das Vernaehen kaeme ein
        // Weg heraus, der kuerzer ist als die Luftlinie.
        $points[0] = [(float) $goals[$key]['x'], (float) $goals[$key]['y']];
        $points[count($points) - 1] = [$x, $y];

        $result[$key] = avesmapsOffroadFinishPath($points, $speed, $factors, $heights, $box, $eps, $opened, $rasters);
    }

    // Die nassen Kandidaten, jeder mit einer eigenen Gitterkopie. avesmapsOffroadFindPath legt darin
    // um SEINE beiden Endpunkte frei und wirft die Kopie danach weg -- die Toleranz bleibt lokal.
    foreach ($isolated as $key => $goal) {
        // 💣 Das Gewicht gilt auch hier. Ohne diese Weitergabe rechnete ein Kandidat am Wasser
        // weiter zeitoptimal, waehrend alle anderen streckenoptimal rechnen -- die halbe Umsetzung.
        $result[$key] = avesmapsOffroadFindPath($box, $blocked, $factors, $heights, $speed,
            (float) $goal['x'], (float) $goal['y'], $x, $y, $eps, $rasters, $weightByDistance);
    }

    return $result;
}

/**
 * PURE: simplify, then measure length AND time over exactly the line that will be shipped.
 *
 * 💣 MEASURED ALONG THE LINE, IN GRID STEPS -- not from the A*'s accumulated cost, and not from the
 * corner points alone. Two reasons, and both were found by a failing test rather than by thinking:
 *
 *   * The A*'s own cost belongs to the raw staircase, which is longer than the simplified line it is
 *     printed under. The number below a line has to be the number OF that line.
 *   * Sampling only the corner points measures nothing at all: after simplification a straight run
 *     across a ridge is TWO points, both of them off the raster, so every factor comes back 1,0 and
 *     the height silently stops acting. That is exactly what the ridge test caught.
 *
 * ⚠️ The climb is a TOTAL VARIATION and therefore depends on the sampling density -- half-cell steps
 * here, matching the resolution the search itself priced at. Same rule as V11 §5.3: one resolution
 * for everything, or the same ground yields two different ascents.
 */
function avesmapsOffroadFinishPath(array $points, float $speed, ?string $factors, ?string $heights, array $box, float $eps, int $opened, array $rasters = []): array
{
    $points = avesmapsSimplifyLineDouglasPeucker($points, $eps);

    // 🔴 EINE AUFLÖSUNG FÜR ALLES, und die steht in terrain-store.php:32. Der Anstieg ist eine TOTALE
    // VARIATION und waechst mit der Abtastdichte -- x sqrt(2) je Halbierung. Wer die Etappe im
    // Zellraster (0,5) integriert, waehrend jeder gezeichnete Weg im Rasterraster (0,25) integriert
    // wird, laesst dieselbe Flanke je nach Frager verschieden hoch aussehen -- und beide Zahlen
    // stehen im selben Reiseplan untereinander.
    //
    // ⚠️ Deshalb wird hier direkt aus den RASTERN gelesen, nicht aus der Zellebene: die kennt je
    // Zelle nur einen Wert und kann feiner gar nicht antworten. Die SUCHE darf gerne grob bleiben --
    // sie muss Wege nur ordnen --, aber die Zahl unter der Linie ist eine Aussage ueber das Gelaende
    // und gehoert in die Sprache aller anderen.
    $sampleStep = $rasters !== [] ? AVESMAPS_TERRAIN_CELL_SIZE : $box['cell'] * 0.5;
    $heightAt = $rasters !== []
        ? static fn(float $x, float $y): ?float => avesmapsHeightmapSampleSum($rasters, $x, $y)
        : static fn(float $x, float $y): ?float => avesmapsOffroadHeightAtCell($heights, avesmapsOffroadIndexOf($box, $x, $y));

    $distance = 0.0;
    $time = 0.0;
    // 💣 NULL, BIS ENTLANG DIESER LINIE WIRKLICH ETWAS GEMESSEN WURDE. Die Summen mit 0,0 zu
    // beginnen, weil ein Raster VORHANDEN ist, beantwortet die falsche Frage: „ein Raster überlappt
    // die KISTE" ist nicht „unter dieser LINIE liegen Höhendaten". Die Kiste spannt über alle
    // Ausstiegskandidaten und streift dabei Gebiete, die der Weg nie berührt -- dann meldete die
    // Etappe „gemessen und eben" über Boden, von dem nichts bekannt ist.
    //
    // ⭐ Gefunden an einem Zufallsfall (Solfurt, 2026-08-02): die Linie blieb 2,87 Einheiten nördlich
    // der Koschberge, deren Raster die Kiste streifte -- gemeldet wurden 0/0 über 12,7 km. Die
    // Rechnung stimmte (kein Steigungsfaktor angesetzt), nur die Auskunft log.
    $ascent = null;
    $descent = null;

    for ($index = 1; $index < count($points); $index++) {
        [$fromX, $fromY] = $points[$index - 1];
        [$toX, $toY] = $points[$index];
        $length = hypot($toX - $fromX, $toY - $fromY);
        if ($length <= 0.0) { continue; }
        $distance += $length;

        $steps = max(1, (int) ceil($length / $sampleStep));
        $stepLength = $length / $steps;
        $previousHeight = $heightAt($fromX, $fromY);
        for ($step = 1; $step <= $steps; $step++) {
            $t = $step / $steps;
            $x = $fromX + ($toX - $fromX) * $t;
            $y = $fromY + ($toY - $fromY) * $t;
            $height = $heightAt($x, $y);

            $slopeFactor = 1.0;
            if ($previousHeight !== null && $height !== null) {
                $climb = max(0.0, $height - $previousHeight);
                $drop = max(0.0, $previousHeight - $height);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $stepLength) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($climb, $steepDrop, $stepLength);
                // Erst hier wird aus „nichts bekannt" ein Messwert -- und ab dann summiert es.
                if ($ascent === null) { $ascent = 0.0; $descent = 0.0; }
                $ascent += $climb;
                $descent += $drop;
            }

            $groundFactor = avesmapsOffroadFactorAt($box, $factors ?? '', $x, $y);
            $time += ($stepLength / $speed) * $slopeFactor * $groundFactor;
            $previousHeight = $height;
        }
    }

    // 🔴 DER LAENGENAUFSCHLAG, UND ZWAR HIER. Dies ist der gemeinsame Abschluss ALLER
    // Querfeldein-Erzeuger -- die gesuchte Etappe, der Mehrziel-Lauf und die trockene Gerade
    // muenden alle hier hinein. Die Falle vom 14.08.2026 („die Sperre muss in jedem Erzeuger
    // einzeln stehen") galt der Pruefung VOR dem Suchlauf; der Preis kommt danach, und deshalb
    // genau einmal. Hier steht bewusst KEINE Zahl im Kommentar -- die Zahl war damals die Falle.
    //
    // ⚠️ Die SUCHE hat ohne den Aufschlag geordnet, und das ist richtig so: er haengt allein an
    // der Gesamtlaenge und ordnet zwei Wege gleicher Laenge nicht um. Ein Gewicht, das vom bereits
    // zurueckgelegten Weg abhinge, waere kein Dijkstra mehr.
    //
    // 💣 NUR DIE ZEIT. `distance` bleibt unangetastet -- wer den Aufschlag in die Laenge legte,
    // machte aus 103 Meilen 157 und loege auf der Etappenkarte.
    //
    // 🔴 UND ER MISST DIE LUFTLINIE DER ETAPPE, NICHT DIE GELAUFENE STRECKE. Das ist keine
    // Bequemlichkeit, sondern die Bedingung dafuer, dass „Schnellste" nicht luegt: die Suche
    // ordnet OHNE den Aufschlag. Haenge er an der gelaufenen Laenge, bestrafte er nachtraeglich
    // genau den Bogen, den die Suche zum Zeitsparen geschlagen hat -- gemessen an der Fixture von
    // offroad-shortest-test.php kam der Zeitmodus danach auf 14,01 gegen 12,40 des
    // Streckenmodus, also eine „schnellste" Etappe, die messbar langsamer war als eine
    // verworfene. An der Luftlinie ist der Aufschlag fuer ein festes Endpunktpaar eine
    // KONSTANTE, und eine Konstante verschiebt kein Minimum.
    // ⭐ Nebenbei richtig: wer 20 Einheiten um einen See herum muss, zahlt nicht auch noch einen
    // Laengenaufschlag fuer den See.
    $luftlinie = count($points) >= 2
        ? hypot($points[count($points) - 1][0] - $points[0][0], $points[count($points) - 1][1] - $points[0][1])
        : 0.0;
    $time *= avesmapsOffroadRampFactor($luftlinie);

    return [
        'points' => $points,
        'distance' => $distance,
        'time' => $time,
        // V11's two sums, so the leg can say what it climbed exactly like a drawn way does.
        // 💣 `null` means „no height data along here", `0.0` means „measured level" -- never the same,
        // and `round` keeps that difference because it never turns null into a number.
        //
        // ⚠️ GANZE SCHRITT, wie ein gezeichneter Weg: `path_terrain.ascent_schritt` ist INT UNSIGNED.
        // 1 Schritt ist 1 Meter -- Nachkommastellen auf einer Summe bilinearer Abtastungen sind
        // Rauschen, und daneben im selben Reiseplan stehen ganze Zahlen.
        'ascent_schritt' => $ascent === null ? null : round($ascent),
        'descent_schritt' => $descent === null ? null : round($descent),
        'cells_opened' => $opened,
    ];
}

/**
 * PURE: liegt im Umkreis der Kuestentoleranz von (x, y) ueberhaupt eine gesperrte Zelle?
 *
 * 🔴 DAS IST DER FILTER GEGEN DAS WASSERLOCH. avesmapsOffroadFreeAround raeumt eine Scheibe von
 * 2,0 Einheiten Durchmesser frei. Beim Einzellauf war das harmlos: jeder Lauf bekam $blocked BY
 * VALUE und legte nur um SEINE beiden Endpunkte frei. Im Mehrziellauf teilen sich alle Ziele EIN
 * Gitter -- ein Kandidat im oder am Wasser oeffnete damit den See fuer die Etappen ALLER anderen.
 * Gemessen am 15.08.2026: ein Band von 1,6 Einheiten (der Median der Seen, AGENTS.md §11) wurde
 * durchlaessig, die Etappe eines fernen Kandidaten lief 14,01 statt 21,90 Einheiten mitten durch
 * den See. Wer diese Pruefung entfernt, holt das zurueck.
 */
function avesmapsOffroadHasBlockedNear(array $box, string $blocked, float $x, float $y): bool
{
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
    $reach = (int) ceil(AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE / $box['cell']);
    for ($deltaRow = -$reach; $deltaRow <= $reach; $deltaRow++) {
        $nextRow = $row + $deltaRow;
        if ($nextRow < 0 || $nextRow >= $box['rows']) { continue; }
        for ($deltaCol = -$reach; $deltaCol <= $reach; $deltaCol++) {
            $nextCol = $col + $deltaCol;
            if ($nextCol < 0 || $nextCol >= $box['cols']) { continue; }
            [$centreX, $centreY] = avesmapsOffroadCellCentre($box, $nextCol, $nextRow);
            if (hypot($centreX - $x, $centreY - $y) > AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE) { continue; }
            if ($blocked[$nextRow * $box['cols'] + $nextCol] === "") { return true; }
        }
    }

    return false;
}

/**
 * PURE: die gerade Verbindung, wenn sie trocken ist -- sonst null.
 *
 * 🔴 DER KURZSCHLUSS DES STRECKENMODUS. Die kuerzeste Verbindung zweier Punkte ist die Strecke
 * zwischen ihnen; ist sie trocken, gibt es nichts zu suchen. Kein Gitterlauf, keine Warteschlange.
 *
 * 🔴 GEFRAGT WIRD DAS POLYGON, NICHT DAS RASTER. Am 15.08.2026 an 5.903 Linien gemessen: die
 * beiden Tests gehen in 0,92 % der Faelle auseinander (3,07 % in Wassernaehe) -- und „nur Polygon
 * nass" kam kein einziges Mal vor. Das Raster sperrt eine Zelle, sobald Wasser sie beruehrt, und
 * uebertreibt damit um bis zu eine halbe Zellbreite (0,35 Einheiten, rund 1 km). Ein Modus, der
 * Meilen minimieren soll, darf keine Meilen fuer ein Rasterungsartefakt dazulegen (Entwurf §5).
 *
 * ⚠️ Gemessen wird trotzdem mit dem echten Gelaende: die Linie geht durch dieselbe
 * avesmapsOffroadFinishPath wie jede gesuchte, mit denselben Ebenen. Sie ist kuerzest, nicht
 * kostenlos -- ihre Zeit traegt den Boden und ihren Anstieg meldet sie wie jede andere Etappe.
 */
function avesmapsOffroadStraightPathIfDry(
    array $box,
    array $water,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = [],
    array $riverLines = []
): ?array {
    if ($speed <= 0.0) { return null; }
    if (avesmapsRouteChordCrossesWater($x1, $y1, $x2, $y2, $water)) { return null; }
    // 💣 DIE FLUESSE MUESSEN HIER EIGENS GEFRAGT WERDEN. Diese Funktion geht am Raster VORBEI --
    // das ist ihr Sinn (siehe oben) -- und die Sperrebene, in der die Fluesse stehen, sieht sie
    // deshalb nie. Wer nur avesmapsOffroadRasteriseBlocked repariert, verhindert das Durchwaten
    // unter „Schnellste" und laesst es unter „Kuerzeste" unveraendert stehen.
    if (avesmapsRouteChordCrossesRiver($x1, $y1, $x2, $y2, $riverLines)) { return null; }

    return avesmapsOffroadFinishPath([[$x1, $y1], [$x2, $y2]], $speed, $factors, $heights, $box, $eps, 0, $rasters);
}

/**
 * PURE: schneidet die Strecke (x1,y1)-(x2,y2) eine der Flusslinien?
 *
 * ⚠️ Huellbox-Vorfilter je Linie, dann Segment gegen Segment. Die Flusslinien sind wenige und kurz;
 * ein Index waere hier mehr Code als Rechenzeit.
 */
function avesmapsRouteChordCrossesRiver(float $x1, float $y1, float $x2, float $y2, array $riverLines): bool
{
    if ($riverLines === []) { return false; }
    $minX = min($x1, $x2); $maxX = max($x1, $x2);
    $minY = min($y1, $y2); $maxY = max($y1, $y2);

    foreach ($riverLines as $line) {
        $count = is_array($line) ? count($line) : 0;
        for ($i = 0; $i < $count - 1; $i++) {
            $ax = (float) $line[$i][0];     $ay = (float) $line[$i][1];
            $bx = (float) $line[$i + 1][0]; $by = (float) $line[$i + 1][1];
            if (max($ax, $bx) < $minX || min($ax, $bx) > $maxX) { continue; }
            if (max($ay, $by) < $minY || min($ay, $by) > $maxY) { continue; }
            if (avesmapsRouteSegmentsIntersect($x1, $y1, $x2, $y2, $ax, $ay, $bx, $by)) { return true; }
        }
    }

    return false;
}

/** PURE: schneiden sich die beiden Strecken? Vorzeichen der vier Kreuzprodukte. */
function avesmapsRouteSegmentsIntersect(
    float $ax, float $ay, float $bx, float $by,
    float $cx, float $cy, float $dx, float $dy
): bool {
    $seite = static fn(float $px, float $py, float $qx, float $qy, float $rx, float $ry): float
        => ($qx - $px) * ($ry - $py) - ($qy - $py) * ($rx - $px);
    $d1 = $seite($ax, $ay, $bx, $by, $cx, $cy);
    $d2 = $seite($ax, $ay, $bx, $by, $dx, $dy);
    $d3 = $seite($cx, $cy, $dx, $dy, $ax, $ay);
    $d4 = $seite($cx, $cy, $dx, $dy, $bx, $by);

    return (($d1 > 0.0) !== ($d2 > 0.0)) && (($d3 > 0.0) !== ($d4 > 0.0));
}

/**
 * PURE: die Gewaesserlinien aus den Netzdaten, in ihre ZWEI Rollen sortiert -- und sonst nichts.
 *
 * 🔴 DIES IST DIE EINZIGE STELLE, DIE ENTSCHEIDET, WAS EINE WAND IST UND WAS EINE FURT. Der Satz
 * stand hier schon am 15.08.2026, als es die Furt noch nicht gab: „wenn es soweit ist, kommt der
 * Bach hier heraus -- durch eine zusaetzliche Bedingung in DIESER Schleife -- und nirgends sonst."
 * Genau so ist es am 30.08.2026 geschehen. Wer die Unterscheidung stattdessen in die Rasterung oder
 * in den Schnitt-Test der Geraden legt, hat sie zweimal, und die beiden laufen auseinander (siehe
 * die vier Erzeuger der Verkehrsmittel-Sperre, AGENTS.md §11).
 *
 * 🔴 EIN RUECKGABEWERT MIT ZWEI FAECHERN, KEIN ZWEITER PARAMETER. Ein `$bachLines` neben
 * `$riverLines` durch dieselben sechs Signaturen zu reichen waere genau die Falle, die dieses Haus
 * zweimal bezahlt hat: der naechste Erzeuger reicht das eine weiter und das andere nicht, und der
 * Fehler ist STILL -- eine Route wird ohne Aufschlag einfach ein bisschen billiger, und niemand
 * sieht es. So gibt es nur EIN Ding zu reichen; wer es reicht, reicht beide Haelften.
 *
 * ⚠️ Ein Bach ist ein `Flussweg` mit `properties.is_bach === true`. Gelesen wird STRIKT und genau so
 * wie im Browser (`avesmapsPathIstBach` schreibt nur literales `true` ins properties_json,
 * `js/map-features/map-features-path-domain.js` liest `=== true`). Eine grosszuegigere Lesart hier
 * hiesse: die Karte zeichnet einen Fluss und der Router nimmt eine Furt an, oder umgekehrt -- und
 * das ist die Sorte Widerspruch, die man nur als Reisezeit sieht.
 * ⚠️ `Seeweg` bleibt draussen: Seewege laufen ueber das Meer, das ohnehin gesperrt ist, und sie
 * zusaetzlich als Wand zu rastern wuerde Kuestenrouten zerschneiden.
 * ⭐ Die Geometrien sind bereits geladen ($routeNetworkData['paths']) -- keine zweite Abfrage je
 * Route. Auf Shared Hosting ist das der Unterschied zwischen Fix und Last.
 *
 * 🔴 Die Furt traegt seit dem 31.08.2026 IHREN Faktor mit (`{coords, faktor}`) -- er haengt an der
 * Stroemung des einzelnen Bachs, siehe avesmapsOffroadFurtFaktor. Die Wand braucht keinen: sie ist
 * gesperrt, und gesperrt kennt keine Abstufung.
 *
 * @return array{wand: list<array>, furt: list<array{coords: array, faktor: float}>}
 */
function avesmapsCollectRouteRiverBarrierLines(array $paths): array
{
    $wand = [];
    $furt = [];
    foreach ($paths as $path) {
        if (!is_array($path)) { continue; }
        if (avesmapsGetRouteTransportType((string) ($path['subtype'] ?? '')) !== 'river') { continue; }
        $coordinates = $path['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) { continue; }
        // `properties` ist das ausgepackte properties_json (avesmapsBuildRoutePathData).
        $properties = is_array($path['properties'] ?? null) ? $path['properties'] : [];
        if (($properties['is_bach'] ?? null) === true) {
            $furt[] = ['coords' => $coordinates, 'faktor' => avesmapsOffroadFurtFaktor($path)];
            continue;
        }
        $wand[] = $coordinates;
    }

    return ['wand' => $wand, 'furt' => $furt];
}

/**
 * PURE: die WAND-Haelfte eines Gewaesser-Bunds (die Fluesse, die sperren).
 *
 * 💣 EINE FLACHE LINIENLISTE -- die Form vor dem 30.08.2026 -- WIRD ALS WAND GELESEN, nicht als
 * nichts. Das ist die sichere Richtung: der schlimmste Fall ist dann „ein Bach sperrt wieder", also
 * der Zustand von gestern. Mit `$gewaesser['wand'] ?? []` waere der schlimmste Fall „KEIN Fluss
 * sperrt mehr" -- genau der Zustand, den der Entwurf vom 15.08.2026 beseitigt hat, und er sieht von
 * aussen aus wie eine besonders zuegige Reise.
 */
function avesmapsOffroadBarrierLines(array $gewaesser): array
{
    if ($gewaesser === []) { return []; }
    if (array_key_exists('wand', $gewaesser)) {
        return is_array($gewaesser['wand']) ? $gewaesser['wand'] : [];
    }

    return $gewaesser;
}

/**
 * PURE: die FURT-Haelfte eines Gewaesser-Bunds (die Baeche, die nur kosten), auf die Form
 * `[{coords, faktor}]` gebracht.
 *
 * ⚠️ Die alte flache Form kennt keine Furt und liefert hier zu Recht nichts -- der Gegenpol zu
 * avesmapsOffroadBarrierLines, und in derselben sicheren Richtung: im Zweifel Wand, nie Furt.
 *
 * 💣 ZWEI EINTRAGS-BAUFORMEN, UND DIE ALTE BEDEUTET DEN ANKER. Bis zum 31.08.2026 war eine Furt
 * eine blanke Punktliste; seither traegt sie ihren Faktor bei sich. Eine blanke Liste hier
 * durchfallen zu lassen hiesse, dass ein Bach aus einem aelteren Erzeuger GAR NICHTS mehr kostet --
 * die gefaehrliche Richtung. Sie bekommt deshalb genau das, was sie vorher bedeutet hat: den
 * Grundwert AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR.
 */
function avesmapsOffroadFordLines(array $gewaesser): array
{
    if (!array_key_exists('furt', $gewaesser)) { return []; }
    if (!is_array($gewaesser['furt'])) { return []; }

    $raus = [];
    foreach ($gewaesser['furt'] as $eintrag) {
        if (!is_array($eintrag)) { continue; }
        if (array_key_exists('coords', $eintrag)) {
            $koordinaten = is_array($eintrag['coords']) ? $eintrag['coords'] : [];
            $faktor = isset($eintrag['faktor']) && is_numeric($eintrag['faktor'])
                ? (float) $eintrag['faktor']
                : AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR;
        } else {
            $koordinaten = $eintrag;
            $faktor = AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR;
        }
        if (count($koordinaten) < 2) { continue; }
        $raus[] = ['coords' => $koordinaten, 'faktor' => $faktor];
    }

    return $raus;
}

/**
 * PURE: free every cell whose centre lies within the coastal tolerance of (x, y).
 *
 * Always frees the point's own cell, whatever the tolerance -- a start you cannot leave is the one
 * failure this rule exists to prevent.
 */
function avesmapsOffroadFreeAround(array $box, string &$blocked, float $x, float $y): void
{
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);
    $blocked[$row * $box['cols'] + $col] = "\x00";

    $reach = (int) ceil(AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE / $box['cell']);
    for ($deltaRow = -$reach; $deltaRow <= $reach; $deltaRow++) {
        $nextRow = $row + $deltaRow;
        if ($nextRow < 0 || $nextRow >= $box['rows']) { continue; }
        for ($deltaCol = -$reach; $deltaCol <= $reach; $deltaCol++) {
            $nextCol = $col + $deltaCol;
            if ($nextCol < 0 || $nextCol >= $box['cols']) { continue; }
            [$centreX, $centreY] = avesmapsOffroadCellCentre($box, $nextCol, $nextRow);
            if (hypot($centreX - $x, $centreY - $y) <= AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE) {
                $blocked[$nextRow * $box['cols'] + $nextCol] = "\x00";
            }
        }
    }
}

/** PURE: cell index of a map point. */
function avesmapsOffroadIndexOf(array $box, float $x, float $y): int
{
    [$col, $row] = avesmapsOffroadCellOf($box, $x, $y);

    return $row * $box['cols'] + $col;
}

// ============================================================ 4. Douglas-Peucker, in PHP

/**
 * PURE: Douglas-Peucker with a real epsilon, in map units.
 *
 * 💣 NEW BUILD, and the spec's self-check wrongly listed it as present. The only simplifier in the
 * house is Leaflet's `L.LineUtil.simplify` (js/map-features/map-features-ecosystem-simplify.js) --
 * client-side, zero hits under api/, and it works towards a TARGET POINT COUNT rather than an eps.
 *
 * The two endpoints are never touched: they are the stitched real coordinates (§5.4).
 */
function avesmapsSimplifyLineDouglasPeucker(array $points, float $eps): array
{
    $count = count($points);
    if ($count <= 2 || $eps <= 0.0) { return array_values($points); }

    $keep = array_fill(0, $count, false);
    $keep[0] = true;
    $keep[$count - 1] = true;

    $stack = [[0, $count - 1]];
    while ($stack !== []) {
        [$first, $last] = array_pop($stack);
        if ($last <= $first + 1) { continue; }

        [$x1, $y1] = $points[$first];
        [$x2, $y2] = $points[$last];
        $deltaX = $x2 - $x1;
        $deltaY = $y2 - $y1;
        $lengthSquared = $deltaX * $deltaX + $deltaY * $deltaY;

        $worst = -1.0;
        $worstIndex = -1;
        for ($index = $first + 1; $index < $last; $index++) {
            [$px, $py] = $points[$index];
            if ($lengthSquared <= 0.0) {
                $distance = hypot($px - $x1, $py - $y1);
            } else {
                $t = (($px - $x1) * $deltaX + ($py - $y1) * $deltaY) / $lengthSquared;
                $t = max(0.0, min(1.0, $t));
                $distance = hypot($px - ($x1 + $t * $deltaX), $py - ($y1 + $t * $deltaY));
            }
            if ($distance > $worst) { $worst = $distance; $worstIndex = $index; }
        }

        if ($worst > $eps && $worstIndex > 0) {
            $keep[$worstIndex] = true;
            $stack[] = [$first, $worstIndex];
            $stack[] = [$worstIndex, $last];
        }
    }

    $simplified = [];
    foreach ($points as $index => $point) {
        if ($keep[$index]) { $simplified[] = $point; }
    }

    return $simplified;
}
