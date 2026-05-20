<?php

declare(strict_types=1);

if (!function_exists('avesmapsNormalizeSingleLine')) {
    function avesmapsNormalizeSingleLine(string $value, int $maxLength = 500): string {
        $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        $value = trim($value);
        return $maxLength > 0 ? mb_substr($value, 0, $maxLength, 'UTF-8') : $value;
    }
}

require_once __DIR__ . '/political-territory-lib.php';

const WIKI_DOM_TEST_TABLE = 'political_territory_wiki_test';
const WIKI_DOM_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
const WIKI_DOM_RAW_BASE_URL = 'https://de.wiki-aventurica.de/index.php?title=';
const WIKI_DOM_LOCK_FILE = __DIR__ . '/wiki-dom-playground.lock';
const WIKI_DOM_MAX_ITERATIONS = 160;
const WIKI_DOM_MAX_PAGES = 100;
const WIKI_DOM_MAX_RUNTIME = 35;

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) jsonOut(['ok' => false, 'error' => 'config.local.php fehlt.'], 500);
$config = require $configPath;
if (!is_array($config) || !isset($config['database']) || !is_array($config['database'])) jsonOut(['ok' => false, 'error' => 'config.local.php liefert keine gültige database-Konfiguration.'], 500);
applyCors($config['cors']['allowed_origins'] ?? []);
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

try {
    $pdo = createPdo($config['database']);
    ensureTestTable($pdo);
    $action = trim((string) ($_GET['action'] ?? 'list'));
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = readBody();
        if ($action === 'run') runImport($pdo, $payload);
        if ($action === 'clear') { $pdo->exec('TRUNCATE TABLE ' . WIKI_DOM_TEST_TABLE); jsonOut(['ok' => true, 'message' => 'Test-Tabelle geleert.']); }
        jsonOut(['ok' => false, 'error' => 'Unbekannte POST-Action.'], 400);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') jsonOut(['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.'], 405);
    if ($action === 'defaults') jsonOut(['ok' => true, 'defaults' => defaultOptions(), 'seeds' => defaultSeeds(), 'catchwords' => defaultCatchwords()]);
    if ($action === 'list') jsonOut(readRows($pdo));
    jsonOut(['ok' => false, 'error' => 'Unbekannte GET-Action.'], 400);
} catch (Throwable $error) {
    jsonOut(['ok' => false, 'error' => $error->getMessage()], 500);
}

