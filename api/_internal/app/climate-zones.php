<?php

declare(strict_types=1);

// Klimazonen -- die REINE Geometrie (Entwurf docs/superpowers/specs/2026-08-03-klimazonen-design.md §4).
// Keine Datenbank, keine Includes ausser bootstrap.php: das ist die Haelfte des Features, die sich ohne
// MySQL beweisen laesst, und sie ist genau die Haelfte, in der die Fehler wehtun.
//
// 🔴 DER TRAGENDE SATZ: die Trennlinien sind die Wahrheit, die Baender sind abgeleitet. „Keine
// Ueberlappung" ist deshalb keine Pruefung, sondern Bauart -- ein Band IST der Raum zwischen zwei
// Linien. Wer hier anfaengt, ein Band als eigenstaendiges Polygon zu behandeln, baut die zweite
// Wahrheit ein, die der ganze Entwurf vermeidet.
//
// 🔴 KOORDINATEN sind GeoJSON [x, y], nie gedreht. Der Client dreht auf [y, x] (AGENTS.md §5).
// 🔴 NORDEN IST HOHES y. MAP_BOUNDS ist [[0,0],[1024,1024]] in [lat, lng], und L.CRS.Simple laesst lat
//    nach oben wachsen. Trennlinie 0 ist die noerdlichste und hat damit das HOECHSTE y.

require_once __DIR__ . '/../bootstrap.php';

const AVESMAPS_CLIMATE_MIN_XY = 0.0;
const AVESMAPS_CLIMATE_MAX_XY = 1024.0;

// Der Mindestabstand zweier Trennlinien, in Karteneinheiten. Er ist der Unterschied zwischen „ein Band
// ist duenn" und „ein Band ist ein entartetes Polygon, das sich selbst beruehrt": zwei Linien, die
// einander auch nur an einer Stelle kuessen, machen aus dem Ring eine Acht, und jeder Verschnitt danach
// liefert Unsinn. 1,0 von 1024 ist etwa ein Tausendstel der Karte -- eng genug, um eine Zone praktisch
// verschwinden zu lassen, weit genug, um gueltig zu bleiben.
const AVESMAPS_CLIMATE_MIN_GAP = 1.0;

// Deckel gegen einen durchgedrehten Client, keine Gestaltungsgrenze. Eine Klimagrenze mit 500 Ecken ist
// bereits weit jenseits dessen, was ein Mensch von Hand zieht.
const AVESMAPS_CLIMATE_MAX_POINTS = 500;

// Wie hoch ein NEU eingeschobenes Band anfaengt, in Karteneinheiten. „Schmal" (Owner 2026-08-03) und
// ein Startwert, kein Gesetz: die Linie laesst sich danach ziehen wie jede andere. 45 von 1024 sind
// gut vier Prozent der Kartenhoehe -- schmal genug, um als Uebergangszone zu lesen, breit genug, um
// die Beschriftung zu tragen. Ist oben weniger Platz, wird der Versatz kleiner statt die Nachbarn zu
// schieben (avesmapsClimateInsertedDividerAbove).
const AVESMAPS_CLIMATE_INSERT_OFFSET = 45.0;

/**
 * Schneiden sich die Strecken a1-a2 und b1-b2?
 *
 * Standard-Orientierungstest. Beruehrungen zaehlen als Schnitt: fuer eine Zonengrenze ist „die beiden
 * kuessen sich" genauso unbrauchbar wie ein echtes Kreuz -- das Band waere dort auf Breite null.
 */
