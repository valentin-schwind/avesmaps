<?php

declare(strict_types=1);

/**
 * Eigene Knoten tragen ihren Schluessel SELBST -- und der Editor muss ihn beide Wege benutzen.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/eigene-knoten-wiki-key-test.php
 *
 * 💣 Ein eigener Knoten hat KEINE Wiki-Zeile: avesmapsWikiSyncMonitorApplyCustomNodes legt ihn mit
 * wiki_id NULL an und schreibt den Schluessel nach political_territory.wiki_key. Die Zuweisung las
 * den Schluessel aber ausschliesslich ueber wiki_id -> political_territory_wiki und lieferte
 * deshalb LEER. Der Editor fiel damit auf einen Namens-Slug zurueck, und ab da entschied ein
 * Namensvergleich ueber alles.
 *
 * 💣 Und der Namensvergleich kann fuer akzentbehaftete Namen GAR NICHT aufgehen: avesmapsPoliticalSlug
 * faltet ueber avesmapsFoldToAscii, wo Akzente samt Grundbuchstabe verschwinden ('Rekáchet' ->
 * 'rek-chet'), waehrend der Browser dieselben Namen nach NFD zerlegt und die Akzente wegwirft
 * ('rekachet'). Zwei Formen, die nie gleich werden. Deshalb steht unten die Gegenprobe: sie haelt
 * fest, dass der ALTE Weg den Knoten nicht findet -- sonst bewiese der neue nichts.
 *
 * ⚠️ Die zweite Haelfte ist der Rueckweg. Sobald die Zuweisung den echten Schluessel MITSCHICKT,
 * kommt er beim Speichern auch wieder an, und der Kettenbauer nimmt den wiki_public_ids-Zweig
 * statt des territory_public_ids-Zweigs. Ohne avesmapsPoliticalFindTerritoryByWikiKey landet er
 * dort im Namensweg (FindTerritoryBySlug) und legt bei abweichendem Slug eine ZWEITE Zeile an.
 * Die beiden Aenderungen sind gekoppelt; einzeln waere die erste eine Verschlimmbesserung.
 */

// ⚠️ bootstrap.php zuerst: territories-read.php greift auf avesmapsNormalizeSingleLine zu, ohne es
// selbst einzubinden (im Betrieb laedt der Endpunkt beides).
require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../assignment.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// ---- Teil 1: die Schluesselaufloesung, ohne Datenbank ------------------------------------------

// Ein gewoehnlicher Wiki-Knoten: die Wiki-Zeile gewinnt, wie bisher.
pruefe(
    avesmapsPoliticalResolveTerritoryWikiKey(
        ['wiki_id' => 42, 'wiki_key' => 'wiki:baronie-sarslund'],
        'wiki:baronie-sarslund'
    ) === 'wiki:baronie-sarslund',
    'Der Schluessel der Wiki-Zeile gewinnt.'
);

// Ein eigener Knoten: keine Wiki-Zeile, aber die Spalte traegt den Schluessel.
pruefe(
    avesmapsPoliticalResolveTerritoryWikiKey(
        ['wiki_id' => null, 'wiki_key' => 'eigener-knoten:knoten092'],
        ''
    ) === 'eigener-knoten:knoten092',
    'Ohne Wiki-Zeile gilt der Schluessel des Gebiets selbst -- das war die Luecke.'
);

// ⚠️ Auch wenn die wiki_id zeigt, die Zeile dahinter aber fehlt (der stille catch in assignment.php),
// ist die eigene Spalte besser als nichts.
pruefe(
    avesmapsPoliticalResolveTerritoryWikiKey(
        ['wiki_id' => 7, 'wiki_key' => 'wiki:verwaiste-zeile'],
        ''
    ) === 'wiki:verwaiste-zeile',
    'Verwaiste wiki_id faellt auf die eigene Spalte zurueck.'
);

pruefe(avesmapsPoliticalResolveTerritoryWikiKey([], '') === '', 'Ohne beides bleibt es leer.');
pruefe(
    avesmapsPoliticalResolveTerritoryWikiKey(['wiki_key' => '   '], '') === '',
    'Leerraum ist kein Schluessel.'
);

// ---- Teil 2: warum der Namensweg das nicht leisten kann ----------------------------------------
// Die Gegenprobe. Ohne sie bewiese Teil 1 nur, dass eine neue Funktion das tut, was sie tut.
pruefe(avesmapsPoliticalSlug('Rekáchet') === 'rek-chet', 'PHP faltet den Akzent samt Grundbuchstabe weg.');
pruefe(avesmapsPoliticalSlug('Djuimen') === 'djuimen', 'Reines ASCII bleibt heil -- deshalb ging es manchmal gut.');
// Die Form, die der Browser aus demselben Namen baut (makeKey: NFD, Akzente streichen).
$browserForm = 'rekachet';
pruefe(
    avesmapsPoliticalSlug('Rekáchet') !== $browserForm,
    'Server- und Browserform desselben Namens werden nie gleich -- deshalb reicht kein Namensvergleich.'
);

