<?php

declare(strict_types=1);

// V14 §5.5 / Instruction C §2: der automatische Umweg-Auslöser.
//
// Der zweite Aufrufer desselben A*, der „Hierher reisen" trägt. Kein Knopf, kein Rechtsklick: er
// prüft jede normal geplante Route und bietet dem Dijkstra einen Querweg an, wenn das gezeichnete
// Netz einen absurden Bogen fährt.
//
// 🔴 UND ZWAR NUR NOCH ZU ORTEN OHNE ANSCHLUSS ANS WEGENETZ (Owner, 14.08.2026). Hängen beide Enden
// einer Sehne an gezeichneten Wegen, bleibt die Reise auf ihnen -- auch bei einem absurden Bogen.
// Die Regel steht bei avesmapsRouteKeepChordsWithOffNetworkEnd, samt der Messung, die sie ausgelöst
// hat.
//
// PURITY CONTRACT: side-effect-free on include. Ohne PDO rechnet der A* auf flachem, landschaftslosem
// Grund weiter -- dieselbe gewollte Ausfallart wie bei „Hierher reisen".
//
// ⭐ DER VORFILTER IST GRATIS. Luftlinie und gefahrene Strecke liegen nach dem ersten Dijkstra beide
// vor; erst darüber kostet etwas. Am Livebestand gemessen (V14 §4.2/§4.3): 9,1 % der nahen Ortspaare
// lösen aus, die Suchkiste dabei p50 1.125 Zellen, die Suche p50 14 ms. Die Kisten sind hier KLEIN,
// nicht groß -- eine Route sieht nur dann absurd aus, wenn die beiden Orte nah beieinander liegen,
// und nah heißt kleine Kiste. Die Schwelle begrenzt die Kiste, ohne dass man sie begrenzen muss.

require_once __DIR__ . '/offroad-leg.php';
require_once __DIR__ . '/travel-values.php';

// Ab welchem Verhältnis „gefahrene Strecke : Luftlinie" überhaupt quer gerechnet wird.
//
// 🔴 DIE SCHWELLE IST SEIT DEM 14.08.2026 DIE ZWEITE HÜRDE, NICHT DIE ERSTE. Davor steht die Regel
// des Owners: eine Sehne, deren beide Enden am Wegenetz hängen, wird gar nicht erst gerechnet
// (avesmapsRouteKeepChordsWithOffNetworkEnd). Was hier folgt, entscheidet also nur noch über Sehnen,
// die einen Ort OHNE Anschluss erreichen.
//
// ⚠️ Und auch dort entscheidet die Schwelle nicht allein: sie sagt, wann sich das NACHRECHNEN lohnt;
// danach entscheidet die Zeit. 💣 An Land ist diese zweite Prüfung seit dem Quellenwert 2,30 für
// Querfeldein allerdings wirkungslos -- das Tempoverhältnis liegt bei 3,07/2,30 = 1,335 und damit
// unter der Schwelle, ein ausgelöster Bogen gewinnt dort also auch über die Zeit. Scharf bleibt sie
// auf dem Wasser (Lastensegler 11,90/2,30 = 5,17).
const AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD = 3.0;

// Wie viele Sehnen höchstens gerechnet werden (Owner-Entscheid 14.08.2026: 3).
//
// 💣 DER DECKEL IST PFLICHT, NICHT FEINSCHLIFF. Eine Route mit n Knoten hat n(n+1)/2 Sehnen; bei 50
// Etappen sind das 1.275. Der Vorfilter ist gratis -- Luftlinie und Teilstrecke liegen nach dem
// ersten Dijkstra beide vor --, der A* ist es nicht (p50 14 ms je Lauf). Ohne Deckel wäre eine lange
// Reise ein Lastproblem auf einem Shared Host, und genau dort hat dieses Projekt schon einmal die
// PHP-Worker gesättigt.
const AVESMAPS_ROUTE_OFFROAD_DETOUR_MAX_CHORDS = 3;

/**
 * PURE: die tatsächlich gefahrene Strecke einer Route, aus den Etappen-Geometrien.
 *
 * 💣 NICHT `cost` und NICHT `distance`. `cost` ist im Regelfall eine Zeit, und `distance` trug bis
 * Instruction C §1 den x25-Aufschlag der Notbrücken -- mit ihm käme für Gulbladdirstadir -> Rekheim
 * ein Verhältnis von 77x heraus statt 18x, und der Auslöser feuerte an Stellen, an denen gar kein
 * Bogen ist.
 */