function avesmapsClimateSegmentsCross(array $a1, array $a2, array $b1, array $b2): bool
{
    $orient = static function (array $p, array $q, array $r): int {
        $value = ($q[1] - $p[1]) * ($r[0] - $q[0]) - ($q[0] - $p[0]) * ($r[1] - $q[1]);
        if (abs($value) < 1e-9) {
            return 0;
        }

        return $value > 0 ? 1 : 2;
    };
    $onSegment = static fn(array $p, array $q, array $r): bool =>
        $q[0] <= max($p[0], $r[0]) + 1e-9 && $q[0] >= min($p[0], $r[0]) - 1e-9
        && $q[1] <= max($p[1], $r[1]) + 1e-9 && $q[1] >= min($p[1], $r[1]) - 1e-9;

    $o1 = $orient($a1, $a2, $b1);
    $o2 = $orient($a1, $a2, $b2);
    $o3 = $orient($b1, $b2, $a1);
    $o4 = $orient($b1, $b2, $a2);

    if ($o1 !== $o2 && $o3 !== $o4) {
        return true;
    }
    // Kollinear und ueberlappend.
    return ($o1 === 0 && $onSegment($a1, $b1, $a2))
        || ($o2 === 0 && $onSegment($a1, $b2, $a2))
        || ($o3 === 0 && $onSegment($b1, $a1, $b2))
        || ($o4 === 0 && $onSegment($b1, $a2, $b2));
}

/**
 * Schneidet sich diese Linie selbst? Benachbarte Strecken sind ausgenommen -- die teilen sich
 * naturgemaess einen Punkt.
 *
 * @param list<array{0: float, 1: float}> $coordinates
 */
