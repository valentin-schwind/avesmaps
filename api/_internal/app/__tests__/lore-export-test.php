<?php

declare(strict_types=1);

/**
 * Der Lore-Voll-Export E2/E2+ -- GET /api/app/lore-export.php (Auftrag Avesmaps3D 04.10.2026).
 *
 *   A. Positivlisten: Eintraege, Ortszeilen, Regeln samt Bedingungen, Quellen -- KEIN created_by, kein image_*
 *   B. Inhalt: alle Zustaende (auch Grabsteine), JSON gelesen, Regeln verschachtelt, Quellen mit Herkunft und Zustand
 *   C. Schalter streng gelesen, nicht gefiltert
 *   D. Schreibfreiheit und Stand
 *   E. Endpunkt, Bibliothek, Beispielantwort
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-export-test.php
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
require_once $wurzel . '/api/_internal/app/lore-export.php';
require_once __DIR__ . '/export-test-helfer.php';

$pdo = exportTestNeuePdo();
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 812)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER)');
$pdo->exec("CREATE TABLE lore_entry (
    id INTEGER PRIMARY KEY, wiki_key TEXT NOT NULL, kind TEXT NOT NULL, wiki_title TEXT NULL, wiki_url TEXT NULL, name TEXT NOT NULL,
    match_key TEXT NOT NULL DEFAULT '', gruppe TEXT NULL, typ TEXT NULL, lebensraum TEXT NULL, synonyme TEXT NULL, merkmale_json TEXT NULL,
    continent TEXT NULL, image_url TEXT NULL, image_license_status TEXT NULL, image_author TEXT NULL, image_attribution TEXT NULL,
    origin TEXT NOT NULL DEFAULT 'wiki', status TEXT NOT NULL DEFAULT 'active', field_origins_json TEXT NULL,
    created_at TEXT NULL, updated_at TEXT NULL
)");
$pdo->exec("INSERT INTO lore_entry (id, wiki_key, kind, wiki_title, wiki_url, name, match_key, gruppe, typ, lebensraum, synonyme, merkmale_json, continent, image_url, image_author, origin, status, field_origins_json, updated_at) VALUES
    (1, 'wiki:alraune', 'flora', 'Alraune', 'https://de.wiki-aventurica.de/wiki/Alraune', 'Alraune', 'alraune', 'Heilpflanze', 'Kraut', 'Wald', 'Mandragora',
        '{\"verbreitung\":\"[[Weiden]], [[Kosch]]\"}', 'Aventurien', 'https://geheim.example/bild.png', 'GEHEIM-BILDURHEBER', 'wiki', 'active', '{\"gruppe\":\"manual\"}', '2026-09-01 10:00:00'),
    (2, 'wiki:leinoel', 'ware', 'Leinöl', NULL, 'Leinöl', 'leinl', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'wiki', 'suppressed', NULL, '2026-09-02 10:00:00'),
    (3, 'wiki:goblin', 'fauna', 'Goblin', NULL, 'Goblin', 'goblin', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'wiki', 'retired', NULL, '2026-09-03 10:00:00'),
    (4, 'wiki:ork', 'spezies', 'Ork', NULL, 'Ork', 'ork', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'wiki', 'active', NULL, '2026-09-03 10:00:00')");
$pdo->exec("CREATE TABLE lore_place (
    id INTEGER PRIMARY KEY, entry_wiki_key TEXT NOT NULL, place_wiki_key TEXT NOT NULL, place_title TEXT NOT NULL, relation TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'wiki', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NULL
)");
$pdo->exec("INSERT INTO lore_place (id, entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status, created_at) VALUES
    (1, 'wiki:alraune', 'wiki:weiden', 'Weiden', 'verbreitung', 0, 'wiki', 'active', '2026-09-01 10:00:00'),
    (2, 'wiki:alraune', 'wiki:kosch', 'Kosch', 'verbreitung', 1, 'wiki', 'suppressed', '2026-09-01 10:00:00'),
    (3, 'wiki:alraune', 'wiki:angbar', 'Angbar', 'vorkommen', 9999, 'manual', 'active', '2026-09-04 10:00:00'),
    (4, 'wiki:ork', 'wiki:orkland', 'Orkland', 'regionen', 0, 'wiki', 'active', '2026-09-04 10:00:00')");
$pdo->exec("CREATE TABLE lore_rule (
    id INTEGER PRIMARY KEY, entry_wiki_key TEXT NOT NULL, relation TEXT NOT NULL DEFAULT 'verbreitung', origin TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NULL, created_by INTEGER NULL
)");
$pdo->exec("INSERT INTO lore_rule (id, entry_wiki_key, relation, origin, status, sort_order, created_at, created_by) VALUES
    (7, 'wiki:alraune', 'verbreitung', 'manual', 'active', 0, '2026-09-05 10:00:00', 4242),
    (8, 'wiki:alraune', 'verbreitung', 'wiki_verbreitung', 'active', 0, '2026-09-06 10:00:00', 4242),
    (9, 'wiki:ork', 'regionen', 'manual', 'active', 0, '2026-09-06 10:00:00', 4242)");
// ⚠️ Die Kennungen der Bedingungen laufen GEGEN ihre Reihenfolge (seq 0 = id 21): nur so prueft B10 das ORDER BY seq.
$pdo->exec("CREATE TABLE lore_rule_term (
    id INTEGER PRIMARY KEY, rule_id INTEGER NOT NULL, seq INTEGER NOT NULL, join_op TEXT NOT NULL DEFAULT 'und',
    area_public_id TEXT NULL, climate_from TEXT NULL, climate_to TEXT NULL
)");
$pdo->exec("INSERT INTO lore_rule_term (id, rule_id, seq, join_op, area_public_id, climate_from, climate_to) VALUES
    (20, 7, 1, 'oder', NULL, 'gemaessigt', 'subtropisch'),
    (21, 7, 0, 'und', 'flaeche-reichsforst', NULL, NULL),
    (22, 8, 0, 'und', NULL, NULL, NULL),
    (99, 404, 0, 'und', 'flaeche-weg', NULL, NULL),
    (23, 9, 0, 'und', 'flaeche-ork', NULL, NULL)");
$pdo->exec("CREATE TABLE lore_rule_term_type (term_id INTEGER NOT NULL, kind TEXT NOT NULL, region_type TEXT NOT NULL, PRIMARY KEY (term_id, kind, region_type))");
$pdo->exec("INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (21, 'vegetation', 'wald'), (22, 'vegetation', 'sumpf'), (22, 'vegetation', 'auwald'), (23, 'topographie', 'gebirge')");
$pdo->exec("CREATE TABLE sources (
    id INTEGER PRIMARY KEY, url TEXT NOT NULL, url_hash TEXT NOT NULL, wiki_key TEXT NULL, label TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'sonstiges',
    is_official INTEGER NOT NULL DEFAULT 0, created_by INTEGER NULL, created_at TEXT NOT NULL, license TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '',
    own_fields TEXT NOT NULL DEFAULT '', no_corpus INTEGER NOT NULL DEFAULT 0
)");
$pdo->exec("INSERT INTO sources (id, url, url_hash, wiki_key, label, is_official, created_by, created_at) VALUES
    (1, '', '" . hash('sha256', 'wikipub:wiki:zoo-botanica') . "', 'wiki:zoo-botanica', 'Zoo-Botanica Aventurica', 1, 4242, '2026-01-09 10:00:00'),
    (2, 'https://example.org/kraeuter', '" . hash('sha256', 'https://example.org/kraeuter') . "', NULL, 'Kraeuterkunde', 0, 4242, '2026-01-02 10:00:00'),
    (3, 'https://example.org/nur-karte', '" . hash('sha256', 'https://example.org/nur-karte') . "', NULL, 'Nur Karte', 0, 4242, '2026-01-03 10:00:00'),
    (4, 'https://example.org/orkenkunde', '" . hash('sha256', 'https://example.org/orkenkunde') . "', NULL, 'Orkenkunde', 0, 4242, '2026-01-04 10:00:00')");
$pdo->exec("CREATE TABLE feature_sources (
    id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
    created_by INTEGER NULL, created_at TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL, note TEXT NULL
)");
$pdo->exec("INSERT INTO feature_sources (id, entity_type, entity_public_id, source_id, status, created_by, created_at, origin, reference_kind, pages) VALUES
    (1, 'lore', 'wiki:alraune', 2, 'approved', 4242, '2026-02-01 10:00:00', 'manual', NULL, NULL),
    (2, 'lore', 'wiki:alraune', 1, 'suppressed', 4242, '2026-02-02 10:00:00', 'wiki_publication', 'ausfuehrlich', '88'),
    (3, 'settlement', 'ort-1', 3, 'approved', 4242, '2026-02-03 10:00:00', 'manual', NULL, NULL),
    (4, 'lore', 'wiki:ork', 4, 'approved', 4242, '2026-02-04 10:00:00', 'manual', NULL, NULL)");
$pdo->exec("CREATE TABLE source_corpus (corpus_key TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', form TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT '',
    license TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '', is_official INTEGER NOT NULL DEFAULT 0, updated_by INTEGER NULL, updated_at TEXT NOT NULL)");
$pdo->exec("CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NULL)");
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value, updated_at) VALUES ('lore_kind_spezies_enabled', '0', '2026-09-01 10:00:00')");

// =====================================================================================================
// A.–C. INHALT
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsLoreExportLesen($pdo), 'D1');
assert(array_keys($export) === ['ok', 'map_revision', 'lore_revision', 'kinds_enabled', 'counts', 'entries', 'places', 'rules', 'sources', 'links'], 'A1: die Antwortform');
exportTestGenauFelder($export['entries'], AVESMAPS_LORE_EXPORT_EINTRAG_FELDER, 'A2 Eintraege');
exportTestGenauFelder($export['places'], AVESMAPS_LORE_EXPORT_ORT_FELDER, 'A3 Ortszeilen');
exportTestGenauFelder($export['rules'], AVESMAPS_LORE_EXPORT_REGEL_FELDER, 'A4 Regeln');
exportTestGenauFelder($export['rules'][0]['terms'], AVESMAPS_LORE_EXPORT_BEDINGUNG_FELDER, 'A5 Bedingungen');
exportTestGenauFelder($export['rules'][0]['terms'][0]['region_types'], AVESMAPS_LORE_EXPORT_REGIONSTYP_FELDER, 'A6 Regionstypen');
exportTestGenauFelder($export['sources'], AVESMAPS_QUELLEN_EXPORT_KATALOG_FELDER, 'A7 Katalog');
exportTestGenauFelder($export['links'], AVESMAPS_QUELLEN_EXPORT_VERKNUEPFUNG_FELDER, 'A8 Verknuepfungen');
foreach (['created_by', 'GEHEIM-BILDURHEBER', 'geheim.example', 'image_url', 'raw_json', 'merkmale_json', 'field_origins_json'] as $verboten) {
    assert(!exportTestEnthaelt($export, $verboten), "A9: 🔴 '{$verboten}' taucht nirgends auf");
}

$eintraege = array_column($export['entries'], null, 'wiki_key');
assert(array_keys($eintraege) === ['wiki:alraune', 'wiki:goblin', 'wiki:leinoel'], 'B1: ALLE Zustaende (active, retired, suppressed), nach Schluessel');
assert($eintraege['wiki:leinoel']['status'] === 'suppressed' && $eintraege['wiki:goblin']['status'] === 'retired', 'B2: der Zustand reist mit');
assert($eintraege['wiki:alraune']['merkmale'] === ['verbreitung' => '[[Weiden]], [[Kosch]]'], 'B3: merkmale_json geht GELESEN hinaus');
assert($eintraege['wiki:alraune']['field_origins'] === ['gruppe' => 'manual'], 'B4: field_origins_json ebenso');
assert($eintraege['wiki:leinoel']['merkmale'] === null && $eintraege['wiki:leinoel']['field_origins'] === null, 'B5: leere JSON-Spalten sind null');
assert($eintraege['wiki:leinoel']['match_key'] === 'leinl', 'B6: match_key ist der GESPEICHERTE Wert (wird bei Umbenennung nicht nachgezogen)');

$orte = $export['places'];
assert(count($orte) === 3 && $orte[1]['status'] === 'suppressed' && $orte[1]['origin'] === 'wiki', 'B7: 🔴 der Grabstein einer Wiki-Ortszeile ist da');
assert($orte[2]['origin'] === 'manual' && $orte[2]['relation'] === 'vorkommen' && $orte[2]['sort_order'] === 9999, 'B8: Handarbeit (manual, vorkommen) mit ihrer Reihenfolge');

$regeln = $export['rules'];
assert(array_column($regeln, 'id') === [7, 8], 'B9: Regeln nach Eintrag, Reihenfolge, Kennung -- id als Information');
assert(array_column($regeln[0]['terms'], 'seq') === [0, 1], 'B10: Bedingungen nach seq geordnet (gespeichert in anderer Reihenfolge)');
assert($regeln[0]['terms'][0]['area_public_id'] === 'flaeche-reichsforst' && $regeln[0]['terms'][0]['region_types'] === [['kind' => 'vegetation', 'region_type' => 'wald']], 'B11: Flaeche und Regionstyp einer Bedingung');
assert($regeln[0]['terms'][1]['climate_from'] === 'gemaessigt' && $regeln[0]['terms'][1]['climate_to'] === 'subtropisch' && $regeln[0]['terms'][1]['join_op'] === 'oder', 'B12: Klimaband von bis und Verknuepfung');
assert(array_column($regeln[1]['terms'][0]['region_types'], 'region_type') === ['auwald', 'sumpf'], 'B13: mehrere Regionstypen geordnet');
assert($regeln[1]['origin'] === 'wiki_verbreitung', 'B14: die Herkunft der Regel');

assert(array_column($export['sources'], 'id') === [1, 2], 'B15: nur die Quellen der Vorkommen (3 haengt an einem Ort)');
$links = $export['links'];
assert(count($links) === 2 && $links[0]['source_id'] === 1 && $links[0]['position'] === 0 && $links[1]['source_id'] === 2, 'B16: Anzeigereihenfolge (offiziell zuerst) -- auch ueber den Grabstein hinweg');
assert($links[0]['status'] === 'suppressed' && $links[0]['origin'] === 'wiki_publication' && $links[0]['pages'] === '88', 'B17: 🔴 die unterdrueckte Lore-Quelle mit Herkunft');
assert($links[0]['entity_type'] === 'lore' && $links[0]['entity_public_id'] === 'wiki:alraune' && $links[0]['entity_active'] === null, 'B18: Traeger ist der Eintrag');
assert($links[0]['source_url_hash'] === hash('sha256', 'wikipub:wiki:zoo-botanica'), 'B19: die Quellenidentitaet je Verknuepfung');

assert($export['kinds_enabled'] === ['flora' => true, 'fauna' => true, 'spezies' => false, 'ware' => true], 'C1: die Schalter je Art, streng gelesen: ' . json_encode($export['kinds_enabled']));
foreach (['wiki:ork', 'Orkland', 'flaeche-ork', 'Orkenkunde', 'orkenkunde'] as $gesperrt) {
    assert(!exportTestEnthaelt($export, $gesperrt), "C2: 🔴 der NOTAUS je Art: '{$gesperrt}' (abgeschaltete Art spezies) geht nirgends hinaus -- weder Eintrag noch Ort, Regel oder Quelle");
}
assert($export['counts'] === [
    'entries' => 3, 'withheld_entries' => 1, 'places' => 3, 'rules' => 2, 'rule_terms' => 3, 'rule_term_types' => 3, 'orphaned_rule_terms' => 1,
    'sources' => 2, 'links' => 2, 'links_by_status' => ['approved' => 1, 'suppressed' => 1], 'links_by_origin' => ['manual' => 1, 'wiki_publication' => 1],
], 'C3: die Zaehler zur Gegenprobe (die Bedingung ohne Regel wird gezaehlt): ' . json_encode($export['counts']));

// =====================================================================================================
// D. STAND
// =====================================================================================================
$vorher = $export['lore_revision'];
$pdo->exec("UPDATE lore_place SET status = 'suppressed' WHERE id = 1");
$nachGrabstein = avesmapsLoreExportLesen($pdo)['lore_revision'];
assert($nachGrabstein !== $vorher, 'D2: 💣 ein neuer Ort-Grabstein (kein Zeitstempel, keine Zahl aendert sich) hebt den Stand');
$pdo->exec("UPDATE lore_rule SET origin = 'manual' WHERE id = 8");
assert(avesmapsLoreExportLesen($pdo)['lore_revision'] !== $nachGrabstein, 'D3: eine umgeschriebene Regel (lore_rule hat kein updated_at) hebt den Stand');
$pdo->exec('DROP TABLE app_setting');
$geworfen = false;
try {
    avesmapsLoreExportArtenAn($pdo); // die Schalter allein -- der Fingerabdruck liest app_setting ohnehin
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen, 'D4: 🔴 die Schalter werden streng gelesen -- ein Lesefehler ist ein 500, nie „an"');

// =====================================================================================================
// E. ENDPUNKT, BIBLIOTHEK, BEISPIELANTWORT
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/lore-export.php', 'avesmapsLoreExportLesen', false, 'E1');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/lore-export.php', 'E2');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/lore-export.php'));
foreach (['created_by', 'image_', 'avesmapsLoreEnabledKinds', 'avesmapsLoreKindEnabled(', 'avesmapsLoreReadCatalog', 'avesmapsReadFeatureSources'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "E3: die Bibliothek benutzt '{$verboten}' nicht (Personenspalte, Bildspalten oder ein Leser mit DDL)");
}
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/lore-export.beispiel.json'), true);
assert(is_array($beispiel), 'E4: die Beispielantwort liegt vor');
exportTestFormGleich($beispiel, $export, 'lore-export');

echo "lore-export-test: alle Zusicherungen erfuellt\n";
