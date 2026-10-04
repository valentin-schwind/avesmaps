<?php

declare(strict_types=1);

// GET /api/app/feature-sources-export.php
//   -> { ok:true, map_revision:int, sources_revision:string, counts:{…},
//        corpora:[ … ], sources:[ … ], links:[ … ] }
//
// Der Migrationsblock der Quellen (Legacy-Export E1+, Auftrag Avesmaps3D 04.10.2026): der Katalog samt Identitaet
// (`url_hash`, `wiki_key`), die Korpora und ALLE Verknuepfungen ausser denen der Vorkommen -- genehmigte UND von
// Hand unterdrueckte, je mit Herkunft (`origin`) und Zustand (`status`), in Legacys Anzeigereihenfolge. Die
// Vorkommen (`lore`) reisen im Lore-Export (api/app/lore-export.php). Welche Felder und warum:
// api/_internal/app/quellen-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL. Oeffentlich, weil nichts darin eine Person nennt: die
// Editorenkennungen (`created_by`, `updated_by`) stehen nicht auf der Positivliste.
// ⚠️ Gross (alle Verknuepfungen, mehrere MB) -- ein Werkzeug holt ihn auf Zuruf, nie in einer Schleife
// (CLAUDE.md, STRATO).

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/quellen-export.php';

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
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Quellen-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsFeatureSourcesExportLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'src-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Quellen');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht geladen werden.');
}
