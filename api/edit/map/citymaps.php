<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

// Editor writes for the Kartensammlung (Spec §3.5) -- tables citymap / citymap_type / citymap_place /
// citymap_related. Mirrors the adventures.php dispatcher. avesmapsUuidV4() (new citymap public_ids) lives
// in the map-features library and is not pulled in by the citymap library, so load it here; the resolver
// is loaded for add_place's wiki-key backfill and for resolve_place. The write logic lives in the
// app-layer library -- the dispatcher stays thin.
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/adventure-resolve.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Karten nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $userId = (int) ($user['id'] ?? 0);

    $result = match ($action) {
        'list' => avesmapsListCitymapsForEdit($pdo),
        'detail' => (static function () use ($pdo, $payload): array {
            $publicId = trim((string) ($payload['public_id'] ?? ''));
            if ($publicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'public_id ist erforderlich.');
            }
            $detail = avesmapsCitymapDetailForEdit($pdo, $publicId);
            if ($detail === null) {
                avesmapsErrorResponse(404, 'not_found', 'Die Karte wurde nicht gefunden.');
            }
            return $detail;
        })(),
        'upsert_citymap' => avesmapsUpsertCitymap($pdo, (array) ($payload['citymap'] ?? []), $userId),
        // set_types / set_related take the COMPLETE list in display order, so each replaces its list
        // wholesale. An empty array is a legitimate payload -- it clears the list. Both are leaf data with
        // no per-row identity to protect, which is why there is no id juggling (same call as set_links on
        // the adventure side).
        'set_types' => (static function () use ($pdo, $payload): array {
            $publicId = trim((string) ($payload['public_id'] ?? ''));
            if ($publicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'public_id ist erforderlich.');
            }
            return avesmapsSetCitymapTypes($pdo, $publicId, (array) ($payload['types'] ?? []));
        })(),
        'set_related' => (static function () use ($pdo, $payload): array {
            $publicId = trim((string) ($payload['public_id'] ?? ''));
            if ($publicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'public_id ist erforderlich.');
            }
            return avesmapsSetCitymapRelated($pdo, $publicId, (array) ($payload['related'] ?? []));
        })(),
        // Where the map can be FOUND (multi-link spec §6.1) -- same whole-list contract as set_types above,
        // and the direct sibling of the adventure side's set_links. is_paid rides on each ROW, never on the
        // map: the same volume is paid in the shop and free on its wiki page.
        'set_links' => (static function () use ($pdo, $payload): array {
            $publicId = trim((string) ($payload['public_id'] ?? ''));
            if ($publicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'public_id ist erforderlich.');
            }
            return avesmapsSetCitymapLinks($pdo, $publicId, (array) ($payload['links'] ?? []));
        })(),
        'add_place' => (static function () use ($pdo, $payload): array {
            $citymapPublicId = trim((string) ($payload['citymap_public_id'] ?? ''));
            if ($citymapPublicId === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'citymap_public_id ist erforderlich.');
            }
            return avesmapsAddCitymapPlace($pdo, $citymapPublicId, (array) ($payload['place'] ?? []));
        })(),
        'set_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsSetCitymapPlace($pdo, $placeId, (array) ($payload['place'] ?? []));
        })(),
        'suppress_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsSuppressCitymapPlace($pdo, $placeId);
        })(),
        'resolve_place' => (static function () use ($pdo, $payload): array {
            $placeId = (int) ($payload['place_id'] ?? 0);
            if ($placeId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'place_id ist erforderlich.');
            }
            return avesmapsResolveCitymapPlace($pdo, $placeId);
        })(),
        // Global kill switch (owner "emergency off"): hides the whole Kartensammlung on the public
        // frontend; the rows stay stored and the editor keeps working.
        'set_citymaps_enabled' => avesmapsSetCitymapsEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
        default => avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.'),
    };

    avesmapsJsonResponse(200, ['ok' => true] + $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Karte konnte nicht gespeichert werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Karte konnte nicht verarbeitet werden.');
}
