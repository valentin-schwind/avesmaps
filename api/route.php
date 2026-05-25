<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/route-request.php';

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
