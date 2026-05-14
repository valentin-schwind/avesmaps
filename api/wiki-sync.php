<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';

const AVESMAPS_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_WIKI_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_USER_AGENT = 'Avesmaps WikiSync/1.0';
const AVESMAPS_WIKI_TITLE_BATCH_SIZE = 50;
const AVESMAPS_WIKI_SEARCH_RESULT_LIMIT = 5;
const AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS = 30;
const AVESMAPS_WIKI_FUZZY_CUTOFF = 0.82;
const AVESMAPS_WIKI_SYNC_TYPE_LOCATION = 'location';
const AVESMAPS_WIKI_LOCK_TTL_SECONDS = 120;

const AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS = [
    'dorf' => 'Dorf',
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    'grossstadt' => 'GroÃŸstadt',
    'metropole' => 'Metropole',
];

const AVESMAPS_WIKI_CATEGORY_TO_CLASS = [
    'Dorf' => 'dorf',
    'Kleinstadt' => 'kleinstadt',
    'Stadt' => 'stadt',
    'MittelgroÃŸe Stadt' => 'stadt',
    'GroÃŸstadt' => 'grossstadt',
    'Metropole (SiedlungsgrÃ¶ÃŸe)' => 'metropole',
];

const AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS = [
    'dorf' => 'Dorf',
    'gebaeude' => 'Besondere Bauwerke/Stätten',
    'kleinstadt' => 'Kleinstadt',
    'stadt' => 'Stadt',
    'grossstadt' => 'Großstadt',
    'metropole' => 'Metropole',
];

const AVESMAPS_WIKI_CASE_LABELS = [
    'canonical_name_difference' => 'Abweichende Benennung',
    'type_conflict' => 'Typkonflikte',
    'probable_match' => 'Unaufgelöst, aber mit wahrscheinlichem Match',
    'unresolved_without_candidate' => 'Unaufgelöst, ohne Match',
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

    if ($requestMethod === 'GET') {
        avesmapsJsonResponse(200, avesmapsWikiSyncListCases($pdo));
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
        'start_run' => avesmapsWikiSyncStartRun($pdo, $user),
        'advance_run' => avesmapsWikiSyncAdvanceRun($pdo, $payload),
        'defer_case' => avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'deferred'),
        'archive_case' => avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'archived'),
        'reopen_case' => avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'open'),
        'resolve_case' => avesmapsWikiSyncResolveCase($pdo, $payload, avesmapsRequireUserWithCapability('edit')),
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
        avesmapsWikiSyncUpdateRun($pdo, (int) $run['id'], 'running', 'build_cases', 3, 'WikiSync-FÃ¤lle werden aufgebaut.', $stats);
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
            preg_match('/LÃ¤nge\(x\)\s*=\s*([-+]?\d+(?:\.\d+)?)/u', $body, $lonMatch) === 1
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
            ['Positionskarte ist grÃ¶ber als DereGlobus und sollte manuell geprÃ¼ft werden.'],
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
    $value = avesmapsWikiSyncStripParentheticalSuffix($value);
    $value = mb_strtolower($value);
    $value = str_replace(['ÃŸ', 'Ã¦', 'Å“', 'Ã¸', 'Ã°', 'Ã¾'], ['ss', 'ae', 'oe', 'o', 'd', 'th'], $value);
    if (function_exists('iconv')) {
        $transliteratedValue = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (is_string($transliteratedValue)) {
            $value = $transliteratedValue;
        }
    }
    $value = preg_replace('/[\s_\-\'â€™Ê¼`Â´]+/u', '', $value) ?? '';
    $value = preg_replace('/[^a-z0-9]+/u', '', $value) ?? '';

    return $value;
}

function avesmapsWikiSyncStripParentheticalSuffix(string $title): string {
    return trim(preg_replace('/\s+\([^)]*\)\s*$/u', '', $title) ?? $title);
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

    return (string) ($revisions[0]['slots']['main']['content'] ?? '');
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

function avesmapsWikiSyncFetchLatestActiveRun(PDO $pdo): ?array {
    $statement = $pdo->query(
        "SELECT *
        FROM wiki_sync_runs
        WHERE status = 'running'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1"
    );
    $run = $statement !== false ? $statement->fetch() : false;

    return $run ?: null;
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
        'gebaeude' => 'Besondere Bauwerke/Stätten',
        'metropole' => 'Metropole',
        'grossstadt' => 'Großstadt',
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
