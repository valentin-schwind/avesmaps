<?php

declare(strict_types=1);

/**
 * SVG-Export page (admin only).
 * ---------------------------------------------------------------------------
 * Reached from the "Karte als SVG" link in the edit shell's top bar, next to the
 * database backup. Tick the layers, pick the target program, press the button: the
 * BROWSER assembles a vector drawing of the whole map and downloads it.
 *
 * Nothing runs on the server here beyond this shell. The heavy lifting is
 * js/pages/svg-export-build.js (pure, unit-tested) plus js/pages/svg-export-page.js
 * (fetch + Blob). A PHP renderer would have to restate the map's appearance a second
 * time -- and hold a 30 MB string on shared hosting.
 *
 * ADMIN ONLY, matching the backup page: the export walks the full feature payload,
 * including the political layer.
 *
 * Design: docs/superpowers/specs/2026-08-14-svg-export-design.md
 */

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

    $user = avesmapsLogin($pdo, (string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));
    if ($user !== null && avesmapsUserCan($user, 'admin')) {
        header('Location: ./svg-export.php');
        exit;
    }

    avesmapsLogout();
    $loginError = 'Login fehlgeschlagen oder keine Admin-Berechtigung.';
}

$currentUser = avesmapsCurrentUser();
$isAdmin = $currentUser !== null && avesmapsUserCan($currentUser, 'admin');

/**
 * The layer list, in DRAW order -- in SVG the first one lies at the BOTTOM.
 * The key is what the client reads back via data-svgx-layer.
 */
$layers = [
    ['key' => 'landschaften', 'label' => 'Landschaften & Küste', 'note' => 'Kontinente, Inseln, Meere, Vegetation, Klimazonen'],
    ['key' => 'regionen', 'label' => 'Regionen', 'note' => 'die klassische Regionen-Ebene'],
    ['key' => 'gebiete', 'label' => 'Herrschaftsgebiete', 'note' => 'die politischen Grenzen'],
    ['key' => 'wege', 'label' => 'Wege', 'note' => 'nach Wegart gruppiert, Flüsse als „Flussweg"'],
    ['key' => 'kraftlinien', 'label' => 'Kraftlinien', 'note' => ''],
    ['key' => 'orte', 'label' => 'Orte', 'note' => 'nach Ortsart gruppiert'],
    ['key' => 'beschriftungen', 'label' => 'Beschriftungen', 'note' => 'als echter Text'],
];

?><!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Avesmaps &ndash; Karte als SVG</title>
    <!-- Hand-written on purpose: the deploy's asset stamper only follows index.html and
         html/*.html, so it never reaches this PHP page. Bump these whenever the stylesheet
         or either script changes, or admins keep the cached files. See AGENTS.md sec.7. -->
    <link rel="stylesheet" href="../css/pages/svg-export.css?v=20260814-svgexport" />
</head>

<body class="edit-page">
    <?php if (!$isAdmin) : ?>
        <main class="edit-login">
            <form class="edit-login__panel" method="post" action="./svg-export.php">
                <input type="hidden" name="action" value="login" />
                <h1>Karte als SVG</h1>
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
        <main class="svgx-shell">
            <header class="edit-shell__bar">
                <div>
                    <strong>Karte als SVG</strong>
                    <span><?php echo htmlspecialchars((string) $currentUser['username'], ENT_QUOTES, 'UTF-8'); ?> | <?php echo htmlspecialchars((string) $currentUser['role'], ENT_QUOTES, 'UTF-8'); ?></span>
                </div>
                <div class="edit-shell__actions">
                    <a class="edit-shell__toplink" href="/edit/">&larr; Zurück zum Editor</a>
                    <form method="post" action="./svg-export.php">
                        <input type="hidden" name="action" value="logout" />
                        <button type="submit">Abmelden</button>
                    </form>
                </div>
            </header>

            <section class="svgx-panel" aria-labelledby="svgx-title">
                <h1 id="svgx-title">Karte als SVG herunterladen</h1>
                <p class="svgx-lead">
                    Zeichnet die ganze Karte als <strong>bearbeitbare Vektorgrafik</strong>:
                    jede Ebene eine Gruppe, jedes Element benannt. Zum Öffnen in Illustrator,
                    Inkscape oder Affinity &ndash; für Poster, Drucke und eigene Fassungen.
                </p>
                <p class="svgx-hint">
                    Der Browser baut die Datei selbst, es läuft nichts auf dem Server. Die
                    Kartendaten sind rund 20&nbsp;MB, das Laden dauert einen Moment &ndash;
                    bitte diesen Tab so lange offen lassen. Wer eine kleinere Datei will,
                    hakt Ebenen ab.
                </p>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Für welches Programm?</h2>
                    <fieldset class="svgx-choices">
                        <label class="svgx-choice">
                            <input type="radio" name="svgx-dialect" value="illustrator" checked />
                            <span>Illustrator
                                <span class="svgx-choice__note">&ndash; Objektnamen stehen in der <code>id</code></span>
                            </span>
                        </label>
                        <label class="svgx-choice">
                            <input type="radio" name="svgx-dialect" value="inkscape" />
                            <span>Inkscape
                                <span class="svgx-choice__note">&ndash; echte Ebenen, Namen in <code>inkscape:label</code></span>
                            </span>
                        </label>
                    </fieldset>
                    <p class="svgx-hint" style="margin-top:8px">
                        Die beiden Programme lesen Objektnamen an verschiedenen Stellen &ndash;
                        eine Datei kann nur einem von beiden lesbare Namen zeigen. Im Zweifel
                        beide erzeugen und vergleichen.
                    </p>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Welche Ebenen?</h2>
                    <fieldset class="svgx-choices">
                        <?php foreach ($layers as $layer) : ?>
                            <label class="svgx-choice">
                                <input type="checkbox" data-svgx-layer="<?php echo htmlspecialchars($layer['key'], ENT_QUOTES, 'UTF-8'); ?>" checked />
                                <span><?php echo htmlspecialchars($layer['label'], ENT_QUOTES, 'UTF-8'); ?>
                                    <?php if ($layer['note'] !== '') : ?>
                                        <span class="svgx-choice__note">&ndash; <?php echo htmlspecialchars($layer['note'], ENT_QUOTES, 'UTF-8'); ?></span>
                                    <?php endif; ?>
                                </span>
                            </label>
                        <?php endforeach; ?>
                    </fieldset>
                </div>

                <div class="svgx-actions">
                    <button type="button" class="svgx-start" id="svgx-start">SVG erzeugen</button>
                    <button type="button" class="svgx-secondary" id="svgx-all">Alle</button>
                    <button type="button" class="svgx-secondary" id="svgx-none">Keine</button>
                </div>

                <p class="svgx-status" id="svgx-status" role="status" aria-live="polite"></p>

                <table class="svgx-stats" id="svgx-stats" hidden>
                    <thead>
                        <tr><th>Ebene</th><th>Objekte</th></tr>
                    </thead>
                    <tbody id="svgx-stats-body"></tbody>
                </table>
            </section>
        </main>
        <script src="../js/pages/svg-export-build.js?v=20260814-svgexport"></script>
        <script src="../js/pages/svg-export-page.js?v=20260814-svgexport"></script>
    <?php endif; ?>
</body>

</html>
