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

const AVESMAPS_WIKI_DOM_TEST_TABLE = 'political_territory_wiki_test';
const AVESMAPS_WIKI_DOM_API_URL = 'https://de.wiki-aventurica.de/api.php';
const AVESMAPS_WIKI_DOM_PAGE_BASE = 'https://de.wiki-aventurica.de/wiki/';
const AVESMAPS_WIKI_DOM_LOCK_FILE = __DIR__ . '/wiki-dom-playground.lock';
const AVESMAPS_WIKI_DOM_MAX_DEPTH = 4;
const AVESMAPS_WIKI_DOM_MAX_ITERATIONS = 120;
const AVESMAPS_WIKI_DOM_MAX_PAGES = 100;
const AVESMAPS_WIKI_DOM_MAX_RUNTIME_SECONDS = 30;

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    wikiDomJson(['ok' => false, 'error' => 'config.local.php fehlt.'], 500);
}
$config = require $configPath;
if (!is_array($config) || !isset($config['database']) || !is_array($config['database'])) {
    wikiDomJson(['ok' => false, 'error' => 'config.local.php liefert keine gültige database-Konfiguration.'], 500);
}
wikiDomCors($config['cors']['allowed_origins'] ?? []);
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = wikiDomPdo($config['database']);
    wikiDomEnsureTestTable($pdo);
    $action = trim((string) ($_GET['action'] ?? 'list'));

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = wikiDomReadJsonBody();
        if ($action === 'run') {
            wikiDomRun($pdo, $payload);
        }
        if ($action === 'clear') {
            $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_DOM_TEST_TABLE);
            wikiDomJson(['ok' => true, 'message' => 'Test-Tabelle geleert.']);
        }
        wikiDomJson(['ok' => false, 'error' => 'Unbekannte POST-Action.'], 400);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        wikiDomJson(['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.'], 405);
    }
    if ($action === 'list') {
        wikiDomJson(wikiDomReadRows($pdo));
    }
    if ($action === 'defaults') {
        wikiDomJson([
            'ok' => true,
            'defaults' => wikiDomDefaultOptions(),
            'seeds' => wikiDomDefaultSeedTitles(),
            'catchwords' => wikiDomDefaultCatchwords(),
        ]);
    }
    wikiDomJson(['ok' => false, 'error' => 'Unbekannte GET-Action.'], 400);
} catch (Throwable $error) {
    wikiDomJson(['ok' => false, 'error' => $error->getMessage()], 500);
}

