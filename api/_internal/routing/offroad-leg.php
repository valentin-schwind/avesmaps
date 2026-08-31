<?php

declare(strict_types=1);

// V14 / „Hierher reisen": hang an arbitrary map point onto the route graph.
// Instruction: docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md §2.
//
// PURITY CONTRACT: side-effect-free on include. The PDO is optional and only used to fetch the two
// box-limited inputs (height rasters, terrain factors); without it the A* still runs and simply
// prices flat, unlandscaped ground.
//
// ⭐ THE WHOLE TRICK IS THAT THERE IS NO TRICK. The clicked point becomes a NODE with exactly one
// edge -- the A* way to the nearest graph node -- and then the existing Dijkstra, the existing
// segment builder and the existing renderer do their usual work. No second route assembler, no
// special case in the response, and V10 („führt durch"), V11 (terrain) and the travel time all read
// the leg's geometry exactly as they read a drawn way's.

require_once __DIR__ . '/client-graph.php';
require_once __DIR__ . '/travel-values.php';
require_once __DIR__ . '/land-areas.php';
require_once __DIR__ . '/offroad-data.php';
require_once __DIR__ . '/offroad-grid.php';

// The node name the clicked point is inserted under. Leading underscores, like `__wp_anchor_N`:
// no real location can carry it, so it can never collide with a place called „Kartenpunkt".
const AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX = '__offroad_';

// Wie viele Ortsknoten ueberhaupt eingesammelt werden, bevor geordnet wird.
const AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT = 12;

// Wie viele der NAECHSTEN Kandidaten wirklich durchgerechnet werden.
//
// 🔴 DER AUSSTIEG IST DER NAECHSTE ERREICHBARE PUNKT DES NETZES -- eine Ordnung, keine Auswahl.
// Owner-Entscheid 15.08.2026, woertlich: „er soll auf dem strassensystem bleiben bis zu dem punkt
// gehen wo er am naechsten zur freien zielmarkierung ist und von dort durch wieder durch die
// landschaft." Gerechnet werden trotzdem diese N, damit ein querfeldein UNERREICHBARER naechster
// Punkt (Fluss, See, Gebirge) nicht die ganze Reise kostet; genommen wird der erste, der geht.
//
// 🪤 DIESER BLOCK STAND BIS ZUM 15.08.2026 GENAU ANDERSHERUM. Er sagte: „Jetzt bekommt der Punkt
// eine Kante je Kandidat, und DIJKSTRA sucht sich den Ausstieg aus -- nach den Gesamtkosten der
// Reise, nicht nach der Luftlinie." Das war eine Entscheidung, keine Panne, und sie ist an einer
// Live-Route widerlegt worden: 19,44 Meilen querfeldein ab Salmingen, waehrend 0,66 Meilen vor dem
// Ziel eine Strasse lag. Ein Ersparnis-Argument, das man dem Reisenden nicht erklaeren kann, ist im
// Zweifel falsch.
//
// ⚠️ Die zwei Fehler der ALLERERSTEN Fassung kommen dadurch NICHT zurueck, und das ist der
// Unterschied: die haengte den Punkt an die naechste ORTSCHAFT, die weit weg und in der falschen
// Richtung liegen konnte -- daher das Zuruecklaufen. Hier ist der eine Knoten ein Punkt AUF einem
// Weg und liegt dem Ziel per Definition am naechsten; zurueckzulaufen gibt es nichts. Und der
// zweite Kartenpunkt haengt seit dem 14.08.2026 an seiner eigenen direkten Kante (Erzeuger 4).
const AVESMAPS_ROUTE_OFFROAD_EXIT_NEAREST_TRIES = 6;


/**
 * PURE: the nearest graph nodes to (x, y), by air line, nearest first, at most $limit of them.
 *
 * 🔴 GRAPH NODE, NOT „nearest NAMED place" -- owner, this session: „Dijkstra bis zum nächsten
 * Graphknoten, dann querfeldein per A*". The instruction (§2) left the two readings open and marked
 * the decision as the owner's; this is it. Crossings are graph nodes and are therefore candidates,
 * which also keeps the cross-country leg as short as it can be.
 *
 * 💣 The client's findNearestLocationToLatLng excludes crossings BY NAME (`/^Kreuzung(-\d+)?$/i`)
 * and its own file header admits ~200 `Kreuzung-auto-<n>` slip through. That filter is not copied
 * here -- not because it is broken, but because this function asks a different question.
 *
 * Only nodes that are actually IN the graph count: a location the domain filter dropped (a Seeweg-only
 * island in a land-only request) is not somewhere a traveller can be dropped off.
 */
