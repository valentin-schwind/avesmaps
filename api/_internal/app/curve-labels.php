<?php

declare(strict_types=1);

// Die Beschriftungskurve einer Landschaftsflaeche -- die Mittelachse, auf der ihr Name laeuft.
// Verfahren nach eox.at/2015/12/curved-labels: segmentieren -> vereinfachen -> Delaunay ->
// Innendreiecke -> Chordal Axis -> laengster Pfad -> Polynomglaettung.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §3
//
// 🔴 REINE FUNKTIONEN. Kein PDO, keine Globals, kein I/O -- der Leser steht in
// curve-label-store.php. Grund: ein Endpunkt laeuft beim Include los, also ist nichts testbar, was
// in ihm steht (dieselbe Begruendung wie im Kopf von ecosystem-label-link.php).
//
// Ein Punkt ist ueberall [x, y] in KARTENkoordinaten. Ein Ring ist geschlossen
// ($ring[0] == $ring[count-1]); $rings[0] ist der Aussenring, $rings[1..] sind Loecher.

function avesmapsCurveRingArea(array $ring): float
{
    $summe = 0.0;
    $anzahl = count($ring);
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $summe += ($ring[$j][0] * $ring[$i][1]) - ($ring[$i][0] * $ring[$j][1]);
    }

    return $summe / 2.0;
}

// Strahlenschnitt. Ein Punkt exakt auf der Kante ist eine Muenze -- das ist hier egal, solange es
// konsistent ist, und die Aufrufer ruecken ihre Pruefpunkte ohnehin nach innen (siehe Aufgabe 3).
function avesmapsCurvePointInRing(array $pt, array $ring): bool
{
    $drinnen = false;
    $x = $pt[0];
    $y = $pt[1];
    $anzahl = count($ring);
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $yi = $ring[$i][1];
        $yj = $ring[$j][1];
        if (($yi > $y) === ($yj > $y)) {
            continue;
        }
        $xi = $ring[$i][0];
        $xj = $ring[$j][0];
        if ($x < (($xj - $xi) * ($y - $yi) / ($yj - $yi)) + $xi) {
            $drinnen = !$drinnen;
        }
    }

    return $drinnen;
}

function avesmapsCurvePointInPolygon(array $pt, array $rings): bool
{
    if ($rings === [] || !avesmapsCurvePointInRing($pt, $rings[0])) {
        return false;
    }
    $anzahl = count($rings);
    for ($i = 1; $i < $anzahl; $i++) {
        if (avesmapsCurvePointInRing($pt, $rings[$i])) {
            return false;
        }
    }

    return true;
}

// Douglas-Peucker auf einer OFFENEN Punktfolge.
function avesmapsCurveDouglasPeucker(array $pts, float $tol): array
{
    $anzahl = count($pts);
    if ($anzahl < 3) {
        return $pts;
    }
    $behalten = array_fill(0, $anzahl, false);
    $behalten[0] = true;
    $behalten[$anzahl - 1] = true;
    $stapel = [[0, $anzahl - 1]];
    while ($stapel !== []) {
        [$s, $e] = array_pop($stapel);
        $maxAbstand = -1.0;
        $index = -1;
        $ax = $pts[$s][0];
        $ay = $pts[$s][1];
        $dx = $pts[$e][0] - $ax;
        $dy = $pts[$e][1] - $ay;
        $len2 = ($dx * $dx) + ($dy * $dy);
        for ($i = $s + 1; $i < $e; $i++) {
            $px = $pts[$i][0] - $ax;
            $py = $pts[$i][1] - $ay;
            if ($len2 <= 0.0) {
                $abstand = sqrt(($px * $px) + ($py * $py));
            } else {
                $t = max(0.0, min(1.0, (($px * $dx) + ($py * $dy)) / $len2));
                $abstand = sqrt((($px - ($t * $dx)) ** 2) + (($py - ($t * $dy)) ** 2));
            }
            if ($abstand > $maxAbstand) {
                $maxAbstand = $abstand;
                $index = $i;
            }
        }
        if ($maxAbstand > $tol && $index > 0) {
            $behalten[$index] = true;
            $stapel[] = [$s, $index];
            $stapel[] = [$index, $e];
        }
    }
    $raus = [];
    for ($i = 0; $i < $anzahl; $i++) {
        if ($behalten[$i]) {
            $raus[] = $pts[$i];
        }
    }

    return $raus;
}

