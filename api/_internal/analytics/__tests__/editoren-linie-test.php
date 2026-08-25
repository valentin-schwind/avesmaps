<?php

declare(strict_types=1);

/**
 * Die dritte Linie „Editoren" im Besucher-Diagramm (Status -> Besucher, Karte „Aktivität über Zeit").
 * Geprüft wird die Vereinigung der Tage, nicht die Abfrage -- die steht in
 * avesmapsVisitorMergeEditorHeads und braucht MySQL.
 *
 * Ausführen, vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/editoren-linie-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions steht nicht auf '1' -- assert() waere wirkungslos. "
        . "Erneut starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../visitor-analytics.php';

$tage = static fn (array $rows): array => array_column($rows, 'day');
$nach = static function (array $rows, string $day): ?array {
    foreach ($rows as $row) {
        if (($row['day'] ?? '') === $day) {
            return $row;
        }
    }

    return null;
};

// --- Der Normalfall: die Editorenzahl reist an der Besucherzeile mit ------------------------------
$besucher = [
    ['day' => '2026-08-11', 'views' => '240', 'uniques' => '110', 'routes' => '12'],
    ['day' => '2026-08-12', 'views' => '80', 'uniques' => '40', 'routes' => '3'],
];
$editoren = [
    ['day' => '2026-08-11', 'editors' => '1'],
    ['day' => '2026-08-12', 'editors' => '4'],
];
$vereint = avesmapsVisitorMergeEditorRows($besucher, $editoren);
assert(count($vereint) === 2, 'gleiche Tage geben gleich viele Zeilen');
assert($nach($vereint, '2026-08-12')['editors'] === 4, 'die Editorenzahl landet an ihrem Tag');
assert($nach($vereint, '2026-08-11')['views'] === '240', 'die Besucherzahlen bleiben unangetastet');

// --- 💣 Ein Tag, an dem nur ein Editor da war und kein Gast ---------------------------------------
// Er hat keine Besucherzeile. Wer nur in vorhandene Zeilen einsetzt, laesst ihn aus der Zeitachse
// fallen -- und die Linie springt ueber das Loch hinweg, als waere dort niemand gewesen.
$nurEditor = avesmapsVisitorMergeEditorRows(
    [['day' => '2026-08-11', 'views' => '240', 'uniques' => '110', 'routes' => '12']],
    [['day' => '2026-08-11', 'editors' => '1'], ['day' => '2026-08-12', 'editors' => '2']]
);
assert(count($nurEditor) === 2, '💣 der reine Editorentag kommt in die Zeitachse, statt zu verschwinden');
assert($nach($nurEditor, '2026-08-12')['editors'] === 2, 'und bringt seine Zahl mit');
assert($nach($nurEditor, '2026-08-12')['views'] === 0, 'sein Besucherwert ist 0, nicht undefiniert');
assert($nach($nurEditor, '2026-08-12')['uniques'] === 0, 'dasselbe fuer die eindeutigen Besucher');
assert($nach($nurEditor, '2026-08-12')['routes'] === 0, 'dasselbe fuer die Routen');

// --- 💣 Ein Besuchertag ohne Editor bekommt ausdruecklich die 0 -----------------------------------
// Aus einem FEHLENDEN Feld zeichnet der Browser eine Luecke, aus der 0 einen Punkt auf der
// Nulllinie. Nur das zweite ist wahr -- und der Client unterscheidet die beiden Faelle bewusst
// (vaDailyHasEditors prueft das Feld, nicht seinen Wert).
$ohneEditor = avesmapsVisitorMergeEditorRows(
    [['day' => '2026-08-11', 'views' => '240', 'uniques' => '110', 'routes' => '12']],
    []
);
assert(array_key_exists('editors', $ohneEditor[0]), '💣 die Spalte ist da, auch wenn kein Editor kam');
assert($ohneEditor[0]['editors'] === 0, 'und steht auf 0, nicht auf null');

// --- Die Reihenfolge IST die Zeitachse ------------------------------------------------------------
$durcheinander = avesmapsVisitorMergeEditorRows(
    [['day' => '2026-08-13', 'views' => '5'], ['day' => '2026-08-11', 'views' => '240']],
    [['day' => '2026-08-12', 'editors' => '2']]
);
assert(
    $tage($durcheinander) === ['2026-08-11', '2026-08-12', '2026-08-13'],
    'die Tage stehen aufsteigend, egal wie sie hereinkommen'
);

// --- Ränder ---------------------------------------------------------------------------------------
assert(avesmapsVisitorMergeEditorRows([], []) === [], 'ohne alles kommt nichts heraus, kein Wurf');
$ohneTag = avesmapsVisitorMergeEditorRows([['views' => '5']], [['editors' => '2']]);
assert($ohneTag === [], 'eine Zeile ohne Tag hat auf einer Zeitachse nichts verloren');
$doppelt = avesmapsVisitorMergeEditorRows(
    [['day' => '2026-08-11', 'views' => '240']],
    [['day' => '2026-08-11', 'editors' => '1'], ['day' => '2026-08-11', 'editors' => '3']]
);
assert(count($doppelt) === 1 && $doppelt[0]['editors'] === 3, 'ein doppelter Tag gibt eine Zeile, nicht zwei');

echo "OK -- alle Zusicherungen gehalten\n";
