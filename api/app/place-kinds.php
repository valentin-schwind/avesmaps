<?php

declare(strict_types=1);

// Public, read-only: the place-kind vocabulary for the editor's "Art" field, sorted by how often
// each kind actually occurs in this installation's own data.
// (docs/superpowers/specs/2026-08-02-ort-bearbeiten-ortsarten-design.md)
//
// The VOCABULARY is a constant (api/_internal/wiki/place-kinds.php, one source of truth shared
// with the wiki crawl). Only the ORDER comes from the database, and that is the point: the wiki
// has ~90 kinds with an extreme long tail -- Festung has more articles than the bottom thirty
// together -- so an alphabetical list would bury everything an editor actually reaches for.
// Sorting by measured frequency means the list follows the data, not somebody's opinion.
//
// The whole list is sent ONCE and filtered in the browser. It is ~83 short strings; a round trip
// per keystroke would cost more than the payload, and the filter rule has to exist client-side
// anyway (avesmapsFilterPlaceKinds mirrors it for the server side and for the test).
//
// GET -> { ok: true, kinds: [ { kind: "Festung", count: 421 }, ... ] }

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/wiki/place-kinds.php';

/**
 * Counts per kind, from BOTH places a kind can be recorded: the wiki registry (crawled) and the
 * map's own points (set by an editor). A missing table is not an error -- a fresh installation
 * has no wiki registry yet and must still get a usable, merely unsorted, list.
 *
 * Deliberately two plain SELECTs and no DDL: this is a read path, and DDL here would make it
 * untestable without a live database (and slow, on every request).
 */
function avesmapsCountPlaceKinds(PDO $pdo): array
{
    $counts = [];

    try {
        $rows = $pdo->query(
            "SELECT building_type AS kind, COUNT(*) AS n FROM wiki_sync_pages
             WHERE building_type IS NOT NULL AND building_type <> '' GROUP BY building_type"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $kind = trim((string) ($row['kind'] ?? ''));
            if ($kind !== '') {
                $counts[$kind] = ($counts[$kind] ?? 0) + (int) $row['n'];
            }
        }
    } catch (Throwable $ignored) {
        // No registry table yet -- the catalogue is still complete, just unranked.
    }

    try {
        // JSON_UNQUOTE(JSON_EXTRACT(...)) rather than a LIKE over properties_json: the latter would
        // match a place_kind mentioned inside any other property's text.
        $rows = $pdo->query(
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.place_kind')) AS kind, COUNT(*) AS n
             FROM map_features
             WHERE feature_type = 'location' AND is_active = 1
               AND JSON_EXTRACT(properties_json, '$.place_kind') IS NOT NULL
             GROUP BY kind"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $kind = trim((string) ($row['kind'] ?? ''));
            if ($kind !== '' && $kind !== 'null') {
                $counts[$kind] = ($counts[$kind] ?? 0) + (int) $row['n'];
            }
        }
    } catch (Throwable $ignored) {
        // Older MySQL without JSON functions, or no map_features -- same reasoning as above.
    }

    return $counts;
}

// avesmapsRankPlaceKinds() is PURE and lives in the lib next to the catalogue, not here: this
// file executes its request on include, so anything defined in it cannot be reached by a test.

try {
    // Die VOKABULARLISTE ist eine Konstante -- sie braucht weder Konfiguration noch Datenbank.
    // Fehlt beides (frische Arbeitskopie, lokaler `php -S` ohne config.local.php), antwortet dieser
    // Endpunkt trotzdem: ein Editor ohne Rangfolge kann immer noch eine Art waehlen, einer mit einem
    // 500er gar nichts. Ein leerer Config ist dabei strikt RESTRIKTIVER, nie offener --
    // avesmapsGetAllowedOrigins([]) ist [], und damit weist die CORS-Regel unten jede fremde
    // Herkunft ab; gleiche Herkunft (kein Origin-Header) laeuft weiter.
    $config = [];
    try {
        $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    } catch (Throwable $ignored) {
    }

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Ortsarten laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer die Ortsarten erlaubt.');
    }

    $catalog = avesmapsPlaceKindCatalog();
    $counts = [];
    try {
        $counts = avesmapsCountPlaceKinds(avesmapsCreatePdo($config['database'] ?? []));
    } catch (Throwable $ignored) {
        // No database reachable: still answer with the full vocabulary. An editor who cannot see
        // the ranking can still pick a kind; one who gets an error can do nothing at all.
    }

    // The vocabulary changes only when someone edits the constant, so a short shared cache is
    // safe and keeps this off the PHP workers on STRATO.
    header('Cache-Control: public, max-age=900');
    avesmapsJsonResponse(200, ['ok' => true, 'kinds' => avesmapsRankPlaceKinds($catalog, $counts)]);
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsarten konnten nicht geladen werden.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Ortsarten konnten nicht geladen werden.');
}
