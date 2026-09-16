<?php

declare(strict_types=1);

require_once __DIR__ . '/../map/features.php';

// Planung und DDL liegen vor der Transaktion. Alle Kandidaten werden vor dem ersten Write gesperrt.
function avesmapsWikiPathCommitGroup(PDO $pdo, array $updates, int $userId, string $action): array {
    if ($updates === []) {
        return [];
    }
    if (!in_array($action, ['assign_wiki_path_group', 'clear_wiki_path_group'], true)
        || count($updates) > AVESMAPS_PATH_GROUP_MAX_SEGMENTS) {
        throw new InvalidArgumentException('Höchstens 250 Abschnitte können gemeinsam einem Wiki-Weg zugewiesen oder davon gelöst werden.');
    }
    if ($pdo->inTransaction()) {
        throw new LogicException('Die Wiki-Wegeaktion benötigt eine eigene Transaktion.');
    }
    avesmapsEnsureMapFeatureLocksTableEinmal($pdo);
    $byId = [];
    foreach ($updates as $update) {
        $id = (int) $update['before']['id'];
        if ($id < 1 || isset($byId[$id])) {
            throw new InvalidArgumentException('Die Wiki-Wegeaktion enthält ungültige oder doppelte Abschnitte.');
        }
        $byId[$id] = $update;
    }
    ksort($byId, SORT_NUMERIC);
    $pdo->beginTransaction();
    try {
        $features = [];
        foreach ($byId as $id => $update) {
            $feature = avesmapsFetchFeatureByIdForUpdate($pdo, $id);
            $before = $update['before'];
            if ($feature['public_id'] !== $before['public_id'] || $feature['feature_type'] !== 'path'
                || (int) $feature['is_active'] !== 1 || $feature['name'] !== $before['name']
                || $feature['feature_subtype'] !== $before['feature_subtype']
                || (int) $feature['revision'] !== (int) $before['revision']
                || avesmapsDecodeJsonColumnForEdit($feature['properties_json']) !== avesmapsDecodeJsonColumnForEdit($before['properties_json'])) {
                throw new AvesmapsConflictException('Ein Abschnitt wurde inzwischen geändert. Bitte die Wiki-Wegeaktion neu laden.');
            }
            $features[$id] = $feature;
        }
        // Keine konsistente Lesesicht erzeugen, solange noch auf eine Objektsperre gewartet wird.
        $revisions = [];
        $changed = [];
        foreach ($features as $id => $feature) {
            $revisions[$feature['public_id']] = (int) $feature['revision'];
            $update = $byId[$id];
            if ($feature['name'] !== $update['name']
                || avesmapsMapGroupNormalizeJson(avesmapsDecodeJsonColumnForEdit($feature['properties_json']))
                    !== avesmapsMapGroupNormalizeJson($update['properties_json'])) {
                $changed[$id] = $update;
            }
        }
        // Die Revisionszeile serialisiert auch disjunkte Namensvergaben. Erst DANACH darf
        // die erste normale SELECT-Abfrage den InnoDB-Snapshot für Sperren und Namenspool öffnen.
        $revision = $changed === [] ? null : avesmapsNextMapRevision($pdo);
        foreach ($features as $feature) {
            avesmapsAssertFeatureCanBeEdited($pdo, [], $feature, ['id' => $userId]);
        }
        if ($changed === []) {
            $pdo->commit();
            return $revisions;
        }
        if ($action === 'clear_wiki_path_group') {
            avesmapsWikiPathAssertPlannedNamesAvailable($pdo, $changed);
        }
        $beforeMembers = [];
        $afterMembers = [];
        $bounds = [];
        foreach ($changed as $id => $update) {
            $feature = $features[$id];
            $patch = ['name' => $update['name'], 'properties_json' => avesmapsEncodeJson($update['properties_json']),
                'revision' => $revision, 'updated_by' => $userId];
            avesmapsApplyFeatureUpdates($pdo, $id, $patch);
            $beforeMembers[] = avesmapsMapGroupAuditMember($feature);
            $afterMembers[] = avesmapsMapGroupAuditMember(array_replace($feature, $patch));
            $bounds[] = avesmapsCalculateGeometryBounds(avesmapsReadGeometryFromColumnValue($feature['geometry_json']));
            $revisions[$feature['public_id']] = $revision;
        }
        $focus = avesmapsAuditFocusFromBounds(min(array_column($bounds, 'min_x')), min(array_column($bounds, 'min_y')),
            max(array_column($bounds, 'max_x')), max(array_column($bounds, 'max_y')));
        avesmapsWriteMapGroupAudit($pdo, $action, $userId,
            avesmapsMapGroupAuditSnapshot($beforeMembers, ['wiki_path'], $focus),
            avesmapsMapGroupAuditSnapshot($afterMembers, ['wiki_path'], $focus));
        $pdo->commit();
        return $revisions;
    } catch (Throwable $error) {
        avesmapsRollbackAndRethrow($pdo, $error);
    }
}

function avesmapsWikiPathAssertPlannedNamesAvailable(PDO $pdo, array $updates): void {
    $names = [];
    foreach ($updates as $id => $update) {
        if (isset($names[$update['name']])) {
            throw new AvesmapsConflictException('Ein neuer Wegname ist doppelt vergeben. Bitte neu laden.');
        }
        $names[$update['name']] = $id;
    }
    $rows = $pdo->query("SELECT id, name FROM map_features WHERE feature_type = 'path' AND is_active = 1 AND name <> ''");
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if (isset($names[$row['name']]) && $names[$row['name']] !== (int) $row['id']) {
            throw new AvesmapsConflictException('Ein neuer Wegname ist inzwischen vergeben. Bitte neu laden.');
        }
    }
}
