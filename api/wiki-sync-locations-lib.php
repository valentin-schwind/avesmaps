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

function avesmapsWikiSyncReadPageContent(array $page): string {
    $revisions = $page['revisions'] ?? [];
    if (!is_array($revisions) || !isset($revisions[0]) || !is_array($revisions[0])) {
        return '';
    }

    return (string) ($revisions[0]['slots']['main']['content'] ?? $revisions[0]['content'] ?? '');
}

function avesmapsWikiSyncCoordinateSortValue(string $source): int {
    return match ($source) {
        'dereglobus' => 0,
        'positionskarte' => 1,
        default => 2,
    };
}

function avesmapsWikiSyncReadLocationName(mixed $value): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException('Der Ortsname fehlt.');
    }

    return $name;
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