// 💣 Ein GESCHLOSSENER Ring hat keine natuerlichen Enden fuer Douglas-Peucker. Deshalb die zwei am
// weitesten auseinander liegenden Punkte als Anker nehmen und beide Haelften einzeln vereinfachen.
// Ohne das faellt je nach Startpunkt ein anderer Teil des Randes weg.
function avesmapsCurveSimplifyRing(array $ring, float $tol): array
{
    if ($tol <= 0.0 || count($ring) < 5) {
        return $ring;
    }
    $pts = $ring;
    $letzter = count($pts) - 1;
    if (abs($pts[0][0] - $pts[$letzter][0]) < 1e-9 && abs($pts[0][1] - $pts[$letzter][1]) < 1e-9) {
        array_pop($pts);
    }
    $anzahl = count($pts);
    if ($anzahl < 5) {
        return $ring;
    }
    $b = 0;
    $best = -1.0;
    for ($i = 1; $i < $anzahl; $i++) {
        $d = hypot($pts[0][0] - $pts[$i][0], $pts[0][1] - $pts[$i][1]);
        if ($d > $best) {
            $best = $d;
            $b = $i;
        }
    }
    $a = 0;
    $best = -1.0;
    for ($i = 0; $i < $anzahl; $i++) {
        $d = hypot($pts[$b][0] - $pts[$i][0], $pts[$b][1] - $pts[$i][1]);
        if ($d > $best) {
            $best = $d;
            $a = $i;
        }
    }
    $lo = min($a, $b);
    $hi = max($a, $b);
    if (($hi - $lo) < 2 || ($anzahl - ($hi - $lo)) < 2) {
        return $ring;
    }
    $haelfte1 = array_slice($pts, $lo, $hi - $lo + 1);
    $haelfte2 = array_merge(array_slice($pts, $hi), array_slice($pts, 0, $lo + 1));
    $s1 = avesmapsCurveDouglasPeucker($haelfte1, $tol);
    $s2 = avesmapsCurveDouglasPeucker($haelfte2, $tol);
    $raus = array_merge($s1, array_slice($s2, 1, count($s2) - 2));
    if (count($raus) < 3) {
        return $ring;
    }
    $raus[] = $raus[0];

    return $raus;
}

// Gleichmaessige Stuetzpunkte. Rueckgabe ist OFFEN -- der Schlusspunkt wiederholt den ersten und
// waere im Punktvorrat der Triangulierung ein Duplikat.
function avesmapsCurveDensifyRing(array $ring, float $spacing): array
{
    $raus = [];
    $anzahl = count($ring) - 1;
    for ($i = 0; $i < $anzahl; $i++) {
        $a = $ring[$i];
        $b = $ring[$i + 1];
        $raus[] = $a;
        $d = hypot($b[0] - $a[0], $b[1] - $a[1]);
        if ($spacing > 0.0 && $d > $spacing) {
            $n = (int) floor($d / $spacing);
            for ($k = 1; $k <= $n; $k++) {
                $t = $k / ($n + 1);
                $raus[] = [$a[0] + (($b[0] - $a[0]) * $t), $a[1] + (($b[1] - $a[1]) * $t)];
            }
        }
    }

    return $raus;
}

