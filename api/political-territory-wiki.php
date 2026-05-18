<?php

declare(strict_types=1);

$configPath = __DIR__ . '/config.local.php';

if (!is_file($configPath)) {
    respondJson(['ok' => false, 'error' => 'config.local.php fehlt.'], 500);
}

$config = require $configPath;

if (!is_array($config) || !isset($config['database']) || !is_array($config['database'])) {
    respondJson(['ok' => false, 'error' => 'config.local.php liefert keine gültige database-Konfiguration.'], 500);
}

applyCors($config['cors']['allowed_origins'] ?? []);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respondJson(['ok' => false, 'error' => 'Nur GET ist erlaubt.'], 405);
}

try {
    $db = $config['database'];
    $driver = (string)($db['driver'] ?? 'mysql');

    if ($driver !== 'mysql') {
        throw new RuntimeException('Nur MySQL wird unterstützt.');
    }

    $host = (string)($db['host'] ?? 'localhost');
    $port = (int)($db['port'] ?? 3306);
    $name = (string)($db['name'] ?? '');
    $charset = (string)($db['charset'] ?? 'utf8mb4');
    $user = (string)($db['user'] ?? '');
    $password = (string)($db['password'] ?? '');

    if ($name === '') {
        throw new RuntimeException('Datenbankname fehlt.');
    }

    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $host, $port, $name, $charset);

    $pdo = new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $params = [];
    $where = [];

    $search = trim((string)($_GET['q'] ?? ''));
    if ($search !== '') {
        $where[] = '(name LIKE :q OR type LIKE :q OR affiliation_raw LIKE :q OR affiliation_root LIKE :q OR status LIKE :q OR capital_name LIKE :q OR seat_name LIKE :q OR ruler LIKE :q)';
        $params[':q'] = '%' . $search . '%';
    }

    $continent = trim((string)($_GET['continent'] ?? ''));
    if ($continent !== '') {
        $where[] = 'continent = :continent';
        $params[':continent'] = $continent;
    }

    $type = trim((string)($_GET['type'] ?? ''));
    if ($type !== '') {
        $where[] = 'type = :type';
        $params[':type'] = $type;
    }

    $status = trim((string)($_GET['status'] ?? ''));
    if ($status !== '') {
        $where[] = 'status = :status';
        $params[':status'] = $status;
    }

    $sql = 'SELECT
            id,
            wiki_key,
            name,
            type,
            continent,
            affiliation_raw,
            affiliation_key,
            affiliation_root,
            affiliation_path_json,
            affiliation_json,
            status,
            form_of_government,
            capital_name,
            seat_name,
            ruler,
            language,
            currency,
            trade_goods,
            population,
            founded_text,
            founded_type,
            founded_start_bf,
            founded_end_bf,
            founded_display_bf,
            founded_json,
            founder,
            dissolved_text,
            dissolved_type,
            dissolved_start_bf,
            dissolved_end_bf,
            dissolved_display_bf,
            dissolved_json,
            geographic,
            political,
            trade_zone,
            blazon,
            wiki_url,
            coat_of_arms_url,
            (
                SELECT COUNT(DISTINCT territory.id)
                FROM political_territory territory
                INNER JOIN political_territory_geometry geometry
                    ON geometry.territory_id = territory.id
                    AND geometry.is_active = 1
                WHERE territory.wiki_id = political_territory_wiki.id
                    AND territory.is_active = 1
            ) AS map_territory_count,
            (
                SELECT COUNT(geometry.id)
                FROM political_territory territory
                INNER JOIN political_territory_geometry geometry
                    ON geometry.territory_id = territory.id
                    AND geometry.is_active = 1
                WHERE territory.wiki_id = political_territory_wiki.id
                    AND territory.is_active = 1
            ) AS map_geometry_count,
            raw_json,
            synced_at
        FROM political_territory_wiki';

    if (count($where) > 0) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }

    $sql .= ' ORDER BY COALESCE(affiliation_root, affiliation_key, name), name';

    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 0;
    if ($limit > 0) {
        $limit = max(1, min($limit, 2000));
        $sql .= ' LIMIT ' . $limit;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $items = [];
    while ($row = $stmt->fetch()) {
        $items[] = normalizeTerritoryRow($row);
    }
    $items = dedupeTerritoryItems($items);

    $rows = array_map('territoryItemToLegacyRow', $items);
    $hierarchy = buildLegacyTree($rows);

    respondJson([
        'ok' => true,
        'count' => count($items),
        'generated_at' => gmdate('c'),
        'items' => $items,
        'rows' => $rows,
        'hierarchy' => $hierarchy,
    ]);
} catch (Throwable $error) {
    respondJson([
        'ok' => false,
        'error' => $error->getMessage(),
    ], 500);
}

