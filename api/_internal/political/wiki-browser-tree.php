<?php

declare(strict_types=1);

function sanitizeTerritoryItemsForTree(array $items): array {
    return array_map(static function (array $item): array {
        $name = value($item['name'] ?? null);
        $type = value($item['type'] ?? null);

        if (isRootTerritoryItem($name, $type)) {
            $item['affiliation_raw'] = null;
            $item['affiliation_key'] = null;
            $item['affiliation_root'] = null;
            $item['affiliation_path'] = [];
            if (is_array($item['affiliation'] ?? null)) {
                $item['affiliation']['root'] = '';
                $item['affiliation']['path'] = [];
            }
            return $item;
        }

        $path = is_array($item['affiliation_path'] ?? null)
            ? $item['affiliation_path']
            : [];
        $path = sanitizeAffiliationPathForTree($path);

        $item['affiliation_path'] = $path;
        $item['affiliation_root'] = $path[0] ?? null;
        $item['affiliation_key'] = isset($path[0]) ? makeStableKey($path[0]) : null;

        if (is_array($item['affiliation'] ?? null)) {
            $item['affiliation']['root'] = $path[0] ?? '';
            $item['affiliation']['path'] = $path;
        }

        return $item;
    }, $items);
}

function sanitizeAffiliationPathForTree(array $path): array {
    $sanitized = [];
    $seen = [];

    foreach ($path as $part) {
        $part = value($part);
        if ($part === '' || isInvalidSyntheticPathPart($part)) {
            continue;
        }

        $key = makeStableKey($part);
        if ($key === '' || isset($seen[$key])) {
            continue;
        }

        $seen[$key] = true;
        $sanitized[] = $part;
    }

    return $sanitized;
}

function isInvalidSyntheticPathPart(string $part): bool {
    $part = value($part);
    if ($part === '') {
        return true;
    }

    if (preg_match('/^(?:\d{1,5}\s*(?:v\.\s*)?(?:BF|IZ)|\d{1,5})$/iu', $part) === 1) {
        return true;
    }

    $key = makeStableKey($part);
    $invalidKeys = [
        'aristrokatie',
        'aristokratie',
        'magokratie',
        'geldaristrokratie',
        'geldaristokratie',
        'boronkratie',
        'plutokratie',
        'feudalherrschaft',
        'matriachat',
        'matriarchat',
        'militarherrschaft',
        'militaerherrschaft',
        'oligarchie',
        'theokratie',
        'rondrakratie',
        'desoptie',
        'despotie',
    ];

    return in_array($key, $invalidKeys, true);
}

