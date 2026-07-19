<?php

declare(strict_types=1);

// Public, read-only typeahead over the shared source catalog (instruction 5a). Lets every form
// that accepts a source REFERENCE an existing one instead of typing a duplicate.
//
// Public on purpose: the community report form ("Aenderung vorschlagen") is public, and that is
// where the duplicates actually come from -- there only the NAME is required, so a source reported
// without a URL cannot be deduped by url_hash at all and always becomes a fresh row.
//
// The response carries GROUPS rather than a flat list so the adventure/citymap catalogues can join
// as a second group once sources.wiki_key exists (steps 1+2) without a client change. Group
// headings are NOT sent from here -- the client renders them from its own i18n table (AGENTS.md
// section 8: German UI strings belong in the string table, not in API payloads).
//
// GET ?q=<term>&limit=<1..10>

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/feature-sources.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Quellen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer die Quellensuche erlaubt.');
    }

    $query = trim((string) ($_GET['q'] ?? ''));
    // Below two characters almost every source matches -- not a useful suggestion list, and a
    // needless round trip on every first keystroke.
    if (mb_strlen($query) < 2) {
        avesmapsJsonResponse(200, ['ok' => true, 'groups' => []]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $items = avesmapsSearchSourceCatalog($pdo, $query, (int) ($_GET['limit'] ?? 8));

    avesmapsJsonResponse(200, [
        'ok' => true,
        'groups' => $items === [] ? [] : [['key' => 'catalog', 'items' => $items]],
    ]);
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellensuche konnte die Datenbank nicht erreichen.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellensuche ist fehlgeschlagen.');
}
