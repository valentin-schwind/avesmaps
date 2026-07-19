<?php

declare(strict_types=1);

// What `Art` values does Wiki Aventurica ACTUALLY use, and which of them are we still failing to
// recognise? This is the follow-up api/_internal/wiki/publication-parsing.php:130 asks for in so
// many words -- its Art->source_type table is a starter list, and anything not in it silently
// becomes 'sonstiges'.
//
// Two consequences of falling through, and the second one is the expensive one:
//   * the source gets source_type='sonstiges' instead of its real kind
//   * avesmapsWikiProductIsAdventure() says no, so the page never enters wiki_adventure_catalog
//     at all -- the adventure is simply missing from the catalogue, with nothing to indicate why
//
// Read-only, and it needs no wiki access whatsoever: wiki_publication_catalog already stores the
// raw `art` of every publication page the dump has seen.
//
// GET (no parameters). Capability 'edit'.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/publication-parsing.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf diese Erhebung nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist fuer diese Erhebung erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $statement = $pdo->query(
        "SELECT COALESCE(art, '') AS art, COUNT(*) AS n
           FROM wiki_publication_catalog
          GROUP BY COALESCE(art, '')
          ORDER BY n DESC, art ASC"
    );

    $known = [];
    $unmapped = [];
    $adventureArts = [];
    $totalPages = 0;
    $unmappedPages = 0;

    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $art = (string) $row['art'];
        $count = (int) $row['n'];
        $totalPages += $count;

        $type = avesmapsWikiMapArtToSourceType($art);
        $isAdventure = avesmapsWikiProductIsAdventure($art);
        $entry = ['art' => $art, 'pages' => $count, 'source_type' => $type, 'counts_as_adventure' => $isAdventure];

        if ($isAdventure) {
            $adventureArts[] = $entry;
        }
        // 'sonstiges' is the fall-through bucket: every value landing there is one the table does
        // not know. An empty `art` is a parse gap of its own and is reported the same way.
        if ($type === 'sonstiges') {
            $unmapped[] = $entry;
            $unmappedPages += $count;
        } else {
            $known[] = $entry;
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'distinct_art_values' => count($known) + count($unmapped),
        'pages_total' => $totalPages,
        'pages_unmapped' => $unmappedPages,
        // The actionable list: every Art the parser does not know, biggest first. Each one is a
        // candidate row for the table in publication-parsing.php.
        'unmapped' => $unmapped,
        'recognised_as_adventure' => $adventureArts,
        'mapped' => $known,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Erhebung konnte die Datenbank nicht erreichen.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Erhebung ist fehlgeschlagen.');
}
