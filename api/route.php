<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/route-request.php';
require __DIR__ . '/route-response.php';
require __DIR__ . '/route-map-data.php';
require __DIR__ . '/route-network-data.php';
require __DIR__ . '/route-graph.php';

try {
	$config = avesmapsLoadApiConfig(__DIR__);

	if (!avesmapsApplyCorsPolicy($config)) {
		avesmapsRouteErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Routing-Endpunkt nicht verwenden.');
	}

	$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
	if ($requestMethod === 'OPTIONS') {
		avesmapsJsonResponse(204);
	}

	$routeDiagnostic = trim((string) ($_GET['diagnostic'] ?? ''));
	if ($requestMethod === 'GET' && $routeDiagnostic === 'map-data') {
		$routeMapData = avesmapsLoadRouteMapData($config);
		$firstFeature = $routeMapData['features'][0] ?? [];
		$firstFeatureProperties = is_array($firstFeature['properties'] ?? null) ? $firstFeature['properties'] : [];
		$firstFeatureGeometry = is_array($firstFeature['geometry'] ?? null) ? $firstFeature['geometry'] : [];

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'map-data',
			'request_method' => $requestMethod,
			'diagnostic_param' => $routeDiagnostic,
			'revision' => (int) ($routeMapData['revision'] ?? 0),
			'feature_count' => (int) ($routeMapData['feature_count'] ?? 0),
			'sample' => [
				'first_feature_id' => (string) ($firstFeature['id'] ?? ''),
				'first_feature_type' => (string) ($firstFeatureProperties['feature_type'] ?? ''),
				'first_feature_subtype' => (string) ($firstFeatureProperties['feature_subtype'] ?? ''),
				'first_feature_geometry_type' => (string) ($firstFeatureGeometry['type'] ?? ''),
			],
		]);
	}
	if ($requestMethod === 'GET' && $routeDiagnostic === 'network-data') {
		$routeMapData = avesmapsLoadRouteMapData($config);
		$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
		$firstLocation = $routeNetworkData['locations'][0] ?? [];
		$firstPath = $routeNetworkData['paths'][0] ?? [];

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'network-data',
			'statistics' => $routeNetworkData['statistics'],
			'sample' => [
				'first_location' => (string) (($firstLocation['name'] ?? '') !== '' ? $firstLocation['name'] : ($firstLocation['id'] ?? '')),
				'first_path' => (string) (($firstPath['name'] ?? '') !== '' ? $firstPath['name'] : ($firstPath['id'] ?? '')),
				'first_path_subtype' => (string) ($firstPath['subtype'] ?? ''),
				'first_path_transport_type' => avesmapsGetRouteTransportType((string) ($firstPath['subtype'] ?? '')),
			],
		]);
	}
	if ($requestMethod === 'GET' && $routeDiagnostic === 'location-node-data') {
		$locationName = trim((string) ($_GET['name'] ?? ''));
		if ($locationName === '') {
			avesmapsRouteErrorResponse(400, 'invalid_request', 'The location name is required.');
		}

		$routeMapData = avesmapsLoadRouteMapData($config);
		$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
		$locationFound = false;
		foreach (is_array($routeNetworkData['locations'] ?? null) ? $routeNetworkData['locations'] : [] as $candidate) {
			if (!is_array($candidate)) {
				continue;
			}
			$name = trim((string) ($candidate['name'] ?? ''));
			if ($name === '') {
				continue;
			}
			if (mb_strtolower($name, 'UTF-8') === mb_strtolower($locationName, 'UTF-8')) {
				$locationFound = true;
				break;
			}
		}
		if (!$locationFound) {
			avesmapsRouteErrorResponse(404, 'location_not_found', 'Location not found.');
		}

		$routeGraphWeighted001 = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.001,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
			'include_edge_weights' => true,
		]);
		$routeLocationNode = avesmapsFindNearestGraphNodeForLocation($routeGraphWeighted001, $routeNetworkData, $locationName);

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'location-node-data',
			'result' => $routeLocationNode,
		]);
	}
	if ($requestMethod === 'GET' && $routeDiagnostic === 'route-name-data') {
		$fromLocation = trim((string) ($_GET['from'] ?? ''));
		$toLocation = trim((string) ($_GET['to'] ?? ''));
		if ($fromLocation === '' || $toLocation === '') {
			avesmapsRouteErrorResponse(400, 'invalid_request', 'Both from and to location names are required.');
		}

		$routeMapData = avesmapsLoadRouteMapData($config);
		$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
		$routeGraphWeighted001 = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.001,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
			'include_edge_weights' => true,
		]);

		$fromNodeData = avesmapsFindNearestGraphNodeForLocation($routeGraphWeighted001, $routeNetworkData, $fromLocation);
		if ($fromNodeData['found'] === false) {
			avesmapsRouteErrorResponse(404, 'location_not_found', 'From location not found.');
		}

		$toNodeData = avesmapsFindNearestGraphNodeForLocation($routeGraphWeighted001, $routeNetworkData, $toLocation);
		if ($toNodeData['found'] === false) {
			avesmapsRouteErrorResponse(404, 'location_not_found', 'To location not found.');
		}

		$routeDijkstraResult = avesmapsFindShortestRouteInGraph($routeGraphWeighted001, $fromNodeData['nearest_node_id'], $toNodeData['nearest_node_id']);

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'route-name-data',
			'from' => $fromLocation,
			'to' => $toLocation,
			'from_node' => $fromNodeData['nearest_node_id'],
			'to_node' => $toNodeData['nearest_node_id'],
			'result' => [
				'found' => (bool) ($routeDijkstraResult['found'] ?? false),
				'cost' => (float) ($routeDijkstraResult['cost'] ?? 0.0),
				'node_count' => count($routeDijkstraResult['node_ids'] ?? []),
				'edge_count' => (int) ($routeDijkstraResult['edge_count'] ?? 0),
			],
		]);
	}
	if ($requestMethod === 'GET' && $routeDiagnostic === 'dijkstra-data') {
		$fromNodeId = trim((string) ($_GET['from_node'] ?? ''));
		$toNodeId = trim((string) ($_GET['to_node'] ?? ''));
		if ($fromNodeId === '' || $toNodeId === '') {
			avesmapsRouteErrorResponse(400, 'invalid_request', 'Both from_node and to_node are required.');
		}

		$routeMapData = avesmapsLoadRouteMapData($config);
		$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
		$routeGraphWeighted001 = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.001,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
			'include_edge_weights' => true,
		]);
		$routeDijkstraResult = avesmapsFindShortestRouteInGraph($routeGraphWeighted001, $fromNodeId, $toNodeId);

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'dijkstra-data',
			'from_node' => $fromNodeId,
			'to_node' => $toNodeId,
			'result' => [
				'found' => (bool) ($routeDijkstraResult['found'] ?? false),
				'cost' => (float) ($routeDijkstraResult['cost'] ?? 0.0),
				'node_count' => count($routeDijkstraResult['node_ids'] ?? []),
				'edge_count' => (int) ($routeDijkstraResult['edge_count'] ?? 0),
			],
		]);
	}
	if ($requestMethod === 'GET' && $routeDiagnostic === 'graph-data') {
		$routeMapData = avesmapsLoadRouteMapData($config);
		$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
		$routeGraph = avesmapsBuildRouteGraph($routeNetworkData);
		$routeGraphSnapped00001 = avesmapsBuildRouteGraph($routeNetworkData, ['endpoint_snap_tolerance' => 0.00001]);
		$routeGraphSnapped0001 = avesmapsBuildRouteGraph($routeNetworkData, ['endpoint_snap_tolerance' => 0.0001]);
		$routeGraphSnapped001 = avesmapsBuildRouteGraph($routeNetworkData, ['endpoint_snap_tolerance' => 0.001]);
		$routeGraphSnapped01 = avesmapsBuildRouteGraph($routeNetworkData, ['endpoint_snap_tolerance' => 0.01]);
		$routeGraphCleaned001 = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.001,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
		]);
		$routeGraphWeighted001 = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.001,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
			'include_edge_weights' => true,
		]);
		$routeGraphCleaned = avesmapsBuildRouteGraph($routeNetworkData, [
			'endpoint_snap_tolerance' => 0.01,
			'deduplicate_edges' => true,
			'remove_self_loops' => true,
		]);
		$routeGraphAnalysis = avesmapsAnalyzeRouteGraph($routeGraph);
		$routeGraphSnapped00001Analysis = avesmapsAnalyzeRouteGraph($routeGraphSnapped00001);
		$routeGraphSnapped0001Analysis = avesmapsAnalyzeRouteGraph($routeGraphSnapped0001);
		$routeGraphSnapped001Analysis = avesmapsAnalyzeRouteGraph($routeGraphSnapped001);
		$routeGraphSnapped01Analysis = avesmapsAnalyzeRouteGraph($routeGraphSnapped01);
		$routeGraphCleaned001Analysis = avesmapsAnalyzeRouteGraph($routeGraphCleaned001);
		$routeGraphCleanedAnalysis = avesmapsAnalyzeRouteGraph($routeGraphCleaned);
		$weightedEdges = is_array($routeGraphWeighted001['edges'] ?? null) ? $routeGraphWeighted001['edges'] : [];
		$weightedEdgeCount = count($weightedEdges);
		$minWeight = INF;
		$maxWeight = 0.0;
		$sumWeight = 0.0;
		$zeroWeightCount = 0;

		foreach ($weightedEdges as $weightedEdge) {
			if (!is_array($weightedEdge)) {
				continue;
			}

			$weight = (float) ($weightedEdge['weight'] ?? 0.0);
			$sumWeight += $weight;
			if ($weight < $minWeight) {
				$minWeight = $weight;
			}
			if ($weight > $maxWeight) {
				$maxWeight = $weight;
			}
			if ($weight === 0.0) {
				$zeroWeightCount++;
			}
		}

		if ($weightedEdgeCount === 0 || $minWeight === INF) {
			$minWeight = 0.0;
		}

		$averageWeight = $weightedEdgeCount > 0 ? $sumWeight / $weightedEdgeCount : 0.0;

		$routeGraphEndpointSnapping = [
			'0.00001' => avesmapsAnalyzeRouteEndpointSnapping($routeGraph, 0.00001),
			'0.0001' => avesmapsAnalyzeRouteEndpointSnapping($routeGraph, 0.0001),
			'0.001' => avesmapsAnalyzeRouteEndpointSnapping($routeGraph, 0.001),
			'0.01' => avesmapsAnalyzeRouteEndpointSnapping($routeGraph, 0.01),
		];
		$firstNode = $routeGraph['nodes'][0] ?? [];
		$firstEdge = $routeGraph['edges'][0] ?? [];

		avesmapsJsonResponse(200, [
			'ok' => true,
			'diagnostic' => 'graph-data',
			'statistics' => [
				'node_count' => (int) ($routeGraph['statistics']['node_count'] ?? 0),
				'edge_count' => (int) ($routeGraph['statistics']['edge_count'] ?? 0),
				'connected_component_count' => (int) ($routeGraphAnalysis['connected_component_count'] ?? 0),
				'isolated_node_count' => (int) ($routeGraphAnalysis['isolated_node_count'] ?? 0),
				'largest_component_size' => (int) ($routeGraphAnalysis['largest_component_size'] ?? 0),
				'average_degree' => round((float) ($routeGraphAnalysis['average_degree'] ?? 0.0), 6),
				'degree_histogram' => $routeGraphAnalysis['degree_histogram'] ?? [],
				'component_size_histogram' => $routeGraphAnalysis['component_size_histogram'] ?? [],
				'edge_transport_counts' => $routeGraphAnalysis['edge_transport_counts'] ?? [],
				'duplicate_edge_count' => (int) ($routeGraphAnalysis['duplicate_edge_count'] ?? 0),
				'self_loop_count' => (int) ($routeGraphAnalysis['self_loop_count'] ?? 0),
				'endpoint_snapping' => $routeGraphEndpointSnapping,
				'snapped_0_00001' => [
					'node_count' => (int) ($routeGraphSnapped00001['statistics']['node_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphSnapped00001Analysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphSnapped00001Analysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphSnapped00001['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphSnapped00001Analysis['largest_component_size'] ?? 0) / (int) ($routeGraphSnapped00001['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphSnapped00001Analysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphSnapped00001Analysis['self_loop_count'] ?? 0),
				],
				'snapped_0_0001' => [
					'node_count' => (int) ($routeGraphSnapped0001['statistics']['node_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphSnapped0001Analysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphSnapped0001Analysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphSnapped0001['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphSnapped0001Analysis['largest_component_size'] ?? 0) / (int) ($routeGraphSnapped0001['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphSnapped0001Analysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphSnapped0001Analysis['self_loop_count'] ?? 0),
				],
				'snapped_0_001' => [
					'node_count' => (int) ($routeGraphSnapped001['statistics']['node_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphSnapped001Analysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphSnapped001Analysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphSnapped001['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphSnapped001Analysis['largest_component_size'] ?? 0) / (int) ($routeGraphSnapped001['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphSnapped001Analysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphSnapped001Analysis['self_loop_count'] ?? 0),
				],
				'snapped_0_01' => [
					'node_count' => (int) ($routeGraphSnapped01['statistics']['node_count'] ?? 0),
					'edge_count' => (int) ($routeGraphSnapped01['statistics']['edge_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphSnapped01Analysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphSnapped01Analysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphSnapped01['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphSnapped01Analysis['largest_component_size'] ?? 0) / (int) ($routeGraphSnapped01['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphSnapped01Analysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphSnapped01Analysis['self_loop_count'] ?? 0),
				],
				'cleaned_0_001' => [
					'node_count' => (int) ($routeGraphCleaned001['statistics']['node_count'] ?? 0),
					'edge_count' => (int) ($routeGraphCleaned001['statistics']['edge_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphCleaned001Analysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphCleaned001Analysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphCleaned001['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphCleaned001Analysis['largest_component_size'] ?? 0) / (int) ($routeGraphCleaned001['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphCleaned001Analysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphCleaned001Analysis['self_loop_count'] ?? 0),
				],
				'weighted_0_001' => [
					'node_count' => (int) ($routeGraphWeighted001['statistics']['node_count'] ?? 0),
					'edge_count' => (int) ($routeGraphWeighted001['statistics']['edge_count'] ?? 0),
					'weighted_edge_count' => $weightedEdgeCount,
					'min_weight' => $minWeight,
					'max_weight' => $maxWeight,
					'average_weight' => $averageWeight,
					'zero_weight_count' => $zeroWeightCount,
				],
				'cleaned_0_01' => [
					'node_count' => (int) ($routeGraphCleaned['statistics']['node_count'] ?? 0),
					'edge_count' => (int) ($routeGraphCleaned['statistics']['edge_count'] ?? 0),
					'connected_component_count' => (int) ($routeGraphCleanedAnalysis['connected_component_count'] ?? 0),
					'largest_component_size' => (int) ($routeGraphCleanedAnalysis['largest_component_size'] ?? 0),
					'largest_component_ratio' => (int) ($routeGraphCleaned['statistics']['node_count'] ?? 0) > 0 ? round((float) ($routeGraphCleanedAnalysis['largest_component_size'] ?? 0) / (int) ($routeGraphCleaned['statistics']['node_count'] ?? 0), 6) : 0.0,
					'duplicate_edge_count' => (int) ($routeGraphCleanedAnalysis['duplicate_edge_count'] ?? 0),
					'self_loop_count' => (int) ($routeGraphCleanedAnalysis['self_loop_count'] ?? 0),
				],
			],
			'sample' => [
				'first_node' => (string) ($firstNode['id'] ?? ''),
				'first_edge_transport' => (string) ($firstEdge['transport_type'] ?? ''),
				'largest_component_ratio' => round((float) ($routeGraphAnalysis['largest_component_ratio'] ?? 0.0), 6),
			],
		]);
	}

	if ($requestMethod !== 'POST') {
		avesmapsRouteErrorResponse(405, 'method_not_allowed', 'Nur POST-Anfragen sind fuer Routing erlaubt.');
	}

	$requestPayload = avesmapsReadJsonRequest();
	$normalizedRequest = avesmapsNormalizeRouteRequest($requestPayload);

	avesmapsJsonResponse(501, [
		'ok' => false,
		'error' => [
			'code' => 'not_implemented',
			'message' => 'Server-side routing is not implemented yet.',
		],
		'request' => $normalizedRequest,
	]);
} catch (JsonException) {
	avesmapsRouteErrorResponse(500, 'server_error', 'Die Antwort konnte nicht serialisiert werden.');
} catch (InvalidArgumentException $exception) {
	$message = $exception->getMessage();
	if ($message === 'Die Anfrage enthaelt keine JSON-Daten.' || $message === 'Die Anfrage enthaelt ungueltiges JSON.' || $message === 'Die Anfrage enthaelt kein gueltiges JSON-Objekt.') {
		avesmapsRouteErrorResponse(400, 'invalid_json', $message);
	}

	avesmapsRouteErrorResponse(400, 'invalid_request', $message);
} catch (RuntimeException $exception) {
	avesmapsRouteErrorResponse(500, 'server_error', $exception->getMessage());
} catch (Throwable) {
	avesmapsRouteErrorResponse(500, 'server_error', 'Die Anfrage konnte nicht verarbeitet werden.');
}
