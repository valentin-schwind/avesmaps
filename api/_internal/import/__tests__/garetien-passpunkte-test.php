<?php

declare(strict_types=1);

// PASSPUNKTE UND RESIDUEN -- laesst sich der Import nachkorrigieren?
//
// 🔴 DIESER TEST PRUEFT EIN MESSGERAET, NICHT EINE KARTE. Jede Zusicherung baut deshalb eine
// Lage, deren Wahrheit VORHER feststeht, und verlangt, dass die Messung sie wiederfindet --
// und, mindestens ebenso wichtig, dass sie bei reinem Rauschen NICHTS findet. Ein Werkzeug,
// das nur "ja, korrigierbar" sagen kann, haette dem Owner die Frage nicht beantwortet,
// sondern sie bestaetigt.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-passpunkte-test.php

require_once __DIR__ . '/../garetien-passpunkte.php';

$pruefungen = 0;
function pruefe(bool $bedingung, string $warum): void
{
    global $pruefungen;
    assert($bedingung, $warum);
    $pruefungen++;
}

/** Fester Wuerfel fuer die Lagen -- ein Test, der mal rot und mal gruen ist, ist keiner. */
$w = new AvesmapsGaretienWuerfel(20260913);
$zufall = static fn(float $spanne): float => ($w->bis(200001) / 100000.0 - 1.0) * $spanne;

// =============================================================================================
// §A  DIE ABBILDUNG SELBST
// =============================================================================================

// --- A1: Der Fit findet eine bekannte Matrix wieder.
$wahr  = [3.366672e-4, 6.576893e-7, 547.3559, 2.419169e-6, -3.311091e-4, 541.8122];
$paare = [];
for ($i = 0; $i < 60; $i++) {
    $gx = $zufall(400000.0);
    $gy = $zufall(200000.0);
    $paare[] = [
        'name' => "P{$i}",
        'gx'   => $gx,
        'gy'   => $gy,
        'ax'   => $wahr[0] * $gx + $wahr[1] * $gy + $wahr[2],
        'ay'   => $wahr[3] * $gx + $wahr[4] * $gy + $wahr[5],
    ];
}
$fit = avesmapsGaretienPasspunktAffinFit($paare);
foreach ($wahr as $i => $soll) {
    pruefe(abs($fit[$i] - $soll) < abs($soll) * 1e-6 + 1e-12,
        "Parameter {$i} muss wiedergefunden werden: {$fit[$i]} statt {$soll}");
}

// --- A2: 💣 Y WIRD GESPIEGELT, und der Fit darf das nicht wegbuegeln.
pruefe($fit[4] < 0.0, 'die Y-Skala muss negativ bleiben -- bei ihnen waechst y nach Sueden');

// --- A3: Entartete Lage wird LAUT abgelehnt, nicht still falsch beantwortet.
// Alle Punkte auf einer Geraden: die Normalgleichungen sind singulaer, und ein Loeser ohne
// diese Pruefung liefert dort irgendetwas -- eine Matrix, der man nichts ansieht.
$gerade = [];
for ($i = 0; $i < 10; $i++) {
    $gerade[] = ['name' => "G{$i}", 'gx' => $i * 1000.0, 'gy' => $i * 2000.0,
                 'ax' => $i * 0.5, 'ay' => $i * 0.25];
}
$geworfen = false;
try {
    avesmapsGaretienPasspunktAffinFit($gerade);
} catch (RuntimeException) {
    $geworfen = true;
}
pruefe($geworfen, 'kollineare Passpunkte muessen eine Ausnahme werfen, nicht eine Matrix liefern');

// =============================================================================================
// §B  DER AUSREISSER-FILTER -- 70 von 219 Paaren waren verschiedene Orte (Entwurf §2.4)
// =============================================================================================

// --- B1: Falschpaare fliegen raus, und die Matrix ueberlebt sie.
$mitMuell = $paare;
foreach ([[900.0, 130.0], [120.0, 880.0], [700.0, 200.0]] as $i => [$fx, $fy]) {
    // Ein "zweites Hueterkloster": derselbe Name, ein voellig anderer Ort.
    $mitMuell[] = ['name' => "Falschpaar{$i}", 'gx' => $zufall(300000.0), 'gy' => $zufall(150000.0),
                   'ax' => $fx, 'ay' => $fy];
}
$robust = avesmapsGaretienPasspunktRobustFit($mitMuell);
pruefe(count($robust['ausreisser']) === 3,
    'genau die drei Falschpaare muessen fallen, gefallen sind ' . count($robust['ausreisser']));
