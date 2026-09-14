<?php

declare(strict_types=1);

// KALIBRIEREN AN WENIGEN, MESSEN AN ALLEN ANDEREN.
//
// Owner 14.09.2026: Garetien ist auf einer verschobenen Karte gezeichnet worden -- es gibt
// einen SYSTEMATISCHEN Fehler und Rauschen, und diese Sitzung will nur den systematischen.
// Am Ende sollen eine oder vier affine Abbildungen auf alles aus Garetien angewandt werden,
// kalibriert an den Ortspaaren der Editoren. Gefragt ist, ob Distanzen UND Varianzen an den
// uebrigen Orten dadurch sinken.
//
// 🔴 Der Test baut Lagen, deren Wahrheit feststeht, und verlangt, dass die Messung sie
// wiederfindet -- UND dass sie bei reinem Rauschen keine Verbesserung meldet.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-kalibrierung-test.php

require_once __DIR__ . '/../garetien-passpunkte.php';

$pruefungen = 0;
function pruefe(bool $b, string $warum): void
{
    global $pruefungen;
    assert($b, $warum);
    $pruefungen++;
}

// =============================================================================================
// §A  QUADRANTEN
// =============================================================================================
pruefe(avesmapsGaretienPasspunktQuadrant(400.0, 600.0, 500.0, 500.0) === 0, 'NW');
pruefe(avesmapsGaretienPasspunktQuadrant(600.0, 600.0, 500.0, 500.0) === 1, 'NO');
pruefe(avesmapsGaretienPasspunktQuadrant(400.0, 400.0, 500.0, 500.0) === 2, 'SW');
pruefe(avesmapsGaretienPasspunktQuadrant(600.0, 400.0, 500.0, 500.0) === 3, 'SO');
// 💣 Genau auf der Grenze: eine Regel, die hier schweigt, laesst einen Punkt aus dem Raster
// fallen -- und der bekaeme gar keine Korrektur, ohne dass es jemandem auffiele.
pruefe(avesmapsGaretienPasspunktQuadrant(500.0, 500.0, 500.0, 500.0) === 1, 'die Mitte gehoert NO');

// =============================================================================================
// §B  KENNZAHLEN
// =============================================================================================
$k = avesmapsGaretienPasspunktKennzahlen([1.0, 2.0, 3.0, 4.0]);
pruefe($k['n'] === 4 && $k['summe'] === 10.0, 'Summe');
pruefe($k['mittel'] === 2.5, 'Mittel');
// Stichprobenvarianz: ((1.5^2)+(0.5^2)+(0.5^2)+(1.5^2)) / 3 = 5/3
pruefe(abs($k['varianz'] - 5.0 / 3.0) < 1e-12, 'Stichprobenvarianz mit n-1: ' . $k['varianz']);
pruefe($k['median'] === 2.5 && $k['max'] === 4.0, 'Median und Maximum');
// 💣 Bei EINEM Wert gibt es keine Streuung -- n-1 waere eine Division durch null.
pruefe(avesmapsGaretienPasspunktKennzahlen([5.0])['varianz'] === 0.0, 'ein Wert hat keine Varianz');
pruefe(avesmapsGaretienPasspunktKennzahlen([])['n'] === 0, 'leere Liste');

// =============================================================================================
// §C  DIE LAGE BAUEN
// =============================================================================================
$MX = 580.0;
$MY = 550.0;
$rueck = static function (float $ax, float $ay): array {
    $det = AVESMAPS_GARETIEN_MATRIX_XX * AVESMAPS_GARETIEN_MATRIX_YY
         - AVESMAPS_GARETIEN_MATRIX_XY * AVESMAPS_GARETIEN_MATRIX_YX;
    $ux = $ax - AVESMAPS_GARETIEN_MATRIX_X0;
    $uy = $ay - AVESMAPS_GARETIEN_MATRIX_Y0;
    return [(AVESMAPS_GARETIEN_MATRIX_YY * $ux - AVESMAPS_GARETIEN_MATRIX_XY * $uy) / $det,
            (AVESMAPS_GARETIEN_MATRIX_XX * $uy - AVESMAPS_GARETIEN_MATRIX_YX * $ux) / $det];
};
$KALIB = [
    ['Mitte', 580.0, 550.0], ['Links', 480.0, 550.0], ['Links unten', 480.0, 505.0],
    ['Unten', 580.0, 505.0], ['Rechts unten', 680.0, 505.0], ['Rechts', 680.0, 550.0],
    ['Rechts oben', 680.0, 595.0], ['Oben', 580.0, 595.0], ['Links oben', 480.0, 595.0],
    ['Rhondur', 495.0, 512.0], ['Perricum', 640.0, 545.0],
];
$namen = array_column($KALIB, 0);

