<?php

declare(strict_types=1);

require_once __DIR__ . '/political-territory-lib.php';

const AVESMAPS_WIKI_DOM_TEST_TABLE = 'political_territory_wiki_test';
const AVESMAPS_WIKI_DOM_API_URL = 'https://de.wiki-aventurica.de/api.php';
const AVESMAPS_WIKI_DOM_PAGE_BASE = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_DOM_LOCK_FILE = __DIR__ . '/wiki-dom-playground.lock';
const AVESMAPS_WIKI_DOM_MAX_DEPTH = 4;
const AVESMAPS_WIKI_DOM_MAX_ITERATIONS = 80;
const AVESMAPS_WIKI_DOM_MAX_PAGES = 80;
const AVESMAPS_WIKI_DOM_MAX_RUNTIME_SECONDS = 25;

$configPath = __DIR__ . '/config.local.php';

if (!is_file($configPath)) {
    wikiDomRespondJson(['ok' => false, 'error' => 'config.local.php fehlt.'], 500);
}

$config = require $configPath;
if (!is_array($config) || !isset($config['database']) || !is_array($config['database'])) {
    wikiDomRespondJson(['ok' => false, 'error' => 'config.local.php liefert keine gültige database-Konfiguration.'], 500);
}

wikiDomApplyCors($config['cors']['allowed_origins'] ?? []);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = wikiDomCreatePdo($config['database']);
    wikiDomEnsureTestTable($pdo);

    $action = trim((string) ($_GET['action'] ?? 'list'));
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = wikiDomReadJsonBody();
        if ($action === 'run') {
            wikiDomRunPlayground($pdo, $payload);
        }
        if ($action === 'clear') {
            $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_DOM_TEST_TABLE);
            wikiDomRespondJson(['ok' => true, 'message' => 'Test-Tabelle geleert.']);
        }
        wikiDomRespondJson(['ok' => false, 'error' => 'Unbekannte POST-Action.'], 400);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        wikiDomRespondJson(['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.'], 405);
    }

    if ($action === 'list') {
        wikiDomRespondJson(wikiDomReadTestRows($pdo));
    }

    if ($action === 'defaults') {
        wikiDomRespondJson([
            'ok' => true,
            'defaults' => wikiDomDefaultOptions(),
            'catchwords' => wikiDomDefaultCatchwords(),
        ]);
    }

    wikiDomRespondJson(['ok' => false, 'error' => 'Unbekannte GET-Action.'], 400);
} catch (Throwable $error) {
    wikiDomRespondJson(['ok' => false, 'error' => $error->getMessage()], 500);
}

function wikiDomRunPlayground(PDO $pdo, array $payload): void {
    $lock = wikiDomAcquireLock();
    $startedAt = microtime(true);

    try {
        @set_time_limit(AVESMAPS_WIKI_DOM_MAX_RUNTIME_SECONDS + 10);
        ignore_user_abort(false);

        $options = wikiDomNormalizeOptions($payload);
        $catchwords = wikiDomNormalizeCatchwords($payload['catchwords'] ?? null);
        $seedTitles = wikiDomNormalizeSeedTitles($payload['seeds'] ?? []);
        if ($seedTitles === []) {
            throw new RuntimeException('Mindestens ein Seed ist erforderlich.');
        }

        $queue = [];
        $queuedKeys = [];
        foreach ($seedTitles as $title) {
            wikiDomQueueTitle($queue, $queuedKeys, $title, 0, 'seed');
        }

        $pages = [];
        $relations = [];
        $events = [];
        $errors = [];
        $iterations = 0;
        $fetchedPages = 0;

        while ($queue !== []) {
            if (connection_aborted()) {
                $events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen; Lauf serverseitig beendet.'];
                break;
            }
            if ((microtime(true) - $startedAt) >= $options['max_runtime_seconds']) {
                $events[] = ['type' => 'limit', 'message' => 'Maximale Laufzeit erreicht.'];
                break;
            }
            if ($iterations >= $options['max_iterations']) {
                $events[] = ['type' => 'limit', 'message' => 'Maximale Iterationszahl erreicht.'];
                break;
            }
            if ($fetchedPages >= $options['max_pages']) {
                $events[] = ['type' => 'limit', 'message' => 'Maximale Seitenzahl erreicht.'];
                break;
            }

            $iterations++;
            $entry = array_shift($queue);
            if (!is_array($entry)) {
                continue;
            }

            $title = (string) ($entry['title'] ?? '');
            $depth = (int) ($entry['depth'] ?? 0);
            $key = wikiDomStableKey($title);
            if ($key === '') {
                continue;
            }
            if (isset($pages[$key]) && !empty($pages[$key]['fetched'])) {
                continue;
            }

            try {
                $page = wikiDomFetchAndAnalyzePage($title, $depth, $catchwords, $options['request_timeout_seconds']);
                $pages[$key] = $page;
                $fetchedPages++;
                foreach ($page['relations'] as $relation) {
                    $relations[] = $relation;
                    if ($depth < $options['max_depth'] && in_array((string) $relation['relation_type'], ['child', 'parent'], true)) {
                        $targetTitle = (string) ($relation['target_title'] ?? '');
                        if ($targetTitle !== '') {
                            wikiDomQueueTitle($queue, $queuedKeys, $targetTitle, $depth + 1, 'relation:' . (string) $relation['relation_type']);
                        }
                    }
                }
            } catch (Throwable $error) {
                $errors[] = ['title' => $title, 'error' => $error->getMessage()];
                if (!isset($pages[$key])) {
                    $pages[$key] = wikiDomCreateSyntheticPage($title, $depth, 'fetch_error', ['error' => $error->getMessage()]);
                }
            }

            if ($options['sleep_ms'] > 0) {
                usleep($options['sleep_ms'] * 1000);
            }
        }

        wikiDomAddSyntheticPagesFromRelations($pages, $relations);
        wikiDomResolveAndStoreRecords($pdo, $pages, $relations);

        $result = wikiDomReadTestRows($pdo);
        $result['run'] = [
            'ok' => true,
            'started_at' => gmdate('c', (int) $startedAt),
            'finished_at' => gmdate('c'),
            'runtime_seconds' => round(microtime(true) - $startedAt, 3),
            'iterations' => $iterations,
            'fetched_pages' => $fetchedPages,
            'queued_remaining' => count($queue),
            'relations' => count($relations),
            'events' => $events,
            'errors' => $errors,
            'options' => $options,
        ];
        $result['relations'] = $relations;
        wikiDomRespondJson($result);
    } finally {
        wikiDomReleaseLock($lock);
    }
}

