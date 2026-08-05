<?php

declare(strict_types=1);

/**
 * Finding A23: the salt behind the daily visitor hash was published in the repository AND could not
 * be overridden on this server. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/visitor-salt-test.php
 * Exit 0 = all asserts passed.
 *
 * This half runs with NOTHING overriding the salt -- the state every installation was in. The other
 * half needs a constant defined before the file loads, and a constant cannot be redefined, so it
 * lives in its own process: visitor-salt-override-test.php next door.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../visitor-analytics.php';

// --- With no override, the shipped default answers -- and says so ---------------------------------
assert(
    avesmapsVisitorSalt() === AVESMAPS_VISITOR_SALT_FALLBACK,
    'without an override the shipped salt is used'
);
// 💣 The default MUST stay what it always was. Changing that string would invalidate every hash
// already stored: a returning visitor counts as new and the daily figures step, silently.
assert(
    AVESMAPS_VISITOR_SALT_FALLBACK === 'avesmaps-visitor-salt-override-me',
    'the shipped default is unchanged -- changing it rewrites history'
);
// ⚠️ And the surface can tell the difference. The privacy notice claims the visitor id is not
// reversible; with the published salt it is, in seconds, because an IPv4 address space is small
// enough to walk. Something has to be able to say which of the two states this installation is in.
assert(
    avesmapsVisitorSaltIsConfigured() === false,
    'an installation running the published salt reports itself as unconfigured'
);

// --- The hash still behaves like a hash -----------------------------------------------------------
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Test)';
$first = avesmapsVisitorDailyHash();
assert(preg_match('/^[0-9a-f]{64}$/', $first) === 1, 'a sha256 hex digest comes back');
assert(avesmapsVisitorDailyHash() === $first, 'the same visitor on the same day hashes the same');

$_SERVER['REMOTE_ADDR'] = '203.0.113.8';
assert(avesmapsVisitorDailyHash() !== $first, 'a different address hashes differently');

$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Other)';
assert(avesmapsVisitorDailyHash() !== $first, 'a different user agent hashes differently');

// 💣 The salt has to reach the digest. A resolver that is called and then ignored would pass every
// assert above -- so the digest is recomputed here the way the function builds it, and compared.
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Test)';
$expected = hash('sha256', gmdate('Ymd') . '|' . avesmapsVisitorSalt() . '|203.0.113.7|Mozilla/5.0 (Test)');
assert(avesmapsVisitorDailyHash() === $expected, 'the resolved salt is what the digest is built from');
// And with the OTHER salt it must not match -- otherwise the salt is decorative.
$otherSalt = hash('sha256', gmdate('Ymd') . '|ein-anderer-salt|203.0.113.7|Mozilla/5.0 (Test)');
assert(avesmapsVisitorDailyHash() !== $otherSalt, 'a different salt yields a different digest');

// --- 💣 The identity of the client is REMOTE_ADDR, not a header -----------------------------------
//
// Unlike the throttle key (A29), this one never looked at X-Forwarded-For, and it must not start:
// a caller who can choose their own visitor id can inflate or hide themselves in the figures at will.
$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.9';
assert(avesmapsVisitorDailyHash() === $expected, 'a forwarded-for header does not change the visitor id');
unset($_SERVER['HTTP_X_FORWARDED_FOR']);

$source = file_get_contents(__DIR__ . '/../visitor-analytics.php');
assert(is_string($source) && $source !== '', 'the source is readable');
assert(
    !str_contains($source, 'HTTP_X_FORWARDED_FOR'),
    'the analytics client address is REMOTE_ADDR alone'
);

// --- The override point exists and is the conventional one ----------------------------------------
//
// 💣 `if (!defined(...))` LOOKED like an override point and was not one on this server: the constant
// is fixed the moment this file is required, while api/config.local.php -- the only place a
// deployment can keep a secret -- is read lazily by avesmapsLoadApiConfig() inside the request
// handler, long afterwards. Every installation therefore ran the published salt.
assert(
    str_contains($source, "\$config['analytics']['visitor_salt']"),
    'the salt can come from the gitignored config, in the shape the project uses for secrets'
);
// ⚠️ Guarded and wrapped: five endpoints require this file, and an analytics helper must never be
// the reason one of them dies. An unreadable config falls through to the default.
assert(
    str_contains($source, "function_exists('avesmapsLoadApiConfig')")
        && str_contains($source, 'catch (Throwable)'),
    'a missing or broken config falls back instead of throwing'
);
// The digest must go through the resolver, not the constant it replaced.
assert(
    str_contains($source, "gmdate('Ymd') . '|' . avesmapsVisitorSalt()"),
    'the hash reads the resolver'
);
assert(
    !preg_match("/'\|' \. AVESMAPS_VISITOR_SALT\b/", $source),
    'and no longer the constant -- that was the unoverridable path'
);

// --- The state has to be VISIBLE, or it is a fact nobody can check --------------------------------
//
// 💣 A resolver nothing reads from is a promise with no way to verify it. avesmapsVisitorSaltIsConfigured
// answers the only question that matters here -- is this installation still running the published
// salt? -- and it is wired into the metrics endpoint, which sits behind the `edit` capability, so the
// answer reaches an editor and nobody else.
$metricsSource = file_get_contents(__DIR__ . '/../../../app/visitor-metrics.php');
assert(is_string($metricsSource) && $metricsSource !== '', 'the metrics endpoint is readable');
assert(
    str_contains($metricsSource, "'salt_configured' => avesmapsVisitorSaltIsConfigured(),"),
    'the metrics answer reports whether the salt is still the published one'
);
// ⚠️ And it must stay behind the capability gate: this says something about how protected the
// visitor data is, which is not an anonymous caller's business.
assert(
    strpos($metricsSource, "avesmapsRequireUserWithCapability('edit')") < strpos($metricsSource, "'salt_configured'"),
    'and it is only answered to a caller that passed the capability gate'
);

echo "visitor-salt ok\n";
