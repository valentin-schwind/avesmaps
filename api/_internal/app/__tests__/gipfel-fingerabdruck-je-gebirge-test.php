<?php
// api/_internal/app/__tests__/gipfel-fingerabdruck-je-gebirge-test.php
declare(strict_types=1);

/**
 * Der Gipfel-Fingerabdruck gehoert dem GEBIRGE, nicht der Welt (06.10.2026).
 *
 * Owner: "mach den fingerprint pro gebirge". Vorgeschichte: der Totalausfall vom 05.10.2026 --
 * `avesmapsTerrainPeaksFingerprint` war GLOBAL, also machte ein einziger bewegter Gipfel alle 69
 * Gebirgsraster "veraltet"; der Editor sah "69 veraltet", startete den Lauf, bewegte den naechsten
 * Gipfel, sah wieder "69 veraltet". Gemessen: 202 Uploads mit je >250 KB in 76 Minuten gegen 757
 * Gipfelbewegungen.
 *
 * 🔴 DIE REGEL, UND WARUM SIE VOLLSTAENDIG IST. Das Raster einer Flaeche haengt ab von
 *   (a) den Gipfeln IN ihrem Kasten -- Lage und Hoehe gehen direkt ins Feld, und
 *   (b) dem Radius jedes dieser Gipfel, der ueber `separationAt` am Abstand zu seinem naechsten
 *       Nachbarn klemmt (`min(..., max(0,72 x separation, minRadius), 150)`,
 *       map-features-ecosystem-height-field.js) -- und dieser Nachbar darf UEBERALL liegen.
 * Beides steht im Fingerabdruck, also ist er vollstaendig: ein fremder Gipfel wirkt NUR ueber (b),
 * und ein neuer Gipfel im eigenen Kasten ueber (a). Ein Rand um den Kasten ist deshalb nicht noetig.
 *
 * 💣 EIN FINGERABDRUCK, DER ZU WENIG ERFASST, IST SCHLIMMER ALS DER GLOBALE. Der globale meldete zu
 * oft "veraltet" (laut, teuer, aber sicher); einer mit einer Luecke meldet "aktuell" fuer ein Raster,
 * das es nicht ist -- und die Karte rechnet dann auf einem Gelaende, das der Editor nie gesehen hat.
 * Darum pruefen die Faelle unten jede der beiden Haelften EINZELN.
 *
 * Lauf aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/gipfel-fingerabdruck-je-gebirge-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';

$n = 0;
$sicher = static function (bool $b, string $text) use (&$n): void {
    $n++;
    assert($b, $text);
};

// Ein Kasten um (100..140, 200..230) -- so wie ihn die Heightmap-Zeile aus origin + Pixeln ergibt.
$kasten = ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0];

$gipfel = static fn(string $id, float $x, float $y, ?float $h = 1000.0): array
    => ['public_id' => $id, 'x' => $x, 'y' => $y, 'height_schritt' => $h];

// Zwei Gipfel im Kasten, einer weit weg (der weite ist fuer NIEMANDEN naechster Nachbar).
$drin1 = $gipfel('a', 110.0, 210.0);
$drin2 = $gipfel('b', 130.0, 220.0);
$fern  = $gipfel('z', 900.0, 900.0);

$alle = [$drin1, $drin2, $fern];
$basis = avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $alle);
$sicher(strlen($basis) === 40, 'A1: ein Fingerabdruck ist ein sha1');

// ===== A) Was den Kasten NICHT betrifft, aendert ihn nicht ======================================
// 🔴 Das ist der ganze Zweck: ein Gipfel am anderen Ende der Karte darf dieses Gebirge nicht
// "veralten". Genau daran sind am 05.10.2026 69 Raster gleichzeitig ungueltig geworden.
$fernVerschoben = [$drin1, $drin2, $gipfel('z', 905.0, 907.0)];
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $fernVerschoben) === $basis,
    'A2: ein ferner Gipfel, der fuer niemanden naechster Nachbar ist, aendert den Kasten nicht'
);

// Und ein ferner Gipfel, der ganz VERSCHWINDET, ebenso.
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2]) === $basis,
    'A3: ein ferner Gipfel, der verschwindet, aendert den Kasten nicht'
);

// ===== B) Haelfte (a): die eigenen Gipfel ======================================================
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 111.0, 210.0), $drin2, $fern]) !== $basis,
    'B1: ein eigener Gipfel, der sich BEWEGT, aendert den Fingerabdruck'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 110.0, 210.0, 2000.0), $drin2, $fern]) !== $basis,
    'B2: eine geaenderte HOEHE aendert den Fingerabdruck'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 110.0, 210.0, null), $drin2, $fern]) !== $basis,
    'B3: Hoehe null ist nicht Hoehe 0 -- 16 von 67 Gipfeln tragen ueberhaupt eine'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin2, $fern]) !== $basis,
    'B4: ein eigener Gipfel, der VERSCHWINDET, aendert den Fingerabdruck'
);
// 💣 Ein NEUER Gipfel im Kasten muss zaehlen. Das ist der Fall, den eine vom Client gelieferte
// Gipfelliste NICHT erfasst haette: sie kennt nur die, aus denen das alte Raster entstand.
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2, $gipfel('neu', 120.0, 215.0), $fern]) !== $basis,
    'B5: ein NEUER Gipfel im Kasten aendert den Fingerabdruck'
);

// ===== C) Haelfte (b): der Nachbarabstand, und er reicht ueber den Kasten hinaus ================
// 💣 DIE ENTSCHEIDENDE ZUSICHERUNG. Ein Gipfel AUSSERHALB des Kastens, der naechster Nachbar eines
// Gipfels INNERHALB wird, klemmt dessen Radius -- das Raster aendert sich also, obwohl kein eigener
// Gipfel bewegt wurde. Ohne den Nachbarabstand im Fingerabdruck waere das die Luecke, die ein
// veraltetes Raster als aktuell ausweist.
$nachbarDicht = [$drin1, $drin2, $gipfel('nah', 141.0, 210.0), $fern];
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $nachbarDicht) !== $basis,
    'C1: ein FREMDER Gipfel, der naechster Nachbar eines eigenen wird, aendert den Fingerabdruck'
);

// ⚠️ Die Gegenprobe dazu, damit C1 nicht bloss "irgendein Gipfel mehr" misst: derselbe fremde
// Gipfel, aber so weit weg, dass er fuer keinen eigenen der naechste Nachbar ist -- dann aendert
// sich nichts. (a=110/210 und b=130/220 liegen 22,36 auseinander; 'weit' ist von beiden weiter weg.)
$nachbarWeit = [$drin1, $drin2, $gipfel('weit', 400.0, 400.0), $fern];
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $nachbarWeit) === $basis,
    'C2: Gegenprobe -- ein fremder Gipfel ohne Nachbarschaft aendert nichts (sonst misst C1 nur die Anzahl)'
);

// 🪤 EINE MUTATION UEBERLEBT HIER BEWUSST (06.10.2026): `inf` durch 0.0 zu ersetzen aendert kein
// beobachtbares Verhalten. Ein Abstand von exakt 0 entsteht nur zwischen zwei Gipfeln auf DERSELBEN
// Position -- und die liegen dann beide im Kasten, sind also schon ueber ihre eigenen Zeilen
// unterscheidbar. `inf` steht trotzdem da, weil es die Sache richtig benennt: "kein Nachbar" ist
// nicht "Nachbar in Abstand null", und der naechste Leser soll das nicht verwechseln.

// ===== D) Form und Stabilitaet ==================================================================
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin2, $fern, $drin1]) === $basis,
    'D1: die Reihenfolge der Zeilen darf die Antwort nicht aendern (wie beim globalen Stempel)'
);
// Ein Kasten ohne Gipfel ist gueltig und stabil -- 334 Flaechen tragen gar keinen.
$leer = avesmapsTerrainPeaksFingerprintFuerKasten(['min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 1.0, 'max_y' => 1.0], $alle);
$sicher(strlen($leer) === 40 && $leer !== $basis, 'D2: ein Kasten ohne Gipfel hat einen eigenen, stabilen Wert');
// 🪤 Die Kastengrenze ist EINSCHLIESSLICH. Ein Gipfel genau auf der Kante gehoert zum Raster (das
// Gitter deckt origin..origin+n*cell ab), und ein exklusiver Vergleich verlore ihn lautlos.
$aufKante = avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('k', 100.0, 200.0), $fern]);
$sicher(
    $aufKante !== avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$fern]),
    'D3: ein Gipfel genau auf der Kastenkante zaehlt mit'
);

// ===== E) Der Kasten aus der gespeicherten Zeile =================================================
// Die Heightmap-Zeile traegt origin + Pixelzahl + Zellweite; daraus entsteht der Kasten.
$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => 100.0, 'origin_y' => 200.0,
        'width_px' => 160, 'height_px' => 120, 'cell_size_mapunits' => 0.25])
    === ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0],
    'E1: der Kasten kommt aus origin + Pixel x Zellweite'
);
// ⚠️ PDO liefert diese Spalten als STRING -- dieselbe Falle wie beim Blob-Vergleich.
$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => '100', 'origin_y' => '200.0',
        'width_px' => '160', 'height_px' => '120', 'cell_size_mapunits' => '0.250'])
    === ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0],
    'E2: Zahlen als PDO-Strings ergeben denselben Kasten'
);
$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => 100.0, 'origin_y' => 200.0, 'width_px' => 0, 'height_px' => 0,
        'cell_size_mapunits' => 0.25]) === null,
    'E3: ohne Ausdehnung gibt es keinen Kasten (null, nicht ein Punkt)'
);


// ===== F) DIE NAHT: beide Leser rechnen DENSELBEN Wert ==========================================
// 🔴 Die teuerste Stelle des ganzen Umbaus. Der Schreibweg stempelt, der Status vergleicht -- rechnen
// die beiden verschieden, gilt JEDES Raster fuer immer als veraltet, und der Rasterlauf laeuft
// endlos. Genau diese Falle steht eine Zeile tiefer schon einmal ausgeschrieben (die fuenf
// V12-Regler, die im Status-SELECT fehlten).
//
// 💣 Mit dem TOKENIZER, nicht mit `preg_replace`: ein Blockkommentar-Entferner frisst an einem
// `/*` in einem Zeilenkommentar hunderte Zeilen -- im besten Fall wird der Test rot, im schlechteren
// laeuft die Zusicherung LEER (AGENTS.md §11).
$quelle = file_get_contents(__DIR__ . '/../terrain-store.php');
$sicher(is_string($quelle) && $quelle !== '', 'F0: Quelltext lesbar');

$code = '';
foreach (token_get_all($quelle) as $t) {
    if (is_array($t)) {
        if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) { continue; }
        $code .= $t[1];
        continue;
    }
    $code .= $t;
}

$sicher(
    substr_count($code, 'avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $inputs[\'peaks\'])') === 2,
    'F1: BEIDE Leser rufen denselben Erzeuger, mit denselben Argumenten'
);
$sicher(
    !str_contains($code, 'avesmapsTerrainPeaksFingerprint($inputs'),
    'F2: der GLOBALE Stempel steht in keinem Pfad mehr -- sonst waere die Lawine zurueck'
);

// 💣 DIE DREI SPALTEN IM STATUS-SELECT. Ohne sie ist der Kasten dort null, der Vergleichswert leer,
// und jedes Raster gilt fuer immer als veraltet -- waehrend der Schreibweg mit dem echten Kasten
// stempelt. Dieselbe Falle wie bei den V12-Reglern, nur eine Spaltengruppe weiter.
foreach (['h.cell_size_mapunits', 'h.origin_x', 'h.origin_y'] as $spalte) {
    $sicher(
        str_contains($code, $spalte),
        "F3: '$spalte' fehlt im Status-SELECT -- der Kasten waere null und alles fuer immer veraltet"
    );
}

// ⚠️ Und der N+1: `avesmapsTerrainReadStampInputs` darf nur noch EINEN Query fahren.
$rumpfStart = strpos($code, 'function avesmapsTerrainReadStampInputs');
$rumpfEnde = strpos($code, 'function ', $rumpfStart + 10);
$rumpf = substr($code, $rumpfStart, $rumpfEnde - $rumpfStart);
$sicher(
    substr_count($rumpf, '$pdo->query(') + substr_count($rumpf, '$pdo->prepare(') === 1,
    'F4: nur noch EIN Query je Upload -- der zweite lief 69 mal pro Rasterlauf'
);
$sicher(
    !str_contains($rumpf, 'height_areas'),
    'F5: `height_areas` ist samt seinem JOIN gefallen'
);

echo "OK: Naht festgenagelt -- insgesamt $n Zusicherungen\n";
