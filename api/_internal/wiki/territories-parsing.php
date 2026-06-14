<?php

declare(strict_types=1);

// Wiki HTML/wikitext parsing for political territories (infobox/template fields,
// detail extraction, table/cell readers, child-reference extraction, type inference),
// split out of territories.php (M5 god-file split). Required by territories.php;
// consts and sibling helpers resolve at call time.

function avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent(string $content): array {
    $fields = avesmapsWikiSyncReadWikiTemplateFields($content);
    $details = [];
    $childTerritoriesByKey = [];

    $fieldMap = [
        'typ' => 'type',
        'art' => 'type',
        'herrschaftsgebiet' => 'type',
        'status' => 'status',
        'herrschaftsform' => 'form_of_government',
        'hauptstadt' => 'capital_name',
        'herrschaftssitz' => 'seat_name',
        'oberhaupt' => 'ruler',
        'sprache' => 'language',
        'wahrung' => 'currency',
        'waehrung' => 'currency',
        'handelswaren' => 'trade_goods',
        'kontinent' => 'continent',
        'grundungsdatum' => 'founded_text',
        'gruendungsdatum' => 'founded_text',
        'grundung' => 'founded_text',
        'gruendung' => 'founded_text',
        'gegrundet' => 'founded_text',
        'gegruendet' => 'founded_text',
        'neugrundung' => 'founded_text',
        'neugruendung' => 'founded_text',
        'zeitraum' => 'period_text',
        'bestandszeit' => 'period_text',
        'bestehen' => 'period_text',
        'bestand' => 'period_text',
        'aufgelost' => 'dissolved_text',
        'aufgeloest' => 'dissolved_text',
        'auflosung' => 'dissolved_text',
        'aufloesung' => 'dissolved_text',
        'grunder' => 'founder',
        'gruender' => 'founder',
        'blasonierung' => 'blazon',
        'wappen' => 'coat_of_arms_url',
        'wappenlink' => 'coat_of_arms_url',
        'wappenbild' => 'coat_of_arms_url',
        'wappendatei' => 'coat_of_arms_url',
        'wappenbilddatei' => 'coat_of_arms_url',
        'wappenabbildung' => 'coat_of_arms_url',
    ];

    $childFieldKeys = [
        'provinz',
        'provinzen',
        'unterregion',
        'unterregionen',
        'untergliederung',
        'untergliederungen',
        'verwaltungseinheit',
        'verwaltungseinheiten',
        'verwaltungsgebiet',
        'verwaltungsgebiete',
        'lehen',
        'lehensgebiete',
        'grafschaft',
        'grafschaften',
        'landgrafschaft',
        'landgrafschaften',
        'markgrafschaft',
        'markgrafschaften',
        'baronie',
        'baronien',
        'freiherrschaft',
        'freiherrschaften',
        'herzogtum',
        'herzogtumer',
        'herzogtuemer',
        'furstentum',
        'fuerstentum',
        'furstentumer',
        'fuerstentuemer',
    ];

    foreach ($fields as $rawKey => $rawValue) {
        $key = avesmapsWikiSyncCreateMatchKey($rawKey);

        if (in_array($key, $childFieldKeys, true)) {
            foreach (avesmapsWikiSyncExtractPoliticalTerritoryChildReferences($rawValue) as $childReference) {
                $childKeySource = (string) ($childReference['wiki_url'] ?? $childReference['name'] ?? '');
                $childKey = avesmapsWikiSyncCreateMatchKey($childKeySource);

                if ($childKey === '') {
                    continue;
                }

                $childReference['source_field'] = (string) $rawKey;
                $childTerritoriesByKey[$childKey] = $childReference;
            }

            continue;
        }

        $targetKey = $fieldMap[$key] ?? null;
        if ($targetKey === null) {
            continue;
        }

        $value = $targetKey === 'coat_of_arms_url'
            ? avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl($rawValue)
            : avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($rawValue);
        if ($value !== '' && !isset($details[$targetKey])) {
            $details[$targetKey] = $value;
        }
    }

    if ($childTerritoriesByKey !== []) {
        $details['child_territories'] = array_values($childTerritoriesByKey);
    }

    if (
        isset($details['period_text'])
        && (string) ($details['founded_text'] ?? '') === ''
        && (string) ($details['dissolved_text'] ?? '') === ''
    ) {
        [$foundedText, $dissolvedText] = avesmapsWikiSyncSplitPoliticalPeriodText((string) $details['period_text']);
        if ($foundedText !== '') {
            $details['founded_text'] = $foundedText;
        }
        if ($dissolvedText !== '') {
            $details['dissolved_text'] = $dissolvedText;
        }
    }

    return $details;
}