function wikiDomDefaultOptions(): array {
    return [
        'max_depth' => 1,
        'max_iterations' => 12,
        'max_pages' => 12,
        'max_runtime_seconds' => 12,
        'sleep_ms' => 350,
        'request_timeout_seconds' => 8,
    ];
}

function wikiDomNormalizeOptions(array $payload): array {
    $defaults = wikiDomDefaultOptions();
    return [
        'max_depth' => max(0, min(AVESMAPS_WIKI_DOM_MAX_DEPTH, (int) ($payload['max_depth'] ?? $defaults['max_depth']))),
        'max_iterations' => max(1, min(AVESMAPS_WIKI_DOM_MAX_ITERATIONS, (int) ($payload['max_iterations'] ?? $defaults['max_iterations']))),
        'max_pages' => max(1, min(AVESMAPS_WIKI_DOM_MAX_PAGES, (int) ($payload['max_pages'] ?? $defaults['max_pages']))),
        'max_runtime_seconds' => max(3, min(AVESMAPS_WIKI_DOM_MAX_RUNTIME_SECONDS, (int) ($payload['max_runtime_seconds'] ?? $defaults['max_runtime_seconds']))),
        'sleep_ms' => max(0, min(5000, (int) ($payload['sleep_ms'] ?? $defaults['sleep_ms']))),
        'request_timeout_seconds' => max(3, min(15, (int) ($payload['request_timeout_seconds'] ?? $defaults['request_timeout_seconds']))),
    ];
}

function wikiDomDefaultCatchwords(): array {
    return [
        'child_labels' => [
            'provinzen', 'unterregionen', 'verwaltungseinheiten', 'verwaltungsgebiete', 'herzogtümer', 'herzogtuemer',
            'fürstentümer', 'fuerstentuemer', 'grafschaften', 'landgrafschaften', 'markgrafschaften', 'baronien',
            'freiherrschaften', 'jarltümer', 'jarltuemer', 'kronvogteien', 'kolonien', 'kolonien und exklaven', 'exklaven'
        ],
        'former_child_labels' => ['ehemalige jarltümer', 'ehemalige provinzen', 'ehemalige baronien', 'ehemalige grafschaften', 'ehemals freie städte'],
        'claim_labels' => ['beansprucht', 'territorialansprüche', 'territorialansprueche'],
        'parent_labels' => ['zugehörigkeit', 'zugehoerigkeit', 'staat', 'reich', 'politisch', 'oberherrschaft'],
        'ignore_labels' => ['siedlungen', 'städte', 'staedte', 'dörfer', 'doerfer', 'festungen', 'flüsse', 'fluesse', 'gebirge', 'wälder', 'waelder', 'seen', 'meere', 'nachbarn', 'verkehrswege', 'weblinks', 'publikationen', 'quellen'],
        'parent_phrases' => ['provinz des', 'provinz der', 'provinz von', 'baronie des', 'baronie der', 'grafschaft des', 'grafschaft der', 'gehört zu', 'gehört zum', 'gehört zur', 'teil des', 'teil der', 'untersteht'],
    ];
}

function wikiDomNormalizeCatchwords(mixed $value): array {
    $defaults = wikiDomDefaultCatchwords();
    if (is_string($value) && trim($value) !== '') {
        try {
            $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
            if (is_array($decoded)) {
                $value = $decoded;
            }
        } catch (JsonException) {
            return $defaults;
        }
    }
    if (!is_array($value)) {
        return $defaults;
    }

    foreach ($defaults as $key => $items) {
        $custom = $value[$key] ?? $items;
        if (!is_array($custom)) {
            $custom = $items;
        }
        $defaults[$key] = array_values(array_unique(array_filter(array_map(
            static fn(mixed $item): string => mb_strtolower(trim((string) $item), 'UTF-8'),
            $custom
        ), static fn(string $item): bool => $item !== '')));
    }

    return $defaults;
}

