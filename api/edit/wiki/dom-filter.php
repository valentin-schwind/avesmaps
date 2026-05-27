<?php

declare(strict_types=1);

function avesmapsWikiDomPatchSource(string $source): string {
    $defaultSeeds = [
        'Baronie/Liste',
        'Emirat/Liste',
        'Freiherrschaft/Liste',
        'Fürstentum/Liste',
        'Grafschaft/Liste',
        'Herzogtum/Liste',
        'Jarltum/Liste',
        'Kaiserreich/Liste',
        'Königreich/Liste',
        'Markgrafschaft/Liste',
        'Pfalzgrafschaft/Liste',
        'Reichsmark/Liste',
        'Reichsstadt/Liste',
        'Republik/Liste',
        'Shîkanydad/Liste',
        'Staat/Liste',
        'Sultanat/Liste',
    ];

    $defaultCatchwords = [
        'affiliation_path_labels' => ['staat', 'staatverlauf', 'zugehörigkeit', 'politisch', 'reich', 'oberherrschaft', 'lehnsherr', 'lehnsherrschaft', 'teil von', 'provinz', 'übergeordnet', 'herrschaftsgebiet', 'region'],
        'founded_labels' => ['gründungsdatum', 'gründung', 'gründungsdaten', 'unabhängigkeit', 'gegründet', 'entstehung', 'ausrufung', 'errichtung', 'erhebung', 'anerkennung', 'ausgliederung'],
        'dissolved_labels' => ['aufgelöst', 'auflösung', 'auflösungsdatum', 'ende', 'untergang', 'zerfall', 'aufgegeben', 'eingegliedert', 'annektiert', 'erobert', 'aufhebung', 'verlust'],
        'period_labels' => ['zeitraum', 'bestehen', 'bestand', 'bestandszeit', 'existenz', 'bestanden', 'existierte', 'zeit', 'ära'],
        'year_markers' => ['BF', 'v. BF', 'v BF'],
        'founded_context_words' => ['gegründet', 'gründung', 'gründungsdatum', 'gründungsdaten', 'unabhängigkeit', 'entstand', 'entstehung', 'ausgerufen', 'ausrufung', 'errichtet', 'errichtung', 'erhoben', 'erhebung', 'anerkannt', 'anerkennung', 'abgespalten', 'ausgliederung'],
        'dissolved_context_words' => ['aufgelöst', 'auflösung', 'endete', 'untergang', 'zerfiel', 'zerfall', 'aufgegeben', 'eingegliedert', 'annektiert', 'erobert', 'aufgehoben', 'aufhebung', 'verlor', 'verlust', 'fiel an', 'ging an'],
    ];

    $source = str_replace('const WIKI_DOM_MAX_ITERATIONS = 160;', 'const WIKI_DOM_MAX_ITERATIONS = 3000;', $source);
    $source = str_replace('const WIKI_DOM_MAX_PAGES = 100;', 'const WIKI_DOM_MAX_PAGES = 3000;', $source);
    $source = str_replace('const WIKI_DOM_MAX_RUNTIME = 35;', 'const WIKI_DOM_MAX_RUNTIME = 360000;', $source);
    $source = str_replace(
        "define('WIKI_DOM_LOCK_FILE', AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.lock');",
        "define('WIKI_DOM_LOCK_FILE', AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.lock');\ndefine('WIKI_DOM_CANCEL_FILE', AVESMAPS_WIKI_DOM_SOURCE_DIR . '/wiki-dom-playground.cancel');",
        $source
    );

    $defaultSeedItems = array_map(static fn(string $seed): string => "'" . addcslashes($seed, "'\\") . "'", $defaultSeeds);
    $defaultSeedSource = 'function defaultSeeds(): array { return [' . implode(', ', $defaultSeedItems) . ']; }';
    $source = preg_replace('/function defaultSeeds\(\): array \{ return \[[^;]*\]; \}/u', $defaultSeedSource, $source, 1) ?? $source;

    $defaultCatchwordSource = 'function defaultCatchwords(): array { return ' . var_export($defaultCatchwords, true) . '; }';
    $source = preg_replace('/function defaultCatchwords\(\): array \{ return \[.*?\]; \}/su', $defaultCatchwordSource, $source, 1) ?? $source;

    $source = preg_replace(
        '/function defaultOptions\(\): array \{ return \[.*?\]; \}/su',
        "function defaultOptions(): array { return ['max_iterations' => 3000, 'max_pages' => 3000, 'max_runtime_seconds' => 360000, 'sleep_ms' => 1000, 'request_timeout_seconds' => 30]; }",
        $source,
        1
    ) ?? $source;

    $source = str_replace(
        "'request_timeout_seconds' => max(3, min(20, (int) (\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'])))",
        "'request_timeout_seconds' => max(3, min(30, (int) (\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'])))",
        $source
    );

    $source = str_replace(
        "\$lock = acquireLock();\n    \$startedAt = microtime(true);",
        "\$lock = acquireLock();\n    wikiDomClearCancelRequest();\n    \$startedAt = microtime(true);",
        $source
    );

    $source = str_replace(
        "if (connection_aborted()) { \$events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen.']; break; }\n            if ((microtime(true) - \$startedAt) >= \$options['max_runtime_seconds'])",
        "if (connection_aborted()) { \$events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen.']; break; }\n            if (wikiDomCancelRequested()) { \$events[] = ['type' => 'cancel', 'message' => 'Import wurde manuell abgebrochen.']; break; }\n            if ((microtime(true) - \$startedAt) >= \$options['max_runtime_seconds'])",
        $source
    );

    $source = str_replace(
        "\$part = cleanText(\$part); if (\$part !== '' && preg_match('/\\b(unabhaengig|",
        "\$part = cleanText(\$part); if (wikiDomStartsWithPathContinuation(\$part)) break; if (\$part !== '' && preg_match('/\\b(unabhaengig|",
        $source
    );

    $historicalConflictSource = <<<'PHP'
function wikiDomCancelRequested(): bool {
    return defined('WIKI_DOM_CANCEL_FILE') && is_file(WIKI_DOM_CANCEL_FILE);
}

function wikiDomClearCancelRequest(): void {
    if (defined('WIKI_DOM_CANCEL_FILE')) @unlink(WIKI_DOM_CANCEL_FILE);
}

function wikiDomStartsWithPathContinuation(string $part): bool {
    return preg_match('/^\s*(?:sowie|und|oder)\b/iu', $part) === 1;
}

function wikiDomIsHistoricalRecord(array $record): bool {
    $url = rawurldecode(str_replace('_', ' ', (string) ($record['wiki_url'] ?? '')));
    return preg_match('/\(\s*historisch\s*\)/iu', $url) === 1;
}

function wikiDomCanonicalWikiKeyForHistoricalRecord(array $record): string {
    $name = trim((string) ($record['name'] ?? ''));
    $slug = $name !== '' ? avesmapsPoliticalSlug($name) : '';
    return $slug !== '' ? 'wiki:' . $slug : '';
}

function wikiDomHistoricalWikiKeyForCanonicalRecord(array $record): string {
    $name = trim((string) ($record['name'] ?? ''));
    $slug = $name !== '' ? avesmapsPoliticalSlug($name . ' Historisch') : '';
    return $slug !== '' ? 'wiki:' . $slug : '';
}

function wikiDomRecordExistsByWikiKey(PDO $pdo, string $wikiKey): bool {
    if ($wikiKey === '') return false;
    $stmt = $pdo->prepare('SELECT 1 FROM ' . WIKI_DOM_TEST_TABLE . ' WHERE wiki_key = :wiki_key LIMIT 1');
    $stmt->execute(['wiki_key' => $wikiKey]);
    return $stmt->fetchColumn() !== false;
}

function wikiDomDeleteHistoricalFallbackForCanonicalRecord(PDO $pdo, array $record): void {
    $historicalKey = wikiDomHistoricalWikiKeyForCanonicalRecord($record);
    if ($historicalKey === '') return;
    $stmt = $pdo->prepare('DELETE FROM ' . WIKI_DOM_TEST_TABLE . ' WHERE wiki_key = :wiki_key');
    $stmt->execute(['wiki_key' => $historicalKey]);
}

PHP;

    $source = str_replace(
        <<<'PHP'
function upsertRecord(PDO $pdo, array $record): void { $columns = tableColumns($pdo); $write = []; foreach ($record as $key => $value) { if (isset($columns[$key]) && !in_array($key, ['id', 'synced_at'], true)) $write[$key] = $value; } if (!isset($write['wiki_key'], $write['name'])) throw new RuntimeException('Datensatz ohne wiki_key/name kann nicht gespeichert werden.'); $names = array_keys($write); $insertCols = implode(', ', $names); $insertValues = ':' . implode(', :', $names); $updates = implode(', ', array_map(static fn(string $col): string => $col . '=VALUES(' . $col . ')', array_filter($names, static fn(string $col): bool => $col !== 'wiki_key'))); $sql = 'INSERT INTO ' . WIKI_DOM_TEST_TABLE . ' (' . $insertCols . ', synced_at) VALUES (' . $insertValues . ', CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE ' . $updates . ', synced_at=CURRENT_TIMESTAMP(3)'; $params = []; foreach ($write as $key => $value) { if (is_array($value)) $params[$key] = jsonOrNull($value); elseif (is_string($value)) $params[$key] = nullable($value); else $params[$key] = $value; } $pdo->prepare($sql)->execute($params); }
PHP,
        $historicalConflictSource . <<<'PHP'
function upsertRecord(PDO $pdo, array $record): void { if (wikiDomIsHistoricalRecord($record)) { $canonicalKey = wikiDomCanonicalWikiKeyForHistoricalRecord($record); if ($canonicalKey !== '' && $canonicalKey !== (string) ($record['wiki_key'] ?? '') && wikiDomRecordExistsByWikiKey($pdo, $canonicalKey)) return; } else { wikiDomDeleteHistoricalFallbackForCanonicalRecord($pdo, $record); } $columns = tableColumns($pdo); $write = []; foreach ($record as $key => $value) { if (isset($columns[$key]) && !in_array($key, ['id', 'synced_at'], true)) $write[$key] = $value; } if (!isset($write['wiki_key'], $write['name'])) throw new RuntimeException('Datensatz ohne wiki_key/name kann nicht gespeichert werden.'); $names = array_keys($write); $insertCols = implode(', ', $names); $insertValues = ':' . implode(', :', $names); $updates = implode(', ', array_map(static fn(string $col): string => $col . '=VALUES(' . $col . ')', array_filter($names, static fn(string $col): bool => $col !== 'wiki_key'))); $sql = 'INSERT INTO ' . WIKI_DOM_TEST_TABLE . ' (' . $insertCols . ', synced_at) VALUES (' . $insertValues . ', CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE ' . $updates . ', synced_at=CURRENT_TIMESTAMP(3)'; $params = []; foreach ($write as $key => $value) { if (is_array($value)) $params[$key] = jsonOrNull($value); elseif (is_string($value)) $params[$key] = nullable($value); else $params[$key] = $value; } $pdo->prepare($sql)->execute($params); }
PHP,
        $source
    );

    $source = str_replace(
        <<<'PHP'
function childSections(DOMXPath $xpath): array { $sections = []; foreach ($xpath->query('//dl/dt') ?: [] as $dt) { if (!$dt instanceof DOMElement) continue; $label = cleanText($dt->textContent ?? ''); if (!isChildSectionLabel($label)) continue; $dd = nextElementSibling($dt, 'dd'); if (!$dd instanceof DOMElement) continue; $items = []; foreach ($dd->getElementsByTagName('a') as $link) { if (!$link instanceof DOMElement) continue; $title = titleFromHref((string) $link->getAttribute('href')); $text = cleanText($link->textContent ?? ''); if ($title === '' || $text === '' || !isRelevantTitle($title)) continue; $items[stableKey($title)] = ['title' => $title, 'label' => $text, 'wiki_url' => pageUrl($title)]; } if ($items !== []) $sections[] = ['label' => $label, 'label_key' => labelKey($label), 'items' => array_values($items)]; } return $sections; }
PHP,
        <<<'PHP'
function childSections(DOMXPath $xpath): array { $sections = []; foreach ($xpath->query('//dl/dt') ?: [] as $dt) { if (!$dt instanceof DOMElement) continue; $label = cleanText($dt->textContent ?? ''); if (!isChildSectionLabel($label)) continue; $items = []; $current = $dt->nextSibling; while ($current instanceof DOMNode) { if ($current instanceof DOMElement) { $tagName = mb_strtolower($current->tagName, 'UTF-8'); if ($tagName === 'dt') break; if ($tagName !== 'dd') break; foreach ($current->getElementsByTagName('a') as $link) { if (!$link instanceof DOMElement) continue; $title = titleFromHref((string) $link->getAttribute('href')); $text = cleanText($link->textContent ?? ''); if ($title === '' || $text === '' || !isRelevantTitle($title)) continue; $items[stableKey($title)] = ['title' => $title, 'label' => $text, 'wiki_url' => pageUrl($title)]; } } $current = $current->nextSibling; } if ($items !== []) $sections[] = ['label' => $label, 'label_key' => labelKey($label), 'items' => array_values($items)]; } return $sections; }
PHP,
        $source
    );

    $source = str_replace(
        <<<'PHP'
function isChildSectionLabel(string $label): bool { $key = labelKey($label); if ($key === '') return false; foreach (['nachbarn','siedlungen','staedte','orte','fluesse','gewaesser','gebirge','berge','meere','inseln','waelder','strassen','wege'] as $bad) if (str_contains($key, $bad)) return false; foreach (['provinz','provinzen','untergebiet','untergebiete','teilgebiet','teilgebiete','gliedstaat','gliedstaaten','landesteil','landesteile','baronie','baronien','grafschaft','grafschaften','markgrafschaft','markgrafschaften','pfalzgrafschaft','pfalzgrafschaften','herzogtum','herzogtuemer','fuerstentum','fuerstentuemer','domaene','domaenen','emirat','emirate','sultanat','sultanate','jarltum','jarltuemer','haranydad','haranydate','shikanydad','shikanydate','historische herrschaftsgebiete'] as $good) if (str_contains($key, $good)) return true; return false; }
PHP,
        <<<'PHP'
function isChildSectionLabel(string $label): bool { $key = labelKey($label); if ($key === '') return false; foreach (['nachbarn','siedlungen','staedte','orte','fluesse','gewaesser','gebirge','berge','meere','inseln','waelder','strassen','wege'] as $bad) if (str_contains($key, $bad)) return false; foreach (['provinz','provinzen','amt','aemter','aemtern','untergebiet','untergebiete','teilgebiet','teilgebiete','gliedstaat','gliedstaaten','landesteil','landesteile','baronie','baronien','grafschaft','grafschaften','markgrafschaft','markgrafschaften','pfalzgrafschaft','pfalzgrafschaften','herzogtum','herzogtuemer','fuerstentum','fuerstentuemer','domaene','domaenen','emirat','emirate','sultanat','sultanate','jarltum','jarltuemer','haranydad','haranydate','shikanydad','shikanydate','historische herrschaftsgebiete'] as $good) if (str_contains($key, $good)) return true; return false; }
PHP,
        $source
    );

    $source = str_replace(
        "\$fields = array_replace(\$domFields, \$templateFields);\n                \$path = affiliationPath(\$fields, \$catchwords, \$resolvedTitle);",
        "\$fields = array_replace(\$domFields, \$templateFields);\n                \$categories = wikiDomPageCategories(\$xpath);\n                \$rejectReason = wikiDomRejectedNonTerritoryReason(\$resolvedTitle, \$fields, \$categories);\n                if (\$rejectReason !== '') {\n                    \$events[] = ['type' => 'reject', 'title' => \$resolvedTitle, 'message' => \$rejectReason];\n                    sleepMs(\$options['sleep_ms']);\n                    continue;\n                }\n                if (!wikiDomLooksLikePoliticalTerritory(\$resolvedTitle, \$fields)) {\n                    \$events[] = ['type' => 'reject', 'title' => \$resolvedTitle, 'message' => 'Keine belastbaren Herrschaftsgebietssignale gefunden.'];\n                    sleepMs(\$options['sleep_ms']);\n                    continue;\n                }\n                \$path = affiliationPath(\$fields, \$catchwords, \$resolvedTitle);",
        $source
    );

    $helperSource = <<<'PHP'
function wikiDomPageCategories(DOMXPath $xpath): array {
    $categories = [];
    foreach ($xpath->query('//*[@id="mw-normal-catlinks"]//a | //div[contains(@class,"catlinks")]//a') ?: [] as $node) {
        if (!$node instanceof DOMNode) continue;
        $text = cleanText($node->textContent ?? '');
        if ($text !== '') $categories[$text] = $text;
    }
    return array_values($categories);
}

function wikiDomRejectedNonTerritoryReason(string $title, array $fields, array $categories): string {
    if (preg_match('/\/Chronik$/u', $title) === 1) return 'Chronik-Unterseite, kein Herrschaftsgebiet.';
    if (preg_match('/^\d{1,4}\s*(?:v\.\s*)?BF$/u', $title) === 1) return 'Kalenderjahr, kein Herrschaftsgebiet.';
    if (preg_match('/^Aventurischer Bote Nr\./u', $title) === 1) return 'Aventurischer-Bote-Ausgabe, kein Herrschaftsgebiet.';

    $categoryKey = labelKey(implode(' ', $categories));
    foreach (['textquelle','spielhilfe','regionalspielhilfe','weltbeschreibung','hardcover','softcover','aventurien publikation','dsa1 publikation','dsa2 publikation','dsa3 publikation','dsa4 publikation','dsa5 publikation','aventurisches archiv','aventurischer bote','kalenderjahr','liste chronik jahr','publikationsindex'] as $badCategory) {
        if (str_contains($categoryKey, labelKey($badCategory))) return 'Ausschlusskategorie: ' . $badCategory;
    }

    $fieldKey = labelKey(implode(' ', array_keys($fields)) . ' ' . implode(' ', array_map(static fn(mixed $value): string => is_scalar($value) ? (string) $value : '', $fields)));
    foreach (['isbn','seitenzahl','erscheinungsdatum','preis','regelsystem','verwandte publikationen','erschienen bei','autor','autoren','redaktion','cover','einband'] as $badField) {
        if (str_contains($fieldKey, labelKey($badField))) return 'Publikationsfeld erkannt: ' . $badField;
    }

    return '';
}

function wikiDomLooksLikePoliticalTerritory(string $title, array $fields): bool {
    if (inferType($title, firstField($fields, ['typ', 'art', 'herrschaftsgebiet'])) !== '') return true;
    foreach (['herrschaftsform','hauptstadt','herrschaftssitz','oberhaupt','status','staat','staatverlauf','zugehoerigkeit','zugehörigkeit','politisch','reich','oberherrschaft'] as $key) {
        if (isset($fields[$key]) && trim((string) $fields[$key]) !== '') return true;
    }
    return false;
}

PHP;

    $source = str_replace(
        'function temporalData(array $fields, DOMXPath $xpath, array $catchwords): array {',
        $helperSource . "function wikiDomIsIgnoredTemporalText(string \$text): bool { \$key = labelKey(\$text); return str_contains(\$key, 'begriffsklaerung') || str_contains(\$key, 'hat mehrere bedeutungen') || str_contains(\$key, 'dieser artikel steht fuer'); }\nfunction temporalData(array \$fields, DOMXPath \$xpath, array \$catchwords): array {",
        $source
    );

    $source = str_replace(
        "if (\$text === '' || bfYears(\$text) === []) continue;",
        "if (\$text === '' || wikiDomIsIgnoredTemporalText(\$text) || bfYears(\$text) === []) continue;",
        $source
    );

    $settlementNeedle = chr(40) . 'Siedlung' . chr(41);
    $source = str_replace(
        "\$text = cleanText(\$node->textContent ?? ''); if (\$target === ''",
        "\$text = cleanText(\$node->textContent ?? ''); if (str_contains(\$target . ' ' . \$text, '" . $settlementNeedle . "')) continue; if (\$target === ''",
        $source
    );

    $source = str_replace(
        "\$context = labelKey(implode(' ', [\$src, \$largestSrc, \$img->getAttribute('alt'), \$img->getAttribute('title'), \$img->getAttribute('class'), \$img->getAttribute('data-file-width'), \$img->getAttribute('data-file-height')]));",
        "\$context = labelKey(implode(' ', [\$src, \$largestSrc, \$img->getAttribute('alt'), \$img->getAttribute('title'), \$img->getAttribute('class'), \$img->getAttribute('data-file-width'), \$img->getAttribute('data-file-height'), \$node->textContent ?? '']));",
        $source
    );

    $source = str_replace(
        "'shared resources assets'] as \$bad)",
        "'shared resources assets', 'bildgenerator', 'inoffizielle illustration', 'illustration', 'karte', 'lagekarte'] as \$bad)",
        $source
    );

    return $source;
}