function avesmapsWikiSyncSplitPoliticalPeriodText(string $periodText): array {
    $normalized = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($periodText);
    if ($normalized === '') {
        return ['', ''];
    }

    $parts = preg_split('/\s*(?:-|–|—|\bbis\b)\s*/u', $normalized) ?: [];
    if (count($parts) >= 2) {
        return [trim((string) $parts[0]), trim((string) $parts[1])];
    }

    return [$normalized, ''];
}

function avesmapsWikiSyncReadWikiTemplateFields(string $content): array {
    $fields = [];
    $currentKey = null;
    $currentValue = '';
    $lines = preg_split('/\R/u', $content) ?: [];

    foreach ($lines as $line) {
        if (preg_match('/^\|\s*([^=]+?)\s*=\s*(.*)$/u', $line, $matches) === 1) {
            if ($currentKey !== null) {
                $fields[$currentKey] = trim($currentValue);
            }

            $currentKey = trim((string) $matches[1]);
            $currentValue = trim((string) $matches[2]);
            continue;
        }

        if ($currentKey !== null) {
            if (preg_match('/^\s*\}\}/u', $line) === 1) {
                $fields[$currentKey] = trim($currentValue);
                break;
            }

            $currentValue .= "\n" . $line;
        }
    }

    if ($currentKey !== null) {
        $fields[$currentKey] = trim($currentValue);
    }

    return $fields;
}

function avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(string $value): string {
    $value = preg_replace('/<!--.*?-->/su', ' ', $value) ?? $value;
    $value = preg_replace('/<ref\b[^>]*>.*?<\/ref>/isu', ' ', $value) ?? $value;
    $value = preg_replace('/<ref\b[^\/>]*\/>/isu', ' ', $value) ?? $value;
    $value = preg_replace('/&\d{10,}\s*/u', '', $value) ?? $value;
    $value = preg_replace('/\[\[Datei:[^\]]+\]\]/iu', ' ', $value) ?? $value;
    $value = preg_replace('/\[\[File:[^\]]+\]\]/iu', ' ', $value) ?? $value;
    $value = preg_replace_callback('/\{\{Datum\|([^{}]+)\}\}/iu', static function (array $matches): string {
        return avesmapsWikiSyncFormatPoliticalTerritoryDateTemplate((string) $matches[1]);
    }, $value) ?? $value;
    $value = preg_replace('/\[\[[^|\]]+\|([^\]]+)\]\]/u', '$1', $value) ?? $value;
    $value = preg_replace('/\[\[([^\]]+)\]\]/u', '$1', $value) ?? $value;
    $value = preg_replace('/\{\{[^{}|]+\|([^{}]+)\}\}/u', '$1', $value) ?? $value;
    $value = preg_replace('/\{\{[^{}]*\}\}/u', ' ', $value) ?? $value;
    $value = str_replace(["'''", "''", '<br>', '<br/>', '<br />'], [' ', ' ', ' ', ' ', ' '], $value);
    $value = strip_tags($value);
    $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

    return trim($value, " \t\n\r\0\x0B,;");
}

function avesmapsWikiSyncFormatPoliticalTerritoryDateTemplate(string $templateBody): string {
    $parts = array_values(array_filter(array_map(
        static fn(string $part): string => trim($part),
        explode('|', $templateBody)
    ), static fn(string $part): bool => $part !== ''));

    if (count($parts) >= 4) {
        return $parts[0] . '. ' . $parts[1] . ' ' . $parts[2] . ' ' . $parts[3];
    }

    return implode(' ', $parts);
}

