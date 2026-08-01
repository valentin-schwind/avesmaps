<?php

// Referenzimplementierung des VORSCHLAGS. Selbsttragend, keine Abhaengigkeit vom Repo.
// Aufruf:  php referenz.php
declare(strict_types=1);

const FCAP = 4.0;

// Transportmittel: c, gmax_auf, g0, c_ab, gmax_ab
const MODES = [
    'Kutsche'      => ['c' => 0.050, 'up' => 0.15, 'g0' => 0.03, 'cab' => 0.0350, 'dn' => 0.12],
    'Karawane'     => ['c' => 0.090, 'up' => 0.25, 'g0' => 0.16, 'cab' => 0.1300, 'dn' => 0.25],
    'Gr. beritten' => ['c' => 0.079, 'up' => 0.30, 'g0' => 0.20, 'cab' => 0.0618, 'dn' => 0.30],
    'Reiter'       => ['c' => 0.079, 'up' => 0.35, 'g0' => 0.22, 'cab' => 0.0616, 'dn' => 0.35],
    'Gr. zu Fuss'  => ['c' => 0.100, 'up' => 0.40, 'g0' => 0.20, 'cab' => 0.1500, 'dn' => 0.40],
    'Fuss leicht'  => ['c' => 0.100, 'up' => 0.45, 'g0' => 0.20, 'cab' => 0.1500, 'dn' => 0.45],
];

// Grundgeschwindigkeiten aus js/config.js (SPEED_TABLE), Meilen/h. NICHT Gegenstand des Vorschlags.
const SPEEDS = [
    'Reichsstrasse' => ['Kutsche'=>6.0,'Karawane'=>4.0,'Gr. beritten'=>7.0,'Reiter'=>8.5,'Gr. zu Fuss'=>4.5,'Fuss leicht'=>5.5],
    'Strasse'       => ['Kutsche'=>5.5,'Karawane'=>3.5,'Gr. beritten'=>6.5,'Reiter'=>8.0,'Gr. zu Fuss'=>4.0,'Fuss leicht'=>5.0],
    'Weg'           => ['Kutsche'=>4.5,'Karawane'=>3.0,'Gr. beritten'=>5.5,'Reiter'=>7.0,'Gr. zu Fuss'=>3.5,'Fuss leicht'=>4.5],
    'Pfad'          => ['Kutsche'=>3.0,'Karawane'=>2.5,'Gr. beritten'=>4.5,'Reiter'=>6.0,'Gr. zu Fuss'=>3.0,'Fuss leicht'=>4.0],
    'Gebirgspass'   => ['Kutsche'=>2.0,'Karawane'=>1.5,'Gr. beritten'=>2.5,'Reiter'=>3.0,'Gr. zu Fuss'=>1.5,'Fuss leicht'=>2.0],
    'Wuestenpfad'   => ['Kutsche'=>3.0,'Karawane'=>2.0,'Gr. beritten'=>3.0,'Reiter'=>4.0,'Gr. zu Fuss'=>2.5,'Fuss leicht'=>3.5],
    'Querfeldein'   => ['Kutsche'=>1.7,'Karawane'=>1.25,'Gr. beritten'=>2.1,'Reiter'=>2.5,'Gr. zu Fuss'=>1.25,'Fuss leicht'=>1.7],
];

/** Zeitfaktor des Vorschlags. null = dieses Transportmittel kommt hier nicht durch. */
function vorschlag(string $mode, float $g): ?float
{
    $m = MODES[$mode];
    if ($g >= 0.0) {
        return $g > $m['up'] ? null : min(FCAP, 1.0 + $g / $m['c']);
    }
    $a = -$g;

    return $a > $m['dn'] ? null : min(FCAP, 1.0 + max(0.0, $a - $m['g0']) / $m['cab']);
}

