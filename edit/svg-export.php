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
    // ⚠️ KEINE Ebene "Regionen": der Payload führt keinen feature_type 'region' (gemessen
    // 14.08.2026 an 11.810 Features -- location, crossing, path, junction, label, powerline).
    // Was man dafür hielte, sind die Landschaften-Flächen.
    //
    // 🔴 ALLE Unterarten und Zahlen sind AM 14.08.2026 GEGEN DIE LIVE-API GEMESSEN, nicht
    // erfunden. Die Zahlen zeigen die Größenordnung, sie sind keine Zusicherung -- das echte
    // Zählwerk steht nach dem Bauen in der Tabelle unten.
    //
    // Der Baum hat drei Stufen, und die zweite und dritte beantworten VERSCHIEDENE Fragen:
    // bei den Landschaften steuert die Art (Vegetation/Topographie/…) den ABRUF -- was nicht
    // angehakt ist, wird gar nicht erst geladen --, der Geländetyp darunter das ZEICHNEN.
    //
    // Herrschaftsgebiete bekommen bewusst KEINE Unterarten: alle 166 tragen denselben
    // type ('region'), es gäbe also genau ein Kästchen.
    [
        'key' => 'landschaften', 'label' => 'Landschaften & Küste',
        'note' => 'Kontinente, Inseln, Meere, Vegetation, Klimazonen',
        'childLabel' => 'Ebenen (nicht Angehaktes wird gar nicht erst geladen)',
        'children' => [
            [
                'key' => 'derographisch', 'label' => 'Derographisch', 'note' => '64',
                'childLabel' => 'Typen',
                'children' => [
                    // Der Rueckfall aus dem Bauer: 48 derographische plus 1 topographische Flaeche
                    // tragen keinen region_type. EIN Kaestchen fuer beide -- der Topf ist artuebergreifend.
                    ['key' => 'ohne_typ', 'label' => 'ohne Typ', 'note' => '49'],
                    ['key' => 'region', 'label' => 'Region', 'note' => '14'],
                    ['key' => 'kontinent', 'label' => 'Kontinent', 'note' => '1'],
                    ['key' => 'inselgruppe', 'label' => 'Inselgruppe', 'note' => '1'],
                ],
            ],
            [
                'key' => 'vegetation', 'label' => 'Vegetation', 'note' => '145',
                'childLabel' => 'Typen',
                'children' => [
                    ['key' => 'wald', 'label' => 'Wald', 'note' => '90'],
                    ['key' => 'suempfe_moore', 'label' => 'Sümpfe & Moore', 'note' => '18'],
                    ['key' => 'flussland_flusstal', 'label' => 'Flussland & Flusstal', 'note' => '15'],
                    ['key' => 'wuestenoase', 'label' => 'Wüstenoase', 'note' => '9'],
                    ['key' => 'steppe', 'label' => 'Steppe', 'note' => '4'],
                    ['key' => 'graslandschaft', 'label' => 'Graslandschaft', 'note' => '4'],
                    ['key' => 'wueste', 'label' => 'Wüste', 'note' => '3'],
                    ['key' => 'auenlandschaft', 'label' => 'Auenlandschaft', 'note' => '2'],
                ],
            ],
            [
                'key' => 'topographie', 'label' => 'Topographie', 'note' => '641',
                'childLabel' => 'Typen',
                'children' => [
                    ['key' => 'see', 'label' => 'See', 'note' => '298'],
                    ['key' => 'insel', 'label' => 'Insel', 'note' => '222'],
                    ['key' => 'gebirge', 'label' => 'Gebirge', 'note' => '59'],
                    ['key' => 'meer', 'label' => 'Meer', 'note' => '32'],
                    ['key' => 'huegelland', 'label' => 'Hügelland', 'note' => '9'],
                    ['key' => 'tal', 'label' => 'Tal', 'note' => '6'],
                    ['key' => 'tiefebene', 'label' => 'Tiefebene', 'note' => '4'],
                    ['key' => 'wadi', 'label' => 'Wadi', 'note' => '4'],
                    ['key' => 'hochebene', 'label' => 'Hochebene', 'note' => '3'],
                    ['key' => 'flussdelta', 'label' => 'Flussdelta', 'note' => '2'],
                    ['key' => 'kueste', 'label' => 'Küste', 'note' => '1'],
                ],
            ],
            [
                'key' => 'klima', 'label' => 'Klimazonen', 'note' => '8',
                'childLabel' => 'Zonen',
                'children' => [
                    ['key' => 'polar', 'label' => 'Polar', 'note' => ''],
                    ['key' => 'subpolar', 'label' => 'Subpolar', 'note' => ''],
                    ['key' => 'boreal', 'label' => 'Boreal', 'note' => ''],
                    ['key' => 'gemaessigt', 'label' => 'Gemäßigt', 'note' => ''],
                    ['key' => 'subtropen_winterfeucht', 'label' => 'Subtropen, winterfeucht', 'note' => ''],
                    ['key' => 'trockene_subtropen', 'label' => 'Trockene Subtropen', 'note' => ''],
                    ['key' => 'subtropisch', 'label' => 'Subtropisch', 'note' => ''],
                    ['key' => 'tropisch', 'label' => 'Tropisch', 'note' => ''],
                ],
            ],
        ],
    ],
    ['key' => 'gebiete', 'label' => 'Herrschaftsgebiete', 'note' => 'die politischen Grenzen (166)'],
    [
        'key' => 'wege', 'label' => 'Wege', 'note' => '',
        'childLabel' => 'Wegarten',
        'children' => [
            ['key' => 'Reichsstrasse', 'label' => 'Reichsstraßen', 'note' => '352'],
            ['key' => 'Strasse', 'label' => 'Straßen', 'note' => '1.026'],
            ['key' => 'Weg', 'label' => 'Wege', 'note' => '365'],
            ['key' => 'Pfad', 'label' => 'Pfade', 'note' => '1.557'],
            ['key' => 'Gebirgspass', 'label' => 'Gebirgspässe', 'note' => '201'],
            ['key' => 'Wuestenpfad', 'label' => 'Wüstenpfade', 'note' => '35'],
            ['key' => 'Flussweg', 'label' => 'Flusswege', 'note' => '1.103'],
            ['key' => 'Seeweg', 'label' => 'Seewege', 'note' => '1.286'],
        ],
    ],
    ['key' => 'kraftlinien', 'label' => 'Kraftlinien', 'note' => '162'],
    [
        'key' => 'orte', 'label' => 'Orte', 'note' => '',
        'childLabel' => 'Ortsgrößen',
        'children' => [
            ['key' => 'metropole', 'label' => 'Metropolen', 'note' => '10'],
            ['key' => 'grossstadt', 'label' => 'Großstädte', 'note' => '34'],
            ['key' => 'stadt', 'label' => 'Städte', 'note' => '213'],
            ['key' => 'kleinstadt', 'label' => 'Kleinstädte', 'note' => '309'],
            ['key' => 'dorf', 'label' => 'Dörfer', 'note' => '1.945'],
            ['key' => 'gebaeude', 'label' => 'Gebäude', 'note' => '288'],
        ],
    ],
    ['key' => 'beschriftungen', 'label' => 'Beschriftungen', 'note' => 'als echter Text'],
];

