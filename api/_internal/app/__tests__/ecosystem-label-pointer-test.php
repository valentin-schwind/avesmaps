<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the "one region, at most one live label" guard: which pointer, if any,
 * has to be checked for liveness before update_region may move it. The liveness query itself is
 * DB-bound and provable only in the owner's live run (there is no local MySQL). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-label-pointer-test.php
 *
 * Why this exists: on 2026-07-28 the draw path reloaded the areas BEFORE creating the region's label,
 * so the properties dialog opened on an empty pointer and its save created a SECOND label. The ordering
 * is fixed; this guard is the backstop, and its branch table is exactly where a wrong `===` would hide.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../ecosystem.php';

$L1 = '11111111-1111-4111-8111-111111111111';
$L2 = '22222222-2222-4222-8222-222222222222';

// --- nothing to check -------------------------------------------------------------------------------

assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => $L1], ['name' => 'Farindel']) === '',
    'a save that does not touch the pointer is never a duplicate');

assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => $L1], ['label_public_id' => null]) === '',
    'clearing the pointer is the way to release a label on purpose, not a duplicate');

assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => null], ['label_public_id' => $L1]) === '',
    'the first label of a region has nothing to collide with');

assert(avesmapsEcosystemLabelPointerToCheck([], ['label_public_id' => $L1]) === '',
    'a region row without the column behaves like one without a pointer');

assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => $L1], ['label_public_id' => $L1]) === '',
    'writing the same id twice is idempotent -- a retried request must not be refused');

// --- the one case that must be checked --------------------------------------------------------------

assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => $L1], ['label_public_id' => $L2]) === $L1,
    'pointing at a DIFFERENT label means the old one has to be proven dead first');

// 🪤 Der geloeschte Fall geht durch die Pruefung, nicht an ihr vorbei: hier wird L1 zurueckgegeben, und
// erst die Abfrage entscheidet. Ein Label einzeln zu loeschen setzt is_active = 0, der Zeiger bleibt --
// das Wiederanhaken von „Regionname anzeigen" legt dann zu Recht ein neues an.
assert(avesmapsEcosystemLabelPointerToCheck(['label_public_id' => $L1], ['label_public_id' => $L2]) !== '',
    'a dangling pointer is resolved by the liveness query, never by assuming it is stale');

echo "ecosystem-label-pointer-test: OK\n";