// Umkreis eines Dreiecks. null bei entarteten (kollinearen) Dreiecken.
function avesmapsCurveCircumcircle(float $ax, float $ay, float $bx, float $by, float $cx, float $cy): ?array
{
    $d = 2.0 * (($ax * ($by - $cy)) + ($bx * ($cy - $ay)) + ($cx * ($ay - $by)));
    if (abs($d) < 1e-12) {
        return null;
    }
    $a2 = ($ax * $ax) + ($ay * $ay);
    $b2 = ($bx * $bx) + ($by * $by);
    $c2 = ($cx * $cx) + ($cy * $cy);
    $ux = (($a2 * ($by - $cy)) + ($b2 * ($cy - $ay)) + ($c2 * ($ay - $by))) / $d;
    $uy = (($a2 * ($cx - $bx)) + ($b2 * ($ax - $cx)) + ($c2 * ($bx - $ax))) / $d;

    return ['x' => $ux, 'y' => $uy, 'r2' => (($ax - $ux) ** 2) + (($ay - $uy) ** 2)];
}

// Delaunay nach Bowyer-Watson. Fuer die hier auftretenden Punktzahlen (gemessen 189-779 je Flaeche)
// ist die einfache Fassung schnell genug; eine Bibliothek waere eine neue Abhaengigkeit in einem
// Projekt ohne Bauschritt.
function avesmapsCurveDelaunay(array $points): array
{
    $n = count($points);
    if ($n < 3) {
        return [];
    }
    $minX = $minY = INF;
    $maxX = $maxY = -INF;
    foreach ($points as $p) {
        $minX = min($minX, $p[0]);
        $maxX = max($maxX, $p[0]);
        $minY = min($minY, $p[1]);
        $maxY = max($maxY, $p[1]);
    }
    $dm = max($maxX - $minX ?: 1.0, $maxY - $minY ?: 1.0) * 20.0;
    $mx = ($minX + $maxX) / 2.0;
    $my = ($minY + $maxY) / 2.0;
    $pts = $points;
    $pts[] = [$mx - $dm, $my - $dm];
    $pts[] = [$mx + $dm, $my - $dm];
    $pts[] = [$mx, $my + $dm];

    $mache = static function (int $a, int $b, int $c) use ($pts): array {
        return [
            'a' => $a,
            'b' => $b,
            'c' => $c,
            'cc' => avesmapsCurveCircumcircle(
                $pts[$a][0], $pts[$a][1], $pts[$b][0], $pts[$b][1], $pts[$c][0], $pts[$c][1]
            ),
        ];
    };

    $tris = [$mache($n, $n + 1, $n + 2)];
    for ($i = 0; $i < $n; $i++) {
        $px = $pts[$i][0];
        $py = $pts[$i][1];
        $schlecht = [];
        $gut = [];
        foreach ($tris as $t) {
            $cc = $t['cc'];
            if ($cc !== null && ((($px - $cc['x']) ** 2) + (($py - $cc['y']) ** 2)) <= $cc['r2'] + 1e-9) {
                $schlecht[] = $t;
            } else {
                $gut[] = $t;
            }
        }
        $kanten = [];
        foreach ($schlecht as $t) {
            foreach ([[$t['a'], $t['b']], [$t['b'], $t['c']], [$t['c'], $t['a']]] as $e) {
                $k = $e[0] < $e[1] ? $e[0] . ',' . $e[1] : $e[1] . ',' . $e[0];
                if (isset($kanten[$k])) {
                    $kanten[$k]['n']++;
                } else {
                    $kanten[$k] = ['n' => 1, 'a' => $e[0], 'b' => $e[1]];
                }
            }
        }
        $tris = $gut;
        foreach ($kanten as $rec) {
            if ($rec['n'] === 1) {
                $tris[] = $mache($rec['a'], $rec['b'], $i);
            }
        }
    }
    $raus = [];
    foreach ($tris as $t) {
        if ($t['a'] < $n && $t['b'] < $n && $t['c'] < $n) {
            $raus[] = [$t['a'], $t['b'], $t['c']];
        }
    }

    return $raus;
}

