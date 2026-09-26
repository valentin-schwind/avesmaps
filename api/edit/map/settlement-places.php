<?php

declare(strict_types=1);

// POST /api/edit/map/settlement-places.php -- gespeicherte Staetten (Innerorts-Objekte ohne
// Kartenposition) eines Ortes auflisten, loeschen und an einen anderen Ort haengen.
// Entwurf: docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md §4
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 KEIN PROTOKOLLEINTRAG im Fenster „Änderungen" -- Owner-Entscheid 4 im Entwurf, bewusst, nicht
// vergessen (§4, letzte Zeile).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/settlement-places.php';

/**
 * Die Staetten-Liste eines Ortes samt „gleichnamig auf der Karte" -- der EINE Trichter, den `list`,
 * `delete` und `move` gemeinsam rufen, damit der Hinweis nicht dreimal einzeln gerechnet wird und
 * dabei auseinanderlaeuft.
 *
 * @return list<array{public_id:string, name:string, place_type:string, wiki_url:string, origin:string, gleichnamig_auf_der_karte:bool}>
 */
function avesmapsStaettenEndpunktListe(PDO $pdo, string $ortId): array
{
    $staetten = avesmapsSettlementPlaceListForSettlement($pdo, $ortId);
    $namensnachbarn = avesmapsSettlementPlaceNamensnachbarn($pdo, $ortId);

    $raus = [];
    foreach ($staetten as $staette) {
        $schluessel = strtolower(trim((string) ($staette['name'] ?? '')));
        $staette['gleichnamig_auf_der_karte'] = $schluessel !== '' && isset($namensnachbarn[$schluessel]);
        $raus[] = $staette;
    }

    return $raus;
}

/**
 * Der Ort einer Staette -- gelesen VOR dem Deaktivieren, denn danach soll genau die Liste DIESES
 * Ortes zurueckgehen. Bewusst hier und nicht in der Bibliothek (Controller-Entscheid): eine reine
 * Ein-Spalten-Abfrage, die ausser diesem Endpunkt niemand braucht.
 *
 * ⚠️ Ohne `is_active`-Filter -- auch eine bereits zurueckgenommene Zeile traegt noch ihren Ort, und
 * `avesmapsSettlementPlaceDeactivate` entscheidet ohnehin allein, ob es ueberhaupt eine Aenderung gab.
 */
function avesmapsStaettenEndpunktOrtDerStaette(PDO $pdo, string $publicId): string
{
    try {
        $statement = $pdo->prepare('SELECT settlement_public_id FROM settlement_place WHERE public_id = :pid');
        $statement->execute(['pid' => $publicId]);

        return (string) ($statement->fetchColumn() ?: '');
    } catch (PDOException) {
        // Ohne Tabelle gibt es keinen Ort zu lesen -- avesmapsSettlementPlaceDeactivate meldet
        // gleich darauf ohnehin `false`.
        return '';
    }
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Stätten nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $userId = (int) ($user['id'] ?? 0);
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($action === 'list') {
        $ortId = trim((string) ($payload['settlement_public_id'] ?? ''));
        if ($ortId === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Der Ort fehlt.');
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'staetten' => avesmapsStaettenEndpunktListe($pdo, $ortId),
        ]);
    }

    if ($action === 'delete') {
        $publicId = trim((string) ($payload['public_id'] ?? ''));
        if ($publicId === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Die Stätte fehlt.');
        }

        // DDL committet in MySQL implizit -- der Ensure steht deshalb VOR jedem Schreibaufruf,
        // nie in einer Transaktion (AGENTS.md §10).
        avesmapsSettlementPlaceEnsureSchema($pdo);
        $ortId = avesmapsStaettenEndpunktOrtDerStaette($pdo, $publicId);

        if (!avesmapsSettlementPlaceDeactivate($pdo, $publicId, $userId)) {
            avesmapsErrorResponse(404, 'not_found', 'Die Stätte gibt es nicht (mehr).');
        }

        avesmapsJsonResponse(200, [
            'ok' => true,
            'staetten' => avesmapsStaettenEndpunktListe($pdo, $ortId),
        ]);
    }

    if ($action === 'move') {
        $publicId = trim((string) ($payload['public_id'] ?? ''));
        $zielId = trim((string) ($payload['ziel_public_id'] ?? ''));
        if ($publicId === '' || $zielId === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Stätte und Ziel fehlen.');
        }

        // avesmapsSettlementPlaceMove ruft avesmapsSettlementPlaceEnsureSchema selbst VOR seiner
        // Transaktion (siehe die Bibliothek) -- kein zweiter Aufruf hier noetig.
        $ergebnis = avesmapsSettlementPlaceMove($pdo, $publicId, $zielId, $userId);

        if ($ergebnis['ok'] !== true) {
            $statusByCode = [
                'not_found' => 404,
                'invalid_target' => 422,
                'name_taken' => 409,
                'name_taken_deleted' => 409,
            ];
            $code = (string) $ergebnis['code'];
            $status = $statusByCode[$code] ?? 400;
            avesmapsErrorResponse($status, $code, (string) $ergebnis['message']);
        }

        avesmapsJsonResponse(200, [
            'ok' => true,
            'staetten' => avesmapsStaettenEndpunktListe($pdo, (string) $ergebnis['alter_ort']),
            'ziel_name' => $ergebnis['ziel_name'],
        ]);
    }

    if ($action === 'orte') {
        $q = trim((string) ($payload['q'] ?? ''));
        avesmapsJsonResponse(200, [
            'ok' => true,
            'orte' => avesmapsSettlementPlaceOrteSuchen($pdo, $q),
        ]);
    }

    avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
} catch (Throwable $error) {
    // 🔴 NIE getMessage() -- ein Editor-Endpunkt gibt keinen Ausnahmetext an den Client weiter
    // (AGENTS.md §10, „info disclosure").
    avesmapsErrorResponse(500, 'server_error', 'Die Stätten konnten nicht verarbeitet werden.');
}
