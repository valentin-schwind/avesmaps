<?php

declare(strict_types=1);

// Die Höhe bleibt Teil derselben Wiki-Staging-Zeile; keine zweite Datenquelle.
function avesmapsWikiRegionParseHeight(string $value): ?float {
    if (preg_match('/[-−]\s*\d/u', $value)) {
        return null;
    }
    if (preg_match_all('/\d+(?:[.,]\d+)*/u', $value, $matches) !== 1) {
        return null;
    }
    $value = $matches[0][0];
    if (preg_match('/^\d{1,3}(?:\.\d{3})+$/D', $value)) {
        $value = str_replace('.', '', $value);
    }
    if (!preg_match('/^\d+(?:[,.]\d+)?$/D', $value)) {
        return null;
    }
    $height = (float) str_replace(',', '.', $value);
    return $height <= 20000 ? $height : null;
}

function avesmapsWikiRegionHeightFromRow(array $row): ?float {
    $raw = $row['raw_json'] ?? [];
    if (!is_array($raw)) {
        $raw = avesmapsWikiSyncDecodeJson($raw);
    }
    $height = $row['height_schritt'] ?? $raw['height_schritt'] ?? null;
    return $height === null ? null : avesmapsWikiRegionParseHeight((string) $height);
}

// Vorhandene Höhen ohne Herkunft gelten als Handarbeit, auch bei gleichem Wiki-Wert.
function avesmapsWikiRegionApplyHeight(array $properties, ?float $height): array {
    if ($height === null) {
        return $properties;
    }
    $origins = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
    if (($properties['height_schritt'] ?? null) !== null
        && ($origins['height_schritt'] ?? '') !== 'wiki') {
        $origins['height_schritt'] = 'manual';
    } else {
        $currentHeight = $properties['height_schritt'] ?? null;
        if (!is_numeric($currentHeight) || (float) $currentHeight !== $height) {
            $properties['height_schritt'] = $height;
        }
        $origins['height_schritt'] = 'wiki';
    }
    $properties['field_origins'] = $origins;
    return $properties;
}

function avesmapsWikiRegionHeightNeedsLive(array $row, int $now): bool {
    $raw = avesmapsWikiSyncDecodeJson($row['raw_json'] ?? null);
    $checkedAt = (int) ($raw['height_checked_at'] ?? 0);
    if ($checkedAt > 0) {
        return $checkedAt > $now || $now - $checkedAt >= 86400;
    }
    return avesmapsWikiRegionHeightFromRow($row) === null;
}

// Ein begrenztes Paket pro Anfrage, vor dem Schreib-Lock genau ein Wiki-Batch.
function avesmapsWikiRegionSyncHeights(PDO $pdo, array $payload, int $userId): array {
    require_once __DIR__ . '/../app/landschaft-wiki.php';
    avesmapsWikiRegionEnsureTables($pdo);
    $cursor = max(0, (int) ($payload['cursor'] ?? 0));
    $statement = $pdo->prepare('SELECT id, wiki_key, title, raw_json FROM '
        . AVESMAPS_WIKI_REGION_STAGING_TABLE
        . " WHERE id > :cursor AND art IN ('Berggipfel', 'Vulkan') ORDER BY id LIMIT 20");
    $statement->execute(['cursor' => $cursor]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        return ['ok' => true, 'done' => true, 'cursor' => $cursor, 'updated' => 0, 'found' => 0];
    }
    $now = time();
    $liveRows = array_filter($rows, static fn(array $row): bool => avesmapsWikiRegionHeightNeedsLive($row, $now));
    $wasInteractive = avesmapsWikiSyncInteraktiv();
    avesmapsWikiSyncInteraktiv(true);
    try {
        $contents = $liveRows === [] ? []
            : avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_column($liveRows, 'title'));
    } finally {
        avesmapsWikiSyncInteraktiv($wasInteractive);
    }
    $heights = [];
    foreach ($rows as $row) {
        $title = (string) $row['title'];
        if (!avesmapsWikiRegionHeightNeedsLive($row, $now)) {
            $heights[(string) $row['wiki_key']] = avesmapsWikiRegionHeightFromRow($row);
            continue;
        }
        if (!isset($contents[$title]) || trim((string) $contents[$title]) === '') {
            throw new RuntimeException('Ein Wiki-Artikel konnte nicht geladen werden. Bitte erneut versuchen.');
        }
        $parsed = avesmapsWikiRegionParsePage($title, (string) $contents[$title]);
        $height = avesmapsWikiRegionHeightFromRow($parsed['record'] ?? []);
        $heights[(string) $row['wiki_key']] = $height;
    }
    $updated = 0;
    $pdo->beginTransaction();
    try {
        $stage = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_REGION_STAGING_TABLE
            . ' SET raw_json = :raw WHERE id = :id');
        foreach ($rows as $row) {
            $key = (string) $row['wiki_key'];
            $raw = avesmapsWikiSyncDecodeJson($row['raw_json'] ?? null);
            $raw['height_schritt'] = $heights[$key];
            if (avesmapsWikiRegionHeightNeedsLive($row, $now)) {
                $raw['height_checked_at'] = $now;
            }
            $stage->execute(['raw' => avesmapsWikiSyncEncodeJson($raw), 'id' => (int) $row['id']]);
        }
        $placeholders = implode(',', array_fill(0, count($heights), '?'));
        $selectLabels = $pdo->prepare("SELECT * FROM map_features WHERE is_active = 1 AND feature_type = 'label'"
            . " AND feature_subtype = 'berggipfel'"
            . " AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.wiki_region.wiki_key')) IN ("
            . $placeholders . ') FOR UPDATE');
        $selectLabels->execute(array_keys($heights));
        $labels = $selectLabels->fetchAll(PDO::FETCH_ASSOC);
        $save = $pdo->prepare('UPDATE map_features SET properties_json = :properties, revision = :revision WHERE id = :id');
        $revision = null;
        foreach ($labels as $label) {
            $properties = avesmapsWikiSyncDecodeJson($label['properties_json'] ?? null);
            $key = (string) ($properties['wiki_region']['wiki_key'] ?? '');
            if (!array_key_exists($key, $heights)) {
                continue;
            }
            $next = avesmapsWikiRegionApplyHeight($properties, $heights[$key]);
            $nest = $next['wiki_region'];
            $nest['height_schritt'] = $heights[$key];
            $next = avesmapsLandschaftWikiNestSetzen($next, $nest);
            $nextJson = avesmapsWikiSyncEncodeJson($next);
            if ($nextJson === avesmapsWikiSyncEncodeJson($properties)) {
                continue;
            }
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $save->execute(['properties' => $nextJson, 'revision' => $revision, 'id' => (int) $label['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $label, $next, $revision, $userId);
            $updated++;
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
    return ['ok' => true, 'done' => count($rows) < 20,
        'cursor' => (int) end($rows)['id'], 'updated' => $updated,
        'found' => count(array_filter($heights, static fn(?float $height): bool => $height !== null)),
        'wait_seconds' => $liveRows === [] ? 0 : 20];
}
