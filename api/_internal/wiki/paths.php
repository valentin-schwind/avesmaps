<?php

declare(strict_types=1);

// WikiSync fuer WEGE (Fluesse + Strassen/Wege/Paesse/Karawanenrouten). Auf der Karte sind das
// `feature_type=path`-Features ("Wege bearbeiten"), KEINE Labels und KEINE Regionen. Bewusst
// schlank + getrennt von Regionen-/Herrschaftsgebiete-Sync, teilt aber deren Wiki-API-/Parse-
// Primitiven.
//
// Quelle: Wiki-Seiten mit {{Infobox Fluss}} (Fluesse) ODER {{Infobox Straße}} (Strassen/Paesse/
// Karawanenrouten). Beide Infoboxen haben dieselbe Grundstruktur: Name/Art/Länge/Regionen/Verlauf/Bild.
//
// Setzt voraus, dass der einbindende Endpoint zuvor geladen hat: sync.php, sync-monitor.php,
// political/territory.php (wie regions.php). map_features wird nur gelesen.

require_once __DIR__ . '/path-naming.php';

const AVESMAPS_WIKI_PATH_STAGING_TABLE = 'wiki_path_staging';
const AVESMAPS_WIKI_PATH_QUEUE_TABLE = 'wiki_path_queue';
const AVESMAPS_WIKI_PATH_MAX_DEPTH = 4;

function avesmapsWikiPathDefaultSeeds(): array {
    return [
        'Kategorie:Fluss',
        "Kategorie:Stra\u{00DF}e",
        "Kategorie:Reichsstra\u{00DF}e",
        'Kategorie:Pass',
        'Kategorie:Karawanenroute',
    ];
}

