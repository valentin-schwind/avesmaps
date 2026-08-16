<?php

declare(strict_types=1);

/**
 * Eine abgeleitete Aussenhuelle ohne jede Quellflaeche ist gezeichnet, aber unerreichbar.
 * Dieser Test haelt das Praedikat fest, das Scanner, Bulk-Knopf und Loesch-Weiche TEILEN.
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
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

// 🔴 KEIN define() der Kontinent-Konstante mehr: derived-orphans.php laedt seit 16.08.2026 seine
// eigenen Abhaengigkeiten, und territory.php bringt die Konstante als `const` mit. Ein define()
// davor liesse PHP beim Laden „Constant already defined" warnen.
require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../derived-orphans.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-audit.php';
require_once __DIR__ . '/../territories-geometry-inventory.php';
require_once __DIR__ . '/../territories-geometry.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT,
    color TEXT, opacity REAL, is_active INTEGER, sort_order INTEGER,
    min_zoom INTEGER, max_zoom INTEGER, valid_from_bf INTEGER, valid_to_bf INTEGER,
    capital_place_id INTEGER, seat_place_id INTEGER, wiki_key TEXT, wiki_url TEXT, valid_label TEXT
)');
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    source TEXT, style_json TEXT, geometry_geojson TEXT,
    created_by INTEGER, created_at TEXT, updated_by INTEGER, updated_at TEXT,
    valid_from_bf INTEGER, valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE political_territory_derived_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, created_by INTEGER, created_at TEXT,
    updated_by INTEGER, updated_at TEXT
)');
// ⚠️ Die Spaltenliste folgt dem, was avesmapsPoliticalFetchTerritoryByPublicId joint -- der
// Rechtsklick-Weg (delete_derived_geometry_tree) laeuft ueber diesen Resolver, nicht daran vorbei.
$pdo->exec('CREATE TABLE political_territory_wiki (
    id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, type TEXT, affiliation_path_json TEXT,
    affiliation_raw TEXT, affiliation_root TEXT, founded_text TEXT, dissolved_text TEXT,
    capital_name TEXT, seat_name TEXT
)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE political_territory_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
    undo_audit_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)');

//  1 Geist: Huelle, kein Kind, keine eigene Flaeche.  (= "Neues Herrschaftsgebiet (1008)")
//  2 Blatt mit eigener Flaeche.                       (= Támenev)
//  3 Aggregat, dessen Flaeche beim KIND 4 liegt.      (= Grafschaft Winhall)
//  5 Huelle, deren Territorium geloescht wurde.       (dangling)
//  6 Blatt, dessen einzige Flaeche INAKTIV ist.       (= Geist auf dem zweiten Weg)
//  7 Deaktiviertes Territorium mit aktiver Flaeche.   (Papierkorb -- wiederherstellbar)
//  8 Wiki-Knoten ohne parent_id-Kinder, dessen Quelle NUR ueber den Wiki-Zweig zu finden ist.
//  9 Das namensgleiche Ziel dieses Wiki-Zweigs, mit aktiver Flaeche.
// 10 Aktives Gebiet auf einem ANDEREN Kontinent.
$pdo->exec("INSERT INTO political_territory (id, public_id, wiki_id, name, parent_id, is_active, continent) VALUES
    (1, 'p-geist',  NULL, 'Neues Herrschaftsgebiet (1008)', NULL, 1, 'Aventurien'),
    (2, 'p-blatt',  NULL, 'Támenev',                        NULL, 1, 'Aventurien'),
    (3, 'p-aggr',   NULL, 'Grafschaft Winhall',             NULL, 1, 'Aventurien'),
    (4, 'p-kind',   NULL, 'Reichsland Winhall',                3, 1, 'Aventurien'),
    (6, 'p-inaktiv',NULL, 'Gebiet mit toter Flaeche',       NULL, 1, 'Aventurien'),
    (7, 'p-deakt',  NULL, 'Deaktiviertes Gebiet',           NULL, 0, 'Aventurien'),
    (8, 'p-wiki',     70, 'Wiki-Knoten',                    NULL, 1, 'Aventurien'),
    (9, 'p-wikikind', NULL,'Untergebiet Alpha',             NULL, 1, 'Aventurien'),
    (10,'p-fremd',  NULL, 'Gebiet in Myranor',              NULL, 1, 'Myranor')");
// Der Wiki-Zweig sucht ueber die NAMEN aus affiliation_path_json + dem eigenen Namen; ueber
// parent_id ist Gebiet 9 mit 8 NICHT verbunden. Genau diese Konstellation kennt der Layer und
// kannte das Praedikat bis 16.08.2026 nicht.
$pdo->exec("INSERT INTO political_territory_wiki (id, wiki_key, name, affiliation_path_json) VALUES
    (70, 'wiki:wiki-knoten', 'Wiki-Knoten', '[\"Untergebiet Alpha\"]')");
$pdo->exec("INSERT INTO political_territory_geometry
    (id, public_id, territory_id, is_active, source, created_by, created_at, min_x, min_y, max_x, max_y) VALUES
    (10, 'g-blatt', 2, 1, '', 7, '2026-08-04 10:00:00',   0.0,   0.0,  10.0,  10.0),
    (11, 'g-kind',  4, 1, '', 7, '2026-08-04 10:00:00',   0.0,   0.0,  20.0,  20.0),
    (12, 'g-tot',   6, 0, '', 7, '2026-08-04 10:00:00',   0.0,   0.0,   6.0,   6.0),
    (13, 'g-deakt', 7, 1, '', 7, '2026-08-04 10:00:00',  10.0,  10.0,  20.0,  20.0),
    (14, 'g-wiki',  9, 1, '', 7, '2026-08-04 10:00:00',  30.0,  30.0,  40.0,  40.0)");
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (20, 'd-geist',   1, 1, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00'),
    (21, 'd-blatt',   2, 1,   0.0,   0.0,  10.0,  10.0, 7, '2026-08-04 10:00:00'),
    (22, 'd-aggr',    3, 1,   0.0,   0.0,  20.0,  20.0, 7, '2026-08-04 10:00:00'),
    (23, 'd-dangling',5, 1,   0.0,   0.0,   5.0,   5.0, 7, '2026-08-04 10:00:00'),
    (24, 'd-inaktiv', 6, 1,   0.0,   0.0,   6.0,   6.0, 7, '2026-08-04 10:00:00'),
    (25, 'd-weg',     1, 0, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00'),
    (26, 'd-deakt-terr', 7, 1, 10.0, 10.0, 20.0, 20.0, 7, '2026-08-04 10:00:00'),
    (27, 'd-wiki',    8, 1,  30.0,  30.0,  40.0,  40.0, 7, '2026-08-04 10:00:00'),
    (28, 'd-fremd',  10, 1,  50.0,  50.0,  60.0,  60.0, 7, '2026-08-04 10:00:00')");
$pdo->exec("INSERT INTO users (id, username) VALUES (7, 'valentin')");

$kontext = avesmapsPoliticalDerivedHullSourceContext($pdo);

$withKeys = array_keys($kontext['with_geometry']);
sort($withKeys);
assert($withKeys === [2, 4, 9], 'nur AKTIVE Flaechen aktiver Gebiete zaehlen');

assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 1, $kontext) === true,
    'der Geist hat keine Quelle');
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 2, $kontext) === false,
    'ein Blatt mit eigener Flaeche ist keine Waise');
// 💣 Die Gegenprobe, an der die Rechnung haengt: das Aggregat hat SELBST keine Flaeche, seine
// Quelle liegt beim Kind. Wer nur das Gebiet fragt statt der Nachfahren, erklaert Winhall,
// Kosch und die Nordmarken zu Geistern -- live waeren das 111 von 114.
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 3, $kontext) === false,
    'ein Aggregat lebt von den Flaechen seiner Kinder');
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 5, $kontext) === true,
    'eine Huelle ohne Territorium ist erst recht verwaist');
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 6, $kontext) === true,
    'eine INAKTIVE Flaeche ist keine Quelle');
// 💣 K1: dieselbe Quellenmenge wie der Layer -- inklusive Wiki-Zweig. Der Layer zeigt fuer 8 eine
// Quelle (ueber den Namensabgleich zu 9), die Huelle ist im Editor also zu Recht inert. Wer sie
// trotzdem in die Waisenliste stellt, loescht auf Basis einer STRENGEREN Rechnung als der, nach
// der die Karte urteilt -- und zwar unumkehrbar.
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 8, $kontext) === false,
    'eine Quelle ueber den Wiki-Zweig ist eine Quelle');
// 💣 K2: „nicht im Rechenschnappschuss" ist NICHT „geloescht". Der Schnappschuss filtert auf
// is_active=1 UND continent=Aventurien; ein Gebiet im Papierkorb ist wiederherstellbar und eines
// auf einem anderen Kontinent gehoert einer anderen Karte.
assert(!isset($kontext['with_geometry'][7]), 'auch eine aktive Flaeche an einem deaktivierten Gebiet zaehlt nicht');
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 7, $kontext) === false,
    'ein Gebiet im Papierkorb ist kein Dangling -- seine Huelle ist keine Waise');
assert(avesmapsPoliticalDerivedHullIsSourceless($pdo, 10, $kontext) === false,
    'und ein anderer Kontinent auch nicht');

$hulls = avesmapsPoliticalCollectSourcelessDerivedHulls($pdo);
$ids = array_map(static fn(array $r): string => (string) $r['derived_geometry_public_id'], $hulls);
sort($ids);
assert($ids === ['d-dangling', 'd-geist', 'd-inaktiv'], 'genau die drei Waisen, in keiner Reihenfolge fixiert');
// 🔴 Eine bereits deaktivierte Huelle ist kein Fund -- sie zeichnet nichts und ist kein Befund.
assert(!in_array('d-weg', $ids, true), 'inaktive Huellen bleiben draussen');
assert(!in_array('d-deakt-terr', $ids, true), 'die Huelle eines Papierkorb-Gebiets steht nicht zum Loeschen an');
assert(!in_array('d-fremd', $ids, true), 'und die eines fremden Kontinents auch nicht');
assert(!in_array('d-wiki', $ids, true), 'und die mit einer Quelle ueber den Wiki-Zweig ebenfalls nicht');

$geist = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-geist') { $geist = $row; }
}
assert(is_array($geist), 'der Geist ist dabei');
assert((string) $geist['territory_name'] === 'Neues Herrschaftsgebiet (1008)', 'mit seinem Namen');
assert((string) $geist['territory_public_id'] === 'p-geist', 'und seinem Gebiet');
assert((string) $geist['created_by'] === 'valentin', 'und dem Urheber aus users');
assert(abs((float) $geist['area'] - 5884.4) < 0.5, 'Flaeche = Breite x Hoehe der Bounding-Box (64,1 x 91,8)');

$dangling = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-dangling') { $dangling = $row; }
}
assert((string) $dangling['territory_name'] === '(KEIN TERRITORIUM)',
    'dieselbe Beschriftung wie bei verwaisten Konturen -- eine Vokabel, nicht zwei');

// ===== Der Scanner liefert die Hüllen ============================================================
$inventar = avesmapsPoliticalReadGeometryInventory($pdo, ['include_inactive' => '1']);
assert(isset($inventar['derived_orphans']), 'das Inventar kennt jetzt die Hüllen');
$hüllenIds = array_map(static fn(array $r): string => (string) $r['derived_geometry_public_id'], $inventar['derived_orphans']);
sort($hüllenIds);
assert($hüllenIds === ['d-dangling', 'd-geist', 'd-inaktiv'], 'und zwar genau die verwaisten');
assert($inventar['derived_orphan_total'] === 3, 'die Zahl passt zur Liste');
// 🔴 Die vorhandenen Schluessel bleiben, sonst bricht das Fenster an anderer Stelle.
assert(isset($inventar['geometries'], $inventar['total'], $inventar['legacy_regions']),
    'das Konturen-Inventar ist unberuehrt');
// ⚠️ Fuer Hüllen gibt es KEINEN Platzhalter-Filter: bei Konturen bleiben echte Papierkorb-Gebiete
// absichtlich draussen, eine Huelle ohne Quelle ist dagegen immer falsch -- egal wie sie heisst.
assert(in_array('d-inaktiv', $hüllenIds, true), 'auch ein benanntes Gebiet kommt in die Liste');

// ===== Die Hart/Weich-Weiche =====================================================================
// 🔴 Owner-Entscheid 16.08.2026: hart nur, wenn nichts mehr da ist, was die Huelle erzeugen koennte.
// Solange Quellen existieren, kann „Grenzen berechnen" sie jederzeit neu bauen -- dort ist die
// umkehrbare Deaktivierung der richtige Zustand.
$geistRow = ['id' => 1, 'public_id' => 'p-geist'];
$result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $geistRow, ['id' => 7]);
assert($result['hard'] === true, 'der Geist wird hart geloescht');
$rest = $pdo->query("SELECT COUNT(*) FROM political_territory_derived_geometry WHERE public_id = 'd-geist'")->fetchColumn();
assert((int) $rest === 0, 'und ist wirklich weg, nicht nur abgeschaltet');
// 🔴 Weg heisst weg -- also bleibt wenigstens EIN Beleg. Der weiche Zweig schrieb updated_by, der
// harte hinterliess bis 16.08.2026 gar nichts.
$protokoll = $pdo->query("SELECT action, actor_user_id, before_json FROM political_territory_geometry_audit_log WHERE action = 'hard_delete_derived_geometry' ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
assert(is_array($protokoll), 'das harte Loeschen steht im Protokoll');
assert((int) $protokoll['actor_user_id'] === 7, 'mit dem, der es ausgeloest hat');
assert(str_contains((string) $protokoll['before_json'], 'd-geist'), 'und mit der Huelle, die es getroffen hat');
// 💣 NICHT unter `geometries`: die Undo-Maschine schriebe alles, was dort steht, in
// political_territory_geometry zurueck -- eine Huelle gehoert dort nicht hin.
$vorher = json_decode((string) $protokoll['before_json'], true);
assert(($vorher['geometries'] ?? null) === [], 'der Eintrag traegt KEINE Kontur');
assert(isset($vorher['derived_geometries']['d-geist']), 'sondern die Huelle unter eigenem Schluessel');
assert(avesmapsPoliticalCanUndoGeometryAuditAction('hard_delete_derived_geometry') === false,
    'und er ist ausdruecklich kein Rueckweg -- ein Beleg, mehr nicht');

$aggrRow = ['id' => 3, 'public_id' => 'p-aggr'];
$result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $aggrRow, ['id' => 7]);
assert($result['hard'] === false, 'ein Aggregat mit Kind-Flaechen wird nur deaktiviert');
$row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-aggr'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($row), 'die Zeile steht noch da');
assert((int) $row['is_active'] === 0, 'aber abgeschaltet -- "Grenzen berechnen" kann sie zurueckholen');

// ===== Der Bulk-Knopf ============================================================================
// 💣 Das Loch, das diese Baustelle erzeugt hat: der Knopf setzte ein rohes DELETE auf die Konturen
// ab und rief die vorhandene Ketten-Deaktivierung NICHT. Zwei von drei Loeschwegen gebunden ist
// keine Regel -- die Huelle blieb stehen, und niemand kam mehr an sie heran.
$vorschau = avesmapsPoliticalPurgeUnassignedGeometries($pdo, [], ['id' => 7]);
assert($vorschau['dry_run'] === true, 'ohne confirm passiert nichts');
assert($vorschau['derived_candidates'] === 2, 'die Vorschau zaehlt die Huellen mit');
assert($vorschau['derived_deleted'] === 0, 'und loescht nichts');

$ergebnis = avesmapsPoliticalPurgeUnassignedGeometries($pdo, ['confirm' => 'apply'], ['id' => 7]);
assert($ergebnis['derived_deleted'] === 2, 'mit confirm fallen die zwei restlichen Waisen');
assert(avesmapsPoliticalCollectSourcelessDerivedHulls($pdo) === [], 'keine verwaiste Huelle bleibt uebrig');
// 💣 Die Gegenprobe: der Knopf raeumt Waisen weg, NICHT den Bestand. d-blatt haengt an einer
// lebenden Quellflaeche und muss den Lauf ueberstehen -- ein Aufraeumer, der gesunde Huellen
// mitnimmt, waere schlimmer als der Zustand, den er beheben soll.
$blatt = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-blatt'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($blatt) && (int) $blatt['is_active'] === 1, 'die Huelle mit Quelle steht unangetastet da');
// 💣 Dieselbe Gegenprobe fuer die drei Faelle, die K1/K2 aus der Liste geholt haben. Sie sind der
// eigentliche Preis eines unumkehrbaren Loeschens: haetten sie den Lauf nicht ueberlebt, waeren
// ein Papierkorb-Gebiet, eine fremde Karte und eine Wiki-Quelle unwiderruflich weg.
foreach (['d-deakt-terr' => 'ein Papierkorb-Gebiet', 'd-fremd' => 'ein fremder Kontinent', 'd-wiki' => 'eine Wiki-Quelle'] as $publicId => $was) {
    $row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = '" . $publicId . "'")->fetch(PDO::FETCH_ASSOC);
    assert(is_array($row) && (int) $row['is_active'] === 1, $was . ' ueberlebt den Bulk-Lauf unangetastet');
}

// ===== Der Rechtsklick auf der Karte laeuft durch DIESELBE Weiche ================================
// 💣 delete_derived_geometry_tree setzte bis 16.08.2026 sein eigenes Sammel-UPDATE ab. Derselbe
// Text „Außenhülle löschen" loeschte damit im Aufraeumfenster hart und auf der Karte weich -- der
// Geist blieb als inaktive Zeile stehen und war danach fuer KEIN Werkzeug mehr sichtbar, weil
// beide Listen is_active = 1 filtern.
// ⚠️ Echte UUIDs: avesmapsPoliticalResolveDerivedGeometryTarget haelt alles andere fuer einen
// Wiki-Schluessel und sucht in political_territory_wiki weiter.
$baumWurzelPublicId = '11111111-1111-4111-8111-111111111111';
$pdo->exec("INSERT INTO political_territory (id, public_id, wiki_id, name, parent_id, is_active, continent) VALUES
    (11, '" . $baumWurzelPublicId . "', NULL, 'Baum-Wurzel', NULL, 1, 'Aventurien'),
    (12, '22222222-2222-4222-8222-222222222222', NULL, 'Baum-Ast leer', 11, 1, 'Aventurien'),
    (13, '33333333-3333-4333-8333-333333333333', NULL, 'Baum-Ast voll', 11, 1, 'Aventurien')");
$pdo->exec("INSERT INTO political_territory_geometry
    (id, public_id, territory_id, is_active, source, created_by, created_at, min_x, min_y, max_x, max_y) VALUES
    (15, 'g-baum', 13, 1, '', 7, '2026-08-04 10:00:00', 70.0, 70.0, 80.0, 80.0)");
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (30, 'd-baum-wurzel', 11, 1, 70.0, 70.0, 80.0, 80.0, 7, '2026-08-04 10:00:00'),
    (31, 'd-baum-leer',   12, 1, 70.0, 70.0, 72.0, 72.0, 7, '2026-08-04 10:00:00'),
    (32, 'd-baum-voll',   13, 1, 70.0, 70.0, 80.0, 80.0, 7, '2026-08-04 10:00:00')");

$baum = avesmapsPoliticalDeleteDerivedGeometryTree($pdo, ['territory_public_id' => $baumWurzelPublicId], ['id' => 7]);
assert($baum['affected'] === 3, 'alle drei Huellen des Baums sind angefasst');
assert($baum['hard_deleted'] === 1, 'aber nur die eine ohne Quelle faellt hart');
$leer = $pdo->query("SELECT COUNT(*) FROM political_territory_derived_geometry WHERE public_id = 'd-baum-leer'")->fetchColumn();
assert((int) $leer === 0, 'der Ast ohne Quelle ist wirklich weg, nicht nur abgeschaltet');
// 🔴 Die Gegenprobe: ein gesunder Baum wird weiterhin nur deaktiviert. „Grenzen berechnen" holt
// ihn zurueck, solange Quellflaechen da sind.
foreach (['d-baum-wurzel', 'd-baum-voll'] as $publicId) {
    $row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = '" . $publicId . "'")->fetch(PDO::FETCH_ASSOC);
    assert(is_array($row) && (int) $row['is_active'] === 0, $publicId . ' steht abgeschaltet da');
}

// ===== Die Weiche bleibt weich, wo etwas wiederherstellbar ist ===================================
$deaktRow = ['id' => 7, 'public_id' => 'p-deakt'];
$result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $deaktRow, ['id' => 7]);
assert($result['hard'] === false, 'die Huelle eines Papierkorb-Gebiets wird nur deaktiviert');
$row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-deakt-terr'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($row) && (int) $row['is_active'] === 0, 'die Zeile bleibt stehen -- das Gebiet ist wiederherstellbar');

// ===== Der Loeschknopf einer dangling-Huelle trifft SIE, nicht eine Kontur ========================
// 💣 Ohne Gebiet gibt es keine territory_public_id, ueber die man die Huelle adressieren koennte.
// Der Knopf fiel deshalb auf hard_delete_geometry mit der DERIVED-ID zurueck -- und das sucht in
// political_territory_geometry, findet nichts und antwortet „Die Geometrie wurde nicht gefunden."
// Genau die Zeilen, die der Entwurf ausdruecklich listet, waren einzeln nicht entfernbar.
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (40, 'd-einzeln', 999, 1, 90.0, 90.0, 95.0, 95.0, 7, '2026-08-04 10:00:00')");
$einzeln = avesmapsPoliticalDeleteDerivedGeometry($pdo, ['derived_geometry_public_id' => 'd-einzeln'], ['id' => 7]);
assert(($einzeln['ok'] ?? false) === true, 'die Huelle ohne Gebiet ist einzeln loeschbar');
assert(($einzeln['hard'] ?? false) === true, 'und zwar hart -- ohne Gebiet kann sie niemand erzeugen');
$rest = $pdo->query("SELECT COUNT(*) FROM political_territory_derived_geometry WHERE public_id = 'd-einzeln'")->fetchColumn();
assert((int) $rest === 0, 'die Zeile ist wirklich weg');

// 🔴 Die Gegenprobe: die eigene public_id ist ein ZUGRIFFSWEG, keine zweite Meinung ueber
// hart/weich. Gibt es das Gebiet noch, entscheidet weiterhin die Weiche -- d-blatt haengt an einer
// lebenden Quellflaeche und wird deshalb nur deaktiviert.
$ueberBlatt = avesmapsPoliticalDeleteDerivedGeometry($pdo, ['derived_geometry_public_id' => 'd-blatt'], ['id' => 7]);
assert(($ueberBlatt['hard'] ?? true) === false, 'eine Huelle mit Quelle wird auch ueber diesen Weg nur deaktiviert');
$row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-blatt'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($row) && (int) $row['is_active'] === 0, 'ihre Zeile steht noch da');

$fehlt = avesmapsPoliticalDeleteDerivedGeometry($pdo, ['derived_geometry_public_id' => 'd-gibt-es-nicht'], ['id' => 7]);
assert(($fehlt['ok'] ?? true) === false, 'eine unbekannte Huellen-ID meldet einen Fehler statt still zu tun');

echo "OK: verwaiste-aussenhuellen-test\n";
