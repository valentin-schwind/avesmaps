<?php

declare(strict_types=1);

// Wiki-Sync-Monitor (Herrschaftsgebiete): eigene Tab-Surface fuer den ueberarbeiteten Crawler.
// Lebt bewusst NEBEN dem Legacy-WikiSync-Dispatcher. Schreibt das Hierarchie-Modell in EIGENE
// Sandbox-Tabellen (wiki_crawl_queue, wiki_territory_model). Tastet political_territory_wiki/
// _geometry NICHT an (Crawler-/Sync-Vertrag). parent_wiki_key = Wahrheit; political_territory.
// parent_id bleibt abgeleiteter Cache. Siehe memory/wiki-crawler-rework-prep.md.

const AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE = 'wiki_crawl_queue';
const AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE = 'wiki_territory_model';
const AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE = 'wiki_redirect_alias';
const AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE = 'political_territory_wiki_test';
const AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE = 'wiki_sync_editor_state';
const AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE = 'political_territory_identity_backup';
const AVESMAPS_WIKI_SYNC_MONITOR_MAX_DEPTH = 5;

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

// ---------------------------------------------------------------------------
// Resumierbare Crawl-Engine (Commit A: Enumeration). Quellen ueber die
// MediaWiki-API (/de/api.php, avesmapsWikiSyncApiRequest): Kategorien via
// categorymembers (vollstaendig, DPL-unabhaengig), /Liste via parse-HTML.
// Seeds + entdeckte Member landen in wiki_crawl_queue (BFS, depth<=MAX_DEPTH).
// Das eigentliche Page-Parsing (Infobox/Affiliation/Wappen) folgt in Commit B.
// ---------------------------------------------------------------------------

const AVESMAPS_WIKI_SYNC_MONITOR_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_SYNC_MONITOR_BATCH_LIMIT = 40;
const AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME = 22;
const AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS = 250;
const AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT = 500;
const AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_MAX = 6000;

function avesmapsWikiSyncMonitorReadMaxDepth(array $options): int {
    return max(1, min(AVESMAPS_WIKI_SYNC_MONITOR_MAX_DEPTH, (int) ($options['max_depth'] ?? AVESMAPS_WIKI_SYNC_MONITOR_MAX_DEPTH)));
}

function avesmapsWikiSyncMonitorSleep(int $ms): void {
    if ($ms > 0) {
        usleep($ms * 1000);
    }
}

function avesmapsWikiSyncMonitorNormalizeTitle(string $title): string {
    $title = str_replace('_', ' ', trim($title));
    $title = preg_replace('/#.*$/u', '', $title) ?? $title;
    return trim($title);
}

function avesmapsWikiSyncMonitorClassifyRole(string $title): string {
    if (preg_match('/^(Kategorie|Category):/iu', $title) === 1) {
        return 'category';
    }
    if (preg_match('#/Liste$#u', $title) === 1) {
        return 'list';
    }

    return 'page';
}

function avesmapsWikiSyncMonitorIsRelevantTitle(string $title): bool {
    // '/' = Unterseite (…/Liste, …/Provinzhistorie, …/Ableitung) = kein Herrschaftsgebiet.
    if ($title === '' || str_contains($title, '#') || str_contains($title, '/')) {
        return false;
    }

    return preg_match(
        '/^(Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template|Benutzer|User|Diskussion|Talk|Portal|MediaWiki):/iu',
        $title
    ) !== 1;
}

function avesmapsWikiSyncMonitorPageUrl(string $title): string {
    return AVESMAPS_WIKI_SYNC_MONITOR_PAGE_BASE_URL
        . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', avesmapsWikiSyncMonitorNormalizeTitle($title))));
}

function avesmapsWikiSyncMonitorTitleFromHref(string $href): string {
    $href = trim($href);
    if (str_starts_with($href, '/wiki/')) {
        return avesmapsWikiSyncMonitorNormalizeTitle(rawurldecode(substr($href, 6)));
    }

    return '';
}

function avesmapsWikiSyncMonitorSeedsFromInput(mixed $value): array {
    if (is_array($value)) {
        return $value;
    }
    if (is_string($value) && trim($value) !== '') {
        return preg_split('/\R+/u', trim($value)) ?: [];
    }

    return [];
}

// INSERT IGNORE auf UNIQUE(run_id, dedup_key) = idempotentes Enqueue + Visited in einem.
function avesmapsWikiSyncMonitorEnqueue(PDO $pdo, string $runId, string $title, int $depth, string $role, string $source): int {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    if ($title === '') {
        return 0;
    }

    $dedupKey = avesmapsPoliticalSlug($title);
    if ($dedupKey === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'INSERT IGNORE INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . '
            (run_id, dedup_key, wiki_title, wiki_key, depth, role, source, status, created_at)
        VALUES (:run_id, :dedup_key, :wiki_title, :wiki_key, :depth, :role, :source, \'pending\', CURRENT_TIMESTAMP(3))'
    );
    $statement->execute([
        'run_id' => $runId,
        'dedup_key' => $dedupKey,
        'wiki_title' => mb_substr($title, 0, 255, 'UTF-8'),
        'wiki_key' => $role === 'page' ? $dedupKey : null,
        'depth' => $depth,
        'role' => $role,
        'source' => mb_substr($source, 0, 255, 'UTF-8'),
    ]);

    return $statement->rowCount();
}

function avesmapsWikiSyncMonitorStartRun(PDO $pdo, array $seeds, array $options = []): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $runId = avesmapsPoliticalUuidV4();
    $maxDepth = avesmapsWikiSyncMonitorReadMaxDepth($options);

    $seeded = 0;
    $byRole = ['category' => 0, 'list' => 0, 'page' => 0];
    foreach ($seeds as $seed) {
        $title = avesmapsWikiSyncMonitorNormalizeTitle((string) $seed);
        if ($title === '') {
            continue;
        }

        $role = avesmapsWikiSyncMonitorClassifyRole($title);
        $inserted = avesmapsWikiSyncMonitorEnqueue($pdo, $runId, $title, 0, $role, 'seed');
        if ($inserted > 0) {
            $seeded += $inserted;
            $byRole[$role] = ($byRole[$role] ?? 0) + $inserted;
        }
    }

    if ($seeded === 0) {
        throw new RuntimeException('Mindestens ein gueltiger Seed ist erforderlich.');
    }

    return [
        'ok' => true,
        'run_id' => $runId,
        'max_depth' => $maxDepth,
        'seeded' => $seeded,
        'seeded_by_role' => $byRole,
    ];
}

// Vollstaendige Member-Enumeration einer Kategorie ueber categorymembers (cmcontinue).
function avesmapsWikiSyncMonitorFetchCategoryMembers(string $categoryTitle): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($categoryTitle);
    if (preg_match('/^(Kategorie|Category):/iu', $title) !== 1) {
        $title = 'Kategorie:' . $title;
    }

    $members = [];
    $continue = null;
    $guard = 0;
    do {
        $params = [
            'action' => 'query',
            'list' => 'categorymembers',
            'cmtitle' => $title,
            'cmlimit' => (string) AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT,
            'cmtype' => 'page',
            'format' => 'json',
        ];
        if ($continue !== null) {
            $params['cmcontinue'] = $continue;
        }

        $data = avesmapsWikiSyncApiRequest($params);
        foreach (($data['query']['categorymembers'] ?? []) as $member) {
            $memberTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) ($member['title'] ?? ''));
            if ($memberTitle !== '' && avesmapsWikiSyncMonitorIsRelevantTitle($memberTitle)) {
                $members[avesmapsPoliticalSlug($memberTitle)] = $memberTitle;
            }
        }

        $continue = isset($data['continue']['cmcontinue']) ? (string) $data['continue']['cmcontinue'] : null;
        $guard++;
    } while ($continue !== null && $guard < 40 && count($members) < AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_MAX);

    return array_values($members);
}

// Links einer DPL-/Liste-Seite aus dem gerenderten HTML (action=parse).
function avesmapsWikiSyncMonitorFetchListLinks(string $listTitle): array {
    $html = avesmapsWikiSyncFetchParsedWikiHtml(avesmapsWikiSyncMonitorNormalizeTitle($listTitle));
    if (!class_exists(DOMDocument::class)) {
        return [];
    }

    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xpath = new DOMXPath($document);

    // Nur den ERSTEN gueltigen Link je Zeile/Listenpunkt nehmen (= die Namensspalte).
    // Sonst saugt man auch die verlinkten Spalten Hauptstadt/Herrschaftssitz ein (=Siedlungen,
    // keine Herrschaftsgebiete) und blaeht die Queue ~3x auf.
    $links = [];
    $addFirstLink = static function (DOMElement $scope) use (&$links, $xpath): void {
        foreach ($xpath->query('.//a[@href]', $scope) ?: [] as $anchor) {
            if (!$anchor instanceof DOMElement) {
                continue;
            }
            $title = avesmapsWikiSyncMonitorTitleFromHref((string) $anchor->getAttribute('href'));
            if ($title === '' || !avesmapsWikiSyncMonitorIsRelevantTitle($title) || preg_match('#/Liste$#u', $title) === 1) {
                continue;
            }
            $links[avesmapsPoliticalSlug($title)] = $title;

            return;
        }
    };

    foreach ($xpath->query('//div[contains(@class,"mw-parser-output")]//table//tr') ?: [] as $tableRow) {
        if (!$tableRow instanceof DOMElement) {
            continue;
        }
        $firstCell = $xpath->query('./td[1]', $tableRow)->item(0) ?? $xpath->query('./th[1]', $tableRow)->item(0);
        if ($firstCell instanceof DOMElement) {
            $addFirstLink($firstCell);
        }
    }

    foreach ($xpath->query('//div[contains(@class,"mw-parser-output")]//ul/li') ?: [] as $listItem) {
        if ($listItem instanceof DOMElement) {
            $addFirstLink($listItem);
        }
    }

    return array_values($links);
}

// Loest Anfrage-Titel auf ihren kanonischen Titel auf (normalized + redirects), damit
// derselbe Artikel ueber Redirect-Aliase ("Mittelreich") und Voll-Titel NICHT als zwei
// wiki_keys landet. Eine API-Abfrage je 40 Titel.
function avesmapsWikiSyncMonitorResolveCanonicalTitles(array $titles): array {
    $map = [];
    foreach (array_chunk(array_values($titles), 40) as $batch) {
        try {
            $data = avesmapsWikiSyncApiRequest([
                'action' => 'query',
                'redirects' => '1',
                'titles' => implode('|', $batch),
                'format' => 'json',
            ]);
        } catch (Throwable $error) {
            continue;
        }
        $query = $data['query'] ?? [];
        $normalized = [];
        foreach (($query['normalized'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $normalized[(string) $item['from']] = (string) $item['to'];
            }
        }
        $redirects = [];
        foreach (($query['redirects'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $redirects[(string) $item['from']] = (string) $item['to'];
            }
        }
        foreach ($batch as $title) {
            $step = $normalized[$title] ?? $title;
            $map[$title] = $redirects[$step] ?? $redirects[$title] ?? $step;
        }
    }

    return $map;
}

function avesmapsWikiSyncMonitorCrawlStep(PDO $pdo, string $runId, array $options = []): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }

    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $maxDepth = avesmapsWikiSyncMonitorReadMaxDepth($options);
    $batchLimit = max(1, min(200, (int) ($options['batch_limit'] ?? AVESMAPS_WIKI_SYNC_MONITOR_BATCH_LIMIT)));
    $stepRuntime = max(3, min(28, (int) ($options['step_runtime'] ?? AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    // Entrypoints (category/list, depth 0) zuerst, dann Pages nach Tiefe (BFS).
    $select = $pdo->prepare(
        'SELECT id, wiki_title, depth, role FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . '
        WHERE run_id = :run_id AND status = \'pending\'
        ORDER BY FIELD(role, \'category\', \'list\', \'page\'), depth ASC, id ASC
        LIMIT ' . $batchLimit
    );
    $select->execute(['run_id' => $runId]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $markDone = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . '
        SET status = :status, attempts = attempts + 1, error_text = :error_text, processed_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id'
    );

    $processed = 0;
    $discovered = 0;
    $stored = 0;
    $skipped = 0;
    $errors = 0;
    $events = [];
    $pageBatch = [];
    foreach ($rows as $row) {
        if ((microtime(true) - $startedAt) >= $stepRuntime) {
            break;
        }

        $id = (int) $row['id'];
        $title = (string) $row['wiki_title'];
        $depth = (int) $row['depth'];
        $role = (string) $row['role'];

        if ($role === 'page') {
            // Pages werden gesammelt und gebuendelt verarbeitet (1 API-Call je 20 Titel).
            $pageBatch[] = ['id' => $id, 'title' => $title, 'depth' => $depth];
            continue;
        }

        try {
            if ($role === 'category') {
                $members = avesmapsWikiSyncMonitorFetchCategoryMembers($title);
                if ($depth < $maxDepth) {
                    foreach ($members as $member) {
                        $discovered += avesmapsWikiSyncMonitorEnqueue($pdo, $runId, $member, $depth + 1, 'page', 'category:' . $title);
                    }
                }
                $events[] = ['type' => 'category', 'title' => $title, 'members' => count($members)];
                avesmapsWikiSyncMonitorSleep($sleepMs);
            } elseif ($role === 'list') {
                $links = avesmapsWikiSyncMonitorFetchListLinks($title);
                if ($depth < $maxDepth) {
                    foreach ($links as $link) {
                        $discovered += avesmapsWikiSyncMonitorEnqueue($pdo, $runId, $link, $depth + 1, 'page', 'list:' . $title);
                    }
                }
                $events[] = ['type' => 'list', 'title' => $title, 'links' => count($links)];
                avesmapsWikiSyncMonitorSleep($sleepMs);
            }

            $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
            $processed++;
        } catch (Throwable $error) {
            $errors++;
            $markDone->execute([
                'status' => 'error',
                'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'),
                'id' => $id,
            ]);
            $events[] = ['type' => 'error', 'title' => $title, 'message' => $error->getMessage()];
        }
    }

    if ($pageBatch !== []) {
        $titles = array_values(array_unique(array_map(static fn(array $p): string => (string) $p['title'], $pageBatch)));
        try {
            $contents = avesmapsWikiSyncFetchPoliticalTerritoryPageContents($titles);
        } catch (Throwable $error) {
            $contents = [];
            $events[] = ['type' => 'error', 'title' => '(batch)', 'message' => $error->getMessage()];
        }
        $canonical = avesmapsWikiSyncMonitorResolveCanonicalTitles($titles);

        foreach ($pageBatch as $page) {
            $id = (int) $page['id'];
            $title = (string) $page['title'];
            $depth = (int) $page['depth'];
            try {
                $content = (string) ($contents[$title] ?? '');
                if (trim($content) === '') {
                    $markDone->execute(['status' => 'done', 'error_text' => 'kein Wiki-Inhalt', 'id' => $id]);
                    $skipped++;
                    $processed++;
                    continue;
                }

                $canonicalTitle = (string) ($canonical[$title] ?? $title);
                $parsed = avesmapsWikiSyncMonitorParsePage($title, $content, $canonicalTitle);
                if (!empty($parsed['is_territory']) && is_array($parsed['record'] ?? null)) {
                    avesmapsWikiSyncMonitorUpsertTestRecord($pdo, $parsed['record']);
                    avesmapsWikiSyncMonitorStoreAlias($pdo, [$title, $canonicalTitle], (string) ($parsed['record']['wiki_key'] ?? ''));
                    $stored++;
                    if ($depth < $maxDepth) {
                        foreach (($parsed['parent_titles'] ?? []) as $parentTitle) {
                            $discovered += avesmapsWikiSyncMonitorEnqueue($pdo, $runId, $parentTitle, $depth + 1, 'page', 'affiliation:' . $title);
                        }
                    }
                    $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
                } else {
                    $skipped++;
                    $markDone->execute(['status' => 'done', 'error_text' => mb_substr((string) ($parsed['reason'] ?? 'kein Herrschaftsgebiet'), 0, 500, 'UTF-8'), 'id' => $id]);
                }
                $processed++;
            } catch (Throwable $error) {
                $errors++;
                $markDone->execute([
                    'status' => 'error',
                    'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'),
                    'id' => $id,
                ]);
                $events[] = ['type' => 'error', 'title' => $title, 'message' => $error->getMessage()];
            }
        }
        avesmapsWikiSyncMonitorSleep($sleepMs);
    }

    // Lizenz-Ermittlung ist Teil des Crawls: jede Runde enricht eine kleine Charge frisch
    // gespeicherter Wappen (File-Seite -> Lizenz/Urheber), bis nichts mehr offen ist.
    $licenses = ['by_status' => [], 'remaining' => 0];
    try {
        $licenses = avesmapsWikiSyncMonitorEnrichLicenses($pdo, ['batch_limit' => 15, 'sleep_ms' => $sleepMs, 'step_runtime' => 8]);
    } catch (Throwable $error) {
        $events[] = ['type' => 'error', 'title' => '(licenses)', 'message' => $error->getMessage()];
    }

    return [
        'ok' => true,
        'run_id' => $runId,
        'processed' => $processed,
        'discovered' => $discovered,
        'stored' => $stored,
        'skipped' => $skipped,
        'errors' => $errors,
        'licenses_remaining' => $licenses['remaining'] ?? 0,
        'runtime_seconds' => round(microtime(true) - $startedAt, 3),
        'events' => array_slice($events, 0, 60),
        'status' => avesmapsWikiSyncMonitorRunStatus($pdo, $runId),
    ];
}

function avesmapsWikiSyncMonitorRunStatus(PDO $pdo, string $runId): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }

    $statement = $pdo->prepare(
        'SELECT role, status, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . '
        WHERE run_id = :run_id GROUP BY role, status'
    );
    $statement->execute(['run_id' => $runId]);

    $byRole = [];
    $byStatus = [];
    $total = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $count = (int) $r['c'];
        $total += $count;
        $byRole[(string) $r['role']] = ($byRole[(string) $r['role']] ?? 0) + $count;
        $byStatus[(string) $r['status']] = ($byStatus[(string) $r['status']] ?? 0) + $count;
    }

    return [
        'ok' => true,
        'run_id' => $runId,
        'total' => $total,
        'by_role' => $byRole,
        'by_status' => $byStatus,
        'pending' => $byStatus['pending'] ?? 0,
        'done' => $byStatus['done'] ?? 0,
        'error' => $byStatus['error'] ?? 0,
    ];
}

// ---------------------------------------------------------------------------
// Commit B: Page-Parsing. Aus dem Infobox-Wikitext (echte Parameter Art/Staat/
// Region/Wappen) einen Wiki-Spiegel-Datensatz bauen und ins Staging (_test)
// upserten. Affiliation = Param `Staat` (politisch, = Elternkette) -> path/root +
// [[Links]] fuer Eltern-Rekursion + Konflikt-Hinweise. Eigenstaendige Stadtstaaten
// (Infobox Siedlung) werden mitgenommen (source_origin=siedlung).
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorFieldKey(string $key): string {
    $key = mb_strtolower(trim($key), 'UTF-8');
    $key = strtr($key, [
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss',
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'î' => 'i', 'í' => 'i', 'ô' => 'o', 'ó' => 'o', 'û' => 'u', 'ú' => 'u',
    ]);

    return preg_replace('/[^a-z0-9]+/u', '', $key) ?? '';
}

function avesmapsWikiSyncMonitorNormFields(array $fields): array {
    $norm = [];
    foreach ($fields as $key => $value) {
        $normalizedKey = avesmapsWikiSyncMonitorFieldKey((string) $key);
        if ($normalizedKey !== '' && !isset($norm[$normalizedKey])) {
            $norm[$normalizedKey] = (string) $value;
        }
    }

    return $norm;
}

function avesmapsWikiSyncMonitorField(array $norm, array $aliases): string {
    foreach ($aliases as $alias) {
        if (isset($norm[$alias]) && trim($norm[$alias]) !== '') {
            return $norm[$alias];
        }
    }

    return '';
}

