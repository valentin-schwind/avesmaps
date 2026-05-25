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

	$features = is_array($routeMapData['features'] ?? null) ? $routeMapData['features'] : [];
	foreach ($features as $feature) {
		if (!is_array($feature)) {
			continue;
		}

		if (avesmapsIsRouteLocation($feature)) {
			$locations[] = avesmapsBuildRouteLocationData($feature);
			$statistics['location_count']++;
			continue;
		}

		if (!avesmapsIsRoutePath($feature)) {
			continue;
		}

		$pathData = avesmapsBuildRoutePathData($feature);
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
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	return (string) ($properties['feature_type'] ?? '') === 'location';
}

function avesmapsIsRoutePath(array $feature): bool {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	return (string) ($properties['feature_type'] ?? '') === 'path';
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

function avesmapsBuildRouteLocationData(array $feature): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		'name' => (string) ($properties['name'] ?? ''),
		'subtype' => (string) ($properties['feature_subtype'] ?? ''),
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
	];
}

function avesmapsBuildRoutePathData(array $feature): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		'name' => (string) ($properties['name'] ?? ''),
		'subtype' => (string) ($properties['feature_subtype'] ?? ''),
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
	];
}
