<?php

declare(strict_types=1);

// Public link-status lookup (Spec §1.7). The integration hatch for surfaces that show links but have no
// payload of their own -- the fast path is the state embedded in api/app/adventures.php, which needs no
// second roundtrip. No auth (public map, like map-features/adventures); read-only. Envelope = gold contract.
//
// GET /api/app/link-status.php?hashes=<h1>,<h2>,…   (max 200 sha256 hex hashes)
//   -> { ok:true, statuses:{ "<hash>":{ state, http_status, checked_at } } }
//
// Unknown hashes are simply absent from the map -- the caller renders those as "unchecked". The URL
// itself is never echoed back: the caller already knows it (it hashed it), and this way the endpoint
// cannot be used to enumerate what we track.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/linkcheck/store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load link states.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for link states.');
    }

    $raw = trim((string) ($_GET['hashes'] ?? ''));
    if ($raw === '') {
        avesmapsJsonResponse(200, ['ok' => true, 'statuses' => (object) []]);
    }

    // Split generously; the store validates each hash and caps the list at AVESMAPS_LINK_STATUS_MAX_HASHES.
    $hashes = array_filter(array_map('trim', explode(',', $raw)), static fn(string $h): bool => $h !== '');
    if (count($hashes) > AVESMAPS_LINK_STATUS_MAX_HASHES) {
        avesmapsErrorResponse(
            400,
            'too_many_hashes',
            'At most ' . AVESMAPS_LINK_STATUS_MAX_HASHES . ' hashes may be requested at once.'
        );
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $statuses = avesmapsLinkCheckStatesByHashes($pdo, $hashes);

    // (object) so an empty result serialises as {} rather than [].
    avesmapsJsonResponse(200, ['ok' => true, 'statuses' => (object) $statuses]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Link states could not be loaded from the database.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Link states could not be loaded.');
}