function wikiDomRun(PDO $pdo, array $payload): void {
    $lock = wikiDomLock();
    $startedAt = microtime(true);
    try {
        @set_time_limit(AVESMAPS_WIKI_DOM_MAX_RUNTIME_SECONDS + 10);
        ignore_user_abort(false);

        $options = wikiDomOptions($payload);
        $catchwords = wikiDomCatchwords($payload['catchwords'] ?? null);
        $seedTitles = wikiDomSeedInputs($payload['seeds'] ?? wikiDomDefaultSeedTitles());
        if ($seedTitles === []) {
            throw new RuntimeException('Mindestens ein Seed ist erforderlich.');
        }

        $queue = [];
        $queued = [];
        foreach ($seedTitles as $title) {
            wikiDomQueue($queue, $queued, $title, 0, 'entrypoint');
        }

        $pages = [];
        $relations = [];
        $events = [];
        $errors = [];
        $iterations = 0;
        $territoryPages = 0;
        $entrypointPages = 0;

        while ($queue !== []) {
            if (connection_aborted()) {
                $events[] = ['type' => 'abort', 'message' => 'Client-Verbindung abgebrochen.'];
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
            if ($territoryPages >= $options['max_pages']) {
                $events[] = ['type' => 'limit', 'message' => 'Maximale Territory-Seitenzahl erreicht.'];
                break;
            }

            $iterations++;
            $entry = array_shift($queue);
            $title = wikiDomTitle((string) ($entry['title'] ?? ''));
            $depth = (int) ($entry['depth'] ?? 0);
            $source = (string) ($entry['source'] ?? '');
            if ($title === '') {
                continue;
            }

            try {
                $html = wikiDomFetchHtml($title, $options['request_timeout_seconds']);
                $document = wikiDomDocument($html);
                $xpath = new DOMXPath($document);
                $resolvedTitle = wikiDomHeading($xpath) ?: $title;

                if (wikiDomIsEntrypointTitle($title) || wikiDomIsEntrypointTitle($resolvedTitle) || $source === 'entrypoint') {
                    $entrypointPages++;
                    $links = wikiDomExtractSeedLinks($xpath);
                    foreach ($links as $linkTitle) {
                        wikiDomQueue($queue, $queued, $linkTitle, 0, 'seed-list:' . $resolvedTitle);
                    }
                    $events[] = [
                        'type' => 'entrypoint',
                        'title' => $resolvedTitle,
                        'links' => count($links),
                        'message' => 'Seed-Liste gelesen, aber nicht als Territory gespeichert.',
                    ];
                    wikiDomSleep($options['sleep_ms']);
                    continue;
                }

                $key = wikiDomKey($resolvedTitle);
                if (isset($pages[$key]) && !empty($pages[$key]['fetched'])) {
                    wikiDomSleep($options['sleep_ms']);
                    continue;
                }

                $page = wikiDomAnalyze($xpath, $resolvedTitle, $depth, $catchwords);
                $pages[$key] = $page;
                $territoryPages++;

                foreach ($page['relations'] as $relation) {
                    $relations[] = $relation;
                    if ($depth < $options['max_depth'] && in_array((string) $relation['relation_type'], ['child', 'parent'], true)) {
                        wikiDomQueue($queue, $queued, (string) ($relation['target_title'] ?? ''), $depth + 1, 'relation:' . (string) $relation['relation_type']);
                    }
                }
            } catch (Throwable $error) {
                $errors[] = ['title' => $title, 'error' => $error->getMessage()];
            }

            wikiDomSleep($options['sleep_ms']);
        }

        wikiDomAddSynthetic($pages, $relations);
        wikiDomStore($pdo, $pages, $relations);

        $result = wikiDomReadRows($pdo);
        $result['run'] = [
            'ok' => true,
            'runtime_seconds' => round(microtime(true) - $startedAt, 3),
            'iterations' => $iterations,
            'entrypoint_pages' => $entrypointPages,
            'fetched_pages' => $territoryPages,
            'queued_remaining' => count($queue),
            'relations' => count($relations),
            'events' => $events,
            'errors' => $errors,
            'options' => $options,
        ];
        $result['relations'] = $relations;
        wikiDomJson($result);
    } finally {
        wikiDomUnlock($lock);
    }
}

function wikiDomDefaultSeedTitles(): array {
    return [
        'Baronie/Liste',
        'Bergkönigreich/Liste',
        'Domäne (Horasreich)/Liste',
        'Emirat/Liste',
        'Freiherrschaft/Liste',
        'Fürstentum/Liste',
        'Grafschaft/Liste',
        'Herzogtum/Liste',
        'Kaiserliches Eigengut/Liste',
        'Komturei/Liste',
        'Königreich/Liste',
        'Markgrafschaft/Liste',
        'Pfalzgrafschaft/Liste',
        'Provinz (Imperium)/Liste',
        'Provinz (Mittelreich)/Liste',
        'Reichsmark/Liste',
        'Republik/Liste',
        'Shîkanydad/Liste',
        'Staat/Liste',
        'Sultanat/Liste',
        'Theokratie/Liste',
    ];
}

function wikiDomIsEntrypointTitle(string $title): bool {
    $title = wikiDomTitle($title);
    if (preg_match('/\/Liste$/u', $title) === 1) {
        return true;
    }
    $key = wikiDomKey($title);
    foreach (wikiDomDefaultSeedTitles() as $seed) {
        if (wikiDomKey($seed) === $key) {
            return true;
        }
    }
    return false;
}

function wikiDomDefaultOptions(): array {
    return [
        'max_depth' => 1,
        'max_iterations' => 30,
        'max_pages' => 20,
        'max_runtime_seconds' => 20,
        'sleep_ms' => 450,
        'request_timeout_seconds' => 8,
    ];
}

function wikiDomOptions(array $payload): array {
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
        'child_labels' => ['provinzen', 'unterregionen', 'verwaltungseinheiten', 'verwaltungsgebiete', 'herzogtümer', 'herzogtuemer', 'fürstentümer', 'fuerstentuemer', 'grafschaften', 'landgrafschaften', 'markgrafschaften', 'baronien', 'freiherrschaften', 'jarltümer', 'jarltuemer', 'kronvogteien', 'kolonien', 'kolonien und exklaven', 'exklaven'],
        'former_child_labels' => ['ehemalige jarltümer', 'ehemalige provinzen', 'ehemalige baronien', 'ehemalige grafschaften', 'ehemals freie städte'],
        'claim_labels' => ['beansprucht', 'territorialansprüche', 'territorialansprueche'],
        'parent_labels' => ['zugehörigkeit', 'zugehoerigkeit', 'staat', 'reich', 'politisch', 'oberherrschaft'],
        'ignore_labels' => ['siedlungen', 'städte', 'staedte', 'dörfer', 'doerfer', 'festungen', 'flüsse', 'fluesse', 'gebirge', 'wälder', 'waelder', 'seen', 'meere', 'nachbarn', 'verkehrswege', 'weblinks', 'publikationen', 'quellen'],
        'parent_phrases' => ['provinz des', 'provinz der', 'provinz von', 'baronie des', 'baronie der', 'grafschaft des', 'grafschaft der', 'gehört zu', 'gehört zum', 'gehört zur', 'teil des', 'teil der', 'untersteht'],
    ];
}

