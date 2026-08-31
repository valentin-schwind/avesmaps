<?php

declare(strict_types=1);

require_once __DIR__ . '/client-graph.php';
// Der Tempo-Speicher dieser Anfrage -- gefuellt wird er unten, EINMAL, vor dem Graphbau.
require_once __DIR__ . '/travel-values.php';
// 💣 NICHT WEGLASSEN, auch wenn hier keine Datumsrechnung steht: `avesmapsRouteDurationFromSegments`
// leitet die Rastzeit als „Tag minus Reisetag" ab und braucht dafuer
// AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY. PHP hebt Funktionen hoch, `const` auf Dateiebene aber
// nicht -- eine fehlende Konstante ist hier ein Fatal Error mit LEEREM Rumpf, und der sieht beim
// Aufrufer wie ein Netzfehler aus („Unexpected end of JSON input"). Genau das ist am 19.08.2026 im
// Wege-Editor passiert; `__tests__/const-vor-benutzung-test.php` wacht repoweit darueber.
require_once __DIR__ . '/travel-calendar.php';
require_once __DIR__ . '/terrain-read.php';
// V14 „Hierher reisen": the land check and the cross-country A*. Both are inert unless a request
// actually carries a map point, so an ordinary route pays for nothing here.
require_once __DIR__ . '/land-areas.php';
require_once __DIR__ . '/offroad-data.php';
require_once __DIR__ . '/offroad-leg.php';
require_once __DIR__ . '/detour.php';
require_once __DIR__ . '/synthetic-refine.php';

// 15: a route endpoint may be a map point (`from_point`/`to_point`), and a leg may be an A*-computed
// cross-country way with a real point sequence instead of a straight line.
const AVESMAPS_ROUTE_API_CODE_REVISION = 15;

class AvesmapsRouteLocationNotFoundException extends RuntimeException {}

/**
 * „Hierher reisen" could not use the clicked point. Carries the machine code, because the three
 * reasons need three different sentences from the client -- and the German ones live in the client's
 * i18n table, not in an API payload (AGENTS.md §8).
 */
class AvesmapsRouteOffroadPointException extends RuntimeException {
	public function __construct(public readonly string $errorCode, string $message) {
		parent::__construct($message);
	}
}

function avesmapsRouteErrorResponse(int $statusCode, string $code, string $message, ?array $details = null): never {
	$payload = [
		'ok' => false,
		'error' => [
			'code' => $code,
			'message' => $message,
		],
	];
	if ($details !== null) {
		$payload['error']['details'] = $details;
	}

	avesmapsJsonResponse($statusCode, $payload);
}

function avesmapsBuildRouteEdgeDiagnosticSegments(array $graph, array $edgeIds): array {
	$edgesById = [];
	foreach (is_array($graph['edges'] ?? null) ? $graph['edges'] : [] as $edge) {
		if (!is_array($edge)) {
			continue;
		}

		$edgeId = (string) ($edge['id'] ?? '');
		if ($edgeId === '') {
			continue;
		}

		$edgesById[$edgeId] = $edge;
	}

	$segments = [];
	foreach ($edgeIds as $index => $edgeId) {
		$normalizedEdgeId = (string) $edgeId;
		$edge = $edgesById[$normalizedEdgeId] ?? null;
		if (!is_array($edge)) {
			$segments[] = [
				'index' => (int) $index,
				'edge_id' => $normalizedEdgeId,
				'found' => false,
			];
			continue;
		}

		$geometry = is_array($edge['geometry'] ?? null) ? $edge['geometry'] : [];
		$coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
		$segments[] = [
			'index' => (int) $index,
			'edge_id' => $normalizedEdgeId,
			'found' => true,
			'path_id' => (string) ($edge['path_id'] ?? ''),
			'from_node' => (string) ($edge['from'] ?? ''),
			'to_node' => (string) ($edge['to'] ?? ''),
			'subtype' => (string) ($edge['subtype'] ?? ''),
			'transport_type' => (string) ($edge['transport_type'] ?? ''),
			'distance_units' => (float) ($edge['distance_units'] ?? 0.0),
			'cost_units' => (float) ($edge['cost_units'] ?? $edge['weight'] ?? 0.0),
			'coordinate_count' => count($coordinates),
		];
	}

	return $segments;
}

