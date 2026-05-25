<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

const AVESMAPS_ROUTE_DEFAULT_REQUEST = [
	'optimize' => 'fastest',
	'include_air_distance' => true,
	'include_geometry' => true,
	'include_steps' => true,
	'include_rests' => true,
	'rest_hours_per_day' => 10.0,
	'minimize_transfers' => false,
	'transports' => [
		'land' => 'groupFoot',
		'river' => 'riverSailer',
		'sea' => 'cargoShip',
		'synthetic' => 'groupFoot',
	],
];

const AVESMAPS_ROUTE_ALLOWED_OPTIMIZE = ['fastest', 'shortest'];
const AVESMAPS_ROUTE_ALLOWED_LAND_TRANSPORTS = ['caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider'];
const AVESMAPS_ROUTE_ALLOWED_RIVER_TRANSPORTS = ['riverSailer', 'riverBarge'];
const AVESMAPS_ROUTE_ALLOWED_SEA_TRANSPORTS = ['cargoShip', 'fastShip', 'galley'];
const AVESMAPS_ROUTE_REST_HOURS_MIN = 0.0;
const AVESMAPS_ROUTE_REST_HOURS_MAX = 23.5;

try {
	$config = avesmapsLoadApiConfig(__DIR__);

	if (!avesmapsApplyCorsPolicy($config)) {
		avesmapsRouteErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Routing-Endpunkt nicht verwenden.');
	}

	$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
	if ($requestMethod === 'OPTIONS') {
		avesmapsJsonResponse(204);
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

function avesmapsNormalizeRouteRequest(array $payload): array {
	$from = avesmapsRouteNormalizeRequiredString($payload, 'from');
	$to = avesmapsRouteNormalizeRequiredString($payload, 'to');
	$via = avesmapsRouteNormalizeVia($payload['via'] ?? []);
	$optimize = avesmapsRouteNormalizeEnum(
		$payload['optimize'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['optimize'],
		AVESMAPS_ROUTE_ALLOWED_OPTIMIZE,
		'optimize'
	);
	$includeAirDistance = avesmapsRouteNormalizeBoolean($payload['include_air_distance'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['include_air_distance'], 'include_air_distance');
	$includeGeometry = avesmapsRouteNormalizeBoolean($payload['include_geometry'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['include_geometry'], 'include_geometry');
	$includeSteps = avesmapsRouteNormalizeBoolean($payload['include_steps'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['include_steps'], 'include_steps');
	$includeRests = avesmapsRouteNormalizeBoolean($payload['include_rests'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['include_rests'], 'include_rests');
	$restHoursPerDay = avesmapsRouteNormalizeRestHours($payload['rest_hours_per_day'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['rest_hours_per_day']);
	$minimizeTransfers = avesmapsRouteNormalizeBoolean($payload['minimize_transfers'] ?? AVESMAPS_ROUTE_DEFAULT_REQUEST['minimize_transfers'], 'minimize_transfers');
	$transports = avesmapsRouteNormalizeTransports($payload['transports'] ?? []);

	return [
		'from' => $from,
		'to' => $to,
		'via' => $via,
		'optimize' => $optimize,
		'include_air_distance' => $includeAirDistance,
		'include_geometry' => $includeGeometry,
		'include_steps' => $includeSteps,
		'include_rests' => $includeRests,
		'rest_hours_per_day' => $restHoursPerDay,
		'minimize_transfers' => $minimizeTransfers,
		'transports' => $transports,
	];
}

function avesmapsRouteNormalizeRequiredString(array $payload, string $field): string {
	$value = avesmapsNormalizeSingleLine((string) ($payload[$field] ?? ''), 120);
	if ($value === '') {
		throw new InvalidArgumentException("Missing or invalid required field: {$field}");
	}

	return $value;
}

function avesmapsRouteNormalizeVia(mixed $value): array {
	if ($value === null) {
		return [];
	}

	if (!is_array($value)) {
		throw new InvalidArgumentException('Invalid field: via must be an array of strings.');
	}

	$normalizedVia = [];
	foreach ($value as $entry) {
		$normalizedEntry = avesmapsNormalizeSingleLine((string) $entry, 120);
		if ($normalizedEntry !== '') {
			$normalizedVia[] = $normalizedEntry;
		}
	}

	return array_values($normalizedVia);
}

function avesmapsRouteNormalizeBoolean(mixed $value, string $field): bool {
	if (is_bool($value)) {
		return $value;
	}

	$normalizedValue = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
	if ($normalizedValue === null) {
		throw new InvalidArgumentException("Invalid field: {$field} must be boolean.");
	}

	return $normalizedValue;
}

function avesmapsRouteNormalizeEnum(mixed $value, array $allowedValues, string $field): string {
	$normalizedValue = avesmapsNormalizeSingleLine((string) $value, 60);
	if (!in_array($normalizedValue, $allowedValues, true)) {
		throw new InvalidArgumentException("Invalid field: {$field} has unsupported value.");
	}

	return $normalizedValue;
}

function avesmapsRouteNormalizeRestHours(mixed $value): float {
	$normalizedValue = is_string($value) ? str_replace(',', '.', trim($value)) : $value;
	$restHours = filter_var($normalizedValue, FILTER_VALIDATE_FLOAT);
	if ($restHours === false) {
		throw new InvalidArgumentException('Invalid field: rest_hours_per_day must be numeric.');
	}

	$restHours = round((float) $restHours, 2);
	if ($restHours < AVESMAPS_ROUTE_REST_HOURS_MIN || $restHours > AVESMAPS_ROUTE_REST_HOURS_MAX) {
		throw new InvalidArgumentException('Invalid field: rest_hours_per_day must be between 0 and 23.5.');
	}

	return $restHours;
}

function avesmapsRouteNormalizeTransports(mixed $value): array {
	if ($value === null) {
		$value = [];
	}

	if (!is_array($value)) {
		throw new InvalidArgumentException('Invalid field: transports must be an object.');
	}

	$defaults = AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'];
	$land = avesmapsRouteNormalizeEnum($value['land'] ?? $defaults['land'], AVESMAPS_ROUTE_ALLOWED_LAND_TRANSPORTS, 'transports.land');
	$river = avesmapsRouteNormalizeEnum($value['river'] ?? $defaults['river'], AVESMAPS_ROUTE_ALLOWED_RIVER_TRANSPORTS, 'transports.river');
	$sea = avesmapsRouteNormalizeEnum($value['sea'] ?? $defaults['sea'], AVESMAPS_ROUTE_ALLOWED_SEA_TRANSPORTS, 'transports.sea');
	$synthetic = avesmapsRouteNormalizeEnum($value['synthetic'] ?? $defaults['synthetic'], AVESMAPS_ROUTE_ALLOWED_LAND_TRANSPORTS, 'transports.synthetic');

	return [
		'land' => $land,
		'river' => $river,
		'sea' => $sea,
		'synthetic' => $synthetic,
	];
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