function normalizeTerritoryRow(array $row): array {
    $affiliationPath = decodeJson($row['affiliation_path_json'] ?? null, []);
    $affiliation = decodeJson($row['affiliation_json'] ?? null, null);
    $founded = decodeJson($row['founded_json'] ?? null, null);
    $dissolved = decodeJson($row['dissolved_json'] ?? null, null);
    $raw = decodeJson($row['raw_json'] ?? null, null);

    return [
        'id' => intOrNull($row['id'] ?? null),
        'wiki_key' => stringOrNull($row['wiki_key'] ?? null),
        'name' => stringOrNull($row['name'] ?? null),
        'type' => stringOrNull($row['type'] ?? null),
        'continent' => stringOrNull($row['continent'] ?? null),
        'affiliation_raw' => stringOrNull($row['affiliation_raw'] ?? null),
        'affiliation_key' => stringOrNull($row['affiliation_key'] ?? null),
        'affiliation_root' => stringOrNull($row['affiliation_root'] ?? null),
        'affiliation_path' => is_array($affiliationPath) ? array_values($affiliationPath) : [],
        'affiliation' => is_array($affiliation) ? $affiliation : null,
        'status' => stringOrNull($row['status'] ?? null),
        'form_of_government' => stringOrNull($row['form_of_government'] ?? null),
        'capital_name' => stringOrNull($row['capital_name'] ?? null),
        'seat_name' => stringOrNull($row['seat_name'] ?? null),
        'ruler' => stringOrNull($row['ruler'] ?? null),
        'language' => stringOrNull($row['language'] ?? null),
        'currency' => stringOrNull($row['currency'] ?? null),
        'trade_goods' => stringOrNull($row['trade_goods'] ?? null),
        'population' => stringOrNull($row['population'] ?? null),
        'founded_text' => stringOrNull($row['founded_text'] ?? null),
        'founded_type' => stringOrNull($row['founded_type'] ?? null),
        'founded_start_bf' => intOrNull($row['founded_start_bf'] ?? null),
        'founded_end_bf' => intOrNull($row['founded_end_bf'] ?? null),
        'founded_display_bf' => floatOrNull($row['founded_display_bf'] ?? null),
        'founded' => is_array($founded) ? $founded : null,
        'founder' => stringOrNull($row['founder'] ?? null),
        'dissolved_text' => stringOrNull($row['dissolved_text'] ?? null),
        'dissolved_type' => stringOrNull($row['dissolved_type'] ?? null),
        'dissolved_start_bf' => intOrNull($row['dissolved_start_bf'] ?? null),
        'dissolved_end_bf' => intOrNull($row['dissolved_end_bf'] ?? null),
        'dissolved_display_bf' => floatOrNull($row['dissolved_display_bf'] ?? null),
        'dissolved' => is_array($dissolved) ? $dissolved : null,
        'geographic' => stringOrNull($row['geographic'] ?? null),
        'political' => stringOrNull($row['political'] ?? null),
        'trade_zone' => stringOrNull($row['trade_zone'] ?? null),
        'blazon' => stringOrNull($row['blazon'] ?? null),
        'wiki_url' => stringOrNull($row['wiki_url'] ?? null),
        'coat_of_arms_url' => stringOrNull($row['coat_of_arms_url'] ?? null),
        'map_assigned' => (int)($row['map_geometry_count'] ?? 0) > 0,
        'map_territory_count' => intOrNull($row['map_territory_count'] ?? null) ?? 0,
        'map_geometry_count' => intOrNull($row['map_geometry_count'] ?? null) ?? 0,
        'raw' => is_array($raw) ? $raw : null,
        'synced_at' => stringOrNull($row['synced_at'] ?? null),
    ];
}