function wikiDomFetchAndAnalyzePage(string $title, int $depth, array $catchwords, int $timeout): array {
    $normalizedTitle = wikiDomNormalizeTitle($title);
    $html = wikiDomFetchParsedHtml($normalizedTitle, $timeout);
    $document = wikiDomLoadHtml($html);
    $xpath = new DOMXPath($document);
    $resolvedTitle = wikiDomReadDocumentTitle($xpath) ?: $normalizedTitle;
    $wikiUrl = wikiDomPageUrl($resolvedTitle);
    $fields = wikiDomExtractLabelValueFields($xpath);
    $relations = wikiDomExtractRelations($xpath, $resolvedTitle, $catchwords);
    $temporal = wikiDomExtractTemporalEvidence($fields, $xpath);
    $type = wikiDomInferType($resolvedTitle, (string) ($fields['typ'] ?? $fields['art'] ?? $fields['herrschaftsgebiet'] ?? ''));

    return [
        'fetched' => true,
        'synthetic' => false,
        'title' => $resolvedTitle,
        'name' => wikiDomDisplayName($resolvedTitle),
        'wiki_key' => avesmapsPoliticalBuildWikiKey($wikiUrl, $resolvedTitle),
        'wiki_url' => $wikiUrl,
        'type' => $type,
        'depth' => $depth,
        'fields' => $fields,
        'relations' => $relations,
        'temporal' => $temporal,
        'raw' => [
            'source' => 'wiki-dom-playground',
            'title' => $resolvedTitle,
            'depth' => $depth,
            'fields' => $fields,
            'relations' => $relations,
            'temporal' => $temporal,
        ],
    ];
}

