<?php

declare(strict_types=1);

require_once __DIR__ . '/../map/features.php';
require_once __DIR__ . '/../app/landschaft-wiki.php';

function avesmapsWikiRegionCommitLabelGroup(PDO $pdo, array $updates, int $userId, string $action, ?array &$retainedAuditIds = null): void {
    $fields = match ($action) {
        'assign_wiki_label_group', 'bulk_assign_wiki_label_group' => ['wiki_region'],
        default => throw new InvalidArgumentException('Unbekannte Beschriftungs-Sammelaktion.'),
    };
    if ($updates === []) {
        return;
    }
    if (count($updates) > 200 || $pdo->inTransaction()) {
        throw new InvalidArgumentException('Die Beschriftungs-Sammelaktion benötigt ein eigenes Paket mit höchstens 200 Beschriftungen.');
    }
    avesmapsEnsureMapFeatureLocksTableEinmal($pdo);
    usort($updates, static fn(array $a, array $b): int => (int) $a['before']['id'] <=> (int) $b['before']['id']);
    $pdo->beginTransaction();
    try {
        $features = [];
        foreach ($updates as $update) {
            $before = $update['before'];
            $id = (int) $before['id'];
            if (isset($features[$id])) {
                throw new InvalidArgumentException('Eine Beschriftung kommt im Zuweisungspaket mehrfach vor.');
            }
            $current = avesmapsFetchFeatureByIdForUpdate($pdo, $id);
            if ($current['public_id'] !== $before['public_id'] || $current['feature_type'] !== 'label'
                || (int) $current['is_active'] !== 1 || (int) $current['revision'] !== (int) $before['revision']
                || $current['properties_json'] !== $before['properties_json']
                || $current['name'] !== $before['name'] || $current['feature_subtype'] !== $before['feature_subtype']) {
                throw new AvesmapsConflictException('Eine Beschriftung wurde inzwischen geändert. Bitte den Vorgang neu berechnen.');
            }
            $features[$id] = $current;
        }
        avesmapsWikiRegionAssertFreeLabels($pdo, array_values($features));
        $changed = [];
        foreach ($updates as $update) {
            if (avesmapsMapGroupNormalizeJson(avesmapsDecodeJsonColumnForEdit($update['before']['properties_json']))
                !== avesmapsMapGroupNormalizeJson($update['properties_json'])) {
                $changed[] = $update;
            }
        }
        // Erst alle Zeilensperren und die gemeinsame Revision, danach die erste konsistente Lesesicht.
        $revision = $changed === [] ? null : avesmapsNextMapRevision($pdo);
        foreach ($features as $feature) {
            avesmapsAssertFeatureCanBeEdited($pdo, [], $feature, ['id' => $userId]);
        }
        $beforeMembers = [];
        $afterMembers = [];
        $bounds = [];
        foreach ($changed as $update) {
            $feature = $features[(int) $update['before']['id']];
            $patch = ['properties_json' => avesmapsEncodeJson($update['properties_json']),
                'revision' => $revision, 'updated_by' => $userId];
            avesmapsApplyFeatureUpdates($pdo, (int) $feature['id'], $patch);
            $beforeMembers[] = avesmapsMapGroupAuditMember($feature);
            $afterMembers[] = avesmapsMapGroupAuditMember(array_replace($feature, $patch));
            $bounds[] = avesmapsCalculateGeometryBounds(avesmapsReadGeometryFromColumnValue($feature['geometry_json']));
        }
        if ($changed !== []) {
            avesmapsWikiLocationGroupKanon($pdo, array_column($afterMembers, 'public_id'), 'region');
        }
        $auditId = null;
        if ($changed !== []) {
            $focus = avesmapsAuditFocusFromBounds(min(array_column($bounds, 'min_x')), min(array_column($bounds, 'min_y')),
                max(array_column($bounds, 'max_x')), max(array_column($bounds, 'max_y')));
            $auditId = avesmapsWriteMapGroupAudit($pdo, $action, $userId,
                avesmapsMapGroupAuditSnapshot($beforeMembers, $fields, $focus),
                avesmapsMapGroupAuditSnapshot($afterMembers, $fields, $focus));
        }
        if ($retainedAuditIds !== null && $auditId !== null) {
            $requiredIds = array_merge($retainedAuditIds, [$auditId]);
            $slots = implode(',', array_fill(0, count($requiredIds), '?'));
            $retained = $pdo->prepare("SELECT COUNT(*) FROM map_audit_log WHERE id IN ($slots)");
            $retained->execute($requiredIds);
            if ((int) $retained->fetchColumn() !== count($requiredIds)) {
                throw new AvesmapsConflictException('Die Aufbewahrungsgrenze für diesen Massenlauf ist erreicht.');
            }
        }
        $pdo->commit();
        if ($retainedAuditIds !== null && $auditId !== null) {
            $retainedAuditIds[] = $auditId;
        }
    } catch (Throwable $error) {
        avesmapsRollbackAndRethrow($pdo, $error);
    }
}

// Sperrende aktuelle Lesesicht: auch eine neue Primärbindung ohne geänderte Label-Properties zählt.
function avesmapsWikiRegionAssertFreeLabels(PDO $pdo, array $features): void {
    require_once __DIR__ . '/../app/landschaft-wiki.php';
    foreach ($features as $feature) {
        if (avesmapsLandschaftWikiRegionDerBeschriftung($pdo, $feature['public_id'],
            avesmapsDecodeJsonColumnForEdit($feature['properties_json']), true) !== null) {
            throw new AvesmapsConflictException('Eine Beschriftung gehört inzwischen zu einer Landschaft. Bitte die Zuordnung neu prüfen.');
        }
    }
}
