<?php

declare(strict_types=1);

// Political-territory tree building from parsed wiki rows (node creation, dedupe,
// path classification/canonicalization, public-tree projection), split out of
// territories.php (M5 god-file split). Required by territories.php; relies on its
// consts and sibling helpers, resolved at call time.

function avesmapsWikiSyncBuildPoliticalTerritoryTree(array $rows, bool $includePathReferenceRows = true): array {
    $root = avesmapsWikiSyncCreatePoliticalTreeNode('__root__', '');
    $rowIndex = avesmapsWikiSyncBuildPoliticalTerritoryRowIndex($rows);
    if ($includePathReferenceRows) {
        $pathReferenceRows = avesmapsWikiSyncFetchPoliticalTerritoryPathReferenceRows($rows, $rowIndex);
        if ($pathReferenceRows !== []) {
            $rowIndex = avesmapsWikiSyncBuildPoliticalTerritoryRowIndex(array_merge($pathReferenceRows, $rows));
        }
    }
    $territories = [];

    foreach ($rows as $index => $row) {
        $path = avesmapsWikiSyncReadPoliticalTerritoryPath($row);

        if (avesmapsWikiSyncShouldForcePoliticalTerritoryRoot($row)) {
            $path = [];
        } elseif (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath($path)) {
            $path = [];
        }

        $path = avesmapsWikiSyncNormalizePoliticalTerritoryPathForNode($path, (string) ($row['name'] ?? ''));

        $current =& $root;
        foreach ($path as $part) {
            $part = avesmapsWikiSyncResolvePoliticalPathPart($rowIndex, $part);
            $key = avesmapsWikiSyncMakePoliticalTreeKey($part);
            if ($key === '') {
                continue;
            }

            if (!isset($current['children'][$key])) {
                $current['children'][$key] = avesmapsWikiSyncCreatePoliticalTreeNode($key, $part, null);
            }

            $current =& $current['children'][$key];
        }

        $name = (string) ($row['name'] ?? '');
        $ownKey = avesmapsWikiSyncMakePoliticalTreeKey($name) ?: 'gebiet-' . ($index + 1);
        $targetNode = null;
        $currentNodeKey = avesmapsWikiSyncNodeKeyWithoutPrefix((string) ($current['key'] ?? ''));
        if ($currentNodeKey !== '' && $currentNodeKey === $ownKey) {
            $currentRow = is_array($current['row'] ?? null) ? $current['row'] : null;
            if ($currentRow === null || avesmapsWikiSyncScorePoliticalTerritoryRow($row) >= avesmapsWikiSyncScorePoliticalTerritoryRow($currentRow)) {
                $current['row'] = $row;
                $current = avesmapsWikiSyncApplyPoliticalRowToTreeNode($current, $row);
            }
            $targetNode = $current;
        } else {
            if (!isset($current['children'][$ownKey])) {
                $current['children'][$ownKey] = avesmapsWikiSyncCreatePoliticalTreeNode($ownKey, $name, $row);
            } elseif ($current['children'][$ownKey]['row'] === null) {
                $current['children'][$ownKey]['row'] = $row;
                $current['children'][$ownKey] = avesmapsWikiSyncApplyPoliticalRowToTreeNode($current['children'][$ownKey], $row);
            }

            $targetNode = $current['children'][$ownKey];
        }

        if (is_array($targetNode)) {
            $territories[(string) ($targetNode['public_id'] ?? '')] = avesmapsWikiSyncPublicPoliticalTreeNode($targetNode);
        }
        unset($current);
    }

    $hierarchy = avesmapsWikiSyncFlattenPoliticalTreeChildren($root['children']);
    $hierarchy = avesmapsWikiSyncDedupePoliticalTreeHierarchy($hierarchy);
    foreach ($hierarchy as $node) {
        avesmapsWikiSyncCollectPoliticalTreeTerritories($node, $territories);
    }

    return [
        'hierarchy' => $hierarchy,
        'territories' => array_values($territories),
    ];
}

