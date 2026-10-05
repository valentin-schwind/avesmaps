<?php
// api/_internal/app/__tests__/gebirgsraster-unveraendert-test.php
declare(strict_types=1);

/**
 * Der Riegel gegen den sich selbst nachladenden Rasterlauf (06.10.2026).
 *
 * Anlass: Totalausfall der Live-Seite am 05.10.2026, 15:16-16:06. Gemessen am Access-Log:
 * 202 Raster-Uploads mit je >250 KB Antwort in 76 Minuten, dazu 757 Gipfelbewegungen durch zwei
 * Editoren -- und `avesmapsTerrainPeaksFingerprint` ist GLOBAL, also macht ein einziger bewegter
 * Gipfel alle 69 Gebirgsraster "veraltet". Der Editor sieht "69 veraltet", startet den Lauf,
 * bewegt den naechsten Gipfel, sieht wieder "69 veraltet".
 *
 * Entwurf: docs/superpowers/specs/2026-10-06-gebirgsraster-lauf-riegel-design.md
 *
 * Lauf aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/gebirgsraster-unveraendert-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere ein No-Op und dieser Test meldete falsche Erfolge.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';

$zusicherungen = 0;
$sicher = static function (bool $bedingung, string $text) use (&$zusicherungen): void {
    $zusicherungen++;
    assert($bedingung, $text);
};

// ===== A) Die Entscheidung selbst ==============================================================
// Gleiche Form UND gleicher Blob heisst: das gespeicherte Raster ist Byte fuer Byte dasselbe.
// Dann darf der 250-KB-Blob NICHT erneut geschrieben werden -- nur die Stempel wollen nach.

$form = [
    'cell_size_mapunits' => 0.25,
    'origin_x' => 100.0,
    'origin_y' => 200.0,
    'width_px' => 40,
    'height_px' => 30,
    'sample_bytes' => 2400,
];

$sicher(
    avesmapsTerrainRasterBlobGleich($form, $form, true) === true,
    'A1: gleiche Form + gleicher Blob = der Blob muss nicht geschrieben werden'
);
$sicher(
    avesmapsTerrainRasterBlobGleich($form, $form, false) === false,
    'A2: gleiche Form, aber anderer Blob = schreiben'
);

// 💣 JEDES Formfeld muss zaehlen. Ein Raster mit demselben Blob an einem anderen Ursprung ist ein
// anderes Raster -- wer ein Feld vergisst, laesst ein um eine Zelle verschobenes Gebirge stehen,
// und zwar lautlos (die Zellzahl stimmt ja).
foreach (['cell_size_mapunits' => 0.5, 'origin_x' => 101.0, 'origin_y' => 201.0,
          'width_px' => 41, 'height_px' => 31, 'sample_bytes' => 2460] as $feld => $anders) {
    $abweichend = $form;
    $abweichend[$feld] = $anders;
    $sicher(
        avesmapsTerrainRasterBlobGleich($form, $abweichend, true) === false,
        "A3: ein abweichendes '$feld' muss schreiben erzwingen, auch bei gleichem Blob"
    );
}

// ⚠️ Fehlt die Zeile ganz (erstes Raster dieser Flaeche), ist nichts gleich.
$sicher(
    avesmapsTerrainRasterBlobGleich(null, $form, true) === false,
    'A4: ohne gespeicherte Zeile wird immer geschrieben'
);

// 🪤 Ein Feld, das in der gespeicherten Zeile FEHLT, darf nicht als Gleichheit durchgehen.
// `null == 0.25` ist in PHP falsch, aber `null == 0` waere wahr -- ein lockerer Vergleich
// liesse eine halb gelesene Zeile als "unveraendert" gelten.
$luecke = $form;
unset($luecke['origin_x']);
$sicher(
    avesmapsTerrainRasterBlobGleich($luecke, $form, true) === false,
    'A5: ein fehlendes Formfeld in der gespeicherten Zeile ist keine Gleichheit'
);

// 🪤 Und die Gegenrichtung: 0.0 ist ein GUELTIGER Ursprung (die Karte beginnt bei 0).
// Wer auf Wahrheitswert prueft statt auf Gleichheit, haelt ein Gebirge an der Kartenecke
// fuer "Feld fehlt" und schreibt es bei jedem Lauf neu.
$nullpunkt = ['cell_size_mapunits' => 0.25, 'origin_x' => 0.0, 'origin_y' => 0.0,
    'width_px' => 40, 'height_px' => 30, 'sample_bytes' => 2400];
$sicher(
    avesmapsTerrainRasterBlobGleich($nullpunkt, $nullpunkt, true) === true,
    'A6: Ursprung 0/0 ist ein gueltiger Wert, kein fehlendes Feld'
);

// 💣 UND HIER IST DIE ANWESENHEITSPRUEFUNG DIE EINZIGE RETTUNG -- gefunden von einer
// Mutationsprobe am 06.10.2026, die `array_key_exists` entfernte und UEBERLEBTE. Bei A5 faellt
// ein fehlendes Feld noch zufaellig durch den Wertvergleich (`(float) null` = 0.0 gegen 100.0),
// bei einem Raster am Kartennullpunkt NICHT: dort ist 0.0 der erwartete Wert, und ein fehlendes
// Feld laese sich als Gleichheit -- der Riegel wuerde ein FREMDES Raster fuer unveraendert halten
// und nur stempeln, statt es zu schreiben.
$nullLuecke = $nullpunkt;
unset($nullLuecke['origin_x']);
$sicher(
    avesmapsTerrainRasterBlobGleich($nullLuecke, $nullpunkt, true) === false,
    'A6b: ein FEHLENDES Feld ist auch dann keine Gleichheit, wenn der erwartete Wert 0.0 ist'
);

// ⚠️ Zahlen kommen aus PDO als STRING. Ein strikter `===` ueber die Rohwerte wuerde jedes
// gespeicherte Raster fuer veraendert halten -- und damit waere der ganze Riegel wirkungslos,
// ohne dass ein Test rot wird. Deshalb vergleicht die Funktion numerisch.
$ausPdo = ['cell_size_mapunits' => '0.250', 'origin_x' => '100', 'origin_y' => '200.0',
    'width_px' => '40', 'height_px' => '30', 'sample_bytes' => '2400'];
$sicher(
    avesmapsTerrainRasterBlobGleich($ausPdo, $form, true) === true,
    'A7: PDO liefert Zahlen als Strings -- der Vergleich ist numerisch, sonst ist der Riegel tot'
);

// ===== B) Der Rueckgabewert sagt, was passiert ist ==============================================
// 🔴 `written` bleibt die Zahl der geschriebenen RASTER, denn `gebirgsRasterHochladen` liest sie
// als "hochgeladen" (map-features-ecosystem-height-render.js). Ein unveraendertes Gebirge ist
// NICHT hochgeladen -- es ist aktuell. Dafuer ein eigenes Feld, statt `written` zu verbiegen.
$sicher(
    avesmapsTerrainRasterUnveraendertAntwort(1234) === ['written' => 0, 'skipped' => 0, 'unchanged' => 1, 'stored_bytes' => 1234],
    'B1: die Antwort nennt das unveraenderte Raster beim Namen und behaelt stored_bytes'
);


// ===== C) Der EINBAU ============================================================================
// 🔴 Der Riegel wirkt nur, wenn er an der richtigen Stelle steht. Ausfuehren laesst sich
// `avesmapsTerrainHeightmapPut` hier nicht (MySQL-DDL, Blob-Vergleich in SQL) -- also werden die
// drei tragenden Zusagen am Quelltext festgenagelt.
//
// 💣 MIT DEM TOKENIZER, NICHT MIT `preg_replace`. Ein Blockkommentar-Entferner sieht in einem
// ZEILENkommentar ein `/*` und frisst hunderte Zeilen echten Code -- im besten Fall wird der Test
// rot, im schlechteren laeuft eine Zusicherung LEER (AGENTS.md §11, sync-monitor-Falle).
$quelle = file_get_contents(__DIR__ . '/../terrain-store.php');
$sicher(is_string($quelle) && $quelle !== '', 'C0: Quelltext lesbar');

$codeOnly = '';
foreach (token_get_all($quelle) as $token) {
    if (is_array($token)) {
        if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
            continue;
        }
        $codeOnly .= $token[1];
        continue;
    }
    $codeOnly .= $token;
}

// C1: Der Blob-Vergleich laeuft IN der Datenbank. Wuerde PHP den gespeicherten Blob holen, reisten
// 250 KB durch den Prozess, nur um verworfen zu werden -- und genau diese Bytes sind der Grund,
// aus dem dieser Riegel existiert.
$sicher(
    str_contains($codeOnly, 'samples = :blob'),
    'C1: der Blob wird in SQL verglichen, nicht in PHP geholt'
);

// C2: Der Riegel steht VOR dem INSERT. Danach waere er wirkungslos.
$posRiegel = strpos($codeOnly, 'avesmapsTerrainRasterBlobGleich($alteZeile');
$posInsert = strpos($codeOnly, '$insert->execute([');
$sicher($posRiegel !== false, 'C2a: der Riegel ist verdrahtet');
$sicher($posInsert !== false, 'C2b: der INSERT ist noch da');
$sicher($posRiegel < $posInsert, 'C2c: der Riegel steht VOR dem INSERT');

// C3: 💣 DIE WICHTIGSTE ZUSAGE. Im Riegel-Zweig MUESSEN die Stempel nachgezogen werden -- sonst
// bleibt das Gebirge "veraltet", der naechste Lauf laedt es wieder hoch, und der Riegel hat die
// Schleife nicht gebrochen, sondern nur einen Schreibvorgang gespart. Gemessen am Ausfall vom
// 05.10.2026: genau diese Schleife kostete 202 Uploads in 76 Minuten.
$zweig = substr($codeOnly, $posRiegel, $posInsert - $posRiegel);
$sicher(
    str_contains($zweig, 'UPDATE ecosystem_area_heightmap')
        && str_contains($zweig, 'peaks_fingerprint = :peaks')
        && str_contains($zweig, 'terrain_fingerprint = :terrain'),
    'C3: der Riegel-Zweig zieht BEIDE Stempel nach, statt nur zu ueberspringen'
);
$sicher(
    str_contains($zweig, 'return avesmapsTerrainRasterUnveraendertAntwort('),
    'C3b: und er kehrt zurueck, statt in den INSERT zu fallen'
);

echo "OK: Einbau festgenagelt -- insgesamt $zusicherungen Zusicherungen\n";
