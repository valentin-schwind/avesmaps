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
        // capability and never an alias of 'edit': tending the map and speaking publicly under the
        // project's name are different powers, and one must be grantable without the other.
        //
        // Widened to admins AND editors on 2026-08-11 (owner: open the hub to every editor), so both
        // capabilities happen to name the same roles today -- a coincidence, not a merge. It stops
        // there: a reviewer checks the map, they do not speak for the project. The widening cost the
        // one line below and NO caller change, because every caller already asks avesmapsUserCan(...,
        // 'social'). Naming single PEOPLE would still need a users.can_social column.
        'social' => in_array($role, ['admin', 'editor'], true),
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

/**
 * The editor's view of a PUBLIC read path (`?edit_mode=1`) -- for signed-in editors only.
 *
 * 🔴 Three public endpoints hand out more with `edit_mode=1`: map-features.php and territory-detail.php
 * lift the coat kill switch ("Wappen: Aus", NOTICE.md), the political layer serves the whole editor
 * layer. Until 2026-09-14 the parameter alone did it, for anyone. The kill switch exists for legal
 * reasons; a url parameter that lifts it is no kill switch.
 *
 * 💣 Call it ONCE, at the top of the handler, and assign the result back:
 *     $_GET = avesmapsEditModeNurFuerEditoren($_GET);
 * Both cached endpoints key their cache on edit_mode (map-features: ETag seed + body cache; political
 * layer: the cache file it serves BEFORE the PDO). A check placed only where the payload is BUILT lets
 * the fast path keep serving the editor variant to anyone asking for it, and lets the 304 check confirm
 * an editor ETag. Filtering the request binds every reader -- ETag, cache key, fast path, build -- and
 * the next one somebody adds. Guarded by api/_internal/__tests__/edit-mode-riegel-test.php.
 *
 * ⚠️ Anything other than absent / '' / '0' counts as a request -- `edit_mode=true` IS edit mode to the
 * political reader (FILTER_VALIDATE_BOOLEAN). Only then is the user looked at: the visitor path (the
 * political layer sends edit_mode=0 on every pan) never touches the session.
 *
 * ⚠️ Fails CLOSED: a reader that throws yields the visitor's view -- never the editor's, never a 500.
 *
 * @param callable|null $benutzerLesen returns the signed-in user or null; default: the real session.
 */
function avesmapsEditModeNurFuerEditoren(array $query, ?callable $benutzerLesen = null): array {
    if (!array_key_exists('edit_mode', $query)) {
        return $query;
    }
    if (is_string($query['edit_mode']) && in_array(trim($query['edit_mode']), ['', '0'], true)) {
        return $query;
    }

    try {
        $user = ($benutzerLesen ?? 'avesmapsEditModeSitzungsbenutzer')();
    } catch (Throwable) {
        $user = null;
    }
    if (is_array($user) && avesmapsUserCan($user, 'edit')) {
        return $query;
    }

    unset($query['edit_mode']);
    return $query;
}

/**
 * The signed-in user for avesmapsEditModeNurFuerEditoren -- without opening a session that cannot hold one.
 *
 * ⚠️ No session cookie, no session: an anonymous `edit_mode=1` creates no session file and takes no
 * session-file lock (the lock that wedged the FPM pool, see avesmapsCurrentUser).
 *
 * 💣 The cache limiter is off for the read and restored afterwards. session_start() would otherwise send
 * its own Cache-Control/Pragma/Expires on endpoints that set their caching headers themselves (ETag +
 * no-cache on map-features, private max-age on the political layer) and never opened a session before.
 */
function avesmapsEditModeSitzungsbenutzer(): ?array {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $cookie = $_COOKIE[session_name()] ?? null;
        if (!is_string($cookie) || $cookie === '') {
            return null;
        }
    }

    $limiter = session_status() === PHP_SESSION_ACTIVE ? false : session_cache_limiter('');
    try {
        return avesmapsCurrentUser();
    } finally {
        if (is_string($limiter)) {
            session_cache_limiter($limiter);
        }
    }
}

function avesmapsValidateRole(string $role): string {
    $normalizedRole = avesmapsNormalizeSingleLine($role, 20);
    if (!in_array($normalizedRole, AVESMAPS_AUTH_ROLES, true)) {
        throw new InvalidArgumentException('Die Rolle ist ungueltig.');
    }

    return $normalizedRole;
}
