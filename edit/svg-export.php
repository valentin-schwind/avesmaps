<?php

declare(strict_types=1);

/**
 * SVG-Export page (Faehigkeit `edit`).
 * ---------------------------------------------------------------------------
 * Reached from the "Karte herunterladen" link in the edit shell's menu. Tick the layers,
 * pick the target program, press the button: the BROWSER assembles a vector drawing of
 * the whole map and downloads it. Below that, the original map archives.
 *
 * ⚠️ Die Seite hiess bis zum 24.08.2026 "Karte als SVG" -- an vier Stellen, und eine davon
 * ist der Menueeintrag der Huelle. Umbenannt, weil sie seit dem 23.08. ZWEI Dinge anbietet:
 * den Vektorabzug und die Originalarchive. Die KENNUNGEN heissen unveraendert weiter nach
 * dem Format (Dateiname, `svgx-*`, `#svgx-title`) -- dieselbe Trennung wie bei
 * "Neuigkeiten"/`changelog` (AGENTS.md §11): der Deploy loescht nie, und eine umgetaufte
 * Adresse liesse jeden gespeicherten Verweis ins Leere greifen.
 *
 * Nothing runs on the server here beyond this shell. The heavy lifting is
 * js/pages/svg-export-build.js (pure, unit-tested), js/pages/svg-export-farben.js (the
 * default colours) plus js/pages/svg-export-page.js (fetch + Blob). A PHP renderer would
 * have to restate the map's appearance a second time -- and hold a 30 MB string on
 * shared hosting.
 *
 * Derselbe Bauer laeuft seit 23.08.2026 auch OHNE Browser: tools/svg-export/abzug-bauen.js
 * baut naechtlich denselben Abzug fuer GET /api/svg-export.php. Deshalb liegen die
 * Vorgabefarben in svg-export-farben.js und nicht mehr hier im Kitt -- zwei Fassungen
 * derselben Regel laufen auseinander, sobald ein neuer Gelaendetyp dazukommt.
 *
 * FAEHIGKEIT `edit` -- seit 23.08.2026, vorher `admin`. Der alte Riegel schuetzte KEINE
 * Daten: die Seite holt alles aus api/app/map-features.php, api/app/political-territories.php
 * und api/app/ecosystem-areas.php, und alle drei sind ohne Anmeldung lesbar (gemessen am
 * 23.08.2026: keiner von ihnen ruft avesmapsRequireUserWithCapability). Er war Vorsicht,
 * kein Schutz.
 * ⚠️ Nicht zu verwechseln mit edit/backup.php nebenan -- ein voller Dump traegt
 * `users.password_hash` und bleibt `admin`.
 *
 * Diese Seite bietet ausserdem die ORIGINALARCHIVE aus uploads/map/ an (Abschnitt ganz unten).
 * Die liegen per .htaccess dicht und kommen nur ueber api/edit/map/kartenarchiv.php heraus;
 * warum das eine vertretbare Ausnahme von Befund A25 ist, steht im Kopf von
 * api/_internal/map/kartenarchiv.php.
 * Entwurf: docs/superpowers/specs/2026-08-23-kartenarchiv-und-svg-fuer-editoren-design.md
 *
 * Design: docs/superpowers/specs/2026-08-14-svg-export-design.md
 */

require __DIR__ . '/../api/auth.php';
require_once __DIR__ . '/../api/_internal/map/kartenarchiv.php';

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
    if ($user !== null && avesmapsUserCan($user, 'edit')) {
        header('Location: ./svg-export.php');
        exit;
    }

    avesmapsLogout();
    $loginError = 'Login fehlgeschlagen oder keine Editor-Berechtigung.';
}

$currentUser = avesmapsCurrentUser();
$isEditor = $currentUser !== null && avesmapsUserCan($currentUser, 'edit');

