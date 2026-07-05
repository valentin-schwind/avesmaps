<?php

declare(strict_types=1);

/**
 * Unit test for the verlauf-sync course-hash helpers and the pure backfill
 * decision function (api/_internal/wiki/path-verlauf.php, spec doc
 * docs/refactoring-verlauf-sync.md, Task 2). Loads ONLY path-verlauf.php --
 * that file must stay DB-context-free at the top level so this test can run
 * standalone. Extended in Task 3 with more decision/diff coverage. Run:
 *     php tools/paths/test-path-verlauf-engine.php
 */

require __DIR__ . '/../../api/_internal/wiki/path-verlauf.php';

$failures = 0;
$total = 0;
function check(string $label, mixed $actual, mixed $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL {$label}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
        return;
    }
    echo "ok {$label}\n";
}

// --- avesmapsWikiPathCourseHash ---
check('hash of empty is empty', avesmapsWikiPathCourseHash('  '), '');
check('hash trims', avesmapsWikiPathCourseHash(' A → B '), sha1('A → B'));

// --- avesmapsWikiPathVerlaufStations ---
check('stations split', avesmapsWikiPathVerlaufStations('Punin → Ragath → Punin → Kuslik'), ['Punin', 'Ragath', 'Kuslik']);
check('stations empty', avesmapsWikiPathVerlaufStations(''), []);

// --- avesmapsWikiPathVerlaufBackfillDecision ---
$d = avesmapsWikiPathVerlaufBackfillDecision(null, 'k', 'A → B');
check('missing row skipped', $d['reason'], 'inactive_or_missing');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'other']], 'k', 'A → B');
check('reassigned skipped', $d['reason'], 'reassigned');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'editor']], 'k', 'A → B');
check('editor source protected', $d['reason'], 'editor_source');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k']], 'k', 'A → B');
check('stamp sets source', $d['props']['wiki_path']['source'], 'verlauf-sync');
check('stamp sets hash', $d['props']['wiki_path']['course_hash'], sha1('A → B'));

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync', 'course_hash' => 'old']], 'k', '');
check('empty verlauf keeps old hash', $d['props']['wiki_path']['course_hash'], 'old');
check('restamp allowed', $d['props']['wiki_path']['source'], 'verlauf-sync');

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
