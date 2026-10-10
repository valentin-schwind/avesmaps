<?php

declare(strict_types=1);

// GET /api/app/staetten-rohquellen-export.php
//   -> { ok:true, map_revision:int, aliase_stempel:string, quellen_stand:string,
//        kopf:{ punkte:{ok, zeilen}, gespeicherte:{ok, zeilen},
//               wege:{ok, zeilen, linkziele, linkziele_ohne_schluessel},
//               sitze:{ok, zeilen, organisationen, linkziele, linkziele_ohne_schluessel, neuester_abgleich},
//               stadtteile:{ok, zeilen, linkziele, linkziele_ohne_schluessel, neuester_abgleich} },
//        punkte:[ { public_id, name, ortsklasse, art, wiki_url, wiki_key, aktiv, von_der_karte, innerorts_ort,
//                   innerorts_herkunft } ],
//        gespeicherte:[ { public_id, name, art, ort_public_id, wiki_url, wiki_key, quelle } ],
//        wege:[ { weg_key, titel, name, art, wiki_url, wiki_key, lage_roh, lage_links:[{ziel, ziel_key}] } ],
//        sitze:[ { organisation, organisation_art, rolle, reihenfolge, ort_roh, ort_links:[{ziel, ziel_key}], wiki_url,
//                  wiki_key } ],
//        stadtteile:[ { titel, standort, standort_links:[{ziel, ziel_key}], wiki_url } ] }
//
// X4 der Auftraege von Avesmaps3D (10.10.2026, WI-0134): die Rohzeilen der Quellen, aus denen Legacy seine Staettenliste
// `in_settlement_places` zusammensetzt -- je mit Legacys eigener Kennung, ohne Urteil, ohne Entdoppeln, ohne abgeleitete
// Stadt, mit `ok` je Quelle. Oeffentlich und nur lesend. Alles Weitere: api/_internal/app/staetten-rohquellen-export.php.
//
// 🔴 Keine Sitzung, kein Schreibweg, kein DDL.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/staetten-rohquellen-export.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Rohquellen der Staetten nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer den Export der Staetten erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $antwort = avesmapsStaettenRohquellenLesen($pdo);

    // Kopfzeilen, bedingtes Abrufen und Rumpf -- erst NACH dem Lesen (Begruendung in export-rahmen.php).
    avesmapsExportSenden($antwort, 'staetten-rohquellen');
} catch (AvesmapsExportInBewegung) {
    avesmapsExportInBewegungAntworten('Die Staetten');
} catch (Throwable) {
    // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Die Rohquellen der Staetten konnten nicht geladen werden.');
}
