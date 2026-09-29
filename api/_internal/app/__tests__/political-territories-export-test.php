<?php

declare(strict_types=1);

/**
 * Der oeffentliche Gebiets-Export -- GET /api/app/political-territories-export.php und seine Bibliothek
 * api/_internal/app/political-territories-export.php (Auftrag von Avesmaps3D, 29.09.2026, WI-0062).
 *
 * Was der Auftrag verlangt, und wo es hier geprueft wird:
 *   1. Dieselben Gebiete und Flaechen wie die Editor-Aktionen `list` und `geometries`   -> Abschnitt B
 *   2. Ohne Sitzung, ohne Schreibwirkung                                              -> Abschnitt G
 *   3. Die Revisionsstempel stehen oben und beschreiben die Daten darunter            -> Abschnitte E, F
 *   4. Kein Feld traegt Editornotizen oder Personendaten                              -> Abschnitte A, C
 *   5. Wappen nur hinter dem Lizenz-Gate und den zwei Schaltern                       -> Abschnitt D
 *
 * 💣 ABSCHNITT A IST DIE POSITIVLISTE. Ein Feld, das kuenftig an `avesmapsPoliticalTerritoryRowToPublic`
 * oder `avesmapsPoliticalGeometryRowToPublic` haengt, geht NICHT still an die Oeffentlichkeit: der Test
 * wird rot, bis jemand entschieden hat -- oeffentlich (in die Liste der Bibliothek) oder nicht (hier in
 * die Ausnahmeliste, mit Grund).
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/political-territories-export-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere hier wirkungslos und die Probe meldete falsche Erfolge.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/political/territories-lese-riegel.php';
require_once $wurzel . '/api/_internal/app/political-territories-export.php';

$endpunktDatei = $wurzel . '/api/app/political-territories-export.php';
$bibliothekDatei = $wurzel . '/api/_internal/app/political-territories-export.php';

// ---- Helfer ------------------------------------------------------------------------------------

// Quelltext ohne Kommentare, mit dem TOKENIZER (nie zwei preg_replace: ein `/*` in einem Zeilenkommentar
// fraesse sonst echten Code bis zum naechsten `*/`, AGENTS.md §11).
function exportTestOhneKommentare(string $quelle): string
{
    $aus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $aus .= is_array($token) ? $token[1] : $token;
    }

    return $aus;
}

function exportTestNachOeffentlichId(array $zeilen): array
{
    $ergebnis = [];
    foreach ($zeilen as $zeile) {
        $ergebnis[(string) $zeile['public_id']] = $zeile;
    }

    return $ergebnis;
}

// ---- Fixture -----------------------------------------------------------------------------------

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, wiki_key TEXT, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT, color TEXT, opacity REAL,
    coat_of_arms_url TEXT, wiki_url TEXT, capital_place_id INTEGER, seat_place_id INTEGER,
    valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT, min_zoom INTEGER, max_zoom INTEGER,
    is_active INTEGER, editor_notes TEXT, sort_order INTEGER, updated_at TEXT
)');
$pdo->exec('CREATE TABLE political_territory_wiki (
    id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, type TEXT, affiliation_raw TEXT, affiliation_root TEXT,
    affiliation_path_json TEXT, founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT, synced_at TEXT
)');
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, geometry_geojson TEXT,
    valid_from_bf INTEGER, valid_to_bf INTEGER, min_zoom INTEGER, max_zoom INTEGER,
    source TEXT, style_json TEXT, is_active INTEGER, created_by INTEGER, updated_at TEXT
)');
$pdo->exec('CREATE TABLE political_territory_claim (
    id INTEGER PRIMARY KEY, territory_id INTEGER, claimant_territory_id INTEGER, sort_order INTEGER,
    source TEXT, claimant_wiki_key TEXT, is_active INTEGER, created_by INTEGER, updated_at TEXT
)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (
    wiki_key TEXT, coat_of_arms_url TEXT, coat_of_arms_license_status TEXT
)');
$pdo->exec('CREATE TABLE wiki_territory_model (wiki_key TEXT, metadata_overrides_json TEXT)');

// Ort 2 ist DEAKTIVIERT und trotzdem der Sitz der Grafschaft: ein haengender Verweis, den der Export nennt statt zu glaetten (H4).
$pdo->exec("INSERT INTO map_features (id, public_id, is_active) VALUES (1, 'ort-1', 1), (2, 'ort-2', 0)");
$pdo->exec("INSERT INTO map_revision (id, revision) VALUES (1, 4711)");
$pdo->exec("INSERT INTO political_territory_wiki (id, wiki_key, name, type, dissolved_text, synced_at)
    VALUES (1, 'wiki:reich', 'Reich (Wiki)', 'Kaiserreich', 'besteht', '2026-08-30 10:00:00.000')");

//  1 Wurzel mit Wiki-Zeile, Editornotiz und Wiki-Wappen (public_domain).
//  2 Grafschaft unter 1, Hauptstadt = Ort 1, Sitz = Ort 2.
//  3 Papierkorb (is_active = 0), traegt trotzdem eine aktive Flaeche.
//  4 Anderer Kontinent -- gehoert nicht in den Export (wie `list`, das auf Aventurien filtert).
//  5 Baronie unter dem INAKTIVEN Gebiet 3 (haengender Elter), eigenes Wappen mit Lizenz per Override.
//  6 Wiki-Wappen unter einer Lizenz, die nicht oeffentlich sein darf.
//  7 EIGENES Wappen (Upload) ohne jede Lizenzangabe -- das Gate gilt auch fuer „von uns“ (D14).
$pdo->exec("INSERT INTO political_territory
    (id, public_id, wiki_id, wiki_key, slug, name, short_name, type, parent_id, continent, status, color, opacity,
     coat_of_arms_url, wiki_url, capital_place_id, seat_place_id, valid_from_bf, valid_to_bf, valid_label,
     min_zoom, max_zoom, is_active, editor_notes, sort_order, updated_at) VALUES
    (1, 'p-reich', 1, 'wiki:reich', 'reich', 'Reich', 'R', 'Kaiserreich', NULL, 'Aventurien', 'besteht', '#aa0000', 0.4,
     '', 'https://wiki.example/Reich', NULL, NULL, 800, 0, '800 BF bis heute', 0, 6, 1, 'GEHEIM-NOTIZ-REICH', 1, '2026-09-01 10:00:00.000'),
    (2, 'p-graf', NULL, 'wiki:graf', 'graf', 'Grafschaft', '', 'Grafschaft', 1, 'Aventurien', '', '#00aa00', 0.3,
     '', '', 1, 2, 900, 1049, '', 2, 5, 1, 'GEHEIM-NOTIZ-GRAF', 2, '2026-09-02 10:00:00.000'),
    (3, 'p-korb', NULL, 'wiki:korb', 'korb', 'Papierkorb', '', 'Baronie', 1, 'Aventurien', '', '#0000aa', 0.3,
     '', '', NULL, NULL, NULL, NULL, '', NULL, NULL, 0, 'GEHEIM-NOTIZ-KORB', 3, '2026-09-03 10:00:00.000'),
    (4, 'p-myr', NULL, 'wiki:myr', 'myr', 'Myranor-Reich', '', 'Reich', NULL, 'Myranor', '', '#aaaa00', 0.3,
     '', '', NULL, NULL, NULL, NULL, '', NULL, NULL, 1, '', 4, '2026-09-04 10:00:00.000'),
    (5, 'p-baron', NULL, 'wiki:baron', 'baron', 'Baronie', '', 'Baronie', 3, 'Aventurien', '', '#aa00aa', 0.3,
     '/uploads/wappen/eigen.png', '', NULL, NULL, NULL, NULL, '', NULL, NULL, 1, '', 5, '2026-09-05 10:00:00.000'),
    (6, 'p-fremd', NULL, 'wiki:fremd', 'fremd', 'Fremdwappen', '', 'Herzogtum', 1, 'Aventurien', '', '#00aaaa', 0.3,
     '', '', NULL, NULL, NULL, NULL, '', NULL, NULL, 1, '', 6, '2026-09-06 10:00:00.000'),
    (7, 'p-ohnelizenz', NULL, 'wiki:ohnelizenz', 'ohnelizenz', 'Ohne Lizenz', '', 'Baronie', 1, 'Aventurien', '', '#123456', 0.3,
     '/uploads/wappen/ohnelizenz.png', '', NULL, NULL, NULL, NULL, '', NULL, NULL, 1, '', 7, '2026-09-07 10:00:00.000')");
$pdo->exec("INSERT INTO political_territory_wiki_test (wiki_key, coat_of_arms_url, coat_of_arms_license_status) VALUES
    ('wiki:reich', '/uploads/wappen/reich.png', 'public_domain'),
    ('wiki:fremd', '/uploads/wappen/fremd.png', 'unknown_other')");
$pdo->exec("INSERT INTO wiki_territory_model (wiki_key, metadata_overrides_json) VALUES
    ('wiki:baron', '{\"coat_of_arms_license_status\":\"own_work\"}')");

$vierEck = '{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}';
$vierEckMitNotiz = '{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]],"properties":{"notiz":"GEHEIM-GEOJSON"}}';
$mehrTeilig = '{"type":"MultiPolygon","coordinates":[[[[20,20],[30,20],[30,30],[20,30],[20,20]]],[[[40,40],[50,40],[50,50],[40,50],[40,40]]]]}';
$pdo->exec("INSERT INTO political_territory_geometry
    (id, public_id, territory_id, geometry_geojson, valid_from_bf, valid_to_bf, min_zoom, max_zoom, source, style_json, is_active, created_by, updated_at) VALUES
    (1, 'g-reich',  1,    '{$vierEckMitNotiz}',    NULL, NULL, NULL, NULL, 'GEHEIM-QUELLE', '{\"fill\":\"#aa0000\",\"coatOfArmsUrl\":\"https://GEHEIM-STIL.example/x.png\"}', 1, 7734912, '2026-09-01 11:00:00.000'),
    (2, 'g-graf',   2,    '{$mehrTeilig}', 900, 1049, 2, 5, '', NULL, 1, 7734912, '2026-09-02 11:00:00.000'),
    (3, 'g-alt',    2,    '{$vierEck}',    NULL, NULL, NULL, NULL, '', NULL, 0, 7734912, '2026-09-02 12:00:00.000'),
    (4, 'g-korb',   3,    '{$vierEck}',    NULL, NULL, NULL, NULL, '', NULL, 1, 7734912, '2026-09-03 11:00:00.000'),
    (5, 'g-waise',  NULL, '{$vierEck}',    NULL, NULL, NULL, NULL, '', NULL, 1, 7734912, '2026-09-04 11:00:00.000'),
    (6, 'g-myr',    4,    '{$vierEck}',    NULL, NULL, NULL, NULL, '', NULL, 1, 7734912, '2026-09-04 12:00:00.000'),
    (7, 'g-kaputt', 5,    '{kaputt',       NULL, NULL, NULL, NULL, '', NULL, 1, 7734912, '2026-09-05 11:00:00.000')");

//  1 aktiv: 2 wird von 5 beansprucht.        2 inaktiv.
//  3 Anspruchsteller ist das Papierkorb-Gebiet 3.   4 Anspruchsteller liegt auf einem anderen Kontinent.
$pdo->exec("INSERT INTO political_territory_claim
    (id, territory_id, claimant_territory_id, sort_order, source, claimant_wiki_key, is_active, created_by, updated_at) VALUES
    (1, 2, 5, 1, 'manual', 'wiki:baron', 1, 7734912, '2026-09-07 10:00:00.000'),
    (2, 2, 1, 2, 'manual', 'wiki:reich', 0, 7734912, '2026-09-07 11:00:00.000'),
    (3, 2, 3, 3, 'manual', 'wiki:korb',  1, 7734912, '2026-09-07 12:00:00.000'),
    (4, 2, 4, 4, 'manual', 'wiki:myr',   1, 7734912, '2026-09-07 13:00:00.000')");

// =====================================================================================================
// A. DIE POSITIVLISTE -- kein Feld geht still hinaus
// =====================================================================================================
$gebietsZeile = $pdo->query("SELECT territory.*, NULL AS parent_public_id FROM political_territory territory WHERE id = 1")
    ->fetch(PDO::FETCH_ASSOC);
$gebietsSchluessel = array_keys(avesmapsPoliticalTerritoryRowToPublic($gebietsZeile));

// Was `list` baut, aber NICHT an die Oeffentlichkeit geht -- mit Grund. Kommt an `list` ein neues Feld
// dazu, steht es in keiner der zwei Listen, und diese Zusicherung wird rot.
$gebietAusgenommen = [
    'id' => 'interne Zahlen-ID (die Kennung ist public_id)',
    'wiki_id' => 'interne Zahlen-ID',
    'slug' => 'keine Vorgabe des Auftrags, abgeleitet aus dem Namen',
    'parent_id' => 'interne Zahlen-ID (die Kennung ist parent_public_id)',
    'parent_name' => 'Redundanz zu parent_public_id',
    'continent' => 'der Export gilt einem Kontinent (Aventurien, wie `list`)',
    'coat_of_arms_url' => '💣 ROH -- am Lizenz-Gate und am Schalter vorbei; ersetzt durch das gepruefte Feld gleichen Namens',
    'is_active' => 'der Export enthaelt nur aktive Gebiete, das Feld waere immer true',
    'editor_notes' => '🔴 Editornotizen (Auftrag: kein Feld traegt sie)',
    'wiki_name' => 'Wiki-Rohtext',
    'wiki_affiliation_raw' => 'Wiki-Rohtext',
    'wiki_affiliation_root' => 'Wiki-Rohtext',
    'wiki_affiliation_path' => 'Wiki-Rohtext',
    'wiki_founded_text' => 'Wiki-Rohtext',
    'wiki_dissolved_text' => 'Wiki-Rohtext',
    'wiki_capital_name' => 'Wiki-Rohtext (verlangt ist die Kennung des Ortes)',
    'wiki_seat_name' => 'Wiki-Rohtext (verlangt ist die Kennung des Ortes)',
];
foreach ($gebietsSchluessel as $schluessel) {
    assert(
        in_array($schluessel, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS, true)
        || array_key_exists($schluessel, $gebietAusgenommen),
        "A1: das Gebietsfeld '{$schluessel}' steht weder in der Positivliste noch in der Ausnahmeliste -- "
        . 'jemand muss entscheiden, ob es oeffentlich sein darf'
    );
}
foreach (array_keys($gebietAusgenommen) as $schluessel) {
    assert(in_array($schluessel, $gebietsSchluessel, true), "A2: die Ausnahme '{$schluessel}' gibt es an `list` nicht mehr -- aus der Liste streichen");
}
foreach (AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS as $feld) {
    assert(
        in_array($feld, $gebietsSchluessel, true) || $feld === 'updated_at',
        "A3: das freigegebene Feld '{$feld}' baut `list` nicht -- es gibt an der Quelle nichts, was hier hinausgehen koennte"
    );
}
foreach (['editor_notes', 'coat_of_arms_url', 'id', 'parent_id'] as $verboten) {
    assert(
        !in_array($verboten, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS, true),
        "A4: '{$verboten}' darf nie in der Gebiets-Positivliste stehen"
    );
}

$flaechenZeile = $pdo->query('SELECT g.*, 1 AS is_active_dummy FROM political_territory_geometry g WHERE id = 1')
    ->fetch(PDO::FETCH_ASSOC);
$flaechenSchluessel = array_keys(avesmapsPoliticalGeometryRowToPublic($flaechenZeile));
$flaecheAusgenommen = [
    'id' => 'interne Zahlen-ID',
    'territory_id' => 'interne Zahlen-ID (die Kennung ist territory_public_id)',
    'source' => 'freier Text der Editoren, kein Auftragsfeld',
    'style' => '💣 kann Wappen-Adressen und Anzeigezuweisungen tragen, am Lizenz-Gate vorbei',
    'is_active' => 'der Export enthaelt nur aktive Flaechen',
];
foreach ($flaechenSchluessel as $schluessel) {
    assert(
        in_array($schluessel, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_GEOMETRY_FIELDS, true)
        || array_key_exists($schluessel, $flaecheAusgenommen),
        "A5: das Flaechenfeld '{$schluessel}' steht weder in der Positivliste noch in der Ausnahmeliste"
    );
}
foreach (AVESMAPS_POLITICAL_TERRITORIES_EXPORT_GEOMETRY_FIELDS as $feld) {
    assert(
        in_array($feld, $flaechenSchluessel, true) || in_array($feld, ['territory_public_id', 'updated_at'], true),
        "A6: das freigegebene Flaechenfeld '{$feld}' baut `avesmapsPoliticalGeometryRowToPublic` nicht"
    );
}
foreach (['style', 'source', 'id', 'territory_id'] as $verboten) {
    assert(
        !in_array($verboten, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_GEOMETRY_FIELDS, true),
        "A7: '{$verboten}' darf nie in der Flaechen-Positivliste stehen"
    );
}
foreach (AVESMAPS_POLITICAL_TERRITORIES_EXPORT_CLAIM_FIELDS as $feld) {
    assert(
        !in_array($feld, ['created_by', 'updated_by', 'id', 'claimant_wiki_key'], true),
        "A8: der Anspruchs-Schluessel '{$feld}' traegt Personen- oder interne Daten"
    );
}

// =====================================================================================================
// B. DIESELBEN GEBIETE UND FLAECHEN WIE `list` UND `geometries`
// =====================================================================================================
$gebiete = avesmapsPoliticalTerritoriesExportGebiete($pdo, true, true);
$flaechen = avesmapsPoliticalTerritoriesExportFlaechen($pdo);
$ansprueche = avesmapsPoliticalTerritoriesExportAnsprueche($pdo);

$liste = avesmapsPoliticalListTerritories($pdo, []);
$aktiveInList = array_values(array_filter($liste['territories'], static fn(array $t): bool => $t['is_active'] === true));
$idsList = array_column($aktiveInList, 'public_id');
$idsExport = array_column($gebiete, 'public_id');
sort($idsList);
$idsSortiert = $idsExport;
sort($idsSortiert);
assert($idsList === $idsSortiert, 'B1: der Export liefert genau die aktiven Gebiete von `list` -- list: '
    . implode(',', $idsList) . ' / Export: ' . implode(',', $idsSortiert));
assert(!in_array('p-korb', $idsExport, true), 'B2: das Papierkorb-Gebiet gehoert nicht in den oeffentlichen Export');
assert(!in_array('p-myr', $idsExport, true), 'B3: ein Gebiet eines anderen Kontinents gehoert nicht in den Export');

$exportNachId = exportTestNachOeffentlichId($gebiete);
foreach ($aktiveInList as $aus) {
    $eins = $exportNachId[$aus['public_id']];
    foreach (AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS as $feld) {
        if (!array_key_exists($feld, $aus)) {
            continue; // updated_at: baut `list` nicht
        }
        $erwartet = $aus[$feld];
        if (in_array($feld, ['parent_public_id', 'capital_place_public_id', 'seat_place_public_id'], true) && $erwartet === '') {
            $erwartet = null; // „gibt es nicht" heisst im Export null, nicht ''
        }
        assert($eins[$feld] === $erwartet, "B4: Feld '{$feld}' von {$aus['public_id']} weicht von `list` ab: "
            . var_export($eins[$feld], true) . ' gegen ' . var_export($erwartet, true));
    }
}

// Flaechen: dieselben wie `avesmapsPoliticalFetchGeometryRowsForTerritory` je aktives Gebiet.
$erwarteteFlaechen = [];
foreach ($aktiveInList as $gebiet) {
    foreach (avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $gebiet['id']) as $zeile) {
        $erwarteteFlaechen[(string) $zeile['public_id']] = avesmapsPoliticalGeometryRowToPublic($zeile);
    }
}
$flaechenIds = array_column($flaechen, 'public_id');
$erwarteteIds = array_keys($erwarteteFlaechen);
sort($flaechenIds);
sort($erwarteteIds);
assert($flaechenIds === $erwarteteIds, 'B5: der Export liefert genau die aktiven Flaechen aktiver Gebiete -- erwartet '
    . implode(',', $erwarteteIds) . ' / Export ' . implode(',', $flaechenIds));
foreach (['g-alt', 'g-korb', 'g-waise', 'g-myr'] as $nicht) {
    assert(!in_array($nicht, $flaechenIds, true), "B6: die Flaeche {$nicht} gehoert nicht in den Export");
}
$flaecheNachId = exportTestNachOeffentlichId($flaechen);
foreach ($erwarteteFlaechen as $publicId => $erwartet) {
    $eins = $flaecheNachId[$publicId];
    foreach (['valid_from_bf', 'valid_to_bf', 'min_zoom', 'max_zoom'] as $feld) {
        assert($eins[$feld] === $erwartet[$feld], "B7: Feld '{$feld}' der Flaeche {$publicId} weicht von `geometries` ab");
    }
    $geometrieErwartet = $erwartet['geometry'] === [] ? null : array_intersect_key($erwartet['geometry'], ['type' => true, 'coordinates' => true]);
    assert($eins['geometry'] === $geometrieErwartet, "B8: die Geometrie der Flaeche {$publicId} weicht von `geometries` ab");
}
assert($flaecheNachId['g-graf']['territory_public_id'] === 'p-graf', 'B9: die Flaeche nennt ihr Gebiet per public_id');
assert($flaecheNachId['g-graf']['geometry']['type'] === 'MultiPolygon', 'B10: GeoJSON kommt unveraendert durch');
assert($flaecheNachId['g-kaputt']['geometry'] === null, 'B11: eine unlesbare Geometrie wird als null gemeldet, nicht verschluckt und nicht als [] verkleidet');

// Ansprueche: aktiv, beide Seiten aktiv, gleicher Kontinent.
assert(count($ansprueche) === 1, 'B12: nur der eine gueltige Anspruch bleibt, war ' . count($ansprueche));
assert(
    $ansprueche[0] === ['territory_public_id' => 'p-graf', 'claimant_public_id' => 'p-baron', 'sort_order' => 1, 'source' => 'manual'],
    'B13: der Anspruch traegt genau die vier freigegebenen Felder in dieser Reihenfolge'
);

// =====================================================================================================
// C. KEINE EDITORNOTIZ, KEIN STIL, KEINE QUELLE IN DER ANTWORT
// =====================================================================================================
$antwort = avesmapsPoliticalTerritoriesExportAntwort($gebiete, $flaechen, $ansprueche, 4711, 'pt-0123456789abcdef');
$json = json_encode($antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
foreach (['GEHEIM-NOTIZ', 'GEHEIM-STIL', 'GEHEIM-QUELLE', 'GEHEIM-GEOJSON', 'editor_notes', '"style"', '"properties"', '"source":"GEHEIM'] as $kanarienvogel) {
    assert(!str_contains($json, $kanarienvogel), "C1: '{$kanarienvogel}' darf nirgends in der Antwort stehen");
}
assert(!str_contains($json, '7734912'), 'C2: keine Personen-ID (created_by) in der Antwort');
foreach (['created_by', 'updated_by', 'claimant_wiki_key'] as $schluessel) {
    assert(!str_contains($json, '"' . $schluessel . '"'), "C3: der Schluessel {$schluessel} steht nirgends in der Antwort");
}
assert(!array_key_exists('properties', $flaecheNachId['g-reich']['geometry']), 'C4: 💣 die Positivliste geht bis in die Geometrie -- ein fremder GeoJSON-Schluessel geht nicht hinaus');
assert(array_keys($flaecheNachId['g-reich']['geometry']) === ['type', 'coordinates'], 'C5: von der Geometrie bleiben genau type und coordinates');

// =====================================================================================================
// D. WAPPEN -- Lizenz-Gate zuerst, dann die zwei Schalter (dieselbe Kette wie die Kartennutzlast)
// =====================================================================================================
$reich = $exportNachId['p-reich'];
assert($reich['coat_of_arms_url'] === '/uploads/wappen/reich.png', 'D1: ein Wiki-Wappen unter public_domain geht hinaus');
assert($reich['coat_origin'] === 'wiki', 'D2: die Herkunft steht dabei');
assert($reich['coat_license_status'] === 'public_domain', 'D3: die Lizenz steht dabei');
$baron = $exportNachId['p-baron'];
assert($baron['coat_of_arms_url'] === '/uploads/wappen/eigen.png', 'D4: ein eigenes Wappen mit oeffentlicher Lizenz (Override) geht hinaus');
assert($baron['coat_origin'] === 'own' && $baron['coat_license_status'] === 'own_work', 'D5: eigene Herkunft, Lizenz aus dem Override');
$fremd = $exportNachId['p-fremd'];
assert(
    $fremd['coat_of_arms_url'] === '' && $fremd['coat_origin'] === '' && $fremd['coat_license_status'] === '',
    'D6: 💣 ein Wappen unter nicht-oeffentlicher Lizenz geht NIE hinaus -- weder Adresse noch Lizenz noch Herkunft'
);
$graf = $exportNachId['p-graf'];
assert($graf['coat_of_arms_url'] === '' && $graf['coat_origin'] === '', 'D7: ein Gebiet ohne Wappen bleibt ohne Wappen');
$ohneLizenz = $exportNachId['p-ohnelizenz'];
assert(
    $ohneLizenz['coat_of_arms_url'] === '' && $ohneLizenz['coat_origin'] === '' && $ohneLizenz['coat_license_status'] === '',
    'D14: 💣 auch ein EIGENES Wappen ohne Lizenzangabe geht nicht hinaus -- das Gate gilt fuer „von uns“ ebenso wie fuer das Wiki'
);

// Die zwei Schalter: lokal aus -> nur „eigene" werden zum Platzhalter, wiki aus -> nur Wiki-Wappen.
$ohneLokal = exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportGebiete($pdo, false, true));
assert($ohneLokal['p-baron']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL, 'D8: „Lokale Wappen: Aus" setzt den Platzhalter an ein eigenes Wappen');
assert($ohneLokal['p-reich']['coat_of_arms_url'] === '/uploads/wappen/reich.png', 'D9: … und laesst das Wiki-Wappen unberuehrt');
$ohneWiki = exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportGebiete($pdo, true, false));
assert($ohneWiki['p-reich']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL, 'D10: „Wiki-Wappen: Aus" setzt den Platzhalter an ein Wiki-Wappen');
assert($ohneWiki['p-baron']['coat_of_arms_url'] === '/uploads/wappen/eigen.png', 'D11: … und laesst das eigene unberuehrt');
assert($ohneLokal['p-fremd']['coat_of_arms_url'] === '' && $ohneWiki['p-fremd']['coat_of_arms_url'] === '', 'D12: der Schalter kann ein gesperrtes Wappen nie zurueckholen (Gate vor Schalter)');
assert($ohneLokal['p-graf']['coat_of_arms_url'] === '', 'D13: „kein Wappen" bleibt „kein Wappen" -- der Platzhalter ersetzt nur, was da ist');

// =====================================================================================================
// D2. DIE ECHTE VERDRAHTUNG DER SCHALTER -- streng gelesen, nie fail-open
// =====================================================================================================
// Abschnitt D reicht die Schalter als Hand-Flags herein und beweist damit die Ableitung. Hier laeuft der
// Standard-Leser von `avesmapsPoliticalTerritoriesExportLesen`: er muss die zwei Schalter aus `app_setting`
// lesen, die richtige Zeile dem richtigen Schalter zuordnen und bei einem Lesefehler WERFEN.
$geworfen = null;
try {
    avesmapsPoliticalTerritoriesExportLesen($pdo); // `app_setting` gibt es in dieser Fixture noch nicht
} catch (PDOException $ausnahme) {
    $geworfen = $ausnahme;
}
assert($geworfen !== null, 'D15: 🔴 ein Lesefehler bei den Schaltern wirft -- er wird NIE zu „an“ (Avesmaps3D legt die Antwort ab; ein gedrueckter Notaus darf nicht durch einen Lesefehler umgangen werden)');

$pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
$antwortMitSchalter = static function (PDO $pdo, string $lokal, string $wiki): array {
    $pdo->exec('DELETE FROM app_setting');
    $einfuegen = $pdo->prepare('INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)');
    $einfuegen->execute(['k' => AVESMAPS_COATS_LOCAL_SETTING, 'v' => $lokal]);
    $einfuegen->execute(['k' => AVESMAPS_COATS_WIKI_SETTING, 'v' => $wiki]);

    return exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportLesen($pdo)['territories']);
};
$nurLokalAus = $antwortMitSchalter($pdo, '0', '1');
assert($nurLokalAus['p-baron']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL, 'D16: lokal=0 im Speicher macht das EIGENE Wappen zum Platzhalter');
assert($nurLokalAus['p-reich']['coat_of_arms_url'] === '/uploads/wappen/reich.png', 'D17: … und laesst das Wiki-Wappen stehen (die Zeilen sind nicht vertauscht)');
$nurWikiAus = $antwortMitSchalter($pdo, '1', '0');
assert($nurWikiAus['p-reich']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL, 'D18: wiki=0 im Speicher macht das Wiki-Wappen zum Platzhalter');
assert($nurWikiAus['p-baron']['coat_of_arms_url'] === '/uploads/wappen/eigen.png', 'D19: … und laesst das eigene stehen -- und kein Zwischenspeicher haelt den Stand vom vorigen Abruf fest');
// Die Erbschaftsregel: fehlen die zwei neuen Schluessel, gilt die STRENGERE der zwei alten Objektart-Stellungen.
$pdo->exec('DELETE FROM app_setting');
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value) VALUES ('" . AVESMAPS_TERRITORY_COATS_SETTING . "', '0')");
$geerbt = exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportLesen($pdo)['territories']);
assert(
    $geerbt['p-baron']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL && $geerbt['p-reich']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL,
    'D20: 🔴 der alte Territorien-Notaus (territory_coats_enabled=0) gilt fuer BEIDE neuen Schalter, solange sie nicht gesetzt sind'
);
// … und ebenso der alte ORTS-Notaus: er steht in `settlement_coats_enabled`, nicht in `territory_coats_enabled`.
$pdo->exec('DELETE FROM app_setting');
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value) VALUES ('" . AVESMAPS_SETTLEMENT_COATS_SETTING . "', '0')");
$geerbtOrt = exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportLesen($pdo)['territories']);
assert(
    $geerbtOrt['p-baron']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL && $geerbtOrt['p-reich']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL,
    'D20b: 🔴 der alte Orts-Notaus (settlement_coats_enabled=0) gilt ebenfalls fuer BEIDE neuen Schalter'
);
$pdo->exec('DELETE FROM app_setting');
$ohneEintraege =exportTestNachOeffentlichId(avesmapsPoliticalTerritoriesExportLesen($pdo)['territories']);
assert($ohneEintraege['p-reich']['coat_of_arms_url'] === '/uploads/wappen/reich.png', 'D21: ohne jede Zeile sind Wappen an (frische Anlage, wie auf der Karte)');

// =====================================================================================================
// E. DIE STAENDE
// =====================================================================================================
$stand = avesmapsPoliticalTerritoriesExportStaende($pdo);
assert($stand['map_revision'] === 4711, 'E1: map_revision ist dieselbe Zahl wie in den Schwester-Endpunkten');
assert(preg_match('/^pt-[0-9a-f]{16}$/', $stand['territories_revision']) === 1, 'E2: der Gebietsstempel hat die Form pt-<16 Hex>');
assert($stand === avesmapsPoliticalTerritoriesExportStaende($pdo), 'E3: ohne Aenderung bleibt der Stempel stehen');

$vorher = $stand['territories_revision'];
$pdo->exec("UPDATE political_territory_geometry SET updated_at = '2026-09-29 09:00:00.000' WHERE id = 2");
$nachFlaeche = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachFlaeche !== $vorher, 'E4: eine geaenderte Flaeche hebt den Stempel');
$pdo->exec("UPDATE political_territory_wiki SET synced_at = '2026-09-29 08:00:00.000' WHERE id = 1");
$nachWiki = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachWiki !== $nachFlaeche, 'E4b: ein neuer Wiki-Sync (wiki_type, „offen“-Erkennung) hebt den Stempel');
$nachFlaeche = $nachWiki;

$pdo->exec("UPDATE political_territory SET updated_at = '2026-09-29 09:01:00.000' WHERE id = 1");
$nachGebiet = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachGebiet !== $nachFlaeche, 'E5: ein geaendertes Gebiet hebt den Stempel');

$pdo->exec("UPDATE political_territory_claim SET updated_at = '2026-09-29 09:02:00.000' WHERE id = 1");
$nachAnspruch = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachAnspruch !== $nachGebiet, 'E6: ein geaenderter Anspruch hebt den Stempel');

// 💣 Eine HART geloeschte Zeile sieht `updated_at` nicht -- die Zeile ist weg, ihr Zeitstempel mit ihr. Zwei
// getrennte Faelle, damit JEDES der zwei Zusatzsignale allein bewiesen ist (der erste Entwurf loeschte die
// Zeile mit der hoechsten id und liess beide Signale zugleich anschlagen: streicht man eines, blieb der Test gruen).
// E7a: eine Zeile in der MITTE weg -- hoechste id und juengstes updated_at bleiben, nur die ZAHL faellt.
$pdo->exec('DELETE FROM political_territory_claim WHERE id = 2');
$nachLoeschung = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachLoeschung !== $nachAnspruch, 'E7a: 💣 eine hart geloeschte Zeile in der Mitte hebt den Stempel (Zaehler)');
// E7b: die neueste Zeile weg, eine andere mit ALTEM Zeitstempel und hoeherer id dazu -- Zahl und juengstes
// updated_at bleiben gleich, nur die hoechste id wandert.
$pdo->exec('DELETE FROM political_territory_claim WHERE id = 4');
$pdo->exec("INSERT INTO political_territory_claim (id, territory_id, claimant_territory_id, sort_order, source, is_active, updated_at)
    VALUES (9, 2, 6, 5, 'manual', 1, '2026-09-01 00:00:00.000')");
$nachTausch = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
assert($nachTausch !== $nachLoeschung, 'E7b: 💣 ein Tausch bei gleicher Zahl und gleichem juengstem updated_at hebt den Stempel (hoechste id)');

$pdo->exec('DELETE FROM map_revision');
assert(avesmapsPoliticalTerritoriesExportStaende($pdo)['map_revision'] === 0, 'E8: fehlt die map_revision-Zeile, ist sie 0 (wie bei den Schwestern)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 4711)');

// =====================================================================================================
// F. DIE STAENDE BESCHREIBEN DIE DATEN DARUNTER
// =====================================================================================================
// Ein Lesevorgang, waehrend dem jemand speichert, darf NIE eine Antwort mit dem Stand von vorher
// ausgeben, die Daten von nachher traegt.
$aufrufe = 0;
$bewegtEinmal = static function (PDO $pdo) use (&$aufrufe): array {
    $aufrufe++;
    if ($aufrufe === 1) {
        $pdo->exec("UPDATE political_territory SET updated_at = '2026-09-29 10:00:00.000' WHERE id = 2");
    }

    return ['gebiete' => [['public_id' => 'sim']], 'flaechen' => [], 'ansprueche' => []];
};
$ergebnis = avesmapsPoliticalTerritoriesExportLesen($pdo, $bewegtEinmal);
assert($aufrufe === 2, 'F1: bewegt sich der Stand beim ersten Lesen, wird ein zweites Mal gelesen, war ' . $aufrufe);
assert(
    $ergebnis['territories_revision'] === avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'],
    'F2: der genannte Stempel ist der Stand NACH dem Lesen, in dem nichts mehr geschrieben wurde'
);
assert($ergebnis['ok'] === true && $ergebnis['map_revision'] === 4711, 'F3: die Antwort traegt beide Staende');

$zaehler = 0;
$immerBewegt = static function (PDO $pdo) use (&$zaehler): array {
    $zaehler++;
    $pdo->exec("UPDATE political_territory SET updated_at = '2026-09-29 11:00:0{$zaehler}.000' WHERE id = 2");

    return ['gebiete' => [], 'flaechen' => [], 'ansprueche' => []];
};
$geworfen = null;
try {
    avesmapsPoliticalTerritoriesExportLesen($pdo, $immerBewegt);
} catch (AvesmapsPoliticalTerritoriesExportInBewegung $ausnahme) {
    $geworfen = $ausnahme;
}
assert($geworfen !== null, 'F4: bewegt sich der Stand bei JEDEM Versuch, wird geworfen statt einen falschen Stand zu nennen');
assert($zaehler === AVESMAPS_POLITICAL_TERRITORIES_EXPORT_VERSUCHE, 'F5: genau so oft versucht wie zugesagt, war ' . $zaehler);

// =====================================================================================================
// G. OHNE SITZUNG, OHNE SCHREIBWIRKUNG, NUR GET
// =====================================================================================================
$endpunkt = exportTestOhneKommentare((string) file_get_contents($endpunktDatei));
$bibliothek = exportTestOhneKommentare((string) file_get_contents($bibliothekDatei));

foreach (['avesmapsRequireUser', 'avesmapsCurrentUser', 'session_start', 'avesmapsReadJsonRequest', '$_POST', 'avesmapsPoliticalInvalidateLayerCache'] as $verboten) {
    assert(!str_contains($endpunkt, $verboten), "G1: der Endpunkt darf '{$verboten}' nicht kennen (keine Sitzung, kein Schreibweg)");
    assert(!str_contains($bibliothek, $verboten), "G2: die Bibliothek darf '{$verboten}' nicht kennen");
}
foreach (['avesmapsCoatSchalterFast', 'avesmapsAppSettingGetWithoutDdl', 'avesmapsCoatSwitchEnabledFast'] as $failOffen) {
    assert(!str_contains($bibliothek, $failOffen), "G2b: 🔴 die Bibliothek darf den fail-open Schalterleser '{$failOffen}' nicht benutzen -- ein Lesefehler wuerde den Notaus umgehen");
}
foreach (['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP ', '->exec(', 'beginTransaction', 'EnsureTables', 'Ensure'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "G3: die Bibliothek darf '{$verboten}' nicht enthalten (nur lesen, kein DDL)");
    assert(!str_contains($endpunkt, $verboten), "G4: der Endpunkt darf '{$verboten}' nicht enthalten");
}
assert(str_contains($endpunkt, "'GET'") && str_contains($endpunkt, '405'), 'G5: der Endpunkt lehnt jede andere Methode als GET mit 405 ab');
assert(!str_contains($endpunkt, 'getMessage'), 'G6: 🔴 kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, M1) -- der Endpunkt hat keine Eingabe, die eine eigene Meldung braeuchte');
foreach (['X-Avesmaps-ETag', 'ETag', 'Cache-Control', '304'] as $kopf) {
    assert(str_contains($endpunkt, $kopf), "G7: der Endpunkt setzt '{$kopf}' (bedingtes Abrufen wie map-features.php)");
}
// 💣 Die REIHENFOLGE ist der Vertrag, nicht das Vorkommen: Kopfzeilen erst NACH dem Lesen (sonst reist der Tag auf
// einer 500 mit), das 304 erst nach dem Vergleich, und Herkunft und Methode VOR jeder Arbeit.
$stelle = static function (string $nadel) use ($endpunkt): int {
    $pos = strpos($endpunkt, $nadel);
    assert($pos !== false, "G13: im Endpunkt fehlt '{$nadel}'");

    return (int) $pos;
};
$herkunft = $stelle('avesmapsApplyCorsPolicy(');
$methode = $stelle("!== 'GET'");
$lesen = $stelle('avesmapsPoliticalTerritoriesExportLesen(');
$kodieren = $stelle('json_encode($antwort');
$etagKopf = $stelle("header('ETag: '");
$vergleich = $stelle('avesmapsETagMatches(');
$dreihundertvier = $stelle('http_response_code(304)');
$antworten = $stelle('avesmapsJsonResponse(200, $antwort)');
assert(
    $herkunft < $methode && $methode < $lesen && $lesen < $kodieren && $kodieren < $etagKopf && $etagKopf < $vergleich && $vergleich < $dreihundertvier && $dreihundertvier < $antworten,
    'G14: Reihenfolge im Endpunkt: Herkunft -> Methode -> Lesen -> Kodieren -> ETag-Kopf -> Vergleich -> 304 -> 200'
);
assert(
    strpos($endpunkt, 'header(') > $lesen,
    'G14b: 💣 JEDE Kopfzeile geht erst nach dem Lesen hinaus, nicht nur die ETag-Zeile -- sonst reist ein gueltiger Tag auch auf einer 500 mit'
);
assert(str_contains($endpunkt, 'avesmapsPoliticalTerritoriesExportETag($rumpf)'), 'G15: der ETag ist ein Hash des INHALTS (des kodierten Rumpfs), nicht des Stempels');
assert(
    preg_match('/avesmapsErrorResponse\(\s*403\b/', $endpunkt) === 1 && preg_match('/avesmapsErrorResponse\(\s*405\b/', $endpunkt) === 1
    && preg_match('/avesmapsErrorResponse\(\s*503\b/', $endpunkt) === 1 && str_contains($endpunkt, "header('Retry-After: 10')"),
    'G16: 403 fremde Herkunft, 405 falsche Methode, 503 mit Retry-After bei bewegtem Stand'
);
assert(str_contains($endpunkt, 'catch (AvesmapsPoliticalTerritoriesExportInBewegung)'), 'G17: der bewegte Stand wird gefangen und ist kein 500');

// 💣 Kein PDO-Platzhalter zweimal im selben Statement: MySQL mit nativen Prepares lehnt das mit HY093 ab,
// SQLite (dieser Test) toleriert es -- ein Fehler, der hier nie rot wuerde und live beim ersten Abruf 500 gaebe.
$anzahlAbfragen = preg_match_all('/->prepare\((.*?)\);/s', $bibliothek, $abfragen);
assert($anzahlAbfragen >= 3, 'G11: die Bibliothek fuehrt mindestens die drei Listen-Abfragen aus (gefunden: ' . $anzahlAbfragen . ')');
foreach ($abfragen[1] as $sql) {
    preg_match_all('/:([a-z_]+)\b/', $sql, $namen);
    assert(
        count($namen[1]) === count(array_unique($namen[1])),
        'G12: ein benannter Platzhalter steht zweimal im selben Statement (' . implode(', ', $namen[1]) . ')'
    );
}

// Der alte Endpunkt bleibt, wie er war: `export` ist dort NICHT oeffentlich, `layer` schon.
assert(avesmapsPoliticalLeseStufe('export') === 'edit', 'G8: 💣 „export" am alten Endpunkt bleibt Editoren vorbehalten (Positivliste)');
assert(avesmapsPoliticalLeseStufe('layer') === null, 'G9: „layer" bleibt oeffentlich, unveraendert');
assert(AVESMAPS_POLITICAL_OEFFENTLICHE_LESEAKTIONEN === ['layer'], 'G10: die Liste der oeffentlichen Aktionen am alten Endpunkt bleibt genau ["layer"]');

// =====================================================================================================
// H. FORM DER ANTWORT
// =====================================================================================================
assert(array_keys($antwort) === ['ok', 'map_revision', 'territories_revision', 'territories', 'geometries', 'claims'], 'H1: die Stempel stehen OBEN, dann die drei Listen');
assert($exportNachId['p-reich']['parent_public_id'] === null, 'H2: eine Wurzel hat parent_public_id null');
assert($exportNachId['p-graf']['parent_public_id'] === 'p-reich', 'H3: der Elter wird per public_id genannt');
assert($exportNachId['p-graf']['capital_place_public_id'] === 'ort-1' && $exportNachId['p-graf']['seat_place_public_id'] === 'ort-2', 'H4: Hauptstadt und Sitz per public_id des Ortes -- auch der Sitz, der auf einen DEAKTIVIERTEN Ort zeigt (Befund, nicht geglaettet)');
assert($exportNachId['p-reich']['capital_place_public_id'] === null, 'H5: keine Hauptstadt heisst null');
assert($exportNachId['p-baron']['parent_public_id'] === 'p-korb', 'H6: ein Elter im Papierkorb bleibt genannt -- ein Befund, den der Export nicht heilt');
assert($exportNachId['p-reich']['valid_to_bf'] === null, 'H7: „besteht" heisst valid_to_bf null (offen), wie bei `list`');
assert($exportNachId['p-reich']['wiki_type'] === 'Kaiserreich', 'H8: der Wiki-Typ steht neben dem eigenen');
assert($exportNachId['p-reich']['updated_at'] === '2026-09-01 10:00:00.000', 'H9: updated_at kommt aus der Zeile');

$etag = avesmapsPoliticalTerritoriesExportETag($json);
assert(preg_match('/^W\/"pol-territories-[0-9a-f]{16}"$/', $etag) === 1, 'H10: schwacher Inhalts-ETag');
assert($etag === avesmapsPoliticalTerritoriesExportETag($json) && $etag !== avesmapsPoliticalTerritoriesExportETag($json . ' '), 'H11: der ETag folgt dem INHALT');

echo "OK: political-territories-export-test\n";
