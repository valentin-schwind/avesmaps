<?php

declare(strict_types=1);

require_once __DIR__ . '/../app/feature-sources.php';
require_once __DIR__ . '/../app/source-corpus.php';

const AVESMAPS_POWERLINE_GROUP_FULL_COLUMNS = ['geometry_type', 'geometry_json', 'style_json', 'min_x', 'min_y', 'max_x', 'max_y'];

// Vor der Transaktion Kandidaten begrenzen; die Namenssuche selbst sperrt keine fremden Kartenzeilen.
function avesmapsReadPowerlineGroupCandidates(PDO $pdo, array $names): array {
    $placeholders = implode(', ', array_fill(0, count($names), '?'));
    $read = $pdo->prepare("SELECT id FROM map_features WHERE feature_type = 'powerline' AND is_active = 1 AND name IN ("
        . $placeholders . ') ORDER BY id LIMIT 251');
    $read->execute($names);
    $ids = $read->fetchAll(PDO::FETCH_COLUMN);
    if ($ids === [] || count($ids) > AVESMAPS_PATH_GROUP_MAX_SEGMENTS) {
        throw new InvalidArgumentException('Die Kraftlinie fehlt oder umfasst mehr als 250 Abschnitte. Es wurde nichts gespeichert.');
    }

    return $ids;
}

function avesmapsFetchPowerlineGroupForUpdate(PDO $pdo, array $ids, array $names, array $user): array {
    $rows = [];
    $hasCurrent = false;
    foreach ($ids as $id) {
        $row = avesmapsFetchFeatureByIdForUpdate($pdo, (int) $id);
        if ($row['feature_type'] !== 'powerline' || (int) $row['is_active'] !== 1 || !in_array($row['name'], $names, true)) {
            throw new AvesmapsConflictException('Die Kraftlinie wurde inzwischen verändert. Bitte neu laden.');
        }
        $hasCurrent = $hasCurrent || $row['name'] === $names[0];
        $rows[] = $row;
    }
    if (!$hasCurrent) {
        throw new AvesmapsConflictException('Die ursprüngliche Kraftlinie wurde inzwischen verändert. Bitte neu laden.');
    }

    foreach ($rows as $row) {
        avesmapsAssertFeatureCanBeEdited($pdo, [], $row, $user);
    }

    return $rows;
}

function avesmapsPowerlineGroupMember(array $feature, bool $full): array {
    $member = avesmapsMapGroupAuditMember($feature);
    if ($full) {
        foreach (AVESMAPS_POWERLINE_GROUP_FULL_COLUMNS as $column) {
            $value = $feature[$column] ?? null;
            $member[$column] = str_ends_with($column, '_json') ? avesmapsDecodeFeatureJsonValue($value) : $value;
        }
    }

    return $member;
}

function avesmapsPowerlineGroupSnapshot(array $features, bool $full, array $sources = [], array $dependencies = []): array {
    $members = array_map(static fn(array $row): array => avesmapsPowerlineGroupMember($row, $full), $features);
    $bounds = array_map(static fn(array $row): array => avesmapsCalculateGeometryBounds(
        avesmapsReadGeometryFromColumnValue($row['geometry_json'])), $features);
    $focus = avesmapsAuditFocusFromBounds(min(array_column($bounds, 'min_x')), min(array_column($bounds, 'min_y')),
        max(array_column($bounds, 'max_x')), max(array_column($bounds, 'max_y')));
    $snapshot = avesmapsMapGroupAuditSnapshot($members, [$full ? 'rewire' : 'powerline_details'], $focus);
    if ($full) {
        $snapshot['source_links'] = $sources;
        $snapshot['dependencies'] = $dependencies;
    }

    return $snapshot;
}

function avesmapsReadPowerlineGroupSources(PDO $pdo, array $publicIds): array {
    $read = $pdo->prepare("SELECT * FROM feature_sources WHERE entity_type = 'powerline' AND entity_public_id IN ("
        . implode(', ', array_fill(0, count($publicIds), '?')) . ') ORDER BY id LIMIT 2501 FOR UPDATE');
    $read->execute($publicIds);
    $rows = $read->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) > 2500) {
        throw new InvalidArgumentException('Die Kraftlinie hat zu viele Quellenzuordnungen für eine gemeinsame Rücknahme.');
    }

    return $rows;
}

function avesmapsPowerlineNodeIsEligible(array $node): bool {
    $properties = avesmapsDecodeJsonColumnForEdit($node['properties_json'] ?? null);

    return !empty($properties['is_nodix']) || ($node['feature_subtype'] ?? '') === 'crossing';
}

function avesmapsAssertPowerlineGroupDependencies(PDO $pdo, array $snapshot): void {
    $dependencies = $snapshot['dependencies'] ?? null;
    if (!is_array($dependencies) || count($dependencies) < 2 || count($dependencies) > 251) {
        throw new AvesmapsConflictException('Im Sammelbeleg fehlen die Nodices.');
    }
    $expected = [];
    foreach ($snapshot['members'] as $member) {
        foreach (['from_public_id', 'to_public_id'] as $key) {
            $id = (string) ($member['properties_json'][$key] ?? '');
            if ($id === '') {
                throw new AvesmapsConflictException('Im Sammelbeleg fehlt ein Endpunkt.');
            }
            $expected[$id] = true;
        }
    }
    $actual = array_column($dependencies, 'public_id');
    if (count($actual) !== count($expected) || array_diff(array_keys($expected), $actual) !== []) {
        throw new AvesmapsConflictException('Die Nodices des Sammelbelegs sind unvollständig.');
    }
    foreach ($dependencies as $dependency) {
        $node = avesmapsFetchEditablePointFeature($pdo, (string) ($dependency['public_id'] ?? ''));
        if (!avesmapsPowerlineNodeIsEligible($node) || avesmapsDecodeFeatureJsonValue($node['geometry_json']) !== ($dependency['geometry_json'] ?? null)) {
            throw new AvesmapsConflictException('Ein Nodix wurde inzwischen verschoben oder ist kein Nodix mehr. Die Kraftlinie kann nicht vollständig zurückgenommen werden.');
        }
    }
}

