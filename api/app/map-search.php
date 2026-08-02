<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/text/ascii-fold.php';
require_once __DIR__ . '/../_internal/app/map-search-scoring.php';
require_once __DIR__ . '/../_internal/app/in-settlement-search.php';
require_once __DIR__ . '/../_internal/app/citymaps.php';
require_once __DIR__ . '/../_internal/app/app-setting.php';
require_once __DIR__ . '/../_internal/app/citymap-search.php';

const AVESMAPS_MAP_SEARCH_MAX_LIMIT = 20;
// The map section is capped independently of the 20-result limit, so maps never displace map objects.
const AVESMAPS_CITYMAP_SEARCH_LIMIT = 5;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Kartensuche nicht verwenden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer die Kartensuche erlaubt.');
    }

    $query = avesmapsReadMapSearchQuery($_GET['q'] ?? '');
    $limit = avesmapsReadMapSearchLimit($_GET['limit'] ?? AVESMAPS_MAP_SEARCH_MAX_LIMIT);
    if ($query === '') {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'query' => '',
            'limit' => $limit,
            'results' => [],
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $rows = avesmapsFetchMapSearchRows($pdo);
    $politicalRows = avesmapsFetchPoliticalTerritorySearchRows($pdo);
    // Dritte Quelle: Objekte, die IN einer Stadt liegen und deshalb keine eigene
    // Kartenposition haben (Villen, Plaetze, Stadttempel, Gassen). Der Ortsindex wird aus
    // $rows abgeleitet -- keine zusaetzliche Ortsabfrage.
    $inSettlementRows = avesmapsFetchInSettlementSearchRows($pdo);
    // Fourth source: the Kartensammlung. The kill switch counts here too -- a collection switched off must
    // not become visible again through the search. Default is ON; only a stored '0' disables.
    //
    // Deliberately NOT avesmapsCitymapsEnabled(): it reads via avesmapsAppSettingGet, which runs
    // `CREATE TABLE IF NOT EXISTS app_setting` on EVERY call. This endpoint is the site's hottest public
    // path (a keystroke-debounced search), so that DDL would fire on every keystroke -- the same
    // per-request DDL/information_schema load AGENTS.md §10 blames for the 2026-07-17 PHP-worker-pool
    // exhaustion. Read the same flag through the DDL-free path instead (precedent:
    // avesmapsRouteTerrainEnabled in terrain-read.php); a missing table just means the default.
    $citymapsEnabled = avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_CITYMAPS_SETTING, '1') !== '0';
    $citymapRows = $citymapsEnabled ? avesmapsFetchCitymapSearchRows($pdo) : [];
    $results = avesmapsBuildMapSearchResults($rows, $politicalRows, $query, $limit, $inSettlementRows, $pdo, $citymapRows);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'query' => $query,
        'limit' => $limit,
        'results' => $results,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartensuche konnte nicht aus der Datenbank geladen werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartensuche konnte nicht verarbeitet werden.');
}

function avesmapsReadMapSearchQuery(mixed $value): string {
    return avesmapsNormalizeSingleLine((string) $value, 120);
}

function avesmapsReadMapSearchLimit(mixed $value): int {
    $limit = filter_var($value, FILTER_VALIDATE_INT);
    if ($limit === false || $limit < 1) {
        return AVESMAPS_MAP_SEARCH_MAX_LIMIT;
    }

    return min(AVESMAPS_MAP_SEARCH_MAX_LIMIT, $limit);
}

function avesmapsFetchMapSearchRows(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT
            public_id,
            feature_type,
            feature_subtype,
            name,
            geometry_type,
            properties_json,
            min_x,
            min_y,
            max_x,
            max_y
        FROM map_features
        WHERE is_active = 1
        ORDER BY sort_order ASC, id ASC'
    );

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

