<?php

declare(strict_types=1);

/**
 * Finding A23, the other half: an override actually overrides. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/visitor-salt-override-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 THIS IS A SEPARATE FILE FOR A REASON, not out of tidiness. A constant cannot be redefined and
 * avesmapsVisitorSalt() caches its answer in a static, so "no override" and "override" cannot both
 * be exercised in one process. Folding them together would mean testing one of the two and asserting
 * the other from the source text -- which is the position-instead-of-effect trap this session has
 * already walked into three times.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// BEFORE the require -- that is the whole mechanism under test. This mirrors what a deployment does
// that keeps its salt outside the config file.
define('AVESMAPS_VISITOR_SALT', 'ein-echtes-geheimnis-aus-der-installation');

require __DIR__ . '/../visitor-analytics.php';

assert(
    avesmapsVisitorSalt() === 'ein-echtes-geheimnis-aus-der-installation',
    'a define() placed before the require wins'
);
assert(
    avesmapsVisitorSalt() !== AVESMAPS_VISITOR_SALT_FALLBACK,
    'and it is not the shipped default'
);
// ⚠️ The state the privacy notice depends on, reported rather than assumed.
assert(avesmapsVisitorSaltIsConfigured() === true, 'the installation reports itself as configured');

// 💣 And the override has to reach the DIGEST. A resolver that returns the right string while the
// hash keeps building from the old constant would pass every assert above -- that is exactly the
// shape of bug this session has shipped before.
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Test)';
$withOverride = avesmapsVisitorDailyHash();
$withFallback = hash(
    'sha256',
    gmdate('Ymd') . '|' . AVESMAPS_VISITOR_SALT_FALLBACK . '|203.0.113.7|Mozilla/5.0 (Test)'
);
assert($withOverride !== $withFallback, 'the digest changes with the salt -- the override is not cosmetic');
assert(
    $withOverride === hash('sha256', gmdate('Ymd') . '|ein-echtes-geheimnis-aus-der-installation|203.0.113.7|Mozilla/5.0 (Test)'),
    'and it is built from the overriding salt exactly'
);

// ⚠️ An override that is BLANK, or that merely repeats the shipped default, is not an override --
// it must not be mistaken for one, or an installation would report itself as protected when it is
// not. Those two cases cannot be reached from here (the constant is taken), so they are covered by
// the fallback half in visitor-salt-test.php plus this note.

echo "visitor-salt-override ok\n";
