<?php

declare(strict_types=1);

// GET /api/app/location-reviews-export.php
//   -> { ok:true, map_revision:int, reviews_revision:string,
//        counts:{ total, visible, hidden, spam, orphaned_location_ids, orphaned_reviews },
//        reviews:[ { id, location_public_id, location_name, location_active, author_name, stars, body, dsa_date,
//                    created_at } ] }
//
// Alle SICHTBAREN Bewertungen in einer Antwort (Legacy-Export E3, Auftrag Avesmaps3D 04.10.2026). Verborgene und
// Spam nur als Zahl, nie als Zeile; `ip_hash`, `user_agent` und `request_origin` nie. Begruendung:
// api/_internal/app/bewertungen-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/bewertungen-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Bewertungen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Bewertungs-Export erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsBewertungenExportLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'rev-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Bewertungen');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Bewertungen konnten nicht geladen werden.');
}
