<?php
// api/_internal/app/__tests__/gebirgsraster-stempel-test.php
declare(strict_types=1);

/**
 * Der Gipfel-Fingerabdruck je Gebirge UND der Riegel gegen den sich selbst nachladenden Rasterlauf
 * (06.10.2026, zweiter Anlauf -- Owner: "mach das in einem commit").
 *
 * Vorgeschichte: Totalausfall 05.10.2026, 15:16-16:06. `avesmapsTerrainPeaksFingerprint` war GLOBAL,
 * ein einziger bewegter Gipfel machte damit alle 69 Gebirgsraster "veraltet"; der Editor sah
 * "69 veraltet", startete den Lauf, bewegte den naechsten Gipfel, sah wieder "69 veraltet". Gemessen:
 * 202 Uploads mit je >250 KB in 76 Minuten gegen 757 Gipfelbewegungen.
 *
 * 🪤 DER ERSTE ANLAUF IST LIVE GESCHEITERT UND WURDE ZURUECKGEROLLT (754c664f0). Er verglich das
 * angebotene Raster per `CASE WHEN samples = :blob` gegen das gespeicherte -- ein ~250 KB grosser
 * Binaerparameter gegen eine BLOB-Spalte. MySQL warf, `api_metric` verbuchte 7x
 * `edit/map/ecosystem|server_error` (KEIN `|leer`, also eine sauber gefangene Ausnahme), der Browser
 * meldete ERR_HTTP2_PROTOCOL_ERROR. 💣 Kein Test hat gewarnt: die Fixturen laufen auf SQLite, und
 * das kennt die Kollations-Einschraenkung nicht -- dieselbe Klasse wie AGENTS.md §9 ("Ein
 * SQLite-Test kann eine MySQL-Regression ERZWINGEN"), nur andersherum.
 *
 * 🔴 DIE LEHRE, DIE DEN BAU HIER BESTIMMT: der Blob-Vergleich war ueberfluessig. Das Raster wird AUS
 * (Gipfel + Regler + Geometrie) gerechnet -- sind deren drei Stempel gleich und ist die Form gleich,
 * IST das Raster gleich. Kein Binaerparameter, keine neue SQL-Konstruktion.
 *
 * Lauf aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/gebirgsraster-stempel-test.php
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

$gipfel = static fn(string $id, float $x, float $y, ?float $h = 1000.0): array
    => ['public_id' => $id, 'x' => $x, 'y' => $y, 'height_schritt' => $h];

/* ===== A) Der Kasten eines Rasters ============================================================ */

$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => 100.0, 'origin_y' => 200.0,
        'width_px' => 160, 'height_px' => 120, 'cell_size_mapunits' => 0.25])
    === ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0],
    'A1: der Kasten kommt aus origin + Pixel x Zellweite'
);
// ⚠️ PDO liefert diese Spalten als STRING. Numerisch lesen -- sonst ist der Kasten leer, der
// Fingerabdruck erfasst keinen Gipfel, und der ganze Umbau waere lautlos wirkungslos.
$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => '100', 'origin_y' => '200.0',
        'width_px' => '160', 'height_px' => '120', 'cell_size_mapunits' => '0.250'])
    === ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0],
    'A2: Zahlen als PDO-Strings ergeben denselben Kasten'
);
$sicher(
    avesmapsTerrainRasterKasten(['origin_x' => 1.0, 'origin_y' => 2.0, 'width_px' => 0,
        'height_px' => 0, 'cell_size_mapunits' => 0.25]) === null,
    'A3: ohne Ausdehnung gibt es keinen Kasten'
);

/* ===== B) Der Fingerabdruck je Gebirge ========================================================= */

$kasten = ['min_x' => 100.0, 'min_y' => 200.0, 'max_x' => 140.0, 'max_y' => 230.0];
$drin1 = $gipfel('a', 110.0, 210.0);
$drin2 = $gipfel('b', 130.0, 220.0);
$fern  = $gipfel('z', 900.0, 900.0);
$alle  = [$drin1, $drin2, $fern];
$basis = avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $alle);
$sicher(strlen($basis) === 40, 'B1: ein Fingerabdruck ist ein sha1');

// 🔴 Der ganze Zweck: ein ferner Gipfel darf dieses Gebirge nicht "veralten".
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2, $gipfel('z', 905.0, 907.0)]) === $basis,
    'B2: ein ferner Gipfel, der fuer niemanden naechster Nachbar ist, aendert nichts'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2]) === $basis,
    'B3: ein ferner Gipfel, der verschwindet, aendert nichts'
);

// Haelfte (a): die eigenen Gipfel.
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 111.0, 210.0), $drin2, $fern]) !== $basis,
    'B4: ein eigener Gipfel, der sich bewegt, aendert den Fingerabdruck'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 110.0, 210.0, 2000.0), $drin2, $fern]) !== $basis,
    'B5: eine geaenderte Hoehe aendert den Fingerabdruck'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('a', 110.0, 210.0, null), $drin2, $fern]) !== $basis,
    'B6: Hoehe null ist nicht Hoehe 0 -- nur 16 von 67 Gipfeln tragen ueberhaupt eine'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin2, $fern]) !== $basis,
    'B7: ein eigener Gipfel, der verschwindet, aendert den Fingerabdruck'
);
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2, $gipfel('neu', 120.0, 215.0), $fern]) !== $basis,
    'B8: ein NEUER Gipfel im Kasten aendert den Fingerabdruck'
);