function wikiDomExtractRelations(DOMXPath $xpath, string $sourceTitle, array $catchwords): array {
    $relations = [];
    $sourceKey = avesmapsPoliticalBuildWikiKey(wikiDomPageUrl($sourceTitle), $sourceTitle);

    foreach ($xpath->query('//tr[th and td] | //dl/* | //li | //p') ?: [] as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }
        $text = wikiDomCleanText($node->textContent ?? '');
        if ($text === '') {
            continue;
        }

        $label = wikiDomExtractLeadingLabel($text);
        $labelKey = wikiDomLabelKey($label);
        if ($labelKey !== '' && in_array($labelKey, $catchwords['ignore_labels'], true)) {
            continue;
        }

        $links = wikiDomExtractWikiLinks($node);
        if ($links === []) {
            continue;
        }

        if ($labelKey !== '' && in_array($labelKey, $catchwords['child_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomCreateRelation($sourceTitle, $sourceKey, $link, 'child', 'label', $label, $text, 0.88, 'current');
            }
            continue;
        }

        if ($labelKey !== '' && in_array($labelKey, $catchwords['former_child_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomCreateRelation($sourceTitle, $sourceKey, $link, 'child', 'label', $label, $text, 0.62, 'former');
            }
            continue;
        }

        if ($labelKey !== '' && in_array($labelKey, $catchwords['claim_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomCreateRelation($sourceTitle, $sourceKey, $link, 'claim', 'label', $label, $text, 0.45, 'claimed');
            }
            continue;
        }

        if ($labelKey !== '' && in_array($labelKey, $catchwords['parent_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomCreateRelation($sourceTitle, $sourceKey, $link, 'parent', 'label', $label, $text, 0.84, 'current');
            }
            continue;
        }

        $lowerText = mb_strtolower($text, 'UTF-8');
        foreach ($catchwords['parent_phrases'] as $phrase) {
            if ($phrase !== '' && str_contains($lowerText, $phrase)) {
                foreach ($links as $link) {
                    $relations[] = wikiDomCreateRelation($sourceTitle, $sourceKey, $link, 'parent', 'sentence', $phrase, $text, 0.68, 'current');
                }
                break;
            }
        }
    }

    return wikiDomDedupeRelations($relations);
}

function wikiDomCreateRelation(string $sourceTitle, string $sourceKey, array $link, string $type, string $evidenceType, string $label, string $text, float $confidence, string $statusHint): array {
    $targetTitle = (string) ($link['title'] ?? '');
    $targetUrl = (string) ($link['url'] ?? wikiDomPageUrl($targetTitle));
    return [
        'source_title' => $sourceTitle,
        'source_wiki_key' => $sourceKey,
        'target_title' => $targetTitle,
        'target_name' => wikiDomDisplayName($targetTitle),
        'target_wiki_key' => avesmapsPoliticalBuildWikiKey($targetUrl, $targetTitle),
        'target_url' => $targetUrl,
        'relation_type' => $type,
        'evidence_type' => $evidenceType,
        'label' => $label,
        'raw_text' => mb_substr($text, 0, 700),
        'confidence' => $confidence,
        'status_hint' => $statusHint,
    ];
}

function wikiDomDedupeRelations(array $relations): array {
    $out = [];
    foreach ($relations as $relation) {
        $key = implode('|', [
            (string) ($relation['source_wiki_key'] ?? ''),
            (string) ($relation['target_wiki_key'] ?? ''),
            (string) ($relation['relation_type'] ?? ''),
            (string) ($relation['status_hint'] ?? ''),
        ]);
        if (!isset($out[$key]) || (float) $relation['confidence'] > (float) $out[$key]['confidence']) {
            $out[$key] = $relation;
        }
    }
    return array_values($out);
}

function wikiDomExtractLabelValueFields(DOMXPath $xpath): array {
    $fields = [];
    foreach ($xpath->query('//tr[th and td]') ?: [] as $row) {
        if (!$row instanceof DOMElement) {
            continue;
        }
        $ths = $row->getElementsByTagName('th');
        $tds = $row->getElementsByTagName('td');
        if ($ths->length < 1 || $tds->length < 1) {
            continue;
        }
        $label = wikiDomLabelKey(wikiDomCleanText($ths->item(0)?->textContent ?? ''));
        $value = wikiDomCleanText($tds->item(0)?->textContent ?? '');
        if ($label !== '' && $value !== '' && !isset($fields[$label])) {
            $fields[$label] = $value;
        }
    }
    foreach ($xpath->query('//dl/*') ?: [] as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }
        $text = wikiDomCleanText($node->textContent ?? '');
        $label = wikiDomExtractLeadingLabel($text);
        $key = wikiDomLabelKey($label);
        if ($key !== '' && !isset($fields[$key])) {
            $fields[$key] = trim(preg_replace('/^' . preg_quote($label, '/') . '\s*:?\s*/iu', '', $text) ?? $text);
        }
    }
    return $fields;
}

function wikiDomExtractTemporalEvidence(array $fields, DOMXPath $xpath): array {
    $items = [];
    foreach ($fields as $key => $value) {
        if (preg_match('/gruendung|grundung|gegruendet|gegrundet|neugruendung|neugrundung/u', $key) === 1) {
            $items[] = wikiDomTemporalItem('founded', $value, 'field', $key, 0.94);
        }
        if (preg_match('/aufgeloest|aufgelost|aufloesung|auflosung/u', $key) === 1) {
            $items[] = wikiDomTemporalItem('dissolved', $value, 'field', $key, 0.94);
        }
        if (preg_match('/zeitraum|bestehen|bestand|bestandszeit/u', $key) === 1) {
            foreach (wikiDomSplitPeriodTemporalItems($value, 'field', $key) as $item) {
                $items[] = $item;
            }
        }
    }

    foreach ($xpath->query('//p') ?: [] as $paragraph) {
        $text = wikiDomCleanText($paragraph instanceof DOMElement ? ($paragraph->textContent ?? '') : '');
        if ($text === '') {
            continue;
        }
        if (preg_match('/\b(gegr(?:ü|u)ndet|entstand|ausgerufen)\b.{0,80}\b\d{1,4}\s*BF\b/iu', $text, $match) === 1) {
            $items[] = wikiDomTemporalItem('founded', (string) $match[0], 'sentence', '', 0.72);
        }
        if (preg_match('/\b(aufgel(?:ö|o)st|endete|fiel)\b.{0,80}\b\d{1,4}\s*BF\b/iu', $text, $match) === 1) {
            $items[] = wikiDomTemporalItem('dissolved', (string) $match[0], 'sentence', '', 0.68);
        }
    }

    return $items;
}

function wikiDomTemporalItem(string $kind, string $rawText, string $sourceType, string $sourceField, float $confidence): array {
    $years = wikiDomExtractBfYears($rawText);
    return [
        'kind' => $kind,
        'raw_text' => mb_substr(wikiDomCleanText($rawText), 0, 500),
        'start_bf' => $years[0] ?? null,
        'end_bf' => $years[1] ?? ($years[0] ?? null),
        'source_type' => $sourceType,
        'source_field' => $sourceField,
        'confidence' => $confidence,
    ];
}

function wikiDomSplitPeriodTemporalItems(string $rawText, string $sourceType, string $sourceField): array {
    $parts = preg_split('/\s*(?:-|–|—|bis)\s*/u', $rawText) ?: [];
    $items = [];
    if (isset($parts[0]) && trim($parts[0]) !== '') {
        $items[] = wikiDomTemporalItem('founded', (string) $parts[0], $sourceType, $sourceField, 0.76);
    }
    if (isset($parts[1]) && trim($parts[1]) !== '') {
        $items[] = wikiDomTemporalItem('dissolved', (string) $parts[1], $sourceType, $sourceField, 0.76);
    }
    return $items;
}

function wikiDomExtractBfYears(string $text): array {
    $years = [];
    if (preg_match_all('/(?<!\d)(\d{1,4})(?:\s*[\/.]\s*\d{1,4})?\s*BF\b/iu', $text, $matches) !== false) {
        foreach ($matches[1] as $year) {
            $years[] = (int) $year;
        }
    }
    return array_values(array_unique($years));
}

function wikiDomResolveAndStoreRecords(PDO $pdo, array $pages, array $relations): void {
    $parentByChild = wikiDomResolveParents($relations);

    foreach ($pages as $key => $page) {
        if (!is_array($page)) {
            continue;
        }
        $wikiKey = (string) ($page['wiki_key'] ?? $key);
        $parent = $parentByChild[$wikiKey] ?? null;
        $path = [];
        $affiliationRaw = '';
        if (is_array($parent)) {
            $path = wikiDomBuildPath($parentByChild, (string) $parent['parent_wiki_key'], [(string) $wikiKey => true]);
            $path[] = (string) $parent['parent_name'];
            $path = array_values(array_unique(array_filter($path, static fn(string $part): bool => $part !== '')));
            $affiliationRaw = (string) ($parent['evidence_text'] ?? $parent['parent_name']);
        }

        $temporal = is_array($page['temporal'] ?? null) ? $page['temporal'] : [];
        $founded = wikiDomBestTemporal($temporal, 'founded');
        $dissolved = wikiDomBestTemporal($temporal, 'dissolved');

        $record = [
            'Name' => (string) ($page['name'] ?? wikiDomDisplayName((string) ($page['title'] ?? ''))),
            'Typ' => (string) ($page['type'] ?? ''),
            'Kontinent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'Zugehoerigkeit' => $affiliationRaw,
            'Zugehoerigkeit-Key' => $path !== [] ? avesmapsPoliticalSlug($path[0]) : '',
            'Zugehoerigkeit-Root' => $path[0] ?? '',
            'Zugehoerigkeit-Pfad' => implode(' > ', $path),
            'Zugehoerigkeit-JSON' => ['path' => $path, 'source' => 'wiki-dom-playground'],
            'Status' => wikiDomField($page, ['status']),
            'Herrschaftsform' => wikiDomField($page, ['herrschaftsform']),
            'Hauptstadt' => wikiDomField($page, ['hauptstadt']),
            'Herrschaftssitz' => wikiDomField($page, ['herrschaftssitz']),
            'Oberhaupt' => wikiDomField($page, ['oberhaupt']),
            'Sprache' => wikiDomField($page, ['sprache']),
            'Waehrung' => wikiDomField($page, ['wahrung', 'waehrung']),
            'Handelswaren' => wikiDomField($page, ['handelswaren']),
            'Einwohnerzahl' => wikiDomField($page, ['einwohnerzahl']),
            'Gruendungsdatum-Text' => (string) ($founded['raw_text'] ?? wikiDomField($page, ['grundungsdatum', 'gruendungsdatum', 'grundung', 'gruendung'])),
            'Gruendungsdatum-StartBF' => $founded['start_bf'] ?? null,
            'Gruendungsdatum-EndBF' => $founded['end_bf'] ?? null,
            'Gruendungsdatum-JSON' => $founded ?: [],
            'Gruender' => wikiDomField($page, ['grunder', 'gruender']),
            'Aufgeloest-Text' => (string) ($dissolved['raw_text'] ?? wikiDomField($page, ['aufgelost', 'aufgeloest', 'auflosung', 'aufloesung'])),
            'Aufgeloest-StartBF' => $dissolved['start_bf'] ?? null,
            'Aufgeloest-EndBF' => $dissolved['end_bf'] ?? null,
            'Aufgeloest-JSON' => $dissolved ?: [],
            'Geographisch' => wikiDomField($page, ['geographisch', 'geografisch']),
            'Politisch' => wikiDomField($page, ['politisch']),
            'Blasonierung' => wikiDomField($page, ['blasonierung']),
            'Wiki-Link' => (string) ($page['wiki_url'] ?? ''),
            'Wappen-Link' => wikiDomField($page, ['wappen', 'wappenlink', 'wappenbild']),
            'raw_json' => $page['raw'] ?? $page,
        ];

        $normalized = avesmapsPoliticalNormalizeWikiRecord($record);
        wikiDomUpsertTestRecord($pdo, $normalized);
    }
}

function wikiDomResolveParents(array $relations): array {
    $candidates = [];
    $childForward = [];
    foreach ($relations as $relation) {
        $source = (string) ($relation['source_wiki_key'] ?? '');
        $target = (string) ($relation['target_wiki_key'] ?? '');
        if ($source === '' || $target === '') {
            continue;
        }
        $type = (string) ($relation['relation_type'] ?? '');
        if ($type === 'child') {
            $childForward[$source . '>' . $target] = true;
            $candidates[$target][] = [
                'child_wiki_key' => $target,
                'parent_wiki_key' => $source,
                'parent_name' => (string) ($relation['source_title'] ?? ''),
                'score' => (float) ($relation['confidence'] ?? 0.5),
                'evidence_text' => (string) ($relation['raw_text'] ?? ''),
            ];
        } elseif ($type === 'parent') {
            $candidates[$source][] = [
                'child_wiki_key' => $source,
                'parent_wiki_key' => $target,
                'parent_name' => (string) ($relation['target_name'] ?? $relation['target_title'] ?? ''),
                'score' => (float) ($relation['confidence'] ?? 0.5),
                'evidence_text' => (string) ($relation['raw_text'] ?? ''),
            ];
        }
    }

    $resolved = [];
    foreach ($candidates as $childKey => $items) {
        $best = null;
        foreach ($items as $item) {
            $reciprocalKey = (string) $item['parent_wiki_key'] . '>' . (string) $item['child_wiki_key'];
            if (isset($childForward[$reciprocalKey])) {
                $item['score'] += 0.5;
                $item['reciprocal'] = true;
            } else {
                $item['reciprocal'] = false;
            }
            if ($best === null || (float) $item['score'] > (float) $best['score']) {
                $best = $item;
            }
        }
        if (is_array($best)) {
            $resolved[$childKey] = $best;
        }
    }
    return $resolved;
}

function wikiDomBuildPath(array $parentByChild, string $key, array $seen, int $depth = 0): array {
    if ($key === '' || $depth > 12 || isset($seen[$key])) {
        return [];
    }
    $parent = $parentByChild[$key] ?? null;
    if (!is_array($parent)) {
        return [];
    }
    $seen[$key] = true;
    $path = wikiDomBuildPath($parentByChild, (string) $parent['parent_wiki_key'], $seen, $depth + 1);
    $path[] = (string) $parent['parent_name'];
    return $path;
}

function wikiDomBestTemporal(array $items, string $kind): ?array {
    $best = null;
    foreach ($items as $item) {
        if (!is_array($item) || (string) ($item['kind'] ?? '') !== $kind) {
            continue;
        }
        if ($best === null || (float) ($item['confidence'] ?? 0) > (float) ($best['confidence'] ?? 0)) {
            $best = $item;
        }
    }
    return $best;
}

function wikiDomAddSyntheticPagesFromRelations(array &$pages, array $relations): void {
    foreach ($relations as $relation) {
        if (!in_array((string) ($relation['relation_type'] ?? ''), ['child', 'parent'], true)) {
            continue;
        }
        $targetTitle = (string) ($relation['target_title'] ?? '');
        $key = wikiDomStableKey($targetTitle);
        if ($key !== '' && !isset($pages[$key])) {
            $pages[$key] = wikiDomCreateSyntheticPage($targetTitle, 999, 'relation_target', ['relation' => $relation]);
        }
    }
}

function wikiDomCreateSyntheticPage(string $title, int $depth, string $reason, array $raw): array {
    $url = wikiDomPageUrl($title);
    return [
        'fetched' => false,
        'synthetic' => true,
        'title' => wikiDomNormalizeTitle($title),
        'name' => wikiDomDisplayName($title),
        'wiki_key' => avesmapsPoliticalBuildWikiKey($url, $title),
        'wiki_url' => $url,
        'type' => wikiDomInferType($title, ''),
        'depth' => $depth,
        'fields' => [],
        'relations' => [],
        'temporal' => [],
        'raw' => ['source' => 'wiki-dom-playground', 'synthetic' => true, 'reason' => $reason, 'raw' => $raw],
    ];
}

function wikiDomUpsertTestRecord(PDO $pdo, array $record): void {
    $sql = 'INSERT INTO ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' (
        wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root,
        affiliation_path_json, affiliation_json, status, form_of_government, capital_name,
        seat_name, ruler, language, currency, trade_goods, population, founded_text,
        founded_type, founded_start_bf, founded_end_bf, founded_display_bf, founded_json,
        founder, dissolved_text, dissolved_type, dissolved_start_bf, dissolved_end_bf,
        dissolved_display_bf, dissolved_json, geographic, political, trade_zone, blazon,
        wiki_url, coat_of_arms_url, raw_json, synced_at
    ) VALUES (
        :wiki_key, :name, :type, :continent, :affiliation_raw, :affiliation_key, :affiliation_root,
        :affiliation_path_json, :affiliation_json, :status, :form_of_government, :capital_name,
        :seat_name, :ruler, :language, :currency, :trade_goods, :population, :founded_text,
        :founded_type, :founded_start_bf, :founded_end_bf, :founded_display_bf, :founded_json,
        :founder, :dissolved_text, :dissolved_type, :dissolved_start_bf, :dissolved_end_bf,
        :dissolved_display_bf, :dissolved_json, :geographic, :political, :trade_zone, :blazon,
        :wiki_url, :coat_of_arms_url, :raw_json, CURRENT_TIMESTAMP(3)
    ) ON DUPLICATE KEY UPDATE
        name = VALUES(name), type = VALUES(type), continent = VALUES(continent),
        affiliation_raw = VALUES(affiliation_raw), affiliation_key = VALUES(affiliation_key),
        affiliation_root = VALUES(affiliation_root), affiliation_path_json = VALUES(affiliation_path_json),
        affiliation_json = VALUES(affiliation_json), status = VALUES(status),
        form_of_government = VALUES(form_of_government), capital_name = VALUES(capital_name),
        seat_name = VALUES(seat_name), ruler = VALUES(ruler), language = VALUES(language),
        currency = VALUES(currency), trade_goods = VALUES(trade_goods), population = VALUES(population),
        founded_text = VALUES(founded_text), founded_type = VALUES(founded_type),
        founded_start_bf = VALUES(founded_start_bf), founded_end_bf = VALUES(founded_end_bf),
        founded_display_bf = VALUES(founded_display_bf), founded_json = VALUES(founded_json),
        founder = VALUES(founder), dissolved_text = VALUES(dissolved_text),
        dissolved_type = VALUES(dissolved_type), dissolved_start_bf = VALUES(dissolved_start_bf),
        dissolved_end_bf = VALUES(dissolved_end_bf), dissolved_display_bf = VALUES(dissolved_display_bf),
        dissolved_json = VALUES(dissolved_json), geographic = VALUES(geographic), political = VALUES(political),
        trade_zone = VALUES(trade_zone), blazon = VALUES(blazon), wiki_url = VALUES(wiki_url),
        coat_of_arms_url = VALUES(coat_of_arms_url), raw_json = VALUES(raw_json), synced_at = CURRENT_TIMESTAMP(3)';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'wiki_key' => $record['wiki_key'], 'name' => $record['name'],
        'type' => avesmapsPoliticalNullableString($record['type']),
        'continent' => avesmapsPoliticalNullableString($record['continent']),
        'affiliation_raw' => avesmapsPoliticalNullableString($record['affiliation_raw']),
        'affiliation_key' => avesmapsPoliticalNullableString($record['affiliation_key']),
        'affiliation_root' => avesmapsPoliticalNullableString($record['affiliation_root']),
        'affiliation_path_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_path_json']),
        'affiliation_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_json']),
        'status' => avesmapsPoliticalNullableString($record['status']),
        'form_of_government' => avesmapsPoliticalNullableString($record['form_of_government']),
        'capital_name' => avesmapsPoliticalNullableString($record['capital_name']),
        'seat_name' => avesmapsPoliticalNullableString($record['seat_name']),
        'ruler' => avesmapsPoliticalNullableString($record['ruler']),
        'language' => avesmapsPoliticalNullableString($record['language']),
        'currency' => avesmapsPoliticalNullableString($record['currency']),
        'trade_goods' => avesmapsPoliticalNullableString($record['trade_goods']),
        'population' => avesmapsPoliticalNullableString($record['population']),
        'founded_text' => avesmapsPoliticalNullableString($record['founded_text']),
        'founded_type' => avesmapsPoliticalNullableString($record['founded_type']),
        'founded_start_bf' => $record['founded_start_bf'],
        'founded_end_bf' => $record['founded_end_bf'],
        'founded_display_bf' => $record['founded_display_bf'],
        'founded_json' => avesmapsPoliticalEncodeJsonOrNull($record['founded_json']),
        'founder' => avesmapsPoliticalNullableString($record['founder']),
        'dissolved_text' => avesmapsPoliticalNullableString($record['dissolved_text']),
        'dissolved_type' => avesmapsPoliticalNullableString($record['dissolved_type']),
        'dissolved_start_bf' => $record['dissolved_start_bf'],
        'dissolved_end_bf' => $record['dissolved_end_bf'],
        'dissolved_display_bf' => $record['dissolved_display_bf'],
        'dissolved_json' => avesmapsPoliticalEncodeJsonOrNull($record['dissolved_json']),
        'geographic' => avesmapsPoliticalNullableString($record['geographic']),
        'political' => avesmapsPoliticalNullableString($record['political']),
        'trade_zone' => avesmapsPoliticalNullableString($record['trade_zone']),
        'blazon' => avesmapsPoliticalNullableString($record['blazon']),
        'wiki_url' => avesmapsPoliticalNullableString($record['wiki_url']),
        'coat_of_arms_url' => avesmapsPoliticalNullableString($record['coat_of_arms_url']),
        'raw_json' => avesmapsPoliticalEncodeJsonOrNull($record['raw_json']),
    ]);
}

