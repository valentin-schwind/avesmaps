<?php

declare(strict_types=1);

// PASSPUNKTE UND RESIDUEN -- beantwortet die Frage, ob sich der Import ueberhaupt
// nachkorrigieren laesst.
//
// Entwurf: docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md
// Die Abbildung selbst steht in garetien-koordinaten.php und wird hier NICHT nachgebaut.
//
// Ein PASSPUNKT ist ein Ort, den es auf BEIDEN Karten gibt:
//   ['name' => 'Ferdok', 'gx' => -161700.0, 'gy' => 51450.0, 'ax' => 492.96887, 'ay' => 524.68549]
// `gx`/`gy` sind Wagenhalt-Einheiten (1/1000 Meile), `ax`/`ay` unsere Karteneinheiten.
//
// 💣 DIE VIER KORRELATIONEN AUS ENTWURF §2.2 SIND KEIN BEFUND, SONDERN EINE IDENTITAET.
// Dort steht, die Residuen korrelierten "null mit der Position (0,014 / 0,003 / -0,003 /
// -0,001)", und daraus wird geschlossen, es gebe keine systematische Verzerrung. Das ist
// ZIRKULAER: die Residuen einer kleinsten-Quadrate-Anpassung stehen auf JEDER Spalte ihrer
// Entwurfsmatrix senkrecht -- und die Spalten sind gx, gy und die Eins. Die vier Zahlen
// MUESSEN null sein, sonst hat der Loeser nicht konvergiert.
// Nachgemessen am 13.09.2026: eine absichtlich eingebaute quadratische Verzerrung von
// 36 Meilen Amplitude ergibt dieselben vier Nullen (auf fuenf Stellen). Ein solcher Test
// kann eine Verzerrung also gar nicht finden, so gross sie auch ist.
// ⭐ Was §2.2 wirklich traegt, ist die andere Haelfte: die Kreuzvalidierung gegen den
// Thin-Plate-Spline (2,30 gegen 1,24 Meilen). Die ist out-of-sample und bleibt gueltig.
// 🔴 Deshalb wird ein Trend hier ausschliesslich gegen die EINGEFRORENE Matrix gemessen,
// nie gegen einen frischen Fit -- siehe avesmapsGaretienPasspunktTrend().

require_once __DIR__ . '/garetien-koordinaten.php';

/** 1 Karteneinheit = 3 Meilen. Dieselbe Zahl wie AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT. */
const AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT = 3.0;

/**
 * Residuum EINES Passpunkts gegen eine Abbildung.
 *
 * Vorzeichen, und es haengt alles daran:
 *   dx > 0  der Import legt den Ort OESTLICH von unserem ab
 *   dy > 0  der Import legt ihn NOERDLICH von unserem ab
 * Die Editoren melden genau diese Richtung ("Hesindelburg nach Sueden versetzt" = dy < 0).
 * Die KORREKTUR ist folglich das Negative davon.
 *
 * @param array $punkt   Passpunkt
 * @param array|null $m  sechs Matrixwerte [xx,xy,x0,yx,yy,y0]; null = die eingefrorene
 * @return array{name:string,ax:float,ay:float,dx:float,dy:float,betrag:float,richtung:string}
 */
function avesmapsGaretienPasspunktResiduum(array $punkt, ?array $m = null): array
{
    $gx = (float) $punkt['gx'];
    $gy = (float) $punkt['gy'];

    if ($m === null) {
        [$fx, $fy] = avesmapsGaretienNachAvesmaps($gx, $gy);
    } else {
        $fx = $m[0] * $gx + $m[1] * $gy + $m[2];
        $fy = $m[3] * $gx + $m[4] * $gy + $m[5];
    }

    $k  = AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
    $dx = ($fx - (float) $punkt['ax']) * $k;
    $dy = ($fy - (float) $punkt['ay']) * $k;

    return [
        'name'     => (string) ($punkt['name'] ?? ''),
        'ax'       => (float) $punkt['ax'],
        'ay'       => (float) $punkt['ay'],
        'dx'       => $dx,
        'dy'       => $dy,
        'betrag'   => sqrt($dx * $dx + $dy * $dy),
        'richtung' => avesmapsGaretienPasspunktRichtung($dx, $dy),
    ];
}

