<?php

declare(strict_types=1);

/**
 * Der Export der Wiki-Siedlungen X3 -- GET /api/app/wiki-siedlungen-export.php (Auftrag Avesmaps3D 10.10.2026).
 *
 *   A. Inhalt: nur die Ortsklassen, genau die freigegebenen Felder, nach Titel; der Key nach der Regel von X1/X2
 *      (Weiterleitung, Namensraum), leere Werte als null
 *   B. Orte: nur ueber den Key des Nests, nur aktive Orte; Legacys Namensurteil reist getrennt mit
 *   C. Was NIE hinausgeht: Zwischenspeicher der Infobox, Kategorien, Koordinaten, Wappenadresse und Lizenz, Gottheit
 *   D. Kopf: die Zahlen passen zu den Zeilen
 *   E. Schreibfreiheit und Stand (ein Anreichern bewegt ihn; ein Schreiben waehrend des Lesens ergibt 503)
 *   F. Endpunkt, Bibliothek, Beispielantwort
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/wiki-siedlungen-export-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
foreach (['mbstring', 'pdo_sqlite'] as $erweiterung) {
    if (!extension_loaded($erweiterung)) {
        fwrite(STDERR, "FATAL: Erweiterung $erweiterung fehlt -- mit -d extension=php_$erweiterung.dll starten.\n");
        exit(2);
    }
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/app/wiki-siedlungen-export.php';
require_once __DIR__ . '/export-test-helfer.php';

const WSX_WIKI = 'https://de.wiki-aventurica.de/wiki/';
const WSX_GARETH = '11111111-1111-4111-8111-000000000001';
const WSX_ALT_GARETH = '11111111-1111-4111-8111-000000000002';
const WSX_HAVENA = '11111111-1111-4111-8111-000000000003';
const WSX_TRALLOP = '11111111-1111-4111-8111-000000000004';
const WSX_GELOESCHT = '11111111-1111-4111-8111-000000000005';
const WSX_OHNE_NAME = '11111111-1111-4111-8111-000000000006';
const WSX_WEG = '11111111-1111-4111-8111-000000000007';

$pdo = exportTestNeuePdo();
foreach ([
    'CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
    'CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
    'CREATE TABLE political_territory (id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, is_active INTEGER, updated_at TEXT)',
    'CREATE TABLE wiki_redirect_alias (alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT, updated_at TEXT)',
    'CREATE TABLE wiki_sync_runs (id INTEGER PRIMARY KEY, sync_type TEXT, status TEXT, completed_at TEXT)',
    'CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT, properties_json TEXT, is_active INTEGER)',
    // Die Spalten wie in sync.php (Kern) und settlements.php (angefuegt) -- auch die, die NIE hinausgehen duerfen.
    'CREATE TABLE wiki_sync_pages (
        id INTEGER PRIMARY KEY, wiki_page_id INTEGER, title TEXT NOT NULL UNIQUE, normalized_key TEXT NOT NULL DEFAULT \'\',
        wiki_url TEXT NOT NULL DEFAULT \'\', settlement_class TEXT, settlement_label TEXT, categories_json TEXT, coordinates_json TEXT,
        content_hash TEXT, fetched_at TEXT NOT NULL, details_json TEXT, continent TEXT, is_ruined INTEGER, coat_url TEXT,
        coat_license_status TEXT, coat_author TEXT, coat_attribution TEXT, coat_license_url TEXT, enriched_at TEXT,
        building_type TEXT, standort TEXT, lage TEXT, deity TEXT
    )',
] as $ddl) {
    $pdo->exec($ddl);
}
$pdo->exec('INSERT INTO map_revision VALUES (1, 812)');
$pdo->exec('INSERT INTO ecosystem_revision VALUES (1, 50)');
$pdo->exec("INSERT INTO wiki_redirect_alias VALUES ('havena-siedlung', 'wiki:havena', '2026-10-01 10:00:00')");

$seite = $pdo->prepare(
    'INSERT INTO wiki_sync_pages (title, wiki_url, settlement_class, settlement_label, fetched_at, enriched_at, continent, is_ruined,
        coat_url, coat_author, coat_license_status, building_type, standort, lage, details_json, categories_json, coordinates_json,
        content_hash, deity)
     VALUES (:title, :url, :klasse, :label, :abgerufen, :angereichert, :kontinent, :ruine, :wappen, :urheber, :lizenz, :typ, :standort,
        :lage, :details, :kategorien, :koordinaten, :hash, :gott)'
);
$seiteAnlegen = static function (array $werte) use ($seite): void {
    $seite->execute($werte + [
        'url' => WSX_WIKI . rawurlencode(str_replace(' ', '_', (string) $werte['title'])),
        'label' => null, 'abgerufen' => '2026-09-08 12:00:00.000', 'angereichert' => null, 'kontinent' => 'Aventurien', 'ruine' => 0,
        'wappen' => null, 'urheber' => null, 'lizenz' => null, 'typ' => null, 'standort' => null, 'lage' => null, 'details' => null,
        'kategorien' => null, 'koordinaten' => null, 'hash' => null, 'gott' => null,
    ]);
};
$seiteAnlegen(['title' => 'Gareth', 'klasse' => 'metropole', 'label' => 'Metropole', 'abgerufen' => '2026-09-08 12:00:00.123',
    'angereichert' => '2026-09-08 12:05:00', 'lage' => 'Garetien · Mittelreich',
    'wappen' => WSX_WIKI . 'Datei:GEHEIM-WAPPEN.png', 'urheber' => 'GEHEIM-URHEBER', 'lizenz' => 'GEHEIM-LIZENZ',
    'details' => '{"GEHEIM-DETAILS":1}', 'kategorien' => '["GEHEIM-KATEGORIE"]', 'koordinaten' => '{"GEHEIM-KOORDINATEN":1}',
    'hash' => 'GEHEIM-INHALTSHASH', 'gott' => 'GEHEIM-GOTTHEIT']);
// Eine Weiterleitung: der Titel ist ein Alias, der Key der Zielseite gilt.
$seiteAnlegen(['title' => 'Havena (Siedlung)', 'klasse' => 'grossstadt', 'label' => 'Großstadt']);
// Im Wiki, nirgends auf der Karte -- nur ein GELOESCHTER Ort trug sie einmal.
$seiteAnlegen(['title' => 'Baronie Ochsenblut', 'klasse' => 'dorf', 'label' => 'Dorf', 'ruine' => 1]);
// Ein Ort gleichen NAMENS steht auf der Karte, aber ohne Zuweisung: fuer Legacy „auf der Karte", fuer den Key nicht.
$seiteAnlegen(['title' => 'Trallop', 'klasse' => 'stadt', 'label' => 'Stadt']);
$seiteAnlegen(['title' => 'Inoffiziell:Kleewiesen', 'klasse' => 'dorf', 'label' => 'Dorf']);
// Lineare Infrastruktur, die der Bauwerks-Crawl als Gebaeude eintrug: Legacys Liste blendet sie aus.
$seiteAnlegen(['title' => 'Reichsstraße 3', 'klasse' => 'gebaeude', 'label' => 'Gebäude', 'typ' => 'Reichsstraße']);
// Leere Werte: Ruine unbekannt (NULL), Kontinent und Typ leer.
$seiteAnlegen(['title' => 'Arenaviertel', 'klasse' => 'stadtviertel', 'label' => 'Stadtviertel', 'ruine' => null, 'kontinent' => '',
    'typ' => '', 'standort' => '[[Gareth]]: [[Arenaviertel]]']);
// Keine Orte: ohne Klasse, und eine fremde Klasse.
$seiteAnlegen(['title' => 'Rubbel', 'klasse' => null]);
$seiteAnlegen(['title' => 'Kosch', 'klasse' => 'region']);

$ort = $pdo->prepare('INSERT INTO map_features (public_id, feature_type, feature_subtype, name, properties_json, is_active) VALUES (?, ?, ?, ?, ?, ?)');
$nest = static fn(string $titel): string => json_encode(['wiki_settlement' => ['title' => $titel, 'wiki_url' => WSX_WIKI . rawurlencode(str_replace(' ', '_', $titel))]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$ort->execute([WSX_GARETH, 'location', 'metropole', 'Gareth', $nest('Gareth'), 1]);
$ort->execute([WSX_ALT_GARETH, 'location', 'dorf', 'Alt-Gareth', $nest('Gareth'), 1]);
$ort->execute([WSX_HAVENA, 'location', 'grossstadt', 'Havena', $nest('Havena (Siedlung)'), 1]);
$ort->execute([WSX_TRALLOP, 'location', 'stadt', 'Trallop', '{}', 1]);
$ort->execute([WSX_GELOESCHT, 'location', 'dorf', 'Ochsenblut', $nest('Baronie Ochsenblut'), 0]);
$ort->execute([WSX_OHNE_NAME, 'location', 'dorf', '', $nest('Inoffiziell:Kleewiesen'), 1]);
// Ein WEG mit Siedlungs-Nest ist kein Ort.
$ort->execute([WSX_WEG, 'path', 'strasse', 'Trallop', $nest('Trallop'), 1]);

// =====================================================================================================
// A. INHALT
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsWikiSiedlungenExportLesen($pdo), 'E1');
assert(array_keys($export) === ['ok', 'map_revision', 'aliase_stempel', 'registry_revision', 'kopf', 'siedlungen'], 'A1: die Antwortform');
assert($export['ok'] === true && $export['map_revision'] === 812, 'A2: ok und die Kartenrevision');
assert(preg_match('/^wsp-[0-9a-f]{16}$/', (string) $export['registry_revision']) === 1, 'A3: der Stempel ist `wsp-<16 Hex>`');
assert(preg_match('/^ra-[0-9a-f]{16}$/', (string) $export['aliase_stempel']) === 1, 'A4: der Stempel der Weiterleitungen wie bei X1/X2');
exportTestGenauFelder($export['siedlungen'], AVESMAPS_WIKI_SIEDLUNGEN_EXPORT_FELDER, 'A5');
$titel = array_column($export['siedlungen'], 'titel');
assert($titel === ['Arenaviertel', 'Baronie Ochsenblut', 'Gareth', 'Havena (Siedlung)', 'Inoffiziell:Kleewiesen', 'Reichsstraße 3', 'Trallop'],
    'A6: genau die Ortsklassen, nach Titel geordnet -- ' . json_encode($titel, JSON_UNESCAPED_UNICODE));
$je = array_column($export['siedlungen'], null, 'titel');
assert($je['Gareth'] === [
    'titel' => 'Gareth',
    'wiki_key' => 'wiki:gareth',
    'ns' => 0,
    'ns_name' => '',
    'weiterleitung_auf' => null,
    'wiki_url' => WSX_WIKI . 'Gareth',
    'ortsklasse' => 'metropole',
    'ortsklasse_label' => 'Metropole',
    'bauwerkstyp' => null,
    'bauwerkstyp_ausgeschlossen' => false,
    'ist_ruine' => false,
    'kontinent' => 'Aventurien',
    'lage' => 'Garetien · Mittelreich',
    'standort' => null,
    'hat_wappen' => true,
    'abgerufen_am' => '2026-09-08 12:00:00.123',
    'angereichert_am' => '2026-09-08 12:05:00',
    'orte' => [WSX_GARETH, WSX_ALT_GARETH],
    'legacy_auf_karte' => true,
], 'A7: eine Zeile vollstaendig und typgerecht: ' . json_encode($je['Gareth'], JSON_UNESCAPED_UNICODE));
assert($je['Havena (Siedlung)']['wiki_key'] === 'wiki:havena'
    && $je['Havena (Siedlung)']['weiterleitung_auf'] === ['wiki_key' => 'wiki:havena', 'titel' => null, 'ns' => null, 'ns_name' => null],
    'A8: 🔴 ein Alias traegt den Key seiner Zielseite -- dieselbe Weiterleitungstafel wie X1/X2');
assert($je['Inoffiziell:Kleewiesen']['wiki_key'] === 'wiki:inoffiziell-kleewiesen' && $je['Inoffiziell:Kleewiesen']['ns'] === 222
    && $je['Inoffiziell:Kleewiesen']['ns_name'] === 'Inoffiziell', 'A9: 🔴 der Namensraum bleibt Teil des Keys und steht als Zahl daneben');
assert($je['Reichsstraße 3']['bauwerkstyp'] === 'Reichsstraße' && $je['Reichsstraße 3']['bauwerkstyp_ausgeschlossen'] === true,
    'A10: lineare Infrastruktur reist MIT und sagt, dass Legacys Liste sie ausblendet');
assert($je['Arenaviertel']['ist_ruine'] === null && $je['Arenaviertel']['kontinent'] === null && $je['Arenaviertel']['bauwerkstyp'] === null
    && $je['Arenaviertel']['bauwerkstyp_ausgeschlossen'] === false && $je['Arenaviertel']['standort'] === '[[Gareth]]: [[Arenaviertel]]',
    'A11: NULL bleibt null, Leeres wird null, der Standort bleibt roh');
assert($je['Baronie Ochsenblut']['ist_ruine'] === true, 'A12: die Ruine kommt aus der Registry');

// =====================================================================================================
// B. ORTE: nur ueber den Key, nur aktive Orte
// =====================================================================================================
assert($je['Havena (Siedlung)']['orte'] === [WSX_HAVENA], 'B1: der Ort haengt ueber den Key seines Nests, auch durch die Weiterleitung');
assert($je['Baronie Ochsenblut']['orte'] === [] && $je['Baronie Ochsenblut']['legacy_auf_karte'] === false,
    'B2: ein GELOESCHTER Ort zaehlt nicht -- die Siedlung fehlt auf der Karte');
assert($je['Trallop']['orte'] === [] && $je['Trallop']['legacy_auf_karte'] === true,
    'B3: 🔴 ein gleichnamiger Ort OHNE Zuweisung ist keine Zuordnung -- nur Legacys Namensurteil sagt „auf der Karte"');
assert($je['Inoffiziell:Kleewiesen']['orte'] === [WSX_OHNE_NAME] && $je['Inoffiziell:Kleewiesen']['legacy_auf_karte'] === false,
    'B4: ein Ort ohne Namen traegt seine Zuweisung (wie X2); Legacys Namensprobe sieht ihn nicht');
assert(!exportTestEnthaelt($export, WSX_WEG), 'B5: ein Weg mit Siedlungs-Nest ist kein Ort');
assert(!exportTestEnthaelt($export, WSX_TRALLOP) && !exportTestEnthaelt($export, WSX_GELOESCHT),
    'B6: kein Ort ohne Zuweisung und kein geloeschter Ort in einer Liste `orte`');

// =====================================================================================================
// C. WAS NIE HINAUSGEHT
// =====================================================================================================
foreach (['GEHEIM-WAPPEN', 'GEHEIM-URHEBER', 'GEHEIM-LIZENZ', 'GEHEIM-DETAILS', 'GEHEIM-KATEGORIE', 'GEHEIM-KOORDINATEN',
    'GEHEIM-INHALTSHASH', 'GEHEIM-GOTTHEIT', 'details_json', 'coat_url', 'categories', 'coordinates', 'deity', 'Rubbel', 'Kosch'] as $geheim) {
    assert(!exportTestEnthaelt($export, $geheim), "C1: 🔴 '{$geheim}' taucht nirgends auf");
}

// =====================================================================================================
// D. KOPF
// =====================================================================================================
assert($export['kopf'] === [
    'registry_zeilen' => 9,
    'siedlungen' => 7,
    'andere_klassen' => 2,
    'je_klasse' => ['metropole' => 1, 'grossstadt' => 1, 'stadt' => 1, 'kleinstadt' => 0, 'dorf' => 2, 'gebaeude' => 1, 'stadtviertel' => 1],
    'ohne_schluessel' => 0,
    'verschiedene_schluessel' => 7,
    'mit_ort' => 3,
    'ohne_ort' => 4,
    'legacy_auf_karte' => 3,
    'bauwerkstyp_ausgeschlossen' => 1,
], 'D1: die Zahlen des Kopfes: ' . json_encode($export['kopf']));
assert(array_sum($export['kopf']['je_klasse']) === count($export['siedlungen']), 'D2: die Klassen summieren sich zu den Zeilen');

// =====================================================================================================
// E. STAND
// =====================================================================================================
$vorher = $export['registry_revision'];
$pdo->exec("UPDATE wiki_sync_pages SET enriched_at = '2026-10-10 08:00:00' WHERE title = 'Trallop'");
$nachher = avesmapsWikiSiedlungenExportLesen($pdo);
assert($nachher['registry_revision'] !== $vorher, 'E2: 💣 ein Anreichern (weder Zahl noch Kennung aendern sich) hebt den Stand');
assert($nachher['registry_revision'] === avesmapsWikiSiedlungenExportLesen($pdo)['registry_revision'], 'E3: derselbe Bestand, derselbe Stempel');
$pdo->exec('UPDATE map_revision SET revision = 900 WHERE id = 1');
assert(avesmapsWikiSiedlungenExportLesen($pdo)['map_revision'] === 900, 'E4: die Kartenrevision steht mit im Stand (`orte` haengt an den Orten)');
$bewegt = false;
try {
    // Bei jedem Versuch speichert jemand: drei Versuche, dann die Ausnahme, aus der der Endpunkt 503 data_changing macht.
    avesmapsWikiSiedlungenExportLesen($pdo, static function () use ($pdo): array {
        $pdo->exec("UPDATE wiki_sync_pages SET enriched_at = datetime(COALESCE(enriched_at, '2026-01-01'), '+1 second') WHERE title = 'Trallop'");

        return avesmapsWikiSiedlungenExportDaten($pdo);
    });
} catch (AvesmapsExportInBewegung) {
    $bewegt = true;
}
assert($bewegt, 'E5: 🔴 ein Bestand, der sich unter dem Lesen bewegt, ergibt keine Antwort mit falschem Stand');

// =====================================================================================================
// F. ENDPUNKT, BIBLIOTHEK, BEISPIELANTWORT
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/wiki-siedlungen-export.php', 'avesmapsWikiSiedlungenExportLesen', false, 'F1');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/wiki-siedlungen-export.php', 'F2');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/wiki-siedlungen-export.php'));
foreach (['details_json', 'categories_json', 'coordinates_json', 'content_hash', 'deity', 'coat_license', 'coat_author', 'coat_attribution', 'SELECT *'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "F3: 🔴 die Bibliothek liest '{$verboten}' gar nicht erst");
}
// 💣 Kein eigener Namensvergleich: der Key kommt aus der Regel von X1/X2, das Namensurteil allein aus map-presence.php.
assert(!str_contains($bibliothek, 'CreateMatchKey') && !str_contains($bibliothek, 'avesmapsPoliticalSlug'),
    'F4: die Bibliothek rechnet weder einen Namensschluessel noch einen eigenen Slug');
assert(str_contains($bibliothek, 'avesmapsWikiLinkzieleTitelDaten(') && str_contains($bibliothek, 'avesmapsWikiLinkzieleKeyAusUrl('),
    'F5: Titel und Nest laufen durch DIESELBE Schluesselregel wie X1 und X2');
assert(str_contains($bibliothek, 'avesmapsWikiLinkzieleStaende('), 'F6: map_revision und aliase_stempel kommen aus derselben Funktion wie bei X1 und X2');
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/wiki-siedlungen-export.beispiel.json'), true);
assert(is_array($beispiel), 'F7: die Beispielantwort ist lesbares JSON');
exportTestFormGleich($beispiel, $export, 'wiki-siedlungen-export');

echo "wiki-siedlungen-export-test: alle Zusicherungen erfuellt\n";
