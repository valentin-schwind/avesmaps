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

/**
 * Eine Trennlinie pruefen und in Gestalt bringen.
 *
 * 💣 „x streng steigend" ist die Bedingung, an der alles Weitere haengt. Nur so ist die Linie eine
 * Funktion y(x); nur dann laesst sich „liegt B ueberall unter A" exakt beantworten (siehe
 * avesmapsClimateAssertOrder), und nur dann ergeben zwei Linien ein Polygon ohne Selbstschnitt. Wer
 * freie Punktreihenfolge zulaesst, braucht stattdessen echte Linien-Schnitttests und bekommt Baender,
 * die sich zu Achterschleifen falten.
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
    $previousX = null;
    foreach (array_values($positions) as $index => $position) {
        if (!is_array($position) || count($position) < 2) {
            throw new InvalidArgumentException("divider position {$index} is invalid.");
        }
        // avesmapsParseMapCoordinate refuses anything outside 0..1024 and rounds to three decimals --
        // the same treatment every drawn corner in this house gets.
        $x = avesmapsParseMapCoordinate($position[0] ?? null, "divider[{$index}].x");
        $y = avesmapsParseMapCoordinate($position[1] ?? null, "divider[{$index}].y");
        if ($previousX !== null && $x <= $previousX) {
            throw new InvalidArgumentException('divider positions must have strictly increasing x.');
        }
        $previousX = $x;
        $coordinates[] = [$x, $y];
    }

    if (abs($coordinates[0][0] - AVESMAPS_CLIMATE_MIN_XY) > 1e-9) {
        throw new InvalidArgumentException('the first divider position must sit on the left map edge.');
    }
    if (abs($coordinates[count($coordinates) - 1][0] - AVESMAPS_CLIMATE_MAX_XY) > 1e-9) {
        throw new InvalidArgumentException('the last divider position must sit on the right map edge.');
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
 * Liegt jede Trennlinie ueberall unter ihrer noerdlichen Nachbarin, mit Mindestabstand?
 *
 * 🔴 EXAKT, KEIN SAMPLING-RASTER. Beide Linien sind stueckweise linear und x-monoton. Zwischen zwei
 * benachbarten Knickstellen ist die Differenz beider Funktionen selbst linear -- ihr Minimum liegt also
 * immer AN einer Knickstelle. Es genuegt deshalb, an der VEREINIGUNG der x-Werte beider Linien zu
 * pruefen; ein feineres Raster faende nichts dazu, ein groeberes uebersaehe eine Kreuzung zwischen zwei
 * Stuetzstellen.
 *
 * @param list<array{type: string, coordinates: list<array{0: float, 1: float}>}> $dividers Index 0 = noerdlichste
 */
function avesmapsClimateAssertOrder(array $dividers): void
{
    $dividers = array_values($dividers);
    for ($index = 0; $index < count($dividers) - 1; $index++) {
        $north = $dividers[$index]['coordinates'];
        $south = $dividers[$index + 1]['coordinates'];

        $samples = [];
        foreach ([...$north, ...$south] as $position) {
            $samples[(string) $position[0]] = (float) $position[0];
        }
        foreach ($samples as $x) {
            $gap = avesmapsClimateYAt($north, $x) - avesmapsClimateYAt($south, $x);
            if ($gap < AVESMAPS_CLIMATE_MIN_GAP) {
                throw new InvalidArgumentException(sprintf(
                    'divider %d comes closer than %.1f to divider %d at x = %.4f.',
                    $index + 2,
                    AVESMAPS_CLIMATE_MIN_GAP,
                    $index + 1,
                    $x
                ));
            }
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
