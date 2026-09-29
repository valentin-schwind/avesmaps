<?php

declare(strict_types=1);

// GET /api/app/political-territories-export.php
//   -> { ok:true, map_revision:int, territories_revision:string,
//        territories:[ … ], geometries:[ … ], claims:[ … ] }
//
// Die Herrschaftsgebiete als QUELLDATEN -- oeffentlich und nur lesend: der Baum (`territories`, Elter per
// `parent_public_id`), die Quellflaechen (`geometries`, GeoJSON Polygon/MultiPolygon in den Kartenkoordinaten
// der Legacy-Karte, [x, y]) und die umstrittenen Gebiete (`claims`). Gebaut fuer das Werkzeug
// `legacy:update` von Avesmaps3D (Auftrag 29.09.2026, WI-0062). Welche Felder, warum eine Positivliste
// davorsteht und wie die Wappen laufen: api/_internal/app/political-territories-export.php.
//
// 🔴 WARUM NICHT `api/app/political-territories.php`, WIE IM AUFTRAG: dieser Pfad gehoert dem Layer-Endpunkt
// (`action=layer`, Standard ohne Parameter) und bleibt unangetastet. `export` waere dort eine Aktion hinter
// der Positivliste `avesmapsPoliticalLeseStufe` -- und bliebe Editoren vorbehalten, solange niemand sie
// dort oeffentlich macht; dieser Endpunkt tut es bewusst NICHT.
//
// 🔴 Keine Sitzung, kein CSRF, kein Schreibweg, kein Revisionssprung, keine Ebene und kein Cache-Sprung.
// Wer hier eine Anmeldung oder ein Editorfeld nachruestet, bricht den Vertrag des Auftrags.
// ⚠️ Keine Drossel: map-features.php, das Vorbild fuer die Kopfzeilen, hat auch keine. Die Antwort ist gross
// (mehrere MB, alle Flaechen) -- ein Werkzeug holt sie auf Zuruf, nie in einer Schleife (CLAUDE.md, STRATO).

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/political-territories-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Herrschaftsgebiete laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Gebiets-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsPoliticalTerritoriesExportLesen($pdo);

    // 💣 DIE KOPFZEILEN GEHEN ERST MIT DER ANTWORT HINAUS, NIE VOR DER ARBEIT -- sonst truege eine 500 aus
    // dem Lesen denselben gueltigen Tag, und ein Aufrufer, der ablegt, bekaeme beim naechsten Mal „deine
    // Kopie ist aktuell" fuer eine Fehlerseite. Dieselbe Regel und dieselben vier Zeilen wie
    // api/app/ecosystem-regions.php; `X-Avesmaps-ETag` deshalb, weil STRATO den `ETag` aus Antworten mit
    // Rumpf entfernt (AGENTS.md §10, api/README.md).
    $rumpf = json_encode($antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $etag = avesmapsPoliticalTerritoriesExportETag($rumpf);
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
} catch (AvesmapsPoliticalTerritoriesExportInBewegung) {
    // Kein 500: es ist nichts kaputt, es wird nur gerade gespeichert. Ein erneuter Abruf hilft.
    header('Retry-After: 10');
    avesmapsErrorResponse(
        503,
        'data_changing',
        'Die Herrschaftsgebiete werden gerade bearbeitet; bitte in einigen Sekunden erneut abrufen.'
    );
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Herrschaftsgebiete konnten nicht geladen werden.');
}
