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

	// 🔴 `true` = FUER JEDE HERKUNFT OFFEN -- derselbe Entscheid wie beim Routing-Endpunkt, und hier
	// war er der Anlass: Meldung #96 wollte die bedingte Anfrage nutzen und bekam eine 403, noch
	// bevor der ETag ueberhaupt zur Sprache kam. Begruendung samt Sicherung bei der Funktion.
	if (!avesmapsApplyCorsPolicy($config, true)) {
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
	$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
	if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
		avesmapsSendLocationsCacheHeaders($etag);
		http_response_code(304);
		exit;
	}

	$routeMapData = avesmapsLoadRouteMapData($config, $pdo);
	$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);
	$locations = avesmapsBuildLocationsResponseItems($routeNetworkData);

	// 💣 ERST HIER, nicht vor dem Laden. Ein ETag, der schon steht, waehrend die 152-MB-Ladung
	// laeuft, haengt auch an dem, was danach SCHIEFGEHT: avesmapsJsonResponse raeumt keine
	// Kopfzeilen weg, also traegt eine 500 wegen max_user_connections oder memory_limit denselben
	// gueltigen Tag. Wer diesen Fehlerkoerper unter dem Tag ablegt, bekommt beim naechsten Mal ein
	// 304 darauf -- „deine Kopie ist aktuell" fuer eine Fehlermeldung, und das heilt nicht von
	// selbst, weil map_revision sich ohne Bearbeitung nicht bewegt.
	avesmapsSendLocationsCacheHeaders($etag);
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

// Die Cache-Kopfzeilen der Antwort, an EINER Stelle -- 304 und 200 muessen denselben Tag nennen.
//
// ⚠️ Kein `Vary: Accept-Encoding`: diese Antwort geht durch avesmapsJsonResponse und wird von PHP
// nie selbst komprimiert (anders als map-features.php, das seinen eigenen gzip-Zweig hat). Was
// mod_deflate daraus macht, traegt Apache selbst ein.
//
// 💣 DER ETAG WIRD AUS DER 200 ENTFERNT, UEBERLEBT ABER DIE 304 -- und daraus wird ein Fangschluss.
// Gemessen am 25.08.2026 (Meldung #96), viermal, mit und ohne gzip:
//
//   200  ->  kein `ETag`, kein `Content-Length`, `Transfer-Encoding: chunked`,
//            `Vary: User-Agent,Accept-Encoding,X-Forwarded-For` (die hinteren zwei setzt der Code nicht)
//   304  ->  `ETag: W/"loc-1-89628"`, unveraendert durchgereicht
//
// Vor STRATOs PHP sitzt also etwas, das Antworten MIT Rumpf anfasst. Der Riegel selbst ist heil:
// `If-None-Match` kommt beim PHP an und die 304 wird korrekt beantwortet (gegengeprueft mit einem
// absichtlich falschen Tag -> 200 mit vollem Rumpf). Nur ERFAHREN konnte ein Client den Tag nie:
// die einzige Antwort, die ihn traegt, bekommt man erst, wenn man ihn schon hat.
//
// ⭐ DESHALB EIN ZWEITER KOPF UNTER EIGENEM NAMEN. `X-`-Koepfe ueberleben die 200 nachweislich --
// `X-Robots-Tag` und `X-Powered-By` standen in derselben Messung da. Ein Client liest den Wert aus
// `X-Avesmaps-ETag` und schickt ihn unveraendert als `If-None-Match` zurueck; damit funktioniert die
// bedingte Anfrage vollstaendig, ohne dass wir die Hosting-Schicht aendern muessen. Dasselbe Mittel
// wie `X-Avesmaps-SHA256` beim SVG-Export.
// ⚠️ Der echte `ETag` bleibt trotzdem stehen: verschwindet die Zwischenschicht je, ist er sofort
// wieder der richtige Weg, und ein Zwischenspeicher, der ihn sieht, soll ihn benutzen.
// 🔴 Beide Koepfe muessen in avesmapsApplyCorsPolicy freigegeben sein, sonst liest ein fremder
// Browser-Client keinen von beiden.
function avesmapsSendLocationsCacheHeaders(string $etag): void {
	header('ETag: ' . $etag);
	header('X-Avesmaps-ETag: ' . $etag);
	header('Cache-Control: no-cache, must-revalidate');
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
			// 💣 SIE FRAGTE „WURDE HIER UMBENANNT?", NICHT „IST DAS EINE KREUZUNG?" (Befund A13).
			// `strncmp($name, 'Kreuzung-')` las den BEREITS umbenannten Namen, war also nur so lange
			// richtig, wie das Benennungsschema genau so aussah. Mit `Kreuzung-<id>` haette sie
			// weiter zufaellig gestimmt, mit einer benannten Kreuzung („Kreuzung am Ochsenwasser")
			// aber still `false` gemeldet -- im STABILEN Vertrag, ohne dass irgendetwas bricht.
			// Jetzt fragt sie dasselbe Praedikat wie das Routennetz, und zwar den Subtyp zuerst.
			'is_crossing' => avesmapsRoutePropertiesAreCrossing([
				'feature_type' => (string) ($location['feature_type'] ?? ''),
				'feature_subtype' => (string) ($location['subtype'] ?? ''),
				'name' => $name,
			]),
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
