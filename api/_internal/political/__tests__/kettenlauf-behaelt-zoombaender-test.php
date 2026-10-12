<?php

declare(strict_types=1);

/**
 * Der Kettenlauf darf das Zoom-Band eines BESTEHENDEN Gebiets nicht ueberschreiben.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/kettenlauf-behaelt-zoombaender-test.php
 *
 * 💣 DER FALL, den es live gab (gemeldet 12.10.2026): Nordmarken, Kosch und die Baronien darunter
 * "sind ploetzlich Kinder vom Heiligen Neuen Kaiserreich" -- die HIERARCHIE war aber unveraendert
 * (in den Backups vom 18.08., 04.09. und 08.09.2026 byte-identisch dieselbe). Verschoben hatten
 * sich die ZOOM-BAENDER, und damit das Bild: das Reich zeigte bei Zoom 2 noch an, waehrend 15 seiner
 * 17 Kinder schon anzeigten -> die Fuell-Logik (suppressFillForDisplayingChild) nahm die
 * Reichsfuellung zurueck, aber Kosch und Alt-Gareth fehlten noch = Loecher.
 *
 * Gemessen am 12.10.2026 (Dump gegen die oeffentlichen Endpunkte):
 *
 *     Gebiet                        Dump (Aug/Sep)   live
 *     Heiliges Neues Kaiserreich    0-1              0-2     <- genau Regel C, index 0
 *     Fuerstentum Kosch             2-2              ab 3
 *     Grafschaft Huegellande        3-3              4-4
 *     Herzogtum Nordmarken          2-2              2-2      (unveraendert, nicht in der Kette)
 *
 * 🔴 DIE URSACHE: avesmapsPoliticalEnsureWikiTerritoryChain schrieb
 * avesmapsPoliticalDefaultAssignmentZoomRange() per UPDATE auf JEDEN Knoten der Kette -- egal ob
 * der Knoten gerade angelegt wurde oder seit Monaten ein gepflegtes Band trug. Ein Speichern
 * irgendwo unter dem Reich bestempelte damit die ganze Ahnenkette neu. Dass die Baender des Hauses
 * nach Regel A gestaffelt sind (0-1 / 2-2 / 3-3 / 4-6), die Serverregel aber groeber ist
 * (0-2 / 3-4 / ...), machte aus dem Ueberschreiben eine sichtbare Verschiebung.
 *
 * 🪤 Warum es durchgerutscht ist: gemischte-kette-zuweisung-test.php sichert woertlich zu, dass
 * "das Reich sein Zoom-Band behaelt" -- aber nur fuer eine auf die Wurzel GEKUERZTE Kette, wo der
 * Wiki-Zweig gar nicht laeuft. Sobald die Wiki-Kette vollstaendig ist (der Normalfall, wenn jeder
 * Knoten eine Wiki-Zeile hat -- Kosch, Huegellande und Koschgau haben alle eine), lief der
 * Ueberschreiber durch. Ein Schutz, der nur den umgangenen Zweig deckt, ist kein Schutz.
 * Die Warnung stand seit dem 09.08.2026 in den Projektnotizen, ausdruecklich als NICHT an einer
 * echten Zuweisung nachgeprueft. Heute ist sie nachgeprueft -- durch den Schaden.
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../territories-layer.php';
require_once __DIR__ . '/../territories-write.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

$REICH      = '11111111-1111-4111-8111-111111111111';
$KOSCH      = '22222222-2222-4222-8222-222222222222';
$HUEGEL     = '33333333-3333-4333-8333-333333333333';
$KOSCHGAU   = '44444444-4444-4444-8444-444444444444';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT,
        status TEXT, color TEXT, opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT,
        min_zoom INTEGER, max_zoom INTEGER, capital_place_id INTEGER, seat_place_id INTEGER,
        valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT, editor_notes TEXT,
        sort_order INTEGER, is_active INTEGER, created_at TEXT, updated_at TEXT
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
    // ⚠️ Die vier Spalten hinter seat_name braucht die NEUANLAGE (avesmapsPoliticalCreateTerritoryFromWiki
    // liest sie aus dem Wiki-Datensatz) -- ohne sie laeuft die Gegenprobe unten in PHP-Warnungen.
    'CREATE TABLE political_territory_wiki (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, type TEXT,
        affiliation_raw TEXT, affiliation_root TEXT, affiliation_path_json TEXT,
        founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT,
        continent TEXT, status TEXT, coat_of_arms_url TEXT, wiki_url TEXT
    )'
);
$db->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT)');

// ---- Fixture: die ECHTE Kosch-Kette, wie sie live steht ---------------------------------------
// 🔴 Produktionsform: JEDER dieser vier Knoten hat eine Wiki-Zeile (live nachgesehen -- genau
// deshalb laeuft der Wiki-Zweig vollstaendig durch und der Schutz der gekuerzten Kette greift nie).
$wikiNeu = $db->prepare('INSERT INTO political_territory_wiki (wiki_key, name, type) VALUES (:wk, :name, :typ)');
$wikiIds = [];
foreach ([
    ['wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth', 'Heiliges Neues Kaiserreich vom Greifenthron zu Gareth', 'Kaiserreich'],
    ['wiki:f-rstentum-kosch', 'Fürstentum Kosch', 'Fürstentum'],
    ['wiki:grafschaft-h-gellande', 'Grafschaft Hügellande', 'Grafschaft'],
    ['wiki:pfalzgrafschaft-koschgau', 'Pfalzgrafschaft Koschgau', 'Pfalzgrafschaft'],
] as [$wk, $name, $typ]) {
    $wikiNeu->execute(['wk' => $wk, 'name' => $name, 'typ' => $typ]);
    $wikiIds[$wk] = (int) $db->lastInsertId();
}

$neu = $db->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        color, opacity, min_zoom, max_zoom, is_active)
     VALUES (:pid, :wiki_id, :wk, :slug, :name, :typ, :parent, "#ab5f8e", 0.7, :zmin, :zmax, 1)'
);

// Die Baender sind die aus dem Backup vom 08.09.2026 -- Regel A, lueckenlos gestaffelt.
$neu->execute(['pid' => $REICH, 'wiki_id' => $wikiIds['wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth'],
    'wk' => 'wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth', 'slug' => 'heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth',
    'name' => 'Heiliges Neues Kaiserreich vom Greifenthron zu Gareth', 'typ' => 'Kaiserreich',
    'parent' => null, 'zmin' => 0, 'zmax' => 1]);
$reichId = (int) $db->lastInsertId();

$neu->execute(['pid' => $KOSCH, 'wiki_id' => $wikiIds['wiki:f-rstentum-kosch'],
    'wk' => 'wiki:f-rstentum-kosch', 'slug' => 'f-rstentum-kosch', 'name' => 'Fürstentum Kosch',
    'typ' => 'Fürstentum', 'parent' => $reichId, 'zmin' => 2, 'zmax' => 2]);
$koschId = (int) $db->lastInsertId();

$neu->execute(['pid' => $HUEGEL, 'wiki_id' => $wikiIds['wiki:grafschaft-h-gellande'],
    'wk' => 'wiki:grafschaft-h-gellande', 'slug' => 'grafschaft-h-gellande', 'name' => 'Grafschaft Hügellande',
    'typ' => 'Grafschaft', 'parent' => $koschId, 'zmin' => 3, 'zmax' => 3]);
$huegelId = (int) $db->lastInsertId();

$neu->execute(['pid' => $KOSCHGAU, 'wiki_id' => $wikiIds['wiki:pfalzgrafschaft-koschgau'],
    'wk' => 'wiki:pfalzgrafschaft-koschgau', 'slug' => 'pfalzgrafschaft-koschgau', 'name' => 'Pfalzgrafschaft Koschgau',
    'typ' => 'Pfalzgrafschaft', 'parent' => $huegelId, 'zmin' => 4, 'zmax' => 6]);
$koschgauId = (int) $db->lastInsertId();

$bandVon = static function (PDO $db, int $id): array {
    $s = $db->prepare('SELECT min_zoom, max_zoom FROM political_territory WHERE id = :id');
    $s->execute(['id' => $id]);
    $r = $s->fetch(PDO::FETCH_ASSOC) ?: [];
    return [(int) ($r['min_zoom'] ?? -1), (int) ($r['max_zoom'] ?? -1)];
};

// Gegenprobe der Fixture selbst -- ohne sie bewiese der Test unten nichts.
pruefe($bandVon($db, $reichId) === [0, 1], 'Fixture: das Reich startet auf 0-1.');
pruefe($bandVon($db, $koschId) === [2, 2], 'Fixture: Kosch startet auf 2-2.');
pruefe($bandVon($db, $huegelId) === [3, 3], 'Fixture: Huegellande startet auf 3-3.');
pruefe($bandVon($db, $koschgauId) === [4, 6], 'Fixture: Koschgau startet auf 4-6.');

// ---- Der Ablauf: ein Speichern an der TIEFSTEN Ebene ------------------------------------------
// Genau das, was der Editor schickt, wenn jemand Koschgau eine Flaeche zuweist: die vollstaendige
// Wiki-Kette von der Wurzel bis zum bearbeiteten Knoten.
$antwort = avesmapsPoliticalEnsureWikiTerritoryChain($db, [
    'wiki_public_ids' => [
        'wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth',
        'wiki:f-rstentum-kosch',
        'wiki:grafschaft-h-gellande',
        'wiki:pfalzgrafschaft-koschgau',
    ],
], ['id' => 1]);

pruefe(count($antwort['chain'] ?? []) === 4, 'Die Antwort meldet alle vier Glieder zurueck.');

// 🔴 DIE Zusicherungen. Vor dem Fix steht hier Regel C: 0-2 / 3-4 / 5-5 / 6-6.
pruefe(
    $bandVon($db, $reichId) === [0, 1],
    'Das Reich behaelt 0-1 -- ein Speichern an einem Nachfahren darf sein Band nicht aufreissen.'
);
pruefe(
    $bandVon($db, $koschId) === [2, 2],
    'Kosch behaelt 2-2 -- sonst verschwindet es bei Zoom 2, wo seine 15 Geschwister anzeigen.'
);
pruefe(
    $bandVon($db, $huegelId) === [3, 3],
    'Huegellande behaelt 3-3.'
);
pruefe(
    $bandVon($db, $koschgauId) === [4, 6],
    'Und auch der bearbeitete Knoten selbst behaelt sein gepflegtes Band.'
);

// ---- Die Gegenprobe: ein Knoten OHNE Band muss weiterhin einen bekommen -----------------------
// ⚠️ Ohne diese Haelfte wuerde der Fix "schreib nie ein Band" lauten, und ein bandloses Gebiet
// stuende auf JEDER Zoomstufe (der Layer liest geometry.min_zoom ?? territory.min_zoom -- NULL
// heisst "keine Grenze").
// 🔴 Der Fall ist ein EIGENER KNOTEN: avesmapsPoliticalEnsureSyntheticTreeTerritory legt seine
// Zeile ausdruecklich mit "NULL, NULL" fuer min_zoom/max_zoom an (es gibt keine Wiki-Zeile, aus
// deren Typ ein Band abgeleitet werden koennte). Genau fuer ihn ist das Vorgabeband der Kette da.
// 🪤 Die erste Fassung dieser Gegenprobe nahm einen Knoten MIT Wiki-Zeile -- und war ein VAKUUM:
// avesmapsPoliticalCreateTerritoryFromWiki setzt dort schon das TYP-Band (Regel D, Baronie 4-6),
// der Test blieb also gruen, als der Riegel per Mutation auf "immer true" gestellt wurde. Gefangen
// hat das erst die Mutationsprobe, nicht das Lesen.
$EIGENER = 'wiki:eigener-knoten-ohne-wikizeile';

$antwortNeu = avesmapsPoliticalEnsureWikiTerritoryChain($db, [
    'wiki_public_ids' => [
        'wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth',
        'wiki:f-rstentum-kosch',
        'wiki:grafschaft-h-gellande',
        $EIGENER,
    ],
    'wiki_nodes' => [
        ['name' => 'Heiliges Neues Kaiserreich vom Greifenthron zu Gareth'],
        ['name' => 'Fürstentum Kosch'],
        ['name' => 'Grafschaft Hügellande'],
        ['name' => 'Baronie Eisenhütt', 'type' => 'Baronie'],
    ],
], ['id' => 1]);

$neuerKnoten = $db->prepare('SELECT id, min_zoom, max_zoom FROM political_territory WHERE wiki_key = :wk');
$neuerKnoten->execute(['wk' => $EIGENER]);
$neueZeile = $neuerKnoten->fetch(PDO::FETCH_ASSOC);

pruefe($neueZeile !== false, 'Der eigene Knoten wird angelegt.');
pruefe(
    $neueZeile['min_zoom'] !== null && $neueZeile['max_zoom'] !== null,
    'Ein Knoten OHNE Band bekommt das Vorgabeband der Kette -- sonst stuende er auf jedem Zoom.'
);

// Und die drei Vorfahren hat auch dieser zweite Lauf nicht angefasst.
pruefe($bandVon($db, $reichId) === [0, 1], 'Auch der zweite Lauf laesst das Reich auf 0-1.');
pruefe($bandVon($db, $koschId) === [2, 2], 'Auch der zweite Lauf laesst Kosch auf 2-2.');
pruefe($bandVon($db, $huegelId) === [3, 3], 'Auch der zweite Lauf laesst Huegellande auf 3-3.');

echo "kettenlauf-behaelt-zoombaender: {$checks} Zusicherungen gruen.\n";
