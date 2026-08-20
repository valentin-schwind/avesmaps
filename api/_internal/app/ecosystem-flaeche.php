<?php

declare(strict_types=1);

// Der Flaecheninhalt einer Landschafts-Geometrie -- seit 19.08.2026 die Grundlage der EINMALIGEN
// Startaufstellung des Stapels (avesmapsEcosystemSeedStackOrder) und nichts sonst.
//
// 🔴 WORTGLEICH ZU ecosystemGeometryArea (js/map-features/map-features-ecosystem-geometry.js):
// Gauss'sche Trapezformel, absolut, erster Ring positiv und jeder weitere abgezogen.
//
// 🔴 DAS IST KEINE ZWEITE WAHRHEIT, SONDERN EIN UMZUG. Die STAPELREGEL im Browser
// (ecosystemStackingOrder) faellt im selben Umbau weg; danach entscheidet ueber die Reihenfolge nur
// noch die gespeicherte Zahl, und gerechnet wird sie nur noch hier. Die JS-Funktion selbst bleibt --
// sie traegt die Plausibilitaetspruefung der booleschen Operationen (map-features-ecosystem-boolean.js)
// und die Hoehenkombination, beides ohne jeden Bezug zur Stapelung.
//
// ⚠️ Einheiten sind Kartenpunkte (0..1024), nicht Meilen. Der Wert wird nur VERGLICHEN, nie angezeigt.

// Ein Ring -> seine Flaeche, absolut. Der Ring darf offen oder geschlossen ankommen und in beide
// Richtungen gewickelt sein: eine Flaeche ist eine Groesse, keine Richtung.
//
// 💣 Eine Ecke ohne zwei Zahlen macht den GANZEN Ring unbrauchbar (Rueckgabe 0), nicht bloss sich
// selbst. Wer sie ueberspringt, bekommt eine willkuerliche Teilflaeche heraus -- und die entschiede
// dann ueber die Stapelreihenfolge, ohne dass irgendwo etwas fehlschlaegt.
function avesmapsEcosystemRingArea(mixed $ring): float
{
    if (!is_array($ring) || count($ring) < 3) {
        return 0.0;
    }

    $ecken = array_values($ring);
    $anzahl = count($ecken);
    $sum = 0.0;
    for ($i = 0, $j = $anzahl - 1; $i < $anzahl; $j = $i++) {
        $a = $ecken[$j];
        $b = $ecken[$i];
        if (!is_array($a) || !is_array($b) || count($a) < 2 || count($b) < 2) {
            return 0.0;
        }
        $sum += ((float) $a[0] * (float) $b[1]) - ((float) $b[0] * (float) $a[1]);
    }

    return abs($sum) / 2.0;
}

// Aussenring minus Loecher, summiert ueber jeden Teil. Alles Unbrauchbare zaehlt 0.
//
// 🪤 0 ist in der Stapelung der UNGEFAEHRLICHE Platz: eine Flaeche ohne brauchbare Geometrie landet
// damit ganz oben, verdeckt nichts und bleibt selbst erreichbar. Dieselbe Lesart hatte die
// abgeschaffte JS-Regel.
function avesmapsEcosystemGeometryArea(?array $geometry): float
{
    $type = (string) ($geometry['type'] ?? '');
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) {
        return 0.0;
    }

    if ($type === 'Polygon') {
        $parts = [$coordinates];
    } elseif ($type === 'MultiPolygon') {
        $parts = $coordinates;
    } else {
        return 0.0;
    }

    $total = 0.0;
    foreach ($parts as $part) {
        if (!is_array($part)) {
            continue;
        }
        foreach (array_values($part) as $index => $ring) {
            $flaeche = avesmapsEcosystemRingArea($ring);
            $total += $index === 0 ? $flaeche : -$flaeche;
        }
    }

    return $total;
}
