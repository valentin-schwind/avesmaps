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

// ALLE URL-Parameter von /edit/ an den Karten-iframe durchreichen (der iframe laedt sonst nur
// ?debugMap=1&edit=1). So laedt z. B. /edit/?route=...&infopanel=true die Route UND zeigt im Editor das
// Info-Panel (mit Auto-Open) samt Editor-Tab. Die ROHE Query nehmen (nicht $_GET), damit mehrfache
// route=-Parameter erhalten bleiben; debugMap/edit/_v werden fest gesetzt und daher herausgefiltert.
$rawQuery = (string) ($_SERVER['QUERY_STRING'] ?? '');
$forwarded = array_filter(explode('&', $rawQuery), static function (string $pair): bool {
    if ($pair === '') {
        return false;
    }
    $name = strtolower(explode('=', $pair, 2)[0]);
    return !in_array($name, ['debugmap', 'edit', '_v'], true);
});
$mapIframeQuery = 'debugMap=1&edit=1';
if ($forwarded) {
    $mapIframeQuery .= '&' . implode('&', $forwarded);
}
// Cache-Bust: index.html ist ungestampt -> der iframe wuerde sonst potenziell eine veraltete Fassung
// (und damit alte CSS/JS-Verweise) aus dem Browser-Cache laden. filemtime(index.html) aendert sich bei
// jedem Deploy (der Stamping-Schritt schreibt index.html um), sonst nicht -> nach einem Deploy laedt der
// Editor-iframe automatisch frisch, cacht aber im Normalbetrieb weiter.
$indexPath = dirname(__DIR__) . '/index.html';
if (is_file($indexPath)) {
    $mapIframeQuery .= '&_v=' . filemtime($indexPath);
}
$mapIframeSrc = '../index.html?' . htmlspecialchars($mapIframeQuery, ENT_QUOTES, 'UTF-8');

// Das Skript des Drei-Strich-Menues stempelt sich selbst -- siehe der Kommentar an seinem
// <script>-Tag unten. Fehlt die Datei (frischer Klon, halber Deploy), bleibt der Verweis
// ungestempelt statt zu verschwinden: ein Menue ohne Esc ist besser als ein 404.
$menuScriptPath = dirname(__DIR__) . '/js/pages/edit-shell-menu.js';
$menuScriptSrc = '/js/pages/edit-shell-menu.js';
if (is_file($menuScriptPath)) {
    $menuScriptSrc .= '?v=' . filemtime($menuScriptPath);
}

