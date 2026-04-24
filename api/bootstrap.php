<?php

declare(strict_types=1);

function avesmapsLoadApiConfig(string $apiDirectory): array {
    $localConfigPath = $apiDirectory . DIRECTORY_SEPARATOR . 'config.local.php';
    if (is_file($localConfigPath)) {
        $config = require $localConfigPath;
        if (is_array($config)) {
            return $config;
        }

        throw new RuntimeException('Die lokale API-Konfiguration ist ungueltig.');
    }

    $environmentConfig = avesmapsBuildApiConfigFromEnvironment();
    if ($environmentConfig !== null) {
        return $environmentConfig;
    }

    throw new RuntimeException('Es wurde keine API-Konfiguration gefunden.');
}

function avesmapsBuildApiConfigFromEnvironment(): ?array {
    $driver = trim((string) getenv('AVESMAPS_DB_DRIVER'));
    $host = trim((string) getenv('AVESMAPS_DB_HOST'));
    $port = trim((string) getenv('AVESMAPS_DB_PORT'));
    $databaseName = trim((string) getenv('AVESMAPS_DB_NAME'));
    $user = trim((string) getenv('AVESMAPS_DB_USER'));
    $password = (string) getenv('AVESMAPS_DB_PASSWORD');

    if ($driver === '' || $host === '' || $port === '' || $databaseName === '' || $user === '') {
        return null;
    }

    $allowedOrigins = array_filter(
        array_map(
            static fn(string $origin): string => trim($origin),
            explode(',', (string) getenv('AVESMAPS_ALLOWED_ORIGINS'))
        ),
        static fn(string $origin): bool => $origin !== ''
    );

    return [
        'database' => [
            'driver' => $driver,
            'host' => $host,
            'port' => $port,
            'name' => $databaseName,
            'charset' => trim((string) getenv('AVESMAPS_DB_CHARSET')) ?: 'utf8mb4',
            'user' => $user,
            'password' => $password,
        ],
        'cors' => [
            'allowed_origins' => array_values($allowedOrigins),
        ],
        'import_api' => [
            'token' => trim((string) getenv('AVESMAPS_IMPORT_API_TOKEN')),
        ],
    ];
}

function avesmapsApplyCorsPolicy(array $config): bool {
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }

    $allowedOrigins = avesmapsGetAllowedOrigins($config);
    if ($allowedOrigins === []) {
        return false;
    }

    if ($allowedOrigins === ['*']) {
        header('Access-Control-Allow-Origin: *');
    } elseif (!in_array($origin, $allowedOrigins, true)) {
        return false;
    } else {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept');
    header('Access-Control-Max-Age: 86400');

    return true;
}

function avesmapsGetAllowedOrigins(array $config): array {
    $origins = $config['cors']['allowed_origins'] ?? [];
    if (!is_array($origins)) {
        return [];
    }

    $normalizedOrigins = [];
    foreach ($origins as $origin) {
        $normalizedOrigin = trim((string) $origin);
        if ($normalizedOrigin === '') {
            continue;
        }

        $normalizedOrigins[$normalizedOrigin] = $normalizedOrigin;
    }

    return array_values($normalizedOrigins);
}

