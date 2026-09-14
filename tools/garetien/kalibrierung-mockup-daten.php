<?php

declare(strict_types=1);

// Erzeugt die Datensaetze fuer docs/garetien-kalibrierung-mockup.html.
// 🔴 Das Mockup rechnet NICHT -- alle Zahlen kommen von hier, aus der echten Bibliothek.
//
// Lauf: php tools/garetien/kalibrierung-mockup-daten.php

require_once __DIR__ . '/../../api/_internal/import/garetien-passpunkte.php';

const MX = 580.0;
const MY = 550.0;

// Die neun Himmelsrichtungen, die der Owner verlangt hat, plus zwei genannte Orte.
const KALIB = [
    ['Mitte', 580.0, 550.0], ['Links', 480.0, 550.0], ['Links unten', 480.0, 505.0],
    ['Unten', 580.0, 505.0], ['Rechts unten', 680.0, 505.0], ['Rechts', 680.0, 550.0],
    ['Rechts oben', 680.0, 595.0], ['Oben', 580.0, 595.0], ['Links oben', 480.0, 595.0],
    ['Rhondur', 495.0, 512.0], ['Perricum', 640.0, 545.0],
];

function kmRueck(float $ax, float $ay): array
{
    $det = AVESMAPS_GARETIEN_MATRIX_XX * AVESMAPS_GARETIEN_MATRIX_YY
         - AVESMAPS_GARETIEN_MATRIX_XY * AVESMAPS_GARETIEN_MATRIX_YX;
    $ux = $ax - AVESMAPS_GARETIEN_MATRIX_X0;
    $uy = $ay - AVESMAPS_GARETIEN_MATRIX_Y0;

    return [(AVESMAPS_GARETIEN_MATRIX_YY * $ux - AVESMAPS_GARETIEN_MATRIX_XY * $uy) / $det,
            (AVESMAPS_GARETIEN_MATRIX_XX * $uy - AVESMAPS_GARETIEN_MATRIX_YX * $ux) / $det];
}

function kmBaue(float $theta, float $skala, float $vx, float $vy, float $sig,
                AvesmapsGaretienWuerfel $w): array
{
    $g = static function () use ($w): float {
        $u1 = max(1e-9, $w->bis(1000000) / 1000000.0);
        $u2 = $w->bis(1000000) / 1000000.0;
        return sqrt(-2.0 * log($u1)) * cos(2 * M_PI * $u2);
    };
    $lege = static function (string $name, float $ax, float $ay) use ($theta, $skala, $vx, $vy, $sig, $g): array {
        $dx = ($ax - MX) * 3.0;
        $dy = ($ay - MY) * 3.0;
        $ux = -$theta * $dy + $skala * $dx + $vx;
        $uy =  $theta * $dx + $skala * $dy + $vy;
        [$gx, $gy] = kmRueck($ax + ($ux + $g() * $sig) / 3.0, $ay + ($uy + $g() * $sig) / 3.0);
        return ['name' => $name, 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
    };

    $alle = [];
    foreach (KALIB as [$n, $x, $y]) {
        $alle[] = $lege($n, $x, $y);
    }
    for ($i = 0; $i < 137; $i++) {
        $alle[] = $lege('Ort ' . ($i + 1),
            470.0 + ($w->bis(1000) / 1000.0) * 220.0,
            500.0 + ($w->bis(1000) / 1000.0) * 100.0);
    }

    return $alle;
}

$namen  = array_column(KALIB, 0);
$faelle = [
    ['drehung',  'Drehung 0,22° + 1 Meile Süd',
     'Die Lage, die die Editoren beschreiben: im Westen nach Süden, im Osten nach oben.',
     0.0039, 0.0, 0.0, -1.0],
    ['sued',     'Nur 1,2 Meilen Süd',
     'Was die fünf echten Passpunkte des Repos andeuten: alle in dieselbe Richtung verschoben.',
     0.0, 0.0, 0.0, -1.2],
    ['skala',    'Skalenfehler 0,5 %',
     'Die Karte ist um ein halbes Prozent zu groß oder zu klein abgemalt.',
     0.0, 0.005, 0.0, 0.0],
    ['rauschen', 'Kein systematischer Fehler',
     'Nur Zeichendifferenz. Hier darf eine Kalibrierung NICHTS verbessern — sie kann nur schaden.',
     0.0, 0.0, 0.0, 0.0],
];

$raus = [];
foreach ($faelle as [$key, $titel, $erklaerung, $th, $sk, $vx, $vy]) {
    $w    = new AvesmapsGaretienWuerfel(20260914);
    $alle = kmBaue($th, $sk, $vx, $vy, 1.05, $w);
    $lauf = ['schluessel' => $key, 'titel' => $titel, 'erklaerung' => $erklaerung, 'felder' => []];
    foreach ([1, 4] as $felder) {
        $e = avesmapsGaretienPasspunktKalibrierProbe($alle, $namen, $felder);
        $lauf['felder'][] = [
            'felder'          => $felder,
            'korrekturarten'  => $e['korrekturarten'],
            'kalibriert'      => $e['kalibriert'],
            'kalibriernamen'  => $e['kalibriernamen'],
            'vorher'          => $e['vorher'],
            'nachher'         => $e['nachher'],
            'summe_prozent'   => $e['summe_prozent'],
            'varianz_prozent' => $e['varianz_prozent'],
            'mittel_prozent'  => $e['mittel_prozent'],
            'anteil_besser'   => $e['anteil_besser'],
            'punkte'          => array_map(static fn(array $p): array => [
                'name'    => $p['name'],
                'ax'      => round($p['ax'], 3),
                'ay'      => round($p['ay'], 3),
                'vorher'  => round($p['vorher'], 4),
                'nachher' => round($p['nachher'], 4),
            ], $e['punkte']),
        ];
    }
    $lauf['kalibrierpunkte'] = array_map(
        static fn(array $k): array => ['name' => $k[0], 'ax' => $k[1], 'ay' => $k[2]],
        KALIB
    );
    $raus[] = $lauf;
}

echo json_encode($raus, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
