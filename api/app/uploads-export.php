<?php

declare(strict_types=1);

// GET /api/app/uploads-export.php
//   -> { ok:true, uploads_revision:string, counts:{files:int, bytes:int}, truncated:bool,
//        items:[ { path, bytes, mtime } ] }
//
// Die Aufzaehlung von `uploads/` (Legacy-Export E6, Auftrag Avesmaps3D 05.10.2026, WI-0086): EIN GET
// beantwortet die Frage „was hat sich in uploads/ geaendert?", damit Avesmaps3D nur noch holt, was neu
// oder anders ist -- statt 2.483 bedingter Abrufe je Pruefung. Keine Bytes, keine SHA-256.
// Welche Dateien gelistet werden und welche nie: api/_internal/app/uploads-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL -- und als einziger Export auch keine Datenbank.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/uploads-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Dateiliste laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Uploads-Export erlaubt.');
    }

    $antwort = avesmapsUploadsExportLesen();

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'uploads-export');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Dateien in uploads/');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Dateiliste konnte nicht geladen werden.');
}
