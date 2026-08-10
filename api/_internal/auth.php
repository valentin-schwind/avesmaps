<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const AVESMAPS_AUTH_SESSION_KEY = 'avesmaps_user';
const AVESMAPS_AUTH_ROLES = ['admin', 'editor', 'reviewer'];

function avesmapsStartSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $isSecureRequest = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isSecureRequest,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    session_start();
}

function avesmapsCurrentUser(): ?array {
    avesmapsStartSession();
    $user = $_SESSION[AVESMAPS_AUTH_SESSION_KEY] ?? null;
    // Release the session-file lock the moment we have read the user. PHP keeps an EXCLUSIVE flock on the
    // session file for the whole request; on the network-mounted webspace (/mnt/web...) that serialises
    // every concurrent same-session request -- the editor opens ~19 at once, all sharing one cookie -- and
    // under sustained edit-mode load the workers pile up waiting for that one lock and wedge the FPM pool.
    // Nothing writes $_SESSION after this read (only login/logout do, and they re-open via
    // avesmapsStartSession), so closing here is safe. Mirrors api/edit/map/link-check.php.
    session_write_close();

    return is_array($user) ? $user : null;
}

function avesmapsLogin(PDO $pdo, string $username, string $password): ?array {
    $normalizedUsername = avesmapsNormalizeSingleLine($username, 80);
    if ($normalizedUsername === '' || $password === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id, username, password_hash, role, is_active
        FROM users
        WHERE username = :username
        LIMIT 1'
    );
    $statement->execute([
        'username' => $normalizedUsername,
    ]);

    $row = $statement->fetch();
    if (!$row || (int) $row['is_active'] !== 1 || !password_verify($password, (string) $row['password_hash'])) {
        return null;
    }

    $user = [
        'id' => (int) $row['id'],
        'username' => (string) $row['username'],
        'role' => (string) $row['role'],
    ];

    avesmapsStartSession();
    session_regenerate_id(true);
    $_SESSION[AVESMAPS_AUTH_SESSION_KEY] = $user;

    return $user;
}

function avesmapsLogout(): void {
    avesmapsStartSession();
    unset($_SESSION[AVESMAPS_AUTH_SESSION_KEY]);
    session_regenerate_id(true);
}

function avesmapsUserCan(array $user, string $capability): bool {
    $role = (string) ($user['role'] ?? '');

    return match ($capability) {
        'admin' => $role === 'admin',
        'edit' => in_array($role, ['admin', 'editor'], true),
        'review' => in_array($role, ['admin', 'editor', 'reviewer'], true),
        // Publishing in the name of the project (social media hub, Entwurf §7). Deliberately its own
        // capability rather than a synonym for 'edit': tending the map and speaking publicly under the
        // project's name are different powers, and one must be grantable without the other.
        //
        // Today it coincides with 'admin' because the role model knows only roles and has no per-user
        // grid. That is the narrow STARTING choice, not the definition. Widening it to named editors is
        // a users.can_social column plus this one line -- and NO caller changes, because every caller
        // already asks avesmapsUserCan(..., 'social'). Writing 'admin' at each call site instead would
        // have made that widening a rebuild.
        'social' => $role === 'admin',
        default => false,
    };
}

/**
 * "Who am I, what may I" as a plain array -- the body of GET /api/app/session.php.
 *
 * 💣 Pure on purpose (unit-tested in __tests__/session-payload-test.php). It replaced `?landschaften=1`,
 * an unchecked url parameter, as the gate for the landscape layer; a gate that cannot be tested without
 * a session and a database is a gate nobody re-checks. The session read stays in the endpoint.
 *
 * ⚠️ Fails CLOSED: an unknown or missing role grants nothing and is not echoed back, so a stray value in
 * the session store can never widen what the client believes it may do.
 *
 * ⚠️ The internal user id deliberately does NOT travel. The client needs the name it already shows the
 * user and the three flags it branches on -- nothing else.
 */
function avesmapsSessionPayload(?array $user): array {
    $role = is_array($user) ? (string) ($user['role'] ?? '') : '';
    $isKnownRole = in_array($role, AVESMAPS_AUTH_ROLES, true);

    return [
        'authenticated' => $user !== null,
        'username' => $user === null ? null : (string) ($user['username'] ?? ''),
        'role' => $isKnownRole ? $role : null,
        'capabilities' => [
            'admin' => $isKnownRole && avesmapsUserCan($user, 'admin'),
            'edit' => $isKnownRole && avesmapsUserCan($user, 'edit'),
            'review' => $isKnownRole && avesmapsUserCan($user, 'review'),
            'social' => $isKnownRole && avesmapsUserCan($user, 'social'),
        ],
    ];
}

function avesmapsRequireUserWithCapability(string $capability): array {
    $user = avesmapsCurrentUser();
    if ($user === null) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Du bist fuer diese Aktion nicht angemeldet.');
    }
    if (!avesmapsUserCan($user, $capability)) {
        avesmapsErrorResponse(403, 'forbidden', 'Dir fehlt die Berechtigung fuer diese Aktion.');
    }

    return $user;
}

function avesmapsOptionalUser(): ?array {
    $user = avesmapsCurrentUser();
    if ($user !== null && avesmapsUserCan($user, 'edit')) {
        return $user;
    }
    return null;
}

function avesmapsValidateRole(string $role): string {
    $normalizedRole = avesmapsNormalizeSingleLine($role, 20);
    if (!in_array($normalizedRole, AVESMAPS_AUTH_ROLES, true)) {
        throw new InvalidArgumentException('Die Rolle ist ungueltig.');
    }

    return $normalizedRole;
}
