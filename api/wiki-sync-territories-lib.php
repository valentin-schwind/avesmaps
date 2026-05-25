<?php

declare(strict_types=1);

// Territory-specific WikiSync helpers moved from wiki-sync.php
const AVESMAPS_WIKI_POLITICAL_DISPLAY_SUFFIXES = [
    'Staat',
    'Imperium',
    'Reich',
    'Kalifat',
];

function avesmapsWikiSyncReadPoliticalTerritoryTree(PDO $pdo, bool $forceRefresh = false): array {
    if ($forceRefresh) {
        $cachedTree = avesmapsWikiSyncReadPoliticalTerritoryTreeFromCache($pdo);
        if ($cachedTree !== null) {
            return $cachedTree;
        }

        return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTree($pdo);
    }

    if (avesmapsWikiSyncPoliticalTerritoryCacheNeedsRefresh($pdo)) {
        return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTree($pdo);
    }

    $cachedTree = avesmapsWikiSyncReadPoliticalTerritoryTreeFromCache($pdo);
    if ($cachedTree !== null) {
        return $cachedTree;
    }

    return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTree($pdo);
}

function avesmapsWikiSyncReadPoliticalTerritoryTreeFromWiki(PDO $pdo): array {
    avesmapsWikiSyncRelaxLimits();
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
        avesmapsWikiSyncFetchPoliticalTerritoryRowsFromWiki(),
        avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
    );
    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'source' => 'wiki-aventurica',
        'source_page' => avesmapsWikiSyncPageUrl('Staat/Liste'),
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
        'territories' => $tree['territories'],
        'hierarchy' => $tree['hierarchy'],
    ];
}

function avesmapsWikiSyncReadPoliticalTerritoryTreeSummary(PDO $pdo, bool $forceRefresh = false): array {
    if ($forceRefresh) {
        $cachedSummary = avesmapsWikiSyncReadPoliticalTerritoryTreeSummaryFromCache($pdo);
        if ($cachedSummary !== null) {
            return $cachedSummary;
        }

        return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTreeSummary($pdo);
    }

    if (avesmapsWikiSyncPoliticalTerritoryCacheNeedsRefresh($pdo)) {
        return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTreeSummary($pdo);
    }

    $cachedSummary = avesmapsWikiSyncReadPoliticalTerritoryTreeSummaryFromCache($pdo);
    if ($cachedSummary !== null) {
        return $cachedSummary;
    }

    return avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTreeSummary($pdo);
}

function avesmapsWikiSyncPoliticalTerritoryCacheNeedsRefresh(PDO $pdo): bool {
    $cachedCount = avesmapsWikiSyncCountCachedPoliticalTerritories($pdo);

    return $cachedCount <= 0;
}

function avesmapsWikiSyncCountCachedPoliticalTerritories(PDO $pdo): int {
    $statement = $pdo->prepare(
        'SELECT COUNT(*) AS territory_count
        FROM political_territory_wiki
        WHERE continent = :continent'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);

    return (int) ($statement->fetchColumn() ?: 0);
}

function avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTree(PDO $pdo, bool $resetCacheTable = false): array {
    $rows = avesmapsWikiSyncRefreshPoliticalTerritoryWikiCache($pdo, $resetCacheTable);
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
        $rows,
        avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
    );
    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'source' => 'wiki-aventurica-refreshed',
        'source_page' => avesmapsWikiSyncPageUrl('Staat/Liste'),
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
        'territories' => $tree['territories'],
        'hierarchy' => $tree['hierarchy'],
    ];
}

function avesmapsWikiSyncRefreshAndReadPoliticalTerritoryTreeSummary(PDO $pdo, bool $resetCacheTable = false): array {
    try {
        $rows = avesmapsWikiSyncRefreshPoliticalTerritoryWikiCache($pdo, $resetCacheTable);
        $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
            $rows,
            avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
        );
        $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows, false);
        $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

        return [
            'ok' => true,
            'territory_count' => count($rows),
            'root_count' => count($tree['hierarchy']),
            'assigned_territory_count' => $summary['assigned_territory_count'],
            'assigned_root_count' => $summary['assigned_root_count'],
        ];
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('political_territory_tree_summary_refresh_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);

        return [
            'ok' => false,
            'territory_count' => 0,
            'root_count' => 0,
            'assigned_territory_count' => 0,
            'assigned_root_count' => 0,
            'error' => 'Herrschaftsgebiets-Baum konnte nicht aktualisiert werden.',
        ];
    }
}

function avesmapsWikiSyncRefreshPoliticalTerritoryWikiCache(PDO $pdo, bool $resetTable = false): array {
    if ($resetTable) {
        avesmapsWikiSyncResetPoliticalTerritoryWikiTable($pdo);
    }

    $wikiRows = avesmapsWikiSyncFetchPoliticalTerritoryRowsFromWiki(true);

    foreach ($wikiRows as &$wikiRow) {
        $wikiRow['name'] = avesmapsWikiSyncResolvePoliticalTerritoryName(
            (string) ($wikiRow['name']  ''),
            (string) ($wikiRow['wiki_url']  '')
        );
    }
    unset($wikiRow);

    $rowIndex = avesmapsWikiSyncBuildPoliticalTerritoryRowIndex($wikiRows);
    $normalizedRowsByKey = [];

    foreach ($wikiRows as $row) { 
        $temporal = avesmapsWikiSyncBuildPoliticalTemporalPayload(
            (string) ($row['founded_text']  ''),
            (string) ($row['dissolved_text']  '')
        );
        $affiliationPath = avesmapsWikiSyncReadPoliticalTerritoryPath($row);

        if (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath($affiliationPath)) {
            $affiliationPath = [];
        } else {
            $affiliationPath = avesmapsWikiSyncCanonicalizePoliticalTerritoryPath($affiliationPath, $rowIndex);
        }

        $affiliationRoot = $affiliationPath[0]  '';

        $record = avesmapsPoliticalNormalizeWikiRecord([
            'Name' => (string) ($row['name']  ''),
            'Typ' => (string) ($row['type']  ''),
            'Kontinent' => (string) ($row['continent']  AVESMAPS_POLITICAL_DEFAULT_CONTINENT),
            'Zugehoerigkeit' => (string) ($row['affiliation']  ''),
            'Zugehoerigkeit-Root' => $affiliationRoot,
            'Zugehoerigkeit-Pfad' => implode(' > ', $affiliationPath),
            'Status' => (string) ($row['status']  ''),
            'Herrschaftsform' => (string) ($row['form_of_government']  ''),
            'Hauptstadt' => (string) ($row['capital_name']  ''),
            'Herrschaftssitz' => (string) ($row['seat_name']  ''),
            'Oberhaupt' => (string) ($row['ruler']  ''),
            'Sprache' => (string) ($row['language']  ''),
            'Waehrung' => (string) ($row['currency']  ''),
            'Handelswaren' => (string) ($row['trade_goods']  ''),
            'Einwohnerzahl' => (string) ($row['population']  ''),
            'Gruendungsdatum' => (string) $temporal['founded_text'],
            'Gruendungsdatum-Typ' => (string) $temporal['founded_type'],
            'Gruendungsdatum-StartBF' => (string) $temporal['founded_start_bf'],
            'Gruendungsdatum-EndBF' => (string) $temporal['founded_end_bf'],
            'Gruendungsdatum-AnzeigeBF' => (string) $temporal['founded_display_bf'],
            'Gruender' => (string) ($row['founder']  ''),
            'Aufgeloest' => (string) $temporal['dissolved_text'],
            'Aufgeloest-Typ' => (string) $temporal['dissolved_type'],
            'Aufgeloest-StartBF' => (string) $temporal['dissolved_start_bf'],
            'Aufgeloest-EndBF' => (string) $temporal['dissolved_end_bf'],
            'Aufgeloest-AnzeigeBF' => (string) $temporal['dissolved_display_bf'],
            'Blasonierung' => (string) ($row['blazon']  ''),
            'Wiki-Link' => (string) ($row['wiki_url']  ''),
            'Wappen-Link' => (string) ($row['coat_of_arms_url']  ''),
            'raw_json' => $row,
        ]);
        if ((string) ($record['wiki_key']  '') === '' || (string) ($record['name']  '') === '') {
            continue;
        }

        $record['founded_text'] = (string) $temporal['founded_text'];
        $record['founded_type'] = (string) $temporal['founded_type'];
        $record['founded_start_bf'] = (int) $temporal['founded_start_bf'];
        $record['founded_end_bf'] = (int) $temporal['founded_end_bf'];
        $record['founded_display_bf'] = (float) $temporal['founded_display_bf'];
        $record['dissolved_text'] = (string) $temporal['dissolved_text'];
        $record['dissolved_type'] = (string) $temporal['dissolved_type'];
        $record['dissolved_start_bf'] = (int) $temporal['dissolved_start_bf'];
        $record['dissolved_end_bf'] = (int) $temporal['dissolved_end_bf'];
        $record['dissolved_display_bf'] = (float) $temporal['dissolved_display_bf'];
        $record['affiliation_root'] = $affiliationRoot;
        $record['affiliation_path_json'] = $affiliationPath;

        $wikiKey = (string) ($record['wiki_key']  '');
        if (!isset($normalizedRowsByKey[$wikiKey])) {
            $normalizedRowsByKey[$wikiKey] = $record;
            continue;
        }

        $normalizedRowsByKey[$wikiKey] = avesmapsWikiSyncSelectPreferredPoliticalTerritoryRow(
            $normalizedRowsByKey[$wikiKey],
            $record
        );
    }

    $normalizedRows = array_values($normalizedRowsByKey);
    foreach ($normalizedRows as &$record) {
        $upsert = avesmapsPoliticalUpsertWikiRecord($pdo, $record);
        $record['id'] = (int) ($upsert['id']  0);
        $record['map_assigned'] = false;
        $record['map_territory_count'] = 0;
        $record['map_geometry_count'] = 0;
    }
    unset($record);

    return $normalizedRows;
}

