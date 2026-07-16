<?php
declare(strict_types=1);

// Owner-run full link check (Spec §1.7). The editor button does the same work in bounded steps because
// PHP requests must stay under the ~28s ceiling; this script has no such limit and simply runs the whole
// backlog to completion. Dry-run unless --confirm.
//
// Usage:  php scripts/check-links.php                 (dry-run: report only, writes NOTHING)
//         php scripts/check-links.php --confirm       (sync + probe the whole backlog, write results)
//         php scripts/check-links.php --confirm --sync-only   (rebuild the registry, probe nothing)
//
// Politeness is enforced inside the probe (600ms + jitter PER host), so a full run over thousands of
// links is slow BY DESIGN. Let it run; do not parallelise it.

require __DIR__ . '/../api/_internal/bootstrap.php';
require_once __DIR__ . '/../api/_internal/linkcheck/providers.php';

$confirm = in_array('--confirm', $argv, true);
$syncOnly = in_array('--sync-only', $argv, true);

// Same bootstrap contract the app endpoints use (see api/app/adventures.php).
$config = avesmapsLoadApiConfig(avesmapsApiRoot());
$pdo = avesmapsCreatePdo($config['database'] ?? []);
avesmapsLinkCheckEnsureTables($pdo);

// ---- 1. the registry -----------------------------------------------------------------------------
// WITHOUT --confirm nothing is written. That matters more than it looks: the sync does not only upsert,
// it also DELETEs stale refs and prunes orphaned link_status rows. Should a provider return 0 rows for a
// moment (a table mid-migration, a status filter that got too broad), a "dry run" would wipe the whole
// probe history -- fail_streak, first_failed_at, last_online_at. A dry run must never be able to do that.
// So it only ASKS the providers what they would register, and reports the counts.
if (!$confirm) {
    foreach (avesmapsLinkCheckProviders() as $type => $collector) {
        printf("would sync %-10s %d links\n", $type, count($collector($pdo)));
    }
    $status = avesmapsLinkCheckStatus($pdo);
    printf(
        "registry today: %d links (online %d, dead %d, unchecked %d) -- %d due\n",
        $status['total'],
        $status['online'],
        $status['dead'],
        $status['unchecked'],
        $status['due']
    );
    printf("DRY-RUN. Nothing written, nothing probed. Re-run with --confirm.\n");
    exit(0);
}

$cursor = '';
$done = false;
$guard = 0;
while (!$done) {
    if (++$guard > 100) { // the registry has a handful of providers; this can only trip on a bug
        fwrite(STDERR, "ABORT: sync did not finish after 100 steps.\n");
        exit(1);
    }
    $step = avesmapsLinkCheckSyncStep($pdo, $cursor);
    printf(
        "sync %-10s seen=%-5d new=%-4d removed=%-4d pruned=%d\n",
        (string) $step['entity_type'],
        (int) $step['seen'],
        (int) $step['created'],
        (int) $step['removed'],
        (int) $step['pruned']
    );
    $cursor = (string) $step['cursor'];
    $done = $step['done'] === true;
}

$status = avesmapsLinkCheckStatus($pdo);
printf(
    "registry: %d links (online %d, dead %d, unchecked %d) -- %d due\n",
    $status['total'],
    $status['online'],
    $status['dead'],
    $status['unchecked'],
    $status['due']
);

if ($syncOnly) {
    echo "SYNC-ONLY. Nothing probed.\n";
    exit(0);
}

// ---- 2. probe the whole backlog ------------------------------------------------------------------
// budget 0 = no time cap (that ceiling exists for the web request, not here). Each pass still leases and
// probes at most one batch, so a crash costs one batch, not the run.
$checked = 0;
$online = 0;
$dead = 0;
$passes = 0;
while (true) {
    $step = avesmapsLinkCheckStep($pdo, 0);
    $checked += (int) $step['checked'];
    $online += (int) $step['online'];
    $dead += (int) $step['dead'];
    $passes++;

    printf(
        "pass %-3d checked=%-3d online=%-3d dead=%-3d remaining=%d\n",
        $passes,
        (int) $step['checked'],
        (int) $step['online'],
        (int) $step['dead'],
        (int) $step['remaining']
    );

    if ($step['done'] === true) {
        break;
    }
    // Watch `processed`, not `checked`: a pass consisting only of refused URLs (private/bad scheme)
    // checks nothing yet writes real progress, and reading `checked` here would call that a stall.
    // Genuinely zero processed while links remain due means they are leased by a parallel runner --
    // stop instead of spinning, they fall due again by themselves.
    if ((int) $step['processed'] === 0) {
        echo "No progress in this pass (rows leased elsewhere?). Stopping.\n";
        break;
    }
}

$final = avesmapsLinkCheckStatus($pdo);
printf(
    "DONE. %d probed in %d passes (%d online, %d dead). Catalog now: online %d, dead %d, unchecked %d.\n",
    $checked,
    $passes,
    $online,
    $dead,
    $final['online'],
    $final['dead'],
    $final['unchecked']
);
