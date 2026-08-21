<?php

declare(strict_types=1);

/**
 * Eine GEMISCHTE Kette darf die Flaeche nicht auf dem Vorfahren ablegen.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/gemischte-kette-zuweisung-test.php
 *
 * 💣 DER FALL, den es live gab (Bug #87, gemessen 21.08.2026): Irakema ist ein eigener Knoten unter
 * Mer'imen unter dem Reich Kahet Ni Kemi -- und NUR das Reich hat eine Wiki-Zeile. Der Client baut
 * beide Ketten mit .filter(Boolean):
 *
 *     wikiPublicIds      = ['wiki:k-het-ni-kemi']                  <- die zwei Leeren fallen RAUS
 *     territoryPublicIds = [Kahet, Mer'imen, Irakema]              <- vollstaendig
 *
 * Damit ist wiki_public_ids NICHT leer, sondern EINS lang. Der Kettenbauer nimmt den Wiki-Zweig
 * (er gewinnt, sobald ein Element drin ist), die Kette ist [Kahet], und ihr TIEFSTES Glied ist die
 * Wurzel. Die Flaeche landete auf dem Reich. Live nachgewiesen: Geometrie 2ceca6ad (Irakemas
 * Zeichnung) und 8559e59e (99,7 % deckungsgleich mit Cabas) hingen beide an Kahet Ni Kemi.
 *
 * 🔴 Der Entwurf vom 15.08.2026 (1f943292) sagt die Regel woertlich: eigene Knoten tragen bewusst
 * einen LEEREN wikiKey, "gefuellt naehme das Speichern den Wiki-Zweig statt des Territorien-Zweigs".
 * Das traegt nur, solange die Kette GANZ aus eigenen Knoten besteht. filter(Boolean) macht aus
 * "schalt den Wiki-Zweig ab" ein "kuerz ihn auf die Vorfahren".
 *
 * 🪤 Und genau deshalb ist es durchgerutscht: eigene-knoten-wiki-key-test.php sagt ueber seine
 * Fixture "die Kemi-Kette, wie sie live steht" und legt Kahet Ni Kemi als EIGENEN Knoten an
 * (wiki_id NULL). Live hat Kahet Ni Kemi wiki_id 1138. Eine homogene Fixture kann den gemischten
 * Fall nie fangen -- dieser Test traegt deshalb die Produktionsform.
 */

// ⚠️ bootstrap.php zuerst: territories-read.php greift auf avesmapsNormalizeSingleLine zu, ohne es
// selbst einzubinden (im Betrieb laedt der Endpunkt beides).
require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../territories-layer.php';
require_once __DIR__ . '/../territories-write.php';
require_once __DIR__ . '/../assignment.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

$KAHET   = '11111111-1111-4111-8111-111111111111';
$MERIMEN = '22222222-2222-4222-8222-222222222222';
$IRAKEMA = '33333333-3333-4333-8333-333333333333';
$FLAECHE = '66666666-6666-4666-8666-666666666666';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT,
        status TEXT, color TEXT, opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT,
        min_zoom INTEGER, max_zoom INTEGER, capital_place_id INTEGER, seat_place_id INTEGER,
        valid_from_bf INTEGER, valid_to_bf INTEGER, editor_notes TEXT, sort_order INTEGER,
        is_active INTEGER
    )'
);
$db->exec(
    'CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
        geometry_geojson TEXT, style_json TEXT, source TEXT, valid_from_bf INTEGER,
        valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER, updated_by INTEGER,
        is_active INTEGER
    )'
);
$db->exec(
    'CREATE TABLE political_territory_wiki (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, type TEXT,
        affiliation_raw TEXT, affiliation_root TEXT, affiliation_path_json TEXT,
        founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT
    )'
);
$db->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT)');

// 🔴 Die Produktionsform: NUR das Reich hat eine Wiki-Zeile.
$db->prepare(
    'INSERT INTO political_territory_wiki (wiki_key, name, type) VALUES (:wk, :name, :typ)'
)->execute(['wk' => 'wiki:k-het-ni-kemi', 'name' => 'Káhet Ni Kemi', 'typ' => 'Königreich (Káhet)']);
$wikiId = (int) $db->lastInsertId();

$neu = $db->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        color, opacity, min_zoom, max_zoom, is_active)
     VALUES (:pid, :wiki_id, :wk, :slug, :name, :typ, :parent, "#ab5f8e", 0.7, :zmin, :zmax, 1)'
);
$neu->execute(['pid' => $KAHET, 'wiki_id' => $wikiId, 'wk' => 'wiki:k-het-ni-kemi', 'slug' => 'k-het-ni-kemi',
    'name' => 'Káhet Ni Kemi', 'typ' => 'Königreich', 'parent' => null, 'zmin' => 0, 'zmax' => 1]);
$kahetId = (int) $db->lastInsertId();
$neu->execute(['pid' => $MERIMEN, 'wiki_id' => null, 'wk' => 'eigener-knoten:knoten110', 'slug' => 'mer-imen',
    'name' => "Mer'imen", 'typ' => 'territory-group', 'parent' => $kahetId, 'zmin' => 2, 'zmax' => 3]);
