<?php

declare(strict_types=1);

/**
 * Die Außengrenze loest ihr Ziel ueber ZWEI Wege auf -- und nur einer traegt eigene Knoten.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/derived-target-eigener-knoten-test.php
 *
 * 💣 avesmapsPoliticalResolveDerivedGeometryTarget nimmt eine UUID direkt, alles andere sucht es
 * ausschliesslich in political_territory_wiki. Ein eigener Knoten hat dort keine Zeile (er lebt nur
 * im Modell und in political_territory) -- der Schluessel 'eigener-knoten:knotenNNN' loest also NICHT
 * auf, und der Quellen-Endpunkt gibt eine LEERE Antwort zurueck: keine Unterflaechen, source_mode
 * 'none', descendant_territory_count 0.
 *
 * ⚠️ Das ist keine theoretische Luecke, sondern der Grund fuer zwei Befunde vom 15.08.2026:
 * die Vorschau eines Unterknotens zeigte die Form des Knotens darueber (es kam nichts Neues, also
 * blieb das Alte stehen), und "Fuer alle Unterregionen uebernehmen" tat nichts (die Kaskade laeuft
 * die recompute_targets des Plans ab, und ohne aufgeloestes Ziel ist der Plan leer).
 *
 * 🔴 Der Editor schickte frueher eine UUID und faellt seit dem Breadcrumb-Fix auf den wiki_key
 * zurueck, weil die Modellbaum-Antwort keine public_id fuehrt. Deshalb steht unten BEIDES: dass der
 * wiki_key-Weg leer bleibt (das ist so und bleibt so) und dass der UUID-Weg traegt (das ist der Weg,
 * den der Editor wieder nehmen muss).
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../territories-derived-geometry-shared.php';
require_once __DIR__ . '/../territories-derived-geometry.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test wuerde stillschweigend bestehen\n");
    exit(1);
}

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT,
        color TEXT, opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT,
        min_zoom INTEGER, max_zoom INTEGER, valid_from_bf INTEGER, valid_to_bf INTEGER,
        valid_label TEXT, capital_place_id INTEGER, seat_place_id INTEGER,
        is_active INTEGER, editor_notes TEXT, sort_order INTEGER, short_name TEXT
    )'
);
$pdo->exec(
    'CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
        geometry_json TEXT, style_json TEXT, source TEXT, valid_from_bf INTEGER, valid_to_bf INTEGER,
        min_zoom INTEGER, max_zoom INTEGER, is_active INTEGER, label_center_json TEXT
    )'
);
$pdo->exec(
    'CREATE TABLE political_territory_wiki (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, type TEXT,
        affiliation_raw TEXT, affiliation_root TEXT, affiliation_path_json TEXT,
        founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT
    )'
);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT)');
$pdo->exec(
    'CREATE TABLE political_territory_claim (
        id INTEGER PRIMARY KEY AUTOINCREMENT, territory_id INTEGER, claimant_territory_id INTEGER,
        is_active INTEGER, sort_order INTEGER
    )'
);

// Ordoreum (eigener Knoten) mit einem Kind -- so steht Kemi live.
$ORDOREUM = '11111111-1111-4111-8111-111111111111';
$KIND     = '22222222-2222-4222-8222-222222222222';
$neu = $pdo->prepare(
    'INSERT INTO political_territory (public_id, wiki_id, wiki_key, slug, name, type, parent_id,
        continent, color, opacity, min_zoom, max_zoom, is_active, sort_order)
     VALUES (:pid, NULL, :wk, :slug, :name, "Herrschaftsgebiet", :parent,
        "Aventurien", "#806040", 0.5, 0, 6, 1, 1)'
);
$neu->execute(['pid' => $ORDOREUM, 'wk' => 'eigener-knoten:knoten078', 'slug' => 'ordoreum', 'name' => 'Ordoreum', 'parent' => null]);
$ordoreumId = (int) $pdo->lastInsertId();
$neu->execute(['pid' => $KIND, 'wk' => 'eigener-knoten:knoten087', 'slug' => 'ahami-t-heken', 'name' => 'Ahami Táheken', 'parent' => $ordoreumId]);
$kindId = (int) $pdo->lastInsertId();

$geo = $pdo->prepare(
    'INSERT INTO political_territory_geometry (public_id, territory_id, geometry_json, style_json, is_active)
     VALUES (:pid, :tid, :geom, "{}", 1)'
);
$viereck = json_encode(['type' => 'Polygon', 'coordinates' => [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]]);
$geo->execute(['pid' => '33333333-3333-4333-8333-333333333333', 'tid' => $ordoreumId, 'geom' => $viereck]);
$geo->execute(['pid' => '44444444-4444-4444-8444-444444444444', 'tid' => $kindId, 'geom' => $viereck]);

// ---- Messung 1: der wiki_key eines eigenen Knotens loest NICHT auf ------------------------------
$ziel = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, ['target_key' => 'eigener-knoten:knoten078'], false);
pruefe(($ziel['territory'] ?? null) === null, 'Der wiki_key eines eigenen Knotens loest kein Gebiet auf.');
pruefe(($ziel['wiki'] ?? null) === null, 'Und auch keine Wiki-Zeile -- es gibt keine.');

$leer = avesmapsPoliticalReadDerivedGeometrySources($pdo, ['target_key' => 'eigener-knoten:knoten078']);
pruefe($leer['source_count'] === 0, 'Der Quellen-Endpunkt liefert dann NICHTS -- das war der stehengebliebene Vorschau-Befund.');
pruefe($leer['source_mode'] === 'none', 'source_mode "none".');
pruefe($leer['descendant_territory_count'] === 0, 'und keine Nachfahren -- damit faellt auch die Kaskade leer aus.');
pruefe((string) $leer['territory_public_id'] === '', 'ohne aufgeloestes Gebiet auch keine public_id fuer den Speicherweg.');

// ---- Messung 2: ueber die UUID traegt derselbe Knoten ------------------------------------------
// 🔴 Das ist der Weg, den der Editor vor dem Breadcrumb-Fix genommen hat und wieder nehmen muss.
$ueberUuid = avesmapsPoliticalReadDerivedGeometrySources($pdo, ['target_key' => $ORDOREUM]);
pruefe($ueberUuid['source_count'] === 2, 'Ueber die UUID kommen eigene Flaeche + Kind zusammen.');
pruefe($ueberUuid['source_mode'] === 'descendants', 'source_mode "descendants".');
pruefe($ueberUuid['descendant_territory_count'] === 1, 'ein Nachfahr -- die Kaskade haette etwas zu tun.');
pruefe((string) $ueberUuid['territory_public_id'] === $ORDOREUM, 'und der Speicherweg bekommt seine public_id.');

// Und das Blatt liefert ueber seine UUID SEINE Flaeche, nicht die des Elterngebiets.
$blatt = avesmapsPoliticalReadDerivedGeometrySources($pdo, ['target_key' => $KIND]);
pruefe($blatt['source_count'] === 1, 'Das Blatt bringt genau seine eigene Flaeche mit.');
pruefe($blatt['source_mode'] === 'target_territory', 'source_mode "target_territory" -- Blatt ohne Nachfahren.');
pruefe($blatt['descendant_territory_count'] === 0, 'und keine Nachfahren.');
pruefe(
    (string) $blatt['territory_public_id'] === $KIND,
    'Vor allem: es ist SEINE Antwort, nicht die des Knotens darueber.'
);

echo "derived-target-eigener-knoten: {$checks} Zusicherungen gruen.\n";