function avesmapsWikiSyncSyncTerritories(PDO $pdo, array $user): array {
    unset($user);
    avesmapsWikiSyncRelaxLimits();

    $rows = avesmapsWikiSyncRefreshPoliticalTerritoryWikiCache($pdo, true);
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
        $rows,
        avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
    );
    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'source' => 'wiki-aventurica-refreshed',
        'source_page' => avesmapsWikiSyncPageUrl('Staat/Liste'),
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
        'territories' => $tree['territories'],
        'hierarchy' => $tree['hierarchy'],
    ];
}

function avesmapsWikiSyncResetPoliticalTerritoryWikiTable(PDO $pdo): void {
    $pdo->exec('DROP TABLE IF EXISTS political_territory_wiki');
    avesmapsPoliticalEnsureTables($pdo);
}

function avesmapsWikiSyncBuildPoliticalTemporalPayload(string $foundedTextRaw, string $dissolvedTextRaw): array {
    $foundedText = avesmapsWikiSyncNormalizePoliticalTemporalText($foundedTextRaw);
    $foundedYears = avesmapsWikiSyncExtractPoliticalBfYears($foundedText);
    $foundedStart = $foundedYears === []  0 : min($foundedYears);
    $foundedEnd = $foundedYears === []  $foundedStart : max($foundedYears);
    if ($foundedText === '') {
        $foundedText = avesmapsWikiSyncFormatBfYear($foundedStart);
    }

    $dissolvedText = avesmapsWikiSyncNormalizePoliticalTemporalText($dissolvedTextRaw);
    $dissolvedYears = avesmapsWikiSyncExtractPoliticalBfYears($dissolvedText);
    $isOngoing = $dissolvedText === ''
        || preg_match('/\bbesteht\b|\bbis\s+heute\b|\bgegenwart\b|\bheute\b/iu', $dissolvedText) === 1;

    if ($isOngoing) {
        $dissolvedStart = 9999;
        $dissolvedEnd = 9999;
        $dissolvedType = 'ongoing';
        $dissolvedText = $dissolvedText === ''  'besteht' : $dissolvedText;
    } elseif ($dissolvedYears !== []) {
        $dissolvedStart = min($dissolvedYears);
        $dissolvedEnd = max($dissolvedYears);
        $dissolvedType = count($dissolvedYears) > 1  'range' : 'exact';
    } else {
        $dissolvedStart = 9999;
        $dissolvedEnd = 9999;
        $dissolvedType = 'fallback_open';
        $dissolvedText = $dissolvedText === ''  'besteht' : $dissolvedText;
    }

    return [
        'founded_text' => $foundedText,
        'founded_type' => $foundedYears === []  'fallback' : (count($foundedYears) > 1  'range' : 'exact'),
        'founded_start_bf' => $foundedStart,
        'founded_end_bf' => $foundedEnd,
        'founded_display_bf' => avesmapsWikiSyncBuildPoliticalDisplayYear($foundedStart, $foundedEnd),
        'dissolved_text' => $dissolvedText,
        'dissolved_type' => $dissolvedType,
        'dissolved_start_bf' => $dissolvedStart,
        'dissolved_end_bf' => $dissolvedEnd,
        'dissolved_display_bf' => avesmapsWikiSyncBuildPoliticalDisplayYear($dissolvedStart, $dissolvedEnd),
    ];
}

function avesmapsWikiSyncNormalizePoliticalTemporalText(string $value): string {
    $clean = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $clean = preg_replace('/\s+/u', ' ', $clean)  $clean;
    return trim($clean);
}

function avesmapsWikiSyncExtractPoliticalBfYears(string $value): array {
    $years = [];
    if ($value === '') {
        return $years;
    }

    $matchCount = preg_match_all(
        '/(?:\b\d{1,2}\.\s*)?(?:(?:PRA|RON|EFF|TRA|BOR|HES|FIR|TSA|PHE|PER|ING|RAH|NAM)\s+)?(\d{1,5})\s*(v\.\s*BF|BF)\b/iu',
        $value,
        $matches,
        PREG_SET_ORDER
    );
    if ($matchCount === false || $matchCount < 1) {
        return $years;
    }

    foreach ($matches as $match) {
        $rawYear = isset($match[1])  (int) $match[1] : 0;
        if ($rawYear <= 0) {
            continue;
        }

        $isBefore = isset($match[2]) && preg_match('/v\.\s*BF/iu', (string) $match[2]) === 1;
        $years[] = $isBefore  -$rawYear : $rawYear;
    }

    return $years;
}

function avesmapsWikiSyncBuildPoliticalDisplayYear(int $startYear, int $endYear): float {
    if ($startYear === $endYear) {
        return (float) $startYear;
    }

    return ((float) $startYear + (float) $endYear) / 2.0;
}

function avesmapsWikiSyncReadPoliticalTerritoryTreeSummaryFromWiki(PDO $pdo): array {
    try {
        $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
            avesmapsWikiSyncFetchPoliticalTerritoryRowsFromWiki(false),
            avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
        );
        $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows, false);
        $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

        return [
            'ok' => true,
            'territory_count' => count($rows),
            'root_count' => count($tree['hierarchy']),
            'assigned_territory_count' => $summary['assigned_territory_count'],
            'assigned_root_count' => $summary['assigned_root_count'],
        ];
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('political_territory_tree_summary_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);

        return [
            'ok' => false,
            'territory_count' => 0,
            'root_count' => 0,
            'assigned_territory_count' => 0,
            'assigned_root_count' => 0,
            'error' => 'Herrschaftsgebiets-Baum konnte nicht gelesen werden.',
        ];
    }
}

function avesmapsWikiSyncReadPoliticalTerritoryTreeFromCache(PDO $pdo): ?array {
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
        avesmapsWikiSyncFetchPoliticalTerritoryRowsFromCache($pdo),
        avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
    );
    if ($rows === []) {
        return null;
    }

    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows, false);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'source' => 'database-cache',
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
        'territories' => $tree['territories'],
        'hierarchy' => $tree['hierarchy'],
    ];
}

function avesmapsWikiSyncReadPoliticalTerritoryTreeSummaryFromCache(PDO $pdo): ?array {
    $rows = avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(
        avesmapsWikiSyncFetchPoliticalTerritoryRowsFromCache($pdo),
        avesmapsWikiSyncReadPoliticalTerritoryMapAssignments($pdo)
    );
    if ($rows === []) {
        return null;
    }

    $tree = avesmapsWikiSyncBuildPoliticalTerritoryTree($rows, false);
    $summary = avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary($rows, $tree['hierarchy']);

    return [
        'ok' => true,
        'territory_count' => count($rows),
        'root_count' => count($tree['hierarchy']),
        'assigned_territory_count' => $summary['assigned_territory_count'],
        'assigned_root_count' => $summary['assigned_root_count'],
    ];
}

function avesmapsWikiSyncReadPoliticalTerritoryMapAssignments(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            wiki.wiki_key,
            COUNT(DISTINCT territory.id) AS territory_count,
            COUNT(geometry.id) AS geometry_count
        FROM political_territory_wiki wiki
        INNER JOIN political_territory territory
            ON territory.wiki_id = wiki.id
            AND territory.is_active = 1
        INNER JOIN political_territory_geometry geometry
            ON geometry.territory_id = territory.id
            AND geometry.is_active = 1
        WHERE wiki.continent = :continent
        GROUP BY wiki.wiki_key'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);

    $assignments = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $wikiKey = (string) ($row['wiki_key']  '');
        if ($wikiKey === '') {
            continue;
        }

        $assignments[$wikiKey] = [
            'territory_count' => (int) ($row['territory_count']  0),
            'geometry_count' => (int) ($row['geometry_count']  0),
        ];
    }

    return $assignments;
}

function avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(array $rows, array $assignments): array {
    return array_map(static function (array $row) use ($assignments): array {
        $assignment = $assignments[(string) ($row['wiki_key']  '')]  null;
        $geometryCount = (int) ($assignment['geometry_count']  0);

        $row['map_assigned'] = $geometryCount > 0;
        $row['map_territory_count'] = (int) ($assignment['territory_count']  0);
        $row['map_geometry_count'] = $geometryCount;

        return $row;
    }, $rows);
}

function avesmapsWikiSyncBuildPoliticalTerritoryTreeAssignmentSummary(array $rows, array $hierarchy): array {
    $assignedTerritoryCount = 0;
    foreach ($rows as $row) {
        if (!empty($row['map_assigned'])) {
            $assignedTerritoryCount++;
        }
    }

    $assignedRootCount = 0;
    foreach ($hierarchy as $node) {
        if (is_array($node) && !empty($node['map_assigned'])) {
            $assignedRootCount++;
        }
    }

    return [
        'assigned_territory_count' => $assignedTerritoryCount,
        'assigned_root_count' => $assignedRootCount,
    ];
}