function avesmapsAnalyzeClientRouteOnServerGraph(array $clientGraph, array $request, array $serverRoute): array {
	$clientRoute = is_array($request['client_route'] ?? null) ? $request['client_route'] : [];
	$graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];
	$useShortestPath = (string) ($request['optimize'] ?? 'fastest') === 'shortest';
	$minimizeTransfers = !empty($request['minimize_transfers']);
	$matchedSegments = [];
	$missingSegments = [];
	$totalCost = 0.0;
	$previousTransport = null;

	foreach ($clientRoute as $index => $clientStep) {
		if (!is_array($clientStep)) {
			continue;
		}

		$from = (string) ($clientStep['from'] ?? '');
		$to = (string) ($clientStep['to'] ?? '');
		$connectionId = (string) ($clientStep['connection_id'] ?? $clientStep['connectionId'] ?? '');
		$connections = is_array($graph[$from][$to] ?? null) ? $graph[$from][$to] : [];
		$matchingConnection = null;
		$matchedBy = '';
		foreach ($connections as $connection) {
			if (is_array($connection) && (string) ($connection['id'] ?? '') === $connectionId) {
				$matchingConnection = $connection;
				$matchedBy = 'nodes_and_id';
				break;
			}
		}
		if (!is_array($matchingConnection) && is_array($connections[0] ?? null)) {
			$matchingConnection = $connections[0];
			$matchedBy = 'nodes_only';
		}

		if (!is_array($matchingConnection)) {
			$missingSegments[] = [
				'index' => (int) $index,
				'from' => $from,
				'to' => $to,
				'connection_id' => $connectionId,
				'from_known' => isset($graph[$from]),
				'to_known_from_source' => isset($graph[$from][$to]),
			];
			continue;
		}

		$transport = (string) ($matchingConnection['transport_option'] ?? '');
		// ⚠️ DIESELBE Gewichtung wie im Dijkstra (client-graph.php) -- diese Summe wird gegen dessen
		// `cost` gehalten, und zwei Rechenweisen machten den Vergleich lautlos wertlos.
		$segmentCost = $useShortestPath
			? (float) ($matchingConnection['distance'] ?? 0.0)
			: (float) ($matchingConnection['time'] ?? 0.0) * avesmapsTravelValuesWeightFactor($transport);
		if ($minimizeTransfers && $previousTransport !== null && $transport !== $previousTransport) {
			$segmentCost += AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY;
		}
		$totalCost += $segmentCost;
		$previousTransport = $transport;
		$matchedSegments[] = [
			'index' => (int) $index,
			'client_connection_id' => $connectionId,
			'server_connection_id' => (string) ($matchingConnection['id'] ?? ''),
			'matched_by' => $matchedBy,
			'from' => $from,
			'to' => $to,
			'route_type' => (string) ($matchingConnection['route_type'] ?? ''),
			'transport_option' => $transport,
			'distance' => (float) ($matchingConnection['distance'] ?? 0.0),
			'time' => (float) ($matchingConnection['time'] ?? 0.0),
			'cost' => $segmentCost,
		];
	}

	$serverCost = (float) ($serverRoute['cost'] ?? 0.0);
	return [
		'received_segment_count' => count($clientRoute),
		'matched_segment_count' => count($matchedSegments),
		'missing_segment_count' => count($missingSegments),
		'cost' => $totalCost,
		'server_winner_cost' => $serverCost,
		'cost_delta_server_minus_client_route' => $serverCost - $totalCost,
		'all_client_edges_found' => count($clientRoute) > 0 && count($missingSegments) === 0,
		'missing_segments' => array_slice($missingSegments, 0, 8),
		'matched_segments_sample' => array_slice($matchedSegments, 0, 8),
	];
}

