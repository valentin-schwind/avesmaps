<?php

declare(strict_types=1);

function avesmapsBuildRouteGraph(array $networkData, array $options = []): array {
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

	$endpointSnapTolerance = (float) ($options['endpoint_snap_tolerance'] ?? 0.0);
	if ($endpointSnapTolerance > 0.0) {
		$groups = avesmapsBuildRouteGraphEndpointSnapGroups(array_values($nodes), $endpointSnapTolerance);
		$canonicalNodeMap = [];
		$canonicalNodes = [];
		foreach ($groups as $group) {
			$canonicalId = $group[0];
			$sumX = 0.0;
			$sumY = 0.0;
			$groupSize = count($group);
			foreach ($group as $nodeId) {
				$groupNode = $nodes[$nodeId];
				$sumX += $groupNode['x'];
				$sumY += $groupNode['y'];
				$canonicalNodeMap[$nodeId] = $canonicalId;
			}

			$canonicalNodes[$canonicalId] = [
				'id' => $canonicalId,
				'x' => $sumX / $groupSize,
				'y' => $sumY / $groupSize,
			];
		}

		$snappedEdges = [];
		foreach ($edges as $edge) {
			$fromNodeId = (string) ($edge['from'] ?? '');
			$toNodeId = (string) ($edge['to'] ?? '');
			$canonicalFrom = $canonicalNodeMap[$fromNodeId] ?? $fromNodeId;
			$canonicalTo = $canonicalNodeMap[$toNodeId] ?? $toNodeId;
			$snappedEdges[] = [
				'id' => (string) ($edge['id'] ?? ''),
				'path_id' => (string) ($edge['path_id'] ?? ''),
				'transport_type' => (string) ($edge['transport_type'] ?? ''),
				'from' => $canonicalFrom,
				'to' => $canonicalTo,
				'geometry' => is_array($edge['geometry'] ?? null) ? $edge['geometry'] : [],
				'subtype' => (string) ($edge['subtype'] ?? ''),
			];
		}

		$nodes = $canonicalNodes;
		$edges = $snappedEdges;
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

function avesmapsBuildRouteGraphEndpointSnapGroups(array $nodes, float $tolerance): array {
	$nodeCount = count($nodes);
	if ($nodeCount === 0) {
		return [];
	}

	$adjacency = [];
	for ($i = 0; $i < $nodeCount; $i++) {
		for ($j = $i + 1; $j < $nodeCount; $j++) {
			if (abs($nodes[$i]['x'] - $nodes[$j]['x']) <= $tolerance && abs($nodes[$i]['y'] - $nodes[$j]['y']) <= $tolerance) {
				$fromId = $nodes[$i]['id'];
				$toId = $nodes[$j]['id'];
				$adjacency[$fromId] ??= [];
				$adjacency[$toId] ??= [];
				$adjacency[$fromId][$toId] = true;
				$adjacency[$toId][$fromId] = true;
			}
		}
	}

	$groups = [];
	$visited = [];
	foreach (array_keys($adjacency) as $startNodeId) {
		if (isset($visited[$startNodeId])) {
			continue;
		}

		$stack = [$startNodeId];
		$group = [];
		$visited[$startNodeId] = true;

		while ($stack !== []) {
			$currentNodeId = array_pop($stack);
			$group[] = $currentNodeId;
			foreach (array_keys($adjacency[$currentNodeId] ?? []) as $neighborNodeId) {
				if (isset($visited[$neighborNodeId])) {
					continue;
				}

				$visited[$neighborNodeId] = true;
				$stack[] = $neighborNodeId;
			}
		}

		$groups[] = $group;
	}

	$remainingNodes = array_diff(array_column($nodes, 'id'), array_keys($visited));
	foreach ($remainingNodes as $remainingNodeId) {
		$groups[] = [$remainingNodeId];
	}

	return $groups;
}

function avesmapsAnalyzeRouteGraph(array $graph): array {
	$adjacency = avesmapsBuildGraphAdjacency($graph['nodes'] ?? [], $graph['edges'] ?? []);
	$components = avesmapsFindConnectedComponents($adjacency);
	$nodeCount = count($adjacency);
	$isolatedNodeCount = 0;
	$largestComponentSize = 0;

	foreach ($adjacency as $neighbors) {
		if (count($neighbors) === 0) {
			$isolatedNodeCount++;
		}
	}
	foreach ($components as $component) {
		$componentSize = count($component);
		if ($componentSize > $largestComponentSize) {
			$largestComponentSize = $componentSize;
		}
	}

	return [
		'connected_component_count' => count($components),
		'isolated_node_count' => $isolatedNodeCount,
		'largest_component_size' => $largestComponentSize,
		'average_degree' => avesmapsCalculateAverageDegree($adjacency),
		'degree_histogram' => avesmapsBuildRouteGraphDegreeHistogram($adjacency),
		'component_size_histogram' => avesmapsBuildRouteGraphComponentSizeHistogram($components),
		'edge_transport_counts' => avesmapsBuildRouteGraphEdgeTransportCounts($graph['edges'] ?? []),
		'duplicate_edge_count' => avesmapsCountRouteGraphDuplicates($graph['edges'] ?? []),
		'self_loop_count' => avesmapsCountRouteGraphSelfLoops($graph['edges'] ?? []),
		'largest_component_ratio' => $nodeCount > 0 ? $largestComponentSize / $nodeCount : 0.0,
	];
}

function avesmapsAnalyzeRouteEndpointSnapping(array $graph, float $tolerance): array {
	$nodes = [];
	foreach (is_array($graph['nodes'] ?? null) ? $graph['nodes'] : [] as $node) {
		if (!is_array($node)) {
			continue;
		}

		$nodeId = (string) ($node['id'] ?? '');
		if ($nodeId === '') {
			continue;
		}

		$x = filter_var($node['x'] ?? null, FILTER_VALIDATE_FLOAT);
		$y = filter_var($node['y'] ?? null, FILTER_VALIDATE_FLOAT);
		if ($x === false || $y === false) {
			continue;
		}

		$nodes[] = [
			'id' => $nodeId,
			'x' => (float) $x,
			'y' => (float) $y,
		];
	}

	$nodeCount = count($nodes);
	if ($nodeCount === 0) {
		return [
			'tolerance' => $tolerance,
			'merge_candidate_group_count' => 0,
			'merge_candidate_node_count' => 0,
			'largest_merge_group_size' => 0,
			'sample_groups' => [],
		];
	}

	$adjacency = [];
	for ($i = 0; $i < $nodeCount; $i++) {
		for ($j = $i + 1; $j < $nodeCount; $j++) {
			if (abs($nodes[$i]['x'] - $nodes[$j]['x']) <= $tolerance && abs($nodes[$i]['y'] - $nodes[$j]['y']) <= $tolerance) {
				$fromId = $nodes[$i]['id'];
				$toId = $nodes[$j]['id'];
				$adjacency[$fromId] ??= [];
				$adjacency[$toId] ??= [];
				$adjacency[$fromId][$toId] = true;
				$adjacency[$toId][$fromId] = true;
			}
		}
	}

	$groups = [];
	$visited = [];
	foreach (array_keys($adjacency) as $startNodeId) {
		if (isset($visited[$startNodeId])) {
			continue;
		}

		$stack = [$startNodeId];
		$group = [];
		$visited[$startNodeId] = true;

		while ($stack !== []) {
			$currentNodeId = array_pop($stack);
			$group[] = $currentNodeId;
			foreach (array_keys($adjacency[$currentNodeId] ?? []) as $neighborNodeId) {
				if (isset($visited[$neighborNodeId])) {
					continue;
				}

				$visited[$neighborNodeId] = true;
				$stack[] = $neighborNodeId;
			}
		}

		if (count($group) > 1) {
			$groups[] = $group;
		}
	}

	$mergeCandidateNodeCount = 0;
	$largestMergeGroupSize = 0;
	foreach ($groups as $group) {
		$groupSize = count($group);
		$mergeCandidateNodeCount += $groupSize;
		if ($groupSize > $largestMergeGroupSize) {
			$largestMergeGroupSize = $groupSize;
		}
	}

	usort($groups, static fn(array $a, array $b): int => count($b) <=> count($a));
	$sampleGroups = [];
	foreach (array_slice($groups, 0, 5) as $group) {
		$sampleGroups[] = [
			'size' => count($group),
			'nodes' => array_slice($group, 0, 5),
		];
	}

	return [
		'tolerance' => $tolerance,
		'merge_candidate_group_count' => count($groups),
		'merge_candidate_node_count' => $mergeCandidateNodeCount,
		'largest_merge_group_size' => $largestMergeGroupSize,
		'sample_groups' => $sampleGroups,
	];
}

function avesmapsBuildGraphAdjacency(array $nodes, array $edges): array {
	$adjacency = [];
	foreach ($nodes as $node) {
		if (!is_array($node)) {
			continue;
		}

		$nodeId = (string) ($node['id'] ?? '');
		if ($nodeId === '') {
			continue;
		}

		$adjacency[$nodeId] = [];
	}

	foreach ($edges as $edge) {
		if (!is_array($edge)) {
			continue;
		}

		$fromNodeId = (string) ($edge['from'] ?? '');
		$toNodeId = (string) ($edge['to'] ?? '');
		if ($fromNodeId === '' || $toNodeId === '') {
			continue;
		}

		$adjacency[$fromNodeId] ??= [];
		$adjacency[$toNodeId] ??= [];
		$adjacency[$fromNodeId][$toNodeId] = true;
		$adjacency[$toNodeId][$fromNodeId] = true;
	}

	return $adjacency;
}

function avesmapsFindConnectedComponents(array $adjacency): array {
	$components = [];
	$visitedNodes = [];

	foreach (array_keys($adjacency) as $startNodeId) {
		if (isset($visitedNodes[$startNodeId])) {
			continue;
		}

		$component = [];
		$stack = [$startNodeId];
		$visitedNodes[$startNodeId] = true;

		while ($stack !== []) {
			$currentNodeId = array_pop($stack);
			$component[] = $currentNodeId;
			$neighbors = array_keys($adjacency[$currentNodeId] ?? []);
			foreach ($neighbors as $neighborNodeId) {
				if (isset($visitedNodes[$neighborNodeId])) {
					continue;
				}

				$visitedNodes[$neighborNodeId] = true;
				$stack[] = $neighborNodeId;
			}
		}

		$components[] = $component;
	}

	return $components;
}

function avesmapsCalculateAverageDegree(array $adjacency): float {
	$nodeCount = count($adjacency);
	if ($nodeCount === 0) {
		return 0.0;
	}

	$degreeSum = 0;
	foreach ($adjacency as $neighbors) {
		$degreeSum += count($neighbors);
	}

	return $degreeSum / $nodeCount;
}

function avesmapsBuildRouteGraphDegreeHistogram(array $adjacency): array {
	$histogram = [
		'0' => 0,
		'1' => 0,
		'2' => 0,
		'3' => 0,
		'4+' => 0,
	];

	foreach ($adjacency as $neighbors) {
		$degree = count($neighbors);
		if ($degree === 0) {
			$histogram['0']++;
			continue;
		}
		if ($degree === 1) {
			$histogram['1']++;
			continue;
		}
		if ($degree === 2) {
			$histogram['2']++;
			continue;
		}
		if ($degree === 3) {
			$histogram['3']++;
			continue;
		}
		$histogram['4+']++;
	}

	return $histogram;
}

function avesmapsBuildRouteGraphComponentSizeHistogram(array $components): array {
	$histogram = [
		'1' => 0,
		'2' => 0,
		'3-10' => 0,
		'11-100' => 0,
		'101+' => 0,
	];

	foreach ($components as $component) {
		$size = count($component);
		if ($size === 1) {
			$histogram['1']++;
			continue;
		}
		if ($size === 2) {
			$histogram['2']++;
			continue;
		}
		if ($size <= 10) {
			$histogram['3-10']++;
			continue;
		}
		if ($size <= 100) {
			$histogram['11-100']++;
			continue;
		}
		$histogram['101+']++;
	}

	return $histogram;
}

function avesmapsBuildRouteGraphEdgeTransportCounts(array $edges): array {
	$counts = [
		'land' => 0,
		'river' => 0,
		'sea' => 0,
		'unknown' => 0,
	];

	foreach ($edges as $edge) {
		if (!is_array($edge)) {
			continue;
		}

		$type = (string) ($edge['transport_type'] ?? 'unknown');
		if (!isset($counts[$type])) {
			$type = 'unknown';
		}
		$counts[$type]++;
	}

	return $counts;
}

function avesmapsCountRouteGraphDuplicates(array $edges): int {
	$seen = [];
	$duplicateCount = 0;

	foreach ($edges as $edge) {
		if (!is_array($edge)) {
			continue;
		}

		$from = (string) ($edge['from'] ?? '');
		$to = (string) ($edge['to'] ?? '');
		if ($from === '' || $to === '') {
			continue;
		}

		$unorderedFrom = $from <= $to ? $from : $to;
		$unorderedTo = $from <= $to ? $to : $from;
		$key = $unorderedFrom . '|' . $unorderedTo;

		if (isset($seen[$key])) {
			$duplicateCount++;
		} else {
			$seen[$key] = true;
		}
	}

	return $duplicateCount;
}

function avesmapsCountRouteGraphSelfLoops(array $edges): int {
	$selfLoopCount = 0;
	foreach ($edges as $edge) {
		if (!is_array($edge)) {
			continue;
		}

		$from = (string) ($edge['from'] ?? '');
		$to = (string) ($edge['to'] ?? '');
		if ($from !== '' && $from === $to) {
			$selfLoopCount++;
		}
	}

	return $selfLoopCount;
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