// Die Mittelachse aus den Innendreiecken (Chordal Axis).
//
// Knoten sind die Mittelpunkte der INNEREN Kanten -- Kanten zwischen zwei Innendreiecken. Ein
// Dreieck mit drei inneren Kanten ist eine Verzweigung (Stern ueber den Schwerpunkt), mit zwei ein
// Durchgang, mit einer eine Spitze (bis zur gegenueberliegenden Ecke).
//
// 💣 FALLE 1 -- der Innentest. Der Schwerpunkt allein genuegt nicht: ein Dreieck ueber einer Bucht
// kann ihn drinnen haben und trotzdem draussen verlaufen. Also auch die drei Kantenmitten pruefen,
// ABER ein Stueck zum Schwerpunkt hin gerueckt: die Mitte einer RANDkante liegt exakt auf der
// Polygonlinie, und dort ist der Strahlentest eine Muenze. Ungerueckt fiel im Prototyp jedes
// randstaendige Dreieck heraus und die Achse zerfiel in Splitter (Rohachse 2,2 statt 139 Einheiten
// an den Drachensteinen). Eine Sehne UEBER eine Bucht holt der Ruck nicht herein -- 5 % sind zu
// wenig.
//
// 💣 FALLE 2 -- KEIN Deckel auf die Kantenlaenge. Im Inneren einer breiten Flaeche sind die
// Dreiecke von Natur aus gross. Ein Laengendeckel wirkt wie eine Rauschunterdrueckung und loescht
// genau die Achse, die man sucht.
function avesmapsCurveChordalAxis(array $points, array $tris, array $rings): array
{
    $inner = [];
    foreach ($tris as $t) {
        [$a, $b, $c] = $t;
        $cx = ($points[$a][0] + $points[$b][0] + $points[$c][0]) / 3.0;
        $cy = ($points[$a][1] + $points[$b][1] + $points[$c][1]) / 3.0;
        if (!avesmapsCurvePointInPolygon([$cx, $cy], $rings)) {
            continue;
        }
        $ruck = static function (float $px, float $py) use ($cx, $cy): array {
            return [$px + (($cx - $px) * 0.05), $py + (($cy - $py) * 0.05)];
        };
        $mitten = [
            $ruck(($points[$a][0] + $points[$b][0]) / 2.0, ($points[$a][1] + $points[$b][1]) / 2.0),
            $ruck(($points[$b][0] + $points[$c][0]) / 2.0, ($points[$b][1] + $points[$c][1]) / 2.0),
            $ruck(($points[$c][0] + $points[$a][0]) / 2.0, ($points[$c][1] + $points[$a][1]) / 2.0),
        ];
        $drinnen = true;
        foreach ($mitten as $m) {
            if (!avesmapsCurvePointInPolygon($m, $rings)) {
                $drinnen = false;
                break;
            }
        }
        if ($drinnen) {
            $inner[] = ['v' => $t, 'cx' => $cx, 'cy' => $cy];
        }
    }

    $kantenSchluessel = static function (int $i, int $j): string {
        return $i < $j ? $i . ',' . $j : $j . ',' . $i;
    };
    $nutzung = [];
    foreach ($inner as $ti => $rec) {
        [$a, $b, $c] = $rec['v'];
        foreach ([[$a, $b], [$b, $c], [$c, $a]] as $e) {
            $nutzung[$kantenSchluessel($e[0], $e[1])][] = $ti;
        }
    }

    $nodes = [];
    $adj = [];
    $index = [];
    $knoten = static function (string $key, float $x, float $y) use (&$nodes, &$adj, &$index): int {
        if (isset($index[$key])) {
            return $index[$key];
        }
        $id = count($nodes);
        $nodes[] = [$x, $y];
        $adj[] = [];
        $index[$key] = $id;

        return $id;
    };
    $binde = static function (int $u, int $v) use (&$nodes, &$adj): void {
        $w = hypot($nodes[$u][0] - $nodes[$v][0], $nodes[$u][1] - $nodes[$v][1]);
        $adj[$u][] = [$v, $w];
        $adj[$v][] = [$u, $w];
    };

    foreach ($inner as $ti => $rec) {
        [$a, $b, $c] = $rec['v'];
        $geteilt = [];
        foreach ([[$a, $b], [$b, $c], [$c, $a]] as $e) {
            if (count($nutzung[$kantenSchluessel($e[0], $e[1])] ?? []) === 2) {
                $geteilt[] = $e;
            }
        }
        if ($geteilt === []) {
            continue;
        }
        $mitte = static function (array $e) use ($points, $knoten, $kantenSchluessel): int {
            return $knoten(
                'e' . $kantenSchluessel($e[0], $e[1]),
                ($points[$e[0]][0] + $points[$e[1]][0]) / 2.0,
                ($points[$e[0]][1] + $points[$e[1]][1]) / 2.0
            );
        };
        if (count($geteilt) === 3) {
            $mittelpunkt = $knoten('t' . $ti, $rec['cx'], $rec['cy']);
            foreach ($geteilt as $e) {
                $binde($mittelpunkt, $mitte($e));
            }
        } elseif (count($geteilt) === 2) {
            $binde($mitte($geteilt[0]), $mitte($geteilt[1]));
        } else {
            $e = $geteilt[0];
            $spitze = null;
            foreach ([$a, $b, $c] as $v) {
                if ($v !== $e[0] && $v !== $e[1]) {
                    $spitze = $v;
                    break;
                }
            }
            if ($spitze !== null) {
                $binde($mitte($e), $knoten('v' . $spitze, $points[$spitze][0], $points[$spitze][1]));
            }
        }
    }

    return ['nodes' => $nodes, 'adj' => $adj, 'inner_count' => count($inner)];
}