function runImport(PDO $pdo, array $payload): void {
    $lock = acquireLock();
    $startedAt = microtime(true);
    try {
        @set_time_limit(WIKI_DOM_MAX_RUNTIME + 10);
        ignore_user_abort(false);
        $options = options($payload);
        $catchwords = normalizeCatchwords($payload['catchwords'] ?? null);
        $queue = [];
        $queued = [];
        foreach (seedInputs($payload['seeds'] ?? defaultSeeds()) as $title) enqueue($queue, $queued, $title, 'entrypoint');
        if ($queue === []) throw new RuntimeException('Mindestens ein Seed ist erforderlich.');

        $events = [];
        $errors = [];
        $iterations = 0;
        $entrypoints = 0;
        $stored = 0;
        $skipped = 0;

        while ($queue !== []) {
            if (connection_aborted()) { $events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen.']; break; }
            if ((microtime(true) - $startedAt) >= $options['max_runtime_seconds']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Laufzeit erreicht.']; break; }
            if ($iterations >= $options['max_iterations']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Iterationszahl erreicht.']; break; }
            if ($stored >= $options['max_pages']) { $events[] = ['type' => 'limit', 'message' => 'Maximale Territory-Seitenzahl erreicht.']; break; }

            $iterations++;
            $entry = array_shift($queue);
            $title = title((string) ($entry['title'] ?? ''));
            $source = (string) ($entry['source'] ?? '');
            if ($title === '') continue;

            try {
                if ($source !== 'entrypoint' && !isEntrypoint($title) && recordExistsByWikiUrl($pdo, pageUrl($title))) {
                    $skipped++;
                    $events[] = ['type' => 'skip', 'title' => $title, 'message' => 'Bereits in der Testtabelle vorhanden; per wiki_url übersprungen.'];
                    continue;
                }

                $html = fetchUrl(pageUrl($title), $options['request_timeout_seconds'], 'text/html,application/xhtml+xml');
                $xpath = xpath($html);
                $resolvedTitle = heading($xpath) ?: $title;

                if ($source === 'entrypoint' || isEntrypoint($title) || isEntrypoint($resolvedTitle)) {
                    $entrypoints++;
                    $links = entrypointLinks($xpath);
                    foreach ($links as $linkTitle) enqueue($queue, $queued, $linkTitle, 'seed-list:' . $resolvedTitle);
                    $events[] = ['type' => 'entrypoint', 'title' => $resolvedTitle, 'links' => count($links), 'message' => 'Seed-Liste gelesen, aber nicht gespeichert.'];
                    sleepMs($options['sleep_ms']);
                    continue;
                }

                $domFields = fieldsFromHtml($xpath);
                $templateFields = [];
                try {
                    $templateFields = fieldsFromInfoboxSource(fetchRaw($resolvedTitle, $options['request_timeout_seconds']));
                } catch (Throwable $rawError) {
                    $events[] = ['type' => 'raw-warning', 'title' => $resolvedTitle, 'message' => $rawError->getMessage()];
                }
                $fields = array_replace($domFields, $templateFields);
                $path = affiliationPath($fields, $catchwords);
                $temporal = temporalData($fields, $xpath, $catchwords);
                upsertRecord($pdo, buildRecord($resolvedTitle, $fields, $path, $temporal));
                $stored++;
            } catch (Throwable $error) {
                $errors[] = ['title' => $title, 'error' => $error->getMessage()];
            }
            sleepMs($options['sleep_ms']);
        }

        $result = readRows($pdo);
        $result['run'] = ['ok' => true, 'runtime_seconds' => round(microtime(true) - $startedAt, 3), 'iterations' => $iterations, 'entrypoint_pages' => $entrypoints, 'fetched_pages' => $stored, 'skipped_existing' => $skipped, 'queued_remaining' => count($queue), 'relations' => 0, 'events' => $events, 'errors' => $errors, 'options' => $options];
        $result['relations'] = [];
        jsonOut($result);
    } finally { releaseLock($lock); }
}

function defaultSeeds(): array {
    return ['Baronie/Liste', 'Bergkönigreich/Liste', 'Domäne (Horasreich)/Liste', 'Emirat/Liste', 'Freiherrschaft/Liste', 'Fürstentum/Liste', 'Grafschaft/Liste', 'Herzogtum/Liste', 'Kaiserliches Eigengut/Liste', 'Komturei/Liste', 'Königreich/Liste', 'Markgrafschaft/Liste', 'Pfalzgrafschaft/Liste', 'Provinz (Imperium)/Liste', 'Provinz (Mittelreich)/Liste', 'Reichsmark/Liste', 'Republik/Liste', 'Shîkanydad/Liste', 'Staat/Liste', 'Sultanat/Liste', 'Theokratie/Liste'];
}

function defaultCatchwords(): array {
    return [
        'affiliation_path_labels' => ['staat', 'staatverlauf', 'zugehörigkeit', 'zugehoerigkeit', 'politisch', 'reich', 'oberherrschaft'],
        'founded_labels' => ['gründungsdatum', 'gruendungsdatum', 'gründung', 'gruendung', 'gründungsdaten', 'gruendungsdaten', 'unabhängigkeit', 'unabhaengigkeit', 'gegründet', 'gegruendet', 'entstehung', 'ausrufung'],
        'dissolved_labels' => ['aufgelöst', 'aufgeloest', 'auflösung', 'aufloesung', 'ende', 'untergang', 'zerfall', 'aufgegeben'],
        'period_labels' => ['zeitraum', 'bestehen', 'bestand', 'bestandszeit', 'existenz'],
        'year_markers' => ['BF', 'v. BF', 'v BF'],
        'founded_context_words' => ['gegründet', 'gegruendet', 'gründung', 'gruendung', 'gründungsdatum', 'gruendungsdatum', 'gründungsdaten', 'gruendungsdaten', 'unabhängigkeit', 'unabhaengigkeit', 'entstand', 'entstehung', 'ausgerufen', 'ausrufung'],
        'dissolved_context_words' => ['aufgelöst', 'aufgeloest', 'auflösung', 'aufloesung', 'endete', 'untergang', 'zerfiel', 'zerfall', 'aufgegeben'],
    ];
}

function defaultOptions(): array { return ['max_iterations' => 30, 'max_pages' => 20, 'max_runtime_seconds' => 20, 'sleep_ms' => 450, 'request_timeout_seconds' => 8]; }
function options(array $payload): array { $d = defaultOptions(); return ['max_iterations' => max(1, min(WIKI_DOM_MAX_ITERATIONS, (int) ($payload['max_iterations'] ?? $d['max_iterations']))), 'max_pages' => max(1, min(WIKI_DOM_MAX_PAGES, (int) ($payload['max_pages'] ?? $d['max_pages']))), 'max_runtime_seconds' => max(3, min(WIKI_DOM_MAX_RUNTIME, (int) ($payload['max_runtime_seconds'] ?? $d['max_runtime_seconds']))), 'sleep_ms' => max(0, min(5000, (int) ($payload['sleep_ms'] ?? $d['sleep_ms']))), 'request_timeout_seconds' => max(3, min(20, (int) ($payload['request_timeout_seconds'] ?? $d['request_timeout_seconds'])))]; }

function normalizeCatchwords(mixed $value): array {
    if (is_string($value) && trim($value) !== '') { $decoded = json_decode($value, true); if (is_array($decoded)) $value = $decoded; }
    if (!is_array($value)) $value = [];
    $catchwords = defaultCatchwords();
    foreach ($catchwords as $key => $items) {
        $custom = $value[$key] ?? $items;
        if (!is_array($custom)) $custom = $items;
        $catchwords[$key] = array_values(array_unique(array_filter(array_map(static fn(mixed $item): string => labelKey((string) $item), $custom))));
    }
    return $catchwords;
}

function seedInputs(mixed $seeds): array {
    if (is_string($seeds)) $seeds = preg_split('/\R+/', $seeds) ?: [];
    if (!is_array($seeds)) return [];
    $titles = [];
    foreach ($seeds as $seed) {
        $seed = trim((string) $seed);
        if ($seed === '') continue;
        if (preg_match('/^https?:\/\/de\.wiki-aventurica\.de\/wiki\/(.+)$/i', $seed, $match) === 1) $titles[] = title(rawurldecode((string) $match[1]));
        elseif (preg_match('/^https?:\/\//i', $seed) !== 1) $titles[] = title($seed);
    }
    return array_values(array_unique(array_filter($titles)));
}

function fetchRaw(string $pageTitle, int $timeout): string { return fetchUrl(WIKI_DOM_RAW_BASE_URL . rawurlencode(str_replace(' ', '_', title($pageTitle))) . '&action=raw', $timeout, 'text/plain,text/x-wiki,text/*'); }
function fetchUrl(string $url, int $timeout, string $accept): string {
    $headers = ['User-Agent: AvesmapsWikiDomPlayground/0.6 (https://avesmaps.de/)', 'Accept: ' . $accept];
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl !== false) {
            curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => min(8, $timeout), CURLOPT_TIMEOUT => $timeout, CURLOPT_HTTPHEADER => $headers, CURLOPT_ENCODING => '']);
            $content = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $error = curl_error($curl);
            curl_close($curl);
            if (is_string($content) && trim($content) !== '' && $status >= 200 && $status < 400) return $content;
            throw new RuntimeException('Abruf fehlgeschlagen: HTTP ' . $status . ($error !== '' ? ' / ' . $error : '') . ' / ' . $url);
        }
    }
    $context = stream_context_create(['http' => ['method' => 'GET', 'timeout' => $timeout, 'header' => implode("\r\n", $headers) . "\r\n"]]);
    $content = @file_get_contents($url, false, $context);
    if (is_string($content) && trim($content) !== '') return $content;
    throw new RuntimeException('Antwort leer oder nicht abrufbar: ' . $url);
}

