<?php
declare(strict_types=1);

// Multi-source system (#1): catalog of distinct sources + element<->source links.
// Self-healing DDL (project idiom); dedup by url_hash so arbitrary-length URLs get a
// fixed-length UNIQUE index (avoids the utf8mb4 index-length limit on a long url column).
function avesmapsEnsureFeatureSourceTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url TEXT NOT NULL,
            url_hash CHAR(64) NOT NULL,
            label VARCHAR(200) NOT NULL DEFAULT '',
            source_type VARCHAR(32) NOT NULL DEFAULT 'sonstiges',
            is_official TINYINT(1) NOT NULL DEFAULT 0,
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_sources_url_hash (url_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS feature_sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            source_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_feature_source (entity_type, entity_public_id, source_id),
            KEY idx_feature_lookup (entity_type, entity_public_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// The single read used by the public endpoint. ONE parameterized query, only approved links,
// official-first then insertion order (matches the infobox display order in the spec).
function avesmapsReadFeatureSources(PDO $pdo, string $entityType, string $entityPublicId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $statement = $pdo->prepare(
        "SELECT s.url, s.label, s.source_type, s.is_official
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType, 'id' => $entityPublicId]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    return array_map(static fn(array $r): array => [
        'url' => (string) $r['url'],
        'label' => (string) $r['label'],
        'type' => (string) $r['source_type'],
        'official' => (int) $r['is_official'] === 1,
    ], $rows);
}
