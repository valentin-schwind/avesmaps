<?php

declare(strict_types=1);

require_once __DIR__ . '/wiki-browser-support.php';
require_once __DIR__ . '/wiki-browser-normalize.php';
require_once __DIR__ . '/wiki-browser-tree.php';

$configPath = dirname(__DIR__, 2) . '/config.local.php';

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
    $items = sanitizeTerritoryItemsForTree($items);

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