function avesmapsWikiPathEnsureTables(PDO $pdo): void {
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            match_key VARCHAR(255) NOT NULL DEFAULT \'\',
            kind VARCHAR(20) NOT NULL DEFAULT \'\',
            art VARCHAR(120) NULL,
            continent VARCHAR(120) NULL,
            lage VARCHAR(500) NULL,
            laenge VARCHAR(120) NULL,
            verlauf VARCHAR(1000) NULL,
            description TEXT NULL,
            synonyms_json JSON NULL,
            source_categories_json JSON NULL,
            image_url VARCHAR(500) NULL,
            image_license VARCHAR(120) NULL,
            image_author VARCHAR(255) NULL,
            image_attribution VARCHAR(500) NULL,
            image_license_status VARCHAR(40) NULL,
            image_license_url VARCHAR(500) NULL,
            wiki_url VARCHAR(500) NULL,
            raw_json JSON NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_path_staging_key (wiki_key),
            KEY idx_wiki_path_staging_match (match_key),
            KEY idx_wiki_path_staging_kind (kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . ' (
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
            UNIQUE KEY uq_wiki_path_queue_run_dedup (run_id, dedup_key),
            KEY idx_wiki_path_queue_run_status (run_id, status),
            KEY idx_wiki_path_queue_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function avesmapsWikiPathBuildStatus(PDO $pdo): array {
    avesmapsWikiPathEnsureTables($pdo);
    $tables = [];
    foreach ([AVESMAPS_WIKI_PATH_STAGING_TABLE, AVESMAPS_WIKI_PATH_QUEUE_TABLE] as $table) {
        $tables[$table] = [
            'exists' => avesmapsWikiSyncMonitorTableExists($pdo, $table),
            'row_count' => avesmapsWikiSyncMonitorCountRows($pdo, $table),
            'columns' => avesmapsWikiSyncMonitorColumns($pdo, $table),
        ];
    }
    return ['ok' => true, 'max_depth' => AVESMAPS_WIKI_PATH_MAX_DEPTH, 'tables' => $tables];
}

function avesmapsWikiPathEnqueue(PDO $pdo, string $runId, string $title, int $depth, string $role, string $source): int {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    if ($title === '') {
        return 0;
    }
    $dedupKey = avesmapsPoliticalSlug($title);
    if ($dedupKey === '') {
        return 0;
    }
    $statement = $pdo->prepare(
        'INSERT IGNORE INTO ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . '
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

function avesmapsWikiPathStartRun(PDO $pdo, array $seeds, array $options = []): array {
    avesmapsWikiPathEnsureTables($pdo);
    $seeds = array_values(array_filter(array_map('strval', $seeds), static fn(string $s): bool => trim($s) !== ''));
    if ($seeds === []) {
        $seeds = avesmapsWikiPathDefaultSeeds();
    }
    $runId = avesmapsPoliticalUuidV4();
    $maxDepth = max(1, min(AVESMAPS_WIKI_PATH_MAX_DEPTH, (int) ($options['max_depth'] ?? AVESMAPS_WIKI_PATH_MAX_DEPTH)));
    $seeded = 0;
    $byRole = ['category' => 0, 'page' => 0];
    foreach ($seeds as $seed) {
        $title = avesmapsWikiSyncMonitorNormalizeTitle((string) $seed);
        if ($title === '') {
            continue;
        }
        $role = preg_match('/^(Kategorie|Category):/iu', $title) === 1 ? 'category' : 'page';
        $inserted = avesmapsWikiPathEnqueue($pdo, $runId, $title, 0, $role, 'seed');
        if ($inserted > 0) {
            $seeded += $inserted;
            $byRole[$role] += $inserted;
        }
    }
    if ($seeded === 0) {
        throw new RuntimeException('Mindestens ein gueltiger Seed ist erforderlich.');
    }
    return ['ok' => true, 'run_id' => $runId, 'max_depth' => $maxDepth, 'seeded' => $seeded, 'seeded_by_role' => $byRole];
}

function avesmapsWikiPathFetchCategory(string $categoryTitle): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($categoryTitle);
    if (preg_match('/^(Kategorie|Category):/iu', $title) !== 1) {
        $title = 'Kategorie:' . $title;
    }
    $pages = [];
    $subcats = [];
    $continue = null;
    $guard = 0;
    do {
        $params = [
            'action' => 'query',
            'list' => 'categorymembers',
            'cmtitle' => $title,
            'cmlimit' => (string) AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT,
            'cmtype' => 'page|subcat',
            'format' => 'json',
        ];
        if ($continue !== null) {
            $params['cmcontinue'] = $continue;
        }
        $data = avesmapsWikiSyncApiRequest($params);
        foreach (($data['query']['categorymembers'] ?? []) as $member) {
            $memberTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) ($member['title'] ?? ''));
            if ($memberTitle === '') {
                continue;
            }
            if ((int) ($member['ns'] ?? 0) === 14) {
                $subcats[avesmapsPoliticalSlug($memberTitle)] = $memberTitle;
            } elseif (avesmapsWikiSyncMonitorIsRelevantTitle($memberTitle)) {
                $pages[avesmapsPoliticalSlug($memberTitle)] = $memberTitle;
            }
        }
        $continue = isset($data['continue']['cmcontinue']) ? (string) $data['continue']['cmcontinue'] : null;
        $guard++;
    } while ($continue !== null && $guard < 40 && (count($pages) + count($subcats)) < AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_MAX);
    return ['pages' => array_values($pages), 'subcats' => array_values($subcats)];
}

function avesmapsWikiPathCrawlStep(PDO $pdo, string $runId, array $options = []): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }
    avesmapsWikiPathEnsureTables($pdo);
    $maxDepth = max(1, min(AVESMAPS_WIKI_PATH_MAX_DEPTH, (int) ($options['max_depth'] ?? AVESMAPS_WIKI_PATH_MAX_DEPTH)));
    $batchLimit = max(1, min(200, (int) ($options['batch_limit'] ?? AVESMAPS_WIKI_SYNC_MONITOR_BATCH_LIMIT)));
    $stepRuntime = max(3, min(28, (int) ($options['step_runtime'] ?? AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    $select = $pdo->prepare(
        'SELECT id, wiki_title, depth, role, source FROM ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . '
        WHERE run_id = :run_id AND status = \'pending\'
        ORDER BY FIELD(role, \'category\', \'page\'), depth ASC, id ASC
        LIMIT ' . $batchLimit
    );
    $select->execute(['run_id' => $runId]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $markDone = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . '
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
        $source = (string) ($row['source'] ?? '');

        if ($role === 'page') {
            $pageBatch[] = ['id' => $id, 'title' => $title, 'depth' => $depth, 'source' => $source];
            continue;
        }
        try {
            $members = avesmapsWikiPathFetchCategory($title);
            foreach ($members['pages'] as $page) {
                $discovered += avesmapsWikiPathEnqueue($pdo, $runId, $page, $depth + 1, 'page', 'category:' . $title);
            }
            if ($depth < $maxDepth) {
                foreach ($members['subcats'] as $subcat) {
                    $discovered += avesmapsWikiPathEnqueue($pdo, $runId, $subcat, $depth + 1, 'category', 'subcat:' . $title);
                }
            }
            $events[] = ['type' => 'category', 'title' => $title, 'pages' => count($members['pages']), 'subcats' => count($members['subcats'])];
            avesmapsWikiSyncMonitorSleep($sleepMs);
            $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
            $processed++;
        } catch (Throwable $error) {
            $errors++;
            $markDone->execute(['status' => 'error', 'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'), 'id' => $id]);
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
        // Kontinent-Detection braucht die Wiki-Kategorien (z. B. "Myranor-Artikel"); der Content-Fetch oben
        // liefert sie nicht -> separat ziehen (Titel -> Kategorien-String). Best-effort.
        $categoriesByTitle = [];
        try {
            foreach (avesmapsWikiSyncFetchPagesByRequestedTitle($pdo, $titles, true, false) as $catTitle => $catPage) {
                $categoriesByTitle[(string) $catTitle] = implode(' ', avesmapsWikiSyncGetCategoryNames(is_array($catPage) ? $catPage : []));
            }
        } catch (Throwable $error) {
            $categoriesByTitle = [];
        }
        $canonical = avesmapsWikiSyncMonitorResolveCanonicalTitles($titles);

        foreach ($pageBatch as $page) {
            $id = (int) $page['id'];
            $title = (string) $page['title'];
            $source = (string) ($page['source'] ?? '');
            try {
                $content = (string) ($contents[$title] ?? '');
                if (trim($content) === '') {
                    $markDone->execute(['status' => 'done', 'error_text' => 'kein Wiki-Inhalt', 'id' => $id]);
                    $skipped++;
                    $processed++;
                    continue;
                }
                $canonicalTitle = (string) ($canonical[$title] ?? $title);
                $parsed = avesmapsWikiPathParsePage($title, $content, $canonicalTitle, $source, (string) ($categoriesByTitle[$title] ?? ''));
                if (!empty($parsed['is_path']) && is_array($parsed['record'] ?? null)) {
                    avesmapsWikiPathUpsertRecord($pdo, $parsed['record']);
                    $stored++;
                    $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
                } else {
                    $skipped++;
                    $markDone->execute(['status' => 'done', 'error_text' => mb_substr((string) ($parsed['reason'] ?? 'kein Weg'), 0, 500, 'UTF-8'), 'id' => $id]);
                }
                $processed++;
            } catch (Throwable $error) {
                $errors++;
                $markDone->execute(['status' => 'error', 'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'), 'id' => $id]);
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
        'status' => avesmapsWikiPathRunStatus($pdo, $runId),
    ];
}

// Parst eine Wiki-Seite mit {{Infobox Fluss}} ODER {{Infobox Straße}} in einen Staging-Record.
function avesmapsWikiPathParsePage(string $title, string $wikitext, string $canonicalTitle = '', string $source = '', string $categories = ''): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infoboxName = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infoboxName); // "Straße" -> "strasse", "Fluss" -> "fluss"

    $isFluss = str_contains($infoboxKey, 'fluss');
    $isStrasse = str_contains($infoboxKey, 'strasse');
    if (!$isFluss && !$isStrasse) {
        return ['is_path' => false, 'reason' => $infoboxName === '' ? 'kein Infobox' : ('Infobox ' . $infoboxName), 'record' => null];
    }
    $kind = $isFluss ? 'fluss' : 'strasse';

    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, $aliases));

    $name = $field(['name']);
    if ($name === '') {
        $name = $canonical;
    }
    $art = $field(['art', 'typ']);
    $lage = $field(['regionen', 'region', 'lage']);
    $laenge = $field(['lange', 'langen', 'lenge']);

    // Verlauf: geordnete Stationen aus den [[Links]] der Verlauf-Templatekette.
    $verlaufRaw = avesmapsWikiSyncMonitorField($norm, ['verlauf']);
    $stations = [];
    if (preg_match_all('/\[\[([^\]]+)\]\]/u', $verlaufRaw, $vm) >= 1) {
        foreach ($vm[1] as $linkText) {
            $parts = explode('|', (string) $linkText);
            $station = trim((string) end($parts));
            if ($station !== '' && !str_contains($station, ':')) {
                $stations[] = $station;
            }
        }
    }
    $verlauf = mb_substr(implode(' → ', array_slice(array_values(array_unique($stations)), 0, 30)), 0, 1000, 'UTF-8');

    $navHints = '';
    if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
        $navHints = implode(' ', $navMatches[1]);
    }
    $continent = avesmapsWikiSyncMonitorDetectContinent($title . ' ' . $lage . ' ' . $navHints . ' ' . $categories);

    $synonyms = [];
    if (preg_match_all('/\{\{\s*Synonym\s*\|([^}]*)\}\}/iu', $wikitext, $synMatches) >= 1) {
        foreach ($synMatches[1] as $syn) {
            foreach (preg_split('/\s*[|,]\s*/u', (string) $syn) ?: [] as $part) {
                $part = trim(avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($part));
                if ($part !== '') {
                    $synonyms[] = $part;
                }
            }
        }
    }
    if ($canonical !== '' && $canonical !== $name) {
        $synonyms[] = $canonical;
    }
    if ($title !== '' && $title !== $name && $title !== $canonical) {
        $synonyms[] = $title;
    }
    $synonyms = array_values(array_unique(array_filter($synonyms)));

    $record = [
        'wiki_key' => avesmapsPoliticalSlug($canonical),
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'name' => mb_substr($name, 0, 255, 'UTF-8'),
        'match_key' => avesmapsWikiSyncCreateMatchKey($name),
        'kind' => $kind,
        'art' => mb_substr($art, 0, 120, 'UTF-8'),
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'lage' => mb_substr($lage, 0, 500, 'UTF-8'),
        'laenge' => mb_substr($laenge, 0, 120, 'UTF-8'),
        'verlauf' => $verlauf,
        'description' => avesmapsWikiPathExtractDescription($wikitext, $block),
        'synonyms_json' => $synonyms,
        'source_categories_json' => $source !== '' ? [$source] : [],
        'image_url' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['bild', 'bilddatei'])),
        'wiki_url' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'raw_json' => ['source' => 'wiki-path-sync', 'infobox' => $infoboxName, 'kind' => $kind],
    ];

    if (trim((string) $record['wiki_key']) === '' || trim((string) $record['name']) === '') {
        return ['is_path' => false, 'reason' => 'leerer Name/Key', 'record' => null];
    }
    return ['is_path' => true, 'reason' => '', 'record' => $record];
}