function avesmapsWikiSyncMonitorInfoboxName(string $wikitext): string {
    if (preg_match('/\{\{\s*Infobox\s+([^\n|}]+)/u', $wikitext, $match) === 1) {
        return trim(preg_replace('/\s+/u', ' ', (string) $match[1]) ?? (string) $match[1]);
    }

    return '';
}

// Schneidet GENAU den Infobox-Template-Block per Klammer-Matching aus (nicht den ersten
// beliebigen Template-Block der Seite — grosse Artikel haben davor Wartungs-Templates).
// Byte-basiertes Matching ist sicher: {{ }} sind ASCII, kommen in UTF-8-Folgebytes nie vor.
function avesmapsWikiSyncMonitorExtractInfoboxBlock(string $wikitext): string {
    if (preg_match('/\{\{\s*Infobox\s+/u', $wikitext, $match, PREG_OFFSET_CAPTURE) !== 1) {
        return '';
    }

    $start = (int) $match[0][1];
    $length = strlen($wikitext);
    $depth = 0;
    for ($i = $start; $i < $length - 1; $i++) {
        $pair = substr($wikitext, $i, 2);
        if ($pair === '{{') {
            $depth++;
            $i++;
            continue;
        }
        if ($pair === '}}') {
            $depth--;
            $i++;
            if ($depth === 0) {
                return substr($wikitext, $start, ($i + 1) - $start);
            }
        }
    }

    return substr($wikitext, $start);
}

// Parst die |key=value-Parameter eines Template-Blocks tiefen-bewusst, sodass '|' innerhalb
// verschachtelter {{...}} keine Parameter zerschneidet.
function avesmapsWikiSyncMonitorParseTemplateParams(string $block): array {
    $params = [];
    $currentKey = null;
    $currentValue = '';
    $depth = 0;
    foreach (preg_split('/\R/u', $block) ?: [] as $line) {
        if ($depth === 0 && preg_match('/^\s*\|\s*([^=\n]+?)\s*=\s*(.*)$/u', $line, $match) === 1) {
            if ($currentKey !== null) {
                $params[$currentKey] = $currentValue;
            }
            $currentKey = trim((string) $match[1]);
            $currentValue = (string) $match[2];
        } elseif ($currentKey !== null) {
            $currentValue .= "\n" . $line;
        }

        $opens = (int) preg_match_all('/\{\{/u', $currentValue);
        $closes = (int) preg_match_all('/\}\}/u', $currentValue);
        $depth = max(0, $opens - $closes);
    }
    if ($currentKey !== null) {
        $params[$currentKey] = preg_replace('/\}\}\s*$/u', '', $currentValue) ?? $currentValue;
    }

    return $params;
}

// WICHTIG (Audit 2026-06-01): avesmapsWikiSyncCleanPoliticalTerritoryWikiValue strippt
// {{BF|177}}->"177" und {{Datum|Jahr|Monat|Tag}}->"Jahr Monat Tag" und entfernt damit den
// "BF"-Marker, BEVOR avesmapsWikiSyncBuildPoliticalTemporalPayload die Jahre extrahiert ->
// founded_start_bf wurde 0. Diese Funktion ueberfuehrt die Templates VOR dem Cleaning in
// "JAHR BF", sodass der Payload-Extractor wieder greift. (Vorlage:Datum = Jahr|Monat|Tag.)
function avesmapsWikiSyncMonitorTemporalText(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    // Negative (v.BF) Jahre KANONISCH als "N v. BF" ausgeben, NICHT "-N BF": der
    // Payload-Extractor erkennt nur "v. BF" als Vor-BF-Marker; ein fuehrendes Minus
    // wuerde sonst verschluckt (-870 BF -> faelschlich +870). DSA-Notation zugleich sauber.
    $value = preg_replace_callback('/\{\{\s*BF\s*\|\s*(-?\d{1,5})[^}]*\}\}/iu', static function (array $match): string {
        $year = (int) $match[1];
        return $year < 0 ? (abs($year) . ' v. BF') : ($year . ' BF');
    }, $value) ?? $value;
    $value = preg_replace_callback('/\{\{\s*Datum\s*\|([^}]*)\}\}/iu', static function (array $match): string {
        $parts = array_map('trim', explode('|', (string) $match[1]));
        $year = $parts[0] ?? '';
        if (preg_match('/^-?\d{1,5}$/', $year) !== 1) {
            return '';
        }
        $yearInt = (int) $year;
        return $yearInt < 0 ? (abs($yearInt) . ' v. BF') : ($yearInt . ' BF');
    }, $value) ?? $value;

    return avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
}

function avesmapsWikiSyncMonitorCoatOfArmsUrl(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    if (preg_match('/\{\{\s*(?:Boximage|Bild|Infoboxbild|Bildeinbindung)\s*\|\s*([^|}\n]+)/iu', $value, $match) === 1) {
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl(trim((string) $match[1]));
    }

    return avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl($value);
}

function avesmapsWikiSyncMonitorDetectContinent(string $context): string {
    $key = avesmapsWikiSyncMonitorFieldKey($context);
    // Ein EXPLIZITER Aventurien-Nav-Marker ({{Nav Staaten Aventurien}}) ist das stärkste, eindeutige
    // Signal und gewinnt VOR der losen Needle-Suche unten -- sonst kapert eine Streu-Erwähnung eines
    // anderen Kontinents die Klassifizierung. Konkreter Bug: "Wiedererstandenes Reich des Horas" trägt
    // {{Nav Staaten Aventurien}}, verweist aber via {{Abgeleitet|...}}/Interwiki auf "Horas (Myranor)"
    // -> wurde fälschlich als Uthuria/Myranor klassifiziert und damit überall (continent='Aventurien')
    // rausgefiltert. (Pendant-Marker anderer Kontinente, z.B. navstaatenmyranor, sind hiervon nicht
    // betroffen, da sie 'navstaatenaventurien' nicht enthalten.)
    if (str_contains($key, 'navstaatenaventurien')) {
        return defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT') ? AVESMAPS_POLITICAL_DEFAULT_CONTINENT : 'Aventurien';
    }
    $continents = [
        'Myranor / Güldenland' => ['myranor', 'guldenland', 'gueldenland', 'rastabor', 'vesayama'],
        'Rakshazar / Riesland' => ['rakshazar', 'riesland'],
        'Uthuria' => ['uthuria'],
        'Tharun' => ['tharun'],
        'Lahmaria' => ['lahmaria'],
        'Aventurien' => ['aventurien'],
    ];
    foreach ($continents as $continent => $needles) {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($key, $needle)) {
                return $continent;
            }
        }
    }

    return defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT') ? AVESMAPS_POLITICAL_DEFAULT_CONTINENT : 'Aventurien';
}

// Reine Qualifizierer-/Unabhaengigkeits-Klausel = KEIN Elternteil (umstritten, unabhaengig,
// vakant, ehemals, …). Wird beim Survey aller G/B als systematisches Muster bestaetigt.
function avesmapsWikiSyncMonitorIsQualifierOnly(string $text): bool {
    $key = avesmapsWikiSyncMonitorFieldKey($text);
    if ($key === '') {
        return true;
    }
    foreach ([
        'unabhangig', 'unabh', 'keine', 'unbekannt', 'ungeklart', 'umstritten', 'strittig',
        'vakant', 'niemand', 'souveran', 'eigenstandig', 'eigenstand', 'independent',
        'ehemals', 'ehemalig', 'fruher', 'vormals', 'zuvor', 'ehem',
        'reichsstadt', 'freiestadt', // Status-Marker, kein Eltern-Gebiet (z.B. [[Freie Stadt]])
    ] as $word) {
        if ($key === $word || str_starts_with($key, $word)) {
            return true;
        }
    }

    return false;
}

// Bereinigt ein einzelnes Ketten-Element: Klammer-Zusaetze weg + ERSTER Komma-Teil
// (Survey: der erste Komma-Teil ist immer der echte Name; nur 1/781 hatte ueberhaupt ein
// Komma ohne Qualifizierer, auch das loest korrekt auf).
function avesmapsWikiSyncMonitorCleanAffiliationPart(string $part): string {
    $part = trim(preg_replace('/\([^)]*\)/u', ' ', $part) ?? $part);
    if ($part !== '' && str_contains($part, ',')) {
        $first = trim((string) (explode(',', $part)[0] ?? ''));
        if ($first !== '') {
            $part = $first;
        }
    }

    return trim($part);
}

// (B) Konflikt-Müll: Template-Fragmente (wid|/ex|/evt|/no|, "|837 BF"), reine Datums-/Zahl-Angaben.
function avesmapsWikiSyncMonitorIsConflictJunk(string $value): bool {
    $value = trim($value);
    if ($value === '') {
        return true;
    }
    if (str_contains($value, '|')) {
        return true; // Template-Fragment ({{wid|…}}/{{ex|…}} etc.), das die Bereinigung nicht aufloeste
    }
    if (preg_match('/^(?:ex|wid|evt|no|nz|wd)\b/iu', $value) === 1) {
        return true; // Template-Name ohne Pipe
    }
    // reine Zeit-/Datumsangabe ("22 BF", "1028 BF", "1016-34 BF") ohne echten Namensteil
    $withoutDates = trim((string) preg_replace('/\b\d[\d\-–.\/\s]*(?:v\.?\s*)?BF\b/iu', '', $value));
    if (preg_match('/^\d/u', $value) === 1 || $withoutDates !== $value) {
        return preg_match('/[A-Za-zÄÖÜäöüß]{3,}/u', $withoutDates) !== 1;
    }
    return false;
}

// (C) Präfixe vor einem Anspruchsteller strippen (zuletzt/vermutlich/sowie/nach Aufloesung in/…)
// + ein nachgestelltes "beansprucht" ("zuletzt vom Moghulat Oron beansprucht" -> "Moghulat Oron").
function avesmapsWikiSyncMonitorStripClaimPrefix(string $value): string {
    $value = trim($value);
    $value = trim((string) preg_replace('/^\([^)]*\)\s*/u', '', $value)); // fuehrende Klammer ("(teilweise)") weg
    $prefix = '/^\s*(?:Gebiet\s+)?(?:nach\s+Aufl[oö]sung\s+(?:in\s+)?(?:de[rmsn]\s+)?|beansprucht\s+vo[nm]|teil\s+vo[nm]|teil\s+des|geh[oö]rt\s+zu|zuletzt(?:\s+vo[nm])?|vermutlich|zuvor|sowie|ehemal[a-zäöü]*|vormals|fr[uü]her)(?:\s+de[rmsn])?\s+/iu';
    for ($i = 0; $i < 2; $i += 1) { // bis zu 2x (z.B. "vermutlich zuvor X")
        $next = (string) preg_replace($prefix, '', $value);
        if ($next === $value) {
            break;
        }
        $value = trim($next);
    }
    $value = trim((string) preg_replace('/\s+beansprucht\s*$/iu', '', $value)); // nachgestelltes "beansprucht"
    return trim($value);
}

// (C/E) Eine Anspruchsteller-Klausel in einzelne Parteien zerlegen (Mehrfach-Ansprueche): an Komma/
// Semikolon/"sowie"/"und" trennen. Doppelpunkt-PFADE bleiben ganz (Hierarchie -> Leaf loest der Resolver).
function avesmapsWikiSyncMonitorSplitClaimants(string $value): array {
    $value = trim($value);
    if ($value === '') {
        return [];
    }
    $parts = preg_split('/\s*,\s*|\s*;\s*|\s+sowie\s+|\s+und\s+/iu', $value) ?: [$value];
    $out = [];
    foreach ($parts as $part) {
        $part = avesmapsWikiSyncMonitorStripClaimPrefix((string) $part);
        $part = trim((string) preg_replace('/\([^)]*\)/u', ' ', $part)); // Klammer-Zusaetze weg
        $part = trim($part, " \t\n\r\0\x0B.,;");
        if ($part === '' || avesmapsWikiSyncMonitorIsQualifierOnly($part) || avesmapsWikiSyncMonitorIsConflictJunk($part)) {
            continue;
        }
        $out[] = $part;
    }
    return $out;
}

// Parst den politischen Affiliation-String (Param `Staat`). Regel (Survey-validiert):
// In Klauseln auf ';' UND '/' trennen -> erste NICHT-reine-Qualifizierer-Klausel = primaere
// Eltern-Kette ('beansprucht von' davor abschneiden); auf ':'/'>' splitten; je Element
// Klammern weg + erster Komma-Teil. Rest-Klauseln = conflicts. [[Links]] = Eltern-Kandidaten.
function avesmapsWikiSyncMonitorParseAffiliation(string $staatRaw): array {
    $raw = trim($staatRaw);
    if ($raw === '') {
        return ['raw' => '', 'path' => [], 'root' => '', 'links' => [], 'conflicts' => [], 'independent' => false];
    }

    $links = [];
    if (preg_match_all('/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/u', $raw, $linkMatches) !== false) {
        foreach (($linkMatches[1] ?? []) as $linkTarget) {
            $linkTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $linkTarget);
            $linkKey = avesmapsWikiSyncMonitorFieldKey($linkTitle);
            if ($linkKey === 'freiestadt' || $linkKey === 'reichsstadt') {
                continue; // Status-Marker (z.B. [[Freie Stadt]]) ist kein Eltern-Gebiet
            }
            if ($linkTitle !== '' && avesmapsWikiSyncMonitorIsRelevantTitle($linkTitle)) {
                $links[avesmapsPoliticalSlug($linkTitle)] = $linkTitle;
            }
        }
    }

    $clean = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($raw);

    $conflicts = [];

    // (A) Parenthetische Ansprueche extrahieren, BEVOR die Klammern weggeputzt werden:
    //     "Sokramor (beansprucht von Mittelreich: … Reichsmark Osterfelde)" -> Osterfelde als Konflikt.
    //     Das ist die HAEUFIGSTE Form im Wiki (Grenzregionen) und wurde bisher komplett verschluckt.
    $clean = (string) preg_replace_callback('/\(([^()]*)\)/u', static function (array $matches) use (&$conflicts): string {
        $inner = trim((string) ($matches[1] ?? ''));
        if (preg_match('/beansprucht\s+vo[nm]\b\s*:?\s*(.+)$/iu', $inner, $claim) === 1) {
            foreach (avesmapsWikiSyncMonitorSplitClaimants((string) $claim[1]) as $claimant) {
                $conflicts[] = $claimant;
            }
        }
        return ' '; // Klammer-Inhalt aus dem Eltern-Pfad entfernen
    }, $clean);

    $clauses = array_values(array_filter(
        array_map('trim', preg_split('#\s*[;/]\s*#u', $clean) ?: []),
        static fn(string $clause): bool => $clause !== ''
    ));

    $primary = '';
    foreach ($clauses as $clause) {
        // Zeit-/Historik-Klausel ("bis ING 1021 BF …", "seit 1000 BF …") = KEIN aktueller Elternteil.
        if (preg_match('/^\s*(?:bis|seit)\s+/iu', $clause) === 1) {
            continue;
        }
        // Zusatz-Anspruchsliste ("sowie X und Y") ist IMMER Konflikt, nie Elternteil -- sonst wuerde sie
        // faelschlich zum primaeren Pfad, wenn (wie bei Malqis) kein unstrittiger Elternteil davor steht.
        if (preg_match('/^\s*sowie\b/iu', $clause) === 1) {
            foreach (avesmapsWikiSyncMonitorSplitClaimants($clause) as $claimant) {
                $conflicts[] = $claimant;
            }
            continue;
        }
        // (E) "beansprucht von" IRGENDWO in der Klausel (nicht nur am Anfang), inkl. ":"/Komma-Liste mit
        //     mehreren Parteien ("Gebiet (teilweise) beansprucht von: Almada, Horasreich, Kalifat" = Taifas).
        //     Der Text VOR "beansprucht von" ist ggf. der eigentliche Elternteil.
        if (preg_match('/^(.*?)\bbeansprucht\s+vo[nm]\b\s*:?\s*(.+)$/iu', $clause, $claim) === 1) {
            $before = avesmapsWikiSyncMonitorStripClaimPrefix(trim((string) $claim[1]));
            if ($primary === '' && $before !== '' && !avesmapsWikiSyncMonitorIsQualifierOnly($before)
                && preg_match('/^(?:Gebiet|teile?|teilweise)\s*$/iu', $before) !== 1) {
                $primary = $before;
            }
            foreach (avesmapsWikiSyncMonitorSplitClaimants((string) $claim[2]) as $claimant) {
                $conflicts[] = $claimant;
            }
            continue;
        }
        // (C) Praefixe strippen -> dahinter der eigentliche Elternteil bzw. konkurrierende Partei(en).
        $stripped = avesmapsWikiSyncMonitorStripClaimPrefix($clause);
        if ($stripped === '' || avesmapsWikiSyncMonitorIsQualifierOnly($stripped)) {
            continue; // reiner Status-/Zeit-Zusatz (umstritten, ehemalige Reichsstadt …)
        }
        if ($primary === '') {
            $primary = $stripped;
        } else {
            foreach (avesmapsWikiSyncMonitorSplitClaimants($stripped) as $claimant) {
                $conflicts[] = $claimant; // echte konkurrierende Eltern-Klausel(n)
            }
        }
    }

    $path = [];
    foreach (preg_split('/\s*(?::|>|»|›)\s*/u', $primary) ?: [] as $part) {
        $part = avesmapsWikiSyncMonitorCleanAffiliationPart($part);
        if ($part === '' || avesmapsWikiSyncMonitorIsQualifierOnly($part)) {
            continue;
        }
        $path[] = $part;
    }
    $path = array_values(array_unique($path));

    // (B) Konflikte final saeubern: Template-/Datums-Muell raus, Duplikate weg (case-insensitiv).
    $cleanConflicts = [];
    $seenConflict = [];
    foreach ($conflicts as $conflict) {
        $conflict = trim((string) $conflict);
        if ($conflict === '' || avesmapsWikiSyncMonitorIsConflictJunk($conflict) || avesmapsWikiSyncMonitorIsQualifierOnly($conflict)) {
            continue;
        }
        $key = mb_strtolower($conflict);
        if (isset($seenConflict[$key])) {
            continue;
        }
        $seenConflict[$key] = true;
        $cleanConflicts[] = $conflict;
    }

    return [
        'raw' => $clean,
        'path' => $path,
        'root' => $path[0] ?? '',
        'links' => array_values($links),
        'conflicts' => $cleanConflicts,
        'independent' => $path === [],
    ];
}

