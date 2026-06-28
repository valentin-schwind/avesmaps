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
            actor_type ENUM('visitor','editor') NOT NULL DEFAULT 'visitor',
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
        "SELECT day, SUM(CASE WHEN metric IN ('pageview','map_load') THEN count ELSE 0 END) AS views,
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
        WHERE actor_type = :a AND metric IN ('pageview','map_load') AND hour IS NOT NULL
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
        'transport' => $top('transport', 1),
        'route_option' => $top('route_option', 1),
        'display_toggle' => $top('display_toggle', 1),
        'language' => $top('language', 1),
    ];
}

function avesmapsVisitorStorageInfo(PDO $pdo): array {
    $tables = $pdo->query(
        "SELECT table_name AS t, table_rows AS rows, data_length + index_length AS bytes
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE() AND table_name IN ('visitor_metric','visitor_daily_seen')"
    )->fetchAll(PDO::FETCH_ASSOC);
    $total = $pdo->query(
        "SELECT SUM(data_length + index_length) AS bytes FROM information_schema.TABLES WHERE table_schema = DATABASE()"
    )->fetchColumn();
    return ['tables' => $tables, 'database_bytes' => (int) $total];
}
