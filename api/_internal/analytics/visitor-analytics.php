<?php

declare(strict_types=1);

if (!defined('AVESMAPS_VISITOR_ANALYTICS_ENABLED')) {
    define('AVESMAPS_VISITOR_ANALYTICS_ENABLED', true);
}
if (!defined('AVESMAPS_VISITOR_SALT')) {
    define('AVESMAPS_VISITOR_SALT', 'avesmaps-visitor-salt-override-me');
}

function avesmapsVisitorAnalyticsEnabled(): bool {
    return AVESMAPS_VISITOR_ANALYTICS_ENABLED === true;
}

function avesmapsVisitorAnalyticsEnsureTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_metric (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            day DATE NOT NULL,
            hour TINYINT UNSIGNED NULL,
            actor_type ENUM('visitor','editor','bot') NOT NULL DEFAULT 'visitor',
            metric VARCHAR(40) NOT NULL,
            dimension VARCHAR(190) NOT NULL DEFAULT '',
            count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_visitor_metric (day, hour, actor_type, metric, dimension),
            KEY idx_visitor_metric_metric (metric, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_daily_seen (
            day DATE NOT NULL,
            visitor_hash CHAR(64) NOT NULL,
            PRIMARY KEY (day, visitor_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsVisitorActorType(?array $user): string {
    return ($user !== null && ($user['id'] ?? 0)) ? 'editor' : 'visitor';
}

function avesmapsVisitorClientIp(): string {
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function avesmapsVisitorDailyHash(): string {
    $ip = avesmapsVisitorClientIp();
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $salt = gmdate('Ymd') . '|' . AVESMAPS_VISITOR_SALT;
    return hash('sha256', $salt . '|' . $ip . '|' . $ua);
}

function avesmapsVisitorReferrerSource(string $referrer): string {
    $referrer = trim($referrer);
    if ($referrer === '') {
        return 'direkt';
    }
    $host = strtolower((string) parse_url($referrer, PHP_URL_HOST));
    if ($host === '') {
        return 'direkt';
    }
    $host = preg_replace('/^www\\./', '', $host);
    $engines = ['google' => 'Google', 'bing' => 'Bing', 'duckduckgo' => 'DuckDuckGo', 'ecosia' => 'Ecosia'];
    foreach ($engines as $needle => $label) {
        if (str_contains($host, $needle)) {
            return $label;
        }
    }
    return substr($host, 0, 60);
}

function avesmapsVisitorDeviceClass(string $ua): string {
    $ua = strtolower($ua);
    if (str_contains($ua, 'ipad') || str_contains($ua, 'tablet')) {
        return 'tablet';
    }
    if (str_contains($ua, 'mobi') || str_contains($ua, 'android') || str_contains($ua, 'iphone')) {
        return 'mobil';
    }
    return 'desktop';
}

function avesmapsVisitorIncrement(PDO $pdo, string $actorType, string $metric, string $dimension = '', ?int $hour = null): void {
    $metric = substr(trim($metric), 0, 40);
    if ($metric === '') {
        return;
    }
    $dimension = substr(trim($dimension), 0, 190);
    $statement = $pdo->prepare(
        'INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
        VALUES (UTC_DATE(), :hour, :actor_type, :metric, :dimension, 1)
        ON DUPLICATE KEY UPDATE count = count + 1'
    );
    $statement->execute([
        'hour' => $hour,
        'actor_type' => $actorType === 'editor' ? 'editor' : 'visitor',
        'metric' => $metric,
        'dimension' => $dimension,
    ]);
}

function avesmapsVisitorPurgeOldSeen(PDO $pdo): void {
    $pdo->exec("DELETE FROM visitor_daily_seen WHERE day < UTC_DATE()");
}

function avesmapsVisitorRecordUnique(PDO $pdo, string $actorType): void {
    $hash = avesmapsVisitorDailyHash();
    $insert = $pdo->prepare('INSERT IGNORE INTO visitor_daily_seen (day, visitor_hash) VALUES (UTC_DATE(), :hash)');
    $insert->execute(['hash' => $hash]);
    if ($insert->rowCount() > 0) {
        avesmapsVisitorIncrement($pdo, $actorType, 'unique');
        avesmapsVisitorPurgeOldSeen($pdo);
    }
}

function avesmapsVisitorReadMetrics(PDO $pdo, string $actorType, int $days): array {
    $days = max(1, min(3660, $days));
    $actorType = $actorType === 'editor' ? 'editor' : 'visitor';

    $daily = $pdo->prepare(
        "SELECT day, SUM(CASE WHEN metric = 'pageview' THEN count ELSE 0 END) AS views,
                SUM(CASE WHEN metric = 'unique' THEN count ELSE 0 END) AS uniques,
                SUM(CASE WHEN metric = 'route' THEN count ELSE 0 END) AS routes
        FROM visitor_metric
        WHERE actor_type = :a AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY day ORDER BY day"
    );
    $daily->execute(['a' => $actorType, 'd' => $days]);

    $heat = $pdo->prepare(
        "SELECT DAYOFWEEK(day) AS dow, hour, SUM(count) AS c
        FROM visitor_metric
        WHERE actor_type = :a AND metric = 'pageview' AND hour IS NOT NULL
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY dow, hour"
    );
    $heat->execute(['a' => $actorType, 'd' => $days]);

    $top = static function (string $metric, int $minCount) use ($pdo, $actorType, $days): array {
        $statement = $pdo->prepare(
            "SELECT dimension, SUM(count) AS c FROM visitor_metric
            WHERE actor_type = :a AND metric = :m AND dimension <> ''
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension HAVING c >= :min ORDER BY c DESC LIMIT 8"
        );
        $statement->execute(['a' => $actorType, 'm' => $metric, 'd' => $days, 'min' => $minCount]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    };

    return [
        'daily' => $daily->fetchAll(PDO::FETCH_ASSOC),
        'heatmap' => $heat->fetchAll(PDO::FETCH_ASSOC),
        'search' => $top('search', 3),
        'referrer' => $top('referrer', 1),
        'device' => $top('device', 1),
        'map_mode' => $top('map_mode', 1),
        'route' => $top('route', 3),
        'route_waypoint' => $top('route_waypoint', 3),
        'transport' => $top('transport', 1),
        'route_option' => $top('route_option', 1),
        'display_toggle' => $top('display_toggle', 1),
        'language' => $top('language', 1),
    ];
}

function avesmapsVisitorStorageInfo(PDO $pdo): array {
    try {
        $tables = $pdo->query(
            "SELECT table_name AS t, table_rows AS `rows`, data_length + index_length AS bytes
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE() AND table_name IN ('visitor_metric','visitor_daily_seen')"
        )->fetchAll(PDO::FETCH_ASSOC);
        $total = $pdo->query(
            "SELECT SUM(data_length + index_length) AS bytes FROM information_schema.TABLES WHERE table_schema = DATABASE()"
        )->fetchColumn();
        return ['tables' => $tables, 'database_bytes' => (int) $total];
    } catch (Throwable $exception) {
        return ['tables' => [], 'database_bytes' => 0];
    }
}

function avesmapsVisitorRecentActivity(PDO $pdo, int $limit = 12): array {
    $limit = max(1, min(50, $limit));
    $items = [];
    try {
        $reviews = $pdo->query(
            "SELECT location_name, stars, created_at FROM map_reviews
            WHERE is_hidden = 0 AND is_spam = 0 ORDER BY created_at DESC LIMIT 25"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($reviews as $row) {
            $items[] = [
                'type' => 'Bewertung',
                'label' => (string) ($row['location_name'] ?? ''),
                'detail' => ((int) ($row['stars'] ?? 0)) . '★',
                'at' => (string) ($row['created_at'] ?? ''),
            ];
        }
    } catch (Throwable $exception) {
        // map_reviews may not exist on this install
    }
    try {
        $reports = $pdo->query(
            "SELECT name, status, created_at FROM location_reports
            ORDER BY created_at DESC LIMIT 25"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($reports as $row) {
            $items[] = [
                'type' => 'Meldung',
                'label' => (string) ($row['name'] ?? ''),
                'detail' => (string) ($row['status'] ?? ''),
                'at' => (string) ($row['created_at'] ?? ''),
            ];
        }
    } catch (Throwable $exception) {
        // location_reports may not exist on this install
    }
    usort($items, static function (array $a, array $b): int {
        return strcmp((string) $b['at'], (string) $a['at']);
    });
    return array_slice($items, 0, $limit);
}

function avesmapsVisitorLanguage(): string {
    $raw = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
    $first = strtolower(trim(explode(',', $raw)[0] ?? ''));
    $code = substr($first, 0, 2);
    return preg_match('/^[a-z]{2}$/', $code) ? $code : '?';
}

function avesmapsVisitorEnsureGeoTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_geo_range (
            ip_start VARBINARY(16) NOT NULL,
            ip_end VARBINARY(16) NOT NULL,
            country CHAR(2) NOT NULL DEFAULT '',
            region VARCHAR(80) NOT NULL DEFAULT '',
            PRIMARY KEY (ip_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// Normalises an IPv4 or IPv6 address to a comparable 16-byte key (IPv4 stored as
// an IPv4-mapped IPv6 address), so a single VARBINARY(16) range table covers both.
function avesmapsVisitorIpKey(string $ip): ?string {
    $packed = @inet_pton($ip);
    if ($packed === false) {
        return null;
    }
    if (strlen($packed) === 4) {
        return "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff" . $packed;
    }
    if (strlen($packed) === 16) {
        return $packed;
    }
    return null;
}

// Resolves an IP to {country, region}. Region is only populated for DE rows in
// the dataset; other countries return an empty region. The IP is used only here
// and never stored. Returns empty strings when the range table is missing/unmatched.
function avesmapsVisitorGeoLookup(PDO $pdo, string $ip): array {
    $empty = ['country' => '', 'region' => ''];
    $key = avesmapsVisitorIpKey($ip);
    if ($key === null) {
        return $empty;
    }
    $keyHex = strtoupper(bin2hex($key));
    try {
        $statement = $pdo->prepare(
            "SELECT country, region, HEX(ip_end) AS ip_end_hex FROM visitor_geo_range
            WHERE ip_start <= UNHEX(:ip) ORDER BY ip_start DESC LIMIT 1"
        );
        $statement->execute(['ip' => $keyHex]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row && (string) $row['ip_end_hex'] >= $keyHex) {
            return ['country' => (string) $row['country'], 'region' => (string) $row['region']];
        }
    } catch (Throwable $exception) {
        // visitor_geo_range not imported yet -- degrade to "unknown"
    }
    return $empty;
}

// Best-effort bot classification from the User-Agent: declared crawlers, headless
// browsers and HTTP libraries. Not foolproof against spoofed UAs (see design notes).
function avesmapsVisitorIsBot(string $userAgent): bool {
    if (trim($userAgent) === '') {
        return true;
    }
    return (bool) preg_match(
        '/bot\b|crawl|spider|slurp|headless|phantom|puppeteer|playwright|python-requests|\bcurl\/|\bwget\b|libwww|scrapy|facebookexternalhit|embedly|whatsapp|telegrambot|discordbot|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|sogou|ia_archiver|googlebot|applebot|duckduckbot|bingbot/i',
        $userAgent
    );
}

// Geo breakdown for the "Herkunft" panel: DE Bundesländer (real-visitor clicks) for
// the map, and other countries with a real-visitor/bot split for the bar list.
function avesmapsVisitorReadGeo(PDO $pdo, int $days): array {
    $days = max(1, min(3660, $days));
    try {
        $regions = $pdo->prepare(
            "SELECT dimension, SUM(count) AS c FROM visitor_metric
            WHERE metric = 'region' AND actor_type = 'visitor' AND dimension <> ''
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension ORDER BY c DESC"
        );
        $regions->execute(['d' => $days]);
        $countries = $pdo->prepare(
            "SELECT dimension,
                    SUM(CASE WHEN actor_type = 'visitor' THEN count ELSE 0 END) AS visitors,
                    SUM(CASE WHEN actor_type = 'bot' THEN count ELSE 0 END) AS bots
            FROM visitor_metric
            WHERE metric = 'country' AND dimension <> '' AND dimension <> 'DE'
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension
            HAVING SUM(CASE WHEN actor_type IN ('visitor','bot') THEN count ELSE 0 END) > 0
            ORDER BY SUM(CASE WHEN actor_type IN ('visitor','bot') THEN count ELSE 0 END) DESC LIMIT 40"
        );
        $countries->execute(['d' => $days]);
        return [
            'regions' => $regions->fetchAll(PDO::FETCH_ASSOC),
            'countries' => $countries->fetchAll(PDO::FETCH_ASSOC),
        ];
    } catch (Throwable $exception) {
        return ['regions' => [], 'countries' => []];
    }
}
