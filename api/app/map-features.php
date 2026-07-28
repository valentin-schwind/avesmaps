<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/wiki/sync.php';
require_once __DIR__ . '/../_internal/coat-url.php';
require_once __DIR__ . '/../_internal/app/coat-display.php';
require_once __DIR__ . '/../_internal/app/in-settlement-search.php';

// Bump when the SHAPE of the map-features payload changes (a property added/renamed/removed) WITHOUT a
// map_revision change. The ETag is revision-based, so cached clients would otherwise keep a stale body
// via 304 and never see the new field -- exactly what happened when `political` was added. Incrementing
// this changes every ETag and forces a one-time revalidation miss + reload. See AGENTS.md §7.
// MUST be declared BEFORE the try block below: the request handler calls avesmapsMapFeaturesETag while
// running top-to-bottom, and a top-level const is sequential (defined when reached), not hoisted like a
// function -- declaring it further down (among the helper functions) left it undefined at call time -> 500.
// 7: breadcrumb coat_url carries ?v=<mtime> for locally re-uploaded coats. A VALUE change rather than a
//    shape change, but with the same consequence -- without a bump, a 304'd client keeps the unversioned
//    URL and still shows the previous coat.
// 8: the "Liegt in" resolver LEFT-JOINs political_territory_wiki now, so a settlement under a wiki-unlinked
//    territory (no wiki row, e.g. Festum) still gets a political line via the intact parent_id backbone --
//    new `political` objects appear on features that previously had none, so cached clients must revalidate.
const AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = 8;

// Coat-of-arms staging + model tables for the settlement "Liegt in" breadcrumb. These MIRROR the constants
// of api/app/territory-detail.php EXACTLY. The public-domain GATE itself now lives once in the shared
// avesmapsResolveGatedCoatUrl (api/_internal/coat-url.php, AVESMAPS_COAT_PUBLIC_LICENSES) -- surfacing a coat
// the canonical gate would withhold is a NOTICE.md/legal violation. Declared ABOVE the try block for the same
// reason as the payload version above: avesmapsLoadSettlementPoliticalContext() runs inside the try
// (top-to-bottom) and reads them, and a top-level const is sequential -- declaring them below would be
// undefined at call time -> 500.
const AVESMAPS_MAP_FEATURES_COAT_STAGING_TABLE = 'political_territory_wiki_test'; // = AVESMAPS_TERRITORY_DETAIL_STAGING_TABLE
const AVESMAPS_MAP_FEATURES_COAT_MODEL_TABLE = 'wiki_territory_model';            // = AVESMAPS_TERRITORY_DETAIL_MODEL_TABLE

// Die entity_type, die die KARTE aufloest. renderFeatureSourceLine wird ausschliesslich mit
// diesen fuenf aufgerufen (map-features-labels.js, -location-marker-entry.js, -path-rendering.js,
// -powerlines.js, -region-info-markup.js, popups.js) -- alles andere laege im Payload, ohne dass
// es je jemand nachschlaegt. Gelesen von avesmapsLoadFeatureSourceRefs (weiter unten).
//
// 💣 STEHT HIER OBEN, NICHT BEI DER FUNKTION. PHP hoistet Funktionsdefinitionen, aber KEINE
// const auf Dateiebene: eine Konstante entsteht erst, wenn die Zeile ausgefuehrt wird. Der
// try-Block darunter laeuft aber vorher durch und endet in avesmapsMapFeaturesRespond() + exit,
// sodass eine weiter unten stehende Zeile nie erreicht wird. Genau das hat den Endpunkt am
// 2026-07-28 mit HTTP 500 lahmgelegt -- `php -l` findet es nicht, es ist kein Syntaxfehler.
//
// 'lore' gehoert NICHT dazu, und das ist der teure Teil: Vorkommen (Flora/Fauna/Waren) sind
// keine Kartenobjekte, sie haben ihren eigenen, seitenweise ladenden Endpunkt (api/app/lore.php,
// 200 von ~35.000 Zeilen). Ihre Quellen machten dennoch 3,03 MB von 8,2 MB dieses Blocks aus --
// 33.981 Referenzen ueber 5.087 Eintraege, allein "lore:ork" 19 KB. Wer hier einen Typ ergaenzt,
// muss ihn auf der JS-Seite auch wirklich aufloesen.
//
// 'citymap' bleibt bewusst drin: 631 Referenzen / 0,04 MB, und der Karteneditor schreibt in
// denselben Cache (review-feature-sources.js) -- der Gewinn waere Rauschen, das Risiko nicht.
const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES = ['settlement', 'region', 'path', 'territory', 'powerline', 'citymap'];

/**
 * Die Innerorts-Liste fuer den Payload (Name + Stadt je Objekt). Faellt sie aus -- fehlende
 * Spalte, Sync nie gelaufen --, liefert sie eine leere Liste: die Karte selbst darf daran
 * NIE scheitern, sie ist die Hauptsache und das hier eine Zutat.
 *
 * @return list<array{name:string, settlement:string, type:string}>
 */
