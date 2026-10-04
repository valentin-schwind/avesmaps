<?php

declare(strict_types=1);

/**
 * Der Gebietsexport E4 -- `detail`, `detail_overrides` und `coat` je Gebiet (Auftrag Avesmaps3D 04.10.2026).
 *
 *   A. Form: genau die Felder, die drei alten Wappenfelder bleiben
 *   B. detail: Override vor Staging, bewusster Leerwert "" gegen „kein Wert" null, Sonderregel Gruendung/Aufloesung,
 *      Gleichlauf mit der Infobox (territory-detail.php liest dieselbe Regel)
 *   C. coat: undecided / none / set, Feld und Art der Datei, Wiki-Angaben nur am Wiki-Bild, Adresse ohne ?v=
 *   D. Gate und Schalter: nicht oeffentlich = nur der Zustand; Schalter aus = nur die Adresse weg
 *   E. Schreibfreiheit, Stand, Beispielantwort
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/political-territories-export-detail-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
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
require_once __DIR__ . '/export-test-helfer.php';

// ---- Fixture -----------------------------------------------------------------------------------
$pdo = exportTestNeuePdo();
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
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, geometry_geojson TEXT, valid_from_bf INTEGER, valid_to_bf INTEGER,
    min_zoom INTEGER, max_zoom INTEGER, source TEXT, style_json TEXT, is_active INTEGER, created_by INTEGER, updated_at TEXT
)');
$pdo->exec('CREATE TABLE political_territory_claim (
    id INTEGER PRIMARY KEY, territory_id INTEGER, claimant_territory_id INTEGER, sort_order INTEGER, source TEXT,
    claimant_wiki_key TEXT, is_active INTEGER, created_by INTEGER, updated_at TEXT
)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 812)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (
    id INTEGER PRIMARY KEY, wiki_key TEXT, continent TEXT, founded_text TEXT, dissolved_text TEXT, form_of_government TEXT,
    capital_name TEXT, seat_name TEXT, ruler TEXT, language TEXT, currency TEXT, population TEXT, founder TEXT, political TEXT,
    trade_zone TEXT, trade_goods TEXT, geographic TEXT, blazon TEXT, affiliation_raw TEXT, coat_of_arms_url TEXT,
    coat_of_arms_license TEXT, coat_of_arms_license_status TEXT, coat_of_arms_author TEXT, coat_of_arms_attribution TEXT,
    synced_at TEXT
)');
$pdo->exec('CREATE TABLE wiki_territory_model (id INTEGER PRIMARY KEY, wiki_key TEXT, metadata_overrides_json TEXT, updated_at TEXT)');
$pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NULL)');

// Gebiete (alle aktiv, Aventurien):
//  1 undecided -- nur der Wiki-Stand traegt ein gemeinfreies Wappen (absolute Wiki-Adresse), Detailfelder gemischt
//  2 set/custom -- Upload per Override, eigene Lizenz und eigener Urheber; der Wiki-Urheber darf NICHT erscheinen
//  3 set/wiki_localized -- lokalisierte Wiki-Kopie per Override, Lizenz bleibt im Staging
//  4 none -- „Entfernen": leerer Override, obwohl das Staging ein Wappen haette
//  5 set/territory -- eine absolute Wiki-Adresse im eigenen Feld (der Resolver nennt das `own`)
//  6 nicht oeffentlich -- Upload unter cc_by
//  7 ohne wiki_key -- kein Staging, kein Override; eigenes Wappen mit ?v=
$pdo->exec("INSERT INTO political_territory (id, public_id, wiki_key, name, type, continent, status, coat_of_arms_url, is_active, sort_order, updated_at) VALUES
    (1, 'p-reich', 'wiki:reich', 'Reich', 'Kaiserreich', 'Aventurien', 'besteht', '', 1, 1, '2026-09-01 10:00:00.000'),
    (2, 'p-custom', 'wiki:custom', 'Custom', 'Baronie', 'Aventurien', '', '', 1, 2, '2026-09-01 10:00:00.000'),
    (3, 'p-lokal', 'wiki:lokal', 'Lokal', 'Baronie', 'Aventurien', '', '', 1, 3, '2026-09-01 10:00:00.000'),
    (4, 'p-keins', 'wiki:keins', 'Keins', 'Baronie', 'Aventurien', '', '', 1, 4, '2026-09-01 10:00:00.000'),
    (5, 'p-feld', 'wiki:feld', 'Feld', 'Baronie', 'Aventurien', '', 'https://de.wiki-aventurica.de/images/feld.png', 1, 5, '2026-09-01 10:00:00.000'),
    (6, 'p-ccby', 'wiki:inoffiziell-ccby', 'CC-BY', 'Baronie', 'Aventurien', '', '', 1, 6, '2026-09-01 10:00:00.000'),
    (7, 'p-ohne', '', 'Ohne', 'Baronie', 'Aventurien', '', '/uploads/wappen/ohne-custom.png?v=1700000000', 1, 7, '2026-09-01 10:00:00.000')");
$pdo->exec("INSERT INTO political_territory_wiki_test (id, wiki_key, continent, founded_text, dissolved_text, form_of_government, ruler, language, population,
    coat_of_arms_url, coat_of_arms_license, coat_of_arms_license_status, coat_of_arms_author, coat_of_arms_attribution, synced_at) VALUES
    (1, 'wiki:reich', 'Aventurien', '993 BF', 'besteht', 'Monarchie', 'Rohaja', 'Garethi', '1 Mio.',
        'https://de.wiki-aventurica.de/images/reich.png', 'public domain', 'public_domain', 'Beispiel-Zeichner', '', '2026-08-01 10:00:00.000'),
    (2, 'wiki:custom', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'https://de.wiki-aventurica.de/images/custom.png', 'CC-BY-SA-3.0', 'cc_by', 'Wiki-Urheber', 'Wiki-Urheber (CC-BY-SA-3.0)', '2026-08-01 10:00:00.000'),
    (3, 'wiki:lokal', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'https://de.wiki-aventurica.de/images/lokal.png', 'public domain', 'public_domain', 'Lokal-Urheber', '', '2026-08-01 10:00:00.000'),
    (4, 'wiki:keins', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'https://de.wiki-aventurica.de/images/keins.png', 'public domain', 'public_domain', 'Keins-Urheber', '', '2026-08-01 10:00:00.000'),
    (5, 'wiki:feld', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'https://de.wiki-aventurica.de/images/feld.png', 'public domain', 'public_domain', 'Feld-Urheber', '', '2026-08-01 10:00:00.000'),
    (6, 'wiki:inoffiziell-ccby', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, '2026-08-01 10:00:00.000')");
$pdo->exec("INSERT INTO wiki_territory_model (id, wiki_key, metadata_overrides_json, updated_at) VALUES
    (1, 'wiki:reich', '{\"ruler\":\"Kaiserin Rohaja\",\"language\":\"\",\"dissolved_end_bf\":\"\",\"founded_start_bf\":\"900\"}', '2026-09-01 10:00:00.000'),
    (2, 'wiki:custom', '{\"coat_of_arms_url\":\"/uploads/wappen/custom-custom.png\",\"coat_of_arms_license_status\":\"own_work\",\"coat_of_arms_author\":\"Eigener Zeichner\",\"coat_of_arms_note\":\"GEHEIM-WAPPENNOTIZ\"}', '2026-09-01 10:00:00.000'),
    (3, 'wiki:lokal', '{\"coat_of_arms_url\":\"/uploads/wappen/lokal.png\"}', '2026-09-01 10:00:00.000'),
    (4, 'wiki:keins', '{\"coat_of_arms_url\":\"\"}', '2026-09-01 10:00:00.000'),
    (6, 'wiki:inoffiziell-ccby', '{\"coat_of_arms_url\":\"/uploads/wappen/ccby-custom.png\",\"coat_of_arms_license_status\":\"cc_by\",\"coat_of_arms_author\":\"GEHEIM-CCBY-URHEBER\"}', '2026-09-01 10:00:00.000')");

// Der Wappen-Zwischenspeicher: Legacy zeigt eine Wiki-Adresse NUR ueber coat.php, und das liefert ausschliesslich
// eine Kopie aus /uploads/wappen/cache/<sha1(url)>.<ext>. Das Reich hat eine, das Feld-Gebiet nicht.
$docroot = sys_get_temp_dir() . '/export-detail-' . getmypid();
@mkdir($docroot . '/uploads/wappen/cache', 0777, true);
file_put_contents($docroot . '/uploads/wappen/cache/' . sha1('https://de.wiki-aventurica.de/images/reich.png') . '.png', 'png');
$_SERVER['DOCUMENT_ROOT'] = $docroot;

// =====================================================================================================
// A. FORM
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsPoliticalTerritoriesExportLesen($pdo), 'E1');
$gebiete = array_column($export['territories'], null, 'public_id');
exportTestGenauFelder($export['territories'], array_merge(
    AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS,
    AVESMAPS_POLITICAL_TERRITORIES_EXPORT_COAT_FIELDS,
    AVESMAPS_POLITICAL_TERRITORIES_EXPORT_DETAIL_OBJECT_FIELDS
), 'A1 Gebiet');
foreach ($gebiete as $publicId => $gebiet) {
    assert(array_keys($gebiet['detail']) === AVESMAPS_POLITICAL_TERRITORIES_EXPORT_DETAIL_FIELDS, "A2: detail traegt genau die 17 Felder ({$publicId})");
    assert(array_keys($gebiet['coat']) === AVESMAPS_POLITICAL_TERRITORIES_EXPORT_WAPPEN_FELDER, "A3: coat traegt genau seine Felder ({$publicId})");
}
foreach (['GEHEIM-WAPPENNOTIZ', 'GEHEIM-CCBY-URHEBER', 'coat_of_arms_note', 'override_keys', 'suppressed_url', 'herkunft'] as $geheim) {
    assert(!exportTestEnthaelt($export, $geheim), "A4: 🔴 '{$geheim}' taucht im oeffentlichen Export nirgends auf");
}

// =====================================================================================================
// B. DETAIL
// =====================================================================================================
$reich = $gebiete['p-reich'];
assert($reich['detail']['form_of_government'] === 'Monarchie', 'B1: ein Staging-Wert ohne Override');
assert($reich['detail']['ruler'] === 'Kaiserin Rohaja', 'B2: der Override schlaegt das Staging');
assert($reich['detail']['language'] === '', 'B3: 🔴 ein LEERER Override ist ein bewusster Leerwert "" -- nicht null, und das Staging („Garethi") gilt nicht');
assert($reich['detail']['currency'] === null, 'B4: kein Override, Staging leer = null („kein Wert")');
assert($reich['detail']['founded_text'] === '900 BF', 'B5: Sonderregel -- der BF-Override der Gruendung schlaegt den Staging-Text');
assert($reich['detail']['dissolved_text'] === 'besteht', 'B6: Sonderregel -- ein leerer BF-Override der Aufloesung heisst „besteht"');
assert($reich['detail_overrides'] === ['founded_text', 'dissolved_text', 'ruler', 'language'], 'B7: die Felder aus dem Override, in Feldreihenfolge: ' . json_encode($reich['detail_overrides']));
assert($gebiete['p-ohne']['detail'] === array_fill_keys(AVESMAPS_POLITICAL_TERRITORIES_EXPORT_DETAIL_FIELDS, null) && $gebiete['p-ohne']['detail_overrides'] === [], 'B8: ohne wiki_key gibt es keine Detailfelder');

// Gleichlauf mit der Infobox: dieselbe Regel, dieselben Werte.
$staging = $pdo->query("SELECT * FROM political_territory_wiki_test WHERE wiki_key = 'wiki:reich'")->fetch(PDO::FETCH_ASSOC);
$overrides = json_decode((string) $pdo->query("SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key = 'wiki:reich'")->fetchColumn(), true);
$infobox = avesmapsTerritoryDetailInfoboxFelder($staging, $overrides);
foreach (AVESMAPS_POLITICAL_TERRITORIES_EXPORT_DETAIL_FIELDS as $feld) {
    $exportWert = $reich['detail'][$feld];
    assert(($infobox[$feld] ?? null) === (($exportWert === '' || $exportWert === null) ? null : $exportWert), "B9: Infobox und Export zeigen fuer '{$feld}' dasselbe");
}
$endpunktDetail = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/app/territory-detail.php'));
assert(str_contains($endpunktDetail, 'avesmapsTerritoryDetailInfoboxFelder($staging, $overrides)'), 'B10: 🔴 die Infobox ruft DIESELBE Regel');
assert(!str_contains($endpunktDetail, "array_key_exists('founded_start_bf'") && !str_contains($endpunktDetail, 'const AVESMAPS_TERRITORY_DETAIL_FIELDS'), 'B11: keine zweite Fassung der Regel im Endpunkt');

// =====================================================================================================
// C. COAT -- Zustand, Feld, Art, Angaben
// =====================================================================================================
assert($reich['coat'] === [
    'state' => 'undecided', 'source' => 'staging', 'origin' => 'wiki_localized', 'url' => 'https://de.wiki-aventurica.de/images/reich.png',
    'license_status' => 'public_domain', 'license' => 'public domain', 'author' => 'Beispiel-Zeichner', 'attribution' => null,
    'public' => true, 'shown' => true,
], 'C1: undecided -- keine redaktionelle Entscheidung, das Wiki-Wappen gilt; seine Datei liegt im Zwischenspeicher, also wiki_localized und gezeigt: ' . json_encode($reich['coat']));
assert($gebiete['p-custom']['coat'] === [
    'state' => 'set', 'source' => 'override', 'origin' => 'custom', 'url' => '/uploads/wappen/custom-custom.png',
    'license_status' => 'own_work', 'license' => null, 'author' => 'Eigener Zeichner', 'attribution' => null,
    'public' => true, 'shown' => true,
], 'C2: set/custom -- eigener Urheber, KEIN Wiki-Urheber, KEINE Wiki-Nennung, kein Wiki-Klartext: ' . json_encode($gebiete['p-custom']['coat']));
assert($gebiete['p-lokal']['coat']['origin'] === 'wiki_localized' && $gebiete['p-lokal']['coat']['state'] === 'set'
    && $gebiete['p-lokal']['coat']['license'] === 'public domain' && $gebiete['p-lokal']['coat']['author'] === 'Lokal-Urheber',
    'C3: 💣 eine lokalisierte Wiki-Kopie ist wiki_localized (der Resolver nannte sie own) und behaelt die Wiki-Angaben');
assert($gebiete['p-keins']['coat'] === [
    'state' => 'none', 'source' => null, 'origin' => null, 'url' => null, 'license_status' => null, 'license' => null,
    'author' => null, 'attribution' => null, 'public' => false, 'shown' => false,
], 'C4: 🔴 none -- ausdruecklich kein Wappen, obwohl das Staging eins haette: ' . json_encode($gebiete['p-keins']['coat']));
assert($gebiete['p-feld']['coat']['source'] === 'territory' && $gebiete['p-feld']['coat']['origin'] === 'wiki_staging' && $gebiete['p-feld']['coat']['state'] === 'set',
    'C5: eine Wiki-Adresse im eigenen Feld: Feld territory, Art wiki_staging');
assert($gebiete['p-feld']['coat']['public'] === true && $gebiete['p-feld']['coat']['shown'] === false
    && $gebiete['p-feld']['coat']['url'] === 'https://de.wiki-aventurica.de/images/feld.png',
    'C5b: 💣 ohne Kopie im Zwischenspeicher kann Legacy die Wiki-Datei nicht zeigen (coat.php ruft nicht nach draussen) -- shown false, die Adresse bleibt genannt');
assert($gebiete['p-ohne']['coat']['state'] === 'set' && $gebiete['p-ohne']['coat']['public'] === false,
    'C6: ohne wiki_key gibt es keine Lizenzangabe -- das eigene Wappen ist gesetzt, aber gesperrt (das Gate gilt auch fuer „von uns")');
$mitStempel = avesmapsPoliticalTerritoriesExportWappenFakten('/uploads/wappen/x-custom.png?v=1700000000', [], ['coat_of_arms_license_status' => 'own_work']);
assert($mitStempel['url'] === '/uploads/wappen/x-custom.png' && $mitStempel['origin'] === 'custom' && $mitStempel['public'] === true,
    'C6b: die Adresse geht OHNE ?v= hinaus');

$fakten = avesmapsPoliticalTerritoriesExportWappenFakten('', ['coat_of_arms_url' => 'https://de.wiki-aventurica.de/images/keins.png'], ['coat_of_arms_url' => '', 'coat_of_arms_note' => 'n']);
assert($fakten['suppressed_url'] === 'https://de.wiki-aventurica.de/images/keins.png' && $fakten['override_keys'] === ['coat_of_arms_url', 'coat_of_arms_note'] && $fakten['note'] === 'n',
    'C7: die Fakten kennen die verdeckte Adresse, die Override-Schluessel und die Notiz (fuer den PRIVATEN Export)');
$uploadOhneUrheber = avesmapsPoliticalTerritoriesExportWappenFakten(
    '',
    ['coat_of_arms_url' => 'https://de.wiki-aventurica.de/images/w.png', 'coat_of_arms_author' => 'Wiki-Urheber', 'coat_of_arms_license' => 'public domain', 'coat_of_arms_attribution' => 'Wiki-Nennung'],
    ['coat_of_arms_url' => '/uploads/wappen/w-custom.png', 'coat_of_arms_license_status' => 'own_work']
);
assert($uploadOhneUrheber['author'] === null && $uploadOhneUrheber['license'] === null && $uploadOhneUrheber['attribution'] === null,
    'C7b: 🔴 ein Upload OHNE eigenen Urheber-Override erbt NICHT den Urheber, den Klartext oder die Nennung des Wiki-Bildes');
assert(avesmapsPoliticalTerritoriesExportWappenArt('/uploads/wappen/cache/0a1b.png') === 'wiki_localized', 'C8: der Wappen-Zwischenspeicher ist eine lokale Wiki-Kopie');
assert(avesmapsPoliticalTerritoriesExportWappenArt('/uploads/wappen/x-custom.SVG') === 'custom', 'C9: -custom auch mit grosser Endung');
assert(avesmapsPoliticalTerritoriesExportWappenArt('') === null, 'C10: keine Adresse, keine Art');

// =====================================================================================================
// D. GATE UND SCHALTER
// =====================================================================================================
assert($gebiete['p-ccby']['coat'] === [
    'state' => 'set', 'source' => null, 'origin' => null, 'url' => null, 'license_status' => null, 'license' => null,
    'author' => null, 'attribution' => null, 'public' => false, 'shown' => false,
], 'D1: 🔴 nicht oeffentliche Lizenz -- nur der Zustand, weder Adresse noch Lizenz, Herkunft oder Urheber');
assert($gebiete['p-ccby']['coat_of_arms_url'] === '' && $gebiete['p-ccby']['coat_license_status'] === '', 'D2: die drei alten Felder unveraendert (gesperrt = leer)');

$pdo->exec("INSERT INTO app_setting (setting_key, setting_value, updated_at) VALUES ('" . AVESMAPS_COATS_LOCAL_SETTING . "', '0', '2026-10-01 10:00:00')");
$mitSchalter = array_column(avesmapsPoliticalTerritoriesExportLesen($pdo)['territories'], null, 'public_id');
assert($mitSchalter['p-custom']['coat']['shown'] === false && $mitSchalter['p-custom']['coat']['url'] === null
    && $mitSchalter['p-custom']['coat']['license_status'] === 'own_work' && $mitSchalter['p-custom']['coat']['public'] === true,
    'D3: lokaler Schalter aus -- die Adresse faellt weg, Lizenz und Herkunft bleiben genannt');
assert($mitSchalter['p-reich']['coat']['shown'] === true, 'D4: der Wiki-Stand folgt dem WIKI-Schalter, nicht dem lokalen');
$pdo->exec('DELETE FROM app_setting');

// =====================================================================================================
// E. STAND, BIBLIOTHEK, BEISPIELANTWORT
// =====================================================================================================
$vorher = avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'];
$pdo->exec("UPDATE wiki_territory_model SET metadata_overrides_json = '{\"ruler\":\"Hal\"}', updated_at = '2026-10-02 10:00:00.000' WHERE id = 1");
assert(avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'] !== $vorher, 'E2: ein neuer Override hebt den Gebietsstempel (das Modell steht seit E4 im Fingerabdruck)');
$pdo->exec("INSERT INTO political_territory_wiki_test (id, wiki_key, synced_at) VALUES (9, 'wiki:neu', '2026-10-03 10:00:00.000')");
assert(avesmapsPoliticalTerritoriesExportStaende($pdo)['territories_revision'] !== $vorher, 'E3: eine neue Staging-Zeile hebt ihn ebenso');

$pdo->exec('DROP TABLE wiki_territory_model');
$geworfen = false;
try {
    avesmapsPoliticalTerritoriesExportGebiete($pdo, true, true);
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen, 'E4: 🔴 Overrides werden STRENG gelesen -- eine fehlende Tabelle ist ein 500, kein stilles „kein Wappen"');

exportTestBibliothekPruefen($wurzel . '/api/_internal/app/political-territories-export.php', 'E5');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/territory-detail-felder.php', 'E6');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/political-territories-export.php'));
assert(!str_contains($bibliothek, 'avesmapsLoadSettlementCoatGateInputs'), 'E7: der fail-leere Gate-Leser ist im Export tabu');
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/political-territories-export.beispiel.json'), true);
assert(is_array($beispiel), 'E8: die Beispielantwort liegt vor');
exportTestFormGleich($beispiel, $export, 'political-territories-export');

echo "political-territories-export-detail-test: alle Zusicherungen erfuellt\n";
