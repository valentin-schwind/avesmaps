<?php

declare(strict_types=1);

/**
 * Unit test for the pure half of the SSRF guard (Spec §1.4). No DB, no HTTP, no DNS. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/linkcheck/__tests__/link-url-test.php
 * Exit 0 = all asserts passed.
 *
 * Requiring probe.php only DEFINES functions -- it opens no socket. The host classifier is covered for
 * IP literals (no DNS) plus the RFC-2606 .invalid TLD, which can never resolve -- so the test stays
 * deterministic offline as well.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../probe.php';
require __DIR__ . '/../state.php';

// ---- scheme gate: only real web URLs are probeable ------------------------------------------------
assert(avesmapsLinkCheckIsProbeableUrl('https://www.f-shop.de/produkt/123') === true);
assert(avesmapsLinkCheckIsProbeableUrl('http://example.com') === true);
assert(avesmapsLinkCheckIsProbeableUrl('https://de.wiki-aventurica.de/wiki/Gareth') === true);
// Scheme is case-insensitive per RFC 3986.
assert(avesmapsLinkCheckIsProbeableUrl('HTTPS://EXAMPLE.COM/x') === true);

// Everything that is not http(s) is refused -- file:// and gopher:// are the classic SSRF/LFI vectors.
foreach ([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'file://C:/windows/win.ini',
    'gopher://example.com:70/x',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'dict://localhost:11211/stat',
] as $url) {
    assert(avesmapsLinkCheckIsProbeableUrl($url) === false);
}

// Malformed / hostless input is refused rather than guessed at.
foreach (['', '   ', 'not a url', '//example.com/x', 'https://', 'http:///x'] as $url) {
    assert(avesmapsLinkCheckIsProbeableUrl($url) === false);
}

// ---- IP gate: the ranges that must never be reached -----------------------------------------------
// Loopback.
assert(avesmapsLinkCheckIsBlockedIp('127.0.0.1') === true);
assert(avesmapsLinkCheckIsBlockedIp('127.1.2.3') === true);
assert(avesmapsLinkCheckIsBlockedIp('::1') === true);

// RFC1918 private space.
foreach (['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255'] as $ip) {
    assert(avesmapsLinkCheckIsBlockedIp($ip) === true);
}

// Link-local. 169.254.169.254 is the cloud metadata endpoint -- the single most valuable SSRF target.
assert(avesmapsLinkCheckIsBlockedIp('169.254.169.254') === true);
assert(avesmapsLinkCheckIsBlockedIp('169.254.0.1') === true);
assert(avesmapsLinkCheckIsBlockedIp('fe80::1') === true);

// CGNAT (100.64.0.0/10). PHP's FILTER_FLAG_NO_PRIV_RANGE|NO_RES_RANGE does NOT cover this range, so it
// needs its own check -- that is exactly why this test exists.
assert(avesmapsLinkCheckIsBlockedIp('100.64.0.1') === true);
assert(avesmapsLinkCheckIsBlockedIp('100.100.100.100') === true);
assert(avesmapsLinkCheckIsBlockedIp('100.127.255.255') === true);

// IPv6 unique-local + unspecified.
assert(avesmapsLinkCheckIsBlockedIp('fd00::1') === true);
assert(avesmapsLinkCheckIsBlockedIp('::') === true);
assert(avesmapsLinkCheckIsBlockedIp('0.0.0.0') === true);

// Garbage is blocked, never waved through.
foreach (['', 'not-an-ip', '999.999.999.999', '127.0.0'] as $ip) {
    assert(avesmapsLinkCheckIsBlockedIp($ip) === true);
}

// ---- and the public internet stays reachable ------------------------------------------------------
foreach (['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] as $ip) {
    assert(avesmapsLinkCheckIsBlockedIp($ip) === false);
}
// Boundary cases: these look private but are not. Blocking them would break real links.
assert(avesmapsLinkCheckIsBlockedIp('172.15.255.255') === false); // just below 172.16/12
assert(avesmapsLinkCheckIsBlockedIp('172.32.0.1') === false);     // just above 172.16/12
assert(avesmapsLinkCheckIsBlockedIp('100.63.255.255') === false); // just below 100.64/10
assert(avesmapsLinkCheckIsBlockedIp('100.128.0.1') === false);    // just above 100.64/10
assert(avesmapsLinkCheckIsBlockedIp('11.0.0.1') === false);       // just above 10/8
assert(avesmapsLinkCheckIsBlockedIp('192.167.0.1') === false);    // just below 192.168/16

// ---- host classification: refusing to ask is NOT the same as the host being gone ------------------
// THE distinction this module got wrong once: a domain that no longer resolves is the single most
// common way a shop link dies, and §1.3 lists DNS in the "fail_streak++ -> dead" row. If that were
// reported as "blocked" (= we declined to ask), no verdict would ever be written and a link whose
// domain vanished would stay green forever.
assert(avesmapsLinkCheckClassifyHost('93.184.216.34') === 'public');
assert(avesmapsLinkCheckClassifyHost('8.8.8.8') === 'public');

// We refuse to ask: private/loopback/metadata space, and anything unparseable.
assert(avesmapsLinkCheckClassifyHost('127.0.0.1') === 'blocked');
assert(avesmapsLinkCheckClassifyHost('169.254.169.254') === 'blocked');
assert(avesmapsLinkCheckClassifyHost('192.168.1.1') === 'blocked');
assert(avesmapsLinkCheckClassifyHost('[::1]') === 'blocked'); // IPv6 literal, brackets stripped
assert(avesmapsLinkCheckClassifyHost('') === 'blocked');

// The host is gone. .invalid is reserved by RFC 2606 and can never resolve -- so this is deterministic
// even offline (where every lookup fails and thus yields the same answer).
assert(avesmapsLinkCheckClassifyHost('gibt-es-nicht.invalid') === 'unresolvable');

// And the probe must pass that through as an ordinary inconclusive failure (blocked=false,
// http_status=0), which is exactly the input state.php turns into fail_streak++ -> dead after three.
$probe = avesmapsLinkCheckProbe('https://gibt-es-nicht-avesmaps.invalid/x');
assert($probe['blocked'] === false && $probe['http_status'] === 0);
$decision = avesmapsLinkCheckDecide(['state' => 'online', 'fail_streak' => 2], $probe['http_status']);
assert($decision['verdict'] === true && $decision['state'] === 'dead');

// Whereas a private address must still be refused outright -- no request, no verdict.
$probe = avesmapsLinkCheckProbe('http://127.0.0.1:3306/');
assert($probe['blocked'] === true && $probe['http_status'] === 0);

// ---- probe-URL rewriting: ask the endpoint that can actually answer -------------------------------
// ulisses-ebooks.de serves its HTML behind bot protection that answers 403 to ANY server request --
// verified including with a real Chrome user-agent, so it is a TLS-fingerprint gate, not a UA filter.
// Probing the page therefore says nothing. Its own public product API answers us honestly (200 /
// 403 "withdrawn" / 404 "no such id"), so for those links we probe that instead. The link the READER
// gets is untouched -- only what we ASK changes.
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/de/product/475386/dsa5-die-verschwoerung-von-gareth')
    === 'https://api.ulisses-ebooks.de/api/vBeta/products/475386');
// Without www, and with another language segment.
assert(avesmapsLinkCheckProbeUrl('https://ulisses-ebooks.de/en/product/126759/nedime')
    === 'https://api.ulisses-ebooks.de/api/vBeta/products/126759');
// Trailing slash / no slug.
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/de/product/999/')
    === 'https://api.ulisses-ebooks.de/api/vBeta/products/999');
// A query string on the page URL must not leak into the API call.
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/de/product/475386/x?utm_source=y')
    === 'https://api.ulisses-ebooks.de/api/vBeta/products/475386');

// Anything else on that host has no product id -> leave it alone rather than invent an API call.
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/') === 'https://www.ulisses-ebooks.de/');
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/de/browse/publisher/3444')
    === 'https://www.ulisses-ebooks.de/de/browse/publisher/3444');
// A non-numeric id is not a product id.
assert(avesmapsLinkCheckProbeUrl('https://www.ulisses-ebooks.de/de/product/abc/x')
    === 'https://www.ulisses-ebooks.de/de/product/abc/x');
// And a lookalike host must NOT be rewritten -- the rule is anchored on the real domain.
assert(avesmapsLinkCheckProbeUrl('https://evil-ulisses-ebooks.de.attacker.test/de/product/1/x')
    === 'https://evil-ulisses-ebooks.de.attacker.test/de/product/1/x');

// Every other host passes through untouched.
foreach ([
    'https://de.wiki-aventurica.de/wiki/Gareth',
    'https://www.f-shop.de/produkt/123',
    'https://portal.dnb.de/opac/simpleSearch?query=x',
] as $url) {
    assert(avesmapsLinkCheckProbeUrl($url) === $url);
}

echo "link-url ok\n";
