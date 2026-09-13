<?php

declare(strict_types=1);

// Erzeugt die drei Datensaetze, die docs/garetien-passpunkte-mockup.html eingebaut mitbringt.
//
// 🔴 DAS MOCKUP RECHNET NICHT SELBST. Es zeichnet nur, was hier -- mit der ECHTEN Bibliothek
// aus api/_internal/import/garetien-passpunkte.php -- ausgerechnet wurde. Eine zweite Fassung
// der Rechnung in JavaScript waere genau die zweite Wahrheit, gegen die AGENTS.md §5 steht:
// sie liefe beim ersten Nachbessern auseinander, und niemand saehe es.
//
// Lauf:  php tools/garetien/passpunkte-mockup-daten.php > /tmp/daten.json
// Die Ausgabe wird in das Mockup zwischen die Marken DATEN-ANFANG / DATEN-ENDE gesetzt.

require_once __DIR__ . '/../../api/_internal/import/garetien-passpunkte.php';

/** Welche Wagenhalt-Koordinate landet unter der ausgelieferten Matrix auf (ax|ay)? */
function mockupRueckwaerts(float $ax, float $ay): array
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

/**
 * Baut Passpunkte, deren Versatz eine vorgegebene Funktion der Lage ist.
 * Der Versatz wird RUECKWAERTS in die Wagenhalt-Koordinate gerechnet -- er steckt damit
 * wirklich im Datensatz und nicht in der Auswertung.
 */
function mockupFeld(callable $feld, float $rauschen, AvesmapsGaretienWuerfel $w): array
{
    $raus = [];
    $i = 0;
    // Ueber den Ausschnitt, in dem Garetien und seine Nachbarn liegen.
    for ($sp = 0; $sp < 11; $sp++) {
        for ($ze = 0; $ze < 8; $ze++) {
            $ax = 472.0 + $sp * 18.0 + ($w->bis(1000) / 1000.0 - 0.5) * 9.0;
            $ay = 506.0 + $ze * 12.0 + ($w->bis(1000) / 1000.0 - 0.5) * 7.0;
            [$fx, $fy] = $feld($ax, $ay);
            $rx = ($w->bis(200001) / 100000.0 - 1.0) * $rauschen;
            $ry = ($w->bis(200001) / 100000.0 - 1.0) * $rauschen;
            // Versatz in Meilen -> Karteneinheiten.
            [$gx, $gy] = mockupRueckwaerts($ax + ($fx + $rx) / 3.0, $ay + ($fy + $ry) / 3.0);
            $raus[] = ['name' => 'Ort ' . (++$i), 'gx' => $gx, 'gy' => $gy, 'ax' => $ax, 'ay' => $ay];
        }
    }

    return $raus;
}

/** Dieselbe Form, die der Endpunkt `action=passpunkte` liefert. */
function mockupAuswerten(string $schluessel, string $titel, string $erklaerung, array $paare, bool $echt): array
{
    $residuen = avesmapsGaretienPasspunktResiduen($paare);
    $proben     = [];
    $schaetzung = [];
    foreach ([3, 5, 8] as $k) {
        $p = avesmapsGaretienPasspunktNachbarprobe($residuen, $k);
        // 🔴 Die Einzelschaetzungen reisen NUR fuer das mittlere k mit -- das Mockup zeichnet
        // sie als zweiten Pfeil. Ohne sie verspraeche seine Legende etwas, das im Bild fehlt.
        if ($k === 5) {
            $schaetzung = array_map(static fn(array $q): array => [
                'sx' => round($q['schaetzung_dx'], 4),
                'sy' => round($q['schaetzung_dy'], 4),
            ], $p['punkte']);
        }
        unset($p['punkte']);
        $proben[] = $p;
    }

    return [
        'schluessel'       => $schluessel,
        'titel'            => $titel,
        'erklaerung'       => $erklaerung,
        'echt'             => $echt,
        'residuen'         => array_map(static fn(array $r): array => [
            'name'     => $r['name'],
            'ax'       => round($r['ax'], 4),
            'ay'       => round($r['ay'], 4),
            'dx'       => round($r['dx'], 4),
            'dy'       => round($r['dy'], 4),
            'betrag'   => round($r['betrag'], 4),
            'richtung' => $r['richtung'],
        ], $residuen),
        'nachbarprobe'     => $proben,
        'schaetzung'       => $schaetzung,
        'urteil'           => avesmapsGaretienPasspunktUrteil($proben[1], count($residuen)),
        'globaler_versatz' => avesmapsGaretienPasspunktGlobalerVersatz($residuen),
        'west_sued_trend'  => avesmapsGaretienPasspunktWestSuedTrend($residuen, 4000, 20260913),
    ];
}

// --- (1) Die fuenf echten Passpunkte, die das Repo kennt.
$echt = [
    ['name' => 'Ferdok',      'gx' => -161700.0, 'gy' =>   51450.0, 'ax' => 492.96887, 'ay' => 524.68549],
    ['name' => 'Rommilys',    'gx' =>  147700.0, 'gy' =>   16800.0, 'ax' => 597.08508, 'ay' => 536.79196],
    ['name' => 'Zwerch',      'gx' =>  124600.0, 'gy' =>    -700.0, 'ax' => 589.18518, 'ay' => 542.43750],
    ['name' => 'Beilunk',     'gx' =>  387322.0, 'gy' =>   26884.0, 'ax' => 678.01385, 'ay' => 534.87564],
    ['name' => 'Greifenfurt', 'gx' => -116761.0, 'gy' => -129775.0, 'ax' => 507.52209, 'ay' => 584.85355],
];

$w = new AvesmapsGaretienWuerfel(20260913);

// --- (2) Zeichenrauschen: der Versatz jedes Ortes ist unabhaengig vom Nachbarn.
//         Streuung so gewaehlt, dass der Median bei rund 1,2 Meilen landet -- der Zahl, die
//         Entwurf §2.1 fuer die echte Karte belegt.
$rauschen = mockupFeld(static fn(float $ax, float $ay): array => [0.0, 0.0], 1.9, $w);

// --- (3) Ein zusammenhaengendes Feld: der Versatz wandert glatt ueber die Karte -- und
//         zwar genau so, wie der Editor es vermutet ("je weiter Westen, desto weiter Sueden").
$feld = mockupFeld(
    static fn(float $ax, float $ay): array => [0.0, -(660.0 - $ax) * 3.0 * 0.035],
    0.8,
    $w
);

echo json_encode([
    mockupAuswerten('echt', 'Die fuenf echten Passpunkte',
        'Alles, was dieses Repo an echten Ortspaaren kennt. Fuer eine Aussage ueber die Karte '
        . 'sind fuenf Punkte zu wenig -- sie stehen hier, weil Greifenfurt genau die Richtung '
        . 'zeigt, die ein Editor gemeldet hat.', $echt, true),
    mockupAuswerten('rauschen', 'Vergleichsbild: Zeichenrauschen',
        'Erfundene Daten. Jeder Ort weicht zufaellig ab, unabhaengig von seinem Nachbarn -- so '
        . 'sieht es aus, wenn zwei Karten von Hand gemalt wurden und KEINE Korrektur hilft.',
        $rauschen, false),
    mockupAuswerten('feld', 'Vergleichsbild: ein zusammenhaengendes Feld',
        'Erfundene Daten. Der Versatz wandert glatt ueber die Karte, genau wie der Editor es '
        . 'vermutet -- so sieht es aus, wenn eine Korrektur aus Fixpunkten WIRKLICH traegt.',
        $feld, false),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