foreach ($robust['ausreisser'] as $a) {
    pruefe(str_starts_with($a['punkt']['name'], 'Falschpaar'), 'es darf NUR ein Falschpaar fallen');
}
foreach ($wahr as $i => $soll) {
    pruefe(abs($robust['matrix'][$i] - $soll) < abs($soll) * 1e-5 + 1e-11,
        "nach dem Filter muss Parameter {$i} wieder stimmen");
}

// --- B2: Ein SAUBERER Satz verliert keinen einzigen Punkt.
// Ohne die feste Untergrenze von 5 Meilen frisst sich der Filter bei jeder Runde tiefer in
// gute Punkte hinein -- der Median schrumpft, die Schranke schrumpft mit, und am Ende bleiben
// drei Punkte uebrig, die perfekt zueinander passen.
$sauber = [];
for ($i = 0; $i < 40; $i++) {
    $gx = $zufall(400000.0);
    $gy = $zufall(200000.0);
    $sauber[] = ['name' => "S{$i}", 'gx' => $gx, 'gy' => $gy,
                 'ax' => $wahr[0] * $gx + $wahr[1] * $gy + $wahr[2] + $zufall(0.3),
                 'ay' => $wahr[3] * $gx + $wahr[4] * $gy + $wahr[5] + $zufall(0.3)];
}
$sauberFit = avesmapsGaretienPasspunktRobustFit($sauber);
pruefe(count($sauberFit['inlier']) === 40,
    'ein sauberer Satz darf keinen Punkt verlieren, behalten: ' . count($sauberFit['inlier']));

// =============================================================================================
// §C  DIE ENTSCHEIDENDE MESSUNG -- sie muss Struktur FINDEN und bei Rauschen SCHWEIGEN
// =============================================================================================

