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

// The four scoring tiers. Single-word queries stay bit-for-bit unchanged (0/2/3/null below).
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth')) === 0);
// CHANGED by Task 2 (was 1, now 2) -- see task-2-report.md "Concerns". 'stadtplan von' is a
// TWO-word query, so per design doc §3.3 (docs/superpowers/specs/2026-08-02-spotlight-
// kartensammlungen-design.md: "Eine Einwort-Eingabe verhaelt sich exakt wie heute... Mehrwort-
// Eingaben liefern mehr Treffer als heute. Das ist gewollt.") it is NOT covered by the
// single-word guarantee below -- multi-word behaviour is explicitly allowed, and intended, to
// differ from today. Per-word scoring rates 'stadtplan'=0 and 'von'=2 and keeps the WORSE of
// the two; 'von' must stay tier 2 here because the single-word 'von' assertion right below is
// pinned at 2 (word-prefix tier -- it is not a prefix of the whole candidate). So 2 is the only
// value reachable without breaking that single-word guarantee; provably no per-word/worst-case
// scorer can hold this line at 1 AND the 'von'-alone line at 2 simultaneously.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan von')) === 2);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('von')) === 2);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('areth')) === 3);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('bornland')) === null);

// The umlaut rule the SERVER uses: ue, not u. (The client folds differently -- see the spec, §1.5.)
assert(avesmapsNormalizeSearchText('Echsensümpfe') === 'echsensuempfe');
assert(avesmapsNormalizeSearchText('Khôm') === 'khom');
assert(avesmapsNormalizeSearchText('Weiße Straße') === 'weisse strasse');

// ---- multi-word: every word must hit, and they may sit in DIFFERENT texts -------------------------
// This is the whole point: "stadtplan" is the type, "gareth" is the place -- no single search_text
// contains both, which is why the old one-string comparison returned null here.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan gareth')) !== null);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth stadtplan')) !== null);

// A word that hits nothing kills the entry, however good the others are.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan bornland')) === null);

// The entry is only as good as its WEAKEST word: 'gareth' is exact (0), 'tadtplan' is contained (3).
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth tadtplan')) === 3);

// Single-word queries must behave EXACTLY as before -- this is the regression guard for the change.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth')) === 0);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('bornland')) === null);

// Repeated whitespace must not produce an empty word that matches everything.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('  stadtplan   gareth ')) !== null);

$winde = ['search_texts' => ['Meer der Sieben Winde']];
assert(avesmapsCalculateSearchScore($winde, avesmapsNormalizeSearchText('meer winde')) !== null);

echo "map-search-scoring: OK\n";