function avesmapsBuildMinimalRouteResultFromRequest(array $request, array $config): array {
	$fromLocation = trim((string) ($request['from'] ?? ''));
	$toLocation = trim((string) ($request['to'] ?? ''));
	$via = $request['via'] ?? [];
	if ($fromLocation === '' || $toLocation === '') {
		throw new RuntimeException('Both from and to location names are required.');
	}
	// `via` ist seit dem 25.08.2026 wirklich gebaut (Meldung #92; davor stand hier eine 400 mit
	// `via_not_supported`, obwohl der Vertrag das Feld in beiden Beispielen zeigte). Die Stationen
	// werden weiter unten Paar fuer Paar gefahren -- siehe avesmapsFindClientCompatibleRouteLegs.
	$via = is_array($via) ? array_values(array_filter(array_map('strval', $via), static fn(string $s): bool => trim($s) !== '')) : [];

	$routeMapData = avesmapsLoadRouteMapData($config);
	$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
	// V11. The PDO comes back from avesmapsLoadRouteMapData rather than being opened again -- the
	// switch and path_terrain read naively would be two to three connections per route.
	$routePdo = $routeMapData['pdo'] ?? null;
	// 🔴 The API switch may only turn terrain OFF, never on (§8.3): the editor switch is an
	// emergency stop, and a stranger must not be able to switch on what the owner switched off.
	$terrainRequested = ($request['terrain'] ?? true) !== false;
	$terrainEnabled = $routePdo instanceof PDO && $terrainRequested && avesmapsRouteTerrainEnabled($routePdo);
	$terrain = $terrainEnabled ? avesmapsRouteLoadTerrain($routePdo) : [];
	$terrainMatched = avesmapsRouteCountTerrainMatches($routeNetworkData['paths'] ?? [], $terrain);
	// Only asked when terrain is on -- with the switch off there is nothing whose currency matters.
	$terrainStale = $terrainEnabled && avesmapsRouteTerrainStale($routePdo);
	// The ONE number the router reads out of the calibration (S. 123: a pass's path-type factor
	// already contains the climb, so the slope must not brake it twice). Read, never computed --
	// one indexed single-row select on the PDO that is already open. Without a calibration it comes
	// back as 1.0 and the whole normalisation is an exact no-op.
	$passNormalizer = $terrainEnabled
		? avesmapsTerrainPassNormalizer(avesmapsTerrainCalibrationRead($routePdo))
		: 1.0;
	// V13: open water, so a synthetic Querfeldein bridge cannot be built across the sea. Same PDO as
	// terrain above -- no extra connection. Without a PDO this stays empty and V13 is simply inert,
	// which is the designed failure mode (spec §4.1), not a silent hole.
	// 🔴 EINMAL JE ANFRAGE, UND VOR DEM GRAPHBAU. Die Tempotabelle wird an sieben Stellen tief im
	// Graphbau gelesen, von denen keine einen PDO hat (travel-values.php). Steht sie hier nicht,
	// rechnet die ganze Anfrage mit der Konstante -- kein Fehler, aber die Einstellung des Owners
	// waere wirkungslos, und das faellt niemandem auf.
	avesmapsTravelValuesPrime($routePdo);
	$water = $routePdo instanceof PDO ? avesmapsLoadRouteWater($config, $routePdo) : [];
	$clientGraph = avesmapsBuildClientCompatibleRouteGraph($routeNetworkData, $request, $terrain, $water, $passNormalizer);
	// 🔴 EIN FLUSS IST IM GELAENDE EINE WAND. Er ist bei uns keine Flaeche, sondern ein Flussweg-WEG,
	// stand also nie in $water und musste bis zum 15.08.2026 gar nicht ueberquert werden -- er war
	// schlicht nicht da (?s=w38RkXYP: 61,8 Meilen in EINER Etappe quer ueber die Rakula).
	// ⭐ Die Geometrien sind hier bereits geladen -- keine zweite Abfrage je Route.
	// 🔴 SEIT 30.08.2026 ZWEI FAECHER: `wand` (Fluss, sperrt) und `furt` (Bach, kostet nur --
	// Querungspreis). EIN Rueckgabewert, damit kein Erzeuger weiter unten die
	// eine Haelfte durchreichen und die andere vergessen kann; die Begruendung steht am Sammler.
	$gewaesser = avesmapsCollectRouteRiverBarrierLines(
		is_array($routeNetworkData['paths'] ?? null) ? $routeNetworkData['paths'] : []
	);

	// V14 „Hierher reisen": either endpoint may be an arbitrary map point. It becomes a NODE with one
	// cross-country edge to the nearest graph node, and everything below this line stays untouched --
	// the same Dijkstra, the same segments, the same renderer.
	//
	// ⚠️ The LABELS are kept: `from`/`to` in the answer stay what the caller sent („Kartenpunkt"),
	// while the routing runs on the internal node names. Returning `__offroad_to` would put an
	// internal identifier into the travel plan.
	$fromLabel = $fromLocation;
	$toLabel = $toLocation;
	$offroad = [];
	// Loaded at most once, and only when a map point is actually in play -- an ordinary route between
	// two places must not pay for a query it has no use for.
	$land = null;
	foreach (['from', 'to'] as $side) {
		$point = is_array($request[$side . '_point'] ?? null) ? $request[$side . '_point'] : null;
		if ($point === null) { continue; }
		$nodeName = AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . $side;
		$land ??= $routePdo instanceof PDO ? avesmapsLoadRouteLand($config, $routePdo) : avesmapsPrepareRouteAreas([]);
		$report = avesmapsAttachOffroadPointToGraph(
			$clientGraph,
			// 🔴 DIE GEFILTERTE LISTE, nicht $routeNetworkData['locations']. Hier stand bis zum
			// 15.08.2026 die rohe -- ein versteckter Ort waere damit weiter als Querfeldein-Ausstieg
			// angeboten worden, und die Reise stiege an einem Ort aus, den es auf der Karte nicht
			// gibt. Der Riegel im Graphbau haette danebengegriffen.
			is_array($clientGraph['candidate_locations'] ?? null) ? $clientGraph['candidate_locations'] : [],
			$request,
			$water,
			$land,
			$routePdo,
			(float) $point['x'],
			(float) $point['y'],
			$nodeName,
			$terrainEnabled,
			$gewaesser
		);
		if (empty($report['ok'])) {
			throw new AvesmapsRouteOffroadPointException(
				(string) ($report['error'] ?? 'no_offroad_route'),
				'The map point could not be reached across country.'
			);
		}
		$offroad[$side] = $report;
		// From here on the point IS the endpoint, under its internal node name.
		if ($side === 'from') { $fromLocation = $nodeName; } else { $toLocation = $nodeName; }
	}

	// 🔴 SIND BEIDE ENDEN KARTENPUNKTE, BEKOMMEN SIE EINE DIREKTE KANTE. Ohne sie haengt jeder Punkt
	// nur an Graphknoten, und die Reise vom einen zum anderen liefe hinunter auf einen Weg und wieder
	// hinauf -- ein V statt einer Linie, auch wenn die Punkte nebeneinander liegen. Owner-Meldung.
	//
	// 🔴 ABER SIE FOLGT SEIT DEM 15.08.2026 DERSELBEN REGEL WIE JEDE ANDERE ANBINDUNG: der andere
	// Kartenpunkt ist ein KANDIDAT wie jeder Netzpunkt, und die Kante entsteht nur, wenn er fuer
	// mindestens einen der beiden naeher liegt als dessen naechster Netzpunkt.
	//
	// 🪤 Ohne diese Schranke war die Ausstiegsregel unter „Kuerzeste" wirkungslos: dort ist das
	// Gewicht die STRECKE, und eine Gerade ist per Definition kuerzer als jede Strasse -- die
	// direkte Kante gewann damit IMMER. Live gemessen (Kartenpunkt 475.458/479.833 ->
	// 521.542/488.083): EINE Etappe ueber 148,5 Meilen querfeldein bei 140,4 Meilen Luftlinie. Die
	// Kuerzeste war zum Drachenflug geworden, den die Karte ohnehin daneben anzeigt.
	// Owner, woertlich: „hier macht er scheiss" -- und der einzige Unterschied zum Fall, den er
	// „richtig" nannte, war `pathType=shortest`.
	//
	// ⚠️ `max`, nicht `min`: es genuegt, dass der andere Punkt fuer EINEN der beiden die naechste
	// Anbindung ist. Liegt A dicht an einer Strasse und B weit ab, ist A fuer B trotzdem das
	// Naechstliegende -- und genau dann gehoert die Kante gebaut.
	// ⭐ Die Regel wohnt in offroad-leg.php, neben dem Erzeuger, den sie bindet -- hier stuende sie
	// als Verschluss im Aufrufer und waere nicht pruefbar.
	if (isset($offroad['from'], $offroad['to'])
		&& avesmapsOffroadDirectEdgeAllowed(
			$offroad['from'], $offroad['to'], $request['from_point'], $request['to_point']
		)) {
		$offroad['direct'] = avesmapsConnectOffroadPoints(
			$clientGraph,
			$request,
			$water,
			$routePdo,
			$request['from_point'],
			$request['to_point'],
			AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'from',
			AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'to',
			$terrainEnabled,
			// ⚠️ Der Kantenname muss mit, sonst landet die Gewaesserliste positional auf ihm.
			'offroad-direct',
			$gewaesser
		);
	}

	// Die Stationen der Reise: Start, die vorgeschriebenen Zwischenorte, Ziel. Ohne `via` ist das
	// genau das Paar von frueher, und `avesmapsFindClientCompatibleRouteLegs` faellt dann auf einen
	// einzigen Dijkstra zurueck -- zeichengleich mit dem alten Aufruf (via-etappen-test.php §1).
	//
	// 💣 DIE KARTENPUNKTE STEHEN SCHON DRIN. `$fromLocation`/`$toLocation` sind oben durch die
	// internen Knotennamen ersetzt worden, falls ein Ende ein angeklickter Kartenpunkt war; die
	// Stationsliste erbt das und braucht dafuer keine eigene Weiche.
	$routeStations = array_merge([$fromLocation], $via, [$toLocation]);
	// 🔴 EIN Aufruf-Bauplan fuer ALLE drei Stellen, an denen gerechnet wird (hier, nach dem
	// Umweg-Angebot, nach der Sehnen-Verfeinerung). Stuende an einer davon weiter der Paar-Aufruf,
	// verloere die Reise ihre Zwischenorte genau dann, wenn eine der beiden Nachbesserungen greift
	// -- die Vier-Erzeuger-Falle vom 14.08.2026 in klein.
	//
	// 💣 `use (&$clientGraph)` UND KEINE PFEILFUNKTION. Beide Nachbesserungen unten nehmen den Graphen
	// als `array &$clientGraph` und AENDERN ihn -- das Umweg-Angebot haengt eine Kante hinein, die
	// Sehnen-Verfeinerung biegt eine. Eine Pfeilfunktion (`fn() => ...`) bindet ihre Umgebung beim
	// ANLEGEN und immer als KOPIE; sie haette hier den Graphen von vor der Aenderung eingefroren und
	// genau die Kante nicht gesehen, derentwegen ueberhaupt neu gerechnet wird. Der alte Code stand
	// an jeder Stelle einzeln und las die Variable deshalb beilaeufig richtig.
	$fahreRoute = static function () use (&$clientGraph, $routeStations, $request): array {
		return avesmapsFindClientCompatibleRouteLegs($clientGraph, $routeStations, $request);
	};
	$routeDijkstraResult = $fahreRoute();

	// V14 §5.5: der automatische Umweg-Auslöser. Fährt das gezeichnete Netz einen absurden Bogen,
	// bekommt der Dijkstra einen A*-Querweg ANGEBOTEN und rechnet noch einmal.
	//
	// 🔴 STILLGELEGT AM 16.08.2026 (`AVESMAPS_ROUTE_OFFROAD_DETOUR_ENABLED`). Die Begründung steht
	// vollständig im Kopf von `detour.php`; die Kurzfassung: seit der Ausstiegsregel vom 15.08. war
	// die Sehne die einzige Stelle, an der der Router noch eigenmächtig die Straße verließ, und sie
	// hat einen sichtbaren Widerspruch erzeugt — „Kürzeste" 305,3 Meilen gegen „Schnellste" 242,6 auf
	// derselben Route, weil die Sehnen aus der ZUERST gefundenen Kette gerechnet werden und die je
	// nach Modus verschieden ist.
	//
	// ⚠️ DIES IST DER EINZIGE AUFRUFER. Die Sperre steht deshalb hier und nicht in der Funktion — so
	// prüfen ihre Tests weiter die Maschinerie, die absichtlich erhalten bleibt.
	$detour = ['checked' => false, 'offered' => false, 'reason' => 'disabled'];
	$locations = is_array($routeNetworkData['locations'] ?? null) ? $routeNetworkData['locations'] : [];
	$fromPoint = avesmapsRouteResolveEndpointPoint($locations, $fromLocation, $request['from_point'] ?? null);
	$toPoint = avesmapsRouteResolveEndpointPoint($locations, $toLocation, $request['to_point'] ?? null);
	if (AVESMAPS_ROUTE_OFFROAD_DETOUR_ENABLED && $fromPoint !== null && $toPoint !== null) {
		$detour = avesmapsMaybeOfferOffroadDetour(
			$clientGraph, $request, $water, $routePdo,
			is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : [],
			$fromPoint, $toPoint, $fromLocation, $toLocation, $terrainEnabled, $gewaesser
		);
		if (!empty($detour['offered'])) {
			// 🔴 DERSELBE DIJKSTRA, NICHT EIN ZWEITER ZUSAMMENBAU. Er darf die Kante auch teilweise
			// nehmen (ein Stück Straße, dann quer) -- das wäre dann die richtige Antwort.
			$routeDijkstraResult = $fahreRoute();
		}
	}

	// Instruction C §3: die geraden Sehnen der GEFUNDENEN Route bekommen denselben A*. Nachträglich
	// und nicht beim Graphbau -- dort entstehen 876 synthetische Kanten, von denen eine Route null
	// bis eine benutzt (gemessen 2026-08-02). Nach §2, weil §2 die ursprüngliche Strecke misst.
	$refine = avesmapsRefineSyntheticRouteLegs(
		$clientGraph, $request, $water, $routePdo,
		is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : [],
		$terrainEnabled, $gewaesser
	);
	if (($refine['refined'] ?? 0) > 0) {
		// Der gebogene Weg ist länger als die Sehne -- also kann eine andere Route jetzt die
		// günstigere sein. Ohne diesen Lauf wäre die Antwort nur noch fast die beste.
		$routeDijkstraResult = $fahreRoute();
	}

	$edgeIds = is_array($routeDijkstraResult['edge_ids'] ?? null) ? $routeDijkstraResult['edge_ids'] : [];
	$nodeIds = is_array($routeDijkstraResult['node_ids'] ?? null) ? $routeDijkstraResult['node_ids'] : [];
	// 🔴 MIT der Knotenliste: sie IST die Durchlaufrichtung, und ohne sie meldet jede Etappe die
	// Speicherrichtung ihres Wegstuecks (Meldung #98). Begruendung im Kopf der Funktion.
	$routeSegments = avesmapsBuildClientRouteDiagnosticSegments(
		is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : [],
		$nodeIds
	);
	// Meldung #94: die Dauer wird HIER gerechnet und nicht im Antwortbauer -- der Tempo-Speicher ist
	// an dieser Stelle sicher gefuellt (avesmapsTravelValuesPrime weiter oben), und die eingestellten
	// Reisetage des Owners gehen sonst still verloren.
	$routeDuration = avesmapsRouteDurationFromSegments($routeSegments);
	// Meldung #93: die Luftlinie, die `include_air_distance` seit jeher verspricht.
	// ⚠️ Sie laeuft ueber die vorgeschriebenen Stationen, nicht von Start zu Ziel: bei einer Reise mit
	// `via` ist die Strecke „so weit koennte ein Vogel fliegen, wenn er auch dort vorbei muesste".
	// Ohne `via` ist das genau die Luftlinie zwischen den beiden Enden.
	$airDistanceUnits = 0.0;
	$previousStationPoint = null;
	foreach ($routeStations as $stationName) {
		$stationPoint = match (true) {
			$stationName === $fromLocation => $fromPoint,
			$stationName === $toLocation => $toPoint,
			default => avesmapsRouteResolveEndpointPoint($locations, (string) $stationName, null),
		};
		if ($stationPoint === null) {
			// Ein Ende ohne Koordinate macht die Summe unbrauchbar -- dann lieber gar keine Zahl als
			// eine zu kurze. `null` faellt im Antwortbauer heraus.
			$airDistanceUnits = null;
			break;
		}
		if ($previousStationPoint !== null) {
			$airDistanceUnits += hypot(
				$stationPoint['x'] - $previousStationPoint['x'],
				$stationPoint['y'] - $previousStationPoint['y']
			);
		}
		$previousStationPoint = $stationPoint;
	}
	$networkStatistics = is_array($routeNetworkData['statistics'] ?? null) ? $routeNetworkData['statistics'] : [];
	$graphStatistics = is_array($clientGraph['statistics'] ?? null) ? $clientGraph['statistics'] : [];

	if (!isset($clientGraph['graph'][$fromLocation])) {
		throw new AvesmapsRouteLocationNotFoundException(sprintf('Unknown from location: %s', $fromLocation));
	}
	if (!isset($clientGraph['graph'][$toLocation])) {
		throw new AvesmapsRouteLocationNotFoundException(sprintf('Unknown to location: %s', $toLocation));
	}
	// ⚠️ Ein unbekannter Zwischenort ist `location_not_found`, nicht „keine Route gefunden" -- sonst
	// sucht der Aufrufer den Fehler in der Welt statt in seiner Anfrage. Er kostet nichts extra: die
	// Etappe zu ihm bricht schon im Dijkstra sofort ab, weil der Knoten im Graphen fehlt.
	foreach ($via as $viaLocation) {
		if (!isset($clientGraph['graph'][$viaLocation])) {
			throw new AvesmapsRouteLocationNotFoundException(sprintf('Unknown via location: %s', $viaLocation));
		}
	}

	return [
		'ok' => true,
		'route' => [
			'found' => (bool) ($routeDijkstraResult['found'] ?? false),
			'from' => $fromLabel,
			'to' => $toLabel,
			'cost' => (float) ($routeDijkstraResult['cost'] ?? 0.0),
			'node_count' => count($nodeIds),
			'edge_count' => (int) ($routeDijkstraResult['edge_count'] ?? 0),
			'from_node' => $fromLocation,
			'to_node' => $toLocation,
			'node_ids' => $nodeIds,
			'edge_ids' => $edgeIds,
			'segments' => $routeSegments,
			'duration' => $routeDuration,
			'air_distance_units' => $airDistanceUnits,
			// Meldung #95: die Gesamtstrecke stand nirgends -- ein Aufrufer musste die Etappen
			// summieren, und mit `include_steps: false` haette er sie gar nicht mehr bekommen.
			'distance_units' => array_sum(array_map(
				static fn(array $segment): float => (float) ($segment['distance_units'] ?? 0.0),
				$routeSegments
			)),
			'debug_context' => [
				'api_code_revision' => AVESMAPS_ROUTE_API_CODE_REVISION,
				'map_revision' => (int) ($routeMapData['revision'] ?? 0),
				'network_path_count' => (int) ($networkStatistics['path_count'] ?? 0),
				'client_graph_path_feature_count' => (int) ($graphStatistics['path_feature_count'] ?? 0),
				'request' => $request,
				'network_statistics' => $networkStatistics,
				'client_graph_statistics' => $graphStatistics,
				'client_route_on_server_graph' => avesmapsAnalyzeClientRouteOnServerGraph($clientGraph, $request, $routeDijkstraResult),
				// 🔴 THE HARD COUNTER. „cost is unchanged with the switch off" is ALSO green when the
				// lookup missed every row -- and then a wrong picture later looks like a curve
				// problem instead of a join problem. `matched_ways` must be > 0 once profiles exist.
				// `1.0` otherwise means three different things at once: terrain is off, it is flat
				// here, or nothing is known here. `enabled` separates the first, `ascent_schritt:
				// null` per segment separates the third from the second.
				'terrain' => [
					'enabled' => $terrainEnabled,
					'requested' => $terrainRequested,
					'profile_rows' => count($terrain),
					'matched_ways' => $terrainMatched,
					// 🔴 The rasters have moved since the profiles were derived. The profiles are
					// still USED -- refusing them would flatten the whole map over one edit -- so
					// this flag is the only thing that makes „warum ist der Pass noch schnell?"
					// answerable. Without it the staleness rule is a claim, not a behaviour.
					'stale' => $terrainStale,
					// 🔴 The divisor that takes the Gebirgspass double brake back out (S. 123).
					// 1.0 means „no calibration read" and is an exact no-op -- reported, because
					// otherwise „warum ist der Pass immer noch langsam?" has no answer. Read
					// together with `stale`: a stale calibration is still APPLIED (refusing it
					// would put the double brake back), it just says so.
					'pass_normalizer' => $passNormalizer,
					// 🔴 THE NUMBER NOBODY COULD NAME. The instruction's first draft cited „3.331
					// Profilzeilen" as evidence that rasters exist -- but those are `path_terrain`
					// rows, the ways' cache, and say nothing about stored height rasters. One
					// indexed COUNT, no blob, so „the A* ignores the mountains" can be told apart
					// from „no mountain has a raster yet".
					'height_rasters' => $routePdo instanceof PDO ? avesmapsOffroadCountHeightRasters($routePdo) : 0,
				],
				// V14. Present only when an endpoint was a map point. Carries the cell width the
				// search ACTUALLY used -- over the cell cap it coarsens for this one request, and a
				// route computed on a 1,0 grid is a different statement from one computed on 0,5.
				'offroad' => $offroad,
				// V14 §5.5. Immer da, auch wenn nichts passiert ist: `ratio` gegen `threshold`
				// erklaert jede Route, die querfeldein geht, UND jede, die es nicht tut. „Warum
				// nimmt er den Bogen?" ist sonst nur zu beantworten, indem man es nachbaut.
				'detour' => $detour,
				// §3. `examined` sagt, wie viele Sehnen die Route ueberhaupt betreten hat -- das ist
				// die Zahl, an der sich die Kostenfrage entscheidet, und sie gehoert deshalb in die
				// Antwort und nicht in eine einmalige Messung.
				'refine' => $refine,
			],
		],
	];
}