function avesmapsMapFeaturesInSettlementPlaces(PDO $pdo): array {
    try {
        $registryRows = avesmapsFetchInSettlementSearchRows($pdo);
        if ($registryRows === []) {
            return [];
        }

        return avesmapsBuildInSettlementPlaceList($registryRows, avesmapsPlaceScopeLoadIndex($pdo));
    } catch (Throwable) {
        return [];
    }
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Kartendaten laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer Kartendaten erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $revision = avesmapsFetchMapRevision($pdo);

    // HTTP-Caching (#2): ETag aus Revision + payload-bestimmenden Query-Params (bbox/since_revision).
    // Bei unveraenderten Daten antwortet der Server mit 304 -> der Client nutzt seine Kopie; die teure
    // Query UND der 14-MB-Transfer entfallen komplett. Cache-Control: no-cache = jedes Mal revalidieren,
    // aber 304 statt Vollantwort, solange die Revision gleich bleibt.
    $etag = avesmapsMapFeaturesETag($revision, $_GET);
    header('ETag: ' . $etag);
    header('Cache-Control: no-cache, must-revalidate');
    header('Vary: Accept-Encoding', false);
    $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
        http_response_code(304);
        exit;
    }

    $wikiLocationLinks = avesmapsLoadWikiSyncLocationLinks($pdo);
    $buildingTypes = avesmapsLoadWikiSyncBuildingTypes($pdo);
    // Settlement -> political context: resolve each place's STORED ray-cast territory assignment
    // (properties.territory_wiki_key/territory_public_id, written by the Siedlungseditor) into a
    // ready-to-render political line for the infobox. Loaded ONCE (one small join over the territory
    // tables), resolved in memory per settlement -> no N+1, no lazy client fetch. See
    // avesmapsLoadSettlementPoliticalContext.
    // Global "Wappen: An/Aus" switches (ribbon toggles in the two editors). OFF replaces every coat URL
    // with the placeholder; edit mode keeps the real ones so an editor still sees what they edit. Read
    // once here (fail-open), then handed to the two places that emit a coat: the settlement breadcrumb
    // (territory switch) and properties.coat on the settlement itself (settlement switch).
    $mapFeaturesEditMode = trim((string) ($_GET['edit_mode'] ?? '')) === '1';
    $territoryCoatsEnabled = $mapFeaturesEditMode
        || avesmapsCoatSwitchEnabledFast($pdo, AVESMAPS_TERRITORY_COATS_SETTING);
    $settlementCoatsEnabled = $mapFeaturesEditMode
        || avesmapsCoatSwitchEnabledFast($pdo, AVESMAPS_SETTLEMENT_COATS_SETTING);
    $politicalContext = avesmapsLoadSettlementPoliticalContext($pdo, $territoryCoatsEnabled);
    // Global settlement-image kill switch (ribbon toggle in the Siedlungseditor): when OFF, no settlement
    // images reach the frontend at all. Read ONCE here (fail-open) and passed into the feature builder.
    $settlementImagesEnabled = avesmapsMapFeaturesSettlementImagesEnabled($pdo);
    // Multi-source system: load the approved source catalog + per-entity references ONCE (two
    // collect-queries, no N+1) so the map renders every element's sources synchronously from this
    // payload -- no lazy per-popup fetch. The catalog is shared/deduped (one entry per source);
    // refs point into it by source_id and cover all four entity types (settlement/region/path/
    // territory), including territory which has no map_features row.
    $sourceCatalog = avesmapsLoadFeatureSourceCatalog($pdo);
    $featureSourceRefs = avesmapsLoadFeatureSourceRefs($pdo);
    $query = avesmapsBuildMapFeaturesQuery($_GET);
    $statement = $pdo->prepare($query['sql']);
    $statement->execute($query['params']);
    $rows = $statement->fetchAll();

    // Fix #2 parity: fold each element's un-taken-over properties.other_source ("Andere Quelle") into
    // the shared catalog + refs, so a legacy source that was never opened in the editor (and so never
    // migrated into feature_sources) still renders. Mutates $sourceCatalog/$featureSourceRefs in place
    // before serialization -- restoring the parity the removed lazy per-popup read (avesmapsReadFeatureSources)
    // used to provide, without touching any JS.
    avesmapsMapFeaturesMergeLegacyOtherSources($rows, $sourceCatalog, $featureSourceRefs);

    // Kompression (#1): diese Antwort wird vom Server nicht komprimiert (gemessen: content-encoding none)
    // -> hier explizit gzip, wenn der Client es akzeptiert. ~14 MB JSON -> ~1,5-2,5 MB.
    avesmapsMapFeaturesRespond([
        'ok' => true,
        'revision' => $revision,
        'type' => 'FeatureCollection',
        'features' => array_map(
            static fn(array $row): array => avesmapsMapFeatureRowToGeoJsonFeature($row, $wikiLocationLinks, $buildingTypes, $politicalContext, $settlementImagesEnabled, $settlementCoatsEnabled),
            $rows
        ),
        // (object) casts force JSON objects (maps) even when empty (`{}` not `[]`); the nested
        // ref lists stay JSON arrays. Keys: catalog by source_id, refs by "<entity_type>:<public_id>".
        'source_catalog' => (object) $sourceCatalog,
        'feature_sources' => (object) $featureSourceRefs,
        // Objekte, die IN einer Stadt liegen (Villen, Plaetze, Stadttempel, Gassen) -- je Eintrag
        // nur Name + Stadt. Sie haben keine eigene Kartenposition und sind deshalb KEINE features;
        // der Routenplaner-Autocomplete schlaegt sie trotzdem vor und setzt die STADT als Ziel.
        // Reist EINMAL mit den Kartendaten statt je Tastendruck abgefragt zu werden -- genau das
        // haelt das Tippen so schnell wie bisher.
        'in_settlement_places' => avesmapsMapFeaturesInSettlementPlaces($pdo),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartendaten konnten nicht aus der Datenbank geladen werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartendaten konnten nicht verarbeitet werden.');
}

function avesmapsBuildMapFeaturesQuery(array $queryParams): array {
    $params = [];

    $sinceRevision = avesmapsParseOptionalPositiveInt($queryParams['since_revision'] ?? null, 'since_revision');
    $whereClauses = $sinceRevision === null ? ['is_active = 1'] : [];
    if ($sinceRevision !== null) {
        $whereClauses[] = 'revision > :since_revision';
        $params['since_revision'] = $sinceRevision;
    }

    $bbox = avesmapsParseOptionalBoundingBox((string) ($queryParams['bbox'] ?? ''));
    if ($bbox !== null) {
        $whereClauses[] = 'max_x >= :bbox_min_x';
        $whereClauses[] = 'min_x <= :bbox_max_x';
        $whereClauses[] = 'max_y >= :bbox_min_y';
        $whereClauses[] = 'min_y <= :bbox_max_y';
        $params['bbox_min_x'] = $bbox['min_x'];
        $params['bbox_min_y'] = $bbox['min_y'];
        $params['bbox_max_x'] = $bbox['max_x'];
        $params['bbox_max_y'] = $bbox['max_y'];
    }

    return [
        'sql' => 'SELECT
            public_id,
            feature_type,
            feature_subtype,
            name,
            geometry_type,
            geometry_json,
            properties_json,
            style_json,
            is_active,
            revision,
            updated_at
        FROM map_features
        WHERE ' . implode(' AND ', $whereClauses) . '
        ORDER BY sort_order ASC, id ASC',
        'params' => $params,
    ];
}

function avesmapsParseOptionalPositiveInt(mixed $value, string $fieldName): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false || $parsedValue < 0) {
        throw new InvalidArgumentException("Der Parameter {$fieldName} ist ungueltig.");
    }

    return (int) $parsedValue;
}

