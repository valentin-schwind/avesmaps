<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';
require_once __DIR__ . '/political-territory-lib.php';

const AVESMAPS_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_WIKI_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_USER_AGENT = 'Avesmaps WikiSync/1.0';
const AVESMAPS_WIKI_TITLE_BATCH_SIZE = 50;
const AVESMAPS_WIKI_SEARCH_RESULT_LIMIT = 5;
const AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS = 30;
const AVESMAPS_WIKI_FUZZY_CUTOFF = 0.82;
const AVESMAPS_WIKI_SYNC_TYPE_LOCATION = 'location';
const AVESMAPS_WIKI_LOCK_TTL_SECONDS = 120;
const AVESMAPS_WIKI_POLITICAL_TERRITORY_SEED_PAGES = [
    'Baronie/Liste',
    "Bergk\u{00F6}nigreich/Liste",
    'Dom\u{00E4}ne (Horasreich)/Liste',
    'Emirat/Liste',
    'Freiherrschaft/Liste',
    "F\u{00FC}rstentum/Liste",
    'Grafschaft/Liste',
    'Herzogtum/Liste',
    'Kaiserpfalz/Liste',
    'Kaiserreich/Liste',
    'Komturei/Liste',
    "K\u{00F6}nigreich/Liste",
    'Markgrafschaft/Liste',
    'Pfalzgrafschaft/Liste',
    'Provinz (Imperium)/Liste',
    'Provinz (Mittelreich)/Liste',
    'Reichsmark/Liste',
    'Republik/Liste',
    "Sh\u{00EE}kanydad/Liste",
    'Staat/Liste',
    'Sultanat/Liste',
    'Theokratie/Liste',
];

const AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS = [
    'dorf' => 'Dorf',
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    "grossstadt" => "Gro\u{00DF}stadt",
    'metropole' => 'Metropole',
];

const AVESMAPS_WIKI_CATEGORY_TO_CLASS = [
    'Dorf' => 'dorf',
    'Kleinstadt' => 'kleinstadt',
    'Stadt' => 'stadt',
    "Mittelgro\u{00DF}e Stadt" => 'stadt',
    "Gro\u{00DF}stadt" => 'grossstadt',
    "Metropole (Siedlungsgr\u{00F6}\u{00DF}e)" => 'metropole',
];

const AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS = [
    'dorf' => 'Dorf',
    "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    "grossstadt" => "Gro\u{00DF}stadt",
    'metropole' => 'Metropole',
];

const AVESMAPS_WIKI_CASE_LABELS = [
    'canonical_name_difference' => 'Abweichende Benennung',
    'type_conflict' => 'Typkonflikte',
    "probable_match" => "Unaufgel\u{00F6}st, aber mit wahrscheinlichem Match",
    "unresolved_without_candidate" => "Unaufgel\u{00F6}st, ohne Match",
    'duplicate_avesmaps_name' => 'Dubletten in Avesmaps',
    'duplicate_wiki_title' => 'Mehrere Avesmaps-Namen zeigen auf denselben Wiki-Titel',
    'missing_wiki_with_coordinates' => 'Fehlende Wiki-Orte mit Koordinaten',
    'missing_wiki_without_coordinates' => 'Fehlende Wiki-Orte ohne nutzbare Koordinaten',
];

const AVESMAPS_DEREGLOBUS_TO_MAP = [
    'x_lon' => 30.3257445760,
    'x_lat' => 0.0014126835,
    'x_offset' => 438.0819758605,
    'y_lon' => 0.007511999997,
    'y_lat' => 33.5769120338,
    'y_offset' => -466.8085324960,
];

const AVESMAPS_POSITIONKARTE_TO_MAP = [
    'x_x' => 2.1490004455,
    'x_y' => 0.0010081646,
    'x_offset' => 188.8734061695,
    'y_x' => -0.0024556121,
    'y_y' => -2.1502199630,
    'y_offset' => 1018.3819994023,
];

function avesmapsWikiSyncAssertEndpointScope(string $endpointScope, array $allowedScopes, string $action): void {
    if (in_array($endpointScope, $allowedScopes, true)) {
        return;
    }

    throw new InvalidArgumentException("Diese WikiSync-Aktion ist an diesem Endpoint nicht erlaubt: {$action}");
}

