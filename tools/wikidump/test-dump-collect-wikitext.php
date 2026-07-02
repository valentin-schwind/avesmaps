<?php

declare(strict_types=1);

/**
 * Pure-logic unit test for the WikiDump Task H2 title-set-gated wikitext
 * collector (api/_internal/wiki/dump-entity-scan.php):
 *
 *   avesmapsWikiDumpCollectWikitextForTitles(iterable $pages, array $wantedTitleSet): array
 *   avesmapsWikiDumpResolveWantedTitlesThroughAliases(array $wantedTitleSet, array $aliasMap): array
 *
 * H2 builds only the pure collector building-blocks that H4 will later wrap in
 * the resumable step/cursor orchestration (avesmapsWikiDumpRunPassBStep's
 * discipline) -- this test exercises the DB-free core with hand-built page rows
 * and hand-built alias maps, no real dump / no MySQL needed.
 *
 * WHAT THIS PROVES:
 *   (1) CollectWikitextForTitles matches a page whose NORMALIZED title
 *       (avesmapsWikiSyncMonitorNormalizeTitle: '_'->' ', trim, strip trailing
 *       #fragment) is a key of $wantedTitleSet -- a plain match, an underscore-form
 *       title ('Foo_Bar'), and a '#fragment' title ('Foo Bar#x') all normalize onto
 *       the SAME wanted key and are collected keyed by that normalized title.
 *   (2) a non-wanted title is skipped; a duplicate wanted title occurring twice in
 *       the stream keeps the FIRST occurrence found (matches the recon sketch:
 *       $found[$key] = $page is only reached once more before the early exit, and
 *       once $key is already set a second hit is harmless to overwrite -- this test
 *       asserts the actually-implemented behavior, not an assumed one).
 *   (3) EARLY EXIT: once every wanted title has been found, the generator is not
 *       pulled again -- proven with a sentinel page that throws if consumed.
 *   (4) ResolveWantedTitlesThroughAliases replaces an aliased wanted title with its
 *       canonical target and leaves non-aliased titles untouched.
 *
 * DIVERGENCE FROM THE BRIEF (documented here + in the module docblock + the H2
 * report): avesmapsWikiDumpCollectRedirectAliases (dump-reader.php:379) returns
 * `alias_slug => canonical_wiki_key` (avesmapsPoliticalSlug($title) => 'wiki:'.
 * slug or 'name:'.slug), NOT a title=>title map. avesmapsWikiSyncMonitorStoreAlias
 * (sync-monitor-model.php:35) confirms this is the real, persisted shape
 * (wiki_redirect_alias.alias_slug -> canonical_wiki_key), built for the territory
 * hierarchy's wiki_key identity system. ResolveWantedTitlesThroughAliases is
 * therefore implemented against THIS REAL shape (slug keys, wiki_key values) --
 * this test's alias-map fixtures use avesmapsPoliticalSlug()/'wiki:'-prefixed
 * values, not title strings, to stay honest to what the real Pass-A collector
 * actually produces. See the H2 report for the full analysis.
 *
 * Exit code 0 iff every assert passes; non-zero otherwise.
 *
 * HOW TO RUN (needs mbstring only because political/territory.php's
 * avesmapsPoliticalSlug() -- used to build this test's alias-map FIXTURES, not by
 * the two functions under test themselves -- calls mb_strtolower()/mb_substr()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-collect-wikitext.php
 *
 * (A plain `php tools/wikidump/test-dump-collect-wikitext.php` works iff mbstring
 * is enabled globally.)
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: fixture-building only (see docblock); fail loudly if absent.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but avesmapsPoliticalSlug() (used to build this test's fixtures) requires mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the pure core + the real derivation libs it reuses.
//    All are side-effect-free on include (const + function defs, no DB/headers).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';

foreach ([
    'avesmapsWikiDumpCollectWikitextForTitles',
    'avesmapsWikiDumpResolveWantedTitlesThroughAliases',
    // reused real derivation functions (must be visible for parity with siblings):
    'avesmapsWikiSyncMonitorNormalizeTitle',
    'avesmapsPoliticalSlug',
] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (no framework in this repo -- mirrors the siblings).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-58s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-58s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump title-set wikitext collector pure-logic test (WikiDump H2)\n";
echo "================================================================\n";
echo 'PHP version : ' . PHP_VERSION . "\n";
echo "----------------------------------------------------------------\n\n";

// ===========================================================================
// (A) avesmapsWikiDumpCollectWikitextForTitles -- matching + normalization.
// ===========================================================================
echo "-- A  CollectWikitextForTitles: normalization + set-gated matching --\n";

// Wanted set uses ALREADY-NORMALIZED keys (the documented contract), values are
// irrelevant (isset() membership only) -- use `true` per the recon sketch.
$wantedTitleSet = [
    'Ferdok' => true,
    'Foo Bar' => true,
    'Ort Ohne Treffer' => true, // never appears in the stream -> stays unfound
];

// Stream: a plain match, an underscore-form title, a '#fragment' title (both
// normalize to 'Foo Bar'), a non-wanted title, and a DUPLICATE of the first
// wanted title appearing again later in the stream.
$pagesA = [
    ['title' => 'Ferdok', 'ns' => 0, 'redirect' => null, 'wikitext' => '{{Infobox Siedlung}} Ferdok text'],
    ['title' => 'Foo_Bar', 'ns' => 0, 'redirect' => null, 'wikitext' => 'underscore-form wikitext'],
    ['title' => 'Nicht Gewollt', 'ns' => 0, 'redirect' => null, 'wikitext' => 'not in the wanted set'],
    ['title' => 'Ferdok', 'ns' => 0, 'redirect' => null, 'wikitext' => 'DUPLICATE Ferdok -- should not override the first'],
];

$resultA = avesmapsWikiDumpCollectWikitextForTitles($pagesA, $wantedTitleSet);

$check('(A1) returns exactly 2 found (Ort Ohne Treffer never appears)', 2, count($resultA), 'only Ferdok + Foo Bar are ever seen in the stream');
$check('(A2) keyed by normalized title "Ferdok"', true, isset($resultA['Ferdok']), 'exact match');
$check('(A3) Ferdok wikitext is the FIRST occurrence', '{{Infobox Siedlung}} Ferdok text', $resultA['Ferdok']['wikitext'] ?? null, 'the duplicate later in the stream does not override the first find');
$check('(A4) underscore-form "Foo_Bar" hits wanted key "Foo Bar"', true, isset($resultA['Foo Bar']), 'avesmapsWikiSyncMonitorNormalizeTitle turns _ into space');
$check('(A5) collected page carries the RAW (unnormalized) title too', 'Foo_Bar', $resultA['Foo Bar']['title'] ?? null, 'the whole page dict is preserved, including its original title field');
$check('(A6) non-wanted title "Nicht Gewollt" is absent', false, isset($resultA['Nicht Gewollt']), 'not a member of $wantedTitleSet');
$check('(A7) never-seen wanted title "Ort Ohne Treffer" is absent (missing, not null)', false, array_key_exists('Ort Ohne Treffer', $resultA), 'missing titles are simply absent from the result, not present with a null value');

// '#fragment' form on its own stream, isolated so the early-exit test (B) below
// doesn't need a 3rd wanted title.
$wantedTitleSetFragment = ['Foo Bar' => true];
$pagesFragment = [
    ['title' => 'Foo Bar#Geschichte', 'ns' => 0, 'redirect' => null, 'wikitext' => 'fragment-form wikitext'],
];
$resultFragment = avesmapsWikiDumpCollectWikitextForTitles($pagesFragment, $wantedTitleSetFragment);
$check('(A8) "Title#fragment" form hits wanted key "Title"', 'fragment-form wikitext', $resultFragment['Foo Bar']['wikitext'] ?? null, 'avesmapsWikiSyncMonitorNormalizeTitle strips a trailing #fragment');

// Empty normalized title (e.g. an all-whitespace/garbage title) must never match
// under an empty wanted key.
$wantedTitleSetWithEmptyGuard = ['' => true, 'Real Title' => true];
$pagesEmptyTitle = [
    ['title' => '   ', 'ns' => 0, 'redirect' => null, 'wikitext' => 'should never be collected'],
    ['title' => 'Real Title', 'ns' => 0, 'redirect' => null, 'wikitext' => 'real'],
];
$resultEmptyGuard = avesmapsWikiDumpCollectWikitextForTitles($pagesEmptyTitle, $wantedTitleSetWithEmptyGuard);
$check('(A9) empty normalized title never collected even if "" is (accidentally) a wanted key', 1, count($resultEmptyGuard), 'the explicit empty-key guard fires before the isset() check');

echo "\n";

// ===========================================================================
// (B) EARLY EXIT -- stops pulling the generator once every wanted title is found.
// ===========================================================================
echo "-- B  CollectWikitextForTitles: early exit on full coverage --\n";

$wantedTitleSetSmall = ['Alpha' => true, 'Beta' => true];

$pullCount = 0;
$sentinelPulled = false;
$makeGenerator = static function () use (&$pullCount, &$sentinelPulled): \Generator {
    $rows = [
        ['title' => 'Alpha', 'ns' => 0, 'redirect' => null, 'wikitext' => 'alpha text'],
        ['title' => 'Beta', 'ns' => 0, 'redirect' => null, 'wikitext' => 'beta text'],
        // sentinel: if the collector pulls past the point where both wanted
        // titles are already found, this entry is consumed and flips the flag.
        ['title' => 'Sentinel Should Not Be Pulled', 'ns' => 0, 'redirect' => null, 'wikitext' => 'unreachable'],
    ];
    foreach ($rows as $row) {
        $pullCount++;
        if ($row['title'] === 'Sentinel Should Not Be Pulled') {
            $sentinelPulled = true;
        }
        yield $row;
    }
};

$resultB = avesmapsWikiDumpCollectWikitextForTitles($makeGenerator(), $wantedTitleSetSmall);

$check('(B1) both wanted titles found', 2, count($resultB), 'Alpha + Beta both present in the 2-item stream prefix');
$check('(B2) exactly 2 pages pulled from the generator', 2, $pullCount, 'the loop must break immediately after the 2nd (last) wanted title is found, before requesting a 3rd item');
$check('(B3) the sentinel page was never consumed', false, $sentinelPulled, 'proves the generator was not advanced past full coverage');

echo "\n";

// ===========================================================================
// (C) avesmapsWikiDumpResolveWantedTitlesThroughAliases -- real slug/wiki_key shape.
// ===========================================================================
echo "-- C  ResolveWantedTitlesThroughAliases (real alias_slug => canonical_wiki_key shape) --\n";

// Build the alias map EXACTLY the way avesmapsWikiDumpCollectRedirectAliases
// really does (dump-reader.php:379-404), i.e. NOT a title=>title map:
//   alias_slug         = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title))
//   canonical_wiki_key  = 'wiki:' . avesmapsPoliticalSlug($targetTitle)   (approximating
//                          avesmapsWikiDumpCanonicalWikiKeyForTitle without needing the
//                          full URL-building chain, since the slug tail is what matters here)
$aliasTitle = 'Königreich Kosch (historisch)';
$canonicalTitle = 'Kosch';
$aliasSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($aliasTitle));
$canonicalWikiKey = 'wiki:' . avesmapsPoliticalSlug($canonicalTitle);

$aliasMap = [
    $aliasSlug => $canonicalWikiKey,
];

$wantedTitleSetC = [
    $aliasTitle => true,        // a redirect alias -> should resolve to the canonical wiki_key
    'Unrelated Title' => true,  // not in the alias map -> passes through unchanged
];

$resolvedC = avesmapsWikiDumpResolveWantedTitlesThroughAliases($wantedTitleSetC, $aliasMap);

$check(
    '(C1) resolved set has a canonical_wiki_key entry',
    true,
    isset($resolvedC['resolved'][$canonicalWikiKey]),
    'the alias title slug hits the alias map and is replaced by its canonical_wiki_key'
);
$check(
    '(C2) the alias title itself is no longer a direct key of the resolved wanted set',
    false,
    isset($resolvedC['resolved'][$aliasTitle]),
    'the wanted-set key was REPLACED, not merely supplemented'
);
$check(
    '(C3) non-aliased title passes through unchanged',
    true,
    isset($resolvedC['resolved']['Unrelated Title']),
    '"Unrelated Title" has no entry in $aliasMap -> kept as-is'
);
$check(
    '(C4) reverse mapping recovers the originally-requested alias title',
    $aliasTitle,
    $resolvedC['requestedByResolvedKey'][$canonicalWikiKey] ?? null,
    'H4 needs to map a found canonical page back to the title that was actually requested'
);

echo "\n";

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
echo "----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