function territoryItemToLegacyRow(array $item): array {
    $affiliationPath = is_array($item['affiliation_path'] ?? null)
        ? array_values(array_filter(array_map('value', $item['affiliation_path']), static fn(string $part): bool => $part !== ''))
        : [];

    $affiliation = is_array($item['affiliation'] ?? null)
        ? $item['affiliation']
        : [
            'key' => value($item['affiliation_key'] ?? null),
            'root' => value($item['affiliation_root'] ?? null),
            'path' => $affiliationPath,
            'original' => value($item['affiliation_raw'] ?? null),
        ];

    if (is_array($affiliation)) {
        $affiliation['root'] = $affiliationPath[0] ?? '';
        $affiliation['path'] = $affiliationPath;
    }

    $founded = is_array($item['founded'] ?? null) ? $item['founded'] : null;
    $dissolved = is_array($item['dissolved'] ?? null) ? $item['dissolved'] : null;

    return [
        'Wappen' => '',
        'Name' => value($item['name'] ?? null),
        'Typ' => value($item['type'] ?? null),
        'Kontinent' => value($item['continent'] ?? null),
        'Zugehörigkeit' => value($item['affiliation_raw'] ?? null),
        'Zugehörigkeit-Key' => value($item['affiliation_key'] ?? null),
        'Zugehörigkeit-Root' => value($item['affiliation_root'] ?? null),
        'Zugehörigkeit-Pfad' => implode(' > ', $affiliationPath),
        'Zugehörigkeit-JSON' => encodeJson($affiliation),
        'Status' => value($item['status'] ?? null),
        'Herrschaftsform' => value($item['form_of_government'] ?? null),
        'Hauptstadt' => value($item['capital_name'] ?? null),
        'Herrschaftssitz' => value($item['seat_name'] ?? null),
        'Oberhaupt' => value($item['ruler'] ?? null),
        'Sprache' => value($item['language'] ?? null),
        'Währung' => value($item['currency'] ?? null),
        'Handelswaren' => value($item['trade_goods'] ?? null),
        'Einwohnerzahl' => value($item['population'] ?? null),
        'Gründungsdatum' => value($item['founded_text'] ?? null),
        'Gründungsdatum-Text' => value($item['founded_text'] ?? null),
        'Gründungsdatum-Typ' => value($item['founded_type'] ?? null),
        'Gründungsdatum-StartBF' => value($item['founded_start_bf'] ?? null),
        'Gründungsdatum-EndBF' => value($item['founded_end_bf'] ?? null),
        'Gründungsdatum-AnzeigeBF' => value($item['founded_display_bf'] ?? null),
        'Gründungsdatum-JSON' => encodeJson($founded),
        'Gründer' => value($item['founder'] ?? null),
        'Aufgelöst' => value($item['dissolved_text'] ?? null),
        'Aufgelöst-Text' => value($item['dissolved_text'] ?? null),
        'Aufgelöst-Typ' => value($item['dissolved_type'] ?? null),
        'Aufgelöst-StartBF' => value($item['dissolved_start_bf'] ?? null),
        'Aufgelöst-EndBF' => value($item['dissolved_end_bf'] ?? null),
        'Aufgelöst-AnzeigeBF' => value($item['dissolved_display_bf'] ?? null),
        'Aufgelöst-JSON' => encodeJson($dissolved),
        'Geographisch' => value($item['geographic'] ?? null),
        'Politisch' => value($item['political'] ?? null),
        'Handelszone' => value($item['trade_zone'] ?? null),
        'Blasonierung' => value($item['blazon'] ?? null),
        'Wiki-Link' => value($item['wiki_url'] ?? null),
        'Wappen-Link' => value($item['coat_of_arms_url'] ?? null),

        '_id' => value($item['id'] ?? null),
        '_wiki_key' => value($item['wiki_key'] ?? null),
        '_wiki_url' => value($item['wiki_url'] ?? null),
        '_canonical_key' => canonicalItemKey($item),
        '_map_assigned' => !empty($item['map_assigned']),
        '_map_territory_count' => (int)($item['map_territory_count'] ?? 0),
        '_map_geometry_count' => (int)($item['map_geometry_count'] ?? 0),
    ];
}

function buildLegacyTree(array $rows): array {
    $root = createTreeNode('__root__', '', null);
    $rowIndex = buildRowIndex($rows);
    $insertedRowKeys = [];

    foreach ($rows as $index => $row) {
        $path = readLegacyPath($row);
        $path = array_values(array_filter(array_map(
            static fn(string $part): string => canonicalPathPart($part),
            $path
        ), static fn(string $part): bool => $part !== ''));

        $rowIdentityKey = canonicalRowKey($row);
        if ($rowIdentityKey === '') {
            $rowIdentityKey = 'row-' . ($index + 1);
        }

        $ownName = value($row['Name'] ?? null);
        if ($ownName === '') {
            $ownName = 'unbenannt';
        }

        $ownNodeKey = legacyNodeKey($ownName);
        if ($ownNodeKey === '') {
            $ownNodeKey = 'gebiet-' . ($index + 1);
        }

        $current =& $root;

        foreach ($path as $part) {
            $partKey = legacyNodeKey($part);
            if ($partKey === '') {
                continue;
            }

            if (!isset($current['children'][$partKey])) {
                $indexedRow = $rowIndex[$partKey] ?? null;
                $current['children'][$partKey] = createTreeNode($partKey, $part, $indexedRow);

                if ($indexedRow !== null) {
                    $indexedIdentityKey = canonicalRowKey($indexedRow);
                    if ($indexedIdentityKey !== '') {
                        $insertedRowKeys[$indexedIdentityKey] = true;
                    }
                }
            } elseif (empty($current['children'][$partKey]['row'])) {
                $indexedRow = $rowIndex[$partKey] ?? null;

                if ($indexedRow !== null) {
                    $current['children'][$partKey] = applyLegacyRowToTreeNode(
                        $current['children'][$partKey],
                        $indexedRow
                    );

                    $indexedIdentityKey = canonicalRowKey($indexedRow);
                    if ($indexedIdentityKey !== '') {
                        $insertedRowKeys[$indexedIdentityKey] = true;
                    }
                }
            }

            $current =& $current['children'][$partKey];
        }

        $currentRowIdentityKey = !empty($current['row']) && is_array($current['row'])
            ? canonicalRowKey($current['row'])
            : '';

        if ($currentRowIdentityKey !== '' && $currentRowIdentityKey === $rowIdentityKey) {
            $insertedRowKeys[$rowIdentityKey] = true;
            unset($current);
            continue;
        }

        if (isset($insertedRowKeys[$rowIdentityKey])) {
            unset($current);
            continue;
        }

        if (!isset($current['children'][$ownNodeKey])) {
            $current['children'][$ownNodeKey] = createTreeNode($ownNodeKey, $ownName, $row);
        } elseif (empty($current['children'][$ownNodeKey]['row'])) {
            $current['children'][$ownNodeKey] = applyLegacyRowToTreeNode($current['children'][$ownNodeKey], $row);
        }

        $insertedRowKeys[$rowIdentityKey] = true;
        unset($current);
    }

    return flattenTree($root['children']);
}

