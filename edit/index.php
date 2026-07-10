<?php

declare(strict_types=1);

require __DIR__ . '/../api/auth.php';

$config = avesmapsLoadApiConfig(dirname(__DIR__) . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
$loginError = '';

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'POST') {
    $action = avesmapsNormalizeSingleLine((string) ($_POST['action'] ?? 'login'), 20);
    if ($action === 'logout') {
        avesmapsLogout();
        header('Location: ./');
        exit;
    }

    $username = (string) ($_POST['username'] ?? '');
    $password = (string) ($_POST['password'] ?? '');
    $user = avesmapsLogin($pdo, $username, $password);
    if ($user !== null && avesmapsUserCan($user, 'edit')) {
        header('Location: ./');
        exit;
    }

    avesmapsLogout();
    $loginError = 'Login fehlgeschlagen oder keine Editor-Berechtigung.';
}

$currentUser = avesmapsCurrentUser();
$isEditor = $currentUser !== null && avesmapsUserCan($currentUser, 'edit');

// Ansichts-Flags von der /edit/-URL in den Karten-iframe durchreichen (der iframe laedt sonst nur
// ?debugMap=1&edit=1). So aktiviert z. B. /edit/?infopanel=true den Infopanel-Modus AUCH im Editor,
// damit Editor-Panel und Infobox koexistieren.
$mapIframeQuery = 'debugMap=1&edit=1';
if (isset($_GET['infopanel']) && $_GET['infopanel'] === 'true') {
    $mapIframeQuery .= '&infopanel=true';
}
$mapIframeSrc = '../index.html?' . htmlspecialchars($mapIframeQuery, ENT_QUOTES, 'UTF-8');

?><!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Avesmaps Edit</title>
    <link rel="stylesheet" href="../css/pages/edit.css?v=20260526-page-css" />
</head>

<body class="edit-page">
    <?php if (!$isEditor) : ?>
        <main class="edit-login">
            <form class="edit-login__panel" method="post" action="./">
                <input type="hidden" name="action" value="login" />
                <h1>Avesmaps Edit</h1>
                <p>Bitte melde dich mit einem Editor- oder Admin-Zugang an.</p>
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
        <main class="edit-shell">
            <header class="edit-shell__bar">
                <div>
                    <strong>Avesmaps Edit</strong>
                    <span><?php echo htmlspecialchars((string) $currentUser['username'], ENT_QUOTES, 'UTF-8'); ?> | <?php echo htmlspecialchars((string) $currentUser['role'], ENT_QUOTES, 'UTF-8'); ?></span>
                </div>
                <form method="post" action="./">
                    <input type="hidden" name="action" value="logout" />
                    <button type="submit">Abmelden</button>
                </form>
            </header>
            <iframe class="edit-shell__map" src="<?php echo $mapIframeSrc; ?>" title="Avesmaps Karte"></iframe>
        </main>
    <?php endif; ?>
</body>

</html>