// Politische Herrschaftsgebiete fuer die Suche: Name + public_id (Territorium) + Bounding-Box.
// Die bbox ist die Ausdehnung des Gebiets PLUS aller Nachfahren-Quellgeometrien (rekursiv) -> auch
// reine Aggregat-Knoten (ohne eigene Geometrie) bekommen die korrekte Huelle. Geometrielose
// Gebiete (auch ohne Nachfahren-Geometrie) fallen raus (nichts zum Anspringen). Felder so geformt,
// dass avesmapsBuildSearchResult sie wie eine Region behandelt.
function avesmapsFetchPoliticalTerritorySearchRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            'WITH RECURSIVE subtree AS (
                SELECT id AS root_id, id AS node_id FROM political_territory WHERE is_active = 1
                UNION ALL
                SELECT st.root_id, c.id
                FROM subtree st
                JOIN political_territory c ON c.parent_id = st.node_id AND c.is_active = 1
            )
            SELECT t.public_id,
                   t.name,
                   t.wiki_url,
                   t.min_zoom,
                   t.max_zoom,
                   MIN(g.min_x) AS min_x,
                   MIN(g.min_y) AS min_y,
                   MAX(g.max_x) AS max_x,
                   MAX(g.max_y) AS max_y
            FROM political_territory t
            JOIN subtree st ON st.root_id = t.id
            JOIN political_territory_geometry g ON g.territory_id = st.node_id AND g.is_active = 1
            WHERE t.is_active = 1 AND t.name IS NOT NULL AND t.name <> \'\'
            GROUP BY t.id, t.public_id, t.name, t.wiki_url, t.min_zoom, t.max_zoom'
        );
    } catch (Throwable $exception) {
        return [];
    }

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