function avesmapsWikiPathExtractDescription(string $wikitext, string $infoboxBlock): string {
    $rest = $wikitext;
    if ($infoboxBlock !== '') {
        $pos = strpos($wikitext, $infoboxBlock);
        if ($pos !== false) {
            $rest = substr($wikitext, $pos + strlen($infoboxBlock));
        }
    }
    $paragraph = [];
    foreach (preg_split('/\R/u', $rest) ?: [] as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') {
            if ($paragraph !== []) {
                break;
            }
            continue;
        }
        if ($paragraph === [] && (
            str_starts_with($trimmed, '{{') || str_starts_with($trimmed, '|') || str_starts_with($trimmed, '}')
            || str_starts_with($trimmed, '==') || str_starts_with($trimmed, '*') || str_starts_with($trimmed, '#')
            || str_starts_with($trimmed, ':') || str_starts_with($trimmed, '<') || str_starts_with($trimmed, '!')
            || preg_match('/^\[\[\s*(Datei|File|Bild|Kategorie|Category)\s*:/iu', $trimmed) === 1
        )) {
            continue;
        }
        $paragraph[] = $trimmed;
        if (mb_strlen(implode(' ', $paragraph), 'UTF-8') > 700) {
            break;
        }
    }
    $text = trim(implode(' ', $paragraph));
    $text = preg_replace('/<ref[^>]*>.*?<\/ref>/su', '', $text) ?? $text;
    $text = preg_replace('/<ref[^>]*\/>/su', '', $text) ?? $text;
    $text = preg_replace('/<\/?[a-zA-Z][^>]*>/u', '', $text) ?? $text;
    $text = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($text);
    $text = str_replace(["'''", "''"], '', $text);
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    return mb_substr($text, 0, 1200, 'UTF-8');
}

