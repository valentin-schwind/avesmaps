<?php

declare(strict_types=1);

// Token-gated read of the open website map reports (the "Hier melden" submissions
// that land in map_reports with status='neu'). Mirrors cases-export.php so the daily
// triage routine can fold website direct-reports into its report alongside the Discord
// cases. Privacy fields (remote_ip, ip_hash, user_agent) are deliberately NOT exported.

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

try {
    $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
    $statement = $pdo->query(
        "SELECT id, report_type, report_subtype, name, reporter_name, lat, lng,
                source, wiki_url, comment, review_note, created_at
         FROM map_reports
         WHERE status = 'neu'
         ORDER BY created_at ASC, id ASC"
    );
    $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
} catch (Throwable) {
    // Table missing (nobody has reported yet) or DB unreachable → report zero rather
    // than breaking the daily routine.
    echo json_encode(['ok' => true, 'count' => 0, 'reports' => []], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$reports = array_map(static function (array $row): array {
    return [
        'id' => (int) $row['id'],
        'type' => (string) $row['report_type'],
        'subtype' => (string) $row['report_subtype'],
        'name' => (string) $row['name'],
        'reporter' => (string) ($row['reporter_name'] ?? ''),
        'lat' => (float) $row['lat'],
        'lng' => (float) $row['lng'],
        'source' => (string) ($row['source'] ?? ''),
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'comment' => (string) ($row['comment'] ?? ''),
        'review_note' => (string) ($row['review_note'] ?? ''),
        'created_at' => (string) $row['created_at'],
    ];
}, $rows);

echo json_encode(['ok' => true, 'count' => count($reports), 'reports' => $reports], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
