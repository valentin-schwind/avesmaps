<?php

declare(strict_types=1);

// GET /api/edit/migration/media-export.php   -- NUR ADMIN (Sitzung)
//   -> { ok:true, map_revision:int, media_revision:string, switches:{…}, counts:{…},
//        items:[ { …die Felder von Export A…, stored_url, source_url, legacy_source, license_text, author, attribution,
//                  note, uploaded_by, uploaded_at, shown, legacy_form, override_keys } ],
//        game_literature:[ { public_id, wiki_key, …, places:[ { …, origin, status } ], links:[ … ] } ],
//        citymaps:[ { public_id, wiki_key, …, article:{…}, places:[ … ], links:[ … ] } ] }
//
// Export B, der private Migrationsexport (Legacy-Export E5 und E5+, Auftrag Avesmaps3D 04.10.2026; Media-Core-Plan
// §9.2): ALLE Medien samt nicht oeffentlicher, Unterdrueckungen (`coat_none`, leerer Gebiets-Override, unterdrueckte
// Karten und Werke), roher Rechtecodes, Rechtenotizen, Urheber und Hochladestempel -- dazu die Migrationsbloecke der
// Literatur und der Kartensammlung (Ortsbezuege und Fundorte mit Herkunft und Zustand, auch die unterdrueckten;
// Bauschluessel und Wiki-Artikel-Zuordnung der Karten). Regeln: api/_internal/app/medien-export.php.
//
// 🔴 HINTER DER ADMIN-PRUEFUNG, VOR DEM LESEN. Die Antwort traegt Login-Namen (`uploaded_by`) und interne Notizen
// (Prompts, Rechtenotizen). Derselbe Schutz wie die uebrigen Migrations- und Admin-Pfade (api/edit/admin/*.php:
// Faehigkeit `admin`); ohne Keks kommt die 401 ohne neue Sitzung. Abruf laut Auftrag einmal je Zug durch den Betreiber
// oder die Legacy-Sitzung; Avesmaps3D bekommt die Datei, nie eine Anmeldung.
// 🔴 Nur GET, kein Schreibweg, kein DDL. `Cache-Control: private` -- in keinem geteilten Zwischenspeicher.

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/medien-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Migrationsexport nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Migrationsexport erlaubt.');
    }

    avesmapsRequireUserWithCapabilityOhneNeueSitzung('admin');

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsMedienExportLesen($pdo, true);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'media-migration', true);
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Medien');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Der Migrationsexport konnte nicht geladen werden.');
}