// ---- Teil 3: der Rueckweg, gegen sqlite --------------------------------------------------------

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test wuerde stillschweigend bestehen\n");
    exit(1);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT, wiki_id INTEGER, wiki_key TEXT, slug TEXT, name TEXT, is_active INTEGER
    )'
);

$einfuegen = $pdo->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, is_active)
     VALUES (:public_id, :wiki_id, :wiki_key, :slug, :name, :is_active)'
);
// So sieht die Zeile aus, die ApplyCustomNodes anlegt. ⚠️ Der Slug traegt eine Endziffer, weil
// avesmapsPoliticalUniqueSlug ihn bei Kollision fortzaehlt -- genau der Fall, in dem der
// Namensweg danebengreift und eine zweite Zeile anlegt.
$einfuegen->execute([
    'public_id' => '33333333-3333-4333-8333-333333333333', 'wiki_id' => null, 'wiki_key' => 'eigener-knoten:knoten092',
    'slug' => 'rek-chet-2', 'name' => 'Rekáchet', 'is_active' => 1,
]);
$einfuegen->execute([
    'public_id' => '44444444-4444-4444-8444-444444444444', 'wiki_id' => null, 'wiki_key' => 'eigener-knoten:knoten077',
    'slug' => 'stillgelegt', 'name' => 'Stillgelegt', 'is_active' => 0,
]);

$gefunden = avesmapsPoliticalFindTerritoryByWikiKey($pdo, 'eigener-knoten:knoten092');
pruefe($gefunden !== null, 'Der eigene Knoten wird ueber seinen Schluessel gefunden.');
pruefe((string) $gefunden['public_id'] === '33333333-3333-4333-8333-333333333333', 'Und zwar genau die richtige Zeile.');

pruefe(
    avesmapsPoliticalFindTerritoryByWikiKey($pdo, 'eigener-knoten:knoten077') === null,
    'Stillgelegte Zeilen zaehlen nicht -- sonst wiederbelebte eine Zuweisung Geloeschtes.'
);
pruefe(
    avesmapsPoliticalFindTerritoryByWikiKey($pdo, 'eigener-knoten:gibtsnicht') === null,
    'Unbekannter Schluessel gibt null, damit der Aufrufer neu anlegen kann.'
);
pruefe(avesmapsPoliticalFindTerritoryByWikiKey($pdo, '  ') === null, 'Leerer Schluessel sucht nicht.');

// 💣 Die Gegenprobe zum Rueckweg: der Namensweg, den der Kettenbauer sonst nimmt, findet dieselbe
// Zeile NICHT -- er wuerde eine zweite anlegen. Das ist der Grund fuer die zweite Aenderung.
pruefe(
    avesmapsPoliticalFindTerritoryBySlug($pdo, avesmapsPoliticalSlug('Rekáchet')) === null,
    'Der Namensweg greift daneben, sobald der Slug fortgezaehlt wurde.'
);

// ---- Teil 4: der Rundlauf ----------------------------------------------------------------------
// Was die Zuweisung herausgibt, muss beim Speichern wieder dieselbe Zeile treffen.
$zeile = ['wiki_id' => null, 'wiki_key' => 'eigener-knoten:knoten092', 'name' => 'Rekáchet'];
$hinaus = avesmapsPoliticalResolveTerritoryWikiKey($zeile, '');
$zurueck = avesmapsPoliticalFindTerritoryByWikiKey($pdo, $hinaus);
pruefe(
    $zurueck !== null && (string) $zurueck['public_id'] === '33333333-3333-4333-8333-333333333333',
    'Hin- und Rueckweg treffen dieselbe Zeile -- keine Dublette.'
);

// ---- Teil 5: der ABLAUF -- was der Editor wirklich bekommt --------------------------------------
// ⭐ Die Teile davor messen Funktionen. Dieser hier faehrt den echten Lesepfad
// (avesmapsPoliticalGetGeometryAssignment) und schaut in die Antwort, die im Browser ankommt.
// Genau dort entschied sich, ob der Breadcrumb Geschwister findet.

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, type TEXT, parent_id INTEGER, color TEXT, opacity REAL,
        coat_of_arms_url TEXT, min_zoom INTEGER, max_zoom INTEGER, capital_place_id INTEGER, seat_place_id INTEGER,
        valid_from_bf INTEGER, valid_to_bf INTEGER, is_active INTEGER
    )'
);
$db->exec(
    'CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
        geometry_json TEXT, style_json TEXT, source TEXT, valid_from_bf INTEGER,
        valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER, is_active INTEGER
    )'
);
// ⚠️ Die Spalten kommen aus den JOINs von avesmapsPoliticalFetchTerritoryById -- Hauptstadt und
// Herrschaftssitz haengen an map_features, die Wiki-Zeile an political_territory_wiki.
$db->exec(
    'CREATE TABLE political_territory_wiki (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, type TEXT,
        affiliation_raw TEXT, affiliation_root TEXT, affiliation_path_json TEXT,
        founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT
    )'
);
$db->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT)');