// Die Originalarchive: was in uploads/map/ TATSAECHLICH liegt, nicht ein hartkodiertes v2.05.
// Die Begruendung steht im Kopf der Bibliothek -- es ist dieselbe, mit der der Owner seine
// .htaccess nach ENDUNG statt nach Dateinamen filtert.
$kartenarchive = $isEditor ? avesmapsKartenarchivListe() : [];

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
            // „Bach" ist keine gespeicherte Wegart, sondern ein Flussweg mit Häkchen
            // (properties.is_bach) -- der Export gruppiert ihn trotzdem eigen, weil er
            // schmaler gezeichnet wird. Ohne dieses Kästchen wäre er die einzige Art
            // im Abzug, die sich nicht abwählen lässt.
            ['key' => 'Bach', 'label' => 'Bäche', 'note' => 'Flusswege mit Häkchen „Bach“'],
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
    if ($wurzel === 'landschaften' && $depth === 2) { $stil = 'line'; }
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
    <title>Avesmaps &ndash; Karte herunterladen</title>
    <!-- Hand-written on purpose: the deploy's asset stamper only follows index.html and
         html/*.html, so it never reaches this PHP page. Bump these whenever the stylesheet
         or either script changes, or editors keep the cached files. See AGENTS.md sec.7. -->
    <link rel="stylesheet" href="../css/pages/svg-export.css?v=20260824-karte-herunterladen" />
</head>

<body class="edit-page">
    <?php if (!$isEditor) : ?>
        <main class="edit-login">
            <form class="edit-login__panel" method="post" action="./svg-export.php">
                <input type="hidden" name="action" value="login" />
                <h1>Karte herunterladen</h1>
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
        <main class="svgx-shell">
            <header class="edit-shell__bar">
                <div>
                    <strong>Karte herunterladen</strong>
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
                <h1 id="svgx-title">Karte herunterladen</h1>
                <p class="svgx-lead">Die ganze Karte als <strong>bearbeitbare Vektorgrafik</strong>: jede Ebene eine Gruppe, jedes Element benannt.</p>
                <p class="svgx-hint">Der Browser baut die Datei; die Kartendaten sind rund 20&nbsp;MB, das dauert einen Moment. Tab offen lassen.</p>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Für welches Programm?</h2>
                    <fieldset class="svgx-choices">
                        <label class="svgx-choice">
                            <input type="radio" name="svgx-dialect" value="illustrator" />
                            <span>Illustrator
                                <span class="svgx-choice__note">&ndash; Objektnamen stehen in der <code>id</code></span>
                            </span>
                        </label>
                        <label class="svgx-choice">
                            <input type="radio" name="svgx-dialect" value="inkscape" checked />
                            <span>Inkscape
                                <span class="svgx-choice__note">&ndash; echte Ebenen, Namen in <code>inkscape:label</code></span>
                            </span>
                        </label>
                    </fieldset>
                    <p class="svgx-hint">Illustrator liest Objektnamen aus der <code>id</code>, Inkscape aus <code>inkscape:label</code> &ndash; eine Datei kann nur einem von beiden lesbare Namen zeigen.</p>
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
                    <p class="svgx-hint">Steht in <code>width</code>/<code>height</code>, der Zeichenraum bleibt 1024 &ndash; alles skaliert mit. Ohne Einfluss auf die Dateigröße.</p>
                    <div class="svgx-size" style="margin-top:12px">
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-semantics" checked />
                            <span>Semantische Metadaten (f&uuml;r Bildgenerierung)</span>
                        </label>
                    </div>
                    <p class="svgx-hint" style="margin-top:8px">
                        Jedes Element tr&auml;gt <code>avm:kind</code>, <code>avm:type</code> sowie
                        <code>avm:klima</code> und <code>avm:relief</code> &ndash; also auch, <em>worin</em>
                        es liegt. Damit unterscheidet ein Prompt Wald in tropischer von Wald in borealer
                        Zone. Nur Fakten, keine Deutung; das Vokabular steht im Kopf der Datei.
                    </p>

                    <div class="svgx-size" style="margin-top:12px">
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-regmarks" />
                            <span>Passmarken in jede Ebene legen</span>
                        </label>
                    </div>
                    <p class="svgx-hint">Für Photoshop: beim Rastern beschneidet es jede Ebene auf ihren Inhalt. Vier magenta 1-px-Ecken je Ebene halten die volle Leinwand &ndash; danach löschbar über die Gruppe „Passmarken".</p>

                    <p class="svgx-hint">💣 Photoshop rastert nichts über 32k &ndash; dort <strong>16.384</strong> nehmen und hochskalieren (glatter Teiler, trifft die Umrisse genau).</p>

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
                    <p class="svgx-hint">100&nbsp;% ist der Kartenzustand (aus <code>PATH_CENTER_WEIGHTS</code>: Reichsstraße 4&nbsp;px, Straße 2,5, Fluss 3, Pfad 1,5). Für Druck darf es dünner sein.</p>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Glätten?</h2>
                    <div class="svgx-size">
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-smooth" checked />
                            <span>Linien &ndash; Wege, Fl&uuml;sse, Kraftlinien</span>
                        </label>
                        <label class="svgx-choice">
                            <input type="checkbox" id="svgx-smooth-areas" checked />
                            <span>Fl&auml;chen &ndash; Landschaften, K&uuml;ste, Klimaz&uuml;ge</span>
                        </label>
                        <label class="svgx-size__field">
                            <span>Spannung</span>
                            <input type="number" id="svgx-tension" value="0.5" min="0" max="1" step="0.05" />
                        </label>
                    </div>
                    <p class="svgx-hint">Echte Bézierkurven statt Polygonzug &ndash; dieselbe Kurve wie auf der Karte. <strong>Spannung 0,5</strong> ist deren Wert, 0 ergibt gerade Strecken.</p>
                    <p class="svgx-hint">Flächen werden <em>umlaufend</em> geglättet (sonst bekäme jede eine Ecke am Startpunkt). 🔴 <strong>Herrschaftsgebiete nie</strong> &ndash; eine gerundete Grenze verschöbe Land zwischen Reichen.</p>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">Welche Ebenen?</h2>
                    <p class="svgx-hint" style="margin-bottom:10px">Farbe je Eintrag; das kleine Feld daneben ist die <strong>Kontur</strong> und zeichnet nur mit Häkchen.</p>
                    <?php foreach ($layers as $layer) : ?>
                        <div class="svgx-layer"><?php $renderNode($layer, '', 0); ?></div>
                    <?php endforeach; ?>
                </div>

                <div class="svgx-actions">
                    <button type="button" class="svgx-start" id="svgx-start">SVG erzeugen</button>
                    <button type="button" class="svgx-secondary" id="svgx-all">Alle</button>
                    <button type="button" class="svgx-secondary" id="svgx-none">Keine</button>
                </div>

                <div class="svgx-group">
                    <h2 class="svgx-group__title">F&uuml;r die API hinterlegen</h2>
                    <p class="svgx-hint">Baut einen <strong>vollst&auml;ndigen</strong> Abzug und legt
                        ihn auf dem Server ab, wo <code>GET /api/svg-export.php</code> ihn gegen einen
                        Token ausliefert. 🔴 Die Einstellungen oben gelten dabei <strong>nicht</strong>
                        &ndash; sie geh&ouml;ren deinem Download. Der API-Abzug ist eine Datenquelle und
                        kommt immer gleich: Inkscape, 32.768&nbsp;px, alle Ebenen, volle Semantik,
                        nichts gegl&auml;ttet. Genau das baut auch die n&auml;chtliche Routine, dieser
                        Knopf holt es nur sofort.</p>
                    <p class="svgx-hint">L&auml;dt die Kartendaten neu (rund 20&nbsp;MB) &ndash; dauert
                        einen Moment, unabh&auml;ngig davon, was du oben erzeugt hast.</p>
                    <div class="svgx-actions">
                        <button type="button" class="svgx-secondary" id="svgx-deposit">
                            Vollst&auml;ndigen Abzug hinterlegen
                        </button>
                    </div>
                    <p class="svgx-status" id="svgx-deposit-status" role="status" aria-live="polite"></p>
                </div>

                <p class="svgx-status" id="svgx-status" role="status" aria-live="polite"></p>

                <table class="svgx-stats" id="svgx-stats" hidden>
                    <thead>
                        <tr><th>Ebene</th><th>Objekte</th></tr>
                    </thead>
                    <tbody id="svgx-stats-body"></tbody>
                </table>
                <!-- Die Originalarchive. Sie haben mit dem SVG-Bauer oben nichts zu tun und stehen
                     deshalb ganz unten, hinter dem Zaehlwerk -- derselbe Personenkreis, andere
                     Handlung. Gruppiert per Trennlinie und Ueberschrift wie jeder andere Abschnitt
                     dieser Seite (design-language.md: kein Rahmenkasten).

                     💣 Die Liste ist GERECHNET, nicht geschrieben: sie zeigt, was in uploads/map/
                     tatsaechlich liegt. Ein hartkodiertes „v2.05" waere nach dem naechsten
                     Kartenexport ein toter Verweis, und niemandem fiele auf, warum -- es ist
                     dieselbe Ueberlegung, mit der die .htaccess des Ordners nach ENDUNG statt nach
                     Dateinamen sperrt.

                     ⚠️ Der Knopf ist WEICH (.svgx-secondary), nicht gefuellt: die Haupthandlung
                     dieser Seite ist „SVG erzeugen", und eine Zeilenhandlung ist nie die
                     Haupthandlung (design-language.md). -->
                <div class="svgx-group">
                    <h2 class="svgx-heading">Originalkarte herunterladen</h2>
                    <p class="svgx-lead">Das Bildmaterial, aus dem diese Karte gebaut ist &ndash; die Gesamtkarte und die fertigen Kacheln.</p>
                    <?php if ($kartenarchive === []) : ?>
                        <p class="svgx-hint">In <code>uploads/map/</code> liegt derzeit kein Archiv.</p>
                    <?php else : ?>
                        <ul class="svgx-archive">
                            <?php foreach ($kartenarchive as $archiv) : ?>
                                <li class="svgx-archive__row">
                                    <span class="svgx-archive__name"><?php echo htmlspecialchars((string) $archiv['name'], ENT_QUOTES, 'UTF-8'); ?></span>
                                    <span class="svgx-archive__meta"><?php echo htmlspecialchars(avesmapsKartenarchivGroesse((int) $archiv['size']), ENT_QUOTES, 'UTF-8'); ?> &middot; <?php echo date('d.m.Y', (int) $archiv['mtime']); ?></span>
                                    <a class="svgx-secondary svgx-archive__button" href="/api/edit/map/kartenarchiv.php?datei=<?php echo rawurlencode((string) $archiv['name']); ?>">Herunterladen</a>
                                </li>
                            <?php endforeach; ?>
                        </ul>
                        <p class="svgx-hint">Gro&szlig;e Dateien &ndash; der Browser darf abbrechen und fortsetzen, es f&auml;ngt nicht wieder von vorn an.</p>
                    <?php endif; ?>
                    <p class="svgx-hint">
                        Arbeitsmaterial f&uuml;r die Kartenpflege, <strong>nicht zur Weitergabe</strong>: das Projekt hat zugesagt,
                        kein reines Bilderarchiv zu sein (<code>NOTICE.md</code>), &ouml;ffentlich sind die Archive deshalb gesperrt.
                        Jeder Download wird mit Namen festgehalten.
                    </p>
                </div>
            </section>
        </main>
        <!-- 🔴 VOR svg-export-page.js: die Seite liest daraus avesmapsResolveLocationZoomBands, um
             die Ortszirkel im Maßstab der höchsten Zoomstufe zu zeichnen. Ohne diese Zeile fällt
             der Abzug still auf die Vorgabetafel des Bauers zurück -- gleicher Maßstab, aber die
             Übersteuerung eines Admins wirkt nicht mehr.
             ⚠️ Diese Datei ruft von sich aus NICHTS ab (siehe ihren Kopf); den Abruf macht
             svg-export-page.js über /api/app/zoom-bands.php. -->
        <script src="../js/map-features/location-zoom-bands.js?v=20260822-svgexport-17"></script>
        <!-- ⚠️ ZUERST: svg-export-build.js zeichnet die Kurvenform der Kraftlinien mit der
             GETEILTEN Regel (avesmapsPowerlineCurvedPoints) -- dieselbe, die die Karte fährt.
             Fehlt sie, wirft der Abzug laut, statt die Linien still gerade zu zeichnen. -->
        <script src="../js/map-features/powerline-topology.js?v=20260829-svgexport-20"></script>
        <script src="../js/pages/svg-export-build.js?v=20260829-svgexport-20"></script>
        <script src="../js/pages/svg-export-farben.js?v=20260829-svgexport-20"></script>
        <script src="../js/pages/svg-export-page.js?v=20260829-svgexport-20"></script>
    <?php endif; ?>
</body>

</html>
