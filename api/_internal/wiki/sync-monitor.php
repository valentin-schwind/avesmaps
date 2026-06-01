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

    $value = preg_replace('/\{\{\s*BF\s*\|\s*(-?\d{1,5})[^}]*\}\}/iu', '$1 BF', $value) ?? $value;
    $value = preg_replace_callback('/\{\{\s*Datum\s*\|([^}]*)\}\}/iu', static function (array $match): string {
        $parts = array_map('trim', explode('|', (string) $match[1]));
        $year = $parts[0] ?? '';
        return preg_match('/^-?\d{1,5}$/', $year) === 1 ? ($year . ' BF') : '';
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
            if ($linkTitle !== '' && avesmapsWikiSyncMonitorIsRelevantTitle($linkTitle)) {
                $links[avesmapsPoliticalSlug($linkTitle)] = $linkTitle;
            }
        }
    }

    $clean = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($raw);

    $clauses = array_values(array_filter(
        array_map('trim', preg_split('#\s*[;/]\s*#u', $clean) ?: []),
        static fn(string $clause): bool => $clause !== ''
    ));

    $primary = '';
    $conflicts = [];
    foreach ($clauses as $clause) {
        // Zeit-/Historik-Klausel ("bis ING 1021 BF Teil von …", "seit 1000 BF …") = KEIN aktueller
        // Elternteil (nur die heutige Zugehoerigkeit zaehlt fuer die Hierarchie).
        if (preg_match('/^\s*(?:bis|seit)\s+/iu', $clause) === 1) {
            continue;
        }
        // Prefixe abschneiden -> dahinter steht der eigentliche Elternteil.
        $stripped = trim((string) (preg_replace('/^\s*(?:beansprucht\s+von|teil\s+von|teil\s+des|geh[oö]rt\s+zu)\s+/iu', '', $clause) ?? $clause));
        if (avesmapsWikiSyncMonitorIsQualifierOnly($stripped)) {
            continue; // reiner Status-/Zeit-Zusatz (ehemalige Reichsstadt, umstritten) = weder Eltern noch Konflikt
        }
        if ($primary === '') {
            $primary = $stripped;
        } else {
            $conflicts[] = $stripped; // echte konkurrierende Eltern-Klausel
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

    return [
        'raw' => $clean,
        'path' => $path,
        'root' => $path[0] ?? '',
        'links' => array_values($links),
        'conflicts' => $conflicts,
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
        // ex, z.B. {{Reichsstadt|ex|..}}) ODER (b) eigenstaendig/Stadtstaat. Sonst = reine
        // Siedlung (Havena, Nivesel) -> raus. (Nutzer-Regel, an Harben/Nivesel festgezurrt.)
        $staatRaw = avesmapsWikiSyncMonitorField($norm, ['staat', 'staatpolitisch', 'zugehorigkeitpolitisch', 'politischezugehorigkeit', 'politisch']);
        $isReichsstadt = preg_match('/\{\{\s*Reichsstadt\b/iu', $staatRaw) === 1
            || str_contains(avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $infobox), 'reichsstadt');
        $independenceKey = avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $affiliation['raw']);
        $independentSettlement = $affiliation['independent']
            || str_contains($independenceKey, 'stadtstaat')
            || str_contains($independenceKey, 'eigenstand')
            || str_contains($independenceKey, 'unabh')
            || str_contains($independenceKey, 'souveran');
        if (!$isReichsstadt && !$independentSettlement) {
            return [
                'is_territory' => false,
                'reason' => 'Infobox ' . ($infobox !== '' ? $infobox : '?') . ' (reine Siedlung)',
                'record' => null,
                'parent_titles' => [],
                'source_origin' => 'siedlung',
            ];
        }
        $sourceOrigin = $isReichsstadt ? 'reichsstadt' : 'siedlung';
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
function avesmapsWikiSyncMonitorResolveParentKey(string $name, array $index, array $aliasMap = []): array {
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
            $resolved = avesmapsWikiSyncMonitorResolveParentKey((string) $path[count($path) - 1], $index, $aliasMap);
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

    $sql = 'SELECT t.id, t.wiki_key, t.name, t.slug, t.is_active, t.parent_id,
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

// Komplettes Modell flach (fuers UI: Baum + Status-Marker). Markiert Luecken (parent
// referenziert, aber selbst kein Knoten) + Konflikte + Lizenz-Status.
function avesmapsWikiSyncMonitorModelTree(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $rows = $pdo->query(
        'SELECT m.wiki_key, m.parent_wiki_key, m.parent_locked, m.excluded, m.auto_parent_wiki_key, m.source_origin,
                m.parent_conflict_json, s.name, s.type, s.continent, s.affiliation_raw, s.wiki_url,
                s.founded_text, s.dissolved_text, s.coat_of_arms_url, s.coat_of_arms_license,
                s.coat_of_arms_author, s.coat_of_arms_attribution, s.coat_of_arms_license_status
        FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s ON s.wiki_key = m.wiki_key
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
            'continent' => (string) ($row['continent'] ?? ''),
            'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'founded_text' => (string) ($row['founded_text'] ?? ''),
            'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
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
            'has_conflict' => $conflictNames !== [],
            'conflicts' => $conflictNames,
            'aliases' => $aliases,
            'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
            'license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
        ];
    }

    return ['ok' => true, 'count' => count($nodes), 'nodes' => $nodes];
}

// Block 2: liefert die Modell-Knoten im Format des Wiki-Tree (political-territory-wiki.php),
// ABER mit der HIERARCHIE AUS DEM MODELL: affiliation_path = Ahnen-Kette (root-first) aus
// parent_wiki_key. So nistet der bestehende buildTree nach dem Modell, ohne Tree-Modul-Umbau.
// Aussortierte Knoten raus. map_assigned aus political_territory-Geometriezuweisung.
function avesmapsWikiSyncMonitorWikiRows(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $parent = [];
    $excluded = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key, excluded FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $m) {
        $wk = (string) $m['wiki_key'];
        $parent[$wk] = $m['parent_wiki_key'] !== null ? (string) $m['parent_wiki_key'] : null;
        if ((int) ($m['excluded'] ?? 0) === 1) {
            $excluded[$wk] = true;
        }
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
    $nameOf = static fn(string $wk): string => isset($rowsByKey[$wk]) ? (string) $rowsByKey[$wk]['name'] : '';

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
