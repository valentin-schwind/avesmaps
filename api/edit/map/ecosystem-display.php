<?php

declare(strict_types=1);

// POST /api/edit/map/ecosystem-display.php -- die Darstellungstafel lesen, speichern,
// zuruecksetzen, und den Median messen.
// Entwurf: docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md §8
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 LESEN und MESSEN darf `edit`, SPEICHERN und ZURUECKSETZEN nur `admin`. Der Riegel steht HIER,
// nicht nur am ausgegrauten Knopf im Fenster.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/ecosystem-display.php';
require_once __DIR__ . '/../../_internal/map/features.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Darstellung nicht bearbeiten.');
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

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION (siehe api/app/ecosystem-display.php).
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    if ($action === 'get') {
        $state = avesmapsEcosystemDisplayRead($pdo);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'display' => $state['display'],
            'stamp' => $state['stamp'],
            'can_save' => $maySave,
        ]);
    }

    // 🔴 DER MEDIAN IST UNSER WERKZEUG, nicht das der Editoren (Entwurf §5.4) -- aber er MISST nur.
    // Deshalb steht er VOR dem Speicher-Riegel: wer die Tafel ansehen darf, darf auch nachsehen,
    // was die Editoren tatsaechlich eingestellt haben. Geschrieben wird dabei nichts.
    if ($action === 'median') {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'median' => avesmapsEcosystemDisplayMedians($pdo),
            'can_save' => $maySave,
        ]);
    }

    if ($action !== 'save' && $action !== 'reset') {
        avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
    }

    if (!$maySave) {
        avesmapsErrorResponse(403, 'forbidden', 'Die Darstellung einstellen duerfen nur Administratoren.');
    }

    $before = avesmapsEcosystemDisplayRead($pdo)['display'];

    if ($action === 'reset') {
        avesmapsEcosystemDisplayReset($pdo);
    } else {
        $display = avesmapsEcosystemDisplayValidate($payload['display'] ?? null);
        if ($display === null) {
            avesmapsErrorResponse(400, 'invalid_display', 'Die Darstellungstafel hat nicht die erwartete Form.');
        }
        if (!avesmapsEcosystemDisplayWrite($pdo, $display)) {
            // 🔴 Ein Speichern, das nicht ankommt, meldet das. Ein stiller Verlust ist genau der
            // Ausfall, wegen dessen die Rueckleseprobe existiert (AGENTS.md §10).
            avesmapsErrorResponse(500, 'ecosystem_display_not_stored',
                'Die Darstellungstafel konnte nicht vollstaendig gespeichert werden.');
        }
    }

    // ⚠️ `map_revision` wird NICHT gehoben -- es aendert kein Kartenobjekt, und ein Sprung liesse
    // jeden Client die komplette Feature-Nutzlast (21 MB) neu laden. Der Leser hat seinen eigenen
    // Stempel. Dieselbe Begruendung wie bei den Zoombaendern und den Tempowerten.

    // Eine Protokollzeile je Vorgang, nie eine je Wert. `feature_id = NULL` -- es haengt an keinem
    // Kartenobjekt.
    if (function_exists('avesmapsWriteMapAuditLog')) {
        $after = avesmapsEcosystemDisplayRead($pdo)['display'];
        avesmapsWriteMapAuditLog(
            $pdo,
            null,
            'ecosystem_display_' . $action,
            (int) ($user['id'] ?? 0),
            json_encode(['display' => $before], JSON_UNESCAPED_UNICODE),
            json_encode(['display' => $after], JSON_UNESCAPED_UNICODE)
        );
    }

    $state = avesmapsEcosystemDisplayRead($pdo);
    avesmapsJsonResponse(200, [
        'ok' => true,
        'display' => $state['display'],
        'stamp' => $state['stamp'],
        'can_save' => $maySave,
    ]);
} catch (Throwable $error) {
    // ⚠️ Die Meldung geht NICHT nach draussen (AGENTS.md §10, Info-Disclosure), aber ins Protokoll
    // -- eine Absage ohne Grund ist von aussen unauffindbar.
    error_log('ecosystem-display: ' . $error->getMessage());
    avesmapsErrorResponse(500, 'server_error', 'Die Darstellungstafel konnte nicht verarbeitet werden.');
}