/**
 * Die Himmelsrichtung eines Residuums -- in der Sprache, in der die Editoren melden.
 *
 * ⚠️ Eine Richtung ohne Betrag ist eine Behauptung: unter einer halben Meile liegt der Wert
 * im eigenen Rauschen der Daten (Median 1,24 Meilen), und dann heisst er "kein Versatz",
 * nicht "Nordost". Genau so reden die Editoren auch ("keine nennenswerte Abweichung").
 */
function avesmapsGaretienPasspunktRichtung(float $dx, float $dy): string
{
    if (sqrt($dx * $dx + $dy * $dy) < 0.5) {
        return 'kein';
    }

    // Nur die deutlich groessere Achse wird genannt -- "Suedost" verlangt beide.
    $senkrecht = abs($dy) >= abs($dx) * 0.4 ? ($dy > 0 ? 'Nord' : 'Sued') : '';
    $waagrecht = abs($dx) >= abs($dy) * 0.4 ? ($dx > 0 ? 'Ost' : 'West') : '';

    return ($senkrecht . $waagrecht) ?: 'kein';
}

/** Residuen einer ganzen Liste. */
function avesmapsGaretienPasspunktResiduen(array $paare, ?array $m = null): array
{
    $raus = [];
    foreach ($paare as $p) {
        $raus[] = avesmapsGaretienPasspunktResiduum($p, $m);
    }

    return $raus;
}

// ---------------------------------------------------------------------------------------------
// DIE ANPASSUNG
// ---------------------------------------------------------------------------------------------

/**
 * Kleinste Quadrate fuer EINE Zielspalte: ziel = a*gx + b*gy + c.
 *
 * 💣 ZENTRIERT GERECHNET, und das ist nicht Stil. Die Wagenhalt-Werte laufen bis 4e5, also
 * stehen in den Normalgleichungen Eintraege um 1e12 neben der Punktzahl (~150) -- die
 * Konditionszahl der ungezentrierten 3x3-Matrix liegt bei rund 1e12, von 1e16, die ein
 * double hergibt. Zentriert bleibt eine gut konditionierte 2x2-Matrix uebrig, und der
 * Achsenabschnitt faellt aus den Mittelwerten heraus.
 *
 * @throws RuntimeException wenn die Punkte in g entartet liegen (alle auf einer Geraden)
 */
function avesmapsGaretienPasspunktSpalteFitten(array $gx, array $gy, array $ziel): array
{
    $n = count($ziel);
    if ($n < 3) {
        throw new RuntimeException('Eine affine Spalte braucht mindestens 3 Punkte, hier: ' . $n);
    }

    $mx = array_sum($gx) / $n;
    $my = array_sum($gy) / $n;
    $mz = array_sum($ziel) / $n;

    $sxx = $sxy = $syy = $sxz = $syz = 0.0;
    for ($i = 0; $i < $n; $i++) {
        $dx = $gx[$i] - $mx;
        $dy = $gy[$i] - $my;
        $dz = $ziel[$i] - $mz;
        $sxx += $dx * $dx;
        $sxy += $dx * $dy;
        $syy += $dy * $dy;
        $sxz += $dx * $dz;
        $syz += $dy * $dz;
    }

    $det = $sxx * $syy - $sxy * $sxy;
    // ⚠️ Relativ pruefen, nie gegen eine feste Schranke: $sxx*$syy traegt hier Groessen um 1e22.
    if ($sxx <= 0.0 || $syy <= 0.0 || abs($det) < 1e-12 * $sxx * $syy) {
        throw new RuntimeException('Passpunkte liegen entartet (auf einer Geraden) -- kein affiner Fit moeglich');
    }

    $a = ($sxz * $syy - $syz * $sxy) / $det;
    $b = ($syz * $sxx - $sxz * $sxy) / $det;

    return [$a, $b, $mz - $a * $mx - $b * $my];
}

/**
 * Volle affine Anpassung ueber alle uebergebenen Passpunkte.
 *
 * @return array{0:float,1:float,2:float,3:float,4:float,5:float} [xx,xy,x0,yx,yy,y0]
 */
