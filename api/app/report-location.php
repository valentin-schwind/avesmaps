<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/app/report-context.php';
// Kartensammlung community suggestion (Spec §3.8): the citymap vocabulary (arts, type keys, tri-bools,
// URL rules) and the payload whitelist live in the citymap library, so this endpoint validates a proposed
// map against THE SAME definitions the editor writes through -- rather than growing a second, drifting
// copy of them here. Pure function definitions + consts; nothing runs on require.
require __DIR__ . '/../_internal/app/citymaps.php';

const AVESMAPS_REPORT_TYPES = [
    'location' => ['type' => 'location', 'subtype' => 'dorf'],
    'gebaeude' => ['type' => 'location', 'subtype' => 'gebaeude'],
    'fluss' => ['type' => 'label', 'subtype' => 'fluss'],
    'meer' => ['type' => 'label', 'subtype' => 'meer'],
    'see' => ['type' => 'label', 'subtype' => 'see'],
    'region' => ['type' => 'label', 'subtype' => 'region'],
    'insel' => ['type' => 'label', 'subtype' => 'insel'],
    'gebirge' => ['type' => 'label', 'subtype' => 'gebirge'],
    'berggipfel' => ['type' => 'label', 'subtype' => 'berggipfel'],
    'wald' => ['type' => 'label', 'subtype' => 'wald'],
    'steppe' => ['type' => 'label', 'subtype' => 'steppe'],
    'graslandschaft' => ['type' => 'label', 'subtype' => 'graslandschaft'],
    'auenlandschaft' => ['type' => 'label', 'subtype' => 'auenlandschaft'],
    'ebene' => ['type' => 'label', 'subtype' => 'ebene'],
    'huegelland' => ['type' => 'label', 'subtype' => 'huegelland'],
    'tundra' => ['type' => 'label', 'subtype' => 'tundra'],
    'kueste' => ['type' => 'label', 'subtype' => 'kueste'],
    'wueste' => ['type' => 'label', 'subtype' => 'wueste'],
    'suempfe_moore' => ['type' => 'label', 'subtype' => 'suempfe_moore'],
    'comment' => ['type' => 'comment', 'subtype' => 'comment'],
    'sonstiges' => ['type' => 'label', 'subtype' => 'sonstiges'],
    'weg' => ['type' => 'path', 'subtype' => 'weg'],
    'territorium' => ['type' => 'territory', 'subtype' => 'territorium'],
    // Kartensammlung suggestion (Spec §3.8). Unlike every entry above it, this one does not propose a
    // map_features row: report_type 'citymap' is what routes the review "Anlegen" to the citymap creator
    // instead of the location/label editors -- see the dispatch in js/routing/routing.js.
    'karte' => ['type' => 'citymap', 'subtype' => 'karte'],
    // Ein weiterer FUNDORT zu einer BESTEHENDEN Karte (Spec 2026-07-17-community-fundorte). Der einzige
    // Meldetyp, der nichts anlegen will, sondern etwas an einer Karte ergaenzt -- das Ziel reist als
    // citymap_public_id im Payload, und die Freigabe haengt die Fundorte additiv an.
    'fundort' => ['type' => 'citymap_link', 'subtype' => 'fundort'],
];
const AVESMAPS_LOCATION_SUBTYPES = ['dorf', 'gebaeude', 'kleinstadt', 'stadt', 'grossstadt', 'metropole'];
const AVESMAPS_REPORT_MAP_MAX_COORDINATE = 1024.0;
const AVESMAPS_REPORT_SPAM_WORDS = ['casino', 'crypto', 'viagra', 'loan', 'betting', 'porn', 'seo'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Meldungen senden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST-Anfragen sind fuer Meldungen erlaubt.');
    }

    $requestPayload = avesmapsReadJsonRequest();
    $mapReport = avesmapsValidateMapReport($requestPayload);
    if ($mapReport['is_spam'] === true) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'message' => 'Karteneintrag wurde gemeldet.',
        ]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapReportsTable($pdo);
    if ($mapReport['report_type'] === 'location' && $mapReport['report_mode'] !== 'change' && avesmapsLocationNameExists($pdo, $mapReport['name'])) {
        avesmapsErrorResponse(409, 'conflict', 'Ein Ort mit diesem Namen existiert bereits oder wurde bereits gemeldet.');
    }
    // Change reports come from the in-app editor flow on a KNOWN element (entity_public_id) and go to
    // editor review -> exempt them from the new-location rate limit (an active contributor legitimately
    // files several in a row; honeypot + spam-word checks still apply).
    if ($mapReport['report_mode'] !== 'change' && avesmapsReportRateLimitExceeded($pdo, avesmapsBuildPrivacyIpHash($config))) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'message' => 'Karteneintrag wurde gemeldet.',
        ]);
    }
    if ($mapReport['report_mode'] !== 'change' && avesmapsIsNearDuplicateReport($pdo, $mapReport)) {
        $mapReport['review_note'] = 'Moegliches Duplikat.';
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO map_reports (
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
            review_note,
            request_origin,
            remote_ip,
            ip_hash,
            user_agent
        ) VALUES (
            :status,
            :report_type,
            :report_subtype,
            :report_mode,
            :entity_type,
            :entity_public_id,
            :name,
            :reporter_name,
            :lat,
            :lng,
            :source,
            :sources_json,
            :payload_json,
            :wiki_url,
            :comment,
            :page_url,
            :client_version,
            :review_note,
            :request_origin,
            :remote_ip,
            :ip_hash,
            :user_agent
        )'
    );

    $ipHash = avesmapsBuildPrivacyIpHash($config);
    $insertStatement->execute([
        'status' => 'neu',
        'report_type' => $mapReport['report_type'],
        'report_subtype' => $mapReport['report_subtype'],
        'report_mode' => $mapReport['report_mode'],
        'entity_type' => $mapReport['entity_type'],
        'entity_public_id' => $mapReport['entity_public_id'],
        'name' => $mapReport['name'],
        'reporter_name' => $mapReport['reporter_name'],
        'lat' => $mapReport['lat'],
        'lng' => $mapReport['lng'],
        'source' => $mapReport['source'],
        'sources_json' => json_encode($mapReport['sources'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'payload_json' => $mapReport['payload_json'] ?? null,
        'wiki_url' => $mapReport['wiki_url'],
        'comment' => $mapReport['comment'],
        'page_url' => $mapReport['page_url'],
        'client_version' => $mapReport['client_version'],
        'review_note' => $mapReport['review_note'] ?? '',
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => '',
        'ip_hash' => $ipHash,
        'user_agent' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);

    avesmapsJsonResponse(201, [
        'ok' => true,
        'message' => 'Karteneintrag wurde gemeldet.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsLogLocationReportServerError('database_error', [
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'sqlstate' => (string) ($exception->errorInfo[0] ?? ''),
        'driver_code' => (string) ($exception->errorInfo[1] ?? ''),
        'driver_message' => (string) ($exception->errorInfo[2] ?? ''),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsErrorResponse(500, 'server_error', avesmapsBuildDatabaseErrorMessage($exception));
} catch (RuntimeException $exception) {
    avesmapsLogLocationReportServerError('runtime_error', [
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsLogLocationReportServerError('unexpected_error', [
        'exception_class' => $exception::class,
        'exception_code' => (string) $exception->getCode(),
        'exception_message' => $exception->getMessage(),
        'request_origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'remote_ip' => avesmapsClientIpAddress(),
    ]);

    avesmapsErrorResponse(500, 'server_error', 'Die Meldung konnte nicht verarbeitet werden.');
}

function avesmapsValidateMapReport(array $payload): array {
    $honeypotValue = avesmapsNormalizeSingleLine((string) ($payload['website'] ?? ''), 100);
    if ($honeypotValue !== '') {
        return [
            'is_spam' => true,
        ];
    }

    $elapsedMilliseconds = filter_var($payload['elapsed_ms'] ?? null, FILTER_VALIDATE_INT);
    // The <3s "too fast = bot" heuristic does not apply to change reports: the in-app position-pick flow can
    // legitimately submit within seconds (no typing needed for a pure position change).
    if ($elapsedMilliseconds !== false && $elapsedMilliseconds > 0 && $elapsedMilliseconds < 3000 && ($payload['report_mode'] ?? 'new') !== 'change') {
        return [
            'is_spam' => true,
        ];
    }

    $name = avesmapsNormalizeSingleLine((string) ($payload['name'] ?? ''), 80);
    if ($name === '') {
        throw new InvalidArgumentException('Bitte einen Namen angeben.');
    }

    $requestedType = avesmapsNormalizeSingleLine((string) ($payload['report_type'] ?? 'location'), 40);
    if (!array_key_exists($requestedType, AVESMAPS_REPORT_TYPES)) {
        throw new InvalidArgumentException('Die Art der Meldung ist ungueltig.');
    }

    $reportConfig = AVESMAPS_REPORT_TYPES[$requestedType];
    $size = strtolower(avesmapsNormalizeSingleLine((string) ($payload['size'] ?? ''), 40));
    if ($requestedType === 'location') {
        if (!in_array($size, AVESMAPS_LOCATION_SUBTYPES, true)) {
            throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
        }
        $reportConfig['subtype'] = $size;
    } elseif ($requestedType === 'gebaeude') {
        $reportConfig['subtype'] = 'gebaeude';
    }

    if ($reportConfig['type'] === 'location' && !in_array($reportConfig['subtype'], AVESMAPS_LOCATION_SUBTYPES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    // Kartensammlung suggestion (§3.8): the proposed map itself travels in payload_json, whitelisted by
    // avesmapsNormalizeCitymapReportPayload -- notably WITHOUT any licence field, so a reporter cannot
    // talk us into publishing an image (see the rationale on that function). Everything else about the
    // report -- honeypot, elapsed_ms, rate limit, sources, position -- behaves like any other 'new' one.
    $citymapReport = $requestedType === 'karte'
        ? avesmapsNormalizeCitymapReportPayload($payload['citymap'] ?? null)
        : null;

    // Ein weiterer Fundort zu einer bestehenden Karte. Gleiche Haltung wie oben: die Allowlist liegt in der
    // Karten-Bibliothek, und was sie nicht zurueckgibt, erreicht keine Spalte -- insbesondere nicht origin
    // (sonst schriebe sich ein Vorschlag als 'manual' ein und der Editor hielte ihn fuer seinen).
    $citymapLinkReport = $requestedType === 'fundort'
        ? avesmapsNormalizeCitymapLinkReportPayload($payload['citymap_link'] ?? null)
        : null;

    // Multi-source #3 (community source suggestions): the reporter fills the SAME source fields an editor
    // fills by hand (title / link / pages / type / official) and MAY list several sources. On "Anlegen"
    // each becomes a real feature_sources link. Accept the structured array; fall back to the legacy
    // single `source` free-text field (old cached form) as one label-only source so nothing breaks.
    $sources = avesmapsNormalizeReportSources($payload['sources'] ?? null);
    if ($sources === []) {
        $legacySource = avesmapsNormalizeSingleLine((string) ($payload['source'] ?? ''), 200);
        if ($legacySource !== '') {
            $sources = [['url' => '', 'label' => $legacySource, 'pages' => '', 'type' => 'sonstiges', 'official' => false]];
        }
    }
    $changeContext = avesmapsNormalizeChangeContext($payload);
    // 'fundort' ist von der Quellenpflicht ausgenommen, und zwar nicht aus Bequemlichkeit: ein Fundort IST
    // ein Link, die URL ist ihr eigener Beleg. Eine Quelle daneben zu verlangen hiesse, nach dem Werk zu
    // fragen -- eine andere Frage (Spec §1), die der Melder hier gar nicht beantworten will und die er dann
    // mit irgendetwas fuellen wuerde.
    if ($sources === [] && $requestedType !== 'comment' && $requestedType !== 'fundort' && $changeContext['mode'] !== 'change') {
        throw new InvalidArgumentException('Bitte mindestens eine Quelle angeben.');
    }
    // `source` stays the (required, indexed) primary label used for dedup + the review list = first source.
    $source = $sources !== [] ? (string) $sources[0]['label'] : '';
    $comment = avesmapsNormalizeMultiline((string) ($payload['comment'] ?? ''), 800);
    $wikiUrl = avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 300, 'Der Wiki-Link');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    if ($lat < 0 || $lat > AVESMAPS_REPORT_MAP_MAX_COORDINATE || $lng < 0 || $lng > AVESMAPS_REPORT_MAP_MAX_COORDINATE) {
        throw new InvalidArgumentException('Die Meldung ist ungueltig.');
    }

    $sourceSpamText = implode(' ', array_map(static fn(array $entry): string => $entry['label'] . ' ' . $entry['url'], $sources));
    // The citymap's own free text is spam-checked too. It is reader-authored prose and links exactly like
    // the fields beside it -- leaving it out would make 'karte' the one report type with an unchecked
    // writing surface, which is precisely where spam would settle.
    $citymapSpamText = $citymapReport === null ? '' : implode(' ', [
        (string) $citymapReport['citymap']['author'],
        (string) $citymapReport['citymap']['note'],
        (string) $citymapReport['citymap']['map_url'],
        (string) $citymapReport['citymap']['thumb_url'],
    ]);
    // Dasselbe fuer die Fundorte, aus demselben Grund: Bezeichnung, URL und Notiz sind reader-authored
    // Prosa und Links. Ein Meldetyp, der NUR aus Links besteht und als einziger ungeprueft bliebe, waere
    // genau die Tuer, an der Spam anklopft.
    $citymapLinkSpamText = $citymapLinkReport === null ? '' : implode(' ', array_merge(
        [(string) $citymapLinkReport['note']],
        array_map(static fn(array $l): string => $l['label'] . ' ' . $l['url'], $citymapLinkReport['links'])
    ));
    $spamText = implode(' ', [$name, $sourceSpamText, $wikiUrl, $comment, $citymapSpamText, $citymapLinkSpamText, (string) ($payload['reporter_name'] ?? '')]);
    if (avesmapsContainsSpamText($spamText) || avesmapsIsLinkOnlyText($comment)) {
        return [
            'is_spam' => true,
        ];
    }

    return [
        'is_spam' => false,
        'report_type' => $reportConfig['type'],
        'report_subtype' => $reportConfig['subtype'],
        'name' => $name,
        'reporter_name' => avesmapsNormalizeSingleLine((string) ($payload['reporter_name'] ?? ''), 80),
        'source' => $source,
        'sources' => $sources,
        'wiki_url' => $wikiUrl,
        'comment' => $comment,
        'lat' => $lat,
        'lng' => $lng,
        'page_url' => avesmapsNormalizeOptionalUrl((string) ($payload['page_url'] ?? ''), 500, 'Die Seiten-URL'),
        'client_version' => avesmapsNormalizeSingleLine((string) ($payload['client_version'] ?? ''), 80),
        'report_mode' => $changeContext['mode'],
        'entity_type' => $changeContext['entity_type'],
        'entity_public_id' => $changeContext['entity_public_id'],
        // NULL for every type but 'karte' and 'fundort' -> the column stays empty on the reports that do
        // not use it. The two never collide: report_type decides which shape is in there, and each
        // approval re-runs its OWN allowlist over it before anything reaches a column.
        'payload_json' => ($citymapReport ?? $citymapLinkReport) === null
            ? null
            : json_encode($citymapReport ?? $citymapLinkReport, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];
}

// Multi-source #3: normalize + validate the community source list -- an array of
// {source_id,url,label,pages,type,official}. Drops entries without a label; url is optional (a link-based
// catalog entry) but validated when present; type is whitelisted; capped at 10. Mirrors exactly what an
// editor's feature-source add-row produces, so an accepted report links cleanly into feature_sources.
// source_id (instruction 5a) is 0 unless the reporter picked an existing catalog row.
function avesmapsNormalizeReportSources(mixed $raw): array {
    if (!is_array($raw)) {
        return [];
    }
    $allowedTypes = ['regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch', 'sonstiges'];
    $normalized = [];
    foreach (array_slice(array_values($raw), 0, 10) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $label = avesmapsNormalizeSingleLine((string) ($entry['label'] ?? ''), 200);
        if ($label === '') {
            continue; // a source needs at least a name
        }
        $type = strtolower(avesmapsNormalizeSingleLine((string) ($entry['type'] ?? 'sonstiges'), 32));
        if (!in_array($type, $allowedTypes, true)) {
            $type = 'sonstiges';
        }
        // Optional coverage classification -> the popup's publication tab (feature-source-markup.js). The
        // whitelist mirrors avesmapsAddFeatureSource; unknown/absent stays '' (the source then renders on
        // the flat "Quelle(n):" line rather than in a tab).
        $kind = strtolower(avesmapsNormalizeSingleLine((string) ($entry['reference_kind'] ?? ''), 16));
        if (!in_array($kind, ['ausfuehrlich', 'ergaenzend', 'erwaehnung'], true)) {
            $kind = '';
        }
        $normalized[] = [
            // Instruction 5a: when the reporter PICKED an existing catalog row from the typeahead,
            // its id travels along. That is what lets the review link the exact source instead of
            // guessing which work a typed title meant -- and it is the only way a source with no
            // URL can be linked at all (url_hash cannot identify it).
            'source_id' => max(0, (int) ($entry['source_id'] ?? 0)),
            'url' => avesmapsNormalizeOptionalUrl((string) ($entry['url'] ?? ''), 500, 'Der Link zur Quelle'),
            'label' => $label,
            'pages' => avesmapsNormalizeSingleLine((string) ($entry['pages'] ?? ''), 120),
            'type' => $type,
            'reference_kind' => $kind,
            'official' => filter_var($entry['official'] ?? false, FILTER_VALIDATE_BOOLEAN),
        ];
    }
    return $normalized;
}

function avesmapsContainsSpamText(string $value): bool {
    $normalizedValue = mb_strtolower($value);
    foreach (AVESMAPS_REPORT_SPAM_WORDS as $spamWord) {
        if (preg_match('/\b' . preg_quote($spamWord, '/') . '\b/u', $normalizedValue) === 1) {
            return true;
        }
    }

    return false;
}

function avesmapsIsLinkOnlyText(string $value): bool {
    $normalizedValue = trim($value);
    if ($normalizedValue === '') {
        return false;
    }

    $withoutLinks = trim((string) preg_replace('/https?:\/\/\S+/iu', '', $normalizedValue));
    return $withoutLinks === '';
}

function avesmapsBuildPrivacyIpHash(array $config): string {
    $secret = avesmapsGetConfiguredImportApiToken($config);
    if ($secret === '') {
        $secret = (string) ($config['database']['name'] ?? 'avesmaps');
    }

    return hash_hmac('sha256', avesmapsClientIpAddress(), $secret);
}

function avesmapsReportRateLimitExceeded(PDO $pdo, string $ipHash): bool {
    $statement = $pdo->prepare(
        "SELECT COUNT(*)
        FROM map_reports
        WHERE ip_hash = :ip_hash
            AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)"
    );
    $statement->execute([
        'ip_hash' => $ipHash,
    ]);

    return (int) $statement->fetchColumn() >= 5;
}

function avesmapsIsNearDuplicateReport(PDO $pdo, array $mapReport): bool {
    $statement = $pdo->prepare(
        'SELECT name, lat, lng
        FROM map_reports
        WHERE status = :status
            AND report_type = :report_type
            AND report_subtype = :report_subtype
            AND ABS(lat - :lat) <= 2
            AND ABS(lng - :lng) <= 2
        ORDER BY created_at DESC
        LIMIT 20'
    );
    $statement->execute([
        'status' => 'neu',
        'report_type' => $mapReport['report_type'],
        'report_subtype' => $mapReport['report_subtype'],
        'lat' => $mapReport['lat'],
        'lng' => $mapReport['lng'],
    ]);

    $normalizedName = avesmapsNormalizeDuplicateText($mapReport['name']);
    foreach ($statement->fetchAll() as $existingReport) {
        $existingName = avesmapsNormalizeDuplicateText((string) ($existingReport['name'] ?? ''));
        if ($existingName === $normalizedName || levenshtein($existingName, $normalizedName) <= 2) {
            return true;
        }
    }

    return false;
}

function avesmapsNormalizeDuplicateText(string $value): string {
    $normalizedValue = mb_strtolower($value);
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $normalizedValue) ?? '';
}

function avesmapsLocationNameExists(PDO $pdo, string $name): bool {
    $normalizedName = avesmapsNormalizeDuplicateText($name);
    if ($normalizedName === '') {
        return false;
    }

    $featureStatement = $pdo->prepare(
        'SELECT name
        FROM map_features
        WHERE feature_type = :feature_type
          AND is_active = 1'
    );
    $featureStatement->execute([
        'feature_type' => 'location',
    ]);
    foreach ($featureStatement->fetchAll() as $featureRow) {
        if (avesmapsNormalizeDuplicateText((string) ($featureRow['name'] ?? '')) === $normalizedName) {
            return true;
        }
    }

    $reportStatement = $pdo->prepare(
        'SELECT name
        FROM map_reports
        WHERE status = :status
            AND report_type = :report_type'
    );
    $reportStatement->execute([
        'status' => 'neu',
        'report_type' => 'location',
    ]);
    foreach ($reportStatement->fetchAll() as $reportRow) {
        if (avesmapsNormalizeDuplicateText((string) ($reportRow['name'] ?? '')) === $normalizedName) {
            return true;
        }
    }

    return false;
}

function avesmapsEnsureMapReportsTable(PDO $pdo): void {
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
    avesmapsEnsureMapReportColumn($pdo, 'reporter_name', 'VARCHAR(80) NULL AFTER name');
    avesmapsEnsureMapReportColumn($pdo, 'ip_hash', 'CHAR(64) NULL AFTER remote_ip');
    // Multi-source #3: community source-suggestion list as JSON (array of {url,label,pages,type,official}).
    avesmapsEnsureMapReportColumn($pdo, 'sources_json', 'TEXT NULL AFTER source');
    avesmapsEnsureMapReportIndex($pdo, 'idx_map_reports_ip_hash_created_at', '(ip_hash, created_at)');
    // Community "Änderung vorschlagen": change reports reference an existing element.
    avesmapsEnsureMapReportColumn($pdo, 'report_mode', "VARCHAR(16) NOT NULL DEFAULT 'new' AFTER report_subtype");
    avesmapsEnsureMapReportColumn($pdo, 'entity_type', 'VARCHAR(20) NULL AFTER report_mode');
    avesmapsEnsureMapReportColumn($pdo, 'entity_public_id', 'VARCHAR(80) NULL AFTER entity_type');
    // Kartensammlung suggestion (§3.8): the whole proposed map as JSON. Only report_type='citymap' fills
    // it. A generic column rather than ~15 citymap columns on a table about map_features reports -- the
    // shape is the citymap library's business, and it is read back through the same whitelist that wrote it.
    avesmapsEnsureMapReportColumn($pdo, 'payload_json', 'TEXT NULL AFTER sources_json');
}

function avesmapsEnsureMapReportColumn(PDO $pdo, string $columnName, string $columnDefinition): void {
    $quotedColumnName = $pdo->quote($columnName);
    $statement = $pdo->query("SHOW COLUMNS FROM map_reports LIKE {$quotedColumnName}");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec("ALTER TABLE map_reports ADD COLUMN {$columnName} {$columnDefinition}");
}

function avesmapsEnsureMapReportIndex(PDO $pdo, string $indexName, string $indexDefinition): void {
    foreach ($pdo->query('SHOW INDEX FROM map_reports') as $indexRow) {
        if (($indexRow['Key_name'] ?? '') === $indexName) {
            return;
        }
    }

    $pdo->exec("ALTER TABLE map_reports ADD KEY {$indexName} {$indexDefinition}");
}

function avesmapsBuildDatabaseErrorMessage(PDOException $exception): string {
    $sqlState = strtoupper((string) ($exception->errorInfo[0] ?? $exception->getCode() ?? ''));
    $driverCode = (string) ($exception->errorInfo[1] ?? '');

    if (in_array($sqlState, ['42S02', '42P01'], true)) {
        return 'Die Tabelle fuer Meldungen fehlt auf dem Server.';
    }

    if (in_array($sqlState, ['1049', '3D000'], true) || $driverCode === '1049') {
        return 'Die konfigurierte Meldungs-Datenbank existiert auf dem Server nicht.';
    }

    if (in_array($sqlState, ['28000', '42501'], true) || in_array($driverCode, ['1044', '1045', '1142'], true)) {
        return 'Der Datenbank-Benutzer darf Meldungen gerade nicht speichern.';
    }

    if (in_array($sqlState, ['08001', '08004', '08006', 'HY000', '57P03'], true) || in_array($driverCode, ['2002', '2003'], true)) {
        return 'Die Meldungs-Datenbank ist aktuell nicht erreichbar.';
    }

    return 'Die Meldung konnte nicht in der Datenbank gespeichert werden.';
}

function avesmapsLogLocationReportServerError(string $label, array $context): void {
    $logPayload = [
        'label' => $label,
        'time' => gmdate('c'),
        'context' => $context,
    ];

    try {
        $encodedPayload = json_encode($logPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        error_log('Avesmaps location report error: ' . $encodedPayload);
    } catch (JsonException) {
        error_log('Avesmaps location report error: ' . $label);
    }
}
