<?php

declare(strict_types=1);

// POST /api/edit/map/settlement-places.php -- die Staetten eines Ortes auflisten, loeschen und an einen
// anderen Ort haengen: gespeicherte Staetten (Innerorts-Objekte ohne Kartenposition) UND seit dem
// 27.09.2026 innerorts-PUNKTE (Stadtviertel/Bauwerke mit `properties.innerorts`, aktiv oder von der
// Karte genommen).
// Entwurf: docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md §4
//          docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §4.2, §5, §6.3
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 KEIN PROTOKOLLEINTRAG fuer gespeicherte Staetten -- Owner-Entscheid 4 im Entwurf, bewusst, nicht
// vergessen (§4, letzte Zeile). Ein innerorts-PUNKT ist dagegen ein Kartenobjekt: seine Gesten
// protokolliert die Bibliothek (api/_internal/app/innerorts.php), damit „Rueckgaengig" im
// Aenderungsverlauf sie zurueckholt.
//
// 💣 „Staette oder Punkt?" entscheidet die KENNUNG: erst `settlement_place`, dann `map_features`.
// Eine public_id gehoert genau einer der beiden Tabellen.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/settlement-places.php';
// Fuer die Punkte: Sperre, Revision, Protokoll, Kraftlinien-Riegel und die Antwortform eines Punktes.
// Laedt innerorts.php + innerorts-anschluss.php mit.
require_once __DIR__ . '/../../_internal/map/features.php';

/**
 * Die Staetten-Liste eines Ortes samt „gleichnamig auf der Karte" -- der EINE Trichter, den `list`,
 * `delete`, `move` und `put_on_map` gemeinsam rufen, damit der Hinweis nicht mehrfach einzeln
 * gerechnet wird und dabei auseinanderlaeuft.
 *
 * Seit 27.09.2026 stehen die innerorts-PUNKTE dieses Ortes dahinter (`art: 'punkt'`, Spec §6.3); die
 * Zeilen der gespeicherten Staetten bleiben Feld fuer Feld, wie sie waren.
 *
 * @return list<array<string,mixed>>
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

    foreach (avesmapsInnerortsPunkteEinerStadt($pdo, $ortId) as $punkt) {
        $raus[] = $punkt;
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

/**
 * Die Absage einer Bibliotheksfunktion (`{ok:false, code, message}`) als HTTP-Antwort -- EINE Tafel
 * fuer alle Aktionen, damit derselbe Code nicht an zwei Stellen zwei Status bekommt.
 */
function avesmapsStaettenEndpunktAbsage(array $ergebnis): never
{
    $statusByCode = [
        'not_found' => 404,
        'invalid_target' => 422,
        'name_taken' => 409,
        'name_taken_deleted' => 409,
        // Innerorts-Punkte: falscher Zustand (z. B. „noch auf der Karte") und fremde Sperre.
        'invalid_state' => 409,
        'conflict' => 409,
    ];
    $code = (string) ($ergebnis['code'] ?? 'invalid_request');
    avesmapsErrorResponse($statusByCode[$code] ?? 400, $code, (string) ($ergebnis['message'] ?? 'Die Aktion ist nicht möglich.'));
}

/**
 * Sperre eines Punkts pruefen, BEVOR eine Geste ihn anfasst -- wie bei jeder Kartenbearbeitung.
 * DDL (der Ensure der Sperrtabelle) steht vor jeder Transaktion (AGENTS.md §10).
 */