function avesmapsGaretienPasspunktAffinFit(array $paare): array
{
    $gx = $gy = $ax = $ay = [];
    foreach ($paare as $p) {
        $gx[] = (float) $p['gx'];
        $gy[] = (float) $p['gy'];
        $ax[] = (float) $p['ax'];
        $ay[] = (float) $p['ay'];
    }

    [$xx, $xy, $x0] = avesmapsGaretienPasspunktSpalteFitten($gx, $gy, $ax);
    [$yx, $yy, $y0] = avesmapsGaretienPasspunktSpalteFitten($gx, $gy, $ay);

    return [$xx, $xy, $x0, $yx, $yy, $y0];
}

/** Der Median einer Zahlenliste. Leere Liste = 0.0. */
function avesmapsGaretienPasspunktMedian(array $werte): float
{
    $n = count($werte);
    if ($n === 0) {
        return 0.0;
    }
    sort($werte);
    $m = intdiv($n, 2);

    return $n % 2 ? $werte[$m] : ($werte[$m - 1] + $werte[$m]) / 2.0;
}

/** Das p-Quantil (0..1) einer Zahlenliste, linear interpoliert. */
function avesmapsGaretienPasspunktQuantil(array $werte, float $p): float
{
    $n = count($werte);
    if ($n === 0) {
        return 0.0;
    }
    sort($werte);
    $pos = $p * ($n - 1);
    $lo  = (int) floor($pos);
    $hi  = (int) ceil($pos);

    return $lo === $hi ? $werte[$lo] : $werte[$lo] + ($pos - $lo) * ($werte[$hi] - $werte[$lo]);
}

/**
 * Robuste Anpassung: fitten, Residuen messen, Ausreisser verwerfen, wiederholen.
 *
 * 🔴 DER FILTER IST TRAGEND, NICHT KOSMETIK (Entwurf §2.4). Von 219 namensgleichen Orten
 * waren 70 VERSCHIEDENE Orte -- es gibt zwei "Hueterkloster", zwei "Dreiwegen". Ueber alle
 * 219 gerechnet steigt der Median von 1,1 auf 94 Meilen.
 *
 * Schranke: max(3 * Median, 5 Meilen). Die feste Untergrenze verhindert, dass ein bereits
 * sauberer Satz sich selbst weiter abschneidet -- ohne sie frisst sich der Filter bei jeder
 * Runde tiefer in gute Punkte hinein.
 *
 * @return array{matrix:array,inlier:array,ausreisser:array,runden:int}
 */
function avesmapsGaretienPasspunktRobustFit(array $paare, int $runden = 4, float $mindest = 5.0): array
{
    $inlier = array_values($paare);
    $matrix = avesmapsGaretienPasspunktAffinFit($inlier);
    $raus   = [];

    for ($runde = 0; $runde < $runden; $runde++) {
        $residuen = avesmapsGaretienPasspunktResiduen($inlier, $matrix);
        $betraege = array_map(static fn(array $r): float => $r['betrag'], $residuen);
        $schranke = max(3.0 * avesmapsGaretienPasspunktMedian($betraege), $mindest);

        $behalten = [];
        $gefallen = [];
        foreach ($inlier as $i => $p) {
            if ($residuen[$i]['betrag'] <= $schranke) {
                $behalten[] = $p;
            } else {
                $gefallen[] = ['punkt' => $p, 'betrag' => $residuen[$i]['betrag']];
            }
        }

        // Nichts gefallen -> fertig. Und nie unter 3 Punkte abschneiden.
        if (count($gefallen) === 0 || count($behalten) < 3) {
            return ['matrix' => $matrix, 'inlier' => $inlier, 'ausreisser' => $raus, 'runden' => $runde];
        }

        $raus   = array_merge($raus, $gefallen);
        $inlier = $behalten;
        $matrix = avesmapsGaretienPasspunktAffinFit($inlier);
    }

    return ['matrix' => $matrix, 'inlier' => $inlier, 'ausreisser' => $raus, 'runden' => $runden];
}

// ---------------------------------------------------------------------------------------------
// DIE ENTSCHEIDENDE MESSUNG
// ---------------------------------------------------------------------------------------------