$baue = static function (float $theta, float $vy, float $sig, int $saat) use ($rueck, $KALIB, $MX, $MY): array {
    $w = new AvesmapsGaretienWuerfel($saat);
    $g = static function () use ($w): float {
        $u1 = max(1e-9, $w->bis(1000000) / 1000000.0);
        $u2 = $w->bis(1000000) / 1000000.0;
        return sqrt(-2.0 * log($u1)) * cos(2 * M_PI * $u2);
    };
    $lege = static function (string $n, float $ax, float $ay) use ($theta, $vy, $sig, $g, $rueck, $MX, $MY): array {
        $dx = ($ax - $MX) * 3.0;
        $dy = ($ay - $MY) * 3.0;
        [$gx, $gy] = $rueck($ax + (-$theta * $dy + $g() * $sig) / 3.0,
                            $ay + ( $theta * $dx + $vy + $g() * $sig) / 3.0);
        return ['name' => $n, 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
    };
    $alle = [];
    foreach ($KALIB as [$n, $x, $y]) { $alle[] = $lege($n, $x, $y); }
    for ($i = 0; $i < 137; $i++) {
        $alle[] = $lege("Ort{$i}", 470.0 + ($w->bis(1000) / 1000.0) * 220.0,
                                   500.0 + ($w->bis(1000) / 1000.0) * 100.0);
    }
    return $alle;
};

// =============================================================================================
// §D  🔴 DIE KALIBRIERPUNKTE DUERFEN NICHT MITGEMESSEN WERDEN
// =============================================================================================
// Bliebe auch nur einer in der Pruefmenge, schoente er das Ergebnis -- eine Anpassung trifft
// ihre eigenen Stuetzpunkte immer besser. Das ist der Unterschied zwischen einer Messung und
// einer Selbstbestaetigung.
$mitFehler = $baue(0.0039, -1.0, 1.05, 4711);
$e = avesmapsGaretienPasspunktKalibrierProbe($mitFehler, $namen, 1);
pruefe($e['kalibriert'] === 11, 'elf Kalibrierorte gefunden');
pruefe($e['nachher']['n'] === 137, 'gemessen wird an den uebrigen 137: ' . $e['nachher']['n']);
foreach ($e['punkte'] as $p) {
    pruefe(!in_array($p['name'], $namen, true), "{$p['name']} darf nicht in der Pruefmenge stehen");
}

// =============================================================================================
// §E  EIN SYSTEMATISCHER FEHLER MUSS GEFUNDEN UND BEHOBEN WERDEN
// =============================================================================================
pruefe($e['summe_prozent'] > 10.0,
    'bei echtem systematischem Fehler muss die Summe deutlich sinken: ' . $e['summe_prozent']);
// 🔴 UND DIE VARIANZ MIT. Das ist der Unterscheider, nach dem der Owner ausdruecklich gefragt
// hat: sinkt nur die Summe und die Varianz steigt, wurde Rauschen angepasst.
pruefe($e['varianz_prozent'] > 0.0,
    'die Varianz muss mitsinken: ' . $e['varianz_prozent']);
pruefe($e['anteil_besser'] > 0.6, 'die Mehrheit muss besser werden: ' . $e['anteil_besser']);

// =============================================================================================
// §F  💣 OHNE SYSTEMATISCHEN FEHLER DARF NICHTS VERBESSERT WERDEN
// =============================================================================================
// Ohne diese Haelfte waere das Werkzeug eine Maschine, die jede Kalibrierung bestaetigt.
$nurRauschen = $baue(0.0, 0.0, 1.05, 4711);
$r = avesmapsGaretienPasspunktKalibrierProbe($nurRauschen, $namen, 1);
pruefe($r['summe_prozent'] < 0.0,
    'reines Rauschen darf die Summe NICHT senken: ' . $r['summe_prozent']);
pruefe($r['varianz_prozent'] < 0.0,
    'und die Varianz schon gar nicht: ' . $r['varianz_prozent']);

// =============================================================================================
// §G  💣 VIER QUADRANTEN AUS ELF PUNKTEN SIND KEINE VIER AFFINEN ABBILDUNGEN
// =============================================================================================
// Eine affine Abbildung hat sechs Parameter; drei Punkte legen sie EXAKT fest und lassen
// keinen Freiheitsgrad. Bei elf Kalibrierorten auf vier Felder kommt kein Feld auf acht
// Punkte -- jedes faellt auf eine reine Verschiebung zurueck, und eines wird aus einem
// EINZIGEN Ort geschaetzt.
// 🔴 Das MUSS in der Antwort stehen. Sonst heisst es "vier affine Abbildungen", waehrend in
// Wahrheit vier Verschiebungen laufen, und niemand weiss es.
$v4 = avesmapsGaretienPasspunktKalibrierProbe($mitFehler, $namen, 4);
pruefe(count($v4['korrekturarten']) === 4, 'vier Felder werden berichtet');
$affine = 0;
foreach ($v4['korrekturarten'] as $a) {
    pruefe(in_array($a['art'], ['affin', 'verschiebung', 'keine'], true), 'bekannte Art');
    if ($a['art'] === 'affin') { $affine++; }
}
pruefe($affine === 0, 'aus elf Punkten kann KEIN Quadrant eine affine Abbildung tragen');
pruefe($v4['summe_prozent'] < $e['summe_prozent'],
    'vier duenne Felder muessen schlechter sein als ein volles: '
    . $v4['summe_prozent'] . ' gegen ' . $e['summe_prozent']);

// --- G1: Mit GENUG Punkten je Feld wird daraus wirklich eine affine Abbildung.
// Sonst waere die Schranke ein toter Zweig, den kein Test je betritt.
$viele = $mitFehler;
$vieleNamen = $namen;
foreach ($mitFehler as $i => $p) {
    if ($i >= 11 && $i < 91) {           // 80 weitere Orte zu Kalibrierpunkten machen
        $vieleNamen[] = $p['name'];
    }
}
$g4 = avesmapsGaretienPasspunktKalibrierProbe($viele, $vieleNamen, 4);
$affine2 = 0;
foreach ($g4['korrekturarten'] as $a) {
    if ($a['art'] === 'affin') { $affine2++; }
}
pruefe($affine2 >= 3, 'mit 91 Kalibrierorten muessen die Felder affin werden: ' . $affine2);

// =============================================================================================
// §H  DIE KORREKTUR WIRKT IN DIE RICHTIGE RICHTUNG
// =============================================================================================
// 💣 Das Residuum sagt, wohin der Import zu weit legt -- korrigiert wird DAGEGEN. Ein
// Vorzeichenfehler verdoppelt den Fehler, statt ihn zu tilgen, und faellt an einer
// Prozentzahl allein nicht auf.
$einPunkt = [['name' => 'A', 'gx' => 0.0, 'gy' => 0.0,
              'ax' => AVESMAPS_GARETIEN_MATRIX_X0 + 1.0, 'ay' => AVESMAPS_GARETIEN_MATRIX_Y0]];
$korr = avesmapsGaretienPasspunktKorrekturBauen($einPunkt, 1, [0.0, 0.0]);
pruefe($korr['korrekturen'][0]['art'] === 'verschiebung', 'ein Punkt gibt eine Verschiebung');
[$nx, $ny] = avesmapsGaretienPasspunktKorrekturAnwenden($korr, $einPunkt[0]);
pruefe(abs($nx - $einPunkt[0]['ax']) < 1e-9 && abs($ny - $einPunkt[0]['ay']) < 1e-9,
    "die Korrektur muss den Punkt auf SEINE Lage ziehen, nicht von ihr weg ({$nx})");

// --- H1: Ein leeres Feld laesst alles, wie es ist.
$leer = avesmapsGaretienPasspunktKorrekturBauen([], 1, [0.0, 0.0]);
pruefe($leer['korrekturen'][0]['art'] === 'keine', 'ohne Punkte keine Korrektur');
[$ux, $uy] = avesmapsGaretienPasspunktKorrekturAnwenden($leer, $einPunkt[0]);
[$fx, $fy] = avesmapsGaretienNachAvesmaps(0.0, 0.0);
pruefe(abs($ux - $fx) < 1e-12 && abs($uy - $fy) < 1e-12, 'unveraendert durchgereicht');

// =============================================================================================
// §I  LEERE MENGEN MELDEN EINEN FEHLER, STATT ETWAS ZU BEHAUPTEN
// =============================================================================================
pruefe(isset(avesmapsGaretienPasspunktKalibrierProbe($mitFehler, ['GibtsNicht'], 1)['fehler']),
    'ohne Kalibrierpunkte gibt es kein Ergebnis');
$alleNamen = array_map(static fn(array $p): string => $p['name'], $mitFehler);
pruefe(isset(avesmapsGaretienPasspunktKalibrierProbe($mitFehler, $alleNamen, 1)['fehler']),
    'ohne Pruefpunkte gibt es kein Ergebnis');

// =============================================================================================
// §J  💣 JEDER QUADRANT MUSS SEINE EIGENE KORREKTUR BEKOMMEN
// =============================================================================================
//
// 🪤 Aus einer Mutationsprobe (14.09.2026): wer im ANWENDER die Quadrantenrechnung weglaesst
// und immer Feld 0 nimmt, ueberlebt §G muehelos -- dort wird nur geprueft, dass vier duenne
// Felder schlechter sind als ein volles, und das bleiben sie auch dann. Die Vier-Felder-Wahl
// waere damit eine LEERE Zusage: die Antwort meldete vier Korrekturen, angewandt wuerde eine.
//
// Der scharfe Fall: vier Kalibrierorte, einer je Quadrant, mit VERSCHIEDENEN Versaetzen.
// Ein Probepunkt in jedem Quadranten muss genau den seinen abbekommen.
$mitteQ = [AVESMAPS_GARETIEN_MATRIX_X0, AVESMAPS_GARETIEN_MATRIX_Y0];
$je = [
    // Quadrant => [ax-Versatz, ay-Versatz] gegenueber der reinen Matrix, in Karteneinheiten
    0 => [-40.0, +30.0, -1.0,  0.0],   // NW, Import liegt 1 Einheit zu weit WEST
    1 => [+40.0, +30.0,  0.0, +1.0],   // NO, zu weit NORD
    2 => [-40.0, -30.0,  0.0, -1.0],   // SW, zu weit SUED
    3 => [+40.0, -30.0, +1.0,  0.0],   // SO, zu weit OST
];
$kal = [];
foreach ($je as $q => [$dx, $dy, $vx, $vy]) {
    // Wagenhalt-Koordinate, die unter der Matrix auf (mitte + d) faellt ...
    [$gx, $gy] = $rueck($mitteQ[0] + $dx, $mitteQ[1] + $dy);
    // ... waehrend UNSERE Lage um (vx, vy) daneben liegt -> Residuum genau (vx, vy).
    $kal[] = ['name' => "K{$q}", 'gx' => $gx, 'gy' => $gy,
              'ax' => $mitteQ[0] + $dx - $vx, 'ay' => $mitteQ[1] + $dy - $vy];
}
$k4 = avesmapsGaretienPasspunktKorrekturBauen($kal, 4, $mitteQ);
foreach ($je as $q => [$dx, $dy, $vx, $vy]) {
    pruefe($k4['korrekturen'][$q]['n'] === 1, "Quadrant {$q} hat genau einen Kalibrierort");
    // Ein Probepunkt im selben Quadranten, an einer ANDEREN Stelle.
    [$gx, $gy] = $rueck($mitteQ[0] + $dx * 0.5, $mitteQ[1] + $dy * 0.5);
    $probe = ['name' => "P{$q}", 'gx' => $gx, 'gy' => $gy,
              'ax' => $mitteQ[0] + $dx * 0.5, 'ay' => $mitteQ[1] + $dy * 0.5];
    [$nx, $ny] = avesmapsGaretienPasspunktKorrekturAnwenden($k4, $probe);
    // Die Korrektur seines Quadranten zieht ihn um genau -(vx, vy).
    pruefe(abs($nx - ($probe['ax'] - $vx)) < 1e-6 && abs($ny - ($probe['ay'] - $vy)) < 1e-6,
        "Quadrant {$q} muss SEINE Korrektur bekommen, nicht die von Feld 0 "
        . "(erwartet " . ($probe['ax'] - $vx) . "/" . ($probe['ay'] - $vy) . ", bekam {$nx}/{$ny})");
}

// --- J1: Und die vier Korrekturen sind wirklich VERSCHIEDEN -- sonst prueft J nichts.
$versaetze = [];
foreach ($k4['korrekturen'] as $q => $kk) {
    $versaetze[] = round($kk['versatz'][0], 6) . '/' . round($kk['versatz'][1], 6);
}
pruefe(count(array_unique($versaetze)) === 4, 'die vier Felder tragen vier verschiedene Versaetze');

// =============================================================================================
// §K  🔴 FALSCHPAARE FLIEGEN RAUS, BEVOR KALIBRIERT ODER GEMESSEN WIRD
// =============================================================================================
//
// 🚩 Messlauf 14.09.2026 (Entwurf §3.1): ueber alle 204 Paare lag die Summe bei 15.735 statt
// 479 Meilen, weil 37 gleichnamige, aber andere Orte mitgemessen wurden -- und jede Kalibrierung
// sah nach +-0,5 % aus, weil die Falschpaare jede Korrektur verschlucken. Die Probe trennt sie
// deshalb selbst ab, mit dem geteilten Riegel, und nennt sie.
$mitFalschen = $mitFehler;
foreach ([[900.0, 130.0], [120.0, 880.0], [700.0, 200.0], [300.0, 300.0]] as $i => [$fx, $fy]) {
    [$gx, $gy] = $rueck(470.0 + $i * 50.0, 520.0);
    $mitFalschen[] = ['name' => "Falschpaar{$i}", 'gx' => $gx, 'gy' => $gy, 'ax' => $fx, 'ay' => $fy];
}
// 💣 Und einer davon steht unter den Kalibriernamen -- ein Editor nennt einen Ort, den es bei
// Garetien unter demselben Namen an ganz anderer Stelle gibt.
$kf = avesmapsGaretienPasspunktKalibrierProbe($mitFalschen, array_merge($namen, ['Falschpaar0']), 1);
pruefe($kf['kalibriert'] === 11, 'das Falschpaar kalibriert nicht mit: ' . $kf['kalibriert']);
pruefe($kf['nachher']['n'] === 137, 'und wird nicht mitgemessen: ' . $kf['nachher']['n']);
pruefe(abs($kf['summe_prozent'] - $e['summe_prozent']) < 1e-9,
    'die Summe ist dieselbe wie ohne Falschpaare: ' . $kf['summe_prozent'] . ' gegen ' . $e['summe_prozent']);
pruefe(abs($kf['varianz_prozent'] - $e['varianz_prozent']) < 1e-9, 'die Varianz auch');
$kfNamen = array_column($kf['falschpaare'], 'name');
sort($kfNamen);
pruefe($kfNamen === ['Falschpaar0', 'Falschpaar1', 'Falschpaar2', 'Falschpaar3'],
    'die abgetrennten werden BENANNT, nicht still verworfen: ' . implode(', ', $kfNamen));
// Die Mitte der Quadranten wandert nicht mit den Falschpaaren -- sonst waeren zwei Laeufe nicht vergleichbar.
$kf4 = avesmapsGaretienPasspunktKalibrierProbe($mitFalschen, $namen, 4);
pruefe(abs($kf4['mitte'][0] - $v4['mitte'][0]) < 1e-9 && abs($kf4['mitte'][1] - $v4['mitte'][1]) < 1e-9,
    'die Quadrantenmitte bleibt, wo sie ohne Falschpaare liegt');
pruefe(count(avesmapsGaretienPasspunktKalibrierProbe($mitFalschen, ['GibtsNicht'], 1)['falschpaare'] ?? [0]) === 4,
    'auch eine gescheiterte Probe nennt die abgetrennten');

echo "OK: {$pruefungen} Pruefungen\n";