/**
 * PUR: die Dauer einer Reise aus ihren Etappen -- die Antwort auf Meldung #94.
 *
 * 💣 `cost` IST DAS DIJKSTRA-GEWICHT UND KEINE ZEIT. Bei `fastest` ist es die Reisestunde mal
 * `avesmapsTravelValuesWeightFactor` (Kalenderzeit, damit „schnellste" fruehestes ANKOMMEN heisst
 * und nicht die wenigsten Gehstunden), bei `shortest` schlicht die Strecke; `minimize_transfers`
 * schlaegt zusaetzlich Umsteigezuschlaege drauf. Wer daraus eine Zeit liest, liest ein Gewicht.
 * Deshalb rechnet diese Funktion aus den ETAPPEN und nie aus `cost`.
 *
 * 🔴 JE ETAPPE MIT IHREM EIGENEN REISETAG. Land 8 Stunden, Wasser 12, der Schnellsegler 24
 * (travel-values.php, vom Owner im Fenster „Tempowerte" einstellbar). Ein Mittelwert ueber die
 * ganze Reise waere bei jeder gemischten Land-Fluss-See-Route falsch -- und das ist genau der Fall,
 * nach dem der Melder gefragt hat.
 *
 * 🔴 UND `cost_units` WIRD MIT ZWEI FAKTOREN ZUR STUNDE, nicht mit einem: mal drei (Meilen je
 * Karteneinheit) und mal AVESMAPS_TRAVEL_TIME_SCALE (die Tempotabelle ist um genau diesen Faktor
 * ueberhoeht). Die Begruendung samt Messung steht an der Rechenstelle unten -- Meldung #101.
 *
 * ⚠️ EINE Quelle fuer den Reisetag. `rest_hours_per_day` wird daraus ABGELEITET (24 minus Reisetag)
 * und steht nie als zweite Zahl daneben: sonst laufen die beiden auseinander, sobald jemand die
 * Tempowerte verstellt, und niemand merkt es.
 */