// 💣 Haelfte (b): der Nachbarabstand, und er reicht ueber den Kasten hinaus. Ein fremder Gipfel, der
// naechster Nachbar eines eigenen wird, klemmt dessen Radius -- das Raster aendert sich also, ohne
// dass ein eigener Gipfel bewegt wurde. (a/b liegen 22,36 auseinander; 'nah' kommt b auf 14,87.)
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2, $gipfel('nah', 141.0, 210.0), $fern]) !== $basis,
    'B9: ein FREMDER Gipfel, der naechster Nachbar eines eigenen wird, aendert den Fingerabdruck'
);
// ⚠️ Gegenprobe, damit B9 nicht bloss "ein Gipfel mehr" misst.
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin1, $drin2, $gipfel('weit', 400.0, 400.0), $fern]) === $basis,
    'B10: Gegenprobe -- ein fremder Gipfel ohne Nachbarschaft aendert nichts'
);

$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$drin2, $fern, $drin1]) === $basis,
    'B11: die Reihenfolge der Zeilen aendert die Antwort nicht'
);
// 🪤 Die Kastengrenze ist EINSCHLIESSLICH -- das Gitter deckt origin..origin+n*cell ab.
$sicher(
    avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$gipfel('k', 100.0, 200.0), $fern])
        !== avesmapsTerrainPeaksFingerprintFuerKasten($kasten, [$fern]),
    'B12: ein Gipfel genau auf der Kastenkante zaehlt mit'
);

/* ===== C) Der Riegel: ist das gespeicherte Raster noch aktuell? ================================ */
// 🔴 OHNE BLOB-VERGLEICH (der erste Anlauf ist daran live gescheitert). Das Raster wird AUS Gipfeln,
// Reglern und Geometrie gerechnet -- sind deren Stempel gleich UND die Form gleich, ist es gleich.

$form = ['cell_size_mapunits' => 0.25, 'origin_x' => 100.0, 'origin_y' => 200.0,
    'width_px' => 160, 'height_px' => 120, 'sample_bytes' => 38400];
$zeile = $form + ['geometry_revision' => 7, 'terrain_fingerprint' => str_repeat('a', 40),
    'peaks_fingerprint' => str_repeat('b', 40)];

$sicher(
    avesmapsTerrainRasterIstAktuell($zeile, $form, 7, str_repeat('a', 40), str_repeat('b', 40)) === true,
    'C1: gleiche Stempel und gleiche Form heisst aktuell -- nichts zu schreiben'
);
$sicher(
    avesmapsTerrainRasterIstAktuell(null, $form, 7, str_repeat('a', 40), str_repeat('b', 40)) === false,
    'C2: ohne gespeicherte Zeile ist nichts aktuell'
);
$sicher(
    avesmapsTerrainRasterIstAktuell($zeile, $form, 8, str_repeat('a', 40), str_repeat('b', 40)) === false,
    'C3: eine andere geometry_revision heisst veraltet'
);
$sicher(
    avesmapsTerrainRasterIstAktuell($zeile, $form, 7, str_repeat('c', 40), str_repeat('b', 40)) === false,
    'C4: ein anderer Regler-Stempel heisst veraltet'
);
$sicher(
    avesmapsTerrainRasterIstAktuell($zeile, $form, 7, str_repeat('a', 40), str_repeat('c', 40)) === false,
    'C5: ein anderer Gipfel-Stempel heisst veraltet'
);

// 💣 DIE FORM MUSS MIT. Die Stempel decken Gipfel, Regler und Geometrie ab -- NICHT aber eine
// geaenderte Zellweite oder Pixelzahl, die aus einer Code-Aenderung kommen kann (ECOSYSTEM_HYDRO_
// ZELLWEITE stand schon einmal anders). Ohne diese Pruefung bliebe ein Raster in alter Aufloesung
// liegen und gaelte als aktuell.
foreach (['cell_size_mapunits' => 0.5, 'origin_x' => 101.0, 'origin_y' => 201.0,
          'width_px' => 161, 'height_px' => 121, 'sample_bytes' => 38402] as $feld => $anders) {
    $andereForm = $form;
    $andereForm[$feld] = $anders;
    $sicher(
        avesmapsTerrainRasterIstAktuell($zeile, $andereForm, 7, str_repeat('a', 40), str_repeat('b', 40)) === false,
        "C6: ein abweichendes '$feld' heisst veraltet, auch bei gleichen Stempeln"
    );
}

// ⚠️ PDO-Strings, auch hier.
$zeileAusPdo = ['cell_size_mapunits' => '0.250', 'origin_x' => '100', 'origin_y' => '200.0',
    'width_px' => '160', 'height_px' => '120', 'sample_bytes' => '38400',
    'geometry_revision' => '7', 'terrain_fingerprint' => str_repeat('a', 40),
    'peaks_fingerprint' => str_repeat('b', 40)];
