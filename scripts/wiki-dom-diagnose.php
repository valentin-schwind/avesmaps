<?php

declare(strict_types=1);

/**
 * Diagnose tool for the Avesmaps Wiki DOM playground.
 *
 * Usage examples:
 *   php scripts/wiki-dom-diagnose.php
 *   php scripts/wiki-dom-diagnose.php --name="Baronie Tommelsbeuge"
 *   php scripts/wiki-dom-diagnose.php --url="https://de.wiki-aventurica.de/wiki/Baronie_Tommelsbeuge" --fetch
 *   php scripts/wiki-dom-diagnose.php --limit=20 --json
 */

$root = dirname(__DIR__);
require_once $root . '/api/political-territory-lib.php';

$options = getopt('', ['name::', 'url::', 'limit::', 'fetch', 'json', 'help']);
if (isset($options['help'])) {
    echo "Usage: php scripts/wiki-dom-diagnose.php [--name=TEXT] [--url=URL] [--limit=N] [--fetch] [--json]\n";
    exit(0);
}

$configPath = $root . '/api/config.local.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "config.local.php fehlt.\n");
    exit(1);
}
$config = require $configPath;
if (!is_array($config) || !isset($config['database']) || !is_array($config['database'])) {
    fwrite(STDERR, "config.local.php liefert keine gueltige database-Konfiguration.\n");
    exit(1);
}

$pdo = createPdo($config['database']);
$limit = max(1, min(100, (int) ($options['limit']  20)));
$nameFilter = trim((string) ($options['name']  ''));
$urlFilter = trim((string) ($options['url']  ''));
$shouldFetch = array_key_exists('fetch', $options);
$asJson = array_key_exists('json', $options);

$rows = readRows($pdo, $nameFilter, $urlFilter, $limit);
$live = [];
if ($shouldFetch) {
    foreach ($rows as $row) {
        $url = (string) ($row['wiki_url']  '');
        if ($url === '') {
            continue;
        }
        $live[] = inspectWikiPage($url);
    }
    if ($rows === [] && $urlFilter !== '') {
        $live[] = inspectWikiPage($urlFilter);
    }
}

$output = ['count' => count($rows), 'rows' => $rows, 'live' => $live];
if ($asJson) {
    echo json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    exit(0);
}

printRows($rows);
if ($shouldFetch) {
    printLive($live);
}

