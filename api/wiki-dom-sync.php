<?php

declare(strict_types=1);

define('AVESMAPS_WIKI_DOM_SOURCE_DIR', __DIR__);

$sourcePath = __DIR__ . '/wiki-dom-playground-seed.php';
$source = file_get_contents($sourcePath);
if (!is_string($source) || trim($source) === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Wiki-DOM-Sync-Quelle konnte nicht geladen werden.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$source = preg_replace('/^\s*<\?php\s*/u', '', $source, 1) ?? $source;
$source = str_replace('__DIR__', 'AVESMAPS_WIKI_DOM_SOURCE_DIR', $source);
$source = str_replace("const WIKI_DOM_TEST_TABLE = 'political_territory_wiki_test';", "const WIKI_DOM_TEST_TABLE = 'political_territory_wiki_test';\nconst WIKI_DOM_QUEUE_TABLE = 'political_territory_wiki_test_queue';", $source);
$source = str_replace("if (\$action === 'clear') { \$pdo->exec('TRUNCATE TABLE ' . WIKI_DOM_TEST_TABLE); jsonOut(['ok' => true, 'message' => 'Test-Tabelle geleert.']); }", "if (\$action === 'clear') { \$pdo->exec('TRUNCATE TABLE ' . WIKI_DOM_TEST_TABLE); \$pdo->exec('TRUNCATE TABLE ' . WIKI_DOM_QUEUE_TABLE); jsonOut(['ok' => true, 'message' => 'Test-Tabelle und Fortschritts-Queue geleert.']); }", $source);

$resumableRunImport = <<<'PHP'
function runImport(PDO $pdo, array $payload): void {
    $lock = acquireLock();
    $startedAt = microtime(true);
    try {
        @set_time_limit(0);
        ignore_user_abort(false);
        $options = options($payload);
        $catchwords = normalizeCatchwords($payload['catchwords'] ?? null);
        resetStaleQueueItems($pdo);
        $seeded = seedQueue($pdo, seedInputs($payload['seeds'] ?? defaultSeeds()));
        if (!queueHasAny($pdo)) throw new RuntimeException('Mindestens ein Seed ist erforderlich.');
        $events = [];
        $errors = [];
        $iterations = 0;
        $entrypoints = 0;
        $stored = 0;
        $skipped = 0;
        $childLinks = 0;
        while (true) {
            if (connection_aborted()) { $events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen.']; break; }
            if ((microtime(true) - $startedAt) >= $options['max_runtime_seconds']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Laufzeit erreicht. Fortsetzung ist mit erneutem Klick möglich.']; break; }
            if ($iterations >= $options['max_iterations']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Iterationszahl erreicht. Fortsetzung ist mit erneutem Klick möglich.']; break; }
            if ($stored >= $options['max_pages']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Territory-Seitenzahl erreicht. Fortsetzung ist mit erneutem Klick möglich.']; break; }
            $entry = takeNextQueueEntry($pdo);
            if ($entry === null) { $events[] = ['type' => 'complete', 'message' => 'Keine offenen Queue-Einträge mehr.']; break; }
            $iterations++;
            $queueId = (int) ($entry['id'] ?? 0);
            $title = title((string) ($entry['title'] ?? ''));
            $source = (string) ($entry['source'] ?? '');
            if ($title === '') { markQueueEntryDone($pdo, $queueId); continue; }
            try {
                if ($source !== 'entrypoint' && !isEntrypoint($title) && recordExistsByWikiUrl($pdo, pageUrl($title))) {
                    $skipped++;
                    markQueueEntryDone($pdo, $queueId);
                    $events[] = ['type' => 'skip', 'title' => $title, 'message' => 'Bereits in der Testtabelle vorhanden; Queue-Eintrag erledigt.'];
                    continue;
                }
                $html = fetchUrl(pageUrl($title), $options['request_timeout_seconds'], 'text/html,application/xhtml+xml');
                $xpath = xpath($html);
                $resolvedTitle = heading($xpath) ?: $title;
                if ($source === 'entrypoint' || isEntrypoint($title) || isEntrypoint($resolvedTitle)) {
                    $entrypoints++;
                    $links = entrypointLinks($xpath);
                    foreach ($links as $linkTitle) if (enqueueQueueEntry($pdo, $linkTitle, 'seed-list:' . $resolvedTitle)) $childLinks++;
                    markQueueEntryDone($pdo, $queueId);
                    $events[] = ['type' => 'entrypoint', 'title' => $resolvedTitle, 'links' => count($links), 'message' => 'Seed-Liste gelesen; Links in Fortschritts-Queue gespeichert.'];
                    sleepMs($options['sleep_ms']);
                    continue;
                }
                $domFields = fieldsFromHtml($xpath);
                $templateFields = [];
                try { $templateFields = fieldsFromInfoboxSource(fetchRaw($resolvedTitle, $options['request_timeout_seconds'])); }
                catch (Throwable $rawError) { $events[] = ['type' => 'raw-warning', 'title' => $resolvedTitle, 'message' => $rawError->getMessage()]; }
                $fields = array_replace($domFields, $templateFields);
                $path = affiliationPath($fields, $catchwords, $resolvedTitle);
                $temporal = temporalData($fields, $xpath, $catchwords);
                $children = childSections($xpath);
                $continent = detectContinent($resolvedTitle, $fields, $xpath);
                $heraldry = heraldryData($xpath);
                foreach ($children as $section) {
                    foreach (($section['items'] ?? []) as $child) {
                        $childTitle = (string) ($child['title'] ?? '');
                        if ($childTitle !== '' && enqueueQueueEntry($pdo, $childTitle, 'child-section:' . $resolvedTitle . ':' . (string) ($section['label'] ?? ''))) {
                            $childLinks++;
                        }
                    }
                }
                upsertRecord($pdo, buildRecord($resolvedTitle, $fields, $path, $temporal, $children, $continent, $heraldry));
                markQueueEntryDone($pdo, $queueId);
                $stored++;
            } catch (Throwable $error) {
                markQueueEntryError($pdo, $queueId, $error->getMessage());
                $errors[] = ['title' => $title, 'error' => $error->getMessage()];
            }
            sleepMs($options['sleep_ms']);
        }
        $result = readRows($pdo);
        $result['run'] = ['ok' => true, 'runtime_seconds' => round(microtime(true) - $startedAt, 3), 'iterations' => $iterations, 'entrypoint_pages' => $entrypoints, 'fetched_pages' => $stored, 'skipped_existing' => $skipped, 'queued_child_links' => $childLinks, 'queued_seed_links' => $seeded, 'queued_remaining' => (int) (queueStats($pdo)['pending'] ?? 0), 'queue' => queueStats($pdo), 'events' => $events, 'errors' => $errors, 'options' => $options];
        jsonOut($result);
    } finally { releaseLock($lock); }
}
PHP;
$source = preg_replace('/function runImport\(PDO \$pdo, array \$payload\): void \{.*?\n\}\n\nfunction defaultSeeds/s', $resumableRunImport . "\n\nfunction defaultSeeds", $source, 1) ?? $source;

$source = str_replace(
    "function options(array \$payload): array { \$d = defaultOptions(); return ['max_iterations' => max(1, min(WIKI_DOM_MAX_ITERATIONS, (int) (\$payload['max_iterations'] ?? \$d['max_iterations']))), 'max_pages' => max(1, min(WIKI_DOM_MAX_PAGES, (int) (\$payload['max_pages'] ?? \$d['max_pages']))), 'max_runtime_seconds' => max(3, min(WIKI_DOM_MAX_RUNTIME, (int) (\$payload['max_runtime_seconds'] ?? \$d['max_runtime_seconds']))), 'sleep_ms' => max(0, min(5000, (int) (\$payload['sleep_ms'] ?? \$d['sleep_ms']))), 'request_timeout_seconds' => max(3, min(20, (int) (\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'])))]; }",
    "function wikiDomPositiveInt(mixed \$value, int \$default, int \$min): int { \$number = filter_var(\$value, FILTER_VALIDATE_INT); if (\$number === false) \$number = \$default; return max(\$min, (int) \$number); }\nfunction options(array \$payload): array { \$d = defaultOptions(); return ['max_iterations' => wikiDomPositiveInt(\$payload['max_iterations'] ?? \$d['max_iterations'], \$d['max_iterations'], 1), 'max_pages' => wikiDomPositiveInt(\$payload['max_pages'] ?? \$d['max_pages'], \$d['max_pages'], 1), 'max_runtime_seconds' => wikiDomPositiveInt(\$payload['max_runtime_seconds'] ?? \$d['max_runtime_seconds'], \$d['max_runtime_seconds'], 3), 'sleep_ms' => wikiDomPositiveInt(\$payload['sleep_ms'] ?? \$d['sleep_ms'], \$d['sleep_ms'], 0), 'request_timeout_seconds' => wikiDomPositiveInt(\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'], \$d['request_timeout_seconds'], 3)]; }",
    $source
);

$source = str_replace(
    "function readRows(PDO \$pdo): array { \$stmt = \$pdo->query('SELECT id, wiki_key, name, type, continent, affiliation_root, affiliation_path_json, status, form_of_government, capital_name, seat_name, ruler, language, currency, trade_goods, population, founded_text, founded_start_bf, founded_end_bf, dissolved_text, dissolved_start_bf, dissolved_end_bf, geographic, political, trade_zone, blazon, coat_of_arms_url, wiki_url, raw_json, synced_at FROM ' . WIKI_DOM_TEST_TABLE . ' ORDER BY COALESCE(continent, affiliation_root, name), COALESCE(affiliation_root, name), name LIMIT 500'); \$items = []; while (\$row = \$stmt->fetch(PDO::FETCH_ASSOC)) { \$row['affiliation_path'] = decodeJson(\$row['affiliation_path_json'] ?? null); \$row['raw'] = decodeJson(\$row['raw_json'] ?? null); unset(\$row['affiliation_path_json'], \$row['raw_json']); \$items[] = \$row; } return ['ok' => true, 'table' => WIKI_DOM_TEST_TABLE, 'count' => count(\$items), 'items' => \$items]; }",
    "function readRows(PDO \$pdo): array { \$stmt = \$pdo->query('SELECT id, wiki_key, name, type, continent, affiliation_root, affiliation_path_json, status, form_of_government, capital_name, seat_name, ruler, language, currency, trade_goods, population, founded_text, founded_start_bf, founded_end_bf, dissolved_text, dissolved_start_bf, dissolved_end_bf, geographic, political, trade_zone, blazon, coat_of_arms_url, wiki_url, raw_json, synced_at FROM ' . WIKI_DOM_TEST_TABLE . ' ORDER BY COALESCE(continent, affiliation_root, name), COALESCE(affiliation_root, name), name LIMIT 500'); \$items = []; while (\$row = \$stmt->fetch(PDO::FETCH_ASSOC)) { \$row['affiliation_path'] = decodeJson(\$row['affiliation_path_json'] ?? null); \$row['raw'] = decodeJson(\$row['raw_json'] ?? null); unset(\$row['affiliation_path_json'], \$row['raw_json']); \$items[] = \$row; } return ['ok' => true, 'table' => WIKI_DOM_TEST_TABLE, 'count' => count(\$items), 'items' => \$items, 'queue' => queueStats(\$pdo)]; }",
    $source
);

$source = str_replace(
    "function ensureTestTable(PDO \$pdo): void { if (\$pdo->query(\"SHOW TABLES LIKE 'political_territory_wiki'\")->fetchColumn() === false) throw new RuntimeException('Basis-Tabelle political_territory_wiki fehlt.'); if (\$pdo->query(\"SHOW TABLES LIKE '\" . WIKI_DOM_TEST_TABLE . \"'\")->fetchColumn() === false) \$pdo->exec('CREATE TABLE ' . WIKI_DOM_TEST_TABLE . ' LIKE political_territory_wiki'); }",
    "function ensureTestTable(PDO \$pdo): void { if (\$pdo->query(\"SHOW TABLES LIKE 'political_territory_wiki'\")->fetchColumn() === false) throw new RuntimeException('Basis-Tabelle political_territory_wiki fehlt.'); if (\$pdo->query(\"SHOW TABLES LIKE '\" . WIKI_DOM_TEST_TABLE . \"'\")->fetchColumn() === false) \$pdo->exec('CREATE TABLE ' . WIKI_DOM_TEST_TABLE . ' LIKE political_territory_wiki'); if (\$pdo->query(\"SHOW TABLES LIKE '\" . WIKI_DOM_QUEUE_TABLE . \"'\")->fetchColumn() === false) \$pdo->exec('CREATE TABLE ' . WIKI_DOM_QUEUE_TABLE . ' (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, stable_key VARCHAR(190) NOT NULL, title VARCHAR(255) NOT NULL, source VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT \'pending\', attempts INT UNSIGNED NOT NULL DEFAULT 0, last_error TEXT NULL, discovered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY uq_stable_key (stable_key), KEY idx_status_id (status, id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'); }",
    $source
);

$queueFunctions = <<<'PHP'
function seedQueue(PDO $pdo, array $titles): int { $count = 0; foreach ($titles as $title) if (enqueueQueueEntry($pdo, $title, 'entrypoint')) $count++; return $count; }
function queueHasAny(PDO $pdo): bool { return (int) ($pdo->query('SELECT COUNT(*) FROM ' . WIKI_DOM_QUEUE_TABLE)->fetchColumn() ?: 0) > 0; }
function resetStaleQueueItems(PDO $pdo): void { $pdo->exec("UPDATE " . WIKI_DOM_QUEUE_TABLE . " SET status='pending', started_at=NULL WHERE status='processing' AND started_at < (CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND)"); }
function enqueueQueueEntry(PDO $pdo, string $pageTitle, string $source): bool { $pageTitle = title($pageTitle); $key = stableKey($pageTitle); if ($key === '' || $pageTitle === '') return false; $stmt = $pdo->prepare('INSERT INTO ' . WIKI_DOM_QUEUE_TABLE . ' (stable_key, title, source, status) VALUES (:key, :title, :source, \'pending\') ON DUPLICATE KEY UPDATE title=VALUES(title), source=IF(status IN (\'pending\', \'error\'), VALUES(source), source), status=IF(status=\'error\', \'pending\', status), updated_at=CURRENT_TIMESTAMP(3)'); $stmt->execute(['key' => $key, 'title' => $pageTitle, 'source' => mb_substr($source, 0, 255, 'UTF-8')]); return $stmt->rowCount() > 0; }
function takeNextQueueEntry(PDO $pdo): ?array { $pdo->beginTransaction(); try { $stmt = $pdo->query('SELECT id, title, source, attempts FROM ' . WIKI_DOM_QUEUE_TABLE . " WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE"); $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false; if (!is_array($row)) { $pdo->commit(); return null; } $update = $pdo->prepare('UPDATE ' . WIKI_DOM_QUEUE_TABLE . " SET status='processing', attempts=attempts+1, started_at=CURRENT_TIMESTAMP(3), last_error=NULL WHERE id=:id"); $update->execute(['id' => (int) $row['id']]); $pdo->commit(); return $row; } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; } }
function markQueueEntryDone(PDO $pdo, int $id): void { if ($id < 1) return; $stmt = $pdo->prepare('UPDATE ' . WIKI_DOM_QUEUE_TABLE . " SET status='done', finished_at=CURRENT_TIMESTAMP(3), last_error=NULL WHERE id=:id"); $stmt->execute(['id' => $id]); }
function markQueueEntryError(PDO $pdo, int $id, string $message): void { if ($id < 1) return; $stmt = $pdo->prepare('UPDATE ' . WIKI_DOM_QUEUE_TABLE . " SET status='error', finished_at=CURRENT_TIMESTAMP(3), last_error=:error WHERE id=:id"); $stmt->execute(['id' => $id, 'error' => mb_substr($message, 0, 2000, 'UTF-8')]); }
function queueStats(PDO $pdo): array { $stats = ['pending' => 0, 'processing' => 0, 'done' => 0, 'error' => 0, 'total' => 0]; try { foreach ($pdo->query('SELECT status, COUNT(*) AS count FROM ' . WIKI_DOM_QUEUE_TABLE . ' GROUP BY status') ?: [] as $row) { $status = (string) ($row['status'] ?? ''); $count = (int) ($row['count'] ?? 0); if ($status !== '') $stats[$status] = $count; $stats['total'] += $count; } } catch (Throwable $error) {} return $stats; }
PHP;
$source = str_replace('function heading(DOMXPath $xpath): string {', $queueFunctions . "\nfunction heading(DOMXPath \$xpath): string {", $source);

$tempPath = tempnam(sys_get_temp_dir(), 'avesmaps-wiki-dom-sync-');
if (!is_string($tempPath) || $tempPath === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Temporäre Sync-Datei konnte nicht erzeugt werden.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
file_put_contents($tempPath, "<?php\n" . $source);
register_shutdown_function(static function () use ($tempPath): void { @unlink($tempPath); });
require $tempPath;