function avesmapsWikiSyncHandleRequest(string $endpointScope = 'legacy'): void {
    try {
        $config = avesmapsLoadApiConfig(__DIR__);

        if (!avesmapsApplyCorsPolicy($config)) {
            avesmapsJsonResponse(403, [
                'ok' => false,
                'error' => 'Diese Herkunft darf WikiSync nicht verwenden.',
            ]);
        }

        $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($requestMethod === 'OPTIONS') {
            avesmapsJsonResponse(204);
        }

        $user = avesmapsRequireUserWithCapability('review');
        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        avesmapsWikiSyncEnsureTables($pdo);
        avesmapsPoliticalEnsureTables($pdo);

        if ($requestMethod === 'GET') {
            $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'cases'), 80);
            $forceRefresh = avesmapsWikiSyncReadBoolean($_GET['force_refresh'] ?? false);

            $response = match ($action) {
                'cases', '' => (function () use ($pdo, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                    return avesmapsWikiSyncListCases($pdo);
                })(),

                'territories_tree' => (function () use ($pdo, $forceRefresh, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                    return avesmapsWikiSyncReadPoliticalTerritoryTree($pdo, $forceRefresh);
                })(),

                'political_territory_tree' => (function () use ($pdo, $forceRefresh, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                    return avesmapsWikiSyncReadPoliticalTerritoryTree($pdo, $forceRefresh);
                })(),

                default => throw new InvalidArgumentException('Die WikiSync-Aktion ist unbekannt.'),
            };

            avesmapsJsonResponse(200, $response);
        }

        if ($requestMethod !== 'POST') {
            avesmapsJsonResponse(405, [
                'ok' => false,
                'error' => 'Nur GET und POST sind fuer WikiSync erlaubt.',
            ]);
        }

        $payload = avesmapsReadJsonRequest();
        $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 60);

        $response = match ($action) {
            'start_run' => (function () use ($pdo, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncStartRun($pdo, $user);
            })(),

            'advance_run' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncAdvanceRun($pdo, $payload);
            })(),

            'defer_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'deferred');
            })(),

            'archive_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'archived');
            })(),

            'reopen_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'open');
            })(),

            'resolve_case' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncResolveCase($pdo, $payload, avesmapsRequireUserWithCapability('edit'));
            })(),

            'sync_territories' => (function () use ($pdo, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                return avesmapsWikiSyncSyncTerritories($pdo, avesmapsRequireUserWithCapability('edit'));
            })(),

            default => throw new InvalidArgumentException('Die WikiSync-Aktion ist unbekannt.'),
        };

        avesmapsJsonResponse(200, $response);
    } catch (InvalidArgumentException $exception) {
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => $exception->getMessage(),
        ]);
    } catch (PDOException $exception) {
        avesmapsWikiSyncLogServerError('database_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
            'sqlstate' => (string) ($exception->errorInfo[0] ?? ''),
            'driver_code' => (string) ($exception->errorInfo[1] ?? ''),
            'driver_message' => (string) ($exception->errorInfo[2] ?? ''),
        ]);
        avesmapsJsonResponse(500, [
            'ok' => false,
            'error' => 'WikiSync konnte die Datenbank nicht verarbeiten.',
        ]);
    } catch (RuntimeException $exception) {
        avesmapsWikiSyncLogServerError('runtime_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);
        avesmapsJsonResponse(503, [
            'ok' => false,
            'error' => $exception->getMessage(),
        ]);
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('unexpected_error', [
            'exception_class' => $exception::class,
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);
        avesmapsJsonResponse(500, [
            'ok' => false,
            'error' => 'WikiSync konnte nicht verarbeitet werden.',
        ]);
    }
}

if (!defined('AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE')) {
    avesmapsWikiSyncHandleRequest('legacy');
}

function avesmapsWikiSyncEnsureTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_runs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
            status VARCHAR(20) NOT NULL DEFAULT 'running',
            phase VARCHAR(60) NOT NULL DEFAULT 'settlement_titles',
            progress_current INT NOT NULL DEFAULT 0,
            progress_total INT NOT NULL DEFAULT 4,
            message VARCHAR(255) NULL,
            stats_json JSON NULL,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            completed_at DATETIME(3) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_runs_public_id (public_id),
            KEY idx_wiki_sync_runs_status_created (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_pages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_page_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            normalized_key VARCHAR(255) NOT NULL,
            wiki_url VARCHAR(500) NOT NULL,
            settlement_class VARCHAR(60) NULL,
            settlement_label VARCHAR(120) NULL,
            categories_json JSON NULL,
            coordinates_json JSON NULL,
            content_hash CHAR(64) NULL,
            fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_pages_title (title),
            KEY idx_wiki_sync_pages_normalized_key (normalized_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_cases (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            case_key CHAR(64) NOT NULL,
            sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
            case_type VARCHAR(60) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            map_feature_id BIGINT UNSIGNED NULL,
            map_public_id CHAR(36) NULL,
            wiki_title VARCHAR(255) NULL,
            payload_json JSON NOT NULL,
            signature_hash CHAR(64) NOT NULL,
            first_seen_run_id BIGINT UNSIGNED NOT NULL,
            last_seen_run_id BIGINT UNSIGNED NOT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            reviewed_at DATETIME(3) NULL,
            reviewed_by BIGINT UNSIGNED NULL,
            resolution_json JSON NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_cases_case_key (case_key),
            KEY idx_wiki_sync_cases_run_status (last_seen_run_id, status),
            KEY idx_wiki_sync_cases_type_status (case_type, status),
            KEY idx_wiki_sync_cases_map_public_id (map_public_id),
            KEY idx_wiki_sync_cases_wiki_title (wiki_title)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    avesmapsWikiSyncEnsureMapFeatureLocksTable($pdo);
}

function avesmapsWikiSyncStartRun(PDO $pdo, array $user): array {
    avesmapsWikiSyncRelaxLimits();
    $publicId = avesmapsWikiSyncUuidV4();
    $statement = $pdo->prepare(
        'INSERT INTO wiki_sync_runs (public_id, sync_type, status, phase, progress_current, progress_total, message, stats_json, created_by)
        VALUES (:public_id, :sync_type, :status, :phase, 0, 4, :message, :stats_json, :created_by)'
    );
    $statement->execute([
        'public_id' => $publicId,
        'sync_type' => AVESMAPS_WIKI_SYNC_TYPE_LOCATION,
        'status' => 'running',
        'phase' => 'settlement_titles',
        'message' => 'Wiki-Siedlungstitel werden gelesen.',
        'stats_json' => avesmapsWikiSyncEncodeJson([]),
        'created_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    return [
        'ok' => true,
        'run' => avesmapsWikiSyncPublicRun(avesmapsWikiSyncFetchRunByPublicId($pdo, $publicId)),
    ];
}

function avesmapsWikiSyncAdvanceRun(PDO $pdo, array $payload): array {
    avesmapsWikiSyncRelaxLimits();
    $runPublicId = avesmapsWikiSyncReadPublicId($payload['run_id'] ?? '');
    $run = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
    if ($run['status'] === 'completed') {
        return [
            'ok' => true,
            'run' => avesmapsWikiSyncPublicRun($run),
            'summary' => avesmapsWikiSyncBuildSummary($pdo, (int) $run['id']),
        ];
    }

    if ($run['status'] !== 'running') {
        throw new RuntimeException('Dieser WikiSync-Lauf ist nicht aktiv.');
    }

    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    $phase = (string) $run['phase'];

    if ($phase === 'settlement_titles') {
        $titles = avesmapsWikiSyncFetchSettlementTitles();
        $stats['settlement_titles'] = $titles;
        $stats['settlement_title_count'] = count($titles);
        avesmapsWikiSyncUpdateRun($pdo, (int) $run['id'], 'running', 'match_map_places', 1, 'Avesmaps-Orte werden mit Wiki-Titeln abgeglichen.', $stats);
    } elseif ($phase === 'match_map_places') {
        $mapPlaces = avesmapsWikiSyncReadMapPlaces($pdo);
        $matchResult = avesmapsWikiSyncMatchMapPlaces($pdo, $mapPlaces, $stats['settlement_titles'] ?? []);
        $stats['map_places'] = $mapPlaces;
        $stats['matches'] = $matchResult['matches'];
        $stats['unresolved'] = $matchResult['unresolved'];
        $stats['map_place_count'] = count($mapPlaces);
        $stats['matched_count'] = count($matchResult['matches']);
        $stats['unresolved_count'] = count($matchResult['unresolved']);
        avesmapsWikiSyncUpdateRun($pdo, (int) $run['id'], 'running', 'missing_wiki_places', 2, 'Fehlende Wiki-Orte werden geladen.', $stats);
    } elseif ($phase === 'missing_wiki_places') {
        $matchedTitles = [];
        foreach (($stats['matches'] ?? []) as $match) {
            $matchedTitles[(string) ($match['wiki']['title'] ?? '')] = true;
        }
        $missingPlaces = avesmapsWikiSyncFetchMissingWikiPlaces($pdo, $stats['settlement_titles'] ?? [], array_keys($matchedTitles));
        $stats['missing_wiki_places'] = $missingPlaces;
        $stats['missing_wiki_place_count'] = count($missingPlaces);
        avesmapsWikiSyncUpdateRun($pdo, (int) $run['id'], 'running', 'build_cases', 3, "WikiSync-F\u{00E4}lle werden aufgebaut.", $stats);
    } elseif ($phase === 'build_cases') {
        $caseCount = avesmapsWikiSyncBuildAndStoreCases($pdo, (int) $run['id'], $stats);
        $stats['case_count'] = $caseCount;
        avesmapsWikiSyncUpdateRun($pdo, (int) $run['id'], 'completed', 'completed', 4, 'WikiSync abgeschlossen.', $stats);
        $pdo->prepare('UPDATE wiki_sync_runs SET completed_at = CURRENT_TIMESTAMP(3) WHERE id = :id')->execute(['id' => (int) $run['id']]);
    } else {
        throw new RuntimeException('Die WikiSync-Phase ist unbekannt.');
    }

    $updatedRun = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
    return [
        'ok' => true,
        'run' => avesmapsWikiSyncPublicRun($updatedRun),
        'summary' => $updatedRun['status'] === 'completed' ? avesmapsWikiSyncBuildSummary($pdo, (int) $updatedRun['id']) : null,
    ];
}

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
    $normalizedRowsByKey = [];

    foreach ($wikiRows as $row) {
        $row['name'] = avesmapsWikiSyncResolvePoliticalTerritoryName(
            (string) ($row['name'] ?? ''),
            (string) ($row['wiki_url'] ?? '')
        );

        $temporal = avesmapsWikiSyncBuildPoliticalTemporalPayload(
            (string) ($row['founded_text'] ?? ''),
            (string) ($row['dissolved_text'] ?? '')
        );

        $affiliationPath = avesmapsWikiSyncReadPoliticalTerritoryPath($row);

        if (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath($affiliationPath)) {
            $affiliationPath = [];
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
        if ($rawYear <= 0) {
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

    return $assignments;
}

function avesmapsWikiSyncApplyPoliticalTerritoryMapAssignments(array $rows, array $assignments): array {
    return array_map(static function (array $row) use ($assignments): array {
        $assignment = $assignments[(string) ($row['wiki_key'] ?? '')] ?? null;
        $geometryCount = (int) ($assignment['geometry_count'] ?? 0);

        $row['map_assigned'] = $geometryCount > 0;
        $row['map_territory_count'] = (int) ($assignment['territory_count'] ?? 0);
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

function avesmapsWikiSyncHasTrailingParentheticalSuffix(string $value): bool {
    return preg_match('/\([^)]*\)\s*$/u', $value) === 1;
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
                $childKeySource = (string) ($childReference['wiki_url'] ?? $childReference['name'] ?? '');
                $childKey = avesmapsWikiSyncCreateMatchKey($childKeySource);

                if ($childKey === '') {
                    continue;
                }

                $childReference['source_field'] = (string) $rawKey;
                $childTerritoriesByKey[$childKey] = $childReference;
            }

            continue;
        }

        $targetKey = $fieldMap[$key] ?? null;
        if ($targetKey === null) {
            continue;
        }

        $value = $targetKey === 'coat_of_arms_url'
            ? avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl($rawValue)
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
        && (string) ($details['founded_text'] ?? '') === ''
        && (string) ($details['dissolved_text'] ?? '') === ''
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
        if (preg_match('/^\|\s*([^=]+?)\s*=\s*(.*)$/u', $line, $matches) === 1) {
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
    $value = preg_replace('/<!--.*?-->/su', ' ', $value) ?? $value;
    $value = preg_replace('/<ref\b[^>]*>.*?<\/ref>/isu', ' ', $value) ?? $value;
    $value = preg_replace('/<ref\b[^\/>]*\/>/isu', ' ', $value) ?? $value;
    $value = preg_replace('/&\d{10,}\s*/u', '', $value) ?? $value;
    $value = preg_replace('/\[\[Datei:[^\]]+\]\]/iu', ' ', $value) ?? $value;
    $value = preg_replace('/\[\[File:[^\]]+\]\]/iu', ' ', $value) ?? $value;
    $value = preg_replace_callback('/\{\{Datum\|([^{}]+)\}\}/iu', static function (array $matches): string {
        return avesmapsWikiSyncFormatPoliticalTerritoryDateTemplate((string) $matches[1]);
    }, $value) ?? $value;
    $value = preg_replace('/\[\[[^|\]]+\|([^\]]+)\]\]/u', '$1', $value) ?? $value;
    $value = preg_replace('/\[\[([^\]]+)\]\]/u', '$1', $value) ?? $value;
    $value = preg_replace('/\{\{[^{}|]+\|([^{}]+)\}\}/u', '$1', $value) ?? $value;
    $value = preg_replace('/\{\{[^{}]*\}\}/u', ' ', $value) ?? $value;
    $value = str_replace(["'''", "''", '<br>', '<br/>', '<br />'], [' ', ' ', ' ', ' ', ' '], $value);
    $value = strip_tags($value);
    $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

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

    $text = $data['parse']['text'] ?? '';
    if (is_array($text)) {
        $text = (string) ($text['*'] ?? '');
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

        $headers = array_keys($parsedRows[0]['raw'] ?? []);
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
            $header = $headers[$index] ?? "spalte_{$index}";
            $raw[$header] = avesmapsWikiSyncNormalizeWikiTreeText($cell->textContent);
        }

        $name = $raw['name'] ?? '';
        if ($name === '') {
            continue;
        }

        $nameCellIndex = array_search('name', $headers, true);
        if (!is_int($nameCellIndex)) {
            $nameCellIndex = 0;
        }

        $nameCell = $cells[$nameCellIndex] ?? $cells[0] ?? null;
        if (!$nameCell instanceof DOMElement) {
            continue;
        }

        $nameLink = avesmapsWikiSyncReadFirstWikiLinkMetadata($nameCell);
        $canonicalName = avesmapsWikiSyncNormalizeWikiTreeText((string) ($nameLink['title'] ?? ''));
        if ($canonicalName !== '') {
            $name = $canonicalName;
        }

        $wikiUrl = (string) ($nameLink['url'] ?? '');
        if ($wikiUrl === '' && $name !== '') {
            $wikiUrl = avesmapsWikiSyncPageUrl($name);
        }

        $rows[] = [
            'raw' => $raw,
            'public' => [
                'name' => $name,
                'type' => $raw['typ'] ?? $raw['art'] ?? '',
                'affiliation' => $raw['zugehorigkeit'] ?? $raw['staat'] ?? '',
                'status' => $raw['status'] ?? '',
                'form_of_government' => $raw['herrschaftsform'] ?? '',
                'capital_name' => $raw['hauptstadt'] ?? '',
                'seat_name' => $raw['herrschaftssitz'] ?? '',
                'ruler' => $raw['oberhaupt'] ?? '',
                'language' => $raw['sprache'] ?? '',
                'currency' => $raw['wahrung'] ?? $raw['waehrung'] ?? '',
                'trade_goods' => $raw['handelswaren'] ?? '',
                'population' => $raw['einwohnerzahl'] ?? '',
                'founded_text' => $raw['grundungsdatum'] ?? '',
                'founder' => $raw['grunder'] ?? $raw['gruender'] ?? '',
                'dissolved_text' => $raw['aufgelost'] ?? '',
                'blazon' => $raw['blasonierung'] ?? '',
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

    $normalizedTitle = preg_replace('/^(?:Datei|File)\s*:\s*/iu', '', $normalizedTitle) ?? $normalizedTitle;
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
            $fullMatch = (string) ($match[0][0] ?? '');
            $matchOffset = (int) ($match[0][1] ?? 0);
            $pageTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[1][0] ?? ''));
            $displayText = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[2][0] ?? ''));

            if ($pageTitle === '' || avesmapsWikiSyncIsIgnoredPoliticalTerritoryLinkTitle($pageTitle)) {
                continue;
            }

            $nameSource = $displayText !== '' ? $displayText : $pageTitle;
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

        $existing = $referencesByKey[$key] ?? null;
        if (!is_array($existing)) {
            $referencesByKey[$key] = $reference;
            continue;
        }

        if (trim((string) ($existing['wiki_url'] ?? '')) === '' && trim((string) ($reference['wiki_url'] ?? '')) !== '') {
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
    $prefix = preg_replace('/.*(?:,|;|·|\n|\r)/su', '', $prefix) ?? $prefix;
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
    $suffix = preg_replace('/(?:,|;|·|\n|\r).*$/su', '', $suffix) ?? $suffix;
    $suffix = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($suffix);

    $suffixCandidate = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($linkedName . ' ' . $suffix);
    if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($suffixCandidate)) {
        return $suffixCandidate;
    }

    return '';
}



function avesmapsWikiSyncBuildPoliticalTerritoryChildRows(array $childReferences, array $parentRow): array {
    $parentName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($parentRow['name'] ?? ''));
    if ($parentName === '') {
        return [];
    }

    $parentKey = avesmapsWikiSyncCreateMatchKey($parentName);
    $rows = [];

    foreach ($childReferences as $childReference) {
        if (!is_array($childReference)) {
            continue;
        }

        $childName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($childReference['name'] ?? ''));
        if ($childName === '') {
            continue;
        }

        $childKey = avesmapsWikiSyncCreateMatchKey($childName);
        if ($childKey === '' || $childKey === $parentKey) {
            continue;
        }

        $rows[] = [
            'name' => $childName,
            'type' => (string) ($childReference['type'] ?? avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($childName)),
            'continent' => (string) ($parentRow['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT),
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
            'wiki_url' => (string) ($childReference['wiki_url'] ?? avesmapsWikiSyncPageUrl($childName)),
            'coat_of_arms_url' => '',
            'discovered_from_parent' => $parentName,
            'discovered_from_field' => (string) ($childReference['source_field'] ?? ''),
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
    ) ?? $normalized;

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
    return (string) (avesmapsWikiSyncReadFirstWikiLinkMetadata($cell)['url'] ?? '');
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
        $content = $contentsByTitle[$title] ?? '';
        if ($content === '') {
            continue;
        }

        $details = avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent($content);
        if (!avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails($details)) {
            continue;
        }

        $referenceRows[] = [
            'name' => $title,
            'type' => (string) ($details['type'] ?? ''),
            'affiliation' => '',
            'status' => (string) ($details['status'] ?? ''),
            'form_of_government' => (string) ($details['form_of_government'] ?? ''),
            'capital_name' => (string) ($details['capital_name'] ?? ''),
            'seat_name' => (string) ($details['seat_name'] ?? ''),
            'ruler' => (string) ($details['ruler'] ?? ''),
            'language' => (string) ($details['language'] ?? ''),
            'currency' => (string) ($details['currency'] ?? ''),
            'trade_goods' => (string) ($details['trade_goods'] ?? ''),
            'population' => '',
            'founded_text' => (string) ($details['founded_text'] ?? ''),
            'founder' => (string) ($details['founder'] ?? ''),
            'dissolved_text' => (string) ($details['dissolved_text'] ?? ''),
            'blazon' => (string) ($details['blazon'] ?? ''),
            'wiki_url' => avesmapsWikiSyncPageUrl($title),
        ];
    }

    return $referenceRows;
}

function avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails(array $details): bool {
    foreach (['type', 'status', 'capital_name', 'seat_name', 'ruler', 'founded_text', 'dissolved_text'] as $key) {
        if ((string) ($details[$key] ?? '') !== '') {
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
        if (avesmapsWikiSyncIsIndependentPoliticalTerritoryPath($path)) {
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

function avesmapsWikiSyncCreatePoliticalTreeNode(string $key, string $name, ?array $row = null): array {
    $node = [
        'id' => 0,
        'wiki_key' => '',
        'key' => 'wiki:' . $key,
        'public_id' => 'wiki:' . $key,
        'name' => $name,
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

    return $row === null ? $node : avesmapsWikiSyncApplyPoliticalRowToTreeNode($node, $row);
}

function avesmapsWikiSyncApplyPoliticalRowToTreeNode(array $node, array $row): array {
    $node['id'] = (int) ($row['id'] ?? 0);
    $node['wiki_key'] = (string) ($row['wiki_key'] ?? '');
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
        return ["ungekl\u{00E4}rt"];
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

    return $normalizedPath !== [] ? $normalizedPath : ['Sonstiges'];
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
    if ($key !== '' && isset($rowIndex[$key])) {
        return $normalizedPart;
    }

    $candidateBeforeSemicolon = trim((string) (preg_split('/\s*(?:[;]|,\s*(?=(?:ehemals|frueher|historisch|vormals)\b))\s*/iu', $normalizedPart)[0] ?? $normalizedPart));
    $candidateKey = avesmapsWikiSyncMakePoliticalTreeKey($candidateBeforeSemicolon);

    if ($candidateKey !== '' && isset($rowIndex[$candidateKey])) {
        return $candidateBeforeSemicolon;
    }

    return $normalizedPart;
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
    if ($year < 0) {
        return abs($year) . ' v. BF';
    }

    return $year . ' BF';
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

function avesmapsWikiSyncListCases(PDO $pdo): array {
    $run = avesmapsWikiSyncFetchLatestCompletedRun($pdo);
    $activeRun = avesmapsWikiSyncFetchLatestActiveRun($pdo);
    if ($run === null) {
        return [
            'ok' => true,
            'latest_run' => null,
            'active_run' => $activeRun === null ? null : avesmapsWikiSyncPublicRun($activeRun),
            'summary' => [
                'case_count' => 0,
                'visible_count' => 0,
                'by_type' => [],
                'by_status' => [],
            ],
            'cases' => [],
        ];
    }

    $statement = $pdo->prepare(
        "SELECT id, case_type, status, map_public_id, wiki_title, payload_json, resolution_json, signature_hash, updated_at
        FROM wiki_sync_cases
        WHERE (last_seen_run_id = :run_id AND status IN ('open', 'deferred'))
            OR status = 'archived'
        ORDER BY
            FIELD(case_type, 'canonical_name_difference', 'type_conflict', 'probable_match', 'unresolved_without_candidate', 'duplicate_avesmaps_name', 'duplicate_wiki_title', 'missing_wiki_with_coordinates', 'missing_wiki_without_coordinates'),
            wiki_title ASC,
            map_public_id ASC,
            id ASC"
    );
    $statement->execute(['run_id' => (int) $run['id']]);

    $cases = [];
    foreach ($statement->fetchAll() as $row) {
        $payload = avesmapsWikiSyncDecodeJson($row['payload_json'] ?? null);
        $cases[] = [
            'id' => (int) $row['id'],
            'case_type' => (string) $row['case_type'],
            'case_label' => avesmapsWikiSyncCaseLabel((string) $row['case_type']),
            'status' => (string) $row['status'],
            'map_public_id' => (string) ($row['map_public_id'] ?? ''),
            'wiki_title' => (string) ($row['wiki_title'] ?? ''),
            'payload' => $payload,
            'resolution' => avesmapsWikiSyncDecodeJson($row['resolution_json'] ?? null),
            'signature_hash' => (string) $row['signature_hash'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    return [
        'ok' => true,
        'latest_run' => avesmapsWikiSyncPublicRun($run),
        'active_run' => $activeRun === null ? null : avesmapsWikiSyncPublicRun($activeRun),
        'summary' => avesmapsWikiSyncBuildSummary($pdo, (int) $run['id']),
        'cases' => $cases,
    ];
}

function avesmapsWikiSyncUpdateCaseStatus(PDO $pdo, array $payload, array $user, string $status): array {
    $caseId = avesmapsWikiSyncReadPositiveInt($payload['case_id'] ?? null, 'case_id');
    if (!in_array($status, ['open', 'deferred', 'archived'], true)) {
        throw new InvalidArgumentException('Der WikiSync-Status ist ungueltig.');
    }

    $resolution = isset($payload['resolution']) && is_array($payload['resolution']) ? $payload['resolution'] : null;

    $statement = $pdo->prepare(
        'UPDATE wiki_sync_cases
        SET status = :status,
            reviewed_at = CURRENT_TIMESTAMP(3),
            reviewed_by = :reviewed_by,
            resolution_json = :resolution_json
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $caseId,
        'status' => $status,
        'reviewed_by' => (int) ($user['id'] ?? 0) ?: null,
        'resolution_json' => $resolution !== null ? avesmapsWikiSyncEncodeJson($resolution) : null,
    ]);

    if ($statement->rowCount() < 1) {
        throw new InvalidArgumentException('Der WikiSync-Fall wurde nicht gefunden.');
    }

    return [
        'ok' => true,
        'case_id' => $caseId,
        'status' => $status,
    ];
}

function avesmapsWikiSyncResolveCase(PDO $pdo, array $payload, array $user): array {
    $caseId = avesmapsWikiSyncReadPositiveInt($payload['case_id'] ?? null, 'case_id');
    $case = avesmapsWikiSyncFetchCase($pdo, $caseId);
    $casePayload = avesmapsWikiSyncDecodeJson($case['payload_json'] ?? null);

    $publicId = avesmapsNormalizeSingleLine((string) ($payload['public_id'] ?? ''), 36);
    $name = avesmapsWikiSyncReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsWikiSyncReadLocationSubtype($payload['feature_subtype'] ?? 'dorf');
    $description = avesmapsNormalizeMultiline((string) ($payload['description'] ?? ''), 1200);
    $wikiUrl = avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 500, 'Der Wiki-Aventurica-Link');
    $isNodix = avesmapsWikiSyncReadBoolean($payload['is_nodix'] ?? false);
    $isRuined = avesmapsWikiSyncReadBoolean($payload['is_ruined'] ?? false);

    $pdo->beginTransaction();
    try {
        $feature = $publicId !== ''
            ? avesmapsWikiSyncUpdateLocationFeature($pdo, $payload, $user, $publicId, $name, $subtype, $description, $wikiUrl, $isNodix, $isRuined)
            : avesmapsWikiSyncCreateLocationFeature($pdo, $user, $payload, $name, $subtype, $description, $wikiUrl, $isNodix, $isRuined);

        $resolution = [
            'resolved_at' => gmdate('c'),
            'resolved_by' => (string) ($user['username'] ?? ''),
            'feature' => $feature,
            'case_type' => (string) ($case['case_type'] ?? ''),
            'wiki_title' => (string) ($casePayload['wiki']['title'] ?? $case['wiki_title'] ?? ''),
        ];

        $statement = $pdo->prepare(
            'UPDATE wiki_sync_cases
            SET status = :status,
                reviewed_at = CURRENT_TIMESTAMP(3),
                reviewed_by = :reviewed_by,
                resolution_json = :resolution_json
            WHERE id = :id'
        );
        $statement->execute([
            'id' => $caseId,
            'status' => 'archived',
            'reviewed_by' => (int) ($user['id'] ?? 0) ?: null,
            'resolution_json' => avesmapsWikiSyncEncodeJson($resolution),
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'case_id' => $caseId,
        'feature' => $feature,
    ];
}

function avesmapsWikiSyncUpdateLocationFeature(
    PDO $pdo,
    array $payload,
    array $user,
    string $publicId,
    string $name,
    string $subtype,
    string $description,
    string $wikiUrl,
    bool $isNodix,
    bool $isRuined
): array {
    $feature = avesmapsWikiSyncFetchEditablePointFeature($pdo, $publicId);
    if ((string) $feature['feature_type'] !== 'location') {
        throw new InvalidArgumentException('WikiSync kann nur Orts-Punkte bearbeiten.');
    }

    $currentName = (string) ($feature['name'] ?? '');
    $properties = avesmapsWikiSyncDecodeJson($feature['properties_json'] ?? null);
    $geometry = avesmapsWikiSyncDecodeJson($feature['geometry_json'] ?? null);
    [$lng, $lat] = avesmapsWikiSyncReadPointCoordinatesFromGeometry($geometry);
    $nextProperties = avesmapsWikiSyncBuildLocationProperties($properties, $name, $subtype, $description, $wikiUrl, $isNodix, $isRuined);

    if (!avesmapsWikiSyncLocationFeatureNeedsUpdate($feature, $properties, $name, $subtype, $description, $wikiUrl, $isNodix, $isRuined)) {
        return avesmapsWikiSyncBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $nextProperties, (int) $feature['revision']);
    }

    avesmapsWikiSyncAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
    if (avesmapsWikiSyncNormalizeDuplicateLocationName($currentName) !== avesmapsWikiSyncNormalizeDuplicateLocationName($name)) {
        avesmapsWikiSyncAssertUniqueLocationName($pdo, $name, $publicId);
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);

    $statement = $pdo->prepare(
        'UPDATE map_features
        SET name = :name,
            feature_type = :feature_type,
            feature_subtype = :feature_subtype,
            properties_json = :properties_json,
            revision = :revision,
            updated_by = :updated_by
        WHERE id = :id'
    );
    $statement->execute([
        'id' => (int) $feature['id'],
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'properties_json' => avesmapsWikiSyncEncodeJson($nextProperties),
        'revision' => $revision,
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    avesmapsWikiSyncWriteMapAuditLog($pdo, (int) $feature['id'], 'wiki_sync_update_point', (int) ($user['id'] ?? 0), avesmapsWikiSyncEncodeJson($feature), avesmapsWikiSyncEncodeJson([
        'public_id' => $publicId,
        'wiki_sync_case_id' => (int) ($payload['case_id'] ?? 0),
        'feature_type' => 'location',
        'name' => $name,
        'feature_subtype' => $subtype,
        'properties_json' => $nextProperties,
        'revision' => $revision,
    ]));

    return avesmapsWikiSyncBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $nextProperties, $revision);
}

function avesmapsWikiSyncBuildLocationProperties(
    array $baseProperties,
    string $name,
    string $subtype,
    string $description,
    string $wikiUrl,
    bool $isNodix,
    bool $isRuined
): array {
    $properties = $baseProperties;
    $properties['name'] = $name;
    $properties['feature_type'] = 'location';
    $properties['feature_subtype'] = $subtype;
    $properties['settlement_class'] = $subtype;
    $properties['settlement_class_label'] = avesmapsWikiSyncLocationSubtypeLabel($subtype);
    $properties['is_nodix'] = $isNodix;
    $properties['is_ruined'] = $isRuined;
    if ($description === '') {
        unset($properties['description']);
    } else {
        $properties['description'] = $description;
    }
    if ($wikiUrl === '') {
        unset($properties['wiki_url']);
    } else {
        $properties['wiki_url'] = $wikiUrl;
    }

    return $properties;
}

function avesmapsWikiSyncLocationFeatureNeedsUpdate(
    array $feature,
    array $properties,
    string $name,
    string $subtype,
    string $description,
    string $wikiUrl,
    bool $isNodix,
    bool $isRuined
): bool {
    $currentSubtype = avesmapsWikiSyncReadSettlementClass((string) ($feature['feature_subtype'] ?? $properties['settlement_class'] ?? 'dorf'));

    return (string) ($feature['name'] ?? '') !== $name
        || $currentSubtype !== $subtype
        || (string) ($properties['description'] ?? '') !== $description
        || (string) ($properties['wiki_url'] ?? '') !== $wikiUrl
        || avesmapsWikiSyncReadBoolean($properties['is_nodix'] ?? false) !== $isNodix
        || avesmapsWikiSyncReadBoolean($properties['is_ruined'] ?? false) !== $isRuined;
}

function avesmapsWikiSyncCreateLocationFeature(
    PDO $pdo,
    array $user,
    array $payload,
    string $name,
    string $subtype,
    string $description,
    string $wikiUrl,
    bool $isNodix,
    bool $isRuined
): array {
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsWikiSyncUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'settlement_class' => $subtype,
        'settlement_class_label' => avesmapsWikiSyncLocationSubtypeLabel($subtype),
        'is_nodix' => $isNodix,
        'is_ruined' => $isRuined,
    ];
    if ($description !== '') {
        $properties['description'] = $description;
    }
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    avesmapsWikiSyncAssertUniqueLocationName($pdo, $name);
    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $sortOrder = avesmapsWikiSyncNextMapSortOrder($pdo);
    $statement = $pdo->prepare(
        'INSERT INTO map_features (
            public_id, feature_type, feature_subtype, name, geometry_type,
            geometry_json, properties_json, min_x, min_y, max_x, max_y,
            sort_order, revision, created_by, updated_by
        ) VALUES (
            :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
            :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
            :sort_order, :revision, :created_by, :updated_by
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'name' => $name,
        'geometry_type' => 'Point',
        'geometry_json' => avesmapsWikiSyncEncodeJson($geometry),
        'properties_json' => avesmapsWikiSyncEncodeJson($properties),
        'min_x' => $lng,
        'min_y' => $lat,
        'max_x' => $lng,
        'max_y' => $lat,
        'sort_order' => $sortOrder,
        'revision' => $revision,
        'created_by' => (int) ($user['id'] ?? 0) ?: null,
        'updated_by' => (int) ($user['id'] ?? 0) ?: null,
    ]);

    $featureId = (int) $pdo->lastInsertId();
    avesmapsWikiSyncWriteMapAuditLog($pdo, $featureId, 'wiki_sync_create_point', (int) ($user['id'] ?? 0), '{}', avesmapsWikiSyncEncodeJson([
        'public_id' => $publicId,
        'wiki_sync_case_id' => (int) ($payload['case_id'] ?? 0),
        'feature_type' => 'location',
        'name' => $name,
        'feature_subtype' => $subtype,
        'geometry_json' => $geometry,
        'properties_json' => $properties,
        'revision' => $revision,
    ]));

    return avesmapsWikiSyncBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
}

function avesmapsWikiSyncFetchSettlementTitles(): array {
    $titles = [];
    foreach (avesmapsWikiSyncFetchSiedlungenIndexCategories() as $categoryName) {
        foreach (avesmapsWikiSyncFetchCategoryMemberTitles($categoryName) as $title) {
            $titles[$title] = $title;
        }
    }

    natcasesort($titles);
    return array_values($titles);
}

function avesmapsWikiSyncFetchSiedlungenIndexCategories(): array {
    $categories = [];
    $continueToken = null;
    do {
        $params = [
            'action' => 'query',
            'list' => 'allcategories',
            'acprefix' => 'Siedlungen-Index',
            'aclimit' => 'max',
        ];
        if ($continueToken !== null) {
            $params['accontinue'] = $continueToken;
        }

        $data = avesmapsWikiSyncApiRequest($params);
        foreach (($data['query']['allcategories'] ?? []) as $category) {
            $categoryName = (string) ($category['category'] ?? $category['*'] ?? '');
            if ($categoryName !== '') {
                $categories[$categoryName] = $categoryName;
            }
        }
        $continueToken = $data['continue']['accontinue'] ?? null;
    } while ($continueToken !== null);

    natcasesort($categories);
    return array_values($categories);
}

function avesmapsWikiSyncFetchCategoryMemberTitles(string $categoryName): array {
    $titles = [];
    $continueToken = null;
    do {
        $params = [
            'action' => 'query',
            'list' => 'categorymembers',
            'cmtitle' => 'Kategorie:' . $categoryName,
            'cmnamespace' => '0',
            'cmlimit' => 'max',
        ];
        if ($continueToken !== null) {
            $params['cmcontinue'] = $continueToken;
        }

        $data = avesmapsWikiSyncApiRequest($params);
        foreach (($data['query']['categorymembers'] ?? []) as $member) {
            $title = (string) ($member['title'] ?? '');
            if ($title !== '') {
                $titles[$title] = $title;
            }
        }
        $continueToken = $data['continue']['cmcontinue'] ?? null;
    } while ($continueToken !== null);

    return array_values($titles);
}

function avesmapsWikiSyncMatchMapPlaces(PDO $pdo, array $mapPlaces, array $settlementTitles): array {
    $settlementTitleSet = array_fill_keys($settlementTitles, true);
    [$uniqueTitleIndex, $ambiguousTitleIndex] = avesmapsWikiSyncCreateUniqueTitleIndex($settlementTitles);
    $fuzzyTitleKeys = [];
    foreach ($settlementTitles as $title) {
        $titleKey = avesmapsWikiSyncCreateMatchKey($title);
        if ($titleKey !== '' && !isset($fuzzyTitleKeys[$titleKey])) {
            $fuzzyTitleKeys[$titleKey] = $title;
        }
    }

    $mapNames = array_map(static fn(array $place): string => (string) $place['name'], $mapPlaces);
    $directPages = avesmapsWikiSyncFetchPagesByRequestedTitle($pdo, $mapNames, true, false);
    $matchesByName = [];
    $unmatchedPlaces = [];

    foreach ($mapPlaces as $mapPlace) {
        $directPage = $directPages[$mapPlace['name']] ?? null;
        if (is_array($directPage) && isset($settlementTitleSet[(string) $directPage['title']])) {
            $matchKind = (string) $directPage['title'] === (string) $mapPlace['name'] ? 'exact' : 'redirect';
            $matchesByName[(string) $mapPlace['name']] = avesmapsWikiSyncBuildMatch($mapPlace, $directPage, $matchKind);
            continue;
        }

        $unmatchedPlaces[] = $mapPlace;
    }

    $normalizedTitles = [];
    foreach ($unmatchedPlaces as $mapPlace) {
        $uniqueTitle = $uniqueTitleIndex[avesmapsWikiSyncCreateMatchKey((string) $mapPlace['name'])] ?? null;
        if ($uniqueTitle !== null) {
            $normalizedTitles[$uniqueTitle] = $uniqueTitle;
        }
    }
    $normalizedPages = avesmapsWikiSyncFetchPagesByTitle($pdo, array_values($normalizedTitles), true, false);

    $stillUnmatched = [];
    foreach ($unmatchedPlaces as $mapPlace) {
        $uniqueTitle = $uniqueTitleIndex[avesmapsWikiSyncCreateMatchKey((string) $mapPlace['name'])] ?? null;
        if ($uniqueTitle !== null && isset($normalizedPages[$uniqueTitle])) {
            $matchesByName[(string) $mapPlace['name']] = avesmapsWikiSyncBuildMatch($mapPlace, $normalizedPages[$uniqueTitle], 'normalized');
            continue;
        }

        $stillUnmatched[] = $mapPlace;
    }

    $searchMatchTitles = avesmapsWikiSyncFetchSearchMatches($pdo, array_map(static fn(array $place): string => (string) $place['name'], $stillUnmatched), $settlementTitleSet);
    $searchPages = avesmapsWikiSyncFetchPagesByTitle($pdo, array_values(array_unique(array_values($searchMatchTitles))), true, false);
    $unresolved = [];
    foreach ($stillUnmatched as $mapPlace) {
        $searchTitle = $searchMatchTitles[(string) $mapPlace['name']] ?? null;
        if ($searchTitle !== null && isset($searchPages[$searchTitle])) {
            $matchesByName[(string) $mapPlace['name']] = avesmapsWikiSyncBuildMatch($mapPlace, $searchPages[$searchTitle], 'search');
            continue;
        }

        $unresolved[] = [
            'map' => avesmapsWikiSyncPublicMapPlace($mapPlace),
            'candidates' => avesmapsWikiSyncBuildProbableCandidates((string) $mapPlace['name'], $ambiguousTitleIndex, $fuzzyTitleKeys),
        ];
    }

    $matches = array_values($matchesByName);
    usort($matches, static fn(array $left, array $right): int => strcasecmp((string) $left['map']['name'], (string) $right['map']['name']));
    usort($unresolved, static fn(array $left, array $right): int => strcasecmp((string) $left['map']['name'], (string) $right['map']['name']));

    return [
        'matches' => $matches,
        'unresolved' => $unresolved,
    ];
}

function avesmapsWikiSyncFetchMissingWikiPlaces(PDO $pdo, array $settlementTitles, array $matchedTitles): array {
    $matchedTitleSet = array_fill_keys($matchedTitles, true);
    $missingTitles = [];
    foreach ($settlementTitles as $title) {
        if (!isset($matchedTitleSet[$title])) {
            $missingTitles[] = $title;
        }
    }

    $missingPlaces = [];
    foreach (array_chunk($missingTitles, AVESMAPS_WIKI_TITLE_BATCH_SIZE) as $batch) {
        $pages = avesmapsWikiSyncFetchPagesByTitle($pdo, $batch, true, true);
        foreach ($batch as $title) {
            $page = $pages[$title] ?? null;
            if (!is_array($page)) {
                continue;
            }

            $content = avesmapsWikiSyncReadPageContent($page);
            $coordinates = avesmapsWikiSyncExtractCoordinatesFromContent($content);
            $missingPlaces[] = [
                'wiki' => avesmapsWikiSyncPublicWikiPage($page, $coordinates),
            ];
        }
    }

    usort(
        $missingPlaces,
        static function (array $left, array $right): int {
            $sourceComparison = avesmapsWikiSyncCoordinateSortValue((string) ($left['wiki']['coordinates']['source'] ?? 'none'))
                <=> avesmapsWikiSyncCoordinateSortValue((string) ($right['wiki']['coordinates']['source'] ?? 'none'));

            if ($sourceComparison !== 0) {
                return $sourceComparison;
            }

            return strcasecmp((string) $left['wiki']['title'], (string) $right['wiki']['title']);
        }
    );

    return $missingPlaces;
}

function avesmapsWikiSyncBuildAndStoreCases(PDO $pdo, int $runId, array $stats): int {
    $cases = [];
    $mapPlaces = is_array($stats['map_places'] ?? null) ? $stats['map_places'] : [];
    $matches = is_array($stats['matches'] ?? null) ? $stats['matches'] : [];
    $unresolved = is_array($stats['unresolved'] ?? null) ? $stats['unresolved'] : [];
    $missingPlaces = is_array($stats['missing_wiki_places'] ?? null) ? $stats['missing_wiki_places'] : [];

    try {
        foreach (avesmapsWikiSyncFindDuplicateMapPlaceNames($mapPlaces) as $duplicateGroup) {
            $cases[] = avesmapsWikiSyncBuildCase('duplicate_avesmaps_name', $duplicateGroup);
        }
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('duplicate_avesmaps_name_build_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);
    }

    foreach ($matches as $match) {
        if (($match['match_kind'] ?? '') !== 'exact') {
            $cases[] = avesmapsWikiSyncBuildCase('canonical_name_difference', $match);
        }
        $wikiClass = (string) ($match['wiki']['settlement_class'] ?? '');
        $mapClass = (string) ($match['map']['settlement_class'] ?? '');
        if ($wikiClass !== '' && $mapClass !== '' && $wikiClass !== $mapClass) {
            $cases[] = avesmapsWikiSyncBuildCase('type_conflict', $match);
        }
    }

    foreach ($unresolved as $result) {
        $caseType = !empty($result['candidates']) ? 'probable_match' : 'unresolved_without_candidate';
        $cases[] = avesmapsWikiSyncBuildCase($caseType, $result);
    }

    $matchesByTitle = [];
    foreach ($matches as $match) {
        $title = (string) ($match['wiki']['title'] ?? '');
        if ($title === '') {
            continue;
        }
        $matchesByTitle[$title][] = $match;
    }
    foreach ($matchesByTitle as $title => $titleMatches) {
        $mapNames = [];
        foreach ($titleMatches as $match) {
            $mapNames[(string) ($match['map']['name'] ?? '')] = true;
        }
        if (count($mapNames) > 1) {
            $cases[] = avesmapsWikiSyncBuildCase('duplicate_wiki_title', [
                'wiki' => $titleMatches[0]['wiki'],
                'matches' => $titleMatches,
            ]);
        }
    }

    foreach ($missingPlaces as $missingPlace) {
        $source = (string) ($missingPlace['wiki']['coordinates']['source'] ?? 'none');
        $payload = $missingPlace;
        $proposedLocation = $source === 'none' ? null : avesmapsWikiSyncCoordinatesToMapLocation($missingPlace['wiki']['coordinates']);
        $caseType = $proposedLocation === null ? 'missing_wiki_without_coordinates' : 'missing_wiki_with_coordinates';
        if ($proposedLocation !== null) {
            $payload['proposed_location'] = $proposedLocation;
        }
        $cases[] = avesmapsWikiSyncBuildCase($caseType, $payload);
    }

    $storedCount = 0;
    foreach ($cases as $case) {
        try {
            avesmapsWikiSyncUpsertCase($pdo, $runId, $case);
        } catch (Throwable $exception) {
            if ((string) ($case['case_type'] ?? '') !== 'duplicate_avesmaps_name') {
                throw $exception;
            }

            avesmapsWikiSyncLogServerError('duplicate_avesmaps_name_store_error', [
                'exception_class' => $exception::class,
                'exception_message' => $exception->getMessage(),
            ]);
            continue;
        }

        $storedCount++;
    }

    return $storedCount;
}

function avesmapsWikiSyncBuildCase(string $caseType, array $payload): array {
    $mapPublicId = (string) ($payload['map']['public_id'] ?? '');
    $mapFeatureId = isset($payload['map']['id']) ? (int) $payload['map']['id'] : null;
    $wikiTitle = (string) ($payload['wiki']['title'] ?? '');
    $caseSeed = implode('|', [
        AVESMAPS_WIKI_SYNC_TYPE_LOCATION,
        $caseType,
        $mapPublicId,
        $wikiTitle,
        hash('sha256', avesmapsWikiSyncEncodeJson($payload['matches'] ?? $payload['candidates'] ?? [])),
    ]);
    $caseKey = hash('sha256', $caseSeed);
    $signatureHash = hash('sha256', avesmapsWikiSyncEncodeJson($payload));

    return [
        'case_key' => $caseKey,
        'case_type' => $caseType,
        'map_feature_id' => $mapFeatureId,
        'map_public_id' => $mapPublicId !== '' ? $mapPublicId : null,
        'wiki_title' => $wikiTitle !== '' ? $wikiTitle : null,
        'payload' => $payload,
        'signature_hash' => $signatureHash,
    ];
}

function avesmapsWikiSyncFindDuplicateMapPlaceNames(array $mapPlaces): array {
    $placesByName = [];
    foreach ($mapPlaces as $mapPlace) {
        $name = trim((string) ($mapPlace['name'] ?? ''));
        if ($name === '') {
            continue;
        }

        $placesByName[$name][] = avesmapsWikiSyncPublicDuplicateMapPlace($mapPlace);
    }

    uksort($placesByName, static fn(string $left, string $right): int => strcasecmp($left, $right));
    $duplicateGroups = [];
    foreach ($placesByName as $name => $places) {
        if (count($places) < 2) {
            continue;
        }

        usort(
            $places,
            static fn(array $left, array $right): int => strcmp((string) $left['public_id'], (string) $right['public_id'])
        );
        $duplicateGroups[] = [
            'name' => $name,
            'matches' => $places,
        ];
    }

    return $duplicateGroups;
}

function avesmapsWikiSyncPublicDuplicateMapPlace(array $mapPlace): array {
    return [
        'id' => (int) ($mapPlace['id'] ?? 0),
        'public_id' => (string) ($mapPlace['public_id'] ?? ''),
        'name' => (string) ($mapPlace['name'] ?? ''),
        'settlement_class' => (string) ($mapPlace['settlement_class'] ?? 'dorf'),
        'settlement_label' => (string) ($mapPlace['settlement_label'] ?? 'Dorf'),
        'lat' => (float) ($mapPlace['lat'] ?? 0),
        'lng' => (float) ($mapPlace['lng'] ?? 0),
        'revision' => (int) ($mapPlace['revision'] ?? 0),
    ];
}

function avesmapsWikiSyncUpsertCase(PDO $pdo, int $runId, array $case): void {
    $existingStatement = $pdo->prepare(
        'SELECT id, status, signature_hash
        FROM wiki_sync_cases
        WHERE case_key = :case_key
        LIMIT 1'
    );
    $existingStatement->execute(['case_key' => $case['case_key']]);
    $existing = $existingStatement->fetch();

    if (!$existing) {
        $insertStatement = $pdo->prepare(
            'INSERT INTO wiki_sync_cases (
                case_key, sync_type, case_type, status, map_feature_id, map_public_id, wiki_title,
                payload_json, signature_hash, first_seen_run_id, last_seen_run_id
            ) VALUES (
                :case_key, :sync_type, :case_type, :status, :map_feature_id, :map_public_id, :wiki_title,
                :payload_json, :signature_hash, :first_seen_run_id, :last_seen_run_id
            )'
        );
        $insertStatement->execute([
            'case_key' => $case['case_key'],
            'sync_type' => AVESMAPS_WIKI_SYNC_TYPE_LOCATION,
            'case_type' => $case['case_type'],
            'status' => 'open',
            'map_feature_id' => $case['map_feature_id'],
            'map_public_id' => $case['map_public_id'],
            'wiki_title' => $case['wiki_title'],
            'payload_json' => avesmapsWikiSyncEncodeJson($case['payload']),
            'signature_hash' => $case['signature_hash'],
            'first_seen_run_id' => $runId,
            'last_seen_run_id' => $runId,
        ]);
        return;
    }

    $existingStatus = (string) $existing['status'];
    $sameSignature = hash_equals((string) $existing['signature_hash'], (string) $case['signature_hash']);
    $isArchived = $existingStatus === 'archived';
    $nextStatus = $isArchived ? 'archived' : ($sameSignature ? $existingStatus : 'open');
    $preserveReviewStateValue = ($sameSignature || $isArchived) ? 1 : 0;
    $updateStatement = $pdo->prepare(
        'UPDATE wiki_sync_cases
        SET case_type = :case_type,
            status = :status,
            map_feature_id = :map_feature_id,
            map_public_id = :map_public_id,
            wiki_title = :wiki_title,
            payload_json = :payload_json,
            signature_hash = :signature_hash,
            last_seen_run_id = :last_seen_run_id,
            reviewed_at = CASE WHEN :preserve_reviewed_at = 1 THEN reviewed_at ELSE NULL END,
            reviewed_by = CASE WHEN :preserve_reviewed_by = 1 THEN reviewed_by ELSE NULL END,
            resolution_json = CASE WHEN :preserve_resolution = 1 THEN resolution_json ELSE NULL END
        WHERE id = :id'
    );
    $updateStatement->execute([
        'id' => (int) $existing['id'],
        'case_type' => $case['case_type'],
        'status' => $nextStatus,
        'map_feature_id' => $case['map_feature_id'],
        'map_public_id' => $case['map_public_id'],
        'wiki_title' => $case['wiki_title'],
        'payload_json' => avesmapsWikiSyncEncodeJson($case['payload']),
        'signature_hash' => $case['signature_hash'],
        'last_seen_run_id' => $runId,
        'preserve_reviewed_at' => $preserveReviewStateValue,
        'preserve_reviewed_by' => $preserveReviewStateValue,
        'preserve_resolution' => $preserveReviewStateValue,
    ]);
}

function avesmapsWikiSyncReadMapPlaces(PDO $pdo): array {
    $allowedSubtypes = array_keys(AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS);
    $placeholders = implode(',', array_fill(0, count($allowedSubtypes), '?'));
    $statement = $pdo->prepare(
        "SELECT id, public_id, feature_subtype, name, geometry_json, properties_json, revision
        FROM map_features
        WHERE is_active = 1
            AND feature_type = 'location'
            AND geometry_type = 'Point'
            AND feature_subtype IN ({$placeholders})
        ORDER BY name ASC, id ASC"
    );
    $statement->execute($allowedSubtypes);

    $places = [];
    foreach ($statement->fetchAll() as $row) {
        $geometry = avesmapsWikiSyncDecodeJson($row['geometry_json'] ?? null);
        $properties = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $coordinates = $geometry['coordinates'] ?? [];
        if (!is_array($coordinates) || count($coordinates) < 2 || !is_numeric($coordinates[0]) || !is_numeric($coordinates[1])) {
            continue;
        }

        $subtype = avesmapsWikiSyncReadSettlementClass((string) ($row['feature_subtype'] ?? $properties['settlement_class'] ?? 'dorf'));
        $places[] = [
            'id' => (int) $row['id'],
            'public_id' => (string) $row['public_id'],
            'name' => (string) $row['name'],
            'settlement_class' => $subtype,
            'settlement_label' => (string) ($properties['settlement_class_label'] ?? avesmapsWikiSyncLocationSubtypeLabel($subtype)),
            'description' => (string) ($properties['description'] ?? ''),
            'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
            'is_nodix' => !empty($properties['is_nodix']),
            'is_ruined' => !empty($properties['is_ruined']),
            'lat' => round((float) $coordinates[1], 3),
            'lng' => round((float) $coordinates[0], 3),
            'revision' => (int) ($row['revision'] ?? 0),
        ];
    }

    return $places;
}

function avesmapsWikiSyncFetchSearchMatches(PDO $pdo, array $names, array $settlementTitleSet): array {
    $candidateTitlesByName = [];
    foreach ($names as $name) {
        $data = avesmapsWikiSyncApiRequest([
            'action' => 'query',
            'list' => 'search',
            'srsearch' => $name,
            'srlimit' => (string) AVESMAPS_WIKI_SEARCH_RESULT_LIMIT,
        ]);

        foreach (($data['query']['search'] ?? []) as $result) {
            $title = (string) ($result['title'] ?? '');
            if ($title !== '' && isset($settlementTitleSet[$title]) && avesmapsWikiSyncTitleMatchesLocationName($name, $title)) {
                $candidateTitlesByName[$name][] = $title;
            }
        }
    }

    $candidateTitles = [];
    foreach ($candidateTitlesByName as $titles) {
        foreach ($titles as $title) {
            $candidateTitles[$title] = $title;
        }
    }
    $pagesByTitle = avesmapsWikiSyncFetchPagesByTitle($pdo, array_values($candidateTitles), true, false);

    $searchMatches = [];
    foreach ($candidateTitlesByName as $name => $titles) {
        foreach ($titles as $title) {
            if (isset($pagesByTitle[$title])) {
                $searchMatches[$name] = $title;
                break;
            }
        }
    }

    return $searchMatches;
}

function avesmapsWikiSyncFetchPagesByRequestedTitle(PDO $pdo, array $titles, bool $includeCategories, bool $includeContent): array {
    $pagesByRequestedTitle = [];
    if ($titles === []) {
        return $pagesByRequestedTitle;
    }

    foreach (array_chunk($titles, AVESMAPS_WIKI_TITLE_BATCH_SIZE) as $batch) {
        $propParts = [];
        if ($includeCategories) {
            $propParts[] = 'categories';
        }
        if ($includeContent) {
            $propParts[] = 'revisions';
        }

        $params = [
            'action' => 'query',
            'titles' => implode('|', $batch),
            'redirects' => '1',
        ];
        if ($propParts !== []) {
            $params['prop'] = implode('|', $propParts);
        }
        if ($includeCategories) {
            $params['cllimit'] = 'max';
        }
        if ($includeContent) {
            $params['rvprop'] = 'content';
            $params['rvslots'] = 'main';
        }

        $data = avesmapsWikiSyncApiRequest($params);
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
                avesmapsWikiSyncUpsertPageCache($pdo, $page, $includeContent);
                $pagesByRequestedTitle[$requestedTitle] = $page;
            }
        }
    }

    return $pagesByRequestedTitle;
}

function avesmapsWikiSyncFetchPagesByTitle(PDO $pdo, array $titles, bool $includeCategories, bool $includeContent): array {
    $pagesByRequestedTitle = avesmapsWikiSyncFetchPagesByRequestedTitle($pdo, $titles, $includeCategories, $includeContent);
    $pagesByTitle = [];
    foreach ($pagesByRequestedTitle as $page) {
        $pagesByTitle[(string) $page['title']] = $page;
    }

    return $pagesByTitle;
}

function avesmapsWikiSyncApiRequest(array $params): array {
    $queryParams = [
        'format' => 'json',
        'formatversion' => '2',
    ] + $params;
    $url = AVESMAPS_WIKI_API_URL . '?' . http_build_query($queryParams, '', '&', PHP_QUERY_RFC3986);
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS,
            'header' => "User-Agent: " . AVESMAPS_WIKI_USER_AGENT . "\r\nAccept: application/json\r\n",
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $rawResponse = @file_get_contents($url, false, $context);
    if (!is_string($rawResponse) || $rawResponse === '') {
        throw new RuntimeException('Wiki Aventurica konnte nicht gelesen werden.');
    }

    try {
        $data = json_decode($rawResponse, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('Wiki Aventurica hat ungueltiges JSON geliefert.');
    }

    if (!is_array($data)) {
        throw new RuntimeException('Wiki Aventurica hat keine gueltige Antwort geliefert.');
    }

    return $data;
}

function avesmapsWikiSyncBuildMatch(array $mapPlace, array $wikiPage, string $matchKind): array {
    return [
        'map' => avesmapsWikiSyncPublicMapPlace($mapPlace),
        'wiki' => avesmapsWikiSyncPublicWikiPage($wikiPage),
        'match_kind' => $matchKind,
    ];
}

function avesmapsWikiSyncPublicMapPlace(array $mapPlace): array {
    return [
        'id' => (int) ($mapPlace['id'] ?? 0),
        'public_id' => (string) ($mapPlace['public_id'] ?? ''),
        'name' => (string) ($mapPlace['name'] ?? ''),
        'settlement_class' => (string) ($mapPlace['settlement_class'] ?? 'dorf'),
        'settlement_label' => (string) ($mapPlace['settlement_label'] ?? 'Dorf'),
        'description' => (string) ($mapPlace['description'] ?? ''),
        'wiki_url' => (string) ($mapPlace['wiki_url'] ?? ''),
        'is_nodix' => !empty($mapPlace['is_nodix']),
        'is_ruined' => !empty($mapPlace['is_ruined']),
        'lat' => (float) ($mapPlace['lat'] ?? 0),
        'lng' => (float) ($mapPlace['lng'] ?? 0),
        'revision' => (int) ($mapPlace['revision'] ?? 0),
    ];
}

function avesmapsWikiSyncPublicWikiPage(array $page, ?array $coordinates = null): array {
    [$settlementClass, $settlementLabel] = avesmapsWikiSyncSettlementClassFromPage($page);
    $title = (string) ($page['title'] ?? '');
    $content = avesmapsWikiSyncReadPageContent($page);
    $coordinates ??= $content !== '' ? avesmapsWikiSyncExtractCoordinatesFromContent($content) : [
        'source' => 'none',
        'x' => null,
        'y' => null,
    ];

    return [
        'page_id' => isset($page['pageid']) ? (int) $page['pageid'] : null,
        'title' => $title,
        'url' => avesmapsWikiSyncPageUrl($title),
        'settlement_class' => $settlementClass,
        'settlement_label' => $settlementLabel,
        'categories' => avesmapsWikiSyncGetCategoryNames($page),
        'coordinates' => $coordinates,
        'content_hash' => $content !== '' ? hash('sha256', $content) : null,
    ];
}

function avesmapsWikiSyncUpsertPageCache(PDO $pdo, array $page, bool $includeContent): void {
    $title = (string) ($page['title'] ?? '');
    if ($title === '') {
        return;
    }

    [$settlementClass, $settlementLabel] = avesmapsWikiSyncSettlementClassFromPage($page);
    $content = $includeContent ? avesmapsWikiSyncReadPageContent($page) : '';
    $coordinates = $content !== '' ? avesmapsWikiSyncExtractCoordinatesFromContent($content) : [
        'source' => 'none',
        'x' => null,
        'y' => null,
    ];

    $statement = $pdo->prepare(
        'INSERT INTO wiki_sync_pages (
            wiki_page_id, title, normalized_key, wiki_url, settlement_class, settlement_label,
            categories_json, coordinates_json, content_hash, fetched_at
        ) VALUES (
            :wiki_page_id, :title, :normalized_key, :wiki_url, :settlement_class, :settlement_label,
            :categories_json, :coordinates_json, :content_hash, CURRENT_TIMESTAMP(3)
        )
        ON DUPLICATE KEY UPDATE
            wiki_page_id = VALUES(wiki_page_id),
            normalized_key = VALUES(normalized_key),
            wiki_url = VALUES(wiki_url),
            settlement_class = VALUES(settlement_class),
            settlement_label = VALUES(settlement_label),
            categories_json = VALUES(categories_json),
            coordinates_json = VALUES(coordinates_json),
            content_hash = VALUES(content_hash),
            fetched_at = VALUES(fetched_at)'
    );
    $statement->execute([
        'wiki_page_id' => isset($page['pageid']) ? (int) $page['pageid'] : null,
        'title' => $title,
        'normalized_key' => avesmapsWikiSyncCreateMatchKey($title),
        'wiki_url' => avesmapsWikiSyncPageUrl($title),
        'settlement_class' => $settlementClass,
        'settlement_label' => $settlementLabel,
        'categories_json' => avesmapsWikiSyncEncodeJson(avesmapsWikiSyncGetCategoryNames($page)),
        'coordinates_json' => avesmapsWikiSyncEncodeJson($coordinates),
        'content_hash' => $content !== '' ? hash('sha256', $content) : null,
    ]);
}

function avesmapsWikiSyncCreateUniqueTitleIndex(array $titles): array {
    $titlesByKey = [];
    foreach ($titles as $title) {
        $key = avesmapsWikiSyncCreateMatchKey($title);
        if ($key === '') {
            continue;
        }
        $titlesByKey[$key][] = $title;
    }

    $uniqueIndex = [];
    $ambiguousIndex = [];
    foreach ($titlesByKey as $key => $matchingTitles) {
        if (count($matchingTitles) === 1) {
            $uniqueIndex[$key] = $matchingTitles[0];
            continue;
        }

        natcasesort($matchingTitles);
        $ambiguousIndex[$key] = array_values($matchingTitles);
    }

    return [$uniqueIndex, $ambiguousIndex];
}

function avesmapsWikiSyncBuildProbableCandidates(string $name, array $ambiguousTitleIndex, array $fuzzyTitleKeys): array {
    $matchKey = avesmapsWikiSyncCreateMatchKey($name);
    $candidates = [];
    $seenTitles = [];

    foreach (($ambiguousTitleIndex[$matchKey] ?? []) as $title) {
        $candidates[] = [
            'title' => $title,
            'url' => avesmapsWikiSyncPageUrl($title),
            'reason' => 'ambiguous-normalized',
            'score' => 1.0,
        ];
        $seenTitles[$title] = true;
    }

    $scored = [];
    foreach ($fuzzyTitleKeys as $titleKey => $title) {
        if (isset($seenTitles[$title])) {
            continue;
        }

        similar_text($matchKey, (string) $titleKey, $percentage);
        $score = $percentage / 100;
        if ($score >= AVESMAPS_WIKI_FUZZY_CUTOFF) {
            $scored[] = [
                'title' => $title,
                'url' => avesmapsWikiSyncPageUrl($title),
                'reason' => 'fuzzy',
                'score' => round($score, 4),
            ];
        }
    }

    usort(
        $scored,
        static function (array $left, array $right): int {
            $scoreComparison = (float) $right['score'] <=> (float) $left['score'];

            if ($scoreComparison !== 0) {
                return $scoreComparison;
            }

            return strcasecmp((string) $left['title'], (string) $right['title']);
        }
    );

    return array_slice(array_merge($candidates, $scored), 0, 3);
}

function avesmapsWikiSyncExtractCoordinatesFromContent(string $content): array {
    if (preg_match('/\{\{DereGlobus-Link\|([^}]*)\}\}/su', $content, $dereglobusMatch) === 1) {
        $body = (string) ($dereglobusMatch[1] ?? '');
        $lonMatch = [];
        $latMatch = [];
        if (
            preg_match('/L\x{00E4}nge\(x\)\s*=\s*([-+]?\d+(?:\.\d+)?)/u', $body, $lonMatch) === 1
            && preg_match('/Breite\(y\)\s*=\s*([-+]?\d+(?:\.\d+)?)/u', $body, $latMatch) === 1
        ) {
            return [
                'source' => 'dereglobus',
                'x' => (float) $lonMatch[1],
                'y' => (float) $latMatch[1],
            ];
        }
    }

    if (preg_match('/Positionskarte\s*=\s*\{\{Positionskarte\|([^}]*)\}\}/su', $content, $positionskarteMatch) === 1) {
        $body = (string) ($positionskarteMatch[1] ?? '');
        $xMatch = [];
        $yMatch = [];
        if (
            preg_match('/\bX\s*=\s*([-+]?\d+(?:\.\d+)?)/u', $body, $xMatch) === 1
            && preg_match('/\bY\s*=\s*([-+]?\d+(?:\.\d+)?)/u', $body, $yMatch) === 1
        ) {
            return [
                'source' => 'positionskarte',
                'x' => (float) $xMatch[1],
                'y' => (float) $yMatch[1],
            ];
        }
    }

    return [
        'source' => 'none',
        'x' => null,
        'y' => null,
    ];
}

function avesmapsWikiSyncCoordinatesToMapLocation(array $coordinates): ?array {
    $source = (string) ($coordinates['source'] ?? 'none');
    $x = $coordinates['x'] ?? null;
    $y = $coordinates['y'] ?? null;
    if (!is_numeric($x) || !is_numeric($y)) {
        return null;
    }

    if ($source === 'dereglobus') {
        $lng = (float) $x * AVESMAPS_DEREGLOBUS_TO_MAP['x_lon']
            + (float) $y * AVESMAPS_DEREGLOBUS_TO_MAP['x_lat']
            + AVESMAPS_DEREGLOBUS_TO_MAP['x_offset'];
        $lat = (float) $x * AVESMAPS_DEREGLOBUS_TO_MAP['y_lon']
            + (float) $y * AVESMAPS_DEREGLOBUS_TO_MAP['y_lat']
            + AVESMAPS_DEREGLOBUS_TO_MAP['y_offset'];

        return avesmapsWikiSyncBuildConvertedMapLocation(
            'dereglobus',
            'DereGlobus',
            $lat,
            $lng,
            'high',
            [],
            ['lon' => (float) $x, 'lat' => (float) $y]
        );
    }

    if ($source === 'positionskarte') {
        $lng = (float) $x * AVESMAPS_POSITIONKARTE_TO_MAP['x_x']
            + (float) $y * AVESMAPS_POSITIONKARTE_TO_MAP['x_y']
            + AVESMAPS_POSITIONKARTE_TO_MAP['x_offset'];
        $lat = (float) $x * AVESMAPS_POSITIONKARTE_TO_MAP['y_x']
            + (float) $y * AVESMAPS_POSITIONKARTE_TO_MAP['y_y']
            + AVESMAPS_POSITIONKARTE_TO_MAP['y_offset'];

        return avesmapsWikiSyncBuildConvertedMapLocation(
            'positionskarte',
            'Positionskarte',
            $lat,
            $lng,
            'medium',
            ["Positionskarte ist gr\u{00F6}ber als DereGlobus und sollte manuell gepr\u{00FC}ft werden."],
            ['x' => (float) $x, 'y' => (float) $y]
        );
    }

    return null;
}

function avesmapsWikiSyncBuildConvertedMapLocation(
    string $source,
    string $sourceLabel,
    float $lat,
    float $lng,
    string $confidence,
    array $warnings,
    array $sourceCoordinates
): ?array {
    if ($lat < 0 || $lat > 1024 || $lng < 0 || $lng > 1024) {
        return null;
    }

    return [
        'source' => $source,
        'source_label' => $sourceLabel,
        'lat' => round($lat, 3),
        'lng' => round($lng, 3),
        'confidence' => $confidence,
        'warnings' => array_values($warnings),
        'source_coordinates' => $sourceCoordinates,
    ];
}

function avesmapsWikiSyncCreateMatchKey(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, false);
}

function avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, true);
}

function avesmapsWikiSyncCreateMatchKeyInternal(string $value, bool $preserveHistoricalSuffix): string {
    $value = $preserveHistoricalSuffix
        ? avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix($value)
        : avesmapsWikiSyncStripParentheticalSuffix($value);
    $value = mb_strtolower($value);
    $value = str_replace(["\u{00DF}", "\u{00E6}", "\u{0153}", "\u{00F8}", "\u{00F0}", "\u{00FE}"], ['ss', 'ae', 'oe', 'o', 'd', 'th'], $value);
    if (function_exists('iconv')) {
        $transliteratedValue = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (is_string($transliteratedValue)) {
            $value = $transliteratedValue;
        }
    }
    $value = preg_replace('/[\s_\-\'\x{2019}\x{02BC}`\x{00B4}]+/u', '', $value) ?? '';
    $value = preg_replace('/[^a-z0-9]+/u', '', $value) ?? '';

    return $value;
}

function avesmapsWikiSyncStripParentheticalSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, false);
}

function avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, true);
}

function avesmapsWikiSyncStripParentheticalSuffixInternal(string $title, bool $preserveHistoricalSuffix): string {
    $normalizedTitle = trim($title);
    if ($normalizedTitle === '') {
        return '';
    }

    if ($preserveHistoricalSuffix && avesmapsWikiSyncHasTrailingParentheticalSuffix($normalizedTitle)) {
        return $normalizedTitle;
    }

    return trim(preg_replace('/\s+\([^)]*\)\s*$/u', '', $normalizedTitle) ?? $normalizedTitle);
}

function avesmapsWikiSyncTitleMatchesLocationName(string $locationName, string $title): bool {
    if (str_contains($title, '/')) {
        return false;
    }

    return avesmapsWikiSyncCreateMatchKey($locationName) === avesmapsWikiSyncCreateMatchKey($title);
}

function avesmapsWikiSyncGetCategoryNames(array $page): array {
    $categories = [];
    foreach (($page['categories'] ?? []) as $category) {
        $title = (string) ($category['title'] ?? '');
        if ($title !== '') {
            $categories[] = str_starts_with($title, 'Kategorie:') ? substr($title, strlen('Kategorie:')) : $title;
        }
    }

    return $categories;
}

function avesmapsWikiSyncSettlementClassFromPage(array $page): array {
    foreach (avesmapsWikiSyncGetCategoryNames($page) as $categoryName) {
        $settlementClass = AVESMAPS_WIKI_CATEGORY_TO_CLASS[$categoryName] ?? null;
        if ($settlementClass !== null) {
            return [$settlementClass, avesmapsWikiSyncLocationSubtypeLabel($settlementClass)];
        }
    }

    return [null, null];
}

function avesmapsWikiSyncReadPageContent(array $page): string {
    $revisions = $page['revisions'] ?? [];
    if (!is_array($revisions) || !isset($revisions[0]) || !is_array($revisions[0])) {
        return '';
    }

    return (string) ($revisions[0]['slots']['main']['content'] ?? $revisions[0]['content'] ?? '');
}

function avesmapsWikiSyncPageUrl(string $title): string {
    return AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', $title)));
}

function avesmapsWikiSyncCoordinateSortValue(string $source): int {
    return match ($source) {
        'dereglobus' => 0,
        'positionskarte' => 1,
        default => 2,
    };
}

function avesmapsWikiSyncBuildSummary(PDO $pdo, int $runId): array {
    $summary = [
        'case_count' => 0,
        'visible_count' => 0,
        'by_type' => [],
        'by_status' => [],
    ];

    $statement = $pdo->prepare(
        'SELECT case_type, status, COUNT(*) AS case_count
        FROM wiki_sync_cases
        WHERE (last_seen_run_id = :run_id AND status IN (\'open\', \'deferred\'))
            OR status = \'archived\'
        GROUP BY case_type, status'
    );
    $statement->execute(['run_id' => $runId]);

    foreach ($statement->fetchAll() as $row) {
        $caseType = (string) $row['case_type'];
        $status = (string) $row['status'];
        $count = (int) $row['case_count'];
        $summary['case_count'] += $count;
        if (in_array($status, ['open', 'deferred'], true)) {
            $summary['visible_count'] += $count;
        }
        if (!isset($summary['by_type'][$caseType])) {
            $summary['by_type'][$caseType] = [
                'case_type' => $caseType,
                'label' => avesmapsWikiSyncCaseLabel($caseType),
                'count' => 0,
                'visible_count' => 0,
            ];
        }
        $summary['by_type'][$caseType]['count'] += $count;
        if (in_array($status, ['open', 'deferred'], true)) {
            $summary['by_type'][$caseType]['visible_count'] += $count;
        }
        $summary['by_status'][$status] = ($summary['by_status'][$status] ?? 0) + $count;
    }

    $summary['by_type'] = array_values($summary['by_type']);
    usort(
        $summary['by_type'],
        static fn(array $left, array $right): int => avesmapsWikiSyncCaseTypeOrder((string) $left['case_type']) <=> avesmapsWikiSyncCaseTypeOrder((string) $right['case_type'])
    );

    return $summary;
}

function avesmapsWikiSyncCaseTypeOrder(string $caseType): int {
    $order = array_flip(array_keys(AVESMAPS_WIKI_CASE_LABELS));
    return $order[$caseType] ?? 999;
}

function avesmapsWikiSyncCaseLabel(string $caseType): string {
    return AVESMAPS_WIKI_CASE_LABELS[$caseType] ?? $caseType;
}

function avesmapsWikiSyncFetchRunByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_runs WHERE public_id = :public_id LIMIT 1');
    $statement->execute(['public_id' => $publicId]);
    $run = $statement->fetch();
    if (!$run) {
        throw new InvalidArgumentException('Der WikiSync-Lauf wurde nicht gefunden.');
    }

    return $run;
}

function avesmapsWikiSyncFetchLatestCompletedRun(PDO $pdo): ?array {
    $statement = $pdo->query(
        "SELECT *
        FROM wiki_sync_runs
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT 1"
    );
    $run = $statement !== false ? $statement->fetch() : false;

    return $run ?: null;
}

function avesmapsWikiSyncFetchLatestActiveRun(PDO $pdo, string $syncType = AVESMAPS_WIKI_SYNC_TYPE_LOCATION): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM wiki_sync_runs
        WHERE sync_type = :sync_type
            AND status = :status
            AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ' . AVESMAPS_WIKI_LOCK_TTL_SECONDS . ' SECOND)
        ORDER BY updated_at DESC, id DESC
        LIMIT 1'
    );
    $statement->execute([
        'sync_type' => $syncType,
        'status' => 'running',
    ]);

    $run = $statement->fetch(PDO::FETCH_ASSOC);
    return is_array($run) ? $run : null;
}

function avesmapsWikiSyncPublicRun(array $run): array {
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    return [
        'id' => (string) $run['public_id'],
        'public_id' => (string) $run['public_id'],
        'status' => (string) $run['status'],
        'phase' => (string) $run['phase'],
        'progress_current' => (int) $run['progress_current'],
        'progress_total' => (int) $run['progress_total'],
        'message' => (string) ($run['message'] ?? ''),
        'created_at' => (string) $run['created_at'],
        'updated_at' => (string) $run['updated_at'],
        'completed_at' => (string) ($run['completed_at'] ?? ''),
        'stats' => [
            'settlement_title_count' => (int) ($stats['settlement_title_count'] ?? 0),
            'map_place_count' => (int) ($stats['map_place_count'] ?? 0),
            'matched_count' => (int) ($stats['matched_count'] ?? 0),
            'unresolved_count' => (int) ($stats['unresolved_count'] ?? 0),
            'missing_wiki_place_count' => (int) ($stats['missing_wiki_place_count'] ?? 0),
            'case_count' => (int) ($stats['case_count'] ?? 0),
            'political_territory_received' => (int) ($stats['political_territories']['received'] ?? 0),
            'political_territory_created' => (int) ($stats['political_territories']['territory_created'] ?? 0),
            'political_territory_updated' => (int) ($stats['political_territories']['wiki_updated'] ?? 0),
            'political_territory_geometry_seeded' => (int) ($stats['political_territories']['geometry_seeded'] ?? 0),
        ],
    ];
}

function avesmapsWikiSyncUpdateRun(PDO $pdo, int $runId, string $status, string $phase, int $progressCurrent, string $message, array $stats): void {
    $statement = $pdo->prepare(
        'UPDATE wiki_sync_runs
        SET status = :status,
            phase = :phase,
            progress_current = :progress_current,
            message = :message,
            stats_json = :stats_json
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $runId,
        'status' => $status,
        'phase' => $phase,
        'progress_current' => $progressCurrent,
        'message' => $message,
        'stats_json' => avesmapsWikiSyncEncodeJson($stats),
    ]);
}

function avesmapsWikiSyncFetchCase(PDO $pdo, int $caseId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_cases WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $caseId]);
    $case = $statement->fetch();
    if (!$case) {
        throw new InvalidArgumentException('Der WikiSync-Fall wurde nicht gefunden.');
    }

    return $case;
}

function avesmapsWikiSyncReadPublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die WikiSync-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsWikiSyncReadPositiveInt(mixed $value, string $fieldName): int {
    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false || $parsedValue < 1) {
        throw new InvalidArgumentException("{$fieldName} ist ungueltig.");
    }

    return (int) $parsedValue;
}

function avesmapsWikiSyncReadLocationName(mixed $value): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException('Der Ortsname fehlt.');
    }

    return $name;
}

function avesmapsWikiSyncReadLocationSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'dorf'), 60);
    if (!array_key_exists($subtype, AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    return $subtype;
}

function avesmapsWikiSyncReadSettlementClass(string $value): string {
    return array_key_exists($value, AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS) ? $value : 'dorf';
}

function avesmapsWikiSyncReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsWikiSyncLocationSubtypeLabel(string $subtype): string {
    return match ($subtype) {
        "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
        'metropole' => 'Metropole',
        "grossstadt" => "Gro\u{00DF}stadt",
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleinstadt',
        default => 'Dorf',
    };
}

function avesmapsWikiSyncNormalizeDuplicateLocationName(string $value): string {
    $normalizedValue = mb_strtolower($value);
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $normalizedValue) ?? '';
}

function avesmapsWikiSyncAssertUniqueLocationName(PDO $pdo, string $name, ?string $excludePublicId = null): void {
    $normalizedName = avesmapsWikiSyncNormalizeDuplicateLocationName($name);
    if ($normalizedName === '') {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT public_id, name
        FROM map_features
        WHERE feature_type = :feature_type
            AND is_active = 1'
        . ($excludePublicId !== null && $excludePublicId !== '' ? ' AND public_id <> :public_id' : '')
    );
    $params = [
        'feature_type' => 'location',
    ];
    if ($excludePublicId !== null && $excludePublicId !== '') {
        $params['public_id'] = $excludePublicId;
    }
    $statement->execute($params);

    foreach ($statement->fetchAll() as $row) {
        $existingName = (string) ($row['name'] ?? '');
        if ($existingName !== '' && avesmapsWikiSyncNormalizeDuplicateLocationName($existingName) === $normalizedName) {
            throw new InvalidArgumentException('Ein Ort mit diesem Namen existiert bereits.');
        }
    }
}