function avesmapsParseOptionalBoundingBox(string $rawBoundingBox): ?array {
    $normalizedBoundingBox = trim($rawBoundingBox);
    if ($normalizedBoundingBox === '') {
        return null;
    }

    $parts = array_map('trim', explode(',', $normalizedBoundingBox));
    if (count($parts) !== 4) {
        throw new InvalidArgumentException('Der Parameter bbox muss min_x,min_y,max_x,max_y enthalten.');
    }

    $coordinates = array_map(
        static function (string $value): float {
            $parsedValue = filter_var(str_replace(',', '.', $value), FILTER_VALIDATE_FLOAT);
            if ($parsedValue === false) {
                throw new InvalidArgumentException('Der Parameter bbox enthaelt ungueltige Koordinaten.');
            }

            return (float) $parsedValue;
        },
        $parts
    );

    [$minX, $minY, $maxX, $maxY] = $coordinates;
    if ($minX > $maxX || $minY > $maxY) {
        throw new InvalidArgumentException('Der Parameter bbox enthaelt vertauschte Grenzen.');
    }

    return [
        'min_x' => $minX,
        'min_y' => $minY,
        'max_x' => $maxX,
        'max_y' => $maxY,
    ];
}

function avesmapsFetchMapRevision(PDO $pdo): int {
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        return 0;
    }

    return (int) $revision;
}

// Schwacher ETag aus Revision + payload-bestimmenden Query-Parametern. Schwach (W/), weil gzip- und
// Identity-Variante semantisch dieselbe Ressource sind. Stabil pro Revision -> 304 bei Reloads.
// edit_mode is part of the seed because the two variants differ in CONTENT and coexist at the SAME
// revision: with "Wappen: Aus" the public payload carries placeholder coat URLs while an edit-mode
// request carries the real ones. Without it, a browser that cached one would be handed a 304 for the
// other. The switch STATE needs no seed of its own -- flipping it bumps map_revision (see
// api/edit/wiki/sync-monitor.php), exactly like the settlement-image switch.
function avesmapsMapFeaturesETag(int $revision, array $queryParams): string {
    // Appended ONLY in edit mode, so the public seed stays byte-identical to what it was before this
    // switch existed -- otherwise every visitor would re-download the whole payload once after the deploy
    // for a marker that changes nothing for them.
    $seed = (string) ($queryParams['since_revision'] ?? '') . '|' . (string) ($queryParams['bbox'] ?? '')
        . (trim((string) ($queryParams['edit_mode'] ?? '')) === '1' ? '|e=1' : '');
    return 'W/"mf-' . AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1', $seed), 0, 10) . '"';
}

// Vergleicht If-None-Match (kann Liste sein, "*" oder W/-praefixiert) gegen unseren ETag.
function avesmapsETagMatches(string $ifNoneMatch, string $etag): bool {
    if (trim($ifNoneMatch) === '*') {
        return true;
    }
    $normalize = static fn(string $value): string => trim(preg_replace('/^W\//i', '', trim($value)) ?? trim($value));
    $target = $normalize($etag);
    foreach (explode(',', $ifNoneMatch) as $candidate) {
        if ($normalize($candidate) === $target) {
            return true;
        }
    }

    return false;
}

