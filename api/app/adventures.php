<?php

declare(strict_types=1);

// Public catalog for the Abenteuer feature (Phase 1). GET returns the whole approved catalog so the
// client aggregates locally (B1); no auth (public map, like map-features/feature-sources). POST is a
// guarded one-shot BOOTSTRAP surface (seed/resolve) to populate the fresh tables after a deploy -- both
// actions are idempotent and self-inert once done (seed only runs on an empty catalog; resolve only
// touches still-unresolved places). Phase 3 moves editing to the capability-gated editor and can
// tighten/remove these bootstrap actions. Envelope = gold contract.
//
// GET  /api/app/adventures.php                    -> { ok:true, adventures:[ { ..., places:[...] } ],
//                                                       territory_meta:{ "wiki:...":{name,rank}, ... } }
// POST /api/app/adventures.php  {action:"seed"}    -> { ok:true, seeded:N }   (empty catalog only)
// POST /api/app/adventures.php  {action:"resolve"} -> { ok:true, resolved, unresolved, total }

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/adventures.php';
// Link states travel with the catalog (Spec §1.7). Read-only here -- the store's DDL is self-healing, so
// a fresh deploy answers with 'unchecked' everywhere until the first sync runs.
require_once __DIR__ . '/../_internal/linkcheck/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load adventures.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET' && $requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET and POST are allowed for adventures.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        $adventures = avesmapsAdventuresReadCatalog($pdo);
        // Decorate each link with its checked state (Spec §1.7, the embedded path): ONE extra query for
        // the whole catalog, so the dialog never has to fetch link states per adventure. Deliberately
        // NOT part of the map-features payload -- a state flip there would invalidate the full 14 MB
        // payload for every client (§6).
        // The link state is a DECORATION on a payload every visitor loads eagerly. If the linkcheck
        // tables cannot be read for any reason, ship the catalog with everything 'unchecked' instead of
        // answering 500 and taking the whole adventure feature down over a marker. The state is the only
        // thing lost, and it is visibly lost (grey "noch nicht geprüft"), not silently wrong.
        $linkStates = [];
        try {
            $linkStates = avesmapsLinkCheckStatesByEntityType($pdo, 'adventure');
        } catch (Throwable) {
            $linkStates = [];
        }
        foreach ($adventures as $index => $adventure) {
            foreach ($adventure['links'] as $linkIndex => $link) {
                $state = $linkStates[$adventure['public_id']][$link['key']] ?? null;
                // Not in the registry yet (never synced) is indistinguishable from never probed: both
                // are honestly "unchecked".
                $adventures[$index]['links'][$linkIndex]['state'] = $state['state'] ?? 'unchecked';
                // url_hash stays server-side. avesmapsAdventureLinks() returns it because the linkcheck
                // provider needs it to key the registry, but no client reads it -- `state` is already
                // inline here, and link-status.php exists for surfaces that hash their own URLs. This
                // payload is fetched eagerly on EVERY page load, so ~64 hex chars per link per adventure
                // would be pure weight. (Deviates from the literal shape in §2.5 for that reason.)
                unset($adventures[$index]['links'][$linkIndex]['url_hash']);
            }
        }
        $territoryMeta = avesmapsAdventuresTerritoryMeta($pdo, $adventures);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'adventures' => $adventures,
            'territory_meta' => $territoryMeta,
            'covers_enabled' => avesmapsAdventuresCoversEnabled($pdo),
            'adventures_enabled' => avesmapsAdventuresEnabled($pdo),
        ]);
    }

    // POST: bootstrap actions.
    $payload = avesmapsReadJsonRequest();
    $action = trim((string) ($payload['action'] ?? ''));

    if ($action === 'seed') {
        // Empty-guard (owner decision "nur wenn leer"): never overwrites an existing catalog.
        if (avesmapsAdventuresCount($pdo) > 0) {
            avesmapsJsonResponse(200, ['ok' => true, 'seeded' => 0, 'skipped' => 'catalog_not_empty']);
        }
        $seeded = avesmapsAdventuresSeedSamples($pdo);
        avesmapsJsonResponse(200, ['ok' => true, 'seeded' => $seeded]);
    }

    if ($action === 'resolve') {
        require_once __DIR__ . '/../_internal/app/adventure-resolve.php';
        $result = avesmapsAdventureResolveAll($pdo);
        avesmapsJsonResponse(200, ['ok' => true] + $result);
    }

    avesmapsErrorResponse(400, 'invalid_action', 'Unknown action (expected seed or resolve).');
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', 'The request body is not valid JSON.');
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Adventures could not be loaded from the database.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Adventures could not be loaded.');
}