function avesmapsClimatePolylineSelfIntersects(array $coordinates): bool
{
    $count = count($coordinates) - 1;
    for ($i = 0; $i < $count; $i++) {
        for ($j = $i + 2; $j < $count; $j++) {
            if (avesmapsClimateSegmentsCross(
                $coordinates[$i], $coordinates[$i + 1],
                $coordinates[$j], $coordinates[$j + 1]
            )) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Schneiden sich zwei Linien irgendwo?
 *
 * @param list<array{0: float, 1: float}> $a
 * @param list<array{0: float, 1: float}> $b
 */
function avesmapsClimatePolylinesCross(array $a, array $b): bool
{
    for ($i = 0; $i < count($a) - 1; $i++) {
        for ($j = 0; $j < count($b) - 1; $j++) {
            if (avesmapsClimateSegmentsCross($a[$i], $a[$i + 1], $b[$j], $b[$j + 1])) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Eine Trennlinie pruefen und in Gestalt bringen.
 *
 * 🔴 SEIT 2026-08-03 DARF x ZURUECKLAUFEN (Owner: „um die Wueste Khôm richtig zu machen, will ich eine
 * Blase"). Bis dahin galt „x streng steigend". Das war eine VEREINFACHUNG, keine Eigenschaft der Sache:
 * sie machte jede Linie zu einer Funktion y(x) und die Reihenfolgepruefung damit zu einer Abtastung an
 * den Knickstellen -- verbot aber genau den Ueberhang, den eine Klimagrenze um eine Wueste braucht.
 *
 * 💣 An ihre Stelle tritt die Bedingung, um die es wirklich geht: KEIN SELBSTSCHNITT. Vorher war der
 * durch die Monotonie ausgeschlossen und brauchte keine Pruefung; jetzt ist er der Fall, der das Band
 * zur Acht macht -- und ein Verschnitt auf einer Acht liefert Unsinn statt eines Fehlers.
 *
 * Was BLEIBT: erster Punkt am linken, letzter am rechten Kartenrand. Daran haengt, dass zwei Linien das
 * Rechteck ueberhaupt in zwei Teile schneiden, und dass die Baender lueckenlos aneinanderstossen.
 *
 * @return array{type: string, coordinates: list<array{0: float, 1: float}>}
 */
function avesmapsClimateNormalizeDivider(mixed $geometry): array
{
    if (!is_array($geometry)) {
        throw new InvalidArgumentException('divider geometry must be a GeoJSON object.');
    }
    if ((string) ($geometry['type'] ?? '') !== 'LineString') {
        throw new InvalidArgumentException('divider geometry must be of type LineString.');
    }

    $positions = $geometry['coordinates'] ?? null;
    if (!is_array($positions) || count($positions) < 2) {
        throw new InvalidArgumentException('a divider needs at least two positions.');
    }
    if (count($positions) > AVESMAPS_CLIMATE_MAX_POINTS) {
        throw new InvalidArgumentException('a divider may not have more than '
            . AVESMAPS_CLIMATE_MAX_POINTS . ' positions.');
    }

    $coordinates = [];
    $previous = null;
    foreach (array_values($positions) as $index => $position) {
        if (!is_array($position) || count($position) < 2) {
            throw new InvalidArgumentException("divider position {$index} is invalid.");
        }
        // avesmapsParseMapCoordinate refuses anything outside 0..1024 and rounds to three decimals --
        // the same treatment every drawn corner in this house gets.
        $x = avesmapsParseMapCoordinate($position[0] ?? null, "divider[{$index}].x");
        $y = avesmapsParseMapCoordinate($position[1] ?? null, "divider[{$index}].y");
        // Eine Strecke der Laenge null ist kein Ueberhang, sondern ein Doppelklick. Sie waere fuer die
        // Orientierungstests unten ausserdem entartet.
        if ($previous !== null && abs($x - $previous[0]) < 1e-9 && abs($y - $previous[1]) < 1e-9) {
            throw new InvalidArgumentException("divider position {$index} repeats its predecessor.");
        }
        $previous = [$x, $y];
        $coordinates[] = [$x, $y];
    }

    if (abs($coordinates[0][0] - AVESMAPS_CLIMATE_MIN_XY) > 1e-9) {
        throw new InvalidArgumentException('the first divider position must sit on the left map edge.');
    }
    if (abs($coordinates[count($coordinates) - 1][0] - AVESMAPS_CLIMATE_MAX_XY) > 1e-9) {
        throw new InvalidArgumentException('the last divider position must sit on the right map edge.');
    }
    if (avesmapsClimatePolylineSelfIntersects($coordinates)) {
        throw new InvalidArgumentException('a divider may not cross itself.');
    }

    return ['type' => 'LineString', 'coordinates' => $coordinates];
}

/**
 * y der Linie an der Stelle x. Setzt eine normalisierte Linie voraus (x streng steigend, Rand zu Rand).
 *
 * @param list<array{0: float, 1: float}> $coordinates
 */
function avesmapsClimateYAt(array $coordinates, float $x): float
{
    $count = count($coordinates);
    if ($count === 0) {
        return 0.0;
    }
    for ($index = 0; $index < $count - 1; $index++) {
        [$ax, $ay] = $coordinates[$index];
        [$bx, $by] = $coordinates[$index + 1];
        if ($x >= $ax && $x <= $bx) {
            $span = $bx - $ax;

            return $span <= 0.0 ? (float) $ay : (float) $ay + ($x - $ax) / $span * ($by - $ay);
        }
    }

    return (float) $coordinates[$count - 1][1];
}

/**
 * Liegt jede Trennlinie unter ihrer noerdlichen Nachbarin, ohne sie zu beruehren?
 *
 * 🔴 TOPOLOGISCH STATT RECHNERISCH (2026-08-03, mit den Ueberhaengen). Vorher waren beide Linien
 * x-monoton, also Funktionen y(x), und die Frage liess sich als „Abstand an jeder Knickstelle"
 * beantworten. Mit einem Ueberhang gibt es zu einem x mehrere y -- die Frage ergibt so keinen Sinn mehr.
 *
 * Die Antwort ist stattdessen die, um die es immer ging:
 *   1. Die beiden Linien schneiden sich NIRGENDS. Zwei ueberschneidungsfreie Kurven, die BEIDE von
 *      Rand zu Rand laufen, teilen das Rechteck in genau zwei Teile -- dazwischen liegt das Band.
 *   2. Damit steht ihre Reihenfolge global fest, und EIN Punkt genuegt, um sie zu benennen: der am
 *      Westrand, wo jede Linie genau einen Punkt hat (er ist dort festgenagelt).
 *
 * 💣 Bedingung 1 ist die, die eine Blase abfaengt, die nach oben durchstoesst. An den Randpunkten waere
 * dort alles in Ordnung -- nur mittendrin nicht.
 *
 * @param list<array{type: string, coordinates: list<array{0: float, 1: float}>}> $dividers Index 0 = noerdlichste
 */
function avesmapsClimateAssertOrder(array $dividers): void
{
    $dividers = array_values($dividers);
    for ($index = 0; $index < count($dividers) - 1; $index++) {
        $north = $dividers[$index]['coordinates'];
        $south = $dividers[$index + 1]['coordinates'];

        $gap = $north[0][1] - $south[0][1];
        if ($gap < AVESMAPS_CLIMATE_MIN_GAP) {
            throw new InvalidArgumentException(sprintf(
                'divider %d must stay at least %.1f below divider %d at the west edge (gap is %.4f).',
                $index + 2,
                AVESMAPS_CLIMATE_MIN_GAP,
                $index + 1,
                $gap
            ));
        }
        if (avesmapsClimatePolylinesCross($north, $south)) {
            throw new InvalidArgumentException(sprintf(
                'divider %d crosses divider %d.',
                $index + 2,
                $index + 1
            ));
        }
    }
}

/**
 * Aus zwei Kanten ein Band. `null` heisst „der Kartenrand": oben fuer die noerdlichste Zone, unten fuer
 * die suedlichste.
 *
 * Der Ring laeuft obere Kante nach Osten, untere Kante nach Westen zurueck, dann zu. Weil beide Kanten
 * exakt am Kartenrand beginnen und enden, teilen sich zwei benachbarte Baender ihre Linie PUNKTGLEICH
 * -- es entsteht kein Spalt, den ein Verschnitt spaeter als „gehoert zu keiner Zone" meldet.
 *
 * @return array{type: string, coordinates: list<list<array{0: float, 1: float}>>}
 */
function avesmapsClimateBandGeometry(?array $upper, ?array $lower): array
{
    $top = $upper === null
        ? [[AVESMAPS_CLIMATE_MIN_XY, AVESMAPS_CLIMATE_MAX_XY], [AVESMAPS_CLIMATE_MAX_XY, AVESMAPS_CLIMATE_MAX_XY]]
        : $upper['coordinates'];
    $bottom = $lower === null
        ? [[AVESMAPS_CLIMATE_MIN_XY, AVESMAPS_CLIMATE_MIN_XY], [AVESMAPS_CLIMATE_MAX_XY, AVESMAPS_CLIMATE_MIN_XY]]
        : $lower['coordinates'];

    $ring = [];
    foreach ($top as $position) {
        $ring[] = [(float) $position[0], (float) $position[1]];
    }
    foreach (array_reverse($bottom) as $position) {
        $ring[] = [(float) $position[0], (float) $position[1]];
    }
    $ring[] = $ring[0];

    return ['type' => 'Polygon', 'coordinates' => [$ring]];
}

/**
 * In welchem Band liegt ein Punkt? 0 = noerdlichste Zone, `count($dividers)` = suedlichste.
 *
 * ⭐ DAS IST DER GRUND, WARUM DIE LINIEN DIE WAHRHEIT SIND. Weil jede Trennlinie eine Funktion y(x)
 * ist, braucht die Frage „welche Zone liegt hier" keinen Punkt-in-Polygon-Test und keinen Verschnitt
 * gegen sieben kartenbreite Flaechen -- sie ist ein Vergleich je Linie, sechsmal. Genau deshalb kann
 * eine Route sie fuer JEDE Etappe stellen, ohne dass es etwas kostet.
 *
 * Norden ist oben (hohes y): Trennlinie 0 liegt am hoechsten. Der Index ist damit schlicht die Zahl
 * der Linien, die ueber dem Punkt liegen. Ein Punkt GENAU auf einer Linie faellt in die suedliche
 * Zone -- irgendwohin muss er, und so gehoert jeder Punkt zu genau einer.
 *
 * @param list<array{type: string, coordinates: list<array{0: float, 1: float}>}> $dividers Index 0 = noerdlichste
 */
function avesmapsClimateZoneIndexAt(array $dividers, float $x, float $y): int
{
    $index = 0;
    foreach (array_values($dividers) as $divider) {
        $coordinates = $divider['coordinates'] ?? [];
        if (!is_array($coordinates) || $coordinates === []) {
            continue;
        }
        if (avesmapsClimateYAt($coordinates, $x) >= $y) {
            $index++;
        }
    }

    return $index;
}

/**
 * Die gleichmaessige Startaufteilung: `$count` gerade Linien, die die Karte in `$count + 1` gleich hohe
 * Baender teilen. Index 0 ist die noerdlichste und liegt am hoechsten.
 *
 * @return list<array{type: string, coordinates: list<array{0: float, 1: float}>}>
 */
function avesmapsClimateDefaultDividers(int $count): array
{
    $dividers = [];
    for ($index = 0; $index < $count; $index++) {
        $y = AVESMAPS_CLIMATE_MAX_XY * ($count - $index) / ($count + 1);
        $dividers[] = avesmapsClimateNormalizeDivider([
            'type' => 'LineString',
            'coordinates' => [[AVESMAPS_CLIMATE_MIN_XY, $y], [AVESMAPS_CLIMATE_MAX_XY, $y]],
        ]);
    }

    return $dividers;
}

/**
 * Eine Trennlinie senkrecht verschieben. Die Randpunkte bleiben dabei am Kartenrand (x aendert sich
 * nicht), y wird auf die Karte geklemmt.
 *
 * @param array{type: string, coordinates: list<array{0: float, 1: float}>} $divider
 * @return array{type: string, coordinates: list<array{0: float, 1: float}>}
 */
function avesmapsClimateShiftDivider(array $divider, float $dy): array
{
    $coordinates = [];
    foreach ($divider['coordinates'] as [$x, $y]) {
        $coordinates[] = [$x, max(AVESMAPS_CLIMATE_MIN_XY, min(AVESMAPS_CLIMATE_MAX_XY, $y + $dy))];
    }

    return ['type' => 'LineString', 'coordinates' => $coordinates];
}

/**
 * Die KOPIE einer vorhandenen Trennlinie, um `$wanted` nach oben versetzt -- so weit, wie es geht, ohne
 * die Nachbarn zu beruehren.
 *
 * 🔴 DAS IST DER MINIMALINVASIVE EINSCHUB. Eine neue Zone zwischen zwei bestehende zu legen, ohne eine
 * einzige vorhandene Linie zu bewegen, geht nur so: die neue Linie ist die Form ihrer suedlichen
 * Nachbarin, angehoben. Das neue Band ist damit ein Streifen gleichbleibender Hoehe, der der
 * bestehenden Grenze exakt folgt -- und den Platz nimmt es sich von der Zone DARUEBER, nicht von der
 * darunter.
 *
 * 💣 Ein senkrechter Versatz kann eine Linie mit starkem Ueberhang mit sich selbst oder mit der Linie
 * darueber verschneiden. Deshalb wird der Versatz halbiert, bis er passt -- und wenn selbst der
 * kleinste nicht passt, kommt `null` zurueck. Der Aufrufer bricht dann ab, statt etwas zu verschieben.
 *
 * @param array $below   die Linie, deren Form kopiert wird (die suedliche Nachbarin der neuen Zone)
 * @param array|null $above die naechste Linie darueber, oder null fuer den Kartenrand
 * @return array{type: string, coordinates: list<array{0: float, 1: float}>}|null
 */
function avesmapsClimateInsertedDividerAbove(array $below, ?array $above, float $wanted): ?array
{
    $obergrenze = $above === null ? null : $above['coordinates'];
    for ($versuch = $wanted; $versuch >= AVESMAPS_CLIMATE_MIN_GAP * 2; $versuch /= 2.0) {
        $kandidat = avesmapsClimateShiftDivider($below, $versuch);

        // Der Versatz darf die Kopie nicht in sich selbst falten ...
        if (avesmapsClimatePolylineSelfIntersects($kandidat['coordinates'])) {
            continue;
        }
        // ... sie nicht durch ihr Original stossen ...
        if (avesmapsClimatePolylinesCross($kandidat['coordinates'], $below['coordinates'])) {
            continue;
        }
        // ... und nicht durch die Linie darueber.
        if ($obergrenze !== null && avesmapsClimatePolylinesCross($kandidat['coordinates'], $obergrenze)) {
            continue;
        }
        // Am Westrand entscheidet sich die Reihenfolge -- dort muss der Abstand nach BEIDEN Seiten reichen.
        if ($kandidat['coordinates'][0][1] - $below['coordinates'][0][1] < AVESMAPS_CLIMATE_MIN_GAP) {
            continue;
        }
        if ($obergrenze !== null && $obergrenze[0][1] - $kandidat['coordinates'][0][1] < AVESMAPS_CLIMATE_MIN_GAP) {
            continue;
        }

        return $kandidat;
    }

    // 💣 ZWEITER WEG, und er ist nicht selten: eine Linie mit BLASE kreuzt ihre eigene angehobene Kopie.
    // Am Testbestand nachgerechnet -- die Blase um die Wueste Khôm laeuft nach links zurueck, und die
    // Kopie schneidet dabei den steilen Abstieg des Originals. Kein Versatz der Welt behebt das, weil
    // der Schnitt mit dem Versatz nur wandert.
    //
    // Dann eine GERADE im freien Streifen zwischen beiden Nachbarn. Sie kann per Bauart keine der
    // beiden schneiden: die untere liegt vollstaendig darunter, die obere vollstaendig darueber. Das
    // Band ist damit ueber der Blase dicker als an den Raendern -- was richtig ist, denn seine
    // UNTERKANTE ist und bleibt die vorhandene Grenze, und genau die soll der Auftrag erhalten.
    $untenMax = AVESMAPS_CLIMATE_MIN_XY;
    foreach ($below['coordinates'] as [$unusedX, $y]) {
        $untenMax = max($untenMax, $y);
    }
    $obenMin = AVESMAPS_CLIMATE_MAX_XY;
    if ($above !== null) {
        $obenMin = AVESMAPS_CLIMATE_MAX_XY;
        foreach ($above['coordinates'] as [$unusedX, $y]) {
            $obenMin = min($obenMin, $y);
        }
    }
    if ($obenMin - $untenMax < AVESMAPS_CLIMATE_MIN_GAP * 2) {
        return null;
    }
    $hoehe = min($untenMax + $wanted, $obenMin - AVESMAPS_CLIMATE_MIN_GAP);
    $hoehe = max($hoehe, $untenMax + AVESMAPS_CLIMATE_MIN_GAP);

    return avesmapsClimateNormalizeDivider(['type' => 'LineString', 'coordinates' => [
        [AVESMAPS_CLIMATE_MIN_XY, $hoehe], [AVESMAPS_CLIMATE_MAX_XY, $hoehe],
    ]]);
}

/**
 * Wird diese Ebene ABGELEITET statt gezeichnet?
 *
 * 🔴 Der Riegel sitzt hier und wird vom Server erzwungen, nicht nur im Menue versteckt. Ein UI-Riegel
 * schuetzt vor dem Verklicken; er schuetzt nicht vor einem Tab, der seit gestern offen ist und die
 * alte Aktion noch kennt. Und er ist die einzige Stelle, die verhindert, dass es zwei Wahrheiten ueber
 * dieselbe Klimagrenze gibt: die Linie und ein von Hand verschobenes Band.
 */
function avesmapsClimateIsDerivedKind(string $kind): bool
{
    return $kind === 'klima';
}

function avesmapsClimateAssertNotDerived(string $kind, string $action): void
{
    if (avesmapsClimateIsDerivedKind($kind)) {
        throw new InvalidArgumentException(
            "{$action} is not available for climate zones -- they are derived from their dividers."
        );
    }
}