/**
 * Wuerden die gemessenen Versaetze einen Ort korrigieren, den NIEMAND gemessen hat?
 *
 * 🔴 DAS IST DIE FRAGE DES OWNERS, und sie wird hier nicht beantwortet, sondern GEFAHREN:
 * Jeder Passpunkt wird der Reihe nach so behandelt, als kenne man ihn nicht. Seine Korrektur
 * wird ALLEIN aus seinen k naechsten Nachbarn geschaetzt (abstandsgewichtet), und danach wird
 * nachgesehen, ob sein Fehler dadurch KLEINER geworden ist. Genau das ist der Handgriff, den
 * die Editoren vorhaben ("der offset den wir dann fuer die referenzen haben wird dann ueberall
 * drauf gerechnet") -- nur eben auf Punkten, an denen sich das Ergebnis nachpruefen laesst.
 *
 * Das Ergebnis ist eine Zahl mit einer Richtung:
 *   nachher < vorher  -> das Feld ist zusammenhaengend, Nachbarn wissen etwas voneinander,
 *                        und eine Korrektur aus Fixpunkten traegt auch dorthin, wo keiner liegt.
 *   nachher >= vorher -> die Versaetze sind unabhaengiges Zeichenrauschen zweier von Hand
 *                        gemalter Karten. Dann korrigiert kein Fixpunkt seinen Nachbarn, und
 *                        wer es doch tut, verschiebt gesunde Orte.
 *
 * 💣 DIE NACHBARN WERDEN NACH UNSERER KARTE GESUCHT, nicht nach ihrer. Gefragt ist "welcher
 * Ort liegt neben dem, den ich korrigieren will" -- und das ist die Stelle auf UNSERER Karte,
 * denn dorthin wird gerechnet.
 * 💣 UND DER PUNKT SELBST IST AUSGESCHLOSSEN. Waere er unter seinen eigenen Nachbarn, saehe
 * jede noch so zufaellige Punktwolke wie ein perfekt korrigierbares Feld aus -- der Fehler
 * ginge gegen null, und zwar umso mehr, je feiner man gewichtet. Das ist die Ueberanpassung,
 * gegen die diese ganze Messung gebaut ist.
 *
 * @param array $residuen Ergebnis von avesmapsGaretienPasspunktResiduen()
 * @param int   $k        wie viele Nachbarn eine Schaetzung tragen
 * @param float $potenz   Abstandsgewicht 1/d^potenz
 * @return array{k:int,punkte:array,vorher_median:float,nachher_median:float,
 *               vorher_p90:float,nachher_p90:float,gewinn_median:float,
 *               anteil_besser:float,uebereinstimmung:float}
 */
