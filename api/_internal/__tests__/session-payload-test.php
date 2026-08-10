<?php

declare(strict_types=1);

/**
 * Unit tests for avesmapsSessionPayload (api/_internal/auth.php) -- the shape the map reads to learn
 * who the visitor is and what they may do.
 *
 * 💣 Why this function exists at all, and why it is pure: until 2026-08-01 the landscape layer was
 * gated by `?landschaften=1`, an UNCHECKED url parameter. Its replacement is a real permission check,
 * and a permission check that nobody can unit-test is a permission check nobody trusts. Everything
 * that needs a session or a database stays in the endpoint; the decision "what does this role get to
 * see" lives here, alone, and is asserted below.
 *
 * ⚠️ The payload must NEVER carry anything an anonymous visitor may not read about themselves -- no
 * user id, no mail, no password state. Username and role are what the editor shell already shows the
 * user about themselves; the capability flags are derived, not stored.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/__tests__/session-payload-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../auth.php';

// ---- anonymous ---------------------------------------------------------------------------------

$anonymous = avesmapsSessionPayload(null);

assert($anonymous['authenticated'] === false, 'no session -> not authenticated');
assert($anonymous['username'] === null, 'no session -> no username');
assert($anonymous['role'] === null, 'no session -> no role');
assert($anonymous['capabilities'] === ['admin' => false, 'edit' => false, 'review' => false, 'social' => false],
    'no session -> every capability is false');

// 🔴 The one that guards the public map: an anonymous visitor is never an admin, so the landscape
// layer never appears for them. This assert is the whole point of the file.
assert($anonymous['capabilities']['admin'] === false, 'anonymous is never admin');

// ---- the three roles ---------------------------------------------------------------------------

$admin = avesmapsSessionPayload(['id' => 7, 'username' => 'vali', 'role' => 'admin']);
assert($admin['authenticated'] === true, 'a session -> authenticated');
assert($admin['username'] === 'vali', 'the username travels');
assert($admin['role'] === 'admin', 'the role travels');
assert($admin['capabilities'] === ['admin' => true, 'edit' => true, 'review' => true, 'social' => true],
    'admin holds all four capabilities');

$editor = avesmapsSessionPayload(['id' => 8, 'username' => 'edi', 'role' => 'editor']);
assert($editor['capabilities'] === ['admin' => false, 'edit' => true, 'review' => true, 'social' => false],
    'editor may edit and review, but is neither admin nor may they publish');

// 🔴 "Die Reviewer werden zur gegebenen Zeit Zugriff bekommen" (owner, 2026-07-30) -- zur gegebenen
// Zeit, nicht heute. A reviewer is not an admin and does not get the layer.
$reviewer = avesmapsSessionPayload(['id' => 9, 'username' => 'revi', 'role' => 'reviewer']);
assert($reviewer['capabilities'] === ['admin' => false, 'edit' => false, 'review' => true, 'social' => false],
    'reviewer may only review');

// ---- malformed sessions fail CLOSED -------------------------------------------------------------

// A role the deployment does not know grants nothing. Fail closed, never open.
$unknownRole = avesmapsSessionPayload(['id' => 1, 'username' => 'x', 'role' => 'superuser']);
assert($unknownRole['capabilities'] === ['admin' => false, 'edit' => false, 'review' => false, 'social' => false],
    'an unknown role grants nothing');
assert($unknownRole['role'] === null, 'an unknown role is not reported back as if it were valid');
assert($unknownRole['authenticated'] === true, 'but the session itself is still a session');

// A session row without a role is the same case.
$roleless = avesmapsSessionPayload(['id' => 1, 'username' => 'x']);
assert($roleless['capabilities']['admin'] === false, 'a roleless session is not admin');

// ---- the capability 'social' (Social-Media-Hub, Entwurf §7) --------------------------------------

// 🔴 Its OWN capability, deliberately not a synonym for 'edit': maintaining the map and speaking
// publicly under the project's name are different powers, and one must be grantable without the
// other. Today it coincides with 'admin' because the role model has no per-user grid -- that is the
// narrow starting choice, NOT the definition. Widening it to named editors is a users.can_social
// column plus one line in avesmapsUserCan; no caller changes, because every caller already asks
// avesmapsUserCan(..., 'social'). That is the whole reason it got a name of its own now.
assert(avesmapsUserCan(['role' => 'admin'], 'social') === true,
    'admin may publish');
assert(avesmapsUserCan(['role' => 'editor'], 'social') === false,
    'an editor may tend the map, but not speak in the name of the project');
assert(avesmapsUserCan(['role' => 'reviewer'], 'social') === false,
    'a reviewer even less so');
assert(avesmapsUserCan(['role' => ''], 'social') === false,
    'an unknown role wins nothing -- fails closed, never open');

assert($admin['capabilities']['social'] === true,
    'the rights channel carries social, otherwise the client cannot hide the tab');
assert($editor['capabilities']['social'] === false,
    'and it carries it as FALSE, not as missing -- an absent key reads as undefined in the client');
assert($anonymous['capabilities']['social'] === false, 'anonymous: false');

// ---- nothing else leaks -------------------------------------------------------------------------

assert(array_keys($admin) === ['authenticated', 'username', 'role', 'capabilities'],
    'the payload carries exactly these four keys -- no user id, nothing else');
assert(!in_array('id', array_keys($admin), true), 'the internal user id never leaves the server');

echo "session-payload-test: all asserts passed\n";
