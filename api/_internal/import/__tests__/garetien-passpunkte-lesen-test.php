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

// --- B5: ⭐ EINE BURG UND IHRE STADT DESSELBEN NAMENS SIND EIN ORT, NICHT ZWEI.
// Messlauf 14.09.2026 (Entwurf §3.1): Garetien fuehrt "Eslamsroden" als Burg UND als Reichsstadt,
// 0,85 Meilen auseinander. B1 verwarf den Namen, und einer der elf von den Editoren genannten
// Kalibrierorte fehlte. Die Ausnahme ist eng: GENAU EINE Siedlung, alle anderen Vorkommen
// Bauwerke, jedes innerhalb der Punkt-Trefferschwelle des Importers von ihr -- dann gilt die Siedlung.
[$sx, $sy] = avesmapsGaretienTestRueckwaerts(500.2, 520.1);
[$bx, $by] = avesmapsGaretienTestRueckwaerts(500.0, 520.0);   // die Burg, 0,22 Einheiten daneben
[$ux, $uy] = avesmapsGaretienTestRueckwaerts(560.0, 540.0);
$pdo6 = avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Eslamsroden',  'typ' => 'Burg',        'geo' => "{$bx} {$by}"],
        ['name' => 'Eslamsroden',  'typ' => 'Reichsstadt', 'geo' => "{$sx} {$sy}"],
        ['name' => 'Gryffenwacht', 'typ' => 'Burg',        'geo' => "{$ux} {$uy}"],
    ],
    [
        ['name' => 'Eslamsroden',  'subtyp' => 'grossstadt', 'ax' => 500.2, 'ay' => 520.1],
        ['name' => 'Gryffenwacht', 'subtyp' => 'gebaeude',   'ax' => 560.0, 'ay' => 540.0],
    ]
);
$erg6   = avesmapsGaretienPasspunkteLesen($pdo6);
$namen6 = array_column($erg6['paare'], 'name');
pruefe(in_array('Eslamsroden', $namen6, true), 'Eslamsroden muss ein Passpunkt werden: ' . implode(', ', $namen6));
pruefe(in_array('Gryffenwacht', $namen6, true), 'eine einzeln stehende Burg bleibt ein Passpunkt');
pruefe($erg6['bericht']['mehrdeutig_verworfen'] === 0, 'und nichts ist mehrdeutig');
pruefe(in_array('Eslamsroden', $erg6['bericht']['doppelungen_aufgeloest'], true), 'die Aufloesung wird BERICHTET');
foreach (avesmapsGaretienPasspunktResiduen($erg6['paare']) as $r) {
    // 💣 Die STADT, nicht die Burg: ueber die Burg gepaart laege Eslamsroden 0,67 Meilen daneben.
    pruefe($r['betrag'] < 0.01, "{$r['name']} muss ueber die Siedlung gepaart sein: {$r['betrag']} Meilen");
}

// --- B6: 💣 WEITER ALS DIE PUNKT-TREFFERSCHWELLE IST ES NICHT MEHR "DERSELBE ORT".
[$fx, $fy] = avesmapsGaretienTestRueckwaerts(501.0, 520.1);   // 0,8 Einheiten = 2,4 Meilen
$erg7 = avesmapsGaretienPasspunkteLesen(avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Eslamsroden', 'typ' => 'Burg',        'geo' => "{$fx} {$fy}"],
        ['name' => 'Eslamsroden', 'typ' => 'Reichsstadt', 'geo' => "{$sx} {$sy}"],
    ],
    [['name' => 'Eslamsroden', 'subtyp' => 'grossstadt', 'ax' => 500.2, 'ay' => 520.1]]
));
pruefe(count($erg7['paare']) === 0, 'eine Burg 2,4 Meilen neben der Stadt macht den Namen mehrdeutig');
pruefe($erg7['bericht']['mehrdeutig_verworfen'] === 1, 'und so wird er berichtet');

// --- B7: 💣 ZWEI SIEDLUNGEN DESSELBEN NAMENS BLEIBEN MEHRDEUTIG, auch dicht beieinander.
// Welche von beiden unser Ort ist, sagt keine Regel -- zwei "Waldheim" sind zwei Doerfer.
[$d2x, $d2y] = avesmapsGaretienTestRueckwaerts(500.25, 520.1);
$erg8 = avesmapsGaretienPasspunkteLesen(avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Waldheim', 'typ' => 'Dorf',  'geo' => "{$sx} {$sy}"],
        ['name' => 'Waldheim', 'typ' => 'Markt', 'geo' => "{$d2x} {$d2y}"],
    ],
    [['name' => 'Waldheim', 'ax' => 500.2, 'ay' => 520.1]]
));
pruefe(count($erg8['paare']) === 0, 'zwei Siedlungen gleichen Namens sind kein Passpunkt');

