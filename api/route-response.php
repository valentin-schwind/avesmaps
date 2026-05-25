<?php

declare(strict_types=1);

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
