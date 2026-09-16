<?php

declare(strict_types=1);

require_once __DIR__ . '/../audit-focus.php';

// Ein Request, eine Transaktion, ein unteilbarer Beleg. Keine Gruppierung nach Uhrzeit.
const AVESMAPS_MAP_GROUP_AUDIT_ACTIONS = [
    'link_wiki_location_group', 'undo_link_wiki_location_group', 'undo_undo_link_wiki_location_group',
    'local_coat_location_group', 'undo_local_coat_location_group', 'undo_undo_local_coat_location_group',
    'set_coat_location_group', 'undo_set_coat_location_group', 'undo_undo_set_coat_location_group',
    'set_ruined_location_group', 'undo_set_ruined_location_group', 'undo_undo_set_ruined_location_group',
    'set_territory_location_group', 'undo_set_territory_location_group', 'undo_undo_set_territory_location_group',
    'bulk_assign_wiki_path_group', 'undo_bulk_assign_wiki_path_group', 'undo_undo_bulk_assign_wiki_path_group',
    'assign_wiki_path_group', 'undo_assign_wiki_path_group', 'undo_undo_assign_wiki_path_group',
    'clear_wiki_path_group', 'undo_clear_wiki_path_group', 'undo_undo_clear_wiki_path_group',
    'update_path_group_details',
    'undo_update_path_group_details',
    'undo_undo_update_path_group_details',
    'update_powerline_group', 'undo_update_powerline_group', 'undo_undo_update_powerline_group',
    'reorder_powerline_group', 'undo_reorder_powerline_group', 'undo_undo_reorder_powerline_group',
];
const AVESMAPS_MAP_GROUP_AUDIT_MAX_BYTES = 524288;
const AVESMAPS_MAP_GROUP_AUDIT_ACTOR_BYTES = 8388608;
const AVESMAPS_MAP_GROUP_AUDIT_GLOBAL_BYTES = 33554432;

function avesmapsIsMapGroupAuditAction(string $action): bool {
    return in_array($action, AVESMAPS_MAP_GROUP_AUDIT_ACTIONS, true);
}

function avesmapsMapGroupAuditMember(array $feature): array {
    return [
        'id' => (int) $feature['id'],
        'public_id' => (string) $feature['public_id'],
        'feature_type' => (string) $feature['feature_type'],
        'name' => (string) $feature['name'],
        'feature_subtype' => (string) $feature['feature_subtype'],
        'properties_json' => avesmapsDecodeFeatureJsonValue($feature['properties_json']),
        'is_active' => (int) $feature['is_active'],
    ];
}

function avesmapsMapGroupAuditSnapshot(array $members, array $fields, ?array $focus): array {
    return [
        'version' => 1,
        'name' => (string) $members[0]['name'],
        'feature_type' => (string) $members[0]['feature_type'],
        'count' => count($members),
        'fields' => array_values($fields),
        'focus' => $focus,
        'members' => array_values($members),
    ];
}

function avesmapsWriteMapGroupAudit(PDO $pdo, string $action, int $actorId, array $before, array $after): int {
    $beforeJson = avesmapsEncodeAuditJson($before);
    $afterJson = avesmapsEncodeAuditJson($after);
    if (strlen($beforeJson) + strlen($afterJson) > AVESMAPS_MAP_GROUP_AUDIT_MAX_BYTES) {
        throw new InvalidArgumentException('Die Gruppe enthält zu viele Daten für eine sichere Sammel-Rücknahme. Bitte weniger Abschnitte gemeinsam bearbeiten.');
    }

    $auditId = avesmapsWriteMapAuditLog($pdo, null, $action, $actorId, $beforeJson, $afterJson);
    avesmapsPruneMapGroupAuditBytes($pdo, $actorId);

    return $auditId;
}

