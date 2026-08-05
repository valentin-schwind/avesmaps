<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/routing/client-graph.php';
require __DIR__ . '/../_internal/routing/map-data.php';
require __DIR__ . '/../_internal/routing/network-data.php';

// 💣 Teil des ETags, und deshalb hochzuzaehlen, sobald sich die FORM der Antwort aendert -- ein
// neues Feld, ein anderer Typ, eine andere Bedeutung. Sonst behaelt ein Aufrufer, der schon einen
// ETag hat, seine alte Kopie ueber ein 304 und sieht die Aenderung nie. Genau das ist dem
// Kartenendpunkt einmal passiert, als „political" dazukam.
const AVESMAPS_LOCATIONS_PAYLOAD_VERSION = 1;

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

	// 💣 ETag ZUERST, und dafuer eine eigene, winzige Abfrage. Dieser Endpunkt baut das komplette
	// Routennetz auf -- denselben Pfad, den api/route/index.php mit „62 MB resident, peak 152 MB per
	// call" beziffert und fuer den sechs Diagnose-Endpunkte hinter Rechte gelegt wurden. Der
	// oeffentliche Zwilling stand ohne Cache offen (Befund A14). Eine bedingte Anfrage kostet jetzt
	// EINE Zeile aus map_revision statt der ganzen Ladung; die Antwort haengt an nichts sonst.
	//
	// ⚠️ Die Verbindung wird durchgereicht, nicht zweimal geoeffnet -- max_user_connections.
	$pdo = avesmapsCreatePdo($config['database'] ?? []);
	$revision = avesmapsFetchRouteMapRevision($pdo);
	$etag = 'W/"loc-' . AVESMAPS_LOCATIONS_PAYLOAD_VERSION . '-' . $revision . '"';
	header('ETag: ' . $etag);
	header('Cache-Control: no-cache, must-revalidate');
	header('Vary: Accept-Encoding', false);
	$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
	if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
		http_response_code(304);
		exit;
	}

	$routeMapData = avesmapsLoadRouteMapData($config, $pdo);
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
} catch (PDOException) {
	// 💣 BEFORE the RuntimeException arm, never after: PDOException EXTENDS RuntimeException, so
	// that arm used to catch it and hand the driver's message -- table names, columns, fragments
	// of SQL -- to any anonymous caller. This is the stable public contract; it must not describe
	// the schema to the world. Every neighbouring endpoint already catches PDOException first.
	// The routing code's own RuntimeExceptions carry deliberate, safe text and still pass below.
	avesmapsLocationsErrorResponse(500, 'server_error', 'Die Orte konnten nicht aus der Datenbank geladen werden.');
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