function xpath(string $html): DOMXPath { if (!class_exists(DOMDocument::class)) throw new RuntimeException('PHP-DOM-Erweiterung fehlt.'); $document = new DOMDocument(); @$document->loadHTML('<?xml encoding="UTF-8">' . $html); return new DOMXPath($document); }
function fieldsFromHtml(DOMXPath $xpath): array {
    $fields = [];
    foreach ($xpath->query('//tr[th and td] | //div[contains(@class,"infobox")]//tr | //table[contains(@class,"infobox")]//tr') ?: [] as $row) {
        if (!$row instanceof DOMElement) continue;
        $th = $row->getElementsByTagName('th')->item(0);
        $td = $row->getElementsByTagName('td')->item(0);
        if (!$th instanceof DOMNode || !$td instanceof DOMNode) continue;
        $key = labelKey($th->textContent ?? '');
        $value = cleanText($td->textContent ?? '');
        if ($key !== '' && $value !== '' && !isset($fields[$key])) $fields[$key] = $value;
    }
    return $fields;
}

function fieldsFromInfoboxSource(string $source): array {
    $template = extractTemplate($source, 'Infobox Staat');
    if ($template === '') return [];
    $fields = [];
    foreach (parseTemplateParameters($template) as $key => $value) {
        $cleanKey = labelKey($key);
        $cleanValue = cleanWikiValue($value);
        if ($cleanKey !== '' && $cleanValue !== '') $fields[$cleanKey] = $cleanValue;
    }
    return $fields;
}