function avesmapsPruneMapGroupAuditBytes(PDO $pdo, int $actorId): void {
    // Nur Kennung und Bytezahl verlassen die DB. LENGTH zählt in MySQL Bytes, keine Zeichen.
    // Die bestehende globale Zeilengrenze begrenzt auch diese Abfrage auf höchstens 10.000 Zeilen.
    $actions = "'" . implode("', '", AVESMAPS_MAP_GROUP_AUDIT_ACTIONS) . "'";
    foreach ([true, false] as $actorOnly) {
        $where = 'action IN (' . $actions . ')' . ($actorOnly ? ' AND actor_user_id = :actor' : '');
        $parameters = $actorOnly ? ['actor' => $actorId] : [];
        // MySQL kann beim Filesort auch die großen JSON-Werte materialisieren. Deshalb nur die
        // begrenzte Liste aus IDs und Bytezahlen nach dem Lesen sortieren.
        $read = $pdo->prepare('SELECT id, LENGTH(before_json) + LENGTH(after_json) AS bytes FROM map_audit_log WHERE ' . $where);
        $read->execute($parameters);
        $budget = $actorOnly ? AVESMAPS_MAP_GROUP_AUDIT_ACTOR_BYTES : AVESMAPS_MAP_GROUP_AUDIT_GLOBAL_BYTES;
        $used = 0;
        $cutoff = null;
        $rows = $read->fetchAll(PDO::FETCH_ASSOC);
        usort($rows, static fn(array $left, array $right): int => (int) $right['id'] <=> (int) $left['id']);
        foreach ($rows as $row) {
            $used += (int) $row['bytes'];
            if ($used > $budget) {
                $cutoff = (int) $row['id'];
                break;
            }
        }
        if ($cutoff !== null) {
            $delete = $pdo->prepare('DELETE FROM map_audit_log WHERE ' . $where . ' AND id <= :cutoff');
            $delete->execute($parameters + ['cutoff' => $cutoff]);
        }
    }
}

function avesmapsMapGroupAuditMembers(array $snapshot, string $featureType = 'path', bool $full = false): array {
    $members = $snapshot['members'] ?? null;
    if (($snapshot['version'] ?? null) !== 1 || !is_array($members)
        || count($members) < 1 || count($members) > AVESMAPS_PATH_GROUP_MAX_SEGMENTS
        || ($snapshot['count'] ?? null) !== count($members)) {
        throw new AvesmapsConflictException('Der Sammelbeleg ist unvollständig oder hat ein unbekanntes Format.');
    }
    $result = [];
    $publicIds = [];
    foreach ($members as $member) {
        if (!is_array($member)) {
            throw new AvesmapsConflictException('Der Sammelbeleg enthält einen ungültigen Abschnitt.');
        }
        foreach (['id', 'public_id', 'feature_type', 'name', 'feature_subtype', 'properties_json', 'is_active'] as $column) {
            if (!array_key_exists($column, $member)) {
                throw new AvesmapsConflictException('Im Sammelbeleg fehlen Abschnittsdaten.');
            }
        }
        $id = filter_var($member['id'], FILTER_VALIDATE_INT);
        $publicId = (string) $member['public_id'];
        if ($id === false || $id < 1 || isset($result[$id]) || isset($publicIds[$publicId])
            || preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1
            || $member['feature_type'] !== $featureType || !in_array($member['is_active'], $full ? [0, 1] : [1], true)
            || !is_string($member['name']) || !is_string($member['feature_subtype'])
            || (!is_array($member['properties_json']) && $member['properties_json'] !== null)) {
            throw new AvesmapsConflictException('Der Sammelbeleg enthält ungültige oder doppelte Abschnitte.');
        }
        if ($full) {
            foreach (AVESMAPS_POWERLINE_GROUP_FULL_COLUMNS as $column) {
                if (!array_key_exists($column, $member)) {
                    throw new AvesmapsConflictException('Im Sammelbeleg fehlen Geometriedaten.');
                }
            }
            if ($member['geometry_type'] !== 'LineString' || !is_array($member['geometry_json'])) {
                throw new AvesmapsConflictException('Die Geometriedaten des Sammelbelegs sind ungültig.');
            }
        }
        $result[$id] = $member;
        $publicIds[$publicId] = true;
    }
    ksort($result, SORT_NUMERIC);

    return $result;
}

