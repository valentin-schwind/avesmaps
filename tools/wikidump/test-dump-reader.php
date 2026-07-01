<?php

declare(strict_types=1);

/**
 * Fixture-based unit test for the streaming dump-reader SKELETON (WikiDump
 * migration, Task 3). Exercises the DB-FREE reader core against a small hand
 * written MediaWiki-export fixture (tools/wikidump/fixtures/mini-dump.xml):
 *
 *   - the streaming page iterator (title / ns / redirect / wikitext extraction),
 *   - multi-line wikitext capture,
 *   - namespace visibility (ns 10 is yielded too; filtering is the caller's job),
 *   - skip-to-cursor resume ($skipPages / $maxPages),
 *   - Pass A collect-only (redirect alias_slug => canonical_wiki_key), derived
 *     with the REAL slug/normalize/wiki_key functions (invariants I1/I7),
 *   - the compress.bzip2:// guard (clear RuntimeException when ext/bz2 is absent),
 *   - the compress.zlib:// path against a .gz copy of the fixture.
 *
 * NO database and NO STRATO are touched: the reader core is pure (XML stream ->
 * page arrays / redirect pairs); DB persistence lives in a separate thin layer
 * that this test never calls.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring caveat as Task 1's
 * test-wiki-key-derivation.php -- the reused derivation functions call
 * mb_strtolower()/mb_substr()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-reader.php
 *
 * (A plain `php tools/wikidump/test-dump-reader.php` works iff mbstring is
 * enabled globally.)
 *
 * Expected values are HAND-DERIVED against THIS runtime's real functions (the
 * umlaut/iconv outcome is environment-dependent -- see Task 1's banner), never
 * asserted equal to the function's own output. Exit code 0 iff every assert
 * passes; non-zero otherwise (so later steps can gate on it).
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: the reused derivation functions need mbstring. Fail loudly.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the dump reader requires XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the dump-reader lib + the real derivation libs it reuses.
//    All are side-effect-free on include (const + function defs, no DB/headers).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';

foreach ([
    'avesmapsWikiDumpOpenReader',
    'avesmapsWikiDumpIteratePages',
    'avesmapsWikiDumpCollectRedirectAliases',
    // reused real derivation functions (must be visible so Pass A can call them):
    'avesmapsPoliticalSlug',
    'avesmapsPoliticalBuildWikiKey',
    'avesmapsWikiSyncMonitorNormalizeTitle',
    'avesmapsWikiSyncMonitorStoreAlias',
] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Diagnostic banner -- record the environment (bz2/zlib availability + the
//    iconv umlaut behavior) so a future reader knows WHY expectations hold.
// ---------------------------------------------------------------------------
$bz2Loaded = extension_loaded('bz2');
$iconvSample = function_exists('iconv')
    ? (static function (string $s): string {
        $r = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        return is_string($r) ? $r : '(iconv false)';
    })('Königreich')
    : '(iconv unavailable)';

echo "================================================================\n";
echo " dump-reader skeleton unit test (WikiDump migration, Task 3)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'xmlreader loaded   : ' . (extension_loaded('xmlreader') ? 'yes' : 'no') . "\n";
echo 'zlib loaded        : ' . (extension_loaded('zlib') ? 'yes' : 'no') . "\n";
echo 'bz2 loaded         : ' . ($bz2Loaded ? 'yes' : 'no (bz2 path is STRATO-verified, see Task 2)') . "\n";
echo "iconv('Koenigreich') = '{$iconvSample}'  (umlaut outcome is env-dependent)\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-52s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-52s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// Helper: fully drain the iterator into an array of page rows.
$readAll = static function (string $path, int $skip = 0, ?int $max = null) : array {
    $reader = avesmapsWikiDumpOpenReader($path);
    $rows = [];
    foreach (avesmapsWikiDumpIteratePages($reader, $skip, $max) as $page) {
        $rows[] = $page;
    }
    $reader->close();
    return $rows;
};

// ===========================================================================
// (a) iterator yields the expected pages with correct title/ns/redirect/wikitext
// ===========================================================================
echo "-- (a) page iteration: count + per-page title/ns/redirect --\n";

$pages = $readAll($fixturePath);

$check('(a1) page count', 5, count($pages), 'fixture has 5 <page> elements (4 ns0 + 1 ns10)');

// Titles, in document order.
$titles = array_map(static fn(array $p): string => $p['title'], $pages);
$check(
    '(a2) titles in order',
    ['Kosch', 'Angbar', 'Horasreich', 'Königreich Kosch (historisch)', 'Vorlage:Infobox Staat'],
    $titles,
    'streamed in document order, titles intact (umlaut preserved)'
);

// Namespaces, in document order (proves <ns> is parsed as int, incl. ns 10).
$namespaces = array_map(static fn(array $p): int => $p['ns'], $pages);
$check(
    '(a3) namespaces in order',
    [0, 0, 0, 0, 10],
    $namespaces,
    'ns parsed as int; ns 10 (Vorlage) present -> filtering is the caller\'s job'
);

// Redirect targets: only the two redirect pages expose a non-null target.
$redirects = array_map(static fn(array $p): ?string => $p['redirect'], $pages);
$check(
    '(a4) redirect targets in order',
    [null, null, 'Lieblichesfeld', 'Kosch', null],
    $redirects,
    'only <redirect title="..."/> pages carry a target; others null'
);

// ===========================================================================
// (b) wikitext captured fully -- multi-line body intact
// ===========================================================================
echo "\n-- (b) wikitext extraction (multi-line intact) --\n";

$koschText = $pages[0]['wikitext'];
$check(
    '(b1) Kosch wikitext contains infobox opener',
    true,
    str_contains($koschText, '{{Infobox Staat'),
    'template call captured'
);
$check(
    '(b2) Kosch wikitext keeps line breaks (multi-line)',
    true,
    substr_count($koschText, "\n") >= 5,
    'multi-line body preserved (>=5 newlines across template + 2 paragraphs)'
);
$check(
    '(b3) Kosch wikitext keeps its FIRST line exactly',
    '{{Infobox Staat',
    strtok($koschText, "\n"),
    'first line of the <text> node preserved verbatim'
);
$check(
    '(b4) Kosch wikitext keeps its LAST paragraph',
    true,
    str_contains($koschText, 'Es liegt zwischen den [[Koschberge]]n.'),
    'final paragraph (after a blank line) captured -> no truncation'
);
$check(
    '(b5) Angbar wikitext is the Siedlung infobox body',
    true,
    str_contains($pages[1]['wikitext'], '{{Infobox Siedlung') && str_contains($pages[1]['wikitext'], 'Hauptstadt des [[Kosch]]'),
    'per-page text is not cross-contaminated between pages'
);

// ===========================================================================
// (c) redirect pages expose their target (already covered by a4; assert typed)
// ===========================================================================
echo "\n-- (c) redirect target exposure --\n";
$check(
    '(c1) Horasreich redirect target',
    'Lieblichesfeld',
    $pages[2]['redirect'],
    'plain-ASCII redirect target string'
);
$check(
    '(c2) Koenigreich Kosch (historisch) redirect target',
    'Kosch',
    $pages[3]['redirect'],
    'umlaut/parenthetical redirect page -> target "Kosch"'
);
$check(
    '(c3) non-redirect page has null target',
    null,
    $pages[0]['redirect'],
    'a normal content page carries redirect=null'
);

// ===========================================================================
// (d) Pass A collect-only: alias_slug => canonical_wiki_key
//     Hand-derived with the REAL functions (see banner for the derivation):
//       Horasreich                     -> alias_slug 'horasreich'
//                                          canonical  'wiki:lieblichesfeld'
//       Königreich Kosch (historisch)  -> alias_slug 'k-onigreich-kosch-historisch'
//                                          canonical  'wiki:kosch'
//     alias_slug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($redirectPageTitle))
//     canonical  = avesmapsPoliticalBuildWikiKey(<pageUrl(target)>, target) => 'wiki:'.slug(target)
// ===========================================================================
echo "\n-- (d) Pass A: redirect alias map (collect-only, no DB) --\n";

$aliasMap = avesmapsWikiDumpCollectRedirectAliases($readAll($fixturePath));

$check(
    '(d1) alias map size (2 redirects only)',
    2,
    count($aliasMap),
    'only the two <redirect> pages contribute; content/Vorlage pages do not'
);
$check(
    '(d2) plain alias slug -> canonical wiki_key',
    'wiki:lieblichesfeld',
    $aliasMap['horasreich'] ?? '(missing)',
    "slug('Horasreich')='horasreich' -> 'wiki:'.slug('Lieblichesfeld')"
);
$check(
    '(d3) umlaut+parenthetical alias slug -> canonical wiki_key',
    'wiki:kosch',
    $aliasMap['k-onigreich-kosch-historisch'] ?? '(missing)',
    "normalize keeps parenthetical; slug: umlaut 'oe'->'-o', parens+spaces->'-'"
);
// Independent re-derivation cross-check (proves the map used the real functions,
// not a hard-coded literal): rebuild the two expected keys via the real funcs.
$reAliasA = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Horasreich'));
$reCanonA = avesmapsPoliticalBuildWikiKey(AVESMAPS_WIKI_PAGE_BASE_URL . 'Lieblichesfeld', 'Lieblichesfeld');
$check(
    '(d4) collected value matches an independent real-function re-derivation',
    $reCanonA,
    $aliasMap[$reAliasA] ?? '(missing)',
    'Pass A output == real slug/normalize/wiki_key funcs (I1/I7), not a literal'
);

// ===========================================================================
// (e) skip-to-cursor resume: skip N then read yields the correct NEXT pages
// ===========================================================================
echo "\n-- (e) skip-to-cursor (resume batching) --\n";

$afterTwo = $readAll($fixturePath, 2); // skip Kosch + Angbar
$check(
    '(e1) skip 2 -> first remaining title',
    'Horasreich',
    $afterTwo[0]['title'] ?? '(none)',
    'skipping the first 2 pages resumes at the 3rd'
);
$check(
    '(e2) skip 2 -> remaining count',
    3,
    count($afterTwo),
    '5 total - 2 skipped = 3 remaining'
);

$batch = $readAll($fixturePath, 1, 2); // skip 1, take 2 -> pages [1,3)
$check(
    '(e3) skip 1 take 2 -> bounded batch titles',
    ['Angbar', 'Horasreich'],
    array_map(static fn(array $p): string => $p['title'], $batch),
    'a step processes pages [cursor, cursor+batch) then returns'
);

$skipAll = $readAll($fixturePath, 5);
$check(
    '(e4) skip >= total -> empty batch',
    0,
    count($skipAll),
    'skipping all pages yields nothing (terminal cursor)'
);

// ===========================================================================
// (f) compress wrappers: bz2 guard + zlib (.gz) path
// ===========================================================================
echo "\n-- (f) compression wrappers (bz2 guard / gz path) --\n";

if ($bz2Loaded) {
    // bz2 present locally: actually read a .bz2 copy of the fixture.
    $bz2Path = sys_get_temp_dir() . '/avesmaps-mini-dump-' . getmypid() . '.xml.bz2';
    $raw = (string) file_get_contents($fixturePath);
    file_put_contents($bz2Path, (string) bzcompress($raw));
    $bz2Pages = $readAll($bz2Path);
    @unlink($bz2Path);
    $check(
        '(f1) .bz2 read yields same page count',
        5,
        count($bz2Pages),
        'compress.bzip2:// streams the fixture (bz2 present locally)'
    );
    $check(
        '(f2) .bz2 first title matches',
        'Kosch',
        $bz2Pages[0]['title'] ?? '(none)',
        'bz2-decompressed stream parsed identically'
    );
} else {
    // bz2 absent locally (the common case): opening a .bz2 must throw a CLEAR
    // RuntimeException naming the missing extension -- never silently fall back.
    $threw = false;
    $message = '';
    try {
        avesmapsWikiDumpOpenReader('/nonexistent/whatever.xml.bz2');
    } catch (RuntimeException $e) {
        $threw = true;
        $message = $e->getMessage();
    }
    $check(
        '(f1) .bz2 without ext/bz2 throws RuntimeException',
        true,
        $threw,
        'no silent raw-byte fallback when bz2 is unavailable'
    );
    $check(
        '(f2) the RuntimeException names the missing bz2 extension',
        true,
        stripos($message, 'bz2') !== false,
        'error message is actionable (mentions bz2)'
    );
}

// zlib path: always testable (zlib is always present). Gzip the fixture and read.
$gzPath = sys_get_temp_dir() . '/avesmaps-mini-dump-' . getmypid() . '.xml.gz';
$rawXml = (string) file_get_contents($fixturePath);
file_put_contents($gzPath, (string) gzencode($rawXml, 6));
$gzPages = $readAll($gzPath);
@unlink($gzPath);
$check(
    '(f3) .gz read yields same page count',
    5,
    count($gzPages),
    'compress.zlib:// streams a gzipped fixture'
);
$check(
    '(f4) .gz redirect target survives decompression',
    'Lieblichesfeld',
    $gzPages[2]['redirect'] ?? '(none)',
    'gz-decompressed stream parsed identically to plain .xml'
);

// ===========================================================================
// (g) constant-memory sanity: iterating many times must not grow memory
//     unbounded (the stream is drained + freed each pass, not accumulated).
// ===========================================================================
echo "\n-- (g) streaming memory sanity --\n";
$before = memory_get_usage();
for ($i = 0; $i < 200; $i++) {
    $reader = avesmapsWikiDumpOpenReader($fixturePath);
    $seen = 0;
    foreach (avesmapsWikiDumpIteratePages($reader) as $ignored) {
        $seen++;
    }
    $reader->close();
    unset($reader);
}
$growth = memory_get_usage() - $before;
$check(
    '(g1) 200 full iterations do not leak (<512 KiB growth)',
    true,
    $growth < 512 * 1024,
    'generator streams; pages are not accumulated (growth=' . $growth . ' bytes)'
);

// ---------------------------------------------------------------------------
// 4. Summary + exit code.
// ---------------------------------------------------------------------------
$total = $passCount + $failCount;
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d/%d passing (%d failing)\n", $passCount, $total, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
