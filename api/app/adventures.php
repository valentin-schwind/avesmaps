<?php

declare(strict_types=1);

// Public catalog for the Abenteuer feature (Phase 1). GET returns the whole approved catalog so the
// client aggregates locally (B1); no auth (public map, like map-features/feature-sources). POST is a
// guarded one-shot BOOTSTRAP surface (seed/resolve) to populate the fresh tables after a deploy -- both
// actions are idempotent and self-inert once done (seed only runs on an empty catalog; resolve only
// touches still-unresolved places). Phase 3 moves editing to the capability-gated editor and can
// tighten/remove these bootstrap actions. Envelope = gold contract.
//
// GET  /api/app/adventures.php                    -> { ok:true, adventures:[ { ..., places:[...] } ] }
// POST /api/app/adventures.php  {action:"seed"}    -> { ok:true, seeded:N }   (empty catalog only)
// POST /api/app/adventures.php  {action:"resolve"} -> { ok:true, resolved, unresolved, total }

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/adventures.php';

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
        avesmapsJsonResponse(200, ['ok' => true, 'adventures' => $adventures]);
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
        try {
            $result = avesmapsAdventureResolveAll($pdo);
        } catch (Throwable $resolveError) {
            // TEMP DEBUG (revert): surface the resolve failure to the operator who triggers it.
            avesmapsJsonResponse(200, ['ok' => false, 'debug' => $resolveError->getMessage(), 'at' => basename($resolveError->getFile()) . ':' . $resolveError->getLine()]);
        }
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