function wikiDomCatchwords(mixed $value): array {
    $defaults = wikiDomDefaultCatchwords();
    if (is_string($value) && trim($value) !== '') {
        $decoded = json_decode($value, true);
        if (is_array($decoded)) {
            $value = $decoded;
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
        $defaults[$key] = array_values(array_unique(array_filter(array_map(static fn(mixed $item): string => wikiDomLabelKey((string) $item), $custom))));
    }
    return $defaults;
}

function wikiDomAnalyze(DOMXPath $xpath, string $title, int $depth, array $catchwords): array {
    $fields = wikiDomFields($xpath);
    $relations = wikiDomRelations($xpath, $title, $catchwords);
    $temporal = wikiDomTemporal($fields, $xpath);
    $url = wikiDomUrl($title);
    return [
        'fetched' => true,
        'synthetic' => false,
        'title' => $title,
        'name' => wikiDomDisplayName($title),
        'wiki_key' => avesmapsPoliticalBuildWikiKey($url, $title),
        'wiki_url' => $url,
        'type' => wikiDomInferType($title, (string) ($fields['typ'] ?? $fields['art'] ?? $fields['herrschaftsgebiet'] ?? '')),
        'depth' => $depth,
        'fields' => $fields,
        'relations' => $relations,
        'temporal' => $temporal,
        'raw' => ['source' => 'wiki-dom-playground-seed', 'title' => $title, 'depth' => $depth, 'fields' => $fields, 'relations' => $relations, 'temporal' => $temporal],
    ];
}

function wikiDomExtractSeedLinks(DOMXPath $xpath): array {
    $links = [];
    foreach ($xpath->query('//table//a[@href] | //div[contains(@class,"mw-parser-output")]//ul//a[@href]') ?: [] as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }
        $title = wikiDomTitleFromHref((string) $node->getAttribute('href'));
        if ($title === '' || wikiDomIsEntrypointTitle($title) || !wikiDomIsRelevantWikiTitle($title)) {
            continue;
        }
        $text = wikiDomClean($node->textContent ?? '');
        if ($text === '' || mb_strlen($text, 'UTF-8') < 2) {
            continue;
        }
        $links[wikiDomKey($title)] = $title;
    }
    return array_values($links);
}