function createPdo(array $db): PDO {
    if ((string) ($db['driver']  'mysql') !== 'mysql') {
        throw new RuntimeException('Nur MySQL wird unterstuetzt.');
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        (string) ($db['host']  'localhost'),
        (int) ($db['port']  3306),
        (string) ($db['name']  ''),
        (string) ($db['charset']  'utf8mb4')
    );
    return new PDO($dsn, (string) ($db['user']  ''), (string) ($db['password']  ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function readRows(PDO $pdo, string $nameFilter, string $urlFilter, int $limit): array {
    $where = [];
    $params = [];
    if ($nameFilter !== '') {
        $where[] = 'name LIKE :name';
        $params['name'] = '%' . $nameFilter . '%';
    }
    if ($urlFilter !== '') {
        $where[] = 'wiki_url = :url';
        $params['url'] = $urlFilter;
    }
    $sql = 'SELECT id, wiki_key, name, type, affiliation_raw, affiliation_root, affiliation_path_json, founded_text, founded_start_bf, founded_end_bf, dissolved_text, dissolved_start_bf, dissolved_end_bf, wiki_url, raw_json, synced_at FROM political_territory_wiki_test';
    if ($where !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY synced_at DESC, name LIMIT ' . $limit;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $row['affiliation_path'] = decodeJson($row['affiliation_path_json']  null);
        $row['raw'] = decodeJson($row['raw_json']  null);
        $row['diagnosis'] = diagnoseRow($row);
        unset($row['affiliation_path_json'], $row['raw_json']);
        $rows[] = $row;
    }
    return $rows;
}

function diagnoseRow(array $row): array {
    $raw = is_array($row['raw']  null)  $row['raw'] : [];
    $fields = is_array($raw['fields']  null)  $raw['fields'] : [];
    $path = is_array($raw['path']  null)  $raw['path'] : [];
    $temporal = is_array($raw['temporal']  null)  $raw['temporal'] : [];
    $problems = [];

    if (($row['affiliation_root']  '') === '') {
        $problems[] = 'Pfad leer: kein passendes Feld fuer Zugehoerigkeit/politisch/Staat/Reich erkannt oder Feldwert nicht sinnvoll splitbar.';
    }
    if (($row['founded_start_bf']  null) === null) {
        $problems[] = 'Gruendung leer: kein geparstes BF/v. BF-Jahr in Gruendungsfeldern oder Gruendungssaetzen.';
    }
    if ($fields === []) {
        $problems[] = 'Keine Rohfelder gespeichert: Tabellen/Infobox-XPath trifft auf der Detailseite vermutlich nicht.';
    }

    return [
        'field_keys' => array_keys($fields),
        'path_source_field' => (string) ($path['source_field']  ''),
        'path_raw' => (string) ($path['raw']  ''),
        'temporal_items' => count($temporal),
        'problems' => $problems,
    ];
}

function inspectWikiPage(string $url): array {
    $html = fetchHtml($url);
    $xpath = htmlXPath($html);
    $fields = extractFields($xpath);
    $textHits = temporalTextHits($xpath);
    return [
        'url' => $url,
        'title' => heading($xpath),
        'field_count' => count($fields),
        'fields' => $fields,
        'field_keys' => array_keys($fields),
        'possible_path_fields' => pickFields($fields, ['zugehoerigkeit', 'zugehörigkeit', 'politisch', 'staat', 'reich', 'oberherrschaft']),
        'possible_date_fields' => pickFields($fields, ['gruendung', 'gründung', 'gruendungsdatum', 'gründungsdatum', 'gruendungsdaten', 'gründungsdaten', 'gegruendet', 'gegründet', 'aufloesung', 'auflösung', 'aufgeloest', 'aufgelöst', 'zeitraum', 'bestand', 'bestehen']),
        'temporal_text_hits' => $textHits,
    ];
}

function fetchHtml(string $url): string {
    $headers = [
        'User-Agent: AvesmapsWikiDomDiagnose/0.1 (https://avesmaps.de/)',
        'Accept: text/html,application/xhtml+xml',
    ];
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl !== false) {
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_ENCODING => '',
            ]);
            $html = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $error = curl_error($curl);
            curl_close($curl);
            if (is_string($html) && trim($html) !== '' && $status >= 200 && $status < 400) {
                return $html;
            }
            throw new RuntimeException('HTML-Abruf fehlgeschlagen: HTTP ' . $status . ($error !== ''  ' / ' . $error : ''));
        }
    }
    $context = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 15, 'header' => implode("\r\n", $headers) . "\r\n"]]);
    $html = @file_get_contents($url, false, $context);
    if (is_string($html) && trim($html) !== '') {
        return $html;
    }
    throw new RuntimeException('HTML-Antwort leer oder nicht abrufbar: ' . $url);
}

function htmlXPath(string $html): DOMXPath {
    if (!class_exists(DOMDocument::class)) {
        throw new RuntimeException('PHP-DOM-Erweiterung fehlt.');
    }
    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    return new DOMXPath($document);
}

function extractFields(DOMXPath $xpath): array {
    $fields = [];
    foreach ($xpath->query('//tr[th and td] | //div[contains(@class,"infobox")]//tr') ?: [] as $row) {
        if (!$row instanceof DOMElement) {
            continue;
        }
        $th = $row->getElementsByTagName('th')->item(0);
        $td = $row->getElementsByTagName('td')->item(0);
        if (!$th instanceof DOMNode || !$td instanceof DOMNode) {
            continue;
        }
        $key = labelKey($th->textContent  '');
        $value = cleanText($td->textContent  '');
        if ($key !== '' && $value !== '' && !isset($fields[$key])) {
            $fields[$key] = $value;
        }
    }
    return $fields;
}