function avesmapsWikiSyncDedupePoliticalTreeHierarchy(array $nodes): array {
    $dedupedByKey = [];
    foreach ($nodes as $node) {
        if (!is_array($node)) {
            continue;
        }

        $normalizedNode = $node;
        $normalizedNode['children'] = avesmapsWikiSyncDedupePoliticalTreeHierarchy(is_array($node['children'] ?? null) ? $node['children'] : []);
        $key = avesmapsWikiSyncBuildPoliticalTreeDedupeKey($normalizedNode);
        $existing = $dedupedByKey[$key] ?? null;
        if (!is_array($existing)) {
            $dedupedByKey[$key] = $normalizedNode;
            continue;
        }

        $winner = avesmapsWikiSyncScorePublicPoliticalTreeNode($normalizedNode) >= avesmapsWikiSyncScorePublicPoliticalTreeNode($existing)
            ? $normalizedNode
            : $existing;
        $loser = $winner === $normalizedNode ? $existing : $normalizedNode;
        $winner['children'] = avesmapsWikiSyncDedupePoliticalTreeHierarchy(array_merge(
            is_array($winner['children'] ?? null) ? $winner['children'] : [],
            is_array($loser['children'] ?? null) ? $loser['children'] : []
        ));
        $winner = avesmapsWikiSyncMergePublicPoliticalTreeNode($winner, $loser);
        $dedupedByKey[$key] = $winner;
    }

    $deduped = array_values($dedupedByKey);
    usort($deduped, static fn(array $left, array $right): int => strnatcasecmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? '')));
    return $deduped;
}

function avesmapsWikiSyncBuildPoliticalTreeDedupeKey(array $node): string {
    $wikiKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['wiki_key'] ?? ''));
    if ($wikiKey !== '') {
        return 'wiki_key|' . $wikiKey;
    }

    $wikiUrl = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['wiki_url'] ?? ''));
    if ($wikiUrl !== '') {
        return 'wiki_url|' . $wikiUrl;
    }

    $nameKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['name'] ?? ''));
    $periodKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['valid_label'] ?? ''));
    if ($periodKey !== '') {
        return $nameKey . '|' . $periodKey;
    }

    return $nameKey;
}

function avesmapsWikiSyncScorePublicPoliticalTreeNode(array $node): int {
    $score = 0;
    $score += count(is_array($node['children'] ?? null) ? $node['children'] : []) * 1000;
    foreach (['wiki_url', 'type', 'status', 'valid_label', 'founded_text', 'dissolved_text', 'coat_of_arms_url'] as $field) {
        if (trim((string) ($node[$field] ?? '')) !== '') {
            $score += 20;
        }
    }
    $score += (int) ($node['map_geometry_count'] ?? 0) * 5;
    return $score;
}

function avesmapsWikiSyncMergePublicPoliticalTreeNode(array $primary, array $secondary): array {
    $merged = $primary;
    if ((int) ($merged['id'] ?? 0) <= 0 && (int) ($secondary['id'] ?? 0) > 0) {
        $merged['id'] = (int) $secondary['id'];
        $merged['wiki_id'] = (int) $secondary['id'];
    }
    if (trim((string) ($merged['wiki_key'] ?? '')) === '' && trim((string) ($secondary['wiki_key'] ?? '')) !== '') {
        $merged['wiki_key'] = (string) $secondary['wiki_key'];
    }
    foreach ([
        'public_id', 'name', 'short_name', 'type', 'status', 'form_of_government', 'valid_label',
        'wiki_name', 'wiki_affiliation_raw', 'wiki_affiliation_root', 'wiki_url', 'capital_name',
        'seat_name', 'ruler', 'founder', 'language', 'currency', 'trade_goods', 'population',
        'founded_text', 'dissolved_text', 'coat_of_arms_url'
    ] as $field) {
        if (trim((string) ($merged[$field] ?? '')) === '' && trim((string) ($secondary[$field] ?? '')) !== '') {
            $merged[$field] = $secondary[$field];
        }
    }

    $merged['map_assigned'] = !empty($merged['map_assigned']) || !empty($secondary['map_assigned']);
    $merged['map_territory_count'] = max((int) ($merged['map_territory_count'] ?? 0), (int) ($secondary['map_territory_count'] ?? 0));
    $merged['map_geometry_count'] = max((int) ($merged['map_geometry_count'] ?? 0), (int) ($secondary['map_geometry_count'] ?? 0));

    return $merged;
}

function avesmapsWikiSyncNormalizePoliticalTerritoryPathForNode(array $path, string $nodeName): array {
    $nodeKey = avesmapsWikiSyncMakePoliticalTreeKey($nodeName);
    $normalizedPath = [];
    $seenKeys = [];

    foreach ($path as $part) {
        $partKey = avesmapsWikiSyncMakePoliticalTreeKey((string) $part);
        if ($partKey === '') {
            continue;
        }

        if ($nodeKey !== '' && $partKey === $nodeKey) {
            continue;
        }

        if (isset($seenKeys[$partKey])) {
            continue;
        }

        $seenKeys[$partKey] = true;
        $normalizedPath[] = (string) $part;
    }

    return $normalizedPath;
}