function avesmapsWikiSyncMonitorParsePage(string $title, string $wikitext, string $canonicalTitle = ''): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infobox = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infobox);
    $fields = avesmapsWikiSyncMonitorParseTemplateParams(avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext));
    $norm = avesmapsWikiSyncMonitorNormFields($fields);

    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, $aliases));

    $affiliation = avesmapsWikiSyncMonitorParseAffiliation(
        avesmapsWikiSyncMonitorField($norm, ['staat', 'staatpolitisch', 'zugehorigkeitpolitisch', 'politischezugehorigkeit', 'politisch'])
    );
    $statusText = $field(['status']);

    $isTerritoryInfobox = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'staat')
        || str_contains($infoboxKey, 'herrschaftsgebiet')
        || str_contains($infoboxKey, 'reich')
    );
    $isSettlementInfobox = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'siedlung')
        || str_contains($infoboxKey, 'stadt')
        || str_contains($infoboxKey, 'ort')
    );

    if ($isTerritoryInfobox) {
        $sourceOrigin = 'staat';
    } elseif ($isSettlementInfobox) {
        // Siedlung nur als Herrschaftsgebiet behalten, wenn (a) Reichsstadt-Marker (aktiv ODER
        // ex, z.B. {{Reichsstadt|ex|..}}), (b) Freie-Stadt-Marker (z.B. [[Freie Stadt]] in der
        // Staat-Kette, wie Havena) ODER (c) eigenstaendig/Stadtstaat. Sonst = reine Siedlung
        // (z.B. Nivesel) -> raus. (Nutzer-Regel.)
        $staatRaw = avesmapsWikiSyncMonitorField($norm, ['staat', 'staatpolitisch', 'zugehorigkeitpolitisch', 'politischezugehorigkeit', 'politisch']);
        $isReichsstadt = preg_match('/\{\{\s*Reichsstadt\b/iu', $staatRaw) === 1
            || str_contains(avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $infobox), 'reichsstadt');
        $isFreieStadt = preg_match('/\bFreie\s+Stadt\b/iu', $staatRaw) === 1
            || str_contains(avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $infobox), 'freiestadt');
        $independenceKey = avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $affiliation['raw']);
        $independentSettlement = $affiliation['independent']
            || str_contains($independenceKey, 'stadtstaat')
            || str_contains($independenceKey, 'eigenstand')
            || str_contains($independenceKey, 'unabh')
            || str_contains($independenceKey, 'souveran');
        if (!$isReichsstadt && !$isFreieStadt && !$independentSettlement) {
            return [
                'is_territory' => false,
                'reason' => 'Infobox ' . ($infobox !== '' ? $infobox : '?') . ' (reine Siedlung)',
                'record' => null,
                'parent_titles' => [],
                'source_origin' => 'siedlung',
            ];
        }
        $sourceOrigin = $isReichsstadt ? 'reichsstadt' : ($isFreieStadt ? 'freiestadt' : 'siedlung');
    } else {
        return [
            'is_territory' => false,
            'reason' => $infobox === '' ? 'kein Infobox' : ('Infobox ' . $infobox),
            'record' => null,
            'parent_titles' => [],
            'source_origin' => 'andere',
        ];
    }

    $name = $field(['name']);
    if ($name === '') {
        $name = $canonical;
    }
    $continent = $field(['kontinent']);
    if ($continent === '') {
        // Kontinent-Marker stehen meist NICHT in der Infobox, sondern als Nav-/Marker-Template
        // oben auf der Seite (z.B. {{Nav Staaten Myranor}}, {{Aventurien}}). Diese Hinweise in den
        // Erkennungs-Kontext geben, sonst faellt alles ohne Region-Feld auf Aventurien (Default).
        $navHints = '';
        if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
            $navHints = implode(' ', $navMatches[1]);
        }
        $continent = avesmapsWikiSyncMonitorDetectContinent(
            $title . ' ' . avesmapsWikiSyncMonitorField($norm, ['region', 'geographisch']) . ' ' . $affiliation['raw'] . ' ' . $navHints
        );
    }

    $german = [
        'Name' => $name,
        'Typ' => $field(['art', 'typ', 'herrschaftsgebiet', 'staatsform']),
        'Kontinent' => $continent,
        'Zugehörigkeit' => $affiliation['raw'],
        'Zugehörigkeit-Root' => $affiliation['root'],
        'Zugehörigkeit-Pfad' => implode(' > ', $affiliation['path']),
        'Zugehörigkeit-JSON' => ['path' => $affiliation['path'], 'source' => 'wiki-sync-monitor', 'source_field' => 'Staat'],
        'Status' => $statusText,
        'Herrschaftsform' => $field(['herrschaftsform']),
        'Hauptstadt' => $field(['hauptstadt']),
        'Herrschaftssitz' => $field(['herrschaftssitz']),
        'Oberhaupt' => $field(['oberhaupt']),
        'Sprache' => $field(['sprache']),
        'Währung' => $field(['wahrung', 'wahrungen']),
        'Handelswaren' => $field(['handelswaren']),
        'Einwohnerzahl' => $field(['einwohnerzahl', 'einwohner']),
        'Gründer' => $field(['grunder']),
        'Gründungsdatum' => avesmapsWikiSyncMonitorTemporalText(avesmapsWikiSyncMonitorField($norm, ['grundungsdatum', 'grundung', 'gegrundet', 'unabhangigkeit', 'entstehung'])),
        'Aufgelöst' => avesmapsWikiSyncMonitorTemporalText(avesmapsWikiSyncMonitorField($norm, ['aufgelost', 'auflosung', 'besetzt', 'untergang', 'ende'])),
        'Geographisch' => $field(['region', 'geographisch']),
        'Blasonierung' => $field(['blasonierung']),
        'Wiki-Link' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'Wappen-Link' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['wappen', 'wappenbild', 'wappendatei', 'wappenbilddatei'])),
    ];

    $record = avesmapsPoliticalNormalizeWikiRecord($german);

    $temporal = avesmapsWikiSyncBuildPoliticalTemporalPayload((string) $record['founded_text'], (string) $record['dissolved_text']);
    $record['founded_text'] = (string) $temporal['founded_text'];
    $record['founded_type'] = (string) $temporal['founded_type'];
    $record['founded_start_bf'] = (int) $temporal['founded_start_bf'];
    $record['founded_end_bf'] = (int) $temporal['founded_end_bf'];
    $record['founded_display_bf'] = (float) $temporal['founded_display_bf'];
    $record['dissolved_text'] = (string) $temporal['dissolved_text'];
    $record['dissolved_type'] = (string) $temporal['dissolved_type'];
    $record['dissolved_start_bf'] = (int) $temporal['dissolved_start_bf'];
    $record['dissolved_end_bf'] = (int) $temporal['dissolved_end_bf'];
    $record['dissolved_display_bf'] = (float) $temporal['dissolved_display_bf'];
    $record['affiliation_root'] = $affiliation['root'];
    $record['affiliation_path_json'] = $affiliation['path'];
    $record['raw_json'] = [
        'source' => 'wiki-sync-monitor',
        'infobox' => $infobox,
        'source_origin' => $sourceOrigin,
        'affiliation' => $affiliation,
    ];

    return [
        'is_territory' => true,
        'reason' => '',
        'record' => $record,
        'parent_titles' => $affiliation['links'],
        'source_origin' => $sourceOrigin,
    ];
}

function avesmapsWikiSyncMonitorStagingColumns(PDO $pdo): array {
    static $columns = null;
    if ($columns !== null) {
        return $columns;
    }

    $columns = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE) ?: [] as $row) {
        $field = (string) ($row['Field'] ?? '');
        if ($field !== '') {
            $columns[$field] = true;
        }
    }

    return $columns;
}

// ---------------------------------------------------------------------------
// Phase 2: Modell-Ableitung. Baut das Hierarchie-Modell (wiki_territory_model)
// aus dem Staging. parent_wiki_key = letztes Pfad-Element, gegen die vorhandenen
// Staging-wiki_keys aufgeloest. parent_locked schuetzt Editor-Korrekturen vor
// Re-Ableitung (auto_parent_wiki_key wird trotzdem aktualisiert = Divergenz-Hinweis).
// Schreibt NUR in die Sandbox-Tabelle; political_territory bleibt unberuehrt.
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorStoreAlias(PDO $pdo, array $titles, string $wikiKey): void {
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return;
    }
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE . ' (alias_slug, canonical_wiki_key, updated_at)
        VALUES (:alias, :wiki_key, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE canonical_wiki_key = VALUES(canonical_wiki_key), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $seen = [];
    foreach ($titles as $title) {
        $slug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle((string) $title));
        if ($slug === '' || isset($seen[$slug])) {
            continue;
        }
        $seen[$slug] = true;
        $statement->execute(['alias' => $slug, 'wiki_key' => $wikiKey]);
    }
}

function avesmapsWikiSyncMonitorReadAliasMap(PDO $pdo): array {
    $map = [];
    foreach ($pdo->query('SELECT alias_slug, canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE) ?: [] as $row) {
        $map[(string) $row['alias_slug']] = (string) $row['canonical_wiki_key'];
    }

    return $map;
}

// Loest einen Eltern-Namen/Klausel gegen Alias-Karte + Slug-Index der Staging-Knoten auf.
// Nimmt das letzte ':'-Segment (Kette), Klammer-Zusaetze + Komma-Zusatz weg. Alias gewinnt
// (Redirect -> kanonischer Knoten), dann der Knoten-Index.
function avesmapsWikiSyncMonitorResolveParentKey(string $name, array $index, array $aliasMap = [], array $candidates = [], array $chainSlugs = []): array {
    $segments = preg_split('/\s*:\s*/u', $name) ?: [$name];
    $name = avesmapsWikiSyncMonitorCleanAffiliationPart((string) end($segments));
    $slug = avesmapsPoliticalSlug($name);
    if ($slug === '') {
        return ['name' => $name, 'wiki_key' => null, 'resolved' => false];
    }
    if (isset($aliasMap[$slug])) {
        // Alias -> kanonischer wiki_key (sofern der kanonische Knoten existiert).
        $canonicalSlug = preg_replace('/^wiki:/', '', $aliasMap[$slug]) ?? $aliasMap[$slug];
        if (isset($index[$canonicalSlug])) {
            return ['name' => $name, 'wiki_key' => $index[$canonicalSlug], 'resolved' => true];
        }
    }
    // Disambiguierung: teilen sich mehrere Knoten den Namens-Slug (z.B. "Herzogtum Tobrien
    // (Mittelreich)" vs "(Bosparanisches Reich)"), den waehlen, dessen Titel-Qualifier in der
    // Affiliation-Kette vorkommt (z.B. Wurzel "Mittelreich"). Sonst arbitraerer First-Win.
    if ($chainSlugs !== [] && isset($candidates[$slug]) && count($candidates[$slug]) > 1) {
        foreach ($candidates[$slug] as $candKey) {
            $candSlug = preg_replace('/^wiki:/', '', $candKey) ?? $candKey;
            $qualifier = str_starts_with($candSlug, $slug) ? substr($candSlug, strlen($slug)) : $candSlug;
            foreach ($chainSlugs as $ancestorSlug) {
                if (strlen($ancestorSlug) >= 4 && str_contains($qualifier, $ancestorSlug)) {
                    return ['name' => $name, 'wiki_key' => $candKey, 'resolved' => true];
                }
            }
        }
    }
    if (isset($index[$slug])) {
        return ['name' => $name, 'wiki_key' => $index[$slug], 'resolved' => true];
    }

    return ['name' => $name, 'wiki_key' => 'wiki:' . $slug, 'resolved' => false];
}

function avesmapsWikiSyncMonitorRebuildModel(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $rows = $pdo->query(
        'SELECT wiki_key, name, affiliation_path_json, raw_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC);

    // Slug-Index: Namens-Slug UND wiki_key-Slug -> wiki_key (deckt Page-Titel + Anzeigename ab).
    $index = [];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $nameSlug = avesmapsPoliticalSlug((string) ($row['name'] ?? ''));
        if ($nameSlug !== '' && !isset($index[$nameSlug])) {
            $index[$nameSlug] = $wikiKey;
        }
        $keySlug = preg_replace('/^wiki:/', '', $wikiKey) ?? $wikiKey;
        if ($keySlug !== '' && !isset($index[$keySlug])) {
            $index[$keySlug] = $wikiKey;
        }
    }

    // Namens-Slug -> ALLE Knoten mit dem Namen (fuer Disambiguierung gleichnamiger Zwillinge).
    $candidates = [];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        $nameSlug = avesmapsPoliticalSlug((string) ($row['name'] ?? ''));
        if ($wikiKey !== '' && $nameSlug !== '') {
            $candidates[$nameSlug][] = $wikiKey;
        }
    }

    $aliasMap = avesmapsWikiSyncMonitorReadAliasMap($pdo);

    $upsert = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, auto_parent_wiki_key, parent_conflict_json, source_origin, created_at, updated_at)
        VALUES (:wiki_key, :parent, :auto, :conflict, :origin, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            auto_parent_wiki_key = VALUES(auto_parent_wiki_key),
            parent_conflict_json = VALUES(parent_conflict_json),
            source_origin = VALUES(source_origin),
            parent_wiki_key = IF(parent_locked = 1, parent_wiki_key, VALUES(parent_wiki_key)),
            updated_at = CURRENT_TIMESTAMP(3)'
    );

    $summary = ['total' => 0, 'roots' => 0, 'resolved_parents' => 0, 'gap_parents' => 0, 'with_conflicts' => 0];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $summary['total']++;

        $path = json_decode((string) ($row['affiliation_path_json'] ?? ''), true);
        if (!is_array($path)) {
            $path = [];
        }
        $raw = json_decode((string) ($row['raw_json'] ?? ''), true);
        if (!is_array($raw)) {
            $raw = [];
        }
        $affiliation = is_array($raw['affiliation'] ?? null) ? $raw['affiliation'] : [];
        $origin = (string) ($raw['source_origin'] ?? '');
        $conflictsRaw = is_array($affiliation['conflicts'] ?? null) ? $affiliation['conflicts'] : [];

        $autoParent = null;
        if ($path !== []) {
            // Vorfahren-Slugs (alle Ketten-Glieder VOR dem direkten Elternteil) als Disambiguierungs-Kontext.
            $chainSlugs = [];
            for ($pi = 0; $pi < count($path) - 1; $pi++) {
                $aSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorCleanAffiliationPart((string) $path[$pi]));
                if ($aSlug !== '') {
                    $chainSlugs[] = $aSlug;
                }
            }
            $resolved = avesmapsWikiSyncMonitorResolveParentKey((string) $path[count($path) - 1], $index, $aliasMap, $candidates, $chainSlugs);
            $autoParent = $resolved['wiki_key'];
            if ($autoParent === $wikiKey) {
                $autoParent = null;
                $summary['roots']++;
            } elseif ($resolved['resolved']) {
                $summary['resolved_parents']++;
            } else {
                $summary['gap_parents']++;
            }
        } else {
            $summary['roots']++;
        }

        $conflictKeys = [];
        foreach ($conflictsRaw as $conflict) {
            if (avesmapsWikiSyncMonitorIsQualifierOnly((string) $conflict)) {
                continue; // Status-/Zeit-Zusatz aus Alt-Crawl-Daten -> kein echter Konflikt
            }
            $resolved = avesmapsWikiSyncMonitorResolveParentKey((string) $conflict, $index, $aliasMap);
            $conflictKeys[] = ['name' => $resolved['name'], 'wiki_key' => $resolved['wiki_key'], 'resolved' => $resolved['resolved']];
        }
        if ($conflictKeys !== []) {
            $summary['with_conflicts']++;
        }

        $upsert->execute([
            'wiki_key' => $wikiKey,
            'parent' => $autoParent,
            'auto' => $autoParent,
            'conflict' => $conflictKeys === [] ? null : json_encode($conflictKeys, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'origin' => $origin === '' ? null : $origin,
        ]);
    }

    return ['ok' => true, 'summary' => $summary];
}

// Read-only: schlaegt political_territory-Zeilen per wiki_key ODER Name nach.
// Liefert id, wiki_key, name, parent (id+name), Geometrie ja/nein. Fuer Diagnose
// (Rommilys-Cluster, blockierte Hierarchie-Korrekturen). Schreibt NICHTS.
function avesmapsWikiSyncMonitorTerritoryLookup(PDO $pdo, array $wikiKeys, array $names): array {
    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    $names = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $names), static fn(string $v): bool => $v !== ''));

    $clauses = [];
    $params = [];
    if ($wikiKeys !== []) {
        $clauses[] = 't.wiki_key IN (' . implode(',', array_fill(0, count($wikiKeys), '?')) . ')';
        $params = array_merge($params, $wikiKeys);
    }
    if ($names !== []) {
        $clauses[] = 't.name IN (' . implode(',', array_fill(0, count($names), '?')) . ')';
        $params = array_merge($params, $names);
    }
    if ($clauses === []) {
        return ['ok' => true, 'items' => []];
    }

    $sql = 'SELECT t.id, t.public_id, t.wiki_key, t.name, t.slug, t.is_active, t.parent_id,
            par.name AS parent_name, par.wiki_key AS parent_wiki_key,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE (' . implode(' OR ', $clauses) . ')
        ORDER BY t.name';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return ['ok' => true, 'items' => $statement->fetchAll(PDO::FETCH_ASSOC)];
}

// Read-only: Fuzzy-Suche in political_territory (name LIKE %q%). Fuer die Frage,
// ob ein Modell-Parent unter abweichendem Namen schon als Live-Territorium existiert.
function avesmapsWikiSyncMonitorTerritorySearch(PDO $pdo, string $query, int $limit): array {
    $query = trim($query);
    if ($query === '') {
        return ['ok' => true, 'query' => '', 'items' => []];
    }
    $limit = max(1, min(100, $limit));
    $statement = $pdo->prepare(
        'SELECT t.id, t.public_id, t.wiki_key, t.name, t.is_active, t.parent_id,
            par.name AS parent_name, par.wiki_key AS parent_wiki_key,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE t.name LIKE ?
        ORDER BY t.is_active DESC, t.name
        LIMIT ' . $limit
    );
    $statement->execute(['%' . $query . '%']);

    return ['ok' => true, 'query' => $query, 'items' => $statement->fetchAll(PDO::FETCH_ASSOC)];
}

// Read-only: schlaegt eine Geometrie per id ODER public_id nach -> an welchem
// Territorium haengt sie (territory_id + name + wiki_key), is_active, Quelle/Typ.
function avesmapsWikiSyncMonitorGeometryLookup(PDO $pdo, string $geometryId, string $publicId, array $territoryIds = []): array {
    $geometryId = trim($geometryId);
    $publicId = trim($publicId);
    $clauses = [];
    $params = [];
    if ($geometryId !== '' && ctype_digit($geometryId)) {
        $clauses[] = 'g.id = ?';
        $params[] = (int) $geometryId;
    }
    if ($publicId !== '') {
        $clauses[] = 'g.public_id = ?';
        $params[] = $publicId;
    }
    $territoryIds = array_values(array_filter(array_map('intval', $territoryIds), static fn(int $v): bool => $v > 0));
    if ($territoryIds !== []) {
        $clauses[] = 'g.territory_id IN (' . implode(',', array_fill(0, count($territoryIds), '?')) . ')';
        $params = array_merge($params, $territoryIds);
    }
    if ($clauses === []) {
        return ['ok' => true, 'items' => []];
    }

    $sql = 'SELECT g.id, g.public_id, g.territory_id, g.is_active, g.geometry_geojson,
            t.name AS territory_name, t.wiki_key AS territory_wiki_key, t.is_active AS territory_active,
            par.name AS territory_parent_name
        FROM political_territory_geometry g
        LEFT JOIN political_territory t ON t.id = g.territory_id
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE (' . implode(' OR ', $clauses) . ')
        ORDER BY g.is_active DESC, g.id';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        // Form-Signatur (BBox gerundet + Punktzahl) zum Vergleich, OHNE die volle Geometrie auszuliefern.
        $geo = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        unset($row['geometry_geojson']);
        $collect = static function (mixed $polygon): array {
            $out = [];
            foreach ((array) $polygon as $ring) {
                if (!is_array($ring)) {
                    continue;
                }
                foreach ($ring as $point) {
                    if (is_array($point) && count($point) >= 2) {
                        $out[] = [(float) $point[0], (float) $point[1]];
                    }
                }
            }
            return $out;
        };
        $points = [];
        if (is_array($geo)) {
            if (($geo['type'] ?? '') === 'Polygon') {
                $points = $collect($geo['coordinates'] ?? null);
            } elseif (($geo['type'] ?? '') === 'MultiPolygon') {
                foreach ((array) ($geo['coordinates'] ?? []) as $poly) {
                    $points = array_merge($points, $collect($poly));
                }
            }
        }
        if ($points !== []) {
            $lngs = array_column($points, 0);
            $lats = array_column($points, 1);
            $row['point_count'] = count($points);
            $row['bbox'] = [
                'min_lng' => round(min($lngs), 4),
                'min_lat' => round(min($lats), 4),
                'max_lng' => round(max($lngs), 4),
                'max_lat' => round(max($lats), 4),
            ];
        } else {
            $row['point_count'] = 0;
            $row['bbox'] = null;
        }
        $items[] = $row;
    }

    return ['ok' => true, 'items' => $items];
}