function wikiDomReadTestRows(PDO $pdo): array {
    $stmt = $pdo->query('SELECT id, wiki_key, name, type, affiliation_root, affiliation_path_json, founded_text, founded_start_bf, dissolved_text, dissolved_start_bf, wiki_url, raw_json, synced_at FROM ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' ORDER BY COALESCE(affiliation_root, name), name LIMIT 500');
    $items = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $row['affiliation_path'] = wikiDomDecodeJson($row['affiliation_path_json'] ?? null);
        $row['raw'] = wikiDomDecodeJson($row['raw_json'] ?? null);
        unset($row['affiliation_path_json'], $row['raw_json']);
        $items[] = $row;
    }
    return ['ok' => true, 'table' => AVESMAPS_WIKI_DOM_TEST_TABLE, 'count' => count($items), 'items' => $items];
}

function wikiDomEnsureTestTable(PDO $pdo): void {
    avesmapsPoliticalEnsureTables($pdo);
    $stmt = $pdo->query("SHOW TABLES LIKE '" . AVESMAPS_WIKI_DOM_TEST_TABLE . "'");
    if ($stmt->fetchColumn() === false) {
        $pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' LIKE political_territory_wiki');
    }
}

function wikiDomCreatePdo(array $db): PDO {
    if ((string) ($db['driver'] ?? 'mysql') !== 'mysql') {
        throw new RuntimeException('Nur MySQL wird unterstützt.');
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        (string) ($db['host'] ?? 'localhost'),
        (int) ($db['port'] ?? 3306),
        (string) ($db['name'] ?? ''),
        (string) ($db['charset'] ?? 'utf8mb4')
    );
    return new PDO($dsn, (string) ($db['user'] ?? ''), (string) ($db['password'] ?? ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function wikiDomFetchParsedHtml(string $title, int $timeout): string {
    $params = http_build_query([
        'action' => 'parse', 'page' => $title, 'prop' => 'text', 'format' => 'json', 'redirects' => '1', 'disablelimitreport' => '1'
    ]);
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeout,
            'header' => "User-Agent: AvesmapsWikiDomPlayground/0.1 (https://avesmaps.de/)\r\nAccept: application/json\r\n",
        ],
    ]);
    $json = @file_get_contents(AVESMAPS_WIKI_DOM_API_URL . '?' . $params, false, $context);
    if (!is_string($json) || trim($json) === '') {
        throw new RuntimeException('Wiki-Antwort leer oder nicht abrufbar.');
    }
    $data = json_decode($json, true);
    if (!is_array($data) || isset($data['error'])) {
        $message = is_array($data['error'] ?? null) ? (string) ($data['error']['info'] ?? 'Wiki-Fehler') : 'Ungültige Wiki-Antwort.';
        throw new RuntimeException($message);
    }
    $text = $data['parse']['text']['*'] ?? $data['parse']['text'] ?? '';
    if (!is_string($text) || trim($text) === '') {
        throw new RuntimeException('Keine parse.text-Daten erhalten.');
    }
    return $text;
}