function avesmapsRouteDurationFromSegments(array $segments): array {
	$travelHours = 0.0;
	$travelDays = 0.0;
	foreach ($segments as $segment) {
		if (!is_array($segment)) {
			continue;
		}

		// 💣 `cost_units` IST KEINE STUNDE, auch wenn es sich so liest -- UND ES BRAUCHT ZWEI
		// UMRECHNUNGEN, NICHT EINE. Es entsteht als `distance_units / Tempo`:
		//
		//   (1) `distance_units` sind KARTENEINHEITEN, das Tempo steht in Meilen je Stunde. Eine
		//       Karteneinheit ist DREI Meilen (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, Spiegelbild von
		//       DISTANCE_SCALING_FACTOR in js/config.js).
		//   (2) JEDE Zahl der Tempotabelle ist um AVESMAPS_TRAVEL_TIME_SCALE UEBERHOEHT -- sie ist als
		//       `Tagesleistung x mean_G x 1,19 / Reisetag` gebaut (travel-values.php). Wer aus so einem
		//       Tempo wieder Stunden macht, muss den Faktor zurueckrechnen; der Reiseplan der Karte tut
		//       das seit jeher (`(segDistance / speedMiles) * TIME_SCALE_FACTOR`, route-plan.js).
		//
		// 🪤 MELDUNG #101, UND SIE IST EIN LEHRSTUECK UEBER GEGENPROBEN. Hier stand bis zum 26.08.2026
		// nur (1), belegt mit: „Summe der `cost_units` 21,004, der Reiseplan der Karte zeigt 63,0
		// Stunden, Faktor exakt 3,000". Die Karte zeigt fuer diese Reise 73,4 Stunden. Die Gegenprobe
		// war falsch -- und weil sie danebenstand, sah die fehlende Umrechnung geprueft aus. Neu
		// gemessen an derselben Live-Route (Gareth -> Perricum, landgebunden): 21,004 cost_units,
		// vorher gemeldet 63,012 h, richtig 74,985 h.
		// ⚠️ Die letzten rund 2 % zwischen 74,985 und den 73,4 der Karte sind ein ZWEITER Befund und
		// nicht dieser: die Karte traegt die Tempotabelle als feste Zahl im Browser (js/config.js),
		// der Server legt zusaetzlich die eingestellten Tempowerte darueber (app_setting).
		// 🪤 Und die Einheitenfalle (1) allein hat am 30.07.2026 schon einmal einen falschen
		// Infobox-Text oeffentlich gemacht (der 💣 an AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE).
		$hours = (float) ($segment['cost_units'] ?? 0.0)
			* AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT
			* AVESMAPS_TRAVEL_TIME_SCALE;
		$travelHours += $hours;
		$hoursPerDay = avesmapsTravelValuesHoursFor((string) ($segment['transport_type'] ?? ''));
		if ($hoursPerDay > 0.0) {
			$travelDays += $hours / $hoursPerDay;
		}
	}

	$perDay = [
		'land' => avesmapsTravelValuesHoursFor('groupFoot'),
		'water' => avesmapsTravelValuesHoursFor('cargoShip'),
		'night' => avesmapsTravelValuesHoursFor(AVESMAPS_TRAVEL_NIGHT_TRAVEL_TRANSPORT),
	];

	return [
		'travel_hours' => $travelHours,
		'travel_days' => $travelDays,
		'travel_hours_per_day' => $perDay,
		'rest_hours_per_day' => array_map(
			static fn(float $hours): float => AVESMAPS_TRAVEL_CALENDAR_HOURS_PER_DAY - $hours,
			$perDay
		),
	];
}