function parseTemplateParameters(string $template): array {
    $params = [];
    $currentKey = null;
    $currentValue = '';
    $depth = 0;
    foreach (preg_split('/\R/u', $template) ?: [] as $line) {
        if ($depth === 0 && preg_match('/^\s*\|\s*([^=\n]+?)\s*=\s*(.*)$/u', $line, $match) === 1) {
            if ($currentKey !== null) $params[$currentKey] = $currentValue;
            $currentKey = trim((string) $match[1]);
            $currentValue = (string) $match[2];
        } elseif ($currentKey !== null) {
            $currentValue .= "\n" . $line;
        }
        $depth = templateDepth($currentValue);
    }
    if ($currentKey !== null) $params[$currentKey] = $currentValue;
    return $params;
}

function templateDepth(string $value): int {
    $opens = preg_match_all('/\{\{/u', $value);
    $closes = preg_match_all('/\}\}/u', $value);
    return max(0, (int) $opens - (int) $closes);
}

function extractTemplate(string $source, string $name): string {
    $start = mb_strpos($source, '{{' . $name, 0, 'UTF-8');
    if ($start === false) return '';
    $length = mb_strlen($source, 'UTF-8');
    $depth = 0;
    for ($i = $start; $i < $length - 1; $i++) {
        $pair = mb_substr($source, $i, 2, 'UTF-8');
        if ($pair === '{{') { $depth++; $i++; continue; }
        if ($pair === '}}') {
            $depth--;
            if ($depth === 0) {
                $innerStart = $start + mb_strlen('{{' . $name, 'UTF-8');
                return mb_substr($source, $innerStart, $i - $innerStart, 'UTF-8');
            }
            $i++;
        }
    }
    return '';
}

function entrypointLinks(DOMXPath $xpath): array {
    $links = [];
    foreach (['//div[contains(@class,"mw-parser-output")]//table//tr[td]//td[1]//a[@href]', '//div[contains(@class,"mw-parser-output")]//table//tr[td]//a[@href]', '//div[contains(@class,"mw-parser-output")]//ul//li//a[@href]'] as $query) {
        foreach ($xpath->query($query) ?: [] as $node) {
            if (!$node instanceof DOMElement) continue;
            $target = titleFromHref((string) $node->getAttribute('href'));
            $text = cleanText($node->textContent ?? '');
            if ($target === '' || isEntrypoint($target) || !isRelevantTitle($target) || $text === '' || mb_strlen($text, 'UTF-8') < 2) continue;
            $links[stableKey($target)] = $target;
        }
        if ($links !== []) break;
    }
    return array_values($links);
}

function affiliationPath(array $fields, array $catchwords): array {
    foreach ($catchwords['affiliation_path_labels'] as $label) {
        if (!isset($fields[$label]) || trim((string) $fields[$label]) === '') continue;
        $raw = trim((string) $fields[$label]);
        $value = preg_replace('/\b(?:geographisch|geografisch)\b\s*:?\s*[^;]+;?/iu', ' ', $raw) ?? $raw;
        $value = preg_replace('/\bpolitisch\b\s*:?\s*/iu', '', $value) ?? $value;
        $parts = preg_split('/\s*(?::|>|→|›|»|;|,\s*(?=[A-ZÄÖÜ]))\s*/u', $value) ?: [];
        $path = [];
        foreach ($parts as $part) {
            $part = cleanText($part);
            if ($part !== '' && preg_match('/\b(unabhaengig|unabhängig|keine|unbekannt|ungeklaert|ungeklärt|umstritten)\b/iu', $part) !== 1) $path[] = $part;
        }
        $path = array_values(array_unique($path));
        if ($path !== []) return ['raw' => $raw, 'path' => $path, 'source_field' => $label];
    }
    return ['raw' => '', 'path' => [], 'source_field' => ''];
}