function avesmapsGaretienPasspunktNachbarprobe(array $residuen, int $k = 5, float $potenz = 1.0): array
{
    $n = count($residuen);
    $k = max(1, min($k, $n - 1));

    $punkte  = [];
    $vorher  = [];
    $nachher = [];
    $besser  = 0;
    $kosinus = [];

    foreach ($residuen as $i => $r) {
        // Abstaende zu allen ANDEREN, in Meilen.
        $abstand = [];
        foreach ($residuen as $j => $s) {
            if ($i === $j) {
                continue;
            }
            $dx = ($s['ax'] - $r['ax']) * AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
            $dy = ($s['ay'] - $r['ay']) * AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
            $abstand[] = ['j' => $j, 'd' => sqrt($dx * $dx + $dy * $dy)];
        }
        usort($abstand, static fn(array $a, array $b): int => $a['d'] <=> $b['d']);
        $nachbarn = array_slice($abstand, 0, $k);

        // Abstandsgewichtetes Mittel der Nachbar-Residuen = die geschaetzte Korrektur.
        $gx = $gy = $gw = 0.0;
        foreach ($nachbarn as $nb) {
            // ⚠️ +1e-9 nur gegen die Division durch null bei deckungsgleichen Punkten.
            $w   = 1.0 / (pow(max($nb['d'], 0.0), $potenz) + 1e-9);
            $gx += $w * $residuen[$nb['j']]['dx'];
            $gy += $w * $residuen[$nb['j']]['dy'];
            $gw += $w;
        }
        $sx = $gw > 0 ? $gx / $gw : 0.0;
        $sy = $gw > 0 ? $gy / $gw : 0.0;

        $vorherBetrag  = $r['betrag'];
        $restX         = $r['dx'] - $sx;
        $restY         = $r['dy'] - $sy;
        $nachherBetrag = sqrt($restX * $restX + $restY * $restY);

        $vorher[]  = $vorherBetrag;
        $nachher[] = $nachherBetrag;
        if ($nachherBetrag < $vorherBetrag) {
            $besser++;
        }

        // Richtungs-Uebereinstimmung: +1 = Nachbarn zeigen genau dorthin, 0 = nichts gemeinsam.
        $lr = sqrt($r['dx'] * $r['dx'] + $r['dy'] * $r['dy']);
        $ls = sqrt($sx * $sx + $sy * $sy);
        if ($lr > 1e-9 && $ls > 1e-9) {
            $kosinus[] = ($r['dx'] * $sx + $r['dy'] * $sy) / ($lr * $ls);
        }

        $punkte[] = [
            'name'           => $r['name'],
            'ax'             => $r['ax'],
            'ay'             => $r['ay'],
            'dx'             => $r['dx'],
            'dy'             => $r['dy'],
            'schaetzung_dx'  => $sx,
            'schaetzung_dy'  => $sy,
            'vorher'         => $vorherBetrag,
            'nachher'        => $nachherBetrag,
            'nachbar_median' => avesmapsGaretienPasspunktMedian(array_column($nachbarn, 'd')),
        ];
    }

    $vm = avesmapsGaretienPasspunktMedian($vorher);
    $nm = avesmapsGaretienPasspunktMedian($nachher);

    return [
        'k'                => $k,
        'punkte'           => $punkte,
        'vorher_median'    => $vm,
        'nachher_median'   => $nm,
        'vorher_p90'       => avesmapsGaretienPasspunktQuantil($vorher, 0.9),
        'nachher_p90'      => avesmapsGaretienPasspunktQuantil($nachher, 0.9),
        'gewinn_median'    => $vm - $nm,
        'anteil_besser'    => $n > 0 ? $besser / $n : 0.0,
        'uebereinstimmung' => count($kosinus) > 0 ? array_sum($kosinus) / count($kosinus) : 0.0,
    ];
}

// ---------------------------------------------------------------------------------------------
// DIE BEHAUPTUNGEN DER EDITOREN, EINZELN GEPRUEFT
// ---------------------------------------------------------------------------------------------

/**
 * Ein winziger, bewusst festgenagelter Zufallsgenerator.
 *
 * 💣 NICHT mt_rand(). Ein Permutationstest, dessen Ergebnis sich zwischen zwei Laeufen
 * aendert, ist als Zusicherung wertlos -- und `mt_srand()` ist ein globaler Zustand, den
 * jeder Nachbar im selben Prozess umstellen kann. Dieser hier gehoert dem Aufrufer.
 */
final class AvesmapsGaretienWuerfel
{
    private int $zustand;

    public function __construct(int $saat)
    {
        // 0 waere ein Fixpunkt des Generators -- er lieferte dann immer dieselbe Zahl.
        $this->zustand = ($saat & 0x7FFFFFFF) ?: 1;
    }

    /** Ganzzahl in [0, $grenze). */
    public function bis(int $grenze): int
    {
        // Park-Miller, minimal standard.
        $this->zustand = (int) ((16807 * $this->zustand) % 2147483647);

        return $grenze > 0 ? $this->zustand % $grenze : 0;
    }
}

/**
 * "Je weiter es nach Westen geht, desto staerker verschiebt GGP nach Sueden."
 *
 * Das Bauchgefuehl eines Editors, und es ist eine praezise, pruefbare Aussage: eine Gerade
 * durch (Ost-West-Lage | Nord-Sued-Versatz). Gemessen wird die Steigung und dazu, wie oft
 * reiner Zufall dieselbe Steigung hergaebe (Permutationstest, verteilungsfrei).
 *
 * 🔴 NUR GEGEN DIE EINGEFRORENE MATRIX AUSSAGEKRAEFTIG. Gegen einen frischen Fit ist diese
 * Steigung per Konstruktion EXAKT null -- die Residuen kleinster Quadrate stehen auf gx und
 * gy senkrecht. Wer sie dort misst, misst seinen eigenen Loeser und bekommt die Nullen aus
 * Entwurf §2.2 zurueck. Der Aufrufer muss `$residuen` deshalb ohne `$m` gebildet haben.
 *
 * @param array $residuen Residuen gegen die eingefrorene Matrix
 * @param int   $proben   Permutationen fuer den p-Wert
 * @return array{steigung_je_100_meilen:float,sued_je_100_west:float,p_wert:float,n:int,
 *               ost_west_spanne_meilen:float}
 */
