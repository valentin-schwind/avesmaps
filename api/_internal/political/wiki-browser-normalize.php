<?php

declare(strict_types=1);

function normalizeTerritoryRow(array $row): array {
    $affiliationPath = decodeJson($row['affiliation_path_json'] ?? null, []);
    $affiliation = decodeJson($row['affiliation_json'] ?? null, null);
    $founded = decodeJson($row['founded_json'] ?? null, null);
    $dissolved = decodeJson($row['dissolved_json'] ?? null, null);
    $raw = decodeJson($row['raw_json'] ?? null, null);

    return [
        'id' => intOrNull($row['id'] ?? null),
        'wiki_key' => stringOrNull($row['wiki_key'] ?? null),
        'name' => stringOrNull($row['name'] ?? null),
        'type' => stringOrNull($row['type'] ?? null),
        'continent' => stringOrNull($row['continent'] ?? null),
        'affiliation_raw' => stringOrNull($row['affiliation_raw'] ?? null),
        'affiliation_key' => stringOrNull($row['affiliation_key'] ?? null),
        'affiliation_root' => stringOrNull($row['affiliation_root'] ?? null),
        'affiliation_path' => is_array($affiliationPath) ? array_values($affiliationPath) : [],
        'affiliation' => is_array($affiliation) ? $affiliation : null,
        'status' => stringOrNull($row['status'] ?? null),
        'form_of_government' => stringOrNull($row['form_of_government'] ?? null),
        'capital_name' => stringOrNull($row['capital_name'] ?? null),
        'seat_name' => stringOrNull($row['seat_name'] ?? null),
        'ruler' => stringOrNull($row['ruler'] ?? null),
        'language' => stringOrNull($row['language'] ?? null),
        'currency' => stringOrNull($row['currency'] ?? null),
        'trade_goods' => stringOrNull($row['trade_goods'] ?? null),
        'population' => stringOrNull($row['population'] ?? null),
        'founded_text' => stringOrNull($row['founded_text'] ?? null),
        'founded_type' => stringOrNull($row['founded_type'] ?? null),
        'founded_start_bf' => intOrNull($row['founded_start_bf'] ?? null),
        'founded_end_bf' => intOrNull($row['founded_end_bf'] ?? null),
        'founded_display_bf' => floatOrNull($row['founded_display_bf'] ?? null),
        'founded' => is_array($founded) ? $founded : null,
        'founder' => stringOrNull($row['founder'] ?? null),
        'dissolved_text' => stringOrNull($row['dissolved_text'] ?? null),
        'dissolved_type' => stringOrNull($row['dissolved_type'] ?? null),
        'dissolved_start_bf' => intOrNull($row['dissolved_start_bf'] ?? null),
        'dissolved_end_bf' => intOrNull($row['dissolved_end_bf'] ?? null),
        'dissolved_display_bf' => floatOrNull($row['dissolved_display_bf'] ?? null),
        'dissolved' => is_array($dissolved) ? $dissolved : null,
        'geographic' => stringOrNull($row['geographic'] ?? null),
        'political' => stringOrNull($row['political'] ?? null),
        'trade_zone' => stringOrNull($row['trade_zone'] ?? null),
        'blazon' => stringOrNull($row['blazon'] ?? null),
        'wiki_url' => stringOrNull($row['wiki_url'] ?? null),
        'coat_of_arms_url' => stringOrNull($row['coat_of_arms_url'] ?? null),
        'map_assigned' => (int)($row['map_geometry_count'] ?? 0) > 0,
        'map_territory_count' => intOrNull($row['map_territory_count'] ?? null) ?? 0,
        'map_geometry_count' => intOrNull($row['map_geometry_count'] ?? null) ?? 0,
        'raw' => is_array($raw) ? $raw : null,
        'synced_at' => stringOrNull($row['synced_at'] ?? null),
    ];
}

function dedupeTerritoryItems(array $items): array {
    $dedupedByKey = [];
    $order = [];

    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            continue;
        }

        $key = territoryItemDedupeKey($item);
        if ($key === '') {
            $key = '__row__' . $index;
        }

        if (!isset($dedupedByKey[$key])) {
            $dedupedByKey[$key] = $item;
            $order[] = $key;
            continue;
        }

        $dedupedByKey[$key] = mergeTerritoryItems($dedupedByKey[$key], $item);
    }

    $deduped = [];
    foreach ($order as $key) {
        if (!isset($dedupedByKey[$key]) || !is_array($dedupedByKey[$key])) {
            continue;
        }
        $deduped[] = $dedupedByKey[$key];
    }

    return $deduped;
}