/**
 * Die oeffentliche Antwort auf `POST /api/route/`.
 *
 * 🔴 DIE VIER `include_*` UND `debug` SCHALTEN HIER, UND NUR HIER. Bis zum 25.08.2026 wurden sie in
 * request.php geprueft und danach von keiner Zeile gelesen (Meldung #93): der Aufrufer schaltete
 * ins Leere und glaubte, geschaltet zu haben. Wer ein fuenftes solches Feld einfuehrt, verdrahtet
 * es an dieser Stelle -- sonst entsteht dasselbe noch einmal.
 *
 * ⚠️ ALLE VORGABEN SIND „an". Ohne Angaben ist die Antwort Zeichen fuer Zeichen die alte, nur um
 * `duration`, `air_distance_units` und die verdoppelten `node_ids`/`edge_ids` reicher. Ein
 * zwischengespeicherter alter Client darf daran nicht zerbrechen (AGENTS.md §7).
 *
 * 💣 `node_ids` UND `edge_ids` STEHEN ZWEIMAL, UND DAS IST ABSICHT. Sie lagen bisher nur im
 * Debug-Block, und js/routing/route-engine.js liest sie genau dort. Ein Kompaktmodus, der den Block
 * wegnimmt, haette der Karte damit die Knotenliste genommen -- also stehen sie zusaetzlich am
 * Routenobjekt, wo sie hingehoeren. Die Kopie im Debug-Block bleibt, bis kein Client sie mehr liest.
 */
