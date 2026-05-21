<?php

declare(strict_types=1);

function avesmapsWikiSyncReadPoliticalTerritoryDomTree(PDO $pdo, bool $forceRefresh = false): array {
    avesmapsWikiSyncRelaxLimits();

    $domRows = $forceRefresh ? avesmapsWikiSyncFetchDomTerritoryRows($pdo) : [];
    $rows = $domRows !== [] ? $domRows : avesmapsWikiSyncFetchPoliticalTerritoryRowsFromCache($pdo);
    if ($rows === []) $rows = avesmapsWikiSyncFetchDomTerritoryRows($pdo);

    $rows = avesmapsWikiSyncSanitizeDomPoliticalTerritoryRowsForTree($rows);
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments($rows, avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo));
    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows, false);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'source' => $domRows !== [] ? 'wiki-dom-prepared' : 'wiki-dom-cache',
        'source_page' => 'wiki-dom-sync-settings.html',
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
        'territories' => $tree['territories'],
        'hierarchy' => $tree['hierarchy'],
    ];
}

function avesmapsWikiSyncClearPoliticalTerritoryWikiTable(PDO $pdo): array {
    avesmapsWikiSyncRelaxLimits();
    avesmapsWikiSyncResetPoliticalTerritoryWikiTable($pdo);
    return [
        'ok' => true,
        'source' => 'wiki-dom-cache',
        'territory_count' => 0,
        'root_count' => 0,
        'assigned_territory_count' => 0,
        'assigned_root_count' => 0,
        'territories' => [],
        'hierarchy' => [],
        'message' => 'Wiki-Herrschaftsgebiettabelle wurde geleert.',
    ];
}

function avesmapsWikiSyncSyncTerritoriesFromDomCache(PDO $pdo, array $user, array $options = []): array {
    unset($user);
    avesmapsWikiSyncRelaxLimits();

    $dryRun = !empty($options['dry_run']);
    $resetTarget = !empty($options['reset_target']) && !empty($options['allow_reset_target']);
    $rows = avesmapsWikiSyncFetchDomTerritoryRows($pdo);
    if ($rows === []) throw new RuntimeException('Es liegen keine synchronisierten Herrschaftsgebiete vor.');

    $summary = ['dry_run' => $dryRun, 'reset_target' => $resetTarget, 'source_count' => count($rows), 'valid_count' => 0, 'created_count' => 0, 'updated_count' => 0, 'skipped_count' => 0, 'skipped' => []];
    if (!$dryRun && $resetTarget) avesmapsWikiSyncResetPoliticalTerritoryWikiTable($pdo);

    $promotedRows = [];
    foreach ($rows as $row) {
        if (trim((string) ($row['wiki_key'] ?? '')) === '' || trim((string) ($row['name'] ?? '')) === '') {
            $summary['skipped_count']++;
            $summary['skipped'][] = ['name' => (string) ($row['name'] ?? ''), 'reason' => 'wiki_key/name fehlt'];
            continue;
        }

        $summary['valid_count']++;
        $row['affiliation'] = (string) ($row['affiliation_raw'] ?? '');
        $row['map_assigned'] = false;
        $row['map_territory_count'] = 0;
        $row['map_geometry_count'] = 0;

        if (!$dryRun) {
            $upsert = avesmapsPoliticalUpsertWikiRecord($pdo, $row);
            $row['id'] = (int) ($upsert['id'] ?? 0);
            if (!empty($upsert['created'])) $summary['created_count']++;
            else $summary['updated_count']++;
        }
        $promotedRows[] = $row;
    }

    if (!$dryRun) $promotedRows = avesmapsWikiSyncFetchPoliticalTerritoryRowsFromCache($pdo);
    $promotedRows = avesmapsWikiSyncSanitizeDomPoliticalTerritoryRowsForTree($promotedRows);
    $promotedRows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments($promotedRows, avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo));
    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($promotedRows, false);
    $treeSummary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($promotedRows, $tree['hierarchy']);

    return ['ok' => true, 'source' => 'wiki-dom-cache', 'source_page' => 'wiki-dom-sync-settings.html', 'dry_run' => $dryRun, 'territory_count' => count($promotedRows), 'root_count' => count($tree['hierarchy']), 'assigned_territory_count' => $treeSummary['assigned_territory_count'], 'assigned_root_count' => $treeSummary['assigned_root_count'], 'sync' => $summary, 'territories' => $tree['territories'], 'hierarchy' => $tree['hierarchy']];
}

function avesmapsWikiSyncFetchDomTerritoryRows(PDO $pdo): array {
    $table = 'political_territory_wiki_' . 'test';
    $exists = $pdo->query("SHOW TABLES LIKE '" . $table . "'");
    if ($exists === false || $exists->fetchColumn() === false) return [];

    $statement = $pdo->query('SELECT * FROM ' . $table . ' ORDER BY COALESCE(continent, affiliation_root, name), COALESCE(affiliation_root, name), name');
    if ($statement === false) return [];

    $jsonFields = ['affiliation_path_json', 'affiliation_json', 'founded_json', 'dissolved_json', 'raw_json'];
    $intFields = ['id', 'founded_start_bf', 'founded_end_bf', 'dissolved_start_bf', 'dissolved_end_bf'];
    $floatFields = ['founded_display_bf', 'dissolved_display_bf'];
    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        foreach ($jsonFields as $field) if (array_key_exists($field, $row)) $row[$field] = avesmapsWikiSyncDecodeJson($row[$field] ?? null);
        foreach ($intFields as $field) if (isset($row[$field]) && $row[$field] !== '') $row[$field] = (int) $row[$field];
        foreach ($floatFields as $field) if (isset($row[$field]) && $row[$field] !== '') $row[$field] = (float) $row[$field];
        $rows[] = $row;
    }

    return $rows;
}

