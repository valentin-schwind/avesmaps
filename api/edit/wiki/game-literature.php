<?php

declare(strict_types=1);

// Der LESEENDPUNKT des Literatur-Wiki-Katalogs: die Trefferquelle der Wiki-Zuweisung im
// Literatur-Editor (Aufgabe 8 des Umbaus, Entwurf
// docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md).
//
// 🔴 EIGENE DATEI, NICHT EIN ARM VON api/edit/map/game-literature.php -- und das ist gemessen, nicht
// Geschmack: jene Datei ist POST-only (ihr `match` liest `$payload['action']`, :35/:39), das geteilte
// Bauteil (js/ui/wiki-assign.js, `trefferHolen`) aber holt seine Treffer per GET. Und sie gehoert der
// KARTENSEITE (Schreibwege auf `adventure`), waehrend hier ausschliesslich der WIKI-STAGING-Katalog
// gelesen wird -- dieselbe Trennung, die api/edit/wiki/{paths,regions,settlements}.php schon
// vorzeichnen. Diese drei sind das Vorbild, Zeile fuer Zeile.
//
// ⚠️ Faehigkeit `review` wie bei allen drei Schwestern, NICHT `edit`. Gelesen wird Staging, geschrieben
// gar nichts; wer die Wege-, Regionen- und Siedlungskataloge durchsuchen darf, darf auch diesen. Der
// Schreibweg dahinter (api/edit/map/game-literature.php) verlangt weiterhin `edit`, daran aendert sich
// nichts.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/political/territory.php';       // avesmapsPoliticalSlug
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';         // avesmapsWikiSyncMonitorNormalizeTitle
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';     // Schluesselfaltung + Publikationskatalog
require_once __DIR__ . '/../../_internal/app/game-literature.php';       // avesmapsGameLiteratureEnsureTables
require_once __DIR__ . '/../../_internal/wiki/game-literature-sync.php'; // Suche + Katalogsatz

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Literatur-Katalog nicht lesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        // 🔴 NUR GET. Geschrieben wird die Zuweisung ueber `upsert_adventure`
        // (api/edit/map/game-literature.php) -- ein zweiter Schreibweg auf dieselbe Zeile waere genau
        // die Divergenz, gegen die dieser ganze Umbau gebaut ist.
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    // 🔴 HIER, nicht in der Suche: die drei DDLs sind MySQL, und nur so bleibt die Suche selbst gegen
    // SQLite pruefbar (Begruendung ausgeschrieben bei avesmapsWikiGameLiteratureEnsureSearchTables).
    // Auf einer frischen Installation ohne Dump-Lauf steht danach eine leere Trefferliste da -- und
    // nicht ein 500er, den niemand von „es gibt diesen Artikel nicht" unterscheiden kann.
    avesmapsWikiGameLiteratureEnsureSearchTables($pdo);

    $action = trim((string) ($_GET['action'] ?? 'search'));

    $response = match ($action) {
        // Dieselbe Adresse und dasselbe Limit wie die drei Schwestern; das Bauteil schickt
        // `?action=search&q=…&limit=40`.
        'search', '' => avesmapsWikiGameLiteratureSearch(
            $pdo,
            (string) ($_GET['q'] ?? ''),
            (int) ($_GET['limit'] ?? 30)
        ),
        // Der Stand einer BEREITS zugewiesenen Literatur. Warum es diesen Arm nur hier gibt, steht
        // ausgeschrieben bei avesmapsWikiGameLiteratureEntry: `adventure` hat kein Wiki-Nest.
        'entry' => avesmapsWikiGameLiteratureEntry($pdo, (string) ($_GET['wiki_key'] ?? '')),
        default => null,
    };

    if ($response === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Literatur-Katalog-Action: ' . $action);
    }

    avesmapsJsonResponse(200, $response);
} catch (PDOException) {
    // 💣 PDOException MUSS vor RuntimeException stehen (sie erbt davon) -- sonst traegt eine
    // Datenbankmeldung die Fehlerausgabe nach draussen. Dieselbe Reihenfolge wie in den drei
    // Schwestern.
    avesmapsErrorResponse(500, 'server_error', 'Der Literatur-Katalog konnte nicht gelesen werden.');
} catch (AvesmapsWikiUnreachableException $error) {
    // Das Wiki hat nicht geantwortet -- ein eigener Fall, kein Serverfehler. Fertig formulierter
    // Satz ohne Interna, 503 weil die Ursache draussen liegt. Begruendung samt Reihenfolge-Falle:
    // api/edit/wiki/settlements.php.
    avesmapsErrorResponse(503, 'wiki_unreachable', $error->getMessage());
} catch (RuntimeException $error) {
    avesmapsErrorResponse(400, 'invalid_request', $error->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Der Literatur-Katalog konnte nicht gelesen werden.');
}