// "Ewiger Papierkorb" (nur neuer Modell-Editor): schaltet political_territory.is_active
// per wiki_key um (trashed=true -> 0, false -> 1) und spiegelt das Modell-`excluded`-Flag.
// Voll reversibel: Layer-Query verlangt territory.is_active=1, d.h. ein inaktives
// Territorium blendet automatisch alle eigenen Geometrien aus; Restore bringt sie zurueck
// (Geometrie-is_active bleibt unberuehrt). Gated: Schreiben nur bei dry_run:false UND
// confirm:"apply". Verweigert das Wegwerfen, wenn aktive Unterknoten dranhaengen (Waisenschutz).
function avesmapsWikiSyncMonitorSetTerritoryTrashed(PDO $pdo, string $wikiKey, bool $trashed, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }

    $stmt = $pdo->prepare(
        'SELECT t.id, t.public_id, t.name, t.is_active, t.parent_id, par.name AS parent_name,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry,
            (SELECT COUNT(*) FROM political_territory c WHERE c.parent_id = t.id AND c.is_active = 1) AS active_children
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE t.wiki_key = ?
        ORDER BY t.is_active DESC, t.id
        LIMIT 1'
    );
    $stmt->execute([$wikiKey]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['ok' => false, 'error' => 'Kein political_territory mit wiki_key ' . $wikiKey . '.'];
    }

    $targetActive = $trashed ? 0 : 1;
    $activeChildren = (int) ($row['active_children'] ?? 0);
    $result = [
        'ok' => true,
        'dry_run' => $dryRun,
        'wiki_key' => $wikiKey,
        'trashed' => $trashed,
        'territory' => [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'public_id' => $row['public_id'],
            'parent_name' => $row['parent_name'],
            'was_active' => (int) $row['is_active'],
            'will_be_active' => $targetActive,
            'has_geometry' => (int) $row['has_geometry'],
            'active_children' => $activeChildren,
        ],
        'applied' => false,
        'model_excluded_rows' => 0,
    ];

    // Waisenschutz: ein Knoten mit aktiven Kindern darf nicht in den Papierkorb.
    if ($trashed && $activeChildren > 0) {
        $result['ok'] = false;
        $result['error'] = 'Territorium hat ' . $activeChildren . ' aktive Unterknoten - erst diese verschieben oder aussortieren.';
        return $result;
    }

    if (!$dryRun) {
        $pdo->prepare('UPDATE political_territory SET is_active = ? WHERE id = ?')
            ->execute([$targetActive, (int) $row['id']]);
        // Modell-Flag spiegeln (kein Treffer, wenn der Knoten gar nicht im Modell ist -> ok).
        $modelStmt = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' SET excluded = ? WHERE wiki_key = ?');
        $modelStmt->execute([$trashed ? 1 : 0, $wikiKey]);
        $result['applied'] = true;
        $result['model_excluded_rows'] = $modelStmt->rowCount();
    }

    return $result;
}

// Phase 2b: Sync parent_wiki_key (Modell) -> political_territory.parent_id-CACHE.
// Semantik: NUR auffuellen (child.parent_id IS NULL), bestehende parent_id NIE ueberschreiben
// (korrigierte Hierarchie bleibt). Divergenzen werden nur gemeldet. dry_run=true schreibt NICHT.
// ACHTUNG: einziger Pfad, der political_territory schreibt -> nur mit explizitem Nutzer-OK apply.
function avesmapsWikiSyncMonitorSyncParentCache(PDO $pdo, bool $dryRun = true): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $base = ' FROM political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id
        WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL';

    $count = static fn(string $where): int => (int) ($pdo->query('SELECT COUNT(*)' . $base . $where)->fetchColumn() ?: 0);
    $fillable = $count(' AND child.parent_id IS NULL');
    $divergent = $count(' AND child.parent_id IS NOT NULL AND child.parent_id <> parent.id');
    $aligned = $count(' AND child.parent_id = parent.id');

    $sampleFill = $pdo->query('SELECT child.name AS child, parent.name AS parent' . $base . ' AND child.parent_id IS NULL ORDER BY child.name LIMIT 15')->fetchAll(PDO::FETCH_ASSOC);
    $sampleDivergent = $pdo->query('SELECT child.name AS child, parent.name AS model_parent' . $base . ' AND child.parent_id IS NOT NULL AND child.parent_id <> parent.id ORDER BY child.name LIMIT 15')->fetchAll(PDO::FETCH_ASSOC);

    $applied = 0;
    if (!$dryRun) {
        $statement = $pdo->prepare(
            'UPDATE political_territory child
            JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
            JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id
            SET child.parent_id = parent.id
            WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL AND child.parent_id IS NULL'
        );
        $statement->execute();
        $applied = $statement->rowCount();
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'fillable' => $fillable,
        'divergent_existing' => $divergent,
        'already_aligned' => $aligned,
        'applied' => $applied,
        'sample_fill' => $sampleFill,
        'sample_divergent' => $sampleDivergent,
    ];
}

// ---------------------------------------------------------------------------
// Phase 3: Diff/Report + Modell-Editieren (Drag'n'drop-Backend) + Sandbox-Clear.
// ---------------------------------------------------------------------------

// Diff Staging (neuer Crawl) vs political_territory_wiki (aktueller Spiegel) je wiki_key:
// neu / verschwunden / geaendert. = der Promotion-Vorschau-Report.
function avesmapsWikiSyncMonitorDiff(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $wiki = 'political_territory_wiki';

    $changedWhere = "COALESCE(s.name,'') <> COALESCE(w.name,'')
        OR COALESCE(s.type,'') <> COALESCE(w.type,'')
        OR COALESCE(s.affiliation_root,'') <> COALESCE(w.affiliation_root,'')
        OR COALESCE(s.affiliation_path_json,'') <> COALESCE(w.affiliation_path_json,'')";

    $new = (int) ($pdo->query("SELECT COUNT(*) FROM $staging s LEFT JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE w.wiki_key IS NULL")->fetchColumn() ?: 0);
    $disappeared = (int) ($pdo->query("SELECT COUNT(*) FROM $wiki w LEFT JOIN $staging s ON s.wiki_key = w.wiki_key WHERE s.wiki_key IS NULL")->fetchColumn() ?: 0);
    $changed = (int) ($pdo->query("SELECT COUNT(*) FROM $staging s JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE $changedWhere")->fetchColumn() ?: 0);

    $sampleNew = $pdo->query("SELECT s.wiki_key, s.name, s.type FROM $staging s LEFT JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE w.wiki_key IS NULL ORDER BY s.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
    $sampleGone = $pdo->query("SELECT w.wiki_key, w.name, w.type FROM $wiki w LEFT JOIN $staging s ON s.wiki_key = w.wiki_key WHERE s.wiki_key IS NULL ORDER BY w.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
    $sampleChanged = $pdo->query("SELECT s.wiki_key, s.name, w.affiliation_root AS old_root, s.affiliation_root AS new_root FROM $staging s JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE $changedWhere ORDER BY s.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);

    return [
        'ok' => true,
        'new' => $new,
        'disappeared' => $disappeared,
        'changed' => $changed,
        'sample_new' => $sampleNew,
        'sample_disappeared' => $sampleGone,
        'sample_changed' => $sampleChanged,
    ];
}

// Hierarchie-Diff: Modell-Eltern (wiki_territory_model.parent_wiki_key) vs. LIVE-Hierarchie
// (political_territory.parent_id, ueber wiki_key aufgeloest). Zeigt, was sich aendern WUERDE
// (rein lesend), inkl. Blattknoten mit Geometrie, die im Modell fehlen. Aendert NICHTS.
function avesmapsWikiSyncMonitorHierarchyDiff(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $territories = $pdo->query(
        'SELECT id, wiki_key, name, parent_id FROM political_territory WHERE is_active = 1'
    )->fetchAll(PDO::FETCH_ASSOC);

    $byId = [];
    foreach ($territories as $t) {
        $byId[(int) $t['id']] = $t;
    }

    $hasGeometry = [];
    foreach ($pdo->query('SELECT DISTINCT territory_id FROM political_territory_geometry WHERE is_active = 1 AND territory_id IS NOT NULL') ?: [] as $g) {
        $hasGeometry[(int) $g['territory_id']] = true;
    }

    $model = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $m) {
        $model[(string) $m['wiki_key']] = $m['parent_wiki_key'] !== null ? (string) $m['parent_wiki_key'] : null;
    }

    $stagingName = [];
    foreach ($pdo->query('SELECT wiki_key, name FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE) ?: [] as $s) {
        $stagingName[(string) $s['wiki_key']] = (string) $s['name'];
    }
    $nameOf = static function (?string $wikiKey) use ($byId, $stagingName): string {
        if ($wikiKey === null || $wikiKey === '') {
            return '(keiner)';
        }
        foreach ($byId as $row) {
            if ((string) $row['wiki_key'] === $wikiKey) {
                return (string) $row['name'];
            }
        }
        return $stagingName[$wikiKey] ?? $wikiKey;
    };

    $changed = [];
    $missingWithGeometry = [];
    $missingNoGeometry = 0;
    $inModel = 0;
    $totalWithKey = 0;

    foreach ($territories as $t) {
        $wikiKey = (string) ($t['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $totalWithKey++;

        $liveParentWikiKey = null;
        if ($t['parent_id'] !== null && isset($byId[(int) $t['parent_id']])) {
            $liveParentWikiKey = (string) $byId[(int) $t['parent_id']]['wiki_key'];
            if ($liveParentWikiKey === '') {
                $liveParentWikiKey = null;
            }
        }

        if (!array_key_exists($wikiKey, $model)) {
            if (isset($hasGeometry[(int) $t['id']])) {
                $missingWithGeometry[] = ['name' => (string) $t['name'], 'wiki_key' => $wikiKey];
            } else {
                $missingNoGeometry++;
            }
            continue;
        }
        $inModel++;

        $modelParentWikiKey = $model[$wikiKey];
        if ($liveParentWikiKey !== $modelParentWikiKey) {
            $changed[] = [
                'name' => (string) $t['name'],
                'live_parent' => $nameOf($liveParentWikiKey),
                'model_parent' => $nameOf($modelParentWikiKey),
                'has_geometry' => isset($hasGeometry[(int) $t['id']]),
            ];
        }
    }

    return [
        'ok' => true,
        'territories_with_wiki_key' => $totalWithKey,
        'in_model' => $inModel,
        'parent_changed' => count($changed),
        'missing_in_model_with_geometry' => count($missingWithGeometry),
        'missing_in_model_no_geometry' => $missingNoGeometry,
        'sample_changed' => array_slice($changed, 0, 40),
        'sample_missing_with_geometry' => array_slice($missingWithGeometry, 0, 40),
    ];
}

// Apply: uebernimmt das Modell-parent_wiki_key in political_territory.parent_id (Cache) fuer
// DIVERGENTE Faelle (Modell != Live), ausser einer Skip-Liste (wiki_keys). UEBERSCHREIBT also
// bewusst die gewaehlten Faelle. Schreibt NUR bei dry_run:false UND confirm:"apply".
// Erster echter political_territory-Write -> nur mit explizitem Nutzer-OK.
function avesmapsWikiSyncMonitorApplyParentCache(PDO $pdo, array $skipKeys, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $skipKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $skipKeys), static fn(string $v): bool => $v !== ''));
    $skipClause = '';
    if ($skipKeys !== []) {
        $skipClause = ' AND child.wiki_key NOT IN (' . implode(',', array_fill(0, count($skipKeys), '?')) . ')';
    }

    $where = 'WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL
        AND (child.parent_id IS NULL OR child.parent_id <> parent.id)' . $skipClause;
    $joins = 'political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id';

    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM ' . $joins . ' ' . $where);
    $countStmt->execute($skipKeys);
    $willApply = (int) ($countStmt->fetchColumn() ?: 0);

    $sampleStmt = $pdo->prepare(
        'SELECT child.name AS child, parent.name AS new_parent,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = child.id AND g.is_active = 1) AS has_geometry
        FROM ' . $joins . ' ' . $where . ' ORDER BY child.name LIMIT 50'
    );
    $sampleStmt->execute($skipKeys);
    $sample = $sampleStmt->fetchAll(PDO::FETCH_ASSOC);

    // Diagnostik: divergente Kinder (nicht geskippt), deren Modell-Parent NICHT als
    // political_territory-Zeile mit passendem wiki_key existiert -> nicht anwendbar.
    $unresolvedSql = 'SELECT child.name AS child, child.parent_id AS live_parent_id,
            m.parent_wiki_key AS model_parent_key, ps.name AS model_parent_name,
            EXISTS(SELECT 1 FROM political_territory p WHERE p.wiki_key = m.parent_wiki_key AND p.is_active = 1) AS parent_is_territory,
            (SELECT p2.wiki_key FROM political_territory p2 WHERE p2.name = ps.name AND p2.is_active = 1 LIMIT 1) AS territory_key_by_name
        FROM political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' ps ON ps.wiki_key = m.parent_wiki_key
        WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL' . $skipClause . '
          AND NOT EXISTS (SELECT 1 FROM political_territory parent WHERE parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id)
        ORDER BY child.name LIMIT 50';
    $unresolvedStmt = $pdo->prepare($unresolvedSql);
    $unresolvedStmt->execute($skipKeys);
    $unresolved = $unresolvedStmt->fetchAll(PDO::FETCH_ASSOC);

    $applied = 0;
    if (!$dryRun) {
        $updateStmt = $pdo->prepare('UPDATE ' . $joins . ' SET child.parent_id = parent.id ' . $where);
        $updateStmt->execute($skipKeys);
        $applied = $updateStmt->rowCount();
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'will_apply' => $willApply,
        'applied' => $applied,
        'skipped_keys' => $skipKeys,
        'sample' => $sample,
        'unresolved' => $unresolved,
    ];
}

// Drag'n'drop-Write: setzt parent_wiki_key (+ Lock) eines Knotens. NUR wiki_territory_model.
function avesmapsWikiSyncMonitorSetParent(PDO $pdo, string $wikiKey, ?string $parentWikiKey, bool $lock = true): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $parentWikiKey = $parentWikiKey !== null ? trim($parentWikiKey) : null;
    if ($parentWikiKey === '') {
        $parentWikiKey = null;
    }
    if ($parentWikiKey !== null && $parentWikiKey === $wikiKey) {
        throw new RuntimeException('Ein Knoten kann nicht sein eigener Elternknoten sein.');
    }

    // Platzieren hebt ein etwaiges „aussortiert" auf (Knoten kommt zurueck in die Hierarchie).
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, parent_locked, excluded, created_at, updated_at)
        VALUES (:wiki_key, :parent, :lock, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            parent_wiki_key = VALUES(parent_wiki_key),
            parent_locked = VALUES(parent_locked),
            excluded = 0,
            updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'parent' => $parentWikiKey, 'lock' => $lock ? 1 : 0]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'parent_wiki_key' => $parentWikiKey, 'parent_locked' => $lock];
}

// Editor-„aussortieren": Knoten aus der aktiven Hierarchie nehmen (bleibt im Modell + Sync).
// excluded=false holt ihn zurueck. Nur wiki_territory_model.
function avesmapsWikiSyncMonitorSetExcluded(PDO $pdo, string $wikiKey, bool $excluded): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, excluded, created_at, updated_at)
        VALUES (:wiki_key, :excluded, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE excluded = VALUES(excluded), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'excluded' => $excluded ? 1 : 0]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'excluded' => $excluded];
}

// ---- Eigene Knoten (custom nodes ohne Wiki-Key von Wiki-Aventurica) ----
// Schluessel-Konvention: 'eigener-knoten:knotenNNN'. Diese Knoten leben NUR im Modell
// (wiki_territory_model), haben keinen Staging-/Wiki-Datensatz und werden von rebuild_model
// (iteriert nur Staging) nie beruehrt -> ueberleben jede Synchronisierung unveraendert.
const AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX = 'eigener-knoten:';

function avesmapsWikiSyncMonitorIsCustomNodeKey(string $wikiKey): bool {
    return strncmp($wikiKey, AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX, strlen(AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX)) === 0;
}

// Legt einen eigenen Knoten an: noch nicht platziert (excluded=1, erscheint links unter "Eigene",
// nicht im Baum), Name als Override, parent_locked=1 als zusaetzlicher Schutz. Nur Sandbox-Tabelle.
function avesmapsWikiSyncMonitorCreateCustomNode(PDO $pdo, string $name): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $name = trim($name);
    if ($name === '') {
        throw new RuntimeException('Bitte einen Namen fuer den eigenen Knoten angeben.');
    }

    // Naechste freie Nummer = groesste vorhandene + 1 (kollisionsfrei auch nach Loeschungen).
    $existing = $pdo->query(
        "SELECT wiki_key FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE .
        " WHERE wiki_key LIKE 'eigener-knoten:%'"
    )->fetchAll(PDO::FETCH_COLUMN);
    $maxNum = 0;
    foreach ($existing as $key) {
        if (preg_match('/(\d+)\s*$/', (string) $key, $m)) {
            $maxNum = max($maxNum, (int) $m[1]);
        }
    }
    $wikiKey = AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX . 'knoten' . str_pad((string) ($maxNum + 1), 3, '0', STR_PAD_LEFT);
    $overrides = json_encode(['name' => $name], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, parent_locked, excluded, source_origin, metadata_overrides_json, created_at, updated_at)
        VALUES (:wiki_key, NULL, 1, 1, :origin, :overrides, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'origin' => 'custom', 'overrides' => $overrides]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'name' => $name];
}

// Loescht einen eigenen Knoten - nur wenn er NICHT im Hierarchiemodell platziert ist (excluded=1),
// keine Kinder hat und noch nicht live uebernommen wurde. Nur Sandbox-Tabelle.
function avesmapsWikiSyncMonitorDeleteCustomNode(PDO $pdo, string $wikiKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '' || !avesmapsWikiSyncMonitorIsCustomNodeKey($wikiKey)) {
        throw new RuntimeException('Nur eigene Knoten (eigener-knoten:...) koennen geloescht werden.');
    }

    $row = $pdo->prepare('SELECT excluded FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $row->execute(['k' => $wikiKey]);
    $node = $row->fetch(PDO::FETCH_ASSOC);
    if (!$node) {
        return ['ok' => false, 'error' => 'Eigener Knoten nicht gefunden: ' . $wikiKey];
    }
    if ((int) ($node['excluded'] ?? 0) !== 1) {
        return ['ok' => false, 'error' => 'Dieser Knoten ist im Hierarchiemodell platziert. Erst aus dem Modell entfernen (in die "Aussortiert"-Zone ziehen), dann loeschen.'];
    }

    $kids = $pdo->prepare('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE parent_wiki_key = :k');
    $kids->execute(['k' => $wikiKey]);
    if ((int) $kids->fetchColumn() > 0) {
        return ['ok' => false, 'error' => 'Dieser Knoten hat noch Unterknoten. Erst die Kinder umhaengen.'];
    }

    $live = $pdo->prepare('SELECT COUNT(*) FROM political_territory WHERE wiki_key = :k AND is_active = 1');
    $live->execute(['k' => $wikiKey]);
    if ((int) $live->fetchColumn() > 0) {
        return ['ok' => false, 'error' => 'Dieser Knoten wurde schon ins Live-Modell uebernommen. Dort zuerst in den Papierkorb verschieben.'];
    }

    $del = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $del->execute(['k' => $wikiKey]);

    return ['ok' => true, 'deleted' => true, 'wiki_key' => $wikiKey];
}

