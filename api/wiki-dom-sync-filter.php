<?php

declare(strict_types=1);

function avesmapsWikiDomPatchSource(string $source): string {
    $source = str_replace(
        "foreach (\$xpath->query('//tr[th and td] | //tr[count(td) >= 1]') ?: [] as \$row) { if (!\$row instanceof DOMElement) continue;",
        "foreach (\$xpath->query('//*[@id=\"mw-content-text\"]//*[contains(concat(\" \", normalize-space(@class), \" \"), \" mw-parser-output \")]//tr[(th and td) or count(td) >= 1]') ?: [] as \$row) { if (!\$row instanceof DOMElement || wikiDomIsSuppressedContentNode(\$row)) continue;",
        $source
    );
    return $source;
}
