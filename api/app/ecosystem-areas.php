<?php

declare(strict_types=1);

// Public read path for the Landschaften layer (plan V2.2). GET returns the active areas, optionally
// clipped to a bbox, each carrying its region's kind/name/type through an INNER JOIN.
//
// GET /api/app/ecosystem-areas.php[?bbox=min_x,min_y,max_x,max_y][&labels=<label_public_id>,…]
//   -> { ok:true, ecosystem_enabled:bool, revision:int, areas:[ { public_id, region_*, kind, geometry,
//        bounds, geometry_revision, is_trial, updated_at } ] }
//
// Two templates, one half each (the plan names both, and for a reason):
//   * api/app/citymaps.php  -- shape, kill switch, response envelope. It has NO ETag at all.
//   * api/app/map-features.php:225-228 -- the ETag, and the only one in the house. It seeds from
//     revision AND the payload-shaping query params, which is why the seed below is
//     ecosystem_revision x bbox and not the revision alone: a bbox-filtered endpoint whose ETag ignores
//     the bbox would hand a client the wrong viewport out of its own cache.
//
// 🔴 The revision is `ecosystem_revision`, never `map_revision`. See api/_internal/app/ecosystem.php.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/ecosystem.php';

// Bump when the SHAPE of this payload changes without a revision change -- same contract, and same
// reason, as AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION: the ETag is revision-based, so a cached client would
// otherwise keep a stale body through 304 and never see a new field.
// 2 (2026-07-28): every area row now also carries region_type_label, region_area_count and
// region_label_count for the tooltip. Same revision, new shape -> without this bump a warm client would
// keep the old body through a 304 and its tooltip would silently show "Flächen (0) und Labels (0)".
// 3 (2026-07-28): `cascade_enabled` joins the envelope. It is what the delete confirmations word
// themselves from, so the bump matters most on the day the switch is flipped: without it a warm client
// keeps the old body, reads no flag, and goes on promising that nothing else gets deleted -- while the
// server has just started deleting it.
// 4 (2026-07-28): `cascade_enabled` flipped from false to true. A VALUE change, not a shape change --
// and it needs the bump for exactly the reason version 3 predicted and this session then forgot: the
// ETag is seeded from the revision and this version, so an unchanged revision hands warm clients the
// OLD body. Measured right after the deploy: the plain request answered `false` while a cache-busted
// one answered `true`. A client holding that stale `false` shows the reassuring confirmation ("die
// Region bleibt bestehen") while the server has already started deleting it.
// 5 (2026-07-29): every area row carries `affects_paths`. Same revision, new shape -- and without
// the bump a warm client keeps the old body through a 304, reads no flag, and computes the way
// assignment for the sea and the continent as well. Measured: that is 90 % of the whole run, for
// rows whose only statement is "this route runs through Aventurien".
const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 5;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load ecosystem areas.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for ecosystem areas.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 💣 HIER STAND DER TOTMANNSCHALTER (app_setting['ecosystem_enabled']), abgeschafft am 2026-08-01.
    // Er kostete auf JEDEM Aufruf eine Runde DDL -- avesmapsAppSettingGet legt zuerst die app_setting-
    // Tabelle an -- und der alte Kommentar hier sagte selbst, das sei nur tolerierbar, solange der
    // Endpunkt aus dem Edit-Modus komme und nicht von der oeffentlichen Karte. Mit dem Schalter faellt
    // diese Ausnahme weg, statt sie einloesen zu muessen.
    //
    // 🔴 Was hier NICHT verriegelt wird und nie verriegelt war: die Flaechen selbst sind oeffentlich.
    // Verriegelt ist, ob die Karte die Ebene ANBIETET, und das entscheidet seit 2026-08-01 die Sitzung
    // (js/app/session.js: Admin) statt des ungeprueften `?landschaften=1`.
    //
    // ⚠️ `ecosystem_enabled` bleibt im Umschlag und ist ab jetzt konstant true -- gleiche Payload-Form,
    // also keine Version zu heben und kein warmer Client, der ueber ein fehlendes Feld stolpert.

    // Self-healing DDL, the project idiom.
    avesmapsEcosystemEnsureTables($pdo);

    $revision = avesmapsReadEcosystemRevision($pdo);

    $etag = avesmapsEcosystemAreasETag($revision, $_GET);
    header('ETag: ' . $etag);
    header('Cache-Control: no-cache, must-revalidate');
    $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($ifNoneMatch !== '' && avesmapsEcosystemETagMatches($ifNoneMatch, $etag)) {
        http_response_code(304);
        exit;
    }

    $bbox = avesmapsEcosystemParseBoundingBox((string) ($_GET['bbox'] ?? ''));
    // Ask for named landscapes instead of a viewport: the Spotlight occurrence highlight wants the
    // outlines of the two or three areas a Vorkommen names, and nothing else. Both filters may be
    // combined; both are optional, and neither one alone is the normal case for the layer itself.
    $labelPublicIds = avesmapsEcosystemParseLabelFilter((string) ($_GET['labels'] ?? ''));

    avesmapsJsonResponse(200, [
        'ok' => true,
        'ecosystem_enabled' => true,
        // Löscht das Entfernen der letzten Fläche bzw. des letzten Labels die ganze Region mit? Der
        // Editor MUSS das wissen, sonst kündigen seine Rückfragen etwas an, das nicht passiert -- und
        // eine Rückfrage, die übertreibt, wird genauso schnell weggeklickt wie eine, die untertreibt.
        'cascade_enabled' => AVESMAPS_ECOSYSTEM_CASCADE_ENABLED,
        'revision' => $revision,
        'areas' => avesmapsEcosystemReadAreas($pdo, $bbox, $labelPublicIds),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Ecosystem areas could not be loaded from the database.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Ecosystem areas could not be loaded.');
}

// Weak ETag from the revision plus every query parameter that shapes the payload -- today bbox AND
// labels. Weak (W/) because a gzipped and an identity response are semantically the same resource.
// Copied in shape from avesmapsMapFeaturesETag (api/app/map-features.php:225-228).
//
// 💣 EVERY shaping parameter belongs in the seed, and `labels` is one. The comment at the top of this
// file already spells out why for bbox: an ETag that ignores a filter hands a client the wrong subset
// out of its own cache. With `labels` the failure is louder, not quieter -- the layer's own unfiltered
// request and a three-area highlight would share one ETag, so whichever ran first would answer both.
function avesmapsEcosystemAreasETag(int $revision, array $queryParams): string
{
    $seed = (string) ($queryParams['bbox'] ?? '') . '|' . (string) ($queryParams['labels'] ?? '');

    return 'W/"eco-' . AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1', $seed), 0, 10) . '"';
}

// If-None-Match may be a list, "*", or W/-prefixed. Mirror of avesmapsETagMatches
// (api/app/map-features.php:231) -- reimplemented rather than required, because that one lives inside an
// endpoint file whose request handler would run on include.
function avesmapsEcosystemETagMatches(string $ifNoneMatch, string $etag): bool
{
    if (trim($ifNoneMatch) === '*') {
        return true;
    }

    $normalize = static fn(string $value): string => trim(preg_replace('/^W\//i', '', trim($value)) ?? trim($value));
    $target = $normalize($etag);
    foreach (explode(',', $ifNoneMatch) as $candidate) {
        if ($normalize($candidate) === $target) {
            return true;
        }
    }

    return false;
}