function isRootTerritoryItem(string $name, string $type = ''): bool {
    $nameKey = makeStableKey($name);
    $typeKey = makeStableKey($type);

    if ($nameKey === '' && $typeKey === '') {
        return false;
    }

    return str_starts_with($nameKey, 'enklave')
        || str_starts_with($typeKey, 'enklave')
        || str_starts_with($nameKey, 'bergkonigreich')
        || str_starts_with($nameKey, 'bergkoenigreich')
        || str_starts_with($typeKey, 'bergkonigreich')
        || str_starts_with($typeKey, 'bergkoenigreich');
}

function territoryItemDedupeKey(array $item): string {
    $wikiKey = value($item['wiki_key'] ?? null);
    if ($wikiKey !== '') {
        return 'wiki_key|' . makeStableKey($wikiKey);
    }

    $wikiUrl = value($item['wiki_url'] ?? null);
    if ($wikiUrl !== '') {
        $wikiTitle = wikiTitleFromUrl($wikiUrl);
        $name = value($item['name'] ?? null);
        $type = value($item['type'] ?? null);
        if ($wikiTitle !== '') {
            return 'wiki_title_name|' . makeStableKey($wikiTitle) . '|' . makeStableKey($name) . '|' . makeStableKey($type);
        }

        return 'wiki_url_name|' . makeStableKey($wikiUrl) . '|' . makeStableKey($name) . '|' . makeStableKey($type);
    }

    return '';
}

function mergeTerritoryItems(array $left, array $right): array {
    $primary = $left;
    $secondary = $right;

    if (territoryItemMergeScore($secondary) > territoryItemMergeScore($primary)) {
        $primary = $right;
        $secondary = $left;
    }

    $merged = $primary;
    $preferredFields = [
        'wiki_key',
        'name',
        'type',
        'continent',
        'affiliation_raw',
        'affiliation_key',
        'affiliation_root',
        'status',
        'form_of_government',
        'capital_name',
        'seat_name',
        'ruler',
        'language',
        'currency',
        'trade_goods',
        'population',
        'founded_text',
        'founded_type',
        'founder',
        'dissolved_text',
        'dissolved_type',
        'geographic',
        'political',
        'trade_zone',
        'blazon',
        'wiki_url',
        'coat_of_arms_url',
        'synced_at',
    ];

    foreach ($preferredFields as $field) {
        $currentValue = value($merged[$field] ?? null);
        $fallbackValue = value($secondary[$field] ?? null);
        if ($currentValue === '' && $fallbackValue !== '') {
            $merged[$field] = $fallbackValue;
        }
    }

    foreach (['id', 'founded_start_bf', 'founded_end_bf', 'dissolved_start_bf', 'dissolved_end_bf'] as $field) {
        if (($merged[$field] ?? null) === null && ($secondary[$field] ?? null) !== null) {
            $merged[$field] = $secondary[$field];
        }
    }

    foreach (['founded_display_bf', 'dissolved_display_bf'] as $field) {
        if (($merged[$field] ?? null) === null && ($secondary[$field] ?? null) !== null) {
            $merged[$field] = $secondary[$field];
        }
    }

    foreach (['affiliation_path', 'affiliation', 'founded', 'dissolved', 'raw'] as $field) {
        $current = $merged[$field] ?? null;
        $fallback = $secondary[$field] ?? null;

        if (empty($current) && !empty($fallback)) {
            $merged[$field] = $fallback;
        }
    }

    $merged['map_territory_count'] = max(
        (int) ($left['map_territory_count'] ?? 0),
        (int) ($right['map_territory_count'] ?? 0)
    );
    $merged['map_geometry_count'] = max(
        (int) ($left['map_geometry_count'] ?? 0),
        (int) ($right['map_geometry_count'] ?? 0)
    );
    $merged['map_assigned'] = $merged['map_geometry_count'] > 0;

    return $merged;
}

function territoryItemMergeScore(array $item): int {
    $score = 0;
    $score += max(0, (int) ($item['map_geometry_count'] ?? 0)) * 100;
    $score += max(0, (int) ($item['map_territory_count'] ?? 0)) * 20;

    $fields = [
        'wiki_url',
        'coat_of_arms_url',
        'founded_text',
        'dissolved_text',
        'type',
        'status',
        'affiliation_raw',
        'capital_name',
        'seat_name',
        'ruler',
        'language',
        'currency',
        'trade_goods',
        'population',
    ];

    foreach ($fields as $field) {
        if (value($item[$field] ?? null) !== '') {
            $score++;
        }
    }

    if (!empty($item['affiliation_path']) && is_array($item['affiliation_path'])) {
        $score += count($item['affiliation_path']);
    }

    return $score;
}