// Dijkstra vom Startknoten; liefert den entferntesten Knoten und die Vorgaengerkette.
function avesmapsCurveFarthest(array $nodes, array $adj, int $start): array
{
    $anzahl = count($nodes);
    $dist = array_fill(0, $anzahl, INF);
    $prev = array_fill(0, $anzahl, -1);
    $fertig = array_fill(0, $anzahl, false);
    $dist[$start] = 0.0;
    while (true) {
        $u = -1;
        $best = INF;
        for ($i = 0; $i < $anzahl; $i++) {
            if (!$fertig[$i] && $dist[$i] < $best) {
                $best = $dist[$i];
                $u = $i;
            }
        }
        if ($u < 0) {
            break;
        }
        $fertig[$u] = true;
        foreach ($adj[$u] as [$v, $w]) {
            if ($dist[$u] + $w < $dist[$v]) {
                $dist[$v] = $dist[$u] + $w;
                $prev[$v] = $u;
            }
        }
    }
    $knoten = $start;
    $best = -1.0;
    for ($i = 0; $i < $anzahl; $i++) {
        if ($dist[$i] < INF && $dist[$i] > $best) {
            $best = $dist[$i];
            $knoten = $i;
        }
    }

    return ['node' => $knoten, 'prev' => $prev];
}

// Die „beste" Mittellinie: der laengste gewichtete Pfad, gefunden mit zwei Dijkstra-Laeufen.
function avesmapsCurveLongestPath(array $nodes, array $adj): array
{
    if ($nodes === []) {
        return [];
    }
    $a = avesmapsCurveFarthest($nodes, $adj, 0);
    $b = avesmapsCurveFarthest($nodes, $adj, $a['node']);
    $pfad = [];
    $cur = $b['node'];
    $wache = 0;
    while ($cur !== -1 && $wache++ < count($nodes) + 5) {
        $pfad[] = $nodes[$cur];
        $cur = $b['prev'][$cur];
    }

    return array_reverse($pfad);
}

function avesmapsCurveLineLength(array $line): float
{
    $l = 0.0;
    $anzahl = count($line);
    for ($i = 1; $i < $anzahl; $i++) {
        $l += hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }

    return $l;
}