// --- B8: Dieselbe Regel gilt UNSERER Karte -- ein Filter, der nur eine Seite kennt, bindet einen
// von zwei Erzeugern.
[$ox, $oy] = avesmapsGaretienTestRueckwaerts(540.1, 530.0);
$erg9 = avesmapsGaretienPasspunkteLesen(avesmapsGaretienTestDatenbank(
    [['name' => 'Hirschfurt', 'typ' => 'Dorf', 'geo' => "{$ox} {$oy}"]],
    [
        ['name' => 'Hirschfurt', 'subtyp' => 'gebaeude', 'ax' => 540.0, 'ay' => 530.0],
        ['name' => 'Hirschfurt', 'subtyp' => 'dorf',     'ax' => 540.1, 'ay' => 530.0],
    ]
));
pruefe(count($erg9['paare']) === 1, 'unsere Burg neben unserem Dorf kostet den Passpunkt nicht');
pruefe(($erg9['paare'][0]['subtyp'] ?? '') === 'dorf', 'gepaart wird unser Dorf, nicht die Burg');
pruefe(($erg9['paare'][0]['public_id'] ?? '') === 'pid-1', 'mit seiner Kennung');

// --- B9: 🔴 EIN NAME, DER AUF JEDER KARTE NUR EINMAL VORKOMMT, IST TROTZDEM KEIN BELEG.
// Messlauf 14.09.2026: 37 von 204 Paaren lagen ueber 25 Meilen daneben -- gleichnamige, aber
// andere Orte, an denen B1 vorbeikommt. Die Tuer trennt sie mit dem geteilten Riegel ab und nennt sie.
[$wx, $wy] = avesmapsGaretienTestRueckwaerts(520.0, 600.0);
[$nx, $ny] = avesmapsGaretienTestRueckwaerts(540.0 + 20.0 / 3.0, 530.0);   // 20 Meilen Zeichenrauschen
$erg10 = avesmapsGaretienPasspunkteLesen(avesmapsGaretienTestDatenbank(
    [
        ['name' => 'Dreiwegen', 'geo' => "{$wx} {$wy}"],
        ['name' => 'Nahbei',    'geo' => "{$nx} {$ny}"],
        ['name' => 'Eindeutig', 'geo' => "{$g1x} {$g1y}"],
    ],
    [
        ['name' => 'Dreiwegen', 'ax' => 700.0, 'ay' => 450.0],
        ['name' => 'Nahbei',    'ax' => 540.0, 'ay' => 530.0],
        ['name' => 'Eindeutig', 'ax' => 500.0, 'ay' => 520.0],
    ]
));
pruefe(array_column($erg10['paare'], 'name') === ['Nahbei', 'Eindeutig'],
    'das Falschpaar faellt, das verrauschte Paar bleibt: ' . implode(', ', array_column($erg10['paare'], 'name')));
pruefe(count($erg10['falschpaare']) === 1 && $erg10['falschpaare'][0]['name'] === 'Dreiwegen',
    'die abgetrennten reisen neben den Paaren mit');
pruefe($erg10['bericht']['paare'] === 2, 'der Bericht zaehlt die behaltenen Paare');
pruefe($erg10['bericht']['falschpaare_verworfen'] === 1, 'und die abgetrennten');
pruefe(($erg10['bericht']['falschpaare'][0]['name'] ?? '') === 'Dreiwegen'
    && $erg10['bericht']['falschpaare'][0]['betrag'] > 25.0, 'mit Namen und Betrag');

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

