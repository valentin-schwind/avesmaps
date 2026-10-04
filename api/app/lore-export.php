<?php

declare(strict_types=1);

// GET /api/app/lore-export.php
//   -> { ok:true, map_revision:int, lore_revision:string, kinds_enabled:{…}, counts:{…},
//        entries:[ … ], places:[ … ], rules:[ { …, terms:[ { …, region_types:[…] } ] } ], sources:[ … ], links:[ … ] }
//
// Natur & Waren vollstaendig (Legacy-Export E2 und E2+, Auftrag Avesmaps3D 04.10.2026): Eintraege, Ortszeilen,
// Verbreitungsregeln und die Quellenverknuepfungen der Vorkommen samt Herkunft und Zustand -- auch der
// unterdrueckten. Was hinausgeht und warum: api/_internal/app/lore-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL, keine Personenspalte.
// ⚠️ Gross (tausende Eintraege samt Merkmalen, zehntausende Quellenverknuepfungen) -- auf Zuruf holen, nie in einer
// Schleife (CLAUDE.md, STRATO).

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/lore-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Vorkommen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Lore-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsLoreExportLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'lore-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Vorkommen');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Vorkommen konnten nicht geladen werden.');
}