// Die Kemi-Kette, wie sie live steht: drei eigene Knoten, alle ohne Wiki-Zeile, zwei mit Akzent.
$neu = $db->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        color, opacity, min_zoom, max_zoom, is_active)
     VALUES (:pid, NULL, :wk, :slug, :name, :typ, :parent, "#806040", 0.5, 0, 6, 1)'
);
$neu->execute(['pid' => '11111111-1111-4111-8111-111111111111', 'wk' => 'eigener-knoten:knoten090', 'slug' => 'k-het-ni-kemi', 'name' => 'Káhet Ni Kemi', 'typ' => 'Reich', 'parent' => null]);
$kahetId = (int) $db->lastInsertId();
$neu->execute(['pid' => '22222222-2222-4222-8222-222222222222', 'wk' => 'eigener-knoten:knoten091', 'slug' => 'terkum', 'name' => 'Terkum', 'typ' => 'Provinz', 'parent' => $kahetId]);
$terkumId = (int) $db->lastInsertId();
$neu->execute(['pid' => '33333333-3333-4333-8333-333333333333', 'wk' => 'eigener-knoten:knoten092', 'slug' => 'rek-chet', 'name' => 'Rekáchet', 'typ' => 'Baronie', 'parent' => $terkumId]);
$rekachetId = (int) $db->lastInsertId();

$db->prepare(
    'INSERT INTO political_territory_geometry (public_id, territory_id, geometry_json, style_json, is_active)
     VALUES ("66666666-6666-4666-8666-666666666666", :tid, "{}", "{}", 1)'
)->execute(['tid' => $rekachetId]);

$antwort = avesmapsPoliticalGetGeometryAssignment($db, ['geometry_public_id' => '66666666-6666-4666-8666-666666666666']);
$pfad = $antwort['assignment']['assignedPath'];

pruefe(count($pfad) === 3, 'Die Kette kommt vollstaendig an: Reich > Provinz > Baronie.');
pruefe(
    array_column($pfad, 'label') === ['Káhet Ni Kemi', 'Terkum', 'Rekáchet'],
    'Und in der Reihenfolge Wurzel -> Blatt.'
);

// 💣 Der Kern: jeder Knoten traegt seinen echten Schluessel als Identitaet. Danach sucht der
// Editor ihn in seinem Baum -- exakt, nicht ueber einen Namen.
pruefe(
    array_column($pfad, 'key') === ['eigener-knoten:knoten090', 'eigener-knoten:knoten091', 'eigener-knoten:knoten092'],
    'Jeder eigene Knoten traegt seinen Schluessel als Identitaet.'
);
pruefe(array_column($pfad, 'id') === array_column($pfad, 'key'), 'id und key sind dieselbe Identitaet.');

// 🔴 Und wikiKey bleibt leer -- sonst kippt das Speichern in den Wiki-Zweig, der parent_id und
// die Zoom-Baender mit Vorgabewerten ueberschreibt. Diese zwei Zusicherungen gehoeren zusammen.
pruefe(
    array_column($pfad, 'wikiKey') === ['', '', ''],
    'Ohne Wiki-Zeile bleibt wikiKey leer -- der Speicherzweig darf nicht kippen.'
);

// Gegenprobe: der alte Stand haette hier Namens-Slugs geliefert, und der mittlere davon ist
// zufaellig brauchbar, die beiden aeusseren nie. Genau dieses Muster meldete der Owner.
pruefe(
    avesmapsPoliticalSlug('Káhet Ni Kemi') !== 'eigener-knoten:knoten090',
    'Der alte Namens-Slug ist nicht der Schluessel -- sonst waere nie etwas kaputt gewesen.'
);

// Ein gewoehnlicher Wiki-Knoten aendert sich NICHT: sein Schluessel kommt weiter aus der Wiki-Zeile.
$db->exec('INSERT INTO political_territory_wiki (wiki_key, name) VALUES ("wiki:baronie-hartsteen", "Hartsteen")');
$wikiId = (int) $db->lastInsertId();
$db->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        color, opacity, min_zoom, max_zoom, is_active)
     VALUES ("55555555-5555-4555-8555-555555555555", :wid, "wiki:baronie-hartsteen", "hartsteen", "Hartsteen", "Baronie", NULL, "#806040", 0.5, 0, 6, 1)'
)->execute(['wid' => $wikiId]);
$hartsteenId = (int) $db->lastInsertId();
$db->prepare(
    'INSERT INTO political_territory_geometry (public_id, territory_id, geometry_json, style_json, is_active)
     VALUES ("77777777-7777-4777-8777-777777777777", :tid, "{}", "{}", 1)'
)->execute(['tid' => $hartsteenId]);

$wikiPfad = avesmapsPoliticalGetGeometryAssignment($db, ['geometry_public_id' => '77777777-7777-4777-8777-777777777777'])['assignment']['assignedPath'];
pruefe($wikiPfad[0]['key'] === 'wiki:baronie-hartsteen', 'Wiki-Knoten: Identitaet unveraendert.');
pruefe($wikiPfad[0]['wikiKey'] === 'wiki:baronie-hartsteen', 'Wiki-Knoten: wikiKey unveraendert gefuellt.');

echo "eigene-knoten-wiki-key: Ablaufteil gruen ({$checks} Zusicherungen gesamt).\n";
