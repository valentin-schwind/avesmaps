<?php

declare(strict_types=1);

// GET /api/app/wiki-siedlungen-export.php
//   -> { ok:true, map_revision:int, aliase_stempel:string, registry_revision:string,
//        kopf:{ registry_zeilen, siedlungen, andere_klassen, je_klasse:{ <klasse>:int }, ohne_schluessel,
//               verschiedene_schluessel, mit_ort, ohne_ort, legacy_auf_karte, bauwerkstyp_ausgeschlossen },
//        siedlungen:[ { titel, wiki_key, ns, ns_name, weiterleitung_auf, wiki_url, ortsklasse, ortsklasse_label,
//                       bauwerkstyp, bauwerkstyp_ausgeschlossen, ist_ruine, kontinent, lage, standort, hat_wappen,
//                       abgerufen_am, angereichert_am, orte:[public_id], legacy_auf_karte } ] }
//
// X3 der Auftraege von Avesmaps3D (10.10.2026): die Registry der Wiki-Siedlungen (`wiki_sync_pages`) mit dem Wiki-Key
// jeder Zeile (dieselbe Regel wie X1 und X2) und den Orten, denen dieser Key zugewiesen ist -- die Grundlage fuer
// „im Wiki, nicht auf der Karte". Oeffentlich und nur lesend. Alles Weitere: api/_internal/app/wiki-siedlungen-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/wiki-siedlungen-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Wiki-Siedlungen nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Export der Wiki-Siedlungen erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsWikiSiedlungenExportLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'wiki-siedlungen');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Wiki-Siedlungen');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Wiki-Siedlungen konnten nicht geladen werden.');
}
