<?php

declare(strict_types=1);

/**
 * Unit test for the pure change-context normalizer. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/report-context-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../report-context.php';

// Default: no report_mode -> new, empty entity fields.
$c = avesmapsNormalizeChangeContext([]);
assert($c['mode'] === 'new' && $c['entity_type'] === '' && $c['entity_public_id'] === '');

// report_mode=new stays new and drops any entity fields.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'new', 'entity_type' => 'settlement', 'entity_public_id' => 'x']);
assert($c['mode'] === 'new' && $c['entity_type'] === '' && $c['entity_public_id'] === '');

// change + valid (upper-case) entity_type kept lower-cased; id trimmed.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'TERRITORY', 'entity_public_id' => '  terr-9  ']);
assert($c['mode'] === 'change' && $c['entity_type'] === 'territory' && $c['entity_public_id'] === 'terr-9');

// change + unknown entity_type -> blanked, still change mode.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'bogus', 'entity_public_id' => 'p1']);
assert($c['mode'] === 'change' && $c['entity_type'] === '' && $c['entity_public_id'] === 'p1');

// id capped at 80 chars.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'path', 'entity_public_id' => str_repeat('a', 100)]);
assert(strlen($c['entity_public_id']) === 80);

echo "report-context ok\n";