function avesmapsWikiSyncFetchParsedWikiHtml(string $pageTitle): string {
    $data = avesmapsWikiSyncApiRequest([
        'action' => 'parse',
        'page' => $pageTitle,
        'prop' => 'text',
        'disablelimitreport' => '1',
    ]);

    $text = $data['parse']['text'] ?? '';
    if (is_array($text)) {
        $text = (string) ($text['*'] ?? '');
    }

    if (!is_string($text) || trim($text) === '') {
        throw new RuntimeException("Wiki Aventurica hat fuer {$pageTitle} kein HTML geliefert.");
    }

    return $text;
}

function avesmapsWikiSyncParsePoliticalTerritoryRowsFromHtml(string $html): array {
    if (!class_exists(DOMDocument::class)) {
        throw new RuntimeException('Die PHP-DOM-Erweiterung fehlt fuer den Wiki-HTML-Import.');
    }

    $document = new DOMDocument();
    @$document->loadHTML('<?xml encoding="UTF-8">' . $html);
    $tables = $document->getElementsByTagName('table');
    $bestRows = [];
    $bestScore = -1;

    foreach ($tables as $table) {
        if (!$table instanceof DOMElement) {
            continue;
        }

        $parsedRows = avesmapsWikiSyncParsePoliticalTerritoryTable($table);
        if ($parsedRows === []) {
            continue;
        }

        $headers = array_keys($parsedRows[0]['raw'] ?? []);
        $score = count($parsedRows);
        if (in_array('name', $headers, true)) {
            $score += 1000;
        }
        if (in_array('art', $headers, true) || in_array('typ', $headers, true)) {
            $score += 500;
        }
        if (in_array('staat', $headers, true) || in_array('zugehorigkeit', $headers, true)) {
            $score += 500;
        }

        if ($score > $bestScore) {
            $bestScore = $score;
            $bestRows = $parsedRows;
        }
    }

    return array_map(
        static fn(array $row): array => $row['public'],
        $bestRows
    );
}

function avesmapsWikiSyncParsePoliticalTerritoryTable(DOMElement $table): array {
    $rows = [];
    $headers = [];
    $rowSpanCells = [];

    foreach ($table->getElementsByTagName('tr') as $tableRow) {
        if (!$tableRow instanceof DOMElement) {
            continue;
        }

        $directCells = avesmapsWikiSyncReadTableCells($tableRow);
        $cells = avesmapsWikiSyncReadTableGridCells($tableRow, $rowSpanCells);
        if ($cells === []) {
            continue;
        }

        $isHeaderRow = false;
        foreach ($directCells as $cell) {
            if (strtolower($cell->tagName) === 'th') {
                $isHeaderRow = true;
                break;
            }
        }

        if ($isHeaderRow || $headers === []) {
            $candidateHeaders = array_map(
                static fn(DOMElement $cell): string => avesmapsWikiSyncNormalizePoliticalHeader($cell->textContent),
                $cells
            );
            if (in_array('name', $candidateHeaders, true)) {
                $headers = $candidateHeaders;
                continue;
            }
        }

        if ($headers === [] || count($cells) < 2) {
            continue;
        }

        $raw = [];
        foreach ($cells as $index => $cell) {
            $header = $headers[$index] ?? "spalte_{$index}";
            $raw[$header] = avesmapsWikiSyncNormalizeWikiTreeText($cell->textContent);
        }

        $name = $raw['name'] ?? '';
        if ($name === '') {
            continue;
        }

        $nameCellIndex = array_search('name', $headers, true);
        if (!is_int($nameCellIndex)) {
            $nameCellIndex = 0;
        }

        $nameCell = $cells[$nameCellIndex] ?? $cells[0] ?? null;
        if (!$nameCell instanceof DOMElement) {
            continue;
        }

        $nameLink = avesmapsWikiSyncReadFirstWikiLinkMetadata($nameCell);
        $canonicalName = avesmapsWikiSyncNormalizeWikiTreeText((string) ($nameLink['title'] ?? ''));
        if ($canonicalName !== '') {
            $name = $canonicalName;
        }

        $wikiUrl = (string) ($nameLink['url'] ?? '');
        if ($wikiUrl === '' && $name !== '') {
            $wikiUrl = avesmapsWikiSyncPageUrl($name);
        }

        $rows[] = [
            'raw' => $raw,
            'public' => [
                'name' => $name,
                'type' => $raw['typ'] ?? $raw['art'] ?? '',
                'affiliation' => $raw['zugehorigkeit'] ?? $raw['staat'] ?? '',
                'status' => $raw['status'] ?? '',
                'form_of_government' => $raw['herrschaftsform'] ?? '',
                'capital_name' => $raw['hauptstadt'] ?? '',
                'seat_name' => $raw['herrschaftssitz'] ?? '',
                'ruler' => $raw['oberhaupt'] ?? '',
                'language' => $raw['sprache'] ?? '',
                'currency' => $raw['wahrung'] ?? $raw['waehrung'] ?? '',
                'trade_goods' => $raw['handelswaren'] ?? '',
                'population' => $raw['einwohnerzahl'] ?? '',
                'founded_text' => $raw['grundungsdatum'] ?? '',
                'founder' => $raw['grunder'] ?? $raw['gruender'] ?? '',
                'dissolved_text' => $raw['aufgelost'] ?? '',
                'blazon' => $raw['blasonierung'] ?? '',
                'wiki_url' => $wikiUrl,
            ],
        ];
    }

    return $rows;
}

