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
// The global "Wappen: An/Aus" switch: editor_state reports its state, so the reader has to be here and
// not only in the endpoint -- five other endpoints include this file too.
require_once __DIR__ . '/../app/coat-display.php';

// Tabellen, Editorzustand und Status liegen in einer Geschwisterdatei (P-031).
require_once __DIR__ . '/sync-monitor-status.php';

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

require_once __DIR__ . '/wiki-crawler-base.php';

// Weiterreicher: der Rumpf stand hier dreifach wortgleich, nur die Queue-Tabelle war verschieden
// (P-024). Der Name bleibt, damit kein Aufrufer sich aendert.
function avesmapsWikiSyncMonitorEnqueue(PDO $pdo, string $runId, string $title, int $depth, string $role, string $source): int {
    return avesmapsWikiCrawlEnqueue($pdo, AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE, $runId, $title, $depth, $role, $source);
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