function dedupeTerritoryItems(array $items): array {
    $dedupedByKey = [];
    $order = [];

    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            continue;
        }

        $key = territoryItemDedupeKey($item);
        if ($key === '') {
            $key = '__row__' . $index;
        }

        if (!isset($dedupedByKey[$key])) {
            $dedupedByKey[$key] = $item;
            $order[] = $key;
            continue;
        }

        $dedupedByKey[$key] = mergeTerritoryItems($dedupedByKey[$key], $item);
    }

    $deduped = [];
    foreach ($order as $key) {
        if (!isset($dedupedByKey[$key]) || !is_array($dedupedByKey[$key])) {
            continue;
        }
        $deduped[] = $dedupedByKey[$key];
    }

    return $deduped;
}

function territoryItemDedupeKey(array $item): string {
    $wikiKey = value($item['wiki_key'] ?? null);
    if ($wikiKey !== '') {
        return 'wiki_key|' . makeStableKey($wikiKey);
    }

    $wikiUrl = value($item['wiki_url'] ?? null);
    if ($wikiUrl !== '') {
        $wikiTitle = wikiTitleFromUrl($wikiUrl);
        $name = value($item['name'] ?? null);
        $type = value($item['type'] ?? null);
        if ($wikiTitle !== '') {
            return 'wiki_title_name|' . makeStableKey($wikiTitle) . '|' . makeStableKey($name) . '|' . makeStableKey($type);
        }

        return 'wiki_url_name|' . makeStableKey($wikiUrl) . '|' . makeStableKey($name) . '|' . makeStableKey($type);
    }

    return '';
}

function mergeTerritoryItems(array $left, array $right): array {
    $primary = $left;
    $secondary = $right;

    if (territoryItemMergeScore($secondary) > territoryItemMergeScore($primary)) {
        $primary = $right;
        $secondary = $left;
    }

    $merged = $primary;
    $preferredFields = [
        'wiki_key',
        'name',
        'type',
        'continent',
        'affiliation_raw',
        'affiliation_key',
        'affiliation_root',
        'status',
        'form_of_government',
        'capital_name',
        'seat_name',
        'ruler',
        'language',
        'currency',
        'trade_goods',
        'population',
        'founded_text',
        'founded_type',
        'founder',
        'dissolved_text',
        'dissolved_type',
        'geographic',
        'political',
        'trade_zone',
        'blazon',
        'wiki_url',
        'coat_of_arms_url',
        'synced_at',
    ];

    foreach ($preferredFields as $field) {
        $currentValue = value($merged[$field] ?? null);
        $fallbackValue = value($secondary[$field] ?? null);
        if ($currentValue === '' && $fallbackValue !== '') {
            $merged[$field] = $fallbackValue;
        }
    }

    foreach (['id', 'founded_start_bf', 'founded_end_bf', 'dissolved_start_bf', 'dissolved_end_bf'] as $field) {
        if (($merged[$field] ?? null) === null && ($secondary[$field] ?? null) !== null) {
            $merged[$field] = $secondary[$field];
        }
    }

    foreach (['founded_display_bf', 'dissolved_display_bf'] as $field) {
        if (($merged[$field] ?? null) === null && ($secondary[$field] ?? null) !== null) {
            $merged[$field] = $secondary[$field];
        }
    }

    foreach (['affiliation_path', 'affiliation', 'founded', 'dissolved', 'raw'] as $field) {
        $current = $merged[$field] ?? null;
        $fallback = $secondary[$field] ?? null;

        if (empty($current) && !empty($fallback)) {
            $merged[$field] = $fallback;
        }
    }

    $merged['map_territory_count'] = max(
        (int) ($left['map_territory_count'] ?? 0),
        (int) ($right['map_territory_count'] ?? 0)
    );
    $merged['map_geometry_count'] = max(
        (int) ($left['map_geometry_count'] ?? 0),
        (int) ($right['map_geometry_count'] ?? 0)
    );
    $merged['map_assigned'] = $merged['map_geometry_count'] > 0;

    return $merged;
}