/** Zeitfaktor des IST-Zustands -- fuer alle Transportmittel derselbe. */
function heute(float $g): float
{
    if ($g >= 0.0) {
        return min(FCAP, 1.0 + 10.0 * $g);
    }
    $a = -$g;
    // Der VOLLBETRAG, nicht der Ueberschuss. Das ist die Kante.
    return $a > 0.20 ? min(FCAP, 1.0 + $a / 0.15) : 1.0;
}

/** Minetti 2002, Gehkosten J/kg/m. Gueltig |i| <= 0,45. */
function minetti(float $i): float
{
    return 280.5 * $i ** 5 - 58.7 * $i ** 4 - 76.8 * $i ** 3 + 51.9 * $i ** 2 + 19.6 * $i + 2.5;
}

/** Schroter 2002, Transportkosten Pferd. Gueltig |g| <= 0,3. */
function pferd(float $g): float
{
    return $g >= 0.0 ? 0.123 + 1.561 * $g : 0.123 + 1.591 * $g + 9.762 * $g ** 2 + 14.0 * $g ** 3;
}

/** Langmuir 1984 als Faktor: +10 min je 300 m Abstieg ueber 12 Grad, Grundtempo 5 km/h. */
function langmuir(float $a): float
{
    return $a > 0.2126 ? 1.0 + $a * 1000.0 / 360.0 : 1.0;
}

function nz(?float $v, int $d = 3): string
{
    return $v === null ? 'gesperrt' : number_format($v, $d, ',', '.');
}

echo "=== A: Faktoren des Vorschlags ===\n";
printf('%-16s', '');
foreach (array_keys(MODES) as $k) { printf('%14s', $k); }
echo "\n";
foreach ([['10 % Steigung', 0.10], ['20 % Steigung', 0.20], ['10 % Gefaelle', -0.10], ['30 % Gefaelle', -0.30]] as [$lbl, $g]) {
    printf('%-16s', $lbl);
    foreach (array_keys(MODES) as $k) { printf('%14s', nz(vorschlag($k, $g))); }
    echo "\n";
}

echo "\n=== B: Meilen/h auf \"Weg\" ===\n";
printf('%-16s', '');
foreach (array_keys(MODES) as $k) { printf('%14s', $k); }
echo "\n";
foreach ([['Ebene', 0.0], ['10 % Steigung', 0.10], ['20 % Steigung', 0.20], ['10 % Gefaelle', -0.10], ['30 % Gefaelle', -0.30]] as [$lbl, $g]) {
    printf('%-16s', $lbl);
    foreach (array_keys(MODES) as $k) {
        $f = vorschlag($k, $g);
        printf('%14s', $f === null ? '--' : nz(SPEEDS['Weg'][$k] / $f, 2));
    }
    echo "\n";
}

echo "\n=== C: Ist-Zustand, alle Transportmittel gleich ===\n";
foreach ([0.10, 0.20, -0.2000, -0.2001, -0.30] as $g) {
    printf("%12s %%  ->  %s\n", number_format($g * 100, 4, ',', '.'), nz(heute($g)));
}

echo "\n=== D: Aufstieg gegen die Messungen ===\n";
printf("%9s %11s %10s %9s %10s\n", 'Steigung', 'Vorschlag', 'Minetti', 'Abw. %', 'Pferd');
foreach ([0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40] as $g) {
    $v = vorschlag('Fuss leicht', $g);
    $m = minetti($g) / minetti(0.0);
    printf("%7.0f %% %11s %10s %9.1f %10s\n", $g * 100, nz($v, 2), nz($m, 2),
        ($v - $m) / $m * 100, $g <= 0.30 ? nz(pferd($g) / pferd(0.0), 2) : '--');
}

echo "\n=== E: Abstieg gegen Langmuir und Minetti ===\n";
printf("%9s %10s %11s %10s %10s\n", 'Gefaelle', 'heute', 'Vorschlag', 'Langmuir', 'Minetti');
foreach ([0.20, 0.21, 0.25, 0.30, 0.40] as $a) {
    printf("%7.0f %% %10s %11s %10s %10s\n", $a * 100, nz(heute(-$a), 2),
        nz(vorschlag('Fuss leicht', -$a), 2), nz(langmuir($a), 2), nz(minetti(-$a) / minetti(0.0), 2));
}