function avesmapsWikiSyncFetchPoliticalTerritoryRowsFromCache(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            id,
            wiki_key,
            name,
            type,
            continent,
            affiliation_raw,
            affiliation_root,
            affiliation_path_json,
            affiliation_json,
            status,
            form_of_government,
            capital_name,
            seat_name,
            ruler,
            language,
            currency,
            trade_goods,
            population,
            founded_text,
            founded_start_bf,
            founder,
            dissolved_text,
            dissolved_type,
            dissolved_end_bf,
            blazon,
            wiki_url,
            coat_of_arms_url
        FROM political_territory_wiki
        WHERE continent = :continent
        ORDER BY affiliation_root ASC, name ASC'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    return array_map(static function (array $row): array {
        return [
            'id' => (int) ($row['id']  0),
            'wiki_key' => (string) ($row['wiki_key']  ''),
            'name' => (string) ($row['name']  ''),
            'type' => (string) ($row['type']  ''),
            'continent' => (string) ($row['continent']  ''),
            'affiliation' => (string) ($row['affiliation_raw']  ''),
            'affiliation_raw' => (string) ($row['affiliation_raw']  ''),
            'affiliation_root' => (string) ($row['affiliation_root']  ''),
            'affiliation_path_json' => avesmapsWikiSyncDecodeJson($row['affiliation_path_json']  null),
            'affiliation_json' => avesmapsWikiSyncDecodeJson($row['affiliation_json']  null),
            'status' => (string) ($row['status']  ''),
            'form_of_government' => (string) ($row['form_of_government']  ''),
            'capital_name' => (string) ($row['capital_name']  ''),
            'seat_name' => (string) ($row['seat_name']  ''),
            'ruler' => (string) ($row['ruler']  ''),
            'language' => (string) ($row['language']  ''),
            'currency' => (string) ($row['currency']  ''),
            'trade_goods' => (string) ($row['trade_goods']  ''),
            'population' => (string) ($row['population']  ''),
            'founded_text' => (string) ($row['founded_text']  ''),
            'founded_start_bf' => isset($row['founded_start_bf'])  (int) $row['founded_start_bf'] : null,
            'founder' => (string) ($row['founder']  ''),
            'dissolved_text' => (string) ($row['dissolved_text']  ''),
            'dissolved_type' => (string) ($row['dissolved_type']  ''),
            'dissolved_end_bf' => isset($row['dissolved_end_bf'])  (int) $row['dissolved_end_bf'] : null,
            'blazon' => (string) ($row['blazon']  ''),
            'wiki_url' => (string) ($row['wiki_url']  ''),
            'coat_of_arms_url' => (string) ($row['coat_of_arms_url']  ''),
        ];
    }, $rows);
}

function avesmapsWikiSyncFetchPoliticalTerritoryRowsFromWiki(bool $includeDetails = true): array {
    $rowsByKey = [];

    foreach (AVESMAPS_WIKI_POLITICAL_TERRITORY_SEED_PAGES as $pageTitle) {
        try {
            $html = avesmapsWikiSyncFetchParsedWikiHtml($pageTitle);
            $pageRows = avesmapsWikiSyncParsePoliticalTerritoryRowsFromHtml($html);
        } catch (Throwable $exception) {
            avesmapsWikiSyncLogServerError('political_territory_seed_page_error', [
                'page_title' => $pageTitle,
                'exception_class' => $exception::class,
                'exception_message' => $exception->getMessage(),
            ]);
            continue;
        }

        foreach ($pageRows as $row) {
            $name = (string) ($row['name']  '');
            if ($name === '') {
                continue;
            }

            $key = avesmapsWikiSyncCreatePoliticalTerritoryRowIdentityKey($row);
            if ($key === '') {
                continue;
            }

            if (!isset($rowsByKey[$key])) {
                $rowsByKey[$key] = $row;
                continue;
            }

            $rowsByKey[$key] = avesmapsWikiSyncSelectPreferredPoliticalTerritoryRow($rowsByKey[$key], $row);
        }
    }

    $rows = array_values($rowsByKey);
    if ($rows === []) {
        throw new RuntimeException('Aus den Herrschaftsgebiets-Listen konnten keine Herrschaftsgebiete gelesen werden.');
    }

    return $includeDetails  avesmapsWikiSyncEnrichPoliticalTerritoryRowsFromWiki($rows) : $rows;
}

function avesmapsWikiSyncSelectPreferredPoliticalTerritoryRow(array $currentRow, array $candidateRow): array {
    $currentScore = avesmapsWikiSyncScorePoliticalTerritoryRow($currentRow);
    $candidateScore = avesmapsWikiSyncScorePoliticalTerritoryRow($candidateRow);
    if ($candidateScore > $currentScore) {
        return $candidateRow;
    }

    return $currentRow;
}

function avesmapsWikiSyncScorePoliticalTerritoryRow(array $row): int {
    $score = 0;
    if (trim((string) ($row['wiki_url']  '')) !== '') {
        $score += 120;
    }

    $name = trim((string) ($row['name']  ''));
    if ($name !== '') {
        $score += 40;
        if (!str_contains($name, ';') && !str_contains($name, ',')) {
            $score += 15;
        }
    }

    $affiliation = trim((string) ($row['affiliation']  ''));
    if ($affiliation !== '') {
        $clauses = preg_split('/\s*[;·]\s*/u', $affiliation) ?: [];
        $bestClauseScore = -100;
        foreach ($clauses as $clause) {
            $parts = array_values(array_filter(array_map(
                static fn(string $part): string => avesmapsWikiSyncNormalizePoliticalPathPart($part),
                preg_split('/\s*:\s*/u', (string) $clause) ?: []
            ), static fn(string $part): bool => $part !== ''));
            if ($parts === []) {
                continue;
            }

            $clauseScore = count($parts) * 12;
            $firstPartKey = avesmapsWikiSyncCreateMatchKey((string) ($parts[0]  ''));
            if (in_array($firstPartKey, ['unabhangig', 'umstritten', 'ungeklart'], true)) {
                $clauseScore -= 30;
            } else {
                $clauseScore += 10;
            }

            $bestClauseScore = max($bestClauseScore, $clauseScore);
        }

        if ($bestClauseScore > -100) {
            $score += $bestClauseScore;
        }
    }

    foreach (['status', 'form_of_government', 'capital_name', 'seat_name', 'founded_text', 'dissolved_text'] as $field) {
        if (trim((string) ($row[$field]  '')) !== '') {
            $score += 3;
        }
    }

    return $score;
}

function avesmapsWikiSyncCreatePoliticalTerritoryRowIdentityKey(array $row): string {
    $wikiUrl = trim((string) ($row['wiki_url']  ''));
    if ($wikiUrl !== '') {
        $wikiTitle = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl($wikiUrl);
        if ($wikiTitle !== '') {
            return 'wiki_title|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($wikiTitle);
        }

        return 'wiki_url|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($wikiUrl);
    }

    $name = trim((string) ($row['name']  ''));
    if ($name === '') {
        return '';
    }

    $type = trim((string) ($row['type']  ''));
    return 'name|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($name)
        . '|type|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($type);
}

function avesmapsWikiSyncEnrichPoliticalTerritoryRowsFromWiki(array $rows): array {
    $titlesByIndex = [];
    $titles = [];
    foreach ($rows as $index => $row) {
        $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl((string) ($row['wiki_url']  ''));
        if ($title === '') {
            $title = (string) ($row['name']  '');
        }
        if ($title === '') {
            continue;
        }

        $titlesByIndex[$index] = $title;
        $titles[$title] = $title;
    }

    if ($titles === []) {
        return $rows;
    }

    try {
        $contentsByTitle = avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_values($titles));
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('political_territory_detail_enrichment_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);

        return $rows;
    }

    $discoveredChildRowsByKey = [];

    foreach ($titlesByIndex as $index => $title) {
        $content = $contentsByTitle[$title]  '';
        if ($content === '') {
            continue;
        }

        $details = avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent($content);
        $childTerritories = is_array($details['child_territories']  null)
             $details['child_territories']
            : [];
        unset($details['child_territories']);

        foreach ($details as $key => $value) {
            if ($value === '') {
                continue;
            }
            $currentValue = (string) ($rows[$index][$key]  '');
            if (avesmapsWikiSyncShouldUsePoliticalTerritoryDetailValue($key, $currentValue, (string) $value)) {
                $rows[$index][$key] = $value;
            }
        }

        foreach (avesmapsWikiSyncBuildPoliticalTerritoryChildRows($childTerritories, $rows[$index]) as $childRow) {
            $keySource = (string) ($childRow['wiki_url']  $childRow['name']  '');
            $childKey = avesmapsWikiSyncCreateMatchKey($keySource);

            if ($childKey === '') {
                continue;
            }

            if (!isset($discoveredChildRowsByKey[$childKey])) {
                $discoveredChildRowsByKey[$childKey] = $childRow;
                continue;
            }

            $discoveredChildRowsByKey[$childKey] = avesmapsWikiSyncSelectPreferredPoliticalTerritoryRow(
                $discoveredChildRowsByKey[$childKey],
                $childRow
            );
        }
    }

    if ($discoveredChildRowsByKey !== []) {
        $rows = array_merge($rows, array_values($discoveredChildRowsByKey));
    }

    return $rows;
}

function avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array $titles): array {
    $contentsByTitle = [];
    foreach (array_chunk($titles, AVESMAPS_WIKI_TITLE_BATCH_SIZE) as $batch) {
        $data = avesmapsWikiSyncApiRequest([
            'action' => 'query',
            'titles' => implode('|', $batch),
            'redirects' => '1',
            'prop' => 'revisions',
            'rvprop' => 'content',
            'rvslots' => 'main',
        ]);

        $query = $data['query']  [];
        $normalizedTitles = [];
        foreach (($query['normalized']  []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $normalizedTitles[(string) $item['from']] = (string) $item['to'];
            }
        }

        $redirectTitles = [];
        foreach (($query['redirects']  []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $redirectTitles[(string) $item['from']] = (string) $item['to'];
            }
        }

        $pagesByTitle = [];
        foreach (($query['pages']  []) as $page) {
            if (!empty($page['title']) && empty($page['missing'])) {
                $pagesByTitle[(string) $page['title']] = $page;
            }
        }

        foreach ($batch as $requestedTitle) {
            $normalizedTitle = $normalizedTitles[$requestedTitle]  $requestedTitle;
            $resolvedTitle = $redirectTitles[$normalizedTitle]  $redirectTitles[$requestedTitle]  $normalizedTitle;
            $page = $pagesByTitle[$resolvedTitle]  null;
            if (is_array($page)) {
                $contentsByTitle[$requestedTitle] = avesmapsWikiSyncReadPageContent($page);
            }
        }
    }

    return $contentsByTitle;
}

function avesmapsWikiSyncPoliticalTerritoryTitleFromUrl(string $wikiUrl): string {
    if ($wikiUrl === '') {
        return '';
    }

    $path = (string) (parse_url($wikiUrl, PHP_URL_PATH)  '');
    $marker = '/wiki/';
    $position = strpos($path, $marker);
    if ($position === false) {
        return '';
    }

    $title = substr($path, $position + strlen($marker));
    $title = rawurldecode($title);
    $title = str_replace('_', ' ', $title);

    return trim($title);
}

function avesmapsWikiSyncResolvePoliticalTerritoryName(string $rawName, string $wikiUrl): string {
    $normalizedRawName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($rawName);
    $canonicalTitle = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl($wikiUrl);
    $normalizedCanonicalName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($canonicalTitle);

    if ($normalizedRawName === '') {
        return $normalizedCanonicalName;
    }

    if ($normalizedCanonicalName === '') {
        return $normalizedRawName;
    }

    if (
        avesmapsWikiSyncHasTrailingParentheticalSuffix($normalizedRawName)
        && !avesmapsWikiSyncHasTrailingParentheticalSuffix($normalizedCanonicalName)
    ) {
        return $normalizedRawName;
    }

    return $normalizedCanonicalName;
}

function avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent(string $content): array {
    $fields = avesmapsWikiSyncReadWikiTemplateFields($content);
    $details = [];
    $childTerritoriesByKey = [];

    $fieldMap = [
        'typ' => 'type',
        'art' => 'type',
        'herrschaftsgebiet' => 'type',
        'status' => 'status',
        'herrschaftsform' => 'form_of_government',
        'hauptstadt' => 'capital_name',
        'herrschaftssitz' => 'seat_name',
        'oberhaupt' => 'ruler',
        'sprache' => 'language',
        'wahrung' => 'currency',
        'waehrung' => 'currency',
        'handelswaren' => 'trade_goods',
        'kontinent' => 'continent',
        'grundungsdatum' => 'founded_text',
        'gruendungsdatum' => 'founded_text',
        'grundung' => 'founded_text',
        'gruendung' => 'founded_text',
        'gegrundet' => 'founded_text',
        'gegruendet' => 'founded_text',
        'neugrundung' => 'founded_text',
        'neugruendung' => 'founded_text',
        'zeitraum' => 'period_text',
        'bestandszeit' => 'period_text',
        'bestehen' => 'period_text',
        'bestand' => 'period_text',
        'aufgelost' => 'dissolved_text',
        'aufgeloest' => 'dissolved_text',
        'auflosung' => 'dissolved_text',
        'aufloesung' => 'dissolved_text',
        'grunder' => 'founder',
        'gruender' => 'founder',
        'blasonierung' => 'blazon',
        'wappen' => 'coat_of_arms_url',
        'wappenlink' => 'coat_of_arms_url',
        'wappenbild' => 'coat_of_arms_url',
        'wappendatei' => 'coat_of_arms_url',
        'wappenbilddatei' => 'coat_of_arms_url',
        'wappenabbildung' => 'coat_of_arms_url',
    ];

    $childFieldKeys = [
        'provinz',
        'provinzen',
        'unterregion',
        'unterregionen',
        'untergliederung',
        'untergliederungen',
        'verwaltungseinheit',
        'verwaltungseinheiten',
        'verwaltungsgebiet',
        'verwaltungsgebiete',
        'lehen',
        'lehensgebiete',
        'grafschaft',
        'grafschaften',
        'landgrafschaft',
        'landgrafschaften',
        'markgrafschaft',
        'markgrafschaften',
        'baronie',
        'baronien',
        'freiherrschaft',
        'freiherrschaften',
        'herzogtum',
        'herzogtumer',
        'herzogtuemer',
        'furstentum',
        'fuerstentum',
        'furstentumer',
        'fuerstentuemer',
    ];

    foreach ($fields as $rawKey => $rawValue) {
        $key = avesmapsWikiSyncCreateMatchKey($rawKey);

        if (in_array($key, $childFieldKeys, true)) {
            foreach (avesmapsWikiSyncExtractPoliticalTerritoryChildReferences($rawValue) as $childReference) {
                $childKeySource = (string) ($childReference['wiki_url']  $childReference['name']  '');
                $childKey = avesmapsWikiSyncCreateMatchKey($childKeySource);

                if ($childKey === '') {
                    continue;
                }

                $childReference['source_field'] = (string) $rawKey;
                $childTerritoriesByKey[$childKey] = $childReference;
            }

            continue;
        }

        $targetKey = $fieldMap[$key]  null;
        if ($targetKey === null) {
            continue;
        }

        $value = $targetKey === 'coat_of_arms_url'
             avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl($rawValue)
            : avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($rawValue);
        if ($value !== '' && !isset($details[$targetKey])) {
            $details[$targetKey] = $value;
        }
    }

    if ($childTerritoriesByKey !== []) {
        $details['child_territories'] = array_values($childTerritoriesByKey);
    }

    if (
        isset($details['period_text'])
        && (string) ($details['founded_text']  '') === ''
        && (string) ($details['dissolved_text']  '') === ''
    ) {
        [$foundedText, $dissolvedText] = avesmapsWikiSyncSplitPoliticalPeriodText((string) $details['period_text']);
        if ($foundedText !== '') {
            $details['founded_text'] = $foundedText;
        }
        if ($dissolvedText !== '') {
            $details['dissolved_text'] = $dissolvedText;
        }
    }

    return $details;
}

function avesmapsWikiSyncSplitPoliticalPeriodText(string $periodText): array {
    $normalized = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($periodText);
    if ($normalized === '') {
        return ['', ''];
    }

    $parts = preg_split('/\s*(?:-|–|—|bis)\s*/u', $normalized) ?: [];
    if (count($parts) >= 2) {
        return [trim((string) $parts[0]), trim((string) $parts[1])];
    }

    return [$normalized, ''];
}

function avesmapsWikiSyncReadWikiTemplateFields(string $content): array {
    $fields = [];
    $currentKey = null;
    $currentValue = '';
    $lines = preg_split('/\R/u', $content) ?: [];

    foreach ($lines as $line) {
        if (preg_match('/^\|\s*([^=]+ )\s*=\s*(.*)$/u', $line, $matches) === 1) {
            if ($currentKey !== null) {
                $fields[$currentKey] = trim($currentValue);
            }

            $currentKey = trim((string) $matches[1]);
            $currentValue = trim((string) $matches[2]);
            continue;
        }

        if ($currentKey !== null) {
            if (preg_match('/^\s*\}\}/u', $line) === 1) {
                $fields[$currentKey] = trim($currentValue);
                break;
            }

            $currentValue .= "\n" . $line;
        }
    }

    if ($currentKey !== null) {
        $fields[$currentKey] = trim($currentValue);
    }

    return $fields;
}

function avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(string $value): string {
    $value = preg_replace('/<!--.*?-->/su', ' ', $value)  $value;
    $value = preg_replace('/<ref\b[^>]*>.*?<\/ref>/isu', ' ', $value)  $value;
    $value = preg_replace('/<ref\b[^\/>]*\/>/isu', ' ', $value)  $value;
    $value = preg_replace('/&\d{10,}\s*/u', '', $value)  $value;
    $value = preg_replace('/\[\[Datei:[^\]]+\]\]/iu', ' ', $value)  $value;
    $value = preg_replace('/\[\[File:[^\]]+\]\]/iu', ' ', $value)  $value;
    $value = preg_replace_callback('/\{\{Datum\|([^{}]+)\}\}/iu', static function (array $matches): string {
        return avesmapsWikiSyncFormatPoliticalTerritoryDateTemplate((string) $matches[1]);
    }, $value)  $value;
    $value = preg_replace('/\[\[[^|\]]+\|([^\]]+)\]\]/u', '$1', $value)  $value;
    $value = preg_replace('/\[\[([^\]]+)\]\]/u', '$1', $value)  $value;
    $value = preg_replace('/\{\{[^{}|]+\|([^{}]+)\}\}/u', '$1', $value)  $value;
    $value = preg_replace('/\{\{[^{}]*\}\}/u', ' ', $value)  $value;
    $value = str_replace(["'''", "''", '<br>', '<br/>', '<br />'], [' ', ' ', ' ', ' ', ' '], $value);
    $value = strip_tags($value);
    $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value)  $value;

    return trim($value, " \t\n\r\0\x0B,;");
}