function avesmapsWikiSyncShouldUsePoliticalTerritoryDetailValue(string $key, string $currentValue, string $candidateValue): bool {
    $current = trim($currentValue);
    $candidate = trim($candidateValue);
    if ($candidate === '') {
        return false;
    }

    if ($current === '') {
        return true;
    }

    if (avesmapsWikiSyncIsPoliticalTerritoryPlaceholderValue($current)) {
        return true;
    }

    if (in_array($key, ['founded_text', 'dissolved_text'], true)) {
        $currentHasYear = preg_match('/\d/u', $current) === 1;
        $candidateHasYear = preg_match('/\d/u', $candidate) === 1;
        if (!$currentHasYear && $candidateHasYear) {
            return true;
        }
    }

    return false;
}

function avesmapsWikiSyncIsPoliticalTerritoryPlaceholderValue(string $value): bool {
    $normalized = mb_strtolower(trim($value));
    if ($normalized === '') {
        return true;
    }

    if (in_array($normalized, ['-', '–', '—', '?', 'k.a.', 'k. a.', 'n/a', 'na', 'keine', 'unbekannt'], true)) {
        return true;
    }

    return preg_match('/^(?:nicht\s+bekannt|unbekannt|ohne\s+angabe)$/u', $normalized) === 1;
}

function avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    if (preg_match('/https?:\/\/\S+/iu', $value, $urlMatch) === 1) {
        return trim((string) $urlMatch[0]);
    }

    if (preg_match('/\[\[(?:Datei|File)\s*:\s*([^|\]#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/iu', $value, $fileMatch) === 1) {
        $fileTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) $fileMatch[1]);
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($fileTitle);
    }

    if (preg_match('/\{\{[Ii]nfoboxbild\|([^|}]+)(?:\|[^}]*)?\}\}/u', $value, $templateMatch) === 1) {
        $fileTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) $templateMatch[1]);
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($fileTitle);
    }

    $cleanedValue = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
    if (str_contains($cleanedValue, '.')) {
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl($cleanedValue);
    }

    return '';
}

function avesmapsWikiSyncPoliticalTerritoryFilePathUrl(string $fileTitle): string {
    $normalizedTitle = avesmapsWikiSyncNormalizeWikiTreeText($fileTitle);
    if ($normalizedTitle === '') {
        return '';
    }

    $normalizedTitle = preg_replace('/^(?:Datei|File)\s*:\s*/iu', '', $normalizedTitle) ?? $normalizedTitle;
    $normalizedTitle = str_replace('_', ' ', $normalizedTitle);

    return AVESMAPS_WIKI_PAGE_BASE_URL . 'Spezial:Dateipfad/' . str_replace('%2F', '/', rawurlencode($normalizedTitle));
}

