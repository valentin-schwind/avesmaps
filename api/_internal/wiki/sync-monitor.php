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

// Coat-of-arms license enrichment lives in a sibling file (M5 split).
require_once __DIR__ . '/sync-monitor-licenses.php';
// Wiki page parsing (infobox/affiliation) lives in a sibling file (M5 split).
require_once __DIR__ . '/sync-monitor-parsing.php';
// Identity / coat / field-override apply lives in a sibling file (M5 split).
require_once __DIR__ . '/sync-monitor-identity.php';
// Model derivation + hierarchy editing lives in a sibling file (M5 split).
require_once __DIR__ . '/sync-monitor-model.php';
// Model tree / audit / wiki-rows view lives in a sibling file (M5 split).
require_once __DIR__ . '/sync-monitor-tree.php';

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
