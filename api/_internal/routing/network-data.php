<?php

declare(strict_types=1);

function avesmapsBuildRouteNetworkData(array $routeMapData): array {
	$locations = [];
	$paths = [];
	$statistics = [
		'location_count' => 0,
		'path_count' => 0,
		'river_count' => 0,
		'sea_count' => 0,
		'land_count' => 0,
		'unknown_count' => 0,
		'subtype_counts' => [],
	];

	$clientPathIndex = 0;
	$clientCrossingIndex = 1;
	$features = is_array($routeMapData['features'] ?? null) ? $routeMapData['features'] : [];
	foreach ($features as $feature) {
		if (!is_array($feature)) {
			continue;
		}

		$clientPathId = '';
		if (avesmapsIsClientRenderableRoutePath($feature)) {
			$clientPathIndex++;
			$clientPathId = 'path-' . $clientPathIndex;
		}

		if (avesmapsIsRouteLocation($feature)) {
			$locations[] = avesmapsBuildRouteLocationData($feature, $clientCrossingIndex);
			if (avesmapsIsRouteCrossingLocation($feature)) {
				$clientCrossingIndex++;
			}
			$statistics['location_count']++;
			continue;
		}

		if (!avesmapsIsRoutePath($feature)) {
			continue;
		}

		$pathData = avesmapsBuildRoutePathData($feature, $clientPathId);
		$paths[] = $pathData;
		$statistics['path_count']++;
		$subtypeKey = (string) $pathData['subtype'];
		$statistics['subtype_counts'][$subtypeKey] = (int) ($statistics['subtype_counts'][$subtypeKey] ?? 0) + 1;

		$transportType = avesmapsGetRouteTransportType($pathData['subtype']);
		if ($transportType === 'river') {
			$statistics['river_count']++;
		} elseif ($transportType === 'sea') {
			$statistics['sea_count']++;
		} elseif ($transportType === 'land') {
			$statistics['land_count']++;
		} else {
			$statistics['unknown_count']++;
		}
	}

	return [
		'locations' => $locations,
		'paths' => $paths,
		'statistics' => $statistics,
	];
}

function avesmapsIsRouteLocation(array $feature): bool {
	$geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$name = trim((string) ($properties['name'] ?? ''));
	return (string) ($geometry['type'] ?? '') === 'Point'
		&& $name !== ''
		&& (string) ($properties['feature_type'] ?? '') !== 'label';
}

function avesmapsIsRouteCrossingLocation(array $feature): bool {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	return strncmp((string) ($properties['name'] ?? ''), 'Kreuzung', strlen('Kreuzung')) === 0;
}

function avesmapsIsRoutePath(array $feature): bool {
	return avesmapsIsClientRenderableRoutePath($feature);
}

function avesmapsIsClientRenderableRoutePath(array $feature): bool {
	$geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	return (string) ($geometry['type'] ?? '') === 'LineString'
		&& (string) ($properties['feature_type'] ?? '') !== ('power' . 'line');
}

function avesmapsGetRouteTransportType(string $subtype): string {
	$normalizedSubtype = avesmapsNormalizeRouteSubtypeKey($subtype);
	if (in_array($normalizedSubtype, ['pfad', 'weg', 'strasse', 'reichsstrasse', 'gebirgspass', 'wuestenpfad'], true)) {
		return 'land';
	}
	if ($normalizedSubtype === 'flussweg') {
		return 'river';
	}
	if ($normalizedSubtype === 'seeweg') {
		return 'sea';
	}

	return 'unknown';
}

function avesmapsNormalizeRouteSubtypeKey(string $subtype): string {
	$normalizedSubtype = strtolower(trim($subtype));
	$normalizedSubtype = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $normalizedSubtype);

	return $normalizedSubtype;
}

function avesmapsResolveRoutePathSubtype(array $properties): string {
	$featureSubtype = trim((string) ($properties['feature_subtype'] ?? ''));
	$displayName = trim((string) ($properties['display_name'] ?? ''));
	$originalName = trim((string) ($properties['original_name'] ?? ''));
	$name = trim((string) ($properties['name'] ?? ''));
	$subtypeCandidate = $featureSubtype !== '' ? $featureSubtype : ($displayName !== '' ? $displayName : ($originalName !== '' ? $originalName : ($name !== '' ? $name : 'Weg')));

	return avesmapsNormalizeClientRouteSubtype($subtypeCandidate);
}

function avesmapsBuildRouteLocationData(array $feature, int $clientCrossingIndex = 1): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$name = (string) ($properties['name'] ?? '');
	if (strncmp($name, 'Kreuzung', strlen('Kreuzung')) === 0) {
		$name = 'Kreuzung-' . $clientCrossingIndex;
	}

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		'name' => $name,
		'subtype' => (string) ($properties['feature_subtype'] ?? ''),
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
	];
}

function avesmapsBuildRoutePathData(array $feature, string $clientPathId = ''): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$routeSubtype = avesmapsResolveRoutePathSubtype($properties);

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		'client_path_id' => $clientPathId,
		'name' => $routeSubtype,
		'subtype' => $routeSubtype,
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
		// Flussrichtung spec §2: top-level properties.flow, needed by the graph builder.
		'flow' => is_array($properties['flow'] ?? null) ? $properties['flow'] : null,
	];
}
