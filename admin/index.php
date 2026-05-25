<?php

declare(strict_types=1);

require __DIR__ . '/../api/auth.php';

$config = avesmapsLoadApiConfig(dirname(__DIR__) . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
$loginError = '';
$adminMessage = '';
$adminError = '';

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'POST') {
    $action = avesmapsNormalizeSingleLine((string) ($_POST['action'] ?? 'login'), 30);

    try {
        if ($action === 'logout') {
            avesmapsLogout();
            header('Location: ./');
            exit;
        }

        if ($action === 'login') {
            $user = avesmapsLogin($pdo, (string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));
            if ($user !== null && avesmapsUserCan($user, 'admin')) {
                header('Location: ./');
                exit;
            }

            avesmapsLogout();
            $loginError = 'Login fehlgeschlagen oder keine Admin-Berechtigung.';
        } else {
            $currentUser = avesmapsCurrentUser();
            if ($currentUser === null || !avesmapsUserCan($currentUser, 'admin')) {
                throw new RuntimeException('Du bist fuer diese Admin-Aktion nicht angemeldet.');
            }

            if ($action === 'save_user') {
                avesmapsAdminSaveUser($pdo);
                $adminMessage = 'Benutzer wurde gespeichert.';
            } elseif ($action === 'delete_user') {
                avesmapsAdminDeleteUser($pdo, $currentUser);
                $adminMessage = 'Benutzer wurde geloescht.';
            } else {
                throw new InvalidArgumentException('Die Admin-Aktion ist unbekannt.');
            }
        }
    } catch (Throwable $exception) {
        $adminError = $exception->getMessage();
    }
}

$currentUser = avesmapsCurrentUser();
$isAdmin = $currentUser !== null && avesmapsUserCan($currentUser, 'admin');
$users = $isAdmin ? avesmapsAdminFetchUsers($pdo) : [];

function avesmapsAdminFetchUsers(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT id, username, role, is_active, created_at, updated_at
        FROM users
        ORDER BY username ASC'
    );

    return $statement->fetchAll();
}

function avesmapsAdminSaveUser(PDO $pdo): void {
    $userId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT);
    $username = avesmapsNormalizeSingleLine((string) ($_POST['username'] ?? ''), 80);
    $role = avesmapsValidateRole((string) ($_POST['role'] ?? 'editor'));
    $isActive = isset($_POST['is_active']) ? 1 : 0;
    $password = (string) ($_POST['password'] ?? '');

    if ($username === '') {
        throw new InvalidArgumentException('Der Benutzername fehlt.');
    }

    if ($userId === false || $userId === null) {
        if ($password === '') {
            throw new InvalidArgumentException('Neue Benutzer brauchen ein Passwort.');
        }

        avesmapsValidateAdminPassword($password);
        $statement = $pdo->prepare(
            'INSERT INTO users (username, password_hash, role, is_active)
            VALUES (:username, :password_hash, :role, :is_active)'
        );
        $statement->execute([
            'username' => $username,
            'password_hash' => avesmapsHashAdminPassword($password),
            'role' => $role,
            'is_active' => $isActive,
        ]);
        return;
    }

    if ($password !== '') {
        avesmapsValidateAdminPassword($password);
        $statement = $pdo->prepare(
            'UPDATE users
            SET username = :username,
                password_hash = :password_hash,
                role = :role,
                is_active = :is_active
            WHERE id = :id'
        );
        $statement->execute([
            'id' => $userId,
            'username' => $username,
            'password_hash' => avesmapsHashAdminPassword($password),
            'role' => $role,
            'is_active' => $isActive,
        ]);
        return;
    }

    $statement = $pdo->prepare(
        'UPDATE users
        SET username = :username,
            role = :role,
            is_active = :is_active
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $userId,
        'username' => $username,
        'role' => $role,
        'is_active' => $isActive,
    ]);
}

function avesmapsAdminDeleteUser(PDO $pdo, array $currentUser): void {
    $userId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT);
    if ($userId === false || $userId === null) {
        throw new InvalidArgumentException('Der Benutzer fehlt.');
    }

    if ((int) $currentUser['id'] === $userId) {
        throw new InvalidArgumentException('Du kannst deinen eigenen Admin-Benutzer nicht loeschen.');
    }

    $statement = $pdo->prepare('DELETE FROM users WHERE id = :id');
    $statement->execute([
        'id' => $userId,
    ]);
}

function avesmapsValidateAdminPassword(string $password): void {
    if (strlen($password) < 12) {
        throw new InvalidArgumentException('Das Passwort muss mindestens 12 Zeichen lang sein.');
    }
}

function avesmapsHashAdminPassword(string $password): string {
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if (!is_string($passwordHash) || $passwordHash === '') {
        throw new RuntimeException('Das Passwort konnte nicht gehasht werden.');
    }

    return $passwordHash;
}