function wikiDomLoadHtml(string $html): DOMDocument {
    if (!class_exists(DOMDocument::class)) {
        throw new RuntimeException('PHP-DOM-Erweiterung fehlt.');
    }
    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    return $document;
}

function wikiDomNormalizeSeedTitles(mixed $seeds): array {
    if (is_string($seeds)) {
        $seeds = preg_split('/\R+/', $seeds) ?: [];
    }
    if (!is_array($seeds)) {
        return [];
    }
    $titles = [];
    foreach ($seeds as $seed) {
        $title = wikiDomTitleFromInput((string) $seed);
        if ($title !== '') {
            $titles[] = $title;
        }
    }
    return array_values(array_unique($titles));
}

function wikiDomTitleFromInput(string $input): string {
    $input = trim($input);
    if ($input === '') {
        return '';
    }
    if (preg_match('/^https?:\/\/de\.wiki-aventurica\.de\/wiki\/(.+)$/i', $input, $match) === 1) {
        return wikiDomNormalizeTitle(rawurldecode((string) $match[1]));
    }
    if (preg_match('/^https?:\/\//i', $input) === 1) {
        return '';
    }
    return wikiDomNormalizeTitle($input);
}

function wikiDomQueueTitle(array &$queue, array &$queuedKeys, string $title, int $depth, string $source): void {
    $title = wikiDomNormalizeTitle($title);
    $key = wikiDomStableKey($title);
    if ($key === '' || isset($queuedKeys[$key])) {
        return;
    }
    $queuedKeys[$key] = true;
    $queue[] = ['title' => $title, 'depth' => $depth, 'source' => $source];
}

