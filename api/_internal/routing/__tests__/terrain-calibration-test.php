<?php

declare(strict_types=1);

// Tests for the way-profile calibration (api/_internal/routing/terrain-calibration.php).
//
// 🔴 Auftrag §7.3 names the reason this file exists: „der Mittelungsfehler aus Falle 3 ist genau die
// Sorte, die stumm bleibt." A wrong mean here does not throw, does not look odd and does not show up
// anywhere -- it just moves the speed of the whole map by a few percent. So the additivity property
// itself is asserted, not merely a handful of expected numbers.
//
// Run: php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-calibration-test.php
// ⚠️ WITHOUT -d zend.assertions=1 assert() CHECKS NOTHING and this file reports a false green.

require_once __DIR__ . '/../terrain-calibration.php';

$checks = 0;
function pruefe(string $label, float $erwartet, float $bekommen, float $epsilon = 1e-9): void
{
    global $checks;
    $checks++;
    assert(
        abs($erwartet - $bekommen) <= $epsilon,
        $label . ': erwartet ' . $erwartet . ', bekommen ' . $bekommen
    );
}

// The assert() above only fires with zend.assertions=1 -- prove it is on before trusting a green run.
$assertionsAktiv = false;
try {
    assert(false, 'Selbsttest');
} catch (Throwable) {
    $assertionsAktiv = true;
}
if (!$assertionsAktiv) {
    fwrite(STDERR, "FEHLER: assert() ist aus. Mit -d zend.assertions=1 -d assert.exception=1 starten.\n");
    exit(2);
}

// ---- 1. Stücklängen ---------------------------------------------------------------------------
$laengen = avesmapsTerrainCalibrationPieceLengths([[0.0, 0.0], [3.0, 4.0], [3.0, 14.0]]);
assert(count($laengen) === 2, 'n Punkte ergeben n-1 Stücke');
pruefe('3-4-5-Dreieck', 5.0, $laengen[0]);
pruefe('senkrechtes Stück', 10.0, $laengen[1]);
assert(avesmapsTerrainCalibrationPieceLengths([[0.0, 0.0]]) === [], 'ein Punkt hat keine Länge');
assert(avesmapsTerrainCalibrationPieceLengths([]) === [], 'keine Geometrie, keine Längen');
$checks += 4;

// ---- 2. Der ungedeckelte Faktor ---------------------------------------------------------------
// 1 Karteneinheit = 3 Meilen. 300 Schritt Anstieg auf 1 Einheit = 3 Leistungsmeilen auf 3 Meilen.
pruefe('300 Schritt auf 1 Einheit -> 2,0', 2.0, avesmapsTerrainCalibrationFactor(300.0, 0.0, 1.0));
pruefe('eben -> exakt 1,0', 1.0, avesmapsTerrainCalibrationFactor(0.0, 0.0, 1.0));
pruefe('steiler Abstieg zahlt /150', 1.0 + (150.0 / 150.0) / 3.0,
    avesmapsTerrainCalibrationFactor(0.0, 150.0, 1.0));
pruefe('entartete Strecke -> 1,0', 1.0, avesmapsTerrainCalibrationFactor(300.0, 0.0, 0.0));

// 💣 FALLE 3: UNGEDECKELT. Der Router deckelt bei 4,0 -- die Eichung darf das nicht.
pruefe('läuft über den Deckel hinaus', 11.0, avesmapsTerrainCalibrationFactor(3000.0, 0.0, 1.0));
assert(avesmapsTerrainLeistungsFactor(3000.0, 0.0, 1.0) === 4.0,
    'der ROUTER deckelt weiterhin bei 4,0 -- sonst prüft der Vergleich nichts');
$checks++;

// ---- 3. Additivität: die Eigenschaft, auf der die ganze Eichung steht --------------------------
// Ohne Deckel ist der längengewichtete Mittelwert über die Stücke EXAKT der Wert des ganzen Weges.
// Genau deshalb darf der Profillauf akkumulieren, obwohl er die Kantengrenzen gar nicht kennt.
{
    $stuecke = [
        ['ascent' => 120.0, 'steep' => 0.0,  'len' => 0.4],
        ['ascent' => 900.0, 'steep' => 60.0, 'len' => 0.6],
        ['ascent' => 0.0,   'steep' => 0.0,  'len' => 1.1],
    ];
    $summeAnstieg = array_sum(array_column($stuecke, 'ascent'));
    $summeSteil = array_sum(array_column($stuecke, 'steep'));
    $summeLaenge = array_sum(array_column($stuecke, 'len'));

    $ganzerWeg = avesmapsTerrainCalibrationFactor($summeAnstieg, $summeSteil, $summeLaenge);
    $gewichtet = 0.0;
    foreach ($stuecke as $s) {
        $gewichtet += $s['len'] * avesmapsTerrainCalibrationFactor($s['ascent'], $s['steep'], $s['len']);
    }
    $gewichtet /= $summeLaenge;
    pruefe('ungedeckelt: gewichtetes Mittel == ganzer Weg', $ganzerWeg, $gewichtet, 1e-12);

    // Mit Deckel MUSS es auseinanderlaufen -- sonst wäre der ganze Aufwand unnötig.
    $ganzGedeckelt = avesmapsTerrainLeistungsFactor($summeAnstieg, $summeSteil, $summeLaenge);
    $gewGedeckelt = 0.0;
    foreach ($stuecke as $s) {
        $gewGedeckelt += $s['len'] * avesmapsTerrainLeistungsFactor($s['ascent'], $s['steep'], $s['len']);
    }
    $gewGedeckelt /= $summeLaenge;
    assert(abs($gewGedeckelt - $ganzGedeckelt) > 0.01,
        'mit Deckel muss die Additivität brechen, sonst prüft der Test nichts');
    $checks++;
}

