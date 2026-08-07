<?php

declare(strict_types=1);

// Public catalog for the Literatur feature. GET returns the whole approved catalog so the client
// aggregates locally (B1); no auth (public map, like map-features/feature-sources). READ ONLY --
// every write goes through the capability-gated editor endpoint POST /api/edit/map/game-literature.php.
// Envelope = gold contract.
//
// 💣 It was not always read-only. Until 2026-08-05 it also took POST {action:"seed"|"resolve"}
// with no authentication whatsoever: a bootstrap surface from Phase 1 that this header itself said
// "Phase 3 ... can tighten/remove", except Phase 3 shipped and the removal did not happen. It was
// an anonymous write, and -- worse on this host -- an anonymous lever, because `resolve` walks the
// whole stock and could be fired as often as anyone liked. Do not reintroduce a POST arm here; the
// resolver is still reachable where it belongs (editor flow, wiki reconcile, and the CLI tool
// tools/game-literature/seed-sample-game-literature.php, which is not part of the deploy).
//
// GET  /api/app/game-literature.php  -> { ok:true, adventures:[ { ..., places:[...] } ],
//                                    territory_meta:{ "wiki:...":{name,rank}, ... } }

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/game-literature.php';
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

    // 💣 GET only. Until 2026-08-05 this endpoint also took POST {action:"seed"|"resolve"} with NO
    // authentication at all -- an anonymous write into the catalogue, and worse, an anonymous lever:
    // `resolve` walks the whole stock, so a stranger could drive the PHP pool into a full resolve run
    // as often as they liked, on a host that has already been saturated into an outage three times.
    // The file header called it a "one-shot BOOTSTRAP surface" that "Phase 3 can tighten/remove";
    // Phase 3 shipped long ago and the removal never happened.
    // Nothing is lost: the resolver has three other callers that stay -- the editor's own flow
    // (api/_internal/app/game-literature.php), the wiki reconcile (api/_internal/wiki/game-literature-sync.php)
    // and the CLI tool tools/game-literature/seed-sample-game-literature.php, which is not deployed at all.
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for adventures. Writing goes through the capability-gated editor endpoint.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        $gameLiteratureEntries = avesmapsGameLiteratureReadCatalog($pdo);
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
        foreach ($gameLiteratureEntries as $index => $gameLiterature) {
            foreach ($gameLiterature['links'] as $linkIndex => $link) {
                $state = $linkStates[$gameLiterature['public_id']][$link['key']] ?? null;
                // Not in the registry yet (never synced) is indistinguishable from never probed: both
                // are honestly "unchecked".
                $gameLiteratureEntries[$index]['links'][$linkIndex]['state'] = $state['state'] ?? 'unchecked';
                // url_hash stays server-side. avesmapsGameLiteratureLinks() returns it because the linkcheck
                // provider needs it to key the registry, but no client reads it -- `state` is already
                // inline here, and link-status.php exists for surfaces that hash their own URLs. This
                // payload is fetched eagerly on EVERY page load, so ~64 hex chars per link per adventure
                // would be pure weight. (Deviates from the literal shape in §2.5 for that reason.)
                unset($gameLiteratureEntries[$index]['links'][$linkIndex]['url_hash']);
            }
        }
        $territoryMeta = avesmapsGameLiteratureTerritoryMeta($pdo, $gameLiteratureEntries);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'adventures' => $gameLiteratureEntries,
            'territory_meta' => $territoryMeta,
            'covers_enabled' => avesmapsGameLiteratureCoversEnabled($pdo),
            'adventures_enabled' => avesmapsGameLiteratureEnabled($pdo),
        ]);
    }

    // Unreachable: the method gate above lets nothing but GET through, and the GET arm exits.
    avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for adventures.');
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', 'The request body is not valid JSON.');
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Adventures could not be loaded from the database.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Adventures could not be loaded.');
}
