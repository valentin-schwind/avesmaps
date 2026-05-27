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
        'Republik/Liste',
        'Shîkanydad/Liste',
        'Staat/Liste',
        'Sultanat/Liste',
    ];

    $defaultCatchwords = [
        'affiliation_path_labels' => ['staat', 'staatverlauf', 'zugehörigkeit', 'zugehoerigkeit', 'politisch', 'reich', 'oberherrschaft', 'lehnsherr', 'lehnsherrschaft', 'teil von', 'provinz', 'übergeordnet', 'uebergeordnet', 'herrschaftsgebiet', 'region'],
        'founded_labels' => ['gründungsdatum', 'gruendungsdatum', 'gründung', 'gruendung', 'gründungsdaten', 'gruendungsdaten', 'unabhängigkeit', 'unabhaengigkeit', 'gegründet', 'gegruendet', 'entstehung', 'ausrufung', 'errichtung', 'erhebung', 'anerkennung', 'ausgliederung'],
        'dissolved_labels' => ['aufgelöst', 'aufgeloest', 'auflösung', 'aufloesung', 'auflösungsdatum', 'aufloesungsdatum', 'ende', 'untergang', 'zerfall', 'aufgegeben', 'eingegliedert', 'annektiert', 'erobert', 'aufhebung', 'verlust'],
        'period_labels' => ['zeitraum', 'bestehen', 'bestand', 'bestandszeit', 'existenz', 'bestanden', 'existierte', 'zeit', 'ära', 'aera'],
        'year_markers' => ['BF', 'v. BF', 'v BF'],
        'founded_context_words' => ['gegründet', 'gegruendet', 'gründung', 'gruendung', 'gründungsdatum', 'gruendungsdatum', 'gründungsdaten', 'gruendungsdaten', 'unabhängigkeit', 'unabhaengigkeit', 'entstand', 'entstehung', 'ausgerufen', 'ausrufung', 'errichtet', 'errichtung', 'erhoben', 'erhebung', 'anerkannt', 'anerkennung', 'abgespalten', 'ausgliederung'],
        'dissolved_context_words' => ['aufgelöst', 'aufgeloest', 'auflösung', 'aufloesung', 'endete', 'untergang', 'zerfiel', 'zerfall', 'aufgegeben', 'eingegliedert', 'annektiert', 'erobert', 'aufgehoben', 'aufhebung', 'verlor', 'verlust', 'fiel an', 'ging an'],
    ];

    $source = str_replace('const WIKI_DOM_MAX_ITERATIONS = 160;', 'const WIKI_DOM_MAX_ITERATIONS = 3000;', $source);
    $source = str_replace('const WIKI_DOM_MAX_PAGES = 100;', 'const WIKI_DOM_MAX_PAGES = 3000;', $source);
    $source = str_replace('const WIKI_DOM_MAX_RUNTIME = 35;', 'const WIKI_DOM_MAX_RUNTIME = 360000;', $source);

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
        <<<'PHP'
function displayName(string $pageTitle): string { return trim((string) preg_replace('/\s+\((?:Staat|Reich|Historisch|Region)\)\s*$/iu', '', str_replace('_', ' ', title($pageTitle)))); }
PHP,
        <<<'PHP'
function displayName(string $pageTitle): string { return trim((string) preg_replace('/\s+\((?:Staat|Reich|Region)\)\s*$/iu', '', str_replace('_', ' ', title($pageTitle)))); }
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
