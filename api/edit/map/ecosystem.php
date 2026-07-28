<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

// Editor writes for the Landschaften layer (plan V2.3) -- tables ecosystem_region / ecosystem_area /
// ecosystem_region_type / ecosystem_revision / ecosystem_geometry_audit_log. Shaped after
// api/edit/map/citymaps.php: POST only, one capability check, a match($action) dispatcher, and no DDL
// preamble -- the write handlers in the app-layer library ensure the tables, the dispatcher stays thin.
//
// Deliberately NOT inherited from the political endpoint (plan V2.3): no PATCH-for-everything, no DDL on
// every single call, and no getMessage() of an arbitrary Throwable leaking to the client.
//
// avesmapsUuidV4() lives in the map-features library and is not pulled in by the ecosystem library, so
// load it here -- same arrangement, and same reason, as api/edit/map/citymaps.php:12.
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/ecosystem.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not edit ecosystem areas.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only POST is allowed for this endpoint.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $userId = (int) ($user['id'] ?? 0);

    $result = match ($action) {
        // The region picker's list (V3.0b): active regions of one kind plus the region-type vocabulary
        // for that kind. It sits HERE, behind the capability check, and not on the public read path --
        // "which region does my next area go into" is an editor question and does not widen the public
        // surface. Optional filter: kind.
        'list_regions' => avesmapsListEcosystemRegions($pdo, $payload),
        // V6: the WikiSync -> Regionen list's second source -- which landscape regions, and how many
        // areas, hang on each wiki_region_key. Same capability gate, same reasoning as list_regions.
        'regions_by_wiki_key' => avesmapsListEcosystemRegionsByWikiKey($pdo, $payload),
        // V6: one wiki region -> 1..n landscape regions. Dry run by default; the sharp run needs
        // dry_run=false AND confirm='apply'. Writes ONLY wiki_url (the key is derived from it) and never
        // merges, moves or deletes anything -- several regions sharing one key IS the feature.
        'assign_wiki_region' => avesmapsAssignEcosystemWikiRegion($pdo, $payload, $userId),
        // A region carries the name, the kind and the wiki bridge; it may hold MANY areas (owner
        // decision 1). Returns the new public_id so the client can hang the following create_area on it.
        // wiki_region_key is DERIVED from wiki_url server-side and never read from the payload.
        'create_region' => avesmapsCreateEcosystemRegion($pdo, $payload, $userId),
        // Partial: only the fields actually present in the payload are written, so an update never wipes
        // what the client did not send.
        'update_region' => avesmapsUpdateEcosystemRegion($pdo, $payload, $userId),
        // Soft, and it takes its areas along inside one transaction.
        'delete_region' => avesmapsDeleteEcosystemRegion($pdo, $payload, $userId),
        // Needs region_public_id (region_id accepted as an alias); geometry_geojson takes a GeoJSON
        // Polygon OR MultiPolygon, validated by shape and bounded to the 0..1024 map, with the bbox
        // computed over ALL parts.
        'create_area' => avesmapsCreateEcosystemArea($pdo, $payload, $userId),
        // expected_revision is REQUIRED here and on delete_area -- see avesmapsEcosystemReadExpectedRevision.
        'update_area_geometry' => avesmapsUpdateEcosystemAreaGeometry($pdo, $payload, $userId),
        // V8: die drei Geländeregler einer Fläche (Körnung, Detailstufen, Durchschnittshöhe). Bewusst
        // NEBEN update_area_geometry und nicht darin: ein Regler bewegt keine Ecke, und die
        // geometry_revision bleibt deshalb stehen -- sonst liefe jeder Reglerzug in den optimistischen
        // Konflikt der nächsten Geometrie-Speicherung. Ein weggelassener Wert bleibt unangetastet, ein
        // leerer setzt auf NULL zurück = „ableiten wie bisher".
        'update_area_terrain' => avesmapsUpdateEcosystemAreaTerrain($pdo, $payload, $userId),
        'delete_area' => avesmapsDeleteEcosystemArea($pdo, $payload, $userId),
        // Not optional extra: without it app_setting['ecosystem_enabled'] stays '0' forever, the public
        // read path stays permanently empty, and V3 cannot be accepted at all. Pattern:
        // set_citymaps_enabled in api/_internal/app/citymaps.php.
        'set_enabled' => avesmapsSetEcosystemEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
        // End of the trial, on the AREAS: mode=keep clears the mark, mode=discard soft-deletes them.
        // Either way app_setting['ecosystem_trial'] goes off.
        'promote_trial' => avesmapsPromoteEcosystemTrial($pdo, $payload, $userId),
        default => avesmapsErrorResponse(400, 'invalid_action', 'Unknown action.'),
    };

    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    // Own message: every one of these is raised by our own validation and names the offending field.
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (AvesmapsConflictException $exception) {
    // 🔴 The optimistic guard. Two editors on the same area: the second save arrives with a stale
    // expected_revision and is REFUSED, instead of overwriting the first without a message, a conflict or
    // a trace. "409, reload" beats silent data loss.
    avesmapsErrorResponse(409, 'conflict', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'The ecosystem area could not be saved.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'The ecosystem area could not be processed.');
}