// ---- 4. Der stumme Mittelungsfehler: Faktoren mitteln, nicht Geschwindigkeiten -----------------
{
    // Zwei Segmente, wie im Auftrag: eines eben, eines steil.
    $a = ['len' => 1.0, 'ascent' => 0.0,    'steep' => 0.0];
    $b = ['len' => 1.0, 'ascent' => 1500.0, 'steep' => 0.0];
    $fa = avesmapsTerrainCalibrationFactor($a['ascent'], $a['steep'], $a['len']);
    $fb = avesmapsTerrainCalibrationFactor($b['ascent'], $b['steep'], $b['len']);

    // RICHTIG: Faktoren längengewichtet mitteln.
    $richtig = ($a['len'] * $fa + $b['len'] * $fb) / ($a['len'] + $b['len']);
    // FALSCH: Geschwindigkeiten mitteln (das harmonische Mittel der Größe, die sich addiert).
    $v0 = 30.0;
    $falschTempo = ($a['len'] * ($v0 / $fa) + $b['len'] * ($v0 / $fb)) / ($a['len'] + $b['len']);
    $falschAlsFaktor = $v0 / $falschTempo;

    $abweichung = abs($falschAlsFaktor - $richtig) / $richtig;
    assert($abweichung > 0.3,
        'der Mittelungsfehler muss deutlich sein (gemessen ' . round($abweichung * 100, 1) . ' %)');
    $checks++;
}

// ---- 5. Beide Richtungen, gleich gewichtet (Falle 4) ------------------------------------------
{
    // Ein Weg, der hinauf führt: Anstieg 900, Abstieg 0, kein steiles Gefälle.
    $profil = [[300.0, 0.0, 0.0, 0.0], [600.0, 0.0, 0.0, 0.0]];
    $acc = avesmapsTerrainCalibrationAdd(avesmapsTerrainCalibrationEmpty(), $profil, [0.5, 0.5], 'Strasse');

    $hin = avesmapsTerrainCalibrationFactor(900.0, 0.0, 1.0);   // Anstieg + steiler Abstieg
    $rueck = avesmapsTerrainCalibrationFactor(0.0, 0.0, 1.0);   // Abstieg + steiler Anstieg = eben
    pruefe('beide Richtungen zusammen', 1.0 * ($hin + $rueck), $acc['by_subtype']['Strasse']['length_factor']);
    pruefe('die Länge zählt zweimal', 2.0, $acc['by_subtype']['Strasse']['length']);
    assert($rueck === 1.0, 'bergab ohne steiles Gefälle ist frei -- sonst ist die Paarung vertauscht');
    $checks++;

    // Und die Gegenprobe: wer die Richtungen vertauscht, bekommt ein anderes Ergebnis. Ohne diese
    // Zeile würde ein symmetrischer Testfall die Verwechslung durchgehen lassen.
    $vertauscht = avesmapsTerrainCalibrationFactor(0.0, 900.0, 1.0);
    assert(abs($vertauscht - $hin) > 0.5, 'Anstieg und steiler Abstieg dürfen sich nicht gleich verhalten');
    $checks++;
}