function avesmapsGaretienPasspunktWestSuedTrend(array $residuen, int $proben = 2000, int $saat = 1): array
{
    $n = count($residuen);
    if ($n < 3) {
        return ['steigung_je_100_meilen' => 0.0, 'sued_je_100_west' => 0.0,
                'p_wert' => 1.0, 'n' => $n, 'ost_west_spanne_meilen' => 0.0];
    }

    $ost = [];   // Lage in Meilen oestlich (aus unserer Karte)
    $dy  = [];   // Nord-Sued-Versatz in Meilen
    foreach ($residuen as $r) {
        $ost[] = $r['ax'] * AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
        $dy[]  = $r['dy'];
    }

    $steigung = static function (array $x, array $y): float {
        $n  = count($x);
        $mx = array_sum($x) / $n;
        $my = array_sum($y) / $n;
        $sxy = $sxx = 0.0;
        for ($i = 0; $i < $n; $i++) {
            $dx   = $x[$i] - $mx;
            $sxy += $dx * ($y[$i] - $my);
            $sxx += $dx * $dx;
        }

        return $sxx > 0 ? $sxy / $sxx : 0.0;
    };

    $echt = $steigung($ost, $dy);

    // Permutationstest: wie oft wuerfelt reines Rauschen eine mindestens so steile Gerade?
    $wuerfel = new AvesmapsGaretienWuerfel($saat);
    $mindest = 0;
    for ($p = 0; $p < $proben; $p++) {
        $misch = $dy;
        for ($i = count($misch) - 1; $i > 0; $i--) {
            $j = $wuerfel->bis($i + 1);
            [$misch[$i], $misch[$j]] = [$misch[$j], $misch[$i]];
        }
        if (abs($steigung($ost, $misch)) >= abs($echt)) {
            $mindest++;
        }
    }

    return [
        // Meilen Nord-Versatz je 100 Meilen weiter OSTEN.
        'steigung_je_100_meilen' => $echt * 100.0,
        // Dieselbe Zahl in der Sprache der Behauptung: Meilen SUED je 100 Meilen WEST.
        // Positiv = die Behauptung stimmt.
        'sued_je_100_west'       => $echt * 100.0,
        // ⚠️ +1 im Zaehler und Nenner: ohne sie kann ein p-Wert 0 herauskommen, und
        // "unmoeglich" ist aus endlich vielen Proben nie belegbar.
        'p_wert'                 => ($mindest + 1) / ($proben + 1),
        'n'                      => $n,
        'ost_west_spanne_meilen' => (max($ost) - min($ost)),
    ];
}

/**
 * Bringt EIN globaler Versatz etwas? Auch das kreuzvalidiert, sonst ist die Antwort immer ja.
 *
 * 💣 Der Versatz wird je Punkt aus allen ANDEREN gebildet. Rechnete man ihn ueber alle und
 * zoege ihn dann von allen ab, saehe jeder Datensatz besser aus -- man haette den Mittelwert
 * an sich selbst angepasst.
 * ⚠️ Gegen einen frischen affinen Fit ist der Gewinn hier per Konstruktion ~0: kleinste
 * Quadrate legen den Mittelwert der Residuen bereits auf null. Aussagekraeftig ist die
 * Messung nur gegen die EINGEFRORENE Matrix -- also gegen das, was heute ausgeliefert wird.
 */
function avesmapsGaretienPasspunktGlobalerVersatz(array $residuen): array
{
    $n = count($residuen);
    if ($n < 2) {
        return ['vorher_median' => 0.0, 'nachher_median' => 0.0, 'gewinn_median' => 0.0,
                'versatz_dx' => 0.0, 'versatz_dy' => 0.0, 'n' => $n];
    }

    $sx = array_sum(array_column($residuen, 'dx'));
    $sy = array_sum(array_column($residuen, 'dy'));

    $vorher = $nachher = [];
    foreach ($residuen as $r) {
        // Mittel OHNE diesen Punkt.
        $mx = ($sx - $r['dx']) / ($n - 1);
        $my = ($sy - $r['dy']) / ($n - 1);
        $vorher[]  = $r['betrag'];
        $nachher[] = sqrt(($r['dx'] - $mx) ** 2 + ($r['dy'] - $my) ** 2);
    }

    $vm = avesmapsGaretienPasspunktMedian($vorher);
    $nm = avesmapsGaretienPasspunktMedian($nachher);

    return [
        'vorher_median'  => $vm,
        'nachher_median' => $nm,
        'gewinn_median'  => $vm - $nm,
        'versatz_dx'     => $sx / $n,
        'versatz_dy'     => $sy / $n,
        'n'              => $n,
    ];
}

