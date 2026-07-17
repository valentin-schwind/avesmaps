<?php

declare(strict_types=1);

/**
 * Unit tests for the pure gate in front of the settlement-coat localiser
 * (api/_internal/wiki/settlements.php). No DB, no HTTP. Run (Windows, from the repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/settlement-coat-localize-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a silent no-op unless zend.assertions=1 is set at PHP STARTUP -- ini_set cannot flip
// it. Without this guard a broken gate would print every "ok" and exit 0.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../settlements-coat-localize.php';

$wiki = 'https://de.wiki-aventurica.de/de/index.php?title=Spezial:Dateipfad/Wappen%20Sturmfels.svg';

// --- due: the only state that fetches ---------------------------------------------------------
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => 'public_domain', 'url' => $wiki]) === 'due');

// --- own uploads are sacred: never touched, whatever else the row says -------------------------
// Mirrors avesmapsWikiSettlementBulkRecordCoats, which skips source='own' outright.
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'own', 'license_status' => 'own', 'url' => '/uploads/wappen/own/x.png']) === 'own');
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'own', 'license_status' => 'public_domain', 'url' => $wiki]) === 'own');

// --- already local: idempotent, so a second run is a no-op and the loop terminates -------------
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => 'public_domain', 'url' => '/uploads/wappen/wiki/foo.png']) === 'already_local');

// --- the licence gate: only public_domain may be copied onto our server ------------------------
// 'unknown' is the DEFAULT for a coat nobody classified, so this branch carries the whole policy.
foreach (['unknown', 'attribution_required', '', 'cc0'] as $status) {
    assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => $status, 'url' => $wiki]) === 'not_free',
        'licence ' . $status . ' must not be localised');
}

// --- the host gate: we only ever fetch from the wiki we have a relationship with ---------------
// A lookalike domain must not pass -- the check is anchored on the host, not a substring.
foreach ([
    'https://evil.example/x.png',
    'https://wiki-aventurica.de.evil.example/x.png',
    'https://notde.wiki-aventurica.de.attacker.tld/x.png',
    'http://169.254.169.254/latest/meta-data/',
] as $badUrl) {
    assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => 'public_domain', 'url' => $badUrl]) === 'foreign_host',
        'must reject ' . $badUrl);
}
// The real wiki host passes, with or without a subdomain-ish prefix we actually use.
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => 'public_domain', 'url' => 'https://de.wiki-aventurica.de/images/a/ab/Wappen.png']) === 'due');

// --- junk in, safe answer out -----------------------------------------------------------------
assert(avesmapsWikiSettlementCoatLocalizeState([]) === 'no_coat');
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'wiki', 'license_status' => 'public_domain', 'url' => '']) === 'no_coat');
assert(avesmapsWikiSettlementCoatLocalizeState(['source' => 'community', 'license_status' => 'public_domain', 'url' => $wiki]) === 'other_source');

echo "settlement coat localize gate ok\n";
echo "ALL OK\n";
