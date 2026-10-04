<?php

declare(strict_types=1);

// GET /api/app/media-export.php
//   -> { ok:true, map_revision:int, media_revision:string, switches:{…}, counts:{…},
//        items:[ { legacy_media_key, media_class, subject_kind, subject_public_id, role, sort_order, local_url, origin,
//                  legacy_rights_code, legacy_public, suppressed } ] }
//
// Export A, das oeffentliche Medien-Manifest (Legacy-Export E5, Auftrag Avesmaps3D 04.10.2026; Media-Core-Plan §9.1):
// genau die Medien, die Legacy heute jedem zeigt -- Lizenz-Gate bestanden, Schalter an, Objekt oeffentlich. Ohne
// Notizen, Prompts, Urheber, Hochladestempel und Editorenkennungen; ohne `thumb_auto_url`. Den privaten Rest traegt
// Export B (api/edit/migration/media-export.php, nur Admin). Klassen, Schluessel und Regeln:
// api/_internal/app/medien-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/medien-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Medienliste laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Medien-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsMedienExportLesen($pdo, false);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'media-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Medien');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Medienliste konnte nicht geladen werden.');
}
