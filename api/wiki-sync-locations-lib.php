<?php

declare(strict_types=1);

// Location-specific WikiSync helpers moved from wiki-sync.php

function avesmapsWikiSyncEnsureLocationTables(PDO $pdo): void {
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
