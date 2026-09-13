<?php

declare(strict_types=1);

// DIE TUER ZU DEN PASSPUNKTEN -- gegen eine SQLite-Attrappe wirklich GEFAHREN, nicht gelesen.
//
// ⭐ Die drei Abfragen des Lesers sind bewusst portabel gehalten (kein MySQL-Idiom), und genau
// deshalb laesst sich der Leser hier ausfuehren statt nur sein Quelltext pruefen. Das ist im
// Haus die Regel und nicht die Ausnahme: ein Regex kennt keinen Geltungsbereich.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           -d extension=php_mbstring.dll \
//           api/_internal/import/__tests__/garetien-passpunkte-lesen-test.php

require_once __DIR__ . '/../garetien-passpunkte-lesen.php';

$pruefungen = 0;
function pruefe(bool $bedingung, string $warum): void
{
    global $pruefungen;
    assert($bedingung, $warum);
    $pruefungen++;
}

/** Eine Attrappe beider Karten. */
function avesmapsGaretienTestDatenbank(array $ihre, array $unsere): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY, run_id INTEGER, '
        . 'typ TEXT, anzeige TEXT, artikel TEXT, geo_art TEXT, geo TEXT)');
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, '
        . 'feature_type TEXT, feature_subtype TEXT, is_active INTEGER, geometry_json TEXT)');

    $pdo->exec('INSERT INTO garetien_import_run (id) VALUES (7), (9)');

    $z = $pdo->prepare('INSERT INTO garetien_import_row (run_id, typ, anzeige, artikel, geo_art, geo)'
        . ' VALUES (:r, :t, :a, :ar, :ga, :g)');
    foreach ($ihre as $e) {
        $z->execute([
            ':r'  => $e['run'] ?? 9,
            ':t'  => $e['typ'] ?? 'Dorf',
            ':a'  => $e['name'],
            ':ar' => $e['name'],
            ':ga' => $e['geo_art'] ?? 'koordinaten',
            ':g'  => $e['geo'],
        ]);
    }

    $u = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype,'
        . ' is_active, geometry_json) VALUES (:p, :n, :t, :s, :a, :g)');
    foreach ($unsere as $i => $e) {
        $u->execute([
            ':p' => 'pid-' . $i,
            ':n' => $e['name'],
            ':t' => $e['typ'] ?? 'location',
            ':s' => $e['subtyp'] ?? 'dorf',
            ':a' => $e['aktiv'] ?? 1,
            // 🔴 GeoJSON-Reihenfolge [x, y]. Vertauscht waere sie die Falle, gegen die
            // avesmapsGaretienPasspunkteSelbstpruefung gebaut ist.
            ':g' => json_encode(['type' => 'Point', 'coordinates' => [$e['ax'], $e['ay']]]),
        ]);
    }

    return $pdo;
}

/** Welche Wagenhalt-Koordinate landet unter der ausgelieferten Matrix auf (ax|ay)? */
function avesmapsGaretienTestRueckwaerts(float $ax, float $ay): array
{
    $det = AVESMAPS_GARETIEN_MATRIX_XX * AVESMAPS_GARETIEN_MATRIX_YY
         - AVESMAPS_GARETIEN_MATRIX_XY * AVESMAPS_GARETIEN_MATRIX_YX;
    $ux  = $ax - AVESMAPS_GARETIEN_MATRIX_X0;
    $uy  = $ay - AVESMAPS_GARETIEN_MATRIX_Y0;

    return [
        (AVESMAPS_GARETIEN_MATRIX_YY * $ux - AVESMAPS_GARETIEN_MATRIX_XY * $uy) / $det,
        (AVESMAPS_GARETIEN_MATRIX_XX * $uy - AVESMAPS_GARETIEN_MATRIX_YX * $ux) / $det,
    ];
}

// =============================================================================================
// §A  DAS PAAREN
// =============================================================================================

[$g1x, $g1y] = avesmapsGaretienTestRueckwaerts(500.0, 520.0);
[$g2x, $g2y] = avesmapsGaretienTestRueckwaerts(540.0, 530.0);

$pdo = avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Eslamsroden', 'geo' => "{$g1x} {$g1y}"],
        ['name' => 'Waldrast',    'geo' => "{$g2x} {$g2y}"],
        ['name' => 'NurBeiIhnen', 'geo' => '1000 2000'],
    ],
    [
        ['name' => 'Eslamsroden', 'ax' => 500.0, 'ay' => 520.0],
        ['name' => 'Waldrast',    'ax' => 540.0, 'ay' => 530.0],
        ['name' => 'NurBeiUns',   'ax' => 600.0, 'ay' => 600.0],
    ]
);