// ---------------------------------------------------------------------------------------------
// DAS URTEIL
// ---------------------------------------------------------------------------------------------

/** Unter so vielen Passpunkten wird gar nicht erst geurteilt. */
const AVESMAPS_GARETIEN_PASSPUNKT_MINDESTZAHL = 20;

/**
 * Traegt eine Korrektur aus Fixpunkten -- ja oder nein?
 *
 * 🔴 DIE REGEL STEHT HIER UND NICHT IM MOCKUP. Sie ist eine Entscheidung, keine Darstellung:
 * wer sie in JavaScript nachbaut, hat zwei Antworten auf dieselbe Frage, und die zweite
 * pruefte niemand. Das Mockup zeichnet den Satz, den diese Funktion liefert.
 *
 * Zwei Schranken, und BEIDE muessen fallen:
 *   - der Gewinn traegt mindestens ein Viertel des Ausgangsfehlers. Weniger lohnt das Risiko
 *     nicht: eine Korrektur verschiebt auch die Orte, die heute richtig liegen.
 *   - die Nachbarn sind sich ueber die RICHTUNG einig (Kosinus > 0,4). Ohne das ist ein
 *     Gewinn Zufall -- man hat Rauschen gegen Rauschen gemittelt und einmal Glueck gehabt.
 *
 * ⚠️ Die zweite Schranke ist die wichtigere. Ein Gewinn allein laesst sich mit genuegend
 * Nachbarn fast immer herbeimitteln; eine gemeinsame Richtung nicht.
 *
 * @return array{stufe:string,satz:string}
 */
function avesmapsGaretienPasspunktUrteil(array $probe, int $anzahl): array
{
    if ($anzahl < AVESMAPS_GARETIEN_PASSPUNKT_MINDESTZAHL) {
        return [
            'stufe' => 'zu_wenig',
            'satz'  => sprintf(
                '%d Passpunkte sind zu wenig fuer eine Aussage -- gebraucht werden mindestens %d.',
                $anzahl,
                AVESMAPS_GARETIEN_PASSPUNKT_MINDESTZAHL
            ),
        ];
    }

    $vorher = (float) ($probe['vorher_median'] ?? 0.0);
    $gewinn = (float) ($probe['gewinn_median'] ?? 0.0);
    $einig  = (float) ($probe['uebereinstimmung'] ?? 0.0);

    if ($vorher > 0.0 && $gewinn > 0.25 * $vorher && $einig > 0.4) {
        return [
            'stufe' => 'traegt',
            'satz'  => sprintf(
                'Eine Korrektur aus Fixpunkten TRAEGT: sie senkt den Fehler an Orten, die gar '
                . 'nicht gemessen wurden, von %.2f auf %.2f Meilen, und die Nachbarn sind sich '
                . 'ueber die Richtung einig (%.2f).',
                $vorher,
                (float) $probe['nachher_median'],
                $einig
            ),
        ];
    }

    return [
        'stufe' => 'traegt_nicht',
        'satz'  => sprintf(
            'Eine Korrektur aus Fixpunkten TRAEGT NICHT: an ungemessenen Orten geht der Fehler '
            . 'von %.2f nur auf %.2f Meilen, und die Nachbarn sind sich ueber die Richtung %s '
            . '(%.2f). Der Versatz ist dann Zeichendifferenz zweier von Hand gemalter Karten -- '
            . 'wer ihn wegrechnet, verschiebt die Orte, die heute richtig liegen.',
            $vorher,
            (float) ($probe['nachher_median'] ?? 0.0),
            $einig > 0.4 ? 'zwar einig' : 'NICHT einig',
            $einig
        ),
    ];
}