echo "\n=== F: der bekannte Defekt -- c_ab je Wegtyp ===\n";
printf("%-16s %14s %14s\n", 'Wegtyp', 'Gr. beritten', 'Reiter');
$span = [];
foreach (SPEEDS as $typ => $v) {
    $fussG = $v['Gr. zu Fuss'] / (1.0 + (MODES['Gr. beritten']['dn'] - 0.20) / 0.15);
    $fussR = $v['Fuss leicht'] / (1.0 + (MODES['Reiter']['dn'] - 0.20) / 0.15);
    $cG = (MODES['Gr. beritten']['dn'] - MODES['Gr. beritten']['g0']) / ($v['Gr. beritten'] / $fussG - 1.0);
    $cR = (MODES['Reiter']['dn'] - MODES['Reiter']['g0']) / ($v['Reiter'] / $fussR - 1.0);
    $span[] = $cG;
    $span[] = $cR;
    printf("%-16s %14s %14s\n", $typ, nz($cG, 4), nz($cR, 4));
}
printf("Spanne %s .. %s  =  Faktor %s\n", nz(min($span), 4), nz(max($span), 4), nz(max($span) / min($span), 2));

echo "\n=== G: Verstoss gegen \"bergab niemand schneller als zu Fuss\" bei festem c_ab = 0,062 ===\n";
$worst = 0.0;
foreach (SPEEDS as $typ => $v) {
    foreach ([['Gr. beritten', 'Gr. zu Fuss'], ['Reiter', 'Fuss leicht']] as [$rid, $foot]) {
        $dn = MODES[$rid]['dn'];
        $vr = $v[$rid] / (1.0 + ($dn - MODES[$rid]['g0']) / 0.062);
        $vf = $v[$foot] / (1.0 + ($dn - 0.20) / 0.15);
        $worst = max($worst, $vr / $vf);
    }
}
printf("groesster Verstoss: %s %%  (>0 heisst beritten schneller als zu Fuss)\n", nz(($worst - 1.0) * 100, 1));

echo "\n=== H: wo faellt die Kutsche hinter die Reisegruppe zu Fuss zurueck ===\n";
foreach (SPEEDS as $typ => $v) {
    $found = null;
    for ($g = 0.0; $g <= MODES['Kutsche']['up']; $g += 0.0001) {
        $fk = vorschlag('Kutsche', $g);
        $ff = vorschlag('Gr. zu Fuss', $g);
        if ($fk !== null && $ff !== null && $v['Kutsche'] / $fk <= $v['Gr. zu Fuss'] / $ff) { $found = $g; break; }
    }
    printf("%-16s %s\n", $typ, $found === null ? 'nie' : nz($found * 100, 2) . ' %');
}

echo "\n=== I: Stetigkeit -- groesster Sprung je Transportmittel (0,1-%-Schritte) ===\n";
foreach (array_keys(MODES) as $k) {
    $prev = null; $jump = 0.0; $at = 0.0;
    for ($p = -45.0; $p <= 45.0; $p += 0.1) {
        $f = vorschlag($k, $p / 100.0);
        if ($f !== null && $prev !== null && abs($f - $prev) > $jump) { $jump = abs($f - $prev); $at = $p; }
        $prev = $f;
    }
    printf("%-16s %s bei %s %%\n", $k, nz($jump, 4), nz($at, 1));
}
$prev = null; $jump = 0.0; $at = 0.0;
for ($p = -45.0; $p <= 45.0; $p += 0.1) {
    $f = heute($p / 100.0);
    if ($prev !== null && abs($f - $prev) > $jump) { $jump = abs($f - $prev); $at = $p; }
    $prev = $f;
}
printf("%-16s %s bei %s %%   <-- die Kante, die der Vorschlag beseitigt\n", 'IST-ZUSTAND', nz($jump, 4), nz($at, 1));
