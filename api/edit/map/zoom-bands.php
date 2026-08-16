<?php

declare(strict_types=1);

// POST /api/edit/map/zoom-bands.php -- die Zoombänder lesen, speichern, zurücksetzen.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §5.3
// Vorbild in Form und Reihenfolge: api/edit/map/travel-values.php
//
// 🔴 LESEN darf `edit`, SPEICHERN und ZURÜCKSETZEN nur `admin`. Der Riegel steht hier, nicht nur
// am ausgegrauten Knopf im Fenster.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/zoom-bands.php';
require_once __DIR__ . '/../../_internal/map/features.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Zoombänder nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $maySave = avesmapsUserCan($user, 'admin');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'get'), 40);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION (siehe api/app/zoom-bands.php).
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    if ($action === 'get') {
        $state = avesmapsZoomBandsRead($pdo);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'bands' => $state['bands'],
            'stamp' => $state['stamp'],
            'can_save' => $maySave,
        ]);
    }

    if ($action !== 'save' && $action !== 'reset') {
        avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
    }

    if (!$maySave) {
        avesmapsErrorResponse(403, 'forbidden', 'Zoombänder einstellen dürfen nur Administratoren.');
    }

    $before = avesmapsZoomBandsRead($pdo)['bands'];

    if ($action === 'reset') {
        avesmapsZoomBandsReset($pdo);
    } else {
        $bands = avesmapsZoomBandsValidate($payload['bands'] ?? null);
        if ($bands === null) {
            avesmapsErrorResponse(400, 'invalid_bands', 'Die Zoombänder haben nicht die erwartete Form.');
        }
        if (!avesmapsZoomBandsWrite($pdo, $bands)) {
            // 🔴 Ein Speichern, das nicht ankommt, meldet das. Ein stiller Verlust ist genau der
            // Ausfall, wegen dessen die Rückleseprobe existiert.
            avesmapsErrorResponse(500, 'zoom_bands_not_stored',
                'Die Zoombänder konnten nicht vollständig gespeichert werden.');
        }
    }

    // ⚠️ `map_revision` wird NICHT gehoben -- es ändert kein Kartenobjekt, und ein Sprung ließe
    // jeden Client die komplette Feature-Nutzlast (21 MB) neu laden. Der Leser hat seinen eigenen
    // Stempel. Dieselbe Begründung wie bei den Tempowerten.

    // Eine Protokollzeile je Vorgang, nie eine je Wert. `feature_id = NULL` -- es hängt an keinem
    // Kartenobjekt.
    if (function_exists('avesmapsWriteMapAuditLog')) {
        $after = avesmapsZoomBandsRead($pdo)['bands'];
        avesmapsWriteMapAuditLog(
            $pdo,
            null,
            'zoom_bands_' . $action,
            (int) ($user['id'] ?? 0),
            json_encode(['bands' => $before], JSON_UNESCAPED_UNICODE),
            json_encode(['bands' => $after], JSON_UNESCAPED_UNICODE)
        );
    }

    $state = avesmapsZoomBandsRead($pdo);
    avesmapsJsonResponse(200, [
        'ok' => true,
        'bands' => $state['bands'],
        'stamp' => $state['stamp'],
        'can_save' => $maySave,
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Die Zoombänder konnten nicht verarbeitet werden.');
}
