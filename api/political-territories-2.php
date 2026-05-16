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

    respondJson([
        'ok' => true,
        'count' => count($items),
        'generated_at' => gmdate('c'),
        'items' => $items,
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
        'raw' => is_array($raw) ? $raw : null,
        'synced_at' => stringOrNull($row['synced_at'] ?? null),
    ];
}

function decodeJson(?string $json, mixed $fallback): mixed {
    if ($json === null || trim($json) === '') {
        return $fallback;
    }

    $decoded = json_decode($json, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        return $fallback;
    }

    return $decoded;
}

function stringOrNull(mixed $value): ?string {
    if ($value === null) {
        return null;
    }

    $text = trim((string)$value);
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
