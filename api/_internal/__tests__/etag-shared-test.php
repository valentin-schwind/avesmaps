<?php

declare(strict_types=1);

/**
 * The shared conditional-request helper, and the locations endpoint that now uses it (finding A14).
 * No DB, no HTTP. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/etag-shared-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

// ===== WHY THIS HELPER IS SHARED =====
// api/app/map-features.php and api/locations/index.php both answer conditional requests, and the
// matcher lived in the FIRST of those -- which is a script, not a library. api/locations/ could only
// have obtained it by requiring map-features.php, i.e. by running the whole map response. The other
// way out was a second copy, and two copies of a comparison rule drift. It lives in bootstrap now.

assert(function_exists('avesmapsETagMatches'), 'the matcher is available to every endpoint');

$etag = 'W/"loc-1-4711"';

// The plain cases.
assert(avesmapsETagMatches('W/"loc-1-4711"', $etag), 'an identical weak tag matches');
assert(avesmapsETagMatches('"loc-1-4711"', $etag), 'and so does the same tag without the W/ prefix');
assert(!avesmapsETagMatches('W/"loc-1-4712"', $etag), 'a different revision does not match');
assert(!avesmapsETagMatches('', $etag), 'an empty header matches nothing');

// If-None-Match may be a LIST, and a browser that has seen two revisions sends one.
assert(avesmapsETagMatches('W/"loc-1-4710", W/"loc-1-4711"', $etag), 'a list matches on any member');
assert(avesmapsETagMatches('W/"loc-1-4711",W/"loc-1-4712"', $etag), 'with or without spaces');
assert(!avesmapsETagMatches('W/"loc-1-4709", W/"loc-1-4710"', $etag), 'a list of misses is a miss');

// "*" means "any representation you have".
assert(avesmapsETagMatches('*', $etag), 'the wildcard matches');
assert(avesmapsETagMatches('  *  ', $etag), 'even padded');

// 💣 A near-miss must NOT match: answering 304 for a tag that is merely similar hands the caller a
// stale body it can never correct.
assert(!avesmapsETagMatches('W/"loc-1-471"', $etag), 'a prefix is not a match');
assert(!avesmapsETagMatches('W/"loc-1-47110"', $etag), 'nor is a longer tag');
assert(!avesmapsETagMatches('loc-1-4711', $etag), 'nor the value without its quotes');

// --- The locations endpoint: the check comes BEFORE the expensive load ----------------------------
//
// 💣 That order is the entire point. This endpoint builds the whole route network -- the path
// api/route/index.php measures at "62 MB resident, peak 152 MB per call" and for which six diagnostic
// endpoints were put behind permissions. Answering 304 afterwards would save the transfer and none of
// the cost; answering it first reduces a conditional request to one row out of map_revision.
$endpointSource = file_get_contents(__DIR__ . '/../../locations/index.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'the endpoint source is readable');

$etagAt = strpos($endpointSource, "avesmapsETagMatches(\$ifNoneMatch, \$etag)");
$loadAt = strpos($endpointSource, 'avesmapsLoadRouteMapData(');
$networkAt = strpos($endpointSource, 'avesmapsBuildRouteNetworkData(');
assert(is_int($etagAt) && is_int($loadAt) && is_int($networkAt), 'all three steps are present');
assert($etagAt < $loadAt, 'the conditional check runs before the map data is loaded');
assert($loadAt < $networkAt, 'and the load still precedes the network build');
assert(
    preg_match('/if \(\$ifNoneMatch !== \'\' && avesmapsETagMatches[^)]*\)\) \{\s*\n\s*http_response_code\(304\);\s*\n\s*exit;/', $endpointSource) === 1,
    'a match answers 304 and stops -- it does not fall through and build the answer anyway'
);

// The revision is read with its own small query, and the connection is handed on rather than opened
// twice: this host has a max_user_connections limit, and the finding is about load.
assert(
    str_contains($endpointSource, 'avesmapsFetchRouteMapRevision($pdo)'),
    'the revision comes from one small query'
);
assert(
    str_contains($endpointSource, 'avesmapsLoadRouteMapData($config, $pdo)'),
    'and that same connection is passed on, not a second one opened'
);
assert(
    substr_count($endpointSource, 'avesmapsCreatePdo(') === 1,
    'exactly one connection is opened per request'
);

// 💣 The payload version is part of the tag. Without it, a caller holding an ETag keeps its old copy
// through a 304 and never sees a changed response SHAPE -- which is exactly what happened to the map
// endpoint when `political` was added to it.
assert(
    str_contains($endpointSource, 'AVESMAPS_LOCATIONS_PAYLOAD_VERSION'),
    'the response shape is versioned into the tag'
);
assert(
    preg_match('/W\/"loc-\' \. AVESMAPS_LOCATIONS_PAYLOAD_VERSION \. \'-\' \. \$revision/', $endpointSource) === 1,
    'and the tag is built from version plus revision, nothing else -- the answer depends on nothing else'
);

// Cache-Control must force revalidation: the response changes whenever the map does, and a caller that
// caches it blind would serve a stale world.
assert(
    str_contains($endpointSource, "Cache-Control: no-cache, must-revalidate"),
    'the answer is revalidated every time, and 304 is what makes that cheap'
);

// --- The loader's new parameter must not change any existing caller -------------------------------
$mapDataSource = file_get_contents(__DIR__ . '/../routing/map-data.php');
assert(
    preg_match('/function avesmapsLoadRouteMapData\(array \$config, \?PDO \$pdo = null\): array/', $mapDataSource) === 1,
    'the connection parameter is optional, so every existing caller is untouched'
);
assert(
    str_contains($mapDataSource, '$pdo = $pdo ?? avesmapsCreatePdo('),
    'and a caller that passes none still gets one'
);

// One definition, in one place.
$mapFeaturesSource = file_get_contents(__DIR__ . '/../../app/map-features.php');
assert(
    !str_contains($mapFeaturesSource, 'function avesmapsETagMatches'),
    'the copy in the map endpoint is gone -- two would be a redeclare error, and a divergence besides'
);
assert(
    str_contains($mapFeaturesSource, 'avesmapsETagMatches($ifNoneMatch, $etag)'),
    'and that endpoint still uses the shared one'
);

echo "etag-shared ok\n";
