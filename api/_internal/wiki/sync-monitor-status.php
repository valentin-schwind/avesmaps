<?php

declare(strict_types=1);

// Tabellen, Editorzustand und Status des Wiki-Sync-Monitors -- aus sync-monitor.php herausgezogen,
// die diese Datei an der Stelle des Blocks requiret. Die sieben Konstanten
// (AVESMAPS_WIKI_SYNC_MONITOR_*) und die Geschwister-Libs stehen dort davor; kein Code auf oberster Ebene.
// ⚠️ avesmapsWikiSyncMonitorEnsureTables haengt an keinem avesmapsSchemaEnsureOnce. Wer ihn dort anbindet,
// nennt DIESE Datei als definierende (AGENTS.md §10: der Marker-Schluessel traegt ihre mtime).

function avesmapsWikiSyncMonitorEnsureTables(PDO $pdo): void {
    // Basis-Wiki-Spiegel sicherstellen (idempotent) + Staging-Tabelle als Kopie davon.
    // Der Crawler schreibt NUR ins Staging (_test); Promotion ins political_territory_wiki
    // ist ein separater Schritt (Phase 3). geometry wird nie angefasst.
    if (function_exists('avesmapsPoliticalEnsureTables')) {
        avesmapsPoliticalEnsureTables($pdo);
    }
    if (
        $pdo->query("SHOW TABLES LIKE 'political_territory_wiki'")->fetchColumn() !== false
        && $pdo->query("SHOW TABLES LIKE '" . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . "'")->fetchColumn() === false
    ) {
        $pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' LIKE political_territory_wiki');
    }

    avesmapsWikiSyncMonitorEnsureLicenseColumns($pdo);

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

    // Redirect-Alias-Karte: alias_slug (Titel-Slug, mit dem eine Seite referenziert wird) ->
    // canonical_wiki_key (Schluessel der echten Zielseite). Beim Crawl aus der Redirect-
    // Aufloesung mitgeschrieben; rebuild_model loest Eltern-Referenzen darueber auf, damit
    // Kinder, die auf einen Alias ("Horasreich") zeigen, am kanonischen Knoten landen.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE . ' (
            alias_slug VARCHAR(255) NOT NULL,
            canonical_wiki_key VARCHAR(255) NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (alias_slug),
            KEY idx_wiki_redirect_alias_canonical (canonical_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // excluded = Editor-„aussortiert": Knoten bleibt im Modell (wird gesynct), aus der
    // aktiven Hierarchie aber raus. Ueberlebt Re-Crawl wie parent_locked. Additiv.
    $modelColumns = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $column) {
        $modelColumns[(string) ($column['Field'] ?? '')] = true;
    }
    if (!isset($modelColumns['excluded'])) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' ADD COLUMN excluded TINYINT(1) NOT NULL DEFAULT 0 AFTER parent_locked');
    }

    // Editor-Status (1 Zeile): wann zuletzt welche Aktion lief -> Buttons zeigen "frisch/veraltet"
    // relativ zur letzten Sync. last_sync wird aus max(staging.synced_at) abgeleitet, nicht gespeichert.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' (
            id TINYINT UNSIGNED NOT NULL,
            last_rebuild_at DATETIME(3) NULL,
            last_diff_at DATETIME(3) NULL,
            diff_new INT NULL,
            diff_changed INT NULL,
            diff_deleted INT NULL,
            last_test_at DATETIME(3) NULL,
            last_apply_at DATETIME(3) NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec('INSERT IGNORE INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' (id) VALUES (1)');

    // Identitaets-Apply-Backup: Snapshot der Live-Werte VOR jedem apply_identity-Write,
    // damit ein Apply per revert_identity rueckgaengig gemacht werden kann (batch_id = ein Apply-Lauf).
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_id VARCHAR(32) NOT NULL,
            territory_id INT NOT NULL,
            wiki_key VARCHAR(255) NULL,
            old_name VARCHAR(255) NULL,
            old_type VARCHAR(255) NULL,
            old_status VARCHAR(255) NULL,
            old_valid_from_bf INT NULL,
            old_valid_to_bf INT NULL,
            new_name VARCHAR(255) NULL,
            new_type VARCHAR(255) NULL,
            new_status VARCHAR(255) NULL,
            new_valid_from_bf INT NULL,
            new_valid_to_bf INT NULL,
            old_coat_of_arms_url TEXT NULL,
            new_coat_of_arms_url TEXT NULL,
            kind VARCHAR(16) NOT NULL DEFAULT \'identity\',
            reverted_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            KEY idx_batch (batch_id),
            KEY idx_territory (territory_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    // Coat-Spalten/kind fuer bestehende Backup-Tabellen nachruesten (apply_coats).
    $backupCols = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE) ?: [] as $c) {
        $backupCols[(string) $c['Field']] = true;
    }
    if (!isset($backupCols['old_coat_of_arms_url'])) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . ' ADD COLUMN old_coat_of_arms_url TEXT NULL, ADD COLUMN new_coat_of_arms_url TEXT NULL, ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT \'identity\'');
    }

    // Cache fuer model_tree (schwerer Endpoint, von Editor + Review-WikiSync + Sync-Monitor genutzt).
    $stateCols = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE) ?: [] as $c) {
        $stateCols[(string) $c['Field']] = true;
    }
    if (!isset($stateCols['model_tree_cache'])) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' ADD COLUMN model_tree_cache LONGTEXT NULL, ADD COLUMN model_tree_cache_key VARCHAR(80) NULL');
    }
}