function avesmapsWikiSyncFormatPoliticalTerritoryDateTemplate(string $templateBody): string {
    $parts = array_values(array_filter(array_map(
        static fn(string $part): string => trim($part),
        explode('|', $templateBody)
    ), static fn(string $part): bool => $part !== ''));

    if (count($parts) >= 4) {
        return $parts[0] . '. ' . $parts[1] . ' ' . $parts[2] . ' ' . $parts[3];
    }

    return implode(' ', $parts);
}

function avesmapsWikiSyncFetchParsedWikiHtml(string $pageTitle): string {
    $data = avesmapsWikiSyncApiRequest([
        'action' => 'parse',
        'page' => $pageTitle,
        'prop' => 'text',
        'disablelimitreport' => '1',
    ]);

    $text = $data['parse']['text']  '';
    if (is_array($text)) {
        $text = (string) ($text['*']  '');
    }

    if (!is_string($text) || trim($text) === '') {
        throw new RuntimeException("Wiki Aventurica hat fuer {$pageTitle} kein HTML geliefert.");
    }

    return $text;
}

function avesmapsWikiSyncParsePoliticalTerritoryRowsFromHtml(string $html): array {
    if (!class_exists(DOMDocument::class)) {
        throw new RuntimeException('Die PHP-DOM-Erweiterung fehlt fuer den Wiki-HTML-Import.');
    }

    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    $tables = $document->getElementsByTagName('table');
    $bestRows = [];
    $bestScore = -1;

    foreach ($tables as $table) {
        if (!$table instanceof DOMElement) {
            continue;
        }

        $parsedRows = avesmapsWikiSyncParsePoliticalTerritoryTable($table);
        if ($parsedRows === []) {
            continue;
        }

        $headers = array_keys($parsedRows[0]['raw']  []);
        $score = count($parsedRows);
        if (in_array('name', $headers, true)) {
            $score += 1000;
        }
        if (in_array('art', $headers, true) || in_array('typ', $headers, true)) {
            $score += 500;
        }
        if (in_array('staat', $headers, true) || in_array('zugehorigkeit', $headers, true)) {
            $score += 500;
        }

        if ($score > $bestScore) {
            $bestScore = $score;
            $bestRows = $parsedRows;
        }
    }

    return array_map(
        static fn(array $row): array => $row['public'],
        $bestRows
    );
}

function avesmapsWikiSyncParsePoliticalTerritoryTable(DOMElement $table): array {
    $rows = [];
    $headers = [];
    $rowSpanCells = [];

    foreach ($table->getElementsByTagName('tr') as $tableRow) {
        if (!$tableRow instanceof DOMElement) {
            continue;
        }

        $directCells = avesmapsWikiSyncReadTableCells($tableRow);
        $cells = avesmapsWikiSyncReadTableGridCells($tableRow, $rowSpanCells);
        if ($cells === []) {
            continue;
        }

        $isHeaderRow = false;
        foreach ($directCells as $cell) {
            if (strtolower($cell->tagName) === 'th') {
                $isHeaderRow = true;
                break;
            }
        }

        if ($isHeaderRow || $headers === []) {
            $candidateHeaders = array_map(
                static fn(DOMElement $cell): string => avesmapsWikiSyncNormalizePoliticalHeader($cell->textContent),
                $cells
            );
            if (in_array('name', $candidateHeaders, true)) {
                $headers = $candidateHeaders;
                continue;
            }
        }

        if ($headers === [] || count($cells) < 2) {
            continue;
        }

        $raw = [];
        foreach ($cells as $index => $cell) {
            $header = $headers[$index]  "spalte_{$index}";
            $raw[$header] = avesmapsWikiSyncNormalizeWikiTreeText($cell->textContent);
        }

        $name = $raw['name']  '';
        if ($name === '') {
            continue;
        }

        $nameCellIndex = array_search('name', $headers, true);
        if (!is_int($nameCellIndex)) {
            $nameCellIndex = 0;
        }

        $nameCell = $cells[$nameCellIndex]  $cells[0]  null;
        if (!$nameCell instanceof DOMElement) {
            continue;
        }

        $nameLink = avesmapsWikiSyncReadFirstWikiLinkMetadata($nameCell);
        $canonicalName = avesmapsWikiSyncNormalizeWikiTreeText((string) ($nameLink['title']  ''));
        if ($canonicalName !== '') {
            $name = $canonicalName;
        }

        $wikiUrl = (string) ($nameLink['url']  '');
        if ($wikiUrl === '' && $name !== '') {
            $wikiUrl = avesmapsWikiSyncPageUrl($name);
        }

        $rows[] = [
            'raw' => $raw,
            'public' => [
                'name' => $name,
                'type' => $raw['typ']  $raw['art']  '',
                'affiliation' => $raw['zugehorigkeit']  $raw['staat']  '',
                'status' => $raw['status']  '',
                'form_of_government' => $raw['herrschaftsform']  '',
                'capital_name' => $raw['hauptstadt']  '',
                'seat_name' => $raw['herrschaftssitz']  '',
                'ruler' => $raw['oberhaupt']  '',
                'language' => $raw['sprache']  '',
                'currency' => $raw['wahrung']  $raw['waehrung']  '',
                'trade_goods' => $raw['handelswaren']  '',
                'population' => $raw['einwohnerzahl']  '',
                'founded_text' => $raw['grundungsdatum']  '',
                'founder' => $raw['grunder']  $raw['gruender']  '',
                'dissolved_text' => $raw['aufgelost']  '',
                'blazon' => $raw['blasonierung']  '',
                'wiki_url' => $wikiUrl,
            ],
        ];
    }

    return $rows;
}

function avesmapsWikiSyncShouldUsePoliticalTerritoryDetailValue(string $key, string $currentValue, string $candidateValue): bool {
    $current = trim($currentValue);
    $candidate = trim($candidateValue);
    if ($candidate === '') {
        return false;
    }

    if ($current === '') {
        return true;
    }

    if (avesmapsWikiSyncIsPoliticalTerritoryPlaceholderValue($current)) {
        return true;
    }

    if (in_array($key, ['founded_text', 'dissolved_text'], true)) {
        $currentHasYear = preg_match('/\d/u', $current) === 1;
        $candidateHasYear = preg_match('/\d/u', $candidate) === 1;
        if (!$currentHasYear && $candidateHasYear) {
            return true;
        }
    }

    return false;
}

function avesmapsWikiSyncIsPoliticalTerritoryPlaceholderValue(string $value): bool {
    $normalized = mb_strtolower(trim($value));
    if ($normalized === '') {
        return true;
    }

    if (in_array($normalized, ['-', '–', '—', '?', 'k.a.', 'k. a.', 'n/a', 'na', 'keine', 'unbekannt'], true)) {
        return true;
    }

    return preg_match('/^(?:nicht\s+bekannt|unbekannt|ohne\s+angabe)$/u', $normalized) === 1;
}

function avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    if (preg_match('/https?:\/\/\S+/iu', $value, $urlMatch) === 1) {
        return trim((string) $urlMatch[0]);
    }

    if (preg_match('/\[\[(?:Datei|File)\s*:\s*([^|\]#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/iu', $value, $fileMatch) === 1) {
        $fileTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) $fileMatch[1]);
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($fileTitle);
    }

    if (preg_match('/\{\{[Ii]nfoboxbild\|([^|}]+)(?:\|[^}]*)?\}\}/u', $value, $templateMatch) === 1) {
        $fileTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) $templateMatch[1]);
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($fileTitle);
    }

    $cleanedValue = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
    if (str_contains($cleanedValue, '.')) {
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($cleanedValue);
    }

    return '';
}

function avesmapsWikiSyncPoliticalTerritoryFilePathUrl(string $fileTitle): string {
    $normalizedTitle = avesmapsWikiSyncNormalizeWikiTreeText($fileTitle);
    if ($normalizedTitle === '') {
        return '';
    }

    $normalizedTitle = preg_replace('/^(?:Datei|File)\s*:\s*/iu', '', $normalizedTitle)  $normalizedTitle;
    $normalizedTitle = str_replace('_', ' ', $normalizedTitle);

    return AVESMAPS_WIKI_PAGE_BASE_URL . 'Spezial:Dateipfad/' . str_replace('%2F', '/', rawurlencode($normalizedTitle));
}