function avesmapsFindNearestOffroadExitNodes(
    array $graph,
    array $locations,
    float $x,
    float $y,
    int $limit = AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT
): array {
    $candidates = [];
    $nurWasser = [];
    foreach ($locations as $location) {
        $name = trim((string) ($location['name'] ?? ''));
        if ($name === '' || !isset($graph[$name])) { continue; }
        // 🔴 NUR KNOTEN MIT EINER LANDWEGKANTE. Ein Fussgaenger, der querfeldein laeuft und „das Netz
        // erreicht", steht sonst an einem FLUSSKNOTEN -- am Wasser, nicht an einer Strasse.
        //
        // 🪤 Gemessen am 16.08.2026: `Kreuzung-7911` lag 13,8 Meilen von einem Kartenpunkt entfernt
        // und war damit der naechste Ausstieg. Von dort sind es 208,0 Meilen nach Albenhus (109 davon
        // Gebirgspass), waehrend Pfalz Albengau 18,3 Meilen entfernt liegt und 83,9 Meilen. Die Reise
        // wurde dadurch 256,6 statt rund 120 Meilen lang. Die Kreuzung hat KEINE Landwegkante -- sie
        // ist ein Knoten des Flussnetzes; der Router musste sie selbst per 21-Meilen-Querfeldein-Anker
        // anbinden, als sie einmal Start einer Reise war.
        //
        // ⚠️ Die Pruefung gibt es seit dem 14.08.2026 (Sehnen-Regel); sie wurde hier nur nie gefragt.
        // ⚠️ Ein Ort, der AUSSCHLIESSLICH am Wasser haengt, faellt damit als Ausstieg weg. Am
        // Livebestand gemessen, damit die Zahl nicht behauptet ist: `land_isolated_locations` in den
        // Graph-Statistiken.
        $coordinates = $location['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) { continue; }
        $nodeX = (float) $coordinates[0];
        $nodeY = (float) $coordinates[1];
        $eintrag = ['name' => $name, 'x' => $nodeX, 'y' => $nodeY, 'distance' => hypot($nodeX - $x, $nodeY - $y)];
        if (avesmapsClientNodeHasLandPathEdge($graph, $name)) { $candidates[] = $eintrag; }
        else { $nurWasser[] = $eintrag; }
    }

    // 🔴 VORRANG, KEIN VERBOT. Gibt es UEBERHAUPT keinen Knoten mit Landweg -- eine Insel, deren
    // Orte nur am Seeweg haengen --, dann waere ein Verbot eine Absage, wo es heute eine Route gibt.
    // Genau das haelt der Rueckfall-Fall in offroad-leg-test.php fest, und er ist beim Bau dieser
    // Zeile rot geworden.
    if ($candidates === []) { $candidates = $nurWasser; }

    usort($candidates, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);

    return array_slice($candidates, 0, max(1, $limit));
}

/**
 * Attach the clicked point to the graph as a node with one cross-country edge.
 *
 * Returns a report; `ok` false carries a machine `error` code the caller turns into an API error:
 *   * `point_not_on_land`   -- §1, the only check that exists, and it guards ONLY this point
 *   * `offroad_transport_not_allowed` -- das Regelwerk verbietet diesem Verkehrsmittel die Wegart
 *                              (die Kutsche faehrt nicht querfeldein). Eine Absage ueber die
 *                              ANFRAGE, nicht ueber den Punkt: kein anderer Punkt hilft.
 *   * `no_exit_node`        -- the graph is empty (no stock, or every domain switched off)
 *   * `no_offroad_route`    -- the A* found no dry way inside the box
 *
 * 💣 THE LAND CHECK COMES FIRST, BEFORE EVERYTHING. No Dijkstra, no grid, no A* for a point in the
 * sea -- both because it is wasted work and because the honest answer is „pick a point on land",
 * not a route that ends in the water.
 *
 * 💣 AND IT IS ASKED OF THIS POINT ONLY. Places are never tested. Owner, verbatim: „ORTE IM WASSER
 * sind nicht zu überprüfen, diese können per Straße immer erreicht werden."
 */
function avesmapsAttachOffroadPointToGraph(
    array &$clientGraph,
    array $locations,
    array $request,
    array $water,
    array $land,
    ?PDO $pdo,
    float $x,
    float $y,
    string $nodeName,
    bool $terrainEnabled = true,
    // Die Gewaesserlinien in ihren zwei Rollen: 'wand' sperrt (Fluss, Entwurf
    // 2026-08-15-fluesse-sperren), 'furt' kostet nur (Bach, 30.08.2026). Ein Bund, kein zweiter
    // Parameter -- die Begruendung steht bei avesmapsCollectRouteRiverBarrierLines.
    array $gewaesser = []
): array {
    if (!avesmapsRoutePointIsOnLand($x, $y, $land, $water)) {
        return ['ok' => false, 'error' => 'point_not_on_land'];
    }

    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    // 🔴 ERZEUGER 3 VON 4, und bis zum 14.08.2026 einer der beiden ungesicherten. Die Wegart muss
    // dieses Verkehrsmittel ueberhaupt tragen duerfen -- eine Kutsche faehrt nicht querfeldein.
    //
    // 💣 EIN TEMPO ZU HABEN IST KEINE ERLAUBNIS. Genau darauf ist dieser Erzeuger hereingefallen: er
    // fragte nur die Tempotabelle, und dort steht fuer die Kutsche querfeldein 3,84. Die Sperre steht
    // woanders (avesmapsClientRouteTransportOptions), also lief die Pruefung unten glatt durch und
    // „Hierher reisen" fuhr die Kutsche quer ueber die Wiese -- live gemessen an diesem Tag: Luring
    // auf einen Kartenpunkt, HTTP 200, zwei Etappen, eine davon Querfeldein.
    //
    // ⚠️ VOR der Ausstiegssuche, nicht danach: die teilt Wege (avesmapsSplitClientPathAtAnchor) und
    // liesse sonst halbierte Wege in einem Graphen zurueck, der die Kante nie bekommt.
    if ($transport !== null && !avesmapsIsClientTransportAllowedForPath(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $transport)) {
        return ['ok' => false, 'error' => 'offroad_transport_not_allowed'];
    }
    $speed = $transport === null
        ? null
        : avesmapsTravelValuesSpeed($transport, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE);
    if ($speed === null || $speed <= 0.0) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    // 🔴 „KUERZESTE“ GILT AUCH IM GELAENDE. Bis zum 15.08.2026 befolgte nur der Wegegraph das
    // `optimize` (client-graph.php:1809); der A* rechnete immer zeitoptimal, und die Querfeldein-
    // Kante trug damit die Laenge eines Weges, der auf SCHNELLIGKEIT gelegt war -- an der
    // Referenzroute des Owners 12,217 Einheiten gegen eine Luftlinie von 8,609. Das war nicht nur
    // eine falsche Anzeige: mit dieser aufgeblaehten Laenge trat die Kante gegen die Strassen an.
    $weightByDistance = (string) ($request['optimize'] ?? 'fastest') === 'shortest';

    $graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];

    // 🔴 DIE AUSSTIEGE SIND PUNKTE AUF WEGEN, NICHT ORTSCHAFTEN (Owner, 14.08.2026) -- und seit dem
    // 15.08.2026 ist es JEDER GEZEICHNETE PUNKT eines Wegstuecks, nicht nur der zielnaechste.
    // Vorher bot ein Wegstueck genau einen an; verlor der gegen den Direktweg, war die Strasse fuer
    // diese Reise verschwunden. Owner, wortwoertlich: „es gibt kein ausstieg heute." Gemessen an
    // Salmingen -> Kartenpunkt (504.530, 501.076): 42,06 Meilen querfeldein NEBEN dem Talloner
    // Huegelsteig her, den die Reise nie betrat.
    //
    // ⚠️ ERST SAMMELN UND FILTERN, DANN TEILEN. Bis zum 15.08.2026 wurde geteilt und danach
    // gefiltert; bei EINEM Kandidaten je Weg war das gleichgueltig, bei bis zu 24 hiesse es, eine
    // Strasse fuer Punkte zu zerschneiden, die ohnehin herausfallen.
    $candidateSets = avesmapsCollectClientLandPathExitCandidates($graph, $x, $y, AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT);
    $nodeCandidates = avesmapsFindNearestOffroadExitNodes($graph, $locations, $x, $y);

    $anchorPointCount = 0;
    $verticesCapped = 0;
    $nearestVertexDistance = INF;
    foreach ($candidateSets as $set) {
        $anchorPointCount += count($set['cuts']);
        $verticesCapped += (int) $set['capped'];
        foreach ($set['cuts'] as $cut) { $nearestVertexDistance = min($nearestVertexDistance, (float) $cut['distance']); }
    }
    if ($anchorPointCount === 0 && $nodeCandidates === []) {
        return ['ok' => false, 'error' => 'no_exit_node'];
    }

    // ⚠️ ZWEI STUFEN, und die zweite ist eine Rettung, kein Luxus. Die Entfernungsschranke haelt die
    // gemeinsame Suchkiste klein -- sie spannt ueber den Punkt UND alle Kandidaten. Wenn aber KEINER
    // der nahen querfeldein erreichbar ist (ein Ort mitten in einem See), waere die Antwort sonst
    // „kein Weg", obwohl der uebernaechste gegangen waere.
    //
    // 🔴 SEIT DEM 15.08.2026 GILT: DER AUSSTIEG IST DER NAECHSTE ERREICHBARE PUNKT DES NETZES.
    // Nicht der guenstigste, nicht der einer Familie, und vor allem KEINE Auswahl des Dijkstra.
    // Owner, woertlich: „er soll auf dem strassensystem bleiben bis zu dem punkt gehen wo er am
    // naechsten zur freien zielmarkierung ist und von dort durch wieder durch die landschaft."
    //
    // Der Befund dahinter, live gemessen (Kartenpunkt 500.792/503.167 -> 503.521/519.479): am Ziel
    // lag ein Ausstieg 0,219 Einheiten entfernt -- 0,66 Meilen, das Ziel liegt praktisch an der
    // Strasse -- und die Reise stieg stattdessen bei Salmingen aus und lief 19,44 Meilen
    // querfeldein. Am anderen Ende nahm sie Rang 26 von 35 (Luftlinie 9,94 statt 5,79). Beides war
    // rechnerisch richtig und als Reise nicht erklaerbar.
    //
    // 💣 UND DESHALB GIBT ES HIER KEINEN FAKTOR MEHR -- ein Faktor kann diese Aufgabe nicht loesen.
    // Der Kopf dieser Datei haelt fest, dass der Owner am 14.08.2026 einen Knoten bei 1,77x der
    // naechsten Luftlinie ERWARTET hat; am 15.08. stoert ihn einer bei 1,72x. Keine Schranke der
    // Form „hoechstens F mal der naechste" erfuellt beides, weil sich der MASSSTAB zwischen den
    // beiden Faellen geaendert hat (damals Ortsknoten, heute jeder gezeichnete Stuetzpunkt). Genau
    // davor warnt die Lehre vom 14.08.: eine relative Schranke braucht einen Massstab, der nicht
    // mitwandert. Es gibt hier keinen -- also wird nicht gebandet, sondern GEORDNET.
    //
    // ⚠️ Gerechnet werden trotzdem die N naechsten, nicht nur einer: liegt der naechste querfeldein
    // gar nicht erreichbar (Fluss, See, Gebirge), rueckt der naechste ERREICHBARE nach -- nicht
    // irgendein frueherer, insgesamt billigerer. Das ist Punkt 6 der Owner-Regel, und es kostet
    // nichts: ein Kandidat mehr ist im Mehrziel-Lauf ein Nachschlagen.
    $alleDistanzen = [];
    foreach ($candidateSets as $set) {
        foreach ($set['cuts'] as $cut) { $alleDistanzen[] = (float) $cut['distance']; }
    }
    foreach ($nodeCandidates as $node) { $alleDistanzen[] = (float) $node['distance']; }
    sort($alleDistanzen);
    $reach = $alleDistanzen === []
        ? INF
        : $alleDistanzen[min(count($alleDistanzen), AVESMAPS_ROUTE_OFFROAD_EXIT_NEAREST_TRIES) - 1];

    // 💣 GETEILT WIRD IN $clientGraph['graph'], NICHT in $graph -- das ist eine Kopie, und ein Split
    // darin waere nach der Funktion verschwunden.
    // 💣 EIN DURCHGANG JE WEGSTUECK. Der Einzelteiler entfernt die Ursprungskante, sobald beide
    // Haelften stehen -- k Aufrufe hintereinander haengen die spaeteren Punkte ins Leere.
    $buildCandidates = static function (float $limit) use (&$clientGraph, $candidateSets, $nodeCandidates): array {
        $candidates = [];
        foreach ($candidateSets as $set) {
            $kept = array_values(array_filter(
                $set['cuts'],
                static fn(array $cut): bool => (float) $cut['distance'] <= $limit + 1e-9
            ));
            if ($kept === []) { continue; }
            $split = avesmapsSplitClientPathAtPoints($clientGraph['graph'], $set['anchor'], $kept);
            foreach ($split as $index => $node) {
                if ((string) $node['name'] === '') { continue; }
                $candidates[] = [
                    'name' => (string) $node['name'], 'x' => (float) $node['x'], 'y' => (float) $node['y'],
                    'distance' => (float) $kept[$index]['distance'],
                ];
            }
        }
        foreach ($nodeCandidates as $node) {
            if ((float) $node['distance'] > $limit + 1e-9) { continue; }
            $candidates[] = $node;
        }
        // Ein Punkt, der auf einem Endknoten liegt, TRAEGT dessen Namen (der Teiler gibt ihn dann
        // unveraendert zurueck) -- ohne Entdopplung liefe der Suchlauf zweimal zum selben Ziel.
        $byName = [];
        foreach ($candidates as $candidate) {
            $name = (string) $candidate['name'];
            if (!isset($byName[$name]) || (float) $byName[$name]['distance'] > (float) $candidate['distance']) {
                $byName[$name] = $candidate;
            }
        }
        $out = array_values($byName);
        usort($out, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);
        return $out;
    };

    // 🔴 EINE KISTE FUER ALLE KANDIDATEN, und deshalb auch nur EIN Satz Datenbankabfragen.
    $box = [];
    $rasters = [];
    $factors = '';
    $exits = [];
    $offered = 0;
    $unreachable = 0;
    $nearestAir = null;
    $kandidaten = [];
    foreach ([$reach, INF] as $stageLimit) {
        if ($exits !== []) { break; }
        $set = $buildCandidates($stageLimit);
        if ($set === []) { continue; }
        $offered = count($set);

        $spanMinX = $x; $spanMaxX = $x; $spanMinY = $y; $spanMaxY = $y;
        foreach ($set as $candidate) {
            $spanMinX = min($spanMinX, $candidate['x']); $spanMaxX = max($spanMaxX, $candidate['x']);
            $spanMinY = min($spanMinY, $candidate['y']); $spanMaxY = max($spanMaxY, $candidate['y']);
        }
        $box = avesmapsBuildOffroadBox($spanMinX, $spanMinY, $spanMaxX, $spanMaxY);
        // 🔴 DER EINE ERZEUGER DER EBENEN (offroad-data.php) -- Sperre, Faktoren samt Bach-Aufschlag,
        // Hoehen und der Gelaende-Notschalter in einem Griff, fuer alle drei Zusammenbau-Stellen
        // gleich. Bis zum 30.08.2026 standen dieselben vier Zeilen dreimal da.
        $ebenen = avesmapsOffroadBuildPlanes($box, $water, $pdo, $gewaesser, $terrainEnabled);
        $blocked = $ebenen['blocked'];
        $factors = $ebenen['factors'];
        $rasters = $ebenen['rasters'];
        $heights = $ebenen['heights'];

        $clientGraph['graph'][$nodeName] ??= [];

        // 🔴 EIN LAUF FUER ALLE. Bis zum 15.08.2026 lief hier ein A* JE KANDIDAT -- an der Route des
        // Owners gemessen 15 Suchen je Anfrage durch dasselbe Gelaende. Genau das macht „jeder
        // gezeichnete Punkt ist ein Kandidat" bezahlbar: ein Kandidat mehr ist ein Nachschlagen.
        // ⭐ IM STRECKENMODUS ERST DIE GERADEN. Die kuerzeste Verbindung zweier Punkte ist die
        // Strecke zwischen ihnen; ist sie trocken, gibt es nichts zu suchen. Nur die nassen
        // Kandidaten kommen ueberhaupt in den Suchlauf. Im Zeitmodus faellt dieser Block weg.
        $goals = [];
        $paths = [];
        foreach ($set as $index => $candidate) {
            if ($weightByDistance) {
                $gerade = avesmapsOffroadStraightPathIfDry($box, $water, $factors, $heights,
                    (float) $speed, $candidate['x'], $candidate['y'], $x, $y,
                    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters, $ebenen['wand'],
                    $ebenen['furtlinien']);
                if ($gerade !== null) { $paths[$index] = $gerade; continue; }
            }
            $goals[$index] = ['x' => $candidate['x'], 'y' => $candidate['y']];
        }
        if ($goals !== []) {
            // 💣 `+` (Vereinigung), NICHT array_merge: die Schluessel sind die Kandidaten-Indizes.
            // array_merge numeriert sie neu, und danach zeigt jede Kante auf den falschen Ausstieg.
            $paths += avesmapsOffroadFindPathsFromPoint($box, $blocked, $factors, $heights,
                (float) $speed, $x, $y, $goals, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters,
                $weightByDistance, $ebenen['furt']);
        }

        // 🔴 GENAU EINE KANTE, UND ZWAR ZUM NAECHSTEN ERREICHBAREN. $set ist nach Entfernung
        // geordnet (siehe $buildCandidates), also ist der erste mit einem Weg der richtige. Bis zum
        // 15.08.2026 bekam JEDER Kandidat seine Kante und der Dijkstra suchte sich den Ausstieg nach
        // Gesamtkosten aus -- das ist die Freiheit, die 19,44 Meilen querfeldein erzeugt hat,
        // waehrend 0,66 Meilen vor dem Ziel eine Strasse lag.
        //
        // 💣 DAS `break` IST DIE GANZE REGEL. Ohne es waeren alle uebrigen Kandidaten weiterhin im
        // Graphen, und der Dijkstra duerfte wieder waehlen -- die Ordnung hier waere dann nur
        // Zierat. Wer spaeter „nur zur Sicherheit" eine zweite Kante anhaengt, hat die Regel
        // aufgehoben, ohne eine Zeile Kommentar zu aendern.
        //
        // ⚠️ Die Reise auf dem Netz bis dorthin sucht weiterhin der Dijkstra. Er entscheidet, WIE
        // man zum Abgangspunkt kommt -- nur nicht mehr, WANN man den Weg verlaesst.
        // 💣 UND ER SAGT, WIE VIELE NAEHERE ER UEBERSPRINGEN MUSSTE. Ohne diese Zahl ist die Antwort
        // nicht von „es gab nichts Naeheres" zu unterscheiden -- und genau das kostete am 16.08.2026
        // vier Messungen: ein Zielpunkt neben Pfalz Albengau stieg 17,4 Meilen entfernt aus und lief
        // dadurch das 3,3-Fache der Luftlinie, weil die naeheren Kandidaten querfeldein unerreichbar
        // waren (ein Fluss dazwischen). Der Bericht nannte nur den GEWAEHLTEN.
        $nearestAir = $set !== [] ? (float) $set[array_key_first($set)]['distance'] : null;
        // ⭐ ALLE gerechneten Kandidaten mit ihrem Befund -- nicht nur der gewaehlte. Genau diese
        // Liste beantwortet die Frage "warum nicht der Weg da drueben": entweder er steht gar nicht
        // drin (dann ist die Kandidatenauswahl zu eng), oder er steht drin und war unerreichbar
        // (dann liegt ein Hindernis dazwischen). Ohne sie sind die beiden Faelle nicht zu trennen.
        foreach ($set as $index => $candidate) {
            $kandidaten[] = [
                'node' => (string) $candidate['name'],
                'air_distance' => (float) $candidate['distance'],
                'reachable' => isset($paths[$index]),
            ];
        }
        foreach ($set as $index => $candidate) {
            $path = $paths[$index] ?? null;
            if ($path === null) { $unreachable++; continue; }

            avesmapsAddOffroadEdge($clientGraph['graph'], $candidate['name'], $nodeName, $path, (string) $transport, 'offroad-' . $nodeName . '-' . $index);
            $exits[] = [
                'node' => $candidate['name'],
                'air_distance' => $candidate['distance'],
                'distance_units' => $path['distance'],
                'cost_units' => $path['time'],
                'point_count' => count($path['points']),
            ];
            break;
        }
    }

    if ($exits === []) {
        return [
            'ok' => false, 'error' => 'no_offroad_route',
            'cell_mapunits' => $box['cell'], 'cell_count' => $box['cell_count'],
            'exit_nodes_offered' => $offered,
            'exit_unreachable' => $unreachable,
            'exit_nearest_air' => $nearestAir,
            'exit_candidates' => $kandidaten,
            'exit_vertices_capped' => $verticesCapped,
        ];
    }

    return [
        'ok' => true,
        'node' => $nodeName,
        // 🔴 ALLE angebotenen Ausstiege, nicht „der eine". Welchen die Reise nimmt, entscheidet der
        // Dijkstra danach -- und genau diese Liste ist der Unterschied zwischen „er geht immer zu
        // demselben Pfadpunkt" und „er sucht sich einen aus".
        'exit_nodes' => $exits,
        'exit_nodes_offered' => $offered,
        // 🔴 WIE VIELE NAEHERE UNERREICHBAR WAREN. Ist das > 0, liegt zwischen dem Punkt und
        // seinem naechsten Netzpunkt ein Hindernis -- seit dem 15.08.2026 kann das ein FLUSS
        // sein. Ohne diese Zahl liest sich eine weite Anbindung wie eine schlechte Wahl,
        // obwohl sie die einzige moegliche war.
        'exit_unreachable' => $unreachable,
        'exit_nearest_air' => $nearestAir,
        'exit_candidates' => $kandidaten,
        'exit_vertices_capped' => $verticesCapped,
        'exit_nodes_connected' => count($exits),
        'nearest_exit_node' => $exits[0]['node'] ?? '',
        // 🔴 THE ANSWER SAYS WHICH CELL WIDTH IT USED. Over the cap the search coarsens for this one
        // request (instruction §2), and a route computed on a 1,0 grid is a different statement from
        // one computed on 0,5 -- at 1,0 the 24 narrowest lakes become walls.
        'cell_mapunits' => $box['cell'],
        'cell_count' => $box['cell_count'],
        'coarsened' => $box['coarsened'],
        'height_rasters' => count($rasters),
        'terrain_factors_known' => $factors !== '',
    ];
}

