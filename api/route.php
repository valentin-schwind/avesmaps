<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/route-request.php';
require __DIR__ . '/route-response.php';
require __DIR__ . '/route-map-data.php';
require __DIR__ . '/route-network-data.php';

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