function avesmapsWikiSyncNodeKeyWithoutPrefix(string $nodeKey): string {
    return str_starts_with($nodeKey, 'wiki:') ? substr($nodeKey, 5) : $nodeKey;
}

function avesmapsWikiSyncDisplayPoliticalTerritoryName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);
    if ($normalized === '') {
        return '';
    }

    foreach (AVESMAPS_WIKI_POLITICAL_DISPLAY_SUFFIXES as $suffix) {
        $suffixPattern = preg_quote((string) $suffix, '/');
        $normalized = preg_replace('/\s+\(' . $suffixPattern . '\)\s*$/iu', '', $normalized) ?? $normalized;
    }

    return trim($normalized);
}
 
function avesmapsWikiSyncCreatePoliticalTreeNode(string $key, string $name, ?array $row = null): array {
    $node = [
        'id' => 0,
        'wiki_key' => '',
        'key' => 'wiki:' . $key,
        'public_id' => 'wiki:' . $key,
        'name' => avesmapsWikiSyncDisplayPoliticalTerritoryName($name),
        'short_name' => '',
        'type' => '',
        'status' => '',
        'form_of_government' => '',
        'valid_label' => '',
        'parent_public_id' => '',
        'parent_name' => '',
        'wiki_name' => '',
        'wiki_affiliation_raw' => '',
        'wiki_affiliation_root' => '',
        'wiki_url' => '',
        'capital_name' => '',
        'seat_name' => '',
        'ruler' => '',
        'map_assigned' => false,
        'map_territory_count' => 0,
        'map_geometry_count' => 0,
        'map_inactive_territory_count' => 0,
        'is_group' => $row === null,
        'row' => $row,
        'children' => [],
    ];
    return $row === null ? $node : avesmapsWikiSyncApplyPoliticalRowToTreeNode($node, $row);
}

function avesmapsWikiSyncApplyPoliticalRowToTreeNode(array $node, array $row): array {
    $node['id'] = (int) ($row['id'] ?? 0);
    $node['wiki_key'] = (string) ($row['wiki_key'] ?? '');
    $node['name'] = avesmapsWikiSyncDisplayPoliticalTerritoryName((string) ($row['name'] ?? $node['name'] ?? ''));
    $node['type'] = (string) ($row['type'] ?? '');
    $node['status'] = (string) ($row['status'] ?? '');
    $node['form_of_government'] = (string) ($row['form_of_government'] ?? '');
    $node['valid_label'] = avesmapsWikiSyncFormatPoliticalPeriod($row);
    $node['wiki_name'] = (string) ($row['name'] ?? '');
    $node['wiki_affiliation_raw'] = (string) ($row['affiliation'] ?? '');
    $node['wiki_affiliation_root'] = avesmapsWikiSyncReadPoliticalTerritoryPath($row)[0] ?? '';
    $node['wiki_url'] = (string) ($row['wiki_url'] ?? '');
    $node['capital_name'] = (string) ($row['capital_name'] ?? '');
    $node['seat_name'] = (string) ($row['seat_name'] ?? '');
    $node['ruler'] = (string) ($row['ruler'] ?? '');
    $node['founder'] = (string) ($row['founder'] ?? '');
    $node['language'] = (string) ($row['language'] ?? '');
    $node['currency'] = (string) ($row['currency'] ?? '');
    $node['trade_goods'] = (string) ($row['trade_goods'] ?? '');
    $node['population'] = (string) ($row['population'] ?? '');
    $node['founded_text'] = (string) ($row['founded_text'] ?? '');
    $node['dissolved_text'] = (string) ($row['dissolved_text'] ?? '');
    $node['coat_of_arms_url'] = (string) ($row['coat_of_arms_url'] ?? '');
    $node['map_assigned'] = !empty($row['map_assigned']);
    $node['map_territory_count'] = (int) ($row['map_territory_count'] ?? 0);
    $node['map_geometry_count'] = (int) ($row['map_geometry_count'] ?? 0);
    $node['map_inactive_territory_count'] = (int) ($row['map_inactive_territory_count'] ?? 0);

    return $node;
}