/**
 * Eine Querfeldein-Kante in beide Richtungen in den Graphen haengen.
 *
 * ⚠️ NO x25 SURCHARGE BY DEFAULT. AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR exists to
 * make REPAIR bridges unattractive -- a synthetic edge that merely patches a hole in the drawn
 * network should lose against any real road. A „Hierher reisen" leg is not a patch: the traveller
 * asked to go exactly there, and inflating it would only make the reported travel time wrong by a
 * factor of 25.
 *
 * $costFactor is for the ONE case where it IS a patch: Instruction C §3 rebuilds the straight chords
 * of the component bridge and the waypoint anchor with this same A*. Those stay repair bridges --
 * only their geometry becomes honest, not their standing against a real road.
 */
function avesmapsAddOffroadEdge(array &$graph, string $fromName, string $toName, array $path, string $transport, string $connectionId, float $costFactor = 1.0): void
{
    if ($costFactor <= 0.0) { $costFactor = 1.0; }
    $connection = [
        'distance' => $path['distance'] * $costFactor,
        // ⚠️ Der Faktor gilt auf die ZEIT genauso, sonst waere die Kante ueber `time` guenstiger als
        // ueber `distance` und „Schnellste" und „Kuerzeste" widersprächen sich an derselben Kante.
        'time' => $path['time'] * $costFactor,
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
        'transport_option' => $transport,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => '',
        'public_id' => '',
        'from' => $fromName,
        'to' => $toName,
        'geometry' => ['type' => 'LineString', 'coordinates' => $path['points']],
        'synthetic' => true,
        // The flag the leg's „wegloses Gelände" note hangs off (spec §5.7). The TEXT is German UI and
        // therefore lives in the client's i18n table, not in an API payload (AGENTS.md §8).
        'offroad' => true,
    ];

    // 💣 THE KEY IS ONLY SET WHEN THERE IS A MEASUREMENT. avesmapsBuildClientRouteDiagnosticSegments
    // reads these with `array_key_exists(...) ? (float) ... : null` -- so a key present with a null
    // value comes out as 0.0, which means „measured, and level". Along a stretch with no raster that
    // is a lie of exactly the kind V11 built the null/0 distinction to prevent.
    if ($path['ascent_schritt'] !== null) {
        $connection['ascent_schritt'] = $path['ascent_schritt'];
        $connection['descent_schritt'] = $path['descent_schritt'];
    }

    // Nur gesetzt, wo es etwas herauszurechnen gibt. Der Diagnosebauer liest mit Vorgabe 1,0, und
    // ein Feld, das ueberall steht, ist eine Behauptung mehr, die ueberall stimmen muss.
    if ($costFactor !== 1.0) { $connection['cost_factor'] = $costFactor; }

    $graph[$fromName] ??= [];
    $graph[$toName] ??= [];
    avesmapsAddClientCompatibleGraphConnection($graph, $fromName, $toName, $connection);

    // The reverse edge is the SAME line walked the other way -- the geometry is reversed so a route
    // that arrives at the point and one that starts there draw the same line, not a mirrored one.
    $reverse = $connection;
    $reverse['from'] = $toName;
    $reverse['to'] = $fromName;
    $reverse['geometry']['coordinates'] = array_reverse($path['points']);
    // 💣 Climb and descent SWAP when the direction does. Carrying them unchanged would report the
    // ascent of the opposite direction -- the exact class of error V11 §6.3 is about.
    if ($path['ascent_schritt'] !== null) {
        $reverse['ascent_schritt'] = $path['descent_schritt'];
        $reverse['descent_schritt'] = $path['ascent_schritt'];
    }
    avesmapsAddClientCompatibleGraphConnection($graph, $toName, $fromName, $reverse);
}

