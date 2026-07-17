<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
// Kartensammlung suggestion (Spec §3.8): approving a 'karte' report creates the map right here. Same
// three libraries api/edit/map/citymaps.php pulls in for the identical job -- avesmapsUuidV4() lives in
// the map-features lib, the place resolver in adventure-resolve, and the write logic itself in the
// citymap library (which also brings feature-sources, used below to link the reported sources).
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/app/adventure-resolve.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Meldungen nicht pruefen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'GET') {
        avesmapsJsonResponse(200, avesmapsListLocationReportsForReview($pdo));
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind fuer diesen Endpoint erlaubt.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $response = match ($action) {
        'update_status' => avesmapsUpdateLocationReportReviewStatus($pdo, $payload, $user),
        'create_citymap' => avesmapsCreateCitymapFromReport($pdo, $payload, $user),
        // Fundorte an eine BESTEHENDE Karte haengen -- der einzige Melde-Weg, der nichts anlegt.
        'add_citymap_links' => avesmapsAddCitymapLinksFromReport($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Review-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Meldungen konnten nicht verarbeitet werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Meldungen konnten nicht verarbeitet werden.');
}

function avesmapsListLocationReportsForReview(PDO $pdo): array {
    avesmapsEnsureMapReportsTableForReview($pdo);

    $reports = [];
    $mapStatement = $pdo->prepare(
        'SELECT
            id,
            created_at,
            status,
            report_type,
            report_subtype,
            report_mode,
            entity_type,
            entity_public_id,
            name,
            reporter_name,
            lat,
            lng,
            source,
            sources_json,
            payload_json,
            wiki_url,
            comment,
            page_url,
            client_version,
            review_note
        FROM map_reports
        WHERE status = :status
        ORDER BY created_at ASC, id ASC'
    );
    $mapStatement->execute([
        'status' => 'neu',
    ]);

    foreach ($mapStatement->fetchAll() as $report) {
        $report['report_source'] = 'map_reports';
        $report['size'] = $report['report_type'] === 'location' ? $report['report_subtype'] : '';
        // Multi-source #3: expose the source list (array) to the client; drop the raw JSON column.
        $report['sources'] = avesmapsDecodeReportSources($report['sources_json'] ?? null, (string) ($report['source'] ?? ''));
        unset($report['sources_json']);
        // Kartensammlung suggestion (§3.8): hand the review UI the decoded map so it can show WHAT is being
        // proposed. Decoded, not re-normalized -- the whitelist ran on the way in; re-running it here would
        // turn a payload written under older rules into a silent 500 in the middle of the report list.
        $report['citymap'] = ($report['report_type'] ?? '') === 'citymap'
            ? (json_decode((string) ($report['payload_json'] ?? ''), true) ?: null)
            : null;
        unset($report['payload_json']);
        $reports[] = $report;
    }

    if (avesmapsReviewTableExists($pdo, 'location_reports')) {
        $statement = $pdo->prepare(
            'SELECT
                id,
                created_at,
                status,
                name,
                size,
                lat,
                lng,
                source,
                wiki_url,
                comment,
                page_url,
                client_version,
                review_note
            FROM location_reports
            WHERE status = :status
            ORDER BY created_at ASC, id ASC'
        );
        $statement->execute([
            'status' => 'neu',
        ]);

        foreach ($statement->fetchAll() as $report) {
            $report['report_source'] = 'location_reports';
            $report['report_type'] = 'location';
            $report['report_subtype'] = (string) ($report['size'] ?? 'dorf');
            $report['sources'] = avesmapsDecodeReportSources(null, (string) ($report['source'] ?? ''));
            $reports[] = $report;
        }
    }

    usort(
        $reports,
        static fn(array $left, array $right): int => [$left['created_at'] ?? '', (int) ($left['id'] ?? 0)] <=> [$right['created_at'] ?? '', (int) ($right['id'] ?? 0)]
    );

    return [
        'ok' => true,
        'reports' => $reports,
    ];
}

function avesmapsUpdateLocationReportReviewStatus(PDO $pdo, array $payload, array $user): array {
    $reportId = filter_var($payload['report_id'] ?? null, FILTER_VALIDATE_INT);
    $reportSource = avesmapsNormalizeSingleLine((string) ($payload['report_source'] ?? 'location_reports'), 40);
    $newStatus = avesmapsNormalizeSingleLine((string) ($payload['status'] ?? ''), 20);
    $reviewNote = avesmapsNormalizeReviewNote($payload['review_note'] ?? null);

    if ($reportId === false || $reportId <= 0) {
        throw new InvalidArgumentException('Es wurde keine gueltige report_id uebergeben.');
    }

    if (!in_array($newStatus, ['approved', 'rejected', 'in_review'], true)) {
        throw new InvalidArgumentException('Der Review-Status ist ungueltig.');
    }

    if (!in_array($reportSource, ['location_reports', 'map_reports'], true)) {
        throw new InvalidArgumentException('Die Meldungsquelle ist ungueltig.');
    }

    if ($reportSource === 'map_reports') {
        avesmapsEnsureMapReportsTableForReview($pdo);
    }

    $reviewedBySql = $reportSource === 'map_reports' ? ', reviewed_by = :reviewed_by' : '';
    $statement = $pdo->prepare(
        "UPDATE {$reportSource}
        SET
            status = :status,
            review_note = :review_note,
            reviewed_at = CURRENT_TIMESTAMP
            {$reviewedBySql}
        WHERE id = :report_id
            AND status = 'neu'"
    );
    $params = [
        'status' => $newStatus,
        'review_note' => $reviewNote,
        'report_id' => $reportId,
    ];
    if ($reportSource === 'map_reports') {
        $params['reviewed_by'] = (int) ($user['id'] ?? 0) ?: null;
    }
    $statement->execute($params);

    if ($statement->rowCount() < 1) {
        avesmapsErrorResponse(404, 'not_found', 'Die gewuenschte Meldung wurde bereits verarbeitet oder nicht gefunden.');
    }

    return [
        'ok' => true,
        'message' => 'Die Meldung wurde aktualisiert.',
        'reviewed_by' => $user['username'] ?? '',
    ];
}

// Spec §3.8: approving a 'karte' report is what CREATES the map. This does NOT follow the location flow
// (prefill the editor -> the editor's own save creates -> report approved, review-editor-submit.js:93):
// the citymap editor is a self-contained iframe page, not an in-page form, so there is no form to prefill.
//
// Server-side and in one call is also the only place two invariants can be GUARANTEED rather than
// requested. Had the client driven the citymap editor's normal save instead, that path would write
// origin='manual' and whatever licence its form held -- turning a stranger's claim into a published image.
// Here the licence is simply never written: avesmapsNormalizeCitymapReportPayload never returns one, so
// the INSERT never names the column and the NOT NULL DEFAULT 'unknown_other' stands (Spec §3.3).
//
// Not transactional, deliberately: the pieces after the citymap (types, place, sources) are additive, and
// a half-linked map that an editor finishes by hand is a far better failure than a rejected approval whose
// report has already been consumed. The report is only marked approved once the map exists.
function avesmapsCreateCitymapFromReport(PDO $pdo, array $payload, array $user): array {
    // The endpoint gate is `review`, which a reviewer holds and which does NOT include `edit`
    // (auth.php:81 -- edit = admin|editor, review = admin|editor|reviewer). Creating a citymap is an edit.
    // Approving a location report is already effectively edit-gated for the same reason: its "Anlegen"
    // goes through api/edit/map/*, which a pure reviewer cannot call. Without this check, routing the
    // citymap write through the reports endpoint would hand reviewers a write they do not otherwise have.
    if (!avesmapsUserCan($user, 'edit')) {
        avesmapsErrorResponse(403, 'forbidden', 'Zum Anlegen einer Karte fehlt dir die Berechtigung.');
    }

    $reportId = filter_var($payload['report_id'] ?? null, FILTER_VALIDATE_INT);
    if ($reportId === false || $reportId <= 0) {
        throw new InvalidArgumentException('Es wurde keine gueltige report_id uebergeben.');
    }

    avesmapsEnsureMapReportsTableForReview($pdo);
    $statement = $pdo->prepare(
        "SELECT id, name, payload_json, sources_json, source
         FROM map_reports
         WHERE id = :id AND status = 'neu' AND report_type = 'citymap'
         LIMIT 1"
    );
    $statement->execute(['id' => $reportId]);
    $report = $statement->fetch();
    if ($report === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Kartenmeldung wurde bereits verarbeitet oder nicht gefunden.');
    }

    // Re-run the whitelist on the way OUT, not just on the way in. The row has sat in a table since it was
    // written, and this is the last point before the values become a public citymap -- so the licence rule
    // holds even for a payload some future/older writer stored more loosely than today's endpoint would.
    // Before the claim below, so a payload we cannot use fails with a 400 and leaves the report untouched.
    $normalized = avesmapsNormalizeCitymapReportPayload(json_decode((string) ($report['payload_json'] ?? ''), true));

    $userId = (int) ($user['id'] ?? 0);
    // CLAIM FIRST, create second. Two reviewers double-clicking would otherwise both pass the SELECT above
    // and each create a map, leaving a silent duplicate for someone to find later; this way the loser's
    // UPDATE matches no row and it creates nothing. The inverse risk -- a crash between claim and create,
    // spending the report without producing a map -- is the better one: it is loud (the reviewer sees the
    // error) and recoverable (the row keeps its payload_json). A transaction is not an option here:
    // avesmapsUpsertCitymap runs CREATE TABLE IF NOT EXISTS, and DDL implicitly commits in MySQL.
    $claim = $pdo->prepare(
        "UPDATE map_reports
         SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = :reviewed_by
         WHERE id = :report_id AND status = 'neu'"
    );
    $claim->execute([
        'reviewed_by' => $userId ?: null,
        'report_id' => $reportId,
    ]);
    if ($claim->rowCount() < 1) {
        avesmapsErrorResponse(409, 'conflict', 'Die Kartenmeldung wurde soeben von jemand anderem verarbeitet.');
    }

    $created = avesmapsUpsertCitymap($pdo, $normalized['citymap'], $userId, 'community');
    $citymapPublicId = (string) $created['public_id'];

    if ($normalized['types'] !== []) {
        avesmapsSetCitymapTypes($pdo, $citymapPublicId, $normalized['types']);
    }
    if ($normalized['place'] !== []) {
        // 'community' wie die Karte selbst: der Ort kommt aus derselben Meldung. Der Editor zeigt die
        // Provenienz je Ort an -- 'manual' hiesse, die Zuordnung sei von uns.
        avesmapsAddCitymapPlace($pdo, $citymapPublicId, $normalized['place'], 'community');
    }

    // Multi-source #3, exactly as the location approval does it (review-editor-submit.js:71): every
    // reported source WITH a link becomes a real feature_source on the new map, deduped against the shared
    // catalogue by url_hash. A link-less source cannot be one -- it survives as the report's own `source`
    // label, which the review list shows, and an editor can type it in.
    $linkedSources = 0;
    foreach (avesmapsDecodeReportSources($report['sources_json'] ?? null, (string) ($report['source'] ?? '')) as $source) {
        if (($source['url'] ?? '') === '' || ($source['label'] ?? '') === '') {
            continue;
        }
        avesmapsAddFeatureSource(
            $pdo,
            'citymap',
            $citymapPublicId,
            (string) $source['url'],
            (string) $source['label'],
            (string) ($source['type'] ?? 'sonstiges'),
            (bool) ($source['official'] ?? false),
            $userId,
            (string) ($source['pages'] ?? ''),
            (string) ($source['reference_kind'] ?? '')
        );
        $linkedSources++;
    }

    return [
        'ok' => true,
        'message' => 'Die Karte wurde angelegt.',
        'public_id' => $citymapPublicId,
        'linked_sources' => $linkedSources,
        'reviewed_by' => $user['username'] ?? '',
    ];
}

// Approving a 'citymap_link' report: hang the reported fundorte onto an EXISTING map
// (Spec 2026-07-17-community-fundorte §3.3). Sibling of avesmapsCreateCitymapFromReport above, and it
// borrows every rule from it -- the edit gate, the claim-first order, the re-run of the allowlist on the
// way out. Only the write differs: it adds instead of creating.
function avesmapsAddCitymapLinksFromReport(PDO $pdo, array $payload, array $user): array {
    // Gate `edit`, not `review`: writing a link onto a PUBLIC map is an edit, and this endpoint is only
    // review-gated. Same reasoning, verbatim, as the citymap creator -- without it, routing the write
    // through the reports endpoint would hand reviewers a write they do not otherwise hold.
    if (!avesmapsUserCan($user, 'edit')) {
        avesmapsErrorResponse(403, 'forbidden', 'Zum Ergaenzen einer Karte fehlt dir die Berechtigung.');
    }

    $reportId = filter_var($payload['report_id'] ?? null, FILTER_VALIDATE_INT);
    if ($reportId === false || $reportId <= 0) {
        throw new InvalidArgumentException('Es wurde keine gueltige report_id uebergeben.');
    }

    avesmapsEnsureMapReportsTableForReview($pdo);
    $statement = $pdo->prepare(
        "SELECT id, name, payload_json
         FROM map_reports
         WHERE id = :id AND status = 'neu' AND report_type = 'citymap_link'
         LIMIT 1"
    );
    $statement->execute(['id' => $reportId]);
    $report = $statement->fetch();
    if ($report === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Fundort-Meldung wurde bereits verarbeitet oder nicht gefunden.');
    }

    // The allowlist runs again on the way OUT, not just on the way in: the row has sat in a table since it
    // was written, and this is the last point before its values become public. Before the claim, so a
    // payload we cannot use fails with a 400 and leaves the report untouched.
    $normalized = avesmapsNormalizeCitymapLinkReportPayload(json_decode((string) ($report['payload_json'] ?? ''), true));

    // Does the map still exist? A 404 here beats a claimed report whose links went nowhere -- the map may
    // have been deleted or hidden between the report and this click.
    $citymapPublicId = $normalized['citymap_public_id'];
    $find = $pdo->prepare("SELECT id FROM citymap WHERE public_id = :pid AND status = 'approved' LIMIT 1");
    $find->execute(['pid' => $citymapPublicId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Karte zu dieser Meldung gibt es nicht mehr.');
    }

    // CLAIM FIRST, write second -- same trade as the citymap creator: two reviewers double-clicking would
    // otherwise both pass the SELECT and each append the same links, leaving silent duplicates. The loser's
    // UPDATE matches no row and writes nothing.
    $userId = (int) ($user['id'] ?? 0);
    $claim = $pdo->prepare(
        "UPDATE map_reports
         SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = :reviewed_by
         WHERE id = :report_id AND status = 'neu'"
    );
    $claim->execute(['reviewed_by' => $userId ?: null, 'report_id' => $reportId]);
    if ($claim->rowCount() < 1) {
        avesmapsErrorResponse(409, 'conflict', 'Die Fundort-Meldung wurde soeben von jemand anderem verarbeitet.');
    }

    // ADDITIVE, one row at a time. avesmapsSetCitymapLinks is off limits here: it REPLACES the list and
    // would delete every fundort an editor had entered -- a data loss nobody notices until someone misses
    // their links. 'community' is stamped HERE; the reporter never had a say in it (the allowlist does not
    // even read an origin).
    $added = 0;
    foreach ($normalized['links'] as $link) {
        avesmapsAddCitymapLink($pdo, $citymapPublicId, $link, 'community');
        $added++;
    }

    return [
        'ok' => true,
        'message' => $added === 1 ? 'Der Fundort wurde ergaenzt.' : 'Die Fundorte wurden ergaenzt.',
        'public_id' => $citymapPublicId,
        'added_links' => $added,
        'reviewed_by' => $user['username'] ?? '',
    ];
}

function avesmapsEnsureMapReportsTableForReview(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_reports (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            status VARCHAR(20) NOT NULL DEFAULT 'neu',
            report_type VARCHAR(40) NOT NULL,
            report_subtype VARCHAR(60) NOT NULL,
            name VARCHAR(160) NOT NULL,
            reporter_name VARCHAR(80) NULL,
            lat DECIMAL(10, 4) NOT NULL,
            lng DECIMAL(10, 4) NOT NULL,
            source VARCHAR(200) NOT NULL,
            wiki_url VARCHAR(300) NULL,
            comment TEXT NULL,
            page_url VARCHAR(500) NULL,
            client_version VARCHAR(80) NULL,
            review_note TEXT NULL,
            request_origin VARCHAR(255) NULL,
            remote_ip VARCHAR(64) NULL,
            ip_hash CHAR(64) NULL,
            user_agent VARCHAR(500) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            reviewed_at DATETIME(3) NULL,
            reviewed_by BIGINT UNSIGNED NULL,
            PRIMARY KEY (id),
            KEY idx_map_reports_status_created_at (status, created_at),
            KEY idx_map_reports_type_status (report_type, report_subtype, status),
            KEY idx_map_reports_ip_hash_created_at (ip_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    // Ensure optional columns exist so the review SELECT can read them even before the first new-schema
    // report is submitted (report-location.php adds them too; this is the defensive read-side gate).
    foreach ([
        'sources_json'     => 'TEXT NULL',
        'payload_json'     => 'TEXT NULL',
        'report_mode'      => "VARCHAR(16) NOT NULL DEFAULT 'new' AFTER report_subtype",
        'entity_type'      => 'VARCHAR(20) NULL AFTER report_mode',
        'entity_public_id' => 'VARCHAR(80) NULL AFTER entity_type',
    ] as $column => $definition) {
        $quotedColumn = $pdo->quote($column);
        $columnStatement = $pdo->query("SHOW COLUMNS FROM map_reports LIKE {$quotedColumn}");
        if ($columnStatement !== false && $columnStatement->fetch() !== false) {
            continue;
        }
        $pdo->exec("ALTER TABLE map_reports ADD COLUMN {$column} {$definition}");
    }
}

function avesmapsReviewTableExists(PDO $pdo, string $tableName): bool {
    $quotedTableName = $pdo->quote($tableName);
    $statement = $pdo->query("SHOW TABLES LIKE {$quotedTableName}");
    return $statement !== false && $statement->fetch() !== false;
}

function avesmapsNormalizeReviewNote(mixed $value): ?string {
    $normalizedValue = avesmapsNormalizeSingleLine((string) ($value ?? ''), 500);
    return $normalizedValue !== '' ? $normalizedValue : null;
}

// Multi-source #3: decode the stored source list into a clean array for the client. Falls back to a
// single label-only source from the legacy `source` column when there is no JSON (old reports), so the
// review UI + "Anlegen" behave uniformly across schema versions.
function avesmapsDecodeReportSources(mixed $rawJson, string $legacyLabel = ''): array {
    $decoded = is_string($rawJson) && $rawJson !== '' ? json_decode($rawJson, true) : null;
    $list = [];
    if (is_array($decoded)) {
        foreach ($decoded as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $label = trim((string) ($entry['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $list[] = [
                'url' => (string) ($entry['url'] ?? ''),
                'label' => $label,
                'pages' => (string) ($entry['pages'] ?? ''),
                'type' => (string) ($entry['type'] ?? 'sonstiges'),
                'reference_kind' => (string) ($entry['reference_kind'] ?? ''),
                'official' => (bool) ($entry['official'] ?? false),
            ];
        }
    }
    if ($list === [] && trim($legacyLabel) !== '') {
        $list[] = ['url' => '', 'label' => trim($legacyLabel), 'pages' => '', 'type' => 'sonstiges', 'official' => false];
    }
    return $list;
}
