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
        default => false,
    };
}

function avesmapsRequireUserWithCapability(string $capability): array {
    $user = avesmapsCurrentUser();
    if ($user === null || !avesmapsUserCan($user, $capability)) {
        avesmapsJsonResponse(401, [
            'ok' => false,
            'error' => 'Du bist fuer diese Aktion nicht angemeldet.',
        ]);
    }

    return $user;
}

function avesmapsValidateRole(string $role): string {
    $normalizedRole = avesmapsNormalizeSingleLine($role, 20);
    if (!in_array($normalizedRole, AVESMAPS_AUTH_ROLES, true)) {
        throw new InvalidArgumentException('Die Rolle ist ungueltig.');
    }

    return $normalizedRole;
}