// Zeitstempel einer Editor-Aktion festhalten (rebuild/diff/test/apply). Bei diff zusaetzlich Zahlen.
function avesmapsWikiSyncMonitorRecordEditorAction(PDO $pdo, string $what, array $counts = []): void {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $col = [
        'rebuild' => 'last_rebuild_at',
        'diff' => 'last_diff_at',
        'test' => 'last_test_at',
        'apply' => 'last_apply_at',
    ][$what] ?? null;
    if ($col === null) {
        return;
    }
    if ($what === 'diff') {
        $stmt = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . '
            SET last_diff_at = NOW(3), diff_new = :n, diff_changed = :c, diff_deleted = :d WHERE id = 1');
        $stmt->execute([
            'n' => (int) ($counts['new'] ?? 0),
            'c' => (int) ($counts['changed'] ?? 0),
            'd' => (int) ($counts['deleted'] ?? 0),
        ]);
        return;
    }
    $pdo->exec('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' SET ' . $col . ' = NOW(3) WHERE id = 1');
}

// Liefert die Editor-Stati + abgeleitete "frisch seit letzter Sync"-Flags.
function avesmapsWikiSyncMonitorEditorState(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $row = $pdo->query('SELECT last_rebuild_at, last_diff_at, diff_new, diff_changed, diff_deleted, last_test_at, last_apply_at FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' WHERE id = 1')->fetch(PDO::FETCH_ASSOC) ?: [];
    $lastSync = $pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)->fetchColumn();
    $lastSync = $lastSync ? (string) $lastSync : null;
    $fresh = static function (?string $actionAt) use ($lastSync): bool {
        if ($actionAt === null || $actionAt === '') {
            return false;
        }
        if ($lastSync === null) {
            return true;
        }
        return strtotime($actionAt) >= strtotime($lastSync);
    };
    return [
        'ok' => true,
        'last_sync_at' => $lastSync,
        'last_rebuild_at' => $row['last_rebuild_at'] ?? null,
        'last_diff_at' => $row['last_diff_at'] ?? null,
        'diff' => ['new' => $row['diff_new'], 'changed' => $row['diff_changed'], 'deleted' => $row['diff_deleted']],
        'last_test_at' => $row['last_test_at'] ?? null,
        'last_apply_at' => $row['last_apply_at'] ?? null,
        // State of the global "Wappen: An/Aus" toggle, so the ribbon button can render its label on load
        // instead of guessing. Same trip as every other button state -- no extra request.
        'coats_enabled' => avesmapsTerritoryCoatsEnabled($pdo),
        // 🔴 Die zwei Herkunfts-Schalter -- ohne sie zeigt das Wappen-Menue beim Oeffnen einen
        // erfundenen Stand. `coats_enabled` darueber bleibt fuer aeltere Leser stehen.
        'coats_local_enabled' => avesmapsCoatsLocalEnabled($pdo),
        'coats_wiki_enabled' => avesmapsCoatsWikiEnabled($pdo),
        'model_fresh' => $fresh($row['last_rebuild_at'] ?? null),
        'diff_fresh' => $fresh($row['last_diff_at'] ?? null),
        'test_fresh' => $fresh($row['last_test_at'] ?? null),
        'apply_fresh' => $fresh($row['last_apply_at'] ?? null),
    ];
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
