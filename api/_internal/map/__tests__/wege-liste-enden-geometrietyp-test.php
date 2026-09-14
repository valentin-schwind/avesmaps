<?php

declare(strict_types=1);

/**
 * `avesmapsPathEditorListEnden` -- die Wache, die verhindert, dass eine Mehrfachlinie
 * (`MultiLineString`/`Polygon`) `$.coordinates[0]` als EINEN Punkt liest, obwohl JSON_EXTRACT dort
 * eine GANZE Linie liefert (Fund-Item der ersten Pruefrunde, R16-Nachfolger). AUSGEFUEHRT, OHNE
 * Datenbank -- die Funktion braucht keine.
 *
 * ⚠️ Die Funktion wohnt im Endpunkt (api/edit/map/paths-editor.php), nicht in einer Bibliothek --
 * ein `require` wuerde also den Anfrage-Aufbau mitlaufen lassen (Konfiguration, CORS, Auth) und
 * sofort aussteigen. Geladen wird deshalb der FUNKTIONSTEIL der Datei, wie in
 * wege-gruppe-detail-test.php -- derselbe Code, den der Server ausfuehrt, kein Nachbau.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/wege-liste-enden-geometrietyp-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
// avesmapsWegEndeName/avesmapsWegOrtIndex -- die Funktion ruft die eine, der Test baut mit der
// anderen einen Ortsindex.
require $wurzel . '/api/_internal/map/weg-abschnitt-ende.php';

// Der Funktionsteil des Endpunkts -- ab der ersten Definition bis zum Dateiende.
$quelle = (string) file_get_contents($wurzel . '/api/edit/map/paths-editor.php');
$start = strpos($quelle, "\nfunction avesmapsPathEditorList");
assert($start !== false, 'der Endpunkt hat seine erste Funktion nicht mehr da, wo dieser Test sie sucht');
eval(substr($quelle, $start));

$ortIndex = avesmapsWegOrtIndex([
    ['name' => 'Perz', 'x' => 0.0, 'y' => 0.0, 'kreuzung' => false],
    ['name' => 'Helmdahl', 'x' => 10.0, 'y' => 0.0, 'kreuzung' => false],
]);

// ── 1) EINE LINIE: der Normalfall -- ends UND enden kommen mit ───────────────────────────────
$linie = avesmapsPathEditorListEnden([
    'geometry_type' => 'LineString',
    'ende_von' => json_encode([0.0, 0.0]),
    'ende_bis' => json_encode([10.0, 0.0]),
], $ortIndex);
assert($linie['ends'] === ['from' => [0.0, 0.0], 'to' => [10.0, 0.0]],
    'ends stimmt nicht: ' . json_encode($linie['ends']));
assert(is_float($linie['ends']['from'][0]), 'die Koordinate ist keine Zahl');
assert($linie['enden'] === ['von' => 'Perz', 'bis' => 'Helmdahl'],
    'enden stimmt nicht: ' . json_encode($linie['enden']));

// ── 2) MEHRFACHLINIE: `$.coordinates[0]` waere hier eine GANZE Linie -- die Wache greift ─────
// 🔴 Das ist der eigentliche Befund: ohne Wache waere `ende_von` = "[[0,0],[1,1]]" gewesen, ein
// Array aus Punkten statt eines Punkts, und avesmapsWegEndeName haette still "Wegende" geraten.
$mehrfach = avesmapsPathEditorListEnden([
    'geometry_type' => 'MultiLineString',
    'ende_von' => json_encode([[0.0, 0.0], [1.0, 1.0]]),
    'ende_bis' => json_encode([[9.0, 0.0], [10.0, 0.0]]),
], $ortIndex);
assert($mehrfach['ends'] === null, 'eine Mehrfachlinie muss ends=null liefern, nicht eine Linie als Punkt');
assert($mehrfach['enden'] === null, 'eine Mehrfachlinie muss enden=null liefern');

// Dieselbe Wache greift bei einem Polygon -- die zweite in path-outliers.php genannte Bauart.
$polygon = avesmapsPathEditorListEnden([
    'geometry_type' => 'Polygon',
    'ende_von' => json_encode([[0.0, 0.0], [1.0, 1.0]]),
    'ende_bis' => json_encode([[9.0, 0.0], [10.0, 0.0]]),
], $ortIndex);
assert($polygon['ends'] === null, 'ein Polygon muss ends=null liefern');

// ── 3) EIN PUNKT MIT NUR EINER ZAHL: kaputte/unvollstaendige Koordinate ───────────────────────
$einzahl = avesmapsPathEditorListEnden([
    'geometry_type' => 'LineString',
    'ende_von' => json_encode([5.0]),
    'ende_bis' => json_encode([10.0, 0.0]),
], $ortIndex);
assert($einzahl['ends'] === null, 'eine Koordinate mit nur einer Zahl darf kein ends liefern');
assert($einzahl['enden'] === null, 'eine Koordinate mit nur einer Zahl darf kein enden liefern');

// ── 4) OHNE geometry_type (Altzeile, NULL-Spalte): dieselbe sichere Antwort ───────────────────
$ohneTyp = avesmapsPathEditorListEnden([
    'ende_von' => json_encode([0.0, 0.0]),
    'ende_bis' => json_encode([10.0, 0.0]),
], $ortIndex);
assert($ohneTyp['ends'] === null, 'ein fehlender geometry_type darf nicht als LineString gelten');

echo "wege-liste-enden-geometrietyp-test.php: alle Zusicherungen gruen\n";