function avesmapsBuildMinimalRouteResponse(array $route, array $request = []): array {
	$debugContext = is_array($route['debug_context'] ?? null) ? $route['debug_context'] : [];
	// Fehlt das Feld, gilt „an" -- das ist zugleich die Vorgabe des Normalisierers und das Verhalten
	// von vor dem 25.08.2026.
	$will = static fn(string $feld): bool => ($request[$feld] ?? true) !== false;

	$response = [
		'found' => (bool) ($route['found'] ?? false),
		'from' => (string) ($route['from'] ?? ''),
		'to' => (string) ($route['to'] ?? ''),
		// 💣 Das OPTIMIERUNGSGEWICHT, keine Zeit und keine Strecke -- siehe
		// avesmapsRouteDurationFromSegments und api/README.md. Fuer eine Dauer ist `duration` da.
		'cost' => (float) ($route['cost'] ?? 0.0),
		'summary' => [
			'node_count' => (int) ($route['node_count'] ?? 0),
			'edge_count' => (int) ($route['edge_count'] ?? 0),
		],
		'from_node' => (string) ($route['from_node'] ?? ''),
		'to_node' => (string) ($route['to_node'] ?? ''),
		'node_ids' => is_array($route['node_ids'] ?? null) ? $route['node_ids'] : [],
		'edge_ids' => is_array($route['edge_ids'] ?? null) ? $route['edge_ids'] : [],
		'distance_units' => (float) ($route['distance_units'] ?? 0.0),
		// 🔴 DER UMRECHNUNGSFAKTOR REIST MIT, statt dass ihn jeder Aufrufer abschreibt (Meldung #95).
		// Er ist im Haus schon zweimal vergeben (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT hier,
		// DISTANCE_SCALING_FACTOR in js/config.js) und beide Stellen tragen den 💣 dazu -- ein
		// dritter, abgeschriebener Wert in fremdem Code waere der, den niemand mitzieht.
		'miles_per_distance_unit' => AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT,
	];

	$duration = is_array($route['duration'] ?? null) ? $route['duration'] : [];
	if ($duration !== []) {
		if (!$will('include_rests')) {
			unset($duration['rest_hours_per_day']);
		}
		$response['duration'] = $duration;
	}

	// ⚠️ `null` heisst „eine Station hatte keine Koordinate" und faellt heraus -- lieber keine Zahl
	// als eine zu kurze Luftlinie, die wie eine Messung aussieht.
	if ($will('include_air_distance') && ($route['air_distance_units'] ?? null) !== null) {
		$response['air_distance_units'] = (float) $route['air_distance_units'];
	}

	if ($will('debug')) {
		$response['debug'] = [
			'api_code_revision' => AVESMAPS_ROUTE_API_CODE_REVISION,
			'map_revision' => (int) ($debugContext['map_revision'] ?? 0),
			'network_path_count' => (int) ($debugContext['network_path_count'] ?? 0),
			'client_graph_path_feature_count' => (int) ($debugContext['client_graph_path_feature_count'] ?? 0),
			'from_node' => $response['from_node'],
			'to_node' => $response['to_node'],
			'node_ids' => $response['node_ids'],
			'edge_ids' => $response['edge_ids'],
			'context' => $debugContext,
		];
	}

	if ($will('include_steps')) {
		$segments = is_array($route['segments'] ?? null) ? $route['segments'] : [];
		if (!$will('include_geometry')) {
			// ⚠️ `coordinate_count` bleibt stehen: es sagt, wie gross die weggelassene Geometrie
			// waere, und ist genau die Zahl, an der ein Aufrufer entscheidet, ob er sie nachladen
			// will.
			$segments = array_map(static function (array $segment): array {
				unset($segment['geometry']);
				return $segment;
			}, $segments);
		}
		$response['segments'] = $segments;
	}

	return $response;
}
