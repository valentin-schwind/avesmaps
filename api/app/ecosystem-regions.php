<?php

declare(strict_types=1);

// GET /api/app/ecosystem-regions.php[?kind=<derographisch|vegetation|topographie|klima>]
//   -> { ok:true, map_revision:int, ecosystem_revision:int, regions:[ … ], region_types:[ … ] }
//
// Die Regionsliste der Landschaften -- oeffentlich und nur lesend. Dieselbe Antwort wie die Editor-Aktion
// `list_regions` (api/edit/map/ecosystem.php), dieselben Felder je Region, dazu oben die zwei Staende.
// Gebaut fuer das Werkzeug `legacy:update` von Avesmaps3D (Auftrag 28.09.2026, Owner: „ja klar").
// Warum sie dieselbe Funktion ruft, warum trotzdem eine Positivliste davorsteht und warum die Staende in
// einer Schleife gelesen werden: api/_internal/app/ecosystem-regions-export.php.
//
// 🔴 Keine Sitzung, kein CSRF, kein Schreibweg, kein Revisionssprung -- der Owner hat „oeffentlich"
// entschieden. Wer hier eine Anmeldung oder ein Editorfeld nachruestet, bricht diesen Vertrag.
// ⚠️ Keine Drossel: map-features.php, das Vorbild fuer die Kopfzeilen, hat auch keine.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/ecosystem-regions-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Landschaftsregionen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer die Landschaftsregionen erlaubt.');
    }

    // ⚠️ `?kind[]=…` ist ein Fehler, kein „ohne Filter": still ignoriert kaeme ALLES zurueck, und der
    // Aufrufer hielte es fuer die eine Ebene, nach der er gefragt hat.
    $kind = $_GET['kind'] ?? '';
    if (!is_string($kind)) {
        throw new InvalidArgumentException('kind muss ein einzelner Wert sein.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsEcosystemRegionsExportLesen($pdo, trim($kind));

    // 💣 DIE KOPFZEILEN GEHEN ERST MIT DER ANTWORT HINAUS, NIE VOR DER ARBEIT -- sonst truege eine 500
    // aus dem Lesen denselben gueltigen Tag, und ein Aufrufer, der ablegt, bekaeme beim naechsten Mal
    // „deine Kopie ist aktuell" fuer eine Fehlerseite. Dieselbe Regel und dieselben vier Zeilen wie
    // avesmapsMapFeaturesSendCacheHeaders (api/app/map-features.php); `X-Avesmaps-ETag` deshalb, weil
    // STRATO den `ETag` aus Antworten mit Rumpf entfernt (AGENTS.md §10, api/README.md).
    $rumpf = json_encode($antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $etag = avesmapsEcosystemRegionsExportETag($rumpf);
    header('ETag: ' . $etag);
    header('X-Avesmaps-ETag: ' . $etag);
    header('Cache-Control: no-cache, must-revalidate');
    header('Vary: Accept-Encoding', false);

    $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
        http_response_code(304);
        exit;
    }

    avesmapsJsonResponse(200, $antwort);
} catch (AvesmapsEcosystemRegionsExportInBewegung) {
    // Kein 500: es ist nichts kaputt, es wird nur gerade gespeichert. Ein erneuter Abruf hilft.
    header('Retry-After: 10');
    avesmapsErrorResponse(
        503,
        'data_changing',
        'Die Landschaften werden gerade bearbeitet; bitte in einigen Sekunden erneut abrufen.'
    );
} catch (InvalidArgumentException $exception) {
    // Eigene Meldungen: sie stammen aus unserer Pruefung und nennen das Feld (avesmapsEcosystemReadKind).
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Landschaftsregionen konnten nicht geladen werden.');
}
