<?php

declare(strict_types=1);

/**
 * Finding A23, fourth state: the config handed IN is used, and the file is not read a second time.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/visitor-salt-primed-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 Its own process, for the same reason as the other three: avesmapsVisitorSalt() caches in a
 * static, so "loader used" and "loader not used" cannot both be observed once one of them happened.
 * Four small processes beat one file that tests a quarter of the states and asserts the rest from
 * source text.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// A loader that COUNTS but must never be reached: priming is supposed to make it unnecessary.
$GLOBALS['avesmapsTestConfigLoads'] = 0;

function avesmapsApiRoot(): string {
    return __DIR__;
}

function avesmapsLoadApiConfig(string $apiDirectory): array {
    $GLOBALS['avesmapsTestConfigLoads']++;

    return ['analytics' => ['visitor_salt' => 'salt-aus-der-datei']];
}

require __DIR__ . '/../visitor-analytics.php';

// What an endpoint does: it already holds the config, so it hands it on.
avesmapsVisitorSaltPrimedConfig(['analytics' => ['visitor_salt' => 'salt-vom-endpunkt']]);

assert(avesmapsVisitorSalt() === 'salt-vom-endpunkt', 'the handed-in config is what answers');
// 💣 The point of the exercise. avesmapsLoadApiConfig uses `require`, not `require_once`, so calling
// it again really re-executes api/config.local.php -- on a beacon per page view and a ping per
// minute per visitor. If this ever goes above zero, that cost is back.
assert($GLOBALS['avesmapsTestConfigLoads'] === 0, 'and the config file is not read a second time');

$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Test)';
assert(
    avesmapsVisitorDailyHash() === hash('sha256', gmdate('Ymd') . '|salt-vom-endpunkt|203.0.113.7|Mozilla/5.0 (Test)'),
    'the digest is built from the handed-in salt'
);
assert($GLOBALS['avesmapsTestConfigLoads'] === 0, 'hashing does not reach for the file either');
assert(avesmapsVisitorSaltIsConfigured() === true, 'and the installation reports itself as configured');

// ⚠️ A primed config WITHOUT the key is an answer too -- "this installation has no salt configured"
// -- and must not fall through to reading the file, or priming would silently stop saving anything
// on exactly the installations that have not set one. That is the common case, not the rare one.
$source = file_get_contents(__DIR__ . '/../visitor-analytics.php');
assert(
    preg_match('/\$primed !== null\)\s*\{[\s\S]{0,400}return \$resolved = AVESMAPS_VISITOR_SALT_FALLBACK;\s*\n\s*\}/', $source) === 1,
    'a primed config without the key answers with the default instead of re-reading the file'
);

// 💣 And priming must not be a CONTRACT. An endpoint that forgets it has to get the old behaviour,
// not a broken one -- that is what makes this a saving rather than a new way to break the site. The
// state is covered by visitor-salt-config-test.php, which primes nothing and still resolves.
assert(
    str_contains($source, 'function avesmapsVisitorSaltPrimedConfig(?array $config = null): ?array'),
    'priming is optional by signature'
);

// --- The endpoints have to actually hand it on ----------------------------------------------------
//
// ⚠️ Asserted over the source, and that is not laziness here: whether a REQUEST reads the config file
// once or twice cannot be observed from a test process, because the endpoints are scripts that run
// their handler on include. What can be pinned is that the call exists and sits after the load --
// and without this, removing it from an endpoint passes every other assert in these four files
// while quietly restoring the double read. Verified: it did.
foreach (['track.php', 'heartbeat.php', 'visitor-metrics.php'] as $endpoint) {
    $endpointSource = file_get_contents(__DIR__ . '/../../../app/' . $endpoint);
    assert(is_string($endpointSource) && $endpointSource !== '', "{$endpoint} is readable");
    $loadAt = strpos($endpointSource, '$config = avesmapsLoadApiConfig(avesmapsApiRoot());');
    $primeAt = strpos($endpointSource, 'avesmapsVisitorSaltPrimedConfig($config);');
    assert(is_int($loadAt) && is_int($primeAt), "{$endpoint} loads the config and hands it on");
    assert($loadAt < $primeAt, "{$endpoint} hands on the config it just loaded, not something earlier");
    // One load per request is the premise of the whole exercise.
    assert(
        substr_count($endpointSource, 'avesmapsLoadApiConfig(') === 1,
        "{$endpoint} loads the config exactly once itself"
    );
}

echo "visitor-salt-primed ok\n";
