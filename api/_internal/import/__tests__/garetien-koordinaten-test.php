<?php

declare(strict_types=1);

// Wagenhalt-Koordinaten -> Avesmaps-Karteneinheiten.
//
// 🔴 AFFIN, NICHT GEWARPT. Thin-Plate-Spline wurde am 26.08.2026 in 5-facher
// Kreuzvalidierung gemessen und ist SCHLECHTER: 2,30 gegen 1,24 Meilen Median. Der Grund
// steht in den Residuen -- sie korrelieren null mit der Position (0,014 / 0,003 / -0,003 /
// -0,001), es gibt also keine systematische Verzerrung, die man geradebiegen koennte. Der
// Rest ist echte Zeichendifferenz zwischen zwei von Hand gemalten Fankarten, und daran passt
// sich ein Spline an, statt sie zu heilen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-koordinaten-test.php

require_once __DIR__ . '/../garetien-koordinaten.php';

$pruefungen = 0;

/** Abstand in MEILEN -- 1 Karteneinheit = 3 Meilen. */
function avesmapsGaretienTestMeilen(array $a, array $b): float
{
    return sqrt((($a[0] - $b[0]) ** 2) + (($a[1] - $b[1]) ** 2)) * 3.0;
}

// --- Wagenhalt ist ihr Nullpunkt und liegt bei uns auf der Karte. Der Fit hat ihn aus
// 148 Punkten unabhaengig wiedergefunden -- das ist der Beleg, dass hier nichts hingebogen ist.
$w = avesmapsGaretienNachAvesmaps(0.0, 0.0);
assert(avesmapsGaretienTestMeilen($w, [547.53864, 541.90588]) < 1.0, 'Nullpunkt muss Wagenhalt treffen');
$pruefungen++;

// --- Fuenf echte Passpunkte (gemessen 26.08.2026, Median ueber alle 148 = 1,24 Meilen).
$passpunkte = [
    ['Ferdok',      -161700.0,   51450.0, 492.96887, 524.68549],
    ['Rommilys',     147700.0,   16800.0, 597.08508, 536.79196],
    ['Zwerch',       124600.0,    -700.0, 589.18518, 542.43750],
    ['Beilunk',      387322.0,   26884.0, 678.01385, 534.87564],
    ['Greifenfurt', -116761.0, -129775.0, 507.52209, 584.85355],
];
foreach ($passpunkte as [$name, $gx, $gy, $ax, $ay]) {
    $ist = avesmapsGaretienNachAvesmaps($gx, $gy);
    $fehler = avesmapsGaretienTestMeilen($ist, [$ax, $ay]);
    assert($fehler < 8.0, "{$name} weicht {$fehler} Meilen ab (erlaubt: 8)");
    $pruefungen++;
}

// --- 💣 Y WIRD GESPIEGELT. Bei ihnen waechst y nach Sueden, bei uns nach Norden.
// Ohne diese Zusicherung faellt eine vorzeichenverkehrte Matrix nicht auf: die Karte
// saehe an der Waagerechten gespiegelt aus, und bei Ost-West-Objekten merkt man es nicht.
$nord = avesmapsGaretienNachAvesmaps(0.0, -100000.0);   // 100 Meilen NOERDLICH von Wagenhalt
$sued = avesmapsGaretienNachAvesmaps(0.0,  100000.0);   // 100 Meilen SUEDLICH
assert($nord[1] > $sued[1], 'noerdlich muss bei uns ein GROESSERES y ergeben');
$pruefungen++;

// --- Der Massstab: 3000 Wagenhalt-Einheiten sind eine Karteneinheit sind 3 Meilen.
$a = avesmapsGaretienNachAvesmaps(0.0, 0.0);
$b = avesmapsGaretienNachAvesmaps(300000.0, 0.0);       // 300 Meilen oestlich
assert(abs(avesmapsGaretienTestMeilen($a, $b) - 300.0) < 6.0, 'Massstab muss auf 2 % stimmen');
$pruefungen++;

// --- Linien werden Punkt fuer Punkt gewandelt, die Reihenfolge bleibt.
$linie = avesmapsGaretienLinieNachAvesmaps([[0.0, 0.0], [300000.0, 0.0]]);
assert(count($linie) === 2);
assert($linie[0] === $a && $linie[1] === $b);
$pruefungen += 2;

// --- 💣 DIE SECHS PARAMETER SIND TRAGEND, und die Einzelschranke oben beweist das NICHT.
// Mutationsprobe 26.08.2026: Kreuzterm YX weggelassen, Kreuzterm XY weggelassen und
// "X-Skala = Y-Skala" ueberlebten den ganzen Test -- also genau die drei Vereinfachungen,
// die aus der affinen Abbildung eine blosse Aehnlichkeitsabbildung machen, gegen die
// Entwurf §2.1 ausdruecklich entschieden hat. Der Grund ist die lockere 8-Meilen-Schranke:
// die schlimmste Entartung liegt bei 7,82 Meilen auf EINEM Punkt und rutscht darunter durch.
// Die SUMME ueber alle fuenf trennt dagegen sauber -- echt 6,77, ohne YX 10,41,
// X-Skala=Y-Skala 18,29. Deshalb steht sie hier daneben und nicht statt der Einzelschranke:
// die eine haelt "kein Punkt ist grob falsch", die andere "die Abbildung ist wirklich affin".
$summe = 0.0;
foreach ($passpunkte as [$name, $gx, $gy, $ax, $ay]) {
    $summe += avesmapsGaretienTestMeilen(avesmapsGaretienNachAvesmaps($gx, $gy), [$ax, $ay]);
}
assert($summe < 8.0, "Summe der fuenf Abweichungen {$summe} Meilen -- eine Vereinfachung der Matrix?");
$pruefungen++;

// --- 💣 X und Y haben VERSCHIEDENE Massstaebe, um 1,7 %. Das ist der ganze Grund fuer
// sechs Parameter statt vier. Gemessen: 300 Meilen ostwaerts ergeben 303,01, suedwaerts
// 298,00 -- wer die beiden gleichsetzt, baut die Karte um 1,7 % verzerrt auf und merkt es
// an keinem einzelnen Ort.
$null   = avesmapsGaretienNachAvesmaps(0.0, 0.0);
$ost    = avesmapsGaretienTestMeilen($null, avesmapsGaretienNachAvesmaps(300000.0, 0.0));
$suedw  = avesmapsGaretienTestMeilen($null, avesmapsGaretienNachAvesmaps(0.0, 300000.0));
assert(abs($ost - $suedw) > 3.0, "X- und Y-Massstab duerfen nicht gleich sein ({$ost} / {$suedw})");
$pruefungen++;

// --- ⚠️ Der Kreuzterm XY laesst sich an KEINEM Passpunkt nachweisen und wird deshalb hier
// als Konstante festgehalten, nicht als Wirkung. Er verschiebt den aeussersten Punkt der
// fuenf (Greifenfurt) um 0,26 Meilen -- das liegt unter dem eigenen Rauschen der Daten
// (Median 1,24 Meilen). Ihn zu streichen aendert die Summe von 6,77 auf 7,00. Ein Test, der
// so etwas ueber Residuen zu fangen vorgibt, waere eine erfundene Schranke; er gehoert zur
// gefitteten Matrix, und das ist alles, was sich ehrlich sagen laesst.
assert(AVESMAPS_GARETIEN_MATRIX_XY !== 0.0, 'die Matrix hat sechs Parameter, nicht fuenf');
assert(AVESMAPS_GARETIEN_MATRIX_YX !== 0.0);
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
