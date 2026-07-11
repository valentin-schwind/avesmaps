<?php

declare(strict_types=1);

// One-time CLI seeder for the Abenteuer sample data (Task 1.2). Run on a host that HAS a DB config
// (api/config.local.php or AVESMAPS_DB_* env vars). The sample dataset itself lives in
// api/_internal/app/adventures.php (avesmapsAdventuresSampleSeedData) so it is defined ONCE.
//
// NOTE: tools/ is NOT in the deploy allowlist, so on the live STRATO server the seed is triggered via
// the endpoint action instead (single request, no loop):
//   curl -X POST -H 'Content-Type: application/json' -d '{"action":"seed"}'    https://avesmaps.de/api/app/adventures.php
//   curl -X POST -H 'Content-Type: application/json' -d '{"action":"resolve"}' https://avesmaps.de/api/app/adventures.php
//
// Usage:  php tools/adventures/seed-sample-adventures.php [--resolve]

$repoRoot = dirname(__DIR__, 2);
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/app/adventures.php';
require_once $repoRoot . '/api/_internal/app/adventure-resolve.php';

$config = avesmapsLoadApiConfig($repoRoot . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);

$seeded = avesmapsAdventuresSeedSamples($pdo);
fwrite(STDOUT, "Seeded {$seeded} adventure(s) (idempotent; 0 = already present).\n");

if (in_array('--resolve', $argv, true)) {
    $result = avesmapsAdventureResolveAll($pdo);
    fwrite(STDOUT, sprintf(
        "Resolved %d place(s), still unresolved %d (of %d unresolved processed).\n",
        $result['resolved'],
        $result['unresolved'],
        $result['total']
    ));
}
