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
// avesmapsPoliticalSlug für die Ortsschlüssel der Regionsbrücke (geographic-Feld).
require_once __DIR__ . '/../_internal/political/territory.php';

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

    // Diagnose: zeigt, wie ein Ortsschlüssel expandiert wird und woran die beiden
    // Hierarchietabellen gerade stehen. Read-only, keine Geheimnisse -- aber die
    // einzige Möglichkeit, eine leere Aggregation von einer kaputten zu unterscheiden,
    // ohne DB-Zugang.
    if (isset($_GET['expand'])) {
        $probe = mb_strtolower(trim((string) $_GET['expand']), 'UTF-8');
        $counts = ['wiki_territory_model' => -1, 'political_territory_wiki_geographic' => -1, 'lore_place_distinct' => -1];
        try {
            $counts['wiki_territory_model'] = (int) $pdo->query('SELECT COUNT(*) FROM wiki_territory_model')->fetchColumn();
        } catch (Throwable) {
        }
        try {
            $counts['political_territory_wiki_geographic'] = (int) $pdo->query(
                'SELECT COUNT(*) FROM political_territory_wiki WHERE geographic IS NOT NULL AND geographic <> \'\''
            )->fetchColumn();
        } catch (Throwable) {
        }
        try {
            $counts['lore_place_distinct'] = (int) $pdo->query('SELECT COUNT(DISTINCT place_wiki_key) FROM lore_place')->fetchColumn();
        } catch (Throwable) {
        }
        $samples = [];
        try {
            $samples['territory_model'] = $pdo->query('SELECT wiki_key, parent_wiki_key FROM wiki_territory_model LIMIT 3')
                ->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable) {
        }
        try {
            $samples['geographic'] = $pdo->query(
                'SELECT wiki_key, geographic FROM political_territory_wiki
                 WHERE geographic IS NOT NULL AND geographic <> \'\' LIMIT 3'
            )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable) {
        }
        $expanded = $probe !== '' ? avesmapsLoreExpandPlaceKeys($pdo, $probe) : [];
        avesmapsJsonResponse(200, [
            'ok' => true,
            'probe' => $probe,
            'expanded_count' => count($expanded),
            'expanded_sample' => array_slice($expanded, 0, 25, true),
            'table_counts' => $counts,
            'samples' => $samples,
        ]);
    }

    // Katalogliste für den Editor-Reiter: ?catalog=1[&kind=fauna][&q=…][&limit=][&offset=]
    if (isset($_GET['catalog'])) {
        $kind = mb_strtolower(trim((string) ($_GET['kind'] ?? '')), 'UTF-8');
        $query = trim((string) ($_GET['q'] ?? ''));
        $limit = (int) ($_GET['limit'] ?? 200);
        $offset = (int) ($_GET['offset'] ?? 0);
        $catalog = avesmapsLoreReadCatalog($pdo, $kind, $query, $limit, $offset);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'kind' => $kind,
            'q' => $query,
            'items' => $catalog['items'],
            'total' => $catalog['total'],
            'offset' => max(0, $offset),
            // Bestand ALLER Arten, damit die Unterreiter ihre Zahlen sofort tragen und
            // nicht erst, nachdem man sie einzeln angeklickt hat.
            'counts_by_kind' => avesmapsLoreCountsByKind($pdo),
        ]);
    }

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
    // Abschnitt 3: den angefragten Ort um Unter- und Obergebiete erweitern, damit
    // Weiden auch zeigt, was in der Baronie Moosgrund gehandelt wird. Der niedrigste
    // (spezifischste) Rang gewinnt, wenn mehrere Wege auf denselben Ort führen.
    // ⚠️ PERF: die Expansion liest zwei Hierarchietabellen komplett. Bei den aktuellen
    // Größen ist das vertretbar; wächst der Territorienbestand deutlich, gehört hier
    // ein Cache hin (die Bäume ändern sich nur beim Sync, nicht pro Aufruf).
    $ranks = [];
    foreach ($placeKeys as $key) {
        foreach (avesmapsLoreExpandPlaceKeys($pdo, $key) as $expandedKey => $rank) {
            if (!isset($ranks[$expandedKey]) || $rank < $ranks[$expandedKey]) {
                $ranks[$expandedKey] = $rank;
            }
        }
    }
    if ($ranks === []) {
        foreach ($placeKeys as $key) {
            $ranks[$key] = 0;
        }
    }

    $result = avesmapsLoreReadForPlaces($pdo, array_keys($ranks), $full ? 0 : AVESMAPS_LORE_PANEL_LIMIT, $ranks);

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
