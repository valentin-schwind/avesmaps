<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/wiki/sync.php';

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
    $politicalContext = avesmapsLoadSettlementPoliticalContext($pdo);
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
            static fn(array $row): array => avesmapsMapFeatureRowToGeoJsonFeature($row, $wikiLocationLinks, $buildingTypes, $politicalContext),
            $rows
        ),
        // (object) casts force JSON objects (maps) even when empty (`{}` not `[]`); the nested
        // ref lists stay JSON arrays. Keys: catalog by source_id, refs by "<entity_type>:<public_id>".
        'source_catalog' => (object) $sourceCatalog,
        'feature_sources' => (object) $featureSourceRefs,
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
function avesmapsMapFeaturesETag(int $revision, array $queryParams): string {
    $seed = (string) ($queryParams['since_revision'] ?? '') . '|' . (string) ($queryParams['bbox'] ?? '');
    return 'W/"mf-' . $revision . '-' . substr(hash('sha1', $seed), 0, 10) . '"';
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

function avesmapsMapFeatureRowToGeoJsonFeature(array $row, array $wikiLocationLinks = [], array $buildingTypes = [], array $politicalContext = []): array {
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

// Loads the settlement->political lookup used to build each place's infobox political line. Returns
// two in-memory maps built from ONE join over the (small) territory tables:
//   territories: wiki_key => {public_id, name, type, depth}  -- the place's containing territory,
//                resolved from the stored properties.territory_wiki_key ray-cast assignment.
//   capitals:    lower(capital_name) => {public_id, name, type, depth, wiki_key}  -- territories a
//                place is the capital OF; the BROADEST one wins (smallest hierarchy depth = closest
//                to a root realm) so a place that is capital of both a realm and a sub-territory names
//                the realm (Gareth -> Mittelreich, not Kaisermark Gareth).
// political_territory_wiki has UNIQUE(wiki_key) -> name/type/capital_name are unambiguous per key;
// only public_id has BF-timeline versions, so the most-current era (highest valid_to_bf) wins.
// Try/catch -> empty maps so a missing table/column can never break the hot map-features payload.
function avesmapsLoadSettlementPoliticalContext(PDO $pdo): array {
    $empty = ['territories' => [], 'capitals' => []];
    try {
        $statement = $pdo->query(
            'SELECT t.public_id, t.wiki_key, t.valid_to_bf,
                    w.name, w.type, w.capital_name, w.affiliation_path_json
               FROM political_territory t
               JOIN political_territory_wiki w ON w.wiki_key = t.wiki_key
              WHERE t.wiki_key IS NOT NULL AND t.wiki_key <> \'\''
        );
    } catch (Throwable $error) {
        return $empty;
    }
    if ($statement === false) {
        return $empty;
    }

    $territories = [];
    $bestValidTo = [];
    $capitals = [];

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        $name = trim((string) ($row['name'] ?? ''));
        if ($wikiKey === '' || $name === '') {
            continue;
        }
        $type = trim((string) ($row['type'] ?? ''));
        $publicId = trim((string) ($row['public_id'] ?? ''));
        $validTo = (int) ($row['valid_to_bf'] ?? 0);
        $path = avesmapsDecodeJsonColumn($row['affiliation_path_json'] ?? null);
        $depth = is_array($path) ? count($path) : 0;

        // One entry per wiki_key -> keep the most current era's public_id (highest valid_to_bf).
        if (!isset($territories[$wikiKey]) || $validTo >= ($bestValidTo[$wikiKey] ?? PHP_INT_MIN)) {
            $territories[$wikiKey] = [
                'public_id' => $publicId,
                'name' => $name,
                'type' => $type,
                'depth' => $depth,
            ];
            $bestValidTo[$wikiKey] = $validTo;
        }

        // Capital index -> the broadest territory (smallest depth) a place is the capital of.
        $capitalName = trim((string) ($row['capital_name'] ?? ''));
        if ($capitalName !== '' && $publicId !== '') {
            $key = mb_strtolower($capitalName, 'UTF-8');
            if (!isset($capitals[$key]) || $depth < $capitals[$key]['depth']) {
                $capitals[$key] = [
                    'public_id' => $publicId,
                    'name' => $name,
                    'type' => $type,
                    'depth' => $depth,
                    'wiki_key' => $wikiKey,
                ];
            }
        }
    }

    return ['territories' => $territories, 'capitals' => $capitals];
}

// Resolves ONE settlement's political line from the maps built by avesmapsLoadSettlementPoliticalContext.
// "Hauptstadt bevorzugt": show the capital line only when the place is the capital of a DIFFERENT
// (broader) territory than the one it merely sits in -- a place that is capital of its OWN barony reads
// as "Baronie Vierok", not "Hauptstadt der Baronie Vierok". Returns null when nothing resolves (the
// client then shows a neutral "Lage"). The client builds the display label + fly-to link from this.
function avesmapsResolveSettlementPolitical(string $settlementName, array $properties, array $context): ?array {
    $territories = $context['territories'] ?? [];
    $capitals = $context['capitals'] ?? [];

    $containingWikiKey = trim((string) ($properties['territory_wiki_key'] ?? ''));
    $containingPublicId = trim((string) ($properties['territory_public_id'] ?? ''));
    $containing = ($containingWikiKey !== '' && isset($territories[$containingWikiKey]))
        ? $territories[$containingWikiKey]
        : null;

    $capitalKey = mb_strtolower(trim($settlementName), 'UTF-8');
    $capital = ($capitalKey !== '' && isset($capitals[$capitalKey])) ? $capitals[$capitalKey] : null;

    if ($capital !== null && ($containing === null || $capital['wiki_key'] !== $containingWikiKey)) {
        return [
            'kind' => 'capital',
            'name' => $capital['name'],
            'type' => $capital['type'],
            'territory_public_id' => $capital['public_id'],
        ];
    }
    if ($containing !== null) {
        return [
            'kind' => 'territory',
            'name' => $containing['name'],
            'type' => $containing['type'],
            'territory_public_id' => $containingPublicId !== '' ? $containingPublicId : $containing['public_id'],
        ];
    }
    return null;
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
    try {
        $statement = $pdo->query(
            "SELECT fs.entity_type, fs.entity_public_id, fs.source_id, fs.reference_kind, fs.pages, fs.note
               FROM feature_sources fs
               JOIN sources s ON s.id = fs.source_id
              WHERE fs.status = 'approved'
              ORDER BY fs.entity_type, fs.entity_public_id, s.is_official DESC, s.created_at ASC, s.id ASC"
        );
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
