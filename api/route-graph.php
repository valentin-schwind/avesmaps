<?php

declare(strict_types=1);

function avesmapsBuildRouteGraph(array $networkData): array {
	$nodes = [];
	$edges = [];
	$pathFeatureCount = 0;

	$paths = is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [];
	foreach ($paths as $path) {
		if (!is_array($path)) {
			continue;
		}

		$pathFeatureCount++;
		$endpoints = avesmapsGetRoutePathEndpoints($path['geometry'] ?? null);
		if ($endpoints === null) {
			continue;
		}

		$fromNodeId = avesmapsBuildRouteNodeId($endpoints['start'][0], $endpoints['start'][1]);
		$toNodeId = avesmapsBuildRouteNodeId($endpoints['end'][0], $endpoints['end'][1]);

		$nodes[$fromNodeId] = [
			'id' => $fromNodeId,
			'x' => $endpoints['start'][0],
			'y' => $endpoints['start'][1],
		];
		$nodes[$toNodeId] = [
			'id' => $toNodeId,
			'x' => $endpoints['end'][0],
			'y' => $endpoints['end'][1],
		];

		$edges[] = avesmapsBuildRouteEdge($path, $fromNodeId, $toNodeId);
	}

	return [
		'nodes' => array_values($nodes),
		'edges' => $edges,
		'statistics' => [
			'node_count' => count($nodes),
			'edge_count' => count($edges),
			'path_feature_count' => $pathFeatureCount,
		],
	];
}

function avesmapsGetRoutePathEndpoints(mixed $geometry): ?array {
	if (!is_array($geometry)) {
		return null;
	}

	$geometryType = (string) ($geometry['type'] ?? '');
	$coordinates = $geometry['coordinates'] ?? null;
	if (!is_array($coordinates) || $coordinates === []) {
		return null;
	}

	if ($geometryType === 'LineString') {
		$start = $coordinates[0] ?? null;
		$end = $coordinates[count($coordinates) - 1] ?? null;
		return avesmapsNormalizeRouteEndpoints($start, $end);
	}

	if ($geometryType === 'MultiLineString') {
		$firstLine = $coordinates[0] ?? null;
		$lastLine = $coordinates[count($coordinates) - 1] ?? null;
		if (!is_array($firstLine) || !is_array($lastLine) || $firstLine === [] || $lastLine === []) {
			return null;
		}

		$start = $firstLine[0] ?? null;
		$end = $lastLine[count($lastLine) - 1] ?? null;
		return avesmapsNormalizeRouteEndpoints($start, $end);
	}

	return null;
}

function avesmapsNormalizeRouteEndpoints(mixed $start, mixed $end): ?array {
	$startPoint = avesmapsNormalizeRoutePoint($start);
	$endPoint = avesmapsNormalizeRoutePoint($end);
	if ($startPoint === null || $endPoint === null) {
		return null;
	}

	return [
		'start' => $startPoint,
		'end' => $endPoint,
	];
}

function avesmapsNormalizeRoutePoint(mixed $point): ?array {
	if (!is_array($point) || count($point) < 2) {
		return null;
	}

	$x = filter_var($point[0], FILTER_VALIDATE_FLOAT);
	$y = filter_var($point[1], FILTER_VALIDATE_FLOAT);
	if ($x === false || $y === false) {
		return null;
	}

	return [(float) $x, (float) $y];
}

function avesmapsBuildRouteNodeId(float $x, float $y): string {
	return round($x, 5) . ':' . round($y, 5);
}

function avesmapsBuildRouteEdge(array $path, string $fromNodeId, string $toNodeId): array {
	$subtype = (string) ($path['subtype'] ?? '');
	return [
		'id' => (string) ($path['id'] ?? ''),
		'path_id' => (string) ($path['public_id'] ?? $path['id'] ?? ''),
		'transport_type' => avesmapsGetRouteTransportType($subtype),
		'from' => $fromNodeId,
		'to' => $toNodeId,
		'geometry' => is_array($path['geometry'] ?? null) ? $path['geometry'] : [],
		'subtype' => $subtype,
	];
}
