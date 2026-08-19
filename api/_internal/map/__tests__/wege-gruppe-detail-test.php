<?php

declare(strict_types=1);

/**
 * `group_detail` -- der Leser, aus dem die WEG-EBENE ihre Zahlen und ihre Kette baut. AUSGEFUEHRT,
 * an einer echten (SQLite-)Karte.
 *
 * 🪤 WARUM ES DIESEN TEST GIBT. Der Endpunkt ging am 19.08.2026 live, ohne dass ihn je etwas
 * ausgefuehrt hatte -- die Tests des Zuges prueften den Schreibweg und die Oberflaeche, nie den
 * Leser. Beim ersten echten Klick antwortete er mit einem LEEREN Rumpf („Unexpected end of JSON
 * input"), weil eine Konstante hinter dem try-Block stand und PHP `const` auf Dateiebene nicht
 * hoistet. Der Formfehler ist jetzt eigens gewacht (const-vor-benutzung-test.php); dieser Test hier
 * beantwortet die andere Haelfte: LAEUFT der Leser ueberhaupt, und liefert er, was die Kette
 * braucht?
 *
 * ⚠️ Die Funktionen wohnen im Endpunkt (api/edit/map/paths-editor.php), nicht in einer Bibliothek
 * -- ein `require` wuerde also den Anfrage-Aufbau mitlaufen lassen (Konfiguration, CORS, Auth) und
 * sofort aussteigen. Geladen wird deshalb der FUNKTIONSTEIL der Datei: alles ab der ersten
 * Funktionsdefinition. Das ist derselbe Code, den der Server ausfuehrt -- kein Nachbau.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/wege-gruppe-detail-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require $wurzel . '/api/_internal/bootstrap.php';
require $wurzel . '/api/_internal/map/features.php';
require $wurzel . '/api/_internal/routing/terrain-calibration.php';
require $wurzel . '/api/_internal/app/path-landscapes.php';

// Der Funktionsteil des Endpunkts -- ab der ersten Definition bis zum Dateiende.
$quelle = (string) file_get_contents($wurzel . '/api/edit/map/paths-editor.php');
$start = strpos($quelle, "\nfunction avesmapsPathEditorList");
assert($start !== false, 'der Endpunkt hat seine erste Funktion nicht mehr da, wo dieser Test sie sucht');

// 💣 Die Konstante steht VOR dem try-Block und damit VOR dem Funktionsteil -- sie muss eigens mit,
// sonst scheitert der Test an genau dem Fehler, den er nicht mehr sucht.
assert(preg_match('/^const AVESMAPS_PATH_GROUP_DETAIL_MAX\s*=\s*(\d+);/m', $quelle, $deckel) === 1,
    'der Deckel AVESMAPS_PATH_GROUP_DETAIL_MAX steht nicht mehr auf Dateiebene');
define('AVESMAPS_PATH_GROUP_DETAIL_MAX', (int) $deckel[1]);

eval(substr($quelle, $start));

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE path_terrain (
    path_id INTEGER PRIMARY KEY, ascent_schritt REAL, descent_schritt REAL,
    profile_json TEXT, path_revision INTEGER, heightmap_stamp TEXT
)');

const AVESMAPS_DETAIL_TEST_IDS = [
    1 => '11111111-1111-4111-8111-111111111111',
    2 => '22222222-2222-4222-8222-222222222222',
    9 => '99999999-9999-4999-8999-999999999999',   // gibt es nicht
];

// Zwei Abschnitte, die aneinanderhaengen: (0,0)->(10,0) und (10,0)->(20,0).
$einfuegen = $pdo->prepare(
    'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
         geometry_json, properties_json, is_active, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 7)'
);
$einfuegen->execute([
    AVESMAPS_DETAIL_TEST_IDS[1], 'Aguera', 'path', 'Flussweg', 'LineString',
    json_encode(['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [5.0, 0.0], [10.0, 0.0]]]),
    json_encode((object) ['name' => 'Aguera']),
]);
$einfuegen->execute([
    AVESMAPS_DETAIL_TEST_IDS[2], 'Aguera', 'path', 'Flussweg', 'LineString',
    json_encode(['type' => 'LineString', 'coordinates' => [[10.0, 0.0], [20.0, 0.0]]]),
    json_encode((object) ['name' => 'Aguera']),
]);

// ── 1) 🔴 ER LAEUFT UEBERHAUPT — und genau das war die Luecke ─────────────────────────────────
$antwort = avesmapsPathEditorGroupDetail($pdo, [
    AVESMAPS_DETAIL_TEST_IDS[1],
    AVESMAPS_DETAIL_TEST_IDS[2],
]);

assert(($antwort['ok'] ?? false) === true, 'die Antwort ist nicht ok');
assert(count($antwort['segments']) === 2, 'nicht beide Abschnitte in der Antwort');
assert($antwort['requested'] === 2);
assert($antwort['capped'] === false);

// ── 2) Die ENDPUNKTE reisen mit -- ohne sie ist die Kette nicht baubar ────────────────────────
$erster = $antwort['segments'][0];
assert(isset($erster['ends']), 'die Endpunkte fehlen -- die Weg-Ebene koennte keine Kette bauen');
assert($erster['ends']['from'] === [0.0, 0.0], 'der Anfangspunkt stimmt nicht: ' . json_encode($erster['ends']));
assert($erster['ends']['to'] === [10.0, 0.0], 'der Endpunkt stimmt nicht: ' . json_encode($erster['ends']));
// ⚠️ Und sie sind ZAHLEN, keine Zeichenketten: der Kettenbau rechnet mit ihnen.
assert(is_float($erster['ends']['from'][0]), 'die Koordinate ist keine Zahl');

// ── 3) Was `detail` sonst liefert, liefert `group_detail` auch ────────────────────────────────
assert($erster['public_id'] === AVESMAPS_DETAIL_TEST_IDS[1]);
assert($erster['feature_subtype'] === 'Flussweg');
assert(abs($erster['length_units'] - 10.0) < 0.0001, 'die Laenge stimmt nicht: ' . $erster['length_units']);
assert(count($erster['piece_lengths']) === 2, 'zwei Wegstuecke erwartet');
// Ohne Zeile in path_terrain ist `terrain` null -- der Normalfall vor dem ersten Profillauf.
assert($erster['terrain'] === null, 'ohne Profil muss terrain null sein');

// ── 4) Eine unbekannte Kennung faellt STILL heraus, statt alles scheitern zu lassen ───────────
$mitToter = avesmapsPathEditorGroupDetail($pdo, [
    AVESMAPS_DETAIL_TEST_IDS[1],
    AVESMAPS_DETAIL_TEST_IDS[9],
]);
assert(count($mitToter['segments']) === 1, 'eine tote Kennung reisst den ganzen Weg mit');
assert($mitToter['requested'] === 2, 'die Zahl der GEFRAGTEN Abschnitte geht verloren');

// ── 5) Ein vorhandenes Profil reist samt seinen vier Zahlen mit ───────────────────────────────
$id = (int) $pdo->query("SELECT id FROM map_features WHERE public_id = '" . AVESMAPS_DETAIL_TEST_IDS[1] . "'")->fetchColumn();
$pdo->prepare('INSERT INTO path_terrain (path_id, ascent_schritt, descent_schritt, profile_json, path_revision, heightmap_stamp)
               VALUES (?, 120, 30, ?, 7, ?)')
    ->execute([$id, json_encode([[60.0, 15.0, 0.0, 5.0], [60.0, 15.0, 0.0, 0.0]]), 'stamp']);

$mitProfil = avesmapsPathEditorGroupDetail($pdo, [AVESMAPS_DETAIL_TEST_IDS[1]]);
$terrain = $mitProfil['segments'][0]['terrain'];
assert($terrain !== null, 'das Profil kommt nicht mit');
assert(count($terrain['profile']) === 2, 'die Wegstuecke fehlen');
assert(count($terrain['profile'][0]) === 4,
    'ein Wegstueck traegt nicht seine VIER Zahlen -- die Weg-Ebene koennte einen gedrehten '
    . 'Abschnitt nicht richtig lesen');
assert($terrain['stale_geometry'] === false, 'die Revision stimmt ueberein, das Profil ist frisch');

// ── 6) Der Deckel kappt UND sagt es ───────────────────────────────────────────────────────────
$vieleIds = array_fill(0, AVESMAPS_PATH_GROUP_DETAIL_MAX + 5, AVESMAPS_DETAIL_TEST_IDS[9]);
$gekappt = avesmapsPathEditorGroupDetail($pdo, $vieleIds);
assert($gekappt['capped'] === true, 'eine Kappung wird verschwiegen -- das saehe wie ein kurzer Weg aus');
assert($gekappt['requested'] === AVESMAPS_PATH_GROUP_DETAIL_MAX + 5);

echo "wege-gruppe-detail-test.php: alle Zusicherungen gruen\n";
