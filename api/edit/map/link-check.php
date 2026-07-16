<?php

declare(strict_types=1);

// Linkchecker editor surface (Spec §1.7). Capability-gated; the dispatcher stays thin -- all logic lives
// in the linkcheck libraries. STRATO has no cron and heavy endpoints in a loop saturate the PHP workers
// (AGENTS.md §9), so every action is ONE bounded step and the client drives the repetition, exactly like
// the WikiSync dump driver.
//
// POST /api/edit/map/link-check.php {action:"sync", cursor?}  -> { ok, done, cursor, entity_type, seen, created, removed, pruned }
// POST … {action:"check_step"}                                -> { ok, done, checked, online, dead, remaining }
// POST … {action:"status"}                                    -> { ok, status:{ total, online, dead, unchecked, due } }
// POST … {action:"recheck", url_hash | entity_type+entity_public_id } -> { ok, requeued }

require __DIR__ . '/../../_internal/auth.php';
// providers.php pulls in store/state/probe plus the app libraries the collectors read from.
require_once __DIR__ . '/../../_internal/linkcheck/providers.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Links nicht pruefen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    // PHP holds the session file locked for the whole request, and a check_step occupies a worker for up
    // to 25s -- a full run chains dozens of them. Without this, an editor's own link check freezes the
    // rest of the editor FOR THEM: every other request queues behind the session lock (measured: a plain
    // `status` call took 21s while a check_step was running). Nothing below reads or writes the session
    // -- the capability was already resolved above -- so release it before doing the slow work.
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    // Optional scope: restrict sync/check_step/status to ONE entity type, so each editor tab checks its
    // own links instead of the whole backlog. '' = everything (the CLI). Validated against the registry
    // here -- an unknown type would silently match nothing and look like "already done".
    $scope = trim((string) ($payload['entity_type'] ?? ''));
    if ($scope !== '' && !array_key_exists($scope, avesmapsLinkCheckProviders())) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannter entity_type: ' . $scope);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $result = match ($action) {
        // Rebuild the registry: scoped -> one provider, done in a single call; unscoped -> cursor walk.
        'sync' => ['ok' => true] + avesmapsLinkCheckSyncStep($pdo, trim((string) ($payload['cursor'] ?? '')), $scope),

        // Probe one bounded batch of due links (within the scope, if given).
        'check_step' => ['ok' => true] + avesmapsLinkCheckStep($pdo, AVESMAPS_LINK_CHECK_BUDGET_SECONDS, $scope),

        'status' => ['ok' => true, 'status' => avesmapsLinkCheckStatus($pdo, $scope)],

        // Force links due now -- either one hash or every link of one entity.
        'recheck' => (static function () use ($pdo, $payload): array {
            $urlHash = strtolower(trim((string) ($payload['url_hash'] ?? '')));
            $entityType = trim((string) ($payload['entity_type'] ?? ''));
            $entityPublicId = trim((string) ($payload['entity_public_id'] ?? ''));
            if ($urlHash === '' && ($entityType === '' || $entityPublicId === '')) {
                avesmapsErrorResponse(
                    400,
                    'invalid_request',
                    'url_hash oder entity_type + entity_public_id ist erforderlich.'
                );
            }
            // A malformed hash must not fall through to the entity branch and answer {ok:true,
            // requeued:0} -- that reads as "nothing matched" when the truth is "you sent nonsense".
            if ($urlHash !== '' && preg_match('/^[0-9a-f]{64}$/', $urlHash) !== 1) {
                avesmapsErrorResponse(400, 'invalid_request', 'url_hash muss ein sha256-Hex-Hash sein.');
            }
            return ['ok' => true, 'requeued' => avesmapsLinkCheckForceRecheck($pdo, $urlHash, $entityType, $entityPublicId)];
        })(),

        default => throw new InvalidArgumentException('Die Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    // No getMessage() to the client: several edit endpoints still leak exception text (milestone M1) --
    // a new endpoint does not inherit that.
    avesmapsErrorResponse(500, 'server_error', 'Die Linkpruefung konnte nicht abgeschlossen werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Linkpruefung konnte nicht ausgefuehrt werden.');
}
