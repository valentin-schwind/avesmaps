<?php

declare(strict_types=1);

function avesmapsWikiSyncSyncTerritoriesFromDomCache(PDO $pdo, array $user, array $options = []): array {
    unset($user);
    avesmapsWikiSyncRelaxLimits();

    $dryRun = !empty($options['dry_run']);
    $resetTarget = !empty($options['reset_target']);
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
