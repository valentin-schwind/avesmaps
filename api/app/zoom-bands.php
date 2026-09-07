<?php

declare(strict_types=1);

// GET /api/app/zoom-bands.php -- die Übersteuerung der Zoombänder für den Browser.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §5.2
//
// 🔴 FÄLLT OFFEN AUS. Jeder Fehler ergibt `bands: null`, nie ein 500: der Browser hat seine
// Vorgabewerte und zeichnet ohne diesen Endpunkt wie bisher. Ein Ausfall hier darf die Karte
// nicht aufhalten.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/zoom-bands.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    avesmapsApplyCorsPolicy($config);

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. `avesmapsCreatePdo(array $databaseConfig)`
    // nimmt ein Array, und `$config` IST eins -- PHP beschwert sich also nicht, drinnen ist dann
    // alles leer, und der catch macht daraus eine leere Antwort. Genau so hat das Tempowerte-Fenster
    // vom Tag seiner Veröffentlichung an nie geladen. Bewacht von
    // api/_internal/__tests__/create-pdo-argument-test.php.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $state = avesmapsZoomBandsRead($pdo);
} catch (Throwable) {
    $state = ['bands' => null, 'stamp' => ''];
}

// Schwacher ETag auf dem Stempel: unverändert -> 304, und der Browser nutzt seine Kopie.
//
// 🪤 DIESER WEG IST FUER EINEN GEWOEHNLICHEN BROWSER NICHT ERREICHBAR -- gemessen am 07.09.2026.
// Vor STRATOs PHP sitzt etwas, das den `ETag` aus einer Antwort MIT Rumpf entfernt (AGENTS.md §10,
// dort an `/api/locations/` nachgewiesen); die Live-Antwort dieses Endpunkts trägt nur
// `Cache-Control`. Wer den Tag nie erfährt, kann ihn auch nicht zurückschicken, und der
// 304-Zweig unten bleibt für ihn tot. `map-features` löst das mit einem zweiten Kopf
// (`X-Avesmaps-ETag`) PLUS einer eigenen Client-Ablage -- ein 304 nützt nur, wer die alte
// Nutzlast noch hat.
//
// ⚠️ HIER WURDE DAS BEWUSST NICHT NACHGEBAUT (07.09.2026, nachgerechnet statt geschätzt): die
// Antwort ist 741 Bytes und wird rund 450-mal am Tag geholt -- die Ersparnis wäre ein Drittel
// Megabyte pro Tag, und dafür bräuchte es Server- UND Client-Umbau samt Invalidierung nach jedem
// Speichern im Zoomband-Fenster. Ein `max-age` statt dessen wäre billiger und genau die Falle,
// vor der das Haus mehrfach warnt: der Admin, der die Bänder einstellt, sähe seine eigene
// Änderung nicht.
//
// 🔧 Offen und nicht geklärt: es kommen trotzdem rund 40 echte 304 am Tag zustande. Woher diese
// Clients ihren Tag haben, ist unbekannt -- vermutlich eine Zwischenschicht, nicht der Browser.
$etag = 'W/"zb-' . ($state['stamp'] !== '' ? $state['stamp'] : '0') . '"';
header('ETag: ' . $etag);
header('Cache-Control: no-cache, must-revalidate');
$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
    http_response_code(304);
    exit;
}

avesmapsJsonResponse(200, [
    'ok' => true,
    'bands' => $state['bands'],
    'stamp' => $state['stamp'],
]);
