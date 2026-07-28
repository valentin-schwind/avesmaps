<?php

declare(strict_types=1);

/**
 * Unit test for the label <-> region relation and the area-row decoration. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/ecosystem-label-link-test.php
 * Exit 0 = all asserts passed.
 *
 * Why these two rules are worth a test rather than a comment: both fail SILENTLY.
 *  - A wrong relation makes the delete cascade fire on the wrong region (it deletes areas AND labels).
 *  - A stale pointer counted as a label stops the cascade from ever firing for that region.
 */

require_once __DIR__ . '/../ecosystem-label-link.php';

// ------------------------------------------------------------------ THE RELATION, BOTH WAYS ---

// The plain case: the region names its primary label, the label says nothing.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => 'l1']],
    [],
    ['l1']
);
assert($result['by_label'] === ['l1' => 'r1']);
assert($result['count_by_region'] === ['r1' => 1]);

// The other direction alone: a second label of the same area carries its OWN pointer and no region
// names it. Reading only the region side would report it as homeless -- and the 1:N exists for it.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => null]],
    [['public_id' => 'l2', 'region_public_id' => 'r1']],
    ['l2']
);
assert($result['by_label'] === ['l2' => 'r1']);
assert($result['count_by_region'] === ['r1' => 1]);

// Both directions on the SAME region: one primary plus two own-pointer labels = three, counted once each.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => 'l1']],
    [
        ['public_id' => 'l2', 'region_public_id' => 'r1'],
        ['public_id' => 'l3', 'region_public_id' => 'r1'],
    ],
    ['l1', 'l2', 'l3']
);
assert($result['count_by_region'] === ['r1' => 3]);

// The same label named by BOTH sides counts ONCE, not twice. A region whose primary label also carries
// its own pointer is the normal state after a clone, and double-counting it would make the cascade
// believe a label is left when none is.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => 'l1']],
    [['public_id' => 'l1', 'region_public_id' => 'r1']],
    ['l1']
);
assert($result['count_by_region'] === ['r1' => 1]);

// Disagreement: the label says r2, a region claims it as its primary. The LABEL wins -- it is the
// direction the feature moves towards, and it is the only one that can be right about itself.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => 'l1']],
    [['public_id' => 'l1', 'region_public_id' => 'r2']],
    ['l1']
);
assert($result['by_label'] === ['l1' => 'r2']);
assert($result['count_by_region'] === ['r2' => 1]);

// 💣 A STALE POINTER IS NOT A LABEL. The region still points at a label somebody deleted by hand.
// Counting it would report "1 label" for a region that has none -- and the delete cascade would then
// never fire for it, because there would always appear to be one left.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => 'l-deleted']],
    [],
    ['l1']
);
assert($result['by_label'] === []);
assert($result['count_by_region'] === []);

// The same guard on the other side: a label row that is no longer active does not count either.
$result = avesmapsEcosystemLabelRegionMap(
    [],
    [['public_id' => 'l-deleted', 'region_public_id' => 'r1']],
    []
);
assert($result['count_by_region'] === []);

// Empty / blank pointers are "no relation", never a region keyed by the empty string.
$result = avesmapsEcosystemLabelRegionMap(
    [['public_id' => 'r1', 'label_public_id' => '']],
    [['public_id' => 'l1', 'region_public_id' => '']],
    ['l1']
);
assert($result['by_label'] === []);
assert($result['count_by_region'] === []);

// The two label-less regions of the live stock (Wald-001 / Wald-002) simply do not appear.
$result = avesmapsEcosystemLabelRegionMap(
    [
        ['public_id' => 'wald-001', 'label_public_id' => null],
        ['public_id' => 'wald-002', 'label_public_id' => null],
        ['public_id' => 'r1', 'label_public_id' => 'l1'],
    ],
    [],
    ['l1']
);
assert(!isset($result['count_by_region']['wald-001']));
assert(!isset($result['count_by_region']['wald-002']));
assert($result['count_by_region'] === ['r1' => 1]);

// ------------------------------------------------------------------- THE AREA DECORATION ---

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../ecosystem.php';

$rows = avesmapsEcosystemDecorateAreaRows(
    [['region_public_id' => 'r1', 'kind' => 'vegetation', 'region_type' => 'wald']],
    ['vegetation|wald' => 'Wald'],
    ['r1' => 3],
    ['r1' => 2]
);
assert($rows[0]['region_type_label'] === 'Wald');
assert($rows[0]['region_area_count'] === 3);
assert($rows[0]['region_label_count'] === 2);

// 💣 The type label is keyed by kind AND type_key. ecosystem_region_type's PRIMARY KEY is (kind,
// type_key), so the same key may exist in two layers with different labels -- keying by the type alone
// would hand a topographic area the vegetation layer's wording.
$rows = avesmapsEcosystemDecorateAreaRows(
    [['region_public_id' => 'r1', 'kind' => 'topographie', 'region_type' => 'tal']],
    ['vegetation|tal' => 'FALSCH', 'topographie|tal' => 'Tal'],
    [],
    []
);
assert($rows[0]['region_type_label'] === 'Tal');

// A type without a label falls back to its own key -- worse than the label, better than nothing.
$rows = avesmapsEcosystemDecorateAreaRows(
    [['region_public_id' => 'r1', 'kind' => 'vegetation', 'region_type' => 'neuling']],
    [],
    [],
    []
);
assert($rows[0]['region_type_label'] === 'neuling');

// No type at all is a valid state ("— keine Vegetation —") and yields an empty label, so the tooltip
// drops the whole bracket part instead of printing a stray comma.
$rows = avesmapsEcosystemDecorateAreaRows(
    [['region_public_id' => 'r1', 'kind' => 'vegetation', 'region_type' => null]],
    ['vegetation|wald' => 'Wald'],
    [],
    []
);
assert($rows[0]['region_type_label'] === '');

// A region with no counted areas/labels reports 0, never a missing key -- the client formats numbers.
$rows = avesmapsEcosystemDecorateAreaRows(
    [['region_public_id' => 'unbekannt', 'kind' => 'vegetation', 'region_type' => 'wald']],
    ['vegetation|wald' => 'Wald'],
    ['r1' => 3],
    ['r1' => 2]
);
assert($rows[0]['region_area_count'] === 0);
assert($rows[0]['region_label_count'] === 0);

// An empty payload stays an empty payload.
assert(avesmapsEcosystemDecorateAreaRows([], [], [], []) === []);

echo "ecosystem-label-link tests passed\n";