// Gibt die GeoJSON-Antwort aus, gzip-komprimiert wenn der Client es akzeptiert (sonst identity).
// Content-Length passend zur tatsaechlich gesendeten (ggf. komprimierten) Groesse.
function avesmapsMapFeaturesRespond(array $payload): never {
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');

    $acceptsGzip = stripos((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') !== false;
    if ($acceptsGzip && function_exists('gzencode')) {
        $compressed = gzencode($json, 6);
        if ($compressed !== false) {
            header('Content-Encoding: gzip');
            header('Content-Length: ' . strlen($compressed));
            echo $compressed;
            exit;
        }
    }

    header('Content-Length: ' . strlen($json));
    echo $json;
    exit;
}

// Reads the global settlement-image kill switch (app_setting 'settlement_images_enabled', default ON).
// Fail-open: a missing table / read error keeps images enabled (current behaviour). No DDL here -- the
// hot map-features path must not run DDL; the editor endpoint creates the row. See settlements.php.
function avesmapsMapFeaturesSettlementImagesEnabled(PDO $pdo): bool {
    try {
        $stmt = $pdo->query("SELECT setting_value FROM app_setting WHERE setting_key = 'settlement_images_enabled' LIMIT 1");
        $value = $stmt ? $stmt->fetchColumn() : false;
        return $value === false ? true : ((string) $value !== '0');
    } catch (Throwable) {
        return true;
    }
}

// Filters a settlement's properties.images down to the URLs that may be shown publicly: keeps
// public_domain / cc0 / ai_generated, drops unknown_other, and strips the licence/note metadata
// (editor-only). Accepts both the {url,license,note} object shape and the legacy plain-URL-string
// shape (which counts as ai_generated = shown). See api/edit/wiki/settlement-images.php.
function avesmapsMapFeaturesPublicImageUrls($images): array {
    if (!is_array($images)) {
        return [];
    }
    $allowed = ['public_domain', 'cc0', 'ai_generated'];
    $out = [];
    foreach ($images as $item) {
        if (is_string($item)) {
            $url = trim($item);
            if ($url !== '') {
                $out[] = $url;
            }
            continue;
        }
        if (is_array($item)) {
            $url = trim((string) ($item['url'] ?? ''));
            $license = trim((string) ($item['license'] ?? 'ai_generated'));
            if ($url !== '' && in_array($license, $allowed, true)) {
                $out[] = $url;
            }
        }
    }
    return $out;
}

function avesmapsMapFeatureRowToGeoJsonFeature(array $row, array $wikiLocationLinks = [], array $buildingTypes = [], array $politicalContext = [], bool $settlementImagesEnabled = true, bool $settlementCoatsEnabled = true): array {
    if ((int) ($row['is_active'] ?? 1) !== 1) {
        return [
            'type' => 'Feature',
            'id' => (string) $row['public_id'],
            'geometry' => null,
            'properties' => [
                'public_id' => (string) $row['public_id'],
                'deleted' => true,
                'revision' => (int) $row['revision'],
                'updated_at' => (string) $row['updated_at'],
            ],
        ];
    }

    $properties = avesmapsNormalizeLegacyMapFeatureProperties(avesmapsDecodeJsonColumn($row['properties_json'] ?? null));
    $properties = avesmapsEnrichMapFeatureWikiUrl($properties, $row, $wikiLocationLinks);
    $style = avesmapsDecodeJsonColumn($row['style_json'] ?? null);
    foreach ($style as $styleKey => $styleValue) {
        $properties[$styleKey] = $styleValue;
    }

    $properties['public_id'] = (string) $row['public_id'];
    if ((string) $row['name'] !== '') {
        $properties['name'] = (string) $row['name'];
    }
    $properties['feature_type'] = (string) $row['feature_type'];
    $properties['feature_subtype'] = (string) $row['feature_subtype'];
    $properties['revision'] = (int) $row['revision'];
    $properties['updated_at'] = (string) $row['updated_at'];

    // Settlement own-image gate: properties.images carries a per-image licence ([{url,license,note}]).
    // Only public licences reach the frontend, as a plain URL list -- unknown_other is dropped and the
    // licence/note metadata never leaves the editor. (PAYLOAD_VERSION bumped so cached clients revalidate.)
    if (isset($properties['images'])) {
        $publicImages = $settlementImagesEnabled ? avesmapsMapFeaturesPublicImageUrls($properties['images']) : [];
        if ($publicImages !== []) {
            $properties['images'] = $publicImages;
        } else {
            unset($properties['images']);
        }
    }

    // Global "Wappen: Aus" (settlement switch): drop the coat instead of replacing it with the
    // placeholder. Here the coat REPLACES the settlement icon (popups.js settlementCoatIconMarkup), so an
    // empty shield would take information away rather than just the coat -- without properties.coat the
    // head falls back to the settlement's own icon at its normal size.
    if (!$settlementCoatsEnabled) {
        unset($properties['coat']);
    }

    // Genauer Bauwerkstyp (Festung/Turm/…) + Ruine aus der Registry an die verbundene Wiki-Siedlung
    // heften, damit die Infobox die Unterüberschrift zeigt (deckt auch schon-verbundene Bauwerke ab).
    if ((string) $row['feature_type'] === 'location' && is_array($properties['wiki_settlement'] ?? null)) {
        $wikiTitle = trim((string) ($properties['wiki_settlement']['title'] ?? ''));
        if ($wikiTitle !== '' && isset($buildingTypes[$wikiTitle])) {
            $properties['wiki_settlement']['building_type'] = $buildingTypes[$wikiTitle]['type'];
            $properties['wiki_settlement']['is_ruined'] = $buildingTypes[$wikiTitle]['ruined'];
        }
    }

    // Political context line (infobox): resolve the stored territory assignment into {kind,name,type,
    // territory_public_id}. The client renders the label ("Hauptstadt des Mittelreichs" / "Baronie
    // Vierok") + the fly-to link. Only for real locations; skipped silently if nothing resolves.
    if ((string) $row['feature_type'] === 'location' && $politicalContext !== []) {
        $political = avesmapsResolveSettlementPolitical((string) $row['name'], $properties, $politicalContext);
        if ($political !== null) {
            $properties['political'] = $political;
        }
    }

    return [
        'type' => 'Feature',
        'id' => (string) $row['public_id'],
        'geometry' => avesmapsDecodeJsonColumn($row['geometry_json'] ?? null),
        'properties' => $properties,
    ];
}

function avesmapsDecodeJsonColumn(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    try {
        $decodedValue = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decodedValue) ? $decodedValue : [];
}

function avesmapsNormalizeLegacyMapFeatureProperties(array $properties): array {
    if (
        (string) ($properties['wiki_url'] ?? '') === ''
        && (string) ($properties['data-report-wiki-url'] ?? '') !== ''
    ) {
        $properties['wiki_url'] = trim((string) $properties['data-report-wiki-url']);
    }

    // svg_id ist der WERTGLEICHE Zwilling von id -- bei allen 5421 betroffenen Features
    // identisch, 0,38 MB im Payload. Im Frontend steht er an genau einer Stelle, als letztes
    // Glied der Kette `public_id || feature.id || properties.id || properties.svg_id`
    // (map-features-region-feature-normalization.js) -- und public_id ist bei jedem Feature
    // gesetzt, dieser Zweig also unerreichbar.
    // 💣 `id` bleibt: das liest der ROUTING-Graph als Kantenkennung (route-engine.js,
    // route-graph-routing.js). Nur der Zwilling faellt, nie das Original.
    unset($properties['svg_id']);

    return $properties;
}

// title -> {type, ruined} aus der Bauwerks-Registry. Try/catch, falls die Spalten (noch) fehlen.
function avesmapsLoadWikiSyncBuildingTypes(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            'SELECT title, building_type, is_ruined FROM wiki_sync_pages
             WHERE building_type IS NOT NULL AND building_type <> \'\''
        );
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $map = [];
    foreach ($statement->fetchAll() as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $map[$title] = ['type' => (string) $row['building_type'], 'ruined' => !empty($row['is_ruined'])];
    }
    return $map;
}

// Loads the settlement->political lookup used to build each place's infobox political line: an in-memory
// model of the CURRENT-era territory hierarchy, built from ONE join over the (small) territory tables.
// avesmapsResolveSettlementPolitical then (a) finds the place's ray-cast containing territory by its
// stored wiki_key/public_id and (b) walks the parent_id chain up to the root to decide the line.
//
// Walking parent_id -- never affiliation_path -- is the project KERN-INVARIANTE: ancestry/depth come only
// from the maintained parent_id backbone; affiliation_path is stale and must not drive the hierarchy.
//
// Shape:
//   byId:               territory_id => {id, public_id, wiki_key, parent_id, name, type, capital_key}
//   currentIdByWikiKey: wiki_key => id of the MOST-CURRENT era (highest valid_to_bf); the walk normalizes
//                       every hop to the current era so a stale BF-era row can never be picked.
//   idByPublicId:       public_id => id, a seed fallback when a settlement stored only its public_id.
//
// political_territory can hold several BF-era rows per wiki_key (different public_id, same wiki_key);
// parent_id is an int FK to political_territory.id. Try/catch -> [] so a missing table/column can never
// break the hot map-features payload.
function avesmapsLoadSettlementPoliticalContext(PDO $pdo, bool $territoryCoatsEnabled = true): array {
    try {
        // t.short_name = manually curated short/colloquial name ("Mittelreich"); the wiki apply-flow NEVER
        // writes it (sync-monitor-identity.php), so it is empty until an editor curates it. Preferred over the
        // long formal w.name for display when present -- see avesmapsResolveSettlementPolitical.
        $statement = $pdo->query(
            'SELECT t.id, t.public_id, t.wiki_key, t.parent_id, t.valid_to_bf, t.short_name,
                    t.coat_of_arms_url,
                    w.name AS wiki_name, w.type AS wiki_type, w.capital_name, t.name AS territory_name, t.type AS territory_type
               FROM political_territory t
               LEFT JOIN political_territory_wiki w ON w.wiki_key = t.wiki_key
              WHERE t.wiki_key IS NOT NULL AND t.wiki_key <> \'\''
        );
    } catch (Throwable) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    // Coat-gate inputs for the breadcrumb thumbnail (wiki staging coat+license / model overrides), keyed by
    // wiki_key. Loaded ONCE here (two small full-table scans -> no N+1) and consulted per territory below.
    // Own try/catch inside so a missing sandbox table simply yields no thumbnails without breaking the line.
    $coatInputs = avesmapsLoadSettlementCoatGateInputs($pdo);
    $coatStaging = $coatInputs['staging'];
    $coatOverrides = $coatInputs['overrides'];

    $byId = [];
    $currentIdByWikiKey = [];
    $bestValidTo = [];
    $idByPublicId = [];

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $id = (int) ($row['id'] ?? 0);
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        $name = trim((string) ($row['wiki_name'] ?? '')); if ($name === '') { $name = trim((string) ($row['territory_name'] ?? '')); } // wiki-orphan fallback (LEFT JOIN): use the territory's own name when no political_territory_wiki row exists (e.g. Festum), so the parent_id backbone still resolves the political line
        if ($id === 0 || $wikiKey === '' || $name === '') {
            continue;
        }
        $publicId = trim((string) ($row['public_id'] ?? ''));
        $capitalName = trim((string) ($row['capital_name'] ?? ''));
        $byId[$id] = [
            'id' => $id,
            'public_id' => $publicId,
            'wiki_key' => $wikiKey,
            'parent_id' => ($row['parent_id'] !== null && $row['parent_id'] !== '') ? (int) $row['parent_id'] : 0,
            'name' => $name,
            'short_name' => trim((string) ($row['short_name'] ?? '')),
            'type' => trim((string) ($row['wiki_type'] ?? '')) ?: trim((string) ($row['territory_type'] ?? '')),
            'capital_key' => $capitalName !== '' ? avesmapsPoliticalNameKey($capitalName) : '',
            // Public-domain-gated coat URL (or '' when none/not allowed), mirroring territory-detail.php.
            // The global "Wappen: Aus" switch swaps it for the placeholder afterwards -- one wrap here
            // covers every breadcrumb thumbnail, because the whole "Liegt in" staircase reads byId.
            'coat_url' => avesmapsCoatDisplayUrl(
                avesmapsSettlementTerritoryCoatUrl(
                    trim((string) ($row['coat_of_arms_url'] ?? '')),
                    $coatStaging[$wikiKey] ?? [],
                    $coatOverrides[$wikiKey] ?? []
                ),
                $territoryCoatsEnabled
            ),
        ];

        // Most-current era per wiki_key (highest valid_to_bf) is the canonical node the walk hops through.
        $validTo = (int) ($row['valid_to_bf'] ?? 0);
        if (!isset($currentIdByWikiKey[$wikiKey]) || $validTo >= ($bestValidTo[$wikiKey] ?? PHP_INT_MIN)) {
            $currentIdByWikiKey[$wikiKey] = $id;
            $bestValidTo[$wikiKey] = $validTo;
        }
        if ($publicId !== '' && !isset($idByPublicId[$publicId])) {
            $idByPublicId[$publicId] = $id;
        }
    }

    if ($byId === []) {
        return [];
    }
    return ['byId' => $byId, 'currentIdByWikiKey' => $currentIdByWikiKey, 'idByPublicId' => $idByPublicId];
}