function avesmapsWikiSyncExtractPoliticalTerritoryChildReferences(string $rawValue): array {
    $value = trim($rawValue);
    if ($value === '') {
        return [];
    }

    $referencesByKey = [];
    $listDefaultType = avesmapsWikiSyncInferPoliticalTerritoryTypeFromListContext($value);

    if (preg_match_all('/\[\[([^|\]#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/u', $value, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) !== false) {
        foreach ($matches as $match) {
            $fullMatch = (string) ($match[0][0] ?? '');
            $matchOffset = (int) ($match[0][1] ?? 0);
            $pageTitle = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[1][0] ?? ''));
            $displayText = avesmapsWikiSyncNormalizeWikiTreeText((string) ($match[2][0] ?? ''));

            if ($pageTitle === '' || avesmapsWikiSyncIsIgnoredPoliticalTerritoryLinkTitle($pageTitle)) {
                continue;
            }

            $nameSource = $displayText !== '' ? $displayText : $pageTitle;
            $name = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($nameSource);

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
                $contextualName = avesmapsWikiSyncBuildContextualPoliticalTerritoryName(
                    $value,
                    $matchOffset,
                    $fullMatch,
                    $name
                );

                if ($contextualName !== '') {
                    $name = $contextualName;
                }
            }

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name) && $listDefaultType !== '') {
                $typedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($listDefaultType . ' ' . $name);
                if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($typedName)) {
                    $name = $typedName;
                }
            }

            if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
                continue;
            }

            $reference = [
                'name' => $name,
                'type' => avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($name),
                'wiki_url' => avesmapsWikiSyncPageUrl($pageTitle),
                'wiki_title' => $pageTitle,
            ];

            $key = avesmapsWikiSyncCreateMatchKey((string) $reference['name']);
            if ($key === '') {
                $key = avesmapsWikiSyncCreateMatchKey((string) $reference['wiki_url']);
            }
            if ($key !== '') {
                $referencesByKey[$key] = $reference;
            }
        }
    }

    $cleanedValue = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
    $parts = preg_split('/\s*(?:,|;|·|\n|\r)\s*/u', $cleanedValue) ?: [];

    foreach ($parts as $part) {
        $name = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($part);

        if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name) && $listDefaultType !== '') {
            $typedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($listDefaultType . ' ' . $name);
            if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($typedName)) {
                $name = $typedName;
            }
        }

        if (!avesmapsWikiSyncLooksLikePoliticalTerritoryName($name)) {
            continue;
        }

        $reference = [
            'name' => $name,
            'type' => avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($name),
            'wiki_url' => avesmapsWikiSyncPageUrl($name),
            'wiki_title' => $name,
        ];

        $key = avesmapsWikiSyncCreateMatchKey((string) $reference['name']);
        if ($key === '') {
            $key = avesmapsWikiSyncCreateMatchKey((string) $reference['wiki_url']);
        }
        if ($key === '') {
            continue;
        }

        $existing = $referencesByKey[$key] ?? null;
        if (!is_array($existing)) {
            $referencesByKey[$key] = $reference;
            continue;
        }

        if (trim((string) ($existing['wiki_url'] ?? '')) === '' && trim((string) ($reference['wiki_url'] ?? '')) !== '') {
            $referencesByKey[$key] = $reference;
        }
    }

    return array_values($referencesByKey);
}

function avesmapsWikiSyncBuildContextualPoliticalTerritoryName(
    string $rawValue,
    int $matchOffset,
    string $fullMatch,
    string $linkedName
): string {
    $linkedName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($linkedName);
    if ($linkedName === '') {
        return '';
    }

    $prefixStart = max(0, $matchOffset - 80);
    $prefix = substr($rawValue, $prefixStart, $matchOffset - $prefixStart);
    $prefix = preg_replace('/.*(?:,|;|·|\n|\r)/su', '', $prefix) ?? $prefix;
    $prefix = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($prefix);

    $fullCandidate = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($prefix . ' ' . $linkedName);
    if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($fullCandidate)) {
        return $fullCandidate;
    }

    $type = avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($prefix);
    if ($type !== '') {
        return avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($type . ' ' . $linkedName);
    }

    $suffixStart = $matchOffset + strlen($fullMatch);
    $suffix = substr($rawValue, $suffixStart, 80);
    $suffix = preg_replace('/(?:,|;|·|\n|\r).*$/su', '', $suffix) ?? $suffix;
    $suffix = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($suffix);

    $suffixCandidate = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName($linkedName . ' ' . $suffix);
    if (avesmapsWikiSyncLooksLikePoliticalTerritoryName($suffixCandidate)) {
        return $suffixCandidate;
    }

    return '';
}



