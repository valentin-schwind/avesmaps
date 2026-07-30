<?php

declare(strict_types=1);

/**
 * Unit tests for the transport list the path editor SAVES (api/_internal/map/features.php):
 * avesmapsReadAllowedTransports.
 *
 * The function is pure. It is the fourth place the way-type transport rule is written down -- the
 * other three are the editor dialog and the client route graph (both via
 * getDefaultAllowedTransportsForPathSubtype / resolvePathAllowedTransports in
 * js/map-features/map-features-path-domain.js) and the server route graph
 * (avesmapsClientRouteDefaultAllowedTransports in api/_internal/routing/client-graph.php, covered by
 * api/_internal/routing/__tests__/transport-restriction-test.php). All four must agree, or the dialog
 * shows something the router does not drive.
 *
 * Two rules with OPPOSITE shapes live here, and the difference is the point:
 *   Wuestenpfad -- the carriage is not OFFERED, so a submitted one is dropped and can never be stored.
 *   Pfad        -- the carriage IS offered but not PRE-SELECTED (Owner, 2026-07-30). A submitted one
 *                  is kept: that is how the handful of carriage-capable paths get recorded.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/map/__tests__/path-transport-save-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded -- features.php needs it.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

// bootstrap.php first: features.php calls avesmapsNormalizeSingleLine, which lives there. Both are
// side-effect-free on include -- bootstrap.php only defines AVESMAPS_API_ROOT and functions, it
// connects to nothing.
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

const AVESMAPS_TEST_LAND_FULL = ['caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider'];
const AVESMAPS_TEST_LAND_NO_CARRIAGE = ['caravan', 'groupFoot', 'lightWalker', 'groupHorse', 'lightRider'];

// 1) Nothing submitted -> the way type's PRE-SELECTED list. Only the Pfad loses the carriage.
assert(avesmapsReadAllowedTransports(null, 'land', 'Pfad') === AVESMAPS_TEST_LAND_NO_CARRIAGE);
assert(avesmapsReadAllowedTransports(null, 'land', 'Weg') === AVESMAPS_TEST_LAND_FULL);
assert(avesmapsReadAllowedTransports(null, 'land', 'Strasse') === AVESMAPS_TEST_LAND_FULL);
assert(avesmapsReadAllowedTransports(null, 'land', 'Reichsstrasse') === AVESMAPS_TEST_LAND_FULL);
assert(avesmapsReadAllowedTransports(null, 'land', 'Gebirgspass') === AVESMAPS_TEST_LAND_FULL);
assert(avesmapsReadAllowedTransports(null, 'land', 'Wuestenpfad') === AVESMAPS_TEST_LAND_NO_CARRIAGE);
echo "nothing submitted falls back to the pre-selected list ok\n";

// 2) A submitted carriage on a Pfad IS stored -- the checkbox exists so an editor can grant it.
assert(avesmapsReadAllowedTransports(['groupFoot', 'horseCarriage'], 'land', 'Pfad') === ['groupFoot', 'horseCarriage']);
assert(avesmapsReadAllowedTransports(AVESMAPS_TEST_LAND_FULL, 'land', 'Pfad') === AVESMAPS_TEST_LAND_FULL);
echo "a carriage an editor ticked on a Pfad is stored ok\n";

// 3) On a Wuestenpfad the carriage is not offered, so it can never be stored.
assert(avesmapsReadAllowedTransports(['groupFoot', 'horseCarriage'], 'land', 'Wuestenpfad') === ['groupFoot']);
echo "a Wuestenpfad still cannot store a carriage ok\n";

// 4) An explicitly empty list means impassable and stays empty for every subtype.
assert(avesmapsReadAllowedTransports([], 'land', 'Pfad') === []);
assert(avesmapsReadAllowedTransports([], 'land', 'Weg') === []);
echo "an empty submitted list stays empty ok\n";

// 5) transport_domain still governs which options are compatible at all -- the subtype rule sits on
// top of it, it does not replace it. A 'none' domain offers nothing, whatever the way type is.
assert(avesmapsReadAllowedTransports(null, 'none', 'Pfad') === []);
assert(avesmapsReadAllowedTransports(null, 'river', 'Flussweg') === ['riverSailer', 'riverBarge']);
assert(avesmapsReadAllowedTransports(null, 'sea', 'Seeweg') === ['cargoShip', 'fastShip', 'galley']);
assert(avesmapsReadAllowedTransports(['horseCarriage'], 'river', 'Pfad') === []);
echo "the transport_domain still governs compatibility ok\n";

// 6) No subtype passed (the parameter is nullable): pure domain behaviour, no way-type rule.
assert(avesmapsReadAllowedTransports(null, 'land') === AVESMAPS_TEST_LAND_FULL);
echo "without a subtype only the domain applies ok\n";

echo "ALL OK\n";
