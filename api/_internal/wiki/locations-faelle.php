<?php

declare(strict_types=1);

// The WikiSync location cases: listing the cases of the latest completed location run, setting a case
// status (open/deferred/archived), resolving a case onto the map, and the "Auf Wiki-Position setzen"
// move. Split out of locations.php, which requires this file at the point the block used to sit.

function avesmapsWikiSyncListCases(PDO $pdo): array {
    // Scope the "latest completed run" to LOCATION runs specifically. The settlement
    // conflict cases are keyed (first_seen_run_id/last_seen_run_id) to a location run
    // by avesmapsWikiDumpSettlementCaseRunId; an UNSCOPED lookup would, after
    // "Dump holen", resolve the newer dump_read run instead, and the
    // `WHERE last_seen_run_id = :run_id` filter below would then match 0 cases
    // (the accordion would show empty even though the cases exist). Scoping here
    // makes the reader's run match the writer's run.
    $run = avesmapsWikiSyncFetchLatestCompletedRun($pdo, AVESMAPS_WIKI_SYNC_TYPE_LOCATION);
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

/**
 * coordinate_drift resolution: "Auf Wiki-Position setzen".
 *
 * The ONLY new map write in the WikiDump rollout: it moves ONE location marker
 * (per-case, on the owner's explicit click) to the wiki position carried in the
 * case payload, then archives the case. It is a THIN wrapper -- NOT an extension
 * of avesmapsWikiSyncResolveCase (which is property-coupled to the resolve form):
 *
 *   1. Reuse avesmapsMovePointFeature (api/_internal/map/features.php) -- the SAME
 *      geometry-write path drag-to-move uses, so it carries the SAME 'edit'
 *      capability (already gated at the endpoint), the SAME map_feature_locks
 *      check AND the SAME expected_revision optimistic-concurrency guard (both
 *      enforced inside avesmapsAssertFeatureCanBeEdited). It begins+commits its
 *      OWN transaction and returns the updated feature.
 *   2. Archive the case with the SAME UPDATE wiki_sync_cases SET status='archived',
 *      reviewed_at/reviewed_by/resolution_json pattern resolve_case uses. This
 *      runs as a SEPARATE statement AFTER the move committed (no outer transaction
 *      wrapping both -- avesmapsMovePointFeature already committed its own).
 *
 * NEVER automatic, NEVER bulk: the frontend calls this once per case on an
 * explicit button click. The lat/lng are the wiki position in 0..1024 map units;
 * avesmapsMovePointFeature validates them (avesmapsParseMapCoordinate: 0..1024)
 * and writes GeoJSON [lng, lat] itself, so the caller passes lat/lng straight
 * through (same convention as drag-to-move).
 */
function avesmapsWikiSyncSetGeometryToWiki(PDO $pdo, array $payload, array $user): array {
    $caseId = avesmapsWikiSyncReadPositiveInt($payload['case_id'] ?? null, 'case_id');
    // Load the case up front so a bad/missing case_id fails before any map write.
    $case = avesmapsWikiSyncFetchCase($pdo, $caseId);
    if ((string) ($case['case_type'] ?? '') !== 'coordinate_drift') {
        throw new InvalidArgumentException('Diese Aktion ist nur fuer coordinate_drift-Faelle erlaubt.');
    }
    $casePayload = avesmapsWikiSyncDecodeJson($case['payload_json'] ?? null);

    // Reuse the drag-to-move helper verbatim: it reads public_id/lat/lng/
    // expected_revision from the payload, enforces the lock + revision guard, and
    // writes the geometry in its own transaction. The frontend supplies the wiki
    // position (payload.wiki_position) as lat/lng in map units.
    $feature = avesmapsMovePointFeature($pdo, $payload, $user);

    // Archive the resolved case (separate statement, AFTER the move committed).
    $resolution = [
        'resolved_at' => gmdate('c'),
        'resolved_by' => (string) ($user['username'] ?? ''),
        'resolution' => 'set_geometry_to_wiki',
        'feature' => $feature,
        'case_type' => 'coordinate_drift',
        'wiki_position' => is_array($casePayload['wiki_position'] ?? null) ? $casePayload['wiki_position'] : null,
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
