<?php

declare(strict_types=1);

/**
 * Unit test for the wiki_path provenance plumbing (api/_internal/wiki/paths.php):
 * avesmapsWikiPathBuildAssignObject's optional $assignMeta param, which stamps
 * `source` (whitelist editor|verlauf-sync, default editor, always emitted) and,
 * when non-empty, `course_hash`/`course_hops` onto properties.wiki_path. This
 * lets the later verlauf-sync diff engine (Task 5+) tell owner-curated segments
 * apart from sync-written ones. Run:
 *     php -d extension=mbstring tools/paths/test-path-verlauf-source.php
 */

require __DIR__ . '/../../api/_internal/wiki/sync.php';
require __DIR__ . '/../../api/_internal/wiki/paths.php';

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

$row = ['wiki_key' => 'reichsstrasse-1', 'name' => 'Reichsstraße 1', 'kind' => 'strasse', 'verlauf' => 'A → B', 'wiki_url' => 'https://x/wiki/Reichsstra%C3%9Fe_1'];

// default source
$o = avesmapsWikiPathBuildAssignObject($row);
check('default source is editor', $o['source'] ?? null, 'editor');
check('no course_hash by default', array_key_exists('course_hash', $o), false);
check('no course_hops by default', array_key_exists('course_hops', $o), false);

// whitelist
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'verlauf-sync']);
check('verlauf-sync source kept', $o['source'], 'verlauf-sync');
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'evil']);
check('unknown source falls back to editor', $o['source'], 'editor');

// meta emission
$o = avesmapsWikiPathBuildAssignObject($row, ['source' => 'verlauf-sync', 'course_hash' => sha1('A → B'), 'course_hops' => ['A → B']]);
check('course_hash emitted', $o['course_hash'], sha1('A → B'));
check('course_hops emitted', $o['course_hops'], ['A → B']);
$o = avesmapsWikiPathBuildAssignObject($row, ['course_hash' => '', 'course_hops' => []]);
check('empty meta omitted', array_key_exists('course_hash', $o) || array_key_exists('course_hops', $o), false);

// existing fields unchanged
check('wiki_key passthrough', $o['wiki_key'], 'reichsstrasse-1');

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