function avesmapsWikiSyncBuildPoliticalTerritoryChildRows(array $childReferences, array $parentRow): array {
    $parentName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($parentRow['name'] ?? ''));
    if ($parentName === '') {
        return [];
    }

    $parentKey = avesmapsWikiSyncCreateMatchKey($parentName);
    $rows = [];

    foreach ($childReferences as $childReference) {
        if (!is_array($childReference)) {
            continue;
        }

        $childName = avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName((string) ($childReference['name'] ?? ''));
        if ($childName === '') {
            continue;
        }

        $childKey = avesmapsWikiSyncCreateMatchKey($childName);
        if ($childKey === '' || $childKey === $parentKey) {
            continue;
        }

        $rows[] = [
            'name' => $childName,
            'type' => (string) ($childReference['type'] ?? avesmapsWikiSyncInferPoliticalTerritoryTypeFromName($childName)),
            'continent' => (string) ($parentRow['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT),
            'affiliation' => $parentName,
            'status' => '',
            'form_of_government' => '',
            'capital_name' => '',
            'seat_name' => '',
            'ruler' => '',
            'language' => '',
            'currency' => '',
            'trade_goods' => '',
            'population' => '',
            'founded_text' => '',
            'founder' => '',
            'dissolved_text' => '',
            'blazon' => '',
            'wiki_url' => (string) ($childReference['wiki_url'] ?? avesmapsWikiSyncPageUrl($childName)),
            'coat_of_arms_url' => '',
            'discovered_from_parent' => $parentName,
            'discovered_from_field' => (string) ($childReference['source_field'] ?? ''),
        ];
    }

    return $rows;
}

function avesmapsWikiSyncIsIgnoredPoliticalTerritoryLinkTitle(string $title): bool {
    return preg_match('/^(?:Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Vorlage|Template)\s*:/iu', $title) === 1;
}

function avesmapsWikiSyncLooksLikePoliticalTerritoryName(string $name): bool {
    if ($name === '') {
        return false;
    }

    return preg_match(
        '/\b(?:Staat|Königreich|Koenigreich|Kaiserreich|Herzogtum|Fürstentum|Fuerstentum|Grafschaft|Landgrafschaft|Markgrafschaft|Baronie|Freiherrschaft|Republik|Sultanat|Emirat|Kalifat|Mhaharanyat|Theokratie)\b/iu',
        $name
    ) === 1;
}

function avesmapsWikiSyncInferPoliticalTerritoryTypeFromName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);

    $patterns = [
        '/\bFreiherrschaft\b/iu' => 'Freiherrschaft',
        '/\bLandgrafschaft\b/iu' => 'Landgrafschaft',
        '/\bMarkgrafschaft\b/iu' => 'Markgrafschaft',
        '/\bGrafschaft\b/iu' => 'Grafschaft',
        '/\bBaronie\b/iu' => 'Baronie',
        '/\bHerzogtum\b/iu' => 'Herzogtum',
        '/\bFürstentum\b/iu' => 'Fürstentum',
        '/\bFuerstentum\b/iu' => 'Fürstentum',
        '/\bKönigreich\b/iu' => 'Königreich',
        '/\bKoenigreich\b/iu' => 'Königreich',
        '/\bKaiserreich\b/iu' => 'Kaiserreich',
        '/\bRepublik\b/iu' => 'Republik',
        '/\bSultanat\b/iu' => 'Sultanat',
        '/\bEmirat\b/iu' => 'Emirat',
        '/\bKalifat\b/iu' => 'Kalifat',
        '/\bMhaharanyat\b/iu' => 'Mhaharanyat',
    ];

    foreach ($patterns as $pattern => $type) {
        if (preg_match($pattern, $normalized) === 1) {
            return $type;
        }
    }

    return '';
}

function avesmapsWikiSyncInferPoliticalTerritoryTypeFromListContext(string $rawValue): string {
    $cleaned = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($rawValue);
    if ($cleaned === '') {
        return '';
    }

    $segments = preg_split('/\s*(?:,|;|\x{00B7}|\x{2022}|\n|\r)\s*/u', $cleaned) ?: [];
    foreach ($segments as $segment) {
        $type = avesmapsWikiSyncInferPoliticalTerritoryTypeFromName((string) $segment);
        if ($type !== '') {
            return $type;
        }
    }

    return '';
}

