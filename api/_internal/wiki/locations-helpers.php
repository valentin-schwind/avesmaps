<?php

declare(strict_types=1);

// Location WikiSync support helpers: case labels/ordering, subtype/class helpers,
// map-feature plumbing (editable-point lookup, locks, revision/sort, audit log,
// feature response) and the restored sync helpers (page cache, category names,
// coordinate->map-location conversion, case upsert, duplicate detection). Split out
// of locations.php (M5 god-file split). Required by locations.php; consts and sibling
// helpers resolve at call time.

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

// Voller Feature-Snapshot (VOR der Änderung holen) für Verlauf/Undo.
function avesmapsWikiSyncFetchAuditRow(PDO $pdo, int $featureId): array {
    $stmt = $pdo->prepare('SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, is_active, revision, min_x, min_y, max_x, max_y FROM map_features WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $featureId]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
}

// Schreibt einen Verlaufs-/Undo-Eintrag (wiki_sync_update_point) für eine properties_json-Änderung
// eines Features. Stellt beim „Rückgängig" name/feature_subtype/properties_json wieder her.
function avesmapsWikiSyncAuditFeaturePropsChange(PDO $pdo, array $beforeRow, array $newProps, int $revision, int $userId): void {
    if (empty($beforeRow['id'])) {
        return;
    }
    avesmapsWikiSyncWriteMapAuditLog(
        $pdo,
        (int) $beforeRow['id'],
        'wiki_sync_update_point',
        $userId,
        avesmapsWikiSyncEncodeJson($beforeRow),
        avesmapsWikiSyncEncodeJson([
            'public_id' => (string) ($beforeRow['public_id'] ?? ''),
            'feature_type' => (string) ($beforeRow['feature_type'] ?? 'label'),
            'name' => (string) ($beforeRow['name'] ?? ''),
            'feature_subtype' => (string) ($beforeRow['feature_subtype'] ?? ''),
            'properties_json' => $newProps,
            'revision' => $revision,
        ])
    );
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

// ===== WIEDERHERGESTELLT: Sync-Helfer, die beim Refactor verloren gingen =====
// Diese Funktionen wurden beim Verschieben (Commits a6f7683c/322c61b2 -> .txt -> e0faab02
// 'removed move') aus dem geladenen Code entfernt, obwohl locations.php sie weiter aufruft.
// Der Siedlungs-Sync war seither defekt. Quelle der letzten intakten Version: bcccf031:api/wiki-sync.php.

function avesmapsWikiSyncFetchPagesByTitle(PDO $pdo, array $titles, bool $includeCategories, bool $includeContent): array {
    $pagesByRequestedTitle = avesmapsWikiSyncFetchPagesByRequestedTitle($pdo, $titles, $includeCategories, $includeContent);
    $pagesByTitle = [];
    foreach ($pagesByRequestedTitle as $page) {
        $pagesByTitle[(string) $page['title']] = $page;
    }

    return $pagesByTitle;
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

function avesmapsWikiSyncSettlementClassFromPage(array $page): array {
    foreach (avesmapsWikiSyncGetCategoryNames($page) as $categoryName) {
        $settlementClass = AVESMAPS_WIKI_CATEGORY_TO_CLASS[$categoryName] ?? null;
        if ($settlementClass !== null) {
            return [$settlementClass, avesmapsWikiSyncLocationSubtypeLabel($settlementClass)];
        }
    }

    return [null, null];
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