function avesmapsStaettenEndpunktPunktSperre(PDO $pdo, array $payload, string $publicId, array $user): void
{
    avesmapsEnsureMapFeatureLocksTableEinmal($pdo);
    $sperre = avesmapsInnerortsSperreFehler($pdo, $payload, $publicId, $user);
    if ($sperre !== null) {
        avesmapsStaettenEndpunktAbsage($sperre);
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

        // Ein innerorts-PUNKT: „✕ endgueltig loeschen" nimmt nur den Merker -- der Punkt bleibt
        // geloescht und ist danach auch keine Staette mehr. Ein Punkt AUF der Karte wird hier nicht
        // geloescht (invalid_state): das geschieht auf der Karte, wo man sieht, was man loescht.
        if (!avesmapsSettlementPlaceExists($pdo, $publicId) && avesmapsInnerortsIstPunkt($pdo, $publicId)) {
            avesmapsStaettenEndpunktPunktSperre($pdo, $payload, $publicId, $user);
            $ortId = avesmapsInnerortsOrtDesPunkts($pdo, $publicId);
            $ergebnis = avesmapsInnerortsEndgueltigEntfernen($pdo, $publicId, $userId);
            if ($ergebnis['ok'] !== true) {
                avesmapsStaettenEndpunktAbsage($ergebnis);
            }
            avesmapsJsonResponse(200, [
                'ok' => true,
                'staetten' => avesmapsStaettenEndpunktListe($pdo, $ortId),
            ]);
        }

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

        // Ein innerorts-PUNKT: „⇄" setzt `innerorts.ort` mit Herkunft `manual` (Spec §6.3).
        if (!avesmapsSettlementPlaceExists($pdo, $publicId) && avesmapsInnerortsIstPunkt($pdo, $publicId)) {
            avesmapsStaettenEndpunktPunktSperre($pdo, $payload, $publicId, $user);
            $ergebnis = avesmapsInnerortsOrtSpeichern($pdo, $publicId, $zielId, $userId);
        } else {
            // avesmapsSettlementPlaceMove ruft avesmapsSettlementPlaceEnsureSchema selbst VOR seiner
            // Transaktion (siehe die Bibliothek) -- kein zweiter Aufruf hier noetig.
            $ergebnis = avesmapsSettlementPlaceMove($pdo, $publicId, $zielId, $userId);
        }

        if ($ergebnis['ok'] !== true) {
            avesmapsStaettenEndpunktAbsage($ergebnis);
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

    if ($action === 'put_on_map') {
        // „● Auf die Karte setzen" (Spec §4.2) -- derselbe Server-Weg wie die Kartenaktion
        // `put_on_map` in api/edit/map/features.php (avesmapsInnerortsAufDieKarteSetzen).
        $publicId = trim((string) ($payload['public_id'] ?? ''));
        if ($publicId === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'Der Punkt fehlt.');
        }
        avesmapsStaettenEndpunktPunktSperre($pdo, $payload, $publicId, $user);
        $ergebnis = avesmapsInnerortsAufDieKarteSetzen($pdo, $publicId, $userId);
        if ($ergebnis['ok'] !== true) {
            avesmapsStaettenEndpunktAbsage($ergebnis);
        }
        $zeile = avesmapsInnerortsZeileLesen($pdo, $publicId);
        $ortId = avesmapsInnerortsOrtDesPunkts($pdo, $publicId);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'staetten' => avesmapsStaettenEndpunktListe($pdo, $ortId),
            // Der wieder aktive Punkt in der Form jedes anderen Punktes -- die Karte setzt ihn ohne
            // Neuladen und fliegt hin.
            'feature' => $zeile !== null ? avesmapsBuildFeatureResponseFromStoredFeature($zeile) : null,
        ]);
    }

    if ($action === 'innerorts_wiki_stand') {
        // Fuer „Ort bearbeiten": der Dialog liest seinen Punkt aus der Kartennutzlast, die weder den
        // Namen der Stadt noch den Wiki-Stand traegt (gespeichert ist nur die Kennung, Spec §3).
        $publicId = trim((string) ($payload['public_id'] ?? ''));
        $zeile = $publicId !== '' ? avesmapsInnerortsZeileLesen($pdo, $publicId) : null;
        if ($zeile === null || (string) ($zeile['feature_type'] ?? '') !== 'location') {
            avesmapsErrorResponse(404, 'not_found', 'Der Punkt wurde nicht gefunden.');
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'innerorts' => avesmapsInnerortsEditorStand(
                $pdo,
                avesmapsInnerortsPropertiesDekodieren($zeile['properties_json'] ?? null) ?? [],
                (string) ($zeile['feature_subtype'] ?? '')
            ),
        ]);
    }

    if ($action === 'innerorts_aus_wiki') {
        // Schreiber 3 (Spec §5): den Wiki-Stand fuer den Bestand eintragen. NUR Admins; Trockenlauf
        // ist die Vorgabe, scharf nur mit `apply: true` -- dieselbe Bauform wie `seehafen_aus_seewegen`.
        if (!avesmapsUserCan($user, 'admin')) {
            avesmapsErrorResponse(403, 'forbidden', 'Der Lauf „Innerorts aus dem Wiki" ist Admins vorbehalten.');
        }
        $scharf = ($payload['apply'] ?? false) === true;
        $limit = max(1, min(500, (int) ($payload['limit'] ?? 200)));
        avesmapsJsonResponse(200, ['ok' => true] + avesmapsInnerortsAusWikiLauf($pdo, $scharf, $limit, $userId));
    }

    avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
} catch (Throwable $error) {
    // 🔴 NIE getMessage() -- ein Editor-Endpunkt gibt keinen Ausnahmetext an den Client weiter
    // (AGENTS.md §10, „info disclosure").
    avesmapsErrorResponse(500, 'server_error', 'Die Stätten konnten nicht verarbeitet werden.');
}