// Uebernimmt platzierte eigene Knoten (excluded=0) additiv ins Live-Modell: legt fehlende
// political_territory-Zeilen an (wiki_id NULL, wiki_key=eigener-knoten:..., Felder aus Overrides)
// und setzt parent_id aus dem Modell (custom->custom funktioniert durch zwei Passes). Gegated:
// schreibt nur bei $dryRun=false. Nicht-platzierte eigene Knoten werden NICHT uebernommen.
function avesmapsWikiSyncMonitorApplyCustomNodes(PDO $pdo, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $rows = $pdo->query(
        "SELECT wiki_key, parent_wiki_key, metadata_overrides_json
         FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . "
         WHERE wiki_key LIKE 'eigener-knoten:%' AND excluded = 0
         ORDER BY wiki_key ASC"
    )->fetchAll(PDO::FETCH_ASSOC);

    $existingKeys = [];
    if ($rows) {
        $stmt = $pdo->query("SELECT wiki_key FROM political_territory WHERE wiki_key LIKE 'eigener-knoten:%' AND is_active = 1");
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $k) {
            $existingKeys[(string) $k] = true;
        }
    }

    $toCreate = [];
    $alreadyExists = [];
    $missingName = [];
    foreach ($rows as $r) {
        $key = (string) $r['wiki_key'];
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $ov = is_array($ov) ? $ov : [];
        $name = trim((string) ($ov['name'] ?? ''));
        if (isset($existingKeys[$key])) {
            $alreadyExists[] = ['wiki_key' => $key, 'name' => $name];
            continue;
        }
        if ($name === '') {
            $missingName[] = $key;
            continue;
        }
        $toCreate[] = ['wiki_key' => $key, 'name' => $name, 'parent_wiki_key' => $r['parent_wiki_key'], 'ov' => $ov];
    }

    $result = [
        'ok' => true,
        'dry_run' => $dryRun,
        'placed_custom_count' => count($rows),
        'to_create' => array_map(static fn($x) => ['wiki_key' => $x['wiki_key'], 'name' => $x['name'], 'parent_wiki_key' => $x['parent_wiki_key']], $toCreate),
        'already_exists' => $alreadyExists,
        'missing_name' => $missingName,
        'created' => 0,
        'linked' => 0,
        'unresolved_parents' => [],
    ];

    if ($dryRun) {
        return $result;
    }

    $pdo->beginTransaction();
    try {
        foreach ($toCreate as $node) {
            $ov = $node['ov'];
            $name = $node['name'];
            $type = trim((string) ($ov['type'] ?? '')) !== '' ? trim((string) $ov['type']) : 'Herrschaftsgebiet';
            $continent = trim((string) ($ov['continent'] ?? ''));
            if ($continent === '') { $continent = AVESMAPS_POLITICAL_DEFAULT_CONTINENT; }
            $status = trim((string) ($ov['status'] ?? ''));
            $coat = trim((string) ($ov['coat_of_arms_url'] ?? ''));
            $foundedRaw = trim((string) ($ov['founded_start_bf'] ?? ''));
            $dissolvedRaw = trim((string) ($ov['dissolved_end_bf'] ?? ''));
            $validFrom = ($foundedRaw === '' || !preg_match('/^-?\d{1,5}$/', $foundedRaw)) ? null : (int) $foundedRaw;
            $validTo = ($dissolvedRaw === '' || $dissolvedRaw === '9999' || !preg_match('/^-?\d{1,5}$/', $dissolvedRaw)) ? null : (int) $dissolvedRaw;
            $zoom = avesmapsPoliticalDefaultZoomRange($type);

            $insert = $pdo->prepare(
                'INSERT INTO political_territory (
                    public_id, wiki_id, wiki_key, slug, name, short_name, type, continent, status, color,
                    opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
                    min_zoom, max_zoom, parent_id, is_active, editor_notes, sort_order
                ) VALUES (
                    :public_id, NULL, :wiki_key, :slug, :name, NULL, :type, :continent, :status, :color,
                    :opacity, :coat, NULL, :valid_from, :valid_to, NULL,
                    :min_zoom, :max_zoom, NULL, 1, :notes, :sort_order
                )'
            );
            $insert->execute([
                'public_id' => avesmapsPoliticalUuidV4(),
                'wiki_key' => $node['wiki_key'],
                'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
                'name' => $name,
                'type' => avesmapsPoliticalNullableString($type),
                'continent' => $continent,
                'status' => avesmapsPoliticalNullableString($status),
                'color' => avesmapsPoliticalColorFromText($name),
                'opacity' => 0.5,
                'coat' => avesmapsPoliticalNullableString($coat),
                'valid_from' => $validFrom,
                'valid_to' => $validTo,
                'min_zoom' => $zoom['min_zoom'],
                'max_zoom' => $zoom['max_zoom'],
                'notes' => 'Eigener Knoten aus dem Hierarchiemodell: ' . $node['wiki_key'],
                'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
            ]);
            $result['created']++;
        }

        // parent_id aus dem Modell setzen (Modell ist die Wahrheit fuer eigene Knoten).
        $findParent = $pdo->prepare('SELECT id FROM political_territory WHERE wiki_key = :pk AND is_active = 1 LIMIT 1');
        $setParent = $pdo->prepare('UPDATE political_territory SET parent_id = :pid WHERE wiki_key = :k AND is_active = 1');
        foreach ($rows as $r) {
            $pk = (string) ($r['parent_wiki_key'] ?? '');
            if ($pk === '') {
                continue; // Wurzelknoten -> parent_id bleibt NULL
            }
            $findParent->execute(['pk' => $pk]);
            $pid = $findParent->fetchColumn();
            if ($pid === false) {
                $result['unresolved_parents'][] = ['wiki_key' => (string) $r['wiki_key'], 'parent_wiki_key' => $pk];
                continue;
            }
            $setParent->execute(['pid' => (int) $pid, 'k' => (string) $r['wiki_key']]);
            $result['linked']++;
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }

    return $result;
}

// Editierbare Wiki-Details-Felder (Allowlist). Manuelle Overrides liegen als JSON in
// wiki_territory_model.metadata_overrides_json; der synchronisierte Wiki-Wert in _wiki_test
// bleibt unangetastet und gewinnt nie gegen einen vorhandenen Override. capital_location_id =
// Sonderfeld: verknuepfte Siedlung aus map_features (read-only Lookup, kein Schreibzugriff dort).
function avesmapsWikiSyncMonitorEditableFields(): array {
    return [
        'name' => 'Anzeigename', 'type' => 'Staatsform', 'status' => 'Status',
        'form_of_government' => 'Herrschaftsform', 'continent' => 'Kontinent',
        'capital_name' => 'Hauptstadt', 'seat_name' => 'Herrschaftssitz', 'ruler' => 'Oberhaupt',
        'language' => 'Sprache', 'currency' => 'Währung', 'population' => 'Einwohnerzahl',
        'founder' => 'Gründer', 'political' => 'Politisch', 'trade_zone' => 'Handelszone',
        'trade_goods' => 'Handelswaren', 'geographic' => 'Geographisch',
        'affiliation_raw' => 'Zugehörigkeit (roh)',
        'founded_start_bf' => 'Gegründet (BF)', 'dissolved_end_bf' => 'Aufgelöst (BF)',
        'founded_text' => 'Gegründet (Text)', 'dissolved_text' => 'Aufgelöst (Text)',
        'capital_location_id' => 'Hauptstadt-Verknüpfung',
        'coat_of_arms_url' => 'Wappen-Bild', 'coat_of_arms_license_status' => 'Wappen-Lizenz',
        'coat_of_arms_author' => 'Wappen-Urheber',
    ];
}

// BF-Override-Felder erwarten eine (optional negative) Ganzzahl ODER leer (= unbekannt/„besteht").
function avesmapsWikiSyncMonitorIsBfField(string $fieldKey): bool {
    return in_array($fieldKey, ['founded_start_bf', 'founded_end_bf', 'founded_display_bf', 'dissolved_start_bf', 'dissolved_end_bf', 'dissolved_display_bf'], true);
}

// Laedt eine Bild-URL serverseitig (cURL, folgt Redirects). Gibt [bytes, content_type] oder null.
function avesmapsWikiSyncMonitorHttpGetBinary(string $url): ?array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => 'AvesmapsWappenBot/1.0 (+https://avesmaps.de)',
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        if ($body === false || $code < 200 || $code >= 300 || $body === '') {
            return null;
        }
        return ['bytes' => (string) $body, 'content_type' => $type];
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'AvesmapsWappenBot/1.0']]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false || $body === '') {
            return null;
        }
        $type = '';
        foreach ($http_response_header ?? [] as $h) {
            if (stripos($h, 'content-type:') === 0) {
                $type = trim(substr($h, strlen('content-type:')));
            }
        }
        return ['bytes' => $body, 'content_type' => $type];
    }
    return null;
}

// Erlaubte Bildformate -> Dateiendung. null = nicht erlaubt.
function avesmapsWikiSyncMonitorImageExtension(string $contentType, string $url): ?string {
    $map = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/jpg' => 'jpg',
        'image/svg+xml' => 'svg', 'image/gif' => 'gif', 'image/webp' => 'webp',
    ];
    $ct = strtolower(trim(explode(';', $contentType)[0]));
    if (isset($map[$ct])) {
        return $map[$ct];
    }
    // Fallback ueber die URL-Endung.
    $ext = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
    $allowed = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'];
    if (in_array($ext, $allowed, true)) {
        return $ext === 'jpeg' ? 'jpg' : $ext;
    }
    return null;
}

// #3 "Wappen lokal speichern": laedt das gemeinfreie Wiki-Wappen herunter -> /uploads/wappen/<slug>.<ext>,
// setzt coat_of_arms_url-Override auf die lokale URL. Nur public_domain, nur Wiki-Aventurica-Quelle.
function avesmapsWikiSyncMonitorSaveCoatLocal(PDO $pdo, string $wikiKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }
    $s = $pdo->prepare('SELECT coat_of_arms_url, coat_of_arms_license_status FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' WHERE wiki_key = :wk LIMIT 1');
    $s->execute(['wk' => $wikiKey]);
    $staging = $s->fetch(PDO::FETCH_ASSOC) ?: [];
    $o = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :wk LIMIT 1');
    $o->execute(['wk' => $wikiKey]);
    $ov = json_decode((string) ($o->fetchColumn() ?: ''), true);
    $ov = is_array($ov) ? $ov : [];
    $coatUrl = array_key_exists('coat_of_arms_url', $ov) ? trim((string) $ov['coat_of_arms_url']) : trim((string) ($staging['coat_of_arms_url'] ?? ''));
    $license = array_key_exists('coat_of_arms_license_status', $ov) ? trim((string) $ov['coat_of_arms_license_status']) : trim((string) ($staging['coat_of_arms_license_status'] ?? ''));
    if ($coatUrl === '') {
        return ['ok' => false, 'error' => 'Kein Wappen vorhanden.'];
    }
    if (strpos($coatUrl, '/uploads/wappen/') === 0) {
        return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $coatUrl, 'already_local' => true];
    }
    if ($license !== 'public_domain') {
        return ['ok' => false, 'error' => 'Nur gemeinfreie Wappen koennen automatisch lokal gespeichert werden (Lizenz: ' . ($license !== '' ? $license : 'unbekannt') . ').'];
    }
    $host = (string) parse_url($coatUrl, PHP_URL_HOST);
    if (stripos($host, 'wiki-aventurica.de') === false) {
        return ['ok' => false, 'error' => 'Wappen-URL ist keine Wiki-Aventurica-Quelle.'];
    }
    $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($coatUrl);
    if ($downloaded === null) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht heruntergeladen werden.'];
    }
    $ext = avesmapsWikiSyncMonitorImageExtension($downloaded['content_type'], $coatUrl);
    if ($ext === null) {
        return ['ok' => false, 'error' => 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).'];
    }
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Upload-Ordner /uploads/wappen konnte nicht angelegt werden (Schreibrechte?).'];
    }
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', (string) preg_replace('/^wiki:/', '', $wikiKey)));
    $slug = trim($slug, '-') ?: 'wappen';
    $filename = $slug . '.' . $ext;
    if (@file_put_contents($dir . '/' . $filename, $downloaded['bytes']) === false) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht gespeichert werden (Schreibrechte auf /uploads/wappen?).'];
    }
    $localUrl = '/uploads/wappen/' . $filename;
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_url', $localUrl);
    return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $localUrl, 'bytes' => strlen($downloaded['bytes']), 'source' => $coatUrl];
}

// #4 "Eigenes Wappen hochladen": nimmt eine hochgeladene Datei ODER eine Bild-URL, speichert sie als
// /uploads/wappen/<slug>-custom.<ext> und setzt coat_of_arms_url + coat_of_arms_license_status (+ optional
// coat_of_arms_author) als Override. Die Lizenz waehlt der Nutzer selbst. Restore = clear_field_override (↺).
// Anders als save_coat_local (#3): keine Quell-/Lizenz-Beschraenkung, da es das eigene Wappen ist.
function avesmapsWikiSyncMonitorUploadCoat(PDO $pdo, string $wikiKey, string $sourceUrl, string $license, string $author, ?array $file): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $sourceUrl = trim($sourceUrl);
    $license = trim($license);
    $author = trim($author);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }
    if (!in_array($license, ['public_domain', 'attribution_required'], true)) {
        return ['ok' => false, 'error' => 'Bitte eine gueltige Lizenz waehlen (gemeinfrei oder Namensnennung).'];
    }

    $maxBytes = 5 * 1024 * 1024;
    $bytes = null;
    $contentType = '';
    $nameHint = $sourceUrl;
    if ($file !== null && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return ['ok' => false, 'error' => 'Hochgeladene Datei ist ungueltig.'];
        }
        if ((int) ($file['size'] ?? 0) > $maxBytes) {
            return ['ok' => false, 'error' => 'Datei ist zu gross (max. 5 MB).'];
        }
        $bytes = (string) @file_get_contents($tmp);
        $nameHint = (string) ($file['name'] ?? '');
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi !== false) {
                $contentType = (string) finfo_file($fi, $tmp);
                finfo_close($fi);
            }
        }
        if ($contentType === '') {
            $contentType = (string) ($file['type'] ?? '');
        }
    } elseif ($sourceUrl !== '') {
        $scheme = strtolower((string) parse_url($sourceUrl, PHP_URL_SCHEME));
        if ($scheme !== 'http' && $scheme !== 'https') {
            return ['ok' => false, 'error' => 'Bild-URL muss mit http(s):// beginnen.'];
        }
        $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($sourceUrl);
        if ($downloaded === null) {
            return ['ok' => false, 'error' => 'Bild konnte von der URL nicht geladen werden.'];
        }
        $bytes = $downloaded['bytes'];
        $contentType = $downloaded['content_type'];
        if (strlen($bytes) > $maxBytes) {
            return ['ok' => false, 'error' => 'Bild ist zu gross (max. 5 MB).'];
        }
    } else {
        return ['ok' => false, 'error' => 'Bitte eine Bilddatei hochladen oder eine Bild-URL angeben.'];
    }

    if ($bytes === null || $bytes === '') {
        return ['ok' => false, 'error' => 'Leeres Bild.'];
    }
    $ext = avesmapsWikiSyncMonitorImageExtension($contentType, $nameHint);
    if ($ext === null) {
        return ['ok' => false, 'error' => 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).'];
    }
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Upload-Ordner /uploads/wappen konnte nicht angelegt werden (Schreibrechte?).'];
    }
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', (string) preg_replace('/^wiki:/', '', $wikiKey)));
    $slug = trim($slug, '-') ?: 'wappen';
    $filename = $slug . '-custom.' . $ext;
    if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht gespeichert werden (Schreibrechte auf /uploads/wappen?).'];
    }
    $localUrl = '/uploads/wappen/' . $filename;
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_url', $localUrl);
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_license_status', $license);
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_author', $author);
    return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $localUrl, 'bytes' => strlen($bytes), 'license' => $license];
}

// Liest die Override-Map (wiki_key -> {field_key: value}) aus dem Modell. Fuer model_tree.
function avesmapsWikiSyncMonitorReadOverridesMap(PDO $pdo): array {
    $map = [];
    $rows = $pdo->query(
        'SELECT wiki_key, metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE
        . ' WHERE metadata_overrides_json IS NOT NULL'
    ) ?: [];
    foreach ($rows as $row) {
        $decoded = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
        if (is_array($decoded) && $decoded !== []) {
            $map[(string) $row['wiki_key']] = $decoded;
        }
    }
    return $map;
}

// Manuellen Override fuer EIN Feld setzen (value darf '' sein = bewusst geleert). Nur Sandbox-
// Modelltabelle. field_key muss in der Allowlist stehen. Legt die Modellzeile bei Bedarf an.
function avesmapsWikiSyncMonitorSetFieldOverride(PDO $pdo, string $wikiKey, string $fieldKey, ?string $value): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $fieldKey = trim($fieldKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    if (!isset(avesmapsWikiSyncMonitorEditableFields()[$fieldKey])) {
        throw new RuntimeException('Feld „' . $fieldKey . '" ist nicht editierbar.');
    }
    $value = $value === null ? '' : trim($value);
    if (avesmapsWikiSyncMonitorIsBfField($fieldKey) && $value !== '' && !preg_match('/^-?\d{1,5}$/', $value)) {
        throw new RuntimeException('BF-Wert muss eine (optional negative) Ganzzahl oder leer sein.');
    }
    if ($fieldKey === 'capital_location_id' && $value !== '' && !ctype_digit($value)) {
        throw new RuntimeException('capital_location_id muss numerisch oder leer sein.');
    }

    $current = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $current->execute(['k' => $wikiKey]);
    $overrides = json_decode((string) ($current->fetchColumn() ?: ''), true);
    if (!is_array($overrides)) {
        $overrides = [];
    }
    $overrides[$fieldKey] = $value;

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, metadata_overrides_json, created_at, updated_at)
        VALUES (:k, :json, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE metadata_overrides_json = VALUES(metadata_overrides_json), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['k' => $wikiKey, 'json' => json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'field_key' => $fieldKey, 'value' => $overrides[$fieldKey], 'overrides' => $overrides];
}

// Override fuer EIN Feld entfernen -> Feld zeigt wieder den synchronisierten Wiki-Stand. Nur Sandbox.
function avesmapsWikiSyncMonitorClearFieldOverride(PDO $pdo, string $wikiKey, string $fieldKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $fieldKey = trim($fieldKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $current = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $current->execute(['k' => $wikiKey]);
    $overrides = json_decode((string) ($current->fetchColumn() ?: ''), true);
    if (!is_array($overrides)) {
        $overrides = [];
    }
    unset($overrides[$fieldKey]);

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            SET metadata_overrides_json = :json, updated_at = CURRENT_TIMESTAMP(3) WHERE wiki_key = :k'
    );
    $statement->execute(['k' => $wikiKey, 'json' => $overrides === [] ? null : json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'field_key' => $fieldKey, 'overrides' => $overrides];
}

// Read-only Siedlungs-Suche fuer den Hauptstadt-Picker. Liest NUR aus map_features (location).
function avesmapsWikiSyncMonitorLocationSearch(PDO $pdo, string $query, int $limit): array {
    $query = trim($query);
    $limit = max(1, min(50, $limit));
    if ($query === '') {
        return ['ok' => true, 'items' => []];
    }
    $statement = $pdo->prepare(
        'SELECT id, public_id, name FROM map_features
        WHERE feature_type = :ft AND is_active = 1 AND name LIKE :q
        ORDER BY (name = :exact) DESC, CHAR_LENGTH(name) ASC, name ASC LIMIT ' . $limit
    );
    $statement->execute(['ft' => 'location', 'q' => '%' . $query . '%', 'exact' => $query]);
    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $items[] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => (string) ($row['name'] ?? '')];
    }
    return ['ok' => true, 'items' => $items];
}

// Loest Hauptstadt-Namen / explizite location_id-Overrides gegen map_features auf (Batch).
// Liefert wiki_key -> {id, public_id, name}. Read-only.
function avesmapsWikiSyncMonitorResolveCapitals(PDO $pdo, array $byName, array $byId): array {
    $result = [];
    if ($byId !== []) {
        $ids = array_values(array_unique(array_map('intval', array_keys($byId))));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $pdo->prepare('SELECT id, public_id, name FROM map_features WHERE feature_type = ? AND id IN (' . $placeholders . ')');
        $statement->execute(array_merge(['location'], $ids));
        $byIdResolved = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $byIdResolved[(int) $row['id']] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => (string) ($row['name'] ?? '')];
        }
        foreach ($byId as $id => $wikiKeys) {
            if (!isset($byIdResolved[(int) $id])) {
                continue;
            }
            foreach ($wikiKeys as $wk) {
                $result[$wk] = $byIdResolved[(int) $id];
            }
        }
    }
    $names = array_values(array_filter(array_keys($byName), static fn(string $n): bool => $n !== ''));
    if ($names !== []) {
        $placeholders = implode(',', array_fill(0, count($names), '?'));
        $statement = $pdo->prepare('SELECT id, public_id, name FROM map_features WHERE feature_type = ? AND is_active = 1 AND name IN (' . $placeholders . ')');
        $statement->execute(array_merge(['location'], $names));
        $byNameResolved = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $nm = (string) ($row['name'] ?? '');
            if (!isset($byNameResolved[$nm])) {
                $byNameResolved[$nm] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => $nm];
            }
        }
        foreach ($byName as $nm => $wikiKeys) {
            if (!isset($byNameResolved[$nm])) {
                continue;
            }
            foreach ($wikiKeys as $wk) {
                if (!isset($result[$wk])) { // expliziter id-Override hat Vorrang
                    $result[$wk] = $byNameResolved[$nm];
                }
            }
        }
    }
    return $result;
}