function avesmapsWikiPathUpsertRecord(PDO $pdo, array $record): void {
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . '
            (wiki_key, title, name, match_key, kind, art, continent, lage, laenge, verlauf, description,
             synonyms_json, source_categories_json, image_url, wiki_url, raw_json, synced_at)
        VALUES
            (:wiki_key, :title, :name, :match_key, :kind, :art, :continent, :lage, :laenge, :verlauf, :description,
             :synonyms_json, :source_categories_json, :image_url, :wiki_url, :raw_json, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            title = VALUES(title), name = VALUES(name), match_key = VALUES(match_key), kind = VALUES(kind),
            art = VALUES(art), continent = VALUES(continent), lage = VALUES(lage), laenge = VALUES(laenge),
            verlauf = VALUES(verlauf), description = VALUES(description), synonyms_json = VALUES(synonyms_json),
            source_categories_json = VALUES(source_categories_json), image_url = VALUES(image_url),
            wiki_url = VALUES(wiki_url), raw_json = VALUES(raw_json), synced_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute([
        'wiki_key' => (string) $record['wiki_key'],
        'title' => (string) $record['title'],
        'name' => (string) $record['name'],
        'match_key' => (string) $record['match_key'],
        'kind' => (string) ($record['kind'] ?? ''),
        'art' => (string) ($record['art'] ?? ''),
        'continent' => (string) ($record['continent'] ?? ''),
        'lage' => (string) ($record['lage'] ?? ''),
        'laenge' => (string) ($record['laenge'] ?? ''),
        'verlauf' => (string) ($record['verlauf'] ?? ''),
        'description' => (string) ($record['description'] ?? ''),
        'synonyms_json' => avesmapsWikiSyncEncodeJson($record['synonyms_json'] ?? []),
        'source_categories_json' => avesmapsWikiSyncEncodeJson($record['source_categories_json'] ?? []),
        'image_url' => (string) ($record['image_url'] ?? ''),
        'wiki_url' => (string) ($record['wiki_url'] ?? ''),
        'raw_json' => avesmapsWikiSyncEncodeJson($record['raw_json'] ?? []),
    ]);
}

function avesmapsWikiPathRunStatus(PDO $pdo, string $runId): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }
    avesmapsWikiPathEnsureTables($pdo);
    $counts = ['pending' => 0, 'claimed' => 0, 'done' => 0, 'error' => 0, 'skipped' => 0];
    $byRole = [];
    $total = 0;
    $statement = $pdo->prepare('SELECT role, status, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . ' WHERE run_id = :run_id GROUP BY role, status');
    $statement->execute(['run_id' => $runId]);
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $status = (string) $row['status'];
        $count = (int) $row['c'];
        $counts[$status] = ($counts[$status] ?? 0) + $count;
        $byRole[(string) $row['role']][$status] = $count;
        $total += $count;
    }
    return [
        'ok' => true,
        'run_id' => $runId,
        'total' => $total,
        'pending' => $counts['pending'],
        'done' => $counts['done'],
        'error' => $counts['error'],
        'by_role' => $byRole,
        'staging_rows' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_PATH_STAGING_TABLE),
        'complete' => $counts['pending'] === 0,
    ];
}

function avesmapsWikiPathStagingSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiPathEnsureTables($pdo);
    $limit = max(1, min(200, $limit));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key IN (' . $placeholders . ') ORDER BY name LIMIT ' . $limit);
        $statement->execute(array_values($wikiKeys));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $rows = $pdo->query('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' ORDER BY synced_at DESC, id DESC LIMIT ' . $limit)->fetchAll(PDO::FETCH_ASSOC);
    }
    foreach ($rows as &$row) {
        foreach (['synonyms_json', 'source_categories_json', 'raw_json'] as $col) {
            if (array_key_exists($col, $row)) {
                $row[$col] = avesmapsWikiSyncDecodeJson($row[$col]);
            }
        }
    }
    unset($row);
    $byKind = $pdo->query('SELECT COALESCE(NULLIF(kind, \'\'), \'(leer)\') AS kind, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' GROUP BY kind ORDER BY c DESC')->fetchAll(PDO::FETCH_KEY_PAIR);
    $byArt = $pdo->query('SELECT COALESCE(NULLIF(art, \'\'), \'(leer)\') AS art, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' GROUP BY art ORDER BY c DESC')->fetchAll(PDO::FETCH_KEY_PAIR);
    return [
        'ok' => true,
        'total' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_PATH_STAGING_TABLE),
        'count' => count($rows),
        'by_kind' => $byKind,
        'by_art' => $byArt,
        'rows' => $rows,
    ];
}