function avesmapsWikiSyncExtractPoliticalTerritoryChildReferences(string $rawValue): array {
    $value = trim($rawValue);
    if ($value === '') {
        return [];
    }

    $referencesByKey = [];
    $listDefaultType = avesmapsWikiSyncInferPoliticalTerritoryTypeFromListContext($value);

    if (preg_match_all('/\[\[([^|\]#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/u', $value, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) !== false) {
        foreach ($matches as $match) {
            $fullMatch = (string) ($match[0][0]  '');
            $matchOffset = (int) ($match[0][1]  0);
            $pageTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[1][0]  ''));
            $displayText = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[2][0]  ''));

            if ($pageTitle === '' || avesmapsWikiSyncIsIgnoredPoliticalTerritoryLinkTitle($pageTitle)) {
                continue;
            }

            $nameSource = $displayText !== ''  $displayText : $pageTitle;
            $name = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($nameSource);

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
                $contextualName = avesmapsWikiSyncBuildContextualPoliticalTerritoryName(
                    $value,
                    $matchOffset,
                    $fullMatch,
                    $name
                );

                if ($contextualName !== '') {
                    $name = $contextualName;
                }
            }

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name) && $listDefaultType !== '') {
                $typedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($listDefaultType . ' ' . $name);
                if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($typedName)) {
                    $name = $typedName;
                }
            }

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
                continue;
            }

            $reference = [
                'name' => $name,
                'type' => avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($name),
                'wiki_url' => avesmapsWikiSyncPageUrl($pageTitle),
                'wiki_title' => $pageTitle,
            ];

            $key = avesmapsWikiSyncCreateMatchKey((string) $reference['name']);
            if ($key === '') {
                $key = avesmapsWikiSyncCreateMatchKey((string) $reference['wiki_url']);
            }
            if ($key !== '') {
                $referencesByKey[$key] = $reference;
            }
        }
    }

    $cleanedValue = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
    $parts = preg_split('/\s*(?:,|;|·|\n|\r)\s*/u', $cleanedValue) ?: [];

    foreach ($parts as $part) {
        $name = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($part);

        if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name) && $listDefaultType !== '') {
            $typedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($listDefaultType . ' ' . $name);
            if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($typedName)) {
                $name = $typedName;
            }
        }

        if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
            continue;
        }

        $reference = [
            'name' => $name,
            'type' => avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($name),
            'wiki_url' => avesmapsWikiSyncPageUrl($name),
            'wiki_title' => $name,
        ];

        $key = avesmapsWikiSyncCreateMatchKey((string) $reference['name']);
        if ($key === '') {
            $key = avesmapsWikiSyncCreateMatchKey((string) $reference['wiki_url']);
        }
        if ($key === '') {
            continue;
        }

        $existing = $referencesByKey[$key]  null;
        if (!is_array($existing)) {
            $referencesByKey[$key] = $reference;
            continue;
        }

        if (trim((string) ($existing['wiki_url']  '')) === '' && trim((string) ($reference['wiki_url']  '')) !== '') {
            $referencesByKey[$key] = $reference;
        }
    }

    return array_values($referencesByKey);
}

function avesmapsWikiSyncBuildContextualPoliticalTerritoryName(
    string $rawValue,
    int $matchOffset,
    string $fullMatch,
    string $linkedName
): string {
    $linkedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($linkedName);
    if ($linkedName === '') {
        return '';
    }

    $prefixStart = max(0, $matchOffset - 80);
    $prefix = substr($rawValue, $prefixStart, $matchOffset - $prefixStart);
    $prefix = preg_replace('/.*(?:,|;|·|\n|\r)/su', '', $prefix)  $prefix;
    $prefix = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($prefix);

    $fullCandidate = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($prefix . ' ' . $linkedName);
    if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($fullCandidate)) {
        return $fullCandidate;
    }

    $type = avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($prefix);
    if ($type !== '') {
        return avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($type . ' ' . $linkedName);
    }

    $suffixStart = $matchOffset + strlen($fullMatch);
    $suffix = substr($rawValue, $suffixStart, 80);
    $suffix = preg_replace('/(?:,|;|·|\n|\r).*$/su', '', $suffix)  $suffix;
    $suffix = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($suffix);

    $suffixCandidate = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($linkedName . ' ' . $suffix);
    if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($suffixCandidate)) {
        return $suffixCandidate;
    }

    return '';
}



function avesmapsWikiSyncBuildPoliticalTerritoryChildRows(array $childReferences, array $parentRow): array {
    $parentName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($parentRow['name']  ''));
    if ($parentName === '') {
        return [];
    }

    $parentKey = avesmapsWikiSyncCreateMatchKey($parentName);
    $rows = [];

    foreach ($childReferences as $childReference) {
        if (!is_array($childReference)) {
            continue;
        }

        $childName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($childReference['name']  ''));
        if ($childName === '') {
            continue;
        }

        $childKey = avesmapsWikiSyncCreateMatchKey($childName);
        if ($childKey === '' || $childKey === $parentKey) {
            continue;
        }

        $rows[] = [
            'name' => $childName,
            'type' => (string) ($childReference['type']  avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($childName)),
            'continent' => (string) ($parentRow['continent']  AVESMAPS_POLITICAL_DEFAULT_CONTINENT),
            'affiliation' => $parentName,
            'status' => '',
            'form_of_government' => '',
            'capital_name' => '',
            'seat_name' => '',
            'ruler' => '',
            'language' => '',
            'currency' => '',
            'trade_goods' => '',
            'population' => '',
            'founded_text' => '',
            'founder' => '',
            'dissolved_text' => '',
            'blazon' => '',
            'wiki_url' => (string) ($childReference['wiki_url']  avesmapsWikiSyncPageUrl($childName)),
            'coat_of_arms_url' => '',
            'discovered_from_parent' => $parentName,
            'discovered_from_field' => (string) ($childReference['source_field']  ''),
        ];
    }

    return $rows;
}

function avesmapsWikiSyncIsIgnoredPoliticalTerritoryLinkTitle(string $title): bool {
    return preg_match('/^(?:Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template)\s*:/iu', $title) === 1;
}

function avesmapsWikiSyncLooksLikePoliticalTerritoryName(string $name): bool {
    if ($name === '') {
        return false;
    }

    return preg_match(
        '/\b(?:Staat|Königreich|Koenigreich|Kaiserreich|Herzogtum|Fürstentum|Fuerstentum|Grafschaft|Landgrafschaft|Markgrafschaft|Baronie|Freiherrschaft|Republik|Sultanat|Emirat|Kalifat|Mhaharanyat|Theokratie)\b/iu',
        $name
    ) === 1;
}

function avesmapsWikiSyncInferPoliticalTerritoryTypeFromName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);

    $patterns = [
        '/\bFreiherrschaft\b/iu' => 'Freiherrschaft',
        '/\bLandgrafschaft\b/iu' => 'Landgrafschaft',
        '/\bMarkgrafschaft\b/iu' => 'Markgrafschaft',
        '/\bGrafschaft\b/iu' => 'Grafschaft',
        '/\bBaronie\b/iu' => 'Baronie',
        '/\bHerzogtum\b/iu' => 'Herzogtum',
        '/\bFürstentum\b/iu' => 'Fürstentum',
        '/\bFuerstentum\b/iu' => 'Fürstentum',
        '/\bKönigreich\b/iu' => 'Königreich',
        '/\bKoenigreich\b/iu' => 'Königreich',
        '/\bKaiserreich\b/iu' => 'Kaiserreich',
        '/\bRepublik\b/iu' => 'Republik',
        '/\bSultanat\b/iu' => 'Sultanat',
        '/\bEmirat\b/iu' => 'Emirat',
        '/\bKalifat\b/iu' => 'Kalifat',
        '/\bMhaharanyat\b/iu' => 'Mhaharanyat',
    ];

    foreach ($patterns as $pattern => $type) {
        if (preg_match($pattern, $normalized) === 1) {
            return $type;
        }
    }

    return '';
}

function avesmapsWikiSyncInferPoliticalTerritoryTypeFromListContext(string $rawValue): string {
    $cleaned = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($rawValue);
    if ($cleaned === '') {
        return '';
    }

    $segments = preg_split('/\s*(?:,|;|\x{00B7}|\x{2022}|\n|\r)\s*/u', $cleaned) ?: [];
    foreach ($segments as $segment) {
        $type = avesmapsWikiSyncInferPoliticalTerritoryTypeFromName((string) $segment);
        if ($type !== '') {
            return $type;
        }
    }

    return '';
}

function avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);

    if ($normalized === '') {
        return '';
    }

    $normalized = preg_replace(
        '/\s*\(\s*unabh(?:a|ae|\x{00E4})ngig\s*\)\s*$/iu',
        '',
        $normalized
    )  $normalized;

    return trim($normalized);
}

function avesmapsWikiSyncReadTableCells(DOMElement $row): array {
    $cells = [];
    foreach ($row->childNodes as $child) {
        if ($child instanceof DOMElement && in_array(strtolower($child->tagName), ['th', 'td'], true)) {
            $cells[] = $child;
        }
    }

    return $cells;
}

function avesmapsWikiSyncReadTableGridCells(DOMElement $row, array &$rowSpanCells): array {
    $gridCells = [];
    $directCells = avesmapsWikiSyncReadTableCells($row);
    if ($directCells === [] && $rowSpanCells === []) {
        return [];
    }

    $columnIndex = 0;
    $consumePendingCell = static function (int $columnIndex, array &$rowSpanCells, array &$gridCells): void {
        if (!isset($rowSpanCells[$columnIndex])) {
            return;
        }

        $pending = $rowSpanCells[$columnIndex];
        if (!$pending['cell'] instanceof DOMElement) {
            unset($rowSpanCells[$columnIndex]);
            return;
        }

        $gridCells[$columnIndex] = $pending['cell'];
        $pending['rows_left']--;
        if ($pending['rows_left'] > 0) {
            $rowSpanCells[$columnIndex] = $pending;
            return;
        }

        unset($rowSpanCells[$columnIndex]);
    };

    foreach ($directCells as $cell) {
        while (isset($rowSpanCells[$columnIndex])) {
            $consumePendingCell($columnIndex, $rowSpanCells, $gridCells);
            $columnIndex++;
        }

        $colspan = avesmapsWikiSyncReadTableSpanValue($cell, 'colspan');
        $rowspan = avesmapsWikiSyncReadTableSpanValue($cell, 'rowspan');

        for ($offset = 0; $offset < $colspan; $offset++) {
            $targetColumn = $columnIndex + $offset;
            $gridCells[$targetColumn] = $cell;
            if ($rowspan > 1) {
                $rowSpanCells[$targetColumn] = [
                    'cell' => $cell,
                    'rows_left' => $rowspan - 1,
                ];
            }
        }

        $columnIndex += $colspan;
    }

    while (isset($rowSpanCells[$columnIndex])) {
        $consumePendingCell($columnIndex, $rowSpanCells, $gridCells);
        $columnIndex++;
    }

    if ($gridCells === []) {
        return [];
    }

    ksort($gridCells);
    return array_values($gridCells);
}

