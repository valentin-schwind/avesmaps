<?php

declare(strict_types=1);

// Der LESEENDPUNKT der Wiki-Seitenregistry fuer die KARTEN (Stadtplaene): die Trefferquelle der
// Wiki-Zuweisung im Karten-Editor (Aufgabe 9 des Umbaus, Entwurf
// docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
//
// 🔴 EIGENE DATEI, NICHT EIN ARM VON api/edit/map/citymaps.php -- und das ist gemessen, nicht
// Geschmack: jene Datei ist POST-only (sie antwortet auf alles andere mit 405, :29) und ihr `match`
// liest `$payload['action']`; das geteilte Bauteil (js/ui/wiki-assign.js, `trefferHolen`) holt seine
// Treffer per GET. Und sie gehoert der KARTENSEITE (Schreibwege auf `citymap`), waehrend hier
// ausschliesslich die WIKI-Registry gelesen wird -- dieselbe Trennung, die
// api/edit/wiki/{paths,regions,settlements,game-literature}.php schon vorzeichnen.
//
// ⚠️ Faehigkeit `review` wie bei allen vier Schwestern, NICHT `edit`. Gelesen wird Staging,
// geschrieben gar nichts; der Schreibweg dahinter (api/edit/map/citymaps.php, `upsert_citymap`)
// verlangt weiterhin `edit`.
//
// 💣 WAS HIER NICHT GESUCHT WIRD, und das ist die Falle dieser Objektart: NICHT der Bauschluessel
// `citymap.wiki_key` (`index:stadt:quelle:variante`, avesmapsCitymapWikiKey) und NICHT die
// Publikation hinter `citymap.map_url`. Beide gehoeren dem laufenden Karten-Abgleich und bleiben
// unangetastet; gesucht wird der EIGENE Artikel der Karte. Die volle Messung steht an den Spalten in
// avesmapsCitymapsEnsureTables (api/_internal/app/citymaps.php).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';            // avesmapsWikiSyncEnsureLocationTables
require_once __DIR__ . '/../../_internal/political/territory.php';       // avesmapsPoliticalSlug
require_once __DIR__ . '/../../_internal/wiki/settlements.php';          // Schema + Klassen-Label
require_once __DIR__ . '/../../_internal/wiki/citymap-article.php';      // die Suche selbst

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Wiki-Registry nicht lesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        // 🔴 NUR GET. Geschrieben wird die Zuweisung ueber `upsert_citymap`
        // (api/edit/map/citymaps.php) -- ein zweiter Schreibweg auf dieselbe Zeile waere genau die
        // Divergenz, gegen die dieser ganze Umbau gebaut ist.
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    // 🔴 HIER, nicht in der Suche: das Schema ist MySQL samt information_schema, und nur so bleibt
    // die Suche selbst gegen SQLite pruefbar (dieselbe Trennung wie bei api/edit/wiki/
    // game-literature.php). Auf einer frischen Installation ohne Dump-Lauf steht danach eine leere
    // Trefferliste da -- und nicht ein 500er, den niemand von „es gibt diesen Artikel nicht"
    // unterscheiden kann.
    avesmapsWikiSyncEnsureLocationTables($pdo);
    avesmapsWikiSettlementEnsureSchema($pdo);

    $action = trim((string) ($_GET['action'] ?? 'search'));

    $response = match ($action) {
        // Dieselbe Adresse und dasselbe Limit wie die vier Schwestern; das Bauteil schickt
        // `?action=search&q=…&limit=40`.
        'search', '' => avesmapsWikiCitymapArticleSearch(
            $pdo,
            (string) ($_GET['q'] ?? ''),
            (int) ($_GET['limit'] ?? 40)
        ),
        // Der Stand eines BEREITS zugewiesenen Artikels. Warum es diesen Arm braucht, steht
        // ausgeschrieben bei avesmapsWikiCitymapArticleEntry: `citymap` hat kein Wiki-Nest, gespeichert
        // ist nur die Identitaet -- die Anzeigewerte des Kastens stehen in der Registry.
        'entry' => avesmapsWikiCitymapArticleEntry($pdo, (string) ($_GET['title'] ?? '')),
        default => null,
    };

    if ($response === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Karten-Registry-Action: ' . $action);
    }

    avesmapsJsonResponse(200, $response);
} catch (PDOException) {
    // 💣 PDOException MUSS vor RuntimeException stehen (sie erbt davon) -- sonst traegt eine
    // Datenbankmeldung die Fehlerausgabe nach draussen. Dieselbe Reihenfolge wie in den Schwestern.
    avesmapsErrorResponse(500, 'server_error', 'Die Wiki-Registry konnte nicht gelesen werden.');
} catch (RuntimeException $error) {
    avesmapsErrorResponse(400, 'invalid_request', $error->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Wiki-Registry konnte nicht gelesen werden.');
}
