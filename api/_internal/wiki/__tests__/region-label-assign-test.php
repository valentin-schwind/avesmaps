<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE core of the V6c label assignment in api/_internal/wiki/regions.php
 * (dry-run gate + change plan). No DB, no HTTP -- hand-built row arrays only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/region-label-assign-test.php
 * Exit 0 = all asserts passed.
 */

// Environment guard: assert() is compiled to a silent no-op unless zend.assertions=1 is set at
// PHP startup -- it CANNOT be flipped at runtime via ini_set(). Without this guard a broken
// implementation would print the "ok" line and exit 0: a false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../regions.php';

// ------------------------------------------------------------------------------ THE GATE ---
// 🔴 Shape copied from avesmapsWikiRegionAssign / avesmapsEcosystemAssignIsDryRun: the dry run is
// the DEFAULT, and going sharp needs TWO independent signals. One call rewrites up to 200 labels
// and bumps map_revision for every visitor -- a single mistyped flag must not be enough.
assert(avesmapsWikiRegionAssignLabelsIsDryRun([]) === true, 'silence means dry run');
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['dry_run' => false]) === true, 'dry_run alone is not enough');
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['confirm' => 'apply']) === true, 'confirm alone is not enough');
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['dry_run' => false, 'confirm' => 'apply']) === false, 'both -> sharp');
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['dry_run' => false, 'confirm' => 'APPLY']) === true, 'confirm is case-sensitive');
// JSON hands us whatever the client typed, and the STRING "false" is truthy in PHP -- reading it as
// "not a dry run" would let a sloppy client go sharp by accident.
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['dry_run' => 'false', 'confirm' => 'apply']) === true, 'only the boolean false disarms it');
assert(avesmapsWikiRegionAssignLabelsIsDryRun(['dry_run' => 0, 'confirm' => 'apply']) === true, 'zero is not false');

// ------------------------------------------------------------------------------- THE PLAN ---
// The preview the editor sees before going sharp. It carries each label's CURRENT wiki_key next to
// the one it would get, because "assign" and "already assigned" look identical in a bare count.
$rows = [
    // never assigned -- the ordinary case
    ['public_id' => 'aaaaaaaa-0000-4000-8000-000000000001', 'name' => 'Bilku', 'feature_subtype' => 'insel', 'properties_json' => '{"size":18}'],
    // already carries the target key -> nothing would change
    ['public_id' => 'aaaaaaaa-0000-4000-8000-000000000002', 'name' => 'Sorak', 'feature_subtype' => 'insel', 'properties_json' => '{"wiki_region":{"wiki_key":"bilku-archipel"}}'],
    // hangs on a DIFFERENT wiki region -> assigning re-hangs it, and the preview has to say so
    ['public_id' => 'aaaaaaaa-0000-4000-8000-000000000003', 'name' => 'Kossike', 'feature_subtype' => 'insel', 'properties_json' => '{"wiki_region":{"wiki_key":"kossike"}}'],
    // properties_json NULL and unparsable -- both must read as "no key", never as a crash
    ['public_id' => 'aaaaaaaa-0000-4000-8000-000000000004', 'name' => 'Namenlos', 'feature_subtype' => 'region', 'properties_json' => null],
    ['public_id' => 'aaaaaaaa-0000-4000-8000-000000000005', 'name' => 'Kaputt', 'feature_subtype' => 'region', 'properties_json' => '{not json'],
];
$plan = avesmapsWikiRegionAssignLabelsPlan($rows, 'bilku-archipel');

assert(count($plan) === 5, 'every requested label appears in the plan, unchanged ones included');
assert($plan[0]['wiki_key_before'] === null, 'a label without wiki_region has no previous key');
assert($plan[0]['changes'] === true);
assert($plan[0]['name'] === 'Bilku');
assert($plan[0]['subtype'] === 'insel');
assert($plan[1]['wiki_key_before'] === 'bilku-archipel');
assert($plan[1]['changes'] === false, 'already on the target key -> no change');
assert($plan[2]['wiki_key_before'] === 'kossike');
assert($plan[2]['changes'] === true, 'hanging elsewhere is a change, and a re-hang');
assert($plan[3]['wiki_key_before'] === null, 'properties_json NULL is not an error');
assert($plan[4]['wiki_key_before'] === null, 'unparsable properties_json is not an error');

// The counter the dialog shows. Only genuinely changing labels are worth reporting.
$changing = array_values(array_filter($plan, static fn (array $entry): bool => $entry['changes']));
assert(count($changing) === 4, 'four of five would really change');

// An empty target key is not a plan: clearing an assignment is the label editor's job, not this
// action's, and a blank key here would silently write wiki_region for the key "".
$threw = false;
try {
    avesmapsWikiRegionAssignLabelsPlan($rows, '   ');
} catch (InvalidArgumentException $exception) {
    $threw = true;
}
assert($threw === true, 'a blank wiki_key is refused, not treated as "clear"');

echo "region label assign: all assertions passed\n";