function avesmapsWikiSyncReadTableSpanValue(DOMElement $cell, string $attribute): int {
    $rawValue = trim((string) $cell->getAttribute($attribute));
    if ($rawValue === '') {
        return 1;
    }

    $value = filter_var($rawValue, FILTER_VALIDATE_INT);
    if ($value === false || $value < 1) {
        return 1;
    }

    return (int) $value;
}

function avesmapsWikiSyncNormalizePoliticalHeader(string $header): string {
    $normalized = avesmapsWikiSyncCreateMatchKey(avesmapsWikiSyncNormalizeWikiTreeText($header));
    return match ($normalized) {
        'name', 'staat', 'status', 'herrschaftsform', 'hauptstadt', 'herrschaftssitz', 'oberhaupt', 'sprache', 'handelswaren', 'einwohnerzahl', 'kontinent', 'blasonierung' => $normalized,
        'art' => 'art',
        'typ', 'herrschaftsgebiet' => 'typ',
        'wahrung', 'waehrung' => 'wahrung',
        'grunder', 'gruender' => 'grunder',
        'zugehorigkeit', 'zugehoerigkeit' => 'zugehorigkeit',
        'grundungsdatum', 'gruendungsdatum', 'grundung', 'gruendung', 'gegrundet', 'gegruendet', 'neugrundung', 'neugruendung' => 'grundungsdatum',
        'aufgelost', 'aufgeloest', 'auflosung', 'aufloesung' => 'aufgelost',
        default => $normalized,
    };
}

function avesmapsWikiSyncReadFirstWikiLink(DOMElement $cell): string {
    return (string) (avesmapsWikiSyncReadFirstWikiLinkMetadata($cell)['url']  '');
}

function avesmapsWikiSyncReadFirstWikiLinkMetadata(DOMElement $cell): array {
    foreach ($cell->getElementsByTagName('a') as $link) {
        if (!$link instanceof DOMElement) {
            continue;
        }

        $href = trim((string) $link->getAttribute('href'));
        if ($href === '' || str_starts_with($href, '#')) {
            continue;
        }

        if (str_starts_with($href, '/wiki/')) {
            $title = avesmapsWikiSyncNormalizeWikiTreeText((string) $link->getAttribute('title'));
            if ($title === '') {
                $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl('https://de.wiki-aventurica.de' . $href);
            }

            return [
                'url' => 'https://de.wiki-aventurica.de' . $href,
                'title' => $title,
            ];
        }

        if (preg_match('/^https?:\/\//i', $href) === 1) {
            $title = avesmapsWikiSyncNormalizeWikiTreeText((string) $link->getAttribute('title'));
            if ($title === '') {
                $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl($href);
            }

            return [
                'url' => $href,
                'title' => $title,
            ];
        }
    }

    return [];
}

function avesmapsWikiSyncFetchPoliticalTerritoryPathReferenceRows(array $rows, array $rowIndex): array {
    $titlesByKey = [];
    foreach ($rows as $row) {
        foreach (avesmapsWikiSyncReadPoliticalTerritoryPath($row) as $part) {
            $key = avesmapsWikiSyncMakePoliticalTreeKey($part);
            if ($key === '' || isset($rowIndex[$key])) {
                continue;
            }

            $titlesByKey[$key] = $part;
        }
    }

    if ($titlesByKey === []) {
        return [];
    }

    try {
        $contentsByTitle = avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_values($titlesByKey));
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('political_territory_path_reference_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);

        return [];
    }

    $referenceRows = [];
    foreach ($titlesByKey as $title) {
        $content = $contentsByTitle[$title]  '';
        if ($content === '') {
            continue;
        }

        $details = avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent($content);
        if (!avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails($details)) {
            continue;
        }

        $referenceRows[] = [
            'name' => $title,
            'type' => (string) ($details['type']  ''),
            'affiliation' => '',
            'status' => (string) ($details['status']  ''),
            'form_of_government' => (string) ($details['form_of_government']  ''),
            'capital_name' => (string) ($details['capital_name']  ''),
            'seat_name' => (string) ($details['seat_name']  ''),
            'ruler' => (string) ($details['ruler']  ''),
            'language' => (string) ($details['language']  ''),
            'currency' => (string) ($details['currency']  ''),
            'trade_goods' => (string) ($details['trade_goods']  ''),
            'population' => '',
            'founded_text' => (string) ($details['founded_text']  ''),
            'founder' => (string) ($details['founder']  ''),
            'dissolved_text' => (string) ($details['dissolved_text']  ''),
            'blazon' => (string) ($details['blazon']  ''),
            'wiki_url' => avesmapsWikiSyncPageUrl($title),
        ];
    }

    return $referenceRows;
}

function avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails(array $details): bool {
    foreach (['type', 'status', 'capital_name', 'seat_name', 'ruler', 'founded_text', 'dissolved_text'] as $key) {
        if ((string) ($details[$key]  '') !== '') {
            return true;
        }
    }

    return false;
}

function avesmapsWikiSyncIsIndependentPoliticalTerritoryPath(array $path): bool {
    if ($path === []) {
        return false;
    }

    $firstPart = avesmapsWikiSyncNormalizeWikiTreeText((string) $path[0]);

    return preg_match('/^unabh(?:a|ae|\x{00E4})ngig\b/iu', $firstPart) === 1;
}

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

        $path = avesmapsWikiSyncNormalizePoliticalTerritoryPathForNode($path, (string) ($row['name']  ''));

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

        $name = (string) ($row['name']  '');
        $ownKey = avesmapsWikiSyncMakePoliticalTreeKey($name) ?: 'gebiet-' . ($index + 1);
        $targetNode = null;
        $currentNodeKey = avesmapsWikiSyncNodeKeyWithoutPrefix((string) ($current['key']  ''));
        if ($currentNodeKey !== '' && $currentNodeKey === $ownKey) {
            $currentRow = is_array($current['row']  null)  $current['row'] : null;
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
            $territories[(string) ($targetNode['public_id']  '')] = avesmapsWikiSyncPublicPoliticalTreeNode($targetNode);
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
        $normalizedNode['children'] = avesmapsWikiSyncDedupePoliticalTreeHierarchy(is_array($node['children']  null)  $node['children'] : []);
        $key = avesmapsWikiSyncBuildPoliticalTreeDedupeKey($normalizedNode);
        $existing = $dedupedByKey[$key]  null;
        if (!is_array($existing)) {
            $dedupedByKey[$key] = $normalizedNode;
            continue;
        }

        $winner = avesmapsWikiSyncScorePublicPoliticalTreeNode($normalizedNode) >= avesmapsWikiSyncScorePublicPoliticalTreeNode($existing)
             $normalizedNode
            : $existing;
        $loser = $winner === $normalizedNode  $existing : $normalizedNode;
        $winner['children'] = avesmapsWikiSyncDedupePoliticalTreeHierarchy(array_merge(
            is_array($winner['children']  null)  $winner['children'] : [],
            is_array($loser['children']  null)  $loser['children'] : []
        ));
        $winner = avesmapsWikiSyncMergePublicPoliticalTreeNode($winner, $loser);
        $dedupedByKey[$key] = $winner;
    }

    $deduped = array_values($dedupedByKey);
    usort($deduped, static fn(array $left, array $right): int => strnatcasecmp((string) ($left['name']  ''), (string) ($right['name']  '')));
    return $deduped;
}

function avesmapsWikiSyncBuildPoliticalTreeDedupeKey(array $node): string {
    $wikiKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['wiki_key']  ''));
    if ($wikiKey !== '') {
        return 'wiki_key|' . $wikiKey;
    }

    $wikiUrl = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['wiki_url']  ''));
    if ($wikiUrl !== '') {
        return 'wiki_url|' . $wikiUrl;
    }

    $nameKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['name']  ''));
    $periodKey = avesmapsWikiSyncMakePoliticalTreeKey((string) ($node['valid_label']  ''));
    if ($periodKey !== '') {
        return $nameKey . '|' . $periodKey;
    }

    return $nameKey;
}

function avesmapsWikiSyncScorePublicPoliticalTreeNode(array $node): int {
    $score = 0;
    $score += count(is_array($node['children']  null)  $node['children'] : []) * 1000;
    foreach (['wiki_url', 'type', 'status', 'valid_label', 'founded_text', 'dissolved_text', 'coat_of_arms_url'] as $field) {
        if (trim((string) ($node[$field]  '')) !== '') {
            $score += 20;
        }
    }
    $score += (int) ($node['map_geometry_count']  0) * 5;
    return $score;
}