function wikiDomRelations(DOMXPath $xpath, string $sourceTitle, array $catchwords): array {
    $relations = [];
    $sourceKey = avesmapsPoliticalBuildWikiKey(wikiDomUrl($sourceTitle), $sourceTitle);
    foreach ($xpath->query('//tr[th and td] | //dl/* | //li | //p') ?: [] as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }
        $text = wikiDomClean($node->textContent ?? '');
        if ($text === '') {
            continue;
        }
        $label = wikiDomLeadingLabel($text);
        $labelKey = wikiDomLabelKey($label);
        if ($labelKey !== '' && in_array($labelKey, $catchwords['ignore_labels'], true)) {
            continue;
        }
        $links = wikiDomLinks($node);
        if ($links === []) {
            continue;
        }
        if ($labelKey !== '' && in_array($labelKey, $catchwords['child_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomRelation($sourceTitle, $sourceKey, $link, 'child', 'label', $label, $text, 0.88, 'current');
            }
            continue;
        }
        if ($labelKey !== '' && in_array($labelKey, $catchwords['former_child_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomRelation($sourceTitle, $sourceKey, $link, 'child', 'label', $label, $text, 0.62, 'former');
            }
            continue;
        }
        if ($labelKey !== '' && in_array($labelKey, $catchwords['claim_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomRelation($sourceTitle, $sourceKey, $link, 'claim', 'label', $label, $text, 0.45, 'claimed');
            }
            continue;
        }
        if ($labelKey !== '' && in_array($labelKey, $catchwords['parent_labels'], true)) {
            foreach ($links as $link) {
                $relations[] = wikiDomRelation($sourceTitle, $sourceKey, $link, 'parent', 'label', $label, $text, 0.84, 'current');
            }
            continue;
        }
        $lower = mb_strtolower($text, 'UTF-8');
        foreach ($catchwords['parent_phrases'] as $phrase) {
            if ($phrase !== '' && str_contains($lower, $phrase)) {
                foreach ($links as $link) {
                    $relations[] = wikiDomRelation($sourceTitle, $sourceKey, $link, 'parent', 'sentence', $phrase, $text, 0.68, 'current');
                }
                break;
            }
        }
    }
    return wikiDomDedupeRelations($relations);
}

function wikiDomRelation(string $sourceTitle, string $sourceKey, array $link, string $type, string $evidenceType, string $label, string $text, float $confidence, string $statusHint): array {
    $targetTitle = (string) ($link['title'] ?? '');
    $targetUrl = wikiDomUrl($targetTitle);
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
        'raw_text' => mb_substr($text, 0, 700, 'UTF-8'),
        'confidence' => $confidence,
        'status_hint' => $statusHint,
    ];
}

function wikiDomDedupeRelations(array $relations): array {
    $out = [];
    foreach ($relations as $relation) {
        $key = implode('|', [(string) ($relation['source_wiki_key'] ?? ''), (string) ($relation['target_wiki_key'] ?? ''), (string) ($relation['relation_type'] ?? ''), (string) ($relation['status_hint'] ?? '')]);
        if (!isset($out[$key]) || (float) $relation['confidence'] > (float) $out[$key]['confidence']) {
            $out[$key] = $relation;
        }
    }
    return array_values($out);
}

function wikiDomFields(DOMXPath $xpath): array {
    $fields = [];
    foreach ($xpath->query('//tr[th and td]') ?: [] as $row) {
        if (!$row instanceof DOMElement) {
            continue;
        }
        $th = $row->getElementsByTagName('th')->item(0);
        $td = $row->getElementsByTagName('td')->item(0);
        if (!$th instanceof DOMNode || !$td instanceof DOMNode) {
            continue;
        }
        $key = wikiDomLabelKey($th->textContent ?? '');
        $value = wikiDomClean($td->textContent ?? '');
        if ($key !== '' && $value !== '' && !isset($fields[$key])) {
            $fields[$key] = $value;
        }
    }
    return $fields;
}

function wikiDomTemporal(array $fields, DOMXPath $xpath): array {
    $items = [];
    foreach ($fields as $key => $value) {
        if (preg_match('/gruendung|grundung|gegruendet|gegrundet|neugruendung|neugrundung/u', $key) === 1) {
            $items[] = wikiDomTemporalItem('founded', $value, 'field', $key, 0.94);
        }
        if (preg_match('/aufgeloest|aufgelost|aufloesung|auflosung/u', $key) === 1) {
            $items[] = wikiDomTemporalItem('dissolved', $value, 'field', $key, 0.94);
        }
        if (preg_match('/zeitraum|bestehen|bestand|bestandszeit/u', $key) === 1) {
            foreach (preg_split('/\s*(?:-|–|—|bis)\s*/u', $value) ?: [] as $index => $part) {
                if (trim($part) !== '') {
                    $items[] = wikiDomTemporalItem($index === 0 ? 'founded' : 'dissolved', $part, 'field', $key, 0.72);
                }
            }
        }
    }
    foreach ($xpath->query('//p') ?: [] as $paragraph) {
        $text = wikiDomClean($paragraph instanceof DOMElement ? ($paragraph->textContent ?? '') : '');
        if (preg_match('/\b(gegr(?:ü|u)ndet|entstand|ausgerufen)\b.{0,80}\b\d{1,4}\s*BF\b/iu', $text, $match) === 1) {
            $items[] = wikiDomTemporalItem('founded', (string) $match[0], 'sentence', '', 0.68);
        }
        if (preg_match('/\b(aufgel(?:ö|o)st|endete|fiel)\b.{0,80}\b\d{1,4}\s*BF\b/iu', $text, $match) === 1) {
            $items[] = wikiDomTemporalItem('dissolved', (string) $match[0], 'sentence', '', 0.64);
        }
    }
    return $items;
}

function wikiDomTemporalItem(string $kind, string $rawText, string $sourceType, string $sourceField, float $confidence): array {
    $years = [];
    if (preg_match_all('/(?<!\d)(\d{1,4})(?:\s*[\/.]\s*\d{1,4})?\s*BF\b/iu', $rawText, $matches) !== false) {
        foreach ($matches[1] as $year) {
            $years[] = (int) $year;
        }
    }
    $years = array_values(array_unique($years));
    return ['kind' => $kind, 'raw_text' => mb_substr(wikiDomClean($rawText), 0, 500, 'UTF-8'), 'start_bf' => $years[0] ?? null, 'end_bf' => $years[1] ?? ($years[0] ?? null), 'source_type' => $sourceType, 'source_field' => $sourceField, 'confidence' => $confidence];
}

function wikiDomStore(PDO $pdo, array $pages, array $relations): void {
    $parents = wikiDomResolveParents($relations);
    foreach ($pages as $key => $page) {
        if (!is_array($page) || !empty($page['entrypoint'])) {
            continue;
        }
        $wikiKey = (string) ($page['wiki_key'] ?? $key);
        $parent = $parents[$wikiKey] ?? null;
        $path = [];
        $affiliationRaw = '';
        if (is_array($parent)) {
            $path = wikiDomBuildPath($parents, (string) $parent['parent_wiki_key'], [$wikiKey => true]);
            $path[] = (string) $parent['parent_name'];
            $path = array_values(array_unique(array_filter($path)));
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
            'Zugehoerigkeit-JSON' => ['path' => $path, 'source' => 'wiki-dom-playground-seed'],
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
        wikiDomUpsert($pdo, avesmapsPoliticalNormalizeWikiRecord($record));
    }
}

function wikiDomResolveParents(array $relations): array {
    $candidates = [];
    $childForward = [];
    foreach ($relations as $relation) {
        $source = (string) ($relation['source_wiki_key'] ?? '');
        $target = (string) ($relation['target_wiki_key'] ?? '');
        $type = (string) ($relation['relation_type'] ?? '');
        if ($source === '' || $target === '') {
            continue;
        }
        if ($type === 'child') {
            $childForward[$source . '>' . $target] = true;
            $candidates[$target][] = ['child_wiki_key' => $target, 'parent_wiki_key' => $source, 'parent_name' => (string) ($relation['source_title'] ?? ''), 'score' => (float) ($relation['confidence'] ?? 0.5), 'evidence_text' => (string) ($relation['raw_text'] ?? '')];
        } elseif ($type === 'parent') {
            $candidates[$source][] = ['child_wiki_key' => $source, 'parent_wiki_key' => $target, 'parent_name' => (string) ($relation['target_name'] ?? $relation['target_title'] ?? ''), 'score' => (float) ($relation['confidence'] ?? 0.5), 'evidence_text' => (string) ($relation['raw_text'] ?? '')];
        }
    }
    $resolved = [];
    foreach ($candidates as $childKey => $items) {
        $best = null;
        foreach ($items as $item) {
            if (isset($childForward[(string) $item['parent_wiki_key'] . '>' . (string) $item['child_wiki_key']])) {
                $item['score'] += 0.5;
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

function wikiDomBuildPath(array $parents, string $key, array $seen, int $depth = 0): array {
    if ($key === '' || $depth > 12 || isset($seen[$key])) {
        return [];
    }
    $parent = $parents[$key] ?? null;
    if (!is_array($parent)) {
        return [];
    }
    $seen[$key] = true;
    $path = wikiDomBuildPath($parents, (string) $parent['parent_wiki_key'], $seen, $depth + 1);
    $path[] = (string) $parent['parent_name'];
    return $path;
}

function wikiDomBestTemporal(array $items, string $kind): ?array {
    $best = null;
    foreach ($items as $item) {
        if (is_array($item) && (string) ($item['kind'] ?? '') === $kind && ($best === null || (float) ($item['confidence'] ?? 0) > (float) ($best['confidence'] ?? 0))) {
            $best = $item;
        }
    }
    return $best;
}

function wikiDomAddSynthetic(array &$pages, array $relations): void {
    foreach ($relations as $relation) {
        if (!in_array((string) ($relation['relation_type'] ?? ''), ['child', 'parent'], true)) {
            continue;
        }
        $title = (string) ($relation['target_title'] ?? '');
        $key = wikiDomKey($title);
        if ($key !== '' && !isset($pages[$key]) && !wikiDomIsEntrypointTitle($title)) {
            $url = wikiDomUrl($title);
            $pages[$key] = ['fetched' => false, 'synthetic' => true, 'title' => $title, 'name' => wikiDomDisplayName($title), 'wiki_key' => avesmapsPoliticalBuildWikiKey($url, $title), 'wiki_url' => $url, 'type' => wikiDomInferType($title, ''), 'fields' => [], 'relations' => [], 'temporal' => [], 'raw' => ['source' => 'wiki-dom-playground-seed', 'synthetic' => true, 'reason' => 'relation_target', 'relation' => $relation]];
        }
    }
}

function wikiDomUpsert(PDO $pdo, array $record): void {
    $sql = 'INSERT INTO ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' (wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root, affiliation_path_json, affiliation_json, status, form_of_government, capital_name, seat_name, ruler, language, currency, trade_goods, population, founded_text, founded_type, founded_start_bf, founded_end_bf, founded_display_bf, founded_json, founder, dissolved_text, dissolved_type, dissolved_start_bf, dissolved_end_bf, dissolved_display_bf, dissolved_json, geographic, political, trade_zone, blazon, wiki_url, coat_of_arms_url, raw_json, synced_at) VALUES (:wiki_key, :name, :type, :continent, :affiliation_raw, :affiliation_key, :affiliation_root, :affiliation_path_json, :affiliation_json, :status, :form_of_government, :capital_name, :seat_name, :ruler, :language, :currency, :trade_goods, :population, :founded_text, :founded_type, :founded_start_bf, :founded_end_bf, :founded_display_bf, :founded_json, :founder, :dissolved_text, :dissolved_type, :dissolved_start_bf, :dissolved_end_bf, :dissolved_display_bf, :dissolved_json, :geographic, :political, :trade_zone, :blazon, :wiki_url, :coat_of_arms_url, :raw_json, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), continent=VALUES(continent), affiliation_raw=VALUES(affiliation_raw), affiliation_key=VALUES(affiliation_key), affiliation_root=VALUES(affiliation_root), affiliation_path_json=VALUES(affiliation_path_json), affiliation_json=VALUES(affiliation_json), status=VALUES(status), form_of_government=VALUES(form_of_government), capital_name=VALUES(capital_name), seat_name=VALUES(seat_name), ruler=VALUES(ruler), language=VALUES(language), currency=VALUES(currency), trade_goods=VALUES(trade_goods), population=VALUES(population), founded_text=VALUES(founded_text), founded_type=VALUES(founded_type), founded_start_bf=VALUES(founded_start_bf), founded_end_bf=VALUES(founded_end_bf), founded_display_bf=VALUES(founded_display_bf), founded_json=VALUES(founded_json), founder=VALUES(founder), dissolved_text=VALUES(dissolved_text), dissolved_type=VALUES(dissolved_type), dissolved_start_bf=VALUES(dissolved_start_bf), dissolved_end_bf=VALUES(dissolved_end_bf), dissolved_display_bf=VALUES(dissolved_display_bf), dissolved_json=VALUES(dissolved_json), geographic=VALUES(geographic), political=VALUES(political), trade_zone=VALUES(trade_zone), blazon=VALUES(blazon), wiki_url=VALUES(wiki_url), coat_of_arms_url=VALUES(coat_of_arms_url), raw_json=VALUES(raw_json), synced_at=CURRENT_TIMESTAMP(3)';
    $pdo->prepare($sql)->execute([
        'wiki_key' => $record['wiki_key'], 'name' => $record['name'], 'type' => avesmapsPoliticalNullableString($record['type']), 'continent' => avesmapsPoliticalNullableString($record['continent']), 'affiliation_raw' => avesmapsPoliticalNullableString($record['affiliation_raw']), 'affiliation_key' => avesmapsPoliticalNullableString($record['affiliation_key']), 'affiliation_root' => avesmapsPoliticalNullableString($record['affiliation_root']), 'affiliation_path_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_path_json']), 'affiliation_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_json']), 'status' => avesmapsPoliticalNullableString($record['status']), 'form_of_government' => avesmapsPoliticalNullableString($record['form_of_government']), 'capital_name' => avesmapsPoliticalNullableString($record['capital_name']), 'seat_name' => avesmapsPoliticalNullableString($record['seat_name']), 'ruler' => avesmapsPoliticalNullableString($record['ruler']), 'language' => avesmapsPoliticalNullableString($record['language']), 'currency' => avesmapsPoliticalNullableString($record['currency']), 'trade_goods' => avesmapsPoliticalNullableString($record['trade_goods']), 'population' => avesmapsPoliticalNullableString($record['population']), 'founded_text' => avesmapsPoliticalNullableString($record['founded_text']), 'founded_type' => avesmapsPoliticalNullableString($record['founded_type']), 'founded_start_bf' => $record['founded_start_bf'], 'founded_end_bf' => $record['founded_end_bf'], 'founded_display_bf' => $record['founded_display_bf'], 'founded_json' => avesmapsPoliticalEncodeJsonOrNull($record['founded_json']), 'founder' => avesmapsPoliticalNullableString($record['founder']), 'dissolved_text' => avesmapsPoliticalNullableString($record['dissolved_text']), 'dissolved_type' => avesmapsPoliticalNullableString($record['dissolved_type']), 'dissolved_start_bf' => $record['dissolved_start_bf'], 'dissolved_end_bf' => $record['dissolved_end_bf'], 'dissolved_display_bf' => $record['dissolved_display_bf'], 'dissolved_json' => avesmapsPoliticalEncodeJsonOrNull($record['dissolved_json']), 'geographic' => avesmapsPoliticalNullableString($record['geographic']), 'political' => avesmapsPoliticalNullableString($record['political']), 'trade_zone' => avesmapsPoliticalNullableString($record['trade_zone']), 'blazon' => avesmapsPoliticalNullableString($record['blazon']), 'wiki_url' => avesmapsPoliticalNullableString($record['wiki_url']), 'coat_of_arms_url' => avesmapsPoliticalNullableString($record['coat_of_arms_url']), 'raw_json' => avesmapsPoliticalEncodeJsonOrNull($record['raw_json'])
    ]);
}

function wikiDomReadRows(PDO $pdo): array {
    $stmt = $pdo->query('SELECT id, wiki_key, name, type, affiliation_root, affiliation_path_json, founded_text, founded_start_bf, dissolved_text, dissolved_start_bf, wiki_url, raw_json, synced_at FROM ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' ORDER BY COALESCE(affiliation_root, name), name LIMIT 500');
    $items = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $row['affiliation_path'] = wikiDomJsonDecode($row['affiliation_path_json'] ?? null);
        $row['raw'] = wikiDomJsonDecode($row['raw_json'] ?? null);
        unset($row['affiliation_path_json'], $row['raw_json']);
        $items[] = $row;
    }
    return ['ok' => true, 'table' => AVESMAPS_WIKI_DOM_TEST_TABLE, 'count' => count($items), 'items' => $items];
}

function wikiDomEnsureTestTable(PDO $pdo): void {
    avesmapsPoliticalEnsureTables($pdo);
    if ($pdo->query("SHOW TABLES LIKE '" . AVESMAPS_WIKI_DOM_TEST_TABLE . "'")->fetchColumn() === false) {
        $pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_DOM_TEST_TABLE . ' LIKE political_territory_wiki');
    }
}

function wikiDomPdo(array $db): PDO {
    if ((string) ($db['driver'] ?? 'mysql') !== 'mysql') {
        throw new RuntimeException('Nur MySQL wird unterstützt.');
    }
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', (string) ($db['host'] ?? 'localhost'), (int) ($db['port'] ?? 3306), (string) ($db['name'] ?? ''), (string) ($db['charset'] ?? 'utf8mb4'));
    return new PDO($dsn, (string) ($db['user'] ?? ''), (string) ($db['password'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
}

function wikiDomFetchHtml(string $title, int $timeout): string {
    $query = http_build_query(['action' => 'parse', 'page' => $title, 'prop' => 'text', 'format' => 'json', 'redirects' => '1', 'disablelimitreport' => '1']);
    $context = stream_context_create(['http' => ['method' => 'GET', 'timeout' => $timeout, 'header' => "User-Agent: AvesmapsWikiDomPlayground/0.2 (https://avesmaps.de/)\r\nAccept: application/json\r\n"]]);
    $json = @file_get_contents(AVESMAPS_WIKI_DOM_API_URL . '?' . $query, false, $context);
    if (!is_string($json) || trim($json) === '') {
        throw new RuntimeException('Wiki-Antwort leer oder nicht abrufbar.');
    }
    $data = json_decode($json, true);
    if (!is_array($data) || isset($data['error'])) {
        throw new RuntimeException(is_array($data['error'] ?? null) ? (string) ($data['error']['info'] ?? 'Wiki-Fehler') : 'Ungültige Wiki-Antwort.');
    }
    $html = $data['parse']['text']['*'] ?? $data['parse']['text'] ?? '';
    if (!is_string($html) || trim($html) === '') {
        throw new RuntimeException('Keine parse.text-Daten erhalten.');
    }
    return $html;
}

function wikiDomDocument(string $html): DOMDocument {
    if (!class_exists(DOMDocument::class)) {
        throw new RuntimeException('PHP-DOM-Erweiterung fehlt.');
    }
    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    return $document;
}

function wikiDomSeedInputs(mixed $seeds): array {
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
        return wikiDomTitle(rawurldecode((string) $match[1]));
    }
    return preg_match('/^https?:\/\//i', $input) === 1 ? '' : wikiDomTitle($input);
}

function wikiDomQueue(array &$queue, array &$queued, string $title, int $depth, string $source): void {
    $title = wikiDomTitle($title);
    $key = wikiDomKey($title);
    if ($key === '' || isset($queued[$key])) {
        return;
    }
    $queued[$key] = true;
    $queue[] = ['title' => $title, 'depth' => $depth, 'source' => $source];
}

function wikiDomLinks(DOMElement $node): array {
    $links = [];
    foreach ($node->getElementsByTagName('a') as $link) {
        if (!$link instanceof DOMElement) {
            continue;
        }
        $title = wikiDomTitleFromHref((string) $link->getAttribute('href'));
        if ($title === '' || !wikiDomIsRelevantWikiTitle($title)) {
            continue;
        }
        $links[wikiDomKey($title)] = ['title' => $title, 'url' => wikiDomUrl($title), 'text' => wikiDomClean($link->textContent ?? '')];
    }
    return array_values($links);
}

function wikiDomTitleFromHref(string $href): string {
    $href = trim($href);
    if (!str_starts_with($href, '/wiki/')) {
        return '';
    }
    return wikiDomTitle(rawurldecode(substr($href, 6)));
}

function wikiDomIsRelevantWikiTitle(string $title): bool {
    if ($title === '' || str_contains($title, '#')) {
        return false;
    }
    return preg_match('/^(Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template|Benutzer|Diskussion):/iu', $title) !== 1;
}

function wikiDomHeading(DOMXPath $xpath): string {
    $node = $xpath->query('//*[@id="firstHeading"]')->item(0);
    return $node instanceof DOMNode ? wikiDomClean($node->textContent ?? '') : '';
}

function wikiDomLeadingLabel(string $text): string {
    return preg_match('/^([^:：]{2,80})\s*[:：]/u', $text, $match) === 1 ? wikiDomClean((string) $match[1]) : '';
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
    $patterns = ['/\bKaiserreich\b/iu' => 'Kaiserreich', '/\bKönigreich\b/iu' => 'Königreich', '/\bBergkönigreich\b/iu' => 'Bergkönigreich', '/\bImperium\b/iu' => 'Imperium', '/\bRepublik\b/iu' => 'Republik', '/\bHerzogtum\b/iu' => 'Herzogtum', '/\bFürstentum\b/iu' => 'Fürstentum', '/\bGrafschaft\b/iu' => 'Grafschaft', '/\bBaronie\b/iu' => 'Baronie', '/\bFreiherrschaft\b/iu' => 'Freiherrschaft', '/\bMarkgrafschaft\b/iu' => 'Markgrafschaft', '/\bPfalzgrafschaft\b/iu' => 'Pfalzgrafschaft', '/\bJarltum\b/iu' => 'Jarltum', '/\bSultanat\b/iu' => 'Sultanat', '/\bEmirat\b/iu' => 'Emirat', '/\bTheokratie\b/iu' => 'Theokratie', '/\bKomturei\b/iu' => 'Komturei', '/\bDomäne\b/iu' => 'Domäne', '/\bOrdensland\b/iu' => 'Ordensland', '/\bReich\b/iu' => 'Reich', '/\bStaat\b/iu' => 'Staat'];
    foreach ($patterns as $pattern => $type) {
        if (preg_match($pattern, $title) === 1) {
            return $type;
        }
    }
    return '';
}

function wikiDomDisplayName(string $title): string {
    return trim((string) preg_replace('/\s+\((?:Staat|Reich|Historisch|Region)\)\s*$/iu', '', str_replace('_', ' ', wikiDomTitle($title))));
}

function wikiDomTitle(string $title): string {
    $title = str_replace('_', ' ', rawurldecode(trim($title)));
    $title = preg_replace('/#.*$/u', '', $title) ?? $title;
    return trim($title);
}

function wikiDomUrl(string $title): string {
    return AVESMAPS_WIKI_DOM_PAGE_BASE . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', wikiDomTitle($title))));
}

function wikiDomKey(string $value): string {
    return avesmapsPoliticalSlug(wikiDomTitle($value));
}

function wikiDomLabelKey(string $value): string {
    $value = mb_strtolower(wikiDomClean($value), 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $value);
    $value = preg_replace('/[^a-z0-9]+/u', ' ', $value) ?? '';
    return trim($value);
}

function wikiDomClean(string $text): string {
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\[[^\]]*\]/u', ' ', $text) ?? $text;
    $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
    return trim($text, " \t\n\r\0\x0B,:;");
}

function wikiDomJsonDecode(mixed $value): array {
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

function wikiDomSleep(int $sleepMs): void {
    if ($sleepMs > 0) {
        usleep($sleepMs * 1000);
    }
}

function wikiDomLock() {
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

function wikiDomUnlock($handle): void {
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    @unlink(AVESMAPS_WIKI_DOM_LOCK_FILE);
}

function wikiDomCors(mixed $allowedOrigins): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_array($allowedOrigins) && $origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

function wikiDomJson(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
