<?php

declare(strict_types=1);

/**
 * 💣 DREI VERLAUFSQUELLEN, DREI RECHNUNGEN FUER DENSELBEN SPRUNGPUNKT -- und zwei davon waren falsch.
 *
 * Das Fenster „Aenderungen" mischt Karte, Herrschaftsgebiete und Landschaften. Jede Zeile soll auf
 * ihre Stelle springen koennen, und jede der drei Quellen hatte dafuer ihre eigene Fassung von
 * „Kasten -> Punkt oder Rechteck": die Karte in `api/edit/map/audit-log.php`, die Politik in
 * `territories-audit.php`, die Landschaften gar keine. Hier steht sie EINMAL.
 *
 * 🔴 Die Form ist die der Karte, Zeichen fuer Zeichen: `type` point|bounds, `lat`/`lng` in der Mitte,
 * bei `bounds` zusaetzlich `[[minY,minX],[maxY,maxX]]`, alles auf 6 Stellen gerundet. Der Browser
 * liest genau das (`focusAuditChangeTarget`, review-panels-change-log.js) -- eine vierte Form waere
 * ein stiller Fehlschlag, weil `L.latLngBounds` auf halb gefuellte Werte mit NaN antwortet und die
 * Karte dann irgendwohin fliegt.
 *
 * 💣 x ist LNG, y ist LAT. GeoJSON speichert `[x, y]`, Leaflet will `[lat, lng]` -- die Vertauschung
 * ist der Hausklassiker (AGENTS.md §5) und hier die einzige Stelle, an der sie noch passieren kann.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/audit-focus-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../audit-focus.php';

$checks = 0;

// ---- Ein Kasten mit Ausdehnung wird ein Rechteck -------------------------------------------------

$rechteck = avesmapsAuditFocusFromBounds(10.0, 20.0, 30.0, 50.0);
assert($rechteck !== null, 'ein Kasten mit Ausdehnung liefert ein Ziel');
assert($rechteck['type'] === 'bounds', 'und zwar ein Rechteck');
assert($rechteck['lng'] === 20.0, 'die Mitte in x liegt bei 20');
assert($rechteck['lat'] === 35.0, 'die Mitte in y liegt bei 35');
// 💣 [lat, lng] -- y zuerst. Vertauscht fliegt die Karte an den gespiegelten Punkt, und das faellt
// nur dort auf, wo x und y weit auseinanderliegen.
assert($rechteck['bounds'] === [[20.0, 10.0], [50.0, 30.0]], 'die Ecken stehen als [lat, lng]');
$checks += 5;

// ---- Ein Kasten ohne Ausdehnung wird ein Punkt ----------------------------------------------------

$punkt = avesmapsAuditFocusFromBounds(414.0745, 151.9697, 414.0745, 151.9697);
assert($punkt !== null && $punkt['type'] === 'point', 'ein Kasten ohne Ausdehnung ist ein Punkt');
assert($punkt['lat'] === 151.9697 && $punkt['lng'] === 414.0745, 'er liegt auf sich selbst');
assert(!array_key_exists('bounds', $punkt), 'und traegt keine Ecken');
$checks += 3;

// ⚠️ Die Schwelle ist 0.0001 Karteneinheiten (rund 0,3 Meilen) -- darunter ist ein Rechteck auf jeder
// Zoomstufe ein Punkt, und `fitBounds` auf ein entartetes Rechteck zoomt bis zum Anschlag hinein.
$fastPunkt = avesmapsAuditFocusFromBounds(10.0, 10.0, 10.00005, 10.00005);
assert($fastPunkt['type'] === 'point', 'ein entarteter Kasten bleibt ein Punkt');
$checks += 1;

// ---- Aus einer Geometrie -------------------------------------------------------------------------

$polygon = [
    'type' => 'Polygon',
    'coordinates' => [[[100.0, 200.0], [140.0, 200.0], [140.0, 260.0], [100.0, 260.0], [100.0, 200.0]]],
];
$ausGeometrie = avesmapsAuditFocusFromGeometry($polygon);
assert($ausGeometrie !== null && $ausGeometrie['type'] === 'bounds', 'ein Polygon liefert ein Rechteck');
assert($ausGeometrie['bounds'] === [[200.0, 100.0], [260.0, 140.0]], 'seine Huellbox stimmt');
$checks += 2;

// 💣 MultiPolygon und LineString verschachteln unterschiedlich tief. Gesammelt wird rekursiv, nicht
// auf einer erwarteten Tiefe -- sonst zaehlt genau eine Geometrieart und die anderen liefern nichts.
$multi = [
    'type' => 'MultiPolygon',
    'coordinates' => [
        [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
        [[[8.0, 9.0], [9.0, 9.0], [9.0, 10.0], [8.0, 9.0]]],
    ],
];
$ausMulti = avesmapsAuditFocusFromGeometry($multi);
assert($ausMulti['bounds'] === [[0.0, 0.0], [10.0, 9.0]], 'ein MultiPolygon wird ueber alle Teile gemessen');
$linie = ['type' => 'LineString', 'coordinates' => [[3.0, 4.0], [5.0, 6.0]]];
assert(avesmapsAuditFocusFromGeometry($linie)['bounds'] === [[4.0, 3.0], [6.0, 5.0]], 'eine Linie ebenso');
$checks += 2;

// ⚠️ Ein einzelner Punkt in der Geometrie ist ein Punkt-Ziel, kein Rechteck der Groesse null.
$einPunkt = ['type' => 'Point', 'coordinates' => [42.5, 17.25]];
$ausPunkt = avesmapsAuditFocusFromGeometry($einPunkt);
assert($ausPunkt['type'] === 'point' && $ausPunkt['lat'] === 17.25, 'ein Punkt bleibt ein Punkt');
$checks += 1;

// ---- Was KEIN Ziel ergibt ------------------------------------------------------------------------
// 🔴 `null` heisst „dazu gibt es keine Stelle" und schaltet im Browser das Fadenkreuz ab. Ein
// erfundener Nullpunkt waere die schlimmere Antwort: die Karte floege in die linke untere Ecke, und
// der Editor haette keinen Anhalt, dass es die Stelle gar nicht gibt.
assert(avesmapsAuditFocusFromGeometry(['type' => 'Polygon', 'coordinates' => []]) === null, 'ohne Koordinaten kein Ziel');
assert(avesmapsAuditFocusFromGeometry([]) === null, 'ohne Geometrie kein Ziel');
assert(avesmapsAuditFocusFromGeometry(['type' => 'Polygon']) === null, 'ohne Koordinatenschluessel kein Ziel');
$checks += 3;

// ---- Der Leser fuer einen roh gespeicherten Schnappschuss -----------------------------------------
// Die Karte legt ihre Geometrie als JSON-ZEICHENKETTE im Protokoll ab, die Politik als bereits
// dekodiertes Feld. Ein Leser fuer beide, damit keine Quelle ihren eigenen `json_decode` mitbringt.

assert(avesmapsAuditReadGeometry('{"type":"Point","coordinates":[1,2]}') !== null, 'eine Zeichenkette wird gelesen');
assert(avesmapsAuditReadGeometry(['type' => 'Point', 'coordinates' => [1, 2]]) !== null, 'ein Feld ebenso');
assert(avesmapsAuditReadGeometry('kein json') === null, 'Unsinn liefert null statt zu werfen');
assert(avesmapsAuditReadGeometry(null) === null, 'null bleibt null');
assert(avesmapsAuditReadGeometry('') === null, 'leer bleibt null');
// ⚠️ Ohne `type` ist es keine Geometrie -- ein nacktes Koordinatenfeld koennte alles sein.
assert(avesmapsAuditReadGeometry('{"coordinates":[1,2]}') === null, 'ohne type ist es keine Geometrie');
$checks += 6;

echo "OK -- {$checks} Zusicherungen bestanden.\n";
