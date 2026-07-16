<?php

declare(strict_types=1);

// Public catalog for the Kartensammlung (Spec §3.5). GET returns the whole approved catalog so the client
// indexes + aggregates locally, exactly like api/app/adventures.php; no auth (public map, like
// map-features/feature-sources). Read-only: every write goes through the capability-gated editor
// (api/edit/map/citymaps.php), so there is no bootstrap POST surface here at all.
//
// GET /api/app/citymaps.php -> { ok:true, citymaps:[ { ..., places:[...], links:[{...,state}] } ],
//                                citymaps_enabled:bool }
//
// Deliberately NOT part of the map-features payload (§6): a link-state flip would force
// avesmapsNextMapRevision() and invalidate the whole ~14 MB payload for every client over a marker.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/citymaps.php';
// Link states travel with the catalog (Spec §1.7). Read-only here -- the store's DDL is self-healing, so
// a fresh deploy answers with 'unchecked' everywhere until the first sync runs.
require_once __DIR__ . '/../_internal/linkcheck/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load citymaps.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for citymaps.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // Kill switch (Spec §3.3): the owner's "emergency off" for the whole collection. Enforced HERE, not
    // in the client -- the rows must not leave the box at all. The flag still ships so the frontend can
    // say why the section is gone rather than silently rendering nothing.
    if (!avesmapsCitymapsEnabled($pdo)) {
        avesmapsJsonResponse(200, ['ok' => true, 'citymaps' => [], 'citymaps_enabled' => false]);
    }

    $citymaps = avesmapsCitymapsReadCatalog($pdo);

    // Decorate each link with its checked state (Spec §1.7, the embedded path): ONE extra query for the
    // whole catalog, so the dialog never fetches link states per map.
    //
    // The state is a DECORATION on a payload every visitor loads. If the linkcheck tables cannot be read
    // for any reason, ship the catalog with everything 'unchecked' rather than answering 500 and taking
    // the whole map collection down over a marker. The state is then the only thing lost, and it is
    // visibly lost (grey "noch nicht geprüft"), not silently wrong.
    $linkStates = [];
    try {
        $linkStates = avesmapsLinkCheckStatesByEntityType($pdo, 'citymap');
    } catch (Throwable) {
        $linkStates = [];
    }
    foreach ($citymaps as $index => $citymap) {
        foreach ($citymap['links'] as $linkIndex => $link) {
            $state = $linkStates[$citymap['public_id']][$link['key']] ?? null;
            // Not in the registry yet (never synced) is indistinguishable from never probed: both are
            // honestly "unchecked".
            $citymaps[$index]['links'][$linkIndex]['state'] = $state['state'] ?? 'unchecked';
            // url_hash stays server-side. avesmapsCitymapLinks() returns it because the linkcheck
            // provider needs it to key the registry, but no client reads it -- `state` is already inline
            // here, and link-status.php exists for surfaces that hash their own URLs.
            unset($citymaps[$index]['links'][$linkIndex]['url_hash']);
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'citymaps' => $citymaps,
        'citymaps_enabled' => true,
    ]);
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Citymaps could not be loaded from the database.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Citymaps could not be loaded.');
}