function avesmapsWikiSyncNormalizePoliticalTerritoryDisplayName(string $name): string {
    $normalized = avesmapsWikiSyncNormalizeWikiTreeText($name);

    if ($normalized === '') {
        return '';
    }

    $normalized = preg_replace(
        '/\s*\(\s*unabh(?:a|ae|\x{00E4})ngig\s*\)\s*$/iu',
        '',
        $normalized
    ) ?? $normalized;

    return trim($normalized);
}

function avesmapsWikiSyncReadTableCells(DOMElement $row): array {
    $cells = [];
    foreach ($row->childNodes as $child) {
        if ($child instanceof DOMElement && in_array(strtolower($child->tagName), ['th', 'td'], true)) {
            $cells[] = $child;
        }
    }

    return $cells;
}

function avesmapsWikiSyncReadTableGridCells(DOMElement $row, array &$rowSpanCells): array {
    $gridCells = [];
    $directCells = avesmapsWikiSyncReadTableCells($row);
    if ($directCells === [] && $rowSpanCells === []) {
        return [];
    }

    $columnIndex = 0;
    $consumePendingCell = static function (int $columnIndex, array &$rowSpanCells, array &$gridCells): void {
        if (!isset($rowSpanCells[$columnIndex])) {
            return;
        }

        $pending = $rowSpanCells[$columnIndex];
        if (!$pending['cell'] instanceof DOMElement) {
            unset($rowSpanCells[$columnIndex]);
            return;
        }

        $gridCells[$columnIndex] = $pending['cell'];
        $pending['rows_left']--;
        if ($pending['rows_left'] > 0) {
            $rowSpanCells[$columnIndex] = $pending;
            return;
        }

        unset($rowSpanCells[$columnIndex]);
    };

    foreach ($directCells as $cell) {
        while (isset($rowSpanCells[$columnIndex])) {
            $consumePendingCell($columnIndex, $rowSpanCells, $gridCells);
            $columnIndex++;
        }

        $colspan = avesmapsWikiSyncReadTableSpanValue($cell, 'colspan');
        $rowspan = avesmapsWikiSyncReadTableSpanValue($cell, 'rowspan');

        for ($offset = 0; $offset < $colspan; $offset++) {
            $targetColumn = $columnIndex + $offset;
            $gridCells[$targetColumn] = $cell;
            if ($rowspan > 1) {
                $rowSpanCells[$targetColumn] = [
                    'cell' => $cell,
                    'rows_left' => $rowspan - 1,
                ];
            }
        }

        $columnIndex += $colspan;
    }

    while (isset($rowSpanCells[$columnIndex])) {
        $consumePendingCell($columnIndex, $rowSpanCells, $gridCells);
        $columnIndex++;
    }

    if ($gridCells === []) {
        return [];
    }

    ksort($gridCells);
    return array_values($gridCells);
}

function avesmapsWikiSyncReadTableSpanValue(DOMElement $cell, string $attribute): int {
    $rawValue = trim((string) $cell->getAttribute($attribute));
    if ($rawValue === '') {
        return 1;
    }

    $value = filter_var($rawValue, FILTER_VALIDATE_INT);
    if ($value === false || $value < 1) {
        return 1;
    }

    return (int) $value;
}

function avesmapsWikiSyncNormalizePoliticalHeader(string $header): string {
    $normalized = avesmapsWikiSyncCreateMatchKey(avesmapsWikiSyncNormalizeWikiTreeText($header));
    return match ($normalized) {
        'name', 'staat', 'status', 'herrschaftsform', 'hauptstadt', 'herrschaftssitz', 'oberhaupt', 'sprache', 'handelswaren', 'einwohnerzahl', 'kontinent', 'blasonierung' => $normalized,
        'art' => 'art',
        'typ', 'herrschaftsgebiet' => 'typ',
        'wahrung', 'waehrung' => 'wahrung',
        'grunder', 'gruender' => 'grunder',
        'zugehorigkeit', 'zugehoerigkeit' => 'zugehorigkeit',
        'grundungsdatum', 'gruendungsdatum', 'grundung', 'gruendung', 'gegrundet', 'gegruendet', 'neugrundung', 'neugruendung' => 'grundungsdatum',
        'aufgelost', 'aufgeloest', 'auflosung', 'aufloesung' => 'aufgelost',
        default => $normalized,
    };
}

