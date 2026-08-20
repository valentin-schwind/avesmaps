<?php

declare(strict_types=1);

// Authed Endpoint der Siedlungs-WikiSync-VERBINDUNG. Verbindet Orts-Features mit ihrem
// Wiki-Datensatz ({{Infobox Siedlung}}). Additiv — die bestehende Fall-Review (sync.php /
// review-wiki-sync.js) bleibt unberührt. Cap 'review'. Nutzt die Registry wiki_sync_pages
// als Such-Quelle (kein eigener Crawl); Infobox wird beim Zuordnen on-demand geladen.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/settlements.php';
require_once __DIR__ . '/../../_internal/wiki/settlements-coat-localize.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Siedlungs-Sync nicht verwenden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'POST') {
        $payload = avesmapsReadJsonRequest();
        $action = trim((string) ($payload['action'] ?? ($_GET['action'] ?? '')));
        $isApply = static fn(): bool => ($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply';

        $response = match ($action) {
            'assign_to' => avesmapsWikiSettlementAssignTo(
                $pdo,
                (string) ($payload['title'] ?? ''),
                (string) ($payload['public_id'] ?? ''),
                !$isApply(),
                (int) ($user['id'] ?? 0)
            ),
            'clear_assign' => avesmapsWikiSettlementClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !$isApply(),
                (int) ($user['id'] ?? 0)
            ),
            'bulk_connect' => avesmapsWikiSettlementBulkConnect(
                $pdo,
                (int) ($payload['limit'] ?? 100),
                !$isApply()
            ),
            'crawl_buildings' => avesmapsWikiSettlementCrawlBuildings($pdo),
            'crawl_building_types' => avesmapsWikiSettlementBuildingTypes($pdo),
            'crawl_building_type' => avesmapsWikiSettlementCrawlBuildingType($pdo, (string) ($payload['type'] ?? '')),
            'enrich_details', 'backfill_continents' => avesmapsWikiSettlementEnrichDetails(
                $pdo,
                (int) ($payload['limit'] ?? 100),
                !empty($payload['recheck_unknown'])
            ),
            'bulk_record_ruins' => avesmapsWikiSettlementBulkRecordRuins($pdo, !$isApply()),
            'bulk_record_coats' => avesmapsWikiSettlementBulkRecordCoats($pdo, !$isApply(), (int) ($payload['limit'] ?? 150)),
            // Copies the recorded public-domain coats off wiki-aventurica onto our server. No dry-run
            // pair like its neighbours: it writes files, so a "preview" would be the expensive half
            // anyway -- the bounded step IS the safety, and localize_coats_status answers "how many".
            'localize_coats' => avesmapsWikiSettlementLocalizeCoats(
                $pdo,
                (int) ($payload['limit'] ?? 10),
                (int) ($payload['sleep_ms'] ?? 150)
            ),
            'set_coat' => avesmapsWikiSettlementSetWikiCoat($pdo, (string) ($payload['public_id'] ?? ''), !$isApply(), (int) ($user['id'] ?? 0)),
            'clear_coat' => avesmapsWikiSettlementClearCoat($pdo, (string) ($payload['public_id'] ?? ''), !$isApply(), (int) ($user['id'] ?? 0)),
            'assign_territory' => avesmapsWikiSettlementAssignTerritory(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['territory_public_id'] ?? ''),
                !$isApply(),
                (int) ($user['id'] ?? 0)
            ),
            'bulk_assign_territories' => avesmapsWikiSettlementBulkAssignTerritories(
                $pdo,
                is_array($payload['pairs'] ?? null) ? $payload['pairs'] : [],
                (bool) ($payload['force'] ?? false),
                !$isApply(),
                (int) ($payload['limit'] ?? 200)
            ),
            'clear_territory' => avesmapsWikiSettlementClearTerritory($pdo, (string) ($payload['public_id'] ?? ''), !$isApply(), (int) ($user['id'] ?? 0)),
            // Global settlement-image kill switch (ribbon toggle). No public_id / dry_run -- always a real write.
            'set_images_enabled' => avesmapsSetSettlementImagesEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
            // Global settlement-COAT kill switch (second ribbon toggle). Same shape as the image one.
            'set_coats_enabled' => avesmapsSetSettlementCoatsEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
            default => null,
        };

        // map_features-Cache invalidieren, wenn echt geschrieben wurde.
        if (in_array($action, ['assign_to', 'clear_assign', 'bulk_connect', 'bulk_record_ruins', 'bulk_record_coats', 'set_coat', 'clear_coat', 'assign_territory', 'bulk_assign_territories', 'clear_territory'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }
        // The image kill switch flips what map-features emits -> always bump so cached clients revalidate.
        // Same for the coat switch: properties.coat disappears from the payload without any row changing.
        if (in_array($action, ['set_images_enabled', 'set_coats_enabled'], true) && is_array($response)) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        if ($response === null) {
            avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Siedlungs-Sync-POST-Action: ' . $action);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind erlaubt.');
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiSettlementStatus($pdo),
        'connect_status' => avesmapsWikiSettlementConnectStatus($pdo),
        'enrich_status', 'continent_status' => avesmapsWikiSettlementEnrichStatus($pdo),
        'ruin_status' => avesmapsWikiSettlementRuinStatus($pdo),
        'coat_status' => avesmapsWikiSettlementCoatStatus($pdo),
        'localize_coats_status' => ['ok' => true, 'counts' => avesmapsWikiSettlementCoatLocalizeCounts($pdo)],
        'coat_info' => avesmapsWikiSettlementCoatInfo($pdo, (string) ($_GET['public_id'] ?? '')),
        'list_locations' => avesmapsWikiSettlementListLocations($pdo),
        'settlement_editor_list' => avesmapsWikiSettlementEditorList($pdo),
        'settlement_detail' => avesmapsWikiSettlementDetail($pdo, (string) ($_GET['public_id'] ?? '')),
        'assignment' => avesmapsWikiSettlementGetAssignment($pdo, (string) ($_GET['public_id'] ?? '')),
        'search' => avesmapsWikiSettlementSearch($pdo, (string) ($_GET['q'] ?? ''), (int) ($_GET['limit'] ?? 30)),
        'preview' => ['ok' => true, 'settlement' => avesmapsWikiSettlementBuildFromTitle($pdo, (string) ($_GET['title'] ?? ''))],
        default => null,
    };

    if ($response === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Siedlungs-Sync-Action: ' . $action);
    }

    avesmapsJsonResponse(200, $response);
} catch (PDOException $error) {
    // 🔴 ZUERST, UND DAS IST DER GANZE GRUND FUER DIE REIHENFOLGE: PDOException ERBT von
    // RuntimeException. Stuende sie unter dem Zweig darunter, gingen SQLSTATE-Texte samt
    // Tabellen- und Spaltennamen an den Client (AGENTS.md §10, Meilenstein M1).
    // ⚠️ avesmapsServerErrorResponse statt avesmapsErrorResponse: derselbe Umschlag nach aussen
    // (500/server_error/"Internal server error."), zusaetzlich EINE Zeile im Serverprotokoll.
    // Vorher wurde $error gefangen und nie benutzt -- die Ausnahme verschwand spurlos, und genau
    // das machte Fall #84 unauffindbar. Der Helfer steht seit laengerem in bootstrap.php:409.
    avesmapsServerErrorResponse($error, 'wiki-settlements');
} catch (AvesmapsWikiUnreachableException $error) {
    // 🔴 WEDER UNSER FEHLER NOCH DER DES EDITORS -- das Wiki hat nicht geantwortet. Bis zum
    // 20.08.2026 fiel dieser Fall in den RuntimeException-Zweig darunter und ging als
    // 400/invalid_request mit „Wiki Aventurica konnte nicht gelesen werden. HTTP-Status: 0 URL: …"
    // hinaus -- 164 der 212 Zeichen waren die URL, und WARUM stand nirgends (Discord #84).
    // 💣 ER MUSS VOR DEM RuntimeException-ZWEIG STEHEN, denn er erbt von ihm; darunter waere er
    // tot, ohne dass es jemandem auffiele. Dieselbe Falle wie bei PDOException.
    // Die Meldung ist fertig formuliert (avesmapsWikiSyncUnreachableMessage, wiki/sync.php) und
    // traegt keine Interna -- nur den Satz, eine deutsche Kurzfassung und die Technikmeldung.
    // 503 statt 400: die Ursache liegt DRAUSSEN, und ein spaeterer Versuch kann gelingen.
    avesmapsErrorResponse(503, 'wiki_unreachable', $error->getMessage());
} catch (RuntimeException $error) {
    // 💣 EINE ABSAGE MUSS IHREN GRUND NENNEN. Bis zum 20.08.2026 fing hier ein einziges
    // catch (Throwable) auch die EIGENEN, handgeschriebenen Absagen dieses Endpunkts ab
    // ("Ziel-Ort nicht gefunden.", "Wiki-Seite nicht gefunden oder leer: X", "title/public_id
    // fehlt.") und machte daraus "Internal server error.". Der Editor las ueber die Oberflaeche
    // "Zuweisen fehlgeschlagen: Internal server error." (settlementWikiAssignZuweisen,
    // html/wiki-sync-settlement-editor.html) und konnte daraus nichts ableiten -- Discord #84.
    // 💣 Schlimmer als die schlechte Meldung ist, was sie kostet: die Maskierung macht den Grund
    // auch von AUSSEN unauffindbar. Eine gewoehnliche Absage und ein echter Serverfehler sehen
    // Wort fuer Wort gleich aus, es war also niemand mehr in der Lage, den Fall zu benennen.
    // Wortgleiches Vorbild samt Begruendung: api/edit/wiki/paths.php.
    // ⚠️ Jede Meldung dieser Kette ist handgeschrieben und ohne Interna (settlements.php,
    // sync.php) -- eine neue darf das nicht brechen.
    avesmapsErrorResponse(400, 'invalid_request', $error->getMessage());
} catch (Throwable $error) {
    // Was hier landet, ist NICHT abgesprochen -- nach aussen bleibt es stumm, ins Protokoll nicht.
    avesmapsServerErrorResponse($error, 'wiki-settlements');
}