// Auf n gleichmaessig verteilte Punkte umtasten.
function avesmapsCurveResample(array $line, int $n): array
{
    if (count($line) < 2 || $n < 2) {
        return $line;
    }
    $kum = [0.0];
    for ($i = 1; $i < count($line); $i++) {
        $kum[$i] = $kum[$i - 1] + hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }
    $gesamt = $kum[count($kum) - 1];
    if ($gesamt <= 0.0) {
        return $line;
    }
    $raus = [];
    $seg = 1;
    for ($k = 0; $k < $n; $k++) {
        $ziel = ($gesamt * $k) / ($n - 1);
        while ($seg < count($kum) - 1 && $kum[$seg] < $ziel) {
            $seg++;
        }
        $spanne = $kum[$seg] - $kum[$seg - 1];
        $t = $spanne > 0.0 ? ($ziel - $kum[$seg - 1]) / $spanne : 0.0;
        $raus[] = [
            $line[$seg - 1][0] + (($line[$seg][0] - $line[$seg - 1][0]) * $t),
            $line[$seg - 1][1] + (($line[$seg][1] - $line[$seg - 1][1]) * $t),
        ];
    }

    return $raus;
}

// Polynomfit im Hauptachsen-Frame. Das Ergebnis ist von Bauart her EINE weiche Biegung und kein
// geglaetteter Zickzack -- Schrift auf einem Zickzack ist unlesbar, lange bevor die Kurve „falsch"
// waere.
// Der Hauptachsen-Frame einer Punktwolke: Schwerpunkt plus die Richtung der groessten Streuung.
// 🔴 EIGENE FUNKTION, weil ZWEI Rechnungen ihn brauchen -- der Polynomfit einer Linie und der Fit
// ueber mehrere Teilflaechen. Zweimal dieselben zwanzig Zeilen waeren die zweite Wahrheit ueber
// dieselbe Groesse, und sie laufen beim ersten Eingriff auseinander.
//
// @return array{0:float,1:float,2:float,3:float} [mx, my, cos(theta), sin(theta)]
function avesmapsCurvePrincipalFrame(array $points): array
{
    $n = count($points);
    if ($n === 0) {
        return [0.0, 0.0, 1.0, 0.0];
    }
    $mx = 0.0;
    $my = 0.0;
    foreach ($points as $p) {
        $mx += $p[0];
        $my += $p[1];
    }
    $mx /= $n;
    $my /= $n;
    $sxx = $sxy = $syy = 0.0;
    foreach ($points as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $sxx += $dx * $dx;
        $sxy += $dx * $dy;
        $syy += $dy * $dy;
    }
    $theta = 0.5 * atan2(2 * $sxy, $sxx - $syy);

    return [$mx, $my, cos($theta), sin($theta)];
}

function avesmapsCurvePolyFit(array $line, int $degree): array
{
    $n = count($line);
    if ($n < $degree + 2) {
        return $line;
    }
    [$mx, $my, $ct, $st] = avesmapsCurvePrincipalFrame($line);
    $u = [];
    $v = [];
    foreach ($line as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $u[] = ($dx * $ct) + ($dy * $st);
        $v[] = (-$dx * $st) + ($dy * $ct);
    }
    $m = $degree + 1;
    $A = [];
    for ($r = 0; $r < $m; $r++) {
        $A[$r] = array_fill(0, $m + 1, 0.0);
    }
    for ($i = 0; $i < $n; $i++) {
        $pw = [1.0];
        for ($k = 1; $k < 2 * $m; $k++) {
            $pw[$k] = $pw[$k - 1] * $u[$i];
        }
        for ($r = 0; $r < $m; $r++) {
            for ($c = 0; $c < $m; $c++) {
                $A[$r][$c] += $pw[$r + $c];
            }
            $A[$r][$m] += $pw[$r] * $v[$i];
        }
    }
    for ($col = 0; $col < $m; $col++) {
        $piv = $col;
        for ($r = $col + 1; $r < $m; $r++) {
            if (abs($A[$r][$col]) > abs($A[$piv][$col])) {
                $piv = $r;
            }
        }
        if (abs($A[$piv][$col]) < 1e-12) {
            return $line;
        }
        $tmp = $A[$col];
        $A[$col] = $A[$piv];
        $A[$piv] = $tmp;
        for ($r = 0; $r < $m; $r++) {
            if ($r === $col) {
                continue;
            }
            $f = $A[$r][$col] / $A[$col][$col];
            for ($c = $col; $c <= $m; $c++) {
                $A[$r][$c] -= $f * $A[$col][$c];
            }
        }
    }
    $koeff = [];
    for ($r = 0; $r < $m; $r++) {
        $koeff[$r] = $A[$r][$m] / $A[$r][$r];
    }
    $raus = [];
    for ($i = 0; $i < $n; $i++) {
        $w = 0.0;
        $p = 1.0;
        for ($k = 0; $k < $m; $k++) {
            $w += $koeff[$k] * $p;
            $p *= $u[$i];
        }
        $raus[] = [$mx + ($u[$i] * $ct) - ($w * $st), $my + ($u[$i] * $st) + ($w * $ct)];
    }

    return $raus;
}

