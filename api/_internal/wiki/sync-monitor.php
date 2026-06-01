<?php

declare(strict_types=1);

// Wiki-Sync-Monitor (Herrschaftsgebiete): eigene Tab-Surface fuer den ueberarbeiteten Crawler.
// Lebt bewusst NEBEN dem Legacy-WikiSync-Dispatcher. Schreibt das Hierarchie-Modell in EIGENE
// Sandbox-Tabellen (wiki_crawl_queue, wiki_territory_model). Tastet political_territory_wiki/
// _geometry NICHT an (Crawler-/Sync-Vertrag). parent_wiki_key = Wahrheit; political_territory.
// parent_id bleibt abgeleiteter Cache. Siehe memory/wiki-crawler-rework-prep.md.

const AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE = 'wiki_crawl_queue';
const AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE = 'wiki_territory_model';
const AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE = 'political_territory_wiki_test';
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
    if ($title === '' || str_contains($title, '#')) {
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

                $parsed = avesmapsWikiSyncMonitorParsePage($title, $content);
                if (!empty($parsed['is_territory']) && is_array($parsed['record'] ?? null)) {
                    avesmapsWikiSyncMonitorUpsertTestRecord($pdo, $parsed['record']);
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

    return [
        'ok' => true,
        'run_id' => $runId,
        'processed' => $processed,
        'discovered' => $discovered,
        'stored' => $stored,
        'skipped' => $skipped,
        'errors' => $errors,
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

// Parst den politischen Affiliation-String (Param `Staat`). Liefert bereinigten raw,
// Pfad (primaere Klausel, auf ':'/'>' gesplittet), root, [[Links]] (Eltern-Kandidaten)
// und die Konflikt-Klauseln (alles hinter dem ersten '/').
function avesmapsWikiSyncMonitorParseAffiliation(string $staatRaw): array {
    $raw = trim($staatRaw);
    if ($raw === '') {
        return ['raw' => '', 'path' => [], 'root' => '', 'links' => [], 'conflicts' => [], 'independent' => false];
    }

    $links = [];
    if (preg_match_all('/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/u', $raw, $linkMatches) !== false) {
        foreach (($linkMatches[1] ?? []) as $linkTarget) {
            $linkTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $linkTarget);
            if ($linkTitle !== '' && avesmapsWikiSyncMonitorIsRelevantTitle($linkTitle)) {
                $links[avesmapsPoliticalSlug($linkTitle)] = $linkTitle;
            }
        }
    }

    $clean = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($raw);
    $cleanKey = avesmapsWikiSyncMonitorFieldKey($clean);
    $independent = str_contains($cleanKey, 'unabh')
        || str_contains($cleanKey, 'eigenstand')
        || str_contains($cleanKey, 'souveran');

    $clauses = array_values(array_filter(
        array_map('trim', preg_split('#\s*/\s*#u', $clean) ?: []),
        static fn(string $clause): bool => $clause !== ''
    ));
    $primary = $clauses[0] ?? '';
    $conflicts = array_slice($clauses, 1);

    $path = [];
    foreach (preg_split('/\s*(?::|>|»|›)\s*/u', $primary) ?: [] as $part) {
        $part = trim(preg_replace('/\([^)]*\)/u', ' ', $part) ?? $part);
        $part = trim($part);
        if ($part === '') {
            continue;
        }
        $partKey = avesmapsWikiSyncMonitorFieldKey($part);
        if (
            str_starts_with($partKey, 'unabh')
            || str_starts_with($partKey, 'keine')
            || str_starts_with($partKey, 'unbekannt')
            || str_starts_with($partKey, 'ungeklart')
            || str_starts_with($partKey, 'umstritten')
        ) {
            continue;
        }
        $path[] = $part;
    }
    $path = array_values(array_unique($path));

    return [
        'raw' => $clean,
        'path' => $path,
        'root' => $path[0] ?? '',
        'links' => array_values($links),
        'conflicts' => $conflicts,
        'independent' => $independent,
    ];
}

function avesmapsWikiSyncMonitorParsePage(string $title, string $wikitext): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $infobox = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infobox);
    $fields = avesmapsWikiSyncReadWikiTemplateFields($wikitext);
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
        $independenceKey = avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $affiliation['raw']);
        $independentSettlement = $affiliation['independent']
            || str_contains($independenceKey, 'stadtstaat')
            || str_contains($independenceKey, 'eigenstand')
            || str_contains($independenceKey, 'unabh')
            || str_contains($independenceKey, 'souveran');
        if (!$independentSettlement) {
            return [
                'is_territory' => false,
                'reason' => 'Infobox ' . ($infobox !== '' ? $infobox : '?') . ' (abhaengige Siedlung)',
                'record' => null,
                'parent_titles' => [],
                'source_origin' => 'siedlung',
            ];
        }
        $sourceOrigin = 'siedlung';
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
        $name = $title;
    }
    $continent = $field(['kontinent']);
    if ($continent === '') {
        $continent = avesmapsWikiSyncMonitorDetectContinent(
            $title . ' ' . avesmapsWikiSyncMonitorField($norm, ['region', 'geographisch']) . ' ' . $affiliation['raw']
        );
    }

    $german = [
        'Name' => $name,
        'Typ' => $field(['art', 'typ', 'herrschaftsgebiet']),
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
        'Gründungsdatum' => $field(['grundungsdatum', 'grundung', 'gegrundet', 'unabhangigkeit', 'entstehung']),
        'Aufgelöst' => $field(['aufgelost', 'auflosung', 'besetzt', 'untergang', 'ende']),
        'Geographisch' => $field(['region', 'geographisch']),
        'Blasonierung' => $field(['blasonierung']),
        'Wiki-Link' => avesmapsWikiSyncMonitorPageUrl($title),
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

// Stichprobe/Zaehlung aus dem Staging (_test) zur Verifikation + spaeter fuers Diff/UI.
function avesmapsWikiSyncMonitorStagingSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $total = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)->fetchColumn() ?: 0);

    $cols = 'wiki_key, name, type, continent, affiliation_root, affiliation_path_json, status, capital_name, seat_name, coat_of_arms_url, founded_text, dissolved_text, raw_json, synced_at';
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
