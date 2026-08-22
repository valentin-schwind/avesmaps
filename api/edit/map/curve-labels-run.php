<?php

declare(strict_types=1);

// POST /api/edit/map/curve-labels-run.php -- der Sammellauf der Beschriftungskurven.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §7.1
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 Nur `admin`. Der Lauf rechnet ueber alle Flaechen und schreibt eine Zeile, die JEDE Karte
// liest -- das ist keine Editorhandlung.
// ⚠️ Er laeuft SEKUNDEN (56 Regionen mal rund 50 ms). Genau deshalb steht er hier und nicht im
// Lesepfad (AGENTS.md §9, STRATO).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/curve-label-store.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Sammellauf nicht ausloesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    // 🔴 Der Riegel steht HIER, nicht nur am ausgegrauten Knopf im Fenster.
    avesmapsRequireUserWithCapability('admin');

    // ⚠️ Der Lauf braucht SEKUNDEN, nicht Millisekunden: gemessen 165-796 ms je Flaeche, und bei
    // rund 50 eingeschalteten Regionen sind das etwa 20 s. Ohne diese Zeile bricht PHP mitten im
    // Lauf ab -- und weil erst ganz am Ende geschrieben wird, waere das Ergebnis dann NICHTS,
    // stillschweigend. Bewusst 0 (unbegrenzt) und nicht eine geratene Zahl: die Laufzeit waechst
    // mit jeder Region, die ein Editor einschaltet.
    // 🔧 Sobald die Kachel "Darstellung" (Plan 4) einen Auslöser mit Fortschritt hat, gehoert der
    // Lauf gestueckelt -- so wie das Hoehenraster eine Anfrage je Flaeche faehrt.
    @set_time_limit(0);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION -- dieselbe Falle steht in zoom-bands.php
    // ausdruecklich angeschrieben.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    $ergebnis = avesmapsCurveRebuildCache($pdo);

    if (!$ergebnis['ok']) {
        // 💣 Der Zurueckleser hat widersprochen: MySQL hat gekuerzt. Als Erfolg zu antworten waere
        // die Fehlerklasse, die den Speichern-Knopf der Tempowerte wochenlang unbemerkt lahmlegte
        // (AGENTS.md §10).
        avesmapsErrorResponse(500, 'curve_cache_truncated',
            'Die Ablage kam gekuerzt zurueck (' . $ergebnis['bytes'] . ' Bytes geschrieben).');
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'regions' => $ergebnis['regions'],
        'bytes' => $ergebnis['bytes'],
    ]);
} catch (Throwable $e) {
    // ⚠️ Die Meldung des Fehlers geht NICHT nach draussen (AGENTS.md §10, Info-Disclosure), aber
    // ins Protokoll -- eine Absage ohne Grund ist von aussen unauffindbar.
    error_log('curve-labels-run: ' . $e->getMessage());
    avesmapsErrorResponse(500, 'curve_run_failed', 'Der Sammellauf ist gescheitert.');
}
