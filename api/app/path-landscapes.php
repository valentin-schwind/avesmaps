<?php

declare(strict_types=1);

// V10: which landscapes do these ways run through? Public read behind the „Führt durch" line in the
// route planner, the leg infobox and the way infobox.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// POST /api/app/path-landscapes.php   { "paths": ["<public_id>", …] }
//   -> { ok:true, payload_version:1,
//        stamp:{ computed_at, ecosystem_revision, map_revision, stale:bool } | null,
//        landscapes:{ "<region_public_id>": { name, art, kind, wiki_key, wiki_url } },
//        paths:{ "<path_public_id>": { length: 12.3456, in: [ ["<region_public_id>", 4.21], … ] } } }
//
// 🔴 POST on a READ. Deliberate, and there is a precedent in the same house: POST /api/route/. A
// route of 45 legs is 1.6 KB of ids, and long ones would burst the address line. The price is no
// ETag -- paid knowingly, because the client keeps the answer per WAY and a second route over the
// same road fetches nothing.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/ecosystem.php';
require_once __DIR__ . '/../_internal/app/path-landscapes.php';

// Bump when the SHAPE of this payload changes. There is no ETag here (POST), so this is not the
// cache guard it is in map-features.php -- it is how a warm client can tell it is reading a body it
// was not written for.
const AVESMAPS_PATH_LANDSCAPES_PAYLOAD_VERSION = 1;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load path landscapes.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only POST is allowed for path landscapes.');
    }

    try {
        $publicIds = avesmapsPathLandscapesNormalizeRequest(avesmapsReadJsonRequest());
    } catch (InvalidArgumentException $exception) {
        // This message is our own text about the request's own shape -- no exception text from
        // deeper down ever reaches a client here (see the catch at the bottom).
        avesmapsErrorResponse(400, 'paths_invalid', $exception->getMessage());
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 💣 HIER STAND DER TOTMANNSCHALTER, und er ist am 2026-08-01 abgeschafft (Owner-Auftrag).
    // Dieser Endpunkt traegt V10 „Fuehrt durch" im Reiseplaner JEDES Besuchers: stand
    // app_setting['ecosystem_enabled'] auf '0', antwortete er leer und die Zeile verschwand
    // stillschweigend fuer alle. Ein Schalter, dessen Aus-Zustand eine oeffentliche Funktion
    // abschaltet, ohne dass irgendwo etwas davon steht, ist kein Sicherheitsnetz.
    //
    // ⭐ Nebeneffekt, der hier zaehlt: der Lesepfad kommt damit ganz ohne die app_setting-Abfrage aus.
    // Er lief ohnehin schon DDL-frei (avesmapsAppSettingGetWithoutDdl), jetzt ist auch die Abfrage weg.
    //
    // ⚠️ `ecosystem_enabled` BLEIBT im Umschlag und ist ab jetzt konstant true. Die Payload-Form
    // aendert sich dadurch nicht -- ein warmer Client liest weiter, was er erwartet.

    // The stamp says WHEN the stored answer was computed and against which revisions. A visitor
    // never sees it; it exists so „why does it still say the old thing?" has an answer that does
    // not need guessing. A missing stamp is a valid state: nothing computed yet -> no line.
    $stamp = avesmapsPathLandscapesStamp($pdo);

    $result = $stamp === null
        ? ['landscapes' => [], 'paths' => []]
        : avesmapsPathLandscapesRead($pdo, $publicIds);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'payload_version' => AVESMAPS_PATH_LANDSCAPES_PAYLOAD_VERSION,
        'ecosystem_enabled' => true,
        'stamp' => $stamp,
        // (object) so an empty result is `{}` in JSON, never `[]` -- the client indexes both by key.
        'landscapes' => $result['landscapes'] === [] ? (object) [] : $result['landscapes'],
        'paths' => $result['paths'] === [] ? (object) [] : $result['paths'],
    ]);
} catch (Throwable $exception) {
    // No getMessage() to the client: several edit endpoints leak exception text and that is
    // milestone M1's open bug. A public read does not add to it.
    error_log('path-landscapes failed: ' . $exception->getMessage());
    avesmapsErrorResponse(500, 'path_landscapes_failed', 'Path landscapes could not be read.');
}
