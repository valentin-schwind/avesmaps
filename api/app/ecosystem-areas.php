<?php

declare(strict_types=1);

// Public read path for the Landschaften layer (plan V2.2). GET returns the active areas, optionally
// clipped to a bbox, each carrying its region's kind/name/type through an INNER JOIN.
//
// GET /api/app/ecosystem-areas.php[?bbox=min_x,min_y,max_x,max_y][&labels=<label_public_id>,…]
//   [&regions=<region_public_id>,…][&kind=<derographisch|vegetation|topographie|klima>]
//   -> { ok:true, ecosystem_enabled:bool, revision:int, truncated:bool, areas:[ { public_id, region_*,
//        kind, geometry, bounds, geometry_revision, is_trial, updated_at } ] }
//
// Task 7 (2026-08-14): `regions` and `kind` joined `bbox`/`labels`. `regions` exists because a Fläche
// belongs to a REGION, not a label, and a region carries MANY labels -- the Spotlight occurrence
// highlight resolved a search hit to ONE label and fell back to a point marker whenever that label
// happened not to be the one carrying the area (measured: 26 of 51 resolved Einbeere places). `kind`
// exists so spotlightLoreIntersectGeometry can ask for the eight climate bands alone instead of the
// full ~2.6 MB payload it would otherwise need just to reach them.
//
// 🔴 Fix-Runde 1 (2026-08-14, CRITICAL): `?regions=` names every area a Lebensraum-Regel matched, and a
// rule names up to 56 live -- the first cut of this filter borrowed the label filter's limit of 25 and
// silently dropped the rest (`ok: true`, no sign, 26 of 56 forests missing on the map). The limit is now
// 200 (avesmapsEcosystemParseRegionFilter, api/_internal/app/ecosystem.php) AND the cut is no longer
// silent: `truncated` is true whenever more ids came in than the limit allows.
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
// 6 (2026-08-03): die vierte Ebene `klima`. Die FORM aendert sich nicht -- ein Klimaband ist eine
// Flaeche wie jede andere --, aber ein warmer Client bekaeme ueber 304 einen Bestand ohne die neuen
// Baender und zeigte einen leeren Reiter „Klimazonen", waehrend der Server sie laengst hat. Das ist
// derselbe Fall, den Version 4 schon einmal teuer gelernt hat: eine WERTaenderung braucht den Hub
// genauso wie eine Formaenderung, weil der ETag aus Revision und dieser Zahl gesaet wird.
// 7 (2026-08-14, Fix-Runde 1): `truncated` joins the envelope. Same reasoning as version 3
// (cascade_enabled): a warm client that never sees this NEW field cannot tell a complete answer from a
// silently capped one -- exactly the CRITICAL finding this version fixes. Without the bump, a client
// whose cached ETag still matches would keep reading `ok: true` with a quarter of the data and no way
// to know.
// V12 (2026-09-04): fuenf neue Schluessel je Zeile (terrain_bergform/rauschen/sattel/talbreite/
// einschnitt). ⚠️ Heute folgenlos -- die Spalten sind NULL, und die erste echte Wertaenderung bumpt
// ohnehin `ecosystem_revision`. Scharf wird der Bump, sobald jemand eine Vorgabe aendert: dann
// traegt ein zwischengespeicherter Client Zeilen OHNE die fuenf Schluessel und rechnet still mit
// den Modulvorgaben weiter.
// 9 (2026-09-04): `terrain_erosion` je Zeile -- die Erosionsstufe, die bis dahin in
// `terrain_levels` mitwohnte (Owner: „terrain_levels trenn die beiden!"). Ein Bump ist noetig, weil
// die FORM der Zeile sich aendert: ein warmer Client wuerde sonst sein 304 bekommen und die neue
// Spalte nie sehen -- seine Erosion staende auf `undefined` und faellt auf die Modulvorgabe.
const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 12;

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
    // outlines of the two or three areas a Vorkommen names, and nothing else. All four filters may be
    // combined; all are optional, and none alone is the normal case for the layer itself.
    $labelPublicIds = avesmapsEcosystemParseLabelFilter((string) ($_GET['labels'] ?? ''));
    // Task 7: ask by REGION instead of by label -- a Fläche belongs to exactly one region, but a region
    // carries many labels, so a label-only ask can miss areas under a sibling label of the same region.
    //
    // Fix-Runde 1: avesmapsEcosystemParseRegionFilter now returns {ids, truncated} rather than a plain
    // list, or null for "no filter at all" -- unwrap both, because a null filter is not truncated by
    // definition (there is nothing to cut).
    $regionFilter = avesmapsEcosystemParseRegionFilter((string) ($_GET['regions'] ?? ''));
    $regionPublicIds = $regionFilter['ids'] ?? null;
    $regionsTruncated = $regionFilter['truncated'] ?? false;
    // Task 7: ask for one whole LAYER (e.g. the eight climate bands) without the rest of the payload.
    $kind = avesmapsEcosystemParseKindFilter((string) ($_GET['kind'] ?? ''));

    avesmapsJsonResponse(200, [
        'ok' => true,
        'ecosystem_enabled' => true,
        // Löscht das Entfernen der letzten Fläche bzw. des letzten Labels die ganze Region mit? Der
        // Editor MUSS das wissen, sonst kündigen seine Rückfragen etwas an, das nicht passiert -- und
        // eine Rückfrage, die übertreibt, wird genauso schnell weggeklickt wie eine, die untertreibt.
        'cascade_enabled' => AVESMAPS_ECOSYSTEM_CASCADE_ENABLED,
        'revision' => $revision,
        // 🔴 Fix-Runde 1 (CRITICAL): true whenever ?regions= named more ids than
        // AVESMAPS_ECOSYSTEM_REGION_FILTER_LIMIT allows. `ok: true` with a quarter of the areas and no
        // sign of it is a false statement -- this is that sign. Only `regions` can trigger it today
        // (`kind` is a single value; `labels` keeps its own pre-existing, deliberately untouched limit,
        // see the constant's comment).
        'truncated' => $regionsTruncated,
        'areas' => avesmapsEcosystemReadAreas($pdo, $bbox, $labelPublicIds, $regionPublicIds, $kind),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(
        500,
        'server_error',
        'Ecosystem areas could not be loaded from the database.' . avesmapsEcosystemAdminFehlertext($exception)
    );
} catch (Throwable $exception) {
    avesmapsErrorResponse(
        500,
        'server_error',
        'Ecosystem areas could not be loaded.' . avesmapsEcosystemAdminFehlertext($exception)
    );
}

// Der Fehlertext -- NUR fuer eine angemeldete Admin-Sitzung, sonst der leere String.
//
// 💣 Am 18.08.2026 fiel die ganze Landschaften-Ebene mit HTTP 500 aus, und die Meldung „could not be
// loaded from the database" sagte nicht, WAS die Datenbank verweigert hat. Der Fehler steckt irgendwo
// in den ~700 Zeilen selbstheilender DDL, die avesmapsEcosystemEnsureTables bei JEDEM Aufruf faehrt --
// per Fernprobe liess sich nur eingrenzen, DASS es dort passiert (ein absichtlich kaputtes bbox kam mit
// 500 statt 400 zurueck, also vor dem Parsen), nicht welche Anweisung. Ohne diesen Text bleibt nur
// Raten, und Raten an einem Ausfall ist die teuerste Art zu suchen.
//
// ⚠️ Er darf NICHT oeffentlich werden: AGENTS.md §10 fuehrt die Endpunkte, die getMessage()
// durchreichen, als offene Schwachstelle (Meilenstein M1). Hier kommt keine neue dazu -- fuer jeden
// ohne Admin-Recht ist die Antwort wortgleich die von vorher.
//
// ⚠️ Die Sitzung wird ERST IM FEHLERFALL angefasst, nie im Normalbetrieb: PHP haelt die Sitzungsdatei
// gesperrt, und das hier ist ein oeffentlicher Lesepfad, den jeder Besucher trifft.
// (avesmapsCurrentUser gibt den Lock sofort wieder frei -- siehe den Kommentar dort.)
function avesmapsEcosystemAdminFehlertext(Throwable $exception): string
{
    try {
        require_once __DIR__ . '/../_internal/auth.php';
        $user = avesmapsCurrentUser();
        if ($user === null || !avesmapsUserCan($user, 'admin')) {
            return '';
        }
    } catch (Throwable) {
        return ''; // Eine Diagnose darf den Fehler, den sie erklaeren soll, niemals verdecken.
    }

    return ' [admin] ' . $exception->getMessage();
}

// Weak ETag from the revision plus every query parameter that shapes the payload -- today bbox, labels,
// regions AND kind. Weak (W/) because a gzipped and an identity response are semantically the same
// resource. Copied in shape from avesmapsMapFeaturesETag (api/app/map-features.php:225-228).
//
// 💣 EVERY shaping parameter belongs in the seed, and `labels`/`regions`/`kind` are three of them. The
// comment at the top of this file already spells out why for bbox: an ETag that ignores a filter hands a
// client the wrong subset out of its own cache. With `labels` the failure is louder, not quieter -- the
// layer's own unfiltered request and a three-area highlight would share one ETag, so whichever ran first
// would answer both.
//
// The seed itself lives in avesmapsEcosystemAreasETagSeed (api/_internal/app/ecosystem.php), not here --
// this file's request handler runs on include, so a local test cannot require it without a live DB (see
// the comment on avesmapsEcosystemETagMatches below). Task 7 added `regions`/`kind` to that seed; no
// AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION bump was needed for it -- the SHAPE of an area row did not change,
// and because the seed's own FORMULA changed (two more segments), every previously cached ETag stops
// matching the moment this deploys, forcing a fresh 200 for every client regardless of which filters it
// happens to send.
function avesmapsEcosystemAreasETag(int $revision, array $queryParams): string
{
    $seed = avesmapsEcosystemAreasETagSeed($queryParams);

    return 'W/"eco-' . AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1', $seed), 0, 10) . '"';
}

// ⚠️ Nur noch ein Weiterreichen -- der Name bleibt, damit kein Aufrufer angefasst werden muss.
// Der Grund fuer die eigene Fassung ("reimplemented rather than required, because that one lives
// inside an endpoint file whose request handler would run on include") gilt seit 9f2962e8 nicht mehr:
// avesmapsETagMatches steht in api/_internal/bootstrap.php, das diese Datei ohnehin laedt. Die
// Fundstelle, auf die der alte Kommentar zeigte, gibt es nicht mehr -- und drei Kopien einer
// Vergleichsregel driften genauso sicher wie zwei.
function avesmapsEcosystemETagMatches(string $ifNoneMatch, string $etag): bool
{
    return avesmapsETagMatches($ifNoneMatch, $etag);
}