function avesmapsJsonResponse(int $statusCode, array $payload = []): never {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    if ($statusCode !== 204) {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    exit;
}

function avesmapsReadJsonRequest(): array {
    $rawRequestBody = file_get_contents('php://input');
    if (!is_string($rawRequestBody) || trim($rawRequestBody) === '') {
        throw new InvalidArgumentException('Die Anfrage enthaelt keine JSON-Daten.');
    }

    try {
        $payload = json_decode($rawRequestBody, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        throw new InvalidArgumentException('Die Anfrage enthaelt ungueltiges JSON.');
    }

    if (!is_array($payload)) {
        throw new InvalidArgumentException('Die Anfrage enthaelt kein gueltiges JSON-Objekt.');
    }

    return $payload;
}

function avesmapsCreatePdo(array $databaseConfig): PDO {
    $driver = trim((string) ($databaseConfig['driver'] ?? ''));
    $host = trim((string) ($databaseConfig['host'] ?? ''));
    $port = trim((string) ($databaseConfig['port'] ?? ''));
    $databaseName = trim((string) ($databaseConfig['name'] ?? ''));
    $charset = trim((string) ($databaseConfig['charset'] ?? 'utf8mb4'));
    $user = (string) ($databaseConfig['user'] ?? '');
    $password = (string) ($databaseConfig['password'] ?? '');

    if ($driver === '' || $host === '' || $port === '' || $databaseName === '' || $user === '') {
        throw new RuntimeException('Die Datenbank-Konfiguration ist unvollstaendig.');
    }

    $dsn = match ($driver) {
        'mysql', 'mariadb' => sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $host,
            $port,
            $databaseName,
            $charset
        ),
        'pgsql', 'postgres', 'postgresql' => sprintf(
            'pgsql:host=%s;port=%s;dbname=%s',
            $host,
            $port,
            $databaseName
        ),
        default => throw new RuntimeException('Der Datenbank-Treiber wird nicht unterstuetzt.'),
    };

    return new PDO(
        $dsn,
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
}

function avesmapsGetConfiguredImportApiToken(array $config): string {
    return trim((string) ($config['import_api']['token'] ?? ''));
}

function avesmapsReadRequestHeader(string $headerName): string {
    $serverKey = 'HTTP_' . str_replace('-', '_', strtoupper($headerName));
    return trim((string) ($_SERVER[$serverKey] ?? ''));
}

function avesmapsReadBearerTokenFromRequest(): string {
    $authorizationHeader = avesmapsReadRequestHeader('Authorization');
    if (preg_match('/^Bearer\s+(.+)$/i', $authorizationHeader, $matches) !== 1) {
        return '';
    }

    return trim((string) ($matches[1] ?? ''));
}

function avesmapsReadImportApiTokenFromRequest(): string {
    $headerToken = avesmapsReadRequestHeader('X-Avesmaps-Import-Token');
    if ($headerToken !== '') {
        return $headerToken;
    }

    return avesmapsReadBearerTokenFromRequest();
}

function avesmapsNormalizeSingleLine(?string $value, int $maxLength): string {
    $normalizedValue = preg_replace('/\s+/u', ' ', trim((string) $value)) ?? '';
    if (mb_strlen($normalizedValue) <= $maxLength) {
        return $normalizedValue;
    }

    return mb_substr($normalizedValue, 0, $maxLength);
}

function avesmapsNormalizeMultiline(?string $value, int $maxLength): string {
    $normalizedValue = trim(str_replace("\r\n", "\n", (string) $value));
    if (mb_strlen($normalizedValue) <= $maxLength) {
        return $normalizedValue;
    }

    return mb_substr($normalizedValue, 0, $maxLength);
}

function avesmapsNormalizeOptionalUrl(?string $value, int $maxLength, string $fieldLabel): string {
    $normalizedValue = avesmapsNormalizeSingleLine($value, $maxLength);
    if ($normalizedValue === '') {
        return '';
    }

    if (!preg_match('/^https?:\/\//i', $normalizedValue)) {
        throw new InvalidArgumentException("{$fieldLabel} muss mit http:// oder https:// beginnen.");
    }

    return $normalizedValue;
}

function avesmapsParseMapCoordinate(mixed $value, string $fieldName): float {
    $normalizedValue = is_string($value) ? str_replace(',', '.', trim($value)) : $value;
    $coordinate = filter_var($normalizedValue, FILTER_VALIDATE_FLOAT);
    if ($coordinate === false || $coordinate < 0 || $coordinate > 1024) {
        throw new InvalidArgumentException("Die Koordinate {$fieldName} ist ungueltig.");
    }

    return round((float) $coordinate, 3);
}

function avesmapsClientIpAddress(): string {
    $forwardedFor = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    if ($forwardedFor !== '') {
        $ipCandidates = array_map('trim', explode(',', $forwardedFor));
        if ($ipCandidates !== []) {
            return mb_substr($ipCandidates[0], 0, 64);
        }
    }

    return mb_substr(trim((string) ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 64);
}