function avesmapsRouteMeasureTravelledDistance(array $segments): float
{
    $distance = 0.0;
    foreach ($segments as $segment) {
        $coordinates = $segment['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates)) { continue; }
        $distance += avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    }

    return $distance;
}

/**
 * PURE: was die gefundene Route an ZEIT kostet, in der Einheit des Graphen.
 *
 * 💣 Nicht `route['cost']`: das ist bei `optimize=shortest` eine Strecke und bei
 * `minimize_transfers` zusätzlich mit Umsteigezuschlägen versetzt. Der Vergleich unten muss aber in
 * beiden Modi derselbe sein -- eine Abkürzung, die länger DAUERT, ist auch dann keine, wenn der
 * Reisende „Kürzeste" angehakt hat.
 *
 * 💣 UND DER x25 MUSS AUCH HIER HERAUS. `time` ist `distance / Tempo`, erbt den Aufschlag der
 * Notbrücken also mit -- live gemessen trug Gulbladdirstadir -> Rekheim dadurch 405,09 statt der
 * echten 32,9. Das ist dieselbe Verwechslung wie in §1, nur eine Division später: eine Route mit
 * einer kurzen Notbrücke sähe zeitlich so teuer aus, dass ein tatsächlich LANGSAMERER Querweg
 * gewönne. Der Aufschlag ist eine Abschreckung für den Dijkstra, keine Reisezeit.
 */
function avesmapsRouteMeasureTravelledTime(array $segments): float
{
    $time = 0.0;
    foreach ($segments as $segment) {
        $factor = (float) ($segment['cost_factor'] ?? 1.0);
        if ($factor <= 0.0) { $factor = 1.0; }
        $time += (float) ($segment['time'] ?? 0.0) / $factor;
    }

    return $time;
}

/**
 * PURE: die Knotenkette der gefundenen Route, in FAHRTRICHTUNG, mit Ort und laufender Summe.
 *
 * 💣 WEDER DIE GEOMETRIE NOCH `from`/`to` SIND ORIENTIERT. Beide Fahrtrichtungen einer Straße teilen
 * ein einziges Verbindungsobjekt, und das behält die gespeicherte Zeichenrichtung
 * (`client-graph.php:411-413` -- die Verlauf-Kette der Wege hängt daran). Wer die Kette aus
 * `coordinates[0]` oder aus `from` liest, liest sie bei jeder zweiten Etappe verkehrt herum und
 * bekommt Sehnen, die es nicht gibt. Deshalb wird beides *fortgeschrieben*: der nächste Knoten ist
 * das Ende, das NICHT der aktuelle ist.
 *
 * Leeres Array heißt „nicht ableitbar" (Etappe ohne Geometrie, Kette reißt) -- dann gibt es keine
 * Sehnen und der Auslöser verhält sich wie vor dem 14.08.2026.
 */
function avesmapsRouteChordChain(
    array $segments,
    array $fromPoint,
    array $toPoint,
    string $fromNode,
    string $toNode
): array {
    $x = (float) ($fromPoint['x'] ?? 0.0);
    $y = (float) ($fromPoint['y'] ?? 0.0);
    $node = $fromNode;
    $chain = [['name' => $node, 'x' => $x, 'y' => $y, 'time' => 0.0, 'distance' => 0.0]];
    $time = 0.0;
    $distance = 0.0;

    foreach ($segments as $segment) {
        if (!is_array($segment)) { return []; }
        $coordinates = $segment['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) { return []; }

        $first = $coordinates[0];
        $last = $coordinates[count($coordinates) - 1];
        // Das entferntere Ende ist das, auf das die Reise zuläuft.
        $toFirst = hypot((float) $first[0] - $x, (float) $first[1] - $y);
        $toLast = hypot((float) $last[0] - $x, (float) $last[1] - $y);
        $next = $toFirst <= $toLast ? $last : $first;

        $from = (string) ($segment['from'] ?? '');
        $to = (string) ($segment['to'] ?? '');
        $nextName = $from === $node ? $to : ($to === $node ? $from : '');
        if ($nextName === '') { return []; }

        // 💣 Derselbe x25-Ausbau wie in avesmapsRouteMeasureTravelledTime: der Aufschlag der
        // Notbrücken ist eine Abschreckung für den Dijkstra, keine Reisezeit. Eine Teilstrecke, die
        // ihn mitschleppte, sähe so teuer aus, dass eine langsamere Sehne gewönne.
        $factor = (float) ($segment['cost_factor'] ?? 1.0);
        if ($factor <= 0.0) { $factor = 1.0; }
        $time += (float) ($segment['time'] ?? 0.0) / $factor;
        $distance += avesmapsCalculateClientRouteCoordinateDistance($coordinates);

        $x = (float) $next[0];
        $y = (float) $next[1];
        $node = $nextName;
        $chain[] = ['name' => $node, 'x' => $x, 'y' => $y, 'time' => $time, 'distance' => $distance];
    }

    if ($node !== $toNode) { return []; }
    // Der letzte Knoten ist das Ziel -- seine Koordinate kommt vom Aufrufer, nicht aus der Geometrie
    // (bei einem Kartenpunkt ist sie die einzige, die stimmt).
    $chain[count($chain) - 1]['x'] = (float) ($toPoint['x'] ?? $x);
    $chain[count($chain) - 1]['y'] = (float) ($toPoint['y'] ?? $y);

    return $chain;
}

/**
 * PURE: welche Sehnen der Kette überhaupt einen A*-Lauf verdienen, die besten zuerst.
 *
 * Zwei Schranken, beide ohne eine gerasterte Zelle: das VERHÄLTNIS (lohnt sich Nachrechnen?) und die
 * BESTZEIT `Luftlinie / Tempo` (kann die Suche überhaupt gewinnen?). Die zweite ist zulässig, weil
 * der A*-Weg nie kürzer als die Luftlinie ist und sein kleinster Faktor exakt 1,0 beträgt.
 */
function avesmapsRouteChordCandidates(array $chain, float $speed, float $threshold): array
{
    $candidates = [];
    $last = count($chain) - 1;
    for ($i = 0; $i < $last; $i++) {
        for ($j = $i + 1; $j <= $last; $j++) {
            $air = hypot($chain[$j]['x'] - $chain[$i]['x'], $chain[$j]['y'] - $chain[$i]['y']);
            if ($air <= 1e-9) { continue; }
            $graphDistance = $chain[$j]['distance'] - $chain[$i]['distance'];
            $graphTime = $chain[$j]['time'] - $chain[$i]['time'];
            $ratio = $graphDistance / $air;
            if ($ratio <= $threshold) { continue; }
            $best = $air / $speed;
            if ($best >= $graphTime) { continue; }
            $candidates[] = [
                'from_index' => $i, 'to_index' => $j,
                'from_node' => $chain[$i]['name'], 'to_node' => $chain[$j]['name'],
                'air_distance' => $air, 'graph_distance' => $graphDistance, 'graph_cost_units' => $graphTime,
                'ratio' => $ratio, 'best_possible_cost_units' => $best, 'gain' => $graphTime - $best,
            ];
        }
    }
    // Der größte mögliche Gewinn zuerst -- der Deckel schneidet dann die aussichtslosen ab, nicht die
    // aussichtsreichen.
    usort($candidates, static fn(array $a, array $b): int => $b['gain'] <=> $a['gain']);

    return $candidates;
}

/**
 * PURE: nur die Sehnen, an deren Ende ein Ort OHNE Anschluss ans Wegenetz steht.
 *
 * 🔴 DIE REGEL DES OWNERS, 14.08.2026, wörtlich: „querfeldein sollen nur orte angefahren werden, die
 * nicht mit dem straßennetz verbunden sind". Hängen BEIDE Enden einer Sehne an gezeichneten Wegen,
 * bleibt die Reise auf ihnen -- auch dann, wenn das Netz einen absurden Bogen fährt. Die Oberfläche
 * verspricht das seit jeher („Fehlt zwischen zwei Orten ein echter Weg …",
 * `transport.speedInfo.crossCountryRule`); der Auslöser hielt sich nur nicht daran.
 *
 * 💣 DAS IST EINE REGEL, KEIN SCHWELLENWERT -- und an der Schwelle zu drehen hätte den Fall
 * verschoben statt entschieden. Live gemessen: Luring -> Salmingen lief quer (Kosten 3,38) statt über
 * Ferdok (9,52), obwohl Salmingen am Talloner Hügelsteig und Spinnried an der Reichsstraße 6 hängt.
 * Und die Zeitprobe kann das nicht mehr auffangen: mit dem Quellenwert 2,30 für Querfeldein liegt das
 * Tempoverhältnis an Land bei 3,07/2,30 = 1,335, jeder Bogen über 3,0x gewinnt dort also auch über
 * die Zeit.
 *
 * ⚠️ „Angebunden" heißt: der Knoten trägt die Kante einer gezeichneten LANDwegart
 * (`AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES`). Es ist bewusst dieselbe Prüfung, mit der
 * `client-graph.php` entscheidet, ob ein Wegpunkt seinen Querfeldein-Anker bekommt -- zwei Begriffe
 * von „hängt am Wegenetz" liefen auseinander, und dann wäre nicht mehr zu sagen, welcher gilt.
 *
 * ⭐ „Hierher reisen" bleibt davon unberührt, ohne einen Sonderfall zu brauchen: ein angeklickter
 * Kartenpunkt (`__offroad_*`) hängt von Bauart wegen nur an seiner eigenen Querfeldein-Kante und ist
 * damit nie angebunden. Dasselbe gilt für die Orte hinter einer Notbrücke -- genau die, um die es
 * geht.
 */
function avesmapsRouteKeepChordsWithOffNetworkEnd(array $graph, array $candidates): array
{
    $onNetwork = [];
    $kept = [];
    foreach ($candidates as $candidate) {
        $fromNode = (string) ($candidate['from_node'] ?? '');
        $toNode = (string) ($candidate['to_node'] ?? '');
        foreach ([$fromNode, $toNode] as $node) {
            // Eine Kette hat wenige Knoten, aber viele Sehnen (n(n+1)/2) -- jeder Knoten wird deshalb
            // einmal beurteilt, nicht einmal je Sehne.
            $onNetwork[$node] ??= avesmapsClientNodeHasLandPathEdge($graph, $node);
        }
        if ($onNetwork[$fromNode] && $onNetwork[$toNode]) {
            continue;
        }
        $kept[] = $candidate;
    }

    return $kept;
}

/**
 * Prüft die gefundene Route auf einen absurden Bogen und hängt bei Bedarf einen A*-Querweg als
 * ANGEBOT in den Graphen. Gibt einen Bericht zurück; ist `offered` wahr, muss der Aufrufer den
 * Dijkstra erneut laufen lassen.
 *
 * 🔴 ANGEBOT, NICHT VORSCHRIFT -- und deshalb gibt es hier keinen zweiten Routenzusammenbau. Die
 * Kante kostet, was sie kostet; welche Reise gewinnt, entscheidet derselbe Dijkstra wie sonst. Er
 * darf dabei auch etwas Drittes wählen (ein Stück Straße, dann quer), und das wäre dann die richtige
 * Antwort, nicht ein Fehler.
 *
 * $fromPoint/$toPoint sind die Koordinaten der beiden Endknoten -- bei einem Ort seine eigenen, bei
 * einem angeklickten Kartenpunkt dessen.
 */
function avesmapsMaybeOfferOffroadDetour(
    array &$clientGraph,
    array $request,
    array $water,
    ?PDO $pdo,
    array $segments,
    array $fromPoint,
    array $toPoint,
    string $fromNode,
    string $toNode,
    bool $terrainEnabled = true,
    array $riverLines = []
): array {
    $x1 = (float) ($fromPoint['x'] ?? 0.0);
    $y1 = (float) ($fromPoint['y'] ?? 0.0);
    $x2 = (float) ($toPoint['x'] ?? 0.0);
    $y2 = (float) ($toPoint['y'] ?? 0.0);
    $air = hypot($x2 - $x1, $y2 - $y1);
    $travelled = avesmapsRouteMeasureTravelledDistance($segments);
    $graphTime = avesmapsRouteMeasureTravelledTime($segments);

    $report = [
        'checked' => true,
        'air_distance' => $air,
        'travelled_units' => $travelled,
        'graph_cost_units' => $graphTime,
        'threshold' => AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD,
        'ratio' => $air > 1e-9 ? $travelled / $air : null,
        'triggered' => false,
        'offered' => false,
        'reason' => '',
    ];

    if ($segments === []) {
        $report['reason'] = 'no_route';
        return $report;
    }
    // Zwei Orte auf demselben Punkt (und der Fall „Route der Länge null"). Kein Verhältnis, keine
    // Division -- und nichts, was ein Querweg verbessern könnte.
    if ($air <= 1e-9) {
        $report['reason'] = 'no_air_distance';
        return $report;
    }
    // `triggered` beschreibt weiterhin die Sehne über die GANZE Reise -- so steht es in jedem
    // bisherigen Protokoll und in den Messungen der Instruction.
    $report['triggered'] = $report['ratio'] > AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD;

    // ⚠️ ABER DER FRÜHE AUSSTIEG IST WEG (14.08.2026). Eine Reise, die im Ganzen harmlos aussieht,
    // kann in der Mitte einen absurden Bogen fahren -- bei 1,5x gesamt und 8x auf einem Teilstück
    // stieg der Auslöser vorher aus, bevor er das Teilstück je gesehen hatte. Die Kandidatensuche
    // unten ist reine Arithmetik über eine Kette, die ohnehin vorliegt; teuer wird erst der A*, und
    // den schneiden dieselben zwei Schranken ab wie vorher.
    $chain = avesmapsRouteChordChain($segments, $fromPoint, $toPoint, $fromNode, $toNode);
    $report['chord_nodes'] = array_column($chain, 'name');

    // ⭐ WAS DER QUERWEG BESTENFALLS SCHAFFT -- und das weiß man vor der Suche. Der A*-Weg ist nie
    // kürzer als die Luftlinie, und sein kleinster möglicher Faktor ist EXAKT 1,0: das
    // Leistungskilometer-Modell hat keinen Boden (`terrain-factor.php:60-63`) und Landschaftsfaktoren
    // werden seit dem 14.08.2026 als `Basis ÷ terrain_speed_factor` geladen, gefiltert auf
    // `terrain_speed_factor < Basis` (`offroad-data.php`) -- der Quotient ist damit von Bauart wegen
    // > 1; vorher kam dieselbe Garantie aus `offroad_factor > 1.00`. Das ist dieselbe
    // Ungleichung, mit der `offroad-grid.php:315` die A*-Heuristik als zulässig begründet -- hier
    // einmal auf die ganze Strecke angewandt statt je Zelle.
    //
    // Liegt schon diese Bestzeit über der Graph-Route, KANN die Suche nicht gewinnen. Sie zu
    // starten hieße, eine Kiste zu rastern und zwei Rasterabfragen zu stellen, um am Ende `slower`
    // zu sagen.
    //
    // ⚠️ WIE VIEL DAS SPART, IST IN DER ANTWORTZEIT NICHT ZU SEHEN, und wer danach sucht, hält die
    // Schranke für wirkungslos. Gemessen an Rovik -> Skarsten, drei Sonden vorher und nachher:
    // 1,54/1,45/1,41 gegen 1,51/1,53/1,44 s -- unverändert. Die Antwort wird vom Laden der
    // Feature-Tabelle bestimmt (~1,5 s, §5.8 der Instruction), und die gesparte Suche liegt nach der
    // V14-Messung bei p50 14 ms. Der Gewinn ist Serverarbeit unter Last, nicht Wartezeit für den
    // einzelnen Fragenden -- und auf einem Shared Host ist genau das die knappe Ressource.
    //
    // ⚠️ Praktisch trifft das Wasserwege, ohne ein Sonderfall für sie zu sein: bei Tempo 4 auf der
    // Straße greift die Schranke nur zwischen dem 3,0- und dem 3,2-fachen Bogen, bei einem Seeweg
    // mit Tempo 10 bis zum ACHTFACHEN. Genau dort läuft der A* heute leer -- Flüsse mäandern,
    // Küsten sind gebogen, die Schwelle wird dauernd überschritten. Ein Filter „Route ist
    // überwiegend Wasser" wäre dagegen falsch: ein Flussweg um einen kleinen See, an dem ein kurzer
    // Landweg wirklich schneller ist, fiele mit heraus.
    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = $transport === null
        ? null
        : avesmapsTravelValuesSpeed($transport, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE);
    if ($speed === null || $speed <= 0.0) {
        // Querfeldein ist für dieses Verkehrsmittel gar nicht vorgesehen. Dann gibt es nichts
        // anzubieten -- und der A* würde unten ohnehin an derselben Stelle aussteigen.
        $report['reason'] = 'no_offroad_route';
        return $report;
    }
    // 💣 DASSELBE TEMPO WIE DIE SUCHE, aus derselben Tabelle. Ein anderes -- etwa das der Straße --
    // machte die Schranke unscharf, und unscharf heißt hier: sie schnitte einen Querweg ab, der
    // gewonnen hätte.
    $report['best_possible_cost_units'] = $air / (float) $speed;

    // Reißt die Kette (Etappe ohne Geometrie, Knotenname passt nicht), gibt es keine Sehnen. Dann
    // bleibt genau das Verhalten von vor dem 14.08.2026 -- ein stiller Rückfall, kein Fehler.
    if ($chain === []) {
        $report['reason'] = $report['best_possible_cost_units'] >= $graphTime ? 'cannot_win' : 'no_chain';
        return $report;
    }

    // Ab hier kostet es. Ein eigener Kantenname, damit der Querweg zweier Kartenpunkte
    // (`offroad-direct`) nicht überschrieben wird, wenn beides in derselben Anfrage zusammentrifft.
    //
    // 🔴 UND ES IST NICHT MEHR EINE KANTE, SONDERN BIS ZU K (14.08.2026). Vorher hing hier genau
    // `$fromNode -> $toNode`; damit hatte der Dijkstra zwei Angebote -- alles über Wege oder alles
    // querfeldein -- und kein drittes. Salmingen -> Luring lief deshalb komplett querfeldein,
    // obwohl die Reichsstraße 6 das letzte Drittel trägt. Der Kommentar unten versprach schon
    // immer, er dürfe „ein Stück Straße, dann quer" wählen; erst jetzt KANN er es.
    // Entwurf: docs/superpowers/specs/2026-08-14-querfeldein-teilstrecken-design.md
    $candidates = avesmapsRouteChordCandidates($chain, (float) $speed, AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD);
    $report['chord_candidate_count'] = count($candidates);
    // 🔴 Die Owner-Regel, und zwar VOR dem Deckel: sonst verbrauchten Sehnen zwischen zwei
    // angebundenen Orten die drei Plätze, und die eine Sehne, die einen Ort ohne Anschluss erreicht,
    // fiele als vierte heraus.
    $candidates = avesmapsRouteKeepChordsWithOffNetworkEnd(
        is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [],
        $candidates
    );
    $report['chord_offnetwork_count'] = count($candidates);
    // ⭐ UND VOR DEM A*, nicht nach ihm. Der Vorfilter ist gratis, die Suche kostet p50 14 ms je Lauf;
    // eine Regel, die erst das Ergebnis verwirft, wäre eine Verteuerung des Servers statt einer
    // Ersparnis. `both_ends_on_network` unterscheidet diesen Ausgang von `cannot_win` (Schranke) und
    // `slower` (gerechnet und verloren) -- sonst wäre in den Protokollen nicht mehr zu sehen, welche
    // der drei Absagen gefallen ist.
    if ($candidates === [] && $report['chord_candidate_count'] > 0) {
        $report['reason'] = 'both_ends_on_network';
        return $report;
    }
    $candidates = array_slice($candidates, 0, AVESMAPS_ROUTE_OFFROAD_DETOUR_MAX_CHORDS);

    $chords = [];
    $offered = 0;
    $lastError = '';
    foreach ($candidates as $candidate) {
        // Die Sehne über die ganze Reise behält ihren angestammten Kantennamen -- er steht in jeder
        // bisherigen Antwort als `edge_id` und in den Protokollen.
        $isWhole = $candidate['from_index'] === 0 && $candidate['to_index'] === count($chain) - 1;
        $connectionId = $isWhole
            ? 'offroad-detour'
            : sprintf('offroad-detour-%d-%d', $candidate['from_index'], $candidate['to_index']);

        $offroad = avesmapsConnectOffroadPoints(
            $clientGraph, $request, $water, $pdo,
            ['x' => $chain[$candidate['from_index']]['x'], 'y' => $chain[$candidate['from_index']]['y']],
            ['x' => $chain[$candidate['to_index']]['x'], 'y' => $chain[$candidate['to_index']]['y']],
            $candidate['from_node'], $candidate['to_node'], $terrainEnabled,
            $connectionId, $riverLines
        );
        if (empty($offroad['ok'])) {
            // Kein trockener Weg durch die Kiste. Die gezeichnete Route bleibt die Antwort -- das ist
            // dieselbe Owner-Entscheidung wie bei den Notbrücken: lieber der Umweg als eine Linie, die
            // durchs Wasser führt.
            $lastError = (string) ($offroad['error'] ?? 'no_offroad_route');
            $chords[] = $candidate + ['connection_id' => $connectionId, 'offered' => false, 'reason' => $lastError];
            continue;
        }

        // ⚠️ `offroad` heißt „ein A* IST gelaufen", nicht „er hat gewonnen" -- daran unterscheidet die
        // Antwort `slower` von `cannot_win`, und daran hängt die Messung, wie oft die Suche leer
        // läuft. Ein späterer Gewinner überschreibt den Verlierer, solange keiner gewonnen hat.
        if ($offered === 0) { $report['offroad'] = $offroad; }

        // 💣 DIE ZWEITE PRÜFUNG IST DIE ZEIT, und ohne sie wäre der Auslöser falsch. Ein Bogen von 3x
        // ist gegen ein dreimal langsameres Gelände immer noch die schnellere Reise. Verliert der
        // Querweg, wird die Kante wieder ausgehängt -- ein Angebot, das nie gewinnen kann, ist nur
        // Gewicht im Graphen und würde bei „Kürzeste" sogar fälschlich gewinnen.
        // ⚠️ Je Sehne gegen IHRE Teilstrecke, nie gegen die Zeit der ganzen Route: sonst schlüge eine
        // kurze Abkürzung jede lange Reise.
        if ((float) $offroad['cost_units'] >= $candidate['graph_cost_units']) {
            avesmapsRemoveClientRouteConnection(
                $clientGraph['graph'], $candidate['from_node'], $candidate['to_node'], $connectionId
            );
            $chords[] = $candidate + ['connection_id' => $connectionId, 'offered' => false, 'reason' => 'slower', 'offroad' => $offroad];
            continue;
        }

        $chords[] = $candidate + ['connection_id' => $connectionId, 'offered' => true, 'reason' => 'offered', 'offroad' => $offroad];
        // Der beste Lauf steht weiterhin unter `offroad` -- die Antwort und die Protokolle lesen ihn
        // dort, und „der beste" ist nach der Sortierung der erste, der gewinnt.
        if ($offered === 0) { $report['offroad'] = $offroad; }
        $offered++;
    }

    $report['chords'] = $chords;
    if ($offered > 0) {
        $report['offered'] = true;
        $report['reason'] = 'offered';
        return $report;
    }

    $report['reason'] = $chords === [] ? 'cannot_win' : ($lastError !== '' ? $lastError : 'slower');

    return $report;
}

/**
 * PURE: die Koordinaten eines Routen-Endpunkts als `['x' => .., 'y' => ..]`, oder null.
 *
 * Ein angeklickter Kartenpunkt bringt sie mit; ein Ort wird im Bestand nachgeschlagen. `null` heißt
 * „nicht auffindbar" und schaltet den Auslöser für diese Anfrage einfach ab -- ein Endpunkt ohne
 * Koordinaten hat keine Luftlinie, über die sich ein Bogen beurteilen ließe.
 */
function avesmapsRouteResolveEndpointPoint(array $locations, string $name, ?array $mapPoint): ?array
{
    if (is_array($mapPoint) && isset($mapPoint['x'], $mapPoint['y'])) {
        return ['x' => (float) $mapPoint['x'], 'y' => (float) $mapPoint['y']];
    }
    foreach ($locations as $location) {
        if (trim((string) ($location['name'] ?? '')) !== $name) { continue; }
        $coordinates = $location['geometry']['coordinates'] ?? null;
        if (is_array($coordinates) && count($coordinates) >= 2) {
            return ['x' => (float) $coordinates[0], 'y' => (float) $coordinates[1]];
        }
        if (isset($location['route_x'], $location['route_y'])) {
            return ['x' => (float) $location['route_x'], 'y' => (float) $location['route_y']];
        }
    }

    return null;
}

// avesmapsRemoveClientRouteConnection() ist am 14.08.2026 nach client-graph.php gewandert: der
// Teiler dort (avesmapsSplitClientPathAtAnchor) braucht sie ebenfalls, und die Abhaengigkeit laeuft
// nur in eine Richtung -- detour.php -> offroad-leg.php -> client-graph.php. Zwei Abschriften
// derselben Graph-Operation waeren zwei Abschriften zu viel.
