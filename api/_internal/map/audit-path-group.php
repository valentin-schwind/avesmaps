<?php

declare(strict_types=1);

require_once __DIR__ . '/../audit-focus.php';

// Ein Request, eine Transaktion, ein unteilbarer Beleg. Keine Gruppierung nach Uhrzeit.
const AVESMAPS_PATH_GROUP_AUDIT_ACTIONS = [
    'update_path_group_details',
    'undo_update_path_group_details',
    'undo_undo_update_path_group_details',
];
const AVESMAPS_PATH_GROUP_AUDIT_MAX_BYTES = 524288;
const AVESMAPS_PATH_GROUP_AUDIT_ACTOR_BYTES = 8388608;
const AVESMAPS_PATH_GROUP_AUDIT_GLOBAL_BYTES = 33554432;

function avesmapsIsPathGroupAuditAction(string $action): bool {
    return in_array($action, AVESMAPS_PATH_GROUP_AUDIT_ACTIONS, true);
}

function avesmapsPathGroupAuditMember(array $feature): array {
    return [
        'id' => (int) $feature['id'],
        'public_id' => (string) $feature['public_id'],
        'feature_type' => 'path',
        'name' => (string) $feature['name'],
        'feature_subtype' => (string) $feature['feature_subtype'],
        'properties_json' => avesmapsDecodeFeatureJsonValue($feature['properties_json']),
        'is_active' => (int) $feature['is_active'],
    ];
}

function avesmapsPathGroupAuditSnapshot(array $members, array $fields, ?array $focus): array {
    return [
        'version' => 1,
        'name' => (string) $members[0]['name'],
        'feature_type' => 'path',
        'count' => count($members),
        'fields' => array_values($fields),
        'focus' => $focus,
        'members' => array_values($members),
    ];
}

function avesmapsWritePathGroupAudit(PDO $pdo, string $action, int $actorId, array $before, array $after): int {
    $beforeJson = avesmapsEncodeAuditJson($before);
    $afterJson = avesmapsEncodeAuditJson($after);
    if (strlen($beforeJson) + strlen($afterJson) > AVESMAPS_PATH_GROUP_AUDIT_MAX_BYTES) {
        throw new InvalidArgumentException('Die Wegegruppe enthält zu viele Daten für eine sichere Sammel-Rücknahme. Bitte weniger Abschnitte gemeinsam bearbeiten.');
    }

    $auditId = avesmapsWriteMapAuditLog($pdo, null, $action, $actorId, $beforeJson, $afterJson);
    avesmapsPrunePathGroupAuditBytes($pdo, $actorId);

    return $auditId;
}

function avesmapsPrunePathGroupAuditBytes(PDO $pdo, int $actorId): void {
    // Nur Kennung und Bytezahl verlassen die DB. LENGTH zählt in MySQL Bytes, keine Zeichen.
    // Die bestehende globale Zeilengrenze begrenzt auch diese Abfrage auf höchstens 10.000 Zeilen.
    $actions = "'update_path_group_details', 'undo_update_path_group_details', 'undo_undo_update_path_group_details'";
    foreach ([true, false] as $actorOnly) {
        $where = 'action IN (' . $actions . ')' . ($actorOnly ? ' AND actor_user_id = :actor' : '');
        $parameters = $actorOnly ? ['actor' => $actorId] : [];
        $read = $pdo->prepare('SELECT id, LENGTH(before_json) + LENGTH(after_json) AS bytes FROM map_audit_log WHERE '
            . $where . ' ORDER BY id DESC');
        $read->execute($parameters);
        $budget = $actorOnly ? AVESMAPS_PATH_GROUP_AUDIT_ACTOR_BYTES : AVESMAPS_PATH_GROUP_AUDIT_GLOBAL_BYTES;
        $used = 0;
        $cutoff = null;
        foreach ($read->fetchAll(PDO::FETCH_ASSOC) as $row) {
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

function avesmapsPathGroupAuditMembers(array $snapshot): array {
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
            || $member['feature_type'] !== 'path' || $member['is_active'] !== 1
            || !is_string($member['name']) || !is_string($member['feature_subtype'])
            || (!is_array($member['properties_json']) && $member['properties_json'] !== null)) {
            throw new AvesmapsConflictException('Der Sammelbeleg enthält ungültige oder doppelte Abschnitte.');
        }
        $result[$id] = $member;
        $publicIds[$publicId] = true;
    }
    ksort($result, SORT_NUMERIC);

    return $result;
}

// Läuft innerhalb der Transaktion des Einzel-Undo-Einstiegs, niemals mit eigener Transaktion.
function avesmapsUndoPathGroupAudit(PDO $pdo, array $entry, array $user): array {
    $before = avesmapsDecodeJsonColumnForEdit($entry['before_json']);
    $after = avesmapsDecodeJsonColumnForEdit($entry['after_json']);
    $beforeMembers = avesmapsPathGroupAuditMembers($before);
    $afterMembers = avesmapsPathGroupAuditMembers($after);
    if (array_keys($beforeMembers) !== array_keys($afterMembers)) {
        throw new AvesmapsConflictException('Die Abschnitte des Sammelbelegs passen nicht zusammen.');
    }

    $features = [];
    $patches = [];
    foreach ($beforeMembers as $id => $member) {
        $feature = avesmapsFetchFeatureByIdForUpdate($pdo, $id);
        if ($feature['feature_type'] !== 'path' || $feature['public_id'] !== $member['public_id']
            || $afterMembers[$id]['public_id'] !== $member['public_id']) {
            throw new AvesmapsConflictException('Ein Abschnitt des Sammelbelegs gehört nicht mehr zu diesem Kartenobjekt.');
        }
        avesmapsAssertFeatureCanBeEdited($pdo, [], $feature, $user);
        avesmapsAssertUndoPatchStillCurrent('update_path_details', $feature, $afterMembers[$id],
            ['name', 'feature_subtype', 'properties_json', 'is_active']);
        $features[$id] = $feature;
        $patches[$id] = avesmapsBuildFeatureRestoreValues($member, ['name', 'feature_subtype', 'properties_json']);
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
    $undoId = avesmapsWritePathGroupAudit($pdo, avesmapsBuildUndoAuditAction($entry['action']),
        (int) $user['id'], $after, $before);
    avesmapsMarkAuditEntryUndone($pdo, (int) $entry['id'], (int) $user['id'], $undoId);

    return ['revision' => $revision, 'features' => $responses, 'steps' => count($responses)];
}

function avesmapsPathGroupAuditDetail(array $snapshot): string {
    $labels = ['name' => 'Name', 'feature_subtype' => 'Wegart', 'show_label' => 'Beschriftung', 'allowed_transports' => 'Verkehrsmittel',
        'details' => 'Abschnittsdetails', 'transport_seasons' => 'Saisonfenster'];
    $fields = [];
    foreach (is_array($snapshot['fields'] ?? null) ? $snapshot['fields'] : [] as $field) {
        if (is_string($field) && isset($labels[$field])) {
            $fields[] = $labels[$field];
        }
    }

    return (int) ($snapshot['count'] ?? 0) . ' Abschnitte gemeinsam · ' . implode(', ', $fields);
}