// Läuft innerhalb der Transaktion des Einzel-Undo-Einstiegs, niemals mit eigener Transaktion.
function avesmapsUndoMapGroupAudit(PDO $pdo, array $entry, array $user): array {
    $before = avesmapsDecodeJsonColumnForEdit($entry['before_json']);
    $after = avesmapsDecodeJsonColumnForEdit($entry['after_json']);
    $locationGroup = str_contains($entry['action'], '_location_group');
    $featureType = $locationGroup ? 'location' : (str_contains($entry['action'], 'powerline_group') ? 'powerline' : 'path');
    $full = str_contains($entry['action'], 'reorder_powerline_group');
    $columns = $locationGroup ? ['properties_json'] : ['name', 'feature_subtype', 'properties_json'];
    if ($full) {
        $columns = array_merge($columns, ['is_active'], AVESMAPS_POWERLINE_GROUP_FULL_COLUMNS);
    }
    $beforeMembers = avesmapsMapGroupAuditMembers($before, $featureType, $full);
    $afterMembers = avesmapsMapGroupAuditMembers($after, $featureType, $full);
    if (array_keys($beforeMembers) !== array_keys($afterMembers)) {
        throw new AvesmapsConflictException('Die Abschnitte des Sammelbelegs passen nicht zusammen.');
    }

    $features = [];
    $patches = [];
    foreach ($beforeMembers as $id => $member) {
        $feature = avesmapsFetchFeatureByIdForUpdate($pdo, $id);
        if ($feature['feature_type'] !== $featureType || $feature['public_id'] !== $member['public_id']
            || $afterMembers[$id]['public_id'] !== $member['public_id']) {
            throw new AvesmapsConflictException('Ein Abschnitt des Sammelbelegs gehört nicht mehr zu diesem Kartenobjekt.');
        }
        $features[$id] = $feature;
    }
    foreach ($features as $id => $feature) {
        $member = $beforeMembers[$id];
        avesmapsAssertFeatureCanBeEdited($pdo, [], $feature, $user);
        avesmapsAssertUndoPatchStillCurrent('update_path_details', $feature, $afterMembers[$id],
            array_unique(array_merge($columns, ['is_active'])));
        $patches[$id] = avesmapsBuildFeatureRestoreValues($member, $columns);
    }

    if ($full) {
        avesmapsAssertPowerlineGroupDependencies($pdo, $after);
        avesmapsRestorePowerlineGroupSources($pdo, $before, $after);
    }
    $revision = avesmapsNextMapRevision($pdo);
    $responses = [];
    foreach ($features as $id => $feature) {
        $patch = $patches[$id] + ['revision' => $revision, 'updated_by' => (int) $user['id']];
        avesmapsApplyFeatureUpdates($pdo, $id, $patch);
        $response = avesmapsBuildFeatureResponseFromStoredFeature(array_replace($feature, $patch));
        $response['removed_properties'] = array_values(array_diff(
            array_keys(avesmapsDecodeJsonColumnForEdit($feature['properties_json'])),
            array_keys(avesmapsDecodeJsonColumnForEdit($patch['properties_json']))
        ));
        $responses[] = $response;
    }
    $undoId = avesmapsWriteMapGroupAudit($pdo, avesmapsBuildUndoAuditAction($entry['action']),
        (int) $user['id'], $after, $before);
    avesmapsMarkAuditEntryUndone($pdo, (int) $entry['id'], (int) $user['id'], $undoId);

    return ['fields' => $before['fields'] ?? [], 'revision' => $revision, 'features' => $responses, 'steps' => count($responses), 'feature_type' => $featureType,
        'source_payload' => $full ? avesmapsPowerlineGroupSourcePayload($pdo, $before) : null,
        'kanon_je_kennung' => str_contains($entry['action'], 'wiki_path_group')
            ? avesmapsWikiPathGroupKanon($pdo, $before, $after)
            : (str_contains($entry['action'], 'link_wiki_location_group')
                ? avesmapsWikiLocationGroupKanon($pdo, array_column($responses, 'public_id')) : null)];
}

