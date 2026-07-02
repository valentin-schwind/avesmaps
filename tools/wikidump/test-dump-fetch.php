<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the dump PROCUREMENT layer (WikiDump migration,
 * Task 5a): api/_internal/wiki/dump-fetch.php.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS DELIBERATELY SMALL
 * ---------------------------------------------------------------------------
 * Task 5a is the first "sharp" task: the real behaviour (an outbound HTTPS
 * download from Wiki Aventurica, a STRATO MySQL settings row) is NOT locally
 * testable and MUST NOT be faked. So this test exercises ONLY the genuinely
 * offline-decidable pure helpers -- it mocks NEITHER curl NOR MySQL:
 *
 *   1. avesmapsWikiDumpCacheIsFresh()      -- the 24 h cache-age decision.
 *   2. avesmapsWikiDumpLooksLikeBzip2()    -- the bz2 magic-byte ("BZh") sniff.
 *   3. avesmapsWikiDumpBuildStatusShape()  -- proves the status/result shape can
 *                                             NEVER carry a password field.
 *   4. Storage-path constants/helpers      -- fixed filename (no traversal),
 *                                             correct .bz2 extension for the reader.
 *
 * The DB and network paths (avesmapsWikiDumpFetch / *Credentials / *Status with a
 * real PDO) are covered by the LIVE VERIFICATION RECIPE the owner runs on STRATO
 * (see the Task 5a report), because pretending to exercise them here would be a
 * fake integration test.
 *
 * Include purity is also asserted: requiring dump-fetch.php performs no DB
 * connect, no download and emits no output (only const + function definitions).
 *
 * Exit code 0 iff every assertion passes.
 */

// ---------------------------------------------------------------------------
// 1. Runtime guards (mirror the other tools/wikidump tests).
// ---------------------------------------------------------------------------
$mbstringLoaded = extension_loaded('mbstring');
if (!$mbstringLoaded) {
    // dump-fetch.php uses mb_strlen() in the credential-length guard. The pure
    // helpers under test here do not, but keep the same guard shape as the sibling
    // tests for consistency and to keep any future mb_* additions honest.
    fwrite(STDERR, "WARN: mbstring is not loaded; credential-length paths use mb_strlen().\n");
    fwrite(STDERR, "      The pure helpers under test do not need it; continuing.\n");
    fwrite(STDERR, "      For full parity re-run with: php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n\n");
}