function avesmapsWikiSyncFlattenPoliticalTreeChildren(array $children, int $depth = 0): array {
    if ($depth > 24) {
        return [];
    }

    uasort($children, 'avesmapsWikiSyncComparePoliticalTreeNodes');
    $output = [];
    foreach ($children as $child) {
        $node = avesmapsWikiSyncPublicPoliticalTreeNode($child);
        $node['children'] = avesmapsWikiSyncFlattenPoliticalTreeChildren($child['children'], $depth + 1);
        $node['is_group'] = $node['is_group'] || $node['children'] !== [];
        $output[] = $node;
    }

    return $output;
}

function avesmapsWikiSyncPublicPoliticalTreeNode(array $node): array {
    return [
        'id' => (int) ($node['id'] ?? 0),
        'wiki_id' => (int) ($node['id'] ?? 0),
        'wiki_key' => (string) ($node['wiki_key'] ?? ''),
        'key' => (string) $node['key'],
        'public_id' => (string) $node['public_id'],
        'name' => (string) $node['name'],
        'short_name' => (string) $node['short_name'],
        'type' => (string) $node['type'],
        'status' => (string) $node['status'],
        'form_of_government' => (string) $node['form_of_government'],
        'valid_label' => (string) $node['valid_label'],
        'parent_public_id' => (string) $node['parent_public_id'],
        'parent_name' => (string) $node['parent_name'],
        'wiki_name' => (string) $node['wiki_name'],
        'wiki_affiliation_raw' => (string) $node['wiki_affiliation_raw'],
        'wiki_affiliation_root' => (string) $node['wiki_affiliation_root'],
        'wiki_url' => (string) $node['wiki_url'],
        'capital_name' => (string) $node['capital_name'],
        'seat_name' => (string) $node['seat_name'],
        'ruler' => (string) $node['ruler'],
        'founder' => (string) ($node['founder'] ?? ''),
        'language' => (string) ($node['language'] ?? ''),
        'currency' => (string) ($node['currency'] ?? ''),
        'trade_goods' => (string) ($node['trade_goods'] ?? ''),
        'population' => (string) ($node['population'] ?? ''),
        'founded_text' => (string) ($node['founded_text'] ?? ''),
        'dissolved_text' => (string) ($node['dissolved_text'] ?? ''),
        'coat_of_arms_url' => (string) ($node['coat_of_arms_url'] ?? ''),
        'map_assigned' => !empty($node['map_assigned']),
        'map_territory_count' => (int) ($node['map_territory_count'] ?? 0),
        'map_geometry_count' => (int) ($node['map_geometry_count'] ?? 0),
        'map_inactive_territory_count' => (int) ($node['map_inactive_territory_count'] ?? 0),
        'is_group' => (bool) $node['is_group'],
        'is_wiki_live' => true,
    ];
}

function avesmapsWikiSyncCollectPoliticalTreeTerritories(array $node, array &$territories): void {
    $territories[$node['public_id']] = $node;
    foreach (($node['children'] ?? []) as $child) {
        if (is_array($child)) {
            avesmapsWikiSyncCollectPoliticalTreeTerritories($child, $territories);
        }
    }
}

function avesmapsWikiSyncReadPoliticalTerritoryPath(array $row): array {
    $affiliation = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['affiliation'] ?? ''));
    if ($affiliation === '') {
        return [];
    }

    if (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath([$affiliation])) {
        return ["unabh\u{00E4}ngig"];
    }

    $clauses = array_values(array_filter(array_map(
        static fn(string $part): string => trim($part),
        preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $affiliation) ?: []
    )));

    $selectedClause = '';

    foreach ($clauses as $clause) {
        if (preg_match('/^politisch\b/iu', $clause) === 1) {
            $selectedClause = preg_replace('/^politisch\s*/iu', '', $clause) ?? $clause;
            break;
        }
    }

    if ($selectedClause === '') {
        foreach ($clauses as $clause) {
            if (preg_match('/^(?:ehemals|frueher|historisch)\b/iu', $clause) === 1) {
                continue;
            }

            if (preg_match('/^(?:geographisch|geografisch|derographisch)\b/iu', $clause) === 1) {
                continue;
            }

            $selectedClause = $clause;
            break;
        }
    }

    if ($selectedClause === '') {
        $selectedClause = $clauses[0] ?? $affiliation;
    }

    $parts = preg_split('/\s*:\s*/u', $selectedClause) ?: [];
    $path = [];

    foreach ($parts as $part) {
        $normalizedPart = avesmapsWikiSyncNormalizePoliticalPathPart($part);
        if ($normalizedPart !== '') {
            $path[] = $normalizedPart;
        }
    }

    $path = $path !== [] ? $path : ["ungekl\u{00E4}rt"];

    return avesmapsWikiSyncClassifyPoliticalTerritoryPath($path, $row);
}