$merimenId = (int) $db->lastInsertId();
$neu->execute(['pid' => $IRAKEMA, 'wiki_id' => null, 'wk' => 'eigener-knoten:knoten108', 'slug' => 'irakema',
    'name' => 'Irakema', 'typ' => 'territory', 'parent' => $merimenId, 'zmin' => 4, 'zmax' => 6]);
$irakemaId = (int) $db->lastInsertId();

// Eine frisch gezeichnete, noch nicht zugewiesene Flaeche.
$db->prepare(
    'INSERT INTO political_territory_geometry (public_id, territory_id, geometry_geojson, style_json, is_active)
     VALUES (:pid, NULL, :geo, "{}", 1)'
)->execute([
    'pid' => $FLAECHE,
    'geo' => '{"type":"Polygon","coordinates":[[[360,126],[384,126],[384,151],[360,151],[360,126]]]}',
]);

// ---- Der Ablauf: exakt der Rumpf, den der Editor heute schickt ---------------------------------
// 💣 Nicht nachgebaut, sondern abgeschrieben: defaultSaveAssignment in territory-editor-embedded.js
// baut beide Listen mit .map(...).filter(Boolean) ueber denselben assignedPath.
$assignedPath = [
    ['wikiKey' => 'wiki:k-het-ni-kemi',  'territoryPublicId' => $KAHET,   'label' => 'Káhet Ni Kemi'],
    ['wikiKey' => '',                    'territoryPublicId' => $MERIMEN, 'label' => "Mer'imen"],
    ['wikiKey' => '',                    'territoryPublicId' => $IRAKEMA, 'label' => 'Irakema'],
];
$wikiPublicIds = array_values(array_filter(array_map(static fn(array $n): string => $n['wikiKey'], $assignedPath)));
$territoryPublicIds = array_values(array_filter(array_map(static fn(array $n): string => $n['territoryPublicId'], $assignedPath)));

pruefe($wikiPublicIds === ['wiki:k-het-ni-kemi'], 'Der Client schickt eine auf die Wurzel gekuerzte Wiki-Kette.');
pruefe(count($territoryPublicIds) === 3, 'Die Territorien-Kette kommt dagegen vollstaendig an.');

$antwort = avesmapsPoliticalSaveGeometryAssignment($db, [
    'geometry_public_id' => $FLAECHE,
    'wiki_public_ids' => $wikiPublicIds,
    'territory_public_ids' => $territoryPublicIds,
    'wiki_nodes' => array_map(static fn(array $n): array => [
        'key' => $n['wikiKey'] ?: $n['territoryPublicId'],
        'territoryPublicId' => $n['territoryPublicId'],
        'name' => $n['label'],
        'type' => 'Herrschaftsgebiet',
    ], $assignedPath),
    'assignment' => ['displays' => []],
], ['id' => 1]);

$zeile = $db->prepare('SELECT territory_id FROM political_territory_geometry WHERE public_id = :pid');
$zeile->execute(['pid' => $FLAECHE]);
$zielId = (int) $zeile->fetchColumn();

// 🔴 DIE Zusicherung. Heute steht hier $kahetId -- das ist der Fehler.
pruefe(
    $zielId === $irakemaId,
    'Das TIEFSTE Glied bekommt die Flaeche: Irakema, nicht das Reich darueber.'
);

// ⚠️ Die Gegenprobe -- ohne sie bewiese die Zusicherung oben nichts: das Reich darf sie NICHT haben.
pruefe($zielId !== $kahetId, 'Die Flaeche landet nicht auf Káhet Ni Kemi.');
pruefe($zielId !== $merimenId, 'Und auch nicht auf der Zwischenebene Mer\'imen.');

// Die Kette in der Antwort muss dieselbe Tiefe haben wie der Pfad, den der Editor kannte --
// sonst hat serverseitig etwas gekuerzt, ohne es zu sagen.
pruefe(
    count($antwort['chain'] ?? []) === 3,
    'Die Antwort meldet alle drei Glieder zurueck, nicht nur die Wurzel.'
);

// 🔴 Das Zoom-Band des Reiches bleibt, was es war. Bei einer auf 1 gekuerzten Kette vergibt
// avesmapsPoliticalDefaultAssignmentZoomRange dem einzigen Glied 0..6 -- das Reich haette
// danach das Band eines Blattes.
$band = $db->prepare('SELECT min_zoom, max_zoom FROM political_territory WHERE id = :id');
$band->execute(['id' => $kahetId]);
$kahetBand = $band->fetch(PDO::FETCH_ASSOC);
pruefe(
    (int) $kahetBand['max_zoom'] !== 6,
    'Das Reich behaelt sein Zoom-Band -- eine gekuerzte Kette darf es nicht auf 0..6 aufreissen.'
);

echo "gemischte-kette-zuweisung: {$checks} Zusicherungen gruen.\n";
