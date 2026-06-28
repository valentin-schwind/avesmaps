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
