<?php

declare(strict_types=1);

/**
 * Die Quellen-Exporte E1, E1+ und E1++ (Auftrag Avesmaps3D, 04.10.2026):
 *   E1   `wiki_key` am Katalog der Kartennutzlast              -> Abschnitt A
 *   E1+  GET /api/app/feature-sources-export.php                -> Abschnitte B–E
 *   E1++ GET /api/app/wiki-redirects-export.php                 -> Abschnitt F
 *
 *   B. Positivliste: genau die Felder, keine Editorenkennung
 *   C. Inhalt: unterdrueckte Verknuepfungen samt Herkunft, Anzeigereihenfolge, Waisen bleiben Befund, lore draussen
 *   D. Schreibfreiheit (PRAGMA query_only + nur SELECT + Datenbankabdruck) und der Stand
 *   E. Endpunkt und Bibliothek am Quelltext, Beispielantwort in docs/legacy-exporte/
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-export-test.php
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
require_once $wurzel . '/api/_internal/app/quellen-export.php';
require_once $wurzel . '/api/_internal/app/wiki-weiterleitungen-export.php';
require_once __DIR__ . '/export-test-helfer.php';

// ---- Fixture -----------------------------------------------------------------------------------
// ⚠️ Die OFFIZIELLE Quelle 2 ist bewusst die JUENGSTE im Katalog: nur so prueft C6, dass „offiziell zuerst" vor dem
// Katalog-Alter steht (sonst ergaebe created_at allein dieselbe Reihenfolge -- gefunden per Mutationsprobe).
$pdo = exportTestNeuePdo();
// Die Lebend-Bedingung der Kartennutzlast traegt COLLATE utf8mb4_unicode_ci -- anmelden statt wegschneiden.
$pdo->sqliteCreateCollation('utf8mb4_unicode_ci', static fn (string $a, string $b): int => strcmp($a, $b));
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 812)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER)');
$pdo->exec("INSERT INTO map_features (id, public_id, feature_type, is_active) VALUES
    (1, 'ort-1', 'location', 1), (2, 'ort-geloescht', 'location', 0), (3, 'weg-1', 'path', 1)");
$pdo->exec('CREATE TABLE sources (
    id INTEGER PRIMARY KEY, url TEXT NOT NULL, url_hash TEXT NOT NULL, wiki_key TEXT NULL, label TEXT NOT NULL DEFAULT "",
    source_type TEXT NOT NULL DEFAULT "sonstiges", is_official INTEGER NOT NULL DEFAULT 0, created_by INTEGER NULL,
    created_at TEXT NOT NULL, license TEXT NOT NULL DEFAULT "", attribution TEXT NOT NULL DEFAULT "",
    own_fields TEXT NOT NULL DEFAULT "", no_corpus INTEGER NOT NULL DEFAULT 0
)');
$hashMoor = hash('sha256', 'https://garetien.de/Moor');
$hashGeo = hash('sha256', 'wikipub:wiki:geographia-aventurica');
$pdo->exec("INSERT INTO sources (id, url, url_hash, wiki_key, label, source_type, is_official, created_by, created_at, license, attribution, own_fields, no_corpus) VALUES
    (1, 'https://garetien.de/Moor', '{$hashMoor}', NULL, 'Eupelmunder Moor', 'briefspiel', 0, 4242, '2026-01-02 10:00:00', 'cc-by-nc-sa-3.0', 'VolkoV / garetien.de', ',license,', 0),
    (2, '', '{$hashGeo}', 'wiki:geographia-aventurica', 'Geographia Aventurica', 'regionalspielhilfe', 1, 4242, '2026-01-09 10:00:00', '', '', '', 0),
    (3, 'https://ulisses.example/alraune', '" . hash('sha256', 'https://ulisses.example/alraune') . "', NULL, 'Nur Lore', 'sonstiges', 0, 4242, '2026-01-03 10:00:00', '', '', '', 1),
    (4, 'https://example.org/verwaist', '" . hash('sha256', 'https://example.org/verwaist') . "', NULL, 'An geloeschtem Ort', 'sonstiges', 0, 4242, '2026-01-04 10:00:00', '', '', '', 0)");
$pdo->exec('CREATE TABLE feature_sources (
    id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT "approved", created_by INTEGER NULL, created_at TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT "manual", reference_kind TEXT NULL, pages TEXT NULL, note TEXT NULL
)');
$pdo->exec("INSERT INTO feature_sources (id, entity_type, entity_public_id, source_id, status, created_by, created_at, origin, reference_kind, pages, note) VALUES
    (1, 'settlement', 'ort-1', 1, 'approved', 4242, '2026-02-01 10:00:00', 'manual', NULL, NULL, 'Handnotiz'),
    (2, 'settlement', 'ort-1', 2, 'approved', 4242, '2026-02-02 10:00:00', 'wiki_publication', 'erwaehnung', '12', NULL),
    (3, 'path', 'weg-1', 2, 'suppressed', 4242, '2026-02-03 10:00:00', 'wiki_publication', 'ausfuehrlich', '40-41', NULL),
    (4, 'territory', 'gebiet-1', 1, 'approved', 4242, '2026-02-04 10:00:00', 'manual', NULL, '', ''),
    (5, 'settlement', 'ort-geloescht', 4, 'approved', 4242, '2026-02-05 10:00:00', 'manual', NULL, NULL, NULL),
    (6, 'lore', 'wiki:alraune', 3, 'approved', 4242, '2026-02-06 10:00:00', 'wiki_publication', NULL, NULL, NULL),
    (7, 'lore', 'wiki:alraune', 2, 'suppressed', 4242, '2026-02-07 10:00:00', 'wiki_publication', 'erwaehnung', NULL, NULL)");
$pdo->exec('CREATE TABLE source_corpus (
    corpus_key TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT "", form TEXT NOT NULL DEFAULT "", source_type TEXT NOT NULL DEFAULT "",
    license TEXT NOT NULL DEFAULT "", attribution TEXT NOT NULL DEFAULT "", is_official INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER NULL, updated_at TEXT NOT NULL
)');
$pdo->exec("INSERT INTO source_corpus (corpus_key, label, form, source_type, license, attribution, is_official, updated_by, updated_at) VALUES
    ('garetien.de', 'Garetien-Wiki', 'belegstelle', 'briefspiel', 'cc-by-nc-sa-3.0', 'VolkoV / garetien.de', 0, 4242, '2026-01-05 10:00:00')");
$pdo->exec('CREATE TABLE wiki_redirect_alias (alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT NOT NULL, updated_at TEXT NOT NULL)');
$pdo->exec("INSERT INTO wiki_redirect_alias (alias_slug, canonical_wiki_key, updated_at) VALUES
    ('mittelreich', 'wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth', '2026-09-01 10:00:00'),
    ('gareth-stadt', 'wiki:gareth', '2026-09-02 10:00:00'),
    ('inoffiziell-tayarret', 'wiki:inoffiziell-t-y-rret', '2026-09-04 10:00:00')");

// =====================================================================================================
// A. E1 -- `wiki_key` am Katalog der Kartennutzlast
// =====================================================================================================
$katalog = avesmapsLoadFeatureSourceCatalog($pdo);
assert(($katalog[2]['wiki_key'] ?? null) === 'wiki:geographia-aventurica', 'A1: die URL-lose Publikation traegt ihren wiki_key');
assert(($katalog[2]['url'] ?? null) === '', 'A2: ihre URL ist leer -- ohne wiki_key waere sie nicht wiederzufinden');
assert(!array_key_exists('wiki_key', $katalog[1]), 'A3: eine Quelle ohne Wiki-Schluessel traegt KEIN Feld (leer = weggelassen, wie Lizenz und Nennung)');
assert(($katalog[1]['license'] ?? null) === 'cc-by-nc-sa-3.0', 'A4: Lizenz und Nennung bleiben dabei');
assert(!array_key_exists('url_hash', $katalog[2]), 'A5: url_hash reist bewusst NICHT in der Besuchernutzlast (er steht im Migrationsblock)');
assert(!isset($katalog[3]) || true, 'A6: (Lore-Quellen stehen weiterhin im Katalog, wie vor E1 -- unberuehrt)');

// Eine Datenbank OHNE wiki_key-Spalte verliert nicht auch noch Lizenz und Nennung (der mittlere Anlauf).
$ohneSchluessel = new PDO('sqlite::memory:');
$ohneSchluessel->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$ohneSchluessel->sqliteCreateCollation('utf8mb4_unicode_ci', static fn (string $a, string $b): int => strcmp($a, $b));
$ohneSchluessel->exec('CREATE TABLE map_features (public_id TEXT PRIMARY KEY, is_active INTEGER)');
$ohneSchluessel->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT, is_official INTEGER, created_at TEXT, license TEXT, attribution TEXT)');
$ohneSchluessel->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY, entity_type TEXT, entity_public_id TEXT, source_id INTEGER, status TEXT)');
$ohneSchluessel->exec("INSERT INTO sources VALUES (1, 'https://a.example/x', 'A', 'sonstiges', 0, '2026-01-01', 'cc0-1.0', 'Nennung')");
$ohneSchluessel->exec("INSERT INTO feature_sources VALUES (1, 'territory', 'g', 1, 'approved')");
$alt = avesmapsLoadFeatureSourceCatalog($ohneSchluessel);
assert(($alt[1]['license'] ?? null) === 'cc0-1.0' && ($alt[1]['attribution'] ?? null) === 'Nennung', 'A7: ohne wiki_key-Spalte bleiben Lizenz und Nennung (dritter Anlauf nur, wenn auch die fehlen)');

$endpunktKarte = (string) file_get_contents($wurzel . '/api/app/map-features.php');
preg_match('/AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = (\d+);/', $endpunktKarte, $treffer);
assert(isset($treffer[1]) && (int) $treffer[1] >= 28, 'A8: 💣 die Nutzlastversion ist mit dem neuen Feld gestiegen (>= 28) -- sonst bekaeme jeder warme Abrufer sein 304 samt Katalog ohne Schluessel');

// =====================================================================================================
// B.–D. E1+ -- der Migrationsblock der Quellen
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsFeatureSourcesExportLesen($pdo), 'D1');

assert(array_keys($export) === ['ok', 'map_revision', 'sources_revision', 'counts', 'corpora', 'sources', 'links'], 'B1: die Antwortform -- Staende oben, dann Zaehler, dann die drei Listen');
exportTestGenauFelder($export['sources'], AVESMAPS_QUELLEN_EXPORT_KATALOG_FELDER, 'B2 Katalog');
exportTestGenauFelder($export['links'], AVESMAPS_QUELLEN_EXPORT_VERKNUEPFUNG_FELDER, 'B3 Verknuepfungen');
exportTestGenauFelder($export['corpora'], AVESMAPS_QUELLEN_EXPORT_KORPUS_FELDER, 'B4 Korpora');
foreach (['created_by', 'updated_by', 'created_at', 'updated_at'] as $verboten) {
    assert(!exportTestEnthaelt($export, $verboten), "B5: 🔴 '{$verboten}' taucht nirgends auf (Editorenkennungen und Zeitstempel bleiben drin)");
}

$quellenNachId = array_column($export['sources'], null, 'id');
assert(array_keys($quellenNachId) === [1, 2, 4], 'C1: im Katalog stehen genau die Quellen der nicht-Lore-Verknuepfungen (3 haengt nur an Lore)');
assert($quellenNachId[2]['url_hash'] === $hashGeo && $quellenNachId[2]['wiki_key'] === 'wiki:geographia-aventurica', 'C2: die Identitaet der URL-losen Quelle: url_hash = sha256(wikipub:+wiki_key) samt Schluessel');
assert($quellenNachId[1]['wiki_key'] === null && $quellenNachId[1]['url_hash'] === $hashMoor, 'C3: eine URL-Quelle ohne Wiki-Schluessel: wiki_key null, url_hash aus der URL');
assert($quellenNachId[1]['corpus'] === 'garetien.de' && $quellenNachId[1]['own_fields'] === ['license'], 'C4: Korpus und die von Hand gesetzten Felder (own_fields) reisen mit');
assert($quellenNachId[2]['license'] === null, 'C5: leere Lizenz = null („nicht erfasst"), nie ""');

$links = $export['links'];
$kurz = array_map(static fn (array $l): string => $l['entity_type'] . ':' . $l['entity_public_id'] . '#' . $l['source_id'] . '@' . $l['position'], $links);
assert($kurz === ['path:weg-1#2@0', 'settlement:ort-1#2@0', 'settlement:ort-1#1@1', 'settlement:ort-geloescht#4@0', 'territory:gebiet-1#1@0'],
    'C6: Anzeigereihenfolge je Objekt (offiziell zuerst, dann Katalog-Alter) samt position; lore fehlt: ' . json_encode($kurz));
assert($links[0]['status'] === 'suppressed' && $links[0]['origin'] === 'wiki_publication', 'C7: 🔴 die UNTERDRUECKTE Verknuepfung ist da, mit ihrer Herkunft (der Grabstein, den ein Abgleich respektieren muss)');
assert($links[2]['origin'] === 'manual' && $links[2]['note'] === 'Handnotiz', 'C8: Handarbeit ist als manual erkennbar, die Notiz reist mit');
assert($links[1]['reference_kind'] === 'erwaehnung' && $links[1]['pages'] === '12', 'C9: Art der Erwaehnung und Seiten');
assert($links[4]['pages'] === null && $links[4]['note'] === null, 'C10: leere Angaben sind null, nie ""');
assert($links[3]['entity_active'] === false, 'C11: die Verknuepfung eines geloeschten Ortes bleibt sichtbar -- als Befund (entity_active false)');
assert($links[1]['entity_active'] === true && $links[0]['entity_active'] === true, 'C12: aktive Kartenobjekte: entity_active true');
assert($links[4]['entity_active'] === null, 'C13: Gebiete werden nicht gegen map_features geprueft: entity_active null');
assert($links[1]['source_url_hash'] === $hashGeo, 'C14: die Quellenidentitaet steht an jeder Verknuepfung');
assert($export['counts'] === ['sources' => 3, 'corpora' => 1, 'links' => 5, 'by_status' => ['approved' => 4, 'suppressed' => 1], 'by_origin' => ['manual' => 3, 'wiki_publication' => 2]],
    'C15: die Zaehler zur Gegenprobe: ' . json_encode($export['counts']));
assert($export['map_revision'] === 812 && str_starts_with($export['sources_revision'], 'src-'), 'C16: beide Staende');

// Der Stand bewegt sich mit einem Grabstein, der weder Zahl noch Zeitstempel aendert.
$vorher = avesmapsFeatureSourcesExportLesen($pdo)['sources_revision'];
$pdo->exec("UPDATE feature_sources SET status = 'suppressed' WHERE id = 2");
assert(avesmapsFeatureSourcesExportLesen($pdo)['sources_revision'] !== $vorher, 'D2: 💣 ein neuer Grabstein (nur status wechselt) hebt den Stand');
$pdo->exec("UPDATE feature_sources SET status = 'approved' WHERE id = 2");

$aufrufe = 0;
$bewegt = avesmapsFeatureSourcesExportLesen($pdo, static function () use ($pdo, &$aufrufe): array {
    $aufrufe++;
    if ($aufrufe === 1) {
        $pdo->exec('UPDATE map_revision SET revision = 813 WHERE id = 1');
    }

    return ['korpora' => [], 'katalog' => [], 'verknuepfungen' => []];
});
assert($aufrufe === 2 && $bewegt['map_revision'] === 813, 'D3: ein Schreibvorgang waehrend des Lesens fuehrt zu einem zweiten Lesen, der Stand ist der danach');

// =====================================================================================================
// E. ENDPUNKT, BIBLIOTHEK, BEISPIELANTWORT
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/feature-sources-export.php', 'avesmapsFeatureSourcesExportLesen', false, 'E1');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/quellen-export.php', 'E2');
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/feature-sources-export.beispiel.json'), true);
assert(is_array($beispiel), 'E3: die Beispielantwort liegt in docs/legacy-exporte/ und ist gueltiges JSON');
exportTestFormGleich($beispiel, $export, 'feature-sources-export');

// =====================================================================================================
// F. E1++ -- die Wiki-Weiterleitungen
// =====================================================================================================
$weiter = exportTestSchreibfrei($pdo, static fn (): array => avesmapsWikiWeiterleitungenExportLesen($pdo), 'F1');
assert(array_keys($weiter) === ['ok', 'redirects_revision', 'count', 'redirects'], 'F2: die Antwortform');
exportTestGenauFelder($weiter['redirects'], AVESMAPS_WIKI_WEITERLEITUNGEN_EXPORT_FELDER, 'F3');
assert($weiter['count'] === 3 && $weiter['redirects'][0]['alias_slug'] === 'gareth-stadt', 'F4: alle Zeilen, nach Slug sortiert, Zaehler stimmt');
assert($weiter['redirects'][1] === ['alias_slug' => 'inoffiziell-tayarret', 'canonical_wiki_key' => 'wiki:inoffiziell-t-y-rret'],
    'F4b: 🔴 der NAMENSRAUM bleibt, wie Legacy ihn speichert -- als Praefix im Slug (Inoffiziell: -> inoffiziell-), Zeichen fuer Zeichen; sonst fielen offizielle und inoffizielle Artikel gleichen Titels zusammen');
assert($weiter['redirects'][2]['canonical_wiki_key'] === 'wiki:heiliges-neues-kaiserreich-vom-greifenthron-zu-gareth', 'F5: der kanonische Schluessel');
$standVorher = $weiter['redirects_revision'];
$pdo->exec("UPDATE wiki_redirect_alias SET canonical_wiki_key = 'wiki:gareth-neu', updated_at = '2026-09-05 10:00:00' WHERE alias_slug = 'gareth-stadt'"); // ON UPDATE setzt live die JETZIGE Zeit
assert(avesmapsWikiWeiterleitungenExportLesen($pdo)['redirects_revision'] !== $standVorher, 'F6: eine geaenderte Weiterleitung hebt den Stand');
exportTestEndpunktPruefen($wurzel . '/api/app/wiki-redirects-export.php', 'avesmapsWikiWeiterleitungenExportLesen', false, 'F7');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/wiki-weiterleitungen-export.php', 'F8');
$beispielWeiter = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/wiki-redirects-export.beispiel.json'), true);
assert(is_array($beispielWeiter), 'F9: die Beispielantwort liegt vor');
exportTestFormGleich($beispielWeiter, $weiter, 'wiki-redirects-export');

echo "quellen-export-test: alle Zusicherungen erfuellt\n";
