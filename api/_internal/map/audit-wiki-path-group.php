<?php

declare(strict_types=1);

// Beide Namensgruppen sind betroffen: ein unveränderter Nachbar kann seine Wiki-Erbschaft verlieren.
function avesmapsWikiPathGroupKanon(PDO $pdo, array $before, array $after): array {
    $members = array_merge($before['members'], $after['members']);
    $ids = array_values(array_unique(array_column($members, 'public_id')));
    $names = [];
    foreach ($members as $member) {
        foreach ([$member['name'], $member['properties_json']['name'] ?? ''] as $name) {
            if (trim($name) !== '') {
                $names[$name] = true;
            }
        }
    }
    $idSlots = implode(',', array_fill(0, count($ids), '?'));
    $nameSlots = implode(',', array_fill(0, count($names), '?'));
    $read = $pdo->prepare("SELECT public_id, name, feature_subtype, properties_json FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND (public_id IN ($idSlots)"
        . ($names === [] ? '' : " OR name IN ($nameSlots)") . ') LIMIT 1001');
    $read->execute(array_merge($ids, array_keys($names)));
    $rows = $read->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) > 1000) {
        throw new InvalidArgumentException('Die betroffenen Namensgruppen sind zu groß für einen gemeinsamen Kanonnachtrag.');
    }
    $features = [];
    foreach ($rows as $row) {
        $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json']);
        $properties['public_id'] = $row['public_id'];
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $row['feature_subtype'];
        $features[] = ['properties' => $properties];
    }
    $ids = array_column($rows, 'public_id');
    if ($ids === []) {
        return [];
    }
    $slots = implode(',', array_fill(0, count($ids), '?'));
    $read = $pdo->prepare("SELECT entity_public_id, source_id, reference_kind FROM feature_sources
        WHERE entity_type = 'path' AND status = 'approved' AND entity_public_id IN ($slots) LIMIT 2501");
    $read->execute($ids);
    $links = $read->fetchAll(PDO::FETCH_ASSOC);
    if (count($links) > 2500) {
        throw new InvalidArgumentException('Die betroffenen Wege haben zu viele Quellen für einen gemeinsamen Kanonnachtrag.');
    }
    $refs = [];
    $sourceIds = [];
    foreach ($links as $link) {
        $sourceIds[(int) $link['source_id']] = true;
        $refs['path:' . $link['entity_public_id']][] = ['source_id' => (int) $link['source_id'],
            'reference_kind' => (string) ($link['reference_kind'] ?? '')];
    }
    [$catalog] = avesmapsMapGroupSourceCatalog($pdo, $sourceIds);
    return avesmapsFeatureSourcesKanonAusEingaben('path', $ids, $catalog, $refs, avesmapsMapFeaturesWikiNamespaces($features));
}