/**
 * Zwei angeklickte Kartenpunkte DIREKT verbinden, querfeldein.
 *
 * 🔴 OHNE DAS GIBT ES KEINEN WEG VON EINEM FREIEN PUNKT ZUM ANDEREN. Beide haengen sonst nur an
 * Graphknoten, also fuehrte die Reise vom ersten Punkt zurueck auf einen Weg und von dort wieder
 * hinauf zum zweiten -- ein V statt einer Linie, auch wenn die beiden Punkte nebeneinander liegen.
 * Owner-Meldung, wortwoertlich: „ausserdem fehlt, dass er von einem freien Wegpunkt zum anderen
 * gehen kann."
 *
 * ⭐ Die Kante ist ein ANGEBOT, keine Vorschrift: sie kostet, was sie kostet, und der Dijkstra nimmt
 * sie nur, wenn sie guenstiger ist als der Umweg ueber die Strasse.
 */
/**
 * PURE: darf es die direkte Kante zwischen zwei Kartenpunkten ueberhaupt geben?
 *
 * 🔴 DER ANDERE KARTENPUNKT IST EIN KANDIDAT WIE JEDER NETZPUNKT. Seit dem 15.08.2026 bindet die
 * Ausstiegsregel jede Anbindung: genau ein Ausstieg, der naechste erreichbare. Die direkte Kante ist
 * eine Anbindung wie jede andere -- sie entsteht, wenn der andere Punkt fuer mindestens EINEN der
 * beiden naeher liegt als dessen naechster Netzpunkt.
 *
 * 🪤 OHNE DIESE SCHRANKE WAR DIE AUSSTIEGSREGEL UNTER „KUERZESTE" WIRKUNGSLOS. Dort ist das Gewicht
 * die STRECKE, und eine Gerade ist per Definition kuerzer als jede Strasse -- die direkte Kante
 * gewann damit IMMER. Live gemessen (Kartenpunkt 475.458/479.833 -> 521.542/488.083): EINE Etappe
 * ueber 148,5 Meilen querfeldein bei 140,4 Meilen Luftlinie. Die Kuerzeste war zum Drachenflug
 * geworden, den die Karte ohnehin daneben anzeigt.
 *
 * ⚠️ `max`, nicht `min`: es genuegt, dass der andere Punkt fuer EINEN der beiden die naechste
 * Anbindung ist. Liegt A dicht an einer Strasse und B weit ab, ist A fuer B trotzdem das
 * Naechstliegende -- und genau dann gehoert die Kante gebaut.
 * ⚠️ Ein Bericht ohne Ausstieg zaehlt als „unendlich weit": dann ist die direkte Kante die einzige
 * Verbindung, die dieser Punkt ueberhaupt hat, und sie zu verweigern hiesse, ihn abzuschneiden.
 */