// ---- 6. Falle 2: Wege ohne Raster zählen als übersprungen, nie als eben ------------------------
{
    $acc = avesmapsTerrainCalibrationEmpty();
    $acc = avesmapsTerrainCalibrationAdd($acc, null, [1.0], 'Strasse');
    $acc = avesmapsTerrainCalibrationAdd($acc, [], [1.0], 'Strasse');
    assert($acc['skipped_ways'] === 2, 'zwei Wege ohne Profil');
    assert($acc['measured_ways'] === 0, 'keiner davon ist gemessen');
    assert($acc['by_subtype'] === [], 'und keiner verfälscht den Mittelwert als „eben"');
    $checks += 3;

    // Vor-Modell-Zeilen (Zweierpaare) ebenfalls -- niemals als Leistungsmeilen lesen.
    $acc2 = avesmapsTerrainCalibrationAdd(avesmapsTerrainCalibrationEmpty(), [[10.0, 20.0]], [1.0], 'Strasse');
    assert($acc2['skipped_ways'] === 1 && $acc2['measured_ways'] === 0, 'Zweierpaare sind keine Datenlage');
    $checks++;

    // Länge 0 ebenfalls: ein entarteter Weg darf den Mittelwert nicht anfassen.
    $acc3 = avesmapsTerrainCalibrationAdd(avesmapsTerrainCalibrationEmpty(), [[1.0, 1.0, 0.0, 0.0]], [], 'Strasse');
    assert($acc3['skipped_ways'] === 1, 'ohne Länge kein Beitrag');
    $checks++;
}

// ---- 7. Das Ergebnis: c, mean_G und die Verhältnisse ------------------------------------------
{
    $acc = avesmapsTerrainCalibrationEmpty();
    // Zwei Straßen: eine eben, eine mit 300 Schritt Anstieg auf 1 Einheit.
    $acc = avesmapsTerrainCalibrationAdd($acc, [[0.0, 0.0, 0.0, 0.0]], [1.0], 'Strasse');
    $acc = avesmapsTerrainCalibrationAdd($acc, [[300.0, 0.0, 0.0, 0.0]], [1.0], 'Strasse');
    // Ein Gebirgspass, deutlich steiler.
    $acc = avesmapsTerrainCalibrationAdd($acc, [[900.0, 0.0, 0.0, 0.0]], [1.0], 'Gebirgspass');

    $ergebnis = avesmapsTerrainCalibrationFinish($acc, 32.9, 4128);
    assert($ergebnis !== null, 'mit Straßen in der Menge gibt es ein Ergebnis');

    // Straße: hin 1,0 und 2,0 bzw. 1,0 und 1,0 -> Σ(lF) = 1·(1+1) + 1·(2+1) = 5 über Σl = 4.
    pruefe('mean_G', 5.0 / 4.0, $ergebnis['mean_reference_factor']);
    pruefe('c = 30 · mean_G', 30.0 * 5.0 / 4.0, $ergebnis['c']);
    pruefe('der alte Wert wird mitgeführt', 32.9, $ergebnis['previous_c']);
    assert($ergebnis['map_revision'] === 4128, 'die Revision reist mit (Falle 5)');
    assert($ergebnis['measured_ways'] === 3, 'drei gemessene Wege');
    assert($ergebnis['reference_subtype'] === 'Strasse', 'die Referenzmenge ist Straße');
    $checks += 3;

    // Gebirgspass: hin 4,0 / zurück 1,0 -> mean 2,5; Verhältnis zur Referenz 2,5 / 1,25 = 2,0.
    pruefe('mean_j Gebirgspass', 2.5, $ergebnis['by_subtype']['Gebirgspass']['mean_factor']);
    pruefe('Verhältnis zur Referenz', 2.0, $ergebnis['by_subtype']['Gebirgspass']['relative_to_reference']);
    pruefe('die Referenz steht bei 1,0 zu sich selbst', 1.0, $ergebnis['by_subtype']['Strasse']['relative_to_reference']);
}

// ---- 8. Ohne Referenzmenge KEIN Ergebnis (und kein c von 0) -----------------------------------
{
    $acc = avesmapsTerrainCalibrationAdd(avesmapsTerrainCalibrationEmpty(), [[100.0, 0.0, 0.0, 0.0]], [1.0], 'Pfad');
    assert(avesmapsTerrainCalibrationFinish($acc, null, 1) === null,
        'ohne eine einzige Straße gibt es kein c -- 0 würde die ganze Karte plattmachen');
    assert(avesmapsTerrainCalibrationFinish(avesmapsTerrainCalibrationEmpty(), null, 1) === null,
        'und über nichts erst recht nicht');
    $checks += 2;
}

// ---- 9. Der erste Lauf hat keinen Vorgänger ---------------------------------------------------
{
    $acc = avesmapsTerrainCalibrationAdd(avesmapsTerrainCalibrationEmpty(), [[0.0, 0.0, 0.0, 0.0]], [1.0], 'Strasse');
    $ergebnis = avesmapsTerrainCalibrationFinish($acc, null, 7);
    assert($ergebnis['previous_c'] === null, 'beim ersten Lauf ist der Vorgänger null, nicht 0');
    pruefe('eben ergibt genau die DSA-Zahl', 30.0, $ergebnis['c']);
    $checks++;
}

echo "terrain-calibration: {$checks} Prüfungen bestanden.\n";