$repoRoot = dirname(__DIR__, 2);
$libPath = $repoRoot . '/api/_internal/wiki/dump-fetch.php';
if (!is_file($libPath)) {
    fwrite(STDERR, "FATAL: library not found: {$libPath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Include purity: no output, no fatal, defines the expected functions.
// ---------------------------------------------------------------------------
ob_start();
require $libPath;
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpCacheIsFresh',
    'avesmapsWikiDumpLooksLikeBzip2',
    'avesmapsWikiDumpBuildStatusShape',
    'avesmapsWikiDumpStoragePath',
    'avesmapsWikiDumpStorageDir',
    'avesmapsWikiDumpFetch',
    'avesmapsWikiDumpStatus',
    'avesmapsWikiDumpGetCredentials',
    'avesmapsWikiDumpSetCredentials',
    'avesmapsWikiDumpEnsureSettings',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-fetch.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-54s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-54s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-fetch procurement PURE-logic test (WikiDump migration, 5a)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . ($mbstringLoaded ? 'yes' : 'no') . "\n";
echo 'curl loaded        : ' . (extension_loaded('curl') ? 'yes' : 'no (network path is STRATO-verified, see report)') . "\n";
echo 'pdo_mysql loaded   : ' . (extension_loaded('pdo_mysql') ? 'yes' : 'no (DB path is STRATO-verified, see report)') . "\n";
echo "----------------------------------------------------------------\n\n";

// ===========================================================================
// (0) include purity
// ===========================================================================
echo "-- (0) include purity --\n";
$check('(0a) include emits no output', '', $includeOutput, 'requiring dump-fetch.php prints nothing (side-effect-free include)');

// ===========================================================================
// (a) cache-age decision -- the 24 h rule
// ===========================================================================
echo "\n-- (a) avesmapsWikiDumpCacheIsFresh: 24 h cache rule --\n";
$now = 1_700_000_000; // arbitrary fixed "now"
$ttl = AVESMAPS_WIKI_DUMP_CACHE_TTL_SECONDS;

$check('(a1) TTL constant is 24 h', 86400, $ttl, 'cache TTL is exactly 24 hours');
$check('(a2) absent file -> not fresh', false, avesmapsWikiDumpCacheIsFresh(null, $now, false), 'no local file => must download');
$check('(a3) force overrides fresh file', false, avesmapsWikiDumpCacheIsFresh($now - 10, $now, true), 'force_refresh always re-downloads even for a brand-new file');
$check('(a4) 1 s old -> fresh', true, avesmapsWikiDumpCacheIsFresh($now - 1, $now, false), 'a 1-second-old dump is reused');
$check('(a5) 23 h 59 m old -> fresh', true, avesmapsWikiDumpCacheIsFresh($now - ($ttl - 60), $now, false), 'just under 24 h is still fresh');
$check('(a6) exactly 24 h old -> stale', false, avesmapsWikiDumpCacheIsFresh($now - $ttl, $now, false), 'at the TTL boundary the cache is stale (re-download)');
$check('(a7) 25 h old -> stale', false, avesmapsWikiDumpCacheIsFresh($now - ($ttl + 3600), $now, false), 'well past 24 h => re-download');
$check('(a8) future mtime (clock skew) -> fresh', true, avesmapsWikiDumpCacheIsFresh($now + 5000, $now, false), 'a future mtime is treated as age 0 (fresh), never a negative age');

// ===========================================================================
// (b) bz2 magic-byte sniff
// ===========================================================================
echo "\n-- (b) avesmapsWikiDumpLooksLikeBzip2: BZh magic bytes --\n";
$check('(b1) real bz2 header accepted', true, avesmapsWikiDumpLooksLikeBzip2("BZh91AY&SY"), 'a genuine bzip2 stream starts with "BZh"');
$check('(b2) exactly "BZh" accepted', true, avesmapsWikiDumpLooksLikeBzip2('BZh'), 'the 3 magic bytes alone pass the sniff');
$check('(b3) HTML error page rejected', false, avesmapsWikiDumpLooksLikeBzip2('<!DOCTYPE html>'), 'a 200 HTML error page is not a dump');
$check('(b4) gzip magic rejected', false, avesmapsWikiDumpLooksLikeBzip2("\x1f\x8b\x08"), 'gzip (1f 8b) is not bzip2');
$check('(b5) empty body rejected', false, avesmapsWikiDumpLooksLikeBzip2(''), 'an empty transfer is not a dump');
$check('(b6) plain XML rejected', false, avesmapsWikiDumpLooksLikeBzip2('<mediawiki'), 'an uncompressed XML body is not the expected .bz2');

// ===========================================================================
// (c) response / status shape can never carry a password
// ===========================================================================
echo "\n-- (c) avesmapsWikiDumpBuildStatusShape: no password field --\n";
$status = avesmapsWikiDumpBuildStatusShape(
    ['present' => true, 'size' => 40_000_000, 'age_seconds' => 3600, 'mtime' => $now - 3600],
    'Gareth',
    '2026-07-02 06:00:00.000',
    '2026-07-02 06:00:00.000'
);
$statusKeys = array_keys($status);
sort($statusKeys);

$check('(c1) status has no "password" key', false, array_key_exists('password', $status), 'the status shape must never expose the password');
$check('(c2) status exposes username (prefill)', 'Gareth', $status['username'] ?? null, 'username IS exposed for the "last used" prefill');
$check('(c3) status url is the dump url', AVESMAPS_WIKI_DUMP_URL, $status['url'] ?? null, 'status reports the fixed dump URL');
$check('(c4) status keys are exactly the expected safe set', ['age_seconds', 'last_fetch_at', 'last_ok_at', 'present', 'size', 'ttl_seconds', 'url', 'username'], $statusKeys, 'only known, credential-free keys are present');

// Serialise the whole shape and make sure a plausible password string cannot
// appear (belt-and-suspenders against an accidental future field).
$statusJson = json_encode($status, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$check('(c5) serialised status contains no "password"', false, str_contains((string) $statusJson, 'password'), 'the JSON-encoded status never contains the substring "password"');
$check('(c6) serialised status contains no seed secret', false, str_contains((string) $statusJson, AVESMAPS_WIKI_DUMP_DEFAULT_PASSWORD), 'the default seed password never leaks into the status JSON');

// ===========================================================================
// (d) storage path: fixed filename (no traversal) + reader-compatible extension
// ===========================================================================
echo "\n-- (d) storage path & constants --\n";
$storagePath = avesmapsWikiDumpStoragePath();
$storageDir = avesmapsWikiDumpStorageDir();

$check('(d1) filename constant is fixed', 'dewa_dump_small.xml.bz2', AVESMAPS_WIKI_DUMP_FILENAME, 'the on-disk filename is a fixed constant -> no path traversal');
$check('(d2) storage path ends with the fixed filename', true, str_ends_with($storagePath, '/uploads/dumps/dewa_dump_small.xml.bz2'), 'the dump lands under uploads/dumps/ with the fixed name');
$check('(d3) storage path has .bz2 extension', 'bz2', strtolower(pathinfo($storagePath, PATHINFO_EXTENSION)), 'the reader keys on .bz2 to pick compress.bzip2://');
$check('(d4) path is inside the storage dir', true, str_starts_with($storagePath, $storageDir . '/'), 'the fixed-name path can never escape the storage directory');
$check('(d5) no ".." in the storage path', false, str_contains($storagePath, '..'), 'no parent-directory traversal in the resolved path');
$check('(d6) subdir constant is uploads/dumps', 'uploads/dumps', AVESMAPS_WIKI_DUMP_STORAGE_SUBDIR, 'storage subdir is the protected uploads/dumps area');
$check('(d7) URL is the German small dump over https', true, str_starts_with(AVESMAPS_WIKI_DUMP_URL, 'https://') && str_contains(AVESMAPS_WIKI_DUMP_URL, 'dewa_dump_small.xml.bz2'), 'fetch targets the verified https dewa_ URL');

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
