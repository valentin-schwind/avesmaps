<?php

declare(strict_types=1);

require_once __DIR__ . '/route-client-graph.php';

const AVESMAPS_ROUTE_API_CODE_REVISION = 12;

class AvesmapsRouteLocationNotFoundException extends RuntimeException {}
class AvesmapsRouteViaNotSupportedException extends RuntimeException {}

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

function avesmapsBuildRouteConnectionIdIndex(array $graph): array {
	$connectionsById = [];
	foreach ($graph as $fromNode => $neighbors) {
		if (!is_array($neighbors)) {
			continue;
		}

		foreach ($neighbors as $toNode => $connections) {
			foreach (is_array($connections) ? $connections : [] as $connection) {
				if (!is_array($connection)) {
					continue;
				}

				$connectionId = (string) ($connection['id'] ?? '');
				if ($connectionId === '') {
					continue;
				}

				$connectionsById[$connectionId][] = [
					'from' => (string) $fromNode,
					'to' => (string) $toNode,
					'route_type' => (string) ($connection['route_type'] ?? ''),
					'transport_option' => (string) ($connection['transport_option'] ?? ''),
				];
			}
		}
	}

	return $connectionsById;
}

function avesmapsAnalyzeClientRouteOnServerGraph(array $clientGraph, array $request, array $serverRoute): array {
	$clientRoute = is_array($request['client_route'] ?? null) ? $request['client_route'] : [];
	$graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];
	$connectionsById = avesmapsBuildRouteConnectionIdIndex($graph);
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
		$matchingConnection = null;
		foreach (is_array($graph[$from][$to] ?? null) ? $graph[$from][$to] : [] as $connection) {
			if ((string) ($connection['id'] ?? '') === $connectionId) {
				$matchingConnection = $connection;
				break;
			}
		}

		if (!is_array($matchingConnection)) {
			$idCandidates = is_array($connectionsById[$connectionId] ?? null) ? $connectionsById[$connectionId] : [];
			$missingSegments[] = [
				'index' => (int) $index,
				'from' => $from,
				'to' => $to,
				'connection_id' => $connectionId,
				'from_known' => isset($graph[$from]),
				'to_known_from_source' => isset($graph[$from][$to]),
				'same_id_candidate_count' => count($idCandidates),
				'same_id_candidates' => array_slice($idCandidates, 0, 4),
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
			'edge_id' => $connectionId,
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
	$clientGraph = avesmapsBuildClientCompatibleRouteGraph($routeNetworkData, $request);
	$routeDijkstraResult = avesmapsFindClientCompatibleRoute($clientGraph, $fromLocation, $toLocation, $request);
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
			'from' => $fromLocation,
			'to' => $toLocation,
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