function avesmapsAdminRoleOptions(string $selectedRole): string {
    $html = '';
    foreach (AVESMAPS_AUTH_ROLES as $role) {
        $selectedAttribute = $role === $selectedRole ? ' selected' : '';
        $escapedRole = htmlspecialchars($role, ENT_QUOTES, 'UTF-8');
        $html .= "<option value=\"{$escapedRole}\"{$selectedAttribute}>{$escapedRole}</option>";
    }

    return $html;
}

?><!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Avesmaps Admin</title>
    <link rel="stylesheet" href="../css/styles.css?v=20260506-admin" />
</head>

<body class="edit-page">
    <?php if (!$isAdmin) : ?>
        <main class="edit-login">
            <form class="edit-login__panel" method="post" action="./">
                <input type="hidden" name="action" value="login" />
                <h1>Avesmaps Admin</h1>
                <p>Bitte melde dich mit deinem Admin-Zugang an.</p>
                <?php if ($loginError !== '') : ?>
                    <p class="edit-login__error" role="alert"><?php echo htmlspecialchars($loginError, ENT_QUOTES, 'UTF-8'); ?></p>
                <?php endif; ?>
                <label>
                    <span>Benutzername</span>
                    <input type="text" name="username" autocomplete="username" required autofocus />
                </label>
                <label>
                    <span>Passwort</span>
                    <input type="password" name="password" autocomplete="current-password" required />
                </label>
                <button type="submit">Anmelden</button>
            </form>
        </main>
    <?php else : ?>
        <main class="admin-shell">
            <header class="edit-shell__bar">
                <div>
                    <strong>Avesmaps Admin</strong>
                    <span><?php echo htmlspecialchars((string) $currentUser['username'], ENT_QUOTES, 'UTF-8'); ?> | <?php echo htmlspecialchars((string) $currentUser['role'], ENT_QUOTES, 'UTF-8'); ?></span>
                </div>
                <form method="post" action="./">
                    <input type="hidden" name="action" value="logout" />
                    <button type="submit">Abmelden</button>
                </form>
            </header>

            <section class="admin-panel" aria-labelledby="new-user-title">
                <h1 id="new-user-title">Benutzer verwalten</h1>
                <?php if ($adminMessage !== '') : ?>
                    <p class="admin-message" role="status"><?php echo htmlspecialchars($adminMessage, ENT_QUOTES, 'UTF-8'); ?></p>
                <?php endif; ?>
                <?php if ($adminError !== '') : ?>
                    <p class="edit-login__error" role="alert"><?php echo htmlspecialchars($adminError, ENT_QUOTES, 'UTF-8'); ?></p>
                <?php endif; ?>

                <form class="admin-user-form admin-user-form--new" method="post" action="./">
                    <label>
                        <span>Benutzername</span>
                        <input type="text" name="username" required />
                    </label>
                    <label>
                        <span>Rolle</span>
                        <select name="role"><?php echo avesmapsAdminRoleOptions('editor'); ?></select>
                    </label>
                    <label>
                        <span>Passwort</span>
                        <input type="password" name="password" minlength="12" required />
                    </label>
                    <label class="admin-checkbox">
                        <input type="checkbox" name="is_active" checked />
                        <span>aktiv</span>
                    </label>
                    <button type="submit" name="action" value="save_user">Benutzer anlegen</button>
                </form>

                <div class="admin-user-list">
                    <?php foreach ($users as $user) : ?>
                        <form class="admin-user-form" method="post" action="./">
                            <input type="hidden" name="user_id" value="<?php echo (int) $user['id']; ?>" />
                            <label>
                                <span>Benutzername</span>
                                <input type="text" name="username" value="<?php echo htmlspecialchars((string) $user['username'], ENT_QUOTES, 'UTF-8'); ?>" required />
                            </label>
                            <label>
                                <span>Rolle</span>
                                <select name="role"><?php echo avesmapsAdminRoleOptions((string) $user['role']); ?></select>
                            </label>
                            <label>
                                <span>Neues Passwort</span>
                                <input type="password" name="password" minlength="12" placeholder="unveraendert" />
                            </label>
                            <label class="admin-checkbox">
                                <input type="checkbox" name="is_active" <?php echo (int) $user['is_active'] === 1 ? 'checked' : ''; ?> />
                                <span>aktiv</span>
                            </label>
                            <button type="submit" name="action" value="save_user">Speichern</button>
                            <?php if ((int) $user['id'] !== (int) $currentUser['id']) : ?>
                                <button type="submit" name="action" value="delete_user" class="admin-danger-button">Loeschen</button>
                            <?php endif; ?>
                        </form>
                    <?php endforeach; ?>
                </div>
            </section>
        </main>
    <?php endif; ?>
</body>

</html>
