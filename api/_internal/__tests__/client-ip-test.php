<?php

declare(strict_types=1);

/**
 * Finding A29: the key every throttle in the house buckets by came straight out of a request header,
 * unchecked. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/client-ip-test.php
 * Exit 0 = all asserts passed.
 *
 * avesmapsClientIpAddress reads only $_SERVER, so this is a real behavioural test rather than an
 * assertion about source text -- the whole function can be exercised by setting two keys.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$ipFor = static function (?string $forwardedFor, ?string $remoteAddress): string {
    unset($_SERVER['HTTP_X_FORWARDED_FOR'], $_SERVER['REMOTE_ADDR']);
    if ($forwardedFor !== null) {
        $_SERVER['HTTP_X_FORWARDED_FOR'] = $forwardedFor;
    }
    if ($remoteAddress !== null) {
        $_SERVER['REMOTE_ADDR'] = $remoteAddress;
    }

    return avesmapsClientIpAddress();
};

// --- The ordinary cases ---------------------------------------------------------------------------
assert($ipFor(null, '203.0.113.7') === '203.0.113.7', 'no header: the peer address is the key');
assert($ipFor(null, '2001:db8::1') === '2001:db8::1', 'IPv6 counts as an address');
assert($ipFor('198.51.100.9', '203.0.113.7') === '198.51.100.9', 'a valid forwarded address is used');
assert($ipFor('  198.51.100.9  ', '203.0.113.7') === '198.51.100.9', 'padding is trimmed');
assert($ipFor('198.51.100.9, 203.0.113.7', '10.0.0.1') === '198.51.100.9', 'a list still uses the leftmost VALID one');

// --- 💣 The finding: an unvalidated header was a free bucket ---------------------------------------
//
// The old version returned whatever the leftmost element was, cut to 64 characters. A different
// string per request was a different bucket, so five reports per hour meant five per REQUEST for
// anyone who noticed. Junk is skipped now, and the caller falls back to their own peer address --
// which is exactly the one they were trying not to be counted under.
assert($ipFor('not-an-ip', '203.0.113.7') === '203.0.113.7', 'junk in the header falls back to the real peer');
assert($ipFor('<script>alert(1)</script>', '203.0.113.7') === '203.0.113.7', 'and so does markup');
assert($ipFor(str_repeat('a', 64), '203.0.113.7') === '203.0.113.7', 'and a 64-character filler');
assert($ipFor('999.999.999.999', '203.0.113.7') === '203.0.113.7', 'a number-shaped non-address is still not an address');

// 💣 The property that turns the bypass off: two DIFFERENT junk values must land in the SAME bucket.
// Under the old code they were two buckets, which is what made the throttle optional.
assert(
    $ipFor('junk-one', '203.0.113.7') === $ipFor('junk-two', '203.0.113.7'),
    'two different forged headers no longer buy two different buckets'
);

// A list of junk followed by a real address uses the real one rather than giving up.
assert($ipFor('junk, 198.51.100.9', '203.0.113.7') === '198.51.100.9', 'the first VALID element wins, not the first element');

// --- The privacy half -----------------------------------------------------------------------------
//
// ⚠️ ip_hash is hash_hmac over this return value. While it could be arbitrary text, the column was
// not the hash of an address at all -- which is not what a schema reader looking for a privacy answer
// would conclude from its name.
assert(filter_var($ipFor('198.51.100.9', '203.0.113.7'), FILTER_VALIDATE_IP) !== false, 'what gets hashed is an address');
assert(filter_var($ipFor(null, '203.0.113.7'), FILTER_VALIDATE_IP) !== false, 'on the fallback path too');

// --- The unknown case is grouped, not scattered ---------------------------------------------------
//
// ⚠️ Empty is deliberate and is the SAFE direction: everyone whose address cannot be established
// shares one bucket. Returning the junk instead would hand each of them a private one.
assert($ipFor(null, 'not-an-ip') === '', 'an unusable peer address yields no key rather than a junk key');
assert($ipFor(null, null) === '', 'and a missing one likewise');
assert($ipFor('junk', 'also-junk') === '', 'junk on both sides collapses to the same empty bucket');

// --- 💣 What this change deliberately does NOT do -------------------------------------------------
//
// A syntactically valid address the caller does not own is still believed. Closing that means
// deciding whether X-Forwarded-For may be trusted at all, which depends on whether a reverse proxy
// sits in front: with one, REMOTE_ADDR is identical for every visitor, and switching to it would put
// the whole site into a single bucket and lock everyone out after five reports. That question is open
// and belongs to the owner. This assert states the remaining hole so it cannot be forgotten -- it is
// meant to CHANGE when that decision lands, not to be quietly deleted.
assert(
    $ipFor('198.51.100.9', '203.0.113.7') === '198.51.100.9',
    'a forged but well-formed address is still trusted -- the open half of A29'
);

echo "client-ip ok\n";
