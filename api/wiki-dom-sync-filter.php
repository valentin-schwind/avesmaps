<?php

declare(strict_types=1);

function avesmapsWikiDomPatchSource(string $source): string {
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
        '//div[contains(@class,"mw-parser-output")]//table//tr[td]//td[1]//a[@href]',
        '//div[contains(@class,"mw-parser-output")]//table//tr[td and not(td[2][contains(normalize-space(.),"Burg") or contains(normalize-space(.),"Schloss") or contains(normalize-space(.),"Ruine") or contains(normalize-space(.),"Festung")])]//td[1]//a[@href]',
        $source
    );

    $source = str_replace(
        '//div[contains(@class,"mw-parser-output")]//table//tr[td]//a[@href]',
        '//div[contains(@class,"mw-parser-output")]//table//tr[td and not(td[2][contains(normalize-space(.),"Burg") or contains(normalize-space(.),"Schloss") or contains(normalize-space(.),"Ruine") or contains(normalize-space(.),"Festung")])]//a[@href]',
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
