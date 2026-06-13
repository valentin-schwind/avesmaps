<?php

declare(strict_types=1);

// Decommissioned 2026-06-13 (refactoring M1 / security).
// This endpoint was an UNAUTHENTICATED, web-reachable surface that could
// TRUNCATE the wiki staging table and drive an outbound MediaWiki crawler.
// Its only UI (the wiki-dom playground / sync-settings pages) was orphaned and
// has been removed. The live WikiSync runs via api/edit/wiki/sync-monitor.php.
// This stub exists so the deploy overwrites and neutralizes the old server URL
// (the deploy never deletes). Safe to delete from the server once confirmed.

http_response_code(410);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => false,
    'error' => [
        'code' => 'gone',
        'message' => 'This endpoint has been removed.',
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
