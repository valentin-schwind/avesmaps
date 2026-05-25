<?php

declare(strict_types=1);

require __DIR__ . '/../bootstrap.php';
require __DIR__ . '/../_internal/routing/client-graph.php';
require __DIR__ . '/../_internal/routing/map-data.php';
require __DIR__ . '/../_internal/routing/network-data.php';

try {
	$config = avesmapsLoadApiConfig(avesmapsApiRoot());

	if (!avesmapsApplyCorsPolicy($config)) {
		avesmapsLocationsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Locations-Endpunkt nicht verwenden.');
	}

	$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
	if ($requestMethod === 'OPTIONS') {
		avesmapsJsonResponse(204);
	}

	if ($requestMethod !== 'GET') {
		avesmapsLocationsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer Locations erlaubt.');
	}

	$routeMapData = avesmapsLoadRouteMapData($config);
	$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
	$locations = avesmapsBuildLocationsResponseItems($routeNetworkData);

	avesmapsJsonResponse(200, [
		'ok' => true,
		'map_revision' => (int) ($routeMapData['revision'] ?? 0),
		'location_count' => count($locations),
		'locations' => $locations,
	]);
} catch (JsonException) {
	avesmapsLocationsErrorResponse(500, 'server_error', 'Die Antwort konnte nicht serialisiert werden.');
} catch (RuntimeException $exception) {
	avesmapsLocationsErrorResponse(500, 'server_error', $exception->getMessage());
} catch (Throwable) {
	avesmapsLocationsErrorResponse(500, 'server_error', 'Die Anfrage konnte nicht verarbeitet werden.');
}

function avesmapsBuildLocationsResponseItems(array $routeNetworkData): array {
	$locations = [];
	foreach (is_array($routeNetworkData['locations'] ?? null) ? $routeNetworkData['locations'] : [] as $location) {
		if (!is_array($location)) {
			continue;
		}

		$name = trim((string) ($location['name'] ?? ''));
		if ($name === '') {
			continue;
		}

		$geometry = is_array($location['geometry'] ?? null) ? $location['geometry'] : [];
		$coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
		$x = filter_var($coordinates[0] ?? null, FILTER_VALIDATE_FLOAT);
		$y = filter_var($coordinates[1] ?? null, FILTER_VALIDATE_FLOAT);

		$locations[] = [
			'id' => (string) ($location['id'] ?? ''),
			'public_id' => (string) ($location['public_id'] ?? ''),
			'name' => $name,
			'subtype' => (string) ($location['subtype'] ?? ''),
			'is_crossing' => strncmp($name, 'Kreuzung-', strlen('Kreuzung-')) === 0,
			'coordinates' => [
				'x' => $x === false ? 0.0 : (float) $x,
				'y' => $y === false ? 0.0 : (float) $y,
			],
		];
	}

	usort($locations, static function (array $left, array $right): int {
		$leftName = mb_strtolower((string) ($left['name'] ?? ''), 'UTF-8');
		$rightName = mb_strtolower((string) ($right['name'] ?? ''), 'UTF-8');

		return $leftName <=> $rightName;
	});

	return $locations;
}

function avesmapsLocationsErrorResponse(int $statusCode, string $code, string $message): never {
	avesmapsJsonResponse($statusCode, [
		'ok' => false,
		'error' => [
			'code' => $code,
			'message' => $message,
		],
	]);
}