function wikiDomExtractWikiLinks(DOMElement $node): array {
    $links = [];
    foreach ($node->getElementsByTagName('a') as $link) {
        if (!$link instanceof DOMElement) {
            continue;
        }
        $href = trim((string) $link->getAttribute('href'));
        if (!str_starts_with($href, '/wiki/')) {
            continue;
        }
        $title = wikiDomNormalizeTitle(rawurldecode(substr($href, 6)));
        if ($title === '' || preg_match('/^(Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template):/iu', $title) === 1) {
            continue;
        }
        $links[wikiDomStableKey($title)] = ['title' => $title, 'url' => wikiDomPageUrl($title), 'text' => wikiDomCleanText($link->textContent ?? '')];
    }
    return array_values($links);
}

function wikiDomReadDocumentTitle(DOMXPath $xpath): string {
    $node = $xpath->query('//*[@id="firstHeading"]')->item(0);
    return $node instanceof DOMNode ? wikiDomCleanText($node->textContent ?? '') : '';
}

function wikiDomExtractLeadingLabel(string $text): string {
    if (preg_match('/^([^:：]{2,80})\s*[:：]/u', $text, $match) === 1) {
        return wikiDomCleanText((string) $match[1]);
    }
    return '';
}

function wikiDomField(array $page, array $keys): string {
    $fields = is_array($page['fields'] ?? null) ? $page['fields'] : [];
    foreach ($keys as $key) {
        $key = wikiDomLabelKey($key);
        if (isset($fields[$key]) && trim((string) $fields[$key]) !== '') {
            return trim((string) $fields[$key]);
        }
    }
    return '';
}