// Zwischen Kurve und ihrer Sehne mischen (0 = Kurve, 1 = Gerade). Die Endpunkte bleiben liegen.
function avesmapsCurveStraighten(array $line, float $amount): array
{
    if ($amount <= 0.0 || count($line) < 2) {
        return $line;
    }
    $a = $line[0];
    $b = $line[count($line) - 1];
    $kum = [0.0];
    for ($i = 1; $i < count($line); $i++) {
        $kum[$i] = $kum[$i - 1] + hypot($line[$i][0] - $line[$i - 1][0], $line[$i][1] - $line[$i - 1][1]);
    }
    $gesamt = $kum[count($kum) - 1] ?: 1.0;
    $raus = [];
    foreach ($line as $i => $p) {
        $t = $kum[$i] / $gesamt;
        $sx = $a[0] + (($b[0] - $a[0]) * $t);
        $sy = $a[1] + (($b[1] - $a[1]) * $t);
        $raus[] = [$p[0] + (($sx - $p[0]) * $amount), $p[1] + (($sy - $p[1]) * $amount)];
    }

    return $raus;
}

// GeoJSON-Geometrien in Teilflaechen zerlegen, nach Flaeche absteigend.
function avesmapsCurveGeometryParts(array $geometries): array
{
    $teile = [];
    foreach ($geometries as $g) {
        $typ = (string) ($g['type'] ?? '');
        $koord = $g['coordinates'] ?? [];
        $polys = $typ === 'Polygon' ? [$koord] : $koord;
        foreach ($polys as $rings) {
            if (!is_array($rings) || $rings === [] || count($rings[0]) < 4) {
                continue;
            }
            $teile[] = ['rings' => $rings, 'area' => abs(avesmapsCurveRingArea($rings[0]))];
        }
    }
    usort($teile, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);

    return $teile;
}

