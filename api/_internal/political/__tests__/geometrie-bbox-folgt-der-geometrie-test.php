<?php

declare(strict_types=1);

/**
 * Die bbox-Spalten einer Geometriezeile folgen ihrer Geometrie -- und wer ueber sie vorfiltert,
 * sieht die Flaeche nur, wenn sie stimmen.
 *
 * Der Fall (05.09.2026): „Was ist hier?" fand um Al'Anfa kein Herrschaftsgebiet, obwohl der Layer
 * das Alanfanische Imperium dort zeichnet. Ursache war weder Gueltigkeit noch Punkttest, sondern
 * min_x..max_y der Geometriezeile: gesetzt beim Anlegen aus dem Start-Sechseck des Platzhalters,
 * beim Zeichnen der echten Flaeche nie nachgezogen -- 896 von 908 aktiven Zeilen im Dump vom
 * 04.09.2026. Dieser Test faehrt den Fall mit den echten Zahlen der Zeile 1011 nach (blind vorher,
 * sehend nach der Reparatur) und haelt die drei Schreibwege fest, die eine bbox setzen:
 * Aendern (avesmapsPoliticalUpdateGeometry), Reparieren (avesmapsPoliticalRepairGeometryBounds),
 * Rueckgaengig (avesmapsPoliticalApplyGeometryAuditSnapshot).
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     -d extension=php_mbstring.dll api/_internal/political/__tests__/geometrie-bbox-folgt-der-geometrie-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../db-errors.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-layer.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../../app/what-is-here.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, wiki_key TEXT, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT, color TEXT, opacity REAL,
    coat_of_arms_url TEXT, wiki_url TEXT, capital_place_id INTEGER, seat_place_id INTEGER,
    valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT, min_zoom INTEGER, max_zoom INTEGER,
    is_active INTEGER, editor_notes TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT
)');
// Spaltenliste = Live-DDL vom 04.09.2026 (Dump), damit `SELECT *`-Leser dieselbe Form sehen.
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, geometry_geojson TEXT,
    valid_from_bf INTEGER, valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, source TEXT, style_json TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, updated_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)');
$pdo->exec('CREATE TABLE political_territory_derived_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE political_territory_wiki (
    id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, type TEXT, affiliation_path_json TEXT,
    affiliation_raw TEXT, affiliation_root TEXT, founded_text TEXT, dissolved_text TEXT,
    dissolved_type TEXT, capital_name TEXT, seat_name TEXT
)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE political_territory_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
    undo_audit_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)');
// Die Wappen-Zutaten von „Was ist hier?" -- leer, aber vorhanden, damit der Riegel nicht in seinen
// Fehlerpfad laeuft und die Kette ohne Wappen zurueckgibt.
$pdo->exec('CREATE TABLE political_territory_wiki_test (wiki_key TEXT, coat_of_arms_url TEXT, coat_of_arms_license_status TEXT)');
$pdo->exec('CREATE TABLE wiki_territory_model (wiki_key TEXT, metadata_overrides_json TEXT)');
$pdo->exec("INSERT INTO users (id, username) VALUES (7, 'valentin')");

// Das Alanfanische Imperium, wie es live steht (political_territory 2084).
const IMPERIUM_PUBLIC_ID = '0a443a3c-2da8-420c-b1e2-7d89e3a1ffc7';
const GEOMETRIE_1011 = 'c3980faa-aff6-44ea-9da9-c57bd729ae32';
const GEOMETRIE_1046 = '6ead63be-0000-4000-8000-000000001046';
$pdo->exec("INSERT INTO political_territory
    (id, public_id, wiki_id, wiki_key, slug, name, type, parent_id, continent, status, color, opacity,
     valid_from_bf, valid_to_bf, min_zoom, max_zoom, is_active, sort_order)
    VALUES (2084, '" . IMPERIUM_PUBLIC_ID . "', NULL, 'wiki:alanfanisches-imperium', 'alanfanisches-imperium',
     'Alanfanisches Imperium', 'Imperium', NULL, 'Aventurien', 'eigenständiger Staat', '#c27a56', 0.7,
     1009, 9999, 0, 6, 1, 1740)");

// Die echte Ausdehnung der Zeile 1011 (x 394,25..512,78 · y 109,08..260,34) als Rechteck, und die
// gespeicherte bbox, wie sie live stand: der Kasten des Start-Sechsecks, 20 x 17,32.
$grosseFlaeche = ['type' => 'Polygon', 'coordinates' => [[
    [394.25, 109.078], [512.781, 109.078], [512.781, 260.344], [394.25, 260.344], [394.25, 109.078],
]]];
$kleineFlaeche = ['type' => 'Polygon', 'coordinates' => [[
    [477.188, 104.594], [486.563, 104.594], [486.563, 118.656], [477.188, 118.656], [477.188, 104.594],
]]];
$einfuegen = $pdo->prepare('INSERT INTO political_territory_geometry
    (id, public_id, territory_id, geometry_geojson, valid_from_bf, valid_to_bf, min_zoom, max_zoom,
     min_x, min_y, max_x, max_y, source, style_json, is_active, created_by, updated_by, created_at, updated_at)
    VALUES (:id, :public_id, 2084, :geo, NULL, NULL, 0, 6, :min_x, :min_y, :max_x, :max_y, :source, NULL, 1, 2, 2,
     :stempel, :stempel2)');
$einfuegen->execute([
    'id' => 1011, 'public_id' => GEOMETRIE_1011, 'geo' => json_encode($grosseFlaeche),
    'min_x' => 437.858, 'min_y' => 236.84, 'max_x' => 457.858, 'max_y' => 254.16,
    'source' => 'editor', 'stempel' => '2026-06-16 15:45:01', 'stempel2' => '2026-08-27 15:35:06',
]);
// Die Gegenprobe: eine Zeile, deren bbox stimmt, darf der Nachzug nicht anfassen.
$einfuegen->execute([
    'id' => 1046, 'public_id' => GEOMETRIE_1046, 'geo' => json_encode($kleineFlaeche),
    'min_x' => 477.188, 'min_y' => 104.594, 'max_x' => 486.563, 'max_y' => 118.656,
    'source' => 'editor', 'stempel' => '2026-06-16 15:45:01', 'stempel2' => '2026-08-27 15:34:13',
]);

function bboxVon(PDO $pdo, string $publicId): array {
    $s = $pdo->prepare('SELECT min_x, min_y, max_x, max_y, updated_at FROM political_territory_geometry WHERE public_id = :p');
    $s->execute(['p' => $publicId]);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    return ['min_x' => (float) $r['min_x'], 'min_y' => (float) $r['min_y'], 'max_x' => (float) $r['max_x'], 'max_y' => (float) $r['max_y'], 'updated_at' => (string) $r['updated_at']];
}
function bboxGleich(array $a, array $b): bool {
    foreach (['min_x', 'min_y', 'max_x', 'max_y'] as $k) {
        if (abs((float) $a[$k] - (float) $b[$k]) > 0.001) {
            return false;
        }
    }
    return true;
}
$echteBbox1011 = ['min_x' => 394.25, 'min_y' => 109.078, 'max_x' => 512.781, 'max_y' => 260.344];
$sechseck1011 = ['min_x' => 437.858, 'min_y' => 236.84, 'max_x' => 457.858, 'max_y' => 254.16];
$alAnfaX = 414.0745;
$alAnfaY = 151.9697;

// ===== 1. Die Reproduktion: mit der Sechseck-bbox ist „Was ist hier?" blind ====================
// Der Punkttest wuerde treffen -- der bbox-Vorfilter laesst die Zeile gar nicht erst bis dorthin.
assert(avesmapsClimateGeometryContains($grosseFlaeche, $alAnfaX, $alAnfaY) === true,
    'Al\'Anfa liegt geometrisch im Imperium -- der Punkttest ist nicht das Problem');
$vorher = avesmapsWhatIsHereReadTerritories($pdo, $alAnfaX, $alAnfaY, 1049);
assert($vorher === [], 'mit der veralteten bbox findet „Was ist hier?" um Al\'Anfa KEIN Gebiet -- der Live-Befund vom 18.08.2026');

// ===== 2. Der Trockenlauf zaehlt, schreibt aber nichts ==========================================
$probe = avesmapsPoliticalRepairGeometryBounds($pdo);
assert($probe['dry_run'] === true, 'ohne Angabe ist es ein Trockenlauf');
assert($probe['checked'] === 2, 'beide Zeilen wurden geprueft');
assert($probe['stale'] === 1, 'genau eine Zeile weicht ab');
assert($probe['repaired'] === 0, 'und der Trockenlauf repariert keine');
assert($probe['remaining'] === 1, 'die eine bleibt als offen gemeldet');
assert(count($probe['sample']) === 1 && $probe['sample'][0]['id'] === 1011, 'die Stichprobe nennt die Zeile 1011');
assert(abs($probe['sample'][0]['delta'] - 127.766) < 0.01, 'mit ihrem Abstand (max_y 254,16 gegen 260,34 ist klein, min_y 236,84 gegen 109,08 ist die 127,8)');
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), $sechseck1011), 'die Zeile ist nach dem Trockenlauf unveraendert');

// ===== 3. Scharf: die bbox folgt der Geometrie, die richtige Zeile bleibt unberuehrt =============
$lauf = avesmapsPoliticalRepairGeometryBounds($pdo, false);
assert($lauf['dry_run'] === false && $lauf['repaired'] === 1 && $lauf['remaining'] === 0 && $lauf['errors'] === [],
    'scharf repariert er die eine Zeile, ohne Fehler und ohne Rest');
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), $echteBbox1011), 'die bbox der Zeile 1011 ist jetzt die ihrer Geometrie');
$gegenprobe = bboxVon($pdo, GEOMETRIE_1046);
assert(bboxGleich($gegenprobe, ['min_x' => 477.188, 'min_y' => 104.594, 'max_x' => 486.563, 'max_y' => 118.656]),
    'die Zeile mit richtiger bbox traegt weiter ihre Werte');
assert($gegenprobe['updated_at'] === '2026-08-27 15:34:13', 'und ihr Zeitstempel ist unangetastet -- eine Reparatur ist keine Bearbeitung');
$zweiterLauf = avesmapsPoliticalRepairGeometryBounds($pdo, false);
assert($zweiterLauf['stale'] === 0 && $zweiterLauf['repaired'] === 0, 'ein zweiter Lauf findet nichts mehr (idempotent)');

// ===== 4. Jetzt sieht „Was ist hier?" das Imperium ===============================================
$nachher = avesmapsWhatIsHereReadTerritories($pdo, $alAnfaX, $alAnfaY, 1049);
assert(count($nachher) === 1, 'nach dem Nachzug findet „Was ist hier?" genau ein Gebiet');
assert((string) $nachher[0]['name'] === 'Alanfanisches Imperium', 'und es ist das Imperium');
assert((string) $nachher[0]['public_id'] === IMPERIUM_PUBLIC_ID, 'mit seiner public_id');

// „Zum Gebiet springen" (territory_bounds) liest dieselben Spalten -- vorher flog es aufs Sechseck.
$grenzen = avesmapsPoliticalReadTerritoryBounds($pdo, ['public_id' => IMPERIUM_PUBLIC_ID]);
assert(is_array($grenzen['bounds']) && abs($grenzen['bounds']['min_x'] - 394.25) < 0.001 && abs($grenzen['bounds']['max_y'] - 260.344) < 0.001,
    'territory_bounds liefert die echte Ausdehnung des Gebiets');

// ===== 5. Der Erzeuger des Befunds: Aendern zieht die bbox seither mit ===========================
// x 400..410: Al'Anfa (x 414,07) liegt bewusst KNAPP ausserhalb -- der Vorfilter muss das sagen.
$neueFlaeche = ['type' => 'Polygon', 'coordinates' => [[
    [400.0, 150.0], [410.0, 150.0], [410.0, 160.0], [400.0, 160.0], [400.0, 150.0],
]]];
$antwort = avesmapsPoliticalUpdateGeometry($pdo, [
    'geometry_public_id' => GEOMETRIE_1011,
    'geometry_geojson' => $neueFlaeche,
], ['id' => 7]);
assert(($antwort['ok'] ?? false) === true, 'das Aendern antwortet ok');
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), ['min_x' => 400.0, 'min_y' => 150.0, 'max_x' => 410.0, 'max_y' => 160.0]),
    'nach avesmapsPoliticalUpdateGeometry traegt die Zeile die bbox der NEUEN Geometrie -- das war die Luecke');
// Und der Schnappschuss danach im Protokoll traegt sie ebenfalls (daraus liest die Audit-Liste ihren Sprungpunkt).
$protokoll = $pdo->query("SELECT after_json FROM political_territory_geometry_audit_log WHERE action = 'update_geometry' ORDER BY id DESC LIMIT 1")->fetchColumn();
$danach = json_decode((string) $protokoll, true);
assert(abs((float) ($danach['geometries'][GEOMETRIE_1011]['min_x'] ?? 0) - 400.0) < 0.001,
    'der Nachher-Schnappschuss im Audit traegt die neue bbox');
// Der Punkt liegt nun ausserhalb der kleinen Flaeche -- und der Vorfilter sagt das auch: kein Treffer.
assert(avesmapsWhatIsHereReadTerritories($pdo, $alAnfaX, $alAnfaY, 1049) === [],
    'ausserhalb der neuen Flaeche gibt es zu Recht keinen Treffer');

// ===== 6. Rueckgaengig: die bbox kommt aus der Geometrie des Schnappschusses ======================
// Ein Schnappschuss von VOR der Reparatur traegt den Sechseck-Kasten. Wuerde das Rueckgaengig ihn
// abschreiben, staende die Zeile 1011 nach dem ersten Undo wieder blind da.
$alterSchnappschuss = [
    'public_id' => GEOMETRIE_1011,
    'territory_id' => 2084,
    'geometry_geojson' => $grosseFlaeche,
    'valid_from_bf' => null, 'valid_to_bf' => null, 'min_zoom' => 0, 'max_zoom' => 6,
    'min_x' => 437.858, 'min_y' => 236.84, 'max_x' => 457.858, 'max_y' => 254.16,
    'source' => 'editor', 'style_json' => [], 'is_active' => 1,
];
avesmapsPoliticalApplyGeometryAuditSnapshot($pdo, GEOMETRIE_1011, $alterSchnappschuss, 7);
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), $echteBbox1011),
    'das Rueckgaengig schreibt die bbox aus der GEOMETRIE des Schnappschusses, nicht seine veralteten Felder');
assert(count(avesmapsWhatIsHereReadTerritories($pdo, $alAnfaX, $alAnfaY, 1049)) === 1,
    'und „Was ist hier?" bleibt sehend');
// Der Rueckfall: ohne lesbare Geometrie bleiben die Felder des Schnappschusses die einzige Quelle.
$ohneGeometrie = $alterSchnappschuss;
$ohneGeometrie['geometry_geojson'] = null;
$ohneGeometrie['min_x'] = 1.0; $ohneGeometrie['min_y'] = 2.0; $ohneGeometrie['max_x'] = 3.0; $ohneGeometrie['max_y'] = 4.0;
avesmapsPoliticalApplyGeometryAuditSnapshot($pdo, GEOMETRIE_1011, $ohneGeometrie, 7);
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), ['min_x' => 1.0, 'min_y' => 2.0, 'max_x' => 3.0, 'max_y' => 4.0]),
    'ohne Geometrie im Schnappschuss gelten dessen Felder -- der Rueckfall ist kein Wegwerfen');

// ===== 7. Der Nachzug prueft auch inaktive Zeilen (Papierkorb) ===================================
$pdo->exec("UPDATE political_territory_geometry SET is_active = 0, geometry_geojson = '" . json_encode($grosseFlaeche) . "' WHERE id = 1011");
$papierkorb = avesmapsPoliticalRepairGeometryBounds($pdo, false);
assert($papierkorb['checked'] === 2 && $papierkorb['repaired'] === 1, 'eine inaktive Zeile wird mitgeprueft und mitrepariert');
assert(bboxGleich(bboxVon($pdo, GEOMETRIE_1011), $echteBbox1011), 'auch im Papierkorb folgt die bbox der Geometrie');

// ===== 8. Der Deckel: scharf schreibt er hoechstens limit Zeilen und meldet den Rest ==============
$pdo->exec('UPDATE political_territory_geometry SET min_x = 0, min_y = 0, max_x = 1, max_y = 1');
$gedeckelt = avesmapsPoliticalRepairGeometryBounds($pdo, false, 1);
assert($gedeckelt['stale'] === 2 && $gedeckelt['repaired'] === 1 && $gedeckelt['remaining'] === 1,
    'mit limit 1 repariert er eine von zwei und meldet die andere als Rest');

echo 'OK: geometrie-bbox-folgt-der-geometrie-test -- Aendern, Reparieren und Rueckgaengig setzen die bbox aus der Geometrie; „Was ist hier?" sieht das Imperium.' . "\n";