function avesmapsWikiSyncReadFirstWikiLink(DOMElement $cell): string {
    return (string) (avesmapsWikiSyncReadFirstWikiLinkMetadata($cell)['url'] ?? '');
}

function avesmapsWikiSyncReadFirstWikiLinkMetadata(DOMElement $cell): array {
    foreach ($cell->getElementsByTagName('a') as $link) {
        if (!$link instanceof DOMElement) {
            continue;
        }

        $href = trim((string) $link->getAttribute('href'));
        if ($href === '' || str_starts_with($href, '#')) {
            continue;
        }

        if (str_starts_with($href, '/wiki/')) {
            $title = avesmapsWikiSyncNormalizeWikiTreeText((string) $link->getAttribute('title'));
            if ($title === '') {
                $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl('https://de.wiki-aventurica.de' . $href);
            }

            return [
                'url' => 'https://de.wiki-aventurica.de' . $href,
                'title' => $title,
            ];
        }

        if (preg_match('/^https?:\/\//i', $href) === 1) {
            $title = avesmapsWikiSyncNormalizeWikiTreeText((string) $link->getAttribute('title'));
            if ($title === '') {
                $title = avesmapsWikiSyncPoliticalTerritoryTitleFromUrl($href);
            }

            return [
                'url' => $href,
                'title' => $title,
            ];
        }
    }

    return [];
}

function avesmapsWikiSyncFetchPoliticalTerritoryPathReferenceRows(array $rows, array $rowIndex): array {
    $titlesByKey = [];
    foreach ($rows as $row) {
        foreach (avesmapsWikiSyncReadPoliticalTerritoryPath($row) as $part) {
            $key = avesmapsWikiSyncMakePoliticalTreeKey($part);
            if ($key === '' || isset($rowIndex[$key])) {
                continue;
            }

            $titlesByKey[$key] = $part;
        }
    }

    if ($titlesByKey === []) {
        return [];
    }

    try {
        $contentsByTitle = avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_values($titlesByKey));
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('political_territory_path_reference_error', [
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
        ]);

        return [];
    }

    $referenceRows = [];
    foreach ($titlesByKey as $title) {
        $content = $contentsByTitle[$title] ?? '';
        if ($content === '') {
            continue;
        }

        $details = avesmapsWikiSyncParsePoliticalTerritoryDetailsFromContent($content);
        if (!avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails($details)) {
            continue;
        }

        $referenceRows[] = [
            'name' => $title,
            'type' => (string) ($details['type'] ?? ''),
            'affiliation' => '',
            'status' => (string) ($details['status'] ?? ''),
            'form_of_government' => (string) ($details['form_of_government'] ?? ''),
            'capital_name' => (string) ($details['capital_name'] ?? ''),
            'seat_name' => (string) ($details['seat_name'] ?? ''),
            'ruler' => (string) ($details['ruler'] ?? ''),
            'language' => (string) ($details['language'] ?? ''),
            'currency' => (string) ($details['currency'] ?? ''),
            'trade_goods' => (string) ($details['trade_goods'] ?? ''),
            'population' => '',
            'founded_text' => (string) ($details['founded_text'] ?? ''),
            'founder' => (string) ($details['founder'] ?? ''),
            'dissolved_text' => (string) ($details['dissolved_text'] ?? ''),
            'blazon' => (string) ($details['blazon'] ?? ''),
            'wiki_url' => avesmapsWikiSyncPageUrl($title),
        ];
    }

    return $referenceRows;
}

function avesmapsWikiSyncHasPoliticalTerritoryDisplayDetails(array $details): bool {
    foreach (['type', 'status', 'capital_name', 'seat_name', 'ruler', 'founded_text', 'dissolved_text'] as $key) {
        if ((string) ($details[$key] ?? '') !== '') {
            return true;
        }
    }

    return false;
}

function avesmapsWikiSyncIsIndependentPoliticalTerritoryPath(array $path): bool {
    if ($path === []) {
        return false;
    }

    $firstPart = avesmapsWikiSyncNormalizeWikiTreeText((string) $path[0]);

    return preg_match('/^unabh(?:a|ae|\x{00E4})ngig\b/iu', $firstPart) === 1;
}
