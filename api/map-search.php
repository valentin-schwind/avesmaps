<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

const AVESMAPS_MAP_SEARCH_MAX_LIMIT = 20;

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf die Kartensuche nicht verwenden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET-Anfragen sind fuer die Kartensuche erlaubt.',
        ]);
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
    $results = avesmapsBuildMapSearchResults($rows, $query, $limit);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'query' => $query,
        'limit' => $limit,
        'results' => $results,
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsJsonResponse(400, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (PDOException) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Kartensuche konnte nicht aus der Datenbank geladen werden.',
    ]);
} catch (RuntimeException $exception) {
    avesmapsJsonResponse(503, [
        'ok' => false,
        'error' => $exception->getMessage(),
    ]);
} catch (Throwable) {
    avesmapsJsonResponse(500, [
        'ok' => false,
        'error' => 'Die Kartensuche konnte nicht verarbeitet werden.',
    ]);
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

function avesmapsBuildMapSearchResults(array $rows, string $query, int $limit): array {
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

    return array_map(
        static function (array $entry): array {
            unset($entry['score'], $entry['search_texts'], $entry['group_key']);
            $entry['public_ids'] = array_values(array_unique($entry['public_ids'] ?? []));
            return $entry;
        },
        array_slice($results, 0, $limit)
    );
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
        if (!avesmapsReadSearchBoolean($properties['show_label'] ?? false)) {
            return null;
        }

        $displayName = avesmapsNormalizeSingleLine((string) ($properties['display_name'] ?? $properties['original_name'] ?? $name), 160);
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

function avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int {
    $bestScore = null;
    foreach ($entry['search_texts'] ?? [] as $searchText) {
        $candidate = avesmapsNormalizeSearchText((string) $searchText);
        if ($candidate === '') {
            continue;
        }

        $score = null;
        if ($candidate === $normalizedQuery) {
            $score = 0;
        } elseif (str_starts_with($candidate, $normalizedQuery)) {
            $score = 1;
        } elseif (avesmapsAnySearchWordStartsWith($candidate, $normalizedQuery)) {
            $score = 2;
        } elseif (str_contains($candidate, $normalizedQuery)) {
            $score = 3;
        }

        if ($score !== null) {
            $bestScore = $bestScore === null ? $score : min($bestScore, $score);
        }
    }

    return $bestScore;
}

function avesmapsAnySearchWordStartsWith(string $candidate, string $query): bool {
    foreach (preg_split('/\s+/', $candidate) ?: [] as $word) {
        if ($word !== '' && str_starts_with($word, $query)) {
            return true;
        }
    }

    return false;
}

function avesmapsNormalizeSearchText(string $value): string {
    $normalizedValue = mb_strtolower(trim($value));
    $normalizedValue = str_replace(
        ['ß', 'ä', 'ö', 'ü', 'à', 'á', 'â', 'è', 'é', 'ê', 'ì', 'í', 'î', 'ò', 'ó', 'ô', 'ù', 'ú', 'û'],
        ['ss', 'ae', 'oe', 'ue', 'a', 'a', 'a', 'e', 'e', 'e', 'i', 'i', 'i', 'o', 'o', 'o', 'u', 'u', 'u'],
        $normalizedValue
    );
    if (function_exists('iconv')) {
        $transliteratedValue = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $normalizedValue);
        if (is_string($transliteratedValue) && $transliteratedValue !== '') {
            $normalizedValue = $transliteratedValue;
        }
    }

    return trim(preg_replace('/[^a-z0-9]+/', ' ', $normalizedValue) ?? '');
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
        default => 99,
    };
}

function avesmapsLocationSearchTypeLabel(string $subtype): string {
    return match ($subtype) {
        'metropole' => 'Metropole',
        'grossstadt' => 'Grosse Stadt',
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleine Stadt',
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
        'wald' => 'Wald',
        'kontinent' => 'Kontinent',
        'wueste' => 'Wueste',
        'suempfe_moore' => 'Sumpf/Moor',
        'see' => 'See',
        'insel' => 'Insel',
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
