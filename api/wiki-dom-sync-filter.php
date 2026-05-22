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

    $source = str_replace(
        '//div[contains(@class,"mw-parser-output")]//table//tr[td]//td[1]//a[@href]',
        '//div[contains(@class,"mw-parser-output")]//table//tr[count(td) >= 4]//td[1]//a[@href]',
        $source
    );

    $source = str_replace(
        '//div[contains(@class,"mw-parser-output")]//table//tr[td]//a[@href]',
        '//div[contains(@class,"mw-parser-output")]//table//tr[count(td) >= 4]//a[@href]',
        $source
    );

    return $source;
}
