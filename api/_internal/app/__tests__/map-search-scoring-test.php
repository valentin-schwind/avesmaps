<?php

declare(strict_types=1);

// Characterisation test: locks in the behaviour as it is BEFORE the multi-word change, so Task 2 can
// prove it changed only what it meant to.

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';

$gareth = ['search_texts' => ['Stadtplan von Gareth', 'Gareth', 'Stadtplan']];

// The four scoring tiers, unchanged.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth')) === 0);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan von')) === 1);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('von')) === 2);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('areth')) === 3);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('bornland')) === null);

// The umlaut rule the SERVER uses: ue, not u. (The client folds differently -- see the spec, §1.5.)
assert(avesmapsNormalizeSearchText('Echsensümpfe') === 'echsensuempfe');
assert(avesmapsNormalizeSearchText('Khôm') === 'khom');
assert(avesmapsNormalizeSearchText('Weiße Straße') === 'weisse strasse');

echo "map-search-scoring: OK\n";