// Apply-Flow Phase A: READ-ONLY Vorschau, was ein Identitaets-Apply in political_territory
// aendern WUERDE. Effektiv = Override (metadata_overrides_json) ?? Staging-Wiki, Match per wiki_key,
// Vergleich gegen die aktive Live-Zeile. Schreibt NICHTS. Kernfelder: name, type, status,
// valid_from_bf(<-founded_start_bf), valid_to_bf(<-dissolved_end_bf; 9999/null=besteht). excluded -> skip.
// Kontinent (mit Vererbung)/Hauptstadt/Wappen folgen in einem spaeteren Schritt.
// Klammer-Qualifizierer aus der Wiki-Disambiguierung am Ende des Typs entfernen
// ("Herzogtum (Mittelreichische Provinz)" -> "Herzogtum"). Mehrfach-/verschachtelt-tolerant.
function avesmapsWikiSyncMonitorCleanType(string $type): string {
    $prev = null;
    $t = trim($type);
    while ($prev !== $t) {
        $prev = $t;
        $t = trim((string) preg_replace('/\s*\([^()]*\)\s*$/u', '', $t));
    }
    return $t;
}

function avesmapsWikiSyncMonitorApplyIdentityPreview(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;

    $st = [];
    foreach ($pdo->query('SELECT wiki_key, name, type, status, founded_text, founded_start_bf, founded_display_bf, dissolved_start_bf, dissolved_end_bf, dissolved_display_bf FROM ' . $staging) ?: [] as $r) {
        $st[(string) $r['wiki_key']] = $r;
    }
    $mo = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key, metadata_overrides_json, excluded FROM ' . $model) ?: [] as $r) {
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $mo[(string) $r['wiki_key']] = [
            'ov' => is_array($ov) ? $ov : [],
            'excluded' => (int) ($r['excluded'] ?? 0) === 1,
            'parent' => $r['parent_wiki_key'] !== null ? (string) $r['parent_wiki_key'] : null,
        ];
    }
    $live = $pdo->query('SELECT id, wiki_key, name, type, status, valid_from_bf, valid_to_bf FROM political_territory WHERE wiki_key IS NOT NULL AND wiki_key <> \'\' AND is_active = 1') ?: [];

    $normBf = static function ($v): ?int {
        if ($v === null || $v === '') {
            return null;
        }
        $i = (int) round((float) $v);
        return $i === 9999 ? null : $i;
    };
    // "Echtes" eigenes Gruendungsjahr: Override (auch 0 = bewusst gesetzt) ?? Staging-BF wenn != 0.
    // Staging "0 BF" ist der Parser-Default fuer "kein Datum im Wiki" -> kein echtes Datum.
    $realFounded = static function (string $wk) use ($st, $mo): ?int {
        $ov = $mo[$wk]['ov'] ?? [];
        if (array_key_exists('founded_start_bf', $ov)) {
            $t = trim((string) $ov['founded_start_bf']);
            return $t === '' ? null : (int) $t;
        }
        $s = $st[$wk] ?? null;
        if ($s === null) {
            return null;
        }
        $v = $s['founded_start_bf'];
        if ($v !== null && (int) $v !== 0) {
            return (int) $v;
        }
        $d = $s['founded_display_bf'];
        if ($d !== null && (int) round((float) $d) !== 0) {
            return (int) round((float) $d);
        }
        // Myranor: "N IZ" (Imperiale Zeitrechnung) -> BF = IZ - 3747. Der Parser kann IZ (noch) nicht,
        // der founded_text hat es aber. Erste Jahreszahl im IZ-Kontext nehmen (Range -> Startjahr).
        $txt = (string) ($s['founded_text'] ?? '');
        if (stripos($txt, 'IZ') !== false && preg_match('/(\d{1,4})/', $txt, $mm)) {
            return (int) $mm[1] - 3747;
        }
        return null;
    };
    // Effektives Gruendungsjahr mit Vererbung: eigenes echtes ?? naechster Vorfahr mit echtem ?? 0 BF.
    $effFoundedInherited = static function (string $wk) use ($mo, $realFounded): int {
        $seen = [];
        $cur = $wk;
        while ($cur !== null && !isset($seen[$cur])) {
            $seen[$cur] = true;
            $r = $realFounded($cur);
            if ($r !== null) {
                return $r;
            }
            $cur = $mo[$cur]['parent'] ?? null;
        }
        return 0;
    };
    $effTo = static function (array $ov, array $s) use ($normBf) {
        if (array_key_exists('dissolved_end_bf', $ov)) {
            $t = trim((string) $ov['dissolved_end_bf']);
            return $t === '' ? null : $normBf($t);
        }
        return $normBf($s['dissolved_end_bf'] ?? $s['dissolved_display_bf'] ?? $s['dissolved_start_bf'] ?? null);
    };
    $cmpStr = static fn($a, $b): bool => trim((string) $a) !== trim((string) $b);

    $fieldCounts = ['name' => 0, 'type' => 0, 'status' => 0, 'valid_from_bf' => 0, 'valid_to_bf' => 0];
    $rows = [];
    $changed = [];
    $summary = ['live_with_wiki_key' => 0, 'no_staging' => 0, 'excluded_skipped' => 0, 'rows_with_changes' => 0, 'unchanged' => 0];

    foreach ($live as $L) {
        $summary['live_with_wiki_key']++;
        $wk = (string) $L['wiki_key'];
        if (!isset($st[$wk])) {
            $summary['no_staging']++;
            continue;
        }
        $m = $mo[$wk] ?? ['ov' => [], 'excluded' => false];
        if ($m['excluded']) {
            $summary['excluded_skipped']++;
            continue;
        }
        $ov = $m['ov'];
        $s = $st[$wk];

        $effName = array_key_exists('name', $ov) ? (string) $ov['name'] : (string) ($s['name'] ?? '');
        $effType = array_key_exists('type', $ov) ? (string) $ov['type'] : avesmapsWikiSyncMonitorCleanType((string) ($s['type'] ?? ''));
        $effStatus = array_key_exists('status', $ov) ? (string) $ov['status'] : (string) ($s['status'] ?? '');
        $effFromV = $effFoundedInherited($wk);
        $effToV = $effTo($ov, $s);
        $liveFrom = $L['valid_from_bf'] === null ? null : (int) $L['valid_from_bf'];
        // Live nutzt 9999 als "besteht heute"-Sentinel = null -> sonst falsche 9999<->null-Diffs.
        $liveTo = $normBf($L['valid_to_bf']);

        $changes = [];
        if ($cmpStr($L['name'], $effName)) {
            $changes['name'] = ['from' => (string) $L['name'], 'to' => $effName];
            $fieldCounts['name']++;
        }
        if ($cmpStr($L['type'], $effType)) {
            $changes['type'] = ['from' => (string) ($L['type'] ?? ''), 'to' => $effType];
            $fieldCounts['type']++;
        }
        if ($cmpStr($L['status'], $effStatus)) {
            $changes['status'] = ['from' => (string) ($L['status'] ?? ''), 'to' => $effStatus];
            $fieldCounts['status']++;
        }
        if ($liveFrom !== $effFromV) {
            $changes['valid_from_bf'] = ['from' => $liveFrom, 'to' => $effFromV];
            $fieldCounts['valid_from_bf']++;
        }
        if ($liveTo !== $effToV) {
            $changes['valid_to_bf'] = ['from' => $liveTo, 'to' => $effToV];
            $fieldCounts['valid_to_bf']++;
        }

        if ($changes === []) {
            $summary['unchanged']++;
            continue;
        }
        $summary['rows_with_changes']++;
        $changed[] = [
            'id' => (int) $L['id'],
            'wiki_key' => $wk,
            'name' => $effName,
            'changes' => $changes,
            'eff' => ['name' => $effName, 'type' => $effType, 'status' => $effStatus, 'valid_from_bf' => $effFromV, 'valid_to_bf' => $effToV],
        ];
        if (count($rows) < 300) {
            $rows[] = ['wiki_key' => $wk, 'name' => $effName, 'changes' => $changes];
        }
    }

    return ['ok' => true, 'summary' => $summary, 'field_counts' => $fieldCounts, 'rows' => $rows, 'changed' => $changed];
}

