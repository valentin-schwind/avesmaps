<?php

declare(strict_types=1);

// GET /api/app/wiki-redirects-export.php
//   -> { ok:true, redirects_revision:string, count:int, redirects:[ { alias_slug, canonical_wiki_key } ] }
//
// Die Weiterleitungen der Wiki Aventurica, wie Legacy sie beim Wiki-Abgleich ablegt (Legacy-Export E1++, Auftrag
// Avesmaps3D 04.10.2026). Bibliothek und Begruendung: api/_internal/app/wiki-weiterleitungen-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL. Nichts darin nennt eine Person.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/wiki-weiterleitungen-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Weiterleitungen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Weiterleitungs-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsWikiWeiterleitungenExportLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'redir-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Weiterleitungen');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Weiterleitungen konnten nicht geladen werden.');
}