function avesmapsOffroadDirectEdgeAllowed(
    array $fromReport,
    array $toReport,
    array $fromPoint,
    array $toPoint
): bool {
    $naechster = static function (array $bericht): float {
        $knoten = $bericht['exit_nodes'] ?? null;

        return is_array($knoten) && $knoten !== [] ? (float) $knoten[0]['air_distance'] : INF;
    };
    $abstand = hypot(
        (float) $fromPoint['x'] - (float) $toPoint['x'],
        (float) $fromPoint['y'] - (float) $toPoint['y']
    );

    return $abstand <= max($naechster($fromReport), $naechster($toReport)) + 1e-9;
}

function avesmapsConnectOffroadPoints(
    array &$clientGraph,
    array $request,
    array $water,
    ?PDO $pdo,
    array $fromPoint,
    array $toPoint,
    string $fromNode,
    string $toNode,
    bool $terrainEnabled = true,
    string $connectionId = 'offroad-direct',
    array $gewaesser = []
): array {
    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    // 🔴 ERZEUGER 4 VON 4 -- die Zwillingspruefung zu der in avesmapsAttachOffroadPointToGraph, und
    // sie zaehlt doppelt: an dieser Funktion haengen ZWEI Ausloeser, die direkte Kante zwischen zwei
    // Kartenpunkten und die Sehnen des automatischen Umwegs (detour.php).
    if ($transport !== null && !avesmapsIsClientTransportAllowedForPath(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $transport)) {
        return ['ok' => false, 'error' => 'offroad_transport_not_allowed'];
    }
    $speed = $transport === null
        ? null
        : avesmapsTravelValuesSpeed($transport, AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE);
    if ($speed === null || $speed <= 0.0) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    // 🔴 Auch hier gilt „Kuerzeste“. Diese Funktion traegt ZWEI Ausloeser: die direkte Kante
    // zwischen zwei Kartenpunkten und die Sehnen des automatischen Umwegs (detour.php).
    $weightByDistance = (string) ($request['optimize'] ?? 'fastest') === 'shortest';

    $box = avesmapsBuildOffroadBox($fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y']);
    // 🔴 DER EINE ERZEUGER DER EBENEN -- siehe avesmapsOffroadBuildPlanes (offroad-data.php).
    $ebenen = avesmapsOffroadBuildPlanes($box, $water, $pdo, $gewaesser, $terrainEnabled);
    $blocked = $ebenen['blocked'];
    $factors = $ebenen['factors'];
    $rasters = $ebenen['rasters'];
    $heights = $ebenen['heights'];

    // ⭐ IM STRECKENMODUS ZUERST DIE GERADE. Ist sie trocken, ist sie bereits die Antwort.
    // ⚠️ Die Kiste, die Faktorebene und die Hoehen sind oben trotzdem gebaut worden -- nicht zum
    // Suchen, sondern zum MESSEN. Ohne sie haette die Etappe eine Laenge, aber keine Reisezeit und
    // keinen Anstieg (Entwurf §3.2).
    $path = $weightByDistance
        ? avesmapsOffroadStraightPathIfDry($box, $water, $factors, $heights, (float) $speed,
            (float) $fromPoint['x'], (float) $fromPoint['y'], (float) $toPoint['x'], (float) $toPoint['y'],
            AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters, $ebenen['wand'], $ebenen['furtlinien'])
        : null;
    $path ??= avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed,
        $fromPoint['x'], $fromPoint['y'], $toPoint['x'], $toPoint['y'], AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
        $rasters, $weightByDistance, $ebenen['furt']);
    if ($path === null) {
        return ['ok' => false, 'error' => 'no_offroad_route'];
    }

    avesmapsAddOffroadEdge($clientGraph['graph'], $fromNode, $toNode, $path, (string) $transport, $connectionId);

    return [
        'ok' => true,
        'distance_units' => $path['distance'],
        'cost_units' => $path['time'],
        'point_count' => count($path['points']),
        'cell_mapunits' => $box['cell'],
        'height_rasters' => count($rasters),
    ];
}