$erg = avesmapsGaretienPasspunkteLesen($pdo);
pruefe(count($erg['paare']) === 2, 'zwei Paare, gefunden: ' . count($erg['paare']));
pruefe($erg['bericht']['lauf'] === 9, 'ohne Angabe gilt der JUENGSTE Lauf, hier: ' . $erg['bericht']['lauf']);
pruefe($erg['bericht']['nur_bei_ihnen'] === 1, 'ein Ort nur bei ihnen');

// --- A1: 💣 DIE ACHSEN STEHEN RICHTIG HERUM.
// Die Paare sind rueckwaerts aus der ausgelieferten Matrix gebaut -- ihr Residuum MUSS
// deshalb praktisch null sein. Waere `coordinates` als [y,x] gelesen, laege es bei
// Hunderten von Meilen. Genau so sieht ein vertauschter Achsenleser aus, und genau so
// saehe er wie ein gewaltiger, zusammenhaengender "Versatz" aus.
foreach (avesmapsGaretienPasspunktResiduen($erg['paare']) as $r) {
    pruefe($r['betrag'] < 0.01, "{$r['name']} muss auf sich selbst fallen: {$r['betrag']} Meilen");
}

// =============================================================================================
// §B  DIE FILTER
// =============================================================================================

// --- B1: 🔴 EIN NAME, DER AUF EINER SEITE DOPPELT VORKOMMT, IST KEIN PASSPUNKT.
// Entwurf §2.4: 70 von 219 namensgleichen Orten waren VERSCHIEDENE Orte. Der robuste Filter
// faengt sie hinterher an ihrem Abstand -- aber nur, wenn sie weit genug auseinanderliegen.
// Zwei "Waldheim" 20 Meilen entfernt rutschen durch und ziehen die Matrix leise schief.
$pdo2 = avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Hueterkloster', 'geo' => "{$g1x} {$g1y}"],
        ['name' => 'Eindeutig',     'geo' => "{$g2x} {$g2y}"],
    ],
    [
        ['name' => 'Hueterkloster', 'ax' => 500.0, 'ay' => 520.0],
        ['name' => 'Hueterkloster', 'ax' => 700.0, 'ay' => 300.0],   // der zweite
        ['name' => 'Eindeutig',     'ax' => 540.0, 'ay' => 530.0],
    ]
);
$erg2 = avesmapsGaretienPasspunkteLesen($pdo2);
pruefe(count($erg2['paare']) === 1, 'der doppelte Name muss fallen, Paare: ' . count($erg2['paare']));
pruefe($erg2['paare'][0]['name'] === 'Eindeutig', 'uebrig bleibt der eindeutige');
pruefe($erg2['bericht']['mehrdeutig_verworfen'] === 1, 'und er wird BERICHTET, nicht verschwiegen');
pruefe(in_array('Hueterkloster', $erg2['bericht']['mehrdeutige_namen'], true), 'mit Namen genannt');

// --- B2: 💣 DIE MARKE "existiert, aber noch nicht platziert" IST KEIN ORT.
// 360 Zeilen tragen `2000000 2000000`. Als Passpunkt genommen zerrisse EINER von ihnen jede
// Anpassung -- er liegt rund 600 Karteneinheiten neben der Karte.
$pdo3 = avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Platziert',   'geo' => "{$g1x} {$g1y}"],
        ['name' => 'Unplatziert', 'geo' => '2000000 2000000'],
    ],
    [
        ['name' => 'Platziert',   'ax' => 500.0, 'ay' => 520.0],
        ['name' => 'Unplatziert', 'ax' => 540.0, 'ay' => 530.0],
    ]
);
$erg3 = avesmapsGaretienPasspunkteLesen($pdo3);
pruefe(count($erg3['paare']) === 1, 'die Marke darf kein Passpunkt werden');
pruefe($erg3['paare'][0]['name'] === 'Platziert', 'uebrig bleibt der platzierte');

// --- B3: Ein UMRISS ist kein Ort -- mehrere Punkte heissen Flaeche, nicht Ortschaft.
$pdo4 = avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Punktort', 'geo' => "{$g1x} {$g1y}"],
        ['name' => 'Umriss',   'geo' => "{$g1x} {$g1y}, {$g2x} {$g2y}"],
    ],
    [
        ['name' => 'Punktort', 'ax' => 500.0, 'ay' => 520.0],
        ['name' => 'Umriss',   'ax' => 540.0, 'ay' => 530.0],
    ]
);
pruefe(count(avesmapsGaretienPasspunkteLesen($pdo4)['paare']) === 1, 'ein Umriss ist kein Passpunkt');