?><!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Avesmaps Edit</title>
    <!-- The edit shell answers 200 to anyone. robots.txt keeps crawlers off /edit/, and this
         tag catches whoever ignores it -- both, because either alone leaves a gap. -->
    <meta name="robots" content="noindex, nofollow" />
    <!-- Hand-written on purpose: the deploy's asset stamper only follows index.html and
         html/*.html, so it never reaches this PHP page. Bump this whenever edit.css changes,
         or editors keep the cached stylesheet. See AGENTS.md sec.7. -->
    <link rel="stylesheet" href="../css/pages/edit.css?v=20260823-menue-symmetrie" />
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
                <!-- Das Drei-Strich-Menue der Huelle. Entwurf: docs/hauptleiste-menue-mockup.html
                     (23.08.2026 lagen die vier Eintraege noch nebeneinander in der Leiste; „Admin"
                     fehlte ganz -- aus dem Editor fuehrte kein Weg auf /admin/).

                     💣 Es ist ein NATIVES <details>, kein selbstgebauter Umschalter. Aufklappen,
                     Fokus, Enter/Leertaste und der Vorlese-Zustand kommen damit vom Browser; das
                     Skript daneben ergaenzt nur „Klick daneben schliesst" und Esc. Faellt es aus,
                     bleibt das Menue voll bedienbar -- dieselbe Ueberlegung wie beim
                     Inhaltsverzeichnis der Hinweise (AGENTS.md §11).

                     ⚠️ Kein `div` in diesem Baum: `.edit-shell__bar div` in css/pages/edit.css traf
                     bis heute JEDES div der Leiste und haette Liste und Gruppen auf
                     `display:flex; align-items:baseline` gestellt. Die Regel ist jetzt auf den
                     Titelblock geschaerft -- dieselbe Korrektur, die das `span` daneben am
                     13.08.2026 bekommen hat. -->
                <details class="edit-shell__menu">
                    <summary class="edit-shell__menu-button" title="Menü" aria-label="Menü">&#9776;</summary>
                    <nav class="edit-shell__menu-list">
                        <section class="edit-shell__menu-group">
                            <!-- Zweiter Einstieg ins Handbuch; der andere haengt am Ende der
                                 Datenstatuszeile im Editorpanel und ist damit unsichtbar, solange
                                 das Panel zu ist. Wurzelrelativ ist hier richtig: diese Seite ist
                                 die oberste Huelle, nicht der Karten-iframe. -->
                            <a class="edit-shell__menu-item" href="/html/editor-handbuch.html" target="_blank" rel="noopener">Handbuch</a>
                            <!-- Seit 23.08.2026 fuer JEDEN Editor, vorher nur Admins. Der alte
                                 Riegel schuetzte keine Daten: die Seite holt alles aus api/app/,
                                 und das ist ohne Anmeldung lesbar. Ueber dieselbe Seite laufen
                                 auch die Original-Kartenarchive -- die liegen per .htaccess dicht
                                 und kommen nur ueber api/edit/map/kartenarchiv.php heraus.
                                 Entwurf: docs/superpowers/specs/2026-08-23-kartenarchiv-und-svg-fuer-editoren-design.md -->
                            <a class="edit-shell__menu-item" href="/edit/svg-export.php" target="_blank" rel="noopener">Karte als SVG</a>
                        </section>
                        <?php if (avesmapsUserCan($currentUser, 'admin')) : ?>
                            <!-- Nur Admins, nicht Editoren: ein voller Dump traegt
                                 users.password_hash, jeden Teilen-Link und jeden Bericht; die
                                 Endpunkte halten denselben Riegel. Die Ueberschrift sagt es laut --
                                 ein Editor sieht den Block gar nicht, ein Admin daneben wuesste
                                 sonst nicht, welche Zeilen dem anderen fehlen. Sie ersetzt die
                                 Einzelmerkmale, die bis zum 23.08.2026 an den Links hingen.

                                 ⚠️ Hier stand bis zum 23.08.2026 auch „Karte als SVG". Der Riegel
                                 gilt dem, was der Block WIRKLICH schuetzt -- Passwort-Hashes und
                                 die Benutzerverwaltung. Der SVG-Export gehoerte nie dazu; er las
                                 immer nur oeffentliche Endpunkte. -->
                            <section class="edit-shell__menu-group">
                                <p class="edit-shell__menu-title">Nur Admins</p>
                                <a class="edit-shell__menu-item" href="/edit/backup.php" target="_blank" rel="noopener">Datenbank-Backup</a>
                                <a class="edit-shell__menu-item" href="/admin/" target="_blank" rel="noopener">Admin</a>
                            </section>
                        <?php endif; ?>
                        <!-- ⚠️ „Abmelden" steht unten und hinter einer eigenen Linie: ganz oben
                             laege es genau unter dem Zeiger, der eben den Knopf gedrueckt hat. -->
                        <section class="edit-shell__menu-group">
                            <form method="post" action="./">
                                <input type="hidden" name="action" value="logout" />
                                <button type="submit" class="edit-shell__menu-item">Abmelden</button>
                            </form>
                        </section>
                    </nav>
                </details>
            </header>
            <iframe class="edit-shell__map" src="<?php echo $mapIframeSrc; ?>" title="Avesmaps Karte"></iframe>
        </main>
        <!-- Ergaenzt das native <details>-Menue oben um „Klick daneben schliesst" und Esc.
             Der Stempel wird GERECHNET, nicht von Hand gepflegt: der Stamping-Schritt des
             Deploys laeuft nur ueber index.html und html/*.html und erreicht diese PHP-Seite
             nie (AGENTS.md §7). Dasselbe filemtime-Muster wie beim Karten-iframe weiter oben --
             so kann der Verweis gar nicht erst veralten. -->
        <script src="<?php echo htmlspecialchars($menuScriptSrc, ENT_QUOTES, 'UTF-8'); ?>" defer></script>
    <?php endif; ?>
</body>

</html>