function avesmapsWikiSyncClassifyPoliticalTerritoryPath(array $path, array $row): array {
    $name = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['name'] ?? ''));
    $nameLower = mb_strtolower($name, 'UTF-8');
    $nameKey = avesmapsWikiSyncCreateMatchKey($name);

    $normalizedPath = array_values(array_filter(array_map(
        static fn(mixed $part): string => avesmapsWikiSyncNormalizePoliticalPathPart((string) $part),
        $path
    ), static fn(string $part): bool => $part !== ''));

    $pathText = avesmapsWikiSyncNormalizeWikiTreeText(implode(' ', $normalizedPath));
    $pathKey = avesmapsWikiSyncCreateMatchKey($pathText);

    if (
        preg_match('/\bunabh(?:a|ae|\x{00E4})ngig\b/iu', $name) === 1
        || preg_match('/\bunabh(?:a|ae|\x{00E4})ngig\b/iu', $pathText) === 1
        || str_contains($nameKey, 'unabhangig')
        || str_contains($nameKey, 'unabhaengig')
        || str_contains($pathKey, 'unabhangig')
        || str_contains($pathKey, 'unabhaengig')
    ) {
        return ["unabhängig"];
    }

    if (
        preg_match('/\bumstritten\b|\bungekl(?:a|ae|\x{00E4})rt\b|\bunbekannt\b/iu', $name) === 1
        || preg_match('/\bumstritten\b|\bungekl(?:a|ae|\x{00E4})rt\b|\bunbekannt\b/iu', $pathText) === 1
        || str_contains($nameLower, '-kirche')
        || str_contains($nameLower, ' kirche')
        || str_contains($pathKey, 'umstritten')
        || str_contains($pathKey, 'ungeklart')
        || str_contains($pathKey, 'ungeklaert')
        || str_contains($pathKey, 'unbekannt')
    ) {
        return ['Sonstiges'];
    }

    return $normalizedPath !== [] ? $normalizedPath : [];
}

function avesmapsWikiSyncNormalizePoliticalPathPart(string $value): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($value);
    if ($normalized === '') {
        return '';
    }

    $normalized = preg_replace('/\([^)]*\)/u', '', $normalized) ?? $normalized;
    $normalized = preg_replace('/\[[^\]]*\]/u', '', $normalized) ?? $normalized;

    $normalized = preg_replace(
        '/^(?:politisch|sowie|und|zuvor|ehemals|frueher|historisch|vormals)\s+/iu',
        '',
        $normalized
    ) ?? $normalized;

    $normalized = preg_replace(
        '/^(?:unter\s+der\s+Herrschaft\s+(?:des|der)|beansprucht\s+(?:von|vom|durch)|benasprucht\s+(?:von|vom|durch))\s+/iu',
        '',
        $normalized
    ) ?? $normalized;

    $normalized = preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $normalized)[0] ?? $normalized;

    return trim($normalized, " \t\n\r\0\x0B,:;");
}

function avesmapsWikiSyncResolvePoliticalPathPart(array $rowIndex, string $part): string {
    $normalizedPart = avesmapsWikiSyncNormalizePoliticalPathPart($part);
    if ($normalizedPart === '') {
        return '';
    }

    $key = avesmapsWikiSyncMakePoliticalTreeKey($normalizedPart);
    if ($key !== '' && isset($rowIndex[$key]) && is_array($rowIndex[$key])) {
        return avesmapsWikiSyncCanonicalPoliticalPathPart($rowIndex[$key], $normalizedPart);
    }

    $candidateBeforeSemicolon = trim((string) (preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $normalizedPart)[0] ?? $normalizedPart));
    $candidateKey = avesmapsWikiSyncMakePoliticalTreeKey($candidateBeforeSemicolon);

    if ($candidateKey !== '' && isset($rowIndex[$candidateKey]) && is_array($rowIndex[$candidateKey])) {
        return avesmapsWikiSyncCanonicalPoliticalPathPart($rowIndex[$candidateKey], $candidateBeforeSemicolon);
    }

    return $normalizedPart;
}

