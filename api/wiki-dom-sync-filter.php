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

    $defaultSeedItems = array_map(
        static fn(string $seed): string => "'" . addcslashes($seed, "'\\") . "'",
        $defaultSeeds
    );
    $defaultSeedSource = 'function defaultSeeds(): array { return [' . implode(', ', $defaultSeedItems) . ']; }';
    $source = preg_replace('/function defaultSeeds\(\): array \{ return \[[^;]*\]; \}/u', $defaultSeedSource, $source, 1) ?? $source;

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