function wikiDomInferType(string $title, string $fallback): string {
    if (trim($fallback) !== '') {
        return trim($fallback);
    }
    $patterns = [
        '/\bKaiserreich\b/iu' => 'Kaiserreich', '/\bKönigreich\b/iu' => 'Königreich', '/\bKoenigreich\b/iu' => 'Königreich',
        '/\bImperium\b/iu' => 'Imperium', '/\bRepublik\b/iu' => 'Republik', '/\bHerzogtum\b/iu' => 'Herzogtum',
        '/\bFürstentum\b/iu' => 'Fürstentum', '/\bFuerstentum\b/iu' => 'Fürstentum', '/\bGrafschaft\b/iu' => 'Grafschaft',
        '/\bBaronie\b/iu' => 'Baronie', '/\bJarltum\b/iu' => 'Jarltum', '/\bSeeherrschaft\b/iu' => 'Seeherrschaft',
        '/\bOrdensland\b/iu' => 'Ordensland', '/\bReich\b/iu' => 'Reich', '/\bStaat\b/iu' => 'Staat',
    ];
    foreach ($patterns as $pattern => $type) {
        if (preg_match($pattern, $title) === 1) {
            return $type;
        }
    }
    return '';
}

function wikiDomDisplayName(string $title): string {
    $title = str_replace('_', ' ', wikiDomNormalizeTitle($title));
    return trim((string) preg_replace('/\s+\((?:Staat|Reich|Historisch|Region)\)\s*$/iu', '', $title));
}

function wikiDomNormalizeTitle(string $title): string {
    $title = str_replace('_', ' ', rawurldecode(trim($title)));
    $title = preg_replace('/#.*$/u', '', $title) ?? $title;
    return trim($title);
}

function wikiDomPageUrl(string $title): string {
    return AVESMAPS_WIKI_DOM_PAGE_BASE . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', wikiDomNormalizeTitle($title))));
}

function wikiDomStableKey(string $value): string {
    return avesmapsPoliticalSlug(wikiDomNormalizeTitle($value));
}

function wikiDomLabelKey(string $value): string {
    $value = mb_strtolower(wikiDomCleanText($value), 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $value);
    $value = preg_replace('/[^a-z0-9]+/u', ' ', $value) ?? '';
    return trim($value);
}

function wikiDomCleanText(string $text): string {
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\[[^\]]*\]/u', ' ', $text) ?? $text;
    $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
    return trim($text, " \t\n\r\0\x0B,:;");
}

function wikiDomDecodeJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }
    if (is_array($value)) {
        return $value;
    }
    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : [];
}

function wikiDomReadJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function wikiDomAcquireLock() {
    $handle = fopen(AVESMAPS_WIKI_DOM_LOCK_FILE, 'c+');
    if ($handle === false) {
        throw new RuntimeException('Lock-Datei konnte nicht geöffnet werden.');
    }
    if (!flock($handle, LOCK_EX | LOCK_NB)) {
        throw new RuntimeException('Es läuft bereits ein Wiki-DOM-Playground-Import.');
    }
    ftruncate($handle, 0);
    fwrite($handle, json_encode(['pid' => getmypid(), 'started_at' => gmdate('c')], JSON_UNESCAPED_SLASHES));
    return $handle;
}

function wikiDomReleaseLock($handle): void {
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    @unlink(AVESMAPS_WIKI_DOM_LOCK_FILE);
}

function wikiDomApplyCors(mixed $allowedOrigins): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_array($allowedOrigins) && $origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

function wikiDomRespondJson(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