/** Baut Passpunkte, deren Versatz eine vorgegebene Funktion der Lage ist. */
$baueFeld = static function (callable $feld, int $n, float $rauschen) use ($wahr, $zufall): array {
    $raus = [];
    for ($i = 0; $i < $n; $i++) {
        // Gleichmaessig ueber den Kartenausschnitt, in dem Garetien liegt.
        $ax = 460.0 + ($i % 12) * 20.0;
        $ay = 500.0 + intdiv($i, 12) * 20.0;
        [$fx, $fy] = $feld($ax, $ay);
        // Rueckwaerts: welche Wagenhalt-Koordinate ergaebe unter der WAHREN Matrix die
        // verschobene Lage? Nur so ist der Versatz wirklich im Datensatz und nicht im Fit.
        $zx = $ax + ($fx + $zufall($rauschen)) / 3.0;
        $zy = $ay + ($fy + $zufall($rauschen)) / 3.0;
        // 💣 VOLLE 2x2-UMKEHRUNG, nicht zwei Divisionen. Die erste Fassung dieses Helfers
        // liess die Kreuzterme weg -- sie sind winzig (6,6e-7 / 2,4e-6), aber gx laeuft bis
        // 4e5, und daraus wurde ein SYSTEMATISCHER Nord-Sued-Versatz von rund 3 Meilen quer
        // ueber die Karte. Der Rauschen-Datensatz war damit gar keiner, und §E2 hat ihn als
        // Trend gemeldet (p = 0,006) -- zu Recht. Gefunden hat den Fehler der Test, nicht
        // der Autor: eine Fixture, die "kein Trend" heissen soll, muss auch keinen tragen.
        $det = $wahr[0] * $wahr[4] - $wahr[1] * $wahr[3];
        $ux  = $zx - $wahr[2];
        $uy  = $zy - $wahr[5];
        $gx  = ($wahr[4] * $ux - $wahr[1] * $uy) / $det;
        $gy  = ($wahr[0] * $uy - $wahr[3] * $ux) / $det;
        $raus[] = ['name' => "F{$i}", 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
    }

    return $raus;
};

// --- C1: EIN ZUSAMMENHAENGENDES FELD muss gefunden werden.
// Der Versatz wandert glatt ueber die Karte -- genau die Lage, in der ein Fixpunkt seinem
// Nachbarn etwas zu sagen hat. Die Nachbarprobe MUSS den Fehler deutlich senken.
$feldPaare = $baueFeld(
    static fn(float $ax, float $ay): array => [6.0 * sin(($ax - 460.0) / 90.0), -8.0 + ($ax - 460.0) / 40.0],
    48,
    0.4
);
$feldRes   = avesmapsGaretienPasspunktResiduen($feldPaare, $wahr);
$feldProbe = avesmapsGaretienPasspunktNachbarprobe($feldRes, 5);
pruefe($feldProbe['gewinn_median'] > 1.0,
    'ein zusammenhaengendes Feld MUSS die Nachbarprobe senken, Gewinn: ' . $feldProbe['gewinn_median']);
pruefe($feldProbe['anteil_besser'] > 0.8,
    'im zusammenhaengenden Feld muss die grosse Mehrheit besser werden: ' . $feldProbe['anteil_besser']);
pruefe($feldProbe['uebereinstimmung'] > 0.7,
    'Nachbarn muessen in dieselbe Richtung zeigen: ' . $feldProbe['uebereinstimmung']);

// --- C2: 💣 REINES RAUSCHEN DARF NICHT ALS STRUKTUR DURCHGEHEN.
// Das ist die Zusicherung, an der alles haengt. Zieht man von einem zufaelligen Versatz den
// Mittelwert ZUFAELLIGER Nachbarn ab, addiert man Rauschen -- der Fehler MUSS steigen. Ein
// Werkzeug, das hier einen Gewinn meldet, wuerde dem Owner "korrigierbar" sagen, wo nichts
// zu korrigieren ist, und gesunde Orte verschieben.
$rauschPaare = $baueFeld(static fn(float $ax, float $ay): array => [0.0, 0.0], 48, 4.0);
$rauschRes   = avesmapsGaretienPasspunktResiduen($rauschPaare, $wahr);
$rauschProbe = avesmapsGaretienPasspunktNachbarprobe($rauschRes, 5);
pruefe($rauschProbe['gewinn_median'] < 0.0,
    'reines Rauschen MUSS die Nachbarprobe verschlechtern, Gewinn: ' . $rauschProbe['gewinn_median']);
pruefe($rauschProbe['anteil_besser'] < 0.5,
    'bei Rauschen darf die Mehrheit NICHT besser werden: ' . $rauschProbe['anteil_besser']);
pruefe(abs($rauschProbe['uebereinstimmung']) < 0.3,
    'bei Rauschen duerfen Nachbarn keine gemeinsame Richtung haben: ' . $rauschProbe['uebereinstimmung']);

// --- C3: 💣 DER PUNKT DARF NICHT SEIN EIGENER NACHBAR SEIN.
// Mutationsprobe: nimmt man das `continue` heraus, das den Punkt selbst ueberspringt, sieht
// AUCH reines Rauschen wie ein perfekt korrigierbares Feld aus -- der Punkt sagt sich selbst
// voraus, und der Gewinn geht gegen den vollen Fehler. Diese Zusicherung faengt genau das:
// bei Rauschen darf der Gewinn NIE in der Naehe des Ausgangsfehlers liegen.
pruefe($rauschProbe['gewinn_median'] < $rauschProbe['vorher_median'] * 0.5,
    'ein Gewinn nahe dem vollen Fehler heisst: der Punkt schaetzt sich selbst');

// --- C4: Mehr Nachbarn glaetten staerker -- die Messung muss auf k reagieren.
$k1 = avesmapsGaretienPasspunktNachbarprobe($feldRes, 1);
$k8 = avesmapsGaretienPasspunktNachbarprobe($feldRes, 8);
pruefe($k1['k'] === 1 && $k8['k'] === 8, 'k muss durchgereicht werden');
pruefe(abs($k1['gewinn_median'] - $k8['gewinn_median']) > 1e-9, 'k muss das Ergebnis veraendern');

// --- C5: k wird auf die Zahl der VERFUEGBAREN Nachbarn gedeckelt.
$klein = avesmapsGaretienPasspunktNachbarprobe(array_slice($feldRes, 0, 3), 99);
pruefe($klein['k'] === 2, 'bei 3 Punkten gibt es hoechstens 2 Nachbarn, k war: ' . $klein['k']);

// =============================================================================================
// §D  💣 DIE VIER KORRELATIONEN AUS ENTWURF §2.2 KOENNEN NICHTS FINDEN
// =============================================================================================
//
// Entwurf §2.2 schliesst aus "die Residuen korrelieren null mit der Position
// (0,014 / 0,003 / -0,003 / -0,001)", es gebe keine systematische Verzerrung -- und traegt
// damit die Anweisung "NICHT WARPEN". Die Zahlen sind aber eine ALGEBRAISCHE IDENTITAET:
// Residuen kleinster Quadrate stehen auf jeder Spalte der Entwurfsmatrix senkrecht, und die
// Spalten sind gx, gy und die Eins. Sie MUESSEN null sein.
//
// Diese Zusicherung baut den Gegenbeweis: eine Karte mit einer gewaltigen, voellig
// systematischen Verzerrung -- und dieselben vier Nullen.
//
// 🔴 Was §2.2 wirklich traegt, ist die ANDERE Haelfte: die Kreuzvalidierung gegen den
// Thin-Plate-Spline (2,30 gegen 1,24 Meilen). Die ist out-of-sample und bleibt gueltig.
// Wer den Satz "NICHT WARPEN" pruefen will, muss dort hinsehen, nicht auf diese vier Zahlen.

$korr = static function (array $a, array $b): float {
    $n  = count($a);
    $ma = array_sum($a) / $n;
    $mb = array_sum($b) / $n;
    $sab = $sa = $sb = 0.0;
    for ($i = 0; $i < $n; $i++) {
        $da = $a[$i] - $ma;
        $db = $b[$i] - $mb;
        $sab += $da * $db;
        $sa  += $da * $da;
        $sb  += $db * $db;
    }

    return ($sa <= 0.0 || $sb <= 0.0) ? 0.0 : $sab / sqrt($sa * $sb);
};

// Eine quadratische Verzerrung von 36 Meilen Amplitude -- das Dreissigfache des Rauschens,
// mit dem der echte Datensatz lebt (Median 1,24 Meilen).
$verzerrt = [];
for ($i = 0; $i < 120; $i++) {
    $gx = $zufall(400000.0);
    $gy = $zufall(200000.0);
    $bogen = 12.0 * (($gx / 400000.0) ** 2);
    $verzerrt[] = ['name' => "V{$i}", 'gx' => $gx, 'gy' => $gy,
                   'ax' => $wahr[0] * $gx + $wahr[1] * $gy + $wahr[2] + $bogen,
                   'ay' => $wahr[3] * $gx + $wahr[4] * $gy + $wahr[5] + 0.75 * $bogen];
}
$vFit = avesmapsGaretienPasspunktAffinFit($verzerrt);
$vRes = avesmapsGaretienPasspunktResiduen($verzerrt, $vFit);

$rx = array_column($vRes, 'dx');
$ry = array_column($vRes, 'dy');
$cx = array_map(static fn(array $p): float => (float) $p['gx'], $verzerrt);
$cy = array_map(static fn(array $p): float => (float) $p['gy'], $verzerrt);

// --- D1: Die Verzerrung ist unuebersehbar da.
$streuung = avesmapsGaretienPasspunktMedian(array_column($vRes, 'betrag'));
pruefe($streuung > 5.0, "die eingebaute Verzerrung muss sich im Median zeigen: {$streuung} Meilen");

// --- D2: UND ALLE VIER KORRELATIONEN SIND TROTZDEM NULL.
foreach ([['rx/gx', $rx, $cx], ['rx/gy', $rx, $cy], ['ry/gx', $ry, $cx], ['ry/gy', $ry, $cy]] as [$was, $a, $b]) {
    $c = $korr($a, $b);
    pruefe(abs($c) < 1e-9,
        "{$was} MUSS bei kleinsten Quadraten null sein -- gemessen {$c}. Ist sie es nicht, "
        . 'ist der Loeser kaputt; ist sie es, beweist die Zahl nichts ueber die Karte.');
}

// --- D3: Die Nachbarprobe dagegen FINDET dieselbe Verzerrung sofort.
// Das ist der Beleg, dass hier nicht nur kritisiert, sondern ersetzt wird: das Werkzeug,
// das §2.2 benutzt hat, ist blind -- dieses nicht.
$vProbe = avesmapsGaretienPasspunktNachbarprobe($vRes, 5);
pruefe($vProbe['gewinn_median'] > 1.0,
    'die Nachbarprobe muss die Verzerrung finden, die den vier Korrelationen entgeht: '
    . $vProbe['gewinn_median']);

// =============================================================================================
// §E  DIE BEHAUPTUNG "JE WEITER WESTEN, DESTO WEITER SUEDEN"
// =============================================================================================

// --- E1: Ein eingebauter West-Sued-Trend wird gefunden, mit der richtigen Zahl.
// Gebaut: 10 Meilen Sued-Versatz je 100 Meilen weiter westlich.
$trendPaare = $baueFeld(
    static fn(float $ax, float $ay): array => [0.0, -(620.0 - $ax) * 3.0 * 0.10],
    48,
    0.5
);
$trendRes = avesmapsGaretienPasspunktResiduen($trendPaare, $wahr);
$trend    = avesmapsGaretienPasspunktWestSuedTrend($trendRes, 500, 4);
pruefe(abs($trend['sued_je_100_west'] - 10.0) < 1.5,
    'der eingebaute Trend von 10 Meilen/100 muss wiedergefunden werden: ' . $trend['sued_je_100_west']);
pruefe($trend['p_wert'] < 0.01, 'ein so klarer Trend muss einen kleinen p-Wert haben: ' . $trend['p_wert']);

// --- E2: 💣 UND REINES RAUSCHEN DARF KEINEN TREND MELDEN.
// Ohne diese Haelfte waere der Test eine Maschine, die jede Behauptung bestaetigt.
$rauschTrend = avesmapsGaretienPasspunktWestSuedTrend($rauschRes, 500, 4);
pruefe($rauschTrend['p_wert'] > 0.05,
    'reines Rauschen darf keinen Trend melden, p-Wert: ' . $rauschTrend['p_wert']);

// --- E3: Der p-Wert ist nie 0 -- aus endlich vielen Proben ist "unmoeglich" nicht belegbar.
pruefe($trend['p_wert'] > 0.0, 'ein p-Wert von exakt 0 waere eine Luege ueber die Probenzahl');

// --- E4: Derselbe Saat gibt dasselbe Ergebnis. Ein Test mit wanderndem p-Wert ist keiner.
$a = avesmapsGaretienPasspunktWestSuedTrend($trendRes, 200, 99);
$b = avesmapsGaretienPasspunktWestSuedTrend($trendRes, 200, 99);
pruefe($a['p_wert'] === $b['p_wert'], 'gleicher Saat muss denselben p-Wert geben');

// =============================================================================================
// §F  DIE SPRACHE DER MELDUNG -- die Editoren melden Richtungen, keine Zahlen
// =============================================================================================

// --- F1: Die vier Haupt- und vier Zwischenrichtungen.
pruefe(avesmapsGaretienPasspunktRichtung(0.0, -4.0) === 'Sued', 'nach Sueden versetzt');
pruefe(avesmapsGaretienPasspunktRichtung(0.0,  4.0) === 'Nord', 'nach Norden versetzt');
pruefe(avesmapsGaretienPasspunktRichtung(4.0,  0.0) === 'Ost',  'nach Osten versetzt');
pruefe(avesmapsGaretienPasspunktRichtung(-4.0, 0.0) === 'West', 'nach Westen versetzt');
pruefe(avesmapsGaretienPasspunktRichtung(3.0, -3.0) === 'SuedOst', 'Suedost wie bei Greifenfurt');
pruefe(avesmapsGaretienPasspunktRichtung(3.0,  3.0) === 'NordOst', 'Nordost wie bei Perricum');

// --- F2: 💣 UNTER EINER HALBEN MEILE HEISST ES "KEIN VERSATZ", NICHT "NORDOST".
// Der Median des echten Datensatzes liegt bei 1,24 Meilen. Eine Richtung fuer 0,2 Meilen
// anzugeben, behauptet eine Messung, die die Daten nicht hergeben -- und die Editoren reden
// selbst so ("keine nennenswerte Abweichung").
pruefe(avesmapsGaretienPasspunktRichtung(0.2, -0.1) === 'kein', 'winzige Betraege sind kein Versatz');
pruefe(avesmapsGaretienPasspunktRichtung(0.0,  0.0) === 'kein', 'null ist kein Versatz');

// =============================================================================================
// §G  DER GLOBALE VERSATZ
// =============================================================================================

// --- G1: Ein eingebauter konstanter Versatz wird gefunden und senkt den Fehler.
$versatzPaare = $baueFeld(static fn(float $ax, float $ay): array => [2.0, -5.0], 40, 0.6);
$versatzRes   = avesmapsGaretienPasspunktResiduen($versatzPaare, $wahr);
$gv           = avesmapsGaretienPasspunktGlobalerVersatz($versatzRes);
pruefe(abs($gv['versatz_dx'] - 2.0) < 0.5 && abs($gv['versatz_dy'] + 5.0) < 0.5,
    "der konstante Versatz muss wiedergefunden werden: {$gv['versatz_dx']} / {$gv['versatz_dy']}");
pruefe($gv['gewinn_median'] > 4.0, 'ihn abzuziehen muss deutlich helfen: ' . $gv['gewinn_median']);

// --- G2: 💣 OHNE ECHTEN VERSATZ DARF ER NICHT HELFEN.
// Der Mittelwert wird je Punkt aus allen ANDEREN gebildet. Zoege man ihn ueber ALLE und
// danach von allen ab, meldete jeder Datensatz einen Gewinn -- man haette den Mittelwert an
// sich selbst angepasst. Diese Zusicherung faengt genau diese Vereinfachung.
$gvRausch = avesmapsGaretienPasspunktGlobalerVersatz($rauschRes);
pruefe($gvRausch['gewinn_median'] < 0.2,
    'ohne echten Versatz darf kaum Gewinn entstehen: ' . $gvRausch['gewinn_median']);

// =============================================================================================
// §H  DIE FUENF ECHTEN PASSPUNKTE, die im Repo liegen
// =============================================================================================
//
// Sie stammen aus garetien-koordinaten-test.php und sind die einzigen echten Ortspaare, die
// dieses Repo kennt -- der Fit vom 26.08.2026 lief gegen die Live-Datenbank, und nur die
// sechs Zahlen der Matrix haben ueberlebt. Fuer eine Aussage ueber die Karte sind fuenf
// Punkte zu wenig; fuer eine Zusicherung, dass die Rechnung an ECHTEN Werten laeuft, reichen
// sie.
$echt = [
    ['name' => 'Ferdok',      'gx' => -161700.0, 'gy' =>   51450.0, 'ax' => 492.96887, 'ay' => 524.68549],
    ['name' => 'Rommilys',    'gx' =>  147700.0, 'gy' =>   16800.0, 'ax' => 597.08508, 'ay' => 536.79196],
    ['name' => 'Zwerch',      'gx' =>  124600.0, 'gy' =>    -700.0, 'ax' => 589.18518, 'ay' => 542.43750],
    ['name' => 'Beilunk',     'gx' =>  387322.0, 'gy' =>   26884.0, 'ax' => 678.01385, 'ay' => 534.87564],
    ['name' => 'Greifenfurt', 'gx' => -116761.0, 'gy' => -129775.0, 'ax' => 507.52209, 'ay' => 584.85355],
];
$echtRes = avesmapsGaretienPasspunktResiduen($echt);   // gegen die EINGEFROREN ausgelieferte Matrix
pruefe(count($echtRes) === 5, 'fuenf Residuen');
foreach ($echtRes as $r) {
    pruefe($r['betrag'] < 8.0, "{$r['name']} darf nicht grob danebenliegen: {$r['betrag']} Meilen");
}

// --- H1: 🚩 GREIFENFURT LIEGT NACH SUEDOST -- genau, wie ein Editor es gemeldet hat.
// Die Meldung lautete woertlich "Greifenfurt (leichte Abweichung nach Suedost)". Sie ist am
// 13.09.2026 unabhaengig aus der ausgelieferten Matrix nachgerechnet worden und stimmt.
// Das ist der einzige Punkt dieses Repos, an dem sich eine Editoren-Meldung und die Rechnung
// wirklich begegnen -- und sie sind sich einig.
$greifenfurt = $echtRes[4];
pruefe($greifenfurt['name'] === 'Greifenfurt', 'Reihenfolge der Passpunkte');
pruefe($greifenfurt['richtung'] === 'SuedOst',
    "Greifenfurt muss nach Suedost weisen, gemessen: {$greifenfurt['richtung']}");

// --- H2: 🚩 ALLE FUENF liegen SUEDLICH. Das ist ein Hinweis, kein Befund -- fuenf Punkte
// koennen das bei reinem Zufall in einem von 32 Faellen. Festgehalten wird es, weil die
// Editoren unabhaengig davon dieselbe Richtung melden und weil ein spaeterer Messlauf
// gegen die echte Datenbank genau hier ansetzen muss.
$suedlich = 0;
foreach ($echtRes as $r) {
    if ($r['dy'] < 0.0) {
        $suedlich++;
    }
}
pruefe($suedlich === 5, "alle fuenf Passpunkte liegen suedlich, gezaehlt: {$suedlich}");


// =============================================================================================
// §I  DIE RECHENBAUSTEINE EINZELN
// =============================================================================================
//
// 🔴 DIESER ABSCHNITT IST AUS EINER MUTATIONSPROBE ENTSTANDEN (13.09.2026). Die Abschnitte
// §A-§H fahren das Werkzeug als Ganzes, und vier Mutationen haben das ueberlebt: ein Median,
// der bei gerader Anzahl immer den unteren Wert nimmt · ein Ausreisserfilter ohne feste
// Untergrenze · ein globaler Versatz, der sich an sich selbst anpasst · ein Abstandsgewicht,
// das gar nicht wirkt. Alle vier sind still -- sie aendern eine Zahl, nie ein Verhalten.
// Ein grosser Ablauf faengt so etwas nicht; dafuer braucht es den kleinen, scharfen Fall.

// --- I1: Der Median bei GERADER Anzahl ist das Mittel der beiden mittleren.
// Mutation M11: `return $werte[$m];` ueberlebte alles. Der Fehler waere nie aufgefallen --
// er verschiebt jede gemeldete Zahl um einen halben Schritt nach unten.
pruefe(avesmapsGaretienPasspunktMedian([1.0, 2.0, 3.0, 4.0]) === 2.5, 'Median bei gerader Anzahl');
pruefe(avesmapsGaretienPasspunktMedian([3.0, 1.0, 2.0]) === 2.0, 'Median bei ungerader Anzahl, unsortiert');
pruefe(avesmapsGaretienPasspunktMedian([]) === 0.0, 'leere Liste');
pruefe(avesmapsGaretienPasspunktQuantil([0.0, 10.0], 0.5) === 5.0, 'Quantil interpoliert');
pruefe(avesmapsGaretienPasspunktQuantil([1.0, 2.0, 3.0], 0.0) === 1.0, 'p=0 ist das Minimum');
pruefe(avesmapsGaretienPasspunktQuantil([1.0, 2.0, 3.0], 1.0) === 3.0, 'p=1 ist das Maximum');

// --- I2: 💣 DIE FESTE UNTERGRENZE DES FILTERS.
// Mutation M2: `$mindest = 0.0` ueberlebte. Ohne sie ist die Schranke nur 3*Median, und ein
// Satz mit schwerem Schwanz frisst sich selbst auf: die gesunden Punkte bei 3 Meilen fallen,
// weil die Mehrheit bei 0,5 liegt. Genau das sind bei einer handgemalten Karte aber die
// normalen Punkte -- p90 liegt bei 3,5 Meilen (Entwurf §2.1).
$schwanz = [];
for ($i = 0; $i < 30; $i++) {
    $gx = $zufall(400000.0);
    $gy = $zufall(200000.0);
    // Jeder fuenfte Punkt liegt bei rund 3 Meilen -- legitim, nicht falsch gepaart.
    $weit = ($i % 5 === 0) ? 1.0 : 0.0;
    $schwanz[] = ['name' => "T{$i}", 'gx' => $gx, 'gy' => $gy,
                  'ax' => $wahr[0] * $gx + $wahr[1] * $gy + $wahr[2] + $weit,
                  'ay' => $wahr[3] * $gx + $wahr[4] * $gy + $wahr[5] + $zufall(0.1)];
}
$schwanzFit = avesmapsGaretienPasspunktRobustFit($schwanz);
pruefe(count($schwanzFit['inlier']) === 30,
    'ein schwerer Schwanz ist kein Falschpaar -- behalten: ' . count($schwanzFit['inlier']));

// --- I3: 💣 DER GLOBALE VERSATZ DARF SICH NICHT AN SICH SELBST ANPASSEN.
// Mutation M4 (Mittel ueber ALLE statt ohne den Punkt) ueberlebte §G2. Der scharfe Fall sind
// zwei Punkte, die einander genau entgegenstehen: wer den Mittelwert ueber beide bildet,
// bekommt null und meldet "kein Gewinn, kein Schaden". Richtig ist ein klarer SCHADEN -- der
// eine Punkt kennt nur den anderen, und der zeigt genau andersherum.
$gegen = [
    ['name' => 'A', 'ax' => 500.0, 'ay' => 500.0, 'dx' =>  5.0, 'dy' => 0.0, 'betrag' => 5.0, 'richtung' => 'Ost'],
    ['name' => 'B', 'ax' => 520.0, 'ay' => 500.0, 'dx' => -5.0, 'dy' => 0.0, 'betrag' => 5.0, 'richtung' => 'West'],
];
$gvGegen = avesmapsGaretienPasspunktGlobalerVersatz($gegen);
pruefe($gvGegen['gewinn_median'] < -1.0,
    'gegenlaeufige Punkte MUESSEN einen Schaden melden, gemessen: ' . $gvGegen['gewinn_median']);

// --- I4: 💣 DAS ABSTANDSGEWICHT MUSS WIRKEN.
// Mutation M7 (alle Nachbarn gleich schwer) ueberlebte. Der scharfe Fall: EIN sehr naher
// Nachbar, der dasselbe sagt, gegen drei ferne, die das Gegenteil sagen. Mit Abstandsgewicht
// gewinnt der nahe und der Punkt wird fast vollstaendig korrigiert; ohne es gewinnt die
// Mehrheit und der Punkt wird SCHLECHTER als vorher.
$nah = [
    ['name' => 'Ziel', 'ax' => 500.0, 'ay' => 500.0, 'dx' =>  10.0, 'dy' => 0.0, 'betrag' => 10.0, 'richtung' => 'Ost'],
    ['name' => 'Nah',  'ax' => 500.7, 'ay' => 500.0, 'dx' =>  10.0, 'dy' => 0.0, 'betrag' => 10.0, 'richtung' => 'Ost'],
    ['name' => 'Fern1','ax' => 560.0, 'ay' => 500.0, 'dx' => -10.0, 'dy' => 0.0, 'betrag' => 10.0, 'richtung' => 'West'],
    ['name' => 'Fern2','ax' => 500.0, 'ay' => 560.0, 'dx' => -10.0, 'dy' => 0.0, 'betrag' => 10.0, 'richtung' => 'West'],
    ['name' => 'Fern3','ax' => 560.0, 'ay' => 560.0, 'dx' => -10.0, 'dy' => 0.0, 'betrag' => 10.0, 'richtung' => 'West'],
];
$nahProbe = avesmapsGaretienPasspunktNachbarprobe($nah, 4);
pruefe($nahProbe['punkte'][0]['name'] === 'Ziel', 'Reihenfolge der Punkte bleibt');
pruefe($nahProbe['punkte'][0]['nachher'] < 3.0,
    'der sehr nahe Nachbar muss die Schaetzung tragen, Rest: ' . $nahProbe['punkte'][0]['nachher']);
pruefe($nahProbe['punkte'][0]['schaetzung_dx'] > 7.0,
    'die Schaetzung muss dem nahen Nachbarn folgen: ' . $nahProbe['punkte'][0]['schaetzung_dx']);

// --- I5: Die Nachbarprobe meldet den Abstand, aus dem sie geschaetzt hat.
// Ohne diese Zahl laesst sich eine Korrektur nicht beurteilen: aus 200 Meilen Entfernung
// geschaetzt ist sie etwas ganz anderes als aus 10.
pruefe($nahProbe['punkte'][0]['nachbar_median'] > 0.0, 'der Nachbarabstand muss mitgeliefert werden');


// =============================================================================================
// §J  DAS URTEIL
// =============================================================================================

// --- J1: Das zusammenhaengende Feld aus §C bekommt ein "traegt".
$uFeld = avesmapsGaretienPasspunktUrteil($feldProbe, count($feldRes));
pruefe($uFeld['stufe'] === 'traegt', 'ein zusammenhaengendes Feld muss "traegt" bekommen: ' . $uFeld['stufe']);

// --- J2: 💣 REINES RAUSCHEN BEKOMMT "TRAEGT NICHT".
$uRausch = avesmapsGaretienPasspunktUrteil($rauschProbe, count($rauschRes));
pruefe($uRausch['stufe'] === 'traegt_nicht', 'Rauschen muss abgelehnt werden: ' . $uRausch['stufe']);
pruefe(str_contains($uRausch['satz'], 'verschiebt die Orte, die heute richtig liegen'),
    'und der Satz muss den Preis benennen, nicht nur das Nein');

// --- J3: 💣 EIN GEWINN OHNE EINIGKEIT REICHT NICHT.
// Die wichtigere der beiden Schranken. Mit genuegend Nachbarn laesst sich fast immer etwas
// herbeimitteln; eine gemeinsame Richtung laesst sich nicht herbeimitteln. Ohne diese
// Zusicherung wuerde aus jedem glucklichen Mittelwert ein "traegt".
$nurGewinn = ['vorher_median' => 4.0, 'nachher_median' => 1.0, 'gewinn_median' => 3.0,
              'uebereinstimmung' => 0.1];
pruefe(avesmapsGaretienPasspunktUrteil($nurGewinn, 50)['stufe'] === 'traegt_nicht',
    'ein Gewinn ohne gemeinsame Richtung ist kein Beleg');

// --- J4: 💣 UND EINIGKEIT OHNE GEWINN AUCH NICHT.
$nurEinig = ['vorher_median' => 4.0, 'nachher_median' => 3.8, 'gewinn_median' => 0.2,
             'uebereinstimmung' => 0.9];
pruefe(avesmapsGaretienPasspunktUrteil($nurEinig, 50)['stufe'] === 'traegt_nicht',
    'ein Viertel des Fehlers muss wirklich fallen');

// --- J5: Zu wenige Punkte ergeben KEIN Urteil, weder so noch so.
$wenig = avesmapsGaretienPasspunktUrteil($feldProbe, 19);
pruefe($wenig['stufe'] === 'zu_wenig', '19 Punkte duerfen kein Urteil tragen');
pruefe(str_contains($wenig['satz'], '19'), 'und die Zahl muss im Satz stehen');

// --- J6: 🚩 DIE FUENF ECHTEN PASSPUNKTE BEKOMMEN DESHALB KEIN URTEIL.
// Sie zeigen in dieselbe Richtung wie die Meldungen der Editoren -- das ist ein Hinweis und
// wird als solcher gefuehrt. Ein Werkzeug, das aus fuenf Punkten ein "traegt" machte, waere
// genau die Maschine, die jede Behauptung bestaetigt.
$echtProbe = avesmapsGaretienPasspunktNachbarprobe($echtRes, 3);
pruefe(avesmapsGaretienPasspunktUrteil($echtProbe, count($echtRes))['stufe'] === 'zu_wenig',
    'aus fuenf echten Punkten darf kein Urteil werden');

echo "OK: {$pruefungen} Pruefungen\n";