function temporalTextHits(DOMXPath $xpath): array {
    $hits = [];
    foreach ($xpath->query('//p | //li | //tr') ?: [] as $node) {
        $text = cleanText($node instanceof DOMNode  ($node->textContent  '') : '');
        if ($text === '') {
            continue;
        }
        if (preg_match('/\b(gegründet|gegruendet|gründung|gruendung|entstand|ausgerufen|aufgelöst|aufgeloest|endete|zerfiel)\b.{0,180}\b(?:v\.?\s*)?\d{1,4}(?:\s*[\/.]\s*\d{1,4})?\s*(?:v\.?\s*)?BF\b/iu', $text) === 1) {
            $hits[] = mb_substr($text, 0, 500, 'UTF-8');
        }
    }
    return array_values(array_unique($hits));
}

function pickFields(array $fields, array $keys): array {
    $out = [];
    foreach ($keys as $key) {
        $normalized = labelKey($key);
        if (isset($fields[$normalized])) {
            $out[$normalized] = $fields[$normalized];
        }
    }
    return $out;
}

function printRows(array $rows): void {
    if ($rows === []) {
        echo "Keine passenden Datensaetze in political_territory_wiki_test.\n";
        return;
    }
    foreach ($rows as $row) {
        echo "\n== " . ($row['name']  '') . " ==\n";
        echo "Typ: " . ($row['type']  '') . "\n";
        echo "Pfad: " . implode(' > ', is_array($row['affiliation_path']  null)  $row['affiliation_path'] : []) . "\n";
        echo "Gruendung: " . ($row['founded_text']  '') . " | " . ($row['founded_start_bf']  '') . "\n";
        echo "Aufloesung: " . ($row['dissolved_text']  '') . " | " . ($row['dissolved_start_bf']  '') . "\n";
        echo "Wiki: " . ($row['wiki_url']  '') . "\n";
        echo "Feld-Keys: " . implode(', ', $row['diagnosis']['field_keys']  []) . "\n";
        foreach (($row['diagnosis']['problems']  []) as $problem) {
            echo "- " . $problem . "\n";
        }
    }
}

function printLive(array $live): void {
    foreach ($live as $page) {
        echo "\n-- Live-Wiki: " . ($page['title']  '') . " --\n";
        echo "URL: " . ($page['url']  '') . "\n";
        echo "Feldzahl: " . ($page['field_count']  0) . "\n";
        echo "Feld-Keys: " . implode(', ', $page['field_keys']  []) . "\n";
        echo "Pfadfelder:\n" . json_encode($page['possible_path_fields']  [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        echo "Datumsfelder:\n" . json_encode($page['possible_date_fields']  [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        echo "Datums-Texttreffer:\n" . json_encode($page['temporal_text_hits']  [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    }
}

function heading(DOMXPath $xpath): string {
    $node = $xpath->query('//*[@id="firstHeading"]')->item(0);
    return $node instanceof DOMNode  cleanText($node->textContent  '') : '';
}

function decodeJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }
    if (is_array($value)) {
        return $value;
    }
    $decoded = json_decode((string) $value, true);
    return is_array($decoded)  $decoded : [];
}

function labelKey(string $value): string {
    $value = mb_strtolower(cleanText($value), 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $value);
    $value = preg_replace('/[^a-z0-9]+/u', ' ', $value)  '';
    return trim($value);
}

function cleanText(string $text): string {
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\[[^\]]*\]/u', ' ', $text)  $text;
    $text = preg_replace('/\s+/u', ' ', $text)  $text;
    return trim($text, " \t\n\r\0\x0B,:;");
}
