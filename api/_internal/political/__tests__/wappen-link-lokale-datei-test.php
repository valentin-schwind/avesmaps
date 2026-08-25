<?php

declare(strict_types=1);

/**
 * Ein SELBST HOCHGELADENES Wappen ist ein gueltiger Wappen-Link.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/wappen-link-lokale-datei-test.php
 *
 * 💣 DER FALL, den es live gab (Bug #99, gemeldet 25.08.2026 von Thomas an der Baronie
 * Neuwiallsburg): "Territorium kann nicht angelegt werden", Statusfeld sagt
 * "Der Wappen-Link muss mit http:// oder https:// beginnen" -- und dazu der Satz, der die
 * Ursache verraet: "wir haben aber auf der gesamten Stufe nur selbst generierte und
 * hochgeladene Wappen".
 *
 * 🔴 DIESELBE FRAGE HATTE ZWEI ANTWORTEN. Der LESER haelt einen lokalen Pfad fuer den
 * bevorzugten Wappenwert eines Gebiets -- avesmapsResolveGatedCoatUrl laesst
 * '/uploads/wappen/grafschaft-ferdok-custom.png' als Override sogar ueber Wiki-Bild und
 * eigenes Bild gewinnen (coat-resolve-test.php). Der Upload SELBST erzeugt genau diese Form:
 * settlement-coat-upload.php gibt '/uploads/wappen/own/<datei>' zurueck. Der SCHREIBER dagegen
 * verlangte '^https?://' und wies damit ab, was das Haus an anderer Stelle selbst herstellt
 * und bevorzugt.
 *
 * 💣 UND DER VERSTAERKER, der aus dem Schoenheitsfehler eine Blockade macht: assignment.php
 * validiert nicht nur, was der Benutzer eintippt, sondern auch den RUECKFALL auf den in der
 * Datenbank stehenden Wert -- ueber die GANZE Kette. Ein einziger Vorfahre mit hochgeladenem
 * Wappen laesst deshalb eine Zuweisung scheitern, die das Wappen ueberhaupt nicht anfasst.
 * Das ist der Grund, warum die Meldung "auf der gesamten Stufe" sagt.
 *
 * ⚠️ Die Regel bleibt eng: erlaubt ist der eigene Upload-Ordner, NICHT jeder Pfad, der mit
 * einem Schraegstrich beginnt -- '//fremde.example/x.png' ist protokollrelativ und fuehrt nach
 * DRAUSSEN, waere aber durch ein blosses "beginnt mit /" durchgerutscht.
 */

// ⚠️ bootstrap.php zuerst: territories-read.php greift auf avesmapsNormalizeSingleLine zu, ohne
// es selbst einzubinden (im Betrieb laedt der Endpunkt beides).
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

// ---- 1. Die Regel selbst ----------------------------------------------------------------------
$EIGENES = '/uploads/wappen/own/baronie-neuwiallsburg.png';

pruefe(
    avesmapsPoliticalReadOptionalCoatUrl($EIGENES, 'Der Wappen-Link') === $EIGENES,
    'Ein selbst hochgeladenes Wappen wird angenommen -- genau diese Form liefert der Upload.'
);
pruefe(
    avesmapsPoliticalReadOptionalCoatUrl('https://www.wiki-aventurica.de/x.png', 'Der Wappen-Link')
        === 'https://www.wiki-aventurica.de/x.png',
    'Eine absolute Adresse bleibt selbstverstaendlich erlaubt.'
);
pruefe(
    avesmapsPoliticalReadOptionalCoatUrl('', 'Der Wappen-Link') === '',
    'Leer bleibt leer -- kein Wappen ist kein Fehler.'
);
pruefe(
    avesmapsPoliticalReadOptionalCoatUrl('/uploads/wappen/cache/abc123.svg', 'Der Wappen-Link')
        === '/uploads/wappen/cache/abc123.svg',
    'Auch die lokale Kopie aus avesmapsCoatLokaleKopie ist ein gueltiger Wert.'
);

