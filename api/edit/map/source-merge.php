<?php

declare(strict_types=1);

// Fold one catalog source into another (instruction step 5, docs/quellen-wiki-key-instruction.md).
//
// This is the primitive the whole migration is built from: step 5 is "run this once per group of
// sources sharing a wiki key". It exists as its own endpoint, not an action on feature-sources.php,
// because it is NOT scoped to one element -- it rewrites every link the old source has.
//
// Two gates on purpose:
//   report -> capability 'edit'  (writes NOTHING; this is the step-4 material)
//   apply  -> capability 'admin' (rewrites links across the whole map)
//
// Invariants honoured (section 4 of the instruction):
//   1 no mapping lost      -- every element citing the old source ends up citing the new one
//   2 handwork beats sync  -- avesmapsMergeWinningLink keeps the stronger origin, suppressed stays
//   3 no guessing          -- BOTH ids come from the caller; nothing is matched by title or slug
//   4 reversible           -- source_merge_log records the prior state BEFORE the old link is cut
//   5 readers stay calm    -- per element: write the new link first, delete the old one after
//
// POST { action: "report"|"apply", from_source_id: int, into_source_id: int }

require __DIR__ . '/../../_internal/auth.php';
// The legacy other_source takeover needs avesmapsEncodeJson/avesmapsNextMapRevision from the
// map-features library (same reason feature-sources.php pulls it in).
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/feature-sources.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Quellen nicht zusammenfuehren.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 20);
    if (!in_array($action, ['report', 'apply'], true) ) {
        avesmapsErrorResponse(400, 'invalid_request', 'action muss report oder apply sein.');
    }

    // Reporting is read-only and useful to any reviewer; applying moves real data.
    $user = avesmapsRequireUserWithCapability($action === 'apply' ? 'admin' : 'edit');

    $fromId = (int) ($payload['from_source_id'] ?? 0);
    $intoId = (int) ($payload['into_source_id'] ?? 0);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $result = avesmapsMergeSourceInto($pdo, $fromId, $intoId, (int) ($user['id'] ?? 0), $action === 'report');

    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Das Zusammenfuehren ist an der Datenbank gescheitert.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Das Zusammenfuehren ist fehlgeschlagen.');
}
