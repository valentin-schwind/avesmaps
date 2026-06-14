<?php

declare(strict_types=1);

// Territory-specific WikiSync helpers moved from wiki-sync.php
const AVESMAPS_WIKI_POLITICAL_DISPLAY_SUFFIXES = [
    'Staat',
    'Imperium',
    'Reich',
    'Kalifat',
];
// Political-territory tree building lives in a sibling file (M5 split).
require_once __DIR__ . '/territories-tree.php';
// Wiki HTML/wikitext parsing lives in a sibling file (M5 split).
require_once __DIR__ . '/territories-parsing.php';

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
            (string) ($wikiRow['name'] ?? ''),
            (string) ($wikiRow['wiki_url'] ?? '')
        );
    }
    unset($wikiRow);

    $rowIndex = avesmapsWikiSyncBuildPoliticalTerritoryRowIndex($wikiRows);
    $normalizedRowsByKey = [];

    foreach ($wikiRows as $row) { 
        $temporal = avesmapsWikiSyncBuildPoliticalTemporalPayload(
            (string) ($row['founded_text'] ?? ''),
            (string) ($row['dissolved_text'] ?? '')
        );
        $affiliationPath = avesmapsWikiSyncReadPoliticalTerritoryPath($row);

        if (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath($affiliationPath)) {
            $affiliationPath = [];
        } else {
            $affiliationPath = avesmapsWikiSyncCanonicalizePoliticalTerritoryPath($affiliationPath, $rowIndex);
        }

        $affiliationRoot = $affiliationPath[0] ?? '';

        $record = avesmapsPoliticalNormalizeWikiRecord([
            'Name' => (string) ($row['name'] ?? ''),
            'Typ' => (string) ($row['type'] ?? ''),
            'Kontinent' => (string) ($row['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT),
            'Zugehoerigkeit' => (string) ($row['affiliation'] ?? ''),
            'Zugehoerigkeit-Root' => $affiliationRoot,
            'Zugehoerigkeit-Pfad' => implode(' > ', $affiliationPath),
            'Status' => (string) ($row['status'] ?? ''),
            'Herrschaftsform' => (string) ($row['form_of_government'] ?? ''),
            'Hauptstadt' => (string) ($row['capital_name'] ?? ''),
            'Herrschaftssitz' => (string) ($row['seat_name'] ?? ''),
            'Oberhaupt' => (string) ($row['ruler'] ?? ''),
            'Sprache' => (string) ($row['language'] ?? ''),
            'Waehrung' => (string) ($row['currency'] ?? ''),
            'Handelswaren' => (string) ($row['trade_goods'] ?? ''),
            'Einwohnerzahl' => (string) ($row['population'] ?? ''),
            'Gruendungsdatum' => (string) $temporal['founded_text'],
            'Gruendungsdatum-Typ' => (string) $temporal['founded_type'],
            'Gruendungsdatum-StartBF' => (string) $temporal['founded_start_bf'],
            'Gruendungsdatum-EndBF' => (string) $temporal['founded_end_bf'],
            'Gruendungsdatum-AnzeigeBF' => (string) $temporal['founded_display_bf'],
            'Gruender' => (string) ($row['founder'] ?? ''),
            'Aufgeloest' => (string) $temporal['dissolved_text'],
            'Aufgeloest-Typ' => (string) $temporal['dissolved_type'],
            'Aufgeloest-StartBF' => (string) $temporal['dissolved_start_bf'],
            'Aufgeloest-EndBF' => (string) $temporal['dissolved_end_bf'],
            'Aufgeloest-AnzeigeBF' => (string) $temporal['dissolved_display_bf'],
            'Blasonierung' => (string) ($row['blazon'] ?? ''),
            'Wiki-Link' => (string) ($row['wiki_url'] ?? ''),
            'Wappen-Link' => (string) ($row['coat_of_arms_url'] ?? ''),
            'raw_json' => $row,
        ]);
        if ((string) ($record['wiki_key'] ?? '') === '' || (string) ($record['name'] ?? '') === '') {
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

        $wikiKey = (string) ($record['wiki_key'] ?? '');
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
        $record['id'] = (int) ($upsert['id'] ?? 0);
        $record['map_assigned'] = false;
        $record['map_territory_count'] = 0;
        $record['map_geometry_count'] = 0;
    }
    unset($record);

    avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey($pdo);

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

// Bindet political_territory.wiki_id ueber den stabilen wiki_key wieder an die (ggf. neu
// vergebene) wiki.id an, nachdem die Wiki-Tabelle resettet/neu befuellt wurde. Idempotent;
// Zeilen ohne passende wiki_key-Entsprechung bleiben unangetastet (echtes Stale bleibt detached).
function avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey(PDO $pdo): int {
    $statement = $pdo->prepare(
        'UPDATE political_territory pt
        JOIN political_territory_wiki w ON w.wiki_key = pt.wiki_key
        SET pt.wiki_id = w.id
        WHERE pt.wiki_key IS NOT NULL
            AND pt.wiki_key <> \'\'
            AND (pt.wiki_id IS NULL OR pt.wiki_id <> w.id)'
    );
    $statement->execute();

    return $statement->rowCount();
}

function avesmapsWikiSyncBuildPoliticalTemporalPayload(string $foundedTextRaw, string $dissolvedTextRaw): array {
    $foundedText = avesmapsWikiSyncNormalizePoliticalTemporalText($foundedTextRaw);
    $foundedYears = avesmapsWikiSyncExtractPoliticalBfYears($foundedText);
    $foundedStart = $foundedYears === [] ? 0 : min($foundedYears);
    $foundedEnd = $foundedYears === [] ? $foundedStart : max($foundedYears);
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
        $dissolvedText = $dissolvedText === '' ? 'besteht' : $dissolvedText;
    } elseif ($dissolvedYears !== []) {
        $dissolvedStart = min($dissolvedYears);
        $dissolvedEnd = max($dissolvedYears);
        $dissolvedType = count($dissolvedYears) > 1 ? 'range' : 'exact';
    } else {
        $dissolvedStart = 9999;
        $dissolvedEnd = 9999;
        $dissolvedType = 'fallback_open';
        $dissolvedText = $dissolvedText === '' ? 'besteht' : $dissolvedText;
    }

    return [
        'founded_text' => $foundedText,
        'founded_type' => $foundedYears === [] ? 'fallback' : (count($foundedYears) > 1 ? 'range' : 'exact'),
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
    $clean = preg_replace('/\s+/u', ' ', $clean) ?? $clean;
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
        $rawYear = isset($match[1]) ? (int) $match[1] : 0;
        // 0 ist ein GUELTIGES Jahr ("0 BF" = Bosparans Fall) und darf NICHT als "kein Datum"
        // verworfen werden, sonst landet eine echte 0-BF-Aufloesung im fallback_open -> 9999
        // ("besteht"). Negative rawYear kann das Regex (\d{1,5}, vorzeichenlos) nicht liefern;
        // das Vorzeichen kommt separat aus "v. BF".
        if ($rawYear < 0) {
            continue;
        }

        $isBefore = isset($match[2]) && preg_match('/v\.\s*BF/iu', (string) $match[2]) === 1;
        $years[] = $isBefore ? -$rawYear : $rawYear;
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
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }

        $assignments[$wikiKey] = [
            'territory_count' => (int) ($row['territory_count'] ?? 0),
            'geometry_count' => (int) ($row['geometry_count'] ?? 0),
        ];
    }

    // Inaktive (soft-geloeschte) Territorien separat zaehlen: sie fehlen oben bewusst
    // (is_active=1-Join), sollen im Baum aber als "inaktiv" markierbar sein statt wie
    // nie zugewiesen auszusehen (Vorfall "Herzogtum Transysilien").
    $inactiveStatement = $pdo->prepare(
        'SELECT wiki.wiki_key, COUNT(DISTINCT territory.id) AS inactive_territory_count
        FROM political_territory_wiki wiki
        INNER JOIN political_territory territory
            ON territory.wiki_id = wiki.id
            AND territory.is_active = 0
        WHERE wiki.continent = :continent
        GROUP BY wiki.wiki_key'
    );
    $inactiveStatement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);
    foreach ($inactiveStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }

        $assignments[$wikiKey] ??= [
            'territory_count' => 0,
            'geometry_count' => 0,
        ];
        $assignments[$wikiKey]['inactive_territory_count'] = (int) ($row['inactive_territory_count'] ?? 0);
    }

    return $assignments;
}

function avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(array $rows, array $assignments): array {
    return array_map(static function (array $row) use ($assignments): array {
        $assignment = $assignments[(string) ($row['wiki_key'] ?? '')] ?? null;
        $geometryCount = (int) ($assignment['geometry_count'] ?? 0);

        $row['map_assigned'] = $geometryCount > 0;
        $row['map_territory_count'] = (int) ($assignment['territory_count'] ?? 0);
        $row['map_geometry_count'] = $geometryCount;
        $row['map_inactive_territory_count'] = (int) ($assignment['inactive_territory_count'] ?? 0);

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
            'id' => (int) ($row['id'] ?? 0),
            'wiki_key' => (string) ($row['wiki_key'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'type' => (string) ($row['type'] ?? ''),
            'continent' => (string) ($row['continent'] ?? ''),
            'affiliation' => (string) ($row['affiliation_raw'] ?? ''),
            'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
            'affiliation_root' => (string) ($row['affiliation_root'] ?? ''),
            'affiliation_path_json' => avesmapsWikiSyncDecodeJson($row['affiliation_path_json'] ?? null),
            'affiliation_json' => avesmapsWikiSyncDecodeJson($row['affiliation_json'] ?? null),
            'status' => (string) ($row['status'] ?? ''),
            'form_of_government' => (string) ($row['form_of_government'] ?? ''),
            'capital_name' => (string) ($row['capital_name'] ?? ''),
            'seat_name' => (string) ($row['seat_name'] ?? ''),
            'ruler' => (string) ($row['ruler'] ?? ''),
            'language' => (string) ($row['language'] ?? ''),
            'currency' => (string) ($row['currency'] ?? ''),
            'trade_goods' => (string) ($row['trade_goods'] ?? ''),
            'population' => (string) ($row['population'] ?? ''),
            'founded_text' => (string) ($row['founded_text'] ?? ''),
            'founded_start_bf' => isset($row['founded_start_bf']) ? (int) $row['founded_start_bf'] : null,
            'founder' => (string) ($row['founder'] ?? ''),
            'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
            'dissolved_type' => (string) ($row['dissolved_type'] ?? ''),
            'dissolved_end_bf' => isset($row['dissolved_end_bf']) ? (int) $row['dissolved_end_bf'] : null,
            'blazon' => (string) ($row['blazon'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
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
            $name = (string) ($row['name'] ?? '');
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

    return $includeDetails ? avesmapsWikiSyncEnrichPoliticalTerritoryRowsFromWiki($rows) : $rows;
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
    if (trim((string) ($row['wiki_url'] ?? '')) !== '') {
        $score += 120;
    }

    $name = trim((string) ($row['name'] ?? ''));
    if ($name !== '') {
        $score += 40;
        if (!str_contains($name, ';') && !str_contains($name, ',')) {
            $score += 15;
        }
    }

    $affiliation = trim((string) ($row['affiliation'] ?? ''));
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
            $firstPartKey = avesmapsWikiSyncCreateMatchKey((string) ($parts[0] ?? ''));
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
        if (trim((string) ($row[$field] ?? '')) !== '') {
            $score += 3;
        }
    }

    return $score;
}

function avesmapsWikiSyncCreatePoliticalTerritoryRowIdentityKey(array $row): string {
    $wikiUrl = trim((string) ($row['wiki_url'] ?? ''));
    if ($wikiUrl !== '') {
        $wikiTitle = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl($wikiUrl);
        if ($wikiTitle !== '') {
            return 'wiki_title|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($wikiTitle);
        }

        return 'wiki_url|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($wikiUrl);
    }

    $name = trim((string) ($row['name'] ?? ''));
    if ($name === '') {
        return '';
    }

    $type = trim((string) ($row['type'] ?? ''));
    return 'name|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($name)
        . '|type|' . avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix($type);
}

function avesmapsWikiSyncEnrichPoliticalTerritoryRowsFromWiki(array $rows): array {
    $titlesByIndex = [];
    $titles = [];
    foreach ($rows as $index => $row) {
        $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl((string) ($row['wiki_url'] ?? ''));
        if ($title === '') {
            $title = (string) ($row['name'] ?? '');
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
        $content = $contentsByTitle[$title] ?? '';
        if ($content === '') {
            continue;
        }

        $details = avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent($content);
        $childTerritories = is_array($details['child_territories'] ?? null)
            ? $details['child_territories']
            : [];
        unset($details['child_territories']);

        foreach ($details as $key => $value) {
            if ($value === '') {
                continue;
            }
            $currentValue = (string) ($rows[$index][$key] ?? '');
            if (avesmapsWikiSyncShouldUsePoliticalTerritoryDetailValue($key, $currentValue, (string) $value)) {
                $rows[$index][$key] = $value;
            }
        }

        foreach (avesmapsWikiSyncBuildPoliticalTerritoryChildRows($childTerritories, $rows[$index]) as $childRow) {
            $keySource = (string) ($childRow['wiki_url'] ?? $childRow['name'] ?? '');
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

        $query = $data['query'] ?? [];
        $normalizedTitles = [];
        foreach (($query['normalized'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $normalizedTitles[(string) $item['from']] = (string) $item['to'];
            }
        }

        $redirectTitles = [];
        foreach (($query['redirects'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $redirectTitles[(string) $item['from']] = (string) $item['to'];
            }
        }

        $pagesByTitle = [];
        foreach (($query['pages'] ?? []) as $page) {
            if (!empty($page['title']) && empty($page['missing'])) {
                $pagesByTitle[(string) $page['title']] = $page;
            }
        }

        foreach ($batch as $requestedTitle) {
            $normalizedTitle = $normalizedTitles[$requestedTitle] ?? $requestedTitle;
            $resolvedTitle = $redirectTitles[$normalizedTitle] ?? $redirectTitles[$requestedTitle] ?? $normalizedTitle;
            $page = $pagesByTitle[$resolvedTitle] ?? null;
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

    $path = (string) (parse_url($wikiUrl, PHP_URL_PATH) ?? '');
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
