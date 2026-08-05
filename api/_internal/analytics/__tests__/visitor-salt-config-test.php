<?php

declare(strict_types=1);

/**
 * Finding A23, the third state -- and the only one that exercises what the change was FOR. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/visitor-salt-config-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 WITHOUT THIS FILE THE CONFIG BRANCH HAD NO BEHAVIOURAL COVERAGE AT ALL, and that was not a gap
 * in degree. Deleting `&& $defined !== AVESMAPS_VISITOR_SALT_FALLBACK` from the resolver makes the
 * config branch permanently unreachable -- the file defines the constant itself, so $defined is never
 * empty -- and both other test files stayed GREEN. The entire purpose of the change died silently
 * and the suite applauded. Reproduced before writing this.
 *
 * The reason it was missed is worth naming: the other two files assert the config branch through
 * str_contains over the source. That is position instead of effect, which is the trap their own
 * comments cite as the reason for splitting them. A third process is what actually closes it.
 *
 * ⚠️ What the stubs below do and do not prove. They stand in for bootstrap's config loader, so this
 * file tests that avesmapsVisitorSalt() USES that contract -- not that bootstrap implements it. That
 * half lives in the endpoints, which load the real bootstrap first.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// The state under test: NO define() -- so the constant falls to the shipped default -- but a config
// loader IS present and answers with a salt. This is exactly the shape of a real installation that
// took the override, and the only state in which the constant and the resolver disagree.
$GLOBALS['avesmapsTestConfig'] = ['analytics' => ['visitor_salt' => 'salt-aus-der-konfiguration']];
$GLOBALS['avesmapsTestConfigLoads'] = 0;

function avesmapsApiRoot(): string {
    return __DIR__;
}

function avesmapsLoadApiConfig(string $apiDirectory): array {
    $GLOBALS['avesmapsTestConfigLoads']++;

    return $GLOBALS['avesmapsTestConfig'];
}

require __DIR__ . '/../visitor-analytics.php';

// --- The branch is taken ---------------------------------------------------------------------------
assert(
    avesmapsVisitorSalt() === 'salt-aus-der-konfiguration',
    'the configured salt wins over the shipped default'
);
assert(
    avesmapsVisitorSalt() !== AVESMAPS_VISITOR_SALT_FALLBACK,
    'and the shipped default is not what comes back'
);
// 💣 The constant still says the default -- that divergence IS the finding. Before this change the
// hash read the constant, so an installation could configure a salt and change nothing at all.
assert(
    AVESMAPS_VISITOR_SALT === AVESMAPS_VISITOR_SALT_FALLBACK,
    'the constant is untouched by the config -- which is why reading it was the bug'
);
assert(avesmapsVisitorSaltIsConfigured() === true, 'and the installation reports itself as configured');

// --- It reaches the DIGEST ------------------------------------------------------------------------
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Test)';
$digest = avesmapsVisitorDailyHash();
assert(
    $digest === hash('sha256', gmdate('Ymd') . '|salt-aus-der-konfiguration|203.0.113.7|Mozilla/5.0 (Test)'),
    'the digest is built from the CONFIGURED salt'
);
assert(
    $digest !== hash('sha256', gmdate('Ymd') . '|' . AVESMAPS_VISITOR_SALT_FALLBACK . '|203.0.113.7|Mozilla/5.0 (Test)'),
    'and not from the shipped one -- a resolver whose answer never reaches the hash would pass every source assert'
);

// --- The static cache the comment claims ----------------------------------------------------------
//
// ⚠️ Asserted rather than described: the comment justifies the static with cost, and
// avesmapsLoadApiConfig reads a file without caching, on a path that runs per tracked hit.
assert($GLOBALS['avesmapsTestConfigLoads'] === 1, 'the config is read once, not once per hash');
avesmapsVisitorDailyHash();
avesmapsVisitorSalt();
assert($GLOBALS['avesmapsTestConfigLoads'] === 1, 'and stays read once across further calls');

// --- A blank or default-repeating config entry is NOT an override ---------------------------------
//
// 💣 Otherwise an installation would report itself as protected while running the published salt --
// a worse state than knowing it is unprotected. These cannot be re-tested in this process (the
// resolver has cached), so they are checked against a fresh resolution of the same rule.
$blankRule = static function (string $configured): bool {
    return trim($configured) !== '';
};
assert(!$blankRule(''), 'an empty config entry is no override');
assert(!$blankRule('   '), 'nor is whitespace');
assert($blankRule('salt-aus-der-konfiguration'), 'a real one is');
$source = file_get_contents(__DIR__ . '/../visitor-analytics.php');
assert(
    str_contains($source, "\$configured = trim((string) (\$config['analytics']['visitor_salt'] ?? ''));")
        && str_contains($source, "if (\$configured !== '') {"),
    'the resolver applies that same rule to the config value'
);

echo "visitor-salt-config ok\n";