function avesmapsBuildMapSearchResults(
    array $rows,
    array $politicalRows,
    string $query,
    int $limit,
    array $inSettlementRows = [],
    ?PDO $pdo = null,
    array $citymapRows = []
): array {
    $normalizedQuery = avesmapsNormalizeSearchText($query);
    if ($normalizedQuery === '') {
        return [];
    }

    $results = [];
    $pathGroups = [];
    foreach ($rows as $row) {
        $entry = avesmapsBuildSearchEntry($row);
        if ($entry === null) {
            continue;
        }

        $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
        if ($score === null) {
            continue;
        }

        if ($entry['kind'] === 'path') {
            $pathKey = (string) ($entry['group_key'] ?? '');
            if ($pathKey === '') {
                continue;
            }

            if (!isset($pathGroups[$pathKey])) {
                $entry['score'] = $score;
                $pathGroups[$pathKey] = $entry;
                continue;
            }

            $pathGroups[$pathKey]['public_ids'][] = (string) $entry['public_id'];
            $pathGroups[$pathKey]['score'] = min((int) $pathGroups[$pathKey]['score'], $score);
            $pathGroups[$pathKey] = avesmapsExtendSearchResultBounds($pathGroups[$pathKey], $entry);
            continue;
        }

        $entry['score'] = $score;
        $results[] = $entry;
    }

    // Politische Herrschaftsgebiete als Region-Treffer (Label "Herrschaftsgebiet").
    foreach ($politicalRows as $politicalRow) {
        $name = (string) ($politicalRow['name'] ?? '');
        if ($name === '') {
            continue;
        }
        $regionFields = [
            'kind' => 'region',
            'name' => $name,
            'type_label' => 'Herrschaftsgebiet',
            'feature_subtype' => 'political_territory',
            // Wie bei map_features (s. u.): die gespeicherte Wiki-Seite zaehlt als Suchtext, damit
            // Deep-Links (?staat=<Seitenname>) auch dann treffen, wenn der DB-Name vom Seitentitel
            // abweicht (z. B. "Ochsenblut" vs. Wiki-Seite "Baronie_Ochsenblut").
            'search_texts' => array_values(array_filter([$name, (string) ($politicalRow['wiki_url'] ?? '')])),
        ];
        if (($politicalRow['min_zoom'] ?? null) !== null) {
            $regionFields['min_zoom'] = (int) $politicalRow['min_zoom'];
        }
        if (($politicalRow['max_zoom'] ?? null) !== null) {
            $regionFields['max_zoom'] = (int) $politicalRow['max_zoom'];
        }
        $entry = avesmapsBuildSearchResult($politicalRow, $regionFields);
        $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
        if ($score === null) {
            continue;
        }
        $entry['score'] = $score;
        $results[] = $entry;
    }

    // Innerorts-Objekte (dritte Quelle). Der Scope-Index braucht die DB (Regionen +
    // Territorien fuer die Mehrdeutigkeitspruefung); ohne PDO bleibt die Quelle einfach
    // leer, damit die Funktion rein testbar bleibt.
    if ($inSettlementRows !== [] && $pdo !== null) {
        $settlementIndex = avesmapsBuildSettlementLocationIndex($rows);
        // $rows durchreichen: die Suche hat map_features schon vollstaendig geladen, ein
        // zweiter Scan derselben Tabelle waere reine Verschwendung. Dieselbe Funktion,
        // dieselbe Regel wie im Editor -- nur ohne die doppelte Abfrage.
        $scopeIndex = avesmapsPlaceScopeLoadIndex($pdo, $rows);
        foreach (avesmapsBuildInSettlementSearchEntries($inSettlementRows, $settlementIndex, $scopeIndex) as $entry) {
            $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
            if ($score === null) {
                continue;
            }
            $entry['score'] = $score;
            $results[] = $entry;
        }
    }

    // Maps are collected SEPARATELY and capped, then appended. 331 of 455 titles start with "Stadtplan
    // von" -- inside the shared limit a single generic word like "stadtplan" would fill all 20 slots and
    // push out the actual map objects. The cap is what makes the feature safe to ship.
    $citymapResults = [];
    foreach (avesmapsBuildCitymapSearchEntries($citymapRows, AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS) as $entry) {
        $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
        if ($score === null) {
            continue;
        }
        $entry['score'] = $score;
        $citymapResults[] = $entry;
    }

    usort($citymapResults, static function (array $left, array $right): int {
        // Maps with a resolved place first: a hit that does nothing when clicked belongs at the bottom.
        $resolvedDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
        if ($resolvedDiff !== 0) {
            return $resolvedDiff;
        }
        $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
        return $scoreDiff !== 0 ? $scoreDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
    });
    $citymapTotal = count($citymapResults);
    $citymapResults = array_slice($citymapResults, 0, AVESMAPS_CITYMAP_SEARCH_LIMIT);

    $results = array_merge($results, array_values($pathGroups));
    usort($results, static function (array $left, array $right): int {
        $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
        if ($scoreDiff !== 0) {
            return $scoreDiff;
        }

        $typeDiff = avesmapsSearchKindOrder((string) $left['kind']) <=> avesmapsSearchKindOrder((string) $right['kind']);
        if ($typeDiff !== 0) {
            return $typeDiff;
        }

        return strnatcasecmp((string) $left['name'], (string) $right['name']);
    });

    $mapped = array_map(
        static function (array $entry): array {
            unset($entry['score'], $entry['search_texts'], $entry['group_key']);
            $entry['public_ids'] = array_values(array_unique($entry['public_ids'] ?? []));
            return $entry;
        },
        array_slice($results, 0, $limit)
    );

    foreach ($citymapResults as $entry) {
        unset($entry['score'], $entry['search_texts']);
        $entry['citymap_total'] = $citymapTotal;
        $mapped[] = $entry;
    }

    return $mapped;
}