function avesmapsWikiSyncFetchEditablePointFeature(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, revision
        FROM map_features
        WHERE public_id = :public_id
            AND is_active = 1
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['public_id' => $publicId]);
    $feature = $statement->fetch();
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }
    if ((string) $feature['geometry_type'] !== 'Point') {
        throw new InvalidArgumentException('WikiSync kann nur Punkte bearbeiten.');
    }

    return $feature;
}

function avesmapsWikiSyncAssertFeatureCanBeEdited(PDO $pdo, array $payload, array $feature, array $user): void {
    $expectedRevision = $payload['expected_revision'] ?? null;
    if ($expectedRevision !== null && $expectedRevision !== '') {
        $parsedRevision = filter_var($expectedRevision, FILTER_VALIDATE_INT);
        if ($parsedRevision === false || $parsedRevision < 0) {
            throw new InvalidArgumentException('Die Feature-Revision ist ungueltig.');
        }
        if ((int) $parsedRevision !== (int) $feature['revision']) {
            throw new RuntimeException('Dieses Kartenobjekt wurde inzwischen geaendert. Bitte neu laden.');
        }
    }

    $statement = $pdo->prepare(
        'SELECT user_id, username
        FROM map_feature_locks
        WHERE public_id = :public_id
            AND locked_until > NOW(3)
        LIMIT 1'
    );
    $statement->execute(['public_id' => (string) $feature['public_id']]);
    $lock = $statement->fetch();
    if ($lock && (int) $lock['user_id'] !== (int) $user['id']) {
        throw new RuntimeException('Dieses Kartenobjekt wird gerade von ' . (string) $lock['username'] . ' bearbeitet.');
    }
}