// Bulk-loads the two coat inputs the public-domain gate consults, keyed by wiki_key: the wiki STAGING row
// (coat URL + license status) and the MODEL overrides (metadata_overrides_json). These are the SAME two
// sources api/app/territory-detail.php reads (same table constants). Loaded ONCE -- two small full-table
// scans, no N+1. Each side has its OWN try/catch so a missing sandbox table simply yields no thumbnails; it
// never breaks the (core) political line, which does not depend on these tables.
function avesmapsLoadSettlementCoatGateInputs(PDO $pdo): array {
    $staging = [];
    try {
        $statement = $pdo->query(
            'SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM '
            . AVESMAPS_MAP_FEATURES_COAT_STAGING_TABLE
        );
        foreach (($statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            if ($wikiKey === '') {
                continue;
            }
            $staging[$wikiKey] = [
                'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
                'coat_of_arms_license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
            ];
        }
    } catch (Throwable) {
        $staging = [];
    }

    $overrides = [];
    try {
        $statement = $pdo->query(
            'SELECT wiki_key, metadata_overrides_json FROM ' . AVESMAPS_MAP_FEATURES_COAT_MODEL_TABLE
            . ' WHERE metadata_overrides_json IS NOT NULL'
        );
        foreach (($statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
            $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
            $json = (string) ($row['metadata_overrides_json'] ?? '');
            if ($wikiKey === '' || $json === '') {
                continue;
            }
            $decoded = json_decode($json, true);
            if (!is_array($decoded)) {
                continue;
            }
            // Keep only the two coat keys the gate consults, and only when actually present -- so the
            // array_key_exists override check below mirrors territory-detail's "override ?? staging" exactly.
            $coatOverride = [];
            if (array_key_exists('coat_of_arms_url', $decoded)) {
                $coatOverride['coat_of_arms_url'] = (string) $decoded['coat_of_arms_url'];
            }
            if (array_key_exists('coat_of_arms_license_status', $decoded)) {
                $coatOverride['coat_of_arms_license_status'] = (string) $decoded['coat_of_arms_license_status'];
            }
            if ($coatOverride !== []) {
                $overrides[$wikiKey] = $coatOverride;
            }
        }
    } catch (Throwable) {
        $overrides = [];
    }

    return ['staging' => $staging, 'overrides' => $overrides];
}

// Effective, public-domain-GATED coat URL for one territory, mirroring api/app/territory-detail.php EXACTLY:
//   license = override.coat_of_arms_license_status ?? staging.coat_of_arms_license_status
//   url     = override.coat_of_arms_url ?? political_territory.coat_of_arms_url ?? staging.coat_of_arms_url
//   allowed = url !== '' AND license IN (public_domain)
// Returns the URL only when allowed, else '' -- a non-public-domain coat is never emitted (see NOTICE.md).
function avesmapsSettlementTerritoryCoatUrl(string $ptCoatUrl, array $stagingRow, array $overrides): string {
    // Canonical precedence + public-domain gate + cache-bust now live in api/_internal/coat-url.php, so this
    // breadcrumb, the territory infobox and the map label share ONE implementation and cannot diverge again
    // (Discord #32). The signature stays; only the duplicated body moved.
    return avesmapsResolveGatedCoatUrl(
        $overrides,
        $ptCoatUrl,
        (string) ($stagingRow['coat_of_arms_url'] ?? ''),
        (string) ($stagingRow['coat_of_arms_license_status'] ?? '')
    );
}

// Conservative name-match key for capital<->settlement comparison: lowercased, whitespace-collapsed,
// German umlauts/ss folded, so an umlaut spelling variant still matches. Kept local and deterministic so
// the comparison stays predictable (not the heavier WikiSync match-key).
function avesmapsPoliticalNameKey(string $name): string {
    $value = mb_strtolower(trim($name), 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
    return strtr($value, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
}

// Resolves ONE settlement's political line by walking the parent_id chain of its stored ray-cast
// containing territory (KERN-INVARIANTE: ancestry from parent_id, never affiliation_path). "Hauptstadt
// bevorzugt": if a BROADER ANCESTOR of the containing territory names this place as its capital, show the
// capital line for the broadest such ancestor ("Hauptstadt des Kaiserreichs"); otherwise show the
// containing territory itself ("Baronie Vierok"). Because the capital match is constrained to the place's
// OWN ancestry, an unrelated territory that merely shares the place's name can no longer produce a false
// "Hauptstadt" line. Returns null when nothing resolves (the client then shows a neutral "Lage").
function avesmapsResolveSettlementPolitical(string $settlementName, array $properties, array $context): ?array {
    $byId = $context['byId'] ?? [];
    $currentIdByWikiKey = $context['currentIdByWikiKey'] ?? [];
    $idByPublicId = $context['idByPublicId'] ?? [];
    if ($byId === []) {
        return null;
    }

    // Seed the walk from the settlement's stored ray-cast assignment: prefer the stable wiki_key, fall
    // back to public_id, then normalize the seed to the current era's canonical node.
    $wikiKey = trim((string) ($properties['territory_wiki_key'] ?? ''));
    $publicId = trim((string) ($properties['territory_public_id'] ?? ''));
    $seedId = 0;
    if ($wikiKey !== '' && isset($currentIdByWikiKey[$wikiKey])) {
        $seedId = (int) $currentIdByWikiKey[$wikiKey];
    } elseif ($publicId !== '' && isset($idByPublicId[$publicId])) {
        $seedRow = $byId[$idByPublicId[$publicId]] ?? null;
        $seedWikiKey = (string) ($seedRow['wiki_key'] ?? '');
        $seedId = ($seedWikiKey !== '' && isset($currentIdByWikiKey[$seedWikiKey]))
            ? (int) $currentIdByWikiKey[$seedWikiKey]
            : (int) $idByPublicId[$publicId];
    }
    if ($seedId === 0 || !isset($byId[$seedId])) {
        return null; // no resolvable containing territory
    }

    // Build the current-era ancestor chain leaf -> ... -> root (visited-guard against cyclic parent data).
    $chain = [];
    $visited = [];
    $node = $byId[$seedId];
    while ($node !== null && !isset($visited[$node['wiki_key']])) {
        $visited[$node['wiki_key']] = true;
        $chain[] = $node;
        $parentId = (int) ($node['parent_id'] ?? 0);
        $parentRow = $parentId !== 0 ? ($byId[$parentId] ?? null) : null;
        if ($parentRow === null) {
            $node = null;
            continue;
        }
        $parentWikiKey = (string) ($parentRow['wiki_key'] ?? '');
        $currentParentId = ($parentWikiKey !== '' && isset($currentIdByWikiKey[$parentWikiKey]))
            ? (int) $currentIdByWikiKey[$parentWikiKey]
            : $parentId;
        $node = $byId[$currentParentId] ?? null;
    }

    $leaf = $chain[0];
    $settlementKey = avesmapsPoliticalNameKey($settlementName);

    // Full leaf -> root hierarchy for the "Liegt in" breadcrumb (Owner Variante A: the leaf is included).
    // Same parent_id chain (KERN-INVARIANTE), just surfaced as a list; the client renders each level as a
    // fly-to link and picks the display label from short_name (curated "Mittelreich") else the full name.
    $hierarchy = [];
    foreach ($chain as $chainNode) {
        $hierarchy[] = [
            'name' => $chainNode['name'],
            'short_name' => $chainNode['short_name'] ?? '',
            'type' => $chainNode['type'],
            'territory_public_id' => $chainNode['public_id'],
            'coat_url' => $chainNode['coat_url'] ?? '',
        ];
    }

    // Capital line: the BROADEST level (closest to root) whose capital matches this place -- INCLUDING the
    // leaf itself (Owner: a place that is the capital of its OWN barony reads "Hauptstadt von Baronie X",
    // not "in Baronie X"). Iterate from the root end inward so the first hit is the broadest; the match is
    // still constrained to the place's OWN ancestry chain, so a same-named foreign territory can't leak in.
    if ($settlementKey !== '') {
        for ($i = count($chain) - 1; $i >= 0; $i--) {
            if (($chain[$i]['capital_key'] ?? '') === $settlementKey) {
                return [
                    'kind' => 'capital',
                    'name' => $chain[$i]['name'],
                    'short_name' => $chain[$i]['short_name'] ?? '',
                    'type' => $chain[$i]['type'],
                    'territory_public_id' => $chain[$i]['public_id'],
                    'coat_url' => $chain[$i]['coat_url'] ?? '',
                    'hierarchy' => $hierarchy,
                ];
            }
        }
    }

    // Otherwise the containing territory it sits in ("Baronie Vierok"). Prefer the settlement's stored
    // public_id (the exact ray-cast era) over the canonical node's, matching the shipped behavior.
    return [
        'kind' => 'territory',
        'name' => $leaf['name'],
        'short_name' => $leaf['short_name'] ?? '',
        'type' => $leaf['type'],
        'territory_public_id' => $publicId !== '' ? $publicId : $leaf['public_id'],
        'coat_url' => $leaf['coat_url'] ?? '',
        'hierarchy' => $hierarchy,
    ];
}

// Shared catalog of every source that is actually linked to at least one element with an approved
// link: { <source_id> => {url,label,type,official} }. One collect-query (EXISTS), deduped to one row
// per source so a source used by many elements is serialized once. Try/catch -> [] when the tables
// do not exist yet (fresh DB): the hot map-features path never runs DDL (see AGENTS.md perf notes).
function avesmapsLoadFeatureSourceCatalog(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT s.id, s.url, s.label, s.source_type, s.is_official
               FROM sources s
              WHERE EXISTS (
                    SELECT 1 FROM feature_sources fs
                     WHERE fs.source_id = s.id AND fs.status = 'approved'
              )"
        );
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $catalog = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $catalog[(int) $row['id']] = [
            'url' => (string) $row['url'],
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
        ];
    }
    return $catalog;
}

// Per-entity approved source references grouped in PHP (no N+1): { "<entity_type>:<public_id>" =>
// [ {source_id[, reference_kind][, pages][, note]} ] }. Ordered official-first then insertion order
// so buildSourceListMarkup keeps a stable within-group order. Null/empty detail fields are omitted
// to keep the payload compact. Try/catch -> [] (tables or the Task-1 detail columns may be absent).
function avesmapsLoadFeatureSourceRefs(PDO $pdo): array {
    $placeholders = implode(', ', array_fill(0, count(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES), '?'));
    try {
        $statement = $pdo->prepare(
            "SELECT fs.entity_type, fs.entity_public_id, fs.source_id, fs.reference_kind, fs.pages, fs.note
               FROM feature_sources fs
               JOIN sources s ON s.id = fs.source_id
              WHERE fs.status = 'approved'
                AND fs.entity_type IN (" . $placeholders . ")
              ORDER BY fs.entity_type, fs.entity_public_id, s.is_official DESC, s.created_at ASC, s.id ASC"
        );
        $statement->execute(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES);
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $refs = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $key = (string) $row['entity_type'] . ':' . (string) $row['entity_public_id'];
        $ref = ['source_id' => (int) $row['source_id']];
        if (($row['reference_kind'] ?? '') !== '') {
            $ref['reference_kind'] = (string) $row['reference_kind'];
        }
        if (($row['pages'] ?? '') !== '') {
            $ref['pages'] = (string) $row['pages'];
        }
        if (($row['note'] ?? '') !== '') {
            $ref['note'] = (string) $row['note'];
        }
        $refs[$key][] = $ref;
    }
    return $refs;
}

// Fix #2 parity: settlement/region/path elements can still carry a legacy single
// properties.other_source ("Andere Quelle") that was never opened in the editor and so never taken
// over into the feature_sources catalog. The removed lazy read (avesmapsReadFeatureSources) merged
// it into the displayed source list; the synchronous payload path reads ONLY the feature_sources
// table, so this restores parity by synthesizing that un-taken-over other_source as a normal catalog
// entry + a per-feature ref. The synthetic id is a NON-numeric string ("os:<public_id>") so it can
// never collide with a real integer sources.id and stays a string key in the (object)-serialized map;
// the JS resolver (resolveFeatureSourceList) then resolves it exactly like any other
// {url,label,official,type} source. Deduped by URL against the element's already-approved links
// (replicating avesmapsReadFeatureSources): a source that WAS taken over is never shown twice.
// Territory has no map_features row, so only these three feature types are in scope. Mutates the
// two shared maps in place.
//
// @param list<array<string,mixed>> $rows this payload's raw map_features rows
// @param array<int|string,array<string,mixed>> $catalog shared source catalog, keyed by source id (mutated)
// @param array<string,list<array<string,mixed>>> $refs per-entity refs, keyed "<entity_type>:<public_id>" (mutated)
function avesmapsMapFeaturesMergeLegacyOtherSources(array $rows, array &$catalog, array &$refs): void {
    // feature_type -> the entity_type the JS resolver / feature_sources rows are keyed by.
    $entityTypeByFeatureType = ['location' => 'settlement', 'label' => 'region', 'path' => 'path'];

    foreach ($rows as $row) {
        if ((int) ($row['is_active'] ?? 1) !== 1) {
            continue; // deleted tombstone -> no source line
        }
        $entityType = $entityTypeByFeatureType[(string) ($row['feature_type'] ?? '')] ?? '';
        if ($entityType === '') {
            continue; // crossing/river/etc. -- no other_source display surface
        }

        // Cheap substring gate before the JSON decode: skips the ~all rows with no legacy field
        // (mirrors the LIKE pre-filters elsewhere; keeps the hot ~14 MB payload decode-once).
        $rawProps = $row['properties_json'] ?? null;
        if (!is_string($rawProps) || strpos($rawProps, '"other_source"') === false) {
            continue;
        }

        $properties = avesmapsDecodeJsonColumn($rawProps);
        $other = $properties['other_source'] ?? null;
        $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
        if ($url === '') {
            continue; // present but empty/malformed -> nothing to show
        }

        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $refKey = $entityType . ':' . $publicId;

        // Dedup (replicating avesmapsReadFeatureSources): skip when this url is ALREADY an approved
        // feature_sources link for the element (it was taken over into the catalog) -> never twice.
        $alreadyLinked = false;
        foreach ($refs[$refKey] ?? [] as $ref) {
            $sourceId = $ref['source_id'] ?? null;
            $entry = ($sourceId !== null && isset($catalog[$sourceId])) ? $catalog[$sourceId] : null;
            if (is_array($entry) && (string) ($entry['url'] ?? '') === $url) {
                $alreadyLinked = true;
                break;
            }
        }
        if ($alreadyLinked) {
            continue;
        }

        // Synthetic id: a NON-numeric string, so it never collides with a real integer sources.id
        // and PHP keeps it a string key (not int-cast) in the (object)-serialized catalog map.
        $syntheticId = 'os:' . $publicId;
        $catalog[$syntheticId] = [
            'url' => $url,
            'label' => is_array($other) ? trim((string) ($other['label'] ?? '')) : '',
            'type' => 'sonstiges',
            'official' => false,
        ];
        // Append last: other_source is non-official and buildSourceListMarkup groups official-first,
        // so it renders after the curated sources -- matching the old "legacy appended after catalog".
        $refs[$refKey][] = ['source_id' => $syntheticId];
    }
}

function avesmapsLoadWikiSyncLocationLinks(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT normalized_key, wiki_url
        FROM wiki_sync_pages
        WHERE wiki_url IS NOT NULL AND wiki_url <> \'\'
            AND normalized_key IS NOT NULL AND normalized_key <> \'\''
    );
    if ($statement === false) {
        return [];
    }

    $links = [];
    foreach ($statement->fetchAll() as $row) {
        $normalizedKey = trim((string) ($row['normalized_key'] ?? ''));
        $wikiUrl = trim((string) ($row['wiki_url'] ?? ''));
        if ($normalizedKey === '' || $wikiUrl === '') {
            continue;
        }

        $links[$normalizedKey] ??= $wikiUrl;
    }

    return $links;
}

function avesmapsEnrichMapFeatureWikiUrl(array $properties, array $row, array $wikiLocationLinks): array {
    if ((string) ($properties['wiki_url'] ?? '') !== '') {
        return $properties;
    }
    // An editor has stated that this place has NO wiki article (conflict centre, "Kein Wiki-Eintrag").
    // Without honouring that, an empty column is indistinguishable from "nobody set one yet" and the
    // guess below simply puts the wrong link back -- which is why deleting a link never stuck and
    // Discord #38 kept reappearing. A deliberate emptiness is data, not a gap to fill.
    if (!empty($properties['wiki_no_article'])) {
        return $properties;
    }

    // A powerline's wiki link is explicit or nothing. The name match below is built for PLACES:
    // a powerline named like a settlement would silently inherit that settlement's article --
    // the Discord #38 class of bug, where a guessed link became real data on the next save.
    if ((string) ($row['feature_type'] ?? '') === 'powerline') {
        return $properties;
    }

    $locationName = trim((string) ($row['name'] ?? ''));
    if ($locationName === '') {
        return $properties;
    }

    $matchKey = avesmapsWikiSyncCreateMatchKey($locationName);
    if ($matchKey === '' || !isset($wikiLocationLinks[$matchKey])) {
        return $properties;
    }

    $properties['wiki_url'] = (string) ($wikiLocationLinks[$matchKey] ?? '');

    return $properties;
}
