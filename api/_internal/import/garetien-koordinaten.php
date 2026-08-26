<?php

declare(strict_types=1);

// Wagenhalt-Koordinaten (garetien.de / koschwiki.de) -> Avesmaps-Karteneinheiten.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §2
//
// Volkers System: positives X = Meilen oestlich, positives Y = Meilen SUEDLICH von
// Wagenhalt, Einheit 1/1000 Meile. Unsere Karteneinheit sind 3 Meilen
// (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT), und unser y waechst nach NORDEN.
//
// Die Zahlen stammen aus einer Kleinste-Quadrate-Anpassung ueber 148 namensgleiche Orte
// (219 gefunden, 71 als Falschpaare verworfen -- es gibt zwei "Hueterkloster", zwei
// "Dreiwegen"). Median 1,24 Meilen, p90 3,5 -- out-of-sample in 5-facher Kreuzvalidierung.
//
// 🔴 NICHT WARPEN, siehe Kopf des Tests.

const AVESMAPS_GARETIEN_MATRIX_XX =  3.366672e-4;
const AVESMAPS_GARETIEN_MATRIX_XY =  6.576893e-7;
const AVESMAPS_GARETIEN_MATRIX_X0 =  547.3559;
const AVESMAPS_GARETIEN_MATRIX_YX =  2.419169e-6;
const AVESMAPS_GARETIEN_MATRIX_YY = -3.311091e-4;   // 💣 negativ: Y wird gespiegelt
const AVESMAPS_GARETIEN_MATRIX_Y0 =  541.8122;

/** Ein Punkt. */
function avesmapsGaretienNachAvesmaps(float $gx, float $gy): array
{
    return [
        AVESMAPS_GARETIEN_MATRIX_XX * $gx + AVESMAPS_GARETIEN_MATRIX_XY * $gy + AVESMAPS_GARETIEN_MATRIX_X0,
        AVESMAPS_GARETIEN_MATRIX_YX * $gx + AVESMAPS_GARETIEN_MATRIX_YY * $gy + AVESMAPS_GARETIEN_MATRIX_Y0,
    ];
}

/** Eine Linie oder ein Ring, Reihenfolge bleibt. */
function avesmapsGaretienLinieNachAvesmaps(array $punkte): array
{
    $raus = [];
    foreach ($punkte as [$gx, $gy]) {
        $raus[] = avesmapsGaretienNachAvesmaps((float) $gx, (float) $gy);
    }

    return $raus;
}