// Der Delta-Lesepfad liefert keinen Kanon. Nur die betroffenen Orte werden hier nachgetragen.
function avesmapsWikiLocationGroupKanon(PDO $pdo, array $ids): array {
    require_once __DIR__ . '/../app/feature-sources.php';
    $slots = implode(',', array_fill(0, count($ids), '?'));
    $read = $pdo->prepare("SELECT entity_public_id, source_id, reference_kind FROM feature_sources
        WHERE entity_type = 'settlement' AND status = 'approved' AND entity_public_id IN ($slots) LIMIT 2501");
    $read->execute($ids);
    $links = $read->fetchAll(PDO::FETCH_ASSOC);
    if (count($links) > 2500) {
        throw new InvalidArgumentException('Die betroffenen Orte haben zu viele Quellen für einen gemeinsamen Kanonnachtrag.');
    }
    $refs = [];
    $sourceIds = [];
    foreach ($links as $link) {
        $sourceIds[(int) $link['source_id']] = true;
        $refs['settlement:' . $link['entity_public_id']][] = ['source_id' => (int) $link['source_id'],
            'reference_kind' => (string) ($link['reference_kind'] ?? '')];
    }
    [$catalog] = avesmapsMapGroupSourceCatalog($pdo, $sourceIds);
    return avesmapsFeatureSourcesKanonAusEingaben('settlement', $ids, $catalog, $refs,
        avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'settlement', $ids));
}

function avesmapsMapGroupAuditDetail(array $snapshot): string {
    $labels = ['coat' => 'Wappen', 'wiki_settlement' => 'Wiki-Verknüpfung und Beschreibung', 'is_ruined' => 'Ruinenstatus', 'territory_assignment' => 'Herrschaftsgebiet-Zuordnung', 'wiki_path_assignment' => 'Wiki-Zuordnung', 'wiki_path' => 'Wiki-Zuordnung und Wegname', 'name' => 'Name', 'feature_subtype' => 'Wegart', 'show_label' => 'Beschriftung', 'allowed_transports' => 'Verkehrsmittel',
        'details' => 'Abschnittsdetails', 'transport_seasons' => 'Saisonfenster',
        'powerline_details' => 'Name, Darstellung und Beschreibung', 'rewire' => 'Verbindungen und Quellenzuordnung'];
    $fields = [];
    foreach (is_array($snapshot['fields'] ?? null) ? $snapshot['fields'] : [] as $field) {
        if (is_string($field) && isset($labels[$field])) {
            $fields[] = $labels[$field];
        }
    }

    $count = (int) ($snapshot['count'] ?? 0);
    $noun = ($snapshot['feature_type'] ?? '') === 'location' ? ($count === 1 ? ' Ort · ' : ' Orte gemeinsam · ')
        : ($count === 1 ? ' Abschnitt · ' : ' Abschnitte gemeinsam · ');
    return $count . $noun . implode(', ', $fields);
}

// JSON-Objekte sind ungeordnet; Listen behalten dagegen ihre Reihenfolge und Skalare ihren Typ.
function avesmapsMapGroupNormalizeJson(mixed $value, int $depth = 0): mixed {
    if (!is_array($value)) {
        return $value;
    }
    if ($depth > 64) {
        throw new InvalidArgumentException('Die Eigenschaften sind zu tief verschachtelt.');
    }
    if (!array_is_list($value)) {
        ksort($value, SORT_STRING);
    }
    foreach ($value as $key => $entry) {
        $value[$key] = avesmapsMapGroupNormalizeJson($entry, $depth + 1);
    }
    return $value;
}
