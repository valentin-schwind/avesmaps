<?php
declare(strict_types=1);

// Owner-run migration (multi-source system #1). Existing single properties.other_source {url,label}
// on settlements/regions/paths -> a catalog `sources` row (type 'sonstiges', not official) + an
// approved `feature_sources` link. Idempotent (UNIQUE keys -> ON DUPLICATE / INSERT IGNORE).
// Dry-run unless --confirm. Territories have no other_source and are not part of this migration.
//
// Usage:  php scripts/migrate-other-source-to-sources.php            (dry-run: only prints)
//         php scripts/migrate-other-source-to-sources.php --confirm  (writes)

require __DIR__ . '/../api/_internal/bootstrap.php';
require_once __DIR__ . '/../api/_internal/app/feature-sources.php';

$confirm = in_array('--confirm', $argv, true);

// Same bootstrap contract the app endpoints use (see api/app/feature-sources.php).
$config = avesmapsLoadApiConfig(avesmapsApiRoot());
$pdo = avesmapsCreatePdo($config['database'] ?? []);
avesmapsEnsureFeatureSourceTables($pdo);

$typeByFeature = ['location' => 'settlement', 'region' => 'region', 'path' => 'path'];
$rows = $pdo->query(
    'SELECT public_id, feature_type, properties_json FROM map_features WHERE is_active = 1'
)->fetchAll(PDO::FETCH_ASSOC);

$linked = 0;
foreach ($rows as $row) {
    $entityType = $typeByFeature[(string) $row['feature_type']] ?? null;
    if ($entityType === null) {
        continue;
    }
    $props = json_decode((string) $row['properties_json'], true);
    $other = is_array($props) ? ($props['other_source'] ?? null) : null;
    $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
    if ($url === '') {
        continue;
    }
    $label = is_array($other) ? trim((string) ($other['label'] ?? '')) : '';
    $hash = hash('sha256', $url);

    if ($confirm) {
        // Upsert the catalog source (dedup by url_hash); keep an existing non-empty label.
        $pdo->prepare(
            "INSERT INTO sources (url, url_hash, label, source_type, is_official)
             VALUES (:u, :h, :l, 'sonstiges', 0)
             ON DUPLICATE KEY UPDATE label = IF(label = '', VALUES(label), label)"
        )->execute(['u' => $url, 'h' => $hash, 'l' => $label]);

        $sourceId = (int) $pdo->query(
            'SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($hash)
        )->fetchColumn();

        // Link the element to the source (idempotent via the UNIQUE key).
        $pdo->prepare(
            "INSERT IGNORE INTO feature_sources (entity_type, entity_public_id, source_id, status)
             VALUES (:t, :id, :sid, 'approved')"
        )->execute(['t' => $entityType, 'id' => (string) $row['public_id'], 'sid' => $sourceId]);
    }

    $linked++;
    echo ($confirm ? 'linked ' : 'would link ') . $entityType . ' ' . $row['public_id'] . ' -> ' . $url . "\n";
}

echo ($confirm ? 'DONE. ' : 'DRY-RUN. ') . $linked . " other_source links.\n";