// Apply-Flow Phase C: schreibt die Identitaets-Felder (name/type/status/valid_from_bf/valid_to_bf)
// nach political_territory. GATED -> echter Write nur bei $dryRun=false. Geometrie/Zoom/Farbe/
// short_name werden NIE angefasst. skip = wiki_keys auslassen (Zeitzwillinge!), only = nur diese
// (Testlauf), limit = max. Anzahl. valid_to null (=besteht) wird als 9999-Sentinel geschrieben
// (Live-Konvention). Override > Wiki, Gruendungs-Vererbung + IZ stecken bereits in der Berechnung.
function avesmapsWikiSyncMonitorApplyIdentity(PDO $pdo, array $skip, array $only, int $limit, bool $dryRun): array {
    $preview = avesmapsWikiSyncMonitorApplyIdentityPreview($pdo);
    $changed = is_array($preview['changed'] ?? null) ? $preview['changed'] : [];
    $skipSet = array_fill_keys(array_map('strval', $skip), true);
    $onlySet = $only === [] ? null : array_fill_keys(array_map('strval', $only), true);

    $targets = [];
    $skippedSkiplist = 0;
    foreach ($changed as $c) {
        $wk = (string) $c['wiki_key'];
        if (isset($skipSet[$wk])) {
            $skippedSkiplist++;
            continue;
        }
        if ($onlySet !== null && !isset($onlySet[$wk])) {
            continue;
        }
        $targets[] = $c;
    }
    if ($limit > 0 && count($targets) > $limit) {
        $targets = array_slice($targets, 0, $limit);
    }

    $written = 0;
    $batchId = '';
    if (!$dryRun && $targets !== []) {
        $batchId = date('YmdHis') . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
        // Aktuelle Live-Werte der Ziele VOR dem Write holen (Snapshot = Undo-Quelle).
        $ids = array_map(static fn(array $c): int => (int) $c['id'], $targets);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $sel = $pdo->prepare('SELECT id, name, type, status, valid_from_bf, valid_to_bf FROM political_territory WHERE id IN (' . $place . ')');
        $sel->execute($ids);
        $cur = [];
        foreach ($sel->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cur[(int) $r['id']] = $r;
        }
        $backupStmt = $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . '
                (batch_id, territory_id, wiki_key, old_name, old_type, old_status, old_valid_from_bf, old_valid_to_bf,
                 new_name, new_type, new_status, new_valid_from_bf, new_valid_to_bf)
                VALUES (:batch, :tid, :wk, :on, :ot, :os, :ovf, :ovt, :nn, :nt, :ns, :nvf, :nvt)'
        );
        $stmt = $pdo->prepare(
            'UPDATE political_territory
                SET name = :name, type = :type, status = :status, valid_from_bf = :vfrom, valid_to_bf = :vto
                WHERE id = :id AND is_active = 1'
        );
        $pdo->beginTransaction();
        try {
            foreach ($targets as $c) {
                $eff = $c['eff'];
                $id = (int) $c['id'];
                $newType = $eff['type'] === '' ? null : (string) $eff['type'];
                $newStatus = $eff['status'] === '' ? null : (string) $eff['status'];
                $newVto = $eff['valid_to_bf'] === null ? 9999 : (int) $eff['valid_to_bf'];
                $old = $cur[$id] ?? null;
                if ($old !== null) {
                    $backupStmt->execute([
                        'batch' => $batchId,
                        'tid' => $id,
                        'wk' => (string) $c['wiki_key'],
                        'on' => $old['name'],
                        'ot' => $old['type'],
                        'os' => $old['status'],
                        'ovf' => $old['valid_from_bf'],
                        'ovt' => $old['valid_to_bf'],
                        'nn' => (string) $eff['name'],
                        'nt' => $newType,
                        'ns' => $newStatus,
                        'nvf' => $eff['valid_from_bf'],
                        'nvt' => $newVto,
                    ]);
                }
                $stmt->execute([
                    'name' => (string) $eff['name'],
                    'type' => $newType,
                    'status' => $newStatus,
                    'vfrom' => $eff['valid_from_bf'],
                    'vto' => $newVto,
                    'id' => $id,
                ]);
                $written += $stmt->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'batch_id' => $batchId,
        'targets' => count($targets),
        'written' => $written,
        'skipped_skiplist' => $skippedSkiplist,
        'sample' => array_slice(array_map(
            static fn(array $c): array => ['wiki_key' => $c['wiki_key'], 'name' => $c['name'], 'eff' => $c['eff']],
            $targets
        ), 0, 12),
    ];
}

// Apply-Flow Undo: stellt die Live-Werte eines apply_identity-Laufs aus dem Backup wieder her.
// $batchId leer/"latest" -> juengster noch nicht zurueckgesetzter Lauf. GATED ($dryRun=false = echter Write).
function avesmapsWikiSyncMonitorRevertIdentity(PDO $pdo, string $batchId, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $batchId = trim($batchId);
    if ($batchId === '' || strtolower($batchId) === 'latest') {
        $batchId = (string) ($pdo->query('SELECT batch_id FROM ' . $tbl . ' WHERE kind = \'identity\' AND reverted_at IS NULL ORDER BY id DESC LIMIT 1')->fetchColumn() ?: '');
    }
    if ($batchId === '') {
        return ['ok' => false, 'error' => 'Kein wiederherstellbarer Apply-Lauf gefunden.'];
    }
    $sel = $pdo->prepare('SELECT id, territory_id, old_name, old_type, old_status, old_valid_from_bf, old_valid_to_bf FROM ' . $tbl . ' WHERE batch_id = :b AND kind = \'identity\' AND reverted_at IS NULL ORDER BY id ASC');
    $sel->execute(['b' => $batchId]);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
    $restored = 0;
    if (!$dryRun && $rows !== []) {
        $upd = $pdo->prepare('UPDATE political_territory SET name = :name, type = :type, status = :status, valid_from_bf = :vfrom, valid_to_bf = :vto WHERE id = :id');
        $mark = $pdo->prepare('UPDATE ' . $tbl . ' SET reverted_at = NOW(3) WHERE id = :bid');
        $pdo->beginTransaction();
        try {
            foreach ($rows as $r) {
                $upd->execute([
                    'name' => $r['old_name'],
                    'type' => $r['old_type'],
                    'status' => $r['old_status'],
                    'vfrom' => $r['old_valid_from_bf'] === null ? null : (int) $r['old_valid_from_bf'],
                    'vto' => $r['old_valid_to_bf'] === null ? null : (int) $r['old_valid_to_bf'],
                    'id' => (int) $r['territory_id'],
                ]);
                $mark->execute(['bid' => (int) $r['id']]);
                $restored += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'rows' => count($rows), 'restored' => $restored];
}

// Liste der Apply-Backups (fuers UI/Undo-Button): je batch_id Anzahl Zeilen + Zeitstempel + ob schon zurueckgesetzt.
function avesmapsWikiSyncMonitorIdentityBackups(PDO $pdo, int $limit): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $limit = $limit > 0 ? min($limit, 100) : 20;
    $rows = $pdo->query(
        'SELECT batch_id,
                COUNT(*) AS rows_total,
                SUM(reverted_at IS NOT NULL) AS rows_reverted,
                MIN(created_at) AS created_at,
                MAX(reverted_at) AS reverted_at
           FROM ' . $tbl . '
          GROUP BY batch_id
          ORDER BY MIN(id) DESC
          LIMIT ' . $limit
    )->fetchAll(PDO::FETCH_ASSOC);
    $out = array_map(static function (array $r): array {
        $total = (int) $r['rows_total'];
        $rev = (int) $r['rows_reverted'];
        return [
            'batch_id' => (string) $r['batch_id'],
            'rows_total' => $total,
            'rows_reverted' => $rev,
            'reverted' => $rev >= $total && $total > 0,
            'created_at' => $r['created_at'],
            'reverted_at' => $r['reverted_at'],
        ];
    }, $rows);
    return ['ok' => true, 'backups' => $out];
}

// Coat-Apply Vorschau: effektives Wappen (Override ?? political_territory ?? Staging) pro Live-Zeile,
// gegated auf erlaubte Lizenz (public_domain/attribution_required). Unlizenziert -> leeren (#2).
function avesmapsWikiSyncMonitorApplyCoatsPreview(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;
    $allowed = ['public_domain', 'attribution_required'];

    $st = [];
    foreach ($pdo->query('SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM ' . $staging) ?: [] as $r) {
        $st[(string) $r['wiki_key']] = $r;
    }
    $mo = [];
    foreach ($pdo->query('SELECT wiki_key, metadata_overrides_json, excluded FROM ' . $model) ?: [] as $r) {
        $d = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $mo[(string) $r['wiki_key']] = ['ov' => is_array($d) ? $d : [], 'excluded' => (int) ($r['excluded'] ?? 0) === 1];
    }
    $live = $pdo->query('SELECT id, wiki_key, coat_of_arms_url FROM political_territory WHERE wiki_key IS NOT NULL AND wiki_key <> \'\' AND is_active = 1') ?: [];

    $changed = [];
    $summary = ['live' => 0, 'add' => 0, 'remove_unlicensed' => 0, 'replace' => 0, 'unchanged' => 0, 'excluded_skipped' => 0];
    foreach ($live as $L) {
        $summary['live']++;
        $wk = (string) $L['wiki_key'];
        $m = $mo[$wk] ?? ['ov' => [], 'excluded' => false];
        if ($m['excluded']) { $summary['excluded_skipped']++; continue; }
        $o = $m['ov'];
        $s = $st[$wk] ?? [];
        $liveCoat = trim((string) ($L['coat_of_arms_url'] ?? ''));
        $effCoat = array_key_exists('coat_of_arms_url', $o)
            ? trim((string) $o['coat_of_arms_url'])
            : ($liveCoat !== '' ? $liveCoat : trim((string) ($s['coat_of_arms_url'] ?? '')));
        $lic = array_key_exists('coat_of_arms_license_status', $o)
            ? trim((string) $o['coat_of_arms_license_status'])
            : trim((string) ($s['coat_of_arms_license_status'] ?? ''));
        $newCoat = ($effCoat !== '' && in_array($lic, $allowed, true)) ? $effCoat : '';
        if ($newCoat === $liveCoat) { $summary['unchanged']++; continue; }
        if ($liveCoat === '' && $newCoat !== '') { $summary['add']++; }
        elseif ($newCoat === '' && $liveCoat !== '') { $summary['remove_unlicensed']++; }
        else { $summary['replace']++; }
        $changed[] = ['id' => (int) $L['id'], 'wiki_key' => $wk, 'from' => $liveCoat, 'to' => $newCoat, 'license' => $lic];
    }
    return ['ok' => true, 'summary' => $summary, 'changed' => $changed, 'count' => count($changed)];
}

// Coat-Apply (gated): schreibt coat_of_arms_url (lizenziert -> Wappen, sonst leer) nach political_territory.
// Snapshot (kind=coats) -> revert_coats. NIE Geometrie/andere Felder.
function avesmapsWikiSyncMonitorApplyCoats(PDO $pdo, bool $dryRun): array {
    $preview = avesmapsWikiSyncMonitorApplyCoatsPreview($pdo);
    $changed = is_array($preview['changed'] ?? null) ? $preview['changed'] : [];
    $written = 0;
    $batchId = '';
    if (!$dryRun && $changed !== []) {
        $batchId = date('YmdHis') . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
        $backupStmt = $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . '
                (batch_id, territory_id, wiki_key, old_coat_of_arms_url, new_coat_of_arms_url, kind)
                VALUES (:b, :t, :w, :oc, :nc, \'coats\')'
        );
        $upd = $pdo->prepare('UPDATE political_territory SET coat_of_arms_url = :c WHERE id = :id AND is_active = 1');
        $pdo->beginTransaction();
        try {
            foreach ($changed as $c) {
                $backupStmt->execute([
                    'b' => $batchId, 't' => (int) $c['id'], 'w' => (string) $c['wiki_key'],
                    'oc' => (string) $c['from'], 'nc' => (string) $c['to'],
                ]);
                $upd->execute(['c' => (string) $c['to'], 'id' => (int) $c['id']]);
                $written += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'targets' => count($changed), 'written' => $written];
}

// Coat-Apply Undo: stellt coat_of_arms_url aus dem Backup (kind=coats) wieder her.
function avesmapsWikiSyncMonitorRevertCoats(PDO $pdo, string $batchId, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $batchId = trim($batchId);
    if ($batchId === '' || strtolower($batchId) === 'latest') {
        $batchId = (string) ($pdo->query('SELECT batch_id FROM ' . $tbl . ' WHERE kind = \'coats\' AND reverted_at IS NULL ORDER BY id DESC LIMIT 1')->fetchColumn() ?: '');
    }
    if ($batchId === '') {
        return ['ok' => false, 'error' => 'Kein wiederherstellbarer Coat-Apply-Lauf gefunden.'];
    }
    $sel = $pdo->prepare('SELECT id, territory_id, old_coat_of_arms_url FROM ' . $tbl . ' WHERE batch_id = :b AND kind = \'coats\' AND reverted_at IS NULL ORDER BY id ASC');
    $sel->execute(['b' => $batchId]);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
    $restored = 0;
    if (!$dryRun && $rows !== []) {
        $upd = $pdo->prepare('UPDATE political_territory SET coat_of_arms_url = :c WHERE id = :id');
        $mark = $pdo->prepare('UPDATE ' . $tbl . ' SET reverted_at = NOW(3) WHERE id = :bid');
        $pdo->beginTransaction();
        try {
            foreach ($rows as $r) {
                $upd->execute(['c' => (string) ($r['old_coat_of_arms_url'] ?? ''), 'id' => (int) $r['territory_id']]);
                $mark->execute(['bid' => (int) $r['id']]);
                $restored += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'rows' => count($rows), 'restored' => $restored];
}

// Komplettes Modell flach (fuers UI: Baum + Status-Marker). Markiert Luecken (parent
// referenziert, aber selbst kein Knoten) + Konflikte + Lizenz-Status.
// Read-only Sicherheits-Audit fuer die Tree-Vereinheitlichung: jede aktive Karten-Geometrie muss im
// Modell (per wiki_key) vorkommen, sonst ginge sie beim Wechsel auf model_tree verloren.
function avesmapsWikiSyncMonitorGeometryModelAudit(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;
    $rows = $pdo->query(
        'SELECT pt.id, pt.public_id, pt.name, pt.wiki_key,
                (SELECT COUNT(*) FROM political_territory_geometry g WHERE g.territory_id = pt.id AND g.is_active = 1) AS geom
           FROM political_territory pt
          WHERE pt.is_active = 1
            AND EXISTS (SELECT 1 FROM political_territory_geometry g2 WHERE g2.territory_id = pt.id AND g2.is_active = 1)'
    )->fetchAll(PDO::FETCH_ASSOC);
    $modelKeys = [];
    foreach ($pdo->query('SELECT wiki_key FROM ' . $model) ?: [] as $r) {
        $modelKeys[(string) $r['wiki_key']] = true;
    }
    $total = 0;
    $geomTotal = 0;
    $inModel = 0;
    $noWikiKey = [];
    $notInModel = [];
    foreach ($rows as $r) {
        $total++;
        $geomTotal += (int) $r['geom'];
        $wk = (string) ($r['wiki_key'] ?? '');
        if ($wk === '') {
            $noWikiKey[] = ['name' => $r['name'], 'public_id' => $r['public_id'], 'geom' => (int) $r['geom']];
        } elseif (isset($modelKeys[$wk])) {
            $inModel++;
        } else {
            $notInModel[] = ['name' => $r['name'], 'wiki_key' => $wk, 'public_id' => $r['public_id'], 'geom' => (int) $r['geom']];
        }
    }
    return [
        'ok' => true,
        'territories_with_geometry' => $total,
        'geometries_total' => $geomTotal,
        'in_model' => $inModel,
        'no_wiki_key_count' => count($noWikiKey),
        'no_wiki_key' => array_slice($noWikiKey, 0, 80),
        'wiki_key_not_in_model_count' => count($notInModel),
        'wiki_key_not_in_model' => array_slice($notInModel, 0, 80),
    ];
}

// Invalidiert den model_tree-Cache hart (Key auf NULL) -> der naechste model_tree-Fetch baut garantiert
// frisch. Nach JEDER WikiSync-Mutation aufgerufen, damit Aenderungen sofort in Editor/Review/Trees
// erscheinen (unabhaengig von Subtilitaeten des updated_at-basierten Cache-Keys). Darf nie werfen.
function avesmapsWikiSyncMonitorInvalidateModelTreeCache(PDO $pdo): void {
    try {
        $pdo->exec('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' SET model_tree_cache_key = NULL WHERE id = 1');
    } catch (Throwable $cacheError) {
        // Cache-Invalidierung darf die eigentliche Aktion nie brechen.
    }
}

function avesmapsWikiSyncMonitorModelTree(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    // Cache: Key aus Modell/Staging/Map-Revision -> bei jeder Aenderung frisch, sonst sofort aus dem Cache.
    $cacheKey = '';
    try {
        $cacheKey = (string) ($pdo->query(
            'SELECT CONCAT(
                COALESCE((SELECT MAX(updated_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '), \'\'), \'|\',
                COALESCE((SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '), \'\'), \'|\',
                COALESCE((SELECT revision FROM map_revision WHERE id = 1), 0)
            )'
        )->fetchColumn() ?: '');
        if ($cacheKey !== '') {
            $cachedRow = $pdo->query('SELECT model_tree_cache, model_tree_cache_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' WHERE id = 1')->fetch(PDO::FETCH_ASSOC) ?: [];
            if (($cachedRow['model_tree_cache_key'] ?? null) === $cacheKey && !empty($cachedRow['model_tree_cache'])) {
                $decoded = json_decode((string) $cachedRow['model_tree_cache'], true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
    } catch (Throwable $cacheError) {
        $cacheKey = '';
    }
    $rows = $pdo->query(
        'SELECT m.wiki_key, m.parent_wiki_key, m.parent_locked, m.excluded, m.auto_parent_wiki_key, m.source_origin,
                m.parent_conflict_json, m.metadata_overrides_json, s.name, s.type, s.continent, s.affiliation_raw, s.wiki_url,
                s.founded_text, s.dissolved_text,
                s.founded_start_bf, s.founded_end_bf, s.founded_display_bf,
                s.dissolved_start_bf, s.dissolved_end_bf, s.dissolved_display_bf,
                s.coat_of_arms_url, s.coat_of_arms_license,
                s.coat_of_arms_author, s.coat_of_arms_attribution, s.coat_of_arms_license_status,
                s.status, s.capital_name, s.seat_name,
                s.form_of_government, s.ruler, s.language, s.currency, s.population,
                s.founder, s.political, s.trade_zone, s.trade_goods, s.geographic, s.blazon,
                COALESCE(gmap.cnt, 0) AS map_geometry_count
        FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s ON s.wiki_key = m.wiki_key
        LEFT JOIN (
            SELECT pt.wiki_key AS wk, COUNT(*) AS cnt
            FROM political_territory_geometry g
            JOIN political_territory pt ON pt.id = g.territory_id
            WHERE pt.is_active = 1 AND g.is_active = 1 AND pt.wiki_key IS NOT NULL AND pt.wiki_key <> \'\'
            GROUP BY pt.wiki_key
        ) gmap ON gmap.wk = m.wiki_key
        ORDER BY COALESCE(s.name, m.wiki_key) ASC'
    )->fetchAll(PDO::FETCH_ASSOC);

    $present = [];
    foreach ($rows as $row) {
        $present[(string) $row['wiki_key']] = true;
    }

    // Reverse-Alias-Karte: kanonischer wiki_key -> [alias_slugs] (fuer alias-bewusste Suche,
    // z.B. "mittelreich" findet den kanonischen Knoten).
    $aliasesByKey = [];
    foreach ($pdo->query('SELECT alias_slug, canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE) ?: [] as $row) {
        $aliasesByKey[(string) $row['canonical_wiki_key']][] = (string) $row['alias_slug'];
    }

    $nodes = [];
    foreach ($rows as $row) {
        $parent = $row['parent_wiki_key'] !== null ? (string) $row['parent_wiki_key'] : null;
        $diverges = $parent !== null
            && $row['auto_parent_wiki_key'] !== null
            && (string) $row['auto_parent_wiki_key'] !== $parent;

        $wikiKey = (string) $row['wiki_key'];
        $selfSlug = preg_replace('/^wiki:/', '', $wikiKey) ?? $wikiKey;
        $aliases = array_values(array_unique(array_filter(
            $aliasesByKey[$wikiKey] ?? [],
            static fn(string $alias): bool => $alias !== '' && $alias !== $selfSlug
        )));

        $conflictNames = [];
        $conflictDecoded = json_decode((string) ($row['parent_conflict_json'] ?? ''), true);
        if (is_array($conflictDecoded)) {
            foreach ($conflictDecoded as $conflict) {
                $conflictName = is_array($conflict) ? (string) ($conflict['name'] ?? '') : (string) $conflict;
                if ($conflictName !== '') {
                    $conflictNames[] = $conflictName;
                }
            }
        }

        $nodes[] = [
            'wiki_key' => (string) $row['wiki_key'],
            'name' => $row['name'] !== null ? (string) $row['name'] : (string) $row['wiki_key'],
            'type' => (string) ($row['type'] ?? ''),
            // Eigene Knoten haben keinen Staging-Kontinent -> Default Aventurien, sonst filtert der
            // Editor-Kontinentfilter (Default Aventurien) sie raus. Override gewinnt im Frontend.
            'continent' => (avesmapsWikiSyncMonitorIsCustomNodeKey((string) $row['wiki_key']) && trim((string) ($row['continent'] ?? '')) === '') ? 'Aventurien' : (string) ($row['continent'] ?? ''),
            'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'founded_text' => (string) ($row['founded_text'] ?? ''),
            'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
            'founded_start_bf' => $row['founded_start_bf'] === null ? null : (int) $row['founded_start_bf'],
            'founded_end_bf' => $row['founded_end_bf'] === null ? null : (int) $row['founded_end_bf'],
            'founded_display_bf' => $row['founded_display_bf'] === null ? null : (int) $row['founded_display_bf'],
            'dissolved_start_bf' => $row['dissolved_start_bf'] === null ? null : (int) $row['dissolved_start_bf'],
            'dissolved_end_bf' => $row['dissolved_end_bf'] === null ? null : (int) $row['dissolved_end_bf'],
            'dissolved_display_bf' => $row['dissolved_display_bf'] === null ? null : (int) $row['dissolved_display_bf'],
            'coat_of_arms_license' => (string) ($row['coat_of_arms_license'] ?? ''),
            'coat_of_arms_author' => (string) ($row['coat_of_arms_author'] ?? ''),
            'coat_of_arms_attribution' => (string) ($row['coat_of_arms_attribution'] ?? ''),
            'parent_wiki_key' => $parent,
            'parent_in_model' => $parent !== null ? isset($present[$parent]) : true,
            'parent_locked' => (int) $row['parent_locked'] === 1,
            'excluded' => (int) ($row['excluded'] ?? 0) === 1,
            'auto_parent_wiki_key' => $row['auto_parent_wiki_key'],
            'diverges' => $diverges,
            'source_origin' => (string) ($row['source_origin'] ?? ''),
            'is_own_node' => avesmapsWikiSyncMonitorIsCustomNodeKey((string) $row['wiki_key']),
            'has_conflict' => $conflictNames !== [],
            'conflicts' => $conflictNames,
            'aliases' => $aliases,
            'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
            'license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'capital_name' => (string) ($row['capital_name'] ?? ''),
            'seat_name' => (string) ($row['seat_name'] ?? ''),
            'form_of_government' => (string) ($row['form_of_government'] ?? ''),
            'ruler' => (string) ($row['ruler'] ?? ''),
            'language' => (string) ($row['language'] ?? ''),
            'currency' => (string) ($row['currency'] ?? ''),
            'population' => (string) ($row['population'] ?? ''),
            'founder' => (string) ($row['founder'] ?? ''),
            'political' => (string) ($row['political'] ?? ''),
            'trade_zone' => (string) ($row['trade_zone'] ?? ''),
            'trade_goods' => (string) ($row['trade_goods'] ?? ''),
            'geographic' => (string) ($row['geographic'] ?? ''),
            'blazon' => (string) ($row['blazon'] ?? ''),
            'overrides' => (static function () use ($row): array {
                $d = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
                return is_array($d) ? $d : [];
            })(),
            'map_geometry_count' => (int) ($row['map_geometry_count'] ?? 0),
            'map_assigned' => ((int) ($row['map_geometry_count'] ?? 0)) > 0,
        ];
    }

    // Kontinent-Vererbung: Knoten mit Aventurien-Default (oder leer) erbt den ersten
    // Nicht-Aventurien-Kontinent eines Vorfahren (Provinz liegt im selben Kontinent wie ihr
    // Reich). Behebt Myranor-Provinzen, deren eigene Seite keinen {{Myranor}}-Marker traegt.
    $indexByKey = [];
    foreach ($nodes as $i => $node) {
        $indexByKey[(string) $node['wiki_key']] = $i;
    }
    $isAventurien = static fn(string $c): bool => $c === '' || stripos($c, 'aventurien') !== false;
    foreach ($nodes as $i => $node) {
        if (!$isAventurien((string) $node['continent'])) {
            continue;
        }
        $seen = [];
        $cur = $node['parent_wiki_key'] ?? null;
        while ($cur !== null && isset($indexByKey[$cur]) && !isset($seen[$cur])) {
            $seen[$cur] = true;
            $parentContinent = (string) $nodes[$indexByKey[$cur]]['continent'];
            if (!$isAventurien($parentContinent)) {
                $nodes[$i]['continent'] = $parentContinent;
                $nodes[$i]['continent_inherited'] = true;
                break;
            }
            $cur = $nodes[$indexByKey[$cur]]['parent_wiki_key'] ?? null;
        }
    }

    // Hauptstadt -> map_features (location) aufloesen: expliziter location_id-Override hat Vorrang,
    // sonst der effektive Name (Override ?? Wiki). Batch, read-only. capital_location = {id,public_id,name}.
    $byName = [];
    $byId = [];
    foreach ($nodes as $i => $node) {
        $ov = is_array($node['overrides'] ?? null) ? $node['overrides'] : [];
        $explicitId = isset($ov['capital_location_id']) ? trim((string) $ov['capital_location_id']) : '';
        if ($explicitId !== '' && ctype_digit($explicitId)) {
            $byId[$explicitId][] = (string) $node['wiki_key'];
            continue;
        }
        $capName = isset($ov['capital_name']) ? (string) $ov['capital_name'] : (string) ($node['capital_name'] ?? '');
        $capName = trim($capName);
        if ($capName !== '') {
            $byName[$capName][] = (string) $node['wiki_key'];
        }
    }
    $capitals = avesmapsWikiSyncMonitorResolveCapitals($pdo, $byName, $byId);
    foreach ($nodes as $i => $node) {
        $nodes[$i]['capital_location'] = $capitals[(string) $node['wiki_key']] ?? null;
    }

    $result = ['ok' => true, 'count' => count($nodes), 'nodes' => $nodes];
    if ($cacheKey !== '') {
        try {
            $store = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' SET model_tree_cache = :c, model_tree_cache_key = :k WHERE id = 1');
            $store->execute(['c' => json_encode($result), 'k' => $cacheKey]);
        } catch (Throwable $storeError) {
            // Cache-Schreiben darf den Request nie brechen.
        }
    }
    return $result;
}

// Block 2: liefert die Modell-Knoten im Format des Wiki-Tree (political-territory-wiki.php),
// ABER mit der HIERARCHIE AUS DEM MODELL: affiliation_path = Ahnen-Kette (root-first) aus
// parent_wiki_key. So nistet der bestehende buildTree nach dem Modell, ohne Tree-Modul-Umbau.
// Aussortierte Knoten raus. map_assigned aus political_territory-Geometriezuweisung.
function avesmapsWikiSyncMonitorWikiRows(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $parent = [];
    $excluded = [];
    $ovByKey = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key, excluded, metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $m) {
        $wk = (string) $m['wiki_key'];
        $parent[$wk] = $m['parent_wiki_key'] !== null ? (string) $m['parent_wiki_key'] : null;
        if ((int) ($m['excluded'] ?? 0) === 1) {
            $excluded[$wk] = true;
        }
        $ov = json_decode((string) ($m['metadata_overrides_json'] ?? ''), true);
        $ovByKey[$wk] = is_array($ov) ? $ov : [];
    }

    $assigned = [];
    foreach ($pdo->query(
        'SELECT pt.wiki_key, COUNT(g.id) AS gc
        FROM political_territory pt
        JOIN political_territory_geometry g ON g.territory_id = pt.id AND g.is_active = 1
        WHERE pt.is_active = 1 AND pt.wiki_key IS NOT NULL AND pt.wiki_key <> \'\'
        GROUP BY pt.wiki_key'
    ) ?: [] as $a) {
        $assigned[(string) $a['wiki_key']] = (int) $a['gc'];
    }

    $rowsByKey = [];
    foreach ($pdo->query(
        'SELECT wiki_key, name, type, continent, affiliation_raw, status, form_of_government, capital_name,
                seat_name, ruler, language, currency, trade_goods, population, founded_text, founded_start_bf,
                founded_end_bf, dissolved_text, dissolved_start_bf, dissolved_end_bf, geographic, political,
                trade_zone, blazon, wiki_url, coat_of_arms_url
        FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC) as $s) {
        $rowsByKey[(string) $s['wiki_key']] = $s;
    }
    // Name eines Knotens fuer die Ahnen-Kette: Staging-Name, sonst (eigene Knoten) Override-Name.
    $nameOf = static function (string $wk) use ($rowsByKey, $ovByKey): string {
        if (isset($rowsByKey[$wk])) { return (string) $rowsByKey[$wk]['name']; }
        return isset($ovByKey[$wk]['name']) ? trim((string) $ovByKey[$wk]['name']) : '';
    };

    $items = [];
    $id = 1;
    foreach ($rowsByKey as $wikiKey => $s) {
        if (isset($excluded[$wikiKey])) {
            continue;
        }
        // Nur Aventurien (leerer Kontinent = Default Aventurien); Fremdkontinente bleiben gesynct,
        // aber nicht im Editor-Tree.
        $continent = (string) ($s['continent'] ?? '');
        if ($continent !== '' && stripos($continent, 'aventurien') === false) {
            continue;
        }
        // Ahnen-Kette (root-first) ueber parent_wiki_key, zyklensicher.
        $chain = [];
        $seen = [];
        $cur = $parent[$wikiKey] ?? null;
        $guard = 0;
        while ($cur !== null && !isset($seen[$cur]) && $guard++ < 25) {
            $seen[$cur] = true;
            $name = $nameOf($cur);
            if ($name !== '') {
                array_unshift($chain, $name);
            }
            $cur = $parent[$cur] ?? null;
        }

        $geometryCount = $assigned[$wikiKey] ?? 0;
        $items[] = [
            'id' => $id++,
            'wiki_key' => $wikiKey,
            'parent_wiki_key' => $parent[$wikiKey] ?? null,
            'name' => (string) $s['name'],
            'type' => (string) $s['type'],
            'continent' => (string) $s['continent'],
            'affiliation_raw' => (string) $s['affiliation_raw'],
            'affiliation_root' => $chain[0] ?? '',
            'affiliation_path' => $chain,
            'affiliation_path_json' => $chain,
            'status' => (string) $s['status'],
            'form_of_government' => (string) $s['form_of_government'],
            'capital_name' => (string) $s['capital_name'],
            'seat_name' => (string) $s['seat_name'],
            'ruler' => (string) $s['ruler'],
            'language' => (string) $s['language'],
            'currency' => (string) $s['currency'],
            'trade_goods' => (string) $s['trade_goods'],
            'population' => (string) $s['population'],
            'founded_text' => (string) $s['founded_text'],
            'founded_start_bf' => $s['founded_start_bf'],
            'founded_end_bf' => $s['founded_end_bf'],
            'dissolved_text' => (string) $s['dissolved_text'],
            'dissolved_start_bf' => $s['dissolved_start_bf'],
            'dissolved_end_bf' => $s['dissolved_end_bf'],
            'geographic' => (string) $s['geographic'],
            'political' => (string) $s['political'],
            'trade_zone' => (string) $s['trade_zone'],
            'blazon' => (string) $s['blazon'],
            'wiki_url' => (string) $s['wiki_url'],
            'coat_of_arms_url' => (string) $s['coat_of_arms_url'],
            'map_assigned' => $geometryCount > 0,
            'map_geometry_count' => $geometryCount,
        ];
    }

    // Eigene Knoten (nur im Modell, kein Staging): aus den Overrides aufbauen, damit sie auch im
    // Territoriumseditor- und Review-Tree erscheinen, sobald sie platziert sind (excluded=0).
    foreach ($parent as $wikiKey => $parentKey) {
        if (isset($rowsByKey[$wikiKey]) || isset($excluded[$wikiKey])) {
            continue; // Staging -> oben erfasst; aussortiert/nicht platziert -> nicht im Baum
        }
        $ov = $ovByKey[$wikiKey] ?? [];
        $continent = trim((string) ($ov['continent'] ?? ''));
        if ($continent !== '' && stripos($continent, 'aventurien') === false) {
            continue;
        }
        if ($continent === '') { $continent = 'Aventurien'; }
        $chain = [];
        $seen = [];
        $cur = $parent[$wikiKey] ?? null;
        $guard = 0;
        while ($cur !== null && !isset($seen[$cur]) && $guard++ < 25) {
            $seen[$cur] = true;
            $name = $nameOf($cur);
            if ($name !== '') { array_unshift($chain, $name); }
            $cur = $parent[$cur] ?? null;
        }
        $ovs = static fn(string $k): string => isset($ov[$k]) ? (string) $ov[$k] : '';
        $geometryCount = $assigned[$wikiKey] ?? 0;
        $items[] = [
            'id' => $id++,
            'wiki_key' => $wikiKey,
            'parent_wiki_key' => $parent[$wikiKey] ?? null,
            'name' => $nameOf($wikiKey),
            'type' => $ovs('type'),
            'continent' => $continent,
            'affiliation_raw' => '',
            'affiliation_root' => $chain[0] ?? '',
            'affiliation_path' => $chain,
            'affiliation_path_json' => $chain,
            'status' => $ovs('status'),
            'form_of_government' => $ovs('form_of_government'),
            'capital_name' => $ovs('capital_name'),
            'seat_name' => $ovs('seat_name'),
            'ruler' => $ovs('ruler'),
            'language' => $ovs('language'),
            'currency' => $ovs('currency'),
            'trade_goods' => $ovs('trade_goods'),
            'population' => $ovs('population'),
            'founded_text' => $ovs('founded_text'),
            'founded_start_bf' => (isset($ov['founded_start_bf']) && $ov['founded_start_bf'] !== '') ? (int) $ov['founded_start_bf'] : null,
            'founded_end_bf' => null,
            'dissolved_text' => $ovs('dissolved_text'),
            'dissolved_start_bf' => null,
            'dissolved_end_bf' => (isset($ov['dissolved_end_bf']) && $ov['dissolved_end_bf'] !== '' && $ov['dissolved_end_bf'] !== '9999') ? (int) $ov['dissolved_end_bf'] : null,
            'geographic' => $ovs('geographic'),
            'political' => $ovs('political'),
            'trade_zone' => $ovs('trade_zone'),
            'blazon' => '',
            'wiki_url' => '',
            'coat_of_arms_url' => $ovs('coat_of_arms_url'),
            'map_assigned' => $geometryCount > 0,
            'map_geometry_count' => $geometryCount,
            'is_own_node' => true,
        ];
    }

    return ['ok' => true, 'count' => count($items), 'items' => $items];
}

// Sandbox-Cleanup. target = queue|staging|model. queue optional je run_id.
function avesmapsWikiSyncMonitorClear(PDO $pdo, string $target, string $runId = ''): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $cleared = [];
    $runId = trim($runId);

    if ($target === 'queue') {
        if ($runId !== '') {
            $statement = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . ' WHERE run_id = :run_id');
            $statement->execute(['run_id' => $runId]);
            $cleared['queue_rows_deleted'] = $statement->rowCount();
        } else {
            $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE);
            $cleared['queue'] = 'truncated';
        }
    } elseif ($target === 'staging') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE);
        $cleared['staging'] = 'truncated';
    } elseif ($target === 'model') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE);
        $cleared['model'] = 'truncated';
    } elseif ($target === 'alias') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE);
        $cleared['alias'] = 'truncated';
    } elseif ($target === 'all') {
        // Kompletter Neustart der Sandbox (NICHT political_territory_wiki/_geometry).
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE);
        $cleared = ['queue' => 'truncated', 'staging' => 'truncated', 'model' => 'truncated', 'alias' => 'truncated'];
    } else {
        throw new RuntimeException('Unbekanntes clear-target (queue|staging|model|alias|all).');
    }

    return ['ok' => true, 'cleared' => $cleared];
}

function avesmapsWikiSyncMonitorModelSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $total = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE)->fetchColumn() ?: 0);
    $locked = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE parent_locked = 1')->fetchColumn() ?: 0);

    $cols = 'm.wiki_key, m.parent_wiki_key, m.auto_parent_wiki_key, m.parent_locked, m.source_origin, m.parent_conflict_json, s.name, p.name AS parent_name';
    $join = ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s ON s.wiki_key = m.wiki_key
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' p ON p.wiki_key = m.parent_wiki_key';

    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT ' . $cols . $join . ' WHERE m.wiki_key IN (' . $placeholders . ') ORDER BY s.name ASC');
        $statement->execute($wikiKeys);
    } else {
        $limit = max(1, min(500, $limit));
        $statement = $pdo->query('SELECT ' . $cols . $join . ' ORDER BY m.updated_at DESC LIMIT ' . $limit);
    }

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['parent_conflict'] = json_decode((string) ($row['parent_conflict_json'] ?? ''), true) ?: [];
        $row['parent_resolved'] = $row['parent_wiki_key'] !== null && $row['parent_name'] !== null;
        unset($row['parent_conflict_json']);
        $items[] = $row;
    }

    return ['ok' => true, 'model_table' => AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE, 'total' => $total, 'locked' => $locked, 'count' => count($items), 'items' => $items];
}