// 💣 Ein Gebirge ist selten EINE Flaeche. Die Koschberge liegen in zwei Lappen (59 % / 41 %); die
// Mittelachse des groesseren allein endet mitten in der Kette. Deshalb die Achsen ALLER
// wesentlichen Teile als eine Punktwolke nehmen und EIN Polynom hindurchlegen -- die Luecke
// ueberbrueckt die Kurve von selbst, weil sie ueber die Hauptachse parametrisiert ist und nicht
// ueber die Flaeche laeuft.
// ⚠️ Das ist nur fuer die BESCHRIFTUNG richtig, nicht als Geometrie: die Kurve verlaesst zwischen
// zwei Lappen die Flaeche. Genau das tut eine Kartenbeschriftung auch.
function avesmapsCurveFitAcross(array $wolken, int $degree, int $samples): ?array
{
    $pts = [];
    foreach ($wolken as $w) {
        foreach ($w as $p) {
            $pts[] = $p;
        }
    }
    if (count($pts) < $degree + 2) {
        return null;
    }
    [$mx, $my, $ct, $st] = avesmapsCurvePrincipalFrame($pts);
    $paare = [];
    foreach ($pts as $p) {
        $dx = $p[0] - $mx;
        $dy = $p[1] - $my;
        $paare[] = [($dx * $ct) + ($dy * $st), (-$dx * $st) + ($dy * $ct)];
    }
    usort($paare, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
    $sortiert = [];
    foreach ($paare as $uv) {
        $sortiert[] = [$mx + ($uv[0] * $ct) - ($uv[1] * $st), $my + ($uv[0] * $st) + ($uv[1] * $ct)];
    }

    return avesmapsCurveResample(avesmapsCurvePolyFit($sortiert, $degree), $samples);
}

// Die Mittelachse EINES Teils.
function avesmapsCurveAxisForPart(array $rings, array $o): ?array
{
    $vereinfacht = [];
    foreach ($rings as $r) {
        $vereinfacht[] = avesmapsCurveSimplifyRing($r, (float) $o['simplify_tol']);
    }
    $pts = [];
    foreach ($vereinfacht as $r) {
        foreach (avesmapsCurveDensifyRing($r, (float) $o['spacing']) as $p) {
            $pts[] = $p;
        }
    }
    $gesehen = [];
    $uniq = [];
    foreach ($pts as $p) {
        $k = number_format($p[0], 4, '.', '') . ',' . number_format($p[1], 4, '.', '');
        if (!isset($gesehen[$k])) {
            $gesehen[$k] = true;
            $uniq[] = $p;
        }
    }
    if (count($uniq) < 4) {
        return null;
    }
    $tris = avesmapsCurveDelaunay($uniq);
    $achse = avesmapsCurveChordalAxis($uniq, $tris, $vereinfacht);
    if ($achse['nodes'] === []) {
        return null;
    }
    $roh = avesmapsCurveLongestPath($achse['nodes'], $achse['adj']);

    return count($roh) >= 2 ? avesmapsCurveResample($roh, (int) $o['samples']) : null;
}

// Der Gesamtlauf: Geometrien -> eine fertige Beschriftungskurve.
function avesmapsCurveBaseline(array $geometries, array $options): ?array
{
    $o = $options + [
        'simplify_tol' => 1.55,
        'spacing' => 0.30,
        'poly_degree' => 3,
        'straighten' => 0.0,
        'min_part_share' => 0.02,
        'samples' => 120,
    ];
    $teile = avesmapsCurveGeometryParts($geometries);
    if ($teile === []) {
        return null;
    }
    $gesamt = 0.0;
    foreach ($teile as $t) {
        $gesamt += $t['area'];
    }
    if ($gesamt <= 0.0) {
        return null;
    }
    // Die groesste immer, dazu jede ab dem Mindestanteil.
    $wesentlich = [];
    foreach ($teile as $i => $t) {
        if ($i === 0 || ($t['area'] / $gesamt) >= (float) $o['min_part_share']) {
            $wesentlich[] = $t;
        }
    }
    $achsen = [];
    foreach ($wesentlich as $t) {
        $achse = avesmapsCurveAxisForPart($t['rings'], $o);
        if ($achse !== null) {
            $achsen[] = $achse;
        }
    }
    if ($achsen === []) {
        return null;
    }
    if (count($achsen) > 1) {
        $gemeinsam = avesmapsCurveFitAcross($achsen, (int) $o['poly_degree'], (int) $o['samples']);
        $linie = $gemeinsam ?? $achsen[0];
    } else {
        $linie = avesmapsCurvePolyFit($achsen[0], (int) $o['poly_degree']);
    }
    $linie = avesmapsCurveStraighten($linie, (float) $o['straighten']);

    return [
        'line' => $linie,
        'length' => avesmapsCurveLineLength($linie),
        'parts_used' => count($achsen),
    ];
}
