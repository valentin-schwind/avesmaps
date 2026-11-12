<?php
/**
 * Lässt Legacys EIGENEN Routing-Code gegen die SQLite-Datenbank aus build-db.mjs rechnen (WI-0017).
 *
 * Aufruf (über run.mjs): php -d extension=pdo_sqlite harness.php <legacy-api-verzeichnis> <oracle.sqlite> <anfragen.json>
 *
 * Eingebunden wird genau, was `api/route/index.php` einbindet, und gerechnet wird mit denselben drei
 * Aufrufen wie dort: Anfrage normalisieren, Route bauen, Antwort bauen. Das Legacy-Verzeichnis ist
 * eine Arbeitskopie aus dem Discovery-Mirror (nie der Checkout des Betreibers). Darin ist genau EINE
 * Zeile geändert: `avesmapsLoadRouteMapData($config)` bekommt die SQLite-Verbindung, weil
 * `avesmapsCreatePdo` nur MySQL und PostgreSQL kennt. Alles danach reicht diese Verbindung selbst
 * weiter (`$routeMapData['pdo']`).
 *
 * Ausgabe: eine JSON-Zeile je Anfrage, mit `ms` (Rechenzeit) und entweder `route` oder `error`.
 */

declare(strict_types=1);

[$script, $legacyApi, $databaseFile, $requestsFile] = $argv + [null, null, null, null];
if ($legacyApi === null || $databaseFile === null || $requestsFile === null) {
    fwrite(STDERR, "Aufruf: harness.php <legacy-api-verzeichnis> <oracle.sqlite> <anfragen.json>\n");
    exit(2);
}

require $legacyApi . '/_internal/bootstrap.php';
require $legacyApi . '/_internal/routing/request.php';
require $legacyApi . '/_internal/routing/map-data.php';
require $legacyApi . '/_internal/routing/network-data.php';
require $legacyApi . '/_internal/routing/graph.php';
require $legacyApi . '/_internal/routing/response.php';

$GLOBALS['avesmapsOraclePdo'] = new PDO('sqlite:' . $databaseFile, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$config = ['database' => []];

$requests = json_decode((string) file_get_contents($requestsFile), true, 512, JSON_THROW_ON_ERROR);
foreach ($requests as $index => $payload) {
    $started = hrtime(true);
    try {
        $request = avesmapsNormalizeRouteRequest($payload);
        $result = avesmapsBuildMinimalRouteResultFromRequest($request, $config);
        $route = avesmapsBuildMinimalRouteResponse($result['route'], $request);
        $line = ['index' => $index, 'ms' => (hrtime(true) - $started) / 1e6, 'route' => $route];
    } catch (Throwable $error) {
        $line = [
            'index' => $index,
            'ms' => (hrtime(true) - $started) / 1e6,
            'error' => [
                'type' => get_class($error),
                'message' => $error->getMessage(),
                // Die Absage eines Kartenpunkts trägt Legacys Code (`point_not_on_land` …) in einem Feld.
                'code' => property_exists($error, 'errorCode') ? $error->errorCode : null,
            ],
        ];
    }
    echo json_encode($line, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), "\n";
}
