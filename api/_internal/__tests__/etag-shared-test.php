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
    preg_match(
        '/if \(\$ifNoneMatch !== \'\' && avesmapsETagMatches[^)]*\)\) \{\s*\n\s*avesmapsSendLocationsCacheHeaders\(\$etag\);\s*\n\s*http_response_code\(304\);\s*\n\s*exit;/',
        $endpointSource
    ) === 1,
    'a match names the tag, answers 304 and stops -- it does not fall through and build the answer anyway'
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

// --- 💣 The declaration must survive a half-deployed state ----------------------------------------
//
// The deploy writes file by file over SFTP -- no staging directory, no atomic rename -- and STRATO's
// opcache revalidates EACH FILE with a 2-4 minute lag. So bootstrap.php and map-features.php can be
// served from different generations for minutes. PHP binds top-level functions at COMPILE time, so an
// older map-features.php would have registered its own copy before its require of bootstrap ran, and
// "Cannot redeclare" strikes as E_COMPILE_ERROR -- before any try, so no catch, no error response, no
// CORS header: a blank 500 for every visitor on the busiest endpoint of the site. Reproduced against
// the shipped commit; the guard is what makes it not happen.
$bootstrapSource = file_get_contents(__DIR__ . '/../bootstrap.php');
assert(
    preg_match("/if \(!function_exists\('avesmapsETagMatches'\)\) \{\s*\nfunction avesmapsETagMatches/", $bootstrapSource) === 1,
    'the shared declaration is guarded, or a skewed deploy fatals the map endpoint'
);

// --- 💣 The tag goes out with the ANSWER, never before the work -----------------------------------
//
// avesmapsJsonResponse does not clear headers. A tag emitted before the 152-MB load also rides the 500
// that load can produce (max_user_connections, memory_limit, a PDO timeout) -- and anything that stores
// a body under its tag then revalidates and is told 304: "your copy is current", for an error body.
// It does not heal by itself, because map_revision does not move on its own.
$headerAt = strpos($endpointSource, 'avesmapsSendLocationsCacheHeaders($etag);');
assert(is_int($headerAt), 'the headers go out through one helper');
assert(
    substr_count($endpointSource, 'avesmapsSendLocationsCacheHeaders($etag);') === 2,
    'exactly twice: on the 304 and on the 200 -- both must name the same tag'
);
assert(
    !preg_match("/header\('ETag: ' \. \$etag\);\s*\n\s*header\('Cache-Control[^\n]*\n\s*header\('Vary/", $endpointSource),
    'no bare header block before the load any more'
);
$loadAt2 = strpos($endpointSource, 'avesmapsLoadRouteMapData(');
assert(
    strrpos($endpointSource, 'avesmapsSendLocationsCacheHeaders($etag);') > $loadAt2,
    'the 200 sets its headers after the load succeeded, not before it starts'
);

// One definition, in one place -- all three of them.
$mapFeaturesSource = file_get_contents(__DIR__ . '/../../app/map-features.php');
assert(
    !str_contains($mapFeaturesSource, 'function avesmapsETagMatches'),
    'the copy in the map endpoint is gone -- two would be a redeclare error, and a divergence besides'
);
// 💣 This one has to look at the CALL, not at the name: the pre-commit file contained the same call
// string, so an assert on the call alone stays green through a wholesale revert. What distinguishes
// "uses the shared one" from "carries its own" is that the definition is absent, asserted above -- and
// that the file loads bootstrap at all, asserted here.
assert(
    preg_match("/^require __DIR__ \. '\/\.\.\/_internal\/bootstrap\.php';/m", $mapFeaturesSource) === 1,
    'and it loads bootstrap, which is where the shared one lives'
);
// 💣 The THIRD copy. api/app/ecosystem-areas.php carried its own mirror, justified by the very reason
// this move removed ("that one lives inside an endpoint file whose request handler would run on
// include") -- and its comment pointed at a line that no longer holds the function. Three copies of a
// comparison rule drift exactly as reliably as two.
$ecosystemSource = file_get_contents(__DIR__ . '/../../app/ecosystem-areas.php');
assert(
    preg_match('/function avesmapsEcosystemETagMatches\([^)]*\): bool\s*\n\{\s*\n\s*return avesmapsETagMatches\(\$ifNoneMatch, \$etag\);\s*\n\}/', $ecosystemSource) === 1,
    'the ecosystem endpoint delegates instead of mirroring'
);
assert(
    !str_contains($ecosystemSource, '$normalize($candidate) === $target'),
    'and keeps no second implementation of the rule'
);

echo "etag-shared ok\n";
