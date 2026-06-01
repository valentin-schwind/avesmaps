<?php

declare(strict_types=1);

// Wiki-Sync-Monitor (Herrschaftsgebiete): eigene Tab-Surface fuer den ueberarbeiteten Crawler.
// Lebt bewusst NEBEN dem Legacy-WikiSync-Dispatcher. Schreibt das Hierarchie-Modell in EIGENE
// Sandbox-Tabellen (wiki_crawl_queue, wiki_territory_model). Tastet political_territory_wiki/
// _geometry NICHT an (Crawler-/Sync-Vertrag). parent_wiki_key = Wahrheit; political_territory.
// parent_id bleibt abgeleiteter Cache. Siehe memory/wiki-crawler-rework-prep.md.

const AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE = 'wiki_crawl_queue';
const AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE = 'wiki_territory_model';
const AVESMAPS_WIKI_SYNC_MONITOR_MAX_DEPTH = 5;

function avesmapsWikiSyncMonitorEnsureTables(PDO $pdo): void {
    // Resumierbare BFS-Frontier + Visited in einem. Pro (run_id, dedup_key) genau ein Eintrag
    // (dedup_key = stabiler Slug aus dem Titel, beim Enqueue berechnet).
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id CHAR(36) NOT NULL,
            dedup_key VARCHAR(255) NOT NULL,
            wiki_title VARCHAR(255) NOT NULL,
            wiki_key VARCHAR(255) NULL,
            depth INT NOT NULL DEFAULT 0,
            role VARCHAR(40) NOT NULL DEFAULT \'page\',
            source VARCHAR(255) NULL,
            status VARCHAR(20) NOT NULL DEFAULT \'pending\',
            attempts INT NOT NULL DEFAULT 0,
            error_text VARCHAR(500) NULL,
            claimed_at DATETIME(3) NULL,
            processed_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_crawl_queue_run_dedup (run_id, dedup_key),
            KEY idx_wiki_crawl_queue_run_status (run_id, status),
            KEY idx_wiki_crawl_queue_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // Sandbox-Hierarchie-Modell. parent_wiki_key = Wahrheit (editor-korrigierbar, ueberlebt
    // Re-Crawl/DB-Neuaufbau). auto_parent_wiki_key = letzter Maschinen-Vorschlag (fuer Divergenz-
    // Diff). parent_conflict_json = konkurrierende/strittige Eltern (Widerspr., beansprucht von, /).
    // parent_locked / metadata_locked_json schuetzen Editor-Korrekturen vor Re-Crawl-Override.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            parent_wiki_key VARCHAR(255) NULL,
            parent_locked TINYINT(1) NOT NULL DEFAULT 0,
            auto_parent_wiki_key VARCHAR(255) NULL,
            parent_conflict_json JSON NULL,
            source_origin VARCHAR(40) NULL,
            metadata_overrides_json JSON NULL,
            metadata_locked_json JSON NULL,
            notes VARCHAR(1000) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_territory_model_key (wiki_key),
            KEY idx_wiki_territory_model_parent (parent_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function avesmapsWikiSyncMonitorTableExists(PDO $pdo, string $table): bool {
    // SHOW TABLES LIKE ? scheitert mit native Prepares an MariaDB (1064); information_schema
    // vertraegt den Platzhalter.
    $statement = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = :table'
    );
    $statement->execute(['table' => $table]);

    return (int) ($statement->fetchColumn() ?: 0) > 0;
}

function avesmapsWikiSyncMonitorCountRows(PDO $pdo, string $table): int {
    if (!avesmapsWikiSyncMonitorTableExists($pdo, $table)) {
        return 0;
    }

    return (int) ($pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() ?: 0);
}

function avesmapsWikiSyncMonitorColumns(PDO $pdo, string $table): array {
    if (!avesmapsWikiSyncMonitorTableExists($pdo, $table)) {
        return [];
    }

    $columns = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . $table) ?: [] as $row) {
        $columns[] = (string) ($row['Field'] ?? '');
    }

    return array_values(array_filter($columns, static fn(string $value): bool => $value !== ''));
}

// Liefert den Aufbau-/Bestandsstatus der Sandbox-Tabellen. Read-only ausser dem ensure-Schritt.
function avesmapsWikiSyncMonitorBuildStatus(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    return [
        'ok' => true,
        'max_depth' => AVESMAPS_WIKI_SYNC_MONITOR_MAX_DEPTH,
        'tables' => [
            AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE => [
                'exists' => avesmapsWikiSyncMonitorTableExists($pdo, AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE),
                'row_count' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE),
                'columns' => avesmapsWikiSyncMonitorColumns($pdo, AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE),
            ],
            AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE => [
                'exists' => avesmapsWikiSyncMonitorTableExists($pdo, AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE),
                'row_count' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE),
                'columns' => avesmapsWikiSyncMonitorColumns($pdo, AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE),
            ],
        ],
    ];
}