function buildRowIndex(array $rows): array {
    $index = [];

    foreach ($rows as $row) {
        foreach (legacyRowAliases($row) as $alias) {
            $key = legacyNodeKey($alias);

            if ($key !== '' && !isset($index[$key])) {
                $index[$key] = $row;
            }
        }
    }

    return $index;
}

function legacyRowAliases(array $row): array {
    $name = value($row['Name'] ?? null);
    $aliases = [];

    if ($name !== '') {
        $aliases[] = $name;

        $withoutParenthesis = stripLegacyParentheticalSuffix($name);
        if ($withoutParenthesis !== '') {
            $aliases[] = $withoutParenthesis;
        }
    }

    $wikiUrl = value($row['Wiki-Link'] ?? null);
    if ($wikiUrl !== '') {
        $title = wikiTitleFromUrl($wikiUrl);
        if ($title !== '') {
            $aliases[] = $title;

            $withoutParenthesis = stripLegacyParentheticalSuffix($title);
            if ($withoutParenthesis !== '') {
                $aliases[] = $withoutParenthesis;
            }
        }
    }

    $aliasMap = [
        'Wiedererstandenes Reich des Horas' => [
            'Horasreich',
        ],
        'Heiliges Neues Kaiserreich vom Greifenthron zu Gareth' => [
            'Mittelreich',
        ],
        'Theaterritterliche Republik an Born und Walsach' => [
            'Bornland',
        ],
        'Thorwal (Staat)' => [
            'Thorwal',
        ],
        'Könikreisch des Nortens' => [
            'Orkreich',
        ],
        'Fürstkomturei Maraskan' => [
            'Fürstkomturei Tobimora',
        ],
    ];

    foreach (($aliasMap[$name] ?? []) as $alias) {
        $aliases[] = $alias;
    }

    return array_values(array_unique(array_filter($aliases, static fn(string $alias): bool => trim($alias) !== '')));
}

function readLegacyPath(array $row): array {
    $rawPath = value($row['Zugehörigkeit-Pfad'] ?? null);
    if ($rawPath !== '') {
        return array_values(array_filter(array_map(
            static fn(string $part): string => trim($part),
            preg_split('/\s*>\s*/u', $rawPath) ?: []
        ), static fn(string $part): bool => $part !== ''));
    }

    $json = decodeJson($row['Zugehörigkeit-JSON'] ?? null, []);
    if (is_array($json) && isset($json['path']) && is_array($json['path'])) {
        return array_values(array_filter(array_map(
            static fn(mixed $part): string => trim((string)$part),
            $json['path']
        ), static fn(string $part): bool => $part !== ''));
    }

    $fallback = value($row['Zugehörigkeit'] ?? null);
    if ($fallback === '') {
        return [];
    }

    return [$fallback];
}

function canonicalPathPart(string $part): string {
    $value = value($part);
    if ($value === '' || isInvalidSyntheticPathPart($value)) {
        return '';
    }

    $key = legacyNodeKey($value);

    $aliases = [
        'unbekannt' => '',
        'ungeklaert' => '',
        'ungeklart' => '',
        'keine' => '',
        'n-a' => '',
        'na' => '',
        'horasreich-ehemals-koenigreich-drol' => 'Horasreich',
        'koenigreich-andergast-ehemals-unabhaengig' => 'Königreich Andergast',
        'konikreisch-des-nortens-orkreich' => 'Orkreich',
        'orkreich-svelltscher-stadtebund' => 'Orkreich',
        'gebiet-beansprucht-von' => 'umstritten',
        'gebiet-benasprucht-von' => 'umstritten',
        'unter-der-herrschaft-des-ritterbund-orkenwacht' => 'Ritterbund Orkenwacht',
    ];

    return $aliases[$key] ?? $value;
}

