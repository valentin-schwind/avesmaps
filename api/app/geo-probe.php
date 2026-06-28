<?php

declare(strict_types=1);

// TEMPORARY diagnostic for the geo lookup. Returns what the server resolves for the CALLER's own
// IP (country/region only) plus the raw matched range, so we can see where the chain breaks.
// No IP stored, last octet hidden. Delete after debugging.

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

header('Content-Type: application/json');

$out = [];
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $out['ip_prefix'] = strrpos($ip, '.') !== false ? substr($ip, 0, strrpos($ip, '.')) . '.x' : 'v6/' . substr($ip, 0, 8);
    $out['table_rows'] = (int) $pdo->query('SELECT COUNT(*) FROM visitor_geo_range')->fetchColumn();
    $key = avesmapsVisitorIpKey($ip);
    $out['key_hex'] = $key === null ? null : strtoupper(bin2hex($key));
    if ($key !== null) {
        $statement = $pdo->prepare('SELECT country, region, HEX(ip_start) AS s, HEX(ip_end) AS e FROM visitor_geo_range WHERE ip_start <= UNHEX(:ip) ORDER BY ip_start DESC LIMIT 1');
        $statement->execute(['ip' => $out['key_hex']]);
        $out['raw_row'] = $statement->fetch(PDO::FETCH_ASSOC) ?: null;
        if (is_array($out['raw_row'])) {
            $out['end_ge_key'] = ((string) $out['raw_row']['e']) >= $out['key_hex'];
        }
    }
    $out['lookup_fn'] = avesmapsVisitorGeoLookup($pdo, $ip);
    $out['rec_region'] = $pdo->query("SELECT actor_type, dimension, SUM(count) c FROM visitor_metric WHERE metric='region' GROUP BY actor_type, dimension ORDER BY c DESC LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
    $out['rec_country'] = $pdo->query("SELECT actor_type, dimension, SUM(count) c FROM visitor_metric WHERE metric='country' GROUP BY actor_type, dimension ORDER BY c DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
    $out['reader_geo'] = avesmapsVisitorReadGeo($pdo, 30);
} catch (Throwable $exception) {
    $out['error'] = $exception->getMessage();
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