function avesmapsWikiPathClear(PDO $pdo, string $target, string $runId = ''): array {
    avesmapsWikiPathEnsureTables($pdo);
    $target = trim($target);
    $cleared = [];
    if ($target === 'queue' || $target === 'all') {
        if (trim($runId) !== '') {
            $statement = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE . ' WHERE run_id = :run_id');
            $statement->execute(['run_id' => trim($runId)]);
            $cleared['queue'] = $statement->rowCount();
        } else {
            $cleared['queue'] = (int) $pdo->exec('DELETE FROM ' . AVESMAPS_WIKI_PATH_QUEUE_TABLE);
        }
    }
    if ($target === 'staging' || $target === 'all') {
        $cleared['staging'] = (int) $pdo->exec('DELETE FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE);
    }
    if ($cleared === []) {
        throw new RuntimeException('Unbekanntes clear-Ziel: ' . $target . ' (erlaubt: queue|staging|all)');
    }
    return ['ok' => true, 'cleared' => $cleared];
}

function avesmapsWikiPathSearch(PDO $pdo, string $query, int $limit = 30): array {
    avesmapsWikiPathEnsureTables($pdo);
    $limit = max(1, min(100, $limit));
    $query = trim($query);
    $columns = 'wiki_key, name, kind, art, continent, lage, laenge, verlauf, description, synonyms_json, '
        . 'image_url, image_license, image_author, image_attribution, image_license_status, image_license_url, wiki_url, synced_at';
    if ($query === '') {
        $rows = $pdo->query('SELECT ' . $columns . ' FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' ORDER BY name ASC LIMIT ' . $limit)->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $matchKey = avesmapsWikiSyncCreateMatchKey($query);
        $statement = $pdo->prepare(
            'SELECT ' . $columns . ' FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . '
            WHERE name LIKE :like OR match_key LIKE :keylike
            ORDER BY (match_key = :exactkey) DESC, CHAR_LENGTH(name) ASC, name ASC
            LIMIT ' . $limit
        );
        $statement->execute(['like' => '%' . $query . '%', 'keylike' => '%' . $matchKey . '%', 'exactkey' => $matchKey]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    }
    foreach ($rows as &$row) {
        if (array_key_exists('synonyms_json', $row)) {
            $row['synonyms_json'] = avesmapsWikiSyncDecodeJson($row['synonyms_json']);
        }
    }
    unset($row);
    return ['ok' => true, 'count' => count($rows), 'rows' => $rows];
}

// Karten-Wege (feature_type='path') nach Match-Key (Name) indiziert.
function avesmapsWikiPathReadMapPaths(PDO $pdo): array {
    if (!avesmapsWikiSyncMonitorTableExists($pdo, 'map_features')) {
        return [];
    }
    $statement = $pdo->query(
        'SELECT public_id, name, feature_subtype FROM map_features
        WHERE is_active = 1 AND feature_type = \'path\' AND name IS NOT NULL AND name <> \'\''
    );
    $byKey = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $key = avesmapsWikiSyncCreateMatchKey($name);
        if ($key === '') {
            continue;
        }
        $byKey[$key][] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
        ];
    }
    return $byKey;
}