function avesmapsBuildSearchEntry(array $row): ?array {
    $properties = avesmapsDecodeJsonColumnForSearch($row['properties_json'] ?? null);
    $featureType = (string) ($row['feature_type'] ?? $properties['feature_type'] ?? '');
    $featureSubtype = (string) ($row['feature_subtype'] ?? $properties['feature_subtype'] ?? '');
    $name = avesmapsGetSearchFeatureName($row, $properties);
    if ($name === '') {
        return null;
    }

    if ($featureType === 'location') {
        if (avesmapsIsCrossingName($name) || $featureSubtype === 'crossing') {
            return null;
        }

        return avesmapsBuildSearchResult($row, [
            'kind' => 'location',
            'name' => $name,
            'type_label' => avesmapsLocationSearchTypeLabel($featureSubtype),
            'search_texts' => [$name, $featureSubtype, $properties['settlement_class_label'] ?? '', avesmapsReadSearchWikiUrl($properties)],
        ]);
    }

    if ($featureType === 'label') {
        return avesmapsBuildSearchResult($row, [
            'kind' => 'label',
            'name' => $name,
            'type_label' => avesmapsLabelSearchTypeLabel($featureSubtype),
            'search_texts' => [$name, $featureSubtype],
            'min_zoom' => (int) ($properties['min_zoom'] ?? 0),
            'max_zoom' => (int) ($properties['max_zoom'] ?? 5),
        ]);
    }

    if ($featureType === 'region' || ($properties['type'] ?? '') === 'region') {
        return avesmapsBuildSearchResult($row, [
            'kind' => 'region',
            'name' => $name,
            'type_label' => 'Politisches Land',
            'search_texts' => [$name, $properties['wiki_url'] ?? ''],
        ]);
    }

    if ($featureType === 'powerline') {
        return avesmapsBuildSearchResult($row, [
            'kind' => 'powerline',
            'name' => $name,
            'type_label' => 'Kraftlinie',
            'search_texts' => [$name, 'Kraftlinie', 'Nodix'],
            'show_label' => avesmapsReadSearchBoolean($properties['show_label'] ?? false),
        ]);
    }

    if ($featureType === 'path') {
        // Spotlight-Policy (Betreiber-Entscheid 2026-07-05): NUR wiki-verlinkte Wege sind suchbar.
        // Der Wege-Link ist das properties.wiki_path-Objekt (api/_internal/wiki/paths.php); show_label
        // zaehlt NICHT mehr (Generik-Namen wie "Reichsstrasse-4903" standen sonst in der Suche).
        // ACHTUNG: das top-level wiki_url ist ein angereicherter Namens-Match gegen wiki_sync_pages
        // (map-features.php) und steht NICHT im rohen properties_json -> nicht darauf pruefen.
        $wikiPath = is_array($properties['wiki_path'] ?? null) ? $properties['wiki_path'] : [];
        if ($wikiPath === []) {
            return null;
        }

        // R1: der Wiki-Weg benennt den Weg. Altbestaende koennen noch Random-Segmentnamen tragen
        // (z.B. "Reichsstrasse-16" -> Wiki "Reichsstraße 2"); Anzeige + Gruppierung nutzen daher
        // den Wiki-Namen, damit alle Segmente eines Wegs EINE Suchgruppe mit echtem Namen bilden.
        $displayName = avesmapsNormalizeSingleLine((string) ($wikiPath['name'] ?? ''), 160);
        if ($displayName === '') {
            $displayName = avesmapsNormalizeSingleLine((string) ($properties['display_name'] ?? $properties['original_name'] ?? $name), 160);
        }
        if ($displayName === '') {
            return null;
        }

        return avesmapsBuildSearchResult($row, [
            'kind' => 'path',
            'name' => $displayName,
            'type_label' => avesmapsPathSearchTypeLabel($featureSubtype),
            'feature_subtype' => $featureSubtype,
            'public_ids' => [(string) $row['public_id']],
            'group_key' => avesmapsNormalizePathSearchGroupKey($displayName, $featureSubtype),
            'search_texts' => [$displayName, $featureSubtype],
            'show_label' => true,
        ]);
    }

    return null;
}