// ---------------------------------------------------------------------------
// Phase 1: Wappen-Lizenzen. Pro Wappen die Datei:-Seite holen, Lizenz + Urheber
// ermitteln, license_status setzen (public_domain = direkt zeigbar / attribution_
// required = nur mit Zitat / unknown = ausblenden). Additive Spalten auf _wiki +
// _test. Resumierbar (enrich_licenses). Viewer-Enforcement ist nachgelagert.
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorLicenseColumnDefs(): array {
    return [
        'coat_of_arms_license' => 'VARCHAR(120) NULL',
        'coat_of_arms_author' => 'VARCHAR(255) NULL',
        'coat_of_arms_attribution' => 'VARCHAR(500) NULL',
        'coat_of_arms_license_status' => 'VARCHAR(40) NULL',
        'coat_of_arms_license_url' => 'VARCHAR(500) NULL',
    ];
}

function avesmapsWikiSyncMonitorEnsureLicenseColumns(PDO $pdo): void {
    $defs = avesmapsWikiSyncMonitorLicenseColumnDefs();
    foreach (['political_territory_wiki', AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE] as $table) {
        if ($pdo->query("SHOW TABLES LIKE '" . $table . "'")->fetchColumn() === false) {
            continue;
        }
        $existing = [];
        foreach ($pdo->query('SHOW COLUMNS FROM ' . $table) ?: [] as $column) {
            $existing[(string) ($column['Field'] ?? '')] = true;
        }
        foreach ($defs as $name => $type) {
            if (!isset($existing[$name])) {
                $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $name . ' ' . $type . ' AFTER coat_of_arms_url');
            }
        }
    }
}

// Leitet den Datei:-Titel aus der gespeicherten coat_of_arms_url ab (umkehrung von
// Spezial:Dateipfad/<Datei>); Fallback = letztes Pfad-Segment.
function avesmapsWikiSyncMonitorFileTitleFromCoatUrl(string $url): string {
    $url = trim($url);
    if ($url === '') {
        return '';
    }

    $marker = 'Spezial:Dateipfad/';
    $position = strpos($url, $marker);
    if ($position !== false) {
        $file = rawurldecode(substr($url, $position + strlen($marker)));
    } else {
        // Direkte/Thumbnail-Bild-URL: /images/[thumb/]x/xy/Datei.png[/NNNpx-Datei.png].
        // Den ECHTEN Dateinamen nehmen (Bild-Endung, kein NNNpx-Thumb-Praefix), nicht das
        // letzte Segment (das ist bei Thumbs die verkleinerte Variante).
        $path = rawurldecode((string) (parse_url($url, PHP_URL_PATH) ?? ''));
        $segments = array_values(array_filter(explode('/', $path), static fn(string $s): bool => $s !== ''));
        $imageSegments = array_values(array_filter(
            $segments,
            static fn(string $s): bool => preg_match('/\.(?:png|jpe?g|gif|svg|webp)$/iu', $s) === 1
        ));
        $file = '';
        foreach ($imageSegments as $segment) {
            if (preg_match('/^\d+px-/u', $segment) !== 1) {
                $file = $segment;
                break;
            }
        }
        if ($file === '' && $imageSegments !== []) {
            $last = (string) end($imageSegments);
            $file = preg_replace('/^\d+px-/u', '', $last) ?? $last;
        }
        if ($file === '') {
            $file = (string) (end($segments) ?: '');
        }
    }

    $file = trim(str_replace('_', ' ', $file));
    if ($file === '') {
        return '';
    }

    return preg_match('/^(Datei|File)\s*:/iu', $file) === 1 ? $file : 'Datei:' . $file;
}

function avesmapsWikiSyncMonitorExtractFileField(string $wikitext, array $labels): string {
    // Bis Zeilenende erfassen (NICHT bis zum ersten '|'): der Wert ist oft {{Benutzer|Name}},
    // dessen Pipe ein '[^|]'-Match sonst mittendrin abschneidet ("{{Benutzer").
    foreach ($labels as $label) {
        if (preg_match('/\|\s*' . preg_quote($label, '/') . '\s*=\s*([^\n]+)/iu', $wikitext, $match) === 1) {
            $value = trim((string) $match[1]);
            // nachfolgende Parameter derselben Zeile abschneiden (|Naechstes=...), den Wert behalten
            $value = (string) (preg_replace('/\s*\|\s*[A-Za-zÄÖÜäöü][^=|]*=.*$/u', '', $value) ?? $value);
            $value = trim($value);
            if ($value !== '') {
                return $value;
            }
        }
    }

    return '';
}

// Klassifiziert die Lizenz aus dem File-Wikitext. Liefert label/status/url + author/attribution.
function avesmapsWikiSyncMonitorParseLicense(string $wikitext): array {
    $author = avesmapsWikiSyncMonitorExtractFileField($wikitext, ['Urheber', 'Autor', 'Rechteinhaber', 'author']);
    if ($author !== '') {
        $author = preg_replace('/\{\{\s*Benutzer\s*\|\s*([^}|]+)[^}]*\}\}/iu', '$1', $author) ?? $author;
        $author = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($author);
    }

    $license = 'unknown';
    $status = 'unknown';
    $licenseUrl = '';

    if (preg_match('/\{\{\s*(?:public[\s_-]*domain|gemeinfrei|pd[\s_}-]|pd-self|bild-frei)\b/iu', $wikitext) === 1
        || preg_match('/\bgemeinfrei\b/iu', $wikitext) === 1) {
        $license = 'public domain';
        $status = 'public_domain';
    } elseif (preg_match('/cc[\s_-]?by[\s_-]?sa[\s_-]?([0-9]\.[0-9])?/iu', $wikitext, $match) === 1) {
        $version = $match[1] ?? '';
        $license = 'CC-BY-SA' . ($version !== '' ? '-' . $version : '');
        $status = 'attribution_required';
        $licenseUrl = 'https://creativecommons.org/licenses/by-sa/' . ($version !== '' ? $version : '3.0') . '/';
    } elseif (preg_match('/cc[\s_-]?by[\s_-]?([0-9]\.[0-9])?/iu', $wikitext, $match) === 1) {
        $version = $match[1] ?? '';
        $license = 'CC-BY' . ($version !== '' ? '-' . $version : '');
        $status = 'attribution_required';
        $licenseUrl = 'https://creativecommons.org/licenses/by/' . ($version !== '' ? $version : '3.0') . '/';
    } elseif (preg_match('/creative\s*commons/iu', $wikitext) === 1) {
        $license = 'Creative Commons';
        $status = 'attribution_required';
    } elseif (preg_match('/\bGFDL\b|GNU.{0,40}Free.{0,40}Documentation/iu', $wikitext) === 1) {
        $license = 'GFDL';
        $status = 'attribution_required';
        $licenseUrl = 'https://www.gnu.org/licenses/fdl-1.3.html';
    }

    $attribution = '';
    if ($status === 'attribution_required') {
        $attribution = trim(($author !== '' ? $author : 'Unbekannter Urheber') . ' (' . $license . ')');
    }

    return [
        'license' => $license,
        'status' => $status,
        'author' => $author,
        'attribution' => $attribution,
        'license_url' => $licenseUrl,
    ];
}

function avesmapsWikiSyncMonitorCountPendingLicenses(PDO $pdo): int {
    return (int) ($pdo->query(
        'SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> \'\' AND coat_of_arms_license_status IS NULL'
    )->fetchColumn() ?: 0);
}

function avesmapsWikiSyncMonitorEnrichLicenses(PDO $pdo, array $options = []): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $batchLimit = max(1, min(60, (int) ($options['batch_limit'] ?? 25)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    $stepRuntime = max(3, min(28, (int) ($options['step_runtime'] ?? AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME)));
    @set_time_limit($stepRuntime + 15);

    if (!empty($options['reset'])) {
        $pdo->exec(
            'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
            SET coat_of_arms_license = NULL, coat_of_arms_author = NULL, coat_of_arms_attribution = NULL,
                coat_of_arms_license_status = NULL, coat_of_arms_license_url = NULL
            WHERE coat_of_arms_license_status IS NOT NULL'
        );
    }

    $rows = $pdo->query(
        'SELECT wiki_key, coat_of_arms_url FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> \'\' AND coat_of_arms_license_status IS NULL
        ORDER BY wiki_key ASC LIMIT ' . $batchLimit
    )->fetchAll(PDO::FETCH_ASSOC);

    $fileByWikiKey = [];
    $titles = [];
    foreach ($rows as $row) {
        $fileTitle = avesmapsWikiSyncMonitorFileTitleFromCoatUrl((string) ($row['coat_of_arms_url'] ?? ''));
        if ($fileTitle !== '') {
            $fileByWikiKey[(string) $row['wiki_key']] = $fileTitle;
            $titles[$fileTitle] = $fileTitle;
        }
    }

    $contents = [];
    if ($titles !== []) {
        try {
            $contents = avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_values($titles));
        } catch (Throwable $error) {
            $contents = [];
        }
    }

    $update = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        SET coat_of_arms_license = :license, coat_of_arms_author = :author,
            coat_of_arms_attribution = :attribution, coat_of_arms_license_status = :status,
            coat_of_arms_license_url = :license_url
        WHERE wiki_key = :wiki_key'
    );

    $processed = 0;
    $byStatus = ['public_domain' => 0, 'attribution_required' => 0, 'unknown' => 0];
    foreach ($rows as $row) {
        $wikiKey = (string) $row['wiki_key'];
        $fileTitle = $fileByWikiKey[$wikiKey] ?? '';
        $content = $fileTitle !== '' ? (string) ($contents[$fileTitle] ?? '') : '';
        $license = avesmapsWikiSyncMonitorParseLicense($content);
        $update->execute([
            'license' => $license['license'],
            'author' => $license['author'] !== '' ? $license['author'] : null,
            'attribution' => $license['attribution'] !== '' ? $license['attribution'] : null,
            'status' => $license['status'],
            'license_url' => $license['license_url'] !== '' ? $license['license_url'] : null,
            'wiki_key' => $wikiKey,
        ]);
        $processed++;
        $byStatus[$license['status']] = ($byStatus[$license['status']] ?? 0) + 1;
    }
    if ($titles !== []) {
        avesmapsWikiSyncMonitorSleep($sleepMs);
    }

    return [
        'ok' => true,
        'processed' => $processed,
        'by_status' => $byStatus,
        'remaining' => avesmapsWikiSyncMonitorCountPendingLicenses($pdo),
    ];
}

// Stichprobe/Zaehlung aus dem Staging (_test) zur Verifikation + spaeter fuers Diff/UI.
function avesmapsWikiSyncMonitorStagingSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $total = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)->fetchColumn() ?: 0);

    $cols = 'wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root, affiliation_path_json, status, capital_name, seat_name, coat_of_arms_url, coat_of_arms_license, coat_of_arms_author, coat_of_arms_attribution, coat_of_arms_license_status, coat_of_arms_license_url, founded_text, founded_type, founded_start_bf, founded_end_bf, dissolved_text, dissolved_type, dissolved_start_bf, dissolved_end_bf, raw_json, synced_at';
    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT ' . $cols . ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' WHERE wiki_key IN (' . $placeholders . ') ORDER BY name ASC');
        $statement->execute($wikiKeys);
    } else {
        $limit = max(1, min(500, $limit));
        $statement = $pdo->query('SELECT ' . $cols . ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' ORDER BY synced_at DESC LIMIT ' . $limit);
    }

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $raw = json_decode((string) ($row['raw_json'] ?? ''), true);
        $row['source_origin'] = is_array($raw) ? (string) ($raw['source_origin'] ?? '') : '';
        $row['affiliation_path'] = json_decode((string) ($row['affiliation_path_json'] ?? ''), true) ?: [];
        unset($row['raw_json'], $row['affiliation_path_json']);
        $items[] = $row;
    }

    return ['ok' => true, 'staging_table' => AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE, 'total' => $total, 'count' => count($items), 'items' => $items];
}

// Schreibt den normalisierten Datensatz spaltenbewusst ins Staging (_test). Crawler-only;
// political_territory_wiki bleibt unberuehrt (Promotion ist ein separater Schritt).
function avesmapsWikiSyncMonitorUpsertTestRecord(PDO $pdo, array $record): void {
    $columns = avesmapsWikiSyncMonitorStagingColumns($pdo);
    $write = [];
    foreach ($record as $key => $value) {
        if (isset($columns[$key]) && !in_array($key, ['id', 'synced_at'], true)) {
            $write[$key] = $value;
        }
    }

    if (
        !isset($write['wiki_key'], $write['name'])
        || trim((string) $write['wiki_key']) === ''
        || trim((string) $write['name']) === ''
    ) {
        throw new RuntimeException('Staging-Datensatz ohne wiki_key/name.');
    }

    $names = array_keys($write);
    $insertColumns = implode(', ', $names);
    $insertValues = ':' . implode(', :', $names);
    $updates = implode(', ', array_map(
        static fn(string $col): string => $col . ' = VALUES(' . $col . ')',
        array_values(array_filter($names, static fn(string $col): bool => $col !== 'wiki_key'))
    ));
    $sql = 'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' (' . $insertColumns . ', synced_at) VALUES ('
        . $insertValues . ', CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE ' . $updates . ', synced_at = CURRENT_TIMESTAMP(3)';

    $params = [];
    foreach ($write as $key => $value) {
        if (is_array($value)) {
            $params[$key] = $value === [] ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } elseif (is_string($value)) {
            $params[$key] = $value === '' ? null : $value;
        } else {
            $params[$key] = $value;
        }
    }

    $pdo->prepare($sql)->execute($params);
}