/**
 * Einen Knoten samt Kindern ausgeben. Der Pfad (`landschaften/topographie/see`) ist die
 * Kennung im Baum; der `value` daneben trägt den ECHTEN Domänenschlüssel, der auch leer
 * sein darf (48 Landschaftsflächen haben keinen region_type).
 */
$renderNode = static function (array $node, string $parentPath, int $depth) use (&$renderNode): void {
    $key = (string) $node['key'];
    $path = $parentPath === '' ? $key : $parentPath . '/' . $key;
    $cls = $depth === 0 ? 'svgx-choice--layer' : ($depth === 1 ? 'svgx-choice--sub' : 'svgx-choice--leaf');
    ?>
    <span class="svgx-entry">
    <label class="svgx-choice <?php echo $cls; ?>">
        <input type="checkbox"
               data-svgx-node="<?php echo htmlspecialchars($path, ENT_QUOTES, 'UTF-8'); ?>"
               <?php if ($parentPath !== '') : ?>data-svgx-parent="<?php echo htmlspecialchars($parentPath, ENT_QUOTES, 'UTF-8'); ?>"<?php endif; ?>
               value="<?php echo htmlspecialchars($key, ENT_QUOTES, 'UTF-8'); ?>" checked />
        <span><?php echo htmlspecialchars((string) $node['label'], ENT_QUOTES, 'UTF-8'); ?>
            <?php if (($node['note'] ?? '') !== '') : ?>
                <span class="svgx-choice__note"><?php echo $node['note']; ?></span>
            <?php endif; ?>
        </span>
    </label>
    <?php
    // Welche Stellschrauben hat dieser Knoten? Aus Wurzel + Tiefe abgeleitet, damit die
    // Baumliste oben nicht dreissig Mal eine Angabe wiederholen muss, die sich aus der
    // Stelle ergibt: Flaechen bekommen eine Fuellung, Linien Farbe UND Kontur.
    $wurzel = explode('/', $path)[0];
    $stil = '';
    if ($wurzel === 'landschaften' && $depth === 2) { $stil = 'fill'; }
    elseif ($wurzel === 'orte' && $depth === 1) { $stil = 'fill'; }
    elseif ($wurzel === 'beschriftungen' && $depth === 0) { $stil = 'fill'; }
    elseif ($wurzel === 'gebiete' && $depth === 0) { $stil = 'stroke'; }
    elseif ($wurzel === 'wege' && $depth === 1) { $stil = 'line'; }
    elseif ($wurzel === 'kraftlinien' && $depth === 0) { $stil = 'line'; }
    ?>
    <?php if ($stil !== '') : ?>
        <span class="svgx-swatches">
            <label class="svgx-swatch" title="Farbe">
                <input type="color" data-svgx-color="<?php echo htmlspecialchars($path, ENT_QUOTES, 'UTF-8'); ?>" />
            </label>
            <?php if ($stil === 'line') : ?>
                <label class="svgx-swatch svgx-swatch--outline" title="Kontur &ndash; leer lassen heisst: keine Kontur">
                    <input type="color" data-svgx-outline="<?php echo htmlspecialchars($path, ENT_QUOTES, 'UTF-8'); ?>" />
                    <input type="checkbox" data-svgx-outline-on="<?php echo htmlspecialchars($path, ENT_QUOTES, 'UTF-8'); ?>" title="Kontur zeichnen" />
                </label>
            <?php endif; ?>
        </span>
    <?php endif; ?>
    </span>
    <?php if (!empty($node['children'])) : ?>
        <div class="svgx-children svgx-children--<?php echo $depth; ?>">
            <?php if (($node['childLabel'] ?? '') !== '') : ?>
                <p class="svgx-children__title"><?php echo htmlspecialchars((string) $node['childLabel'], ENT_QUOTES, 'UTF-8'); ?></p>
            <?php endif; ?>
            <?php foreach ($node['children'] as $child) : ?>
                <?php $renderNode($child, $path, $depth + 1); ?>
            <?php endforeach; ?>
        </div>
    <?php endif;
};

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
    <link rel="stylesheet" href="../css/pages/svg-export.css?v=20260815-svgexport-10" />
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
                    <h2 class="svgx-group__title">Wie groß?</h2>
                    <div class="svgx-size">
                        <label class="svgx-size__field">
                            <span>Kantenlänge</span>
                            <input type="number" id="svgx-size" value="32768" min="256" max="200000" step="1024" />
                            <span class="svgx-size__unit">px &times; <span id="svgx-size-echo">32768</span> px</span>
                        </label>
                        <span class="svgx-size__presets">
                            <button type="button" class="svgx-secondary" data-svgx-size="8192">8.192</button>
                            <button type="button" class="svgx-secondary" data-svgx-size="16384">16.384 &middot; Photoshop</button>
                            <button type="button" class="svgx-secondary" data-svgx-size="32768">32.768</button>
                            <button type="button" class="svgx-secondary" data-svgx-size="65536">65.536</button>
                        </span>
                    </div>
                    <p class="svgx-hint" style="margin-top:8px">
                        Die Karte ist quadratisch, eine Zahl genügt. Sie steht in
                        <code>width</code>/<code>height</code>; der Zeichenraum bleibt
                        1024&nbsp;&times;&nbsp;1024, also skaliert alles mit &ndash; Linien,
                        Punkte und Schrift. Auf die <strong>Dateigröße hat das keinen
                        Einfluss</strong>: eine Vektordatei speichert Formen, keine Bildpunkte.
                    </p>
                    <p class="svgx-hint">
                        💣 <strong>Photoshop rastert nichts über 32k.</strong> Wer dort weiter
                        arbeitet, nimmt <strong>16.384</strong> und skaliert hoch &ndash; das trifft
                        die Umrisse genau, weil 16.384 ein glatter Teiler von 32.768 ist und jede
                        Koordinate auf einem halben Bildpunkt landet statt dazwischen. Illustrator
                        und Inkscape stört die Größe nicht, sie rastern gar nicht.
                    </p>

                    <div class="svgx-size" style="margin-top:12px">
                        <label class="svgx-size__field">
                            <span>Linienstärke</span>
                            <input type="number" id="svgx-stroke" value="100" min="5" max="400" step="5" />
                            <span class="svgx-size__unit">%</span>
                        </label>
                        <span class="svgx-size__presets">
                            <button type="button" class="svgx-secondary" data-svgx-stroke="50">50&nbsp;%</button>
                            <button type="button" class="svgx-secondary" data-svgx-stroke="75">75&nbsp;%</button>
                            <button type="button" class="svgx-secondary" data-svgx-stroke="100">100&nbsp;%</button>
                            <button type="button" class="svgx-secondary" data-svgx-stroke="150">150&nbsp;%</button>
                        </span>
                    </div>
                    <p class="svgx-hint" style="margin-top:8px">
                        <strong>100&nbsp;% ist der Kartenzustand</strong>: die Stärken sind aus
                        <code>PATH_CENTER_WEIGHTS</code> hergeleitet &ndash; die Karte zieht eine
                        Reichsstraße bei voller Zoomstufe 4&nbsp;px breit, und volle Zoomstufe ist
                        genau 32.768&nbsp;px. Reichsstraße 4&nbsp;px, Straße und Weg 2,5, Fluss- und
                        Seeweg 3, Pfad, Gebirgspass und Wüstenpfad 1,5. Für Druck darf es dünner sein.
                    </p>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Glätten?</h2>
                    <div class="svgx-size">
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-smooth" />
                            <span>Linien &ndash; Wege, Fl&uuml;sse, Kraftlinien</span>
                        </label>
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-smooth-areas" />
                            <span>Fl&auml;chen &ndash; Landschaften, K&uuml;ste, Klimaz&uuml;ge</span>
                        </label>
                        <label class="svgx-size__field">
                            <span>Spannung</span>
                            <input type="number" id="svgx-tension" value="0.5" min="0" max="1" step="0.05" />
                        </label>
                    </div>
                    <p class="svgx-hint" style="margin-top:8px">
                        Dieselbe Kurve, die die Karte zeichnet &ndash; nur exakt statt abgetastet:
                        ein Catmull-Rom-Segment <em>ist</em> eine kubische Bézierkurve, also wird
                        aus jedem Streckenstück ein <code>C</code>-Befehl. Im Grafikprogramm
                        bekommst du damit echte Kurven mit Anfassern statt eines Polygonzugs.
                        <strong>Spannung 0,5</strong> ist der Wert der Karte; 0 ergibt wieder
                        gerade Strecken. ⚠️ Die Kurve überschwingt scharfe Ecken &ndash; das ist
                        so gewollt, die Karte tut es auch.
                    </p>
                    <p class="svgx-hint">
                        Die <strong>Flächen</strong> zeichnet die Karte aus Leistungsgründen eckig,
                        obwohl sie organisch sind &ndash; hier dürfen sie runden. Ein Ring wird dabei
                        <em>umlaufend</em> geglättet: sonst bekäme jede Fläche an ihrem Startpunkt
                        eine Ecke, an einer beliebigen Stelle des Umrisses.
                        🔴 <strong>Herrschaftsgebiete werden nie geglättet</strong>, auch nicht mit
                        diesem Häkchen. Eine politische Grenze ist eine Behauptung über einen
                        Verlauf, keine organische Form &ndash; gerundet verschöbe sie Land zwischen
                        Reichen und sähe dabei aus wie eine Verbesserung.
                    </p>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Welche Ebenen?</h2>
                    <p class="svgx-hint" style="margin-bottom:10px">
                        Neben jedem Eintrag steht seine Farbe. Flächen haben eine Füllung, Linien
                        Farbe <em>und</em> Kontur &ndash; die Kontur wird nur gezeichnet, wenn ihr
                        Häkchen gesetzt ist.
                    </p>
                    <?php foreach ($layers as $layer) : ?>
                        <div class="svgx-layer"><?php $renderNode($layer, '', 0); ?></div>
                    <?php endforeach; ?>
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
        <script src="../js/pages/svg-export-build.js?v=20260815-svgexport-10"></script>
        <script src="../js/pages/svg-export-page.js?v=20260815-svgexport-10"></script>
    <?php endif; ?>
</body>

</html>