function avesmapsWikiSyncCanonicalPoliticalPathPart(array $row, string $fallback): string {
    $canonicalName = avesmapsWikiSyncResolvePoliticalTerritoryName(
        (string) ($row['name'] ?? ''),
        (string) ($row['wiki_url'] ?? '')
    );

    return $canonicalName !== '' ? $canonicalName : $fallback;
} 

function avesmapsWikiSyncCanonicalizePoliticalTerritoryPath(array $path, array $rowIndex): array {
    $canonicalPath = [];
    $seenKeys = [];

    foreach ($path as $part) {
        $canonicalPart = avesmapsWikiSyncResolvePoliticalPathPart($rowIndex, (string) $part);
        if ($canonicalPart === '') {
            continue;
        }

        $canonicalKey = avesmapsWikiSyncMakePoliticalTreeKey($canonicalPart);
        if ($canonicalKey === '') {
            continue;
        }

        if (isset($seenKeys[$canonicalKey])) {
            continue;
        }

        $seenKeys[$canonicalKey] = true;
        $canonicalPath[] = $canonicalPart;
    }

    return $canonicalPath;
}

function avesmapsWikiSyncBuildPoliticalTerritoryRowIndex(array $rows): array {
    $index = [];
    foreach ($rows as $row) {
        $name = (string) ($row['name'] ?? '');
        $aliases = [
            $name,
            preg_replace('/\s*\([^)]*\)\s*$/u', '', $name) ?? $name,
        ];

        $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl((string) ($row['wiki_url'] ?? ''));
        if ($title !== '') {
            $aliases[] = $title;
        }

        foreach ($aliases as $alias) {
            $key = avesmapsWikiSyncMakePoliticalTreeKey((string) $alias);
            if ($key !== '' && !isset($index[$key])) {
                $index[$key] = $row;
            }
        }
    }

    return $index;
}

function avesmapsWikiSyncFormatPoliticalPeriod(array $row): string {
    $founded = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['founded_text'] ?? ''));
    $dissolved = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['dissolved_text'] ?? ''));
    if ($founded === '' && isset($row['founded_start_bf']) && $row['founded_start_bf'] !== null) {
        $founded = avesmapsWikiSyncFormatBfYear((int) $row['founded_start_bf']);
    }
    if ($dissolved === '' && isset($row['dissolved_end_bf']) && $row['dissolved_end_bf'] !== null) {
        $dissolved = avesmapsWikiSyncFormatBfYear((int) $row['dissolved_end_bf']);
    }
    if ($founded !== '' && $dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1 ? 'besteht seit ' . $founded : $founded . ' - ' . $dissolved;
    }
    if ($founded !== '') {
        return 'seit ' . $founded;
    }
    if ($dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1 ? 'besteht' : 'bis ' . $dissolved;
    }

    return '';
}

function avesmapsWikiSyncFormatBfYear(int $year): string {
    return avesmapsFormatBfYear($year);
}

function avesmapsWikiSyncComparePoliticalTreeNodes(array $left, array $right): int {
    $leftHasRow = $left['row'] === null ? 0 : 1;
    $rightHasRow = $right['row'] === null ? 0 : 1;
    if ($leftHasRow !== $rightHasRow) {
        return $leftHasRow <=> $rightHasRow;
    }

    return strnatcasecmp((string) $left['name'], (string) $right['name']);
}

function avesmapsWikiSyncMakePoliticalTreeKey(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($value);
}

function avesmapsWikiSyncNormalizeWikiTreeText(string $value): string {
    $decoded = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $decoded = preg_replace('/\s+/u', ' ', $decoded) ?? $decoded;

    return trim($decoded);
}
function avesmapsWikiSyncShouldForcePoliticalTerritoryRoot(array $row): bool {
    $name = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['name'] ?? ''));
    $type = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['type'] ?? ''));
    $wikiKey = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['wiki_key'] ?? ''));

    $label = trim($name . ' ' . $type . ' ' . $wikiKey);
    if ($label === '') {
        return false;
    }

    if (preg_match('/\b(?:Bergkönigreich|Bergkoenigreich|Bergkonigreich|Enklave)\b/iu', $label) === 1) {
        return true;
    }

    $key = avesmapsWikiSyncCreateMatchKey($label);

    return str_contains($key, 'bergkonigreich')
        || str_contains($key, 'bergkoenigreich')
        || str_contains($key, 'enklave');
}
