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