function avesmapsWikiSyncMergePublicPoliticalTreeNode(array $primary, array $secondary): array {
    $merged = $primary;
    if ((int) ($merged['id']  0) <= 0 && (int) ($secondary['id']  0) > 0) {
        $merged['id'] = (int) $secondary['id'];
        $merged['wiki_id'] = (int) $secondary['id'];
    }
    if (trim((string) ($merged['wiki_key']  '')) === '' && trim((string) ($secondary['wiki_key']  '')) !== '') {
        $merged['wiki_key'] = (string) $secondary['wiki_key'];
    }
    foreach ([
        'public_id', 'name', 'short_name', 'type', 'status', 'form_of_government', 'valid_label',
        'wiki_name', 'wiki_affiliation_raw', 'wiki_affiliation_root', 'wiki_url', 'capital_name',
        'seat_name', 'ruler', 'founder', 'language', 'currency', 'trade_goods', 'population',
        'founded_text', 'dissolved_text', 'coat_of_arms_url'
    ] as $field) {
        if (trim((string) ($merged[$field]  '')) === '' && trim((string) ($secondary[$field]  '')) !== '') {
            $merged[$field] = $secondary[$field];
        }
    }

    $merged['map_assigned'] = !empty($merged['map_assigned']) || !empty($secondary['map_assigned']);
    $merged['map_territory_count'] = max((int) ($merged['map_territory_count']  0), (int) ($secondary['map_territory_count']  0));
    $merged['map_geometry_count'] = max((int) ($merged['map_geometry_count']  0), (int) ($secondary['map_geometry_count']  0));

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
    return str_starts_with($nodeKey, 'wiki:')  substr($nodeKey, 5) : $nodeKey;
}

function avesmapsWikiSyncDisplayPoliticalTerritoryName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);
    if ($normalized === '') {
        return '';
    }

    foreach (AVESMAPS_WIKI_POLITICAL_DISPLAY_SUFFIXES as $suffix) {
        $suffixPattern = preg_quote((string) $suffix, '/');
        $normalized = preg_replace('/\s+\(' . $suffixPattern . '\)\s*$/iu', '', $normalized)  $normalized;
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
        'is_group' => $row === null,
        'row' => $row,
        'children' => [],
    ];
    return $row === null  $node : avesmapsWikiSyncApplyPoliticalRowToTreeNode($node, $row);
}

function avesmapsWikiSyncApplyPoliticalRowToTreeNode(array $node, array $row): array {
    $node['id'] = (int) ($row['id']  0);
    $node['wiki_key'] = (string) ($row['wiki_key']  '');
    $node['name'] = avesmapsWikiSyncDisplayPoliticalTerritoryName((string) ($row['name']  $node['name']  ''));
    $node['type'] = (string) ($row['type']  '');
    $node['status'] = (string) ($row['status']  '');
    $node['form_of_government'] = (string) ($row['form_of_government']  '');
    $node['valid_label'] = avesmapsWikiSyncFormatPoliticalPeriod($row);
    $node['wiki_name'] = (string) ($row['name']  '');
    $node['wiki_affiliation_raw'] = (string) ($row['affiliation']  '');
    $node['wiki_affiliation_root'] = avesmapsWikiSyncReadPoliticalTerritoryPath($row)[0]  '';
    $node['wiki_url'] = (string) ($row['wiki_url']  '');
    $node['capital_name'] = (string) ($row['capital_name']  '');
    $node['seat_name'] = (string) ($row['seat_name']  '');
    $node['ruler'] = (string) ($row['ruler']  '');
    $node['founder'] = (string) ($row['founder']  '');
    $node['language'] = (string) ($row['language']  '');
    $node['currency'] = (string) ($row['currency']  '');
    $node['trade_goods'] = (string) ($row['trade_goods']  '');
    $node['population'] = (string) ($row['population']  '');
    $node['founded_text'] = (string) ($row['founded_text']  '');
    $node['dissolved_text'] = (string) ($row['dissolved_text']  '');
    $node['coat_of_arms_url'] = (string) ($row['coat_of_arms_url']  '');
    $node['map_assigned'] = !empty($row['map_assigned']);
    $node['map_territory_count'] = (int) ($row['map_territory_count']  0);
    $node['map_geometry_count'] = (int) ($row['map_geometry_count']  0);

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
        'id' => (int) ($node['id']  0),
        'wiki_id' => (int) ($node['id']  0),
        'wiki_key' => (string) ($node['wiki_key']  ''),
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
        'founder' => (string) ($node['founder']  ''),
        'language' => (string) ($node['language']  ''),
        'currency' => (string) ($node['currency']  ''),
        'trade_goods' => (string) ($node['trade_goods']  ''),
        'population' => (string) ($node['population']  ''),
        'founded_text' => (string) ($node['founded_text']  ''),
        'dissolved_text' => (string) ($node['dissolved_text']  ''),
        'coat_of_arms_url' => (string) ($node['coat_of_arms_url']  ''),
        'map_assigned' => !empty($node['map_assigned']),
        'map_territory_count' => (int) ($node['map_territory_count']  0),
        'map_geometry_count' => (int) ($node['map_geometry_count']  0),
        'is_group' => (bool) $node['is_group'],
        'is_wiki_live' => true,
    ];
}

function avesmapsWikiSyncCollectPoliticalTreeTerritories(array $node, array &$territories): void {
    $territories[$node['public_id']] = $node;
    foreach (($node['children']  []) as $child) {
        if (is_array($child)) {
            avesmapsWikiSyncCollectPoliticalTreeTerritories($child, $territories);
        }
    }
}

function avesmapsWikiSyncReadPoliticalTerritoryPath(array $row): array {
    $affiliation = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['affiliation']  ''));
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
            $selectedClause = preg_replace('/^politisch\s*/iu', '', $clause)  $clause;
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
        $selectedClause = $clauses[0]  $affiliation;
    }

    $parts = preg_split('/\s*:\s*/u', $selectedClause) ?: [];
    $path = [];

    foreach ($parts as $part) {
        $normalizedPart = avesmapsWikiSyncNormalizePoliticalPathPart($part);
        if ($normalizedPart !== '') {
            $path[] = $normalizedPart;
        }
    }

    $path = $path !== []  $path : ["ungekl\u{00E4}rt"];

    return avesmapsWikiSyncClassifyPoliticalTerritoryPath($path, $row);
}

function avesmapsWikiSyncClassifyPoliticalTerritoryPath(array $path, array $row): array {
    $name = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['name']  ''));
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

    return $normalizedPath !== []  $normalizedPath : [];
}

function avesmapsWikiSyncNormalizePoliticalPathPart(string $value): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($value);
    if ($normalized === '') {
        return '';
    }

    $normalized = preg_replace('/\([^)]*\)/u', '', $normalized)  $normalized;
    $normalized = preg_replace('/\[[^\]]*\]/u', '', $normalized)  $normalized;

    $normalized = preg_replace(
        '/^(?:politisch|sowie|und|zuvor|ehemals|frueher|historisch|vormals)\s+/iu',
        '',
        $normalized
    )  $normalized;

    $normalized = preg_replace(
        '/^(?:unter\s+der\s+Herrschaft\s+(?:des|der)|beansprucht\s+(?:von|vom|durch)|benasprucht\s+(?:von|vom|durch))\s+/iu',
        '',
        $normalized
    )  $normalized;

    $normalized = preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $normalized)[0]  $normalized;

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

    $candidateBeforeSemicolon = trim((string) (preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $normalizedPart)[0]  $normalizedPart));
    $candidateKey = avesmapsWikiSyncMakePoliticalTreeKey($candidateBeforeSemicolon);

    if ($candidateKey !== '' && isset($rowIndex[$candidateKey]) && is_array($rowIndex[$candidateKey])) {
        return avesmapsWikiSyncCanonicalPoliticalPathPart($rowIndex[$candidateKey], $candidateBeforeSemicolon);
    }

    return $normalizedPart;
}

function avesmapsWikiSyncCanonicalPoliticalPathPart(array $row, string $fallback): string {
    $canonicalName = avesmapsWikiSyncResolvePoliticalTerritoryName(
        (string) ($row['name']  ''),
        (string) ($row['wiki_url']  '')
    );

    return $canonicalName !== ''  $canonicalName : $fallback;
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
        $name = (string) ($row['name']  '');
        $aliases = [
            $name,
            preg_replace('/\s*\([^)]*\)\s*$/u', '', $name)  $name,
        ];

        $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl((string) ($row['wiki_url']  ''));
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
    $founded = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['founded_text']  ''));
    $dissolved = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['dissolved_text']  ''));
    if ($founded === '' && isset($row['founded_start_bf']) && $row['founded_start_bf'] !== null) {
        $founded = avesmapsWikiSyncFormatBfYear((int) $row['founded_start_bf']);
    }
    if ($dissolved === '' && isset($row['dissolved_end_bf']) && $row['dissolved_end_bf'] !== null) {
        $dissolved = avesmapsWikiSyncFormatBfYear((int) $row['dissolved_end_bf']);
    }
    if ($founded !== '' && $dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1  'besteht seit ' . $founded : $founded . ' - ' . $dissolved;
    }
    if ($founded !== '') {
        return 'seit ' . $founded;
    }
    if ($dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1  'besteht' : 'bis ' . $dissolved;
    }

    return '';
}

function avesmapsWikiSyncFormatBfYear(int $year): string {
    if ($year < 0) {
        return abs($year) . ' v. BF';
    }

    return $year . ' BF';
}

function avesmapsWikiSyncComparePoliticalTreeNodes(array $left, array $right): int {
    $leftHasRow = $left['row'] === null  0 : 1;
    $rightHasRow = $right['row'] === null  0 : 1;
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
    $decoded = preg_replace('/\s+/u', ' ', $decoded)  $decoded;

    return trim($decoded);
}
function avesmapsWikiSyncShouldForcePoliticalTerritoryRoot(array $row): bool {
    $name = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['name']  ''));
    $type = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['type']  ''));
    $wikiKey = avesmapsWikiSyncNormalizeWikiTreeText((string) ($row['wiki_key']  ''));

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