function temporalData(array $fields, DOMXPath $xpath, array $catchwords): array {
    $items = [];
    foreach ($fields as $key => $value) {
        if (in_array($key, $catchwords['founded_labels'], true)) $items[] = temporalItem('founded', (string) $value, 'field', $key, 0.96);
        elseif (in_array($key, $catchwords['dissolved_labels'], true)) $items[] = temporalItem('dissolved', (string) $value, 'field', $key, 0.96);
        elseif (in_array($key, $catchwords['period_labels'], true)) $items = array_merge($items, periodItems((string) $value, $key));
    }
    foreach ($xpath->query('//p | //li | //tr[th and td]') ?: [] as $node) {
        $text = cleanText($node instanceof DOMNode ? ($node->textContent ?? '') : '');
        if ($text === '' || bfYears($text) === []) continue;
        if (containsAny($text, $catchwords['founded_context_words'])) $items[] = temporalItem('founded', snippet($text, $catchwords['founded_context_words']), 'sentence', '', 0.74);
        if (containsAny($text, $catchwords['dissolved_context_words'])) $items[] = temporalItem('dissolved', snippet($text, $catchwords['dissolved_context_words']), 'sentence', '', 0.72);
    }
    return dedupeTemporal($items);
}

function periodItems(string $text, string $field): array { $parts = preg_split('/\s*(?:-|–|—|bis)\s*/u', $text) ?: []; $items = []; if (isset($parts[0]) && trim($parts[0]) !== '') $items[] = temporalItem('founded', (string) $parts[0], 'field', $field, 0.76); if (isset($parts[1]) && trim($parts[1]) !== '') $items[] = temporalItem('dissolved', (string) $parts[1], 'field', $field, 0.76); return $items; }
function temporalItem(string $kind, string $text, string $sourceType, string $field, float $confidence): array { $years = bfYears($text); return ['kind' => $kind, 'raw_text' => mb_substr(cleanText($text), 0, 500, 'UTF-8'), 'start_bf' => $years[0] ?? null, 'end_bf' => $years[1] ?? ($years[0] ?? null), 'source_type' => $sourceType, 'source_field' => $field, 'confidence' => $confidence]; }
function bfYears(string $text): array { $years = []; if (preg_match_all('/(?<!\d)(?:(v)\.?\s*)?(\d{1,4})(?:\s*[\/.]\s*\d{1,4})?\s*(?:v\.?\s*)?BF\b/iu', $text, $matches, PREG_SET_ORDER) !== false) { foreach ($matches as $match) { $value = (int) $match[2]; $before = trim((string) ($match[1] ?? '')) !== '' || preg_match('/\d{1,4}(?:\s*[\/.]\s*\d{1,4})?\s*v\.?\s*BF\b/iu', (string) $match[0]) === 1; $years[] = $before ? -$value : $value; } } return array_values(array_unique($years)); }

