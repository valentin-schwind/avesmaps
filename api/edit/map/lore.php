<?php

declare(strict_types=1);

// Editor-Schreibpfad für Flora, Fauna, Spezies und Handelswaren.
// Logik: _internal/app/lore-edit.php. Lesepfad (öffentlich): api/app/lore.php.
//
// POST { action: "detail",       wiki_key }                        -> Eintrag komplett
// POST { action: "add_place",    wiki_key, place_title, relation? } -> Ort zuordnen (manual)
// POST { action: "remove_place", wiki_key, place_wiki_key, relation } -> Wiki-Ort: Grabstein; manuell: löschen
// POST { action: "set_field",    wiki_key, field, value }          -> Feld übersteuern (leer = Übersteuerung aufheben)
// POST { action: "set_status",   wiki_key, status }                -> active | suppressed
//
// Alle Schreibaktionen sind capability-gated ('edit') wie jeder Editor-Schreibpfad.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/lore-edit.php';
// avesmapsPoliticalSlug für die Ortsschlüssel beim Zuordnen.
require_once __DIR__ . '/../../_internal/political/territory.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Natur & Waren nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $wikiKey = avesmapsNormalizeSingleLine((string) ($payload['wiki_key'] ?? ''), 190);

    if ($wikiKey === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'wiki_key ist erforderlich.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    switch ($action) {
        case 'detail':
            $detail = avesmapsLoreReadEntryDetail($pdo, $wikiKey);
            if ($detail === null) {
                avesmapsErrorResponse(404, 'not_found', 'Dieser Eintrag existiert nicht.');
            }
            avesmapsJsonResponse(200, ['ok' => true, 'entry' => $detail]);
            // no break -- avesmapsJsonResponse exits.

        case 'add_place':
            $result = avesmapsLoreAddPlace(
                $pdo,
                $wikiKey,
                (string) ($payload['place_title'] ?? ''),
                avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20)
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_request'), 'Der Ort konnte nicht zugeordnet werden.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'remove_place':
            $result = avesmapsLoreRemovePlace(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['place_wiki_key'] ?? ''), 190),
                avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20)
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(404, (string) ($result['error'] ?? 'not_found'), 'Dieser Ort ist dem Eintrag nicht zugeordnet.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'set_field':
            $result = avesmapsLoreSetField(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['field'] ?? ''), 40),
                (string) ($payload['value'] ?? '')
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_field'), 'Dieses Feld kann nicht gesetzt werden.');
            }
            avesmapsJsonResponse(200, $result + ['entry' => avesmapsLoreReadEntryDetail($pdo, $wikiKey)]);
            // no break

        case 'set_status':
            $result = avesmapsLoreSetEntryStatus(
                $pdo,
                $wikiKey,
                avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 20)
            );
            if (($result['ok'] ?? false) !== true) {
                avesmapsErrorResponse(400, (string) ($result['error'] ?? 'invalid_request'), 'Dieser Status ist nicht erlaubt.');
            }
            avesmapsJsonResponse(200, $result);
            // no break

        default:
            avesmapsErrorResponse(400, 'unknown_action', 'Diese Aktion ist unbekannt.');
    }
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'lore_edit_failed', 'Die Bearbeitung ist fehlgeschlagen.');
}