/** Ein Paar, dessen Residuum gegen die ausgelieferte Matrix genau (dx|dy) Meilen betraegt. */
$mitVersatz = static function (string $name, float $ax, float $ay, float $dx, float $dy): array {
    [$gx, $gy] = avesmapsGaretienTestRueckwaerts($ax + $dx / 3.0, $ay + $dy / 3.0);
    return ['name' => $name, 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
};

// --- C4: 💣 DER MEDIAN ALLEIN HAT AM 14.09.2026 "ok" GESAGT -- bei Mittel 77 und p90 382 Meilen.
// 37 Falschpaare verschieben den Median kaum (1,33 -> 1,99), aber sie machen jede Zahl daneben wertlos.
$roh = [];
for ($i = 0; $i < 20; $i++) {
    $roh[] = $mitVersatz("R{$i}", 500.0 + $i * 4.0, 520.0 + ($i % 5) * 6.0, 1.3, 0.0);
}
foreach ([[-300.0, 1400.0], [450.0, -20.0], [0.0, 380.0], [210.0, 0.0]] as $j => [$dx, $dy]) {
    $roh[] = $mitVersatz("Falsch{$j}", 540.0, 530.0 + $j, $dx, $dy);
}
$c4 = avesmapsGaretienPasspunkteSelbstpruefung($roh);
pruefe($c4['median'] < 15.0, 'Vorbedingung: der Median liegt unauffaellig bei ' . $c4['median']);
pruefe($c4['ok'] === false, 'ein ungeschnittener Satz darf die Selbstpruefung NICHT bestehen');
pruefe(str_contains($c4['warnung'], 'nicht abgetrennt'), 'und sie sagt, warum: ' . $c4['warnung']);
pruefe($c4['mittel'] > 25.0 && $c4['p90'] > 25.0, 'Mittel und p90 reisen mit, damit man sie sieht');

// --- C5: Geschnitten besteht derselbe Satz -- und die Zahl der abgetrennten steht in der Antwort.
$c5schnitt = avesmapsGaretienPasspunkteFalschpaareAbtrennen($roh);
$c5 = avesmapsGaretienPasspunkteSelbstpruefung($c5schnitt['paare'], count($c5schnitt['falschpaare']));
pruefe($c5['ok'] === true, 'nach dem Schnitt muss er bestehen: ' . $c5['warnung']);
pruefe($c5['falschpaare'] === 4, 'und traegt die Zahl der abgetrennten: ' . $c5['falschpaare']);

// --- C6: 💣 DIE SCHRANKE PRUEFT SICH SELBST, AUCH OHNE DICKEN RAND. Zwei Paare knapp ueber 25
// Meilen heben das Mittel nicht ueber 3 x Median -- nur die Schranke sieht sie.
$c6 = [];
for ($i = 0; $i < 18; $i++) {
    $c6[] = $mitVersatz("C{$i}", 500.0 + $i * 4.0, 520.0, 1.3, 0.0);
}
$c6[] = $mitVersatz('Knapp1', 530.0, 540.0, 26.0, 0.0);
$c6[] = $mitVersatz('Knapp2', 560.0, 540.0, 0.0, -26.0);
$c6p = avesmapsGaretienPasspunkteSelbstpruefung($c6);
pruefe($c6p['mittel'] <= 3.0 * $c6p['median'], 'Vorbedingung: das Mittel (' . $c6p['mittel'] . ') verraet nichts');
pruefe($c6p['ok'] === false && str_contains($c6p['warnung'], 'nicht abgetrennt'),
    'die Schranke sieht sie trotzdem: ' . $c6p['warnung']);

// --- C7: 💣 UND EIN SCHWERER RAND UNTER DER SCHRANKE FAELLT EBENSO AUF -- das ist die Regel,
// die das Auswertungswerkzeug schon kannte (Mittel > 3 x Median) und der Endpunkt nicht.
$c7 = [];
for ($i = 0; $i < 14; $i++) {
    $c7[] = $mitVersatz("D{$i}", 500.0 + $i * 4.0, 520.0, 1.0, 0.0);
}
for ($i = 0; $i < 6; $i++) {
    $c7[] = $mitVersatz("E{$i}", 500.0 + $i * 9.0, 560.0, 0.0, 20.0);
}
$c7p = avesmapsGaretienPasspunkteSelbstpruefung($c7);
pruefe($c7p['ok'] === false && str_contains($c7p['warnung'], 'schwerer Rand'),
    'Mittel 6,7 bei Median 1,0 ist kein Rauschen mehr: ' . $c7p['warnung']);

// --- C8: 🔴 VERTAUSCHTE ACHSEN NACH DEM SCHNITT. Der Riegel nimmt fast alle Paare weg -- und
// genau die wenigen nahe der Diagonalen ueberleben, bei denen man den Tausch nicht merkt. Die
// Selbstpruefung sieht dann einen unauffaelligen Median; nur die ZAHL der abgetrennten verraet es.
$c8schnitt = avesmapsGaretienPasspunkteFalschpaareAbtrennen($vertauscht);
pruefe(count($c8schnitt['paare']) > 0, 'Vorbedingung: nahe der Diagonalen ueberleben Paare den Schnitt: '
    . count($c8schnitt['paare']));
$c8 = avesmapsGaretienPasspunkteSelbstpruefung($c8schnitt['paare'], count($c8schnitt['falschpaare']));
pruefe($c8['ok'] === false, 'vertauschte Achsen duerfen auch geschnitten nicht durchgehen');
pruefe(str_contains($c8['warnung'], 'Achsen'), 'und die Warnung benennt den Verdacht: ' . $c8['warnung']);

// --- C9: ⚠️ DER RAND WIRD NIE AN EINEM MEDIAN UNTER DEM RAUSCHBODEN GEMESSEN. Liegt fast alles
// dicht auf der Stelle, ist das Dreifache des Medians eine Winzigkeit, und ein Satz ganz im
// Rauschen (0,1 und 1,0 Meilen) hiesse "schwerer Rand". Aus der Mutationsprobe: ohne den Boden
// blieb jede andere Zusicherung gruen.
$c9 = [];
for ($i = 0; $i < 12; $i++) {
    $c9[] = $mitVersatz("N{$i}", 500.0 + $i * 4.0, 520.0, 0.1, 0.0);
}
for ($i = 0; $i < 8; $i++) {
    $c9[] = $mitVersatz("M{$i}", 500.0 + $i * 6.0, 540.0, 0.0, 1.0);
}
$c9p = avesmapsGaretienPasspunkteSelbstpruefung($c9);
pruefe($c9p['mittel'] > 3.0 * $c9p['median'], 'Vorbedingung: am blossen Median gemessen waere das ein Rand');
pruefe($c9p['ok'] === true, 'ein Satz ganz im Rauschen hat keinen schweren Rand: ' . $c9p['warnung']);

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