$sicher(
    avesmapsTerrainRasterIstAktuell($zeileAusPdo, $form, 7, str_repeat('a', 40), str_repeat('b', 40)) === true,
    'C7: Zahlen als PDO-Strings -- sonst gilt JEDES Raster als veraltet und der Riegel ist tot'
);

// 🪤 Ein fehlendes Feld in der gespeicherten Zeile ist keine Gleichheit. Bei Ursprung 0/0 ist der
// Wertvergleich keine Rettung mehr: `(float) null` ist 0.0 und damit genau der erwartete Wert.
$amNullpunkt = ['cell_size_mapunits' => 0.25, 'origin_x' => 0.0, 'origin_y' => 0.0,
    'width_px' => 160, 'height_px' => 120, 'sample_bytes' => 38400];
$zeileNull = $amNullpunkt + ['geometry_revision' => 7, 'terrain_fingerprint' => str_repeat('a', 40),
    'peaks_fingerprint' => str_repeat('b', 40)];
$sicher(
    avesmapsTerrainRasterIstAktuell($zeileNull, $amNullpunkt, 7, str_repeat('a', 40), str_repeat('b', 40)) === true,
    'C8: Ursprung 0/0 ist ein gueltiger Wert'
);
$luecke = $zeileNull;
unset($luecke['origin_x']);
$sicher(
    avesmapsTerrainRasterIstAktuell($luecke, $amNullpunkt, 7, str_repeat('a', 40), str_repeat('b', 40)) === false,
    'C9: ein FEHLENDES Feld ist keine Gleichheit, auch wenn der erwartete Wert 0.0 ist'
);

/* ===== D) Der Einbau ========================================================================== */
// Ausfuehren laesst sich `avesmapsTerrainHeightmapPut` hier nicht (MySQL-DDL) -- also werden die
// tragenden Zusagen am Quelltext festgenagelt. 💣 MIT DEM TOKENIZER, nicht mit `preg_replace`:
// ein Blockkommentar-Entferner frisst an einem `/*` in einem Zeilenkommentar hunderte Zeilen.
$quelle = file_get_contents(__DIR__ . '/../terrain-store.php');
$sicher(is_string($quelle) && $quelle !== '', 'D0: Quelltext lesbar');

$code = '';
foreach (token_get_all($quelle) as $t) {
    if (is_array($t)) {
        if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) { continue; }
        $code .= $t[1];
        continue;
    }
    $code .= $t;
}

// 🔴 KEIN BLOB-VERGLEICH. Daran ist der erste Anlauf live gescheitert; diese Zusicherung ist der
// Waechter dagegen, dass ihn jemand "zur Sicherheit" wieder einbaut.
$sicher(!str_contains($code, 'samples = :blob'), 'D1: kein Blob-Vergleich in SQL');
$sicher(!str_contains($code, 'CASE WHEN samples'), 'D2: auch nicht in anderer Schreibweise');

// Beide Leser rufen DENSELBEN Erzeuger -- rechnen sie verschieden, gilt jedes Raster fuer immer
// als veraltet und der Rasterlauf laeuft endlos.
$sicher(
    substr_count($code, 'avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $inputs[\'peaks\'])') === 2,
    'D3: BEIDE Leser rufen denselben Erzeuger mit denselben Argumenten'
);
$sicher(
    !str_contains($code, 'avesmapsTerrainPeaksFingerprint($inputs'),
    'D4: der GLOBALE Stempel steht in keinem Pfad mehr'
);

// 💣 Die drei Spalten im Status-SELECT. Ohne sie ist der Kasten dort null und alles gilt fuer immer
// als veraltet -- dieselbe Falle, die dort eine Zeile tiefer schon fuer die V12-Regler steht.
foreach (['h.cell_size_mapunits', 'h.origin_x', 'h.origin_y'] as $spalte) {
    $sicher(str_contains($code, $spalte), "D5: '$spalte' fehlt im Status-SELECT");
}

// Der Riegel steht VOR dem INSERT, sonst ist er wirkungslos.
$posRiegel = strpos($code, 'avesmapsTerrainRasterIstAktuell(');
$posInsert = strpos($code, '$insert->execute([');
$sicher($posRiegel !== false && $posInsert !== false && $posRiegel < $posInsert,
    'D6: der Riegel steht VOR dem INSERT');

// Der N+1: nur noch EIN Query je Upload.
$rs = strpos($code, 'function avesmapsTerrainReadStampInputs');
$re = strpos($code, 'function ', $rs + 10);
$rumpf = substr($code, $rs, $re - $rs);
$sicher(
    substr_count($rumpf, '$pdo->query(') + substr_count($rumpf, '$pdo->prepare(') === 1,
    'D7: nur EIN Query je Upload -- der zweite lief 69 mal pro Rasterlauf'
);
$sicher(!str_contains($rumpf, 'height_areas'), 'D8: `height_areas` ist samt JOIN gefallen');

echo "OK: gebirgsraster-stempel-test.php -- $n Zusicherungen\n";