// ⚠️ Die Gegenproben. Ohne sie bewiese die Lockerung oben nur, dass sie lockert.
$boeseFaelle = [
    '//fremde.example/wappen.png'  => 'protokollrelativ -- fuehrt nach DRAUSSEN, nicht in unseren Ordner',
    '/etc/passwd'                  => 'ein beliebiger Serverpfad ist kein Wappen',
    '/uploads/../../etc/passwd'    => 'Pfad-Traversal aus dem Upload-Ordner heraus',
    'javascript:alert(1)'          => 'ein Skript-Schema gehoert nie in ein src-Attribut',
    'ftp://beispiel.example/x.png' => 'nur http(s), wie bisher',
];
foreach ($boeseFaelle as $boese => $warum) {
    $geworfen = false;
    try {
        avesmapsPoliticalReadOptionalCoatUrl($boese, 'Der Wappen-Link');
    } catch (InvalidArgumentException) {
        $geworfen = true;
    }
    pruefe($geworfen, "Abgewiesen bleibt: {$boese} ({$warum}).");
}

// ---- 2. Der Abnahmefall: anlegen, waehrend die Stufe darueber eigene Wappen traegt -------------
$GRAFSCHAFT = '11111111-1111-4111-8111-111111111111';
$BARONIE    = '22222222-2222-4222-8222-222222222222';
$FLAECHE    = '66666666-6666-4666-8666-666666666666';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT,
        status TEXT, color TEXT, opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT,
        min_zoom INTEGER, max_zoom INTEGER, capital_place_id INTEGER, seat_place_id INTEGER,
        valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT, editor_notes TEXT,
        sort_order INTEGER, is_active INTEGER
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

$neu = $db->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        color, opacity, coat_of_arms_url, min_zoom, max_zoom, is_active)
     VALUES (:pid, NULL, :wk, :slug, :name, :typ, :parent, "#ab5f8e", 0.7, :coat, :zmin, :zmax, 1)'
);

// 🔴 Die Produktionsform: die Stufe darueber traegt ein SELBST HOCHGELADENES Wappen. Genau das
// steht bei Thomas in der Datenbank, und genau daran ist das Anlegen gescheitert.
$neu->execute([
    'pid' => $GRAFSCHAFT, 'wk' => 'eigener-knoten:knoten200', 'slug' => 'grafschaft-wiallsburg',
    'name' => 'Grafschaft Wiallsburg', 'typ' => 'Grafschaft', 'parent' => null,
    'coat' => '/uploads/wappen/own/grafschaft-wiallsburg.png', 'zmin' => 3, 'zmax' => 4,
]);
$grafschaftId = (int) $db->lastInsertId();

$neu->execute([
    'pid' => $BARONIE, 'wk' => 'eigener-knoten:knoten201', 'slug' => 'baronie-neuwiallsburg',
    'name' => 'Baronie Neuwiallsburg', 'typ' => 'Baronie', 'parent' => $grafschaftId,
    'coat' => $EIGENES, 'zmin' => 6, 'zmax' => 6,
]);
$baronieId = (int) $db->lastInsertId();

$db->prepare(
    'INSERT INTO political_territory_geometry (public_id, territory_id, geometry_geojson, style_json, is_active)
     VALUES (:pid, NULL, :geo, "{}", 1)'
)->execute([
    'pid' => $FLAECHE,
    'geo' => '{"type":"Polygon","coordinates":[[[360,126],[384,126],[384,151],[360,151],[360,126]]]}',
]);

// Der Rumpf, den der Editor beim Zuweisen schickt -- die KETTE, nicht das einzelne Gebiet.
$gescheitert = null;
try {
    avesmapsPoliticalSaveGeometryAssignment($db, [
        'geometry_public_id' => $FLAECHE,
        'wiki_public_ids' => [],
        'territory_public_ids' => [$GRAFSCHAFT, $BARONIE],
        'wiki_nodes' => [
            ['key' => $GRAFSCHAFT, 'territoryPublicId' => $GRAFSCHAFT, 'name' => 'Grafschaft Wiallsburg', 'type' => 'Grafschaft'],
            ['key' => $BARONIE, 'territoryPublicId' => $BARONIE, 'name' => 'Baronie Neuwiallsburg', 'type' => 'Baronie'],
        ],
        'assignment' => ['displays' => []],
    ], ['id' => 1]);
} catch (InvalidArgumentException $fehler) {
    $gescheitert = $fehler->getMessage();
}

