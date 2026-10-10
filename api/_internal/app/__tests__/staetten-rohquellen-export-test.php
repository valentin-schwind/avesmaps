<?php

declare(strict_types=1);

/**
 * Der Rohquellen-Export der Staetten X4 -- GET /api/app/staetten-rohquellen-export.php (Auftrag Avesmaps3D 10.10.2026, WI-0134).
 *
 *   A. Form: genau die freigegebenen Felder je Quelle, Stempel, Reihenfolge
 *   B. Punkte (P1): aktive und von der Karte genommene, die Entscheidung „keine Stadt", nie ein geloeschter; nur das Nest
 *   C. Gespeicherte (P2): die Kennung der Stadt statt ihres gemerkten Namens, kein Entdoppeln, Key nur fuer die Wiki Aventurica
 *   D. Wege (P3b): nur mit Lage, Linkziele samt Key
 *   E. Sitze (P3c): JEDE Sitzzeile mit Rolle und Reihenfolge, die Art roh, keine Anzeigezusaetze
 *   F. Stadtteile (P3d): Identitaet ist der Titel, kein eigener Key, Linkziele samt Key
 *   G. Kopf: Zahlen und `ok` je Quelle; eine ausgefallene Quelle sagt es, die uebrigen bleiben ganz
 *   H. Was NIE hinausgeht: Personenspalten, uebrige Eigenschaften, gemerkte Stadtnamen, ein Urteil
 *   I. Schreibfreiheit und Stand (ein Sitz-Abgleich und eine gespeicherte Staette bewegen ihn; 503 beim Schreiben waehrend des Lesens)
 *   J. Endpunkt, Bibliothek, Beispielantwort; Legacys Leseliste laedt diese Datei nicht
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/staetten-rohquellen-export-test.php
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
require_once $wurzel . '/api/_internal/app/staetten-rohquellen-export.php';
require_once __DIR__ . '/export-test-helfer.php';

const SRX_WIKI = 'https://de.wiki-aventurica.de/wiki/';
// Siedlungen (nur als Ziel der Kennungen; ihr Name wird nie gelesen).
const SRX_GARETH = '22222222-2222-4222-8222-000000000001';
const SRX_FESTUM = '22222222-2222-4222-8222-000000000002';
const SRX_EICHWEILER = '22222222-2222-4222-8222-000000000004';
const SRX_FUCHSWALDEN = '22222222-2222-4222-8222-000000000005';
// Kartenpunkte mit `innerorts` (P1).
const SRX_EICHSTEIN = '22222222-2222-4222-8222-000000000011';
const SRX_WEYRING = '22222222-2222-4222-8222-000000000012';
const SRX_NORDQUARTIER = '22222222-2222-4222-8222-000000000013';
const SRX_GELOESCHT = '22222222-2222-4222-8222-000000000014';
const SRX_KAISERPALAST = '22222222-2222-4222-8222-000000000015';
const SRX_KAPUTT = '22222222-2222-4222-8222-000000000016';
const SRX_OHNE_FELD = '22222222-2222-4222-8222-000000000017';
const SRX_DORF_MIT_FELD = '22222222-2222-4222-8222-000000000018';
// Gespeicherte Staetten (P2).
const SRX_PHEX = '33333333-3333-4333-8333-000000000021';
const SRX_RONDRA = '33333333-3333-4333-8333-000000000022';
const SRX_ZURUECK = '33333333-3333-4333-8333-000000000023';
const SRX_ZWOELFE_GARETH = '33333333-3333-4333-8333-000000000024';
const SRX_ZWOELFE_FESTUM = '33333333-3333-4333-8333-000000000025';
const SRX_KOSCH = '33333333-3333-4333-8333-000000000026';

$pdo = exportTestNeuePdo();
foreach ([
    'CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
    'CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)',
    'CREATE TABLE political_territory (id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, is_active INTEGER, updated_at TEXT)',
    'CREATE TABLE wiki_redirect_alias (alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT, updated_at TEXT)',
    'CREATE TABLE wiki_sync_runs (id INTEGER PRIMARY KEY, sync_type TEXT, status TEXT, completed_at TEXT)',
    'CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT, properties_json TEXT, is_active INTEGER)',
    // Die Spalten wie in settlement-places.php -- auch die, die NIE hinausgehen duerfen.
    'CREATE TABLE settlement_place (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL, name TEXT NOT NULL, place_type TEXT,
        settlement_public_id TEXT NOT NULL, settlement_name TEXT NOT NULL, wiki_url TEXT, origin TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT, updated_at TEXT)',
    // Die Spalten wie in paths.php (ohne die fuer diesen Export belanglosen), samt Bild und Rohdaten, die nie hinausgehen.
    'CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY, wiki_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, name TEXT NOT NULL,
        match_key TEXT NOT NULL DEFAULT \'\', kind TEXT, art TEXT, lage TEXT, lage_raw TEXT, image_author TEXT, raw_json TEXT,
        wiki_url TEXT, synced_at TEXT, updated_at TEXT)',
    'CREATE TABLE wiki_organisation_seat (id INTEGER PRIMARY KEY, organisation_title TEXT NOT NULL, organisation_art TEXT,
        place_raw TEXT NOT NULL, role TEXT NOT NULL, wiki_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0, synced_at TEXT)',
    'CREATE TABLE wiki_stadtteil_weiterleitung_staging (title TEXT NOT NULL PRIMARY KEY, standort TEXT NOT NULL, wiki_url TEXT, synced_at TEXT)',
] as $ddl) {
    $pdo->exec($ddl);
}
$pdo->exec('INSERT INTO map_revision VALUES (1, 812)');
$pdo->exec('INSERT INTO ecosystem_revision VALUES (1, 50)');
// 🔴 Eine Stadtteilweiterleitung steht in der Weiterleitungstafel: der Key ihres TITELS ist der Key der Stadt.
$pdo->exec("INSERT INTO wiki_redirect_alias VALUES ('yol-fessar', 'wiki:fasar', '2026-10-01 10:00:00')");
$pdo->exec("INSERT INTO wiki_redirect_alias VALUES ('havena-siedlung', 'wiki:havena', '2026-10-01 10:00:00')");

$adresse = static fn(string $titel): string => SRX_WIKI . rawurlencode(str_replace(' ', '_', $titel));
$json = static fn(array $wert): string => json_encode($wert, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$nest = static fn(string $titel): array => ['wiki_settlement' => ['title' => $titel, 'wiki_url' => $adresse($titel)]];

$punkt = $pdo->prepare('INSERT INTO map_features (public_id, feature_type, feature_subtype, name, properties_json, is_active) VALUES (?, ?, ?, ?, ?, ?)');
// Die Staedte. Ihre NAMEN stehen nur hier: der Export liest sie nicht (die Kennung ist die Beziehung).
$punkt->execute([SRX_GARETH, 'location', 'metropole', 'Gareth', $json($nest('Gareth')), 1]);
$punkt->execute([SRX_FESTUM, 'location', 'grossstadt', 'Festum', $json($nest('Festum')), 1]);
$punkt->execute([SRX_EICHWEILER, 'location', 'dorf', 'Eichweiler', '{}', 1]);
// Die Stadt wurde umbenannt; die gespeicherten Staetten merken sich noch den alten Namen (der Fuchswalden-Fall).
$punkt->execute([SRX_FUCHSWALDEN, 'location', 'dorf', 'Fuchswalden (Bärenau)', '{}', 1]);
// P1 auf der Karte, von Hand zugeordnet.
$punkt->execute([SRX_EICHSTEIN, 'location', 'gebaeude', 'Burg Eichstein', $json($nest('Burg Eichstein') + [
    'place_kind' => 'Burg', 'innerorts' => ['ort' => SRX_EICHWEILER], 'field_origins' => ['innerorts' => 'manual'],
    'coat' => ['url' => 'GEHEIM-WAPPEN'], 'note' => 'GEHEIM-NOTIZ',
]), 1]);
// P1 von der Karte genommen: inaktiv MIT Merker -- bleibt Staette seiner Stadt.
$punkt->execute([SRX_WEYRING, 'location', 'gebaeude', 'Gut Weyring', $json($nest('Gut Weyring') + [
    'place_kind' => 'Gutshof', 'innerorts' => ['ort' => SRX_GARETH, 'von_der_karte' => true], 'field_origins' => ['innerorts' => 'wiki'],
]), 0]);
// Die Entscheidung „keine Stadt": eine Herkunft ohne Wert (field-origins.php: auf leer geaendert).
$punkt->execute([SRX_NORDQUARTIER, 'location', 'stadtviertel', 'Nordquartier', $json([
    'field_origins' => ['innerorts' => 'manual'],
]), 1]);
// Regulaer geloescht (inaktiv OHNE Merker): auch fuer Legacy keine Staette mehr.
$punkt->execute([SRX_GELOESCHT, 'location', 'gebaeude', 'Alter Tempel', $json(['innerorts' => ['ort' => SRX_GARETH]]), 0]);
// Ohne gestempelte Herkunft und nur mit dem FLACHEN wiki_url (das raet der Lesepfad der Karte per Namen): kein Key.
$punkt->execute([SRX_KAISERPALAST, 'location', 'gebaeude', 'Kaiserpalast', $json([
    'innerorts' => ['ort' => SRX_GARETH], 'wiki_url' => SRX_WIKI . 'Kaiserpalast',
]), 1]);
// Kaputtes JSON (es enthaelt das Wort) und ein Punkt ohne das Feld.
$punkt->execute([SRX_KAPUTT, 'location', 'gebaeude', 'Kaputt', '{"innerorts": ', 1]);
$punkt->execute([SRX_OHNE_FELD, 'location', 'gebaeude', 'Reichsforum', '{}', 1]);
// Eine Siedlung mit dem Feld ist keine Staette (nur die zwei Ortsgroessen tragen es).
$punkt->execute([SRX_DORF_MIT_FELD, 'location', 'dorf', 'Falschdorf', $json(['innerorts' => ['ort' => SRX_GARETH]]), 1]);

$gespeichert = $pdo->prepare(
    'INSERT INTO settlement_place (public_id, name, place_type, settlement_public_id, settlement_name, wiki_url, origin, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 987654, ?, ?)'
);
$gespeichert->execute([SRX_PHEX, 'Phex-Tempel Selindes Hort', 'Tempel', SRX_FUCHSWALDEN, 'Fuchswalden (Siebeneichen)',
    'https://www.garetien.de/index.php/Garetien:Phex-Tempel_Selindes_Hort', 'garetien', 1, '2026-09-01 10:00:00.000', '2026-09-01 10:00:00.000']);
$gespeichert->execute([SRX_RONDRA, 'Kloster Rabenmund', 'Kloster', SRX_FUCHSWALDEN, 'Fuchswalden (Siebeneichen)',
    SRX_WIKI . 'Kloster_Rabenmund', 'garetien', 1, '2026-09-01 10:00:00.000', '2026-09-01 10:00:00.000']);
$gespeichert->execute([SRX_ZURUECK, 'Zurückgenommene Stätte', null, SRX_GARETH, 'Gareth', null, 'manual', 0,
    '2026-09-01 10:00:00.000', '2026-09-02 10:00:00.000']);
// Zwei gleichnamige Staetten in zwei Staedten -- Legacys Leseliste behaelt nur die erste (`$seen`), der Export beide.
$gespeichert->execute([SRX_ZWOELFE_GARETH, 'Tempel der Zwölfe', 'Tempel', SRX_GARETH, 'Gareth', null, 'garetien', 1,
    '2026-09-01 10:00:00.000', '2026-09-01 10:00:00.000']);
$gespeichert->execute([SRX_ZWOELFE_FESTUM, 'Tempel der Zwölfe', '', SRX_FESTUM, 'Festum', null, 'garetien', 1,
    '2026-09-01 10:00:00.000', '2026-09-01 10:00:00.000']);
// Ein anderes Wiki MIT /wiki/-Pfad: ein Key aus diesem Pfad waere ein Artikel der Wiki Aventurica, den es so nicht gibt.
$gespeichert->execute([SRX_KOSCH, 'Rondratempel zu Angbar', 'Tempel', SRX_FESTUM, 'Festum', 'https://www.koschwiki.de/wiki/Rondratempel_zu_Angbar',
    'koschwiki', 1, '2026-09-01 10:00:00.000', '2026-09-01 10:00:00.000']);

$weg = $pdo->prepare(
    'INSERT INTO wiki_path_staging (wiki_key, title, name, art, lage, lage_raw, image_author, raw_json, wiki_url, synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, \'GEHEIM-BILDURHEBER\', \'{"GEHEIM-ROHDATEN":1}\', ?, \'2026-10-02 16:30:00.000\', \'2026-10-02 16:30:00.000\')'
);
$weg->execute(['wiki:webergasse', 'Webergasse', 'Webergasse', 'Gasse', 'Khunchom', '[[Khunchom]]', $adresse('Webergasse')]);
$weg->execute(['wiki:reichsstrasse-1', 'Reichsstraße 1', 'Reichsstraße 1', 'Reichsstraße', 'Garetien, Darpatien',
    '[[Garetien]], [[Darpatien|Darpatische Lande]]', $adresse('Reichsstraße 1')]);
// Ohne Lage gibt es nichts zu nennen: kein Eintrag.
$weg->execute(['wiki:gardel', 'Gardel', 'Gardel', 'Fluss', null, null, $adresse('Gardel')]);
$weg->execute(['wiki:leerweg', 'Leerweg', 'Leerweg', 'Pfad', '', '', $adresse('Leerweg')]);

$sitz = $pdo->prepare(
    'INSERT INTO wiki_organisation_seat (organisation_title, organisation_art, place_raw, role, wiki_url, sort_order, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
// 🔴 EINE Organisation, DREI Sitze: ein Artikel, drei Objekte. Legacys Leseliste zeigt nur den ersten (`$seen`).
$sitz->execute(['Nordlandbank', 'Bankhaus', '[[Festum]]', 'hauptsitz', $adresse('Nordlandbank'), 0, '2026-10-02 16:40:00.000']);
// Eine Kette, die ZWEI Orte nennt: welcher gemeint ist, sagt kein Key -- sie bleibt fuer Avesmaps3D offen. Eingetragen in
// anderer Reihenfolge als `sort_order`, damit die Probe die Reihenfolge der Sitze wirklich sieht.
$sitz->execute(['Nordlandbank', 'Bankhaus', '[[Gareth]]', 'zweigsitz', $adresse('Nordlandbank'), 2, '2026-10-02 16:40:00.000']);
$sitz->execute(['Nordlandbank', 'Bankhaus', 'zwischen [[Smamid]] und [[Ehristar]]', 'zweigsitz', $adresse('Nordlandbank'), 1,
    '2026-10-02 16:40:00.000']);
// Ohne Art (Legacys Leseliste setzt „Handelshaus") und mit dem Rest des Importfehlers in der Art (roh, wie gespeichert).
$sitz->execute(['Handelshaus Ongswin', null, '[[Gareth]]', 'zweigsitz', $adresse('Handelshaus Ongswin'), 0, '2026-10-02 16:41:00.000']);
$sitz->execute(['Garderegiment Rabenmund', 'Provinzherrliches Garderegiment<br><small>(Leibregiment)<', '[[Havena (Siedlung)|Havena]]',
    'hauptsitz', $adresse('Garderegiment Rabenmund'), 0, '2026-10-02 16:42:00.000']);

$stadtteil = $pdo->prepare('INSERT INTO wiki_stadtteil_weiterleitung_staging (title, standort, wiki_url, synced_at) VALUES (?, ?, ?, ?)');
$stadtteil->execute(['Yol-Fessar', '[[Fasar]]', $adresse('Yol-Fessar'), '2026-10-02 16:45:00.000']);
$stadtteil->execute(['Hafen (Festum)', '[[Festum]]', $adresse('Hafen (Festum)'), '2026-10-02 16:46:00.000']);
// Ein Ziel, das keinen Schluessel hergibt: es bleibt ohne Key.
$stadtteil->execute(['Unterstadt', '[[_]]', $adresse('Unterstadt'), '2026-10-02 16:47:00.000']);

// =====================================================================================================
// A. FORM
// =====================================================================================================
$export = exportTestSchreibfrei($pdo, static fn (): array => avesmapsStaettenRohquellenLesen($pdo), 'I1');
assert(array_keys($export) === ['ok', 'map_revision', 'aliase_stempel', 'quellen_stand', 'kopf', 'punkte', 'gespeicherte', 'wege', 'sitze', 'stadtteile'],
    'A1: die Antwortform: ' . json_encode(array_keys($export)));
assert($export['ok'] === true && $export['map_revision'] === 812, 'A2: ok und die Kartenrevision');
assert(preg_match('/^sq-[0-9a-f]{16}$/', (string) $export['quellen_stand']) === 1, 'A3: der Stempel der Quellen ist `sq-<16 Hex>`');
assert(preg_match('/^ra-[0-9a-f]{16}$/', (string) $export['aliase_stempel']) === 1, 'A4: der Stempel der Weiterleitungen wie bei X1 bis X3');
foreach (AVESMAPS_STAETTEN_ROHQUELLEN as $quelle) {
    exportTestGenauFelder($export[$quelle], AVESMAPS_STAETTEN_ROHQUELLEN_FELDER[$quelle], 'A5 ' . $quelle);
}
foreach (['wege' => 'lage_links', 'sitze' => 'ort_links', 'stadtteile' => 'standort_links'] as $quelle => $feld) {
    foreach ($export[$quelle] as $zeile) {
        foreach ($zeile[$feld] as $link) {
            assert(array_keys($link) === AVESMAPS_EXPORT_LINKZIEL_FELDER, "A6: ein Linkziel ({$quelle}) traegt genau {ziel, ziel_key}");
        }
    }
}

// =====================================================================================================
// B. PUNKTE (P1)
// =====================================================================================================
$punkte = array_column($export['punkte'], null, 'public_id');
assert(array_keys($punkte) === [SRX_EICHSTEIN, SRX_WEYRING, SRX_NORDQUARTIER, SRX_KAISERPALAST],
    'B1: aktive und von der Karte genommene Punkte und die Entscheidung „keine Stadt", nach Kennung -- nie ein geloeschter, ein kaputter, ein Punkt ohne Feld oder eine Siedlung: '
    . json_encode(array_keys($punkte)));
assert($punkte[SRX_EICHSTEIN] === [
    'public_id' => SRX_EICHSTEIN,
    'name' => 'Burg Eichstein',
    'ortsklasse' => 'gebaeude',
    'art' => 'Burg',
    'wiki_url' => SRX_WIKI . 'Burg_Eichstein',
    'wiki_key' => 'wiki:burg-eichstein',
    'aktiv' => true,
    'von_der_karte' => false,
    'innerorts_ort' => SRX_EICHWEILER,
    'innerorts_herkunft' => 'manual',
], 'B2: ein Punkt vollstaendig und typgerecht: ' . $json($punkte[SRX_EICHSTEIN]));
assert($punkte[SRX_WEYRING]['aktiv'] === false && $punkte[SRX_WEYRING]['von_der_karte'] === true
    && $punkte[SRX_WEYRING]['innerorts_ort'] === SRX_GARETH && $punkte[SRX_WEYRING]['innerorts_herkunft'] === 'wiki',
    'B3: 🔴 ein von der Karte genommener Punkt behaelt Kennung, Stadt und Herkunft');
assert($punkte[SRX_NORDQUARTIER]['innerorts_ort'] === null && $punkte[SRX_NORDQUARTIER]['innerorts_herkunft'] === 'manual'
    && $punkte[SRX_NORDQUARTIER]['ortsklasse'] === 'stadtviertel' && $punkte[SRX_NORDQUARTIER]['art'] === null,
    'B4: 🔴 die Entscheidung „keine Stadt" reist mit: Herkunft ohne Kennung');
assert($punkte[SRX_KAISERPALAST]['innerorts_herkunft'] === null && $punkte[SRX_KAISERPALAST]['wiki_url'] === null
    && $punkte[SRX_KAISERPALAST]['wiki_key'] === null,
    'B5: ohne Stempel keine erfundene Herkunft; das flache wiki_url ist keine Zuweisung (nur das Nest, wie X2)');
assert(!exportTestEnthaelt($export['punkte'], 'Eichweiler') && !exportTestEnthaelt($export['punkte'], 'Gareth'),
    'B6: 🔴 der Name der Stadt wird nicht gelesen -- die Kennung ist die Beziehung');

// =====================================================================================================
// C. GESPEICHERTE (P2)
// =====================================================================================================
$gespeicherte = array_column($export['gespeicherte'], null, 'public_id');
assert(array_keys($gespeicherte) === [SRX_PHEX, SRX_RONDRA, SRX_ZWOELFE_GARETH, SRX_ZWOELFE_FESTUM, SRX_KOSCH],
    'C1: nur aktive, nach Kennung: ' . json_encode(array_keys($gespeicherte)));
assert($gespeicherte[SRX_PHEX] === [
    'public_id' => SRX_PHEX,
    'name' => 'Phex-Tempel Selindes Hort',
    'art' => 'Tempel',
    'ort_public_id' => SRX_FUCHSWALDEN,
    'wiki_url' => 'https://www.garetien.de/index.php/Garetien:Phex-Tempel_Selindes_Hort',
    'wiki_key' => null,
    'quelle' => 'garetien',
], 'C2: 🔴 die Stadt als Kennung; eine Adresse eines anderen Wikis traegt keinen Key: ' . $json($gespeicherte[SRX_PHEX]));
assert(!exportTestEnthaelt($export, 'Siebeneichen'), 'C3: 💣 der gemerkte, veraltete Stadtname geht nicht mit (die Stadt heisst laengst anders)');
assert($gespeicherte[SRX_RONDRA]['wiki_key'] === 'wiki:kloster-rabenmund', 'C4: eine Adresse der Wiki Aventurica traegt den Key nach der Regel von X2');
assert($gespeicherte[SRX_KOSCH]['wiki_key'] === null && $gespeicherte[SRX_KOSCH]['quelle'] === 'koschwiki',
    'C4b: 🔴 ein anderes Wiki traegt keinen Key, auch mit /wiki/-Pfad');
assert($gespeicherte[SRX_ZWOELFE_GARETH]['name'] === $gespeicherte[SRX_ZWOELFE_FESTUM]['name']
    && $gespeicherte[SRX_ZWOELFE_GARETH]['ort_public_id'] === SRX_GARETH && $gespeicherte[SRX_ZWOELFE_FESTUM]['ort_public_id'] === SRX_FESTUM,
    'C5: 🔴 KEIN Entdoppeln: zwei gleichnamige Staetten zweier Staedte sind zwei Zeilen');
assert($gespeicherte[SRX_ZWOELFE_FESTUM]['art'] === null, 'C6: eine leere Art ist null, kein Rueckfall');

// =====================================================================================================
// D. WEGE (P3b)
// =====================================================================================================
assert(array_column($export['wege'], 'weg_key') === ['wiki:reichsstrasse-1', 'wiki:webergasse'], 'D1: nur Wege mit Lage, nach Legacys Kennung');
$wege = array_column($export['wege'], null, 'weg_key');
assert($wege['wiki:reichsstrasse-1']['lage_roh'] === '[[Garetien]], [[Darpatien|Darpatische Lande]]'
    && $wege['wiki:reichsstrasse-1']['lage_links'] === [
        ['ziel' => 'Garetien', 'ziel_key' => 'wiki:garetien'],
        ['ziel' => 'Darpatien', 'ziel_key' => 'wiki:darpatien'],
    ], 'D2: die rohe Lage und ihre Linkziele -- das ZIEL, nie die Anzeige');
assert($wege['wiki:webergasse']['wiki_key'] === 'wiki:webergasse' && $wege['wiki:webergasse']['titel'] === 'Webergasse'
    && $wege['wiki:webergasse']['art'] === 'Gasse', 'D3: der Key des Artikels nach der Regel von X1/X2, die Art wie gespeichert');

// =====================================================================================================
// E. SITZE (P3c)
// =====================================================================================================
$nordlandbank = array_values(array_filter($export['sitze'], static fn(array $zeile): bool => $zeile['organisation'] === 'Nordlandbank'));
assert(count($nordlandbank) === 3, 'E1: 🔴 JEDE Sitzzeile, nicht nur der erste Sitz');
assert(array_column($nordlandbank, 'rolle') === ['hauptsitz', 'zweigsitz', 'zweigsitz']
    && array_column($nordlandbank, 'reihenfolge') === [0, 1, 2]
    && array_column($nordlandbank, 'ort_roh') === ['[[Festum]]', 'zwischen [[Smamid]] und [[Ehristar]]', '[[Gareth]]'],
    'E2: Rolle und Reihenfolge wie gespeichert, geordnet nach der Reihenfolge, nicht nach dem Text');
assert(count(array_unique(array_column($nordlandbank, 'wiki_key'))) === 1 && $nordlandbank[0]['wiki_key'] === 'wiki:nordlandbank',
    'E3: ein Artikel fuer alle Sitze -- die Kennung eines Sitzes ist Organisation UND Ortsangabe');
assert($nordlandbank[0]['ort_links'] === [['ziel' => 'Festum', 'ziel_key' => 'wiki:festum']]
    && $nordlandbank[1]['ort_links'] === [['ziel' => 'Smamid', 'ziel_key' => 'wiki:smamid'], ['ziel' => 'Ehristar', 'ziel_key' => 'wiki:ehristar']],
    'E4: die Linkziele je Sitz; eine Kette mit zwei Orten nennt beide (kein „erster gewinnt")');
assert($nordlandbank[0]['organisation_art'] === 'Bankhaus', 'E5: 🔴 die Art ohne den Anzeigezusatz „(Hauptsitz)" -- die Rolle steht daneben');
$sitze = array_column($export['sitze'], null, 'organisation');
assert($sitze['Handelshaus Ongswin']['organisation_art'] === null, 'E6: ohne Art null -- nicht Legacys Anzeigerueckfall „Handelshaus"');
assert($sitze['Garderegiment Rabenmund']['organisation_art'] === 'Provinzherrliches Garderegiment<br><small>(Leibregiment)<'
    && $sitze['Garderegiment Rabenmund']['ort_links'] === [['ziel' => 'Havena (Siedlung)', 'ziel_key' => 'wiki:havena']],
    'E7: die Art roh wie gespeichert (bereinigt wird beim Empfaenger); das Ziel durch die Weiterleitungstafel');
assert(array_column($export['sitze'], 'organisation') === ['Garderegiment Rabenmund', 'Handelshaus Ongswin', 'Nordlandbank', 'Nordlandbank', 'Nordlandbank'],
    'E8: nach Organisation und Reihenfolge');

// =====================================================================================================
// F. STADTTEILE (P3d)
// =====================================================================================================
$stadtteile = array_column($export['stadtteile'], null, 'titel');
assert(array_keys($stadtteile) === ['Hafen (Festum)', 'Unterstadt', 'Yol-Fessar'], 'F1: nach Titel');
assert($stadtteile['Yol-Fessar'] === [
    'titel' => 'Yol-Fessar',
    'standort' => '[[Fasar]]',
    'standort_links' => [['ziel' => 'Fasar', 'ziel_key' => 'wiki:fasar']],
    'wiki_url' => SRX_WIKI . 'Yol-Fessar',
], 'F2: 🔴 Identitaet ist der Titel; KEIN eigener Key (der Key des Titels waere wiki:fasar, der Key der Stadt): ' . $json($stadtteile['Yol-Fessar']));
assert(avesmapsWikiLinkzieleKey('Yol-Fessar', avesmapsWikiLinkzieleAliase($pdo)) === 'wiki:fasar',
    'F3: die Falle steht wirklich in der Welt -- der Titel der Weiterleitung kanonisiert auf die Stadt');
assert($stadtteile['Unterstadt']['standort_links'] === [['ziel' => '_', 'ziel_key' => null]], 'F4: ein Ziel ohne Schluessel bleibt ohne Key');

// =====================================================================================================
// G. KOPF, AUSFALL EINER QUELLE
// =====================================================================================================
assert($export['kopf'] === [
    'punkte' => ['ok' => true, 'zeilen' => 4],
    'gespeicherte' => ['ok' => true, 'zeilen' => 5],
    'wege' => ['ok' => true, 'zeilen' => 2, 'linkziele' => 3, 'linkziele_ohne_schluessel' => 0],
    'sitze' => ['ok' => true, 'zeilen' => 5, 'organisationen' => 3, 'linkziele' => 6, 'linkziele_ohne_schluessel' => 0,
        'neuester_abgleich' => '2026-10-02 16:42:00.000'],
    'stadtteile' => ['ok' => true, 'zeilen' => 3, 'linkziele' => 3, 'linkziele_ohne_schluessel' => 1,
        'neuester_abgleich' => '2026-10-02 16:47:00.000'],
], 'G1: die Zahlen des Kopfes: ' . $json($export['kopf']));
foreach (AVESMAPS_STAETTEN_ROHQUELLEN as $quelle) {
    assert($export['kopf'][$quelle]['zeilen'] === count($export[$quelle]), "G2: der Kopf zaehlt die Liste {$quelle}");
}
// Eine Quelle faellt aus (Tabelle fehlt): IHR ok ist falsch, ihre Liste leer -- die anderen bleiben ganz, kein 500.
$pdo->exec('ALTER TABLE wiki_organisation_seat RENAME TO wiki_organisation_seat_weg');
$ohneSitze = exportTestSchreibfrei($pdo, static fn (): array => avesmapsStaettenRohquellenLesen($pdo), 'I2');
$pdo->exec('ALTER TABLE wiki_organisation_seat_weg RENAME TO wiki_organisation_seat');
assert($ohneSitze['kopf']['sitze'] === ['ok' => false, 'zeilen' => 0, 'organisationen' => 0, 'linkziele' => 0,
    'linkziele_ohne_schluessel' => 0, 'neuester_abgleich' => null] && $ohneSitze['sitze'] === [],
    'G3: 🔴 eine ausgefallene Quelle SAGT es (ok falsch), statt still leer zu sein: ' . $json($ohneSitze['kopf']['sitze']));
foreach (['punkte', 'gespeicherte', 'wege', 'stadtteile'] as $quelle) {
    assert($ohneSitze[$quelle] === $export[$quelle] && $ohneSitze['kopf'][$quelle]['ok'] === true, "G4: {$quelle} bleibt ganz, wenn die Sitze ausfallen");
}
assert($ohneSitze['quellen_stand'] !== $export['quellen_stand'], 'G5: der Stand sieht die fehlende Tabelle');

// =====================================================================================================
// H. WAS NIE HINAUSGEHT
// =====================================================================================================
foreach (['GEHEIM-WAPPEN', 'GEHEIM-NOTIZ', 'GEHEIM-BILDURHEBER', 'GEHEIM-ROHDATEN', '987654', 'created_by', 'settlement_name',
    'field_origins', 'Zurückgenommene', 'Alter Tempel', 'Kaputt', 'Reichsforum', 'Falschdorf', 'Gardel', 'Leerweg', 'scope', 'inside',
    'outside', 'ambiguous', 'settlement', 'synced_at', 'Handelshaus (Hauptsitz)', 'Bankhaus (Hauptsitz)'] as $geheim) {
    assert(!exportTestEnthaelt($export, $geheim), "H1: 🔴 '{$geheim}' taucht nirgends auf");
}

// =====================================================================================================
// I. STAND
// =====================================================================================================
$vorher = $export['quellen_stand'];
$pdo->exec("UPDATE wiki_organisation_seat SET synced_at = '2026-10-09 08:00:00.000' WHERE organisation_title = 'Handelshaus Ongswin'");
$nachSitz = avesmapsStaettenRohquellenLesen($pdo);
assert($nachSitz['quellen_stand'] !== $vorher, 'I3: ein neuer Sitz-Abgleich hebt den Stand');
assert($nachSitz['quellen_stand'] === avesmapsStaettenRohquellenLesen($pdo)['quellen_stand'], 'I4: derselbe Bestand, derselbe Stempel');
$pdo->exec("UPDATE settlement_place SET updated_at = '2026-10-09 09:00:00.000' WHERE public_id = '" . SRX_RONDRA . "'");
assert(avesmapsStaettenRohquellenLesen($pdo)['quellen_stand'] !== $nachSitz['quellen_stand'],
    'I5: 💣 eine gespeicherte Staette hebt den Stand, obwohl sie map_revision nicht bewegt');
$bewegt = false;
try {
    avesmapsStaettenRohquellenLesen($pdo, static function () use ($pdo): array {
        // Der juengste Abgleich wandert: das sieht der Fingerabdruck (eine aeltere Zeile allein deckt der Inhalts-ETag).
        $pdo->exec("UPDATE wiki_organisation_seat SET synced_at = datetime(synced_at, '+1 second') WHERE organisation_title = 'Handelshaus Ongswin'");

        return avesmapsStaettenRohquellenDaten($pdo);
    });
} catch (AvesmapsExportInBewegung) {
    $bewegt = true;
}
assert($bewegt, 'I6: 🔴 ein Bestand, der sich unter dem Lesen bewegt, ergibt keine Antwort mit falschem Stand');

// =====================================================================================================
// J. ENDPUNKT, BIBLIOTHEK, BEISPIELANTWORT, LEGACYS LESELISTE
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/staetten-rohquellen-export.php', 'avesmapsStaettenRohquellenLesen', false, 'J1');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/staetten-rohquellen-export.php', 'J2');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/staetten-rohquellen-export.php'));
foreach (['created_by', 'settlement_name', 'SELECT *', 'avesmapsPlaceScope', 'avesmapsBuildInSettlementPlaceList',
    'avesmapsFetchInSettlementSearchRows', 'avesmapsInnerortsPunkteFuerStaetten', 'avesmapsSettlementPlaceRows',
    'avesmapsOrgSeatFetchInSettlementRows', 'CreateMatchKey', 'avesmapsPoliticalSlug', 'strtolower', 'mb_strtolower',
    'getMessage', '$seen', 'Hauptsitz', 'Handelshaus'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "J3: 🔴 die Bibliothek benutzt '{$verboten}' nicht (kein Urteil, kein Entdoppeln, kein Namensvergleich, keine Personenspalte)");
}
assert(str_contains($bibliothek, 'avesmapsWikiLinkzieleKey(') && str_contains($bibliothek, 'avesmapsWikiLinkzieleKeyAusUrl(')
    && str_contains($bibliothek, 'avesmapsExportLinkziele(') && str_contains($bibliothek, 'avesmapsWikiLinkzieleStaende('),
    'J4: Keys, Linkziele und Staende laufen durch DIESELBEN Funktionen wie X1 bis X3');
// 🔴 Legacys Leseliste und die Kartennutzlast laden diese Datei nicht: ihr Verhalten bleibt, wie es ist.
foreach (['api/app/map-features.php', 'api/_internal/app/in-settlement-search.php', 'api/_internal/app/settlement-places.php',
    'api/_internal/app/innerorts.php', 'api/_internal/wiki/organisation-sync.php', 'api/_internal/wiki/stadtteil-weiterleitung.php'] as $datei) {
    assert(!str_contains((string) file_get_contents($wurzel . '/' . $datei), 'staetten-rohquellen-export'),
        "J5: 🔴 {$datei} laedt den Export nicht");
}
$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/staetten-rohquellen-export.beispiel.json'), true);
assert(is_array($beispiel), 'J6: die Beispielantwort ist lesbares JSON');
exportTestFormGleich($beispiel, $export, 'staetten-rohquellen-export');

echo "staetten-rohquellen-export-test: alle Zusicherungen erfuellt\n";
