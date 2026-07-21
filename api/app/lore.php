<?php

declare(strict_types=1);

// Öffentlicher Lesezugriff auf Flora, Fauna, Spezies und Handelswaren.
// Design: docs/flora-fauna-handelswaren-design.md.
//
// GET /api/app/lore.php?place=<wiki_key>[&full=1]
//     -> { ok:true, place:"...", sections:{flora:[…],fauna:[…],spezies:[…],ware:[…]},
//          counts:{flora:n,…}, total:n, limit:10 }
//     full=1 liefert die vollständigen Listen (für den „alle anzeigen"-Dialog).
//
// GET /api/app/lore.php?stats=1
//     -> { ok:true, stats:{ entries:{…}, entries_total, places, sources, top_places:[…] } }
//     Der Abnahmetest nach einem Sync. Erwartung aus dem verifizierten Dump-Scan:
//     5.104 Einträge, 7.748 Ortsverknüpfungen, 34.933 Quellen.
//
// Kein Auth (öffentliche Karte, wie map-features/adventures). Envelope = gold contract.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/lore.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load lore.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for lore.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if (isset($_GET['stats'])) {
        avesmapsJsonResponse(200, ['ok' => true, 'stats' => avesmapsLoreReadStats($pdo)]);
    }

    // Mehrere Orte sind erlaubt (kommagetrennt): Abschnitt 3 reicht hier die
    // Territorienkette herein, ohne dass sich der Vertrag ändert.
    $placeParameter = trim((string) ($_GET['place'] ?? ''));
    if ($placeParameter === '') {
        avesmapsErrorResponse(400, 'place_required', 'Parameter "place" (wiki_key) is required.');
    }
    $placeKeys = [];
    foreach (explode(',', $placeParameter) as $candidate) {
        $candidate = trim($candidate);
        // Der Wert landet in einer vorbereiteten Abfrage, aber ein Schlüssel besteht
        // nun einmal aus [a-z0-9-]; alles andere ist Unsinn und fliegt sofort raus.
        if ($candidate !== '' && preg_match('/^[a-z0-9_-]{1,190}$/i', $candidate) === 1) {
            $placeKeys[] = mb_strtolower($candidate, 'UTF-8');
        }
    }
    if ($placeKeys === []) {
        avesmapsErrorResponse(400, 'place_invalid', 'Parameter "place" holds no usable wiki_key.');
    }

    $full = isset($_GET['full']) && (string) $_GET['full'] !== '0';
    $result = avesmapsLoreReadForPlaces($pdo, $placeKeys, $full ? 0 : AVESMAPS_LORE_PANEL_LIMIT);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'place' => implode(',', $placeKeys),
        'sections' => $result['sections'],
        'counts' => $result['counts'],
        'total' => $result['total'],
        'limit' => $full ? 0 : AVESMAPS_LORE_PANEL_LIMIT,
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'lore_failed', 'Lore konnte nicht geladen werden.');
}