function territoryItemMergeScore(array $item): int {
    $score = 0;
    $score += max(0, (int) ($item['map_geometry_count'] ?? 0)) * 100;
    $score += max(0, (int) ($item['map_territory_count'] ?? 0)) * 20;

    $fields = [
        'wiki_url',
        'coat_of_arms_url',
        'founded_text',
        'dissolved_text',
        'type',
        'status',
        'affiliation_raw',
        'capital_name',
        'seat_name',
        'ruler',
        'language',
        'currency',
        'trade_goods',
        'population',
    ];

    foreach ($fields as $field) {
        if (value($item[$field] ?? null) !== '') {
            $score++;
        }
    }

    if (!empty($item['affiliation_path']) && is_array($item['affiliation_path'])) {
        $score += count($item['affiliation_path']);
    }

    return $score;
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
    if ($value === '') {
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

    if (preg_match('/\(\s*historisch\s*\)\s*$/iu', $normalizedValue) === 1) {
        return $normalizedValue;
    }

    return trim(preg_replace('/\s*\([^)]*\)\s*$/u', '', $normalizedValue) ?? $normalizedValue);
}

function makeStableKey(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    $value = mb_strtolower($value, 'UTF-8');
    $value = str_replace(['ä', 'ö', 'ü', 'ß', 'æ', 'œ', 'ø', 'ð', 'þ'], ['ae', 'oe', 'ue', 'ss', 'ae', 'oe', 'o', 'd', 'th'], $value);

    if (function_exists('iconv')) {
        $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (is_string($transliterated)) {
            $value = $transliterated;
        }
    }

    $value = preg_replace('/[^a-z0-9]+/u', '-', $value) ?? '';
    $value = trim($value, '-');

    return $value;
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

function wikiTitleFromUrl(string $url): string {
    $path = (string)(parse_url($url, PHP_URL_PATH) ?? '');
    $marker = '/wiki/';
    $position = strpos($path, $marker);

    if ($position === false) {
        return '';
    }

    $title = substr($path, $position + strlen($marker));
    $title = rawurldecode($title);
    $title = str_replace('_', ' ', $title);

    return trim($title);
}

function decodeJson(mixed $json, mixed $fallback): mixed {
    if ($json === null || trim((string)$json) === '') {
        return $fallback;
    }

    $decoded = json_decode((string)$json, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        return $fallback;
    }

    return $decoded;
}

function encodeJson(mixed $value): string {
    if ($value === null) {
        return '';
    }

    try {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return '';
    }
}

function value(mixed $value): string {
    if ($value === null) {
        return '';
    }

    if (is_bool($value)) {
        return $value ? '1' : '0';
    }

    if (is_scalar($value)) {
        return trim((string)$value);
    }

    return '';
}

function stringOrNull(mixed $value): ?string {
    $text = value($value);

    return $text === '' ? null : $text;
}

function intOrNull(mixed $value): ?int {
    return is_numeric($value) ? (int)$value : null;
}

function floatOrNull(mixed $value): ?float {
    return is_numeric($value) ? (float)$value : null;
}

function applyCors(array $allowedOrigins): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
    }

    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}

function respondJson(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