// 🔴 DIE Zusicherung. Heute steht hier die Absage -- das ist der Fehler.
pruefe(
    $gescheitert === null,
    'Die Zuweisung laeuft durch, obwohl die Kette selbst hochgeladene Wappen traegt. '
        . 'Gemeldet wurde stattdessen: ' . (string) $gescheitert
);

$zeile = $db->prepare('SELECT territory_id FROM political_territory_geometry WHERE public_id = :pid');
$zeile->execute(['pid' => $FLAECHE]);
pruefe((int) $zeile->fetchColumn() === $baronieId, 'Die Flaeche liegt danach auf der Baronie.');

// 💣 Die zweite Haelfte, ohne die der Fix nur die Fehlermeldung wegnimmt: das Wappen muss
// ERHALTEN bleiben. Eine Lockerung, die den Wert danach still auf leer setzt, waere schlimmer
// als die Absage -- die sieht man wenigstens.
$nachher = $db->prepare('SELECT coat_of_arms_url FROM political_territory WHERE id = :id');
$nachher->execute(['id' => $grafschaftId]);
pruefe(
    (string) $nachher->fetchColumn() === '/uploads/wappen/own/grafschaft-wiallsburg.png',
    'Das hochgeladene Wappen des Vorfahren steht nach der Zuweisung unveraendert da.'
);

// ---- 3. Anlegen mit eigenem Wappen ------------------------------------------------------------
$angelegt = avesmapsPoliticalCreateTerritory($db, [
    'name' => 'Baronie Zweitwiallsburg',
    'type' => 'Baronie',
    'coat_of_arms_url' => $EIGENES,
], ['id' => 1]);

pruefe(
    (string) ($angelegt['territory']['coat_of_arms_url'] ?? '') === $EIGENES,
    'Ein neues Gebiet darf mit einem hochgeladenen Wappen angelegt werden, und meldet es zurueck.'
);

// 💣 Und der Blick in die Ablage, nicht nur in die Antwort: ein Schreiber, dessen Wert zaehlt,
// liest ihn zurueck (AGENTS.md §10, die stille MySQL-Kuerzung). Die zweite, mildere Pruefung
// avesmapsPoliticalIsLikelyCoatOfArmsUrl setzt einen unpassenden Link STILL auf leer -- ein
// Fix, der nur die Fehlermeldung wegnimmt, waere hier zu sehen.
$gespeichert = $db->prepare('SELECT coat_of_arms_url FROM political_territory WHERE public_id = :pid');
$gespeichert->execute(['pid' => (string) $angelegt['territory']['public_id']]);
pruefe(
    (string) $gespeichert->fetchColumn() === $EIGENES,
    'Und in der Ablage steht es auch -- nicht still auf leer gesetzt.'
);

// ---- 4. Die Vier-Erzeuger-Probe ---------------------------------------------------------------
// 💣 Eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel (AGENTS.md §9). Der
// Wappen-Link wird an acht Stellen in drei Dateien gelesen; keine davon darf noch an der reinen
// http-Regel haengen, sonst ist der Fall an der naechsten Stelle sofort wieder da.
$wurzel = dirname(__DIR__, 3);
$offen = [];
foreach ([
    '/_internal/political/assignment.php',
    '/_internal/political/territories-write.php',
    '/edit/political/display-overrides.php',
] as $datei) {
    $inhalt = (string) file_get_contents($wurzel . $datei);
    // Der Aufruf steht mal in einer Zeile, mal ueber drei -- deshalb ueber den ganzen Text.
    if (preg_match_all('/avesmapsPoliticalReadOptionalUrl\([^;]{0,200}?\'Der Wappen-Link\'/s', $inhalt, $treffer) > 0) {
        $offen[] = $datei . ' (' . count($treffer[0]) . 'x)';
    }
}

pruefe(
    $offen === [],
    'Jede Wappen-Stelle liest ueber avesmapsPoliticalReadOptionalCoatUrl. Offen: '
        . implode(', ', $offen)
);

echo "wappen-link-lokale-datei: {$checks} Zusicherungen gruen.\n";
