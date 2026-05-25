<?php

declare(strict_types=1);

require_once __DIR__ . '/route-client-graph.php';

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
		],
	];
}

function avesmapsBuildMinimalRouteResponse(array $route): array {
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
			'from_node' => (string) ($route['from_node'] ?? ''),
			'to_node' => (string) ($route['to_node'] ?? ''),
			'node_ids' => is_array($route['node_ids'] ?? null) ? $route['node_ids'] : [],
			'edge_ids' => is_array($route['edge_ids'] ?? null) ? $route['edge_ids'] : [],
		],
		'segments' => is_array($route['segments'] ?? null) ? $route['segments'] : [],
	];
}
