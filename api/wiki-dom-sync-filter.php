<?php

declare(strict_types=1);

function avesmapsWikiDomPatchSource(string $source): string {
    $defaultSeeds = [
        'Aristokratie/Liste',
        'Baronie/Liste',
        'Boronkratie/Liste',
        'Despotie/Liste',
        'Emirat/Liste',
        'Freiherrschaft/Liste',
        'Fürstentum/Liste',
        'Geldaristokratie/Liste',
        'Grafschaft/Liste',
        'Herzogtum/Liste',
        'Jarltum/Liste',
        'Kaiserreich/Liste',
        'Königreich/Liste',
        'Magokratie/Liste',
        'Markgrafschaft/Liste',
        'Matriarchat/Liste',
        'Oligarchie/Liste',
        'Pfalzgrafschaft/Liste',
        'Plutokratie/Liste',
        'Reichsmark/Liste',
        'Republik/Liste',
        'Rondrakratie/Liste',
        'Shîkanydad/Liste',
        'Staat/Liste',
        'Sultanat/Liste',
        'Theokratie/Liste',
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
        'function temporalData(array $fields, DOMXPath $xpath, array $catchwords): array {',
        "function wikiDomIsIgnoredTemporalText(string \$text): bool { \$key = labelKey(\$text); return str_contains(\$key, 'begriffsklaerung') || str_contains(\$key, 'hat mehrere bedeutungen') || str_contains(\$key, 'dieser artikel steht fuer'); }\nfunction temporalData(array \$fields, DOMXPath \$xpath, array \$catchwords): array {",
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