function avesmapsWikiSyncSanitizeDomPoliticalTerritoryRowsForTree(array $rows): array {
    return array_map(static function (array $row): array {
        $name = (string) ($row['name'] ?? '');
        $type = (string) ($row['type'] ?? '');

        if (avesmapsWikiSyncIsDomPoliticalRootTerritory($name, $type)) {
            $row['affiliation'] = '';
            $row['affiliation_root'] = '';
            $row['affiliation_path_json'] = [];
            return $row;
        }

        $path = [];
        if (is_array($row['affiliation_path_json'] ?? null)) {
            $path = array_values(array_filter(array_map(
                static fn(mixed $part): string => avesmapsWikiSyncNormalizeWikiTreeText((string) $part),
                $row['affiliation_path_json']
            ), static fn(string $part): bool => $part !== ''));
        }

        if ($path === []) {
            $path = avesmapsWikiSyncReadPoliticalTerritoryPath($row);
        }

        if (avesmapsWikiSyncIsDomUnresolvedPoliticalTerritoryPath($path)) {
            $path = [];
        } else {
            $path = avesmapsWikiSyncSanitizeDomPoliticalTerritoryPath($path);
        }

        $row['affiliation'] = implode(' : ', $path);
        $row['affiliation_root'] = $path[0] ?? '';
        $row['affiliation_path_json'] = $path;

        return $row;
    }, $rows);
}

function avesmapsWikiSyncSanitizeDomPoliticalTerritoryPath(array $path): array {
    $sanitized = [];
    $seen = [];

    foreach ($path as $part) {
        $normalizedPart = avesmapsWikiSyncNormalizeWikiTreeText((string) $part);
        if ($normalizedPart === '' || avesmapsWikiSyncIsInvalidDomSyntheticPoliticalPathPart($normalizedPart)) {
            continue;
        }

        $key = avesmapsWikiSyncCreateMatchKey($normalizedPart);
        if ($key === '' || isset($seen[$key])) {
            continue;
        }

        $seen[$key] = true;
        $sanitized[] = $normalizedPart;
    }

    return $sanitized;
}

function avesmapsWikiSyncIsDomUnresolvedPoliticalTerritoryPath(array $path): bool {
    if ($path === []) {
        return false;
    }

    foreach ($path as $part) {
        if (!avesmapsWikiSyncIsInvalidDomSyntheticPoliticalPathPart((string) $part)) {
            return false;
        }
    }

    return true;
}

function avesmapsWikiSyncIsDomPoliticalRootTerritory(string $name, string $type = ''): bool {
    $name = avesmapsWikiSyncNormalizeWikiTreeText($name);
    $type = avesmapsWikiSyncNormalizeWikiTreeText($type);
    $nameKey = avesmapsWikiSyncCreateMatchKey($name);
    $typeKey = avesmapsWikiSyncCreateMatchKey($type);
    $rawLabel = $name . ' ' . $type;

    if ($nameKey === '' && $typeKey === '' && trim($rawLabel) === '') {
        return false;
    }

    return preg_match('/\b(?:Bergkönigreich|Bergkoenigreich|Bergkonigreich|Enklave)\b/iu', $rawLabel) === 1
        || str_starts_with($nameKey, 'enklave')
        || str_starts_with($typeKey, 'enklave')
        || str_starts_with($nameKey, 'bergkonigreich')
        || str_starts_with($nameKey, 'bergkoenigreich')
        || str_starts_with($typeKey, 'bergkonigreich')
        || str_starts_with($typeKey, 'bergkoenigreich');
}

function avesmapsWikiSyncIsInvalidDomSyntheticPoliticalPathPart(string $part): bool {
    $part = avesmapsWikiSyncNormalizeWikiTreeText($part);
    if ($part === '') {
        return true;
    }

    if (preg_match('/^(?:\d{1,5}\s*(?:v\.\s*)?(?:BF|IZ)|\d{1,5})$/iu', $part) === 1) {
        return true;
    }

    if (preg_match('/\b(?:unabhängig|unabhaengig|ungeklärt|ungeklaert|unbekannt|ungewiss|umstritten|keine|keiner|kein|unklar)\b/iu', $part) === 1) {
        return true;
    }

    $key = avesmapsWikiSyncCreateMatchKey($part);
    $invalidKeys = [
        'aristrokatie',
        'aristokratie',
        'magokratie',
        'geldaristrokratie',
        'geldaristokratie',
        'boronkratie',
        'plutokratie',
        'feudalherrschaft',
        'matriachat',
        'matriarchat',
        'militarherrschaft',
        'militaerherrschaft',
        'oligarchie',
        'theokratie',
        'rondrakratie',
        'desoptie',
        'despotie',
        'unabhangig',
        'unabhaengig',
        'ungeklart',
        'ungeklaert',
        'ungeklärt',
        'unbekannt',
        'ungewiss',
        'umstritten',
        'keine',
        'keiner',
        'kein',
        'unklar',
    ];

    foreach ($invalidKeys as $invalidKey) {
        if ($key === $invalidKey || str_contains($key, $invalidKey)) {
            return true;
        }
    }

    return false;
}