function buildRecord(string $pageTitle, array $fields, array $pathInfo, array $temporal): array {
    $founded = bestTemporal($temporal, 'founded');
    $dissolved = bestTemporal($temporal, 'dissolved');
    $path = is_array($pathInfo['path'] ?? null) ? $pathInfo['path'] : [];
    $url = pageUrl($pageTitle);
    return avesmapsPoliticalNormalizeWikiRecord(['Name' => displayName($pageTitle), 'Typ' => inferType($pageTitle, (string) ($fields['typ'] ?? $fields['art'] ?? $fields['herrschaftsgebiet'] ?? '')), 'Kontinent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT, 'Zugehoerigkeit' => (string) ($pathInfo['raw'] ?? ''), 'Zugehoerigkeit-Key' => $path !== [] ? avesmapsPoliticalSlug($path[0]) : '', 'Zugehoerigkeit-Root' => $path[0] ?? '', 'Zugehoerigkeit-Pfad' => implode(' > ', $path), 'Zugehoerigkeit-JSON' => ['path' => $path, 'source' => 'wiki-dom-playground-seed', 'source_field' => (string) ($pathInfo['source_field'] ?? '')], 'Gruendungsdatum-Text' => (string) ($founded['raw_text'] ?? ''), 'Gruendungsdatum-StartBF' => $founded['start_bf'] ?? null, 'Gruendungsdatum-EndBF' => $founded['end_bf'] ?? null, 'Gruendungsdatum-JSON' => $founded ?: [], 'Aufgeloest-Text' => (string) ($dissolved['raw_text'] ?? ''), 'Aufgeloest-StartBF' => $dissolved['start_bf'] ?? null, 'Aufgeloest-EndBF' => $dissolved['end_bf'] ?? null, 'Aufgeloest-JSON' => $dissolved ?: [], 'Wiki-Link' => $url, 'raw_json' => ['source' => 'wiki-dom-playground-seed', 'fields' => $fields, 'path' => $pathInfo, 'temporal' => $temporal]]);
}

function upsertRecord(PDO $pdo, array $record): void {
    $sql = 'INSERT INTO ' . WIKI_DOM_TEST_TABLE . ' (wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root, affiliation_path_json, affiliation_json, founded_text, founded_start_bf, founded_end_bf, founded_json, dissolved_text, dissolved_start_bf, dissolved_end_bf, dissolved_json, wiki_url, raw_json, synced_at) VALUES (:wiki_key, :name, :type, :continent, :affiliation_raw, :affiliation_key, :affiliation_root, :affiliation_path_json, :affiliation_json, :founded_text, :founded_start_bf, :founded_end_bf, :founded_json, :dissolved_text, :dissolved_start_bf, :dissolved_end_bf, :dissolved_json, :wiki_url, :raw_json, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), continent=VALUES(continent), affiliation_raw=VALUES(affiliation_raw), affiliation_key=VALUES(affiliation_key), affiliation_root=VALUES(affiliation_root), affiliation_path_json=VALUES(affiliation_path_json), affiliation_json=VALUES(affiliation_json), founded_text=VALUES(founded_text), founded_start_bf=VALUES(founded_start_bf), founded_end_bf=VALUES(founded_end_bf), founded_json=VALUES(founded_json), dissolved_text=VALUES(dissolved_text), dissolved_start_bf=VALUES(dissolved_start_bf), dissolved_end_bf=VALUES(dissolved_end_bf), dissolved_json=VALUES(dissolved_json), wiki_url=VALUES(wiki_url), raw_json=VALUES(raw_json), synced_at=CURRENT_TIMESTAMP(3)';
    $pdo->prepare($sql)->execute(['wiki_key' => $record['wiki_key'], 'name' => $record['name'], 'type' => nullable($record['type']), 'continent' => nullable($record['continent']), 'affiliation_raw' => nullable($record['affiliation_raw']), 'affiliation_key' => nullable($record['affiliation_key']), 'affiliation_root' => nullable($record['affiliation_root']), 'affiliation_path_json' => jsonOrNull($record['affiliation_path_json']), 'affiliation_json' => jsonOrNull($record['affiliation_json']), 'founded_text' => nullable($record['founded_text']), 'founded_start_bf' => $record['founded_start_bf'], 'founded_end_bf' => $record['founded_end_bf'], 'founded_json' => jsonOrNull($record['founded_json']), 'dissolved_text' => nullable($record['dissolved_text']), 'dissolved_start_bf' => $record['dissolved_start_bf'], 'dissolved_end_bf' => $record['dissolved_end_bf'], 'dissolved_json' => jsonOrNull($record['dissolved_json']), 'wiki_url' => nullable($record['wiki_url']), 'raw_json' => jsonOrNull($record['raw_json'])]);
}

function readRows(PDO $pdo): array { $stmt = $pdo->query('SELECT id, wiki_key, name, type, affiliation_root, affiliation_path_json, founded_text, founded_start_bf, dissolved_text, dissolved_start_bf, wiki_url, raw_json, synced_at FROM ' . WIKI_DOM_TEST_TABLE . ' ORDER BY COALESCE(affiliation_root, name), name LIMIT 500'); $items = []; while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $row['affiliation_path'] = decodeJson($row['affiliation_path_json'] ?? null); $row['raw'] = decodeJson($row['raw_json'] ?? null); unset($row['affiliation_path_json'], $row['raw_json']); $items[] = $row; } return ['ok' => true, 'table' => WIKI_DOM_TEST_TABLE, 'count' => count($items), 'items' => $items]; }
function recordExistsByWikiUrl(PDO $pdo, string $url): bool { $stmt = $pdo->prepare('SELECT 1 FROM ' . WIKI_DOM_TEST_TABLE . ' WHERE wiki_url = :url LIMIT 1'); $stmt->execute(['url' => $url]); return $stmt->fetchColumn() !== false; }
function enqueue(array &$queue, array &$queued, string $pageTitle, string $source): void { $pageTitle = title($pageTitle); $key = stableKey($pageTitle); if ($key === '' || isset($queued[$key])) return; $queued[$key] = true; $queue[] = ['title' => $pageTitle, 'source' => $source]; }
function heading(DOMXPath $xpath): string { $node = $xpath->query('//*[@id="firstHeading"]')->item(0); return $node instanceof DOMNode ? cleanText($node->textContent ?? '') : ''; }
function isEntrypoint(string $pageTitle): bool { return preg_match('/\/Liste$/u', title($pageTitle)) === 1; }
function titleFromHref(string $href): string { return str_starts_with(trim($href), '/wiki/') ? title(rawurldecode(substr(trim($href), 6))) : ''; }
function isRelevantTitle(string $pageTitle): bool { return $pageTitle !== '' && !str_contains($pageTitle, '#') && preg_match('/^(Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template|Benutzer|Diskussion):/iu', $pageTitle) !== 1; }
function bestTemporal(array $items, string $kind): ?array { $best = null; foreach ($items as $item) if (is_array($item) && (string) ($item['kind'] ?? '') === $kind && ($best === null || (float) ($item['confidence'] ?? 0) > (float) ($best['confidence'] ?? 0))) $best = $item; return $best; }
function dedupeTemporal(array $items): array { $out = []; foreach ($items as $item) if (is_array($item)) $out[implode('|', [(string) ($item['kind'] ?? ''), (string) ($item['start_bf'] ?? ''), (string) ($item['end_bf'] ?? ''), (string) ($item['raw_text'] ?? '')])] = $item; return array_values($out); }
function containsAny(string $text, array $words): bool { $key = labelKey($text); foreach ($words as $word) if ($word !== '' && str_contains($key, (string) $word)) return true; return false; }
function snippet(string $text, array $words): string { foreach ($words as $word) if ($word !== '' && preg_match('/.{0,90}' . preg_quote((string) $word, '/') . '.{0,160}/iu', $text, $match) === 1) return cleanText((string) $match[0]); return mb_substr(cleanText($text), 0, 260, 'UTF-8'); }
function inferType(string $pageTitle, string $fallback): string { if (trim($fallback) !== '') return trim($fallback); foreach (['Kaiserreich', 'Königreich', 'Bergkönigreich', 'Imperium', 'Republik', 'Herzogtum', 'Fürstentum', 'Grafschaft', 'Baronie', 'Freiherrschaft', 'Markgrafschaft', 'Pfalzgrafschaft', 'Jarltum', 'Sultanat', 'Emirat', 'Theokratie', 'Komturei', 'Domäne', 'Ordensland', 'Reich', 'Staat'] as $type) if (preg_match('/\b' . preg_quote($type, '/') . '\b/iu', $pageTitle) === 1) return $type; return ''; }
function displayName(string $pageTitle): string { return trim((string) preg_replace('/\s+\((?:Staat|Reich|Historisch|Region)\)\s*$/iu', '', str_replace('_', ' ', title($pageTitle)))); }
function title(string $pageTitle): string { $pageTitle = str_replace('_', ' ', rawurldecode(trim($pageTitle))); $pageTitle = preg_replace('/#.*$/u', '', $pageTitle) ?? $pageTitle; return trim($pageTitle); }
function pageUrl(string $pageTitle): string { return WIKI_DOM_BASE_URL . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', title($pageTitle)))); }
function stableKey(string $value): string { return avesmapsPoliticalSlug(title($value)); }
function labelKey(string $value): string { $value = mb_strtolower(cleanText($value), 'UTF-8'); $value = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $value); $value = preg_replace('/[^a-z0-9]+/u', ' ', $value) ?? ''; return trim($value); }
function cleanWikiValue(string $text): string { $text = preg_replace('/<!--.*?-->/su', ' ', $text) ?? $text; $text = preg_replace('/<\s*br\s*\/?\s*>/iu', '; ', $text) ?? $text; $text = preg_replace('/<\s*ref\b[^>]*>.*?<\s*\/\s*ref\s*>/isu', ' ', $text) ?? $text; $text = preg_replace('/<\s*ref\b[^>]*\/\s*>/isu', ' ', $text) ?? $text; $text = preg_replace('/\[\[([^\]|]+)\|([^\]]+)\]\]/u', '$2', $text) ?? $text; $text = preg_replace('/\[\[([^\]]+)\]\]/u', '$1', $text) ?? $text; $previous = null; while ($previous !== $text && str_contains($text, '{{')) { $previous = $text; $text = preg_replace_callback('/\{\{([^{}]*)\}\}/u', static fn(array $match): string => templateText((string) $match[1]), $text) ?? $text; } $text = preg_replace('/<[^>]+>/u', ' ', $text) ?? $text; return cleanText($text); }
function templateText(string $template): string { $parts = array_map('trim', explode('|', $template)); $name = labelKey((string) array_shift($parts)); $values = []; foreach ($parts as $part) { if ($part === '') continue; if (str_contains($part, '=')) { [$k, $v] = array_map('trim', explode('=', $part, 2)); if ($v !== '') $values[] = $v; } else { $values[] = $part; } } if ($values === []) return $name; if (in_array($name, ['datum', 'bf', 'borbarads_daemonenschlacht', 'seit'], true)) return implode(' ', $values); return end($values) ?: implode(' ', $values); }
function cleanText(string $text): string { $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8'); $text = preg_replace('/\[[^\]]*\]/u', ' ', $text) ?? $text; $text = preg_replace('/\s+/u', ' ', $text) ?? $text; return trim($text, " \t\n\r\0\x0B,:;"); }
function decodeJson(mixed $value): array { if ($value === null || $value === '') return []; if (is_array($value)) return $value; $decoded = json_decode((string) $value, true); return is_array($decoded) ? $decoded : []; }
function nullable(mixed $value): ?string { $value = trim((string) ($value ?? '')); return $value === '' ? null : $value; }
function jsonOrNull(mixed $value): ?string { if ($value === null || $value === '' || $value === []) return null; return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function ensureTestTable(PDO $pdo): void { if ($pdo->query("SHOW TABLES LIKE 'political_territory_wiki'")->fetchColumn() === false) throw new RuntimeException('Basis-Tabelle political_territory_wiki fehlt.'); if ($pdo->query("SHOW TABLES LIKE '" . WIKI_DOM_TEST_TABLE . "'")->fetchColumn() === false) $pdo->exec('CREATE TABLE ' . WIKI_DOM_TEST_TABLE . ' LIKE political_territory_wiki'); }
function createPdo(array $db): PDO { if ((string) ($db['driver'] ?? 'mysql') !== 'mysql') throw new RuntimeException('Nur MySQL wird unterstützt.'); $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', (string) ($db['host'] ?? 'localhost'), (int) ($db['port'] ?? 3306), (string) ($db['name'] ?? ''), (string) ($db['charset'] ?? 'utf8mb4')); return new PDO($dsn, (string) ($db['user'] ?? ''), (string) ($db['password'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]); }
function readBody(): array { $raw = file_get_contents('php://input'); if (!is_string($raw) || trim($raw) === '') return []; $decoded = json_decode($raw, true); return is_array($decoded) ? $decoded : []; }
function sleepMs(int $ms): void { if ($ms > 0) usleep($ms * 1000); }
function acquireLock() { $handle = fopen(WIKI_DOM_LOCK_FILE, 'c+'); if ($handle === false) throw new RuntimeException('Lock-Datei konnte nicht geöffnet werden.'); if (!flock($handle, LOCK_EX | LOCK_NB)) throw new RuntimeException('Es läuft bereits ein Wiki-DOM-Playground-Import.'); return $handle; }
function releaseLock($handle): void { if (is_resource($handle)) { flock($handle, LOCK_UN); fclose($handle); } @unlink(WIKI_DOM_LOCK_FILE); }
function applyCors(mixed $allowedOrigins): void { $origin = $_SERVER['HTTP_ORIGIN'] ?? ''; if (is_array($allowedOrigins) && $origin !== '' && in_array($origin, $allowedOrigins, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); } header('Access-Control-Allow-Methods: GET, POST, OPTIONS'); header('Access-Control-Allow-Headers: Content-Type'); }
function jsonOut(array $payload, int $status = 200): never { http_response_code($status); header('Content-Type: application/json; charset=utf-8'); echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT); exit; }