function avesmapsWikiSyncEnsureMapFeatureLocksTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_feature_locks (
            public_id CHAR(36) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            username VARCHAR(120) NOT NULL,
            locked_until DATETIME(3) NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (public_id),
            KEY idx_map_feature_locks_locked_until (locked_until)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWikiSyncReadPointCoordinatesFromGeometry(array $geometry): array {
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates) || count($coordinates) < 2 || !is_numeric($coordinates[0]) || !is_numeric($coordinates[1])) {
        throw new RuntimeException('Die Point-Geometrie ist ungueltig.');
    }

    return [(float) $coordinates[0], (float) $coordinates[1]];
}

function avesmapsWikiSyncNextMapRevision(PDO $pdo): int {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Kartenrevision konnte nicht gelesen werden.');
    }

    return (int) $revision;
}

function avesmapsWikiSyncNextMapSortOrder(PDO $pdo): int {
    $statement = $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM map_features');
    $sortOrder = $statement !== false ? $statement->fetchColumn() : false;

    return $sortOrder === false ? 1 : (int) $sortOrder;
}

function avesmapsWikiSyncWriteMapAuditLog(PDO $pdo, int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): void {
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
        VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId ?: null,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);
}

function avesmapsWikiSyncBuildPointFeatureResponse(string $publicId, string $name, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    return [
        'public_id' => $publicId,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'location_type' => $subtype,
        'location_type_label' => avesmapsWikiSyncLocationSubtypeLabel($subtype),
        'description' => (string) ($properties['description'] ?? ''),
        'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
        'is_nodix' => !empty($properties['is_nodix']),
        'is_ruined' => !empty($properties['is_ruined']),
        'lat' => round($lat, 3),
        'lng' => round($lng, 3),
        'revision' => $revision,
    ];
}

function avesmapsWikiSyncDecodeJson(mixed $value): array {
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

function avesmapsWikiSyncEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsWikiSyncLogServerError(string $label, array $context): void {
    $payload = [
        'label' => $label,
        'context' => $context,
    ];

    try {
        error_log('Avesmaps WikiSync error: ' . avesmapsWikiSyncEncodeJson($payload));
    } catch (Throwable) {
        error_log('Avesmaps WikiSync error: ' . $label);
    }
}

function avesmapsWikiSyncUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsWikiSyncRelaxLimits(): void {
    if (function_exists('set_time_limit')) {
        @set_time_limit(300);
    }

    if (function_exists('ini_set')) {
        @ini_set('memory_limit', '512M');
    }
}
