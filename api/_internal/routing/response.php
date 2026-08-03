<?php

declare(strict_types=1);

require_once __DIR__ . '/client-graph.php';
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
class AvesmapsRouteViaNotSupportedException extends RuntimeException {}

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
		$segmentCost = $useShortestPath ? (float) ($matchingConnection['distance'] ?? 0.0) : (float) ($matchingConnection['time'] ?? 0.0);
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
	if (is_array($via) && count($via) > 0) {
		throw new AvesmapsRouteViaNotSupportedException('Via is not supported.');
	}

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
	$water = $routePdo instanceof PDO ? avesmapsLoadRouteWater($config, $routePdo) : [];
	$clientGraph = avesmapsBuildClientCompatibleRouteGraph($routeNetworkData, $request, $terrain, $water, $passNormalizer);

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
			is_array($routeNetworkData['locations'] ?? null) ? $routeNetworkData['locations'] : [],
			$request,
			$water,
			$land,
			$routePdo,
			(float) $point['x'],
			(float) $point['y'],
			$nodeName,
			$terrainEnabled
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
	// Die Kante ist ein Angebot: der Dijkstra nimmt sie nur, wenn sie guenstiger ist.
	if (isset($offroad['from'], $offroad['to'])) {
		$offroad['direct'] = avesmapsConnectOffroadPoints(
			$clientGraph,
			$request,
			$water,
			$routePdo,
			$request['from_point'],
			$request['to_point'],
			AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'from',
			AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'to',
			$terrainEnabled
		);
	}

	$routeDijkstraResult = avesmapsFindClientCompatibleRoute($clientGraph, $fromLocation, $toLocation, $request);

	// V14 §5.5: der automatische Umweg-Auslöser. Fährt das gezeichnete Netz einen absurden Bogen,
	// bekommt der Dijkstra einen A*-Querweg ANGEBOTEN und rechnet noch einmal. Der Vorfilter ist
	// gratis -- Luftlinie und gefahrene Strecke liegen hier beide vor -- und schweigt für 90,9 % der
	// Routen, ohne dass eine Zeile Suche läuft.
	$detour = ['checked' => false];
	$locations = is_array($routeNetworkData['locations'] ?? null) ? $routeNetworkData['locations'] : [];
	$fromPoint = avesmapsRouteResolveEndpointPoint($locations, $fromLocation, $request['from_point'] ?? null);
	$toPoint = avesmapsRouteResolveEndpointPoint($locations, $toLocation, $request['to_point'] ?? null);
	if ($fromPoint !== null && $toPoint !== null) {
		$detour = avesmapsMaybeOfferOffroadDetour(
			$clientGraph, $request, $water, $routePdo,
			is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : [],
			$fromPoint, $toPoint, $fromLocation, $toLocation, $terrainEnabled
		);
		if (!empty($detour['offered'])) {
			// 🔴 DERSELBE DIJKSTRA, NICHT EIN ZWEITER ZUSAMMENBAU. Er darf die Kante auch teilweise
			// nehmen (ein Stück Straße, dann quer) -- das wäre dann die richtige Antwort.
			$routeDijkstraResult = avesmapsFindClientCompatibleRoute($clientGraph, $fromLocation, $toLocation, $request);
		}
	}

	// Instruction C §3: die geraden Sehnen der GEFUNDENEN Route bekommen denselben A*. Nachträglich
	// und nicht beim Graphbau -- dort entstehen 876 synthetische Kanten, von denen eine Route null
	// bis eine benutzt (gemessen 2026-08-02). Nach §2, weil §2 die ursprüngliche Strecke misst.
	$refine = avesmapsRefineSyntheticRouteLegs(
		$clientGraph, $request, $water, $routePdo,
		is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : [],
		$terrainEnabled
	);
	if (($refine['refined'] ?? 0) > 0) {
		// Der gebogene Weg ist länger als die Sehne -- also kann eine andere Route jetzt die
		// günstigere sein. Ohne diesen Lauf wäre die Antwort nur noch fast die beste.
		$routeDijkstraResult = avesmapsFindClientCompatibleRoute($clientGraph, $fromLocation, $toLocation, $request);
	}

	$edgeIds = is_array($routeDijkstraResult['edge_ids'] ?? null) ? $routeDijkstraResult['edge_ids'] : [];
	$nodeIds = is_array($routeDijkstraResult['node_ids'] ?? null) ? $routeDijkstraResult['node_ids'] : [];
	$networkStatistics = is_array($routeNetworkData['statistics'] ?? null) ? $routeNetworkData['statistics'] : [];
	$graphStatistics = is_array($clientGraph['statistics'] ?? null) ? $clientGraph['statistics'] : [];

	if (!isset($clientGraph['graph'][$fromLocation])) {
		throw new AvesmapsRouteLocationNotFoundException(sprintf('Unknown from location: %s', $fromLocation));
	}
	if (!isset($clientGraph['graph'][$toLocation])) {
		throw new AvesmapsRouteLocationNotFoundException(sprintf('Unknown to location: %s', $toLocation));
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
			'segments' => avesmapsBuildClientRouteDiagnosticSegments(is_array($routeDijkstraResult['segments'] ?? null) ? $routeDijkstraResult['segments'] : []),
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

function avesmapsBuildMinimalRouteResponse(array $route): array {
	$debugContext = is_array($route['debug_context'] ?? null) ? $route['debug_context'] : [];
	return [
		'found' => (bool) ($route['found'] ?? false),
		'from' => (string) ($route['from'] ?? ''),
		'to' => (string) ($route['to'] ?? ''),
		'cost' => (float) ($route['cost'] ?? 0.0),
		'summary' => [
			'node_count' => (int) ($route['node_count'] ?? 0),
			'edge_count' => (int) ($route['edge_count'] ?? 0),
		],
		'debug' => [
			'api_code_revision' => AVESMAPS_ROUTE_API_CODE_REVISION,
			'map_revision' => (int) ($debugContext['map_revision'] ?? 0),
			'network_path_count' => (int) ($debugContext['network_path_count'] ?? 0),
			'client_graph_path_feature_count' => (int) ($debugContext['client_graph_path_feature_count'] ?? 0),
			'from_node' => (string) ($route['from_node'] ?? ''),
			'to_node' => (string) ($route['to_node'] ?? ''),
			'node_ids' => is_array($route['node_ids'] ?? null) ? $route['node_ids'] : [],
			'edge_ids' => is_array($route['edge_ids'] ?? null) ? $route['edge_ids'] : [],
			'context' => $debugContext,
		],
		'segments' => is_array($route['segments'] ?? null) ? $route['segments'] : [],
	];
}
