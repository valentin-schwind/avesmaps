<?php

declare(strict_types=1);

// GET /api/app/ecosystem-display.php -- die Uebersteuerung der Landschafts-Darstellung fuer den
// Browser. Entwurf: docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md §8
// Vorbild in Form und Reihenfolge: api/app/zoom-bands.php
//
// 🔴 FAELLT OFFEN AUS. Jeder Fehler ergibt `display: null`, nie ein 500: der Browser hat seine
// Vorgabewerte (js/map-features/ecosystem-display.js) und zeichnet ohne diesen Endpunkt wie
// bisher. Ein Ausfall hier darf die Karte nicht aufhalten.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/ecosystem-display.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    avesmapsApplyCorsPolicy($config);

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. `avesmapsCreatePdo(array $databaseConfig)`
    // nimmt ein Array, und `$config` IST eins -- PHP beschwert sich also nicht, drinnen ist dann
    // alles leer, und der catch macht daraus eine leere Antwort. Genau so hat das
    // Tempowerte-Fenster vom Tag seiner Veroeffentlichung an nie geladen. Bewacht von
    // api/_internal/__tests__/create-pdo-argument-test.php.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $state = avesmapsEcosystemDisplayRead($pdo);
} catch (Throwable) {
    $state = ['display' => null, 'stamp' => ''];
}

// Schwacher ETag auf dem Stempel: unveraendert -> 304, und der Browser nutzt seine Kopie.
$etag = 'W/"eco-disp-' . ($state['stamp'] !== '' ? $state['stamp'] : '0') . '"';
header('ETag: ' . $etag);
header('Cache-Control: no-cache, must-revalidate');
$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
    http_response_code(304);
    exit;
}

avesmapsJsonResponse(200, [
    'ok' => true,
    'display' => $state['display'],
    'stamp' => $state['stamp'],
]);