// --- B4: Ein geloeschter Ort zaehlt nicht -- und macht seinen Namen auch nicht mehrdeutig.
$pdo5 = avesmapsGaretienTestDatenbank(
    [['name' => 'Rockenwald', 'geo' => "{$g1x} {$g1y}"]],
    [
        ['name' => 'Rockenwald', 'ax' => 500.0, 'ay' => 520.0],
        ['name' => 'Rockenwald', 'ax' => 900.0, 'ay' => 100.0, 'aktiv' => 0],
    ]
);
$erg5 = avesmapsGaretienPasspunkteLesen($pdo5);
pruefe(count($erg5['paare']) === 1, 'der inaktive Zwilling darf den Passpunkt nicht kosten');

// =============================================================================================
// §C  DIE SELBSTPRUEFUNG
// =============================================================================================

// --- C1: Zu wenige Paare sind KEINE Aussage.
$wenig = avesmapsGaretienPasspunkteSelbstpruefung($erg['paare']);
pruefe($wenig['ok'] === false, 'zwei Paare duerfen nicht als geprueft durchgehen');
pruefe(str_contains($wenig['warnung'], 'zu wenige'), 'und der Grund wird genannt');

// --- C2: 💣 EINE VERTAUSCHTE ACHSE MUSS AUFFALLEN.
// Das ist der ganze Zweck der Selbstpruefung. Ein Leser, der `coordinates` als [y,x] nimmt,
// liefert lauter grosse, gleichgerichtete Residuen -- das sieht aus wie ein gewaltiger
// Versatz und braechte jemanden dazu, eine Korrekturmatrix dagegen zu bauen.
$vertauscht = [];
for ($i = 0; $i < 20; $i++) {
    $ax = 500.0 + $i * 5.0;
    $ay = 520.0 + $i * 3.0;
    [$gx, $gy] = avesmapsGaretienTestRueckwaerts($ax, $ay);
    // Die Karte liest x und y vertauscht zurueck.
    $vertauscht[] = ['name' => "V{$i}", 'gx' => $gx, 'gy' => $gy, 'ax' => $ay, 'ay' => $ax];
}
$pruefung = avesmapsGaretienPasspunkteSelbstpruefung($vertauscht);
pruefe($pruefung['ok'] === false, 'vertauschte Achsen MUESSEN die Selbstpruefung roetlich machen');
pruefe(str_contains($pruefung['warnung'], 'Achsen'), 'und die Warnung muss den Verdacht benennen');

// --- C3: Richtig herum gelesen geht sie durch.
$richtig = [];
for ($i = 0; $i < 20; $i++) {
    $ax = 500.0 + $i * 5.0;
    $ay = 520.0 + $i * 3.0;
    [$gx, $gy] = avesmapsGaretienTestRueckwaerts($ax, $ay);
    $richtig[] = ['name' => "R{$i}", 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
}
$ok = avesmapsGaretienPasspunkteSelbstpruefung($richtig);
pruefe($ok['ok'] === true, 'saubere Paare muessen durchgehen');
pruefe($ok['warnung'] === '', 'und dann steht da keine Warnung');

// =============================================================================================
// §D  DIE VERDRAHTUNG IM ENDPUNKT
// =============================================================================================
//
// ⚠️ Quelltext, nicht Ablauf -- der Endpunkt braucht Sitzung und MySQL. Geprueft wird das
// eine, was hier still schiefgehen kann: dass die Aktion ueberhaupt erreichbar ist und dass
// sie NICHT in der Admin-Liste steht (sie ist rein lesend und fuer Editoren gedacht).
$quelle = file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php');
pruefe(str_contains($quelle, "\$action === 'passpunkte'"), 'die Aktion muss im Endpunkt stehen');
pruefe(str_contains($quelle, 'garetien-passpunkte-lesen.php'), 'und ihre Bibliothek geladen werden');
pruefe(preg_match("~in_array\(\\\$action, \[([^\]]*)\]~", $quelle, $t) === 1, 'Admin-Liste gefunden');
pruefe(!str_contains($t[1], 'passpunkte'), 'die Messung ist rein lesend und bleibt aussen vor');

// --- D1: 💣 SIE DARF IN KEINE TABELLE SCHREIBEN.
// Eine Messung, die den Bestand anfasst, ist keine Messung mehr. Der Leser kennt deshalb
// weder INSERT noch UPDATE noch DELETE.
$leser = file_get_contents(__DIR__ . '/../garetien-passpunkte-lesen.php');
$ohneKommentar = preg_replace('~//[^\n]*~', '', $leser) ?? $leser;
foreach (['INSERT', 'UPDATE ', 'DELETE', 'CREATE', 'ALTER', 'DROP'] as $verb) {
    pruefe(!str_contains($ohneKommentar, $verb), "der Passpunkt-Leser darf kein {$verb} kennen");
}

echo "OK: {$pruefungen} Pruefungen\n";