function avesmapsRestorePowerlineGroupSources(PDO $pdo, array $before, array $after): void {
    $beforeLinks = $before['source_links'] ?? null;
    $afterLinks = $after['source_links'] ?? null;
    $publicIds = array_column($after['members'], 'public_id');
    if (!is_array($beforeLinks) || !is_array($afterLinks) || count($beforeLinks) !== count($afterLinks)
        || avesmapsReadPowerlineGroupSources($pdo, $publicIds) != $afterLinks) {
        throw new AvesmapsConflictException('Die Quellenzuordnung der Kraftlinie wurde inzwischen verändert oder ist unvollständig.');
    }
    $update = $pdo->prepare("UPDATE feature_sources SET entity_public_id = :public_id WHERE id = :id AND entity_type = 'powerline'");
    foreach ($beforeLinks as $index => $row) {
        $current = $afterLinks[$index];
        if (($row['id'] ?? null) != ($current['id'] ?? null)
            || !in_array($row['entity_public_id'] ?? null, $publicIds, true)
            || $row != array_replace($current, ['entity_public_id' => $row['entity_public_id']])) {
            throw new AvesmapsConflictException('Die Quellen des Sammelbelegs passen nicht zusammen.');
        }
        $update->execute(['public_id' => $row['entity_public_id'], 'id' => $row['id']]);
    }
}

// Reiner, begrenzter Nachtrag für den vorhandenen Quellen-Cache. Kein Takeover, kein Schema-Ensure.
function avesmapsPowerlineGroupSourcePayload(PDO $pdo, array $snapshot): array {
    $ids = array_column($snapshot['members'], 'public_id');
    $active = [];
    $namespaces = [];
    foreach ($snapshot['members'] as $member) {
        if ($member['is_active'] === 1) {
            $active[$member['public_id']] = true;
            $namespace = avesmapsWikiNamespaceFromWikiUrlMitHauptraum((string) ($member['properties_json']['wiki_url'] ?? ''));
            if ($namespace !== null) {
                $namespaces['powerline:' . $member['public_id']] = $namespace;
            }
        }
    }
    $byEntity = array_fill_keys($ids, []);
    $sourceIds = [];
    foreach ($snapshot['source_links'] as $link) {
        if ($link['status'] !== 'approved' || !isset($active[$link['entity_public_id']])) {
            continue;
        }
        $sourceIds[(int) $link['source_id']] = true;
        $byEntity[$link['entity_public_id']][] = ['source_id' => (int) $link['source_id'],
            'pages' => (string) ($link['pages'] ?? ''), 'reference_kind' => (string) ($link['reference_kind'] ?? ''),
            'note' => (string) ($link['note'] ?? '')];
    }
    [$catalog, $editorSources] = avesmapsMapGroupSourceCatalog($pdo, $sourceIds);
    $refs = [];
    foreach ($byEntity as $id => $links) {
        $refs['powerline:' . $id] = $links;
    }

    return ['anchor' => $ids[0], 'sources' => $editorSources, 'by_entity' => $byEntity,
        'kanon_je_kennung' => avesmapsFeatureSourcesKanonAusEingaben('powerline', $ids, $catalog, $refs, $namespaces)];
}

// Gemeinsamer begrenzter Katalogleser für Quellen- und Kanonnachträge; ohne DDL.
function avesmapsMapGroupSourceCatalog(PDO $pdo, array $sourceIds): array {
    $catalog = [];
    $editorSources = [];
    if ($sourceIds !== []) {
        $read = $pdo->prepare('SELECT id, url, label, source_type, is_official, license, attribution FROM sources WHERE id IN ('
            . implode(', ', array_fill(0, count($sourceIds), '?')) . ')');
        $read->execute(array_keys($sourceIds));
        $rows = $read->fetchAll(PDO::FETCH_ASSOC);
        $keys = array_values(array_unique(array_filter(array_map(static fn(array $row): string => avesmapsSourceCorpusKey((string) $row['url']), $rows))));
        $corpora = [];
        if ($keys !== []) {
            $read = $pdo->prepare('SELECT corpus_key, label, form, source_type, license, attribution, is_official FROM source_corpus WHERE corpus_key IN ('
                . implode(', ', array_fill(0, count($keys), '?')) . ')');
            $read->execute($keys);
            foreach ($read->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $row['is_official'] = (int) $row['is_official'] === 1;
                $row['known'] = true;
                $corpora[$row['corpus_key']] = $row;
            }
        }
        foreach ($rows as $row) {
            $entry = ['url' => (string) $row['url'], 'label' => (string) $row['label'], 'type' => (string) $row['source_type'],
                'official' => (int) $row['is_official'] === 1, 'license' => (string) ($row['license'] ?? ''), 'attribution' => (string) ($row['attribution'] ?? '')];
            $catalog[(int) $row['id']] = avesmapsFeatureSourceApplyCorpusKey($entry, $entry['url'], $corpora);
            $key = avesmapsSourceCorpusKey($entry['url']);
            $editorSources[] = $entry + ['source_id' => (int) $row['id'], 'corpus' => $corpora[$key] ?? null];
        }
    }
    return [$catalog, $editorSources];
}