function createTreeNode(string $key, string $name, ?array $row): array {
    $node = [
        'key_raw' => $key,
        'key' => 'wiki:' . $key,
        'public_id' => 'wiki:' . $key,
        'name' => $name,
        'type' => '',
        'status' => '',
        'valid_label' => '',
        'wiki_url' => '',
        'capital_name' => '',
        'ruler' => '',
        'coat_of_arms_url' => '',
        'map_assigned' => false,
        'map_territory_count' => 0,
        'map_geometry_count' => 0,
        'is_group' => $row === null,
        'row' => null,
        'children' => [],
    ];

    if ($row !== null) {
        $node = applyLegacyRowToTreeNode($node, $row);
    }

    return $node;
}

function applyLegacyRowToTreeNode(array $node, array $row): array {
    $name = value($row['Name'] ?? null);

    $node['row'] = $row;
    $node['is_group'] = false;

    if ($name !== '') {
        $node['name'] = $name;
    }

    $node['type'] = value($row['Typ'] ?? null);
    $node['status'] = value($row['Status'] ?? null);
    $node['valid_label'] = formatExistenceLabel($row);
    $node['wiki_url'] = value($row['Wiki-Link'] ?? null);
    $node['capital_name'] = value($row['Hauptstadt'] ?? null);
    $node['ruler'] = value($row['Oberhaupt'] ?? null);
    $node['coat_of_arms_url'] = value($row['Wappen-Link'] ?? null);
    $node['map_assigned'] = !empty($row['_map_assigned']);
    $node['map_territory_count'] = (int)($row['_map_territory_count'] ?? 0);
    $node['map_geometry_count'] = (int)($row['_map_geometry_count'] ?? 0);

    return $node;
}

function flattenTree(array $children): array {
    uasort($children, function (array $left, array $right): int {
        $leftHasRow = empty($left['row']) ? 0 : 1;
        $rightHasRow = empty($right['row']) ? 0 : 1;

        if ($leftHasRow !== $rightHasRow) {
            return $leftHasRow <=> $rightHasRow;
        }

        return strnatcasecmp((string)$left['name'], (string)$right['name']);
    });

    $out = [];

    foreach ($children as $child) {
        $child['children'] = flattenTree($child['children']);
        $child['is_group'] = $child['is_group'] || count($child['children']) > 0;

        unset($child['row'], $child['key_raw']);

        $out[] = $child;
    }

    return $out;
}

function canonicalRowKey(array $row): string {
    $wikiKey = value($row['_wiki_key'] ?? null);
    if ($wikiKey !== '') {
        return makeStableKey($wikiKey);
    }

    $wikiUrl = value($row['_wiki_url'] ?? $row['Wiki-Link'] ?? null);
    if ($wikiUrl !== '') {
        return makeStableKey($wikiUrl);
    }

    $name = value($row['Name'] ?? null);
    if ($name !== '') {
        return makeStableKey($name);
    }

    return '';
}

function canonicalItemKey(array $item): string {
    $wikiKey = value($item['wiki_key'] ?? null);
    if ($wikiKey !== '') {
        return makeStableKey($wikiKey);
    }

    $wikiUrl = value($item['wiki_url'] ?? null);
    if ($wikiUrl !== '') {
        return makeStableKey($wikiUrl);
    }

    return makeStableKey(value($item['name'] ?? null));
}

function legacyNodeKey(string $value): string {
    $value = stripLegacyParentheticalSuffix($value);

    return makeStableKey($value);
}

function stripLegacyParentheticalSuffix(string $value): string {
    $normalizedValue = trim($value);
    if ($normalizedValue === '') {
        return '';
    }

    return $normalizedValue;
}

function formatExistenceLabel(array $row): string {
    $founded = value($row['Gründungsdatum-Text'] ?? $row['Gründungsdatum'] ?? null);
    $dissolved = value($row['Aufgelöst-Text'] ?? $row['Aufgelöst'] ?? null);

    if ($founded !== '' && $dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1
            ? 'besteht seit ' . $founded
            : $founded . ' - ' . $dissolved;
    }

    if ($founded !== '') {
        return 'seit ' . $founded;
    }

    if ($dissolved !== '') {
        return preg_match('/\bbesteht\b/iu', $dissolved) === 1
            ? 'besteht'
            : 'bis ' . $dissolved;
    }

    return '';
}