function avesmapsBuildSearchResult(array $row, array $fields): array {
    $publicId = (string) ($row['public_id'] ?? '');
    $result = [
        'kind' => (string) $fields['kind'],
        'public_id' => $publicId,
        'public_ids' => $fields['public_ids'] ?? ($publicId !== '' ? [$publicId] : []),
        'name' => (string) $fields['name'],
        'type_label' => (string) $fields['type_label'],
        'feature_subtype' => (string) ($fields['feature_subtype'] ?? $row['feature_subtype'] ?? ''),
        'min_x' => (float) ($row['min_x'] ?? 0),
        'min_y' => (float) ($row['min_y'] ?? 0),
        'max_x' => (float) ($row['max_x'] ?? 0),
        'max_y' => (float) ($row['max_y'] ?? 0),
        'search_texts' => $fields['search_texts'] ?? [],
    ];

    foreach (['min_zoom', 'max_zoom', 'show_label', 'group_key'] as $optionalField) {
        if (array_key_exists($optionalField, $fields)) {
            $result[$optionalField] = $fields[$optionalField];
        }
    }

    return $result;
}

function avesmapsExtendSearchResultBounds(array $target, array $source): array {
    $target['min_x'] = min((float) $target['min_x'], (float) $source['min_x']);
    $target['min_y'] = min((float) $target['min_y'], (float) $source['min_y']);
    $target['max_x'] = max((float) $target['max_x'], (float) $source['max_x']);
    $target['max_y'] = max((float) $target['max_y'], (float) $source['max_y']);
    return $target;
}

function avesmapsNormalizePathSearchGroupKey(string $displayName, string $subtype): string {
    return avesmapsNormalizeSearchText($subtype) . ':' . avesmapsNormalizeSearchText($displayName);
}

function avesmapsGetSearchFeatureName(array $row, array $properties): string {
    return avesmapsNormalizeSingleLine((string) ($properties['text'] ?? $properties['display_name'] ?? $properties['name'] ?? $row['name'] ?? ''), 160);
}

function avesmapsReadSearchBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsIsCrossingName(string $name): bool {
    return preg_match('/^Kreuzung(?:-\d+)?$/i', $name) === 1;
}

function avesmapsSearchKindOrder(string $kind): int {
    return match ($kind) {
        'location' => 0,
        'label' => 1,
        'region' => 2,
        'path' => 3,
        'powerline' => 4,
        // Innerorts-Objekte ganz ans Ende: sie sind KEIN Kartenobjekt, sondern ein
        // Verweis auf die Stadt. Was wirklich auf der Karte liegt, hat Vorrang.
        'in_settlement' => 5,
        default => 99,
    };
}

function avesmapsLocationSearchTypeLabel(string $subtype): string {
    return match ($subtype) {
        'metropole' => 'Metropole',
        "grossstadt" => "Gro\u{00DF}stadt",
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleinstadt',
        'gebaeude' => 'Bauwerk',
        default => 'Ort',
    };
}

function avesmapsLabelSearchTypeLabel(string $subtype): string {
    return match ($subtype) {
        'region' => 'Region',
        'fluss' => 'Fluss',
        'meer' => 'Meer',
        'gebirge' => 'Gebirge',
        'berggipfel' => 'Berggipfel',
        'vulkan' => 'Vulkan',
        'wald' => 'Wald',
        'tal' => 'Tal',
        'kontinent' => 'Kontinent',
        'wueste' => 'Wueste',
        'suempfe_moore' => 'Sumpf/Moor',
        'see' => 'See',
        'insel' => 'Insel',
        'inselgruppe' => 'Inselgruppe',
        default => 'Label',
    };
}

function avesmapsPathSearchTypeLabel(string $subtype): string {
    return match ($subtype) {
        'Flussweg' => 'Fluss',
        'Seeweg' => 'Seeweg',
        'Gebirgspass' => 'Gebirgspass',
        'Wuestenpfad' => 'Wuestenpfad',
        default => 'Weg',
    };
}

function avesmapsDecodeJsonColumnForSearch(mixed $value): array {
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

function avesmapsReadSearchWikiUrl(array $properties): string {
    $wikiUrl = (string) ($properties['wiki_url'] ?? '');
    if ($wikiUrl !== '') {
        return $wikiUrl;
    }

    return (string) ($properties['data-report-wiki-url'] ?? '');
}