function avesmapsWikiPathMatch(PDO $pdo, array $options = []): array {
    avesmapsWikiPathEnsureTables($pdo);
    $continentFilter = array_key_exists('continent', $options) ? trim((string) $options['continent']) : 'Aventurien';
    $sampleLimit = max(0, min(2000, (int) ($options['limit'] ?? 500)));

    $pathsByKey = avesmapsWikiPathReadMapPaths($pdo);
    $mapPathCount = array_sum(array_map('count', $pathsByKey));

    $rows = $pdo->query(
        'SELECT wiki_key, name, match_key, kind, art, continent, lage, laenge, synonyms_json, image_url, wiki_url
        FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC);

    $matched = [];
    $ambiguous = [];
    $missing = [];
    $consideredKeys = [];
    $processed = 0;

    foreach ($rows as $row) {
        $continent = (string) ($row['continent'] ?? '');
        if ($continentFilter !== '' && $continent !== '' && $continent !== $continentFilter) {
            continue;
        }
        $processed++;
        // Nur exakter Name-Match (KEINE Synonyme): Synonyme zogen sonst fremde Wege herein
        // (z.B. „Kvill"-Segmente an „Amper", weil das Wiki Kvill als Synonym fuehrt) — und das
        // Zuordnen nutzt ohnehin nur den match_key. So ist die Anzeige konsistent mit dem Write.
        $keys = array_values(array_filter([(string) ($row['match_key'] ?? '')], static fn(string $k): bool => $k !== ''));
        foreach ($keys as $k) {
            $consideredKeys[$k] = true;
        }
        $hits = [];
        foreach ($keys as $k) {
            foreach (($pathsByKey[$k] ?? []) as $path) {
                $hits[$path['public_id'] !== '' ? $path['public_id'] : $path['name']] = $path;
            }
        }
        $entry = [
            'wiki_key' => (string) $row['wiki_key'],
            'name' => (string) $row['name'],
            'kind' => (string) ($row['kind'] ?? ''),
            'art' => (string) ($row['art'] ?? ''),
            'continent' => $continent,
            'lage' => (string) ($row['lage'] ?? ''),
            'laenge' => (string) ($row['laenge'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'has_image' => trim((string) ($row['image_url'] ?? '')) !== '',
        ];
        if ($hits === []) {
            $missing[] = $entry;
        } elseif (count($hits) === 1) {
            $entry['path'] = array_values($hits)[0];
            $matched[] = $entry;
        } else {
            $entry['paths'] = array_values($hits);
            $ambiguous[] = $entry;
        }
    }

    $unmatchedPaths = [];
    foreach ($pathsByKey as $key => $paths) {
        if (!isset($consideredKeys[$key])) {
            foreach ($paths as $path) {
                $unmatchedPaths[] = $path;
            }
        }
    }

    usort($missing, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
    usort($matched, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
    usort($unmatchedPaths, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));

    return [
        'ok' => true,
        'continent_filter' => $continentFilter,
        'summary' => [
            'staging_total' => count($rows),
            'considered' => $processed,
            'map_paths' => $mapPathCount,
            'matched' => count($matched),
            'ambiguous' => count($ambiguous),
            'missing' => count($missing),
            'unmatched_map_paths' => count($unmatchedPaths),
        ],
        'matched' => $sampleLimit > 0 ? array_slice($matched, 0, $sampleLimit) : [],
        'ambiguous' => array_slice($ambiguous, 0, 300),
        'missing' => $sampleLimit > 0 ? array_slice($missing, 0, max($sampleLimit, 1200)) : [],
        'unmatched_map_paths' => array_slice($unmatchedPaths, 0, 500),
    ];
}

// Der Wiki-Datensatz, der an ein Path-Feature geheftet wird (properties.wiki_path).
function avesmapsWikiPathBuildAssignObject(array $stagingRow): array {
    return [
        'wiki_key' => (string) ($stagingRow['wiki_key'] ?? ''),
        'name' => (string) ($stagingRow['name'] ?? ''),
        'kind' => (string) ($stagingRow['kind'] ?? ''),
        'art' => (string) ($stagingRow['art'] ?? ''),
        'lage' => (string) ($stagingRow['lage'] ?? ''),
        'laenge' => (string) ($stagingRow['laenge'] ?? ''),
        'verlauf' => (string) ($stagingRow['verlauf'] ?? ''),
        'description' => (string) ($stagingRow['description'] ?? ''),
        'image_url' => (string) ($stagingRow['image_url'] ?? ''),
        'image_license_status' => (string) ($stagingRow['image_license_status'] ?? ''),
        'wiki_url' => (string) ($stagingRow['wiki_url'] ?? ''),
        'synced_at' => (string) ($stagingRow['synced_at'] ?? ''),
    ];
}

// Weg-Identitaet fuer die weg-weiten Operationen -- avesmapsWikiPathClearAssign (Entfernen) und
// den Bulk-avesmapsWikiPathAssign (WikiSync-Panel, Re-Stamp per Staging-wiki_key): ein Segment
// gehoert zum Ziel-Weg, wenn sein NAME denselben Match-Key traegt ODER es bereits demselben
// Wiki-Weg zugeordnet ist (wiki_path.wiki_key). Der wiki_key ist die verlaessliche Identitaet:
// Bestands-Zuweisungen tragen noch die Phase-1-Random-Namen (z.B. Reichsstrasse-89), die nie
// einen gemeinsamen Namens-Key hatten. NICHT von avesmapsWikiPathAssignTo (Zuweisen/Aendern)
// genutzt -- das matcht bewusst nur exakt gleichnamige Segmente (chirurgisch, kein wiki_key-Union).
function avesmapsWikiPathRowMatchesWay(string $rowName, ?string $rowPropertiesJson, string $targetKey, string $targetWikiKey): bool {
    if ($targetKey !== '' && avesmapsWikiSyncCreateMatchKey($rowName) === $targetKey) {
        return true;
    }
    if ($targetWikiKey === '' || $rowPropertiesJson === null || $rowPropertiesJson === '') {
        return false;
    }
    // Billiger Vorfilter auf dem Roh-JSON (json_encode schreibt ASCII-Keys ohne Leerzeichen;
    // das schliessende Anfuehrungszeichen verhindert reichsstrasse-1 vs. -11); der exakte
    // Vergleich nach dem Decode schuetzt vor Vorkommen des Fragments in Textfeldern.
    if (strpos($rowPropertiesJson, '"wiki_key":"' . $targetWikiKey . '"') === false) {
        return false;
    }
    $props = avesmapsWikiSyncDecodeJson($rowPropertiesJson);

    return (string) ($props['wiki_path']['wiki_key'] ?? '') === $targetWikiKey;
}

// Heftet einen Wiki-Weg an ALLE aktiven Path-Features mit gleichem (normalisiertem) Namen ODER
// bereits bestehender Zuordnung zu diesem Wiki-Weg (Weg-Identitaet, s.o.).
// Gated: dry_run zaehlt nur; Schreiben nur bei dry_run:false. map_features-Write (Produktion).
function avesmapsWikiPathAssign(PDO $pdo, string $wikiKey, bool $dryRun, int $userId = 0): array {
    avesmapsWikiPathEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $statement->execute(['k' => $wikiKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Wiki-Weg nicht im Staging: ' . $wikiKey);
    }
    $targetKey = (string) ($row['match_key'] ?? '');
    if ($targetKey === '') {
        $targetKey = avesmapsWikiSyncCreateMatchKey((string) $row['name']);
    }
    $assignObject = avesmapsWikiPathBuildAssignObject($row);

    $paths = $pdo->query("SELECT id, public_id, name, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $targets = [];
    foreach ($paths as $p) {
        if (avesmapsWikiPathRowMatchesWay((string) $p['name'], $p['properties_json'] ?? null, $targetKey, $wikiKey)) {
            $targets[] = $p;
        }
    }

    $applied = 0;
    $canonicalName = avesmapsWikiPathCanonicalName($assignObject);
    if (!$dryRun && $targets !== []) {
        $revision = avesmapsWikiSyncNextMapRevision($pdo);
        $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
        foreach ($targets as $p) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $newName = $canonicalName !== '' ? $canonicalName : (string) $p['name'];
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            $props['wiki_path'] = $assignObject;
            $props['name'] = $newName;
            $props['display_name'] = $newName;
            $update->execute(['name' => $newName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, $newName);
            $applied++;
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'wiki_key' => $wikiKey,
        'wiki_name' => (string) $row['name'],
        'wiki_display_name' => $canonicalName,
        'match_key' => $targetKey,
        'segments' => count($targets),
        'segment_names' => array_values(array_unique(array_map(static fn(array $p): string => (string) $p['name'], array_slice($targets, 0, 8)))),
        'applied' => $applied,
    ];
}

// Re-Targeting: heftet einen Wiki-Weg an EIN auf der Karte gewaehltes Ziel-Segment und alle
// EXAKT gleichnamigen Segmente (chirurgisch -- KEINE wiki_key-Union hier, s.
// avesmapsWikiPathRowMatchesWay). Weg-weites Umziehen ergibt sich ueber die konvergierten
// R1-Namen (nach einem Sync tragen alle Segmente eines Wegs den kanonischen Wiki-Namen); ein
// Alt-Buendel mit uneinheitlichen Namen muss zuerst per Entfernen aufgeloest werden (das raeumt
// auch wiki_key-Geister). Mit Typ-Pruefung (Fluss <-> Strasse/Weg). Gated.
// Mit single_segment:true wird NUR das Ziel-Segment erfasst (kein Namens-Gruppen-Match).
function avesmapsWikiPathAssignTo(PDO $pdo, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false): array {
    avesmapsWikiPathEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $publicId = trim($publicId);
    if ($wikiKey === '' || $publicId === '') {
        throw new RuntimeException('wiki_key/public_id fehlt.');
    }
    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $statement->execute(['k' => $wikiKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Wiki-Weg nicht im Staging: ' . $wikiKey);
    }
    $targetStatement = $pdo->prepare('SELECT name, feature_subtype FROM map_features WHERE public_id = :p AND feature_type = \'path\' LIMIT 1');
    $targetStatement->execute(['p' => $publicId]);
    $target = $targetStatement->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        throw new RuntimeException('Ziel-Weg nicht gefunden.');
    }

    $targetSubtype = strtolower((string) ($target['feature_subtype'] ?? ''));
    $targetIsRiver = $targetSubtype === 'flussweg' || $targetSubtype === 'seeweg';
    $wikiIsRiver = ((string) ($row['kind'] ?? '')) === 'fluss';
    if ($wikiIsRiver !== $targetIsRiver) {
        return [
            'ok' => true,
            'type_ok' => false,
            'message' => '„' . (string) $row['name'] . '" ist ' . ($wikiIsRiver ? 'ein Fluss' : 'eine Straße/Weg')
                . ', das Ziel „' . (string) $target['name'] . '" ist ' . ($targetIsRiver ? 'ein Fluss' : 'eine Straße/Weg') . '.',
            'dry_run' => $dryRun,
            'applied' => 0,
            'segments_updated' => [],
        ];
    }

    $targetKey = avesmapsWikiSyncCreateMatchKey((string) $target['name']);
    $assignObject = avesmapsWikiPathBuildAssignObject($row);
    // R1: the assigned wiki way names the way. '' (unusable staging row) keeps existing names.
    $canonicalName = avesmapsWikiPathCanonicalName($assignObject);
    $paths = $pdo->query("SELECT id, public_id, name, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $segments = 0;
    $applied = 0;
    $revision = null;
    $segmentsUpdated = [];
    foreach ($paths as $p) {
        // single_segment: chirurgisches Umhaengen NUR des Ziel-Segments -- noetig, wenn sein
        // Name mit der Kanon-Gruppe eines ANDEREN Wegs kollidiert (der Namens-Match wuerde
        // sonst den fremden Weg mit umstempeln).
        if ($singleSegment && (string) $p['public_id'] !== $publicId) {
            continue;
        }
        if (avesmapsWikiSyncCreateMatchKey((string) $p['name']) !== $targetKey) {
            continue;
        }
        $segments++;
        if (!$dryRun) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $newName = $canonicalName !== '' ? $canonicalName : (string) $p['name'];
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            $props['wiki_path'] = $assignObject;
            $props['name'] = $newName;
            $props['display_name'] = $newName;
            $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
            $update->execute(['name' => $newName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, $newName);
            $applied++;
            // The editor applies these locally so its expected_revision stays fresh (409 fix).
            $segmentsUpdated[] = [
                'public_id' => (string) $p['public_id'],
                'revision' => $revision,
                'name' => $newName,
                'display_name' => $newName,
                'wiki_path' => $assignObject,
            ];
        }
    }
    return [
        'ok' => true,
        'type_ok' => true,
        'dry_run' => $dryRun,
        'wiki_name' => (string) $row['name'],
        'wiki_display_name' => $canonicalName,
        'target_name' => (string) $target['name'],
        'segments' => $segments,
        'applied' => $applied,
        'segments_updated' => $segmentsUpdated,
    ];
}

// Bulk: verknuepft in EINEM Durchlauf alle Karten-Wege, deren Name zu einem Staging-Weg passt
// (= matched + ambiguous; missing haben kein Segment). Gated wie assign.
// NICHT auf R1-Umbenennung umgestellt: Bulk ueber tausende Zeilen (STRATO). Namen konvergieren
// beim naechsten assign_to/Details-Save (R1 wird dort server-seitig erzwungen).
function avesmapsWikiPathAssignAll(PDO $pdo, string $continentFilter, bool $dryRun): array {
    avesmapsWikiPathEnsureTables($pdo);
    $continentFilter = trim($continentFilter);

    $byKey = [];
    foreach ($pdo->query('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE)->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cont = (string) ($r['continent'] ?? '');
        if ($continentFilter !== '' && $cont !== '' && $cont !== $continentFilter) {
            continue;
        }
        $key = (string) ($r['match_key'] ?? '');
        if ($key === '') {
            $key = avesmapsWikiSyncCreateMatchKey((string) $r['name']);
        }
        if ($key !== '' && !isset($byKey[$key])) {
            $byKey[$key] = avesmapsWikiPathBuildAssignObject($r);
        }
    }

    $paths = $pdo->query("SELECT id, name, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $segments = 0;
    $wikiLinked = [];
    $revision = null;
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    foreach ($paths as $p) {
        $key = avesmapsWikiSyncCreateMatchKey((string) $p['name']);
        if (!isset($byKey[$key])) {
            continue;
        }
        $segments++;
        $wikiLinked[$byKey[$key]['wiki_key']] = true;
        if (!$dryRun) {
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            $props['wiki_path'] = $byKey[$key];
            $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'continent_filter' => $continentFilter,
        'segments_affected' => $segments,
        'wiki_paths_linked' => count($wikiLinked),
        'applied' => $dryRun ? 0 : $segments,
    ];
}

// Entfernt die Wiki-Zuordnung vom ganzen Weg (Namens-Key ODER bereits zugeordneter wiki_key des
// Ziel-Segments, Weg-Identitaet s.o.; per public_id eines Segments) -- Entfernen wirkt bewusst
// weg-weit (Namens-Key UNION wiki_key), das raeumt auch Geister-Traeger auf, die unter alten
// Code-Staenden nie sauber entkoppelt wurden. Anders als beim Entfernen bekommt aber JEDES
// Segment einen EIGENEN generischen `<Subtype>-<n>`-Namen (owner-reported blast radius 2026-07-05:
// EIN gemeinsamer Name klebte vormals distinkte Segmente aneinander -- ein spaeteres Zuweisen auf
// eines von ihnen riss dann alle mit hinein). Die Gruppe loest sich beim Entfernen also bewusst auf.
function avesmapsWikiPathClearAssign(PDO $pdo, string $publicId, bool $dryRun, int $userId = 0): array {
    avesmapsWikiPathEnsureTables($pdo);
    $publicId = trim($publicId);
    if ($publicId === '') {
        throw new RuntimeException('public_id fehlt.');
    }
    $statement = $pdo->prepare("SELECT name, feature_subtype, properties_json FROM map_features WHERE public_id = :pid AND feature_type = 'path' LIMIT 1");
    $statement->execute(['pid' => $publicId]);
    $target = $statement->fetch(PDO::FETCH_ASSOC);
    $name = (string) ($target['name'] ?? '');
    if ($name === '') {
        throw new RuntimeException('Weg nicht gefunden: ' . $publicId);
    }
    $targetKey = avesmapsWikiSyncCreateMatchKey($name);
    $targetProps = avesmapsWikiSyncDecodeJson($target['properties_json'] ?? null);
    $targetWikiKey = (string) ($targetProps['wiki_path']['wiki_key'] ?? '');

    $paths = $pdo->query("SELECT id, public_id, name, feature_subtype, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    // R2: JEDES Segment bekommt einen EIGENEN generischen Namen (Phase-1-Schema) -- die
    // Gruppe loest sich auf, damit selektives Neu-Zuweisen kein Alt-Buendel einsammelt.
    // Der Pool waechst pro vergebenem Namen mit (kollisionsfrei ueber alle Subtypen).
    $namePool = array_map(static fn(array $p): string => (string) $p['name'], $paths);
    $applied = 0;
    $matchCount = 0;
    $revision = null;
    $anchorGenericName = '';
    $segmentsUpdated = [];
    foreach ($paths as $p) {
        if (!avesmapsWikiPathRowMatchesWay((string) $p['name'], $p['properties_json'] ?? null, $targetKey, $targetWikiKey)) {
            continue;
        }
        $matchCount++;
        $genericName = avesmapsWikiPathNextGenericName((string) ($p['feature_subtype'] ?? 'Weg'), $namePool);
        $namePool[] = $genericName;
        if ((string) $p['public_id'] === $publicId) {
            $anchorGenericName = $genericName;
        }
        if (!$dryRun) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            if (array_key_exists('wiki_path', $props)) {
                unset($props['wiki_path']);
                $applied++;
            }
            $props['name'] = $genericName;
            $props['display_name'] = $genericName;
            $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
            $update->execute(['name' => $genericName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, $genericName);
            $segmentsUpdated[] = [
                'public_id' => (string) $p['public_id'],
                'revision' => $revision,
                'name' => $genericName,
                'display_name' => $genericName,
                'wiki_path' => null,
            ];
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'name' => $name,
        'generic_name' => $anchorGenericName,
        'segments' => $matchCount,
        'applied' => $applied,
        'segments_updated' => $segmentsUpdated,
    ];
}
