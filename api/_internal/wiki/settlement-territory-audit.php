<?php

declare(strict_types=1);

require_once __DIR__ . '/../map/features.php';

// Ein bereits clientseitig begrenztes Paket bleibt ein unteilbarer Vorgang.
function avesmapsWikiSettlementCommitTerritoryGroup(PDO $pdo, array $updates, int $userId): void {
    if ($updates === []) {
        return;
    }
    if (count($updates) > 200 || $pdo->inTransaction()) {
        throw new InvalidArgumentException('Die Ortszuweisung benötigt ein eigenes Paket mit höchstens 200 Orten.');
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
                throw new InvalidArgumentException('Ein Ort kommt im Zuweisungspaket mehrfach vor.');
            }
            $current = avesmapsFetchFeatureByIdForUpdate($pdo, $id);
            if ($current['public_id'] !== $before['public_id'] || $current['feature_type'] !== 'location'
                || (int) $current['is_active'] !== 1 || (int) $current['revision'] !== (int) $before['revision']
                || $current['properties_json'] !== $before['properties_json']) {
                throw new AvesmapsConflictException('Ein Ort wurde inzwischen geändert. Bitte die Zuweisung neu berechnen.');
            }
            $features[$id] = $current;
        }
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
            $focus = avesmapsAuditFocusFromBounds(min(array_column($bounds, 'min_x')), min(array_column($bounds, 'min_y')),
                max(array_column($bounds, 'max_x')), max(array_column($bounds, 'max_y')));
            avesmapsWriteMapGroupAudit($pdo, 'set_territory_location_group', $userId,
                avesmapsMapGroupAuditSnapshot($beforeMembers, ['territory_assignment'], $focus),
                avesmapsMapGroupAuditSnapshot($afterMembers, ['territory_assignment'], $focus));
        }
        $pdo->commit();
    } catch (Throwable $error) {
        avesmapsRollbackAndRethrow($pdo, $error);
    }
}
